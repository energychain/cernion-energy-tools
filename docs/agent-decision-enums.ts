/**
 * agent-decision-enums.ts
 *
 * Canonical enum values for all Cernion agent decision fields.
 * Extracted from source of truth in `src/validation-findings.js` (v0.20.4).
 *
 * Usage: Import these types in cernion-ui to avoid magic-string checks.
 *
 * Source locations:
 *   Grid Connection → src/validation-findings.js lines 30–33
 *   Energy Sharing  → src/validation-findings.js lines 80–84
 *   Redispatch      → src/redispatch-risk.js lines 86 / 94 / 106 (string literals)
 *   MaStR Quality   → no enum — numeric score 0–100
 *   Allocation      → no decision enum — allocation metadata only
 *
 * Last verified: 2026-04-05 against backend v0.20.4
 */

// ---------------------------------------------------------------------------
// 1. Grid Connection Validation  (POST /api/grid-connection/validate)
//    Response field: `decision`
// ---------------------------------------------------------------------------

export const GRID_CONNECTION_DECISION = {
  /** Direktanschluss zulässig, keine Netzausbaumaßnahmen erforderlich */
  GO_DIRECT:                 'GO_DIRECT',
  /** Anschluss zulässig unter Auflagen (z. B. Blindleistungskompensation) */
  GO_CONDITIONAL:            'GO_CONDITIONAL',
  /** Kein Anschluss ohne Netzerweiterung */
  NO_GO_EXPANSION:           'NO_GO_EXPANSION',
  /** Datenlage unzureichend für eine Entscheidung */
  DATA_QUALITY_INSUFFICIENT: 'DATA_QUALITY_INSUFFICIENT',
} as const;

export type GridConnectionDecision =
  typeof GRID_CONNECTION_DECISION[keyof typeof GRID_CONNECTION_DECISION];

// ---------------------------------------------------------------------------
// 2. Energy Sharing Validation  (POST /api/energy-sharing/validate)
//    Response field: `decision`
//    Regulatory basis: § 42c EnWG, deadline 01.06.2026
// ---------------------------------------------------------------------------

export const ENERGY_SHARING_DECISION = {
  /** Gemeinschaft vollständig genehmigt */
  APPROVED:                    'APPROVED',
  /** Genehmigt mit Bedingungen (z. B. Blindleistungsanpassung) */
  APPROVED_WITH_CONDITIONS:    'APPROVED_WITH_CONDITIONS',
  /** Abgelehnt wegen struktureller Netzbedingungen */
  REJECTED_STRUCTURAL:         'REJECTED_STRUCTURAL',
  /** Abgelehnt wegen ungültiger Erzeugungsanlage (z. B. kein DV-Flag) */
  REJECTED_GENERATOR_INVALID:  'REJECTED_GENERATOR_INVALID',
  /** Abgelehnt aus sonstigem Grund */
  REJECTED_OTHER:              'REJECTED_OTHER',
} as const;

export type EnergySharingDecision =
  typeof ENERGY_SHARING_DECISION[keyof typeof ENERGY_SHARING_DECISION];

// ---------------------------------------------------------------------------
// 3. Redispatch Ex-Post Audit  (POST /api/redispatch/audit)
//    Response field: `riskAssessment.riskLevel`
//    Note: lowercase string literals — no named constants in src/redispatch-risk.js
// ---------------------------------------------------------------------------

export type RedispatchRiskLevel = 'low' | 'medium' | 'high';

/**
 * Thresholds (from src/redispatch-risk.js):
 *   low    → blockedFractionPercent < 10
 *   medium → blockedFractionPercent 10–30
 *   high   → blockedFractionPercent > 30
 */
export const REDISPATCH_RISK_LEVEL: Record<Uppercase<RedispatchRiskLevel>, RedispatchRiskLevel> = {
  LOW:    'low',
  MEDIUM: 'medium',
  HIGH:   'high',
};

// ---------------------------------------------------------------------------
// 4. MaStR Quality Audit  (POST /api/mastr-quality/audit)
//    Response field: `qualityScore`  — numeric 0–100, no enum
//    Response field: `qualityDimensions.<key>.score`  — numeric 0–100
// ---------------------------------------------------------------------------

/**
 * Dimension keys for `qualityDimensions` object.
 * Weights defined in src/validation-findings.js as QUALITY_DIMENSION_WEIGHTS.
 */
export const QUALITY_DIMENSION_KEY = {
  CONNECTION_POINTS: 'connectionPoints',
  CAPACITY:          'capacity',
  GEO:               'geo',
  STATUS:            'status',
  DUPLICATES:        'duplicates',
} as const;

export type QualityDimensionKey =
  typeof QUALITY_DIMENSION_KEY[keyof typeof QUALITY_DIMENSION_KEY];

/**
 * Dimension weights (must sum to 1.0).
 * Source: QUALITY_DIMENSION_WEIGHTS in src/validation-findings.js
 */
export const QUALITY_DIMENSION_WEIGHTS: Record<QualityDimensionKey, number> = {
  connectionPoints: 0.30,
  capacity:         0.20,
  geo:              0.20,
  status:           0.15,
  duplicates:       0.15,
};

/**
 * Quality score interpretation thresholds (informational — no source constant).
 * ≥ 80 → good, 60–79 → acceptable, < 60 → poor
 */
export const QUALITY_SCORE_THRESHOLD = {
  GOOD:       80,
  ACCEPTABLE: 60,
} as const;

// ---------------------------------------------------------------------------
// 5. Energy Sharing Allocation  (POST /api/energy-sharing-allocation/allocate)
//    No decision enum — result is allocation metadata.
//    Key field: `summary.totalNetGenerationKWh`  (numeric)
// ---------------------------------------------------------------------------

/**
 * Data source options for the allocate endpoint.
 * Source: energy-sharing-allocation.service.js params.dataSource enum
 */
export const ALLOCATION_DATA_SOURCE = {
  /** Stufe A: Synthetische Erzeugungsprognose (default) */
  FORECAST: 'forecast',
  /** Stufe B: Echte Messdaten aus Inhouse-CSV-Upload */
  INHOUSE:  'inhouse',
} as const;

export type AllocationDataSource =
  typeof ALLOCATION_DATA_SOURCE[keyof typeof ALLOCATION_DATA_SOURCE];

// ---------------------------------------------------------------------------
// 6. Finding severity levels (all agents)
//    Source: src/validation-findings.js
// ---------------------------------------------------------------------------

export const FINDING_SEVERITY = {
  INFO:    'info',
  WARNING: 'warning',
  ERROR:   'error',
} as const;

export type FindingSeverity =
  typeof FINDING_SEVERITY[keyof typeof FINDING_SEVERITY];
