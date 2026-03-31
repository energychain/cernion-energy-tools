'use strict';

/**
 * Dashboard API Service Tests
 *
 * Covers:
 * - vnbOverview: happy path, partial failure (graceful degradation), cache hit
 * - marketSnapshot: happy path, all upstream services down, cache hit
 * - qualitySummary: happy path, empty reports, partial failure
 * - findingCodes: structure, count, dual-language descriptions, cache
 * - safeCall: error isolation and _errors array population
 * - Response shape validation
 */

const { ServiceBroker } = require('moleculer');

const DashboardApiService = require('../services/dashboard-api.service');
const { FINDING_CODE_METADATA } = require('../src/validation-findings');

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_VNB_IDENTITY = {
  results: [{
    name:    'TWL Netze GmbH',
    mastrId: 'SNB935578300972',
    bdew:    '9907473000008',
    bnr:     '10002345',
  }],
};

const MOCK_VNB_MONITOR = {
  identity: { name: 'TWL Netze GmbH', mastrId: 'SNB935578300972', bdewCode: '9907473000008' },
  // Real structure from vnb-monitor.service.js fetchMastrData / fetchEwkData
  mastr: {
    inBetrieb: {
      anlagenCount:    312,
      leistungMW:      '145.2',
      pvAnlagen:       180,
      windAnlagen:     90,
      speicherAnlagen: 42,
    },
    inPlanung:              { anlagenCount: 20, leistungMW: '15.0' },
    netzbetreiberPruefung:  { anlagenCount: 5,  leistungMW: '3.2'  },
  },
  ewk: {
    anschlussdauer:      { eeNS_weeks: 35, eeNS_phase1_weeks: 12, eeNS_phase2_weeks: 23, verbrauchNS_weeks: 28 },
    umsetzungsquote:     { eeNS_percent: 100, verbrauchNS_percent: 95 },
    digitalisierungsindex: { gesamt_percent: 58, smartGrids_percent: 72 },
  },
  alerts:       [{ id: 'A1', severity: 'warning', message: 'Test alert' }],
  alertSummary: { total: 1, critical: 0, warning: 1, info: 0, ewkRelevant: 0 },
};

const MOCK_HEALTH = {
  overview: { healthy: 5, stale: 1, errored: 0 },
};

const MOCK_MQ_AUDITS = {
  count: 1,
  audits: [{
    id: 'mq-001',
    createdAt: '2026-03-31T10:00:00Z',
    qualityScore: 78,
    findingsCount: { info: 12, warning: 18, error: 5 },
  }],
};

const MOCK_GC_VALIDATIONS = {
  count: 1,
  validations: [{
    id: 'gc-001',
    createdAt: '2026-03-30T14:00:00Z',
    decision: 'GO_CONDITIONAL',
    findingsCount: { info: 4, warning: 7, error: 1 },
  }],
};

const MOCK_ES_VALIDATIONS = {
  count: 0,
  validations: [],
};

const MOCK_RD_AUDITS = {
  count: 1,
  audits: [{
    id: 'rd-001',
    createdAt: '2026-03-29T08:00:00Z',
    settlementReadiness: { readinessPercent: 88.1 },
    riskAssessment: { level: 'medium' },
    findingsCount: { info: 3, warning: 8, error: 2 },
  }],
};

const MOCK_PRICES = {
  prices: [
    { price: 40.0, timestamp: '2026-03-31T00:00:00Z' },
    { price: 45.2, timestamp: '2026-03-31T12:00:00Z' },
    { price: 50.1, timestamp: '2026-03-31T13:00:00Z' },
  ],
};

const MOCK_CO2 = {
  current: 380,
  avgToday: 364.5,
  location: 'Deutschland',
};

const MOCK_FORECAST = {
  solar: [
    { value: 28000, timestamp: '2026-03-31T12:00:00Z' },
    { value: 32500, timestamp: '2026-03-31T13:00:00Z' },
  ],
  wind: [
    { value: 15000, timestamp: '2026-03-31T06:00:00Z' },
    { value: 18200, timestamp: '2026-03-31T09:00:00Z' },
  ],
};

const MOCK_SPOT = {
  data: [{ value: 44.0 }, { value: 46.5 }],
};

// ── Broker setup ─────────────────────────────────────────────────────────

describe('dashboard-api.service', () => {
  let broker;

  // Per-test overrideable handlers
  let handlers = {};

  function makeHandler(name, defaultValue) {
    return {
      handler(ctx) {
        if (handlers[name]) return handlers[name](ctx);
        if (defaultValue instanceof Error) throw defaultValue;
        return defaultValue;
      },
    };
  }

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    // Mock grid-operations
    broker.createService({
      name: 'grid-operations',
      actions: {
        vnbLookupCodes: makeHandler('vnbLookupCodes', MOCK_VNB_IDENTITY),
      },
    });

    // Mock vnb-monitor
    broker.createService({
      name: 'vnb-monitor',
      actions: {
        snapshot: makeHandler('vnbMonitorSnapshot', MOCK_VNB_MONITOR),
      },
    });

    // Mock datapoint
    broker.createService({
      name: 'datapoint',
      actions: {
        health: makeHandler('datapointHealth', MOCK_HEALTH),
      },
    });

    // Mock mastr-quality
    broker.createService({
      name: 'mastr-quality',
      actions: {
        list: makeHandler('mqList', MOCK_MQ_AUDITS),
      },
    });

    // Mock grid-connection
    broker.createService({
      name: 'grid-connection',
      actions: {
        list: makeHandler('gcList', MOCK_GC_VALIDATIONS),
      },
    });

    // Mock energy-sharing
    broker.createService({
      name: 'energy-sharing',
      actions: {
        list: makeHandler('esList', MOCK_ES_VALIDATIONS),
      },
    });

    // Mock redispatch-expost
    broker.createService({
      name: 'redispatch-expost',
      actions: {
        list: makeHandler('rdList', MOCK_RD_AUDITS),
      },
    });

    // Mock energy-sharing-allocation
    broker.createService({
      name: 'energy-sharing-allocation',
      actions: {
        list: makeHandler('allocList', { count: 0, allocations: [] }),
      },
    });

    // Mock energy-market
    broker.createService({
      name: 'energy-market',
      actions: {
        prices:       makeHandler('emPrices', MOCK_PRICES),
        co2Intensity: makeHandler('emCo2', MOCK_CO2),
      },
    });

    // Mock entsoe
    broker.createService({
      name: 'entsoe',
      actions: {
        windSolarForecast: makeHandler('entsoeforecast', MOCK_FORECAST),
      },
    });

    // Mock german-grid
    broker.createService({
      name: 'german-grid',
      actions: {
        spotprices: makeHandler('germangrid', MOCK_SPOT),
      },
    });

    broker.createService(DashboardApiService);

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    // Reset handler overrides and cache before each test
    handlers = {};
    const svc = broker.getLocalService('dashboard-api');
    if (svc && svc.cache)    svc.cache.clear();
    if (svc && svc.inflight) svc.inflight.clear();
  });

  // ── vnbOverview ────────────────────────────────────────────────────────────

  describe('vnbOverview', () => {
    it('returns aggregated response for a valid bdewCode', async () => {
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });

      expect(result).toHaveProperty('identity');
      expect(result).toHaveProperty('kpis');
      expect(result).toHaveProperty('latestAgentResults');
      expect(result).toHaveProperty('alerts');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('_errors');
      expect(Array.isArray(result._errors)).toBe(true);
    });

    it('populates identity from vnbLookupCodes response', async () => {
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });
      expect(result.identity.name).toBe('TWL Netze GmbH');
      expect(result.identity.mastrId).toBe('SNB935578300972');
      expect(result.identity.bdew).toBe('9907473000008');
    });

    it('populates kpis from vnb-monitor and datapoint health', async () => {
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });
      const kpis = result.kpis;

      expect(kpis.totalInstallations).toBe(312);
      expect(kpis.totalCapacityMW).toBe(145.2);
      expect(kpis.ewkAnschlussdauerWeeks).toBe(35);
      expect(kpis.datapointsHealthy).toBe(5);
      expect(kpis.datapointsStale).toBe(1);
      expect(kpis.mastrQualityScore).toBe(78);
    });

    it('populates latestAgentResults from all four agent pipelines', async () => {
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });
      const lar = result.latestAgentResults;

      expect(lar.mastrQuality.id).toBe('mq-001');
      expect(lar.mastrQuality.qualityScore).toBe(78);
      expect(lar.gridConnection.id).toBe('gc-001');
      expect(lar.gridConnection.decision).toBe('GO_CONDITIONAL');
      expect(lar.energySharing).toBeNull();  // empty list → null
      expect(lar.redispatch.id).toBe('rd-001');
      expect(lar.redispatch.settlementReadinessPercent).toBe(88.1);
      expect(lar.redispatch.riskLevel).toBe('medium');
    });

    it('propagates alerts from vnb-monitor snapshot', async () => {
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].id).toBe('A1');
    });

    it('degrades gracefully when vnb-monitor throws — kpis still returned', async () => {
      handlers.vnbMonitorSnapshot = () => { throw new Error('Upstream down'); };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: 'BADCODE' });

      // Response must still be returned
      expect(result).toHaveProperty('identity');
      expect(result).toHaveProperty('kpis');
      expect(result.kpis.ewkAnschlussdauerWeeks).toBeNull();
      // Error recorded
      expect(result._errors).toContain('vnb-monitor.snapshot');
    });

    it('degrades gracefully when identity lookup throws — bdew code used as fallback', async () => {
      handlers.vnbLookupCodes = () => { throw new Error('MCP timeout'); };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '1234567890000' });

      expect(result.identity.bdew).toBe('1234567890000');
      expect(result.identity.name).toBeNull();
      expect(result._errors).toContain('grid-operations.vnbLookupCodes');
    });

    it('degrades gracefully when multiple services throw — rest of response intact', async () => {
      handlers.vnbMonitorSnapshot = () => { throw new Error('down'); };
      handlers.mqList             = () => { throw new Error('down'); };
      handlers.rdList             = () => { throw new Error('down'); };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });

      expect(result._errors.length).toBe(3);
      expect(result.latestAgentResults.mastrQuality).toBeNull();
      expect(result.latestAgentResults.redispatch).toBeNull();
      // Grid connection and energy sharing still work
      expect(result.latestAgentResults.gridConnection.decision).toBe('GO_CONDITIONAL');
    });

    it('returns cached response on second call within TTL', async () => {
      let callCount = 0;
      handlers.vnbLookupCodes = (ctx) => { callCount++; return MOCK_VNB_IDENTITY; };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: 'CACHED-1' });
      await broker.call('dashboard-api.vnbOverview', { bdewCode: 'CACHED-1' });

      expect(callCount).toBe(1);  // second call served from cache
    });

    it('uses different cache keys for different bdewCodes', async () => {
      let callCountA = 0;
      let callCountB = 0;
      handlers.vnbLookupCodes = (ctx) => {
        if (ctx.params.bdewCode === 'CODE-A') callCountA++;
        if (ctx.params.bdewCode === 'CODE-B') callCountB++;
        return MOCK_VNB_IDENTITY;
      };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: 'CODE-A' });
      await broker.call('dashboard-api.vnbOverview', { bdewCode: 'CODE-B' });
      await broker.call('dashboard-api.vnbOverview', { bdewCode: 'CODE-A' });

      expect(callCountA).toBe(1);
      expect(callCountB).toBe(1);
    });

    it('calls vnb-monitor.snapshot after vnbLookupCodes (Phase 1 is sequential)', async () => {
      const callOrder = [];
      handlers.vnbLookupCodes      = () => { callOrder.push('vnbLookupCodes'); return MOCK_VNB_IDENTITY; };
      handlers.vnbMonitorSnapshot  = () => { callOrder.push('vnbMonitorSnapshot'); return MOCK_VNB_MONITOR; };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: 'ORDER-TEST' });

      expect(callOrder[0]).toBe('vnbLookupCodes');
      expect(callOrder[1]).toBe('vnbMonitorSnapshot');
    });

    it('forwards gridOperatorId extracted from identity to Phase 2 list calls', async () => {
      let capturedMqParams;
      handlers.mqList = (ctx) => { capturedMqParams = ctx.params; return MOCK_MQ_AUDITS; };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });

      // MOCK_VNB_IDENTITY.results[0].mastrId = 'SNB935578300972'
      expect(capturedMqParams.gridOperatorId).toBe('SNB935578300972');
      expect(capturedMqParams.limit).toBe(1);
    });

    it('deduplicates concurrent requests for same bdewCode (stampede guard)', async () => {
      let callCount = 0;
      handlers.vnbLookupCodes = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 30)); // simulate upstream latency
        return MOCK_VNB_IDENTITY;
      };

      const [r1, r2] = await Promise.all([
        broker.call('dashboard-api.vnbOverview', { bdewCode: 'STAMPEDE-VNB' }),
        broker.call('dashboard-api.vnbOverview', { bdewCode: 'STAMPEDE-VNB' }),
      ]);

      expect(callCount).toBe(1); // only one upstream fetch despite two concurrent calls
      expect(r1.identity).toBeDefined();
      expect(r2.identity).toBeDefined();
    });
  });

  // ── marketSnapshot ───────────────────────────────────────────────────────────

  describe('marketSnapshot', () => {
    it('returns spotPrice, co2, renewableForecast24h, timestamp', async () => {
      const result = await broker.call('dashboard-api.marketSnapshot', {});

      expect(result).toHaveProperty('spotPrice');
      expect(result).toHaveProperty('co2');
      expect(result).toHaveProperty('renewableForecast24h');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('_errors');
      expect(result._errors).toHaveLength(0);
    });

    it('calculates spotPrice fields correctly', async () => {
      const result = await broker.call('dashboard-api.marketSnapshot', {});
      const sp = result.spotPrice;

      expect(sp.current).toBeCloseTo(50.1, 1);
      expect(sp.minToday).toBeCloseTo(40.0, 1);
      expect(sp.maxToday).toBeCloseTo(50.1, 1);
      expect(['rising', 'falling', 'stable']).toContain(sp.trend);
    });

    it('builds co2 block with signal classification', async () => {
      const result = await broker.call('dashboard-api.marketSnapshot', {});
      const co2 = result.co2;

      expect(co2.current).toBe(380);
      // 300–450 = yellow
      expect(co2.signal).toBe('yellow');
      expect(co2.location).toBe('Deutschland');
    });

    it('extracts solar/wind peaks from ENTSO-E forecast', async () => {
      const result = await broker.call('dashboard-api.marketSnapshot', { region: 'Germany' });
      const rf = result.renewableForecast24h;

      expect(rf.solarPeakMW).toBe(32500);
      expect(rf.windPeakMW).toBe(18200);
      expect(rf.combinedPeakAt).toBe('2026-03-31T13:00:00Z');
    });

    it('returns null renewableForecast24h and skips ENTSO-E when no region given', async () => {
      let forecastCalled = false;
      handlers.entsoeforecast = () => { forecastCalled = true; return MOCK_FORECAST; };

      const result = await broker.call('dashboard-api.marketSnapshot', {});

      expect(result.renewableForecast24h).toBeNull();
      expect(forecastCalled).toBe(false);
      expect(result._errors).toHaveLength(0);
    });

    it('returns null spotPrice when all price services fail', async () => {
      handlers.emPrices  = () => { throw new Error('down'); };
      handlers.germangrid = () => { throw new Error('down'); };

      const result = await broker.call('dashboard-api.marketSnapshot', {});

      expect(result.spotPrice).toBeNull();
      expect(result._errors).toContain('energy-market.prices');
      expect(result._errors).toContain('german-grid.spotprices');
    });

    it('returns null co2 when co2Intensity service fails', async () => {
      handlers.emCo2 = () => { throw new Error('down'); };

      const result = await broker.call('dashboard-api.marketSnapshot', {});

      expect(result.co2).toBeNull();
      expect(result._errors).toContain('energy-market.co2Intensity');
    });

    it('accepts location and region overrides', async () => {
      let capturedCo2Params;
      handlers.emCo2 = (ctx) => {
        capturedCo2Params = ctx.params;
        return MOCK_CO2;
      };

      await broker.call('dashboard-api.marketSnapshot', { location: 'Heidelberg', region: 'Bayern' });

      expect(capturedCo2Params.location).toBe('Heidelberg');
    });

    it('uses different cache keys for different location/region combinations', async () => {
      let callCount = 0;
      handlers.emPrices = () => { callCount++; return MOCK_PRICES; };

      await broker.call('dashboard-api.marketSnapshot', { location: 'Deutschland', region: 'Germany' });
      await broker.call('dashboard-api.marketSnapshot', { location: 'Bayern', region: 'Germany' });
      await broker.call('dashboard-api.marketSnapshot', { location: 'Deutschland', region: 'Germany' });

      expect(callCount).toBe(2);  // third call same key → cache hit
    });

    it('deduplicates concurrent requests for same location/region (stampede guard)', async () => {
      let callCount = 0;
      handlers.emPrices = async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return MOCK_PRICES;
      };

      const [r1, r2] = await Promise.all([
        broker.call('dashboard-api.marketSnapshot', { location: 'Deutschland', region: 'Germany' }),
        broker.call('dashboard-api.marketSnapshot', { location: 'Deutschland', region: 'Germany' }),
      ]);

      expect(callCount).toBe(1);
      expect(r1.timestamp).toBeDefined();
      expect(r2.timestamp).toBeDefined();
    });
  });

  // ── qualitySummary ─────────────────────────────────────────────────────────

  describe('qualitySummary', () => {
    it('returns agents array with 5 entries', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});

      expect(result).toHaveProperty('agents');
      expect(result.agents).toHaveLength(5);
      expect(result).toHaveProperty('timestamp');
    });

    it('agent entries have required shape', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});
      const types  = result.agents.map((a) => a.type);

      expect(types).toContain('mastr-quality');
      expect(types).toContain('grid-connection');
      expect(types).toContain('energy-sharing');
      expect(types).toContain('redispatch-expost');
      expect(types).toContain('energy-sharing-allocation');

      for (const agent of result.agents) {
        expect(agent).toHaveProperty('type');
        expect(agent).toHaveProperty('label');
        expect(agent).toHaveProperty('lastRun');
        expect(agent).toHaveProperty('keyMetric');
        expect(agent).toHaveProperty('recentReports');
        expect(Array.isArray(agent.recentReports)).toBe(true);
      }
    });

    it('returns null lastRun and keyMetric for agents with no reports', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});
      const es = result.agents.find((a) => a.type === 'energy-sharing');

      expect(es.lastRun).toBeNull();
      expect(es.keyMetric).toBeNull();
      expect(es.recentReports).toHaveLength(0);
    });

    it('populates keyMetric for mastr-quality (qualityScore)', async () => {
      const result  = await broker.call('dashboard-api.qualitySummary', {});
      const mqEntry = result.agents.find((a) => a.type === 'mastr-quality');

      expect(mqEntry.lastRun).toBe('2026-03-31T10:00:00Z');
      expect(mqEntry.keyMetric).toEqual({ name: 'qualityScore', value: 78 });
      expect(mqEntry.recentReports).toHaveLength(1);
    });

    it('passes gridOperatorId filter to agent list calls', async () => {
      let capturedMqParams;
      handlers.mqList = (ctx) => {
        capturedMqParams = ctx.params;
        return MOCK_MQ_AUDITS;
      };

      await broker.call('dashboard-api.qualitySummary', { gridOperatorId: 'SNB935578300972' });

      expect(capturedMqParams.gridOperatorId).toBe('SNB935578300972');
      expect(capturedMqParams.limit).toBe(5);
    });

    it('degrades gracefully when one list service fails', async () => {
      handlers.mqList = () => { throw new Error('PouchDB unavailable'); };

      const result  = await broker.call('dashboard-api.qualitySummary', {});
      const mqEntry = result.agents.find((a) => a.type === 'mastr-quality');

      expect(result._errors).toContain('mastr-quality.list');
      expect(mqEntry.lastRun).toBeNull();
      expect(mqEntry.keyMetric).toBeNull();
    });
  });

  // ── findingCodes ───────────────────────────────────────────────────────────

  describe('findingCodes', () => {
    it('returns codes, agents, totalCodes', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});

      expect(result).toHaveProperty('codes');
      expect(result).toHaveProperty('agents');
      expect(result).toHaveProperty('totalCodes');
      expect(typeof result.totalCodes).toBe('number');
    });

    it('totalCodes matches keys in codes map', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      expect(result.totalCodes).toBe(Object.keys(result.codes).length);
    });

    it('totalCodes matches FINDING_CODE_METADATA length', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      expect(result.totalCodes).toBe(Object.keys(FINDING_CODE_METADATA).length);
    });

    it('every code entry has severity, agent, step, description, descriptionDe', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const VALID_SEVERITIES = ['info', 'warning', 'error'];
      const VALID_AGENTS     = ['grid-connection', 'energy-sharing', 'mastr-quality', 'redispatch-expost'];

      for (const [code, meta] of Object.entries(result.codes)) {
        expect(VALID_SEVERITIES).toContain(meta.severity);
        expect(VALID_AGENTS).toContain(meta.agent);
        expect(typeof meta.step).toBe('number');
        expect(typeof meta.description).toBe('string');
        expect(meta.description.length).toBeGreaterThan(0);
        expect(typeof meta.descriptionDe).toBe('string');
        expect(meta.descriptionDe.length).toBeGreaterThan(0);
      }
    });

    it('agents catalogue has 4 known agent types', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const agentKeys = Object.keys(result.agents);

      expect(agentKeys).toContain('grid-connection');
      expect(agentKeys).toContain('energy-sharing');
      expect(agentKeys).toContain('mastr-quality');
      expect(agentKeys).toContain('redispatch-expost');
    });

    it('returns cached result on second call (no upstream calls to check)', async () => {
      const result1 = await broker.call('dashboard-api.findingCodes', {});
      const result2 = await broker.call('dashboard-api.findingCodes', {});

      // Same object reference from cache
      expect(result1.totalCodes).toBe(result2.totalCodes);
      expect(result1.codes.MQ_ZERO_CAPACITY.agent).toBe('mastr-quality');
    });

    it('includes both grid-connection and MaStR quality codes', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});

      expect(result.codes).toHaveProperty('GO_DIRECT');
      expect(result.codes).toHaveProperty('GO_CONDITIONAL');
      expect(result.codes).toHaveProperty('MQ_ZERO_CAPACITY');
      expect(result.codes).toHaveProperty('RD_SETTLEMENT_CRITICAL');
      expect(result.codes).toHaveProperty('APPROVED');
      expect(result.codes).toHaveProperty('VNB_RESOLVED');
    });

    it('MQ_ZERO_CAPACITY has correct metadata', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const meta   = result.codes.MQ_ZERO_CAPACITY;

      expect(meta.severity).toBe('error');
      expect(meta.agent).toBe('mastr-quality');
      expect(meta.step).toBe(4);
    });

    it('RD_RISK_HIGH has correct metadata', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const meta   = result.codes.RD_RISK_HIGH;

      expect(meta.severity).toBe('error');
      expect(meta.agent).toBe('redispatch-expost');
      expect(meta.step).toBe(6);
    });
  });

  // ── safeCall method ────────────────────────────────────────────────────────

  describe('safeCall (method)', () => {
    it('returns fallback value when action throws', async () => {
      const svc    = broker.getLocalService('dashboard-api');
      const errors = [];
      const ctx    = await broker.call('dashboard-api.findingCodes', {}).then(() => null).catch(() => null);

      // Exercise safeCall indirectly via vnbOverview with failing service
      handlers.vnbMonitorSnapshot = () => { throw new Error('Simulated failure'); };
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: 'FAIL' });

      expect(result._errors).toContain('vnb-monitor.snapshot');
    });

    it('records multiple failures in _errors array', async () => {
      handlers.vnbMonitorSnapshot = () => { throw new Error('fail'); };
      handlers.gcList             = () => { throw new Error('fail'); };
      handlers.esList             = () => { throw new Error('fail'); };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: 'MULTI-FAIL' });

      expect(result._errors).toContain('vnb-monitor.snapshot');
      expect(result._errors).toContain('grid-connection.list');
      expect(result._errors).toContain('energy-sharing.list');
    });

    it('does not include successful calls in _errors', async () => {
      handlers.vnbMonitorSnapshot = () => { throw new Error('fail'); };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: 'PARTIAL' });

      expect(result._errors).not.toContain('grid-operations.vnbLookupCodes');
      expect(result._errors).not.toContain('mastr-quality.list');
    });
  });

  // ── Cache helpers ──────────────────────────────────────────────────────────

  describe('cache helpers', () => {
    it('cacheGet returns null for missing key', () => {
      const svc = broker.getLocalService('dashboard-api');
      expect(svc.cacheGet('nonexistent-key')).toBeNull();
    });

    it('cacheGet returns null for expired entry', async () => {
      const svc = broker.getLocalService('dashboard-api');
      svc.cacheSet('test-key', { data: 'value' }, -1000); // already expired
      expect(svc.cacheGet('test-key')).toBeNull();
    });

    it('cacheGet returns value for fresh entry', () => {
      const svc = broker.getLocalService('dashboard-api');
      svc.cacheSet('fresh-key', { data: 42 }, 60000);
      expect(svc.cacheGet('fresh-key')).toEqual({ data: 42 });
    });

    it('cacheGetOrFetch returns cached value without calling fetchFn', async () => {
      const svc = broker.getLocalService('dashboard-api');
      svc.cacheSet('prefilled', { answer: 42 }, 60000);
      let fetchCalled = false;
      const result = await svc.cacheGetOrFetch('prefilled', 60000, async () => {
        fetchCalled = true;
        return { answer: 99 };
      });
      expect(result).toEqual({ answer: 42 });
      expect(fetchCalled).toBe(false);
    });

    it('cacheGetOrFetch calls fetchFn on cache miss and stores result', async () => {
      const svc = broker.getLocalService('dashboard-api');
      const result = await svc.cacheGetOrFetch('miss-key', 60000, async () => ({ answer: 7 }));
      expect(result).toEqual({ answer: 7 });
      expect(svc.cacheGet('miss-key')).toEqual({ answer: 7 });
    });
  });

  // ── Required downstream action existence ───────────────────────────────────

  describe('Required downstream actions are registered in mock broker', () => {
    // These are the exact action names used by dashboard-api.service.js.
    // If a name here does not match what is mocked in beforeAll, the test fails,
    // indicating a contract mismatch between the dashboard service and its mocks.
    const REQUIRED_ACTIONS = [
      'grid-operations.vnbLookupCodes',
      'vnb-monitor.snapshot',
      'datapoint.health',
      'mastr-quality.list',
      'grid-connection.list',
      'energy-sharing.list',
      'redispatch-expost.list',
      'energy-market.prices',
      'energy-market.co2Intensity',
      'entsoe.windSolarForecast',
      'german-grid.spotprices',
      'energy-sharing-allocation.list',
    ];

    let registeredActionNames;

    beforeAll(() => {
      registeredActionNames = new Set(
        broker.registry.actions.list({ withEndpoints: false }).map((a) => a.name)
      );
    });

    for (const action of REQUIRED_ACTIONS) {
      // eslint-disable-next-line no-loop-func
      it(`'${action}' is registered`, () => {
        expect(registeredActionNames.has(action)).toBe(true);
      });
    }
  });
});
