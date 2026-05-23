'use strict';

/**
 * Evidence Planner — Phase 1 (read-only sidecar).
 *
 * Pure function module.  Takes a routing plan and the current knownContext,
 * looks up evidence requirements from the Evidence Registry, and returns
 * an `evidencePlan` sidecar that annotates:
 *   - which sources are required
 *   - which are already satisfied by knownContext
 *   - which are genuinely missing (gaps)
 *   - an overall confidence score
 *
 * Phase 1 contract:
 *   - NEVER blocks execution.
 *   - NEVER mutates the plan or knownContext.
 *   - Returns `null` when no evidence requirements are registered for the
 *     route/capability (unknown routes are not errors).
 *
 * Phase 2: gap-gate logic will be added here to optionally stop a synthesis
 * turn and surface an evidence_gap_table instead.
 *
 * Phase 3: Falls back to generic tool-coverage planner for unregistered routes.
 */

const { getEvidenceRequirements } = require('./evidence-registry');
const { planGenericToolCoverage } = require('./tool-coverage-planner');

/**
 * Derive the lookup key from a routing plan.
 * Prefers routeKey (routing-matrix) then routeLabel (capability-broker).
 *
 * @param {object} plan
 * @returns {string|null}
 */
function resolvePlanKey(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return plan.routeKey || plan.evidenceKey || plan.routeLabel || plan.primaryIntent || null;
}

/**
 * Check whether a single evidence source is already satisfied by knownContext.
 *
 * A source is "checked" when at least one of its `contextKeys` is present
 * in knownContext with a non-null, non-empty value.
 *
 * @param {object} source  Evidence source descriptor from the registry.
 * @param {object} knownContext
 * @returns {boolean}
 */
function isSourceSatisfied(source, knownContext) {
  if (!Array.isArray(source.contextKeys) || source.contextKeys.length === 0) {
    return false;
  }
  const ctx = knownContext && typeof knownContext === 'object' ? knownContext : {};
  return source.contextKeys.some((key) => {
    const val = ctx[key];
    return val !== undefined && val !== null && val !== '';
  });
}

/**
 * Compute a simple confidence score from checked vs required sources.
 *
 * Rules:
 * - 1.0  all required sources satisfied
 * - 0.5  some required sources missing but at least one satisfied
 * - 0.0  no required sources satisfied (or none exist)
 *
 * Optional sources are counted separately and can push confidence above 0.5
 * toward 1.0 proportionally, but can never make up for missing required ones.
 *
 * @param {object[]} sources
 * @param {Set<string>} satisfiedIds
 * @returns {number}
 */
function computeConfidence(sources, satisfiedIds) {
  const required = sources.filter((s) => !s.optional);
  const optional = sources.filter((s) => s.optional);

  if (required.length === 0 && optional.length === 0) return 1.0;

  const requiredSatisfied = required.filter((s) => satisfiedIds.has(s.id)).length;
  const optionalSatisfied = optional.filter((s) => satisfiedIds.has(s.id)).length;

  if (required.length > 0 && requiredSatisfied === 0) return 0.0;

  // Base from required ratio
  const base = required.length > 0 ? requiredSatisfied / required.length : 1.0;

  // Optional bonus: at most 0.1 uplift scaled by optional ratio
  const optionalBonus = optional.length > 0 ? 0.1 * (optionalSatisfied / optional.length) : 0.0;

  return Math.min(1.0, parseFloat((base + optionalBonus).toFixed(2)));
}

/**
 * Build an evidencePlan sidecar for the given routing plan.
 *
 * @param {object} plan        Routing plan from buildExecutionPlan().
 * @param {object} knownContext Current known context.
 * @returns {{
 *   registryKey: string,
 *   requiredSources: object[],
 *   checkedSources: string[],
 *   gaps: object[],
 *   confidence: number,
 *   phaseNote: string,
 * }|null}
 */
function planEvidence(plan, knownContext = {}) {
  const key = resolvePlanKey(plan);
  if (!key) return null;

  const requirements = getEvidenceRequirements(key);

  // Phase 3: Fall back to generic tool-coverage planner for unregistered routes.
  if (!requirements) {
    const genericPlan = planGenericToolCoverage(plan, knownContext);
    if (genericPlan) {
      genericPlan.source = 'generic';
      genericPlan.phaseNote = 'Phase 3: Generic coverage inferred from plan steps.';
    }
    return genericPlan;
  }

  // Phase 1/2: Registry-based evidence planning (established behavior).
  const { sources } = requirements;
  const satisfiedIds = new Set();

  for (const source of sources) {
    if (isSourceSatisfied(source, knownContext)) {
      satisfiedIds.add(source.id);
    }
  }

  const gaps = sources.filter((s) => !satisfiedIds.has(s.id) && !s.optional);
  const confidence = computeConfidence(sources, satisfiedIds);

  return {
    registryKey: key,
    requiredSources: sources.map((s) => ({
      id: s.id,
      label: s.label,
      optional: s.optional,
      resolvedBy: s.resolvedBy,
    })),
    checkedSources: [...satisfiedIds],
    gaps: gaps.map((s) => ({
      id: s.id,
      label: s.label,
      resolvedBy: s.resolvedBy,
    })),
    confidence,
    source: 'registry',
    // Phase 1/2: annotation and optional gate.
    phaseNote: 'evidence-plan-phase1-annotation-only',
  };
}

/**
 * Check if evidence gaps are critical enough to block execution/synthesis.
 *
 * Phase 2 decision logic:
 * - If ALL required sources are missing (confidence 0.0), gaps are CRITICAL.
 * - If some required sources are satisfied but at least one critical source
 *   (e.g. vnb_identity for forecast) is missing, gaps are CRITICAL.
 * - Optional sources don't trigger blocking.
 * - If registered routes have no required sources, no blocking.
 *
 * @param {object|null} evidencePlan  From planEvidence().
 * @returns {boolean}  true = should block synthesis, false = proceed normally.
 */
function shouldBlockSynthesisOnGaps(evidencePlan) {
  if (!evidencePlan) return false;
  if (evidencePlan.confidence >= 0.8) return false;

  // Critical sources that MUST be present for synthesis to proceed
  const criticalSourceIds = [
    'vnb_identity',
    'asset_profile',
    'netzanschlusszusage',
    'forecast_horizon',
    'gruenstromindex_forecast',
    'temporal_probability_window',
  ];

  const hasCriticalGap = evidencePlan.gaps.some((gap) => criticalSourceIds.includes(gap.id));

  return hasCriticalGap || evidencePlan.confidence === 0.0;
}

/**
 * Build a presentable evidence_gap_table from evidencePlan.
 *
 * Returns a structured presentation payload suitable for rendering as
 * evidence_gap_table in the presentation service.
 *
 * @param {object|null} evidencePlan  From planEvidence().
 * @returns {object}  Presentation-ready payload with gaps, required sources, etc.
 */
function buildEvidenceGapPresentation(evidencePlan) {
  if (!evidencePlan) {
    return {
      evidenceGaps: [],
      requiredSources: [],
      checkedSources: [],
      confidence: 0.0,
    };
  }

  return {
    evidenceGaps: evidencePlan.gaps.map((gap) => ({
      id: gap.id,
      label: gap.label,
      resolvedBy: gap.resolvedBy,
      criticality: 'high',
    })),
    requiredSources: evidencePlan.requiredSources
      .filter((s) => !s.optional)
      .map((s) => ({
        id: s.id,
        label: s.label,
        resolvedBy: s.resolvedBy,
        isSatisfied: evidencePlan.checkedSources.includes(s.id),
      })),
    checkedSources: evidencePlan.checkedSources,
    confidence: evidencePlan.confidence,
    phaseNote: 'evidence-plan-phase2-synthesis-gate',
  };
}

module.exports = {
  planEvidence,
  resolvePlanKey,
  isSourceSatisfied,
  computeConfidence,
  shouldBlockSynthesisOnGaps,
  buildEvidenceGapPresentation,
};
