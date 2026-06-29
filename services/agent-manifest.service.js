'use strict';

/**
 * Agent Manifest Service
 *
 * Read-only resolve endpoints for the llm.txt cluster manifest
 * (scripts/generate-llm-txt.js). The manifest only lists cluster heads
 * (capability ids, recipe ids, domain names) — these actions resolve a
 * cluster head to its full detail.
 */

const fs = require('fs');
const path = require('path');
const { MoleculerClientError } = require('moleculer').Errors;
const {
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
} = require('../src/capability-catalog');
const { mapCapabilityDomain, mapOpenApiTagsToDomain } = require('../src/llm-manifest-taxonomy');

const OPENAPI_EXPORT_PATH = path.join(__dirname, '..', 'openapi-export.json');

const ALL_CAPABILITIES = [...CURATED_CAPABILITIES, INTERFACE_PLACEHOLDER_CAPABILITY];

function loadOperations() {
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(OPENAPI_EXPORT_PATH, 'utf8'));
  } catch {
    return [];
  }

  const operations = [];
  for (const apiPath of Object.keys(spec.paths || {})) {
    const pathItem = spec.paths[apiPath] || {};
    for (const method of Object.keys(pathItem)) {
      const op = pathItem[method] || {};
      operations.push({
        path: apiPath,
        method: method.toUpperCase(),
        operationId: op.operationId || '',
        summary: op.summary || '',
        tags: Array.isArray(op.tags) ? op.tags : [],
      });
    }
  }
  return operations;
}

// Groups operations sharing an operationId into one canonical entry (the
// shortest, alphabetically-first path) plus an `aliases` list for the rest.
// Mirrors the trailing-slash / service-prefix duplicates seen in this API
// (e.g. "POST /api/agent-receipts/" vs "POST /api/agent-receipts").
function dedupeOperations(operations) {
  const byOperationId = new Map();

  for (const op of operations) {
    const key = op.operationId || `${op.method} ${op.path}`;
    if (!byOperationId.has(key)) byOperationId.set(key, []);
    byOperationId.get(key).push(op);
  }

  const result = [];
  for (const group of byOperationId.values()) {
    const sorted = group
      .slice()
      .sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
    const canonical = sorted[0];
    const aliases = sorted.slice(1).map((op) => `${op.method} ${op.path}`);

    result.push({
      method: canonical.method,
      path: canonical.path,
      operationId: canonical.operationId,
      summary: canonical.summary,
      tags: canonical.tags,
      aliases,
    });
  }

  return result.sort((a, b) => a.path.localeCompare(b.path));
}

module.exports = {
  name: 'agent-manifest',

  created() {
    this.operations = dedupeOperations(loadOperations());
  },

  actions: {
    listCapabilities: {
      rest: 'GET /capabilities',
      params: {
        domain: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List capability-broker catalog entries',
        tags: ['Agent Manifest'],
        description:
          'Resolves capability ids referenced in the llm.txt cluster manifest to their full routing metadata.',
        parameters: [
          {
            name: 'domain',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'redispatch' },
            description: 'Filter by canonical manifest domain (see llm.txt RESOLUTION PROTOCOL).',
          },
        ],
      },
      async handler(ctx) {
        const { domain } = ctx.params;
        let rows = ALL_CAPABILITIES;
        if (domain) {
          rows = rows.filter((c) => mapCapabilityDomain(c) === domain);
        }
        return {
          success: true,
          data: rows,
          metadata: { count: rows.length },
        };
      },
    },

    getCapability: {
      rest: 'GET /capabilities/:name',
      params: {
        name: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get a single capability-broker catalog entry',
        tags: ['Agent Manifest'],
        description:
          'Returns one capability by id including preferredActions, requiredInputs, and risksAndNotes.',
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'redispatch_asset_register' },
            description: 'Capability id (CURATED_CAPABILITIES[].capability).',
          },
        ],
      },
      async handler(ctx) {
        const capability = ALL_CAPABILITIES.find((c) => c.capability === ctx.params.name);
        if (!capability) {
          throw new MoleculerClientError(
            `Capability not found: ${ctx.params.name}`,
            404,
            'CAPABILITY_NOT_FOUND',
            { name: ctx.params.name }
          );
        }
        return { success: true, data: capability };
      },
    },

    listOperations: {
      rest: 'GET /operations',
      params: {
        domain: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List deduplicated OpenAPI operations, optionally filtered by manifest domain',
        tags: ['Agent Manifest'],
        description:
          'Resolves a domain cluster from the llm.txt manifest to its operation slice. ' +
          'Operations sharing an operationId across multiple paths are merged into one canonical entry with an aliases list.',
        parameters: [
          {
            name: 'domain',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'redispatch' },
            description:
              'Canonical manifest domain (see llm.txt RESOLUTION PROTOCOL). Omit to list all domains.',
          },
        ],
      },
      async handler(ctx) {
        const { domain } = ctx.params;
        let rows = this.operations;
        if (domain) {
          rows = rows.filter((op) => mapOpenApiTagsToDomain(op.tags) === domain);
        }
        return {
          success: true,
          data: rows,
          metadata: { count: rows.length },
        };
      },
    },
  },
};
