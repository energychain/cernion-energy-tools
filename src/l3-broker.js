'use strict';

/**
 * L3 Broker — Blueprint-Driven Intent Resolution
 *
 * Phase 3: Replaces hardcoded isDirectEvCo2ChargingRequest / buildDirectEvCo2ChargingPlan
 * in personal-agent-routing.js. The L3 layer no longer contains any domain-specific
 * regex or plan templates. All domain knowledge lives in the blueprint registry.
 *
 * Contract:
 *   detectBlueprintIntent(message, knownContext, promptHints) → null | { blueprintId, score }
 *   buildBlueprintPlan(blueprintId, opts) → execution plan object (same shape as routing matrix)
 */

const { loadBlueprint, listBlueprints } = require('./blueprint-registry');

// Minimum positive signal hits required to trigger a blueprint match
const MATCH_THRESHOLD = 2;

// Common semantic prefixes that should be treated as aliases for the base key name.
// e.g. "gridCapacityKW" and "requestedCapacityKW" both normalise to "capacitykw".
const KEY_NORMALIZE_PREFIXES = ['grid', 'requested'];

/**
 * Strips one leading semantic prefix (camelCase boundary) and lowercases.
 * "gridCapacityKW" → "capacitykw", "requestedCapacityKW" → "capacitykw"
 */
function _normalizeKey(key) {
  for (const prefix of KEY_NORMALIZE_PREFIXES) {
    if (
      key.length > prefix.length &&
      key.slice(0, prefix.length).toLowerCase() === prefix &&
      key[prefix.length] === key[prefix.length].toUpperCase()
    ) {
      return key.slice(prefix.length).toLowerCase();
    }
  }
  return key.toLowerCase();
}

/**
 * Resolves a value for `key` across one or more source objects.
 * First tries an exact key match, then falls back to normalised-key comparison
 * so aliases like "gridCapacityKW" / "requestedCapacityKw" all resolve "capacityKW".
 */
function _resolveAliasedKey(key, ...sources) {
  const normalizedTarget = _normalizeKey(key);
  for (const src of sources) {
    if (!src) continue;
    if (src[key] != null) return src[key];
    for (const [k, v] of Object.entries(src)) {
      if (v != null && _normalizeKey(k) === normalizedTarget) return v;
    }
  }
  return null;
}

/**
 * Coerces a value to number.
 * Handles numeric strings like "250" or "250 kW" (parseFloat stops at first non-numeric char).
 */
function _coerceToNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

function _buildHaystack(message, knownContext) {
  return [message, knownContext?.intent, knownContext?.domainIntent, knownContext?.topic]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function _hasKnownLocation(knownContext, promptHints) {
  return Boolean(
    promptHints?.postalCode ||
    promptHints?.postleitzahl ||
    promptHints?.city ||
    promptHints?.location ||
    knownContext?.postalCode ||
    knownContext?.postleitzahl ||
    knownContext?.city ||
    knownContext?.location
  );
}

function _scoreBlueprintMatch(haystack, blueprint) {
  const signals = blueprint.routing?.intentSignals;
  const negativeSignals = blueprint.routing?.negativeSignals;
  if (!Array.isArray(signals)) return 0;

  if (Array.isArray(negativeSignals)) {
    for (const neg of negativeSignals) {
      if (haystack.includes(String(neg).toLowerCase())) return 0;
    }
  }

  let hits = 0;
  for (const signal of signals) {
    if (haystack.includes(String(signal).toLowerCase())) hits++;
  }

  const boost =
    typeof blueprint.routing?.priorityBoost === 'number' ? blueprint.routing.priorityBoost : 0;

  return hits > 0 ? hits + boost * 0.1 : 0;
}

function _requiresLocation(blueprint) {
  const inputs = blueprint.inputs || {};
  return Object.values(inputs).some(
    (def) => def.required === true && def.semanticType === 'OEO:PostalCode'
  );
}

/**
 * Derives a routing-compatible primaryIntent key from a blueprint ID.
 * 'ev-charging-co2-optimization-v1' → 'ev_charging_co2_optimization'
 */
function _derivePrimaryIntent(blueprintId) {
  return blueprintId.replace(/-v\d+(\.\d+)*$/, '').replace(/-/g, '_');
}

/**
 * Build the paramsTemplate from blueprint inputs + current context.
 * Returns an object compatible with what buildDirectEvCo2ChargingPlan used to produce.
 */
function _buildParamsTemplate(blueprint, knownContext, promptHints) {
  const inputs = blueprint.inputs || {};
  const params = {};
  const missing = [];

  for (const [key, inputDef] of Object.entries(inputs)) {
    if (inputDef.semanticType === 'OEO:PostalCode') {
      params.postalCode =
        knownContext?.postalCode ||
        knownContext?.postleitzahl ||
        promptHints?.postalCode ||
        promptHints?.postleitzahl ||
        null;
    } else if (
      inputDef.resolveStrategy?.method === 'static_default' &&
      inputDef.resolveStrategy?.defaultValue !== undefined
    ) {
      params[key] = inputDef.resolveStrategy.defaultValue;
    } else {
      let value = _resolveAliasedKey(key, knownContext, promptHints);
      if (inputDef.type === 'number' && value !== null) {
        value = _coerceToNumber(value);
      }
      params[key] = value;
    }

    if (inputDef.required === true) {
      const isMissing = inputDef.semanticType === 'OEO:PostalCode'
        ? params.postalCode == null
        : params[key] == null;
      if (isMissing) {
        missing.push(key);
      }
    }
  }

  // city is conveyed alongside postalCode for grounding checks
  params.city =
    knownContext?.city ||
    knownContext?.location ||
    promptHints?.city ||
    promptHints?.location ||
    null;

  return { params, missing };
}

/**
 * Detect if any registered blueprint matches the user's intent.
 * Returns null if no match; otherwise returns { blueprintId, score }.
 */
function detectBlueprintIntent(message, knownContext = {}, promptHints = {}) {
  const haystack = _buildHaystack(message, knownContext);
  const blueprints = listBlueprints();

  let best = null;
  for (const summary of blueprints) {
    const blueprint = loadBlueprint(summary.id);
    if (!blueprint) continue;

    // Skip if blueprint requires a location but none is available
    if (_requiresLocation(blueprint) && !_hasKnownLocation(knownContext, promptHints)) {
      continue;
    }

    const score = _scoreBlueprintMatch(haystack, blueprint);
    if (score >= MATCH_THRESHOLD) {
      if (!best || score > best.score) {
        best = { blueprintId: blueprint.id, score };
      }
    }
  }

  return best;
}

/**
 * Derive which step IDs are required for synthesis (referenced in synthesis.evidenceRequired).
 * Only these steps are included in the L3 routing plan — extra context steps (like price lookups)
 * are used by the L2 interpreter but should not pollute the L3 routing execution.
 */
function _requiredStepIds(blueprint) {
  const refs = Array.isArray(blueprint.synthesis?.evidenceRequired)
    ? blueprint.synthesis.evidenceRequired
    : [];
  const ids = new Set();
  for (const ref of refs) {
    const m = ref.match(/^steps\.([^.]+)\./);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/**
 * Build an execution plan object from a blueprint, equivalent in shape to
 * what buildDirectEvCo2ChargingPlan() used to produce. The caller
 * (buildExecutionPlan in personal-agent-routing.js) attaches evidencePlan.
 *
 * Only steps referenced in synthesis.evidenceRequired are included in the
 * routing plan — this preserves backward compatibility with the routing layer
 * while keeping optional context steps (e.g. price lookups) out of L3 routing.
 */
function buildBlueprintPlan(blueprintId, { knownContext = {}, promptHints = {} } = {}) {
  const blueprint = loadBlueprint(blueprintId);
  if (!blueprint) {
    throw new Error(`[l3-broker] Blueprint not found: ${blueprintId}`);
  }

  const primaryIntent = _derivePrimaryIntent(blueprintId);
  const { params: paramsTemplate, missing } = _buildParamsTemplate(blueprint, knownContext, promptHints);

  const requiredIds = _requiredStepIds(blueprint);
  const allSteps = blueprint.execution?.steps || [];
  // Only include evidence-required steps; fall back to all steps if none declared
  const filteredSteps =
    requiredIds.size > 0 ? allSteps.filter((bpStep) => requiredIds.has(bpStep.id)) : allSteps;

  const steps = filteredSteps.map((bpStep, index) => ({
    step: index + 1,
    action: bpStep.action,
    purpose: bpStep.id
      ? `Blueprint step '${bpStep.id}' via ${blueprintId}`
      : `Blueprint step ${index + 1} via ${blueprintId}`,
    paramsTemplate,
    source: `blueprint:${blueprintId}`,
    hitlRequired: false,
    criticalityClass: null,
  }));

  const status = missing.length > 0 ? 'missing_inputs' : 'ready';
  const warnings = missing.length > 0 ? [`Missing required inputs: ${missing.join(', ')}`] : [];

  return {
    source: 'blueprint-broker',
    routeKey: `blueprint_${primaryIntent}`,
    routeLabel: blueprint.meta?.title || blueprintId,
    primaryIntent,
    secondaryIntents: [],
    requestedDomains: [],
    unsupportedDomains: [],
    steps,
    status,
    warnings,
    promptHints,
    missingRequiredInputs: missing,
    capability: {
      capability: primaryIntent,
      intent: primaryIntent,
      preferredActions: steps.map((s) => s.action),
    },
  };
}

module.exports = {
  detectBlueprintIntent,
  buildBlueprintPlan,
  _derivePrimaryIntent,
  _scoreBlueprintMatch,
  _requiredStepIds,
  _normalizeKey,
  _resolveAliasedKey,
  _coerceToNumber,
  MATCH_THRESHOLD,
};
