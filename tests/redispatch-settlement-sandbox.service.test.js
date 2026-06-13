const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const RedispatchSettlementSandboxService = require('../services/redispatch-settlement-sandbox.service');

describe('redispatch-settlement-sandbox service', () => {
  let broker;
  let settlementMockResults = [];

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...RedispatchSettlementSandboxService,
      settings: {
        ...RedispatchSettlementSandboxService.settings,
        dbPath: path.join(os.tmpdir(), `rdss-test-db-${Date.now()}`),
      },
    });

    // Mock settlement service
    broker.createService({
      name: 'settlement',
      actions: {
        a96Reconcile: {
          handler(ctx) {
            if (settlementMockResults.length > 0) {
              const result = settlementMockResults.shift();
              if (result instanceof Error) throw result;
              return result;
            }
            // Default success
            return {
              success: true,
              totalKwh: 1234.5,
              totalEur: 567.89,
              method: ctx.params.settlementMethod,
            };
          },
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const defaultMeta = { tenantId: 'test-tenant' };

  function makeScenario(overrides = {}) {
    return {
      gridOperatorId: 'SNB123456789000',
      periodStart: '2025-01-01T00:00:00Z',
      periodEnd: '2025-01-31T23:59:59Z',
      settlementMethod: 'eeg_tariff',
      policyVersion: '1.0',
      ...overrides,
    };
  }

  // ── createScenario and get it ─────────────────────────────────────────────

  test('createScenario and getScenario', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: ['art-001'], datapointRefs: ['dp-001'] }),
      { meta: defaultMeta }
    );

    expect(scenario._id).toBeTruthy();
    expect(scenario.status).toBe('created');
    expect(scenario.inputHash).toBeTruthy();
    expect(scenario.inputHash.length).toBe(16);

    const fetched = await broker.call(
      'redispatch-settlement-sandbox.getScenario',
      { id: scenario._id },
      { meta: defaultMeta }
    );
    expect(fetched._id).toBe(scenario._id);
  });

  // ── reconcile: no inputArtifactRefs → RDSS_MISSING_SCENARIO ──────────────

  test('reconcile scenario with no inputArtifactRefs → RDSS_MISSING_SCENARIO', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: [], datapointRefs: [] }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-settlement-sandbox.reconcile',
      { id: scenario._id },
      { meta: defaultMeta }
    );

    expect(result.status).toBe('reconcile_failed');
    expect(result.findings.some((f) => f.finding === 'RDSS_MISSING_SCENARIO')).toBe(true);
  });

  // ── reconcile: service unavailable → RDSS_MISSING_DATAPOINT_EVIDENCE ─────

  test('reconcile with settlement service unavailable → RDSS_MISSING_DATAPOINT_EVIDENCE', async () => {
    // Make the mock throw
    settlementMockResults.push(new Error('Service unavailable'));

    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: ['art-002'], datapointRefs: ['dp-002'] }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-settlement-sandbox.reconcile',
      { id: scenario._id },
      { meta: defaultMeta }
    );

    expect(result.status).toBe('reconcile_failed');
    expect(result.findings.some((f) => f.finding === 'RDSS_MISSING_DATAPOINT_EVIDENCE')).toBe(true);
  });

  // ── reconcile: success → RDSS_SCENARIO_COMPLETE, status reconciled ────────

  test('reconcile with settlement mock success → RDSS_SCENARIO_COMPLETE and status reconciled', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: ['art-003'], datapointRefs: ['dp-003'] }),
      { meta: defaultMeta }
    );

    const result = await broker.call(
      'redispatch-settlement-sandbox.reconcile',
      { id: scenario._id },
      { meta: defaultMeta }
    );

    expect(result.status).toBe('reconciled');
    expect(result.findings.some((f) => f.finding === 'RDSS_SCENARIO_COMPLETE')).toBe(true);
    expect(result.reconcileResult).toBeTruthy();
    expect(result.reconcileResult.totalKwh).toBe(1234.5);
  });

  // ── scenario is immutable after reconcile ────────────────────────────────

  test('scenario is immutable after reconcile — second reconcile throws 409', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: ['art-004'], datapointRefs: ['dp-004'] }),
      { meta: defaultMeta }
    );

    await broker.call(
      'redispatch-settlement-sandbox.reconcile',
      { id: scenario._id },
      { meta: defaultMeta }
    );

    await expect(
      broker.call(
        'redispatch-settlement-sandbox.reconcile',
        { id: scenario._id },
        { meta: defaultMeta }
      )
    ).rejects.toMatchObject({ code: 409 });
  });

  // ── listScenarios with gridOperatorId filter ──────────────────────────────

  test('listScenarios with gridOperatorId filter', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ gridOperatorId: 'FILTER-OP-001', inputArtifactRefs: ['art-005'] }),
      { meta: defaultMeta }
    );

    const list = await broker.call(
      'redispatch-settlement-sandbox.listScenarios',
      { gridOperatorId: 'FILTER-OP-001' },
      { meta: defaultMeta }
    );

    expect(list.scenarios.some((s) => s._id === scenario._id)).toBe(true);
    expect(list.scenarios.every((s) => s.gridOperatorId === 'FILTER-OP-001')).toBe(true);
  });

  // ── downloadScenario (json format) ───────────────────────────────────────

  test('downloadScenario json format', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: ['art-006'] }),
      { meta: defaultMeta }
    );

    const download = await broker.call(
      'redispatch-settlement-sandbox.downloadScenario',
      { id: scenario._id, format: 'json' },
      { meta: defaultMeta }
    );

    expect(download.format).toBe('json');
    expect(download.scenario._id).toBe(scenario._id);
  });

  test('downloadScenario text format', async () => {
    const scenario = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: ['art-007'] }),
      { meta: defaultMeta }
    );

    const download = await broker.call(
      'redispatch-settlement-sandbox.downloadScenario',
      { id: scenario._id, format: 'text' },
      { meta: defaultMeta }
    );

    expect(download.format).toBe('text');
    expect(typeof download.content).toBe('string');
    expect(download.content).toContain('SNB123456789000');
  });

  // ── inputHash is deterministic ────────────────────────────────────────────

  test('inputHash is deterministic — same refs produce same hash', async () => {
    const refs = ['artifact-a', 'artifact-b'];
    const dps = ['dp-x', 'dp-y'];

    const s1 = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: refs, datapointRefs: dps }),
      { meta: defaultMeta }
    );

    const s2 = await broker.call(
      'redispatch-settlement-sandbox.createScenario',
      makeScenario({ inputArtifactRefs: refs, datapointRefs: dps }),
      { meta: defaultMeta }
    );

    expect(s1.inputHash).toBe(s2.inputHash);
  });
});
