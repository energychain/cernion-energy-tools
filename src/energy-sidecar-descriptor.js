'use strict';

const DEFAULT_DOMAIN = 'energy';
const DEFAULT_AUTH_TYPE = 'bearer';
const SECRET_VALUE_PATTERN =
  /(ck_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+|CERNION_SUPPORT_TOKEN|api[_-]?key|password|private[_-]?key)/i;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return null;
  return String(baseUrl).replace(/\/+$/, '');
}

function assertNoSecretValues(value, path = 'descriptor') {
  if (value == null) return;
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      throw new Error(`${path} must not contain secret values`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretValues(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (/token|secret|authorization/i.test(key) && typeof entry === 'string') {
        if (SECRET_VALUE_PATTERN.test(entry) || entry.toLowerCase().startsWith('bearer ')) {
          throw new Error(`${path}.${key} must use a secret reference, not a secret value`);
        }
      }
      assertNoSecretValues(entry, `${path}.${key}`);
    }
  }
}

function buildToolDescriptor(tool) {
  return {
    name: tool.name,
    title: tool.title || tool.name,
    description: tool.description || '',
    inputSchema: cloneJson(tool.inputSchema || { type: 'object', additionalProperties: true }),
    safetyClass: tool.safetyClass,
    requiredScope: tool.requiredScope,
    tenantPolicy: tool.tenantPolicy,
    rolePolicy: [...(tool.rolePolicy || [])],
    hitlPolicy: tool.hitlPolicy,
    responseContract: tool.responseContract,
    sideEffects: tool.sideEffects,
    targetAction: tool.targetAction,
    policyOwner: tool.policyOwner,
  };
}

function buildEnergySidecarDescriptor({
  provider,
  manifest,
  baseUrl,
  endpointContract,
  bearerTokenSecretRef,
} = {}) {
  if (!provider?.id) throw new Error('provider.id is required');
  if (!manifest?.tools || !Array.isArray(manifest.tools)) {
    throw new Error('manifest.tools is required');
  }

  const policyOwner = manifest.policyOwner || provider.policyOwner || provider.id;
  const descriptor = {
    schemaVersion: 'energy.sidecar.descriptor.v1',
    provider: {
      id: provider.id,
      name: provider.name || provider.id,
      version: provider.version || manifest.schemaVersion || 'unknown',
      policyOwner,
    },
    domain: provider.domain || DEFAULT_DOMAIN,
    baseUrl: normalizeBaseUrl(baseUrl),
    endpointContract: endpointContract || {
      manifest: { method: 'GET', path: '/api/agent-sidecar/tools' },
      call: { method: 'POST', pathTemplate: '/api/agent-sidecar/tools/{name}/call' },
    },
    auth: {
      type: provider.authType || DEFAULT_AUTH_TYPE,
      bearerTokenSecretRef: bearerTokenSecretRef || null,
      serializedSecret: false,
    },
    toolCount: manifest.tools.length,
    tools: manifest.tools.map((tool) =>
      buildToolDescriptor({
        ...tool,
        policyOwner: tool.policyOwner || policyOwner,
      })
    ),
    responseContract: 'mcp_like_tools_list_and_tools_call',
    sideEffects: 'none',
  };

  assertNoSecretValues(descriptor);
  return descriptor;
}

function summarizeDescriptorForDossier(descriptor) {
  return {
    provider: descriptor.provider,
    domain: descriptor.domain,
    toolCount: descriptor.toolCount,
    allowedTools: descriptor.tools.map((tool) => tool.name),
    safetyClasses: Array.from(new Set(descriptor.tools.map((tool) => tool.safetyClass))).sort(),
    requiredScopes: Array.from(new Set(descriptor.tools.map((tool) => tool.requiredScope))).sort(),
    tenantPolicies: Array.from(new Set(descriptor.tools.map((tool) => tool.tenantPolicy))).sort(),
    rolePolicies: Array.from(new Set(descriptor.tools.flatMap((tool) => tool.rolePolicy || []))).sort(),
    hitlPolicies: Array.from(new Set(descriptor.tools.map((tool) => tool.hitlPolicy))).sort(),
    sideEffects: Array.from(new Set(descriptor.tools.map((tool) => tool.sideEffects))).sort(),
    policyOwner: descriptor.provider.policyOwner,
  };
}

module.exports = {
  assertNoSecretValues,
  buildEnergySidecarDescriptor,
  summarizeDescriptorForDossier,
};
