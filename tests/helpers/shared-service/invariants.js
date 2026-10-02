const assert = require('node:assert/strict');

// Observation envelope is test-only; its records retain the #693 data contract.
const invariants = {
  'I-1': (state) => {
    if (!state.fresh) return;
    assert.ok(
      state.activations.every((item) => item.state === 'latent' && !item.responsibility.cet)
    );
    assert.equal(state.agents.length, 0);
  },
  'I-2': (state) => {
    for (const item of state.activations) {
      if (item.touchedAt && !item.responsibility.humans.length) assert.equal(item.state, 'active');
      if (item.responsibility.cet)
        assert.equal(
          state.agents.filter(
            (agent) =>
              agent.tenantId === item.tenantId &&
              agent.functionId === item.functionId &&
              agent.lifecycle !== 'retired'
          ).length,
          1
        );
    }
  },
  'I-3': (state) => {
    const active = state.activations.filter((item) => item.state === 'active').length;
    assert.ok(active <= state.activationBound, 'active count exceeds graph bound');
    assert.ok(active <= state.tenantBudget, 'active count exceeds tenant budget');
  },
  'I-4': (state) => {
    for (const attempt of state.operationAttempts) {
      if (
        attempt.externalEffect ||
        !attempt.authorized ||
        attempt.noCallBlocked ||
        attempt.requiresHITL
      )
        assert.equal(attempt.executed, false);
    }
  },
  'I-5': (state) => {
    for (const query of state.activityQueries) {
      assert.equal(query.mode, 'system_activity_query');
      assert.equal(query.knowledgeCalls, 0);
      assert.equal(query.ragCalls, 0);
      assert.deepEqual(query.answerState, query.journalDigest);
    }
  },
  'I-6': (state) => {
    for (const wake of state.emptyWakes) {
      assert.ok(wake.afterIntervalSec >= wake.beforeIntervalSec);
      assert.ok(
        wake.afterIntervalSec > wake.beforeIntervalSec ||
          wake.beforeIntervalSec === wake.maximumIntervalSec
      );
      assert.ok(wake.afterIntervalSec <= wake.maximumIntervalSec);
    }
  },
  'I-7': (state) => {
    for (const change of state.corrections) {
      assert.notDeepEqual(change.before, change.after);
      assert.ok(
        state.journal.some(
          (entry) =>
            entry.kind === 'corrected' &&
            entry.tenantId === change.event.tenantId &&
            entry.refs.includes(change.event.ref)
        )
      );
    }
  },
  'I-8': (state) => {
    for (const check of state.authorizationChecks) {
      assert.deepEqual(check.before, check.after);
      assert.deepEqual(check.policyBefore, check.policyAfter);
    }
  },
  'I-9': (state) => {
    for (const handoff of state.handoffs) {
      assert.notEqual(handoff.firstActorId, handoff.secondActorId);
      assert.ok(handoff.before.responsibility.cet);
      assert.equal(handoff.after.responsibility.cet, false);
      assert.ok(handoff.after.responsibility.humans.includes(handoff.secondActorId));
      assert.ok(handoff.agents.every((agent) => ['sleeping', 'retired'].includes(agent.lifecycle)));
    }
  },
};

const dependencies = {
  'I-1': {
    issues: '#696/#697',
    paths: ['services/function-activation.service.js', 'services/shared-service-agent.service.js'],
  },
  'I-2': {
    issues: '#695/#696/#697',
    paths: [
      'services/function-coverage.service.js',
      'services/function-activation.service.js',
      'services/shared-service-agent.service.js',
    ],
  },
  'I-3': { issues: '#696', paths: ['services/function-activation.service.js'] },
  'I-4': { issues: '#697', paths: ['services/shared-service-agent.service.js'] },
  'I-5': {
    issues: '#698/#700',
    paths: ['services/shared-service-journal.service.js'],
    marker: 'system_activity_query',
  },
  'I-6': {
    issues: '#697/#699',
    paths: ['services/shared-service-agent.service.js', 'src/shared-service-wake.js'],
  },
  'I-7': {
    issues: '#698/#701',
    paths: ['services/shared-service-journal.service.js'],
    alternatives: ['src/shared-service-learning.js', 'services/shared-service-learning.service.js'],
  },
  'I-8': {
    issues: '#695/#701',
    paths: ['services/function-coverage.service.js'],
    alternatives: ['src/shared-service-learning.js', 'services/shared-service-learning.service.js'],
  },
  'I-9': {
    issues: '#695/#696/#697',
    paths: [
      'services/function-coverage.service.js',
      'services/function-activation.service.js',
      'services/shared-service-agent.service.js',
    ],
  },
};

function assertInvariants(state, ids = Object.keys(invariants)) {
  for (const id of ids) {
    try {
      invariants[id](state);
    } catch (error) {
      error.message = `${id}: ${error.message}`;
      throw error;
    }
  }
}

module.exports = { invariants, dependencies, assertInvariants };
