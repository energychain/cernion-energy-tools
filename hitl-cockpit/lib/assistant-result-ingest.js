'use strict';

const crypto = require('node:crypto');

const {
  ResultContractError,
  assertMarkerSafe,
  hasExactHandoffMarker,
  parseResultBlock,
} = require('./result-contract');
const {
  containsPrivateMarker,
  assertPublicSource,
  sourceFingerprint,
} = require('./assistant-action-executor');
const { requiredAudit } = require('./assistant-reconciliation');

const TERMINAL_TASK_STATES = new Set(['done', 'completed', 'closed', 'resolved', 'archived']);
const OPERATOR_ACTIONS = new Set(['accept', 'correct', 'continue', 'end']);

function resultError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function clean(value, field, max = 4000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw resultError(`${field}_required`);
  if (text.length > max) throw resultError(`${field}_too_long`);
  return text;
}

function eventValue(event, ...paths) {
  for (const path of paths) {
    let value = event;
    for (const key of path) value = value && value[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function matrixEnvelope(event = {}) {
  return {
    roomId: eventValue(event, ['roomId'], ['room_id']),
    eventId: eventValue(event, ['eventId'], ['event_id']),
    sender: eventValue(event, ['sender']),
    replyTo: eventValue(
      event,
      ['replyToEventId'],
      ['reply_to_event_id'],
      ['content', 'm.relates_to', 'm.in_reply_to', 'event_id']
    ),
    body: eventValue(event, ['body'], ['content', 'body']) || '',
    eventType: eventValue(event, ['eventType'], ['type']),
    msgtype: eventValue(event, ['msgtype'], ['content', 'msgtype']),
    relationType: eventValue(event, ['relationType'], ['content', 'm.relates_to', 'rel_type']),
    originServerTs:
      Number(event.originServerTs || event.origin_server_ts) > 0
        ? Number(event.originServerTs || event.origin_server_ts)
        : null,
    redacted: Boolean(event.redacted || event.unsigned?.redacted_because),
  };
}

function sameMatrixEnvelope(left, right) {
  return ['eventId', 'sender', 'replyTo', 'body'].every((field) => left[field] === right[field]);
}

function resultThreadReply(contract) {
  const labels = {
    completed: 'Fachagentenergebnis',
    blocked: 'Fachagent blockiert',
    needs_decision: 'Managemententscheidung erforderlich',
    continuing: 'Bearbeitung wird begründet fortgesetzt',
  };
  return [
    `${labels[contract.status]} · ${contract.responsibleAgent}`,
    contract.statement,
    contract.evidenceRefs.length ? `Evidenz: ${contract.evidenceRefs.join(' · ')}` : null,
    contract.nextStep ? `Nächster Schritt: ${contract.nextStep}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function closureResult(result, action, operationId = null) {
  for (const value of [
    result.id,
    result.statement,
    result.sourceBoard,
    result.sourceTaskId,
    ...result.evidenceRefs,
    result.outcomeCandidate?.type,
    result.outcomeCandidate?.statement,
  ].filter((value) => value != null))
    assertMarkerSafe(value);
  const lines = [
    result.statement,
    `AGENT_RESULT_ID: ${result.id}`,
    `AGENT_RESULT_DECISION: ${action}`,
    `AGENT_RESULT_SOURCE_BOARD: ${result.sourceBoard}`,
    `AGENT_RESULT_SOURCE_TASK: ${result.sourceTaskId}`,
    `AGENT_RESULT_EVIDENCE: ${JSON.stringify(result.evidenceRefs)}`,
    `AGENT_RESULT_VERIFIED: ${result.verificationReceipt?.verified === true}`,
  ];
  if (operationId) lines.push(`RESULT_OPERATION_ID: ${assertMarkerSafe(operationId)}`);
  if (action === 'accept' && result.outcomeCandidate) {
    lines.push(
      `OUTCOME_TYPE: ${result.outcomeCandidate.type}`,
      `OUTCOME_STATEMENT: ${result.outcomeCandidate.statement}`,
      `OUTCOME_EVIDENCE: ${result.evidenceRefs.join('; ')}`,
      `OUTCOME_OCCURRED_AT: ${new Date(result.occurredAt * 1000).toISOString()}`,
      'OUTCOME_FINAL: true'
    );
  }
  return lines.join('\n');
}

function validateTerminalClose(task, result, action, operationId, publicBoards) {
  assertPublicSource(
    { board: result.sourceBoard, taskId: result.sourceTaskId },
    task,
    publicBoards
  );
  if (!taskIsTerminal(task)) throw resultError('terminal_kanban_readback_required', 409);
  if (task.result !== closureResult(result, action, operationId))
    throw resultError('terminal_kanban_readback_mismatch', 409);
  return task;
}

// Match whole references only, and only in the authoritative evidence-bearing fields.
function evidenceInTask(task, ref) {
  const strings = [];
  function visit(value) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit([task.comments, task.attachments, task.artifacts, task.result]);
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return strings.some((text) =>
    new RegExp(`(?:^|[\\s"'<>;(])${escaped}(?=$|[\\s"'<>;,)])`, 'u').test(text)
  );
}

async function verifyEvidence(contract, task, resolver, timestamp) {
  const references = [];
  for (const ref of contract.evidenceRefs) {
    let proof = evidenceInTask(task, ref) ? { verified: true, via: 'second_readback' } : null;
    if (!proof && typeof resolver === 'function') {
      try {
        const resolved = await resolver({
          ref,
          source: { board: contract.sourceBoard, taskId: contract.sourceTaskId },
          task: structuredClone(task),
          contract,
        });
        if (
          resolved?.verified === true &&
          resolved.ref === ref &&
          resolved.sourceBoard === contract.sourceBoard &&
          resolved.sourceTaskId === contract.sourceTaskId &&
          !containsPrivateMarker(resolved)
        )
          proof = { verified: true, via: 'authoritative_resolver', receipt: resolved };
      } catch (_) {
        /* Unavailable evidence remains unverified. */
      }
    }
    references.push({ ref, ...(proof || { verified: false }) });
  }
  return {
    verified: references.length > 0 && references.every((item) => item.verified),
    sourceBoard: contract.sourceBoard,
    sourceTaskId: contract.sourceTaskId,
    taskFingerprint: sourceFingerprint(task),
    verifiedAt: timestamp,
    references,
  };
}

function validateProjectedClosure(task, publicBoards) {
  const text = String(task.result || '');
  const values = (marker) =>
    text
      .split('\n')
      .filter((line) => line.startsWith(`${marker}: `))
      .map((line) => line.slice(marker.length + 2));
  const single = (marker) => {
    const found = values(marker);
    if (found.length !== 1) throw resultError('terminal_marker_invalid', 409);
    return found[0];
  };
  const action = single('AGENT_RESULT_DECISION');
  if (!['accept', 'end'].includes(action)) throw resultError('terminal_marker_invalid', 409);
  const result = {
    id: single('AGENT_RESULT_ID'),
    statement: text.split('\n')[0],
    sourceBoard: single('AGENT_RESULT_SOURCE_BOARD'),
    sourceTaskId: single('AGENT_RESULT_SOURCE_TASK'),
    evidenceRefs: JSON.parse(single('AGENT_RESULT_EVIDENCE')),
    verificationReceipt: { verified: single('AGENT_RESULT_VERIFIED') === 'true' },
    outcomeCandidate: null,
  };
  if (action === 'accept' && !result.verificationReceipt.verified)
    throw resultError('result_evidence_not_verified', 409);
  if (values('OUTCOME_TYPE').length) {
    if (action !== 'accept') throw resultError('terminal_marker_invalid', 409);
    result.outcomeCandidate = {
      type: single('OUTCOME_TYPE'),
      statement: single('OUTCOME_STATEMENT'),
    };
    result.occurredAt = Date.parse(single('OUTCOME_OCCURRED_AT')) / 1000;
    if (
      single('OUTCOME_EVIDENCE') !== result.evidenceRefs.join('; ') ||
      single('OUTCOME_FINAL') !== 'true'
    )
      throw resultError('terminal_marker_invalid', 409);
  }
  validateTerminalClose(task, result, action, single('RESULT_OPERATION_ID'), publicBoards);
  return { action, result };
}

function taskIsTerminal(task) {
  return TERMINAL_TASK_STATES.has(String(task?.status || '').toLowerCase());
}

function createAssistantResultIngest(options = {}) {
  const { store, readKanban } = options;
  if (!store || typeof readKanban !== 'function') {
    throw new Error('assistant_result_ingest_dependencies_required');
  }
  const allowedSenders = new Set((options.allowedSenders || []).map(String));
  const closeCase = options.closeCase || null;
  const createRound = options.createRound || null;
  const onProjectionRequired = options.onProjectionRequired || (() => undefined);
  const now = options.now || (() => Math.floor(Date.now() / 1000));
  const workerId = options.workerId || `result-worker-${crypto.randomUUID()}`;
  const leaseSeconds = Math.max(1, options.leaseSeconds || 60);
  const publicBoards = options.publicBoards || ['operations'];
  function mutationGuard() {
    options.mutationGuard?.();
  }

  async function ingestMatrix(event = {}) {
    let envelope = matrixEnvelope(event);
    if (!envelope.body.includes('---BEGIN AGENT RESULT---')) {
      return { classification: 'hint', closed: false, reason: 'machine_result_block_missing' };
    }
    let contract;
    try {
      contract = parseResultBlock(envelope.body);
    } catch (error) {
      if (error instanceof ResultContractError) throw error;
      throw resultError('result_contract_invalid');
    }
    if (!envelope.roomId || !envelope.eventId || !envelope.sender || !envelope.replyTo) {
      throw resultError('matrix_correlation_incomplete', 422);
    }
    if (envelope.eventType && envelope.eventType !== 'm.room.message')
      throw resultError('matrix_event_type_invalid', 422);
    if (envelope.msgtype && envelope.msgtype !== 'm.text')
      throw resultError('matrix_message_type_invalid', 422);
    if (envelope.relationType === 'm.replace' || envelope.redacted)
      throw resultError('matrix_event_mutated', 422);
    if (typeof options.readMatrixEvent === 'function') {
      const observedEvent = await options.readMatrixEvent({
        roomRef: envelope.roomId,
        eventId: envelope.eventId,
      });
      const observed = matrixEnvelope({ roomId: envelope.roomId, ...observedEvent });
      if (!sameMatrixEnvelope(envelope, observed)) {
        throw resultError('matrix_event_readback_mismatch', 422);
      }
      if (
        (observed.eventType && observed.eventType !== 'm.room.message') ||
        (observed.msgtype && observed.msgtype !== 'm.text') ||
        observed.relationType === 'm.replace' ||
        observed.redacted
      ) {
        throw resultError('matrix_event_mutated', 422);
      }
      envelope = observed;
    }
    if (!allowedSenders.size || !allowedSenders.has(envelope.sender)) {
      throw resultError('matrix_sender_not_allowed', 403);
    }
    const proposal = store.getProposal(contract.proposalId);
    const receipt = proposal && store.getReceiptByProposalId(proposal.id);
    if (!proposal || !receipt || !receipt.matrixRoomId || !receipt.matrixEventId) {
      throw resultError('persisted_handoff_not_found', 404);
    }
    if (
      envelope.roomId !== receipt.matrixRoomId ||
      envelope.replyTo !== receipt.matrixEventId ||
      !hasExactHandoffMarker(envelope.body, contract.handoffId)
    ) {
      throw resultError('matrix_handoff_correlation_mismatch', 422);
    }
    if (
      contract.sourceBoard !== receipt.sourceBoard ||
      contract.sourceTaskId !== receipt.sourceTaskId
    ) {
      throw resultError('result_source_mismatch', 422);
    }
    const binding = store.getHandoffBinding(proposal.id);
    if (
      !binding ||
      envelope.sender !== binding.expectedSender ||
      contract.responsibleAgent !== binding.responsibleAgent
    )
      throw resultError('matrix_sender_binding_mismatch', 403);
    const timestamp = now();
    const maxAgeSeconds = options.maxAgeSeconds || 30 * 24 * 60 * 60;
    if (
      contract.occurredAt < receipt.executedAt - 300 ||
      contract.occurredAt < timestamp - maxAgeSeconds ||
      contract.occurredAt > timestamp + 300
    )
      throw resultError('occurred_at_out_of_bounds', 422);
    if (
      envelope.originServerTs &&
      Math.abs(contract.occurredAt - Math.floor(envelope.originServerTs / 1000)) > 300
    )
      throw resultError('occurred_at_event_mismatch', 422);
    if (containsPrivateMarker({ envelope, contract })) {
      throw resultError('private_result_rejected', 403);
    }

    const task = await readKanban({ board: contract.sourceBoard, taskId: contract.sourceTaskId });
    if (!task) throw resultError('source_task_not_found', 404);
    assertPublicSource(
      { board: contract.sourceBoard, taskId: contract.sourceTaskId },
      task,
      publicBoards
    );
    const verificationReceipt = await verifyEvidence(
      contract,
      task,
      options.evidenceResolver,
      timestamp
    );
    const verificationStatus =
      contract.status === 'blocked' || !verificationReceipt.verified
        ? 'needs_reconciliation'
        : 'awaiting_acceptance';
    const saved = store.saveResult({
      ...contract,
      proposalId: proposal.id,
      conversationId: proposal.conversationId,
      sourceKind: 'matrix',
      sourceEventId: envelope.eventId,
      correlationStatus: 'verified',
      verificationStatus,
      verificationReceipt,
      kanbanReadback: { task },
      reply: resultThreadReply(contract),
    });
    return {
      classification: 'verified_result',
      result: saved.result,
      replyMessageId: saved.result.replyMessageId,
      deduplicated: saved.deduplicated,
      closed: false,
    };
  }

  function listResults(input = {}) {
    return store.listResults(input).map((result) => ({
      ...result,
      rounds: store.listResultRounds(result.id),
    }));
  }

  function assertActionable(result, action) {
    if (!result) throw resultError('result_not_found', 404);
    if (result.correlationStatus !== 'verified')
      throw resultError('uncorrelated_result_not_actionable', 409);
    assertPublicSource(
      { board: result.sourceBoard, taskId: result.sourceTaskId },
      null,
      publicBoards
    );
    if (containsPrivateMarker(result)) throw resultError('private_result_rejected', 403);
    if (action === 'accept') {
      if (result.status !== 'completed')
        throw resultError('only_completed_result_can_be_accepted', 409);
      const proof = result.verificationReceipt;
      if (
        !proof?.verified ||
        proof.sourceBoard !== result.sourceBoard ||
        proof.sourceTaskId !== result.sourceTaskId ||
        proof.references.length !== result.evidenceRefs.length ||
        !result.evidenceRefs.every((ref) =>
          proof.references.some((item) => item.ref === ref && item.verified)
        )
      )
        throw resultError('result_evidence_not_verified', 409);
    }
  }

  async function processOperation(original) {
    mutationGuard();
    const claim = store.claimResultOperation(original.id, {
      owner: workerId,
      now: now(),
      leaseSeconds,
    });
    if (!claim.claimed)
      return { pending: original.status !== 'applied', operation: original, deduplicated: true };
    const op = claim.item;
    const result = store.getResult(op.resultId);
    try {
      assertActionable(result, op.action);
      const source = { board: result.sourceBoard, taskId: result.sourceTaskId };
      const writerInput = {
        action: op.action,
        result,
        instruction: op.instruction,
        requestId: op.requestId,
        source,
        operationId: op.id,
        idempotencyKey: op.idempotencyKey,
      };
      const atomic = (receipt) => ({ id: op.id, owner: workerId, now: now(), receipt });
      if (op.action === 'correct' || op.action === 'continue') {
        let linked =
          typeof options.readRound === 'function' ? await options.readRound(writerInput) : null;
        if (!linked) {
          // An uncertain non-idempotent create must never be replayed.
          if (op.writeStarted && options.roundIdempotent !== true)
            throw resultError('result_round_write_unknown', 409);
          if (typeof createRound !== 'function')
            throw resultError('result_round_writer_unavailable', 503);
          mutationGuard();
          store.markResultOperationStarted(op.id, workerId, now());
          linked = await createRound(writerInput);
          if (typeof options.readRound === 'function')
            linked = await options.readRound(writerInput);
        }
        const task = linked?.task || linked;
        const linkedTaskId = String(task?.id || '').trim();
        if (!linkedTaskId) throw resultError('result_round_readback_missing', 502);
        assertPublicSource({ board: source.board, taskId: linkedTaskId }, task, publicBoards);
        if (
          !String(task.body || '')
            .split('\n')
            .includes(`RESULT_OPERATION_ID: ${op.id}`) ||
          !String(task.body || '')
            .split('\n')
            .includes(`PARENT_RESULT_ID: ${result.id}`) ||
          !String(task.body || '')
            .split('\n')
            .includes(`SOURCE_TASK_ID: ${source.taskId}`)
        )
          throw resultError('result_round_readback_mismatch', 409);
        const round = store.createResultRound({
          resultId: result.id,
          conversationId: result.conversationId,
          action: op.action,
          instruction: op.instruction,
          sourceBoard: source.board,
          sourceTaskId: source.taskId,
          linkedTaskId,
          requestId: op.requestId,
          operation: atomic({ task }),
          audit: op.audit,
        });
        await onProjectionRequired({ result: store.getResult(result.id), round: round.round });
        return {
          result: store.getResult(result.id),
          round: round.round,
          deduplicated: round.deduplicated,
        };
      }
      const resultText = closureResult(result, op.action, op.id);
      let task = await readKanban(source);
      assertPublicSource(source, task, publicBoards);
      if (!task) throw resultError('source_task_not_found', 404);
      if (!taskIsTerminal(task)) {
        if (
          !result.verificationReceipt?.taskFingerprint ||
          sourceFingerprint(task) !== result.verificationReceipt.taskFingerprint
        ) {
          throw resultError('result_source_changed_since_verification', 409);
        }
        if (op.writeStarted) throw resultError('result_close_write_unknown', 409);
        if (typeof closeCase !== 'function')
          throw resultError('case_closure_writer_unavailable', 503);
        mutationGuard();
        store.markResultOperationStarted(op.id, workerId, now());
        await closeCase({ ...writerInput, resultText });
        // Always read independently, including when the writer returns a task.
        task = await readKanban(source);
      }
      validateTerminalClose(task, result, op.action, op.id, publicBoards);
      const decided = store.decideResult(result.id, op.action, {
        conversationId: result.conversationId,
        requestId: op.requestId,
        kanbanReadback: { task, verificationReceipt: result.verificationReceipt },
        operation: atomic({ task }),
        audit: op.audit,
      });
      await onProjectionRequired({ result: decided.result, task });
      return { result: decided.result, closed: true, deduplicated: !decided.changed };
    } catch (error) {
      store.markResultOperationUnknown(op.id, workerId, now());
      throw error;
    }
  }

  async function decide(resultId, action, input = {}) {
    mutationGuard();
    if (!OPERATOR_ACTIONS.has(action)) throw resultError('result_action_invalid');
    const audit = requiredAudit(input);
    const requestId = clean(input.requestId, 'request_id', 256);
    const instruction =
      action === 'correct' || action === 'continue' ? clean(input.instruction, 'instruction') : '';
    assertMarkerSafe(instruction);
    const result = store.getResult(resultId);
    assertActionable(result, action);
    if (['accept', 'end', 'reject'].includes(result.operatorDecision)) {
      if (result.operatorDecision !== action) throw resultError('result_already_decided', 409);
      return { result, closed: true, deduplicated: true };
    }
    const key = crypto
      .createHash('sha256')
      .update(JSON.stringify([resultId, action, requestId]))
      .digest('hex');
    const op = store.startResultOperation({
      id: `resultop_${key}`,
      idempotencyKey: `assistant-result:${key}`,
      resultId,
      action,
      requestId,
      instruction,
      audit,
      conversationId: result.conversationId,
      createdAt: now(),
    });
    if (op.status === 'applied')
      return {
        result: store.getResult(resultId),
        round: store.getResultRoundByRequestId(requestId),
        closed: ['accept', 'end'].includes(action),
        deduplicated: true,
      };
    return processOperation(op);
  }

  async function processPending() {
    mutationGuard();
    const results = [];
    for (const operation of store.listResultOperations()) {
      try {
        results.push(await processOperation(operation));
      } catch (error) {
        results.push({
          pending: true,
          operationId: operation.id,
          error: error.code || error.message,
        });
      }
    }
    return { processed: results.length, results };
  }

  return { decide, ingestMatrix, listResults, processPending };
}

module.exports = {
  OPERATOR_ACTIONS,
  TERMINAL_TASK_STATES,
  closureResult,
  validateTerminalClose,
  validateProjectedClosure,
  verifyEvidence,
  createAssistantResultIngest,
  matrixEnvelope,
  resultThreadReply,
  taskIsTerminal,
};
