const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const RedispatchSpecialCaseGateService = require('../services/redispatch-special-case-gate.service');

describe('redispatch-special-case-gate service', () => {
  let broker;
  let relationshipsMock = [];
  let assetsMock = null;
  let assetsServiceAvailable = true;
  let relationshipsServiceAvailable = true;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...RedispatchSpecialCaseGateService,
      settings: {
        ...RedispatchSpecialCaseGateService.settings,
        dbPath: path.join(os.tmpdir(), `rscg-test-db-${Date.now()}`),
      },
    });

    // Mock asset register
    broker.createService({
      name: 'redispatch-asset-register',
      actions: {
        listRelationships: {
          handler(_ctx) {
            if (!relationshipsServiceAvailable) {
              throw new Error('Service unavailable');
            }
            return { relationships: [...relationshipsMock] };
          },
        },
      },
    });

    // Mock assets service
    broker.createService({
      name: 'assets',
      actions: {
        list: {
          handler(ctx) {
            if (!assetsServiceAvailable) {
              throw new Error('Service unavailable');
            }
            if (assetsMock !== null) {
              return assetsMock;
            }
            return { assets: [] };
          },
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    relationshipsMock = [];
    assetsMock = null;
    assetsServiceAvailable = true;
    relationshipsServiceAvailable = true;
  });

  const defaultMeta = { tenantId: 'test-tenant' };

  function baseParams(overrides = {}) {
    return {
      mastrId: 'SEE910001234',
      periodStart: '2025-01-01T00:00:00Z',
      periodEnd: '2025-01-31T23:59:59Z',
      ...overrides,
    };
  }

  // ── co-location: no relationships found ───────────────────────────────────

  test('evaluate with no relationships found → RSCG_CO_LOCATION_UNCONFIRMED', async () => {
    relationshipsMock = [];
    assetsMock = { assets: [{ mastrId: 'SEE910001234', fernsteuerbarkeitDv: '1' }] };

    const result = await broker.call(
      'redispatch-special-case-gate.evaluate',
      baseParams({ nonAvailabilityEvidenceRefs: ['ev-001'] }),
      { meta: defaultMeta }
    );

    expect(result.findings.some((f) => f.finding === 'RSCG_CO_LOCATION_UNCONFIRMED')).toBe(true);
  });

  // ── co-location: relationship found ──────────────────────────────────────

  test('evaluate with relationship found → RSCG_CO_LOCATION_CONFIRMED', async () => {
    relationshipsMock = [
      { assetIdA: 'SEE910001234', assetIdB: 'SEE910001235', relationshipType: 'co_location' },
    ];
    assetsMock = { assets: [{ mastrId: 'SEE910001234', fernsteuerbarkeitDv: '1' }] };

    const result = await broker.call(
      'redispatch-special-case-gate.evaluate',
      baseParams({ nonAvailabilityEvidenceRefs: ['ev-001'] }),
      { meta: defaultMeta }
    );

    expect(result.findings.some((f) => f.finding === 'RSCG_CO_LOCATION_CONFIRMED')).toBe(true);
  });

  // ── controllability: fernsteuerbarkeitDv = 1 ─────────────────────────────

  test('evaluate with fernsteuerbarkeitDv=1 → RSCG_CONTROLLABILITY_CONFIRMED', async () => {
    assetsMock = { assets: [{ mastrId: 'SEE910001234', fernsteuerbarkeitDv: '1' }] };

    const result = await broker.call('redispatch-special-case-gate.evaluate', baseParams(), {
      meta: defaultMeta,
    });

    expect(result.findings.some((f) => f.finding === 'RSCG_CONTROLLABILITY_CONFIRMED')).toBe(true);
  });

  // ── controllability: asset not found ─────────────────────────────────────

  test('evaluate with asset not found → RSCG_CONTROLLABILITY_MISSING', async () => {
    assetsMock = { assets: [] };

    const result = await broker.call('redispatch-special-case-gate.evaluate', baseParams(), {
      meta: defaultMeta,
    });

    expect(result.findings.some((f) => f.finding === 'RSCG_CONTROLLABILITY_MISSING')).toBe(true);
  });

  // ── non-availability: evidence present ───────────────────────────────────

  test('evaluate with nonAvailabilityEvidenceRefs → RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT', async () => {
    assetsMock = { assets: [{ mastrId: 'SEE910001234', fernsteuerbarkeitDv: '1' }] };

    const result = await broker.call(
      'redispatch-special-case-gate.evaluate',
      baseParams({ nonAvailabilityEvidenceRefs: ['nae-ref-001', 'nae-ref-002'] }),
      { meta: defaultMeta }
    );

    expect(
      result.findings.some((f) => f.finding === 'RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT')
    ).toBe(true);
  });

  // ── non-availability: no evidence refs ───────────────────────────────────

  test('evaluate with no evidence refs → RSCG_NON_AVAILABILITY_EVIDENCE_MISSING', async () => {
    assetsMock = { assets: [{ mastrId: 'SEE910001234', fernsteuerbarkeitDv: '1' }] };

    const result = await broker.call(
      'redispatch-special-case-gate.evaluate',
      baseParams({ nonAvailabilityEvidenceRefs: [] }),
      { meta: defaultMeta }
    );

    expect(
      result.findings.some((f) => f.finding === 'RSCG_NON_AVAILABILITY_EVIDENCE_MISSING')
    ).toBe(true);
  });

  // ── overall status: blocked when controllability missing ─────────────────

  test('overall status blocked when controllability missing', async () => {
    assetsMock = { assets: [] }; // fernsteuerbarkeitDv not 1 → error

    const result = await broker.call('redispatch-special-case-gate.evaluate', baseParams(), {
      meta: defaultMeta,
    });

    expect(result.status).toBe('blocked');
    expect(result.findings.some((f) => f.finding === 'RSCG_GATE_BLOCKED')).toBe(true);
  });

  // ── overall status: insufficient_evidence when asset service unavailable ──

  test('overall status insufficient_evidence when asset service unavailable', async () => {
    assetsServiceAvailable = false;
    relationshipsMock = [];

    const result = await broker.call('redispatch-special-case-gate.evaluate', baseParams(), {
      meta: defaultMeta,
    });

    expect(result.status).toBe('insufficient_evidence');
    expect(result.findings.some((f) => f.finding === 'RSCG_GATE_INSUFFICIENT_EVIDENCE')).toBe(true);
  });

  // ── listRuns and getRun ───────────────────────────────────────────────────

  test('listRuns and getRun', async () => {
    assetsMock = { assets: [{ mastrId: 'SEE910001300', fernsteuerbarkeitDv: '1' }] };

    const evalResult = await broker.call(
      'redispatch-special-case-gate.evaluate',
      { ...baseParams(), mastrId: 'SEE910001300', nonAvailabilityEvidenceRefs: ['ev-lr-001'] },
      { meta: defaultMeta }
    );

    const list = await broker.call(
      'redispatch-special-case-gate.listRuns',
      { mastrId: 'SEE910001300' },
      { meta: defaultMeta }
    );

    expect(list.runs.some((r) => r._id === evalResult.gateRunId)).toBe(true);

    const run = await broker.call(
      'redispatch-special-case-gate.getRun',
      { id: evalResult.gateRunId },
      { meta: defaultMeta }
    );
    expect(run._id).toBe(evalResult.gateRunId);
    expect(run.mastrId).toBe('SEE910001300');
  });
});
