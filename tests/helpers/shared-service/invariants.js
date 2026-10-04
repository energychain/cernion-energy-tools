const assert = require('node:assert/strict');
const DEFAULT_REST_WINDOW_MS = 24 * 60 * 60 * 1000;

// Observation envelope is test-only; its records retain the #693 data contract.
const invariants = {
  'I-1': (state) => {
    if (!state.fresh) return;
    assert.ok(
      state.activations.every((item) => item.state === 'latent' && !item.responsibility.cet)
    );
    assert.equal(state.agents.length, 0);
  },
  'I-2': (
    state,
    {
      now = state.now ?? Date.now(),
      restWindowMs = state.restWindowMs ?? DEFAULT_REST_WINDOW_MS,
    } = {}
  ) => {
    assert.ok(Number.isFinite(now) && Number.isFinite(restWindowMs) && restWindowMs >= 0);
    for (const item of state.activations) {
      if (!item.touchedAt) continue;
      const age = now - Date.parse(item.touchedAt);
      assert.ok(Number.isFinite(age), 'invalid touchedAt');
      if (age < 0 || age > restWindowMs) continue;
      if (!item.responsibility.humans.length) assert.equal(item.state, 'active');
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
    const minWeight = state.minWeight ?? 0.5;
    assert.ok(Number.isFinite(minWeight) && minWeight >= 0 && minWeight <= 1);
    const touched = new Set(
      state.activations.filter((item) => item.touchedAt).map((item) => item.functionId)
    );
    const cet = state.activations.filter((item) => item.responsibility.cet);
    const active = state.activations.filter((item) => item.state === 'active').length;
    assert.ok(cet.length <= state.tenantBudget, 'CET count exceeds tenant budget');
    for (const item of cet) {
      assert.ok(
        state.functions.some(
          (fn) =>
            touched.has(fn.functionId) &&
            fn.neighbors.some(
              (neighbor) => neighbor.functionId === item.functionId && neighbor.weight >= minWeight
            )
        ),
        'CET function is not an eligible neighbor of a touched function'
      );
    }
    assert.ok(
      active <= touched.size + state.tenantBudget,
      'active count exceeds touched functions plus budget'
    );
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
  'I-10': (state) => {
    for (const row of state.activations.filter((item) => item.attention)) {
      const a = row.attention;
      assert.ok(
        a.allowance >= 0 && (state.allowanceCap === undefined || a.allowance <= state.allowanceCap),
        'allowance outside cap'
      );
      assert.ok(
        a.consumedUnits <= a.replenishedUnits + 1e-9,
        'consumption exceeds funded allowance'
      );
    }
    if (state.activatingTurns !== undefined)
      assert.ok(
        state.activations.reduce((sum, row) => sum + (row.attention?.replenishedUnits || 0), 0) <=
          state.activatingTurns * state.allowancePerTurn + 1e-9,
        'funding exceeds turns'
      );
    for (const change of state.attentionTransitions || []) {
      if (!change.refreshed)
        assert.ok(
          change.after.relevance <= change.before.relevance + 1e-12,
          'relevance increased without refresh'
        );
      const consumed = change.after.consumedUnits - change.before.consumedUnits;
      const refill = change.after.replenishedUnits - change.before.replenishedUnits;
      assert.ok(
        consumed <= change.before.allowance + refill + 1e-9,
        'consumption exceeds allowance'
      );
      if (!change.turns) assert.equal(refill, 0, 'refill without activating turns');
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
  'I-10': {
    issues: '#715',
    paths: ['services/function-activation.service.js', 'src/function-attention.js'],
  },
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
    issues: '#699/#697',
    paths: [
      'services/shared-service-wake.service.js',
      'src/shared-service-wake.js',
      'services/shared-service-agent.service.js',
    ],
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

function assertInvariants(state, ids = Object.keys(invariants), options = {}) {
  for (const id of ids) {
    try {
      invariants[id](state, options);
    } catch (error) {
      error.message = `${id}: ${error.message}`;
      throw error;
    }
  }
}

module.exports = { invariants, dependencies, assertInvariants, DEFAULT_REST_WINDOW_MS };
