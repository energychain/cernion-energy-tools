/**
 * Token Manager Service
 *
 * Manages local API access tokens for Integration Hub.
 * Tokens are generated once, stored as SHA-256 hashes, and scoped.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Errors } = require('moleculer');
const { validateTenantId, isTenantAllowed } = require('../src/tenant-context');
const { tenantExistsInRegistry } = require('../src/provisioning-registry');

const DEFAULT_STORAGE_FILE = process.env.TOKEN_STORAGE_FILE || './uploads/.api-tokens.json';
const MAX_NAME_LENGTH = 60;
const ALLOWED_EXTRA_SCOPES = new Set([
  'vnb-monitor',
  'rundeck-read',
  'rundeck-dry-run',
  'rundeck-ack',
  'rundeck-execute-dev',
]);
// Free-form user identity for token binding: letters, digits, and . _ @ : - separators
// (e.g. "thorsten", "svc:data-quality-campaign"), max 120 chars.
const USER_ID_PATTERN = /^[a-zA-Z0-9_.@:-]{1,120}$/;

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}

function maskToken(token) {
  const raw = String(token || '');
  if (raw.length <= 10) return `${raw.slice(0, 3)}****`;
  return `${raw.slice(0, 6)}****${raw.slice(-4)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normaliseScope(scope) {
  return scope === 'full-access' ? 'full-access' : 'read-only';
}

function normalizeScopes(scope, requestedScopes = []) {
  const primaryScope = normaliseScope(scope);
  const scopes = new Set([primaryScope, 'vnb-monitor']);
  for (const entry of Array.isArray(requestedScopes) ? requestedScopes : []) {
    const value = String(entry || '').trim();
    if (!value) continue;
    if (value === 'full-access' && primaryScope !== 'full-access') {
      throw new Errors.MoleculerClientError(
        'full-access cannot be added as an extra scope to a read-only token.',
        422,
        'INVALID_TOKEN_SCOPE'
      );
    }
    if (value !== primaryScope && value !== 'full-access' && !ALLOWED_EXTRA_SCOPES.has(value)) {
      throw new Errors.MoleculerClientError(
        `Unsupported token scope: ${value}.`,
        422,
        'INVALID_TOKEN_SCOPE'
      );
    }
    scopes.add(value);
  }
  return [...scopes];
}

function isWriteMethod(method) {
  const m = String(method || '').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
}

function isReadOnlySidecarInvocation(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  return (
    m === 'POST' &&
    (/^\/api\/agent-sidecar\/tools\/[^/]+\/call$/.test(pathOnly) ||
      /^\/api\/agent-sidecar\/mcp\/tools\/[^/]+\/call$/.test(pathOnly))
  );
}

function isOperationsRunbookInvocation(method, requestPath) {
  const m = String(method || '').toUpperCase();
  const pathOnly = String(requestPath || '').split('?')[0];
  if (!pathOnly.startsWith('/api/operations-runbook/')) return false;
  return ['GET', 'POST'].includes(m);
}

// Tokens created before Issue #157 (tenant/user binding) have no userId on
// record. They keep working but are flagged so callers can sunset them.
function isLegacyToken(record) {
  return !record?.tenantId || !record?.userId;
}

function getCallerTenantId(ctx) {
  return ctx?.meta?.apiToken?.tenantId || ctx?.meta?.authUser?.tenantId || null;
}

module.exports = {
  name: 'token-manager',

  settings: {
    storageFile: DEFAULT_STORAGE_FILE,
    maxTokensPerInstallation: 20,
  },

  actions: {
    list: {
      rest: 'GET /tokens',
      openapi: {
        summary: 'List API tokens',
        tags: ['IntegrationHub'],
      },
      handler() {
        const tokens = this.loadTokens();
        return {
          success: true,
          data: tokens.map((entry) => ({
            id: entry.id,
            name: entry.name,
            token: entry.tokenMasked,
            createdAt: entry.createdAt,
            lastUsedAt: entry.lastUsedAt || null,
            usageCount: entry.usageCount || 0,
            scopes: entry.scopes || [entry.scope || 'read-only'],
            tenantId: entry.tenantId || null,
            userId: entry.userId || null,
            legacy: isLegacyToken(entry),
            active: entry.active !== false,
          })),
        };
      },
    },

    create: {
      rest: 'POST /tokens',
      params: {
        name: { type: 'string', min: 1, max: MAX_NAME_LENGTH, trim: true },
        scope: {
          type: 'enum',
          values: ['read-only', 'full-access'],
          optional: true,
          default: 'read-only',
        },
        tenantId: { type: 'string', min: 1, max: 64, trim: true },
        userId: { type: 'string', min: 1, max: 120, pattern: USER_ID_PATTERN, trim: true },
        scopes: {
          type: 'array',
          optional: true,
          items: {
            type: 'enum',
            values: [
              'vnb-monitor',
              'rundeck-read',
              'rundeck-dry-run',
              'rundeck-ack',
              'rundeck-execute-dev',
            ],
          },
        },
      },
      openapi: {
        summary: 'Create API token',
        tags: ['IntegrationHub'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'tenantId', 'userId'],
                properties: {
                  name: { type: 'string', example: 'Power BI Connector' },
                  scope: {
                    type: 'string',
                    enum: ['read-only', 'full-access'],
                    default: 'read-only',
                    example: 'read-only',
                  },
                  tenantId: { type: 'string', example: 'stadtwerk-a' },
                  userId: { type: 'string', example: 'svc:powerbi-connector' },
                  scopes: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['rundeck-read', 'rundeck-dry-run'],
                  },
                },
              },
              examples: {
                readOnly: {
                  summary: 'Create a read-only token',
                  value: {
                    name: 'Power BI Connector',
                    scope: 'read-only',
                    tenantId: 'stadtwerk-a',
                    userId: 'svc:powerbi-connector',
                  },
                },
                fullAccess: {
                  summary: 'Create a full-access token',
                  value: {
                    name: 'Admin Token',
                    scope: 'full-access',
                    tenantId: 'stadtwerk-a',
                    userId: 'admin',
                  },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { name, tenantId, userId } = ctx.params;
        const scope = normaliseScope(ctx.params.scope);
        const scopes = normalizeScopes(scope, ctx.params.scopes || []);

        // Explicit checks (not just the params schema) so direct handler
        // invocation — bypassing the moleculer-web validator — still rejects
        // unbound tokens. Issue #157: no new token may be created without
        // an explicit tenant/user binding.
        if (!tenantId) {
          throw new Errors.MoleculerClientError(
            'tenantId is required to create a token.',
            422,
            'TENANT_ID_REQUIRED'
          );
        }
        if (!userId) {
          throw new Errors.MoleculerClientError(
            'userId is required to create a token.',
            422,
            'USER_ID_REQUIRED'
          );
        }

        const callerTenantId = getCallerTenantId(ctx);
        if (callerTenantId && callerTenantId !== tenantId) {
          throw new Errors.MoleculerClientError(
            `Token principal for tenant '${callerTenantId}' cannot create tokens for tenant '${tenantId}'.`,
            403,
            'TOKEN_TENANT_FORBIDDEN'
          );
        }

        validateTenantId(tenantId);
        if (!isTenantAllowed(tenantId) && !tenantExistsInRegistry(tenantId)) {
          throw new Errors.MoleculerClientError(
            `Tenant '${tenantId}' is not in the allowed tenant list.`,
            403,
            'TENANT_NOT_ALLOWED'
          );
        }
        if (!USER_ID_PATTERN.test(userId)) {
          throw new Errors.MoleculerClientError(
            `userId '${userId}' does not match the allowed pattern.`,
            422,
            'INVALID_USER_ID'
          );
        }

        const tokens = this.loadTokens();
        const activeCount = tokens.filter((entry) => entry.active !== false).length;

        if (activeCount >= this.settings.maxTokensPerInstallation) {
          throw new Error(
            `Token limit reached (${this.settings.maxTokensPerInstallation}). Revoke unused tokens first.`
          );
        }

        const rawToken = `ck_${crypto.randomBytes(16).toString('hex')}`;
        const createdAt = nowIso();

        const record = {
          id: crypto.randomUUID(),
          name,
          tokenHash: sha256(rawToken),
          tokenMasked: maskToken(rawToken),
          createdAt,
          lastUsedAt: null,
          usageCount: 0,
          scope,
          scopes,
          tenantId,
          userId,
          active: true,
        };

        tokens.push(record);
        this.saveTokens(tokens);

        return {
          success: true,
          data: {
            id: record.id,
            name: record.name,
            token: rawToken,
            createdAt: record.createdAt,
            scope: record.scope,
            scopes: record.scopes,
            tenantId: record.tenantId,
            userId: record.userId,
            legacy: false,
            active: true,
          },
          message:
            'Token created. The plain token is shown only once. Copy it now and store it securely.',
        };
      },
    },

    revoke: {
      rest: 'DELETE /tokens/:id',
      params: {
        id: { type: 'string', min: 1, trim: true },
      },
      openapi: {
        summary: 'Revoke API token',
        tags: ['IntegrationHub'],
      },
      handler(ctx) {
        const tokens = this.loadTokens();
        const idx = tokens.findIndex((entry) => entry.id === ctx.params.id);
        if (idx === -1) {
          return { success: true, revoked: false, message: 'Token not found.' };
        }

        tokens[idx] = {
          ...tokens[idx],
          active: false,
          revokedAt: nowIso(),
        };
        this.saveTokens(tokens);

        return {
          success: true,
          revoked: true,
          id: ctx.params.id,
        };
      },
    },

    verify: {
      rest: 'POST /tokens/verify',
      params: {
        token: { type: 'string', min: 8, trim: true },
        method: { type: 'string', optional: true },
        path: { type: 'string', optional: true },
        trackUsage: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Verify API token',
        tags: ['IntegrationHub'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: {
                  token: { type: 'string', example: 'ck_abc123...' },
                  method: { type: 'string', example: 'GET', default: null },
                  path: { type: 'string', example: '/api/tokens', default: null },
                  trackUsage: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                basic: {
                  summary: 'Verify a token',
                  value: { token: 'ck_abc123...', method: 'GET', path: '/api/tokens' },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { token, method, path: requestPath, trackUsage } = ctx.params;
        const hash = sha256(token);
        const tokens = this.loadTokens();
        const matchIndex = tokens.findIndex(
          (entry) => entry.active !== false && entry.tokenHash === hash
        );

        if (matchIndex === -1) {
          return {
            success: true,
            valid: false,
          };
        }

        const record = tokens[matchIndex];
        const scope = normaliseScope(record.scope);

        if (
          scope === 'read-only' &&
          isWriteMethod(method) &&
          !isReadOnlySidecarInvocation(method, requestPath) &&
          !isOperationsRunbookInvocation(method, requestPath)
        ) {
          return {
            success: true,
            valid: false,
            reason: 'SCOPE_VIOLATION',
            scope,
            path: requestPath || null,
          };
        }

        if (trackUsage) {
          tokens[matchIndex] = {
            ...record,
            usageCount: (record.usageCount || 0) + 1,
            lastUsedAt: nowIso(),
          };
          this.saveTokens(tokens);
        }

        return {
          success: true,
          valid: true,
          tokenId: record.id,
          name: record.name,
          scope,
          scopes: record.scopes || [scope],
          tenantId: record.tenantId ?? null,
          userId: record.userId ?? null,
          legacy: isLegacyToken(record),
          active: true,
        };
      },
    },

    'tenant.list': {
      rest: 'GET /tokens/tenants',
      openapi: {
        summary: 'List known tenant IDs',
        description:
          'Returns all unique tenantIds that appear in stored tokens. ' +
          'Requires full-access scope. Empty list when no tenant-scoped tokens exist.',
        tags: ['IntegrationHub'],
        responses: {
          200: {
            description: 'List of tenant IDs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    tenants: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['stadtwerk-a', 'stadtwerk-b'],
                    },
                    count: { type: 'integer', example: 2 },
                  },
                },
              },
            },
          },
        },
      },
      handler() {
        const tokens = this.loadTokens();
        const tenants = [...new Set(tokens.filter((t) => t.tenantId).map((t) => t.tenantId))];
        return { success: true, tenants, count: tenants.length };
      },
    },
  },

  methods: {
    loadTokens() {
      try {
        const filePath = this.settings.storageFile;
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        this.logger.warn(`Failed to load tokens from ${this.settings.storageFile}: ${err.message}`);
        return [];
      }
    },

    saveTokens(tokens) {
      const filePath = this.settings.storageFile;
      ensureDirForFile(filePath);
      fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), 'utf8');
    },
  },
};
