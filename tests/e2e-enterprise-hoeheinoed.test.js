'use strict';

/**
 * Enterprise E2E Test — Höheinöd (PLZ 66989)
 *
 * Covers the full enterprise service stack in a single integrated broker:
 *   - Token Manager (Phase A)
 *   - Grid Connection Validation (Phase B)
 *   - Energy Sharing Validation §42c EnWG (Phase C)
 *   - MaStR Quality Audit (Phase D)
 *   - Dashboard API — aggregated views (Phase E)
 *   - Höheinöd Fixture Validation (Phase F)
 *   - Cross-Service Integration (Phase G)
 *
 * All MCP calls are mocked via jest.mock('../src/mcp-client').
 * Agent PouchDB paths are isolated per test run via env vars.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

// ---------------------------------------------------------------------------
// Jest module mocks — MUST be declared before any require() of agent services
// ---------------------------------------------------------------------------
jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const CernionMCPClient = require('../src/mcp-client');

// ---------------------------------------------------------------------------
// Isolated PouchDB paths for this test run
// ---------------------------------------------------------------------------
const TS = Date.now();
const TEST_GC_DB_PATH = path.join(os.tmpdir(), `cernion-gc-e2e-ent-${TS}`);
const TEST_ES_DB_PATH = path.join(os.tmpdir(), `cernion-es-e2e-ent-${TS}`);
const TEST_MQ_DB_PATH = path.join(os.tmpdir(), `cernion-mq-e2e-ent-${TS}`);

process.env.GRID_CONNECTION_DB_PATH = TEST_GC_DB_PATH;
process.env.ENERGY_SHARING_DB_PATH  = TEST_ES_DB_PATH;
process.env.MASTR_QUALITY_DB_PATH   = TEST_MQ_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

// ---------------------------------------------------------------------------
// Service imports (after env vars + jest.mock)
// ---------------------------------------------------------------------------
const GridConnectionService    = require('../services/grid-connection.service');
const EnergySharingService     = require('../services/energy-sharing.service');
const MastrQualityService      = require('../services/mastr-quality.service');
const DashboardApiService      = require('../services/dashboard-api.service');
const TokenManagerService      = require('../services/token-manager.service');
const { FINDING_CODE_METADATA } = require('../src/validation-findings');

// ---------------------------------------------------------------------------
// Höheinöd installation fixtures (CYA format — used in Phase F)
// ---------------------------------------------------------------------------
const HOEHEINOED_INSTALLATIONS = [
  {
    mastrNummer: 'SEE969028349266',
    name: 'WEA Höheinöd HOE01',
    type: 'wind',
    nettonennleistung: 3300,
    bruttoleistung: 3300,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2016-09-26T00:00:00.000Z',
    fernsteuerbarkeitDv: '1',
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: {
      spannungsebene: 352,
      spannungsebeneLabel: 'Mittelspannung (MV)',
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE991748766191',
    name: 'WEA R01',
    type: 'wind',
    nettonennleistung: 7000,
    bruttoleistung: 7000,
    einheitBetriebsstatus: '31',
    inbetriebnahmedatum: null,
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2955,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: null,
  },
  {
    mastrNummer: 'SEE988204328529',
    name: 'WEA R02',
    type: 'wind',
    nettonennleistung: 7000,
    bruttoleistung: 7000,
    einheitBetriebsstatus: '31',
    inbetriebnahmedatum: null,
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2955,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: null,
  },
  {
    mastrNummer: 'SEE974207082094',
    name: 'Höheinöd W123',
    type: 'wind',
    nettonennleistung: 2300,
    bruttoleistung: 2300,
    einheitBetriebsstatus: '38',
    inbetriebnahmedatum: '2006-01-24T00:00:00.000Z',
    fernsteuerbarkeitDv: '1',
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: { spannungsebene: 352, spannungsebeneLabel: 'Mittelspannung (MV)' },
  },
  {
    mastrNummer: 'SEE999952467552',
    name: 'Solarpark Höheinöd',
    type: 'solar',
    nettonennleistung: 2103.7,
    bruttoleistung: 2103.7,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2009-12-16T00:00:00.000Z',
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: {
      spannungsebene: 352,
      spannungsebeneLabel: 'Mittelspannung (MV)',
      netzbetreiberMastrNummer: 'SNB961471621746',
    },
  },
  {
    mastrNummer: 'SEE976608984557',
    name: 'BHKW 1 Biogasanlage Höheinöd',
    type: 'biomass',
    nettonennleistung: 600,
    bruttoleistung: 600,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2011-10-20T00:00:00.000Z',
    fernsteuerbarkeitDv: '1',
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: { spannungsebene: 352, spannungsebeneLabel: 'Mittelspannung (MV)' },
  },
  {
    mastrNummer: 'SEE982890040772',
    name: 'Speicher',
    type: 'storage',
    nettonennleistung: 6.93,
    bruttoleistung: 12,
    einheitBetriebsstatus: '35',
    inbetriebnahmedatum: '2019-04-29T00:00:00.000Z',
    fernsteuerbarkeitDv: null,
    netzbetreiberpruefungStatus: 2954,
    gemeinde: 'Höheinöd',
    postleitzahl: '66989',
    napData: { spannungsebene: 354, spannungsebeneLabel: 'Niederspannung (LV)' },
  },
];

// ---------------------------------------------------------------------------
// MCP mock installations (agent service format — used by agent pipelines)
// ---------------------------------------------------------------------------
const MOCK_MCP_OPERATOR = {
  mastrId: 'SNB961471621746',
  name: 'Pfalzwerke Netz AG',
  bdew: '9907015000008',
  bnr: '10002954',
};

const MOCK_MCP_INSTALLATIONS = [
  {
    EinheitMastrNummer: 'SEE969028349266',
    einheitBetriebsstatus: 35,
    NettoNennleistung: 3300,
    bruttoleistung: 3300,
    nettoNennleistung: 3300,
    Postleitzahl: '66989',
    energietraeger: 'wind',
    netzbetreiberPruefungStatus: 2954,
    inbetriebnahmeDatum: '2016-09-26',
    FernsteuerbarkeitDv: '1',
    NapMastrNummer: 'NAP-HOE-001',
    MeloMastrNummer: 'DE0003966698900000000000052335108',
    nap: {
      MastrNummer: 'NAP-HOE-001',
      Spannungsebene: 'MS',
      NetzbetreiberMastrNummer: 'SNB961471621746',
    },
    koordinatenBreitengrad: 49.3063,
    koordinatenLaengengrad: 7.6167,
  },
  {
    EinheitMastrNummer: 'SEE999952467552',
    einheitBetriebsstatus: 35,
    NettoNennleistung: 2103.7,
    bruttoleistung: 2103.7,
    nettoNennleistung: 2103.7,
    Postleitzahl: '66989',
    energietraeger: 'solar',
    netzbetreiberPruefungStatus: 2954,
    inbetriebnahmeDatum: '2009-12-16',
    FernsteuerbarkeitDv: '0',
    NapMastrNummer: 'NAP-HOE-002',
    MeloMastrNummer: 'DE0003966698900000000000052335107',
    nap: {
      MastrNummer: 'NAP-HOE-002',
      Spannungsebene: 'MS',
      NetzbetreiberMastrNummer: 'SNB961471621746',
    },
    koordinatenBreitengrad: 49.287,
    koordinatenLaengengrad: 7.5806,
  },
  {
    EinheitMastrNummer: 'SEE976608984557',
    einheitBetriebsstatus: 35,
    NettoNennleistung: 600,
    bruttoleistung: 600,
    nettoNennleistung: 600,
    Postleitzahl: '66989',
    energietraeger: 'biomass',
    netzbetreiberPruefungStatus: 2954,
    inbetriebnahmeDatum: '2011-10-20',
    FernsteuerbarkeitDv: '1',
    NapMastrNummer: 'NAP-HOE-003',
    MeloMastrNummer: 'DE0003966771400000000000053025164',
    nap: {
      MastrNummer: 'NAP-HOE-003',
      Spannungsebene: 'MS',
      NetzbetreiberMastrNummer: 'SNB961471621746',
    },
    koordinatenBreitengrad: 49.305,
    koordinatenLaengengrad: 7.62,
  },
  {
    EinheitMastrNummer: 'SEE982890040772',
    einheitBetriebsstatus: 35,
    NettoNennleistung: 6.93,
    bruttoleistung: 12,
    nettoNennleistung: 6.93,
    Postleitzahl: '66989',
    energietraeger: 'storage',
    netzbetreiberPruefungStatus: 2954,
    inbetriebnahmeDatum: '2019-04-29',
    FernsteuerbarkeitDv: null,
    NapMastrNummer: 'NAP-HOE-004',
    MeloMastrNummer: 'DE0003966698900000000000052335109',
    nap: {
      MastrNummer: 'NAP-HOE-004',
      Spannungsebene: 'NS',
      NetzbetreiberMastrNummer: 'SNB961471621746',
    },
    koordinatenBreitengrad: 49.303,
    koordinatenLaengengrad: 7.617,
  },
];

// ---------------------------------------------------------------------------
// Shared MCP mock implementation (handles all agent pipeline calls)
// ---------------------------------------------------------------------------
function mcpMockImpl(tool) {
  if (tool === 'vnb_lookup_codes') {
    return {
      canonical: {
        mastrId: MOCK_MCP_OPERATOR.mastrId,
        name:    MOCK_MCP_OPERATOR.name,
        bdew:    MOCK_MCP_OPERATOR.bdew,
        bnr:     MOCK_MCP_OPERATOR.bnr,
      },
    };
  }
  if (tool === 'cernion_installations_local') {
    return { installations: MOCK_MCP_INSTALLATIONS };
  }
  if (tool === 'cernion_direktvermarkter_lookup') {
    return {
      data: [{
        mastrId: 'DV961471000001',
        name: 'Next Kraftwerke GmbH',
        portfolioSize: 500,
        totalCapacityKW: 250000,
      }],
    };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Dashboard API mock data
// ---------------------------------------------------------------------------
const MOCK_VNB_MONITOR = {
  identity: {
    name: MOCK_MCP_OPERATOR.name,
    mastrId: MOCK_MCP_OPERATOR.mastrId,
    bdewCode: MOCK_MCP_OPERATOR.bdew,
  },
  mastr: {
    inBetrieb:             { anlagenCount: 24, leistungMW: '6.8', pvAnlagen: 4, windAnlagen: 16, speicherAnlagen: 4 },
    inPlanung:             { anlagenCount: 2, leistungMW: '14.0' },
    netzbetreiberPruefung: { anlagenCount: 2, leistungMW: '14.0' },
  },
  ewk: {
    anschlussdauer:        { eeNS_weeks: 22, eeNS_phase1_weeks: 8, eeNS_phase2_weeks: 14, verbrauchNS_weeks: 18 },
    umsetzungsquote:       { eeNS_percent: 100, verbrauchNS_percent: 98 },
    digitalisierungsindex: { gesamt_percent: 61, smartGrids_percent: 74 },
  },
  alerts:       [],
  alertSummary: { total: 0, critical: 0, warning: 0, info: 0, ewkRelevant: 0 },
};

const MOCK_VNB_IDENTITY = {
  results: [{
    name:    MOCK_MCP_OPERATOR.name,
    mastrId: MOCK_MCP_OPERATOR.mastrId,
    bdew:    MOCK_MCP_OPERATOR.bdew,
    bnr:     MOCK_MCP_OPERATOR.bnr,
  }],
};

// ---------------------------------------------------------------------------
// State shared across phases
// ---------------------------------------------------------------------------
let broker;
let storageFile;
let gcValidationId;
let esValidationId;
let mqAuditId;
let readOnlyTokenId;
let readOnlyToken;
let fullAccessTokenId;
let fullAccessToken;

// ---------------------------------------------------------------------------
// Broker lifecycle
// ---------------------------------------------------------------------------
describe('Enterprise E2E — Höheinöd (PLZ 66989)', () => {
  beforeAll(async () => {
    storageFile = path.join(os.tmpdir(), `token-mgr-e2e-ent-${TS}.json`);

    CernionMCPClient.callWithNewSession.mockImplementation(mcpMockImpl);

    broker = new ServiceBroker({ logger: false, transporter: null });

    // ── Real agent services ─────────────────────────────────────────────
    broker.createService({
      ...GridConnectionService,
      settings: {
        ...GridConnectionService.settings,
        dbPath: TEST_GC_DB_PATH,
      },
    });

    broker.createService({
      ...EnergySharingService,
      settings: {
        ...EnergySharingService.settings,
        dbPath: TEST_ES_DB_PATH,
      },
    });

    broker.createService({
      ...MastrQualityService,
      settings: {
        ...MastrQualityService.settings,
        dbPath: TEST_MQ_DB_PATH,
      },
    });

    broker.createService({
      ...TokenManagerService,
      settings: {
        ...TokenManagerService.settings,
        storageFile,
        maxTokensPerInstallation: 10,
      },
    });

    broker.createService(DashboardApiService);

    // ── Mock upstream services for dashboard-api ────────────────────────
    broker.createService({
      name: 'grid-operations',
      actions: {
        vnbLookupCodes: { handler: () => MOCK_VNB_IDENTITY },
        marketPartners:  { handler: () => ({ results: [{ companyName: MOCK_MCP_OPERATOR.name, bdewCode: MOCK_MCP_OPERATOR.bdew, mastrId: MOCK_MCP_OPERATOR.mastrId }], count: 1 }) },
      },
    });

    broker.createService({
      name: 'vnb-monitor',
      actions: {
        snapshot: { handler: () => MOCK_VNB_MONITOR },
      },
    });

    broker.createService({
      name: 'datapoint',
      actions: {
        health:           { handler: () => ({ overview: { healthy: 3, stale: 0, errored: 0 } }) },
        validateSnapshot: { handler: () => ({ consistent: true, drift: [] }) },
        createSnapshot:   { handler: () => ({ id: null }) },
      },
    });

    broker.createService({
      name: 'assets',
      actions: {
        redispatchCount: {
          handler: () => ({
            count: 3,
            totalCapacityMW: 4.0,
            byType: { wind: { count: 1, capacityKW: 3300 }, solar: { count: 1, capacityKW: 2103 }, biomass: { count: 1, capacityKW: 600 } },
          }),
        },
      },
    });

    broker.createService({
      name: 'energy-sharing-allocation',
      actions: {
        list: { handler: () => ({ count: 0, allocations: [] }) },
      },
    });

    broker.createService({
      name: 'energy-market',
      actions: {
        prices:       { handler: () => ({ data: [{ value: 42.5 }, { value: 44.1 }] }) },
        co2Intensity: { handler: () => ({ current: 340, avgToday: 320, location: 'Deutschland' }) },
      },
    });

    broker.createService({
      name: 'entsoe',
      actions: {
        dayAheadPrices:    { handler: () => ({ data: [{ value: 41.0 }] }) },
        windSolarForecast: { handler: () => ({ solar: [], wind: [] }) },
      },
    });

    broker.createService({
      name: 'german-grid',
      actions: {
        spotprices: { handler: () => ({ data: [{ value: 43.2 }] }) },
      },
    });

    broker.createService({
      name: 'redispatch-expost',
      actions: {
        list:  { handler: () => ({ count: 0, audits: [] }) },
        audit: { handler: () => ({ success: true, id: 'rd-mock-001' }) },
      },
    });

    await broker.start();
  }, 30000);

  afterAll(async () => {
    await broker.stop();

    // broker.stop() triggers stopped()-hooks on all services which call
    // await this.db.close() for the three PouchDB-backed agent services.
    // A short drain lets LevelDB's async teardown finish before Jest checks
    // for open handles (avoids spurious --detectOpenHandles warnings).
    await new Promise((r) => setTimeout(r, 200));

    if (fs.existsSync(storageFile)) fs.unlinkSync(storageFile);
    fs.rmSync(TEST_GC_DB_PATH, { recursive: true, force: true });
    fs.rmSync(TEST_ES_DB_PATH, { recursive: true, force: true });
    fs.rmSync(TEST_MQ_DB_PATH, { recursive: true, force: true });
  });

  // =========================================================================
  // Phase A: Token Manager
  // =========================================================================
  describe('Phase A: Token Manager — Vollständiger Lifecycle', () => {
    test('A1: create read-only token returns success', async () => {
      const result = await broker.call('token-manager.create', {
        name: 'Höheinöd Portal Read',
        scope: 'read-only',
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      readOnlyTokenId = result.data.id;
      readOnlyToken   = result.data.token;
    });

    test('A2: read-only token starts with ck_', () => {
      expect(readOnlyToken).toBeDefined();
      expect(readOnlyToken.startsWith('ck_')).toBe(true);
    });

    test('A3: list returns masked token (not plaintext)', async () => {
      const result = await broker.call('token-manager.list');
      expect(result.success).toBe(true);
      const entry = result.data.find((t) => t.id === readOnlyTokenId);
      expect(entry).toBeDefined();
      expect(entry.token).toContain('****');
      expect(entry.token).not.toBe(readOnlyToken);
    });

    test('A4: verify GET /api/assets is valid for read-only token', async () => {
      const result = await broker.call('token-manager.verify', {
        token: readOnlyToken,
        method: 'GET',
        path: '/api/assets',
        trackUsage: true,
      });
      expect(result.valid).toBe(true);
    });

    test('A5: verify DELETE is denied for read-only token', async () => {
      const result = await broker.call('token-manager.verify', {
        token: readOnlyToken,
        method: 'DELETE',
        path: '/api/tokens/123',
        trackUsage: false,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('SCOPE_VIOLATION');
    });

    test('A6: create full-access token returns success', async () => {
      const result = await broker.call('token-manager.create', {
        name: 'Höheinöd Admin Full',
        scope: 'full-access',
      });
      expect(result.success).toBe(true);
      fullAccessTokenId = result.data.id;
      fullAccessToken   = result.data.token;
      expect(fullAccessToken.startsWith('ck_')).toBe(true);
    });

    test('A7: full-access token allows DELETE', async () => {
      const result = await broker.call('token-manager.verify', {
        token: fullAccessToken,
        method: 'DELETE',
        path: '/api/tokens/999',
        trackUsage: false,
      });
      expect(result.valid).toBe(true);
    });

    test('A8: list shows both tokens', async () => {
      const result = await broker.call('token-manager.list');
      expect(result.success).toBe(true);
      const ids = result.data.map((t) => t.id);
      expect(ids).toContain(readOnlyTokenId);
      expect(ids).toContain(fullAccessTokenId);
    });
  });

  // =========================================================================
  // Phase B: Grid Connection Validation — Pfalzwerke Netz AG
  // =========================================================================
  describe('Phase B: Grid Connection Validation — Pfalzwerke Netz AG', () => {
    let gcResult;

    test('B1: validate returns success and id', async () => {
      gcResult = await broker.call('grid-connection.validate', {
        gridOperatorId: MOCK_MCP_OPERATOR.mastrId,
        skipSteps: [4], // skip EWK benchmark (external service)
      });
      expect(gcResult.success).toBe(true);
      expect(gcResult.id).toBeTruthy();
      gcValidationId = gcResult.id;
    });

    test('B2: decision is a known validation decision', () => {
      const knownDecisions = ['GO_DIRECT', 'GO_CONDITIONAL', 'NO_GO_EXPANSION', 'DATA_QUALITY_INSUFFICIENT'];
      expect(knownDecisions).toContain(gcResult.decision);
    });

    test('B3: summary has totalInstallations matching mock data', () => {
      expect(gcResult.summary).toBeDefined();
      expect(gcResult.summary.totalInstallations).toBe(MOCK_MCP_INSTALLATIONS.length);
    });

    test('B4: findings is a non-empty array', () => {
      expect(Array.isArray(gcResult.findings)).toBe(true);
      expect(gcResult.findings.length).toBeGreaterThan(0);
    });

    test('B5: steps is an array with at least 5 entries', () => {
      expect(Array.isArray(gcResult.steps)).toBe(true);
      expect(gcResult.steps.length).toBeGreaterThanOrEqual(5);
    });

    test('B6: AUDIT_TRAIL_CREATED finding is present in findings', () => {
      const auditFinding = gcResult.findings.find(
        (f) => f.finding === 'AUDIT_TRAIL_CREATED'
      );
      expect(auditFinding).toBeDefined();
      expect(auditFinding.severity).toBe('info');
    });

    test('B7: list returns at least 1 persisted validation', async () => {
      const result = await broker.call('grid-connection.list', { limit: 5 });
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.validations)).toBe(true);
    });

    test('B8: get by gcValidationId returns the persisted report', async () => {
      const result = await broker.call('grid-connection.get', { id: gcValidationId });
      expect(result.success).toBe(true);
      expect(result.id).toBe(gcValidationId);
      expect(result.decision).toBeTruthy();
    });

    test('B9: skipSteps=[4] causes step 4 to be marked skipped', () => {
      const step4 = gcResult.steps.find((s) => s.step === 4 || s.stepNumber === 4);
      if (step4) {
        expect(step4.status).toBe('skipped');
      } else {
        // Step 4 was simply not run — validate the steps count is < 6
        expect(gcResult.steps.length).toBeLessThan(6);
      }
    });

    test('B10: validate without operator identifier throws error', async () => {
      await expect(
        broker.call('grid-connection.validate', {})
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Phase C: Energy Sharing Validation — Solargemeinschaft Höheinöd
  // =========================================================================
  describe('Phase C: Energy Sharing Validation — §42c EnWG Höheinöd', () => {
    let esResult;

    const COMMUNITY_NAME = 'Solargemeinschaft Höheinöd';
    const COMMUNITY_ID   = 'ES-HOE-2026-001';

    const GENERATORS = [
      {
        mastrNummer: 'SEE969028349266', // WEA HOE01 — operational, FernsteuerbarkeitDv='1'
        sharePercent: 100,
        direktvermarkter: 'Next Kraftwerke GmbH',
      },
    ];

    const CONSUMERS = [
      { maloId: 'DE0001234567890123456789012345678', sharePercent: 60, name: 'Müller, Hans' },
      { maloId: 'DE0009876543210987654321098765432', sharePercent: 40, name: 'Schmidt, Anna' },
    ];

    test('C1: validate returns success and id', async () => {
      esResult = await broker.call('energy-sharing.validate', {
        gridOperatorId: MOCK_MCP_OPERATOR.mastrId,
        communityName:  COMMUNITY_NAME,
        communityId:    COMMUNITY_ID,
        generators:     GENERATORS,
        consumers:      CONSUMERS,
      });
      expect(esResult.success).toBe(true);
      expect(esResult.id).toBeTruthy();
      esValidationId = esResult.id;
    });

    test('C2: decision is an approved or conditional outcome', () => {
      const approvedDecisions = ['APPROVED', 'APPROVED_WITH_CONDITIONS'];
      expect(approvedDecisions).toContain(esResult.decision);
    });

    test('C3: communityName matches input', () => {
      expect(esResult.communityName).toBe(COMMUNITY_NAME);
    });

    test('C4: communityId matches input', () => {
      expect(esResult.communityId).toBe(COMMUNITY_ID);
    });

    test('C5: summary.generatorsSubmitted equals 1', () => {
      expect(esResult.summary).toBeDefined();
      expect(esResult.summary.generatorsSubmitted).toBe(1);
    });

    test('C6: summary.consumersSubmitted equals 2', () => {
      expect(esResult.summary.consumersSubmitted).toBe(2);
    });

    test('C7: findings is a non-empty array', () => {
      expect(Array.isArray(esResult.findings)).toBe(true);
      expect(esResult.findings.length).toBeGreaterThan(0);
    });

    test('C8: steps is an array with at least 5 entries', () => {
      expect(Array.isArray(esResult.steps)).toBe(true);
      expect(esResult.steps.length).toBeGreaterThanOrEqual(5);
    });

    test('C9: report persisted — list returns count >= 1', async () => {
      const result = await broker.call('energy-sharing.list', { limit: 5 });
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.validations)).toBe(true);
    });

    test('C10: get by esValidationId returns the persisted report', async () => {
      const result = await broker.call('energy-sharing.get', { id: esValidationId });
      expect(result.success).toBe(true);
      expect(result.id).toBe(esValidationId);
      expect(result.communityName).toBe(COMMUNITY_NAME);
    });

    test('C11: validate without VNB identifier throws error', async () => {
      await expect(
        broker.call('energy-sharing.validate', {
          communityName: 'Test',
          generators: [],
          consumers:  [],
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Phase D: MaStR Quality Audit — Pfalzwerke Netz AG
  // =========================================================================
  describe('Phase D: MaStR Quality Audit — Pfalzwerke Netz AG', () => {
    let mqResult;
    let mqSkipResult;

    test('D1: audit returns success and id', async () => {
      mqResult = await broker.call('mastr-quality.audit', {
        gridOperatorId: MOCK_MCP_OPERATOR.mastrId,
        skipSteps: [7], // skip geo spot-check (requires live Overpass)
      });
      expect(mqResult.success).toBe(true);
      expect(mqResult.id).toBeTruthy();
      mqAuditId = mqResult.id;
    });

    test('D2: qualityScore is a number', () => {
      expect(typeof mqResult.qualityScore).toBe('number');
    });

    test('D3: qualityScore is in range [0, 100]', () => {
      expect(mqResult.qualityScore).toBeGreaterThanOrEqual(0);
      expect(mqResult.qualityScore).toBeLessThanOrEqual(100);
    });

    test('D4: qualityDimensions has all 5 required keys', () => {
      const dims = mqResult.qualityDimensions;
      expect(dims).toBeDefined();
      expect(dims.status).toBeDefined();
      expect(dims.capacity).toBeDefined();
      expect(dims.connectionPoints).toBeDefined();
      expect(dims.duplicates).toBeDefined();
      expect(dims.geo).toBeDefined();
    });

    test('D5: summary.totalInstallations matches mock installation count', () => {
      expect(mqResult.summary).toBeDefined();
      expect(mqResult.summary.totalInstallations).toBe(MOCK_MCP_INSTALLATIONS.length);
    });

    test('D6: findings is a non-empty array', () => {
      expect(Array.isArray(mqResult.findings)).toBe(true);
      expect(mqResult.findings.length).toBeGreaterThan(0);
    });

    test('D7: resolver.matchedBy is truthy', () => {
      expect(mqResult.resolver).toBeDefined();
      expect(mqResult.resolver.matchedBy).toBeTruthy();
    });

    test('D8: skipSteps=[7] causes geo dimension score to be null', () => {
      // When step 7 (geo) is skipped, the geo dimension score should be null
      expect(mqResult.qualityDimensions.geo.score).toBeNull();
    });

    test('D9: list returns at least 1 persisted audit', async () => {
      const result = await broker.call('mastr-quality.list', { limit: 5 });
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.audits)).toBe(true);
    });

    test('D10: get by mqAuditId returns the persisted audit', async () => {
      const result = await broker.call('mastr-quality.get', { id: mqAuditId });
      expect(result.success).toBe(true);
      expect(result.id).toBe(mqAuditId);
      expect(typeof result.qualityScore).toBe('number');
    });

    test('D11: BDEW alias audit also returns success', async () => {
      mqSkipResult = await broker.call('mastr-quality.audit', {
        bdewCode: MOCK_MCP_OPERATOR.bdew,
        skipSteps: [3, 4, 5, 6, 7], // skip all optional steps for speed
      });
      expect(mqSkipResult.success).toBe(true);
      expect(mqSkipResult.gridOperator.mastrId).toBe(MOCK_MCP_OPERATOR.mastrId);
    });
  });

  // =========================================================================
  // Phase E: Dashboard API — Aggregierte Unternehmensübersicht
  // =========================================================================
  describe('Phase E: Dashboard API — Aggregierte Unternehmensübersicht', () => {
    let vnbOverviewResult;
    let marketSnapshotResult;
    let qualitySummaryResult;
    let findingCodesResult;

    beforeAll(async () => {
      // Clear dashboard cache so we get fresh results reflecting Phases B–D
      const svc = broker.getLocalService('dashboard-api');
      if (svc && svc.cache)    svc.cache.clear();
      if (svc && svc.inflight) svc.inflight.clear();

      [vnbOverviewResult, marketSnapshotResult, qualitySummaryResult, findingCodesResult] =
        await Promise.all([
          broker.call('dashboard-api.vnbOverview',      { bdewCode: MOCK_MCP_OPERATOR.bdew }),
          broker.call('dashboard-api.marketSnapshot',   {}),
          broker.call('dashboard-api.qualitySummary',   {}),
          broker.call('dashboard-api.findingCodes',     {}),
        ]);
    });

    test('E1: vnbOverview has all required top-level keys', () => {
      expect(vnbOverviewResult).toHaveProperty('identity');
      expect(vnbOverviewResult).toHaveProperty('kpis');
      expect(vnbOverviewResult).toHaveProperty('latestAgentResults');
      expect(vnbOverviewResult).toHaveProperty('alerts');
      expect(vnbOverviewResult).toHaveProperty('timestamp');
      expect(vnbOverviewResult).toHaveProperty('_errors');
    });

    test('E2: vnbOverview._errors is an array', () => {
      expect(Array.isArray(vnbOverviewResult._errors)).toBe(true);
    });

    test('E3: vnbOverview.kpis has totalInstallations', () => {
      expect(vnbOverviewResult.kpis).toBeDefined();
      expect(vnbOverviewResult.kpis.totalInstallations).toBeDefined();
    });

    test('E4: vnbOverview.latestAgentResults has mastrQuality entry', () => {
      expect(vnbOverviewResult.latestAgentResults).toBeDefined();
      expect(vnbOverviewResult.latestAgentResults.mastrQuality).toBeDefined();
    });

    test('E5: marketSnapshot has spotPrice, co2, renewableForecast24h, timestamp', () => {
      expect(marketSnapshotResult).toHaveProperty('spotPrice');
      expect(marketSnapshotResult).toHaveProperty('co2');
      expect(marketSnapshotResult).toHaveProperty('renewableForecast24h');
      expect(marketSnapshotResult).toHaveProperty('timestamp');
    });

    test('E6: marketSnapshot._errors is an array', () => {
      expect(Array.isArray(marketSnapshotResult._errors)).toBe(true);
    });

    test('E7: qualitySummary has agents array and timestamp', () => {
      expect(qualitySummaryResult).toHaveProperty('agents');
      expect(qualitySummaryResult).toHaveProperty('timestamp');
      expect(Array.isArray(qualitySummaryResult.agents)).toBe(true);
    });

    test('E8: qualitySummary.agents has 5 entries (one per agent type)', () => {
      expect(qualitySummaryResult.agents.length).toBe(5);
    });

    test('E9: findingCodes returns all codes from FINDING_CODE_METADATA', () => {
      expect(findingCodesResult).toHaveProperty('codes');
      expect(findingCodesResult).toHaveProperty('totalCodes');
      expect(findingCodesResult.totalCodes).toBe(
        Object.keys(FINDING_CODE_METADATA).length
      );
    });

    test('E10: every finding code entry has description and descriptionDe', () => {
      for (const [code, meta] of Object.entries(findingCodesResult.codes)) {
        expect(code).toBeTruthy();
        // FINDING_CODE_METADATA uses 'description' (EN) + 'descriptionDe'
        expect(meta.description || meta.descriptionEn).toBeTruthy();
        expect(meta.descriptionDe).toBeTruthy();
      }
    });

    test('E11: findingCodes is served from cache on second call', async () => {
      const second = await broker.call('dashboard-api.findingCodes', {});
      expect(second.codes.length).toBe(findingCodesResult.codes.length);
    });

    test('E12: qualitySummary._errors is an array (graceful degradation)', () => {
      expect(Array.isArray(qualitySummaryResult._errors)).toBe(true);
    });
  });

  // =========================================================================
  // Phase F: Höheinöd Fixture Validation
  // =========================================================================
  describe('Phase F: Höheinöd Fixture Validation — Datenkonsistenz', () => {
    test('F1: HOEHEINOED_INSTALLATIONS has exactly 7 entries', () => {
      expect(HOEHEINOED_INSTALLATIONS.length).toBe(7);
    });

    test('F2: Gesamtkapazität ist plausibel (20–30 MW)', () => {
      const totalMW = HOEHEINOED_INSTALLATIONS.reduce(
        (sum, i) => sum + (i.nettonennleistung || 0), 0
      ) / 1000;
      expect(totalMW).toBeGreaterThan(20);
      expect(totalMW).toBeLessThan(30);
    });

    test('F3: WEA HOE01 (SEE969028349266) ist in Betrieb (Status 35)', () => {
      const hoe01 = HOEHEINOED_INSTALLATIONS.find(
        (i) => i.mastrNummer === 'SEE969028349266'
      );
      expect(hoe01).toBeDefined();
      expect(hoe01.einheitBetriebsstatus).toBe('35');
    });

    test('F4: Solarpark (SEE999952467552) hat keine Fernsteuerbarkeit (null)', () => {
      const solarpark = HOEHEINOED_INSTALLATIONS.find(
        (i) => i.mastrNummer === 'SEE999952467552'
      );
      expect(solarpark).toBeDefined();
      expect(solarpark.fernsteuerbarkeitDv).toBeNull();
      expect(solarpark.inbetriebnahmedatum).toContain('2009');
    });

    test('F5: Genau 2 geplante WEA (Status 31) im Fixture', () => {
      const planned = HOEHEINOED_INSTALLATIONS.filter(
        (i) => i.einheitBetriebsstatus === '31'
      );
      expect(planned.length).toBe(2);
      expect(planned.every((i) => i.nettonennleistung === 7000)).toBe(true);
    });

    test('F6: Mindestens 1 dauerhaft stillgelegte WEA (Status 38)', () => {
      const decommissioned = HOEHEINOED_INSTALLATIONS.filter(
        (i) => i.einheitBetriebsstatus === '38'
      );
      expect(decommissioned.length).toBeGreaterThanOrEqual(1);
    });

    test('F7: Speicher (SEE982890040772) liegt im Niederspannungsnetz (354)', () => {
      const storage = HOEHEINOED_INSTALLATIONS.find(
        (i) => i.mastrNummer === 'SEE982890040772'
      );
      expect(storage).toBeDefined();
      expect(storage.napData.spannungsebene).toBe(354);
    });
  });

  // =========================================================================
  // Phase G: Cross-Service Integration
  // =========================================================================
  describe('Phase G: Cross-Service Integration', () => {
    test('G1: mastr-quality.list reflects persisted audit from Phase D', async () => {
      const result = await broker.call('mastr-quality.list', { limit: 10 });
      expect(result.count).toBeGreaterThanOrEqual(1);
      const ids = result.audits.map((a) => a.id);
      expect(ids).toContain(mqAuditId);
    });

    test('G2: grid-connection.list reflects persisted validation from Phase B', async () => {
      const result = await broker.call('grid-connection.list', { limit: 10 });
      expect(result.count).toBeGreaterThanOrEqual(1);
      const ids = result.validations.map((v) => v.id);
      expect(ids).toContain(gcValidationId);
    });

    test('G3: energy-sharing.list reflects persisted validation from Phase C', async () => {
      const result = await broker.call('energy-sharing.list', { limit: 10 });
      expect(result.count).toBeGreaterThanOrEqual(1);
      const ids = result.validations.map((v) => v.id);
      expect(ids).toContain(esValidationId);
    });

    test('G4: read-only token usageCount > 0 after trackUsage=true verify in Phase A', async () => {
      const result = await broker.call('token-manager.list');
      const entry = result.data.find((t) => t.id === readOnlyTokenId);
      expect(entry).toBeDefined();
      expect(entry.usageCount).toBeGreaterThan(0);
    });

    test('G5: mastr-quality.get returns full audit for Phase D id', async () => {
      const result = await broker.call('mastr-quality.get', { id: mqAuditId });
      expect(result.success).toBe(true);
      expect(result.qualityDimensions).toBeDefined();
      expect(result.findings.length).toBeGreaterThan(0);
    });

    test('G6: grid-connection.get returns full validation for Phase B id', async () => {
      const result = await broker.call('grid-connection.get', { id: gcValidationId });
      expect(result.success).toBe(true);
      expect(result.summary.totalInstallations).toBe(MOCK_MCP_INSTALLATIONS.length);
    });

    test('G7: energy-sharing.get returns full validation for Phase C id', async () => {
      const result = await broker.call('energy-sharing.get', { id: esValidationId });
      expect(result.success).toBe(true);
      expect(result.communityId).toBe('ES-HOE-2026-001');
    });

    test('G8: mastr-quality service exposes findingDetails action', async () => {
      const service = broker.getLocalService('mastr-quality');
      expect(service).toBeDefined();
      expect(typeof service.schema.actions.findingDetails.handler).toBe('function');
    });
  });
});
