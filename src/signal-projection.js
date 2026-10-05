'use strict';

const { createHash } = require('node:crypto');
const { compareCanonicalStrings } = require('./canonical-order');
const defaultRules = require('../signal-projection.rules.json');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareCanonicalStrings)
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
function signalKey(...values) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(values)))
    .digest('hex');
}
function matches(pattern, value) {
  return new RegExp(pattern, 'i').test(String(value));
}
function statusState(value, rules = defaultRules) {
  for (const state of ['unknown', 'needs_context', 'breach', 'warn', 'ok'])
    if (matches(rules.tokens[state], value)) return state;
  return 'unknown';
}
function scoreState(value, previous, rules = defaultRules) {
  const { warnBelow, breachBelow, hysteresis } = rules.score;
  if (value < breachBelow || (previous === 'breach' && value < breachBelow + hysteresis))
    return 'breach';
  if (value < warnBelow || (previous === 'warn' && value < warnBelow + hysteresis)) return 'warn';
  return 'ok';
}
function isFinding(signal) {
  return (
    !['needs_context', 'unknown'].includes(signal.state) &&
    (['warn', 'breach'].includes(signal.state) || signal.kind === 'finding')
  );
}
function operationInput(entry, context, tenantId) {
  const { deny } = require('./domain-router-policy');
  const input = {};
  for (const name of entry.parameterNames || []) {
    if (context?.params?.[name] !== undefined) input[name] = context.params[name];
    if (context && (name === context.kind || name === `${context.kind}Id`))
      input[name] = context.ref;
  }
  if (context?.params?.tenantId && context.params.tenantId !== tenantId) deny('Tenant mismatch');
  return { ...input, tenantId };
}
function projectSignals(
  response,
  operation,
  { context, rules = defaultRules, previous = {} } = {}
) {
  if (!response || typeof response !== 'object') return [];
  const asOf = Number.isFinite(Date.parse(response.timestamp)) ? response.timestamp : rules.asOf;
  const unavailable =
    response.success === false ||
    response.found === false ||
    (statusState(response.status, rules) === 'unknown' &&
      matches(rules.tokens.unknown, response.status));
  const needsContext =
    !context &&
    (operation.classification === 'contextual' ||
      statusState(response.status, rules) === 'needs_context');
  const base = {
    operationId: operation.operationId,
    functionIds: [...(operation.functionIds || [])].sort(compareCanonicalStrings),
    asOf,
    ...(context ? { context: canonical(context) } : {}),
  };
  const normalize = (item, identity) => ({
    ...item,
    ...base,
    signalId: `${operation.operationId}:${identity}`,
    state: needsContext ? 'needs_context' : unavailable ? 'unknown' : item.state,
  });
  // Native signals replace the projection, including an intentionally empty array.
  if (Array.isArray(response.signals))
    return response.signals
      .filter(
        (s) =>
          s &&
          ['score', 'count', 'state', 'finding', 'timestamp'].includes(s.kind) &&
          ['ok', 'warn', 'breach', 'needs_context', 'unknown'].includes(s.state)
      )
      .map((s) => normalize(s, `native:${s.signalId || signalKey(s.kind, s.code, s.label)}`))
      .sort((a, b) => compareCanonicalStrings(a.signalId, b.signalId));
  const signals = [];
  const add = (field, item, suffix = '') => {
    const signal = normalize(
      {
        label: field,
        ...item,
        state: context && item.state === 'needs_context' ? 'warn' : item.state,
      },
      `${field}${suffix}`
    );
    if (signal.kind === 'score' && !needsContext && !unavailable)
      signal.state = scoreState(signal.value, previous[signal.signalId], rules);
    signals.push(signal);
  };
  for (const field of Object.keys(response).sort(compareCanonicalStrings)) {
    const value = response[field];
    if (matches(rules.roles.score, field) && Number.isFinite(value) && value >= 0 && value <= 1)
      add(field, {
        kind: 'score',
        value,
        state: scoreState(value, null, rules),
        threshold: rules.score,
      });
    else if (matches(rules.roles.finding, field) && Array.isArray(value)) {
      const unique = new Map();
      for (const row of value.filter((s) => s && typeof s === 'object')) {
        const identity = signalKey(row.code || row.id || canonical(row));
        const severity = String(row.severity || 'warning').toLowerCase();
        const candidate = {
          kind: 'finding',
          value: canonical(row),
          label: row.message || row.summary || field,
          code: row.code,
          severity,
          state: rules.severity.breach.includes(severity)
            ? 'breach'
            : rules.severity.warn.includes(severity)
              ? 'warn'
              : 'unknown',
          ...(row.dueAt ? { dueAt: row.dueAt } : {}),
        };
        const rank = { unknown: 0, warn: 1, breach: 2 };
        const old = unique.get(identity);
        if (
          !old ||
          rank[candidate.state] > rank[old.state] ||
          (rank[candidate.state] === rank[old.state] &&
            compareCanonicalStrings(
              JSON.stringify(canonical(candidate)),
              JSON.stringify(canonical(old))
            ) > 0)
        )
          unique.set(identity, candidate);
      }
      for (const [id, item] of unique) add(field, item, `:${id}`);
    } else if (matches(rules.roles.missing, field) && Array.isArray(value)) {
      add(field, { kind: 'count', value: value.length, state: value.length ? 'warn' : 'ok' });
      for (const row of value)
        add(field, { kind: 'finding', value: canonical(row), state: 'warn' }, `:${signalKey(row)}`);
    } else if (matches(rules.roles.count, field) && Number.isFinite(value))
      add(field, { kind: 'count', value, state: 'ok' });
    else if (matches(rules.roles.state, field) && typeof value === 'string')
      add(field, { kind: 'state', value, state: statusState(value, rules) });
    else if (matches(rules.roles.timestamp, field) && Number.isFinite(Date.parse(value)))
      add(field, { kind: 'timestamp', value, state: 'ok' });
  }
  return [...new Map(signals.map((s) => [s.signalId, s])).values()].sort((a, b) =>
    compareCanonicalStrings(a.signalId, b.signalId)
  );
}
module.exports = {
  operationInput,
  canonical,
  signalKey,
  statusState,
  scoreState,
  projectSignals,
  isFinding,
};
