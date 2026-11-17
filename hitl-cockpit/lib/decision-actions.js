'use strict';

const crypto = require('node:crypto');
const { containsPrivateMarker, sourceFingerprint } = require('./assistant-action-executor');

const ACTIONS = Object.freeze([
  'choose',
  'delegate',
  'question',
  'schedule',
  'reject',
  'return-to-rhajaina',
]);

const DEFAULT_EXCLUDED_BOARDS = Object.freeze(['twl-netze-private']);

class DecisionActionError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'DecisionActionError';
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, field, { required = false, max = 2000 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new DecisionActionError(`${field}_required`);
  if (text.length > max) throw new DecisionActionError(`${field}_too_long`);
  return text || null;
}

function normalizeConstraints(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DecisionActionError('constraints_must_be_array');
  if (value.length > 20) throw new DecisionActionError('too_many_constraints');
  return value.map((item) => cleanText(item, 'constraint', { required: true, max: 300 }));
}

function optionValues(decision) {
  return (Array.isArray(decision.options) ? decision.options : []).map((option) =>
    typeof option === 'string' ? option : String(option.id || option.value || option.label || '')
  );
}

function normalizePayload(action, body, decision, now) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const note = cleanText(payload.note, 'note');

  if (action === 'choose') {
    const option = cleanText(payload.option, 'option', { required: true, max: 300 });
    const available = optionValues(decision);
    if (!available.includes(option)) throw new DecisionActionError('option_not_available', 409);
    return { option, note };
  }
  if (action === 'delegate') {
    const assignee = cleanText(payload.assignee, 'assignee', { required: true, max: 100 });
    const scopeType = cleanText(payload.scopeType, 'scopeType', { max: 100 });
    const validForHours =
      payload.validForHours === undefined ? null : Number(payload.validForHours);
    if (
      validForHours !== null &&
      (!Number.isInteger(validForHours) || validForHours < 1 || validForHours > 720)
    ) {
      throw new DecisionActionError('validForHours_out_of_range');
    }
    return {
      assignee,
      note,
      scopeType,
      validForHours,
      constraints: normalizeConstraints(payload.constraints),
    };
  }
  if (action === 'question') {
    return {
      question: cleanText(payload.question || payload.note, 'question', {
        required: true,
        max: 2000,
      }),
    };
  }
  if (action === 'schedule') {
    const wakeAtText = cleanText(payload.wakeAt, 'wakeAt', { required: true, max: 100 });
    const wakeAtMs = Date.parse(wakeAtText);
    if (!Number.isFinite(wakeAtMs)) throw new DecisionActionError('wakeAt_invalid');
    const wakeAt = Math.floor(wakeAtMs / 1000);
    if (wakeAt <= now) throw new DecisionActionError('wakeAt_must_be_future');
    const autoCloseAtText = cleanText(payload.autoCloseAfter, 'autoCloseAfter', { max: 100 });
    const autoCloseAtMs = autoCloseAtText ? Date.parse(autoCloseAtText) : null;
    if (autoCloseAtText && !Number.isFinite(autoCloseAtMs)) {
      throw new DecisionActionError('autoCloseAfter_invalid');
    }
    if (autoCloseAtMs !== null && autoCloseAtMs < wakeAtMs) {
      throw new DecisionActionError('autoCloseAfter_before_wakeAt');
    }
    return {
      wakeAt: new Date(wakeAtMs).toISOString(),
      reason: cleanText(payload.reason, 'reason', { required: true, max: 2000 }),
      nextAction: cleanText(payload.nextAction, 'nextAction', { required: true, max: 2000 }),
      owner: cleanText(payload.owner, 'owner', { required: true, max: 100 }),
      signalRequired: cleanText(payload.signalRequired, 'signalRequired', { max: 300 }),
      autoCloseAfter: autoCloseAtMs === null ? null : new Date(autoCloseAtMs).toISOString(),
      note,
    };
  }
  if (action === 'reject') {
    return {
      reason: cleanText(payload.reason || payload.note, 'reason', {
        required: true,
        max: 2000,
      }),
    };
  }
  if (action === 'return-to-rhajaina') {
    return { reason: cleanText(payload.reason || payload.note, 'reason', { max: 2000 }) };
  }
  throw new DecisionActionError('unknown_decision_action', 404);
}

function plannedEffects(action, decision, payload) {
  const reference = `${decision.source_board}/${decision.source_task_id}`;
  const common = [
    `source_task_read_back:${reference}`,
    `kanban_comment:decision=${decision.decision_id};action=${action}`,
  ];
  const effects = {
    choose: [...common, `execute_option:${payload.option}`, 'close_decision_after_read_back'],
    delegate: [
      ...common,
      `delegate_to:${payload.assignee}`,
      ...(payload.scopeType ? [`register_scope_via_processor:${payload.scopeType}`] : []),
      'keep_decision_traceable',
    ],
    question: [...common, 'request_clarification', 'keep_decision_open'],
    schedule: [...common, `create_wakeup:${payload.wakeAt}`, 'hide_until_wakeup'],
    reject: [...common, 'return_source_task_for_revision', 'close_decision_after_read_back'],
    'return-to-rhajaina': [
      ...common,
      'assign_projection_completion_to:Rhajaina',
      'keep_decision_open',
    ],
  };
  return effects[action];
}

function isActionable(decision) {
  return Boolean(
    decision &&
    decision.decision_id &&
    decision.source_board &&
    decision.source_task_id &&
    !['closed', 'resolved', 'rejected'].includes(String(decision.status || '').toLowerCase())
  );
}

function createDecisionActions({
  reader,
  writeEnabled = false,
  shadowOnly = true,
  executeEnabled = false,
  kanban,
  excludedBoards,
  now,
} = {}) {
  if (!reader || typeof reader.read !== 'function') throw new TypeError('reader_required');
  const clock = typeof now === 'function' ? now : () => Math.floor(Date.now() / 1000);
  const excluded = new Set(
    Array.isArray(excludedBoards) && excludedBoards.length ? excludedBoards : DEFAULT_EXCLUDED_BOARDS
  );
  const idempotency = new Map();

  function loadActionableDecision(decisionId, action) {
    if (!ACTIONS.includes(action)) throw new DecisionActionError('unknown_decision_action', 404);
    const result = reader.read('decision', { id: decisionId });
    const decision = result && result.item;
    if (!decision) throw new DecisionActionError('decision_not_found', 404);
    if (!isActionable(decision)) throw new DecisionActionError('decision_not_actionable', 409);
    return decision;
  }

  function assertSafeSource(decision) {
    if (excluded.has(decision.source_board)) {
      throw new DecisionActionError('excluded_board_rejected', 403);
    }
    if (containsPrivateMarker(decision)) {
      throw new DecisionActionError('private_source_rejected', 403);
    }
  }

  /**
   * Real, persisted execution of a decision action. Additive to preview(); never replaces it.
   * Gated by `executeEnabled` (operator/runtime flag) AND an explicit `body.confirm === true`
   * AND a caller-supplied idempotencyKey + sourceFingerprint. Fails closed on any mismatch,
   * on excluded boards, or on any private/TWL marker. See
   * management-cockpit-production-contract-v3.md section 3b.
   */
  async function execute(decisionId, action, body) {
    if (!executeEnabled) throw new DecisionActionError('decision_execute_not_enabled', 501);
    if (!kanban || typeof kanban.readTask !== 'function' || typeof kanban.recordDecision !== 'function') {
      throw new DecisionActionError('decision_execute_kanban_adapter_missing', 500);
    }
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (input.confirm !== true) throw new DecisionActionError('confirmation_required', 400);
    const idempotencyKey = cleanText(input.idempotencyKey, 'idempotencyKey', {
      required: true,
      max: 256,
    });
    const expectedFingerprint = cleanText(input.sourceFingerprint, 'sourceFingerprint', {
      required: true,
      max: 128,
    });

    // The idempotency signature is built only from caller-submitted, stable inputs so that a
    // retried call with the same key dedupes even though the live kanban state has since moved
    // on (e.g. our own prior write changed the task). It intentionally does not depend on a
    // fresh kanban read.
    const signature = crypto
      .createHash('sha256')
      .update(JSON.stringify({ decisionId, action, input, expectedFingerprint }))
      .digest('hex');
    const existing = idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.signature !== signature) {
        throw new DecisionActionError('idempotency_key_conflict', 409);
      }
      const result = await existing.promise;
      return { ...structuredClone(result), deduplicated: true };
    }

    const run = (async () => {
      const decision = loadActionableDecision(decisionId, action);
      assertSafeSource(decision);
      const source = { board: decision.source_board, taskId: decision.source_task_id };
      const beforeTask = await kanban.readTask(source);
      if (!beforeTask) throw new DecisionActionError('source_task_not_found', 404);
      if (containsPrivateMarker(beforeTask)) {
        throw new DecisionActionError('private_source_rejected', 403);
      }
      if (sourceFingerprint(beforeTask) !== expectedFingerprint) {
        throw new DecisionActionError('source_fingerprint_mismatch', 409);
      }

      const payload = normalizePayload(action, input, decision, clock());
      const effects = plannedEffects(action, decision, payload);
      const adapterReceipt = await kanban.recordDecision({
        action,
        source,
        payload,
        decisionId: decision.decision_id,
        idempotencyKey,
      });
      const afterTask = await kanban.readTask(source);
      if (!afterTask) throw new DecisionActionError('decision_execute_readback_missing', 502);
      if (containsPrivateMarker(afterTask)) {
        throw new DecisionActionError('private_source_rejected', 403);
      }
      return {
        ok: true,
        mode: 'execute',
        shadowOnly: false,
        writePerformed: true,
        persisted: true,
        action,
        decisionId: decision.decision_id,
        source,
        idempotencyKey,
        normalizedPayload: payload,
        plannedEffects: effects,
        receipt: {
          adapter: adapterReceipt === undefined ? null : structuredClone(adapterReceipt),
          readBack: {
            task: structuredClone(afterTask),
            fingerprint: sourceFingerprint(afterTask),
          },
        },
        message: 'Entscheidung ausgeführt. Kanban-Readback und Receipt liegen vor.',
      };
    })();
    idempotency.set(idempotencyKey, { signature, promise: run });
    try {
      const result = await run;
      return { ...structuredClone(result), deduplicated: false };
    } catch (error) {
      idempotency.delete(idempotencyKey);
      throw error;
    }
  }

  function preview(decisionId, action, body) {
    if (!ACTIONS.includes(action)) throw new DecisionActionError('unknown_decision_action', 404);
    if (writeEnabled || !shadowOnly) {
      throw new DecisionActionError('decision_writes_not_implemented', 501);
    }
    const result = reader.read('decision', { id: decisionId });
    const decision = result && result.item;
    if (!decision) throw new DecisionActionError('decision_not_found', 404);
    if (!isActionable(decision)) throw new DecisionActionError('decision_not_actionable', 409);
    const normalized = normalizePayload(action, body, decision, clock());
    return {
      ok: true,
      mode: 'shadow',
      shadowOnly: true,
      writePerformed: false,
      persisted: false,
      action,
      decisionId: decision.decision_id,
      source: { board: decision.source_board, taskId: decision.source_task_id },
      normalizedPayload: normalized,
      plannedEffects: plannedEffects(action, decision, normalized),
      message: 'Simulation abgeschlossen. Es wurden keine Daten oder externen Systeme verändert.',
    };
  }

  return { actions: ACTIONS, preview, execute };
}

module.exports = {
  ACTIONS,
  DecisionActionError,
  createDecisionActions,
  isActionable,
  normalizePayload,
  plannedEffects,
  DEFAULT_EXCLUDED_BOARDS,
};
