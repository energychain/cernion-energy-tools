'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createAssistantResultIngest, closureResult } = require('../lib/assistant-result-ingest');
const { AssistantStore } = require('../lib/assistant-store');
const { formatResultBlock, handoffMarker } = require('../lib/result-contract');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-result-ingest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AssistantStore({ database: path.join(root, 'assistant.db') });
  store.initialize();
  const conversation = store.createConversation({ createdAt: 1000 });
  const proposalMessage = store.appendMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'Handoff proposal',
    createdAt: 1000,
  });
  const proposal = store.createProposal({
    conversationId: conversation.id,
    messageId: proposalMessage.id,
    actionType: 'delegate',
    targetType: 'topic',
    targetId: 'topic_public01',
    payload: { assignee: 'Felix' },
    riskClass: 'low',
    scopeStatus: 'covered',
    idempotencyKey: 'result-fixture',
    createdAt: 1000,
  }).proposal;
  store.updateProposalStatus(proposal.id, 'confirmed', {
    expectedStatus: 'shadow',
    conversationId: conversation.id,
    updatedAt: 1001,
  });
  store.updateProposalStatus(proposal.id, 'executing', {
    expectedStatus: 'confirmed',
    conversationId: conversation.id,
    updatedAt: 1002,
  });
  store.saveReceipt({
    proposalId: proposal.id,
    conversationId: conversation.id,
    sourceBoard: 'operations',
    sourceTaskId: 't_public01',
    matrixRoomId: '!fachraum:example.test',
    matrixEventId: '$handoff-event',
    readback: { kanban: { task: { id: 't_public01', board: 'operations' } } },
    executedAt: 1003,
  });

  store.bindHandoff({
    proposalId: proposal.id,
    responsibleAgent: 'Felix',
    expectedSender: '@felix:example.test',
  });
  let task = {
    id: 't_public01',
    board: 'operations',
    title: 'Kundenfall abschließen',
    assignee: 'Felix',
    status: 'ready',
    result: '',
    comments: [{ body: 'case-id:case-9921' }],
  };
  let closeCalls = 0;
  let roundCalls = 0;
  const rounds = new Map();
  const clock = options.clock || { value: 1794650500 };
  const dependencies = {
    store,
    now: () => clock.value,
    allowedSenders: ['@felix:example.test', '@anja:example.test'],
    async readKanban() {
      return structuredClone(task);
    },
    async closeCase(input) {
      closeCalls += 1;
      task = { ...task, status: 'done', result: input.resultText, completed_at: 1794650400 };
      return { task: structuredClone(task) };
    },
    async createRound(input) {
      roundCalls += 1;
      const task = {
        id: `t_round0${roundCalls}`,
        board: 'operations',
        body: [
          `RESULT_OPERATION_ID: ${input.operationId}`,
          `PARENT_RESULT_ID: ${input.result.id}`,
          `SOURCE_TASK_ID: ${input.source.taskId}`,
          input.instruction,
        ].join('\n'),
      };
      rounds.set(input.operationId, { task });
      return { task };
    },
    readRound: async (input) => rounds.get(input.operationId) || null,
    ...options.dependencies,
  };
  const ingest = createAssistantResultIngest(dependencies);
  const contract = {
    proposalId: proposal.id,
    handoffId: proposal.id,
    sourceBoard: 'operations',
    sourceTaskId: 't_public01',
    status: 'completed',
    statement: 'Kundenfall wurde nachweisbar gelöst.',
    evidenceRefs: ['case-id:case-9921'],
    nextStep: null,
    responsibleAgent: 'Felix',
    occurredAt: 1794650400,
    outcomeCandidate: {
      type: 'customer_case_resolved',
      statement: 'Kundenfall fallabschließend gelöst',
    },
    managementDecision: null,
  };
  function event(overrides = {}) {
    const value = overrides.contract || contract;
    return {
      roomId: '!fachraum:example.test',
      eventId: '$result-event',
      sender: '@felix:example.test',
      replyToEventId: '$handoff-event',
      body: `${handoffMarker(proposal.id)}\n${formatResultBlock(value)}`,
      ...overrides,
      contract: undefined,
    };
  }
  return {
    clock,
    dependencies,
    setTask: (value) => {
      task = value;
    },
    contract,
    conversation,
    event,
    ingest,
    proposal,
    store,
    task: () => structuredClone(task),
    counts: () => ({ closeCalls, roundCalls }),
  };
}

test('free text is only a hint and exact room, reply-to, marker, and sender are mandatory', async (t) => {
  const h = fixture(t);
  assert.deepEqual(await h.ingest.ingestMatrix({ body: 'Agent says work is complete.' }), {
    classification: 'hint',
    closed: false,
    reason: 'machine_result_block_missing',
  });
  await assert.rejects(h.ingest.ingestMatrix(h.event({ sender: '@mallory:example.test' })), {
    code: 'matrix_sender_not_allowed',
  });
  await assert.rejects(h.ingest.ingestMatrix(h.event({ roomId: '!other:example.test' })), {
    code: 'matrix_handoff_correlation_mismatch',
  });
  await assert.rejects(h.ingest.ingestMatrix(h.event({ replyToEventId: '$wrong' })), {
    code: 'matrix_handoff_correlation_mismatch',
  });
  await assert.rejects(h.ingest.ingestMatrix(h.event({ body: formatResultBlock(h.contract) })), {
    code: 'matrix_handoff_correlation_mismatch',
  });
  assert.equal(h.store.listResults().length, 0);
});

test('verified return performs a second Kanban readback and replies exactly once in the original history', async (t) => {
  const h = fixture(t);
  const first = await h.ingest.ingestMatrix(h.event());
  const duplicate = await h.ingest.ingestMatrix(h.event());
  assert.equal(first.classification, 'verified_result');
  assert.equal(first.closed, false);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.replyMessageId, first.replyMessageId);
  assert.equal(h.store.listResults().length, 1);
  assert.ok(first.replyMessageId);
  assert.equal(
    h.store.listMessages(h.conversation.id).filter((message) => message.id === first.replyMessageId)
      .length,
    1
  );
  assert.equal(first.result.kanbanReadback.task.status, 'ready');
});

test('blocked returns become a concrete reconciliation question and cannot be accepted', async (t) => {
  const h = fixture(t);
  const blocked = {
    ...h.contract,
    status: 'blocked',
    evidenceRefs: [],
    nextStep: 'Soll Thorsten die fehlende Kundenfreigabe einholen?',
    outcomeCandidate: null,
  };
  const saved = await h.ingest.ingestMatrix(h.event({ eventId: '$blocked', contract: blocked }));
  assert.equal(saved.result.verificationStatus, 'needs_reconciliation');
  assert.match(saved.result.nextStep, /\?$/);
  await assert.rejects(
    h.ingest.decide(saved.result.id, 'accept', {
      identity: 'operator:test',
      reason: 'Reviewed result',
      evidence: 'case-id:case-9921',
      requestId: 'accept-blocked',
    }),
    { code: 'only_completed_result_can_be_accepted' }
  );
});

test('Thorsten can correct, continue, accept, and end with linked idempotent rounds', async (t) => {
  const h = fixture(t);
  const saved = await h.ingest.ingestMatrix(h.event());
  const corrected = await h.ingest.decide(saved.result.id, 'correct', {
    identity: 'operator:test',
    reason: 'Reviewed result',
    evidence: 'case-id:case-9921',
    requestId: 'round-correct-1',
    instruction: 'Bitte Evidenzbeschreibung präzisieren.',
  });
  const correctedRetry = await h.ingest.decide(saved.result.id, 'correct', {
    identity: 'operator:test',
    reason: 'Reviewed result',
    evidence: 'case-id:case-9921',
    requestId: 'round-correct-1',
    instruction: 'Bitte Evidenzbeschreibung präzisieren.',
  });
  const continued = await h.ingest.decide(saved.result.id, 'continue', {
    identity: 'operator:test',
    reason: 'Reviewed result',
    evidence: 'case-id:case-9921',
    requestId: 'round-continue-2',
    instruction: 'Bitte mit der Kundeninformation fortfahren.',
  });
  assert.equal(corrected.round.roundNumber, 1);
  assert.equal(correctedRetry.deduplicated, true);
  assert.equal(continued.round.roundNumber, 2);
  assert.equal(continued.round.parentRoundId, corrected.round.id);
  assert.deepEqual(h.counts(), { closeCalls: 0, roundCalls: 2 });

  const accepted = await h.ingest.decide(saved.result.id, 'accept', {
    identity: 'operator:test',
    reason: 'Reviewed result',
    evidence: 'case-id:case-9921',
    requestId: 'accept-1',
  });
  const acceptedRetry = await h.ingest.decide(saved.result.id, 'accept', {
    identity: 'operator:test',
    reason: 'Reviewed result',
    evidence: 'case-id:case-9921',
    requestId: 'accept-retry',
  });
  assert.equal(accepted.closed, true);
  assert.equal(accepted.result.verificationStatus, 'accepted');
  assert.equal(acceptedRetry.deduplicated, true);
  assert.deepEqual(h.counts(), { closeCalls: 1, roundCalls: 2 });
  await assert.rejects(
    h.ingest.decide(saved.result.id, 'continue', {
      identity: 'operator:test',
      reason: 'Reviewed result',
      evidence: 'case-id:case-9921',
      requestId: 'round-after-close',
      instruction: 'Nicht mehr fortsetzen.',
    }),
    { code: 'result_already_decided' }
  );

  const other = fixture(t);
  const otherSaved = await other.ingest.ingestMatrix(other.event());
  const ended = await other.ingest.decide(otherSaved.result.id, 'end', {
    identity: 'operator:test',
    reason: 'Reviewed result',
    evidence: 'case-id:case-9921',
    requestId: 'end-1',
  });
  assert.equal(ended.result.verificationStatus, 'ended');
  assert.match(other.task().result, /AGENT_RESULT_DECISION: end/);
});

test('closure requires accepted or ended terminal Kanban readback', async (t) => {
  const h = fixture(t);
  const saved = await h.ingest.ingestMatrix(h.event());
  let readCount = 0;
  const failing = createAssistantResultIngest({
    store: h.store,
    allowedSenders: ['@felix:example.test'],
    readKanban: async () => {
      readCount += 1;
      return readCount === 1 ? h.task() : { ...h.task(), status: 'ready' };
    },
    closeCase: async () => ({
      task: { id: 't_public01', board: 'operations', status: 'ready' },
    }),
  });
  await assert.rejects(
    failing.decide(saved.result.id, 'accept', {
      identity: 'operator:test',
      reason: 'Reviewed result',
      evidence: 'case-id:case-9921',
      requestId: 'accept-no-close',
    }),
    {
      code: 'terminal_kanban_readback_required',
    }
  );
  assert.equal(h.store.getResult(saved.result.id).operatorDecision, null);
});

test('acceptance fails closed when the evidence-bearing task changed after verification', async (t) => {
  const h = fixture(t);
  const saved = await h.ingest.ingestMatrix(h.event());
  h.setTask({
    ...h.task(),
    comments: [{ body: 'Evidence was removed after the agent result.' }],
  });
  await assert.rejects(
    h.ingest.decide(saved.result.id, 'accept', {
      identity: 'operator:test',
      reason: 'Reviewed result',
      evidence: 'case-id:case-9921',
      requestId: 'accept-stale-evidence',
    }),
    { code: 'result_source_changed_since_verification' }
  );
  assert.deepEqual(h.counts(), { closeCalls: 0, roundCalls: 0 });
  assert.equal(h.task().status, 'ready');
});

test('closureResult carries accepted outcome evidence but end never projects an outcome', () => {
  const result = {
    id: 'result_abc',
    statement: 'Done',
    evidenceRefs: ['case-id:case-9921'],
    occurredAt: 1794650400,
    outcomeCandidate: { type: 'customer_case_resolved', statement: 'Resolved' },
  };
  assert.match(closureResult(result, 'accept'), /OUTCOME_TYPE: customer_case_resolved/);
  assert.doesNotMatch(closureResult(result, 'end'), /OUTCOME_TYPE:/);
});
