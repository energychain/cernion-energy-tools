'use strict';

const { ServiceBroker } = require('moleculer');
const Broker = require('../services/capability-broker.service');
const PersonalAgent = require('../services/personal-agent.service');
const AgentSidecar = require('../services/agent-sidecar.service');
const ChatgptSidecar = require('../services/chatgpt-sidecar.service');
const Routes = require('../services/domain-routes-management.service');
const Cya = require('../services/cya.service');
const Znp = require('../services/znp.service');
const Utility = require('../services/utility-report.service');
const { buildExecutionPlan } = require('../src/personal-agent-routing');

const task = 'Prüfe die Anschlusskapazität am Umspannwerk.';
const meta = {
  tenantId: 'uncertain-tenant',
  authUser: { authType: 'test', userId: 'actor-a', tenantId: 'uncertain-tenant' },
};

describe('uncertain broker contract at direct consumers (real recommendation)', () => {
  let broker, recommendation, calls;
  const logger = { debug: jest.fn(), warn: jest.fn(), info: jest.fn() };
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(Broker);
    broker.createService(AgentSidecar);
    broker.createService(ChatgptSidecar);
    await broker.start();
    recommendation = await broker.call('capability-broker.recommend', { task });
    expect(recommendation.uncertain).toBe(true);
    expect(recommendation.candidates.length).toBeGreaterThan(0);
    const originalCall = broker.call.bind(broker);
    broker.call = (action, ...args) => {
      calls.push(action);
      return originalCall(action, ...args);
    };
  });
  beforeEach(() => {
    calls = [];
  });
  afterAll(async () => {
    await broker.stop();
  });
  const ctx = () => ({ meta, call: broker.call.bind(broker) });

  test('broker exposes only labeled candidates, never selected actions', () => {
    expect(recommendation.intent).toBe('clarify');
    for (const row of recommendation.candidates) {
      expect(Object.keys(row).sort((a, b) => a.localeCompare(b))).toEqual([
        'capabilityId',
        'displayLabel',
        'score',
      ]);
      expect(row.displayLabel).toEqual(expect.any(String));
    }
    for (const field of [
      'capability',
      'recommendedPlan',
      'recommendedCapabilities',
      'operationCandidates',
      'preferredActions',
      'fallbackActions',
    ])
      expect(recommendation[field]).toBeUndefined();
  });

  test('Personal Agent recommendation cannot trigger local re-selection or a blueprint', async () => {
    const result = await PersonalAgent.methods.getBrokerRecommendation.call({}, ctx(), task);
    const plan = buildExecutionPlan({ message: task, brokerRecommendation: result });
    expect(plan).toMatchObject({ status: 'clarification_required', steps: [] });
    expect(calls).toEqual(['capability-broker.recommend']);
    // Even a locally recognizable blueprint must not override broker abstention.
    expect(
      buildExecutionPlan({
        message: 'Wann soll ich mein Elektroauto CO2-arm laden?',
        brokerRecommendation: result,
      }).steps
    ).toEqual([]);
  });

  test('Personal Agent dossier does not hydrate a candidate-specific action', async () => {
    const dossierCtx = {
      meta,
      params: { question: task, timeBudgetMs: 30000 },
      call: jest.fn(async (action, params, options) => {
        if (action === 'capability-broker.recommend') {
          const result = await broker.call(action, params, options);
          expect(result.uncertain).toBe(true);
          return result;
        }
        if (action === 'object-store.get') return null;
        if (action === 'object-store.query') return { docs: [] };
        if (action === 'knowledge-rag.query') return { data: { results: [] } };
        if (action === 'query.search') return { results: [] };
        if (action === 'datapoint.list') return { datapoints: [] };
        if (action === 'object-store.put') return { ok: true };
        throw new Error(`Unexpected capability action: ${action}`);
      }),
    };
    const result = await PersonalAgent.actions.answerDossier.handler.call(
      { ...PersonalAgent.methods, logger },
      dossierCtx
    );
    expect(result.success).toBe(true);
    expect(calls).toEqual(['capability-broker.recommend']);
    const allowed = new Set([
      'capability-broker.recommend',
      'object-store.get',
      'object-store.query',
      'object-store.put',
      'knowledge-rag.query',
      'query.search',
      'datapoint.list',
    ]);
    expect(dossierCtx.call.mock.calls.every(([action]) => allowed.has(action))).toBe(true);
  });

  test('agent-sidecar transports choices without executing them', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      { name: 'cernion.recommend_capability', input: { task } },
      { meta: { apiToken: { tenantId: meta.tenantId, userId: 'actor-a', scope: 'read-only' } } }
    );
    expect(JSON.stringify(result)).toContain('"uncertain":true');
    expect(calls).toEqual(['agent-sidecar.callTool', 'capability-broker.recommend']);
  });

  test.each(['plan', 'browserPlan'])(
    'chatgpt-sidecar.%s never executes a candidate',
    async (action) => {
      const session = await broker.call(
        'chatgpt-sidecar.createSession',
        { capabilityProfile: ['knowledge-rag'] },
        {
          meta: {
            authUser: { ...meta.authUser, roles: ['full-access', 'chatgpt-sidecar-creator'] },
          },
        }
      );
      calls = [];
      const ticket = session.ticketUrl.split('/s/')[1].split('/')[0];
      const result = await broker.call(`chatgpt-sidecar.${action}`, { ticket, task });
      expect(result.recommendation).toMatchObject({ uncertain: true, intent: 'clarify' });
      expect(result.recommendation.recommendedPlan).toBeUndefined();
      expect(calls).toEqual([`chatgpt-sidecar.${action}`, 'capability-broker.recommend']);
    }
  );

  test('domain-routes test matrix cannot treat an uncertain candidate as selected', async () => {
    const result = await Routes.methods._runTestMatrix.call({ broker }, [
      { prompt: task, expectedCapability: recommendation.candidates[0].capabilityId },
    ]);
    expect(result[0]).toMatchObject({ passed: false });
    expect(calls).toEqual(['capability-broker.recommend']);
  });

  test('CYA planning signals contain no executable candidate action', async () => {
    const result = await Cya.methods.getPlanningOntologySignals.call({ broker, logger }, ctx(), {
      profile: {},
      context: { trigger: task },
      targetAudience: 'reviewer',
    });
    expect(result.topActions).toEqual([]);
    expect(result.intent).toBe('clarify');
    expect(calls).toEqual(['capability-broker.recommend']);
  });

  test('ZNP planning assist never calls a candidate-specific action', async () => {
    const result = await Znp.methods.getPlanningAssist.call({ broker, logger }, ctx(), { task });
    expect(result.intent).toBe('clarify');
    expect(calls).toEqual(['capability-broker.recommend']);
  });

  test('Utility Report planning assist contains no selected capability', async () => {
    const result = await Utility.methods.getPlanningAssist.call({ broker, logger }, ctx(), task);
    expect(result.capabilities).toEqual([]);
    expect(result.intent).toBe('clarify');
    expect(calls).toEqual(['capability-broker.recommend']);
  });
});
