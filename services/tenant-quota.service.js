'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const rateQuotaStore = require('../src/rate-quota-store');

const OPENAPI_TAG = 'Tenant Quotas';
const RATE_LIMIT_KEYS = Object.keys(rateQuotaStore.RATE_LIMIT_DEFAULTS || {});
const QUOTA_KEYS = Object.keys(rateQuotaStore.QUOTA_DEFAULTS || {});

module.exports = {
  name: 'tenant-quota',

  actions: {
    getQuotas: {
      rest: 'GET /tenants/:id/quotas',
      params: {
        id: { type: 'string', trim: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Get current quota and usage snapshot for one tenant',
        description:
          'Phase-1 read-only quota endpoint (v0.48.4). Returns configured rate-limit defaults, active quota windows, driver info, and recent quota events for the selected tenant.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'stadtwerk-a' },
            description: 'Tenant identifier.',
          },
        ],
        responses: {
          200: {
            description: 'Quota snapshot for the tenant.',
          },
          403: {
            description: 'Tenant scope violation or missing full-access authorization.',
          },
        },
      },
      async handler(ctx) {
        const tenantId = String(ctx.params.id || '').trim();
        this.assertTenantAccess(ctx, tenantId);
        return {
          success: true,
          data: rateQuotaStore.buildQuotaSnapshot(tenantId),
        };
      },
    },

    setQuotas: {
      rest: 'PUT /tenants/:id/quotas',
      params: {
        id: { type: 'string', trim: true, min: 1 },
        rateLimits: { type: 'object', optional: true },
        quotas: { type: 'object', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Update tenant quota and rate-limit configuration',
        description:
          'Write/admin endpoint for tenant-specific quota and endpoint-class rate-limit overrides. Requires full-access token at gateway level and tenant-scope check in service.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'stadtwerk-a' },
            description: 'Tenant identifier.',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  rateLimits: {
                    type: 'object',
                    properties: {
                      read: { type: 'integer', minimum: 0, example: 600 },
                      write: { type: 'integer', minimum: 0, example: 60 },
                      compute: { type: 'integer', minimum: 0, example: 30 },
                    },
                  },
                  quotas: {
                    type: 'object',
                    properties: {
                      llm_tokens_per_day: { type: 'integer', minimum: 0, example: 250000 },
                      llm_tokens_per_month: { type: 'integer', minimum: 0, example: 5000000 },
                      max_async_jobs_per_day: { type: 'integer', minimum: 0, example: 250 },
                      max_rag_chunks_per_month: { type: 'integer', minimum: 0, example: 100000 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Updated tenant quota snapshot.',
          },
          403: {
            description: 'Tenant scope violation or missing full-access authorization.',
          },
          422: {
            description: 'Invalid payload (unknown keys or non-numeric values).',
          },
        },
      },
      async handler(ctx) {
        const tenantId = String(ctx.params.id || '').trim();
        this.assertTenantAccess(ctx, tenantId);

        const patch = this.validateConfigPatch({
          rateLimits: ctx.params.rateLimits,
          quotas: ctx.params.quotas,
        });

        const state = rateQuotaStore.getTenantState(tenantId);
        state.config = state.config || {};
        state.config.rateLimits = {
          ...(state.config.rateLimits || {}),
          ...(patch.rateLimits || {}),
        };
        state.config.quotas = {
          ...(state.config.quotas || {}),
          ...(patch.quotas || {}),
        };

        rateQuotaStore.saveTenantState(tenantId, state);

        return {
          success: true,
          data: rateQuotaStore.buildQuotaSnapshot(tenantId),
        };
      },
    },

    listEvents: {
      rest: 'GET /tenants/:id/rate-limit-events',
      params: {
        id: { type: 'string', trim: true, min: 1 },
        limit: { type: 'number', integer: true, min: 1, max: 200, optional: true, convert: true },
        type: { type: 'string', optional: true, trim: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'List recent rate-limit and quota events for one tenant',
        description:
          'Returns the most recent tenant-scoped quota/rate events recorded by the new rate-quota foundation layer. Phase 1 exposes read-only visibility for operational review.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'stadtwerk-a' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          },
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['quota.threshold.reached', 'quota.exhausted', 'rate_limit.exceeded'],
              example: 'quota.threshold.reached',
            },
          },
        ],
        responses: {
          200: {
            description: 'Recent tenant events.',
          },
        },
      },
      async handler(ctx) {
        const tenantId = String(ctx.params.id || '').trim();
        this.assertTenantAccess(ctx, tenantId);
        return {
          success: true,
          data: rateQuotaStore.listTenantEvents(tenantId, {
            limit: ctx.params.limit,
            type: ctx.params.type,
          }),
        };
      },
    },
  },

  methods: {
    validateConfigPatch(payload = {}) {
      const patch = {};
      let changed = 0;

      if (payload.rateLimits && typeof payload.rateLimits === 'object') {
        patch.rateLimits = this.validateNumericMap(
          payload.rateLimits,
          RATE_LIMIT_KEYS,
          'rateLimits'
        );
        changed += Object.keys(patch.rateLimits).length;
      }

      if (payload.quotas && typeof payload.quotas === 'object') {
        patch.quotas = this.validateNumericMap(payload.quotas, QUOTA_KEYS, 'quotas');
        changed += Object.keys(patch.quotas).length;
      }

      if (changed === 0) {
        throw new MoleculerClientError(
          'At least one valid field must be provided in rateLimits or quotas.',
          422,
          'VALIDATION_ERROR'
        );
      }

      return patch;
    },

    validateNumericMap(input, allowedKeys, fieldName) {
      const next = {};
      for (const [key, value] of Object.entries(input || {})) {
        if (!allowedKeys.includes(key)) {
          throw new MoleculerClientError(
            `Unknown ${fieldName} key: ${key}`,
            422,
            'VALIDATION_ERROR'
          );
        }

        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
          throw new MoleculerClientError(
            `Invalid ${fieldName}.${key}: expected non-negative integer.`,
            422,
            'VALIDATION_ERROR'
          );
        }

        next[key] = numeric;
      }
      return next;
    },

    assertTenantAccess(ctx, tenantId) {
      const requestTenantId = ctx?.meta?.tenantId || null;
      if (requestTenantId && requestTenantId !== tenantId) {
        throw new MoleculerClientError(
          'Tenant-scoped token cannot access quota data of another tenant.',
          403,
          'TENANT_SCOPE_VIOLATION'
        );
      }
    },
  },
};
