'use strict';

/**
 * Mirrors the one RBAC rule from `services/api.service.js`'s
 * `enforceRbacForPath` that matters for MCP meta-tools: any mutating call
 * (`ask`, `prepare_process`, `execute_process`, `run_receipt` mode=run)
 * requires the `full-access` role, exactly as it would if the caller hit
 * the equivalent REST endpoint directly. The MCP transport bypasses
 * moleculer-web's `onBeforeCall` entirely (see src/mcp-transport.js), so
 * without this gate a valid-but-unprivileged token (e.g. a `read-only`
 * scoped API token) could reach writes through MCP that it cannot reach
 * through REST. Legacy plain-Bearer tokens are exempt here too, because
 * `onBeforeCall`'s own legacy branch never calls `enforceRbacForPath`
 * either (see the `else { ctx.meta.cernionToken = ... }` branch there) —
 * `src/mcp-auth.js` sets `bypassRbac: true` for that case to match.
 */

const { hasRole } = require('./auth/rbac');
const { MoleculerClientError } = require('moleculer').Errors;

function assertFullAccessForWrite(meta) {
  if (meta?.bypassRbac) return;
  const roles = meta?.authUser?.roles || [];
  if (!hasRole(roles, 'full-access')) {
    throw new MoleculerClientError('Role required: full-access.', 403, 'ROLE_REQUIRED');
  }
}

module.exports = { assertFullAccessForWrite };
