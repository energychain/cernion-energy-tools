'use strict';

// ---------------------------------------------------------------------------
// Finding code constants — 20 defined codes across 6 pipeline steps
// ---------------------------------------------------------------------------

/**
 * NAMING CONVENTION — Finding Code Constants vs. API Values
 * ==========================================================
 *
 * JavaScript constant names carry a PREFIX identifying the agent:
 *   ES_  = Energy Sharing
 *   MQ_  = MaStR Quality
 *   RD_  = Redispatch Ex-Post
 *   GO_  = Grid Connection (decision values)
 *   GC_  = Grid Connection (finding codes)
 *
 * The VALUES of these constants are the strings that appear in:
 *   - API responses (findings[].finding)
 *   - FINDING_CODE_METADATA keys
 *   - /api/dashboard/finding-codes response
 *
 * IMPORTANT INCONSISTENCY (historical, do not change):
 *   Energy Sharing values do NOT carry the ES_ prefix:
 *     const ES_REJECTED_STRUCTURAL = 'REJECTED_STRUCTURAL'
 *     → API sees: 'REJECTED_STRUCTURAL'
 *
 *   MaStR Quality and Redispatch values DO carry the prefix:
 *     const MQ_ZERO_CAPACITY = 'MQ_ZERO_CAPACITY'
 *     → API sees: 'MQ_ZERO_CAPACITY'
 *
 *   Grid Connection decision values have no prefix:
 *     const GO_DIRECT = 'GO_DIRECT'
 *     → API sees: 'GO_DIRECT'
 *
 * Root cause: Grid Connection codes (v0.14) were defined first without prefix.
 * MaStR Quality (v0.17) and Redispatch (v0.18) adopted prefixed values for
 * namespace safety. Energy Sharing (v0.15) predates the prefix convention —
 * the ES_ prefix was added to the JS constants but not backported to the values
 * to avoid breaking existing stored reports.
 *
 * FRONTEND / API CONSUMERS:
 *   Always match against VALUES from FINDING_CODE_METADATA keys or the
 *   /api/dashboard/finding-codes response — never against JS constant names.
 *   See docs/agent-decision-enums.ts for the verified enum values.
 */

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
const MQ_INVENTORY_EMPTY = 'MQ_INVENTORY_EMPTY';

// MQ Step 3 — Status anomalies
const MQ_STALE_PLANNING = 'MQ_STALE_PLANNING';
const MQ_STALE_TEMPORARY_SHUTDOWN = 'MQ_STALE_TEMPORARY_SHUTDOWN';
const MQ_MISSING_COMMISSIONING_DATE = 'MQ_MISSING_COMMISSIONING_DATE';
const MQ_FUTURE_COMMISSIONING = 'MQ_FUTURE_COMMISSIONING';
const MQ_NBP_PENDING = 'MQ_NBP_PENDING';
const MQ_NBP_NOT_PLANNED = 'MQ_NBP_NOT_PLANNED';

// MQ Step 4 — Capacity anomalies
const MQ_ZERO_CAPACITY = 'MQ_ZERO_CAPACITY';
const MQ_NEGATIVE_CAPACITY = 'MQ_NEGATIVE_CAPACITY';
const MQ_IMPLAUSIBLE_HIGH_CAPACITY = 'MQ_IMPLAUSIBLE_HIGH_CAPACITY';
const MQ_NETTO_EXCEEDS_BRUTTO = 'MQ_NETTO_EXCEEDS_BRUTTO';
const MQ_MISSING_FEED_IN_TYPE = 'MQ_MISSING_FEED_IN_TYPE';

// MQ Step 5 — Connection point integrity
const MQ_MISSING_NAP = 'MQ_MISSING_NAP';
const MQ_MISSING_MELO = 'MQ_MISSING_MELO';
const MQ_NAP_VNB_MISMATCH = 'MQ_NAP_VNB_MISMATCH';
const MQ_VOLTAGE_MISMATCH = 'MQ_VOLTAGE_MISMATCH';
const MQ_NAP_MULTI_UNIT = 'MQ_NAP_MULTI_UNIT';
const MQ_REDISPATCH_NO_NAP = 'MQ_REDISPATCH_NO_NAP';

// MQ Step 6 — Duplicate detection
const MQ_PROBABLE_DUPLICATE = 'MQ_PROBABLE_DUPLICATE';
const MQ_POSSIBLE_DUPLICATE = 'MQ_POSSIBLE_DUPLICATE';
const MQ_GEO_DUPLICATE = 'MQ_GEO_DUPLICATE';

// MQ Step 7 — Geo spot check
const MQ_GEO_PLAUSIBLE = 'MQ_GEO_PLAUSIBLE';
const MQ_GEO_MISASSIGNMENT = 'MQ_GEO_MISASSIGNMENT';
const MQ_GEO_CHECK_FAILED = 'MQ_GEO_CHECK_FAILED';

// ---------------------------------------------------------------------------
// Redispatch Ex-Post Agent codes (v0.18) — deterministic 7-step settlement audit
// Regulatory basis: §§ 13, 13a EnWG, NABEG, StromNZV, Redispatch 2.0 (BDEW/BNetzA)
// ---------------------------------------------------------------------------

// RD Step 2 — Portfolio inventory
const RD_PORTFOLIO_COMPLETE = 'RD_PORTFOLIO_COMPLETE';
const RD_PORTFOLIO_EMPTY = 'RD_PORTFOLIO_EMPTY';
const RD_PORTFOLIO_INCLUDES_INACTIVE = 'RD_PORTFOLIO_INCLUDES_INACTIVE';

// RD Step 3 — Master data validation
const RD_MISSING_NAP = 'RD_MISSING_NAP';
const RD_MISSING_MELO = 'RD_MISSING_MELO';
const RD_MISSING_BTR = 'RD_MISSING_BTR';
const RD_NAP_VNB_MISMATCH = 'RD_NAP_VNB_MISMATCH';
const RD_DV_NOT_CONTROLLABLE = 'RD_DV_NOT_CONTROLLABLE';
const RD_CAPACITY_ANOMALY = 'RD_CAPACITY_ANOMALY';

// RD Step 4 — Curtailment correlation (Netztransparenz)
const RD_CURTAILMENT_VOLUME = 'RD_CURTAILMENT_VOLUME';
const RD_HIGH_CURTAILMENT_PERIOD = 'RD_HIGH_CURTAILMENT_PERIOD';
const RD_CURTAILMENT_DATA_UNAVAILABLE = 'RD_CURTAILMENT_DATA_UNAVAILABLE';
const RD_CURTAILMENT_ZERO = 'RD_CURTAILMENT_ZERO';

// RD Step 5 — Settlement readiness
const RD_SETTLEMENT_READY = 'RD_SETTLEMENT_READY';
const RD_SETTLEMENT_PARTIAL = 'RD_SETTLEMENT_PARTIAL';
const RD_SETTLEMENT_CRITICAL = 'RD_SETTLEMENT_CRITICAL';

// RD Step 6 — Risk assessment
const RD_RISK_LOW = 'RD_RISK_LOW';
const RD_RISK_MEDIUM = 'RD_RISK_MEDIUM';
const RD_RISK_HIGH = 'RD_RISK_HIGH';

// ---------------------------------------------------------------------------
// Finance Agent codes (v0.40) — deterministic RAG planning + guarded synthesis
// ---------------------------------------------------------------------------

// FA Step 1 — Query planning
const FA_QUERY_PLANNED = 'FA_QUERY_PLANNED';

// FA Step 2 — Retrieval
const FA_EVIDENCE_RETRIEVED = 'FA_EVIDENCE_RETRIEVED';

// FA Step 3 — Evidence arbitration
const FA_RULE_EVIDENCE_USED = 'FA_RULE_EVIDENCE_USED';
const FA_HYDE_CONTEXT_USED = 'FA_HYDE_CONTEXT_USED';

// FA Step 4 — Compliance checks
const FA_RULE_HYDE_CONFLICT = 'FA_RULE_HYDE_CONFLICT';
const FA_REGULATORY_REFERENCES_MISSING = 'FA_REGULATORY_REFERENCES_MISSING';

// FA Step 5 — Synthesis
const FA_SYNTHESIS_GUARDED = 'FA_SYNTHESIS_GUARDED';
const FA_NEEDS_CLARIFICATION = 'FA_NEEDS_CLARIFICATION';

// ---------------------------------------------------------------------------
// VDMI Governance codes (v0.50) — matrix governance, shadow paths, silo drift
// ---------------------------------------------------------------------------
const VD_ROLE_VD_DECOUPLING_M = 'VD_ROLE_VD_DECOUPLING_M';
const VD_ROLE_V_OWNER_ABSENT_H = 'VD_ROLE_V_OWNER_ABSENT_H';
const VD_SHADOW_EXCEL_EXEC_H = 'VD_SHADOW_EXCEL_EXEC_H';
const VD_SHADOW_SHAREPOINT_BYPASS_H = 'VD_SHADOW_SHAREPOINT_BYPASS_H';
const VD_SILO_HANDOVER_MANUAL_M = 'VD_SILO_HANDOVER_MANUAL_M';
const VD_SILO_KERNSYSTEM_BLOCK_M = 'VD_SILO_KERNSYSTEM_BLOCK_M';
const VD_UNBUNDLE_PSEUDO_ARG_H = 'VD_UNBUNDLE_PSEUDO_ARG_H';
const VD_GOV_AUDIT_GAP_K = 'VD_GOV_AUDIT_GAP_K';
const VD_GOV_RECURRENCE_K = 'VD_GOV_RECURRENCE_K';
const BLINDFLUG_ANOMALY_DETECTED = 'BLINDFLUG_ANOMALY_DETECTED';

// ---------------------------------------------------------------------------
// FIM — File Ingest Monitor (v0.62)
// ---------------------------------------------------------------------------
const FIM_FILE_MISSING = 'FIM_FILE_MISSING';
const FIM_FILE_STALE = 'FIM_FILE_STALE';
const FIM_SCHEMA_MISMATCH = 'FIM_SCHEMA_MISMATCH';
const FIM_PARSE_ERROR = 'FIM_PARSE_ERROR';
const FIM_ERROR_FOLDER_PRESENT = 'FIM_ERROR_FOLDER_PRESENT';
const FIM_REQUIRED_COLUMNS_MISSING = 'FIM_REQUIRED_COLUMNS_MISSING';
const FIM_MONITOR_HEALTHY = 'FIM_MONITOR_HEALTHY';

// RDAR — Redispatch Asset Register (v0.62)
const RDAR_RESOURCE_MAPPING_MISSING = 'RDAR_RESOURCE_MAPPING_MISSING';
const RDAR_IDENTIFIER_CONFLICT = 'RDAR_IDENTIFIER_CONFLICT';
const RDAR_MARKET_LOCATION_MISSING = 'RDAR_MARKET_LOCATION_MISSING';
const RDAR_CONTROL_GROUP_AMBIGUOUS = 'RDAR_CONTROL_GROUP_AMBIGUOUS';
const RDAR_CO_LOCATION_UNRESOLVED = 'RDAR_CO_LOCATION_UNRESOLVED';
const RDAR_ASSET_PROJECTION_COMPLETE = 'RDAR_ASSET_PROJECTION_COMPLETE';

// RDG — Redispatch Data Governance (v0.62)
const RDG_DEADLINE_MISSED = 'RDG_DEADLINE_MISSED';
const RDG_OWNER_UNASSIGNED = 'RDG_OWNER_UNASSIGNED';
const RDG_SOURCE_OF_RECORD_UNRESOLVED = 'RDG_SOURCE_OF_RECORD_UNRESOLVED';
const RDG_GOVERNANCE_POLICY_MISSING = 'RDG_GOVERNANCE_POLICY_MISSING';
const RDG_DATA_CONFLICT = 'RDG_DATA_CONFLICT';
const RDG_GOVERNANCE_COMPLIANT = 'RDG_GOVERNANCE_COMPLIANT';

// RDSS — Redispatch Settlement Sandbox (v0.62)
const RDSS_MISSING_SCENARIO = 'RDSS_MISSING_SCENARIO';
const RDSS_RECONCILIATION_DEVIATION = 'RDSS_RECONCILIATION_DEVIATION';
const RDSS_MISSING_DATAPOINT_EVIDENCE = 'RDSS_MISSING_DATAPOINT_EVIDENCE';
const RDSS_POLICY_VERSION_MISMATCH = 'RDSS_POLICY_VERSION_MISMATCH';
const RDSS_SCENARIO_COMPLETE = 'RDSS_SCENARIO_COMPLETE';

// RSCG — Redispatch Special Case Gate (v0.62)
const RSCG_CO_LOCATION_CONFIRMED = 'RSCG_CO_LOCATION_CONFIRMED';
const RSCG_CO_LOCATION_UNCONFIRMED = 'RSCG_CO_LOCATION_UNCONFIRMED';
const RSCG_CONTROLLABILITY_CONFIRMED = 'RSCG_CONTROLLABILITY_CONFIRMED';
const RSCG_CONTROLLABILITY_MISSING = 'RSCG_CONTROLLABILITY_MISSING';
const RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT = 'RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT';
const RSCG_NON_AVAILABILITY_EVIDENCE_MISSING = 'RSCG_NON_AVAILABILITY_EVIDENCE_MISSING';
const RSCG_DEVIATION_WITHIN_TOLERANCE = 'RSCG_DEVIATION_WITHIN_TOLERANCE';
const RSCG_DEVIATION_EXCEEDS_TOLERANCE = 'RSCG_DEVIATION_EXCEEDS_TOLERANCE';
const RSCG_GATE_READY = 'RSCG_GATE_READY';
const RSCG_GATE_BLOCKED = 'RSCG_GATE_BLOCKED';
const RSCG_GATE_INSUFFICIENT_EVIDENCE = 'RSCG_GATE_INSUFFICIENT_EVIDENCE';

// RRG — Redispatch Readiness Gate (v0.63)
const RRG_ACCESS_MATRIX_COMPLETE = 'RRG_ACCESS_MATRIX_COMPLETE';
const RRG_ACCESS_MATRIX_INCOMPLETE = 'RRG_ACCESS_MATRIX_INCOMPLETE';
const RRG_TEST_CALL_PASSED = 'RRG_TEST_CALL_PASSED';
const RRG_TEST_CALL_MISSING = 'RRG_TEST_CALL_MISSING';
const RRG_TEST_CALL_FAILED = 'RRG_TEST_CALL_FAILED';
const RRG_PRODUCTION_PROOF_CONFIRMED = 'RRG_PRODUCTION_PROOF_CONFIRMED';
const RRG_PRODUCTION_PROOF_MISSING = 'RRG_PRODUCTION_PROOF_MISSING';
const RRG_TEMPLATE_VERSION_CURRENT = 'RRG_TEMPLATE_VERSION_CURRENT';
const RRG_TEMPLATE_VERSION_OUTDATED = 'RRG_TEMPLATE_VERSION_OUTDATED';
const RRG_OPEN_QUESTIONS_PRESENT = 'RRG_OPEN_QUESTIONS_PRESENT';
const RRG_RESPONSIBLE_ROLE_ASSIGNED = 'RRG_RESPONSIBLE_ROLE_ASSIGNED';
const RRG_RESPONSIBLE_ROLE_MISSING = 'RRG_RESPONSIBLE_ROLE_MISSING';
const RRG_ACCEPTANCE_DEADLINE_MISSED = 'RRG_ACCEPTANCE_DEADLINE_MISSED';
const RRG_ACCEPTANCE_DEADLINE_APPROACHING = 'RRG_ACCEPTANCE_DEADLINE_APPROACHING';
const RRG_GATE_READY = 'RRG_GATE_READY';
const RRG_GATE_READY_WITH_WARNINGS = 'RRG_GATE_READY_WITH_WARNINGS';
const RRG_GATE_BLOCKED = 'RRG_GATE_BLOCKED';

// BRS — Battery Redispatch Special Gate (v0.63)
const BRS_MALO_DIRECTION_MISSING = 'BRS_MALO_DIRECTION_MISSING';
const BRS_METERING_CONCEPT_MISSING = 'BRS_METERING_CONCEPT_MISSING';
const BRS_REDISPATCH_DIRECTION_INCOMPLETE = 'BRS_REDISPATCH_DIRECTION_INCOMPLETE';
const BRS_CONTROLLABILITY_DIRECTION_MISSING = 'BRS_CONTROLLABILITY_DIRECTION_MISSING';
const BRS_TEST_CALL_PROOF_MISSING = 'BRS_TEST_CALL_PROOF_MISSING';
const BRS_PRODUCTION_PROOF_MISSING = 'BRS_PRODUCTION_PROOF_MISSING';
const BRS_SETTLEMENT_DIRECTION_CONFLICT = 'BRS_SETTLEMENT_DIRECTION_CONFLICT';
const BRS_GATE_READY = 'BRS_GATE_READY';
const BRS_GATE_BLOCKED = 'BRS_GATE_BLOCKED';

// FCRM — Flexibility Conductor Role Model (v0.63)
const FCRM_DECISION_RIGHTS_MISSING = 'FCRM_DECISION_RIGHTS_MISSING';
const FCRM_CONTROL_BOUNDARY_MISSING = 'FCRM_CONTROL_BOUNDARY_MISSING';
const FCRM_MONITORING_OWNER_MISSING = 'FCRM_MONITORING_OWNER_MISSING';
const FCRM_COMMERCIAL_OWNER_MISSING = 'FCRM_COMMERCIAL_OWNER_MISSING';
const FCRM_ESCALATION_PATH_MISSING = 'FCRM_ESCALATION_PATH_MISSING';
const FCRM_SOURCE_ACTIONS_MISSING = 'FCRM_SOURCE_ACTIONS_MISSING';
const FCRM_ROLE_MODEL_READY = 'FCRM_ROLE_MODEL_READY';
const FCRM_ROLE_MODEL_BLOCKED = 'FCRM_ROLE_MODEL_BLOCKED';

// KCGG — Knowledge Continuity Governance Gate (v0.63)
const KCGG_DECISION_RIGHTS_MISSING = 'KCGG_DECISION_RIGHTS_MISSING';
const KCGG_CONTROL_BOUNDARY_MISSING = 'KCGG_CONTROL_BOUNDARY_MISSING';
const KCGG_MONITORING_OWNER_MISSING = 'KCGG_MONITORING_OWNER_MISSING';
const KCGG_COMMERCIAL_OWNER_MISSING = 'KCGG_COMMERCIAL_OWNER_MISSING';
const KCGG_ESCALATION_PATH_MISSING = 'KCGG_ESCALATION_PATH_MISSING';
const KCGG_SOURCE_ACTIONS_MISSING = 'KCGG_SOURCE_ACTIONS_MISSING';
const KCGG_GOVERNANCE_GATE_READY = 'KCGG_GOVERNANCE_GATE_READY';
const KCGG_GOVERNANCE_GATE_BLOCKED = 'KCGG_GOVERNANCE_GATE_BLOCKED';

// IMOB — Investment Maturity Off-Balance Gate (v0.63)
const IMOB_MATURITY_MODEL_MISSING = 'IMOB_MATURITY_MODEL_MISSING';
const IMOB_PROCESS_QUALITY_LOW = 'IMOB_PROCESS_QUALITY_LOW';
const IMOB_FINANCING_COST_MISSING = 'IMOB_FINANCING_COST_MISSING';
const IMOB_REGULATORY_RETURN_HYPOTHESIS_MISSING = 'IMOB_REGULATORY_RETURN_HYPOTHESIS_MISSING';
const IMOB_ASSET_RISK_REFERENCE_MISSING = 'IMOB_ASSET_RISK_REFERENCE_MISSING';
const IMOB_ISO_RISK_REFERENCE_MISSING = 'IMOB_ISO_RISK_REFERENCE_MISSING';
const IMOB_DECISION_FORUM_MISSING = 'IMOB_DECISION_FORUM_MISSING';
const IMOB_SOURCE_ACTIONS_MISSING = 'IMOB_SOURCE_ACTIONS_MISSING';
const IMOB_GATE_READY = 'IMOB_GATE_READY';
const IMOB_GATE_BLOCKED = 'IMOB_GATE_BLOCKED';

// Gas Capacity Order Revision Gate (v0.63)
const GCORG_TOOL_VALUE_MISSING = 'GCORG_TOOL_VALUE_MISSING';
const GCORG_COLD_YEAR_SCENARIO_MISSING = 'GCORG_COLD_YEAR_SCENARIO_MISSING';
const GCORG_RLM_REBOUND_MISSING = 'GCORG_RLM_REBOUND_MISSING';
const GCORG_BOTTLENECK_EVIDENCE_MISSING = 'GCORG_BOTTLENECK_EVIDENCE_MISSING';
const GCORG_NKP_DISTRIBUTION_MISSING = 'GCORG_NKP_DISTRIBUTION_MISSING';
const GCORG_TARIFF_IMPACT_MISSING = 'GCORG_TARIFF_IMPACT_MISSING';
const GCORG_FLEXIBILITY_EVIDENCE_MISSING = 'GCORG_FLEXIBILITY_EVIDENCE_MISSING';
const GCORG_DECISION_RESOLUTION_MISSING = 'GCORG_DECISION_RESOLUTION_MISSING';
const GCORG_SOURCE_ACTIONS_MISSING = 'GCORG_SOURCE_ACTIONS_MISSING';
const GCORG_GATE_READY = 'GCORG_GATE_READY';
const GCORG_GATE_BLOCKED = 'GCORG_GATE_BLOCKED';

// ---------------------------------------------------------------------------
// Netzfahrplan / fNAV finding codes (v0.51.5) — Phase 5
// ---------------------------------------------------------------------------

// FN Step 1 — Profile validation
const FN_PROFILE_COMPLETE = 'FN_PROFILE_COMPLETE';
const FN_PROFILE_PARTIAL = 'FN_PROFILE_PARTIAL';
const FN_PROFILE_INSUFFICIENT = 'FN_PROFILE_INSUFFICIENT';

// FN Step 2 — N-1 compliance
const FN_N1_PASS = 'FN_N1_PASS';
const FN_N1_FAIL = 'FN_N1_FAIL';
const FN_N1_MARGINAL = 'FN_N1_MARGINAL';

// FN Step 3 — fNAV feasibility
const FN_FLEX_NAV_FEASIBLE = 'FN_FLEX_NAV_FEASIBLE';
const FN_CAPACITY_CONDITIONAL = 'FN_CAPACITY_CONDITIONAL';
const FN_CAPACITY_COPPER_NEEDED = 'FN_CAPACITY_COPPER_NEEDED';

// FN Step 4 — Governance gate
const FN_GOVERNANCE_APPROVED = 'FN_GOVERNANCE_APPROVED';
const FN_GOVERNANCE_REQUIRED = 'FN_GOVERNANCE_REQUIRED';

// FN Step 5 — Economics
const FN_ECONOMICS_AVAILABLE = 'FN_ECONOMICS_AVAILABLE';
const FN_ECONOMICS_PARTIAL = 'FN_ECONOMICS_PARTIAL';

// ---------------------------------------------------------------------------
// MaStR Quality score helpers (v0.17)
// ---------------------------------------------------------------------------

/**
 * Dimension → step number mapping used by computeQualityScore.
 * Keys match the `qualityDimensions` object returned by the audit pipeline.
 */
const QUALITY_DIMENSION_WEIGHTS = {
  connectionPoints: 0.3,
  capacity: 0.2,
  geo: 0.2,
  status: 0.15,
  duplicates: 0.15,
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
  const errors = dimFindings.filter((f) => f.severity === 'error').length;
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
    const weight = entry.weight !== undefined ? entry.weight : QUALITY_DIMENSION_WEIGHTS[dim] || 0;
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
  solar: { min: 0.7, max: 0.9, default: 0.8 },
  wind: { min: 0.5, max: 0.7, default: 0.6 },
  storage: { min: 0.3, max: 0.5, default: 0.4 },
  combustion: { min: 0.8, max: 1.0, default: 0.9 },
  biomass: { min: 0.7, max: 0.9, default: 0.8 },
  other: { min: 0.6, max: 0.8, default: 0.7 },
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
// Finding Code Metadata — UI reference (v0.19)
// Each entry carries: severity, agent, step, description (EN), descriptionDe (DE)
// Used by dashboard-api.findingCodes to power UI tooltips and filter chips.
// ---------------------------------------------------------------------------

// TODO (v0.21): Add `recommendation` (EN) and `recommendationDe` (DE) fields
// to every entry in FINDING_CODE_METADATA. These are actionable next-step texts
// displayed in the UI alongside each finding. Sync document with all 37 error-severity
// codes and draft recommendations: docs/ui-contracts/14-finding-code-recommendations.md

/**
 * Metadata map for all 100 finding codes.
 * Keys are the canonical finding code strings (SCREAMING_SNAKE_CASE).
 * @type {Record<string, { severity: string, agent: string, step: number, description: string, descriptionDe: string, recommendation?: string, recommendationDe?: string }>}
 */
const FINDING_CODE_METADATA = {
  // ── Grid Connection (v0.14) — Steps 1–6 ─────────────────────────────────
  INVENTORY_COMPLETE: {
    severity: 'info',
    agent: 'grid-connection',
    step: 1,
    description: 'Installation inventory completed successfully',
    descriptionDe: 'Anlagen-Inventur abgeschlossen',
  },
  INVENTORY_EMPTY: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 1,
    description: 'No installations ≥100 kW found for this grid operator',
    descriptionDe: 'Keine Anlagen ≥100 kW gefunden',
  },
  INSTALLATION_NO_NAP: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 1,
    description: 'Installation is missing a grid connection point (NAP)',
    descriptionDe: 'Anlage ohne Netzanschlusspunkt (NAP)',
  },
  INSTALLATION_STATUS_ANOMALY: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 1,
    description: 'Installation status is unexpected for active grid connection',
    descriptionDe: 'Unerwarteter Betriebsstatus bei aktiver Netzeinbindung',
  },
  MASTR_DUPLICATE_SUSPECTED: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 2,
    description: 'Probable duplicate entry detected in MaStR',
    descriptionDe: 'Wahrscheinliches Duplikat im MaStR erkannt',
  },
  OPERATOR_DATA_STALE: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 2,
    description: 'Netzbetreiberprüfung (NBP) status is stale (>30 days in review)',
    descriptionDe: 'Netzbetreiberprüfung seit >30 Tagen offen',
  },
  VOLTAGE_LEVEL_MISMATCH: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 2,
    description: 'Unit voltage level does not match its NAP voltage level',
    descriptionDe: 'Spannungsebene der Anlage stimmt nicht mit NAP überein',
  },
  CAPACITY_HEADROOM_OK: {
    severity: 'info',
    agent: 'grid-connection',
    step: 3,
    description: 'Sufficient grid capacity headroom confirmed',
    descriptionDe: 'Ausreichende Netzkapazität vorhanden',
  },
  CAPACITY_CONDITIONAL: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 3,
    description: 'Grid capacity is marginal — conditional connection may apply',
    descriptionDe: 'Netzkapazität grenzwertig — bedingter Anschluss möglich',
  },
  CAPACITY_EXPANSION_NEEDED: {
    severity: 'error',
    agent: 'grid-connection',
    step: 3,
    description: 'Grid capacity is insufficient — expansion required',
    descriptionDe: 'Netzkapazität nicht ausreichend — Ausbau erforderlich',
  },
  TRANSFORMER_DATA_MISSING: {
    severity: 'info',
    agent: 'grid-connection',
    step: 3,
    description: 'Transformer ratings not available in MaStR (expected — MaStR limitation)',
    descriptionDe: 'Transformatordaten nicht im MaStR verfügbar (MaStR-Limitation)',
  },
  EWK_BENCHMARK_SLOW: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 4,
    description: 'VNB connection time is below EWK benchmark',
    descriptionDe: 'Anschlussdauer unterhalb EWK-Benchmark',
  },
  EWK_BENCHMARK_FAST: {
    severity: 'info',
    agent: 'grid-connection',
    step: 4,
    description: 'VNB connection time meets or exceeds EWK benchmark',
    descriptionDe: 'Anschlussdauer entspricht oder übertrifft EWK-Benchmark',
  },
  EWK_IMPLEMENTATION_LOW: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 4,
    description: 'EWK implementation rate (Umsetzungsquote) is below target',
    descriptionDe: 'EWK-Umsetzungsquote unterhalb des Zielwerts',
  },
  GO_DIRECT: {
    severity: 'info',
    agent: 'grid-connection',
    step: 5,
    description: 'Direct grid connection approved — no conditions',
    descriptionDe: 'Direktanschluss genehmigt — keine Auflagen',
  },
  GO_CONDITIONAL: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 5,
    description: 'Grid connection approved with conditions',
    descriptionDe: 'Netzanschluss mit Auflagen genehmigt',
  },
  NO_GO_EXPANSION: {
    severity: 'error',
    agent: 'grid-connection',
    step: 5,
    description: 'Grid connection rejected — network expansion required first',
    descriptionDe: 'Netzanschluss abgelehnt — Netzerweiterung erforderlich',
  },
  DATA_QUALITY_INSUFFICIENT: {
    severity: 'error',
    agent: 'grid-connection',
    step: 5,
    description: 'Decision deferred — MaStR data quality too low',
    descriptionDe: 'Entscheidung zurückgestellt — MaStR-Datenqualität zu gering',
  },
  AUDIT_TRAIL_CREATED: {
    severity: 'info',
    agent: 'grid-connection',
    step: 6,
    description: 'Audit trail created and sealed in PouchDB (EU AI Act Art. 12)',
    descriptionDe: 'Audit-Trail erstellt und in PouchDB versiegelt (EU AI Act Art. 12)',
  },
  SNAPSHOT_DRIFT_DETECTED: {
    severity: 'warning',
    agent: 'grid-connection',
    step: 6,
    description: 'Data changed between pipeline start and audit seal — drift detected',
    descriptionDe: 'Daten haben sich zwischen Pipelinestart und Versiegelung verändert',
  },
  // ── Energy Sharing (v0.15) — Steps 1–6 ──────────────────────────────────
  VNB_RESOLVED: {
    severity: 'info',
    agent: 'energy-sharing',
    step: 1,
    description: 'VNB identity resolved unambiguously',
    descriptionDe: 'VNB-Identität eindeutig aufgelöst',
  },
  VNB_AMBIGUOUS: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 1,
    description: 'Multiple VNB candidates matched — using best candidate',
    descriptionDe: 'Mehrere VNB-Kandidaten gefunden — besten Kandidaten verwendet',
  },
  VNB_NOT_FOUND: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 1,
    description: 'VNB identity could not be resolved',
    descriptionDe: 'VNB-Identität konnte nicht aufgelöst werden',
  },
  GENERATOR_VALID: {
    severity: 'info',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator MaStR record is valid and operational in this grid area',
    descriptionDe: 'Erzeuger-MaStR-Datensatz gültig und in diesem Netzgebiet betriebsbereit',
  },
  GENERATOR_NOT_FOUND: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator MaStR number not found in MaStR',
    descriptionDe: 'Erzeuger-MaStR-Nummer nicht im MaStR gefunden',
  },
  GENERATOR_NOT_OPERATIONAL: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator is not in "InBetrieb" status',
    descriptionDe: 'Erzeuger ist nicht im Status "InBetrieb"',
  },
  GENERATOR_WRONG_GRID_AREA: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator belongs to a different grid operator area',
    descriptionDe: 'Erzeuger gehört zu einem anderen Netzgebiet',
  },
  GENERATOR_TYPE_INELIGIBLE: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator type is not eligible for Energy Sharing (§42c EnWG)',
    descriptionDe: 'Anlagentyp nicht für Energy Sharing (§42c EnWG) zulässig',
  },
  GENERATOR_CAPACITY_ZERO: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator has zero registered capacity',
    descriptionDe: 'Erzeuger hat Bruttoleistung = 0',
  },
  GENERATOR_NO_NAP: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator is missing a grid connection point (NAP)',
    descriptionDe: 'Erzeuger ohne Netzanschlusspunkt (NAP)',
  },
  GENERATOR_NO_MELO: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 2,
    description: 'Generator is missing a Messlokation (MeLo)',
    descriptionDe: 'Erzeuger ohne Messlokation (MeLo)',
  },
  GENERATOR_DUPLICATE: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'Duplicate MaStR number in generator list',
    descriptionDe: 'Doppelter MaStR-Eintrag in der Erzeugerliste',
  },
  DV_VALID: {
    severity: 'info',
    agent: 'energy-sharing',
    step: 3,
    description: 'Direktvermarkter status confirmed — remote control active',
    descriptionDe: 'Direktvermarkter-Status bestätigt — Fernsteuerbarkeit aktiv',
  },
  DV_MANDATORY_MISSING: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 3,
    description: 'Direktvermarktung is mandatory for ≥100 kW but not registered',
    descriptionDe: 'Direktvermarktung für ≥100 kW Pflicht, aber nicht registriert',
  },
  DV_NOT_CONTROLLABLE: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 3,
    description:
      'Direktvermarkter is registered but remote control (FernsteuerbarkeitDv) is inactive',
    descriptionDe:
      'Direktvermarkter registriert, aber Fernsteuerbarkeit (FernsteuerbarkeitDv) inaktiv',
  },
  DV_NOT_FOUND: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 3,
    description: 'Direktvermarkter name not found in MaStR registry',
    descriptionDe: 'Direktvermarkter-Name nicht im MaStR-Register gefunden',
  },
  DV_INACTIVE: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 3,
    description: 'Direktvermarkter assignment appears inactive',
    descriptionDe: 'Direktvermarkter-Beauftragung scheint inaktiv',
  },
  DV_MASTR_MISMATCH: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 3,
    description: 'Direktvermarkter name does not match MaStR record',
    descriptionDe: 'Direktvermarkter-Name stimmt nicht mit MaStR-Eintrag überein',
  },
  ELIGIBILITY_CONFIRMED: {
    severity: 'info',
    agent: 'energy-sharing',
    step: 4,
    description: '§42c EnWG eligibility confirmed — all checks passed',
    descriptionDe: '§42c EnWG Zulässigkeit bestätigt — alle Prüfungen bestanden',
  },
  SHARE_SUM_GENERATORS_INVALID: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'Generator share percentages do not sum to 100% (±0.1% tolerance)',
    descriptionDe: 'Erzeuger-Anteile ergeben nicht 100% (±0,1%-Toleranz)',
  },
  SHARE_SUM_CONSUMERS_INVALID: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'Consumer share percentages do not sum to 100% (±0.1% tolerance)',
    descriptionDe: 'Verbraucher-Anteile ergeben nicht 100% (±0,1%-Toleranz)',
  },
  NO_GENERATORS: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'No generators provided in Energy Sharing application',
    descriptionDe: 'Keine Erzeuger in der Energy-Sharing-Meldung angegeben',
  },
  NO_CONSUMERS: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'No consumers provided in Energy Sharing application',
    descriptionDe: 'Keine Verbraucher in der Energy-Sharing-Meldung angegeben',
  },
  MIXED_GRID_AREAS: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'Generators from different grid operator areas in one community',
    descriptionDe: 'Erzeuger aus verschiedenen Netzgebieten in einer Gemeinschaft',
  },
  GENERATOR_EXCEEDS_LIMIT: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 4,
    description: 'Generator capacity exceeds 1 MW limit for Energy Sharing',
    descriptionDe: 'Erzeugerleistung überschreitet 1-MW-Grenze für Energy Sharing',
  },
  CONSUMER_MALO_INVALID: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'Consumer MaLo ID format invalid (expected DE followed by 31 digits)',
    descriptionDe: 'MaLo-Format ungültig (erwartet: DE gefolgt von 31 Ziffern)',
  },
  CONSUMER_MALO_DUPLICATE: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 4,
    description: 'Duplicate MaLo ID in consumer list',
    descriptionDe: 'Doppelte MaLo-ID in der Verbraucherliste',
  },
  APPROVED: {
    severity: 'info',
    agent: 'energy-sharing',
    step: 5,
    description: 'Energy Sharing community approved without conditions',
    descriptionDe: 'Energy-Sharing-Gemeinschaft ohne Auflagen genehmigt',
  },
  APPROVED_WITH_CONDITIONS: {
    severity: 'warning',
    agent: 'energy-sharing',
    step: 5,
    description: 'Energy Sharing community approved with conditions',
    descriptionDe: 'Energy-Sharing-Gemeinschaft mit Auflagen genehmigt',
  },
  REJECTED_STRUCTURAL: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 5,
    description: 'Energy Sharing community rejected due to structural eligibility failure',
    descriptionDe: 'Abgelehnt wegen struktureller §42c-Unzulässigkeit',
  },
  REJECTED_GENERATOR_INVALID: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 5,
    description: 'Energy Sharing community rejected — invalid generator data',
    descriptionDe: 'Abgelehnt wegen ungültiger Erzeugerdaten',
  },
  REJECTED_OTHER: {
    severity: 'error',
    agent: 'energy-sharing',
    step: 5,
    description: 'Energy Sharing community rejected for other reasons',
    descriptionDe: 'Abgelehnt aus sonstigen Gründen',
  },
  // ── MaStR Data Quality (v0.17) — Steps 2–8 ──────────────────────────────
  MQ_INVENTORY_COMPLETE: {
    severity: 'info',
    agent: 'mastr-quality',
    step: 2,
    description: 'Portfolio inventory completed successfully',
    descriptionDe: 'Portfolio-Inventur abgeschlossen',
  },
  MQ_INVENTORY_EMPTY: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 2,
    description: 'No installations found for this VNB in MaStR',
    descriptionDe: 'Keine Anlagen für diesen VNB im MaStR gefunden',
  },
  MQ_STALE_PLANNING: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 3,
    description: 'Installation in "InPlanung" status for more than 2 years',
    descriptionDe: 'Anlage seit mehr als 2 Jahren im Status "InPlanung"',
  },
  MQ_STALE_TEMPORARY_SHUTDOWN: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 3,
    description: 'Installation temporarily shut down for more than 365 days',
    descriptionDe: 'Anlage seit mehr als 365 Tagen vorübergehend stillgelegt',
  },
  MQ_MISSING_COMMISSIONING_DATE: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 3,
    description: 'Operational installation is missing commissioning date',
    descriptionDe: 'Betriebsbereite Anlage ohne Inbetriebnahmedatum',
  },
  MQ_FUTURE_COMMISSIONING: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 3,
    description: 'Commissioning date is in the future',
    descriptionDe: 'Inbetriebnahmedatum liegt in der Zukunft',
  },
  MQ_NBP_PENDING: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 3,
    description: 'Netzbetreiberprüfung status is "In Prüfung" (code 2955)',
    descriptionDe: 'Netzbetreiberprüfung im Status "In Prüfung" (Code 2955)',
  },
  MQ_NBP_NOT_PLANNED: {
    severity: 'info',
    agent: 'mastr-quality',
    step: 3,
    description: 'Netzbetreiberprüfung is marked "NichtVorgesehen" (code 3075)',
    descriptionDe: 'Netzbetreiberprüfung als "NichtVorgesehen" markiert (Code 3075)',
  },
  MQ_ZERO_CAPACITY: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 4,
    description: 'Gross capacity (Bruttoleistung) is zero',
    descriptionDe: 'Bruttoleistung = 0',
  },
  MQ_NEGATIVE_CAPACITY: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 4,
    description: 'Capacity value is negative — data entry error',
    descriptionDe: 'Leistungswert negativ — Datenfehler',
  },
  MQ_IMPLAUSIBLE_HIGH_CAPACITY: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 4,
    description: 'Capacity is implausibly high for this installation type',
    descriptionDe: 'Leistung für diesen Anlagentyp unplausibel hoch',
  },
  MQ_NETTO_EXCEEDS_BRUTTO: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 4,
    description: 'Net capacity (Nettonennleistung) exceeds gross capacity — physical impossibility',
    descriptionDe: 'Nettonennleistung überschreitet Bruttoleistung — physikalisch unmöglich',
  },
  MQ_MISSING_FEED_IN_TYPE: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 4,
    description: 'Operational solar unit is missing Einspeisungsart',
    descriptionDe: 'Betriebsbereite Solaranlage ohne Einspeisungsart',
  },
  MQ_MISSING_NAP: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 5,
    description: 'Installation is missing a grid connection point (NAP)',
    descriptionDe: 'Anlage ohne Netzanschlusspunkt (NAP)',
  },
  MQ_MISSING_MELO: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 5,
    description: 'Operational installation ≥100 kW is missing a Messlokation (MeLo)',
    descriptionDe: 'Betriebsbereite Anlage ≥100 kW ohne Messlokation (MeLo)',
  },
  MQ_NAP_VNB_MISMATCH: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 5,
    description: 'NAP is assigned to a different grid operator',
    descriptionDe: 'NAP einem anderen Netzbetreiber zugeordnet',
  },
  MQ_VOLTAGE_MISMATCH: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 5,
    description: 'Installation ≥100 kW connected at low voltage (NS) — unusual',
    descriptionDe: 'Anlage ≥100 kW an Niederspannung (NS) angeschlossen — ungewöhnlich',
  },
  MQ_NAP_MULTI_UNIT: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 5,
    description: 'NAP is shared by more than 3 installations',
    descriptionDe: 'NAP von mehr als 3 Anlagen gemeinsam genutzt',
  },
  MQ_REDISPATCH_NO_NAP: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 5,
    description: 'Redispatch-relevant installation (≥100 kW) is missing a NAP',
    descriptionDe: 'Redispatch-relevante Anlage (≥100 kW) ohne NAP',
  },
  MQ_PROBABLE_DUPLICATE: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 6,
    description:
      'Probable duplicate: all 4 criteria match (PLZ + type + capacity ±10% + date ±90d)',
    descriptionDe: 'Wahrscheinliches Duplikat: alle 4 Kriterien erfüllt',
  },
  MQ_POSSIBLE_DUPLICATE: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 6,
    description: 'Possible duplicate: 3 of 4 criteria match',
    descriptionDe: 'Mögliches Duplikat: 3 von 4 Kriterien erfüllt',
  },
  MQ_GEO_DUPLICATE: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 6,
    description: 'Same-type installations within ±0.001° at identical coordinates',
    descriptionDe: 'Gleicher Anlagentyp an identischen Koordinaten (±0,001°)',
  },
  MQ_GEO_PLAUSIBLE: {
    severity: 'info',
    agent: 'mastr-quality',
    step: 7,
    description: 'Geo spot check passed — installation location is plausible',
    descriptionDe: 'Geo-Stichprobe bestanden — Standort plausibel',
  },
  MQ_GEO_MISASSIGNMENT: {
    severity: 'error',
    agent: 'mastr-quality',
    step: 7,
    description:
      'Geo spot check failed — installation location does not match registered grid area',
    descriptionDe: 'Geo-Stichprobe fehlgeschlagen — Standort stimmt nicht mit Netzgebiet überein',
  },
  MQ_GEO_CHECK_FAILED: {
    severity: 'warning',
    agent: 'mastr-quality',
    step: 7,
    description: 'Geo spot check could not be completed (OSM/Overpass unavailable)',
    descriptionDe:
      'Geo-Stichprobe konnte nicht durchgeführt werden (OSM/Overpass nicht erreichbar)',
  },
  // ── Redispatch Ex-Post (v0.18) — Steps 2–7 ──────────────────────────────
  RD_PORTFOLIO_COMPLETE: {
    severity: 'info',
    agent: 'redispatch-expost',
    step: 2,
    description: 'Redispatch portfolio (≥100 kW) loaded successfully',
    descriptionDe: 'Redispatch-Portfolio (≥100 kW) erfolgreich geladen',
  },
  RD_PORTFOLIO_EMPTY: {
    severity: 'error',
    agent: 'redispatch-expost',
    step: 2,
    description: 'No Redispatch-relevant installations (≥100 kW) found',
    descriptionDe: 'Keine Redispatch-relevanten Anlagen (≥100 kW) gefunden',
  },
  RD_PORTFOLIO_INCLUDES_INACTIVE: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 2,
    description: 'Portfolio contains non-operational installations',
    descriptionDe: 'Portfolio enthält nicht-betriebsbereite Anlagen',
  },
  RD_MISSING_NAP: {
    severity: 'error',
    agent: 'redispatch-expost',
    step: 3,
    description: 'Redispatch-relevant installation is missing a NAP',
    descriptionDe: 'Redispatch-relevante Anlage ohne NAP',
  },
  RD_MISSING_MELO: {
    severity: 'error',
    agent: 'redispatch-expost',
    step: 3,
    description: 'Redispatch-relevant installation is missing a MeLo',
    descriptionDe: 'Redispatch-relevante Anlage ohne MeLo',
  },
  RD_MISSING_BTR: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 3,
    description:
      'Remote control proxy (FernsteuerbarkeitDv) not set — DV assignment excluded from public exports',
    descriptionDe:
      'Fernsteuerbarkeits-Proxy nicht gesetzt — DV-Zuordnung aus öffentlichen Exporten ausgeschlossen',
  },
  RD_NAP_VNB_MISMATCH: {
    severity: 'error',
    agent: 'redispatch-expost',
    step: 3,
    description: 'NAP is assigned to a different grid operator than expected',
    descriptionDe: 'NAP einem anderen Netzbetreiber zugeordnet als erwartet',
  },
  RD_DV_NOT_CONTROLLABLE: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 3,
    description: 'Direktvermarkter registered but remote control is not active',
    descriptionDe: 'Direktvermarkter registriert, aber Fernsteuerbarkeit nicht aktiv',
  },
  RD_CAPACITY_ANOMALY: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 3,
    description: 'Capacity value is anomalous for this installation type',
    descriptionDe: 'Leistungswert für diesen Anlagentyp anomal',
  },
  RD_CURTAILMENT_VOLUME: {
    severity: 'info',
    agent: 'redispatch-expost',
    step: 4,
    description: 'Curtailment data retrieved from Netztransparenz',
    descriptionDe: 'Abregelungsdaten von Netztransparenz abgerufen',
  },
  RD_HIGH_CURTAILMENT_PERIOD: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 4,
    description: 'High curtailment frequency detected (>100 measures/month)',
    descriptionDe: 'Hohe Abregelungsfrequenz erkannt (>100 Maßnahmen/Monat)',
  },
  RD_CURTAILMENT_DATA_UNAVAILABLE: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 4,
    description: 'Netztransparenz curtailment data unavailable — using 0 GWh fallback',
    descriptionDe: 'Netztransparenz-Daten nicht verfügbar — 0 GWh-Fallback verwendet',
  },
  RD_CURTAILMENT_ZERO: {
    severity: 'info',
    agent: 'redispatch-expost',
    step: 4,
    description: 'No curtailment recorded in Netztransparenz for this period',
    descriptionDe: 'Keine Abregelung in Netztransparenz für diesen Zeitraum erfasst',
  },
  RD_SETTLEMENT_READY: {
    severity: 'info',
    agent: 'redispatch-expost',
    step: 5,
    description: 'All installations ready for A96 settlement (100%)',
    descriptionDe: 'Alle Anlagen abrechnungsbereit (100%)',
  },
  RD_SETTLEMENT_PARTIAL: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 5,
    description: 'Partial settlement readiness (80–99%) — some installations blocked',
    descriptionDe: 'Teilweise Abrechnungsbereitschaft (80–99%) — einzelne Anlagen blockiert',
  },
  RD_SETTLEMENT_CRITICAL: {
    severity: 'error',
    agent: 'redispatch-expost',
    step: 5,
    description: 'Critical settlement readiness (<80%) — majority of installations blocked',
    descriptionDe: 'Kritische Abrechnungsbereitschaft (<80%) — Mehrheit der Anlagen blockiert',
  },
  RD_RISK_LOW: {
    severity: 'info',
    agent: 'redispatch-expost',
    step: 6,
    description: 'Low financial risk from unsettled redispatch (estimated <€10k)',
    descriptionDe: 'Geringes finanzielles Risiko durch nicht abgerechneten Redispatch (<10.000 €)',
  },
  RD_RISK_MEDIUM: {
    severity: 'warning',
    agent: 'redispatch-expost',
    step: 6,
    description: 'Medium financial risk from unsettled redispatch (estimated €10k–€100k)',
    descriptionDe: 'Mittleres finanzielles Risiko (10.000–100.000 €)',
  },
  RD_RISK_HIGH: {
    severity: 'error',
    agent: 'redispatch-expost',
    step: 6,
    description: 'High financial risk from unsettled redispatch (estimated >€100k)',
    descriptionDe: 'Hohes finanzielles Risiko (>100.000 €)',
  },
  // ── Finance Agent (v0.40) — Steps 1–6 ───────────────────────────────────
  FA_QUERY_PLANNED: {
    severity: 'info',
    agent: 'finance-agent',
    step: 1,
    description: 'Finance query plan generated with ontology and legal retrieval intents',
    descriptionDe: 'Finanz-Query-Plan mit Ontologie- und Rechtsreferenz-Intents wurde erzeugt',
  },
  FA_EVIDENCE_RETRIEVED: {
    severity: 'info',
    agent: 'finance-agent',
    step: 2,
    description: 'Evidence retrieved from Knowledge RAG and normalised for arbitration',
    descriptionDe: 'Evidenz aus Knowledge RAG abgerufen und für die Arbitration normalisiert',
  },
  FA_RULE_EVIDENCE_USED: {
    severity: 'info',
    agent: 'finance-agent',
    step: 3,
    description: 'L1 rule evidence selected as primary source of truth',
    descriptionDe: 'L1-Regel-Evidenz als primäre Wahrheitsquelle ausgewählt',
  },
  FA_HYDE_CONTEXT_USED: {
    severity: 'info',
    agent: 'finance-agent',
    step: 3,
    description: 'L2 HyDE context included as secondary explanatory evidence',
    descriptionDe: 'L2-HyDE-Kontext als sekundäre Erklärungsevidenz eingebunden',
  },
  FA_RULE_HYDE_CONFLICT: {
    severity: 'warning',
    agent: 'finance-agent',
    step: 4,
    description: 'Conflict detected between L1 rule and L2 HyDE polarity',
    descriptionDe: 'Konflikt zwischen L1-Regel- und L2-HyDE-Aussage erkannt',
  },
  FA_REGULATORY_REFERENCES_MISSING: {
    severity: 'warning',
    agent: 'finance-agent',
    step: 4,
    description: 'No explicit legal references found in selected evidence',
    descriptionDe: 'Keine expliziten Rechtsreferenzen in ausgewählter Evidenz gefunden',
  },
  FA_SYNTHESIS_GUARDED: {
    severity: 'info',
    agent: 'finance-agent',
    step: 5,
    description: 'Guarded synthesis completed using evidence-bound claims only',
    descriptionDe: 'Guarded Synthesis nur mit evidenzgebundenen Aussagen abgeschlossen',
  },
  FA_NEEDS_CLARIFICATION: {
    severity: 'warning',
    agent: 'finance-agent',
    step: 5,
    description: 'Insufficient evidence for a legally robust answer — clarification required',
    descriptionDe: 'Evidenz für rechtssichere Antwort unzureichend — Präzisierung erforderlich',
  },
  // ── VDMI Governance (v0.50) — Steps 2–6 ────────────────────────────────
  VD_ROLE_VD_DECOUPLING_M: {
    severity: 'warning',
    agent: 'vdmi',
    step: 2,
    description: 'Formal V owner and de-facto D executor are persistently decoupled',
    descriptionDe: 'Formale V-Rolle und de-facto D-Ausführung sind dauerhaft entkoppelt',
  },
  VD_ROLE_V_OWNER_ABSENT_H: {
    severity: 'error',
    agent: 'vdmi',
    step: 2,
    description: 'Task execution completed without evidenced V-owner decision',
    descriptionDe:
      'Task-Ausführung ohne nachweisbare Entscheidung der vorgesehenen V-Rolle abgeschlossen',
  },
  VD_SHADOW_EXCEL_EXEC_H: {
    severity: 'error',
    agent: 'vdmi',
    step: 3,
    description: 'Critical process step is primarily executed through Excel shadow path',
    descriptionDe: 'Kritischer Prozessschritt wird primär über einen Excel-Schattenpfad ausgeführt',
  },
  VD_SHADOW_SHAREPOINT_BYPASS_H: {
    severity: 'error',
    agent: 'vdmi',
    step: 3,
    description: 'SharePoint or mail event bypasses the intended audited system path',
    descriptionDe: 'SharePoint- oder Mail-Event umgeht den vorgesehenen auditierbaren Systempfad',
  },
  VD_SILO_HANDOVER_MANUAL_M: {
    severity: 'warning',
    agent: 'vdmi',
    step: 4,
    description: 'Cross-domain handover is manual instead of using defined integration interfaces',
    descriptionDe:
      'Bereichsübergreifende Übergabe erfolgt manuell statt über definierte Integrationsschnittstellen',
  },
  VD_SILO_KERNSYSTEM_BLOCK_M: {
    severity: 'warning',
    agent: 'vdmi',
    step: 4,
    description: 'Core system access is blocked, resulting in recurring workaround execution',
    descriptionDe:
      'Kernsystemzugriff ist blockiert, wodurch wiederkehrende Workaround-Ausführung entsteht',
  },
  VD_UNBUNDLE_PSEUDO_ARG_H: {
    severity: 'error',
    agent: 'vdmi',
    step: 5,
    description: 'Unbundling argument is used to bypass auditable standard process boundaries',
    descriptionDe:
      'Unbundling-Argumentation wird genutzt, um auditierbare Standardprozessgrenzen zu umgehen',
  },
  VD_GOV_AUDIT_GAP_K: {
    severity: 'error',
    agent: 'vdmi',
    step: 6,
    description: 'Critical governance deviation detected with incomplete audit evidence chain',
    descriptionDe: 'Kritische Governance-Abweichung mit unvollständiger Audit-Evidenzkette erkannt',
  },

  BLINDFLUG_ANOMALY_DETECTED: {
    severity: 'warning',
    agent: 'blindflug-radar',
    step: 1,
    description: 'Blindflug Radar identified an anomaly based on disturbance patterns',
    descriptionDe: 'Blindflug-Radar hat eine Anomalie auf Basis von Störungsmustern erkannt',
  },
  VD_GOV_RECURRENCE_K: {
    severity: 'error',
    agent: 'vdmi',
    step: 6,
    description: 'High-risk governance deviation recurs despite prior mitigation',
    descriptionDe: 'Hochrisiko-Governance-Abweichung tritt trotz vorheriger Maßnahme erneut auf',
  },

  // ---------------------------------------------------------------------------
  // Netzfahrplan / fNAV finding codes (v0.51.5)
  // ---------------------------------------------------------------------------

  FN_PROFILE_COMPLETE: {
    severity: 'info',
    agent: 'netzfahrplan',
    step: 1,
    description: 'fNAV profile has all required capacity and contract fields',
    descriptionDe: 'fNAV-Profil enthält alle erforderlichen Kapazitäts- und Vertragsfelder',
  },
  FN_PROFILE_PARTIAL: {
    severity: 'warning',
    agent: 'netzfahrplan',
    step: 1,
    description: 'fNAV profile is incomplete — some fields are missing or unknown',
    descriptionDe: 'fNAV-Profil unvollständig — einige Felder fehlen oder sind unbekannt',
  },
  FN_PROFILE_INSUFFICIENT: {
    severity: 'error',
    agent: 'netzfahrplan',
    step: 1,
    description: 'fNAV profile has too many missing fields for a reliable assessment',
    descriptionDe: 'fNAV-Profil weist zu viele fehlende Felder für eine belastbare Bewertung auf',
  },
  FN_N1_PASS: {
    severity: 'info',
    agent: 'netzfahrplan',
    step: 2,
    description: 'Resulting effective capacity is within the N-1 threshold',
    descriptionDe: 'Resultierende Wirkkapazität liegt unter dem N-1-Grenzwert',
  },
  FN_N1_FAIL: {
    severity: 'error',
    agent: 'netzfahrplan',
    step: 2,
    description:
      'Resulting effective capacity exceeds the N-1 threshold — grid expansion may be required',
    descriptionDe: 'Wirkkapazität überschreitet N-1-Grenzwert — Netzausbau ggf. erforderlich',
  },
  FN_N1_MARGINAL: {
    severity: 'warning',
    agent: 'netzfahrplan',
    step: 2,
    description: 'N-1 utilisation is above 85 % — marginal headroom, fNAV recommended',
    descriptionDe: 'N-1-Auslastung über 85 % — knappes Headroom, fNAV empfohlen',
  },
  FN_FLEX_NAV_FEASIBLE: {
    severity: 'info',
    agent: 'netzfahrplan',
    step: 3,
    description:
      'Flexible NAV (§14a EnWG) is technically feasible as an alternative to grid expansion',
    descriptionDe:
      'Flexibler NAV (§14a EnWG) ist technisch als Alternative zu Kupferausbau machbar',
  },
  FN_CAPACITY_CONDITIONAL: {
    severity: 'warning',
    agent: 'netzfahrplan',
    step: 3,
    description: 'Connection capacity conditional on fNAV curtailment constraints being honoured',
    descriptionDe: 'Anschlusskapazität bedingt durch fNAV-Abregelungsbeschränkungen',
  },
  FN_CAPACITY_COPPER_NEEDED: {
    severity: 'error',
    agent: 'netzfahrplan',
    step: 3,
    description: 'Flexible NAV is insufficient — conventional grid expansion (copper) is required',
    descriptionDe:
      'Flexibler NAV reicht nicht aus — konventioneller Netzausbau (Kupfer) erforderlich',
  },
  FN_GOVERNANCE_APPROVED: {
    severity: 'info',
    agent: 'netzfahrplan',
    step: 4,
    description: 'All governance prerequisites are met — fNAV can proceed',
    descriptionDe: 'Alle Governance-Voraussetzungen erfüllt — fNAV kann umgesetzt werden',
  },
  FN_GOVERNANCE_REQUIRED: {
    severity: 'warning',
    agent: 'netzfahrplan',
    step: 4,
    description:
      'Governance decision required before fNAV can be finalised (legal/contract/owner gap)',
    descriptionDe:
      'Governance-Entscheidung erforderlich vor fNAV-Abschluss (Rechts-/Vertrags-/Owner-Lücke)',
  },
  FN_ECONOMICS_AVAILABLE: {
    severity: 'info',
    agent: 'netzfahrplan',
    step: 5,
    description:
      'fNAV economics calculated: avoided CAPEX, annual fee, and payback period available',
    descriptionDe:
      'fNAV-Wirtschaftlichkeit berechnet: vermiedener CAPEX, Jahresbeitrag und Amortisation verfügbar',
  },
  FN_ECONOMICS_PARTIAL: {
    severity: 'warning',
    agent: 'netzfahrplan',
    step: 5,
    description:
      'fNAV economics partially calculated — eog-calculator data unavailable, estimates used',
    descriptionDe:
      'fNAV-Wirtschaftlichkeit nur teilweise berechnet — eog-calculator-Daten nicht verfügbar',
  },

  // ── File Ingest Monitor (v0.62) ──────────────────────────────────────────
  FIM_FILE_MISSING: {
    severity: 'error',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'Watch path directory or expected file is missing',
    descriptionDe: 'Überwachungspfad oder erwartete Datei fehlt',
  },
  FIM_FILE_STALE: {
    severity: 'warning',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'File has not been updated within the configured staleness window',
    descriptionDe: 'Datei wurde innerhalb des Staleness-Fensters nicht aktualisiert',
  },
  FIM_SCHEMA_MISMATCH: {
    severity: 'error',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'File structure does not match the registered schema definition',
    descriptionDe: 'Dateistruktur stimmt nicht mit dem registrierten Schema überein',
  },
  FIM_PARSE_ERROR: {
    severity: 'error',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'File could not be parsed — encoding, delimiter, or format error',
    descriptionDe:
      'Datei konnte nicht geparst werden — Kodierungs-, Trennzeichen- oder Formatfehler',
  },
  FIM_ERROR_FOLDER_PRESENT: {
    severity: 'error',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'Error folder exists and contains files — upstream ingest failures detected',
    descriptionDe:
      'Fehlerordner vorhanden und enthält Dateien — vorgelagerte Ingest-Fehler erkannt',
  },
  FIM_REQUIRED_COLUMNS_MISSING: {
    severity: 'error',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'CSV file is missing one or more required columns defined in the schema',
    descriptionDe: 'CSV-Datei fehlt eine oder mehrere im Schema definierte Pflicht-Spalten',
  },
  FIM_MONITOR_HEALTHY: {
    severity: 'info',
    agent: 'file-ingest-monitor',
    step: 1,
    description: 'All monitored files are present, current, and schema-compliant',
    descriptionDe: 'Alle überwachten Dateien vorhanden, aktuell und schema-konform',
  },

  // ── Redispatch Asset Register (v0.62) ────────────────────────────────────
  RDAR_RESOURCE_MAPPING_MISSING: {
    severity: 'warning',
    agent: 'redispatch-asset-register',
    step: 1,
    description: 'No technical resource ID (BTR) mapping found for this MaStR unit',
    descriptionDe: 'Keine Technische-Ressource-ID (BTR)-Zuordnung für diese MaStR-Einheit gefunden',
  },
  RDAR_IDENTIFIER_CONFLICT: {
    severity: 'error',
    agent: 'redispatch-asset-register',
    step: 1,
    description: 'Conflicting identifiers detected across source systems for this asset',
    descriptionDe: 'Widersprüchliche Kennungen aus verschiedenen Quellsystemen für diese Anlage',
  },
  RDAR_MARKET_LOCATION_MISSING: {
    severity: 'error',
    agent: 'redispatch-asset-register',
    step: 1,
    description: 'Neither MaLo (MaloId) nor MeLo (MeloId) is assigned to this asset',
    descriptionDe: 'Weder MaLo (MaloId) noch MeLo (MeloId) dieser Anlage zugeordnet',
  },
  RDAR_CONTROL_GROUP_AMBIGUOUS: {
    severity: 'warning',
    agent: 'redispatch-asset-register',
    step: 1,
    description:
      'Control group assignment cannot be determined without operator evidence reference',
    descriptionDe:
      'Steuergruppenzuordnung ohne Betreiber-Evidenz-Referenz nicht eindeutig bestimmbar',
  },
  RDAR_CO_LOCATION_UNRESOLVED: {
    severity: 'warning',
    agent: 'redispatch-asset-register',
    step: 1,
    description: 'Co-location relationship exists but target asset could not be resolved',
    descriptionDe: 'Co-Location-Beziehung vorhanden, aber Zielanlage konnte nicht aufgelöst werden',
  },
  RDAR_ASSET_PROJECTION_COMPLETE: {
    severity: 'info',
    agent: 'redispatch-asset-register',
    step: 1,
    description: 'Asset projection is complete — all required identifiers and evidence present',
    descriptionDe:
      'Asset-Projektion vollständig — alle erforderlichen Kennungen und Evidenzen vorhanden',
  },

  // ── Redispatch Data Governance (v0.62) ───────────────────────────────────
  RDG_DEADLINE_MISSED: {
    severity: 'error',
    agent: 'redispatch-data-governance',
    step: 1,
    description: 'Data delivery deadline has been missed for this process and period',
    descriptionDe: 'Datenlieferdeadline für diesen Prozess und Zeitraum wurde versäumt',
  },
  RDG_OWNER_UNASSIGNED: {
    severity: 'warning',
    agent: 'redispatch-data-governance',
    step: 1,
    description: 'No owner is assigned to the governance policy for this data class',
    descriptionDe: 'Kein Verantwortlicher für die Governance-Policy dieser Datenklasse zugewiesen',
  },
  RDG_SOURCE_OF_RECORD_UNRESOLVED: {
    severity: 'warning',
    agent: 'redispatch-data-governance',
    step: 1,
    description: 'Preferred source of record is not available in the provided source list',
    descriptionDe:
      'Bevorzugte Datenquelle ist in der bereitgestellten Quellenliste nicht verfügbar',
  },
  RDG_GOVERNANCE_POLICY_MISSING: {
    severity: 'error',
    agent: 'redispatch-data-governance',
    step: 1,
    description: 'No governance policy found for this data class and process combination',
    descriptionDe: 'Keine Governance-Policy für diese Datenklasse- und Prozesskombination gefunden',
  },
  RDG_DATA_CONFLICT: {
    severity: 'error',
    agent: 'redispatch-data-governance',
    step: 1,
    description: 'Conflicting data values detected across source systems',
    descriptionDe: 'Widersprüchliche Datenwerte in verschiedenen Quellsystemen erkannt',
  },
  RDG_GOVERNANCE_COMPLIANT: {
    severity: 'info',
    agent: 'redispatch-data-governance',
    step: 1,
    description: 'Governance evaluation passed — all policy criteria met',
    descriptionDe: 'Governance-Evaluierung bestanden — alle Policy-Kriterien erfüllt',
  },

  // ── Redispatch Settlement Sandbox (v0.62) ────────────────────────────────
  RDSS_MISSING_SCENARIO: {
    severity: 'error',
    agent: 'redispatch-settlement-sandbox',
    step: 1,
    description: 'Scenario has no input artifact references — reconciliation cannot proceed',
    descriptionDe: 'Szenario hat keine Eingabe-Artefakt-Referenzen — Abstimmung nicht möglich',
  },
  RDSS_RECONCILIATION_DEVIATION: {
    severity: 'warning',
    agent: 'redispatch-settlement-sandbox',
    step: 1,
    description: 'Reconciliation result deviates from expected settlement baseline',
    descriptionDe: 'Abstimmungsergebnis weicht von der erwarteten Abrechnungsbasislinie ab',
  },
  RDSS_MISSING_DATAPOINT_EVIDENCE: {
    severity: 'error',
    agent: 'redispatch-settlement-sandbox',
    step: 1,
    description: 'Settlement service unavailable or required datapoint evidence is missing',
    descriptionDe: 'Abrechnungsdienst nicht verfügbar oder erforderliche Datenpunkt-Evidenz fehlt',
  },
  RDSS_POLICY_VERSION_MISMATCH: {
    severity: 'warning',
    agent: 'redispatch-settlement-sandbox',
    step: 1,
    description: 'Scenario policy version does not match current governance policy version',
    descriptionDe:
      'Szenario-Policy-Version stimmt nicht mit aktueller Governance-Policy-Version überein',
  },
  RDSS_SCENARIO_COMPLETE: {
    severity: 'info',
    agent: 'redispatch-settlement-sandbox',
    step: 1,
    description: 'Settlement scenario reconciliation completed successfully',
    descriptionDe: 'Abrechnungsszenario-Abstimmung erfolgreich abgeschlossen',
  },

  // ── Redispatch Special Case Gate (v0.62) ─────────────────────────────────
  RSCG_CO_LOCATION_CONFIRMED: {
    severity: 'info',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Co-location relationship confirmed for this asset',
    descriptionDe: 'Co-Location-Beziehung für diese Anlage bestätigt',
  },
  RSCG_CO_LOCATION_UNCONFIRMED: {
    severity: 'warning',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'No co-location relationship found for this asset',
    descriptionDe: 'Keine Co-Location-Beziehung für diese Anlage gefunden',
  },
  RSCG_CONTROLLABILITY_CONFIRMED: {
    severity: 'info',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Remote controllability (FernsteuerbarkeitDv) confirmed for this asset',
    descriptionDe: 'Fernsteuerbarkeit (FernsteuerbarkeitDv) für diese Anlage bestätigt',
  },
  RSCG_CONTROLLABILITY_MISSING: {
    severity: 'error',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Remote controllability (FernsteuerbarkeitDv) is not active for this asset',
    descriptionDe: 'Fernsteuerbarkeit (FernsteuerbarkeitDv) für diese Anlage nicht aktiv',
  },
  RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT: {
    severity: 'info',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Non-availability evidence references provided for Nichtverfügbarkeit check',
    descriptionDe: 'Nichtverfügbarkeits-Evidenzreferenzen für Nichtverfügbarkeitsprüfung vorhanden',
  },
  RSCG_NON_AVAILABILITY_EVIDENCE_MISSING: {
    severity: 'warning',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'No non-availability evidence references provided',
    descriptionDe: 'Keine Nichtverfügbarkeits-Evidenzreferenzen vorhanden',
  },
  RSCG_DEVIATION_WITHIN_TOLERANCE: {
    severity: 'info',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Deviation tolerance parameter is within acceptable range',
    descriptionDe: 'Abweichungstoleranzparameter liegt im akzeptablen Bereich',
  },
  RSCG_DEVIATION_EXCEEDS_TOLERANCE: {
    severity: 'error',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Measured deviation exceeds the configured tolerance threshold',
    descriptionDe: 'Gemessene Abweichung überschreitet den konfigurierten Toleranzschwellenwert',
  },
  RSCG_GATE_READY: {
    severity: 'info',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'All gate criteria passed — asset cleared for Redispatch special case processing',
    descriptionDe:
      'Alle Gate-Kriterien bestanden — Anlage für Redispatch-Sonderfall-Verarbeitung freigegeben',
  },
  RSCG_GATE_BLOCKED: {
    severity: 'error',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description: 'Gate blocked — one or more error-severity criteria failed',
    descriptionDe: 'Gate gesperrt — ein oder mehrere fehler-schwere Kriterien nicht erfüllt',
  },
  RSCG_GATE_INSUFFICIENT_EVIDENCE: {
    severity: 'warning',
    agent: 'redispatch-special-case-gate',
    step: 1,
    description:
      'Gate cannot be fully evaluated — upstream service unavailable for one or more checks',
    descriptionDe:
      'Gate kann nicht vollständig bewertet werden — vorgelagerter Dienst für eine oder mehrere Prüfungen nicht verfügbar',
  },

  // ── Redispatch Readiness Gate (v0.63) ───────────────────────────────────
  RRG_ACCESS_MATRIX_COMPLETE: {
    severity: 'info',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch GUI, SFTP, test-system and production-system access are confirmed',
    descriptionDe: 'Redispatch-GUI, SFTP, Testsystem und Produktivsystem sind bestaetigt',
  },
  RRG_ACCESS_MATRIX_INCOMPLETE: {
    severity: 'error',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'One or more required Redispatch access paths are missing',
    descriptionDe: 'Ein oder mehrere erforderliche Redispatch-Zugaenge fehlen',
  },
  RRG_TEST_CALL_PASSED: {
    severity: 'info',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch test call passed',
    descriptionDe: 'Redispatch-Testabruf bestanden',
  },
  RRG_TEST_CALL_MISSING: {
    severity: 'warning',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch test call is missing or pending',
    descriptionDe: 'Redispatch-Testabruf fehlt oder ist offen',
  },
  RRG_TEST_CALL_FAILED: {
    severity: 'error',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch test call failed',
    descriptionDe: 'Redispatch-Testabruf fehlgeschlagen',
  },
  RRG_PRODUCTION_PROOF_CONFIRMED: {
    severity: 'info',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Production readiness proof is confirmed',
    descriptionDe: 'Produktivreife-Nachweis bestaetigt',
  },
  RRG_PRODUCTION_PROOF_MISSING: {
    severity: 'error',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Production readiness proof is missing',
    descriptionDe: 'Produktivreife-Nachweis fehlt',
  },
  RRG_TEMPLATE_VERSION_CURRENT: {
    severity: 'info',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch master-data template version is current',
    descriptionDe: 'Redispatch-Stammdatentemplate ist aktuell',
  },
  RRG_TEMPLATE_VERSION_OUTDATED: {
    severity: 'warning',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch master-data template version is outdated',
    descriptionDe: 'Redispatch-Stammdatentemplate ist veraltet',
  },
  RRG_OPEN_QUESTIONS_PRESENT: {
    severity: 'warning',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Open Redispatch readiness questions remain',
    descriptionDe: 'Offene Redispatch-Readiness-Fragen vorhanden',
  },
  RRG_RESPONSIBLE_ROLE_ASSIGNED: {
    severity: 'info',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Responsible IT/business role is assigned',
    descriptionDe: 'Verantwortliche IT-/Fachrolle ist zugewiesen',
  },
  RRG_RESPONSIBLE_ROLE_MISSING: {
    severity: 'warning',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Responsible IT/business role is missing',
    descriptionDe: 'Verantwortliche IT-/Fachrolle fehlt',
  },
  RRG_ACCEPTANCE_DEADLINE_MISSED: {
    severity: 'error',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Acceptance deadline has been missed',
    descriptionDe: 'Abnahmefrist wurde verpasst',
  },
  RRG_ACCEPTANCE_DEADLINE_APPROACHING: {
    severity: 'warning',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Acceptance deadline is approaching',
    descriptionDe: 'Abnahmefrist rueckt naeher',
  },
  RRG_GATE_READY: {
    severity: 'info',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch readiness gate is ready',
    descriptionDe: 'Redispatch-Readiness-Gate ist bereit',
  },
  RRG_GATE_READY_WITH_WARNINGS: {
    severity: 'warning',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch readiness gate is ready with warnings',
    descriptionDe: 'Redispatch-Readiness-Gate ist mit Warnungen bereit',
  },
  RRG_GATE_BLOCKED: {
    severity: 'error',
    agent: 'redispatch-readiness-gate',
    step: 1,
    description: 'Redispatch readiness gate is blocked',
    descriptionDe: 'Redispatch-Readiness-Gate ist blockiert',
  },

  // ── Battery Redispatch Special Gate (v0.63) ─────────────────────────────
  BRS_MALO_DIRECTION_MISSING: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery storage MaLo/MeLo role or injection/withdrawal direction is incomplete',
    descriptionDe:
      'Speicher-MaLo/MeLo-Rolle oder Einspeise-/Lastaufnahme-Richtung ist unvollstaendig',
  },
  BRS_METERING_CONCEPT_MISSING: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery storage metering concept or MeLo references are missing',
    descriptionDe: 'Speicher-Messkonzept oder MeLo-Referenzen fehlen',
  },
  BRS_REDISPATCH_DIRECTION_INCOMPLETE: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Positive and negative Redispatch eligibility are not both explicit',
    descriptionDe: 'Positive und negative Redispatch-Faehigkeit sind nicht beide explizit',
  },
  BRS_CONTROLLABILITY_DIRECTION_MISSING: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery storage controllability direction is missing',
    descriptionDe: 'Steuerbarkeitsrichtung des Speichers fehlt',
  },
  BRS_TEST_CALL_PROOF_MISSING: {
    severity: 'warning',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery Redispatch test-call proof is missing',
    descriptionDe: 'Speicher-Redispatch-Testabrufnachweis fehlt',
  },
  BRS_PRODUCTION_PROOF_MISSING: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery Redispatch production proof is missing',
    descriptionDe: 'Speicher-Redispatch-Produktivnachweis fehlt',
  },
  BRS_SETTLEMENT_DIRECTION_CONFLICT: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Settlement, clearing or billing decision blocks the battery Redispatch gate',
    descriptionDe:
      'Settlement-, Clearing- oder Abrechnungsentscheidung blockiert das Speicher-Redispatch-Gate',
  },
  BRS_GATE_READY: {
    severity: 'info',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery Redispatch special gate is ready',
    descriptionDe: 'Batteriespeicher-Redispatch-Sondergate ist bereit',
  },
  BRS_GATE_BLOCKED: {
    severity: 'error',
    agent: 'battery-redispatch-special-gate',
    step: 1,
    description: 'Battery Redispatch special gate is blocked',
    descriptionDe: 'Batteriespeicher-Redispatch-Sondergate ist blockiert',
  },

  // ── Flexibility Conductor Role Model (v0.63) ───────────────────────────
  FCRM_DECISION_RIGHTS_MISSING: {
    severity: 'error',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor role-model decision rights are incomplete',
    descriptionDe: 'Entscheidungsrechte im Flexibilitaetsdirigent-Rollenmodell sind unvollstaendig',
  },
  FCRM_CONTROL_BOUNDARY_MISSING: {
    severity: 'error',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor control-command boundary is missing',
    descriptionDe: 'Steuerbefehlsgrenze im Flexibilitaetsdirigent-Rollenmodell fehlt',
  },
  FCRM_MONITORING_OWNER_MISSING: {
    severity: 'warning',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor software monitoring owner is missing',
    descriptionDe: 'Owner fuer Softwareueberwachung im Flexibilitaetsdirigent-Rollenmodell fehlt',
  },
  FCRM_COMMERCIAL_OWNER_MISSING: {
    severity: 'warning',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor commercial value owner is missing',
    descriptionDe:
      'Owner fuer kaufmaennischen Mehrwert im Flexibilitaetsdirigent-Rollenmodell fehlt',
  },
  FCRM_ESCALATION_PATH_MISSING: {
    severity: 'error',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor escalation path is missing',
    descriptionDe: 'Eskalationspfad im Flexibilitaetsdirigent-Rollenmodell fehlt',
  },
  FCRM_SOURCE_ACTIONS_MISSING: {
    severity: 'warning',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor source action references are missing',
    descriptionDe: 'Quell-Action-Referenzen im Flexibilitaetsdirigent-Rollenmodell fehlen',
  },
  FCRM_ROLE_MODEL_READY: {
    severity: 'info',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor role model is ready',
    descriptionDe: 'Flexibilitaetsdirigent-Rollenmodell ist bereit',
  },
  FCRM_ROLE_MODEL_BLOCKED: {
    severity: 'error',
    agent: 'flexibility-conductor-role-model',
    step: 1,
    description: 'Flexibility conductor role model is blocked',
    descriptionDe: 'Flexibilitaetsdirigent-Rollenmodell ist blockiert',
  },

  // ── Knowledge Continuity Governance Gate (v0.63) ───────────────────────
  KCGG_DECISION_RIGHTS_MISSING: {
    severity: 'error',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Knowledge-continuity permission owner is missing',
    descriptionDe: 'Berechtigungsowner fuer Wissenssicherung fehlt',
  },
  KCGG_CONTROL_BOUNDARY_MISSING: {
    severity: 'error',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Knowledge-continuity admin owner is missing',
    descriptionDe: 'Admin-Owner fuer Wissenssicherung fehlt',
  },
  KCGG_MONITORING_OWNER_MISSING: {
    severity: 'warning',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Primary knowledge folder reference is missing',
    descriptionDe: 'Hauptordner-Referenz fuer Wissenssicherung fehlt',
  },
  KCGG_COMMERCIAL_OWNER_MISSING: {
    severity: 'warning',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Handover document reference is missing',
    descriptionDe: 'Uebergabedokument-Referenz fehlt',
  },
  KCGG_ESCALATION_PATH_MISSING: {
    severity: 'error',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Durable communication or retention boundary is missing',
    descriptionDe: 'Dauerhafte Kommunikations- oder Loeschgrenze fehlt',
  },
  KCGG_SOURCE_ACTIONS_MISSING: {
    severity: 'warning',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Knowledge-continuity source action references are missing',
    descriptionDe: 'Quell-Action-Referenzen fuer Wissenssicherung fehlen',
  },
  KCGG_GOVERNANCE_GATE_READY: {
    severity: 'info',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Knowledge-continuity governance gate is ready',
    descriptionDe: 'Wissenssicherungs-Governance-Gate ist bereit',
  },
  KCGG_GOVERNANCE_GATE_BLOCKED: {
    severity: 'error',
    agent: 'knowledge-continuity-governance-gate',
    step: 1,
    description: 'Knowledge-continuity governance gate is blocked',
    descriptionDe: 'Wissenssicherungs-Governance-Gate ist blockiert',
  },

  // ── Investment Maturity Off-Balance Gate (v0.63) ────────────────────────
  IMOB_MATURITY_MODEL_MISSING: {
    severity: 'error',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Investment maturity model is missing',
    descriptionDe: 'Investitionsreifegradmodell fehlt',
  },
  IMOB_PROCESS_QUALITY_LOW: {
    severity: 'warning',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Investment process quality is missing or below threshold',
    descriptionDe: 'Prozessqualitaet ist fehlend oder unterhalb des Gate-Schwellenwerts',
  },
  IMOB_FINANCING_COST_MISSING: {
    severity: 'error',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Additional financing cost evidence is missing',
    descriptionDe: 'Nachweis zu Finanzierungszusatzkosten fehlt',
  },
  IMOB_REGULATORY_RETURN_HYPOTHESIS_MISSING: {
    severity: 'warning',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Regulatory return hypothesis is missing',
    descriptionDe: 'Regulatorische Return-Hypothese fehlt',
  },
  IMOB_ASSET_RISK_REFERENCE_MISSING: {
    severity: 'error',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Asset-risk reference is missing',
    descriptionDe: 'Asset-Risiko-Referenz fehlt',
  },
  IMOB_ISO_RISK_REFERENCE_MISSING: {
    severity: 'warning',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'ISO/risk-control reference is missing',
    descriptionDe: 'ISO-/Risikoreferenz fehlt',
  },
  IMOB_DECISION_FORUM_MISSING: {
    severity: 'error',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Responsible decision forum is missing',
    descriptionDe: 'Verantwortliches Entscheidungsforum fehlt',
  },
  IMOB_SOURCE_ACTIONS_MISSING: {
    severity: 'warning',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Source action references are missing',
    descriptionDe: 'Quell-Action-Referenzen fehlen',
  },
  IMOB_GATE_READY: {
    severity: 'info',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Investment maturity off-balance gate is ready',
    descriptionDe: 'Investitionsreifegrad-Off-Balance-Gate ist bereit',
  },
  IMOB_GATE_BLOCKED: {
    severity: 'error',
    agent: 'investment-maturity-off-balance-gate',
    step: 1,
    description: 'Investment maturity off-balance gate is blocked',
    descriptionDe: 'Investitionsreifegrad-Off-Balance-Gate ist blockiert',
  },

  // ── Gas Capacity Order Revision Gate (v0.63) ───────────────────────────
  GCORG_TOOL_VALUE_MISSING: {
    severity: 'error',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Gas-capacity order tool value is missing',
    descriptionDe: 'Toolwert fuer Gaskapazitaetsbestellung fehlt',
  },
  GCORG_COLD_YEAR_SCENARIO_MISSING: {
    severity: 'error',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Cold-year scenario evidence is missing',
    descriptionDe: 'Kaltjahr-Szenario fehlt',
  },
  GCORG_RLM_REBOUND_MISSING: {
    severity: 'warning',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Industrial rebound or reversible RLM load evidence is missing',
    descriptionDe: 'Industrie-Rebound- oder reversible RLM-Last-Evidenz fehlt',
  },
  GCORG_BOTTLENECK_EVIDENCE_MISSING: {
    severity: 'warning',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Historical bottleneck evidence is missing',
    descriptionDe: 'Historische Engpass-Evidenz fehlt',
  },
  GCORG_NKP_DISTRIBUTION_MISSING: {
    severity: 'error',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Network-coupling-point distribution is missing',
    descriptionDe: 'Netzkopplungspunkt-Verteilung fehlt',
  },
  GCORG_TARIFF_IMPACT_MISSING: {
    severity: 'warning',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Tariff or fee impact evidence is missing',
    descriptionDe: 'Entgeltwirkung fehlt',
  },
  GCORG_FLEXIBILITY_EVIDENCE_MISSING: {
    severity: 'warning',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Pressure or maintenance flexibility evidence is missing',
    descriptionDe: 'Druck- oder Wartungsflexibilitaets-Evidenz fehlt',
  },
  GCORG_DECISION_RESOLUTION_MISSING: {
    severity: 'error',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Documented gas-capacity order decision is missing',
    descriptionDe: 'Dokumentierter Bestellbeschluss fehlt',
  },
  GCORG_SOURCE_ACTIONS_MISSING: {
    severity: 'warning',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Gas-capacity source action references are missing',
    descriptionDe: 'Quell-Action-Referenzen fuer Gaskapazitaetsbestellung fehlen',
  },
  GCORG_GATE_READY: {
    severity: 'info',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Gas-capacity order revision gate is ready',
    descriptionDe: 'Gaskapazitaetsbestellung-Revisionsgate ist bereit',
  },
  GCORG_GATE_BLOCKED: {
    severity: 'error',
    agent: 'gas-capacity-order-revision-gate',
    step: 1,
    description: 'Gas-capacity order revision gate is blocked',
    descriptionDe: 'Gaskapazitaetsbestellung-Revisionsgate ist blockiert',
  },
};

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
  // RD Step 2 — Portfolio inventory
  RD_PORTFOLIO_COMPLETE,
  RD_PORTFOLIO_EMPTY,
  RD_PORTFOLIO_INCLUDES_INACTIVE,
  // RD Step 3 — Master data validation
  RD_MISSING_NAP,
  RD_MISSING_MELO,
  RD_MISSING_BTR,
  RD_NAP_VNB_MISMATCH,
  RD_DV_NOT_CONTROLLABLE,
  RD_CAPACITY_ANOMALY,
  // RD Step 4 — Curtailment correlation
  RD_CURTAILMENT_VOLUME,
  RD_HIGH_CURTAILMENT_PERIOD,
  RD_CURTAILMENT_DATA_UNAVAILABLE,
  RD_CURTAILMENT_ZERO,
  // RD Step 5 — Settlement readiness
  RD_SETTLEMENT_READY,
  RD_SETTLEMENT_PARTIAL,
  RD_SETTLEMENT_CRITICAL,
  // RD Step 6 — Risk assessment
  RD_RISK_LOW,
  RD_RISK_MEDIUM,
  RD_RISK_HIGH,
  // FA Step 1 — Query planning
  FA_QUERY_PLANNED,
  // FA Step 2 — Retrieval
  FA_EVIDENCE_RETRIEVED,
  // FA Step 3 — Evidence arbitration
  FA_RULE_EVIDENCE_USED,
  FA_HYDE_CONTEXT_USED,
  // FA Step 4 — Compliance checks
  FA_RULE_HYDE_CONFLICT,
  FA_REGULATORY_REFERENCES_MISSING,
  // FA Step 5 — Synthesis
  FA_SYNTHESIS_GUARDED,
  FA_NEEDS_CLARIFICATION,
  // VDMI governance codes
  VD_ROLE_VD_DECOUPLING_M,
  VD_ROLE_V_OWNER_ABSENT_H,
  VD_SHADOW_EXCEL_EXEC_H,
  VD_SHADOW_SHAREPOINT_BYPASS_H,
  VD_SILO_HANDOVER_MANUAL_M,
  VD_SILO_KERNSYSTEM_BLOCK_M,
  VD_UNBUNDLE_PSEUDO_ARG_H,
  VD_GOV_AUDIT_GAP_K,
  VD_GOV_RECURRENCE_K,
  BLINDFLUG_ANOMALY_DETECTED,
  // Netzfahrplan / fNAV codes (v0.51.5)
  FN_PROFILE_COMPLETE,
  FN_PROFILE_PARTIAL,
  FN_PROFILE_INSUFFICIENT,
  FN_N1_PASS,
  FN_N1_FAIL,
  FN_N1_MARGINAL,
  FN_FLEX_NAV_FEASIBLE,
  FN_CAPACITY_CONDITIONAL,
  FN_CAPACITY_COPPER_NEEDED,
  FN_GOVERNANCE_APPROVED,
  FN_GOVERNANCE_REQUIRED,
  FN_ECONOMICS_AVAILABLE,
  FN_ECONOMICS_PARTIAL,
  // UI metadata (v0.19)
  FINDING_CODE_METADATA,
  // FIM — File Ingest Monitor (v0.62)
  FIM_FILE_MISSING,
  FIM_FILE_STALE,
  FIM_SCHEMA_MISMATCH,
  FIM_PARSE_ERROR,
  FIM_ERROR_FOLDER_PRESENT,
  FIM_REQUIRED_COLUMNS_MISSING,
  FIM_MONITOR_HEALTHY,
  // RDAR — Redispatch Asset Register (v0.62)
  RDAR_RESOURCE_MAPPING_MISSING,
  RDAR_IDENTIFIER_CONFLICT,
  RDAR_MARKET_LOCATION_MISSING,
  RDAR_CONTROL_GROUP_AMBIGUOUS,
  RDAR_CO_LOCATION_UNRESOLVED,
  RDAR_ASSET_PROJECTION_COMPLETE,
  // RDG — Redispatch Data Governance (v0.62)
  RDG_DEADLINE_MISSED,
  RDG_OWNER_UNASSIGNED,
  RDG_SOURCE_OF_RECORD_UNRESOLVED,
  RDG_GOVERNANCE_POLICY_MISSING,
  RDG_DATA_CONFLICT,
  RDG_GOVERNANCE_COMPLIANT,
  // RDSS — Redispatch Settlement Sandbox (v0.62)
  RDSS_MISSING_SCENARIO,
  RDSS_RECONCILIATION_DEVIATION,
  RDSS_MISSING_DATAPOINT_EVIDENCE,
  RDSS_POLICY_VERSION_MISMATCH,
  RDSS_SCENARIO_COMPLETE,
  // RSCG — Redispatch Special Case Gate (v0.62)
  RSCG_CO_LOCATION_CONFIRMED,
  RSCG_CO_LOCATION_UNCONFIRMED,
  RSCG_CONTROLLABILITY_CONFIRMED,
  RSCG_CONTROLLABILITY_MISSING,
  RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT,
  RSCG_NON_AVAILABILITY_EVIDENCE_MISSING,
  RSCG_DEVIATION_WITHIN_TOLERANCE,
  RSCG_DEVIATION_EXCEEDS_TOLERANCE,
  RSCG_GATE_READY,
  RSCG_GATE_BLOCKED,
  RSCG_GATE_INSUFFICIENT_EVIDENCE,
  // RRG — Redispatch Readiness Gate (v0.63)
  RRG_ACCESS_MATRIX_COMPLETE,
  RRG_ACCESS_MATRIX_INCOMPLETE,
  RRG_TEST_CALL_PASSED,
  RRG_TEST_CALL_MISSING,
  RRG_TEST_CALL_FAILED,
  RRG_PRODUCTION_PROOF_CONFIRMED,
  RRG_PRODUCTION_PROOF_MISSING,
  RRG_TEMPLATE_VERSION_CURRENT,
  RRG_TEMPLATE_VERSION_OUTDATED,
  RRG_OPEN_QUESTIONS_PRESENT,
  RRG_RESPONSIBLE_ROLE_ASSIGNED,
  RRG_RESPONSIBLE_ROLE_MISSING,
  RRG_ACCEPTANCE_DEADLINE_MISSED,
  RRG_ACCEPTANCE_DEADLINE_APPROACHING,
  RRG_GATE_READY,
  RRG_GATE_READY_WITH_WARNINGS,
  RRG_GATE_BLOCKED,
  // BRS — Battery Redispatch Special Gate (v0.63)
  BRS_MALO_DIRECTION_MISSING,
  BRS_METERING_CONCEPT_MISSING,
  BRS_REDISPATCH_DIRECTION_INCOMPLETE,
  BRS_CONTROLLABILITY_DIRECTION_MISSING,
  BRS_TEST_CALL_PROOF_MISSING,
  BRS_PRODUCTION_PROOF_MISSING,
  BRS_SETTLEMENT_DIRECTION_CONFLICT,
  BRS_GATE_READY,
  BRS_GATE_BLOCKED,
  // FCRM — Flexibility Conductor Role Model (v0.63)
  FCRM_DECISION_RIGHTS_MISSING,
  FCRM_CONTROL_BOUNDARY_MISSING,
  FCRM_MONITORING_OWNER_MISSING,
  FCRM_COMMERCIAL_OWNER_MISSING,
  FCRM_ESCALATION_PATH_MISSING,
  FCRM_SOURCE_ACTIONS_MISSING,
  FCRM_ROLE_MODEL_READY,
  FCRM_ROLE_MODEL_BLOCKED,
  // KCGG — Knowledge Continuity Governance Gate (v0.63)
  KCGG_DECISION_RIGHTS_MISSING,
  KCGG_CONTROL_BOUNDARY_MISSING,
  KCGG_MONITORING_OWNER_MISSING,
  KCGG_COMMERCIAL_OWNER_MISSING,
  KCGG_ESCALATION_PATH_MISSING,
  KCGG_SOURCE_ACTIONS_MISSING,
  KCGG_GOVERNANCE_GATE_READY,
  KCGG_GOVERNANCE_GATE_BLOCKED,
  // IMOB — Investment Maturity Off-Balance Gate (v0.63)
  IMOB_MATURITY_MODEL_MISSING,
  IMOB_PROCESS_QUALITY_LOW,
  IMOB_FINANCING_COST_MISSING,
  IMOB_REGULATORY_RETURN_HYPOTHESIS_MISSING,
  IMOB_ASSET_RISK_REFERENCE_MISSING,
  IMOB_ISO_RISK_REFERENCE_MISSING,
  IMOB_DECISION_FORUM_MISSING,
  IMOB_SOURCE_ACTIONS_MISSING,
  IMOB_GATE_READY,
  IMOB_GATE_BLOCKED,
  // GCORG — Gas Capacity Order Revision Gate (v0.63)
  GCORG_TOOL_VALUE_MISSING,
  GCORG_COLD_YEAR_SCENARIO_MISSING,
  GCORG_RLM_REBOUND_MISSING,
  GCORG_BOTTLENECK_EVIDENCE_MISSING,
  GCORG_NKP_DISTRIBUTION_MISSING,
  GCORG_TARIFF_IMPACT_MISSING,
  GCORG_FLEXIBILITY_EVIDENCE_MISSING,
  GCORG_DECISION_RESOLUTION_MISSING,
  GCORG_SOURCE_ACTIONS_MISSING,
  GCORG_GATE_READY,
  GCORG_GATE_BLOCKED,
};
