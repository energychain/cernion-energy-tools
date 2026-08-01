/**
 * NBP Monitor Service Tests
 *
 * Covers:
 * - Snapshot structure and schema version
 * - Age class assignment (boundary values)
 * - KPI 2 formula correctness for each technology
 * - KPI 3 heuristic (6-week and 52-week boundaries)
 * - Parameter save / reset
 * - Cache invalidation on parameter change
 * - Empty installation list (graceful zero values)
 */

'use strict';

const { ServiceBroker } = require('moleculer');
const os = require('os');
const path = require('path');

const NbpMonitorService = require('../services/nbp-monitor.service');
const ObjectStoreService = require('../services/object-store.service');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Builds an installation fixture with the given age offset in days */
function makeInst(type, kWp, ageDays = 0, plz = '67059') {
  const lastUpdate = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  return {
    Einheittyp: type, // PV / Wind / Speicher / Sonstige
    Nettonennleistung: kWp,
    DatumLetzteAktualisierung: lastUpdate,
    Postleitzahl: plz,
  };
}

// ── Broker + mocks ─────────────────────────────────────────────────────────

describe('nbp-monitor.service', () => {
  let broker;
  let assetsHandler; // replaced per-test to inject custom installations

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    // Mock assets service — handler replaced per test
    broker.createService({
      name: 'assets',
      actions: {
        all: {
          handler(ctx) {
            return assetsHandler ? assetsHandler(ctx) : [];
          },
        },
      },
    });

    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: path.join(os.tmpdir(), `nbp-test-os-${Date.now()}`),
      },
    });

    broker.createService({
      ...NbpMonitorService,
      settings: {
        ...NbpMonitorService.settings,
        cacheTtlSeconds: 3600,
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    // Reset handler and clear service cache before each test
    assetsHandler = null;
    const svc = broker.getLocalService('nbp-monitor');
    if (svc && svc.cache) svc.cache.clear();
  });

  // ── Snapshot structure ─────────────────────────────────────────────────

  describe('snapshot — structure', () => {
    it('should have correct schema version', async () => {
      const result = await broker.call('nbp-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });
      expect(result.schemaVersion).toBe('1.0');
    });

    it('should echo bdewCode', async () => {
      const result = await broker.call('nbp-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });
      expect(result.bdewCode).toBe('10002954');
    });

    it('should have all required top-level keys', async () => {
      const result = await broker.call('nbp-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });
      for (const key of [
        'schemaVersion',
        'bdewCode',
        'timestamp',
        'cachedAt',
        'ttlSeconds',
        'summary',
        'kpi1_volume',
        'kpi2_risk',
        'kpi3_process',
        'byType',
        'byPLZ',
        'filters',
      ]) {
        expect(result).toHaveProperty(key);
      }
    });

    it('should have valid ISO timestamps', async () => {
      const result = await broker.call('nbp-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.cachedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should return cached result on second call', async () => {
      let callCount = 0;
      assetsHandler = () => {
        callCount++;
        return [];
      };
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'X1', refresh: true });
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'X1', refresh: false });
      expect(callCount).toBe(1);
    });

    it('should bypass cache when refresh=true', async () => {
      let callCount = 0;
      assetsHandler = () => {
        callCount++;
        return [];
      };
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'X2', refresh: true });
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'X2', refresh: true });
      expect(callCount).toBe(2);
    });

    it('should isolate cached snapshots by tenant', async () => {
      let callCount = 0;
      assetsHandler = () => {
        callCount++;
        return [];
      };

      await broker.call(
        'nbp-monitor.snapshot',
        { bdewCode: 'TEN1', refresh: true },
        { meta: { tenantId: 'stadtwerk-a' } }
      );
      await broker.call(
        'nbp-monitor.snapshot',
        { bdewCode: 'TEN1', refresh: false },
        { meta: { tenantId: 'stadtwerk-a' } }
      );
      await broker.call(
        'nbp-monitor.snapshot',
        { bdewCode: 'TEN1', refresh: false },
        { meta: { tenantId: 'stadtwerk-b' } }
      );

      expect(callCount).toBe(2);
    });

    it('should return empty-safe snapshot when assets.all returns no rows', async () => {
      assetsHandler = () => [];
      const result = await broker.call('nbp-monitor.snapshot', {
        bdewCode: '00000000',
        refresh: true,
      });
      expect(result.summary.totalOpenCount).toBe(0);
      expect(result.kpi1_volume.totalKWp).toBe(0);
      expect(result.kpi2_risk.totalRiskEur).toBe(0);
      expect(result.kpi3_process.totalOpen).toBe(0);
    });

    it('should survive when assets.all throws', async () => {
      assetsHandler = () => {
        throw new Error('MaStR offline');
      };
      const result = await broker.call('nbp-monitor.snapshot', { bdewCode: 'ERR1', refresh: true });
      expect(result.summary.totalOpenCount).toBe(0);
    });

    it('should pass bdewCode and netzbetreiberPruefungStatus to assets.all', async () => {
      let capturedParams;
      assetsHandler = (ctx) => {
        capturedParams = { ...ctx.params };
        return [];
      };
      await broker.call('nbp-monitor.snapshot', { bdewCode: '10002954', refresh: true });
      expect(capturedParams.bdewCode).toBe('10002954');
      expect(capturedParams.netzbetreiberPruefungStatus).toBe('2955');
    });
  });

  // ── KPI 1: age class assignment ────────────────────────────────────────

  describe('KPI 1 — age class boundaries', () => {
    it('should assign class A for installations updated < 1 year ago', async () => {
      assetsHandler = () => [makeInst('PV', 10, 364)]; // 364 days < 1 year
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC1', refresh: true });
      const cls = r.kpi1_volume.byAgeClass.find((c) => c.class === 'A');
      expect(cls.count).toBe(1);
    });

    it('should assign class B for installations 1–3 years old (boundary: 365 days)', async () => {
      assetsHandler = () => [makeInst('PV', 10, 365)]; // exactly 1 year
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC2', refresh: true });
      const cls = r.kpi1_volume.byAgeClass.find((c) => c.class === 'B');
      expect(cls.count).toBe(1);
    });

    it('should assign class C for installations 3–5 years old (boundary: 3*365 days)', async () => {
      assetsHandler = () => [makeInst('Wind', 100, 3 * 365)];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC3', refresh: true });
      const cls = r.kpi1_volume.byAgeClass.find((c) => c.class === 'C');
      expect(cls.count).toBe(1);
    });

    it('should assign class D for installations > 5 years old', async () => {
      assetsHandler = () => [makeInst('Speicher', 50, 5 * 365 + 1)];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC4', refresh: true });
      const cls = r.kpi1_volume.byAgeClass.find((c) => c.class === 'D');
      expect(cls.count).toBe(1);
    });

    it('should default to class A when date is absent', async () => {
      assetsHandler = () => [{ Einheittyp: 'PV', Nettonennleistung: 5 }];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC5', refresh: true });
      const cls = r.kpi1_volume.byAgeClass.find((c) => c.class === 'A');
      expect(cls.count).toBe(1);
    });

    it('should parse fallback date field "Datum Netzzugang"', async () => {
      assetsHandler = () => [
        { Einheittyp: 'PV', Nettonennleistung: 5, 'Datum Netzzugang': '2020-01-15' },
      ];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC5B', refresh: true });
      expect(r.summary.oldestTicketDays).toBeGreaterThan(0);
      const clsA = r.kpi1_volume.byAgeClass.find((c) => c.class === 'A');
      expect(clsA.count).toBe(0);
    });

    it('should parse German DD.MM.YYYY date format', async () => {
      assetsHandler = () => [
        {
          Einheittyp: 'PV',
          Nettonennleistung: 5,
          DatumLetzteAktualisierung: '31.01.2019 00:00:00',
        },
      ];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC5C', refresh: true });
      expect(r.summary.oldestTicketDays).toBeGreaterThan(0);
      const clsD = r.kpi1_volume.byAgeClass.find((c) => c.class === 'D');
      expect(clsD.count).toBe(1);
    });

    it('should use Anlagentyp as fallback when Einheittyp absent (assets service format)', async () => {
      assetsHandler = () => [{ Anlagentyp: 'solar', 'Leistung MW': 0.01 }]; // 10 kWp
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AC6', refresh: true });
      const pvType = r.byType.PV;
      expect(pvType.count).toBe(1);
      expect(pvType.kWp).toBe(10);
    });

    it('should compute alertLevel green for small total', async () => {
      assetsHandler = () => [makeInst('PV', 1000, 30)]; // 1 MWp → well below 50 MW
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AL1', refresh: true });
      expect(r.kpi1_volume.alertLevel).toBe('green');
    });

    it('should compute alertLevel yellow when total > 50 MW', async () => {
      // 60,000 kWp = 60 MW → yellow (50 MW < 60 MW < 150 MW)
      assetsHandler = () => [makeInst('PV', 60_000, 30)];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AL2', refresh: true });
      expect(r.kpi1_volume.alertLevel).toBe('yellow');
    });

    it('should compute alertLevel red when total > 150 MW', async () => {
      assetsHandler = () => [makeInst('PV', 160_000, 30)]; // 160 MW
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'AL3', refresh: true });
      expect(r.kpi1_volume.alertLevel).toBe('red');
    });
  });

  // ── KPI 2: risk formula ────────────────────────────────────────────────

  describe('KPI 2 — risk formula per technology', () => {
    const DEFAULT_PARAMS = {
      PV: { volllaststunden: 950, einspeiseverguetung_ctKWh: 8.2 },
      Wind: { volllaststunden: 1800, einspeiseverguetung_ctKWh: 6.5 },
      Speicher: { volllaststunden: 500, einspeiseverguetung_ctKWh: 8.2 },
      Sonstige: { volllaststunden: 800, einspeiseverguetung_ctKWh: 8.0 },
    };

    // formula: kWp × volllaststunden × ctKWh × midpointYears / 1000
    function expectedRisk(type, kWp, ageClass) {
      const midpoints = { A: 0.5, B: 2.0, C: 4.0, D: 6.5 };
      const p = DEFAULT_PARAMS[type];
      return Math.round(
        (kWp * p.volllaststunden * p.einspeiseverguetung_ctKWh * midpoints[ageClass]) / 1000
      );
    }

    ['PV', 'Wind', 'Speicher', 'Sonstige'].forEach((type) => {
      ['A', 'B', 'C', 'D'].forEach((cls) => {
        const ageDays = { A: 30, B: 2 * 365, C: 4 * 365, D: 6 * 365 };
        it(`should compute correct risk for ${type} in class ${cls}`, async () => {
          assetsHandler = () => [makeInst(type, 100, ageDays[cls])];
          const r = await broker.call('nbp-monitor.snapshot', {
            bdewCode: `R_${type}_${cls}`,
            refresh: true,
          });
          const byAgeCls = r.kpi2_risk.byAgeClass.find((c) => c.class === cls);
          expect(byAgeCls.riskEur).toBe(expectedRisk(type, 100, cls));
          expect(r.kpi2_risk.totalRiskEur).toBe(expectedRisk(type, 100, cls));
        });
      });
    });

    it('should include disclaimer in kpi2_risk', async () => {
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'DISC1', refresh: true });
      expect(r.kpi2_risk.disclaimer).toBeTruthy();
    });

    it('should update risk when custom parameters are used', async () => {
      // Set doubled volllaststunden for PV
      await broker.call('nbp-monitor.setParameters', {
        parameters: {
          PV: { volllaststunden: 1900, einspeiseverguetung_ctKWh: 8.2 },
          Wind: { volllaststunden: 1800, einspeiseverguetung_ctKWh: 6.5 },
          Speicher: { volllaststunden: 500, einspeiseverguetung_ctKWh: 8.2 },
          Sonstige: { volllaststunden: 800, einspeiseverguetung_ctKWh: 8.0 },
        },
      });
      assetsHandler = () => [makeInst('PV', 100, 30)]; // class A
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'CUSTOM1', refresh: true });
      // expected: 100 × 1900 × 8.2 × 0.5 / 1000 = 779
      expect(r.kpi2_risk.totalRiskEur).toBe(Math.round((100 * 1900 * 8.2 * 0.5) / 1000));
      await broker.call('nbp-monitor.resetParameters');
    });
  });

  // ── KPI 3: process heuristic ───────────────────────────────────────────

  describe('KPI 3 — process heuristic', () => {
    it('should classify as inBearbeitung when last update < 6 weeks ago', async () => {
      assetsHandler = () => [makeInst('PV', 10, 30)]; // 30 days < 42 days (6 weeks)
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3A', refresh: true });
      expect(r.kpi3_process.inBearbeitung).toBe(1);
      expect(r.kpi3_process.vnbSeitig).toBe(0);
      expect(r.kpi3_process.altlast).toBe(0);
    });

    it('should classify as vnbSeitig when last update > 6 weeks and < 52 weeks ago', async () => {
      assetsHandler = () => [makeInst('PV', 10, 50)]; // 50 days > 42 days, < 364 days
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3B', refresh: true });
      expect(r.kpi3_process.vnbSeitig).toBe(1);
    });

    it('should classify as altlast when last update > 52 weeks ago', async () => {
      assetsHandler = () => [makeInst('PV', 10, 52 * 7 + 1)]; // > 364 days
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3C', refresh: true });
      expect(r.kpi3_process.altlast).toBe(1);
    });

    it('should classify as inBearbeitung when date is absent', async () => {
      assetsHandler = () => [{ Einheittyp: 'PV', Nettonennleistung: 5 }];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3D', refresh: true });
      expect(r.kpi3_process.inBearbeitung).toBe(1);
    });

    it('should classify as inBearbeitung at exactly the 6-week boundary (42 days, not strictly over)', async () => {
      // makeInst uses Date.now() internally; by the time computeKpi3 runs a few
      // ms have elapsed, making ageMs > vnbSeitigMs when using an exact integer
      // day count.  Subtract 60 s so the age stays safely inside the threshold
      // regardless of test-runner speed.
      assetsHandler = () => [
        {
          ...makeInst('PV', 10, 41),
          DatumLetzteAktualisierung: new Date(Date.now() - 42 * 86_400_000 + 60_000).toISOString(),
        },
      ]; // 42 days ago + 60 s buffer → NOT > 42 days → inBearbeitung
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3E', refresh: true });
      expect(r.kpi3_process.inBearbeitung).toBe(1);
      expect(r.kpi3_process.vnbSeitig).toBe(0);
    });

    it('should classify as vnbSeitig when last update is 43 days ago (> 6 weeks)', async () => {
      assetsHandler = () => [makeInst('PV', 10, 43)]; // 43 days > 42 days (6 weeks)
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3E2', refresh: true });
      expect(r.kpi3_process.vnbSeitig).toBe(1);
    });

    it('should compute percentage totals summing to ~100', async () => {
      assetsHandler = () => [
        makeInst('PV', 10, 20), // inBearbeitung
        makeInst('PV', 10, 50), // vnbSeitig
        makeInst('PV', 10, 400), // altlast
      ];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3F', refresh: true });
      const sum =
        r.kpi3_process.vnbSeitigPercent +
        r.kpi3_process.inBearbeitungPercent +
        r.kpi3_process.altlastPercent;
      expect(Math.round(sum)).toBe(100);
    });

    it('should include disclaimer in kpi3_process', async () => {
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'K3G', refresh: true });
      expect(r.kpi3_process.disclaimer).toBeTruthy();
    });
  });

  // ── Parameter management ───────────────────────────────────────────────

  describe('getParameters action', () => {
    it('should return source and parameters keys', async () => {
      const r = await broker.call('nbp-monitor.getParameters');
      expect(r).toHaveProperty('source');
      expect(r).toHaveProperty('parameters');
    });

    it('should return defaults when no entry in store', async () => {
      await broker.call('nbp-monitor.resetParameters');
      const r = await broker.call('nbp-monitor.getParameters');
      expect(r.source).toBe('defaults');
      expect(r.parameters.PV).toBeDefined();
    });
  });

  describe('setParameters action', () => {
    const validParams = {
      PV: { volllaststunden: 1000, einspeiseverguetung_ctKWh: 9.0 },
      Wind: { volllaststunden: 2000, einspeiseverguetung_ctKWh: 7.0 },
      Speicher: { volllaststunden: 600, einspeiseverguetung_ctKWh: 9.0 },
      Sonstige: { volllaststunden: 900, einspeiseverguetung_ctKWh: 8.5 },
    };

    it('should persist parameters to object store', async () => {
      await broker.call('nbp-monitor.setParameters', { parameters: validParams });
      const stored = await broker.call('object-store.get', {
        namespace: 'nbp_monitor',
        key: 'parameters',
      });
      expect(stored).toBeDefined();
      expect(stored.payload).toMatchObject({ PV: expect.any(Object) });
    });

    it('should persist parameters in tenant-specific namespace', async () => {
      await broker.call(
        'nbp-monitor.setParameters',
        { parameters: validParams },
        { meta: { tenantId: 'stadtwerk-a' } }
      );
      const stored = await broker.call('object-store.get', {
        namespace: 'tenant:stadtwerk-a:nbp_monitor',
        key: 'parameters',
      });
      expect(stored.payload.PV.volllaststunden).toBe(1000);
    });

    it('should return success true', async () => {
      const r = await broker.call('nbp-monitor.setParameters', { parameters: validParams });
      expect(r.success).toBe(true);
    });

    it('should invalidate snapshot cache on parameter change', async () => {
      let callCount = 0;
      assetsHandler = () => {
        callCount++;
        return [];
      };
      // Prime the cache
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'CACHE1', refresh: true });
      expect(callCount).toBe(1);
      // Set parameters → should invalidate
      await broker.call('nbp-monitor.setParameters', { parameters: validParams });
      // Next snapshot call should hit assets again
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'CACHE1', refresh: false });
      expect(callCount).toBe(2);
    });

    it('should keep parameter reads isolated per tenant', async () => {
      await broker.call(
        'nbp-monitor.setParameters',
        { parameters: validParams },
        { meta: { tenantId: 'stadtwerk-a' } }
      );

      const tenantA = await broker.call(
        'nbp-monitor.getParameters',
        {},
        { meta: { tenantId: 'stadtwerk-a' } }
      );
      const tenantB = await broker.call(
        'nbp-monitor.getParameters',
        {},
        { meta: { tenantId: 'stadtwerk-b' } }
      );

      expect(tenantA.source).toBe('store');
      expect(tenantA.parameters.PV.volllaststunden).toBe(1000);
      expect(tenantB.source).toBe('defaults');
      expect(tenantB.parameters.PV.volllaststunden).toBe(950);
    });

    it('should reject missing technology entry', async () => {
      const bad = { PV: { volllaststunden: 100, einspeiseverguetung_ctKWh: 1 } }; // missing Wind etc.
      await expect(broker.call('nbp-monitor.setParameters', { parameters: bad })).rejects.toThrow();
    });

    it('should reject non-positive volllaststunden', async () => {
      const bad = {
        ...validParams,
        PV: { volllaststunden: 0, einspeiseverguetung_ctKWh: 8.2 },
      };
      await expect(broker.call('nbp-monitor.setParameters', { parameters: bad })).rejects.toThrow();
    });
  });

  describe('resetParameters action', () => {
    it('should remove parameters from object store', async () => {
      await broker.call('nbp-monitor.setParameters', {
        parameters: {
          PV: { volllaststunden: 999, einspeiseverguetung_ctKWh: 9 },
          Wind: { volllaststunden: 999, einspeiseverguetung_ctKWh: 9 },
          Speicher: { volllaststunden: 999, einspeiseverguetung_ctKWh: 9 },
          Sonstige: { volllaststunden: 999, einspeiseverguetung_ctKWh: 9 },
        },
      });
      const stored = await broker.call('object-store.get', {
        namespace: 'nbp_monitor',
        key: 'parameters',
      });
      expect(stored).toBeDefined();
      await broker.call('nbp-monitor.resetParameters');
      await expect(
        broker.call('object-store.get', { namespace: 'nbp_monitor', key: 'parameters' })
      ).rejects.toThrow();
    });

    it('should return success true', async () => {
      const r = await broker.call('nbp-monitor.resetParameters');
      expect(r.success).toBe(true);
    });

    it('should restore default parameters after reset', async () => {
      await broker.call('nbp-monitor.resetParameters');
      const r = await broker.call('nbp-monitor.getParameters');
      expect(r.parameters.PV.volllaststunden).toBe(950);
      expect(r.parameters.Wind.volllaststunden).toBe(1800);
    });

    it('should invalidate cache on reset', async () => {
      let callCount = 0;
      assetsHandler = () => {
        callCount++;
        return [];
      };
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'CACHE2', refresh: true });
      expect(callCount).toBe(1);
      await broker.call('nbp-monitor.resetParameters');
      await broker.call('nbp-monitor.snapshot', { bdewCode: 'CACHE2', refresh: false });
      expect(callCount).toBe(2);
    });

    it('should succeed even when no entry in store', async () => {
      await broker.call('nbp-monitor.resetParameters'); // ensure clean state
      const r = await broker.call('nbp-monitor.resetParameters');
      expect(r.success).toBe(true);
    });
  });

  // ── byPLZ aggregation ──────────────────────────────────────────────────

  describe('byPLZ aggregation', () => {
    it('should aggregate kWp by PLZ', async () => {
      assetsHandler = () => [
        makeInst('PV', 100, 30, '67059'),
        makeInst('Wind', 200, 30, '67059'),
        makeInst('PV', 50, 30, '67061'),
      ];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'PLZ1', refresh: true });
      const plz59 = r.byPLZ.find((p) => p.plz === '67059');
      expect(plz59).toBeDefined();
      expect(plz59.count).toBe(2);
      expect(plz59.kWp).toBe(300);
    });

    it('should skip installations without PLZ', async () => {
      assetsHandler = () => [makeInst('PV', 10, 30, ''), makeInst('PV', 10, 30, '67060')];
      const r = await broker.call('nbp-monitor.snapshot', { bdewCode: 'PLZ2', refresh: true });
      expect(r.byPLZ.length).toBe(1);
      expect(r.byPLZ[0].plz).toBe('67060');
    });
  });

  // ── REST endpoint declarations (OpenAPI audit) ─────────────────────────

  describe('REST and OpenAPI declarations', () => {
    it('should have rest property on all actions', () => {
      for (const [name, action] of Object.entries(NbpMonitorService.actions)) {
        expect(action.rest).toBeTruthy();

        const _ = name; // suppress lint
      }
    });

    it('should have openapi property on all actions', () => {
      for (const [name, action] of Object.entries(NbpMonitorService.actions)) {
        expect(action.openapi).toBeTruthy();

        const _ = name;
      }
    });

    it('should have requestBody on setParameters (PUT)', () => {
      expect(NbpMonitorService.actions.setParameters.openapi.requestBody).toBeDefined();
    });
  });
});
