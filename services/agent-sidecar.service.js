'use strict';

const {
  buildSidecarManifest,
  getSidecarTool,
  listSidecarTools,
  validateToolDefinition,
} = require('../src/agent-sidecar-tool-manifest');
const {
  assertHydrationActionAllowed,
  assertToolAllowed,
  buildPolicyBlocked,
  getAuthenticatedTenant,
} = require('../src/agent-sidecar-policy');
const {
  buildCernionProviderCall,
  buildCernionSidecarDescriptor,
} = require('../src/cernion-sidecar-provider');
const {
  buildMcpLikeToolsList,
  callMcpLikeTool,
} = require('../src/energy-sidecar-mcp-bridge');
const { summarizeDescriptorForDossier } = require('../src/energy-sidecar-descriptor');

const OPENAPI_TAG = 'Agent Sidecar';

function compactToolResult(tool, result) {
  return {
    success: true,
    tool: tool.name,
    targetAction: tool.targetAction,
    safetyClass: tool.safetyClass,
    sideEffects: tool.sideEffects,
    structuredContent: result,
  };
}

module.exports = {
  name: 'agent-sidecar',

  actions: {
    listTools: {
      rest: 'GET /tools',
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'List curated OpenClaw-safe Cernion Sidecar tools',
      },
      handler(ctx) {
        const manifest = buildSidecarManifest();
        return {
          ...manifest,
          tenantId: getAuthenticatedTenant(ctx),
          policyChecks: manifest.tools.map((tool) => ({
            name: tool.name,
            ...validateToolDefinition(tool),
          })),
        };
      },
    },

    callTool: {
      rest: 'POST /tools/:name/call',
      params: {
        name: { type: 'string', min: 1, trim: true },
        input: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Call one curated Cernion Sidecar tool through the server-side policy gate',
      },
      async handler(ctx) {
        const name = String(ctx.params.name || '').trim();
        const input = ctx.params.input || {};
        const tool = getSidecarTool(name);
        if (!tool) {
          return buildPolicyBlocked('unknown_tool', {
            tool: name,
            allowedTools: listSidecarTools().map((entry) => entry.name),
          });
        }

        const policyBlock = assertToolAllowed(tool, ctx, input);
        if (policyBlock) return policyBlock;

        if (name === 'cernion.list_readonly_capabilities') {
          return compactToolResult(tool, buildSidecarManifest());
        }

        if (name === 'cernion.recommend_capability') {
          const task = input.task || input.question || input.currentQuestion;
          const result = await ctx.call('capability-broker.recommend', {
            schemaVersion: input.schemaVersion,
            mode: input.mode || 'initial',
            task,
            agentRole: input.agentRole,
            knownContext: input.knownContext || input.context || {},
            alreadyExecutedSteps: input.alreadyExecutedSteps || [],
            currentQuestion: input.currentQuestion || input.question,
            compareCandidates: input.compareCandidates || [],
            doNotUse: input.doNotUse || [],
            resolvedParams: input.resolvedParams || {},
            resolvedCapabilities: input.resolvedCapabilities || [],
          });
          return compactToolResult(tool, result);
        }

        if (name === 'cernion.ask') {
          const result = await ctx.call('personal-agent.askCernionAgent', {
            question: input.question,
            sessionId: input.sessionId,
            context: input.context || {},
            inputs: input.inputs || {},
            domain: input.domain || 'auto',
            mode: input.mode || 'answer',
            maxEvidence: input.maxEvidence || 5,
          });
          return compactToolResult(tool, result);
        }

        if (name === 'cernion.answer_dossier') {
          const result = await ctx.call('personal-agent.answerDossier', {
            question: input.question,
            sessionId: input.sessionId,
            domain: input.domain || 'auto',
            mode: input.mode || 'answer_dossier',
            maxEvidence: input.maxEvidence || 5,
            timeBudgetMs: input.timeBudgetMs || 30000,
            parentDossierId: input.parentDossierId,
            context: input.context || {},
            dossierContract: input.dossierContract || 'slim',
          });
          return compactToolResult(tool, result);
        }

        if (name === 'cernion.get_evidence_status') {
          const targetAction = input.targetAction || input.action;
          const actionBlock = assertHydrationActionAllowed(targetAction);
          if (actionBlock) return actionBlock;
          const result = await ctx.call(targetAction, input.params || {});
          return compactToolResult(
            {
              ...tool,
              targetAction,
            },
            result
          );
        }

        return buildPolicyBlocked('tool_not_implemented', { tool: name });
      },
    },

    descriptor: {
      rest: 'GET /descriptor',
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Describe the Cernion provider as a generic Energy Sidecar descriptor',
      },
      handler(ctx) {
        const descriptor = buildCernionSidecarDescriptor({
          baseUrl: ctx.params.baseUrl,
          bearerTokenSecretRef: ctx.params.bearerTokenSecretRef || 'CERNION_READONLY_TOKEN',
        });
        return {
          ...descriptor,
          tenantId: getAuthenticatedTenant(ctx),
          dossierSummary: summarizeDescriptorForDossier(descriptor),
        };
      },
    },

    mcpListTools: {
      rest: 'GET /mcp/tools',
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'List Cernion Sidecar tools in an MCP-like host descriptor',
      },
      handler(ctx) {
        const descriptor = buildCernionSidecarDescriptor({
          baseUrl: ctx.params.baseUrl,
          bearerTokenSecretRef: ctx.params.bearerTokenSecretRef || 'CERNION_READONLY_TOKEN',
        });
        return buildMcpLikeToolsList(descriptor);
      },
    },

    mcpCallTool: {
      rest: 'POST /mcp/tools/:name/call',
      params: {
        name: { type: 'string', min: 1, trim: true },
        arguments: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Call a Cernion Sidecar tool through the MCP-like bridge',
      },
      async handler(ctx) {
        const descriptor = buildCernionSidecarDescriptor({
          baseUrl: ctx.params.baseUrl,
          bearerTokenSecretRef: ctx.params.bearerTokenSecretRef || 'CERNION_READONLY_TOKEN',
        });
        return callMcpLikeTool({
          descriptor,
          name: ctx.params.name,
          arguments: ctx.params.arguments || ctx.params.input || {},
          providerCall: async ({ tool, input }) => {
            const plannedCall = buildCernionProviderCall({
              descriptor,
              toolName: tool.name,
              input,
            });
            if (!plannedCall.ok) return plannedCall;
            const result = await ctx.call('agent-sidecar.callTool', {
              name: tool.name,
              input,
            });
            return {
              ...result,
              providerCall: {
                providerId: plannedCall.providerId,
                method: plannedCall.method,
                path: plannedCall.path,
                targetAction: plannedCall.targetAction,
              },
            };
          },
        });
      },
    },
  },
};
