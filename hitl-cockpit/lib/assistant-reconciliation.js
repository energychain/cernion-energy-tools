'use strict';

const crypto = require('node:crypto');
const { containsPrivateMarker, assertPublicSource } = require('./assistant-action-executor');

const DAY_SECONDS = 24 * 60 * 60;
const RETRY_SECONDS = 5 * 60;
const MAX_RETRY_SECONDS = 60 * 60;
const CLOSED = new Set(['resolved', 'cancelled']);

function errorCode(error, fallback) {
  const code = String(error?.code || error?.message || fallback || 'reconciliation_failed');
  return /^[a-z0-9_.-]{1,128}$/i.test(code) ? code : fallback || 'reconciliation_failed';
}

function assertPublicCommand(command, publicBoards) {
  if (!command || containsPrivateMarker(command.source) || containsPrivateMarker(command.payload)) {
    const error = new Error('private_source_rejected');
    error.code = 'private_source_rejected';
    error.status = 403;
    throw error;
  }
  assertPublicSource(command.source, null, publicBoards);
}

function requiredAudit(input = {}) {
  const identity = String(input.identity || '').trim();
  const reason = String(input.reason || '').trim();
  const evidence = String(input.evidence || '').trim();
  const requestId = String(input.requestId || '').trim();
  if (!identity)
    throw Object.assign(new Error('operator_identity_required'), {
      code: 'operator_identity_required',
    });
  if (!reason)
    throw Object.assign(new Error('operator_reason_required'), {
      code: 'operator_reason_required',
    });
  if (!evidence)
    throw Object.assign(new Error('operator_evidence_required'), {
      code: 'operator_evidence_required',
    });
  if (!requestId)
    throw Object.assign(new Error('operator_request_id_required'), {
      code: 'operator_request_id_required',
    });
  return { identity, reason, evidence, requestId };
}

function createAssistantReconciliation(options = {}) {
  const { store, executor, matrixHandoff } = options;
  if (!store || !executor) throw new Error('reconciliation_dependencies_required');
  const now = options.now || (() => Math.floor(Date.now() / 1000));
  const retrySeconds = Math.max(1, Number(options.retrySeconds) || RETRY_SECONDS);
  const leaseSeconds = Math.max(5, Number(options.leaseSeconds) || 60);
  const workerId = String(options.workerId || `reconciliation-${crypto.randomUUID()}`);
  const mutationGuard = options.mutationGuard || (() => undefined);

  function delayFor(item) {
    return Math.min(MAX_RETRY_SECONDS, retrySeconds * 2 ** Math.min(item.attemptCount, 4));
  }

  function open(input) {
    mutationGuard();
    assertPublicCommand(input.command, options.publicBoards);
    return store.startReconciliation({
      proposalId: input.proposalId,
      conversationId: input.conversationId,
      owner: input.owner || 'Operations',
      expectedFingerprint: input.command.sourceFingerprint,
      nextAttemptAt: now(),
      details: {
        command: input.command,
        conversationId: input.conversationId,
        matrixInput: input.matrixInput || null,
        completedSteps: [],
      },
    }).item;
  }

  function claim(item) {
    return store.claimReconciliation(item.id, {
      owner: workerId,
      leaseSeconds,
      now: now(),
    });
  }

  function markUnknown(item, code, status = 'write_unknown', details = item.details) {
    return store.updateReconciliation(item.id, status, {
      now: now(),
      incrementAttempt: true,
      lastErrorCode: code,
      nextAttemptAt: now() + delayFor(item),
      details,
      expectedLeaseOwner: workerId,
      eventType: 'attempt.failed',
      eventPayload: { code },
    });
  }

  function finalize(item, readBack, matrix = null, relatedIds = [item.id], audit = null) {
    const command = item.details.command;
    return store.finalizeReconciliation({
      audit,
      reconciliationId: item.id,
      reconciliationIds: relatedIds,
      owner: workerId,
      proposalId: item.proposalId,
      conversationId: item.details.conversationId,
      sourceBoard: command.source.board,
      sourceTaskId: command.source.taskId,
      matrixRoomId: matrix?.status === 'delivered' ? matrix.roomRef : null,
      matrixEventId: matrix?.status === 'delivered' ? matrix.eventId : null,
      beforeFingerprint: command.sourceFingerprint,
      afterFingerprint: readBack.fingerprint,
      readback: { kanban: readBack, matrix },
      executedAt: now(),
    });
  }

  async function continueAfterKanban(item, readBack) {
    if (!item.details.matrixInput) return finalize(item, readBack);
    const matrixItem = store.createReconciliation({
      proposalId: item.proposalId,
      stage: 'matrix',
      status: 'matrix_pending',
      owner: item.owner,
      expectedFingerprint: readBack.fingerprint,
      nextAttemptAt: now(),
      details: {
        conversationId: item.details.conversationId,
        command: item.details.command,
        readBack,
        matrixInput: item.details.matrixInput,
        kanbanItemId: item.id,
      },
    }).item;
    store.updateReconciliation(item.id, 'matrix_pending', {
      now: now(),
      nextAttemptAt: now() + MAX_RETRY_SECONDS,
      expectedLeaseOwner: workerId,
      eventType: 'kanban.verified.matrix_required',
    });
    if (!matrixHandoff) {
      return { pending: true, reconciliation: matrixItem };
    }
    return processMatrix(matrixItem);
  }

  async function runKanban(item) {
    mutationGuard();
    assertPublicCommand(item.details.command, options.publicBoards);
    const completedSteps = new Set(item.details.completedSteps || []);
    const result = await executor.execute(item.details.command, {
      retry: item.status !== 'pending' || item.attemptCount > 0,
      completedSteps,
      onStep(step) {
        completedSteps.add(step);
        item = store.updateReconciliation(item.id, item.status, {
          now: now(),
          details: { ...item.details, completedSteps: [...completedSteps] },
          nextAttemptAt: item.nextAttemptAt,
          expectedLeaseOwner: workerId,
          keepLease: true,
          eventType: 'kanban.step_verified',
          eventPayload: { step },
        });
      },
    });
    if (!result?.ok || result.status !== 'applied' || !result.receipt?.readBack?.task) {
      return markUnknown(item, result?.reconciliation?.reason || 'kanban_write_unknown');
    }
    return continueAfterKanban(item, result.receipt.readBack);
  }

  async function execute(input) {
    const opened = open(input);
    const claimed = claim(opened);
    if (!claimed.claimed) return { pending: true, reconciliation: claimed.item };
    try {
      return await runKanban(claimed.item);
    } catch (error) {
      markUnknown(claimed.item, errorCode(error, 'kanban_write_failed'));
      throw error;
    }
  }

  async function processKanban(item) {
    const observed = await executor.reconcile(item.details.command);
    if (observed.applied) return continueAfterKanban(item, observed.readBack);
    if (!observed.unchanged && !(item.details.completedSteps || []).length) {
      return markUnknown(item, 'readback_mismatch', 'readback_mismatch');
    }
    return runKanban(item);
  }

  async function processMatrix(original) {
    const claimed =
      original.leaseOwner === workerId ? { claimed: true, item: original } : claim(original);
    if (!claimed.claimed) return { pending: true, reconciliation: claimed.item };
    const item = claimed.item;
    if (!matrixHandoff) {
      const reconciliation = markUnknown(item, 'matrix_runtime_unavailable', 'matrix_pending');
      return { pending: true, reconciliation };
    }
    mutationGuard();
    const matrix = await matrixHandoff.deliver(item.details.matrixInput);
    if (!matrix || matrix.status !== 'delivered') {
      const reconciliation = markUnknown(
        item,
        matrix?.error || 'matrix_delivery_failed',
        'matrix_unknown'
      );
      return { pending: true, reconciliation };
    }
    const kanbanItem = store.getReconciliation(item.details.kanbanItemId);
    return finalize(item, item.details.readBack, matrix, [kanbanItem.id, item.id]);
  }

  function escalateAged(item, timestamp) {
    if (item.escalatedAt || timestamp - item.createdAt < DAY_SECONDS) return item;
    return store.updateReconciliation(item.id, item.status, {
      now: now(),
      owner: 'Rhajaina',
      escalatedAt: timestamp,
      nextAttemptAt: item.nextAttemptAt,
      lastErrorCode: item.lastErrorCode,
      eventType: 'escalated.to_rhajaina',
      eventPayload: { previousOwner: item.owner, owner: 'Rhajaina' },
    });
  }

  async function processDue(input = {}) {
    mutationGuard();
    const timestamp = input.now || now();
    const due = store.listReconciliations({ dueBefore: timestamp });
    const results = [];
    for (const original of due) {
      let item = escalateAged(original, timestamp);
      const claimed = claim(item);
      if (!claimed.claimed) continue;
      item = claimed.item;
      try {
        if (item.stage === 'kanban') results.push(await processKanban(item));
        else if (item.stage === 'matrix') results.push(await processMatrix(item));
      } catch (error) {
        results.push(markUnknown(item, errorCode(error)));
      }
    }
    return { processed: results.length, open: listOpen().length, results };
  }

  function listOpen() {
    return store.listReconciliations().filter((item) => !CLOSED.has(item.status));
  }

  function retry(id, auditInput) {
    mutationGuard();
    const audit = requiredAudit(auditInput);
    const item = store.getReconciliation(id);
    if (!item || CLOSED.has(item.status)) throw new Error('reconciliation_not_open');
    return store.updateReconciliation(id, item.status, {
      now: now(),
      nextAttemptAt: now(),
      lastErrorCode: item.lastErrorCode,
      eventType: 'operator.retry_requested',
      eventPayload: audit,
    });
  }

  async function resolve(id, auditInput) {
    mutationGuard();
    const audit = requiredAudit(auditInput);
    const item = store.getReconciliation(id);
    if (!item || CLOSED.has(item.status)) throw new Error('reconciliation_not_open');
    const claimed = claim(item);
    if (!claimed.claimed) throw new Error('reconciliation_busy');
    try {
      assertPublicCommand(item.details.command, options.publicBoards);
      if (item.stage === 'matrix') {
        if (typeof matrixHandoff?.reconcile !== 'function')
          throw Object.assign(new Error('matrix_verification_required'), {
            code: 'matrix_verification_required',
            status: 409,
          });
        const matrix = await matrixHandoff.reconcile(item.details.matrixInput);
        if (matrix?.status !== 'delivered' || matrix?.verified !== true)
          throw Object.assign(new Error('matrix_verification_required'), {
            code: 'matrix_verification_required',
            status: 409,
          });
        const kanbanItem = store.getReconciliation(item.details.kanbanItemId);
        finalize(claimed.item, item.details.readBack, matrix, [kanbanItem.id, item.id], audit);
        return store.getReconciliation(id);
      }
      const observed = await executor.reconcile(item.details.command);
      if (!observed.applied)
        throw Object.assign(new Error('operator_readback_not_applied'), {
          code: 'operator_readback_not_applied',
          status: 409,
        });
      if (item.details.matrixInput)
        throw Object.assign(new Error('matrix_verification_required'), {
          code: 'matrix_verification_required',
          status: 409,
        });
      const result = finalize(claimed.item, observed.readBack, null, [item.id], audit);
      return store.getReconciliation(id) || result;
    } catch (error) {
      markUnknown(
        claimed.item,
        errorCode(error),
        item.stage === 'matrix' ? 'matrix_unknown' : 'readback_mismatch'
      );
      throw error;
    }
  }

  function escalate(id, auditInput) {
    mutationGuard();
    const audit = requiredAudit(auditInput);
    const item = store.getReconciliation(id);
    if (!item || CLOSED.has(item.status)) throw new Error('reconciliation_not_open');
    return store.updateReconciliation(id, item.status, {
      now: now(),
      owner: 'Rhajaina',
      escalatedAt: item.escalatedAt || now(),
      nextAttemptAt: item.nextAttemptAt,
      lastErrorCode: item.lastErrorCode,
      eventType: 'operator.escalated',
      eventPayload: audit,
    });
  }

  return { execute, listOpen, processDue, retry, resolve, escalate };
}

module.exports = {
  DAY_SECONDS,
  MAX_RETRY_SECONDS,
  RETRY_SECONDS,
  requiredAudit,
  assertPublicCommand,
  createAssistantReconciliation,
};
