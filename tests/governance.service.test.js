'use strict';

const { ServiceBroker } = require('moleculer');
const GovernanceService = require('../services/governance.service');
const { evaluateToolPolicy } = require('../src/agent-sidecar-policy');
const { deriveHitlResolverRoles } = require('../src/vdmi-hitl-role-derivation');

describe('governance policy evaluator', () => {
  let broker;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(GovernanceService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  it('returns an allowed capability decision without side effects', async () => {
    const result = await broker.call('governance.evaluatePolicy', {
      capability: 'energy_sharing_42c_cutover_readiness',
      action: 'dashboard-api.energySharing42cCutoverReadinessStatus',
      context: {
        cutoverTrackEvidence: 'present',
      },
    });

    expect(result).toMatchObject({
      allowed: true,
      requiresClarification: false,
      requiresHumanDecision: false,
      reason: 'policy_allowed',
      safety: 'read_only_policy_evaluation',
      sideEffects: 'none',
    });
    expect(result.sources).toContain('capability-catalog');
  });

  it('returns evidence gaps with positive follow-ups for missing capability inputs', async () => {
    const result = await broker.call('governance.evaluatePolicy', {
      capability: 'znp_production_readiness_evidence_gate',
      action: 'znp.productionReadinessStatus',
      context: {},
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('evidence_missing');
    expect(result.evidenceGaps).toEqual([
      expect.objectContaining({
        name: 'projectId',
        positiveFollowUp: expect.objectContaining({
          missingDataPoint: 'projectId',
        }),
      }),
    ]);
  });

  it('evaluates control-case missing evidence as clarification when decisionPolicy requires it', async () => {
    const result = await broker.call('governance.evaluatePolicy', {
      controlCase: {
        controlCase: 'redispatch',
        evidenceRequirements: [{ id: 'remote-control-proof', label: 'Nachweis Fernsteuerbarkeit' }],
        decisionPolicy: { onMissingEvidence: 'clarification' },
      },
      context: {},
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('clarification_required');
    expect(result.requiresClarification).toBe(true);
    expect(result.clarificationQuestion.fields).toEqual(['remote-control-proof']);
    expect(result.evidenceGaps[0]).toMatchObject({
      name: 'remote-control-proof',
      source: 'controlCase.evidenceRequirements',
    });
  });

  it('evaluates control-case financial impact as human decision only', async () => {
    const result = await broker.call('governance.evaluatePolicy', {
      controlCase: {
        controlCase: 'asset_transformation',
        evidenceRequirements: [],
        decisionPolicy: { onHighFinancialImpact: 'mandatory_human_decision' },
      },
      context: { highFinancialImpact: true },
    });

    expect(result).toMatchObject({
      allowed: false,
      requiresHumanDecision: true,
      reason: 'human_decision_required',
      hitlPolicy: {
        source: 'controlCase.decisionPolicy',
        trigger: 'highFinancialImpact',
      },
    });
  });

  it('returns deterministic invalid control-case errors', async () => {
    const result = await broker.call('governance.evaluatePolicy', {
      controlCase: { controlCase: 'unsupported_case' },
      context: {},
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('control_case_invalid');
    expect(result.validationErrors).toEqual([
      expect.objectContaining({ code: 'unsupported_control_case' }),
    ]);
  });

  it('can be reused by the Sidecar policy module without Personal Agent branching', () => {
    const result = evaluateToolPolicy(
      {
        name: 'cernion.get_evidence_status',
        targetAction: 'znp.productionReadinessStatus',
      },
      {
        capability: 'znp_production_readiness_evidence_gate',
        targetAction: 'znp.productionReadinessStatus',
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('evidence_missing');
    expect(result.sources).toContain('capability-catalog.requiredInputs');
  });

  it('derives HITL resolver roles from a single VDMI verantwortlich role', () => {
    const result = deriveHitlResolverRoles({
      row: {
        taskId: 'redispatch-control',
        verantwortlich: [{ actorType: 'role', actorId: 'ROLE_NETZBETRIEB' }],
        mitwirkend: [],
      },
    });

    expect(result).toMatchObject({
      safety: 'read_only_role_derivation',
      sideEffects: 'none',
      requiredResolverRoles: ['ROLE_NETZBETRIEB'],
      contributorApprovalRoles: [],
      fallbackUsed: false,
      missingRoleMetadata: false,
      reason: 'vdmi_roles_derived',
    });
  });

  it('dedupes structured verantwortlich roles and keeps contributors advisory by default', () => {
    const result = deriveHitlResolverRoles({
      row: {
        verantwortlich: [
          { actorId: 'ROLE_NETZBETRIEB' },
          { role: 'ROLE_NETZBETRIEB' },
          'ROLE_KAUFMAENNISCHE_LEITUNG',
        ],
        mitwirkend: [{ actorId: 'ROLE_REGULIERUNG' }],
      },
    });

    expect(result.requiredResolverRoles).toEqual([
      'ROLE_NETZBETRIEB',
      'ROLE_KAUFMAENNISCHE_LEITUNG',
    ]);
    expect(result.contributorApprovalRoles).toEqual([]);
    expect(result.evidenceGaps).toEqual([
      expect.objectContaining({
        name: 'vdmi_contributor_approval_policy',
        reason: 'contributors_present_without_multi_party_policy',
      }),
    ]);
  });

  it('returns mitwirkend roles only when explicit multi-party approval is requested', () => {
    const result = deriveHitlResolverRoles({
      row: {
        verantwortlich: [{ actorId: 'ROLE_NETZBETRIEB' }],
        mitwirkend: [{ actorId: 'ROLE_REGULIERUNG' }, { actorId: 'ROLE_FINANZEN' }],
      },
      decisionPolicy: { multiPartyApproval: true },
    });

    expect(result.requiredResolverRoles).toEqual(['ROLE_NETZBETRIEB']);
    expect(result.contributorApprovalRoles).toEqual(['ROLE_REGULIERUNG', 'ROLE_FINANZEN']);
    expect(result.contributorApprovalRequired).toBe(true);
    expect(result.evidenceGaps).toEqual([]);
  });

  it('returns a fallback envelope when VDMI role metadata is missing', () => {
    const result = deriveHitlResolverRoles({
      row: { taskId: 'legacy-row' },
      fallbackRoles: ['ROLE_LEGACY', 'ROLE_LEGACY'],
    });

    expect(result).toMatchObject({
      requiredResolverRoles: ['ROLE_LEGACY'],
      fallbackUsed: true,
      missingRoleMetadata: true,
      reason: 'fallback_roles_used',
    });
    expect(result.evidenceGaps).toEqual([
      expect.objectContaining({
        name: 'vdmi_row_verantwortlich',
        reason: 'missing_responsible_role_metadata',
      }),
    ]);
  });

  it('exposes the same derivation through a read-only governance action', async () => {
    const result = await broker.call('governance.deriveHitlResolverRoles', {
      row: {
        verantwortlich: [{ actorId: 'ROLE_ASSET_OWNER' }],
        mitwirkend: [{ actorId: 'ROLE_FINANCE' }],
      },
      decisionPolicy: { approvalMode: 'responsible_and_contributors' },
    });

    expect(result).toMatchObject({
      success: true,
      safety: 'read_only_role_derivation',
      sideEffects: 'none',
      requiredResolverRoles: ['ROLE_ASSET_OWNER'],
      contributorApprovalRoles: ['ROLE_FINANCE'],
    });
  });

  it('uses row decisionPolicy through the governance action when no override is supplied', async () => {
    const result = await broker.call('governance.deriveHitlResolverRoles', {
      row: {
        verantwortlich: [{ actorId: 'ROLE_ASSET_OWNER' }],
        mitwirkend: [{ actorId: 'ROLE_FINANCE' }],
        decisionPolicy: { requireContributorApproval: true },
      },
    });

    expect(result.contributorApprovalRoles).toEqual(['ROLE_FINANCE']);
    expect(result.sourceFields.decisionPolicy).toEqual(['decisionPolicy']);
  });
});
