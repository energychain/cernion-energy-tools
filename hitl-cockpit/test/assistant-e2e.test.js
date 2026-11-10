'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const directives = require('./fixtures/assistant-directives.json');
const { AssistantStore } = require('../lib/assistant-store');
const { createAssistantService } = require('../lib/assistant-service');
const { sourceFingerprint } = require('../lib/assistant-action-executor');

let sequence = 0;
function clientId() {
  sequence += 1;
  return `10000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function harness(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-e2e-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AssistantStore({ database: path.join(root, 'assistant.db') });
  store.initialize();
  const writes = [];
  const matrix = [];
  const transport = [];
  const task = {
    id: 't_public01',
    board: 'operations',
    title: 'Public task',
    status: 'blocked',
    assignee: options.taskAssignee === undefined ? 'Rhajaina' : options.taskAssignee,
    priority: 1,
  };
  const mode = options.mode || 'read_only';
  const config = {
    enabled: true,
    mode,
    writesEnabled: options.writesEnabled ?? !['read_only', 'shadow'].includes(mode),
    matrixHandoffEnabled: options.matrixHandoffEnabled || false,
    actionAllowlist: options.actionAllowlist || [],
    transport: { timeoutMs: 1000, runBudgetSeconds: 1 },
    limits: {
      maxMessageChars: 4000,
      recentMessageCount: 4,
      maxContextChars: 12000,
      sessionRotateMessages: 20,
    },
  };
  const contextResolver = {
    resolve({ objectType, objectId }) {
      if (objectId === 'private') {
        throw Object.assign(new Error('unavailable'), {
          code: 'assistant_context_not_available',
          status: 404,
        });
      }
      const type = objectType || 'global';
      const payload =
        type === 'global'
          ? { counts: { topics: 1 } }
          : {
              topicId: type === 'topic' ? objectId : 'topic-1',
              decisionId: type === 'decision' ? objectId : 'decision-1',
              references: {
                sourceTasks: [{ board: task.board, taskId: task.id }],
                matrixRoom: { roomRef: '!publicroom:example.test' },
              },
            };
      return {
        objectType: type,
        objectId: objectId || null,
        payload,
        fingerprint: 'c'.repeat(64),
      };
    },
  };
  const client = {
    async send(input) {
      transport.push(input);
      if (options.transportError)
        throw Object.assign(new Error('transport'), options.transportError);
      const selected = options.response || directives.answer;
      return {
        text: selected.text,
        assistant_directive: selected.directive,
        hermesSessionId: '20261109_182510_c5a695',
        runId: input.runId,
      };
    },
  };
  const executor = {
    async execute(input) {
      writes.push(structuredClone(input));
      if (options.executionResult) return options.executionResult(input, task);
      const after = { ...task, appliedAction: input.action, appliedPayload: input.payload };
      return {
        ok: true,
        status: 'applied',
        sourceFingerprint: input.sourceFingerprint,
        deduplicated: false,
        receipt: {
          readBack: { task: after, fingerprint: sourceFingerprint(after) },
        },
      };
    },
  };
  const matrixHandoff = {
    async deliver(input) {
      matrix.push(structuredClone(input));
      return (
        options.matrixResult || {
          status: 'delivered',
          roomRef: input.context.payload.references.matrixRoom.roomRef,
          eventId: '$event-1',
          loopMarker: `ASSISTANT_MATRIX_HANDOFF:${input.handoffId}`,
        }
      );
    },
  };
  const service = createAssistantService({
    store,
    contextResolver,
    client,
    config,
    executor,
    sourceResolver: async ({ context }) => {
      const source = context.sourceTasks[0];
      return { source, task };
    },
    scopeChecker: async () => (options.scopeCovered ? 'covered' : { covered: false }),
    matrixHandoff,
  });
  async function turn(context, text = 'test') {
    const conversation = service.createConversation(context || {});
    const run = service.submitMessage({
      conversationId: conversation.id,
      text,
      clientMessageId: clientId(),
    });
    await service.drain(conversation.id);
    return { conversation, run: service.getRun(run.id) };
  }
  return { config, matrix, service, store, task, transport, turn, writes };
}

test('global answer and ambiguous clarification complete without proposals or writes', async (t) => {
  const answer = harness(t, { response: directives.answer });
  const completed = await answer.turn({});
  assert.equal(completed.run.status, 'completed');
  assert.equal(answer.store.listProposals().length, 0);
  assert.equal(answer.writes.length, 0);

  const clarification = harness(t, { response: directives.clarification });
  const clarified = await clarification.turn({});
  assert.equal(clarified.run.status, 'completed');
  assert.equal(clarification.store.listProposals().length, 0);
  assert.equal(clarification.writes.length, 0);
});

test('topic delegate is persisted idempotently as shadow and sanitized on its assistant message', async (t) => {
  const h = harness(t, { mode: 'shadow', response: directives.delegate });
  const { conversation, run } = await h.turn({ objectType: 'topic', objectId: 'topic-1' });
  assert.equal(run.status, 'completed');
  const proposals = h.service.listProposals({ conversationId: conversation.id });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'shadow');
  assert.match(proposals[0].id, /^proposal_[0-9a-f-]{36}$/);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.transport[0].context, {
    objectType: 'topic',
    objectId: 'topic-1',
    payload: {
      topicId: 'topic-1',
      decisionId: 'decision-1',
      references: {
        sourceTasks: [{ board: 'operations', taskId: 't_public01' }],
        matrixRoom: { roomRef: '!publicroom:example.test' },
      },
    },
  });
  const assistant = h.service.listMessages(conversation.id).items.at(-1);
  assert.equal(assistant.content, directives.delegate.text);
  assert.equal(assistant.proposal.mappedAction, 'set_owner');
  assert.equal(assistant.receipt, null);
  assert.equal(Object.hasOwn(assistant.proposal, 'payload'), false);
});

test('decision feedback and wakeup map to low-risk exact actions with readback receipts', async (t) => {
  for (const item of [
    {
      response: directives.feedback,
      context: { objectType: 'decision', objectId: 'decision-1' },
      action: 'return_for_completion',
    },
    {
      response: directives.wakeup,
      context: { objectType: 'wakeup', objectId: 'wakeup-1' },
      action: 'schedule_wakeup',
    },
  ]) {
    const h = harness(t, {
      mode: 'low_risk',
      response: item.response,
      actionAllowlist: [item.action],
    });
    const { conversation } = await h.turn(item.context);
    const proposal = h.service.listProposals({ conversationId: conversation.id })[0];
    const result = await h.service.confirmProposal(proposal.id);
    assert.equal(result.proposal.status, 'executed');
    assert.equal(result.receipt.afterFingerprint.length, 64);
    assert.equal(h.writes[0].action, item.action);
  }
});

test('duplicate submit and duplicate confirm produce one transport, one write, and one receipt', async (t) => {
  const h = harness(t, {
    mode: 'low_risk',
    response: directives.followup,
    actionAllowlist: ['delegate_followup'],
  });
  const conversation = h.service.createConversation({ objectType: 'topic', objectId: 'topic-1' });
  const id = clientId();
  const first = h.service.submitMessage({
    conversationId: conversation.id,
    text: 'once',
    clientMessageId: id,
  });
  const duplicate = h.service.submitMessage({
    conversationId: conversation.id,
    text: 'once',
    clientMessageId: id,
  });
  assert.equal(duplicate.id, first.id);
  await h.service.drain(conversation.id);
  assert.equal(h.transport.length, 1);
  const proposal = h.service.listProposals({ conversationId: conversation.id })[0];
  const [confirmed, repeated] = await Promise.all([
    h.service.confirmProposal(proposal.id),
    h.service.confirmProposal(proposal.id),
  ]);
  assert.equal(h.writes.length, 1);
  assert.equal(confirmed.receipt.id, repeated.receipt.id);
  assert.equal(h.store.getReceiptByProposalId(proposal.id).id, confirmed.receipt.id);
  assert.equal(h.writes[0].payload.assignee, 'Felix');
});

test('follow-up without an assignee uses only the selected source task assignment', async (t) => {
  const response = {
    text: 'Ich schlage einen Folgeauftrag vor.',
    directive: {
      intent: 'create_followup',
      target: { objectType: 'topic', objectId: 'topic-1' },
      payload: { title: 'Belege prüfen', description: 'Nur die belegte Quelle bearbeiten.' },
    },
  };
  const assigned = harness(t, {
    mode: 'low_risk',
    response,
    actionAllowlist: ['delegate_followup'],
    taskAssignee: 'Rhajaina',
  });
  const assignedTurn = await assigned.turn({ objectType: 'topic', objectId: 'topic-1' });
  const assignedProposal = assigned.service.listProposals({
    conversationId: assignedTurn.conversation.id,
  })[0];
  await assigned.service.confirmProposal(assignedProposal.id);
  assert.equal(assigned.writes[0].payload.assignee, 'Rhajaina');

  const unassigned = harness(t, {
    mode: 'low_risk',
    response,
    actionAllowlist: ['delegate_followup'],
    taskAssignee: '',
  });
  const unassignedTurn = await unassigned.turn({ objectType: 'topic', objectId: 'topic-1' });
  const unassignedProposal = unassigned.service.listProposals({
    conversationId: unassignedTurn.conversation.id,
  })[0];
  await assert.rejects(
    unassigned.service.confirmProposal(unassignedProposal.id),
    (error) => error.code === 'assignee_required' && error.status === 400
  );
  assert.equal(unassigned.writes.length, 0);

  await unassigned.service.confirmProposal(unassignedProposal.id, { assignee: 'Felix' });
  assert.equal(unassigned.writes.length, 1);
  assert.equal(unassigned.writes[0].payload.assignee, 'Felix');
});

test('private context is a 404 without transport and timeout produces no proposal or write', async (t) => {
  const privateHarness = harness(t);
  assert.throws(
    () => privateHarness.service.createConversation({ objectType: 'topic', objectId: 'private' }),
    (error) => error.status === 404 && error.code === 'assistant_context_not_available'
  );
  assert.equal(privateHarness.transport.length, 0);

  const timed = harness(t, {
    mode: 'productive',
    response: directives.followup,
    actionAllowlist: ['delegate_followup'],
    scopeCovered: true,
    transportError: { code: 'transport_timeout' },
  });
  const failed = await timed.turn({ objectType: 'topic', objectId: 'topic-1' });
  assert.equal(failed.run.status, 'failed');
  assert.equal(failed.run.errorCode, 'transport_timeout');
  assert.equal(timed.store.listProposals().length, 0);
  assert.equal(timed.writes.length, 0);
});

test('read_only and shadow modes never invoke the executor', async (t) => {
  const readOnly = harness(t, { mode: 'read_only', response: directives.followup });
  const denied = await readOnly.turn({ objectType: 'topic', objectId: 'topic-1' });
  assert.equal(denied.run.status, 'failed');
  assert.equal(denied.run.errorCode, 'assistant_directive_policy_denied');
  assert.equal(readOnly.writes.length, 0);
  assert.equal(readOnly.store.listProposals().length, 0);

  const shadow = harness(t, { mode: 'shadow', response: directives.followup });
  await shadow.turn({ objectType: 'topic', objectId: 'topic-1' });
  assert.equal(shadow.store.listProposals().length, 1);
  assert.equal(shadow.writes.length, 0);
});

test('scoped owner action is denied without coverage and executes with injected coverage only', async (t) => {
  const denied = harness(t, {
    mode: 'scoped',
    response: directives.delegate,
    actionAllowlist: ['set_owner'],
  });
  const deniedTurn = await denied.turn({ objectType: 'topic', objectId: 'topic-1' });
  const deniedProposal = denied.service.listProposals({
    conversationId: deniedTurn.conversation.id,
  })[0];
  await assert.rejects(
    denied.service.confirmProposal(deniedProposal.id),
    (error) => error.code === 'scope_not_covered' && error.status === 403
  );
  assert.equal(denied.writes.length, 0);

  const covered = harness(t, {
    mode: 'scoped',
    response: directives.delegate,
    actionAllowlist: ['set_owner'],
    scopeCovered: true,
  });
  const coveredTurn = await covered.turn({ objectType: 'topic', objectId: 'topic-1' });
  const proposal = covered.service.listProposals({
    conversationId: coveredTurn.conversation.id,
  })[0];
  await covered.service.confirmProposal(proposal.id);
  assert.equal(covered.writes.length, 1);
  assert.equal(covered.writes[0].action, 'set_owner');
  assert.equal(covered.writes[0].payload.owner, 'Anja');
});

test('productive mode auto-executes only covered allowlisted actions', async (t) => {
  const covered = harness(t, {
    mode: 'productive',
    response: directives.followup,
    actionAllowlist: ['delegate_followup'],
    scopeCovered: true,
  });
  const completed = await covered.turn({ objectType: 'topic', objectId: 'topic-1' });
  assert.equal(completed.run.status, 'completed');
  assert.equal(covered.writes.length, 1);
  assert.equal(covered.store.listProposals()[0].status, 'executed');

  const notAllowlisted = harness(t, {
    mode: 'productive',
    response: directives.followup,
    actionAllowlist: ['ask_question'],
    scopeCovered: true,
  });
  await notAllowlisted.turn({ objectType: 'topic', objectId: 'topic-1' });
  assert.equal(notAllowlisted.writes.length, 0);
  assert.equal(notAllowlisted.store.listProposals()[0].status, 'shadow');
});

test('Matrix handoff occurs after Kanban success, deduplicates, and pending keeps Kanban executed', async (t) => {
  const pending = harness(t, {
    mode: 'low_risk',
    response: directives.followup,
    actionAllowlist: ['delegate_followup'],
    matrixHandoffEnabled: true,
    matrixResult: { status: 'pending', error: 'matrix_delivery_failed' },
  });
  const completed = await pending.turn({ objectType: 'topic', objectId: 'topic-1' });
  const proposal = pending.service.listProposals({ conversationId: completed.conversation.id })[0];
  const first = await pending.service.confirmProposal(proposal.id);
  const duplicate = await pending.service.confirmProposal(proposal.id);
  assert.equal(pending.writes.length, 1);
  assert.equal(pending.matrix.length, 1);
  assert.equal(first.proposal.status, 'executed');
  assert.equal(first.receipt.matrix.status, 'pending');
  assert.equal(duplicate.receipt.id, first.receipt.id);
  assert.match(pending.matrix[0].handoffId, /^proposal_/);
  assert.doesNotMatch(pending.matrix[0].text, /Belege sammeln|Öffentliche Belege/);
});
