const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const InvestmentMaturityOffBalanceGateService = require('../services/investment-maturity-off-balance-gate.service');

describe('investment-maturity-off-balance-gate service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...InvestmentMaturityOffBalanceGateService,
      settings: {
        ...InvestmentMaturityOffBalanceGateService.settings,
        dbPath: path.join(os.tmpdir(), `imob-test-db-${Date.now()}`),
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const meta = { tenantId: 'tenant-a' };

  function readyParams(overrides = {}) {
    return {
      investmentCaseId: 'investment-case:process-001',
      assetScope: {
        scopeId: 'asset-scope-grid-001',
        assetType: 'medium-voltage-grid',
        planningArea: 'north-ring',
      },
      maturityLevel: 'gate-3-investment-ready',
      processQualityScore: 0.86,
      offBalanceStructure: {
        structureType: 'external-infrastructure-partner',
        boundary: 'asset financing only; no operational control transfer',
      },
      additionalFinancingCostEur: 125000,
      regulatoryReturnHypothesis: {
        summary: 'External financing could preserve regulated return headroom',
        basis: 'finance-agent:analysis-001',
        confidence: 'hypothesis',
      },
      assetRiskReference: {
        referenceId: 'asset-risk:grid-001',
        riskClass: 'medium',
      },
      isoRiskReference: {
        referenceId: 'iso-risk:control-001',
        standard: 'ISO 31000',
      },
      decisionForum: {
        name: 'Investitionsausschuss Netz',
        owner: 'CFO/Netzgeschaeftsfuehrung',
      },
      decisionFrameId: 'decision-frame:001',
      financeAnalysisId: 'finance-analysis:001',
      investmentPlanId: 'investment-plan:001',
      sourceActions: [
        'investment-planning.createPlan',
        'finance-agent.analyze',
        'decision-frame.evaluate',
        'vdmi-evidence.inject',
        'presentation.generate',
      ],
      evidence: [
        { kind: 'observed', source: 'investment-planning', fact: 'CAPEX measure exists' },
        { kind: 'hypothesis', source: 'finance-agent', fact: 'Return headroom assumption' },
      ],
      ...overrides,
    };
  }

  test('evaluate stores ready off-balance evidence without approving financing', async () => {
    const result = await broker.call(
      'investment-maturity-off-balance-gate.evaluate',
      readyParams(),
      { meta }
    );

    expect(result.gateId).toMatch(/^imob:/);
    expect(result.evidenceStatus).toBe('ready');
    expect(result.validationFindings.some((f) => f.finding === 'IMOB_GATE_READY')).toBe(true);
    expect(result.observedEvidence).toHaveLength(1);
    expect(result.hypothesisEvidence).toHaveLength(1);
    expect(result.forbiddenAutomaticActions).toEqual(
      expect.arrayContaining([
        'financing-approval',
        'off-balance-legal-determination',
        'accounting-write',
        'investment-plan-mutation',
      ])
    );
  });

  test('evaluate blocks when maturity, costs, asset risk and forum are missing', async () => {
    const result = await broker.call(
      'investment-maturity-off-balance-gate.evaluate',
      readyParams({
        investmentCaseId: 'investment-case:blocked-001',
        maturityLevel: '',
        processQualityScore: undefined,
        additionalFinancingCostEur: undefined,
        regulatoryReturnHypothesis: {},
        assetRiskReference: {},
        isoRiskReference: {},
        decisionForum: {},
        sourceActions: [],
      }),
      { meta }
    );

    expect(result.evidenceStatus).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.finding)).toEqual(
      expect.arrayContaining([
        'IMOB_MATURITY_MODEL_MISSING',
        'IMOB_PROCESS_QUALITY_LOW',
        'IMOB_FINANCING_COST_MISSING',
        'IMOB_ASSET_RISK_REFERENCE_MISSING',
        'IMOB_DECISION_FORUM_MISSING',
        'IMOB_GATE_BLOCKED',
      ])
    );
    expect(result.missingDataPoints).toEqual(
      expect.arrayContaining([
        'maturity_model',
        'process_quality',
        'financing_cost',
        'regulatory_return_hypothesis',
        'asset_risk_reference',
        'iso_risk_reference',
        'decision_forum',
        'source_action_references',
      ])
    );
    expect(result.positiveFollowUps).toContainEqual({
      missingDataPoint: 'asset_risk_reference',
      enablesDossierAddition: 'adds asset-risk linkage to the investment decision',
    });
  });

  test('listGates, getGate and getStatus expose tenant-scoped dossier-safe evidence', async () => {
    const created = await broker.call(
      'investment-maturity-off-balance-gate.evaluate',
      readyParams({ investmentCaseId: 'investment-case:status-001' }),
      { meta }
    );

    const list = await broker.call(
      'investment-maturity-off-balance-gate.listGates',
      { investmentCaseId: 'investment-case:status-001' },
      { meta }
    );
    expect(list.gates.some((gate) => gate._id === created.gateId)).toBe(true);

    const gate = await broker.call(
      'investment-maturity-off-balance-gate.getGate',
      { gateId: created.gateId },
      { meta }
    );
    expect(gate.investmentCaseId).toBe('investment-case:status-001');

    const status = await broker.call(
      'investment-maturity-off-balance-gate.getStatus',
      { investmentCaseId: 'investment-case:status-001' },
      { meta }
    );
    expect(status.found).toBe(true);
    expect(status.answerFacts.decisionForum.name).toBe('Investitionsausschuss Netz');
    expect(status.sourceActions).toContain('finance-agent.analyze');
    expect(status.forbiddenAutomaticActions).toContain('off-balance-legal-determination');
  });

  test('getStatus returns dossier-safe not-found state', async () => {
    const status = await broker.call(
      'investment-maturity-off-balance-gate.getStatus',
      { investmentCaseId: 'investment-case:missing' },
      { meta }
    );

    expect(status).toEqual({
      found: false,
      investmentCaseId: 'investment-case:missing',
      gateId: null,
      message: 'No investment maturity off-balance gate evidence is available for this tenant yet',
    });
  });

  test('getGate hides gates from other tenants', async () => {
    const created = await broker.call(
      'investment-maturity-off-balance-gate.evaluate',
      readyParams({ investmentCaseId: 'investment-case:tenant-secret' }),
      { meta }
    );

    await expect(
      broker.call(
        'investment-maturity-off-balance-gate.getGate',
        { gateId: created.gateId },
        { meta: { tenantId: 'tenant-b' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'IMOB_GATE_NOT_FOUND' });
  });
});
