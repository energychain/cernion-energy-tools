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
