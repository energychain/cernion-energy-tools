'use strict';

/**
 * Evidence Router (issue energychain/cernion-energy-tools#272).
 *
 * Generic read-only Evidence Router / Lookup-Service contract for foreign
 * orchestrators (OpenClaw, CoPilot, Hermes, ...). Deliberately separate from
 * src/blueprint-rest-plan-compiler.js (#271): that module matches a single
 * Blueprint by NL intent/inputs and compiles its step(s) into a plan — useful
 * when one specific workflow applies, but it can substitute a semantically
 * wrong endpoint when only generic inputs (e.g. a postal code) match and the
 * actually-requested evidence TYPE isn't what that Blueprint provides.
 *
 * This module flips the matching order: it infers which EVIDENCE TYPES
 * (resultKind, e.g. "time_series", "asset_table", "market_signal") the
 * question needs FIRST, then looks those kinds up in the curated
 * src/evidence-endpoint-catalog.js. If no catalog entry covers a required
 * evidence type, that type is reported as missing — never substituted with
 * an unrelated endpoint (`coverage.noSubstitution` is always true).
 *
 * Like #271, this module never executes anything and never synthesizes a
 * final answer — it only recommends read-only endpoints and describes what
 * each one's result means fachlich. Process Intake (the write/process
 * boundary) is a completely separate contract — see
 * services/copilot-process.service.js#prepareProcessIntent. This module must
 * never be used to classify or accept write/process intent.
 */

const { EVIDENCE_ENDPOINT_CATALOG } = require('./evidence-endpoint-catalog');
const { deriveInputHintsFromQuestion } = require('./blueprint-rest-plan-compiler');
const {
  resolveActionName,
  findActionRestRegistration,
  resolveParamValue,
} = require('./blueprint-rest-plan-compiler');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Default time window (now → +24h, ISO date strings) applied only when a
// catalog entry needs dateFrom/dateTo and the caller didn't supply them —
// lets a generic "evidence for the next day" request resolve without
// forcing the orchestrator to compute exact dates itself.
function applyDateRangeDefaults(requiredInputs, context) {
  const needsDateFrom = requiredInputs.includes('dateFrom') && context.dateFrom == null;
  const needsDateTo = requiredInputs.includes('dateTo') && context.dateTo == null;
  if (!needsDateFrom && !needsDateTo) return context;

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return {
    ...context,
    dateFrom: context.dateFrom ?? now.toISOString().slice(0, 10),
    dateTo: context.dateTo ?? tomorrow.toISOString().slice(0, 10),
  };
}

// Infers required evidence types (resultKind values) purely from
// evidence-specific vocabulary (forecast/CO2/Preis/Zeitreihe/...), never from
// generic inputs like location or capacity — that vocabulary-only matching is
// precisely what caused the reported substitution bug.
function inferRequiredEvidenceTypes(question) {
  const haystack = String(question || '').toLowerCase();
  const kinds = new Set();

  for (const entry of EVIDENCE_ENDPOINT_CATALOG) {
    const hit = (entry.evidenceTypeSignals || []).some((signal) => {
      try {
        return new RegExp(signal, 'i').test(haystack);
      } catch (_err) {
        return haystack.includes(String(signal).toLowerCase());
      }
    });
    if (hit) kinds.add(entry.resultKind);
  }

  return [...kinds];
}

function resolveCatalogEntryInputs(entry, context) {
  const allKeys = [...(entry.requiredInputs || []), ...(entry.optionalInputs || [])];
  const effectiveContext = applyDateRangeDefaults(entry.requiredInputs || [], context);
  const canonicalInputs = {};
  const missing = [];

  for (const key of allKeys) {
    let value = effectiveContext?.[key];
    if (value == null && entry.inputDefaults && entry.inputDefaults[key] != null) {
      value = entry.inputDefaults[key];
    }
    canonicalInputs[key] = value ?? null;
    if ((entry.requiredInputs || []).includes(key) && canonicalInputs[key] == null) {
      missing.push(key);
    }
  }

  return { canonicalInputs, missing };
}

// Resolves one catalog entry into a recommended endpoint, or a skip reason.
// Mirrors src/blueprint-rest-plan-compiler.js#resolveStepToEndpoint, but never
// requires the resolved action's REST method to be GET — read-only is already
// established by the catalog's curation (see evidence-endpoint-catalog.js).
function resolveCatalogEntryToEndpoint(entry, context, broker) {
  const { canonicalInputs, missing } = resolveCatalogEntryInputs(entry, context);
  if (missing.length > 0) {
    return { ok: false, reason: 'missing_required_inputs', missing };
  }

  const resolvedAction = resolveActionName(entry.action, canonicalInputs);
  if (!resolvedAction) {
    return { ok: false, reason: 'action_not_resolvable' };
  }

  const restRegistration = findActionRestRegistration(broker, resolvedAction);
  if (!restRegistration) {
    return { ok: false, reason: 'action_not_found', action: resolvedAction };
  }

  const query = {};
  if (isPlainObject(entry.params)) {
    for (const [key, template] of Object.entries(entry.params)) {
      const value = resolveParamValue(template, canonicalInputs);
      if (value != null && value !== '') query[key] = value;
    }
  }

  return {
    ok: true,
    endpoint: {
      purpose: entry.id,
      method: restRegistration.method,
      path: restRegistration.path,
      query,
      resultKind: entry.resultKind,
      semanticFacts: entry.semanticFacts || [],
      freshness: entry.freshness || null,
      granularity: entry.granularity || null,
      timeRangeSupport: Boolean(entry.timeRangeSupport),
      requiredInputs: entry.requiredInputs || [],
      optionalInputs: entry.optionalInputs || [],
      policy: {
        readOnly: true,
        sideEffects: 'none',
        tenantScoped: true,
        externalSideEffects: false,
      },
    },
  };
}

/**
 * Routes a request to one or more recommended read-only evidence endpoints.
 *
 * @param {object} opts
 * @param {string} opts.question - free-text request
 * @param {object} [opts.context] - canonical input values (location, dateFrom, ...)
 * @param {object} opts.broker - Moleculer broker instance (for live action/REST lookup)
 * @returns {object} Evidence Router response contract (see issue #272):
 *   { success, resolved: { kind: 'evidence_plan', source: 'evidence_router' },
 *     requiredEvidenceTypes, recommendedEndpoints, coverage, nextStep }
 */
function routeEvidence({ question, context = {}, broker }) {
  if (!broker || !broker.registry) {
    return {
      success: false,
      error: 'broker_unavailable',
      message: 'No live action registry was available to resolve evidence endpoints.',
    };
  }

  const inputHints = deriveInputHintsFromQuestion(question);
  const planningContext = { ...inputHints, ...context };

  const requiredEvidenceTypes = inferRequiredEvidenceTypes(question);

  const recommendedEndpoints = [];
  const coveredEvidenceTypes = new Set();

  for (const kind of requiredEvidenceTypes) {
    const candidates = EVIDENCE_ENDPOINT_CATALOG.filter((entry) => entry.resultKind === kind);
    for (const entry of candidates) {
      const resolution = resolveCatalogEntryToEndpoint(entry, planningContext, broker);
      if (resolution.ok) {
        recommendedEndpoints.push(resolution.endpoint);
        coveredEvidenceTypes.add(kind);
      }
    }
  }

  const missingEvidenceTypes = requiredEvidenceTypes.filter(
    (kind) => !coveredEvidenceTypes.has(kind)
  );

  const nextStep =
    recommendedEndpoints.length > 0
      ? 'The consuming agent should execute the recommended read-only endpoints and transform the returned evidence into the user-facing answer. Cernion does not execute these endpoints or synthesize an answer itself.'
      : 'No catalog entry covers the inferred evidence type(s) for this request. Cernion does not substitute an unrelated endpoint — refine the request or extend the evidence endpoint catalog.';

  return {
    success: true,
    resolved: { kind: 'evidence_plan', source: 'evidence_router' },
    requiredEvidenceTypes,
    recommendedEndpoints,
    coverage: {
      coveredEvidenceTypes: [...coveredEvidenceTypes],
      missingEvidenceTypes,
      noSubstitution: true,
    },
    nextStep,
  };
}

module.exports = {
  routeEvidence,
  inferRequiredEvidenceTypes,
};
