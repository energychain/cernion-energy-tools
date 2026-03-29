'use strict';

/**
 * Tests for the new agent.executePlan action (v0.11)
 *
 * Verifies lean plan execution without session lifecycle or LLM involvement.
 * Downstream service calls are satisfied by lightweight stub services
 * registered on the test broker.
 */

const { ServiceBroker } = require('moleculer');

// Silence Gemini import in agent.service (no real API calls in these tests)
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: jest.fn(),
    })),
  })),
}));

const AgentService = require('../services/agent.service');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Moleculer service that captures calls and returns a fixed response.
 * @param {string} serviceName  e.g. 'gas-storage'
 * @param {string} actionName   e.g. 'countryStorage'
 * @param {Function} handler    (ctx) => any
 */
function stubService(serviceName, actionName, handler) {
  return {
    name: serviceName,
    actions: {
      [actionName]: { handler },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('agent.executePlan', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(AgentService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('executes a 2-step plan and returns { success: true, stepResults }', async () => {
    // Register stub services on the broker for this test
    const svc1 = broker.createService(
      stubService('gas-storage-ep1', 'step1', () => ({ data: { level: 65, country: 'de' } }))
    );
    const svc2 = broker.createService(
      stubService('energy-market-ep1', 'step2', () => ({ data: { price: 42.5 } }))
    );
    await broker.waitForServices(['gas-storage-ep1', 'energy-market-ep1']);

    const plan = {
      summary: 'Mock 2-step plan',
      steps: [
        { step: 1, action: 'gas-storage-ep1.step1', description: 'Step 1', params: { country: 'de' } },
        { step: 2, action: 'energy-market-ep1.step2', description: 'Step 2', params: { market: 'day-ahead' } },
      ],
      requiredInputs: [],
    };

    const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].step).toBe(1);
    expect(result.stepResults[0].error).toBeNull();
    expect(result.stepResults[1].step).toBe(2);
    expect(result.stepResults[1].error).toBeNull();
    expect(result.executedAt).toBeDefined();

    await broker.destroyService(svc1);
    await broker.destroyService(svc2);
  });

  it('aborts on first failing step and marks success: false', async () => {
    const svc1 = broker.createService(
      stubService('failing-ep1', 'step1', () => {
        throw new Error('MCP timeout');
      })
    );
    const svc2 = broker.createService(
      stubService('unreachable-ep1', 'step2', () => ({ ok: true }))
    );
    await broker.waitForServices(['failing-ep1', 'unreachable-ep1']);

    const plan = {
      summary: 'Mock failure plan',
      steps: [
        { step: 1, action: 'failing-ep1.step1', description: 'Step 1', params: {} },
        { step: 2, action: 'unreachable-ep1.step2', description: 'Step 2', params: {} },
      ],
      requiredInputs: [],
    };

    const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

    expect(result.success).toBe(false);
    // Only step 1 appears in stepResults — step 2 was never reached
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].error.message).toBe('MCP timeout');

    await broker.destroyService(svc1);
    await broker.destroyService(svc2);
  });

  it('merges requiredInputs defaults with userInputs (userInputs wins)', async () => {
    const captured = [];
    const svc = broker.createService(
      stubService('merge-ep1', 'action', (ctx) => {
        captured.push(ctx.params);
        return { ok: true };
      })
    );
    await broker.waitForServices(['merge-ep1']);

    const plan = {
      summary: 'Input merge test',
      steps: [
        { step: 1, action: 'merge-ep1.action', description: 'Step', params: { country: null, days: null } },
      ],
      requiredInputs: [
        { name: 'country', default: 'de', required: true },
        { name: 'days', default: 7, required: false },
      ],
    };

    await broker.call('agent.executePlan', {
      plan,
      userInputs: { country: 'fr' }, // override the default
    });

    expect(captured[0].country).toBe('fr');
    expect(captured[0].days).toBe(7); // default kept

    await broker.destroyService(svc);
  });

  it('resolves __step_N chaining references between steps', async () => {
    const step2Params = [];
    const svc1 = broker.createService(
      stubService('lookup-ep1', 'marketPartners', () => ({
        data: { results: [{ bdewCode: '9900123' }] },
      }))
    );
    const svc2 = broker.createService(
      stubService('assets-ep1', 'solar', (ctx) => {
        step2Params.push(ctx.params);
        return { installations: [] };
      })
    );
    await broker.waitForServices(['lookup-ep1', 'assets-ep1']);

    const plan = {
      summary: 'Chaining test',
      steps: [
        { step: 1, action: 'lookup-ep1.marketPartners', description: 'Lookup', params: { query: 'TWL' } },
        { step: 2, action: 'assets-ep1.solar', description: 'Assets', params: { bdewCode: '__step_1.data.results[0].bdewCode' } },
      ],
      requiredInputs: [],
    };

    const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

    expect(result.success).toBe(true);
    expect(step2Params[0].bdewCode).toBe('9900123');

    await broker.destroyService(svc1);
    await broker.destroyService(svc2);
  });

  it('returns executedAt as ISO timestamp', async () => {
    const svc = broker.createService(
      stubService('health-ep1', 'ping', () => ({ pong: true }))
    );
    await broker.waitForServices(['health-ep1']);

    const plan = {
      summary: 'Timestamp test',
      steps: [
        { step: 1, action: 'health-ep1.ping', description: 'Ping', params: {} },
      ],
      requiredInputs: [],
    };

    const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

    expect(typeof result.executedAt).toBe('string');
    expect(new Date(result.executedAt).toISOString()).toBe(result.executedAt);

    await broker.destroyService(svc);
  });

  // ── Issue #32: Intervention plumbing ──────────────────────────────────

  describe('interventions (Issue #32)', () => {
    it('returns an interventions array in the result', async () => {
      const svc = broker.createService(
        stubService('int-ep1', 'action', () => ({ ok: true }))
      );
      await broker.waitForServices(['int-ep1']);

      const plan = {
        summary: 'Interventions array test',
        steps: [
          { step: 1, action: 'int-ep1.action', description: 'Step', params: {} },
        ],
        requiredInputs: [],
      };

      const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

      expect(Array.isArray(result.interventions)).toBe(true);

      await broker.destroyService(svc);
    });

    it('records step_failure interventions when a step fails', async () => {
      const svc = broker.createService(
        stubService('fail-int-ep1', 'action', () => {
          throw new Error('Upstream timeout');
        })
      );
      await broker.waitForServices(['fail-int-ep1']);

      const plan = {
        summary: 'Failure intervention test',
        steps: [
          { step: 1, action: 'fail-int-ep1.action', description: 'Step', params: {} },
        ],
        requiredInputs: [],
      };

      const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

      expect(result.success).toBe(false);
      expect(result.interventions.length).toBeGreaterThanOrEqual(1);

      const failIntervention = result.interventions.find((i) => i.action === 'step_failure');
      expect(failIntervention).toBeDefined();
      expect(failIntervention.reason).toContain('Upstream timeout');
      expect(failIntervention.confidence_score).toBe(1.0);
      expect(failIntervention.agent_id).toBe('executePlan');
      expect(failIntervention.timestamp).toBeDefined();

      await broker.destroyService(svc);
    });

    it('returns empty interventions when no repairs or failures occur', async () => {
      const svc = broker.createService(
        stubService('clean-ep1', 'action', () => ({ ok: true }))
      );
      await broker.waitForServices(['clean-ep1']);

      const plan = {
        summary: 'Clean execution',
        steps: [
          { step: 1, action: 'clean-ep1.action', description: 'Step', params: {} },
        ],
        requiredInputs: [],
      };

      const result = await broker.call('agent.executePlan', { plan, userInputs: {} });

      expect(result.success).toBe(true);
      expect(result.interventions).toEqual([]);

      await broker.destroyService(svc);
    });
  });
});
