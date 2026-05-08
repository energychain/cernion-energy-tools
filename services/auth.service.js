'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { Errors } = require('moleculer');
const { getTenantId } = require('../src/tenant-context');
const { mapRolesFromClaims } = require('../src/auth/rbac');
const { validateOidcConfig, buildAuthorizationUrl } = require('../src/auth/oidc');
const { validateSamlConfig, extractClaimsFromAcsPayload } = require('../src/auth/saml');

const DOC_PREFIX = 'sess:';
const OPENAPI_TAG = 'Authentication';

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function extractBearerToken(headers) {
  const authHeader = headers?.authorization || headers?.Authorization;
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) return null;
  return String(authHeader).slice(7).trim() || null;
}

module.exports = {
  name: 'auth',

  settings: {
    dbPath: process.env.AUTH_DB_PATH || './data/auth',
    sessionTtlSeconds: Number(process.env.AUTH_SESSION_TTL_SECONDS || 3600),
    cleanupIntervalMs: Number(process.env.AUTH_CLEANUP_INTERVAL_MS || 60000),
    oidc: {
      issuer: process.env.AUTH_OIDC_ISSUER || '',
      clientId: process.env.AUTH_OIDC_CLIENT_ID || '',
      authorizationEndpoint: process.env.AUTH_OIDC_AUTHORIZATION_ENDPOINT || '',
      redirectUri: process.env.AUTH_OIDC_REDIRECT_URI || '',
      scope: process.env.AUTH_OIDC_SCOPE || 'openid profile email groups',
      groupRoleMap: {
        'cernion-admin': 'full-access',
        'cernion-approver': 'hitl-approver',
        'cernion-viewer': 'read-only',
      },
    },
    saml: {
      entryPoint: process.env.AUTH_SAML_ENTRY_POINT || '',
      issuer: process.env.AUTH_SAML_ISSUER || '',
      callbackUrl: process.env.AUTH_SAML_CALLBACK_URL || '',
      cert: process.env.AUTH_SAML_CERT || '',
      groupRoleMap: {
        'cernion-admin': 'full-access',
        'cernion-approver': 'hitl-approver',
        'cernion-viewer': 'read-only',
      },
    },
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
    this.cleanupTimer = null;
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type'] } });
    await this.db.createIndex({ index: { fields: ['tokenHash'] } });
    await this.db.createIndex({ index: { fields: ['expiresAt'] } });

    this.cleanupTimer = setInterval(() => {
      this.expireSessions().catch((error) => {
        this.logger.warn(`[auth] expireSessions failed: ${error.message}`);
      });
    }, this.settings.cleanupIntervalMs);
  },

  async stopped() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.db) await this.db.close();
  },

  actions: {
    oidcLogin: {
      rest: 'GET /auth/oidc/login',
      params: {
        state: { type: 'string', optional: true },
        nonce: { type: 'string', optional: true },
        scope: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Start OIDC login (foundation)',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'state', in: 'query', schema: { type: 'string', example: 'state-123' } },
          { name: 'nonce', in: 'query', schema: { type: 'string', example: 'nonce-123' } },
          {
            name: 'scope',
            in: 'query',
            schema: { type: 'string', example: 'openid profile email groups' },
          },
        ],
      },
      handler(ctx) {
        const config = validateOidcConfig(this.settings.oidc);
        const state = String(ctx.params.state || crypto.randomUUID()).trim();
        const nonce = String(ctx.params.nonce || crypto.randomUUID()).trim();
        const authorizationUrl = buildAuthorizationUrl(config, {
          state,
          nonce,
          scope: ctx.params.scope || config.scope,
        });

        return {
          success: true,
          provider: 'oidc',
          state,
          nonce,
          authorizationUrl,
          note: 'Foundation mode. Full openid-client token validation follows in v0.48.x.',
        };
      },
    },

    oidcCallback: {
      rest: 'GET /auth/oidc/callback',
      params: {
        code: { type: 'string', optional: true },
        state: { type: 'string', optional: true },
        claims: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'OIDC callback (foundation)',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'code', in: 'query', schema: { type: 'string', example: 'oidc-code-abc' } },
          { name: 'state', in: 'query', schema: { type: 'string', example: 'state-123' } },
          {
            name: 'claims',
            in: 'query',
            schema: {
              type: 'string',
              description: 'Foundation mode claim payload as JSON string.',
              example: '{"sub":"user-1","groups":["cernion-approver"]}',
            },
          },
        ],
      },
      async handler(ctx) {
        validateOidcConfig(this.settings.oidc);

        const claimsInput = ctx.params.claims || {};
        const claims = {
          sub: claimsInput.sub || claimsInput.userId || `oidc:${crypto.randomUUID()}`,
          email: claimsInput.email || null,
          name: claimsInput.name || null,
          groups: Array.isArray(claimsInput.groups) ? claimsInput.groups : [],
          roles: Array.isArray(claimsInput.roles) ? claimsInput.roles : [],
        };

        const session = await this.createSession({
          tenantId: getTenantId(ctx),
          provider: 'oidc',
          claims,
          groupRoleMap: this.settings.oidc.groupRoleMap,
        });

        return {
          success: true,
          provider: 'oidc',
          state: ctx.params.state || null,
          session,
        };
      },
    },

    samlAcs: {
      rest: 'POST /auth/saml/acs',
      params: {
        payload: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'SAML ACS callback (foundation)',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  payload: { type: 'object', example: { nameID: 'user@example.com' } },
                },
              },
              examples: {
                default: {
                  value: {
                    payload: {
                      nameID: 'user@example.com',
                      groups: ['cernion-approver'],
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        validateSamlConfig(this.settings.saml);
        const claims = extractClaimsFromAcsPayload(ctx.params.payload || {});

        if (!claims.sub) {
          claims.sub = `saml:${crypto.randomUUID()}`;
        }

        const session = await this.createSession({
          tenantId: getTenantId(ctx),
          provider: 'saml',
          claims,
          groupRoleMap: this.settings.saml.groupRoleMap,
        });

        return {
          success: true,
          provider: 'saml',
          session,
        };
      },
    },

    refresh: {
      rest: 'POST /auth/refresh',
      params: {
        token: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Refresh csess_ session',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string', example: 'csess_...' },
                },
              },
              examples: {
                default: {
                  value: { token: 'csess_demo_token' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const token = this.resolveToken(ctx);
        if (!token || !token.startsWith('csess_')) {
          throw new Errors.MoleculerClientError('Session token required.', 401, 'SESSION_REQUIRED');
        }

        const verification = await this.verifyInternal(token, true, this.settings.sessionTtlSeconds);
        if (!verification.valid) {
          throw new Errors.MoleculerClientError('Invalid session token.', 401, 'INVALID_SESSION_TOKEN');
        }

        return { success: true, ...verification, token };
      },
    },

    logout: {
      rest: 'POST /auth/logout',
      params: {
        token: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Logout csess_ session',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string', example: 'csess_...' },
                },
              },
              examples: {
                default: {
                  value: { token: 'csess_demo_token' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const token = this.resolveToken(ctx);
        if (!token || !token.startsWith('csess_')) {
          return { success: true, revoked: false };
        }

        const doc = await this.getSessionByHash(sha256(token));
        if (!doc) return { success: true, revoked: false };

        const updatedAt = nowIso();
        const updated = {
          ...doc,
          revokedAt: updatedAt,
          updatedAt,
        };
        await this.db.put(updated);

        this.emitSessionExpired(updated, 'logout');

        return { success: true, revoked: true, sessionId: updated.id };
      },
    },

    verify: {
      rest: 'POST /auth/verify',
      params: {
        token: { type: 'string', optional: true },
        trackUsage: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Verify csess_ session',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  token: { type: 'string', example: 'csess_...' },
                  trackUsage: { type: 'boolean', default: false },
                },
              },
              examples: {
                default: {
                  value: { token: 'csess_demo_token', trackUsage: true },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const token = this.resolveToken(ctx);
        if (!token || !token.startsWith('csess_')) {
          return { success: true, valid: false };
        }

        const result = await this.verifyInternal(token, ctx.params.trackUsage === true, 0);
        return { success: true, ...result };
      },
    },
  },

  methods: {
    resolveToken(ctx) {
      if (typeof ctx?.params?.token === 'string' && ctx.params.token.trim()) {
        return ctx.params.token.trim();
      }
      return extractBearerToken(ctx?.meta?.requestHeaders || {});
    },

    async createSession({ tenantId, provider, claims, groupRoleMap }) {
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + this.settings.sessionTtlSeconds * 1000).toISOString();
      const id = crypto.randomUUID();
      const token = `csess_${crypto.randomBytes(24).toString('hex')}`;
      const roles = mapRolesFromClaims(claims, groupRoleMap);

      const session = {
        _id: `${DOC_PREFIX}${id}`,
        id,
        type: 'auth-session',
        provider,
        tenantId,
        tokenHash: sha256(token),
        userId: claims.sub || null,
        groups: Array.isArray(claims.groups) ? claims.groups : [],
        idpClaims: claims,
        roles,
        usageCount: 0,
        lastUsedAt: null,
        createdAt,
        updatedAt: createdAt,
        expiresAt,
        revokedAt: null,
      };

      await this.db.put(session);

      this.broker.emit('auth.session.created', {
        eventId: crypto.randomUUID(),
        sessionId: id,
        tenantId,
        userId: session.userId,
        groups: session.groups,
        roles: session.roles,
        provider,
        createdAt,
        expiresAt,
      });

      return {
        id,
        token,
        tenantId,
        userId: session.userId,
        groups: session.groups,
        idpClaims: session.idpClaims,
        roles: session.roles,
        expiresAt,
      };
    },

    async getSessionByHash(tokenHash) {
      const result = await this.db.find({
        selector: {
          type: 'auth-session',
          tokenHash,
        },
        limit: 1,
      });
      return result.docs && result.docs[0] ? result.docs[0] : null;
    },

    async verifyInternal(token, trackUsage = false, extendTtlSeconds = 0) {
      const session = await this.getSessionByHash(sha256(token));
      if (!session) return { valid: false, reason: 'NOT_FOUND' };
      if (session.revokedAt) return { valid: false, reason: 'REVOKED' };

      const expiresMs = Date.parse(session.expiresAt || '');
      if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) {
        const updatedAt = nowIso();
        const updated = {
          ...session,
          revokedAt: updatedAt,
          updatedAt,
        };
        await this.db.put(updated);
        this.emitSessionExpired(updated, 'expired');
        return { valid: false, reason: 'EXPIRED' };
      }

      let updated = session;
      if (trackUsage || extendTtlSeconds > 0) {
        const updatedAt = nowIso();
        updated = {
          ...session,
          usageCount: trackUsage ? Number(session.usageCount || 0) + 1 : session.usageCount,
          lastUsedAt: trackUsage ? updatedAt : session.lastUsedAt,
          expiresAt:
            extendTtlSeconds > 0
              ? new Date(Date.now() + extendTtlSeconds * 1000).toISOString()
              : session.expiresAt,
          updatedAt,
        };
        await this.db.put(updated);
      }

      return {
        valid: true,
        sessionId: updated.id,
        tenantId: updated.tenantId,
        userId: updated.userId,
        groups: Array.isArray(updated.groups) ? updated.groups : [],
        idpClaims: updated.idpClaims || null,
        roles: Array.isArray(updated.roles) ? updated.roles : [],
        expiresAt: updated.expiresAt,
      };
    },

    emitSessionExpired(session, reason) {
      this.broker.emit('auth.session.expired', {
        eventId: crypto.randomUUID(),
        sessionId: session.id,
        tenantId: session.tenantId,
        userId: session.userId,
        provider: session.provider,
        reason,
        expiredAt: nowIso(),
      });
    },

    async expireSessions() {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: DOC_PREFIX,
        endkey: `${DOC_PREFIX}\ufff0`,
      });

      const now = Date.now();
      for (const row of result.rows) {
        const session = row.doc;
        if (!session || session.type !== 'auth-session' || session.revokedAt) continue;
        const expiresMs = Date.parse(session.expiresAt || '');
        if (Number.isNaN(expiresMs) || expiresMs > now) continue;

        const updatedAt = nowIso();
        const updated = {
          ...session,
          revokedAt: updatedAt,
          updatedAt,
        };
        await this.db.put(updated);
        this.emitSessionExpired(updated, 'expired');
      }
    },
  },
};
