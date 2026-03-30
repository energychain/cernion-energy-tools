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
};
