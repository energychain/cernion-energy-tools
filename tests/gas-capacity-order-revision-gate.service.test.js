const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const GasCapacityOrderRevisionGateService = require('../services/gas-capacity-order-revision-gate.service');

describe('gas-capacity-order-revision-gate service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...GasCapacityOrderRevisionGateService,
      settings: {
        ...GasCapacityOrderRevisionGateService.settings,
        dbPath: path.join(os.tmpdir(), `gcorg-test-db-${Date.now()}`),
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
      orderYear: 2027,
      gridOperatorId: 'gas-vnb:stadtwerk-a',
      nkpIds: ['nkp:west', 'nkp:ost'],
      toolValueMwhPerDay: 1250,
      securityMarkupPercent: 8,
      coldYearScenario: { summary: 'Kaltjahr P95 hebt Spitzenbedarf um 6 Prozent' },
      industrialReboundScenario: { summary: 'RLM-Rebound auf 2024-Niveau plausibilisiert' },
      reversibleRlmLoads: [
        { customerGroup: 'Industrie', mwhPerDay: 90, reversibility: 'interruptible' },
      ],
      historicalBottleneckEvidence: [
        { nkpId: 'nkp:west', winter: '2023/24', status: 'near_constraint' },
      ],
      nkpDistribution: [
        { nkpId: 'nkp:west', share: 0.6 },
        { nkpId: 'nkp:ost', share: 0.4 },
      ],
      tariffImpact: { summary: 'Mehrkosten bleiben im genehmigten Entgeltpfad' },
      pressureMaintenanceFlexibility: { summary: 'Wartungsfenster Q3 vermeidet Winterspitze' },
      maintenanceWindows: [{ from: '2027-07-01', to: '2027-08-15' }],
      decisionForum: 'Gasnetz Jahresbestellrunde',
      decisionStatus: 'revision_evidence_ready',
      sourceActions: [
        'gas-storage.countryStorage',
        'forecast.generate',
        'grid-connection.validate',
        'finance-agent.analyze',
        'presentation.generate',
      ],
      ...overrides,
    };
  }

  test('evaluate stores ready gas-capacity revision evidence without ordering gas capacity', async () => {
    const result = await broker.call('gas-capacity-order-revision-gate.evaluate', readyParams(), {
      meta,
    });

    expect(result.revisionId).toMatch(/^gcorg:/);
    expect(result.evidenceStatus).toBe('ready');
    expect(result.revisedCapacityHypothesisMwhPerDay).toBe(1350);
    expect(result.validationFindings.some((f) => f.finding === 'GCORG_GATE_READY')).toBe(true);
    expect(result.sourceActions).toContain('forecast.generate');
    expect(result.forbiddenAutomaticActions).toEqual(
      expect.arrayContaining([
        'gas-capacity-order-submission',
        'nomination-write',
        'pressure-control-action',
      ])
    );
  });

  test('evaluate blocks when core order, scenario, NKP and decision evidence are missing', async () => {
    const result = await broker.call(
      'gas-capacity-order-revision-gate.evaluate',
      readyParams({
        gridOperatorId: 'gas-vnb:blocking',
        toolValueMwhPerDay: 0,
        coldYearScenario: {},
        industrialReboundScenario: {},
        reversibleRlmLoads: [],
        historicalBottleneckEvidence: [],
        nkpDistribution: [],
        tariffImpact: {},
        pressureMaintenanceFlexibility: {},
        maintenanceWindows: [],
        decisionForum: '',
        decisionStatus: '',
        sourceActions: [],
      }),
      { meta }
    );

    expect(result.evidenceStatus).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.finding)).toEqual(
      expect.arrayContaining([
        'GCORG_TOOL_VALUE_MISSING',
        'GCORG_COLD_YEAR_SCENARIO_MISSING',
        'GCORG_NKP_DISTRIBUTION_MISSING',
        'GCORG_DECISION_RESOLUTION_MISSING',
        'GCORG_GATE_BLOCKED',
      ])
    );
    expect(result.missingDataPoints).toEqual(
      expect.arrayContaining([
        'tool_value',
        'cold_year_scenario',
        'industrial_rebound_scenario',
        'reversible_rlm_loads',
        'historical_bottleneck_evidence',
        'nkp_distribution',
        'tariff_impact',
        'pressure_maintenance_flexibility',
        'decision_resolution',
        'source_action_references',
      ])
    );
    expect(result.positiveFollowUps).toContainEqual({
      missingDataPoint: 'cold_year_scenario',
      enablesDossierAddition:
        'adds cold-year peak-risk explanation and safety-markup justification',
    });
  });

  test('listRevisions, getRevision and getStatus expose tenant-scoped dossier-safe evidence', async () => {
    const created = await broker.call(
      'gas-capacity-order-revision-gate.evaluate',
      readyParams({ orderYear: 2028, gridOperatorId: 'gas-vnb:status' }),
      { meta }
    );

    const list = await broker.call(
      'gas-capacity-order-revision-gate.listRevisions',
      { orderYear: 2028, gridOperatorId: 'gas-vnb:status' },
      { meta }
    );
    expect(list.revisions.some((revision) => revision._id === created.revisionId)).toBe(true);

    const revision = await broker.call(
      'gas-capacity-order-revision-gate.getRevision',
      { revisionId: created.revisionId },
      { meta }
    );
    expect(revision.gridOperatorId).toBe('gas-vnb:status');

    const status = await broker.call(
      'gas-capacity-order-revision-gate.getStatus',
      { orderYear: 2028, gridOperatorId: 'gas-vnb:status' },
      { meta }
    );
    expect(status.found).toBe(true);
    expect(status.answerFacts.gridOperatorId).toBe('gas-vnb:status');
    expect(status.answerFacts.revisedCapacityHypothesisMwhPerDay).toBe(1350);
    expect(status.sourceActions).toContain('gas-storage.countryStorage');
    expect(status.forbiddenAutomaticActions).toContain('gas-capacity-order-submission');
  });

  test('getStatus returns dossier-safe not-found state', async () => {
    const status = await broker.call(
      'gas-capacity-order-revision-gate.getStatus',
      { orderYear: 2099, gridOperatorId: 'gas-vnb:missing' },
      { meta }
    );

    expect(status).toEqual({
      found: false,
      revisionId: undefined,
      orderYear: 2099,
      gridOperatorId: 'gas-vnb:missing',
      message: 'No gas-capacity order revision evidence is available for this tenant yet',
    });
  });

  test('getRevision hides gas-capacity revisions from other tenants', async () => {
    const created = await broker.call(
      'gas-capacity-order-revision-gate.evaluate',
      readyParams({ gridOperatorId: 'gas-vnb:tenant-secret' }),
      { meta }
    );

    await expect(
      broker.call(
        'gas-capacity-order-revision-gate.getRevision',
        { revisionId: created.revisionId },
        { meta: { tenantId: 'tenant-b' } }
      )
    ).rejects.toMatchObject({ code: 404, type: 'GAS_CAPACITY_REVISION_NOT_FOUND' });
  });
});
