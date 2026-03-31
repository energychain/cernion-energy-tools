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

module.exports = {
  name: 'dashboard-api',

  settings: {
    cacheTtlMs: {
      vnbOverview:     5  * 60 * 1000,  // 5 min
      marketSnapshot:  15 * 60 * 1000,  // 15 min
      qualitySummary:  5  * 60 * 1000,  // 5 min
      findingCodes:    24 * 60 * 60 * 1000, // 24 h (static)
    },
  },

  created() {
    this.cache   = new Map();
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
        bdewCode: { type: 'string', min: 1 },
      },
      openapi: {
        tags: ['Dashboard API'],
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
                        name:    { type: 'string', example: 'TWL Netze GmbH' },
                        mastrId: { type: 'string', example: 'SNB935578300972' },
                        bdew:    { type: 'string', example: '9907473000008' },
                        bnr:     { type: 'string', nullable: true },
                      },
                    },
                    kpis: {
                      type: 'object',
                      nullable: true,
                      description: 'Key performance indicators aggregated from VNB Monitor and Datapoint health',
                    },
                    latestAgentResults: {
                      type: 'object',
                      description: 'Most recent report summary for each agent pipeline (null if no report exists)',
                      properties: {
                        mastrQuality:   { type: 'object', nullable: true },
                        gridConnection: { type: 'object', nullable: true },
                        energySharing:  { type: 'object', nullable: true },
                        redispatch:     { type: 'object', nullable: true },
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
            ctx, 'grid-operations.vnbLookupCodes',
            { bdewCode }, null, errors, 'grid-operations.vnbLookupCodes'
          );
          const vnbMonitor = await this.safeCall(
            ctx, 'vnb-monitor.snapshot',
            { bdewCode, refresh: false, alerts: true, lang: 'de' },
            null, errors, 'vnb-monitor.snapshot'
          );

          // Extract mastrId from Phase 1 for per-operator filtering in Phase 2.
          const gridOperatorId = identity?.results?.[0]?.mastrId
            || identity?.mastrId
            || vnbMonitor?.identity?.mastrId
            || null;

          // ── Phase 2: Parallel PouchDB-only reads (0 MCP sessions) ────────
          const [health, mqAudits, gcValidations, esValidations, rdAudits] =
            await Promise.all([
              this.safeCall(ctx, 'datapoint.health',       {},                            null, errors, 'datapoint.health'),
              this.safeCall(ctx, 'mastr-quality.list',     { gridOperatorId, limit: 1 }, null, errors, 'mastr-quality.list'),
              this.safeCall(ctx, 'grid-connection.list',   { gridOperatorId, limit: 1 }, null, errors, 'grid-connection.list'),
              this.safeCall(ctx, 'energy-sharing.list',    { limit: 1 },                  null, errors, 'energy-sharing.list'),
              this.safeCall(ctx, 'redispatch-expost.list', { gridOperatorId, limit: 1 }, null, errors, 'redispatch-expost.list'),
            ]);

          return {
            identity:           this.buildIdentity(identity, bdewCode),
            kpis:               this.buildKpis(vnbMonitor, health, mqAudits),
            latestAgentResults: this.buildAgentSummary(mqAudits, gcValidations, esValidations, rdAudits),
            alerts:             vnbMonitor?.alerts || [],
            timestamp:          new Date().toISOString(),
            _errors:            errors,
          };
        });
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
        location: { type: 'string', optional: true, default: 'Deutschland' },
        region:   { type: 'string', optional: true },
      },
      openapi: {
        tags: ['Dashboard API'],
        summary: 'Market snapshot — current spot prices, CO₂ intensity, renewable forecast',
        description:
          'Aggregates current day-ahead spot prices, CO₂ intensity (with forecast), and ' +
          'wind/solar generation forecast for the next 24 hours into a single response.\n\n' +
          'Fixed upstream parameters: `market: day-ahead`, today\'s date, `forecastType: both`.\n\n' +
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
            description: 'Region for ENTSO-E wind/solar generation forecast. When omitted, renewableForecast24h is null and the ENTSO-E call is skipped.',
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
                        current:  { type: 'number', description: '€/MWh', example: 45.2 },
                        avgToday: { type: 'number', description: '€/MWh' },
                        minToday: { type: 'number', description: '€/MWh' },
                        maxToday: { type: 'number', description: '€/MWh' },
                        trend:    { type: 'string', enum: ['rising', 'falling', 'stable'] },
                        source:   { type: 'string', example: 'netztransparenz' },
                      },
                    },
                    co2: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        current:  { type: 'number', description: 'gCO2eq/kWh', example: 380 },
                        avgToday: { type: 'number' },
                        signal:   { type: 'string', enum: ['green', 'yellow', 'red'] },
                        location: { type: 'string', example: 'Deutschland' },
                      },
                    },
                    renewableForecast24h: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        solarPeakMW:      { type: 'number', example: 32500 },
                        windPeakMW:       { type: 'number', example: 18200 },
                        combinedPeakAt:   { type: 'string', format: 'date-time' },
                      },
                    },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors:   { type: 'array', items: { type: 'string' } },
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
          const today    = new Date().toISOString().slice(0, 10);
          const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

          // energy-market.prices, co2Intensity, and german-grid.spotprices always fire
          // in parallel (lightweight, 1 MCP session each, no internal fan-out).
          // entsoe.windSolarForecast only fires when the caller provides an explicit
          // `region` — without it, a Germany-wide forecast is not meaningful for a local
          // VNB dashboard. UI must hide the renewableForecast24h card when it is null.
          const [pricesRes, co2Res, spotRes] = await Promise.allSettled([
            this.safeCall(ctx, 'energy-market.prices', {
              market: 'day-ahead',
              region: 'Deutschland',
              date: today,
            }, null, errors, 'energy-market.prices'),
            this.safeCall(ctx, 'energy-market.co2Intensity', {
              location,
              forecast: true,
            }, null, errors, 'energy-market.co2Intensity'),
            this.safeCall(ctx, 'german-grid.spotprices', {
              dateFrom: today,
              dateTo: today,
              includeStatistics: true,
            }, null, errors, 'german-grid.spotprices'),
          ]);

          const forecastRaw = region
            ? await this.safeCall(ctx, 'entsoe.windSolarForecast', {
                region,
                dateFrom: today,
                dateTo: tomorrow,
                forecastType: 'both',
              }, null, errors, 'entsoe.windSolarForecast')
            : null;

          return {
            spotPrice:            this.buildSpotPrice(pricesRes.value, spotRes.value),
            co2:                  this.buildCo2(co2Res.value, location),
            renewableForecast24h: forecastRaw ? this.buildForecast(forecastRaw) : null,
            timestamp:            new Date().toISOString(),
            _errors:              errors,
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
        gridOperatorId: { type: 'string', optional: true },
      },
      openapi: {
        tags: ['Dashboard API'],
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
                          type:          { type: 'string', example: 'mastr-quality' },
                          label:         { type: 'string', example: 'MaStR Datenqualität' },
                          lastRun:       { type: 'string', format: 'date-time', nullable: true },
                          keyMetric:     { type: 'object', nullable: true },
                          recentReports: { type: 'array' },
                        },
                      },
                    },
                    timestamp: { type: 'string', format: 'date-time' },
                    _errors:   { type: 'array', items: { type: 'string' } },
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

          const [mqRes, gcRes, esRes, rdRes, allocRes] = await Promise.allSettled([
            this.safeCall(ctx, 'mastr-quality.list',             { ...baseFilter, limit: 5 }, null, errors, 'mastr-quality.list'),
            this.safeCall(ctx, 'grid-connection.list',           { ...baseFilter, limit: 5 }, null, errors, 'grid-connection.list'),
            this.safeCall(ctx, 'energy-sharing.list',            { limit: 5 },                null, errors, 'energy-sharing.list'),
            this.safeCall(ctx, 'redispatch-expost.list',         { ...baseFilter, limit: 5 }, null, errors, 'redispatch-expost.list'),
            this.safeCall(ctx, 'energy-sharing-allocation.list', { limit: 5 },                null, errors, 'energy-sharing-allocation.list'),
          ]);

          const agents = [
            this.buildAgentEntry('mastr-quality',             'MaStR Datenqualität',         mqRes.value?.audits,         'qualityScore'),
            this.buildAgentEntry('grid-connection',           'Netzanschluss-Validierung',    gcRes.value?.validations,    'decision'),
            this.buildAgentEntry('energy-sharing',            'Energy Sharing Validierung',   esRes.value?.validations,    'decision'),
            this.buildAgentEntry('redispatch-expost',         'Redispatch Ex-Post',           rdRes.value?.audits,         'settlementReadiness'),
            this.buildAgentEntry('energy-sharing-allocation', 'Energy Sharing Allokation',    allocRes.value?.allocations, 'totalNetGenerationKWh'),
          ];

          return {
            agents,
            timestamp: new Date().toISOString(),
            _errors:   errors,
          };
        });
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
        tags: ['Dashboard API'],
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
                          severity:      { type: 'string', enum: ['info', 'warning', 'error'] },
                          agent:         { type: 'string', example: 'mastr-quality' },
                          step:          { type: 'integer', example: 4 },
                          description:   { type: 'string', description: 'English description' },
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
                label:   'Netzanschluss-Validierung',
                version: '0.14.0',
                steps:   6,
                pouchdbPrefix: 'val:',
                endpoint: 'POST /api/grid-connection/validate',
              },
              'energy-sharing': {
                label:   'Energy Sharing Validierung',
                version: '0.15.0',
                steps:   6,
                pouchdbPrefix: 'es:',
                endpoint: 'POST /api/energy-sharing/validate',
              },
              'mastr-quality': {
                label:   'MaStR Datenqualität',
                version: '0.17.0',
                steps:   8,
                pouchdbPrefix: 'mq:',
                endpoint: 'POST /api/mastr-quality/audit',
              },
              'redispatch-expost': {
                label:   'Redispatch Ex-Post',
                version: '0.18.0',
                steps:   7,
                pouchdbPrefix: 'rd:',
                endpoint: 'POST /api/redispatch/audit',
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
        name:    hit.name    || hit.providerName  || null,
        mastrId: hit.mastrId || hit.mastrSnbId    || null,
        bdew:    hit.bdew    || hit.bdewCode       || bdewCode,
        bnr:     hit.bnr     || hit.bnrCode        || null,
      };
    },

    /**
     * Builds the KPIs block from VNB Monitor snapshot and datapoint health.
     * @param {object|null} vnbMonitor  vnb-monitor.snapshot result
     * @param {object|null} health      datapoint.health result
     * @param {object|null} mqAudits    mastr-quality.list result (for qualityScore)
     * @returns {object|null}
     */
    buildKpis(vnbMonitor, health, mqAudits) {
      // vnb-monitor.snapshot actual structure (v0.9.6+):
      //   mastr.inBetrieb.anlagenCount   — total installed units
      //   mastr.inBetrieb.leistungMW     — total capacity (string, e.g. '145.2')
      //   ewk.anschlussdauer.eeNS_weeks  — avg. connection duration EE/NS (weeks)
      //   ewk.digitalisierungsindex.gesamt_percent — overall digitalisation score
      //   ewk.umsetzungsquote.eeNS_percent         — EE/NS implementation rate (%)
      const mastr = vnbMonitor?.mastr || {};
      const ewk   = vnbMonitor?.ewk   || {};
      const dp    = health?.overview  || health || {};

      const latestMqScore = mqAudits?.audits?.[0]?.qualityScore ?? null;

      return {
        totalInstallations:       mastr.inBetrieb?.anlagenCount                 ?? null,
        totalCapacityMW:          mastr.inBetrieb ? (Number(mastr.inBetrieb.leistungMW) || null) : null,
        // TODO(v0.19.2): redispatchEligible — not in vnb-monitor.snapshot.
        // Two options: (a) extend vnb-monitor.snapshot's existing MaStR phase with a
        // minCapacity:100 sub-count (snapshot already calls assets.all, cheap filter), or
        // (b) add a lightweight assets.redispatchCount action (MongoDB-only, no MCP) and
        // call it in Phase 2 alongside the PouchDB list calls. Option (b) preferred to
        // avoid bloating the snapshot payload with a dashboard-specific concern.
        redispatchEligible:       null,
        ewkAnschlussdauerWeeks:   ewk.anschlussdauer?.eeNS_weeks                ?? null,
        ewkDigitalisierungsScore: ewk.digitalisierungsindex?.gesamt_percent     ?? null,
        ewkUmsetzungsquote:       ewk.umsetzungsquote?.eeNS_percent             ?? null,
        mastrQualityScore:        latestMqScore,
        datapointsHealthy:        dp.healthy  ?? null,
        datapointsStale:          dp.stale    ?? null,
        datapointsErrored:        dp.errored  ?? null,
      };
    },

    /**
     * Builds the latestAgentResults block from the four agent list responses.
     * Each entry is either a compact summary object or null (no reports).
     */
    buildAgentSummary(mqAudits, gcValidations, esValidations, rdAudits) {
      return {
        mastrQuality:   this._summariseMq(mqAudits?.audits?.[0]),
        gridConnection: this._summariseGc(gcValidations?.validations?.[0]),
        energySharing:  this._summariseEs(esValidations?.validations?.[0]),
        redispatch:     this._summariseRd(rdAudits?.audits?.[0]),
      };
    },

    _summariseMq(audit) {
      if (!audit) return null;
      return {
        id:           audit.id,
        executedAt:   audit.createdAt,
        qualityScore: audit.qualityScore,
        findingsCount: audit.findingsCount || null,
      };
    },

    _summariseGc(report) {
      if (!report) return null;
      return {
        id:           report.id,
        executedAt:   report.createdAt,
        decision:     report.decision,
        findingsCount: report.findingsCount || null,
      };
    },

    _summariseEs(report) {
      if (!report) return null;
      return {
        id:           report.id,
        executedAt:   report.createdAt,
        decision:     report.decision,
        findingsCount: report.findingsCount || null,
      };
    },

    _summariseRd(audit) {
      if (!audit) return null;
      return {
        id:                          audit.id,
        executedAt:                  audit.createdAt,
        settlementReadinessPercent:  audit.settlementReadiness?.readinessPercent ?? null,
        riskLevel:                   audit.riskAssessment?.level ?? null,
        findingsCount:               audit.findingsCount || null,
      };
    },

    /**
     * Builds the spotPrice block from energy-market.prices or german-grid.spotprices.
     * Falls back gracefully between the two sources.
     */
    buildSpotPrice(pricesData, spotData) {
      // Prefer energy-market.prices (more detailed), fall back to german-grid.spotprices
      const source = pricesData || spotData;
      if (!source) return null;

      const prices = source.prices || source.data || [];
      if (!prices.length) return null;

      const values = prices.map((p) => p.price ?? p.value ?? p.priceEur).filter((v) => v != null);
      if (!values.length) return null;

      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);

      // Trend: compare last value to average
      const current = values[values.length - 1];
      const trend   = current > avg * 1.05 ? 'rising' : current < avg * 0.95 ? 'falling' : 'stable';

      return {
        current:  Math.round(current  * 100) / 100,
        avgToday: Math.round(avg      * 100) / 100,
        minToday: Math.round(min      * 100) / 100,
        maxToday: Math.round(max      * 100) / 100,
        trend,
        source: pricesData ? 'energy-market' : 'german-grid',
      };
    },

    /**
     * Builds the co2 block from energy-market.co2Intensity response.
     */
    buildCo2(co2Data, location) {
      if (!co2Data) return null;
      const current = co2Data.current ?? co2Data.co2Intensity ?? co2Data.value ?? null;
      if (current == null) return null;

      const signal = current < 300 ? 'green' : current < 450 ? 'yellow' : 'red';

      return {
        current:  Math.round(current),
        avgToday: co2Data.avgToday ?? co2Data.average ?? null,
        signal,
        location: co2Data.location || location,
      };
    },

    /**
     * Builds the renewableForecast24h block from entsoe.windSolarForecast response.
     */
    buildForecast(forecastData) {
      if (!forecastData) return null;
      const solar = forecastData.solar || forecastData.solarForecast || [];
      const wind  = forecastData.wind  || forecastData.windForecast  || [];

      const solarPeakMW = solar.length ? Math.max(...solar.map((p) => p.value ?? p.mw ?? 0)) : null;
      const windPeakMW  = wind.length  ? Math.max(...wind.map((p) => p.value ?? p.mw ?? 0))  : null;

      // Find combined peak timestamp
      let combinedPeakAt = null;
      if (solar.length && wind.length) {
        const solarPeak = solar.reduce((a, b) => ((a.value ?? 0) > (b.value ?? 0) ? a : b));
        combinedPeakAt  = solarPeak.timestamp || solarPeak.time || null;
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
        return { type, label, lastRun: null, keyMetric: null, recentReports: [] };
      }
      const latest     = reports[0];
      const metricValue = latest[metricKey] ?? null;
      return {
        type,
        label,
        lastRun:       latest.createdAt || null,
        keyMetric:     metricValue != null ? { name: metricKey, value: metricValue } : null,
        recentReports: reports.map((r) => ({
          id:         r.id,
          executedAt: r.createdAt,
          [metricKey]: r[metricKey] ?? null,
        })),
      };
    },
  },
};
