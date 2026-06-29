'use strict';

const { ServiceBroker } = require('moleculer');
const AgentSidecarService = require('../services/agent-sidecar.service');
const {
  buildCernionProviderCall,
  buildCernionSidecarDescriptor,
} = require('../src/cernion-sidecar-provider');
const { buildMcpLikeToolsList, callMcpLikeTool } = require('../src/energy-sidecar-mcp-bridge');

const EXPECTED_TOOLS = [
  'cernion.ask',
  'cernion.answer_dossier',
  'cernion.recommend_capability',
  'cernion.list_readonly_capabilities',
  'cernion.get_evidence_status',
];

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

describe('generic energy sidecar connector', () => {
  it('maps the Cernion sidecar manifest into a secret-free provider descriptor', () => {
    const descriptor = buildCernionSidecarDescriptor({
      baseUrl: 'https://cernion.example/api',
      bearerTokenSecretRef: 'CERNION_READONLY_TOKEN',
    });

    expect(descriptor.schemaVersion).toBe('energy.sidecar.descriptor.v1');
    expect(descriptor.provider).toMatchObject({
      id: 'cernion',
      name: 'Cernion Energy Tools',
      policyOwner: 'cernion',
    });
    expect(descriptor.domain).toBe('energy');
    expect(descriptor.auth).toEqual({
      type: 'bearer',
      bearerTokenSecretRef: 'CERNION_READONLY_TOKEN',
      serializedSecret: false,
    });
    expect(descriptor.toolCount).toBe(5);
    expect(descriptor.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    expect(JSON.stringify(descriptor)).not.toMatch(/ck_|Bearer\s|secret-value|password/i);
  });

  it('builds a stable MCP-like tools/list representation', () => {
    const descriptor = buildCernionSidecarDescriptor();
    const list = buildMcpLikeToolsList(descriptor);

    expect(list.provider.id).toBe('cernion');
    expect(list.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
    expect(list.tools[0]).toMatchObject({
      name: 'cernion.ask',
      inputSchema: { type: 'object', additionalProperties: true },
      annotations: {
        requiredScope: 'read-only',
        sideEffects: 'none',
        policyOwner: 'cernion',
      },
    });
  });

  it('maps tool calls to the Cernion provider REST contract without serializing secrets', () => {
    const descriptor = buildCernionSidecarDescriptor({
      baseUrl: 'https://cernion.example/api',
      bearerTokenSecretRef: 'CERNION_READONLY_TOKEN',
    });
    const plannedCall = buildCernionProviderCall({
      descriptor,
      toolName: 'cernion.list_readonly_capabilities',
      input: { context: { tenantId: 'public' } },
    });

    expect(plannedCall).toMatchObject({
      ok: true,
      providerId: 'cernion',
      method: 'POST',
      path: '/api/agent-sidecar/tools/cernion.list_readonly_capabilities/call',
      body: { input: { context: { tenantId: 'public' } } },
      auth: { type: 'bearer', bearerTokenSecretRef: 'CERNION_READONLY_TOKEN' },
    });
    expect(JSON.stringify(plannedCall)).not.toMatch(/ck_|Bearer\s/i);
  });

  it('preserves sidecar_policy_blocked as a structured MCP-like error', async () => {
    const descriptor = buildCernionSidecarDescriptor();
    const result = await callMcpLikeTool({
      descriptor,
      name: 'cernion.get_evidence_status',
      arguments: { targetAction: 'hitl.approve' },
      providerCall: async () => ({
        success: false,
        error: 'sidecar_policy_blocked',
        reason: 'forbidden_target_action',
        targetAction: 'hitl.approve',
      }),
    });

    expect(result).toMatchObject({
      isError: true,
      error: {
        code: 'sidecar_policy_blocked',
        reason: 'forbidden_target_action',
      },
    });
  });

  it('exposes descriptor/list/call through the existing sidecar policy gate', async () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(AgentSidecarService);
    await broker.start();

    try {
      const descriptor = await broker.call('agent-sidecar.descriptor', {}, readOnlyMeta());
      expect(descriptor.tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
      expect(descriptor.dossierSummary.allowedTools).toEqual(EXPECTED_TOOLS);

      const list = await broker.call('agent-sidecar.mcpListTools', {}, readOnlyMeta());
      expect(list.tools).toHaveLength(5);

      const allowed = await broker.call(
        'agent-sidecar.mcpCallTool',
        {
          name: 'cernion.list_readonly_capabilities',
          arguments: { context: { tenantId: 'public' } },
        },
        readOnlyMeta()
      );
      expect(allowed.isError).toBe(false);
      expect(allowed.structuredContent.providerCall).toMatchObject({
        providerId: 'cernion',
        path: '/api/agent-sidecar/tools/cernion.list_readonly_capabilities/call',
      });

      const blocked = await broker.call(
        'agent-sidecar.mcpCallTool',
        {
          name: 'cernion.get_evidence_status',
          arguments: { targetAction: 'hitl.approve', context: { tenantId: 'public' } },
        },
        readOnlyMeta()
      );
      expect(blocked).toMatchObject({
        isError: true,
        error: {
          code: 'sidecar_policy_blocked',
          reason: 'forbidden_target_action',
        },
      });
    } finally {
      await broker.stop();
    }
  });
});
