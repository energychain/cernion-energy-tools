'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const cockpitRoot = path.resolve(__dirname, '..');
const fixture = require('./fixtures/current-api-tasks.json');

let child;
let tempRoot;
let baseUrl;
let fakeLog;
const token = 'ap0-contract-token';

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function createBoard(home, board, tasks) {
  const boardDir = path.join(home, 'kanban', 'boards', board);
  fs.mkdirSync(boardDir, { recursive: true });
  const database = path.join(boardDir, 'kanban.db');
  const script = `
import json, sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.executescript('''
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT, body TEXT, assignee TEXT, status TEXT,
  priority INTEGER, created_by TEXT, created_at INTEGER, started_at INTEGER,
  completed_at INTEGER, tenant TEXT, result TEXT, block_kind TEXT, project_id TEXT
);
CREATE TABLE task_comments (task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
CREATE TABLE task_attachments (
  task_id TEXT, id TEXT, filename TEXT, content_type TEXT, size INTEGER, created_at INTEGER
);
''')
for task in json.loads(sys.argv[2]):
    con.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
      task['id'], task['title'], task.get('body', ''), task.get('assignee'),
      task['status'], task.get('priority', 0), 'fixture', 1700000000,
      None, None, 'fixture', None, task.get('block_kind'), None
    ))
con.commit()
`;
  const result = spawnSync('python3', ['-c', script, database, JSON.stringify(tasks)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

async function request(pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const result = await request('/api/health');
      if (result.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error('cockpit did not become healthy');
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-cockpit-ap0-'));
  const hermesHome = path.join(tempRoot, 'hermes');
  fakeLog = path.join(tempRoot, 'hermes-calls.jsonl');
  createBoard(hermesHome, 'fixture-board', [
    { id: 't_blocked01', title: 'Blocked', status: 'blocked', block_kind: 'needs_input' },
    {
      id: 't_scheduled1',
      title: 'Scheduled input',
      status: 'scheduled',
      block_kind: 'needs_input',
    },
    { id: 't_scheduled2', title: 'Scheduled no input', status: 'scheduled', block_kind: null },
    { id: 't_ready001', title: 'Ready', status: 'ready', block_kind: null },
  ]);
  createBoard(hermesHome, 'twl-netze-private', [
    { id: 't_private01', title: 'Private', status: 'blocked', block_kind: 'needs_input' },
  ]);

  const fakeHermes = path.join(tempRoot, 'fake-hermes.js');
  fs.writeFileSync(
    fakeHermes,
    `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.HERMES_FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('stubbed');\n`
  );
  fs.chmodSync(fakeHermes, 0o700);

  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: cockpitRoot,
    env: {
      ...process.env,
      HITL_COCKPIT_HOST: '127.0.0.1',
      HITL_COCKPIT_PORT: String(port),
      HITL_COCKPIT_TOKEN: token,
      HITL_COCKPIT_ALLOW_LEGACY_BEARER: 'true',
      HITL_COCKPIT_EXCLUDE_BOARDS: 'twl-netze-private',
      HERMES_HOME: hermesHome,
      HERMES_BIN: fakeHermes,
      HERMES_FAKE_LOG: fakeLog,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('sanitized production fixture defines the legacy contract', () => {
  assert.equal(fixture.sensitiveContentIncluded, false);
  assert.deepEqual(fixture.contract.actions, ['approve', 'reject', 'question', 'close']);
  assert.equal(fixture.productionObservation.apiTasksStatus, 200);
  assert.ok(fixture.contract.itemFields.includes('comments'));
  assert.ok(fixture.contract.itemFields.includes('attachments'));
});

test('GET /api/health preserves the service contract and authentication', async () => {
  const unauthorized = await fetch(baseUrl + '/api/health');
  assert.equal(unauthorized.status, 401);

  const { status, body } = await request('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'agentos-hitl-cockpit');
  assert.deepEqual(body.excludedBoards, ['twl-netze-private']);
});

test('management cockpit defaults off while legacy navigation stays available', async () => {
  const config = await request('/api/management/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.enabled, false);
  assert.equal(config.body.writeEnabled, false);
  assert.equal(config.body.shadowOnly, true);
  assert.equal(config.body.defaultView, 'legacy');
  assert.equal((await request('/management')).status, 404);
  assert.equal((await request('/')).status, 200);
});

test('GET /api/tasks includes only waiting cards and excludes private boards', async () => {
  const { status, body } = await request('/api/tasks');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.count, 2);
  assert.deepEqual(
    body.items.map((item) => [item.id, item.status, item.block_kind]),
    [
      ['t_blocked01', 'blocked', 'needs_input'],
      ['t_scheduled1', 'scheduled', 'needs_input'],
    ]
  );
  assert.ok(body.items.every((item) => item.board === 'fixture-board'));
  assert.deepEqual(body.excludedBoards, ['twl-netze-private']);
});

test('legacy approve, reject, question and close action routes remain callable', async () => {
  const taskPath = '/api/tasks/fixture-board/t_blocked01';
  const actions = [
    ['approve', {}],
    ['reject', { comment: 'revise' }],
    ['question', { comment: 'clarify' }],
    ['close', {}],
  ];

  for (const [action, payload] of actions) {
    const { status, body } = await request(`${taskPath}/${action}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(status, 200, `${action}: ${JSON.stringify(body)}`);
    assert.equal(body.ok, true);
    assert.equal(body.action, action);
  }

  const calls = fs
    .readFileSync(fakeLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const commandNames = calls.map((args) => args[3]);
  assert.deepEqual(commandNames, ['unblock', 'comment', 'comment', 'complete']);
  assert.ok(calls.every((args) => args[0] === 'kanban' && args[1] === '--board'));
});
