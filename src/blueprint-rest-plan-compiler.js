'use strict';

/**
 * Blueprint → read-only endpoint recommendation compiler
 * (issue energychain/cernion-energy-tools#271, architecture follow-up:
 * https://github.com/energychain/cernion-energy-tools/issues/271#issuecomment-4786658464).
 *
 * Deliberately separate from src/l2-blueprint-interpreter.js (executeBlueprint) and
 * src/l3-broker.js (buildBlueprintPlan): those two power the existing internal
 * personal-agent.chat routing pipeline, which executes blueprint steps server-side.
 * This module never executes anything — it only resolves a Blueprint's read-only
 * steps into `{ method, path, query, resultSemantics }` endpoint *recommendations*
 * for an external Sidecar/orchestrator to execute and interpret itself. Keeping it
 * separate means the internal execution path is untouched by this feature.
 *
 * Per the architecture follow-up: this is an endpoint-recommendation / evidence-
 * discovery contract, not an answer-transformation one. A blueprint may resolve to
 * MULTIPLE complementary read-only endpoints (one per execution.steps[] entry —
 * each is resolved and reported independently; an unresolvable step is skipped, not
 * fatal, as long as at least one step resolves). Endpoints may legitimately return
 * complete tables/result sets; this module never filters or synthesizes over the
 * data those endpoints would return — only the consuming agent/orchestrator does.
 *
 * `routing.restPlanOnly: true` blueprints are included in matching via
 * detectBlueprintIntent's includeRestPlanOnly option. The flag is a routing
 * isolation signal, not a safety gate: runtime-managed blueprints may omit it,
 * so plan emission is guarded by each resolved live REST action being GET-only.
 */

const { detectBlueprintIntent } = require('./l3-broker');
const { listBlueprints, loadBlueprint } = require('./blueprint-registry');
const { resolvePathInScope } = require('./l2-blueprint-interpreter');

const ACTION_TEMPLATE_RE = /^[a-zA-Z0-9_-]+\.\{\{\s*inputs\.([a-zA-Z0-9_]+)\s*\}\}$/;
const PARAM_TEMPLATE_RE = /^\{\{\s*([^}]+)\s*\}\}$/;
const INPUT_REF_RE = /\{\{\s*inputs\.([a-zA-Z0-9_]+)\s*\}\}/g;
const POSTAL_CODE_RE = /\b\d{5}\b/;
const YEAR_RE = /\b(20\d{2}|19\d{2})\b/;

function normalizeSignalText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deriveInputHintsFromQuestion(question) {
  const text = String(question || '');
  const haystack = text.toLowerCase();
  const hints = {};

  const postalCode = POSTAL_CODE_RE.exec(text)?.[0];
  if (postalCode) hints.location = postalCode;

  if (/\b(solar|pv|photovoltaik|solaranlage|solaranlagen)\b/i.test(text)) {
    hints.assetType = 'solar';
  } else if (/\b(wind|windanlage|windanlagen)\b/i.test(text)) {
    hints.assetType = 'wind';
  }

  const betweenKw = haystack.match(
    /zwischen\s+(\d+(?:[.,]\d+)?)\s*(?:und|-)\s*(\d+(?:[.,]\d+)?)\s*kw\b/
  );
  if (betweenKw) {
    hints.minCapacity = Number(betweenKw[1].replace(',', '.'));
    hints.maxCapacity = Number(betweenKw[2].replace(',', '.'));
  }

  const year = YEAR_RE.exec(text)?.[1];
  if (year) hints.commissioningYear = Number(year);

  return hints;
}

function blueprintHasNegativeSignal(blueprint, question, context = {}) {
  const negativeSignals = blueprint?.routing?.negativeSignals;
  if (!Array.isArray(negativeSignals) || negativeSignals.length === 0) return false;
  const haystack = normalizeSignalText(`${question || ''} ${JSON.stringify(context || {})}`);
  return negativeSignals.some((signal) => {
    const normalized = normalizeSignalText(signal);
    return normalized && haystack.includes(normalized);
  });
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

// Resolves one execution.steps[] entry into a read-only endpoint recommendation,
// or a `{ ok: false, reason, ... }` skip reason. Never throws — an unresolvable
// step is reported so the caller can skip it without failing the whole blueprint.
function resolveStepToEndpoint(step, canonicalInputs, broker) {
  const resolvedAction = resolveActionName(step.action, canonicalInputs);
  if (!resolvedAction) {
    return { ok: false, reason: 'action_not_resolvable' };
  }

  const restRegistration = findActionRestRegistration(broker, resolvedAction);
  if (!restRegistration) {
    return { ok: false, reason: 'action_not_found', action: resolvedAction };
  }

  if (restRegistration.method !== 'GET') {
    return {
      ok: false,
      reason: 'not_read_only',
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

  const endpoint = { method: 'GET', path: restRegistration.path, query };
  // Fachliche Bedeutung des Result-Sets (architecture follow-up): what evidence
  // kind this endpoint returns (asset_list, timeseries, market_signal, ...) and a
  // human-readable description — declared per-step in the blueprint definition,
  // never inferred here.
  if (isPlainObject(step.resultSemantics)) {
    endpoint.resultSemantics = step.resultSemantics;
  }
  return { ok: true, endpoint };
}

function countProvidedInputRefs(step, planningContext) {
  const refs = new Set();
  const values = [step?.action, ...Object.values(isPlainObject(step?.params) ? step.params : {})];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(INPUT_REF_RE)) {
      const key = match[1];
      if (planningContext?.[key] != null && planningContext[key] !== '') {
        refs.add(key);
      }
    }
  }

  return refs.size;
}

function findSingleStructuredInputBlueprint(planningContext, broker) {
  const candidates = [];

  for (const summary of listBlueprints()) {
    const blueprint = loadBlueprint(summary.id);
    if (!blueprint) continue;

    const { canonicalInputs, missing } = resolveCanonicalInputs(blueprint, planningContext);
    if (missing.length > 0) continue;

    const step = (blueprint.execution?.steps || [])[0];
    if (!step) continue;

    const resolvedAction = resolveActionName(step.action, canonicalInputs);
    if (!resolvedAction) continue;

    const restRegistration = findActionRestRegistration(broker, resolvedAction);
    if (!restRegistration || restRegistration.method !== 'GET') continue;

    const inputRefCount = countProvidedInputRefs(step, planningContext);
    if (inputRefCount === 0) continue;

    candidates.push({ blueprint, inputRefCount });
  }

  candidates.sort((a, b) => b.inputRefCount - a.inputRefCount);
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && candidates[0].inputRefCount === candidates[1].inputRefCount) {
    return null;
  }
  return candidates[0].blueprint;
}

/**
 * Attempts to compile a natural-language ask request into a read-only REST plan.
 *
 * @param {object} opts
 * @param {string} opts.question - free-text question (matched against blueprint routing signals)
 * @param {object} [opts.context] - canonical input values (e.g. { assetType, location, minCapacity, ... })
 * @param {object} opts.broker - Moleculer broker instance (for live action/REST lookup)
 * @returns {object} `{ ok: true, resolved, canonicalInputs, recommendedEndpoints, execution, policy, confidence }`
 *                    or `{ ok: false, reason, ...details }`. `execution` mirrors
 *                    `recommendedEndpoints[0]` for backward compatibility with #271
 *                    consumers that only read a single plan.
 */
function compileReadOnlyExecutionPlan({ question, context = {}, broker }) {
  // Fail soft, not hard: some callers (unit tests stubbing ctx, degraded broker
  // states) won't have a live registry available. Read-only plan compilation is
  // an optional enhancement on top of the existing evidence-planner fallback, so
  // it must never crash askCernionAgent — it just reports no plan available.
  if (!broker || !broker.registry) {
    return { ok: false, reason: 'broker_unavailable' };
  }

  const inputHints = deriveInputHintsFromQuestion(question);
  const planningContext = { ...inputHints, ...context };
  const match = detectBlueprintIntent(question, planningContext, inputHints, {
    includeRestPlanOnly: true,
  });
  const blueprint = match
    ? loadBlueprint(match.blueprintId)
    : findSingleStructuredInputBlueprint(planningContext, broker);
  if (!blueprint) {
    return { ok: false, reason: 'no_blueprint_match' };
  }
  if (blueprintHasNegativeSignal(blueprint, question, planningContext)) {
    return {
      ok: false,
      reason: 'blueprint_negative_signal',
      blueprintId: blueprint.id,
    };
  }

  const { canonicalInputs, missing } = resolveCanonicalInputs(blueprint, planningContext);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'missing_required_inputs',
      blueprintId: blueprint.id,
      missing,
    };
  }

  const steps = blueprint.execution?.steps || [];
  if (steps.length === 0) {
    return { ok: false, reason: 'no_executable_step', blueprintId: blueprint.id };
  }

  // Endpoint-recommendation contract (architecture follow-up): each step is a
  // candidate complementary read-only endpoint, resolved independently. A step
  // that can't be resolved (action not GET-registered, etc.) is skipped, not
  // fatal — the whole blueprint only fails if NONE of its steps resolve.
  const recommendedEndpoints = [];
  const skipped = [];
  for (const step of steps) {
    const resolution = resolveStepToEndpoint(step, canonicalInputs, broker);
    if (resolution.ok) {
      recommendedEndpoints.push(resolution.endpoint);
    } else {
      skipped.push(resolution);
    }
  }

  if (recommendedEndpoints.length === 0) {
    const firstSkip = skipped[0] || { reason: 'action_not_resolvable' };
    return {
      ok: false,
      reason: firstSkip.reason,
      blueprintId: blueprint.id,
      action: firstSkip.action,
      method: firstSkip.method,
    };
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
    recommendedEndpoints,
    execution: { mode: 'read_only_rest_plan', ...recommendedEndpoints[0] },
    policy: {
      readOnly: true,
      sideEffects: 'none',
      tenantScoped: true,
      externalSideEffects: false,
    },
    confidence: (match?.score || 0) >= 4 ? 'high' : 'medium',
  };
}

// Builds the Sidecar-facing askCernionAgent-shaped response for a successful
// compile. Shared by services/agent-sidecar.service.js (fast-path, before
// delegating to askCernionAgent) and services/personal-agent.service.js
// (askCernionAgent itself, for direct/Copilot callers) so both surfaces stay
// in sync — the architecture follow-up to #271 makes the wording explicit:
// this is an endpoint *recommendation*, the consuming agent/orchestrator is
// responsible for executing it and synthesizing the final answer.
function buildAskBlueprintAnswer(restPlan, { question, sessionId } = {}) {
  const endpointShort = restPlan.recommendedEndpoints.map((ep) => `${ep.method} ${ep.path}`);
  const endpointLines = restPlan.recommendedEndpoints.map((ep) => {
    const sem = ep.resultSemantics;
    const semText = sem ? ` — ${sem.kind}: ${sem.description}` : '';
    return `${ep.method} ${ep.path}${semText}`;
  });

  return {
    success: true,
    sessionId: sessionId || null,
    question,
    shortAnswer: `Recommended ${restPlan.recommendedEndpoints.length} read-only endpoint(s) via blueprint ${restPlan.resolved.id}: ${endpointShort.join(', ')}.`,
    groundingAnswer: [
      `Blueprint ${restPlan.resolved.id} (v${restPlan.resolved.version}) recommends the following read-only endpoint(s) as the evidence surface for this request:`,
      ...endpointLines.map((line) => `- ${line}`),
      'Cernion did not execute anything server-side and does not synthesize a final answer from these results — that is the responsibility of the consuming agent/orchestrator.',
    ].join('\n'),
    evidence: [],
    processContext: {},
    openQuestions: [],
    recommendedNextSteps: [
      'Execute the recommended read-only endpoint(s) via the Sidecar REST proxy (e.g. cernion_execute_rest_plan) and synthesize the final answer from the returned evidence.',
    ],
    allowedActions: [],
    forbiddenActions: [],
    confidence: restPlan.confidence,
    resolved: restPlan.resolved,
    canonicalInputs: restPlan.canonicalInputs,
    recommendedEndpoints: restPlan.recommendedEndpoints,
    execution: restPlan.execution,
    policy: restPlan.policy,
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
  deriveInputHintsFromQuestion,
  buildAskBlueprintAnswer,
  // Exported for reuse by src/evidence-router.js (issue #272) — pure resolution
  // utilities, no behavior change to this module's own callers.
  resolveActionName,
  findActionRestRegistration,
  resolveParamValue,
};
