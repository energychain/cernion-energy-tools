'use strict';

const { buildSidecarManifest } = require('./agent-sidecar-tool-manifest');
const { buildEnergySidecarDescriptor } = require('./energy-sidecar-descriptor');

const CERNION_PROVIDER = {
  id: 'cernion',
  name: 'Cernion Energy Tools',
  domain: 'energy',
  authType: 'bearer',
  policyOwner: 'cernion',
};

function buildCernionSidecarDescriptor(options = {}) {
  return buildEnergySidecarDescriptor({
    provider: {
      ...CERNION_PROVIDER,
      version: options.version || buildSidecarManifest().schemaVersion,
    },
    manifest: options.manifest || buildSidecarManifest(),
    baseUrl: options.baseUrl,
    bearerTokenSecretRef: options.bearerTokenSecretRef || 'CERNION_READONLY_TOKEN',
  });
}

function buildCernionProviderCall({ descriptor, toolName, input = {} }) {
  const normalizedName = String(toolName || '').trim();
  const tool = descriptor.tools.find((entry) => entry.name === normalizedName);
  if (!tool) {
    return {
      ok: false,
      error: 'sidecar_policy_blocked',
      reason: 'unknown_tool',
      tool: normalizedName,
      allowedTools: descriptor.tools.map((entry) => entry.name),
    };
  }

  const pathTemplate = descriptor.endpointContract.call.pathTemplate;
  return {
    ok: true,
    providerId: descriptor.provider.id,
    method: descriptor.endpointContract.call.method,
    url: descriptor.baseUrl
      ? `${descriptor.baseUrl}${pathTemplate.replace('{name}', encodeURIComponent(normalizedName))}`
      : null,
    path: pathTemplate.replace('{name}', normalizedName),
    tool: normalizedName,
    targetAction: tool.targetAction,
    body: { input },
    auth: {
      type: descriptor.auth.type,
      bearerTokenSecretRef: descriptor.auth.bearerTokenSecretRef,
    },
  };
}

module.exports = {
  CERNION_PROVIDER,
  buildCernionProviderCall,
  buildCernionSidecarDescriptor,
};
