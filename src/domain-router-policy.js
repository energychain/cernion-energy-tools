'use strict';
const { Errors } = require('moleculer');
const { extractCallerRoles } = require('./auth-role-helpers');
const { getAuthenticatedTenant } = require('./agent-sidecar-policy');
function deny(reason) {
  throw new Errors.MoleculerClientError(reason, 403, 'DOMAIN_ROUTER_POLICY_BLOCKED');
}
function principal(ctx, input = {}) {
  const auth = ctx.meta?.authUser || ctx.meta?.apiToken || {};
  const tenantId = getAuthenticatedTenant(ctx);
  const authRoles = [...extractCallerRoles(ctx), ...(ctx.meta?.apiToken?.roles || [])];
  if (!tenantId) deny('Authenticated tenant required');
  const roles = [
    ...new Set(authRoles.map((r) => r.toUpperCase()).filter((r) => /^ROLE_[A-Z_]+$/.test(r))),
  ];
  const actorId = auth.userId || auth.id || auth.tokenId;
  if (!actorId || !Array.isArray(roles) || !roles.some((r) => /^ROLE_[A-Z_]+$/.test(r)))
    deny('Authenticated actor and energy role required');
  for (const candidate of [input.tenantId, input.knownContext?.tenantId, input.context?.tenantId]) {
    if (candidate && candidate !== tenantId) deny('Tenant mismatch');
  }
  const sensitivityFlags = input.sensitivityFlags || [];
  const clearance = auth.sensitivityFlags || [];
  if (!Array.isArray(sensitivityFlags) || sensitivityFlags.some((f) => !clearance.includes(f)))
    deny('Sensitivity clearance required');
  return { tenantId, actorId, roles, clearance };
}
function visible(p, state) {
  return (
    state.tenantId === p.tenantId &&
    state.accessRoles.some((r) => p.roles.includes(r)) &&
    state.sensitivityFlags.every((f) => p.clearance.includes(f)) &&
    (state.actorId === p.actorId || state.sharedWithRoles?.some((r) => p.roles.includes(r)))
  );
}
function authorize(p, state) {
  if (!visible(p, state)) deny('Case not accessible');
}
module.exports = { principal, visible, authorize, deny };
