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
const STADTWERK_MAUER_WORKBENCH_MANIFEST = require('../integrations/budibase/manifests/stadtwerk-mauer-workbench.json');

function expectScalarTableRows(rows) {
  expect(Array.isArray(rows)).toBe(true);
  for (const row of rows) {
    for (const value of Object.values(row)) {
      expect(value == null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
    }
  }
}

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

const MOCK_VNBDIGITAL_SEARCH = {
  data: {
    searchTerm: 'Mauer',
    results: [
      {
        _id: 'community-mauer',
        title: 'Mauer',
        type: 'COMMUNITY',
        entityType: 'community',
        entityId: 'community-mauer',
        lookupHint: 'vnbdigital_lookup:community',
      },
    ],
    total: 1,
  },
};

const MOCK_VNBDIGITAL_LOOKUP = {
  data: {
    searchType: 'community',
    communityId: 'community-mauer',
    result: {
      vnbs: [
        {
          _id: '7214',
          name: 'Netze BW GmbH',
          profileUrl: 'https://www.vnbdigital.de/vnb/7214',
          voltageTypes: ['Hochspannung', 'Mittelspannung', 'Niederspannung'],
        },
      ],
    },
  },
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

const MOCK_WILLI_MAKO_RESOLVE_STRUCTURE = {
  success: true,
  data: {
    topic: 'UTILMD Marktkommunikation Evidenzkette MaLo MeLo Abrechnung',
    sources: [
      {
        id: 'wm-1',
        title: 'UTILMD Strukturwechsel Uebersicht',
        url: 'https://stromhaltig.de/wissen/utilmd-strukturwechsel',
      },
    ],
    structuralHints: [{ category: 'edifact', tags: ['UTILMD'], hint: 'UTILMD context hint' }],
    validationCandidates: [
      {
        topic: 'UTILMD Strukturwechsel Uebersicht',
        sourceId: 'wm-1',
        confidenceHint: 20,
        suggestedUse: 'structural_hint_only',
      },
    ],
    noCallBoundaries: [
      'This response is not legally binding and is not an instruction to send a MaKo message.',
    ],
    confidence: 'low',
  },
};

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
        vnbdigitalSearch: makeHandler('vnbdigitalSearch', MOCK_VNBDIGITAL_SEARCH),
        vnbdigitalLookup: makeHandler('vnbdigitalLookup', MOCK_VNBDIGITAL_LOOKUP),
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

    // Mock willi-mako
    broker.createService({
      name: 'willi-mako',
      actions: {
        resolveStructure: makeHandler(
          'williMakoResolveStructure',
          MOCK_WILLI_MAKO_RESOLVE_STRUCTURE
        ),
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
        federatedSearch: makeHandler('knowledgeRagFederatedSearch', {
          results: [
            {
              sourceId: 'rag:federated:1',
              sourceVersion: 'v1',
              collection: 'federated',
              title: 'GPKE Lieferantenwechsel Fristen',
              score: 0.81,
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
            case_annotation: 0,
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
            notCalled: [
              'mako.dispatch',
              'billing.release',
              'device-control.execute',
              'personal-agent.execute',
            ],
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
        listCaseAnnotations: makeHandler('stadtwerkMauerListCaseAnnotations', {
          capabilityKey: 'stadtwerk_mauer_case_annotations',
          safety: 'read_only_sandbox_annotation_readback',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          requiredCaseId: 'smm-budibase-workbench',
          sandboxBoundaryAllowed: true,
          selectedCaseAllowed: true,
          found: true,
          status: 'case_annotations_empty',
          currentDemoStatus: 'needs_evidence',
          annotationCount: 0,
          annotationRows: [],
          auditRows: [],
        }),
        recordCaseAnnotation: makeHandler('stadtwerkMauerRecordCaseAnnotation', {
          accepted: true,
          rejected: false,
          duplicate: false,
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          commandId: 'smm-case-annotation:test',
          commandType: 'add_operator_note_sandbox',
          priorStatus: 'needs_evidence',
          nextStatus: 'needs_evidence',
          currentDemoStatus: 'needs_evidence',
          actorLabel: 'budibase:operator',
          sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
          timestamp: '2026-06-28T17:00:00.000Z',
          dataClass: 'sandbox_runtime_artifact',
          annotationRows: [
            {
              annotationId: 'smm-case-annotation:test',
              caseId: 'smm-budibase-workbench',
              commandType: 'add_operator_note_sandbox',
              currentStatus: 'needs_evidence',
              priorStatus: 'needs_evidence',
              actorLabel: 'budibase:operator',
              sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
              noteLabel: 'Budibase sandbox handover note',
              reasonLabel: 'visible-demo annotation command',
              dataClass: 'sandbox_runtime_artifact',
              createdAt: '2026-06-28T17:00:00.000Z',
            },
          ],
          auditRows: [
            {
              auditId: 'smm-case-annotation:test',
              caseId: 'smm-budibase-workbench',
              actorLabel: 'budibase:operator',
              sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
              transitionLabel: 'needs_evidence -> needs_evidence',
              commandType: 'add_operator_note_sandbox',
              idempotencyKey: 'budibase-smm-workbench-case-annotation',
              createdAt: '2026-06-28T17:00:00.000Z',
            },
          ],
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
            notCalled: [
              'mako.dispatch',
              'billing.release',
              'device-control.execute',
              'personal-agent.execute',
            ],
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
            notCalled: [
              'mako.dispatch',
              'billing.release',
              'external.connector.call',
              'personal-agent.execute',
            ],
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
        result.missingEvidence.some(
          (item) => item.missingDataPoint === 'network_operator_confirmation'
        )
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

    it('v0.99.1: skips the federated knowledge probe by default (opt-in only)', async () => {
      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Standard-Audit ohne federated knowledge',
        scopeId: 'grid-area:demo',
      });

      expect(result.federatedKnowledgeProbe).toEqual({
        attempted: false,
        status: 'skipped',
        sources: 0,
      });
      // Default audit scoring must remain entirely unaffected by this optional field.
      expect(result.sourceActions['knowledge-rag.federatedSearch']).toBeUndefined();
    });

    it('v0.99.1: probes knowledge-rag.federatedSearch when includeFederatedKnowledge=true', async () => {
      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Audit mit federated knowledge Probe',
        scopeId: 'grid-area:demo',
        includeFederatedKnowledge: true,
      });

      expect(result.federatedKnowledgeProbe).toEqual({
        attempted: true,
        status: 'available',
        sources: 1,
      });
    });

    it('v0.99.1: reports federated probe as unavailable without degrading the core audit when it fails', async () => {
      handlers.knowledgeRagFederatedSearch = () => {
        throw new Error('federated search unavailable');
      };

      const result = await broker.call('dashboard-api.evidenceGroundingConfidenceAudit', {
        domain: 'grid_connection',
        query: 'Audit mit fehlschlagender federated knowledge Probe',
        scopeId: 'grid-area:demo',
        datasourceId: 'datasource:operator',
        datapointId: 'datapoint:confirmed:1',
        networkOperatorConfirmed: true,
        includeFederatedKnowledge: true,
      });

      expect(result.federatedKnowledgeProbe.status).toBe('unavailable');
      // The core (pre-existing) audit outcome is unaffected by an optional-probe failure.
      expect(result.answerStatus).toBe('ok');
      expect(result.evidenceConfidence.level).toBe('high');

      delete handlers.knowledgeRagFederatedSearch;
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

      it('does not call willi-mako and omits makoKnowledgeContext by default (#496)', async () => {
        const spy = jest.fn(() => MOCK_WILLI_MAKO_RESOLVE_STRUCTURE);
        handlers.williMakoResolveStructure = spy;

        const result = await broker.call('dashboard-api.marketCommunicationEvidenceChainStatus', {
          maloId: 'DE-MALO-1',
        });

        expect(spy).not.toHaveBeenCalled();
        expect(result.makoKnowledgeContext).toBeUndefined();
      });

      it('attaches an advisory makoKnowledgeContext when includeMakoKnowledge=true (#496)', async () => {
        const result = await broker.call('dashboard-api.marketCommunicationEvidenceChainStatus', {
          maloId: 'DE-MALO-1',
          includeMakoKnowledge: true,
        });

        expect(result.makoKnowledgeContext).toMatchObject({
          available: true,
          topic: 'UTILMD Marktkommunikation Evidenzkette MaLo MeLo Abrechnung',
          confidence: 'low',
        });
        expect(result.makoKnowledgeContext.sources).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: 'wm-1' })])
        );
        expect(result.makoKnowledgeContext.noCallBoundaries.join(' ')).toMatch(
          /not legally binding/i
        );
        // Attaching MaKo context must never change the core evidence-chain fields.
        expect(result.status).toBeDefined();
        expect(result.officialEvidence).toBeDefined();
      });

      it('degrades to available:false without failing the endpoint when willi-mako is unavailable (#496)', async () => {
        handlers.williMakoResolveStructure = () => ({
          success: false,
          error: { code: 'MISSING_TOKEN', message: 'CERNION_TOKEN environment variable not set.' },
        });

        const result = await broker.call('dashboard-api.marketCommunicationEvidenceChainStatus', {
          maloId: 'DE-MALO-1',
          includeMakoKnowledge: true,
        });

        expect(result.status).toBeDefined();
        expect(result.makoKnowledgeContext).toEqual({
          available: false,
          error: 'MISSING_TOKEN',
        });
        expect(JSON.stringify(result)).not.toMatch(/CERNION_TOKEN=|Bearer\s+\S+/);
      });

      it('degrades to available:false without throwing when willi-mako.resolveStructure rejects (#496)', async () => {
        handlers.williMakoResolveStructure = () => {
          throw new Error('service unavailable');
        };

        const result = await broker.call('dashboard-api.marketCommunicationEvidenceChainStatus', {
          maloId: 'DE-MALO-1',
          includeMakoKnowledge: true,
        });

        expect(result.status).toBeDefined();
        expect(result.makoKnowledgeContext).toEqual({
          available: false,
          error: 'MAKO_KNOWLEDGE_UNAVAILABLE',
        });
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
        expect(
          result.evidenceMatrix.find((step) => step.stepId === 'connection_intake')
        ).toMatchObject({
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
          expect.arrayContaining([
            'hitl.create',
            'assets.applyOverride',
            'grid-operations.executeControl',
          ])
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

    // ── coordinationMeaningPreservationProfile ─────────────────────────────

    describe('coordinationMeaningPreservationProfile', () => {
      it('reports decision-context gaps without calling Fachsystem or downstream actions', async () => {
        const result = await broker.call('dashboard-api.coordinationMeaningPreservationProfile', {
          caseId: 'case-402',
          sourceDomain: 'Netzbetrieb',
          targetDomain: 'Planung',
          regulatoryReference: '14a-readiness',
          networkConstraint: 'transformer-limit',
        });

        expect(result.capabilityKey).toBe('coordination_meaning_preservation_profile');
        expect(result.status).toBe('needs_decision_context');
        expect(result.coordinationLossClassification).toBe('decision_context_missing');
        expect(result.preservedDimensions.map((item) => item.id)).toEqual(
          expect.arrayContaining(['regulatory_reference', 'network_constraint'])
        );
        expect(result.missingDimensions.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining(['commercial_effect', 'evidence_proof', 'owner', 'next_decision'])
        );
        expect(result.positiveFollowUps[0].category).toBe(
          'coordination_meaning_preservation_profile'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'external.connector.call',
            'fachsystem.write',
            'hitl.create',
            'billing.release',
            'mako.dispatch',
            'device-control.execute',
            'budibase.write',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns meaning_preserved when all preservation dimensions are supplied', async () => {
        const result = await broker.call('dashboard-api.coordinationMeaningPreservationProfile', {
          caseId: 'case-402',
          sourceDomain: 'EDM',
          targetDomain: 'Abrechnung',
          regulatoryReference: 'EnWG-42c',
          commercialEffect: 'tariff-impact-reviewed',
          networkConstraint: 'not-applicable',
          evidenceProof: 'vdmi:evidence-402',
          owner: 'Abrechnung',
          deadline: '2026-08-01',
          nextDecision: 'billing-boundary-review',
          operationalRisk: 'low',
        });

        expect(result.status).toBe('meaning_preserved');
        expect(result.coordinationLossClassification).toBe('meaning_preserved');
        expect(result.missingDimensions).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Preserved dimensions: 8/8');
        expect(result.dossierEvidence.dossierFacts).toContain('Handover: EDM -> Abrechnung');
      });
    });

    // -- a2mdmDecisionObjectStatus ----------------------------------------

    describe('a2mdmDecisionObjectStatus', () => {
      it('reports missing decision-object context without triggering downstream actions', async () => {
        const result = await broker.call('dashboard-api.a2mdmDecisionObjectStatus', {
          caseId: 'case-423',
          subject: 'Flexible Netzanschluss Freigabe',
          technicalConstraint: 'transformer-limit',
          regulatoryReference: 'EnWG-14a-context',
        });

        expect(result.capabilityKey).toBe('a2mdm_decision_object_meaning_preservation');
        expect(result.status).toBe('needs_decision_context');
        expect(result.safety).toBe('read_only_decision_context_projection');
        expect(result.decisionRows.every((row) => row.scalar === true)).toBe(true);
        expect(result.missingInputs.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'business_intent',
            'evidence_source',
            'owner_role',
            'risk_level',
            'decision_threshold',
            'next_gate',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe(
          'a2mdm_decision_object_meaning_preservation'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'a2mdm.persist',
            'budibase.table.write',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
      });

      it('returns decision_context_preserved for a complete synthetic decision object', async () => {
        const result = await broker.call('dashboard-api.a2mdmDecisionObjectStatus', {
          caseId: 'case-423-complete',
          subject: 'Stadtwerk Mauer flexible connection release',
          businessIntent: 'reserve-capacity-after-evidence-review',
          technicalConstraint: 'nvp-capacity-window-q3',
          regulatoryReference: 'EnWG-14a-context',
          evidenceSource: 'vdmi:release-file-seed-v1',
          ownerRole: 'Netzplanung',
          riskLevel: 'medium',
          decisionThreshold: 'all-release-evidence-present',
          nextGate: 'human-release-review',
        });

        expect(result.status).toBe('decision_context_preserved');
        expect(result.missingInputs).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Open missing inputs: 0');
        expect(result.dossierEvidence.dossierFacts).toContain('Owner: Netzplanung');
        expect(result.sourceActions.notCalled).toContain('landing-registry.publish');
      });
    });

    // ── gremiencoachWorkbookReadinessStatus ────────────────────────────────

    describe('gremiencoachWorkbookReadinessStatus', () => {
      it('reports private-prep workbook gaps without ingesting documents or creating Office files', async () => {
        const result = await broker.call('dashboard-api.gremiencoachWorkbookReadinessStatus', {
          tenantId: 'stadtwerk-mauer',
          workbookId: 'synthetic-vnb-gremienmappe',
          committeeContext: 'board-prep',
          processHint: 'vdmi',
          evidenceProfile: 'anonymized-vnb-pattern',
          processRole: 'Netzplanung',
        });

        expect(result.capabilityKey).toBe('gremiencoach_workbook_readiness');
        expect(result.status).toBe('needs_source_evidence');
        expect(result.claimRows.map((row) => row.status)).toContain('not_yet_claimable');
        expect(result.evidenceGapRows.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'source_register',
            'regulatory_reference',
            'artifact_classification',
            'release_boundary',
          ])
        );
        expect(result.draftArtifactRows[0]).toMatchObject({
          artifactType: 'word_outline',
          createsFile: false,
        });
        expect(result.guardrailRows.map((row) => row.guardrailId)).toEqual(
          expect.arrayContaining(['no_private_document_ingestion', 'no_office_generation'])
        );
        expect(result.positiveFollowUpRows[0].category).toBe('gremiencoach_workbook_readiness');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'document.upload',
            'office.word.create',
            'm365.graph.call',
            'publication.publish',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready_for_private_prep when all workbook evidence boundaries are supplied', async () => {
        const result = await broker.call('dashboard-api.gremiencoachWorkbookReadinessStatus', {
          tenantId: 'stadtwerk-mauer',
          workbookId: 'synthetic-vnb-gremienmappe',
          committeeContext: 'board-prep',
          processHint: 'vdmi',
          sourceRegister: 'register:claims-evidence-v1',
          processRole: 'Netzplanung',
          regulatoryReference: 'EnWG-14a-context',
          artifactClassification: 'draft-intent-only',
          releaseBoundary: 'private-prep-no-publication',
          includeSyntheticRows: true,
        });

        expect(result.status).toBe('ready_for_private_prep');
        expect(result.evidenceGapRows).toEqual([]);
        expect(result.claimRows.every((row) => row.status === 'claimable_with_evidence')).toBe(
          true
        );
        expect(result.dossierEvidence.dossierFacts).toContain('Open evidence gaps: 0');
        expect(result.sourceActions.notCalled).toContain('office.powerpoint.create');
      });
    });

    // ── decisionReadinessMatrixStatus ──────────────────────────────────────

    describe('decisionReadinessMatrixStatus', () => {
      it('reports explicit decision-readiness gaps without creating downstream actions', async () => {
        const result = await broker.call('dashboard-api.decisionReadinessMatrixStatus', {
          caseId: 'case-379',
          measureName: 'OPL grid study',
          category: 'no_regret',
          owner: 'Netzplanung',
          openEvidence: 'budget-note',
        });

        expect(result.status).toBe('evidence_gap');
        expect(result.capabilityKey).toBe('decision_readiness_matrix');
        expect(result.rows[0]).toMatchObject({
          measureName: 'OPL grid study',
          readiness: 'evidence_gap',
        });
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'budget_status',
            'financing_option',
            'risk_if_not_implemented',
            'evidence_source',
            'committee_window',
            'next_decision_point',
            'open_evidence',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('decision_readiness_matrix');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budget.approve',
            'sap.erp.write',
            'hitl.create',
            'billing.release',
            'external.connector.call',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns decision_ready for a fully evidenced measure row', async () => {
        const result = await broker.call('dashboard-api.decisionReadinessMatrixStatus', {
          caseId: 'case-379',
          measureId: 'measure-379',
          measureName: 'Transformer replacement',
          category: 'asset_investment',
          budgetStatus: 'minimum-budget-confirmed',
          financingOption: 'internal-planning-budget',
          riskIfNotImplemented: 'capacity-delay',
          evidenceSource: 'opl:row-379',
          owner: 'Assetmanagement',
          committeeWindow: '2026-Q3',
          nextDecisionPoint: 'investment-committee',
        });

        expect(result.status).toBe('decision_ready');
        expect(result.readinessCounts.decision_ready).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Decision-ready rows: 1');
      });

      it('flags budget and financing uncertainty as financing_risk', async () => {
        const result = await broker.call('dashboard-api.decisionReadinessMatrixStatus', {
          measureName: 'Cable section renewal',
          category: 'renewal',
          budgetStatus: 'budget-risk-open',
          financingOption: 'unknown',
          riskIfNotImplemented: 'outage-risk',
          evidenceSource: 'budget-list:17',
          owner: 'Netzplanung',
          committeeWindow: '2026-Q4',
          nextDecisionPoint: 'capex-board',
        });

        expect(result.status).toBe('financing_risk');
        expect(result.rows[0].readiness).toBe('financing_risk');
      });
    });

    // ── crossSystemVarianceMatrixStatus ───────────────────────────────────

    describe('crossSystemVarianceMatrixStatus', () => {
      it('reports explicit variance gaps without creating downstream actions', async () => {
        const result = await broker.call('dashboard-api.crossSystemVarianceMatrixStatus', {
          caseId: 'case-381',
          sourceSystem: 'GIS',
          targetSystem: 'RevenueLedger',
          affectedObject: 'NAP-4711',
          owner: 'Assetmanagement',
          openEvidence: 'official-source-snapshot',
        });

        expect(result.status).toBe('evidence_gap');
        expect(result.capabilityKey).toBe('cross_system_variance_matrix');
        expect(result.rows[0]).toMatchObject({
          sourceSystem: 'GIS',
          targetSystem: 'RevenueLedger',
          affectedObject: 'NAP-4711',
          varianceState: 'evidence_gap',
        });
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'amount_eur',
            'revenue_impact',
            'asset_scope',
            'deadline',
            'evidence',
            'threshold',
            'open_evidence',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('cross_system_variance_matrix');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'erp.sap.write',
            'gis.sync',
            'asset-mdm.correct',
            'revenue.book',
            'billing.release',
            'external.connector.call',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns management_ready for a fully evidenced variance row', async () => {
        const result = await broker.call('dashboard-api.crossSystemVarianceMatrixStatus', {
          caseId: 'case-381',
          varianceId: 'variance-381',
          sourceSystem: 'GIS',
          targetSystem: 'RevenueLedger',
          domain: 'asset_revenue',
          affectedObject: 'NAP-4711',
          amountEur: 12500,
          revenueImpact: 'material-revenue-delta',
          assetScope: 'medium-voltage-feeder',
          owner: 'Assetmanagement',
          deadline: '2026-Q3',
          evidence: 'variance-ticket:381',
          threshold: 'management-threshold',
          resolutionStatus: 'ready-for-management-review',
        });

        expect(result.status).toBe('management_ready');
        expect(result.varianceCounts.management_ready).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Management-ready rows: 1');
      });

      it('flags quantified revenue variance without threshold as revenue_risk', async () => {
        const result = await broker.call('dashboard-api.crossSystemVarianceMatrixStatus', {
          sourceSystem: 'ERP',
          targetSystem: 'Billing',
          domain: 'revenue',
          affectedObject: 'MaLo-381',
          amountEur: 7400,
          revenueImpact: 'revenue-delta-open',
          assetScope: 'metering-point',
          owner: 'Abrechnung',
          evidence: 'ledger-export:381',
        });

        expect(result.status).toBe('revenue_risk');
        expect(result.rows[0].varianceState).toBe('revenue_risk');
      });
    });

    // -- regulatorySignalProcessTranslatorStatus ---------------------------

    describe('regulatorySignalProcessTranslatorStatus', () => {
      it('returns provenance and process gaps without legal interpretation or downstream actions', async () => {
        const result = await broker.call('dashboard-api.regulatorySignalProcessTranslatorStatus', {
          signalId: 'signal-380',
          sourceName: 'BNetzA',
          affectedDomain: 'messstellenbetrieb',
          deadlineHint: '2026-Q4',
        });

        expect(result.status).toBe('needs_signal_provenance');
        expect(result.capabilityKey).toBe('regulatory_signal_process_translator');
        expect(result.affectedProcesses[0]).toMatchObject({
          processKey: 'metering_operations',
          affectedDomain: 'messstellenbetrieb',
        });
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'signal_summary',
            'published_at',
            'process_hint',
            'owner_hint',
            'evidence_hint',
            'test_case_hint',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('regulatory_signal_process_translator');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'legal.interpret',
            'compliance.decide',
            'bnetza.crawler.fetch',
            'hitl.create',
            'mako.dispatch',
            'billing.release',
            'device-control.execute',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns an operational translation matrix for complete supplied signal facts', async () => {
        const result = await broker.call('dashboard-api.regulatorySignalProcessTranslatorStatus', {
          signalId: 'signal-380',
          sourceName: 'BNetzA',
          publishedAt: '2026-07-01',
          summary: 'Flexibilitaet und Messstellenbetrieb brauchen neue Nachweismatrix.',
          affectedDomain: 'flexibilitaet',
          processHint: 'steuerbarkeitscheck',
          deadlineHint: '2026-Q4',
          ownerHint: 'Netzbetrieb',
          evidenceHint: 'regulatory-signal-ticket:380',
          testCaseHint: 'no-device-control-smoke',
        });

        expect(result.status).toBe('operational_translation_ready');
        expect(result.confidence).toBe('medium');
        expect(result.missingEvidence).toEqual([]);
        expect(result.affectedProcesses.map((process) => process.processKey)).toEqual(
          expect.arrayContaining(['metering_operations', 'flexibility_grid_operations'])
        );
        expect(result.dataRequirements.map((entry) => entry.label)).toEqual(
          expect.arrayContaining(['asset controllability scope', 'supplied owner hint'])
        );
        expect(result.dossierEvidence.dossierFacts).toContain('Open gaps: 0');
      });
    });

    // ── steeringArtifactAcceptanceGateStatus ────────────────────────────────

    describe('steeringArtifactAcceptanceGateStatus', () => {
      it('reports explicit acceptance and maintenance gaps without creating downstream actions', async () => {
        const result = await broker.call('dashboard-api.steeringArtifactAcceptanceGateStatus', {
          artifactType: 'fuehrungskarte',
          artifactName: 'Redispatch Steuerungskarte',
          targetRole: 'Netzbetrieb',
          useCase: 'weekly redispatch risk review',
          itemCount: 12,
        });

        expect(result.status).toBe('needs_maintenance_owner');
        expect(result.capabilityKey).toBe('steering_artifact_acceptance_gate');
        expect(result.scalarRows.map((row) => row.id)).toEqual(
          expect.arrayContaining(['artifact_identity', 'target_role', 'bounded_item_count'])
        );
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'maintenance_effort',
            'update_cadence',
            'owner',
            'deputy_owner',
            'usage_evidence',
            'escalation_criterion',
            'rollout_decision',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('steering_artifact_acceptance_gate');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining(['budibase.table.write', 'workflow.execute', 'hitl.create'])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready_for_limited_rollout when all acceptance facts are supplied', async () => {
        const result = await broker.call('dashboard-api.steeringArtifactAcceptanceGateStatus', {
          artifactType: 'workbench-card',
          artifactName: 'Grid Planning Next Gate',
          targetRole: 'Netzplanung',
          useCase: 'daily role queue review',
          itemCount: 8,
          maintenanceMinutesPerWeek: 45,
          updateCadence: 'weekly',
          owner: 'Netzplanung Lead',
          deputyOwner: 'Assetmanagement Deputy',
          usageEvidence: 'used in weekly planning round',
          escalationCriterion: 'retire if unused for two cycles',
          rolloutDecision: 'limited-rollout-approved',
        });

        expect(result.status).toBe('ready_for_limited_rollout');
        expect(result.missingEvidence).toEqual([]);
        expect(result.operationalRisks).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Provided gate evidence: 11/11');
        expect(result.sourceActions.notCalled).toContain('personal-agent.execute');
      });

      it('recommends retire or rework for oversized or explicitly retired artifacts', async () => {
        const result = await broker.call('dashboard-api.steeringArtifactAcceptanceGateStatus', {
          artifactType: 'cockpit',
          artifactName: 'Alle Transformationskarten',
          targetRole: 'Geschaeftsfuehrung',
          useCase: 'monthly review',
          itemCount: 60,
          maintenanceMinutesPerWeek: 180,
          owner: 'PMO',
          rolloutDecision: 'rework before rollout',
        });

        expect(result.status).toBe('should_retire_or_rework');
        expect(result.operationalRisks.map((risk) => risk.code)).toEqual(
          expect.arrayContaining(['artifact_scope_too_large', 'maintenance_effort_too_high'])
        );
        expect(result.validationFindings.map((finding) => finding.code)).toContain(
          'SAAG_ARTIFACT_SCOPE_TOO_LARGE'
        );
      });
    });

    // ── communicationBreakProcessRiskStatus ────────────────────────────────

    describe('communicationBreakProcessRiskStatus', () => {
      it('reports process-risk gaps without creating downstream actions', async () => {
        const result = await broker.call('dashboard-api.communicationBreakProcessRiskStatus', {
          processDomain: 'Netzplanung',
          affectedDecision: 'Freigabe Zielnetz-Variante',
          presentationStatus: 'slides-presented',
          protocolStatus: 'missing',
          owner: 'Netzplanung Lead',
        });

        expect(result.status).toBe('blocked_decision_needs_evidence');
        expect(result.riskLevel).toBe('high');
        expect(result.capabilityKey).toBe('communication_break_process_risk');
        expect(result.scalarRows.map((row) => row.id)).toEqual(
          expect.arrayContaining(['process_domain', 'affected_decision', 'protocol_status'])
        );
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'question_response_window',
            'information_duty',
            'fachliche_begleitung',
            'deputy',
            'blocked_decision',
            'next_evidence_point',
            'due_date',
            'escalation_criterion',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('communication_break_process_risk');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'hr.personScore',
            'email.ingest',
            'workflow.execute',
            'hitl.create',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns next-gate-ready status when all process-risk facts are supplied', async () => {
        const result = await broker.call('dashboard-api.communicationBreakProcessRiskStatus', {
          processDomain: 'Netzplanung',
          affectedDecision: 'Freigabe Zielnetz-Variante',
          presentationStatus: 'management-round-presented',
          protocolStatus: 'protocol-linked',
          questionResponseWindow: '5 working days',
          informationDuty: 'grid planning shares NAP assumptions before board review',
          fachlicheBegleitung: 'asset management accompanies technical questions',
          owner: 'Netzplanung Lead',
          deputy: 'Assetmanagement Deputy',
          blockedDecision: 'investment-gate-2',
          nextEvidencePoint: 'NAP assumption protocol appendix',
          dueDate: '2026-07-15',
          escalationCriterion: 'escalate if no response after two cycles',
          proofLabel: 'Protocol 2026-06-27',
        });

        expect(result.status).toBe('process_risk_ready_for_next_gate');
        expect(result.riskLevel).toBe('low');
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided process-risk evidence: 14/14'
        );
        expect(result.sourceActions.notCalled).toContain('personal-agent.execute');
        expect(result.sourceActions.notCalled).toContain('device-control.execute');
      });
    });

    // ── noRegretMeasureProofGateStatus ────────────────────────────────────

    describe('noRegretMeasureProofGateStatus', () => {
      it('reports No-Regret proof gaps without approving investment or reserving budget', async () => {
        const result = await broker.call('dashboard-api.noRegretMeasureProofGateStatus', {
          measureName: 'Trafostationsreserve Nord',
          targetDomain: 'Netzplanung',
          costRange: '120-180k EUR',
          decisionOwner: 'Assetmanagement Lead',
        });

        expect(result.status).toBe('needs_scenario_budget_evidence');
        expect(result.riskLevel).toBe('high');
        expect(result.capabilityKey).toBe('no_regret_measure_proof_gate');
        expect(result.scalarRows.map((row) => row.id)).toEqual(
          expect.arrayContaining([
            'measure_identity',
            'target_domain',
            'scenario_coverage',
            'budget_anchor',
          ])
        );
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'scenario_coverage',
            'budget_anchor',
            'expected_benefit_range',
            'regulatory_fit',
            'objection_window',
            'evidence_source',
            'next_management_gate',
            'due_date',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('no_regret_measure_proof_gate');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budget.reserve',
            'investment.approve',
            'workflow.execute',
            'hitl.create',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns management-prioritization-ready status when proof evidence is supplied', async () => {
        const result = await broker.call('dashboard-api.noRegretMeasureProofGateStatus', {
          measureName: 'Trafostationsreserve Nord',
          measureType: 'capacity-buffer',
          targetDomain: 'Netzplanung',
          scenarioCoverage: 'baseline, heat-pump growth, PV peak backfeed',
          budgetAnchor: 'CAPEX pool 2026 preliminary range',
          costRange: '120-180k EUR',
          expectedBenefitRange: 'risk reduction 220-310k EUR avoided delay exposure',
          regulatoryFit: 'compatible with grid-development and §14a evidence flags',
          decisionOwner: 'Assetmanagement Lead',
          objectionWindow: '10 working days',
          evidenceSource: 'scenario pack 2026-06-27',
          nextManagementGate: 'investment-prioritization-board',
          dueDate: '2026-07-20',
          proofLabel: 'Scenario Pack 2026-06',
        });

        expect(result.status).toBe('measure_ready_for_management_prioritization_review');
        expect(result.riskLevel).toBe('low');
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Provided proof evidence: 13/13');
        expect(result.sourceActions.notCalled).toContain('personal-agent.execute');
        expect(result.sourceActions.notCalled).toContain('tariff.mutate');
      });
    });

    // ── anschlusskapazitaetEvidenceQueueStatus ────────────────────────────

    describe('anschlusskapazitaetEvidenceQueueStatus', () => {
      it('reports connection-capacity evidence gaps without consequential actions', async () => {
        const result = await broker.call('dashboard-api.anschlusskapazitaetEvidenceQueueStatus', {
          connectionRequestId: 'ar-299',
          netzverknuepfungspunktHint: 'nvp-mauer-west',
          capacityAssumptionKw: 1250,
          owner: 'netzplanung',
        });

        expect(result.status).toBe('needs_legal_review');
        expect(result.evidenceQueue).toMatchObject({
          connectionRequestId: 'ar-299',
          netzverknuepfungspunktHint: 'nvp-mauer-west',
          capacityAssumptionKw: 1250,
          owner: 'netzplanung',
          capacityReserved: false,
          connectionDecisionApplied: false,
        });
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'grid_restriction_hint',
            'future_demand_context',
            'legal_question_marker',
            'fnav_option_marker',
            'owner_due_date',
            'next_gate',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('anschlusskapazitaet_evidence_queue');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'grid-connection.reserveCapacity',
            'grid-connection.approve',
            'grid-connection.reject',
            'fnav.decide',
            'hitl.create',
            'settlement.prepareBilling',
            'external.connector.call',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready_for_review when all evidence queue facts are supplied', async () => {
        const result = await broker.call('dashboard-api.anschlusskapazitaetEvidenceQueueStatus', {
          connectionRequestId: 'ar-299',
          netzverknuepfungspunktHint: 'nvp-mauer-west',
          capacityAssumptionKw: 1250,
          gridRestrictionHint: 'ms-ring-west-constraint-documented',
          futureDemandContext: 'pv-and-storage-growth-2026',
          legalQuestionMarker: 'fnav-check-required',
          fnavOptionMarker: 'fnav-option-open',
          evidenceStatus: 'complete',
          owner: 'netzplanung',
          dueDate: '2026-07-15',
          nextGate: 'management-review',
        });

        expect(result.status).toBe('ready_for_review');
        expect(result.missingEvidence).toEqual([]);
        expect(result.readinessScore).toBe(1);
        expect(result.nextGate).toBe('management-review');
        expect(result.dossierEvidence.dossierFacts).toContain('Status: ready_for_review');
        expect(result.sourceActions.notCalled).toContain('grid-connection.reserveCapacity');
      });
    });

    // -- connectionDeadlineEvidenceQueueStatus ------------------------------

    describe('connectionDeadlineEvidenceQueueStatus', () => {
      it('reports deadline-critical connection evidence gaps without side effects', async () => {
        const result = await broker.call('dashboard-api.connectionDeadlineEvidenceQueueStatus', {
          caseId: 'gc-77',
          connectionType: 'grossspeicher',
          deadlineDate: '2026-07-04',
          responsibleVnb: 'stadtwerk-mauer',
          owner: 'netzanschluss',
          clarificationPoints: ['technische-plausibilitaet-offen'],
          asOf: '2026-07-01T00:00:00.000Z',
        });

        expect(result.status).toBe('fristkritisch');
        expect(result.deadlineRisk).toBe('fristkritisch');
        expect(result.evidenceQueue).toMatchObject({
          caseId: 'gc-77',
          connectionType: 'grossspeicher',
          responsibleVnb: 'stadtwerk-mauer',
          owner: 'netzanschluss',
          communicationSent: false,
          connectionDecisionApplied: false,
        });
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'technical_plausibility',
            'next_gate',
            'clarification_points_open',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('connection_deadline_evidence_queue');
        expect(result.communicationNoteDraft.sent).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'communication.send',
            'email.send',
            'crm.update',
            'grid-connection.approve',
            'grid-connection.reject',
            'deadline.legalCalculate',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns im_plan when all deadline evidence facts are supplied', async () => {
        const result = await broker.call('dashboard-api.connectionDeadlineEvidenceQueueStatus', {
          caseId: 'gc-78',
          connectionType: 'pv',
          deadlineDate: '2026-08-20',
          responsibleVnb: 'stadtwerk-mauer',
          technicalPlausibility: 'nvp-plausibility-documented',
          owner: 'netzanschluss',
          nextGate: 'fachliche-freigabe',
          communicationContext: 'Nachweise vollstaendig, Freigabegate vorbereitet.',
          asOf: '2026-07-01T00:00:00.000Z',
        });

        expect(result.status).toBe('im_plan');
        expect(result.deadlineRisk).toBe('im_plan');
        expect(result.missingEvidence).toEqual([]);
        expect(result.nextGate).toBe('fachliche-freigabe');
        expect(result.communicationNoteDraft.status).toBe('draft_ready');
        expect(result.dossierEvidence.dossierFacts).toContain('Status: im_plan');
        expect(result.sourceActions.notCalled).toContain('communication.send');
      });
    });

    // -- layer0AuditDrilldownNoteStatus ------------------------------------

    describe('layer0AuditDrilldownNoteStatus', () => {
      it('reports audit drilldown evidence gaps without consequential actions', async () => {
        const result = await broker.call('dashboard-api.layer0AuditDrilldownNoteStatus', {
          kpiId: 'l0-grid-process-duration',
          dataSource: 'layer0-kpi-export-q2',
          owner: 'prozessmanagement',
        });

        expect(result.status).toBe('needs_peer_deviation');
        expect(result.auditNote).toMatchObject({
          kpiId: 'l0-grid-process-duration',
          dataSource: 'layer0-kpi-export-q2',
          owner: 'prozessmanagement',
          persistentQueueCreated: false,
          reportGenerated: false,
          finalJudgmentApplied: false,
        });
        expect(result.checkFields).toHaveLength(10);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining(['peer_deviation', 'next_90_day_focus'])
        );
        expect(result.positiveFollowUps[0].category).toBe('layer0_audit_drilldown_note');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'audit-queue.create',
            'benchmark.connector.fetch',
            'report.pdf.generate',
            'legal.interpret',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready_for_management_validation with ten check fields when all core facts are supplied', async () => {
        const result = await broker.call('dashboard-api.layer0AuditDrilldownNoteStatus', {
          kpiId: 'l0-grid-process-duration',
          topic: 'grid-connection-cycle-time',
          dataSource: 'layer0-kpi-export-q2',
          peerDeviation: '+38pct-vs-peer-median',
          benchmarkPeerGroup: 'regional-vnb-peer-group',
          processHint: 'netzanschluss',
          periodHint: '2026-Q2',
          observedValue: '42',
          expectedValue: '30',
          unit: 'days',
          evidenceStatus: 'validated',
          owner: 'prozessmanagement',
          next90DayFocus: 'validate-source-and-owner-action',
        });

        expect(result.status).toBe('ready_for_management_validation');
        expect(result.missingEvidence).toEqual([]);
        expect(result.validationScore).toBe(1);
        expect(result.checkFields).toHaveLength(10);
        expect(result.auditNote.next90DayStep).toBe('validate-source-and-owner-action');
        expect(result.dossierEvidence.dossierFacts).toContain('Check Fields: 10/10');
        expect(result.sourceActions.notCalled).toContain('benchmark.connector.fetch');
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
          expect.arrayContaining([
            'legal_status',
            'owner_contact',
            'red_lines',
            'implementation_status',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('legal_clarification_operating_model');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'legal.approve',
            'billing.release',
            'grid-operations.executeControl',
          ])
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

      it('is backwards compatible: existing callers without lifecycle params keep all current fields and decisionReadiness', async () => {
        const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-legacy',
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
        // additive field present without changing existing response shape/semantics
        expect(result.lifecycleEvidence).toBeDefined();
        expect(result.lifecycleEvidence.capabilityKey).toBe('fnav_fast_track_contract_gate');
      });

      it('reports complete FCA/fNAV lifecycle evidence when every stage is supplied', async () => {
        const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-lifecycle-complete',
          gridOperatorId: 'SNB935578300972',
          requestType: 'storage',
          assetOrLoadType: 'battery',
          firmCapacityKW: 500,
          flexibleCapacityKW: 1500,
          connectionRequestRef: 'creq-2201',
          gridConnectionPoint: 'napp-08.4',
          capacityOfferRef: 'coffer-77',
          capacityOfferVersion: 'v3',
          capacityOfferDate: '2026-05-01',
          restrictionProfileRef: 'restr-14',
          restrictionProfileVersion: 'v2',
          curtailmentWindow: '18:00-20:00',
          contractRef: 'contract-91',
          contractVersion: 'v4',
          contractReviewStatus: 'under_review',
          curtailmentMeasurementEvidenceRef: 'meas-3391',
          redispatchRelevanceRef: 'rd-relevance-1',
          redispatchStatusRef: 'rd-status-1',
          compensationStatusRef: 'comp-status-1',
          evidenceOwner: 'netzplanung',
          nextReviewGate: 'quarterly-review-q3',
          evidenceSourceTimestamp: '2026-07-01T09:00:00Z',
        });

        const { lifecycleEvidence } = result;
        expect(lifecycleEvidence.evidenceStatus.provided).toBe(
          lifecycleEvidence.evidenceStatus.required
        );
        expect(lifecycleEvidence.missingEvidence).toEqual([]);
        expect(lifecycleEvidence.positiveFollowUps).toEqual([]);
        for (const row of lifecycleEvidence.rows) {
          if (row.code === 'operating_event') continue;
          expect(row.evidenceStatus).toBe('provided');
        }
      });

      it('reports incomplete FCA/fNAV lifecycle evidence with review-only follow-ups when stages are partial or missing', async () => {
        const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-lifecycle-incomplete',
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
          connectionRequestRef: 'creq-2202',
          // gridConnectionPoint omitted -> connection_request partial
          capacityOfferRef: 'coffer-78',
          // capacityOfferVersion/Date/firm/flexible capacity omitted -> capacity_offer partial
          // restriction_profile, contract_lifecycle, curtailment_measurement_evidence,
          // redispatch_compensation_markers, evidence_governance fully omitted -> missing
        });

        const { lifecycleEvidence } = result;
        const rowByCode = Object.fromEntries(lifecycleEvidence.rows.map((row) => [row.code, row]));
        expect(rowByCode.connection_request.evidenceStatus).toBe('partial');
        expect(rowByCode.capacity_offer.evidenceStatus).toBe('partial');
        expect(rowByCode.restriction_profile.evidenceStatus).toBe('missing');
        expect(rowByCode.contract_lifecycle.evidenceStatus).toBe('missing');
        expect(rowByCode.curtailment_measurement_evidence.evidenceStatus).toBe('missing');
        expect(rowByCode.redispatch_compensation_markers.evidenceStatus).toBe('missing');
        expect(rowByCode.evidence_governance.evidenceStatus).toBe('missing');

        const missingCodes = lifecycleEvidence.missingEvidence.map((gap) => gap.missingDataPoint);
        expect(missingCodes).toEqual(
          expect.arrayContaining([
            'connection_request',
            'capacity_offer',
            'restriction_profile',
            'contract_lifecycle',
            'curtailment_measurement_evidence',
            'redispatch_compensation_markers',
            'evidence_governance',
          ])
        );
        expect(lifecycleEvidence.positiveFollowUps.length).toBe(
          lifecycleEvidence.missingEvidence.length
        );
        for (const followUp of lifecycleEvidence.positiveFollowUps) {
          expect(followUp.category).toBe('fca_fnav_lifecycle_evidence');
        }
        // existing gate semantics (decisionReadiness) are unaffected by lifecycle gaps
        expect(result.status).toBe('needs_control_evidence');
      });

      it('supports at most one optional operating-event snapshot per request', async () => {
        const noEvent = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-event-none',
          gridOperatorId: 'SNB935578300972',
        });
        expect(noEvent.lifecycleEvidence.operatingEvent.evidenceStatus).toBe('missing');
        // fully unsupplied optional snapshot is not a gap
        expect(
          noEvent.lifecycleEvidence.missingEvidence.some(
            (gap) => gap.missingDataPoint === 'operating_event'
          )
        ).toBe(false);

        const partialEvent = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-event-partial',
          gridOperatorId: 'SNB935578300972',
          operatingEventRef: 'evt-501',
        });
        expect(partialEvent.lifecycleEvidence.operatingEvent.evidenceStatus).toBe('partial');
        expect(
          partialEvent.lifecycleEvidence.missingEvidence.some(
            (gap) => gap.missingDataPoint === 'operating_event'
          )
        ).toBe(true);

        const fullEvent = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-event-full',
          gridOperatorId: 'SNB935578300972',
          operatingEventRef: 'evt-502',
          operatingEventType: 'curtailment_order',
          operatingEventTimestamp: '2026-06-15T12:00:00Z',
        });
        expect(fullEvent.lifecycleEvidence.operatingEvent.evidenceStatus).toBe('provided');
        expect(
          fullEvent.lifecycleEvidence.rows.filter((row) => row.code === 'operating_event').length
        ).toBe(1);
      });

      it('keeps lifecycle evidence rows scalar-safe (dossier-display-only values)', async () => {
        const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-scalar-safe',
          gridOperatorId: 'SNB935578300972',
          connectionRequestRef: 'creq-2203',
          gridConnectionPoint: 'napp-09.1',
          firmCapacityKW: 250,
          flexibleCapacityKW: 750,
          operatingEventRef: 'evt-503',
          operatingEventType: 'curtailment_order',
          operatingEventTimestamp: '2026-06-20T08:00:00Z',
        });

        expectScalarTableRows(result.lifecycleEvidence.rows);
        expect(result.lifecycleEvidence.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'connection_request',
              connectionRequestRef: 'creq-2203',
              gridConnectionPoint: 'napp-09.1',
            }),
            expect.objectContaining({
              code: 'operating_event',
              operatingEventRef: 'evt-503',
              operatingEventType: 'curtailment_order',
              operatingEventTimestamp: '2026-06-20T08:00:00Z',
            }),
          ])
        );
      });

      it('never calls contract, capacity-allocation, grid-mutation, curtailment/dispatch, Redispatch/compensation/settlement, MaKo/A96, workflow/HITL, connector or Personal-Agent actions', async () => {
        const result = await broker.call('dashboard-api.fnavFastTrackContractGateStatus', {
          gateId: 'fnav-ft-nocall',
          gridOperatorId: 'SNB935578300972',
          connectionRequestRef: 'creq-2204',
          contractRef: 'contract-92',
          redispatchRelevanceRef: 'rd-relevance-2',
          redispatchStatusRef: 'rd-status-2',
          compensationStatusRef: 'comp-status-2',
        });

        expect(result.lifecycleEvidence.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'contract.approve',
            'contract.release',
            'capacity.allocate',
            'grid-connection.mutate',
            'grid-connection.approve',
            'curtailment.dispatch',
            'device-control.execute',
            'redispatch.execute',
            'redispatch.classify',
            'compensation.calculate',
            'settlement.prepareBilling',
            'mako.dispatch',
            'a96.dispatch',
            'workflow.create',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
        expect(result._errors).toEqual([]);
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided impact-map evidence: 10/10'
        );
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided liquidity governance evidence: 11/11'
        );
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
        expect(result.positiveFollowUps[0].category).toBe('areal_network_integration_offer_gate');
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
        const result = await broker.call(
          'dashboard-api.transformationFinancingScenarioViewStatus',
          {
            scenarioId: 'tf-206',
            gridOperatorId: 'vnb-mauer',
            planningHorizon: '2026-2030',
            scenarioType: 'gas-heat-transition',
            cashflowSource: 'cashflow:base-42',
          }
        );

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
        expect(result.positiveFollowUps[0].category).toBe('transformation_financing_scenario_view');
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
        const result = await broker.call(
          'dashboard-api.transformationFinancingScenarioViewStatus',
          {
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
          }
        );

        expect(result.status).toBe('ready_for_decision');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.evidenceGroups.regulatoryFinance.authoritativeLegalInterpretation).toBe(
          false
        );
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Transformation Financing Status: ready_for_decision'
        );
        expect(result.dossierEvidence.sourceDatapoints).toEqual(
          expect.arrayContaining(['cashflow:base-42', 'rollback:cost-model-42', 'eog:scenario-42'])
        );
      });
    });

    // -- investmentBudgetCapExceptionGovernanceStatus ------------------------

    describe('investmentBudgetCapExceptionGovernanceStatus', () => {
      it('reports missing budget-cap exception evidence without executing mutations', async () => {
        const result = await broker.call(
          'dashboard-api.investmentBudgetCapExceptionGovernanceStatus',
          {
            measureId: 'measure-361',
            budgetCapEur: '1000000',
            requiredBudgetEur: '1250000',
            owner: 'assetmanagement',
          }
        );

        expect(result.status).toBe('needs_exception_evidence');
        expect(result.safety).toBe('read_only');
        expect(result.capabilityKey).toBe('investment_budget_cap_exception_governance');
        expect(result.budgetDeltaEur).toBe(250000);
        expect(result.governanceContext.budgetApproved).toBe(false);
        expect(result.governanceContext.committeeDecisionCreated).toBe(false);
        expect(result.governanceContext.erpWritten).toBe(false);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'no_regret_missing',
            'technical_justification_missing',
            'kpi_reference_missing',
            'asset_context_missing',
            'data_quality_missing',
            'evidence_refs_missing',
            'risk_if_deferred_missing',
            'owner_deadline_missing',
            'exception_justification_missing',
            'source_datapoints_missing',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe(
          'investment_budget_cap_exception_governance'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'investment.approve',
            'budget.release',
            'committee.createDecision',
            'sap.psp.write',
            'erp.write',
            'finance.createBooking',
            'hitl.create',
            'workflow.create',
            'communication.send',
            'settlement.exportA96',
            'tariff.mutate',
            'mako.dispatch',
            'device-control.execute',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
      });

      it('returns exception_evidence_ready for complete caller-supplied evidence', async () => {
        const result = await broker.call(
          'dashboard-api.investmentBudgetCapExceptionGovernanceStatus',
          {
            measureId: 'measure-ready-361',
            measureName: 'UW Nord Entlastung',
            scope: 'mittelspannung',
            budgetCapEur: 1000000,
            requiredBudgetEur: 1425000,
            noRegretCriterion: 'supply-security',
            technicalJustification: 'load-growth',
            regulatoryContext: 'netzpflicht',
            kpiReference: 'saidi-risk',
            division: 'strom',
            assetRef: 'asset-361',
            dataQuality: 'reviewed',
            evidenceRefs: 'psp:4711,kpi:saidi',
            riskIfDeferred: 'redispatch-cost-increase',
            owner: 'investment-board',
            deadline: '2026-09-30',
            nextDecisionGate: 'board-q3',
            exceptionJustification: 'draft-ready',
            sourceDatapoints: 'psp:4711,kpi:saidi',
          }
        );

        expect(result.status).toBe('exception_evidence_ready');
        expect(result.readinessScore).toBe(1);
        expect(result.budgetDeltaEur).toBe(425000);
        expect(result.exceptionJustificationStatus).toBe('evidence_ready');
        expect(result.missingEvidence).toEqual([]);
        expect(result.decisionBoundary.budgetApproved).toBe(false);
        expect(result.decisionBoundary.committeeDecisionCreated).toBe(false);
        expect(result.governanceContext.externalConnectorCalled).toBe(false);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Budget Cap Exception Status: exception_evidence_ready'
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
        expect(result.positiveFollowUps[0].category).toBe('investment_owner_deadline_budget_gate');
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

    // -- energySidecarRouteRegistryStatus ----------------------------------

    describe('energySidecarRouteRegistryStatus', () => {
      it('returns grounded read-only route rows without executing recommended endpoints', async () => {
        const result = await broker.call('dashboard-api.energySidecarRouteRegistryStatus', {
          intent: 'redispatch readiness route audit',
          domain: 'redispatch',
          requiredInput: 'processId',
          includeFallbacks: true,
        });

        expect(result.status).toBe('route_registry_ready');
        expect(result.safety).toBe('read_only');
        expect(result.capabilityKey).toBe('energy_sidecar_route_registry');
        expect(result.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              routeKey: 'redispatch_readiness_evidence',
              preferredAction: 'redispatch-readiness-gate.getStatus',
              preferredEndpoint: '/api/redispatch-readiness-gate/status',
              evidenceStatus: 'route_grounded',
              safety: 'read_only',
            }),
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'recommendedEndpoint.execute',
            'external.connector.call',
            'hitl.create',
            'workflow.execute',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
        expect(result.decisionBoundary.recommendedEndpointExecuted).toBe(false);
        expect(result.decisionBoundary.productionMutation).toBe(false);
      });

      it('surfaces missing-route context as positive follow-ups and scalar dossier rows', async () => {
        const result = await broker.call('dashboard-api.energySidecarRouteRegistryStatus', {
          intent: 'unknown hydrogen billing switch action',
          domain: 'unsupported-domain',
        });

        expect(result.status).toBe('needs_route_context');
        expect(result.rows[0]).toEqual(
          expect.objectContaining({
            routeKey: 'unsupported_domain_fallback',
            evidenceStatus: 'unsupported_or_ambiguous_route',
            preferredAction: 'interface-placeholder.requestEvidence',
          })
        );
        expect(result.positiveFollowUps[0].category).toBe('energy_sidecar_route_registry');
        expect(result.dossierEvidence.rows[0]).not.toHaveProperty('operationEvidence');
        expect(result.dossierEvidence.rows[0].noCallGuards).toEqual(
          expect.arrayContaining(['recommendedEndpoint.execute'])
        );
      });
    });

    // -- interconnectionReleaseFileStatus ----------------------------------

    describe('interconnectionReleaseFileStatus', () => {
      it('returns read-only release-file rows with no-call guards', async () => {
        const result = await broker.call('dashboard-api.interconnectionReleaseFileStatus', {
          caseId: 'case-419',
          koppelpunktId: 'KP-419',
          marketPartnerId: 'MP-419',
          timeseriesId: 'TS-419',
          mappingVersion: 'v2',
          sourceSystem: 'a2mdm-export',
          evidenceStatus: 'complete',
          approvalStatus: 'approved',
          owner: 'marktkommunikation',
          nextChangeGate: '2026-Q3',
          affectedProcess: 'mako,billing',
          includeFallbacks: true,
        });

        expect(result.status).toBe('release_file_ready');
        expect(result.safety).toBe('read_only');
        expect(result.capabilityKey).toBe('interconnection_release_file');
        expect(result.syntheticDemo).toBe(false);
        expect(result.subject).toEqual(
          expect.objectContaining({
            caseId: 'case-419',
            koppelpunktId: 'KP-419',
            marketPartnerId: 'MP-419',
            timeseriesId: 'TS-419',
            mappingVersion: 'v2',
          })
        );
        expect(result.mappingRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ key: 'koppelpunkt', value: 'KP-419' }),
            expect.objectContaining({ key: 'market_partner', value: 'MP-419' }),
            expect.objectContaining({ key: 'timeseries', value: 'TS-419' }),
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'mapping.write',
            'mapping.releaseExecute',
            'mako.submit',
            'billing.release',
            'settlement.prepareBilling',
            'tariff.mutate',
            'hitl.create',
            'workflow.execute',
            'device-control.execute',
            'external.connector.call',
            'budibase.table.write',
            'personal-agent.execute',
          ])
        );
        expect(result.decisionBoundary.mappingWritten).toBe(false);
        expect(result.decisionBoundary.downstreamProcessExecuted).toBe(false);
        expect(result.decisionBoundary.productionMutation).toBe(false);
        expect(result.dossierEvidence.evidenceRows[0]).toEqual(
          expect.objectContaining({
            sourceSystem: 'a2mdm-export',
            mappingVersion: 'v2',
            evidenceStatus: 'source_versioned',
          })
        );
      });

      it('labels synthetic demo evidence and turns missing release data into positive follow-ups', async () => {
        const result = await broker.call('dashboard-api.interconnectionReleaseFileStatus', {});

        expect(result.status).toBe('needs_release_evidence');
        expect(result.syntheticDemo).toBe(true);
        expect(result.summaryRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: 'evidence_basis',
              value: 'synthetic_demo_read_model',
            }),
          ])
        );
        expect(result.missingEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ missingDataPoint: 'koppelpunkt_id' }),
            expect.objectContaining({ missingDataPoint: 'mapping_version' }),
            expect.objectContaining({ missingDataPoint: 'approval_owner' }),
          ])
        );
        expect(result.positiveFollowUps[0]).toEqual(
          expect.objectContaining({
            category: 'interconnection_release_file',
            enablesDossierAddition: expect.stringContaining('Koppelpunkt identifier'),
          })
        );
        expect(result.dossierEvidence.summaryRows).toBeDefined();
        expect(result.dossierEvidence).not.toHaveProperty('cache');
      });
    });

    // -- directMarketerRiskGateStatus ---------------------------------------

    describe('directMarketerRiskGateStatus', () => {
      it('reports forecast and allocation gaps without market side effects', async () => {
        const result = await broker.call('dashboard-api.directMarketerRiskGateStatus', {
          caseId: 'case-411',
          directMarketer: 'dm-partner',
          roleOwner: 'Energy Services',
        });

        expect(result.status).toBe('needs_forecast_and_allocation_evidence');
        expect(result.safety).toBe('read_only');
        expect(result.handoverContext.caseId).toBe('case-411');
        expect(result.marketEvidence.forecastQuality).toBeNull();
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'forecast_quality',
            'allocation_rules',
            'balancing_schedule_impact',
            'billing_settlement_status',
            'deadline',
            'evidence_status',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('direct_marketer_risk_gate');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'market.executeTrade',
            'schedule.submit',
            'balancing-group.transfer',
            'direct-marketer.offer.approve',
            'contract.approve',
            'billing.release',
            'settlement.prepareBilling',
            'customer-communication.send',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
        expect(result.decisionBoundary.productionMutation).toBe(false);
      });

      it('returns ready_for_direct_marketer_review for complete handover evidence', async () => {
        const result = await broker.call('dashboard-api.directMarketerRiskGateStatus', {
          caseId: 'case-ready-411',
          projectId: 'energy-sharing-411',
          communityModel: 'gemeinschaftsstrom',
          directMarketer: 'dm-partner',
          forecastQuality: 'validated',
          forecastDeviationPct: '4.2',
          allocationRules: 'documented',
          balancingGroupImpact: 'bounded',
          scheduleImpact: 'no-daily-submission-change',
          billingStatus: 'ready',
          settlementStatus: 'ready',
          roleOwner: 'Energy Services',
          deadline: '2026-09-30',
          evidenceStatus: 'complete',
          sourceEvidence: 'forecast:v1,allocation:v2',
        });

        expect(result.status).toBe('ready_for_direct_marketer_review');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.marketEvidence.forecastDeviationPct).toBe(4.2);
        expect(result.marketEvidence.sourceEvidence).toEqual(
          expect.arrayContaining(['forecast:v1', 'allocation:v2'])
        );
        expect(result.decisionBoundary.scheduleSubmitted).toBe(false);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Direct Marketer Risk Gate Status: ready_for_direct_marketer_review'
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
        expect(result.positiveFollowUps[0].category).toBe('no_regret_measure_definition_gate');
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
        expect(result.positiveFollowUps[0].category).toBe('gas_grid_transformation_asset_cockpit');
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

    describe('netzsignalDeltaGatingStatus', () => {
      it('classifies freshness-only signals as non-escalation evidence', async () => {
        const result = await broker.call('dashboard-api.netzsignalDeltaGatingStatus', {
          signalId: 'signal-345-freshness',
          domain: 'netzanschluss',
          signalType: 'weekly-board-update',
          knownContextRef: 'board-context-2026-26',
          freshnessProof: 'snapshot-2026-06-29T21:00Z',
        });

        expect(result.capabilityKey).toBe('netzsignal_delta_gating');
        expect(result.classification).toBe('freshness_only');
        expect(result.nonEscalationRationale).toContain('Do not escalate');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining(['decision_topic', 'owner', 'materiality', 'new_fact'])
        );
        expect(result.positiveFollowUps[0].category).toBe('netzsignal_delta_gating');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'outlook.connector.read',
            'teams.connector.read',
            'monitoring.connector.read',
            'hitl.create',
            'budibase.table.write',
            'personal-agent.execute',
          ])
        );
        expect(result.sourceBoundary).toMatchObject({
          suppliedInputOnly: true,
          connectorRead: false,
          createsExternalAction: false,
        });
      });

      it('classifies decision deltas and new blockers from supplied metadata', async () => {
        const decisionDelta = await broker.call('dashboard-api.netzsignalDeltaGatingStatus', {
          signalId: 'signal-345-delta',
          domain: 'flexibilitaet',
          signalType: 'management-signal',
          knownContextRef: 'flex-baseline-q2',
          freshnessProof: 'teams-note-hash-123',
          decisionTopic: 'Kapazitaetsfenster priorisieren',
          owner: 'Netzplanung',
          dueDate: '2026-07-03',
          materiality: 'hoch',
          newFact: 'neue Netzlastannahme',
          nextEvidencePoint: 'NAP und Lastgang bestaetigen',
        });
        expect(decisionDelta.classification).toBe('decision_delta');
        expect(decisionDelta.escalationRecommendation).toContain('management review');
        expect(decisionDelta.materiality).toBe('high');

        const blocker = await broker.call('dashboard-api.netzsignalDeltaGatingStatus', {
          signalId: 'signal-345-blocker',
          domain: 'assetmanagement',
          signalType: 'monitoring-anchor',
          knownContextRef: 'asset-plan-q2',
          freshnessProof: 'monitoring-snapshot-456',
          decisionTopic: 'Trafo-Verstaerkung freigeben',
          owner: 'Assetmanagement',
          dueDate: '2026-07-01',
          materiality: 'hoch',
          newFact: 'Kostenrahmen geaendert',
          blockedDecision: 'Investitionsfreigabe blockiert',
          nextEvidencePoint: 'Wirtschaftlichkeitsnotiz pruefen',
        });
        expect(blocker.classification).toBe('new_blocker');
        expect(blocker.escalationRecommendation).toContain('management escalation dossier');
        expect(blocker.missingEvidence).toEqual([]);
      });
    });

    describe('vnbDeltaSignalClassifierStatus', () => {
      it('classifies a supplied VNB signal without connector reads or side effects', async () => {
        const result = await broker.call('dashboard-api.vnbDeltaSignalClassifierStatus', {
          signalId: 'delta-336',
          sourceType: 'mail_excerpt',
          receivedAt: '2026-06-27T12:00:00Z',
          subject: 'Anschluss Kapazitaet Frist fuer Gewerbegebiet',
          bodyExcerpt: 'Neue Kapazitaetsannahme blockiert Entscheidung bis 2026-07-01.',
          knownContextAnchors: ['Gewerbegebiet Anschluss'],
          processHint: 'grid_connection_capacity',
          ownerHint: 'Netzplanung',
          dueDateHint: '2026-07-01',
          blockedDecisionHint: 'Kapazitaetsfreigabe',
          nextEvidenceHint: 'NAP und freie Kapazitaet bestaetigen',
        });

        expect(result.capabilityKey).toBe('vnb_delta_signal_classifier');
        expect(result.safety).toBe('read_only_advisory_classification');
        expect(result.status).toBe('decision_queue_attention');
        expect(result.classifications[0]).toMatchObject({
          signalId: 'delta-336',
          decisionRelevance: 'high',
          affectedProcess: 'grid_connection_capacity',
          ownerSuggestion: 'Netzplanung',
          blockedDecision: 'Kapazitaetsfreigabe',
          nextEvidencePoint: 'NAP und freie Kapazitaet bestaetigen',
          contentPolicy: 'caller_supplied_sanitized_excerpt_only_no_private_content_persistence',
        });
        expect(result.sourceBoundary).toMatchObject({
          suppliedInputOnly: true,
          connectorRead: false,
          persistsRawPrivateContent: false,
          createsExternalAction: false,
        });
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'mail.connector.ingest',
            'outlook.connector.read',
            'teams.connector.read',
            'calendar.connector.read',
            'task.connector.read',
            'ticket.create',
            'notification.dispatchInternal',
            'hitl.create',
            'workflow.execute',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
      });

      it('surfaces missing evidence as positive follow-ups for a sparse signal', async () => {
        const result = await broker.call('dashboard-api.vnbDeltaSignalClassifierStatus', {
          subject: 'Messstellen Eskalation',
          bodyExcerpt: 'MSB Abstimmung offen.',
        });

        expect(result.status).toBe('classification_with_evidence_gaps');
        expect(result.classifications[0]).toMatchObject({
          affectedProcess: 'metering',
          noveltyLevel: 'unknown_baseline',
        });
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'source_type',
            'received_at',
            'known_context_anchors',
            'owner_hint',
            'due_date',
            'blocked_decision',
            'next_evidence_point',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('vnb_delta_signal_classifier');
      });
    });

    describe('evidenceFreshnessGuardStatus', () => {
      it('classifies stale known context as a non-escalating anchor', async () => {
        const result = await broker.call('dashboard-api.evidenceFreshnessGuardStatus', {
          signalId: 'freshness-340-stale',
          sourceKind: 'mail_excerpt',
          sourceTimestamp: '2026-06-01T08:00:00Z',
          receivedTimestamp: '2026-06-28T08:00:00Z',
          lastSeenTimestamp: '2026-06-01T08:00:00Z',
          knownSnapshotHash: 'snapshot-a',
          currentSnapshotHash: 'snapshot-a',
          processArea: 'grid_connection_capacity',
          owner: 'Netzplanung',
          dueDate: '2026-07-10',
          blockedDecision: 'Kapazitaetsfreigabe',
        });

        expect(result.capabilityKey).toBe('evidence_freshness_guard');
        expect(result.safety).toBe('read_only_metadata_classification');
        expect(result.freshnessState).toBe('stale_context');
        expect(result.deltaState).toBe('known_anchor_repeat');
        expect(result.isKnownAnchor).toBe(true);
        expect(result.isNewDelta).toBe(false);
        expect(result.escalationRecommended).toBe(false);
        expect(result.nonEscalationReason).toContain('same snapshot');
        expect(result.dossierEvidence.dossierFacts).toContain('Known Anchor: true');
      });

      it('classifies a fresh changed snapshot as a dossier-safe escalation candidate', async () => {
        const result = await broker.call('dashboard-api.evidenceFreshnessGuardStatus', {
          signalId: 'freshness-340-delta',
          sourceKind: 'monitoring_report',
          sourceTimestamp: '2026-06-28T07:45:00Z',
          receivedTimestamp: '2026-06-28T08:00:00Z',
          lastSeenTimestamp: '2026-06-27T08:00:00Z',
          knownSnapshotHash: 'capacity-old',
          currentSnapshotHash: 'capacity-new',
          processArea: 'grid_connection_capacity',
          owner: 'Netzplanung',
          dueDate: '2026-06-29',
          severityHint: 'high',
          blockedDecision: 'Kapazitaetsfreigabe Gewerbegebiet',
        });

        expect(result.status).toBe('fresh_delta_escalation_candidate');
        expect(result.freshnessState).toBe('fresh_signal');
        expect(result.deltaState).toBe('new_delta');
        expect(result.isNewDelta).toBe(true);
        expect(result.escalationRecommended).toBe(true);
        expect(result.evidenceGaps).toEqual([]);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'mail.connector.ingest',
            'teams.connector.read',
            'monitoring.connector.read',
            'acf.card.create',
            'hitl.create',
            'workflow.execute',
            'personal-agent.execute',
          ])
        );
      });

      it('surfaces missing metadata as evidence gaps and positive follow-ups', async () => {
        const result = await broker.call('dashboard-api.evidenceFreshnessGuardStatus', {
          currentSnapshotHash: 'only-current',
        });

        expect(result.status).toBe('freshness_classification_with_gaps');
        expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'source_kind',
            'source_timestamp',
            'last_seen_timestamp',
            'owner',
            'due_date',
            'blocked_decision',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('evidence_freshness_guard');
      });
    });

    describe('vnbSpecialTopicWorkstateStatus', () => {
      it('returns current work-state evidence when leading source and owner are present', async () => {
        const result = await broker.call('dashboard-api.vnbSpecialTopicWorkstateStatus', {
          topicId: 'sonder-flex-1',
          topicName: 'Flexibilitaetsfahrplan',
          domain: 'flexibility',
          leadingSource: 'SharePoint',
          leadingSourceTimestamp: '2026-07-02T12:00:00.000Z',
          leadingSourceVersion: 'v1',
          owner: 'netzstrategie',
          allowedSideSources: 'Teams,Outlook',
          sideSourceFreshness: 'Teams@2026-07-01T12:00:00.000Z',
        });

        expect(result.capabilityKey).toBe('vnb_special_topic_workstate');
        expect(result.safety).toBe('read_only');
        expect(result.status).toBe('current');
        expect(result.topic.domain).toBe('flexibility');
        expect(result.decisionReadiness.canUseAsLeadingWorkstate).toBe(true);
        expect(result.allowedSideSources).toHaveLength(2);
        expect(result.missingEvidence).toEqual([]);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'sharepoint.connector.read',
            'teams.connector.read',
            'outlook.connector.read',
            'task.create',
            'workflow.execute',
            'hitl.create',
            'budibase.apply',
            'object-store.write',
            'rag.ingest',
            'cernion.table.write',
            'personal-agent.execute',
          ])
        );
      });

      it('marks stale and insufficient work states with positive follow-ups', async () => {
        const stale = await broker.call('dashboard-api.vnbSpecialTopicWorkstateStatus', {
          topicName: 'Gasnetzstrategie',
          domain: 'gas',
          leadingSource: 'Teams',
          leadingSourceTimestamp: '2026-01-01T00:00:00.000Z',
          leadingSourceVersion: 'v0',
          owner: 'asset-management',
          freshnessThresholdDays: 30,
        });

        expect(stale.status).toBe('stale');
        expect(stale.staleMarkers.map((marker) => marker.marker)).toContain('leading_source_stale');
        expect(stale.positiveFollowUps.map((gap) => gap.missingDataPoint)).toContain(
          'stale_leading_source_refresh'
        );

        const insufficient = await broker.call('dashboard-api.vnbSpecialTopicWorkstateStatus', {
          topicName: 'Anschluss-Sonderthema',
          domain: 'anschluss',
        });

        expect(insufficient.status).toBe('insufficient_evidence');
        expect(insufficient.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'missing_leading_source',
            'missing_leading_source_timestamp',
            'missing_leading_source_version',
            'missing_owner',
            'missing_side_source_policy',
          ])
        );
      });
    });

    describe('monitoringNonEscalationStatus', () => {
      it('returns complete non-escalation evidence without executing side effects', async () => {
        const result = await broker.call('dashboard-api.monitoringNonEscalationStatus', {
          signalId: 'signal-368',
          domain: 'grossanschluss',
          assetContext: 'asset-cluster-west',
          sourceName: 'cross-domain-monitor',
          sourceCheckedAt: '2026-07-02T20:00:00.000Z',
          novelty: 'unchanged',
          blockingFinding: 'none',
          nextCheckAt: '2026-07-15T10:00:00.000Z',
          owner: 'netzfuehrung',
          rationale: 'Keine neue Blockerquelle seit letztem Prueflauf.',
        });

        expect(result.capabilityKey).toBe('non_escalation_control_evidence');
        expect(result.safety).toBe('read_only');
        expect(result.status).toBe('non_escalation_evidence_complete');
        expect(result.signal.signalId).toBe('signal-368');
        expect(result.absentBlocker.blockerAbsent).toBe(true);
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Absent Blocker: true');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'monitoring.scheduler.run',
            'alerting.escalate',
            'hitl.create',
            'mail.send',
            'workflow.execute',
            'external.connector.call',
            'budibase.apply',
            'settlement.exportA96',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
      });

      it('surfaces missing non-escalation evidence as positive follow-ups', async () => {
        const result = await broker.call('dashboard-api.monitoringNonEscalationStatus', {
          signalId: 'signal-368-gap',
          sourceName: 'cross-domain-monitor',
          sourceCheckedAt: '2026-07-02T20:00:00.000Z',
        });

        expect(result.status).toBe('needs_absent_blocker_evidence');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'novelty',
            'blocking_finding',
            'next_check_at',
            'owner',
            'rationale',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('non_escalation_control_evidence');
        expect(result.validationFindings.map((finding) => finding.code)).toContain(
          'NEC_BLOCKING_FINDING_MISSING'
        );
      });
    });

    describe('costReviewCommitteeStatus', () => {
      it('returns committee-ready cost review evidence without executing finance side effects', async () => {
        const result = await broker.call('dashboard-api.costReviewCommitteeStatus', {
          reviewId: 'cost-review-367',
          owner: 'controlling',
          reviewStatus: 'fachlich-geprueft',
          dataOrigin: 'psp-export:2026-07',
          assetRelevance: 'netzanschluss-portfolio',
          revenueRelevance: 'erlösobergrenze plausibilisiert',
          decisionReadiness: 'ready-for-committee',
          escalationThreshold: 'abweichung-groesser-10p',
          nextCommitteeGate: 'invest-board-2026-07-15',
          evidenceRefs: 'cost:367,asset:367',
          rationale: 'Kostenblock ist fachlich nachvollziehbar.',
        });

        expect(result.capabilityKey).toBe('cost_review_committee_status');
        expect(result.safety).toBe('read_only');
        expect(result.status).toBe('committee_ready');
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Provided Cost Evidence: 8/8');
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Next Committee Gate: invest-board-2026-07-15'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'erp.write',
            'sap.psp.write',
            'accounting.post',
            'budget.approve',
            'committee.decision.execute',
            'hitl.create',
            'workflow.execute',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
      });

      it('surfaces missing cost-review evidence as positive dossier follow-ups', async () => {
        const result = await broker.call('dashboard-api.costReviewCommitteeStatus', {
          reviewId: 'cost-review-gap',
          reviewStatus: 'started',
        });

        expect(result.status).toBe('needs_owner');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'owner',
            'data_origin',
            'asset_relevance',
            'revenue_relevance',
            'decision_readiness',
            'escalation_threshold',
            'next_committee_gate',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('cost_review_committee_status');
        expect(result.validationFindings.map((finding) => finding.code)).toContain(
          'CRCS_OWNER_MISSING'
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
      const NO_CALL_GUARDS = [
        'energy-sharing-allocation.allocate', // allocation
        'billing.release', // billing
        'settlement.exportA96', // settlement
        'mako.dispatch', // MaKo
        'energy-sharing.contract.sign', // contract signing
        'energy-sharing.onboarding.start', // onboarding
        'workflow.execute', // workflow
        'external.connector.call', // connector
      ];

      const FULL_EVIDENCE_PARAMS = {
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
        generationMaloCount: '30',
        consumptionMaloCount: '12',
        maloInventoryEvidenceRef: 'malo-inventory-v1',
        supplierOrDirectMarketerEvidenceRef: 'supplier-evidence-v1',
        meteringConceptEvidenceRef: 'metering-concept-v1',
        imsysStatus: 'ready',
        fifteenMinuteValuesReadiness: 'ready',
        dataBasisFreshnessRef: 'data-basis-freshness-v1',
        residualSupplyContractEvidenceRef: 'residual-supply-v1',
        participationStartDate: '2026-08-01',
        participationEndDate: '2027-08-01',
        eligibilityEvidenceRef: 'eligibility-v1',
        exceptionRateEvidenceRef: 'exception-rate-v1',
        economicsThresholdRef: 'economics-threshold-v1',
        owner: 'energy-sharing-owner',
        escalationContact: 'billing-lead',
        sourceArtifacts: ['vdmi:es-230', 'settlement:a96-230'],
      };

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
            'malo_inventory_evidence',
            'supplier_direct_marketer_evidence',
            'metering_concept_data_quality_evidence',
            'residual_supply_contract_evidence',
            'participation_eligibility_evidence',
            'exception_rate_economics_threshold_evidence',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('energy_sharing_simulation_gate');
        expect(result.sourceActions.notCalled).toEqual(expect.arrayContaining(NO_CALL_GUARDS));
        expect(result.safety).toBe('read_only');
      });

      it('returns billing_near_ready only when all evidence, including the new evidence categories, is supplied', async () => {
        const result = await broker.call(
          'dashboard-api.energySharingSimulationGateStatus',
          FULL_EVIDENCE_PARAMS
        );

        expect(result.gateStatus).toBe('billing_near_ready');
        expect(result.simulationStage).toBe('billing_near_ready');
        expect(result.missingEvidence).toEqual([]);
        expect(result.readinessBlocks.settlementReadiness.status).toBe('ready');
        expect(result.readinessBlocks.maloInventoryReadiness.status).toBe('ready');
        expect(result.readinessBlocks.supplierDirectMarketerReadiness.status).toBe('ready');
        expect(result.readinessBlocks.meteringConceptDataQualityReadiness.status).toBe('ready');
        expect(result.readinessBlocks.residualSupplyReadiness.status).toBe('ready');
        expect(result.readinessBlocks.participationEligibilityReadiness.status).toBe('ready');
        expect(result.readinessBlocks.exceptionRateEconomicsThresholdReadiness.status).toBe(
          'ready'
        );
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided Energy-Sharing gate evidence: 15/15'
        );
        expect(result.sourceActions.notCalled).toEqual(expect.arrayContaining(NO_CALL_GUARDS));
      });

      it('classifies each new evidence category as missing when omitted individually', async () => {
        const base = {
          ...FULL_EVIDENCE_PARAMS,
        };

        const casesById = {
          malo_inventory_evidence: 'maloInventoryEvidenceRef',
          supplier_direct_marketer_evidence: 'supplierOrDirectMarketerEvidenceRef',
          metering_concept_data_quality_evidence: 'meteringConceptEvidenceRef',
          residual_supply_contract_evidence: 'residualSupplyContractEvidenceRef',
          participation_eligibility_evidence: 'eligibilityEvidenceRef',
          exception_rate_economics_threshold_evidence: 'economicsThresholdRef',
        };

        for (const [missingDataPoint, omittedParam] of Object.entries(casesById)) {
          const params = { ...base };
          delete params[omittedParam];

          const result = await broker.call(
            'dashboard-api.energySharingSimulationGateStatus',
            params
          );

          expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
            missingDataPoint
          );
          expect(result.gateStatus).not.toBe('billing_near_ready');
        }
      });

      it('stays backwards compatible for callers that only supply the original evidence fields', async () => {
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

        // Original response fields remain present and correctly shaped.
        expect(result.safety).toBe('read_only');
        expect(result.capabilityKey).toBe('energy_sharing_simulation_gate');
        expect([
          'learning_pilot',
          'simulation_ready',
          'billing_near_ready',
          'blocked_before_operational_rollout',
        ]).toContain(result.simulationStage);
        expect(result.readinessBlocks.settlementReadiness.status).toBe('ready');
        expect(result.readinessBlocks.participantReadiness.status).toBe('ready');
        expect(Array.isArray(result.evidenceItems)).toBe(true);
        expect(Array.isArray(result.missingEvidence)).toBe(true);
        expect(Array.isArray(result.positiveFollowUps)).toBe(true);

        // The new evidence categories are surfaced as open gaps rather than
        // breaking or being silently ignored for a caller that never supplied them.
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'malo_inventory_evidence',
            'supplier_direct_marketer_evidence',
            'metering_concept_data_quality_evidence',
            'residual_supply_contract_evidence',
            'participation_eligibility_evidence',
            'exception_rate_economics_threshold_evidence',
          ])
        );
        expect(result.gateStatus).not.toBe('billing_near_ready');
      });

      it('never calls allocation, billing, settlement, MaKo, contract signing, onboarding, workflow or connector actions', async () => {
        const result = await broker.call(
          'dashboard-api.energySharingSimulationGateStatus',
          FULL_EVIDENCE_PARAMS
        );

        expect(result.sourceActions.notCalled).toEqual(expect.arrayContaining(NO_CALL_GUARDS));
      });
    });

    // -- energySharing42cCutoverReadinessStatus -----------------------------

    describe('energySharing42cCutoverReadinessStatus', () => {
      it('blocks §42c cutover readiness when high-risk sub-track evidence is missing', async () => {
        const result = await broker.call('dashboard-api.energySharing42cCutoverReadinessStatus', {
          cutoverId: 'es42c-2026',
          pilotTenantId: 'tenant-hoeheinoed',
          balanceGroupId: 'bk_hoeheinoed_es_001',
          a96DefaultsStatus: 'ready',
          specFreezeStatus: 'ready',
          runbookStatus: 'ready',
          owner: 'regulatory-owner',
          targetDate: '2026-07-01',
        });

        expect(result.status).toBe('blocked');
        expect(result.riskLevel).toBe('high');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'pilot_tenant_balance_group',
            'settlement_readiness_hardening',
            'allocation_load_test',
            'compliance_signoff_evidence',
            'rollback_dr_readiness',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('energy_sharing_42c_cutover_readiness');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tenant.migrate',
            'settlement.exportA96',
            'energy-sharing-allocation.allocate',
            'billing.release',
            'mako.dispatch',
            'hitl.create',
            'rollback.execute',
            'backup.restore',
            'external.connector.call',
            'secret.read',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready only when all §42c sub-track evidence is present', async () => {
        const result = await broker.call('dashboard-api.energySharing42cCutoverReadinessStatus', {
          cutoverId: 'es42c-2026',
          pilotTenantId: 'tenant-hoeheinoed',
          balanceGroupId: 'bk_hoeheinoed_es_001',
          a96DefaultsStatus: 'ready',
          specFreezeStatus: 'ready',
          pilotTenantStatus: 'ready',
          settlementHardeningStatus: 'ready',
          allocationLoadTestStatus: 'ready',
          runbookStatus: 'ready',
          complianceSignoffStatus: 'ready',
          rollbackPlanStatus: 'ready',
          owner: 'regulatory-owner',
          targetDate: '2026-07-01',
          evidenceRefs: ['docs:energy-sharing-abnahme', 'drill:rollback-2026'],
        });

        expect(result.status).toBe('ready');
        expect(result.riskLevel).toBe('low');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.subTracks).toHaveLength(7);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided §42c sub-track evidence: 7/7'
        );
        expect(result.sourceActions.notCalled).toContain('settlement.exportA96');
      });
    });

    // -- evuApiMigrationDiagnosticsStatus -----------------------------------

    describe('evuApiMigrationDiagnosticsStatus', () => {
      it('returns stable missing evidence and follow-ups for incomplete migration diagnostics', async () => {
        const result = await broker.call('dashboard-api.evuApiMigrationDiagnosticsStatus', {
          businessProcess: 'Lieferantenwechsel',
          endpoint: '/api/v2/malo/patch',
          method: 'PATCH',
          responseCode: '422',
          validationError: 'maloId missing in data context',
        });

        expect(result.status).toBe('needs_migration_context');
        expect(result.safety).toBe('read_only_diagnostics');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'auth_scope',
            'data_context',
            'request_shape',
            'completion_criterion',
            'owner_next_step',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('evu_api_migration_diagnostics');
        expect(result.riskHints).toEqual(
          expect.arrayContaining([
            'auth_scope_missing',
            'data_context_missing',
            'completion_criterion_missing',
            'http_error_response_observed',
            'validation_error_observed',
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'external.connector.call',
            'oauth.authorize',
            'secret.read',
            'json-patch.apply',
            'migration.execute',
            'hitl.create',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'personal-agent.execute',
          ])
        );
      });

      it('returns complete diagnostics when all supplied evidence is present', async () => {
        const result = await broker.call('dashboard-api.evuApiMigrationDiagnosticsStatus', {
          businessProcess: 'Lieferantenwechsel',
          endpoint: '/api/v2/malo/patch',
          method: 'PATCH',
          authScope: 'mako:process.write',
          dataContext: 'tenant=stadtwerk-mauer role=VNB malo=DE01234567890',
          requestShape: 'PATCH op=replace path=/marketLocation/status',
          responseCode: '204',
          validationError: 'resolved after MaLo context supplied',
          completionCriterion: 'HTTP 204 plus process receipt in migration ticket',
          owner: 'integration-team',
          nextStep: 'replay three sampled migration tickets in QA',
          ticketRef: 'MIG-298',
          systemRef: 'evu-api-gw',
        });

        expect(result.status).toBe('diagnostics_complete');
        expect(result.evidenceCompleteness).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toEqual(
          expect.arrayContaining([
            'Business Process: Lieferantenwechsel',
            'Endpoint: PATCH /api/v2/malo/patch',
            'Owner: integration-team',
          ])
        );
        expect(result.sourceActions.notCalled).toContain('external.connector.call');
      });
    });

    // -- novaDecisionLifecycleReadinessStatus --------------------------------

    describe('novaDecisionLifecycleReadinessStatus', () => {
      it('blocks NOVA lifecycle readiness when high-risk evidence is missing', async () => {
        const result = await broker.call('dashboard-api.novaDecisionLifecycleReadinessStatus', {
          caseId: 'nova-trl7',
          decisionKind: 'asset_override',
          tenantIsolationEvidence: 'ready',
          hitlPolicyEvidence: 'ready',
          owner: 'nova-owner',
          deadline: '2026-07-15',
        });

        expect(result.status).toBe('blocked');
        expect(result.riskLevel).toBe('high');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'decision_lifecycle_model',
            'decision_source_catalogue',
            'transition_audit_history',
            'replay_testability',
            'expiry_non_execution',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('nova_decision_lifecycle_readiness');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'nova.decisions.create',
            'nova.decisions.transition',
            'hitl.create',
            'webhook.emit',
            'nova.sse.emit',
            'assets.applyOverride',
            'settlement.exportA96',
            'external.connector.call',
            'secret.read',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready for TRL-7 review only when all NOVA readiness evidence is present', async () => {
        const result = await broker.call('dashboard-api.novaDecisionLifecycleReadinessStatus', {
          caseId: 'nova-trl7',
          decisionKind: 'mastr_correction',
          lifecycleModel: 'ready',
          sourceCatalogue: 'ready',
          auditTrail: 'ready',
          tenantIsolationEvidence: 'ready',
          hitlPolicyEvidence: 'ready',
          replayEvidence: 'ready',
          expiryEvidence: 'ready',
          owner: 'nova-owner',
          deadline: '2026-07-15',
          evidenceRefs: ['docs:nova-lifecycle', 'test:tenant-sse'],
        });

        expect(result.status).toBe('ready_for_trl7_review');
        expect(result.riskLevel).toBe('low');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.readinessItems).toHaveLength(7);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided NOVA readiness evidence: 7/7'
        );
        expect(result.sourceActions.notCalled).toContain('nova.decisions.apply');
        expect(result.sourceActions.notCalled).toContain('nova.sse.emit');
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
          expect.arrayContaining([
            'settlement.exportA96',
            'mako.dispatch',
            'hitl.create',
            'personal-agent.execute',
          ])
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
        expect(result.blockedDecisions).toEqual(
          expect.arrayContaining(['Target-process handover status'])
        );
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
          expect.arrayContaining([
            'period_definition',
            'aggregation_logic',
            'validation_status',
            'responsible_owner',
            'sla',
          ])
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
          expect.arrayContaining([
            'period_division',
            'impact_context',
            'owner_role',
            'decision_readiness',
            'blocked_decision',
          ])
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided translation evidence: 10/10'
        );
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
          expect.arrayContaining([
            'baseline_reference',
            'forecast_cutoff',
            'sign_convention',
            'approval_status',
          ])
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided waterfall governance evidence: 11/11'
        );
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided gas roadmap evidence: 11/11'
        );
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided Jour-fixe closure evidence: 10/10'
        );
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
        expect(result.financingEvidence.regulatoryEffectEvidence).toBe(
          'eog:scenario-metering-2027'
        );
        expect(result.gridInvestmentVerdict.usableGridInvestmentHeadroomProven).toBe(true);
        expect(result.evidenceRefs).toEqual(['finance:evidence-1', 'eog:evidence-2']);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided off-balancing metering evidence: 13/13'
        );
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
        const result = await broker.call(
          'dashboard-api.automationRequirementsDecisionValueStatus',
          {
            requirementId: 'ardv:181',
            requestTitle: 'Redispatch KPI PowerBI',
            requestType: 'PowerBI dashboard',
            processArea: 'redispatch',
            sourceSystem: 'edm',
            movingDataFlow: 'edm-to-powerbi',
            manualEffort: '4h weekly',
          }
        );

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
        const result = await broker.call(
          'dashboard-api.automationRequirementsDecisionValueStatus',
          {
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
          }
        );

        expect(result.status).toBe('ready_for_requirements_review');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.requirementContext.requirementId).toBe('ardv:181');
        expect(result.decisionEvidence.decisionValue).toBe('weekly redispatch exception decision');
        expect(result.evidenceRefs).toEqual(['vdmi:card-181', 'edm:sample']);
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided automation requirement evidence: 15/15'
        );
        expect(result.sourceActions.notCalled).toContain('power-automate.createFlow');
      });
    });

    // ── modelViabilityEvidenceGateStatus ───────────────────────────────────

    describe('modelViabilityEvidenceGateStatus', () => {
      it('reports blocked_missing_evidence with dimension gaps and no side-effect calls', async () => {
        const result = await broker.call('dashboard-api.modelViabilityEvidenceGateStatus', {
          candidateId: 'mvg:section-42c',
          candidateName: 'Section 42c Community',
          modelType: 'section_42c_community',
          scope: 'pilot-region-west',
          processCostBand: 'medium',
          exceptionCaseRateBand: 'low',
          exceptionCaseOwner: 'Netzbetrieb',
        });

        expect(result.status).toBe('blocked_missing_evidence');
        expect(result.rows.map((row) => row.dimensionId)).toEqual([
          'candidate_identity',
          'evidence_snapshot',
          'process_cost',
          'exception_case_rate',
          'liquidity_impact',
          'data_maturity_metering',
          'data_maturity_roles',
          'data_maturity_time_series',
          'data_maturity_source_freshness',
          'governance_effort',
        ]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'evidence_snapshot',
            'liquidity_impact',
            'data_maturity_metering',
            'governance_effort',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('model_viability_evidence_gate');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tariff.mutate',
            'contract.create',
            'billing.release',
            'settlement.exportA96',
            'mako.dispatch',
            'workflow.execute',
            'hitl.create',
            'external.connector.call',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns assumption_heavy when supplied evidence is caller-flagged as assumption-only', async () => {
        const result = await broker.call('dashboard-api.modelViabilityEvidenceGateStatus', {
          candidateId: 'mvg:section-42c',
          candidateName: 'Section 42c Community',
          modelType: 'section_42c_community',
          scope: 'pilot-region-west',
          evidenceSnapshotRef: 'snapshot:mvg-181',
          processCostBand: 'medium',
          exceptionCaseRateBand: 'low',
          exceptionCaseOwner: 'Netzbetrieb',
          liquidityImpactBand: 'moderate',
          dataMaturityMetering: 'imsys-rollout-80pct',
          dataMaturityRoles: 'marktrolle-bestaetigt',
          dataMaturityTimeSeries: 'stundenwerte-vollstaendig',
          dataMaturitySourceFreshness: 'taeglich',
          governanceEffortBand: 'medium',
          governanceDecisionOwner: 'Netzplanung',
          nextReviewGate: '2026-Q4-review',
          assumptionOnlyDimensions: 'liquidity_impact,governance_effort',
        });

        expect(result.status).toBe('assumption_heavy');
        expect(result.missingEvidence).toEqual([]);
        const byId = Object.fromEntries(result.rows.map((row) => [row.dimensionId, row]));
        expect(byId.liquidity_impact.evidenceStatus).toBe('assumption_only');
        expect(byId.governance_effort.evidenceStatus).toBe('assumption_only');
        expect(byId.process_cost.evidenceStatus).toBe('provided');
        expect(result.positiveFollowUps.map((item) => item.missingDataPoint)).toEqual(
          expect.arrayContaining(['liquidity_impact', 'governance_effort'])
        );
      });

      it('returns ready_for_management_review only when every dimension is fully provided', async () => {
        const result = await broker.call('dashboard-api.modelViabilityEvidenceGateStatus', {
          candidateId: 'mvg:section-42c',
          candidateName: 'Section 42c Community',
          modelType: 'section_42c_community',
          scope: 'pilot-region-west',
          evidenceSnapshotRef: 'snapshot:mvg-181',
          processCostBand: 'medium',
          exceptionCaseRateBand: 'low',
          exceptionCaseOwner: 'Netzbetrieb',
          liquidityImpactBand: 'moderate',
          dataMaturityMetering: 'imsys-rollout-80pct',
          dataMaturityRoles: 'marktrolle-bestaetigt',
          dataMaturityTimeSeries: 'stundenwerte-vollstaendig',
          dataMaturitySourceFreshness: 'taeglich',
          governanceEffortBand: 'medium',
          governanceDecisionOwner: 'Netzplanung',
          nextReviewGate: '2026-Q4-review',
        });

        expect(result.status).toBe('ready_for_management_review');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.positiveFollowUps).toEqual([]);
        expect(result.dossierEvidence.dossierFacts).toContain('Provided dimensions: 10/10');
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided purpose-lock evidence: 13/13'
        );
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided iMSys value-chain evidence: 14/14'
        );
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided CLS compliance evidence: 15/15'
        );
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
        expect(result.positiveFollowUps[0].category).toBe('legacy_control_technology_transition');
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
        expect(result.dossierEvidence.dossierFacts).toContain(
          'Provided legacy-control evidence: 12/12'
        );
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
          expect.arrayContaining([
            'submission_release',
            'cycle_closure',
            'technical_readiness_claim',
          ])
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
          expect.arrayContaining([
            'management_decision',
            'operational_prioritisation',
            'finance_commitment',
          ])
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
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['sharepoint:inv-182', 'vdmi:182'])
        );
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

    // ── crossDomainSpecialTopicsQueueStatus ────────────────────────────────

    describe('crossDomainSpecialTopicsQueueStatus', () => {
      it('reports default special-topic management gaps without operational side effects', async () => {
        const result = await broker.call('dashboard-api.crossDomainSpecialTopicsQueueStatus', {
          caseId: 'case-347',
        });

        expect(result.capabilityKey).toBe('cross_domain_special_topics_queue');
        expect(result.safety).toBe('read_only');
        expect(result.status).toBe('needs_management_evidence');
        expect(result.queueRows.length).toBeGreaterThanOrEqual(1);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'owner_role',
            'due_date',
            'regulatory_reference',
            'data_gap',
            'asset_revenue_impact',
            'next_governance_gate',
          ])
        );
        expect(result.positiveFollowUps[0].category).toBe('cross_domain_special_topics_queue');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'mail.connector.ingest',
            'hitl.create',
            'vdmi.taskMutate',
            'external.connector.call',
            'capacity-booking.execute',
            'energy-sharing.execute',
            'billing.execute',
            'settlement.execute',
            'tariff.execute',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
      });

      it('returns ready_for_governance_gate for complete query-provided topic hints', async () => {
        const result = await broker.call('dashboard-api.crossDomainSpecialTopicsQueueStatus', {
          caseId: 'case-347-ready',
          topic: 'Energy Sharing 42c und Kapazitaetsbestellung',
          domainLane: 'vertrieb_regulierung',
          ownerRole: 'regulierung',
          dueAt: '2026-09-30',
          regulatoryReference: 'EnWG 42c',
          dataGap: 'Messkonzept und Teilnahmequote',
          assetRevenueImpact: 'Erloswirkung positiv bei gesicherter Messdatenlage',
          escalationThreshold: 'Vorstandsgate bei mehr als 2 MW',
          nextGovernanceGate: 'Jour Fixe Regulierung',
          decisionStatus: 'ready_for_gate',
          evidenceRefs: 'vdmi:347,meeting:jour-fixe-347',
        });

        expect(result.status).toBe('ready_for_governance_gate');
        expect(result.missingEvidence).toEqual([]);
        expect(result.queueRows[0]).toMatchObject({
          topicKey: 'energy-sharing-42c-und-kapazitaetsbestellung',
          domainLane: 'vertrieb_regulierung',
          ownerRole: 'regulierung',
          nextGovernanceGate: 'Jour Fixe Regulierung',
        });
        expect(result.queueRows[0].evidenceRefs).toEqual(
          expect.arrayContaining(['vdmi:347', 'meeting:jour-fixe-347'])
        );
        expect(result.dossierEvidence.dossierFacts).toEqual(
          expect.arrayContaining([
            'Queue Status: ready_for_governance_gate',
            'Energy Sharing 42c und Kapazitaetsbestellung: ready_for_governance_gate',
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
        expect(result.managementContext.stopDoingOption).toBe(
          'Manuelle Excel-Priorisierung fuer Q3 stoppen'
        );
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['vdmi:flex-178', 'znp:portfolio-q3'])
        );
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
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['datasource:rollout-172', 'vdmi:172'])
        );
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
        expect(result.lineEvidence.connectedPointAssetIds).toEqual([
          'point-asset-1',
          'point-asset-2',
        ]);
        expect(result.modelContext.owner).toBe('Assetmanagement Waerme');
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['znp:graph-174', 'datapoint:174'])
        );
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
        const result = await broker.call(
          'dashboard-api.scheduleManagementGovernanceRoadmapStatus',
          {
            meteringPointId: 'melo-153',
          }
        );

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
        const result = await broker.call(
          'dashboard-api.scheduleManagementGovernanceRoadmapStatus',
          {
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
          }
        );

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
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['GasTransformation_2045', 'H2_Readiness_Doc'])
        );
        expect(result.dossierEvidence.dossierFacts).toEqual(
          expect.arrayContaining([
            'Status: ready_for_transformation_decision',
            'Provided Gasnetztransformation dependency map evidence: 10/10',
            'Open gaps: 0',
          ])
        );
      });
    });

    // ── gasTransformationDataroomStatus ───────────────────────────────────

    describe('gasTransformationDataroomStatus', () => {
      it('reports data-room status gaps without creating persistence, RAG or lifecycle side effects', async () => {
        const result = await broker.call('dashboard-api.gasTransformationDataroomStatus', {
          roomId: 'room-365',
        });

        expect(result.status).toBe('needs_room_profile');
        expect(result.safety).toBe('read_only');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'room_identity',
            'transformation_path',
            'scenario_reference',
            'evidence_register',
            'decision_log',
            'roadmap_snapshot',
            'owner_reviewer',
            'source_refs',
          ])
        );
        expect(result.contractMetadata.persistenceImplemented).toBe(false);
        expect(result.contractMetadata.aclExportArchiveImplemented).toBe(false);
        expect(result.contractMetadata.ragIngestionImplemented).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'object-store.create',
            'object-store.update',
            'knowledge-rag.ingest',
            'tenant-knowledge.promote',
            'acl.grant',
            'archive.export',
            'review-snapshot.create',
            'eog-calculator.persistScenario',
            'gas-transformation.executeDecommissioning',
            'gremium.approve',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
      });

      it('returns ready_for_dataroom_review when first-slice status evidence is complete', async () => {
        const result = await broker.call('dashboard-api.gasTransformationDataroomStatus', {
          roomId: 'room-365',
          mandateId: 'mandate-gas-west',
          profile: 'stadtwerk-gasnetz',
          transformationPath: 'h2-review, decommissioning-review',
          scenarioReference: 'eog-demo-2026, kanu-context-2026',
          evidenceStatus: 'evidence-register-current',
          decisionStatus: 'decision-log-current',
          roadmapStatus: 'roadmap-review-open',
          reviewDate: '2026-07-02',
          owner: 'Assetmanagement Gas',
          reviewer: 'Gremium Vorbereitung',
          sourceRefs: 'Waermeplanung_2026,EOG_Demo_Run',
        });

        expect(result.status).toBe('ready_for_dataroom_review');
        expect(result.readinessScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.dataRoomProfile.roomId).toBe('room-365');
        expect(result.transformationPaths).toEqual(
          expect.arrayContaining(['h2-review', 'decommissioning-review'])
        );
        expect(result.scenarioReferences).toEqual(
          expect.arrayContaining(['eog-demo-2026', 'kanu-context-2026'])
        );
        expect(result.reviewSnapshot.reviewDate).toBe('2026-07-02');
        expect(result.dossierEvidence.dossierFacts).toEqual(
          expect.arrayContaining([
            'Gas Transformation Dataroom Status: ready_for_dataroom_review',
            'Room: room-365',
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
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['NAPTransformation_2045', 'H2_Readiness_Doc'])
        );
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
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['HeatSteeringDoc_2026', 'TariffImpact_Report'])
        );
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
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['OfferDoc_2026', 'Anschluss_Report'])
        );
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
        const result = await broker.call(
          'dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus',
          {
            gridOperatorId: 'VNB-143',
          }
        );

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
        const result = await broker.call(
          'dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus',
          {
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
          }
        );

        expect(result.status).toBe('ready_for_decision');
        expect(result.gateStatus).toBe('review_required');
        expect(result.overallStatus).toBe('review_required');
        expect(result.readinessScore).toBe(1);
        expect(result.complianceScore).toBe(1);
        expect(result.missingEvidence).toEqual([]);
        expect(result.technical.capexPerImsys).toBe(1476.19);
        expect(result.financial.totexFirstYear).toBe(6510000);
        expect(result.regulatory.paragraph14aRelevant).toBe(true);
        expect(result.sourceRefs).toEqual(
          expect.arrayContaining(['ZaehlparkPlan_2026', 'Finance_Assumptions'])
        );
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
        const result = await broker.call(
          'dashboard-api.grossspeicherAnschlussReadinessGateStatus',
          {
            gridOperatorId: 'VNB-202',
            projectId: 'gs-202-empty',
          }
        );

        expect(result.status).toBe('needs_asset_context');
        expect(result.gateStatus).toBe('incomplete');
        expect(result.safety).toBe('read_only');
        expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('asset_context');
      });

      it('reports needs_fnav_contract_boundary when fNAV evidence is missing', async () => {
        const result = await broker.call(
          'dashboard-api.grossspeicherAnschlussReadinessGateStatus',
          {
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
          }
        );

        expect(result.status).toBe('needs_fnav_contract_boundary');
        expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain(
          'fnav_contract_boundary'
        );
        expect(result.positiveFollowUps[0].category).toBe('grossspeicher_anschluss_readiness_gate');
      });

      it('reports blocked_by_grid_signal for blocked network priority facts', async () => {
        const result = await broker.call(
          'dashboard-api.grossspeicherAnschlussReadinessGateStatus',
          {
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
          }
        );

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
        const result = await broker.call(
          'dashboard-api.grossspeicherAnschlussReadinessGateStatus',
          {
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
          }
        );

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
        expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain(
          'test_case_coverage'
        );
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
        const result = await broker.call(
          'dashboard-api.redispatchProjectControllingKpiCockpitStatus',
          {
            taskOwner: 'Netzbetrieb',
          }
        );

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
        const result = await broker.call(
          'dashboard-api.redispatchProjectControllingKpiCockpitStatus',
          {
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
          }
        );

        expect(result.status).toBe('needs_source_health');
        expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toContain('source_health');
        expect(result.positiveFollowUps[0].category).toBe(
          'redispatch_project_controlling_kpi_cockpit'
        );
      });

      it('blocks explicit Redispatch decision gaps', async () => {
        const result = await broker.call(
          'dashboard-api.redispatchProjectControllingKpiCockpitStatus',
          {
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
          }
        );

        expect(result.status).toBe('blocked_by_decision_gap');
        expect(result.decisionBlockers.map((blocker) => blocker.code)).toContain(
          'blocked_decision'
        );
        expect(result.validationFindings.some((finding) => finding.severity === 'high')).toBe(true);
      });

      it('reports ready_for_project_review when supplied evidence is complete', async () => {
        const result = await broker.call(
          'dashboard-api.redispatchProjectControllingKpiCockpitStatus',
          {
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
          }
        );

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
          expect.arrayContaining([
            'management',
            'regulierung',
            'asset_management',
            'netzplanung',
            'vnb',
            'msb',
            'bkv',
            'esa',
          ])
        );
        expect(result.evidenceGaps.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'sparte_asset_facts',
            'mako_edm_evidence',
            'billing_bkv_evidence',
            'capability_projection',
          ])
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
            sideEffectPolicy: expect.stringMatching(
              /read_only_event|advisory_only|consequential_requires_followup/
            ),
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
            notCalled: [
              'external.connector.call',
              'device-control.execute',
              'personal-agent.execute',
            ],
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
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus',
          {
            tenantId: 'stadtwerk-mauer',
          }
        );

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
            recentTranscripts: [
              { stubFamily: 'mako_lieferantenwechsel', responseVariant: 'missing_data' },
            ],
            missingEvidence: [{ missingDataPoint: 'meloId' }],
            positiveFollowUps: [],
            dossierFacts: ['Stub Status: stub_transcripts_need_evidence', 'Transcripts: 1'],
          },
        });

        const result = await broker.call(
          'dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus',
          {
            tenantId: 'stadtwerk-mauer',
          }
        );

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
          expect.arrayContaining([
            'mako.dispatch',
            'external.connector.call',
            'personal-agent.execute',
          ])
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

    // -- stadtwerkMauerCaseDetailStatus ------------------------------------
    describe('stadtwerkMauerCaseDetailStatus', () => {
      it('returns a Budibase-renderable case detail with evidence gaps, role hints and no-call guards', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 5,
          recentTraces: [
            {
              traceId: 'smm-e2e-trace:test',
              caseId: 'smm-budibase-workbench',
              demoPath: 'pv_registration_electrician_missing_nap',
              status: 'demo_trace_needs_evidence',
              transcriptId: 'smm-stub:test',
              evidenceQuality: 'incomplete_demo_evidence',
            },
          ],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [
            { missingDataPoint: 'napReference' },
            { missingDataPoint: 'customerConsentStatus' },
          ],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call('dashboard-api.stadtwerkMauerCaseDetailStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_case_detail');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('case_detail_needs_evidence');
        expect(result.processFamily).toBe('pv_registration');
        expect(result.controlCase).toBe('electrician_missing_nap');
        expect(result.dataClasses.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            'publicContextLayer',
            'syntheticTenantSeed',
            'sandboxRuntimeArtifact',
          ])
        );
        expect(result.evidence.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            'napReference',
            'maloId',
            'meloId',
            'meterId',
            'customerConsentStatus',
          ])
        );
        expect(result.evidenceRows.map((item) => item.evidenceId)).toEqual(
          expect.arrayContaining(['napReference', 'customerConsentStatus'])
        );
        expect(
          result.evidenceRows.find((item) => item.evidenceId === 'napReference')
        ).toMatchObject({
          label: 'Nap Reference',
          state: 'clarification',
          roleLabel: 'NETZPLANUNG',
        });
        expectScalarTableRows(result.evidenceRows);
        expect(result.nextGateRows.map((item) => item.gateId)).toEqual(
          expect.arrayContaining(['verify_blueprint_seed', 'inspect_missing_nap'])
        );
        expectScalarTableRows(result.nextGateRows);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining(['napReference', 'customerConsentStatus'])
        );
        expect(result.roleWorkbenchHints.map((hint) => hint.roleId)).toEqual(
          expect.arrayContaining([
            'ROLE_NETZPLANUNG',
            'ROLE_GRID_OPERATOR',
            'ROLE_COMMERCIAL_AUDIT',
          ])
        );
        expect(result.traceSummaries[0]).toMatchObject({
          traceId: 'smm-e2e-trace:test',
          dataClass: 'sandboxRuntimeArtifact',
        });
        expect(result.operationsRunbookHints[0]).toMatchObject({
          execution: 'not_executed_by_case_detail',
        });
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.caseSummary.syntheticIdDisclaimer).toContain('synthetic demo identifiers');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.api.call',
            'rundeck.job.execute',
            'mako.dispatch',
            'billing',
            'settlement',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'public_context_mutation',
            'production_mutation',
            'personal-agent.execute',
          ])
        );
      });

      it('returns a structured not-found detail state outside the sandbox tenant', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerCaseDetailStatus', {
          tenantId: 'other-tenant',
          caseId: 'unknown-case',
        });

        expect(result.found).toBe(false);
        expect(result.status).toBe('case_detail_blocked_outside_sandbox_tenant');
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.traceSummaries).toEqual([]);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining(['public-context.mutate', 'personal-agent.execute'])
        );
      });

      it('returns a structured not-found detail state for unknown sandbox cases', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerCaseDetailStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'unknown-case',
        });

        expect(result.found).toBe(false);
        expect(result.status).toBe('case_detail_not_found');
        expect(result.caseId).toBe('unknown-case');
        expect(result.traceSummaries).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining(['napReference', 'customerConsentStatus'])
        );
      });
    });

    // -- stadtwerkMauerBlueprintPackVerifyStatus ---------------------------
    describe('stadtwerkMauerBlueprintPackVerifyStatus', () => {
      it('returns a read-only Blueprint Pack verify projection for Budibase', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_blueprint_pack_verify');
        expect(result.safety).toBe('read_only_workbench_projection');
        expect(result.runbookId).toBe('vdmi-blueprint-pack-verify');
        expect(result.status).toBe('completed');
        expect(result.riskClass).toBe('read_only');
        expect(result.summary.counts.requiredEvidence).toBe(5);
        expect(result.summary.counts.roleRelations).toBe(3);
        expect(result.summary.counts.demoProcessMatrixRows).toBe(4);
        expect(result.data.validation).toEqual({ valid: true, errors: [] });
        expect(result.data.publicContextLayer).toMatchObject({ present: true, mutable: false });
        expect(result.data.syntheticTenantSeed).toMatchObject({
          present: true,
          syntheticOnly: true,
        });
        expect(result.data.sandboxRuntimeArtifacts).toMatchObject({
          present: true,
          ignoredByVerify: true,
          resettable: true,
        });
        expect(result.data.requiredEvidence).toEqual(
          expect.arrayContaining([
            'napReference',
            'maloId',
            'meloId',
            'meterId',
            'customerConsentStatus',
          ])
        );
        expect(result.data.roleRelations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ roleId: 'ROLE_NETZPLANUNG', relation: 'verantwortlich' }),
          ])
        );
        expect(result.data.demoProcessMatrixSync).toMatchObject({
          slug: 'pv-registration-missing-nap',
          expectedSlug: 'pv-registration-missing-nap',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
          forbiddenActionsStatus: 'not_introduced',
        });
        expect(result.data.demoProcessMatrixSync.downstreamHandoff).toMatchObject({
          blueprintPack: 'complete',
          landingRegistry: 'pending',
          productiveDemoRoom: 'pending',
        });
        expect(result.data.demoProcessMatrixSync.rows[0]).toMatchObject({
          phase: '1',
          roles: {
            V: 'ROLE_NETZPLANUNG',
            D: 'ROLE_GRID_OPERATOR',
            M: 'ROLE_ELECTRICIAN',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: expect.arrayContaining(['napReference']),
          dataClassRefs: expect.arrayContaining(['publicContextLayer', 'syntheticTenantSeed']),
          gateOutcome: 'missing_nap_clarification',
        });
        expect(result.data.budibaseRenderTarget).toBe('budibase:stadtwerk-mauer-workbench');
        expect(result.data.brokerDossierHydration.exposed).toBe(false);
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tenant.provision',
            'seed.import',
            'rundeck.execute',
            'budibase.table.write',
            'public-context.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('verifies the Grid Connection Transformation Gate Blueprint seed read-only', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-grid-connection-transformation-gate-v1',
        });

        expect(result.status).toBe('completed');
        expect(result.riskClass).toBe('read_only');
        expect(result.data.validation).toEqual({ valid: true, errors: [] });
        expect(result.summary.counts.requiredEvidence).toBe(8);
        expect(result.summary.counts.demoProcessMatrixRows).toBe(4);
        expect(result.data.requiredEvidence).toEqual(
          expect.arrayContaining([
            'napMaloReferenceEvidence',
            'divisionEvidence',
            'transformationOptionEvidence',
            'dataQualityEvidence',
            'investmentPathEvidence',
            'decommissionPathEvidence',
            'ownerNextActionEvidence',
            'sourceReferenceEvidence',
          ])
        );
        expect(result.data.demoProcessMatrixSync).toMatchObject({
          slug: 'grid-connection-transformation-gate',
          expectedSlug: 'grid-connection-transformation-gate',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
          forbiddenActionsStatus: 'not_introduced',
        });
        expect(result.data.demoProcessMatrixSync.rows[2]).toMatchObject({
          phase: '3',
          roles: {
            V: 'ROLE_NETZPLANUNG',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_ASSET_MANAGEMENT',
            I: 'ROLE_ADMINISTRATOR',
          },
          evidenceRequirements: ['investmentPathEvidence', 'decommissionPathEvidence'],
          gateOutcome: 'investment_and_decommission_path_review_only',
        });
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tenant.provision',
            'seed.import',
            'rundeck.execute',
            'budibase.table.write',
            'public-context.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('returns a blocked read-only state for unsupported seeds', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'missing-seed',
        });

        expect(result.status).toBe('blocked');
        expect(result.riskClass).toBe('read_only');
        expect(result.summary.counts.seedsFound).toBe(0);
        expect(result.warnings).toContain('seed must be an object');
        expect(result.data.seedFound).toBe(false);
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining(['tenant.provision', 'external.connector.call'])
        );
      });

      it('returns Redispatch readiness matrix facts through the same verify projection', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-redispatch-participation-readiness-v1',
        });

        expect(result.status).toBe('completed');
        expect(result.summary.counts.requiredEvidence).toBe(5);
        expect(result.summary.counts.demoProcessMatrixRows).toBe(5);
        expect(result.data.processFamily).toBe('redispatch_readiness');
        expect(result.data.controlCase).toBe('redispatch_participation_readiness');
        expect(result.data.requiredEvidence).toEqual(
          expect.arrayContaining([
            'syntheticRedispatchAssetPortfolio',
            'installationGridLocationEvidence',
            'remoteControlCommunicationTestEvidence',
            'forecastDispatchTestProof',
            'readinessReviewDecision',
          ])
        );
        expect(result.data.demoProcessMatrixSync).toMatchObject({
          slug: 'redispatch-participation-readiness',
          expectedSlug: 'redispatch-participation-readiness',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 5,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
        });
        expect(result.data.demoProcessMatrixSync.rows[2]).toMatchObject({
          phase: '3',
          roles: {
            V: 'ROLE_GRID_OPERATIONS_LEAD',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_METERING',
            I: 'ROLE_REGULATORY_AFFAIRS',
          },
          evidenceRequirements: ['remoteControlCommunicationTestEvidence'],
          gateOutcome: 'communication_test_evidence_gap',
        });
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'mako.write',
            'billing.prepare',
            'settlement.export',
            'tariff.mutate',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
        expect(result.data.brokerDossierHydration.exposed).toBe(false);
      });

      it('returns Decommissioned Asset matrix facts and seed hygiene through the verify projection', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
        });

        expect(result.status).toBe('completed');
        expect(result.summary.counts.requiredEvidence).toBe(4);
        expect(result.summary.counts.demoProcessMatrixRows).toBe(4);
        expect(result.data.processFamily).toBe('decommissioned_asset_reconciliation');
        expect(result.data.controlCase).toBe('decommissioned_asset_reconciliation_status');
        expect(result.data.syntheticTenantSeed.examples).toEqual([
          'synthetic decommissioned asset id',
          'synthetic SAP Anlagenspiegel entry',
          'synthetic reconciliation discrepancy marker',
        ]);
        expect(result.data.syntheticTenantSeed.examples.join(' ')).not.toMatch(/Redispatch/i);
        expect(result.data.requiredEvidence).toEqual([
          'gisDecommissionedAssetsEvidence',
          'sapAnlagenspiegelEvidence',
          'reconciliationDiscrepancyFeed',
          'reconciliationApprovalDecision',
        ]);
        expect(result.data.demoProcessMatrixSync).toMatchObject({
          slug: 'decommissioned-asset-reconciliation',
          expectedSlug: 'decommissioned-asset-reconciliation',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
        });
        expect(result.data.demoProcessMatrixSync.downstreamHandoff).toMatchObject({
          blueprintPack: 'complete',
          landingRegistry: 'pending',
          productiveDemoRoom: 'pending',
        });
        expect(result.data.demoProcessMatrixSync.rows[0]).toMatchObject({
          phase: '1',
          roles: {
            V: 'ROLE_NETZPLANUNG',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_ANLAGENBUCHHALTUNG',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['gisDecommissionedAssetsEvidence'],
          dataClassRefs: ['syntheticTenantSeed'],
          gateOutcome: 'gis_decommissioned_assets_harvested',
        });
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'external.connector.call',
            'public-context.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('returns MaStR Sync-Gap matrix facts through the same verify projection', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-mastr-sync-gap-alerting-v1',
        });

        expect(result.status).toBe('completed');
        expect(result.summary.counts.seedsFound).toBe(1);
        expect(result.summary.counts.requiredEvidence).toBe(4);
        expect(result.summary.counts.demoProcessMatrixRows).toBe(4);
        expect(result.data.seedFound).toBe(true);
        expect(result.data.validation).toEqual({ valid: true, errors: [] });
        expect(result.data.processFamily).toBe('mastr_sync_gap_alerting');
        expect(result.data.controlCase).toBe('mastr_sync_gap_alerting_status');
        expect(result.data.requiredEvidence).toEqual([
          'mastrFreshnessEvidence',
          'redispatchStammdatenComparison',
          'syncGapAlertFeed',
          'reconciliationApprovalDecision',
        ]);
        expect(result.data.demoProcessMatrixSync).toMatchObject({
          slug: 'mastr-sync-gap-alerting',
          expectedSlug: 'mastr-sync-gap-alerting',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 4,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
        });
        expect(result.data.demoProcessMatrixSync.downstreamHandoff).toMatchObject({
          blueprintPack: 'complete',
          landingRegistry: 'pending',
          productiveDemoRoom: 'pending',
        });
        expect(result.data.demoProcessMatrixSync.rows[2]).toMatchObject({
          phase: '3',
          roles: {
            V: 'ROLE_NETZBETRIEB',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_REDISPATCH_KOORDINATOR',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['syncGapAlertFeed'],
          gateOutcome: 'sync_gap_alerts_pending',
        });
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tenant.provision',
            'budibase.table.write',
            'external.connector.call',
            'public-context.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('returns substation load assessment matrix facts through the same verify projection', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-substation-load-assessment-v1',
        });

        expect(result.status).toBe('completed');
        expect(result.summary.counts.requiredEvidence).toBe(6);
        expect(result.summary.counts.demoProcessMatrixRows).toBe(5);
        expect(result.data.processFamily).toBe('grid_capacity_governance');
        expect(result.data.controlCase).toBe('substation_load_assessment');
        expect(result.data.requiredEvidence).toEqual(
          expect.arrayContaining([
            'stationBoundaryEvidence',
            'loadProfileEvidence',
            'forecastHorizonEvidence',
            'flexOptionEvidence',
            'capexOptionEvidence',
            'reviewGateMarker',
          ])
        );
        expect(result.data.demoProcessMatrixSync).toMatchObject({
          slug: 'substation-load-assessment',
          expectedSlug: 'substation-load-assessment',
          synced: true,
          roleLegendM: 'Mitwirkend',
          rowCount: 5,
          rowCountValid: true,
          roleCellsClean: true,
          dataClassesLimited: true,
        });
        expect(result.data.demoProcessMatrixSync.rows[2]).toMatchObject({
          phase: '3',
          roles: {
            V: 'ROLE_ASSET_PLANNING_LEAD',
            D: 'ROLE_CERNION_GOVERNANCE',
            M: 'ROLE_GRID_OPERATIONS',
            I: 'ROLE_COMMERCIAL_AUDIT',
          },
          evidenceRequirements: ['flexOptionEvidence', 'capexOptionEvidence'],
          gateOutcome: 'flex_capex_scenario_review_only',
        });
        expect(result.data.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'mako.write',
            'billing.prepare',
            'settlement.export',
            'tariff.mutate',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
        expect(result.data.brokerDossierHydration.exposed).toBe(false);
      });
    });

    // -- stadtwerkMauerTransferReadinessStatus -----------------------------
    describe('stadtwerkMauerTransferReadinessStatus', () => {
      it('returns scalar transfer-readiness rows for the Budibase Workbench', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerTransferReadinessStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_transfer_readiness');
        expect(result.safety).toBe('read_only_workbench_projection');
        expect(result.status).toBe('ready_for_onboarding_discussion');
        expect(result.brokerDossierHydration).toMatchObject({
          exposed: false,
        });
        expect(result.transferSummaryRows[0]).toMatchObject({
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-pv-missing-nap-v1',
          caseId: 'smm-budibase-workbench',
          municipality: 'Mauer',
          ags: '08226048',
          postcode: '69256',
        });
        expect(result.dataClassRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              rowKey: 'public_context_layer',
              transferState: 'reusable_read_only',
              syntheticOnly: false,
            }),
            expect.objectContaining({
              rowKey: 'synthetic_tenant_seed',
              transferState: 'replace_for_real_tenant',
              syntheticOnly: true,
              tenantParameter: true,
            }),
            expect.objectContaining({
              rowKey: 'sandbox_runtime_artifacts',
              transferState: 'do_not_transfer',
              productionBlocked: true,
            }),
          ])
        );
        expect(result.tenantParameterRows.map((row) => row.rowKey)).toEqual(
          expect.arrayContaining([
            'tenant_id',
            'tenant_name',
            'municipality_profile',
            'grid_operator_hint',
            'role_names',
            'evidence_requirements',
          ])
        );
        expect(result.disabledActionClassRows.map((row) => row.boundary)).toEqual(
          expect.arrayContaining([
            'tenant.provision',
            'seed.import',
            'rundeck.execute',
            'budibase.table.write',
            'public-context.mutate',
            'external.connector.call',
            'device-control.execute',
            'personal_agent_hardcoding',
          ])
        );
        expect(result.safeNextGateRows.map((row) => row.rowKey)).toEqual(
          expect.arrayContaining([
            'inspect_blueprint_verify',
            'refresh_public_context_view',
            'validate_transfer_parameters',
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tenant.provision',
            'rundeck.execute',
            'budibase.table.write',
            'public-context.mutate',
            'external.connector.call',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );

        expectScalarTableRows(result.transferSummaryRows);
        expectScalarTableRows(result.dataClassRows);
        expectScalarTableRows(result.tenantParameterRows);
        expectScalarTableRows(result.reusableElementRows);
        expectScalarTableRows(result.disabledActionClassRows);
        expectScalarTableRows(result.safeNextGateRows);
      });

      it('represents Decommissioned Asset sync proof as pending downstream transfer readiness', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerTransferReadinessStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.status).toBe('ready_for_onboarding_discussion');
        expect(result.transferSummaryRows[0]).toMatchObject({
          seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
          status: 'ready_for_onboarding_discussion',
          safety: 'read_only_workbench_projection',
        });
        expect(result.dataClassRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              rowKey: 'synthetic_tenant_seed',
              examples:
                'synthetic decommissioned asset id, synthetic SAP Anlagenspiegel entry, synthetic reconciliation discrepancy marker',
              transferState: 'replace_for_real_tenant',
            }),
          ])
        );
        expect(result.tenantParameterRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              rowKey: 'evidence_requirements',
              currentDemoValue: expect.stringContaining('gisDecommissionedAssetsEvidence'),
            }),
          ])
        );
        expect(result.reusableElementRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              rowKey: 'blueprint_seed_contract',
              sourceRef:
                'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-decommissioned-asset-reconciliation-v1.json',
              productionMutation: false,
            }),
          ])
        );
        expect(result.sourceActions.referenced).toEqual(
          expect.arrayContaining([
            'integrations/budibase/README.md',
            'integrations/budibase/manifests/stadtwerk-mauer-workbench.json',
            'integrations/budibase/scripts/apply-stadtwerk-mauer-workbench.js',
            'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-decommissioned-asset-reconciliation-v1.json',
          ])
        );
        expect(result.disabledActionClassRows.map((row) => row.boundary)).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'public-context.mutate',
            'external_connector_call',
            'production_mutation',
            'personal_agent_hardcoding',
          ])
        );
      });

      it('binds the Budibase manifest to visible transfer-readiness tables', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerTransferReadinessSummaryRows',
            'getStadtwerkMauerTransferReadinessDataClassRows',
            'getStadtwerkMauerTransferReadinessTenantParameterRows',
            'getStadtwerkMauerTransferReadinessReusableRows',
            'getStadtwerkMauerTransferReadinessBoundaryRows',
            'getStadtwerkMauerTransferReadinessSafeNextGateRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerTransferReadinessSummaryRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-transfer-readiness',
          transformer: 'return data.transferSummaryRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'transfer_readiness_summary',
            'transfer_readiness_data_classes',
            'transfer_readiness_parameters',
            'transfer_readiness_reusable',
            'transfer_readiness_boundaries',
            'transfer_readiness_safe_next_gates',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Transfer Readiness binds to a read-only dashboard facade'
        );
      });
    });

    // -- stadtwerkMauerLandingRegistryDraftStatus --------------------------
    describe('stadtwerkMauerLandingRegistryDraftStatus', () => {
      it('returns a read-only Landing-Registry draft sync proof for substation load assessment', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerLandingRegistryDraftStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-substation-load-assessment-v1',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_landing_registry_draft');
        expect(result.safety).toBe('read_only_workbench_projection');
        expect(result.status).toBe('landing_registry_draft_ready');
        expect(result.riskClass).toBe('read_only');
        expect(result.rowCount).toBe(5);
        expect(result.roleHeaders).toEqual([
          'Phase',
          'V = Verantwortlich',
          'D = Durchfuehrend',
          'M = Mitwirkend',
          'I = Informiert',
          'Nachweise',
        ]);
        expect(result.draft).toMatchObject({
          slug: 'substation-load-assessment',
          processFamily: 'grid_capacity_governance',
          controlCase: 'substation_load_assessment',
          seedId: 'stadtwerk-mauer-substation-load-assessment-v1',
          rowCount: 5,
        });
        expect(result.draft.roleLegend.M).toBe('Mitwirkend');
        expect(result.draft.rows[0]).toMatchObject({
          phase: '1',
          V: 'ROLE_ASSET_PLANNING_LEAD',
          D: 'ROLE_CERNION_GOVERNANCE',
          M: 'ROLE_ASSET_MANAGEMENT',
          I: 'ROLE_REGULATORY_AFFAIRS',
          evidenceRequirements: ['stationBoundaryEvidence'],
        });
        expect(result.syncProof).toMatchObject({
          blueprintPack: { status: 'complete' },
          landingRegistryDraft: { status: 'draft_ready' },
          productiveDemoRoom: { status: 'pending' },
        });
        expect(result.publicationBlockers).toEqual(
          expect.arrayContaining([
            'productive_demo_room_publication_issue_missing',
            'cernion_de_sitemap_canonical_update_pending',
          ])
        );
        expect(result.positiveFollowUps.map((item) => item.missingDataPoint)).toEqual(
          expect.arrayContaining([
            'landing_registry_review_owner',
            'productive_demo_room_publication',
            'budibase_visible_sync_row',
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'cernion.de.publish',
            'landing-registry.write',
            'budibase.table.write',
            'operations-runbook.execute',
            'external.connector.call',
            'hitl.create',
            'settlement.export',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
        expect(result.brokerDossierHydration.exposed).toBe(false);
      });

      it('returns a read-only missing-seed state without publication side effects', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerLandingRegistryDraftStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'missing-seed',
        });

        expect(result.status).toBe('seed_not_found');
        expect(result.found).toBe(false);
        expect(result.rowCount).toBe(0);
        expect(result.syncProof.productiveDemoRoom.status).toBe('pending');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining(['cernion.de.publish', 'landing-registry.write'])
        );
      });

      it('returns the Energy Sharing Landing-Registry draft sync proof from the canonical matrix', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerLandingRegistryDraftStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
        });

        expect(result.status).toBe('landing_registry_draft_ready');
        expect(result.found).toBe(true);
        expect(result.rowCount).toBe(5);
        expect(result.roleHeaders).toEqual([
          'Phase',
          'V = Verantwortlich',
          'D = Durchfuehrend',
          'M = Mitwirkend',
          'I = Informiert',
          'Nachweise',
        ]);
        expect(result.draft).toMatchObject({
          slug: 'energy-sharing-collective-approval',
          processFamily: 'energy_sharing_governance',
          controlCase: 'energy_sharing_collective_approval',
          seedId: 'stadtwerk-mauer-energy-sharing-collective-approval-v1',
          canonicalSource:
            'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-energy-sharing-collective-approval-v1.json',
          rowCount: 5,
        });
        expect(result.draft.roleLegend.M).toBe('Mitwirkend');
        expect(result.draft.rows[3]).toMatchObject({
          phase: '4',
          V: 'ROLE_ENERGY_SHARING_PRODUCT_OWNER',
          D: 'ROLE_CERNION_GOVERNANCE',
          M: 'ROLE_SETTLEMENT_BILLING_SPECIALIST',
          I: 'ROLE_COMMERCIAL_AUDIT',
          evidenceRequirements: ['allocationBillingSettlementGapEvidence'],
          gateOutcome: 'allocation_a96_billing_settlement_evidence_gap',
        });
        expect(result.syncProof).toMatchObject({
          blueprintPack: { status: 'complete' },
          landingRegistryDraft: { status: 'draft_ready' },
          productiveDemoRoom: { status: 'pending' },
        });
        expect(result.publicationBlockers).toEqual(
          expect.arrayContaining([
            'productive_demo_room_publication_issue_missing',
            'landing_registry_review_owner_missing',
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'cernion.de.publish',
            'landing-registry.write',
            'budibase.table.write',
            'operations-runbook.execute',
            'external.connector.call',
            'hitl.create',
            'settlement.export',
            'device-control.execute',
            'personal-agent.execute',
          ])
        );
        expect(result.brokerDossierHydration).toMatchObject({
          exposed: false,
          reason: expect.stringContaining('dossier-facing capability is cut'),
        });
      });

      it('returns the Decommissioned Asset Landing-Registry draft sync proof from the canonical matrix', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerLandingRegistryDraftStatus', {
          tenantId: 'stadtwerk-mauer',
          seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
        });

        expect(result.status).toBe('landing_registry_draft_ready');
        expect(result.found).toBe(true);
        expect(result.rowCount).toBe(4);
        expect(result.roleHeaders).toEqual([
          'Phase',
          'V = Verantwortlich',
          'D = Durchfuehrend',
          'M = Mitwirkend',
          'I = Informiert',
          'Nachweise',
        ]);
        expect(result.draft).toMatchObject({
          slug: 'decommissioned-asset-reconciliation',
          processFamily: 'decommissioned_asset_reconciliation',
          controlCase: 'decommissioned_asset_reconciliation_status',
          seedId: 'stadtwerk-mauer-decommissioned-asset-reconciliation-v1',
          canonicalSource:
            'src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-decommissioned-asset-reconciliation-v1.json',
          rowCount: 4,
        });
        expect(result.draft.roleLegend.M).toBe('Mitwirkend');
        expect(result.draft.rows).toHaveLength(4);
        expect(result.draft.rows[0]).toMatchObject({
          phase: '1',
          V: 'ROLE_NETZPLANUNG',
          D: 'ROLE_CERNION_GOVERNANCE',
          M: 'ROLE_ANLAGENBUCHHALTUNG',
          I: 'ROLE_COMMERCIAL_AUDIT',
          evidenceRequirements: ['gisDecommissionedAssetsEvidence'],
          gateOutcome: 'gis_decommissioned_assets_harvested',
        });
        expect(result.syncProof).toMatchObject({
          blueprintPack: { status: 'complete' },
          landingRegistryDraft: { status: 'draft_ready' },
          productiveDemoRoom: { status: 'pending' },
        });
        expect(result.publicationBlockers).toEqual(
          expect.arrayContaining([
            'productive_demo_room_publication_issue_missing',
            'landing_registry_review_owner_missing',
            'cernion_de_sitemap_canonical_update_pending',
          ])
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'cernion.de.publish',
            'landing-registry.write',
            'budibase.table.write',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
        expect(result.brokerDossierHydration.exposed).toBe(false);
      });
    });

    // -- stadtwerkMauerWorkbenchHubStatus ----------------------------------
    describe('stadtwerkMauerWorkbenchHubStatus', () => {
      it('returns a read-only Hub launcher with target readiness and no-call guards', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [
            {
              traceId: 'smm-e2e-trace:test',
              caseId: 'smm-budibase-workbench',
              demoPath: 'pv_registration_electrician_missing_nap',
              status: 'demo_trace_needs_evidence',
              evidenceQuality: 'incomplete_demo_evidence',
            },
          ],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call('dashboard-api.stadtwerkMauerWorkbenchHubStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_workbench_hub');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('workbench_hub_ready_with_planned_targets');
        expect(result.routeKey).toBe('stadtwerk-mauer');
        expect(result.dataClasses.map((item) => item.id)).toEqual(
          expect.arrayContaining([
            'publicContextLayer',
            'syntheticTenantSeed',
            'sandboxRuntimeArtifact',
          ])
        );
        expect(result.targets.map((target) => target.targetId)).toEqual(
          expect.arrayContaining([
            'administrator-workbench',
            'selected-case-detail',
            'selected-case-actions',
            'zielnetzplanung-workbench',
            'sales-key-account-workbench',
            'role-workbench-catalog',
          ])
        );
        expect(result.targetRows.map((target) => target.label)).toEqual(
          expect.arrayContaining([
            'Administrator Workbench',
            'Selected Case Detail',
            'Zielnetzplanung',
            'Vertrieb / Key Account',
            'Role Workbench Catalog',
          ])
        );
        expect(result.targetRows.find((target) => target.routeKey === 'case-detail')).toMatchObject(
          {
            status: 'available',
            safetyLabel: 'Read Only',
          }
        );
        expectScalarTableRows(result.targetRows);
        expect(
          result.targets.find((target) => target.targetId === 'selected-case-detail')
        ).toMatchObject({
          status: 'available',
          routeKey: 'case-detail',
          safety: 'read_only',
        });
        expect(
          result.targets.find((target) => target.targetId === 'administrator-workbench')
        ).toMatchObject({
          status: 'planned',
          nextGate: { id: 'product_cut_307' },
        });
        expect(
          result.targets.find((target) => target.targetId === 'role-workbench-catalog')
        ).toMatchObject({
          status: 'available',
          nextGate: { id: 'render_role_workbench_catalog' },
        });
        expect(result.readiness.availableTargets).toBeGreaterThanOrEqual(1);
        expect(result.positiveFollowUps.map((item) => item.missingDataPoint)).toEqual(
          expect.arrayContaining(['administrator-workbench'])
        );
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.system_of_record',
            'rundeck.job.execute',
            'setup.execute',
            'reset.execute',
            'provisioning.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns a safe empty Hub outside the sandbox tenant', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerWorkbenchHubStatus', {
          tenantId: 'other-tenant',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.found).toBe(false);
        expect(result.status).toBe('workbench_hub_blocked_outside_sandbox_tenant');
        expect(result.targets).toEqual([]);
        expect(result.targetRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'public-context.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to the Hub and selected-case read queries', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerWorkbenchHub',
            'getStadtwerkMauerWorkbenchHubTargetRows',
            'getStadtwerkMauerCaseDetail',
            'getStadtwerkMauerCaseEvidenceRows',
            'getStadtwerkMauerCaseNextGateRows',
            'getStadtwerkMauerCaseAnnotationRows',
            'getStadtwerkMauerCaseAnnotationAuditRows',
            'recordStadtwerkMauerCaseAnnotation',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerWorkbenchHubTargetRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-workbench-hub',
          transformer: 'return data.targetRows || []',
        });
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerCaseEvidenceRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-case-detail',
          transformer: 'return data.evidenceRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'hub',
            'case_detail',
            'case_next_gates',
            'case_annotation_command',
            'case_annotation_rows',
            'case_annotation_audit',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain('scalar display rows');
      });

      it('records sandbox case annotations through Cernion and exposes scalar case-detail readback', async () => {
        handlers.stadtwerkMauerListCaseAnnotations = () => ({
          capabilityKey: 'stadtwerk_mauer_case_annotations',
          safety: 'read_only_sandbox_annotation_readback',
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          found: true,
          status: 'case_annotations_ready',
          currentDemoStatus: 'needs_evidence',
          annotationCount: 1,
          annotationRows: [
            {
              annotationId: 'smm-case-annotation:test',
              caseId: 'smm-budibase-workbench',
              commandType: 'add_operator_note_sandbox',
              currentStatus: 'needs_evidence',
              priorStatus: 'needs_evidence',
              actorLabel: 'budibase:operator',
              sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
              noteLabel: 'Budibase sandbox handover note',
              reasonLabel: 'visible-demo annotation command',
              dataClass: 'sandbox_runtime_artifact',
              createdAt: '2026-06-28T17:00:00.000Z',
            },
          ],
          auditRows: [
            {
              auditId: 'smm-case-annotation:test',
              caseId: 'smm-budibase-workbench',
              actorLabel: 'budibase:operator',
              sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
              transitionLabel: 'needs_evidence -> needs_evidence',
              commandType: 'add_operator_note_sandbox',
              idempotencyKey: 'budibase-smm-workbench-case-annotation',
              createdAt: '2026-06-28T17:00:00.000Z',
            },
          ],
        });

        const command = await broker.call('dashboard-api.stadtwerkMauerCaseAnnotationCommand', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          commandType: 'add_operator_note_sandbox',
          note: 'Budibase sandbox handover note',
          actorLabel: 'budibase:operator',
          idempotencyKey: 'budibase-smm-workbench-case-annotation',
        });

        expect(command.accepted).toBe(true);
        expect(command.safety).toBe('non_consequential_sandbox_command');
        expect(command.noCallGuards).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'public-context.mutate',
            'personal-agent.execute',
          ])
        );

        const detail = await broker.call('dashboard-api.stadtwerkMauerCaseDetailStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
        });

        expect(detail.annotationRows[0]).toMatchObject({
          annotationId: 'smm-case-annotation:test',
          commandType: 'add_operator_note_sandbox',
          currentStatus: 'needs_evidence',
          dataClass: 'sandbox_runtime_artifact',
        });
        expect(detail.annotationAuditRows[0]).toMatchObject({
          auditId: 'smm-case-annotation:test',
          transitionLabel: 'needs_evidence -> needs_evidence',
        });
        expectScalarTableRows(detail.annotationRows);
        expectScalarTableRows(detail.annotationAuditRows);
      });
    });

    // -- stadtwerkMauerWorkbenchSelectedTargetStatus ----------------------
    describe('stadtwerkMauerWorkbenchSelectedTargetStatus', () => {
      it('returns scalar selected/focus rows for a valid Hub target', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call(
          'dashboard-api.stadtwerkMauerWorkbenchSelectedTargetStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            targetId: 'grid-planning',
          }
        );

        expect(result.capabilityKey).toBe('stadtwerk_mauer_workbench_selected_target');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('workbench_selected_target_ready');
        expect(result.requestedTargetId).toBe('grid-planning');
        expect(result.selectedTargetId).toBe('grid-planning');
        expect(result.selectedSectionKey).toBe('grid_planning_role_queue');
        expect(result.selectedAnchor).toBe('#grid_planning_role_queue');
        expect(result.selectedRows[0]).toMatchObject({
          rowKey: 'selected_target',
          label: 'Selected Target',
          valueLabel: 'Zielnetzplanung',
          status: 'available',
          sectionKey: 'grid_planning_role_queue',
          roleKey: 'grid-planning',
        });
        expect(result.focusRows[0]).toMatchObject({
          targetId: 'grid-planning',
          sectionKey: 'grid_planning_role_queue',
          focusState: 'focus_available_section',
        });
        expect(result.helperRows.map((row) => row.safeNextAction)).toEqual(
          expect.arrayContaining(['show_selected_section', 'query_refresh_only'])
        );
        expect(JSON.stringify(result.helperRows)).not.toContain('undefined');
        expectScalarTableRows(result.selectedRows);
        expectScalarTableRows(result.focusRows);
        expectScalarTableRows(result.helperRows);
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.system_of_record',
            'budibase.automation.arbitrary_write',
            'budibase.ui_state.persist',
            'role.assignment.write',
            'auth.policy.mutate',
            'tenant.provision',
            'setup.execute',
            'reset.execute',
            'public-context.mutate',
            'rundeck.job.execute',
            'operations-runbook.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns a safe fallback for unknown targets', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerWorkbenchSelectedTargetStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            targetId: 'unknown-target',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('workbench_selected_target_not_found');
        expect(result.selectedRows).toEqual([]);
        expect(result.focusRows).toEqual([]);
        expect(result.helperRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'supported_workbench_target'
        );
        expect(result.supportedTargetIds).toEqual(
          expect.arrayContaining(['hub', 'administrator-workbench'])
        );
      });

      it('returns safe empty focus rows outside the sandbox tenant', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerWorkbenchSelectedTargetStatus',
          {
            tenantId: 'other-tenant',
            caseId: 'smm-budibase-workbench',
            targetId: 'hub',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('workbench_selected_target_blocked_outside_sandbox_tenant');
        expect(result.selectedRows).toEqual([]);
        expect(result.focusRows).toEqual([]);
        expect(result.helperRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'auth.policy.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to selected-target scalar rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerWorkbenchSelectedTarget',
            'getStadtwerkMauerWorkbenchSelectedRows',
            'getStadtwerkMauerWorkbenchFocusRows',
            'getStadtwerkMauerWorkbenchFocusHelperRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerWorkbenchFocusRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-workbench-selected-target',
          transformer: 'return data.focusRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'selected_target',
            'selected_target_focus',
            'selected_target_helpers',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Selected Hub Target binds to scalar selected/focus/helper rows'
        );
      });
    });

    // -- stadtwerkMauerAdministratorInventoryStatus ------------------------
    describe('stadtwerkMauerAdministratorInventoryStatus', () => {
      it('returns a read-only Administrator inventory with scalar rows and data-class separation', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call(
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
          }
        );

        expect(result.capabilityKey).toBe('stadtwerk_mauer_administrator_inventory');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('administrator_inventory_ready');
        expect(result.categories.map((category) => category.categoryKey)).toEqual(
          expect.arrayContaining([
            'public_context_layer',
            'synthetic_tenant_seed',
            'sandbox_runtime_artifact',
            'generated_workbench_item',
            'read_verify_runbook_surface',
          ])
        );
        expect(result.summary.publicContextReadOnly).toBe(true);
        expect(result.summary.syntheticDataClass).toBe('syntheticTenantSeed');
        expect(result.summary.syntheticIdDisclaimer).toContain('synthetic demo identifiers');
        expect(result.inventoryRows.map((row) => row.categoryKey)).toEqual(
          expect.arrayContaining(['public_context_layer', 'synthetic_tenant_seed'])
        );
        expect(result.inventoryRows.find((row) => row.itemKey === 'blueprint-seed')).toMatchObject({
          dataClass: 'syntheticTenantSeed',
          riskClass: 'demo_invented_identifiers',
        });
        expect(
          result.inventoryRows.find((row) => row.itemKey === 'mastr-osm-baseline')
        ).toMatchObject({
          dataClass: 'publicContextLayer',
          riskClass: 'read_only_baseline',
        });
        expectScalarTableRows(result.inventoryRows);
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.system_of_record',
            'tenant.provision',
            'tenant.seed.import',
            'reset.execute',
            'delete.execute',
            'public-context.mutate',
            'sandbox-runtime.mutate',
            'operations-runbook.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns a safe empty Administrator inventory outside the sandbox tenant', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerAdministratorInventoryStatus',
          {
            tenantId: 'other-tenant',
            caseId: 'smm-budibase-workbench',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('administrator_inventory_blocked_outside_sandbox_tenant');
        expect(result.categories).toEqual([]);
        expect(result.inventoryRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'tenant.provision',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to Administrator inventory scalar rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerAdministratorInventory',
            'getStadtwerkMauerAdministratorInventoryRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerAdministratorInventoryRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-administrator-inventory',
          transformer: 'return data.inventoryRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toContain(
          'administrator_inventory'
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Administrator Inventory binds to scalar rows'
        );
      });
    });

    // -- stadtwerkMauerTenantDatabrowserStatus -----------------------------
    describe('stadtwerkMauerTenantDatabrowserStatus', () => {
      it('returns bounded scalar category, item, trace and detail rows for the tenant databrowser', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 2,
          artifactCount: 3,
          recentTraces: [
            {
              traceId: 'smm-e2e-trace:test-1',
              stepKey: 'blueprint_seed_verified',
              stepLabel: 'Blueprint seed verified',
              status: 'verified',
              evidenceRef: 'vdmi-blueprint-pack',
              artifactRef: 'artifact:seed-check',
              timestamp: '2026-06-26T18:00:00.000Z',
            },
            {
              traceId: 'smm-e2e-trace:test-2',
              stepKey: 'nap_missing',
              stepLabel: 'NAP evidence missing',
              status: 'needs_evidence',
              evidenceRef: 'napReference',
              artifactRef: 'artifact:nap-gap',
              timestamp: '2026-06-26T18:01:00.000Z',
            },
          ],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call('dashboard-api.stadtwerkMauerTenantDatabrowserStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          categoryId: 'process-trace',
          itemId: 'smm-e2e-trace:test-1',
          limit: 1,
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_tenant_databrowser');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('tenant_databrowser_ready');
        expect(result.categoryId).toBe('process_trace');
        expect(result.selectedItemId).toBe('smm-e2e-trace:test-1');
        expect(result.summary.boundedLimit).toBe(1);
        expect(result.pagination).toMatchObject({
          limit: 1,
          returned: 1,
          totalAvailable: 2,
          hasMore: true,
        });
        expect(result.categoryRows.map((row) => row.categoryId)).toEqual(
          expect.arrayContaining([
            'public_context_layer',
            'synthetic_tenant_seed',
            'sandbox_runtime_artifact',
            'generated_workbench_item',
            'case_evidence',
            'process_trace',
            'artifact',
            'runbook_readiness',
          ])
        );
        expect(result.itemRows).toHaveLength(1);
        expect(result.itemRows[0]).toMatchObject({
          categoryId: 'process_trace',
          itemId: 'smm-e2e-trace:test-1',
          sourceType: 'stadtwerk-mauer-e2e-process-demo.getStatus',
          readinessStatus: 'verified',
        });
        expect(result.traceRows).toHaveLength(1);
        expect(result.traceRows[0]).toMatchObject({
          traceId: 'smm-e2e-trace:test-1',
          stepKey: 'blueprint_seed_verified',
          status: 'verified',
        });
        expect(result.detailRows.map((row) => row.detailId)).toEqual(
          expect.arrayContaining(['category', 'item', 'evidence'])
        );
        expect(result.sourceRows.map((row) => row.sourceId)).toEqual(
          expect.arrayContaining([
            'administrator_inventory',
            'case_detail',
            'workbench_hub',
            'e2e_trace',
          ])
        );
        expectScalarTableRows(result.categoryRows);
        expectScalarTableRows(result.itemRows);
        expectScalarTableRows(result.traceRows);
        expectScalarTableRows(result.detailRows);
        expectScalarTableRows(result.sourceRows);
        expect(result.summary.exportBoundary).toContain(
          'not an unrestricted tenant dump/export endpoint'
        );
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'tenant.export.unbounded',
            'tenant.data.dump',
            'trace.replay',
            'budibase.table.write',
            'budibase.system_of_record',
            'public-context.mutate',
            'operations-runbook.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe fallback rows for unknown categories and items', async () => {
        const unknownCategory = await broker.call(
          'dashboard-api.stadtwerkMauerTenantDatabrowserStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            categoryId: 'unknown-category',
          }
        );

        expect(unknownCategory.found).toBe(false);
        expect(unknownCategory.status).toBe('tenant_databrowser_category_not_found');
        expect(unknownCategory.itemRows).toEqual([]);
        expect(unknownCategory.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'supported_databrowser_category'
        );

        const unknownItem = await broker.call(
          'dashboard-api.stadtwerkMauerTenantDatabrowserStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            categoryId: 'public-context',
            itemId: 'missing-item',
          }
        );

        expect(unknownItem.found).toBe(false);
        expect(unknownItem.status).toBe('tenant_databrowser_item_not_found');
        expect(
          unknownItem.detailRows.find((row) => row.detailId === 'item_not_found')
        ).toMatchObject({
          itemId: 'missing-item',
          status: 'not_found',
        });
        expect(unknownItem.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'supported_databrowser_item'
        );
      });

      it('returns safe empty databrowser rows outside the sandbox tenant', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerTenantDatabrowserStatus', {
          tenantId: 'other-tenant',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.found).toBe(false);
        expect(result.status).toBe('tenant_databrowser_blocked_outside_sandbox_tenant');
        expect(result.categoryRows).toEqual([]);
        expect(result.itemRows).toEqual([]);
        expect(result.traceRows).toEqual([]);
        expect(result.detailRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'tenant.provision',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to Tenant Databrowser scalar rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerTenantDatabrowser',
            'getStadtwerkMauerTenantDatabrowserCategoryRows',
            'getStadtwerkMauerTenantDatabrowserItemRows',
            'getStadtwerkMauerTenantDatabrowserTraceRows',
            'getStadtwerkMauerTenantDatabrowserDetailRows',
            'getStadtwerkMauerTenantDatabrowserSourceRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerTenantDatabrowserItemRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-tenant-databrowser',
          transformer: 'return data.itemRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'tenant_databrowser_categories',
            'tenant_databrowser_items',
            'tenant_databrowser_traces',
            'tenant_databrowser_detail',
            'tenant_databrowser_sources',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Tenant Databrowser binds to bounded scalar category'
        );
      });

      it('includes sandbox annotation rows as bounded Tenant Databrowser items', async () => {
        handlers.stadtwerkMauerListCaseAnnotations = () => ({
          capabilityKey: 'stadtwerk_mauer_case_annotations',
          safety: 'read_only_sandbox_annotation_readback',
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          found: true,
          status: 'case_annotations_ready',
          currentDemoStatus: 'reviewed',
          annotationCount: 1,
          annotationRows: [
            {
              annotationId: 'smm-case-annotation:reviewed',
              caseId: 'smm-budibase-workbench',
              commandType: 'mark_reviewed_sandbox',
              currentStatus: 'reviewed',
              priorStatus: 'needs_evidence',
              actorLabel: 'budibase:operator',
              sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
              noteLabel: 'Reviewed during demo',
              reasonLabel: 'handover proof',
              dataClass: 'sandbox_runtime_artifact',
              createdAt: '2026-06-28T17:10:00.000Z',
            },
          ],
          auditRows: [
            {
              auditId: 'smm-case-annotation:reviewed',
              caseId: 'smm-budibase-workbench',
              actorLabel: 'budibase:operator',
              sourceLabel: 'Cernion Stadtwerk Mauer Workbench',
              transitionLabel: 'needs_evidence -> reviewed',
              commandType: 'mark_reviewed_sandbox',
              idempotencyKey: 'reviewed-key',
              createdAt: '2026-06-28T17:10:00.000Z',
            },
          ],
        });

        const result = await broker.call('dashboard-api.stadtwerkMauerTenantDatabrowserStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
          categoryId: 'case_annotation',
        });

        expect(result.status).toBe('tenant_databrowser_ready');
        expect(result.itemRows[0]).toMatchObject({
          categoryId: 'case_annotation',
          itemId: 'smm-case-annotation:reviewed',
          readinessStatus: 'reviewed',
        });
        expect(result.sourceRows.map((row) => row.sourceId)).toContain('case_annotations');
        expectScalarTableRows(result.itemRows);
      });
    });

    // -- stadtwerkMauerRoleWorkbenchCatalogStatus -------------------------
    describe('stadtwerkMauerRoleWorkbenchCatalogStatus', () => {
      it('returns a read-only role catalog with scalar open-target rows and no-call guards', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call('dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_role_workbench_catalog');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('role_workbench_catalog_ready');
        expect(result.roleVocabulary).toEqual(
          expect.arrayContaining([
            'admin',
            'grid-planning',
            'sales',
            'key-account',
            'vdmi-governance',
          ])
        );
        expect(result.targets.map((target) => target.roleKey)).toEqual(
          expect.arrayContaining([
            'admin',
            'grid-planning',
            'sales',
            'key-account',
            'vdmi-governance',
          ])
        );
        expect(result.targets.find((target) => target.roleKey === 'admin')).toMatchObject({
          status: 'available',
          openTarget: 'administrator_inventory',
        });
        expect(result.targets.find((target) => target.roleKey === 'grid-planning')).toMatchObject({
          status: 'available',
          roleCode: 'ROLE_NETZPLANUNG',
          openTarget: 'grid_planning_role_queue',
        });
        expect(result.targets.find((target) => target.roleKey === 'sales')).toMatchObject({
          status: 'available',
          roleCode: 'ROLE_VERTRIEB',
          openTarget: 'sales_briefing',
        });
        expect(result.targets.find((target) => target.roleKey === 'key-account')).toMatchObject({
          status: 'available',
          roleCode: 'ROLE_KEY_ACCOUNT',
          openTarget: 'sales_briefing',
        });
        expect(result.targets.find((target) => target.roleKey === 'vdmi-governance')).toMatchObject(
          {
            status: 'planned',
            roleCode: 'ROLE_VDMI_GOVERNANCE_REVIEWER',
          }
        );
        expect(result.roleRows.find((row) => row.roleKey === 'grid-planning')).toMatchObject({
          label: 'Zielnetzplanung',
          routeKey: 'grid-planning',
          openTarget: 'grid_planning_role_queue',
        });
        expect(
          result.openTargetRows.find((row) => row.openTarget === 'administrator_inventory')
        ).toMatchObject({
          status: 'available',
          routeKey: 'admin',
        });
        expectScalarTableRows(result.roleRows);
        expectScalarTableRows(result.openTargetRows);
        expect(result.positiveFollowUps.map((item) => item.missingDataPoint)).toContain(
          'vdmi-governance'
        );
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.summary.budibaseBoundary).toContain('Cernion remains the system of record');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.system_of_record',
            'budibase.automation.arbitrary_write',
            'role.assignment.write',
            'auth.policy.mutate',
            'tenant.provision',
            'public-context.mutate',
            'sandbox-runtime.mutate',
            'rundeck.job.execute',
            'operations-runbook.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe empty role rows outside the sandbox tenant', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerRoleWorkbenchCatalogStatus', {
          tenantId: 'other-tenant',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.found).toBe(false);
        expect(result.status).toBe('role_workbench_catalog_blocked_outside_sandbox_tenant');
        expect(result.targets).toEqual([]);
        expect(result.roleRows).toEqual([]);
        expect(result.openTargetRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'auth.policy.mutate',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to role catalog scalar rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerRoleWorkbenchCatalog',
            'getStadtwerkMauerRoleWorkbenchRows',
            'getStadtwerkMauerRoleOpenTargetRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerRoleWorkbenchRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-role-workbench-catalog',
          transformer: 'return data.roleRows || []',
        });
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerRoleOpenTargetRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-role-workbench-catalog',
          transformer: 'return data.openTargetRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining(['role_workbench_catalog', 'role_open_targets'])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Role Workbench Catalog binds to scalar role/open-target rows'
        );
      });
    });

    // -- stadtwerkMauerGridPlanningRoleQueueStatus ------------------------
    describe('stadtwerkMauerGridPlanningRoleQueueStatus', () => {
      it('returns a read-only ZNP role queue with scalar evidence-handover rows', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [
            { missingDataPoint: 'napReference' },
            { missingDataPoint: 'maloId' },
            { missingDataPoint: 'meloId' },
          ],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call(
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
          }
        );

        expect(result.capabilityKey).toBe('stadtwerk_mauer_grid_planning_role_queue');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('grid_planning_role_queue_needs_nap_clarification');
        expect(result.roleKey).toBe('grid-planning');
        expect(result.blueprintRoleKey).toBe('ROLE_NETZPLANUNG');
        expect(result.queueRows).toHaveLength(1);
        expect(result.queueRows[0]).toMatchObject({
          queueItemId: 'grid-planning:missing-nap-clarification',
          roleKey: 'grid-planning',
          blueprintRoleKey: 'ROLE_NETZPLANUNG',
          status: 'needs_nap_clarification',
          nextGate: 'resolve_missing_nap_reference',
          allowedActionClass: 'read_verify_status_only',
        });
        expect(result.evidenceHandoverRows.map((row) => row.evidenceId)).toEqual(
          expect.arrayContaining([
            'napReference',
            'maloId',
            'meloId',
            'meterId',
            'customerConsentStatus',
          ])
        );
        expect(
          result.evidenceHandoverRows.find((row) => row.evidenceId === 'napReference')
        ).toMatchObject({
          status: 'clarification',
          present: false,
          required: true,
          roleKey: 'grid-planning',
          nextGate: 'resolve_missing_nap_reference',
        });
        expectScalarTableRows(result.queueRows);
        expectScalarTableRows(result.evidenceHandoverRows);
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.summary.budibaseBoundary).toContain('Cernion remains the system of record');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.system_of_record',
            'budibase.automation.arbitrary_write',
            'role.assignment.write',
            'case.edit',
            'grid-capacity.calculate',
            'public-context.mutate',
            'sandbox-runtime.mutate',
            'rundeck.job.execute',
            'operations-runbook.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe empty queue rows outside the sandbox tenant', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          {
            tenantId: 'other-tenant',
            caseId: 'smm-budibase-workbench',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('grid_planning_role_queue_blocked_outside_sandbox_tenant');
        expect(result.queueRows).toEqual([]);
        expect(result.evidenceHandoverRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'role.assignment.write',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe empty queue rows for unknown sandbox cases', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'unknown-case',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('grid_planning_role_queue_not_found');
        expect(result.queueRows).toEqual([]);
        expect(result.evidenceHandoverRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_case_scope'
        );
      });

      it('binds the Budibase manifest to grid-planning scalar queue and handover rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerGridPlanningRoleQueue',
            'getStadtwerkMauerGridPlanningQueueRows',
            'getStadtwerkMauerGridPlanningEvidenceHandoverRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerGridPlanningQueueRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-grid-planning-role-queue',
          transformer: 'return data.queueRows || []',
        });
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerGridPlanningEvidenceHandoverRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-grid-planning-role-queue',
          transformer: 'return data.evidenceHandoverRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining(['grid_planning_role_queue', 'grid_planning_evidence_handover'])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Zielnetzplanung Role Queue binds to scalar queue and evidence-handover rows'
        );
      });
    });

    // -- stadtwerkMauerGridPlanningSelectedItemDetailStatus ---------------
    describe('stadtwerkMauerGridPlanningSelectedItemDetailStatus', () => {
      it('returns scalar selected-item detail, evidence gaps and next-gate rows', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [
            { missingDataPoint: 'napReference' },
            { missingDataPoint: 'maloId' },
            { missingDataPoint: 'meloId' },
          ],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call(
          'dashboard-api.stadtwerkMauerGridPlanningSelectedItemDetailStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            queueItemId: 'grid-planning:missing-nap-clarification',
          }
        );

        expect(result.capabilityKey).toBe('stadtwerk_mauer_grid_planning_selected_item_detail');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('grid_planning_selected_item_needs_evidence');
        expect(result.itemSummaryRows).toHaveLength(1);
        expect(result.itemSummaryRows[0]).toMatchObject({
          queueItemId: 'grid-planning:missing-nap-clarification',
          status: 'grid_planning_selected_item_needs_evidence',
          itemStatus: 'needs_nap_clarification',
          nextGate: 'resolve_missing_nap_reference',
          advisoryBoundary: 'read_only_advisory_context_no_capacity_approval',
        });
        expect(result.contextRows.map((row) => row.contextKey)).toEqual(
          expect.arrayContaining(['controlCase', 'publicContextHint', 'syntheticTenantSeed'])
        );
        expect(result.evidenceGapRows.map((row) => row.evidenceId)).toEqual(
          expect.arrayContaining(['napReference', 'maloId', 'meloId'])
        );
        expect(result.nextGateRows[0]).toMatchObject({
          gateId: 'resolve_missing_nap_reference',
          ownerRole: 'grid-planning',
          capacityCommitment: 'not_binding',
          productionApproval: 'not_granted',
        });
        expect(result.safeFollowUpRows.map((row) => row.missingDataPoint)).toContain(
          'napReference'
        );
        expectScalarTableRows(result.itemSummaryRows);
        expectScalarTableRows(result.contextRows);
        expectScalarTableRows(result.evidenceGapRows);
        expectScalarTableRows(result.nextGateRows);
        expectScalarTableRows(result.safeFollowUpRows);
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.selected_row.write',
            'grid-planning.approve-capacity',
            'grid-planning.commit-plan',
            'grid-capacity.calculate',
            'public-context.mutate',
            'device-control.execute',
            'external.connector.call',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe empty selected-item rows for unknown queue items', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerGridPlanningSelectedItemDetailStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            queueItemId: 'unknown-item',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('grid_planning_selected_item_not_found');
        expect(result.itemSummaryRows).toEqual([]);
        expect(result.contextRows).toEqual([]);
        expect(result.nextGateRows[0]).toMatchObject({
          gateId: 'select_valid_grid_planning_item',
          allowedActionClass: 'read_only_selection_only',
        });
        expectScalarTableRows(result.evidenceGapRows);
      });

      it('returns safe empty selected-item rows outside the sandbox tenant', async () => {
        const result = await broker.call(
          'dashboard-api.stadtwerkMauerGridPlanningSelectedItemDetailStatus',
          {
            tenantId: 'other-tenant',
            caseId: 'smm-budibase-workbench',
            queueItemId: 'grid-planning:missing-nap-clarification',
          }
        );

        expect(result.found).toBe(false);
        expect(result.status).toBe('grid_planning_selected_item_blocked_outside_sandbox_tenant');
        expect(result.itemSummaryRows).toEqual([]);
        expect(result.contextRows).toEqual([]);
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining(['budibase.table.write', 'budibase.selected_row.write'])
        );
      });

      it('binds the Budibase manifest to selected-item scalar detail rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerGridPlanningSelectedItemDetail',
            'getStadtwerkMauerGridPlanningSelectedItemSummaryRows',
            'getStadtwerkMauerGridPlanningSelectedItemContextRows',
            'getStadtwerkMauerGridPlanningSelectedItemEvidenceGapRows',
            'getStadtwerkMauerGridPlanningSelectedItemNextGateRows',
            'getStadtwerkMauerGridPlanningSelectedItemSafeFollowUpRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerGridPlanningSelectedItemSummaryRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-grid-planning-selected-item-detail',
          transformer: 'return data.itemSummaryRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'grid_planning_selected_item_summary',
            'grid_planning_selected_item_context',
            'grid_planning_selected_item_gaps',
            'grid_planning_selected_item_next_gate',
            'grid_planning_selected_item_followups',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Selected Zielnetzplanung Item binds to scalar summary'
        );
      });
    });

    // -- stadtwerkMauerSalesWorkbenchBriefingStatus ----------------------
    describe('stadtwerkMauerSalesWorkbenchBriefingStatus', () => {
      it('returns read-only Vertrieb briefing rows with safe claims and open gaps separated', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [
            { missingDataPoint: 'napReference' },
            { missingDataPoint: 'maloId' },
            { missingDataPoint: 'meloId' },
          ],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call(
          'dashboard-api.stadtwerkMauerSalesWorkbenchBriefingStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            audience: 'vertrieb',
          }
        );

        expect(result.capabilityKey).toBe('stadtwerk_mauer_sales_workbench_briefing');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('sales_briefing_ready_with_open_gaps');
        expect(result.audience).toBe('vertrieb');
        expect(result.briefingRows.length).toBeGreaterThanOrEqual(4);
        expect(result.claimRows.map((row) => row.topicKey)).toEqual(
          expect.arrayContaining([
            'demo_scope',
            'case_evidence',
            'znp_handover',
            'commercial_value',
          ])
        );
        expect(result.claimRows.find((row) => row.topicKey === 'demo_scope')).toMatchObject({
          claimStatus: 'evidence_backed',
          evidenceStatus: 'available',
        });
        expect(result.claimRows.find((row) => row.topicKey === 'commercial_value')).toMatchObject({
          claimStatus: 'not_yet_claimable',
          openGap: 'municipal_energy_value_analysis',
        });
        expect(result.gapRows.map((row) => row.gapKey)).toEqual(
          expect.arrayContaining(['napReference', 'maloId', 'meloId', 'commercial_value'])
        );
        expect(
          result.followUpRows.find((row) => row.topicKey === 'commercial_value')
        ).toMatchObject({
          enablesSafeClaim: 'after_gap_resolution',
        });
        expectScalarTableRows(result.briefingRows);
        expectScalarTableRows(result.claimRows);
        expectScalarTableRows(result.evidenceRows);
        expectScalarTableRows(result.gapRows);
        expectScalarTableRows(result.followUpRows);
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.summary.claimBoundary).toContain('not-yet-claimable');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'crm.customer.create',
            'customer-master.write',
            'claim.generate.llm',
            'offer.create',
            'customer.communication.send',
            'budibase.table.write',
            'budibase.system_of_record',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'tariff.mutate',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe fallback rows for unsupported audiences and outside tenants', async () => {
        const unsupportedAudience = await broker.call(
          'dashboard-api.stadtwerkMauerSalesWorkbenchBriefingStatus',
          {
            tenantId: 'stadtwerk-mauer',
            caseId: 'smm-budibase-workbench',
            audience: 'press',
          }
        );

        expect(unsupportedAudience.found).toBe(false);
        expect(unsupportedAudience.status).toBe('sales_briefing_unsupported_audience');
        expect(unsupportedAudience.briefingRows).toEqual([]);
        expect(unsupportedAudience.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'supported_sales_audience'
        );

        const outsideTenant = await broker.call(
          'dashboard-api.stadtwerkMauerSalesWorkbenchBriefingStatus',
          {
            tenantId: 'other-tenant',
            caseId: 'smm-budibase-workbench',
          }
        );

        expect(outsideTenant.found).toBe(false);
        expect(outsideTenant.status).toBe('sales_briefing_blocked_outside_sandbox_tenant');
        expect(outsideTenant.briefingRows).toEqual([]);
        expect(outsideTenant.claimRows).toEqual([]);
        expect(outsideTenant.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(outsideTenant.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'crm.customer.create',
            'budibase.table.write',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to Vertrieb scalar briefing rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerSalesWorkbenchBriefing',
            'getStadtwerkMauerSalesBriefingRows',
            'getStadtwerkMauerSalesClaimRows',
            'getStadtwerkMauerSalesEvidenceRows',
            'getStadtwerkMauerSalesGapRows',
            'getStadtwerkMauerSalesFollowUpRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerSalesBriefingRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-sales-workbench-briefing',
          transformer: 'return data.briefingRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'sales_briefing',
            'sales_claims',
            'sales_evidence',
            'sales_gaps',
            'sales_followups',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Vertrieb Briefing binds to scalar evidence-backed claim'
        );
      });
    });

    // -- stadtwerkMauerWorkbenchLandingStatus -----------------------------
    describe('stadtwerkMauerWorkbenchLandingStatus', () => {
      it('returns presenter-ready landing rows with scalar section and action cues', async () => {
        handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
          capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
          safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
          tenantId: 'stadtwerk-mauer',
          requiredTenantId: 'stadtwerk-mauer',
          sandboxBoundaryAllowed: true,
          status: 'e2e_demo_trace_needs_evidence',
          demoPath: 'pv_registration_electrician_missing_nap',
          caseId: 'smm-budibase-workbench',
          traceCount: 1,
          artifactCount: 3,
          recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
          evidenceQuality: 'incomplete_demo_evidence',
          missingEvidence: [{ missingDataPoint: 'napReference' }],
          positiveFollowUps: [{ missingDataPoint: 'napReference' }],
          sourceActions: {
            inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
            referenced: ['object-store.query'],
            notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
          },
        });

        const result = await broker.call('dashboard-api.stadtwerkMauerWorkbenchLandingStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.capabilityKey).toBe('stadtwerk_mauer_workbench_landing');
        expect(result.safety).toBe('read_only');
        expect(result.found).toBe(true);
        expect(result.status).toBe('workbench_landing_presenter_ready');
        expect(result.title).toBe('Stadtwerk Mauer Demo Workbench');
        expect(result.summary.safePresenterAction).toBe('Open Workbench Hub');
        expect(result.landingRows.map((row) => row.rowKey)).toEqual(
          expect.arrayContaining([
            'demo_identity',
            'public_context',
            'tenant_seed',
            'workbench_sections',
            'grid_planning',
            'safe_actions',
          ])
        );
        expect(result.sectionRows.map((row) => row.sectionKey)).toEqual(
          expect.arrayContaining([
            'hub',
            'administrator_inventory',
            'selected_case_detail',
            'selected_case_actions',
            'role_workbench_catalog',
            'grid_planning_role_queue',
          ])
        );
        expect(result.presenterActionRows.map((row) => row.actionId)).toEqual(
          expect.arrayContaining(['presenter-open-hub', 'presenter-open-znp'])
        );
        expect(
          result.presenterActionRows.find((row) => row.actionId === 'presenter-open-znp')
        ).toMatchObject({
          riskClass: 'read_only',
          boundary: 'cernion-api',
          enabled: true,
          targetSection: 'grid_planning_role_queue',
        });
        expectScalarTableRows(result.landingRows);
        expectScalarTableRows(result.sectionRows);
        expectScalarTableRows(result.presenterActionRows);
        expect(result.capabilityBroker.exposed).toBe(false);
        expect(result.hydrationRegistry.exposed).toBe(false);
        expect(result.summary.budibaseBoundary).toContain('Cernion remains the system of record');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'budibase.system_of_record',
            'tenant.provision',
            'setup.execute',
            'reset.execute',
            'public-context.mutate',
            'operations-runbook.execute',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'device-control.execute',
            'external.connector.call',
            'hitl.create',
            'personal-agent.execute',
          ])
        );
      });

      it('returns safe empty landing rows outside the sandbox tenant', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerWorkbenchLandingStatus', {
          tenantId: 'other-tenant',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.found).toBe(false);
        expect(result.status).toBe('workbench_landing_blocked_outside_sandbox_tenant');
        expect(result.landingRows).toEqual([]);
        expect(result.sectionRows).toEqual([]);
        expect(result.presenterActionRows).toEqual([]);
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
          'stadtwerk_mauer_tenant_scope'
        );
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining([
            'budibase.table.write',
            'tenant.provision',
            'personal-agent.execute',
          ])
        );
      });

      it('binds the Budibase manifest to landing scalar rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerWorkbenchLanding',
            'getStadtwerkMauerWorkbenchLandingRows',
            'getStadtwerkMauerWorkbenchSectionRows',
            'getStadtwerkMauerWorkbenchPresenterActionRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerWorkbenchLandingRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-workbench-landing',
          transformer: 'return data.landingRows || []',
        });
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerWorkbenchPresenterActionRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-workbench-landing',
          transformer: 'return data.presenterActionRows || []',
        });
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.slice(0, 3).map((section) => section.id)
        ).toEqual(['landing_status', 'landing_sections', 'presenter_actions']);
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Workbench Landing binds to scalar landing/status'
        );
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

      it('adds scalar Budibase revalidation rows for public context and affected case', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerMastrDataOverlayStatus', {
          tenantId: 'stadtwerk-mauer',
          caseId: 'smm-budibase-workbench',
        });

        expect(result.publicContextRows.map((row) => row.sourceClass)).toEqual(
          expect.arrayContaining(['public_context_layer'])
        );
        expect(result.overlayAssetRows[0]).toMatchObject({
          sourceClass: 'public_context_layer',
          overlayClass: 'synthetic_tenant_seed',
          virtualGridOperatorName: 'Stadtwerk Mauer',
        });
        expect(result.revalidationRows[0]).toMatchObject({
          revalidationStatus: 'no_delta_observed',
          sourceClass: 'public_context_layer',
          affectedCaseId: 'smm-budibase-workbench',
        });
        expect(result.affectedCaseRows[0]).toMatchObject({
          sourceClass: 'synthetic_tenant_seed',
          impactStatus: 'public_context_current_for_demo',
        });
        expect(result.nextGateRows[0].gateKey).toBe('public_context_current_for_demo');
        expect(result.safeActionRows.map((row) => row.actionKey)).toEqual(
          expect.arrayContaining([
            'refresh_mastr_overlay_read_model',
            'view_selected_case_evidence',
          ])
        );
        expect(result.boundaryRows.map((row) => row.boundary)).toEqual(
          expect.arrayContaining(['mastr.write', 'external.connector.call'])
        );
        expectScalarTableRows(result.publicContextRows);
        expectScalarTableRows(result.overlayAssetRows);
        expectScalarTableRows(result.revalidationRows);
        expectScalarTableRows(result.affectedCaseRows);
        expectScalarTableRows(result.nextGateRows);
        expectScalarTableRows(result.safeActionRows);
        expectScalarTableRows(result.boundaryRows);
      });

      it('labels synthetic revalidation drills without presenting them as public MaStR changes', async () => {
        const result = await broker.call('dashboard-api.stadtwerkMauerMastrDataOverlayStatus', {
          tenantId: 'stadtwerk-mauer',
          revalidationMode: 'drill',
        });

        expect(result.revalidationRows[0]).toMatchObject({
          revalidationStatus: 'synthetic_revalidation_drill',
          sourceClass: 'synthetic_revalidation_drill',
        });
        expect(result.nextGateRows[0].gateKey).toBe(
          'review_public_context_delta_before_case_claim'
        );
        expect(result.affectedCaseRows[0].affectedByPublicContext).toBe(true);
        expect(result.sourceActions.notCalled).toContain('mastr.write');
      });

      it('binds the Budibase manifest to MaStR revalidation scalar rows', () => {
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
          expect.arrayContaining([
            'getStadtwerkMauerMastrPublicContextRows',
            'getStadtwerkMauerMastrOverlayAssetRows',
            'getStadtwerkMauerMastrRevalidationRows',
            'getStadtwerkMauerMastrAffectedCaseRows',
            'getStadtwerkMauerMastrNextGateRows',
            'getStadtwerkMauerMastrSafeActionRows',
            'getStadtwerkMauerMastrBoundaryRows',
          ])
        );
        expect(
          STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
            (query) => query.name === 'getStadtwerkMauerMastrRevalidationRows'
          )
        ).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/stadtwerk-mauer-mastr-data-overlay',
          transformer: 'return data.revalidationRows || []',
        });
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'mastr_public_context',
            'mastr_revalidation',
            'mastr_affected_case',
            'mastr_next_gate',
            'mastr_safe_actions',
            'mastr_boundaries',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'MaStR Revalidation binds to scalar public-context'
        );
      });
    });

    describe('stadtwerkMauerMunicipalValueWorkbenchManifest', () => {
      function runBudibaseTransformer(query, data) {
        return Function('data', query.transformer)(data);
      }

      it('binds the Budibase manifest to municipal peer-corridor scalar rows', async () => {
        const queryNames = STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name);
        expect(queryNames).toEqual(
          expect.arrayContaining([
            'getMunicipalValuePeerCorridorMauerSummaryRows',
            'getMunicipalValuePeerCorridorSandhausenSummaryRows',
            'getMunicipalValuePeerCorridorWieslochSummaryRows',
            'getMunicipalValuePeerCorridorRows',
            'getMunicipalValueNoAutarkyGuardrailRows',
            'getMunicipalValueMissingGateRows',
          ])
        );

        const mauerQuery = STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getMunicipalValuePeerCorridorMauerSummaryRows'
        );
        expect(mauerQuery).toMatchObject({
          method: 'GET',
          path: '/api/dashboard/municipal-energy-value-analysis',
          queryString: 'municipality={{municipality}}&year={{year}}&scenario={{scenario}}',
        });
        expect(mauerQuery.parameters).toEqual(
          expect.arrayContaining([
            { name: 'municipality', default: 'Mauer' },
            { name: 'year', default: '2025' },
            { name: 'scenario', default: 'baseline' },
          ])
        );

        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
          expect.arrayContaining([
            'municipal_value_mauer',
            'municipal_value_sandhausen',
            'municipal_value_wiesloch',
            'municipal_value_peer_rows',
            'municipal_value_guardrails',
            'municipal_value_missing_gates',
          ])
        );
        expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
          'Mauer, Sandhausen and Wiesloch'
        );

        const wiesloch = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
          municipality: 'Wiesloch',
          year: 2025,
          scenario: 'baseline',
        });
        const wieslochSummaryQuery = STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getMunicipalValuePeerCorridorWieslochSummaryRows'
        );
        const peerRowsQuery = STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getMunicipalValuePeerCorridorRows'
        );
        const guardrailRowsQuery = STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getMunicipalValueNoAutarkyGuardrailRows'
        );
        const missingGateRowsQuery = STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getMunicipalValueMissingGateRows'
        );

        const summaryRows = runBudibaseTransformer(wieslochSummaryQuery, wiesloch);
        expect(summaryRows.map((row) => row.rowKey)).toEqual(
          expect.arrayContaining([
            'municipality',
            'peer_corridor_status',
            'municipal_budget_effect',
            'operator_private_value',
            'derived_load_status',
            'safe_next_action',
          ])
        );
        expect(summaryRows.find((row) => row.rowKey === 'municipal_budget_effect')).toMatchObject({
          label: 'Direkter Haushaltseffekt',
          safeNextAction: 'keep_separate_from_operator_value',
        });
        expect(summaryRows.find((row) => row.rowKey === 'operator_private_value')).toMatchObject({
          label: 'Betreiber-/Privatwert',
          safeNextAction: 'do_not_present_as_municipal_cash_inflow',
        });
        expect(summaryRows.find((row) => row.rowKey === 'derived_load_status')).toMatchObject({
          evidenceStatus: 'derived-from-assets',
          safeNextAction: 'label_as_derived_not_measured',
        });
        expectScalarTableRows(summaryRows);

        const peerRows = runBudibaseTransformer(peerRowsQuery, wiesloch);
        expect(peerRows.length).toBeGreaterThan(0);
        expect(peerRows[0]).toHaveProperty('peerRange');
        expect(peerRows[0].safeNextAction).toBe('present_as_peer_corridor_not_autarky_claim');
        expectScalarTableRows(peerRows);

        const guardrailRows = runBudibaseTransformer(guardrailRowsQuery, wiesloch);
        expect(guardrailRows.map((row) => row.guardrail)).toEqual(
          expect.arrayContaining(['keine_haushaltsaequivalente_aus_mwh'])
        );
        expect(guardrailRows[0]).toMatchObject({
          status: 'not_public_claim',
          safeNextAction: 'show_eur_and_evidence_rows_only',
        });
        expectScalarTableRows(guardrailRows);

        const missingGateRows = runBudibaseTransformer(missingGateRowsQuery, wiesloch);
        expect(missingGateRows.map((row) => row.missingDataPoint)).toEqual(
          expect.arrayContaining(['vnb_bnr', 'mastr_live_data'])
        );
        expect(missingGateRows[0].safeNextAction).toBe('prepare_consulting_data_request');
        expectScalarTableRows(missingGateRows);
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

    // ── controllabilityDataAlignmentStatus ────────────────────────────────

    describe('controllabilityDataAlignmentStatus', () => {
      it('reports explicit data-alignment gaps without imports or downstream actions', async () => {
        const result = await broker.call('dashboard-api.controllabilityDataAlignmentStatus', {
          checklistId: 'check-407',
          assetId: 'asset-407',
          mastrId: 'SEE-407',
          assetMatch: 'matched',
          controlTechStatus: 'missing',
          thresholdClass: 'above-threshold',
          testability: 'not-testable',
          exceptionReason: 'fehlende-rueckmeldefaehigkeit',
          owner: 'Netzplanung',
        });

        expect(result.status).toBe('needs_owner_deadline');
        expect(result.checklist).toMatchObject({
          checklistId: 'check-407',
          assetId: 'asset-407',
          mastrId: 'SEE-407',
        });
        expect(result.alignmentRows.map((row) => row.id)).toEqual(
          expect.arrayContaining([
            'checklist_reference',
            'asset_mastr_match',
            'control_technology_status',
            'threshold_classification',
            'testability',
          ])
        );
        expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toEqual(
          expect.arrayContaining(['prior_year_comparison', 'owner_deadline', 'export_readiness'])
        );
        expect(result.safeNextGate).toBe('collect_control_technology_evidence');
        expect(result.positiveFollowUps[0].category).toBe('controllability_data_alignment');
        expect(result.sourceActions.notCalled).toEqual(
          expect.arrayContaining(['file.import', 'excel.parse', 'grid-operations.executeControl'])
        );
        expect(result.safety).toBe('read_only');
      });

      it('returns ready_for_evidence_export when all required alignment facts are supplied', async () => {
        const result = await broker.call('dashboard-api.controllabilityDataAlignmentStatus', {
          checklistId: 'check-407',
          assetId: 'asset-407',
          mastrId: 'SEE-407',
          assetMatch: 'matched',
          mastrMatch: 'matched',
          internalAssetMatch: 'matched',
          controlTechStatus: 'cls-ready',
          thresholdClass: 'above-threshold',
          testability: 'testable',
          priorYearComparison: 'changed',
          owner: 'Netzplanung',
          dueDate: '2026-09-30',
          exportReadiness: 'ready',
        });

        expect(result.status).toBe('ready_for_evidence_export');
        expect(result.missingEvidence).toEqual([]);
        expect(result.safeNextGate).toBe('export_dossier_package');
        expect(result.dossierEvidence.dossierFacts).toContain('Provided alignment rows: 8/9');
        expect(result.sourceActions.notCalled).toContain('external.connector.call');
      });
    });
  });

  // -- stadtwerkMauerCaseActionsStatus -----------------------------------
  describe('stadtwerkMauerCaseActionsStatus', () => {
    it('returns selected-case read/verify actions with scalar rows and no-call guards', async () => {
      handlers.stadtwerkMauerE2eProcessDemoStatus = () => ({
        capabilityKey: 'stadtwerk_mauer_e2e_process_demo',
        safety: 'sandbox_only_non_consequential_e2e_demo_with_read_only_status',
        tenantId: 'stadtwerk-mauer',
        requiredTenantId: 'stadtwerk-mauer',
        sandboxBoundaryAllowed: true,
        status: 'e2e_demo_trace_needs_evidence',
        demoPath: 'pv_registration_electrician_missing_nap',
        caseId: 'smm-budibase-workbench',
        traceCount: 1,
        artifactCount: 3,
        recentTraces: [{ traceId: 'smm-e2e-trace:test', status: 'demo_trace_needs_evidence' }],
        evidenceQuality: 'incomplete_demo_evidence',
        missingEvidence: [
          { missingDataPoint: 'napReference' },
          { missingDataPoint: 'customerConsentStatus' },
        ],
        positiveFollowUps: [{ missingDataPoint: 'napReference' }],
        sourceActions: {
          inspected: ['stadtwerk-mauer-e2e-process-demo.getStatus'],
          referenced: ['object-store.query'],
          notCalled: ['mako.dispatch', 'external.connector.call', 'personal-agent.execute'],
        },
      });

      const result = await broker.call('dashboard-api.stadtwerkMauerCaseActionsStatus', {
        tenantId: 'stadtwerk-mauer',
        caseId: 'smm-budibase-workbench',
      });

      expect(result.capabilityKey).toBe('stadtwerk_mauer_case_actions');
      expect(result.safety).toBe('read_only_verify_only');
      expect(result.found).toBe(true);
      expect(result.status).toBe('case_actions_ready_with_evidence_gaps');
      expect(result.availableActions.map((action) => action.actionId)).toEqual(
        expect.arrayContaining([
          'refresh_read_model',
          'verify_blueprint_seed',
          'validate_evidence_completeness',
        ])
      );
      expect(
        result.actionRows.find((row) => row.actionId === 'verify_blueprint_seed')
      ).toMatchObject({
        method: 'GET',
        riskClass: 'read_verify_only',
        requiredScope: 'runbook:read',
        enabled: true,
      });
      expect(
        result.actionRows.find((row) => row.actionId === 'validate_evidence_completeness')
      ).toMatchObject({
        nextGate: 'resolve_missing_evidence',
        evidenceStatus: 'evidence_gaps_present',
      });
      expectScalarTableRows(result.actionRows);
      expect(result.processActionRows.map((row) => row.actionId)).toEqual(
        expect.arrayContaining([
          'refresh_read_model',
          'verify_blueprint_seed',
          'validate_evidence_completeness',
          'run_e2e_smoke',
          'setup_reset_or_provision',
        ])
      );
      expect(
        result.processActionRows.find((row) => row.actionId === 'verify_blueprint_seed')
      ).toMatchObject({
        boundary: 'cernion-api',
        executionMode: 'read_verify_only',
        enabled: true,
      });
      expect(
        result.processActionRows.find((row) => row.actionId === 'run_e2e_smoke')
      ).toMatchObject({
        boundary: 'rundeck-runbook',
        enabled: false,
        lastResultStatus: 'not_called_by_budibase',
      });
      expect(
        result.processActionRows.find((row) => row.actionId === 'setup_reset_or_provision')
      ).toMatchObject({
        riskClass: 'blocked_mutating_operation',
        enabled: false,
      });
      expectScalarTableRows(result.processActionRows);
      expect(
        result.lastResultRows.find((row) => row.actionId === 'validate_evidence_completeness')
      ).toMatchObject({
        lastResultStatus: 'evidence_gaps_present',
        mutationGuard: 'read_only_no_execution',
      });
      expectScalarTableRows(result.lastResultRows);
      expect(result.boundaryRows.map((row) => row.boundary)).toEqual(
        expect.arrayContaining(['budibase-ui-near', 'cernion-api', 'rundeck-runbook'])
      );
      expectScalarTableRows(result.boundaryRows);
      expect(result.requiredEvidenceRows.map((row) => row.evidenceKey)).toEqual(
        expect.arrayContaining(['napReference', 'customerConsentStatus'])
      );
      expectScalarTableRows(result.requiredEvidenceRows);
      expect(result.budibaseAutomationHints.map((hint) => hint.actionId)).toEqual(
        expect.arrayContaining([
          'refresh_read_model',
          'verify_blueprint_seed',
          'validate_evidence_completeness',
        ])
      );
      expect(result.rundeckBoundary[0]).toMatchObject({
        boundaryId: 'operations_runbook_verify_only',
      });
      expect(result.capabilityBroker.exposed).toBe(false);
      expect(result.hydrationRegistry.exposed).toBe(false);
      expect(result.summary.budibaseBoundary).toContain('Cernion remains the command gate');
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining([
          'budibase.table.write',
          'budibase.automation.arbitrary_write',
          'rundeck.job.execute',
          'operations-runbook.setup',
          'operations-runbook.reset',
          'operations-runbook.provision',
          'operations-runbook.e2e_smoke.execute',
          'public-context.mutate',
          'production.mutate',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'device-control.execute',
          'external.connector.call',
          'hitl.create',
          'personal-agent.execute',
        ])
      );
      expect(result.forbiddenActions).toEqual(
        expect.arrayContaining(['arbitrary_budibase_table_write', 'budibase.table.write'])
      );
    });

    it('returns safe empty action rows outside the sandbox tenant', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerCaseActionsStatus', {
        tenantId: 'other-tenant',
        caseId: 'smm-budibase-workbench',
      });

      expect(result.found).toBe(false);
      expect(result.status).toBe('case_actions_blocked_outside_sandbox_tenant');
      expect(result.availableActions).toEqual([]);
      expect(result.actionRows).toEqual([]);
      expect(result.processActionRows).toEqual([]);
      expect(result.lastResultRows).toEqual([]);
      expect(result.boundaryRows).toEqual([]);
      expect(result.requiredEvidenceRows).toEqual([]);
      expect(result.budibaseAutomationHints).toEqual([]);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
        'stadtwerk_mauer_tenant_scope'
      );
      expect(result.sourceActions.notCalled).toEqual(
        expect.arrayContaining(['budibase.table.write', 'personal-agent.execute'])
      );
    });

    it('returns safe empty action rows for unknown sandbox cases', async () => {
      const result = await broker.call('dashboard-api.stadtwerkMauerCaseActionsStatus', {
        tenantId: 'stadtwerk-mauer',
        caseId: 'unknown-case',
      });

      expect(result.found).toBe(false);
      expect(result.status).toBe('case_actions_not_found');
      expect(result.availableActions).toEqual([]);
      expect(result.actionRows).toEqual([]);
      expect(result.processActionRows).toEqual([]);
      expect(result.lastResultRows).toEqual([]);
      expect(result.boundaryRows).toEqual([]);
      expect(result.requiredEvidenceRows).toEqual([]);
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
        'stadtwerk_mauer_case_scope'
      );
    });

    it('binds the Budibase manifest to selected-case scalar action rows', () => {
      expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.map((query) => query.name)).toEqual(
        expect.arrayContaining([
          'getStadtwerkMauerCaseActions',
          'getStadtwerkMauerCaseActionRows',
          'getStadtwerkMauerProcessActionRows',
          'getStadtwerkMauerProcessLastResultRows',
          'getStadtwerkMauerProcessBoundaryRows',
          'getStadtwerkMauerRequiredEvidenceRows',
        ])
      );
      expect(
        STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getStadtwerkMauerCaseActionRows'
        )
      ).toMatchObject({
        method: 'GET',
        path: '/api/dashboard/stadtwerk-mauer-case-actions',
        transformer: 'return data.actionRows || []',
      });
      expect(
        STADTWERK_MAUER_WORKBENCH_MANIFEST.queries.find(
          (query) => query.name === 'getStadtwerkMauerProcessActionRows'
        )
      ).toMatchObject({
        method: 'GET',
        path: '/api/dashboard/stadtwerk-mauer-case-actions',
        transformer: 'return data.processActionRows || []',
      });
      expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toContain(
        'case_actions'
      );
      expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.sections.map((section) => section.id)).toEqual(
        expect.arrayContaining([
          'process_panel_actions',
          'process_panel_last_results',
          'process_panel_boundaries',
          'process_panel_required_evidence',
        ])
      );
      expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
        'Selected-case action rows are curated read-only/verify-only button metadata'
      );
      expect(STADTWERK_MAUER_WORKBENCH_MANIFEST.notes.join(' ')).toContain(
        'Demo Process Panel rows show safe verify actions'
      );
    });
  });

  // -- municipalEnergyValueAnalysisStatus ------------------------------------
  describe('municipalEnergyValueAnalysisStatus', () => {
    it('returns HTTP 200 Lagebild for Mauer baseline with required top-level fields', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.capabilityKey).toBe('municipal_energy_value_analysis');
      expect(result.status).toBe('lagebild_partial');
      expect(result.municipality).toBe('Mauer');
      expect(result.ags).toBe('08226048');
      expect(result.year).toBe(2025);
      expect(result.scenario).toBe('baseline');
      expect(typeof result.analysisRunId).toBe('string');
      expect(result.analysisRunId).toContain('08226048');
      expect(Array.isArray(result.valueRows)).toBe(true);
      expect(Array.isArray(result.riskRows)).toBe(true);
      expect(Array.isArray(result.budgetImpactRows)).toBe(true);
      expect(Array.isArray(result.flexibilityScenarioRows)).toBe(true);
      expect(Array.isArray(result.energySharingCommunityRows)).toBe(true);
      expect(Array.isArray(result.assumptionRows)).toBe(true);
      expect(Array.isArray(result.sourceRows)).toBe(true);
      expect(Array.isArray(result.missingEvidence)).toBe(true);
      expect(Array.isArray(result.positiveFollowUps)).toBe(true);
      expect(Array.isArray(result.noCallGuards)).toBe(true);
      expect(Array.isArray(result._errors)).toBe(true);
      expect(typeof result.timestamp).toBe('string');
    });

    it('returns scalar/display-safe valueRows for Wiesloch with no nested objects', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.valueRows.length).toBeGreaterThanOrEqual(2);
      expectScalarTableRows(result.valueRows);

      const pvRow = result.valueRows.find((r) => r.rowKey === 'pv_generation_value');
      expect(pvRow).toBeDefined();
      expect(pvRow.technology).toBe('pv');
      expect(typeof pvRow.installedCapacityKw).toBe('number');
      expect(typeof pvRow.estimatedGenerationKwhPerYear).toBe('number');
      expect(typeof pvRow.grossMarketValueEurPerYear).toBe('number');
      expect(pvRow.evidenceStatus).toBe('assumption-backed');

      const captureRow = result.valueRows.find((r) => r.rowKey === 'local_value_capture_indicator');
      expect(captureRow).toBeDefined();
      // Wiesloch has population → derived load profile → correlation available (#332)
      expect(captureRow.evidenceStatus).toBe('derived-from-assets');
      expect(typeof captureRow.localValueCaptureEur).toBe('number');
    });

    it('returns scalar/display-safe riskRows with required fields including EWK and iMSys proxy risks', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.riskRows.length).toBeGreaterThanOrEqual(3);
      expectScalarTableRows(result.riskRows);

      for (const row of result.riskRows) {
        expect(typeof row.riskKey).toBe('string');
        expect(typeof row.riskLabel).toBe('string');
        expect(['low', 'medium', 'high']).toContain(row.severity);
        expect(typeof row.severityScore).toBe('number');
        expect(typeof row.evidenceStatus).toBe('string');
        expect(typeof row.sourceLabel).toBe('string');
        expect(typeof row.assumptionLabel).toBe('string');
        expect(typeof row.nextGateLabel).toBe('string');
      }

      expect(result.riskRows.map((r) => r.riskKey)).toEqual(
        expect.arrayContaining([
          'ewk_anschlussdauer_risk',
          'imsys_smgw_rollout_readiness_risk',
          'grid_capacity_constraint_risk',
        ])
      );
    });

    it('mirrors the responsible VNBdigital grid operator and keeps benchmark evidence separate', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.gridOperatorName).toBe('Netze BW GmbH');
      expect(result.gridOperatorVnbdigitalId).toBe('7214');
      expect(result.gridOperatorEvidenceStatus).toBe('available');
      expect(result.missingEvidence.map((g) => g.missingDataPoint)).toContain('vnb_bnr');

      const risk = result.riskRows.find((r) => r.riskKey === 'ewk_anschlussdauer_risk');
      expect(risk.gridOperatorName).toBe('Netze BW GmbH');
      expect(risk.sourceLabel).toContain('Netze BW GmbH');
      expect(risk.nextGateLabel).toContain('Netze BW GmbH');
      expect(risk.assumptionLabel).toContain('Benchmark');

      const source = result.sourceRows.find((r) => r.sourceKey === 'vnbdigital_operator_identity');
      expect(source).toBeDefined();
      expect(source.evidenceStatus).toBe('available');
      expect(source.sourceLabel).toContain('Netze BW GmbH');
    });

    // Reported live: municipality-energy-value-analysis?municipality=Berlin/Hamburg
    // hung 30-60s with no response at all (HTTP:000) — safeCall() had no
    // timeout, so a slow/hanging grid-operations.vnbdigitalLookup call blocked
    // the whole endpoint for as long as the underlying MCP transport allowed.
    it('degrades gracefully instead of hanging when vnbdigitalLookup is slow', async () => {
      handlers['vnbdigitalLookup'] = () =>
        new Promise((resolve) => {
          const t = setTimeout(() => resolve(MOCK_VNBDIGITAL_LOOKUP), 60000);
          if (t.unref) t.unref(); // don't keep the Jest process alive past this test
        });

      const startedAt = Date.now();
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(20000); // bounded well under the 60s mock delay
      expect(result.gridOperatorName).toBeNull();
      expect(result.gridOperatorEvidenceStatus).toBe('missing-evidence');
      const source = result.sourceRows.find((r) => r.sourceKey === 'vnbdigital_operator_identity');
      expect(source.evidenceStatus).toBe('missing-evidence');
    }, 25000);

    it('returns scalar/display-safe budgetImpactRows with Konzessionsabgabe for Mauer', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.budgetImpactRows.length).toBeGreaterThanOrEqual(1);
      expectScalarTableRows(result.budgetImpactRows);

      const kavRow = result.budgetImpactRows.find((r) => r.budgetCategory === 'konzessionsabgabe');
      expect(kavRow).toBeDefined();
      expect(kavRow.assumptionStatus).toBeDefined();
      expect(kavRow.evidenceStatus).toMatch(/assumption-backed|scenario-based/);
      expect(kavRow.sourceLabel).toContain('KAV');

      const totalRow = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_total_estimate'
      );
      expect(totalRow).toBeDefined();
      expect(typeof totalRow.estimatedEurPerYear).toBe('number');
      expect(totalRow.calculationStatus).toBe('assumption-scenario');
    });

    it('runs the same generic path for Heidelberg and surfaces evidence gaps', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Heidelberg',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.status).toBe('lagebild_partial');
      expect(result.municipality).toBe('Heidelberg');
      expect(result.ags).toBe('08221000');
      expectScalarTableRows(result.valueRows);
      expectScalarTableRows(result.riskRows);
      expectScalarTableRows(result.budgetImpactRows);

      expect(result.missingEvidence.map((g) => g.missingDataPoint)).toContain('vnb_bnr');
      expect(result.missingEvidence.map((g) => g.missingDataPoint)).toContain('mastr_live_data');
    });

    it('resolves municipality by AGS when municipality name is not supplied', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        ags: '08226048',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.municipality).toBe('Mauer');
      expect(result.ags).toBe('08226048');
    });

    it('returns stable 200 for unknown municipality with missing-evidence markers (no crash)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Unbekannthausen',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.status).toBe('lagebild_municipality_unresolved');
      expect(result.municipality).toBe('Unbekannthausen');
      expect(result._errors).toEqual([]);
      expect(result.valueRows.length).toBeGreaterThanOrEqual(1);
      expect(result.valueRows[0].evidenceStatus).toBe('missing-evidence');
      expect(result.budgetImpactRows[0].estimatedEurPerYear).toBeNull();
      expectScalarTableRows(result.valueRows);
      expectScalarTableRows(result.riskRows);
      expectScalarTableRows(result.budgetImpactRows);
    });

    it('applies scenario to market price assumptions (high-price scenario)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'high-price',
      });

      const pvRow = result.valueRows.find((r) => r.rowKey === 'pv_generation_value');
      expect(pvRow.assumedMarketPriceEurPerMwh).toBe(110);
      expect(pvRow.grossMarketValueEurPerYear).toBeGreaterThan(0);
    });

    it('does not expose mutation actions in noCallGuards', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.noCallGuards).toEqual(
        expect.arrayContaining([
          'billing.settlement',
          'mako.dispatch',
          'budibase.table.write',
          'personal-agent.execute',
          'rundeck.job.execute',
          'device-control.execute',
          'smgw.control',
          'building-permit.approve',
          'subsidy.grant',
          'energy-sharing.allocate',
          'energy-sharing.contract.sign',
          'energy-sharing.billing.execute',
          'external.data.export.unrestricted',
        ])
      );
    });

    it('returns empty _errors for Mauer baseline (no upstream calls needed)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result._errors).toEqual([]);
    });

    it('resolves Wiesloch by municipality name with non-null AGS and non-empty scalar rows', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.status).toBe('lagebild_partial');
      expect(result.municipality).toBe('Wiesloch');
      expect(result.ags).toBe('08226098');
      expect(result.valueRows.length).toBeGreaterThan(0);
      expect(result.riskRows.length).toBeGreaterThan(0);
      expect(result.budgetImpactRows.length).toBeGreaterThan(0);
      expect(result.assumptionRows.length).toBeGreaterThan(0);
      expect(result.sourceRows.length).toBeGreaterThan(0);
      expectScalarTableRows(result.valueRows);
      expectScalarTableRows(result.riskRows);
      expectScalarTableRows(result.budgetImpactRows);

      const pvRow = result.valueRows.find((r) => r.rowKey === 'pv_generation_value');
      expect(pvRow).toBeDefined();
      expect(pvRow.installedCapacityKw).toBe(7200);
      expect(pvRow.evidenceStatus).toBe('assumption-backed');
    });

    it('resolves Wiesloch by PLZ 69168', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69168',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.municipality).toBe('Wiesloch');
      expect(result.ags).toBe('08226098');
      expect(result.status).toBe('lagebild_partial');
      expect(result.valueRows.length).toBeGreaterThan(0);
      expectScalarTableRows(result.valueRows);
    });

    it('resolves Mauer by PLZ 69256 (regression)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69256',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.municipality).toBe('Mauer');
      expect(result.ags).toBe('08226048');
    });

    it('resolves Heidelberg by PLZ 69115 (regression)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69115',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.municipality).toBe('Heidelberg');
      expect(result.ags).toBe('08221000');
    });

    it('Wiesloch budgetImpactRows use KAV-capped tariff and lower special-customer proxy rates', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      const hhRow = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_ns_haushalt'
      );
      expect(hhRow).toBeDefined();
      expect(typeof hhRow.estimatedEurPerYear).toBe('number');
      expect(hhRow.estimatedEurPerYear).toBeGreaterThan(0);
      expect(hhRow.assumptionStatus).toContain('1.59');
      expect(hhRow.assumedKavCtPerKwh).toBe(1.59);

      const commercialRow = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_ns_gewerbe'
      );
      expect(commercialRow).toBeDefined();
      expect(commercialRow.assumptionStatus).toContain('0.11');
      expect(commercialRow.estimatedEurPerYear).toBeLessThan(hhRow.estimatedEurPerYear);

      const totalRow = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_total_estimate'
      );
      expect(totalRow).toBeDefined();
      expect(typeof totalRow.estimatedEurPerYear).toBe('number');
      expect(totalRow.estimatedEurPerYear).toBeGreaterThan(0);
      expect(totalRow.estimatedEurPerYear).toBeLessThan(500000);
      expect(totalRow.estimatedKavEurPerMwh).toBeLessThanOrEqual(15.9);
      expect(totalRow.assumptionStatus).toContain('KAV-Sätze');
    });

    it('Stuttgart uses the >500k KAV tariff and an internally consistent total concession range', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Stuttgart',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.municipality).toBe('Stuttgart');
      expect(result.population).toBeGreaterThan(500000);
      expect(result.kavCategory).toBe('Großstadt über 500.000 Einwohner');
      expect(result.kavRateNsCtPerKwh).toBe(2.39);

      const household = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_ns_haushalt'
      );
      const commercial = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_ns_gewerbe'
      );
      const total = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_total_estimate'
      );

      expect(household.assumedKavCtPerKwh).toBe(2.39);
      expect(commercial.assumedKavCtPerKwh).toBe(0.11);
      expect(total.estimatedLowEurPerYear).toBe(
        household.estimatedLowEurPerYear + commercial.estimatedLowEurPerYear
      );
      expect(total.estimatedHighEurPerYear).toBe(
        household.estimatedHighEurPerYear + commercial.estimatedHighEurPerYear
      );
      expect(total.estimatedKavEurPerMwh).toBeLessThan(23.9);
    });

    // ── Issue #330: time-series EUR correlation and no-autarky guardrails ──

    it('returns timeSeriesValueRows with required scalar fields and derived correlation values (#332)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(Array.isArray(result.timeSeriesValueRows)).toBe(true);
      expect(result.timeSeriesValueRows.length).toBeGreaterThan(0);
      expectScalarTableRows(result.timeSeriesValueRows);

      for (const row of result.timeSeriesValueRows) {
        expect(typeof row.rowKey).toBe('string');
        expect(typeof row.technology).toBe('string');
        expect(typeof row.timeWindow).toBe('string');
        // importExposureEur is null per-tech row; aggregate is in euroKpiRows (#332)
        expect(row.importExposureEur).toBeNull();
      }
      const pvTs = result.timeSeriesValueRows.find((r) => r.rowKey === 'ts_pv_annual');
      expect(pvTs).toBeDefined();
      expect(typeof pvTs.marketValueEur).toBe('number');
      expect(pvTs.marketValueEur).toBeGreaterThan(0);
      // Wiesloch has population → derived load profile available (#332)
      expect(pvTs.evidenceStatus).toBe('derived-from-assets');
      expect(typeof pvTs.localCorrelationValueEur).toBe('number');
      expect(pvTs.localCorrelationValueEur).toBeGreaterThan(0);
    });

    it('returns euroKpiRows with scalar EUR fields and derived-from-assets local capture (#332)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(Array.isArray(result.euroKpiRows)).toBe(true);
      expect(result.euroKpiRows.length).toBeGreaterThan(0);
      expectScalarTableRows(result.euroKpiRows);

      const grossKpi = result.euroKpiRows.find((r) => r.rowKey === 'euro_kpi_gross_market_value');
      expect(grossKpi).toBeDefined();
      expect(typeof grossKpi.valueEur).toBe('number');
      expect(grossKpi.valueEur).toBeGreaterThan(0);
      expect(grossKpi.evidenceStatus).toBe('assumption-backed');

      // Wiesloch has population → derived load profile → correlation available (#332)
      const captureKpi = result.euroKpiRows.find(
        (r) => r.rowKey === 'euro_kpi_local_value_capture'
      );
      expect(captureKpi).toBeDefined();
      expect(typeof captureKpi.valueEur).toBe('number');
      expect(captureKpi.valueEur).toBeGreaterThan(0);
      expect(captureKpi.evidenceStatus).toBe('derived-from-assets');

      // Import exposure derived from remaining demand (#332)
      const importKpi = result.euroKpiRows.find((r) => r.rowKey === 'euro_kpi_import_exposure');
      expect(importKpi).toBeDefined();
      expect(typeof importKpi.valueEur).toBe('number');
      expect(importKpi.evidenceStatus).toBe('derived-from-assets');

      const budgetKpi = result.euroKpiRows.find(
        (r) => r.rowKey === 'euro_kpi_municipal_budget_effect'
      );
      expect(budgetKpi).toBeDefined();
      expect(typeof budgetKpi.valueEur).toBe('number');
      expect(budgetKpi.valueEur).toBeGreaterThan(0);
    });

    it('exposes noAutarkyGuardrails forbidding household-equivalent claims', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      expect(Array.isArray(result.noAutarkyGuardrails)).toBe(true);
      expect(result.noAutarkyGuardrails).toEqual(
        expect.arrayContaining([
          'keine_autarkie_aussage_ohne_zeitreihen',
          'keine_haushaltsaequivalente_aus_mwh',
          'keine_lokale_versorgungsbehauptung_ohne_lastprofil',
          'kein_windpark_versorgt_x_haushalte',
        ])
      );
    });

    it('missingEvidence omits local_load_profile when derived profile available (#332)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      const gapKeys = result.missingEvidence.map((g) => g.missingDataPoint);
      // local_load_profile and generation_time_series are replaced by derived profile (#332)
      expect(gapKeys).not.toContain('local_load_profile');
      expect(gapKeys).not.toContain('generation_time_series');
      // structural and data-quality gaps remain
      expect(gapKeys).toContain('operator_locality');
      expect(gapKeys).toContain('local_tax_assumptions');
    });

    it('missingEvidence includes local_load_profile for unknown municipality (no derived profile)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Unbekannthausen',
        year: 2025,
        scenario: 'baseline',
      });

      const gapKeys = result.missingEvidence.map((g) => g.missingDataPoint);
      expect(gapKeys).toContain('local_load_profile');
      expect(gapKeys).toContain('generation_time_series');
    });

    it('wind fixture (Heidelberg) shows derived correlation and unmatched generation (#332)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Heidelberg',
        year: 2025,
        scenario: 'baseline',
      });

      expectScalarTableRows(result.timeSeriesValueRows);
      const windTs = result.timeSeriesValueRows.find((r) => r.rowKey === 'ts_wind_annual');
      expect(windTs).toBeDefined();
      // Heidelberg has population → derived profile → wind correlation available (#332)
      expect(windTs.evidenceStatus).toBe('derived-from-assets');
      expect(typeof windTs.localCorrelationValueEur).toBe('number');
      expect(windTs.localCorrelationValueEur).toBeGreaterThan(0);
      // substantial unmatched wind generation (low coincidence factor 0.46)
      expect(typeof windTs.unmatchedGenerationValueEur).toBe('number');
      expect(windTs.unmatchedGenerationValueEur).toBeGreaterThan(windTs.localCorrelationValueEur);
      // importExposureEur per-row stays null; aggregate in euroKpiRows
      expect(windTs.importExposureEur).toBeNull();
    });

    it('valueRows do not expose percentage autarky claims in any field value', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });

      for (const row of result.valueRows) {
        for (const [_key, value] of Object.entries(row)) {
          if (typeof value === 'string') {
            expect(value).not.toMatch(/\d+%\s*(bilanziell|autark|Deckung)/i);
            expect(value.toLowerCase()).not.toContain('versorgt');
            expect(value.toLowerCase()).not.toContain('haushaltsaequivalent');
          }
        }
      }
    });

    // ── Issue #332 — derived load profile rows ────────────────────────────

    it('Sandhausen returns derived load profile summary row with scalar fields (#332)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Sandhausen',
        year: 2025,
        scenario: 'baseline',
      });

      expect(Array.isArray(result.derivedLoadProfileRows)).toBe(true);
      expect(result.derivedLoadProfileRows.length).toBeGreaterThan(0);
      expectScalarTableRows(result.derivedLoadProfileRows);

      const summaryRow = result.derivedLoadProfileRows.find(
        (r) => r.rowKey === 'derived_load_summary'
      );
      expect(summaryRow).toBeDefined();
      expect(typeof summaryRow.totalAnnualKwh).toBe('number');
      expect(summaryRow.totalAnnualKwh).toBeGreaterThan(0);
      expect(typeof summaryRow.householdKwh).toBe('number');
      expect(typeof summaryRow.commercialKwh).toBe('number');
      expect(summaryRow.evidenceStatus).toBe('derived-from-assets');
      expect(summaryRow.confidence).toBe('low');
      expect(summaryRow.sectorEvidenceStatus).toBe('heuristic-fallback');
      expect(summaryRow.sectorEvidenceLabel).toContain('OSM-/MaStR-Sektorevidenz offen');
      expect(result.missingEvidence.map((gap) => gap.missingDataPoint)).toContain(
        'osm_mastr_sector_split'
      );
      expect(result.sectorEvidenceRows).toEqual([
        expect.objectContaining({
          rowKey: 'sector_split_evidence',
          evidenceStatus: 'heuristic-fallback',
          methodKey: 'population_density_sector_proxy',
        }),
      ]);
    });

    it('does not reuse the same commercial/public sector split for Leimen and Stuttgart', async () => {
      const leimen = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Leimen',
        year: 2025,
        scenario: 'baseline',
      });
      const stuttgart = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Stuttgart',
        year: 2025,
        scenario: 'baseline',
      });

      const leimenSummary = leimen.derivedLoadProfileRows.find(
        (r) => r.rowKey === 'derived_load_summary'
      );
      const stuttgartSummary = stuttgart.derivedLoadProfileRows.find(
        (r) => r.rowKey === 'derived_load_summary'
      );

      expect(leimenSummary.sectorModelLabel).toContain('Mittelstadt');
      expect(stuttgartSummary.sectorModelLabel).toContain('Metropolen');
      expect(leimenSummary.commercialFraction).toBeLessThan(stuttgartSummary.commercialFraction);
      expect(leimenSummary.publicFraction).toBeLessThan(stuttgartSummary.publicFraction);
    });

    it('Wiesloch derived load profile regression: non-null localCorrelationValueEur for PV and biomass (#332)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      const pvTs = result.timeSeriesValueRows.find((r) => r.rowKey === 'ts_pv_annual');
      const bioTs = result.timeSeriesValueRows.find((r) => r.rowKey === 'ts_biomass_annual');
      expect(pvTs).toBeDefined();
      expect(bioTs).toBeDefined();
      // biomass has higher coincidence factor (0.62) than PV (0.25)
      expect(bioTs.localCorrelationValueEur).toBeGreaterThan(pvTs.localCorrelationValueEur);
      const captureKpi = result.euroKpiRows.find(
        (r) => r.rowKey === 'euro_kpi_local_value_capture'
      );
      expect(typeof captureKpi.valueEur).toBe('number');
      expect(captureKpi.valueEur).toBeGreaterThan(0);
    });

    it('Wiesloch exposes storage/fNAV flexibility scenarios without claiming unverified storage inventory', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(Array.isArray(result.flexibilityScenarioRows)).toBe(true);
      expect(result.flexibilityScenarioRows.length).toBeGreaterThanOrEqual(4);
      expectScalarTableRows(result.flexibilityScenarioRows);

      const inventory = result.flexibilityScenarioRows.find(
        (r) => r.rowKey === 'existing_storage_context'
      );
      expect(inventory).toBeDefined();
      expect(inventory.existingStoragePowerKw).toBe(0);
      expect(inventory.existingStorageCapacityKWh).toBeNull();
      expect(inventory.storageEvidenceStatus).toBe('missing-evidence');
      expect(inventory.evidenceStatus).toBe('missing-evidence');
      expect(inventory.assumptionLabel).toContain('Kein Speicherbestand');

      const fnavScenario = result.flexibilityScenarioRows.find(
        (r) => r.rowKey === 'storage_flex_balanced'
      );
      expect(fnavScenario).toBeDefined();
      expect(fnavScenario.scenarioType).toBe('storage_flex_fnav');
      expect(fnavScenario.evidenceStatus).toBe('scenario-based');
      expect(fnavScenario.potentialLocalRetentionEurPerYear).toBeGreaterThan(0);
      expect(fnavScenario.sourceLabel).toContain('BNetzA FCA');

      const gapKeys = result.missingEvidence.map((g) => g.missingDataPoint);
      expect(gapKeys).toEqual(
        expect.arrayContaining([
          'storage_mastr_inventory',
          'fnav_capacity_window',
          'building_permit_fast_track_policy',
        ])
      );
    });

    it('Wiesloch exposes §42c Energy Sharing Community scenarios for municipal and mixed estates', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      expect(Array.isArray(result.energySharingCommunityRows)).toBe(true);
      expect(result.energySharingCommunityRows.length).toBeGreaterThanOrEqual(4);
      expectScalarTableRows(result.energySharingCommunityRows);

      const context = result.energySharingCommunityRows.find(
        (r) => r.rowKey === 'energy_sharing_42c_context'
      );
      expect(context).toBeDefined();
      expect(context.legalBasis).toBe('EnWG §42c');
      expect(context.eligibilityWindow).toContain('seit 01.06.2026');
      expect(context.eligibilityWindow).toContain('ab 01.06.2028');
      expect(context.communityModel).toContain('Reststrom');

      const municipal = result.energySharingCommunityRows.find(
        (r) => r.rowKey === 'energy_sharing_municipal_estates'
      );
      expect(municipal).toBeDefined();
      expect(municipal.scenarioType).toBe('municipal_estate_community');
      expect(municipal.municipalUseCase).toContain('Schule');
      expect(municipal.potentialLocalCirculationEurPerYear).toBeGreaterThan(0);
      expect(municipal.evidenceStatus).toBe('scenario-based');

      const mixed = result.energySharingCommunityRows.find(
        (r) => r.rowKey === 'energy_sharing_mixed_community'
      );
      expect(mixed).toBeDefined();
      expect(mixed.communityModel).toContain('Private und gewerbliche');
      expect(mixed.communityModel).toContain('KMU-Fähigkeit');

      const storage = result.energySharingCommunityRows.find(
        (r) => r.rowKey === 'energy_sharing_storage_enabled'
      );
      expect(storage).toBeDefined();
      expect(storage.municipalUseCase).toContain('Speicher');

      expect(result.sourceRows.map((r) => r.sourceKey)).toContain('enwg_42c_energy_sharing');
      expect(result.missingEvidence.map((g) => g.missingDataPoint)).toEqual(
        expect.arrayContaining([
          'energy_sharing_malo_metering',
          'energy_sharing_participant_contracts',
          'energy_sharing_reststrom_supplier',
          'energy_sharing_vnb_bilanzierungsgebiet',
        ])
      );
    });

    it('keeps concession assumptions PDF-friendly and abbreviated', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });

      const household = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_ns_haushalt'
      );
      expect(household).toBeDefined();
      expect(household.assumptionStatus).toContain('KAV-Kategorie');
      expect(household.assumptionStatus).not.toContain('Konzessionsabgabenverordnung');
    });

    // ── Issue #331 — real PLZ/name/AGS resolver ────────────────────────────

    it('resolves Rommerskirchen by name with non-null ags', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Rommerskirchen',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.status).toBe('lagebild_partial');
      expect(result.municipality).toBe('Rommerskirchen');
      expect(result.ags).toBe('05162028');
      expect(result._errors).toEqual([]);
    });

    it('resolves PLZ 41569 to Rommerskirchen as first deterministic hit', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '41569',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.municipality).toBe('Rommerskirchen');
      expect(result.ags).toBe('05162028');
      expect(result.status).toBe('lagebild_partial');
    });

    it('Rommerskirchen valueRows are scalar and contain no [object Object]', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Rommerskirchen',
        year: 2025,
        scenario: 'baseline',
      });
      expectScalarTableRows(result.valueRows);
      expectScalarTableRows(result.budgetImpactRows);
      expectScalarTableRows(result.riskRows);
    });

    it('Rommerskirchen budgetImpactRows use KAV 1.32 ct/kWh (< 25k Einwohner bracket, EWZ 13.580)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Rommerskirchen',
        year: 2025,
        scenario: 'baseline',
      });
      const nsRow = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_ns_haushalt'
      );
      expect(nsRow).toBeDefined();
      expect(nsRow.assumptionStatus).toContain('1.32');
      expect(nsRow.estimatedEurPerYear).toBeGreaterThan(0);
    });

    it('Wiesloch by name still resolves (regression #329)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.municipality).toBe('Wiesloch');
      expect(result.ags).toBe('08226098');
      expect(result.status).toBe('lagebild_partial');
    });

    it('PLZ 69168 still resolves to Wiesloch (regression #329)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69168',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.municipality).toBe('Wiesloch');
      expect(result.ags).toBe('08226098');
    });

    it('Mauer PLZ 69256 still resolves (regression #324)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69256',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.municipality).toBe('Mauer');
      expect(result.ags).toBe('08226048');
    });

    it('Heidelberg PLZ 69115 still resolves (regression #324)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69115',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.municipality).toBe('Heidelberg');
      expect(result.ags).toBe('08221000');
    });

    it('Leimen resolves to the Baden-Württemberg city, not the smaller Rheinland-Pfalz municipality', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Leimen',
        year: 2025,
        scenario: 'baseline',
      });

      expect(result.municipality).toBe('Leimen');
      expect(result.ags).toBe('08226041');
      expect(result.postalCode).toBe('69181');
      expect(result.postalCodes).toContain('69181');
      expect(result.state).toBe('Baden-Württemberg');
      expect(result.population).toBeGreaterThan(25000);
      expect(result.kavCategory).toBe('Gemeinde über 25.000 bis 100.000 Einwohner');

      const summary = result.derivedLoadProfileRows.find(
        (r) => r.rowKey === 'derived_load_summary'
      );
      const h0 = result.derivedLoadProfileRows.find((r) => r.rowKey === 'h0_haushalt');
      const totalBudget = result.budgetImpactRows.find(
        (r) => r.rowKey === 'konzessionsabgabe_total_estimate'
      );
      const importKpi = result.euroKpiRows.find((r) => r.rowKey === 'euro_kpi_import_exposure');

      expect(summary.totalAnnualKwh).toBeGreaterThan(40000000);
      expect(h0.basis).toContain('12485 Haushalte');
      expect(totalBudget.estimatedEurPerYear).toBeGreaterThan(300000);
      expect(importKpi.valueEur).toBeGreaterThan(2000000);
    });

    it('PLZ 69181 resolves to Leimen in Baden-Württemberg', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: '69181',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.municipality).toBe('Leimen');
      expect(result.ags).toBe('08226041');
      expect(result.postalCode).toBe('69181');
      expect(result.population).toBeGreaterThan(25000);
    });

    it('genuinely unknown input returns HTTP 200 with lagebild_municipality_unresolved', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Unbekannthausen',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.status).toBe('lagebild_municipality_unresolved');
      expect(result.municipality).toBe('Unbekannthausen');
      expect(result.ags).toBeNull();
      expect(result._errors).toEqual([]);
    });

    it('resolver is no longer KNOWN/PLZ_TO_KEY embedded — resolveMunicipalityProfile module resolves Rommerskirchen', () => {
      const { resolveMunicipalityProfile } = require('../src/municipality-resolver');
      const byName = resolveMunicipalityProfile({ municipality: 'Rommerskirchen' });
      expect(byName.found).toBe(true);
      expect(byName.ags).toBe('05162028');
      const byPlz = resolveMunicipalityProfile({ municipality: '41569' });
      expect(byPlz.found).toBe(true);
      expect(byPlz.name).toBe('Rommerskirchen');
      const notFound = resolveMunicipalityProfile({ municipality: 'Fantasystadt' });
      expect(notFound.found).toBe(false);
      expect(notFound.ags).toBeNull();
    });

    // ── intermunicipalComparison — issue #334 ─────────────────────────────────

    it('intermunicipalComparison block is always present in result (issue #334)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        year: 2025,
        scenario: 'baseline',
      });
      expect(result.intermunicipalComparison).toBeDefined();
      expect(['available', 'blocked']).toContain(result.intermunicipalComparison.status);
      expect(Array.isArray(result.intermunicipalComparison.guardrailRows)).toBe(true);
      expect(Array.isArray(result.intermunicipalComparison.corridorRows)).toBe(true);
      expect(result.intermunicipalComparison.blockedFallback !== undefined).toBe(true);
    });

    it('saubere Daten → Vergleich verfuegbar: Wiesloch (BW) hat ausreichend Peers (issue #334)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Wiesloch',
        ags: '08226098',
        year: 2025,
        scenario: 'baseline',
      });
      const ic = result.intermunicipalComparison;
      expect(ic.status).toBe('available');
      expect(ic.dataStatus).toBe('scenario-based');
      expect(ic.target).not.toBeNull();
      expect(ic.target.ags).toBe('08226098');
      expect(ic.target.state).toBe('Baden-Württemberg');
      expect(ic.peerGroup).not.toBeNull();
      expect(ic.peerGroup.validPeerCount).toBeGreaterThanOrEqual(5);
      expect(ic.peerGroup.anonymized).toBe(true);
      expect(ic.corridorRows.length).toBeGreaterThan(0);
      const guardrailsPassed = ic.guardrailRows.every((r) => r.status === 'passed');
      expect(guardrailsPassed).toBe(true);
    });

    it('weniger als 5 valide Peers → blocked: Kiel (SH, Großstadt ohne vergleichbare Peers) (issue #334)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Kiel',
        year: 2025,
        scenario: 'baseline',
      });
      const ic = result.intermunicipalComparison;
      expect(ic.status).toBe('blocked');
      const minPeerGuardrail = ic.guardrailRows.find((r) => r.guardrailKey === 'min_peer_count');
      expect(minPeerGuardrail).toBeDefined();
      expect(minPeerGuardrail.status).toBe('blocked');
      expect(ic.blockedFallback).not.toBeNull();
      expect(typeof ic.blockedFallback.headline).toBe('string');
      expect(typeof ic.blockedFallback.nextGateLabel).toBe('string');
    });

    it('keine Ranking-Sprache in corridorRows.framingText (issue #334)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        ags: '08226048',
        year: 2025,
        scenario: 'baseline',
      });
      const ic = result.intermunicipalComparison;
      if (ic.status !== 'available') return; // skip if blocked for unrelated reasons
      const forbiddenTerms = [
        'platz',
        'rang',
        'ranking',
        'beste kommune',
        'schlechteste',
        'liga',
        'score',
        'sterne',
      ];
      for (const row of ic.corridorRows) {
        const text = String(row.framingText || '').toLowerCase();
        for (const term of forbiddenTerms) {
          expect(text).not.toContain(term);
        }
      }
    });

    it('keine Peer-Klarnamen im Default-Result (Anonymisierung aktiv) (issue #334)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Mauer',
        ags: '08226048',
        year: 2025,
        scenario: 'baseline',
      });
      const ic = result.intermunicipalComparison;
      expect(ic.peerGroup).toBeDefined();
      if (ic.peerGroup) {
        expect(ic.peerGroup.anonymized).toBe(true);
        expect(ic.peerGroup.peerNames).toBeUndefined();
        expect(ic.peerGroup.peerAgs).toBeUndefined();
      }
    });

    it('unaufgelöste Gemeinde → blocked mit ags_resolution Guardrail (issue #334)', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Unbekannthausen',
        year: 2025,
        scenario: 'baseline',
      });
      const ic = result.intermunicipalComparison;
      expect(ic.status).toBe('blocked');
      const agsGuardrail = ic.guardrailRows.find((r) => r.guardrailKey === 'ags_resolution');
      expect(agsGuardrail).toBeDefined();
      expect(agsGuardrail.status).toBe('blocked');
    });

    it('extremer Zielort-Ausreißer sperrt Vergleich und markiert erzeugungsabhängige Euro-Zeilen als Prüfwerte', async () => {
      const result = await broker.call('dashboard-api.municipalEnergyValueAnalysisStatus', {
        municipality: 'Leimen',
        year: 2025,
        scenario: 'baseline',
      });
      const ic = result.intermunicipalComparison;
      expect(ic.status).toBe('blocked');
      const outlierGuardrail = ic.guardrailRows.find(
        (r) => r.guardrailKey === 'target_peer_method_outlier'
      );
      expect(outlierGuardrail).toBeDefined();
      expect(outlierGuardrail.status).toBe('blocked');
      expect(result.generationIntegrityWarning).toMatchObject({
        status: 'review-required',
        warningKey: 'target_peer_method_outlier',
      });
      expect(result.missingEvidence.map((row) => row.missingDataPoint)).toContain(
        'generation_peer_outlier_review'
      );

      const grossKpi = result.euroKpiRows.find((r) => r.rowKey === 'euro_kpi_gross_market_value');
      const localKpi = result.euroKpiRows.find((r) => r.rowKey === 'euro_kpi_local_value_capture');
      const importKpi = result.euroKpiRows.find((r) => r.rowKey === 'euro_kpi_import_exposure');
      expect(grossKpi.evidenceStatus).toBe('integrity-review-required');
      expect(localKpi.evidenceStatus).toBe('integrity-review-required');
      expect(importKpi.evidenceStatus).toBe('integrity-review-required');

      const sharingScenarios = result.energySharingCommunityRows.filter(
        (row) => Number(row.potentialLocalCirculationEurPerYear) > 0
      );
      expect(sharingScenarios.length).toBeGreaterThan(0);
      expect(
        sharingScenarios.every((row) => row.evidenceStatus === 'integrity-review-required')
      ).toBe(true);
      expect(result.positiveFollowUps.map((row) => row.missingDataPoint)).toContain(
        'generation_peer_outlier_review'
      );
    });
  });

  // ── intermunicipal-comparison unit tests (direct module, issue #334) ─────────

  describe('buildIntermunicipalComparison unit tests (issue #334)', () => {
    const {
      buildIntermunicipalComparison,
      CONSUMPTION_PER_CAPITA_MAX,
      MIN_PEER_COUNT,
    } = require('../src/intermunicipal-comparison');

    const _baseProfile = {
      found: true,
      ags: '08226048',
      name: 'Mauer',
      state: 'Baden-Württemberg',
      population: 6000,
      areaSqKm: 10,
      pvCapacityKw: 3300,
      biomassCapacityKw: 540,
      windCapacityKw: 0,
      avgHouseholdsPerEinwohner: 0.44,
      avgHouseholdConsumptionKwh: 2450,
      postalCode: '69256',
    };

    const _baseLoad = {
      totalAnnualKwh: 6000 * 1563,
      householdKwh: 6000 * 0.44 * 2450,
      households: Math.round(6000 * 0.44),
    };

    it('returns available for profile with sufficient peers and in-range consumption', () => {
      const result = buildIntermunicipalComparison({
        profile: _baseProfile,
        annualLoad: _baseLoad,
        totalGrossMarketValueEur: 420000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.status).toBe('available');
      expect(result.target.ags).toBe('08226048');
      expect(result.peerGroup.validPeerCount).toBeGreaterThanOrEqual(MIN_PEER_COUNT);
      expect(result.corridorRows.length).toBeGreaterThan(0);
    });

    it('Zielkommune außerhalb Verbrauchskorridor → blocked (issue #334 acceptance criterion)', () => {
      const outOfRangeLoad = {
        totalAnnualKwh: 6000 * (CONSUMPTION_PER_CAPITA_MAX + 1500), // well above max
        householdKwh: 6000 * 0.44 * 2450,
        households: Math.round(6000 * 0.44),
      };
      const result = buildIntermunicipalComparison({
        profile: _baseProfile,
        annualLoad: outOfRangeLoad,
        totalGrossMarketValueEur: 420000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.status).toBe('blocked');
      const g = result.guardrailRows.find((r) => r.guardrailKey === 'consumption_per_capita');
      expect(g).toBeDefined();
      expect(g.status).toBe('blocked');
      expect(result.blockedFallback).not.toBeNull();
    });

    it('weniger als 5 Peers → blocked (issue #334 acceptance criterion)', () => {
      // Fake profile in a tiny fictional state that has no peers
      const isolatedProfile = {
        ..._baseProfile,
        ags: '99999999',
        state: '__IsolatedTestState__',
      };
      const result = buildIntermunicipalComparison({
        profile: isolatedProfile,
        annualLoad: _baseLoad,
        totalGrossMarketValueEur: 420000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.status).toBe('blocked');
      const g = result.guardrailRows.find((r) => r.guardrailKey === 'min_peer_count');
      expect(g).toBeDefined();
      expect(g.status).toBe('blocked');
      expect(result.peerGroup.validPeerCount).toBeLessThan(MIN_PEER_COUNT);
    });

    it('target block: corridorRows and target are null when blocked', () => {
      const outOfRangeLoad = { totalAnnualKwh: 6000 * 99999, householdKwh: 0, households: 0 };
      const result = buildIntermunicipalComparison({
        profile: _baseProfile,
        annualLoad: outOfRangeLoad,
        totalGrossMarketValueEur: 0,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.status).toBe('blocked');
      expect(result.target).toBeNull();
      expect(result.corridorRows).toEqual([]);
    });

    it('corridorRows carry only normalised metrics, not absolute Euro Peer-Vergleiche', () => {
      const result = buildIntermunicipalComparison({
        profile: _baseProfile,
        annualLoad: _baseLoad,
        totalGrossMarketValueEur: 420000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      if (result.status !== 'available') return;
      for (const row of result.corridorRows) {
        // unit must be % or EUR/EW/Jahr — not a flat EUR value
        expect(row.unit).not.toBe('EUR');
        expect(row.unit).not.toBe('EUR/Jahr');
        expect(typeof row.metricKey).toBe('string');
        expect(typeof row.framingText).toBe('string');
        expect(row.evidenceStatus).toBe('scenario-based');
      }
    });

    it('peer corridor is non-degenerate so target can be verortet against comparable municipalities', () => {
      const result = buildIntermunicipalComparison({
        profile: _baseProfile,
        annualLoad: _baseLoad,
        totalGrossMarketValueEur: 420000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.status).toBe('available');
      for (const row of result.corridorRows) {
        expect(row.maxValue).toBeGreaterThan(row.minValue);
        expect(row.framingText).toMatch(/oberhalb|unterhalb|verortet/);
      }
    });

    it('extremer Zielort-Ausreißer → blocked statt Erfolgssignal', () => {
      const result = buildIntermunicipalComparison({
        profile: {
          ..._baseProfile,
          ags: '08226041',
          name: 'Leimen',
          population: 27142,
          areaSqKm: 20.64,
          pvCapacityKw: 14928,
          biomassCapacityKw: 1086,
          postalCode: '69181',
        },
        annualLoad: {
          totalAnnualKwh: Math.round(27142 * 1534),
          householdKwh: 27142 * 0.46 * 2300,
          households: Math.round(27142 * 0.46),
        },
        totalGrossMarketValueEur: 3150000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.status).toBe('blocked');
      expect(result.corridorRows).toEqual([]);
      const g = result.guardrailRows.find((r) => r.guardrailKey === 'target_peer_method_outlier');
      expect(g).toBeDefined();
      expect(g.status).toBe('blocked');
      expect(result.blockedFallback.headline).toContain('nicht freigegeben');
      expect(result.blockedFallback.text).toContain('keinen Peer-Vergleich');
    });

    it('formatiert Einwohnerkorridor mit Tausendertrennzeichen', () => {
      const result = buildIntermunicipalComparison({
        profile: {
          ..._baseProfile,
          ags: '08226041',
          name: 'Leimen',
          population: 27142,
          areaSqKm: 20.64,
          pvCapacityKw: 14928,
          biomassCapacityKw: 1086,
          postalCode: '69181',
        },
        annualLoad: {
          totalAnnualKwh: Math.round(27142 * 1534),
          householdKwh: 27142 * 0.46 * 2300,
          households: Math.round(27142 * 0.46),
        },
        totalGrossMarketValueEur: 3150000,
        year: 2025,
        scenario: 'baseline',
        marketPriceEurPerMwh: 70,
      });
      expect(result.peerGroup.populationBandLabel).toContain('20.357');
      expect(result.peerGroup.populationBandLabel).toContain('33.928');
      expect(result.peerGroup.populationBandLabel).not.toContain('2035733928');
    });
  });
});
