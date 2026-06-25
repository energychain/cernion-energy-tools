'use strict';

const { ServiceBroker } = require('moleculer');
const GovernanceService = require('../services/governance.service');
const { evaluateToolPolicy } = require('../src/agent-sidecar-policy');

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
});
