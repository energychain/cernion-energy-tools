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
  },
};
