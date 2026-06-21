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
      name: 'STROMDAO Netze GmbH',
      mastrId: 'SNB935578300972',
      bdew: '9907473000008',
      bnr: '10002345',
    },
  ],
};

const MOCK_VNB_MONITOR = {
  identity: { name: 'STROMDAO Netze GmbH', mastrId: 'SNB935578300972', bdewCode: '9907473000008' },
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

    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: makeHandler('capabilityBrokerRecommend', {
          capability: 'grid_connection_precheck',
          confidence: 0.91,
          recommendedCapabilities: [{ capability: 'grid_connection_precheck', confidence: 0.91 }],
          recommendedPlan: [{ action: 'grid-connection.list' }],
        }),
      },
    });

    broker.createService({
      name: 'knowledge-rag',
      actions: {
        query: makeHandler('knowledgeRagQuery', {
          results: [
            {
              sourceId: 'rag:chunk:1',
              sourceVersion: 'v1',
              collection: 'grid-connection',
              title: 'Netzanschluss Vorpruefung Leitfaden',
              score: 0.78,
            },
          ],
        }),
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
      expect(result.identity.name).toBe('STROMDAO Netze GmbH');
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
      expect(
        result.blockingEvidenceGaps.some((b) => b.code === 'REDISPATCH_EVIDENCE_MISSING')
      ).toBe(true);
      expect(
        result.blockingEvidenceGaps.some((b) => b.code === 'MASTERDATA_EVIDENCE_MISSING')
      ).toBe(true);
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

      expect(result.anomalySignals.dataQualityGap.some((f) => f.ref === 'GAP_DETECTION')).toBe(
        true
      );
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

  // ── redispatchCallQualityGate ─────────────────────────────────────────────

  describe('redispatchCallQualityGate', () => {
    it('returns a conservative data-quality gate with source actions and follow-ups', async () => {
      const result = await broker.call('dashboard-api.redispatchCallQualityGate', {
        gridOperatorId: 'SNB935578300972',
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
      });

      expect(result.found).toBe(true);
      expect(result.gateStatus).toBe('needs_metering_clarification');
      expect(result.callContext.gridOperatorId).toBe('SNB935578300972');
      expect(result.meteringReadiness.signal).toBe('red');
      expect(result.settlementReadiness.billingRelease).toBe(false);
      expect(result.sourceActions['redispatch-expost.list'].success).toBe(true);
      expect(result.sourceActions['edm-validation.validate'].success).toBe(true);
      expect(result.sourceActions['forecast-engine.evaluateQuality'].success).toBe(true);
      expect(
        result.missingDataPoints.some((item) => item.missingDataPoint === 'forecastQuality')
      ).toBe(true);
      expect(Array.isArray(result.nextActions)).toBe(true);
    });

    it('can classify a fully evidenced call as settlement candidate without releasing billing', async () => {
      handlers.edmValidationValidate = () => ({
        success: true,
        summary: { totalValues: 96, findings: 0, errors: 0, warnings: 0, dataQuality: 1 },
        findings: [],
      });
      handlers.forecastEvaluateQuality = () => ({
        success: true,
        quality: { rating: 'good', mape: 4.2 },
      });
      handlers.vdmiFindings = () => ({ count: 0, findings: [] });

      const result = await broker.call('dashboard-api.redispatchCallQualityGate', {
        gridOperatorId: 'SNB935578300972',
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
      });

      expect(result.gateStatus).toBe('ready_for_settlement');
      expect(result.settlementReadiness.status).toBe('candidate_ready');
      expect(result.settlementReadiness.billingRelease).toBe(false);
      expect(result.missingDataPoints).toEqual([]);
    });

    it('does not treat missing context as settlement-ready evidence', async () => {
      handlers.vdmiFindings = () => ({ count: 0, findings: [] });

      const result = await broker.call('dashboard-api.redispatchCallQualityGate', {
        gridOperatorId: 'SNB935578300972',
      });

      expect(result.gateStatus).toBe('needs_master_data_fix');
      expect(result.sourceActions['edm-validation.validate'].skipped).toBe(true);
      expect(
        result.missingDataPoints.some((item) => item.missingDataPoint === 'meloMaloMapping')
      ).toBe(true);
      expect(
        result.missingDataPoints.some((item) => item.missingDataPoint === 'loadProfileCompleteness')
      ).toBe(true);
    });

    it('isolates upstream failures as billing blockers', async () => {
      handlers.rdList = () => {
        throw new Error('redispatch down');
      };
      handlers.vdmiFindings = () => ({ count: 0, findings: [] });

      const result = await broker.call('dashboard-api.redispatchCallQualityGate', {
        gridOperatorId: 'SNB935578300972',
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
      });

      expect(result.gateStatus).toBe('blocked_for_billing');
      expect(result._errors).toContain('redispatch-expost.list');
      expect(
        result.missingDataPoints.some((item) => item.missingDataPoint === 'controlEvidence')
      ).toBe(true);
    });
  });

  // ── evidenceGroundingConfidenceAudit ──────────────────────────────────────

  describe('evidenceGroundingConfidenceAudit', () => {
    it('separates routing confidence from capped evidence confidence when operator evidence is missing', async () => {
      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Pruefe eine Anschluss-Vorpruefung mit Confidence Audit',
        scopeId: 'grid-area:demo',
      });

      expect(result.answerStatus).toBe('requires_operator_confirmation');
      expect(result.routingConfidence.score).toBeGreaterThan(0.8);
      expect(result.evidenceConfidence.score).toBeLessThan(0.5);
      expect(result.requiresNetworkOperatorConfirmation).toBe(true);
      expect(
        result.missingEvidence.some((item) => item.missingDataPoint === 'network_operator_confirmation')
      ).toBe(true);
      expect(result.sourceActions['capability-broker.recommend'].success).toBe(true);
      expect(result.sourceActions['knowledge-rag.query'].success).toBe(true);
    });

    it('marks missing scope as out_of_scope with positive follow-up', async () => {
      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Standort Vorpruefung fuer Netzanschluss',
      });

      expect(result.answerStatus).toBe('out_of_scope');
      expect(result.evidenceConfidence.level).toBe('low');
      expect(
        result.positiveFollowUps.some((item) => item.missingDataPoint === 'scope_filter_grid_area')
      ).toBe(true);
    });

    it('keeps hypothetical scenarios below high evidence confidence even with confirmation', async () => {
      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Hypothetisches Szenario fuer Anschlusskapazitaet',
        scopeId: 'grid-area:demo',
        datasourceId: 'datasource:operator',
        networkOperatorConfirmed: true,
      });

      expect(result.answerStatus).toBe('hypothetical_scenario');
      expect(result.evidenceConfidence.level).not.toBe('high');
      expect(result.evidenceConfidence.score).toBeLessThanOrEqual(0.62);
    });

    it('isolates read-only tool failures as degraded confidence', async () => {
      handlers.knowledgeRagQuery = () => {
        throw new Error('rag unavailable');
      };

      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Confidence Audit mit Toolausfall',
        scopeId: 'grid-area:demo',
        networkOperatorConfirmed: true,
      });

      expect(result.answerStatus).toBe('tool_degraded');
      expect(result.evidenceConfidence.level).toBe('low');
      expect(result._errors).toContain('knowledge-rag.query');
      expect(
        result.missingEvidence.some((item) => item.missingDataPoint === 'tool_failure_status')
      ).toBe(true);
    });

    it('can return ok for scoped operator-confirmed evidence', async () => {
      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Grounding Audit fuer bestaetigte Netzbetreiber Evidenz',
        scopeId: 'grid-area:demo',
        datasourceId: 'datasource:operator',
        datapointId: 'datapoint:confirmed:1',
        networkOperatorConfirmed: true,
      });

      expect(result.answerStatus).toBe('ok');
      expect(result.evidenceConfidence.level).toBe('high');
      expect(result.requiresNetworkOperatorConfirmation).toBe(false);
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
        'file-ingest-monitor',
        'redispatch-asset-register',
        'redispatch-data-governance',
        'redispatch-settlement-sandbox',
        'redispatch-special-case-gate',
        'redispatch-readiness-gate',
        'battery-redispatch-special-gate',
        'flexibility-conductor-role-model',
        'investment-maturity-off-balance-gate',
        'knowledge-continuity-governance-gate',
        'gas-capacity-order-revision-gate',
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

  // ── receiptGroundedPresentationContract ──────────────────────────────────

  describe('receiptGroundedPresentationContract', () => {
    it('blocks a VDMI renderer when the supplied source action and shape do not ground it', async () => {
      const result = await broker.call('dashboard-api.receiptGroundedPresentationContract', {
        preferredFormat: 'vdmi_matrix_table',
        sourceAction: 'mock.kpi',
        domainShape: 'kpi_fact',
      });

      expect(result.blockedReason).toBe('requested_renderer_not_grounded:vdmi_matrix_table');
      expect(result.allowedTypes).toContain('kpi_fact');
      expect(result.allowedTypes).not.toContain('vdmi_matrix_table');
      expect(result.sourceActions).toContain('mock.kpi');
      expect(result.dossierEvidence.blockedRendererReason).toBe(
        'requested_renderer_not_grounded:vdmi_matrix_table'
      );
    });

    it('allows VDMI renderer only with VDMI-shaped evidence and a VDMI source action', async () => {
      const result = await broker.call('dashboard-api.receiptGroundedPresentationContract', {
        preferredFormat: 'vdmi_matrix_table',
        selectedType: 'vdmi_matrix_table',
        sourceAction: 'vdmi.dossier',
        domainShape: 'vdmi_matrix',
      });

      expect(result.blockedReason).toBeNull();
      expect(result.allowedTypes).toContain('vdmi_matrix_table');
      expect(result.dossierEvidence.allowedPresentationTypes).toContain('vdmi_matrix_table');
    });
  });

  // ── marketCommunicationEvidenceChainStatus ───────────────────────────────

  describe('marketCommunicationEvidenceChainStatus', () => {
    it('keeps portal/provider material as hints and reports missing official evidence', async () => {
      const result = await broker.call('dashboard-api.marketCommunicationEvidenceChainStatus', {
        includeHints: true,
        portalHint: 'portal-screenshot-1',
        providerView: 'provider-view-1',
      });

      expect(result.status).toBe('hints_only');
      expect(result.officialEvidence).toEqual([]);
      expect(result.hintsOnly.map((item) => item.bindingStrength)).toEqual([
        'not_official_proof',
        'not_official_proof',
      ]);
      expect(result.missingEvidence.map((item) => item.missingDataPoint)).toEqual(
        expect.arrayContaining(['malo_identity', 'utilmd_masterdata_path', 'meter_values'])
      );
      expect(result.positiveFollowUps[0].enablesDossierAddition).toContain('official');
      expect(result.safety).toBe('read_only');
    });

    it('returns official_evidence_complete when all official evidence points are supplied', async () => {
      const result = await broker.call('dashboard-api.marketCommunicationEvidenceChainStatus', {
        maloId: 'DE-MALO-1',
        meloId: 'DE-MELO-1',
        utilmdMasterdataPath: 'utilmd:123',
        meterValueBatchId: 'mscons:123',
        consumptionRetrievalStatus: 'available',
        dataQualityStatus: 'usable',
        nextBillingStep: 'settlement_review',
      });

      expect(result.status).toBe('official_evidence_complete');
      expect(result.missingEvidence).toEqual([]);
      expect(result.officialEvidence.map((item) => item.bindingStrength)).toEqual(
        expect.arrayContaining(['official_evidence'])
      );
      expect(result.dossierFacts).toContain('Official evidence items: 7/7');
      expect(result.sourceActions.notCalled).toContain('settlement.exportA96');
      expect(result.sourceActions.notCalled).toContain('hitl.create');
    });
  });

  // ── e2eControllabilityGovernanceStatus ──────────────────────────────────

  describe('e2eControllabilityGovernanceStatus', () => {
    it('reports explicit governance gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.e2eControllabilityGovernanceStatus', {
        caseId: 'case-173',
        connectionIntake: 'grid-connection:ok',
        owner: 'netzanschluss',
      });

      expect(result.status).toBe('partial_governance_evidence');
      expect(result.processSteps.map((step) => step.id)).toContain('connection_intake');
      expect(result.evidenceMatrix.find((step) => step.stepId === 'connection_intake')).toMatchObject({
        evidenceStatus: 'provided',
        ownerRole: 'Netzanschluss',
      });
      expect(result.gaps.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['metering_concept', 'billing_impact_check', 'deadline'])
      );
      expect(result.positiveFollowUps[0].category).toBe('e2e_controllability_governance');
      expect(result.sourceActions.notCalled).toContain('hitl.create');
      expect(result.sourceActions.notCalled).toContain('grid-operations.executeControl');
      expect(result.safety).toBe('read_only');
    });

    it('returns governance_evidence_complete when all matrix facts are supplied', async () => {
      const result = await broker.call('dashboard-api.e2eControllabilityGovernanceStatus', {
        caseId: 'case-173',
        connectionIntake: 'grid-connection:ok',
        meteringConcept: 'taf-ready',
        assetControlCapability: 'asset-control-evidence',
        gridOperationsDecision: 'redispatch-ready',
        marketCommunicationHandover: 'mako-handover-ok',
        billingImpactCheck: 'billing-boundary-reviewed',
        owner: 'netzanschluss',
        deadline: '2026-07-01',
        openMeasure: 'close handover minutes',
      });

      expect(result.status).toBe('governance_evidence_complete');
      expect(result.gaps).toEqual([]);
      expect(result.dossierFacts).toContain('Covered governance steps: 6/6');
      expect(result.owners[0].value).toBe('netzanschluss');
      expect(result.openMeasures[0].value).toBe('close handover minutes');
    });
  });

  // ── controllabilityAssetHandoverStatus ─────────────────────────────────

  describe('controllabilityAssetHandoverStatus', () => {
    it('reports explicit asset-handover gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.controllabilityAssetHandoverStatus', {
        caseId: 'case-194',
        assetId: 'asset-194',
        mastrId: 'SEE-194',
        technicalStatus: 'technical-check-ok',
        lineOwnerRole: 'Assetmanagement',
      });

      expect(result.status).toBe('needs_feedback_capability');
      expect(result.asset).toMatchObject({
        assetId: 'asset-194',
        mastrId: 'SEE-194',
      });
      expect(result.evidenceItems.map((item) => item.id)).toEqual(
        expect.arrayContaining(['asset_inventory', 'technical_status', 'line_owner'])
      );
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'feedback_capability',
          'data_source_snapshot',
          'next_reporting_cycle',
          'handover_decision',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('controllability_asset_handover');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['hitl.create', 'assets.applyOverride', 'grid-operations.executeControl'])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_handover when all required handover facts are supplied', async () => {
      const result = await broker.call('dashboard-api.controllabilityAssetHandoverStatus', {
        caseId: 'case-194',
        assetId: 'asset-194',
        mastrId: 'SEE-194',
        napId: 'nap-194',
        meloId: 'melo-194',
        technologyType: 'battery',
        capacityKW: 750,
        controllabilityScope: 'redispatch-and-14a',
        technicalStatus: 'checked',
        feedbackCapability: 'bidirectional-feedback-ok',
        dataSourceRefs: ['asset-registry:snapshot-1'],
        sourceSnapshotId: 'snapshot-194',
        checkStatus: 'passed',
        nonExecutionReason: 'not-needed-in-current-cycle',
        evidenceStatus: 'complete',
        lineOwnerRole: 'Assetmanagement',
        handoverDecision: 'handover-approved',
        nextReportingCycle: '2026-Q3',
      });

      expect(result.status).toBe('ready_for_handover');
      expect(result.missingEvidence).toEqual([]);
      expect(result.handoverDecision).toBe('handover-approved');
      expect(result.nextReportingCycle).toBe('2026-Q3');
      expect(result.dossierEvidence.dossierFacts).toContain('Provided handover evidence: 10/10');
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });
  });

  // ── regulatoryChangeReadinessStatus ─────────────────────────────────────

  describe('regulatoryChangeReadinessStatus', () => {
    it('reports explicit regulatory readiness gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.regulatoryChangeReadinessStatus', {
        changeId: 'reg-change:eeg-2027',
        effectiveDate: '2027-01-01',
        mechanismType: 'EEG',
        dictionaryVersion: 'dd-v1',
      });

      expect(result.status).toBe('needs_interval_profile');
      expect(result.readinessScore).toBeGreaterThan(0);
      expect(result.evidenceItems.map((item) => item.id)).toEqual(
        expect.arrayContaining(['data_contract', 'dictionary_version'])
      );
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'source_datapoints',
          'interval_profile_coverage',
          'master_data_quality',
          'market_communication_cases',
          'audit_trail',
        ])
      );
      expect(result.generatedTestCaseRequirements.map((item) => item.requiredEvidence)).toContain(
        'interval_profile_coverage'
      );
      expect(result.positiveFollowUps[0].category).toBe('regulatory_change_readiness');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['settlement.exportA96', 'mako.dispatch', 'hitl.create', 'personal-agent.execute'])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_simulation when the evidence contract is complete', async () => {
      const result = await broker.call('dashboard-api.regulatoryChangeReadinessStatus', {
        changeId: 'reg-change:eeg-2027',
        effectiveDate: '2027-01-01',
        mechanismType: 'EEG',
        affectedSystems: ['edm', 'settlement'],
        dictionaryVersion: 'dd-v1',
        sourceDatapoints: ['dp-1', 'dp-2'],
        intervalCoverage: 'complete',
        masterDataStatus: 'usable',
        substituteValuePolicy: 'approved',
        makoCases: ['utilmd-special', 'billing-edge'],
        operatorDeclarationStatus: 'available',
        billingRuleReference: 'eeg-rule-v1',
        auditTrailStatus: 'auditable',
        testCasePackStatus: 'generated',
      });

      expect(result.status).toBe('ready_for_simulation');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided readiness evidence: 11/11');
      expect(result.sourceEvidence.makoCases).toEqual(['utilmd-special', 'billing-edge']);
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });
  });

  // ── investmentTwoTrackControlStatus ─────────────────────────────────────

  describe('investmentTwoTrackControlStatus', () => {
    it('reports explicit two-track investment gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.investmentTwoTrackControlStatus', {
        submissionId: 'submission-195',
        deadline: '2026-09-30',
        submissionFormat: 'finance-board-pack',
        tacticalOwner: 'Assetmanagement',
      });

      expect(result.status).toBe('needs_finance_review');
      expect(result.tacticalTrack).toMatchObject({
        owner: 'Assetmanagement',
        deadline: '2026-09-30',
        submissionFormat: 'finance-board-pack',
      });
      expect(result.evidenceItems.map((item) => item.id)).toEqual(
        expect.arrayContaining(['submission_contract', 'tactical_owner'])
      );
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'measures_and_budget',
          'finance_review',
          'board_format',
          'data_quality_plan',
          'approval_model',
          'handover_status',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('investment_two_track_control');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'settlement.prepareBilling',
          'sap.psp.write',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_submission when both investment tracks are complete', async () => {
      const result = await broker.call('dashboard-api.investmentTwoTrackControlStatus', {
        submissionId: 'submission-195',
        gridOperatorId: 'SNB195',
        deadline: '2026-09-30',
        submissionFormat: 'finance-board-pack',
        tacticalOwner: 'Assetmanagement',
        targetOwner: 'Strategic Asset Management',
        financeReviewStatus: 'reviewed',
        boardReadiness: 'board-pack-ready',
        dataQualityStatus: 'closure-plan-approved',
        approvalModel: 'roles-approved',
        handoverStatus: 'handover-ready',
        budgetEnvelopeEur: 1250000,
        measureCount: 4,
        sourceDatapoints: ['investment-plan:2026', 'asset-quality:snapshot-1'],
      });

      expect(result.status).toBe('ready_for_submission');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.tacticalTrack.readiness).toBe('5/5');
      expect(result.targetTrack.readiness).toBe('4/4');
      expect(result.dossierEvidence.dossierFacts).toContain('Tactical readiness: 5/5');
      expect(result.sourceActions.notCalled).toContain('finance-agent.mutate');
    });

    it('surfaces blocking approval evidence separately from tactical readiness', async () => {
      const result = await broker.call('dashboard-api.investmentTwoTrackControlStatus', {
        submissionId: 'submission-195',
        deadline: '2026-09-30',
        submissionFormat: 'finance-board-pack',
        tacticalOwner: 'Assetmanagement',
        financeReviewStatus: 'reviewed',
        boardReadiness: 'board-pack-ready',
        dataQualityStatus: 'closure-plan-approved',
        approvalModel: 'blocked',
      });

      expect(result.status).toBe('blocked_by_approval');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'ITC_APPROVAL_MODEL_BLOCKING'
      );
      expect(result.blockedDecisions).toEqual(expect.arrayContaining(['Target-process handover status']));
    });
  });

  // ── sapBudgetPspGateStatus ──────────────────────────────────────────────

  describe('sapBudgetPspGateStatus', () => {
    it('reports PSP and budget-owner gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.sapBudgetPspGateStatus', {
        measureId: 'measure:196',
        measureName: 'Trafostation Migration',
        migrationWave: 'wave-2026-q3',
        availableBudgetEur: 100000,
        plannedValueEur: 125000,
        committedValueEur: 5000,
      });

      expect(result.status).toBe('needs_psp_snapshot');
      expect(result.budgetEvidence).toMatchObject({
        availableBudgetEur: 100000,
        plannedValueEur: 125000,
        committedValueEur: 5000,
        effectiveBudgetGapEur: 30000,
      });
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['psp_snapshot', 'budget_owner', 'asset_benefit', 'sap_mapping'])
      );
      expect(result.positiveFollowUps[0].category).toBe('sap_budget_psp_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'sap.psp.write',
          'sap.budget.write',
          'finance-agent.mutate',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_finance_gate when SAP, PSP and finance evidence is complete', async () => {
      const result = await broker.call('dashboard-api.sapBudgetPspGateStatus', {
        measureId: 'measure:196',
        measureName: 'Trafostation Migration',
        migrationWave: 'wave-2026-q3',
        sapSystemRef: 'sap-s4-target',
        pspElementId: 'PSP-2026-4711',
        legacyInternalOrderId: 'IO-legacy-4711',
        availableBudgetEur: 200000,
        plannedValueEur: 125000,
        committedValueEur: 25000,
        pspCarryOverEur: 18000,
        assetBenefit: 'SAIDI risk reduction',
        priorityScore: 0.87,
        ownerRole: 'Finance Asset Owner',
        approvalStatus: 'approved',
        financeGate: 'board-pack-ready',
        dataQualityStatus: 'auditable',
        sourceSnapshotId: 'snapshot:sap-psp-196',
      });

      expect(result.status).toBe('ready_for_finance_gate');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.budgetEvidence.budgetOverhangEur).toBe(50000);
      expect(result.gateEvidence.ownerRole).toBe('Finance Asset Owner');
      expect(result.dossierEvidence.dossierFacts).toContain('Provided gate evidence: 9/9');
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });

    it('surfaces approval and data-quality blockers as explicit findings', async () => {
      const result = await broker.call('dashboard-api.sapBudgetPspGateStatus', {
        measureId: 'measure:196',
        measureName: 'Trafostation Migration',
        migrationWave: 'wave-2026-q3',
        sapSystemRef: 'sap-s4-target',
        pspElementId: 'PSP-2026-4711',
        legacyInternalOrderId: 'IO-legacy-4711',
        availableBudgetEur: 200000,
        plannedValueEur: 125000,
        committedValueEur: 25000,
        pspCarryOverEur: 18000,
        assetBenefit: 'SAIDI risk reduction',
        priorityScore: 0.87,
        ownerRole: 'Finance Asset Owner',
        approvalStatus: 'blocked',
        financeGate: 'board-pack-ready',
        dataQualityStatus: 'auditable',
        sourceSnapshotId: 'snapshot:sap-psp-196',
      });

      expect(result.status).toBe('blocked_by_approval');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'SBP_APPROVAL_BLOCKING'
      );
      expect(result.sourceActions.notCalled).toContain('sap.psp.write');
    });
  });

  // ── energyTaxInformationPackageStatus ──────────────────────────────────

  describe('energyTaxInformationPackageStatus', () => {
    it('reports package contract gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.energyTaxInformationPackageStatus', {
        packageId: 'etip:188',
        dataSourceId: 'datasource:tax-metering',
        dictionaryVersion: 'dd-v1',
      });

      expect(result.status).toBe('needs_period');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['period_definition', 'aggregation_logic', 'validation_status', 'responsible_owner', 'sla'])
      );
      expect(result.positiveFollowUps[0].category).toBe('energy_tax_information_package');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'tax.calculate',
          'package.release',
          'raw-data.copy',
          'finance-agent.mutate',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_handover when package evidence is complete', async () => {
      const result = await broker.call('dashboard-api.energyTaxInformationPackageStatus', {
        packageId: 'etip:188',
        dataSourceId: 'datasource:tax-metering',
        dictionaryVersion: 'dd-v1',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        aggregationLogic: 'quarterly grid-fee energy volumes by tax segment',
        validationStatus: 'validated',
        responsibleOwner: 'Tax Data Owner',
        contactRole: 'Finance Tax Desk',
        sla: 'P5D',
        auditReference: 'audit:energy-tax-2026-q1',
        handoverDecision: 'ready',
        sourceRefs: 'dictionary:dd-v1,datapoint:snapshot-188',
      });

      expect(result.status).toBe('ready_for_handover');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.packageContext.period).toBe('2026-01-01/2026-03-31');
      expect(result.handoverContext.responsibleOwner).toBe('Tax Data Owner');
      expect(result.evidenceRefs).toEqual(['dictionary:dd-v1', 'datapoint:snapshot-188']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided package evidence: 10/10');
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });

    it('surfaces validation and handover blockers as explicit findings', async () => {
      const result = await broker.call('dashboard-api.energyTaxInformationPackageStatus', {
        packageId: 'etip:188',
        dataSourceId: 'datasource:tax-metering',
        dictionaryVersion: 'dd-v1',
        period: '2026-Q1',
        aggregationLogic: 'quarterly totals',
        validationStatus: 'critical',
        responsibleOwner: 'Tax Data Owner',
        contactRole: 'Finance Tax Desk',
        sla: 'P5D',
        auditReference: 'audit:energy-tax-2026-q1',
        handoverDecision: 'blocked',
      });

      expect(result.status).toBe('blocked_by_validation');
      expect(result.blockingFindings.map((finding) => finding.code)).toEqual(
        expect.arrayContaining(['ETIP_VALIDATION_BLOCKING', 'ETIP_HANDOVER_DECISION_BLOCKING'])
      );
    });
  });

  // ── investmentRiskTranslationStatus ───────────────────────────────────

  describe('investmentRiskTranslationStatus', () => {
    it('reports translation gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.investmentRiskTranslationStatus', {
        sourceRef: 'gf-slide:191',
        sourceType: 'gf_slide',
        classification: 'decision_basis',
      });

      expect(result.status).toBe('needs_impact_context');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['period_division', 'impact_context', 'owner_role', 'decision_readiness', 'blocked_decision'])
      );
      expect(result.positiveFollowUps[0].category).toBe('investment_risk_translation_status');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'vdmi.create',
          'finance-agent.analyze',
          'investment-planning.createPlan',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_handover when translation evidence is complete', async () => {
      const result = await broker.call('dashboard-api.investmentRiskTranslationStatus', {
        sourceRef: 'gf-slide:191',
        sourceType: 'gf_slide',
        period: '2026-Q3',
        division: 'Stromnetz',
        classification: 'decision_basis',
        financialImpact: 'capex-risk 250000',
        assetImpact: 'substation renewal cluster',
        ownerRole: 'Asset Risk Owner',
        decisionReadiness: 'ready',
        blockedDecisionId: 'decision:capex-priority-q3',
        nextAction: 'prepare board handover',
        sourceSnapshot: 'snapshot:gf-slide-191',
        evidenceRefs: 'vdmi:evidence-1,finance:finding-2',
      });

      expect(result.status).toBe('ready_for_handover');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.translationContext.classification).toBe('decision_basis');
      expect(result.handoverContext.ownerRole).toBe('Asset Risk Owner');
      expect(result.evidenceRefs).toEqual(['vdmi:evidence-1', 'finance:finding-2']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided translation evidence: 10/10');
      expect(result.sourceActions.notCalled).toContain('hitl.create');
    });

    it('surfaces blocked decision readiness as an explicit finding', async () => {
      const result = await broker.call('dashboard-api.investmentRiskTranslationStatus', {
        sourceRef: 'risk-register:191',
        sourceType: 'risk_register',
        period: '2026-Q3',
        division: 'Stromnetz',
        classification: 'risk',
        financialImpact: 'opex exposure',
        assetImpact: 'asset ageing cluster',
        ownerRole: 'Risk Office',
        decisionReadiness: 'blocked',
        blockedDecisionId: 'decision:risk-budget',
        nextAction: 'clarify mitigation owner',
        sourceSnapshot: 'snapshot:risk-191',
        evidenceRefs: ['risk:evidence-1'],
      });

      expect(result.status).toBe('blocked_for_decision');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'IRTS_DECISION_READINESS_BLOCKING'
      );
    });
  });

  // ── budgetWaterfallGovernanceStatus ───────────────────────────────────

  describe('budgetWaterfallGovernanceStatus', () => {
    it('reports waterfall governance gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.budgetWaterfallGovernanceStatus', {
        waterfallId: 'bwg:189',
        period: '2026-Q3',
        division: 'Stromnetz',
      });

      expect(result.status).toBe('needs_baseline');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['baseline_reference', 'forecast_cutoff', 'sign_convention', 'approval_status'])
      );
      expect(result.positiveFollowUps[0].category).toBe('budget_waterfall_governance');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'finance-agent.mutate',
          'sap.psp.write',
          'investment-planning.createPlan',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_committee_review when governance evidence is complete', async () => {
      const result = await broker.call('dashboard-api.budgetWaterfallGovernanceStatus', {
        waterfallId: 'bwg:189',
        sourceId: 'source:budget-waterfall-q3',
        period: '2026-Q3',
        division: 'Stromnetz',
        baselineRef: 'baseline:approved-2026',
        forecastCutoff: '2026-09-30',
        carryoverLogic: 'approved carry-over shown as negative headroom movement',
        signConvention: 'positive value reduces remaining budget headroom',
        ownerRole: 'Controlling Governance',
        approvalStatus: 'approved_for_committee',
        followUpDecision: 'committee-review-q3',
        sourceSnapshotRef: 'snapshot:budget-waterfall-189',
        evidenceRef: 'finance:evidence-1,vdmi:evidence-2',
      });

      expect(result.status).toBe('ready_for_committee_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.waterfallContext.waterfallId).toBe('bwg:189');
      expect(result.governanceEvidence.signConvention).toContain('positive value');
      expect(result.evidenceRefs).toEqual(['finance:evidence-1', 'vdmi:evidence-2']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided waterfall governance evidence: 11/11');
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });

    it('surfaces blocking approval as an explicit finding', async () => {
      const result = await broker.call('dashboard-api.budgetWaterfallGovernanceStatus', {
        waterfallId: 'bwg:blocked',
        period: '2026-Q3',
        division: 'Stromnetz',
        baselineRef: 'baseline:approved-2026',
        forecastCutoff: '2026-09-30',
        carryoverLogic: 'carry-over documented',
        signConvention: 'positive reduces headroom',
        ownerRole: 'Controlling Governance',
        approvalStatus: 'blocked',
        followUpDecision: 'committee-review-q3',
        sourceSnapshotRef: 'snapshot:budget-waterfall-blocked',
        evidenceRef: ['finance:evidence-1'],
      });

      expect(result.status).toBe('blocked_by_approval_status');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'BWG_APPROVAL_STATUS_BLOCKING'
      );
    });
  });

  // ── gasDecommissioningRoadmapStatus ───────────────────────────────────

  describe('gasDecommissioningRoadmapStatus', () => {
    it('reports gas roadmap gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.gasDecommissioningRoadmapStatus', {
        roadmapId: 'gdr:190',
        currentPhase: 'risk-assessment',
      });

      expect(result.status).toBe('needs_owner');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'owner',
          'asset_risk_evidence',
          'dependency_map',
          'investment_impact_ref',
          'committee_gate_date',
          'execution_handover_owner',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('gas_decommissioning_roadmap_status');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'gas-transformation.executeDecommissioning',
          'customer-communication.dispatch',
          'investment-planning.createPlan',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_committee_gate when roadmap evidence is complete', async () => {
      const result = await broker.call('dashboard-api.gasDecommissioningRoadmapStatus', {
        roadmapId: 'gdr:190',
        currentPhase: 'committee-gate',
        owner: 'Netzstrategie',
        assetRiskEvidence: 'asset-risk:west-loop',
        dependencyMap: 'dependencies:heat-plan-h2',
        investmentImpactRef: 'investment:gas-retirement-q3',
        committeeGateDate: '2026-09-15',
        executionHandoverOwner: 'Netzbetrieb Gas',
        nextDecisionGate: 'committee:decommissioning-q3',
        sourceSnapshotRef: 'snapshot:gas-roadmap-190',
        evidenceRef: 'vdmi:evidence-1,finance:evidence-2',
      });

      expect(result.status).toBe('ready_for_committee_gate');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.roadmapContext.roadmapId).toBe('gdr:190');
      expect(result.phaseEvidence.investmentImpactRef).toBe('investment:gas-retirement-q3');
      expect(result.evidenceRefs).toEqual(['vdmi:evidence-1', 'finance:evidence-2']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided gas roadmap evidence: 11/11');
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });

    it('surfaces dependencies as explicit blockers', async () => {
      const result = await broker.call('dashboard-api.gasDecommissioningRoadmapStatus', {
        roadmapId: 'gdr:blocked',
        currentPhase: 'investment-impact',
        owner: 'Netzstrategie',
        assetRiskEvidence: 'asset-risk:west-loop',
        dependencyMap: 'dependencies:open-customer-communication',
        investmentImpactRef: 'investment:gas-retirement-q3',
        committeeGateDate: '2026-09-15',
        executionHandoverOwner: 'Netzbetrieb Gas',
        nextDecisionGate: 'committee:decommissioning-q3',
        sourceSnapshotRef: 'snapshot:gas-roadmap-blocked',
        evidenceRef: ['vdmi:evidence-1'],
        blocker: ['waermeplan-not-approved'],
      });

      expect(result.status).toBe('blocked_by_dependencies');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'GDR_DEPENDENCY_BLOCKER_PRESENT'
      );
    });
  });

  // ── jourFixeDecisionClosureStatus ─────────────────────────────────────

  describe('jourFixeDecisionClosureStatus', () => {
    it('reports Jour-fixe closure gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.jourFixeDecisionClosureStatus', {
        topicId: 'jf:186',
        topicTitle: 'Open investment decision',
      });

      expect(result.status).toBe('needs_owner');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'jour_fixe_context',
          'topic_owner',
          'kpi',
          'decision_criterion',
          'next_gate',
          'closure_status',
          'closure_proof',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('jour_fixe_decision_closure_tracker');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'meeting-transcription.ingest',
          'vdmi.create',
          'nova.createDecision',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns done when closure evidence is complete', async () => {
      const result = await broker.call('dashboard-api.jourFixeDecisionClosureStatus', {
        topicId: 'jf:186',
        topicTitle: 'Decision closure tracker',
        jourFixeId: 'jf-weekly-2026-06-20',
        owner: 'Netzstrategie',
        kpi: 'closure-rate>=90',
        decisionCriterion: 'committee-approved',
        nextGate: 'jf:2026-06-27',
        closureStatus: 'done',
        closureProof: 'minutes:decision-186',
        sourceSnapshotRef: 'snapshot:jf-186',
        evidenceRef: 'vdmi:evidence-1,nova:decision-2',
      });

      expect(result.status).toBe('done');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.topic.topicId).toBe('jf:186');
      expect(result.closureEvidence.owner).toBe('Netzstrategie');
      expect(result.evidenceRefs).toEqual(['vdmi:evidence-1', 'nova:decision-2']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided Jour-fixe closure evidence: 10/10');
      expect(result.sourceActions.notCalled).toContain('hitl.resolve');
    });

    it('keeps blocked follow-up actions visible as escalation evidence', async () => {
      const result = await broker.call('dashboard-api.jourFixeDecisionClosureStatus', {
        topicId: 'jf:blocker',
        topicTitle: 'Blocked owner decision',
        jourFixeId: 'jf-weekly',
        owner: 'Netzstrategie',
        kpi: 'owner-assigned',
        decisionCriterion: 'board-approval',
        nextGate: 'jf:next',
        closureStatus: 'open',
        blockedFollowUpAction: 'investment committee sign-off missing',
        sourceSnapshotRef: 'snapshot:blocker',
        evidenceRef: ['vdmi:evidence-1'],
      });

      expect(result.status).toBe('escalated');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'JFD_BLOCKED_FOLLOW_UP_ACTION'
      );
      expect(result.closureEvidence.blockedFollowUpAction).toBe(
        'investment committee sign-off missing'
      );
    });
  });

  // ── offBalancingMeteringPruefmatrixStatus ─────────────────────────────

  describe('offBalancingMeteringPruefmatrixStatus', () => {
    it('reports off-balancing metering gaps without creating downstream actions', async () => {
      const result = await broker.call('dashboard-api.offBalancingMeteringPruefmatrixStatus', {
        matrixId: 'obm:187',
        meteringScope: 'smart-meter-rollout-west',
        financingModel: 'leasing',
      });

      expect(result.status).toBe('needs_financier_terms');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'financier_conditions',
          'eog_regulatory_effect',
          'cost_recognition_assumption',
          'grid_investment_space_proof',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('off_balancing_metering_pruefmatrix');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'OBM_APPARENT_RELIEF_UNPROVEN'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'finance-agent.mutate',
          'sap.psp.write',
          'investment-planning.createPlan',
          'settlement.prepareBilling',
          'mako.dispatch',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_committee_review when pruefmatrix evidence is complete', async () => {
      const result = await broker.call('dashboard-api.offBalancingMeteringPruefmatrixStatus', {
        matrixId: 'obm:187',
        meteringScope: 'smart-meter-rollout-west',
        financingModel: 'leasing',
        decisionOwner: 'Finance Regulation Board',
        committeeGate: 'committee:metering-q3',
        capexOpexBaseline: 'baseline:capex-opex-2026',
        eogEffectEvidence: 'eog:scenario-metering-2027',
        costRecognitionAssumption: 'recognized as service cost with regulator caveat',
        financierConditions: 'covenants:exit-rights-documented',
        dataQualityStatus: 'metering-data-quality-green',
        interfaceRiskStatus: 'billing-mako-interface-risk-low',
        gridInvestmentSpaceProof: 'usable-grid-headroom:3.2m-eur',
        sourceSnapshotRef: 'snapshot:obm-187',
        evidenceRef: 'finance:evidence-1,eog:evidence-2',
      });

      expect(result.status).toBe('ready_for_committee_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.matrixContext.matrixId).toBe('obm:187');
      expect(result.financingEvidence.regulatoryEffectEvidence).toBe('eog:scenario-metering-2027');
      expect(result.gridInvestmentVerdict.usableGridInvestmentHeadroomProven).toBe(true);
      expect(result.evidenceRefs).toEqual(['finance:evidence-1', 'eog:evidence-2']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided off-balancing metering evidence: 13/13');
      expect(result.sourceActions.notCalled).toContain('billing.release');
    });

    it('marks apparent relief as not decision-ready when grid headroom is blocked', async () => {
      const result = await broker.call('dashboard-api.offBalancingMeteringPruefmatrixStatus', {
        matrixId: 'obm:blocking',
        meteringScope: 'smart-meter-rollout-west',
        financingModel: 'leasing',
        decisionOwner: 'Finance Regulation Board',
        committeeGate: 'committee:metering-q3',
        capexOpexBaseline: 'baseline:capex-opex-2026',
        regulatoryEffectEvidence: 'regulatory:scenario-metering-2027',
        costRecognitionAssumption: 'recognized as service cost with regulator caveat',
        financierConditions: 'covenants:exit-rights-documented',
        dataQualityStatus: 'metering-data-quality-green',
        interfaceRiskStatus: 'billing-mako-interface-risk-low',
        gridInvestmentSpaceProof: 'not usable for stromnetz investments',
        sourceSnapshotRef: 'snapshot:obm-blocking',
        evidenceRef: ['finance:evidence-1'],
      });

      expect(result.status).toBe('apparent_relief_not_decision_ready');
      expect(result.gridInvestmentVerdict.usableGridInvestmentHeadroomProven).toBe(false);
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'OBM_GRID_INVESTMENT_SPACE_BLOCKING'
      );
    });
  });

  // ── automationRequirementsDecisionValueStatus ──────────────────────────

  describe('automationRequirementsDecisionValueStatus', () => {
    it('reports tool-wish gaps without creating workflow or Office side effects', async () => {
      const result = await broker.call('dashboard-api.automationRequirementsDecisionValueStatus', {
        requirementId: 'ardv:181',
        requestTitle: 'Redispatch KPI PowerBI',
        requestType: 'PowerBI dashboard',
        processArea: 'redispatch',
        sourceSystem: 'edm',
        movingDataFlow: 'edm-to-powerbi',
        manualEffort: '4h weekly',
      });

      expect(result.status).toBe('needs_control_point');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'control_point',
          'decision_value',
          'follow_up_process',
          'rollback_or_stop_criterion',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('automation_requirements_decision_value');
      expect(result.blockingFindings.map((finding) => finding.code)).toContain(
        'ARDV_TOOL_WISH_WITHOUT_DECISION_VALUE'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'powerbi.createDashboard',
          'power-automate.createFlow',
          'office.connector.call',
          'workflow.create',
          'ticket.create',
          'hitl.create',
          'vdmi.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_requirements_review when decision-value evidence is complete', async () => {
      const result = await broker.call('dashboard-api.automationRequirementsDecisionValueStatus', {
        requirementId: 'ardv:181',
        requestTitle: 'Redispatch KPI PowerBI',
        requestType: 'PowerBI dashboard',
        processArea: 'redispatch',
        decisionOwner: 'Netzbetrieb',
        targetGate: 'requirements-review:q3',
        sourceSystem: 'edm',
        movingDataFlow: 'edm-to-powerbi',
        manualEffort: '4h weekly',
        controlPoint: 'redispatch deviation monitoring',
        decisionValue: 'weekly redispatch exception decision',
        followUpProcess: 'redispatch steering meeting',
        dataQuality: 'source freshness daily',
        rollbackOrStopCriterion: 'stop when no manual effort reduction after two cycles',
        sourceSnapshotRef: 'snapshot:ardv-181',
        evidenceRef: 'vdmi:card-181,edm:sample',
      });

      expect(result.status).toBe('ready_for_requirements_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.requirementContext.requirementId).toBe('ardv:181');
      expect(result.decisionEvidence.decisionValue).toBe('weekly redispatch exception decision');
      expect(result.evidenceRefs).toEqual(['vdmi:card-181', 'edm:sample']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided automation requirement evidence: 15/15');
      expect(result.sourceActions.notCalled).toContain('power-automate.createFlow');
    });
  });

  // ── smartMeterOffBalancingPurposeLockStatus ────────────────────────────

  describe('smartMeterOffBalancingPurposeLockStatus', () => {
    it('reports purpose-lock gaps without creating finance or HITL side effects', async () => {
      const result = await broker.call('dashboard-api.smartMeterOffBalancingPurposeLockStatus', {
        caseId: 'smopl:198',
        gridOperatorId: 'vnb-west',
        assetScope: 'smart-meter-rollout-west',
        financingModel: 'leasing',
        offBalanceVolumeEur: '1200000',
        freedLiquidityEur: '800000',
      });

      expect(result.status).toBe('needs_purpose_lock');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'purpose_lock_measures_missing',
          'regulatory_recognition_status',
          'finance_review_missing',
          'investment_effect_missing',
          'budget_dilution_risk_open',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('smart_meter_off_balancing_purpose_lock');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'finance-agent.mutate',
          'sap.psp.write',
          'investment-planning.createPlan',
          'billing.release',
          'settlement.prepareBilling',
          'mako.dispatch',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_committee_review when purpose-lock evidence is complete', async () => {
      const result = await broker.call('dashboard-api.smartMeterOffBalancingPurposeLockStatus', {
        caseId: 'smopl:198',
        gridOperatorId: 'vnb-west',
        assetScope: 'smart-meter-rollout-west',
        financingModel: 'service-lease',
        offBalanceVolumeEur: 1200000,
        freedLiquidityEur: 820000,
        financierCostEur: 64000,
        capexOpexTotexEffect: 'capex relief, opex service cost visible',
        regulatoryRecognitionStatus: 'recognized-with-regulatory-caveat',
        purposeLockedMeasures: 'leitwarte-upgrade,process-control-room-handover',
        controlRoomInvestments: 'scada-workbench',
        processInvestments: 'redispatch-process-training',
        gridInfrastructureInvestments: 'lv-feeder-sensors',
        budgetDilutionRisk: 'low-protected-by-committee-lock',
        financeReviewStatus: 'committee-ready',
        sourceSnapshotRef: 'snapshot:smopl-198',
        evidenceRef: 'finance:review-198,vdmi:purpose-lock-198',
      });

      expect(result.status).toBe('ready_for_committee_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.purposeLockContext.caseId).toBe('smopl:198');
      expect(result.financeSummary.freedLiquidityEur).toBe(820000);
      expect(result.purposeLockCoverage.purposeLockedMeasures).toEqual([
        'leitwarte-upgrade',
        'process-control-room-handover',
      ]);
      expect(result.investmentEffectEvidence.usableOperationalInvestmentEffect).toBe(true);
      expect(result.evidenceRefs).toEqual(['finance:review-198', 'vdmi:purpose-lock-198']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided purpose-lock evidence: 13/13');
      expect(result.sourceActions.notCalled).toContain('settlement.prepareBilling');
    });
  });

  // ── imsysScheduleValueChainReadinessStatus ─────────────────────────────

  describe('imsysScheduleValueChainReadinessStatus', () => {
    it('reports metering and forecast gaps without executing control side effects', async () => {
      const result = await broker.call('dashboard-api.imsysScheduleValueChainReadinessStatus', {
        caseId: 'isvc:199',
        gridOperatorId: 'vnb-west',
        meteringScope: 'imsys-rollout-west',
        sourceDatapoints: 'taf7-load,cls-status',
        dataQualityStatus: 'freshness-missing',
      });

      expect(result.status).toBe('needs_forecast_context');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'forecast_window',
          'congestion_signal',
          'controllability_status',
          'control_readiness',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('imsys_schedule_value_chain_readiness');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'device-control.execute',
          'cls.executeControl',
          'smgw.switch',
          'grid-operations.executeControl',
          'hitl.create',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_operation_review when value-chain evidence is complete', async () => {
      const result = await broker.call('dashboard-api.imsysScheduleValueChainReadinessStatus', {
        caseId: 'isvc:199',
        gridOperatorId: 'vnb-west',
        meteringScope: 'imsys-rollout-west',
        sourceDatapoints: 'taf7-load,cls-status',
        dataQualityStatus: 'green',
        forecastWindow: '2026-Q3 daily rolling',
        congestionSignal: 'lv-congestion:west-feeder-7',
        assetScope: 'nap:west-42,melo:west-42',
        controllabilityStatus: 'feedback-capable',
        flexibilityOptions: 'dim-40,shift-window',
        netzfahrplanAssessmentRef: 'fnav:assessment-199',
        operationalDecision: 'prepare control-room review',
        controlReadiness: 'ready-for-review',
        lineOwnerRole: 'Netzbetrieb Leitwarte',
        sourceSnapshotRef: 'snapshot:isvc-199',
        evidenceRef: 'datapoint:taf7,vdmi:handover',
      });

      expect(result.status).toBe('ready_for_operation_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.valueChainContext.caseId).toBe('isvc:199');
      expect(result.readinessEvidence.flexibilityOptions).toEqual(['dim-40', 'shift-window']);
      expect(result.evidenceRefs).toEqual(['datapoint:taf7', 'vdmi:handover']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided iMSys value-chain evidence: 14/14');
      expect(result.sourceActions.notCalled).toContain('grid-operations.executeControl');
    });
  });

  // ── clsDigitalTwinComplianceGateStatus ────────────────────────────────

  describe('clsDigitalTwinComplianceGateStatus', () => {
    it('reports compliance evidence gaps without creating procurement or control side effects', async () => {
      const result = await broker.call('dashboard-api.clsDigitalTwinComplianceGateStatus', {
        procurementId: 'proc-197',
        vendorId: 'vendor-cls',
        systemPurpose: 'cls-digital-twin-procurement-review',
        digitalTwinScope: 'lv-grid-digital-twin',
      });

      expect(result.status).toBe('needs_data_flow_map');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'data_flow_map',
          'roles_access_rights',
          'rbac_refs',
          'avv_status',
          'dsfa_status',
          'regulatory_evidence_status',
          'security_evidence_refs',
        ])
      );
      expect(result.blockedDecisions).toEqual(
        expect.arrayContaining(['vendor_procurement_approval', 'cls_interface_activation'])
      );
      expect(result.positiveFollowUps[0].category).toBe('cls_digital_twin_compliance_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'procurement.approve',
          'legal.approve',
          'dsfa.create',
          'rbac.grant',
          'hitl.create',
          'billing.release',
          'settlement.prepareBilling',
          'mako.dispatch',
          'cls.executeControl',
          'smgw.switch',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_procurement_review when compliance evidence is complete', async () => {
      const result = await broker.call('dashboard-api.clsDigitalTwinComplianceGateStatus', {
        procurementId: 'proc-197',
        vendorId: 'vendor-cls',
        systemPurpose: 'cls-digital-twin-procurement-review',
        digitalTwinScope: 'lv-grid-digital-twin',
        clsInterfaceScope: 'taf7-readonly-status',
        dataFlowMap: 'dfm:cls-dt-197',
        personalDataCategories: 'operator-user,technical-metering-ref',
        rolesAccessRights: 'netzleitwarte-read,assetmanagement-review',
        rbacRefs: 'rbac:cls-dt-197',
        avvStatus: 'available',
        ndaStatus: 'available',
        worksCouncilStatus: 'not-required-documented',
        dsfaStatus: 'screening-complete',
        billingModuleImpact: 'no-billing-mutation-review',
        regulatoryEvidenceStatus: 'bnetza-evidence-referenced',
        securityEvidenceRefs: 'iso27001:vendor,bsitr:cls-path',
        approvalStatus: 'green-for-procurement-review',
        sourceEvidenceRefs: 'vdmi:cls-197,datasource:flow-197',
        sourceSnapshot: 'snapshot:cls-197',
      });

      expect(result.status).toBe('ready_for_procurement_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.blockedDecisions).toEqual([]);
      expect(result.gateContext.procurementId).toBe('proc-197');
      expect(result.complianceEvidence.rolesAccessRights).toEqual([
        'netzleitwarte-read',
        'assetmanagement-review',
      ]);
      expect(result.complianceEvidence.securityEvidenceRefs).toEqual([
        'iso27001:vendor',
        'bsitr:cls-path',
      ]);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided CLS compliance evidence: 15/15');
      expect(result.sourceActions.notCalled).toContain('cls.executeControl');
    });
  });

  // ── legacyControlTechnologyTransitionStatus ───────────────────────────

  describe('legacyControlTechnologyTransitionStatus', () => {
    it('reports legacy control evidence gaps without executing control or HITL side effects', async () => {
      const result = await broker.call('dashboard-api.legacyControlTechnologyTransitionStatus', {
        assetGroupId: 'legacy-group-175',
        powerClass: 'lt-100kw',
        controlTechnology: 'rundsteuertechnik-gruppensignal',
      });

      expect(result.status).toBe('needs_feedback_capability');
      expect(result.controlReadiness).toBe('needs_evidence');
      expect(result.transitionStatus).toBe('legacy_operational');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'feedback_capability',
          'test_feasibility',
          'test_status',
          'non_execution_reason',
          'migration_roadmap',
        ])
      );
      expect(result.blockedDecisions).toEqual(
        expect.arrayContaining(['steuerbarkeitsnachweis', 'control_claim'])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'legacy_control_technology_transition'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'grid-operations.executeControl',
          'cls.executeControl',
          'smgw.switch',
          'device-control.execute',
          'hitl.create',
          'settlement.prepareBilling',
          'mako.dispatch',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_transition_review when transition evidence is complete', async () => {
      const result = await broker.call('dashboard-api.legacyControlTechnologyTransitionStatus', {
        assetGroupId: 'legacy-group-175',
        assetId: 'asset-rst-175',
        gridOperatorId: 'SNB935578300972',
        powerClass: 'lt-100kw',
        controlTechnology: 'rundsteuertechnik-gruppensignal',
        feedbackCapability: 'available-via-return-channel',
        switchingRisk: 'low-after-window-review',
        testFeasibility: 'testable-in-maintenance-window',
        testStatus: 'tested-ok',
        nonExecutionReason: 'not-needed-after-positive-test',
        targetTechnology: 'steuerbox-cls-target-process',
        migrationRoadmap: 'migration-planned-2026-q4',
        owner: 'Netzbetrieb',
        nextAction: 'review-roadmap-gate',
        sourceEvidenceRefs: 'asset:175,vdmi:rst-175',
        sourceSnapshot: 'snapshot:rst-175',
      });

      expect(result.status).toBe('ready_for_transition_review');
      expect(result.controlReadiness).toBe('proven');
      expect(result.transitionStatus).toBe('target_process_ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.transitionContext.assetGroupId).toBe('legacy-group-175');
      expect(result.transitionEvidence.feedbackCapability).toBe('available-via-return-channel');
      expect(result.sourceEvidence.sourceEvidenceRefs).toEqual(['asset:175', 'vdmi:rst-175']);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided legacy-control evidence: 12/12');
      expect(result.sourceActions.notCalled).toContain('grid-operations.executeControl');
    });
  });

  // ── controllabilitySubmissionCockpitStatus ────────────────────────────

  describe('controllabilitySubmissionCockpitStatus', () => {
    it('reports submission cockpit evidence gaps without creating HITL or control side effects', async () => {
      const result = await broker.call('dashboard-api.controllabilitySubmissionCockpitStatus', {
        submissionId: 'submission-176',
        submissionDeadline: '2026-07-01',
      });

      expect(result.status).toBe('needs_owner');
      expect(result.submissionReadiness).toBe('needs_owner');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'coordinator',
          'source_list',
          'data_reconciliation_status',
          'reason_catalog',
          'asset_group_statuses',
          'handover_decision',
          'handover_owner',
        ])
      );
      expect(result.blockedDecisions).toEqual(
        expect.arrayContaining(['submission_release', 'cycle_closure', 'technical_readiness_claim'])
      );
      expect(result.positiveFollowUps[0].category).toBe('controllability_submission_cockpit');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'grid-operations.executeControl',
          'cls.executeControl',
          'smgw.switch',
          'device-control.execute',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns submitted when submission cockpit evidence is complete', async () => {
      const result = await broker.call('dashboard-api.controllabilitySubmissionCockpitStatus', {
        submissionId: 'submission-176',
        submissionDeadline: '2026-07-01',
        coordinator: 'Netzbetrieb',
        sourceList: 'vdmi:176,edm:176,gridops:176',
        dataReconciliationStatus: 'reconciled',
        reasonCatalog: 'non-execution-reasons-complete,carry-over-reasons-complete',
        assetGroupStatuses: 'wp-ready,wallbox-carry-over',
        openMeasures: 'all-closed',
        handoverDecision: 'submitted',
        handoverOwner: 'Assetmanagement',
        nextCycleTasks: 'review-next-cycle',
        sourceEvidenceRefs: 'vdmi:176,datapoint:176',
        sourceSnapshot: 'snapshot:176',
      });

      expect(result.status).toBe('submitted');
      expect(result.submissionReadiness).toBe('submitted');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.submissionContext.coordinator).toBe('Netzbetrieb');
      expect(result.submissionEvidence.sourceList).toEqual(
        expect.arrayContaining(['vdmi:176', 'edm:176', 'gridops:176'])
      );
      expect(result.submissionEvidence.handoverDecision).toBe('submitted');
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: submitted',
          'Provided submission evidence: 12/12',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── crisisDecisionRoutineStatus ───────────────────────────────────────

  describe('crisisDecisionRoutineStatus', () => {
    it('reports crisis decision routine gaps without creating HITL, NOVA, VDMI or finance side effects', async () => {
      const result = await broker.call('dashboard-api.crisisDecisionRoutineStatus', {
        caseId: 'crisis-179',
        topic: 'Eskalation Netzbetrieb',
      });

      expect(result.status).toBe('needs_owner');
      expect(result.decisionReadiness).toBe('needs_owner');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'service_population_impact',
          'required_measures',
          'finance_impact',
          'knowledge_state',
          'training_operating_model_need',
          'owner',
          'next_gate',
        ])
      );
      expect(result.blockedDecisions).toEqual(
        expect.arrayContaining(['management_decision', 'operational_prioritisation', 'finance_commitment'])
      );
      expect(result.positiveFollowUps[0].category).toBe('crisis_decision_routine');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'nova.apply',
          'vdmi.mutate',
          'finance-agent.mutate',
          'operational-dispatch.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns decision_ready when crisis routine evidence is complete', async () => {
      const result = await broker.call('dashboard-api.crisisDecisionRoutineStatus', {
        caseId: 'crisis-179',
        topic: 'Eskalation Netzbetrieb',
        serviceImpact: 'call center and grid operations under stress',
        populationImpact: 'affected service group is heat-pump customers',
        requiredMeasures: 'prioritise hotline,freeze non-critical change',
        financeImpact: 'estimated 120000 EUR exposure',
        knowledgeState: 'evidence complete for management review',
        trainingNeed: 'train incident owners on evidence routine',
        owner: 'Netzbetrieb',
        nextGate: 'GF-Lage 2026-07-01',
        blockedFollowUp: 'finance commitment,operating model change',
        sourceEvidenceRefs: 'vdmi:179,finance:179',
        sourceSnapshot: 'snapshot:179',
      });

      expect(result.status).toBe('decision_ready');
      expect(result.decisionReadiness).toBe('decision_ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.routineContext.owner).toBe('Netzbetrieb');
      expect(result.routineEvidence.requiredMeasures).toEqual(
        expect.arrayContaining(['prioritise hotline', 'freeze non-critical change'])
      );
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: decision_ready',
          'Provided crisis routine evidence: 10/10',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── investmentCommitteeSteeringCardsStatus ─────────────────────────────

  describe('investmentCommitteeSteeringCardsStatus', () => {
    it('reports investment committee card gaps without creating HITL, VDMI, investment or finance side effects', async () => {
      const result = await broker.call('dashboard-api.investmentCommitteeSteeringCardsStatus', {
        investmentItemId: 'inv-182',
      });

      expect(result.status).toBe('needs_asset_project_reference');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'asset_project_reference',
          'review_status',
          'evidence_status',
          'committee_window',
          'owner',
          'blocked_follow_up_action',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('investment_committee_steering_cards');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'vdmi.mutate',
          'investment-planning.createPlan',
          'finance-agent.mutate',
          'budget.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_committee when committee-card evidence is complete', async () => {
      const result = await broker.call('dashboard-api.investmentCommitteeSteeringCardsStatus', {
        investmentItemId: 'inv-182',
        projectId: 'proj-182',
        assetId: 'asset-182',
        reviewStatus: 'technical-review-complete',
        evidenceStatus: 'complete',
        committeeWindow: '2026-Q3',
        owner: 'Assetmanagement',
        blockedFollowUpAction: 'committee-release',
        capexEur: '1200000',
        riskFlag: 'medium',
        sourceRef: 'sharepoint:inv-182,vdmi:182',
      });

      expect(result.status).toBe('ready_for_committee');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.cardContext.assetId).toBe('asset-182');
      expect(result.committeeContext.committeeWindow).toBe('2026-Q3');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['sharepoint:inv-182', 'vdmi:182']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_committee',
          'Provided card evidence: 8/8',
          'Open gaps: 0',
        ])
      );
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
