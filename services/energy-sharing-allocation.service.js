'use strict';

/**
 * Energy Sharing Allocation Engine (v0.16.0)
 *
 * Berechnungsengine for § 42c EnWG Energy Sharing communities.
 * Takes a validated community definition (generators + consumers + share percentages)
 * and a date range, and produces per-consumer 15-minute allocation time-series.
 *
 * Architecture: Berechnungsengine (NOT an Agent — no Findings pattern).
 *   - Deterministic: identical inputs → identical time-series outputs.
 *   - KRITIS-compliant: full time-series computed in RAM, only metadata persisted.
 *   - Excluded from LLM agent catalogue (skipServices).
 *
 * Data sources:
 *   Stufe A (default) — synthetic 15-min forecast via mastr_generation_forecast MCP tool.
 *   Stufe B           — real iMSys metering data via Inhouse-Data upload (datasource-cache).
 *
 * Consumer-side consumption data (issue #281, gap identified in #280):
 *   Optional, opt-in (`includeConsumptionData: true`) per-consumer EDM lookup
 *   (services/edm.service.js, OBIS 1-0:1.8.0) for the same date range. Missing
 *   data for a consumer is reported as a structured warning
 *   (ALLOC_CONSUMPTION_DATA_NOT_FOUND) rather than silently assumed — mirrors
 *   the locationResolutionWarning convention from #274. This issue only wires
 *   up the data fetch/availability reporting; consumption-capped allocation
 *   arithmetic is a separate step (#282).
 *
 * Korrekturlauf / Verteilregel-Versionierung (issue #286, gap identified in
 * #280): `allocate` accepts an optional `supersedesAllocationId` (+ mandatory
 * `correctionReason`) to mark a run as a correction of a prior run for the
 * same period (e.g. measured data corrected after the fact). The prior run
 * is marked `superseded`/`supersededBy`/`supersededAt` — never deleted — and
 * `list` excludes superseded runs by default (`includeSuperseded` to see
 * them). `get` on a superseded run still returns its full historical
 * metadata plus the pointer to its replacement.
 *
 *   KRITIS assessment (required by #286's own scoping, not pre-decided):
 *   the existing metadata-only retention (this doc: inputs, per-consumer
 *   SUMMARIES, the new supersede links) is sufficient for the Korrekturlauf
 *   audit trail. The audit question a Jahresabrechnung correction needs to
 *   answer is "which run replaced which run, and why" — answered entirely by
 *   `supersedesAllocationId`/`supersededBy`/`correctionReason`, never by
 *   re-examining raw 15-min values from an old run. Raw interval-level data
 *   remains re-derivable on demand via `download`/`billingReport` for as
 *   long as the underlying source data (forecast MCP tool, inhouse upload,
 *   or EDM) is still available — an existing, unchanged limitation, not a
 *   gap introduced or solved by this issue. No additional raw-series
 *   retention was added — that would conflict with the KRITIS
 *   data-minimization principle already established for this service.
 *
 * Regulatory basis: § 42c EnWG, § 12 StromNZV, § 20b EnWG (Interimsprozess, deadline 01.06.2026).
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const CernionMCPClient = require('../src/mcp-client');
const { runAsync } = require('../src/async-job-runner');
const {
  applyCursorPagination,
  applyOffsetDeprecationHeader,
  buildFilterHash,
  resolveTenantId,
} = require('../src/pagination');
const {
  buildIntervalGrid,
  mergeGeneratorForecasts,
  applyRedispatchDeductions,
  allocateTimeseries,
  allocateTimeseriesCappedByConsumption,
  buildConsumerSummary,
  buildConsumptionAwareConsumerSummary,
  buildTotalSummary,
  buildBillingReport,
  buildAnnualBillingReport,
  formatAsCsv,
  formatBillingReportAsCsv,
  RECOMMENDED_MAX_DAYS,
} = require('../src/timeseries-allocation');

const PIPELINE_VERSION = '0.16.0';
const MALO_REGEX = /^DE\d{31}$/;

// ---------------------------------------------------------------------------
// ALLOC Findings Stub (v0.20.5)
//
// The allocation engine is a Berechnungsengine (NOT an Agent) and does not
// follow the deterministic findings pipeline pattern. However, future versions
// may introduce quality-check findings for allocation results.
//
// The following ALLOC_* finding codes are CANDIDATES for a future sprint.
// They require domain-specific grounding (threshold values, regulatory basis)
// that has not yet been defined — marked as a gap for the next sprint.
//
// Candidate finding codes (not yet registered in FINDING_CODE_METADATA):
//   ALLOC_ZERO_ALLOCATION_CONSUMER
//     — Consumer receives 0 kWh in >X% of intervals (threshold TBD)
//     — Indicates misconfigured share percentages or generation shortfall
//   ALLOC_CONCENTRATION_RISK
//     — Single generator accounts for >Y% of total allocation (threshold TBD)
//     — Relevant for supply security assessment per § 42c EnWG
//   ALLOC_HIGH_REDISPATCH_DEDUCTION
//     — Redispatch deduction exceeds Z% of gross generation (threshold TBD)
//     — Financial impact warning for community participants
//   ALLOC_RESULT_DRIFT
//     — Allocation result differs >W% from previous run for same community
//       and date range (threshold TBD)
//     — Detects unexpected shifts in generation or share configuration
//   ALLOC_IMBALANCE_PERIOD
//     — Extended period (>N consecutive intervals) where total generation
//       is zero but consumers have demand (threshold TBD)
//     — Indicates Dunkelflaute exposure in the community
//
// When implementing, register codes in src/validation-findings.js under
// a new section "Energy Sharing Allocation (v0.X)" and add them to
// FINDING_CODE_METADATA with severity, step, description, descriptionDe.
//
// The existing `warnings[]` array with ALLOC_WINDOW_EXCEEDS_RECOMMENDED,
// ALLOC_VALIDATION_REPORT_NOT_APPROVED, etc. will remain as-is —
// findings would be a separate, richer structure.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

module.exports = {
  name: 'energy-sharing-allocation',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'ALLOCATION_ENGINE_DB_PATH',
      defaultDbPath: './data/allocation-engine',
      indexes: [['communityId'], ['createdAt'], ['tenantId']],
    }),
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: {
    /**
     * Calculate per-consumer 15-min allocation time-series for an Energy Sharing
     * community over a given date range.
     *
     * Returns metadata + per-consumer summaries. Full time-series is NOT returned
     * inline (KRITIS) — use GET /allocations/:id/download for the CSV export.
     */
    allocate: {
      rest: 'POST /allocate',
      timeout: 120_000,
      params: {
        communityId: { type: 'string', optional: true, default: '' },
        validationReportId: { type: 'string', optional: true, default: '' },
        // Korrekturlauf (#286): supersedesAllocationId marks this run as a
        // correction of a prior run for the same period (e.g. corrected
        // measured data). correctionReason is required whenever
        // supersedesAllocationId is set — never an unexplained correction.
        supersedesAllocationId: { type: 'string', optional: true, default: '' },
        correctionReason: { type: 'string', optional: true, default: '' },
        // generators/consumers are optional when communityId resolves to a
        // persisted community (#285) — stepValidateInput requires at least
        // one of {inline arrays, resolvable communityId}.
        generators: { type: 'array', items: 'object', optional: true, default: [] },
        consumers: { type: 'array', items: 'object', optional: true, default: [] },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        dataSource: { type: 'enum', values: ['forecast', 'inhouse'], default: 'forecast' },
        inhouseSourceId: { type: 'string', optional: true, default: '' },
        includeRedispatchDeduction: {
          type: 'boolean',
          optional: true,
          default: true,
          convert: true,
        },
        includeConsumptionData: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
        gridOperatorId: { type: 'string', optional: true, default: '' },
      },
      openapi: {
        summary: 'Calculate 15-min Energy Sharing allocation time-series (§ 42c EnWG)',
        description:
          'Executes a deterministic allocation pipeline: input validation → ' +
          'generation time-series fetch (Stufe A: forecast / Stufe B: inhouse metering) → ' +
          'optional EDM consumption-data availability check (#281, includeConsumptionData) → ' +
          'redispatch deduction → allocation arithmetic → summary assembly → PouchDB persist. ' +
          'Returns metadata and per-consumer summaries. Full 15-min time-series is available ' +
          'for download via GET /energy-sharing/allocations/:id/download. ' +
          'Regulatory basis: § 42c EnWG, § 12 StromNZV (Viertelstundenwerte), ' +
          '§ 20b EnWG Interimsprozess (operative deadline 01.06.2026). ' +
          'KRITIS constraint: raw generation data is never persisted — only metadata.',
        tags: ['Energy Sharing Allocation'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dateFrom', 'dateTo'],
                properties: {
                  communityId: {
                    type: 'string',
                    description:
                      'External community ID from VNB. Also used (#285) to resolve generators/' +
                      'consumers automatically from a persisted energy-sharing-community when ' +
                      'neither array is provided inline — see generators/consumers below.',
                    example: 'ES-2026-001',
                  },
                  validationReportId: {
                    type: 'string',
                    description:
                      'Optional v0.15 validation report UUID — skips redundant generator/consumer validation when set',
                    example: 'a1b2c3d4-...',
                  },
                  supersedesAllocationId: {
                    type: 'string',
                    description:
                      'Korrekturlauf (#286): UUID of a prior allocation this run corrects/replaces ' +
                      '(e.g. after measured data was corrected). The prior run is marked superseded ' +
                      '(never deleted — full audit trail preserved) and linked to this run. Requires ' +
                      'correctionReason. Omit for a normal, non-correction run (default behavior).',
                    example: 'b2c3d4e5-...',
                  },
                  correctionReason: {
                    type: 'string',
                    description:
                      'Required when supersedesAllocationId is set — never an unexplained correction.',
                    example: 'Korrigierte Verbrauchsdaten für Müller (DE000...) nachgemeldet',
                  },
                  generators: {
                    type: 'array',
                    items: { type: 'object' },
                    description:
                      'Generator list with mastrNummer and sharePercent (must sum to 100). ' +
                      'Optional (#285) when communityId resolves to a persisted community with ' +
                      'active generator members for the requested period — required otherwise.',
                    example: [{ mastrNummer: 'SEE904837264953', sharePercent: 100 }],
                  },
                  consumers: {
                    type: 'array',
                    items: { type: 'object' },
                    description:
                      'Consumer list with maloId, sharePercent (must sum to 100), optional name. ' +
                      'Optional (#285) when communityId resolves to a persisted community with ' +
                      'active consumer members for the requested period — required otherwise.',
                    example: [
                      {
                        maloId: 'DE0001234567890123456789012345678',
                        sharePercent: 100,
                        name: 'Whg. 1',
                      },
                    ],
                  },
                  dateFrom: {
                    type: 'string',
                    description: 'Start date (inclusive), ISO-8601 date',
                    example: '2026-06-01',
                  },
                  dateTo: {
                    type: 'string',
                    description: 'End date (inclusive), ISO-8601 date',
                    example: '2026-06-30',
                  },
                  dataSource: {
                    type: 'string',
                    enum: ['forecast', 'inhouse'],
                    default: 'forecast',
                    description:
                      'Stufe A: synthetic forecast (default); Stufe B: real metering data from inhouse CSV upload',
                  },
                  inhouseSourceId: {
                    type: 'string',
                    description:
                      'datasource-cache sourceId for Stufe B (required when dataSource=inhouse)',
                    example: 'pv-generation-es-2026-001',
                  },
                  includeRedispatchDeduction: {
                    type: 'boolean',
                    default: true,
                    description:
                      'Apply Redispatch 2.0 deductions (affected intervals → generation = 0)',
                  },
                  includeConsumptionData: {
                    type: 'boolean',
                    default: false,
                    description:
                      "Opt-in (#281): look up each consumer's EDM consumption timeseries " +
                      '(services/edm.service.js, OBIS 1-0:1.8.0) for the same date range. ' +
                      'Does not change the allocation arithmetic — only reports per-consumer ' +
                      'data availability via consumptionStatus[] and warnings[]. A consumer ' +
                      'without a matching EDM timeseries is reported via ' +
                      'ALLOC_CONSUMPTION_DATA_NOT_FOUND, never silently treated as zero.',
                  },
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR grid operator ID (SNB...) for redispatch context lookup',
                    example: 'SNB935578300972',
                  },
                },
              },
              examples: {
                'Solar community — forecast, 7 days': {
                  value: {
                    communityId: 'ES-2026-001',
                    generators: [{ mastrNummer: 'SEE904837264953', sharePercent: 100 }],
                    consumers: [
                      {
                        maloId: 'DE0001234567890123456789012345678',
                        sharePercent: 30,
                        name: 'Müller',
                      },
                      {
                        maloId: 'DE0009876543210987654321098765432',
                        sharePercent: 70,
                        name: 'Schmidt',
                      },
                    ],
                    dateFrom: '2026-06-01',
                    dateTo: '2026-06-07',
                    dataSource: 'forecast',
                    includeRedispatchDeduction: true,
                    gridOperatorId: 'SNB935578300972',
                  },
                },
                'Inhouse metering data (Stufe B)': {
                  value: {
                    communityId: 'ES-2026-002',
                    generators: [{ mastrNummer: 'SEE904837264953', sharePercent: 100 }],
                    consumers: [
                      {
                        maloId: 'DE0001234567890123456789012345678',
                        sharePercent: 50,
                        name: 'Haus A',
                      },
                      {
                        maloId: 'DE0009876543210987654321098765432',
                        sharePercent: 50,
                        name: 'Haus B',
                      },
                    ],
                    dateFrom: '2026-06-01',
                    dateTo: '2026-06-07',
                    dataSource: 'inhouse',
                    inhouseSourceId: 'pv-generation-es-2026-002',
                    includeRedispatchDeduction: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description:
              'REST/Gateway call accepted as async job. Poll /api/jobs/:jobId/status and /api/jobs/:jobId/result.',
            content: {
              'application/json': {
                example: {
                  success: true,
                  jobId: 'f8d2d8d4-4f22-4a0a-bec7-a9f05ad6b9e6',
                  status: 'queued',
                  statusUrl: '/api/jobs/f8d2d8d4-4f22-4a0a-bec7-a9f05ad6b9e6/status',
                  resultUrl: '/api/jobs/f8d2d8d4-4f22-4a0a-bec7-a9f05ad6b9e6/result',
                },
              },
            },
          },
          200: {
            description:
              'Allocation metadata with per-consumer summaries. Time-series available via /download endpoint.',
            content: {
              'application/json': {
                example: {
                  success: true,
                  id: 'b2c3d4e5-...',
                  communityId: 'ES-2026-001',
                  dateFrom: '2026-06-01',
                  dateTo: '2026-06-07',
                  dataSource: 'forecast',
                  redispatchApplied: false,
                  warnings: [],
                  consumers: [
                    {
                      maloId: 'DE0001234567890123456789012345678',
                      name: 'Müller',
                      sharePercent: 30,
                      totalKWh: 37.62,
                      peakKW: 0.84,
                      zeroIntervals: 288,
                      intervalCount: 672,
                    },
                    {
                      maloId: 'DE0009876543210987654321098765432',
                      name: 'Schmidt',
                      sharePercent: 70,
                      totalKWh: 87.78,
                      peakKW: 1.96,
                      zeroIntervals: 288,
                      intervalCount: 672,
                    },
                  ],
                  summary: {
                    totalGenerationKWh: 125.4,
                    totalRedispatchDeductionKWh: 0,
                    totalNetGenerationKWh: 125.4,
                    intervalCount: 672,
                    durationMs: 6500,
                  },
                  consumptionStatus: [
                    {
                      maloId: 'DE0001234567890123456789012345678',
                      found: true,
                      intervalCount: 672,
                      totalKWh: 41.2,
                    },
                    {
                      maloId: 'DE0009876543210987654321098765432',
                      found: false,
                      intervalCount: 0,
                      totalKWh: null,
                    },
                  ],
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return runAsync(ctx, {
          service: 'energy-sharing-allocation',
          action: 'allocate',
          params: ctx.params,
          worker: async () => {
            const t0 = Date.now();
            const token = ctx.meta?.cernionToken;
            const params = ctx.params;
            const callOpts = { meta: { ...ctx.meta, $gateway: false } };

            // ── Step 1: Input validation ──────────────────────────────────────
            const { warnings, generators, consumers } = await this.stepValidateInput(
              ctx,
              params,
              callOpts
            );

            // ── Step 2: Fetch generation time-series ─────────────────────────
            const grid =
              params.dataSource === 'inhouse'
                ? await this.stepFetchGenerationInhouseCtx(
                    ctx,
                    buildIntervalGrid(params.dateFrom, params.dateTo),
                    params
                  )
                : await this.stepFetchGeneration(params, generators, token);

            // ── Step 3: Redispatch deduction ─────────────────────────────────
            const redispatchApplied = await this.stepRedispatchDeduction(
              grid,
              params,
              token,
              warnings
            );

            // ── Step 3b: Consumption-data availability check (#281, opt-in) ───
            // Data-fetch only — does not change the allocation arithmetic below.
            // Consumption-capped allocation is a separate step (#282).
            let consumptionStatus = null;
            if (params.includeConsumptionData) {
              const consumptionResult = await this.stepFetchConsumptionEdm(
                ctx,
                params,
                consumers,
                callOpts
              );
              consumptionStatus = consumptionResult.consumptionStatus;
              warnings.push(...consumptionResult.warnings);
            }

            // ── Step 4: Allocation arithmetic ────────────────────────────────
            allocateTimeseries(grid, consumers);

            // ── Step 5: Summary assembly ─────────────────────────────────────
            const consumerSummaries = buildConsumerSummary(grid, consumers);
            const totalSummary = buildTotalSummary(
              grid,
              params.dateFrom,
              params.dateTo,
              params.dataSource || 'forecast',
              Date.now() - t0
            );

            // ── Step 6: Persist metadata (KRITIS: grid NOT stored) ───────────
            const id = crypto.randomUUID();
            const tenantId = resolveTenantId(ctx) || 'default';
            // Tenant-isolation: prefix _id with tenantId (v0.47)
            const docId = tenantId !== 'default' ? `alloc:${tenantId}:${id}` : `alloc:${id}`;
            const doc = {
              _id: docId,
              id,
              tenantId,
              type: 'energy-sharing-allocation',
              communityId: params.communityId || '',
              validationReportId: params.validationReportId || null,
              dateFrom: params.dateFrom,
              dateTo: params.dateTo,
              dataSource: params.dataSource || 'forecast',
              inhouseSourceId: params.inhouseSourceId || null,
              gridOperatorId: params.gridOperatorId || null,
              generators: generators.map((g) => ({
                mastrNummer: g.mastrNummer,
                sharePercent: g.sharePercent,
              })),
              consumers: consumerSummaries,
              summary: totalSummary,
              redispatchApplied,
              consumptionStatus,
              warnings,
              // Korrekturlauf-Versionierung (#286) — supersedesAllocationId
              // links this run to the prior run it corrects; superseded/
              // supersededBy/supersededAt are set on the PRIOR run below,
              // never on this (the newest) run.
              supersedesAllocationId: params.supersedesAllocationId || null,
              correctionReason: params.correctionReason || null,
              superseded: false,
              supersededBy: null,
              supersededAt: null,
              _deleted: false,
              markedDeleted: false,
              metadata: {
                pipelineVersion: PIPELINE_VERSION,
                executedAt: new Date().toISOString(),
                regulatoryBasis: '§ 42c EnWG, § 12 StromNZV',
              },
              createdAt: new Date().toISOString(),
            };

            await this.db.put(doc);

            // Mark the prior run as superseded — never deleted, full audit
            // trail preserved (#286). Done after the new run is durably
            // persisted, so a failure here never leaves an orphaned new run
            // without its prior-run link already saved.
            if (params.supersedesAllocationId) {
              const priorDoc = await this.db.get(`alloc:${params.supersedesAllocationId}`);
              priorDoc.superseded = true;
              priorDoc.supersededBy = id;
              priorDoc.supersededAt = new Date().toISOString();
              await this.db.put(priorDoc);
            }

            return {
              success: true,
              id,
              communityId: doc.communityId,
              validationReportId: doc.validationReportId,
              dateFrom: doc.dateFrom,
              dateTo: doc.dateTo,
              dataSource: doc.dataSource,
              redispatchApplied,
              consumptionStatus,
              warnings,
              supersedesAllocationId: doc.supersedesAllocationId,
              correctionReason: doc.correctionReason,
              generators: doc.generators,
              consumers: consumerSummaries,
              summary: totalSummary,
              metadata: doc.metadata,
            };
          },
        });
      },
    },

    /**
     * List past allocation records (newest first).
     * Soft-deleted records are excluded by default.
     */
    list: {
      rest: 'GET /allocations',
      params: {
        communityId: { type: 'string', optional: true },
        includeDeleted: { type: 'boolean', optional: true, default: false, convert: true },
        includeSuperseded: { type: 'boolean', optional: true, default: false, convert: true },
        limit: { type: 'number', optional: true, default: 50, convert: true, max: 200 },
        cursor: { type: 'string', optional: true },
        offset: { type: 'number', optional: true, convert: true, min: 0 },
      },
      openapi: {
        summary: 'List past Energy Sharing allocation records',
        description:
          'Returns allocation metadata records stored in PouchDB, newest first. Soft-deleted ' +
          'records are excluded unless includeDeleted=true. Superseded records (replaced by a ' +
          'later Korrekturlauf, #286) are excluded unless includeSuperseded=true.',
        tags: ['Energy Sharing Allocation'],
        parameters: [
          {
            name: 'communityId',
            in: 'query',
            schema: { type: 'string', example: 'ES-2026-001' },
            description: 'Filter by external community ID',
          },
          {
            name: 'includeDeleted',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Include soft-deleted records (for audit access)',
          },
          {
            name: 'includeSuperseded',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description:
              'Include records that were superseded by a later Korrekturlauf (#286, for audit access)',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, maximum: 100 },
            description: 'Maximum number of results',
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'eyJvZmZzZXQiOjIwfQ==' },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0, example: 0 },
          },
        ],
        responses: {
          200: {
            description: 'Paginated list of allocation metadata summaries',
            content: {
              'application/json': {
                example: {
                  count: 1,
                  allocations: [
                    {
                      id: '...',
                      communityId: 'ES-2026-001',
                      dateFrom: '2026-06-01',
                      dateTo: '2026-06-07',
                      dataSource: 'forecast',
                      redispatchApplied: false,
                      createdAt: '2026-06-01T...',
                    },
                  ],
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'alloc:',
          endkey: 'alloc:\ufff0',
        });

        let docs = result.rows.map((r) => r.doc);

        if (!ctx.params.includeDeleted) {
          docs = docs.filter((d) => !d.markedDeleted);
        }

        if (!ctx.params.includeSuperseded) {
          docs = docs.filter((d) => !d.superseded);
        }

        if (ctx.params.communityId) {
          docs = docs.filter((d) => d.communityId === ctx.params.communityId);
        }

        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        const tenantId = resolveTenantId(ctx);
        const filterHash = buildFilterHash({
          communityId: ctx.params.communityId || null,
          includeDeleted: !!ctx.params.includeDeleted,
          includeSuperseded: !!ctx.params.includeSuperseded,
        });
        const page = applyCursorPagination({
          items: docs,
          limit: ctx.params.limit,
          cursor: ctx.params.cursor,
          offset: ctx.params.offset,
          tenantId,
          filterHash,
        });
        applyOffsetDeprecationHeader(ctx, ctx.params.offset != null);

        return {
          count: page.data.length,
          allocations: page.data.map((d) => ({
            id: d.id,
            communityId: d.communityId,
            validationReportId: d.validationReportId || null,
            dateFrom: d.dateFrom,
            dateTo: d.dateTo,
            dataSource: d.dataSource,
            redispatchApplied: d.redispatchApplied,
            warnings: d.warnings || [],
            intervalCount: d.summary?.intervalCount,
            totalNetGenerationKWh: d.summary?.totalNetGenerationKWh,
            durationMs: d.summary?.durationMs,
            createdAt: d.createdAt,
            _deleted: d.markedDeleted || false,
            supersedesAllocationId: d.supersedesAllocationId || null,
            correctionReason: d.correctionReason || null,
            superseded: d.superseded || false,
            supersededBy: d.supersededBy || null,
            supersededAt: d.supersededAt || null,
          })),
          pageInfo: page.pageInfo,
        };
      },
    },

    /**
     * Retrieve a single allocation record by ID (metadata only).
     */
    get: {
      rest: 'GET /allocations/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get a specific Energy Sharing allocation record by ID',
        description:
          'Returns the full allocation metadata including per-consumer summaries, warnings, and pipeline metadata. Time-series must be re-fetched via /download.',
        tags: ['Energy Sharing Allocation'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'b2c3d4e5-...' },
            description: 'Allocation UUID',
          },
        ],
        responses: {
          200: { description: 'Full allocation metadata document' },
          404: { description: 'Allocation not found' },
        },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`alloc:${ctx.params.id}`);
          return { success: true, ...doc };
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Allocation ${ctx.params.id} not found` };
          }
          throw err;
        }
      },
    },

    /**
     * Download per-consumer 15-min time-series as EDM-importable CSV.
     * Time-series is re-computed on demand (KRITIS: never persisted).
     */
    download: {
      rest: 'GET /allocations/:id/download',
      params: {
        id: { type: 'string' },
        maloId: { type: 'string' },
        format: { type: 'string', optional: true, default: 'csv' },
      },
      openapi: {
        summary: 'Download per-consumer allocation time-series as CSV (EDM-importable)',
        description:
          'Re-computes the 15-min allocation time-series on demand and returns a semicolon-delimited CSV. ' +
          'One row per 15-min interval. Columns: timestamp;generation_kwh;redispatch_deduction_kwh;net_generation_kwh;allocation_kwh. ' +
          'KRITIS: time-series is never persisted — this endpoint re-runs the computation from stored metadata.',
        tags: ['Energy Sharing Allocation'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'b2c3d4e5-f6a7-b8c9-d0e1-f2a3b4c5d6e7' },
            description: 'Allocation UUID',
          },
          {
            name: 'maloId',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'DE0001234567890123456789012345678' },
            description: 'Consumer MaLo-ID to export',
          },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', default: 'csv' },
            description: 'Output format (currently only "csv" supported)',
          },
        ],
        responses: {
          200: {
            description: 'Semicolon-delimited CSV file, one row per 15-min interval',
            content: { 'text/csv': {} },
          },
          404: { description: 'Allocation not found or maloId not part of this allocation' },
        },
      },
      async handler(ctx) {
        const { id, maloId } = ctx.params;
        const token = ctx.meta?.cernionToken;

        // Load metadata
        let doc;
        try {
          doc = await this.db.get(`alloc:${id}`);
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Allocation ${id} not found` };
          }
          throw err;
        }

        if (doc.markedDeleted) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Allocation ${id} has been deleted` };
        }

        // Verify maloId is part of this allocation
        const consumerEntry = (doc.consumers || []).find((c) => c.maloId === maloId);
        if (!consumerEntry) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Consumer ${maloId} is not part of allocation ${id}` };
        }

        // Re-compute time-series from stored metadata
        const { grid, consumers } = await this.stepReplayGenerationGrid(doc, token);

        allocateTimeseries(grid, consumers);

        const csv = formatAsCsv(grid, maloId);

        ctx.meta.$responseType = 'text/csv';
        ctx.meta.$responseHeaders = {
          'Content-Disposition': `attachment; filename="allocation-${id}-${maloId}.csv"`,
        };
        return csv;
      },
    },

    /**
     * Monthly billing report for an existing allocation (#284, sub-issue of #280).
     *
     * Replays the allocation's generation grid, fetches each consumer's EDM
     * consumption (#281), runs consumption-capped allocation (#282), builds
     * the Restmenge/Überschuss aggregation (#283), and applies the supplied
     * tariff to produce a billing report. Never persists the report itself —
     * re-derived on demand, same KRITIS data-minimization stance as `download`.
     */
    billingReport: {
      rest: 'POST /allocations/:id/billing-report',
      timeout: 120_000,
      params: {
        id: { type: 'string' },
        tariffEurPerKWh: { type: 'number', convert: true, positive: true },
        format: { type: 'enum', values: ['json', 'csv'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Monthly billing report for an existing allocation (kWh → EUR, #284)',
        description:
          "Replays the allocation, fetches each consumer's EDM consumption timeseries, caps the " +
          'quota-based allocation at actual consumption (#282), aggregates Restmenge/Überschuss per ' +
          'consumer (#283), and applies `tariffEurPerKWh` to produce a billing report. Only ' +
          'allocatedKWh (internal solar share actually used) is billed — remainderKWh (grid draw) is ' +
          'reported for transparency but never billed here. A consumer with no EDM consumption data ' +
          'for the period gets billingAmountEur: null, never a misleading €0.00.',
        tags: ['Energy Sharing Allocation'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'b2c3d4e5-f6a7-b8c9-d0e1-f2a3b4c5d6e7' },
            description: 'Allocation UUID',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tariffEurPerKWh'],
                properties: {
                  tariffEurPerKWh: {
                    type: 'number',
                    description:
                      'Internal price per kWh of allocated solar — required input, never a hardcoded default.',
                    example: 0.25,
                  },
                  format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
                },
              },
              examples: {
                default: {
                  value: { tariffEurPerKWh: 0.25 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Billing report (JSON) or semicolon-delimited CSV export' },
          404: { description: 'Allocation not found' },
        },
      },
      async handler(ctx) {
        const { id, tariffEurPerKWh, format } = ctx.params;
        const token = ctx.meta?.cernionToken;
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };

        let doc;
        try {
          doc = await this.db.get(`alloc:${id}`);
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Allocation ${id} not found` };
          }
          throw err;
        }
        if (doc.markedDeleted) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Allocation ${id} has been deleted` };
        }

        const { grid, consumers, replayParams } = await this.stepReplayGenerationGrid(doc, token);
        const consumptionResult = await this.stepFetchConsumptionEdm(
          ctx,
          replayParams,
          consumers,
          callOpts
        );

        allocateTimeseriesCappedByConsumption(grid, consumers, consumptionResult.consumptionByMalo);
        const consumerSummaries = buildConsumptionAwareConsumerSummary(grid, consumers);
        const report = buildBillingReport(consumerSummaries, {
          tariffEurPerKWh,
          periodFrom: doc.dateFrom,
          periodTo: doc.dateTo,
          allocationId: id,
        });

        if (format === 'csv') {
          const csv = formatBillingReportAsCsv(report);
          ctx.meta.$responseType = 'text/csv';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': `attachment; filename="billing-report-${id}.csv"`,
          };
          return csv;
        }

        return { success: true, ...report, consumptionWarnings: consumptionResult.warnings };
      },
    },

    /**
     * Annual billing report — replays and bills N (typically 12) monthly
     * allocations and sums them per consumer (#284, sub-issue of #280).
     */
    annualBillingReport: {
      rest: 'POST /annual-billing-report',
      timeout: 600_000,
      params: {
        allocationIds: { type: 'array', items: 'string', min: 1, max: 12 },
        tariffEurPerKWh: { type: 'number', convert: true, positive: true },
        format: { type: 'enum', values: ['json', 'csv'], optional: true, default: 'json' },
      },
      openapi: {
        summary: 'Annual billing report — sums N monthly allocations per consumer (#284)',
        description:
          'Replays and bills each allocation in `allocationIds` (same logic as billingReport, one ' +
          'call per ID) using the same tariffEurPerKWh, then sums the results per consumer. A ' +
          'consumer missing data in some months is summed only over the months that have data — ' +
          'monthsWithData/monthsWithoutData/complete report the coverage transparently, never masking ' +
          'an incomplete year as a complete one.',
        tags: ['Energy Sharing Allocation'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['allocationIds', 'tariffEurPerKWh'],
                properties: {
                  allocationIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Allocation UUIDs to sum, typically 12 monthly runs.',
                    example: ['alloc-jan', 'alloc-feb'],
                  },
                  tariffEurPerKWh: { type: 'number', example: 0.25 },
                  format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
                },
              },
              examples: {
                default: {
                  value: { allocationIds: ['alloc-jan', 'alloc-feb'], tariffEurPerKWh: 0.25 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Annual billing report (JSON) or semicolon-delimited CSV export' },
          404: { description: 'One of the referenced allocations was not found' },
        },
      },
      async handler(ctx) {
        const { allocationIds, tariffEurPerKWh, format } = ctx.params;
        const token = ctx.meta?.cernionToken;
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };

        const monthlyReports = [];
        for (const id of allocationIds) {
          let doc;
          try {
            doc = await this.db.get(`alloc:${id}`);
          } catch (err) {
            ctx.meta.$statusCode = 404;
            throw new Error(`Allocation ${id} not found: ${err.message}`);
          }

          const { grid, consumers, replayParams } = await this.stepReplayGenerationGrid(doc, token);
          const consumptionResult = await this.stepFetchConsumptionEdm(
            ctx,
            replayParams,
            consumers,
            callOpts
          );
          allocateTimeseriesCappedByConsumption(
            grid,
            consumers,
            consumptionResult.consumptionByMalo
          );
          const consumerSummaries = buildConsumptionAwareConsumerSummary(grid, consumers);
          monthlyReports.push(
            buildBillingReport(consumerSummaries, {
              tariffEurPerKWh,
              periodFrom: doc.dateFrom,
              periodTo: doc.dateTo,
              allocationId: id,
            })
          );
        }

        const annualReport = buildAnnualBillingReport(monthlyReports);

        if (format === 'csv') {
          const csv = formatBillingReportAsCsv(annualReport);
          ctx.meta.$responseType = 'text/csv';
          ctx.meta.$responseHeaders = {
            'Content-Disposition': 'attachment; filename="annual-billing-report.csv"',
          };
          return csv;
        }

        return { success: true, ...annualReport };
      },
    },

    /**
     * Soft-delete an allocation record (sets _deleted flag, retains document for audit trail).
     */
    remove: {
      rest: 'DELETE /allocations/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Soft-delete an Energy Sharing allocation record',
        description:
          'Marks the allocation record as deleted (_deleted: true) without removing it from PouchDB. ' +
          'The record remains accessible for audit purposes via GET /allocations/:id?includeDeleted=true. ' +
          'EU AI Act Art. 12 compliance: deletion is non-destructive.',
        tags: ['Energy Sharing Allocation'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Allocation UUID to soft-delete',
          },
        ],
        responses: {
          200: { description: 'Soft-delete confirmed' },
          404: { description: 'Allocation not found' },
        },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`alloc:${ctx.params.id}`);
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Allocation ${ctx.params.id} not found` };
          }
          throw err;
        }

        if (doc.markedDeleted) {
          return { success: true, message: 'Allocation was already deleted', id: ctx.params.id };
        }

        doc.markedDeleted = true;
        doc._deleted = undefined; // ensure no PouchDB tombstone field
        doc.deletedAt = new Date().toISOString();
        await this.db.put(doc);

        return { success: true, id: ctx.params.id, deletedAt: doc.deletedAt };
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Methods — pipeline steps and helpers
  // ---------------------------------------------------------------------------
  methods: {
    /**
     * Thin MCP call wrapper — one session per call, token from ctx or env.
     */
    async callMcp(toolName, params, token) {
      return CernionMCPClient.callWithNewSession(toolName, params, token);
    },

    // ── Step 1 ─────────────────────────────────────────────────────────────

    /**
     * Validate request inputs.
     *
     * - Share-sum check for generators (±0.1% tolerance)
     * - Share-sum check for consumers (±0.1% tolerance)
     * - MaLo-ID format check
     * - Date range sanity
     * - Optional: load v0.15 validation report via broker call (no cross-DB access)
     * - >31-day window → soft warning (pipeline continues)
     *
     * Returns { warnings[], generators[], consumers[] } — generators/consumers may
     * be enriched with v0.15 report data if validationReportId was provided.
     *
     * @param {Context} ctx
     * @param {object} params
     * @param {object} callOpts
     */
    async stepValidateInput(ctx, params, callOpts) {
      const warnings = [];
      let { generators, consumers } = params;

      // ── Date range ──────────────────────────────────────────────────────
      const dateFrom = new Date(`${params.dateFrom}T00:00:00Z`);
      const dateTo = new Date(`${params.dateTo}T00:00:00Z`);

      if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
        throw new Error(
          'Invalid dateFrom or dateTo — expected ISO-8601 date strings (e.g. "2026-06-01")'
        );
      }
      if (dateFrom > dateTo) {
        throw new Error('dateFrom must be ≤ dateTo');
      }

      const daysDelta = Math.round((dateTo - dateFrom) / (24 * 60 * 60 * 1000)) + 1;
      if (daysDelta > RECOMMENDED_MAX_DAYS) {
        warnings.push({
          code: 'ALLOC_WINDOW_EXCEEDS_RECOMMENDED',
          message:
            `Date range spans ${daysDelta} days — recommended maximum is ${RECOMMENDED_MAX_DAYS}. ` +
            'Calculation may take longer. Consider splitting into monthly batches.',
        });
      }

      // ── Derive generators/consumers from a persisted community (#285) ───
      // Additive only: inline generators/consumers (validated below) always
      // take precedence and remain fully supported unchanged. This path only
      // activates when BOTH arrays are empty and communityId is set.
      if ((!generators || generators.length === 0) && (!consumers || consumers.length === 0)) {
        if (params.communityId) {
          let resolved = null;
          try {
            resolved = await ctx.call(
              'energy-sharing-community.resolveActiveMembers',
              { id: params.communityId, dateFrom: params.dateFrom, dateTo: params.dateTo },
              callOpts
            );
          } catch (err) {
            this.logger.debug(
              `stepValidateInput: community resolution failed for "${params.communityId}": ${err.message}`
            );
          }
          if (resolved?.success) {
            generators = resolved.generators;
            consumers = resolved.consumers;
            warnings.push({
              code: 'ALLOC_GENERATORS_CONSUMERS_RESOLVED_FROM_COMMUNITY',
              message:
                `Resolved ${resolved.activeMemberCount} active member(s) from community ` +
                `"${params.communityId}" for ${params.dateFrom}..${params.dateTo} ` +
                '(no inline generators/consumers were provided).',
            });
          } else {
            throw new Error(
              `No inline generators/consumers were provided and communityId "${params.communityId}" ` +
                'could not be resolved to a persisted Energy Sharing community. Provide generators/' +
                'consumers inline, or create the community first via energy-sharing-community.createCommunity.'
            );
          }
        }
      }

      // ── Generator share sum ─────────────────────────────────────────────
      if (!generators || generators.length === 0) {
        throw new Error('At least one generator is required');
      }
      const genShareSum = generators.reduce((s, g) => s + (g.sharePercent || 0), 0);
      if (Math.abs(genShareSum - 100) > 0.1) {
        throw new Error(
          `Generator sharePercent values must sum to 100 (got ${genShareSum.toFixed(2)})`
        );
      }

      // ── Consumer validation ─────────────────────────────────────────────
      if (!consumers || consumers.length === 0) {
        throw new Error('At least one consumer is required');
      }
      const conShareSum = consumers.reduce((s, c) => s + (c.sharePercent || 0), 0);
      if (Math.abs(conShareSum - 100) > 0.1) {
        throw new Error(
          `Consumer sharePercent values must sum to 100 (got ${conShareSum.toFixed(2)})`
        );
      }

      const seenMalos = new Set();
      for (const consumer of consumers) {
        if (!MALO_REGEX.test(consumer.maloId)) {
          throw new Error(
            `Invalid MaLo-ID format: "${consumer.maloId}" — expected DE followed by 31 digits`
          );
        }
        if (seenMalos.has(consumer.maloId)) {
          throw new Error(`Duplicate MaLo-ID: ${consumer.maloId}`);
        }
        seenMalos.add(consumer.maloId);
      }

      // ── Optional: enrich from v0.15 validation report ───────────────────
      if (params.validationReportId) {
        try {
          const report = await ctx.call(
            'energy-sharing.get',
            { id: params.validationReportId },
            callOpts
          );
          if (report && report.success && report.decision === 'APPROVED') {
            this.logger.debug(
              `stepValidateInput: loaded v0.15 report ${params.validationReportId} — decision: APPROVED`
            );
          } else if (report && report.success) {
            warnings.push({
              code: 'ALLOC_VALIDATION_REPORT_NOT_APPROVED',
              message: `Referenced v0.15 validation report ${params.validationReportId} has decision "${report.decision}" — proceeding with allocation anyway.`,
            });
          }
        } catch (err) {
          warnings.push({
            code: 'ALLOC_VALIDATION_REPORT_NOT_FOUND',
            message: `Could not load v0.15 report "${params.validationReportId}": ${err.message}. Continuing without it.`,
          });
        }
      }

      // ── Korrekturlauf validation (#286) ──────────────────────────────────
      // Fail fast, before the (potentially expensive) generation fetch below:
      // correctionReason is mandatory whenever supersedesAllocationId is set
      // — never an unexplained correction — and the prior run must exist.
      if (params.supersedesAllocationId) {
        if (!params.correctionReason || !params.correctionReason.trim()) {
          throw new Error(
            'correctionReason is required when supersedesAllocationId is set — explain why this run corrects the prior one.'
          );
        }
        let priorDoc;
        try {
          priorDoc = await this.db.get(`alloc:${params.supersedesAllocationId}`);
        } catch (err) {
          throw new Error(
            `supersedesAllocationId "${params.supersedesAllocationId}" does not reference an existing allocation: ${err.message}`
          );
        }
        if (priorDoc.superseded) {
          throw new Error(
            `Allocation "${params.supersedesAllocationId}" was already superseded by "${priorDoc.supersededBy}" — supersede the latest run in the chain instead.`
          );
        }
      }

      return { warnings, generators, consumers };
    },

    // ── Step 2 ─────────────────────────────────────────────────────────────

    /**
     * Fetch generation time-series.
     *
     * Stufe A (default): calls mastr_generation_forecast per generator.
     * Stufe B (inhouse):  loads CSV from datasource-cache and parses it.
     *
     * Returns a fully populated interval grid with generationKWh filled.
     */
    async stepFetchGeneration(params, generators, token) {
      const grid = buildIntervalGrid(params.dateFrom, params.dateTo);
      const daysDelta =
        Math.round(
          (new Date(`${params.dateTo}T00:00:00Z`) - new Date(`${params.dateFrom}T00:00:00Z`)) /
            (24 * 60 * 60 * 1000)
        ) + 1;

      if (params.dataSource === 'inhouse') {
        return this.stepFetchGenerationInhouse(grid, params);
      }

      // ── Stufe A: forecast ───────────────────────────────────────────────
      const genForecasts = [];
      for (const gen of generators) {
        let forecastIntervals = [];
        try {
          const result = await this.callMcp(
            'mastr_generation_forecast',
            {
              installationMastrNummer: gen.mastrNummer,
              startDate: params.dateFrom,
              forecastDays: daysDelta,
              resolution: '15min',
            },
            token
          );

          // mastr_generation_forecast returns { data: [ { timestamp, generationMW, ... } ] }
          const rawIntervals = result?.data || result?.intervals || result?.forecast || [];
          forecastIntervals = Array.isArray(rawIntervals)
            ? rawIntervals.map((fi) => ({
                timestamp: fi.timestamp,
                generationMW: fi.generationMW ?? fi.generation_mw ?? 0,
                generationKWh: fi.generationKWh ?? fi.generation_kwh ?? null,
              }))
            : [];
        } catch (err) {
          this.logger.warn(
            `stepFetchGeneration: forecast call failed for ${gen.mastrNummer} — using zero profile. ${err.message}`
          );
          // Zero profile: all intervals remain at 0 (conservative fallback)
        }

        genForecasts.push({ sharePercent: gen.sharePercent, forecastIntervals });
      }

      mergeGeneratorForecasts(grid, genForecasts);
      return grid;
    },

    /**
     * Stufe B (with broker context): fetch and parse inhouse metering CSV.
     * Called from allocate handler directly when dataSource === 'inhouse'.
     */
    async stepFetchGenerationInhouseCtx(ctx, grid, params) {
      if (!params.inhouseSourceId) {
        throw new Error('inhouseSourceId is required when dataSource is "inhouse"');
      }

      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      const response = await ctx.call(
        'datasource-cache.query',
        {
          sourceId: params.inhouseSourceId,
          privacyContext: 'internal',
        },
        callOpts
      );

      const rows = response?.data?.rows || response?.rows || [];
      if (rows.length === 0) {
        throw new Error(`No data found in inhouse source "${params.inhouseSourceId}"`);
      }

      // Validate schema: require 'timestamp' and 'generation_kwh' columns
      const firstRow = rows[0];
      const keys = Object.keys(firstRow).map((k) => k.toLowerCase());
      if (!keys.includes('timestamp')) {
        throw new Error(`Inhouse CSV schema error: missing required column "timestamp"`);
      }
      if (!keys.includes('generation_kwh')) {
        throw new Error(`Inhouse CSV schema error: missing required column "generation_kwh"`);
      }

      // Build lookup map from grid
      const indexMap = new Map();
      for (let i = 0; i < grid.length; i++) {
        indexMap.set(grid[i].timestamp, i);
      }

      let misaligned = 0;
      for (const row of rows) {
        const ts = row.timestamp || row.Timestamp;
        const kwh = parseFloat(row.generation_kwh || row.Generation_kwh || 0);
        if (!ts) continue;

        // Normalize timestamp to ISO-8601
        const normalizedTs = new Date(ts).toISOString();
        const idx = indexMap.get(normalizedTs);
        if (idx === undefined) {
          misaligned++;
          continue;
        }
        grid[idx].generationKWh += kwh;
      }

      if (misaligned > 0) {
        this.logger.warn(
          `stepFetchGenerationInhouseCtx: ${misaligned} rows had timestamps that do not align to the 15-min grid — skipped`
        );
      }

      // Recompute net (before redispatch)
      for (const interval of grid) {
        interval.netGenerationKWh = interval.generationKWh;
      }

      return grid;
    },

    // ── Step 3b (#281) ───────────────────────────────────────────────────────

    /**
     * Opt-in EDM consumption-data lookup, one MeLo per consumer.
     *
     * Data-fetch and availability-reporting only — does NOT change the
     * allocation arithmetic (consumption-capped allocation is #282). A
     * consumer whose maloId has no EDM timeseries for the requested period
     * (MeLo never registered in EDM, or registered but no rows in range) is
     * reported via a structured ALLOC_CONSUMPTION_DATA_NOT_FOUND warning —
     * never silently treated as zero or skipped. Mirrors the
     * locationResolutionWarning convention from #274
     * (services/energy-market.service.js / services/assets.service.js).
     *
     * @param {Context} ctx
     * @param {object} params — allocation params (dateFrom/dateTo)
     * @param {Array<{maloId: string}>} consumers
     * @param {object} callOpts — { meta: { ...ctx.meta, $gateway: false } }
     * @returns {{ consumptionStatus: Array<{maloId, found, intervalCount, totalKWh}>,
     *             consumptionByMalo: Map<string, Array<{ts: string, value: number}>>,
     *             warnings: Array }}
     */
    async stepFetchConsumptionEdm(ctx, params, consumers, callOpts) {
      const from = `${params.dateFrom}T00:00:00.000Z`;
      // dateTo is inclusive — EDM's `to` is exclusive, advance one day
      // (mirrors src/timeseries-allocation.js#buildIntervalGrid's convention).
      const to = new Date(
        new Date(`${params.dateTo}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000
      ).toISOString();

      const consumptionStatus = [];
      const consumptionByMalo = new Map();
      const warnings = [];

      for (const consumer of consumers) {
        let values = [];
        try {
          const result = await ctx.call(
            'edm.getTimeseries',
            {
              meloId: consumer.maloId,
              obis: '1-0:1.8.0',
              from,
              to,
              resolution: '15min',
            },
            callOpts
          );
          values = Array.isArray(result?.values) ? result.values : [];
        } catch (err) {
          this.logger.debug(
            `stepFetchConsumptionEdm: EDM lookup failed for ${consumer.maloId}: ${err.message}`
          );
          values = [];
        }

        const found = values.length > 0;
        const totalKWh = found
          ? Math.round(values.reduce((sum, v) => sum + (Number(v.value) || 0), 0) * 10000) / 10000
          : null;

        consumptionStatus.push({
          maloId: consumer.maloId,
          found,
          intervalCount: values.length,
          totalKWh,
        });
        consumptionByMalo.set(
          consumer.maloId,
          values.map((v) => ({ ts: v.ts, value: Number(v.value) || 0 }))
        );

        if (!found) {
          warnings.push({
            code: 'ALLOC_CONSUMPTION_DATA_NOT_FOUND',
            message:
              `No EDM consumption timeseries (OBIS 1-0:1.8.0) found for consumer "${consumer.maloId}" ` +
              `in ${params.dateFrom}..${params.dateTo}. Consumption-aware allocation is not possible ` +
              'for this consumer for this period — only the fixed sharePercent quota result is available. ' +
              "Import the consumer's metering data via POST /api/edm/timeseries/import, or pass " +
              'a known MeLo with existing data.',
            maloId: consumer.maloId,
          });
        }
      }

      return { consumptionStatus, consumptionByMalo, warnings };
    },

    // ── Replay (download, billingReport, annualBillingReport) ───────────────

    /**
     * Re-derive the generation interval grid + consumer list from a persisted
     * allocation document — shared by `download` (#16) and `billingReport`/
     * `annualBillingReport` (#284). KRITIS: the grid is never persisted, only
     * re-computed on demand from stored metadata, same as before this was
     * extracted into its own method (behavior-preserving refactor).
     *
     * @param {object} doc — persisted allocation document (this.db.get result)
     * @param {string} token — MCP token
     * @returns {{ grid: Array, consumers: Array, replayParams: object }}
     */
    async stepReplayGenerationGrid(doc, token) {
      const generators = doc.generators || [];
      const consumers = doc.consumers.map((c) => ({
        maloId: c.maloId,
        sharePercent: c.sharePercent,
        name: c.name,
      }));

      const replayParams = {
        dateFrom: doc.dateFrom,
        dateTo: doc.dateTo,
        dataSource: doc.dataSource,
        inhouseSourceId: doc.inhouseSourceId,
        includeRedispatchDeduction: doc.redispatchApplied,
        gridOperatorId: doc.gridOperatorId,
      };

      const grid = await this.stepFetchGeneration(replayParams, generators, token);

      if (doc.redispatchApplied) {
        const warnings = [];
        await this.stepRedispatchDeduction(grid, replayParams, token, warnings);
      }

      return { grid, consumers, replayParams };
    },

    // ── Step 3 ─────────────────────────────────────────────────────────────

    /**
     * Apply Redispatch 2.0 deductions.
     *
     * Conservative approach (v0.16): uses netztransparenz_redispatch for the
     * time period. If any curtailment windows are found, they are applied to
     * the interval grid. A warning is added to the report when deductions are made.
     *
     * @param {Array} grid — interval grid (mutated in-place)
     * @param {object} params — allocation params
     * @param {string} token — MCP token
     * @param {Array} warnings — warning accumulator (mutated in-place)
     * @returns {boolean} — true if redispatch was applied
     */
    async stepRedispatchDeduction(grid, params, token, warnings) {
      if (!params.includeRedispatchDeduction) return false;

      let curtailmentWindows = [];
      try {
        const result = await this.callMcp(
          'netztransparenz_redispatch',
          {
            dateFrom: `${params.dateFrom}T00:00:00Z`,
            dateTo: `${params.dateTo}T23:59:59Z`,
            includeAnalysis: true,
            includeCurtailment: true,
          },
          token
        );

        // Extract curtailment windows from result
        const events = result?.curtailmentEvents || result?.events || result?.data || [];
        curtailmentWindows = Array.isArray(events)
          ? events
              .filter((e) => e.startTime && e.endTime)
              .map((e) => ({ startTime: e.startTime, endTime: e.endTime }))
          : [];
      } catch (err) {
        this.logger.warn(
          `stepRedispatchDeduction: redispatch call failed — skipping. ${err.message}`
        );
        warnings.push({
          code: 'ALLOC_REDISPATCH_DATA_UNAVAILABLE',
          message:
            `Redispatch data could not be retrieved (${err.message}). No deductions applied. ` +
            'Verify manually if the period included grid curtailment events.',
        });
        return false;
      }

      if (curtailmentWindows.length === 0) return false;

      applyRedispatchDeductions(grid, curtailmentWindows);

      const deducted = grid.filter((i) => i.redispatchDeductionKWh > 0).length;
      warnings.push({
        code: 'ALLOC_REDISPATCH_DEDUCTION_APPLIED',
        message:
          `Redispatch deduction applied to ${deducted} interval(s) based on TSO-level curtailment data. ` +
          'Note: v0.16 uses conservative TSO-level data. Precise plant-level deductions require FPF data (v0.17+).',
      });

      return true;
    },
  },
};
