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
  results: [
    {
      name: 'TWL Netze GmbH',
      mastrId: 'SNB935578300972',
      bdew: '9907473000008',
      bnr: '10002345',
    },
  ],
};

const MOCK_VNB_MONITOR = {
  identity: { name: 'TWL Netze GmbH', mastrId: 'SNB935578300972', bdewCode: '9907473000008' },
  // Real structure from vnb-monitor.service.js fetchMastrData / fetchEwkData
  mastr: {
    inBetrieb: {
      anlagenCount: 312,
      leistungMW: '145.2',
      pvAnlagen: 180,
      windAnlagen: 90,
      speicherAnlagen: 42,
    },
    inPlanung: { anlagenCount: 20, leistungMW: '15.0' },
    netzbetreiberPruefung: { anlagenCount: 5, leistungMW: '3.2' },
  },
  ewk: {
    anschlussdauer: {
      eeNS_weeks: 35,
      eeNS_phase1_weeks: 12,
      eeNS_phase2_weeks: 23,
      verbrauchNS_weeks: 28,
    },
    umsetzungsquote: { eeNS_percent: 100, verbrauchNS_percent: 95 },
    digitalisierungsindex: { gesamt_percent: 58, smartGrids_percent: 72 },
  },
  alerts: [{ id: 'A1', severity: 'warning', message: 'Test alert' }],
  alertSummary: { total: 1, critical: 0, warning: 1, info: 0, ewkRelevant: 0 },
};

const MOCK_HEALTH = {
  overview: { healthy: 5, stale: 1, errored: 0 },
};

const MOCK_MQ_AUDITS = {
  count: 1,
  audits: [
    {
      id: 'mq-001',
      createdAt: '2026-03-31T10:00:00Z',
      qualityScore: 78,
      findingsCount: { info: 12, warning: 18, error: 5 },
    },
  ],
};

const MOCK_GC_VALIDATIONS = {
  count: 1,
  validations: [
    {
      id: 'gc-001',
      createdAt: '2026-03-30T14:00:00Z',
      decision: 'GO_CONDITIONAL',
      findingsCount: { info: 4, warning: 7, error: 1 },
    },
  ],
};

const MOCK_ES_VALIDATIONS = {
  count: 0,
  validations: [],
};

const MOCK_RD_AUDITS = {
  count: 1,
  audits: [
    {
      id: 'rd-001',
      createdAt: '2026-03-29T08:00:00Z',
      settlementReadiness: { readinessPercent: 88.1 },
      riskAssessment: { level: 'medium' },
      findingsCount: { info: 3, warning: 8, error: 2 },
    },
  ],
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

const MOCK_OBSERVABILITY_SUMMARY = {
  generatedAt: '2026-03-31T13:00:00Z',
  window: { sinceMinutes: 60, slowActionThresholdMs: 1000 },
  logs: {
    total: 4,
    byLevel: { info: 2, error: 2 },
    recentErrors: [
      {
        timestamp: '2026-03-31T12:58:00Z',
        level: 'error',
        service: 'finance-agent',
        action: 'finance-agent.analyze',
        message: 'timeout [REDACTED]',
      },
    ],
  },
  metrics: {
    total: 22,
    overview: {
      totalCalls: 22,
      successCount: 20,
      errorCount: 2,
      avgDurationMs: 210,
      p95DurationMs: 1400,
      slowCallCount: 3,
      byOrigin: { internal: 16, gateway: 6 },
    },
    slowestActions: [
      {
        action: 'finance-agent.analyze',
        service: 'finance-agent',
        calls: 5,
        errorCount: 1,
        avgDurationMs: 780,
        maxDurationMs: 1800,
      },
    ],
  },
};

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const MOCK_VDMI_MATRICES = {
  count: 3,
  items: [
    {
      id: 'vdmi-001',
      processType: 'fnav-contract-negotiation',
      nominationStatus: 'confirmed',
      detectionConfidence: 0.92,
      createdAt: isoDaysAgo(8),
      updatedAt: isoDaysAgo(6),
    },
    {
      id: 'vdmi-002',
      processType: 'fnav-contract-negotiation',
      nominationStatus: 'confirmed',
      detectionConfidence: 0.88,
      createdAt: isoDaysAgo(40),
      updatedAt: isoDaysAgo(34),
    },
    {
      id: 'vdmi-003',
      processType: 'adhoc',
      nominationStatus: 'pending',
      detectionConfidence: 0.73,
      createdAt: isoDaysAgo(3),
      updatedAt: isoDaysAgo(2),
    },
  ],
};

const MOCK_VDMI_FINDINGS = {
  count: 7,
  findings: [
    {
      id: 'vf-001',
      code: 'VD_SHADOW_SHAREPOINT_BYPASS_H',
      severity: 'H',
      status: 'resolved',
      createdAt: isoDaysAgo(5),
      updatedAt: isoDaysAgo(4),
    },
    {
      id: 'vf-002',
      code: 'VD_SHADOW_EXCEL_EXEC_H',
      severity: 'H',
      status: 'open',
      createdAt: isoDaysAgo(4),
      updatedAt: isoDaysAgo(4),
    },
    {
      id: 'vf-003',
      code: 'VD_SILO_HANDOVER_MANUAL_M',
      severity: 'M',
      status: 'resolved',
      createdAt: isoDaysAgo(10),
      updatedAt: isoDaysAgo(9),
    },
    {
      id: 'vf-004',
      code: 'VD_SILO_KERNSYSTEM_BLOCK_M',
      severity: 'M',
      status: 'open',
      createdAt: isoDaysAgo(11),
      updatedAt: isoDaysAgo(10),
    },
    {
      id: 'vf-005',
      code: 'VD_GOV_RECURRENCE_K',
      severity: 'K',
      status: 'open',
      createdAt: isoDaysAgo(3),
      updatedAt: isoDaysAgo(2),
    },
    {
      id: 'vf-006',
      code: 'VD_GOV_AUDIT_GAP_K',
      severity: 'K',
      status: 'resolved',
      createdAt: isoDaysAgo(38),
      updatedAt: isoDaysAgo(37),
    },
    {
      id: 'vf-007',
      code: 'VD_GOV_RECURRENCE_K',
      severity: 'K',
      status: 'resolved',
      createdAt: isoDaysAgo(42),
      updatedAt: isoDaysAgo(41),
    },
  ],
};

const MOCK_EDM_SUMMARY = {
  success: true,
  meloId: 'DE0012345678901234567890123456789',
  obis: '1-0:1.8.0',
  from: '2026-03-31T00:00:00Z',
  to: '2026-04-01T00:00:00Z',
  groupBy: 'day',
  groups: [
    {
      period: '2026-03-31',
      total_kwh: 121.4,
      count: 96,
      measured: 90,
      min_kw: 0.2,
      max_kw: 12.1,
      avg_kw: 5.058333,
      dataQuality: 0.9375,
    },
  ],
};

const MOCK_EDM_VALIDATION = {
  success: true,
  summary: {
    totalValues: 96,
    findings: 4,
    errors: 1,
    warnings: 2,
    infos: 1,
    autoFixed: 0,
    dataQuality: 0.9375,
  },
  recommendations: ['Lücken erkannt: Gap-Filling mit Interpolation oder Vortagswerten ausführen.'],
  findings: [
    {
      ruleId: 'GAP_DETECTION',
      severity: 'warning',
      timestamp: '2026-03-31T04:00:00Z',
      message: 'Gap erkannt',
    },
    {
      ruleId: 'BANDWIDTH_CHECK',
      severity: 'error',
      timestamp: '2026-03-31T09:00:00Z',
      value: 56,
      message: 'Ausreißer erkannt',
    },
    {
      ruleId: 'SLP_PLAUSIBILITY',
      severity: 'warning',
      timestamp: '2026-03-31T11:00:00Z',
      message: 'Profilabweichung',
    },
    {
      ruleId: 'MONOTONY_CHECK',
      severity: 'info',
      timestamp: '2026-03-31T12:00:00Z',
      message: 'Monotoniehinweis',
    },
  ],
};

const MOCK_FORECAST_QUALITY = {
  success: true,
  quality: {
    rmse: 0.282144,
    mae: 0.216441,
    mape: 12.312,
    bias: 0.031,
    correlation: 0.91,
    sampleSize: 96,
    rating: 'fair',
  },
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

    // Mock assets (v0.20.2 — redispatchCount)
    broker.createService({
      name: 'assets',
      actions: {
        redispatchCount: makeHandler('assetsRedispatchCount', {
          count: 59,
          totalCapacityMW: 73.4,
          byType: {
            solar: { count: 12, capacityKW: 8200 },
            wind: { count: 15, capacityKW: 42000 },
            combustion: { count: 25, capacityKW: 18500 },
            biomass: { count: 7, capacityKW: 4700 },
          },
        }),
      },
    });

    // Mock energy-sharing-allocation
    broker.createService({
      name: 'energy-sharing-allocation',
      actions: {
        list: makeHandler('allocList', { count: 0, allocations: [] }),
      },
    });

    // Mock vdmi
    broker.createService({
      name: 'vdmi',
      actions: {
        list: makeHandler('vdmiList', MOCK_VDMI_MATRICES),
        findings: makeHandler('vdmiFindings', MOCK_VDMI_FINDINGS),
      },
    });

    // Mock energy-market
    broker.createService({
      name: 'energy-market',
      actions: {
        prices: makeHandler('emPrices', MOCK_PRICES),
        co2Intensity: makeHandler('emCo2', MOCK_CO2),
      },
    });

    // Mock entsoe
    broker.createService({
      name: 'entsoe',
      actions: {
        dayAheadPrices: makeHandler('entsoeprices', MOCK_PRICES),
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

    // Mock observability
    broker.createService({
      name: 'observability',
      actions: {
        summary: makeHandler('observabilitySummary', MOCK_OBSERVABILITY_SUMMARY),
      },
    });

    // Mock EDM + validation + forecast-engine for load-profile monitor
    broker.createService({
      name: 'edm',
      actions: {
        getTimeseriesSummary: makeHandler('edmGetTimeseriesSummary', MOCK_EDM_SUMMARY),
      },
    });

    broker.createService({
      name: 'edm-validation',
      actions: {
        validate: makeHandler('edmValidationValidate', MOCK_EDM_VALIDATION),
      },
    });

    broker.createService({
      name: 'forecast-engine',
      actions: {
        evaluateQuality: makeHandler('forecastEvaluateQuality', MOCK_FORECAST_QUALITY),
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
    if (svc && svc.cache) svc.cache.clear();
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
      expect(lar.energySharing).toBeNull(); // empty list → null
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
      handlers.vnbMonitorSnapshot = () => {
        throw new Error('Upstream down');
      };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000040' });

      // Response must still be returned
      expect(result).toHaveProperty('identity');
      expect(result).toHaveProperty('kpis');
      expect(result.kpis.ewkAnschlussdauerWeeks).toBeNull();
      // Error recorded
      expect(result._errors).toContain('vnb-monitor.snapshot');
    });

    it('degrades gracefully when identity lookup throws — bdew code used as fallback', async () => {
      handlers.vnbLookupCodes = () => {
        throw new Error('MCP timeout');
      };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '1234567890000' });

      expect(result.identity.bdew).toBe('1234567890000');
      expect(result.identity.name).toBeNull();
      expect(result._errors).toContain('grid-operations.vnbLookupCodes');
    });

    it('degrades gracefully when multiple services throw — rest of response intact', async () => {
      handlers.vnbMonitorSnapshot = () => {
        throw new Error('down');
      };
      handlers.mqList = () => {
        throw new Error('down');
      };
      handlers.rdList = () => {
        throw new Error('down');
      };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });

      expect(result._errors.length).toBe(3);
      expect(result.latestAgentResults.mastrQuality).toBeNull();
      expect(result.latestAgentResults.redispatch).toBeNull();
      // Grid connection and energy sharing still work
      expect(result.latestAgentResults.gridConnection.decision).toBe('GO_CONDITIONAL');
    });

    it('returns cached response on second call within TTL', async () => {
      let callCount = 0;
      handlers.vnbLookupCodes = (_ctx) => {
        callCount++;
        return MOCK_VNB_IDENTITY;
      };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000010' });
      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000010' });

      expect(callCount).toBe(1); // second call served from cache
    });

    it('uses different cache keys for different bdewCodes', async () => {
      let callCountA = 0;
      let callCountB = 0;
      handlers.vnbLookupCodes = (ctx) => {
        if (ctx.params.bdewCode === '9900000000020') callCountA++;
        if (ctx.params.bdewCode === '9900000000021') callCountB++;
        return MOCK_VNB_IDENTITY;
      };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000020' });
      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000021' });
      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000020' });

      expect(callCountA).toBe(1);
      expect(callCountB).toBe(1);
    });

    it('calls vnb-monitor.snapshot after vnbLookupCodes (Phase 1 is sequential)', async () => {
      const callOrder = [];
      handlers.vnbLookupCodes = () => {
        callOrder.push('vnbLookupCodes');
        return MOCK_VNB_IDENTITY;
      };
      handlers.vnbMonitorSnapshot = () => {
        callOrder.push('vnbMonitorSnapshot');
        return MOCK_VNB_MONITOR;
      };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000030' });

      expect(callOrder[0]).toBe('vnbLookupCodes');
      expect(callOrder[1]).toBe('vnbMonitorSnapshot');
    });

    it('forwards gridOperatorId extracted from identity to Phase 2 list calls', async () => {
      let capturedMqParams;
      handlers.mqList = (ctx) => {
        capturedMqParams = ctx.params;
        return MOCK_MQ_AUDITS;
      };

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
        broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000001' }),
        broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000001' }),
      ]);

      expect(callCount).toBe(1); // only one upstream fetch despite two concurrent calls
      expect(r1.identity).toBeDefined();
      expect(r2.identity).toBeDefined();
    });

    // ── redispatchEligible KPI (v0.20.2) ──────────────────────────────────────

    it('populates redispatchEligible and redispatchCapacityMW from assets.redispatchCount', async () => {
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });
      expect(result.kpis.redispatchEligible).toBe(59);
      expect(result.kpis.redispatchCapacityMW).toBe(73.4);
    });

    it('forwards gridOperatorId to assets.redispatchCount', async () => {
      let capturedParams;
      handlers.assetsRedispatchCount = (ctx) => {
        capturedParams = ctx.params;
        return { count: 12, totalCapacityMW: 18.5, byType: {} };
      };

      await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });

      // gridOperatorId from MOCK_VNB_IDENTITY.results[0].mastrId
      expect(capturedParams.gridOperatorId).toBe('SNB935578300972');
    });

    it('sets redispatchEligible to null when assets.redispatchCount fails (graceful degradation)', async () => {
      handlers.assetsRedispatchCount = () => {
        throw new Error('assets down');
      };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000050' });

      expect(result.kpis.redispatchEligible).toBeNull();
      expect(result.kpis.redispatchCapacityMW).toBeNull();
      expect(result._errors).toContain('assets.redispatchCount');
    });

    it('sets redispatchEligible to null when assets.redispatchCount returns error shape', async () => {
      handlers.assetsRedispatchCount = () => ({
        count: null,
        totalCapacityMW: null,
        byType: {},
        error: 'gridOperatorId or bdewCode is required',
      });

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9907473000008' });

      expect(result.kpis.redispatchEligible).toBeNull();
    });
  });

  // ── redispatchMeteringCockpit ──────────────────────────────────────────────

  describe('redispatchMeteringCockpit', () => {
    it('returns cockpit payload with readiness signal, evidence and blockers', async () => {
      const result = await broker.call('dashboard-api.redispatchMeteringCockpit', {
        gridOperatorId: 'SNB935578300972',
      });

      expect(result).toHaveProperty('operator');
      expect(result).toHaveProperty('decisionReadiness');
      expect(result).toHaveProperty('evidence');
      expect(result).toHaveProperty('blockingEvidenceGaps');
      expect(result).toHaveProperty('staleData');
      expect(result).toHaveProperty('sourceReports');
      expect(result).toHaveProperty('_errors');

      expect(result.operator.gridOperatorId).toBe('SNB935578300972');
      expect(['green', 'yellow', 'red']).toContain(result.decisionReadiness.signal);
      expect(Array.isArray(result.blockingEvidenceGaps)).toBe(true);
      expect(Array.isArray(result.staleData)).toBe(true);
      expect(result.evidence.redispatch.settlementReadinessPercent).toBe(88.1);
      expect(result.evidence.masterData.qualityScore).toBe(78);
    });

    it('resolves gridOperatorId from bdewCode and forwards it to list calls', async () => {
      let capturedRdParams;
      let capturedMqParams;

      handlers.rdList = (ctx) => {
        capturedRdParams = ctx.params;
        return MOCK_RD_AUDITS;
      };
      handlers.mqList = (ctx) => {
        capturedMqParams = ctx.params;
        return MOCK_MQ_AUDITS;
      };

      const result = await broker.call('dashboard-api.redispatchMeteringCockpit', {
        bdewCode: '9907473000008',
      });

      expect(result.operator.gridOperatorId).toBe('SNB935578300972');
      expect(capturedRdParams.gridOperatorId).toBe('SNB935578300972');
      expect(capturedMqParams.gridOperatorId).toBe('SNB935578300972');
    });

    it('returns red signal with high-severity blockers', async () => {
      handlers.rdList = () => ({
        count: 1,
        audits: [
          {
            id: 'rd-critical',
            createdAt: '2026-03-29T08:00:00Z',
            settlementReadiness: { readinessPercent: 52 },
            riskAssessment: { level: 'high' },
          },
        ],
      });
      handlers.vdmiFindings = () => ({
        count: 1,
        findings: [
          {
            id: 'vf-critical',
            status: 'open',
            severity: 'H',
            gridOperatorId: 'SNB935578300972',
          },
        ],
      });

      const result = await broker.call('dashboard-api.redispatchMeteringCockpit', {
        gridOperatorId: 'SNB935578300972',
      });

      expect(result.decisionReadiness.signal).toBe('red');
      expect(result.blockingEvidenceGaps.some((b) => b.code === 'REDISPATCH_RISK_HIGH')).toBe(true);
      expect(result.blockingEvidenceGaps.some((b) => b.code === 'VDMI_OPEN_CRITICAL')).toBe(true);
    });

    it('degrades gracefully when upstream calls fail', async () => {
      handlers.rdList = () => {
        throw new Error('rd unavailable');
      };
      handlers.mqList = () => {
        throw new Error('mq unavailable');
      };

      const result = await broker.call('dashboard-api.redispatchMeteringCockpit', {
        gridOperatorId: 'SNB935578300972',
      });

      expect(result._errors).toContain('redispatch-expost.list');
      expect(result._errors).toContain('mastr-quality.list');
      expect(result.blockingEvidenceGaps.some((b) => b.code === 'REDISPATCH_EVIDENCE_MISSING')).toBe(
        true
      );
      expect(result.blockingEvidenceGaps.some((b) => b.code === 'MASTERDATA_EVIDENCE_MISSING')).toBe(
        true
      );
    });
  });

  // ── loadProfileStreamMonitor ─────────────────────────────────────────────

  describe('loadProfileStreamMonitor', () => {
    it('returns strict anomaly buckets and source action traces', async () => {
      const result = await broker.call('dashboard-api.loadProfileStreamMonitor', {
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
        gridOperatorId: 'SNB935578300972',
      });

      expect(result).toHaveProperty('streamStatus');
      expect(result).toHaveProperty('qualityFindings');
      expect(result).toHaveProperty('anomalySignals');
      expect(result).toHaveProperty('restrictionRefs');
      expect(result).toHaveProperty('forecastQuality');
      expect(result).toHaveProperty('decisionNotes');
      expect(result).toHaveProperty('sourceActions');
      expect(result).toHaveProperty('_errors');

      expect(Array.isArray(result.anomalySignals.dataQualityGap)).toBe(true);
      expect(Array.isArray(result.anomalySignals.realAnomaly)).toBe(true);
      expect(Array.isArray(result.anomalySignals.forecastProblem)).toBe(true);
      expect(Array.isArray(result.anomalySignals.processGovernanceBreak)).toBe(true);
      expect(result.sourceActions['edm-validation.validate'].success).toBe(true);
      expect(result.sourceActions['vdmi.findings'].success).toBe(true);
    });

    it('classifies findings into strict classes', async () => {
      handlers.vdmiFindings = () => ({
        count: 1,
        findings: [
          {
            id: 'vf-gov',
            code: 'VD_GOV_RECURRENCE_K',
            severity: 'K',
            status: 'open',
            gridOperatorId: 'SNB935578300972',
          },
        ],
      });

      const result = await broker.call('dashboard-api.loadProfileStreamMonitor', {
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
        gridOperatorId: 'SNB935578300972',
      });

      expect(result.anomalySignals.dataQualityGap.some((f) => f.ref === 'GAP_DETECTION')).toBe(true);
      expect(result.anomalySignals.realAnomaly.some((f) => f.ref === 'BANDWIDTH_CHECK')).toBe(true);
      expect(result.anomalySignals.forecastProblem.some((f) => f.ref === 'SLP_PLAUSIBILITY')).toBe(
        true
      );
      expect(
        result.anomalySignals.processGovernanceBreak.some((f) => f.ref === 'VD_GOV_RECURRENCE_K')
      ).toBe(true);
    });

    it('allows partial findings when one upstream source fails', async () => {
      handlers.forecastEvaluateQuality = () => {
        throw new Error('forecast down');
      };

      const result = await broker.call('dashboard-api.loadProfileStreamMonitor', {
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
      });

      expect(result._errors).toContain('forecast-engine.evaluateQuality');
      expect(result.streamStatus.partial).toBe(true);
      expect(result.forecastQuality).toBeNull();
      expect(result.qualityFindings.total).toBeGreaterThan(0);
      expect(result.anomalySignals.realAnomaly.length).toBeGreaterThan(0);
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
      handlers.entsoeforecast = () => {
        forecastCalled = true;
        return MOCK_FORECAST;
      };

      const result = await broker.call('dashboard-api.marketSnapshot', {});

      expect(result.renewableForecast24h).toBeNull();
      expect(forecastCalled).toBe(false);
      expect(result._errors).toHaveLength(0);
    });

    it('returns null spotPrice when all price services fail', async () => {
      handlers.entsoeprices = () => {
        throw new Error('down');
      };

      const result = await broker.call('dashboard-api.marketSnapshot', {});

      expect(result.spotPrice).toBeNull();
      expect(result._errors).toContain('entsoe.dayAheadPrices');
    });

    it('returns null co2 when co2Intensity service fails', async () => {
      handlers.emCo2 = () => {
        throw new Error('down');
      };

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

      await broker.call('dashboard-api.marketSnapshot', {
        location: 'Heidelberg',
        region: 'Bayern',
      });

      expect(capturedCo2Params.location).toBe('Heidelberg');
    });

    it('uses different cache keys for different location/region combinations', async () => {
      let callCount = 0;
      handlers.entsoeprices = () => {
        callCount++;
        return MOCK_PRICES;
      };

      await broker.call('dashboard-api.marketSnapshot', {
        location: 'Deutschland',
        region: 'Germany',
      });
      await broker.call('dashboard-api.marketSnapshot', { location: 'Bayern', region: 'Germany' });
      await broker.call('dashboard-api.marketSnapshot', {
        location: 'Deutschland',
        region: 'Germany',
      });

      expect(callCount).toBe(2); // third call same key → cache hit
    });

    it('deduplicates concurrent requests for same location/region (stampede guard)', async () => {
      let callCount = 0;
      handlers.entsoeprices = async () => {
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
    it('returns agents array with 6 entries', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});

      expect(result).toHaveProperty('agents');
      expect(result.agents).toHaveLength(6);
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('businessKpis');
    });

    it('agent entries have required shape', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});
      const types = result.agents.map((a) => a.type);

      expect(types).toContain('mastr-quality');
      expect(types).toContain('grid-connection');
      expect(types).toContain('energy-sharing');
      expect(types).toContain('redispatch-expost');
      expect(types).toContain('energy-sharing-allocation');
      expect(types).toContain('vdmi');

      for (const agent of result.agents) {
        expect(agent).toHaveProperty('type');
        expect(agent).toHaveProperty('label');
        expect(agent).toHaveProperty('lastRun');
        expect(agent).toHaveProperty('keyMetric');
        expect(agent).toHaveProperty('findingsCount');
        expect(agent).toHaveProperty('recentReports');
        expect(Array.isArray(agent.recentReports)).toBe(true);
      }
    });

    it('populates VDMI business KPIs from findings and matrix history windows', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});
      expect(result.businessKpis.vdmi_shadow_path_resolution_rate).toBe(50);
      expect(result.businessKpis.vdmi_n1_escalation_reduction_rate).toBe(50);
      expect(result.businessKpis.vdmi_fnav_time_to_decision_gain_days).toBe(4);
    });

    it('returns null lastRun and keyMetric for agents with no reports', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});
      const es = result.agents.find((a) => a.type === 'energy-sharing');

      expect(es.lastRun).toBeNull();
      expect(es.keyMetric).toBeNull();
      expect(es.findingsCount).toBeNull();
      expect(es.recentReports).toHaveLength(0);
    });

    it('populates keyMetric for mastr-quality (qualityScore)', async () => {
      const result = await broker.call('dashboard-api.qualitySummary', {});
      const mqEntry = result.agents.find((a) => a.type === 'mastr-quality');

      expect(mqEntry.lastRun).toBe('2026-03-31T10:00:00Z');
      expect(mqEntry.keyMetric).toEqual({ name: 'qualityScore', value: 78 });
      expect(mqEntry.findingsCount).toEqual({ info: 12, warning: 18, error: 5 });
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
      handlers.mqList = () => {
        throw new Error('PouchDB unavailable');
      };

      const result = await broker.call('dashboard-api.qualitySummary', {});
      const mqEntry = result.agents.find((a) => a.type === 'mastr-quality');

      expect(result._errors).toContain('mastr-quality.list');
      expect(mqEntry.lastRun).toBeNull();
      expect(mqEntry.keyMetric).toBeNull();
      expect(mqEntry.findingsCount).toBeNull();
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
      const VALID_AGENTS = [
        'grid-connection',
        'energy-sharing',
        'mastr-quality',
        'redispatch-expost',
        'finance-agent',
        'vdmi',
        'blindflug-radar',
        'netzfahrplan',
      ];

      for (const [, meta] of Object.entries(result.codes)) {
        expect(VALID_SEVERITIES).toContain(meta.severity);
        expect(VALID_AGENTS).toContain(meta.agent);
        expect(typeof meta.step).toBe('number');
        expect(typeof meta.description).toBe('string');
        expect(meta.description.length).toBeGreaterThan(0);
        expect(typeof meta.descriptionDe).toBe('string');
        expect(meta.descriptionDe.length).toBeGreaterThan(0);
      }
    });

    it('agents catalogue has known agent types including blindflug-radar', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const agentKeys = Object.keys(result.agents);

      expect(agentKeys).toContain('grid-connection');
      expect(agentKeys).toContain('energy-sharing');
      expect(agentKeys).toContain('mastr-quality');
      expect(agentKeys).toContain('redispatch-expost');
      expect(agentKeys).toContain('vdmi');
      expect(agentKeys).toContain('blindflug-radar');
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
      expect(result.codes).toHaveProperty('FA_QUERY_PLANNED');
      expect(result.codes).toHaveProperty('VD_GOV_RECURRENCE_K');
    });

    it('MQ_ZERO_CAPACITY has correct metadata', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const meta = result.codes.MQ_ZERO_CAPACITY;

      expect(meta.severity).toBe('error');
      expect(meta.agent).toBe('mastr-quality');
      expect(meta.step).toBe(4);
    });

    it('RD_RISK_HIGH has correct metadata', async () => {
      const result = await broker.call('dashboard-api.findingCodes', {});
      const meta = result.codes.RD_RISK_HIGH;

      expect(meta.severity).toBe('error');
      expect(meta.agent).toBe('redispatch-expost');
      expect(meta.step).toBe(6);
    });
  });

  // ── observabilityMini ──────────────────────────────────────────────────────

  describe('observabilityMini', () => {
    it('returns compact cards, recentErrors, slowestActions and timestamp', async () => {
      const result = await broker.call('dashboard-api.observabilityMini', {});

      expect(result).toHaveProperty('cards');
      expect(result).toHaveProperty('recentErrors');
      expect(result).toHaveProperty('slowestActions');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('_errors');
      expect(result._errors).toHaveLength(0);
    });

    it('computes card signals from observability summary', async () => {
      const result = await broker.call('dashboard-api.observabilityMini', {});

      expect(result.cards.health.status).toBe('degraded');
      expect(result.cards.incidents.errorCount).toBe(2);
      expect(result.cards.performance.p95DurationMs).toBe(1400);
      expect(result.cards.performance.slowCallCount).toBe(3);
      expect(result.recentErrors).toHaveLength(1);
      expect(result.slowestActions).toHaveLength(1);
    });

    it('degrades gracefully when observability.summary fails', async () => {
      handlers.observabilitySummary = () => {
        throw new Error('observability unavailable');
      };

      const result = await broker.call('dashboard-api.observabilityMini', {
        sinceMinutes: 30,
        slowActionThresholdMs: 500,
      });

      expect(result._errors).toContain('observability.summary');
      expect(result.cards.health.status).toBe('unknown');
      expect(result.recentErrors).toEqual([]);
      expect(result.slowestActions).toEqual([]);
    });
  });

  // ── safeCall method ────────────────────────────────────────────────────────

  describe('safeCall (method)', () => {
    it('returns fallback value when action throws', async () => {
      // Exercise safeCall indirectly via vnbOverview with failing service
      handlers.vnbMonitorSnapshot = () => {
        throw new Error('Simulated failure');
      };
      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000002' });

      expect(result._errors).toContain('vnb-monitor.snapshot');
    });

    it('records multiple failures in _errors array', async () => {
      handlers.vnbMonitorSnapshot = () => {
        throw new Error('fail');
      };
      handlers.gcList = () => {
        throw new Error('fail');
      };
      handlers.esList = () => {
        throw new Error('fail');
      };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000003' });

      expect(result._errors).toContain('vnb-monitor.snapshot');
      expect(result._errors).toContain('grid-connection.list');
      expect(result._errors).toContain('energy-sharing.list');
    });

    it('does not include successful calls in _errors', async () => {
      handlers.vnbMonitorSnapshot = () => {
        throw new Error('fail');
      };

      const result = await broker.call('dashboard-api.vnbOverview', { bdewCode: '9900000000004' });

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
      'energy-market.co2Intensity',
      'entsoe.dayAheadPrices',
      'entsoe.windSolarForecast',
      'energy-sharing-allocation.list',
      'vdmi.list',
      'vdmi.findings',
      'observability.summary',
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

  // ── Parameter validation (CR-0001) ─────────────────────────────────────────

  describe('Parameter validation — structured 422 errors (CR-0001)', () => {
    describe('vnbOverview', () => {
      it('throws ValidationError for missing bdewCode', async () => {
        await expect(broker.call('dashboard-api.vnbOverview', {})).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([expect.objectContaining({ field: 'bdewCode' })]),
        });
      });

      it('throws ValidationError for non-numeric bdewCode', async () => {
        await expect(
          broker.call('dashboard-api.vnbOverview', { bdewCode: 'INVALID' })
        ).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'bdewCode',
              message: 'bdewCode muss 7-13 Ziffern enthalten (Beispiel: 9907473000008)',
            }),
          ]),
        });
      });

      it('throws ValidationError for bdewCode shorter than 7 digits', async () => {
        await expect(
          broker.call('dashboard-api.vnbOverview', { bdewCode: '12345' })
        ).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([expect.objectContaining({ field: 'bdewCode' })]),
        });
      });

      it('accepts a valid 13-digit BDEW code', async () => {
        handlers.vnbLookupCodes = () => MOCK_VNB_IDENTITY;
        handlers.vnbMonitorSnapshot = () => MOCK_VNB_MONITOR;
        const result = await broker.call('dashboard-api.vnbOverview', {
          bdewCode: '9907473000008',
        });
        expect(result).toHaveProperty('identity');
      });

      it('accepts a valid 7-digit BDEW code (BNR-style)', async () => {
        handlers.vnbLookupCodes = () => MOCK_VNB_IDENTITY;
        handlers.vnbMonitorSnapshot = () => MOCK_VNB_MONITOR;
        await expect(
          broker.call('dashboard-api.vnbOverview', { bdewCode: '9900992' })
        ).resolves.toBeDefined();
      });
    });

    describe('marketSnapshot', () => {
      it('throws ValidationError for single-character location', async () => {
        await expect(
          broker.call('dashboard-api.marketSnapshot', { location: 'X' })
        ).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'location',
              message: 'location muss mindestens 2 Zeichen lang sein',
            }),
          ]),
        });
      });

      it('throws ValidationError for single-character region', async () => {
        await expect(
          broker.call('dashboard-api.marketSnapshot', { region: 'X' })
        ).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'region',
              message: 'region muss mindestens 2 Zeichen lang sein',
            }),
          ]),
        });
      });

      it('accepts request without optional params', async () => {
        await expect(broker.call('dashboard-api.marketSnapshot', {})).resolves.toBeDefined();
      });
    });

    describe('qualitySummary', () => {
      it('throws ValidationError for gridOperatorId without SNB/GNB prefix', async () => {
        await expect(
          broker.call('dashboard-api.qualitySummary', { gridOperatorId: '12345' })
        ).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([
            expect.objectContaining({
              field: 'gridOperatorId',
              message:
                'gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)',
            }),
          ]),
        });
      });

      it('throws ValidationError for malformed GNB gridOperatorId', async () => {
        await expect(
          broker.call('dashboard-api.qualitySummary', { gridOperatorId: 'GNB' })
        ).rejects.toMatchObject({
          name: 'ValidationError',
          data: expect.arrayContaining([expect.objectContaining({ field: 'gridOperatorId' })]),
        });
      });

      it('accepts a valid SNB gridOperatorId', async () => {
        await expect(
          broker.call('dashboard-api.qualitySummary', { gridOperatorId: 'SNB935578300972' })
        ).resolves.toBeDefined();
      });

      it('accepts a valid GNB gridOperatorId', async () => {
        await expect(
          broker.call('dashboard-api.qualitySummary', { gridOperatorId: 'GNB100000000001' })
        ).resolves.toBeDefined();
      });

      it('accepts request without gridOperatorId (all operators)', async () => {
        await expect(broker.call('dashboard-api.qualitySummary', {})).resolves.toBeDefined();
      });
    });
  });
});
