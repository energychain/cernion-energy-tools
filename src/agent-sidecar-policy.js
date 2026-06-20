'use strict';

const { getRule } = require('./dossier-hydration-registry');
const { validateToolDefinition } = require('./agent-sidecar-tool-manifest');

const FORBIDDEN_TARGET_PATTERNS = [
  /\bcreate\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bapprove\b/i,
  /\breject\b/i,
  /\bresolve\b/i,
  /\bbulk\b/i,
  /\btoken\b/i,
  /\bwebhook\b/i,
  /\bimport\b/i,
];

function getAuthenticatedTenant(ctx) {
  return ctx?.meta?.apiToken?.tenantId || ctx?.meta?.authUser?.tenantId || null;
}

function normalizeContextTenant(input) {
  return (
    input?.tenantId ||
    input?.context?.tenantId ||
    input?.knownContext?.tenantId ||
    input?.requestContext?.tenantId ||
    null
  );
}

function buildPolicyBlocked(reason, details = {}) {
  return {
    success: false,
    error: 'sidecar_policy_blocked',
    reason,
    ...details,
  };
}

function isForbiddenTargetAction(actionName) {
  const action = String(actionName || '');
  return FORBIDDEN_TARGET_PATTERNS.some((pattern) => pattern.test(action));
}

function assertToolAllowed(tool, ctx, input = {}) {
  const validation = validateToolDefinition(tool);
  if (!validation.valid) {
    return buildPolicyBlocked('invalid_tool_definition', { validationErrors: validation.errors });
  }

  const tokenScope = ctx?.meta?.apiToken?.scope || ctx?.meta?.authUser?.scope || null;
  if (!tokenScope) {
    return buildPolicyBlocked('auth_required', {
      requiredScope: tool.requiredScope,
    });
  }
  if (!['read-only', 'full-access'].includes(tokenScope)) {
    return buildPolicyBlocked('unsupported_token_scope', { tokenScope });
  }

  const authTenant = getAuthenticatedTenant(ctx);
  const contextTenant = normalizeContextTenant(input);
  if (authTenant && contextTenant && authTenant !== contextTenant) {
    return buildPolicyBlocked('tenant_mismatch', {
      authTenant,
      contextTenant,
      tenantPolicy: tool.tenantPolicy,
    });
  }

  if (isForbiddenTargetAction(tool.targetAction)) {
    return buildPolicyBlocked('forbidden_target_action', { targetAction: tool.targetAction });
  }

  return null;
}

function assertHydrationActionAllowed(actionName) {
  const action = String(actionName || '').trim();
  if (!action) {
    return buildPolicyBlocked('target_action_required');
  }
  if (isForbiddenTargetAction(action)) {
    return buildPolicyBlocked('forbidden_target_action', { targetAction: action });
  }

  const rule = getRule(action);
  if (!rule) {
    return buildPolicyBlocked('target_action_not_hydration_allowlisted', { targetAction: action });
  }

  return null;
}

module.exports = {
  assertHydrationActionAllowed,
  assertToolAllowed,
  buildPolicyBlocked,
  getAuthenticatedTenant,
};
