'use strict';

/**
 * Unit tests for src/netzfahrplan-schema.js — Phase 5
 */

const {
  normaliseFnavProfile,
  checkN1Compliance,
  resolveN1Threshold,
  resolveGovernanceStatus,
  checkEvidenceCompleteness,
  buildGovernanceArtifactConfig,
  buildDecisionChain,
  buildProof,
  FNAV_PROFILE_TYPE,
  CONTRACT_STATUS,
  LEGAL_STATUS,
  EVIDENCE_LEVEL,
  GOVERNANCE_STATUS,
  N1_SOURCE,
  DOMAIN_DEFAULT_N1_MVA,
} = require('../src/netzfahrplan-schema');
const { NETZFAHRPLAN_DEFAULTS } = require('../src/domain-config');

describe('netzfahrplan-schema — normaliseFnavProfile', () => {
  it('returns static_cap profile when no flexible capacity is provided', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 5000,
      firmCapacity: 5000,
      contractStatus: 'signed',
      legalStatus: 'approved',
    });
    expect(model.profileType).toBe(FNAV_PROFILE_TYPE.STATIC_CAP);
    expect(model.requestedCapacityKW).toBe(5000);
    expect(model.firmCapacityKW).toBe(5000);
    expect(model.flexibleCapacityKW).toBe(0);
    expect(model.resultingEffectiveCapacityKW).toBe(5000);
    expect(model.curtailmentFactor).toBe(0);
    expect(model.contractStatus).toBe(CONTRACT_STATUS.SIGNED);
    expect(model.legalStatus).toBe(LEGAL_STATUS.APPROVED);
  });

  it('returns dynamic_flex profile when only flexible capacity is set', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 4000,
      firmCapacity: 0,
      flexibleCapacity: 4000,
      curtailmentWindow: 8,
    });
    expect(model.profileType).toBe(FNAV_PROFILE_TYPE.DYNAMIC_FLEX);
    // effectiveCapacity = 0 (firm) + 4000 * (1 - 8/24) = 4000 * 0.6667 = 2666.67
    expect(model.curtailmentFactor).toBeCloseTo(0.3333, 3);
    expect(model.resultingEffectiveCapacityKW).toBeCloseTo(2666.667, 1);
  });

  it('returns hybrid profile when both firm and flexible capacities are provided', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 5000,
      firmCapacity: 3000,
      flexibleCapacity: 2000,
      curtailmentWindow: 4,
    });
    expect(model.profileType).toBe(FNAV_PROFILE_TYPE.HYBRID);
    // effectiveCapacity = 3000 + 2000 * (1 - 4/24) = 3000 + 2000*0.8333 = 4666.67
    expect(model.resultingEffectiveCapacityKW).toBeCloseTo(4666.667, 1);
    expect(model.curtailmentFactor).toBeCloseTo(0.1667, 3);
  });

  it('defaults firmCapacity to requestedCapacity when not provided', () => {
    const model = normaliseFnavProfile({ requestedCapacity: 3000 });
    expect(model.firmCapacityKW).toBe(3000);
  });

  it('clamps curtailmentWindow to [0, 24]', () => {
    const model = normaliseFnavProfile({ requestedCapacity: 1000, curtailmentWindow: 30 });
    expect(model.curtailmentWindow).toBe(24);
    expect(model.curtailmentFactor).toBe(1);
    // effectiveCapacity = 1000 * (1 - 1) = 0 (for fully dynamic)
  });

  it('normalises unknown contractStatus to UNKNOWN', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 1000,
      contractStatus: 'flying_saucers',
    });
    expect(model.contractStatus).toBe(CONTRACT_STATUS.UNKNOWN);
  });
});

describe('netzfahrplan-schema — resolveN1Threshold', () => {
  it('returns domain default for MS when no overrides given', () => {
    const result = resolveN1Threshold('MS');
    expect(result.thresholdMVA).toBe(DOMAIN_DEFAULT_N1_MVA.MS);
    expect(result.thresholdSource).toBe(N1_SOURCE.DOMAIN_DEFAULT);
    expect(result.overrideApplied).toBe(false);
  });

  it('uses domain-config defaults as the baseline N-1 source', () => {
    expect(DOMAIN_DEFAULT_N1_MVA.HS).toBe(NETZFAHRPLAN_DEFAULTS.n1ThresholdMVA.HS);
    expect(DOMAIN_DEFAULT_N1_MVA.MS).toBe(NETZFAHRPLAN_DEFAULTS.n1ThresholdMVA.MS);
    expect(DOMAIN_DEFAULT_N1_MVA.NS).toBe(NETZFAHRPLAN_DEFAULTS.n1ThresholdMVA.NS);
  });

  it('applies scenario override with highest priority', () => {
    const result = resolveN1Threshold('HS', { tenant: 80, project: 75, scenario: 70 });
    expect(result.thresholdMVA).toBe(70);
    expect(result.thresholdSource).toBe(N1_SOURCE.SCENARIO_OVERRIDE);
    expect(result.overrideApplied).toBe(true);
  });

  it('applies project override when no scenario override', () => {
    const result = resolveN1Threshold('HS', { tenant: 80, project: 75 });
    expect(result.thresholdMVA).toBe(75);
    expect(result.thresholdSource).toBe(N1_SOURCE.PROJECT_OVERRIDE);
    expect(result.overrideApplied).toBe(true);
  });

  it('applies tenant override as lowest-priority override', () => {
    const result = resolveN1Threshold('MS', { tenant: 22 });
    expect(result.thresholdMVA).toBe(22);
    expect(result.thresholdSource).toBe(N1_SOURCE.TENANT_OVERRIDE);
    expect(result.overrideApplied).toBe(true);
  });

  it('falls back to MS default for unknown voltage levels', () => {
    const result = resolveN1Threshold('UNKNOWN');
    expect(result.thresholdMVA).toBe(DOMAIN_DEFAULT_N1_MVA.MS);
  });
});

describe('netzfahrplan-schema — checkN1Compliance', () => {
  it('passes when load is below threshold', () => {
    const result = checkN1Compliance(10, 'MS'); // 10 MW vs default 20 MVA
    expect(result.passes).toBe(true);
    expect(result.marginMW).toBeCloseTo(10);
    expect(result.utilizationPercent).toBeCloseTo(50);
  });

  it('fails when load exceeds threshold', () => {
    const result = checkN1Compliance(25, 'MS'); // 25 MW > 20 MVA default
    expect(result.passes).toBe(false);
    expect(result.marginMW).toBeLessThan(0);
  });

  it('exposes thresholdMVA, thresholdSource, and overrideApplied in result', () => {
    const result = checkN1Compliance(60, 'HS', { project: 78 });
    expect(result.thresholdMVA).toBe(78);
    expect(result.thresholdSource).toBe(N1_SOURCE.PROJECT_OVERRIDE);
    expect(result.overrideApplied).toBe(true);
  });
});

describe('netzfahrplan-schema — resolveGovernanceStatus (Option B)', () => {
  it('returns approved when all prerequisites are met', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 5000,
      contractStatus: 'signed',
      legalStatus: 'approved',
      evidenceLevel: EVIDENCE_LEVEL.COMPLETE,
    });
    const { governanceStatus, blockers } = resolveGovernanceStatus(model, false);
    expect(governanceStatus).toBe(GOVERNANCE_STATUS.APPROVED);
    expect(blockers).toHaveLength(0);
  });

  it('returns requires_governance_decision when legalStatus is not approved', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 5000,
      contractStatus: 'signed',
      legalStatus: 'pending',
    });
    const { governanceStatus, blockers } = resolveGovernanceStatus(model, false);
    expect(governanceStatus).toBe(GOVERNANCE_STATUS.REQUIRES_GOVERNANCE_DECISION);
    expect(blockers.some((b) => b.includes('legalStatus'))).toBe(true);
  });

  it('returns requires_governance_decision when contractStatus is not signed', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 5000,
      contractStatus: 'negotiating',
      legalStatus: 'approved',
    });
    const { governanceStatus, blockers } = resolveGovernanceStatus(model, false);
    expect(governanceStatus).toBe(GOVERNANCE_STATUS.REQUIRES_GOVERNANCE_DECISION);
    expect(blockers.some((b) => b.includes('contractStatus'))).toBe(true);
  });

  it('blocks when owner is missing', () => {
    const model = normaliseFnavProfile({
      requestedCapacity: 5000,
      contractStatus: 'signed',
      legalStatus: 'approved',
    });
    const { governanceStatus, blockers } = resolveGovernanceStatus(model, true);
    expect(governanceStatus).toBe(GOVERNANCE_STATUS.REQUIRES_GOVERNANCE_DECISION);
    expect(blockers.some((b) => b.includes('owner'))).toBe(true);
  });

  it('accumulates multiple blockers', () => {
    const model = normaliseFnavProfile({ requestedCapacity: 1000 });
    const { blockers } = resolveGovernanceStatus(model, true);
    expect(blockers.length).toBeGreaterThan(1);
  });
});

describe('netzfahrplan-schema — checkEvidenceCompleteness', () => {
  it('returns complete when all required fields present and valid', () => {
    const { evidenceLevel, missingFields } = checkEvidenceCompleteness({
      requestedCapacity: 5000,
      firmCapacity: 3000,
      contractStatus: 'signed',
      legalStatus: 'approved',
    });
    expect(evidenceLevel).toBe(EVIDENCE_LEVEL.COMPLETE);
    expect(missingFields).toHaveLength(0);
  });

  it('returns partial when 1–2 fields missing', () => {
    const { evidenceLevel } = checkEvidenceCompleteness({
      requestedCapacity: 5000,
      firmCapacity: 3000,
      contractStatus: 'negotiating',
      // legalStatus missing
    });
    expect(evidenceLevel).toBe(EVIDENCE_LEVEL.PARTIAL);
  });

  it('returns insufficient when more than 2 required fields are missing', () => {
    const { evidenceLevel, missingFields } = checkEvidenceCompleteness({});
    expect(evidenceLevel).toBe(EVIDENCE_LEVEL.INSUFFICIENT);
    expect(missingFields.length).toBeGreaterThan(2);
  });
});

describe('netzfahrplan-schema — governance artifact + proof helpers', () => {
  it('maps legal blockers to hard decision placeholders', () => {
    const config = buildGovernanceArtifactConfig(['legalStatus is "pending" (required: approved)']);
    expect(config.reason).toBe('NEEDS_DECISION');
    expect(config.blockingLevel).toBe('hard');
  });

  it('builds additive decisionChain and proof payloads', () => {
    const capacityModel = normaliseFnavProfile({
      requestedCapacity: 5000,
      firmCapacity: 3000,
      flexibleCapacity: 2000,
      curtailmentWindow: 4,
      contractStatus: 'signed',
      legalStatus: 'approved',
      evidenceLevel: 'complete',
    });
    const n1Check = checkN1Compliance(4.6, 'MS');
    const decisionChain = buildDecisionChain({
      requestedCapacityKW: 5000,
      voltageLevel: 'MS',
      capacityModel,
      n1Check,
      feasibility: 'feasible',
      governanceStatus: 'approved',
      governanceBlockers: [],
      source: 'grid-operations.netzfahrplanGenerate',
    });
    const proof = buildProof({
      capacityModel,
      n1Check,
      feasibility: 'feasible',
      governanceStatus: 'approved',
      governanceBlockers: [],
      findings: [{ finding: 'FN_N1_PASS' }],
    });

    expect(decisionChain).toHaveLength(6);
    expect(decisionChain[1].key).toBe('technical_constraint');
    expect(proof.summary.thresholdSource).toBe(n1Check.thresholdSource);
    expect(proof.findingCodes).toContain('FN_N1_PASS');
  });
});
