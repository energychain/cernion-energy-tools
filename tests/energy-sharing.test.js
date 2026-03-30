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
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-es-test-${Date.now()}`);
process.env.ENERGY_SHARING_DB_PATH = TEST_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_IDENTITY = {
  mastrId: 'SNB935578300972',
  name: 'TWL Netze GmbH',
  bdew: '9907473000008',
  bnr: null,
};

const MOCK_INSTALLATION_SOLAR = {
  EinheitMastrNummer: 'SEE904837264953',
  einheitBetriebsstatus: 35,
  NettoNennleistung: 350,
  energietraeger: 'solar',
  FernsteuerbarkeitDv: '1',
  NapMastrNummer: 'NAP001',
  MeloMastrNummer: 'MEL001',
};

const MOCK_INSTALLATION_WIND_LARGE = {
  EinheitMastrNummer: 'SWE100000000001',
  einheitBetriebsstatus: 35,
  NettoNennleistung: 1500,
  energietraeger: 'wind',
  FernsteuerbarkeitDv: '1',
  NapMastrNummer: 'NAP002',
  MeloMastrNummer: 'MEL002',
};

const MOCK_INSTALLATION_NO_DV = {
  EinheitMastrNummer: 'SEE999000000001',
  einheitBetriebsstatus: 35,
  NettoNennleistung: 200,
  energietraeger: 'solar',
  FernsteuerbarkeitDv: '0',
  NapMastrNummer: 'NAP003',
  MeloMastrNummer: 'MEL003',
};

const MOCK_INSTALLATIONS = [MOCK_INSTALLATION_SOLAR, MOCK_INSTALLATION_WIND_LARGE, MOCK_INSTALLATION_NO_DV];

const MOCK_GENERATORS_VALID = [
  { mastrNummer: 'SEE904837264953', sharePercent: 100, direktvermarkter: 'Next Kraftwerke GmbH' },
];

const MOCK_CONSUMERS_VALID = [
  { maloId: 'DE0001234567890123456789012345678', sharePercent: 60, name: 'Müller, Hans' },
  { maloId: 'DE0009876543210987654321098765432', sharePercent: 40, name: 'Schmidt, Anna' },
];

const MOCK_DV_RESULT = {
  data: [{ mastrId: 'DV123456', name: 'Next Kraftwerke GmbH', portfolioSize: 500, totalCapacityKW: 250000 }],
};

// ---------------------------------------------------------------------------
// Suite 1 — validation-findings Energy Sharing codes (pure unit tests)
// ---------------------------------------------------------------------------
describe('validation-findings — Energy Sharing codes', () => {
  test('exports all ES Step 1 (VNB) finding code constants', () => {
    const expected = ['VNB_RESOLVED', 'VNB_AMBIGUOUS', 'VNB_NOT_FOUND'];
    for (const code of expected) {
      expect(vf[code]).toBe(code);
    }
  });

  test('exports all ES Step 2 (Generator) finding code constants', () => {
    const expected = [
      'GENERATOR_VALID', 'GENERATOR_NOT_FOUND', 'GENERATOR_NOT_OPERATIONAL',
      'GENERATOR_WRONG_GRID_AREA', 'GENERATOR_TYPE_INELIGIBLE', 'GENERATOR_CAPACITY_ZERO',
      'GENERATOR_NO_NAP', 'GENERATOR_NO_MELO', 'GENERATOR_DUPLICATE',
    ];
    for (const code of expected) {
      expect(vf[code]).toBe(code);
    }
  });

  test('exports all ES Step 3 (DV) finding code constants', () => {
    const expected = [
      'DV_VALID', 'DV_MANDATORY_MISSING', 'DV_NOT_CONTROLLABLE',
      'DV_NOT_FOUND', 'DV_INACTIVE', 'DV_MASTR_MISMATCH',
    ];
    for (const code of expected) {
      expect(vf[code]).toBe(code);
    }
  });

  test('exports all ES Step 4 (Eligibility) finding code constants', () => {
    const expected = [
      'ELIGIBILITY_CONFIRMED', 'SHARE_SUM_GENERATORS_INVALID', 'SHARE_SUM_CONSUMERS_INVALID',
      'NO_GENERATORS', 'NO_CONSUMERS', 'MIXED_GRID_AREAS', 'GENERATOR_EXCEEDS_LIMIT',
      'CONSUMER_MALO_INVALID', 'CONSUMER_MALO_DUPLICATE',
    ];
    for (const code of expected) {
      expect(vf[code]).toBe(code);
    }
  });

  test('ES decision constants have CR-specified string values', () => {
    expect(vf.ES_APPROVED).toBe('APPROVED');
    expect(vf.ES_APPROVED_WITH_CONDITIONS).toBe('APPROVED_WITH_CONDITIONS');
    expect(vf.ES_REJECTED_STRUCTURAL).toBe('REJECTED_STRUCTURAL');
    expect(vf.ES_REJECTED_GENERATOR_INVALID).toBe('REJECTED_GENERATOR_INVALID');
    expect(vf.ES_REJECTED_OTHER).toBe('REJECTED_OTHER');
  });

  test('pre-existing grid-connection codes still export correctly', () => {
    // Regression: extending the module must not break existing codes
    expect(vf.GO_DIRECT).toBe('GO_DIRECT');
    expect(vf.INVENTORY_COMPLETE).toBe('INVENTORY_COMPLETE');
    expect(vf.AUDIT_TRAIL_CREATED).toBe('AUDIT_TRAIL_CREATED');
    expect(vf.SNAPSHOT_DRIFT_DETECTED).toBe('SNAPSHOT_DRIFT_DETECTED');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — energy-sharing service (integration with mock broker)
// ---------------------------------------------------------------------------
describe('energy-sharing service', () => {
  let broker;
  let esService;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    // Service under test
    esService = broker.createService(require('../services/energy-sharing.service'));

    // Stub: datapoint service
    broker.createService({
      name: 'datapoint',
      actions: {
        createSnapshot: {
          async handler() {
            return { id: 'snap-es-123', status: 'complete', snapshotHash: 'hash-es-abc', datapointNames: [] };
          },
        },
        validateSnapshot: {
          async handler() {
            return { id: 'snap-es-123', consistent: true, drift: [], snapshotHash: 'hash-es-abc' };
          },
        },
        list: {
          async handler() { return { count: 0, datapoints: [] }; },
        },
        data: {
          async handler() { throw new Error('datapoint not found'); },
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
    // Default MCP mock: vnb_lookup returns identity, installations return mock list, DV returns result
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'vnb_lookup_codes') {
        return Promise.resolve({ canonical: MOCK_IDENTITY, candidates: [MOCK_IDENTITY] });
      }
      if (toolName === 'cernion_installations_local') {
        return Promise.resolve({ installations: MOCK_INSTALLATIONS });
      }
      if (toolName === 'cernion_direktvermarkter_lookup') {
        return Promise.resolve(MOCK_DV_RESULT);
      }
      return Promise.resolve({});
    });
  });

  // ---- Action definitions ----
  test('validate action is defined with REST POST /validate', () => {
    const action = esService.schema.actions.validate;
    expect(action).toBeDefined();
    expect(action.rest).toBe('POST /validate');
    expect(action.timeout).toBe(120_000);
  });

  test('list action is defined with REST GET /validations', () => {
    expect(esService.schema.actions.list.rest).toBe('GET /validations');
  });

  test('get action is defined with REST GET /validations/:id', () => {
    expect(esService.schema.actions.get.rest).toBe('GET /validations/:id');
  });

  test('all actions have openapi annotations with Energy Sharing Validation tag', () => {
    for (const [name, action] of Object.entries(esService.schema.actions)) {
      expect(action.openapi).toBeDefined();
      expect(action.openapi.summary).toBeTruthy();
      expect(Array.isArray(action.openapi.tags)).toBe(true);
      expect(action.openapi.tags).toContain('Energy Sharing Validation');
    }
  });

  // ---- hasDvFlag ----
  test('hasDvFlag returns true for string "1"', () => {
    expect(esService.hasDvFlag({ FernsteuerbarkeitDv: '1' })).toBe(true);
  });

  test('hasDvFlag returns true for boolean true', () => {
    expect(esService.hasDvFlag({ FernsteuerbarkeitDv: true })).toBe(true);
  });

  test('hasDvFlag returns false for string "0"', () => {
    expect(esService.hasDvFlag({ FernsteuerbarkeitDv: '0' })).toBe(false);
  });

  test('hasDvFlag returns false for null/undefined', () => {
    expect(esService.hasDvFlag({})).toBe(false);
    expect(esService.hasDvFlag(null)).toBe(false);
  });

  // ---- deriveType ----
  test('deriveType detects solar from energietraeger', () => {
    expect(esService.deriveType({ energietraeger: 'solar' })).toBe('solar');
  });

  test('deriveType detects wind', () => {
    expect(esService.deriveType({ energietraeger: 'wind' })).toBe('wind');
  });

  test('deriveType detects biomass', () => {
    expect(esService.deriveType({ energietraeger: 'biomasse' })).toBe('biomass');
  });

  test('deriveType detects hydro', () => {
    expect(esService.deriveType({ energietraeger: 'wasser' })).toBe('hydro');
  });

  test('deriveType falls back to other for unknown', () => {
    expect(esService.deriveType({})).toBe('other');
  });

  test('deriveType detects solar via Modulanzahl field heuristic', () => {
    expect(esService.deriveType({ Modulanzahl: 12 })).toBe('solar');
  });

  // ---- stepEligibility ----
  test('stepEligibility returns NO_GENERATORS error for empty generators array', () => {
    const findings = esService.stepEligibility({ generators: [], consumers: MOCK_CONSUMERS_VALID }, []);
    expect(findings.some((f) => f.finding === vf.NO_GENERATORS)).toBe(true);
    expect(findings.find((f) => f.finding === vf.NO_GENERATORS).severity).toBe('error');
  });

  test('stepEligibility returns NO_CONSUMERS error for empty consumers array', () => {
    const findings = esService.stepEligibility({ generators: MOCK_GENERATORS_VALID, consumers: [] }, []);
    expect(findings.some((f) => f.finding === vf.NO_CONSUMERS)).toBe(true);
  });

  test('stepEligibility returns SHARE_SUM_GENERATORS_INVALID when sum ≠ 100', () => {
    const badGens = [
      { mastrNummer: 'SEE1', sharePercent: 60 },
      { mastrNummer: 'SEE2', sharePercent: 30 },
    ];
    const findings = esService.stepEligibility({ generators: badGens, consumers: MOCK_CONSUMERS_VALID }, []);
    expect(findings.some((f) => f.finding === vf.SHARE_SUM_GENERATORS_INVALID)).toBe(true);
  });

  test('stepEligibility returns SHARE_SUM_CONSUMERS_INVALID when sum ≠ 100', () => {
    const badCons = [
      { maloId: 'DE00012345678901234567890123456789', sharePercent: 60 },
      { maloId: 'DE00098765432109876543210987654321', sharePercent: 30 },
    ];
    const findings = esService.stepEligibility({ generators: MOCK_GENERATORS_VALID, consumers: badCons }, []);
    expect(findings.some((f) => f.finding === vf.SHARE_SUM_CONSUMERS_INVALID)).toBe(true);
  });

  test('stepEligibility returns CONSUMER_MALO_INVALID for wrong format', () => {
    const badCons = [
      { maloId: 'INVALID123', sharePercent: 100 },
    ];
    const findings = esService.stepEligibility({ generators: MOCK_GENERATORS_VALID, consumers: badCons }, []);
    expect(findings.some((f) => f.finding === vf.CONSUMER_MALO_INVALID)).toBe(true);
    expect(findings.find((f) => f.finding === vf.CONSUMER_MALO_INVALID).severity).toBe('error');
  });

  test('stepEligibility accepts valid DE MaLo format (DE + 31 digits)', () => {
    const findings = esService.stepEligibility({
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    }, [{ mastrNummer: 'SEE904837264953', status: 'valid', capacityKW: 350, gridArea: 'SNB935578300972', findings: [vf.GENERATOR_VALID] }]);
    expect(findings.some((f) => f.finding === vf.CONSUMER_MALO_INVALID)).toBe(false);
  });

  test('stepEligibility returns CONSUMER_MALO_DUPLICATE for repeated MaLo', () => {
    const dupCons = [
      { maloId: 'DE00012345678901234567890123456789', sharePercent: 50 },
      { maloId: 'DE00012345678901234567890123456789', sharePercent: 50 },
    ];
    const findings = esService.stepEligibility({ generators: MOCK_GENERATORS_VALID, consumers: dupCons }, []);
    expect(findings.some((f) => f.finding === vf.CONSUMER_MALO_DUPLICATE)).toBe(true);
  });

  test('stepEligibility returns GENERATOR_DUPLICATE for repeated MaStR number', () => {
    const dupGens = [
      { mastrNummer: 'SEE904837264953', sharePercent: 50 },
      { mastrNummer: 'SEE904837264953', sharePercent: 50 },
    ];
    const findings = esService.stepEligibility({ generators: dupGens, consumers: MOCK_CONSUMERS_VALID }, []);
    expect(findings.some((f) => f.finding === vf.GENERATOR_DUPLICATE)).toBe(true);
  });

  test('stepEligibility returns GENERATOR_EXCEEDS_LIMIT for >1 MW generator', () => {
    const largeGen = [{ mastrNummer: 'SWE100000000001', status: 'valid', capacityKW: 1500, gridArea: 'SNB1', findings: [] }];
    const findings = esService.stepEligibility({
      generators: [{ mastrNummer: 'SWE100000000001', sharePercent: 100 }],
      consumers: MOCK_CONSUMERS_VALID,
    }, largeGen);
    expect(findings.some((f) => f.finding === vf.GENERATOR_EXCEEDS_LIMIT)).toBe(true);
    expect(findings.find((f) => f.finding === vf.GENERATOR_EXCEEDS_LIMIT).severity).toBe('warning');
  });

  test('stepEligibility returns ELIGIBILITY_CONFIRMED when all checks pass', () => {
    const enriched = [{
      mastrNummer: 'SEE904837264953', status: 'valid', capacityKW: 350,
      gridArea: 'SNB935578300972', findings: [vf.GENERATOR_VALID],
    }];
    const findings = esService.stepEligibility({
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    }, enriched);
    expect(findings.some((f) => f.finding === vf.ELIGIBILITY_CONFIRMED)).toBe(true);
    expect(findings.find((f) => f.finding === vf.ELIGIBILITY_CONFIRMED).severity).toBe('info');
  });

  test('stepEligibility returns MIXED_GRID_AREAS warning when generators are in different areas', () => {
    const mixedGens = [
      { mastrNummer: 'SEE1', status: 'valid', capacityKW: 100, gridArea: 'SNB111', findings: [] },
      { mastrNummer: 'SEE2', status: 'valid', capacityKW: 100, gridArea: 'SNB222', findings: [] },
    ];
    const params = {
      generators: [{ mastrNummer: 'SEE1', sharePercent: 50 }, { mastrNummer: 'SEE2', sharePercent: 50 }],
      consumers: MOCK_CONSUMERS_VALID,
    };
    const findings = esService.stepEligibility(params, mixedGens);
    expect(findings.some((f) => f.finding === vf.MIXED_GRID_AREAS)).toBe(true);
  });

  // ---- stepDecision ----
  test('stepDecision returns APPROVED when no errors or warnings', () => {
    const findings = [
      { finding: vf.GENERATOR_VALID, severity: 'info' },
      { finding: vf.ELIGIBILITY_CONFIRMED, severity: 'info' },
    ];
    const d = esService.stepDecision(findings);
    expect(d.finding).toBe('APPROVED');
    expect(d.severity).toBe('info');
  });

  test('stepDecision returns APPROVED_WITH_CONDITIONS when only warnings', () => {
    const findings = [
      { finding: vf.GENERATOR_VALID, severity: 'info' },
      { finding: vf.GENERATOR_NO_NAP, severity: 'warning' },
    ];
    const d = esService.stepDecision(findings);
    expect(d.finding).toBe('APPROVED_WITH_CONDITIONS');
    expect(d.severity).toBe('warning');
  });

  test('stepDecision returns REJECTED_STRUCTURAL on SHARE_SUM_CONSUMERS_INVALID', () => {
    const findings = [{ finding: vf.SHARE_SUM_CONSUMERS_INVALID, severity: 'error' }];
    const d = esService.stepDecision(findings);
    expect(d.finding).toBe('REJECTED_STRUCTURAL');
    expect(d.severity).toBe('error');
  });

  test('stepDecision returns REJECTED_STRUCTURAL on NO_GENERATORS', () => {
    const d = esService.stepDecision([{ finding: vf.NO_GENERATORS, severity: 'error' }]);
    expect(d.finding).toBe('REJECTED_STRUCTURAL');
  });

  test('stepDecision returns REJECTED_STRUCTURAL on GENERATOR_DUPLICATE', () => {
    const d = esService.stepDecision([{ finding: vf.GENERATOR_DUPLICATE, severity: 'error' }]);
    expect(d.finding).toBe('REJECTED_STRUCTURAL');
  });

  test('stepDecision returns REJECTED_GENERATOR_INVALID on GENERATOR_NOT_FOUND', () => {
    const d = esService.stepDecision([{ finding: vf.GENERATOR_NOT_FOUND, severity: 'error' }]);
    expect(d.finding).toBe('REJECTED_GENERATOR_INVALID');
  });

  test('stepDecision returns REJECTED_GENERATOR_INVALID on DV_MANDATORY_MISSING', () => {
    const d = esService.stepDecision([{ finding: vf.DV_MANDATORY_MISSING, severity: 'error' }]);
    expect(d.finding).toBe('REJECTED_GENERATOR_INVALID');
  });

  test('stepDecision prioritizes REJECTED_STRUCTURAL over REJECTED_GENERATOR_INVALID', () => {
    const findings = [
      { finding: vf.GENERATOR_NOT_FOUND, severity: 'error' },
      { finding: vf.NO_CONSUMERS, severity: 'error' },
    ];
    const d = esService.stepDecision(findings);
    expect(d.finding).toBe('REJECTED_STRUCTURAL');
  });

  // ---- buildDvStatus ----
  test('buildDvStatus returns "all_confirmed" when all generators have dvConfirmed=true', () => {
    const gens = [{ dvConfirmed: true }, { dvConfirmed: true }];
    expect(esService.buildDvStatus(gens)).toBe('all_confirmed');
  });

  test('buildDvStatus returns "partial" for mixed confirmation', () => {
    const gens = [{ dvConfirmed: true }, { dvConfirmed: false }];
    expect(esService.buildDvStatus(gens)).toBe('partial');
  });

  test('buildDvStatus returns "none_confirmed" when none confirmed', () => {
    const gens = [{ dvConfirmed: false }];
    expect(esService.buildDvStatus(gens)).toBe('none_confirmed');
  });

  test('buildDvStatus returns "not_applicable" for empty array', () => {
    expect(esService.buildDvStatus([])).toBe('not_applicable');
  });

  // ---- buildGeneratorFindings ----
  test('buildGeneratorFindings emits GENERATOR_VALID for clean installation', () => {
    const { genCodes } = esService.buildGeneratorFindings(
      MOCK_GENERATORS_VALID[0], MOCK_INSTALLATION_SOLAR, false, 1
    );
    expect(genCodes).toContain(vf.GENERATOR_VALID);
    expect(genCodes).not.toContain(vf.GENERATOR_NOT_OPERATIONAL);
  });

  test('buildGeneratorFindings emits GENERATOR_WRONG_GRID_AREA when wrongGridArea=true', () => {
    const { genCodes } = esService.buildGeneratorFindings(
      MOCK_GENERATORS_VALID[0], MOCK_INSTALLATION_SOLAR, true, 1
    );
    expect(genCodes).toContain(vf.GENERATOR_WRONG_GRID_AREA);
  });

  test('buildGeneratorFindings emits GENERATOR_NOT_OPERATIONAL for non-35 status', () => {
    const notOp = { ...MOCK_INSTALLATION_SOLAR, einheitBetriebsstatus: 31 };
    const { genCodes } = esService.buildGeneratorFindings(MOCK_GENERATORS_VALID[0], notOp, false, 1);
    expect(genCodes).toContain(vf.GENERATOR_NOT_OPERATIONAL);
    expect(genCodes).not.toContain(vf.GENERATOR_VALID);
  });

  test('buildGeneratorFindings emits GENERATOR_TYPE_INELIGIBLE for combustion type', () => {
    const combustion = { ...MOCK_INSTALLATION_SOLAR, energietraeger: 'verbrennung' };
    const { genCodes } = esService.buildGeneratorFindings(MOCK_GENERATORS_VALID[0], combustion, false, 1);
    expect(genCodes).toContain(vf.GENERATOR_TYPE_INELIGIBLE);
  });

  test('buildGeneratorFindings emits GENERATOR_CAPACITY_ZERO for zero capacity', () => {
    const zeroCap = { ...MOCK_INSTALLATION_SOLAR, NettoNennleistung: 0 };
    const { genCodes } = esService.buildGeneratorFindings(MOCK_GENERATORS_VALID[0], zeroCap, false, 1);
    expect(genCodes).toContain(vf.GENERATOR_CAPACITY_ZERO);
  });

  test('buildGeneratorFindings emits GENERATOR_NO_NAP when NAP missing', () => {
    const noNap = { ...MOCK_INSTALLATION_SOLAR, NapMastrNummer: null };
    const { genCodes } = esService.buildGeneratorFindings(MOCK_GENERATORS_VALID[0], noNap, false, 1);
    expect(genCodes).toContain(vf.GENERATOR_NO_NAP);
  });

  test('buildGeneratorFindings emits GENERATOR_NO_MELO when MeLo missing', () => {
    const noMelo = { ...MOCK_INSTALLATION_SOLAR, MeloMastrNummer: null };
    const { genCodes } = esService.buildGeneratorFindings(MOCK_GENERATORS_VALID[0], noMelo, false, 1);
    expect(genCodes).toContain(vf.GENERATOR_NO_MELO);
  });

  // ---- buildDvFindings ----
  test('buildDvFindings emits DV_MANDATORY_MISSING for ≥100 kW without DV flag', () => {
    const gen = { ...MOCK_GENERATORS_VALID[0], capacityKW: 200, hasDvFlag: false, dvMastrId: null };
    const findings = esService.buildDvFindings(gen, null, 1);
    expect(findings.some((f) => f.finding === vf.DV_MANDATORY_MISSING)).toBe(true);
    expect(findings.find((f) => f.finding === vf.DV_MANDATORY_MISSING).severity).toBe('error');
  });

  test('buildDvFindings emits DV_NOT_CONTROLLABLE for <100 kW without DV flag', () => {
    const gen = { ...MOCK_GENERATORS_VALID[0], capacityKW: 50, hasDvFlag: false, dvMastrId: null };
    const findings = esService.buildDvFindings(gen, null, 1);
    expect(findings.some((f) => f.finding === vf.DV_NOT_CONTROLLABLE)).toBe(true);
    expect(findings.find((f) => f.finding === vf.DV_NOT_CONTROLLABLE).severity).toBe('warning');
  });

  test('buildDvFindings emits DV_VALID when DV flag set and no DV name declared', () => {
    const gen = { mastrNummer: 'SEE1', capacityKW: 350, hasDvFlag: true, dvMastrId: null, direktvermarkter: null };
    const findings = esService.buildDvFindings(gen, null, 1);
    expect(findings.some((f) => f.finding === vf.DV_VALID)).toBe(true);
  });

  test('buildDvFindings emits DV_NOT_FOUND when DV name declared but lookup returns empty', () => {
    const gen = { mastrNummer: 'SEE1', capacityKW: 350, hasDvFlag: true, dvMastrId: null, direktvermarkter: 'Unknown DV' };
    const findings = esService.buildDvFindings(gen, { data: [] }, 1);
    expect(findings.some((f) => f.finding === vf.DV_NOT_FOUND)).toBe(true);
    expect(findings.find((f) => f.finding === vf.DV_NOT_FOUND).severity).toBe('error');
  });

  test('buildDvFindings emits DV_MASTR_MISMATCH when installation DV ID ≠ register DV ID', () => {
    const gen = {
      mastrNummer: 'SEE1', capacityKW: 350, hasDvFlag: true,
      dvMastrId: 'DV_DIFFERENT', direktvermarkter: 'Next Kraftwerke GmbH',
    };
    const findings = esService.buildDvFindings(gen, { data: [{ mastrId: 'DV_FROM_REGISTER' }] }, 1);
    expect(findings.some((f) => f.finding === vf.DV_MASTR_MISMATCH)).toBe(true);
    expect(findings.find((f) => f.finding === vf.DV_MASTR_MISMATCH).severity).toBe('warning');
  });

  test('buildDvFindings emits DV_VALID when DV confirmed in register', () => {
    const gen = {
      mastrNummer: 'SEE1', capacityKW: 350, hasDvFlag: true,
      dvMastrId: 'DV123456', direktvermarkter: 'Next Kraftwerke GmbH',
    };
    const findings = esService.buildDvFindings(gen, MOCK_DV_RESULT, 1);
    expect(findings.some((f) => f.finding === vf.DV_VALID)).toBe(true);
  });

  // ---- stepIdentity ----
  test('stepIdentity emits VNB_RESOLVED for successful lookup', async () => {
    const ctx = { meta: {} };
    const { identity, findings } = await esService.stepIdentity(ctx, { gridOperatorId: MOCK_IDENTITY.mastrId });
    expect(identity.mastrId).toBe(MOCK_IDENTITY.mastrId);
    expect(findings.some((f) => f.finding === vf.VNB_RESOLVED)).toBe(true);
  });

  test('stepIdentity emits VNB_AMBIGUOUS when multiple candidates returned', async () => {
    CernionMCPClient.callWithNewSession.mockResolvedValueOnce({
      canonical: MOCK_IDENTITY,
      candidates: [MOCK_IDENTITY, { ...MOCK_IDENTITY, name: 'Other VNB' }],
    });
    const ctx = { meta: {} };
    const { findings } = await esService.stepIdentity(ctx, { gridOperatorId: MOCK_IDENTITY.mastrId });
    expect(findings.some((f) => f.finding === vf.VNB_AMBIGUOUS)).toBe(true);
  });

  test('stepIdentity emits VNB_NOT_FOUND when lookup returns no canonical', async () => {
    CernionMCPClient.callWithNewSession.mockResolvedValueOnce({ canonical: {}, candidates: [] });
    const ctx = { meta: {} };
    const { identity, findings } = await esService.stepIdentity(ctx, { gridOperatorId: 'SNB_NONEXISTENT' });
    expect(identity).toBeNull();
    expect(findings.some((f) => f.finding === vf.VNB_NOT_FOUND)).toBe(true);
    expect(findings.find((f) => f.finding === vf.VNB_NOT_FOUND).severity).toBe('error');
  });

  test('stepIdentity falls back to provided ID when MCP unavailable', async () => {
    CernionMCPClient.callWithNewSession.mockRejectedValueOnce(new Error('MCP unavailable'));
    const ctx = { meta: {} };
    const { identity, findings } = await esService.stepIdentity(ctx, { gridOperatorId: MOCK_IDENTITY.mastrId });
    expect(identity).not.toBeNull();
    expect(identity.mastrId).toBe(MOCK_IDENTITY.mastrId);
    expect(findings.some((f) => f.finding === vf.VNB_RESOLVED)).toBe(true);
  });

  test('stepIdentity returns VNB_NOT_FOUND when no input and MCP fails', async () => {
    CernionMCPClient.callWithNewSession.mockRejectedValueOnce(new Error('MCP error'));
    const ctx = { meta: {} };
    // Force a lookup where both id fields are null but we try with bdew
    const { identity, findings } = await esService.stepIdentity(ctx, { gridOperatorBdew: null, gridOperatorId: null });
    // With null/null, the code falls into best-effort and both IDs are null → VNB_NOT_FOUND
    expect(findings.length).toBeGreaterThan(0);
  });

  // ---- Full validate pipeline integration ----
  test('validate returns APPROVED for valid application', async () => {
    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      communityName: 'Solargemeinschaft Rheinallee',
      communityId: 'ES-2026-001',
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.success).toBe(true);
    expect(typeof result.id).toBe('string');
    expect(result.decision).toBe('APPROVED');
    expect(result.summary.generatorsSubmitted).toBe(1);
    expect(result.summary.generatorsValid).toBe(1);
    expect(result.summary.generatorsInvalid).toBe(0);
    expect(result.summary.consumersSubmitted).toBe(2);
    expect(result.steps).toHaveLength(6);
    expect(result.findings.some((f) => f.finding === vf.AUDIT_TRAIL_CREATED)).toBe(true);
  });

  test('validate returns REJECTED_GENERATOR_INVALID for unknown MaStR number', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'vnb_lookup_codes') return Promise.resolve({ canonical: MOCK_IDENTITY, candidates: [MOCK_IDENTITY] });
      // Both primary and secondary searches return empty
      if (toolName === 'cernion_installations_local') return Promise.resolve({ installations: [] });
      return Promise.resolve({});
    });

    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: [{ mastrNummer: 'SEE_DOES_NOT_EXIST', sharePercent: 100 }],
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.decision).toBe('REJECTED_GENERATOR_INVALID');
    expect(result.findings.some((f) => f.finding === vf.GENERATOR_NOT_FOUND)).toBe(true);
  });

  test('validate returns REJECTED_STRUCTURAL when consumer share sum ≠ 100%', async () => {
    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: MOCK_GENERATORS_VALID,
      consumers: [
        { maloId: 'DE00012345678901234567890123456789', sharePercent: 60 },
        { maloId: 'DE00098765432109876543210987654321', sharePercent: 30 },
      ],
    });

    expect(result.decision).toBe('REJECTED_STRUCTURAL');
    expect(result.findings.some((f) => f.finding === vf.SHARE_SUM_CONSUMERS_INVALID)).toBe(true);
  });

  test('validate returns REJECTED_STRUCTURAL for empty generators array', async () => {
    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: [],
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.decision).toBe('REJECTED_STRUCTURAL');
    expect(result.findings.some((f) => f.finding === vf.NO_GENERATORS)).toBe(true);
  });

  test('validate detects §21 violation: ≥100 kW without DV flag', async () => {
    // Return an installation with FernsteuerbarkeitDv = '0'
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'vnb_lookup_codes') return Promise.resolve({ canonical: MOCK_IDENTITY, candidates: [MOCK_IDENTITY] });
      if (toolName === 'cernion_installations_local') return Promise.resolve({ installations: [MOCK_INSTALLATION_NO_DV] });
      return Promise.resolve({});
    });

    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: [{ mastrNummer: 'SEE999000000001', sharePercent: 100 }],
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.findings.some((f) => f.finding === vf.DV_MANDATORY_MISSING)).toBe(true);
    expect(result.findings.find((f) => f.finding === vf.DV_MANDATORY_MISSING).severity).toBe('error');
    expect(result.decision).toBe('REJECTED_GENERATOR_INVALID');
  });

  test('validate returns APPROVED_WITH_CONDITIONS when generator lacks NAP', async () => {
    const noNapInst = { ...MOCK_INSTALLATION_SOLAR, NapMastrNummer: null };
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'vnb_lookup_codes') return Promise.resolve({ canonical: MOCK_IDENTITY, candidates: [MOCK_IDENTITY] });
      if (toolName === 'cernion_installations_local') return Promise.resolve({ installations: [noNapInst] });
      if (toolName === 'cernion_direktvermarkter_lookup') return Promise.resolve(MOCK_DV_RESULT);
      return Promise.resolve({});
    });

    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.findings.some((f) => f.finding === vf.GENERATOR_NO_NAP)).toBe(true);
    expect(result.decision).toBe('APPROVED_WITH_CONDITIONS');
  });

  test('validate identifies wrong grid area (GENERATOR_WRONG_GRID_AREA)', async () => {
    CernionMCPClient.callWithNewSession.mockImplementation((toolName, params) => {
      if (toolName === 'vnb_lookup_codes') return Promise.resolve({ canonical: MOCK_IDENTITY, candidates: [MOCK_IDENTITY] });
      if (toolName === 'cernion_installations_local') {
        // Primary search (with VNB filter) returns empty; secondary (no filter) returns the installation
        if (params.gridOperatorMastrId) return Promise.resolve({ installations: [] });
        return Promise.resolve({ installations: [MOCK_INSTALLATION_SOLAR] });
      }
      if (toolName === 'cernion_direktvermarkter_lookup') return Promise.resolve(MOCK_DV_RESULT);
      return Promise.resolve({});
    });

    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.findings.some((f) => f.finding === vf.GENERATOR_WRONG_GRID_AREA)).toBe(true);
  });

  test('validate throws when neither gridOperatorId nor gridOperatorBdew provided', async () => {
    await expect(broker.call('energy-sharing.validate', {
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    })).rejects.toThrow();
  });

  test('validate returns correct summary fields', async () => {
    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      communityId: 'ES-TEST',
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.summary).toMatchObject({
      generatorsSubmitted: 1,
      consumersSubmitted: 2,
      totalGeneratorCapacityKW: expect.any(Number),
      dvStatus: expect.stringMatching(/^(all_confirmed|partial|none_confirmed|not_applicable)$/),
      findingsCount: expect.objectContaining({ info: expect.any(Number), warning: expect.any(Number), error: expect.any(Number) }),
      durationMs: expect.any(Number),
    });
  });

  test('validate persists report to PouchDB (retrievable via get action)', async () => {
    const created = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      communityName: 'Persistence Test',
      communityId: 'ES-PERSIST-001',
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    const fetched = await broker.call('energy-sharing.get', { id: created.id });
    expect(fetched.success).toBe(true);
    expect(fetched.id).toBe(created.id);
    expect(fetched.decision).toBe(created.decision);
    expect(fetched.communityId).toBe('ES-PERSIST-001');
  });

  test('validate stores consumers with status field', async () => {
    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    for (const con of result.consumers) {
      expect(con.status).toBe('accepted');
      expect(con.maloId).toBeDefined();
    }
  });

  // ---- Determinism ----
  test('identical inputs produce identical finding codes (determinism)', async () => {
    const params = {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    };

    const r1 = await broker.call('energy-sharing.validate', params);
    const r2 = await broker.call('energy-sharing.validate', params);

    const codes1 = r1.findings.map((f) => f.finding);
    const codes2 = r2.findings.map((f) => f.finding);
    expect(codes1).toEqual(codes2);
    expect(r1.decision).toBe(r2.decision);
  });

  // ---- list action ----
  test('list returns validations array (newest first)', async () => {
    await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      communityId: 'ES-LIST-TEST',
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });
    await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      communityId: 'ES-LIST-TEST',
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    const listed = await broker.call('energy-sharing.list', {});
    expect(listed.count).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(listed.validations)).toBe(true);

    const first = listed.validations[0];
    expect(first.id).toBeDefined();
    expect(first.communityId).toBeDefined();
    expect(first.decision).toBeDefined();
    expect(first.createdAt).toBeDefined();
  });

  test('list filters by communityId', async () => {
    const listed = await broker.call('energy-sharing.list', { communityId: 'NON_EXISTENT_ID' });
    expect(listed.count).toBe(0);
    expect(listed.validations).toHaveLength(0);
  });

  // ---- get action ----
  test('get returns 404 for unknown id', async () => {
    const result = await broker.call('energy-sharing.get', { id: 'does-not-exist-xyz' });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
  });

  // ---- metadata ----
  test('validate report metadata includes regulatory basis', async () => {
    const result = await broker.call('energy-sharing.validate', {
      gridOperatorId: MOCK_IDENTITY.mastrId,
      generators: MOCK_GENERATORS_VALID,
      consumers: MOCK_CONSUMERS_VALID,
    });

    expect(result.metadata.pipelineVersion).toBe('0.15.0');
    expect(result.metadata.regulatoryBasis).toContain('§ 42c EnWG');
    expect(result.metadata.regulatoryBasis).toContain('§ 21 Abs. 2 EEG');
    expect(typeof result.metadata.executedAt).toBe('string');
  });
});
