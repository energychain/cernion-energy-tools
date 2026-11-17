'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ACTIONS,
  DecisionActionError,
  createDecisionActions,
  normalizePayload,
} = require('../lib/decision-actions');

function fixture(overrides = {}) {
  return {
    decision_id: 'decision_public',
    source_board: 'fixture',
    source_task_id: 't_public01',
    status: 'blocked',
    options: ['A', 'B'],
    ...overrides,
  };
}

function reader(decision = fixture()) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    read(operation, options) {
      reads += 1;
      assert.equal(operation, 'decision');
      return { item: options.id === decision.decision_id ? structuredClone(decision) : null };
    },
  };
}

test('all governance actions produce explicit shadow plans without persistence', () => {
  const source = reader();
  const service = createDecisionActions({ reader: source, now: () => 1700000000 });
  const payloads = {
    choose: { option: 'B', note: 'Auf zehn Fälle begrenzen' },
    delegate: {
      assignee: 'Felix',
      scopeType: 'PUBLISH_SCOPE',
      validForHours: 48,
      constraints: ['nur freigegebene Seite'],
    },
    question: { question: 'Welche Evidenz trägt die Empfehlung?' },
    schedule: {
      wakeAt: '2030-12-01T08:00:00.000Z',
      reason: 'Budgetlage erneut prüfen',
      nextAction: 'Budgetstatus bewerten',
      owner: 'Anja',
    },
    reject: { reason: 'Risiko ist nicht ausreichend begrenzt.' },
    'return-to-rhajaina': { reason: 'Optionen und Konsequenzen vervollständigen.' },
  };

  for (const action of ACTIONS) {
    const result = service.preview('decision_public', action, payloads[action]);
    assert.equal(result.mode, 'shadow');
    assert.equal(result.writePerformed, false);
    assert.equal(result.persisted, false);
    assert.equal(result.action, action);
    assert.equal(result.source.board, 'fixture');
    assert.ok(result.plannedEffects.length >= 3);
  }
  assert.equal(source.reads, ACTIONS.length);
});

test('choose validates the projected options and closed decisions are immutable', () => {
  const service = createDecisionActions({ reader: reader() });
  assert.throws(
    () => service.preview('decision_public', 'choose', { option: 'C' }),
    (error) => error instanceof DecisionActionError && error.code === 'option_not_available'
  );

  const closed = createDecisionActions({ reader: reader(fixture({ status: 'closed' })) });
  assert.throws(
    () => closed.preview('decision_public', 'reject', { reason: 'No' }),
    (error) => error.code === 'decision_not_actionable' && error.status === 409
  );
});

test('schedule requires a valid future date and delegation is bounded', () => {
  const decision = fixture();
  assert.throws(
    () =>
      normalizePayload('schedule', { wakeAt: 'invalid', reason: 'Later' }, decision, 1700000000),
    (error) => error.code === 'wakeAt_invalid'
  );
  assert.throws(
    () =>
      normalizePayload(
        'schedule',
        { wakeAt: '2020-01-01T00:00:00Z', reason: 'Later' },
        decision,
        1700000000
      ),
    (error) => error.code === 'wakeAt_must_be_future'
  );
  assert.throws(
    () => normalizePayload('delegate', { assignee: 'Felix', validForHours: 721 }, decision, 0),
    (error) => error.code === 'validForHours_out_of_range'
  );
});

test('shadow implementation refuses write configuration fail-closed', () => {
  const service = createDecisionActions({
    reader: reader(),
    writeEnabled: true,
    shadowOnly: false,
  });
  assert.throws(
    () => service.preview('decision_public', 'choose', { option: 'A' }),
    (error) => error.code === 'decision_writes_not_implemented' && error.status === 501
  );
});

test('unknown or missing decisions do not create action plans', () => {
  const service = createDecisionActions({ reader: reader() });
  assert.throws(
    () => service.preview('missing', 'question', { question: 'Warum?' }),
    (error) => error.code === 'decision_not_found' && error.status === 404
  );
  assert.throws(
    () => service.preview('decision_public', 'archive', {}),
    (error) => error.code === 'unknown_decision_action' && error.status === 404
  );
});

function mockKanban(initialTask, { failWrite = false } = {}) {
  let task = structuredClone(initialTask);
  return {
    get task() {
      return structuredClone(task);
    },
    async readTask() {
      return structuredClone(task);
    },
    async recordDecision(command) {
      if (failWrite) throw new Error('kanban_write_failed');
      task = {
        ...task,
        comments: [
          ...(task.comments || []),
          { author: 'hitl-cockpit', body: `decision=${command.decisionId};action=${command.action}` },
        ],
      };
      return { step: 0, ok: true };
    },
  };
}

function fingerprintOf(task) {
  return require('../lib/assistant-action-executor').sourceFingerprint(task);
}

test('execute is disabled by default and fails closed without the operator flag', async () => {
  const service = createDecisionActions({ reader: reader(), kanban: mockKanban({ id: 't_public01' }) });
  await assert.rejects(
    () => service.execute('decision_public', 'question', { confirm: true, idempotencyKey: 'k1' }),
    (error) => error.code === 'decision_execute_not_enabled' && error.status === 501
  );
});

test('execute requires explicit confirmation, idempotency key and a matching fingerprint', async () => {
  const task = { id: 't_public01', board: 'fixture' };
  const kanban = mockKanban(task);
  const service = createDecisionActions({ reader: reader(), kanban, executeEnabled: true });

  await assert.rejects(
    () => service.execute('decision_public', 'question', { idempotencyKey: 'k1', sourceFingerprint: 'x' }),
    (error) => error.code === 'confirmation_required' && error.status === 400
  );
  await assert.rejects(
    () => service.execute('decision_public', 'question', { confirm: true, sourceFingerprint: 'x' }),
    (error) => error.code === 'idempotencyKey_required'
  );
  await assert.rejects(
    () =>
      service.execute('decision_public', 'question', {
        confirm: true,
        idempotencyKey: 'k1',
        sourceFingerprint: 'wrong',
        question: 'Welche Evidenz?',
      }),
    (error) => error.code === 'source_fingerprint_mismatch' && error.status === 409
  );
});

test('execute performs a real, persisted write with readback and receipt, then dedupes retries', async () => {
  const task = { id: 't_public01', board: 'fixture' };
  const kanban = mockKanban(task);
  const service = createDecisionActions({ reader: reader(), kanban, executeEnabled: true });
  const fingerprint = fingerprintOf(task);

  const first = await service.execute('decision_public', 'question', {
    confirm: true,
    idempotencyKey: 'k1',
    sourceFingerprint: fingerprint,
    question: 'Welche Evidenz trägt die Empfehlung?',
  });
  assert.equal(first.mode, 'execute');
  assert.equal(first.writePerformed, true);
  assert.equal(first.persisted, true);
  assert.equal(first.deduplicated, false);
  assert.ok(first.receipt.readBack.task.comments.length === 1);

  const second = await service.execute('decision_public', 'question', {
    confirm: true,
    idempotencyKey: 'k1',
    sourceFingerprint: fingerprint,
    question: 'Welche Evidenz trägt die Empfehlung?',
  });
  assert.equal(second.deduplicated, true);
  assert.equal(kanban.task.comments.length, 1, 'no second write for the same idempotency key');
});

test('execute rejects excluded boards and private-marked sources fail-closed', async () => {
  const twlDecision = reader(fixture({ source_board: 'twl-netze-private' }));
  const service = createDecisionActions({
    reader: twlDecision,
    kanban: mockKanban({ id: 't_public01' }),
    executeEnabled: true,
  });
  await assert.rejects(
    () =>
      service.execute('decision_public', 'question', {
        confirm: true,
        idempotencyKey: 'k1',
        sourceFingerprint: 'anything',
        question: 'x',
      }),
    (error) => error.code === 'excluded_board_rejected' && error.status === 403
  );
});
