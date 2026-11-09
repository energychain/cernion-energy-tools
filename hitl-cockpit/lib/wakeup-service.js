'use strict';

const crypto = require('node:crypto');

const WAKEUP_STATES = Object.freeze([
  'invalid_contract',
  'scheduled',
  'awaiting_signal',
  'due',
  'quality_error',
]);

function toEpochSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number > 100000000000 ? number / 1000 : number);
}

function cleanText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function readWakeupContract(task = {}) {
  const wakeup = task.wakeup && typeof task.wakeup === 'object' ? task.wakeup : {};
  return {
    wakeAt: toEpochSeconds(wakeup.wakeAt ?? task.wake_at),
    whyScheduled: cleanText(wakeup.whyScheduled ?? task.why_scheduled),
    nextAction: cleanText(wakeup.nextAction ?? task.next_action_on_wake),
    owner: cleanText(wakeup.owner ?? task.owner ?? task.assignee),
    signalRequired: cleanText(wakeup.signalRequired ?? task.signal_required),
    autoCloseAfter: toEpochSeconds(wakeup.autoCloseAfter ?? task.auto_close_after),
    lastSignalAt: toEpochSeconds(wakeup.lastSignalAt ?? task.last_signal_at),
    lastWokenAt: toEpochSeconds(wakeup.lastWokenAt ?? task.last_woken_at),
    wakeCount: Math.max(0, Number(wakeup.wakeCount ?? task.wake_count) || 0),
    sourceUpdatedAt: toEpochSeconds(
      wakeup.sourceUpdatedAt ??
        task.updated_at ??
        task.completed_at ??
        task.started_at ??
        task.created_at
    ),
    previousSourceFingerprint: cleanText(
      wakeup.previousSourceFingerprint ?? task.previous_source_fingerprint
    ),
  };
}

function validateWakeupContract(value) {
  const contract = value && value.wakeAt !== undefined ? value : readWakeupContract(value);
  const errors = [];
  if (!contract.wakeAt) errors.push('wake_at_required');
  if (!contract.whyScheduled) errors.push('why_scheduled_required');
  if (!contract.nextAction) errors.push('next_action_on_wake_required');
  if (!contract.owner) errors.push('owner_required');
  if (contract.autoCloseAfter && contract.wakeAt && contract.autoCloseAfter < contract.wakeAt) {
    errors.push('auto_close_after_before_wake_at');
  }
  return { valid: errors.length === 0, errors, contract };
}

function sourceFingerprint(task = {}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        status: task.status || null,
        title: task.title || null,
        body: task.body || null,
        result: task.result || null,
        comments: task.comments || [],
        updatedAt:
          task.updated_at || task.completed_at || task.started_at || task.created_at || null,
      })
    )
    .digest('hex');
}

function evaluateWakeup(task, options = {}) {
  const now = toEpochSeconds(options.now) || Math.floor(Date.now() / 1000);
  const validation = validateWakeupContract(task);
  const base = {
    sourceBoard: task.board || task.source_board || null,
    sourceTaskId: task.id || task.source_task_id || null,
    contract: validation.contract,
    evaluatedAt: now,
    readOnly: true,
    shouldMutateSource: false,
  };
  if (!validation.valid) {
    return { ...base, state: 'invalid_contract', visible: false, errors: validation.errors };
  }

  const contract = validation.contract;
  if (now < contract.wakeAt) {
    return { ...base, state: 'scheduled', visible: false, errors: [] };
  }

  const fingerprint = sourceFingerprint(task);
  const noChangeAfterWake = Boolean(
    contract.lastWokenAt &&
    ((contract.previousSourceFingerprint && contract.previousSourceFingerprint === fingerprint) ||
      (contract.sourceUpdatedAt && contract.sourceUpdatedAt <= contract.lastWokenAt))
  );
  if (contract.wakeCount > 0 && noChangeAfterWake) {
    return {
      ...base,
      state: 'quality_error',
      visible: true,
      errors: ['repeated_wakeup_without_state_change'],
      qualityError: 'repeated_wakeup_without_state_change',
      newSignalAt: contract.lastSignalAt,
    };
  }

  if (
    contract.signalRequired &&
    (!contract.lastSignalAt ||
      (contract.lastWokenAt && contract.lastSignalAt <= contract.lastWokenAt))
  ) {
    return {
      ...base,
      state: 'awaiting_signal',
      visible: false,
      errors: [],
      newSignalAt: contract.lastSignalAt,
      autoCloseCandidate: Boolean(contract.autoCloseAfter && now >= contract.autoCloseAfter),
    };
  }

  return {
    ...base,
    state: 'due',
    visible: true,
    errors: [],
    reason: contract.whyScheduled,
    nextAction: contract.nextAction,
    owner: contract.owner,
    newSignalAt: contract.lastSignalAt,
  };
}

function analyzeWakeups(tasks, options = {}) {
  const evaluations = tasks
    .filter((task) => String(task.status || '').toLowerCase() === 'scheduled')
    .map((task) => evaluateWakeup(task, options));
  const byState = Object.fromEntries(WAKEUP_STATES.map((state) => [state, 0]));
  for (const evaluation of evaluations) byState[evaluation.state] += 1;
  return {
    ok: true,
    readOnly: true,
    sourceMutationCount: 0,
    evaluatedAt: toEpochSeconds(options.now) || Math.floor(Date.now() / 1000),
    counts: byState,
    due: evaluations.filter((item) => item.state === 'due'),
    awaitingSignal: evaluations.filter((item) => item.state === 'awaiting_signal'),
    future: evaluations.filter((item) => item.state === 'scheduled'),
    qualityErrors: evaluations.filter((item) => item.state === 'quality_error'),
    historicalWithoutContract: evaluations.filter((item) => item.state === 'invalid_contract'),
  };
}

module.exports = {
  WAKEUP_STATES,
  analyzeWakeups,
  evaluateWakeup,
  readWakeupContract,
  sourceFingerprint,
  toEpochSeconds,
  validateWakeupContract,
};
