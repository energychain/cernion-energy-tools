'use strict';

/**
 * Blueprint → read-only REST plan compiler (issue energychain/cernion-energy-tools#271).
 *
 * Deliberately separate from src/l2-blueprint-interpreter.js (executeBlueprint) and
 * src/l3-broker.js (buildBlueprintPlan): those two power the existing internal
 * personal-agent.chat routing pipeline, which executes blueprint steps server-side.
 * This module never executes anything — it only resolves a single read-only step
 * into a `{ method, path, query }` plan for an external Sidecar to run itself via
 * its own generic GET-only REST proxy. Keeping it separate means the internal
 * execution path is untouched by this feature.
 *
 * Only blueprints flagged `routing.restPlanOnly: true` are considered (see
 * detectBlueprintIntent's includeRestPlanOnly option) — this keeps action-name
 * templating (e.g. "assets.{{inputs.assetType}}", not understood by executeBlueprint)
 * out of the internal chat-routing match set.
 */

const { detectBlueprintIntent } = require('./l3-broker');
const { loadBlueprint } = require('./blueprint-registry');
const { resolvePathInScope } = require('./l2-blueprint-interpreter');

const ACTION_TEMPLATE_RE = /^[a-zA-Z0-9_-]+\.\{\{\s*inputs\.([a-zA-Z0-9_]+)\s*\}\}$/;
const PARAM_TEMPLATE_RE = /^\{\{\s*([^}]+)\s*\}\}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Resolves canonical inputs from the caller-supplied context against the
// blueprint's `inputs` schema. Mirrors the static_default handling already
// used by buildBlueprintPlan, but keeps native value types (no stringification)
// since the output feeds a JSON `query` object, not a templated action call.
function resolveCanonicalInputs(blueprint, context) {
  const inputs = blueprint.inputs || {};
  const canonicalInputs = {};
  const missing = [];

  for (const [key, inputDef] of Object.entries(inputs)) {
    let value = context?.[key];
    if (value == null && inputDef.resolveStrategy?.method === 'static_default') {
      value = inputDef.resolveStrategy.defaultValue;
    }
    if (value == null && inputDef.semanticType === 'OEO:PostalCode') {
      value = context?.postalCode ?? context?.postleitzahl ?? context?.location ?? null;
    }
    if (value != null && inputDef.type === 'number' && typeof value !== 'number') {
      const n = Number(value);
      value = Number.isNaN(n) ? value : n;
    }
    canonicalInputs[key] = value ?? null;
    if (inputDef.required === true && canonicalInputs[key] == null) {
      missing.push(key);
    }
  }

  return { canonicalInputs, missing };
}

// Resolves "assets.{{inputs.assetType}}" → "assets.solar" using canonicalInputs.
// Plain (non-templated) action strings pass through unchanged.
function resolveActionName(actionTemplate, canonicalInputs) {
  const match = ACTION_TEMPLATE_RE.exec(String(actionTemplate || ''));
  if (!match) return actionTemplate;
  const value = canonicalInputs[match[1]];
  if (value == null) return null;
  return actionTemplate.replace(/\{\{\s*inputs\.[a-zA-Z0-9_]+\s*\}\}/, String(value));
}

// Finds the live REST registration (method + relative path) for a fully-qualified
// action name (e.g. "assets.solar") via the broker's service registry — the same
// source services/cookbook.service.js#getActionRegistry uses.
function findActionRestRegistration(broker, fullActionName) {
  const [serviceName, ...rest] = String(fullActionName || '').split('.');
  if (!serviceName || rest.length === 0) return null;

  const services = broker.registry.getServiceList({ withActions: true });
  for (const service of services) {
    if (service.name !== serviceName || !service.actions) continue;
    const action = service.actions[fullActionName] || service.actions[rest.join('.')];
    if (!action || !action.rest) continue;

    let method = 'POST';
    let relPath = '/';
    if (typeof action.rest === 'string') {
      const parts = action.rest.trim().split(/\s+/);
      method = (parts[0] || 'POST').toUpperCase();
      relPath = parts[1] || '/';
    } else if (typeof action.rest === 'object') {
      method = (action.rest.method || 'POST').toUpperCase();
      relPath = action.rest.path || '/';
    }

    // Convention used throughout this codebase: a service named "assets" is
    // mounted at /api/assets unless services/api.service.js declares an explicit
    // alias override. This compiler does not consult the alias map — fixtures
    // relying on an aliased path need their own override here.
    return { method, path: `/api/${serviceName}${relPath}` };
  }
  return null;
}

// Renders a single step.params value ("{{inputs.X}}") against canonicalInputs,
// preserving the resolved value's native type. Returns undefined for unset
// optional inputs so they are omitted from the compiled query instead of
// appearing as null/"undefined".
function resolveParamValue(template, canonicalInputs) {
  if (typeof template !== 'string') return template;
  const match = PARAM_TEMPLATE_RE.exec(template.trim());
  if (!match) return template;
  return resolvePathInScope(match[1].trim(), { inputs: canonicalInputs });
}

/**
 * Attempts to compile a natural-language ask request into a read-only REST plan.
 *
 * @param {object} opts
 * @param {string} opts.question - free-text question (matched against blueprint routing signals)
 * @param {object} [opts.context] - canonical input values (e.g. { assetType, location, minCapacity, ... })
 * @param {object} opts.broker - Moleculer broker instance (for live action/REST lookup)
 * @returns {object} `{ ok: true, resolved, canonicalInputs, execution, policy, confidence }`
 *                    or `{ ok: false, reason, ...details }`
 */
function compileReadOnlyExecutionPlan({ question, context = {}, broker }) {
  // Fail soft, not hard: some callers (unit tests stubbing ctx, degraded broker
  // states) won't have a live registry available. Read-only plan compilation is
  // an optional enhancement on top of the existing evidence-planner fallback, so
  // it must never crash askCernionAgent — it just reports no plan available.
  if (!broker || !broker.registry) {
    return { ok: false, reason: 'broker_unavailable' };
  }

  const match = detectBlueprintIntent(question, context, {}, { includeRestPlanOnly: true });
  if (!match) {
    return { ok: false, reason: 'no_blueprint_match' };
  }

  const blueprint = loadBlueprint(match.blueprintId);
  if (!blueprint || blueprint.routing?.restPlanOnly !== true) {
    return { ok: false, reason: 'no_blueprint_match' };
  }

  const { canonicalInputs, missing } = resolveCanonicalInputs(blueprint, context);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing_required_inputs',
      blueprintId: blueprint.id,
      missing,
    };
  }

  const step = (blueprint.execution?.steps || [])[0];
  if (!step) {
    return { ok: false, reason: 'no_executable_step', blueprintId: blueprint.id };
  }

  const resolvedAction = resolveActionName(step.action, canonicalInputs);
  if (!resolvedAction) {
    return { ok: false, reason: 'action_not_resolvable', blueprintId: blueprint.id };
  }

  const restRegistration = findActionRestRegistration(broker, resolvedAction);
  if (!restRegistration) {
    return {
      ok: false,
      reason: 'action_not_found',
      blueprintId: blueprint.id,
      action: resolvedAction,
    };
  }

  if (restRegistration.method !== 'GET') {
    return {
      ok: false,
      reason: 'not_read_only',
      blueprintId: blueprint.id,
      action: resolvedAction,
      method: restRegistration.method,
    };
  }

  const query = {};
  if (isPlainObject(step.params)) {
    for (const [key, template] of Object.entries(step.params)) {
      const value = resolveParamValue(template, canonicalInputs);
      if (value != null && value !== '') query[key] = value;
    }
  }

  return {
    ok: true,
    resolved: {
      kind: 'blueprint',
      id: blueprint.id,
      version: blueprint.version,
      source: 'blueprint_runtime',
    },
    canonicalInputs,
    execution: {
      mode: 'read_only_rest_plan',
      method: 'GET',
      path: restRegistration.path,
      query,
    },
    policy: {
      readOnly: true,
      sideEffects: 'none',
      tenantScoped: true,
      externalSideEffects: false,
    },
    confidence: match.score >= 4 ? 'high' : 'medium',
  };
}

// Turns a `{ ok: false, reason, ... }` result into a human-readable explanation
// for the "no plan available" fallback path (issue #271 acceptance criteria).
function describeNoPlanReason(result) {
  switch (result?.reason) {
    case 'no_blueprint_match':
      return 'No active read-only Blueprint matched this request; routed through the standard evidence planner instead.';
    case 'broker_unavailable':
      return 'No live action registry was available to resolve a read-only plan; routed through the standard evidence planner instead.';
    case 'missing_required_inputs':
      return `Blueprint "${result.blueprintId}" matched, but required inputs were missing: ${(result.missing || []).join(', ')}.`;
    case 'not_read_only':
      return `Blueprint "${result.blueprintId}" matched, but its resolved action ("${result.action}", ${result.method}) is not read-only — no execution plan is returned for safety.`;
    case 'action_not_found':
      return `Blueprint "${result.blueprintId}" matched, but its resolved action ("${result.action}") is not currently registered.`;
    case 'action_not_resolvable':
    case 'no_executable_step':
      return `Blueprint "${result.blueprintId}" matched, but no executable read-only step could be resolved.`;
    default:
      return 'No executable read-only plan is available for this request.';
  }
}

module.exports = {
  compileReadOnlyExecutionPlan,
  describeNoPlanReason,
};
