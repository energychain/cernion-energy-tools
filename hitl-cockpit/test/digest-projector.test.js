'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManagementApi } = require('../lib/management-api');
const { projectDigestItems } = require('../lib/digest-projector');
const { loadProjectionSource, loadTasks } = require('../lib/kanban-source');
const { ManagementReader } = require('../lib/management-reader');
const { ManagementStore } = require('../lib/management-store');
const { buildProjection, project } = require('../lib/projector');

const tempDirectories = [];

afterEach(() => {
  while (tempDirectories.length) fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
});

function task(id, overrides = {}) {
  return {
    id,
    board: 'inbox',
    title: `Signal ${id}`,
    body: '',
    status: 'ready',
    created_at: 1700000000,
    comments: [],
    ...overrides,
  };
}

function source(items) {
  return {
    generatedAt: 1700000100,
    errors: [],
    boards: [{ board: 'inbox', count: items.length, items }],
  };
}

function createStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-projector-'));
  tempDirectories.push(directory);
  const store = new ManagementStore({ database: path.join(directory, 'management.db') });
  store.initialize();
  return store;
}

function createProductionBoard(home, board, tasks) {
  const boardDirectory = path.join(home, 'kanban', 'boards', board);
  fs.mkdirSync(boardDirectory, { recursive: true });
  const database = path.join(boardDirectory, 'kanban.db');
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
      task['status'], task.get('priority', 0), 'fixture', task.get('created_at', 1700000000),
      None, None, 'fixture', task.get('result'), task.get('block_kind'), task.get('project_id')
    ))
    for index, body in enumerate(task.get('comments', [])):
        con.execute('INSERT INTO task_comments VALUES (?,?,?,?)',
                    (task['id'], 'fixture', body, 1700000100 + index))
    for index, filename in enumerate(task.get('attachments', [])):
        con.execute('INSERT INTO task_attachments VALUES (?,?,?,?,?,?)',
                    (task['id'], 'attachment-' + str(index), filename,
                     'text/plain', 12, 1700000200 + index))
con.commit()
`;
  const result = spawnSync('python3', ['-c', script, database, JSON.stringify(tasks)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

test('projects ordinary noise into stable provenance-preserving digest observations', () => {
  const items = [
    task('newsletter', { title: 'Newsletter Energie', status: 'blocked' }),
    task('status-mail', { title: 'Ordinary status mail: all systems green', isNoise: true }),
    task('known-alert', { title: 'Known alert: certificate reminder', knownAlert: true }),
    task('duplicate', { title: 'Mirrored notification', duplicateOf: 'newsletter' }),
    task('technical-child', {
      title: 'Parse attachment from intake',
      technicalIntakeSubtask: true,
      parent_id: 'newsletter',
    }),
  ];

  const first = projectDigestItems(items);
  const second = projectDigestItems(items);

  assert.deepEqual(
    second.items.map((item) => item.digest_id),
    first.items.map((item) => item.digest_id)
  );
  assert.deepEqual(
    first.items.map((item) => item.category),
    ['newsletter', 'status_mail', 'known_alert', 'duplicate', 'technical_intake']
  );
  assert.deepEqual(
    first.items.map((item) => item.disposition),
    ['digest', 'digest', 'digest', 'source_only', 'auto_close_candidate']
  );
  assert.ok(first.items.every((item) => item.material === 0));
  assert.deepEqual(JSON.parse(first.items[0].provenance_json), {
    board: 'inbox',
    taskId: 'newsletter',
  });
  assert.equal(
    first.items[4].recommendation,
    'Review source state; do not auto-close or mutate it.'
  );
  assert.deepEqual(first.diagnostics, {
    considered: 5,
    projected: 5,
    material: 0,
    escalatable: 0,
    excludedPrivate: 0,
  });
});

test('material deviations override noise disposition while private data is excluded', () => {
  const projection = projectDigestItems([
    task('deviation', {
      title: 'Known alert changed materially',
      knownAlert: true,
      materialDeviation: true,
      deviationReasons: ['new_customer_impact'],
      status: 'blocked',
    }),
    task('private', {
      board: 'twl-netze-private',
      title: 'TWL raw private alert',
      isNoise: true,
      materialDeviation: true,
    }),
  ]);

  assert.equal(projection.items.length, 1);
  assert.equal(projection.items[0].disposition, 'escalate');
  assert.equal(projection.items[0].material, 1);
  assert.ok(JSON.parse(projection.items[0].reasons_json).includes('new_customer_impact'));
  assert.equal(JSON.stringify(projection).includes('TWL raw private alert'), false);
  assert.equal(projection.diagnostics.excludedPrivate, 1);
});

test('ordinary operational tasks mentioning digest terms remain governance decisions', () => {
  const titles = [
    'Investigate newsletter signup bug',
    'Fix digest generation endpoint',
    'Review alert routing implementation',
    'Improve monitoring dashboard',
  ];
  const projection = buildProjection(
    source(
      titles.map((title, index) =>
        task(`operational-${index}`, {
          title,
          status: 'blocked',
          block_kind: 'needs_input',
        })
      )
    )
  );

  assert.equal(projection.digestItems.length, 0);
  assert.deepEqual(
    projection.decisions.map((decision) => decision.source_task_id),
    ['operational-0', 'operational-1', 'operational-2', 'operational-3']
  );
});

test('explicit source semantics and routine subject wording enter the digest lane', () => {
  const projection = projectDigestItems([
    task('semantic-newsletter', {
      title: 'Energy update received',
      sourceType: 'newsletter',
    }),
    task('routine-monitoring', {
      title: 'Monitoring status: all systems green',
      body: 'Routine report; no action required.',
    }),
    task('operational-monitoring', { title: 'Investigate monitoring status bug' }),
  ]);

  assert.deepEqual(
    projection.items.map((item) => [item.source_task_id, item.category]),
    [
      ['semantic-newsletter', 'newsletter'],
      ['routine-monitoring', 'status_mail'],
    ]
  );
});

test('incremental projection removes stale digest rows without replacing preserved topics', () => {
  const store = createStore();
  project(
    store,
    source([
      task('reclassified', { title: 'Newsletter: routine update' }),
      task('private-now', { title: 'Digest: public update' }),
      task('deleted', { title: 'Known alert: routine reminder', knownAlert: true }),
    ])
  );
  const topicCount = store.query('SELECT count(*) AS count FROM management_topics')[0].count;
  assert.equal(store.query('SELECT count(*) AS count FROM digest_items')[0].count, 3);

  project(
    store,
    source([
      task('reclassified', { title: 'Investigate newsletter signup bug' }),
      task('private-now', {
        title: 'Digest: private update',
        sensitivity: 'twl-netze-private',
      }),
    ]),
    { incremental: true }
  );

  assert.equal(store.query('SELECT count(*) AS count FROM digest_items')[0].count, 0);
  assert.equal(
    store.query("SELECT count(*) AS count FROM projection_objects WHERE object_type='digest'")[0]
      .count,
    0
  );
  assert.equal(store.query('SELECT count(*) AS count FROM management_topics')[0].count, topicCount);
  assert.equal(
    store.query("SELECT count(*) AS count FROM projection_objects WHERE object_type='topic'")[0]
      .count,
    3
  );
});

test('digest lane suppresses noise decisions but keeps blocked material deviations escalatable', () => {
  const input = source([
    task('ordinary-noise', {
      title: 'Newsletter digest',
      status: 'blocked',
      block_kind: 'needs_input',
    }),
    task('material-alert', {
      title: 'Known alert materially changed',
      knownAlert: true,
      materialDeviation: true,
      deviationReasons: ['unexpected_external_impact'],
      status: 'blocked',
      block_kind: 'needs_input',
    }),
    task('material-observation', {
      title: 'Known alert changed but remains observable',
      knownAlert: true,
      materialDeviation: true,
      status: 'ready',
    }),
  ]);

  const projection = buildProjection(input);
  assert.equal(projection.digestItems.length, 3);
  assert.equal(projection.decisions.length, 1);
  assert.equal(projection.decisions[0].source_task_id, 'material-alert');
  assert.equal(projection.decisions[0].decision_class, 'risk_escalation');
  assert.equal(projection.decisions[0].classifier_label, 'RISK_ESCALATION');

  const store = createStore();
  const result = project(store, input);
  assert.equal(result.counts.digestItems, 3);
  assert.equal(store.query('SELECT count(*) AS count FROM digest_items')[0].count, 3);
  assert.equal(store.query('SELECT count(*) AS count FROM governance_decisions')[0].count, 1);
  assert.equal(
    store.query("SELECT count(*) AS count FROM projection_objects WHERE object_type='digest'")[0]
      .count,
    3
  );

  const digest = new ManagementReader({ database: store.database }).read('digest', { limit: 10 });
  assert.equal(digest.count, 3);
  assert.equal(digest.items[0].source_board, 'inbox');
  assert.ok(digest.items.every((item) => item.provenance.taskId));

  const api = createManagementApi({
    enabled: true,
    writeEnabled: false,
    shadowOnly: true,
    reader: new ManagementReader({ database: store.database }),
  });
  const response = api.handle(
    { method: 'GET' },
    new URL('http://localhost/api/management/digest?q=material')
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.count, 1);
});

test('production-shaped source markers suppress duplicate and technical intake decisions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-source-'));
  tempDirectories.push(directory);
  const hermesHome = path.join(directory, 'hermes');
  createProductionBoard(hermesHome, 'operations', [
    {
      id: 'duplicate-card',
      title: 'Mirrored notification',
      status: 'blocked',
      block_kind: 'needs_input',
      comments: ['DUPLICATE_OF: canonical-card'],
      attachments: ['notification.txt'],
    },
    {
      id: 'technical-child',
      title: 'Parse intake attachment',
      status: 'blocked',
      block_kind: 'needs_input',
      comments: ['TECHNICAL_INTAKE: true\nPARENT_TASK: canonical-card'],
      attachments: ['intake.eml'],
    },
    {
      id: 'ordinary-alert',
      title: 'Monitoring alert: certificate renewal in 30 days',
      status: 'blocked',
      block_kind: 'needs_input',
      comments: ['Routine reminder; expected and unchanged.'],
    },
    {
      id: 'critical-alert',
      title: 'Monitoring alert: production outage with customer impact',
      status: 'blocked',
      block_kind: 'needs_input',
      comments: ['Escalation requested; customers are affected.'],
    },
  ]);

  const loaded = loadProjectionSource({ hermesHome });
  assert.equal(loaded.count, 4);
  assert.equal(loaded.boards[0].items[0].duplicateOf, undefined);
  assert.ok(loaded.boards[0].items.every((item) => Array.isArray(item.comments)));
  assert.ok(loaded.boards[0].items.every((item) => Array.isArray(item.attachments)));

  const projection = buildProjection(loaded);
  assert.deepEqual(
    projection.digestItems.map((item) => [item.source_task_id, item.category, item.disposition]),
    [
      ['critical-alert', 'known_alert', 'escalate'],
      ['duplicate-card', 'duplicate', 'source_only'],
      ['ordinary-alert', 'known_alert', 'digest'],
      ['technical-child', 'technical_intake', 'auto_close_candidate'],
    ]
  );
  assert.deepEqual(
    projection.decisions.map((decision) => [
      decision.source_task_id,
      decision.decision_class,
      decision.classifier_label,
    ]),
    [['critical-alert', 'risk_escalation', 'RISK_ESCALATION']]
  );

  const legacy = loadTasks({ hermesHome });
  assert.equal(legacy.boards, undefined);
  assert.equal(legacy.count, 4);
  assert.ok(legacy.items.every((item) => item.status === 'blocked'));
});

test('strong production deviations override alert noise without synthetic metadata', () => {
  const cases = [
    ['critical-security', 'Monitoring alert: critical security incident'],
    ['outage', 'Monitoring alert: production outage'],
    ['customer-impact', 'Monitoring alert: customers are affected'],
    ['deadline', 'Monitoring alert: regulatory deadline is at risk'],
    ['financial', 'Monitoring alert: material financial loss'],
    ['severity-marker', 'Monitoring alert', 'SEVERITY: CRITICAL'],
    ['material-marker', 'Monitoring alert', 'MATERIAL_DEVIATION: true'],
  ];
  const items = cases.map(([id, title, comment]) =>
    task(id, {
      title,
      status: 'blocked',
      block_kind: 'needs_input',
      comments: comment ? [{ author: 'ops', body: comment, created_at: 1700000001 }] : [],
      attachments: [],
    })
  );
  items.push(
    task('ordinary', {
      title: 'Monitoring alert: certificate renewal in 30 days',
      status: 'blocked',
      block_kind: 'needs_input',
      attachments: [],
    })
  );

  for (const item of items) {
    assert.equal(item.materialDeviation, undefined);
    assert.equal(item.knownAlert, undefined);
  }
  const projection = buildProjection(source(items));
  assert.equal(projection.digestItems.length, 8);
  assert.equal(projection.decisions.length, 7);
  assert.ok(
    projection.decisions.every((decision) => decision.decision_class === 'risk_escalation')
  );
  assert.ok(
    projection.decisions.every((decision) => decision.classifier_label === 'RISK_ESCALATION')
  );
  assert.equal(
    projection.decisions.some((decision) => decision.source_task_id === 'ordinary'),
    false
  );
});
