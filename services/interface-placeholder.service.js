'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');
const { buildPlaceholderNode } = require('../src/cya-regulatory-graph');
const {
  PLACEHOLDER_REASON,
  BLOCKING_LEVEL,
  normalizeReason,
  normalizeBlockingLevel,
  normalizeSignalCodes,
  normalizeReplacementCriteria,
  getRequiredResolverRoles,
} = require('../src/interface-placeholder-schema');

const OPENAPI_TAG = 'Interface Placeholder';
const PLACEHOLDER_NAMESPACE = 'interface_placeholders';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

function nowIso() {
  return new Date().toISOString();
}

function buildPlaceholderId() {
  return `ph_${crypto.randomUUID().replace(/-/g, '')}`;
}

function normalizeResolution(resolution) {
  if (typeof resolution === 'string') {
    return { summary: resolution };
  }
  if (resolution && typeof resolution === 'object') {
    return resolution;
  }
  throw new MoleculerClientError(
    'resolution must be a string or object',
    422,
    'INVALID_RESOLUTION'
  );
}

module.exports = {
  name: 'interface-placeholder',

  actions: {
    markGap: {
      rest: 'POST /mark-gap',
      params: {
        role: { type: 'string', min: 2 },
        reason: { type: 'enum', values: PLACEHOLDER_REASON },
        blockingLevel: { type: 'enum', values: BLOCKING_LEVEL, optional: true, default: 'soft' },
        replacementCriteria: { type: 'object', optional: true, default: {} },
        signalCodes: { type: 'array', optional: true, items: 'string', default: [] },
        placeholderGapKey: { type: 'string', optional: true },
        requiredResolverRoles: { type: 'array', optional: true, items: 'string' },
      },
      openapi: {
        summary: 'Create an explicit interface placeholder gap',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['role', 'reason'],
                properties: {
                  role: { type: 'string', example: 'grid_connection_validator' },
                  reason: { type: 'string', example: 'NEEDS_INTERFACE' },
                  blockingLevel: { type: 'string', example: 'soft' },
                  replacementCriteria: {
                    type: 'object',
                    example: {
                      kind: 'process',
                      capabilityHint: 'znp.assessPortfolio',
                      deadline: '2026-06-01T00:00:00.000Z',
                    },
                    properties: {
                      kind: { type: 'string', example: 'process' },
                      capabilityHint: { type: 'string', example: 'znp.assessPortfolio' },
                      deadline: {
                        type: 'string',
                        format: 'date-time',
                        example: '2026-06-01T00:00:00.000Z',
                      },
                    },
                  },
                  signalCodes: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['NEEDS_INTERFACE', 'REQUEST_INTERFACE_CONTRACT'],
                  },
                  placeholderGapKey: {
                    type: 'string',
                    example: 'kaufmaennische_freigabe_fnav',
                  },
                  requiredResolverRoles: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ROLE_KAUFMAENNISCHE_LEITUNG', 'ROLE_NETZPLANUNG'],
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    role: 'grid_connection_validator',
                    reason: 'NEEDS_INTERFACE',
                    blockingLevel: 'soft',
                    replacementCriteria: {
                      kind: 'process',
                      capabilityHint: 'znp.assessPortfolio',
                      deadline: '2026-06-01T00:00:00.000Z',
                    },
                    signalCodes: ['NEEDS_INTERFACE', 'REQUEST_INTERFACE_CONTRACT'],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const placeholderId = buildPlaceholderId();
        const reason = normalizeReason(ctx.params.reason);
        const blockingLevel = normalizeBlockingLevel(ctx.params.blockingLevel);
        const createdAt = nowIso();
        const replacementCriteria = normalizeReplacementCriteria(ctx.params.replacementCriteria);
        const signalCodes = normalizeSignalCodes(reason, ctx.params.signalCodes);
        const requiredResolverRoles = getRequiredResolverRoles(
          blockingLevel,
          ctx.params.requiredResolverRoles
        );

        const placeholder = {
          placeholderId,
          tenantId,
          role: ctx.params.role,
          reason,
          blockingLevel,
          signalCodes,
          replacementCriteria,
          placeholderGapKey: ctx.params.placeholderGapKey || null,
          requiredResolverRoles,
          agentType: 'interface_placeholder_agent',
          confidence: 'low',
          status: 'placeholder_gap',
          createdAt,
          updatedAt: createdAt,
          resolvedAt: null,
          resolution: null,
        };

        const graphNode = buildPlaceholderNode(placeholder);
        const payload = {
          ...placeholder,
          graphNode,
        };

        await ctx.call('object-store.put', {
          namespace: this.resolveNamespace(ctx),
          key: placeholderId,
          payload,
        });

        let hitlItem = null;
        if (blockingLevel === 'hard') {
          const hitlResult = await ctx.call('hitl.create', {
            kind: 'interface-placeholder-hard-blocker',
            originService: this.name,
            originAction: 'markGap',
            severity: 'warning',
            payload: {
              placeholderId,
              tenantId,
              reason,
              blockingLevel,
              role: ctx.params.role,
              requiredResolverRoles,
              placeholderGapKey: payload.placeholderGapKey,
            },
          });
          hitlItem = hitlResult?.item || null;

          if (hitlItem) {
            payload.hitlItem = {
              id: hitlItem.id,
              status: hitlItem.status,
            };
            await ctx.call('object-store.put', {
              namespace: this.resolveNamespace(ctx),
              key: placeholderId,
              payload,
            });
          }
        }

        return {
          success: true,
          placeholder: payload,
          hitlItem,
        };
      },
    },

    requestEvidence: {
      rest: 'POST /request-evidence',
      params: {
        placeholderId: { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Return evidence signals required to replace a placeholder',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['placeholderId'],
                properties: {
                  placeholderId: { type: 'string', example: 'ph_1234567890abcdef' },
                },
              },
              examples: {
                default: {
                  value: { placeholderId: 'ph_1234567890abcdef' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const placeholder = await this.loadPlaceholder(ctx, ctx.params.placeholderId);
        return {
          placeholderId: placeholder.placeholderId,
          confidence: 'low',
          status: placeholder.status,
          evidenceSignals: placeholder.signalCodes,
          replacementCriteria: placeholder.replacementCriteria,
          requiredResolverRoles: placeholder.requiredResolverRoles || [],
        };
      },
    },

    returnMinimalStatus: {
      rest: 'GET /gaps/:placeholderId/status',
      params: {
        placeholderId: { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Return low-confidence minimal status for a placeholder',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'placeholderId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'ph_1234567890abcdef' },
          },
        ],
      },
      async handler(ctx) {
        const placeholder = await this.loadPlaceholder(ctx, ctx.params.placeholderId);
        return {
          placeholderId: placeholder.placeholderId,
          tenantId: placeholder.tenantId,
          confidence: 'low',
          status: placeholder.status,
          blockingLevel: placeholder.blockingLevel,
          reason: placeholder.reason,
          placeholderGapKey: placeholder.placeholderGapKey || null,
        };
      },
    },

    listGaps: {
      rest: 'GET /gaps',
      params: {
        reason: { type: 'enum', values: PLACEHOLDER_REASON, optional: true },
        blockingLevel: { type: 'enum', values: BLOCKING_LEVEL, optional: true },
        role: { type: 'string', optional: true },
        includeResolved: { type: 'boolean', optional: true, convert: true, default: false },
        limit: {
          type: 'number',
          optional: true,
          convert: true,
          default: DEFAULT_LIMIT,
          max: MAX_LIMIT,
        },
      },
      openapi: {
        summary: 'List tenant-scoped interface placeholder gaps',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'reason',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'NEEDS_EVIDENCE' },
          },
          {
            name: 'blockingLevel',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'hard' },
          },
          {
            name: 'role',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'grid_connection_validator' },
          },
          {
            name: 'includeResolved',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, maximum: 250 },
          },
        ],
      },
      async handler(ctx) {
        const selector = {};
        if (!ctx.params.includeResolved) {
          selector['payload.status'] = 'placeholder_gap';
        }
        if (ctx.params.reason) selector['payload.reason'] = normalizeReason(ctx.params.reason);
        if (ctx.params.blockingLevel) {
          selector['payload.blockingLevel'] = normalizeBlockingLevel(ctx.params.blockingLevel);
        }
        if (ctx.params.role) selector['payload.role'] = ctx.params.role;

        const result = await ctx.call('object-store.query', {
          namespace: this.resolveNamespace(ctx),
          selector,
          limit: ctx.params.limit,
        });

        const placeholders = (result.docs || [])
          .map((document) => document.payload || {})
          .sort((left, right) =>
            String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
          );

        return {
          tenantId: getTenantId(ctx),
          total: placeholders.length,
          placeholders,
        };
      },
    },

    resolveGap: {
      rest: 'POST /gaps/:placeholderId/resolve',
      params: {
        placeholderId: { type: 'string', min: 3 },
        resolution: { type: 'any' },
        approvedRoles: { type: 'array', optional: true, items: 'string', default: [] },
      },
      openapi: {
        summary: 'Resolve an interface placeholder gap',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'placeholderId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'ph_1234567890abcdef' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['resolution'],
                properties: {
                  resolution: {
                    example: { summary: 'Manual approval documented', approvedBy: 'user-123' },
                    oneOf: [
                      { type: 'string', example: 'Manual approval documented' },
                      {
                        type: 'object',
                        properties: {
                          summary: { type: 'string', example: 'Manual approval documented' },
                          approvedBy: { type: 'string', example: 'user-123' },
                        },
                      },
                    ],
                  },
                  approvedRoles: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['ROLE_KAUFMAENNISCHE_LEITUNG', 'ROLE_NETZPLANUNG'],
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    resolution: {
                      summary: 'Manual approval documented',
                      approvedBy: 'user-123',
                    },
                    approvedRoles: ['ROLE_KAUFMAENNISCHE_LEITUNG', 'ROLE_NETZPLANUNG'],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const placeholder = await this.loadPlaceholder(ctx, ctx.params.placeholderId);
        const resolution = normalizeResolution(ctx.params.resolution);
        const approvedRoles = Array.isArray(ctx.params.approvedRoles)
          ? ctx.params.approvedRoles.map((role) => String(role || '').trim()).filter(Boolean)
          : [];

        const missingRoles = (placeholder.requiredResolverRoles || []).filter(
          (requiredRole) => !approvedRoles.includes(requiredRole)
        );
        if (missingRoles.length > 0) {
          throw new MoleculerClientError(
            `Missing resolver roles: ${missingRoles.join(', ')}`,
            403,
            'PLACEHOLDER_RESOLUTION_ROLE_REQUIRED',
            { missingRoles }
          );
        }

        const resolvedAt = nowIso();
        const updated = {
          ...placeholder,
          status: 'resolved',
          updatedAt: resolvedAt,
          resolvedAt,
          resolution: {
            ...resolution,
            approvedRoles,
          },
        };

        await ctx.call('object-store.put', {
          namespace: this.resolveNamespace(ctx),
          key: placeholder.placeholderId,
          payload: updated,
        });

        return {
          success: true,
          placeholder: updated,
        };
      },
    },

    canExecuteAction: {
      params: {
        action: { type: 'string', min: 2 },
      },
      async handler(ctx) {
        const result = await ctx.call('object-store.query', {
          namespace: this.resolveNamespace(ctx),
          selector: { 'payload.status': 'placeholder_gap' },
          limit: MAX_LIMIT,
        });
        const placeholders = (result.docs || []).map((document) => document.payload || {});
        const hardBlockers = placeholders.filter(
          (placeholder) => placeholder.blockingLevel === 'hard'
        );
        if (hardBlockers.length > 0) {
          return {
            action: ctx.params.action,
            allowed: false,
            decisionStatus: 'blocked',
            blockingPlaceholders: hardBlockers,
          };
        }
        if (placeholders.length > 0) {
          return {
            action: ctx.params.action,
            allowed: true,
            decisionStatus: 'assumptions_required',
            blockingPlaceholders: placeholders,
          };
        }
        return {
          action: ctx.params.action,
          allowed: true,
          decisionStatus: 'clear',
          blockingPlaceholders: [],
        };
      },
    },
  },

  methods: {
    resolveNamespace(ctx) {
      return tenantNamespace(PLACEHOLDER_NAMESPACE, getTenantId(ctx));
    },

    async loadPlaceholder(ctx, placeholderId) {
      try {
        const document = await ctx.call('object-store.get', {
          namespace: this.resolveNamespace(ctx),
          key: placeholderId,
        });
        return document.payload;
      } catch (err) {
        if (err?.type === 'OBJECT_NOT_FOUND' || err?.code === 404) {
          throw new MoleculerClientError(
            `Placeholder not found: ${placeholderId}`,
            404,
            'PLACEHOLDER_NOT_FOUND',
            { placeholderId }
          );
        }
        throw err;
      }
    },
  },
};
