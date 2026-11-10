'use strict';

const crypto = require('node:crypto');
const { buildAssistantSummary } = require('./assistant-summary');
const { parseAssistantDirective } = require('./assistant-directives');
const { LOW_RISK_ACTIONS, SCOPED_ACTIONS } = require('./assistant-config');
const { sourceFingerprint } = require('./assistant-action-executor');

const OBJECT_TYPES = new Set(['topic', 'decision', 'department', 'outcome', 'risk', 'wakeup']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECTIVE_ACTION_MAP = Object.freeze({
  record_feedback: 'return_for_completion',
  delegate: 'set_owner',
  create_followup: 'delegate_followup',
  schedule_wakeup: 'schedule_wakeup',
  prepare_decision: 'ask_question',
  mark_no_action: 'return_for_completion',
  change_priority: 'set_priority',
});

function mappedAction(proposal) {
  const action = DIRECTIVE_ACTION_MAP[proposal.actionType] || proposal.actionType;
  const value = proposal.payload || {};
  if (proposal.actionType === 'record_feedback') {
    return { action, payload: { reason: value.feedback } };
  }
  if (proposal.actionType === 'delegate') {
    return { action, payload: { owner: value.assignee } };
  }
  if (proposal.actionType === 'create_followup') {
    return {
      action,
      payload: {
        assignee: value.assignee,
        followup: [value.title, value.description].filter(Boolean).join(': '),
      },
    };
  }
  if (proposal.actionType === 'schedule_wakeup') {
    return {
      action,
      payload: { wakeAt: value.wakeAt, reason: value.reason, nextAction: value.reason },
    };
  }
  if (proposal.actionType === 'prepare_decision') {
    return { action, payload: { question: value.question } };
  }
  if (proposal.actionType === 'mark_no_action') {
    return { action, payload: { reason: value.reason } };
  }
  return { action, payload: structuredClone(value) };
}

function withResolvedAssignee(mapped, resolved, options = {}) {
  if (mapped.action !== 'delegate_followup') return mapped;
  const explicit =
    typeof mapped.payload.assignee === 'string' ? mapped.payload.assignee.trim() : '';
  if (explicit) return mapped;
  const selected = typeof options.assignee === 'string' ? options.assignee.trim() : '';
  if (selected) {
    if (selected.length > 128) throw serviceError('assignee_too_long');
    return {
      ...mapped,
      payload: { ...mapped.payload, assignee: selected },
    };
  }
  const sourceAssignee =
    typeof resolved.sourceAssignee === 'string' ? resolved.sourceAssignee.trim() : '';
  if (!sourceAssignee) throw serviceError('assignee_required');
  return {
    ...mapped,
    payload: { ...mapped.payload, assignee: sourceAssignee },
  };
}

function proposalSummary(proposal) {
  const mapped = mappedAction(proposal);
  return {
    id: proposal.id,
    actionType: proposal.actionType,
    mappedAction: mapped.action,
    targetType: proposal.targetType,
    targetId: proposal.targetId,
    riskClass: proposal.riskClass,
    scopeStatus: proposal.scopeStatus,
    status: proposal.status,
    assigneeRequired:
      mapped.action === 'delegate_followup' &&
      !(typeof mapped.payload.assignee === 'string' && mapped.payload.assignee.trim()),
  };
}

function receiptSummary(receipt) {
  if (!receipt) return null;
  return {
    id: receipt.id,
    proposalId: receipt.proposalId,
    sourceBoard: receipt.sourceBoard,
    sourceTaskId: receipt.sourceTaskId,
    beforeFingerprint: receipt.beforeFingerprint,
    afterFingerprint: receipt.afterFingerprint,
    executedAt: receipt.executedAt,
    matrix: receipt.readback && receipt.readback.matrix ? receipt.readback.matrix : null,
  };
}

function serviceError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function rotatedSessionName(conversation) {
  const suffix = `-r${conversation.sessionMessageCount}-${crypto.randomUUID().slice(0, 8)}`;
  return `${conversation.sessionName.slice(0, 121 - suffix.length)}${suffix}`;
}

function runLeaseSeconds(config) {
  const timeoutMs = Number(config.transport && config.transport.timeoutMs);
  const budgetMs = Number(config.transport && config.transport.runBudgetSeconds) * 1000;
  const boundedMs = Math.max(
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0,
    Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 0,
    1000
  );
  return Math.max(5, Math.min(60 * 60, Math.ceil(boundedMs / 1000) + 5));
}

function createAssistantService(options = {}) {
  const { store, contextResolver, client, config } = options;
  if (!store || !contextResolver || !client || !config)
    throw new Error('assistant_service_dependencies_required');
  const summaryConfig = {
    triggerMessages: 12,
    retainMessages: Math.max(2, config.limits.recentMessageCount || 2),
    maxChars: 1200,
    ...(options.summary || {}),
  };
  const queues = new Map();
  const queuedRuns = new Set();
  const proposalExecutions = new Map();
  const executor = options.executor || null;
  const sourceResolver = options.sourceResolver || null;
  const scopeChecker = options.scopeChecker || null;
  const matrixHandoff = options.matrixHandoff || null;
  const sleep =
    options.sleep ||
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const nowMs = options.nowMs || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const workerId = String(options.workerId || `assistant-worker-${crypto.randomUUID()}`);
  const leaseSeconds = options.leaseSeconds || runLeaseSeconds(config);
  const transportTimeoutMs = Number(config.transport && config.transport.timeoutMs);
  const runBudgetMs = Number(config.transport && config.transport.runBudgetSeconds) * 1000;
  const defaultClaimWaitMs = 5 * 60 * 1000;
  const claimWaitMs = Math.max(
    1,
    Math.min(
      Number.isFinite(transportTimeoutMs) && transportTimeoutMs > 0
        ? transportTimeoutMs
        : defaultClaimWaitMs,
      Number.isFinite(runBudgetMs) && runBudgetMs > 0 ? runBudgetMs : defaultClaimWaitMs
    )
  );
  const claimPollMs = Math.max(1, Math.min(options.claimPollMs || 10, claimWaitMs));
  let pendingRunsResumed = false;

  function requireEnabled() {
    if (config.enabled !== true) throw serviceError('assistant_disabled', 404);
  }

  function createConversation(input = {}) {
    requireEnabled();
    const objectType = input.objectType || null;
    const objectId = input.objectId || null;
    if ((objectType === null) !== (objectId === null)) throw serviceError('invalid_context');
    if (
      objectType &&
      (!OBJECT_TYPES.has(objectType) ||
        typeof objectId !== 'string' ||
        !objectId ||
        objectId.length > 128)
    ) {
      throw serviceError('invalid_context');
    }
    if (objectType) contextResolver.resolve({ objectType, objectId });
    const conversation = store.createConversation({ objectType, objectId });
    store.appendEvent({
      conversationId: conversation.id,
      eventType: 'conversation_created',
      payload: { objectType, objectId },
    });
    return conversation;
  }

  function listConversations() {
    requireEnabled();
    return store.listConversations();
  }
  function getConversation(id) {
    const value = store.getConversation(id);
    if (!value) throw serviceError('conversation_not_found', 404);
    return value;
  }

  function queueRun(run, notBeforeMs = 0) {
    if (!run || queuedRuns.has(run.id)) return queues.get(run && run.conversationId);
    queuedRuns.add(run.id);
    const delay = Math.max(0, notBeforeMs - nowMs());
    const ready =
      delay > 0
        ? new Promise((resolve) => {
            const timer = setTimer(resolve, delay);
            if (timer && typeof timer.unref === 'function') timer.unref();
          })
        : Promise.resolve();
    const previous = queues.get(run.conversationId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => ready)
      .then(() => processRun(run.id))
      .finally(() => {
        queuedRuns.delete(run.id);
        if (queues.get(run.conversationId) === next) queues.delete(run.conversationId);
      });
    queues.set(run.conversationId, next);
    return next;
  }

  function listProposals(input = {}) {
    requireEnabled();
    if (input.conversationId) getConversation(input.conversationId);
    const allowedStatuses = new Set([
      'shadow',
      'confirmed',
      'executing',
      'executed',
      'failed',
      'rejected',
      'expired',
    ]);
    if (input.status && !allowedStatuses.has(input.status)) throw serviceError('invalid_status');
    return store.listProposals({
      conversationId: input.conversationId || null,
      status: input.status || null,
    });
  }

  function trustedSourceReferences(context) {
    const references = context?.payload?.references?.sourceTasks;
    return Array.isArray(references)
      ? references.filter(
          (item) => item && typeof item.board === 'string' && typeof item.taskId === 'string'
        )
      : [];
  }

  async function resolveExecutionSource(proposal, context) {
    if (typeof sourceResolver !== 'function')
      throw serviceError('action_source_not_available', 403);
    const resolved = await sourceResolver({
      proposal: proposalSummary(proposal),
      context: {
        objectType: context.objectType,
        objectId: context.objectId,
        fingerprint: context.fingerprint,
        sourceTasks: trustedSourceReferences(context),
      },
    });
    const source = resolved && resolved.source;
    const trusted = trustedSourceReferences(context).some(
      (item) => item.board === source?.board && item.taskId === source?.taskId
    );
    if (!trusted) throw serviceError('action_source_not_available', 403);
    const fingerprint =
      typeof resolved.sourceFingerprint === 'string'
        ? resolved.sourceFingerprint
        : resolved.task
          ? sourceFingerprint(resolved.task)
          : null;
    if (!/^[0-9a-f]{64}$/.test(String(fingerprint || ''))) {
      throw serviceError('action_source_not_available', 403);
    }
    return {
      source: { board: source.board, taskId: source.taskId },
      sourceFingerprint: fingerprint,
      sourceAssignee:
        typeof resolved.task?.assignee === 'string' && resolved.task.assignee.trim()
          ? resolved.task.assignee.trim()
          : null,
    };
  }

  async function coveredByServerScope(action, source, proposal, context) {
    if (typeof scopeChecker !== 'function') return false;
    const result = await scopeChecker({
      action,
      source: { ...source },
      proposalId: proposal.id,
      target: { objectType: proposal.targetType, objectId: proposal.targetId },
      context: {
        objectType: context.objectType,
        objectId: context.objectId,
        fingerprint: context.fingerprint,
      },
    });
    return result === 'covered' || Boolean(result && result.covered === true);
  }

  async function deliverMatrixAfterReceipt(proposal, action, source, context) {
    if (!config.matrixHandoffEnabled) return null;
    if (!matrixHandoff || typeof matrixHandoff.deliver !== 'function') {
      return { status: 'pending', error: 'matrix_handoff_not_available' };
    }
    const topicId =
      context.objectType === 'topic'
        ? context.objectId
        : context.payload && context.payload.topicId;
    const decisionId =
      context.objectType === 'decision'
        ? context.objectId
        : context.payload && context.payload.decisionId;
    if (!topicId && !decisionId) {
      return { status: 'pending', error: 'matrix_context_not_available' };
    }
    const result = await matrixHandoff.deliver({
      handoffId: proposal.id,
      topicId,
      decisionId,
      sourceId: source.taskId,
      text: `Kanban action ${action} applied for ${source.taskId}.`,
      context,
    });
    return {
      status: result.status === 'delivered' ? 'delivered' : 'pending',
      ...(result.roomRef ? { roomRef: result.roomRef } : {}),
      ...(result.eventId ? { eventId: result.eventId } : {}),
      ...(result.loopMarker ? { loopMarker: result.loopMarker } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async function executeProposal(proposal, options = {}) {
    if (!config.writesEnabled || !['low_risk', 'scoped', 'productive'].includes(config.mode)) {
      throw serviceError('assistant_writes_disabled', 403);
    }
    if (!executor || typeof executor.execute !== 'function') {
      throw serviceError('assistant_executor_not_available', 503);
    }
    const mapped = mappedAction(proposal);
    if (!(config.actionAllowlist || []).includes(mapped.action)) {
      throw serviceError('assistant_action_not_allowlisted', 403);
    }
    if (config.mode === 'low_risk' && !LOW_RISK_ACTIONS.includes(mapped.action)) {
      throw serviceError('assistant_action_not_allowed_in_mode', 403);
    }
    if (
      ![...LOW_RISK_ACTIONS, ...SCOPED_ACTIONS].includes(mapped.action) ||
      (SCOPED_ACTIONS.includes(mapped.action) && config.mode === 'low_risk')
    ) {
      throw serviceError('assistant_action_not_allowed_in_mode', 403);
    }
    const conversation = getConversation(proposal.conversationId);
    const context = contextResolver.resolve({
      objectType: conversation.objectType || 'global',
      objectId: conversation.objectId,
    });
    const resolved = await resolveExecutionSource(proposal, context);
    const execution = withResolvedAssignee(mapped, resolved, options);
    const needsScope = SCOPED_ACTIONS.includes(execution.action) || config.mode === 'productive';
    if (
      needsScope &&
      !(await coveredByServerScope(execution.action, resolved.source, proposal, context))
    ) {
      throw serviceError('scope_not_covered', 403);
    }
    if (options.automatic && config.mode !== 'productive') {
      throw serviceError('automatic_execution_not_allowed', 403);
    }

    const confirmed = store.updateProposalStatus(proposal.id, 'confirmed', {
      expectedStatus: 'shadow',
      conversationId: proposal.conversationId,
    }).proposal;
    store.updateProposalStatus(confirmed.id, 'executing', {
      expectedStatus: 'confirmed',
      conversationId: proposal.conversationId,
    });
    try {
      const result = await executor.execute({
        action: execution.action,
        source: resolved.source,
        sourceFingerprint: resolved.sourceFingerprint,
        payload: execution.payload,
        idempotencyKey: proposal.idempotencyKey,
      });
      if (
        !result ||
        result.ok !== true ||
        result.status !== 'applied' ||
        !result.receipt?.readBack?.task ||
        !/^[0-9a-f]{64}$/.test(String(result.receipt.readBack.fingerprint || ''))
      ) {
        throw serviceError('assistant_action_readback_failed', 502);
      }
      const matrix = await deliverMatrixAfterReceipt(
        proposal,
        execution.action,
        resolved.source,
        context
      );
      const saved = store.saveReceipt({
        proposalId: proposal.id,
        conversationId: proposal.conversationId,
        sourceBoard: resolved.source.board,
        sourceTaskId: resolved.source.taskId,
        matrixRoomId: matrix && matrix.status === 'delivered' ? matrix.roomRef : null,
        matrixEventId: matrix && matrix.eventId ? matrix.eventId : null,
        beforeFingerprint: result.sourceFingerprint,
        afterFingerprint: result.receipt.readBack.fingerprint,
        readback: { kanban: result.receipt.readBack, matrix },
      });
      return {
        proposal: saved.proposal,
        receipt: receiptSummary(saved.receipt),
        deduplicated: Boolean(result.deduplicated || saved.deduplicated),
      };
    } catch (error) {
      try {
        store.updateProposalStatus(proposal.id, 'failed', {
          expectedStatus: 'executing',
          conversationId: proposal.conversationId,
        });
      } catch (_) {
        // Preserve the original execution failure; status reconciliation is audit-visible.
      }
      throw error;
    }
  }

  async function confirmProposal(id, options = {}) {
    requireEnabled();
    const existingReceipt = store.getReceiptByProposalId(id);
    if (existingReceipt) {
      return {
        proposal: store.getProposal(id),
        receipt: receiptSummary(existingReceipt),
        deduplicated: true,
      };
    }
    if (proposalExecutions.has(id)) return proposalExecutions.get(id);
    const proposal = store.getProposal(id);
    if (!proposal) throw serviceError('proposal_not_found', 404);
    if (proposal.status !== 'shadow') throw serviceError('proposal_not_confirmable', 409);
    const operation = executeProposal(proposal, options).finally(() =>
      proposalExecutions.delete(id)
    );
    proposalExecutions.set(id, operation);
    return operation;
  }

  function rejectProposal(id) {
    requireEnabled();
    const proposal = store.getProposal(id);
    if (!proposal) throw serviceError('proposal_not_found', 404);
    if (proposal.status === 'rejected') return { proposal, deduplicated: true };
    if (!['shadow', 'confirmed'].includes(proposal.status)) {
      throw serviceError('proposal_not_rejectable', 409);
    }
    const updated = store.updateProposalStatus(id, 'rejected', {
      expectedStatus: proposal.status,
      conversationId: proposal.conversationId,
    });
    return { proposal: updated.proposal, deduplicated: !updated.changed };
  }

  async function processRun(runId) {
    let run = store.getRun(runId);
    let conversation;
    try {
      conversation = getConversation(run.conversationId);
      const context = contextResolver.resolve({
        objectType: conversation.objectType || 'global',
        objectId: conversation.objectId,
      });
      const envelope = store.saveContextEnvelope({
        conversationId: conversation.id,
        objectType: context.objectType,
        objectId: context.objectId,
        fingerprint: context.fingerprint,
        payload: context.payload,
      });
      let claim = store.claimRun(run.id, envelope.id, {
        owner: workerId,
        leaseSeconds,
        now: Math.floor(nowMs() / 1000),
      });
      const claimDeadline = nowMs() + claimWaitMs;
      while (!claim.claimed && claim.run.status === 'accepted') {
        if (nowMs() >= claimDeadline) throw serviceError('assistant_conversation_busy', 409);
        await sleep(Math.min(claimPollMs, Math.max(1, claimDeadline - nowMs())));
        claim = store.claimRun(run.id, envelope.id, {
          owner: workerId,
          leaseSeconds,
          now: Math.floor(nowMs() / 1000),
        });
      }
      if (!claim.claimed) return claim.run;
      run = claim.run;
      conversation = getConversation(run.conversationId);
      const userMessage = store.getMessageById(run.userMessageId);
      if (!userMessage || userMessage.conversationId !== conversation.id) {
        throw serviceError('assistant_run_failed', 500);
      }
      const prior = store.listRecentMessages(conversation.id, {
        limit: Math.max(summaryConfig.retainMessages, config.limits.recentMessageCount),
        beforeCreatedAt: userMessage.createdAt,
        beforeId: userMessage.id,
      });
      let existingSummary = store.getSummary(conversation.id);
      const recentMessages = prior.slice(-summaryConfig.retainMessages);
      const rotate =
        Boolean(conversation.sessionId) &&
        conversation.sessionMessageCount >= config.limits.sessionRotateMessages;
      if (rotate) {
        const summaryMessages = prior.slice(0, -summaryConfig.retainMessages);
        const source = summaryMessages.length ? summaryMessages : prior;
        if (source.length) {
          existingSummary = store.saveSummary({
            conversationId: conversation.id,
            content: buildAssistantSummary(source, { maxChars: summaryConfig.maxChars }),
            throughMessageId: source.at(-1).id,
            messageCount: source.length,
          });
        }
      }
      const targetSessionName = rotate
        ? rotatedSessionName(conversation)
        : conversation.sessionName;
      const response = await client.send({
        sessionName: targetSessionName,
        hermesSessionId: rotate ? null : conversation.sessionId,
        createIfMissing: rotate || !conversation.sessionId,
        runId: run.id,
        prompt: userMessage.content,
        context: {
          objectType: context.objectType,
          objectId: context.objectId,
          payload: context.payload,
        },
        summary: existingSummary ? existingSummary.content : '',
        recentMessages,
      });
      if (response.runId !== run.id || !response.hermesSessionId)
        throw serviceError('transport_identity_invalid', 502);
      if (
        conversation.sessionId &&
        ((!rotate && response.hermesSessionId !== conversation.sessionId) ||
          (rotate && response.hermesSessionId === conversation.sessionId))
      ) {
        throw serviceError('transport_identity_changed', 502);
      }
      const responseEnvelope = {
        text: response.text,
        assistant_directive: response.assistant_directive ?? response.assistantDirective ?? null,
      };
      const directiveContext = {
        objectType: context.objectType,
        objectId: context.objectId,
        conversationId: conversation.id,
        messageId: run.id,
      };
      const validated = parseAssistantDirective(responseEnvelope, directiveContext);
      if (config.mode === 'read_only' && validated.proposal) {
        throw serviceError('assistant_directive_policy_denied', 502);
      }
      const completion = store.completeRun({
        runId: run.id,
        owner: workerId,
        conversationId: conversation.id,
        content: validated.text,
        createdAt: Math.max(Math.floor(nowMs() / 1000), userMessage.createdAt + 1),
        now: Math.floor(nowMs() / 1000),
        expectedSessionName: conversation.sessionName,
        expectedSessionId: conversation.sessionId,
        sessionName: targetSessionName,
        sessionId: response.hermesSessionId,
        rotate,
        previousSessionMessageCount: conversation.sessionMessageCount,
      });
      run = completion.run;
      if (config.mode !== 'read_only' && validated.proposal) {
        const parsed = parseAssistantDirective(responseEnvelope, {
          ...directiveContext,
          messageId: completion.message.id,
        });
        const created = store.createProposal({
          ...parsed.proposal,
          conversationId: conversation.id,
          messageId: completion.message.id,
        });
        if (config.mode === 'productive') {
          try {
            await confirmProposal(created.proposal.id, { automatic: true });
          } catch (error) {
            store.appendEvent({
              conversationId: conversation.id,
              eventType: 'proposal.auto_execution_denied',
              payload: { proposalId: created.proposal.id, code: error.code || 'execution_failed' },
            });
          }
        }
      }
      const completedMessages = store.listMessages(conversation.id);
      if (completedMessages.length >= summaryConfig.triggerMessages) {
        const compacted = completedMessages.slice(0, -summaryConfig.retainMessages);
        if (compacted.length) {
          try {
            const content = buildAssistantSummary(compacted, { maxChars: summaryConfig.maxChars });
            store.saveSummary({
              conversationId: conversation.id,
              content,
              throughMessageId: compacted.at(-1).id,
              messageCount: compacted.length,
            });
            store.appendEvent({
              conversationId: conversation.id,
              eventType: 'summary_updated',
              payload: { throughMessageId: compacted.at(-1).id, messageCount: compacted.length },
            });
          } catch (error) {
            store.appendEvent({
              conversationId: conversation.id,
              eventType: 'summary_rejected',
              payload: { code: error.code || 'summary_failed' },
            });
          }
        }
      }
      return run;
    } catch (error) {
      if (/run_(?:not_owned|lease_expired)/.test(String(error && error.message))) {
        return store.getRun(run.id);
      }
      const code = [
        'assistant_context_not_available',
        'transport_timeout',
        'transport_failed',
        'transport_identity_invalid',
        'transport_identity_changed',
        'transport_output_invalid',
        'transport_output_limit',
        'context_too_large',
        'assistant_conversation_busy',
        'assistant_directive_invalid',
        'assistant_directive_target_denied',
        'assistant_directive_scope_denied',
        'assistant_response_invalid',
        'assistant_success_claim_without_receipt',
        'assistant_directive_policy_denied',
      ].includes(error.code)
        ? error.code
        : 'assistant_run_failed';
      return store.updateRun(run.id, 'failed', {
        conversationId: run.conversationId,
        errorCode: code,
        expectedStatus: run.status === 'running' ? 'running' : 'accepted',
        expectedOwner: run.status === 'running' ? workerId : null,
      });
    }
  }

  function submitMessage(input = {}) {
    requireEnabled();
    const conversation = getConversation(input.conversationId);
    if (conversation.status !== 'active') throw serviceError('conversation_closed', 409);
    if (!UUID.test(String(input.clientMessageId || '')))
      throw serviceError('invalid_client_message_id');
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text || text.length > config.limits.maxMessageChars) throw serviceError('invalid_message');
    const created = store.createRun({
      conversationId: conversation.id,
      text,
      clientMessageId: input.clientMessageId,
    });
    const now = Math.floor(nowMs() / 1000);
    if (
      !created.deduplicated ||
      created.run.status === 'accepted' ||
      (created.run.status === 'running' && created.run.leaseExpiresAt <= now)
    ) {
      queueRun(created.run);
    }
    return created.run;
  }

  function resumePendingRuns() {
    if (pendingRunsResumed) return [];
    pendingRunsResumed = true;
    const pending = store.listPendingRuns();
    const now = Math.floor(nowMs() / 1000);
    for (const run of pending) {
      const notBefore =
        run.status === 'running' &&
        run.leaseOwner !== workerId &&
        run.leaseExpiresAt !== null &&
        run.leaseExpiresAt > now
          ? run.leaseExpiresAt * 1000
          : 0;
      queueRun(run, notBefore);
    }
    return pending;
  }

  function getRun(id) {
    requireEnabled();
    const value = store.getRun(id);
    if (!value) throw serviceError('run_not_found', 404);
    return value;
  }
  function listMessages(conversationId, input = {}) {
    requireEnabled();
    getConversation(conversationId);
    const limit = Math.max(1, Math.min(Number(input.limit) || 50, 100));
    const items = store.listMessages(conversationId, {
      limit: limit + 1,
      cursor: input.cursor || null,
    });
    const hasMore = items.length > limit;
    const proposals = new Map(
      store.listProposals({ conversationId }).map((proposal) => [
        proposal.messageId,
        {
          proposal: proposalSummary(proposal),
          receipt: receiptSummary(store.getReceiptByProposalId(proposal.id)),
        },
      ])
    );
    const page = items.slice(0, limit).map((message) => {
      const attachment = message.role === 'assistant' ? proposals.get(message.id) : null;
      return attachment ? { ...message, ...attachment } : message;
    });
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        hasMore && last
          ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString(
              'base64url'
            )
          : null,
    };
  }
  function decodeCursor(value) {
    if (!value) return null;
    if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw serviceError('invalid_cursor');
    }
    try {
      const decoded = Buffer.from(value, 'base64url');
      if (!decoded.length || decoded.toString('base64url') !== value) {
        throw serviceError('invalid_cursor');
      }
      const parsed = JSON.parse(decoded.toString('utf8'));
      if (
        !parsed ||
        !Number.isInteger(parsed.createdAt) ||
        typeof parsed.id !== 'string' ||
        !parsed.id ||
        Object.keys(parsed).some((key) => !['createdAt', 'id'].includes(key))
      ) {
        throw serviceError('invalid_cursor');
      }
      return parsed;
    } catch (error) {
      if (error.code === 'invalid_cursor') throw error;
      throw serviceError('invalid_cursor');
    }
  }
  function drain(conversationId) {
    return queues.get(conversationId) || Promise.resolve();
  }

  return {
    createConversation,
    listConversations,
    listMessages: (id, input = {}) =>
      listMessages(id, { ...input, cursor: decodeCursor(input.cursor) }),
    submitMessage,
    resumePendingRuns,
    getRun,
    listProposals,
    confirmProposal,
    rejectProposal,
    drain,
  };
}

module.exports = {
  DIRECTIVE_ACTION_MAP,
  createAssistantService,
  mappedAction,
  receiptSummary,
  runLeaseSeconds,
  serviceError,
};
