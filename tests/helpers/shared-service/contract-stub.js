const assert = require('node:assert/strict');

// Records input only. Deliberately does not implement activation, learning or agents.
function createContractStub(functions, clock = { now: Date.UTC(2026, 0, 1) }) {
  const seen = [];
  return {
    seen,
    async apply(step) {
      if (step.type === 'advance') {
        clock.now += step.milliseconds;
        return;
      }
      const payload = step.payload || step;
      assert.ok(functions.some((item) => item.functionId === (payload.functionId || payload.ref)));
      assert.equal(payload.tenantId, 'tenant-a');
      assert.ok(payload.actorId.startsWith('actor-'));
      if (step.type === 'touch') {
        assert.equal(step.event, 'function.touched.v1');
        seen.push({
          event: step.event,
          payload: { ...payload, at: new Date(clock.now).toISOString() },
        });
      } else if (step.type === 'correction') {
        assert.equal(step.event, 'shared-service.correction.v1');
        assert.ok(['coverage', 'activation', 'agent', 'neighbor'].includes(payload.target));
        seen.push(step);
      } else seen.push(step);
    },
    async snapshot() {
      return {
        fresh: true,
        activations: functions.map((item) => ({
          tenantId: 'tenant-a',
          functionId: item.functionId,
          state: 'latent',
          touchedAt: null,
          touchedBy: [],
          responsibility: { humans: [], cet: false },
          reason: [],
        })),
        agents: [],
        functions,
        now: clock.now,
        tenantBudget: 32,
        operationAttempts: [],
        activityQueries: [],
        emptyWakes: [],
        corrections: [],
        journal: [],
        authorizationChecks: [],
        handoffs: [],
      };
    },
    async close() {},
  };
}

module.exports = { createContractStub };
