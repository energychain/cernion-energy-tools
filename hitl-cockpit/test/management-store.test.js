'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ManagementStore } = require('../lib/management-store');
const { classifyShadow } = require('../lib/projector');

const tempDirectories = [];

function tempDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'management-store-'));
  tempDirectories.push(directory);
  return path.join(directory, 'management.db');
}

afterEach(() => {
  while (tempDirectories.length) {
    fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
  }
});

test('migration is atomic and records PRAGMA user_version', () => {
  const database = tempDatabase();
  const store = new ManagementStore({ database });
  assert.deepEqual(store.initialize(), { schemaVersion: 5 });
  assert.equal(store.query('PRAGMA user_version')[0].user_version, 5);
  const tables = store
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map((row) => row.name);
  assert.ok(tables.includes('management_topics'));
  assert.ok(tables.includes('classification_audit'));
  assert.ok(tables.includes('digest_items'));

  const brokenDatabase = tempDatabase();
  const brokenStore = new ManagementStore({
    database: brokenDatabase,
    schema: 'CREATE TABLE should_rollback (id TEXT);\nINVALID SQL;\nPRAGMA user_version = 1;',
  });
  assert.throws(() => brokenStore.initialize(), /syntax error/);
  const probe = new ManagementStore({ database: brokenDatabase });
  assert.equal(probe.query('PRAGMA user_version')[0].user_version, 5);
  assert.equal(
    probe.query("SELECT count(*) AS count FROM sqlite_master WHERE name='should_rollback'")[0]
      .count,
    0
  );
});

test('schema v4 upgrades to v5 without duplicate-column failure', () => {
  const database = tempDatabase();
  const store = new ManagementStore({ database });
  store.initialize();
  const downgrade = spawnSync(
    'python3',
    [
      '-c',
      'import sqlite3,sys; con=sqlite3.connect(sys.argv[1]); con.execute("PRAGMA user_version=4"); con.commit()',
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(downgrade.status, 0, downgrade.stderr);
  assert.deepEqual(store.initialize(), { schemaVersion: 5 });
  assert.equal(store.query('PRAGMA user_version')[0].user_version, 5);
  assert.equal(
    store.query(
      "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='digest_items'"
    )[0].count,
    1
  );
});

test('shadow classification writes only classification_audit', () => {
  const store = new ManagementStore({ database: tempDatabase() });
  store.initialize();
  const before = Object.fromEntries(
    ['management_topics', 'governance_decisions', 'outcomes', 'wakeups'].map((table) => [
      table,
      store.query(`SELECT count(*) AS count FROM ${table}`)[0].count,
    ])
  );
  const source = {
    errors: [],
    boards: [
      {
        board: 'research',
        items: [
          {
            id: 't_shadow01',
            board: 'research',
            title: 'Interne Recherche',
            status: 'ready',
            reversibleInternal: true,
            created_at: 1700000000,
          },
        ],
      },
      {
        board: 'twl-netze-private',
        items: [
          {
            id: 't_private01',
            board: 'twl-netze-private',
            title: 'raw private',
            status: 'blocked',
            created_at: 1700000001,
          },
        ],
      },
    ],
  };
  assert.equal(classifyShadow(store, source).written, 1);
  assert.deepEqual(store.query('SELECT source_board,label FROM classification_audit'), [
    { source_board: 'research', label: 'AUTO_EXECUTE' },
  ]);
  const after = Object.fromEntries(
    Object.keys(before).map((table) => [
      table,
      store.query(`SELECT count(*) AS count FROM ${table}`)[0].count,
    ])
  );
  assert.deepEqual(after, before);
});

test('schema v1 source mappings migrate through v5 digest, context links and agent briefs', () => {
  const database = tempDatabase();
  const setup = spawnSync(
    'python3',
    [
      '-c',
      [
        'import sqlite3,sys',
        'con=sqlite3.connect(sys.argv[1])',
        "con.execute('CREATE TABLE projection_objects (object_type TEXT NOT NULL, object_id TEXT NOT NULL, source_board TEXT NOT NULL, source_task_id TEXT NOT NULL, PRIMARY KEY(object_type,object_id))')",
        "con.execute(\"INSERT INTO projection_objects VALUES ('topic','topic_old','sales','t_old001')\")",
        "con.execute('PRAGMA user_version=1')",
        'con.commit()',
      ].join(';'),
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(setup.status, 0, setup.stderr);

  const store = new ManagementStore({ database });
  assert.deepEqual(store.initialize(), { schemaVersion: 5 });
  assert.deepEqual(store.query('SELECT * FROM projection_objects'), [
    {
      object_type: 'topic',
      object_id: 'topic_old',
      source_board: 'sales',
      source_task_id: 't_old001',
    },
  ]);
  const primaryKeyColumns = store
    .query('PRAGMA table_info(projection_objects)')
    .filter((column) => column.pk > 0)
    .map((column) => column.name);
  assert.deepEqual(primaryKeyColumns, [
    'object_type',
    'object_id',
    'source_board',
    'source_task_id',
  ]);
  const briefColumns = store.query('PRAGMA table_info(agent_briefs)').map((column) => column.name);
  assert.ok(briefColumns.includes('brief_status'));
  assert.ok(briefColumns.includes('empty_state_reason'));
  const decisionColumns = store
    .query('PRAGMA table_info(governance_decisions)')
    .map((column) => column.name);
  assert.ok(decisionColumns.includes('source_refs_json'));
});
