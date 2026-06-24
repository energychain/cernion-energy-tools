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

    broker.createService({
      name: 'stadtwerk-mauer-sandbox-runtime',
      actions: {
        status: makeHandler('stadtwerkMauerSandboxRuntimeStatus', {
          capabilityKey: 'stadtwerk_mauer_sandbox_runtime',
          safety: 'read_only_status_for_non_consequential_sandbox_runtime',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'empty_sandbox_ready_for_seed',
          eventCount: 0,
          artifactCount: 0,
          derivedStateInventory: {
            event_instance: 0,
            dossier_addition: 0,
            follow_up_proposal: 0,
            stub_transcript_placeholder: 0,
            outbox_queue_placeholder: 0,
            audit_artifact: 0,
          },
          resetDeleteReadiness: {
            canReset: true,
            canDelete: true,
            idempotent: true,
            scopedToTenant: 'stadtwerk-mauer',
            wouldDeleteArtifactCount: 0,
          },
          lastResetResult: null,
          missingLifecycleEvidence: [
            {
              missingDataPoint: 'seeded_demo_event',
              enablesDossierAddition: 'add deterministic Stadtwerk Mauer event trace',
            },
          ],
          positiveFollowUps: [
            {
              missingDataPoint: 'seeded_demo_event',
              enablesDossierAddition: 'add deterministic Stadtwerk Mauer event trace',
              category: 'stadtwerk_mauer_sandbox_runtime',
            },
          ],
          sourceActions: {
            inspected: ['stadtwerk-mauer-sandbox-runtime.status'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'billing.release', 'device-control.execute', 'personal-agent.execute'],
          },
          dossierEvidence: {
            status: 'empty_sandbox_ready_for_seed',
            tenantId: 'stadtwerk-mauer',
            eventCount: 0,
            artifactCount: 0,
            missingLifecycleEvidence: [{ missingDataPoint: 'seeded_demo_event' }],
            positiveFollowUps: [
              {
                enablesDossierAddition: 'add deterministic Stadtwerk Mauer event trace',
              },
            ],
            dossierFacts: ['Status: empty_sandbox_ready_for_seed', 'Sandbox events: 0'],
          },
        }),
      },
    });

    broker.createService({
      name: 'stadtwerk-mauer-external-interface-stubs',
      actions: {
        getStatus: makeHandler('stadtwerkMauerExternalInterfaceStubsStatus', {
          capabilityKey: 'stadtwerk_mauer_external_interface_stubs',
          safety: 'sandbox_only_non_consequential_stubs_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'stub_layer_ready_for_transcripts',
          transcriptCount: 0,
          artifactCount: 0,
          familyCounts: {},
          variantCounts: {},
          recentTranscripts: [],
          missingEvidence: [
            {
              missingDataPoint: 'stub_transcript',
              enablesDossierAddition: 'add first deterministic external-interface transcript',
            },
          ],
          positiveFollowUps: [
            {
              missingDataPoint: 'stub_transcript',
              enablesDossierAddition: 'add first deterministic external-interface transcript',
              category: 'stadtwerk_mauer_external_interface_stubs',
            },
          ],
          resetBoundary: {
            service: 'stadtwerk-mauer-sandbox-runtime.reset',
            scopedToTenant: 'stadtwerk-mauer',
          },
          sourceActions: {
            inspected: ['stadtwerk-mauer-external-interface-stubs.getStatus'],
            referenced: ['stadtwerk-mauer-sandbox-runtime.reset', 'object-store.query'],
            notCalled: ['mako.dispatch', 'billing.release', 'device-control.execute', 'personal-agent.execute'],
          },
          dossierEvidence: {
            status: 'stub_layer_ready_for_transcripts',
            tenantId: 'stadtwerk-mauer',
            transcriptCount: 0,
            artifactCount: 0,
            missingEvidence: [{ missingDataPoint: 'stub_transcript' }],
            positiveFollowUps: [
              {
                enablesDossierAddition: 'add first deterministic external-interface transcript',
              },
            ],
            dossierFacts: ['Stub Status: stub_layer_ready_for_transcripts', 'Transcripts: 0'],
          },
        }),
      },
    });

    broker.createService({
      name: 'stadtwerk-mauer-e2e-process-demo',
      actions: {
        getStatus: makeHandler('stadtwerkMauerE2eProcessDemoStatus', {
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_ready_for_run',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: null,
          traceCount: 0,
          artifactCount: 0,
          recentTraces: [],
          rolesAndCapabilities: [
            { role: 'Elektriker', capability: 'PV Anmeldung erfassen' },
            { role: 'Netzanschluss', capability: 'NAP/reference evidence check' },
          ],
          evidenceQuality: 'no_demo_trace_yet',
          missingEvidence: [
            {
              missingDataPoint: 'e2e_demo_trace',
              enablesDossierAddition: 'run the deterministic PV Anmeldung demo trace',
            },
          ],
          positiveFollowUps: [
            {
              missingDataPoint: 'e2e_demo_trace',
              enablesDossierAddition: 'run the deterministic PV Anmeldung demo trace',
              category: 'stadtwerk_mauer_e2e_process_demo',
            },
          ],
          resetBoundary: {
            service: 'stadtwerk-mauer-sandbox-runtime.reset',
            scopedToTenant: 'stadtwerk-mauer',
          },
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['stadtwerk-mauer-sandbox-runtime.ingestEvent', 'object-store.query'],
            notCalled: ['mako.dispatch', 'billing.release', 'external.connector.call', 'personal-agent.execute'],
          },
          dossierEvidence: {
            status: 'e2e_demo_ready_for_run',
            tenantId: 'stadtwerk-mauer',
            demoPath: 'pv_registration_electrician_missing_nap',
            caseId: null,
            traceCount: 0,
            artifactCount: 0,
            missingEvidence: [{ missingDataPoint: 'e2e_demo_trace' }],
            positiveFollowUps: [
              {
                enablesDossierAddition: 'run the deterministic PV Anmeldung demo trace',
              },
            ],
            dossierFacts: ['E2E Demo Status: e2e_demo_ready_for_run', 'Traces: 0'],
          },
        }),
      },
    });

    broker.createService({
      name: 'stadtwerk-mauer-mastr-data-overlay',
      actions: {
        getStatus: makeHandler('stadtwerkMauerMastrDataOverlayStatus', {
          capabilityKey: 'stadtwerk_mauer_mastr_data_overlay',
          safety: 'read_only_real_mastr_baseline_with_virtual_operator_overlay',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'blended_overlay_ready',
          municipality: 'Mauer',
          postalCode: '69256',
          assetCount: 2,
          totalCapacityKw: 20,
          typeCounts: { solar: 1, storage: 1 },
          originalGridOperators: [{ name: 'Syna GmbH', mastrId: 'SNB-SYNA', assetCount: 2 }],
          operatorOverlay: {
            mode: 'tenant_role_process_overlay',
            virtualGridOperator: { name: 'Stadtwerk Mauer' },
            realWorldOperatorHint: { name: 'Syna GmbH' },
            preservesOriginalMastrFacts: true,
            mutatesMastrRecords: false,
          },
          sampleAssets: [
            {
              mastrNummer: 'SEE-MAUER-001',
              originalGridOperatorName: 'Syna GmbH',
              virtualGridOperatorName: 'Stadtwerk Mauer',
            },
          ],
          evidenceQuality: 'real_mastr_baseline_with_virtual_operator_overlay',
          missingEvidence: [],
          positiveFollowUps: [],
          resetBoundary: {
            service: 'stadtwerk-mauer-sandbox-runtime.reset',
            deletesImportedMastrBaseline: false,
            deletesDerivedSandboxArtifacts: true,
          },
          sourceActions: {
            inspected: ['stadtwerk-mauer-mastr-data-overlay.getStatus'],
            referenced: ['energy-market.installations'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'mastr.write'],
          },
          dossierEvidence: {
            status: 'blended_overlay_ready',
            tenantId: 'stadtwerk-mauer',
            municipality: 'Mauer',
            postalCode: '69256',
            assetCount: 2,
            totalCapacityKw: 20,
            virtualGridOperatorName: 'Stadtwerk Mauer',
            realWorldOperatorHint: 'Syna GmbH',
            originalGridOperators: [{ name: 'Syna GmbH', mastrId: 'SNB-SYNA', assetCount: 2 }],
            sampleAssets: [{ mastrNummer: 'SEE-MAUER-001' }],
            dossierFacts: ['Overlay Status: blended_overlay_ready', 'MaStR Assets: 2'],
          },
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

  // -- legalClarificationOperatingModelStatus -----------------------------

  describe('legalClarificationOperatingModelStatus', () => {
    it('keeps pending legal clarification as a read-only blocker with explicit gaps', async () => {
      const result = await broker.call('dashboard-api.legalClarificationOperatingModelStatus', {
        caseId: 'case-141',
        clarificationPoint: 'Kapazitaetsfrage',
        affectedDecision: 'Anschlussfreigabe',
        legalStatus: 'pending',
        owner: 'Netzanschluss',
        noRegretDataNeeds: 'Netzmodell,Lastgang',
        scenarioOptions: 'Warten,Teilvorbereitung',
      });

      expect(result.status).toBe('pending_legal_clarification');
      expect(result.legalStatus).toBe('pending');
      expect(result.decisionReadiness).toBe('blocked_by_pending_legal_clarification');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['legal_status', 'owner_contact', 'red_lines', 'implementation_status'])
      );
      expect(result.positiveFollowUps[0].category).toBe('legal_clarification_operating_model');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['legal.approve', 'billing.release', 'grid-operations.executeControl'])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_after_legal_clearance only when legal and preparation evidence are complete', async () => {
      const result = await broker.call('dashboard-api.legalClarificationOperatingModelStatus', {
        caseId: 'case-141',
        clarificationPoint: 'Kapazitaetsfrage',
        affectedDecision: 'Anschlussfreigabe',
        legalStatus: 'approved',
        contractStatus: 'negotiated',
        owner: 'Netzanschluss',
        ownerContact: 'owner@example.test',
        noRegretDataNeeds: ['Netzmodell', 'Lastgang'],
        availableEvidence: ['netzmodell:v1', 'lastgang:2026-q2'],
        scenarioOptions: ['Teilvorbereitung'],
        redLines: ['no-dispatch-before-approval'],
        implementationStatus: 'prepared',
      });

      expect(result.status).toBe('ready_after_legal_clearance');
      expect(result.missingEvidence).toEqual([]);
      expect(result.preparationModel.rolesAndOwners.owner).toBe('Netzanschluss');
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Decision readiness: ready_after_legal_clearance'
      );
    });
  });

  // -- drReadinessEvidenceStatus -----------------------------------------

  describe('drReadinessEvidenceStatus', () => {
    it('reports missing DR evidence without executing backup, restore or tenant mutations', async () => {
      const result = await broker.call('dashboard-api.drReadinessEvidenceStatus', {
        tenantScope: 'public',
        storeInventoryStatus: 'ready',
        rtoTarget: '2h',
        owner: 'Operations',
      });

      expect(result.status).toBe('needs_snapshot_manifest');
      expect(result.readinessLevel).toBe('needs_evidence');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'snapshot_manifest',
          'restore_drill',
          'rpo_target',
          'per_tenant_restore',
          'next_drill_due',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('dr_readiness_evidence_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'backup.restore',
          'backup-orchestrator.schedule',
          'replication.start',
          'tenant.restore',
          'tenant-data.mutate',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_dr_evidence when DR readiness evidence is complete', async () => {
      const result = await broker.call('dashboard-api.drReadinessEvidenceStatus', {
        tenantScope: 'public',
        storeInventoryStatus: 'ready',
        snapshotManifestStatus: 'ready',
        restoreDrillStatus: 'passed',
        rtoTarget: '2h',
        rpoTarget: '1h',
        perTenantRestoreStatus: 'confirmed',
        owner: 'Operations',
        nextDrillDue: '2026-Q3',
      });

      expect(result.status).toBe('ready_for_dr_evidence');
      expect(result.readinessLevel).toBe('ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided DR evidence: 8/8');
    });
  });

  // -- fnavFastTrackContractGateStatus ------------------------------------

  describe('fnavFastTrackContractGateStatus', () => {
    it('reports control evidence blockers without executing contract or control actions', async () => {
      const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
        gateId: 'fnav-ft-221',
        gridOperatorId: 'SNB935578300972',
        requestType: 'storage',
        assetOrLoadType: 'battery',
        requestedCapacityKW: 2500,
        netzsignalPriorityPolicy: 'approved',
        scheduleObligation: 'ready',
        contractStatus: 'draft',
        legalStatus: 'approved',
        ownerContact: 'netzplanung',
        commercialImpact: 'ready',
      });

      expect(result.status).toBe('needs_control_evidence');
      expect(result.safety).toBe('read_only');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['metering_requirement', 'control_evidence_ref'])
      );
      expect(result.positiveFollowUps[0].category).toBe('fnav_fast_track_contract_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'contract.approve',
          'hitl.create',
          'device-control.execute',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_fast_track when all required evidence is present', async () => {
      const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
        gateId: 'fnav-ft-ready',
        gridOperatorId: 'SNB935578300972',
        requestType: 'data_center',
        assetOrLoadType: 'large_load',
        requestedCapacityKW: 10000,
        netzsignalPriorityPolicy: 'approved',
        scheduleObligation: 'confirmed',
        meteringRequirements: 'confirmed',
        controlEvidenceRef: 'ctrl-proof-1',
        contractStatus: 'signed',
        legalStatus: 'approved',
        ownerContact: 'vertrieb',
        commercialImpact: 'ready',
        marketingBoundaries: 'ready',
      });

      expect(result.status).toBe('ready_for_fast_track');
      expect(result.missingEvidence).toEqual([]);
      expect(result.evidenceStatus.provided).toBe(result.evidenceStatus.required);
      expect(result.dossierEvidence.dossierFacts).toContain('Status: ready_for_fast_track');
    });
  });

  // -- crossChannelVnbSignalQueueStatus -----------------------------------

  describe('crossChannelVnbSignalQueueStatus', () => {
    it('reports missing owner/source/evidence without executing queue or connector actions', async () => {
      const result = await broker.call('dashboard-api.crossChannelVnbSignalQueueStatus', {
        signalId: 'sig-218',
        channel: 'mail',
        affectedProcess: 'netzanschluss',
        riskType: 'owner_deadline',
        dueAt: '2026-07-01',
        nextDatapoint: 'owner-role',
      });

      expect(result.status).toBe('needs_owner');
      expect(result.safety).toBe('read_only');
      expect(result.signalCount).toBe(1);
      expect(result.normalizedSignals[0].contentPolicy).toBe(
        'references_and_summary_only_no_raw_private_content'
      );
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['owner', 'source_ref', 'evidence_status', 'dedupe_key'])
      );
      expect(result.positiveFollowUps[0].category).toBe('cross_channel_vnb_signal_queue');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'mail.connector.ingest',
          'persona-inbox.enqueue',
          'notification.dispatchInternal',
          'hitl.create',
          'vdmi.taskMutate',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_action for complete caller-supplied signal evidence', async () => {
      const result = await broker.call('dashboard-api.crossChannelVnbSignalQueueStatus', {
        signalId: 'sig-ready',
        channel: 'portal',
        sourceSystem: 'vnb-portal',
        sourceRef: 'portal:ticket-42',
        receivedAt: '2026-06-23T10:00:00Z',
        affectedProcess: 'redispatch',
        riskType: 'evidence_gap',
        riskSeverity: 'high',
        ownerRole: 'netzbetrieb',
        dueAt: '2026-12-31',
        evidenceStatus: 'ready',
        evidenceRefs: 'vdmi:case-42',
        nextDatapoint: 'redispatch-proof',
        dedupeKey: 'sig-ready:portal:42',
      });

      expect(result.status).toBe('ready_for_action');
      expect(result.missingEvidence).toEqual([]);
      expect(result.readyForActionSignals).toHaveLength(1);
      expect(result.byProcess.redispatch).toBe(1);
      expect(result.byRiskType.evidence_gap).toBe(1);
      expect(result.dossierEvidence.dossierFacts).toContain('Queue Status: ready_for_action');
    });
  });

  // -- assetValuationTransformationGateStatus ------------------------------

  describe('assetValuationTransformationGateStatus', () => {
    it('reports missing valuation evidence without executing asset or finance mutations', async () => {
      const result = await broker.call('dashboard-api.assetValuationTransformationGateStatus', {
        assetId: 'asset-219',
        transformationOption: 'h2-ready-repurpose',
        dataQualityStatus: 'medium',
        decisionOwner: 'asset-management',
      });

      expect(result.status).toBe('needs_book_value');
      expect(result.safety).toBe('read_only');
      expect(result.assetScope.assetId).toBe('asset-219');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'book_value_source',
          'asset_condition_source',
          'contract_risk_basis',
          'regulatory_uncertainty_basis',
          'next_decision',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('asset_valuation_transformation_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'valuation.recordCreate',
          'accounting.postingCreate',
          'assets.applyOverride',
          'investment.approve',
          'asset-lifecycle.decommission',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_gate for complete caller-supplied gate evidence', async () => {
      const result = await broker.call('dashboard-api.assetValuationTransformationGateStatus', {
        gateId: 'gate-219',
        assetGroupId: 'gas-line-north',
        assetType: 'gas_grid_segment',
        gridOperatorId: 'SNB219',
        bookValueStatus: 'provided',
        bookValueSource: 'erp:book-value-2026',
        assetConditionStatus: 'provided',
        assetConditionSource: 'inspection:2026',
        transformationOption: 'heat-grid-repurpose',
        transformationOptionBasis: 'waermeplanung:zone-7',
        contractRisk: 'reviewed',
        contractRiskBasis: 'contract:file-42',
        regulatoryUncertainty: 'bounded',
        regulatoryUncertaintyBasis: 'regulatory-note-9',
        dataQualityStatus: 'high',
        decisionOwner: 'netzentwicklung',
        nextDecision: 'investment-committee-q3',
        sourceDatapoints: 'erp:book-value-2026,inspection:2026',
      });

      expect(result.status).toBe('ready_for_gate');
      expect(result.missingEvidence).toEqual([]);
      expect(result.dossierEvidence.dossierFacts).toContain('Decision Readiness: ready_for_gate');
      expect(result.dossierEvidence.sourceDatapoints).toEqual(
        expect.arrayContaining(['erp:book-value-2026', 'inspection:2026'])
      );
    });

    it('blocks management readiness on low data quality', async () => {
      const result = await broker.call('dashboard-api.assetValuationTransformationGateStatus', {
        assetId: 'asset-low-quality',
        bookValueStatus: 'provided',
        assetConditionStatus: 'provided',
        transformationOption: 'decommission',
        contractRisk: 'reviewed',
        regulatoryUncertainty: 'bounded',
        dataQualityStatus: 'low',
        decisionOwner: 'finance',
        nextDecision: 'hold',
      });

      expect(result.status).toBe('blocked_by_low_data_quality');
      expect(result.dataQualityStatus.blocked).toBe(true);
    });
  });

  // -- gasCapacityBookingReviewGateStatus ---------------------------------

  describe('gasCapacityBookingReviewGateStatus', () => {
    it('reports missing gas booking review evidence without executing bookings or workflow mutations', async () => {
      const result = await broker.call('dashboard-api.gasCapacityBookingReviewGateStatus', {
        reviewId: 'gas-260',
        bookingYear: '2027',
        networkArea: 'gas-north',
        capacityAssumption: 'rlm-plus-12',
        vdmiOwner: 'gas-planning',
      });

      expect(result.status).toBe('needs_scenario_evidence');
      expect(result.safety).toBe('read_only');
      expect(result.reviewScope.networkArea).toBe('gas-north');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'cold_year_evidence',
          'rlm_rebound_evidence',
          'congestion_history_evidence',
          'decision_frame_ref',
          'commercial_signoff',
          'source_refs',
          'risk_scenarios',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('gas_capacity_booking_review_gate');
      expect(result.commercialSignoff.approvalClaimed).toBe(false);
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'gas-capacity-booking.submit',
          'upstream-network-operator.submitBooking',
          'vdmi.taskMutate',
          'hitl.create',
          'notification.dispatchInternal',
          'billing.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_review for complete caller-supplied review evidence', async () => {
      const result = await broker.call('dashboard-api.gasCapacityBookingReviewGateStatus', {
        reviewId: 'gas-ready-260',
        bookingYear: '2027',
        networkArea: 'gas-south',
        capacityAssumption: 'rlm-rebound-plus-12',
        capacityAssumptionSource: 'waermeplanung:reconciliation-42',
        coldYearEvidence: 'cold-year:2025-stress',
        rlmReboundEvidence: 'rlm:rebound-8pct',
        congestionHistoryEvidence: 'congestion:hist-2023-2026',
        vdmiOwner: 'gas-fachbereichsleitung',
        decisionFrameRef: 'decision-frame:gas-260',
        commercialSignoff: 'commercial-review-present',
        riskScenarios: 'underbooking,overbooking',
        sourceRefs: 'waermeplanung:42,decision-frame:gas-260',
      });

      expect(result.status).toBe('ready_for_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.scenarioEvidenceStatus.complete).toBe(true);
      expect(result.dossierEvidence.dossierFacts).toContain('Gate Status: ready_for_review');
      expect(result.dossierEvidence.sourceRefs).toEqual(
        expect.arrayContaining(['waermeplanung:42', 'decision-frame:gas-260'])
      );
    });
  });

  // -- specialGridUsageImpactMapStatus ------------------------------------

  describe('specialGridUsageImpactMapStatus', () => {
    it('reports missing special-grid-usage evidence without executing downstream actions', async () => {
      const result = await broker.call('dashboard-api.specialGridUsageImpactMapStatus', {
        caseId: 'sgu-201',
        caseType: 'stromnev19',
        applicationStatus: 'available',
        deadlineStatus: 'risk',
        ownerRole: 'Regulierungsmanagement',
      });

      expect(result.status).toBe('deadline_risk');
      expect(result.readinessLevel).toBe('risk');
      expect(result.deadlineRisk).toBe(true);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'form_status',
          'quantity_basis',
          'calculation_logic_ref',
          'billing_impact',
          'eog_impact',
          'tariff_impact',
          'communication_status',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('special_grid_usage_impact_map');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'legal.interpret',
          'settlement.prepareBilling',
          'tariff.mutate',
          'customer-service.send',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_processing when the impact map evidence is complete', async () => {
      const result = await broker.call('dashboard-api.specialGridUsageImpactMapStatus', {
        caseId: 'sgu-201',
        caseType: 'selfConsumption',
        customerId: 'cust-201',
        applicationStatus: 'complete',
        formStatus: 'complete',
        deadlineStatus: 'ok',
        quantityBasis: 'metered-2025',
        calculationLogicRef: 'par19-review-v1',
        billingImpact: 'billing-ref-201',
        eogImpact: 'eog-ref-201',
        tariffImpact: 'tariff-ref-201',
        communicationStatus: 'ready',
        ownerRole: 'Regulierungsmanagement',
        sourceDatapoints: ['dp-201'],
      });

      expect(result.status).toBe('ready_for_processing');
      expect(result.readinessLevel).toBe('ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.dossierEvidence.dossierFacts).toContain('Provided impact-map evidence: 10/10');
      expect(result.sourceDatapoints).toEqual(['dp-201']);
    });

    it('blocks readiness when regulatory uncertainty is explicit', async () => {
      const result = await broker.call('dashboard-api.specialGridUsageImpactMapStatus', {
        caseId: 'sgu-201',
        applicationStatus: 'complete',
        formStatus: 'complete',
        deadlineStatus: 'ok',
        quantityBasis: 'metered-2025',
        calculationLogicRef: 'par19-review-v1',
        billingImpact: 'billing-ref-201',
        eogImpact: 'eog-ref-201',
        tariffImpact: 'tariff-ref-201',
        communicationStatus: 'ready',
        ownerRole: 'Regulierungsmanagement',
        regulatoryUncertainty: 'unclear',
      });

      expect(result.status).toBe('blocked_by_regulatory_uncertainty');
      expect(result.readinessLevel).toBe('blocked');
      expect(result.missingEvidence[0].missingDataPoint).toBe('regulatory_uncertainty');
    });
  });

  // -- liquidityPlanningGovernanceStatus ----------------------------------

  describe('liquidityPlanningGovernanceStatus', () => {
    it('reports missing liquidity governance evidence without executing finance actions', async () => {
      const result = await broker.call('dashboard-api.liquidityPlanningGovernanceStatus', {
        planningRunId: 'liq-204',
        planningHorizon: '2026-Q3',
        sourceRegister: 'finance-source-register',
        dictionaryVersion: 'dict-v1',
        sapAccountSources: ['sap-1000'],
        validationRules: ['rule:liquidity-bounds'],
        ownerRaci: 'treasury-owner',
      });

      expect(result.status).toBe('blocked_by_unvalidated_cash_pool_logic');
      expect(result.readinessLevel).toBe('blocked');
      expect(result.evidenceItems.map((item) => item.id)).toEqual(
        expect.arrayContaining(['source_register', 'dictionary_version', 'sap_account_sources'])
      );
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'controlling_sources',
          'loan_tms_sources',
          'vat_logic_reference',
          'cash_pool_settlement_reference',
          'scenario_assumptions',
          'approval_evidence',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('liquidity_planning_governance_module');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'cashflow.calculate',
          'sap.connector.call',
          'payment.execute',
          'approval.release',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_treasury_review when governance evidence is complete', async () => {
      const result = await broker.call('dashboard-api.liquidityPlanningGovernanceStatus', {
        planningRunId: 'liq-204',
        planningHorizon: '2026-Q3',
        sourceRegister: 'finance-source-register',
        sapAccountSources: ['sap-1000'],
        controllingSourceIds: ['controlling-plan'],
        loanTmsSourceIds: ['tms-loan-book'],
        vatLogicRef: 'vat-logic-v1',
        cashPoolSettlementRef: 'cash-pool-rule-v1',
        dictionaryVersion: 'dict-v1',
        scenarioAssumptions: ['base-case'],
        validationRules: ['rule:liquidity-bounds'],
        sourceHealth: 'ready',
        ownerRaci: 'treasury-owner',
        correctionWorkflow: 'vdmi-correction',
        approvalStatus: 'reviewed',
      });

      expect(result.status).toBe('ready_for_treasury_review');
      expect(result.readinessLevel).toBe('ready');
      expect(result.missingEvidence).toEqual([]);
      expect(result.sourceCoverage.sapAccountSources).toEqual(['sap-1000']);
      expect(result.governanceState.approvalStatus).toBe('reviewed');
      expect(result.dossierEvidence.dossierFacts).toContain('Provided liquidity governance evidence: 11/11');
    });
  });

  // -- gasNetworkDecisionChainStatus --------------------------------------

  describe('gasNetworkDecisionChainStatus', () => {
    it('reports missing gas decision-chain evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.gasNetworkDecisionChainStatus', {
        chainId: 'gas-chain-255',
        gridOperatorId: 'vnb-gas',
        segmentId: 'segment-north',
        capacityAssumption: 'capacity-flat-until-2030',
      });

      expect(result.status).toBe('needs_decommissioning_path');
      expect(result.safety).toBe('read_only');
      expect(result.chainScope.segmentId).toBe('segment-north');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'decommissioning_path',
          'regulatory_impact_refs',
          'asset_book_value_refs',
          'photo_year_window',
          'owner',
          'blocked_follow_up_decision',
          'next_evidence_step',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('gas_network_decision_chain');
      expect(result.regulatoryImpactStatus.approvalClaimed).toBe(false);
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'gas-network-flow.calculate',
          'gas-capacity-booking.submit',
          'gas-transformation.executeDecommissioning',
          'investment.approve',
          'assets.applyOverride',
          'hitl.create',
          'billing.release',
          'settlement.prepareBilling',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_decision_chain_review for complete caller-supplied evidence', async () => {
      const result = await broker.call('dashboard-api.gasNetworkDecisionChainStatus', {
        chainId: 'gas-ready-255',
        gridOperatorId: 'vnb-gas',
        reconciliationId: 'recon-42',
        segmentId: 'segment-south',
        capacityAssumption: 'rlm-flat-with-reduction-from-2032',
        capacityEvidenceRef: 'capacity:assumption-255',
        decommissioningPath: 'partial-decommission-after-2035',
        decommissioningEvidenceRef: 'waermeplanung:segment-42',
        regulatoryImpactRef: 'regulatory:eog-kanu-255',
        eogRef: 'eog:quality-element-255',
        kanuRef: 'kanu:assessment-255',
        assetRef: 'asset:gas-line-42',
        bookValueRef: 'book:value-42',
        photoYear: '2026',
        decisionDeadline: '2026-09-30',
        ownerRole: 'asset_management',
        owner: 'gas-strategy-lead',
        gateStatus: 'open',
        blockedFollowUpDecision: 'investment-committee-2026-q4',
        nextEvidenceStep: 'attach-eog-kanu-note',
        sourceRefs: 'waermeplanung:42,decision-frame:255,asset:gas-line-42',
      });

      expect(result.status).toBe('ready_for_decision_chain_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.photoYearWindow.photoYear).toBe('2026');
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Decision Chain Status: ready_for_decision_chain_review'
      );
      expect(result.dossierEvidence.sourceRefs).toEqual(
        expect.arrayContaining(['waermeplanung:42', 'decision-frame:255', 'asset:gas-line-42'])
      );
    });
  });

  // -- waterPricingNetInvestmentAlignmentStatus ----------------------------

  describe('waterPricingNetInvestmentAlignmentStatus', () => {
    it('reports missing water-pricing alignment evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.waterPricingNetInvestmentAlignmentStatus', {
        caseId: 'water-259',
        waterPriceReference: 'wasserpreis:assumption-q3',
      });

      expect(result.status).toBe('needs_net_investment_reference');
      expect(result.safety).toBe('read_only');
      expect(result.alignmentScope.caseId).toBe('water-259');
      expect(result.pricingEvidence.officialPriceCalculated).toBe(false);
      expect(result.regulatoryBoundaryEvidence.approvalClaimed).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'net_investment_reference',
          'asset_accounting_reference',
          'lease_condition_reference',
          'regulatory_impact_reference',
          'governance_owner',
          'review_window',
          'alignment_decision',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'water_pricing_net_investment_alignment_gate'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'water-pricing.calculate',
          'asset-accounting.import',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'mako.dispatch',
          'contract.release',
          'payment.execute',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns committee_review_ready for complete caller-supplied evidence', async () => {
      const result = await broker.call('dashboard-api.waterPricingNetInvestmentAlignmentStatus', {
        caseId: 'water-ready-259',
        projectId: 'project-water-north',
        waterPriceReference: 'wasserpreis:calc-assumption-2026',
        netInvestmentReference: 'investment:water-grid-42',
        assetAccountingReference: 'anlagenbuchhaltung:asset-export-42',
        pachtnetzReference: 'pachtnetz:lease-42',
        regulatoryImpactReference: 'regulatory:water-impact-2026',
        governanceOwner: 'commercial-lead',
        reviewPeriod: '2026-Q3',
        targetCommitteeDate: '2026-09-30',
        alignmentDecision: 'committee-review-ready',
        sourceRefs: 'water:calc-42,asset:export-42,pachtnetz:lease-42',
      });

      expect(result.status).toBe('committee_review_ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.assetAccountingEvidence.accountingMutated).toBe(false);
      expect(result.leaseConditionEvidence.contractParsed).toBe(false);
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Alignment Status: committee_review_ready'
      );
      expect(result.dossierEvidence.sourceRefs).toEqual(
        expect.arrayContaining(['water:calc-42', 'asset:export-42', 'pachtnetz:lease-42'])
      );
    });
  });

  // -- arealNetworkIntegrationOfferGateStatus ------------------------------

  describe('arealNetworkIntegrationOfferGateStatus', () => {
    it('reports missing Areal offer-gate evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.arealNetworkIntegrationOfferGateStatus', {
        caseId: 'areal-269',
        siteReference: 'site-west',
        requestedConnectionCapacity: '12MW',
      });

      expect(result.status).toBe('needs_grid_capacity_evidence');
      expect(result.safety).toBe('read_only');
      expect(result.decisionScope.siteReference).toBe('site-west');
      expect(result.capacityEvidence.capacityReserved).toBe(false);
      expect(result.commercialAssumptionEvidence.bindingOfferGenerated).toBe(false);
      expect(result.regulatoryBoundaryEvidence.approvalClaimed).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'grid_capacity_evidence',
          'target_grid_path',
          'investment_capex_reference',
          'regulatory_impact_boundary',
          'commercial_offer_assumptions',
          'owner',
          'next_decision_date',
          'offer_decision_status',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'areal_network_integration_offer_gate'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'offer.calculate',
          'offer.generateBinding',
          'contract.accept',
          'grid-capacity.reserve',
          'target-grid.optimize',
          'investment.approve',
          'assets.applyOverride',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'mako.dispatch',
          'device-control.execute',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_offer_gate_review for complete caller-supplied evidence', async () => {
      const result = await broker.call('dashboard-api.arealNetworkIntegrationOfferGateStatus', {
        caseId: 'areal-ready-269',
        projectId: 'offer-project-west',
        siteReference: 'site-west',
        requestedConnectionCapacity: '12MW',
        gridCapacityEvidence: 'grid-capacity:ok-42',
        targetGridPath: 'znp:path-42',
        investmentReference: 'capex:42',
        regulatoryImpactBoundary: 'reg-impact:boundary-42',
        commercialOfferAssumptions: 'offer-assumption:v1',
        owner: 'commercial-lead',
        nextDecisionDate: '2026-09-30',
        offerDecisionStatus: 'review-ready',
        sourceRefs: 'grid:42,znp:42,capex:42',
      });

      expect(result.status).toBe('ready_for_offer_gate_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.targetGridEvidence.optimizerExecuted).toBe(false);
      expect(result.investmentEvidence.investmentApproved).toBe(false);
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Offer Gate Status: ready_for_offer_gate_review'
      );
      expect(result.dossierEvidence.sourceRefs).toEqual(
        expect.arrayContaining(['grid:42', 'znp:42', 'capex:42'])
      );
    });
  });

  // -- transformationFinancingScenarioViewStatus ---------------------------

  describe('transformationFinancingScenarioViewStatus', () => {
    it('reports missing transformation financing evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.transformationFinancingScenarioViewStatus', {
        scenarioId: 'tf-206',
        gridOperatorId: 'vnb-mauer',
        planningHorizon: '2026-2030',
        scenarioType: 'gas-heat-transition',
        cashflowSource: 'cashflow:base-42',
      });

      expect(result.status).toBe('needs_rollback_cost_basis');
      expect(result.safety).toBe('read_only');
      expect(result.scenarioSummary.scenarioId).toBe('tf-206');
      expect(result.evidenceGroups.assetTransition.gasAssetMutated).toBe(false);
      expect(result.evidenceGroups.operationalInvestment.investmentApproved).toBe(false);
      expect(result.evidenceGroups.committeeGate.hitlCreated).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'margin_compensation_assumption',
          'capital_reallocation_option',
          'gas_decommissioning_path',
          'rollback_cost_basis',
          'heat_h2_option_basis',
          'municipal_burden_basis',
          'operational_investment_need',
          'eog_regulatory_impact',
          'liquidity_impact_assumption',
          'stress_threshold',
          'committee_decision_gate',
          'source_datapoints',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'transformation_financing_scenario_view'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'finance.createBooking',
          'treasury.executeTransfer',
          'accounting.postJournal',
          'gas-assets.applyDecommissioning',
          'settlement.exportA96',
          'billing.prepareInvoice',
          'tariff.mutate',
          'mako.dispatch',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_decision for complete caller-supplied scenario evidence', async () => {
      const result = await broker.call('dashboard-api.transformationFinancingScenarioViewStatus', {
        scenarioId: 'tf-ready-206',
        gridOperatorId: 'vnb-mauer',
        planningHorizon: '2026-2030',
        scenarioType: 'gas-heat-transition',
        cashflowSource: 'cashflow:base-42',
        marginCompensationAssumption: 'margin:bridge-v1',
        capitalReallocationOption: 'cap-realloc:heat-h2-v1',
        gasDecommissioningPath: 'gas-path:zone-a',
        rollbackCostBasis: 'rollback:cost-model-42',
        heatInvestmentMeasure: 'heat:measure-42',
        municipalBurdenAssumption: 'municipal:burden-42',
        operationalInvestmentNeed: 'opex:need-42',
        eogImpact: 'eog:scenario-42',
        liquidityImpact: 'liquidity:stress-42',
        stressThreshold: 'threshold:dscr-1.2',
        committeeDecisionGate: 'committee:finance-board',
        owner: 'cfo-office',
        sourceDatapoints: 'cashflow:base-42,rollback:cost-model-42,eog:scenario-42',
      });

      expect(result.status).toBe('ready_for_decision');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.evidenceGroups.regulatoryFinance.authoritativeLegalInterpretation).toBe(false);
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Transformation Financing Status: ready_for_decision'
      );
      expect(result.dossierEvidence.sourceDatapoints).toEqual(
        expect.arrayContaining(['cashflow:base-42', 'rollback:cost-model-42', 'eog:scenario-42'])
      );
    });
  });

  // -- investmentOwnerDeadlineBudgetGateStatus -----------------------------

  describe('investmentOwnerDeadlineBudgetGateStatus', () => {
    it('reports missing investment gate evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.investmentOwnerDeadlineBudgetGateStatus', {
        measureId: 'measure-278',
        owner: 'netzbetrieb',
      });

      expect(result.status).toBe('needs_owner_deadline_budget_evidence');
      expect(result.safety).toBe('read_only');
      expect(result.measure.measureId).toBe('measure-278');
      expect(result.gateEvidence.budgetApproved).toBe(false);
      expect(result.gateEvidence.bookingCreated).toBe(false);
      expect(result.gateEvidence.hitlCreated).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'deadline',
          'budget_effect',
          'required_evidence',
          'approval_status',
          'blocked_follow_up_decision',
          'next_escalation_step',
          'source_datapoints',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'investment_owner_deadline_budget_gate'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'investment.approve',
          'budget.release',
          'finance.createBooking',
          'accounting.postJournal',
          'hitl.create',
          'settlement.exportA96',
          'tariff.mutate',
          'mako.dispatch',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_investment_gate_review for complete caller-supplied evidence', async () => {
      const result = await broker.call('dashboard-api.investmentOwnerDeadlineBudgetGateStatus', {
        measureId: 'measure-ready-278',
        measureTitle: 'Trafostation Rueckbaupfad',
        owner: 'investment-board',
        deadline: '2026-09-30',
        budgetEffect: 'capex-envelope-42',
        requiredEvidence: 'psp:4711,board-template:v1',
        approvalStatus: 'review-ready',
        blockedFollowUpDecision: 'portfolio-prioritization',
        nextEscalationStep: 'investment-committee-q3',
        sourceDatapoints: 'psp:4711,capex:42',
      });

      expect(result.status).toBe('ready_for_investment_gate_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.gateEvidence.budgetApproved).toBe(false);
      expect(result.gateEvidence.settlementExported).toBe(false);
      expect(result.gateEvidence.externalConnectorCalled).toBe(false);
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Investment Gate Status: ready_for_investment_gate_review'
      );
      expect(result.dossierEvidence.sourceDatapoints).toEqual(
        expect.arrayContaining(['psp:4711', 'capex:42'])
      );
    });
  });

  // -- noRegretMeasureDefinitionGateStatus --------------------------------

  describe('noRegretMeasureDefinitionGateStatus', () => {
    it('reports missing No-Regret definition evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.noRegretMeasureDefinitionGateStatus', {
        measureId: 'measure-279',
        programmeId: 'transformation-2030',
      });

      expect(result.status).toBe('needs_scenario_effect_basis');
      expect(result.safety).toBe('read_only');
      expect(result.measure.measureId).toBe('measure-279');
      expect(result.definitionEvidence.measureApproved).toBe(false);
      expect(result.definitionEvidence.budgetApproved).toBe(false);
      expect(result.definitionEvidence.hitlCreated).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'scenario_effect',
          'budget_funding',
          'regulatory_fit',
          'prioritisation_rule',
          'data_quality',
          'communication_rule',
          'review_gate',
          'source_datapoints',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'no_regret_measure_definition_gate'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'transformation-program.mutate',
          'measure.approve',
          'budget.release',
          'finance.createBooking',
          'accounting.postJournal',
          'hitl.create',
          'device-control.execute',
          'settlement.exportA96',
          'tariff.mutate',
          'mako.dispatch',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_no_regret_gate_review for complete caller-supplied evidence', async () => {
      const result = await broker.call('dashboard-api.noRegretMeasureDefinitionGateStatus', {
        measureId: 'measure-ready-279',
        programmeId: 'transformation-2030',
        measureName: 'No-Regret Trafostationsreserve',
        scenarioAssumption: 'stromlast-plus-2030',
        transformationEffect: 'keeps-option-open',
        budgetEffect: 'capex-buffer-42',
        fundingOwner: 'investment-office',
        regulatoryFit: 'enwg-compatible-assumption',
        prioritisationRule: 'no-regret-before-path-dependent',
        dataQualityStatus: 'source-reviewed',
        sourceSnapshot: 'snapshot:279',
        communicationRule: 'committee-briefing-required',
        stakeholderGroup: 'netzstrategie',
        nextReviewGate: 'portfolio-review-q3',
        dueDate: '2026-09-30',
        owner: 'transformation-board',
        sourceDatapoints: 'scenario:2030,budget:42,regulatory:fit',
      });

      expect(result.status).toBe('ready_for_no_regret_gate_review');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.definitionEvidence.measureApproved).toBe(false);
      expect(result.definitionEvidence.programmeMutated).toBe(false);
      expect(result.definitionEvidence.settlementExported).toBe(false);
      expect(result.definitionEvidence.externalConnectorCalled).toBe(false);
      expect(result.dossierEvidence.dossierFacts).toContain(
        'No-Regret Gate Status: ready_for_no_regret_gate_review'
      );
      expect(result.dossierEvidence.sourceDatapoints).toEqual(
        expect.arrayContaining(['scenario:2030', 'budget:42', 'regulatory:fit'])
      );
    });
  });

  // -- gasGridTransformationAssetCockpitStatus -----------------------------

  describe('gasGridTransformationAssetCockpitStatus', () => {
    it('reports missing gas transformation evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.gasGridTransformationAssetCockpitStatus', {
        gridOperatorId: 'vnb-mauer',
        transformationProgramId: 'gas-2030',
        workPackageId: 'wp-zone-a',
      });

      expect(result.status).toBe('needs_asset_scope');
      expect(result.safety).toBe('read_only');
      expect(result.programSummary.transformationProgramId).toBe('gas-2030');
      expect(result.evidenceGroups.assetScope.gasAssetMutated).toBe(false);
      expect(result.evidenceGroups.decommissioning.decommissioningApplied).toBe(false);
      expect(result.evidenceGroups.financialImpact.investmentApproved).toBe(false);
      expect(result.evidenceGroups.committeeGate.hitlCreated).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'asset_segment_scope',
          'target_option',
          'technical_reuse_status',
          'decommissioning_cost_basis',
          'financial_impact_basis',
          'dependency_review',
          'decision_gate_owner',
          'source_datapoints',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe(
        'gas_grid_transformation_asset_cockpit'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'gas-assets.applyDecommissioning',
          'gas-grid.optimizeTargetNetwork',
          'h2-feasibility.execute',
          'investment.approve',
          'finance.createBooking',
          'settlement.exportA96',
          'billing.prepareInvoice',
          'tariff.mutate',
          'mako.dispatch',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_committee for complete caller-supplied gas transformation evidence', async () => {
      const result = await broker.call('dashboard-api.gasGridTransformationAssetCockpitStatus', {
        gridOperatorId: 'vnb-mauer',
        transformationProgramId: 'gas-2030',
        workPackageId: 'wp-zone-a',
        assetSegmentRef: 'gas-segment-a',
        targetOption: 'h2_reuse',
        technicalReuseStatus: 'h2-ready-after-valve-upgrade',
        decommissioningCostEur: '1250000',
        rollbackOrRemovalRisk: 'medium-reviewed',
        cashflowImpact: 'cashflow:zone-a',
        totexImpact: 'totex:zone-a',
        regulatoryRecognitionStatus: 'regulatory:assumption-v1',
        heatNetworkDependency: 'heat:zone-a',
        powerGridDependency: 'power:zone-a',
        customerTransitionDependency: 'customers:zone-a',
        decisionGate: 'committee:q3-2026',
        ownerRole: 'asset-strategy',
        sourceDatapoints: 'asset:zone-a,cost:zone-a,finance:zone-a',
      });

      expect(result.status).toBe('ready_for_committee');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.evidenceGroups.technicalReuse.h2FeasibilityExecuted).toBe(false);
      expect(result.evidenceGroups.financialImpact.financeBookingCreated).toBe(false);
      expect(result.dossierEvidence.dossierFacts).toContain(
        'Gas Grid Transformation Status: ready_for_committee'
      );
      expect(result.dossierEvidence.sourceDatapoints).toEqual(
        expect.arrayContaining(['asset:zone-a', 'cost:zone-a', 'finance:zone-a'])
      );
    });
  });

  describe('leadershipDeltaCockpitStatus', () => {
    it('reports missing leadership delta evidence without executing mutations', async () => {
      const result = await broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
        topic: 'zielnetzplanung',
        domain: 'znp',
        newSignals: 'mastr-delta,znp-cost',
      });

      expect(result.capabilityKey).toBe('leadership_delta_cockpit');
      expect(result.safety).toBe('read_only');
      expect(result.status).toBe('delta_detected');
      expect(result.topics[0].deltaSummary.signalCount).toBe(2);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'missing_owner',
          'missing_due_date',
          'missing_evidence',
          'missing_linked_entity',
          'missing_source_signal',
        ])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'hitl.escalate',
          'nova.apply',
          'nova.approveDecision',
          'vdmi.taskMutate',
          'decision-frame.create',
          'ms365.sync',
          'external.connector.call',
          'settlement.exportA96',
          'billing.prepareInvoice',
          'tariff.mutate',
          'mako.dispatch',
          'personal-agent.execute',
        ])
      );
    });

    it('classifies blocked and escalated topics from caller-supplied evidence', async () => {
      const blocked = await broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
        topic: 'kapazitaetsbestellung',
        domain: 'grid',
        ownerRole: 'netzsteuerung',
        dueAt: '2026-Q3',
        evidenceStatus: 'partial',
        blockedDecision: 'kapazitaetsfreigabe',
        nextLever: 'unblock_decision',
        linkedEntities: 'znp:2030',
        sourceSignals: 'decision-frame,hitl',
      });
      expect(blocked.status).toBe('blocked');
      expect(blocked.topics[0].owner.role).toBe('netzsteuerung');
      expect(blocked.topics[0].blockedDecision).toBe('kapazitaetsfreigabe');
      expect(blocked.missingEvidence).toEqual([]);

      const escalated = await broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
        topic: 'regulatorik',
        ownerRole: 'regulatory',
        dueAt: '2026-07-01',
        evidenceStatus: 'complete',
        escalationState: 'escalated',
        linkedEntities: 'reg:42c',
        sourceSignals: 'hitl',
      });
      expect(escalated.status).toBe('escalated');
      expect(escalated.topics[0].escalation.escalated).toBe(true);
      expect(escalated.statusDistribution.escalated).toBe(1);

      await expect(
        broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
          topic: 'preise',
          evidenceStatus: 'missing',
        })
      ).resolves.toMatchObject({ status: 'evidence_gap' });
      await expect(
        broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
          topic: 'kapazitaet',
          evidenceStatus: 'ready',
        })
      ).resolves.toMatchObject({ status: 'decision_ready' });
      await expect(
        broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
          topic: 'bestand',
        })
      ).resolves.toMatchObject({ status: 'known' });
    });

    it('surfaces degraded source errors while keeping the response usable', async () => {
      const result = await broker.call('dashboard-api.leadershipDeltaCockpitStatus', {
        topic: 'assetstrategie',
        includeDegradedSample: true,
      });

      expect(result._errors).toContain('leadership-delta-cockpit.sampleSource');
      expect(result.topics).toHaveLength(1);
    });
  });

  describe('liveUpdateStreamContractStatus', () => {
    it('reports contract-ready live update channel evidence without opening streams', async () => {
      const result = await broker.call('dashboard-api.liveUpdateStreamContractStatus', {
        channels: 'hitl_queue',
        authBoundary: 'bearer_token_and_x_tenant_id',
      });

      expect(result.capabilityKey).toBe('live_update_stream_contract_status');
      expect(result.safety).toBe('read_only');
      expect(result.status).toBe('contract_ready');
      expect(result.channels[0]).toMatchObject({
        key: 'hitl_queue',
        proposedTransport: 'sse_eventsource',
        availability: 'planned',
        sourceService: 'hitl',
        sourceAction: 'list',
        fallbackPollingPath: '/api/hitl/items',
        authBoundary: 'bearer_token_and_x_tenant_id',
        contractComplete: true,
      });
      expect(result.missingEvidence).toEqual([]);
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'sse.openConnection',
          'websocket.upgrade',
          'stream.subscribe',
          'event-emitter.emit',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('surfaces missing and unsupported channel gaps as positive follow-ups', async () => {
      const result = await broker.call('dashboard-api.liveUpdateStreamContractStatus', {
        channels: 'unknown-domain',
      });

      expect(result.status).toBe('unsupported_channel');
      expect(result.channels[0].availability).toBe('not_supported');
      expect(result.channels[0].contractComplete).toBe(false);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'missing_source_service',
          'missing_source_action',
          'missing_fallback_polling_path',
          'unsupported_channel',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('live_update_stream_contract_status');
    });
  });

  describe('smgwConnectorReadinessStatus', () => {
    it('reports ready SMGW connector evidence without connector side effects', async () => {
      const result = await broker.call('dashboard-api.smgwConnectorReadinessStatus', {
        integrationScope: 'section14a_smgw_control',
        gatewayClass: 'bsi-tr-03109',
        adapterClass: 'openmuc-reference',
        controlDomainIntent: 'dimming-readiness',
        nes2ModuleEvidence: 'module-2-window-proof',
        eebusEvidence: 'wallbox-use-case-profile',
        tafEvidence: 'taf7-message-contract',
        auditPrerequisites: 'audit-trail-and-consent-boundary',
        authBoundary: 'bearer_token_and_x_tenant_id',
        ownerRole: 'flex-operations',
      });

      expect(result.capabilityKey).toBe('smgw_connector_readiness_status');
      expect(result.safety).toBe('read_only');
      expect(result.status).toBe('ready_for_connector_design');
      expect(result.readinessScore).toBe(1);
      expect(result.connectorReadiness).toMatchObject({
        integrationScope: 'section14a_smgw_control',
        gatewayClass: 'bsi-tr-03109',
        adapterClass: 'openmuc-reference',
        controlDomainIntent: 'dimming-readiness',
        authBoundary: 'bearer_token_and_x_tenant_id',
        ownerRole: 'flex-operations',
      });
      expect(result.missingEvidence).toEqual([]);
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'smgw.register',
          'smgw.control',
          'taf7.dispatch',
          'mqtt.publish',
          'eebus.bridge',
          'external.connector.call',
          'secret.read',
          'personal-agent.execute',
        ])
      );
    });

    it('surfaces SMGW readiness evidence gaps as positive follow-ups', async () => {
      const result = await broker.call('dashboard-api.smgwConnectorReadinessStatus', {
        integrationScope: 'section14a_smgw_control',
        adapterClass: 'voltaris-test',
      });

      expect(result.status).toBe('blocked_by_auth_boundary');
      expect(result.readinessScore).toBeLessThan(1);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'tenant_auth_boundary',
          'control_domain_intent',
          'nes2_module_evidence',
          'eebus_taf_evidence',
          'audit_prerequisites',
          'owner',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('smgw_connector_readiness_status');
      expect(result.connectorReadiness.fallbackReason).toContain('readiness evidence only');
    });
  });

  // -- energySharingSimulationGateStatus ----------------------------------

  describe('energySharingSimulationGateStatus', () => {
    it('keeps forecast candidates in learning-pilot mode without executing Energy-Sharing actions', async () => {
      const result = await broker.call('dashboard-api.energySharingSimulationGateStatus', {
        communityId: 'es-230',
        gridOperatorId: 'vnb-230',
        participantCount: '12',
        participantEvidenceRef: 'participants-v1',
        dataBasis: 'forecast',
        owner: 'product-owner',
        escalationContact: 'marktrolle-team',
      });

      expect(result.gateStatus).toBe('learning_pilot');
      expect(result.simulationStage).toBe('learning_pilot');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'malo_metering_readiness',
          'market_role_readiness',
          'settlement_a96_evidence',
          'contract_evidence',
          'economics_assumption',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('energy_sharing_simulation_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'energy-sharing-allocation.allocate',
          'settlement.exportA96',
          'mako.dispatch',
          'billing.release',
          'tariff.mutate',
          'hitl.create',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns billing_near_ready only with inhouse metering, market-role, A96, contract and economics evidence', async () => {
      const result = await broker.call('dashboard-api.energySharingSimulationGateStatus', {
        communityId: 'es-230',
        gridOperatorId: 'vnb-230',
        participantCount: '42',
        participantEvidenceRef: 'participants-v2',
        maloStatus: 'ready',
        meteringReadiness: 'ready',
        marketRoleReadiness: 'ready',
        dataBasis: 'inhouse-imsys-mscons',
        a96EvidenceRef: 'a96-ready',
        settlementEvidenceRef: 'settlement-ready',
        contractEvidenceRef: 'contracts-ready',
        economicsAssumptionRef: 'economics-v1',
        owner: 'energy-sharing-owner',
        escalationContact: 'billing-lead',
        sourceArtifacts: ['vdmi:es-230', 'settlement:a96-230'],
      });

      expect(result.gateStatus).toBe('billing_near_ready');
      expect(result.simulationStage).toBe('billing_near_ready');
      expect(result.missingEvidence).toEqual([]);
      expect(result.readinessBlocks.settlementReadiness.status).toBe('ready');
      expect(result.dossierEvidence.dossierFacts).toContain('Provided Energy-Sharing gate evidence: 9/9');
      expect(result.sourceActions.notCalled).toContain('energy-sharing-allocation.allocate');
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

  // ── investmentDataReviewQueueStatus ────────────────────────────────────

  describe('investmentDataReviewQueueStatus', () => {
    it('reports investment data review gaps without creating HITL, VDMI, investment or finance side effects', async () => {
      const result = await broker.call('dashboard-api.investmentDataReviewQueueStatus', {
        sourceId: 'source-171',
      });

      expect(result.status).toBe('needs_asset_project_reference');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'asset_project_reference',
          'quality_status',
          'division',
          'bottleneck_ref',
          'owner',
          'committee_window',
          'blocked_decision',
          'review_status',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('investment_data_review_queue');
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

    it('returns review_ready when investment data review evidence is complete', async () => {
      const result = await broker.call('dashboard-api.investmentDataReviewQueueStatus', {
        sourceId: 'datasource-171',
        dataPackageId: 'pkg-171',
        assetRef: 'asset-171',
        projectRef: 'project-171',
        qualityStatus: 'quality-reviewed',
        division: 'Assetmanagement',
        bottleneckRef: 'engpass-west-171',
        owner: 'Assetmanagement',
        committeeWindow: '2026-Q3',
        blockedDecision: 'CAPEX-Priorisierung fuer Projekt 171',
        reviewStatus: 'review-complete',
        sourceRef: 'datasource:171,hitl:review-171,vdmi:171',
      });

      expect(result.status).toBe('review_ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.reviewContext.qualityStatus).toBe('quality-reviewed');
      expect(result.reviewContext.bottleneckRef).toBe('engpass-west-171');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['datasource:171', 'vdmi:171']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: review_ready',
          'Provided review evidence: 10/10',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── flexStrategicDemandIntakeStatus ────────────────────────────────────

  describe('flexStrategicDemandIntakeStatus', () => {
    it('reports strategic Flex demand-intake gaps without creating HITL, NOVA, VDMI or finance side effects', async () => {
      const result = await broker.call('dashboard-api.flexStrategicDemandIntakeStatus', {
        topic: 'Fahrplanmanagement Flex-Portfolio priorisieren',
        affectedProcess: 'Netzbetrieb Fahrplanmanagement',
      });

      expect(result.status).toBe('needs_risk_of_inaction');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'risk_of_inaction',
          'commercial_question',
          'resource_conflict',
          'stop_doing_option',
          'owner',
          'next_decision_gate',
          'blocked_follow_up',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('flex_strategic_demand_intake');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'nova.createDecision',
          'nova.apply',
          'vdmi.mutate',
          'finance-agent.mutate',
          'tariff.mutate',
          'settlement.prepareBilling',
          'grid-operations.executeControl',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_intake when strategic Flex demand evidence is complete', async () => {
      const result = await broker.call('dashboard-api.flexStrategicDemandIntakeStatus', {
        demandId: 'flex-178',
        topic: 'Strategische Flexibilisierung fuer Quartiersfahrplaene',
        affectedProcess: 'Fahrplanmanagement / Netzbetrieb',
        riskOfInaction: 'Peak-shaving-Potenzial bleibt unpriorisiert',
        commercialQuestion: 'Welche CAPEX/OPEX-Entlastung ist realistisch?',
        resourceConflict: 'ZNP-Team und Netzbetrieb konkurrieren um Modellierungskapazitaet',
        stopDoingOption: 'Manuelle Excel-Priorisierung fuer Q3 stoppen',
        owner: 'Netzbetrieb',
        nextDecisionGate: 'Portfolio-Gate 2026-Q3',
        blockedFollowUp: 'NOVA-Optionsbewertung fuer Flex-Massnahmen',
        sourceRef: 'vdmi:flex-178,znp:portfolio-q3,finance:flex-review',
      });

      expect(result.status).toBe('ready_for_intake');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.intakeContext.owner).toBe('Netzbetrieb');
      expect(result.managementContext.stopDoingOption).toBe('Manuelle Excel-Priorisierung fuer Q3 stoppen');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['vdmi:flex-178', 'znp:portfolio-q3']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_intake',
          'Provided intake evidence: 10/10',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── gasInfrastructureRiskGovernanceStatus ─────────────────────────────

  describe('gasInfrastructureRiskGovernanceStatus', () => {
    it('reports gas infrastructure risk governance gaps without creating register, HITL, VDMI, asset or operations side effects', async () => {
      const result = await broker.call('dashboard-api.gasInfrastructureRiskGovernanceStatus', {
        caseId: 'gas-170',
        technicalFact: 'Hochdruckleitung HD-17 Druckhaltung auffaellig',
        impactArea: 'Netzkopplung West',
      });

      expect(result.status).toBe('needs_probability');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'probability',
          'criticality',
          'existing_mitigation',
          'threshold',
          'risk_register_decision',
          'owner',
          'next_decision_window',
          'blocked_follow_up',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('gas_infrastructure_risk_governance');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'gas-risk-register.create',
          'hitl.create',
          'vdmi.mutate',
          'assets.mutate',
          'grid-operations.executeControl',
          'operational-dispatch.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_risk_decision when formal gas risk evidence is complete', async () => {
      const result = await broker.call('dashboard-api.gasInfrastructureRiskGovernanceStatus', {
        caseId: 'gas-170',
        technicalFact: 'Hochdruckleitung HD-17 Druckhaltung auffaellig',
        impactArea: 'Netzkopplung West / Transformationskorridor',
        probability: 'medium',
        criticality: 'high',
        existingMitigation: 'monatliches Monitoring und Bereitschaftsplan',
        threshold: 'kritische Kopplung plus hohe Auswirkung',
        riskRegisterDecision: 'formal risk register',
        owner: 'Assetmanagement Gas',
        nextDecisionWindow: 'Risikogremium 2026-Q3',
        blockedFollowUp: 'formale Risikoaufnahme mit Massnahmenoption',
        sourceRef: 'vdmi:gas-170,hitl:risk-review-170,asset:hd-17',
      });

      expect(result.status).toBe('ready_for_risk_decision');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.riskContext.owner).toBe('Assetmanagement Gas');
      expect(result.riskEvidence.riskRegisterDecision).toBe('formal risk register');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['vdmi:gas-170', 'asset:hd-17']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_risk_decision',
          'Provided gas risk evidence: 11/11',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── meteringRolloutProcessIndicatorStatus ─────────────────────────────

  describe('meteringRolloutProcessIndicatorStatus', () => {
    it('reports metering rollout process gaps without creating datasource, EDM, HITL, finance or device-control side effects', async () => {
      const result = await broker.call('dashboard-api.meteringRolloutProcessIndicatorStatus', {
        division: 'Strom',
        sourceType: 'administrative-monthly-statistic',
        targetCount: 100,
      });

      expect(result.status).toBe('needs_actual_count');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'actual_count',
          'backlog_count',
          'data_quality_status',
          'contractor_load',
          'capex_impact',
          'opex_impact',
          'owner',
          'next_control_step',
          'blocked_follow_up',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('metering_rollout_process_indicator');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'datasource-cache.query',
          'edm.importTimeseries',
          'hitl.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'capex.decision',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns process_indicator_ready when metering rollout evidence is complete and backlog is low', async () => {
      const result = await broker.call('dashboard-api.meteringRolloutProcessIndicatorStatus', {
        indicatorId: 'metering-172',
        division: 'Strom/MSB',
        sourceType: 'administrative-monthly-statistic',
        targetCount: 1000,
        actualCount: 940,
        backlogCount: 60,
        dataQualityStatus: 'quality-reviewed',
        contractorLoad: 'normal',
        capexImpactEur: 25000,
        opexImpactEur: 7000,
        owner: 'Messstellenbetrieb',
        nextControlStep: 'Rollout-Steuerkreis 2026-Q3',
        blockedFollowUp: 'Dienstleister-Nachsteuerung fuer offene Wechsel',
        sourceRef: 'datasource:rollout-172,edm:summary-172,vdmi:172',
      });

      expect(result.status).toBe('process_indicator_ready');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.processEvidence.backlogRate).toBe(0.06);
      expect(result.indicatorContext.owner).toBe('Messstellenbetrieb');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['datasource:rollout-172', 'vdmi:172']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: process_indicator_ready',
          'Provided metering rollout evidence: 13/13',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── heatTransformationLineAssetModelStatus ─────────────────────────────

  describe('heatTransformationLineAssetModelStatus', () => {
    it('reports heat line asset model gaps without creating ZNP, asset, datapoint, VDMI, or finance side effects', async () => {
      const result = await broker.call('dashboard-api.heatTransformationLineAssetModelStatus', {
        division: 'Wärme',
        lineAssetId: 'segment-174',
      });

      expect(result.status).toBe('needs_geometry_ref');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'geometry_ref',
          'connected_point_asset_ids',
          'network_calculation_ref',
          'data_quality_status',
          'transformation_status',
          'future_option',
          'investment_need',
          'owner',
          'next_decision',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('heat_transformation_line_asset_model');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'znp.createProject',
          'znp.addLayer0',
          'znp.addAssumption',
          'assets.mutate',
          'datapoint.mutate',
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_transformation_decision when heat transformation line asset evidence is complete', async () => {
      const result = await broker.call('dashboard-api.heatTransformationLineAssetModelStatus', {
        lineAssetId: 'segment-174',
        division: 'Wärme/Stadtmitte',
        geometryRef: 'gis:poly-line-174',
        connectedPointAssetIds: 'point-asset-1,point-asset-2',
        networkCalculationRef: 'calc:hydraulic-174',
        dataQualityStatus: 'reviewed',
        transformationStatus: 'repurpose',
        futureOption: 'district_heating_network',
        investmentNeed: 1500000,
        owner: 'Assetmanagement Waerme',
        nextDecision: 'Waermeplanung-Ausschuss-2026',
        sourceRef: 'znp:graph-174,datapoint:174',
      });

      expect(result.status).toBe('ready_for_transformation_decision');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.lineEvidence.connectedPointAssetIds).toEqual(['point-asset-1', 'point-asset-2']);
      expect(result.modelContext.owner).toBe('Assetmanagement Waerme');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['znp:graph-174', 'datapoint:174']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_transformation_decision',
          'Provided heat transformation line-asset evidence: 12/12',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── kiFloorwalkerGovernanceStatus ──────────────────────────────────────

  describe('kiFloorwalkerGovernanceStatus', () => {
    it('reports KI floorwalker governance gaps without creating AI, HITL, or VDMI side effects', async () => {
      const result = await broker.call('dashboard-api.kiFloorwalkerGovernanceStatus', {
        useCaseId: 'uc-165',
        processOwner: 'Netzvertrieb',
      });

      expect(result.status).toBe('needs_use_case_priority');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'use_case_priority',
          'allowed_dataspaces',
          'prompt_standards',
          'process_boundaries',
          'roles_and_responsibilities',
          'guided_application',
          'risk_and_approval_status',
          'proof_of_benefit',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('ki_floorwalker_governance');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'openai.call',
          'hitl.create',
          'vdmi.mutate',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_floorwalker_application when KI floorwalker governance evidence is complete', async () => {
      const result = await broker.call('dashboard-api.kiFloorwalkerGovernanceStatus', {
        useCaseId: 'uc-165',
        processOwner: 'Netzvertrieb/KI-Lenkungskreis',
        useCasePriority: 'high-priority',
        allowedDataspaces: 'sap-sales,crm-contacts',
        promptStandards: 'pattern-v1',
        processBoundaries: 'sales-intake-only',
        rolesAndResponsibilities: 'owner:netzvertrieb,gov:kicoord',
        guidedApplication: 'training-session-completed',
        riskAndApprovalStatus: 'approved-conformant',
        proofOfBenefit: 'time-saved-20-percent',
        sourceRef: 'vdmi:165,cya:165',
      });

      expect(result.status).toBe('ready_for_floorwalker_application');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.governanceEvidence.allowedDataspaces).toEqual(['sap-sales', 'crm-contacts']);
      expect(result.governanceContext.processOwner).toBe('Netzvertrieb/KI-Lenkungskreis');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['vdmi:165', 'cya:165']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_floorwalker_application',
          'Provided KI floorwalker evidence: 9/9',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── investmentWaterfallGovernanceStatus ───────────────────

  describe('investmentWaterfallGovernanceStatus', () => {
    it('reports investment waterfall governance gaps without creating PMO or budget side effects', async () => {
      const result = await broker.call('dashboard-api.investmentWaterfallGovernanceStatus', {
        investmentItemId: 'item-163',
        targetProcess: 'Netzplanung-v1',
      });

      expect(result.status).toBe('needs_budget_amount');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'budget_amount',
          'bottleneck_ref',
          'committee_window',
          'evidence_readiness',
          'owner',
          'next_action',
          'mandate_status',
          'risk_if_delayed',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('investment_waterfall_governance');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'pmo-budget.create',
          'pmo-budget.allocate',
          'pmo-budget.mutate',
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

    it('returns ready_for_committee_decision when investment waterfall evidence is complete', async () => {
      const result = await broker.call('dashboard-api.investmentWaterfallGovernanceStatus', {
        investmentItemId: 'item-163',
        targetProcess: 'Netzplanung-v1',
        budgetAmount: '500000_eur',
        bottleneckRef: 'hs-trafo-bottleneck',
        committeeWindow: 'q3-2026',
        evidenceReadiness: 'all-clearance-provided',
        owner: 'Netzbetrieb/ZNP-Sparte',
        nextAction: 'final-budget-approval',
        mandateStatus: 'authorized',
        riskIfDelayed: 'high-overload-probability',
        sourceRef: 'vdmi:163,cya:163',
      });

      expect(result.status).toBe('ready_for_committee_decision');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.governanceEvidence.budgetAmount).toBe('500000_eur');
      expect(result.governanceContext.targetProcess).toBe('Netzplanung-v1');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['vdmi:163', 'cya:163']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_committee_decision',
          'Provided investment waterfall governance evidence: 9/9',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── imsysTaf2ComplianceStatus ─────────────────────────────

  describe('imsysTaf2ComplianceStatus', () => {
    it('reports imsys TAF2 compliance gaps without creating SMGW or database side effects', async () => {
      const result = await broker.call('dashboard-api.imsysTaf2ComplianceStatus', {
        meteringPointId: 'melo-161',
      });

      expect(result.status).toBe('needs_taf2_obligation');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'taf2_obligation',
          'target_deadline',
          'tariff_model',
          'implementation_status',
          'measured_value_access',
          'owner',
          'next_action',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'settlement.prepareBilling',
          'grid-operations.executeControl',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_compliance_decision when compliance evidence is complete', async () => {
      const result = await broker.call('dashboard-api.imsysTaf2ComplianceStatus', {
        meteringPointId: 'melo-161',
        taf2Obligation: true,
        targetDeadline: '2026-12-31',
        tariffModel: 'variable',
        implementationStatus: 'completed',
        measuredValueAccess: 'configured',
        owner: 'MSB',
        nextAction: 'none',
        sourceRef: 'EnWG_40,BSI_TR-03109',
      });

      expect(result.status).toBe('ready_for_compliance_decision');
      expect(result.readinessScore).toBe(1);
      expect(result.complianceScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.complianceEvidence.tariffModel).toBe('variable');
      expect(result.complianceContext.meteringPointId).toBe('melo-161');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['EnWG_40', 'BSI_TR-03109']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_compliance_decision',
          'Provided iMSys TAF2 compliance evidence: 8/8',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── capacityContractRiskAssetCockpitStatus ─────────────────────────────

  describe('capacityContractRiskAssetCockpitStatus', () => {
    it('reports capacity and contract risk gaps without creating risk databases, ZNP, or asset side effects', async () => {
      const result = await broker.call('dashboard-api.capacityContractRiskAssetCockpitStatus', {
        gridOperatorId: 'vnb-156',
      });

      expect(result.status).toBe('needs_utilization');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'utilization',
          'bottleneck',
          'contract_status',
          'legal_status',
          'capex',
          'opex',
          'owner',
          'next_action',
          'source_refs',
        ])
      );
      expect(result.positiveFollowUps[0].category).toBe('capacity_contract_risk_asset_cockpit');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'znp.createProject',
          'znp.addLayer0',
          'znp.addAssumption',
          'assets.mutate',
          'datapoint.mutate',
          'hitl.create',
          'vdmi.create',
          'vdmi.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_with_no_risk when capacity and contract evidence is complete and clear', async () => {
      const result = await broker.call('dashboard-api.capacityContractRiskAssetCockpitStatus', {
        gridOperatorId: 'vnb-156',
        utilization: 0.75,
        bottleneck: 'none',
        firmCapacityKW: 500,
        flexibleCapacityKW: 100,
        contractStatus: 'active',
        legalStatus: 'compliant',
        altvereinbarung: true,
        capex: 150000,
        opex: 12000,
        owner: 'Assetmanagement Netze',
        nextAction: 'regular_inspection',
        sourceRef: 'EnWG_14a,fNAV_V1',
      });

      expect(result.status).toBe('ready_with_no_risk');
      expect(result.readinessScore).toBe(1);
      expect(result.decisionStatus).toBe('approve');
      expect(result.riskLevel).toBe('low');
      expect(result.missingEvidence).toEqual([]);
      expect(result.technicalCapacity.utilization).toBe(0.75);
      expect(result.contractBoundary.status).toBe('active');
      expect(result.financialImpact.capex).toBe(150000);
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['EnWG_14a', 'fNAV_V1']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_with_no_risk',
          'Provided capacity and contract risk evidence: 9/9',
          'Open gaps: 0',
        ])
      );
    });

    it('identifies critical risk and rejects when utilization is overloaded', async () => {
      const result = await broker.call('dashboard-api.capacityContractRiskAssetCockpitStatus', {
        gridOperatorId: 'vnb-156',
        utilization: 1.45,
        bottleneck: 'critical_overload',
        firmCapacityKW: 500,
        flexibleCapacityKW: 100,
        contractStatus: 'active',
        legalStatus: 'compliant',
        altvereinbarung: true,
        capex: 150000,
        opex: 12000,
        owner: 'Assetmanagement Netze',
        nextAction: 'escalation_to_grid_pmo',
        sourceRef: 'EnWG_14a',
      });

      expect(result.status).toBe('ready_with_risk_findings');
      expect(result.decisionStatus).toBe('reject_or_escalate');
      expect(result.riskLevel).toBe('critical');
    });
  });

  // ── scheduleManagementGovernanceRoadmapStatus ─────────────────────────────

  describe('scheduleManagementGovernanceRoadmapStatus', () => {
    it('reports schedule management governance roadmap gaps without creating stateful scheduling or database side effects', async () => {
      const result = await broker.call('dashboard-api.scheduleManagementGovernanceRoadmapStatus', {
        meteringPointId: 'melo-153',
      });

      expect(result.status).toBe('needs_target_state');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'target_state',
          'capability_maturity',
          'data_objects',
          'system_integrations',
          'role_ownership',
          'redispatch_boundary',
          'fnav_readiness',
          'capacity_management_gaps',
          'roadmap_items',
          'decision_meetings',
          'owner',
          'next_action',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'grid-operations.executeControl',
          'external.connector.call',
          'personal-agent.execute',
          'finance-agent.mutate',
          'settlement.prepareBilling',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns operational when roadmap evidence is complete', async () => {
      const result = await broker.call('dashboard-api.scheduleManagementGovernanceRoadmapStatus', {
        meteringPointId: 'melo-153',
        targetState: 'target_fnav_ready',
        capabilityMaturity: 'concept',
        dataObjects: 'Anschlussbegehren, Netzfahrplan',
        systemIntegrations: 'EDM, Redispatch-Ex-Post',
        roleOwnership: 'Assetmanagement, Netzbetrieb',
        redispatchBoundary: 'redispatch_2.0_not_intersected',
        fnavReadiness: 'validation_pending',
        capacityManagementGaps: 'missing_storage_tariffs',
        roadmapItems: 'define_roles, validate_edm_channels',
        decisionMeetings: 'Q3_steering_committee',
        owner: 'Netzbetrieb',
        nextAction: 'define_target_state',
        sourceRef: 'EnWG_14a,fNAV_V1',
      });

      expect(result.status).toBe('operational');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.complianceEvidence.targetState).toBe('target_fnav_ready');
      expect(result.complianceContext.meteringPointId).toBe('melo-153');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['EnWG_14a', 'fNAV_V1']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: operational',
          'Provided Fahrplanmanagement governance roadmap evidence: 13/13',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── gasTransformationDependencyMapStatus ─────────────────────────────

  describe('gasTransformationDependencyMapStatus', () => {
    it('reports gas transformation dependency map gaps without creating stateful databases or mutation side effects', async () => {
      const result = await broker.call('dashboard-api.gasTransformationDependencyMapStatus', {
        projectId: 'project-155',
      });

      expect(result.status).toBe('needs_division');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'division',
          'nodes',
          'dependencies',
          'data_quality_gaps',
          'investment_paths',
          'decommission_repurpose_paths',
          'customer_groups',
          'owner',
          'next_action',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'znp.addAssumption',
          'assets.mutate',
          'datapoint.mutate',
          'finance-agent.mutate',
          'investment-planning.createPlan',
          'vdmi.mutate',
          'personal-agent.execute',
          'external.connector.call',
        ])
      );
      expect(result.safety).toBe('read_only');
    });

    it('returns ready_for_transformation_decision when dependency map evidence is complete', async () => {
      const result = await broker.call('dashboard-api.gasTransformationDependencyMapStatus', {
        projectId: 'project-155',
        division: 'Gas',
        nodes: 'h2_ready, heat_network',
        dependencies: 'depends_on_evidence',
        dataQualityGaps: 'missing_geothermal_potential',
        investmentPaths: 'H2_repurposing_plan',
        decommissionRepurposePaths: 'repurposing_east_sector',
        customerGroups: 'industrial_remaining_groups',
        owner: 'Assetmanagement Gas',
        nextAction: 'define_transformation_options',
        sourceRef: 'GasTransformation_2045,H2_Readiness_Doc',
      });

      expect(result.status).toBe('ready_for_transformation_decision');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.complianceEvidence.division).toBe('Gas');
      expect(result.complianceContext.projectId).toBe('project-155');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['GasTransformation_2045', 'H2_Readiness_Doc']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_transformation_decision',
          'Provided Gasnetztransformation dependency map evidence: 10/10',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── gridConnectionTransformationGateStatus ─────────────────────────────

  describe('gridConnectionTransformationGateStatus', () => {
    it('reports grid connection transformation gate gaps without creating stateful databases or mutation side effects', async () => {
      const result = await broker.call('dashboard-api.gridConnectionTransformationGateStatus', {
        meteringPointId: 'melo-144',
      });

      expect(result.status).toBe('needs_division');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'division',
          'transformation_option',
          'data_quality_status',
          'investment_path',
          'decommission_path',
          'owner',
          'next_action',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toContain('hitl.create');
    });

    it('returns ready_for_transformation_decision and correct gateStatus when all evidence is complete', async () => {
      const result = await broker.call('dashboard-api.gridConnectionTransformationGateStatus', {
        meteringPointId: 'melo-144',
        division: 'Gas',
        transformationOption: 'h2_ready',
        dataQualityStatus: 'verified',
        investmentPath: 'capex_approved',
        decommissionPath: '2035_shut_down',
        owner: 'Netznutzung',
        nextAction: 'decide_umbaupfad',
        sourceRef: 'NAPTransformation_2045,H2_Readiness_Doc',
      });

      expect(result.status).toBe('ready_for_transformation_decision');
      expect(result.gateStatus).toBe('repurpose');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.complianceEvidence.division).toBe('Gas');
      expect(result.complianceContext.meteringPointId).toBe('melo-144');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['NAPTransformation_2045', 'H2_Readiness_Doc']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_transformation_decision',
          'Gate Status: repurpose',
          'Provided Netzanschlusspunkt Transformations Gate evidence: 8/8',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── heatAssetTariffSteeringStatus ─────────────────────────────────────────

  describe('heatAssetTariffSteeringStatus', () => {
    it('reports heat asset tariff steering gate gaps without creating stateful databases or mutation side effects', async () => {
      const result = await broker.call('dashboard-api.heatAssetTariffSteeringStatus', {
        heatPortfolioId: 'portfolio-146',
      });

      expect(result.status).toBe('needs_division');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'division',
          'technical_measures',
          'tariff_impact_status',
          'regulatory_uncertainty',
          'funding_status',
          'customer_impact',
          'investment_priority',
          'owner',
          'next_decision_gate',
          'blocked_follow_up_action',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toContain('hitl.create');
    });

    it('returns ready_for_steering_decision and correct gateStatus when all evidence is complete', async () => {
      const result = await broker.call('dashboard-api.heatAssetTariffSteeringStatus', {
        heatPortfolioId: 'portfolio-146',
        division: 'Fernwärme',
        technicalMeasures: 'completed',
        tariffImpactStatus: 'calculated',
        regulatoryUncertainty: 'low_risk',
        fundingStatus: 'approved',
        customerImpact: 'positive',
        investmentPriority: 'high',
        owner: 'Assetmanagement Fernwärme',
        nextDecisionGate: 'Investment Committee Window Q3',
        blockedFollowUpAction: 'investment-planning.createPlan',
        sourceRef: 'HeatSteeringDoc_2026,TariffImpact_Report',
      });

      expect(result.status).toBe('ready_for_steering_decision');
      expect(result.gateStatus).toBe('invest');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.complianceEvidence.division).toBe('Fernwärme');
      expect(result.complianceContext.heatPortfolioId).toBe('portfolio-146');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['HeatSteeringDoc_2026', 'TariffImpact_Report']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_steering_decision',
          'Gate Status: invest',
          'Provided District Heating Asset & Tariff Steering Gate evidence: 11/11',
          'Open gaps: 0',
        ])
      );
    });
  });

  // ── techCommercialOfferCockpitStatus ─────────────────────────────────────

  describe('techCommercialOfferCockpitStatus', () => {
    it('reports tech commercial offer cockpit gate gaps without creating stateful databases or mutation side effects', async () => {
      const result = await broker.call('dashboard-api.techCommercialOfferCockpitStatus', {
        connectionRequestId: 'request-162',
      });

      expect(result.status).toBe('needs_grid_operator');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'grid_operator_id',
          'znp_alignment',
          'grid_node',
          'technical_restriction',
          'requested_capacity_kw',
          'technical_status',
          'capacity_utilization',
          'fnav_contract_logic',
          'commercial_assumptions',
          'legal_agreement_status',
          'legal_boundaries',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toContain('hitl.create');
    });

    it('returns ready_for_offer_decision and correct gateStatus when all evidence is complete', async () => {
      const result = await broker.call('dashboard-api.techCommercialOfferCockpitStatus', {
        connectionRequestId: 'request-162',
        gridOperatorId: 'VNB-162',
        znpAlignment: 'in_alignment',
        gridNode: 'node-A',
        technicalRestriction: 'none',
        requestedCapacityKW: 500,
        technicalStatus: 'approved',
        capacityUtilization: 'low',
        fnavContractLogic: 'ok',
        commercialAssumptions: 'calculated',
        legalAgreementStatus: 'approved',
        legalBoundaries: 'easement_cleared',
        sourceRef: 'OfferDoc_2026,Anschluss_Report',
      });

      expect(result.status).toBe('ready_for_offer_decision');
      expect(result.gateStatus).toBe('invest');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.complianceEvidence.gridOperatorId).toBe('VNB-162');
      expect(result.complianceContext.connectionRequestId).toBe('request-162');
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['OfferDoc_2026', 'Anschluss_Report']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_offer_decision',
          'Gate Status: invest',
          'Provided Technical & Commercial Offer Cockpit Gate evidence: 13/13',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- zaehlparkFinanzierungSzenarioCockpitStatus ----------------------------

  describe('zaehlparkFinanzierungSzenarioCockpitStatus', () => {
    it('reports Zaehlpark financing scenario gaps without external connectors or mutation side effects', async () => {
      const result = await broker.call('dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus', {
        gridOperatorId: 'VNB-143',
      });

      expect(result.status).toBe('needs_scenario');
      expect(result.gateStatus).toBe('insufficient_data');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'scenario_id',
          'asset_scope',
          'metering_scope',
          'period',
          'investment_volume',
          'imsys_count',
          'financing_model',
          'opex_annual',
          'regulatory_relevance',
          'source_refs',
        ])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'settlement.prepareBilling',
          'external.bank.call',
          'external.leasing.call',
          'personal-agent.execute',
        ])
      );
    });

    it('returns ready_for_decision and review_required for complete leasing scenario evidence', async () => {
      const result = await broker.call('dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus', {
        gridOperatorId: 'VNB-143',
        scenarioId: 'sc-2026-rollout',
        assetScope: 'imsys,gateway,mme',
        meteringScope: 'cross-sector',
        period: '2026-2030',
        investmentVolume: 6200000,
        imsysCount: 4200,
        financingModel: 'leasing',
        opexAnnual: 310000,
        regulatoryRelevance: 'paragraph_14a',
        sourceRef: 'ZaehlparkPlan_2026,Finance_Assumptions',
      });

      expect(result.status).toBe('ready_for_decision');
      expect(result.gateStatus).toBe('review_required');
      expect(result.overallStatus).toBe('review_required');
      expect(result.readinessScore).toBe(1);
      expect(result.complianceScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.technical.capexPerImsys).toBe(1476.19);
      expect(result.financial.totexFirstYear).toBe(6510000);
      expect(result.regulatory.paragraph14aRelevant).toBe(true);
      expect(result.sourceRefs).toEqual(expect.arrayContaining(['ZaehlparkPlan_2026', 'Finance_Assumptions']));
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_decision',
          'Gate Status: review_required',
          'Readiness Score: 1',
          'Provided Zaehlpark Finanzierung Szenario Cockpit evidence: 11/11',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- processSensitizationReadinessMapStatus -------------------------------

  describe('processSensitizationReadinessMapStatus', () => {
    it('reports needs_evidence when evidence gaps or system breaks are supplied', async () => {
      const result = await broker.call('dashboard-api.processSensitizationReadinessMapStatus', {
        processType: 'netzanschluss',
        missingEvidence: 'rollenmatrix',
        systemBreaks: 'medienbruch',
        redLineStatus: 'clear',
        owner: 'Netzanschluss',
      });

      expect(result.readinessStatus).toBe('needs_evidence');
      expect(result.status).toBe('needs_evidence');
      expect(result.trainingTopics).toEqual([]);
      expect(result.missingEvidence.map((gap) => gap.value)).toEqual(
        expect.arrayContaining(['rollenmatrix', 'medienbruch'])
      );
      expect(result.positiveFollowUps[0].category).toBe('process_sensitization_readiness_map');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'vdmi.mutate',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('reports needs_process_decision when role decisions are missing', async () => {
      const result = await broker.call('dashboard-api.processSensitizationReadinessMapStatus', {
        processType: 'redispatch',
        roleDecisionStatus: 'open',
        roleDecisionGaps: 'betriebsverantwortung',
      });

      expect(result.readinessStatus).toBe('needs_process_decision');
      expect(result.roleDecisionGaps).toEqual(['betriebsverantwortung']);
      expect(result.readinessScore).toBe(0.35);
    });

    it('reports blocked_by_red_line when non-negotiable constraints are supplied', async () => {
      const result = await broker.call('dashboard-api.processSensitizationReadinessMapStatus', {
        processType: 'netzsicherheit',
        redLineStatus: 'blocked',
        nonNegotiableConstraints: 'netzsicherheit',
      });

      expect(result.readinessStatus).toBe('blocked_by_red_line');
      expect(result.nonNegotiableConstraints).toEqual(['netzsicherheit']);
      expect(result.blockingFindings[0].severity).toBe('high');
    });

    it('reports ready_for_sensitization when no blockers are supplied', async () => {
      const result = await broker.call('dashboard-api.processSensitizationReadinessMapStatus', {
        processType: 'vdmi',
        evidenceStatus: 'complete',
        roleDecisionStatus: 'decided',
        dataQualityStatus: 'ok',
        systemBreakStatus: 'clear',
        redLineStatus: 'clear',
        sourceRef: 'VDMI-Map-139',
      });

      expect(result.readinessStatus).toBe('ready_for_sensitization');
      expect(result.readinessScore).toBe(1);
      expect(result.missingEvidence).toEqual([]);
      expect(result.trainingTopics.length).toBeGreaterThan(0);
      expect(result.sourceRefs).toEqual(['VDMI-Map-139']);
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Readiness Status: ready_for_sensitization',
          'Process Topic: vdmi',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- netzprozessReadinessGateStatus ---------------------------------------

  describe('netzprozessReadinessGateStatus', () => {
    it('reports unknown when no readiness signal evidence is supplied', async () => {
      const result = await broker.call('dashboard-api.netzprozessReadinessGateStatus', {
        processType: 'redispatch',
        processId: 'np-223-empty',
      });

      expect(result.overallStatus).toBe('unknown');
      expect(result.readinessSignals).toEqual([]);
      expect(result.missingEvidence).toEqual([]);
      expect(result.safety).toBe('read_only');
    });

    it('reports blocked when any required administrative signal is blocked', async () => {
      const result = await broker.call('dashboard-api.netzprozessReadinessGateStatus', {
        processType: 'redispatch',
        processId: 'np-223',
        portalAccess: 'ready',
        sftpRoute: 'blocked',
        owner: 'Netzbetrieb',
        nextDecision: 'produktivreife',
      });

      expect(result.overallStatus).toBe('blocked');
      expect(result.blockers.map((blocker) => blocker.code)).toContain('sftp_route');
      expect(result.owners).toContain('Netzbetrieb');
      expect(result.positiveFollowUps[0].category).toBe('netzprozess_readiness_gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'vdmi.mutate',
          'workflow.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('reports partial when at least one supplied signal is partial or missing', async () => {
      const result = await broker.call('dashboard-api.netzprozessReadinessGateStatus', {
        processType: 'grid_connection',
        portalAccess: 'ready',
        rolePermission: 'partial',
        training: 'missing',
      });

      expect(result.overallStatus).toBe('partial');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['role_permission', 'training'])
      );
    });

    it('reports ready when all supplied readiness signals are ready', async () => {
      const result = await broker.call('dashboard-api.netzprozessReadinessGateStatus', {
        processType: 'netzkoppelvertrag',
        processId: 'np-223-ready',
        portalAccess: 'ready',
        sftpRoute: 'ready',
        rolePermission: 'ready',
        itSecurityUpdate: 'ready',
        training: 'ready',
        dataPath: 'ready',
        nextDecision: 'gate-release',
        sourceRef: 'vdmi:223',
      });

      expect(result.overallStatus).toBe('ready');
      expect(result.readinessSignals).toHaveLength(6);
      expect(result.missingEvidence).toEqual([]);
      expect(result.sourceRefs).toEqual(['vdmi:223']);
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Overall Status: ready',
          'Process Type: netzkoppelvertrag',
          'Readiness Signals: 6',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- grossspeicherAnschlussReadinessGateStatus ----------------------------

  describe('grossspeicherAnschlussReadinessGateStatus', () => {
    it('reports needs_asset_context when no storage evidence is supplied', async () => {
      const result = await broker.call('dashboard-api.grossspeicherAnschlussReadinessGateStatus', {
        gridOperatorId: 'VNB-202',
        projectId: 'gs-202-empty',
      });

      expect(result.status).toBe('needs_asset_context');
      expect(result.gateStatus).toBe('incomplete');
      expect(result.safety).toBe('read_only');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('asset_context');
    });

    it('reports needs_fnav_contract_boundary when fNAV evidence is missing', async () => {
      const result = await broker.call('dashboard-api.grossspeicherAnschlussReadinessGateStatus', {
        gridOperatorId: 'VNB-202',
        projectId: 'gs-202-fnav',
        storageAssetId: 'asset-bess-1',
        formalRequestEvidence: 'ready',
        napMastrNummer: 'SEE987654321',
        contractBoundaryStatus: 'missing',
        scheduleEvidenceStatus: 'ready',
        controllabilityStatus: 'ready',
        controlRoomHandoverStatus: 'ready',
        owner: 'Netzanschluss',
        sourceRef: 'briefing:202',
      });

      expect(result.status).toBe('needs_fnav_contract_boundary');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('fnav_contract_boundary');
      expect(result.positiveFollowUps[0].category).toBe('grossspeicher_anschluss_readiness_gate');
    });

    it('reports blocked_by_grid_signal for blocked network priority facts', async () => {
      const result = await broker.call('dashboard-api.grossspeicherAnschlussReadinessGateStatus', {
        gridOperatorId: 'VNB-202',
        projectId: 'gs-202-blocked',
        storageAssetId: 'asset-bess-2',
        formalRequestEvidence: 'ready',
        napMastrNummer: 'SEE123456789',
        contractBoundaryStatus: 'ready',
        scheduleEvidenceStatus: 'ready',
        controllabilityStatus: 'ready',
        controlRoomHandoverStatus: 'ready',
        gridSignalStatus: 'blocked',
        owner: 'Netzbetrieb',
        sourceRef: 'netzsignal:202',
      });

      expect(result.status).toBe('blocked_by_grid_signal');
      expect(result.gateStatus).toBe('blocked');
      expect(result.validationFindings[0].severity).toBe('high');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'hitl.create',
          'grid-operations.executeControl',
          'forecast-engine.executeDispatch',
          'flex.controlDevice',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('reports ready_for_connection_decision when all supplied evidence is complete', async () => {
      const result = await broker.call('dashboard-api.grossspeicherAnschlussReadinessGateStatus', {
        gridOperatorId: 'VNB-202',
        projectId: 'gs-202-ready',
        storageAssetId: 'asset-bess-3',
        requestedCapacityKW: '12000',
        storageCapacityKWh: '48000',
        voltageLevel: 'MS',
        formalRequestEvidence: 'ready',
        napMastrNummer: 'SEE202000001',
        fnavProfile: 'ready',
        contractBoundaryStatus: 'ready',
        scheduleEvidenceStatus: 'ready',
        storageDispatchAssumption: 'ready',
        controllabilityStatus: 'ready',
        controlRoomHandoverStatus: 'ready',
        gridSignalStatus: 'ready',
        owner: 'Netzanschluss',
        nextDecision: 'anschlussentscheidung',
        sourceRef: 'vdmi:202',
      });

      expect(result.status).toBe('ready_for_connection_decision');
      expect(result.gateStatus).toBe('ready');
      expect(result.evidenceGaps).toEqual([]);
      expect(result.projectContext.requestedCapacityKW).toBe(12000);
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_connection_decision',
          'Gate Status: ready',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- rolePermissionAccessReadinessGateStatus ------------------------------
  describe('rolePermissionAccessReadinessGateStatus', () => {
    it('reports needs_role_profile when no role context is supplied', async () => {
      const result = await broker.call('dashboard-api.rolePermissionAccessReadinessGateStatus', {
        portalAccess: 'present',
      });

      expect(result.status).toBe('needs_role_profile');
      expect(result.safety).toBe('read_only');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('role_profile');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'access-manager.call',
          'iam.provision',
          'rbac.mutate',
          'token.create',
          'hitl.create',
          'workflow.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('reports needs_portal_access when the first access fact is missing', async () => {
      const result = await broker.call('dashboard-api.rolePermissionAccessReadinessGateStatus', {
        roleId: 'role-261',
        roleName: 'Flexibilitaetsdirigent',
        sftpRoute: 'present',
        rolePermission: 'approved',
        securityClearance: 'cleared',
        trainingProof: 'present',
        reapprovalStatus: 'approved',
        owner: 'Netzbetrieb',
        dueDate: '2026-09-15',
        sourcePath: 'accessmanager:reapproval-3',
      });

      expect(result.status).toBe('needs_portal_access');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('portal_access');
      expect(result.positiveFollowUps[0].category).toBe('role_permission_access_readiness_gate');
    });

    it('reports blocked_by_access_gap for rejected or expired access facts', async () => {
      const result = await broker.call('dashboard-api.rolePermissionAccessReadinessGateStatus', {
        roleId: 'role-261',
        roleName: 'Waermedirigent',
        portalAccess: 'present',
        sftpRoute: 'present',
        rolePermission: 'rejected',
        securityClearance: 'cleared',
        trainingProof: 'present',
        reapprovalStatus: 'expired',
        blockedAccess: 'AccessManager reapproval expired',
        owner: 'IT-Security',
        dueDate: '2026-09-15',
        sourcePath: 'accessmanager:reapproval-3',
      });

      expect(result.status).toBe('blocked_by_access_gap');
      expect(result.blockers.map((blocker) => blocker.code)).toEqual(
        expect.arrayContaining(['role_permission', 'reapproval_status', 'blocked_access'])
      );
      expect(result.validationFindings.some((finding) => finding.severity === 'high')).toBe(true);
    });

    it('reports ready_for_operational_role when supplied evidence is complete', async () => {
      const result = await broker.call('dashboard-api.rolePermissionAccessReadinessGateStatus', {
        roleId: 'role-261',
        roleName: 'Flexibilitaetsdirigent',
        processType: 'redispatch',
        gridOperatorId: 'VNB-261',
        accessManagerRef: 'am:reapproval-3',
        tenantScope: 'public',
        portalAccess: 'present',
        sftpRoute: 'present',
        rolePermission: 'approved',
        securityClearance: 'cleared',
        trainingProof: 'present',
        reapprovalStatus: 'approved',
        owner: 'Netzbetrieb',
        dueDate: '2026-09-15',
        sourcePath: 'accessmanager:reapproval-3',
      });

      expect(result.status).toBe('ready_for_operational_role');
      expect(result.evidenceGaps).toEqual([]);
      expect(result.roleContext.accessManagerRef).toBe('am:reapproval-3');
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_operational_role',
          'Role: Flexibilitaetsdirigent',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- ownerDeadlineEvidenceGateStatus -------------------------------------
  describe('ownerDeadlineEvidenceGateStatus', () => {
    it('reports needs_signal_context when no signal provenance is supplied', async () => {
      const result = await broker.call('dashboard-api.ownerDeadlineEvidenceGateStatus', {
        ownerRole: 'Netzbetrieb',
      });

      expect(result.status).toBe('needs_signal_context');
      expect(result.safety).toBe('read_only');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['signal_context', 'source_ref'])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'mail.fetch',
          'teams.fetch',
          'loop.fetch',
          'external.connector.call',
          'workflow.execute',
          'notification.send',
          'deadline.mutate',
          'task.create',
          'owner.assign',
          'hitl.create',
          'vdmi.mutate',
          'personal-agent.execute',
        ])
      );
    });

    it('reports needs_owner after signal context is known', async () => {
      const result = await broker.call('dashboard-api.ownerDeadlineEvidenceGateStatus', {
        signalId: 'sig-256',
        sourceType: 'vdmi_task',
        sourceRef: 'vdmi:task-256',
        dueAt: '2026-09-30',
        evidenceRef: 'evidence:256',
        evidenceStatus: 'present',
        blockedDecision: 'Redispatch Nachhaltung',
        linkedEntity: 'process:redispatch',
      });

      expect(result.status).toBe('needs_owner');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('owner');
      expect(result.positiveFollowUps[0].category).toBe('owner_deadline_evidence_gate');
    });

    it('reports blocked statuses for overdue or missing evidence blockers', async () => {
      const result = await broker.call('dashboard-api.ownerDeadlineEvidenceGateStatus', {
        signalId: 'sig-256',
        sourceType: 'process_intent',
        sourceRef: 'process:intent-256',
        ownerRole: 'Regulierungsmanagement',
        ownerContact: 'steuerung@example.invalid',
        dueAt: '2026-06-01',
        evidenceRef: 'evidence:missing',
        evidenceStatus: 'blocked',
        blockedDecision: 'Management Nachhaltung',
        linkedEntity: 'asset:nap-1',
        blockedByMissingEvidence: true,
        overdue: true,
        riskLevel: 'critical',
      });

      expect(result.status).toBe('blocked_by_overdue_deadline');
      expect(result.blockers.map((blocker) => blocker.code)).toEqual(
        expect.arrayContaining(['blocked_by_missing_evidence', 'overdue_deadline'])
      );
      expect(result.validationFindings.some((finding) => finding.severity === 'high')).toBe(true);
    });

    it('reports ready_for_decision_followup when supplied signal facts are complete', async () => {
      const result = await broker.call('dashboard-api.ownerDeadlineEvidenceGateStatus', {
        signalId: 'sig-256',
        sourceType: 'decision_frame',
        sourceRef: 'decision-frame:df-256',
        processType: 'redispatch',
        riskLevel: 'medium',
        ownerRole: 'Netzbetrieb',
        ownerContact: 'nb@example.invalid',
        dueAt: '2026-09-30',
        evidenceRef: 'evidence:receipt-256',
        evidenceStatus: 'present',
        blockedDecision: 'Freigabe Folgeentscheidung',
        linkedEntity: 'malo:DE001256',
      });

      expect(result.status).toBe('ready_for_decision_followup');
      expect(result.evidenceGaps).toEqual([]);
      expect(result.signalContext.blockedDecision).toBe('Freigabe Folgeentscheidung');
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_decision_followup',
          'Signal: sig-256',
          'Owner: Netzbetrieb',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- automationRiskGateStatus -------------------------------------------
  describe('automationRiskGateStatus', () => {
    it('reports needs_process_context when no automation process is supplied', async () => {
      const result = await broker.call('dashboard-api.automationRiskGateStatus', {
        processOwner: 'Prozessmanagement',
      });

      expect(result.status).toBe('needs_process_context');
      expect(result.safety).toBe('read_only');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['process_context', 'test_case_coverage', 'edge_case_catalog'])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'rpa.execute',
          'bot.run',
          'mass-run.trigger',
          'workflow.execute',
          'hitl.create',
          'vdmi.mutate',
          'customer-communication.send',
          'settlement.prepareBilling',
          'market-communication.send',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('reports needs_test_coverage after process context and owner are known', async () => {
      const result = await broker.call('dashboard-api.automationRiskGateStatus', {
        processId: 'rpa-205',
        processName: 'MSCONS Reklamationsvorbereitung',
        processClass: 'marktkommunikation',
        processOwner: 'MaKo',
        operationsOwner: 'Netzbetrieb',
        edgeCaseCatalog: 'covered',
        stopCriteria: 'present',
        rollbackPath: 'documented',
        monitoringSignals: 'ready',
      });

      expect(result.status).toBe('needs_test_coverage');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('test_case_coverage');
      expect(result.positiveFollowUps[0].category).toBe('automation_risk_gate');
    });

    it('blocks uncontrolled mass-runs with critical domain impact', async () => {
      const result = await broker.call('dashboard-api.automationRiskGateStatus', {
        processId: 'rpa-205',
        processName: 'Billing Massenlauf',
        processOwner: 'Abrechnung',
        operationsOwner: 'IT Betrieb',
        massRunVolume: '2500',
        affectedDomains: 'billing,market-communication',
        billingImpact: 'critical',
        marketCommunicationImpact: 'critical',
        testCaseCoverage: 'covered',
        edgeCaseCatalog: 'covered',
        stopCriteria: 'present',
        rollbackPath: 'documented',
        monitoringSignals: 'ready',
        riskLevel: 'critical',
      });

      expect(result.status).toBe('blocked_by_uncontrolled_mass_run');
      expect(result.blockers.map((blocker) => blocker.code)).toContain('uncontrolled_mass_run');
      expect(result.validationFindings.some((finding) => finding.severity === 'high')).toBe(true);
    });

    it('reports ready_for_automation_decision when supplied evidence is complete', async () => {
      const result = await broker.call('dashboard-api.automationRiskGateStatus', {
        processId: 'rpa-205',
        processName: 'Stammdaten Plausibilisierung',
        processClass: 'backoffice',
        runFrequency: 'weekly',
        massRunVolume: '100',
        affectedDomains: 'asset-mdm',
        customerCommunicationImpact: 'none',
        billingImpact: 'none',
        marketCommunicationImpact: 'none',
        massDataImpact: 'low',
        testCaseCoverage: 'covered',
        edgeCaseCatalog: 'covered',
        acceptanceMethod: 'shadow-run',
        monitoringSignals: 'ready',
        stopCriteria: 'present',
        rollbackPath: 'documented',
        processOwner: 'Asset Management',
        operationsOwner: 'IT Betrieb',
        riskLevel: 'low',
      });

      expect(result.status).toBe('ready_for_automation_decision');
      expect(result.evidenceGaps).toEqual([]);
      expect(result.processContext.processId).toBe('rpa-205');
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_automation_decision',
          'Process: rpa-205',
          'Risk: low',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- redispatchProjectControllingKpiCockpitStatus -----------------------
  describe('redispatchProjectControllingKpiCockpitStatus', () => {
    it('reports needs_redispatch_audit when no audit chain is supplied', async () => {
      const result = await broker.call('dashboard-api.redispatchProjectControllingKpiCockpitStatus', {
        taskOwner: 'Netzbetrieb',
      });

      expect(result.status).toBe('needs_redispatch_audit');
      expect(result.safety).toBe('read_only');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['redispatch_audit', 'source_health', 'asset_evidence'])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'redispatch.execute',
          'redispatch.order.create',
          'settlement.exportA96',
          'settlement.prepareBilling',
          'task.create',
          'workflow.execute',
          'hitl.create',
          'vdmi.mutate',
          'datasource.ingest',
          'assets.applyOverride',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('reports needs_source_health after Redispatch audit is known', async () => {
      const result = await broker.call('dashboard-api.redispatchProjectControllingKpiCockpitStatus', {
        cockpitId: 'rdpck-222',
        period: '2026-Q3',
        redispatchAuditId: 'audit-222',
        hasAssetEvidence: true,
        hasMastrEvidence: true,
        hasLoadProfileEvidence: true,
        hasSettlementReadiness: true,
        hasKpiReference: true,
        taskOwner: 'Netzbetrieb',
        dueDate: '2026-07-15',
      });

      expect(result.status).toBe('needs_source_health');
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('source_health');
      expect(result.positiveFollowUps[0].category).toBe('redispatch_project_controlling_kpi_cockpit');
    });

    it('blocks explicit Redispatch decision gaps', async () => {
      const result = await broker.call('dashboard-api.redispatchProjectControllingKpiCockpitStatus', {
        cockpitId: 'rdpck-222',
        period: '2026-Q3',
        redispatchAuditId: 'audit-222',
        datasourceHealth: 'ready',
        hasAssetEvidence: true,
        hasMastrEvidence: true,
        hasLoadProfileEvidence: true,
        hasSettlementReadiness: true,
        hasKpiReference: true,
        taskOwner: 'Netzbetrieb',
        dueDate: '2026-07-15',
        blockedDecision: 'Lastgangquelle widerspricht MaStR-Anlagenstatus',
      });

      expect(result.status).toBe('blocked_by_decision_gap');
      expect(result.decisionBlockers.map((blocker) => blocker.code)).toContain('blocked_decision');
      expect(result.validationFindings.some((finding) => finding.severity === 'high')).toBe(true);
    });

    it('reports ready_for_project_review when supplied evidence is complete', async () => {
      const result = await broker.call('dashboard-api.redispatchProjectControllingKpiCockpitStatus', {
        cockpitId: 'rdpck-222',
        gridOperatorId: 'vnb-demo',
        period: '2026-Q3',
        redispatchAuditId: 'audit-222',
        settlementRef: 'settlement-222',
        vdmiProcessId: 'vdmi-222',
        taskId: 'task-222',
        taskStatus: 'ready',
        taskOwner: 'Netzbetrieb',
        dueDate: '2026-07-15',
        hasAssetEvidence: true,
        hasMastrEvidence: true,
        hasLoadProfileEvidence: true,
        hasSettlementReadiness: true,
        hasKpiReference: true,
        datasourceHealth: 'ready',
        sourceFreshness: 'ready',
        qualityStatus: 'ready',
        affectedAssets: 'asset-1,asset-2',
      });

      expect(result.status).toBe('ready_for_project_review');
      expect(result.evidenceGaps).toEqual([]);
      expect(result.projectContext.cockpitId).toBe('rdpck-222');
      expect(result.dossierEvidence.dossierFacts).toEqual(
        expect.arrayContaining([
          'Status: ready_for_project_review',
          'Cockpit: rdpck-222',
          'Period: 2026-Q3',
          'Open gaps: 0',
        ])
      );
    });
  });

  // -- stadtwerkMauerVdmiProfileStatus ------------------------------------
  describe('stadtwerkMauerVdmiProfileStatus', () => {
    it('returns the deterministic Stadtwerk Mauer MVP profile with all four sparten', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerVdmiProfileStatus', {
        tenantId: 'stadtwerk-mauer',
        includeRoles: true,
        includeEvidenceGaps: true,
      });

      expect(result.profileId).toBe('stadtwerk_mauer_vdmi_profile');
      expect(result.tenantId).toBe('stadtwerk-mauer');
      expect(result.municipality).toBe('Mauer');
      expect(result.postcode).toBe('69256');
      expect(result.safety).toBe('read_only');
      expect(result.sparten.map((sparte) => sparte.id).sort()).toEqual([
        'gas',
        'strom',
        'waerme',
        'wasser',
      ]);
      expect(result.roles.map((role) => role.id)).toEqual(
        expect.arrayContaining(['management', 'regulierung', 'asset_management', 'netzplanung', 'vnb', 'msb', 'bkv', 'esa'])
      );
      expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toEqual(
        expect.arrayContaining(['sparte_asset_facts', 'mako_edm_evidence', 'billing_bkv_evidence', 'capability_projection'])
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'tenant.create',
          'eve.runtime.execute',
          'agent-directory.write',
          'workflow.execute',
          'hitl.create',
          'nova.mutate',
          'vdmi.mutate',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('can focus the read-only profile to one sparte without changing the role model', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerVdmiProfileStatus', {
        focusSparte: 'gas',
        includeRoles: true,
      });

      expect(result.sparten).toHaveLength(1);
      expect(result.sparten[0].id).toBe('gas');
      expect(result.roles.length).toBeGreaterThanOrEqual(10);
      expect(result.demoQuestionAnswer.transformationRiskAreas).toEqual(
        expect.arrayContaining(['Gas asset and data quality'])
      );
    });
  });

  // -- stadtwerkMauerCapabilityProjectionStatus ----------------------------
  describe('stadtwerkMauerCapabilityProjectionStatus', () => {
    it('returns a read-only projection for the four required core roles', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerCapabilityProjectionStatus', {
        tenantId: 'stadtwerk-mauer',
        roles: 'management,grid-planning,asset-management,regulatory',
        includeDescriptorSources: true,
      });

      expect(result.projectionId).toBe('stadtwerk_mauer_capability_projection');
      expect(result.profileId).toBe('stadtwerk_mauer_vdmi_profile');
      expect(result.tenantId).toBe('stadtwerk-mauer');
      expect(result.safety).toBe('read_only');
      expect(result.status).toBe('projection_ready');
      expect(result.roles.map((role) => role.roleId)).toEqual([
        'management',
        'grid-planning',
        'asset-management',
        'regulatory',
      ]);
      expect(result.classificationSummary.readOnly).toBeGreaterThanOrEqual(16);
      expect(result.classificationSummary.advisory).toBeGreaterThanOrEqual(12);
      expect(result.classificationSummary.consequentialFollowUps).toBeGreaterThanOrEqual(12);
      expect(result.classificationSummary.executableConsequentialActions).toBe(0);
      expect(result.roles[0].readOnlyCapabilities[0]).toMatchObject({
        classification: 'read_only',
        handoff: 'dossier_hydration_allowed',
      });
      expect(result.roles[0].consequentialFollowUps[0]).toMatchObject({
        classification: 'consequential_follow_up',
        executable: false,
      });
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'eve.runtime.execute',
          'task.create',
          'workflow.execute',
          'hitl.create',
          'nova.mutate',
          'vdmi.mutate',
          'external.connector.call',
          'personal-agent.execute',
        ])
      );
    });

    it('can filter roles and hide consequential classifications without changing safety', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerCapabilityProjectionStatus', {
        roles: 'management,regulatory',
        includeConsequential: false,
        includeDescriptorSources: false,
      });

      expect(result.roles.map((role) => role.roleId)).toEqual(['management', 'regulatory']);
      expect(result.classificationSummary.consequentialFollowUps).toBe(0);
      expect(result.descriptorSources).toEqual([]);
      expect(result.safety).toBe('read_only');
    });
  });

  // -- stadtwerkMauerEventReplayPreviewStatus ------------------------------
  describe('stadtwerkMauerEventReplayPreviewStatus', () => {
    it('returns a deterministic tenant-bound event catalog and replay preview', async () => {
      const first = await broker.call('dashboard-api.stadtwerkMauerEventReplayPreviewStatus', {
        seed: 'cron-265',
        count: 5,
      });
      const second = await broker.call('dashboard-api.stadtwerkMauerEventReplayPreviewStatus', {
        seed: 'cron-265',
        count: 5,
      });

      expect(first.capabilityKey).toBe('stadtwerk_mauer_event_replay_preview');
      expect(first.tenantId).toBe('stadtwerk-mauer');
      expect(first.safety).toBe('read_only');
      expect(first.status).toBe('catalog_ready');
      expect(first.templateCount).toBeGreaterThanOrEqual(20);
      expect(first.replayPreview).toHaveLength(5);
      expect(second.replayPreview.map((event) => event.eventId)).toEqual(
        first.replayPreview.map((event) => event.eventId)
      );
      expect(first.eventTemplates.map((template) => template.sparte)).toEqual(
        expect.arrayContaining(['strom', 'gas', 'wasser', 'waerme', 'uebergreifend'])
      );
      expect(first.taxonomyCoverage.byMarketRole).toEqual(
        expect.objectContaining({
          VNB: expect.any(Number),
          MaKo: expect.any(Number),
          MSB: expect.any(Number),
          BKV: expect.any(Number),
        })
      );
      expect(first.replayPreview[0]).toEqual(
        expect.objectContaining({
          tenantId: 'stadtwerk-mauer',
          expectedRouting: expect.objectContaining({
            nextOwner: expect.any(String),
            capabilities: expect.any(Array),
          }),
          sideEffectPolicy: expect.stringMatching(/read_only_event|advisory_only|consequential_requires_followup/),
        })
      );
      expect(first.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'scheduler.create',
          'event.inject',
          'event.persist',
          'eve.runtime.execute',
          'external.connector.call',
          'workflow.execute',
          'task.create',
          'hitl.create',
          'nova.mutate',
          'vdmi.mutate',
          'billing.release',
          'settlement.exportA96',
          'personal-agent.execute',
        ])
      );
    });

    it('can filter the preview by sparte without enabling side effects', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerEventReplayPreviewStatus', {
        seed: 'strom-only',
        count: 4,
        sparte: 'strom',
      });

      expect(result.replayPreview).toHaveLength(4);
      expect(result.replayPreview.every((event) => event.sparte === 'strom')).toBe(true);
      expect(result.missingEvidence.length).toBeGreaterThanOrEqual(1);
      expect(result.decisionBoundaries.join(' ')).toContain('deterministic replay preview only');
      expect(result.sourceActions.notCalled).toContain('market-communication.send');
    });
  });

  // -- stadtwerkMauerSandboxRuntimeStatus ---------------------------------
  describe('stadtwerkMauerSandboxRuntimeStatus', () => {
    it('reports sandbox lifecycle gaps without executing external actions', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerSandboxRuntimeStatus', {
        tenantId: 'stadtwerk-mauer',
      });

      expect(result.status).toBe('empty_sandbox_ready_for_seed');
      expect(result.tenantId).toBe('stadtwerk-mauer');
      expect(result.sandboxBoundaryAllowed).toBe(true);
      expect(result.eventCount).toBe(0);
      expect(result.missingLifecycleEvidence.map((gap) => gap.missingDataPoint)).toContain(
        'seeded_demo_event'
      );
      expect(result.positiveFollowUps[0].category).toBe('stadtwerk_mauer_sandbox_runtime');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['mako.dispatch', 'billing.release', 'personal-agent.execute'])
      );
      expect(result.safety).toBe('read_only_status_for_non_consequential_sandbox_runtime');
    });

    it('surfaces seeded sandbox inventory through the read-only dashboard action', async () => {
      handlers.stadtwerkMauerSandboxRuntimeStatus = () => ({
        capabilityKey: 'stadtwerk_mauer_sandbox_runtime',
        safety: 'read_only_status_for_non_consequential_sandbox_runtime',
        tenantId: 'stadtwerk-mauer',
        requiredTenantId: 'stadtwerk-mauer',
        sandboxBoundaryAllowed: true,
        status: 'sandbox_state_mutated_with_reset_proof',
        eventCount: 1,
        artifactCount: 6,
        derivedStateInventory: {
          event_instance: 1,
          dossier_addition: 1,
          follow_up_proposal: 1,
          stub_transcript_placeholder: 1,
          outbox_queue_placeholder: 1,
          audit_artifact: 1,
        },
        resetDeleteReadiness: { canReset: true, idempotent: true, wouldDeleteArtifactCount: 6 },
        lastResetResult: { deletedArtifactCount: 6 },
        missingLifecycleEvidence: [],
        positiveFollowUps: [],
        sourceActions: {
          inspected: ['stadtwerk-mauer-sandbox-runtime.status'],
          referenced: ['object-store.query'],
          notCalled: ['external.connector.call', 'device-control.execute', 'personal-agent.execute'],
        },
        dossierEvidence: {
          status: 'sandbox_state_mutated_with_reset_proof',
          tenantId: 'stadtwerk-mauer',
          eventCount: 1,
          artifactCount: 6,
          missingLifecycleEvidence: [],
          positiveFollowUps: [],
          dossierFacts: ['Sandbox events: 1', 'Sandbox artifacts: 6'],
        },
      });

      const result = await broker.call('dashboard-api.stadtwerkMauerSandboxRuntimeStatus', {
        tenantId: 'stadtwerk-mauer',
      });

      expect(result.status).toBe('sandbox_state_mutated_with_reset_proof');
      expect(result.derivedStateInventory).toMatchObject({
        event_instance: 1,
        audit_artifact: 1,
      });
      expect(result.resetDeleteReadiness.wouldDeleteArtifactCount).toBe(6);
      expect(result.sourceActions.notCalled).toContain('device-control.execute');
    });
  });

  // -- stadtwerkMauerExternalInterfaceStubsStatus --------------------------
  describe('stadtwerkMauerExternalInterfaceStubsStatus', () => {
    it('reports stub-layer gaps without executing external actions', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus', {
        tenantId: 'stadtwerk-mauer',
      });

      expect(result.status).toBe('stub_layer_ready_for_transcripts');
      expect(result.tenantId).toBe('stadtwerk-mauer');
      expect(result.transcriptCount).toBe(0);
      expect(result.positiveFollowUps[0].category).toBe(
        'stadtwerk_mauer_external_interface_stubs'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['mako.dispatch', 'billing.release', 'personal-agent.execute'])
      );
      expect(result.safety).toBe('sandbox_only_non_consequential_stubs_with_read_only_status');
    });

    it('surfaces recent stub transcripts through the read-only dashboard action', async () => {
      handlers.stadtwerkMauerExternalInterfaceStubsStatus = () => ({
        capabilityKey: 'stadtwerk_mauer_external_interface_stubs',
        safety: 'sandbox_only_non_consequential_stubs_with_read_only_status',
        tenantId: 'stadtwerk-mauer',
        requiredTenantId: 'stadtwerk-mauer',
        sandboxBoundaryAllowed: true,
        status: 'stub_transcripts_need_evidence',
        transcriptCount: 1,
        artifactCount: 4,
        familyCounts: { mako_lieferantenwechsel: 1 },
        variantCounts: { missing_data: 1 },
        recentTranscripts: [
          {
            transcriptId: 'smm-stub:test',
            stubFamily: 'mako_lieferantenwechsel',
            responseVariant: 'missing_data',
            requestHash: 'abc123',
          },
        ],
        missingEvidence: [{ missingDataPoint: 'meloId' }],
        positiveFollowUps: [],
        resetBoundary: { service: 'stadtwerk-mauer-sandbox-runtime.reset' },
        sourceActions: {
          inspected: ['stadtwerk-mauer-external-interface-stubs.getStatus'],
          referenced: ['object-store.query'],
          notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
        },
        dossierEvidence: {
          status: 'stub_transcripts_need_evidence',
          tenantId: 'stadtwerk-mauer',
          transcriptCount: 1,
          artifactCount: 4,
          recentTranscripts: [{ stubFamily: 'mako_lieferantenwechsel', responseVariant: 'missing_data' }],
          missingEvidence: [{ missingDataPoint: 'meloId' }],
          positiveFollowUps: [],
          dossierFacts: ['Stub Status: stub_transcripts_need_evidence', 'Transcripts: 1'],
        },
      });

      const result = await broker.call('dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus', {
        tenantId: 'stadtwerk-mauer',
      });

      expect(result.status).toBe('stub_transcripts_need_evidence');
      expect(result.recentTranscripts[0].stubFamily).toBe('mako_lieferantenwechsel');
      expect(result.sourceActions.notCalled).toContain('external.connector.call');
    });
  });

  // -- stadtwerkMauerE2eProcessDemoStatus --------------------------------
  describe('stadtwerkMauerE2eProcessDemoStatus', () => {
    it('reports E2E demo readiness without executing mutating actions', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerE2eProcessDemoStatus', {
        tenantId: 'stadtwerk-mauer',
      });

      expect(result.status).toBe('e2e_demo_ready_for_run');
      expect(result.tenantId).toBe('stadtwerk-mauer');
      expect(result.demoPath).toBe('pv_registration_electrician_missing_nap');
      expect(result.traceCount).toBe(0);
      expect(result.positiveFollowUps[0].category).toBe('stadtwerk_mauer_e2e_process_demo');
      expect(result.resetBoundary.service).toBe('stadtwerk-mauer-sandbox-runtime.reset');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['mako.dispatch', 'external.connector.call', 'personal-agent.execute'])
      );
      expect(result.safety).toBe('sandbox_only_non_consequential_e2e_demo_with_read_only_status');
    });

    it('surfaces demo traces through the read-only dashboard action', async () => {
      handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
        capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
        safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
        tenantId: 'stadtwerk-mauer',
        requiredTenantId: 'stadtwerk-mauer',
        sandboxBoundaryAllowed: true,
        status: 'e2e_demo_trace_needs_evidence',
        demoPath: 'pv_registration_electrician_missing_nap',
        caseId: 'case-266',
        traceCount: 1,
        artifactCount: 5,
        recentTraces: [
          {
            traceId: 'smm-e2e-trace:test',
            caseId: 'case-266',
            transcriptId: 'smm-stub:test',
            evidenceQuality: 'incomplete_demo_evidence',
          },
        ],
        rolesAndCapabilities: [{ role: 'Elektriker', capability: 'PV Anmeldung erfassen' }],
        evidenceQuality: 'incomplete_demo_evidence',
        missingEvidence: [{ missingDataPoint: 'napReference' }],
        positiveFollowUps: [{ missingDataPoint: 'napReference' }],
        resetBoundary: { service: 'stadtwerk-mauer-sandbox-runtime.reset' },
        sourceActions: {
          inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
          referenced: ['stadtwerk-mauer-external-interface-stubs.callStub'],
          notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
        },
        dossierEvidence: {
          status: 'e2e_demo_trace_needs_evidence',
          tenantId: 'stadtwerk-mauer',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'case-266',
          traceCount: 1,
          artifactCount: 5,
          recentTraces: [{ transcriptId: 'smm-stub:test' }],
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          dossierFacts: ['E2E Demo Status: e2e_demo_trace_needs_evidence', 'Traces: 1'],
        },
      });

      const result = await broker.call('dashboard-api.stadtwerkMauerE2eProcessDemoStatus', {
        tenantId: 'stadtwerk-mauer',
        caseId: 'case-266',
      });

      expect(result.status).toBe('e2e_demo_trace_needs_evidence');
      expect(result.recentTraces[0].transcriptId).toBe('smm-stub:test');
      expect(result.missingEvidence[0].missingDataPoint).toBe('napReference');
      expect(result.sourceActions.notCalled).toContain('external.connector.call');
    });
  });

  describe('stadtwerkMauerMastrDataOverlayStatus', () => {
    it('reports the blended MaStR overlay without mutating source records', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerMastrDataOverlayStatus', {
        tenantId: 'stadtwerk-mauer',
      });

      expect(result.status).toBe('blended_overlay_ready');
      expect(result.tenantId).toBe('stadtwerk-mauer');
      expect(result.municipality).toBe('Mauer');
      expect(result.postalCode).toBe('69256');
      expect(result.assetCount).toBe(2);
      expect(result.operatorOverlay.virtualGridOperator.name).toBe('Stadtwerk Mauer');
      expect(result.operatorOverlay.realWorldOperatorHint.name).toBe('Syna GmbH');
      expect(result.operatorOverlay.preservesOriginalMastrFacts).toBe(true);
      expect(result.operatorOverlay.mutatesMastrRecords).toBe(false);
      expect(result.resetBoundary.deletesImportedMastrBaseline).toBe(false);
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['mako.dispatch', 'external.connector.call', 'mastr.write'])
      );
      expect(result.safety).toBe('read_only_real_mastr_baseline_with_virtual_operator_overlay');
    });

    it('surfaces overlay evidence through the read-only dashboard action', async () => {
      handlers.stadtwerkMauerMastrDataOverlayStatus = () => ({
        capabilityKey: 'stadtwerk_mauer_mastr_data_overlay',
        safety: 'read_only_real_mastr_baseline_with_virtual_operator_overlay',
        tenantId: 'stadtwerk-mauer',
        requiredTenantId: 'stadtwerk-mauer',
        sandboxBoundaryAllowed: true,
        status: 'blended_overlay_ready',
        municipality: 'Mauer',
        postalCode: '69256',
        assetCount: 1,
        totalCapacityKw: 12.5,
        originalGridOperators: [{ name: 'Syna GmbH', mastrId: 'SNB-SYNA', assetCount: 1 }],
        operatorOverlay: {
          virtualGridOperator: { name: 'Stadtwerk Mauer' },
          realWorldOperatorHint: { name: 'Syna GmbH' },
          preservesOriginalMastrFacts: true,
          mutatesMastrRecords: false,
        },
        sampleAssets: [
          {
            mastrNummer: 'SEE-MAUER-001',
            originalGridOperatorName: 'Syna GmbH',
            virtualGridOperatorName: 'Stadtwerk Mauer',
          },
        ],
        missingEvidence: [],
        positiveFollowUps: [],
        sourceActions: {
          inspected: ['stadtwerk-mauer-mastr-data-overlay.getStatus'],
          referenced: ['energy-market.installations'],
          notCalled: ['mako.dispatch', 'external.connector.call', 'mastr.write'],
        },
        dossierEvidence: {
          status: 'blended_overlay_ready',
          tenantId: 'stadtwerk-mauer',
          municipality: 'Mauer',
          postalCode: '69256',
          assetCount: 1,
          totalCapacityKw: 12.5,
          virtualGridOperatorName: 'Stadtwerk Mauer',
          realWorldOperatorHint: 'Syna GmbH',
        },
      });

      const result = await broker.call('dashboard-api.stadtwerkMauerMastrDataOverlayStatus', {
        tenantId: 'stadtwerk-mauer',
        limit: 10,
      });

      expect(result.status).toBe('blended_overlay_ready');
      expect(result.originalGridOperators[0].name).toBe('Syna GmbH');
      expect(result.sampleAssets[0].virtualGridOperatorName).toBe('Stadtwerk Mauer');
      expect(result.sourceActions.notCalled).toContain('mastr.write');
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
