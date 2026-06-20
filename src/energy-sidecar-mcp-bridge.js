'use strict';

function toMcpTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: 'object', additionalProperties: true },
    annotations: {
      safetyClass: tool.safetyClass,
      requiredScope: tool.requiredScope,
      tenantPolicy: tool.tenantPolicy,
      rolePolicy: tool.rolePolicy || [],
      hitlPolicy: tool.hitlPolicy,
      sideEffects: tool.sideEffects,
      policyOwner: tool.policyOwner,
      targetAction: tool.targetAction,
    },
  };
}

function buildMcpLikeToolsList(descriptor) {
  return {
    provider: descriptor.provider,
    domain: descriptor.domain,
    tools: descriptor.tools.map(toMcpTool),
  };
}

function normalizeSidecarResult(result) {
  if (result?.error === 'sidecar_policy_blocked') {
    return {
      isError: true,
      error: {
        code: result.error,
        reason: result.reason,
        details: result,
      },
      structuredContent: result,
    };
  }

  return {
    isError: false,
    structuredContent: result,
  };
}

async function callMcpLikeTool({ descriptor, name, arguments: input = {}, providerCall }) {
  const toolName = String(name || '').trim();
  const tool = descriptor.tools.find((entry) => entry.name === toolName);
  if (!tool) {
    return normalizeSidecarResult({
      success: false,
      error: 'sidecar_policy_blocked',
      reason: 'unknown_tool',
      tool: toolName,
      allowedTools: descriptor.tools.map((entry) => entry.name),
    });
  }
  if (typeof providerCall !== 'function') {
    throw new Error('providerCall function is required');
  }

  const result = await providerCall({
    provider: descriptor.provider,
    tool,
    input,
  });
  return normalizeSidecarResult(result);
}

module.exports = {
  buildMcpLikeToolsList,
  callMcpLikeTool,
  normalizeSidecarResult,
};
