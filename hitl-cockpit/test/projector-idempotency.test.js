'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManagementStore } = require('../lib/management-store');
const { buildProjection, project } = require('../lib/projector');

const tempDirectories = [];

afterEach(() => {
  while (tempDirectories.length) fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
});

function createStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'projector-'));
  tempDirectories.push(directory);
  const store = new ManagementStore({ database: path.join(directory, 'management.db') });
  store.initialize();
  return store;
}

function task(board, id, overrides = {}) {
  return {
    id,
    board,
    title: `${board} ${id}`,
    body: '',
    assignee: 'fixture-agent',
    status: 'ready',
    priority: 0,
    created_by: 'fixture',
    created_at: 1700000000,
    started_at: null,
    completed_at: null,
    tenant: 'fixture',
    result: null,
    block_kind: null,
    project_id: null,
    comments: [],
    attachments: [],
    reversibleInternal: true,
    ...overrides,
  };
}

function source(boardItems, errors = []) {
  return {
    errors,
    boards: Object.entries(boardItems).map(([board, items]) => ({
      board,
      count: items.length,
      items,
    })),
  };
}

test('full rebuild and incremental projection use deterministic ids without duplicates', () => {
  const store = createStore();
  const input = source({
    active: [task('active', 't_active01')],
    blocked: [task('blocked', 't_blocked01', { status: 'blocked', block_kind: 'needs_input' })],
    completed: [
      task('completed', 't_done0001', {
        status: 'done',
        result: [
          'OUTCOME_TYPE: release_live',
          'OUTCOME_STATEMENT: Release produktiv veröffentlicht',
          'OUTCOME_EVIDENCE: https://example.org/releases/4711',
        ].join('\n'),
        completed_at: 1700000300,
        reversibleInternal: false,
      }),
    ],
    planned: [
      task('planned', 't_plan0001', {
        status: 'scheduled',
        reversibleInternal: false,
        wakeup: { wakeAt: 1800000000, whyScheduled: 'review date', nextAction: 'review' },
      }),
    ],
  });

  const first = buildProjection(input);
  project(store, input);
  project(store, input);
  const second = buildProjection(input);
  assert.deepEqual(
    second.topics.map((row) => row.topic_id),
    first.topics.map((row) => row.topic_id)
  );
  assert.deepEqual(
    second.decisions.map((row) => row.decision_id),
    first.decisions.map((row) => row.decision_id)
  );
  assert.deepEqual(
    second.outcomes.map((row) => row.outcome_id),
    first.outcomes.map((row) => row.outcome_id)
  );
  assert.equal(store.query('SELECT count(*) AS count FROM management_topics')[0].count, 4);
  assert.equal(store.query('SELECT count(*) AS count FROM governance_decisions')[0].count, 1);
  assert.equal(store.query('SELECT count(*) AS count FROM outcomes')[0].count, 1);
  assert.equal(store.query('SELECT count(*) AS count FROM wakeups')[0].count, 1);
  assert.equal(store.query('SELECT count(*) AS count FROM agent_briefs')[0].count, 7);
  assert.equal(first.agentBriefs.length, 7);
  assert.equal(
    first.topics.find((row) => row.title === 'completed t_done0001')?.last_substantive_progress_at,
    null,
    'a technical release without counterparty or economic evidence is not substantive progress'
  );

  const incremental = source({
    active: [
      task('active', 't_active01', { title: 'Updated internal task', created_at: 1700000400 }),
    ],
  });
  project(store, incremental, { incremental: true });
  assert.equal(store.query('SELECT count(*) AS count FROM management_topics')[0].count, 4);
  assert.equal(
    store.query(
      "SELECT title FROM management_topics WHERE source_task_refs_json LIKE '%t_active01%'"
    )[0].title,
    'Updated internal task'
  );
});

test('a broken board does not destroy its last valid projection', () => {
  const store = createStore();
  project(
    store,
    source({
      healthy: [task('healthy', 't_health01')],
      fragile: [task('fragile', 't_fragile1')],
    })
  );

  project(
    store,
    source({ healthy: [task('healthy', 't_health02')] }, [
      { board: 'fragile', error: 'file is not a database' },
    ])
  );

  const refs = store
    .query('SELECT source_task_refs_json FROM management_topics ORDER BY source_task_refs_json')
    .map((row) => row.source_task_refs_json);
  assert.equal(refs.length, 2);
  assert.ok(refs.some((value) => value.includes('t_fragile1')));
  assert.ok(refs.some((value) => value.includes('t_health02')));
  assert.ok(!refs.some((value) => value.includes('t_health01')));
});

test('aggregated topics retain every source mapping and decisions keep a primary source', () => {
  const store = createStore();
  const input = source({
    sales: [
      task('sales', 't_case0001', {
        title: 'CET Pilot #CETPilotNord',
        status: 'blocked',
        block_kind: 'needs_input',
      }),
    ],
    devops: [task('devops', 't_case0002', { title: 'Release #CETPilotNord' })],
  });

  const result = project(store, input);
  assert.equal(result.projection.topics.length, 1);
  assert.equal(result.projection.decisions.length, 1);
  assert.equal(result.projection.decisions[0].topic_id, result.projection.topics[0].topic_id);
  assert.equal(result.projection.decisions[0].source_task_id, 't_case0001');
  assert.equal(JSON.parse(result.projection.topics[0].source_task_refs_json).length, 2);
  assert.equal(
    store.query("SELECT count(*) AS count FROM projection_objects WHERE object_type='topic'")[0]
      .count,
    2
  );

  project(store, input);
  assert.equal(store.query('SELECT count(*) AS count FROM management_topics')[0].count, 1);
  assert.equal(store.query('SELECT count(*) AS count FROM governance_decisions')[0].count, 1);

  project(
    store,
    source({
      devops: [task('devops', 't_case0002', { title: 'Updated child without topic marker' })],
    }),
    { incremental: true }
  );
  const topics = store.query('SELECT title,source_task_refs_json FROM management_topics');
  assert.equal(topics.length, 1);
  assert.equal(topics[0].title, 'Updated child without topic marker');
  assert.equal(JSON.parse(topics[0].source_task_refs_json).length, 2);
});
