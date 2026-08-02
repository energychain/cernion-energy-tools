'use strict';

// dashboard-api actions chunk 1/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: vnbOverview, redispatchMeteringCockpit, loadProfileStreamMonitor, redispatchCallQualityGate, evidenceGroundingConfidenceAudit, receiptGroundedPresentationContract, marketCommunicationEvidenceChainStatus, e2eControllabilityGovernanceStatus, controllabilityAssetHandoverStatus, controllabilityDataAlignmentStatus, coordinationMeaningPreservationProfile, a2mdmDecisionObjectStatus, gremiencoachWorkbookReadinessStatus, decisionReadinessMatrixStatus, crossSystemVarianceMatrixStatus, regulatorySignalProcessTranslatorStatus

const {
  evaluatePresentationGrounding,
  OPENAPI_TAG,
  ACTION_MQ_LIST,
  ACTION_RD_LIST,
  ACTION_ES_LIST,
  ACTION_GC_LIST,
  ACTION_VDMI_FINDINGS,
} = require('./shared');

module.exports = {
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
                settlementReadinessPercent: rdLatest?.settlementReadiness?.readinessPercent ?? null,
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
        { in: 'query', name: 'obis', schema: { type: 'string' } },
        { in: 'query', name: 'profileId', schema: { type: 'string' } },
        { in: 'query', name: 'annualConsumptionKwh', schema: { type: 'number' } },
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

          const [rdRes, datapointRes, validationRes, forecastRes, vdmiRes] = await Promise.all([
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
      networkOperatorConfirmed: {
        type: 'boolean',
        optional: true,
        convert: true,
        default: false,
      },
      // v0.99.1: opt-in only — does not change default audit scope/latency.
      includeFederatedKnowledge: { type: 'boolean', optional: true, convert: true, default: false },
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
        {
          name: 'includeFederatedKnowledge',
          in: 'query',
          required: false,
          schema: { type: 'boolean', default: false },
          description:
            'Opt-in only (default false). When true, additionally probes knowledge-rag.federatedSearch health/availability alongside knowledge-rag.query.',
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
          const [datapointRes, vdmiRes, ragRes, federatedRagRes] = await Promise.all([
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
            // v0.99.1: opt-in only — skipped unless the caller explicitly requests it.
            // Uses its own errors array (not `errors`) so a probe failure never surfaces
            // as a core tool failure / degrades answerStatus or evidenceConfidence —
            // see buildEvidenceGroundingConfidenceAudit's separate federatedKnowledgeProbe.
            params.query && params.includeFederatedKnowledge
              ? this.safeCall(
                  ctx,
                  'knowledge-rag.federatedSearch',
                  { query: params.query, limit: 5 },
                  null,
                  [],
                  'knowledge-rag.federatedSearch'
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
              federatedRagRes,
              errors,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

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
      includeMakoKnowledge: { type: 'boolean', optional: true, convert: true, default: false },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Market communication evidence chain — read-only dossier-safe status',
      description:
        'Classifies market-communication evidence for dynamic tariff, iMSys, consumption-data ' +
        'and billing-readiness cases. Portal screenshots, customer statements and provider views ' +
        'are hints only; official MaLo/MeLo, UTILMD/master-data path, meter values, consumption ' +
        'retrieval, data-quality status and next billing step remain separate required evidence. ' +
        'The endpoint is read-only and does not mutate MaKo, EDM, billing, settlement, VDMI or HITL state. ' +
        'When `includeMakoKnowledge=true`, an optional, advisory `makoKnowledgeContext` (Willi-Mako ' +
        'structural hints via `willi-mako.resolveStructure`) is attached; it never changes the default ' +
        'response shape, is never binding, and degrades to `available:false` if unavailable.',
      parameters: [
        { name: 'maloId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'meloId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'contractAccountId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'includeHints', in: 'query', required: false, schema: { type: 'boolean' } },
        { name: 'portalHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'providerView', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'customerStatement', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'utilmdMasterdataPath',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'meterValueBatchId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'consumptionRetrievalStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextBillingStep', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'includeMakoKnowledge',
          in: 'query',
          required: false,
          schema: { type: 'boolean', default: false },
        },
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
                  makoKnowledgeContext: {
                    type: 'object',
                    description:
                      'Optional, advisory Willi-Mako structure context; only present when ' +
                      'includeMakoKnowledge=true. Never binding; degrades to available:false.',
                  },
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
      const cacheKey = `market-communication-evidence-chain:${params.caseId || 'no-case'}:${params.maloId || 'no-malo'}:${params.meloId || 'no-melo'}:${params.contractAccountId || 'no-account'}:${params.includeHints ? 'hints' : 'no-hints'}:${params.utilmdMasterdataPath || 'no-utilmd'}:${params.meterValueBatchId || 'no-meter'}:${params.consumptionRetrievalStatus || 'no-consumption'}:${params.dataQualityStatus || 'no-quality'}:${params.nextBillingStep || 'no-next'}:${params.includeMakoKnowledge ? 'mako-knowledge' : 'no-mako-knowledge'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.marketCommunicationEvidenceChainStatus,
        async () => {
          const result = {
            ...this.buildMarketCommunicationEvidenceChainStatus(params),
            timestamp: new Date().toISOString(),
            _errors: [],
          };
          const makoKnowledgeContext = await this.maybeAttachMakoKnowledge(
            ctx,
            params.includeMakoKnowledge,
            'UTILMD Marktkommunikation Evidenzkette MaLo MeLo Abrechnung'
          );
          if (makoKnowledgeContext) {
            result.makoKnowledgeContext = makoKnowledgeContext;
          }
          return result;
        }
      );
    },
  },

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
        {
          name: 'assetControlCapability',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'gridOperationsDecision',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'marketCommunicationHandover',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
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
      dataSourceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
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
        {
          name: 'controllabilityScope',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'technicalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'feedbackCapability', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'dataSourceRefs',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
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

  controllabilityDataAlignmentStatus: {
    rest: 'GET /controllability-data-alignment',
    params: {
      checklistId: { type: 'string', optional: true, min: 1 },
      assetId: { type: 'string', optional: true, min: 1 },
      mastrId: { type: 'string', optional: true, min: 1 },
      assetMatch: { type: 'string', optional: true, min: 1 },
      mastrMatch: { type: 'string', optional: true, min: 1 },
      internalAssetMatch: { type: 'string', optional: true, min: 1 },
      controlTechStatus: { type: 'string', optional: true, min: 1 },
      thresholdClass: { type: 'string', optional: true, min: 1 },
      testability: { type: 'string', optional: true, min: 1 },
      exceptionReason: { type: 'string', optional: true, min: 1 },
      priorYearComparison: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      exportReadiness: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Controllability data alignment — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence/status view for recurring Steuerbarkeitscheck checklist reconciliation. ' +
        'It compares supplied checklist, asset/MaStR/internal, control-tech, threshold, testability, exception, ' +
        'prior-year, owner/deadline and export-readiness facts. The endpoint is read-only and does not import files, ' +
        'mutate Asset-MDM, call MaStR/CLS/SMGW, create HITL items, execute tests, or affect MaKo, billing, settlement, tariffs or device control.',
      parameters: [
        { name: 'checklistId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'mastrId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetMatch', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'mastrMatch', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'internalAssetMatch', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'controlTechStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'thresholdClass', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'testability', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'exceptionReason', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'priorYearComparison', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'exportReadiness', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only controllability data alignment status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  checklist: { type: 'object' },
                  alignmentRows: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  safeNextGate: { type: 'string' },
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
      const cacheKey = `controllability-data-alignment:${params.checklistId || 'no-checklist'}:${params.assetId || 'no-asset'}:${params.mastrId || 'no-mastr'}:${params.assetMatch || 'no-asset-match'}:${params.mastrMatch || 'no-mastr-match'}:${params.controlTechStatus || 'no-control'}:${params.thresholdClass || 'no-threshold'}:${params.testability || 'no-testability'}:${params.exceptionReason || 'no-exception'}:${params.owner || 'no-owner'}:${params.dueDate || 'no-due-date'}:${params.exportReadiness || 'no-export'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.controllabilityDataAlignmentStatus,
        async () => ({
          ...this.buildControllabilityDataAlignmentStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  coordinationMeaningPreservationProfile: {
    rest: 'GET /coordination-meaning-preservation-profile',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      sourceDomain: { type: 'string', optional: true, min: 1 },
      targetDomain: { type: 'string', optional: true, min: 1 },
      regulatoryReference: { type: 'string', optional: true, min: 1 },
      commercialEffect: { type: 'string', optional: true, min: 1 },
      networkConstraint: { type: 'string', optional: true, min: 1 },
      evidenceProof: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      nextDecision: { type: 'string', optional: true, min: 1 },
      operationalRisk: { type: 'string', optional: true, min: 1 },
      handoverContext: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Coordination meaning preservation — read-only dossier-safe profile',
      description:
        'Builds a deterministic profile for preserving meaning at cross-domain handovers. ' +
        'It reports preserved and missing dimensions such as regulatory reference, commercial ' +
        'effect, network constraint, evidence proof, owner, deadline, next decision and operational ' +
        'risk. The endpoint is read-only and does not mutate Fachsysteme, HITL, billing, settlement, ' +
        'MaKo, tariff, device-control, Budibase or external connector state.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceDomain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetDomain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'regulatoryReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'commercialEffect', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'networkConstraint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceProof', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadline', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'operationalRisk', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'handoverContext', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only coordination meaning preservation profile',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  coordinationLossClassification: { type: 'string' },
                  preservedDimensions: { type: 'array' },
                  missingDimensions: { type: 'array' },
                  weakDimensions: { type: 'array' },
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
      const cacheKey = `coordination-meaning-preservation-profile:${params.caseId || 'no-case'}:${params.sourceDomain || 'no-source'}:${params.targetDomain || 'no-target'}:${params.regulatoryReference || 'no-reg'}:${params.commercialEffect || 'no-commercial'}:${params.networkConstraint || 'no-network'}:${params.evidenceProof || 'no-proof'}:${params.owner || 'no-owner'}:${params.deadline || 'no-deadline'}:${params.nextDecision || 'no-decision'}:${params.operationalRisk || 'no-risk'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.coordinationMeaningPreservationProfile,
        async () => ({
          ...this.buildCoordinationMeaningPreservationProfile(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  a2mdmDecisionObjectStatus: {
    rest: 'GET /a2mdm-decision-object',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      subject: { type: 'string', optional: true, min: 1 },
      businessIntent: { type: 'string', optional: true, min: 1 },
      technicalConstraint: { type: 'string', optional: true, min: 1 },
      regulatoryReference: { type: 'string', optional: true, min: 1 },
      evidenceSource: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      riskLevel: { type: 'string', optional: true, min: 1 },
      decisionThreshold: { type: 'string', optional: true, min: 1 },
      nextGate: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'A2MDM decision object - read-only meaning preservation projection',
      description:
        'Builds a deterministic, dossier-safe A2MDM decision-object projection for a synthetic Stadtwerk Mauer handover case. ' +
        'The endpoint preserves scalar decision context across system boundaries and exposes missing-input follow-ups. ' +
        'It is read-only and does not create A2MDM persistence, workflow, HITL, Budibase, Landing Registry, MaKo, billing, settlement, tariff, device-control, SMGW/CLS or external connector actions.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'subject', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'businessIntent', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'technicalConstraint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'regulatoryReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceSource', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'riskLevel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionThreshold', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextGate', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only A2MDM decision-object context',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  capabilityKey: { type: 'string' },
                  decisionObjectId: { type: 'string' },
                  decisionRows: { type: 'array' },
                  missingInputs: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  noCallGuards: { type: 'array' },
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
      const cacheKey = `a2mdm-decision-object:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.a2mdmDecisionObjectStatus,
        async () => ({
          ...this.buildA2mdmDecisionObjectStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gremiencoachWorkbookReadinessStatus: {
    rest: 'GET /gremiencoach-workbook-readiness',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      workbookId: { type: 'string', optional: true, min: 1 },
      committeeContext: { type: 'string', optional: true, min: 1 },
      processHint: { type: 'string', optional: true, min: 1 },
      evidenceProfile: { type: 'string', optional: true, min: 1 },
      sourceRegister: { type: 'string', optional: true, min: 1 },
      processRole: { type: 'string', optional: true, min: 1 },
      regulatoryReference: { type: 'string', optional: true, min: 1 },
      artifactClassification: { type: 'string', optional: true, min: 1 },
      releaseBoundary: { type: 'string', optional: true, min: 1 },
      includeSyntheticRows: { type: 'boolean', optional: true, convert: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Gremiencoach workbook readiness - read-only private-prep status',
      description:
        'Builds a deterministic, anonymized readiness contract for VNB committee workbook preparation. ' +
        'The endpoint returns scalar rows for evidence-backed candidate claims, evidence gaps, VDMI/process context, ' +
        'draft artifact intents, guardrails and positive follow-ups. It is read-only and does not upload, parse, retain, embed or train on private Office/PDF/Excel/protocol/mail content; does not create Office files; does not call M365/SharePoint/Graph, mail/calendar/tasks or external connectors; and does not publish, approve, settle, bill, control devices, create HITL/workflows or hardcode Personal Agent behavior.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'workbookId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'committeeContext', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'processHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceProfile', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceRegister', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'processRole', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryReference',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'artifactClassification',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'releaseBoundary', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'includeSyntheticRows',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: {
          description: 'Read-only Gremiencoach workbook readiness status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  claimRows: { type: 'array' },
                  evidenceGapRows: { type: 'array' },
                  processContextRows: { type: 'array' },
                  draftArtifactRows: { type: 'array' },
                  guardrailRows: { type: 'array' },
                  positiveFollowUpRows: { type: 'array' },
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
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `gremiencoach-workbook-readiness:${params.tenantId || 'no-tenant'}:${params.workbookId || 'no-workbook'}:${params.committeeContext || 'no-context'}:${params.processHint || 'no-process'}:${params.evidenceProfile || 'no-profile'}:${params.sourceRegister || 'no-register'}:${params.processRole || 'no-role'}:${params.regulatoryReference || 'no-reg-ref'}:${params.artifactClassification || 'no-artifact'}:${params.releaseBoundary || 'no-release'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gremiencoachWorkbookReadinessStatus,
        async () => ({
          ...this.buildGremiencoachWorkbookReadinessStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  decisionReadinessMatrixStatus: {
    rest: 'GET /decision-readiness-matrix',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      measureId: { type: 'string', optional: true, min: 1 },
      measureName: { type: 'string', optional: true, min: 1 },
      category: { type: 'string', optional: true, min: 1 },
      budgetStatus: { type: 'string', optional: true, min: 1 },
      financingOption: { type: 'string', optional: true, min: 1 },
      riskIfNotImplemented: { type: 'string', optional: true, min: 1 },
      evidenceSource: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      committeeWindow: { type: 'string', optional: true, min: 1 },
      nextDecisionPoint: { type: 'string', optional: true, min: 1 },
      blockers: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      openEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      includeSyntheticRows: { type: 'boolean', optional: true, convert: true, default: false },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Decision-readiness matrix -- read-only VNB OPL/budget evidence',
      description:
        'Classifies caller-supplied VNB OPL, budget and measure facts into a read-only decision-readiness matrix. ' +
        'The endpoint reports row readiness, budget/financing risk, evidence gaps, owner and committee-window context, ' +
        'positive follow-ups and explicit side-effect guards. It does not approve budgets, choose financing, create procurement/project records, write SAP/ERP, create HITL/workflow/webhooks, mutate billing/settlement/tariff/MaKo/device-control state, call external connectors or add Personal-Agent shortcuts.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'measureId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'measureName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'category', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'budgetStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'financingOption', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'riskIfNotImplemented',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'evidenceSource', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'committeeWindow', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextDecisionPoint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockers', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'openEvidence', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'includeSyntheticRows',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: {
          description: 'Read-only decision-readiness matrix evidence view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  rows: { type: 'array' },
                  readinessCounts: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  decisionBoundaries: { type: 'array' },
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
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `decision-readiness-matrix:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.decisionReadinessMatrixStatus,
        async () => ({
          ...this.buildDecisionReadinessMatrixStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  crossSystemVarianceMatrixStatus: {
    rest: 'GET /cross-system-variance-matrix',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      varianceId: { type: 'string', optional: true, min: 1 },
      sourceSystem: { type: 'string', optional: true, min: 1 },
      targetSystem: { type: 'string', optional: true, min: 1 },
      domain: { type: 'string', optional: true, min: 1 },
      affectedObject: { type: 'string', optional: true, min: 1 },
      amountEur: { type: 'number', optional: true, convert: true },
      revenueImpact: { type: 'string', optional: true, min: 1 },
      assetScope: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      evidence: { type: 'string', optional: true, min: 1 },
      threshold: { type: 'string', optional: true, min: 1 },
      resolutionStatus: { type: 'string', optional: true, min: 1 },
      openEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      includeSyntheticRows: { type: 'boolean', optional: true, convert: true, default: false },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Cross-system variance matrix -- read-only VNB evidence view',
      description:
        'Classifies caller-supplied VNB revenue, budget and asset-data variances into a read-only evidence matrix. ' +
        'The endpoint reports row state, source-system lineage, missing evidence, owner/deadline/threshold hints, positive follow-ups and explicit no-call guards. It does not connect to ERP/SAP/GIS/MDM, reconcile systems, persist records, approve revenue, book finance, mutate master data, create HITL/workflow/webhooks, call external connectors or add Personal-Agent shortcuts.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'varianceId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSystem', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetSystem', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'affectedObject', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'amountEur', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'revenueImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetScope', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadline', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'threshold', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'resolutionStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'openEvidence', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'includeSyntheticRows',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: {
          description: 'Read-only cross-system variance evidence matrix',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  rows: { type: 'array' },
                  varianceCounts: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  decisionBoundaries: { type: 'array' },
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
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `cross-system-variance-matrix:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.crossSystemVarianceMatrixStatus,
        async () => ({
          ...this.buildCrossSystemVarianceMatrixStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  regulatorySignalProcessTranslatorStatus: {
    rest: 'GET /regulatory-signal-process-translator',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      sourceName: { type: 'string', optional: true, min: 1 },
      publishedAt: { type: 'string', optional: true, min: 1 },
      signalText: { type: 'string', optional: true, min: 1 },
      summary: { type: 'string', optional: true, min: 1 },
      affectedDomain: { type: 'string', optional: true, min: 1 },
      processHint: { type: 'string', optional: true, min: 1 },
      deadlineHint: { type: 'string', optional: true, min: 1 },
      ownerHint: { type: 'string', optional: true, min: 1 },
      evidenceHint: { type: 'string', optional: true, min: 1 },
      testCaseHint: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Regulatory signal process translator -- read-only governance evidence view',
      description:
        'Translates caller-supplied regulatory signal facts into operational VNB/EVU process, data, evidence, test-case and decision-gate hints. The endpoint does not provide legal advice, determine compliance truth, crawl sources, create workflow/HITL tasks, write SAP/ERP/GIS/MDM/Budibase data, mutate MaKo/billing/settlement/tariff/device-control state, call external connectors or add Personal-Agent shortcuts.',
      parameters: [
        { name: 'signalId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'publishedAt', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'signalText', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'summary', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'affectedDomain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'processHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadlineHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'testCaseHint', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only operational translation of supplied regulatory signal facts',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  signalSummary: { type: 'object' },
                  affectedProcesses: { type: 'array' },
                  dataRequirements: { type: 'array' },
                  evidenceRequirements: { type: 'array' },
                  testCaseHints: { type: 'array' },
                  decisionGates: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  decisionBoundaries: { type: 'array' },
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
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `regulatory-signal-process-translator:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.regulatorySignalProcessTranslatorStatus,
        async () => ({
          ...this.buildRegulatorySignalProcessTranslatorStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },
};
