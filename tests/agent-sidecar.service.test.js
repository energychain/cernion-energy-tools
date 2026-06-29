'use strict';

const { ServiceBroker } = require('moleculer');
const AgentSidecarService = require('../services/agent-sidecar.service');
const {
  buildSidecarManifest,
  listSidecarTools,
  validateToolDefinition,
} = require('../src/agent-sidecar-tool-manifest');

describe('agent-sidecar service', () => {
  let broker;
  const calls = [];

  beforeEach(async () => {
    calls.length = 0;
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(AgentSidecarService);
    broker.createService({
      name: 'personal-agent',
      actions: {
        askCernionAgent: {
          handler(ctx) {
            calls.push({ action: 'personal-agent.askCernionAgent', params: ctx.params });
            return {
              success: true,
              shortAnswer: 'Cernion evidence answer',
              evidence: [],
              forbiddenActions: ['execute', 'approve', 'delete'],
            };
          },
        },
        answerDossier: {
          handler(ctx) {
            calls.push({ action: 'personal-agent.answerDossier', params: ctx.params });
            return {
              dossierContract: ctx.params.dossierContract,
              dossierMarkdown: '# Slim dossier',
              guardrails: ['read-only'],
            };
          },
        },
      },
    });
    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: {
          handler(ctx) {
            calls.push({ action: 'capability-broker.recommend', params: ctx.params });
            return {
              capability: 'redispatch_readiness_gate',
              recommendedPlan: [{ action: 'redispatch-readiness-gate.getStatus' }],
            };
          },
        },
      },
    });
    broker.createService({
      name: 'dashboard-api',
      actions: {
        gasDecommissioningRoadmapStatus: {
          handler(ctx) {
            calls.push({
              action: 'dashboard-api.gasDecommissioningRoadmapStatus',
              params: ctx.params,
            });
            return {
              status: 'ready_for_committee_gate',
              dossierEvidence: { dossierFacts: ['ready'] },
            };
          },
        },
      },
    });
    broker.createService({
      name: 'assets',
      actions: {
        solar: {
          rest: 'GET /solar',
          handler() {
            return {};
          },
        },
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

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

  it('publishes a curated five-tool manifest with safe policy metadata', async () => {
    const manifest = await broker.call('agent-sidecar.listTools', {}, readOnlyMeta());

    expect(manifest.schemaVersion).toBe('cernion.agent-sidecar.v1');
    expect(manifest.toolCount).toBeLessThanOrEqual(5);
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'cernion.ask',
      'cernion.answer_dossier',
      'cernion.recommend_capability',
      'cernion.list_readonly_capabilities',
      'cernion.get_evidence_status',
    ]);
    for (const tool of manifest.tools) {
      expect(tool.requiredScope).toBe('read-only');
      expect(tool.sideEffects).toBe('none');
      expect(['read_only_evidence', 'advisory_reasoning']).toContain(tool.safetyClass);
      expect(validateToolDefinition(tool).valid).toBe(true);
    }
  });

  it('keeps the static manifest at the MVP limit', () => {
    const manifest = buildSidecarManifest();
    expect(manifest.toolCount).toBe(5);
    expect(listSidecarTools()).toHaveLength(5);
  });

  it('blocks unknown tools and forbidden direct HITL/write style targets', async () => {
    const unknown = await broker.call(
      'agent-sidecar.callTool',
      { name: 'hitl.approve', input: {} },
      readOnlyMeta()
    );
    expect(unknown.error).toBe('sidecar_policy_blocked');
    expect(unknown.reason).toBe('unknown_tool');

    const blockedAction = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.get_evidence_status',
        input: { targetAction: 'hitl.approve', params: { id: 'hitl-1' } },
      },
      readOnlyMeta()
    );
    expect(blockedAction.error).toBe('sidecar_policy_blocked');
    expect(blockedAction.reason).toBe('forbidden_target_action');
  });

  it('requires an authenticated principal before invoking tools', async () => {
    const result = await broker.call('agent-sidecar.callTool', {
      name: 'cernion.list_readonly_capabilities',
      input: {},
    });

    expect(result.error).toBe('sidecar_policy_blocked');
    expect(result.reason).toBe('auth_required');
  });

  it('blocks tenant mismatch before calling downstream actions', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.recommend_capability',
        input: {
          task: 'Redispatch Readiness Gate empfehlen',
          knownContext: { tenantId: 'other-tenant' },
        },
      },
      readOnlyMeta('public')
    );

    expect(result.error).toBe('sidecar_policy_blocked');
    expect(result.reason).toBe('tenant_mismatch');
    expect(calls).toHaveLength(0);
  });

  it('uses inputs and the query compatibility alias for the ask execution-plan contract', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.ask',
        input: {
          // No `question` field — only the documented `query` compatibility alias.
          query: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
          context: { tenantId: 'public' },
          inputs: {
            assetType: 'solar',
            location: '69168',
            minCapacity: 10,
            maxCapacity: 13,
            commissioningYear: 2025,
            limit: 100,
          },
        },
      },
      readOnlyMeta('public')
    );

    expect(result.success).toBe(true);
    expect(result.structuredContent).toMatchObject({
      question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
      resolved: {
        kind: 'blueprint',
        id: 'mastr-asset-service-selection-v1',
      },
      canonicalInputs: {
        assetType: 'solar',
        location: '69168',
        minCapacity: 10,
        maxCapacity: 13,
        commissioningYear: 2025,
        limit: 100,
      },
      execution: {
        method: 'GET',
        path: '/api/assets/solar',
      },
    });
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeUndefined();
  });

  it('forwards advisory calls without executing the recommended plan', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.recommend_capability',
        input: {
          task: 'Welches Cernion Gate prueft Redispatch Produktivreife?',
          knownContext: { tenantId: 'public' },
        },
      },
      readOnlyMeta('public')
    );

    expect(result.success).toBe(true);
    expect(result.tool).toBe('cernion.recommend_capability');
    expect(result.structuredContent.recommendedPlan[0].action).toBe(
      'redispatch-readiness-gate.getStatus'
    );
    expect(calls).toEqual([expect.objectContaining({ action: 'capability-broker.recommend' })]);
  });

  it('defaults answer dossier calls to the slim OpenClaw-safe contract', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.answer_dossier',
        input: {
          question: 'Welche Evidenz fehlt fuer die Redispatch Produktivreife?',
          context: { tenantId: 'public' },
        },
      },
      readOnlyMeta('public')
    );

    expect(result.success).toBe(true);
    expect(result.structuredContent.dossierContract).toBe('slim');
    expect(calls[0]).toMatchObject({
      action: 'personal-agent.answerDossier',
      params: { dossierContract: 'slim' },
    });
  });

  it('returns an MCP ask execution plan from arguments.inputs before evidence fallback', async () => {
    const result = await broker.call(
      'agent-sidecar.mcpCallTool',
      {
        name: 'cernion.ask',
        arguments: {
          question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
          query: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
          context: { tenantId: 'public' },
          inputs: {
            assetType: 'solar',
            location: '69168',
            minCapacity: 10,
            maxCapacity: 13,
            commissioningYear: 2025,
            limit: 100,
          },
        },
      },
      readOnlyMeta('public')
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent.structuredContent).toMatchObject({
      resolved: {
        kind: 'blueprint',
        id: 'mastr-asset-service-selection-v1',
      },
      canonicalInputs: {
        assetType: 'solar',
        location: '69168',
        minCapacity: 10,
        maxCapacity: 13,
        commissioningYear: 2025,
        limit: 100,
      },
      execution: {
        mode: 'read_only_rest_plan',
        method: 'GET',
        path: '/api/assets/solar',
        query: {
          location: '69168',
          minCapacityKW: 10,
          maxCapacityKW: 13,
          commissioningYear: 2025,
          limit: 100,
        },
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('allows only Hydration Registry allowlisted evidence status actions', async () => {
    const allowed = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.get_evidence_status',
        input: {
          targetAction: 'dashboard-api.gasDecommissioningRoadmapStatus',
          params: { roadmapId: 'gas-roadmap-smoke' },
          context: { tenantId: 'public' },
        },
      },
      readOnlyMeta('public')
    );

    expect(allowed.success).toBe(true);
    expect(allowed.targetAction).toBe('dashboard-api.gasDecommissioningRoadmapStatus');

    const blocked = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.get_evidence_status',
        input: {
          targetAction: 'finance-agent.analyze',
          params: {},
          context: { tenantId: 'public' },
        },
      },
      readOnlyMeta('public')
    );

    expect(blocked.error).toBe('sidecar_policy_blocked');
    expect(blocked.reason).toBe('target_action_not_hydration_allowlisted');
  });
});
