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
