'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { projectTopics } = require('../lib/topic-projector');

function task(board, id, overrides = {}) {
  return {
    id,
    board,
    title: `Task ${id}`,
    body: '',
    result: '',
    assignee: 'Felix',
    status: 'ready',
    created_at: 1700000000,
    comments: [],
    attachments: [],
    ...overrides,
  };
}

function refs(topic) {
  return JSON.parse(topic.source_task_refs_json);
}

test('explicit hashtag and parent references aggregate related child tasks', () => {
  const tasks = [
    task('sales', 't_parent01', { title: 'Willi-Mako Pilot #WilliPilot' }),
    task('devops', 't_child001', {
      title: 'Landingpage #WilliPilot',
      assignee: 'DevOps',
    }),
    task('finance', 't_child002', {
      title: 'Kalkulation',
      body: 'PARENT_TASK: t_parent01',
      assignee: 'Anja',
    }),
  ];
  const result = projectTopics(tasks);
  assert.equal(result.topics.length, 1);
  assert.equal(refs(result.topics[0]).length, 3);
  assert.deepEqual(JSON.parse(result.topics[0].participating_agents_json), [
    'Anja',
    'DevOps',
    'Felix',
  ]);
  assert.equal(result.diagnostics.uncertainAutoMergeCount, 0);
});

test('artifact registry topic is a strong link while private artifacts are ignored', () => {
  const tasks = [task('sales', 't_art0001'), task('web', 't_art0002'), task('other', 't_private')];
  const result = projectTopics(tasks, {
    artifactRegistry: {
      artifacts: [
        { kanban_task: 't_art0001', topic: '#CETPilot', sensitivity: 'internal' },
        { kanban_task: 't_art0002', topic: '#CETPilot', sensitivity: 'public-candidate' },
        { kanban_task: 't_private', topic: '#CETPilot', sensitivity: 'twl-private' },
      ],
    },
  });
  assert.equal(result.topics.length, 2);
  assert.ok(result.topics.some((topic) => refs(topic).length === 2));
  assert.ok(result.topics.some((topic) => refs(topic)[0].taskId === 't_private'));
});

test('covered scope source and explicit conversation references aggregate cases', () => {
  const source = task('sales', 't_scope001', { title: 'Offer scope source' });
  const child = task('web', 't_scope002', {
    title: 'Publish follow-up',
    scopeDecision: {
      state: 'covered',
      matches: [
        {
          scopeId: 'scope_1',
          sourceBoard: 'sales',
          sourceTaskId: 't_scope001',
        },
      ],
    },
  });
  const crmA = task('sales', 't_crm0001', { body: 'CRM: LEAD-928271 follow-up' });
  const crmB = task('finance', 't_crm0002', { body: 'CASE: LEAD-928271 billing check' });
  const result = projectTopics([source, child, crmA, crmB]);
  assert.equal(result.topics.length, 2);
  assert.deepEqual(result.topics.map((topic) => refs(topic).length).sort(), [2, 2]);
});

test('uncertain same-title fingerprints stay separate and are only reported', () => {
  const title = 'Prüfe aktuellen Status für Kundenprojekt Nord';
  const result = projectTopics([
    task('sales', 't_uncert01', { title }),
    task('sales', 't_uncert02', { title }),
  ]);
  assert.equal(result.topics.length, 2);
  assert.equal(result.diagnostics.uncertainMatches.length, 1);
  assert.equal(result.diagnostics.uncertainMatches[0].autoMerged, false);
  assert.equal(result.diagnostics.uncertainAutoMergeCount, 0);
});

test('a covered scope with an absent source task does not cause a speculative merge', () => {
  const result = projectTopics([
    task('web', 't_orphan01', {
      scopeDecision: {
        state: 'covered',
        matches: [{ scopeId: 'scope_missing', sourceBoard: 'sales', sourceTaskId: 't_missing1' }],
      },
    }),
    task('web', 't_orphan02', { title: 'Unrelated task' }),
  ]);
  assert.equal(result.topics.length, 2);
  assert.equal(result.diagnostics.mergedTaskCount, 0);
});

test('generic reference words and oversized hashtag groups are never auto-merged', () => {
  const generic = [
    task('sales', 't_generic1', { body: 'CRM: Kontakt prüfen' }),
    task('sales', 't_generic2', { body: 'CRM: Kontakt aktualisieren' }),
  ];
  const broad = Array.from({ length: 4 }, (_, index) =>
    task('sales', `t_broad0${index}`, { title: `Signal ${index} #BroadTheme` })
  );
  const result = projectTopics([...generic, ...broad], {
    topicRules: { maximumHashtagGroupSize: 3, maximumTopicSize: 3 },
  });
  assert.equal(result.topics.length, 6);
  assert.equal(result.diagnostics.uncertainAutoMergeCount, 0);
  assert.ok(
    result.diagnostics.uncertainMatches.some((item) => item.reason === 'hashtag_too_broad')
  );
});
