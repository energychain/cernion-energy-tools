/**
 * Domain-specific constants for Cernion energy market operations.
 * Centralized configuration for hotspot detection, CAPEX economics, regulatory policies,
 * and energy-sharing heuristics. Used across ZNP, NOVA, and Energy Sharing workflows.
 *
 * References:
 * - Hotspot: Cernion grid simulation thresholds
 * - CAPEX: CFO Module assumptions for grid expansion decisions
 * - §14a: BK6-22-300 (BNetzA Festlegung) controllable device policy
 * - §42c: Energy Sharing regulatory constraints (effective 2026-06-01)
 */

/**
 * HOTSPOT DETECTION THRESHOLDS
 * Two-tier alert system for grid congestion and voltage violations.
 * Used by vnb-monitor and grid-operations services.
 */
const HOTSPOT_THRESHOLDS = {
  // Thermal loading limits (Kabel / Transformator)
  thermal: {
    warningLevel: 0.8, // 80% utilization → warning alert
    alertLevel: 1.0, // 100% utilization → hard congestion alert
    unit: 'percent utilization',
  },

  // Voltage band compliance (Niederspannung / LV)
  voltage: {
    toleranceBand: {
      min: -0.1, // -10% from nominal
      max: 0.1, // +10% from nominal
      unit: 'per unit (p.u.) deviation from nominal',
    },
    flagCriterion: 'Alarm raised when simulation edge breaches tolerance',
    commonLocation: 'end of long PV-heavy stub lines (Stichleitungen)',
  },

  // TWL Netze specific (N-1 security)
  twlNetze: {
    operatingLimit: 81, // MVA
    level: 'Mittelspannung / Hochspannung',
    criterion: 'N-1 safe operating margin',
    description: 'Hard threshold for interconnection capacity; triggers NEST justification',
  },
};

/**
 * CAPEX ASSUMPTIONS (CFO Module - What-If Scenarios)
 * Used for grid expansion ROI calculations, NOVA optimization, and investment decisions.
 * Typical timeframe: 10-20 year DCF analysis.
 */
const CAPEX_ASSUMPTIONS = {
  // Regelbare Ortsnetztrafo (rONT) - Smart Transformer with voltage regulation
  rONT: {
    incrementalCost: 5500, // EUR, premium over standard transformer
    spannungCapacityFactor: 2.0, // 2.0x–4.0x → voltage band lift (conservative: 2.0x)
    thermalCapacityFactor: 1.0, // No thermal benefit
    unit: 'EUR per device',
    useCase: 'Deferral of NS voltage violations; ~2–3 year typical ROI in PV-dense areas',
  },

  // Kabel (Tiefbau / Underground cable + labor)
  cable: {
    costPerMeter: {
      min: 100, // EUR/m, simple trench
      max: 300, // EUR/m, complex urban/protected area
      typical: 150,
    },
    costPerKilometer: {
      min: 100_000,
      max: 300_000,
      typical: 150_000,
    },
    unit: 'EUR per linear meter',
    useCase: 'Thermal capacity expansion; 15–30 year payback in low-growth areas',
  },

  // Trafo Upgrades (transformer size increases)
  trafoUpgrade: {
    capacity_400_to_630_kVA: {
      min: 13_000,
      max: 18_000,
      typical: 15_500,
      unit: 'EUR',
    },
    newOrtsNetzstation_ONS: {
      min: 50_000,
      max: 120_000,
      typical: 85_000,
      unit: 'EUR (including civil works, installation)',
    },
  },

  // Combined scenarios (rough guidance)
  scenarios: {
    scenario_rONT_only: {
      cost: 5_500,
      timeline: '2–3 months procurement + 1 week installation',
      deferralImpact: 'Voltage violations eliminated; thermal capacity unchanged',
    },
    scenario_cable_1km: {
      cost: 150_000,
      timeline: '3–6 months design + 2–3 months trenching + 1 month testing',
      deferralImpact: 'Thermal + voltage capacity both increased; systemic relief',
    },
    scenario_trafo_upgrade: {
      cost: 15_500,
      timeline: '1–2 months procurement + 1 week installation + testing',
      deferralImpact: 'Thermal capacity +50–60%; voltage band unchanged',
    },
  },
};

/**
 * §14A ENWG POLICY MAPPING (Steuerbare Verbrauchseinrichtungen)
 * BK6-22-300 (BNetzA Festlegung) defines controllable load reduction rules.
 * Used by nbp-monitor, section14a-compliance-autopilot recipe.
 */
const SECTION_14A_POLICY = {
  // Minimum guaranteed performance
  minimumGuaranteedPower: 4.2, // kW (Notfallabregelung floor)
  unit: 'kilowatt',

  // Simultaneity Factor (Gleichzeitigkeitsfaktor g)
  // Dynamic scaling based on number of controllable units in aggregate
  simultaneityFactorTable: {
    // n = number of controlled devices (Wallbox, Wärmepumpe, Storage)
    1: 1.0, // 100% (single unit, no diversity)
    2: 0.85, // 85%
    3: 0.75, // 75%
    4: 0.7, // 70% (typical small residential cluster)
    5: 0.65,
    6: 0.6,
    7: 0.55,
    8: 0.5,
    9: 0.45, // threshold for "large" aggregates
    10: 0.45,
    100: 0.45, // asymptotic minimum
  },

  // Formula: P_min = 4.2 kW + (n - 1) × g × 4.2 kW
  minimumPowerFormula: 'P_min = 4.2 + (n - 1) × g × 4.2',
  unit: 'kilowatt',

  // Comparative: Uncontrolled heat pump behavior for reference
  uncontrolledHeatPumpSimultaneityFactor: {
    coldDay_winter: 0.75, // ~75% overlap on cold winter days
    mildDay_spring: 0.4,
    reference: 'BNetzA basis for §14a differentiation',
  },

  // Exception rules
  exceptions: {
    dimming_max_duration: 120, // minutes, max continuous reduction
    recovery_requirement: 'Full power restoration within 60 min post-dimming',
    frequency: 'Max 5–6 events/year typical under normal grid conditions',
  },

  regulation: 'BK6-22-300, effective via §14a EnWG',
  implementationDate: '2024-Q3',
};

/**
 * §42C ENERGY SHARING CLUSTER HEURISTICS
 * Spatial, technical, and regulatory screening for energy-sharing communities.
 * Effective: 2026-06-01 (regulatory deadline).
 * Used by energy-sharing.service, energy-sharing-42c-radar recipe.
 */
const SECTION_42C_HEURISTICS = {
  // Spatial Context (Layer 1: OSM-based clustering)
  spatialClustering: {
    // Gebäude-Footprints (Building typology)
    pvCandidate: {
      minCapacity_kWp: 30, // PV >30 kWp on MFH (Mehrfamilienhaus)
      rooftop_preference: true,
    },
    geometry: {
      distanceThreshold_m: 500, // clustering radius
      method: 'OSM building footprints + nearest-neighbor grouping',
    },

    // Profile Mix (Landuse Diversity Impact)
    landUseDiversity: {
      residential_commercial_mix: {
        peakLoadReduction: -0.15, // -15%
        rationale: 'H0 (residential) + G0 (commercial) profiles run asynchronously',
      },
      peakLoadReduction_range: {
        min: -0.15,
        max: -0.2,
        comment: 'Conservative estimate: -15–20% in mixed zones',
      },
    },
  },

  // Regulatory Constraints (Market Design)
  regulatoryRequirements: {
    direktvermarktung_mandatory: true,
    description: 'Energy Sharing requires §42c Direktvermarktung (direct marketing)',

    dienstleister_required: true,
    legalBasis: '§20 EnWG (Netznutzungsvertrag / grid usage agreement)',
    implementation: 'Customer can contract Direktvermarkter or hire aggregator',

    eeg_incompatibility: true,
    legalBasis: '§21 Abs. 2 EEG',
    rationale: 'Fixed feed-in tariff + energy sharing = mutual exclusion',
    impact: 'Installations in EEG must switch marketing model to qualify',

    // Status labels
    status_sharing_capable: 'Anlage in Direktvermarktung + §20 service provider available',
    status_sharing_incapable:
      'Still in EEG fixed tariff; can join after tariff expires or model change',
  },

  // Cluster composition rules
  clusterComposition: {
    minGenerators: 1,
    maxConsumers_per_generator: 'Unlimited (subject to physical line limits)',
    maxDistance_generator_consumer: 30_000, // meters
    metricNetwork: 'Geographical distance (OSM routing)',
  },

  // Conflict flagging
  conflictFlags: {
    flag_no_suitable_consumers: 'Cluster has generators but <2 consumers within range',
    flag_no_direktvermarketer: 'Local Direktvermarketer not available; high coordination cost',
    flag_eeg_incumbent_model: 'Too many units still under EEG; deferral to 2027+',
  },

  effectiveDate: '2026-06-01',
  regulatoryFramework: '§42c EnWG, §21 Abs. 2 EEG',
};

module.exports = {
  HOTSPOT_THRESHOLDS,
  CAPEX_ASSUMPTIONS,
  SECTION_14A_POLICY,
  SECTION_42C_HEURISTICS,
};
