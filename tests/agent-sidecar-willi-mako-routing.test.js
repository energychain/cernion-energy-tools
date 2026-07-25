'use strict';

// energychain/cernion-energy-tools#498 — sidecar-visible discovery of the
// market-communication / Willi-Mako context path via the existing
// `cernion.recommend_capability` tool. Wires the REAL capability-broker
// service (not a stub) behind the real agent-sidecar service so the actual
// generic MaKo/EDIFACT routing logic is exercised end-to-end. Only the
// downstream willi-mako MCP call is mocked — no live MCP/Qdrant calls.

const { ServiceBroker } = require('moleculer');
const AgentSidecarService = require('../services/agent-sidecar.service');
const CapabilityBrokerService = require('../services/capability-broker.service');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const WilliMakoService = require('../services/willi-mako.service');

describe('agent-sidecar cernion.recommend_capability — Willi-Mako routing (#498)', () => {
  let broker;

  function readOnlyMeta(tenantId = 'public') {
    return {
      meta: {
        apiToken: {
          scope: 'read-only',
          scopes: ['read-only'],
          tenantId,
          userId: 'svc:openclaw',
        },
      },
    };
  }

  beforeEach(() => {
    callWithNewSession.mockReset();
  });

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(AgentSidecarService);
    broker.createService(CapabilityBrokerService);
    broker.createService(WilliMakoService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('recommends the read-only market-communication capability with Willi-Mako support for a generic APERAK question', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.recommend_capability',
        input: {
          task: 'APERAK Fehlercode Z18 erklären',
          knownContext: { tenantId: 'public' },
        },
      },
      readOnlyMeta('public')
    );

    expect(result.success).toBe(true);
    expect(result.structuredContent.capability).toBe('market_communication_evidence_chain');
    const actionNames = result.structuredContent.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.marketCommunicationEvidenceChainStatus');
    expect(
      actionNames.some((a) => a === 'willi-mako.resolveStructure' || a === 'willi-mako.search')
    ).toBe(true);

    // Read-only/advisory only: no consequential MaKo mutation action recommended.
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('mscons-import.import');
    expect(actionNames).not.toContain('hitl.create');
    expect(result.safetyClass).toBeDefined();
    expect(result.sideEffects).toBe('none');
  });

  it('lets the recommended willi-mako.resolveStructure step actually resolve read-only via the willi-mako service', async () => {
    callWithNewSession.mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            id: 'wm-1',
            slug: 'aperak-fehlercode-z18',
            title: 'APERAK Fehlercode Z18',
            score: 28,
            category: 'edifact',
            tags: ['APERAK', 'Fehlercode'],
            excerpt: 'Kurzfassung.',
            url: 'https://stromhaltig.de/wissen/aperak-fehlercode-z18',
          },
        ],
      },
    });

    const recommendation = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.recommend_capability',
        input: { task: 'APERAK Fehlercode Z18 erklären' },
      },
      readOnlyMeta('public')
    );

    const williMakoStep = recommendation.structuredContent.recommendedPlan.find(
      (step) => step.action === 'willi-mako.resolveStructure' || step.action === 'willi-mako.search'
    );
    expect(williMakoStep).toBeDefined();

    const evidence = await broker.call(williMakoStep.action, williMakoStep.params);
    expect(evidence.success).toBe(true);
    expect(callWithNewSession).toHaveBeenCalledWith(
      'cernion_willi_mako_search',
      expect.objectContaining({ query: 'APERAK Fehlercode Z18 erklären' }),
      undefined
    );
  });
});
