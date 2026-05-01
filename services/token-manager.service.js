/**
 * Token Manager Service
 *
 * Manages local API access tokens for Integration Hub.
 * Tokens are generated once, stored as SHA-256 hashes, and scoped.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORAGE_FILE = process.env.TOKEN_STORAGE_FILE || './uploads/.api-tokens.json';
const MAX_NAME_LENGTH = 60;

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
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

function isWriteMethod(method) {
  const m = String(method || '').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS';
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
        tenantId: {
          type: 'string',
          optional: true,
          pattern: /^[a-z0-9-]{1,64}$/,
          max: 64,
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
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'Power BI Connector' },
                  scope: {
                    type: 'string',
                    enum: ['read-only', 'full-access'],
                    default: 'read-only',
                    example: 'read-only',
                  },
                },
              },
              examples: {
                readOnly: {
                  summary: 'Create a read-only token',
                  value: { name: 'Power BI Connector', scope: 'read-only' },
                },
                fullAccess: {
                  summary: 'Create a full-access token',
                  value: { name: 'Admin Token', scope: 'full-access' },
                },
              },
            },
          },
        },
      },
      handler(ctx) {
        const { name } = ctx.params;
        const scope = normaliseScope(ctx.params.scope);

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
          scopes: [scope, 'vnb-monitor'],
          tenantId: ctx.params.tenantId || null,
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

        if (scope === 'read-only' && isWriteMethod(method)) {
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
                    tenants: { type: 'array', items: { type: 'string' }, example: ['stadtwerk-a', 'stadtwerk-b'] },
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
        const tenants = [
          ...new Set(tokens.filter((t) => t.tenantId).map((t) => t.tenantId)),
        ];
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
