'use strict';

const { GLOBAL_DO_NOT_USE, CURATED_CAPABILITIES } = require('./capability-catalog');
const { evaluateGovernancePolicy } = require('./governance-policy-evaluator');
const { principal, deny } = require('./domain-router-policy');
const { compareCanonicalStrings } = require('./canonical-order');

const internalEffects = new Set([
  'creates_draft_or_intent',
  'internal_case_state',
  'internal_event_outbox',
  'internal_case_link',
]);
const readKinds = new Set(['data_read', 'dashboard_read']);

function policyReason(operation) {
  if (!operation?.action || operation.agentable !== true) return 'not_agentable';
  if (GLOBAL_DO_NOT_USE.some((entry) => entry.action === operation.action)) return 'no_call';
  if (!['none', 'low'].includes(operation.consequenceLevel)) return 'consequence';
  if (!Array.isArray(operation.sideEffects)) return 'unknown_effect';
  if (operation.sideEffects.some((effect) => !internalEffects.has(effect))) return 'effect';
  if (
    !['data_read', 'dashboard_read', 'advisory_plan', 'draft_write'].includes(
      operation.operationKind
    )
  )
    return 'operation_kind';
  return null;
}

function deriveMandate(fn, operations) {
  return {
    operations: operations
      .filter((op) => fn.operations?.includes(op.action) && !policyReason(op))
      .map((op) => op.operationId)
      .sort(compareCanonicalStrings),
    capabilities: [...(fn.capabilities || [])],
    dataSources: [...(fn.dataSources || [])],
    events: structuredClone(fn.events || { emits: [], listens: [] }),
  };
}

function assertOperation(operation, fn, ctx, input = {}) {
  const reason = policyReason(operation);
  if (reason) deny(reason);
  principal(ctx, input);
  if (!fn.operations?.includes(operation.action)) deny('outside_mandate');
  const auth = ctx.meta.authUser || ctx.meta.apiToken;
  const scopes = new Set([auth.scope, ...(auth.scopes || [])]);
  const read = readKinds.has(operation.operationKind);
  if (
    !scopes.has('full-access') &&
    !(read && scopes.has('read-only')) &&
    !(
      operation.requiredScopes?.length &&
      operation.requiredScopes.every((scope) => scopes.has(scope))
    )
  )
    deny('scope_required');
  for (const capability of CURATED_CAPABILITIES.filter((entry) =>
    fn.capabilities?.includes(entry.capability)
  )) {
    if (
      !capability.preferredActions?.includes(operation.action) &&
      !capability.fallbackActions?.includes(operation.action)
    )
      continue;
    const decision = evaluateGovernancePolicy({
      capability,
      action: operation.action,
      context: input,
    });
    if (!decision.allowed) deny(decision.reason);
  }
  if (
    operation.parameters?.required?.some(
      (param) => !['tenantId'].includes(param.name) && input[param.name] === undefined
    )
  )
    deny('missing_parameters');
}

function assertReadObservation(operation, fn, ctx, input, broker) {
  if (!readKinds.has(operation?.operationKind)) deny('read_required');
  assertOperation(operation, fn, ctx, input);
  const split = operation.action.lastIndexOf('.');
  const backend = broker.getLocalService(operation.action.slice(0, split));
  const definition = backend?.schema.actions?.[operation.action.slice(split + 1)];
  const p = principal(ctx, input);
  if (
    definition?.requiredRoles?.length &&
    !definition.requiredRoles.some((r) => p.roles.includes(r))
  )
    deny('Role required');
}

module.exports = { policyReason, deriveMandate, assertOperation, assertReadObservation, readKinds };
