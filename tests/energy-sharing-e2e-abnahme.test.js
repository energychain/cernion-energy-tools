'use strict';

/**
 * E2E Abnahme-Tests — §42c EnWG Energieteilen
 *
 * Fixture: Solarpark Höheinöd (2103.7 kW)
 * Deadline: 01.07.2026
 */

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
const { calculateSettlementReadiness } = require('../src/bilanzkreis-calculator');

// Unique PouchDB paths per test file
const TS = Date.now();
const ES_DB_PATH = path.join(os.tmpdir(), `abnahme-es-${TS}`);
const ALLOC_DB_PATH = path.join(os.tmpdir(), `abnahme-alloc-${TS}`);

process.env.ENERGY_SHARING_DB_PATH = ES_DB_PATH;
process.env.ALLOCATION_ENGINE_DB_PATH = ALLOC_DB_PATH;
process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';

// ---------------------------------------------------------------------------
// Fixtures — Solarpark Höheinöd
// ---------------------------------------------------------------------------
const HOEHEINOED_MASTR = 'SEE999952467552';
const HOEHEINOED_CAPACITY_KW = 2103.7;
const VNB_MASTR_ID = 'SNB961471621746';
const VNB_BDEW = '9907961471621';

const MOCK_IDENTITY = {
  mastrId: VNB_MASTR_ID,
  name: 'Netze Südpfalz GmbH',
  bdew: VNB_BDEW,
  bnr: null,
};

const MOCK_INSTALLATION_HOEHEINOED = {
  EinheitMastrNummer: HOEHEINOED_MASTR,
  einheitBetriebsstatus: 35,
  NettoNennleistung: HOEHEINOED_CAPACITY_KW,
  energietraeger: 'solar',
  FernsteuerbarkeitDv: '1',
  NapMastrNummer: 'NAP-HHN-001',
  MeloMastrNummer: 'MEL-HHN-001',
};

const MOCK_DV_RESULT = {
  data: [
    {
      mastrId: 'DV987654321',
      name: 'Energiedienstleister GmbH',
      portfolioSize: 120,
      totalCapacityKW: 45000,
    },
  ],
};

const CONSUMERS_VALID = [
  { maloId: 'DE0001234567890123456789012345678', sharePercent: 60, name: 'Gemeinde Höheinöd' },
  { maloId: 'DE0009876543210987654321098765432', sharePercent: 40, name: 'Landwirt Müller' },
];

const GENERATORS_VALID = [
  {
    mastrNummer: HOEHEINOED_MASTR,
    sharePercent: 100,
    direktvermarkter: 'Energiedienstleister GmbH',
  },
];

/** Build 96 × 15-min forecast intervals for a single day */
function buildForecastDay(dateStr, peakMW = 0.5) {
  const slots = [];
  for (let i = 0; i < 96; i++) {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    const ts = `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
    // Simple bell-curve: peak at noon
    const factor = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    slots.push({ timestamp: ts, generationMW: +(peakMW * factor).toFixed(4) });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Suite 1 — Validierungs-Pipeline
// ---------------------------------------------------------------------------
describe('Abnahme Suite 1 — Validierungs-Pipeline (Höheinöd)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(require('../services/energy-sharing.service'));
    broker.createService({
      name: 'datapoint',
      actions: {
        createSnapshot: {
          async handler() {
            return { id: 'snap-1', status: 'complete', snapshotHash: 'h1', datapointNames: [] };
          },
        },
        validateSnapshot: {
          async handler() {
            return { id: 'snap-1', consistent: true, drift: [] };
          },
        },
        list: {
          async handler() {
            return { count: 0, datapoints: [] };
          },
        },
        data: {
          async handler() {
            throw new Error('no data');
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
    const db = new PouchDB(ES_DB_PATH);
    await db.destroy().catch(() => {});
  });

  beforeEach(() => {
    CernionMCPClient.callWithNewSession.mockReset();
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'vnb_lookup_codes') {
        return Promise.resolve({ canonical: MOCK_IDENTITY, candidates: [MOCK_IDENTITY] });
      }
      if (toolName === 'cernion_installations_local') {
        return Promise.resolve({ installations: [MOCK_INSTALLATION_HOEHEINOED] });
      }
      if (toolName === 'cernion_direktvermarkter_lookup') {
        return Promise.resolve(MOCK_DV_RESULT);
      }
      return Promise.resolve({});
    });
  });

  test('01 — Validierung ergibt APPROVED für vollständige Gemeinschaft', async () => {
    const result = await broker.call('energy-sharing.validate', {
      communityName: 'Solargemeinschaft Höheinöd',
      communityId: 'ES-HHN-2026-001',
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      gridOperatorBdew: VNB_BDEW,
    });
    // APPROVED or APPROVED_WITH_CONDITIONS are both production-valid outcomes
    expect([vf.ES_APPROVED, vf.ES_APPROVED_WITH_CONDITIONS]).toContain(result.decision);
    expect(result.id).toBeTruthy();
    expect(result.communityId).toBe('ES-HHN-2026-001');
  });

  test('02 — Ergebnis wird in PouchDB persistiert und ist über GET abrufbar', async () => {
    const created = await broker.call('energy-sharing.validate', {
      communityName: 'Solargemeinschaft Höheinöd',
      communityId: 'ES-HHN-2026-002',
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      gridOperatorBdew: VNB_BDEW,
    });
    expect(created.id).toBeTruthy();

    const fetched = await broker.call('energy-sharing.get', { id: created.id });
    expect(fetched.id).toBe(created.id);
    expect([vf.ES_APPROVED, vf.ES_APPROVED_WITH_CONDITIONS]).toContain(fetched.decision);
    expect(fetched.communityName).toBe('Solargemeinschaft Höheinöd');
  });

  test('03 — AUDIT_TRAIL_CREATED Finding ist vorhanden', async () => {
    const result = await broker.call('energy-sharing.validate', {
      communityName: 'Solargemeinschaft Höheinöd',
      communityId: 'ES-HHN-2026-003',
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      gridOperatorBdew: VNB_BDEW,
    });
    const codes = result.findings.map((f) => f.finding);
    expect(codes).toContain(vf.AUDIT_TRAIL_CREATED);
  });

  test('04 — Erzeugeranteile > 100% führen zu REJECTED_STRUCTURAL', async () => {
    const result = await broker.call('energy-sharing.validate', {
      communityName: 'Solargemeinschaft Höheinöd',
      communityId: 'ES-HHN-2026-004',
      generators: [{ mastrNummer: HOEHEINOED_MASTR, sharePercent: 101 }],
      consumers: CONSUMERS_VALID,
      gridOperatorBdew: VNB_BDEW,
    });
    expect([vf.ES_REJECTED_STRUCTURAL, vf.ES_REJECTED_OTHER]).toContain(result.decision);
  });

  test('05 — Ungültige MaLo führt zu Fehler-Finding CONSUMER_MALO_INVALID', async () => {
    const result = await broker.call('energy-sharing.validate', {
      communityName: 'Solargemeinschaft Höheinöd',
      communityId: 'ES-HHN-2026-005',
      generators: GENERATORS_VALID,
      consumers: [{ maloId: 'MALO-UNGUELTIG', sharePercent: 100 }],
      gridOperatorBdew: VNB_BDEW,
    });
    const codes = result.findings.map((f) => f.finding);
    expect(codes).toContain(vf.CONSUMER_MALO_INVALID);
  });

  test('06 — list gibt mindestens die angelegten Validierungen zurück', async () => {
    const list = await broker.call('energy-sharing.list', {});
    expect(list.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(list.validations)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Allokations-Engine
// ---------------------------------------------------------------------------
describe('Abnahme Suite 2 — Allokations-Engine (Höheinöd)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(require('../services/energy-sharing-allocation.service'));
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    const PouchDB = require('pouchdb');
    const PouchDBFind = require('pouchdb-find');
    PouchDB.plugin(PouchDBFind);
    const db = new PouchDB(ALLOC_DB_PATH);
    await db.destroy().catch(() => {});
  });

  beforeEach(() => {
    CernionMCPClient.callWithNewSession.mockReset();
    CernionMCPClient.callWithNewSession.mockImplementation((toolName) => {
      if (toolName === 'mastr_generation_forecast') {
        return Promise.resolve({ data: buildForecastDay('2026-06-01', 0.8) });
      }
      return Promise.resolve({});
    });
  });

  test('07 — Allokation erstellt 96 Intervalle für 1 Tag', async () => {
    const result = await broker.call('energy-sharing-allocation.allocate', {
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-01',
      communityId: 'ES-HHN-2026-001',
      dataSource: 'forecast',
      includeRedispatchDeduction: false,
    });
    expect(result.success).toBe(true);
    expect(result.id).toBeTruthy();
    expect(result.summary.intervalCount).toBe(96);
  });

  test('08 — Summe Verbraucher-kWh ≤ Gesamt-Erzeugung (Mengenerhaltung)', async () => {
    const result = await broker.call('energy-sharing-allocation.allocate', {
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-01',
      communityId: 'ES-HHN-2026-001',
      dataSource: 'forecast',
      includeRedispatchDeduction: false,
    });
    const consumerTotal = result.consumers.reduce((s, c) => s + c.totalKWh, 0);
    expect(consumerTotal).toBeLessThanOrEqual(result.summary.totalNetGenerationKWh * 1.001);
  });

  test('09 — Anteile 60/40 korrekt aufgeteilt', async () => {
    const result = await broker.call('energy-sharing-allocation.allocate', {
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-01',
      communityId: 'ES-HHN-2026-001',
      dataSource: 'forecast',
      includeRedispatchDeduction: false,
    });
    const c60 = result.consumers.find((c) => c.maloId === 'DE0001234567890123456789012345678');
    const c40 = result.consumers.find((c) => c.maloId === 'DE0009876543210987654321098765432');
    expect(c60).toBeDefined();
    expect(c40).toBeDefined();
    if (c60.totalKWh > 0 && c40.totalKWh > 0) {
      const ratio = c60.totalKWh / c40.totalKWh;
      expect(ratio).toBeCloseTo(1.5, 1); // 60/40 = 1.5
    }
  });

  test('10 — CSV-Download liefert text/csv mit Header-Zeile', async () => {
    const alloc = await broker.call('energy-sharing-allocation.allocate', {
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-01',
      communityId: 'ES-HHN-2026-001',
      dataSource: 'forecast',
      includeRedispatchDeduction: false,
    });

    const maloId = CONSUMERS_VALID[0].maloId;
    const csvResult = await broker.call('energy-sharing-allocation.download', {
      id: alloc.id,
      maloId,
    });
    expect(typeof csvResult).toBe('string');
    expect(csvResult).toMatch(/timestamp/i);
  });

  test('11 — Soft-Delete setzt _deleted Flag, list zeigt Eintrag nicht mehr', async () => {
    const alloc = await broker.call('energy-sharing-allocation.allocate', {
      generators: GENERATORS_VALID,
      consumers: CONSUMERS_VALID,
      dateFrom: '2026-06-02',
      dateTo: '2026-06-02',
      communityId: 'ES-HHN-DEL-001',
      dataSource: 'forecast',
      includeRedispatchDeduction: false,
    });

    await broker.call('energy-sharing-allocation.remove', { id: alloc.id });

    const list = await broker.call('energy-sharing-allocation.list', {
      communityId: 'ES-HHN-DEL-001',
    });
    const ids = (list.allocations || []).map((a) => a.id);
    expect(ids).not.toContain(alloc.id);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Settlement-Readiness KPIs (§42c-Felder)
// ---------------------------------------------------------------------------
describe('Abnahme Suite 3 — Settlement-Readiness KPIs (§42c)', () => {
  const ENERGY_SHARING_BK = { type: 'virtual_energy_sharing', id: 'BK-HHN-001' };
  const REAL_BK = { type: 'real', id: 'BK-REAL-001' };

  test('12 — ready:true + PARAGRAF_42C_KONFORM:true + A96_FAEHIG:true für vollständige Daten', () => {
    const result = calculateSettlementReadiness(
      {
        participants: [
          { meloId: 'MEL001', hasData: true, dataQuality: 0.98, gapHours: 0, msconsComplete: true },
          { meloId: 'MEL002', hasData: true, dataQuality: 0.97, gapHours: 0, msconsComplete: true },
        ],
      },
      ENERGY_SHARING_BK
    );

    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.PARAGRAF_42C_KONFORM).toBe(true);
    expect(result.A96_FAEHIG).toBe(true);
  });

  test('13 — missing_data → PARAGRAF_42C_KONFORM:false, A96_FAEHIG:false', () => {
    const result = calculateSettlementReadiness(
      {
        participants: [
          { meloId: 'MEL001', hasData: false, dataQuality: 0, gapHours: 0, msconsComplete: true },
        ],
      },
      ENERGY_SHARING_BK
    );

    expect(result.ready).toBe(false);
    expect(result.PARAGRAF_42C_KONFORM).toBe(false);
    expect(result.A96_FAEHIG).toBe(false);
  });

  test('14 — low_data_quality → PARAGRAF_42C_KONFORM:true, A96_FAEHIG:false', () => {
    const result = calculateSettlementReadiness(
      {
        participants: [
          { meloId: 'MEL001', hasData: true, dataQuality: 0.9, gapHours: 0, msconsComplete: true },
        ],
      },
      ENERGY_SHARING_BK
    );

    expect(result.ready).toBe(false);
    expect(result.PARAGRAF_42C_KONFORM).toBe(true); // data present, §42c kann geprüft werden
    expect(result.A96_FAEHIG).toBe(false); // Qualität zu niedrig für A96
  });

  test('15 — large_gaps blockiert ready, aber nicht §42c KPIs', () => {
    const result = calculateSettlementReadiness(
      {
        participants: [
          { meloId: 'MEL001', hasData: true, dataQuality: 0.97, gapHours: 3, msconsComplete: true },
        ],
      },
      ENERGY_SHARING_BK
    );

    expect(result.ready).toBe(false);
    expect(result.PARAGRAF_42C_KONFORM).toBe(true);
    expect(result.A96_FAEHIG).toBe(true);
  });

  test('16 — mscons_incomplete → A96_FAEHIG:false', () => {
    const result = calculateSettlementReadiness(
      {
        participants: [
          {
            meloId: 'MEL001',
            hasData: true,
            dataQuality: 0.98,
            gapHours: 0,
            msconsComplete: false,
          },
        ],
      },
      ENERGY_SHARING_BK
    );

    expect(result.A96_FAEHIG).toBe(false);
    expect(result.PARAGRAF_42C_KONFORM).toBe(true);
  });

  test('17 — Nicht-Energieteilen-BK enthält keine §42c KPIs', () => {
    const result = calculateSettlementReadiness(
      {
        participants: [
          { meloId: 'MEL001', hasData: true, dataQuality: 0.99, gapHours: 0, msconsComplete: true },
        ],
      },
      REAL_BK
    );

    expect(result.ready).toBe(true);
    expect(result.PARAGRAF_42C_KONFORM).toBeUndefined();
    expect(result.A96_FAEHIG).toBeUndefined();
  });

  test('18 — Kein bilanzkreis-Argument: §42c KPIs nicht vorhanden (Rückwärtskompatibilität)', () => {
    const result = calculateSettlementReadiness({
      participants: [
        { meloId: 'MEL001', hasData: true, dataQuality: 0.99, gapHours: 0, msconsComplete: true },
      ],
    });

    expect(result.ready).toBe(true);
    expect(result.PARAGRAF_42C_KONFORM).toBeUndefined();
    expect(result.A96_FAEHIG).toBeUndefined();
  });
});
