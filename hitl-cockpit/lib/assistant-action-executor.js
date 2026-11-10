'use strict';

const crypto = require('node:crypto');

const BASE_ACTIONS = Object.freeze([
  'ask_question',
  'delegate_followup',
  'schedule_wakeup',
  'return_for_completion',
]);
const SCOPED_ACTIONS = Object.freeze(['set_owner', 'set_priority']);
const ALLOWED_ACTIONS = Object.freeze([...BASE_ACTIONS, ...SCOPED_ACTIONS]);
const PRIVATE_PATTERN = /(?:^|[-_\s])(twl(?:-netze)?|private|confidential|restricted)(?:$|[-_\s])/i;

class AssistantActionError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'AssistantActionError';
    this.code = code;
    this.status = status;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function sourceFingerprint(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new AssistantActionError('source_task_invalid', 502);
  }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(task)))
    .digest('hex');
}

function cleanText(value, field, max = 2000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AssistantActionError(`${field}_required`);
  if (text.length > max) throw new AssistantActionError(`${field}_too_long`);
  return text;
}

function normalizePayload(action, input) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (action === 'ask_question') {
    return { question: cleanText(payload.question, 'question') };
  }
  if (action === 'delegate_followup') {
    return {
      assignee: cleanText(payload.assignee, 'assignee', 128),
      followup: cleanText(payload.followup, 'followup'),
    };
  }
  if (action === 'schedule_wakeup') {
    const wakeAt = cleanText(payload.wakeAt, 'wakeAt', 100);
    if (!Number.isFinite(Date.parse(wakeAt))) throw new AssistantActionError('wakeAt_invalid');
    return {
      wakeAt: new Date(wakeAt).toISOString(),
      reason: cleanText(payload.reason, 'reason'),
      nextAction: cleanText(payload.nextAction, 'nextAction'),
    };
  }
  if (action === 'return_for_completion') {
    return { reason: cleanText(payload.reason, 'reason') };
  }
  if (action === 'set_owner') {
    return { owner: cleanText(payload.owner, 'owner', 128) };
  }
  if (action === 'set_priority') {
    const priority = payload.priority;
    if (
      !Number.isInteger(priority) &&
      !(typeof priority === 'string' && priority.trim() && priority.trim().length <= 64)
    ) {
      throw new AssistantActionError('priority_required');
    }
    return { priority: typeof priority === 'string' ? priority.trim() : priority };
  }
  throw new AssistantActionError('action_not_allowed', 403);
}

function sourceRef(input) {
  const source = input && typeof input === 'object' ? input : {};
  const board = typeof source.board === 'string' ? source.board.trim() : '';
  const taskId = typeof source.taskId === 'string' ? source.taskId.trim() : '';
  if (!board || !taskId || board.length > 128 || taskId.length > 256) {
    throw new AssistantActionError('source_required');
  }
  return { board, taskId };
}

function containsPrivateMarker(value, key = '') {
  if (value === true && /^(?:private|isPrivate|twl)$/i.test(key)) return true;
  if (typeof value === 'string') return PRIVATE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((item) => containsPrivateMarker(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) =>
      containsPrivateMarker(child, childKey)
    );
  }
  return false;
}

function isTimeout(error) {
  return Boolean(
    error &&
    (error.name === 'TimeoutError' ||
      ['ETIMEDOUT', 'ERR_OPERATION_TIMED_OUT', 'transport_timeout'].includes(error.code) ||
      /timed?\s*out/i.test(String(error.message || '')))
  );
}

function resultSignature(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function isCovered(result) {
  return result === 'covered' || Boolean(result && result.covered === true);
}

function createAssistantActionExecutor(options = {}) {
  const { kanban, scopeChecker } = options;
  if (
    !kanban ||
    typeof kanban.readTask !== 'function' ||
    typeof kanban.applyAction !== 'function'
  ) {
    throw new TypeError('kanban_adapter_required');
  }
  const idempotency = new Map();

  async function readBack(source) {
    const task = await kanban.readTask(source);
    if (!task) throw new AssistantActionError('source_task_not_found', 404);
    return task;
  }

  async function run(input, source, payload, key) {
    const before = await readBack(source);
    if (
      containsPrivateMarker(source) ||
      containsPrivateMarker(before) ||
      containsPrivateMarker(payload)
    ) {
      throw new AssistantActionError('private_source_rejected', 403);
    }
    const beforeFingerprint = sourceFingerprint(before);
    const expectedFingerprint = cleanText(input.sourceFingerprint, 'sourceFingerprint', 128);
    if (expectedFingerprint !== beforeFingerprint) {
      throw new AssistantActionError('source_fingerprint_mismatch', 409);
    }

    if (SCOPED_ACTIONS.includes(input.action)) {
      if (typeof scopeChecker !== 'function') {
        throw new AssistantActionError('scope_not_covered', 403);
      }
      const coverage = await scopeChecker({
        action: input.action,
        source,
        payload,
        task: structuredClone(before),
      });
      if (!isCovered(coverage)) throw new AssistantActionError('scope_not_covered', 403);
    }

    const command = Object.freeze({
      action: input.action,
      source: Object.freeze({ ...source }),
      payload: Object.freeze({ ...payload }),
      idempotencyKey: key,
      sourceFingerprint: beforeFingerprint,
    });

    let adapterReceipt;
    try {
      adapterReceipt = await kanban.applyAction(command);
    } catch (error) {
      if (!isTimeout(error)) throw error;
      let task = null;
      let readBackError = null;
      try {
        task = await readBack(source);
      } catch (readError) {
        readBackError = readError.code || readError.message || 'readback_failed';
      }
      return {
        ok: false,
        status: 'ambiguous',
        action: input.action,
        source,
        idempotencyKey: key,
        sourceFingerprint: beforeFingerprint,
        reconciliation: {
          status: 'ambiguous',
          reason: 'write_timeout',
          readBack: task
            ? { task: structuredClone(task), fingerprint: sourceFingerprint(task) }
            : null,
          readBackError,
        },
      };
    }

    const after = await readBack(source);
    if (containsPrivateMarker(after))
      throw new AssistantActionError('private_source_rejected', 403);
    return {
      ok: true,
      status: 'applied',
      action: input.action,
      source,
      idempotencyKey: key,
      sourceFingerprint: beforeFingerprint,
      receipt: {
        adapter: adapterReceipt === undefined ? null : structuredClone(adapterReceipt),
        readBack: {
          task: structuredClone(after),
          fingerprint: sourceFingerprint(after),
        },
      },
    };
  }

  async function execute(input = {}) {
    const action = typeof input.action === 'string' ? input.action : '';
    if (!ALLOWED_ACTIONS.includes(action))
      throw new AssistantActionError('action_not_allowed', 403);
    const source = sourceRef(input.source);
    const payload = normalizePayload(action, input.payload);
    const key = cleanText(input.idempotencyKey, 'idempotencyKey', 256);
    if (containsPrivateMarker(source) || containsPrivateMarker(payload)) {
      throw new AssistantActionError('private_source_rejected', 403);
    }
    const signature = resultSignature({
      action,
      source,
      payload,
      sourceFingerprint: input.sourceFingerprint,
    });
    const existing = idempotency.get(key);
    if (existing) {
      if (existing.signature !== signature) {
        throw new AssistantActionError('idempotency_key_conflict', 409);
      }
      const result = await existing.promise;
      return { ...structuredClone(result), deduplicated: true };
    }

    const promise = run({ ...input, action }, source, payload, key);
    idempotency.set(key, { signature, promise });
    try {
      const result = await promise;
      return { ...structuredClone(result), deduplicated: false };
    } catch (error) {
      idempotency.delete(key);
      throw error;
    }
  }

  return { actions: ALLOWED_ACTIONS, execute };
}

module.exports = {
  ALLOWED_ACTIONS,
  AssistantActionError,
  BASE_ACTIONS,
  SCOPED_ACTIONS,
  createAssistantActionExecutor,
  normalizePayload,
  sourceFingerprint,
};
