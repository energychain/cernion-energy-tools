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
const { round2, assessSettlementReadiness, assessRisk } = require('../src/redispatch-risk');

// Unique PouchDB path so parallel Jest workers don't clash
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-rd-test-${Date.now()}`);
process.env.REDISPATCH_EXPOST_DB_PATH = TEST_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_OPERATOR = {
  mastrId: 'SNB935578300972',
  name: 'STROMDAO Netze GmbH',
  bdew: '9907473000008',
  bnr: '10002977',
};

/**
 * Creates a minimal installation that passes all master data checks.
 */
const makeInstallation = (overrides = {}) => ({
  EinheitMastrNummer: 'SEE900000001',
  einheitBetriebsstatus: 35,
  EinheitBetriebsstatus: 35,
  bruttoleistung: 500,
  Bruttoleistung: 500,
  nettoNennleistung: 480,
  NettoNennleistung: 480,
  energietraeger: 'solar',
  Energietraeger: 'solar',
  netzanschlusspunktMastrNummer: 'NAP901234567890',
  marktlokationId: 'DE00123456789012345678901234567',
  FernsteuerbarkeitDv: '1',
  ...overrides,
});

const MOCK_INSTALLATIONS = [
  makeInstallation({ EinheitMastrNummer: 'SEE900000001' }),
  makeInstallation({
    EinheitMastrNummer: 'SEE900000002',
    energietraeger: 'wind',
    Energietraeger: 'wind',
    bruttoleistung: 2000,
    Bruttoleistung: 2000,
    nettoNennleistung: 1800,
    NettoNennleistung: 1800,
    netzanschlusspunktMastrNummer: 'NAP901234567891',
    marktlokationId: 'DE00123456789012345678901234568',
  }),
];

const MOCK_MEASURES = [{ volumeMWh: 1500 }, { volumeMWh: 2000 }, { volumeMWh: 800 }];

// ---------------------------------------------------------------------------
// Suite 1 — RD_* finding code constants
// ---------------------------------------------------------------------------
describe('RD_* finding code constants', () => {
  const RD_CODES = [
    // Step 2
    'RD_PORTFOLIO_COMPLETE',
    'RD_PORTFOLIO_EMPTY',
    'RD_PORTFOLIO_INCLUDES_INACTIVE',
    // Step 3
    'RD_MISSING_NAP',
    'RD_MISSING_MELO',
    'RD_MISSING_BTR',
    'RD_NAP_VNB_MISMATCH',
    'RD_DV_NOT_CONTROLLABLE',
    'RD_CAPACITY_ANOMALY',
    // Step 4
    'RD_CURTAILMENT_VOLUME',
    'RD_HIGH_CURTAILMENT_PERIOD',
    'RD_CURTAILMENT_DATA_UNAVAILABLE',
    'RD_CURTAILMENT_ZERO',
    // Step 5
    'RD_SETTLEMENT_READY',
    'RD_SETTLEMENT_PARTIAL',
    'RD_SETTLEMENT_CRITICAL',
    // Step 6
    'RD_RISK_LOW',
    'RD_RISK_MEDIUM',
    'RD_RISK_HIGH',
  ];

  test('exports 19 RD_* constants with self-referential values', () => {
    expect(RD_CODES).toHaveLength(19);
    for (const code of RD_CODES) {
      expect(vf[code]).toBe(code);
    }
  });

  test('RD_* constants are distinct strings', () => {
    const unique = new Set(RD_CODES.map((c) => vf[c]));
    expect(unique.size).toBe(RD_CODES.length);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — src/redispatch-risk.js pure unit tests
// ---------------------------------------------------------------------------
describe('round2', () => {
  test('rounds to 2 decimal places', () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(100)).toBe(100);
    expect(round2(0.001)).toBe(0);
  });
});

describe('assessSettlementReadiness', () => {
  test('returns zeros for empty portfolio', () => {
    const r = assessSettlementReadiness([], []);
    expect(r.totalInstallations).toBe(0);
    expect(r.readyForSettlement).toBe(0);
    expect(r.readinessPercent).toBe(0);
    expect(r.blockedInstallations).toBe(0);
    expect(r.blockedMastrNumbers).toEqual([]);
  });

  test('100% readiness when no error findings', () => {
    const findings = [
      { severity: 'info', context: { mastrNummer: 'SEE01' } },
      { severity: 'warning', context: { mastrNummer: 'SEE01' } },
    ];
    const r = assessSettlementReadiness(
      [makeInstallation({ EinheitMastrNummer: 'SEE01' })],
      findings
    );
    expect(r.readinessPercent).toBe(100);
    expect(r.blockedInstallations).toBe(0);
  });

  test('blocks installation on error finding with matching mastrNummer', () => {
    const findings = [{ severity: 'error', context: { mastrNummer: 'SEE01' } }];
    const r = assessSettlementReadiness(
      [makeInstallation({ EinheitMastrNummer: 'SEE01' })],
      findings
    );
    expect(r.blockedInstallations).toBe(1);
    expect(r.readyForSettlement).toBe(0);
    expect(r.readinessPercent).toBe(0);
    expect(r.blockedMastrNumbers).toContain('SEE01');
  });

  test('partial readiness — 1 of 2 blocked', () => {
    const findings = [{ severity: 'error', context: { mastrNummer: 'SEE01' } }];
    const r = assessSettlementReadiness(
      [
        makeInstallation({ EinheitMastrNummer: 'SEE01' }),
        makeInstallation({ EinheitMastrNummer: 'SEE02' }),
      ],
      findings
    );
    expect(r.totalInstallations).toBe(2);
    expect(r.readyForSettlement).toBe(1);
    expect(r.readinessPercent).toBe(50);
    expect(r.blockedInstallations).toBe(1);
  });

  test('deduplicates blocked installations by mastrNummer', () => {
    // Two findings for the same unit should count as 1 blocked installation
    const findings = [
      { severity: 'error', context: { mastrNummer: 'SEE01' } },
      { severity: 'error', context: { mastrNummer: 'SEE01' } },
    ];
    const r = assessSettlementReadiness(
      [
        makeInstallation({ EinheitMastrNummer: 'SEE01' }),
        makeInstallation({ EinheitMastrNummer: 'SEE02' }),
      ],
      findings
    );
    expect(r.blockedInstallations).toBe(1);
    expect(r.blockedMastrNumbers).toHaveLength(1);
  });

  test('ignores error findings without mastrNummer in context', () => {
    const findings = [
      { severity: 'error', context: {} },
      { severity: 'error' }, // no context at all
    ];
    const r = assessSettlementReadiness(
      [makeInstallation({ EinheitMastrNummer: 'SEE01' })],
      findings
    );
    expect(r.blockedInstallations).toBe(0);
    expect(r.readinessPercent).toBe(100);
  });
});

describe('assessRisk', () => {
  const fullReadiness = { readinessPercent: 100, totalInstallations: 2, blockedInstallations: 0 };
  const halfReadiness = { readinessPercent: 50, totalInstallations: 2, blockedInstallations: 1 };
  const noReadiness = { readinessPercent: 0, totalInstallations: 1, blockedInstallations: 1 };

  test('low risk when readiness is 100%', () => {
    const r = assessRisk(fullReadiness, 5, 50);
    expect(r.riskLevel).toBe('low');
    expect(r.estimatedLostCompensationEur).toBe(0);
    expect(r.blockedFractionPercent).toBe(0);
  });

  test('low risk when curtailment is 0', () => {
    const r = assessRisk(halfReadiness, 0, 50);
    expect(r.riskLevel).toBe('low');
    expect(r.estimatedLostCompensationEur).toBe(0);
  });

  test('medium risk — boundary at exactly 10,001 EUR', () => {
    // blocked 50%, rate = €50/MWh → need 10001/(1000*0.5*50) = 0.40004 GWh
    const r = assessRisk(halfReadiness, 0.41, 50); // ~10250 EUR
    expect(r.riskLevel).toBe('medium');
    expect(r.estimatedLostCompensationEur).toBeGreaterThan(10_000);
    expect(r.estimatedLostCompensationEur).toBeLessThanOrEqual(100_000);
  });

  test('high risk — above 100,000 EUR', () => {
    // blocked 100%, 50 €/MWh, 3 GWh → 3000 MWh * 100% * €50 = €150,000
    const r = assessRisk(noReadiness, 3, 50);
    expect(r.riskLevel).toBe('high');
    expect(r.estimatedLostCompensationEur).toBe(150_000);
  });

  test('respects custom avgCompensationEurPerMWh', () => {
    // blocked 100%, 1 GWh, rate = €200/MWh → €200,000
    const r = assessRisk(noReadiness, 1, 200);
    expect(r.riskLevel).toBe('high');
    expect(r.estimatedLostCompensationEur).toBe(200_000);
    expect(r.avgCompensationEurPerMWh).toBe(200);
  });

  test('defaults avgCompensationEurPerMWh to 50', () => {
    const r = assessRisk(noReadiness, 1);
    expect(r.avgCompensationEurPerMWh).toBe(50);
  });

  test('returns curtailmentGWh in result', () => {
    const r = assessRisk(fullReadiness, 4.8, 50);
    expect(r.curtailmentGWh).toBe(4.8);
  });

  test('round-trips blockedFractionPercent', () => {
    const r = assessRisk(halfReadiness, 1, 50);
    expect(r.blockedFractionPercent).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — redispatch-expost service (integration via mock broker)
// ---------------------------------------------------------------------------
describe('redispatch-expost service', () => {
  let broker;
  let rdService;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    rdService = broker.createService(require('../services/redispatch-expost.service'));

    // Stub: datapoint service
    broker.createService({
      name: 'datapoint',
      actions: {
        createSnapshot: {
          async handler() {
            return { id: 'snap-rd-123', status: 'complete', snapshotHash: 'hash-rd-abc' };
          },
        },
        validateSnapshot: {
          async handler() {
            return { id: 'snap-rd-123', consistent: true, drift: [], snapshotHash: 'hash-rd-abc' };
          },
        },
        list: {
          async handler() {
            return { datapoints: [] };
          },
        },
        data: {
          async handler() {
            return { data: { rows: [] } };
          },
        },
      },
    });

    await broker.start();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default MCP mocks
    CernionMCPClient.callWithNewSession.mockImplementation(async (toolName, _params) => {
      if (toolName === 'vnb_lookup_codes') {
        return {
          canonical: {
            mastrId: MOCK_OPERATOR.mastrId,
            name: MOCK_OPERATOR.name,
            bdew: MOCK_OPERATOR.bdew,
            bnr: MOCK_OPERATOR.bnr,
          },
          candidates: [],
        };
      }
      if (toolName === 'cernion_installations_local') {
        return { installations: MOCK_INSTALLATIONS };
      }
      if (toolName === 'netztransparenz_redispatch') {
        return { measures: MOCK_MEASURES };
      }
      return {};
    });
  });

  afterAll(async () => {
    await broker.stop();
    // Clean up test PouchDB
    try {
      const PouchDB = require('pouchdb');
      PouchDB.plugin(require('pouchdb-find'));
      const db = new PouchDB(TEST_DB_PATH);
      await db.destroy();
    } catch (_) {}
  });

  // -------------------------------------------------------------------------
  // Step 1: VNB Identity
  // -------------------------------------------------------------------------
  describe('stepIdentity', () => {
    test('resolves operator via vnb_lookup_codes (BDEW)', async () => {
      const ctx = { meta: {} };
      const res = await rdService.stepIdentity(ctx, { gridOperatorBdew: '9907473000008' });
      expect(res.operator.mastrId).toBe(MOCK_OPERATOR.mastrId);
      expect(res.operator.name).toBe(MOCK_OPERATOR.name);
      expect(res.findings.some((f) => f.finding === vf.VNB_RESOLVED)).toBe(true);
    });

    test('emits VNB_AMBIGUOUS when multiple candidates returned', async () => {
      CernionMCPClient.callWithNewSession.mockResolvedValueOnce({
        canonical: {},
        candidates: [
          { name: 'Operator A', mastrId: 'SNB001' },
          { name: 'Operator B', mastrId: 'SNB002' },
        ],
      });
      const ctx = { meta: {} };
      const res = await rdService.stepIdentity(ctx, { gridOperatorBdew: '0000000000001' });
      expect(res.findings.some((f) => f.finding === vf.VNB_AMBIGUOUS)).toBe(true);
    });

    test('emits VNB_NOT_FOUND when no match', async () => {
      CernionMCPClient.callWithNewSession.mockResolvedValueOnce({ canonical: {}, candidates: [] });
      const ctx = { meta: {} };
      const res = await rdService.stepIdentity(ctx, { gridOperatorBdew: '0000000000000' });
      expect(res.findings.some((f) => f.finding === vf.VNB_NOT_FOUND)).toBe(true);
    });

    test('falls back gracefully when MCP throws', async () => {
      CernionMCPClient.callWithNewSession.mockRejectedValueOnce(new Error('MCP timeout'));
      const ctx = { meta: {} };
      const res = await rdService.stepIdentity(ctx, { gridOperatorBdew: '9907473000008' });
      expect(res.findings.some((f) => f.finding === vf.VNB_RESOLVED)).toBe(true);
      expect(res.operator.bdew).toBe('9907473000008');
    });

    test('name-only resolution emits VNB_RESOLVED without lookup call', async () => {
      const ctx = { meta: {} };
      const res = await rdService.stepIdentity(ctx, { gridOperatorName: 'Test Netz' });
      expect(res.findings.some((f) => f.finding === vf.VNB_RESOLVED)).toBe(true);
      expect(CernionMCPClient.callWithNewSession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Step 2: Portfolio
  // -------------------------------------------------------------------------
  describe('stepPortfolio', () => {
    test('Weg A: fetches portfolio via cernion_installations_local', async () => {
      const ctx = { meta: {}, call: jest.fn().mockResolvedValue({ datapoints: [] }) };
      const res = await rdService.stepPortfolio(ctx, MOCK_OPERATOR, {});
      expect(res.installations).toHaveLength(MOCK_INSTALLATIONS.length);
      expect(res.findings.some((f) => f.finding === vf.RD_PORTFOLIO_COMPLETE)).toBe(true);
    });

    test('emits RD_PORTFOLIO_EMPTY when no installations returned', async () => {
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'cernion_installations_local') return { installations: [] };
        return {};
      });
      const ctx = { meta: {}, call: jest.fn().mockResolvedValue({ datapoints: [] }) };
      const res = await rdService.stepPortfolio(ctx, MOCK_OPERATOR, {});
      expect(res.installations).toHaveLength(0);
      expect(res.findings.some((f) => f.finding === vf.RD_PORTFOLIO_EMPTY)).toBe(true);
    });

    test('emits RD_PORTFOLIO_INCLUDES_INACTIVE for non-InBetrieb installations', async () => {
      const inactive = makeInstallation({
        EinheitMastrNummer: 'SEE900000099',
        einheitBetriebsstatus: 37, // VoruebergehendStillgelegt
        EinheitBetriebsstatus: 37,
      });
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'cernion_installations_local')
          return { installations: [...MOCK_INSTALLATIONS, inactive] };
        return {};
      });
      const ctx = { meta: {}, call: jest.fn().mockResolvedValue({ datapoints: [] }) };
      const res = await rdService.stepPortfolio(ctx, MOCK_OPERATOR, {});
      expect(res.findings.some((f) => f.finding === vf.RD_PORTFOLIO_INCLUDES_INACTIVE)).toBe(true);
    });

    test('Weg B: uses datapoint fallback when available and fresh', async () => {
      const dpRows = MOCK_INSTALLATIONS;
      const mockCtx = {
        meta: {},
        call: jest.fn().mockImplementation(async (action) => {
          if (action === 'datapoint.list') {
            return {
              datapoints: [
                {
                  name: 'rd-portfolio',
                  tags: ['redispatch-portfolio'],
                  lastRun: { timestamp: new Date().toISOString() },
                },
              ],
            };
          }
          if (action === 'datapoint.data') {
            return { data: { rows: dpRows } };
          }
          return {};
        }),
      };
      const res = await rdService.stepPortfolio(mockCtx, MOCK_OPERATOR, {
        datapointTags: ['redispatch-portfolio'],
        maxAgeMinutes: 60,
      });
      expect(res.installations).toHaveLength(dpRows.length);
      // Weg B used — cernion_installations_local should NOT have been called
      expect(CernionMCPClient.callWithNewSession).not.toHaveBeenCalledWith(
        'cernion_installations_local',
        expect.anything(),
        expect.anything()
      );
    });
  });

  // -------------------------------------------------------------------------
  // Step 3: Master data validation
  // -------------------------------------------------------------------------
  describe('stepMasterDataValidation', () => {
    test('no findings for a fully valid installation', () => {
      const findings = rdService.stepMasterDataValidation([makeInstallation()], MOCK_OPERATOR);
      expect(findings).toHaveLength(0);
    });

    test('emits RD_MISSING_NAP when NAP is absent', () => {
      const inst = makeInstallation({ netzanschlusspunktMastrNummer: null });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_MISSING_NAP)).toBe(true);
      expect(findings.find((f) => f.finding === vf.RD_MISSING_NAP).severity).toBe('error');
    });

    test('emits RD_MISSING_MELO when MeLo is absent', () => {
      const inst = makeInstallation({ marktlokationId: null });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_MISSING_MELO)).toBe(true);
      expect(findings.find((f) => f.finding === vf.RD_MISSING_MELO).severity).toBe('error');
    });

    test('emits RD_MISSING_BTR as warning when no remote control flag', () => {
      const inst = makeInstallation({ FernsteuerbarkeitDv: '0', FernsteuerbarkeitSonstige: '0' });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_MISSING_BTR)).toBe(true);
      expect(findings.find((f) => f.finding === vf.RD_MISSING_BTR).severity).toBe('warning');
    });

    test('emits RD_NAP_VNB_MISMATCH when NAP belongs to different VNB', () => {
      const inst = makeInstallation({
        netzanschlusspunktMastrNummer: 'NAP999',
        netzanschlusspunktNetzebetreiber: 'SNB_OTHER_VNB',
      });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_NAP_VNB_MISMATCH)).toBe(true);
      expect(findings.find((f) => f.finding === vf.RD_NAP_VNB_MISMATCH).severity).toBe('error');
    });

    test('no NAP-VNB mismatch when VNB matches operator', () => {
      const inst = makeInstallation({
        netzanschlusspunktMastrNummer: 'NAP999',
        netzanschlusspunktNetzebetreiber: MOCK_OPERATOR.mastrId,
      });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_NAP_VNB_MISMATCH)).toBe(false);
    });

    test('emits RD_DV_NOT_CONTROLLABLE as warning when FernsteuerbarkeitDv not set', () => {
      const inst = makeInstallation({ FernsteuerbarkeitDv: '0' });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_DV_NOT_CONTROLLABLE)).toBe(true);
      expect(findings.find((f) => f.finding === vf.RD_DV_NOT_CONTROLLABLE).severity).toBe(
        'warning'
      );
    });

    test('emits RD_CAPACITY_ANOMALY when bruttoleistung is zero', () => {
      const inst = makeInstallation({ bruttoleistung: 0, Bruttoleistung: 0 });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      expect(findings.some((f) => f.finding === vf.RD_CAPACITY_ANOMALY)).toBe(true);
      expect(findings.find((f) => f.finding === vf.RD_CAPACITY_ANOMALY).severity).toBe('warning');
    });

    test('finding context contains mastrNummer', () => {
      const inst = makeInstallation({ EinheitMastrNummer: 'SEE_TEST_001', marktlokationId: null });
      const findings = rdService.stepMasterDataValidation([inst], MOCK_OPERATOR);
      const f = findings.find((x) => x.finding === vf.RD_MISSING_MELO);
      expect(f.context.mastrNummer).toBe('SEE_TEST_001');
    });
  });

  // -------------------------------------------------------------------------
  // Step 4: Curtailment correlation
  // -------------------------------------------------------------------------
  describe('stepCurtailmentCorrelation', () => {
    test('aggregates measures into curtailmentGWh', async () => {
      const ctx = { meta: {} };
      const res = await rdService.stepCurtailmentCorrelation(ctx, MOCK_OPERATOR, {
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
      });
      // 1500 + 2000 + 800 = 4300 MWh = 4.3 GWh
      expect(res.curtailmentGWh).toBe(4.3);
      expect(res.findings.some((f) => f.finding === vf.RD_CURTAILMENT_VOLUME)).toBe(true);
    });

    test('emits RD_CURTAILMENT_ZERO when no measures returned', async () => {
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'netztransparenz_redispatch') return { measures: [] };
        return {};
      });
      const ctx = { meta: {} };
      const res = await rdService.stepCurtailmentCorrelation(ctx, MOCK_OPERATOR, {});
      expect(res.curtailmentGWh).toBe(0);
      expect(res.findings.some((f) => f.finding === vf.RD_CURTAILMENT_ZERO)).toBe(true);
    });

    test('emits RD_CURTAILMENT_DATA_UNAVAILABLE on MCP error', async () => {
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'netztransparenz_redispatch') throw new Error('503 Service Unavailable');
        return {};
      });
      const ctx = { meta: {} };
      const res = await rdService.stepCurtailmentCorrelation(ctx, MOCK_OPERATOR, {});
      expect(res.curtailmentGWh).toBe(0);
      expect(res.findings.some((f) => f.finding === vf.RD_CURTAILMENT_DATA_UNAVAILABLE)).toBe(true);
      expect(
        res.findings.find((f) => f.finding === vf.RD_CURTAILMENT_DATA_UNAVAILABLE).severity
      ).toBe('warning');
    });

    test('emits RD_HIGH_CURTAILMENT_PERIOD when density >100/month', async () => {
      const manyMeasures = Array.from({ length: 250 }, (_, i) => ({ volumeMWh: 100 + i }));
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'netztransparenz_redispatch') return { measures: manyMeasures };
        return {};
      });
      const ctx = { meta: {} };
      const res = await rdService.stepCurtailmentCorrelation(ctx, MOCK_OPERATOR, {
        dateFrom: '2026-01-01',
        dateTo: '2026-02-28',
      });
      expect(res.findings.some((f) => f.finding === vf.RD_HIGH_CURTAILMENT_PERIOD)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Step 5: Settlement readiness
  // -------------------------------------------------------------------------
  describe('stepSettlementReadiness', () => {
    test('emits RD_SETTLEMENT_READY when all installations pass', () => {
      const res = rdService.stepSettlementReadiness(MOCK_INSTALLATIONS, []);
      expect(res.readiness.readinessPercent).toBe(100);
      expect(res.findings.some((f) => f.finding === vf.RD_SETTLEMENT_READY)).toBe(true);
      expect(res.findings.find((f) => f.finding === vf.RD_SETTLEMENT_READY).severity).toBe('info');
    });

    test('emits RD_SETTLEMENT_PARTIAL for 80-99% readiness', () => {
      // Block 1 of 2 installations → 50% — but we test partial specifically
      // Use 9 installations, block 1 → 88.9%
      const installations = Array.from({ length: 9 }, (_, i) =>
        makeInstallation({ EinheitMastrNummer: `SEE${i}` })
      );
      const findings = [{ severity: 'error', context: { mastrNummer: 'SEE0' } }];
      const res = rdService.stepSettlementReadiness(installations, findings);
      expect(res.readiness.readinessPercent).toBeGreaterThanOrEqual(80);
      expect(res.readiness.readinessPercent).toBeLessThan(100);
      expect(res.findings.some((f) => f.finding === vf.RD_SETTLEMENT_PARTIAL)).toBe(true);
      expect(res.findings.find((f) => f.finding === vf.RD_SETTLEMENT_PARTIAL).severity).toBe(
        'warning'
      );
    });

    test('emits RD_SETTLEMENT_CRITICAL when readiness <80%', () => {
      // Block all installations
      const installations = [
        makeInstallation({ EinheitMastrNummer: 'SEE01' }),
        makeInstallation({ EinheitMastrNummer: 'SEE02' }),
      ];
      const findings = [
        { severity: 'error', context: { mastrNummer: 'SEE01' } },
        { severity: 'error', context: { mastrNummer: 'SEE02' } },
      ];
      const res = rdService.stepSettlementReadiness(installations, findings);
      expect(res.readiness.readinessPercent).toBe(0);
      expect(res.findings.some((f) => f.finding === vf.RD_SETTLEMENT_CRITICAL)).toBe(true);
      expect(res.findings.find((f) => f.finding === vf.RD_SETTLEMENT_CRITICAL).severity).toBe(
        'error'
      );
    });

    test('returns empty findings for empty portfolio', () => {
      const res = rdService.stepSettlementReadiness([], []);
      expect(res.findings).toHaveLength(0);
      expect(res.readiness.totalInstallations).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Step 6: Risk assessment
  // -------------------------------------------------------------------------
  describe('stepRiskAssessment', () => {
    const fullReadiness = { readinessPercent: 100, totalInstallations: 2, blockedInstallations: 0 };

    test('emits RD_RISK_LOW when estimated loss ≤10,000 EUR', () => {
      const res = rdService.stepRiskAssessment(fullReadiness, 0, 50);
      expect(res.risk.riskLevel).toBe('low');
      expect(res.findings.some((f) => f.finding === vf.RD_RISK_LOW)).toBe(true);
      expect(res.findings.find((f) => f.finding === vf.RD_RISK_LOW).severity).toBe('info');
    });

    test('emits RD_RISK_MEDIUM for medium risk scenario', () => {
      const half = { readinessPercent: 50, totalInstallations: 2, blockedInstallations: 1 };
      const res = rdService.stepRiskAssessment(half, 0.41, 50);
      expect(res.risk.riskLevel).toBe('medium');
      expect(res.findings.some((f) => f.finding === vf.RD_RISK_MEDIUM)).toBe(true);
      expect(res.findings.find((f) => f.finding === vf.RD_RISK_MEDIUM).severity).toBe('warning');
    });

    test('emits RD_RISK_HIGH for high risk scenario', () => {
      const none = { readinessPercent: 0, totalInstallations: 1, blockedInstallations: 1 };
      const res = rdService.stepRiskAssessment(none, 3, 50);
      expect(res.risk.riskLevel).toBe('high');
      expect(res.findings.some((f) => f.finding === vf.RD_RISK_HIGH)).toBe(true);
      expect(res.findings.find((f) => f.finding === vf.RD_RISK_HIGH).severity).toBe('error');
    });
  });

  // -------------------------------------------------------------------------
  // Step 7: Audit trail
  // -------------------------------------------------------------------------
  describe('stepAudit', () => {
    test('emits AUDIT_TRAIL_CREATED finding', async () => {
      const ctx = {
        meta: {},
        call: jest.fn().mockImplementation(async (action) => {
          if (action === 'datapoint.createSnapshot') {
            return { id: 'snap-001', status: 'complete', snapshotHash: 'abc' };
          }
          return { consistent: true, drift: [] };
        }),
      };
      const res = await rdService.stepAudit(
        ctx,
        { datapointTags: [], _resolvedOperator: MOCK_OPERATOR },
        {
          readinessPercent: 88,
          riskLevel: 'medium',
          totalInstallations: 2,
          allFindingsCount: 5,
        },
        {}
      );
      expect(res.findings.some((f) => f.finding === vf.AUDIT_TRAIL_CREATED)).toBe(true);
    });

    test('emits SNAPSHOT_DRIFT_DETECTED when drift array is non-empty', async () => {
      const ctx = {
        meta: {},
        call: jest.fn().mockImplementation(async (action) => {
          if (action === 'datapoint.createSnapshot') {
            return { id: 'snap-002', status: 'complete', snapshotHash: 'abc' };
          }
          return {
            consistent: false,
            drift: [{ name: 'dp-1', changed: true }],
            snapshotHash: 'abc',
          };
        }),
      };
      const res = await rdService.stepAudit(
        ctx,
        {
          datapointTags: ['redispatch-portfolio'],
          _resolvedOperator: MOCK_OPERATOR,
        },
        { allFindingsCount: 3 },
        {}
      );
      expect(res.findings.some((f) => f.finding === vf.SNAPSHOT_DRIFT_DETECTED)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Weg B: tryDatapointFallback
  // -------------------------------------------------------------------------
  describe('tryDatapointFallback', () => {
    test('returns null when datapointTags is empty', async () => {
      const ctx = { meta: {}, call: jest.fn() };
      const result = await rdService.tryDatapointFallback(ctx, [], 60);
      expect(result).toBeNull();
      expect(ctx.call).not.toHaveBeenCalled();
    });

    test('returns null when no matching tagged datapoint found', async () => {
      const ctx = {
        meta: {},
        call: jest.fn().mockResolvedValue({ datapoints: [] }),
      };
      const result = await rdService.tryDatapointFallback(ctx, ['redispatch-portfolio'], 60);
      expect(result).toBeNull();
    });

    test('returns null when datapoint is stale (older than maxAgeMinutes)', async () => {
      const staleTimestamp = new Date(Date.now() - 120 * 60 * 1000 - 1000).toISOString();
      const ctx = {
        meta: {},
        call: jest.fn().mockImplementation(async (action) => {
          if (action === 'datapoint.list') {
            return {
              datapoints: [
                {
                  name: 'rd-portfolio',
                  tags: ['redispatch-portfolio'],
                  lastRun: { timestamp: staleTimestamp },
                },
              ],
            };
          }
          return { data: { rows: MOCK_INSTALLATIONS } };
        }),
      };
      const result = await rdService.tryDatapointFallback(ctx, ['redispatch-portfolio'], 60);
      expect(result).toBeNull();
    });

    test('returns rows when datapoint is fresh and has data', async () => {
      const ctx = {
        meta: {},
        call: jest.fn().mockImplementation(async (action) => {
          if (action === 'datapoint.list') {
            return {
              datapoints: [
                {
                  name: 'rd-portfolio',
                  tags: ['redispatch-portfolio'],
                  lastRun: { timestamp: new Date().toISOString() },
                },
              ],
            };
          }
          return { data: { rows: MOCK_INSTALLATIONS } };
        }),
      };
      const result = await rdService.tryDatapointFallback(ctx, ['redispatch-portfolio'], 60);
      expect(result).toHaveLength(MOCK_INSTALLATIONS.length);
    });

    test('returns null on datapoint service error (graceful)', async () => {
      const ctx = {
        meta: {},
        call: jest.fn().mockRejectedValue(new Error('datapoint service unavailable')),
      };
      const result = await rdService.tryDatapointFallback(ctx, ['redispatch-portfolio'], 60);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Helper: deriveType
  // -------------------------------------------------------------------------
  describe('deriveType', () => {
    test.each([
      [{ Energietraeger: 'solar' }, 'solar'],
      [{ energietraeger: 'wind' }, 'wind'],
      [{ energietraeger: 'Speicher' }, 'storage'],
      [{ energietraeger: 'Biomasse' }, 'biomass'],
      [{ energietraeger: 'gas' }, 'combustion'],
      [{ Nabenhoehe: 100 }, 'wind'],
      [{ Modulanzahl: 30 }, 'solar'],
      [{ Speicherkapazitaet: 10 }, 'storage'],
      [{}, 'other'],
    ])('derives type from %j → %s', (inst, expected) => {
      expect(rdService.deriveType(inst)).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Helper: hasDvFlag
  // -------------------------------------------------------------------------
  describe('hasDvFlag', () => {
    test.each([
      [{ FernsteuerbarkeitDv: '1' }, true],
      [{ FernsteuerbarkeitDv: 1 }, true],
      [{ FernsteuerbarkeitDv: true }, true],
      [{ FernsteuerbarkeitDv: '0' }, false],
      [{ FernsteuerbarkeitDv: 0 }, false],
      [{}, false],
      [{ fernsteuerbarkeitDv: '1' }, true],
    ])('hasDvFlag(%j) → %s', (inst, expected) => {
      expect(rdService.hasDvFlag(inst)).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Full pipeline — happy path
  // -------------------------------------------------------------------------
  describe('audit action — full pipeline', () => {
    test('happy path: returns success report with all required fields', async () => {
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
      });

      expect(res.success).toBe(true);
      expect(res.id).toBeDefined();
      expect(res.gridOperator.mastrId).toBe(MOCK_OPERATOR.mastrId);
      expect(res.period.dateFrom).toBe('2026-01-01');
      expect(res.settlementReadiness).toBeDefined();
      expect(res.settlementReadiness.totalInstallations).toBe(MOCK_INSTALLATIONS.length);
      expect(res.riskAssessment).toBeDefined();
      expect(res.riskAssessment.riskLevel).toBeDefined();
      expect(res.summary).toBeDefined();
      expect(res.summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(res.findings).toBeInstanceOf(Array);
      expect(res.steps).toHaveLength(7);
      expect(res.metadata.pipelineVersion).toBe('0.18.0');
    });

    test('throws when neither gridOperatorId, gridOperatorBdew nor gridOperatorName provided', async () => {
      await expect(broker.call('redispatch-expost.audit', {})).rejects.toThrow(
        /At least one of gridOperatorId/
      );
    });

    test('throws on invalid skipSteps values', async () => {
      await expect(
        broker.call('redispatch-expost.audit', {
          gridOperatorId: 'SNB935578300972',
          skipSteps: [1, 4],
        })
      ).rejects.toThrow(/Invalid skipSteps/);
    });

    test('skipSteps: skipped steps appear as "skipped" in steps array', async () => {
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
        skipSteps: [3, 4, 5, 6],
      });
      const skipped = res.steps.filter((s) => s.status === 'skipped');
      expect(skipped.map((s) => s.step).sort()).toEqual([3, 4, 5, 6]);
    });

    test('skipSteps [3,4,5,6]: mandatory steps 1, 2, 7 still run', async () => {
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
        skipSteps: [3, 4, 5, 6],
      });
      const executed = res.steps.filter((s) => s.status === 'success');
      const executedStepNums = executed.map((s) => s.step);
      expect(executedStepNums).toContain(1);
      expect(executedStepNums).toContain(2);
      expect(executedStepNums).toContain(7);
    });

    test('empty portfolio still completes pipeline (error finding, no crash)', async () => {
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'vnb_lookup_codes') {
          return { canonical: MOCK_OPERATOR, candidates: [] };
        }
        if (tool === 'cernion_installations_local') return { installations: [] };
        if (tool === 'netztransparenz_redispatch') return { measures: MOCK_MEASURES };
        return {};
      });
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
      });
      expect(res.success).toBe(true);
      expect(res.settlementReadiness.totalInstallations).toBe(0);
    });

    test('curtailment data unavailable still completes (graceful degradation)', async () => {
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'vnb_lookup_codes') return { canonical: MOCK_OPERATOR, candidates: [] };
        if (tool === 'cernion_installations_local') return { installations: MOCK_INSTALLATIONS };
        if (tool === 'netztransparenz_redispatch') throw new Error('Netztransparenz unavailable');
        return {};
      });
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
      });
      expect(res.success).toBe(true);
      expect(res.riskAssessment.curtailmentGWh).toBe(0);
      const step4 = res.steps.find((s) => s.step === 4);
      expect(step4.status).toBe('success'); // error is caught, step completes
    });

    test('high-risk scenario emits RD_RISK_HIGH', async () => {
      // 1 installation, all fields present except MeLo → blocked → 0% ready → high risk
      const blockedInst = makeInstallation({
        EinheitMastrNummer: 'SEE_BLOCKED',
        marktlokationId: null, // blocks settlement
      });
      CernionMCPClient.callWithNewSession.mockImplementation(async (tool) => {
        if (tool === 'vnb_lookup_codes') return { canonical: MOCK_OPERATOR, candidates: [] };
        if (tool === 'cernion_installations_local') return { installations: [blockedInst] };
        if (tool === 'netztransparenz_redispatch') {
          // ~3 GWh → 3000 MWh × 100% blocked × €50 = €150k → HIGH
          return { measures: Array(10).fill({ volumeMWh: 300 }) };
        }
        return {};
      });
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
        avgCompensationEurPerMWh: 50,
      });
      expect(res.riskAssessment.riskLevel).toBe('high');
      expect(res.findings.some((f) => f.finding === vf.RD_RISK_HIGH)).toBe(true);
    });

    test('determinism: same inputs produce same findings codes', async () => {
      const params = {
        gridOperatorBdew: '9907473000008',
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
        skipSteps: [4],
      };
      const r1 = await broker.call('redispatch-expost.audit', params);
      const r2 = await broker.call('redispatch-expost.audit', params);
      const codes1 = r1.findings.map((f) => f.finding).sort();
      const codes2 = r2.findings.map((f) => f.finding).sort();
      expect(codes1).toEqual(codes2);
    });
  });

  // -------------------------------------------------------------------------
  // Persistence: list and get actions
  // -------------------------------------------------------------------------
  describe('list and get actions', () => {
    let savedId;

    beforeAll(async () => {
      const res = await broker.call('redispatch-expost.audit', {
        gridOperatorBdew: '9907473000008',
      });
      savedId = res.id;
    });

    test('list returns at least the saved audit', async () => {
      const res = await broker.call('redispatch-expost.list', {});
      expect(res.count).toBeGreaterThanOrEqual(1);
      expect(res.audits.some((a) => a.id === savedId)).toBe(true);
    });

    test('list filters by gridOperatorId', async () => {
      const res = await broker.call('redispatch-expost.list', {
        gridOperatorId: MOCK_OPERATOR.mastrId,
      });
      for (const a of res.audits) {
        expect(a.gridOperator.mastrId).toBe(MOCK_OPERATOR.mastrId);
      }
    });

    test('get returns the full report by id', async () => {
      const res = await broker.call('redispatch-expost.get', { id: savedId });
      expect(res.success).toBe(true);
      expect(res.id).toBe(savedId);
      expect(res.pipelineVersion).toBe('0.18.0');
    });

    test('get returns 404 for unknown id', async () => {
      const res = await broker.call('redispatch-expost.get', { id: 'nonexistent-id-xyz' });
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/not found/i);
    });

    test('list respects limit parameter', async () => {
      const res = await broker.call('redispatch-expost.list', { limit: 1 });
      expect(res.audits.length).toBeLessThanOrEqual(1);
    });
  });
});
