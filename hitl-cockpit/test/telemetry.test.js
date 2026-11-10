'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { AssistantStore } = require('../lib/assistant-store');
const { ManagementStore } = require('../lib/management-store');
const {
  CLASSIFIER_LABELS,
  appendSnapshot,
  assertSanitized,
  collectTelemetry,
  compareHistory,
  readHistory,
} = require('../lib/telemetry');
const { parseArgs } = require('../bin/export-telemetry');

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function topic(id, state, refs, sensitivity = 'internal') {
  return {
    topic_id: id,
    title: `secret-title-${id}`,
    business_goal: 'secret business goal',
    owner_agent: 'Felix',
    participating_agents_json: '["Felix"]',
    current_state: state,
    next_step: 'secret next step',
    expected_progress_at: null,
    impact_statement: null,
    last_substantive_progress_at: null,
    matrix_room_ref: null,
    artifact_refs_json: '[]',
    source_task_refs_json: JSON.stringify(refs),
    sensitivity,
    updated_at: 1700000200,
  };
}

function decision(id, topicId, overrides = {}) {
  return {
    decision_id: id,
    topic_id: topicId,
    source_board: 'public-board',
    source_task_id: `task-${id}`,
    decision_class: 'governance',
    question: `secret-question-${id}`,
    reason_human_required: 'binding decision',
    recommendation: 'Option B',
    options_json: '["A","B"]',
    consequences_json: '["one","two"]',
    deadline: null,
    non_decision_effect: 'delay',
    execution_scope_json: '[]',
    excluded_scope_json: '[]',
    status: 'blocked',
    classifier_label: 'DECISION_REQUIRED',
    classifier_reasons_json: '[]',
    confidence: 1,
    first_projected_at: 1700000100,
    updated_at: 1700000200,
    source_refs_json: JSON.stringify([
      { board: 'public-board', taskId: `task-${id}`, channel: 'kanban' },
    ]),
    ...overrides,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap13-telemetry-'));
  const database = path.join(root, 'management.db');
  const store = new ManagementStore({ database });
  store.initialize();
  const topics = [
    topic('topic_open', 'running', [
      { board: 'public-board', taskId: 'one' },
      { board: 'public-board', taskId: 'two' },
      { board: 'public-board', taskId: 'three' },
    ]),
    topic('topic_autonomous', 'completed', [{ board: 'public-board', taskId: 'four' }]),
    topic(
      'topic_private',
      'blocked',
      [{ board: 'twl-netze-private', taskId: 'private-one' }],
      'twl-private'
    ),
  ];
  const decisions = [
    decision('decision_mature', 'topic_open'),
    decision('decision_repeat', 'topic_open', {
      recommendation: null,
      options_json: '[]',
      consequences_json: '[]',
      non_decision_effect: null,
      decision_class: 'projection_incomplete',
    }),
    decision('decision_scope', 'topic_open', {
      decision_class: 'scope_violation',
      classifier_label: 'RISK_ESCALATION',
      recommendation: null,
      options_json: '[]',
      consequences_json: '[]',
      non_decision_effect: null,
      source_refs_json: JSON.stringify([
        { board: 'public-board', taskId: 'scope-a', channel: 'matrix' },
        { board: 'public-board', taskId: 'scope-b', channel: 'kanban' },
      ]),
    }),
    decision('decision_resolved', 'topic_open', {
      status: 'resolved',
      updated_at: 1700000400,
    }),
    decision('decision_private', 'topic_private', {
      source_board: 'twl-netze-private',
      question: 'TWL raw private question',
    }),
  ];
  const outcomes = [
    {
      outcome_id: 'outcome_autonomous',
      topic_id: 'topic_autonomous',
      source_board: 'public-board',
      source_task_id: 'task-outcome',
      outcome_type: 'offer_sent',
      statement: 'secret external outcome',
      evidence_refs_json: '["https://example.test/evidence"]',
      occurred_at: 1700000000,
      counterparty: 'secret counterparty',
      economic_relevance: 'secret value',
      confidence: 1,
    },
    {
      outcome_id: 'outcome_before_resolution',
      topic_id: 'topic_open',
      source_board: 'public-board',
      source_task_id: 'task-outcome-two',
      outcome_type: 'response_received',
      statement: 'secret response',
      evidence_refs_json: '[]',
      occurred_at: 1700000300,
      counterparty: null,
      economic_relevance: null,
      confidence: 1,
    },
  ];
  const wakeups = [
    {
      wakeup_id: 'wakeup_waiting',
      source_board: 'public-board',
      source_task_id: 'task-waiting',
      wake_at: 1700000000,
      why_scheduled: 'secret reason',
      next_action_on_wake: 'secret action',
      signal_required: 'reply',
      auto_close_after: null,
      owner_agent: 'Felix',
      status: 'awaiting_signal',
      last_signal_at: null,
    },
    {
      wakeup_id: 'wakeup_repeated',
      source_board: 'public-board',
      source_task_id: 'task-repeated',
      wake_at: 1700000000,
      why_scheduled: 'secret reason',
      next_action_on_wake: 'secret action',
      signal_required: null,
      auto_close_after: null,
      owner_agent: 'Felix',
      status: 'quality_error',
      last_signal_at: null,
    },
  ];
  store.applyProjection({
    replaceBoards: [],
    replaceAgentBriefs: false,
    replaceDigestBoards: [],
    topics,
    decisions,
    outcomes,
    wakeups,
    digestItems: [],
    agentBriefs: [],
    objects: [],
    boards: [
      {
        board: 'public-board',
        projected_at: 1700000500,
        source_count: 10,
        source_fingerprint: 'public-fingerprint',
      },
      {
        board: 'twl-netze-private',
        projected_at: 1700000500,
        source_count: 99,
        source_fingerprint: 'private-fingerprint',
      },
    ],
  });
  const labels = CLASSIFIER_LABELS.map((label, index) => ({
    source_board: 'public-board',
    source_task_id: `label-${index}`,
    projected_at: 1700000000,
    label,
    reasons_json: '["fixture"]',
    confidence: 1,
    classifier_version: 'fixture',
    overridden_by: null,
    override_reason: null,
  }));
  labels.push({
    ...labels[0],
    source_board: 'twl-netze-private',
    source_task_id: 'private-label',
  });
  store.writeClassificationAudit(labels);
  const eventInsert = spawnSync(
    'python3',
    [
      '-c',
      [
        'import sqlite3,sys',
        'con=sqlite3.connect(sys.argv[1])',
        'con.execute("INSERT INTO cockpit_events VALUES (?,?,?,?,?,?,?)", (\'e1\',1700000600,\'decision_reject\',\'decision\',\'d1\',None,\'{"classifierLabel":"NOISE","title":"secret"}\'))',
        "con.execute(\"INSERT INTO cockpit_events VALUES (?,?,?,?,?,?,?)\", ('e2',1700000700,'decision_choose','decision','d2',None,'{\"nextStep\":\"execute\"}'))",
        "con.execute(\"INSERT INTO cockpit_events VALUES (?,?,?,?,?,?,?)\", ('e3',1700000800,'scope_action_prevented','scope','s1',None,'{}'))",
        'con.commit()',
      ].join(';'),
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(eventInsert.status, 0, eventInsert.stderr);
  return { root, database };
}

function assistantFixture(root) {
  const database = path.join(root, 'assistant.db');
  new AssistantStore({ database }).initialize();
  const input = {
    conversation: [
      'conversation-secret-id',
      'topic',
      'topic-secret-id',
      'assistant-session',
      'active',
    ],
    messages: [
      ['message-secret-user', 'user', 'vertraulicher Nutzertext', 'client-secret-id', 1700000100],
      ['message-secret-assistant', 'assistant', 'vertrauliche Antwort', null, 1700000130],
      ['message-secret-failed', 'user', 'private context request', 'client-secret-two', 1700000200],
    ],
    events: [
      ['intent_detected', { intent: 'resume_topic', messageId: 'message-secret-user' }],
      ['intent_detected', { intent: 'untrusted-secret-intent' }],
      ['proposal_created', { body: 'secret proposal' }],
      ['proposal_accepted', { proposalId: 'proposal-secret-id' }],
      ['correction_requested', { content: 'secret correction' }],
      ['correction_applied', {}],
      ['client_message_deduplicated', { clientMessageId: 'client-secret-id' }],
      ['clarification_requested', { question: 'secret question' }],
      ['clarification_resolved', {}],
      ['assistant_context_rejected', { objectId: 'topic-secret-id' }],
    ],
  };
  const script = String.raw`
import json,sqlite3,sys
r=json.loads(sys.stdin.read()); con=sqlite3.connect(sys.argv[1]); con.execute('PRAGMA foreign_keys=ON')
c=r['conversation']; con.execute('INSERT INTO assistant_conversations VALUES (?,?,?,?,?,?,?,?,?)',(c[0],c[1],c[2],c[3],None,0,c[4],1700000000,1700000200))
for m in r['messages']: con.execute('INSERT INTO assistant_messages VALUES (?,?,?,?,?,?)',(m[0],c[0],m[1],m[2],m[3],m[4]))
con.execute('INSERT INTO assistant_context_envelopes VALUES (?,?,?,?,?,?,?)',('context-secret-id',c[0],'topic',c[2],'fingerprint-secret','{"private":"secret context"}',1700000100))
con.execute('INSERT INTO assistant_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',('run-secret-complete',c[0],r['messages'][0][3],r['messages'][0][0],r['messages'][1][0],'context-secret-id','session-secret','completed',None,None,None,1700000100,1700000130))
con.execute('INSERT INTO assistant_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',('run-secret-failed',c[0],r['messages'][2][3],r['messages'][2][0],None,None,None,'failed','assistant_context_not_available',None,None,1700000200,1700000220))
con.execute('INSERT INTO assistant_summaries VALUES (?,?,?,?,?)',(c[0],'secret summary',r['messages'][1][0],2,1700000130))
for i,e in enumerate(r['events']): con.execute('INSERT INTO assistant_events VALUES (?,?,?,?,?)',('event-secret-'+str(i),c[0],e[0],json.dumps(e[1]),1700000300+i))
con.commit()
`;
  const inserted = spawnSync('python3', ['-c', script, database], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  assert.equal(inserted.status, 0, inserted.stderr);
  return database;
}

test('collectTelemetry computes AP13 metrics without exposing source content', () => {
  const { root, database } = fixture();
  try {
    const before = checksum(database);
    const snapshot = collectTelemetry({
      database,
      now: 1700001000,
      projectionErrorCount: 0,
      legacySource: { items: Array.from({ length: 10 }, () => ({})) },
    });
    assert.equal(checksum(database), before, 'read-only telemetry changed the projection');
    assert.equal(snapshot.mode, 'shadow');
    assert.equal(snapshot.operationalEffect, false);
    assert.equal(snapshot.sourceWritePerformed, false);
    assert.equal(snapshot.managementLoad.visibleDecisionCount, 2);
    assert.equal(snapshot.managementLoad.legacyVisibleCandidateCount, 10);
    assert.equal(snapshot.managementLoad.reductionRatio, 0.8);
    assert.equal(snapshot.classification.total, CLASSIFIER_LABELS.length);
    for (const label of CLASSIFIER_LABELS) {
      assert.equal(snapshot.classification.counts[label], 1);
      assert.equal(snapshot.classification.shares[label], 0.125);
    }
    assert.equal(snapshot.decisionActions.counts.reject, 1);
    assert.equal(snapshot.decisionActions.counts.choose, 1);
    assert.equal(snapshot.decisionActions.rejectedNoiseShare, 1);
    assert.equal(snapshot.decisionActions.nextStepInteractionCount, 1);
    assert.equal(snapshot.processQuality.medianMatureOutcomeToResolvedDecisionSeconds, 100);
    assert.equal(snapshot.processQuality.repeatedHitlTopicCount, 1);
    assert.equal(snapshot.processQuality.repeatedHitlExcessCount, 2);
    assert.equal(snapshot.processQuality.consolidatedDecisionSourceCount, 1);
    assert.equal(snapshot.processQuality.autonomousCompletedBundleCount, 1);
    assert.equal(snapshot.processQuality.wakeupsAwaitingNewSignal, 1);
    assert.equal(snapshot.processQuality.repeatedWakeupsWithoutStateChange, 1);
    assert.equal(snapshot.processQuality.sourceCardsPerTopic.topicCount, 2);
    assert.equal(snapshot.processQuality.sourceCardsPerTopic.maximum, 3);
    assert.equal(snapshot.scopeSafety.openScopeViolationCount, 1);
    assert.equal(snapshot.scopeSafety.openRiskEscalationCount, 1);
    assert.equal(snapshot.scopeSafety.correctlyPreventedActionCount, 1);
    assert.equal(snapshot.projectionHealth.boardCount, 1);
    assert.equal(snapshot.projectionHealth.sourceCount, 10);
    assert.equal(snapshot.projectionHealth.ageSeconds, 500);
    assert.equal(snapshot.projectionHealth.boardErrorCount, 0);
    assert.equal(snapshot.privacy.rawBodiesIncluded, false);
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /secret|TWL raw|counterparty|example\.test/);
    assertSanitized(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AP16 assistant telemetry aggregates behavior and sizes without bodies or identifiers', () => {
  const { root, database } = fixture();
  try {
    const assistantDatabase = assistantFixture(root);
    const managementBefore = checksum(database);
    const assistantBefore = checksum(assistantDatabase);
    const snapshot = collectTelemetry({
      database,
      assistantDatabase,
      now: 1700001000,
    });

    assert.equal(checksum(database), managementBefore);
    assert.equal(checksum(assistantDatabase), assistantBefore);
    assert.equal(snapshot.assistantChannel.available, true);
    assert.deepEqual(snapshot.assistantChannel.counts, {
      conversations: 1,
      activeConversations: 1,
      runs: 2,
      messages: 3,
      events: 10,
    });
    assert.equal(snapshot.assistantChannel.runStatusCounts.completed, 1);
    assert.equal(snapshot.assistantChannel.runStatusCounts.failed, 1);
    assert.deepEqual(snapshot.assistantChannel.latencySeconds, {
      sampleSize: 2,
      median: 25,
      p95: 30,
    });
    assert.equal(snapshot.assistantChannel.errorCounts.total, 1);
    assert.equal(snapshot.assistantChannel.errorCounts.contextRejection, 1);
    assert.equal(snapshot.assistantChannel.intentCounts.counts.resume_topic, 1);
    assert.equal(snapshot.assistantChannel.intentCounts.counts.other, 1);
    assert.deepEqual(snapshot.assistantChannel.proposalCounts, {
      available: true,
      created: 1,
      accepted: 1,
      rejected: 0,
    });
    assert.deepEqual(snapshot.assistantChannel.correctionCounts, {
      available: true,
      requested: 1,
      applied: 1,
    });
    assert.equal(snapshot.assistantChannel.dedupeCount, 1);
    assert.equal(snapshot.assistantChannel.dedupeMetricsAvailable, true);
    assert.deepEqual(snapshot.assistantChannel.clarificationCounts, {
      available: true,
      requested: 1,
      resolved: 1,
    });
    assert.equal(snapshot.assistantChannel.contextRejectionCount, 1);
    assert.equal(snapshot.assistantChannel.size.messagesByRole.user.count, 2);
    assert.equal(snapshot.assistantChannel.size.messagesByRole.assistant.count, 1);
    assert.equal(snapshot.assistantChannel.size.contexts.count, 1);
    assert.equal(snapshot.assistantChannel.size.summaries.count, 1);

    const serialized = JSON.stringify(snapshot.assistantChannel);
    assert.doesNotMatch(
      serialized,
      /vertraulich|private context|secret|message-|run-|client-|conversation-|topic-/i
    );
    assertSanitized(snapshot);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AP16 assistant telemetry is explicitly unavailable without an assistant database', () => {
  const { root, database } = fixture();
  try {
    const snapshot = collectTelemetry({ database, now: 1700001000 });
    assert.equal(snapshot.assistantChannel.available, false);
    assert.equal(snapshot.assistantChannel.counts, null);
    assert.equal(snapshot.assistantChannel.latencySeconds, null);
    assert.equal(snapshot.assistantChannel.dedupeCount, null);
    assert.equal(snapshot.assistantChannel.dedupeMetricsAvailable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('telemetry history is private, sanitized and supports the 14-day shadow gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ap13-history-'));
  const historyPath = path.join(root, 'nested', 'telemetry.jsonl');
  try {
    const base = 1700000000;
    for (let day = 0; day < 14; day += 1) {
      appendSnapshot(historyPath, {
        capturedAt: base + day * 86400,
        managementLoad: {
          visibleDecisionCount: 20 - day,
          legacyVisibleCandidateCount: 40,
        },
        processQuality: {
          repeatedHitlTopicCount: 10 - Math.floor(day / 2),
          autonomousCompletedBundleCount: day,
        },
        classification: { shares: { NOISE: 0.25 } },
        projectionHealth: { ageSeconds: 60 },
      });
    }
    const mode = fs.statSync(historyPath).mode & 0o777;
    assert.equal(mode, 0o600);
    const history = readHistory(historyPath);
    const comparison = compareHistory(history, {
      now: base + 13 * 86400,
      windowDays: 14,
    });
    assert.equal(comparison.coverageDays, 14);
    assert.equal(comparison.gateReady, true);
    assert.equal(comparison.change.visibleDecisionCount, -13);
    assert.equal(comparison.change.autonomousCompletedBundleCount, 13);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sanitizer rejects bodies, questions and source identifiers', () => {
  for (const value of [
    { body: 'raw mail' },
    { nested: { question: 'sensitive' } },
    { taskId: 't_private' },
  ]) {
    assert.throws(() => assertSanitized(value), /sensitive_telemetry_key/);
  }
});

test('export arguments remain shadow-only and bounded', () => {
  assert.deepEqual(parseArgs(['--stdout-only', '--window-days', '14', '--now', '1700000000']), {
    stdoutOnly: true,
    windowDays: 14,
    now: 1700000000,
  });
  assert.throws(() => parseArgs(['--write']), /unknown argument/);
  assert.throws(() => parseArgs(['--window-days', '0']), /window-days/);
  assert.throws(() => parseArgs(['--window-days', '91']), /window-days/);
});
