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
    broker.createService({
      name: 'domain-router',
      actions: {
        classify: {
          handler(ctx) {
            calls.push({ action: 'domain-router.classify', params: ctx.params });
            return {
              success: true,
              cetCaseId: 'case-test-1',
              caseStateVersion: 1,
              primaryDomain: 'edm',
              alternativeDomains: ['market_communication'],
              requiredClarifications: ['EDM data quality or MaKo message?'],
              eventsCreated: [{ eventId: 'evt-test-1', eventType: 'clarification.required' }],
            };
          },
        },
        continue: {
          handler(ctx) {
            calls.push({ action: 'domain-router.continue', params: ctx.params });
            return {
              success: true,
              cetCaseId: ctx.params.cetCaseId,
              caseStateVersion: 2,
              transition: 'continue',
            };
          },
        },
        'events.list': {
          handler(ctx) {
            calls.push({ action: 'domain-router.events.list', params: ctx.params });
            return {
              success: true,
              events: [
                {
                  eventId: 'evt-test-1',
                  eventType: 'clarification.required',
                  deliveryState: 'delivered',
                },
              ],
            };
          },
        },
        'events.ack': {
          handler(ctx) {
            calls.push({ action: 'domain-router.events.ack', params: ctx.params });
            return { success: true, eventId: ctx.params.eventId, deliveryState: 'acknowledged' };
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

  it('publishes a curated additive tool manifest with safe policy metadata', async () => {
    const manifest = await broker.call('agent-sidecar.listTools', {}, readOnlyMeta());

    expect(manifest.schemaVersion).toBe('cernion.agent-sidecar.v1');
    expect(manifest.toolCount).toBeLessThanOrEqual(10);
    expect(manifest.tools.slice(0, 5).map((tool) => tool.name)).toEqual([
      'cernion.ask',
      'cernion.answer_dossier',
      'cernion.recommend_capability',
      'cernion.list_readonly_capabilities',
      'cernion.get_evidence_status',
    ]);
    expect(manifest.governanceModel).toBe('cet_governed_internal_state_external_effects_gated');
    for (const tool of manifest.tools) {
      expect(tool.requiredScope).toBe('read-only');
      expect(tool.sideEffects).toBe('none');
      expect(tool.requiresCetAuthorization).toBe(true);
      expect(tool.externalSideEffects).toBe(false);
      expect(['read_only_evidence', 'advisory_reasoning']).toContain(tool.safetyClass);
      expect(validateToolDefinition(tool).valid).toBe(true);
    }
    const classify = manifest.tools.find((tool) => tool.name === 'cernion.classify_task');
    expect(classify).toMatchObject({
      effectClass: 'internal_case_state',
      localStateEffects: 'case_state_and_event_generation_metadata',
      governanceBoundary: 'cet_governed_internal_state_external_effects_require_rbac_hitl',
    });
    expect(classify.description).toMatch(/CET-governed Domain Router operation/);
    expect(classify.description).not.toMatch(/no operational writes/i);
    const ack = manifest.tools.find((tool) => tool.name === 'cernion.ack_case_event');
    expect(ack).toMatchObject({
      effectClass: 'internal_event_outbox',
      localStateEffects: 'case_event_acknowledgement_state',
    });
  });

  it('keeps the static manifest at the additive router limit', () => {
    const manifest = buildSidecarManifest();
    expect(manifest.toolCount).toBe(10);
    expect(listSidecarTools()).toHaveLength(10);
  });

  it('blocks unknown tools, external effects and forbidden direct HITL/write style targets', async () => {
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

    const manifestTool = listSidecarTools()[0];
    const externalValidation = validateToolDefinition({
      ...manifestTool,
      name: 'cernion.synthetic_external_effect',
      effectClass: 'external_business_effect',
      externalSideEffects: true,
    });
    expect(externalValidation.valid).toBe(false);
    expect(externalValidation.errors).toEqual(
      expect.arrayContaining([
        'externalSideEffects must be false for current Sidecar tools',
        'external_business_effect tools require a future explicit CET RBAC/HITL contract',
      ])
    );
  });

  it('requires an authenticated principal before invoking tools', async () => {
    const result = await broker.call('agent-sidecar.callTool', {
      name: 'cernion.list_readonly_capabilities',
      input: {},
    });

    expect(result.error).toBe('sidecar_policy_blocked');
    expect(result.reason).toBe('auth_required');
  });

  it('requires an authenticated tenant for tenant-bound Sidecar tools', async () => {
    const contextOnly = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.recommend_capability',
        input: {
          task: 'Redispatch Readiness Gate empfehlen',
          knownContext: { tenantId: 'public' },
        },
      },
      {
        meta: {
          apiToken: {
            tokenId: 'tok-without-tenant',
            userId: 'svc:openclaw',
          },
        },
      }
    );
    expect(contextOnly.error).toBe('sidecar_policy_blocked');
    expect(contextOnly.reason).toBe('tenant_required');

    const actorOnly = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.ask',
        input: { question: 'Welche Evidenz gibt es?', context: { tenantId: 'public' } },
      },
      {
        meta: {
          authUser: {
            id: 'user-without-tenant',
          },
        },
      }
    );
    expect(actorOnly.error).toBe('sidecar_policy_blocked');
    expect(actorOnly.reason).toBe('tenant_required');
    expect(calls).toHaveLength(0);
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

  it('allows CET-governed internal Domain Router state operations through legacy read-only tokens', async () => {
    const classify = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.classify_task',
        input: {
          userRequest: 'MSCONS Messwerte fehlen, bitte fachlich einordnen',
          taskEnvelope: { asyncDelivery: { mode: 'poll', clientId: 'test-client' } },
          context: { tenantId: 'public' },
        },
      },
      readOnlyMeta('public')
    );
    expect(classify).toMatchObject({
      success: true,
      tool: 'cernion.classify_task',
      effectClass: 'internal_case_state',
      externalSideEffects: false,
      structuredContent: { cetCaseId: 'case-test-1', primaryDomain: 'edm' },
    });

    const continued = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.continue_case',
        input: { cetCaseId: 'case-test-1', userRequest: 'MaKo-Bezug bestaetigt' },
      },
      readOnlyMeta('public')
    );
    expect(continued).toMatchObject({
      success: true,
      effectClass: 'internal_case_state',
      structuredContent: { cetCaseId: 'case-test-1', caseStateVersion: 2 },
    });

    const listed = await broker.call(
      'agent-sidecar.callTool',
      { name: 'cernion.list_case_events', input: { caseId: 'case-test-1' } },
      readOnlyMeta('public')
    );
    expect(listed).toMatchObject({
      success: true,
      effectClass: 'internal_event_outbox',
      structuredContent: { events: [{ deliveryState: 'delivered' }] },
    });

    const acked = await broker.call(
      'agent-sidecar.callTool',
      { name: 'cernion.ack_case_event', input: { eventId: 'evt-test-1' } },
      readOnlyMeta('public')
    );
    expect(acked).toMatchObject({
      success: true,
      effectClass: 'internal_event_outbox',
      structuredContent: { eventId: 'evt-test-1', deliveryState: 'acknowledged' },
    });
    expect(calls.map((call) => call.action)).toEqual([
      'domain-router.classify',
      'domain-router.continue',
      'domain-router.events.list',
      'domain-router.events.ack',
    ]);
  });

  it('treats token scope as client context rather than the business write gate', async () => {
    const result = await broker.call(
      'agent-sidecar.callTool',
      {
        name: 'cernion.classify_task',
        input: { userRequest: 'Zielnetzplanung Produktionsreife', context: { tenantId: 'public' } },
      },
      {
        meta: {
          apiToken: {
            scope: 'agentos-session',
            tenantId: 'public',
            userId: 'svc:openclaw',
          },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.structuredContent.cetCaseId).toBe('case-test-1');
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
