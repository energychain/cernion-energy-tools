'use strict';

/**
 * Safety gate for `cernion_execute_read` (MCP meta-tool #4).
 *
 * `execute_read` reaches the ~1,100+ REST operations catalogued by
 * `agent-manifest.listOperations` through a loopback HTTP call rather than
 * re-deriving moleculer-web's alias→action routing table itself — the
 * gateway's own auth/RBAC/tenant-scoping/rate-limiting in
 * `services/api.service.js`'s `onBeforeCall` already implements that
 * resolution correctly and re-implementing it here would risk silently
 * diverging from it. This module is the one extra gate layered in front of
 * that loopback: GET is read by HTTP convention (mirrors
 * `src/gateway-request-classifiers.js`'s `isReadMethod`), a short allowlist
 * covers POST endpoints that are read/dry-run despite the verb, and a short
 * denylist keeps admin/secret-bearing surfaces out of MCP reach regardless
 * of method (per the concept doc's "Nicht exponieren" list).
 */

const { isReadMethod } = require('./gateway-request-classifiers');

// Paths (relative to /api) that must never be reachable via execute_read,
// even as GET — admin/system/credential surfaces, not agent-facing data.
const DENYLIST_PATH_PATTERNS = [
  /^\/backup(\/|$)/,
  /^\/restore(\/|$)/,
  /^\/system\/admin(\/|$)/,
  /^\/domain-routes\/reload$/,
  /^\/token-manager(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/tenant-quotas?(\/|$)/,
];

// POST endpoints that are read-only or dry-run in effect despite the verb.
const POST_ALLOWLIST_PATH_PATTERNS = [
  /^\/evidence-router\/route$/,
  /^\/knowledge-rag\/(query|semantic|federated-search)$/,
  /^\/agent-receipts\/select$/,
  /^\/agent-receipts\/(evaluate|test|explain)$/,
  /^\/agent-receipts\/[^/]+\/(evaluate|test|explain)$/,
  /^\/cookbook\/(search|validate)$/,
  /^\/copilot\/(ask-cernion-agent|answer-dossier)$/,
];

function stripApiPrefix(path) {
  const normalized = String(path || '').split('?')[0];
  return normalized.startsWith('/api') ? normalized.slice(4) || '/' : normalized;
}

function isDenied(relativePath) {
  return DENYLIST_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/**
 * @param {string} method - HTTP method as catalogued by agent-manifest (e.g. "GET").
 * @param {string} path - Full or /api-relative path, may include the `/api` prefix.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkExecuteReadPolicy(method, path) {
  const relativePath = stripApiPrefix(path);
  if (isDenied(relativePath)) {
    return { allowed: false, reason: 'ADMIN_SURFACE_NOT_EXPOSED' };
  }
  const upperMethod = String(method || '').toUpperCase();
  if (isReadMethod(upperMethod)) {
    return { allowed: true };
  }
  if (
    upperMethod === 'POST' &&
    POST_ALLOWLIST_PATH_PATTERNS.some((pattern) => pattern.test(relativePath))
  ) {
    return { allowed: true };
  }
  return { allowed: false, reason: 'NOT_READ_ONLY' };
}

module.exports = { checkExecuteReadPolicy };
