'use strict';

/**
 * Shared auth-role extraction helpers (issues #288/#289, gap identified in
 * #275's Bestandsanalyse: several services independently re-derive "what
 * roles does this caller have" from ctx.meta — usually without ever
 * checking the result against anything, e.g. HITL approve/reject and
 * Agent-Receipts promote previously recorded `requiredResolverRoles`/
 * `promotedBy` but never verified them).
 *
 * This module is the one canonical place that extracts role-like values
 * from ctx.meta — mirrors the convention already established locally in
 * services/personal-agent.service.js#hasFullAccessPrincipal (kept there
 * unchanged; not migrated, to avoid touching a heavily-tested file for a
 * risk-free extraction that has no external callers today).
 */

function listAuthValues(...values) {
  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

// All role-like values a caller presents, regardless of which field an auth
// provider happens to populate (roles vs. groups, scope vs. scopes).
function extractCallerRoles(ctx) {
  const meta = ctx?.meta || {};
  const authUser = meta.authUser && typeof meta.authUser === 'object' ? meta.authUser : {};
  const apiToken = meta.apiToken && typeof meta.apiToken === 'object' ? meta.apiToken : {};
  return listAuthValues(
    authUser.roles,
    authUser.groups,
    meta.roles,
    apiToken.scopes,
    apiToken.scope,
    meta.scopes
  );
}

function hasFullAccessPrincipal(ctx) {
  const values = extractCallerRoles(ctx);
  return values.includes('full-access') || values.includes('cross-tenant-admin');
}

/**
 * Does the caller present at least one of the required roles?
 *
 * Empty/absent requiredRoles means "no restriction declared" → true. This is
 * deliberate: a resource that never populated a role requirement keeps its
 * pre-existing (permissive) behavior — additive enforcement only applies
 * once a requirement is actually declared, never retroactively.
 */
function callerHasAnyRole(ctx, requiredRoles) {
  const required = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles])
    .map((role) => String(role || '').trim())
    .filter(Boolean);
  if (required.length === 0) return true;
  const callerRoles = new Set(extractCallerRoles(ctx));
  return required.some((role) => callerRoles.has(role));
}

module.exports = {
  listAuthValues,
  extractCallerRoles,
  hasFullAccessPrincipal,
  callerHasAnyRole,
};
