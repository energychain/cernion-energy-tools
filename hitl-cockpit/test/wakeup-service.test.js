'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { ManagementReader } = require('../lib/management-reader');
const { ManagementStore } = require('../lib/management-store');
const { analyzeWakeups, evaluateWakeup, validateWakeupContract } = require('../lib/wakeup-service');

const roots = [];
const NOW = 1800000000;

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function scheduled(id, wakeup = {}, overrides = {}) {
  return {
    id,
    board: 'fixture',
    title: `Scheduled ${id}`,
    body: '',
    assignee: 'Rhajaina',
    status: 'scheduled',
    created_at: 1700000000,
    comments: [],
    wakeup,
    ...overrides,
  };
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('wakeup contract requires time, reason, next action and owner', () => {
  assert.deepEqual(validateWakeupContract(scheduled('missing')).errors, [
    'wake_at_required',
    'why_scheduled_required',
    'next_action_on_wake_required',
  ]);
  const complete = validateWakeupContract(
    scheduled('complete', {
      wakeAt: NOW + 60,
      whyScheduled: 'Kundenantwort abwarten',
      nextAction: 'Antwort prüfen',
      owner: 'Felix',
    })
  );
  assert.equal(complete.valid, true);
  assert.equal(complete.contract.owner, 'Felix');
});

test('future wakeups stay hidden and due dates expose reason and next action', () => {
  const future = evaluateWakeup(
    scheduled('future', {
      wakeAt: NOW + 60,
      whyScheduled: 'Termin erreicht',
      nextAction: 'Lage prüfen',
    }),
    { now: NOW }
  );
  assert.equal(future.state, 'scheduled');
  assert.equal(future.visible, false);
  assert.equal(future.shouldMutateSource, false);

  const due = evaluateWakeup(
    scheduled('due', {
      wakeAt: NOW - 1,
      whyScheduled: 'Budgettermin erreicht',
      nextAction: 'Budgetentscheidung vorbereiten',
      owner: 'Anja',
    }),
    { now: NOW }
  );
  assert.equal(due.state, 'due');
  assert.equal(due.visible, true);
  assert.equal(due.reason, 'Budgettermin erreicht');
  assert.equal(due.nextAction, 'Budgetentscheidung vorbereiten');
  assert.equal(due.owner, 'Anja');
});

test('signal-gated wakeups require a new signal and never mutate the source', () => {
  const waiting = evaluateWakeup(
    scheduled('waiting', {
      wakeAt: NOW - 100,
      whyScheduled: 'Auf Antwort warten',
      nextAction: 'Antwort bewerten',
      signalRequired: 'customer_reply',
      lastWokenAt: NOW - 200,
    }),
    { now: NOW }
  );
  assert.equal(waiting.state, 'awaiting_signal');
  assert.equal(waiting.visible, false);

  const signalled = evaluateWakeup(
    scheduled('signalled', {
      wakeAt: NOW - 100,
      whyScheduled: 'Auf Antwort warten',
      nextAction: 'Antwort bewerten',
      signalRequired: 'customer_reply',
      lastWokenAt: NOW - 200,
      lastSignalAt: NOW - 50,
    }),
    { now: NOW }
  );
  assert.equal(signalled.state, 'due');
  assert.equal(signalled.newSignalAt, NOW - 50);
  assert.equal(signalled.shouldMutateSource, false);
});

test('repeated wakeup without a state change is a quality error', () => {
  const task = scheduled(
    'repeat',
    {
      wakeAt: NOW - 100,
      whyScheduled: 'Erneut prüfen',
      nextAction: 'Lage prüfen',
      wakeCount: 2,
      lastWokenAt: NOW - 20,
      sourceUpdatedAt: NOW - 50,
    },
    { updated_at: NOW - 50 }
  );
  const result = evaluateWakeup(task, { now: NOW });
  assert.equal(result.state, 'quality_error');
  assert.equal(result.qualityError, 'repeated_wakeup_without_state_change');
});

test('historical scheduled tasks are reported but never reactivated', () => {
  const result = analyzeWakeups(
    [
      scheduled('historical'),
      scheduled('future', {
        wakeAt: NOW + 100,
        whyScheduled: 'Termin',
        nextAction: 'Prüfen',
      }),
    ],
    { now: NOW }
  );
  assert.equal(result.historicalWithoutContract.length, 1);
  assert.equal(result.due.length, 0);
  assert.equal(result.sourceMutationCount, 0);
  assert.equal(result.readOnly, true);
});

test('management overview hides scheduled topics before wake_at', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-overview-'));
  roots.push(root);
  const database = path.join(root, 'management.db');
  const store = new ManagementStore({ database });
  store.initialize();
  const topic = (id, expectedProgressAt) => ({
    topic_id: id,
    title: id,
    business_goal: null,
    owner_agent: 'Rhajaina',
    participating_agents_json: '[]',
    current_state: 'scheduled',
    next_step: 'Prüfen',
    expected_progress_at: expectedProgressAt,
    impact_statement: null,
    last_substantive_progress_at: 1,
    matrix_room_ref: null,
    artifact_refs_json: '[]',
    source_task_refs_json: JSON.stringify([{ board: 'fixture', taskId: `t_${id}` }]),
    sensitivity: 'internal',
    updated_at: 1,
  });
  store.applyProjection({
    replaceBoards: [],
    topics: [topic('future', 4102444800), topic('due', 1), topic('legacy', null)],
    decisions: [],
    outcomes: [],
    wakeups: [],
    objects: [],
    boards: [],
  });
  const overview = new ManagementReader({ database }).read('overview');
  assert.deepEqual(
    overview.activeTopics.map((item) => item.topic_id),
    ['due']
  );
});

test('process-wakeups reads a board database without changing it and writes only a migration report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wakeup-cli-'));
  roots.push(root);
  const boardDirectory = path.join(root, 'kanban', 'boards', 'fixture');
  fs.mkdirSync(boardDirectory, { recursive: true });
  const database = path.join(boardDirectory, 'kanban.db');
  const setup = spawnSync(
    'python3',
    [
      '-c',
      [
        'import sqlite3,sys',
        'db=sys.argv[1]',
        'con=sqlite3.connect(db)',
        "con.execute('CREATE TABLE tasks (id TEXT,title TEXT,body TEXT,assignee TEXT,status TEXT,priority INTEGER,created_by TEXT,created_at INTEGER,started_at INTEGER,completed_at INTEGER,tenant TEXT,result TEXT,block_kind TEXT,project_id TEXT)')",
        "con.execute('CREATE TABLE task_comments (task_id TEXT,author TEXT,body TEXT,created_at INTEGER)')",
        "con.execute('CREATE TABLE task_attachments (id TEXT,task_id TEXT,filename TEXT,content_type TEXT,size INTEGER,created_at INTEGER)')",
        "con.execute(\"INSERT INTO tasks VALUES ('t_legacy','Historisch','', 'Rhajaina','scheduled',0,'test',1700000000,NULL,NULL,'fixture',NULL,NULL,NULL)\")",
        'con.commit()',
      ].join(';'),
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(setup.status, 0, setup.stderr);
  const before = { checksum: checksum(database), stat: fs.statSync(database) };
  const report = path.join(root, 'reports', 'migration.json');
  const cli = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../bin/process-wakeups.js'),
      '--hermes-home',
      root,
      '--now',
      String(NOW),
      '--migration-report',
      report,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(cli.status, 0, cli.stderr);
  const output = JSON.parse(cli.stdout);
  assert.equal(output.historicalWithoutContract.length, 1);
  assert.equal(output.sourceMutationCount, 0);
  assert.equal(checksum(database), before.checksum);
  assert.equal(fs.statSync(database).mtimeMs, before.stat.mtimeMs);
  const migration = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(migration.count, 1);
  assert.equal(migration.readOnly, true);
  assert.equal(fs.statSync(report).mode & 0o777, 0o600);
});
