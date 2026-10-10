const assert = require('node:assert/strict');
const { DEFAULT_REST_WINDOW_MS } = require('./invariants');

// Require real-service observations to exercise each oracle.
function observeExercise(state, seen) {
  const {
    activations = [],
    operationAttempts = [],
    activityQueries = [],
    emptyWakes = [],
    corrections = [],
    authorizationChecks = [],
    handoffs = [],
  } = state;
  if (state.fresh && activations.length) seen.add('I-1');
  const now = state.now ?? Date.now();
  const restWindowMs = state.restWindowMs ?? DEFAULT_REST_WINDOW_MS;
  if (
    activations.some((item) => {
      const age = now - Date.parse(item.touchedAt);
      return item.touchedAt && item.responsibility.cet && age >= 0 && age <= restWindowMs;
    })
  )
    seen.add('I-2');
  if (activations.some((item) => item.responsibility.cet)) seen.add('I-3');
  if (operationAttempts.some((item) => item.externalEffect)) seen.add('I-4');
  if (activityQueries.length) seen.add('I-5');
  if (emptyWakes.length) seen.add('I-6');
  for (const item of corrections) seen.add(`I-7:${item.event.target}`);
  if (authorizationChecks.some((item) => item.before === false)) seen.add('I-8');
  if (
    (state.attentionTransitions || []).some(
      (item) => item.after.relevance < item.before.relevance
    ) &&
    (state.attentionTransitions || []).some(
      (item) => item.after.consumedUnits > item.before.consumedUnits
    ) &&
    (state.attentionTransitions || []).some((item) => !item.turns)
  )
    seen.add('I-10');
  if (
    (state.signalObservations || []).some((row) =>
      row.signals.some((s) => s.state === 'needs_context')
    ) &&
    (state.signalCalls || []).some((call) => call.source === 'request')
  )
    seen.add('I-11');
  if (handoffs.length) seen.add('I-9');
  if (state.notices?.length) seen.add('I-12');
}

function assertExercise(seen, id, seed) {
  const required =
    id === 'I-7'
      ? ['coverage', 'activation', 'agent', 'neighbor'].map((target) => `${id}:${target}`)
      : [id];
  for (const key of required)
    assert.ok(seen.has(key), `seed=${seed}; ${key}: real-service exercise missing`);
}

module.exports = { observeExercise, assertExercise };
