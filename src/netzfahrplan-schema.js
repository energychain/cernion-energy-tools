'use strict';

const { NETZFAHRPLAN_DEFAULTS } = require('./domain-config');

/**
 * Netzfahrplan / fNAV Schema — Phase 5 (v0.51.5)
 *
 * Deterministic model for flexible grid connection (fNAV) capacity assessment.
 *
 * Design decisions implemented here:
 *
 * Option B — fNAV as a capacity modifier, not a binary flag:
 *   A flexible NAV (§14a EnWG) changes the *effective* connection capacity at
 *   the Netzanschlusspunkt. The model distinguishes:
 *     firmCapacity   — guaranteed, contractually fixed power
 *     flexibleCapacity — legally curtailable portion (§14a)
 *     resultingEffectiveCapacity — what the grid operator can actually rely on
 *
 * Option C — Hybrid N-1 threshold (default + override):
 *   A domain-config default (e.g. 81 MVA for STROMDAO / Pfalzwerke-typical topologies)
 *   is used when no tenant/project/scenario override is present.  Every result
 *   carries { thresholdMVA, thresholdSource, overrideApplied } for transparency.
 *
 * Option B — Governance blocker:
 *   Technical feasibility (CAPACITY_CONDITIONAL / FLEX_NAV_FEASIBLE) is reported
 *   deterministically.  The final status is always `requires_governance_decision`
 *   when legalStatus is not `approved` or contractStatus is not `signed`.
 *   EUR-based thresholds for tiered governance are a Phase 5.1 concern.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** fNAV profile type */
const FNAV_PROFILE_TYPE = Object.freeze({
  STATIC_CAP: 'static_cap', // Traditional fixed-limit NAV
  DYNAMIC_FLEX: 'dynamic_flex', // §14a fully flexible curtailment contract
  HYBRID: 'hybrid', // Mixed: firm floor + dynamic curtailment headroom
});

/** Contract status values */
const CONTRACT_STATUS = Object.freeze({
  DRAFT: 'draft',
  NEGOTIATING: 'negotiating',
  SIGNED: 'signed',
  EXPIRED: 'expired',
  UNKNOWN: 'unknown',
});

/** Legal / regulatory status values */
const LEGAL_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  NOT_APPLICABLE: 'not_applicable',
  UNKNOWN: 'unknown',
});

/** Evidence completeness levels */
const EVIDENCE_LEVEL = Object.freeze({
  COMPLETE: 'complete', // All required fields present and validated
  PARTIAL: 'partial', // Core fields present, supporting docs missing
  INSUFFICIENT: 'insufficient', // Too many gaps for a reliable assessment
});

/** Final governance decision status */
const GOVERNANCE_STATUS = Object.freeze({
  APPROVED: 'approved',
  REQUIRES_GOVERNANCE_DECISION: 'requires_governance_decision',
  BLOCKED: 'blocked',
});

/** N-1 threshold source labels */
const N1_SOURCE = Object.freeze({
  DOMAIN_DEFAULT: 'domain_default',
  TENANT_OVERRIDE: 'tenant_override',
  PROJECT_OVERRIDE: 'project_override',
  SCENARIO_OVERRIDE: 'scenario_override',
});

// ---------------------------------------------------------------------------
// Domain config — default N-1 thresholds
// ---------------------------------------------------------------------------

/**
 * Default N-1 capacity thresholds by voltage level.
 *
 * These are typical values for medium-sized German DSO topologies
 * (e.g. STROMDAO / Pfalzwerke-class operators).  Any production deployment
 * MUST validate against the actual network planning data.
 *
 * Env override: N1_THRESHOLD_HS_MVA, N1_THRESHOLD_MS_MVA, N1_THRESHOLD_NS_MVA
 */
const DOMAIN_DEFAULT_N1_MVA = Object.freeze({
  HS: parseFloat(process.env.N1_THRESHOLD_HS_MVA || `${NETZFAHRPLAN_DEFAULTS.n1ThresholdMVA.HS}`),
  MS: parseFloat(process.env.N1_THRESHOLD_MS_MVA || `${NETZFAHRPLAN_DEFAULTS.n1ThresholdMVA.MS}`),
  NS: parseFloat(process.env.N1_THRESHOLD_NS_MVA || `${NETZFAHRPLAN_DEFAULTS.n1ThresholdMVA.NS}`),
});

function normalizeSignalPriorityPolicy(policy) {
  const value = typeof policy === 'string' ? policy.trim() : '';
  return value || null;
}

function normalizeControlEvidenceRef(reference) {
  const value = typeof reference === 'string' ? reference.trim() : '';
  return value || null;
}

function isRecognizedSignalPriorityPolicy(policy) {
  const normalized = normalizeSignalPriorityPolicy(policy);
  if (!normalized) {
    return false;
  }

  return [
    /netzsignal.*vorrang/i,
    /vorrang.*netzsignal/i,
    /grid\s*signal.*priority/i,
    /priority.*grid\s*signal/i,
    /grid\s*signal.*override/i,
    /vnb.*signal.*vorrang/i,
    /netzbetreiber.*signal.*vorrang/i,
  ].some((pattern) => pattern.test(normalized));
}

function evaluateContractGate(profile = {}) {
  const flexibleCapacity = Number(profile.flexibleCapacityKW ?? profile.flexibleCapacity ?? 0);
  const curtailmentWindow = Number(profile.curtailmentWindow || 0);
  const required =
    profile.profileType != null
      ? profile.profileType !== FNAV_PROFILE_TYPE.STATIC_CAP
      : flexibleCapacity > 0 || curtailmentWindow > 0;
  const signalPriorityPolicy = normalizeSignalPriorityPolicy(profile.signalPriorityPolicy);
  const controlEvidenceRef = normalizeControlEvidenceRef(profile.controlEvidenceRef);
  const blockers = [];

  if (required) {
    if (!signalPriorityPolicy) {
      blockers.push('signalPriorityPolicy missing for flexible grid contract gate');
    } else if (!isRecognizedSignalPriorityPolicy(signalPriorityPolicy)) {
      blockers.push('signalPriorityPolicy does not explicitly confirm grid signal priority');
    }

    if (!controlEvidenceRef) {
      blockers.push('controlEvidenceRef missing for flexible grid contract gate');
    }
  }

  return {
    required,
    satisfied: required ? blockers.length === 0 : true,
    signalPriorityPolicy,
    controlEvidenceRef,
    priorityConfirmed: required ? isRecognizedSignalPriorityPolicy(signalPriorityPolicy) : false,
    blockers,
  };
}

function buildGovernanceArtifactConfig(blockers = []) {
  const joined = blockers.join(' | ').toLowerCase();

  if (joined.includes('legalstatus') || joined.includes('contractstatus')) {
    return {
      reason: 'NEEDS_DECISION',
      blockingLevel: 'hard',
      signalCodes: ['NEEDS_DECISION'],
    };
  }

  if (joined.includes('signalprioritypolicy')) {
    return {
      reason: 'NEEDS_DECISION',
      blockingLevel: 'hard',
      signalCodes: ['NEEDS_DECISION', 'CONTRACT_GATE_SIGNAL_PRIORITY'],
    };
  }

  if (joined.includes('evidencelevel')) {
    return {
      reason: 'NEEDS_EVIDENCE',
      blockingLevel: 'soft',
      signalCodes: ['NEEDS_EVIDENCE'],
    };
  }

  if (joined.includes('controlevidenceref')) {
    return {
      reason: 'NEEDS_EVIDENCE',
      blockingLevel: 'soft',
      signalCodes: ['NEEDS_EVIDENCE', 'CONTRACT_GATE_CONTROL_EVIDENCE'],
    };
  }

  if (joined.includes('owner')) {
    return {
      reason: 'NEEDS_INTERFACE',
      blockingLevel: 'soft',
      signalCodes: ['NEEDS_INTERFACE'],
    };
  }

  return {
    reason: 'NEEDS_DECISION',
    blockingLevel: 'hard',
    signalCodes: ['NEEDS_DECISION'],
  };
}

function buildDecisionChain(input = {}) {
  const {
    requestedCapacityKW,
    voltageLevel,
    capacityModel,
    n1Check,
    feasibility,
    economics,
    governanceStatus,
    governanceBlockers,
    contractGate,
    placeholder,
    source,
  } = input;

  return [
    {
      step: 1,
      key: 'ausgangslage',
      status: 'documented',
      data: {
        requestedCapacityKW: requestedCapacityKW ?? capacityModel?.requestedCapacityKW ?? null,
        voltageLevel: voltageLevel || null,
        source: source || null,
      },
    },
    {
      step: 2,
      key: 'technical_constraint',
      status: n1Check?.passes === false ? 'constrained' : 'within_limits',
      data: n1Check || null,
    },
    {
      step: 3,
      key: 'fnav_option',
      status: capacityModel?.profileType || 'unknown',
      data: capacityModel || null,
    },
    {
      step: 4,
      key: 'netzfahrplan',
      status: feasibility || 'pending',
      data: {
        feasibility: feasibility || null,
        curtailmentWindow: capacityModel?.curtailmentWindow ?? null,
        operatingConstraint: capacityModel?.operatingConstraint ?? null,
        signalPriorityPolicy:
          contractGate?.signalPriorityPolicy ?? capacityModel?.signalPriorityPolicy ?? null,
        controlEvidenceRef:
          contractGate?.controlEvidenceRef ?? capacityModel?.controlEvidenceRef ?? null,
        contractGateSatisfied: contractGate?.satisfied ?? null,
      },
    },
    {
      step: 5,
      key: 'commercial_effect',
      status: economics ? 'evaluated' : 'not_evaluated',
      data: economics || null,
    },
    {
      step: 6,
      key: 'governance',
      status: governanceStatus || 'pending',
      data: {
        governanceStatus: governanceStatus || null,
        governanceBlockers: governanceBlockers || [],
        contractGateRequired: contractGate?.required ?? false,
        contractGateSatisfied: contractGate?.satisfied ?? null,
        contractGateBlockers: contractGate?.blockers || [],
        placeholderId: placeholder?.placeholderId || null,
        hitlId: placeholder?.hitlItem?.id || placeholder?.hitlItemId || null,
      },
    },
  ];
}

function buildProof(input = {}) {
  const {
    capacityModel,
    n1Check,
    feasibility,
    economics,
    governanceStatus,
    governanceBlockers,
    contractGate,
    placeholder,
    findings,
  } = input;

  return {
    summary: {
      profileType: capacityModel?.profileType || null,
      resultingEffectiveCapacityKW: capacityModel?.resultingEffectiveCapacityKW ?? null,
      thresholdMVA: n1Check?.thresholdMVA ?? null,
      thresholdSource: n1Check?.thresholdSource ?? null,
      overrideApplied: n1Check?.overrideApplied ?? false,
      feasibility: feasibility || null,
      avoidedCopperCapexEur: economics?.avoidedCopperCapexEur ?? null,
      paybackYears: economics?.paybackYears ?? null,
      governanceStatus: governanceStatus || null,
      contractGateRequired: contractGate?.required ?? false,
      contractGateSatisfied: contractGate?.satisfied ?? null,
    },
    blockerCount: (governanceBlockers || []).length,
    contractGate: contractGate
      ? {
          required: contractGate.required,
          satisfied: contractGate.satisfied,
          priorityConfirmed: contractGate.priorityConfirmed,
          signalPriorityPolicy: contractGate.signalPriorityPolicy,
          controlEvidenceRef: contractGate.controlEvidenceRef,
          blockers: contractGate.blockers,
        }
      : null,
    placeholderRef: placeholder
      ? {
          placeholderId: placeholder.placeholderId || null,
          blockingLevel: placeholder.blockingLevel || null,
          hitlId: placeholder.hitlItem?.id || placeholder.hitlItemId || null,
        }
      : null,
    findingCodes: Array.isArray(findings)
      ? findings.map((item) => item.finding).filter(Boolean)
      : [],
  };
}

/**
 * Resolve the effective N-1 threshold for a voltage level.
 *
 * Priority: scenario override → project override → tenant override → domain default
 *
 * @param {string} voltageLevel  'HS' | 'MS' | 'NS'
 * @param {object} [overrides]
 * @param {number} [overrides.scenario]  MVA — highest priority
 * @param {number} [overrides.project]   MVA
 * @param {number} [overrides.tenant]    MVA
 * @returns {{ thresholdMVA: number, thresholdSource: string, overrideApplied: boolean }}
 */
function resolveN1Threshold(voltageLevel, overrides = {}) {
  const level = (voltageLevel || 'MS').toUpperCase();
  const domainDefault = DOMAIN_DEFAULT_N1_MVA[level] ?? DOMAIN_DEFAULT_N1_MVA.MS;

  if (overrides.scenario != null) {
    return {
      thresholdMVA: overrides.scenario,
      thresholdSource: N1_SOURCE.SCENARIO_OVERRIDE,
      overrideApplied: true,
    };
  }
  if (overrides.project != null) {
    return {
      thresholdMVA: overrides.project,
      thresholdSource: N1_SOURCE.PROJECT_OVERRIDE,
      overrideApplied: true,
    };
  }
  if (overrides.tenant != null) {
    return {
      thresholdMVA: overrides.tenant,
      thresholdSource: N1_SOURCE.TENANT_OVERRIDE,
      overrideApplied: true,
    };
  }
  return {
    thresholdMVA: domainDefault,
    thresholdSource: N1_SOURCE.DOMAIN_DEFAULT,
    overrideApplied: false,
  };
}

// ---------------------------------------------------------------------------
// fNAV capacity model (Option B)
// ---------------------------------------------------------------------------

/**
 * Normalise an fNAV profile input into a canonical capacity model.
 *
 * Input fields (all in kW unless noted):
 *   requestedCapacity     — what the customer is asking for
 *   firmCapacity          — unconditional contractual entitlement (≤ requestedCapacity)
 *   flexibleCapacity      — curtailable portion available under §14a
 *   curtailmentWindow     — hours per day the VNB may curtail (0–24)
 *   operatingConstraint   — free-text description (e.g. "§14a max 2h/event")
 *   contractStatus        — one of CONTRACT_STATUS values
 *   legalStatus           — one of LEGAL_STATUS values
 *   evidenceLevel         — one of EVIDENCE_LEVEL values
 *
 * Derived:
 *   resultingEffectiveCapacity — firm + flexible × (1 − curtailmentFactor)
 *   curtailmentFactor          — curtailmentWindow / 24, capped [0, 1]
 *
 * @param {object} profile  Raw input from API caller
 * @returns {object} Normalised capacity model
 */
function normaliseFnavProfile(profile = {}) {
  const requestedKW = Number(profile.requestedCapacity || 0);
  const firmKW = Number(profile.firmCapacity ?? requestedKW);
  const flexKW = Number(profile.flexibleCapacity || 0);
  const curtailmentHours = Math.min(24, Math.max(0, Number(profile.curtailmentWindow || 0)));
  const curtailmentFactor = curtailmentHours / 24;

  // Effective capacity: firm baseline + non-curtailed flex portion
  const resultingEffectiveKW = firmKW + flexKW * (1 - curtailmentFactor);

  const contractStatus = Object.values(CONTRACT_STATUS).includes(profile.contractStatus)
    ? profile.contractStatus
    : CONTRACT_STATUS.UNKNOWN;

  const legalStatus = Object.values(LEGAL_STATUS).includes(profile.legalStatus)
    ? profile.legalStatus
    : LEGAL_STATUS.UNKNOWN;

  const evidenceLevel = Object.values(EVIDENCE_LEVEL).includes(profile.evidenceLevel)
    ? profile.evidenceLevel
    : EVIDENCE_LEVEL.PARTIAL;

  const profileType =
    flexKW > 0 && firmKW > 0
      ? FNAV_PROFILE_TYPE.HYBRID
      : flexKW > 0
        ? FNAV_PROFILE_TYPE.DYNAMIC_FLEX
        : FNAV_PROFILE_TYPE.STATIC_CAP;

  return {
    profileType,
    requestedCapacityKW: requestedKW,
    firmCapacityKW: parseFloat(firmKW.toFixed(3)),
    flexibleCapacityKW: parseFloat(flexKW.toFixed(3)),
    curtailmentWindow: curtailmentHours,
    curtailmentFactor: parseFloat(curtailmentFactor.toFixed(4)),
    operatingConstraint: profile.operatingConstraint || null,
    signalPriorityPolicy: normalizeSignalPriorityPolicy(profile.signalPriorityPolicy),
    controlEvidenceRef: normalizeControlEvidenceRef(profile.controlEvidenceRef),
    contractStatus,
    legalStatus,
    evidenceLevel,
    resultingEffectiveCapacityKW: parseFloat(resultingEffectiveKW.toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// N-1 compliance check
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a given load (MW) passes the N-1 criterion.
 *
 * @param {number} loadMW            Simultaneous load to be checked
 * @param {string} voltageLevel      'HS' | 'MS' | 'NS'
 * @param {object} [n1Overrides]     Tenant/project/scenario overrides (see resolveN1Threshold)
 * @returns {{ passes: boolean, loadMW: number, thresholdMVA: number,
 *             thresholdSource: string, overrideApplied: boolean,
 *             marginMW: number, utilizationPercent: number }}
 */
function checkN1Compliance(loadMW, voltageLevel, n1Overrides = {}) {
  const { thresholdMVA, thresholdSource, overrideApplied } = resolveN1Threshold(
    voltageLevel,
    n1Overrides
  );
  // MVA ≈ MW for unity power factor (conservative assumption in planning)
  const marginMW = parseFloat((thresholdMVA - loadMW).toFixed(3));
  const utilizationPercent =
    thresholdMVA > 0 ? parseFloat(((loadMW / thresholdMVA) * 100).toFixed(1)) : 100;
  return {
    passes: loadMW <= thresholdMVA,
    loadMW: parseFloat(loadMW.toFixed(3)),
    thresholdMVA,
    thresholdSource,
    overrideApplied,
    marginMW,
    utilizationPercent,
  };
}

// ---------------------------------------------------------------------------
// Governance decision (Option B)
// ---------------------------------------------------------------------------

/**
 * Determine the governance status.
 *
 * Technical feasibility (capacity result) is always reported.
 * The FINAL status is `requires_governance_decision` whenever:
 *   - legalStatus is not `approved`
 *   - contractStatus is not `signed`
 *   - evidenceLevel is `insufficient`
 *   - or ownerMissing is true
 *   - or the flexible contract gate is incomplete
 *
 * @param {object} capacityModel   Output of normaliseFnavProfile
 * @param {boolean} [ownerMissing] True if no responsible owner/contact is recorded
 * @param {object} [contractGate]  Output of evaluateContractGate
 * @returns {{ governanceStatus: string, blockers: string[] }}
 */
function resolveGovernanceStatus(capacityModel, ownerMissing = false, contractGate = null) {
  const blockers = [];

  if (capacityModel.legalStatus !== LEGAL_STATUS.APPROVED) {
    blockers.push(`legalStatus is "${capacityModel.legalStatus}" (required: approved)`);
  }
  if (capacityModel.contractStatus !== CONTRACT_STATUS.SIGNED) {
    blockers.push(`contractStatus is "${capacityModel.contractStatus}" (required: signed)`);
  }
  if (capacityModel.evidenceLevel === EVIDENCE_LEVEL.INSUFFICIENT) {
    blockers.push('evidenceLevel is insufficient');
  }
  if (ownerMissing) {
    blockers.push('no responsible owner / contact recorded');
  }
  if (Array.isArray(contractGate?.blockers) && contractGate.blockers.length > 0) {
    blockers.push(...contractGate.blockers);
  }

  const governanceStatus =
    blockers.length === 0
      ? GOVERNANCE_STATUS.APPROVED
      : GOVERNANCE_STATUS.REQUIRES_GOVERNANCE_DECISION;

  return { governanceStatus, blockers };
}

// ---------------------------------------------------------------------------
// Evidence completeness check
// ---------------------------------------------------------------------------

/**
 * Check whether minimum required evidence fields are present.
 *
 * Required for COMPLETE evidence:
 *   - requestedCapacity > 0
 *   - firmCapacity is set (even if 0)
 *   - contractStatus is not unknown
 *   - legalStatus is not unknown
 *
 * @param {object} profile  Raw input
 * @returns {{ evidenceLevel: string, missingFields: string[] }}
 */
function checkEvidenceCompleteness(profile = {}) {
  const missing = [];
  const contractGate = evaluateContractGate(profile);

  if (!profile.requestedCapacity || Number(profile.requestedCapacity) <= 0) {
    missing.push('requestedCapacity');
  }
  if (profile.firmCapacity == null) {
    missing.push('firmCapacity');
  }
  if (!profile.contractStatus || profile.contractStatus === CONTRACT_STATUS.UNKNOWN) {
    missing.push('contractStatus');
  }
  if (!profile.legalStatus || profile.legalStatus === LEGAL_STATUS.UNKNOWN) {
    missing.push('legalStatus');
  }
  if (contractGate.required && !contractGate.signalPriorityPolicy) {
    missing.push('signalPriorityPolicy');
  }
  if (contractGate.required && !contractGate.priorityConfirmed) {
    missing.push('signalPriorityPolicy');
  }
  if (contractGate.required && !contractGate.controlEvidenceRef) {
    missing.push('controlEvidenceRef');
  }

  const uniqueMissing = [...new Set(missing)];

  let evidenceLevel;
  if (uniqueMissing.length === 0) {
    evidenceLevel = EVIDENCE_LEVEL.COMPLETE;
  } else if (uniqueMissing.length <= 2) {
    evidenceLevel = EVIDENCE_LEVEL.PARTIAL;
  } else {
    evidenceLevel = EVIDENCE_LEVEL.INSUFFICIENT;
  }

  return { evidenceLevel, missingFields: uniqueMissing };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Enums
  FNAV_PROFILE_TYPE,
  CONTRACT_STATUS,
  LEGAL_STATUS,
  EVIDENCE_LEVEL,
  GOVERNANCE_STATUS,
  N1_SOURCE,
  // N-1 thresholds
  DOMAIN_DEFAULT_N1_MVA,
  resolveN1Threshold,
  checkN1Compliance,
  // fNAV capacity model
  normaliseFnavProfile,
  // Governance
  resolveGovernanceStatus,
  evaluateContractGate,
  // Evidence
  checkEvidenceCompleteness,
  buildGovernanceArtifactConfig,
  buildDecisionChain,
  buildProof,
};
