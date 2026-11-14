'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { ManagementStore } = require('../lib/management-store');
const { ProjectionLock, ProjectionRunner } = require('../lib/projection-runner');

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});
function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'projection-runner-'));
  roots.push(value);
  return value;
}
function task(title = 'Visible') {
  return {
    id: 't_public01',
    board: 'public',
    title,
    body: '',
    assignee: 'Felix',
    status: 'ready',
    priority: 0,
    created_by: 'test',
    created_at: 1700000000,
    started_at: null,
    completed_at: null,
    tenant: 'test',
    result: null,
    block_kind: null,
    project_id: null,
    comments: [],
    attachments: [],
    reversibleInternal: true,
  };
}
function source(title = 'Visible') {
  const item = task(title);
  return {
    generatedAt: 1700000100,
    count: 1,
    errors: [],
    boards: [{ board: 'public', count: 1, items: [item] }],
  };
}
function runner(database, loadSource, extra = {}) {
  return new ProjectionRunner({
    database,
    loadSource,
    now: extra.now || (() => 1700000200),
    wallClock: extra.wallClock,
    maxDurationMs: extra.maxDurationMs,
    lockStaleMs: extra.lockStaleMs,
    beforeActivate: extra.beforeActivate,
    project: extra.project,
  });
}

test('atomically activates once and unchanged observations skip rebuild and inode replacement', () => {
  const database = path.join(root(), 'management.db');
  const first = runner(database, () => source()).runOnce();
  assert.equal(first.status, 'success');
  const store = new ManagementStore({ database });
  const projection = store.query(
    'SELECT topic_id,title,source_task_refs_json FROM management_topics'
  );
  const boards = store.query('SELECT * FROM projection_boards');
  const inode = fs.statSync(database).ino;
  let buildCalls = 0;
  const second = runner(database, () => source(), {
    project() {
      buildCalls += 1;
    },
  }).runOnce();
  assert.equal(second.unchanged, true);
  assert.equal(buildCalls, 0);
  assert.equal(fs.statSync(database).ino, inode);
  assert.deepEqual(
    store.query('SELECT topic_id,title,source_task_refs_json FROM management_topics'),
    projection
  );
  assert.deepEqual(store.query('SELECT * FROM projection_boards'), boards);
  assert.equal(store.query('SELECT COUNT(*) AS count FROM projection_runs')[0].count, 2);
});

test('parallel source changes abort activation and keep last-known-good data', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Old')).runOnce();
  let calls = 0;
  const result = runner(database, () => source(++calls === 1 ? 'New' : 'Changed again')).runOnce();
  assert.equal(result.errorCode, 'SOURCE_CHANGED_DURING_RUN');
  assert.equal(
    new ManagementStore({ database }).query('SELECT title FROM management_topics')[0].title,
    'Old'
  );
});

test('a source change after build but before activation also keeps LKG', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Old')).runOnce();
  let changed = false;
  const result = runner(database, () => source(changed ? 'Changed during build' : 'Candidate'), {
    beforeActivate: () => {
      changed = true;
    },
  }).runOnce();
  assert.equal(result.errorCode, 'SOURCE_CHANGED_DURING_RUN');
  assert.equal(
    new ManagementStore({ database }).query('SELECT title FROM management_topics')[0].title,
    'Old'
  );
});

test('projection failure never replaces LKG and failed attempt persists across restart', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Good')).runOnce();
  const result = runner(database, () => {
    throw new Error('secret /private/source');
  }).runOnce();
  assert.equal(result.status, 'failed');
  const store = new ManagementStore({ database });
  assert.equal(store.query('SELECT title FROM management_topics')[0].title, 'Good');
  const runs = store.query(
    "SELECT status,error_count,error_code FROM projection_runs WHERE run_id=(SELECT value FROM projection_checkpoint WHERE checkpoint_key='last_attempt')"
  );
  assert.deepEqual(runs[0], { status: 'failed', error_count: 1, error_code: 'SOURCE_LOAD_FAILED' });
  const restarted = runner(database, () => source('Good')).runOnce();
  assert.equal(restarted.unchanged, true);
});

test('fresh malformed lock blocks and stale malformed/dead locks are reclaimed', () => {
  const directory = root();
  const database = path.join(directory, 'management.db');
  const lockPath = `${database}.projection.lock`;
  fs.writeFileSync(lockPath, '');
  assert.equal(runner(database, () => source(), { lockStaleMs: 10000 }).runOnce().status, 'locked');
  fs.utimesSync(lockPath, new Date(0), new Date(0));
  assert.equal(runner(database, () => source(), { lockStaleMs: 1 }).runOnce().status, 'success');
  fs.writeFileSync(lockPath, JSON.stringify({ token: 'dead', pid: 99999999, createdAtMs: 1 }));
  const reclaimed = new ProjectionLock(lockPath, { nowMs: () => 20000, staleAfterMs: 1000 });
  assert.equal(reclaimed.acquire(), true);
  reclaimed.release();
});

test('fresh lock with a dead pid is reclaimed immediately', () => {
  const lockPath = path.join(root(), 'projection.lock');
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      token: 'dead',
      pid: 99999999,
      processStartTicks: '123',
      createdAtMs: Date.now(),
    })
  );
  const lock = new ProjectionLock(lockPath, { staleAfterMs: 60000 });
  assert.equal(lock.acquire(), true);
  lock.release();
});

test('pid reuse identity mismatch is reclaimed without waiting for stale age', () => {
  const lockPath = path.join(root(), 'projection.lock');
  const probe = new ProjectionLock(lockPath);
  const currentTicks = probe.processStartTicks(process.pid);
  assert.ok(currentTicks);
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      token: 'reused',
      pid: process.pid,
      processStartTicks: String(BigInt(currentTicks) + 1n),
      createdAtMs: Date.now(),
    })
  );
  assert.equal(probe.acquire(), true);
  probe.release();
});

test('live concurrent lock is retained and release never deletes another owner token', () => {
  const lockPath = path.join(root(), 'projection.lock');
  const owner = new ProjectionLock(lockPath, { staleAfterMs: 1 });
  assert.equal(owner.acquire(), true);
  const contender = new ProjectionLock(lockPath, {
    nowMs: () => Date.now() + 60000,
    staleAfterMs: 1,
  });
  assert.equal(contender.acquire(), false);
  fs.closeSync(owner.handle);
  owner.handle = null;
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ token: 'replacement', pid: process.pid, createdAtMs: Date.now() })
  );
  owner.release();
  assert.equal(JSON.parse(fs.readFileSync(lockPath)).token, 'replacement');
});

test('source errors are opaque degraded health and preserve prior board data', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Last good')).runOnce();
  const degraded = {
    generatedAt: 1700000300,
    count: 0,
    boards: [],
    errors: [{ board: 'public', error: 'customer name' }],
  };
  const result = runner(database, () => degraded).runOnce();
  assert.equal(result.status, 'degraded');
  const store = new ManagementStore({ database });
  assert.equal(store.query('SELECT title FROM management_topics')[0].title, 'Last good');
  const health = store.query('SELECT source_id,error_code FROM projection_source_health');
  assert.match(health[0].source_id, /^source_[0-9a-f]{16}$/);
  assert.equal(health[0].error_code, 'SOURCE_READ_FAILED');
  assert.equal(JSON.stringify(health).includes('customer'), false);
});

test('zero-source scan is a sanitized failure and never establishes freshness', () => {
  const database = path.join(root(), 'management.db');
  const result = runner(database, () => ({
    generatedAt: 1,
    count: 0,
    boards: [],
    errors: [],
  })).runOnce();
  assert.deepEqual(result, { status: 'failed', errorCode: 'NO_SOURCES_AVAILABLE' });
  assert.equal(fs.statSync(database).mode & 0o777, 0o600);
  const store = new ManagementStore({ database });
  assert.deepEqual(store.query('SELECT status,error_code FROM projection_runs'), [
    { status: 'failed', error_code: 'NO_SOURCES_AVAILABLE' },
  ]);
  assert.equal(
    store.query(
      "SELECT COUNT(*) AS count FROM projection_checkpoint WHERE checkpoint_key='last_success_run_id'"
    )[0].count,
    0
  );
  assert.equal(
    JSON.stringify(store.query('SELECT * FROM projection_source_health')).includes(
      'NO_SOURCES_AVAILABLE'
    ),
    true
  );
});

test('candidate database is mode 0600 before activation hook runs', () => {
  const database = path.join(root(), 'management.db');
  let candidateMode = null;
  const result = runner(database, () => source(), {
    beforeActivate: ({ tempDatabase }) => {
      candidateMode = fs.statSync(tempDatabase).mode & 0o777;
    },
  }).runOnce();
  assert.equal(result.status, 'success');
  assert.equal(candidateMode, 0o600);
});

test('absolute deadline is passed as decreasing timeout and aborts activation', () => {
  const database = path.join(root(), 'management.db');
  let clock = 0;
  const timeouts = [];
  const result = runner(
    database,
    (budget) => {
      timeouts.push(budget.timeoutMs);
      clock += 20;
      return source();
    },
    { wallClock: () => clock, maxDurationMs: 50 }
  ).runOnce();
  assert.equal(result.errorCode, 'RUN_BUDGET_EXCEEDED');
  assert.ok(timeouts[1] < timeouts[0]);
  assert.equal(fs.existsSync(database), true); // failure observation, never a candidate activation
  assert.equal(
    new ManagementStore({ database }).query('SELECT COUNT(*) AS count FROM management_topics')[0]
      .count,
    0
  );
});

test('privacy verification rejects a private marker from a projection lane and retains LKG', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Good')).runOnce();
  const injectingProject = (store, input, options) => {
    const result = require('../lib/projector').project(store, input, options);
    const injected = spawnSync(
      'python3',
      [
        '-c',
        "import sqlite3,sys,json; con=sqlite3.connect(sys.argv[1]); con.execute(\"INSERT INTO cockpit_events VALUES ('private_event',1,'test','topic','x',NULL,?)\", (json.dumps({'sensitivity':'private'}),)); con.commit()",
        store.database,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(injected.status, 0, injected.stderr);
    assert.equal(
      store.query("SELECT COUNT(*) AS count FROM cockpit_events WHERE event_id='private_event'")[0]
        .count,
      1
    );
    return result;
  };
  const result = runner(database, () => source('Candidate'), {
    project: injectingProject,
  }).runOnce();
  assert.equal(result.errorCode, 'PRIVACY_CHECK_FAILED');
  assert.equal(
    new ManagementStore({ database }).query('SELECT title FROM management_topics')[0].title,
    'Good'
  );
});

test('total source failure persists sanitized aggregate error across restart', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Good')).runOnce();
  runner(database, () => {
    throw new Error('secret board customer-x');
  }).runOnce();
  const store = new ManagementStore({ database });
  assert.deepEqual(
    store.query('SELECT status,error_code FROM projection_runs ORDER BY rowid DESC LIMIT 1')[0],
    { status: 'failed', error_code: 'SOURCE_LOAD_FAILED' }
  );
  assert.deepEqual(store.query('SELECT source_id,error_code FROM projection_source_health'), [
    { source_id: 'aggregate', error_code: 'SOURCE_LOAD_FAILED' },
  ]);
  assert.equal(
    JSON.stringify(store.query('SELECT * FROM projection_source_health')).includes('customer-x'),
    false
  );
});

test('WAL snapshot activation is consistent, mode 0600 and leaves no stale sidecars', () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Old')).runOnce();
  const wal = spawnSync(
    'python3',
    [
      '-c',
      [
        'import sqlite3,sys',
        'con=sqlite3.connect(sys.argv[1])',
        "con.execute('PRAGMA journal_mode=WAL')",
        'con.execute("UPDATE management_topics SET title=\'Committed WAL\'")',
        'con.commit()',
      ].join(';'),
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(wal.status, 0, wal.stderr);
  assert.equal(runner(database, () => source('New')).runOnce().status, 'success');
  assert.equal(fs.statSync(database).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(`${database}-wal`), false);
  assert.equal(fs.existsSync(`${database}-shm`), false);
  assert.equal(
    new ManagementStore({ database }).query('PRAGMA integrity_check')[0].integrity_check,
    'ok'
  );
  assert.ok(
    new ManagementStore({ database }).query('SELECT COUNT(*) AS count FROM projection_runs')[0]
      .count >= 2
  );
});

test('WAL activation waits safely for a concurrent read transaction', async () => {
  const database = path.join(root(), 'management.db');
  runner(database, () => source('Old')).runOnce();
  spawnSync('python3', [
    '-c',
    "import sqlite3,sys; con=sqlite3.connect(sys.argv[1]); con.execute('PRAGMA journal_mode=WAL'); con.commit()",
    database,
  ]);
  const reader = spawn(
    'python3',
    [
      '-c',
      [
        'import sqlite3,sys,time',
        'con=sqlite3.connect(sys.argv[1])',
        "con.execute('BEGIN')",
        "con.execute('SELECT * FROM management_topics').fetchall()",
        "print('ready',flush=True)",
        'time.sleep(1)',
        'con.commit()',
      ].join(';'),
      database,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  await new Promise((resolve, reject) => {
    reader.stdout.once('data', resolve);
    reader.once('error', reject);
  });
  const readerExit = new Promise((resolve, reject) =>
    reader.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`reader ${code}`))))
  );
  const result = runner(database, () => source('New')).runOnce();
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.equal(
    new ManagementStore({ database }).query('PRAGMA integrity_check')[0].integrity_check,
    'ok'
  );
  await readerExit;
});
