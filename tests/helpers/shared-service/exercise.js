const assert = require('node:assert/strict');

// Require real-service observations to exercise each oracle.
function observeExercise(state, seen) {
  if (state.fresh && state.activations.length) seen.add('I-1');
  if (state.activations.some((item) => item.touchedAt && item.responsibility.cet)) seen.add('I-2');
  if (state.activations.some((item) => item.state === 'active')) seen.add('I-3');
  if (state.operationAttempts.some((item) => item.externalEffect)) seen.add('I-4');
  if (state.activityQueries.length) seen.add('I-5');
  if (state.emptyWakes.length) seen.add('I-6');
  for (const item of state.corrections) seen.add(`I-7:${item.event.target}`);
  if (state.authorizationChecks.some((item) => item.before === false)) seen.add('I-8');
  if (state.handoffs.length) seen.add('I-9');
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
