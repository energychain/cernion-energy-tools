'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { AssistantStore } = require('../lib/assistant-store');
const {
  createAssistantActionExecutor,
  sourceFingerprint,
} = require('../lib/assistant-action-executor');
const { createAssistantMatrixHandoffAdapter } = require('../lib/assistant-matrix-handoff');
const { createAssistantReconciliation, DAY_SECONDS } = require('../lib/assistant-reconciliation');

function fixture(t, clock = { value: 1000 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-reconciliation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AssistantStore({ database: path.join(root, 'assistant.db') });
  store.initialize();
  const conversation = store.createConversation({ createdAt: clock.value });
  const message = store.appendMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'proposal',
    createdAt: clock.value,
  });
  const proposal = store.createProposal({
    conversationId: conversation.id,
    messageId: message.id,
    actionType: 'delegate',
    targetType: 'topic',
    targetId: 'topic-1',
    payload: { assignee: 'Anja' },
    riskClass: 'medium',
    scopeStatus: 'covered',
    idempotencyKey: 'persistent-key',
    createdAt: clock.value,
  }).proposal;
  store.updateProposalStatus(proposal.id, 'confirmed', {
    expectedStatus: 'shadow',
    conversationId: conversation.id,
    updatedAt: clock.value,
  });
  store.updateProposalStatus(proposal.id, 'executing', {
    expectedStatus: 'confirmed',
    conversationId: conversation.id,
    updatedAt: clock.value,
  });
  return { clock, conversation, proposal, store };
}

function command(task) {
  return {
    action: 'set_owner',
    source: { board: task.board, taskId: task.id },
    sourceFingerprint: sourceFingerprint(task),
    payload: { owner: 'Anja' },
    idempotencyKey: 'persistent-key',
  };
}

test('restart after Kanban write performs readback and never duplicates the write', async (t) => {
  const h = fixture(t);
  let task = { id: 't_public01', board: 'operations', assignee: 'Rhajaina' };
  let writes = 0;
  let crashOnce = true;
  const kanban = {
    async readTask() {
      return structuredClone(task);
    },
    async applyAction() {
      writes += 1;
      task = { ...task, assignee: 'Anja' };
      if (crashOnce) {
        crashOnce = false;
        throw Object.assign(new Error('process_crashed_after_write'), { code: 'ECONNRESET' });
      }
      return { applied: true };
    },
  };
  const first = createAssistantReconciliation({
    store: h.store,
    executor: createAssistantActionExecutor({ kanban, scopeChecker: async () => 'covered' }),
    now: () => h.clock.value,
  });
  await assert.rejects(
    first.execute({
      proposalId: h.proposal.id,
      conversationId: h.conversation.id,
      command: command(task),
    })
  );
  assert.equal(writes, 1);
  assert.equal(h.store.getProposal(h.proposal.id).status, 'executing');
  assert.equal(h.store.getReceiptByProposalId(h.proposal.id), null);

  h.clock.value += 301;
  const restarted = createAssistantReconciliation({
    store: new AssistantStore({ database: h.store.database }),
    executor: createAssistantActionExecutor({ kanban, scopeChecker: async () => 'covered' }),
    now: () => h.clock.value,
  });
  const result = await restarted.processDue();
  assert.equal(result.open, 0);
  assert.equal(writes, 1);
  assert.equal(h.store.getProposal(h.proposal.id).status, 'executed');
  assert.equal(h.store.getReceiptByProposalId(h.proposal.id).readback.kanban.task.assignee, 'Anja');
});

test('restart after Matrix send reuses deterministic transaction and records one event', async (t) => {
  const h = fixture(t);
  let task = { id: 't_public01', board: 'operations', assignee: 'Rhajaina' };
  const transactions = new Map();
  let actualSends = 0;
  let failReadback = true;
  const kanban = {
    async readTask() {
      return structuredClone(task);
    },
    async applyAction() {
      task = { ...task, assignee: 'Anja' };
      return { applied: true };
    },
  };
  function matrix() {
    return createAssistantMatrixHandoffAdapter({
      async sender(request) {
        if (!transactions.has(request.transactionId)) {
          actualSends += 1;
          transactions.set(request.transactionId, '$event-persistent');
        }
        return { eventId: transactions.get(request.transactionId) };
      },
      async readback(request) {
        if (failReadback) throw new Error('matrix_readback_crash');
        return { eventId: request.eventId, content: { body: request.loopMarker } };
      },
    });
  }
  const input = {
    proposalId: h.proposal.id,
    conversationId: h.conversation.id,
    command: command(task),
    matrixInput: {
      handoffId: h.proposal.id,
      topicId: 'topic-1',
      sourceId: task.id,
      sourceBoard: task.board,
      responsibleAgent: 'Felix',
      text: 'Public handoff.',
      context: { payload: { references: { matrixRoom: { roomRef: '!publicroom:example.test' } } } },
    },
  };
  const first = createAssistantReconciliation({
    store: h.store,
    executor: createAssistantActionExecutor({ kanban, scopeChecker: async () => 'covered' }),
    matrixHandoff: matrix(),
    now: () => h.clock.value,
  });
  const pending = await first.execute(input);
  assert.equal(pending.pending, true);
  assert.equal(actualSends, 1);
  assert.equal(h.store.getProposal(h.proposal.id).status, 'executing');

  failReadback = false;
  h.clock.value += 301;
  const restarted = createAssistantReconciliation({
    store: new AssistantStore({ database: h.store.database }),
    executor: createAssistantActionExecutor({ kanban, scopeChecker: async () => 'covered' }),
    matrixHandoff: matrix(),
    now: () => h.clock.value,
  });
  await restarted.processDue();
  assert.equal(actualSends, 1);
  const receipt = h.store.getReceiptByProposalId(h.proposal.id);
  assert.equal(receipt.matrixEventId, '$event-persistent');
  assert.equal(h.store.listReconciliations().length, 0);
});

test('open cases expose owner and next attempt, escalate once after 24h, and operator actions audit', async (t) => {
  const h = fixture(t);
  const task = { id: 't_public01', board: 'operations', assignee: 'Rhajaina' };
  const executor = {
    async execute() {
      throw Object.assign(new Error('offline'), { code: 'offline' });
    },
    async reconcile() {
      throw Object.assign(new Error('offline'), { code: 'offline' });
    },
  };
  const reconciliation = createAssistantReconciliation({
    store: h.store,
    executor,
    now: () => h.clock.value,
  });
  await assert.rejects(
    reconciliation.execute({
      proposalId: h.proposal.id,
      conversationId: h.conversation.id,
      command: command(task),
    })
  );
  let item = reconciliation.listOpen()[0];
  assert.equal(item.owner, 'Operations');
  assert.ok(Number.isInteger(item.nextAttemptAt));
  const audit = {
    identity: 'operator:test',
    reason: 'Connectivity restored',
    evidence: 'probe-42',
    requestId: 'request-42',
  };
  reconciliation.retry(item.id, audit);
  h.clock.value = item.createdAt + DAY_SECONDS + 1;
  await reconciliation.processDue();
  item = h.store.getReconciliation(item.id);
  assert.equal(item.escalatedAt, h.clock.value);
  await reconciliation.processDue();
  assert.equal(item.owner, 'Rhajaina');
  assert.equal(
    h.store
      .listReconciliationEvents(item.id)
      .filter((event) => event.eventType === 'escalated.to_rhajaina').length,
    1
  );
  await assert.rejects(reconciliation.resolve(item.id, audit), /offline/);
  assert.equal(reconciliation.listOpen().length, 1);
  assert.ok(
    h.store
      .listReconciliationEvents(item.id)
      .some(
        (event) =>
          event.eventType === 'operator.retry_requested' &&
          event.payload.identity === 'operator:test'
      )
  );
});

test('privacy rejection happens before an outbox payload or side effect is persisted', async (t) => {
  const h = fixture(t);
  let writes = 0;
  const reconciliation = createAssistantReconciliation({
    store: h.store,
    executor: {
      async execute() {
        writes += 1;
      },
    },
  });
  await assert.rejects(
    Promise.resolve().then(() =>
      reconciliation.execute({
        proposalId: h.proposal.id,
        conversationId: h.conversation.id,
        command: {
          ...command({ id: 't_public01', board: 'operations', assignee: 'Rhajaina' }),
          source: { board: 'twl-netze-private', taskId: 't_private' },
        },
      })
    ),
    (error) => error.code === 'private_source_rejected'
  );
  assert.equal(writes, 0);
  assert.equal(h.store.listReconciliations({ includeClosed: true }).length, 0);
});

test('durable reconciliation lease allows only one concurrent processor', async (t) => {
  const h = fixture(t);
  const task = { id: 't_public01', board: 'operations', assignee: 'Rhajaina' };
  const item = h.store.startReconciliation({
    proposalId: h.proposal.id,
    conversationId: h.conversation.id,
    expectedFingerprint: sourceFingerprint(task),
    details: {
      command: command(task),
      conversationId: h.conversation.id,
      matrixInput: null,
      completedSteps: [],
    },
    createdAt: h.clock.value,
  }).item;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let executions = 0;
  const executor = {
    async reconcile() {
      return {
        applied: false,
        unchanged: true,
        readBack: { task, fingerprint: sourceFingerprint(task) },
      };
    },
    async execute() {
      executions += 1;
      await gate;
      const after = { ...task, assignee: 'Anja' };
      return {
        ok: true,
        status: 'applied',
        receipt: { readBack: { task: after, fingerprint: sourceFingerprint(after) } },
      };
    },
  };
  const first = createAssistantReconciliation({
    store: h.store,
    executor,
    now: () => h.clock.value,
    workerId: 'worker-a',
  });
  const second = createAssistantReconciliation({
    store: new AssistantStore({ database: h.store.database }),
    executor,
    now: () => h.clock.value,
    workerId: 'worker-b',
  });
  const a = first.processDue();
  await new Promise((resolve) => setImmediate(resolve));
  const b = await second.processDue();
  assert.equal(b.processed, 0);
  release();
  await a;
  assert.equal(executions, 1);
  assert.equal(h.store.getReconciliation(item.id).status, 'resolved');
});

test('required Matrix runtime absence remains matrix_pending without a receipt', async (t) => {
  const h = fixture(t);
  let task = { id: 't_public01', board: 'operations', assignee: 'Rhajaina' };
  const kanban = {
    async readTask() {
      return structuredClone(task);
    },
    async applyAction() {
      task = { ...task, assignee: 'Anja' };
      return { applied: true };
    },
  };
  const reconciliation = createAssistantReconciliation({
    store: h.store,
    executor: createAssistantActionExecutor({ kanban, scopeChecker: async () => 'covered' }),
    now: () => h.clock.value,
  });
  const result = await reconciliation.execute({
    proposalId: h.proposal.id,
    conversationId: h.conversation.id,
    command: command(task),
    matrixInput: {
      handoffId: h.proposal.id,
      topicId: 'topic-1',
      sourceId: task.id,
      sourceBoard: task.board,
      responsibleAgent: 'Felix',
      text: 'Public handoff.',
      context: { payload: { references: { matrixRoom: { roomRef: '!publicroom:example.test' } } } },
    },
  });
  assert.equal(result.pending, true);
  assert.equal(result.reconciliation.status, 'matrix_pending');
  assert.equal(h.store.getProposal(h.proposal.id).status, 'executing');
  assert.equal(h.store.getReceiptByProposalId(h.proposal.id), null);
});

test('operator actions reject missing audit identity, reason, evidence, or request id', async (t) => {
  const h = fixture(t);
  const task = { id: 't_public01', board: 'operations', assignee: 'Rhajaina' };
  const reconciliation = createAssistantReconciliation({
    store: h.store,
    executor: {
      async execute() {
        throw new Error('offline');
      },
      async reconcile() {
        return {
          applied: false,
          unchanged: true,
          readBack: { task, fingerprint: sourceFingerprint(task) },
        };
      },
    },
    now: () => h.clock.value,
  });
  await assert.rejects(
    reconciliation.execute({
      proposalId: h.proposal.id,
      conversationId: h.conversation.id,
      command: command(task),
    })
  );
  const item = reconciliation.listOpen()[0];
  assert.throws(() => reconciliation.retry(item.id, {}), /operator_identity_required/);
  await assert.rejects(
    reconciliation.resolve(item.id, { identity: 'operator' }),
    /operator_reason_required/
  );
});
