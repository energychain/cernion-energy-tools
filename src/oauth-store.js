'use strict';

/**
 * In-memory state for the OAuth 2.1 authorization-code + PKCE flow that
 * fronts `/api/mcp` for clients (like claude.ai's remote MCP connector)
 * that can only do OAuth, not raw Bearer token entry — see
 * docs/oauth.md for the full design.
 *
 * Mirrors `services/copilot-process.service.js`'s `ProcessIntentStore`:
 * single-process, in-memory, short-lived records with TTL cleanup. That's
 * an appropriate fit here too — authorization codes live for minutes, and
 * a restart simply means in-flight authorize attempts must be retried
 * (the underlying CET token that OAuth wraps is unaffected). Does not
 * survive a process restart or work across multiple horizontally-scaled
 * instances without a shared store — an accepted v1 simplification.
 */

const crypto = require('crypto');

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes — RFC 6749 §4.1.2 "SHOULD... a maximum lifetime of 10 minutes"
const DYNAMIC_CLIENT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

class OAuthStore {
  constructor() {
    this.clients = new Map(); // client_id -> { clientId, clientSecret|null, createdAt, expiresAt }
    this.codes = new Map(); // code -> { clientId, redirectUri, codeChallenge, accessToken, tokenMeta, createdAt, expiresAt }
    this._seedStaticClient();
  }

  _seedStaticClient() {
    const clientId = process.env.MCP_OAUTH_CLIENT_ID;
    if (!clientId) return;
    this.clients.set(clientId, {
      clientId,
      clientSecret: process.env.MCP_OAUTH_CLIENT_SECRET || null,
      createdAt: new Date().toISOString(),
      expiresAt: null, // statically configured — never expires
    });
  }

  registerClient({ clientSecret = null } = {}) {
    const clientId = `mcp_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    const record = {
      clientId,
      clientSecret,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DYNAMIC_CLIENT_TTL_MS).toISOString(),
    };
    this.clients.set(clientId, record);
    return record;
  }

  getClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return null;
    if (client.expiresAt && Date.parse(client.expiresAt) < Date.now()) {
      this.clients.delete(clientId);
      return null;
    }
    return client;
  }

  createAuthorizationCode({ clientId, redirectUri, codeChallenge, accessToken, tokenMeta }) {
    const code = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.codes.set(code, {
      clientId,
      redirectUri,
      codeChallenge,
      accessToken,
      tokenMeta,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + AUTH_CODE_TTL_MS).toISOString(),
    });
    return code;
  }

  /** Authorization codes are single-use (RFC 6749 §4.1.2) — this consumes it. */
  consumeAuthorizationCode(code) {
    const record = this.codes.get(code);
    if (!record) return null;
    this.codes.delete(code);
    if (Date.parse(record.expiresAt) < Date.now()) return null;
    return record;
  }
}

module.exports = { OAuthStore, AUTH_CODE_TTL_MS };
