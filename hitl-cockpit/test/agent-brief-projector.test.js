'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  hasBusinessProgress,
  isTechnicalActivity,
  projectAgentBriefs,
} = require('../lib/agent-brief-projector');
const { buildProjection } = require('../lib/projector');

const NOW = 1800000000;

function task(board, id, overrides = {}) {
  return {
    id,
    board,
    title: `Task ${id}`,
    body: '',
    result: '',
    assignee: 'felix',
    status: 'ready',
    created_at: NOW - 3600,
    comments: [],
    ...overrides,
  };
}

function topic(id, owner, refs, overrides = {}) {
  return {
    topic_id: id,
    title: `Topic ${id}`,
    business_goal: null,
    owner_agent: owner,
    participating_agents_json: JSON.stringify([owner]),
    current_state: 'running',
    next_step: null,
    expected_progress_at: null,
    last_substantive_progress_at: NOW - 1800,
    source_task_refs_json: JSON.stringify(refs),
    updated_at: NOW - 1800,
    ...overrides,
  };
}

function outcome(id, topicId, type, overrides = {}) {
  return {
    outcome_id: id,
    topic_id: topicId,
    source_board: 'sales',
    source_task_id: 't_source1',
    outcome_type: type,
    statement: `Outcome ${id}`,
    evidence_refs_json: JSON.stringify([`message-id:${id}`]),
    occurred_at: NOW - 900,
    counterparty: null,
    economic_relevance: null,
    confidence: 1,
    ...overrides,
  };
}

function decision(id, topicId, overrides = {}) {
  return {
    decision_id: id,
    topic_id: topicId,
    source_board: 'sales',
    source_task_id: 't_source1',
    decision_class: 'governance',
    question: 'Preis festlegen?',
    reason_human_required: 'Preis bindet das Angebot',
    recommendation: 'Option B',
    options_json: JSON.stringify(['A', 'B']),
    consequences_json: JSON.stringify(['A reduziert Umfang', 'B hält Pilotumfang']),
    non_decision_effect: 'Angebot bleibt blockiert',
    classifier_label: 'DECISION_REQUIRED',
    deadline: null,
    updated_at: NOW - 600,
    ...overrides,
  };
}

function config() {
  return {
    reportingPeriodDays: 7,
    maximumTopicsPerBrief: 5,
    agents: [
      {
        id: 'Felix',
        aliases: ['felix'],
        mandateGoal: 'Vertrieb wirksam entwickeln.',
      },
      {
        id: 'DevOps',
        aliases: ['devops'],
        mandateGoal: 'Produktqualität sichern.',
      },
      {
        id: 'Anja',
        aliases: ['anja'],
        mandateGoal: 'Finanzen bearbeiten.',
      },
    ],
  };
}

function project(input) {
  return projectAgentBriefs(input, { now: NOW, agentConfig: config() });
}

function brief(result, id) {
  return result.briefs.find((item) => item.agent_id === id);
}

test('business outcomes qualify progress and provide material evidence', () => {
  const input = {
    tasks: [
      task('sales', 't_sales01', {
        body: 'BUSINESS_GOAL: Pilot in einen Kundendialog überführen\nNEXT_ACTION: Termin bestätigen',
      }),
    ],
    topics: [
      topic('topic_sales', 'Felix', [{ board: 'sales', taskId: 't_sales01' }], {
        next_step: 'Termin bestätigen',
      }),
    ],
    outcomes: [
      outcome('outcome_reply', 'topic_sales', 'human_reply_received', {
        counterparty: 'Kunde Nord',
      }),
    ],
    decisions: [],
    wakeups: [],
  };
  const result = project(input);
  const felix = brief(result, 'Felix');
  assert.equal(felix.brief_status, 'current');
  assert.equal(felix.current_goal, 'Pilot in einen Kundendialog überführen');
  assert.equal(felix.last_substantive_progress_at, NOW - 900);
  assert.deepEqual(JSON.parse(felix.evidence_refs_json), ['message-id:outcome_reply']);
  assert.equal(JSON.parse(felix.outcomes_json)[0].progressQualified, true);
});

test('pure technical activity stays visible but never becomes substantive progress', () => {
  const input = {
    tasks: [
      task('devops', 't_tech001', {
        assignee: 'devops',
        title: 'Cron Worker refactored and deployment restarted',
        status: 'done',
        completed_at: NOW - 1200,
      }),
    ],
    topics: [
      topic('topic_tech', 'devops', [{ board: 'devops', taskId: 't_tech001' }], {
        title: 'Scheduler refactoring',
      }),
    ],
    outcomes: [outcome('outcome_release', 'topic_tech', 'release_live')],
    decisions: [],
    wakeups: [],
  };
  const result = project(input);
  const devops = brief(result, 'DevOps');
  const topics = JSON.parse(devops.active_topic_refs_json);
  assert.equal(topics[0].progressClassification, 'technical_enabler_only');
  assert.equal(devops.brief_status, 'active_without_substantive_progress');
  assert.match(devops.empty_state_reason, /technische Aktivität/);
  assert.equal(devops.last_substantive_progress_at, null);
  assert.equal(JSON.parse(devops.outcomes_json)[0].progressQualified, false);
  assert.equal(result.diagnostics.technicalOutcomesNotCountedAsProgress, 1);
});

test('a technical release counts only when counterparty or economic impact is evidenced', () => {
  assert.equal(hasBusinessProgress(outcome('plain', 'topic', 'release_live')), false);
  assert.equal(
    hasBusinessProgress(
      outcome('impact', 'topic', 'release_live', { economic_relevance: 'Kundenpilot nutzbar' })
    ),
    true
  );
  assert.equal(
    isTechnicalActivity(task('ops', 't_ops001', { title: 'PM2 restart completed' })),
    true
  );
});

test('structured next actions, dependencies, risks and decisions are retained', () => {
  const input = {
    tasks: [
      task('sales', 't_case001', {
        body: [
          'NEXT_ACTION: Angebot nach Preisentscheidung senden',
          'DEPENDENCY: Preismodell von Anja',
          'RISK: Bindende Aussage ohne Preisrahmen',
        ].join('\n'),
      }),
    ],
    topics: [topic('topic_case', 'Felix', [{ board: 'sales', taskId: 't_case001' }])],
    outcomes: [],
    decisions: [
      decision('decision_price', 'topic_case', {
        classifier_label: 'RISK_ESCALATION',
        decision_class: 'scope_violation',
      }),
    ],
    wakeups: [],
  };
  const felix = brief(project(input), 'Felix');
  assert.deepEqual(JSON.parse(felix.next_actions_json), ['Angebot nach Preisentscheidung senden']);
  assert.deepEqual(JSON.parse(felix.dependencies_json), ['Preismodell von Anja']);
  assert.equal(JSON.parse(felix.needs_management_json)[0].decisionId, 'decision_price');
  assert.equal(JSON.parse(felix.risks_json).length, 2);
  assert.equal(felix.last_substantive_progress_at, null);
});

test('every configured agent receives a current brief or an explained empty state', () => {
  const result = project({ tasks: [], topics: [], outcomes: [], decisions: [], wakeups: [] });
  assert.deepEqual(
    result.briefs.map((item) => item.agent_id),
    ['Felix', 'DevOps', 'Anja']
  );
  for (const item of result.briefs) {
    assert.equal(item.brief_status, 'empty');
    assert.match(item.empty_state_reason, /Keine aktiven Managementthemen/);
    assert.equal(item.last_substantive_progress_at, null);
  }
  assert.equal(result.diagnostics.emptyBriefs, 3);
});

test('noise topics and incomplete decision projections do not enter management briefs', () => {
  const input = {
    tasks: [
      task('mail', 't_noise001', {
        title: 'Newsletter: Your weekly product update',
        body: 'unsubscribe newsletter',
        status: 'blocked',
        block_kind: 'needs_input',
      }),
    ],
    topics: [topic('topic_noise', 'Felix', [{ board: 'mail', taskId: 't_noise001' }])],
    outcomes: [],
    decisions: [
      decision('decision_incomplete', 'topic_noise', {
        decision_class: 'projection_incomplete',
        recommendation: null,
        options_json: '[]',
        consequences_json: '[]',
        non_decision_effect: null,
      }),
    ],
    wakeups: [],
  };
  const felix = brief(project(input), 'Felix');
  assert.equal(felix.brief_status, 'empty');
  assert.deepEqual(JSON.parse(felix.active_topic_refs_json), []);
  assert.deepEqual(JSON.parse(felix.needs_management_json), []);
});

test('buildProjection retains a blocked material alert in the responsible agent brief', () => {
  const alert = task('inbox', 't_material_alert', {
    assignee: 'felix',
    title: 'Known alert: production outage with customer impact',
    knownAlert: true,
    materialDeviation: true,
    status: 'blocked',
    block_kind: 'needs_input',
    decisionQuestion: 'Kundenwirksame Störung jetzt eskalieren?',
    recommendation: 'Sofort eskalieren',
    options: ['Eskalieren', 'Beobachten'],
    consequences: ['Incident wird priorisiert', 'Kundenwirkung kann fortbestehen'],
    nonDecisionEffect: 'Die kundenwirksame Störung bleibt unbehandelt',
  });
  const projection = buildProjection(
    {
      generatedAt: NOW,
      errors: [],
      boards: [{ board: 'inbox', count: 1, items: [alert] }],
    },
    { now: NOW, agentConfig: config() }
  );

  assert.equal(projection.decisions.length, 1);
  assert.equal(projection.decisions[0].classifier_label, 'RISK_ESCALATION');
  const felix = projection.agentBriefs.find((item) => item.agent_id === 'Felix');
  assert.equal(JSON.parse(felix.active_topic_refs_json).length, 1);
  assert.equal(JSON.parse(felix.needs_management_json)[0].decisionClass, 'risk_escalation');
  assert.equal(JSON.parse(felix.risks_json)[0].classifierLabel, 'RISK_ESCALATION');
});

test('production-shaped blocked material alert remains in the brief without decision metadata', () => {
  const alert = task('inbox', 't_production_alert', {
    assignee: 'felix',
    title: 'Known alert: production outage with customer impact',
    knownAlert: true,
    materialDeviation: true,
    status: 'blocked',
    block_kind: 'needs_input',
  });
  const projection = buildProjection(
    {
      generatedAt: NOW,
      errors: [],
      boards: [{ board: 'inbox', count: 1, items: [alert] }],
    },
    { now: NOW, agentConfig: config() }
  );

  const [projectedDecision] = projection.decisions;
  assert.equal(projectedDecision.classifier_label, 'RISK_ESCALATION');
  assert.equal(projectedDecision.recommendation, null);
  assert.deepEqual(JSON.parse(projectedDecision.options_json), []);
  assert.deepEqual(JSON.parse(projectedDecision.consequences_json), []);
  assert.equal(projectedDecision.non_decision_effect, null);

  const felix = projection.agentBriefs.find((item) => item.agent_id === 'Felix');
  assert.equal(JSON.parse(felix.active_topic_refs_json).length, 1);
  assert.equal(JSON.parse(felix.risks_json)[0].classifierLabel, 'RISK_ESCALATION');
  assert.equal(
    JSON.parse(felix.needs_management_json)[0].decisionId,
    projectedDecision.decision_id
  );
});

test('scheduled topics before wake time do not make an agent appear active', () => {
  const result = project({
    tasks: [task('sales', 't_wait001')],
    topics: [
      topic('topic_wait', 'Felix', [{ board: 'sales', taskId: 't_wait001' }], {
        current_state: 'scheduled',
        expected_progress_at: NOW + 86400,
      }),
    ],
    outcomes: [],
    decisions: [],
    wakeups: [],
  });
  assert.equal(brief(result, 'Felix').brief_status, 'empty');
});
