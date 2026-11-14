'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createAssistantResultIngest } = require('../lib/assistant-result-ingest');
const { AssistantStore } = require('../lib/assistant-store');
const { ManagementStore } = require('../lib/management-store');
const { ProjectionRunner } = require('../lib/projection-runner');
const { formatResultBlock, handoffMarker } = require('../lib/result-contract');

test('return -> accept -> closure -> rebuild exposes outcome, topic, brief, and assistant history', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-result-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assistantStore = new AssistantStore({ database: path.join(root, 'assistant.db') });
  assistantStore.initialize();
  const conversation = assistantStore.createConversation({ createdAt: 1700000000 });
  const message = assistantStore.appendMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'Delegation an Felix',
    createdAt: 1700000000,
  });
  const proposal = assistantStore.createProposal({
    conversationId: conversation.id,
    messageId: message.id,
    actionType: 'delegate',
    targetType: 'topic',
    targetId: 'topic_customer_case',
    payload: { assignee: 'Felix' },
    riskClass: 'low',
    scopeStatus: 'covered',
    idempotencyKey: 'integration-result',
    createdAt: 1700000001,
  }).proposal;
  assistantStore.updateProposalStatus(proposal.id, 'confirmed', {
    expectedStatus: 'shadow',
    conversationId: conversation.id,
    updatedAt: 1700000002,
  });
  assistantStore.updateProposalStatus(proposal.id, 'executing', {
    expectedStatus: 'confirmed',
    conversationId: conversation.id,
    updatedAt: 1700000003,
  });
  assistantStore.saveReceipt({
    proposalId: proposal.id,
    conversationId: conversation.id,
    sourceBoard: 'operations',
    sourceTaskId: 't_public01',
    matrixRoomId: '!fachraum:example.test',
    matrixEventId: '$handoff',
    readback: { kanban: { task: { id: 't_public01', board: 'operations' } } },
    executedAt: 1700000004,
  });

  assistantStore.bindHandoff({
    proposalId: proposal.id,
    responsibleAgent: 'Felix',
    expectedSender: '@felix:example.test',
  });
  let task = {
    id: 't_public01',
    board: 'operations',
    title: 'Kundenfall Stadtwerk Beispiel abschließen',
    body: 'Öffentlicher Kundenfall mit fallabschließender Bearbeitung.',
    assignee: 'Felix',
    status: 'ready',
    priority: 1,
    created_by: 'Rhajaina',
    created_at: 1700000000,
    started_at: 1700000100,
    completed_at: null,
    tenant: 'test',
    result: '',
    block_kind: null,
    project_id: 'customer-case',
    comments: [{ body: 'case-id:case-9921' }],
    attachments: [],
    reversibleInternal: true,
  };
  const ingest = createAssistantResultIngest({
    store: assistantStore,
    now: () => 1794650500,
    allowedSenders: ['@felix:example.test'],
    readKanban: async () => structuredClone(task),
    closeCase: async ({ resultText }) => {
      task = {
        ...task,
        status: 'done',
        result: resultText,
        completed_at: 1794650400,
      };
      return { task: structuredClone(task) };
    },
  });
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
      statement: 'Kundenfall Stadtwerk Beispiel fallabschließend gelöst',
    },
    managementDecision: null,
  };
  const returned = await ingest.ingestMatrix({
    roomId: '!fachraum:example.test',
    eventId: '$result',
    sender: '@felix:example.test',
    replyToEventId: '$handoff',
    body: `${handoffMarker(proposal.id)}\n${formatResultBlock(contract)}`,
  });
  assert.equal(returned.result.verificationStatus, 'awaiting_acceptance');
  const accepted = await ingest.decide(returned.result.id, 'accept', {
    requestId: 'accept-integration',
    identity: 'operator:test',
    reason: 'Reviewed closure',
    evidence: 'case-id:case-9921',
  });
  assert.equal(accepted.result.verificationStatus, 'accepted');
  assert.equal(task.status, 'done');

  const managementDatabase = path.join(root, 'management.db');
  const source = {
    generatedAt: 1794650500,
    count: 1,
    errors: [],
    boards: [{ board: 'operations', count: 1, items: [structuredClone(task)] }],
  };
  const rebuilt = new ProjectionRunner({
    database: managementDatabase,
    loadSource: () => structuredClone(source),
    now: () => 1794650600,
  }).runOnce();
  assert.equal(rebuilt.status, 'success');

  const managementStore = new ManagementStore({ database: managementDatabase });
  const outcomes = managementStore.query(
    'SELECT outcome_type,statement,source_task_id FROM outcomes'
  );
  assert.deepEqual(outcomes, [
    {
      outcome_type: 'customer_case_resolved',
      statement: 'Kundenfall Stadtwerk Beispiel fallabschließend gelöst',
      source_task_id: 't_public01',
    },
  ]);
  const topics = managementStore.query('SELECT title,impact_statement FROM management_topics');
  assert.equal(topics.length, 1);
  assert.match(topics[0].title, /Kundenfall/);
  assert.equal(topics[0].impact_statement, outcomes[0].statement);
  const briefs = managementStore.query(
    "SELECT agent_id,outcomes_json,last_substantive_progress_at FROM agent_briefs WHERE agent_id='Felix'"
  );
  assert.equal(briefs.length, 1);
  assert.match(briefs[0].outcomes_json, /fallabschließend gelöst/);
  assert.equal(briefs[0].last_substantive_progress_at, 1794650400);

  const history = assistantStore.listMessages(conversation.id);
  const resultMessage = history.find((item) => item.id === returned.replyMessageId);
  assert.ok(resultMessage);
  assert.match(resultMessage.content, /Fachagentenergebnis/);
  assert.match(resultMessage.content, /case-id:case-9921/);
});
