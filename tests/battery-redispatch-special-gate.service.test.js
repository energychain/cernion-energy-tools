const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const BatteryRedispatchSpecialGateService = require('../services/battery-redispatch-special-gate.service');

describe('battery-redispatch-special-gate service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...BatteryRedispatchSpecialGateService,
      settings: {
        ...BatteryRedispatchSpecialGateService.settings,
        dbPath: path.join(os.tmpdir(), `brs-test-db-${Date.now()}`),
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
      assetId: 'bess-asset-001',
      bessScreeningId: 'bess-screening-001',
      maloDecision: 'separate-injection-and-withdrawal-malo',
      meloRefs: ['melo-injection-001', 'melo-withdrawal-001'],
      meteringConceptId: 'mk-bess-001',
      injectionDirection: 'injection',
      withdrawalDirection: 'withdrawal',
      positiveRedispatchEligible: true,
      negativeRedispatchEligible: true,
      controllabilityDirection: 'bidirectional',
      testCallLimitKw: 1200,
      testCallProofRef: 'proof:test-call-001',
      productionProofConfirmed: true,
      settlementReadiness: 'ready',
      clearingDecision: 'approved',
      billingDecision: 'approved',
      sourceActions: [
        { service: 'bess-screening', action: 'screen', ref: 'bess-screening-001' },
        { service: 'edm-messkonzept', action: 'get', ref: 'mk-bess-001' },
      ],
      ...overrides,
    };
  }

  test('evaluate stores a ready battery storage gate without consequential actions', async () => {
    const result = await broker.call('battery-redispatch-special-gate.evaluate', readyParams(), {
      meta,
    });

    expect(result.gateId).toMatch(/^brs:/);
    expect(result.evidenceStatus).toBe('ready');
    expect(result.validationFindings.some((f) => f.finding === 'BRS_GATE_READY')).toBe(true);
    expect(result.sourceActions).toHaveLength(2);
    expect(result.recommendedNextDecision).toContain('clearing review');
  });

  test('evaluate blocks when MaLo, metering, directions and proofs are incomplete', async () => {
    const result = await broker.call(
      'battery-redispatch-special-gate.evaluate',
      readyParams({
        assetId: 'bess-blocked-001',
        maloDecision: '',
        meloRefs: [],
        meteringConceptId: '',
        injectionDirection: '',
        withdrawalDirection: '',
        positiveRedispatchEligible: undefined,
        negativeRedispatchEligible: undefined,
        controllabilityDirection: '',
        testCallProofRef: '',
        productionProofConfirmed: false,
        settlementReadiness: 'blocked',
        clearingDecision: 'blocked',
        billingDecision: 'blocked',
      }),
      { meta }
    );

    expect(result.evidenceStatus).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.finding)).toEqual(
      expect.arrayContaining([
        'BRS_MALO_DIRECTION_MISSING',
        'BRS_METERING_CONCEPT_MISSING',
        'BRS_REDISPATCH_DIRECTION_INCOMPLETE',
        'BRS_CONTROLLABILITY_DIRECTION_MISSING',
        'BRS_PRODUCTION_PROOF_MISSING',
        'BRS_SETTLEMENT_DIRECTION_CONFLICT',
        'BRS_GATE_BLOCKED',
      ])
    );
    expect(result.missingDataPoints).toEqual(
      expect.arrayContaining(['maloDecision', 'testCallProofRef', 'productionProofConfirmed'])
    );
  });

  test('listGates, getGate and getStatus expose tenant-scoped dossier-safe evidence', async () => {
    const created = await broker.call(
      'battery-redispatch-special-gate.evaluate',
      readyParams({ assetId: 'bess-status-001' }),
      { meta }
    );

    const list = await broker.call(
      'battery-redispatch-special-gate.listGates',
      { assetId: 'bess-status-001' },
      { meta }
    );
    expect(list.gates.some((gate) => gate._id === created.gateId)).toBe(true);

    const gate = await broker.call(
      'battery-redispatch-special-gate.getGate',
      { gateId: created.gateId },
      { meta }
    );
    expect(gate.assetId).toBe('bess-status-001');

    const status = await broker.call(
      'battery-redispatch-special-gate.getStatus',
      { gateId: created.gateId },
      { meta }
    );
    expect(status.found).toBe(true);
    expect(status.answerFacts.assetId).toBe('bess-status-001');
    expect(status.answerFacts.controllabilityDirection).toBe('bidirectional');
    expect(status.sourceActions[0].service).toBe('bess-screening');
  });

  test('getStatus returns dossier-safe not-found state', async () => {
    const status = await broker.call(
      'battery-redispatch-special-gate.getStatus',
      { gateId: 'brs:missing' },
      { meta }
    );

    expect(status).toEqual({
      found: false,
      message: 'No battery Redispatch special gate evidence is available for this tenant yet',
    });
  });

  test('getGate hides gates from other tenants', async () => {
    const created = await broker.call(
      'battery-redispatch-special-gate.evaluate',
      readyParams({ assetId: 'bess-tenant-secret' }),
      { meta }
    );

    await expect(
      broker.call(
        'battery-redispatch-special-gate.getGate',
        { gateId: created.gateId },
        { meta: { tenantId: 'tenant-b' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'GATE_NOT_FOUND' });
  });
});
