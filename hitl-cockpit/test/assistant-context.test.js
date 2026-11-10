'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  AssistantContextError,
  createAssistantContextResolver,
} = require('../lib/assistant-context');
const { ManagementReader } = require('../lib/management-reader');
const { ManagementStore } = require('../lib/management-store');

function readerFixture(overrides = {}) {
  const calls = [];
  const rows = {
    topic: {
      topic_id: 'topic_1',
      title: 'Public topic',
      business_goal: 'Ship safely',
      owner_agent: 'DevOps',
      current_state: 'running',
      next_step: 'Review',
      sensitivity: 'internal',
      source_task_refs: [{ board: 'public', taskId: 't_123456' }],
    },
    decision: {
      decision_id: 'decision_1',
      question: 'Choose A or B?',
      recommendation: 'A',
      options: ['A', 'B'],
      status: 'open',
      source_board: 'public',
      source_task_id: 't_123456',
    },
    department: {
      agent_id: 'DevOps',
      current_goal: 'Safe delivery',
      next_actions: ['Review'],
      evidence_refs: ['Delivery evidence'],
    },
    outcome: {
      outcome_id: 'outcome_1',
      outcome_type: 'delivery',
      statement: 'Delivered',
      occurred_at: 1700000000,
      source_board: 'public',
      evidence_refs: ['Public evidence'],
    },
    risk: {
      decision_id: 'risk_1',
      question: 'Scope violation?',
      recommendation: 'Stop',
      decision_class: 'scope_violation',
      classifier_label: 'RISK_ESCALATION',
      source_board: 'public',
    },
    wakeup: {
      wakeup_id: 'wakeup_1',
      wake_at: 1700000000,
      why_scheduled: 'Wait',
      next_action_on_wake: 'Check signal',
      owner_agent: 'Viki',
      status: 'scheduled',
      source_board: 'public',
    },
    global: { counts: { topics: 1, decisions: 2, outcomes: 3, departments: 4 } },
    ...overrides,
  };
  return {
    calls,
    reader: {
      read(operation, options = {}) {
        calls.push({ operation, options });
        if (operation === 'overview') return rows.global;
        if (operation === 'departments') return { item: rows.department };
        return { item: rows[operation] };
      },
    },
  };
}

test('resolves all supported object types through ManagementReader and allowlists fields', () => {
  const fixture = readerFixture();
  const resolver = createAssistantContextResolver({ reader: fixture.reader });
  for (const [type, id] of [
    ['topic', 'topic_1'],
    ['decision', 'decision_1'],
    ['department', 'DevOps'],
    ['outcome', 'outcome_1'],
    ['risk', 'risk_1'],
    ['wakeup', 'wakeup_1'],
  ]) {
    const context = resolver.resolve({ objectType: type, objectId: id, injected: 'ignored' });
    assert.equal(context.objectType, type);
    assert.equal(context.objectId, id);
    assert.ok(context.fingerprint);
    assert.equal(context.payload.source_board, undefined);
    assert.equal(context.payload.source_task_id, undefined);
    assert.equal(context.payload.evidenceRefs, undefined);
  }
  assert.deepEqual(
    fixture.calls.map((call) => call.operation),
    ['topic', 'decision', 'departments', 'outcome', 'risk', 'wakeup']
  );
});

test('includes only sanitized task, Matrix, artifact, and evidence references', () => {
  const fixture = readerFixture({
    topic: {
      topic_id: 'topic_1',
      title: 'Public topic',
      source_task_refs: [{ board: 'public-board', taskId: 't_123456' }],
      matrix_room_ref: '!publicroom:example.org',
      artifact_refs: ['Freigegebene Übersicht'],
      evidence_refs: ['Öffentlicher Nachweis'],
    },
  });
  const payload = createAssistantContextResolver({ reader: fixture.reader }).resolve({
    objectType: 'topic',
    objectId: 'topic_1',
  }).payload;
  assert.deepEqual(payload.references, {
    artifacts: [{ label: 'Freigegebene Übersicht' }],
    evidence: [{ label: 'Öffentlicher Nachweis' }],
    matrixRoom: { roomRef: '!publicroom:example.org' },
    sourceTasks: [{ board: 'public-board', taskId: 't_123456' }],
  });
});

test('context firewall rejects forbidden markers in every allowed text shape without disclosure', () => {
  const cases = [
    ['topic', 'title'],
    ['decision', 'recommendation'],
    ['department', 'current_goal'],
    ['outcome', 'statement'],
    ['risk', 'question'],
    ['wakeup', 'why_scheduled'],
  ];
  const markers = ['T W L Netze', 'private board', 'raw_bridge', 'restricted'];
  for (const [type, field] of cases) {
    for (const marker of markers) {
      const fixture = readerFixture({
        [type]: { [`${type}_id`]: `${type}_1`, [field]: marker },
      });
      const resolver = createAssistantContextResolver({ reader: fixture.reader });
      assert.throws(
        () => resolver.resolve({ objectType: type, objectId: `${type}_1` }),
        (error) =>
          error.code === 'assistant_context_not_available' &&
          error.message === 'assistant_context_not_available' &&
          !error.message.includes(marker)
      );
    }
  }
});

test('context firewall rejects unclear variants for standalone outcome, risk, and wakeup rows', () => {
  const cases = [
    ['outcome', 'outcome_id', 'statement'],
    ['risk', 'decision_id', 'question'],
    ['wakeup', 'wakeup_id', 'why_scheduled'],
  ];
  for (const [type, idField, textField] of cases) {
    for (const marker of [
      'unclear',
      'UNCLEAR',
      'un-clear',
      'un_clear',
      'unclearly',
      'un\u200Bclear',
    ]) {
      const fixture = readerFixture({
        [type]: { [idField]: `${type}_unclear`, [textField]: marker, sensitivity: marker },
      });
      assert.throws(
        () =>
          createAssistantContextResolver({ reader: fixture.reader }).resolve({
            objectType: type,
            objectId: `${type}_unclear`,
          }),
        (error) => error.code === 'assistant_context_not_available'
      );
    }
  }
});

test('supports global/null context and ignores browser-supplied data', () => {
  const fixture = readerFixture();
  const resolver = createAssistantContextResolver({ reader: fixture.reader });
  const first = resolver.resolve({ objectType: null, objectId: null, payload: { forged: true } });
  const second = resolver.resolve({ objectType: 'global', objectId: null, title: 'forged' });
  assert.deepEqual(first.payload, {
    counts: { departments: 4, decisions: 2, outcomes: 3, topics: 1 },
  });
  assert.equal(first.fingerprint, second.fingerprint);
});

test('unknown and sensitive contexts share one non-disclosing 404 error', () => {
  const cases = [
    readerFixture({ topic: null }),
    readerFixture({ topic: { topic_id: 'x', title: 'Private', sensitivity: 'private' } }),
    readerFixture({ topic: { topic_id: 'x', title: 'Bridge', sensitivity: 'raw_bridge' } }),
    readerFixture({ topic: { topic_id: 'x', title: 'TWL', source_board: 'twl-netze-private' } }),
    readerFixture({ topic: { topic_id: 'x', title: 'Mixed', sensitivity: 'mixed-sensitive' } }),
    readerFixture({ topic: { topic_id: 'x', title: 'Secret', sensitivity: 'secret' } }),
    readerFixture({ topic: { topic_id: 'x', title: 'Restricted', sensitivity: 'restricted' } }),
  ];
  for (const fixture of cases) {
    const resolver = createAssistantContextResolver({ reader: fixture.reader });
    assert.throws(
      () => resolver.resolve({ objectType: 'topic', objectId: 'x' }),
      (error) =>
        error instanceof AssistantContextError &&
        error.status === 404 &&
        error.code === 'assistant_context_not_available' &&
        error.message === 'assistant_context_not_available'
    );
  }
});

test('fingerprint is deterministic and oversized context fails closed', () => {
  const fixture = readerFixture();
  const resolver = createAssistantContextResolver({ reader: fixture.reader });
  const a = resolver.resolve({ objectType: 'decision', objectId: 'decision_1' });
  const b = resolver.resolve({ objectId: 'decision_1', objectType: 'decision' });
  assert.equal(a.fingerprint, b.fingerprint);

  const oversized = readerFixture({
    topic: { topic_id: 'x', title: 'x'.repeat(500), sensitivity: 'internal' },
  });
  assert.throws(
    () =>
      createAssistantContextResolver({ reader: oversized.reader, maxBytes: 100 }).resolve({
        objectType: 'topic',
        objectId: 'x',
      }),
    /assistant_context_not_available/
  );
});

test('rejects unsupported type and missing id without revealing existence', () => {
  const resolver = createAssistantContextResolver({ reader: readerFixture().reader });
  for (const input of [
    { objectType: 'task', objectId: 't_123456' },
    { objectType: 'topic', objectId: null },
  ]) {
    assert.throws(
      () => resolver.resolve(input),
      (error) => error.status === 404 && error.code === 'assistant_context_not_available'
    );
  }
});

test('real ManagementReader resolves individual outcome, risk, and wakeup records', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-context-reader-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'management.db');
  const store = new ManagementStore({ database });
  store.initialize();
  store.applyProjection({
    topics: [],
    agentBriefs: [],
    decisions: [
      {
        decision_id: 'risk_real',
        topic_id: null,
        source_board: 'public',
        source_task_id: 't_123456',
        decision_class: 'scope_violation',
        question: 'Stop?',
        reason_human_required: 'Boundary',
        recommendation: 'Stop',
        options_json: '[]',
        consequences_json: '[]',
        deadline: null,
        non_decision_effect: null,
        execution_scope_json: '[]',
        excluded_scope_json: '[]',
        status: 'open',
        classifier_label: 'RISK_ESCALATION',
        classifier_reasons_json: '[]',
        confidence: 1,
        first_projected_at: 1700000000,
        updated_at: 1700000000,
        source_refs_json: '[]',
      },
    ],
    outcomes: [
      {
        outcome_id: 'outcome_real',
        topic_id: null,
        source_board: 'public',
        source_task_id: 't_123456',
        outcome_type: 'delivery',
        statement: 'Delivered',
        evidence_refs_json: '[]',
        occurred_at: 1700000000,
        counterparty: null,
        economic_relevance: 'medium',
        confidence: 1,
      },
    ],
    wakeups: [
      {
        wakeup_id: 'wakeup_real',
        source_board: 'public',
        source_task_id: 't_123456',
        wake_at: 1700000000,
        why_scheduled: 'Wait',
        next_action_on_wake: 'Review',
        signal_required: null,
        auto_close_after: null,
        owner_agent: 'Viki',
        status: 'scheduled',
        last_signal_at: null,
      },
    ],
    digestItems: [],
    objects: [],
    boards: [],
  });
  const resolver = createAssistantContextResolver({ reader: new ManagementReader({ database }) });
  assert.equal(
    resolver.resolve({ objectType: 'outcome', objectId: 'outcome_real' }).payload.statement,
    'Delivered'
  );
  assert.equal(
    resolver.resolve({ objectType: 'risk', objectId: 'risk_real' }).payload.question,
    'Stop?'
  );
  assert.equal(
    resolver.resolve({ objectType: 'wakeup', objectId: 'wakeup_real' }).payload.whyScheduled,
    'Wait'
  );
});
