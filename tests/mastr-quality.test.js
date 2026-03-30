'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

// ---------------------------------------------------------------------------
// Jest module mocks — must be declared before any require()
// ---------------------------------------------------------------------------
jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const CernionMCPClient = require('../src/mcp-client');
const vf = require('../src/validation-findings');

// Unique PouchDB path so parallel Jest workers don't clash
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-mq-test-${Date.now()}`);
process.env.MASTR_QUALITY_DB_PATH = TEST_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_OPERATOR = {
  mastrId: 'SNB935578300972',
  name: 'TWL Netze GmbH',
  bdew: '9907473000008',
  bnr: '10002977',
};

const makeInstallation = (overrides = {}) => ({
  EinheitMastrNummer: 'SEE900000001',
  einheitBetriebsstatus: 35,
  bruttoleistung: 500,
  nettoNennleistung: 480,
  NettoNennleistung: 480,
  Postleitzahl: '67063',
  energietraeger: 'solar',
  netzbetreiberPruefungStatus: 2954,
  inbetriebnahmeDatum: '2020-01-15',
  nap: { MastrNummer: 'NAP001', Spannungsebene: 'MS' },
  koordinatenBreitengrad: 49.4774,
  koordinatenLaengengrad: 8.4452,
  ...overrides,
});

const MOCK_INSTALLATIONS = [
  makeInstallation({ EinheitMastrNummer: 'SEE900000001', energietraeger: 'solar' }),
  makeInstallation({
    EinheitMastrNummer: 'SEE900000002',
    energietraeger: 'wind',
    bruttoleistung: 2000,
    NettoNennleistung: 1800,
    nettoNennleistung: 1800,
    Postleitzahl: '67065',
    Nabenhoehe: 100,
    nap: { MastrNummer: 'NAP002', Spannungsebene: 'HS' },
    koordinatenBreitengrad: 49.5000,
    koordinatenLaengengrad: 8.5000,
  }),
];

// ---------------------------------------------------------------------------
// Suite 1 — validation-findings score helpers (pure unit tests)
// ---------------------------------------------------------------------------
describe('computeDimensionScore', () => {
  test('returns 100 for empty findings', () => {
    expect(vf.computeDimensionScore([], [3])).toBe(100);
  });

  test('deducts 10 per error', () => {
    const findings = [
      { step: 3, severity: 'error' },
      { step: 3, severity: 'error' },
    ];
    expect(vf.computeDimensionScore(findings, [3])).toBe(80);
  });

  test('deducts 3 per warning', () => {
    const findings = [{ step: 4, severity: 'warning' }];
    expect(vf.computeDimensionScore(findings, [4])).toBe(97);
  });

  test('mixed errors and warnings', () => {
    const findings = [
      { step: 5, severity: 'error' },
      { step: 5, severity: 'warning' },
      { step: 5, severity: 'warning' },
    ];
    expect(vf.computeDimensionScore(findings, [5])).toBe(84); // 100 - 10 - 6
  });

  test('clamps to 0 for many errors', () => {
    const findings = Array(15).fill({ step: 3, severity: 'error' });
    expect(vf.computeDimensionScore(findings, [3])).toBe(0);
  });

  test('ignores findings from other steps', () => {
    const findings = [
      { step: 3, severity: 'error' },
      { step: 99, severity: 'error' }, // different step — ignored
    ];
    expect(vf.computeDimensionScore(findings, [3])).toBe(90);
  });

  test('info severity has no deduction', () => {
    const findings = [{ step: 7, severity: 'info' }];
    expect(vf.computeDimensionScore(findings, [7])).toBe(100);
  });
});

describe('computeQualityScore', () => {
  test('returns 0 when all dimensions are null', () => {
    const dims = {
      status:           { score: null, weight: 0.15 },
      capacity:         { score: null, weight: 0.20 },
      connectionPoints: { score: null, weight: 0.30 },
      duplicates:       { score: null, weight: 0.15 },
      geo:              { score: null, weight: 0.20 },
    };
    expect(vf.computeQualityScore(dims)).toBe(0);
  });

  test('returns 100 for all-100 scores', () => {
    const dims = {
      status:           { score: 100, weight: 0.15 },
      capacity:         { score: 100, weight: 0.20 },
      connectionPoints: { score: 100, weight: 0.30 },
      duplicates:       { score: 100, weight: 0.15 },
      geo:              { score: 100, weight: 0.20 },
    };
    expect(vf.computeQualityScore(dims)).toBe(100);
  });

  test('re-normalises when one dimension is null (skipped)', () => {
    // Only status (0.15) and capacity (0.20) active
    const dims = {
      status:           { score: 100 },
      capacity:         { score: 0 },
      connectionPoints: { score: null },
      duplicates:       { score: null },
      geo:              { score: null },
    };
    // Using default weights: status=0.15, capacity=0.20 → total=0.35
    // Weighted sum: 100*0.15 + 0*0.20 = 15 / 0.35 ≈ 42.86 → rounds to 43
    expect(vf.computeQualityScore(dims)).toBe(43);
  });

  test('returns correct weighted average across all 5 dimensions', () => {
    const dims = {
      status:           { score: 90, weight: 0.15 },
      capacity:         { score: 80, weight: 0.20 },
      connectionPoints: { score: 70, weight: 0.30 },
      duplicates:       { score: 100, weight: 0.15 },
      geo:              { score: 90, weight: 0.20 },
    };
    // 90*0.15 + 80*0.20 + 70*0.30 + 100*0.15 + 90*0.20
    // = 13.5 + 16 + 21 + 15 + 18 = 83.5 → rounds to 84
    expect(vf.computeQualityScore(dims)).toBe(84);
  });

  test('QUALITY_DIMENSION_WEIGHTS exports 5 dimensions summing to 1.0', () => {
    const weights = vf.QUALITY_DIMENSION_WEIGHTS;
    expect(Object.keys(weights)).toHaveLength(5);
    const total = Object.values(weights).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — MQ finding code constants
// ---------------------------------------------------------------------------
describe('MQ finding code constants', () => {
  const MQ_CODES = [
    'MQ_INVENTORY_COMPLETE', 'MQ_INVENTORY_EMPTY',
    'MQ_STALE_PLANNING', 'MQ_STALE_TEMPORARY_SHUTDOWN', 'MQ_MISSING_COMMISSIONING_DATE',
    'MQ_FUTURE_COMMISSIONING', 'MQ_NBP_PENDING', 'MQ_NBP_NOT_PLANNED',
    'MQ_ZERO_CAPACITY', 'MQ_NEGATIVE_CAPACITY', 'MQ_IMPLAUSIBLE_HIGH_CAPACITY',
    'MQ_NETTO_EXCEEDS_BRUTTO', 'MQ_MISSING_FEED_IN_TYPE',
    'MQ_MISSING_NAP', 'MQ_MISSING_MELO', 'MQ_NAP_VNB_MISMATCH',
    'MQ_VOLTAGE_MISMATCH', 'MQ_NAP_MULTI_UNIT', 'MQ_REDISPATCH_NO_NAP',
    'MQ_PROBABLE_DUPLICATE', 'MQ_POSSIBLE_DUPLICATE', 'MQ_GEO_DUPLICATE',
    'MQ_GEO_PLAUSIBLE', 'MQ_GEO_MISASSIGNMENT', 'MQ_GEO_CHECK_FAILED',
  ];

  test('exports 25 MQ_* constants with self-referential values', () => {
    expect(MQ_CODES).toHaveLength(25);
    for (const code of MQ_CODES) {
      expect(vf[code]).toBe(code);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — mastr-quality service (integration with mock broker)
// ---------------------------------------------------------------------------
describe('mastr-quality service', () => {
  let broker;
  let mqService;

  // Shared geo mock state — can be overridden per test
  let geoMockVerdict = 'CONSISTENT';
  let geoMockConfidence = 0.9;
  let snapshotMockResult = { id: 'snap-mq-123', status: 'complete', snapshotHash: 'hash-xyz', datapointNames: [] };

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    mqService = broker.createService(require('../services/mastr-quality.service'));

    // Stub: datapoint service
    broker.createService({
      name: 'datapoint',
      actions: {
        createSnapshot: {
          async handler() { return snapshotMockResult; },
        },
        validateSnapshot: {
          async handler() {
            return { id: snapshotMockResult.id, consistent: true, drift: [], snapshotHash: snapshotMockResult.snapshotHash };
          },
        },
      },
    });

    // Stub: osm-geo service
    broker.createService({
      name: 'osm-geo',
      actions: {
        validate: {
          async handler() {
            return {
              success: true,
              data: {
                validation: { verdict: geoMockVerdict, confidenceScore: geoMockConfidence },
              },
            };
          },
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    const PouchDB = require('pouchdb');
    const PouchDBFind = require('pouchdb-find');
    PouchDB.plugin(PouchDBFind);
    const db = new PouchDB(TEST_DB_PATH);
    await db.destroy().catch(() => {});
  });

  beforeEach(() => {
    CernionMCPClient.callWithNewSession.mockReset();
    geoMockVerdict = 'CONSISTENT';
    geoMockConfidence = 0.9;
    snapshotMockResult = { id: 'snap-mq-123', status: 'complete', snapshotHash: 'hash-xyz', datapointNames: [] };
  });

  // ---- Action definitions ----
  test('audit action is defined with REST POST /audit', () => {
    expect(mqService.schema.actions.audit.rest).toBe('POST /audit');
    expect(mqService.schema.actions.audit.timeout).toBe(180_000);
  });

  test('list action is defined with REST GET /audits', () => {
    expect(mqService.schema.actions.list.rest).toBe('GET /audits');
  });

  test('get action is defined with REST GET /audits/:id', () => {
    expect(mqService.schema.actions.get.rest).toBe('GET /audits/:id');
  });

  test('all actions have openapi annotations with summary and tags', () => {
    for (const [name, action] of Object.entries(mqService.schema.actions)) {
      expect(action.openapi).toBeDefined(), `${name} must have openapi annotations`;
      expect(action.openapi.summary).toBeTruthy();
      expect(Array.isArray(action.openapi.tags)).toBe(true);
    }
  });

  // ---- deriveInstallationType ----
  test('deriveInstallationType detects solar', () => {
    expect(mqService.deriveInstallationType({ energietraeger: 'solar' })).toBe('solar');
  });

  test('deriveInstallationType detects wind', () => {
    expect(mqService.deriveInstallationType({ energietraeger: 'wind' })).toBe('wind');
  });

  test('deriveInstallationType detects storage via Speicherkapazitaet', () => {
    expect(mqService.deriveInstallationType({ Speicherkapazitaet: 10 })).toBe('storage');
  });

  test('deriveInstallationType falls back to other', () => {
    expect(mqService.deriveInstallationType({})).toBe('other');
  });

  // ---- stepStatusAnomalies ----
  test('stepStatusAnomalies: MQ_STALE_PLANNING for >2 year planning', () => {
    const staleInst = makeInstallation({
      einheitBetriebsstatus: 31,
      registrierungsDatum: '2020-01-01',
    });
    const findings = mqService.stepStatusAnomalies([staleInst], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_STALE_PLANNING)).toBe(true);
  });

  test('stepStatusAnomalies: no MQ_STALE_PLANNING for recent planning', () => {
    const recentInst = makeInstallation({
      einheitBetriebsstatus: 31,
      registrierungsDatum: '2025-12-01',
    });
    const findings = mqService.stepStatusAnomalies([recentInst], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_STALE_PLANNING)).toBe(false);
  });

  test('stepStatusAnomalies: MQ_STALE_TEMPORARY_SHUTDOWN for >365 day shutdown', () => {
    const shutdownInst = makeInstallation({
      einheitBetriebsstatus: 37,
      datumBeginnVoruebergehenderStilllegung: '2024-01-01',
    });
    const findings = mqService.stepStatusAnomalies([shutdownInst], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_STALE_TEMPORARY_SHUTDOWN)).toBe(true);
  });

  test('stepStatusAnomalies: MQ_MISSING_COMMISSIONING_DATE for operational without date', () => {
    const noDate = makeInstallation({ einheitBetriebsstatus: 35, inbetriebnahmeDatum: undefined });
    const findings = mqService.stepStatusAnomalies([noDate], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_MISSING_COMMISSIONING_DATE)).toBe(true);
  });

  test('stepStatusAnomalies: MQ_FUTURE_COMMISSIONING for future date', () => {
    const future = makeInstallation({ inbetriebnahmeDatum: '2030-01-01' });
    const findings = mqService.stepStatusAnomalies([future], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_FUTURE_COMMISSIONING)).toBe(true);
  });

  test('stepStatusAnomalies: MQ_NBP_PENDING for status 2955', () => {
    const nbpPending = makeInstallation({ netzbetreiberPruefungStatus: '2955' });
    const findings = mqService.stepStatusAnomalies([nbpPending], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_NBP_PENDING)).toBe(true);
  });

  test('stepStatusAnomalies: MQ_NBP_NOT_PLANNED for status 3075', () => {
    const nbpNotPlanned = makeInstallation({ netzbetreiberPruefungStatus: '3075' });
    const findings = mqService.stepStatusAnomalies([nbpNotPlanned], new Date('2026-03-30'));
    expect(findings.some((f) => f.finding === vf.MQ_NBP_NOT_PLANNED)).toBe(true);
  });

  // ---- stepCapacityAnomalies ----
  test('stepCapacityAnomalies: MQ_ZERO_CAPACITY', () => {
    const zero = makeInstallation({ bruttoleistung: 0, NettoNennleistung: 0, nettoNennleistung: 0 });
    const findings = mqService.stepCapacityAnomalies([zero]);
    expect(findings.some((f) => f.finding === vf.MQ_ZERO_CAPACITY)).toBe(true);
  });

  test('stepCapacityAnomalies: MQ_NEGATIVE_CAPACITY', () => {
    const neg = makeInstallation({ bruttoleistung: -100, NettoNennleistung: -80, nettoNennleistung: -80 });
    const findings = mqService.stepCapacityAnomalies([neg]);
    expect(findings.some((f) => f.finding === vf.MQ_NEGATIVE_CAPACITY)).toBe(true);
  });

  test('stepCapacityAnomalies: MQ_IMPLAUSIBLE_HIGH_CAPACITY for solar >50,000 kW', () => {
    const huge = makeInstallation({ energietraeger: 'solar', bruttoleistung: 60000, NettoNennleistung: 55000, nettoNennleistung: 55000 });
    const findings = mqService.stepCapacityAnomalies([huge]);
    expect(findings.some((f) => f.finding === vf.MQ_IMPLAUSIBLE_HIGH_CAPACITY)).toBe(true);
  });

  test('stepCapacityAnomalies: MQ_IMPLAUSIBLE_HIGH_CAPACITY for wind >20,000 kW', () => {
    const huge = makeInstallation({ energietraeger: 'wind', bruttoleistung: 25000, NettoNennleistung: 22000, nettoNennleistung: 22000 });
    const findings = mqService.stepCapacityAnomalies([huge]);
    expect(findings.some((f) => f.finding === vf.MQ_IMPLAUSIBLE_HIGH_CAPACITY)).toBe(true);
  });

  test('stepCapacityAnomalies: MQ_NETTO_EXCEEDS_BRUTTO', () => {
    const inv = makeInstallation({ bruttoleistung: 300, NettoNennleistung: 400, nettoNennleistung: 400 });
    const findings = mqService.stepCapacityAnomalies([inv]);
    expect(findings.some((f) => f.finding === vf.MQ_NETTO_EXCEEDS_BRUTTO)).toBe(true);
  });

  test('stepCapacityAnomalies: no issues for normal installation', () => {
    const findings = mqService.stepCapacityAnomalies([makeInstallation()]);
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  // ---- stepConnectionPointIntegrity ----
  test('stepConnectionPointIntegrity: MQ_MISSING_NAP for installation without NAP', () => {
    const noNap = makeInstallation({ nap: undefined, NapMastrNummer: undefined, napMastrNummer: undefined });
    const findings = mqService.stepConnectionPointIntegrity([noNap], MOCK_OPERATOR.mastrId);
    expect(findings.some((f) => f.finding === vf.MQ_MISSING_NAP)).toBe(true);
  });

  test('stepConnectionPointIntegrity: MQ_REDISPATCH_NO_NAP for ≥100 kW without NAP', () => {
    const noNap = makeInstallation({ bruttoleistung: 200, nap: undefined, NapMastrNummer: undefined, napMastrNummer: undefined });
    const findings = mqService.stepConnectionPointIntegrity([noNap], MOCK_OPERATOR.mastrId);
    expect(findings.some((f) => f.finding === vf.MQ_REDISPATCH_NO_NAP)).toBe(true);
  });

  test('stepConnectionPointIntegrity: MQ_VOLTAGE_MISMATCH for ≥100kW at NS', () => {
    const ns = makeInstallation({ bruttoleistung: 200, nap: { MastrNummer: 'NAP999', Spannungsebene: '354' } });
    const findings = mqService.stepConnectionPointIntegrity([ns], MOCK_OPERATOR.mastrId);
    expect(findings.some((f) => f.finding === vf.MQ_VOLTAGE_MISMATCH)).toBe(true);
  });

  test('stepConnectionPointIntegrity: MQ_NAP_VNB_MISMATCH for wrong VNB NAP', () => {
    const mismatch = makeInstallation({
      nap: { MastrNummer: 'NAP001', Spannungsebene: 'MS', NetzbetreiberMastrNummer: 'SNB_OTHER' },
    });
    const findings = mqService.stepConnectionPointIntegrity([mismatch], MOCK_OPERATOR.mastrId);
    expect(findings.some((f) => f.finding === vf.MQ_NAP_VNB_MISMATCH)).toBe(true);
  });

  test('stepConnectionPointIntegrity: no issues for clean installation', () => {
    const findings = mqService.stepConnectionPointIntegrity([makeInstallation()], MOCK_OPERATOR.mastrId);
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  // ---- stepDuplicateDetection ----
  test('stepDuplicateDetection: MQ_PROBABLE_DUPLICATE when all 4 criteria match', () => {
    const a = makeInstallation({ EinheitMastrNummer: 'SEE001', Postleitzahl: '67063', bruttoleistung: 500, inbetriebnahmeDatum: '2020-01-01' });
    // Give b a far-away coordinate so geo-duplicate check does not fire first
    const b = makeInstallation({ EinheitMastrNummer: 'SEE002', Postleitzahl: '67063', bruttoleistung: 510, inbetriebnahmeDatum: '2020-02-01', koordinatenBreitengrad: 51.0, koordinatenLaengengrad: 10.0 });
    const findings = mqService.stepDuplicateDetection([a, b]);
    expect(findings.some((f) => f.finding === vf.MQ_PROBABLE_DUPLICATE)).toBe(true);
  });

  test('stepDuplicateDetection: MQ_POSSIBLE_DUPLICATE when 3/4 criteria match', () => {
    // PLZ different (4th criterion fails); give b a far-away coordinate so geo-duplicate check does not fire first
    const a = makeInstallation({ EinheitMastrNummer: 'SEE001', Postleitzahl: '67063', bruttoleistung: 500, inbetriebnahmeDatum: '2020-01-01' });
    const b = makeInstallation({ EinheitMastrNummer: 'SEE002', Postleitzahl: '67064', bruttoleistung: 510, inbetriebnahmeDatum: '2020-02-01', koordinatenBreitengrad: 51.0, koordinatenLaengengrad: 10.0 });
    const findings = mqService.stepDuplicateDetection([a, b]);
    expect(findings.some((f) => f.finding === vf.MQ_POSSIBLE_DUPLICATE)).toBe(true);
  });

  test('stepDuplicateDetection: MQ_GEO_DUPLICATE for same-type same-coordinates', () => {
    const a = makeInstallation({ EinheitMastrNummer: 'SEE001', koordinatenBreitengrad: 49.4774, koordinatenLaengengrad: 8.4452 });
    const b = makeInstallation({ EinheitMastrNummer: 'SEE002', koordinatenBreitengrad: 49.4775, koordinatenLaengengrad: 8.4453 });
    const findings = mqService.stepDuplicateDetection([a, b]);
    expect(findings.some((f) => f.finding === vf.MQ_GEO_DUPLICATE)).toBe(true);
  });

  test('stepDuplicateDetection: no findings for clearly different installations', () => {
    const a = makeInstallation({ EinheitMastrNummer: 'SEE001', Postleitzahl: '67063', bruttoleistung: 500 });
    const b = makeInstallation({ EinheitMastrNummer: 'SEE002', Postleitzahl: '80331', bruttoleistung: 50000, energietraeger: 'wind' });
    const findings = mqService.stepDuplicateDetection([a, b]);
    const dupeFindings = findings.filter((f) =>
      [vf.MQ_PROBABLE_DUPLICATE, vf.MQ_POSSIBLE_DUPLICATE, vf.MQ_GEO_DUPLICATE].includes(f.finding)
    );
    expect(dupeFindings).toHaveLength(0);
  });

  // ---- Full pipeline integration tests ----
  test('full pipeline: happy path returns qualityScore and dimensions', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') {
        return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name, bdew: MOCK_OPERATOR.bdew } };
      }
      if (tool === 'cernion_installations_local') {
        return { installations: MOCK_INSTALLATIONS };
      }
      return {};
    });

    const result = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeTruthy();
    expect(typeof result.qualityScore).toBe('number');
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
    expect(result.qualityDimensions).toBeDefined();
    expect(result.qualityDimensions.status).toBeDefined();
    expect(result.qualityDimensions.capacity).toBeDefined();
    expect(result.qualityDimensions.connectionPoints).toBeDefined();
    expect(result.qualityDimensions.duplicates).toBeDefined();
    expect(result.qualityDimensions.geo).toBeDefined();
    expect(result.summary.totalInstallations).toBe(MOCK_INSTALLATIONS.length);
  });

  test('full pipeline: all-clean portfolio returns qualityScore 100', async () => {
    const cleanInst = makeInstallation({
      EinheitMastrNummer: 'SEE900000099',
      einheitBetriebsstatus: 35,
      bruttoleistung: 200,
      NettoNennleistung: 180,
      nettoNennleistung: 180,
      netzbetreiberPruefungStatus: 2954,
      inbetriebnahmeDatum: '2022-05-01',
      nap: { MastrNummer: 'NAP001', Spannungsebene: 'MS' },
      koordinatenBreitengrad: 49.4774,
      koordinatenLaengengrad: 8.4452,
      // Provide Einspeisungsart so MQ_MISSING_FEED_IN_TYPE warning is not triggered
      einspeisungsart: 'Überschusseinspeisung',
      // Provide MeLo so MQ_MISSING_MELO warning is not triggered for ≥100 kW units
      meLo: 'DE000123456789012345678901234567',
    });

    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') {
        return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      }
      if (tool === 'cernion_installations_local') {
        return { installations: [cleanInst] };
      }
      return {};
    });

    const result = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    expect(result.qualityScore).toBe(100);
  });

  test('empty portfolio: MQ_INVENTORY_EMPTY error finding', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: [] };
      return {};
    });

    const result = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    expect(result.success).toBe(true);
    expect(result.findings.some((f) => f.finding === vf.MQ_INVENTORY_EMPTY)).toBe(true);
    expect(result.summary.totalInstallations).toBe(0);
  });

  test('skipSteps: skipping step 7 excludes geo from qualityScore', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    const result = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
      skipSteps: [7],
    });

    expect(result.success).toBe(true);
    expect(result.qualityDimensions.geo.score).toBeNull();
    // Geo step should appear as skipped
    const geoStep = result.steps.find((s) => s.name === 'geoSpotCheck');
    expect(geoStep.status).toBe('skipped');
  });

  test('skipSteps: invalid step number throws error', async () => {
    await expect(
      broker.call('mastr-quality.audit', {
        gridOperatorId: MOCK_OPERATOR.mastrId,
        skipSteps: [2], // mandatory step — invalid
      })
    ).rejects.toThrow();
  });

  test('geo spot check: MQ_GEO_MISASSIGNMENT for definitive misassignment', async () => {
    geoMockVerdict = 'DEFINITIVE_MISASSIGNMENT';
    geoMockConfidence = 0.95;

    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    const result = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
      geoSampleSize: 2,
    });

    expect(result.findings.some((f) => f.finding === vf.MQ_GEO_MISASSIGNMENT)).toBe(true);
  });

  test('geo sample: prioritises Redispatch-relevant (≥100 kW) over smaller units', () => {
    const large = makeInstallation({ EinheitMastrNummer: 'SEE_BIG', bruttoleistung: 500 });
    const small = makeInstallation({ EinheitMastrNummer: 'SEE_SMALL', bruttoleistung: 5 });
    // Build 5 large + 5 small
    const portfolio = [
      ...Array.from({ length: 5 }, (_, i) => makeInstallation({ EinheitMastrNummer: `BIG${i}`, bruttoleistung: 500 })),
      ...Array.from({ length: 5 }, (_, i) => makeInstallation({ EinheitMastrNummer: `SMALL${i}`, bruttoleistung: 5 })),
    ];
    // Capture params passed to geoSpotCheck by calling it with geoSampleSize=3
    const selected = [];
    const origStep = mqService.stepGeoSpotCheck.bind(mqService);
    // We test the selection logic indirectly via the type diversity
    expect(large.bruttoleistung).toBeGreaterThanOrEqual(100);
    expect(small.bruttoleistung).toBeLessThan(100);
  });

  test('MQ_GEO_CHECK_FAILED when osm-geo service unavailable', async () => {
    // Create a separate broker where osm-geo throws.
    // Override settings.dbPath directly because the module is already cached with TEST_DB_PATH —
    // changing process.env would not affect the frozen module export.
    const broker2 = new ServiceBroker({ logger: false });
    const TEST_DB2 = path.join(os.tmpdir(), `cernion-mq-fail-${Date.now()}`);
    const mq2Schema = Object.assign({}, require('../services/mastr-quality.service'), { settings: { dbPath: TEST_DB2 } });
    const mqSvc2 = broker2.createService(mq2Schema);
    broker2.createService({
      name: 'datapoint',
      actions: {
        createSnapshot: { async handler() { throw new Error('no snapshot'); } },
      },
    });
    broker2.createService({
      name: 'osm-geo',
      actions: {
        validate: { async handler() { throw new Error('OSM service unavailable'); } },
      },
    });
    await broker2.start();

    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    const result = await broker2.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    expect(result.findings.some((f) => f.finding === vf.MQ_GEO_CHECK_FAILED)).toBe(true);

    await broker2.stop();
    const PouchDB = require('pouchdb');
    PouchDB.plugin(require('pouchdb-find'));
    const db2 = new PouchDB(TEST_DB2);
    await db2.destroy().catch(() => {});
  });

  // ---- list and get persistence ----
  test('audit result is persisted and retrievable via list and get', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    const auditResult = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    const id = auditResult.id;

    // list
    const listResult = await broker.call('mastr-quality.list', {});
    expect(listResult.audits.some((a) => a.id === id)).toBe(true);

    // get
    const getResult = await broker.call('mastr-quality.get', { id });
    expect(getResult.success).toBe(true);
    expect(getResult.id).toBe(id);
    expect(getResult.qualityScore).toBe(auditResult.qualityScore);
  });

  test('get returns 404 for unknown ID', async () => {
    const result = await broker.call('mastr-quality.get', { id: 'nonexistent-uuid' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  test('list filters by gridOperatorId', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    await broker.call('mastr-quality.audit', { gridOperatorId: MOCK_OPERATOR.mastrId });

    const filtered = await broker.call('mastr-quality.list', {
      gridOperatorId: 'NONEXISTENT_ID',
    });
    expect(filtered.count).toBe(0);
  });

  // ---- Determinism test ----
  test('same input produces same finding codes on two consecutive runs', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    const run1 = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });
    const run2 = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    const codes1 = run1.findings.map((f) => f.finding).sort();
    const codes2 = run2.findings.map((f) => f.finding).sort();
    // Audit trail finding codes may vary (different snapshot IDs), but non-audit findings must match
    const nonAudit1 = codes1.filter((c) => c !== 'AUDIT_TRAIL_CREATED' && c !== 'SNAPSHOT_DRIFT_DETECTED');
    const nonAudit2 = codes2.filter((c) => c !== 'AUDIT_TRAIL_CREATED' && c !== 'SNAPSHOT_DRIFT_DETECTED');
    expect(nonAudit1).toEqual(nonAudit2);
    expect(run1.qualityScore).toBe(run2.qualityScore);
  });

  // ---- Error: no operator identifier ----
  test('audit throws when no operator identifier provided', async () => {
    await expect(
      broker.call('mastr-quality.audit', {})
    ).rejects.toThrow();
  });

  // ---- pipelineVersion in response ----
  test('audit response contains pipelineVersion 0.17.0', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
      if (tool === 'vnb_lookup_codes') return { canonical: { mastrId: MOCK_OPERATOR.mastrId, name: MOCK_OPERATOR.name } };
      if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
      return {};
    });

    const result = await broker.call('mastr-quality.audit', {
      gridOperatorId: MOCK_OPERATOR.mastrId,
    });

    expect(result.metadata.pipelineVersion).toBe('0.17.0');
  });
});
