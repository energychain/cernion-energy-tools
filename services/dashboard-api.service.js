'use strict';

/**
 * Dashboard API Service (v0.19)
 *
 * Read-only aggregator service that orchestrates multiple internal Moleculer
 * actions into UI-optimised composite responses. Each endpoint is designed
 * to satisfy a full UI page with a single API call, reducing the typical
 * 5–8 roundtrips needed for a dashboard page to one.
 *
 * Architecture: this is the topmost layer — it reads from all layers below
 * (Agent Layer v0.14–v0.18, Allocation Engine v0.16, Datapoint Layer v0.11,
 * Execution Layer v0.9.x) but has no own PouchDB, no own state, and no
 * side-effects. Only an in-memory cache is used.
 *
 * Caching: per-action TTL via this.cache (Map). Cache keys include all
 * discriminating query parameters. Each cache entry is { data, expiresAt }.
 *
 * Error tolerance: every internal ctx.call is wrapped in safeCall(). When
 * a downstream service throws, safeCall returns the provided fallback value
 * and records the failure in this._errors (reset per request). The final
 * response always contains an _errors array listing failed service calls.
 */

const { FINDING_CODE_METADATA } = require('../src/validation-findings');
const {
  evaluatePresentationGrounding,
} = require('../src/receipt-grounded-presentation-contract');

const OPENAPI_TAG = 'Dashboard API';
const ACTION_MQ_LIST = 'mastr-quality.list';
const ACTION_RD_LIST = 'redispatch-expost.list';
const ACTION_ES_LIST = 'energy-sharing.list';
const ACTION_GC_LIST = 'grid-connection.list';
const ACTION_VDMI_LIST = 'vdmi.list';
const ACTION_VDMI_FINDINGS = 'vdmi.findings';

module.exports = {
  name: 'dashboard-api',

  settings: {
    cacheTtlMs: {
      vnbOverview: 5 * 60 * 1000, // 5 min
      redispatchMeteringCockpit: 5 * 60 * 1000, // 5 min
      loadProfileStreamMonitor: 5 * 60 * 1000, // 5 min
      redispatchCallQualityGate: 5 * 60 * 1000, // 5 min
      evidenceGroundingConfidenceAudit: 5 * 60 * 1000, // 5 min
      receiptGroundedPresentationContract: 5 * 60 * 1000, // 5 min
      marketCommunicationEvidenceChainStatus: 5 * 60 * 1000, // 5 min
      e2eControllabilityGovernanceStatus: 5 * 60 * 1000, // 5 min
      controllabilityAssetHandoverStatus: 5 * 60 * 1000, // 5 min
      regulatoryChangeReadinessStatus: 5 * 60 * 1000, // 5 min
      investmentTwoTrackControlStatus: 5 * 60 * 1000, // 5 min
      sapBudgetPspGateStatus: 5 * 60 * 1000, // 5 min
      energyTaxInformationPackageStatus: 5 * 60 * 1000, // 5 min
      investmentRiskTranslationStatus: 5 * 60 * 1000, // 5 min
      budgetWaterfallGovernanceStatus: 5 * 60 * 1000, // 5 min
      gasDecommissioningRoadmapStatus: 5 * 60 * 1000, // 5 min
      jourFixeDecisionClosureStatus: 5 * 60 * 1000, // 5 min
      offBalancingMeteringPruefmatrixStatus: 5 * 60 * 1000, // 5 min
      automationRequirementsDecisionValueStatus: 5 * 60 * 1000, // 5 min
      smartMeterOffBalancingPurposeLockStatus: 5 * 60 * 1000, // 5 min
      imsysScheduleValueChainReadinessStatus: 5 * 60 * 1000, // 5 min
      clsDigitalTwinComplianceGateStatus: 5 * 60 * 1000, // 5 min
      legacyControlTechnologyTransitionStatus: 5 * 60 * 1000, // 5 min
      controllabilitySubmissionCockpitStatus: 5 * 60 * 1000, // 5 min
      crisisDecisionRoutineStatus: 5 * 60 * 1000, // 5 min
      investmentCommitteeSteeringCardsStatus: 5 * 60 * 1000, // 5 min
      investmentDataReviewQueueStatus: 5 * 60 * 1000, // 5 min
      flexStrategicDemandIntakeStatus: 5 * 60 * 1000, // 5 min
      gasInfrastructureRiskGovernanceStatus: 5 * 60 * 1000, // 5 min
      meteringRolloutProcessIndicatorStatus: 5 * 60 * 1000, // 5 min
      heatTransformationLineAssetModelStatus: 5 * 60 * 1000, // 5 min
      kiFloorwalkerGovernanceStatus: 5 * 60 * 1000, // 5 min
      investmentWaterfallGovernanceStatus: 5 * 60 * 1000, // 5 min
      capacityContractRiskAssetCockpitStatus: 5 * 60 * 1000, // 5 min
      imsysTaf2ComplianceStatus: 5 * 60 * 1000, // 5 min
      scheduleManagementGovernanceRoadmapStatus: 5 * 60 * 1000, // 5 min
      marketSnapshot: 15 * 60 * 1000, // 15 min
      qualitySummary: 5 * 60 * 1000, // 5 min
      observabilityMini: 60 * 1000, // 1 min
      findingCodes: 24 * 60 * 60 * 1000, // 24 h (static)
    },
  },

  created() {
    this.cache = new Map();
    this.inflight = new Map();
  },

  actions: {
    // ── vnbOverview ──────────────────────────────────────────────────────────
    /**
     * GET /api/dashboard/vnb-overview?bdewCode=...
     *
     * Aggregates VNB identity, KPIs from the VNB Monitor, Datapoint health,
     * and the latest report from each agent pipeline into a single response.
     * Two-phase execution (v0.19.1):
     *  Phase 1 (sequential): grid-operations.vnbLookupCodes → vnb-monitor.snapshot.
     *    vnb-monitor.snapshot opens 5–10 MCP sessions internally; running these two
     *    calls sequentially caps peak concurrent MCP sessions at ≤10 per request.
     *  Phase 2 (parallel): datapoint.health + 4 agent list calls (PouchDB-only, 0 MCP).
     *    gridOperatorId extracted from Phase 1 identity is forwarded to agent list calls.
     * safeCall wraps every upstream call — any error returns null and is recorded
     * in the top-level _errors array.
     *
     * @param {string} bdewCode - BDEW code of the grid operator (required)
     */
    vnbOverview: {
      rest: 'GET /vnb-overview',
      params: {
        bdewCode: {
          type: 'string',
          pattern: /^\d{7,13}$/,
          messages: {
            string: 'bdewCode muss eine Zeichenkette sein',
            stringPattern: 'bdewCode muss 7-13 Ziffern enthalten (Beispiel: 9907473000008)',
            required: 'bdewCode ist ein Pflichtparameter',
          },
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'VNB overview — aggregated dashboard data for one grid operator',
        description:
          'Returns VNB identity, KPIs (installations, capacity, EWK scores, MaStR quality), ' +
          'latest agent results (MaStR Quality, Grid Connection, Energy Sharing, Redispatch), ' +
          'active VNB Monitor alerts, and datapoint health — all in a single call.\n\n' +
          'Two-phase execution: Phase 1 runs grid-operations.vnbLookupCodes and ' +
          'vnb-monitor.snapshot sequentially (MCP-intensive, ≤10 concurrent sessions). ' +
          'Phase 2 fires datapoint.health and four agent list calls in parallel (PouchDB-only). ' +
          'gridOperatorId from Phase 1 is forwarded to Phase 2 list calls.\n\n' +
          'If any upstream service is unavailable, the affected fields are set to `null` ' +
          'and the service name is appended to `_errors`.\n\n' +
          'Cache TTL: 5 minutes (key: bdewCode). Stampede-safe: concurrent requests for ' +
          'the same bdewCode share a single in-flight fetch promise.',
        parameters: [
          {
            name: 'bdewCode',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '9907473000008' },
            description: 'BDEW code of the grid operator',
          },
        ],
        responses: {
          200: {
            description: 'Aggregated VNB overview',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    identity: {
                      type: 'object',
                      nullable: true,
                      description: 'VNB identity from grid-operations.vnbLookupCodes',
                      properties: {
                        name: { type: 'string', example: 'STROMDAO Netze GmbH' },
                        mastrId: { type: 'string', example: 'SNB935578300972' },
                        bdew: { type: 'string', example: '9907473000008' },
                        bnr: { type: 'string', nullable: true },
                      },
                    },
                    kpis: {
                      type: 'object',
                      nullable: true,
                      description:
                        'Key performance indicators aggregated from VNB Monitor and Datapoint health',
                    },
                    latestAgentResults: {
                      type: 'object',
                      description:
                        'Most recent report summary for each agent pipeline (null if no report exists)',
                      properties: {
                        mastrQuality: { type: 'object', nullable: true },
                        gridConnection: { type: 'object', nullable: true },
                        energySharing: { type: 'object', nullable: true },
                        redispatch: { type: 'object', nullable: true },
                      },
                    },
                    alerts: {
                      type: 'array',
                      description: 'Active alerts from VNB Monitor snapshot',
                    },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Internal services that failed — corresponding fields are null',
                    },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000446'],
      },
      async handler(ctx) {
        const { bdewCode } = ctx.params;
        const cacheKey = `vnb-overview:${bdewCode}`;
        return this.cacheGetOrFetch(cacheKey, this.settings.cacheTtlMs.vnbOverview, async () => {
          const errors = [];

          // ── Phase 1: Sequential MCP-intensive calls ──────────────────────
          // grid-operations.vnbLookupCodes: 1 MCP session (lightweight identity lookup)
          // vnb-monitor.snapshot: 5–10 MCP sessions (EWK+MaStR+Market, serialised
          //   internally since v0.9.9). Sequential execution caps peak concurrent
          //   sessions at ≤10 per request instead of 15+ with full parallelism.
          const identity = await this.safeCall(
            ctx,
            'grid-operations.vnbLookupCodes',
            { bdewCode },
            null,
            errors,
            'grid-operations.vnbLookupCodes'
          );
          const vnbMonitor = await this.safeCall(
            ctx,
            'vnb-monitor.snapshot',
            { bdewCode, refresh: false, alerts: true, lang: 'de' },
            null,
            errors,
            'vnb-monitor.snapshot'
          );

          // Extract mastrId from Phase 1 for per-operator filtering in Phase 2.
          const gridOperatorId =
            identity?.results?.[0]?.mastrId ||
            identity?.mastrId ||
            vnbMonitor?.identity?.mastrId ||
            null;

          // ── Phase 2: Parallel reads ───────────────────────────────────────
          // PouchDB-only calls (0 MCP sessions) + assets.redispatchCount (1 MCP
          // session via cernion_installations_local, runs in parallel so adds
          // no latency to the overall Phase 2 wall-clock time).
          const [health, mqAudits, gcValidations, esValidations, rdAudits, rdCount] =
            await Promise.all([
              this.safeCall(ctx, 'datapoint.health', {}, null, errors, 'datapoint.health'),
              this.safeCall(
                ctx,
                ACTION_MQ_LIST,
                { gridOperatorId, limit: 1 },
                null,
                errors,
                ACTION_MQ_LIST
              ),
              this.safeCall(
                ctx,
                ACTION_GC_LIST,
                { gridOperatorId, limit: 1 },
                null,
                errors,
                ACTION_GC_LIST
              ),
              this.safeCall(ctx, ACTION_ES_LIST, { limit: 1 }, null, errors, ACTION_ES_LIST),
              this.safeCall(
                ctx,
                ACTION_RD_LIST,
                { gridOperatorId, limit: 1 },
                null,
                errors,
                ACTION_RD_LIST
              ),
              this.safeCall(
                ctx,
                'assets.redispatchCount',
                { gridOperatorId },
                null,
                errors,
                'assets.redispatchCount'
              ),
            ]);

          return {
            identity: this.buildIdentity(identity, bdewCode),
            kpis: this.buildKpis(vnbMonitor, health, mqAudits, rdCount),
            latestAgentResults: this.buildAgentSummary(
              mqAudits,
              gcValidations,
              esValidations,
              rdAudits
            ),
            alerts: vnbMonitor?.alerts || [],
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        });
      },
    },

    // ── redispatchMeteringCockpit ──────────────────────────────────────────
    /**
     * GET /api/dashboard/redispatch-metering-cockpit?gridOperatorId=...&bdewCode=...
     *
     * Read-only cockpit payload for Redispatch + metering/masterdata readiness.
     * Reuses existing deterministic report pipelines and surfaces evidence gaps
     * as explicit blockers instead of inferring hidden assumptions.
     *
     * Optional operator context:
     *  - gridOperatorId (SNB.../GNB...) directly
     *  - bdewCode (resolved via grid-operations.vnbLookupCodes)
     */
    redispatchMeteringCockpit: {
      rest: 'GET /redispatch-metering-cockpit',
      params: {
        gridOperatorId: {
          type: 'string',
          optional: true,
          pattern: /^[SG]NB\d+$/,
          messages: {
            stringPattern:
              'gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)',
          },
        },
        bdewCode: {
          type: 'string',
          optional: true,
          pattern: /^\d{7,13}$/,
          messages: {
            stringPattern: 'bdewCode muss 7-13 Ziffern enthalten (Beispiel: 9907473000008)',
          },
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Redispatch Metering Cockpit — operator-level decision readiness',
        description:
          'Read-only cockpit for Redispatch, metering, masterdata and governance readiness. ' +
          'Builds a traffic-light readiness signal from existing deterministic pipelines ' +
          '(redispatch-expost, energy-sharing-allocation, mastr-quality, vdmi, datapoint.health). ' +
          'Evidence gaps and blockers are returned explicitly.',
        parameters: [
          {
            name: 'gridOperatorId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'SNB935578300972' },
            description: 'MaStR ID of the grid operator (SNB.../GNB...)',
          },
          {
            name: 'bdewCode',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '9907473000008' },
            description:
              'BDEW code as fallback operator context. Used to resolve gridOperatorId when not provided.',
          },
        ],
        responses: {
          200: {
            description: 'Cockpit payload with readiness signal and explicit blockers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    operator: {
                      type: 'object',
                      properties: {
                        gridOperatorId: { type: 'string', nullable: true },
                        bdewCode: { type: 'string', nullable: true },
                        name: { type: 'string', nullable: true },
                      },
                    },
                    decisionReadiness: {
                      type: 'object',
                      properties: {
                        signal: { type: 'string', enum: ['green', 'yellow', 'red'] },
                        score: { type: 'number', nullable: true },
                        blocked: { type: 'boolean' },
                      },
                    },
                    evidence: { type: 'object' },
                    blockingEvidenceGaps: { type: 'array' },
                    staleData: { type: 'array' },
                    sourceReports: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler(ctx) {
        const { gridOperatorId: incomingGridOperatorId, bdewCode } = ctx.params;
        const cacheKey = `redispatch-metering-cockpit:${incomingGridOperatorId || 'none'}:${bdewCode || 'none'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.redispatchMeteringCockpit,
          async () => {
            const errors = [];

            const identityLookup =
              !incomingGridOperatorId && bdewCode
                ? await this.safeCall(
                    ctx,
                    'grid-operations.vnbLookupCodes',
                    { bdewCode },
                    null,
                    errors,
                    'grid-operations.vnbLookupCodes'
                  )
                : null;

            const resolvedGridOperatorId =
              incomingGridOperatorId ||
              identityLookup?.results?.[0]?.mastrId ||
              identityLookup?.mastrId ||
              null;

            const baseFilter = resolvedGridOperatorId
              ? { gridOperatorId: resolvedGridOperatorId }
              : {};

            const [rdRes, allocRes, mqRes, vdmiRes, dpRes] = await Promise.all([
              this.safeCall(
                ctx,
                ACTION_RD_LIST,
                { ...baseFilter, limit: 5 },
                null,
                errors,
                ACTION_RD_LIST
              ),
              this.safeCall(
                ctx,
                'energy-sharing-allocation.list',
                { ...baseFilter, limit: 5 },
                null,
                errors,
                'energy-sharing-allocation.list'
              ),
              this.safeCall(
                ctx,
                ACTION_MQ_LIST,
                { ...baseFilter, limit: 5 },
                null,
                errors,
                ACTION_MQ_LIST
              ),
              this.safeCall(
                ctx,
                ACTION_VDMI_FINDINGS,
                { limit: 500 },
                null,
                errors,
                ACTION_VDMI_FINDINGS
              ),
              this.safeCall(ctx, 'datapoint.health', {}, null, errors, 'datapoint.health'),
            ]);

            const rdLatest = rdRes?.audits?.[0] || null;
            const allocLatest = allocRes?.allocations?.[0] || null;
            const mqLatest = mqRes?.audits?.[0] || null;
            const dpOverview = dpRes?.overview || dpRes || {};

            const allFindings = Array.isArray(vdmiRes?.findings) ? vdmiRes.findings : [];
            const filteredFindings = resolvedGridOperatorId
              ? allFindings.filter((f) => {
                  if (!f || typeof f !== 'object') return false;
                  const findingOperatorId =
                    f.gridOperatorId || f.operatorId || f.mastrId || f.gridOperatorMastrId || null;
                  if (!findingOperatorId) return true;
                  return String(findingOperatorId) === String(resolvedGridOperatorId);
                })
              : allFindings;

            const openCriticalFindings = filteredFindings.filter((f) => {
              if (!f || typeof f !== 'object') return false;
              const status = String(f.status || '').toLowerCase();
              const sev = String(f.severity || '').toUpperCase();
              return status === 'open' && (sev === 'H' || sev === 'K' || sev === 'ERROR');
            });

            const blockingEvidenceGaps = this.buildRedispatchMeteringBlockers({
              resolvedGridOperatorId,
              rdLatest,
              allocLatest,
              mqLatest,
              dpOverview,
              openCriticalFindings,
            });

            const staleData = this.buildRedispatchMeteringStaleData({
              rdLatest,
              allocLatest,
              mqLatest,
              dpOverview,
            });

            const score = this.computeRedispatchMeteringScore({
              rdLatest,
              mqLatest,
              dpOverview,
              openCriticalFindings,
            });

            const signal = this.deriveRedispatchMeteringSignal({
              score,
              blockingEvidenceGaps,
            });

            return {
              operator: {
                gridOperatorId: resolvedGridOperatorId,
                bdewCode: bdewCode || identityLookup?.results?.[0]?.bdew || null,
                name: identityLookup?.results?.[0]?.name || identityLookup?.name || null,
              },
              decisionReadiness: {
                signal,
                score,
                blocked: blockingEvidenceGaps.length > 0,
              },
              evidence: {
                redispatch: {
                  settlementReadinessPercent:
                    rdLatest?.settlementReadiness?.readinessPercent ?? null,
                  riskLevel: rdLatest?.riskAssessment?.level ?? null,
                  lastAuditAt: rdLatest?.createdAt || null,
                  auditId: rdLatest?.id || null,
                },
                metering: {
                  datapointsHealthy: dpOverview.healthy ?? null,
                  datapointsStale: dpOverview.stale ?? null,
                  datapointsErrored: dpOverview.errored ?? null,
                  lastAllocationAt: allocLatest?.createdAt || null,
                  allocationId: allocLatest?.id || null,
                },
                masterData: {
                  qualityScore: mqLatest?.qualityScore ?? null,
                  lastAuditAt: mqLatest?.createdAt || null,
                  auditId: mqLatest?.id || null,
                },
                governance: {
                  openCriticalFindings: openCriticalFindings.length,
                  openFindingsTotal: filteredFindings.filter(
                    (f) => String(f?.status || '').toLowerCase() === 'open'
                  ).length,
                },
              },
              blockingEvidenceGaps,
              staleData,
              sourceReports: {
                redispatchExpostId: rdLatest?.id || null,
                energySharingAllocationId: allocLatest?.id || null,
                mastrQualityAuditId: mqLatest?.id || null,
              },
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }
        );
      },
    },

    // ── loadProfileStreamMonitor ───────────────────────────────────────────
    /**
     * GET /api/dashboard/load-profile-stream-monitor?meloId=...&from=...&to=...
     *
     * Read-only composite monitor for Lastgangdaten/Bewegungsstrom diagnostics.
     * Reuses EDM summary + EDM validation + forecast quality + VDMI governance
     * findings and classifies signals into strict anomaly buckets.
     *
     * Partial findings are explicitly allowed: failed upstream calls are listed
     * in `_errors` while available bucket data is still returned.
     */
    loadProfileStreamMonitor: {
      rest: 'GET /load-profile-stream-monitor',
      params: {
        meloId: { type: 'string', min: 1 },
        from: { type: 'string', min: 1 },
        to: { type: 'string', min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        gridOperatorId: {
          type: 'string',
          optional: true,
          pattern: /^[SG]NB\d+$/,
          messages: {
            stringPattern:
              'gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)',
          },
        },
        profileId: { type: 'string', optional: true, default: 'H0' },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Load profile movement monitor — strict anomaly-class buckets',
        description:
          'Read-only monitor for Lastgangdaten/Bewegungsstrom diagnostics using existing deterministic ' +
          'services only (edm.getTimeseriesSummary, edm-validation.validate, forecast-engine.evaluateQuality, vdmi.findings). ' +
          'Returns strict anomaly buckets (`dataQualityGap`, `realAnomaly`, `forecastProblem`, `processGovernanceBreak`) ' +
          'and allows partial findings with explicit `_errors`.',
        parameters: [
          {
            name: 'meloId',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'DE0012345678901234567890123456789' },
            description: 'MeLo identifier (Marktlokation) for the monitored stream.',
          },
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-05-01T00:00:00.000Z' },
            description: 'Start timestamp (inclusive).',
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-05-02T00:00:00.000Z' },
            description: 'End timestamp (exclusive).',
          },
          {
            name: 'obis',
            in: 'query',
            required: false,
            schema: { type: 'string', default: '1-0:1.8.0' },
            description: 'OBIS channel to evaluate.',
          },
          {
            name: 'gridOperatorId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'SNB935578300972' },
            description: 'Optional VNB scope for governance findings.',
          },
          {
            name: 'profileId',
            in: 'query',
            required: false,
            schema: { type: 'string', default: 'H0' },
            description: 'Optional load profile identifier for the monitor request.',
          },
          {
            name: 'annualConsumptionKwh',
            in: 'query',
            required: false,
            schema: { type: 'number', example: 3500 },
            description: 'Optional annual consumption in kWh used for the stream monitor context.',
          },
        ],
        responses: {
          200: {
            description: 'Composite stream monitor payload with strict anomaly buckets',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    streamStatus: { type: 'object' },
                    qualityFindings: { type: 'object' },
                    anomalySignals: { type: 'object' },
                    restrictionRefs: { type: 'array' },
                    forecastQuality: { type: 'object', nullable: true },
                    decisionNotes: { type: 'array', items: { type: 'string' } },
                    sourceActions: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler(ctx) {
        const { meloId, from, to, obis, gridOperatorId, profileId, annualConsumptionKwh } =
          ctx.params;

        const cacheKey = `load-profile-stream-monitor:${meloId}:${obis}:${from}:${to}:${gridOperatorId || 'all'}:${profileId}:${annualConsumptionKwh || 'default'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.loadProfileStreamMonitor,
          async () => {
            const errors = [];

            const [summaryRes, validationRes, forecastRes, vdmiRes] = await Promise.all([
              this.safeCall(
                ctx,
                'edm.getTimeseriesSummary',
                {
                  meloId,
                  obis,
                  from,
                  to,
                  groupBy: 'day',
                },
                null,
                errors,
                'edm.getTimeseriesSummary'
              ),
              this.safeCall(
                ctx,
                'edm-validation.validate',
                {
                  meloId,
                  obis,
                  from,
                  to,
                  autoFix: false,
                },
                null,
                errors,
                'edm-validation.validate'
              ),
              this.safeCall(
                ctx,
                'forecast-engine.evaluateQuality',
                {
                  meloId,
                  obis,
                  from,
                  to,
                  profileId,
                  annualConsumptionKwh,
                },
                null,
                errors,
                'forecast-engine.evaluateQuality'
              ),
              this.safeCall(
                ctx,
                ACTION_VDMI_FINDINGS,
                {
                  status: 'open',
                  limit: 500,
                },
                null,
                errors,
                ACTION_VDMI_FINDINGS
              ),
            ]);

            const validationFindings = Array.isArray(validationRes?.findings)
              ? validationRes.findings
              : [];

            const vdmiFindingsRaw = Array.isArray(vdmiRes?.findings) ? vdmiRes.findings : [];
            const vdmiFindings = gridOperatorId
              ? vdmiFindingsRaw.filter((f) => {
                  const findingOperatorId =
                    f?.gridOperatorId ||
                    f?.operatorId ||
                    f?.mastrId ||
                    f?.gridOperatorMastrId ||
                    null;
                  if (!findingOperatorId) return true;
                  return String(findingOperatorId) === String(gridOperatorId);
                })
              : vdmiFindingsRaw;

            const anomalySignals = this.buildLoadProfileAnomalyBuckets(
              validationFindings,
              vdmiFindings,
              forecastRes?.quality || null
            );

            const qualityFindings = {
              summary: validationRes?.summary || null,
              recommendations: validationRes?.recommendations || [],
              total: validationFindings.length,
              errors: validationFindings.filter((f) => f?.severity === 'error').length,
              warnings: validationFindings.filter((f) => f?.severity === 'warning').length,
              infos: validationFindings.filter((f) => f?.severity === 'info').length,
            };

            const forecastQuality = forecastRes?.quality
              ? {
                  ...forecastRes.quality,
                  signal:
                    forecastRes.quality.rating === 'excellent' ||
                    forecastRes.quality.rating === 'good'
                      ? 'green'
                      : forecastRes.quality.rating === 'fair'
                        ? 'yellow'
                        : 'red',
                }
              : null;

            const restrictionRefs = this.buildLoadProfileRestrictionRefs(anomalySignals);
            const streamStatus = this.deriveLoadProfileStreamStatus({
              qualitySummary: validationRes?.summary || null,
              anomalySignals,
              hasPartialData: errors.length > 0,
              forecastQuality,
            });

            const sourceActions = {
              'edm.getTimeseriesSummary': {
                success: !!summaryRes,
                partial: false,
                groups: Array.isArray(summaryRes?.groups) ? summaryRes.groups.length : 0,
              },
              'edm-validation.validate': {
                success: !!validationRes,
                partial: false,
                findings: validationFindings.length,
              },
              'forecast-engine.evaluateQuality': {
                success: !!forecastRes,
                partial: false,
                rating: forecastRes?.quality?.rating || null,
              },
              'vdmi.findings': {
                success: !!vdmiRes,
                partial: !!gridOperatorId,
                findings: vdmiFindings.length,
              },
            };

            return {
              streamStatus,
              qualityFindings,
              anomalySignals,
              restrictionRefs,
              forecastQuality,
              decisionNotes: this.buildLoadProfileDecisionNotes({
                streamStatus,
                anomalySignals,
                qualitySummary: validationRes?.summary || null,
                forecastQuality,
                hasPartialData: errors.length > 0,
              }),
              sourceActions,
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }
        );
      },
    },

    // ── redispatchCallQualityGate ───────────────────────────────────────────
    /**
     * GET /api/dashboard/redispatch-call-quality-gate?gridOperatorId=...&meloId=...&from=...&to=...
     *
     * Read-only dossier-safe aggregator for Redispatch Abrufprozess data-quality
     * and billing-readiness checks. It summarizes existing evidence surfaces and
     * never creates settlement, A96, HITL, process, or operational Redispatch state.
     */
    redispatchCallQualityGate: {
      rest: 'GET /redispatch-call-quality-gate',
      params: {
        gridOperatorId: {
          type: 'string',
          optional: true,
          pattern: /^[SG]NB\d+$/,
          messages: {
            stringPattern:
              'gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)',
          },
        },
        meloId: { type: 'string', optional: true, min: 1 },
        maloId: { type: 'string', optional: true, min: 1 },
        assetId: { type: 'string', optional: true, min: 1 },
        from: { type: 'string', optional: true, min: 1 },
        to: { type: 'string', optional: true, min: 1 },
        auditId: { type: 'string', optional: true, min: 1 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        profileId: { type: 'string', optional: true, default: 'H0' },
        annualConsumptionKwh: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Redispatch call data-quality gate — read-only evidence aggregator',
        description:
          'Read-only Redispatch-Abrufprozess gate that summarizes existing Redispatch ex-post, ' +
          'EDM/datapoint, forecast, VDMI and settlement-readiness evidence into a dossier-safe status. ' +
          'The action does not create settlement artifacts, A96 exports, HITL tasks or operational mutations.',
        parameters: [
          { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'meloId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'maloId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'assetId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'from', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'to', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'auditId', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Read-only Redispatch call data-quality gate status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    found: { type: 'boolean' },
                    gateStatus: { type: 'string' },
                    callContext: { type: 'object' },
                    masterDataReadiness: { type: 'object' },
                    meteringReadiness: { type: 'object' },
                    forecastReadiness: { type: 'object' },
                    controlEvidenceReadiness: { type: 'object' },
                    settlementReadiness: { type: 'object' },
                    leadingProcessSignal: { type: 'object' },
                    openEvidence: { type: 'array' },
                    monitoringTasks: { type: 'array' },
                    sourceActions: { type: 'object' },
                    nextActions: { type: 'array' },
                    missingDataPoints: { type: 'array' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler(ctx) {
        const {
          gridOperatorId,
          meloId,
          maloId,
          assetId,
          from,
          to,
          auditId,
          obis,
          profileId,
          annualConsumptionKwh,
        } = ctx.params;

        if (!gridOperatorId && !meloId && !maloId && !assetId && !auditId) {
          return {
            found: false,
            message:
              'Missing Redispatch call gate context: provide gridOperatorId, meloId/maloId/assetId or auditId.',
            gateStatus: 'blocked_for_billing',
            callContext: {
              gridOperatorId: null,
              meloId: null,
              maloId: null,
              assetId: null,
              from: from || null,
              to: to || null,
              auditId: null,
            },
            missingDataPoints: [
              {
                missingDataPoint: 'masterDataProcessSignal',
                enablesDossierAddition:
                  'Stammdatenmerkmal und Prozessabsprung koennen dem Abruffall belastbar zugeordnet werden',
                category: 'masterData',
                severity: 'high',
              },
            ],
            openEvidence: [],
            monitoringTasks: [],
            sourceActions: {},
            nextActions: [],
            timestamp: new Date().toISOString(),
            _errors: [],
          };
        }

        const cacheKey = `redispatch-call-quality-gate:${gridOperatorId || 'all'}:${meloId || 'no-melo'}:${maloId || 'no-malo'}:${assetId || 'no-asset'}:${from || 'no-from'}:${to || 'no-to'}:${auditId || 'latest'}:${obis}:${profileId}:${annualConsumptionKwh || 'default'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.redispatchCallQualityGate,
          async () => {
            const errors = [];
            const hasTimeseriesContext = !!(meloId && from && to);

            const [rdRes, datapointRes, validationRes, forecastRes, vdmiRes] =
              await Promise.all([
                this.safeCall(
                  ctx,
                  ACTION_RD_LIST,
                  { gridOperatorId, limit: 10 },
                  null,
                  errors,
                  ACTION_RD_LIST
                ),
                this.safeCall(ctx, 'datapoint.health', {}, null, errors, 'datapoint.health'),
                hasTimeseriesContext
                  ? this.safeCall(
                      ctx,
                      'edm-validation.validate',
                      { meloId, obis, from, to, autoFix: false },
                      null,
                      errors,
                      'edm-validation.validate'
                    )
                  : null,
                hasTimeseriesContext
                  ? this.safeCall(
                      ctx,
                      'forecast-engine.evaluateQuality',
                      { meloId, obis, from, to, profileId, annualConsumptionKwh },
                      null,
                      errors,
                      'forecast-engine.evaluateQuality'
                    )
                  : null,
                this.safeCall(
                  ctx,
                  ACTION_VDMI_FINDINGS,
                  { status: 'open', limit: 500 },
                  null,
                  errors,
                  ACTION_VDMI_FINDINGS
                ),
              ]);

            const audits = Array.isArray(rdRes?.audits) ? rdRes.audits : [];
            const rdLatest =
              (auditId && audits.find((a) => String(a?.id) === String(auditId))) || audits[0] || null;
            const validationFindings = Array.isArray(validationRes?.findings)
              ? validationRes.findings
              : [];
            const vdmiFindings = this.filterFindingsForContext(vdmiRes?.findings, {
              gridOperatorId,
              meloId,
              maloId,
              assetId,
            });
            const sourceActions = this.buildRedispatchCallQualitySourceActions({
              rdRes,
              datapointRes,
              validationRes,
              forecastRes,
              vdmiRes,
              hasTimeseriesContext,
              rdLatest,
              validationFindings,
              vdmiFindings,
            });

            const result = this.buildRedispatchCallQualityGate({
              params: { gridOperatorId, meloId, maloId, assetId, from, to, auditId },
              rdLatest,
              datapointOverview: datapointRes?.overview || null,
              validationSummary: validationRes?.summary || null,
              validationFindings,
              forecastQuality: forecastRes?.quality || null,
              vdmiFindings,
              sourceActions,
              errors,
              hasTimeseriesContext,
            });

            return {
              ...result,
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }
        );
      },
    },

    // ── evidenceGroundingConfidenceAudit ────────────────────────────────────
    /**
     * GET /api/dashboard/evidence-grounding-confidence-audit?domain=...&query=...
     *
     * Read-only dossier-safe confidence audit for grounded answers. It separates
     * routing confidence from evidence confidence and turns missing operator
     * evidence, scope filters, source refs, or tool failures into positive
     * follow-ups instead of synthetic certainty.
     */
    evidenceGroundingConfidenceAudit: {
      rest: 'GET /evidence-grounding-confidence-audit',
      params: {
        requestId: { type: 'string', optional: true, min: 1 },
        sessionId: { type: 'string', optional: true, min: 1 },
        domain: { type: 'string', optional: true, min: 1 },
        capabilityId: { type: 'string', optional: true, min: 1 },
        sourceAction: { type: 'string', optional: true, min: 1 },
        scopeId: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        datasourceId: { type: 'string', optional: true, min: 1 },
        datapointId: { type: 'string', optional: true, min: 1 },
        query: { type: 'string', optional: true, min: 1 },
        networkOperatorConfirmed: { type: 'boolean', optional: true, convert: true, default: false },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Evidence grounding confidence audit — read-only dossier-safe evidence status',
        description:
          'Read-only confidence audit for grounded Cernion answers. It keeps Capability Broker ' +
          'routing confidence separate from evidence confidence, exposes source classes, scope ' +
          'limitations, tool failures, missing evidence and positive follow-ups. It does not create ' +
          'HITL items, interface placeholders, RAG ingests, Personal-Agent sessions or external calls.',
        parameters: [
          { name: 'requestId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sessionId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'capabilityId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceAction', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'scopeId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'datasourceId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'datapointId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'query', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'networkOperatorConfirmed',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
          },
        ],
        responses: {
          200: {
            description: 'Read-only evidence-grounding confidence audit',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    auditId: { type: 'string' },
                    requestContext: { type: 'object' },
                    routingConfidence: { type: 'object' },
                    evidenceConfidence: { type: 'object' },
                    answerStatus: { type: 'string' },
                    sourceClassBreakdown: { type: 'object' },
                    claims: { type: 'array' },
                    assumptions: { type: 'array' },
                    toolFailures: { type: 'array' },
                    scopeLimitations: { type: 'array' },
                    missingEvidence: { type: 'array' },
                    requiresNetworkOperatorConfirmation: { type: 'boolean' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `evidence-grounding-confidence-audit:${params.requestId || 'no-request'}:${params.sessionId || 'no-session'}:${params.domain || 'no-domain'}:${params.capabilityId || 'no-capability'}:${params.sourceAction || 'no-action'}:${params.scopeId || params.gridOperatorId || 'no-scope'}:${params.datasourceId || 'no-datasource'}:${params.datapointId || 'no-datapoint'}:${params.query || 'no-query'}:${params.networkOperatorConfirmed ? 'operator-confirmed' : 'operator-unconfirmed'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.evidenceGroundingConfidenceAudit,
          async () => {
            const errors = [];
            const routingRes = params.query
              ? await this.safeCall(
                  ctx,
                  'capability-broker.recommend',
                  { task: params.query },
                  null,
                  errors,
                  'capability-broker.recommend'
                )
              : null;
            const [datapointRes, vdmiRes, ragRes] = await Promise.all([
              this.safeCall(ctx, 'datapoint.health', {}, null, errors, 'datapoint.health'),
              this.safeCall(
                ctx,
                ACTION_VDMI_FINDINGS,
                { status: 'open', limit: 100 },
                null,
                errors,
                ACTION_VDMI_FINDINGS
              ),
              params.query
                ? this.safeCall(
                    ctx,
                    'knowledge-rag.query',
                    { query: params.query, domain: params.domain, limit: 5 },
                    null,
                    errors,
                    'knowledge-rag.query'
                  )
                : null,
            ]);

            return {
              ...this.buildEvidenceGroundingConfidenceAudit({
                params,
                routingRes,
                datapointRes,
                vdmiRes,
                ragRes,
                errors,
              }),
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }
        );
      },
    },

    // ── receiptGroundedPresentationContract ────────────────────────────────
    /**
     * GET /api/dashboard/receipt-grounded-presentation-contract?preferredFormat=...&sourceAction=...
     *
     * Read-only inspect path for the Personal-Agent presentation grounding
     * contract. It evaluates a supplied/synthetic evidence context without
     * executing tools, creating sessions, mutating datasources or calling an LLM.
     */
    receiptGroundedPresentationContract: {
      rest: 'GET /receipt-grounded-presentation-contract',
      params: {
        preferredFormat: { type: 'string', optional: true, default: 'auto' },
        selectedType: { type: 'string', optional: true },
        sourceAction: { type: 'string', optional: true },
        domainShape: {
          type: 'enum',
          optional: true,
          values: ['plain', 'vdmi_matrix', 'kpi_fact', 'evidence_gap', 'decision_brief'],
          default: 'plain',
        },
        evidenceGapId: { type: 'string', optional: true },
        query: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Receipt-grounded presentation contract — read-only renderer grounding check',
        description:
          'Evaluates whether a requested presentation renderer is grounded by the supplied ' +
          'domain shape, executed source action and evidence gaps. This is a deterministic ' +
          'inspect endpoint only; it does not run Personal-Agent chat, execute tools, create ' +
          'HITL/interface-placeholder items, mutate data, ingest RAG or call external services.',
        parameters: [
          { name: 'preferredFormat', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'selectedType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceAction', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'domainShape',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['plain', 'vdmi_matrix', 'kpi_fact', 'evidence_gap', 'decision_brief'],
            },
          },
          { name: 'evidenceGapId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'query', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Receipt-grounded presentation contract decision',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    contractId: { type: 'string' },
                    requestedType: { type: 'string', nullable: true },
                    selectedType: { type: 'string', nullable: true },
                    allowedTypes: { type: 'array', items: { type: 'string' } },
                    blockedReason: { type: 'string', nullable: true },
                    sourceActions: { type: 'array', items: { type: 'string' } },
                    evidenceGapIds: { type: 'array', items: { type: 'string' } },
                    positiveFollowUps: { type: 'array', items: { type: 'object' } },
                    dossierEvidence: { type: 'object' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `receipt-grounded-presentation-contract:${params.preferredFormat}:${params.selectedType || 'no-selected'}:${params.sourceAction || 'no-action'}:${params.domainShape}:${params.evidenceGapId || 'no-gap'}:${params.query || 'no-query'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.receiptGroundedPresentationContract,
          async () => {
            const sourceActions = params.sourceAction ? [params.sourceAction] : [];
            const domainResult = this.buildReceiptGroundingSyntheticDomain(params);
            const evidencePlan = params.evidenceGapId
              ? { gaps: [{ id: params.evidenceGapId, label: params.evidenceGapId }] }
              : null;
            const grounding = evaluatePresentationGrounding({
              requestedType: params.preferredFormat,
              selectedType: params.selectedType || null,
              domainResult,
              sourceActions,
              evidencePlan,
            });
            return {
              contractId: `rgpc:${Buffer.from(
                `${params.preferredFormat}:${params.sourceAction || ''}:${params.domainShape}`
              )
                .toString('base64url')
                .slice(0, 18)}`,
              requestedType: params.preferredFormat === 'auto' ? null : params.preferredFormat,
              selectedType: grounding.selectedType,
              allowedTypes: grounding.allowedTypes,
              blockedReason: grounding.blockedReason,
              sourceActions: grounding.sourceActions,
              evidenceGapIds: grounding.evidenceGapIds,
              basis: grounding.basis,
              positiveFollowUps: this.buildReceiptGroundingFollowUps(grounding),
              dossierEvidence: {
                selectedPresentationType: grounding.selectedType,
                allowedPresentationTypes: grounding.allowedTypes,
                blockedRendererReason: grounding.blockedReason,
                sourceActions: grounding.sourceActions,
                evidenceGapIds: grounding.evidenceGapIds,
              },
              timestamp: new Date().toISOString(),
              _errors: [],
            };
          }
        );
      },
    },

    // ── marketCommunicationEvidenceChainStatus ─────────────────────────────
    /**
     * GET /api/dashboard/market-communication-evidence-chain?maloId=...&includeHints=true
     *
     * Read-only dossier-safe status for Marktkommunikations-Evidenzketten.
     * It separates official MaKo/EDM/Settlement evidence from portal,
     * customer or provider hints and never releases billing or settlement.
     */
    marketCommunicationEvidenceChainStatus: {
      rest: 'GET /market-communication-evidence-chain',
      params: {
        maloId: { type: 'string', optional: true, min: 1 },
        meloId: { type: 'string', optional: true, min: 1 },
        contractAccountId: { type: 'string', optional: true, min: 1 },
        caseId: { type: 'string', optional: true, min: 1 },
        includeHints: { type: 'boolean', optional: true, convert: true, default: false },
        portalHint: { type: 'string', optional: true, min: 1 },
        providerView: { type: 'string', optional: true, min: 1 },
        customerStatement: { type: 'string', optional: true, min: 1 },
        utilmdMasterdataPath: { type: 'string', optional: true, min: 1 },
        meterValueBatchId: { type: 'string', optional: true, min: 1 },
        consumptionRetrievalStatus: { type: 'string', optional: true, min: 1 },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        nextBillingStep: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Market communication evidence chain — read-only dossier-safe status',
        description:
          'Classifies market-communication evidence for dynamic tariff, iMSys, consumption-data ' +
          'and billing-readiness cases. Portal screenshots, customer statements and provider views ' +
          'are hints only; official MaLo/MeLo, UTILMD/master-data path, meter values, consumption ' +
          'retrieval, data-quality status and next billing step remain separate required evidence. ' +
          'The endpoint is read-only and does not mutate MaKo, EDM, billing, settlement, VDMI or HITL state.',
        parameters: [
          { name: 'maloId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'meloId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'contractAccountId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'includeHints', in: 'query', required: false, schema: { type: 'boolean' } },
          { name: 'portalHint', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'providerView', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'customerStatement', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'utilmdMasterdataPath', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'meterValueBatchId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'consumptionRetrievalStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'nextBillingStep', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Read-only market-communication evidence-chain status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    officialEvidence: { type: 'array' },
                    hintsOnly: { type: 'array' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    dossierFacts: { type: 'array' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `market-communication-evidence-chain:${params.caseId || 'no-case'}:${params.maloId || 'no-malo'}:${params.meloId || 'no-melo'}:${params.contractAccountId || 'no-account'}:${params.includeHints ? 'hints' : 'no-hints'}:${params.utilmdMasterdataPath || 'no-utilmd'}:${params.meterValueBatchId || 'no-meter'}:${params.consumptionRetrievalStatus || 'no-consumption'}:${params.dataQualityStatus || 'no-quality'}:${params.nextBillingStep || 'no-next'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.marketCommunicationEvidenceChainStatus,
          async () => ({
            ...this.buildMarketCommunicationEvidenceChainStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── e2eControllabilityGovernanceStatus ────────────────────────────────
    /**
     * GET /api/dashboard/e2e-controllability-governance?connectionIntake=...
     *
     * Read-only dossier-safe governance matrix for E2E Steuerbarkeitscheck
     * handovers. It projects provided source facts into process-step evidence
     * and explicit gaps without creating VDMI/HITL items or executing control.
     */
    e2eControllabilityGovernanceStatus: {
      rest: 'GET /e2e-controllability-governance',
      params: {
        caseId: { type: 'string', optional: true, min: 1 },
        connectionIntake: { type: 'string', optional: true, min: 1 },
        meteringConcept: { type: 'string', optional: true, min: 1 },
        assetControlCapability: { type: 'string', optional: true, min: 1 },
        gridOperationsDecision: { type: 'string', optional: true, min: 1 },
        marketCommunicationHandover: { type: 'string', optional: true, min: 1 },
        billingImpactCheck: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        deadline: { type: 'string', optional: true, min: 1 },
        openMeasure: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'E2E controllability governance — read-only dossier-safe matrix',
        description:
          'Builds a deterministic governance/evidence matrix for E2E Steuerbarkeitscheck ' +
          'handover readiness across connection intake, metering, asset control, grid ' +
          'operations, market communication and billing-impact boundaries. The endpoint is ' +
          'read-only and does not mutate VDMI, HITL, MaKo, billing, settlement, tariff or device-control state.',
        parameters: [
          { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'connectionIntake', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'meteringConcept', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'assetControlCapability', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'gridOperationsDecision', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'marketCommunicationHandover', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'billingImpactCheck', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'deadline', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'openMeasure', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Read-only E2E controllability governance matrix',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    processSteps: { type: 'array' },
                    evidenceMatrix: { type: 'array' },
                    decisionBoundaries: { type: 'array' },
                    owners: { type: 'array' },
                    deadlines: { type: 'array' },
                    openMeasures: { type: 'array' },
                    gaps: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `e2e-controllability-governance:${params.caseId || 'no-case'}:${params.connectionIntake || 'no-connection'}:${params.meteringConcept || 'no-metering'}:${params.assetControlCapability || 'no-asset'}:${params.gridOperationsDecision || 'no-grid'}:${params.marketCommunicationHandover || 'no-mako'}:${params.billingImpactCheck || 'no-billing'}:${params.owner || 'no-owner'}:${params.deadline || 'no-deadline'}:${params.openMeasure || 'no-measure'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.e2eControllabilityGovernanceStatus,
          async () => ({
            ...this.buildE2eControllabilityGovernanceStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── controllabilityAssetHandoverStatus ────────────────────────────────
    /**
     * GET /api/dashboard/controllability-asset-handover?assetId=...
     *
     * Read-only dossier-safe line handover status for controllable assets.
     * It projects supplied asset, source and owner evidence into explicit
     * handover gaps without creating Asset-MDM, HITL or control mutations.
     */
    controllabilityAssetHandoverStatus: {
      rest: 'GET /controllability-asset-handover',
      params: {
        caseId: { type: 'string', optional: true, min: 1 },
        assetId: { type: 'string', optional: true, min: 1 },
        mastrId: { type: 'string', optional: true, min: 1 },
        napId: { type: 'string', optional: true, min: 1 },
        meloId: { type: 'string', optional: true, min: 1 },
        technologyType: { type: 'string', optional: true, min: 1 },
        capacityKW: { type: 'number', optional: true, convert: true },
        controllabilityScope: { type: 'string', optional: true, min: 1 },
        technicalStatus: { type: 'string', optional: true, min: 1 },
        feedbackCapability: { type: 'string', optional: true, min: 1 },
        dataSourceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceSnapshotId: { type: 'string', optional: true, min: 1 },
        checkStatus: { type: 'string', optional: true, min: 1 },
        nonExecutionReason: { type: 'string', optional: true, min: 1 },
        evidenceStatus: { type: 'string', optional: true, min: 1 },
        lineOwnerRole: { type: 'string', optional: true, min: 1 },
        handoverDecision: { type: 'string', optional: true, min: 1 },
        nextReportingCycle: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Controllability asset handover — read-only dossier-safe status',
        description:
          'Builds a deterministic asset line-handover evidence view for Steuerbarkeitscheck cases. ' +
          'It covers asset identity, NAP/MeLo mapping, technical status, feedback capability, source ' +
          'snapshot, check result, non-execution reason, line owner, next reporting cycle and handover ' +
          'decision. The endpoint is read-only and does not mutate Asset-MDM, VDMI, HITL, MaKo, billing, ' +
          'settlement, tariff or device-control state.',
        parameters: [
          { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'assetId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'mastrId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'napId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'meloId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'technologyType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'capacityKW', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'controllabilityScope', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'technicalStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'feedbackCapability', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataSourceRefs', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
          { name: 'sourceSnapshotId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'checkStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'nonExecutionReason', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'lineOwnerRole', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'handoverDecision', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'nextReportingCycle', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Read-only controllability asset line handover status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    asset: { type: 'object' },
                    evidenceItems: { type: 'array' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    handoverDecision: { type: 'string' },
                    lineOwnerRole: { type: 'string' },
                    nextReportingCycle: { type: 'string' },
                    blockingFindings: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `controllability-asset-handover:${params.caseId || 'no-case'}:${params.assetId || 'no-asset'}:${params.mastrId || 'no-mastr'}:${params.napId || 'no-nap'}:${params.meloId || 'no-melo'}:${params.technicalStatus || 'no-technical'}:${params.feedbackCapability || 'no-feedback'}:${params.lineOwnerRole || 'no-owner'}:${params.handoverDecision || 'no-decision'}:${params.nextReportingCycle || 'no-cycle'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.controllabilityAssetHandoverStatus,
          async () => ({
            ...this.buildControllabilityAssetHandoverStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── regulatoryChangeReadinessStatus ───────────────────────────────────
    /**
     * GET /api/dashboard/regulatory-change-readiness?changeId=...
     *
     * Read-only dossier-safe readiness gate for upcoming regulatory changes.
     * It models data, MaKo, billing and audit evidence needed before a
     * simulation can start, without implementing a legal/regulatory engine.
     */
    regulatoryChangeReadinessStatus: {
      rest: 'GET /regulatory-change-readiness',
      params: {
        changeId: { type: 'string', optional: true, min: 1 },
        effectiveDate: { type: 'string', optional: true, min: 1 },
        mechanismType: { type: 'string', optional: true, min: 1 },
        affectedSystems: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        dictionaryVersion: { type: 'string', optional: true, min: 1 },
        sourceDatapoints: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        intervalCoverage: { type: 'string', optional: true, min: 1 },
        masterDataStatus: { type: 'string', optional: true, min: 1 },
        substituteValuePolicy: { type: 'string', optional: true, min: 1 },
        makoCases: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        operatorDeclarationStatus: { type: 'string', optional: true, min: 1 },
        billingRuleReference: { type: 'string', optional: true, min: 1 },
        auditTrailStatus: { type: 'string', optional: true, min: 1 },
        testCasePackStatus: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Regulatory change readiness — read-only dossier-safe gate',
        description:
          'Builds a deterministic readiness/evidence contract for upcoming regulatory billing, EEG or ' +
          'refinancing mechanisms. The endpoint separates dictionary, datapoint, interval, master-data, ' +
          'substitute-value, MaKo, operator-declaration, billing-rule, audit and test-case evidence. It is ' +
          'read-only and does not run settlement, billing, MaKo dispatch, HITL, external connectors or legal interpretation.',
        parameters: [
          { name: 'changeId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'effectiveDate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'mechanismType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'affectedSystems', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
          { name: 'dictionaryVersion', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceDatapoints', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
          { name: 'intervalCoverage', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'masterDataStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'substituteValuePolicy', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'makoCases', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
          { name: 'operatorDeclarationStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'billingRuleReference', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'auditTrailStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'testCasePackStatus', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Read-only regulatory change readiness status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    evidenceItems: { type: 'array' },
                    missingEvidence: { type: 'array' },
                    generatedTestCaseRequirements: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    blockingFindings: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `regulatory-change-readiness:${params.changeId || 'no-change'}:${params.effectiveDate || 'no-date'}:${params.mechanismType || 'no-mechanism'}:${params.dictionaryVersion || 'no-dictionary'}:${params.intervalCoverage || 'no-interval'}:${params.masterDataStatus || 'no-masterdata'}:${params.substituteValuePolicy || 'no-substitute'}:${params.operatorDeclarationStatus || 'no-operator'}:${params.auditTrailStatus || 'no-audit'}:${params.testCasePackStatus || 'no-tests'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.regulatoryChangeReadinessStatus,
          async () => ({
            ...this.buildRegulatoryChangeReadinessStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── investmentTwoTrackControlStatus ───────────────────────────────────
    /**
     * GET /api/dashboard/investment-two-track-control?submissionId=...
     *
     * Read-only dossier-safe evidence view for separating tactical investment
     * submission readiness from the longer-term Asset Management / ISO-55001
     * target-process track. It does not create workflows or mutate finance,
     * SAP/PSP, settlement, billing, HITL, VDMI or Personal-Agent state.
     */
    investmentTwoTrackControlStatus: {
      rest: 'GET /investment-two-track-control',
      params: {
        submissionId: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        deadline: { type: 'string', optional: true, min: 1 },
        submissionFormat: { type: 'string', optional: true, min: 1 },
        tacticalOwner: { type: 'string', optional: true, min: 1 },
        targetOwner: { type: 'string', optional: true, min: 1 },
        financeReviewStatus: { type: 'string', optional: true, min: 1 },
        boardReadiness: { type: 'string', optional: true, min: 1 },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        approvalModel: { type: 'string', optional: true, min: 1 },
        handoverStatus: { type: 'string', optional: true, min: 1 },
        budgetEnvelopeEur: { type: 'number', optional: true, convert: true },
        measureCount: { type: 'number', optional: true, integer: true, convert: true, min: 0 },
        sourceDatapoints: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        blockedDecisions: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Investment two-track control — read-only dossier-safe status',
        description:
          'Builds a deterministic evidence/readiness view that separates tactical investment submission ' +
          'readiness from the target-process readiness track for Asset Management / ISO 55001 work. The ' +
          'endpoint is read-only and does not mutate Investment Planning, Finance, SAP/PSP, settlement, ' +
          'billing, MaKo, HITL, VDMI, external connector or Personal-Agent state.',
        parameters: [
          { name: 'submissionId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'deadline', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'submissionFormat', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'tacticalOwner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'targetOwner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'financeReviewStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'boardReadiness', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'approvalModel', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'handoverStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'budgetEnvelopeEur', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'measureCount', in: 'query', required: false, schema: { type: 'integer', minimum: 0 } },
          { name: 'sourceDatapoints', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
          { name: 'blockedDecisions', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only investment two-track control status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    tacticalTrack: { type: 'object' },
                    targetTrack: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    blockedDecisions: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `investment-two-track-control:${params.submissionId || 'no-submission'}:${params.gridOperatorId || 'no-grid'}:${params.deadline || 'no-deadline'}:${params.tacticalOwner || 'no-tactical-owner'}:${params.targetOwner || 'no-target-owner'}:${params.financeReviewStatus || 'no-finance'}:${params.boardReadiness || 'no-board'}:${params.dataQualityStatus || 'no-data'}:${params.approvalModel || 'no-approval'}:${params.handoverStatus || 'no-handover'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.investmentTwoTrackControlStatus,
          async () => ({
            ...this.buildInvestmentTwoTrackControlStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── sapBudgetPspGateStatus ────────────────────────────────────────────
    /**
     * GET /api/dashboard/sap-budget-psp-gate?measureId=...
     *
     * Read-only dossier-safe evidence view for SAP/PSP budget-gate readiness.
     * It treats SAP migration and PSP carry-over as evidence context only and
     * does not write SAP/PSP, finance, billing, settlement, MaKo, HITL, VDMI,
     * external connector or Personal-Agent state.
     */
    sapBudgetPspGateStatus: {
      rest: 'GET /sap-budget-psp-gate',
      params: {
        measureId: { type: 'string', optional: true, min: 1 },
        measureName: { type: 'string', optional: true, min: 1 },
        migrationWave: { type: 'string', optional: true, min: 1 },
        sapSystemRef: { type: 'string', optional: true, min: 1 },
        pspElementId: { type: 'string', optional: true, min: 1 },
        legacyInternalOrderId: { type: 'string', optional: true, min: 1 },
        assetBenefit: { type: 'string', optional: true, min: 1 },
        ownerRole: { type: 'string', optional: true, min: 1 },
        approvalStatus: { type: 'string', optional: true, min: 1 },
        financeGate: { type: 'string', optional: true, min: 1 },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        sourceSnapshotId: { type: 'string', optional: true, min: 1 },
        availableBudgetEur: { type: 'number', optional: true, convert: true },
        plannedValueEur: { type: 'number', optional: true, convert: true },
        committedValueEur: { type: 'number', optional: true, convert: true },
        pspCarryOverEur: { type: 'number', optional: true, convert: true },
        budgetOverhangEur: { type: 'number', optional: true, convert: true },
        priorityScore: { type: 'number', optional: true, convert: true },
        blockedDecisions: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'SAP Budget PSP Gate — read-only dossier-safe status',
        description:
          'Builds a deterministic SAP/PSP budget-gate evidence view for one investment measure. ' +
          'The endpoint is read-only and does not mutate SAP/PSP, Finance, investment workflow, ' +
          'billing, settlement, MaKo, HITL, VDMI, external connector or Personal-Agent state.',
        parameters: [
          { name: 'measureId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'measureName', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'migrationWave', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sapSystemRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'pspElementId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'legacyInternalOrderId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'assetBenefit', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'approvalStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'financeGate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSnapshotId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'availableBudgetEur', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'plannedValueEur', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'committedValueEur', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'pspCarryOverEur', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'budgetOverhangEur', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'priorityScore', in: 'query', required: false, schema: { type: 'number' } },
          { name: 'blockedDecisions', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only SAP/PSP budget-gate status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    measureContext: { type: 'object' },
                    budgetEvidence: { type: 'object' },
                    gateEvidence: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    blockedDecisions: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `sap-budget-psp-gate:${params.measureId || 'no-measure'}:${params.migrationWave || 'no-wave'}:${params.sapSystemRef || 'no-sap'}:${params.pspElementId || 'no-psp'}:${params.ownerRole || 'no-owner'}:${params.approvalStatus || 'no-approval'}:${params.financeGate || 'no-finance'}:${params.dataQualityStatus || 'no-data'}:${params.sourceSnapshotId || 'no-snapshot'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.sapBudgetPspGateStatus,
          async () => ({
            ...this.buildSapBudgetPspGateStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── energyTaxInformationPackageStatus ─────────────────────────────────
    /**
     * GET /api/dashboard/energy-tax-information-package?packageId=...
     *
     * Read-only dossier-safe evidence view for Energiesteuer/Finance data
     * handover packages. It validates package-contract evidence only and does
     * not calculate taxes, approve packages, copy raw data, or mutate Finance,
     * billing, settlement, MaKo, SAP, HITL, external connector or Personal-Agent
     * state.
     */
    energyTaxInformationPackageStatus: {
      rest: 'GET /energy-tax-information-package',
      params: {
        packageId: { type: 'string', optional: true, min: 1 },
        dataSourceId: { type: 'string', optional: true, min: 1 },
        dictionaryVersion: { type: 'string', optional: true, min: 1 },
        period: { type: 'string', optional: true, min: 1 },
        periodStart: { type: 'string', optional: true, min: 1 },
        periodEnd: { type: 'string', optional: true, min: 1 },
        aggregationLogic: { type: 'string', optional: true, min: 1 },
        validationStatus: { type: 'string', optional: true, min: 1 },
        responsibleOwner: { type: 'string', optional: true, min: 1 },
        contactRole: { type: 'string', optional: true, min: 1 },
        sla: { type: 'string', optional: true, min: 1 },
        auditReference: { type: 'string', optional: true, min: 1 },
        handoverDecision: { type: 'string', optional: true, min: 1 },
        evidenceStatus: { type: 'string', optional: true, min: 1 },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        sourceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Energy Tax Information Package — read-only dossier-safe status',
        description:
          'Builds a deterministic evidence view for an Energiesteuer/Finance information package. ' +
          'The endpoint is read-only and does not calculate tax, approve packages, copy raw data, or mutate ' +
          'Finance, billing, settlement, MaKo, SAP, HITL, external connector or Personal-Agent state.',
        parameters: [
          { name: 'packageId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataSourceId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dictionaryVersion', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'period', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'periodStart', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'periodEnd', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'aggregationLogic', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'validationStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'responsibleOwner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'contactRole', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sla', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'auditReference', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'handoverDecision', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceRefs', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only energy-tax information-package status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    packageContext: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceEvidence: { type: 'object' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `energy-tax-information-package:${params.packageId || 'no-package'}:${params.dataSourceId || 'no-source'}:${params.dictionaryVersion || 'no-dictionary'}:${params.period || params.periodStart || 'no-period'}:${params.validationStatus || 'no-validation'}:${params.responsibleOwner || 'no-owner'}:${params.handoverDecision || 'no-decision'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.energyTaxInformationPackageStatus,
          async () => ({
            ...this.buildEnergyTaxInformationPackageStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── investmentRiskTranslationStatus ─────────────────────────────────
    /**
     * GET /api/dashboard/investment-risk-translation?sourceRef=...
     *
     * Read-only dossier-safe evidence view for GF slides, risk-register items,
     * monthly reports and workshop anchors before they become investment/risk
     * handovers. It does not create VDMI tasks, HITL items, Finance-Agent runs,
     * Investment Planning measures, SAP/PSP writes, external calls or
     * Personal-Agent execution.
     */
    investmentRiskTranslationStatus: {
      rest: 'GET /investment-risk-translation',
      params: {
        sourceRef: { type: 'string', optional: true, min: 1 },
        sourceType: { type: 'string', optional: true, min: 1 },
        period: { type: 'string', optional: true, min: 1 },
        division: { type: 'string', optional: true, min: 1 },
        classification: { type: 'string', optional: true, min: 1 },
        financialImpact: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        assetImpact: { type: 'string', optional: true, min: 1 },
        ownerRole: { type: 'string', optional: true, min: 1 },
        decisionReadiness: { type: 'string', optional: true, min: 1 },
        blockedDecisionId: { type: 'string', optional: true, min: 1 },
        nextAction: { type: 'string', optional: true, min: 1 },
        sourceSnapshot: { type: 'string', optional: true, min: 1 },
        evidenceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        forbiddenAssumptions: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        budgetRef: { type: 'string', optional: true, min: 1 },
        riskRef: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Investment Risk Translation — read-only dossier-safe status',
        description:
          'Builds a deterministic evidence view for investment/risk translation material. ' +
          'The endpoint is read-only and does not create VDMI, HITL, Finance, Investment Planning, SAP/PSP, external connector or Personal-Agent side effects.',
        parameters: [
          { name: 'sourceRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'period', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'division', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'classification', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'financialImpact', in: 'query', required: false, schema: { oneOf: [{ type: 'number' }, { type: 'string' }] } },
          { name: 'assetImpact', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'decisionReadiness', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'blockedDecisionId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'nextAction', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSnapshot', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceRefs', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only investment-risk translation status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    translationContext: { type: 'object' },
                    handoverContext: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `investment-risk-translation:${params.sourceRef || 'no-source'}:${params.sourceType || 'no-type'}:${params.period || 'no-period'}:${params.classification || 'no-class'}:${params.ownerRole || 'no-owner'}:${params.decisionReadiness || 'no-readiness'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.investmentRiskTranslationStatus,
          async () => ({
            ...this.buildInvestmentRiskTranslationStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── budgetWaterfallGovernanceStatus ─────────────────────────────────
    /**
     * GET /api/dashboard/budget-waterfall-governance?waterfallId=...
     *
     * Read-only dossier-safe evidence gate for budget-waterfall governance.
     * It validates baseline, sign convention, carry-over logic, forecast
     * cutoff, division mapping and approval evidence without creating
     * Finance, SAP/PSP, Investment Planning, HITL, external connector or
     * Personal-Agent side effects.
     */
    budgetWaterfallGovernanceStatus: {
      rest: 'GET /budget-waterfall-governance',
      params: {
        waterfallId: { type: 'string', optional: true, min: 1 },
        sourceId: { type: 'string', optional: true, min: 1 },
        period: { type: 'string', optional: true, min: 1 },
        division: { type: 'string', optional: true, min: 1 },
        baselineRef: { type: 'string', optional: true, min: 1 },
        forecastCutoff: { type: 'string', optional: true, min: 1 },
        carryoverLogic: { type: 'string', optional: true, min: 1 },
        signConvention: { type: 'string', optional: true, min: 1 },
        ownerRole: { type: 'string', optional: true, min: 1 },
        approvalStatus: { type: 'string', optional: true, min: 1 },
        followUpDecision: { type: 'string', optional: true, min: 1 },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Budget Waterfall Governance — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for budget-waterfall governance. ' +
          'The endpoint is read-only and does not create Finance, SAP/PSP, Investment Planning, settlement, billing, MaKo, HITL, external connector or Personal-Agent side effects.',
        parameters: [
          { name: 'waterfallId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'period', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'division', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'baselineRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'forecastCutoff', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'carryoverLogic', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'signConvention', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'approvalStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'followUpDecision', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceRef', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only budget-waterfall governance status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    waterfallContext: { type: 'object' },
                    governanceEvidence: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `budget-waterfall-governance:${params.waterfallId || params.sourceId || 'no-source'}:${params.period || 'no-period'}:${params.division || 'no-division'}:${params.baselineRef || 'no-baseline'}:${params.forecastCutoff || 'no-cutoff'}:${params.approvalStatus || 'no-approval'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.budgetWaterfallGovernanceStatus,
          async () => ({
            ...this.buildBudgetWaterfallGovernanceStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── gasDecommissioningRoadmapStatus ─────────────────────────────────
    /**
     * GET /api/dashboard/gas-decommissioning-roadmap?roadmapId=...
     *
     * Read-only dossier-safe evidence gate for gas-network decommissioning
     * roadmaps. It validates phase, owner, dependency, investment-impact,
     * committee-gate and execution-handover evidence without creating a gas
     * transformation backend, HITL item, finance/SAP mutation, external call
     * or Personal-Agent side effect.
     */
    gasDecommissioningRoadmapStatus: {
      rest: 'GET /gas-decommissioning-roadmap',
      params: {
        roadmapId: { type: 'string', optional: true, min: 1 },
        currentPhase: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        assetRiskEvidence: { type: 'string', optional: true, min: 1 },
        dependencyMap: { type: 'string', optional: true, min: 1 },
        investmentImpactRef: { type: 'string', optional: true, min: 1 },
        committeeGateDate: { type: 'string', optional: true, min: 1 },
        executionHandoverOwner: { type: 'string', optional: true, min: 1 },
        nextDecisionGate: { type: 'string', optional: true, min: 1 },
        blocker: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Gas Decommissioning Roadmap — read-only dossier-safe status',
        description:
          'Builds a deterministic evidence view for gas-network decommissioning roadmap readiness. ' +
          'The endpoint is read-only and does not create gas-transformation, finance, SAP, investment, HITL, external connector or Personal-Agent side effects.',
        parameters: [
          { name: 'roadmapId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'currentPhase', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'assetRiskEvidence', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dependencyMap', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'investmentImpactRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'committeeGateDate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'executionHandoverOwner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'nextDecisionGate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'blocker', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
          { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceRef', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only gas decommissioning roadmap status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    roadmapContext: { type: 'object' },
                    phaseEvidence: { type: 'object' },
                    dependencies: { type: 'object' },
                    blockers: { type: 'array' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `gas-decommissioning-roadmap:${params.roadmapId || 'no-roadmap'}:${params.currentPhase || 'no-phase'}:${params.owner || 'no-owner'}:${params.dependencyMap || 'no-dependencies'}:${params.committeeGateDate || 'no-gate'}:${params.executionHandoverOwner || 'no-handover'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.gasDecommissioningRoadmapStatus,
          async () => ({
            ...this.buildGasDecommissioningRoadmapStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── jourFixeDecisionClosureStatus ─────────────────────────────────────
    /**
     * GET /api/dashboard/jour-fixe-decision-closure?topicId=...
     *
     * Read-only dossier-safe evidence gate for recurring Jour-fixe decision
     * closure. It validates topic, owner, KPI, decision criterion, next gate,
     * closure proof and blocked follow-up evidence without creating meeting,
     * VDMI, NOVA, HITL, external connector or Personal-Agent side effects.
     */
    jourFixeDecisionClosureStatus: {
      rest: 'GET /jour-fixe-decision-closure',
      params: {
        topicId: { type: 'string', optional: true, min: 1 },
        topicTitle: { type: 'string', optional: true, min: 1 },
        jourFixeId: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        kpi: { type: 'string', optional: true, min: 1 },
        decisionCriterion: { type: 'string', optional: true, min: 1 },
        nextGate: { type: 'string', optional: true, min: 1 },
        closureStatus: { type: 'string', optional: true, min: 1 },
        closureProof: { type: 'string', optional: true, min: 1 },
        blockedFollowUpAction: { type: 'string', optional: true, min: 1 },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Jour-Fixe Decision Closure — read-only dossier-safe status',
        description:
          'Builds a deterministic evidence view for Jour-fixe topic closure. ' +
          'The endpoint is read-only and does not create meeting, VDMI, NOVA, HITL, external connector or Personal-Agent side effects.',
        parameters: [
          { name: 'topicId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'topicTitle', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'jourFixeId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'kpi', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'decisionCriterion', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'nextGate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'closureStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'closureProof', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'blockedFollowUpAction', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceRef', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only Jour-fixe decision closure status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    topic: { type: 'object' },
                    closureEvidence: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `jour-fixe-decision-closure:${params.topicId || params.topicTitle || 'no-topic'}:${params.jourFixeId || 'no-jf'}:${params.owner || 'no-owner'}:${params.closureStatus || 'no-status'}:${params.nextGate || 'no-gate'}:${params.closureProof || 'no-proof'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.jourFixeDecisionClosureStatus,
          async () => ({
            ...this.buildJourFixeDecisionClosureStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── offBalancingMeteringPruefmatrixStatus ─────────────────────────────
    /**
     * GET /api/dashboard/off-balancing-metering-pruefmatrix?matrixId=...
     *
     * Read-only dossier-safe evidence gate for off-balancing metering options.
     * It validates financing, regulatory, data-quality, interface-risk and
     * usable grid-investment-headroom evidence without creating finance, SAP,
     * investment, settlement, billing, MaKo, HITL, external connector or
     * Personal-Agent side effects.
     */
    offBalancingMeteringPruefmatrixStatus: {
      rest: 'GET /off-balancing-metering-pruefmatrix',
      params: {
        matrixId: { type: 'string', optional: true, min: 1 },
        meteringScope: { type: 'string', optional: true, min: 1 },
        financingModel: { type: 'string', optional: true, min: 1 },
        decisionOwner: { type: 'string', optional: true, min: 1 },
        committeeGate: { type: 'string', optional: true, min: 1 },
        capexOpexBaseline: { type: 'string', optional: true, min: 1 },
        eogEffectEvidence: { type: 'string', optional: true, min: 1 },
        regulatoryEffectEvidence: { type: 'string', optional: true, min: 1 },
        costRecognitionAssumption: { type: 'string', optional: true, min: 1 },
        financierConditions: { type: 'string', optional: true, min: 1 },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        interfaceRiskStatus: { type: 'string', optional: true, min: 1 },
        gridInvestmentSpaceProof: { type: 'string', optional: true, min: 1 },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Off-Balancing Metering Pruefmatrix — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for off-balancing metering option readiness. ' +
          'The endpoint is read-only and does not create finance, SAP, investment, settlement, billing, MaKo, HITL, external connector or Personal-Agent side effects.',
        parameters: [
          { name: 'matrixId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'meteringScope', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'financingModel', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'decisionOwner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'committeeGate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'capexOpexBaseline', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'eogEffectEvidence', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'regulatoryEffectEvidence', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'costRecognitionAssumption', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'financierConditions', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'interfaceRiskStatus', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'gridInvestmentSpaceProof', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceRef', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only off-balancing metering pruefmatrix status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    matrixContext: { type: 'object' },
                    financingEvidence: { type: 'object' },
                    gridInvestmentVerdict: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `off-balancing-metering:${params.matrixId || 'no-matrix'}:${params.meteringScope || 'no-scope'}:${params.financingModel || 'no-model'}:${params.decisionOwner || 'no-owner'}:${params.gridInvestmentSpaceProof || 'no-grid-proof'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.offBalancingMeteringPruefmatrixStatus,
          async () => ({
            ...this.buildOffBalancingMeteringPruefmatrixStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── automationRequirementsDecisionValueStatus ─────────────────────────
    /**
     * GET /api/dashboard/automation-requirements-decision-value?requirementId=...
     *
     * Read-only dossier-safe evidence gate for automation/dashboard wishes.
     * It validates whether an automation requirement has source, data-flow,
     * effort, control-point, decision-value, follow-up, data-quality and
     * rollback evidence without creating workflow, Office/BI, HITL, VDMI,
     * ticket or external connector side effects.
     */
    automationRequirementsDecisionValueStatus: {
      rest: 'GET /automation-requirements-decision-value',
      params: {
        requirementId: { type: 'string', optional: true, min: 1 },
        requestTitle: { type: 'string', optional: true, min: 1 },
        requestType: { type: 'string', optional: true, min: 1 },
        processArea: { type: 'string', optional: true, min: 1 },
        decisionOwner: { type: 'string', optional: true, min: 1 },
        targetGate: { type: 'string', optional: true, min: 1 },
        sourceSystem: { type: 'string', optional: true, min: 1 },
        movingDataFlow: { type: 'string', optional: true, min: 1 },
        manualEffort: { type: 'string', optional: true, min: 1 },
        controlPoint: { type: 'string', optional: true, min: 1 },
        decisionValue: { type: 'string', optional: true, min: 1 },
        followUpProcess: { type: 'string', optional: true, min: 1 },
        dataQuality: { type: 'string', optional: true, min: 1 },
        rollbackOrStopCriterion: { type: 'string', optional: true, min: 1 },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Automation Requirements Decision Value — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for automation, dashboard, PowerBI or workflow wishes. ' +
          'The endpoint is read-only and does not create Office/BI workflows, tickets, HITL items, VDMI mutations, external connectors or production side effects.',
        parameters: [
          { name: 'requirementId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'requestTitle', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'requestType', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'processArea', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'decisionOwner', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'targetGate', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSystem', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'movingDataFlow', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'manualEffort', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'controlPoint', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'decisionValue', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'followUpProcess', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'dataQuality', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'rollbackOrStopCriterion', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'evidenceRef', in: 'query', required: false, schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] } },
        ],
        responses: {
          200: {
            description: 'Read-only automation requirements decision-value status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    readinessScore: { type: 'number' },
                    requirementContext: { type: 'object' },
                    decisionEvidence: { type: 'object' },
                    missingEvidence: { type: 'array' },
                    positiveFollowUps: { type: 'array' },
                    sourceActions: { type: 'object' },
                    dossierEvidence: { type: 'object' },
                    safety: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `automation-requirements:${params.requirementId || 'no-id'}:${params.requestTitle || 'no-title'}:${params.requestType || 'no-type'}:${params.processArea || 'no-area'}:${params.decisionValue || 'no-value'}:${params.followUpProcess || 'no-follow-up'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.automationRequirementsDecisionValueStatus,
          async () => ({
            ...this.buildAutomationRequirementsDecisionValueStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── smartMeterOffBalancingPurposeLockStatus ───────────────────────────
    /**
     * GET /api/dashboard/smart-meter-off-balancing-purpose-lock?caseId=...
     *
     * Read-only dossier-safe evidence gate for smart-meter off-balancing
     * purpose locks. It validates whether freed liquidity is visibly bound to
     * control-room, process and grid-infrastructure value without creating
     * finance, SAP, investment, billing, settlement, MaKo, HITL, external or
     * Personal-Agent side effects.
     */
    smartMeterOffBalancingPurposeLockStatus: {
      rest: 'GET /smart-meter-off-balancing-purpose-lock',
      params: {
        caseId: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        assetScope: { type: 'string', optional: true, min: 1 },
        financingModel: { type: 'string', optional: true, min: 1 },
        offBalanceVolumeEur: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        freedLiquidityEur: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        financierCostEur: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        capexOpexTotexEffect: { type: 'string', optional: true, min: 1 },
        regulatoryRecognitionStatus: { type: 'string', optional: true, min: 1 },
        purposeLockedMeasures: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        controlRoomInvestments: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        processInvestments: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        gridInfrastructureInvestments: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        budgetDilutionRisk: { type: 'string', optional: true, min: 1 },
        financeReviewStatus: { type: 'string', optional: true, min: 1 },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Smart Meter Off-Balancing Purpose Lock — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for smart-meter off-balancing purpose-lock readiness. ' +
          'The endpoint is read-only and does not create finance, SAP, investment, billing, settlement, MaKo, HITL, external connector or Personal-Agent side effects.',
        responses: {
          200: {
            description: 'Read-only smart-meter off-balancing purpose-lock status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `smart-meter-purpose-lock:${params.caseId || 'no-case'}:${params.assetScope || 'no-asset'}:${params.financingModel || 'no-model'}:${params.financeReviewStatus || 'no-review'}:${params.budgetDilutionRisk || 'no-dilution'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.smartMeterOffBalancingPurposeLockStatus,
          async () => ({
            ...this.buildSmartMeterOffBalancingPurposeLockStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── imsysScheduleValueChainReadinessStatus ────────────────────────────
    /**
     * GET /api/dashboard/imsys-schedule-value-chain-readiness?caseId=...
     *
     * Read-only dossier-safe evidence gate for the iMSys/CLS Fahrplan value
     * chain. It projects metering, datapoint, forecast, congestion, asset/flex
     * and control-room handover evidence into a readiness status without
     * executing device, grid-control, HITL, MaKo, billing or external actions.
     */
    imsysScheduleValueChainReadinessStatus: {
      rest: 'GET /imsys-schedule-value-chain-readiness',
      params: {
        caseId: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        meteringScope: { type: 'string', optional: true, min: 1 },
        sourceDatapoints: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        forecastWindow: { type: 'string', optional: true, min: 1 },
        congestionSignal: { type: 'string', optional: true, min: 1 },
        assetScope: { type: 'string', optional: true, min: 1 },
        controllabilityStatus: { type: 'string', optional: true, min: 1 },
        flexibilityOptions: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        netzfahrplanAssessmentRef: { type: 'string', optional: true, min: 1 },
        operationalDecision: { type: 'string', optional: true, min: 1 },
        controlReadiness: { type: 'string', optional: true, min: 1 },
        lineOwnerRole: { type: 'string', optional: true, min: 1 },
        sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
        evidenceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'iMSys schedule value-chain readiness — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for iMSys/CLS schedule value-chain readiness. ' +
          'The endpoint is read-only and does not execute device control, grid operations, HITL, MaKo, billing, settlement, external connector or Personal-Agent actions.',
        responses: {
          200: {
            description: 'Read-only iMSys schedule value-chain readiness status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `imsys-schedule:${params.caseId || 'no-case'}:${params.meteringScope || 'no-scope'}:${params.forecastWindow || 'no-forecast'}:${params.assetScope || 'no-asset'}:${params.controlReadiness || 'no-control'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.imsysScheduleValueChainReadinessStatus,
          async () => ({
            ...this.buildImsysScheduleValueChainReadinessStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── clsDigitalTwinComplianceGateStatus ───────────────────────────────
    /**
     * GET /api/dashboard/cls-digital-twin-compliance-gate?procurementId=...
     *
     * Read-only dossier-safe evidence gate for CLS/digital-twin procurement.
     * It exposes compliance readiness and missing evidence without approving
     * vendors, creating DSFA/RBAC/HITL workflows, or executing CLS/SMGW/device
     * control, billing, MaKo, external connector or Personal-Agent actions.
     */
    clsDigitalTwinComplianceGateStatus: {
      rest: 'GET /cls-digital-twin-compliance-gate',
      params: {
        procurementId: { type: 'string', optional: true, min: 1 },
        vendorId: { type: 'string', optional: true, min: 1 },
        systemPurpose: { type: 'string', optional: true, min: 1 },
        digitalTwinScope: { type: 'string', optional: true, min: 1 },
        clsInterfaceScope: { type: 'string', optional: true, min: 1 },
        dataFlowMap: { type: 'string', optional: true, min: 1 },
        personalDataCategories: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        rolesAccessRights: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        rbacRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        avvStatus: { type: 'string', optional: true, min: 1 },
        ndaStatus: { type: 'string', optional: true, min: 1 },
        worksCouncilStatus: { type: 'string', optional: true, min: 1 },
        dsfaStatus: { type: 'string', optional: true, min: 1 },
        billingModuleImpact: { type: 'string', optional: true, min: 1 },
        regulatoryEvidenceStatus: { type: 'string', optional: true, min: 1 },
        securityEvidenceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        approvalStatus: { type: 'string', optional: true, min: 1 },
        sourceEvidenceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceSnapshot: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'CLS Digital Twin Compliance Gate — read-only dossier-safe status',
        description:
          'Builds a deterministic evidence view for CLS/digital-twin procurement readiness. ' +
          'The endpoint is read-only and does not create procurement, legal, DSFA, RBAC, HITL, billing, settlement, MaKo, CLS, SMGW, device-control, external connector or Personal-Agent side effects.',
        responses: {
          200: {
            description: 'Read-only CLS digital-twin compliance gate status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `cls-digital-twin-compliance:${params.procurementId || 'no-procurement'}:${params.vendorId || 'no-vendor'}:${params.systemPurpose || 'no-purpose'}:${params.dataFlowMap || 'no-data-flow'}:${params.approvalStatus || 'no-approval'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.clsDigitalTwinComplianceGateStatus,
          async () => ({
            ...this.buildClsDigitalTwinComplianceGateStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── legacyControlTechnologyTransitionStatus ─────────────────────────
    /**
     * GET /api/dashboard/legacy-control-technology-transition?assetGroupId=...
     *
     * Read-only dossier-safe evidence gate for legacy Rundsteuertechnik /
     * Gruppensignal transition logic. It exposes feedback, testability,
     * switching-risk and roadmap evidence without executing grid control,
     * CLS/SMGW/device actions, HITL, settlement, MaKo or Personal-Agent paths.
     */
    legacyControlTechnologyTransitionStatus: {
      rest: 'GET /legacy-control-technology-transition',
      params: {
        assetGroupId: { type: 'string', optional: true, min: 1 },
        assetId: { type: 'string', optional: true, min: 1 },
        gridOperatorId: { type: 'string', optional: true, min: 1 },
        powerClass: { type: 'string', optional: true, min: 1 },
        controlTechnology: { type: 'string', optional: true, min: 1 },
        feedbackCapability: { type: 'string', optional: true, min: 1 },
        switchingRisk: { type: 'string', optional: true, min: 1 },
        testFeasibility: { type: 'string', optional: true, min: 1 },
        testStatus: { type: 'string', optional: true, min: 1 },
        nonExecutionReason: { type: 'string', optional: true, min: 1 },
        targetTechnology: { type: 'string', optional: true, min: 1 },
        migrationRoadmap: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextAction: { type: 'string', optional: true, min: 1 },
        sourceEvidenceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceSnapshot: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Legacy control technology transition — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for Rundsteuertechnik/Gruppensignal transition readiness. ' +
          'The endpoint is read-only and does not execute grid control, CLS, SMGW, device-control, HITL, settlement, MaKo, external connector or Personal-Agent side effects.',
        responses: {
          200: {
            description: 'Read-only legacy control technology transition status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `legacy-control-transition:${params.assetGroupId || 'no-group'}:${params.assetId || 'no-asset'}:${params.controlTechnology || 'no-tech'}:${params.feedbackCapability || 'no-feedback'}:${params.testStatus || 'no-test'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.legacyControlTechnologyTransitionStatus,
          async () => ({
            ...this.buildLegacyControlTechnologyTransitionStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── controllabilitySubmissionCockpitStatus ──────────────────────────
    /**
     * GET /api/dashboard/controllability-submission-cockpit?submissionId=...
     *
     * Read-only dossier-safe evidence gate for Steuerbarkeitscheck submission
     * and handover work. It exposes source, reconciliation, reasoning, asset
     * group, open-measure and handover evidence without creating queues,
     * submitting deadlines, executing controls or mutating market processes.
     */
    controllabilitySubmissionCockpitStatus: {
      rest: 'GET /controllability-submission-cockpit',
      params: {
        submissionId: { type: 'string', optional: true, min: 1 },
        submissionDeadline: { type: 'string', optional: true, min: 1 },
        coordinator: { type: 'string', optional: true, min: 1 },
        sourceList: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        dataReconciliationStatus: { type: 'string', optional: true, min: 1 },
        reasonCatalog: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        assetGroupStatuses: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        openMeasures: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        handoverDecision: { type: 'string', optional: true, min: 1 },
        handoverOwner: { type: 'string', optional: true, min: 1 },
        nextCycleTasks: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        deadlineRisks: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceEvidenceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceSnapshot: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Controllability submission cockpit — read-only dossier-safe gate',
        description:
          'Builds a deterministic evidence view for Steuerbarkeitscheck submission readiness and handover. ' +
          'The endpoint is read-only and does not create HITL items, submit filings, execute grid, CLS, SMGW or device control, mutate MaKo, billing, settlement or tariff processes, call external connectors, or use Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only controllability submission cockpit status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `controllability-submission:${params.submissionId || 'no-submission'}:${params.coordinator || 'no-coordinator'}:${params.dataReconciliationStatus || 'no-reconciliation'}:${params.handoverDecision || 'no-handover'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.controllabilitySubmissionCockpitStatus,
          async () => ({
            ...this.buildControllabilitySubmissionCockpitStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── crisisDecisionRoutineStatus ─────────────────────────────────────
    /**
     * GET /api/dashboard/crisis-decision-routine?topic=...
     *
     * Read-only dossier-safe management routine for ad-hoc/crisis topics. It
     * turns crisis signals into decision-readiness evidence without creating
     * VDMI/NOVA/HITL work items, mutating finance data, dispatching operations,
     * calling external systems or introducing Personal-Agent shortcuts.
     */
    crisisDecisionRoutineStatus: {
      rest: 'GET /crisis-decision-routine',
      params: {
        caseId: { type: 'string', optional: true, min: 1 },
        topic: { type: 'string', optional: true, min: 1 },
        serviceImpact: { type: 'string', optional: true, min: 1 },
        populationImpact: { type: 'string', optional: true, min: 1 },
        requiredMeasures: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        financeImpact: { type: 'string', optional: true, min: 1 },
        knowledgeState: { type: 'string', optional: true, min: 1 },
        trainingNeed: { type: 'string', optional: true, min: 1 },
        operatingModelNeed: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextGate: { type: 'string', optional: true, min: 1 },
        blockedFollowUp: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        decisionDeadline: { type: 'string', optional: true, min: 1 },
        sourceEvidenceRefs: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        sourceSnapshot: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Crisis decision routine — read-only dossier-safe management gate',
        description:
          'Builds deterministic management-readiness evidence for crisis/ad-hoc topics. ' +
          'The endpoint is read-only and does not create HITL, NOVA or VDMI items, mutate finance or operations data, call external connectors, close decisions, dispatch operational actions, or use Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only crisis decision routine status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `crisis-decision-routine:${params.caseId || 'no-case'}:${params.topic || 'no-topic'}:${params.owner || 'no-owner'}:${params.nextGate || 'no-gate'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.crisisDecisionRoutineStatus,
          async () => ({
            ...this.buildCrisisDecisionRoutineStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── investmentCommitteeSteeringCardsStatus ───────────────────────────
    /**
     * GET /api/dashboard/investment-committee-steering-cards?investmentItemId=...
     *
     * Read-only dossier-safe investment committee card view. It classifies
     * supplied investment/card evidence without creating HITL, VDMI or
     * investment-plan records, mutating finance data, releasing budgets,
     * calling external systems or introducing Personal-Agent shortcuts.
     */
    investmentCommitteeSteeringCardsStatus: {
      rest: 'GET /investment-committee-steering-cards',
      params: {
        investmentItemId: { type: 'string', optional: true, min: 1 },
        projectId: { type: 'string', optional: true, min: 1 },
        assetId: { type: 'string', optional: true, min: 1 },
        reviewStatus: { type: 'string', optional: true, min: 1 },
        evidenceStatus: { type: 'string', optional: true, min: 1 },
        committeeWindow: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        blockedFollowUpAction: { type: 'string', optional: true, min: 1 },
        capexEur: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        riskFlag: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Investment committee steering cards — read-only dossier-safe status',
        description:
          'Builds deterministic investment committee steering-card evidence. ' +
          'The endpoint is read-only and does not create HITL, VDMI or investment-plan records, mutate finance data, release budgets, call external connectors, trigger billing/settlement/tariff/payment effects, or use Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only investment committee steering card status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `investment-committee-steering-cards:${params.investmentItemId || 'no-item'}:${params.projectId || 'no-project'}:${params.assetId || 'no-asset'}:${params.owner || 'no-owner'}:${params.committeeWindow || 'no-window'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.investmentCommitteeSteeringCardsStatus,
          async () => ({
            ...this.buildInvestmentCommitteeSteeringCardsStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── investmentDataReviewQueueStatus ──────────────────────────────────
    /**
     * GET /api/dashboard/investment-data-review-queue?sourceId=...
     *
     * Read-only dossier-safe Investdaten-Pruefqueue view. It normalizes
     * supplied source/data-package evidence without creating HITL, VDMI,
     * investment-plan, finance, budget, settlement or external side effects.
     */
    investmentDataReviewQueueStatus: {
      rest: 'GET /investment-data-review-queue',
      params: {
        sourceId: { type: 'string', optional: true, min: 1 },
        dataPackageId: { type: 'string', optional: true, min: 1 },
        assetRef: { type: 'string', optional: true, min: 1 },
        projectRef: { type: 'string', optional: true, min: 1 },
        qualityStatus: { type: 'string', optional: true, min: 1 },
        division: { type: 'string', optional: true, min: 1 },
        bottleneckRef: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        committeeWindow: { type: 'string', optional: true, min: 1 },
        blockedDecision: { type: 'string', optional: true, min: 1 },
        reviewStatus: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Investment data review queue — read-only dossier-safe status',
        description:
          'Builds deterministic Investdaten-Pruefqueue evidence. ' +
          'The endpoint is read-only and does not create HITL tickets, VDMI records, investment plans, finance records, budget releases, settlement/billing/tariff effects, external connector calls, or Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only investment data review queue status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const sourceRef = params.sourceId || params.dataPackageId || 'no-source';
        const assetOrProject = params.assetRef || params.projectRef || 'no-asset-project';
        const cacheKey = `investment-data-review-queue:${sourceRef}:${assetOrProject}:${params.owner || 'no-owner'}:${params.committeeWindow || 'no-window'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.investmentDataReviewQueueStatus,
          async () => ({
            ...this.buildInvestmentDataReviewQueueStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── flexStrategicDemandIntakeStatus ──────────────────────────────────
    /**
     * GET /api/dashboard/flex-strategic-demand-intake?topic=...
     *
     * Read-only dossier-safe strategic Flex/Fahrplanmanagement intake view.
     * It normalizes supplied demand evidence without creating VDMI, HITL,
     * NOVA, finance, tariff, settlement, device-control or external effects.
     */
    flexStrategicDemandIntakeStatus: {
      rest: 'GET /flex-strategic-demand-intake',
      params: {
        demandId: { type: 'string', optional: true, min: 1 },
        caseId: { type: 'string', optional: true, min: 1 },
        topic: { type: 'string', optional: true, min: 1 },
        demandTopic: { type: 'string', optional: true, min: 1 },
        affectedProcess: { type: 'string', optional: true, min: 1 },
        riskOfInaction: { type: 'string', optional: true, min: 1 },
        commercialQuestion: { type: 'string', optional: true, min: 1 },
        resourceConflict: { type: 'string', optional: true, min: 1 },
        stopDoingOption: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextDecisionGate: { type: 'string', optional: true, min: 1 },
        blockedFollowUp: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        flexContext: { type: 'string', optional: true, min: 1 },
        znpContext: { type: 'string', optional: true, min: 1 },
        novaContext: { type: 'string', optional: true, min: 1 },
        financeContext: { type: 'string', optional: true, min: 1 },
        vdmiContext: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Strategic Flex demand intake — read-only dossier-safe status',
        description:
          'Builds deterministic strategic Flex/Fahrplanmanagement demand-intake evidence. ' +
          'The endpoint is read-only and does not create VDMI cards, HITL tickets, NOVA decisions, finance records, tariff/billing/settlement/device-control effects, external connector calls, or Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only strategic Flex demand intake status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const topic = params.topic || params.demandTopic || 'no-topic';
        const cacheKey = `flex-strategic-demand-intake:${params.demandId || params.caseId || 'no-id'}:${topic}:${params.owner || 'no-owner'}:${params.nextDecisionGate || 'no-gate'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.flexStrategicDemandIntakeStatus,
          async () => ({
            ...this.buildFlexStrategicDemandIntakeStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── gasInfrastructureRiskGovernanceStatus ───────────────────────────
    /**
     * GET /api/dashboard/gas-infrastructure-risk-governance?caseId=...
     *
     * Read-only dossier-safe gas infrastructure risk governance view. It
     * normalizes supplied technical/risk evidence without creating gas risk
     * registers, HITL, VDMI, Asset-MDM, operations, monitoring or mitigation
     * side effects.
     */
    gasInfrastructureRiskGovernanceStatus: {
      rest: 'GET /gas-infrastructure-risk-governance',
      params: {
        caseId: { type: 'string', optional: true, min: 1 },
        technicalFact: { type: 'string', optional: true, min: 1 },
        impactArea: { type: 'string', optional: true, min: 1 },
        probability: { type: 'string', optional: true, min: 1 },
        criticality: { type: 'string', optional: true, min: 1 },
        existingMitigation: { type: 'string', optional: true, min: 1 },
        threshold: { type: 'string', optional: true, min: 1 },
        riskRegisterDecision: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextDecisionWindow: { type: 'string', optional: true, min: 1 },
        blockedFollowUp: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        vdmiContext: { type: 'string', optional: true, min: 1 },
        hitlContext: { type: 'string', optional: true, min: 1 },
        interfacePlaceholderContext: { type: 'string', optional: true, min: 1 },
        assetContext: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Gas infrastructure risk governance — read-only dossier-safe status',
        description:
          'Builds deterministic gas-infrastructure risk governance evidence. ' +
          'The endpoint is read-only and does not create risk-register entries, HITL tickets, VDMI records, Asset-MDM changes, monitoring/mitigation decisions, operations actions, external connector calls, or Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only gas infrastructure risk governance status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `gas-infrastructure-risk-governance:${params.caseId || 'no-case'}:${params.technicalFact || 'no-fact'}:${params.owner || 'no-owner'}:${params.nextDecisionWindow || 'no-window'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.gasInfrastructureRiskGovernanceStatus,
          async () => ({
            ...this.buildGasInfrastructureRiskGovernanceStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── meteringRolloutProcessIndicatorStatus ───────────────────────────
    /**
     * GET /api/dashboard/metering-rollout-process-indicator?division=...
     *
     * Read-only dossier-safe metering/rollout process indicator. It
     * normalizes supplied monthly KPI evidence without refreshing datasources,
     * importing EDM timeseries, creating HITL items or mutating downstream
     * billing, settlement, tariff, device-control or finance state.
     */
    meteringRolloutProcessIndicatorStatus: {
      rest: 'GET /metering-rollout-process-indicator',
      params: {
        indicatorId: { type: 'string', optional: true, min: 1 },
        division: { type: 'string', optional: true, min: 1 },
        sourceType: { type: 'string', optional: true, min: 1 },
        targetCount: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        actualCount: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        backlogCount: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        contractorLoad: { type: 'string', optional: true, min: 1 },
        capexImpactEur: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        opexImpactEur: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        owner: { type: 'string', optional: true, min: 1 },
        nextControlStep: { type: 'string', optional: true, min: 1 },
        blockedFollowUp: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Metering rollout process indicator — read-only dossier-safe status',
        description:
          'Builds deterministic metering/rollout process evidence from supplied KPI facts. ' +
          'The endpoint is read-only and does not refresh datasources, import EDM data, create HITL tasks, mutate finance/CAPEX state, billing, tariff, settlement, device control, external connectors, or Personal-Agent shortcuts.',
        responses: {
          200: {
            description: 'Read-only metering rollout process-indicator status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `metering-rollout-process-indicator:${params.indicatorId || 'no-id'}:${params.division || 'no-division'}:${params.sourceType || 'no-source'}:${params.owner || 'no-owner'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.meteringRolloutProcessIndicatorStatus,
          async () => ({
            ...this.buildMeteringRolloutProcessIndicatorStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── heatTransformationLineAssetModelStatus ───────────────────────────
    /**
     * GET /api/dashboard/heat-transformation-line-asset-model
     *
     * Read-only dossier-safe heat transformation line-asset model. It
     * builds line-asset and transformation evidence from supplied status facts
     * without creating a new GIS platform, heat-network service, GIS database
     * migrations, or triggering automatic decommissioning or investment decisions.
     */
    heatTransformationLineAssetModelStatus: {
      rest: 'GET /heat-transformation-line-asset-model',
      params: {
        lineAssetId: { type: 'string', optional: true, min: 1 },
        geometryRef: { type: 'string', optional: true, min: 1 },
        connectedPointAssetIds: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        division: { type: 'string', optional: true, min: 1 },
        networkCalculationRef: { type: 'string', optional: true, min: 1 },
        dataQualityStatus: { type: 'string', optional: true, min: 1 },
        transformationStatus: { type: 'string', optional: true, min: 1 },
        futureOption: { type: 'string', optional: true, min: 1 },
        investmentNeed: { type: 'multi', optional: true, rules: [{ type: 'number' }, { type: 'string', min: 1 }] },
        owner: { type: 'string', optional: true, min: 1 },
        nextDecision: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Heat transformation line-asset model — read-only dossier-safe status',
        description:
          'Builds deterministic line-asset evidence from supplied facts. ' +
          'The endpoint is read-only and does not create ZNP projects, point/line assets, datapoints, VDMI dossiers, finance plans, HITL tasks, or trigger device control or external connectors.',
        responses: {
          200: {
            description: 'Read-only heat transformation line-asset model status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `heat-transformation-line-asset-model:${params.lineAssetId || 'no-id'}:${params.division || 'no-division'}:${params.owner || 'no-owner'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.heatTransformationLineAssetModelStatus,
          async () => ({
            ...this.buildHeatTransformationLineAssetModelStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── kiFloorwalkerGovernanceStatus ───────────────────────────
    /**
     * GET /api/dashboard/ki-floorwalker-governance
     *
     * Read-only dossier-safe KI Floorwalker governance. It
     * builds AI/floorwalker and governance evidence from supplied status facts
     * without creating a new AI platform, prompt database, n8n connection,
     * or triggering automatic HITL/VDMI mutations.
     */
    kiFloorwalkerGovernanceStatus: {
      rest: 'GET /ki-floorwalker-governance',
      params: {
        useCaseId: { type: 'string', optional: true, min: 1 },
        processOwner: { type: 'string', optional: true, min: 1 },
        useCasePriority: { type: 'string', optional: true, min: 1 },
        allowedDataspaces: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        promptStandards: { type: 'string', optional: true, min: 1 },
        processBoundaries: { type: 'string', optional: true, min: 1 },
        rolesAndResponsibilities: { type: 'string', optional: true, min: 1 },
        guidedApplication: { type: 'string', optional: true, min: 1 },
        riskAndApprovalStatus: { type: 'string', optional: true, min: 1 },
        proofOfBenefit: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'KI Floorwalker governance — read-only dossier-safe status',
        description:
          'Builds deterministic AI governance evidence from supplied facts. ' +
          'The endpoint is read-only and does not run AI/LLM models, prompt databases, or write to HITL/VDMI.',
        responses: {
          200: {
            description: 'Read-only KI Floorwalker governance status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `ki-floorwalker-governance:${params.useCaseId || 'no-id'}:${params.processOwner || 'no-owner'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.kiFloorwalkerGovernanceStatus,
          async () => ({
            ...this.buildKiFloorwalkerGovernanceStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── investmentWaterfallGovernanceStatus ───────────────────
    /**
     * GET /api/dashboard/investment-waterfall-governance
     *
     * Read-only dossier-safe investment waterfall governance. It
     * builds deterministic governance evidence from supplied status facts
     * without creating a new PMO database, or triggering automatic mutations.
     */
    investmentWaterfallGovernanceStatus: {
      rest: 'GET /investment-waterfall-governance',
      params: {
        investmentItemId: { type: 'string', optional: true, min: 1 },
        targetProcess: { type: 'string', optional: true, min: 1 },
        budgetAmount: { type: 'string', optional: true, min: 1 },
        bottleneckRef: { type: 'string', optional: true, min: 1 },
        committeeWindow: { type: 'string', optional: true, min: 1 },
        evidenceReadiness: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextAction: { type: 'string', optional: true, min: 1 },
        mandateStatus: { type: 'string', optional: true, min: 1 },
        riskIfDelayed: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Investment waterfall governance — read-only dossier-safe status',
        description:
          'Builds deterministic investment waterfall governance evidence from supplied facts. ' +
          'The endpoint is read-only and does not run budget writes or write to HITL/VDMI.',
        responses: {
          200: {
            description: 'Read-only investment waterfall governance status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `investment-waterfall-governance:${params.investmentItemId || 'no-id'}:${params.targetProcess || 'no-process'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.investmentWaterfallGovernanceStatus,
          async () => ({
            ...this.buildInvestmentWaterfallGovernanceStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── capacityContractRiskAssetCockpitStatus ─────────────────────────────
    /**
     * GET /api/dashboard/capacity-contract-risk-asset-cockpit
     *
     * Read-only dossier-safe Capacity and Contract Risk Asset Cockpit.
     * It builds a deterministic risk and decision status projection from
     * supplied facts without creating a new risk database, contract-management
     * tables, or triggering automatic mutations.
     */
    capacityContractRiskAssetCockpitStatus: {
      rest: 'GET /capacity-contract-risk-asset-cockpit',
      params: {
        gridOperatorId: { type: 'string', min: 1 },
        utilization: { type: 'number', optional: true },
        bottleneck: { type: 'string', optional: true, min: 1 },
        firmCapacityKW: { type: 'number', optional: true },
        flexibleCapacityKW: { type: 'number', optional: true },
        contractStatus: { type: 'string', optional: true, min: 1 },
        legalStatus: { type: 'string', optional: true, min: 1 },
        altvereinbarung: { type: 'boolean', optional: true },
        capex: { type: 'number', optional: true },
        opex: { type: 'number', optional: true },
        priority: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextAction: { type: 'string', optional: true, min: 1 },
        forecast: { type: 'boolean', optional: true },
        date: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Capacity & Contract Risk Asset Cockpit — read-only dossier-safe status',
        description:
          'Builds deterministic risk and decision status from supplied capacity and contract facts. ' +
          'The endpoint is read-only and does not run budget writes or write to ZNP, assets, HITL, or VDMI.',
        responses: {
          200: {
            description: 'Read-only capacity and contract risk status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `capacity-contract-risk:${params.gridOperatorId}:${params.contractStatus || 'no-contract'}:${params.owner || 'no-owner'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.capacityContractRiskAssetCockpitStatus,
          async () => ({
            ...this.buildCapacityContractRiskAssetCockpitStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── imsysTaf2ComplianceStatus ─────────────────────────────
    /**
     * GET /api/dashboard/imsys-taf2-compliance
     *
     * Read-only dossier-safe iMSys TAF2 compliance status. It
     * builds compliance evidence from supplied status facts
     * without creating a new SMGW/meter/customer databases,
     * or triggering automatic mutations.
     */
    imsysTaf2ComplianceStatus: {
      rest: 'GET /imsys-taf2-compliance',
      params: {
        meteringPointId: { type: 'string', min: 1 },
        taf2Obligation: { type: 'boolean', optional: true },
        targetDeadline: { type: 'string', optional: true, min: 1 },
        tariffModel: { type: 'string', optional: true, min: 1 },
        implementationStatus: { type: 'string', optional: true, min: 1 },
        measuredValueAccess: { type: 'string', optional: true, min: 1 },
        owner: { type: 'string', optional: true, min: 1 },
        nextAction: { type: 'string', optional: true, min: 1 },
        forecast: { type: 'boolean', optional: true },
        date: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'iMSys TAF2 compliance status — read-only dossier-safe status',
        description:
          'Builds deterministic compliance evidence from supplied facts. ' +
          'The endpoint is read-only and does not run budget writes or write to HITL/VDMI.',
        responses: {
          200: {
            description: 'Read-only iMSys TAF2 compliance status',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `imsys-taf2-compliance:${params.meteringPointId || 'no-id'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.imsysTaf2ComplianceStatus,
          async () => ({
            ...this.buildImsysTaf2ComplianceStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── scheduleManagementGovernanceRoadmapStatus ─────────────────────────────
    /**
     * GET /api/dashboard/schedule-management-governance-roadmap
     *
     * Read-only dossier-safe Fahrplanmanagement Governance Roadmap.
     * It builds a deterministic roadmap and status projection from supplied facts
     * without creating a new scheduling database or triggering active mutations.
     */
    scheduleManagementGovernanceRoadmapStatus: {
      rest: 'GET /schedule-management-governance-roadmap',
      params: {
        meteringPointId: { type: 'string', optional: true, min: 1 },
        targetState: { type: 'string', optional: true, min: 1 },
        capabilityMaturity: { type: 'string', optional: true, min: 1 },
        dataObjects: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        systemIntegrations: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        roleOwnership: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        redispatchBoundary: { type: 'string', optional: true, min: 1 },
        fnavReadiness: { type: 'string', optional: true, min: 1 },
        capacityManagementGaps: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        roadmapItems: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        decisionMeetings: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
        owner: { type: 'string', optional: true, min: 1 },
        nextAction: { type: 'string', optional: true, min: 1 },
        forecast: { type: 'boolean', optional: true },
        date: { type: 'string', optional: true, min: 1 },
        sourceRef: { type: 'multi', optional: true, rules: [{ type: 'array', items: 'string' }, { type: 'string', min: 1 }] },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Fahrplanmanagement Governance Roadmap — read-only dossier-safe status',
        description:
          'Builds deterministic roadmap and status from supplied facts. ' +
          'The endpoint is read-only and does not run dispatch/writes or write to ZNP, assets, HITL, or VDMI.',
        responses: {
          200: {
            description: 'Read-only schedule management status and roadmap evidence',
          },
        },
      },
      async handler(ctx) {
        const params = { ...ctx.params };
        const cacheKey = `schedule-management-governance:${params.meteringPointId || 'no-melo'}:${params.targetState || 'no-target'}:${params.owner || 'no-owner'}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.scheduleManagementGovernanceRoadmapStatus,
          async () => ({
            ...this.buildScheduleManagementGovernanceRoadmapStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          })
        );
      },
    },

    // ── marketSnapshot ───────────────────────────────────────────────────────
    /**
     * GET /api/dashboard/market-snapshot
     *
     * Returns current spot prices, CO₂ intensity, and renewable generation
     * forecast in a single response. Four upstream calls are fired in parallel.
     *
     * Fixed upstream parameters:
     *  - energy-market.prices: { market: 'day-ahead', region: 'Deutschland', date: today }
     *  - energy-market.co2Intensity: { location, forecast: true }
     *  - entsoe.windSolarForecast: { region, dateFrom: today, dateTo: tomorrow, forecastType: 'both' }
     *    ↳ only called when the caller provides an explicit `region` param;
     *      omitting it returns renewableForecast24h: null (UI hides the forecast card)
     *  - german-grid.spotprices: { dateFrom: today, dateTo: today, includeStatistics: true }
     *
     * Optional overrides (query params):
     *  - ?location=Heidelberg  → overrides CO₂ location (default: Deutschland)
     *  - ?region=Bayern        → enables ENTSO-E wind/solar forecast (region-specific);
     *                            omit to skip the forecast entirely
     *
     * Cache TTL: 15 minutes (key: location+region).
     */
    marketSnapshot: {
      rest: 'GET /market-snapshot',
      params: {
        location: {
          type: 'string',
          optional: true,
          default: 'Deutschland',
          min: 2,
          messages: {
            stringMin: 'location muss mindestens 2 Zeichen lang sein',
          },
        },
        region: {
          type: 'string',
          optional: true,
          min: 2,
          messages: {
            stringMin: 'region muss mindestens 2 Zeichen lang sein',
          },
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Market snapshot — current spot prices, CO₂ intensity, renewable forecast',
        description:
          'Aggregates current day-ahead spot prices, CO₂ intensity (with forecast), and ' +
          'wind/solar generation forecast for the next 24 hours into a single response.\n\n' +
          "Fixed upstream parameters: `market: day-ahead`, today's date, `forecastType: both`.\n\n" +
          'Optional overrides:\n' +
          '- `?location=Heidelberg` overrides the CO₂ intensity location (default: Deutschland)\n' +
          '- `?region=Bayern` enables the ENTSO-E wind/solar forecast (region-specific); ' +
          'omit to skip — `renewableForecast24h` will be null when no region is given\n\n' +
          'Cache TTL: 15 minutes (key: location + region).',
        parameters: [
          {
            name: 'location',
            in: 'query',
            required: false,
            schema: { type: 'string', default: 'Deutschland', example: 'Heidelberg' },
            description: 'Location for CO₂ intensity lookup (default: Deutschland)',
          },
          {
            name: 'region',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'Bayern' },
            description:
              'Region for ENTSO-E wind/solar generation forecast. When omitted, renewableForecast24h is null and the ENTSO-E call is skipped.',
          },
        ],
        responses: {
          200: {
            description: 'Current market snapshot',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    spotPrice: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        current: { type: 'number', description: '€/MWh', example: 45.2 },
                        avgToday: { type: 'number', description: '€/MWh' },
                        minToday: { type: 'number', description: '€/MWh' },
                        maxToday: { type: 'number', description: '€/MWh' },
                        trend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
                        source: { type: 'string', example: 'netztransparenz' },
                      },
                    },
                    co2: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        current: { type: 'number', description: 'gCO2eq/kWh', example: 380 },
                        avgToday: { type: 'number' },
                        signal: { type: 'string', enum: ['green', 'yellow', 'red'] },
                        location: { type: 'string', example: 'Deutschland' },
                      },
                    },
                    renewableForecast24h: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        solarPeakMW: { type: 'number', example: 32500 },
                        windPeakMW: { type: 'number', example: 18200 },
                        combinedPeakAt: { type: 'string', format: 'date-time' },
                      },
                    },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000523', 'OEO_00000143'],
      },
      async handler(ctx) {
        const { location, region } = ctx.params;
        const cacheKey = `market-snapshot:${location}:${region}`;
        return this.cacheGetOrFetch(cacheKey, this.settings.cacheTtlMs.marketSnapshot, async () => {
          const errors = [];
          const today = new Date().toISOString().slice(0, 10);
          const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

          // entsoe.dayAheadPrices, co2Intensity always fire in parallel (1 MCP session
          // each, no internal fan-out). entsoe.windSolarForecast only fires when the
          // caller provides an explicit `region` — without it, a Germany-wide forecast
          // is not meaningful for a local VNB dashboard. UI must hide the
          // renewableForecast24h card when it is null.
          const [pricesRes, co2Res] = await Promise.allSettled([
            this.safeCall(
              ctx,
              'entsoe.dayAheadPrices',
              {
                region: 'Deutschland',
                dateFrom: today,
                dateTo: today,
                includeStatistics: true,
              },
              null,
              errors,
              'entsoe.dayAheadPrices'
            ),
            this.safeCall(
              ctx,
              'energy-market.co2Intensity',
              {
                location,
                forecast: true,
              },
              null,
              errors,
              'energy-market.co2Intensity'
            ),
          ]);

          const forecastRaw = region
            ? await this.safeCall(
                ctx,
                'entsoe.windSolarForecast',
                {
                  region,
                  dateFrom: today,
                  dateTo: tomorrow,
                  forecastType: 'both',
                },
                null,
                errors,
                'entsoe.windSolarForecast'
              )
            : null;

          return {
            spotPrice: this.buildSpotPrice(pricesRes.value),
            co2: this.buildCo2(co2Res.value, location),
            renewableForecast24h: forecastRaw ? this.buildForecast(forecastRaw) : null,
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        });
      },
    },

    // ── qualitySummary ───────────────────────────────────────────────────────
    /**
     * GET /api/dashboard/quality-summary?gridOperatorId=...
     *
     * Returns the five most recent reports from each agent pipeline for one
     * grid operator, structured as an array of agent-type entries with key
     * metrics and report summaries. Five upstream calls are fired in parallel.
     *
     * Cache TTL: 5 minutes (key: gridOperatorId).
     */
    qualitySummary: {
      rest: 'GET /quality-summary',
      params: {
        gridOperatorId: {
          type: 'string',
          optional: true,
          pattern: /^[SG]NB\d+$/,
          messages: {
            stringPattern:
              'gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)',
          },
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Quality summary — recent reports from all agent pipelines',
        description:
          'Returns the five most recent reports from each of the five agent pipelines ' +
          '(MaStR Quality, Grid Connection, Energy Sharing, Redispatch Ex-Post, ' +
          'Energy Sharing Allocation), structured as an agent-type array with ' +
          'last-run timestamp, key metric, and report list.\n\n' +
          'Optionally filtered by `gridOperatorId` (MaStR SNB/GNB ID). ' +
          'If omitted, returns the five most recent reports regardless of operator.\n\n' +
          'Cache TTL: 5 minutes (key: gridOperatorId).',
        parameters: [
          {
            name: 'gridOperatorId',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'SNB935578300972' },
            description: 'MaStR ID of the grid operator (SNB.../GNB...)',
          },
        ],
        responses: {
          200: {
            description: 'Quality summary across all agent pipelines',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    agents: {
                      type: 'array',
                      description: 'One entry per agent type',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string', example: 'mastr-quality' },
                          label: { type: 'string', example: 'MaStR Datenqualität' },
                          lastRun: { type: 'string', format: 'date-time', nullable: true },
                          keyMetric: { type: 'object', nullable: true },
                          findingsCount: {
                            type: 'object',
                            nullable: true,
                            description:
                              'Finding counts from latest report (null for agents without findings pattern)',
                            properties: {
                              info: { type: 'integer', example: 12 },
                              warning: { type: 'integer', example: 18 },
                              error: { type: 'integer', example: 5 },
                            },
                          },
                          recentReports: { type: 'array' },
                        },
                      },
                    },
                    businessKpis: {
                      type: 'object',
                      nullable: true,
                      description:
                        'VDMI business KPIs for governance and process-standardisation impact',
                      properties: {
                        vdmi_shadow_path_resolution_rate: {
                          type: 'number',
                          nullable: true,
                          description:
                            'Resolved share (%) of VD_SHADOW_* and VD_SILO_* findings in the observed data',
                        },
                        vdmi_n1_escalation_reduction_rate: {
                          type: 'number',
                          nullable: true,
                          description:
                            'Reduction (%) of escalation-like VD_GOV_* findings comparing current vs previous 30-day window',
                        },
                        vdmi_fnav_time_to_decision_gain_days: {
                          type: 'number',
                          nullable: true,
                          description:
                            'Median decision-time gain in days for fNAV process matrices (previous window minus current window)',
                        },
                      },
                    },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler(ctx) {
        const { gridOperatorId } = ctx.params;
        const cacheKey = `quality-summary:${gridOperatorId || 'all'}`;
        return this.cacheGetOrFetch(cacheKey, this.settings.cacheTtlMs.qualitySummary, async () => {
          const errors = [];
          const baseFilter = gridOperatorId ? { gridOperatorId } : {};

          const [mqRes, gcRes, esRes, rdRes, allocRes, vdmiMatrixRes, vdmiFindingsRes] =
            await Promise.allSettled([
              this.safeCall(
                ctx,
                ACTION_MQ_LIST,
                { ...baseFilter, limit: 5 },
                null,
                errors,
                ACTION_MQ_LIST
              ),
              this.safeCall(
                ctx,
                ACTION_GC_LIST,
                { ...baseFilter, limit: 5 },
                null,
                errors,
                ACTION_GC_LIST
              ),
              this.safeCall(ctx, ACTION_ES_LIST, { limit: 5 }, null, errors, ACTION_ES_LIST),
              this.safeCall(
                ctx,
                ACTION_RD_LIST,
                { ...baseFilter, limit: 5 },
                null,
                errors,
                ACTION_RD_LIST
              ),
              this.safeCall(
                ctx,
                'energy-sharing-allocation.list',
                { limit: 5 },
                null,
                errors,
                'energy-sharing-allocation.list'
              ),
              this.safeCall(ctx, ACTION_VDMI_LIST, { limit: 5 }, null, errors, ACTION_VDMI_LIST),
              this.safeCall(
                ctx,
                ACTION_VDMI_FINDINGS,
                { limit: 500 },
                null,
                errors,
                ACTION_VDMI_FINDINGS
              ),
            ]);

          const vdmiMatrices = vdmiMatrixRes.value?.items || [];
          const vdmiFindings = vdmiFindingsRes.value?.findings || [];

          const agents = [
            this.buildAgentEntry(
              'mastr-quality',
              'MaStR Datenqualität',
              mqRes.value?.audits,
              'qualityScore'
            ),
            this.buildAgentEntry(
              'grid-connection',
              'Netzanschluss-Validierung',
              gcRes.value?.validations,
              'decision'
            ),
            this.buildAgentEntry(
              'energy-sharing',
              'Energy Sharing Validierung',
              esRes.value?.validations,
              'decision'
            ),
            this.buildAgentEntry(
              'redispatch-expost',
              'Redispatch Ex-Post',
              rdRes.value?.audits,
              'settlementReadiness'
            ),
            this.buildAgentEntry(
              'energy-sharing-allocation',
              'Energy Sharing Allokation',
              allocRes.value?.allocations,
              'totalNetGenerationKWh'
            ),
            this.buildVdmiAgentEntry(vdmiMatrices, vdmiFindings),
          ];

          return {
            agents,
            businessKpis: this.buildVdmiBusinessKpis(vdmiFindings, vdmiMatrices),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        });
      },
    },

    // ── observabilityMini ───────────────────────────────────────────────────
    /**
     * GET /api/dashboard/observability-mini
     *
     * Compact operational card payload for dashboards and agentic tooling.
     * Reads from observability.summary and derives three cards:
     * health, incidents, and performance.
     *
     * Cache TTL: 1 minute (key: sinceMinutes + slowActionThresholdMs).
     */
    observabilityMini: {
      rest: 'GET /observability-mini',
      params: {
        sinceMinutes: {
          type: 'number',
          integer: true,
          optional: true,
          default: 60,
          min: 1,
          max: 24 * 60,
          convert: true,
        },
        slowActionThresholdMs: {
          type: 'number',
          integer: true,
          optional: true,
          default: 1000,
          min: 1,
          max: 600000,
          convert: true,
        },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Observability mini dashboard — compact production feedback cards',
        description:
          'Returns a compact operational payload from observability.summary with health, incidents, ' +
          'and performance cards plus recent errors and slowest actions. Optimized for dashboard widgets and agentic monitoring loops. ' +
          'Cache TTL: 60 seconds.',
        parameters: [
          {
            name: 'sinceMinutes',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 60, minimum: 1, maximum: 1440 },
            description: 'Rolling observation window in minutes.',
          },
          {
            name: 'slowActionThresholdMs',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 1000, minimum: 1, maximum: 600000 },
            description: 'Threshold used to classify actions as slow.',
          },
        ],
        responses: {
          200: {
            description: 'Compact observability widget payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    cards: { type: 'object' },
                    recentErrors: { type: 'array' },
                    slowestActions: { type: 'array' },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler(ctx) {
        const { sinceMinutes, slowActionThresholdMs } = ctx.params;
        const cacheKey = `observability-mini:${sinceMinutes}:${slowActionThresholdMs}`;

        return this.cacheGetOrFetch(
          cacheKey,
          this.settings.cacheTtlMs.observabilityMini,
          async () => {
            const errors = [];
            const summary = await this.safeCall(
              ctx,
              'observability.summary',
              { sinceMinutes, slowActionThresholdMs, limit: 10 },
              null,
              errors,
              'observability.summary'
            );

            return {
              cards: this.buildObservabilityMiniCards(summary),
              recentErrors: summary?.logs?.recentErrors || [],
              slowestActions: summary?.metrics?.slowestActions || [],
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }
        );
      },
    },

    // ── findingCodes ─────────────────────────────────────────────────────────
    /**
     * GET /api/dashboard/finding-codes
     *
     * Returns all 92 finding codes with metadata (severity, agent, step,
     * description EN + DE) plus an agent catalogue with label and pipeline info.
     * Response is static — sourced entirely from FINDING_CODE_METADATA in
     * src/validation-findings.js. Cache TTL: 24 hours.
     */
    findingCodes: {
      rest: 'GET /finding-codes',
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Finding codes reference — all 92 codes with metadata',
        description:
          'Returns the complete finding-code reference for all agent pipelines ' +
          '(Grid Connection v0.14, Energy Sharing v0.15, MaStR Quality v0.17, ' +
          'Redispatch Ex-Post v0.18). Each code entry contains: severity, agent, ' +
          'step, description (EN), descriptionDe (DE). ' +
          'Intended for UI tooltips, filter chips, and colour coding.\n\n' +
          'Cache TTL: 24 hours (static data — changes only on service restart).',
        responses: {
          200: {
            description: 'Finding codes reference',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    codes: {
                      type: 'object',
                      description: 'Map of code → metadata',
                      additionalProperties: {
                        type: 'object',
                        properties: {
                          severity: { type: 'string', enum: ['info', 'warning', 'error'] },
                          agent: { type: 'string', example: 'mastr-quality' },
                          step: { type: 'integer', example: 4 },
                          description: { type: 'string', description: 'English description' },
                          descriptionDe: { type: 'string', description: 'German description' },
                        },
                      },
                    },
                    agents: {
                      type: 'object',
                      description: 'Agent catalogue with version and step count',
                    },
                    totalCodes: { type: 'integer', example: 92 },
                  },
                },
              },
            },
          },
        },
        'x-oeo-class': ['OEO_00000143'],
      },
      async handler() {
        return this.cacheGetOrFetch('finding-codes', this.settings.cacheTtlMs.findingCodes, () => {
          return Promise.resolve({
            codes: FINDING_CODE_METADATA,
            agents: {
              'grid-connection': {
                label: 'Netzanschluss-Validierung',
                version: '0.14.0',
                steps: 6,
                pouchdbPrefix: 'val:',
                endpoint: 'POST /api/grid-connection/validate',
              },
              'energy-sharing': {
                label: 'Energy Sharing Validierung',
                version: '0.15.0',
                steps: 6,
                pouchdbPrefix: 'es:',
                endpoint: 'POST /api/energy-sharing/validate',
              },
              'mastr-quality': {
                label: 'MaStR Datenqualität',
                version: '0.17.0',
                steps: 8,
                pouchdbPrefix: 'mq:',
                endpoint: 'POST /api/mastr-quality/audit',
              },
              'redispatch-expost': {
                label: 'Redispatch Ex-Post',
                version: '0.18.0',
                steps: 7,
                pouchdbPrefix: 'rd:',
                endpoint: 'POST /api/redispatch/audit',
              },
              vdmi: {
                label: 'VDMI Governance Matrix',
                version: '0.50.0',
                steps: 6,
                pouchdbPrefix: 'vdmi:',
                endpoint: 'GET /api/vdmi/findings',
              },
              'blindflug-radar': {
                label: 'Blindflug Radar',
                version: '1.0.0',
                steps: 1,
                pouchdbPrefix: null,
                endpoint: 'POST /api/blindflug-radar/scan',
              },
            },
            totalCodes: Object.keys(FINDING_CODE_METADATA).length,
          });
        });
      },
    },
  },

  methods: {
    buildReceiptGroundingSyntheticDomain(params = {}) {
      switch (params.domainShape) {
        case 'vdmi_matrix':
          return {
            matrix: {
              tasks: [
                {
                  taskName: 'Synthetic VDMI grounding check',
                  verantwortlich: ['DSO_GATEKEEPER'],
                  durchfuehrend: ['TECHNICAL_PLANNER'],
                  mitwirkend: [],
                  information: [],
                },
              ],
            },
          };
        case 'kpi_fact':
          return {
            label: 'Synthetic KPI grounding check',
            value: 1,
            unit: 'evidence item',
            source: params.sourceAction || 'synthetic-inspect',
          };
        case 'evidence_gap':
          return {
            evidenceGaps: [
              {
                id: params.evidenceGapId || 'missing_source_action',
                label: params.evidenceGapId || 'Missing source action',
              },
            ],
          };
        case 'decision_brief':
          return {
            decisionStatus: 'blocked_until_evidence_arrives',
            forbiddenAssumptions: ['Renderer cannot outrank executed evidence.'],
          };
        default:
          return params.query ? { note: String(params.query).slice(0, 160) } : {};
      }
    },

    buildReceiptGroundingFollowUps(grounding = {}) {
      const followUps = [];
      if (Array.isArray(grounding.sourceActions) && grounding.sourceActions.length === 0) {
        followUps.push({
          missingDataPoint: 'missingSourceAction',
          enablesDossierAddition:
            'Add the executed domain action so the renderer can be tied to tool evidence.',
        });
      }
      if (grounding?.basis?.hasDomainResult === false) {
        followUps.push({
          missingDataPoint: 'missingDomainResultShape',
          enablesDossierAddition:
            'Provide the structured domain result fields required by the requested renderer.',
        });
      }
      for (const gapId of grounding.evidenceGapIds || []) {
        followUps.push({
          missingDataPoint: gapId,
          enablesDossierAddition:
            'Resolve this evidence gap to allow a stronger grounded presentation.',
        });
      }
      if (grounding.blockedReason) {
        followUps.push({
          missingDataPoint: 'rendererMismatch',
          enablesDossierAddition:
            'Use the grounded fallback now; enable the richer renderer once matching evidence is present.',
        });
      }
      return followUps;
    },

    // ── Cache helpers ─────────────────────────────────────────────────────────

    /**
     * Retrieves a cached value if it has not expired.
     * @param {string} key
     * @returns {*} Cached value or null
     */
    cacheGet(key) {
      if (!this.cache.has(key)) return null;
      const entry = this.cache.get(key);
      if (Date.now() < entry.expiresAt) return entry.data;
      this.cache.delete(key);
      return null;
    },

    /**
     * Stores a value in the cache with an absolute expiry timestamp.
     * @param {string} key
     * @param {*}      value
     * @param {number} ttlMs  TTL in milliseconds
     */
    cacheSet(key, value, ttlMs) {
      this.cache.set(key, { data: value, expiresAt: Date.now() + ttlMs });
    },

    /**
     * Cache-get-or-fetch with stampede protection.
     * If a fresh cache entry exists, returns it immediately.
     * If an identical fetch is already in-flight, awaits that promise instead
     * of starting a redundant upstream call.
     * @param {string}   key      Cache key
     * @param {number}   ttlMs    TTL for a newly fetched entry
     * @param {Function} fetchFn  Async function that performs the upstream calls
     * @returns {Promise<*>}
     */
    async cacheGetOrFetch(key, ttlMs, fetchFn) {
      const cached = this.cacheGet(key);
      if (cached) return cached;

      if (this.inflight.has(key)) {
        return this.inflight.get(key);
      }

      const promise = fetchFn()
        .then((result) => {
          this.cacheSet(key, result, ttlMs);
          this.inflight.delete(key);
          return result;
        })
        .catch((err) => {
          this.inflight.delete(key);
          throw err;
        });

      this.inflight.set(key, promise);
      return promise;
    },

    // ── Error-tolerant ctx.call wrapper ──────────────────────────────────────

    /**
     * Calls a Moleculer action and returns `fallback` on any error.
     * Pushes the failed action name into `errors` when provided.
     *
     * @param {Context}  ctx       Moleculer context
     * @param {string}   action    Fully qualified action name
     * @param {object}   params    Action parameters
     * @param {*}        fallback  Returned on failure (default: null)
     * @param {string[]} errors    Mutable array to record failures
     * @param {string}   label     Human-readable label for the error entry
     * @returns {Promise<*>}
     */
    async safeCall(ctx, action, params, fallback = null, errors = [], label = null) {
      try {
        return await ctx.call(action, params);
      } catch (err) {
        const name = label || action;
        this.logger.warn(`dashboard-api: ${name} failed — ${err.message}`);
        if (errors) errors.push(name);
        return fallback;
      }
    },

    // ── Response builders ─────────────────────────────────────────────────────

    /**
     * Builds the identity block from grid-operations.vnbLookupCodes response.
     * @param {object|null} identityData
     * @param {string}      bdewCode      Fallback when identity is unavailable
     * @returns {object|null}
     */
    buildIdentity(identityData, bdewCode) {
      if (!identityData) return { bdew: bdewCode, name: null, mastrId: null, bnr: null };
      const hit = identityData.results?.[0] || identityData;
      return {
        name: hit.name || hit.providerName || null,
        mastrId: hit.mastrId || hit.mastrSnbId || null,
        bdew: hit.bdew || hit.bdewCode || bdewCode,
        bnr: hit.bnr || hit.bnrCode || null,
      };
    },

    /**
     * Builds the KPIs block from VNB Monitor snapshot, datapoint health, and
     * the redispatch-eligible count from assets.redispatchCount (v0.20.2).
     * @param {object|null} vnbMonitor  vnb-monitor.snapshot result
     * @param {object|null} health      datapoint.health result
     * @param {object|null} mqAudits    mastr-quality.list result (for qualityScore)
     * @param {object|null} rdCount     assets.redispatchCount result (v0.20.2)
     * @returns {object}
     */
    buildKpis(vnbMonitor, health, mqAudits, rdCount) {
      // vnb-monitor.snapshot actual structure (v0.9.6+):
      //   mastr.inBetrieb.anlagenCount   — total installed units
      //   mastr.inBetrieb.leistungMW     — total capacity (string, e.g. '145.2')
      //   ewk.anschlussdauer.eeNS_weeks  — avg. connection duration EE/NS (weeks)
      //   ewk.digitalisierungsindex.gesamt_percent — overall digitalisation score
      //   ewk.umsetzungsquote.eeNS_percent         — EE/NS implementation rate (%)
      const mastr = vnbMonitor?.mastr || {};
      const ewk = vnbMonitor?.ewk || {};
      const dp = health?.overview || health || {};

      const latestMqScore = mqAudits?.audits?.[0]?.qualityScore ?? null;

      return {
        totalInstallations: mastr.inBetrieb?.anlagenCount ?? null,
        totalCapacityMW: mastr.inBetrieb ? Number(mastr.inBetrieb.leistungMW) || null : null,
        // Populated by assets.redispatchCount (v0.20.2, RES-IR-0001 Option b).
        // null when assets service is unavailable (safeCall fallback).
        redispatchEligible: rdCount?.count ?? null,
        redispatchCapacityMW: rdCount?.totalCapacityMW ?? null,
        ewkAnschlussdauerWeeks: ewk.anschlussdauer?.eeNS_weeks ?? null,
        ewkDigitalisierungsScore: ewk.digitalisierungsindex?.gesamt_percent ?? null,
        ewkUmsetzungsquote: ewk.umsetzungsquote?.eeNS_percent ?? null,
        mastrQualityScore: latestMqScore,
        datapointsHealthy: dp.healthy ?? null,
        datapointsStale: dp.stale ?? null,
        datapointsErrored: dp.errored ?? null,
      };
    },

    /**
     * Builds the latestAgentResults block from the four agent list responses.
     * Each entry is either a compact summary object or null (no reports).
     */
    buildAgentSummary(mqAudits, gcValidations, esValidations, rdAudits) {
      return {
        mastrQuality: this._summariseMq(mqAudits?.audits?.[0]),
        gridConnection: this._summariseGc(gcValidations?.validations?.[0]),
        energySharing: this._summariseEs(esValidations?.validations?.[0]),
        redispatch: this._summariseRd(rdAudits?.audits?.[0]),
      };
    },

    _summariseMq(audit) {
      if (!audit) return null;
      return {
        id: audit.id,
        executedAt: audit.createdAt,
        qualityScore: audit.qualityScore,
        findingsCount: audit.findingsCount || null,
      };
    },

    _summariseGc(report) {
      if (!report) return null;
      return {
        id: report.id,
        executedAt: report.createdAt,
        decision: report.decision,
        findingsCount: report.findingsCount || null,
      };
    },

    _summariseEs(report) {
      if (!report) return null;
      return {
        id: report.id,
        executedAt: report.createdAt,
        decision: report.decision,
        findingsCount: report.findingsCount || null,
      };
    },

    _summariseRd(audit) {
      if (!audit) return null;
      return {
        id: audit.id,
        executedAt: audit.createdAt,
        settlementReadinessPercent: audit.settlementReadiness?.readinessPercent ?? null,
        riskLevel: audit.riskAssessment?.level ?? null,
        findingsCount: audit.findingsCount || null,
      };
    },

    /**
     * Builds the spotPrice block from energy-market.prices or german-grid.spotprices.
     * Falls back gracefully between the two sources.
     */
    buildSpotPrice(pricesData) {
      if (!pricesData) return null;

      // entsoe.dayAheadPrices returns dataPoints[].priceEURperMWh; other sources may use
      // prices[].price or prices[].priceEURMWh — handle all known shapes.
      const points = pricesData.dataPoints || pricesData.prices || pricesData.data || [];
      if (!points.length) return null;

      const values = points
        .map((p) => p.priceEURperMWh ?? p.priceEURMWh ?? p.price ?? p.value ?? p.priceEur)
        .filter((v) => v != null);
      if (!values.length) return null;

      // Prefer pre-computed statistics when available (entsoe response includes them)
      const stats = pricesData.statistics || {};
      const avg = stats.avgPrice ?? values.reduce((a, b) => a + b, 0) / values.length;
      const min = stats.minPrice ?? Math.min(...values);
      const max = stats.maxPrice ?? Math.max(...values);
      const current = values[values.length - 1];
      const trend = current > avg * 1.05 ? 'rising' : current < avg * 0.95 ? 'falling' : 'stable';

      return {
        current: Math.round(current * 100) / 100,
        avgToday: Math.round(avg * 100) / 100,
        minToday: Math.round(min * 100) / 100,
        maxToday: Math.round(max * 100) / 100,
        trend,
        source: 'entsoe',
      };
    },

    /**
     * Builds the co2 block from energy-market.co2Intensity response.
     */
    buildCo2(co2Data, location) {
      if (!co2Data) return null;
      // energy-market.co2Intensity returns co2_intensity_gco2eq_kwh (MCP field name);
      // nested .data sub-object is also checked for forward-compat.
      const current =
        co2Data.co2_intensity_gco2eq_kwh ??
        co2Data.data?.co2_intensity_gco2eq_kwh ??
        co2Data.current ??
        co2Data.co2Intensity ??
        co2Data.value ??
        null;
      if (current == null) return null;

      const signal = current < 300 ? 'green' : current < 450 ? 'yellow' : 'red';

      return {
        current: Math.round(current),
        avgToday:
          co2Data.average_today_gco2eq_kwh ??
          co2Data.data?.average_today_gco2eq_kwh ??
          co2Data.avgToday ??
          co2Data.average ??
          null,
        signal,
        location: co2Data.data?.location || co2Data.location || location,
      };
    },

    /**
     * Builds the renewableForecast24h block from entsoe.windSolarForecast response.
     */
    buildForecast(forecastData) {
      if (!forecastData) return null;
      const solar = forecastData.solar || forecastData.solarForecast || [];
      const wind = forecastData.wind || forecastData.windForecast || [];

      const solarPeakMW = solar.length ? Math.max(...solar.map((p) => p.value ?? p.mw ?? 0)) : null;
      const windPeakMW = wind.length ? Math.max(...wind.map((p) => p.value ?? p.mw ?? 0)) : null;

      // Find combined peak timestamp
      let combinedPeakAt = null;
      if (solar.length && wind.length) {
        const solarPeak = solar.reduce((a, b) => ((a.value ?? 0) > (b.value ?? 0) ? a : b));
        combinedPeakAt = solarPeak.timestamp || solarPeak.time || null;
      }

      return { solarPeakMW, windPeakMW, combinedPeakAt };
    },

    /**
     * Builds a single agent entry for the qualitySummary response.
     * @param {string}        type        Service/agent type identifier
     * @param {string}        label       Human-readable label
     * @param {object[]|null} reports     Array of report summaries from list action
     * @param {string}        metricKey   Key for the keyMetric value
     * @returns {object}
     */
    buildAgentEntry(type, label, reports, metricKey) {
      if (!reports || !reports.length) {
        return {
          type,
          label,
          lastRun: null,
          keyMetric: null,
          findingsCount: null,
          recentReports: [],
        };
      }
      const latest = reports[0];
      const metricValue = latest[metricKey] ?? null;
      return {
        type,
        label,
        lastRun: latest.createdAt || null,
        keyMetric: metricValue != null ? { name: metricKey, value: metricValue } : null,
        findingsCount: latest.findingsCount || null,
        recentReports: reports.map((r) => ({
          id: r.id,
          executedAt: r.createdAt,
          [metricKey]: r[metricKey] ?? null,
        })),
      };
    },

    /**
     * Builds a VDMI agent entry for qualitySummary.
     * @param {object[]|null} matrices
     * @param {object[]|null} findings
     * @returns {object}
     */
    buildVdmiAgentEntry(matrices, findings) {
      const matrixList = Array.isArray(matrices) ? matrices : [];
      const findingList = Array.isArray(findings) ? findings : [];
      const latest = matrixList[0] || null;
      const openCriticalFindings = findingList.filter(
        (f) => f.status === 'open' && (f.severity === 'H' || f.severity === 'K')
      ).length;

      return {
        type: 'vdmi',
        label: 'VDMI Governance Matrix',
        lastRun: latest?.updatedAt || latest?.createdAt || null,
        keyMetric: {
          name: 'openCriticalFindings',
          value: openCriticalFindings,
        },
        findingsCount: {
          info: findingList.filter((f) => f.severity === 'L').length,
          warning: findingList.filter((f) => f.severity === 'M').length,
          error: findingList.filter((f) => f.severity === 'H' || f.severity === 'K').length,
        },
        recentReports: matrixList.map((m) => ({
          id: m.id,
          executedAt: m.updatedAt || m.createdAt || null,
          nominationStatus: m.nominationStatus || null,
          detectionConfidence: m.detectionConfidence ?? null,
        })),
      };
    },

    /**
     * Builds VDMI business KPIs for management-level dashboard widgets.
     * @param {object[]|null} findings
     * @param {object[]|null} matrices
     * @returns {object}
     */
    buildVdmiBusinessKpis(findings, matrices) {
      const findingList = Array.isArray(findings) ? findings : [];
      const matrixList = Array.isArray(matrices) ? matrices : [];

      const shadowRelevant = findingList.filter(
        (f) => typeof f.code === 'string' && /^(VD_SHADOW_|VD_SILO_)/.test(f.code)
      );
      const shadowResolved = shadowRelevant.filter((f) => f.status === 'resolved').length;
      const shadowRate =
        shadowRelevant.length > 0
          ? Number(((shadowResolved / shadowRelevant.length) * 100).toFixed(2))
          : null;

      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;
      const currentStart = now - 30 * DAY_MS;
      const previousStart = now - 60 * DAY_MS;

      const escalationFindings = findingList.filter(
        (f) => typeof f.code === 'string' && /^VD_GOV_/.test(f.code)
      );
      const currentEscalations = escalationFindings.filter((f) => {
        const ts = Date.parse(f.updatedAt || f.createdAt || '');
        return Number.isFinite(ts) && ts >= currentStart && ts < now;
      }).length;
      const previousEscalations = escalationFindings.filter((f) => {
        const ts = Date.parse(f.updatedAt || f.createdAt || '');
        return Number.isFinite(ts) && ts >= previousStart && ts < currentStart;
      }).length;
      const escalationReductionRate =
        previousEscalations > 0
          ? Number(
              (((previousEscalations - currentEscalations) / previousEscalations) * 100).toFixed(2)
            )
          : null;

      const fnavConfirmed = matrixList.filter(
        (m) =>
          m.processType === 'fnav-contract-negotiation' &&
          m.nominationStatus === 'confirmed' &&
          m.createdAt &&
          m.updatedAt
      );

      const currentDurations = fnavConfirmed
        .filter((m) => {
          const ts = Date.parse(m.updatedAt || '');
          return Number.isFinite(ts) && ts >= currentStart && ts < now;
        })
        .map((m) => {
          const createdAt = Date.parse(m.createdAt || '');
          const updatedAt = Date.parse(m.updatedAt || '');
          return Number.isFinite(createdAt) && Number.isFinite(updatedAt)
            ? (updatedAt - createdAt) / DAY_MS
            : null;
        })
        .filter((v) => v != null);

      const previousDurations = fnavConfirmed
        .filter((m) => {
          const ts = Date.parse(m.updatedAt || '');
          return Number.isFinite(ts) && ts >= previousStart && ts < currentStart;
        })
        .map((m) => {
          const createdAt = Date.parse(m.createdAt || '');
          const updatedAt = Date.parse(m.updatedAt || '');
          return Number.isFinite(createdAt) && Number.isFinite(updatedAt)
            ? (updatedAt - createdAt) / DAY_MS
            : null;
        })
        .filter((v) => v != null);

      const currentMedian = this.computeMedian(currentDurations);
      const previousMedian = this.computeMedian(previousDurations);
      const fnavGainDays =
        previousMedian != null && currentMedian != null
          ? Number((previousMedian - currentMedian).toFixed(2))
          : null;

      return {
        vdmi_shadow_path_resolution_rate: shadowRate,
        vdmi_n1_escalation_reduction_rate: escalationReductionRate,
        vdmi_fnav_time_to_decision_gain_days: fnavGainDays,
      };
    },

    /**
     * Computes median value for numeric arrays.
     * @param {number[]} values
     * @returns {number|null}
     */
    computeMedian(values) {
      if (!Array.isArray(values) || values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
      }
      return sorted[middle];
    },

    /**
     * Build compact KPI cards from observability.summary output.
     * @param {object|null} summary
     * @returns {object}
     */
    buildObservabilityMiniCards(summary) {
      if (!summary) {
        return {
          health: { status: 'unknown', signal: null },
          incidents: { errorCount: null, signal: null },
          performance: { p95DurationMs: null, slowCallCount: null, signal: null },
        };
      }

      const errorCount = summary.metrics?.overview?.errorCount ?? 0;
      const p95DurationMs = summary.metrics?.overview?.p95DurationMs ?? null;
      const slowCallCount = summary.metrics?.overview?.slowCallCount ?? 0;
      const status = errorCount > 0 ? 'degraded' : 'healthy';

      return {
        health: { status, signal: status === 'healthy' ? 'green' : 'yellow' },
        incidents: {
          errorCount,
          signal: errorCount === 0 ? 'green' : errorCount < 5 ? 'yellow' : 'red',
        },
        performance: {
          p95DurationMs,
          slowCallCount,
          signal: slowCallCount === 0 ? 'green' : slowCallCount < 10 ? 'yellow' : 'red',
        },
      };
    },

    buildRedispatchMeteringBlockers({
      resolvedGridOperatorId,
      rdLatest,
      allocLatest,
      mqLatest,
      dpOverview,
      openCriticalFindings,
    }) {
      const blockers = [];

      if (!resolvedGridOperatorId) {
        blockers.push({
          code: 'MISSING_OPERATOR_CONTEXT',
          severity: 'high',
          source: 'operator-context',
          message: 'Kein eindeutiger Netzbetreiber-Kontext (gridOperatorId/BDEW) verfügbar.',
        });
      }

      if (!rdLatest) {
        blockers.push({
          code: 'REDISPATCH_EVIDENCE_MISSING',
          severity: 'high',
          source: 'redispatch-expost.list',
          message: 'Keine Redispatch-Ex-Post-Auswertung vorhanden.',
        });
      }

      const readinessPercent = rdLatest?.settlementReadiness?.readinessPercent;
      if (readinessPercent != null && readinessPercent < 70) {
        blockers.push({
          code: 'REDISPATCH_READINESS_LOW',
          severity: 'high',
          source: 'redispatch-expost.list',
          message: `Settlement-Readiness ist kritisch niedrig (${readinessPercent}%).`,
        });
      }

      const rdRisk = String(rdLatest?.riskAssessment?.level || '').toLowerCase();
      if (rdRisk === 'high' || rdRisk === 'critical') {
        blockers.push({
          code: 'REDISPATCH_RISK_HIGH',
          severity: 'high',
          source: 'redispatch-expost.list',
          message: `Redispatch-Risiko ist ${rdRisk}.`,
        });
      }

      if (!mqLatest) {
        blockers.push({
          code: 'MASTERDATA_EVIDENCE_MISSING',
          severity: 'high',
          source: 'mastr-quality.list',
          message: 'Keine MaStR-Qualitätsauswertung vorhanden.',
        });
      }

      const qualityScore = mqLatest?.qualityScore;
      if (qualityScore != null && qualityScore < 70) {
        blockers.push({
          code: 'MASTERDATA_QUALITY_LOW',
          severity: 'medium',
          source: 'mastr-quality.list',
          message: `MaStR-Qualität ist niedrig (${qualityScore}).`,
        });
      }

      if (
        !allocLatest &&
        dpOverview?.healthy == null &&
        dpOverview?.stale == null &&
        dpOverview?.errored == null
      ) {
        blockers.push({
          code: 'METERING_EVIDENCE_MISSING',
          severity: 'high',
          source: 'energy-sharing-allocation.list/datapoint.health',
          message: 'Keine belastbare Metering-Evidenz verfügbar.',
        });
      }

      if ((dpOverview?.errored ?? 0) > 0) {
        blockers.push({
          code: 'METERING_DATAPOINT_ERRORS',
          severity: 'high',
          source: 'datapoint.health',
          message: `${dpOverview.errored} Datapoints im Fehlerzustand.`,
        });
      }

      if ((dpOverview?.stale ?? 0) > 0) {
        blockers.push({
          code: 'METERING_DATAPOINT_STALE',
          severity: 'medium',
          source: 'datapoint.health',
          message: `${dpOverview.stale} Datapoints sind stale.`,
        });
      }

      if ((openCriticalFindings || []).length > 0) {
        blockers.push({
          code: 'VDMI_OPEN_CRITICAL',
          severity: 'high',
          source: 'vdmi.findings',
          message: `${openCriticalFindings.length} offene kritische VDMI-Findings.`,
        });
      }

      return blockers;
    },

    buildRedispatchMeteringStaleData({ rdLatest, allocLatest, mqLatest, dpOverview }) {
      const stale = [];

      if ((dpOverview?.stale ?? 0) > 0) {
        stale.push({
          source: 'datapoint.health',
          indicator: 'staleDatapoints',
          value: dpOverview.stale,
        });
      }

      if (this.isOlderThanDays(rdLatest?.createdAt, 30)) {
        stale.push({
          source: 'redispatch-expost.list',
          indicator: 'lastAuditAgeDays',
          value: this.daysSince(rdLatest?.createdAt),
        });
      }

      if (this.isOlderThanDays(allocLatest?.createdAt, 30)) {
        stale.push({
          source: 'energy-sharing-allocation.list',
          indicator: 'lastAllocationAgeDays',
          value: this.daysSince(allocLatest?.createdAt),
        });
      }

      if (this.isOlderThanDays(mqLatest?.createdAt, 30)) {
        stale.push({
          source: 'mastr-quality.list',
          indicator: 'lastAuditAgeDays',
          value: this.daysSince(mqLatest?.createdAt),
        });
      }

      return stale;
    },

    buildLoadProfileAnomalyBuckets(validationFindings, vdmiFindings, forecastQuality) {
      const findings = Array.isArray(validationFindings) ? validationFindings : [];
      const governance = Array.isArray(vdmiFindings) ? vdmiFindings : [];

      const dataQualityGapRules = new Set(['GAP_DETECTION', 'DUPLICATE_CHECK', 'MONOTONY_CHECK']);
      const realAnomalyRules = new Set(['BANDWIDTH_CHECK', 'NEGATIVE_VALUE_CHECK']);
      const forecastProblemRules = new Set(['SLP_PLAUSIBILITY']);

      const dataQualityGap = findings
        .filter((f) => dataQualityGapRules.has(String(f?.ruleId || '')))
        .map((f) => ({
          class: 'dataQualityGap',
          source: 'edm-validation.validate',
          ref: f.ruleId,
          severity: f.severity || null,
          timestamp: f.timestamp || null,
          message: f.message || null,
        }));

      const realAnomaly = findings
        .filter((f) => realAnomalyRules.has(String(f?.ruleId || '')))
        .map((f) => ({
          class: 'realAnomaly',
          source: 'edm-validation.validate',
          ref: f.ruleId,
          severity: f.severity || null,
          timestamp: f.timestamp || null,
          value: f.value != null ? f.value : null,
          message: f.message || null,
        }));

      const forecastProblem = findings
        .filter((f) => forecastProblemRules.has(String(f?.ruleId || '')))
        .map((f) => ({
          class: 'forecastProblem',
          source: 'edm-validation.validate',
          ref: f.ruleId,
          severity: f.severity || null,
          timestamp: f.timestamp || null,
          message: f.message || null,
        }));

      if (forecastQuality && ['poor', 'fair'].includes(String(forecastQuality.rating || ''))) {
        forecastProblem.push({
          class: 'forecastProblem',
          source: 'forecast-engine.evaluateQuality',
          ref: 'FORECAST_QUALITY',
          severity: forecastQuality.rating === 'poor' ? 'error' : 'warning',
          timestamp: null,
          message: `Forecast quality rated as ${forecastQuality.rating} (MAPE=${forecastQuality.mape}).`,
        });
      }

      const processGovernanceBreak = governance
        .filter((f) => {
          const severity = String(f?.severity || '').toUpperCase();
          const code = String(f?.code || '').toUpperCase();
          return severity === 'H' || severity === 'K' || code.startsWith('VD_GOV_');
        })
        .map((f) => ({
          class: 'processGovernanceBreak',
          source: 'vdmi.findings',
          ref: f.code || null,
          severity: f.severity || null,
          timestamp: f.updatedAt || f.createdAt || null,
          message: f.title || f.reason || null,
          findingId: f.id || null,
        }));

      return {
        dataQualityGap,
        realAnomaly,
        forecastProblem,
        processGovernanceBreak,
      };
    },

    buildLoadProfileRestrictionRefs(anomalySignals = {}) {
      const refs = [];
      const buckets = [
        ...(Array.isArray(anomalySignals.dataQualityGap) ? anomalySignals.dataQualityGap : []),
        ...(Array.isArray(anomalySignals.realAnomaly) ? anomalySignals.realAnomaly : []),
        ...(Array.isArray(anomalySignals.forecastProblem) ? anomalySignals.forecastProblem : []),
        ...(Array.isArray(anomalySignals.processGovernanceBreak)
          ? anomalySignals.processGovernanceBreak
          : []),
      ];

      for (const item of buckets) {
        if (!item?.ref) continue;
        refs.push({
          ref: item.ref,
          source: item.source || null,
          class: item.class || null,
          severity: item.severity || null,
        });
      }

      return refs;
    },

    deriveLoadProfileStreamStatus({
      qualitySummary,
      anomalySignals,
      hasPartialData,
      forecastQuality,
    }) {
      const dataQualityGap = (anomalySignals?.dataQualityGap || []).length;
      const realAnomaly = (anomalySignals?.realAnomaly || []).length;
      const forecastProblem = (anomalySignals?.forecastProblem || []).length;
      const governanceBreak = (anomalySignals?.processGovernanceBreak || []).length;

      const dataQuality = qualitySummary?.dataQuality;
      const rating = String(forecastQuality?.rating || '').toLowerCase();

      let signal = 'green';
      if (
        governanceBreak > 0 ||
        realAnomaly > 0 ||
        (typeof dataQuality === 'number' && dataQuality < 0.85) ||
        rating === 'poor'
      ) {
        signal = 'red';
      } else if (dataQualityGap > 0 || forecastProblem > 0 || hasPartialData || rating === 'fair') {
        signal = 'yellow';
      }

      return {
        signal,
        partial: !!hasPartialData,
        classification: {
          dataQualityGap,
          realAnomaly,
          forecastProblem,
          processGovernanceBreak: governanceBreak,
        },
        dataQuality: typeof dataQuality === 'number' ? dataQuality : null,
      };
    },

    buildLoadProfileDecisionNotes({
      streamStatus,
      anomalySignals,
      qualitySummary,
      forecastQuality,
      hasPartialData,
    }) {
      const notes = [];

      if (hasPartialData) {
        notes.push(
          'Partial findings active: mindestens eine Quelle ist nicht verfügbar, vorhandene Evidenz wurde dennoch ausgewertet.'
        );
      }

      if ((anomalySignals?.processGovernanceBreak || []).length > 0) {
        notes.push(
          'Process-governance break erkannt: offene kritische VDMI-Findings vor operativer Entscheidung schließen.'
        );
      }

      if ((anomalySignals?.dataQualityGap || []).length > 0) {
        notes.push(
          'Data-quality gap erkannt: Lücken/Dubletten/Monotonieabweichungen vor Prognosefreigabe bereinigen.'
        );
      }

      if ((anomalySignals?.realAnomaly || []).length > 0) {
        notes.push(
          'Real anomaly signal erkannt: Messwertausreißer/Negativwerte gegen Zähler- und Anlagenzustand verifizieren.'
        );
      }

      if ((anomalySignals?.forecastProblem || []).length > 0) {
        notes.push(
          'Forecast problem signal erkannt: SLP-/Forecast-Parameter und Vergleichsfenster nachkalibrieren.'
        );
      }

      if (qualitySummary && typeof qualitySummary.dataQuality === 'number') {
        notes.push(
          `Gemessene Datenqualität im Zeitraum: ${(qualitySummary.dataQuality * 100).toFixed(1)}%.`
        );
      }

      if (forecastQuality?.rating) {
        notes.push(`Forecast-Qualität: ${forecastQuality.rating} (MAPE=${forecastQuality.mape}).`);
      }

      if (notes.length === 0) {
        notes.push('Keine relevanten Auffälligkeiten erkannt; Stream aktuell unauffällig.');
      }

      notes.push(`Gesamtstatus: ${streamStatus?.signal || 'unknown'}.`);
      return notes;
    },

    filterFindingsForContext(findings, { gridOperatorId, meloId, maloId, assetId } = {}) {
      const list = Array.isArray(findings) ? findings : [];
      const requested = { gridOperatorId, meloId, maloId, assetId };
      return list.filter((finding) => {
        for (const [key, value] of Object.entries(requested)) {
          if (!value) continue;
          const candidates = [
            finding?.[key],
            finding?.context?.[key],
            finding?.asset?.[key],
            finding?.gridOperatorMastrId,
            finding?.operatorId,
          ].filter((v) => v != null);
          if (candidates.length > 0 && !candidates.some((v) => String(v) === String(value))) {
            return false;
          }
        }
        return true;
      });
    },

    buildRedispatchCallQualitySourceActions({
      rdRes,
      datapointRes,
      validationRes,
      forecastRes,
      vdmiRes,
      hasTimeseriesContext,
      rdLatest,
      validationFindings,
      vdmiFindings,
    }) {
      return {
        'redispatch-expost.list': {
          success: !!rdRes,
          audits: Array.isArray(rdRes?.audits) ? rdRes.audits.length : 0,
          selectedAuditId: rdLatest?.id || null,
        },
        'datapoint.health': {
          success: !!datapointRes,
          overview: datapointRes?.overview || null,
        },
        'edm-validation.validate': {
          success: !!validationRes,
          skipped: !hasTimeseriesContext,
          findings: validationFindings.length,
          dataQuality: validationRes?.summary?.dataQuality ?? null,
        },
        'forecast-engine.evaluateQuality': {
          success: !!forecastRes,
          skipped: !hasTimeseriesContext,
          rating: forecastRes?.quality?.rating || null,
        },
        'vdmi.findings': {
          success: !!vdmiRes,
          findings: vdmiFindings.length,
        },
      };
    },

    buildEvidenceGroundingConfidenceAudit({ params, routingRes, datapointRes, vdmiRes, ragRes, errors }) {
      const now = new Date().toISOString();
      const hasScope = !!(params.scopeId || params.gridOperatorId || params.datasourceId || params.datapointId);
      const hasDomainContext = !!(params.domain || params.capabilityId || params.sourceAction || params.query);
      const toolFailures = (errors || []).map((action) => ({
        action,
        impact: 'evidence_confidence_degraded',
      }));
      const ragItems = this.extractRagEvidenceItems(ragRes);
      const sourceClassBreakdown = this.buildEvidenceSourceClassBreakdown({
        params,
        ragItems,
        datapointRes,
        vdmiRes,
      });
      const missingEvidence = this.buildEvidenceGroundingMissingEvidence({
        params,
        hasScope,
        hasDomainContext,
        toolFailures,
        ragItems,
      });
      const requiresNetworkOperatorConfirmation =
        !params.networkOperatorConfirmed && this.requiresOperatorConfirmation(params);
      const scopeLimitations = [];
      if (!hasScope) {
        scopeLimitations.push({
          scopeFilter: 'grid_or_datasource_scope',
          reason: 'No gridOperatorId, scopeId, datasourceId or datapointId was supplied.',
        });
      }

      const routingScore = this.normalizeConfidenceScore(
        routingRes?.confidence ??
          routingRes?.recommendedCapabilities?.[0]?.confidence ??
          (params.capabilityId || params.sourceAction ? 0.72 : params.query ? 0.62 : 0.35)
      );
      const answerStatus = this.deriveEvidenceGroundingAnswerStatus({
        params,
        hasScope,
        hasDomainContext,
        toolFailures,
        requiresNetworkOperatorConfirmation,
      });
      const evidenceScore = this.deriveEvidenceConfidenceScore({
        answerStatus,
        hasScope,
        requiresNetworkOperatorConfirmation,
        sourceClassBreakdown,
        toolFailures,
      });
      const evidenceConfidence = {
        score: evidenceScore,
        level: evidenceScore >= 0.75 ? 'high' : evidenceScore >= 0.5 ? 'medium' : 'low',
        basis: this.buildEvidenceConfidenceBasis({
          answerStatus,
          hasScope,
          requiresNetworkOperatorConfirmation,
          toolFailures,
          sourceClassBreakdown,
        }),
      };
      const claims = this.buildEvidenceGroundingClaims({ params, ragItems, sourceClassBreakdown });
      const assumptions = this.buildEvidenceGroundingAssumptions({
        params,
        hasScope,
        requiresNetworkOperatorConfirmation,
      });
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: item.category,
      }));
      const sourceActions = this.buildEvidenceGroundingSourceActions({
        routingRes,
        datapointRes,
        vdmiRes,
        ragRes,
        params,
        errors,
      });
      const requestContext = {
        requestId: params.requestId || null,
        sessionId: params.sessionId || null,
        query: params.query || null,
        domain: params.domain || null,
        capabilityId: params.capabilityId || routingRes?.capability || null,
        sourceAction: params.sourceAction || routingRes?.recommendedPlan?.[0]?.action || null,
        scopeId: params.scopeId || null,
        gridOperatorId: params.gridOperatorId || null,
        datasourceId: params.datasourceId || null,
        datapointId: params.datapointId || null,
      };
      const dossierEvidence = {
        answerStatus,
        routingConfidence: {
          score: routingScore,
          capability: routingRes?.capability || params.capabilityId || null,
          preferredAction:
            routingRes?.recommendedPlan?.[0]?.action || params.sourceAction || null,
        },
        evidenceConfidence,
        sourceClassBreakdown,
        missingEvidence,
        positiveFollowUps,
      };

      return {
        auditId: params.requestId ? `egca:${params.requestId}` : `egca:${Buffer.from(`${params.domain || 'unknown'}:${params.query || params.sourceAction || now}`).toString('base64url').slice(0, 24)}`,
        tenantId: params.tenantId || null,
        requestContext,
        routingConfidence: dossierEvidence.routingConfidence,
        evidenceConfidence,
        answerStatus,
        sourceClassBreakdown,
        scopeFilters: {
          scopeId: params.scopeId || null,
          gridOperatorId: params.gridOperatorId || null,
          datasourceId: params.datasourceId || null,
          datapointId: params.datapointId || null,
        },
        claims,
        assumptions,
        sourceActions,
        sourceDatapoints: params.datapointId ? [{ datapointId: params.datapointId }] : [],
        ragCollections: ragItems.map((item) => item.collection).filter(Boolean),
        datasourceHealth: datapointRes?.overview || datapointRes || null,
        toolFailures,
        scopeLimitations,
        missingEvidence,
        requiresNetworkOperatorConfirmation,
        hitlItemIds: [],
        vdmiProcessId: null,
        positiveFollowUps,
        validationFindings: missingEvidence.map((item) => ({
          code: `EGCA_${String(item.missingDataPoint || 'missing').toUpperCase()}`,
          severity: item.severity || 'medium',
          message: item.enablesDossierAddition,
        })),
        dossierEvidence,
      };
    },

    buildMarketCommunicationEvidenceChainStatus(params = {}) {
      const officialSpecs = [
        {
          id: 'malo_identity',
          label: 'MaLo identity',
          value: params.maloId,
          sourceClass: 'official_market_location',
          enablesDossierAddition: 'bind the dossier to the official market location',
        },
        {
          id: 'melo_identity',
          label: 'MeLo identity',
          value: params.meloId,
          sourceClass: 'official_meter_location',
          enablesDossierAddition: 'bind the dossier to the official meter location',
        },
        {
          id: 'utilmd_masterdata_path',
          label: 'UTILMD/master-data path',
          value: params.utilmdMasterdataPath,
          sourceClass: 'official_market_communication',
          enablesDossierAddition: 'replace portal hints with official master-data provenance',
        },
        {
          id: 'meter_values',
          label: 'Meter values',
          value: params.meterValueBatchId,
          sourceClass: 'metering_evidence',
          enablesDossierAddition: 'add consumption-period meter-value evidence',
        },
        {
          id: 'consumption_retrieval',
          label: 'Consumption retrieval status',
          value: params.consumptionRetrievalStatus,
          sourceClass: 'edm_retrieval_evidence',
          enablesDossierAddition: 'add EDM retrieval-status statement',
        },
        {
          id: 'data_quality_status',
          label: 'Data-quality status',
          value: params.dataQualityStatus,
          sourceClass: 'edm_quality_evidence',
          enablesDossierAddition: 'add billing-readiness confidence',
        },
        {
          id: 'next_billing_step',
          label: 'Next billing step',
          value: params.nextBillingStep,
          sourceClass: 'settlement_context',
          enablesDossierAddition: 'add next settlement or billing action context without releasing billing',
        },
      ];
      const officialEvidence = officialSpecs
        .filter((spec) => spec.value != null && spec.value !== '')
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.value,
          sourceClass: spec.sourceClass,
          bindingStrength: 'official_evidence',
        }));
      const missingEvidence = officialSpecs
        .filter((spec) => spec.value == null || spec.value === '')
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const hintSpecs = [
        { id: 'portal_screenshot', label: 'Portal screenshot or portal view', value: params.portalHint },
        { id: 'provider_view', label: 'Service-provider view', value: params.providerView },
        { id: 'customer_statement', label: 'Customer or supplier statement', value: params.customerStatement },
      ];
      const hintsOnly = (params.includeHints ? hintSpecs : [])
        .filter((spec) => spec.value != null && spec.value !== '')
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.value,
          sourceClass: 'hint_only',
          bindingStrength: 'not_official_proof',
        }));
      const status =
        officialEvidence.length === officialSpecs.length
          ? 'official_evidence_complete'
          : officialEvidence.length === 0 && hintsOnly.length > 0
            ? 'hints_only'
            : 'needs_official_evidence';
      const dossierFacts = [
        `Status: ${status}`,
        `Official evidence items: ${officialEvidence.length}/${officialSpecs.length}`,
      ];
      if (hintsOnly.length > 0) {
        dossierFacts.push('Portal/provider/customer material is classified as hint only.');
      }
      if (params.maloId) dossierFacts.push(`MaLo: ${params.maloId}`);
      if (params.meloId) dossierFacts.push(`MeLo: ${params.meloId}`);

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'official_market_communication_evidence',
      }));

      return {
        chainId: `mako-ec:${Buffer.from(`${params.caseId || ''}:${params.maloId || ''}:${params.meloId || ''}:${params.contractAccountId || ''}`).toString('base64url').slice(0, 24)}`,
        safety: 'read_only',
        requestContext: {
          maloId: params.maloId || null,
          meloId: params.meloId || null,
          contractAccountId: params.contractAccountId || null,
          caseId: params.caseId || null,
        },
        status,
        officialEvidence,
        hintsOnly,
        missingEvidence,
        positiveFollowUps,
        dossierFacts,
        sourceActions: {
          inspected: ['dashboard-api.marketCommunicationEvidenceChainStatus'],
          notCalled: ['settlement.exportA96', 'settlement.prepareBilling', 'hitl.create'],
        },
        validationFindings: missingEvidence.map((item) => ({
          code: `MAKO_EVIDENCE_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
          severity: 'medium',
          message: item.enablesDossierAddition,
        })),
        dossierEvidence: {
          status,
          officialEvidence,
          hintsOnly,
          missingEvidence,
          positiveFollowUps,
          dossierFacts,
        },
      };
    },

    buildE2eControllabilityGovernanceStatus(params = {}) {
      const stepSpecs = [
        {
          id: 'connection_intake',
          label: 'Netzanschluss-/Asset-Identifikation',
          value: params.connectionIntake,
          role: 'Netzanschluss',
          decisionBoundary: 'Asset identity and connection context are known before controllability assumptions are used.',
          enablesDossierAddition: 'add Netzanschluss and asset identity context',
        },
        {
          id: 'metering_concept',
          label: 'Mess-/TAF-/EDM-Konzept',
          value: params.meteringConcept,
          role: 'Metering',
          decisionBoundary: 'Metering and TAF readiness are explicit before data-quality or control readiness is claimed.',
          enablesDossierAddition: 'add TAF and Messkonzept readiness',
        },
        {
          id: 'asset_control_capability',
          label: 'Asset-Steuerbarkeitsnachweis',
          value: params.assetControlCapability,
          role: 'Asset Management',
          decisionBoundary: 'Asset controllability remains an evidence requirement, not an inferred property.',
          enablesDossierAddition: 'add asset-control assumption boundary',
        },
        {
          id: 'grid_operations_decision',
          label: 'Netzbetrieb/Redispatch-/§14a-Entscheidung',
          value: params.gridOperationsDecision,
          role: 'Netzbetrieb',
          decisionBoundary: 'Operational readiness is separated from technical switching or dispatch execution.',
          enablesDossierAddition: 'add Redispatch or §14a operations readiness',
        },
        {
          id: 'market_communication_handover',
          label: 'Marktkommunikations-Abgabe',
          value: params.marketCommunicationHandover,
          role: 'Marktkommunikation',
          decisionBoundary: 'MaKo handover evidence is required before downstream settlement context is treated as traceable.',
          enablesDossierAddition: 'add MaKo handover traceability',
        },
        {
          id: 'billing_impact_check',
          label: 'Abrechnungs-/Settlement-Grenze',
          value: params.billingImpactCheck,
          role: 'Abrechnung',
          decisionBoundary: 'Billing impact is a boundary note only; no billing or settlement release is performed.',
          enablesDossierAddition: 'add Abrechnung boundary clarity',
        },
      ];

      const evidenceMatrix = stepSpecs.map((spec, index) => ({
        stepId: spec.id,
        order: index + 1,
        label: spec.label,
        ownerRole: spec.role,
        evidenceValue: spec.value || null,
        evidenceStatus: spec.value ? 'provided' : 'missing',
        decisionBoundary: spec.decisionBoundary,
      }));
      const gaps = stepSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          ownerRole: spec.role,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      if (!params.owner) {
        gaps.push({
          missingDataPoint: 'owner',
          label: 'Accountable Owner',
          ownerRole: 'Governance',
          enablesDossierAddition: 'add accountable handover status',
        });
      }
      if (!params.deadline) {
        gaps.push({
          missingDataPoint: 'deadline',
          label: 'Handover Deadline',
          ownerRole: 'Governance',
          enablesDossierAddition: 'add due-date and escalation context',
        });
      }
      if (!params.openMeasure) {
        gaps.push({
          missingDataPoint: 'open_measure',
          label: 'Open Measure',
          ownerRole: 'Governance',
          enablesDossierAddition: 'add next open measure for closure tracking',
        });
      }

      const coveredSteps = evidenceMatrix.filter((item) => item.evidenceStatus === 'provided');
      const status =
        gaps.length === 0
          ? 'governance_evidence_complete'
          : coveredSteps.length === 0
            ? 'needs_governance_evidence'
            : 'partial_governance_evidence';
      const positiveFollowUps = gaps.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'e2e_controllability_governance',
      }));
      const processSteps = evidenceMatrix.map((item) => ({
        id: item.stepId,
        label: item.label,
        ownerRole: item.ownerRole,
        evidenceStatus: item.evidenceStatus,
      }));
      const owners = params.owner
        ? [{ id: 'accountable_owner', label: 'Accountable Owner', value: params.owner }]
        : [];
      const deadlines = params.deadline
        ? [{ id: 'handover_deadline', label: 'Handover Deadline', value: params.deadline }]
        : [];
      const openMeasures = params.openMeasure
        ? [{ id: 'open_measure', label: 'Open Measure', value: params.openMeasure }]
        : [];
      const dossierFacts = [
        `Status: ${status}`,
        `Covered governance steps: ${coveredSteps.length}/${stepSpecs.length}`,
        `Open gaps: ${gaps.length}`,
      ];
      if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

      return {
        governanceId: `e2e-ccg:${Buffer.from(`${params.caseId || ''}:${params.owner || ''}:${params.deadline || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'e2e_controllability_check_governance',
        safety: 'read_only',
        requestContext: {
          caseId: params.caseId || null,
          owner: params.owner || null,
          deadline: params.deadline || null,
        },
        status,
        processSteps,
        evidenceMatrix,
        decisionBoundaries: evidenceMatrix.map((item) => ({
          stepId: item.stepId,
          label: item.label,
          boundary: item.decisionBoundary,
        })),
        owners,
        deadlines,
        openMeasures,
        gaps,
        positiveFollowUps,
        dossierFacts,
        sourceActions: {
          inspected: ['dashboard-api.e2eControllabilityGovernanceStatus'],
          referenced: [
            'vdmi.dossier',
            'vdmi.evidence',
            'interface-placeholder.requestEvidence',
            'grid-operations.controlMeasures',
            'edm-messkonzept.evaluate',
            'edm-validation.validate',
          ],
          notCalled: [
            'hitl.create',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'grid-operations.executeControl',
          ],
        },
        validationFindings: gaps.map((item) => ({
          code: `E2E_CCG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
          severity: 'medium',
          message: item.enablesDossierAddition,
        })),
        dossierEvidence: {
          status,
          processSteps,
          evidenceMatrix,
          gaps,
          positiveFollowUps,
          owners,
          deadlines,
          openMeasures,
          dossierFacts,
        },
      };
    },

    buildControllabilityAssetHandoverStatus(params = {}) {
      const dataSourceRefs = Array.isArray(params.dataSourceRefs)
        ? params.dataSourceRefs.filter(Boolean)
        : params.dataSourceRefs
          ? String(params.dataSourceRefs).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const evidenceSpecs = [
        {
          id: 'asset_inventory',
          label: 'Asset inventory',
          value: params.assetId || params.mastrId,
          sourceClass: 'asset_master_data',
          enablesDossierAddition: 'add asset identity and inventory reference',
        },
        {
          id: 'nap_melo_mapping',
          label: 'NAP/MeLo mapping',
          value: params.napId || params.meloId,
          sourceClass: 'connection_meter_mapping',
          enablesDossierAddition: 'add NAP and MeLo mapping evidence',
        },
        {
          id: 'technical_status',
          label: 'Technical status',
          value: params.technicalStatus,
          sourceClass: 'technical_readiness',
          enablesDossierAddition: 'add technical readiness evidence',
        },
        {
          id: 'feedback_capability',
          label: 'Feedback capability',
          value: params.feedbackCapability,
          sourceClass: 'remote_feedback',
          enablesDossierAddition: 'add Rueckmelde-/Fernsteuerbarkeits evidence',
        },
        {
          id: 'controllability_scope',
          label: 'Controllability scope',
          value: params.controllabilityScope,
          sourceClass: 'control_scope',
          enablesDossierAddition: 'add controllability scope boundary',
        },
        {
          id: 'data_source_snapshot',
          label: 'Source snapshot',
          value: params.sourceSnapshotId || (dataSourceRefs.length > 0 ? dataSourceRefs.join(',') : null),
          sourceClass: 'source_snapshot',
          enablesDossierAddition: 'add source and freshness proof',
        },
        {
          id: 'check_result',
          label: 'Check result',
          value: params.checkStatus || params.evidenceStatus,
          sourceClass: 'check_status',
          enablesDossierAddition: 'add check result evidence',
        },
        {
          id: 'line_owner',
          label: 'Line owner',
          value: params.lineOwnerRole,
          sourceClass: 'line_handover_owner',
          enablesDossierAddition: 'add accountable line handover ownership',
        },
        {
          id: 'next_reporting_cycle',
          label: 'Next reporting cycle',
          value: params.nextReportingCycle,
          sourceClass: 'line_monitoring_cycle',
          enablesDossierAddition: 'add recurring monitoring cadence',
        },
        {
          id: 'handover_decision',
          label: 'Handover decision',
          value: params.handoverDecision,
          sourceClass: 'line_transition_decision',
          enablesDossierAddition: 'add explicit line-transition decision',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value != null && spec.value !== '')
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => spec.value == null || spec.value === '')
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      if (params.nonExecutionReason) {
        evidenceItems.push({
          id: 'non_execution_reason',
          label: 'Non-execution reason',
          value: params.nonExecutionReason,
          sourceClass: 'defensible_non_execution_context',
          evidenceStatus: 'provided',
        });
      }

      const status =
        missingEvidence.length === 0
          ? 'ready_for_handover'
          : !params.technicalStatus
            ? 'needs_technical_check'
            : !params.feedbackCapability
              ? 'needs_feedback_capability'
              : !params.lineOwnerRole
                ? 'needs_owner'
                : !params.handoverDecision
                  ? 'needs_handover_decision'
                  : 'needs_evidence';
      const asset = {
        assetId: params.assetId || null,
        mastrId: params.mastrId || null,
        napId: params.napId || null,
        meloId: params.meloId || null,
        technologyType: params.technologyType || null,
        capacityKW: params.capacityKW ?? null,
        controllabilityScope: params.controllabilityScope || null,
      };
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'controllability_asset_handover',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `CAH_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['line_owner', 'handover_decision', 'technical_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      const providedRequiredEvidence = evidenceItems.filter((item) => item.id !== 'non_execution_reason');
      const dossierFacts = [
        `Status: ${status}`,
        `Provided handover evidence: ${providedRequiredEvidence.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.assetId) dossierFacts.push(`Asset: ${params.assetId}`);
      if (params.lineOwnerRole) dossierFacts.push(`Line Owner: ${params.lineOwnerRole}`);
      if (params.handoverDecision) dossierFacts.push(`Decision: ${params.handoverDecision}`);

      return {
        handoverId: `cah:${Buffer.from(`${params.caseId || ''}:${params.assetId || ''}:${params.mastrId || ''}:${params.lineOwnerRole || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'controllability_asset_handover',
        safety: 'read_only',
        requestContext: {
          caseId: params.caseId || null,
          sourceSnapshotId: params.sourceSnapshotId || null,
          dataSourceRefs,
        },
        status,
        asset,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        handoverDecision: params.handoverDecision || null,
        lineOwnerRole: params.lineOwnerRole || null,
        nextReportingCycle: params.nextReportingCycle || null,
        nonExecutionReason: params.nonExecutionReason || null,
        blockingFindings,
        sourceActions: {
          inspected: ['dashboard-api.controllabilityAssetHandoverStatus'],
          referenced: [
            'assets.effective',
            'mastr-quality.audit',
            'redispatch-expost.audit',
            'datapoint.health',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence',
          ],
          notCalled: [
            'hitl.create',
            'assets.applyOverride',
            'grid-operations.executeControl',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'external.connector.call',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          asset,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          handoverDecision: params.handoverDecision || null,
          lineOwnerRole: params.lineOwnerRole || null,
          nextReportingCycle: params.nextReportingCycle || null,
          nonExecutionReason: params.nonExecutionReason || null,
          blockingFindings,
          dossierFacts,
        },
      };
    },

    buildRegulatoryChangeReadinessStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const affectedSystems = toList(params.affectedSystems);
      const sourceDatapoints = toList(params.sourceDatapoints);
      const makoCases = toList(params.makoCases);
      const evidenceSpecs = [
        {
          id: 'data_contract',
          label: 'Regulatory change data contract',
          value: params.changeId && params.effectiveDate && params.mechanismType,
          displayValue: [params.changeId, params.effectiveDate, params.mechanismType].filter(Boolean).join(' / '),
          sourceClass: 'regulatory_change_contract',
          enablesDossierAddition: 'add change id, effective date and mechanism type',
        },
        {
          id: 'dictionary_version',
          label: 'Data dictionary version',
          value: params.dictionaryVersion,
          sourceClass: 'data_dictionary',
          enablesDossierAddition: 'add dictionary-grounded mechanism contract',
        },
        {
          id: 'source_datapoints',
          label: 'Source datapoints',
          value: sourceDatapoints.length > 0,
          displayValue: sourceDatapoints.join(', '),
          sourceClass: 'source_datapoint_snapshot',
          enablesDossierAddition: 'add referenced datapoint snapshot evidence',
        },
        {
          id: 'interval_profile_coverage',
          label: 'Interval profile coverage',
          value: params.intervalCoverage,
          sourceClass: 'interval_profile',
          enablesDossierAddition: 'add Viertelstundenprofil readiness proof',
        },
        {
          id: 'master_data_quality',
          label: 'Master data quality',
          value: params.masterDataStatus,
          sourceClass: 'master_data_quality',
          enablesDossierAddition: 'add MaStR/NAP/MeLo/master-data quality proof',
        },
        {
          id: 'substitute_value_policy',
          label: 'Substitute value policy',
          value: params.substituteValuePolicy,
          sourceClass: 'substitute_value_policy',
          enablesDossierAddition: 'add Ersatzwert policy evidence',
        },
        {
          id: 'market_communication_cases',
          label: 'MaKo special cases',
          value: makoCases.length > 0,
          displayValue: makoCases.join(', '),
          sourceClass: 'market_communication_case_pack',
          enablesDossierAddition: 'add MaKo Sonderfall test coverage',
        },
        {
          id: 'operator_declaration',
          label: 'Operator declaration',
          value: params.operatorDeclarationStatus,
          sourceClass: 'operator_declaration',
          enablesDossierAddition: 'add Betreibererklaerung readiness',
        },
        {
          id: 'billing_rule_reference',
          label: 'Billing rule reference',
          value: params.billingRuleReference,
          sourceClass: 'billing_rule_reference',
          enablesDossierAddition: 'add billing-rule reference evidence',
        },
        {
          id: 'audit_trail',
          label: 'Audit trail',
          value: params.auditTrailStatus,
          sourceClass: 'audit_trail',
          enablesDossierAddition: 'add audit evidence trail',
        },
        {
          id: 'test_case_pack',
          label: 'Test-case pack',
          value: params.testCasePackStatus,
          sourceClass: 'third_party_test_cases',
          enablesDossierAddition: 'add generated Drittsystem test-case requirements',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const lowerMasterData = String(params.masterDataStatus || '').toLowerCase();
      const blockedByDataQuality = /block|fail|invalid|kritisch|unbrauchbar/.test(lowerMasterData);
      const status =
        blockedByDataQuality
          ? 'blocked_by_data_quality'
          : missingEvidence.length === 0
            ? 'ready_for_simulation'
            : !params.changeId || !params.effectiveDate || !params.mechanismType || !params.dictionaryVersion
              ? 'needs_data_contract'
              : !params.intervalCoverage
                ? 'needs_interval_profile'
                : !params.masterDataStatus
                  ? 'needs_masterdata'
                  : !params.substituteValuePolicy
                    ? 'needs_substitute_value_policy'
                    : makoCases.length === 0
                      ? 'needs_mako_cases'
                      : !params.operatorDeclarationStatus
                        ? 'needs_operator_declaration'
                        : !params.auditTrailStatus
                          ? 'needs_audit_evidence'
                          : 'needs_test_data';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'regulatory_change_readiness',
      }));
      const generatedTestCaseRequirements = missingEvidence
        .filter((item) => [
          'interval_profile_coverage',
          'master_data_quality',
          'substitute_value_policy',
          'market_communication_cases',
          'billing_rule_reference',
          'audit_trail',
        ].includes(item.missingDataPoint))
        .map((item) => ({
          id: `test_${item.missingDataPoint}`,
          requiredEvidence: item.missingDataPoint,
          description: item.enablesDossierAddition,
        }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `RCR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['data_contract', 'dictionary_version', 'master_data_quality', 'audit_trail'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByDataQuality) {
        blockingFindings.push({
          code: 'RCR_MASTER_DATA_QUALITY_BLOCKING',
          severity: 'high',
          message: 'master-data quality is explicitly blocking the readiness contract',
        });
      }
      const dossierFacts = [
        `Status: ${status}`,
        `Provided readiness evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.changeId) dossierFacts.push(`Change: ${params.changeId}`);
      if (params.effectiveDate) dossierFacts.push(`Effective date: ${params.effectiveDate}`);
      if (params.mechanismType) dossierFacts.push(`Mechanism: ${params.mechanismType}`);

      return {
        readinessId: `rcr:${Buffer.from(`${params.changeId || ''}:${params.effectiveDate || ''}:${params.mechanismType || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'regulatory_change_simulator_readiness',
        safety: 'read_only',
        requestContext: {
          changeId: params.changeId || null,
          effectiveDate: params.effectiveDate || null,
          mechanismType: params.mechanismType || null,
          affectedSystems,
        },
        status,
        readinessScore,
        evidenceItems,
        missingEvidence,
        generatedTestCaseRequirements,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceDatapoints,
          dictionaryVersion: params.dictionaryVersion || null,
          makoCases,
          billingRuleReference: params.billingRuleReference || null,
        },
        sourceActions: {
          inspected: ['dashboard-api.regulatoryChangeReadinessStatus'],
          referenced: [
            'datasource-registry.get',
            'datapoint.health',
            'datapoint.validateSnapshot',
            'mastr-quality.audit',
            'edm-validation.validate',
            'mscons-import.import',
            'settlement.readiness',
            'vdmi.dossier',
            'presentation.generate',
          ],
          notCalled: [
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          evidenceItems,
          missingEvidence,
          generatedTestCaseRequirements,
          positiveFollowUps,
          blockingFindings,
          sourceEvidence: {
            sourceDatapoints,
            dictionaryVersion: params.dictionaryVersion || null,
            makoCases,
            billingRuleReference: params.billingRuleReference || null,
          },
          dossierFacts,
        },
      };
    },

    buildInvestmentTwoTrackControlStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceDatapoints = toList(params.sourceDatapoints);
      const explicitBlockedDecisions = toList(params.blockedDecisions);
      const evidenceSpecs = [
        {
          id: 'submission_contract',
          track: 'tactical',
          label: 'Tactical submission contract',
          value: params.submissionId && params.deadline && params.submissionFormat,
          displayValue: [params.submissionId, params.deadline, params.submissionFormat].filter(Boolean).join(' / '),
          sourceClass: 'investment_submission_contract',
          enablesDossierAddition: 'add submission id, deadline and required submission format',
        },
        {
          id: 'tactical_owner',
          track: 'tactical',
          label: 'Tactical submission owner',
          value: params.tacticalOwner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add accountable tactical submission owner',
        },
        {
          id: 'measures_and_budget',
          track: 'tactical',
          label: 'Measures and budget envelope',
          value: Number(params.measureCount || 0) > 0 && params.budgetEnvelopeEur != null,
          displayValue: `${params.measureCount || 0} measures / ${params.budgetEnvelopeEur ?? 'no'} EUR`,
          sourceClass: 'investment_plan_measure_pack',
          enablesDossierAddition: 'add measure count and budget-envelope confidence',
        },
        {
          id: 'finance_review',
          track: 'tactical',
          label: 'Finance review state',
          value: params.financeReviewStatus,
          sourceClass: 'finance_review',
          enablesDossierAddition: 'add finance-review state and budget-envelope confidence',
        },
        {
          id: 'board_format',
          track: 'tactical',
          label: 'Board / committee format',
          value: params.boardReadiness,
          sourceClass: 'board_submission_format',
          enablesDossierAddition: 'add board or committee submission readiness',
        },
        {
          id: 'source_datapoints',
          track: 'shared',
          label: 'Source datapoints',
          value: sourceDatapoints.length > 0,
          displayValue: sourceDatapoints.join(', '),
          sourceClass: 'source_datapoint_snapshot',
          enablesDossierAddition: 'add referenced investment datapoint snapshot evidence',
        },
        {
          id: 'data_quality_plan',
          track: 'target',
          label: 'Target-process data-quality plan',
          value: params.dataQualityStatus,
          sourceClass: 'data_quality_plan',
          enablesDossierAddition: 'add target-process data-quality closure path',
        },
        {
          id: 'target_owner',
          track: 'target',
          label: 'Target-process owner',
          value: params.targetOwner,
          sourceClass: 'target_process_owner',
          enablesDossierAddition: 'add accountable target-process owner',
        },
        {
          id: 'approval_model',
          track: 'target',
          label: 'Role and approval model',
          value: params.approvalModel,
          sourceClass: 'role_approval_model',
          enablesDossierAddition: 'add role and approval-model evidence',
        },
        {
          id: 'handover_status',
          track: 'target',
          label: 'Target-process handover status',
          value: params.handoverStatus,
          sourceClass: 'target_process_handover',
          enablesDossierAddition: 'add target-process handover readiness',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          track: spec.track,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          track: spec.track,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const lowerApproval = String(params.approvalModel || '').toLowerCase();
      const lowerDataQuality = String(params.dataQualityStatus || '').toLowerCase();
      const blockedByApproval = /block|missing|none|unklar|offen|rejected|abgelehnt/.test(lowerApproval);
      const blockedByDataQuality = /block|fail|critical|kritisch|unbrauchbar/.test(lowerDataQuality);
      const status =
        blockedByApproval
          ? 'blocked_by_approval'
          : blockedByDataQuality
            ? 'needs_data_quality'
            : !params.tacticalOwner
              ? 'needs_tactical_owner'
              : !params.financeReviewStatus
                ? 'needs_finance_review'
                : !params.boardReadiness
                  ? 'needs_board_format'
                  : !params.dataQualityStatus || !params.targetOwner || !params.approvalModel || !params.handoverStatus
                    ? 'target_process_pending'
                    : missingEvidence.length === 0
                      ? 'ready_for_submission'
                      : 'needs_data_quality';
      const tacticalEvidence = evidenceItems.filter((item) => item.track === 'tactical').length;
      const tacticalTotal = evidenceSpecs.filter((item) => item.track === 'tactical').length;
      const targetEvidence = evidenceItems.filter((item) => item.track === 'target').length;
      const targetTotal = evidenceSpecs.filter((item) => item.track === 'target').length;
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'investment_two_track_control',
        track: item.track,
      }));
      const derivedBlockedDecisions = missingEvidence
        .filter((item) => ['tactical_owner', 'finance_review', 'board_format', 'data_quality_plan', 'approval_model', 'handover_status'].includes(item.missingDataPoint))
        .map((item) => item.label);
      const blockedDecisions = Array.from(new Set([...explicitBlockedDecisions, ...derivedBlockedDecisions]));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `ITC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['tactical_owner', 'finance_review', 'approval_model'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByApproval) {
        blockingFindings.push({
          code: 'ITC_APPROVAL_MODEL_BLOCKING',
          severity: 'high',
          message: 'approval model is explicitly blocking the two-track control view',
        });
      }
      const tacticalTrack = {
        readiness: `${tacticalEvidence}/${tacticalTotal}`,
        owner: params.tacticalOwner || null,
        deadline: params.deadline || null,
        submissionFormat: params.submissionFormat || null,
        measureCount: params.measureCount ?? null,
        budgetEnvelopeEur: params.budgetEnvelopeEur ?? null,
        financeReviewStatus: params.financeReviewStatus || null,
        boardReadiness: params.boardReadiness || null,
      };
      const targetTrack = {
        readiness: `${targetEvidence}/${targetTotal}`,
        owner: params.targetOwner || null,
        dataQualityStatus: params.dataQualityStatus || null,
        approvalModel: params.approvalModel || null,
        handoverStatus: params.handoverStatus || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Tactical readiness: ${tacticalTrack.readiness}`,
        `Target readiness: ${targetTrack.readiness}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.submissionId) dossierFacts.push(`Submission: ${params.submissionId}`);
      if (params.deadline) dossierFacts.push(`Deadline: ${params.deadline}`);
      if (params.tacticalOwner) dossierFacts.push(`Tactical Owner: ${params.tacticalOwner}`);
      if (params.targetOwner) dossierFacts.push(`Target Owner: ${params.targetOwner}`);

      return {
        controlId: `itc:${Buffer.from(`${params.submissionId || ''}:${params.gridOperatorId || ''}:${params.deadline || ''}:${params.tacticalOwner || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'investment_two_track_control',
        safety: 'read_only',
        requestContext: {
          submissionId: params.submissionId || null,
          gridOperatorId: params.gridOperatorId || null,
          deadline: params.deadline || null,
          sourceDatapoints,
        },
        status,
        readinessScore,
        tacticalTrack,
        targetTrack,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          sourceDatapoints,
          budgetEnvelopeEur: params.budgetEnvelopeEur ?? null,
          measureCount: params.measureCount ?? null,
        },
        sourceActions: {
          inspected: ['dashboard-api.investmentTwoTrackControlStatus'],
          referenced: [
            'datasource-registry.get',
            'datapoint.health',
            'investment-planning.createPlan',
            'finance-agent.analyze',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence',
            'presentation.generate',
          ],
          notCalled: [
            'investment-planning.createPlan',
            'finance-agent.mutate',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'sap.psp.write',
            'hitl.create',
            'vdmi.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          tacticalTrack,
          targetTrack,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceEvidence: {
            sourceDatapoints,
            budgetEnvelopeEur: params.budgetEnvelopeEur ?? null,
            measureCount: params.measureCount ?? null,
          },
          dossierFacts,
        },
      };
    },

    buildSapBudgetPspGateStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const explicitBlockedDecisions = toList(params.blockedDecisions);
      const hasNumber = (value) => Number.isFinite(Number(value));
      const availableBudget = hasNumber(params.availableBudgetEur) ? Number(params.availableBudgetEur) : null;
      const plannedValue = hasNumber(params.plannedValueEur) ? Number(params.plannedValueEur) : null;
      const committedValue = hasNumber(params.committedValueEur) ? Number(params.committedValueEur) : null;
      const pspCarryOver = hasNumber(params.pspCarryOverEur) ? Number(params.pspCarryOverEur) : null;
      const budgetOverhang = hasNumber(params.budgetOverhangEur)
        ? Number(params.budgetOverhangEur)
        : availableBudget != null && plannedValue != null && committedValue != null
          ? Number((availableBudget - plannedValue - committedValue).toFixed(2))
          : null;
      const effectiveBudgetGap = availableBudget != null && plannedValue != null && committedValue != null
        ? Number((plannedValue + committedValue - availableBudget).toFixed(2))
        : null;
      const evidenceSpecs = [
        {
          id: 'measure_context',
          label: 'Measure and migration context',
          value: params.measureId && params.measureName && params.migrationWave,
          displayValue: [params.measureId, params.measureName, params.migrationWave].filter(Boolean).join(' / '),
          sourceClass: 'investment_measure_context',
          enablesDossierAddition: 'add measure identity, name and SAP migration wave',
        },
        {
          id: 'sap_mapping',
          label: 'SAP system and legacy internal order mapping',
          value: params.sapSystemRef && params.legacyInternalOrderId,
          displayValue: [params.sapSystemRef, params.legacyInternalOrderId].filter(Boolean).join(' / '),
          sourceClass: 'sap_target_process_mapping',
          enablesDossierAddition: 'add SAP target-process and legacy internal-order evidence',
        },
        {
          id: 'psp_snapshot',
          label: 'PSP element and carry-over snapshot',
          value: params.pspElementId && pspCarryOver != null && params.sourceSnapshotId,
          displayValue: [params.pspElementId, pspCarryOver, params.sourceSnapshotId].filter(Boolean).join(' / '),
          sourceClass: 'psp_carry_over_snapshot',
          enablesDossierAddition: 'add PSP carry-over and source snapshot evidence',
        },
        {
          id: 'budget_values',
          label: 'Budget, plan and commitment values',
          value: availableBudget != null && plannedValue != null && committedValue != null,
          displayValue: `${availableBudget ?? 'no'} available / ${plannedValue ?? 'no'} planned / ${committedValue ?? 'no'} committed`,
          sourceClass: 'budget_value_snapshot',
          enablesDossierAddition: 'add available budget, planned value and committed value evidence',
        },
        {
          id: 'budget_owner',
          label: 'Budget owner role',
          value: params.ownerRole,
          sourceClass: 'accountable_budget_owner',
          enablesDossierAddition: 'add accountable budget owner and escalation path',
        },
        {
          id: 'asset_benefit',
          label: 'Asset benefit and priority rationale',
          value: params.assetBenefit && hasNumber(params.priorityScore),
          displayValue: [params.assetBenefit, params.priorityScore].filter((v) => v != null && v !== '').join(' / '),
          sourceClass: 'asset_benefit_prioritization',
          enablesDossierAddition: 'add asset-benefit and prioritisation rationale for the measure',
        },
        {
          id: 'finance_gate',
          label: 'Finance gate',
          value: params.financeGate,
          sourceClass: 'finance_gate_state',
          enablesDossierAddition: 'add finance-gate and board-submission readiness',
        },
        {
          id: 'approval_status',
          label: 'Approval status',
          value: params.approvalStatus,
          sourceClass: 'approval_state',
          enablesDossierAddition: 'add approval-state evidence and blocked-decision context',
        },
        {
          id: 'data_quality',
          label: 'Data quality status',
          value: params.dataQualityStatus,
          sourceClass: 'source_data_quality',
          enablesDossierAddition: 'add source-data quality and auditability evidence',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const lowerApproval = String(params.approvalStatus || '').toLowerCase();
      const lowerDataQuality = String(params.dataQualityStatus || '').toLowerCase();
      const blockedByApproval = /block|blocked|rejected|abgelehnt|stop|gesperrt/.test(lowerApproval);
      const blockedByDataQuality = /block|fail|critical|kritisch|unbrauchbar|rejected/.test(lowerDataQuality);
      const status =
        blockedByApproval
          ? 'blocked_by_approval'
          : blockedByDataQuality
            ? 'blocked_by_data_quality'
            : !params.pspElementId || pspCarryOver == null || !params.sourceSnapshotId
              ? 'needs_psp_snapshot'
              : !params.ownerRole
                ? 'needs_budget_owner'
                : !params.assetBenefit || !hasNumber(params.priorityScore)
                  ? 'needs_asset_benefit'
                  : !params.sapSystemRef || !params.legacyInternalOrderId
                    ? 'needs_sap_mapping'
                    : !params.financeGate || !params.approvalStatus
                      ? 'needs_finance_gate'
                      : missingEvidence.length === 0
                        ? 'ready_for_finance_gate'
                        : 'needs_budget_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'sap_budget_psp_gate',
      }));
      const derivedBlockedDecisions = missingEvidence
        .filter((item) => ['psp_snapshot', 'budget_owner', 'asset_benefit', 'finance_gate', 'approval_status', 'data_quality'].includes(item.missingDataPoint))
        .map((item) => item.label);
      const blockedDecisions = Array.from(new Set([...explicitBlockedDecisions, ...derivedBlockedDecisions]));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `SBP_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['psp_snapshot', 'budget_owner', 'finance_gate', 'approval_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByApproval) {
        blockingFindings.push({
          code: 'SBP_APPROVAL_BLOCKING',
          severity: 'high',
          message: 'approval status is explicitly blocking the SAP/PSP budget gate',
        });
      }
      if (blockedByDataQuality) {
        blockingFindings.push({
          code: 'SBP_DATA_QUALITY_BLOCKING',
          severity: 'high',
          message: 'data quality is explicitly blocking the SAP/PSP budget gate',
        });
      }
      const measureContext = {
        measureId: params.measureId || null,
        measureName: params.measureName || null,
        migrationWave: params.migrationWave || null,
        sapSystemRef: params.sapSystemRef || null,
        legacyInternalOrderId: params.legacyInternalOrderId || null,
        pspElementId: params.pspElementId || null,
      };
      const budgetEvidence = {
        availableBudgetEur: availableBudget,
        plannedValueEur: plannedValue,
        committedValueEur: committedValue,
        pspCarryOverEur: pspCarryOver,
        budgetOverhangEur: budgetOverhang,
        effectiveBudgetGapEur: effectiveBudgetGap,
      };
      const gateEvidence = {
        assetBenefit: params.assetBenefit || null,
        priorityScore: hasNumber(params.priorityScore) ? Number(params.priorityScore) : null,
        ownerRole: params.ownerRole || null,
        approvalStatus: params.approvalStatus || null,
        financeGate: params.financeGate || null,
        dataQualityStatus: params.dataQualityStatus || null,
        sourceSnapshotId: params.sourceSnapshotId || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided gate evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.measureId) dossierFacts.push(`Measure: ${params.measureId}`);
      if (params.pspElementId) dossierFacts.push(`PSP: ${params.pspElementId}`);
      if (budgetOverhang != null) dossierFacts.push(`Budget overhang EUR: ${budgetOverhang}`);
      if (effectiveBudgetGap != null) dossierFacts.push(`Budget gap EUR: ${effectiveBudgetGap}`);

      return {
        gateId: `sbp:${Buffer.from(`${params.measureId || ''}:${params.migrationWave || ''}:${params.pspElementId || ''}:${params.sourceSnapshotId || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'sap_budget_psp_gate',
        safety: 'read_only',
        requestContext: {
          measureId: params.measureId || null,
          migrationWave: params.migrationWave || null,
          sourceSnapshotId: params.sourceSnapshotId || null,
        },
        status,
        readinessScore,
        measureContext,
        budgetEvidence,
        gateEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          measureContext,
          budgetEvidence,
          gateEvidence,
        },
        sourceActions: {
          inspected: ['dashboard-api.sapBudgetPspGateStatus'],
          referenced: [
            'datasource-registry.get',
            'datapoint.health',
            'investment-planning.createPlan',
            'finance-agent.analyze',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence',
            'presentation.generate',
          ],
          notCalled: [
            'sap.psp.write',
            'sap.budget.write',
            'finance-agent.mutate',
            'investment-planning.createPlan',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'hitl.create',
            'vdmi.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          measureContext,
          budgetEvidence,
          gateEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          dossierFacts,
        },
      };
    },

    buildEnergyTaxInformationPackageStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const period = params.period || [params.periodStart, params.periodEnd].filter(Boolean).join('/');
      const sourceRefs = toList(params.sourceRefs);
      const evidenceSpecs = [
        {
          id: 'package_identity',
          label: 'Package and source identity',
          value: params.packageId && params.dataSourceId,
          displayValue: [params.packageId, params.dataSourceId].filter(Boolean).join(' / '),
          sourceClass: 'information_package_identity',
          enablesDossierAddition: 'add the package id and source data reference to the tax/finance handover',
        },
        {
          id: 'data_dictionary',
          label: 'Data dictionary version',
          value: params.dictionaryVersion,
          sourceClass: 'data_dictionary_contract',
          enablesDossierAddition: 'add semantically stable field definitions for the package',
        },
        {
          id: 'period_definition',
          label: 'Package period',
          value: period,
          sourceClass: 'period_definition',
          enablesDossierAddition: 'add the time-bounded tax/finance handover period',
        },
        {
          id: 'aggregation_logic',
          label: 'Aggregation logic',
          value: params.aggregationLogic,
          sourceClass: 'aggregation_logic',
          enablesDossierAddition: 'add reproducible aggregation logic for audit review',
        },
        {
          id: 'validation_status',
          label: 'Validation status',
          value: params.validationStatus,
          sourceClass: 'validation_status',
          enablesDossierAddition: 'add handover readiness based on validated source data',
        },
        {
          id: 'responsible_owner',
          label: 'Responsible owner',
          value: params.responsibleOwner,
          sourceClass: 'source_owner',
          enablesDossierAddition: 'add accountable owner and escalation context',
        },
        {
          id: 'handover_contact',
          label: 'Handover contact role',
          value: params.contactRole,
          sourceClass: 'handover_contact',
          enablesDossierAddition: 'add contact role for tax/finance follow-up',
        },
        {
          id: 'sla',
          label: 'SLA / response window',
          value: params.sla,
          sourceClass: 'handover_sla',
          enablesDossierAddition: 'add SLA and ageing context for open questions',
        },
        {
          id: 'audit_reference',
          label: 'Audit reference',
          value: params.auditReference,
          sourceClass: 'audit_reference',
          enablesDossierAddition: 'add audit-traceable package support',
        },
        {
          id: 'handover_decision',
          label: 'Handover decision',
          value: params.handoverDecision,
          sourceClass: 'handover_decision',
          enablesDossierAddition: 'add final package handover summary',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const lowerValidation = String(params.validationStatus || '').toLowerCase();
      const lowerDecision = String(params.handoverDecision || '').toLowerCase();
      const blockedByValidation = /block|fail|critical|kritisch|invalid|ungueltig|ungültig|rejected/.test(lowerValidation);
      const blockedByDecision = /block|blocked|rejected|abgelehnt|stop|gesperrt/.test(lowerDecision);
      const status =
        blockedByValidation
          ? 'blocked_by_validation'
          : blockedByDecision
            ? 'blocked_by_handover_decision'
            : !params.dictionaryVersion
              ? 'needs_dictionary'
              : !period
                ? 'needs_period'
                : !params.aggregationLogic
                  ? 'needs_aggregation_logic'
                  : !params.validationStatus
                    ? 'needs_validation'
                    : !params.responsibleOwner || !params.contactRole || !params.sla
                      ? 'needs_owner_sla'
                      : !params.auditReference
                        ? 'needs_audit_reference'
                        : !params.handoverDecision
                          ? 'needs_handover_decision'
                          : missingEvidence.length === 0
                            ? 'ready_for_handover'
                            : 'needs_package_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'energy_tax_information_package',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `ETIP_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['data_dictionary', 'period_definition', 'aggregation_logic', 'validation_status', 'handover_decision'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByValidation) {
        blockingFindings.push({
          code: 'ETIP_VALIDATION_BLOCKING',
          severity: 'high',
          message: 'validation status is explicitly blocking the information-package handover',
        });
      }
      if (blockedByDecision) {
        blockingFindings.push({
          code: 'ETIP_HANDOVER_DECISION_BLOCKING',
          severity: 'high',
          message: 'handover decision is explicitly blocking the information-package handover',
        });
      }
      const packageContext = {
        packageId: params.packageId || null,
        dataSourceId: params.dataSourceId || null,
        dictionaryVersion: params.dictionaryVersion || null,
        period: period || null,
        aggregationLogic: params.aggregationLogic || null,
      };
      const handoverContext = {
        validationStatus: params.validationStatus || null,
        responsibleOwner: params.responsibleOwner || null,
        contactRole: params.contactRole || null,
        sla: params.sla || null,
        auditReference: params.auditReference || null,
        handoverDecision: params.handoverDecision || null,
        evidenceStatus: params.evidenceStatus || null,
        dataQualityStatus: params.dataQualityStatus || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided package evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.packageId) dossierFacts.push(`Package: ${params.packageId}`);
      if (params.dataSourceId) dossierFacts.push(`Source: ${params.dataSourceId}`);
      if (params.dictionaryVersion) dossierFacts.push(`Dictionary: ${params.dictionaryVersion}`);
      if (period) dossierFacts.push(`Period: ${period}`);

      return {
        packageReadinessId: `etip:${Buffer.from(`${params.packageId || ''}:${params.dataSourceId || ''}:${params.dictionaryVersion || ''}:${period || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'energy_tax_information_package',
        safety: 'read_only',
        requestContext: {
          packageId: params.packageId || null,
          dataSourceId: params.dataSourceId || null,
          period: period || null,
        },
        status,
        readinessScore,
        packageContext,
        handoverContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          packageContext,
          handoverContext,
          sourceRefs,
        },
        evidenceRefs: sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.energyTaxInformationPackageStatus'],
          referenced: [
            'datasource-registry.get',
            'datasource-registry.updateDictionary',
            'datasource-classifier.classify',
            'datapoint.health',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence',
            'presentation.generate',
          ],
          notCalled: [
            'tax.calculate',
            'tax.authority.submit',
            'package.release',
            'raw-data.copy',
            'finance-agent.mutate',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'sap.psp.write',
            'hitl.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          packageContext,
          handoverContext,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildInvestmentRiskTranslationStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const evidenceRefs = toList(params.evidenceRefs);
      const forbiddenAssumptions = toList(params.forbiddenAssumptions);
      const evidenceSpecs = [
        {
          id: 'source_identity',
          label: 'Source reference and type',
          value: params.sourceRef && params.sourceType,
          displayValue: [params.sourceRef, params.sourceType].filter(Boolean).join(' / '),
          sourceClass: 'investment_risk_source',
          enablesDossierAddition: 'add the concrete management/risk source and document type',
        },
        {
          id: 'period_division',
          label: 'Period and division',
          value: params.period && params.division,
          displayValue: [params.period, params.division].filter(Boolean).join(' / '),
          sourceClass: 'business_context',
          enablesDossierAddition: 'add the temporal and division context for the handover',
        },
        {
          id: 'classification',
          label: 'Translation classification',
          value: params.classification,
          sourceClass: 'classification',
          enablesDossierAddition: 'add whether the source is report, decision basis, evidence, risk, measure or follow-up task',
        },
        {
          id: 'impact_context',
          label: 'Financial and asset impact',
          value: params.financialImpact || params.assetImpact || params.budgetRef || params.riskRef,
          displayValue: [params.financialImpact, params.assetImpact, params.budgetRef, params.riskRef].filter(Boolean).join(' / '),
          sourceClass: 'impact_context',
          enablesDossierAddition: 'add investment, asset and risk consequence wording',
        },
        {
          id: 'owner_role',
          label: 'Owner role',
          value: params.ownerRole,
          sourceClass: 'owner',
          enablesDossierAddition: 'add accountable handover ownership',
        },
        {
          id: 'decision_readiness',
          label: 'Decision readiness',
          value: params.decisionReadiness,
          sourceClass: 'decision_readiness',
          enablesDossierAddition: 'add decision-readiness and blocked-decision context',
        },
        {
          id: 'blocked_decision',
          label: 'Blocked decision',
          value: params.blockedDecisionId,
          sourceClass: 'decision_chain',
          enablesDossierAddition: 'add the concrete follow-up decision that is blocked or prepared',
        },
        {
          id: 'next_action',
          label: 'Next action',
          value: params.nextAction,
          sourceClass: 'handover_action',
          enablesDossierAddition: 'add operational next-action wording',
        },
        {
          id: 'source_snapshot',
          label: 'Source snapshot',
          value: params.sourceSnapshot,
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add source grounding for the translation status',
        },
        {
          id: 'evidence_refs',
          label: 'Evidence references',
          value: evidenceRefs.length > 0,
          displayValue: evidenceRefs.join(', '),
          sourceClass: 'evidence_refs',
          enablesDossierAddition: 'add citable evidence references to the dossier',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const readinessText = String(params.decisionReadiness || '').toLowerCase();
      const blockedByDecision = /block|blocked|gesperrt|offen|not.ready|not_ready|unready|unklar|unclear/.test(readinessText);
      const status =
        blockedByDecision
          ? 'blocked_for_decision'
          : !params.sourceRef || !params.sourceType
            ? 'needs_source_identity'
            : !params.classification
              ? 'needs_classification'
              : !params.financialImpact && !params.assetImpact && !params.budgetRef && !params.riskRef
                ? 'needs_impact_context'
                : !params.ownerRole
                  ? 'needs_owner_role'
                  : !params.decisionReadiness
                    ? 'needs_decision_readiness'
                    : !params.blockedDecisionId
                      ? 'needs_blocked_decision'
                      : !params.nextAction
                        ? 'needs_next_action'
                        : !params.sourceSnapshot || evidenceRefs.length === 0
                          ? 'needs_source_evidence'
                          : missingEvidence.length === 0
                            ? 'ready_for_handover'
                            : 'needs_translation_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'investment_risk_translation_status',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `IRTS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['source_identity', 'classification', 'decision_readiness', 'blocked_decision'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByDecision) {
        blockingFindings.push({
          code: 'IRTS_DECISION_READINESS_BLOCKING',
          severity: 'high',
          message: 'decision readiness is explicitly blocking the investment/risk handover',
        });
      }
      const translationContext = {
        sourceRef: params.sourceRef || null,
        sourceType: params.sourceType || null,
        period: params.period || null,
        division: params.division || null,
        classification: params.classification || null,
      };
      const handoverContext = {
        financialImpact: params.financialImpact || null,
        assetImpact: params.assetImpact || null,
        budgetRef: params.budgetRef || null,
        riskRef: params.riskRef || null,
        ownerRole: params.ownerRole || null,
        decisionReadiness: params.decisionReadiness || null,
        blockedDecisionId: params.blockedDecisionId || null,
        nextAction: params.nextAction || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided translation evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.sourceRef) dossierFacts.push(`Source: ${params.sourceRef}`);
      if (params.classification) dossierFacts.push(`Classification: ${params.classification}`);
      if (params.ownerRole) dossierFacts.push(`Owner: ${params.ownerRole}`);
      if (params.blockedDecisionId) dossierFacts.push(`Blocked decision: ${params.blockedDecisionId}`);

      return {
        translationStatusId: `irts:${Buffer.from(`${params.sourceRef || ''}:${params.sourceType || ''}:${params.period || ''}:${params.classification || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'investment_risk_translation_status',
        safety: 'read_only',
        requestContext: {
          sourceRef: params.sourceRef || null,
          sourceType: params.sourceType || null,
          period: params.period || null,
          division: params.division || null,
        },
        status,
        readinessScore,
        translationContext,
        handoverContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          translationContext,
          handoverContext,
          sourceSnapshot: params.sourceSnapshot || null,
          evidenceRefs,
          forbiddenAssumptions,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.investmentRiskTranslationStatus'],
          referenced: [
            'vdmi.create',
            'vdmi-evidence.inject',
            'vdmi-findings.list',
            'finance-agent.analyze',
            'investment-planning.createPlan',
            'hitl.create',
            'presentation.generate',
          ],
          notCalled: [
            'vdmi.create',
            'vdmi-evidence.inject',
            'finance-agent.analyze',
            'investment-planning.createPlan',
            'investment-planning.mutate',
            'hitl.create',
            'sap.psp.write',
            'sap.budget.write',
            'finance-agent.mutate',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          translationContext,
          handoverContext,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshot: params.sourceSnapshot || null,
          evidenceRefs,
          forbiddenAssumptions,
          dossierFacts,
        },
      };
    },

    buildBudgetWaterfallGovernanceStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const evidenceRefs = toList(params.evidenceRef);
      const evidenceSpecs = [
        {
          id: 'source_identity',
          label: 'Waterfall/source identity',
          value: params.waterfallId || params.sourceId,
          displayValue: params.waterfallId || params.sourceId,
          sourceClass: 'waterfall_source',
          enablesDossierAddition: 'add the budget-waterfall source identity',
        },
        {
          id: 'period_division',
          label: 'Period and division',
          value: params.period && params.division,
          displayValue: [params.period, params.division].filter(Boolean).join(' / '),
          sourceClass: 'waterfall_scope',
          enablesDossierAddition: 'add the period and division scope for the waterfall claim',
        },
        {
          id: 'baseline_reference',
          label: 'Baseline reference',
          value: params.baselineRef,
          sourceClass: 'baseline',
          enablesDossierAddition: 'explain which approved baseline the waterfall compares against',
        },
        {
          id: 'forecast_cutoff',
          label: 'Forecast cutoff',
          value: params.forecastCutoff,
          sourceClass: 'forecast_cutoff',
          enablesDossierAddition: 'state the forecast end date used for committee-ready budget wording',
        },
        {
          id: 'carryover_logic',
          label: 'Carry-over logic',
          value: params.carryoverLogic,
          sourceClass: 'carryover',
          enablesDossierAddition: 'explain how budget overhangs are carried into the next view',
        },
        {
          id: 'sign_convention',
          label: 'Sign convention',
          value: params.signConvention,
          sourceClass: 'sign_convention',
          enablesDossierAddition: 'explain whether the visible waterfall movement increases or reduces budget headroom',
        },
        {
          id: 'owner_role',
          label: 'Owner role',
          value: params.ownerRole,
          sourceClass: 'governance_owner',
          enablesDossierAddition: 'add the accountable owner for baseline/sign/cutoff validation',
        },
        {
          id: 'approval_status',
          label: 'Approval status',
          value: params.approvalStatus,
          sourceClass: 'committee_approval',
          enablesDossierAddition: 'add committee-readiness wording for the waterfall claim',
        },
        {
          id: 'follow_up_decision',
          label: 'Follow-up decision',
          value: params.followUpDecision,
          sourceClass: 'follow_up_decision',
          enablesDossierAddition: 'name the next management or committee decision enabled by the waterfall',
        },
        {
          id: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add source grounding for the waterfall evidence',
        },
        {
          id: 'evidence_ref',
          label: 'Evidence reference',
          value: evidenceRefs.length > 0,
          displayValue: evidenceRefs.join(', '),
          sourceClass: 'evidence_refs',
          enablesDossierAddition: 'add citable evidence references to the dossier',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const approvalText = String(params.approvalStatus || '').toLowerCase();
      const approvalBlocking = /block|blocked|rejected|abgelehnt|gesperrt|not.approved|not_approved|unklar|unclear/.test(approvalText);
      const status =
        approvalBlocking
          ? 'blocked_by_approval_status'
          : !params.waterfallId && !params.sourceId
            ? 'needs_source_identity'
            : !params.period || !params.division
              ? 'needs_period_division'
              : !params.baselineRef
                ? 'needs_baseline'
                : !params.signConvention
                  ? 'needs_sign_convention'
                  : !params.forecastCutoff
                    ? 'needs_forecast_cutoff'
                    : !params.carryoverLogic
                      ? 'needs_carryover_logic'
                      : !params.ownerRole
                        ? 'needs_owner_role'
                        : !params.approvalStatus
                          ? 'needs_approval'
                          : !params.followUpDecision
                            ? 'needs_follow_up_decision'
                            : !params.sourceSnapshotRef || evidenceRefs.length === 0
                              ? 'needs_source_evidence'
                              : missingEvidence.length === 0
                                ? 'ready_for_committee_review'
                                : 'needs_governance_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'budget_waterfall_governance',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `BWG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['baseline_reference', 'sign_convention', 'forecast_cutoff', 'approval_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (approvalBlocking) {
        blockingFindings.push({
          code: 'BWG_APPROVAL_STATUS_BLOCKING',
          severity: 'high',
          message: 'approval status blocks committee-ready budget-waterfall wording',
        });
      }
      const waterfallContext = {
        waterfallId: params.waterfallId || null,
        sourceId: params.sourceId || null,
        period: params.period || null,
        division: params.division || null,
      };
      const governanceEvidence = {
        baselineRef: params.baselineRef || null,
        forecastCutoff: params.forecastCutoff || null,
        carryoverLogic: params.carryoverLogic || null,
        signConvention: params.signConvention || null,
        ownerRole: params.ownerRole || null,
        approvalStatus: params.approvalStatus || null,
        followUpDecision: params.followUpDecision || null,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided waterfall governance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.waterfallId || params.sourceId) dossierFacts.push(`Waterfall: ${params.waterfallId || params.sourceId}`);
      if (params.baselineRef) dossierFacts.push(`Baseline: ${params.baselineRef}`);
      if (params.signConvention) dossierFacts.push(`Sign convention: ${params.signConvention}`);
      if (params.approvalStatus) dossierFacts.push(`Approval: ${params.approvalStatus}`);

      return {
        governanceStatusId: `bwg:${Buffer.from(`${params.waterfallId || params.sourceId || ''}:${params.period || ''}:${params.division || ''}:${params.baselineRef || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'budget_waterfall_governance',
        safety: 'read_only',
        requestContext: {
          waterfallId: params.waterfallId || null,
          sourceId: params.sourceId || null,
          period: params.period || null,
          division: params.division || null,
        },
        status,
        readinessScore,
        waterfallContext,
        governanceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          waterfallContext,
          governanceEvidence,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.budgetWaterfallGovernanceStatus'],
          referenced: [
            'datasource-registry.get',
            'datapoint.health',
            'investment-planning.createPlan',
            'finance-agent.analyze',
            'vdmi.dossier',
            'presentation.generate',
          ],
          notCalled: [
            'finance-agent.mutate',
            'sap.psp.write',
            'sap.budget.write',
            'investment-planning.createPlan',
            'investment-planning.mutate',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'hitl.create',
            'vdmi.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          waterfallContext,
          governanceEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildGasDecommissioningRoadmapStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const blockers = toList(params.blocker);
      const evidenceRefs = toList(params.evidenceRef);
      const evidenceSpecs = [
        {
          id: 'roadmap_identity',
          label: 'Roadmap identity',
          value: params.roadmapId,
          sourceClass: 'roadmap_source',
          enablesDossierAddition: 'add the gas decommissioning roadmap identity',
        },
        {
          id: 'current_phase',
          label: 'Current phase',
          value: params.currentPhase,
          sourceClass: 'roadmap_phase',
          enablesDossierAddition: 'state the active roadmap phase for dossier wording',
        },
        {
          id: 'owner',
          label: 'Roadmap owner',
          value: params.owner,
          sourceClass: 'governance_owner',
          enablesDossierAddition: 'add accountable ownership for the roadmap decision',
        },
        {
          id: 'asset_risk_evidence',
          label: 'Asset-risk evidence',
          value: params.assetRiskEvidence,
          sourceClass: 'asset_risk',
          enablesDossierAddition: 'add asset-risk basis and risk-assessment phase confidence',
        },
        {
          id: 'dependency_map',
          label: 'Dependency map',
          value: params.dependencyMap,
          sourceClass: 'dependency_map',
          enablesDossierAddition: 'add blocker/dependency status for roadmap sequencing',
        },
        {
          id: 'investment_impact_ref',
          label: 'Investment-impact reference',
          value: params.investmentImpactRef,
          sourceClass: 'investment_impact',
          enablesDossierAddition: 'add finance/investment handover basis',
        },
        {
          id: 'committee_gate_date',
          label: 'Committee gate date',
          value: params.committeeGateDate,
          sourceClass: 'committee_gate',
          enablesDossierAddition: 'add next decision-gate scheduling evidence',
        },
        {
          id: 'execution_handover_owner',
          label: 'Execution handover owner',
          value: params.executionHandoverOwner,
          sourceClass: 'execution_handover',
          enablesDossierAddition: 'add execution handover ownership',
        },
        {
          id: 'next_decision_gate',
          label: 'Next decision gate',
          value: params.nextDecisionGate,
          sourceClass: 'next_gate',
          enablesDossierAddition: 'name the next management gate unlocked by the roadmap',
        },
        {
          id: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add source grounding for the roadmap evidence',
        },
        {
          id: 'evidence_ref',
          label: 'Evidence reference',
          value: evidenceRefs.length > 0,
          displayValue: evidenceRefs.join(', '),
          sourceClass: 'evidence_refs',
          enablesDossierAddition: 'add citable evidence references to the dossier',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const status =
        blockers.length > 0
          ? 'blocked_by_dependencies'
          : !params.roadmapId
            ? 'needs_roadmap_identity'
            : !params.currentPhase
              ? 'needs_current_phase'
              : !params.owner
                ? 'needs_owner'
                : !params.assetRiskEvidence
                  ? 'needs_asset_risk_evidence'
                  : !params.dependencyMap
                    ? 'needs_dependency_map'
                    : !params.investmentImpactRef
                      ? 'needs_investment_impact'
                      : !params.committeeGateDate
                        ? 'needs_committee_gate'
                        : !params.executionHandoverOwner
                          ? 'needs_execution_handover'
                          : !params.nextDecisionGate
                            ? 'needs_next_gate'
                            : !params.sourceSnapshotRef || evidenceRefs.length === 0
                              ? 'needs_source_evidence'
                              : missingEvidence.length === 0
                                ? 'ready_for_committee_gate'
                                : 'needs_roadmap_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'gas_decommissioning_roadmap_status',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `GDR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: [
          'asset_risk_evidence',
          'dependency_map',
          'investment_impact_ref',
          'committee_gate_date',
          'execution_handover_owner',
        ].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockers.length > 0) {
        blockingFindings.push({
          code: 'GDR_DEPENDENCY_BLOCKER_PRESENT',
          severity: 'high',
          message: 'dependency or blocker evidence prevents committee-ready roadmap wording',
        });
      }
      const roadmapContext = {
        roadmapId: params.roadmapId || null,
        currentPhase: params.currentPhase || null,
        owner: params.owner || null,
      };
      const phaseEvidence = {
        assetRiskEvidence: params.assetRiskEvidence || null,
        investmentImpactRef: params.investmentImpactRef || null,
        committeeGateDate: params.committeeGateDate || null,
        executionHandoverOwner: params.executionHandoverOwner || null,
        nextDecisionGate: params.nextDecisionGate || null,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
      };
      const dependencies = {
        dependencyMap: params.dependencyMap || null,
        blockers,
      };
      const phases = [
        { id: 'intake', label: 'Intake', evidenceStatus: params.roadmapId && params.owner ? 'provided' : 'missing' },
        { id: 'risk-assessment', label: 'Risk assessment', evidenceStatus: params.assetRiskEvidence ? 'provided' : 'missing' },
        { id: 'investment-impact', label: 'Investment impact', evidenceStatus: params.investmentImpactRef ? 'provided' : 'missing' },
        { id: 'committee-gate', label: 'Committee gate', evidenceStatus: params.committeeGateDate ? 'provided' : 'missing' },
        { id: 'execution-handover', label: 'Execution handover', evidenceStatus: params.executionHandoverOwner ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided gas roadmap evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.roadmapId) dossierFacts.push(`Roadmap: ${params.roadmapId}`);
      if (params.currentPhase) dossierFacts.push(`Current phase: ${params.currentPhase}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
      if (params.nextDecisionGate) dossierFacts.push(`Next gate: ${params.nextDecisionGate}`);

      return {
        roadmapStatusId: `gdr:${Buffer.from(`${params.roadmapId || ''}:${params.currentPhase || ''}:${params.owner || ''}:${params.committeeGateDate || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'gas_decommissioning_roadmap_status',
        safety: 'read_only',
        requestContext: {
          roadmapId: params.roadmapId || null,
          currentPhase: params.currentPhase || null,
          owner: params.owner || null,
        },
        status,
        readinessScore,
        roadmapContext,
        phases,
        phaseEvidence,
        dependencies,
        blockers,
        nextDecisionGate: params.nextDecisionGate || null,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          roadmapContext,
          phaseEvidence,
          dependencies,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.gasDecommissioningRoadmapStatus'],
          referenced: [
            'vdmi.dossier',
            'vdmi-evidence.inject',
            'investment-planning.createPlan',
            'finance-agent.analyze',
            'hitl.create',
            'presentation.generate',
          ],
          notCalled: [
            'gas-transformation.createRoadmap',
            'gas-transformation.executeDecommissioning',
            'customer-communication.dispatch',
            'regulatory-assertion.create',
            'finance-agent.mutate',
            'sap.psp.write',
            'sap.budget.write',
            'investment-planning.createPlan',
            'investment-planning.mutate',
            'hitl.create',
            'vdmi.create',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          roadmapContext,
          phases,
          phaseEvidence,
          dependencies,
          blockers,
          nextDecisionGate: params.nextDecisionGate || null,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildJourFixeDecisionClosureStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const evidenceRefs = toList(params.evidenceRef);
      const closureStatus = String(params.closureStatus || '').toLowerCase().replace(/\s+/g, '_');
      const isClosedStatus = ['done', 'decided', 'closed', 'erledigt', 'entschieden'].includes(closureStatus);
      const isEscalated = ['escalated', 'eskaliert'].includes(closureStatus);
      const isCarriedOver = ['carried_over', 'carried-over', 'uebertragen', 'übertragen', 'weitergetragen'].includes(closureStatus);
      const evidenceSpecs = [
        {
          id: 'topic_identity',
          label: 'Topic identity',
          value: params.topicId || params.topicTitle,
          displayValue: params.topicId || params.topicTitle,
          sourceClass: 'topic_identity',
          enablesDossierAddition: 'add the Jour-fixe topic identity and title',
        },
        {
          id: 'jour_fixe_context',
          label: 'Jour-fixe context',
          value: params.jourFixeId,
          sourceClass: 'jour_fixe_context',
          enablesDossierAddition: 'add the recurring Jour-fixe context for this topic',
        },
        {
          id: 'topic_owner',
          label: 'Topic owner',
          value: params.owner,
          sourceClass: 'governance_owner',
          enablesDossierAddition: 'add owner accountability and escalation path',
        },
        {
          id: 'kpi',
          label: 'KPI',
          value: params.kpi,
          sourceClass: 'closure_kpi',
          enablesDossierAddition: 'add KPI-based closure criterion',
        },
        {
          id: 'decision_criterion',
          label: 'Decision criterion',
          value: params.decisionCriterion,
          sourceClass: 'decision_criterion',
          enablesDossierAddition: 'state what decision unlocks closure',
        },
        {
          id: 'next_gate',
          label: 'Next gate',
          value: params.nextGate,
          sourceClass: 'next_gate',
          enablesDossierAddition: 'include the next Jour-fixe or committee gate',
        },
        {
          id: 'closure_status',
          label: 'Closure status',
          value: params.closureStatus,
          sourceClass: 'closure_status',
          enablesDossierAddition: 'add the open/decided/escalated/done/carried-over state',
        },
        {
          id: 'closure_proof',
          label: 'Closure proof',
          value: params.closureProof,
          sourceClass: 'closure_proof',
          enablesDossierAddition: 'mark the topic as done with evidence',
        },
        {
          id: 'blocked_follow_up_action',
          label: 'Blocked follow-up action',
          value: params.blockedFollowUpAction,
          sourceClass: 'blocked_follow_up',
          enablesDossierAddition: 'state the blocked management action and required unblocker',
          optional: true,
        },
        {
          id: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add source grounding for the Jour-fixe evidence',
        },
        {
          id: 'evidence_ref',
          label: 'Evidence reference',
          value: evidenceRefs.length > 0,
          displayValue: evidenceRefs.join(', '),
          sourceClass: 'evidence_refs',
          enablesDossierAddition: 'add citable evidence references to the dossier',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value && !spec.optional)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const status =
        !params.topicId && !params.topicTitle
          ? 'open'
          : !params.owner
            ? 'needs_owner'
            : !params.kpi
              ? 'needs_kpi'
              : !params.decisionCriterion
                ? 'needs_decision_criterion'
                : !params.nextGate
                  ? 'needs_next_gate'
                  : isEscalated
                    ? 'escalated'
                    : isCarriedOver
                      ? 'carried_over'
                      : isClosedStatus && params.closureProof
                        ? (closureStatus === 'decided' || closureStatus === 'entschieden' ? 'decided' : 'done')
                        : isClosedStatus && !params.closureProof
                          ? 'needs_closure_proof'
                          : params.blockedFollowUpAction
                            ? 'escalated'
                            : params.closureStatus
                              ? 'decided'
                              : 'open';
      const requiredEvidenceSpecs = evidenceSpecs.filter((spec) => !spec.optional);
      const requiredEvidenceItems = evidenceItems.filter((item) => {
        const spec = evidenceSpecs.find((candidate) => candidate.id === item.id);
        return !spec?.optional;
      });
      const readinessScore = Number((requiredEvidenceItems.length / requiredEvidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'jour_fixe_decision_closure_tracker',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `JFD_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['topic_owner', 'kpi', 'decision_criterion', 'next_gate', 'closure_status', 'closure_proof'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (params.blockedFollowUpAction) {
        blockingFindings.push({
          code: 'JFD_BLOCKED_FOLLOW_UP_ACTION',
          severity: 'high',
          message: 'blocked follow-up action prevents silent topic closure',
        });
      }
      const topic = {
        topicId: params.topicId || null,
        topicTitle: params.topicTitle || null,
        jourFixeId: params.jourFixeId || null,
      };
      const closureEvidence = {
        owner: params.owner || null,
        kpi: params.kpi || null,
        decisionCriterion: params.decisionCriterion || null,
        nextGate: params.nextGate || null,
        closureStatus: params.closureStatus || null,
        closureProof: params.closureProof || null,
        blockedFollowUpAction: params.blockedFollowUpAction || null,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
      };
      const closureSteps = [
        { id: 'topic-intake', label: 'Topic intake', evidenceStatus: params.topicId || params.topicTitle ? 'provided' : 'missing' },
        { id: 'owner-kpi-check', label: 'Owner and KPI check', evidenceStatus: params.owner && params.kpi ? 'provided' : 'missing' },
        { id: 'decision-criterion-gate', label: 'Decision criterion gate', evidenceStatus: params.decisionCriterion ? 'provided' : 'missing' },
        { id: 'closure-or-escalation', label: 'Closure or escalation', evidenceStatus: params.closureStatus ? 'provided' : 'missing' },
        { id: 'next-jf-handover', label: 'Next Jour-fixe handover', evidenceStatus: params.nextGate ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided Jour-fixe closure evidence: ${requiredEvidenceItems.length}/${requiredEvidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.topicId || params.topicTitle) dossierFacts.push(`Topic: ${params.topicId || params.topicTitle}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
      if (params.kpi) dossierFacts.push(`KPI: ${params.kpi}`);
      if (params.nextGate) dossierFacts.push(`Next gate: ${params.nextGate}`);

      return {
        closureStatusId: `jfd:${Buffer.from(`${params.topicId || params.topicTitle || ''}:${params.jourFixeId || ''}:${params.owner || ''}:${params.nextGate || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'jour_fixe_decision_closure_tracker',
        safety: 'read_only',
        requestContext: {
          topicId: params.topicId || null,
          topicTitle: params.topicTitle || null,
          jourFixeId: params.jourFixeId || null,
        },
        status,
        readinessScore,
        topic,
        closureEvidence,
        closureSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          topic,
          closureEvidence,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.jourFixeDecisionClosureStatus'],
          referenced: [
            'vdmi.dossier',
            'nova.list',
            'hitl.create',
            'vdmi-evidence.inject',
            'presentation.generate',
          ],
          notCalled: [
            'meeting-transcription.ingest',
            'calendar.connector.read',
            'email.connector.read',
            'teams.connector.read',
            'vdmi.create',
            'vdmi.update',
            'nova.createDecision',
            'nova.approve',
            'hitl.create',
            'hitl.resolve',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          topic,
          closureEvidence,
          closureSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildOffBalancingMeteringPruefmatrixStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const evidenceRefs = toList(params.evidenceRef);
      const regulatoryEffectEvidence = params.regulatoryEffectEvidence || params.eogEffectEvidence;
      const evidenceSpecs = [
        {
          id: 'metering_scope',
          label: 'Metering scope',
          value: params.meteringScope,
          sourceClass: 'metering_scope',
          enablesDossierAddition: 'add the metering scope and affected meter portfolio',
        },
        {
          id: 'financing_model',
          label: 'Financing model',
          value: params.financingModel,
          sourceClass: 'financing_model',
          enablesDossierAddition: 'add the off-balancing financing model under review',
        },
        {
          id: 'decision_owner',
          label: 'Decision owner',
          value: params.decisionOwner,
          sourceClass: 'governance_owner',
          enablesDossierAddition: 'add accountable Finance/Regulation/Grid decision ownership',
        },
        {
          id: 'committee_gate',
          label: 'Committee gate',
          value: params.committeeGate,
          sourceClass: 'committee_gate',
          enablesDossierAddition: 'add the management or committee gate for the option',
        },
        {
          id: 'capex_opex_baseline',
          label: 'CAPEX/OPEX baseline',
          value: params.capexOpexBaseline,
          sourceClass: 'capex_opex_baseline',
          enablesDossierAddition: 'compare the option against the approved CAPEX/OPEX baseline',
        },
        {
          id: 'eog_regulatory_effect',
          label: 'EOG/regulatory-effect evidence',
          value: regulatoryEffectEvidence,
          sourceClass: 'regulatory_effect',
          enablesDossierAddition: 'add regulatory or EOG-effect plausibility for the option',
        },
        {
          id: 'cost_recognition_assumption',
          label: 'Cost-recognition assumption',
          value: params.costRecognitionAssumption,
          sourceClass: 'cost_recognition',
          enablesDossierAddition: 'add a recognition-bound decision guard without claiming legal authority',
        },
        {
          id: 'financier_conditions',
          label: 'Financier conditions',
          value: params.financierConditions,
          sourceClass: 'financier_terms',
          enablesDossierAddition: 'add financier-bound risk, covenant and exit-condition assessment',
        },
        {
          id: 'data_quality_status',
          label: 'Data-quality status',
          value: params.dataQualityStatus,
          sourceClass: 'data_quality',
          enablesDossierAddition: 'add metering-data reliability status for decision wording',
        },
        {
          id: 'interface_risk_status',
          label: 'Interface-risk status',
          value: params.interfaceRiskStatus,
          sourceClass: 'interface_risk',
          enablesDossierAddition: 'add integration-risk guard for billing, MaKo and data interfaces',
        },
        {
          id: 'grid_investment_space_proof',
          label: 'Usable grid-investment headroom proof',
          value: params.gridInvestmentSpaceProof,
          sourceClass: 'grid_investment_space',
          enablesDossierAddition: 'add the verdict whether budget relief creates usable electricity-grid investment headroom',
        },
        {
          id: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add source grounding for the pruefmatrix evidence',
        },
        {
          id: 'evidence_ref',
          label: 'Evidence reference',
          value: evidenceRefs.length > 0,
          displayValue: evidenceRefs.join(', '),
          sourceClass: 'evidence_refs',
          enablesDossierAddition: 'add citable evidence references to the dossier',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const gridProofText = String(params.gridInvestmentSpaceProof || '').toLowerCase();
      const apparentReliefUnproven =
        !!params.financingModel &&
        !params.gridInvestmentSpaceProof;
      const gridProofBlocking =
        /not usable|not_usable|kein nutzbarer|scheininvest|scheinspielraum|unproven|ungeklaert|unklar|blocked/.test(gridProofText);
      const status =
        !params.meteringScope
          ? 'needs_metering_scope'
          : !params.financingModel
            ? 'needs_financing_model'
            : !params.financierConditions
              ? 'needs_financier_terms'
              : !regulatoryEffectEvidence
                ? 'needs_regulatory_effect'
                : !params.costRecognitionAssumption
                  ? 'needs_cost_recognition'
                  : !params.capexOpexBaseline
                    ? 'needs_capex_opex_baseline'
                    : !params.dataQualityStatus
                      ? 'needs_data_quality'
                      : !params.interfaceRiskStatus
                        ? 'needs_interface_risk'
                        : !params.gridInvestmentSpaceProof
                          ? 'needs_grid_investment_proof'
                          : gridProofBlocking
                            ? 'apparent_relief_not_decision_ready'
                            : !params.decisionOwner
                              ? 'needs_decision_owner'
                              : !params.committeeGate
                                ? 'needs_committee_gate'
                                : !params.sourceSnapshotRef || evidenceRefs.length === 0
                                  ? 'needs_source_evidence'
                                  : missingEvidence.length === 0
                                    ? 'ready_for_committee_review'
                                    : 'needs_pruefmatrix_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'off_balancing_metering_pruefmatrix',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `OBM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: [
          'financier_conditions',
          'eog_regulatory_effect',
          'cost_recognition_assumption',
          'grid_investment_space_proof',
          'capex_opex_baseline',
        ].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (apparentReliefUnproven) {
        blockingFindings.push({
          code: 'OBM_APPARENT_RELIEF_UNPROVEN',
          severity: 'high',
          message: 'claimed budget relief is not decision-ready until usable grid-investment headroom is proven',
        });
      }
      if (gridProofBlocking) {
        blockingFindings.push({
          code: 'OBM_GRID_INVESTMENT_SPACE_BLOCKING',
          severity: 'high',
          message: 'provided grid-investment-space evidence marks the option as not usable or unresolved',
        });
      }
      const matrixContext = {
        matrixId: params.matrixId || null,
        meteringScope: params.meteringScope || null,
        financingModel: params.financingModel || null,
        decisionOwner: params.decisionOwner || null,
        committeeGate: params.committeeGate || null,
      };
      const financingEvidence = {
        capexOpexBaseline: params.capexOpexBaseline || null,
        regulatoryEffectEvidence: regulatoryEffectEvidence || null,
        costRecognitionAssumption: params.costRecognitionAssumption || null,
        financierConditions: params.financierConditions || null,
      };
      const operationalEvidence = {
        dataQualityStatus: params.dataQualityStatus || null,
        interfaceRiskStatus: params.interfaceRiskStatus || null,
        sourceSnapshotRef: params.sourceSnapshotRef || null,
      };
      const gridInvestmentVerdict = {
        gridInvestmentSpaceProof: params.gridInvestmentSpaceProof || null,
        apparentBudgetRelief: !!params.financingModel,
        usableGridInvestmentHeadroomProven: !!params.gridInvestmentSpaceProof && !gridProofBlocking,
        apparentReliefUnproven,
      };
      const matrixSteps = [
        { id: 'scope-and-model', label: 'Scope and model', evidenceStatus: params.meteringScope && params.financingModel ? 'provided' : 'missing' },
        { id: 'finance-regulation', label: 'Finance and regulation', evidenceStatus: params.capexOpexBaseline && regulatoryEffectEvidence && params.costRecognitionAssumption && params.financierConditions ? 'provided' : 'missing' },
        { id: 'data-interface-risk', label: 'Data and interface risk', evidenceStatus: params.dataQualityStatus && params.interfaceRiskStatus ? 'provided' : 'missing' },
        { id: 'grid-headroom-verdict', label: 'Grid headroom verdict', evidenceStatus: params.gridInvestmentSpaceProof ? 'provided' : 'missing' },
        { id: 'committee-readiness', label: 'Committee readiness', evidenceStatus: params.decisionOwner && params.committeeGate ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided off-balancing metering evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.matrixId) dossierFacts.push(`Matrix: ${params.matrixId}`);
      if (params.meteringScope) dossierFacts.push(`Metering scope: ${params.meteringScope}`);
      if (params.financingModel) dossierFacts.push(`Financing model: ${params.financingModel}`);
      if (params.gridInvestmentSpaceProof) dossierFacts.push(`Grid headroom proof: ${params.gridInvestmentSpaceProof}`);

      return {
        pruefmatrixStatusId: `obm:${Buffer.from(`${params.matrixId || ''}:${params.meteringScope || ''}:${params.financingModel || ''}:${params.gridInvestmentSpaceProof || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'off_balancing_metering_pruefmatrix',
        safety: 'read_only',
        requestContext: {
          matrixId: params.matrixId || null,
          meteringScope: params.meteringScope || null,
          financingModel: params.financingModel || null,
        },
        status,
        readinessScore,
        matrixContext,
        financingEvidence,
        operationalEvidence,
        gridInvestmentVerdict,
        matrixSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          matrixContext,
          financingEvidence,
          operationalEvidence,
          gridInvestmentVerdict,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.offBalancingMeteringPruefmatrixStatus'],
          referenced: [
            'finance-agent.analyze',
            'investment-planning.createPlan',
            'eog-calculator.scenario',
            'datapoint.health',
            'datasource-registry.get',
            'vdmi.dossier',
            'presentation.generate',
          ],
          notCalled: [
            'finance-agent.mutate',
            'sap.psp.write',
            'sap.budget.write',
            'investment-planning.createPlan',
            'investment-planning.mutate',
            'settlement.exportA96',
            'settlement.prepareBilling',
            'billing.release',
            'mako.dispatch',
            'hitl.create',
            'vdmi.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          matrixContext,
          financingEvidence,
          operationalEvidence,
          gridInvestmentVerdict,
          matrixSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildAutomationRequirementsDecisionValueStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean)
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const evidenceRefs = toList(params.evidenceRef);
      const evidenceSpecs = [
        {
          key: 'request_identity',
          label: 'Requirement identity',
          value: params.requirementId || params.requestTitle,
          missingDataPoint: 'request_identity',
          enablesDossierAddition: 'Anforderungstitel und Karten-ID koennen als pruefbares Steuerungsobjekt referenziert werden',
        },
        {
          key: 'request_type',
          label: 'Request type',
          value: params.requestType,
          missingDataPoint: 'request_type',
          enablesDossierAddition: 'Der Toolwunsch kann als Dashboard-, Workflow-, Report- oder Automatisierungsanforderung klassifiziert werden',
        },
        {
          key: 'process_area',
          label: 'Process area',
          value: params.processArea,
          missingDataPoint: 'process_area',
          enablesDossierAddition: 'Der betroffene VNB-/EVU-Prozess kann im Dossier eingegrenzt werden',
        },
        {
          key: 'decision_owner',
          label: 'Decision owner',
          value: params.decisionOwner,
          missingDataPoint: 'decision_owner',
          enablesDossierAddition: 'Der fachliche Owner fuer Wertentscheidung und Nachhaltung kann benannt werden',
        },
        {
          key: 'target_gate',
          label: 'Target gate',
          value: params.targetGate,
          missingDataPoint: 'target_gate',
          enablesDossierAddition: 'Das naechste Entscheidungs- oder Review-Gate kann im Dossier sichtbar werden',
        },
        {
          key: 'source_system',
          label: 'Source system',
          value: params.sourceSystem,
          missingDataPoint: 'source_system',
          enablesDossierAddition: 'Quellsystem-Provenienz und Datenverantwortung koennen belegt werden',
        },
        {
          key: 'moving_data_flow',
          label: 'Moving data flow',
          value: params.movingDataFlow,
          missingDataPoint: 'moving_data_flow',
          enablesDossierAddition: 'Betroffener Datenfluss und Schnittstellenwirkung koennen beschrieben werden',
        },
        {
          key: 'manual_effort',
          label: 'Manual effort',
          value: params.manualEffort,
          missingDataPoint: 'manual_effort',
          enablesDossierAddition: 'Manueller Aufwand kann als Baseline fuer Nutzenbewertung ergaenzt werden',
        },
        {
          key: 'control_point',
          label: 'Control point',
          value: params.controlPoint,
          missingDataPoint: 'control_point',
          enablesDossierAddition: 'Der verbesserte operative Kontrollpunkt kann entscheidungsfaehig benannt werden',
        },
        {
          key: 'decision_value',
          label: 'Decision value',
          value: params.decisionValue,
          missingDataPoint: 'decision_value',
          enablesDossierAddition: 'Die durch Automation besser moegliche Fachentscheidung kann im Dossier ausgewiesen werden',
        },
        {
          key: 'follow_up_process',
          label: 'Follow-up process',
          value: params.followUpProcess,
          missingDataPoint: 'follow_up_process',
          enablesDossierAddition: 'Der nachgelagerte Prozess oder Handover kann als Wirkung der Anforderung ergaenzt werden',
        },
        {
          key: 'data_quality',
          label: 'Data quality',
          value: params.dataQuality,
          missingDataPoint: 'data_quality',
          enablesDossierAddition: 'Datenqualitaet, Confidence und bekannte Grenzen koennen bewertet werden',
        },
        {
          key: 'rollback_or_stop_criterion',
          label: 'Rollback or stop criterion',
          value: params.rollbackOrStopCriterion,
          missingDataPoint: 'rollback_or_stop_criterion',
          enablesDossierAddition: 'Ein Stop-/Rollback-Kriterium kann nicht hilfreiche Automation begrenzen',
        },
        {
          key: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          missingDataPoint: 'source_snapshot_ref',
          enablesDossierAddition: 'Ein zitierbarer Snapshot kann als Grundlage der Requirements Card referenziert werden',
        },
        {
          key: 'evidence_ref',
          label: 'Evidence references',
          value: evidenceRefs.length > 0 ? evidenceRefs.join(', ') : null,
          missingDataPoint: 'evidence_ref',
          enablesDossierAddition: 'Evidenzreferenzen koennen die Requirements Card auditierbar machen',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'automation_requirements_decision_value',
          severity: ['decision_value', 'follow_up_process', 'control_point'].includes(spec.key) ? 'high' : 'medium',
        }));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      let status = 'ready_for_requirements_review';
      if (!params.sourceSystem) status = 'needs_source_system';
      else if (!params.movingDataFlow) status = 'needs_moving_data_flow';
      else if (!params.controlPoint) status = 'needs_control_point';
      else if (!params.decisionValue) status = 'needs_decision_value';
      else if (!params.followUpProcess) status = 'needs_follow_up_process';
      else if (!params.dataQuality) status = 'needs_data_quality';
      else if (!params.rollbackOrStopCriterion) status = 'needs_rollback_or_stop_criterion';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const toolWishWithoutDecisionValue =
        !!params.requestType &&
        /powerbi|power bi|power-?automate|dashboard|workflow|office|report|automation/i.test(params.requestType) &&
        (!params.decisionValue || !params.followUpProcess);
      const blockingFindings = [];
      if (toolWishWithoutDecisionValue) {
        blockingFindings.push({
          code: 'ARDV_TOOL_WISH_WITHOUT_DECISION_VALUE',
          severity: 'high',
          message: 'automation or dashboard wish is not decision-ready without decision value and follow-up process',
        });
      }
      const requirementContext = {
        requirementId: params.requirementId || null,
        requestTitle: params.requestTitle || null,
        requestType: params.requestType || null,
        processArea: params.processArea || null,
        decisionOwner: params.decisionOwner || null,
        targetGate: params.targetGate || null,
      };
      const decisionEvidence = {
        sourceSystem: params.sourceSystem || null,
        movingDataFlow: params.movingDataFlow || null,
        manualEffort: params.manualEffort || null,
        controlPoint: params.controlPoint || null,
        decisionValue: params.decisionValue || null,
        followUpProcess: params.followUpProcess || null,
        dataQuality: params.dataQuality || null,
        rollbackOrStopCriterion: params.rollbackOrStopCriterion || null,
      };
      const decisionSteps = [
        { id: 'identity-and-owner', label: 'Identity and owner', evidenceStatus: (params.requirementId || params.requestTitle) && params.decisionOwner ? 'provided' : 'missing' },
        { id: 'data-flow', label: 'Source system and moving data flow', evidenceStatus: params.sourceSystem && params.movingDataFlow ? 'provided' : 'missing' },
        { id: 'value-control', label: 'Decision value and control point', evidenceStatus: params.decisionValue && params.controlPoint ? 'provided' : 'missing' },
        { id: 'process-handover', label: 'Follow-up and target gate', evidenceStatus: params.followUpProcess && params.targetGate ? 'provided' : 'missing' },
        { id: 'quality-and-stop', label: 'Data quality and rollback guard', evidenceStatus: params.dataQuality && params.rollbackOrStopCriterion ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided automation requirement evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.requirementId) dossierFacts.push(`Requirement: ${params.requirementId}`);
      if (params.requestType) dossierFacts.push(`Request type: ${params.requestType}`);
      if (params.decisionValue) dossierFacts.push(`Decision value: ${params.decisionValue}`);
      if (params.followUpProcess) dossierFacts.push(`Follow-up process: ${params.followUpProcess}`);

      return {
        decisionValueStatusId: `ardv:${Buffer.from(`${params.requirementId || ''}:${params.requestTitle || ''}:${params.decisionValue || ''}:${params.followUpProcess || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'automation_requirements_decision_value',
        safety: 'read_only',
        requestContext: {
          requirementId: params.requirementId || null,
          requestTitle: params.requestTitle || null,
          requestType: params.requestType || null,
        },
        status,
        readinessScore,
        requirementContext,
        decisionEvidence,
        decisionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          requirementContext,
          decisionEvidence,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.automationRequirementsDecisionValueStatus'],
          referenced: [
            'vdmi.dossier',
            'business-intelligence.describe',
            'datapoint.health',
            'datasource-registry.get',
            'presentation.generate',
          ],
          notCalled: [
            'powerbi.createDashboard',
            'power-automate.createFlow',
            'office.connector.call',
            'mail.send',
            'teams.postMessage',
            'loop.update',
            'workflow.create',
            'ticket.create',
            'hitl.create',
            'vdmi.create',
            'vdmi.update',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          requirementContext,
          decisionEvidence,
          decisionSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildSmartMeterOffBalancingPurposeLockStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean)
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const toAmount = (value) => {
        if (value == null || value === '') return null;
        const normalized = Number(String(value).replace(/[^\d.-]/g, ''));
        return Number.isFinite(normalized) ? normalized : String(value);
      };
      const purposeLockedMeasures = toList(params.purposeLockedMeasures);
      const controlRoomInvestments = toList(params.controlRoomInvestments);
      const processInvestments = toList(params.processInvestments);
      const gridInfrastructureInvestments = toList(params.gridInfrastructureInvestments);
      const evidenceRefs = toList(params.evidenceRef);
      const offBalanceVolumeEur = toAmount(params.offBalanceVolumeEur);
      const freedLiquidityEur = toAmount(params.freedLiquidityEur);
      const financierCostEur = toAmount(params.financierCostEur);
      const investmentEffectEvidence =
        controlRoomInvestments.length + processInvestments.length + gridInfrastructureInvestments.length;
      const evidenceSpecs = [
        {
          key: 'asset_scope',
          label: 'Asset scope',
          value: params.assetScope,
          missingDataPoint: 'asset_scope',
          enablesDossierAddition: 'Smart-Meter-Assetumfang und betroffene Netz-/Messlokationen koennen abgegrenzt werden',
        },
        {
          key: 'financing_model',
          label: 'Financing model',
          value: params.financingModel,
          missingDataPoint: 'financing_model',
          enablesDossierAddition: 'Das Off-Balancing-/Finanzierungsmodell kann als Entscheidungsgrundlage sichtbar werden',
        },
        {
          key: 'off_balance_volume_eur',
          label: 'Off-balance volume',
          value: offBalanceVolumeEur,
          missingDataPoint: 'off_balance_volume_eur',
          enablesDossierAddition: 'Das auszulagernde Smart-Meter-Assetvolumen kann beziffert werden',
        },
        {
          key: 'freed_liquidity_eur',
          label: 'Freed liquidity',
          value: freedLiquidityEur,
          missingDataPoint: 'freed_liquidity_eur',
          enablesDossierAddition: 'Freiwerdende Liquiditaet kann von reiner Bilanzoptik getrennt werden',
        },
        {
          key: 'financier_cost_eur',
          label: 'Financier cost',
          value: financierCostEur,
          missingDataPoint: 'financier_cost_eur',
          enablesDossierAddition: 'Finanzierer-Kosten koennen gegen den operativen Netzsteuerungsnutzen gestellt werden',
        },
        {
          key: 'capex_opex_totex_effect',
          label: 'CAPEX/OPEX/TOTEX effect',
          value: params.capexOpexTotexEffect,
          missingDataPoint: 'capex_opex_totex_effect',
          enablesDossierAddition: 'CAPEX-/OPEX-/TOTEX-Wirkung kann separat ausgewiesen werden',
        },
        {
          key: 'regulatory_recognition_status',
          label: 'Regulatory recognition',
          value: params.regulatoryRecognitionStatus,
          missingDataPoint: 'regulatory_recognition_status',
          enablesDossierAddition: 'Regulatorische Anerkennung oder Unsicherheit kann ohne Authority-Claim markiert werden',
        },
        {
          key: 'purpose_locked_measures',
          label: 'Purpose-locked measures',
          value: purposeLockedMeasures.length > 0 ? purposeLockedMeasures.join(', ') : null,
          missingDataPoint: 'purpose_lock_measures_missing',
          enablesDossierAddition: 'Zweckgebundene Steuerbarkeits-, Leitwarten-, Prozess- oder Infrastrukturmassnahmen koennen belegt werden',
        },
        {
          key: 'investment_effect',
          label: 'Operational investment effect',
          value: investmentEffectEvidence > 0,
          missingDataPoint: 'investment_effect_missing',
          enablesDossierAddition: 'Der nutzbare operative Investitionseffekt kann mit Leitwarte, Prozess und Infrastruktur verknuepft werden',
        },
        {
          key: 'budget_dilution_risk',
          label: 'Budget dilution risk',
          value: params.budgetDilutionRisk,
          missingDataPoint: 'budget_dilution_risk_open',
          enablesDossierAddition: 'Risiko einer Budgetverwaesserung kann als Guard gegen Scheinnutzen ausgewiesen werden',
        },
        {
          key: 'finance_review_status',
          label: 'Finance review status',
          value: params.financeReviewStatus,
          missingDataPoint: 'finance_review_missing',
          enablesDossierAddition: 'Gremien- oder Finance-Review-Status kann committee-ready sichtbar werden',
        },
        {
          key: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          missingDataPoint: 'source_snapshot_ref',
          enablesDossierAddition: 'Ein zitierbarer Snapshot kann die Purpose-Lock-Bewertung auditierbar machen',
        },
        {
          key: 'evidence_ref',
          label: 'Evidence references',
          value: evidenceRefs.length > 0 ? evidenceRefs.join(', ') : null,
          missingDataPoint: 'evidence_ref',
          enablesDossierAddition: 'Evidenzreferenzen koennen die Purpose-Lock-Matrix absichern',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'smart_meter_off_balancing_purpose_lock',
          severity: ['purpose_lock_measures_missing', 'investment_effect_missing', 'budget_dilution_risk_open', 'finance_review_missing'].includes(spec.missingDataPoint) ? 'high' : 'medium',
        }));
      const dilutionText = String(params.budgetDilutionRisk || '').toLowerCase();
      const dilutionBlocking = /high|hoch|open|offen|unresolved|ungeloest|budgetverwaesser|dilution/.test(dilutionText) &&
        !/low|niedrig|resolved|geschlossen|protected|locked|none|kein/.test(dilutionText);
      let status = 'ready_for_committee_review';
      if (!params.assetScope) status = 'needs_asset_scope';
      else if (!params.financingModel) status = 'needs_financing_model';
      else if (!freedLiquidityEur || !offBalanceVolumeEur) status = 'needs_liquidity_evidence';
      else if (purposeLockedMeasures.length === 0) status = 'needs_purpose_lock';
      else if (!params.regulatoryRecognitionStatus) status = 'needs_regulatory_evidence';
      else if (!params.financeReviewStatus) status = 'needs_finance_review';
      else if (dilutionBlocking) status = 'budget_dilution_risk';
      else if (investmentEffectEvidence === 0) status = 'needs_investment_effect';
      else if (!params.capexOpexTotexEffect || !financierCostEur) status = 'needs_finance_effect_evidence';
      else if (!params.sourceSnapshotRef || evidenceRefs.length === 0) status = 'needs_source_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `SMOPL_${String(item.missingDataPoint).toUpperCase()}`,
        severity: item.severity,
        message: item.enablesDossierAddition,
      }));
      if (dilutionBlocking) {
        blockingFindings.push({
          code: 'SMOPL_BUDGET_DILUTION_RISK',
          severity: 'high',
          message: 'freed liquidity is not committee-ready while budget dilution risk remains open',
        });
      }
      const purposeLockContext = {
        caseId: params.caseId || null,
        gridOperatorId: params.gridOperatorId || null,
        assetScope: params.assetScope || null,
        financingModel: params.financingModel || null,
      };
      const financeSummary = {
        offBalanceVolumeEur,
        freedLiquidityEur,
        financierCostEur,
        capexOpexTotexEffect: params.capexOpexTotexEffect || null,
        regulatoryRecognitionStatus: params.regulatoryRecognitionStatus || null,
        financeReviewStatus: params.financeReviewStatus || null,
      };
      const purposeLockCoverage = {
        purposeLockedMeasures,
        controlRoomInvestments,
        processInvestments,
        gridInfrastructureInvestments,
        purposeLockEvidenced: purposeLockedMeasures.length > 0,
        operationalInvestmentEffectEvidenced: investmentEffectEvidence > 0,
      };
      const investmentEffect = {
        controlRoomInvestments,
        processInvestments,
        gridInfrastructureInvestments,
        usableOperationalInvestmentEffect: investmentEffectEvidence > 0,
      };
      const purposeLockSteps = [
        { id: 'scope-and-model', label: 'Asset scope and financing model', evidenceStatus: params.assetScope && params.financingModel ? 'provided' : 'missing' },
        { id: 'liquidity-and-cost', label: 'Freed liquidity and financier cost', evidenceStatus: offBalanceVolumeEur && freedLiquidityEur && financierCostEur ? 'provided' : 'missing' },
        { id: 'purpose-lock', label: 'Purpose-locked measures', evidenceStatus: purposeLockedMeasures.length > 0 ? 'provided' : 'missing' },
        { id: 'investment-effect', label: 'Operational investment effect', evidenceStatus: investmentEffectEvidence > 0 ? 'provided' : 'missing' },
        { id: 'regulatory-finance-review', label: 'Regulatory and finance review', evidenceStatus: params.regulatoryRecognitionStatus && params.financeReviewStatus ? 'provided' : 'missing' },
        { id: 'anti-dilution', label: 'Budget dilution guard', evidenceStatus: params.budgetDilutionRisk && !dilutionBlocking ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided purpose-lock evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
      if (params.assetScope) dossierFacts.push(`Asset scope: ${params.assetScope}`);
      if (params.financingModel) dossierFacts.push(`Financing model: ${params.financingModel}`);
      if (purposeLockedMeasures.length > 0) dossierFacts.push(`Purpose-locked measures: ${purposeLockedMeasures.length}`);

      return {
        purposeLockStatusId: `smopl:${Buffer.from(`${params.caseId || ''}:${params.assetScope || ''}:${params.financingModel || ''}:${params.financeReviewStatus || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'smart_meter_off_balancing_purpose_lock',
        safety: 'read_only',
        requestContext: purposeLockContext,
        status,
        readinessScore,
        purposeLockContext,
        financeSummary,
        purposeLockCoverage,
        investmentEffectEvidence: investmentEffect,
        budgetDilutionRisk: {
          status: params.budgetDilutionRisk || null,
          blocking: dilutionBlocking,
        },
        purposeLockSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          purposeLockContext,
          financeSummary,
          purposeLockCoverage,
          investmentEffectEvidence: investmentEffect,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.smartMeterOffBalancingPurposeLockStatus'],
          referenced: [
            'finance-agent.analyze',
            'investment-planning.read',
            'vdmi.dossier',
            'datapoint.health',
            'datasource-registry.get',
            'presentation.generate',
          ],
          notCalled: [
            'finance-agent.mutate',
            'sap.psp.write',
            'sap.budget.write',
            'investment-planning.createPlan',
            'investment-planning.mutate',
            'billing.release',
            'settlement.prepareBilling',
            'settlement.exportA96',
            'mako.dispatch',
            'hitl.create',
            'vdmi.create',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          purposeLockContext,
          financeSummary,
          purposeLockCoverage,
          investmentEffectEvidence: investmentEffect,
          budgetDilutionRisk: {
            status: params.budgetDilutionRisk || null,
            blocking: dilutionBlocking,
          },
          purposeLockSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildImsysScheduleValueChainReadinessStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceDatapoints = toList(params.sourceDatapoints);
      const flexibilityOptions = toList(params.flexibilityOptions);
      const evidenceRefs = toList(params.evidenceRef);
      const evidenceSpecs = [
        {
          key: 'metering_scope',
          label: 'Metering scope',
          value: params.meteringScope,
          missingDataPoint: 'metering_scope',
          enablesDossierAddition: 'iMSys-/CLS-Messbereich und betroffene Markt-/Netzlokation koennen abgegrenzt werden',
        },
        {
          key: 'source_datapoints',
          label: 'Source datapoints',
          value: sourceDatapoints.length > 0 ? sourceDatapoints.join(', ') : null,
          missingDataPoint: 'source_datapoints',
          enablesDossierAddition: 'Messdatenquellen, Datenalter und Verfuegbarkeit koennen im Dossier belegt werden',
        },
        {
          key: 'data_quality_status',
          label: 'Data quality status',
          value: params.dataQualityStatus,
          missingDataPoint: 'data_quality_status',
          enablesDossierAddition: 'Datenqualitaet und Confidence der iMSys-/CLS-Daten koennen bewertet werden',
        },
        {
          key: 'forecast_window',
          label: 'Forecast window',
          value: params.forecastWindow,
          missingDataPoint: 'forecast_window',
          enablesDossierAddition: 'Prognosefenster und Fahrplanhorizont koennen in die Bewertung aufgenommen werden',
        },
        {
          key: 'congestion_signal',
          label: 'Congestion signal',
          value: params.congestionSignal,
          missingDataPoint: 'congestion_signal',
          enablesDossierAddition: 'Engpasslogik und Netzbedarf koennen als Ausloeser der Value Chain erklaert werden',
        },
        {
          key: 'asset_scope',
          label: 'Asset scope',
          value: params.assetScope,
          missingDataPoint: 'asset_scope',
          enablesDossierAddition: 'Betroffene Anlagen, NAP/MeLo oder Flex-Assets koennen der Fahrplankette zugeordnet werden',
        },
        {
          key: 'controllability_status',
          label: 'Controllability status',
          value: params.controllabilityStatus,
          missingDataPoint: 'controllability_status',
          enablesDossierAddition: 'Fernsteuerbarkeit, Rueckmeldefaehigkeit und Flex-Status koennen ausgewiesen werden',
        },
        {
          key: 'flexibility_options',
          label: 'Flexibility options',
          value: flexibilityOptions.length > 0 ? flexibilityOptions.join(', ') : null,
          missingDataPoint: 'flexibility_options',
          enablesDossierAddition: 'Konkrete Flexibilitaetsoptionen koennen als operative Auswahl sichtbar werden',
        },
        {
          key: 'netzfahrplan_assessment_ref',
          label: 'Netzfahrplan assessment',
          value: params.netzfahrplanAssessmentRef,
          missingDataPoint: 'netzfahrplan_assessment_ref',
          enablesDossierAddition: 'fNAV-/Netzfahrplan-Bewertung und Kapazitaetsentscheidung koennen referenziert werden',
        },
        {
          key: 'operational_decision',
          label: 'Operational decision',
          value: params.operationalDecision,
          missingDataPoint: 'operational_decision',
          enablesDossierAddition: 'Die naechste Netzbetriebsentscheidung kann als Review-Grenze beschrieben werden',
        },
        {
          key: 'control_readiness',
          label: 'Control readiness',
          value: params.controlReadiness,
          missingDataPoint: 'control_readiness',
          enablesDossierAddition: 'Leitwarten-/CLS-Uebergabefaehigkeit kann ohne Ausfuehrung bewertet werden',
        },
        {
          key: 'line_owner_role',
          label: 'Line owner role',
          value: params.lineOwnerRole,
          missingDataPoint: 'line_owner_role',
          enablesDossierAddition: 'Die fachliche Linienverantwortung fuer die Uebergabe kann benannt werden',
        },
        {
          key: 'source_snapshot_ref',
          label: 'Source snapshot',
          value: params.sourceSnapshotRef,
          missingDataPoint: 'source_snapshot_ref',
          enablesDossierAddition: 'Ein zitierbarer Snapshot kann die Value-Chain-Bewertung auditierbar machen',
        },
        {
          key: 'evidence_ref',
          label: 'Evidence references',
          value: evidenceRefs.length > 0 ? evidenceRefs.join(', ') : null,
          missingDataPoint: 'evidence_ref',
          enablesDossierAddition: 'Evidenzreferenzen koennen die operative Review-Faehigkeit absichern',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'imsys_schedule_value_chain_readiness',
          severity: ['metering_scope', 'source_datapoints', 'forecast_window', 'controllability_status', 'control_readiness'].includes(spec.key) ? 'high' : 'medium',
        }));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      let status = 'ready_for_operation_review';
      if (!params.meteringScope || sourceDatapoints.length === 0 || !params.dataQualityStatus) status = 'needs_metering_evidence';
      else if (!params.forecastWindow) status = 'needs_forecast_context';
      else if (!params.congestionSignal) status = 'needs_congestion_signal';
      else if (!params.assetScope || !params.controllabilityStatus || flexibilityOptions.length === 0) status = 'needs_flex_mapping';
      else if (!params.netzfahrplanAssessmentRef || !params.operationalDecision) status = 'needs_governance_decision';
      else if (!params.controlReadiness || /blocked|not[-_ ]?ready|missing|unready|nein|no/i.test(params.controlReadiness)) status = 'blocked_by_control_readiness';
      else if (!params.lineOwnerRole) status = 'needs_line_owner';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const blockingFindings = [];
      if (status === 'blocked_by_control_readiness') {
        blockingFindings.push({
          code: 'IMSYS_CONTROL_READINESS_BLOCKED',
          severity: 'high',
          message: 'iMSys/CLS value-chain review is blocked until control-room handover readiness is evidenced',
        });
      }
      const valueChainContext = {
        caseId: params.caseId || null,
        gridOperatorId: params.gridOperatorId || null,
        meteringScope: params.meteringScope || null,
      };
      const readinessEvidence = {
        sourceDatapoints,
        dataQualityStatus: params.dataQualityStatus || null,
        forecastWindow: params.forecastWindow || null,
        congestionSignal: params.congestionSignal || null,
        assetScope: params.assetScope || null,
        controllabilityStatus: params.controllabilityStatus || null,
        flexibilityOptions,
        netzfahrplanAssessmentRef: params.netzfahrplanAssessmentRef || null,
        operationalDecision: params.operationalDecision || null,
        controlReadiness: params.controlReadiness || null,
        lineOwnerRole: params.lineOwnerRole || null,
      };
      const valueChainSteps = [
        { id: 'metering-data', label: 'Metering and datapoint evidence', evidenceStatus: params.meteringScope && sourceDatapoints.length > 0 && params.dataQualityStatus ? 'provided' : 'missing' },
        { id: 'forecast-congestion', label: 'Forecast and congestion context', evidenceStatus: params.forecastWindow && params.congestionSignal ? 'provided' : 'missing' },
        { id: 'asset-flex', label: 'Asset controllability and flex mapping', evidenceStatus: params.assetScope && params.controllabilityStatus && flexibilityOptions.length > 0 ? 'provided' : 'missing' },
        { id: 'fnav-decision', label: 'Netzfahrplan and operational decision', evidenceStatus: params.netzfahrplanAssessmentRef && params.operationalDecision ? 'provided' : 'missing' },
        { id: 'line-handover', label: 'Control-room readiness and line owner', evidenceStatus: params.controlReadiness && params.lineOwnerRole ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided iMSys value-chain evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.caseId) dossierFacts.push(`Case: ${params.caseId}`);
      if (params.meteringScope) dossierFacts.push(`Metering scope: ${params.meteringScope}`);
      if (params.operationalDecision) dossierFacts.push(`Operational decision: ${params.operationalDecision}`);
      if (params.controlReadiness) dossierFacts.push(`Control readiness: ${params.controlReadiness}`);

      return {
        valueChainReadinessId: `isvc:${Buffer.from(`${params.caseId || ''}:${params.meteringScope || ''}:${params.forecastWindow || ''}:${params.assetScope || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'imsys_schedule_value_chain_readiness',
        safety: 'read_only',
        requestContext: valueChainContext,
        status,
        readinessScore,
        valueChainContext,
        readinessEvidence,
        valueChainSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          valueChainContext,
          readinessEvidence,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
        },
        evidenceRefs,
        sourceActions: {
          inspected: ['dashboard-api.imsysScheduleValueChainReadinessStatus'],
          referenced: [
            'datapoint.health',
            'datasource-registry.get',
            'forecast-engine.run',
            'forecast.read',
            'grid-operations.netzfahrplanGenerate',
            'flex.listDevices',
            'mastr-quality.audit',
            'redispatch-expost.audit',
            'vdmi.dossier',
            'presentation.generate',
          ],
          notCalled: [
            'device-control.execute',
            'cls.executeControl',
            'smgw.switch',
            'grid-operations.executeControl',
            'grid-operations.dispatch',
            'hitl.create',
            'mako.dispatch',
            'billing.release',
            'settlement.prepareBilling',
            'settlement.exportA96',
            'external.connector.call',
            'personal-agent.execute',
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          valueChainContext,
          readinessEvidence,
          valueChainSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceSnapshotRef: params.sourceSnapshotRef || null,
          evidenceRefs,
          dossierFacts,
        },
      };
    },

    buildClsDigitalTwinComplianceGateStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean)
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const personalDataCategories = toList(params.personalDataCategories);
      const rolesAccessRights = toList(params.rolesAccessRights);
      const rbacRefs = toList(params.rbacRefs);
      const securityEvidenceRefs = toList(params.securityEvidenceRefs);
      const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
      const evidenceSpecs = [
        ['system_purpose', 'System purpose', params.systemPurpose, 'Systemzweck und Beschaffungsgrenze koennen im Gate-Brief benannt werden'],
        ['digital_twin_scope', 'Digital-twin scope', params.digitalTwinScope, 'Digital-Twin-Scope und betroffene Asset-/Datenobjekte koennen abgegrenzt werden'],
        ['cls_interface_scope', 'CLS interface scope', params.clsInterfaceScope, 'CLS-Schnittstellenumfang kann ohne Steuerungsfreigabe dokumentiert werden'],
        ['data_flow_map', 'Data-flow map', params.dataFlowMap, 'Datenflussrisiken und Systemgrenzen koennen bewertet werden'],
        ['personal_data_categories', 'Personal-data categories', personalDataCategories.length ? personalDataCategories.join(', ') : null, 'Personenbezogene Datenarten koennen fuer Datenschutz-/DSFA-Bewertung sichtbar werden'],
        ['roles_access_rights', 'Roles and access rights', rolesAccessRights.length ? rolesAccessRights.join(', ') : null, 'Rollenrechte und Zugriffspfad koennen als Entscheidungsmatrix aufgenommen werden'],
        ['rbac_refs', 'RBAC refs', rbacRefs.length ? rbacRefs.join(', ') : null, 'RBAC-Nachweise koennen den Rollenrechte-Entscheid belegen'],
        ['avv_status', 'AVV status', params.avvStatus, 'AVV-Status kann als Vertragsnachweis ergaenzt werden'],
        ['nda_status', 'NDA status', params.ndaStatus, 'NDA-/Vertraulichkeitsstatus kann als Vertragsnachweis ergaenzt werden'],
        ['works_council_status', 'Works-council status', params.worksCouncilStatus, 'Betriebsvereinbarungs- oder BR-Bedarf kann als Governance-Grenze sichtbar werden'],
        ['dsfa_status', 'DSFA status', params.dsfaStatus, 'DSFA-Status kann ohne Rechtsfreigabe als Evidenzluecke oder Nachweis erscheinen'],
        ['billing_module_impact', 'Billing/module impact', params.billingModuleImpact, 'Abrechnungs- oder Modulwirkung kann als Review-Grenze dokumentiert werden'],
        ['regulatory_evidence_status', 'Regulatory evidence', params.regulatoryEvidenceStatus, 'BNetzA-/Regulierungsnachweise koennen ohne Authority-Claim referenziert werden'],
        ['security_evidence_refs', 'Security evidence refs', securityEvidenceRefs.length ? securityEvidenceRefs.join(', ') : null, 'IT-Sicherheitsnachweise koennen die CLS-/Digital-Twin-Beschaffung absichern'],
        ['source_evidence_refs', 'Source evidence refs', sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null, 'Quellenreferenzen koennen den Gate-Status auditierbar machen'],
      ].map(([key, label, value, enablesDossierAddition]) => ({
        key,
        label,
        value,
        missingDataPoint: key,
        enablesDossierAddition,
      }));
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const highGaps = new Set(['system_purpose', 'data_flow_map', 'roles_access_rights', 'rbac_refs', 'avv_status', 'dsfa_status', 'regulatory_evidence_status', 'security_evidence_refs']);
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'cls_digital_twin_compliance_gate',
          severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
        }));
      let status = 'ready_for_procurement_review';
      if (!params.systemPurpose) status = 'needs_system_purpose';
      else if (!params.dataFlowMap) status = 'needs_data_flow_map';
      else if (!rolesAccessRights.length || !rbacRefs.length) status = 'needs_rbac_decision';
      else if (!params.avvStatus || !params.ndaStatus) status = 'needs_contractual_evidence';
      else if (!params.worksCouncilStatus || !params.dsfaStatus) status = 'needs_dsfa';
      else if (!params.billingModuleImpact) status = 'needs_billing_review';
      else if (!params.regulatoryEvidenceStatus || !securityEvidenceRefs.length) status = 'needs_regulatory_security_evidence';
      else if (!sourceEvidenceRefs.length) status = 'needs_source_evidence';
      const approvalText = String(params.approvalStatus || '').toLowerCase();
      const blockedByCompliance =
        /blocked|gesperrt|reject|abgelehnt|stop|red|rot|nicht freigegeben|not approved/.test(approvalText) &&
        !/not blocked|unblocked|freigegeben|approved|green|gruen|grün/.test(approvalText);
      if (blockedByCompliance) status = 'blocked_by_compliance';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `CLSDT_${String(item.missingDataPoint).toUpperCase()}`,
        severity: item.severity,
        message: item.enablesDossierAddition,
      }));
      if (blockedByCompliance) {
        blockingFindings.push({
          code: 'CLSDT_BLOCKED_BY_COMPLIANCE',
          severity: 'high',
          message: 'procurement review remains blocked by the supplied compliance approval status',
        });
      }
      const blockedDecisions = missingEvidence.length || blockedByCompliance
        ? ['vendor_procurement_approval', 'pilot_start', 'cls_interface_activation', 'digital_twin_runtime_use']
        : [];
      const gateContext = {
        procurementId: params.procurementId || null,
        vendorId: params.vendorId || null,
        systemPurpose: params.systemPurpose || null,
        digitalTwinScope: params.digitalTwinScope || null,
        clsInterfaceScope: params.clsInterfaceScope || null,
      };
      const complianceEvidence = {
        dataFlowMap: params.dataFlowMap || null,
        personalDataCategories,
        rolesAccessRights,
        rbacRefs,
        avvStatus: params.avvStatus || null,
        ndaStatus: params.ndaStatus || null,
        worksCouncilStatus: params.worksCouncilStatus || null,
        dsfaStatus: params.dsfaStatus || null,
        billingModuleImpact: params.billingModuleImpact || null,
        regulatoryEvidenceStatus: params.regulatoryEvidenceStatus || null,
        securityEvidenceRefs,
        approvalStatus: params.approvalStatus || null,
      };
      const decisionSteps = [
        { id: 'purpose-and-scope', label: 'System purpose and scope', evidenceStatus: params.systemPurpose && params.digitalTwinScope && params.clsInterfaceScope ? 'provided' : 'missing' },
        { id: 'data-flow-map', label: 'Data-flow map', evidenceStatus: params.dataFlowMap ? 'provided' : 'missing' },
        { id: 'roles-rbac', label: 'Roles and RBAC', evidenceStatus: rolesAccessRights.length && rbacRefs.length ? 'provided' : 'missing' },
        { id: 'contractual-evidence', label: 'AVV/NDA evidence', evidenceStatus: params.avvStatus && params.ndaStatus ? 'provided' : 'missing' },
        { id: 'privacy-governance', label: 'Works council and DSFA', evidenceStatus: params.worksCouncilStatus && params.dsfaStatus ? 'provided' : 'missing' },
        { id: 'billing-regulatory-security', label: 'Billing, regulatory and security evidence', evidenceStatus: params.billingModuleImpact && params.regulatoryEvidenceStatus && securityEvidenceRefs.length ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Provided CLS compliance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.procurementId) dossierFacts.push(`Procurement: ${params.procurementId}`);
      if (params.vendorId) dossierFacts.push(`Vendor: ${params.vendorId}`);
      if (params.systemPurpose) dossierFacts.push(`System purpose: ${params.systemPurpose}`);

      return {
        complianceGateStatusId: `clsdt:${Buffer.from(`${params.procurementId || ''}:${params.vendorId || ''}:${params.systemPurpose || ''}:${params.approvalStatus || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'cls_digital_twin_compliance_gate',
        safety: 'read_only',
        requestContext: gateContext,
        status,
        readinessScore,
        gateContext,
        complianceEvidence,
        decisionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          gateContext,
          complianceEvidence,
          sourceSnapshot: params.sourceSnapshot || null,
          sourceEvidenceRefs,
        },
        sourceActions: {
          inspected: ['dashboard-api.clsDigitalTwinComplianceGateStatus'],
          referenced: ['datasource-registry.get', 'datapoint.health', 'vdmi.dossier', 'interface-placeholder.requestEvidence', 'finance-agent.analyze', 'presentation.generate'],
          notCalled: ['procurement.approve', 'legal.approve', 'dsfa.create', 'rbac.grant', 'hitl.create', 'billing.release', 'settlement.prepareBilling', 'settlement.exportA96', 'mako.dispatch', 'cls.executeControl', 'smgw.switch', 'device-control.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          gateContext,
          complianceEvidence,
          decisionSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceSnapshot: params.sourceSnapshot || null,
          sourceEvidenceRefs,
          dossierFacts,
        },
      };
    },

    buildLegacyControlTechnologyTransitionStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean)
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
      const evidenceSpecs = [
        ['asset_group_or_asset', 'Asset group or asset', params.assetGroupId || params.assetId, 'Assetgruppe oder Einzelasset kann dem Uebergangsraster eindeutig zugeordnet werden'],
        ['power_class', 'Power class', params.powerClass, 'Leistungsklasse kann getrennt von der Steuertechnik bewertet werden'],
        ['control_technology', 'Control technology', params.controlTechnology, 'Bestands-Steuertechnik wie Rundsteuertechnik, Gruppensignal oder Steuerbox-Pfad kann benannt werden'],
        ['feedback_capability', 'Feedback capability', params.feedbackCapability, 'Rueckmeldefaehigkeit kann proven control von legacy no-feedback operation trennen'],
        ['switching_risk', 'Switching risk', params.switchingRisk, 'Schaltrisiko kann vor Tests oder Roadmap-Entscheiden sichtbar werden'],
        ['test_feasibility', 'Test feasibility', params.testFeasibility, 'Testbarkeit kann dokumentiert werden, ohne eine Schalthandlung auszufuehren'],
        ['test_status', 'Test status', params.testStatus, 'Teststatus kann eine belegte Steuerbarkeitsaussage oder Luecke begrenzen'],
        ['non_execution_reason', 'Non-execution reason', params.nonExecutionReason, 'Nichtdurchfuehrungsbegruendung kann auditierbar werden, wenn Tests nicht zumutbar sind'],
        ['target_technology', 'Target technology', params.targetTechnology, 'Zieltechnologie fuer Steuerbox, CLS oder Zielprozess kann als Roadmap-Ziel erscheinen'],
        ['migration_roadmap', 'Migration roadmap', params.migrationRoadmap, 'Migrationsfahrplan kann Bestandsbetrieb von Zielprozess trennen'],
        ['owner_next_action', 'Owner and next action', params.owner && params.nextAction ? `${params.owner}: ${params.nextAction}` : null, 'Owner und naechster Schritt koennen als Steuerungsobjekt ergaenzt werden'],
        ['source_evidence_refs', 'Source evidence refs', sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null, 'Quellenreferenzen koennen den Uebergangsstatus auditierbar machen'],
      ].map(([key, label, value, enablesDossierAddition]) => ({
        key,
        label,
        value,
        missingDataPoint: key,
        enablesDossierAddition,
      }));
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const highGaps = new Set(['asset_group_or_asset', 'control_technology', 'feedback_capability', 'test_feasibility', 'test_status', 'non_execution_reason', 'migration_roadmap']);
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'legacy_control_technology_transition',
          severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
        }));
      const text = (value) => String(value || '').toLowerCase();
      const feedbackText = text(params.feedbackCapability);
      const testFeasibilityText = text(params.testFeasibility);
      const testStatusText = text(params.testStatus);
      const roadmapText = text(params.migrationRoadmap);
      const hasFeedback = params.feedbackCapability && !/none|keine|no feedback|nicht rueckmelde|nicht rückmelde|unknown|unbekannt/.test(feedbackText);
      const notTestable = /not.?test|nicht test|unzumutbar|blocked|gesperrt|no test/.test(testFeasibilityText);
      const tested = /done|tested|geprueft|geprüft|complete|ok|passed|nachweis/.test(testStatusText);
      const roadmapReady = params.migrationRoadmap && !/unknown|unbekannt|none|offen/.test(roadmapText);
      let controlReadiness = 'needs_evidence';
      if (!params.controlTechnology || !params.feedbackCapability) controlReadiness = 'needs_evidence';
      else if (!hasFeedback) controlReadiness = roadmapReady ? 'roadmap_only' : 'not_feedback_capable';
      else if (notTestable) controlReadiness = params.nonExecutionReason ? 'not_testable' : 'needs_evidence';
      else if (tested) controlReadiness = 'proven';
      else controlReadiness = 'limited';
      let transitionStatus = 'unknown';
      if (controlReadiness === 'proven' && roadmapReady) transitionStatus = 'target_process_ready';
      else if (roadmapReady && params.owner && params.nextAction) transitionStatus = 'migration_planned';
      else if (params.nonExecutionReason && !roadmapReady) transitionStatus = 'migration_blocked';
      else if (params.controlTechnology) transitionStatus = 'legacy_operational';
      let status = 'ready_for_transition_review';
      if (!params.controlTechnology) status = 'needs_control_technology';
      else if (!params.feedbackCapability) status = 'needs_feedback_capability';
      else if (!params.testFeasibility && !params.testStatus) status = 'needs_testability_evidence';
      else if (notTestable && !params.nonExecutionReason) status = 'needs_non_execution_reason';
      else if (!roadmapReady) status = 'needs_migration_roadmap';
      else if (!params.owner || !params.nextAction) status = 'needs_owner_next_action';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `LCTT_${String(item.missingDataPoint).toUpperCase()}`,
        severity: item.severity,
        message: item.enablesDossierAddition,
      }));
      const blockedDecisions = missingEvidence.length
        ? ['steuerbarkeitsnachweis', 'test_execution_decision', 'legacy_to_target_transition', 'control_claim']
        : [];
      const transitionContext = {
        assetGroupId: params.assetGroupId || null,
        assetId: params.assetId || null,
        gridOperatorId: params.gridOperatorId || null,
        powerClass: params.powerClass || null,
        controlTechnology: params.controlTechnology || null,
      };
      const transitionEvidence = {
        feedbackCapability: params.feedbackCapability || null,
        switchingRisk: params.switchingRisk || null,
        testFeasibility: params.testFeasibility || null,
        testStatus: params.testStatus || null,
        nonExecutionReason: params.nonExecutionReason || null,
        targetTechnology: params.targetTechnology || null,
        migrationRoadmap: params.migrationRoadmap || null,
        owner: params.owner || null,
        nextAction: params.nextAction || null,
      };
      const transitionSteps = [
        { id: 'asset-scope', label: 'Asset group / power class', evidenceStatus: (params.assetGroupId || params.assetId) && params.powerClass ? 'provided' : 'missing' },
        { id: 'legacy-control-technology', label: 'Legacy control technology', evidenceStatus: params.controlTechnology ? 'provided' : 'missing' },
        { id: 'feedback-capability', label: 'Feedback capability', evidenceStatus: params.feedbackCapability ? 'provided' : 'missing' },
        { id: 'testability', label: 'Testability and test status', evidenceStatus: params.testFeasibility && params.testStatus ? 'provided' : 'missing' },
        { id: 'non-execution', label: 'Non-execution reason', evidenceStatus: params.nonExecutionReason ? 'provided' : 'missing' },
        { id: 'migration-roadmap', label: 'Target technology and roadmap', evidenceStatus: params.targetTechnology && params.migrationRoadmap ? 'provided' : 'missing' },
        { id: 'owner-next-action', label: 'Owner and next action', evidenceStatus: params.owner && params.nextAction ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${status}`,
        `Control readiness: ${controlReadiness}`,
        `Transition status: ${transitionStatus}`,
        `Provided legacy-control evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.assetGroupId) dossierFacts.push(`Asset group: ${params.assetGroupId}`);
      if (params.controlTechnology) dossierFacts.push(`Control technology: ${params.controlTechnology}`);
      if (params.migrationRoadmap) dossierFacts.push(`Roadmap: ${params.migrationRoadmap}`);

      return {
        transitionStatusId: `lctt:${Buffer.from(`${params.assetGroupId || ''}:${params.assetId || ''}:${params.controlTechnology || ''}:${params.feedbackCapability || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'legacy_control_technology_transition',
        safety: 'read_only',
        requestContext: transitionContext,
        status,
        controlReadiness,
        transitionStatus,
        readinessScore,
        transitionContext,
        transitionEvidence,
        transitionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          transitionContext,
          transitionEvidence,
          sourceSnapshot: params.sourceSnapshot || null,
          sourceEvidenceRefs,
        },
        sourceActions: {
          inspected: ['dashboard-api.legacyControlTechnologyTransitionStatus'],
          referenced: ['assets.effective', 'grid-operations.controlMeasures', 'edm-messkonzept.evaluate', 'datapoint.health', 'vdmi.dossier', 'interface-placeholder.requestEvidence', 'presentation.generate'],
          notCalled: ['grid-operations.executeControl', 'cls.executeControl', 'smgw.switch', 'device-control.execute', 'hitl.create', 'settlement.prepareBilling', 'settlement.exportA96', 'mako.dispatch', 'billing.release', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          controlReadiness,
          transitionStatus,
          readinessScore,
          transitionContext,
          transitionEvidence,
          transitionSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceSnapshot: params.sourceSnapshot || null,
          sourceEvidenceRefs,
          dossierFacts,
        },
      };
    },

    buildControllabilitySubmissionCockpitStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean)
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const sourceList = toList(params.sourceList);
      const reasonCatalog = toList(params.reasonCatalog);
      const assetGroupStatuses = toList(params.assetGroupStatuses);
      const openMeasures = toList(params.openMeasures);
      const nextCycleTasks = toList(params.nextCycleTasks);
      const deadlineRisks = toList(params.deadlineRisks);
      const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
      const evidenceSpecs = [
        ['submission_identity', 'Submission identity', params.submissionId, 'Abgabeprojekt kann eindeutig im Dossier referenziert werden'],
        ['submission_deadline', 'Submission deadline', params.submissionDeadline, 'Abgabefrist kann als Steuerungs- und Eskalationsdatum erscheinen'],
        ['coordinator', 'Coordinator', params.coordinator, 'Verantwortlicher Koordinator kann als accountable owner ergaenzt werden'],
        ['source_list', 'Source list', sourceList.length ? sourceList.join(', ') : null, 'Quellenabdeckung und Provenienz koennen in das Dossier aufgenommen werden'],
        ['data_reconciliation_status', 'Data reconciliation status', params.dataReconciliationStatus, 'Abgeglichener Steuerbarkeitscheck-Evidenzstand kann ergaenzt werden'],
        ['reason_catalog', 'Reason catalog', reasonCatalog.length ? reasonCatalog.join(', ') : null, 'Formale Begruendung fuer Nichtdurchfuehrung oder Carry-over kann ergaenzt werden'],
        ['asset_group_statuses', 'Asset group statuses', assetGroupStatuses.length ? assetGroupStatuses.join(', ') : null, 'Assetgruppenbezogene Readiness und Ausnahmen koennen sichtbar werden'],
        ['open_measures', 'Open measures', openMeasures.length ? openMeasures.join(', ') : null, 'Offene Massnahmen, naechste Schritte und Blocker koennen ergaenzt werden'],
        ['handover_decision', 'Handover decision', params.handoverDecision, 'Zyklusabschluss, Carry-over oder Eskalation kann als Entscheidung erscheinen'],
        ['handover_owner', 'Handover owner', params.handoverOwner, 'Owner fuer naechsten Zyklus oder Uebergabe kann ergaenzt werden'],
        ['next_cycle_tasks', 'Next-cycle tasks', nextCycleTasks.length ? nextCycleTasks.join(', ') : null, 'Naechste Zyklusaufgaben koennen als Follow-up-Fakten erscheinen'],
        ['source_evidence_refs', 'Source evidence refs', sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null, 'Quellenreferenzen koennen die Abgabe revisionsfaehig machen'],
      ].map(([key, label, value, enablesDossierAddition]) => ({
        key,
        label,
        value,
        missingDataPoint: key,
        enablesDossierAddition,
      }));
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const highGaps = new Set(['coordinator', 'source_list', 'data_reconciliation_status', 'reason_catalog', 'asset_group_statuses', 'handover_decision', 'handover_owner']);
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'controllability_submission_cockpit',
          severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
        }));
      const lower = (value) => String(value || '').toLowerCase();
      const reconciliationText = lower(params.dataReconciliationStatus);
      const handoverText = lower(params.handoverDecision);
      const blockedByDeadline = deadlineRisks.some((risk) => /blocked|critical|kritisch|overdue|verzug|frist/.test(lower(risk)));
      let submissionReadiness = 'ready';
      if (!params.coordinator) submissionReadiness = 'needs_owner';
      else if (!sourceList.length) submissionReadiness = 'needs_sources';
      else if (!params.dataReconciliationStatus || /open|missing|unabgeglichen|unknown|unbekannt/.test(reconciliationText)) submissionReadiness = 'needs_data_reconciliation';
      else if (!reasonCatalog.length) submissionReadiness = 'needs_reasoning';
      else if (!assetGroupStatuses.length) submissionReadiness = 'needs_asset_group_status';
      else if (openMeasures.length && !/close|done|submitted|abgabe|carry|handover|approved/.test(handoverText)) submissionReadiness = 'needs_open_measure_closure';
      else if (!params.handoverDecision || !params.handoverOwner) submissionReadiness = 'needs_handover_decision';
      else if (blockedByDeadline) submissionReadiness = 'blocked_by_deadline_risk';
      else if (/submitted|eingereicht|done|closed|abgeschlossen/.test(handoverText)) submissionReadiness = 'submitted';
      const handoverStatus = params.handoverDecision || null;
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `CSC_${String(item.missingDataPoint).toUpperCase()}`,
        severity: item.severity,
        message: item.enablesDossierAddition,
      }));
      if (blockedByDeadline) {
        blockingFindings.push({
          code: 'CSC_DEADLINE_RISK',
          severity: 'high',
          message: 'Abgabefrist oder Deadline-Risiko blockiert die sichere Zyklusuebergabe',
        });
      }
      const blockedDecisions = missingEvidence.length || blockedByDeadline
        ? ['submission_release', 'cycle_closure', 'handover_to_next_cycle', 'technical_readiness_claim']
        : [];
      const submissionContext = {
        submissionId: params.submissionId || null,
        submissionDeadline: params.submissionDeadline || null,
        coordinator: params.coordinator || null,
      };
      const submissionEvidence = {
        sourceList,
        dataReconciliationStatus: params.dataReconciliationStatus || null,
        reasonCatalog,
        assetGroupStatuses,
        openMeasures,
        handoverDecision: params.handoverDecision || null,
        handoverOwner: params.handoverOwner || null,
        nextCycleTasks,
        deadlineRisks,
      };
      const submissionSteps = [
        { id: 'coordinator', label: 'Coordinator', evidenceStatus: params.coordinator ? 'provided' : 'missing' },
        { id: 'source-list', label: 'Source list', evidenceStatus: sourceList.length ? 'provided' : 'missing' },
        { id: 'data-reconciliation', label: 'Data reconciliation', evidenceStatus: params.dataReconciliationStatus ? 'provided' : 'missing' },
        { id: 'reason-catalog', label: 'Reason catalog', evidenceStatus: reasonCatalog.length ? 'provided' : 'missing' },
        { id: 'asset-group-status', label: 'Asset group status', evidenceStatus: assetGroupStatuses.length ? 'provided' : 'missing' },
        { id: 'open-measures', label: 'Open measures', evidenceStatus: openMeasures.length ? 'provided' : 'missing' },
        { id: 'handover', label: 'Handover decision and owner', evidenceStatus: params.handoverDecision && params.handoverOwner ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${submissionReadiness}`,
        `Provided submission evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.submissionId) dossierFacts.push(`Submission: ${params.submissionId}`);
      if (params.coordinator) dossierFacts.push(`Coordinator: ${params.coordinator}`);
      if (params.handoverDecision) dossierFacts.push(`Handover: ${params.handoverDecision}`);

      return {
        submissionStatusId: `csc:${Buffer.from(`${params.submissionId || ''}:${params.coordinator || ''}:${params.handoverDecision || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'controllability_submission_cockpit',
        safety: 'read_only',
        requestContext: submissionContext,
        status: submissionReadiness,
        submissionReadiness,
        handoverStatus,
        readinessScore,
        submissionContext,
        submissionEvidence,
        submissionSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          submissionContext,
          submissionEvidence,
          sourceSnapshot: params.sourceSnapshot || null,
          sourceEvidenceRefs,
        },
        sourceActions: {
          inspected: ['dashboard-api.controllabilitySubmissionCockpitStatus'],
          referenced: ['vdmi.dossier', 'vdmi.findings', 'hitl.summary', 'interface-placeholder.requestEvidence', 'grid-operations.controlMeasures', 'edm-validation.validate', 'datapoint.health', 'presentation.generate'],
          notCalled: ['hitl.create', 'grid-operations.executeControl', 'cls.executeControl', 'smgw.switch', 'device-control.execute', 'mako.dispatch', 'billing.release', 'settlement.prepareBilling', 'settlement.exportA96', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status: submissionReadiness,
          submissionReadiness,
          handoverStatus,
          readinessScore,
          submissionContext,
          submissionEvidence,
          submissionSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceSnapshot: params.sourceSnapshot || null,
          sourceEvidenceRefs,
          dossierFacts,
        },
      };
    },

    buildCrisisDecisionRoutineStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean)
        : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
      const requiredMeasures = toList(params.requiredMeasures);
      const blockedFollowUp = toList(params.blockedFollowUp);
      const sourceEvidenceRefs = toList(params.sourceEvidenceRefs);
      const trainingOrOperatingModel = [params.trainingNeed, params.operatingModelNeed].filter(Boolean).join(' / ');
      const serviceOrPopulationImpact = [params.serviceImpact, params.populationImpact].filter(Boolean).join(' / ');
      const evidenceSpecs = [
        ['topic', 'Crisis topic', params.topic || params.caseId, 'name the crisis/ad-hoc topic as a stable management object'],
        ['service_population_impact', 'Service or population impact', serviceOrPopulationImpact, 'add service or population-group impact to the management dossier'],
        ['required_measures', 'Required measures', requiredMeasures.length ? requiredMeasures.join(', ') : null, 'add required measures without executing them'],
        ['finance_impact', 'Finance impact', params.financeImpact, 'quantify or qualify finance exposure for prioritisation'],
        ['knowledge_state', 'Knowledge state', params.knowledgeState, 'document known facts, uncertainty and evidence limits'],
        ['training_operating_model_need', 'Training or operating-model need', trainingOrOperatingModel, 'add training or operating-model follow-up need'],
        ['owner', 'Owner', params.owner, 'assign an accountable owner for the routine'],
        ['next_gate', 'Next decision gate', params.nextGate, 'state the next decision gate or date'],
        ['blocked_follow_up', 'Blocked follow-up', blockedFollowUp.length ? blockedFollowUp.join(', ') : null, 'record blocked follow-up decisions without closing them'],
        ['source_evidence_refs', 'Source evidence references', sourceEvidenceRefs.length ? sourceEvidenceRefs.join(', ') : null, 'add citable source references for the routine'],
      ].map(([key, label, value, enablesDossierAddition]) => ({
        key,
        label,
        value,
        missingDataPoint: key,
        enablesDossierAddition,
      }));
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({ id: spec.key, label: spec.label, value: spec.value, evidenceStatus: 'provided' }));
      const highGaps = new Set(['service_population_impact', 'finance_impact', 'knowledge_state', 'owner', 'next_gate']);
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.missingDataPoint,
          enablesDossierAddition: spec.enablesDossierAddition,
          category: 'crisis_decision_routine',
          severity: highGaps.has(spec.missingDataPoint) ? 'high' : 'medium',
        }));
      const lower = (value) => String(value || '').toLowerCase();
      const knowledgeText = lower(params.knowledgeState);
      const financeText = lower(params.financeImpact);
      const blockedByKnowledge = /unknown|unklar|missing|offen|unbelegt|insufficient|unsicher/.test(knowledgeText);
      const blockedByFinance = /unknown|unklar|missing|offen|unquantified|nicht quantifiziert/.test(financeText);
      let decisionReadiness = 'decision_ready';
      if (!params.owner) decisionReadiness = 'needs_owner';
      else if (!serviceOrPopulationImpact) decisionReadiness = 'needs_impact';
      else if (!requiredMeasures.length) decisionReadiness = 'needs_measures';
      else if (!params.financeImpact || blockedByFinance) decisionReadiness = 'needs_finance_impact';
      else if (!params.knowledgeState || blockedByKnowledge) decisionReadiness = 'needs_knowledge_state';
      else if (!trainingOrOperatingModel) decisionReadiness = 'needs_training_or_operating_model';
      else if (!params.nextGate) decisionReadiness = 'needs_next_gate';
      else if (!blockedFollowUp.length) decisionReadiness = 'needs_blocked_follow_up';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        category: item.category,
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `CDR_${String(item.missingDataPoint).toUpperCase()}`,
        severity: item.severity,
        message: item.enablesDossierAddition,
      }));
      if (blockedByKnowledge) {
        blockingFindings.push({
          code: 'CDR_KNOWLEDGE_STATE_UNCERTAIN',
          severity: 'high',
          message: 'knowledge state is explicitly uncertain and blocks a management decision claim',
        });
      }
      if (blockedByFinance) {
        blockingFindings.push({
          code: 'CDR_FINANCE_IMPACT_UNCERTAIN',
          severity: 'high',
          message: 'finance impact is explicitly uncertain and blocks prioritisation wording',
        });
      }
      const blockedDecisions = missingEvidence.length || blockedByKnowledge || blockedByFinance
        ? ['management_decision', 'operational_prioritisation', 'finance_commitment', 'training_follow_up']
        : [];
      const routineContext = {
        caseId: params.caseId || null,
        topic: params.topic || null,
        owner: params.owner || null,
        nextGate: params.nextGate || null,
        decisionDeadline: params.decisionDeadline || null,
      };
      const routineEvidence = {
        serviceImpact: params.serviceImpact || null,
        populationImpact: params.populationImpact || null,
        requiredMeasures,
        financeImpact: params.financeImpact || null,
        knowledgeState: params.knowledgeState || null,
        trainingNeed: params.trainingNeed || null,
        operatingModelNeed: params.operatingModelNeed || null,
        blockedFollowUp,
        sourceEvidenceRefs,
        sourceSnapshot: params.sourceSnapshot || null,
      };
      const routineSteps = [
        { id: 'impact', label: 'Impact statement', evidenceStatus: serviceOrPopulationImpact ? 'provided' : 'missing' },
        { id: 'measures', label: 'Required measures', evidenceStatus: requiredMeasures.length ? 'provided' : 'missing' },
        { id: 'finance', label: 'Finance impact', evidenceStatus: params.financeImpact && !blockedByFinance ? 'provided' : 'missing' },
        { id: 'knowledge', label: 'Knowledge state', evidenceStatus: params.knowledgeState && !blockedByKnowledge ? 'provided' : 'missing' },
        { id: 'training-operating-model', label: 'Training or operating model', evidenceStatus: trainingOrOperatingModel ? 'provided' : 'missing' },
        { id: 'owner', label: 'Owner', evidenceStatus: params.owner ? 'provided' : 'missing' },
        { id: 'next-gate', label: 'Next decision gate', evidenceStatus: params.nextGate ? 'provided' : 'missing' },
      ];
      const dossierFacts = [
        `Status: ${decisionReadiness}`,
        `Provided crisis routine evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.topic) dossierFacts.push(`Topic: ${params.topic}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
      if (params.nextGate) dossierFacts.push(`Next gate: ${params.nextGate}`);

      return {
        routineStatusId: `cdr:${Buffer.from(`${params.caseId || ''}:${params.topic || ''}:${params.owner || ''}:${params.nextGate || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'crisis_decision_routine',
        safety: 'read_only',
        requestContext: routineContext,
        status: decisionReadiness,
        decisionReadiness,
        readinessScore,
        routineContext,
        routineEvidence,
        routineSteps,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: routineEvidence,
        sourceActions: {
          inspected: ['dashboard-api.crisisDecisionRoutineStatus'],
          referenced: ['vdmi.dossier', 'nova.pendingDecisions', 'hitl.summary', 'finance-agent.analyze', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['hitl.create', 'nova.apply', 'nova.propose', 'vdmi.create', 'vdmi.mutate', 'finance-agent.mutate', 'grid-operations.executeControl', 'operational-dispatch.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status: decisionReadiness,
          decisionReadiness,
          readinessScore,
          routineContext,
          routineEvidence,
          routineSteps,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceEvidenceRefs,
          dossierFacts,
        },
      };
    },

    buildInvestmentCommitteeSteeringCardsStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);
      const assetOrProjectRef = params.assetId || params.projectId;
      const evidenceSpecs = [
        {
          id: 'investment_item',
          label: 'Investment item',
          value: params.investmentItemId,
          sourceClass: 'investment_item_identity',
          enablesDossierAddition: 'add the investment item id or card identifier',
        },
        {
          id: 'asset_project_reference',
          label: 'Asset or project reference',
          value: assetOrProjectRef,
          displayValue: [params.assetId, params.projectId].filter(Boolean).join(' / '),
          sourceClass: 'asset_project_reference',
          enablesDossierAddition: 'add asset or project reference for the committee card',
        },
        {
          id: 'review_status',
          label: 'Review status',
          value: params.reviewStatus,
          sourceClass: 'technical_review_status',
          enablesDossierAddition: 'add technical or commercial review status',
        },
        {
          id: 'evidence_status',
          label: 'Evidence status',
          value: params.evidenceStatus,
          sourceClass: 'card_evidence_status',
          enablesDossierAddition: 'add evidence completeness/status for the investment card',
        },
        {
          id: 'committee_window',
          label: 'Committee window',
          value: params.committeeWindow,
          sourceClass: 'committee_window',
          enablesDossierAddition: 'add committee or board decision window',
        },
        {
          id: 'owner',
          label: 'Owner',
          value: params.owner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add accountable owner for card preparation',
        },
        {
          id: 'blocked_follow_up_action',
          label: 'Blocked follow-up action',
          value: params.blockedFollowUpAction,
          sourceClass: 'blocked_follow_up',
          enablesDossierAddition: 'add the operational follow-up action blocked until committee review',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable SharePoint, Excel, VDMI or investment-plan source references',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const reviewText = String(params.reviewStatus || '').toLowerCase();
      const evidenceText = String(params.evidenceStatus || '').toLowerCase();
      const blockedByReview = /block|blocked|gesperrt|rejected|abgelehnt|kritisch|critical/.test(reviewText);
      const blockedByEvidence = /missing|fehlt|unvollstaendig|unvollständig|critical|kritisch|blocked/.test(evidenceText);
      const status =
        blockedByReview
          ? 'blocked_by_review'
          : blockedByEvidence
            ? 'needs_evidence'
            : !params.investmentItemId
              ? 'needs_investment_item'
              : !assetOrProjectRef
                ? 'needs_asset_project_reference'
                : !params.reviewStatus
                  ? 'needs_review_status'
                  : !params.evidenceStatus
                    ? 'needs_evidence_status'
                    : !params.owner
                      ? 'needs_owner'
                      : !params.committeeWindow
                        ? 'needs_committee_window'
                        : !params.blockedFollowUpAction
                          ? 'needs_blocked_follow_up'
                          : sourceRefs.length === 0
                            ? 'needs_source_refs'
                            : missingEvidence.length === 0
                              ? 'ready_for_committee'
                              : 'needs_card_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'investment_committee_steering_cards',
      }));
      const blockedDecisions = Array.from(new Set([
        ...missingEvidence
          .filter((item) => ['review_status', 'evidence_status', 'committee_window', 'owner', 'blocked_follow_up_action'].includes(item.missingDataPoint))
          .map((item) => item.label),
        ...(params.blockedFollowUpAction ? [params.blockedFollowUpAction] : []),
      ]));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `ICSC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['review_status', 'evidence_status', 'committee_window', 'owner'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByReview || blockedByEvidence) {
        blockingFindings.push({
          code: blockedByReview ? 'ICSC_REVIEW_STATUS_BLOCKING' : 'ICSC_EVIDENCE_STATUS_BLOCKING',
          severity: 'high',
          message: 'review or evidence status explicitly blocks committee steering readiness',
        });
      }
      const cardContext = {
        investmentItemId: params.investmentItemId || null,
        projectId: params.projectId || null,
        assetId: params.assetId || null,
        capexEur: params.capexEur ?? null,
        riskFlag: params.riskFlag || null,
      };
      const committeeContext = {
        reviewStatus: params.reviewStatus || null,
        evidenceStatus: params.evidenceStatus || null,
        committeeWindow: params.committeeWindow || null,
        owner: params.owner || null,
        blockedFollowUpAction: params.blockedFollowUpAction || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided card evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.investmentItemId) dossierFacts.push(`Investment Item: ${params.investmentItemId}`);
      if (params.assetId) dossierFacts.push(`Asset: ${params.assetId}`);
      if (params.projectId) dossierFacts.push(`Project: ${params.projectId}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
      if (params.committeeWindow) dossierFacts.push(`Committee Window: ${params.committeeWindow}`);

      return {
        cardStatusId: `icsc:${Buffer.from(`${params.investmentItemId || ''}:${params.projectId || ''}:${params.assetId || ''}:${params.committeeWindow || ''}:${params.owner || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'investment_committee_steering_cards',
        safety: 'read_only',
        requestContext: {
          investmentItemId: params.investmentItemId || null,
          projectId: params.projectId || null,
          assetId: params.assetId || null,
          owner: params.owner || null,
          committeeWindow: params.committeeWindow || null,
        },
        status,
        readinessScore,
        cardContext,
        committeeContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
          capexEur: params.capexEur ?? null,
          riskFlag: params.riskFlag || null,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.investmentCommitteeSteeringCardsStatus'],
          referenced: ['investment-planning.createPlan', 'vdmi.dossier', 'hitl.summary', 'finance-agent.analyze', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['hitl.create', 'vdmi.create', 'vdmi.mutate', 'investment-planning.createPlan', 'investment-planning.mutate', 'finance-agent.mutate', 'budget.release', 'billing.release', 'settlement.prepareBilling', 'tariff.mutate', 'payment.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          cardContext,
          committeeContext,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildInvestmentDataReviewQueueStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);
      const sourceOrPackage = params.sourceId || params.dataPackageId;
      const assetOrProjectRef = params.assetRef || params.projectRef;
      const evidenceSpecs = [
        {
          id: 'source_data_package',
          label: 'Source/data package',
          value: sourceOrPackage,
          sourceClass: 'source_provenance',
          enablesDossierAddition: 'add source provenance and auditability for the investment data package',
        },
        {
          id: 'asset_project_reference',
          label: 'Asset/project reference',
          value: assetOrProjectRef,
          sourceClass: 'asset_management_handover',
          enablesDossierAddition: 'add Assetmanagement handover context',
        },
        {
          id: 'quality_status',
          label: 'Quality status',
          value: params.qualityStatus,
          sourceClass: 'data_quality_basis',
          enablesDossierAddition: 'add review readiness and data-quality basis',
        },
        {
          id: 'division',
          label: 'Division',
          value: params.division,
          sourceClass: 'division_routing',
          enablesDossierAddition: 'add responsible Sparte and routing context',
        },
        {
          id: 'bottleneck_ref',
          label: 'Bottleneck reference',
          value: params.bottleneckRef,
          sourceClass: 'grid_impact_reference',
          enablesDossierAddition: 'add Engpass-/Netzwirkungsbezug',
        },
        {
          id: 'owner',
          label: 'Owner',
          value: params.owner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add accountable review owner',
        },
        {
          id: 'committee_window',
          label: 'Committee window',
          value: params.committeeWindow,
          sourceClass: 'committee_timing',
          enablesDossierAddition: 'add Gremiensteuerung timing',
        },
        {
          id: 'blocked_decision',
          label: 'Blocked decision',
          value: params.blockedDecision,
          sourceClass: 'blocked_follow_up_decision',
          enablesDossierAddition: 'add the blocked follow-up decision that can be prepared once evidence is complete',
        },
        {
          id: 'review_status',
          label: 'Review status',
          value: params.reviewStatus,
          sourceClass: 'review_queue_status',
          enablesDossierAddition: 'add the current review queue status',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable Datasource, Investment Planning, HITL or VDMI references',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const qualityText = String(params.qualityStatus || '').toLowerCase();
      const reviewText = String(params.reviewStatus || '').toLowerCase();
      const blockedByQuality = /blocked|blockiert|kritisch|critical|unvollstaendig|unvollständig|missing|fehlt/.test(qualityText);
      const blockedByReview = /blocked|blockiert|rejected|abgelehnt|kritisch|critical/.test(reviewText);
      const status =
        blockedByQuality
          ? 'blocked_by_quality'
          : blockedByReview
            ? 'blocked_by_review'
            : !sourceOrPackage
              ? 'needs_source_data_package'
              : !assetOrProjectRef
                ? 'needs_asset_project_reference'
                : !params.qualityStatus
                  ? 'needs_quality_status'
                  : !params.division
                    ? 'needs_division'
                    : !params.bottleneckRef
                      ? 'needs_bottleneck_reference'
                      : !params.owner
                        ? 'needs_owner'
                        : !params.committeeWindow
                          ? 'needs_committee_window'
                          : !params.blockedDecision
                            ? 'needs_blocked_decision'
                            : !params.reviewStatus
                              ? 'needs_review_status'
                              : sourceRefs.length === 0
                                ? 'needs_source_refs'
                                : missingEvidence.length === 0
                                  ? 'review_ready'
                                  : 'needs_review_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'investment_data_review_queue',
      }));
      const blockedDecisions = Array.from(new Set([
        ...missingEvidence
          .filter((item) => ['quality_status', 'owner', 'committee_window', 'blocked_decision', 'review_status'].includes(item.missingDataPoint))
          .map((item) => item.label),
        ...(params.blockedDecision ? [params.blockedDecision] : []),
      ]));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `IDRQ_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['quality_status', 'owner', 'committee_window', 'blocked_decision', 'review_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByQuality || blockedByReview) {
        blockingFindings.push({
          code: blockedByQuality ? 'IDRQ_QUALITY_STATUS_BLOCKING' : 'IDRQ_REVIEW_STATUS_BLOCKING',
          severity: 'high',
          message: 'quality or review status explicitly blocks investment data review readiness',
        });
      }
      const reviewContext = {
        sourceId: params.sourceId || null,
        dataPackageId: params.dataPackageId || null,
        assetRef: params.assetRef || null,
        projectRef: params.projectRef || null,
        qualityStatus: params.qualityStatus || null,
        division: params.division || null,
        bottleneckRef: params.bottleneckRef || null,
        owner: params.owner || null,
        committeeWindow: params.committeeWindow || null,
        blockedDecision: params.blockedDecision || null,
        reviewStatus: params.reviewStatus || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided review evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (sourceOrPackage) dossierFacts.push(`Source Package: ${sourceOrPackage}`);
      if (assetOrProjectRef) dossierFacts.push(`Asset/Project: ${assetOrProjectRef}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
      if (params.committeeWindow) dossierFacts.push(`Committee Window: ${params.committeeWindow}`);

      return {
        reviewQueueStatusId: `idrq:${Buffer.from(`${sourceOrPackage || ''}:${assetOrProjectRef || ''}:${params.owner || ''}:${params.committeeWindow || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'investment_data_review_queue',
        safety: 'read_only',
        requestContext: {
          sourceId: params.sourceId || null,
          dataPackageId: params.dataPackageId || null,
          assetRef: params.assetRef || null,
          projectRef: params.projectRef || null,
          owner: params.owner || null,
          committeeWindow: params.committeeWindow || null,
        },
        status,
        readinessScore,
        reviewContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.investmentDataReviewQueueStatus'],
          referenced: ['datasource-registry.list', 'datasource-cache.query', 'investment-planning.createPlan', 'hitl.summary', 'vdmi.dossier', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['hitl.create', 'vdmi.create', 'vdmi.mutate', 'investment-planning.createPlan', 'investment-planning.mutate', 'finance-agent.mutate', 'budget.release', 'billing.release', 'settlement.prepareBilling', 'tariff.mutate', 'payment.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          reviewContext,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildFlexStrategicDemandIntakeStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);
      const demandTopic = params.demandTopic || params.topic;
      const demandRef = params.demandId || params.caseId;
      const evidenceSpecs = [
        {
          id: 'demand_topic',
          label: 'Demand/topic',
          value: demandTopic,
          sourceClass: 'strategic_need',
          enablesDossierAddition: 'add a clear Flex/Fahrplanmanagement demand statement',
        },
        {
          id: 'affected_process',
          label: 'Affected process',
          value: params.affectedProcess,
          sourceClass: 'process_impact_scope',
          enablesDossierAddition: 'add the impacted process or operating area',
        },
        {
          id: 'risk_of_inaction',
          label: 'Risk of inaction',
          value: params.riskOfInaction,
          sourceClass: 'management_risk',
          enablesDossierAddition: 'add management risk rationale for not acting',
        },
        {
          id: 'commercial_question',
          label: 'Commercial question',
          value: params.commercialQuestion,
          sourceClass: 'commercial_review_need',
          enablesDossierAddition: 'add the commercial review question',
        },
        {
          id: 'resource_conflict',
          label: 'Resource conflict',
          value: params.resourceConflict,
          sourceClass: 'resource_tradeoff',
          enablesDossierAddition: 'add prioritization or resource trade-off',
        },
        {
          id: 'stop_doing_option',
          label: 'Stop-doing option',
          value: params.stopDoingOption,
          sourceClass: 'capacity_release_option',
          enablesDossierAddition: 'add capacity-release or stop-doing alternative',
        },
        {
          id: 'owner',
          label: 'Owner',
          value: params.owner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add accountable line owner',
        },
        {
          id: 'next_decision_gate',
          label: 'Next decision gate',
          value: params.nextDecisionGate,
          sourceClass: 'decision_calendar',
          enablesDossierAddition: 'add decision calendar or gate readiness',
        },
        {
          id: 'blocked_follow_up',
          label: 'Blocked follow-up',
          value: params.blockedFollowUp,
          sourceClass: 'blocked_follow_up',
          enablesDossierAddition: 'add the next unblockable action',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable Flex, ZNP, NOVA, Finance or VDMI references',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const riskText = String(params.riskOfInaction || '').toLowerCase();
      const conflictText = String(params.resourceConflict || '').toLowerCase();
      const blockedByRisk = /blocked|blockiert|kritisch|critical|untragbar|stop/.test(riskText);
      const blockedByResource = /blocked|blockiert|keine ressourcen|no resource|critical|kritisch/.test(conflictText);
      const status =
        blockedByRisk
          ? 'risk_blocks_intake'
          : blockedByResource
            ? 'resource_conflict_blocks_intake'
            : !demandTopic
              ? 'needs_demand_topic'
              : !params.affectedProcess
                ? 'needs_affected_process'
                : !params.riskOfInaction
                  ? 'needs_risk_of_inaction'
                  : !params.commercialQuestion
                    ? 'needs_commercial_question'
                    : !params.resourceConflict
                      ? 'needs_resource_conflict'
                      : !params.stopDoingOption
                        ? 'needs_stop_doing_option'
                        : !params.owner
                          ? 'needs_owner'
                          : !params.nextDecisionGate
                            ? 'needs_next_decision_gate'
                            : !params.blockedFollowUp
                              ? 'needs_blocked_follow_up'
                              : sourceRefs.length === 0
                                ? 'needs_source_refs'
                                : missingEvidence.length === 0
                                  ? 'ready_for_intake'
                                  : 'needs_intake_evidence';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'flex_strategic_demand_intake',
      }));
      const blockedDecisions = Array.from(new Set([
        ...missingEvidence
          .filter((item) => ['owner', 'next_decision_gate', 'blocked_follow_up', 'commercial_question', 'resource_conflict'].includes(item.missingDataPoint))
          .map((item) => item.label),
        ...(params.blockedFollowUp ? [params.blockedFollowUp] : []),
      ]));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `FSDI_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['owner', 'next_decision_gate', 'blocked_follow_up', 'risk_of_inaction'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (blockedByRisk || blockedByResource) {
        blockingFindings.push({
          code: blockedByRisk ? 'FSDI_RISK_BLOCKING' : 'FSDI_RESOURCE_CONFLICT_BLOCKING',
          severity: 'high',
          message: 'risk or resource conflict explicitly blocks strategic Flex intake readiness',
        });
      }
      const intakeContext = {
        demandId: demandRef || null,
        demandTopic: demandTopic || null,
        affectedProcess: params.affectedProcess || null,
        owner: params.owner || null,
        nextDecisionGate: params.nextDecisionGate || null,
      };
      const managementContext = {
        riskOfInaction: params.riskOfInaction || null,
        commercialQuestion: params.commercialQuestion || null,
        resourceConflict: params.resourceConflict || null,
        stopDoingOption: params.stopDoingOption || null,
        blockedFollowUp: params.blockedFollowUp || null,
      };
      const contextRefs = {
        flexContext: params.flexContext || null,
        znpContext: params.znpContext || null,
        novaContext: params.novaContext || null,
        financeContext: params.financeContext || null,
        vdmiContext: params.vdmiContext || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided intake evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (demandTopic) dossierFacts.push(`Demand: ${demandTopic}`);
      if (params.affectedProcess) dossierFacts.push(`Affected Process: ${params.affectedProcess}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);
      if (params.nextDecisionGate) dossierFacts.push(`Next Gate: ${params.nextDecisionGate}`);

      return {
        intakeStatusId: `fsdi:${Buffer.from(`${demandRef || ''}:${demandTopic || ''}:${params.owner || ''}:${params.nextDecisionGate || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'flex_strategic_demand_intake',
        safety: 'read_only',
        requestContext: intakeContext,
        status,
        readinessScore,
        intakeContext,
        managementContext,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockedDecisions,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
          contextRefs,
        },
        sourceRefs,
        contextRefs,
        sourceActions: {
          inspected: ['dashboard-api.flexStrategicDemandIntakeStatus'],
          referenced: ['flex.status', 'znp.projects', 'nova.pendingDecisions', 'vdmi.dossier', 'finance-agent.analyze', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['hitl.create', 'nova.createDecision', 'nova.apply', 'vdmi.create', 'vdmi.mutate', 'finance-agent.mutate', 'tariff.mutate', 'billing.release', 'settlement.prepareBilling', 'grid-operations.executeControl', 'device-control.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          intakeContext,
          managementContext,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockedDecisions,
          blockingFindings,
          sourceRefs,
          contextRefs,
          dossierFacts,
        },
      };
    },

    buildGasInfrastructureRiskGovernanceStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);
      const evidenceSpecs = [
        {
          id: 'technical_fact',
          label: 'Technical fact',
          value: params.technicalFact,
          sourceClass: 'technical_risk_fact',
          enablesDossierAddition: 'add the technical gas-infrastructure issue or finding',
        },
        {
          id: 'impact_area',
          label: 'Impact area',
          value: params.impactArea,
          sourceClass: 'asset_network_impact_scope',
          enablesDossierAddition: 'add the affected asset, network coupling point or transformation area',
        },
        {
          id: 'probability',
          label: 'Probability',
          value: params.probability,
          sourceClass: 'risk_rating_basis',
          enablesDossierAddition: 'add the likelihood or probability basis',
        },
        {
          id: 'criticality',
          label: 'Criticality',
          value: params.criticality,
          sourceClass: 'risk_impact_rating',
          enablesDossierAddition: 'add the impact/criticality rating',
        },
        {
          id: 'existing_mitigation',
          label: 'Existing mitigation',
          value: params.existingMitigation,
          sourceClass: 'mitigation_or_monitoring_basis',
          enablesDossierAddition: 'add current safeguards, monitoring or mitigation evidence',
        },
        {
          id: 'threshold',
          label: 'Risk-register threshold',
          value: params.threshold,
          sourceClass: 'formal_risk_threshold',
          enablesDossierAddition: 'add the threshold for formal risk-register handling',
        },
        {
          id: 'risk_register_decision',
          label: 'Risk-register decision',
          value: params.riskRegisterDecision,
          sourceClass: 'governance_decision_path',
          enablesDossierAddition: 'add whether the case is not aufgenommen, monitoring, Massnahme, or formal risk register',
        },
        {
          id: 'owner',
          label: 'Owner',
          value: params.owner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add accountable governance owner',
        },
        {
          id: 'next_decision_window',
          label: 'Next decision window',
          value: params.nextDecisionWindow,
          sourceClass: 'decision_calendar',
          enablesDossierAddition: 'add the next decision window or committee gate',
        },
        {
          id: 'blocked_follow_up',
          label: 'Blocked follow-up',
          value: params.blockedFollowUp,
          sourceClass: 'blocked_follow_up',
          enablesDossierAddition: 'add the next unblockable action',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable technical, VDMI, HITL or interface-placeholder references',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue || spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const decisionText = String(params.riskRegisterDecision || '').toLowerCase();
      const probabilityText = String(params.probability || '').toLowerCase();
      const criticalityText = String(params.criticality || '').toLowerCase();
      const isFormalRisk =
        /(formal|risk register|risikoregister|aufnahme|aufnehmen|register)/i.test(decisionText) &&
        !/(nicht.?aufnahme|not aufgenommen|not included|monitoring)/i.test(decisionText);
      const isMonitoring =
        /(monitoring|beobachtung|watch|ueberwachung|überwachung)/i.test(decisionText) ||
        /(hoch|high|kritisch|critical|rot|red)/i.test(`${probabilityText} ${criticalityText}`);
      const status =
        !params.technicalFact
          ? 'needs_technical_fact'
          : !params.impactArea
            ? 'needs_impact_area'
            : !params.probability
              ? 'needs_probability'
              : !params.criticality
                ? 'needs_criticality'
                : !params.existingMitigation
                  ? 'needs_mitigation_evidence'
                  : !params.threshold
                    ? 'needs_threshold'
                    : !params.riskRegisterDecision
                      ? 'needs_risk_register_decision'
                      : !params.owner
                        ? 'needs_owner'
                        : !params.nextDecisionWindow
                          ? 'needs_decision_window'
                          : !params.blockedFollowUp
                            ? 'needs_blocked_follow_up'
                            : sourceRefs.length === 0
                              ? 'needs_source_refs'
                              : isFormalRisk
                                ? 'ready_for_risk_decision'
                                : isMonitoring
                                  ? 'monitoring_needed'
                                  : 'ready_for_non_inclusion_decision';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'gas_infrastructure_risk_governance',
      }));
      const decisionBoundary = {
        readOnly: true,
        allowedDecisionStates: ['not_aufgenommen', 'monitoring', 'massnahme', 'formal_risk_register'],
        suppliedDecision: params.riskRegisterDecision || null,
        note: 'Status evidence only; formal gas risk-register, monitoring and mitigation decisions remain downstream governance actions.',
      };
      const blockingFindings = missingEvidence.map((item) => ({
        code: `GIRG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['technical_fact', 'impact_area', 'threshold', 'risk_register_decision', 'owner'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      const riskContext = {
        caseId: params.caseId || null,
        technicalFact: params.technicalFact || null,
        impactArea: params.impactArea || null,
        owner: params.owner || null,
        nextDecisionWindow: params.nextDecisionWindow || null,
      };
      const riskEvidence = {
        probability: params.probability || null,
        criticality: params.criticality || null,
        existingMitigation: params.existingMitigation || null,
        threshold: params.threshold || null,
        riskRegisterDecision: params.riskRegisterDecision || null,
        blockedFollowUp: params.blockedFollowUp || null,
      };
      const contextRefs = {
        vdmiContext: params.vdmiContext || null,
        hitlContext: params.hitlContext || null,
        interfacePlaceholderContext: params.interfacePlaceholderContext || null,
        assetContext: params.assetContext || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided gas risk evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.technicalFact) dossierFacts.push(`Technical Fact: ${params.technicalFact}`);
      if (params.impactArea) dossierFacts.push(`Impact Area: ${params.impactArea}`);
      if (params.riskRegisterDecision) dossierFacts.push(`Risk Decision: ${params.riskRegisterDecision}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

      return {
        gasRiskGovernanceStatusId: `girg:${Buffer.from(`${params.caseId || ''}:${params.technicalFact || ''}:${params.owner || ''}:${params.nextDecisionWindow || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'gas_infrastructure_risk_governance',
        safety: 'read_only',
        requestContext: riskContext,
        status,
        readinessScore,
        riskContext,
        riskEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        decisionBoundary,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
          contextRefs,
        },
        sourceRefs,
        contextRefs,
        sourceActions: {
          inspected: ['dashboard-api.gasInfrastructureRiskGovernanceStatus'],
          referenced: ['vdmi.dossier', 'hitl.summary', 'interface-placeholder.requestEvidence', 'assets.effective', 'grid-operations.summary', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['gas-risk-register.create', 'gas-risk-register.mutate', 'hitl.create', 'vdmi.create', 'vdmi.mutate', 'assets.mutate', 'asset-mdm.mutate', 'grid-operations.executeControl', 'operational-dispatch.execute', 'monitoring.createDecision', 'mitigation.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          riskContext,
          riskEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          decisionBoundary,
          blockingFindings,
          sourceRefs,
          contextRefs,
          dossierFacts,
        },
      };
    },

    buildMeteringRolloutProcessIndicatorStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const toNumber = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const sourceRefs = toList(params.sourceRef);
      const targetCount = toNumber(params.targetCount);
      const actualCount = toNumber(params.actualCount);
      const suppliedBacklog = toNumber(params.backlogCount);
      const backlogCount = suppliedBacklog ?? (
        targetCount !== null && actualCount !== null
          ? Math.max(0, targetCount - actualCount)
          : null
      );
      const backlogRate = targetCount && targetCount > 0 && backlogCount !== null
        ? Number((backlogCount / targetCount).toFixed(4))
        : null;
      const capexImpactEur = toNumber(params.capexImpactEur);
      const opexImpactEur = toNumber(params.opexImpactEur);
      const evidenceSpecs = [
        {
          id: 'division',
          label: 'Division',
          value: params.division,
          sourceClass: 'metering_division_scope',
          enablesDossierAddition: 'add the affected utility division or metering scope',
        },
        {
          id: 'source_type',
          label: 'Source type',
          value: params.sourceType,
          sourceClass: 'source_classification',
          enablesDossierAddition: 'add whether evidence comes from administrative rollout statistics, EDM summary or datasource cache',
        },
        {
          id: 'target_count',
          label: 'Target count',
          value: targetCount !== null,
          displayValue: targetCount,
          sourceClass: 'planned_rollout_volume',
          enablesDossierAddition: 'add Soll count for rollout or meter-change variance',
        },
        {
          id: 'actual_count',
          label: 'Actual count',
          value: actualCount !== null,
          displayValue: actualCount,
          sourceClass: 'actual_rollout_volume',
          enablesDossierAddition: 'add Ist count for rollout progress evidence',
        },
        {
          id: 'backlog_count',
          label: 'Backlog count',
          value: backlogCount !== null,
          displayValue: backlogCount,
          sourceClass: 'process_backlog_indicator',
          enablesDossierAddition: 'add backlog count or derivable Soll/Ist delta',
        },
        {
          id: 'data_quality_status',
          label: 'Data-quality status',
          value: params.dataQualityStatus,
          sourceClass: 'data_quality_risk',
          enablesDossierAddition: 'add data-quality risk assessment',
        },
        {
          id: 'contractor_load',
          label: 'Contractor load',
          value: params.contractorLoad,
          sourceClass: 'contractor_capacity_signal',
          enablesDossierAddition: 'add Dienstleisterlast or capacity bottleneck evidence',
        },
        {
          id: 'capex_impact',
          label: 'CAPEX impact',
          value: capexImpactEur !== null,
          displayValue: capexImpactEur,
          sourceClass: 'capex_impact_hint',
          enablesDossierAddition: 'add CAPEX indication for investment steering',
        },
        {
          id: 'opex_impact',
          label: 'OPEX impact',
          value: opexImpactEur !== null,
          displayValue: opexImpactEur,
          sourceClass: 'opex_impact_hint',
          enablesDossierAddition: 'add OPEX indication for operational steering',
        },
        {
          id: 'owner',
          label: 'Owner',
          value: params.owner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add accountable process owner',
        },
        {
          id: 'next_control_step',
          label: 'Next control step',
          value: params.nextControlStep,
          sourceClass: 'next_steering_step',
          enablesDossierAddition: 'add the next steering or review step',
        },
        {
          id: 'blocked_follow_up',
          label: 'Blocked follow-up',
          value: params.blockedFollowUp,
          sourceClass: 'blocked_follow_up',
          enablesDossierAddition: 'add the downstream decision blocked by missing rollout evidence',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable datasource, EDM, VDMI or monthly-statistic references',
        },
      ];
      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));
      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));
      const qualityText = String(params.dataQualityStatus || '').toLowerCase();
      const contractorText = String(params.contractorLoad || '').toLowerCase();
      const qualityBlocks = /blocked|blockiert|kritisch|critical|missing|fehlt|unvollstaendig|unvollständig/.test(qualityText);
      const contractorBlocks = /blocked|blockiert|ueberlast|überlast|overload|kritisch|critical/.test(contractorText);
      const highBacklog = backlogRate !== null && backlogRate >= 0.2;
      const status =
        qualityBlocks
          ? 'blocked_by_data_quality'
          : contractorBlocks
            ? 'blocked_by_contractor_capacity'
            : !params.division
              ? 'needs_division'
              : !params.sourceType
                ? 'needs_source_type'
                : targetCount === null
                  ? 'needs_target_count'
                  : actualCount === null
                    ? 'needs_actual_count'
                    : backlogCount === null
                      ? 'needs_backlog_count'
                      : !params.dataQualityStatus
                        ? 'needs_data_quality_status'
                        : !params.contractorLoad
                          ? 'needs_contractor_load'
                          : capexImpactEur === null
                            ? 'needs_capex_impact'
                            : opexImpactEur === null
                              ? 'needs_opex_impact'
                              : !params.owner
                                ? 'needs_owner'
                                : !params.nextControlStep
                                  ? 'needs_next_control_step'
                                  : !params.blockedFollowUp
                                    ? 'needs_blocked_follow_up'
                                    : sourceRefs.length === 0
                                      ? 'needs_source_refs'
                                      : highBacklog
                                        ? 'backlog_requires_steering'
                                        : 'process_indicator_ready';
      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'metering_rollout_process_indicator',
      }));
      const blockingFindings = missingEvidence.map((item) => ({
        code: `MRPI_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['division', 'target_count', 'actual_count', 'data_quality_status', 'owner', 'next_control_step'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));
      if (qualityBlocks || contractorBlocks || highBacklog) {
        blockingFindings.push({
          code: qualityBlocks
            ? 'MRPI_DATA_QUALITY_BLOCKING'
            : contractorBlocks
              ? 'MRPI_CONTRACTOR_CAPACITY_BLOCKING'
              : 'MRPI_BACKLOG_THRESHOLD_REACHED',
          severity: 'high',
          message: 'metering rollout evidence indicates a steering-relevant data-quality, contractor-capacity or backlog condition',
        });
      }
      const indicatorContext = {
        indicatorId: params.indicatorId || null,
        division: params.division || null,
        sourceType: params.sourceType || null,
        owner: params.owner || null,
        nextControlStep: params.nextControlStep || null,
      };
      const processEvidence = {
        targetCount,
        actualCount,
        backlogCount,
        backlogRate,
        dataQualityStatus: params.dataQualityStatus || null,
        contractorLoad: params.contractorLoad || null,
        capexImpactEur,
        opexImpactEur,
        blockedFollowUp: params.blockedFollowUp || null,
      };
      const dossierFacts = [
        `Status: ${status}`,
        `Provided metering rollout evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.division) dossierFacts.push(`Division: ${params.division}`);
      if (params.sourceType) dossierFacts.push(`Source Type: ${params.sourceType}`);
      if (backlogRate !== null) dossierFacts.push(`Backlog Rate: ${backlogRate}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

      return {
        processIndicatorStatusId: `mrpi:${Buffer.from(`${params.indicatorId || ''}:${params.division || ''}:${params.sourceType || ''}:${params.owner || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'metering_rollout_process_indicator',
        safety: 'read_only',
        requestContext: indicatorContext,
        status,
        readinessScore,
        indicatorContext,
        processEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.meteringRolloutProcessIndicatorStatus'],
          referenced: ['datasource-registry.list', 'datasource-cache.query', 'edm.getTimeseriesSummary', 'in-memory-join.join', 'vdmi.dossier', 'hitl.summary', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['datasource-registry.refresh', 'datasource-cache.refresh', 'datasource-cache.query', 'edm.importTimeseries', 'edm.mutate', 'in-memory-join.execute', 'hitl.create', 'vdmi.create', 'vdmi.mutate', 'finance-agent.mutate', 'capex.decision', 'billing.release', 'settlement.prepareBilling', 'tariff.mutate', 'device-control.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          indicatorContext,
          processEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildHeatTransformationLineAssetModelStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const toNumber = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const sourceRefs = toList(params.sourceRef);
      const connectedPointAssetIds = toList(params.connectedPointAssetIds);
      const investmentNeed = toNumber(params.investmentNeed);

      const evidenceSpecs = [
        {
          id: 'division',
          label: 'Division',
          value: params.division,
          sourceClass: 'heat_division_scope',
          enablesDossierAddition: 'add the affected utility division scope (defaults to Wärme)',
        },
        {
          id: 'line_asset_id',
          label: 'Line Asset ID',
          value: params.lineAssetId,
          sourceClass: 'line_segment_classification',
          enablesDossierAddition: 'add the specific line segment or pipe identifier',
        },
        {
          id: 'geometry_ref',
          label: 'Geometry reference',
          value: params.geometryRef,
          sourceClass: 'gis_geometry_reference',
          enablesDossierAddition: 'add the geographic line coordinate boundary or GIS path reference',
        },
        {
          id: 'connected_point_asset_ids',
          label: 'Connected point assets',
          value: connectedPointAssetIds.length > 0,
          displayValue: connectedPointAssetIds.join(', '),
          sourceClass: 'topological_point_assets',
          enablesDossierAddition: 'add the topological point-asset connections (e.g. transformers or heating plants)',
        },
        {
          id: 'network_calculation_ref',
          label: 'Network calculation reference',
          value: params.networkCalculationRef,
          sourceClass: 'network_calculation_reference',
          enablesDossierAddition: 'add the hydraulic or thermodynamic network calculation reference',
        },
        {
          id: 'data_quality_status',
          label: 'Data-quality status',
          value: params.dataQualityStatus,
          sourceClass: 'data_quality_risk',
          enablesDossierAddition: 'add the GIS and asset data-quality risk assessment',
        },
        {
          id: 'transformation_status',
          label: 'Transformation status',
          value: params.transformationStatus,
          sourceClass: 'transformation_scenario_status',
          enablesDossierAddition: 'add the strategic Heat/Gas transformation option or status',
        },
        {
          id: 'future_option',
          label: 'Future option',
          value: params.futureOption,
          sourceClass: 'future_technology_option',
          enablesDossierAddition: 'add the specific future technology option (H2-ready vs district-heating network)',
        },
        {
          id: 'investment_need',
          label: 'Investment need',
          value: investmentNeed !== null,
          displayValue: investmentNeed,
          sourceClass: 'investment_need_indicator',
          enablesDossierAddition: 'add the indicative investment need in EUR or reference',
        },
        {
          id: 'owner',
          label: 'Owner',
          value: params.owner,
          sourceClass: 'accountable_owner',
          enablesDossierAddition: 'add the accountable asset manager or owner division',
        },
        {
          id: 'next_decision',
          label: 'Next decision',
          value: params.nextDecision,
          sourceClass: 'next_decision_gate',
          enablesDossierAddition: 'add the next decision gate or strategic window',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add the citable source references or GIS provenance',
        },
      ];

      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));

      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));

      const qualityText = String(params.dataQualityStatus || '').toLowerCase();
      const qualityBlocks = /blocked|blockiert|kritisch|critical|missing|fehlt|unvollstaendig|unvollständig/.test(qualityText);

      const status =
        qualityBlocks
          ? 'blocked_by_data_quality'
          : !params.division
            ? 'needs_division'
            : !params.lineAssetId
              ? 'needs_line_asset_id'
              : !params.geometryRef
                ? 'needs_geometry_ref'
                : connectedPointAssetIds.length === 0
                  ? 'needs_connected_point_asset_ids'
                  : !params.networkCalculationRef
                    ? 'needs_network_calculation_ref'
                    : !params.dataQualityStatus
                      ? 'needs_data_quality_status'
                      : !params.transformationStatus
                        ? 'needs_transformation_status'
                        : !params.futureOption
                          ? 'needs_future_option'
                          : investmentNeed === null
                            ? 'needs_investment_need'
                            : !params.owner
                              ? 'needs_owner'
                              : !params.nextDecision
                                ? 'needs_next_decision'
                                : sourceRefs.length === 0
                                  ? 'needs_source_refs'
                                  : 'ready_for_transformation_decision';

      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'heat_transformation_line_asset_model',
      }));

      const blockingFindings = missingEvidence.map((item) => ({
        code: `HTLAM_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['division', 'line_asset_id', 'geometry_ref', 'data_quality_status', 'owner', 'next_decision'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));

      if (qualityBlocks) {
        blockingFindings.push({
          code: 'HTLAM_DATA_QUALITY_BLOCKING',
          severity: 'high',
          message: 'heat transformation line-asset evidence indicates a steering-relevant data-quality condition',
        });
      }

      const modelContext = {
        lineAssetId: params.lineAssetId || null,
        division: params.division || null,
        owner: params.owner || null,
        nextDecision: params.nextDecision || null,
      };

      const lineEvidence = {
        geometryRef: params.geometryRef || null,
        connectedPointAssetIds,
        networkCalculationRef: params.networkCalculationRef || null,
        dataQualityStatus: params.dataQualityStatus || null,
        transformationStatus: params.transformationStatus || null,
        futureOption: params.futureOption || null,
        investmentNeed,
      };

      const dossierFacts = [
        `Status: ${status}`,
        `Provided heat transformation line-asset evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.division) dossierFacts.push(`Division: ${params.division}`);
      if (params.lineAssetId) dossierFacts.push(`Line Asset ID: ${params.lineAssetId}`);
      if (params.owner) dossierFacts.push(`Owner: ${params.owner}`);

      return {
        lineAssetModelStatusId: `htlam:${Buffer.from(`${params.lineAssetId || ''}:${params.division || ''}:${params.owner || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'heat_transformation_line_asset_model',
        safety: 'read_only',
        requestContext: modelContext,
        status,
        readinessScore,
        modelContext,
        lineEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.heatTransformationLineAssetModelStatus'],
          referenced: ['znp.listProjects', 'znp.getProjectAssets', 'assets.effective', 'datapoint.health', 'finance-agent.analyze', 'investment-planning.createPlan', 'vdmi.dossier', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['znp.createProject', 'znp.addLayer0', 'znp.addAssumption', 'assets.mutate', 'datapoint.mutate', 'hitl.create', 'vdmi.create', 'vdmi.mutate', 'finance-agent.mutate', 'investment-planning.createPlan', 'billing.release', 'settlement.prepareBilling', 'tariff.mutate', 'device-control.execute', 'external.connector.call', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          modelContext,
          lineEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildKiFloorwalkerGovernanceStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);
      const allowedDataspaces = toList(params.allowedDataspaces);

      const evidenceSpecs = [
        {
          id: 'use_case_priority',
          label: 'Use-case priority',
          value: params.useCasePriority,
          sourceClass: 'use_case_priority',
          enablesDossierAddition: 'add the prioritized use-case status or strategic value tier',
        },
        {
          id: 'allowed_dataspaces',
          label: 'Allowed data spaces',
          value: allowedDataspaces.length > 0,
          displayValue: allowedDataspaces.join(', '),
          sourceClass: 'allowed_data_spaces',
          enablesDossierAddition: 'add the list of cleared and compliant enterprise data spaces',
        },
        {
          id: 'prompt_standards',
          label: 'Prompt standards',
          value: params.promptStandards,
          sourceClass: 'prompt_standards',
          enablesDossierAddition: 'add the validated prompt patterns or prompt templates',
        },
        {
          id: 'process_boundaries',
          label: 'Process boundaries',
          value: params.processBoundaries,
          sourceClass: 'process_boundaries',
          enablesDossierAddition: 'add the operational process boundaries or scope limits',
        },
        {
          id: 'roles_and_responsibilities',
          label: 'Roles & responsibilities',
          value: params.rolesAndResponsibilities,
          sourceClass: 'roles_and_responsibilities',
          enablesDossierAddition: 'add the accountable owners, governance coordinators, or release authorities',
        },
        {
          id: 'guided_application',
          label: 'Guided application',
          value: params.guidedApplication,
          sourceClass: 'guided_application',
          enablesDossierAddition: 'add the structured user enablement, training, or operating-model guidance',
        },
        {
          id: 'risk_and_approval_status',
          label: 'Risk & approval status',
          value: params.riskAndApprovalStatus,
          sourceClass: 'risk_and_approval_status',
          enablesDossierAddition: 'add the regulatory risk classification (e.g. EU AI Act conformity) and approval status',
        },
        {
          id: 'proof_of_benefit',
          label: 'Proof of benefit',
          value: params.proofOfBenefit,
          sourceClass: 'proof_of_benefit',
          enablesDossierAddition: 'add the strategic benefit metrics, KPIs, or productivity gains proof',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add the citable source references or grounding evidence',
        },
      ];

      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));

      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));

      const status =
        !params.useCaseId
          ? 'needs_use_case_id'
          : !params.processOwner
            ? 'needs_process_owner'
            : !params.useCasePriority
              ? 'needs_use_case_priority'
              : allowedDataspaces.length === 0
                ? 'needs_allowed_dataspaces'
                : !params.promptStandards
                  ? 'needs_prompt_standards'
                  : !params.processBoundaries
                    ? 'needs_process_boundaries'
                    : !params.rolesAndResponsibilities
                      ? 'needs_roles_and_responsibilities'
                      : !params.guidedApplication
                        ? 'needs_guided_application'
                        : !params.riskAndApprovalStatus
                          ? 'needs_risk_and_approval_status'
                          : !params.proofOfBenefit
                            ? 'needs_proof_of_benefit'
                            : sourceRefs.length === 0
                              ? 'needs_source_refs'
                              : 'ready_for_floorwalker_application';

      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'ki_floorwalker_governance',
      }));

      const blockingFindings = missingEvidence.map((item) => ({
        code: `KIFG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['use_case_priority', 'allowed_dataspaces', 'roles_and_responsibilities', 'risk_and_approval_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));

      const governanceContext = {
        useCaseId: params.useCaseId || null,
        processOwner: params.processOwner || null,
      };

      const governanceEvidence = {
        useCasePriority: params.useCasePriority || null,
        allowedDataspaces,
        promptStandards: params.promptStandards || null,
        processBoundaries: params.processBoundaries || null,
        rolesAndResponsibilities: params.rolesAndResponsibilities || null,
        guidedApplication: params.guidedApplication || null,
        riskAndApprovalStatus: params.riskAndApprovalStatus || null,
        proofOfBenefit: params.proofOfBenefit || null,
      };

      const dossierFacts = [
        `Status: ${status}`,
        `Provided KI floorwalker evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.useCaseId) dossierFacts.push(`Use Case ID: ${params.useCaseId}`);
      if (params.processOwner) dossierFacts.push(`Process Owner: ${params.processOwner}`);

      return {
        kiFloorwalkerGovernanceStatusId: `kifg:${Buffer.from(`${params.useCaseId || ''}:${params.processOwner || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'ki_floorwalker_governance',
        safety: 'read_only',
        requestContext: governanceContext,
        status,
        readinessScore,
        governanceContext,
        governanceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.kiFloorwalkerGovernanceStatus'],
          referenced: ['personal-agent.chat', 'cya.generate', 'vdmi.dossier', 'datapoint.oemetadata', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: ['openai.call', 'hitl.create', 'vdmi.mutate', 'personal-agent.execute'],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          governanceContext,
          governanceEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildInvestmentWaterfallGovernanceStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);

      const evidenceSpecs = [
        {
          id: 'budget_amount',
          label: 'Strategic budget allocation',
          value: params.budgetAmount,
          sourceClass: 'budget_allocation',
          enablesDossierAddition: 'add the strategic budget allocation and multi-year investment volume',
        },
        {
          id: 'bottleneck_ref',
          label: 'Bottleneck relation',
          value: params.bottleneckRef,
          sourceClass: 'bottleneck_relation',
          enablesDossierAddition: 'add the related grid bottleneck reference or infrastructure risk',
        },
        {
          id: 'committee_window',
          label: 'Committee calendar window',
          value: params.committeeWindow,
          sourceClass: 'committee_calendar_slot',
          enablesDossierAddition: 'add the target committee window or decision calendar slot',
        },
        {
          id: 'evidence_readiness',
          label: 'Evidence readiness',
          value: params.evidenceReadiness,
          sourceClass: 'committee_readiness',
          enablesDossierAddition: 'add the required evidentiary documents or milestone clearances',
        },
        {
          id: 'owner',
          label: 'Accountable owner',
          value: params.owner,
          sourceClass: 'strategic_responsibility',
          enablesDossierAddition: 'add the accountable owner or executive sponsor',
        },
        {
          id: 'next_action',
          label: 'Next action',
          value: params.nextAction,
          sourceClass: 'next_operational_step',
          enablesDossierAddition: 'add the planned next operational step or follow-up task',
        },
        {
          id: 'mandate_status',
          label: 'Mandate status',
          value: params.mandateStatus,
          sourceClass: 'management_mandate',
          enablesDossierAddition: 'add the required management mandate or corporate authorization',
        },
        {
          id: 'risk_if_delayed',
          label: 'Risk if delayed',
          value: params.riskIfDelayed,
          sourceClass: 'delay_risk_analysis',
          enablesDossierAddition: 'add the strategic or regulatory risk if the decision is delayed',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add the citable source references or grounding evidence',
        },
      ];

      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));

      const missingEvidence = evidenceSpecs
        .filter((spec) => !spec.value)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));

      const status =
        !params.investmentItemId
          ? 'needs_investment_item_id'
          : !params.budgetAmount
            ? 'needs_budget_amount'
            : !params.bottleneckRef
              ? 'needs_bottleneck_ref'
              : !params.committeeWindow
                ? 'needs_committee_window'
                : !params.evidenceReadiness
                  ? 'needs_evidence_readiness'
                  : !params.owner
                    ? 'needs_owner'
                    : !params.nextAction
                      ? 'needs_next_action'
                      : !params.mandateStatus
                        ? 'needs_mandate_status'
                        : !params.riskIfDelayed
                          ? 'needs_risk_if_delayed'
                          : sourceRefs.length === 0
                            ? 'needs_source_refs'
                            : 'ready_for_committee_decision';

      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'investment_waterfall_governance',
      }));

      const blockingFindings = missingEvidence.map((item) => ({
        code: `IWG_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['budget_amount', 'committee_window', 'owner', 'mandate_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));

      const governanceContext = {
        investmentItemId: params.investmentItemId || null,
        targetProcess: params.targetProcess || null,
      };

      const governanceEvidence = {
        budgetAmount: params.budgetAmount || null,
        bottleneckRef: params.bottleneckRef || null,
        committeeWindow: params.committeeWindow || null,
        evidenceReadiness: params.evidenceReadiness || null,
        owner: params.owner || null,
        nextAction: params.nextAction || null,
        mandateStatus: params.mandateStatus || null,
        riskIfDelayed: params.riskIfDelayed || null,
      };

      const dossierFacts = [
        `Status: ${status}`,
        `Provided investment waterfall governance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.investmentItemId) dossierFacts.push(`Investment Item ID: ${params.investmentItemId}`);
      if (params.targetProcess) dossierFacts.push(`Target Process: ${params.targetProcess}`);

      return {
        investmentWaterfallGovernanceStatusId: `iwg:${Buffer.from(`${params.investmentItemId || ''}:${params.targetProcess || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'investment_waterfall_governance',
        safety: 'read_only',
        requestContext: governanceContext,
        status,
        readinessScore,
        governanceContext,
        governanceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.investmentWaterfallGovernanceStatus'],
          referenced: ['personal-agent.chat', 'cya.generate', 'vdmi.dossier', 'datapoint.oemetadata', 'evidence-registry.lookup', 'presentation.generate'],
          notCalled: [
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
            'personal-agent.execute'
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          governanceContext,
          governanceEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildCapacityContractRiskAssetCockpitStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);

      const evidenceSpecs = [
        {
          id: 'utilization',
          label: 'Netzauslastung',
          value: typeof params.utilization === 'number' ? params.utilization : params.utilization !== undefined && params.utilization !== null && params.utilization !== '' ? Number(params.utilization) : null,
          sourceClass: 'capacity_utilization_check',
          enablesDossierAddition: 'verify the technical capacity utilization or load profile',
        },
        {
          id: 'bottleneck',
          label: 'Engpass-Situation',
          value: params.bottleneck,
          sourceClass: 'grid_bottleneck_tracking',
          enablesDossierAddition: 'identify grid bottlenecks or network constraints',
        },
        {
          id: 'contract_status',
          label: 'Vertragsstatus',
          value: params.contractStatus,
          sourceClass: 'contract_agreement_verification',
          enablesDossierAddition: 'verify contract status or connection agreements',
        },
        {
          id: 'legal_status',
          label: 'Regulatorischer Legal-Status',
          value: params.legalStatus,
          sourceClass: 'legal_compliance_audit',
          enablesDossierAddition: 'verify legal or regulatory compliance status',
        },
        {
          id: 'capex',
          label: 'CAPEX Investitionsoption',
          value: typeof params.capex === 'number' ? params.capex : params.capex !== undefined && params.capex !== null && params.capex !== '' ? Number(params.capex) : null,
          sourceClass: 'financial_capex_specification',
          enablesDossierAddition: 'specify capex requirements or project budget',
        },
        {
          id: 'opex',
          label: 'OPEX Betriebskosten',
          value: typeof params.opex === 'number' ? params.opex : params.opex !== undefined && params.opex !== null && params.opex !== '' ? Number(params.opex) : null,
          sourceClass: 'financial_opex_estimation',
          enablesDossierAddition: 'specify opex or recurring network charges',
        },
        {
          id: 'owner',
          label: 'Accountable Owner',
          value: params.owner,
          sourceClass: 'accountable_owner_assignment',
          enablesDossierAddition: 'add the accountable owner or process sponsor role',
        },
        {
          id: 'next_action',
          label: 'Next Action',
          value: params.nextAction,
          sourceClass: 'risk_mitigation_planning',
          enablesDossierAddition: 'add planned next action or risk mitigation',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable regulatory or technical source grounding',
        },
      ];

      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false && spec.value !== '')
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));

      const missingEvidence = evidenceSpecs
        .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false || spec.value === '')
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));

      // Determine statuses and riskLevel
      let riskLevel = 'low';
      let decisionStatus = 'approve';

      const ut = typeof params.utilization === 'number' ? params.utilization : params.utilization !== undefined && params.utilization !== null && params.utilization !== '' ? Number(params.utilization) : null;
      const bn = params.bottleneck;
      const cs = params.contractStatus;
      const ls = params.legalStatus;
      const cx = typeof params.capex === 'number' ? params.capex : params.capex !== undefined && params.capex !== null && params.capex !== '' ? Number(params.capex) : null;

      if (ut !== null) {
        if (ut > 1.2) {
          riskLevel = 'critical';
          decisionStatus = 'reject_or_escalate';
        } else if (ut > 1.0) {
          riskLevel = 'high';
          decisionStatus = 'approve_conditionally';
        } else if (ut > 0.8) {
          riskLevel = 'medium';
          decisionStatus = 'approve_conditionally';
        }
      }

      if (bn && /overload|congested|critical|blocking/i.test(bn)) {
        riskLevel = 'critical';
        decisionStatus = 'reject_or_escalate';
      } else if (bn && /warn|congest/i.test(bn) && decisionStatus !== 'reject_or_escalate') {
        riskLevel = 'high';
        decisionStatus = 'approve_conditionally';
      }

      if (cs && /clarification|dispute|missing/i.test(cs)) {
        decisionStatus = 'needs_contract_clarification';
        if (riskLevel === 'low') riskLevel = 'medium';
      }

      if (ls && /non-compliant|dispute|invalid/i.test(ls)) {
        decisionStatus = 'needs_legal_clarification';
        riskLevel = 'high';
      }

      if (cx !== null && cx > 500000 && decisionStatus === 'approve') {
        decisionStatus = 'needs_investment_decision';
        riskLevel = 'medium';
      }

      const status =
        !params.gridOperatorId
          ? 'needs_grid_operator_id'
          : ut === null
            ? 'needs_utilization'
            : !bn
              ? 'needs_bottleneck'
              : !cs
                ? 'needs_contract_status'
                : !ls
                  ? 'needs_legal_status'
                  : cx === null
                    ? 'needs_capex'
                    : typeof params.opex !== 'number' && (params.opex === undefined || params.opex === null || params.opex === '')
                      ? 'needs_opex'
                      : !params.owner
                        ? 'needs_owner'
                        : !params.nextAction
                          ? 'needs_next_action'
                          : sourceRefs.length === 0
                            ? 'needs_source_refs'
                            : decisionStatus === 'approve'
                              ? 'ready_with_no_risk'
                              : 'ready_with_risk_findings';

      // If there are missing fields, the overall decisionStatus might be forced to "needs_evidence"
      const finalDecisionStatus = missingEvidence.length > 0 ? 'needs_evidence' : decisionStatus;

      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const complianceScore = readinessScore;

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'capacity_contract_risk_asset_cockpit',
      }));

      const blockingFindings = missingEvidence.map((item) => ({
        code: `CCRC_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['utilization', 'bottleneck', 'contract_status', 'legal_status'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));

      const complianceContext = {
        gridOperatorId: params.gridOperatorId || null,
      };

      const complianceEvidence = {
        utilization: ut,
        bottleneck: bn || null,
        firmCapacityKW: typeof params.firmCapacityKW === 'number' ? params.firmCapacityKW : params.firmCapacityKW ? Number(params.firmCapacityKW) : null,
        flexibleCapacityKW: typeof params.flexibleCapacityKW === 'number' ? params.flexibleCapacityKW : params.flexibleCapacityKW ? Number(params.flexibleCapacityKW) : null,
        contractStatus: cs || null,
        legalStatus: ls || null,
        altvereinbarung: typeof params.altvereinbarung === 'boolean' ? params.altvereinbarung : params.altvereinbarung ? String(params.altvereinbarung) === 'true' : null,
        capex: cx,
        opex: typeof params.opex === 'number' ? params.opex : params.opex ? Number(params.opex) : null,
        owner: params.owner || null,
        nextAction: params.nextAction || null,
      };

      const technicalCapacity = {
        utilization: ut,
        bottleneck: bn || null,
        firmCapacityKW: complianceEvidence.firmCapacityKW,
        flexibleCapacityKW: complianceEvidence.flexibleCapacityKW,
      };

      const contractBoundary = {
        status: cs || null,
        legalStatus: ls || null,
        altvereinbarung: complianceEvidence.altvereinbarung,
      };

      const financialImpact = {
        capex: cx,
        opex: complianceEvidence.opex,
        priority: params.priority || null,
      };

      const dossierFacts = [
        `Status: ${status}`,
        `Provided capacity and contract risk evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];

      return {
        capacityContractRiskId: `ccrc:${Buffer.from(`${params.gridOperatorId || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'capacity_contract_risk_asset_cockpit',
        safety: 'read_only',
        requestContext: complianceContext,
        status,
        readinessScore,
        riskLevel,
        decisionStatus: finalDecisionStatus,
        technicalCapacity,
        contractBoundary,
        financialImpact,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.capacityContractRiskAssetCockpitStatus'],
          referenced: [
            'grid-operations.connectionCapacityCheck',
            'grid-operations.capacityUtilization',
            'grid-operations.netzfahrplanGenerate',
            'grid-connection.validate',
            'finance-agent.fnavEconomics',
            'finance-agent.analyze',
            'investment-planning.createPlan',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence',
            'hitl.create',
          ],
          notCalled: [
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
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          riskLevel,
          decisionStatus: finalDecisionStatus,
          technicalCapacity,
          contractBoundary,
          financialImpact,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildImsysTaf2ComplianceStatus(params = {}) {
      const toList = (value) => Array.isArray(value)
        ? value.filter(Boolean)
        : value
          ? String(value).split(',').map((item) => item.trim()).filter(Boolean)
          : [];
      const sourceRefs = toList(params.sourceRef);

      const evidenceSpecs = [
        {
          id: 'taf2_obligation',
          label: 'TAF2 Obligation',
          value: typeof params.taf2Obligation === 'boolean' ? params.taf2Obligation : params.taf2Obligation ? String(params.taf2Obligation) === 'true' : null,
          sourceClass: 'taf2_obligation_verification',
          enablesDossierAddition: 'verify the TAF-2 legal requirement or rollout obligation',
        },
        {
          id: 'target_deadline',
          label: 'Target Deadline',
          value: params.targetDeadline,
          sourceClass: 'taf2_deadline_tracking',
          enablesDossierAddition: 'add the target installation deadline for TAF-2 compliance',
        },
        {
          id: 'tariff_model',
          label: 'Tariff Model',
          value: params.tariffModel,
          sourceClass: 'tariff_model_specification',
          enablesDossierAddition: 'specify the applicable variable or static tariff model',
        },
        {
          id: 'implementation_status',
          label: 'Implementation Status',
          value: params.implementationStatus,
          sourceClass: 'taf2_rollout_milestone',
          enablesDossierAddition: 'add the hardware rollout implementation status',
        },
        {
          id: 'measured_value_access',
          label: 'Measured Value Access',
          value: params.measuredValueAccess,
          sourceClass: 'taf2_access_verification',
          enablesDossierAddition: 'verify the secure measured value access or data communication route',
        },
        {
          id: 'owner',
          label: 'Accountable Owner',
          value: params.owner,
          sourceClass: 'compliance_responsibility',
          enablesDossierAddition: 'add the accountable owner or process sponsor role',
        },
        {
          id: 'next_action',
          label: 'Next Action',
          value: params.nextAction,
          sourceClass: 'next_compliance_step',
          enablesDossierAddition: 'add the planned next action or mitigation step',
        },
        {
          id: 'source_refs',
          label: 'Source references',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add citable regulatory source references or grounding evidence',
        },
      ];

      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));

      const missingEvidence = evidenceSpecs
        .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));

      const status =
        !params.meteringPointId
          ? 'needs_metering_point_id'
          : (params.taf2Obligation === undefined || params.taf2Obligation === null)
            ? 'needs_taf2_obligation'
            : !params.targetDeadline
              ? 'needs_target_deadline'
              : !params.tariffModel
                ? 'needs_tariff_model'
                : !params.implementationStatus
                  ? 'needs_implementation_status'
                  : !params.measuredValueAccess
                    ? 'needs_measured_value_access'
                    : !params.owner
                      ? 'needs_owner'
                      : !params.nextAction
                        ? 'needs_next_action'
                        : sourceRefs.length === 0
                          ? 'needs_source_refs'
                          : 'ready_for_compliance_decision';

      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const complianceScore = readinessScore;

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'imsys_taf2_compliance_status',
      }));

      const blockingFindings = missingEvidence.map((item) => ({
        code: `ITCS_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['taf2_obligation', 'target_deadline', 'tariff_model', 'measured_value_access'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));

      const complianceContext = {
        meteringPointId: params.meteringPointId || null,
      };

      const complianceEvidence = {
        taf2Obligation: typeof params.taf2Obligation === 'boolean' ? params.taf2Obligation : params.taf2Obligation ? String(params.taf2Obligation) === 'true' : null,
        targetDeadline: params.targetDeadline || null,
        tariffModel: params.tariffModel || null,
        implementationStatus: params.implementationStatus || null,
        measuredValueAccess: params.measuredValueAccess || null,
        owner: params.owner || null,
        nextAction: params.nextAction || null,
      };

      const dossierFacts = [
        `Status: ${status}`,
        `Provided iMSys TAF2 compliance evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.meteringPointId) dossierFacts.push(`Metering Point ID: ${params.meteringPointId}`);

      return {
        imsysTaf2ComplianceStatusId: `itcs:${Buffer.from(`${params.meteringPointId || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'imsys_taf2_compliance_status',
        safety: 'read_only',
        requestContext: complianceContext,
        status,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.imsysTaf2ComplianceStatus'],
          referenced: [
            'edm-messkonzept.evaluateAll',
            'edm-validation.validate',
            'datapoint.health',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence',
            'finance-agent.analyze',
            'hitl.create'
          ],
          notCalled: [
            'hitl.create',
            'vdmi.mutate',
            'finance-agent.mutate',
            'settlement.prepareBilling',
            'grid-operations.executeControl',
            'external.connector.call',
            'personal-agent.execute'
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          complianceScore,
          complianceContext,
          complianceEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    buildScheduleManagementGovernanceRoadmapStatus(params = {}) {
      const toList = (value) => {
        if (Array.isArray(value)) return value.filter(Boolean);
        if (value && typeof value === 'string') {
          return value.split(',').map((item) => item.trim()).filter(Boolean);
        }
        return [];
      };

      const dataObjects = toList(params.dataObjects);
      const systemIntegrations = toList(params.systemIntegrations);
      const roleOwnership = toList(params.roleOwnership);
      const capacityManagementGaps = toList(params.capacityManagementGaps);
      const roadmapItems = toList(params.roadmapItems);
      const decisionMeetings = toList(params.decisionMeetings);
      const sourceRefs = toList(params.sourceRef);

      const evidenceSpecs = [
        {
          id: 'target_state',
          label: 'Ziel-Zustand',
          value: params.targetState,
          sourceClass: 'roadmap_target_state_specification',
          enablesDossierAddition: 'define the target state or roadmap maturity goal',
        },
        {
          id: 'capability_maturity',
          label: 'Faehigkeits-Reifegrad',
          value: params.capabilityMaturity,
          sourceClass: 'roadmap_maturity_assessment',
          enablesDossierAddition: 'assess the capability maturity level (concept, pilot_ready, operational)',
        },
        {
          id: 'data_objects',
          label: 'Datenobjekte',
          value: dataObjects.length > 0,
          displayValue: dataObjects.join(', '),
          sourceClass: 'data_object_mapping',
          enablesDossierAddition: 'map required data objects (Anschlussbegehren, Netzfahrplan, Messdaten, etc.)',
        },
        {
          id: 'system_integrations',
          label: 'Systemintegrationen',
          value: systemIntegrations.length > 0,
          displayValue: systemIntegrations.join(', '),
          sourceClass: 'system_integration_definition',
          enablesDossierAddition: 'define connected core systems (EDM, Redispatch, Grid Operations)',
        },
        {
          id: 'role_ownership',
          label: 'Rollenverantwortung',
          value: roleOwnership.length > 0,
          displayValue: roleOwnership.join(', '),
          sourceClass: 'role_ownership_matrix',
          enablesDossierAddition: 'assign roles and process sponsorship (Assetmanagement, Netzbetrieb, Legal, PMO)',
        },
        {
          id: 'redispatch_boundary',
          label: 'Redispatch-Grenzbereich',
          value: params.redispatchBoundary,
          sourceClass: 'redispatch_boundary_clarification',
          enablesDossierAddition: 'clarify the Redispatch 2.0 system boundaries and data exchange interfaces',
        },
        {
          id: 'fnav_readiness',
          label: 'fNAV-Bereitschaft',
          value: params.fnavReadiness,
          sourceClass: 'fnav_readiness_validation',
          enablesDossierAddition: 'validate fNAV/netzfahrplan legal or contract status ready for operational integration',
        },
        {
          id: 'capacity_management_gaps',
          label: 'Kapazitaetsmanagement-Luecken',
          value: capacityManagementGaps.length > 0,
          displayValue: capacityManagementGaps.join(', '),
          sourceClass: 'capacity_gap_identification',
          enablesDossierAddition: 'identify capacity bottlenecks, flexibility constraints or tariff gaps',
        },
        {
          id: 'roadmap_items',
          label: 'Fahrplan-Elemente',
          value: roadmapItems.length > 0,
          displayValue: roadmapItems.join(', '),
          sourceClass: 'roadmap_backlog_items',
          enablesDossierAddition: 'list planned roadmap milestones and implementation steps',
        },
        {
          id: 'decision_meetings',
          label: 'Entscheidungsgremien',
          value: decisionMeetings.length > 0,
          displayValue: decisionMeetings.join(', '),
          sourceClass: 'steering_committee_windows',
          enablesDossierAddition: 'specify decision meetings and steering committee windows',
        },
        {
          id: 'owner',
          label: 'Prozessverantwortlicher Owner',
          value: params.owner,
          sourceClass: 'roadmap_responsibility',
          enablesDossierAddition: 'assign an accountable owner role or sponsor for the roadmap',
        },
        {
          id: 'next_action',
          label: 'Naechste Massnahme',
          value: params.nextAction,
          sourceClass: 'next_roadmap_action',
          enablesDossierAddition: 'define the immediate next action step',
        },
        {
          id: 'source_refs',
          label: 'Quellenreferenzen',
          value: sourceRefs.length > 0,
          displayValue: sourceRefs.join(', '),
          sourceClass: 'source_grounding',
          enablesDossierAddition: 'add regulatory sources or documentation reference credentials',
        },
      ];

      const evidenceItems = evidenceSpecs
        .filter((spec) => spec.value !== undefined && spec.value !== null && spec.value !== false)
        .map((spec) => ({
          id: spec.id,
          label: spec.label,
          value: spec.displayValue ?? spec.value,
          sourceClass: spec.sourceClass,
          evidenceStatus: 'provided',
        }));

      const missingEvidence = evidenceSpecs
        .filter((spec) => spec.value === undefined || spec.value === null || spec.value === false)
        .map((spec) => ({
          missingDataPoint: spec.id,
          label: spec.label,
          sourceClass: spec.sourceClass,
          enablesDossierAddition: spec.enablesDossierAddition,
        }));

      const status =
        !params.targetState
          ? 'needs_target_state'
          : !params.capabilityMaturity
            ? 'needs_capability_maturity'
            : dataObjects.length === 0
              ? 'needs_data_objects'
              : systemIntegrations.length === 0
                ? 'needs_system_integrations'
                : roleOwnership.length === 0
                  ? 'needs_role_ownership'
                  : !params.redispatchBoundary
                    ? 'needs_redispatch_boundary'
                    : !params.fnavReadiness
                      ? 'needs_fnav_readiness'
                      : capacityManagementGaps.length === 0
                        ? 'needs_capacity_management_gaps'
                        : roadmapItems.length === 0
                          ? 'needs_roadmap_items'
                          : decisionMeetings.length === 0
                            ? 'needs_decision_meetings'
                            : !params.owner
                              ? 'needs_owner'
                              : !params.nextAction
                                ? 'needs_next_action'
                                : sourceRefs.length === 0
                                  ? 'needs_source_refs'
                                  : 'operational';

      const readinessScore = Number((evidenceItems.length / evidenceSpecs.length).toFixed(2));
      const complianceScore = readinessScore;

      const positiveFollowUps = missingEvidence.map((item) => ({
        missingDataPoint: item.missingDataPoint,
        enablesDossierAddition: item.enablesDossierAddition,
        category: 'schedule_management_governance_roadmap',
      }));

      const blockingFindings = missingEvidence.map((item) => ({
        code: `SMGR_${String(item.missingDataPoint).toUpperCase()}_MISSING`,
        severity: ['target_state', 'capability_maturity', 'owner', 'next_action'].includes(item.missingDataPoint)
          ? 'high'
          : 'medium',
        message: item.enablesDossierAddition,
      }));

      const complianceContext = {
        meteringPointId: params.meteringPointId || null,
      };

      const complianceEvidence = {
        targetState: params.targetState || null,
        capabilityMaturity: params.capabilityMaturity || null,
        dataObjects,
        systemIntegrations,
        roleOwnership,
        redispatchBoundary: params.redispatchBoundary || null,
        fnavReadiness: params.fnavReadiness || null,
        capacityManagementGaps,
        roadmapItems,
        decisionMeetings,
        owner: params.owner || null,
        nextAction: params.nextAction || null,
      };

      const dossierFacts = [
        `Status: ${status}`,
        `Provided Fahrplanmanagement governance roadmap evidence: ${evidenceItems.length}/${evidenceSpecs.length}`,
        `Open gaps: ${missingEvidence.length}`,
      ];
      if (params.meteringPointId) dossierFacts.push(`Metering Point ID: ${params.meteringPointId}`);

      return {
        scheduleManagementGovernanceRoadmapStatusId: `smgr:${Buffer.from(`${params.meteringPointId || ''}`).toString('base64url').slice(0, 24)}`,
        capabilityKey: 'schedule_management_governance_roadmap',
        safety: 'read_only',
        requestContext: complianceContext,
        status,
        readinessScore,
        complianceScore,
        complianceContext,
        complianceEvidence,
        evidenceItems,
        missingEvidence,
        positiveFollowUps,
        blockingFindings,
        sourceEvidence: {
          sourceRefs,
        },
        sourceRefs,
        sourceActions: {
          inspected: ['dashboard-api.scheduleManagementGovernanceRoadmapStatus'],
          referenced: [
            'grid-operations.netzfahrplanGenerate',
            'grid-connection.fnavValidate',
            'redispatch-expost.audit',
            'edm-validation.validate',
            'datapoint.health',
            'vdmi.dossier',
            'interface-placeholder.requestEvidence'
          ],
          notCalled: [
            'hitl.create',
            'grid-operations.executeControl',
            'external.connector.call',
            'personal-agent.execute',
            'finance-agent.mutate',
            'settlement.prepareBilling'
          ],
        },
        validationFindings: blockingFindings,
        dossierEvidence: {
          status,
          readinessScore,
          complianceScore,
          complianceContext,
          complianceEvidence,
          evidenceItems,
          missingEvidence,
          positiveFollowUps,
          blockingFindings,
          sourceRefs,
          dossierFacts,
        },
      };
    },

    normalizeConfidenceScore(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      if (n > 1) return Math.max(0, Math.min(1, n / 100));
      return Math.max(0, Math.min(1, n));
    },

    requiresOperatorConfirmation(params) {
      const text = `${params.domain || ''} ${params.query || ''} ${params.sourceAction || ''}`.toLowerCase();
      return /grid|netz|vnb|dso|anschluss|kapazitaet|kapazität|redispatch|marktkommunikation/.test(text);
    },

    extractRagEvidenceItems(ragRes) {
      const raw =
        ragRes?.results ||
        ragRes?.items ||
        ragRes?.chunks ||
        ragRes?.documents ||
        ragRes?.sources ||
        [];
      if (!Array.isArray(raw)) return [];
      return raw.slice(0, 10).map((item) => ({
        sourceId: item.sourceId || item.id || item.documentId || null,
        sourceVersion: item.sourceVersion || item.version || null,
        collection: item.collection || item.collectionId || item.datasourceId || null,
        title: item.title || item.name || item.label || null,
        confidence: this.normalizeConfidenceScore(item.score ?? item.confidence ?? 0.55),
      }));
    },

    buildEvidenceSourceClassBreakdown({ params, ragItems, datapointRes, vdmiRes }) {
      const classes = {
        authoritative_registry: 0,
        internal_process_evidence: 0,
        rag_chunk: 0,
        datapoint_health: 0,
        user_or_prompt_hint: 0,
      };
      if (params.datasourceId || params.datapointId || params.networkOperatorConfirmed) {
        classes.authoritative_registry += params.networkOperatorConfirmed ? 1 : 0;
      }
      if (Array.isArray(vdmiRes?.findings) && vdmiRes.findings.length > 0) {
        classes.internal_process_evidence += vdmiRes.findings.length;
      }
      if (ragItems.length > 0) classes.rag_chunk += ragItems.length;
      if (datapointRes?.overview || params.datapointId) classes.datapoint_health += 1;
      if (params.query) classes.user_or_prompt_hint += 1;
      return classes;
    },

    buildEvidenceGroundingMissingEvidence({ params, hasScope, hasDomainContext, toolFailures, ragItems }) {
      const missing = [];
      const add = (missingDataPoint, enablesDossierAddition, category, severity = 'medium') => {
        missing.push({ missingDataPoint, enablesDossierAddition, category, severity });
      };
      if (!hasDomainContext) {
        add(
          'domain_or_capability_context',
          'Die Antwort kann einem Fachkontext oder einer Capability eindeutig zugeordnet werden',
          'routing',
          'high'
        );
      }
      if (!hasScope) {
        add(
          'scope_filter_grid_area',
          'Die Antwort kann auf Netzgebiet, Datenquelle oder Datenpunkt begrenzt werden',
          'scope',
          'high'
        );
      }
      if (this.requiresOperatorConfirmation(params) && !params.networkOperatorConfirmed) {
        add(
          'network_operator_confirmation',
          'Netzbetreiberbestaetigte Evidenz kann von Vorpruefung oder Annahme getrennt werden',
          'confirmation',
          'high'
        );
      }
      if (!params.datasourceId && !params.datapointId && ragItems.length === 0) {
        add(
          'claim_source_ref',
          'Claims koennen mit Datenpunkt, Receipt, RAG-Chunk oder ausgefuehrter Action belegt werden',
          'source',
          'medium'
        );
      }
      if (toolFailures.length > 0) {
        add(
          'tool_failure_status',
          'Degradierte Tools koennen als Confidence-Abzug und Wiederholvoraussetzung sichtbar werden',
          'tooling',
          'medium'
        );
      }
      return missing;
    },

    deriveEvidenceGroundingAnswerStatus({
      params,
      hasScope,
      hasDomainContext,
      toolFailures,
      requiresNetworkOperatorConfirmation,
    }) {
      if (toolFailures.length > 0) return 'tool_degraded';
      if (!hasDomainContext) return 'needs_clarification';
      if (!hasScope) return 'out_of_scope';
      const query = String(params.query || '').toLowerCase();
      if (/hypothetisch|szenario|scenario|annahme|was waere wenn/.test(query)) {
        return 'hypothetical_scenario';
      }
      if (requiresNetworkOperatorConfirmation) return 'requires_operator_confirmation';
      return 'ok';
    },

    deriveEvidenceConfidenceScore({
      answerStatus,
      hasScope,
      requiresNetworkOperatorConfirmation,
      sourceClassBreakdown,
      toolFailures,
    }) {
      if (toolFailures.length > 0) return 0.25;
      if (answerStatus === 'needs_clarification') return 0.35;
      if (!hasScope || answerStatus === 'out_of_scope') return 0.4;
      if (requiresNetworkOperatorConfirmation) return 0.45;
      let score = 0.55;
      if ((sourceClassBreakdown.authoritative_registry || 0) > 0) score += 0.18;
      if ((sourceClassBreakdown.datapoint_health || 0) > 0) score += 0.08;
      if ((sourceClassBreakdown.internal_process_evidence || 0) > 0) score += 0.06;
      if ((sourceClassBreakdown.rag_chunk || 0) > 0) score += 0.05;
      if (answerStatus === 'hypothetical_scenario') score = Math.min(score, 0.62);
      return Math.round(Math.min(0.9, score) * 100) / 100;
    },

    buildEvidenceConfidenceBasis({
      answerStatus,
      hasScope,
      requiresNetworkOperatorConfirmation,
      toolFailures,
      sourceClassBreakdown,
    }) {
      const basis = [`answerStatus=${answerStatus}`];
      if (!hasScope) basis.push('missing scope filter');
      if (requiresNetworkOperatorConfirmation) basis.push('operator confirmation missing');
      if (toolFailures.length > 0) basis.push('tool failure present');
      if ((sourceClassBreakdown.authoritative_registry || 0) > 0) {
        basis.push('authoritative registry/operator evidence present');
      }
      if ((sourceClassBreakdown.datapoint_health || 0) > 0) basis.push('datapoint health present');
      if ((sourceClassBreakdown.rag_chunk || 0) > 0) basis.push('RAG source refs present');
      return basis;
    },

    buildEvidenceGroundingClaims({ params, ragItems, sourceClassBreakdown }) {
      const claims = [];
      if (params.sourceAction || params.capabilityId) {
        claims.push({
          claim:
            params.sourceAction ||
            `Capability ${params.capabilityId} is the requested grounding context`,
          sourceRef: params.sourceAction || params.capabilityId,
          sourceClass: 'internal_process_evidence',
          confidenceBasis: 'explicit request parameter',
        });
      }
      for (const item of ragItems.slice(0, 3)) {
        claims.push({
          claim: item.title || 'RAG source available for answer grounding',
          sourceRef: item.sourceId,
          sourceClass: 'rag_chunk',
          confidenceBasis: `retrieval confidence ${item.confidence}`,
        });
      }
      if ((sourceClassBreakdown.datapoint_health || 0) > 0) {
        claims.push({
          claim: 'Datapoint health can be considered for freshness/completeness.',
          sourceRef: params.datapointId || 'datapoint.health',
          sourceClass: 'datapoint_health',
          confidenceBasis: 'read-only datapoint health surface',
        });
      }
      return claims;
    },

    buildEvidenceGroundingAssumptions({ params, hasScope, requiresNetworkOperatorConfirmation }) {
      const assumptions = [];
      if (params.query) {
        assumptions.push({
          assumption: 'User prompt is treated as preview context, not authoritative evidence.',
          sourceRef: 'query',
        });
      }
      if (!hasScope) {
        assumptions.push({
          assumption: 'No local scope filter was supplied; answer must remain bounded as preliminary.',
          sourceRef: 'scope_filter_grid_area',
        });
      }
      if (requiresNetworkOperatorConfirmation) {
        assumptions.push({
          assumption: 'Network-operator confirmation is missing; fachliche confidence remains capped.',
          sourceRef: 'network_operator_confirmation',
        });
      }
      return assumptions;
    },

    buildEvidenceGroundingSourceActions({ routingRes, datapointRes, vdmiRes, ragRes, params, errors }) {
      const failed = new Set(errors || []);
      return {
        'capability-broker.recommend': {
          success: !!routingRes,
          skipped: !params.query,
          failed: failed.has('capability-broker.recommend'),
          capability: routingRes?.capability || null,
          confidence: routingRes?.confidence ?? routingRes?.recommendedCapabilities?.[0]?.confidence ?? null,
        },
        'knowledge-rag.query': {
          success: !!ragRes,
          skipped: !params.query,
          failed: failed.has('knowledge-rag.query'),
          sources: this.extractRagEvidenceItems(ragRes).length,
        },
        'datapoint.health': {
          success: !!datapointRes,
          failed: failed.has('datapoint.health'),
          overview: datapointRes?.overview || null,
        },
        'vdmi.findings': {
          success: !!vdmiRes,
          failed: failed.has('vdmi.findings'),
          findings: Array.isArray(vdmiRes?.findings) ? vdmiRes.findings.length : 0,
        },
      };
    },

    buildRedispatchCallQualityGate({
      params,
      rdLatest,
      datapointOverview,
      validationSummary,
      validationFindings,
      forecastQuality,
      vdmiFindings,
      sourceActions,
      errors,
      hasTimeseriesContext,
    }) {
      const missingDataPoints = [];
      const openEvidence = [];
      const monitoringTasks = [];

      const addMissing = (missingDataPoint, enablesDossierAddition, category, severity = 'medium') => {
        const item = { missingDataPoint, enablesDossierAddition, category, severity };
        missingDataPoints.push(item);
        openEvidence.push(item);
        monitoringTasks.push({
          task: `Clarify ${missingDataPoint}`,
          source: category,
          severity,
          recommendedAction: enablesDossierAddition,
        });
      };

      if (!params.gridOperatorId) {
        addMissing(
          'masterDataProcessSignal',
          'Stammdatenmerkmal und Prozessabsprung koennen dem Abruffall belastbar zugeordnet werden',
          'masterData',
          'high'
        );
      }
      if (!params.meloId && !params.maloId && !params.assetId) {
        addMissing(
          'meloMaloMapping',
          'Messlokation/Marktlokation koennen in die Datenqualitaetskette aufgenommen werden',
          'metering',
          'high'
        );
      }
      if (!hasTimeseriesContext) {
        addMissing(
          'loadProfileCompleteness',
          'Nullwerte und Lastgangluecken koennen vor Clearing/Abrechnung bewertet werden',
          'metering',
          'high'
        );
        addMissing(
          'forecastQuality',
          'Prognoseluecken koennen als Klaeraufgabe statt als Abrechnungsfreigabe erscheinen',
          'forecast',
          'medium'
        );
      }

      const readinessPercent = rdLatest?.settlementReadiness?.readinessPercent;
      const rdRisk = String(rdLatest?.riskAssessment?.level || '').toLowerCase();
      const validationQuality = validationSummary?.dataQuality;
      const validationErrors = validationFindings.filter((f) => f?.severity === 'error').length;
      const validationWarnings = validationFindings.filter((f) => f?.severity === 'warning').length;
      const forecastRating = String(forecastQuality?.rating || '').toLowerCase();
      const criticalGovernance = vdmiFindings.filter((f) => {
        const severity = String(f?.severity || '').toUpperCase();
        const code = String(f?.code || '').toUpperCase();
        return severity === 'H' || severity === 'K' || code.startsWith('VD_GOV_');
      });

      if (!rdLatest) {
        addMissing(
          'controlEvidence',
          'Kontrollnachweis zum Abruf kann in die Evidenzkette aufgenommen werden',
          'controlEvidence',
          'high'
        );
      }
      if (criticalGovernance.length > 0) {
        addMissing(
          'monitoringOwner',
          'Verantwortliche Rolle und naechster Klaerschritt koennen im Dossier genannt werden',
          'monitoring',
          'high'
        );
      }
      if (
        hasTimeseriesContext &&
        !this.validationHasUsableEvidence(validationSummary, validationFindings)
      ) {
        addMissing(
          'loadProfileCompleteness',
          'Nullwerte und Lastgangluecken koennen vor Clearing/Abrechnung bewertet werden',
          'metering',
          'high'
        );
      }
      if (forecastRating === 'poor' || forecastRating === 'fair') {
        addMissing(
          'forecastQuality',
          'Prognoseluecken koennen als Klaeraufgabe statt als Abrechnungsfreigabe erscheinen',
          'forecast',
          forecastRating === 'poor' ? 'high' : 'medium'
        );
      }

      const masterDataReadiness = {
        status: params.gridOperatorId && rdLatest ? 'available' : 'missing_evidence',
        processSignal: params.gridOperatorId || null,
        source: 'redispatch-expost.list',
      };
      const meteringSignal =
        !hasTimeseriesContext || validationErrors > 0
          ? 'red'
          : validationWarnings > 0 ||
              (typeof validationQuality === 'number' && validationQuality < 0.95) ||
              (datapointOverview?.stale ?? 0) > 0
            ? 'yellow'
            : 'green';
      const meteringReadiness = {
        status: meteringSignal === 'green' ? 'ready' : 'needs_clarification',
        signal: meteringSignal,
        dataQuality: typeof validationQuality === 'number' ? validationQuality : null,
        validationErrors,
        validationWarnings,
        datapointOverview,
      };
      const forecastReadiness = {
        status:
          forecastRating === 'excellent' || forecastRating === 'good'
            ? 'ready'
            : forecastRating
              ? 'needs_clarification'
              : 'missing_evidence',
        rating: forecastQuality?.rating || null,
        mape: forecastQuality?.mape ?? null,
      };
      const controlEvidenceReadiness = {
        status: rdLatest ? 'available' : 'missing_evidence',
        auditId: rdLatest?.id || null,
        criticalGovernanceFindings: criticalGovernance.length,
      };
      const settlementReadiness = {
        status:
          typeof readinessPercent === 'number' && readinessPercent >= 80 && rdRisk !== 'high'
            ? 'candidate_ready'
            : 'not_ready',
        readinessPercent: typeof readinessPercent === 'number' ? readinessPercent : null,
        riskLevel: rdRisk || null,
        billingRelease: false,
      };

      const gateStatus = this.deriveRedispatchCallGateStatus({
        missingDataPoints,
        masterDataReadiness,
        meteringReadiness,
        forecastReadiness,
        controlEvidenceReadiness,
        settlementReadiness,
        errors,
      });
      const leadingProcessSignal = this.pickRedispatchCallLeadingSignal({
        gateStatus,
        missingDataPoints,
        sourceActions,
      });
      const nextActions = this.buildRedispatchCallNextActions(gateStatus, missingDataPoints);

      return {
        found: true,
        gateStatus,
        callContext: {
          gridOperatorId: params.gridOperatorId || null,
          meloId: params.meloId || null,
          maloId: params.maloId || null,
          assetId: params.assetId || null,
          from: params.from || null,
          to: params.to || null,
          auditId: params.auditId || rdLatest?.id || null,
        },
        masterDataReadiness,
        meteringReadiness,
        forecastReadiness,
        controlEvidenceReadiness,
        settlementReadiness,
        leadingProcessSignal,
        openEvidence,
        monitoringTasks,
        sourceActions,
        nextActions,
        missingDataPoints,
      };
    },

    deriveRedispatchCallGateStatus({
      missingDataPoints,
      meteringReadiness,
      forecastReadiness,
      controlEvidenceReadiness,
      settlementReadiness,
      errors,
    }) {
      if ((errors || []).length > 0) return 'blocked_for_billing';
      const has = (name) => missingDataPoints.some((m) => m.missingDataPoint === name);
      if (has('masterDataProcessSignal') || has('meloMaloMapping')) return 'needs_master_data_fix';
      if (has('loadProfileCompleteness') || meteringReadiness.signal === 'red') {
        return 'needs_metering_clarification';
      }
      if (has('forecastQuality') || forecastReadiness.status === 'needs_clarification') {
        return 'needs_forecast_clarification';
      }
      if (has('controlEvidence') || controlEvidenceReadiness.status !== 'available') {
        return 'needs_control_evidence';
      }
      if (has('monitoringOwner')) return 'needs_monitoring_owner';
      if (settlementReadiness.status === 'candidate_ready') return 'ready_for_settlement';
      return 'blocked_for_billing';
    },

    pickRedispatchCallLeadingSignal({ gateStatus, missingDataPoints, sourceActions }) {
      const firstMissing = missingDataPoints[0] || null;
      return {
        status: gateStatus,
        category: firstMissing?.category || 'settlement',
        blocker: firstMissing?.missingDataPoint || null,
        source:
          firstMissing?.category === 'metering'
            ? 'edm-validation.validate'
            : firstMissing?.category === 'forecast'
              ? 'forecast-engine.evaluateQuality'
              : firstMissing?.category === 'monitoring'
                ? 'vdmi.findings'
                : firstMissing?.category === 'controlEvidence'
                  ? 'redispatch-expost.list'
                  : sourceActions?.['redispatch-expost.list']?.selectedAuditId
                    ? 'redispatch-expost.list'
                    : 'dashboard-api.redispatchCallQualityGate',
      };
    },

    buildRedispatchCallNextActions(gateStatus, missingDataPoints) {
      if (!missingDataPoints.length && gateStatus === 'ready_for_settlement') {
        return [
          {
            action: 'review_settlement_candidate',
            label: 'Abrechnungsnahe Evidenz pruefen; keine automatische Freigabe in diesem Gate.',
          },
        ];
      }
      return missingDataPoints.map((item) => ({
        action: `clarify_${item.missingDataPoint}`,
        label: item.enablesDossierAddition,
        category: item.category,
        consequential: false,
      }));
    },

    validationHasUsableEvidence(validationSummary, validationFindings) {
      if (validationSummary && typeof validationSummary === 'object') return true;
      return Array.isArray(validationFindings) && validationFindings.length > 0;
    },

    computeRedispatchMeteringScore({ rdLatest, mqLatest, dpOverview, openCriticalFindings }) {
      const parts = [];

      const redispatchReadiness = rdLatest?.settlementReadiness?.readinessPercent;
      if (typeof redispatchReadiness === 'number') {
        parts.push(Math.max(0, Math.min(100, redispatchReadiness)));
      }

      const qualityScore = mqLatest?.qualityScore;
      if (typeof qualityScore === 'number') {
        parts.push(Math.max(0, Math.min(100, qualityScore)));
      }

      const healthy = dpOverview?.healthy;
      const stale = dpOverview?.stale;
      const errored = dpOverview?.errored;
      const total = [healthy, stale, errored].every((v) => typeof v === 'number')
        ? healthy + stale + errored
        : null;
      if (total && total > 0) {
        const datapointScore = ((healthy - errored) / total) * 100;
        parts.push(Math.max(0, Math.min(100, datapointScore)));
      }

      if (Array.isArray(openCriticalFindings)) {
        const governanceScore =
          openCriticalFindings.length === 0
            ? 100
            : Math.max(0, 60 - openCriticalFindings.length * 10);
        parts.push(governanceScore);
      }

      if (!parts.length) return null;
      const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
      return Math.round(avg * 10) / 10;
    },

    deriveRedispatchMeteringSignal({ score, blockingEvidenceGaps }) {
      const hasHighBlocker = (blockingEvidenceGaps || []).some((b) => b?.severity === 'high');
      if (hasHighBlocker) return 'red';
      if ((blockingEvidenceGaps || []).length > 0) return 'yellow';
      if (score == null) return 'yellow';
      if (score < 60) return 'red';
      if (score < 80) return 'yellow';
      return 'green';
    },

    isOlderThanDays(isoDate, days) {
      if (!isoDate) return false;
      const ts = Date.parse(isoDate);
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts > days * 24 * 60 * 60 * 1000;
    },

    daysSince(isoDate) {
      if (!isoDate) return null;
      const ts = Date.parse(isoDate);
      if (!Number.isFinite(ts)) return null;
      return Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
    },
  },
};
