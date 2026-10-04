'use strict';

const { Utils } = require('moleculer');
const { compareCanonicalStrings } = require('./canonical-order');

const WAKE_DEFAULTS = Object.freeze({
  defaultIntervalSec: 900,
  minimumIntervalSec: 60,
  maximumIntervalSec: 86400,
  emptyFactor: 2,
  findingFactor: 0.5,
  frequentFindings: 2,
  deadlineWindowSec: 3600,
  deadlineFactor: 0.25,
  timerIntervalMs: 1000,
  minimumAllowance: 0.1,
  pushMode: 'event',
  conflictRetries: 8,
  eventHistoryLimit: 128,
});

function validateWakeSettings(settings) {
  for (const key of Object.keys(WAKE_DEFAULTS).filter((key) => key !== 'pushMode'))
    if (!Number.isFinite(settings[key]) || settings[key] <= 0)
      throw new Error(`Invalid wake setting: ${key}`);
  if (
    settings.maximumIntervalSec < settings.minimumIntervalSec ||
    settings.emptyFactor <= 1 ||
    settings.findingFactor >= 1 ||
    settings.deadlineFactor >= 1 ||
    !['event', 'hybrid'].includes(settings.pushMode) ||
    ![settings.conflictRetries, settings.eventHistoryLimit, settings.frequentFindings].every(
      Number.isInteger
    )
  )
    throw new Error('Invalid wake bounds or factors');
}

function clampInterval(value, settings) {
  return Math.min(settings.maximumIntervalSec, Math.max(settings.minimumIntervalSec, value));
}

function deriveWake(fn, settings, availableEvents, dataSources = []) {
  const desired = [...new Set(fn.events?.listens || [])].sort(compareCanonicalStrings);
  const events = [...new Set(availableEvents)]
    .filter((event) => desired.some((pattern) => Utils.match(event, pattern)))
    .sort(compareCanonicalStrings);
  const rhythms = dataSources
    .filter((source) => (fn.dataSources || []).includes(source.sourceId))
    .map((source) => source.refreshIntervalSec ?? source.options?.intervalMinutes * 60)
    .filter((value) => Number.isFinite(value) && value > 0);
  const intervalSec = clampInterval(
    fn.wake?.intervalSec || (rhythms.length ? Math.min(...rhythms) : settings.defaultIntervalSec),
    settings
  );
  return {
    mode: events.length ? 'hybrid' : 'schedule',
    intervalSec,
    events,
    pushGaps: desired.length
      ? desired
          .filter((pattern) => !events.some((event) => Utils.match(event, pattern)))
          .map((eventType) => ({ eventType, reason: 'missing_producer' }))
      : [{ eventType: '*', reason: 'missing_listener' }],
  };
}

function adaptInterval(wake, result, settings, now) {
  const findings = Array.isArray(result.findings) ? result.findings.length : result.findings;
  if (
    !Number.isInteger(findings) ||
    findings < 0 ||
    !Number.isFinite(result.consumedUnits) ||
    result.consumedUnits < 0 ||
    !Array.isArray(result.proposals)
  )
    throw new Error('Invalid runCycle result');
  const findingStreak = findings ? (wake.findingStreak || 0) + 1 : 0;
  // Empty cycles always back off; a deadline never defeats the empty-cycle bound.
  let intervalSec = wake.intervalSec;
  if (!findings) intervalSec *= settings.emptyFactor;
  else {
    if (findingStreak >= settings.frequentFindings) intervalSec *= settings.findingFactor;
    const deadlines = [
      ...(Array.isArray(result.findings) ? result.findings : []),
      ...result.proposals,
    ]
      .map((item) => Date.parse(item?.dueAt))
      .filter(Number.isFinite);
    if (deadlines.some((at) => at >= now && at - now <= settings.deadlineWindowSec * 1000))
      intervalSec *= settings.deadlineFactor;
  }
  return { findings, findingStreak, intervalSec: clampInterval(intervalSec, settings) };
}

function canWake(record, activation, settings) {
  return (
    record.lifecycle === 'active' &&
    !record.blocked &&
    activation?.state === 'active' &&
    activation.responsibility?.cet === true &&
    activation.attention?.retired !== true &&
    activation.attention?.allowanceExhausted === false &&
    Number.isFinite(activation.attention?.allowance) &&
    activation.attention.allowance >= settings.minimumAllowance
  );
}

function eventMatches(fn, eventName, payload, wake) {
  if (!payload?.tenantId || !fn || !wake.events.some((event) => Utils.match(eventName, event)))
    return false;
  // Event names select a kind, never an actor or tenant. Scope must be explicit.
  if (payload.functionId) return payload.functionId === fn.functionId;
  if (payload.sourceId) return (fn.dataSources || []).includes(payload.sourceId);
  return false;
}

function wakeMetrics(stats = {}) {
  const wakes = stats.wakes || 0;
  return {
    wakes,
    emptyWakes: stats.emptyWakes || 0,
    pushWakes: stats.pushWakes || 0,
    pushShare: wakes ? (stats.pushWakes || 0) / wakes : 0,
    consumedUnits: stats.consumedUnits || 0,
    errors: stats.errors || 0,
  };
}

module.exports = {
  WAKE_DEFAULTS,
  validateWakeSettings,
  deriveWake,
  adaptInterval,
  canWake,
  eventMatches,
  wakeMetrics,
};
