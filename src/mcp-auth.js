'use strict';

/**
 * Resolves an MCP session's identity from its `Authorization: Bearer <token>`
 * header, mirroring `services/api.service.js`'s `onBeforeCall` token
 * resolution (ck_ API token / csess_ session token / legacy passthrough) so
 * that `ctx.meta` looks the same whether an action was reached via the REST
 * gateway or via `/api/mcp`. Kept as a standalone module (rather than
 * importing from api.service.js, which doesn't export this logic) to avoid
 * touching that file — see src/mcp-rbac-gate.js for why parity matters here.
 */

const { mapRolesFromLegacyToken } = require('./auth/rbac');

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) return null;
  const token = authorizationHeader.substring(7).trim();
  return token || null;
}

async function resolveMcpAuth(broker, authorizationHeader) {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return { ok: false, status: 401, message: 'Missing Authorization: Bearer <token> header' };
  }

  if (token.startsWith('ck_')) {
    const verification = await broker.call('token-manager.verify', {
      token,
      method: 'POST',
      path: '/api/mcp',
      trackUsage: true,
    });
    if (!verification?.valid) {
      const status = verification?.reason === 'SCOPE_VIOLATION' ? 403 : 401;
      return { ok: false, status, message: 'Invalid, revoked, or scope-restricted API token' };
    }
    const roles = mapRolesFromLegacyToken(verification.scope, verification.scopes);
    const meta = {
      mcpBearerToken: token,
      apiToken: {
        id: verification.tokenId,
        name: verification.name,
        scope: verification.scope,
        scopes: verification.scopes || [],
        tenantId: verification.tenantId || null,
        userId: verification.userId || null,
        legacy: Boolean(verification.legacy),
      },
      authUser: {
        authType: 'legacy-token',
        userId: verification.userId || verification.tokenId || null,
        tenantId: verification.tenantId || null,
        groups: [],
        idpClaims: null,
        roles,
      },
      tenantId: verification.tenantId || null,
    };
    return { ok: true, meta };
  }

  if (token.startsWith('csess_')) {
    const verification = await broker.call('auth.verify', { token, trackUsage: true });
    if (!verification?.valid) {
      return { ok: false, status: 401, message: 'Invalid or expired session token' };
    }
    const roles = Array.isArray(verification.roles) ? verification.roles : [];
    const meta = {
      mcpBearerToken: token,
      authSession: { id: verification.sessionId, expiresAt: verification.expiresAt || null },
      authUser: {
        authType: 'session',
        userId: verification.userId || null,
        tenantId: verification.tenantId || null,
        groups: Array.isArray(verification.groups) ? verification.groups : [],
        idpClaims: verification.idpClaims || null,
        roles,
      },
      tenantId: verification.tenantId || null,
    };
    return { ok: true, meta };
  }

  // Legacy plain Bearer token passthrough — matches onBeforeCall's `else`
  // branch, which never calls enforceRbacForPath either.
  return {
    ok: true,
    meta: { mcpBearerToken: token, cernionToken: token, bypassRbac: true, authUser: null },
  };
}

module.exports = { resolveMcpAuth };
