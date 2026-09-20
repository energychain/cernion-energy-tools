'use strict';

const { ServiceBroker } = require('moleculer');
const GovernanceService = require('../services/governance.service');
const { validateVdmiMatrixRow } = require('../src/vdmi-matrix-schema');
const {
  buildMakoResolutionControlCase,
  buildAssetToDecisionControlCase,
} = require('../src/stadtwerk-governance-architecture/governance-policy-adapter');

function expectValidControlCase(controlCase) {
  const validation = validateVdmiMatrixRow(controlCase, { path: 'controlCase' });
  expect(validation).toEqual({ valid: true, errors: [] });
  expect(controlCase.controlCase).toMatch(/^(asset_transformation|custom:[a-z0-9][a-z0-9_.:-]*|project:[a-z0-9][a-z0-9_.:-]*)$/);
  expect(controlCase.controlCase).not.toBe('unsupported_case');
}

function expectGapNames(result, expectedNames) {
  const names = result.evidenceGaps.map((gap) => gap.name);
  expect(names).toEqual(expect.arrayContaining(expectedNames));
}

describe('CR-LKA Stadtwerk governance architecture policy adapter', () => {
  let broker;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(GovernanceService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  test('MaKo finalization missing evidence returns clarification and a human-safe boundary', async () => {
    const missingEvidence = [
      'confirmed_invoice_amount',
      'market_partner_confirmation',
      'owner_approval',
    ];
    const controlCase = buildMakoResolutionControlCase({ missingEvidence });

    expectValidControlCase(controlCase);
    expect(controlCase.controlCase).toMatch(/^custom:/);
    expect(controlCase.decisionPolicy.onMissingEvidence).toBe('clarification');

    const result = await broker.call('governance.evaluatePolicy', {
      controlCase,
      context: {},
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'clarification_required',
      requiresClarification: true,
      safety: 'read_only_policy_evaluation',
      sideEffects: 'none',
    });
    expectGapNames(result, missingEvidence);
    expect(result.sources).toEqual(
      expect.arrayContaining(['vdmi-matrix-schema', 'controlCase.decisionPolicy']),
    );
  });

  test('asset high financial impact requires a human decision', async () => {
    const controlCase = buildAssetToDecisionControlCase({
      missingEvidence: [],
      highFinancialImpact: true,
    });

    expectValidControlCase(controlCase);
    expect(controlCase.controlCase).toBe('asset_transformation');
    expect(controlCase.decisionPolicy.onHighFinancialImpact).toBe('mandatory_human_decision');

    const result = await broker.call('governance.evaluatePolicy', {
      controlCase,
      context: { highFinancialImpact: true, evidence: {} },
    });

    expect(result).toMatchObject({
      allowed: false,
      reason: 'human_decision_required',
      requiresHumanDecision: true,
      hitlPolicy: {
        trigger: 'highFinancialImpact',
      },
      safety: 'read_only_policy_evaluation',
      sideEffects: 'none',
    });
  });

  test('asset missing alternatives or decision owner prevents committee readiness', async () => {
    const missingEvidence = ['alternative_options', 'decision_owner'];
    const controlCase = buildAssetToDecisionControlCase({ missingEvidence });

    expectValidControlCase(controlCase);
    expect(controlCase.decisionPolicy.onMissingEvidence).toBe('clarification');
    expect(controlCase.evidenceRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'alternative_options' }),
        expect.objectContaining({ id: 'decision_owner' }),
      ]),
    );

    const result = await broker.call('governance.evaluatePolicy', {
      controlCase,
      context: {},
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('clarification_required');
    expect(result.requiresClarification).toBe(true);
    expectGapNames(result, missingEvidence);
    expect(result.committeeReady).not.toBe(true);
  });
});
