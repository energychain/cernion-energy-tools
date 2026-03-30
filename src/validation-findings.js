'use strict';

// ---------------------------------------------------------------------------
// Finding code constants — 20 defined codes across 6 pipeline steps
// ---------------------------------------------------------------------------

// Step 1 — Inventory
const INVENTORY_COMPLETE = 'INVENTORY_COMPLETE';
const INVENTORY_EMPTY = 'INVENTORY_EMPTY';
const INSTALLATION_NO_NAP = 'INSTALLATION_NO_NAP';
const INSTALLATION_STATUS_ANOMALY = 'INSTALLATION_STATUS_ANOMALY';

// Step 2 — Delta (cross-system comparison)
const MASTR_DUPLICATE_SUSPECTED = 'MASTR_DUPLICATE_SUSPECTED';
const OPERATOR_DATA_STALE = 'OPERATOR_DATA_STALE';
const VOLTAGE_LEVEL_MISMATCH = 'VOLTAGE_LEVEL_MISMATCH';

// Step 3 — Capacity assessment
const CAPACITY_HEADROOM_OK = 'CAPACITY_HEADROOM_OK';
const CAPACITY_CONDITIONAL = 'CAPACITY_CONDITIONAL';
const CAPACITY_EXPANSION_NEEDED = 'CAPACITY_EXPANSION_NEEDED';
const TRANSFORMER_DATA_MISSING = 'TRANSFORMER_DATA_MISSING';

// Step 4 — EWK benchmark
const EWK_BENCHMARK_SLOW = 'EWK_BENCHMARK_SLOW';
const EWK_BENCHMARK_FAST = 'EWK_BENCHMARK_FAST';
const EWK_IMPLEMENTATION_LOW = 'EWK_IMPLEMENTATION_LOW';

// Step 5 — Go/No-Go decision
const GO_DIRECT = 'GO_DIRECT';
const GO_CONDITIONAL = 'GO_CONDITIONAL';
const NO_GO_EXPANSION = 'NO_GO_EXPANSION';
const DATA_QUALITY_INSUFFICIENT = 'DATA_QUALITY_INSUFFICIENT';

// Step 6 — Audit trail
const AUDIT_TRAIL_CREATED = 'AUDIT_TRAIL_CREATED';
const SNAPSHOT_DRIFT_DETECTED = 'SNAPSHOT_DRIFT_DETECTED';

// ---------------------------------------------------------------------------
// Energy Sharing Validation codes (v0.15) — §42c EnWG, §21 Abs. 2 EEG
// ---------------------------------------------------------------------------

// ES Step 1 — VNB Identity
const VNB_RESOLVED = 'VNB_RESOLVED';
const VNB_AMBIGUOUS = 'VNB_AMBIGUOUS';
const VNB_NOT_FOUND = 'VNB_NOT_FOUND';

// ES Step 2 — Generator Validation (per-generator findings)
const GENERATOR_VALID = 'GENERATOR_VALID';
const GENERATOR_NOT_FOUND = 'GENERATOR_NOT_FOUND';
const GENERATOR_NOT_OPERATIONAL = 'GENERATOR_NOT_OPERATIONAL';
const GENERATOR_WRONG_GRID_AREA = 'GENERATOR_WRONG_GRID_AREA';
const GENERATOR_TYPE_INELIGIBLE = 'GENERATOR_TYPE_INELIGIBLE';
const GENERATOR_CAPACITY_ZERO = 'GENERATOR_CAPACITY_ZERO';
const GENERATOR_NO_NAP = 'GENERATOR_NO_NAP';
const GENERATOR_NO_MELO = 'GENERATOR_NO_MELO';
const GENERATOR_DUPLICATE = 'GENERATOR_DUPLICATE';

// ES Step 3 — Direct Marketer Validation (§21 Abs. 2 EEG)
const DV_VALID = 'DV_VALID';
const DV_MANDATORY_MISSING = 'DV_MANDATORY_MISSING';
const DV_NOT_CONTROLLABLE = 'DV_NOT_CONTROLLABLE';
const DV_NOT_FOUND = 'DV_NOT_FOUND';
const DV_INACTIVE = 'DV_INACTIVE';
const DV_MASTR_MISMATCH = 'DV_MASTR_MISMATCH';

// ES Step 4 — Energy Sharing Eligibility (§42c EnWG)
const ELIGIBILITY_CONFIRMED = 'ELIGIBILITY_CONFIRMED';
const SHARE_SUM_GENERATORS_INVALID = 'SHARE_SUM_GENERATORS_INVALID';
const SHARE_SUM_CONSUMERS_INVALID = 'SHARE_SUM_CONSUMERS_INVALID';
const NO_GENERATORS = 'NO_GENERATORS';
const NO_CONSUMERS = 'NO_CONSUMERS';
const MIXED_GRID_AREAS = 'MIXED_GRID_AREAS';
const GENERATOR_EXCEEDS_LIMIT = 'GENERATOR_EXCEEDS_LIMIT';
const CONSUMER_MALO_INVALID = 'CONSUMER_MALO_INVALID';
const CONSUMER_MALO_DUPLICATE = 'CONSUMER_MALO_DUPLICATE';

// ES Step 5 — Energy Sharing Decision codes
// Note: constant names use ES_ prefix; values are the canonical decision strings per §42c CR.
const ES_APPROVED = 'APPROVED';
const ES_APPROVED_WITH_CONDITIONS = 'APPROVED_WITH_CONDITIONS';
const ES_REJECTED_STRUCTURAL = 'REJECTED_STRUCTURAL';
const ES_REJECTED_GENERATOR_INVALID = 'REJECTED_GENERATOR_INVALID';
const ES_REJECTED_OTHER = 'REJECTED_OTHER';

// ---------------------------------------------------------------------------
// MaStR Data Quality Agent codes (v0.17) — deterministic 8-step portfolio audit
// ---------------------------------------------------------------------------

// MQ Step 2 — Inventory
const MQ_INVENTORY_COMPLETE = 'MQ_INVENTORY_COMPLETE';
const MQ_INVENTORY_EMPTY    = 'MQ_INVENTORY_EMPTY';

// MQ Step 3 — Status anomalies
const MQ_STALE_PLANNING            = 'MQ_STALE_PLANNING';
const MQ_STALE_TEMPORARY_SHUTDOWN  = 'MQ_STALE_TEMPORARY_SHUTDOWN';
const MQ_MISSING_COMMISSIONING_DATE = 'MQ_MISSING_COMMISSIONING_DATE';
const MQ_FUTURE_COMMISSIONING      = 'MQ_FUTURE_COMMISSIONING';
const MQ_NBP_PENDING               = 'MQ_NBP_PENDING';
const MQ_NBP_NOT_PLANNED           = 'MQ_NBP_NOT_PLANNED';

// MQ Step 4 — Capacity anomalies
const MQ_ZERO_CAPACITY             = 'MQ_ZERO_CAPACITY';
const MQ_NEGATIVE_CAPACITY         = 'MQ_NEGATIVE_CAPACITY';
const MQ_IMPLAUSIBLE_HIGH_CAPACITY = 'MQ_IMPLAUSIBLE_HIGH_CAPACITY';
const MQ_NETTO_EXCEEDS_BRUTTO      = 'MQ_NETTO_EXCEEDS_BRUTTO';
const MQ_MISSING_FEED_IN_TYPE      = 'MQ_MISSING_FEED_IN_TYPE';

// MQ Step 5 — Connection point integrity
const MQ_MISSING_NAP         = 'MQ_MISSING_NAP';
const MQ_MISSING_MELO        = 'MQ_MISSING_MELO';
const MQ_NAP_VNB_MISMATCH    = 'MQ_NAP_VNB_MISMATCH';
const MQ_VOLTAGE_MISMATCH    = 'MQ_VOLTAGE_MISMATCH';
const MQ_NAP_MULTI_UNIT      = 'MQ_NAP_MULTI_UNIT';
const MQ_REDISPATCH_NO_NAP   = 'MQ_REDISPATCH_NO_NAP';

// MQ Step 6 — Duplicate detection
const MQ_PROBABLE_DUPLICATE = 'MQ_PROBABLE_DUPLICATE';
const MQ_POSSIBLE_DUPLICATE = 'MQ_POSSIBLE_DUPLICATE';
const MQ_GEO_DUPLICATE      = 'MQ_GEO_DUPLICATE';

// MQ Step 7 — Geo spot check
const MQ_GEO_PLAUSIBLE      = 'MQ_GEO_PLAUSIBLE';
const MQ_GEO_MISASSIGNMENT  = 'MQ_GEO_MISASSIGNMENT';
const MQ_GEO_CHECK_FAILED   = 'MQ_GEO_CHECK_FAILED';

// ---------------------------------------------------------------------------
// MaStR Quality score helpers (v0.17)
// ---------------------------------------------------------------------------

/**
 * Dimension → step number mapping used by computeQualityScore.
 * Keys match the `qualityDimensions` object returned by the audit pipeline.
 */
const QUALITY_DIMENSION_WEIGHTS = {
  connectionPoints: 0.30,
  capacity:         0.20,
  geo:              0.20,
  status:           0.15,
  duplicates:       0.15,
};

/**
 * Computes a single dimension score from a findings array.
 * Formula: max(0, 100 − errors×10 − warnings×3), clamped to [0, 100].
 *
 * @param {object[]} findings    Full findings array from a pipeline run
 * @param {number[]} stepNumbers Step numbers that belong to this dimension
 * @returns {number} Score 0–100
 */
function computeDimensionScore(findings, stepNumbers) {
  const stepSet = new Set(stepNumbers);
  const dimFindings = findings.filter((f) => stepSet.has(f.step));
  const errors   = dimFindings.filter((f) => f.severity === 'error').length;
  const warnings = dimFindings.filter((f) => f.severity === 'warning').length;
  return Math.max(0, Math.min(100, 100 - errors * 10 - warnings * 3));
}

/**
 * Computes the overall quality score as a weighted average over dimensions.
 * Dimensions with `score: null` (skipped steps) are excluded from the
 * denominator so the remaining weights are re-normalised automatically.
 *
 * @param {{ [dimName: string]: { score: number|null, weight: number } }} dimensions
 *   Keys must match QUALITY_DIMENSION_WEIGHTS. Each entry must have `score`
 *   (number 0–100 or null for skipped) and optionally `weight` (overrides
 *   QUALITY_DIMENSION_WEIGHTS if provided, otherwise default weights are used).
 * @returns {number} Rounded overall quality score 0–100
 */
function computeQualityScore(dimensions) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [dim, entry] of Object.entries(dimensions)) {
    if (entry.score === null || entry.score === undefined) continue;
    const weight = entry.weight !== undefined ? entry.weight : (QUALITY_DIMENSION_WEIGHTS[dim] || 0);
    weightedSum += entry.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}

// ---------------------------------------------------------------------------
// Simultaneity factors per installation type
// Source: cernion_connection_capacity_check documentation (CR §3.3)
// ---------------------------------------------------------------------------
const SIMULTANEITY_FACTORS = {
  solar:      { min: 0.70, max: 0.90, default: 0.80 },
  wind:       { min: 0.50, max: 0.70, default: 0.60 },
  storage:    { min: 0.30, max: 0.50, default: 0.40 },
  combustion: { min: 0.80, max: 1.00, default: 0.90 },
  biomass:    { min: 0.70, max: 0.90, default: 0.80 },
  other:      { min: 0.60, max: 0.80, default: 0.70 },
};

// ---------------------------------------------------------------------------
// Factory — creates a structured Finding document
// ---------------------------------------------------------------------------

/**
 * Creates a validation finding with a deterministic F-<step>-<index> ID.
 *
 * @param {number} step                    Pipeline step number (1–6)
 * @param {string} stepName                Human-readable step name (e.g. 'inventory')
 * @param {string} code                    Finding code constant (SCREAMING_SNAKE_CASE)
 * @param {string} severity                'info' | 'warning' | 'error'
 * @param {string} title                   One-liner for UI/report
 * @param {string} reason                  Human-readable explanation
 * @param {object} [context={}]            Structured details (varies per finding)
 * @param {string|null} [recommendation]   Action recommendation
 * @param {number} [index=1]               Sequential index within this step (1-based)
 * @returns {object} Finding document
 */
function createFinding(
  step,
  stepName,
  code,
  severity,
  title,
  reason,
  context = {},
  recommendation = null,
  index = 1
) {
  return {
    id: `F-${step}-${String(index).padStart(3, '0')}`,
    timestamp: new Date().toISOString(),
    step,
    stepName,
    finding: code,
    severity,
    title,
    reason,
    context: context || {},
    recommendation: recommendation || null,
  };
}

// ---------------------------------------------------------------------------
// Aggregation helper
// ---------------------------------------------------------------------------

/**
 * Counts findings by severity.
 *
 * @param {object[]} findings  Array of finding documents
 * @returns {{ info: number, warning: number, error: number }}
 */
function summarizeFindings(findings) {
  return findings.reduce(
    (acc, f) => {
      if (f.severity === 'info') acc.info += 1;
      else if (f.severity === 'warning') acc.warning += 1;
      else if (f.severity === 'error') acc.error += 1;
      return acc;
    },
    { info: 0, warning: 0, error: 0 }
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  // Step 1
  INVENTORY_COMPLETE,
  INVENTORY_EMPTY,
  INSTALLATION_NO_NAP,
  INSTALLATION_STATUS_ANOMALY,
  // Step 2
  MASTR_DUPLICATE_SUSPECTED,
  OPERATOR_DATA_STALE,
  VOLTAGE_LEVEL_MISMATCH,
  // Step 3
  CAPACITY_HEADROOM_OK,
  CAPACITY_CONDITIONAL,
  CAPACITY_EXPANSION_NEEDED,
  TRANSFORMER_DATA_MISSING,
  // Step 4
  EWK_BENCHMARK_SLOW,
  EWK_BENCHMARK_FAST,
  EWK_IMPLEMENTATION_LOW,
  // Step 5
  GO_DIRECT,
  GO_CONDITIONAL,
  NO_GO_EXPANSION,
  DATA_QUALITY_INSUFFICIENT,
  // Step 6
  AUDIT_TRAIL_CREATED,
  SNAPSHOT_DRIFT_DETECTED,
  // Helpers
  SIMULTANEITY_FACTORS,
  createFinding,
  summarizeFindings,
  // ES Step 1 — VNB Identity
  VNB_RESOLVED,
  VNB_AMBIGUOUS,
  VNB_NOT_FOUND,
  // ES Step 2 — Generator Validation
  GENERATOR_VALID,
  GENERATOR_NOT_FOUND,
  GENERATOR_NOT_OPERATIONAL,
  GENERATOR_WRONG_GRID_AREA,
  GENERATOR_TYPE_INELIGIBLE,
  GENERATOR_CAPACITY_ZERO,
  GENERATOR_NO_NAP,
  GENERATOR_NO_MELO,
  GENERATOR_DUPLICATE,
  // ES Step 3 — Direct Marketer
  DV_VALID,
  DV_MANDATORY_MISSING,
  DV_NOT_CONTROLLABLE,
  DV_NOT_FOUND,
  DV_INACTIVE,
  DV_MASTR_MISMATCH,
  // ES Step 4 — Eligibility
  ELIGIBILITY_CONFIRMED,
  SHARE_SUM_GENERATORS_INVALID,
  SHARE_SUM_CONSUMERS_INVALID,
  NO_GENERATORS,
  NO_CONSUMERS,
  MIXED_GRID_AREAS,
  GENERATOR_EXCEEDS_LIMIT,
  CONSUMER_MALO_INVALID,
  CONSUMER_MALO_DUPLICATE,
  // ES Step 5 — Decision
  ES_APPROVED,
  ES_APPROVED_WITH_CONDITIONS,
  ES_REJECTED_STRUCTURAL,
  ES_REJECTED_GENERATOR_INVALID,
  ES_REJECTED_OTHER,
  // MQ Step 2 — Inventory
  MQ_INVENTORY_COMPLETE,
  MQ_INVENTORY_EMPTY,
  // MQ Step 3 — Status anomalies
  MQ_STALE_PLANNING,
  MQ_STALE_TEMPORARY_SHUTDOWN,
  MQ_MISSING_COMMISSIONING_DATE,
  MQ_FUTURE_COMMISSIONING,
  MQ_NBP_PENDING,
  MQ_NBP_NOT_PLANNED,
  // MQ Step 4 — Capacity anomalies
  MQ_ZERO_CAPACITY,
  MQ_NEGATIVE_CAPACITY,
  MQ_IMPLAUSIBLE_HIGH_CAPACITY,
  MQ_NETTO_EXCEEDS_BRUTTO,
  MQ_MISSING_FEED_IN_TYPE,
  // MQ Step 5 — Connection point integrity
  MQ_MISSING_NAP,
  MQ_MISSING_MELO,
  MQ_NAP_VNB_MISMATCH,
  MQ_VOLTAGE_MISMATCH,
  MQ_NAP_MULTI_UNIT,
  MQ_REDISPATCH_NO_NAP,
  // MQ Step 6 — Duplicate detection
  MQ_PROBABLE_DUPLICATE,
  MQ_POSSIBLE_DUPLICATE,
  MQ_GEO_DUPLICATE,
  // MQ Step 7 — Geo spot check
  MQ_GEO_PLAUSIBLE,
  MQ_GEO_MISASSIGNMENT,
  MQ_GEO_CHECK_FAILED,
  // MQ score helpers
  QUALITY_DIMENSION_WEIGHTS,
  computeDimensionScore,
  computeQualityScore,
};
