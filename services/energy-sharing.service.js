'use strict';

/**
 * Energy Sharing Validation Service (v0.15.0)
 *
 * Deterministic 6-step validation pipeline for Energy Sharing community
 * applications under § 42c EnWG. Validates generator MaStR records, direct
 * marketer status (§ 21 Abs. 2 EEG), share allocations, and § 42c eligibility.
 *
 * No LLM involvement — identical inputs always produce identical finding codes.
 * Excluded from the LLM agent catalogue (agent.service.js skipServices).
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const CernionMCPClient = require('../src/mcp-client');
const { runAsync } = require('../src/async-job-runner');
const {
  applyCursorPagination,
  applyOffsetDeprecationHeader,
  buildFilterHash,
  resolveTenantId,
} = require('../src/pagination');
const {
  createFinding,
  summarizeFindings,
  // ES Step 1 — VNB Identity
  VNB_RESOLVED,
  VNB_AMBIGUOUS,
  VNB_NOT_FOUND,
  // ES Step 2 — Generator Validation
  GENERATOR_VALID,
  GENERATOR_NOT_FOUND,
  GENERATOR_NOT_OPERATIONAL,
  GENERATOR_WRONG_GRID_AREA,
  GENERATOR_TYPE_INELIGIBLE,
  GENERATOR_CAPACITY_ZERO,
  GENERATOR_NO_NAP,
  GENERATOR_NO_MELO,
  GENERATOR_DUPLICATE,
  // ES Step 3 — Direct Marketer (§ 21 Abs. 2 EEG)
  DV_VALID,
  DV_MANDATORY_MISSING,
  DV_NOT_CONTROLLABLE,
  DV_NOT_FOUND,
  DV_MASTR_MISMATCH,
  // ES Step 4 — Eligibility
  ELIGIBILITY_CONFIRMED,
  SHARE_SUM_GENERATORS_INVALID,
  SHARE_SUM_CONSUMERS_INVALID,
  NO_GENERATORS,
  NO_CONSUMERS,
  MIXED_GRID_AREAS,
  GENERATOR_EXCEEDS_LIMIT,
  CONSUMER_MALO_INVALID,
  CONSUMER_MALO_DUPLICATE,
  // ES Step 5 — Decision
  ES_APPROVED,
  ES_APPROVED_WITH_CONDITIONS,
  ES_REJECTED_STRUCTURAL,
  ES_REJECTED_GENERATOR_INVALID,
  ES_REJECTED_OTHER,
  // Step 6 — Audit (reused from v0.14)
  AUDIT_TRAIL_CREATED,
  SNAPSHOT_DRIFT_DETECTED,
} = require('../src/validation-findings');

const PIPELINE_VERSION = '0.15.0';
const MALO_REGEX = /^DE\d{31}$/;
const ELIGIBLE_TYPES = new Set(['solar', 'wind', 'biomass', 'hydro', 'storage']);
// MaStR status code 35 = InBetrieb
const STATUS_IN_BETRIEB = 35;

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'energy-sharing',

  settings: {
    dbPath: process.env.ENERGY_SHARING_DB_PATH || './data/energy-sharing',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['communityId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    this.logger.info(`Energy-sharing validation DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: {
    /**
     * Run the 6-step Energy Sharing validation pipeline.
     * Deterministic — identical inputs always produce identical finding codes.
     */
    validate: {
      rest: 'POST /validate',
      timeout: 120_000,
      params: {
        gridOperatorId: { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        communityName: { type: 'string', optional: true, default: '' },
        communityId: { type: 'string', optional: true, default: '' },
        generators: { type: 'array', items: 'object', optional: true, default: [] },
        consumers: { type: 'array', items: 'object', optional: true, default: [] },
        maxAgeMinutes: { type: 'number', optional: true, default: 120, convert: true },
        datapointTags: { type: 'array', items: 'string', optional: true, default: [] },
      },
      openapi: {
        summary: 'Validate an Energy Sharing community application (§ 42c EnWG)',
        description:
          'Executes a deterministic 6-step Energy Sharing validation pipeline: ' +
          'identity → generators → directMarketer → eligibility → decision → audit. ' +
          'Validates generator MaStR records, direct marketer status (§ 21 Abs. 2 EEG), ' +
          'share allocations, and § 42c EnWG eligibility criteria. ' +
          'Results are persisted to the validation database and retrievable via GET /validations/:id.',
        tags: ['Energy Sharing Validation'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR grid operator ID (SNB...)',
                    example: 'SNB935578300972',
                  },
                  gridOperatorBdew: {
                    type: 'string',
                    description: '13-digit BDEW market-partner code',
                    example: '9907473000008',
                  },
                  communityName: {
                    type: 'string',
                    description: 'Name of the Energy Sharing community',
                    example: 'Solargemeinschaft Rheinallee',
                  },
                  communityId: {
                    type: 'string',
                    description: 'External community ID assigned by the VNB',
                    example: 'ES-2026-001',
                  },
                  generators: {
                    type: 'array',
                    items: { type: 'object' },
                    description:
                      'List of generator participants with mastrNummer, sharePercent, optional direktvermarkter',
                    example: [
                      {
                        mastrNummer: 'SEE904837264953',
                        sharePercent: 100,
                        direktvermarkter: 'Next Kraftwerke GmbH',
                      },
                    ],
                  },
                  consumers: {
                    type: 'array',
                    items: { type: 'object' },
                    description:
                      'List of consumer participants with maloId, sharePercent, optional name',
                    example: [
                      {
                        maloId: 'DE0001234567890123456789012345678',
                        sharePercent: 100,
                        name: 'Whg. 1',
                      },
                    ],
                  },
                  maxAgeMinutes: {
                    type: 'integer',
                    default: 120,
                    description: 'Datapoint freshness threshold for Weg B (minutes)',
                  },
                  datapointTags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for datapoint snapshot (Weg B fallback)',
                    example: ['twl-netze'],
                  },
                },
              },
              examples: {
                'Minimal valid application': {
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    communityName: 'Solargemeinschaft Rheinallee',
                    communityId: 'ES-2026-001',
                    generators: [
                      {
                        mastrNummer: 'SEE904837264953',
                        sharePercent: 100,
                        direktvermarkter: 'Next Kraftwerke GmbH',
                      },
                    ],
                    consumers: [
                      { maloId: 'DE00012345678901234567890123456789', sharePercent: 60 },
                      { maloId: 'DE00098765432109876543210987654321', sharePercent: 40 },
                    ],
                  },
                },
                'By BDEW code': {
                  value: { gridOperatorBdew: '9907473000008', generators: [], consumers: [] },
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
            description: 'EnergyShareValidationReport with findings from all 6 pipeline steps',
            content: {
              'application/json': {
                example: {
                  success: true,
                  id: 'a1b2c3d4-...',
                  communityName: 'Solargemeinschaft Rheinallee',
                  communityId: 'ES-2026-001',
                  decision: 'APPROVED',
                  summary: {
                    generatorsSubmitted: 1,
                    generatorsValid: 1,
                    generatorsInvalid: 0,
                    consumersSubmitted: 2,
                    dvStatus: 'all_confirmed',
                    totalGeneratorCapacityKW: 350,
                    findingsCount: { info: 4, warning: 0, error: 0 },
                    durationMs: 5200,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return runAsync(ctx, {
          service: 'energy-sharing',
          action: 'validate',
          params: ctx.params,
          worker: async () => {
            const { gridOperatorId, gridOperatorBdew } = ctx.params;
            if (!gridOperatorId && !gridOperatorBdew) {
              throw new Error('At least one of gridOperatorId or gridOperatorBdew is required');
            }

            const report = await this.runPipeline(ctx, ctx.params);

            // Persist to PouchDB (KRITIS: raw installation data NOT stored, only report metadata)
            const id = crypto.randomUUID();
            const tenantId = resolveTenantId(ctx) || 'default';
            // Tenant-isolation: prefix _id with tenantId for doc-prefix isolation (v0.47)
            const docId = tenantId !== 'default' ? `es:${tenantId}:${id}` : `es:${id}`;

            // Sub-Track E: HITL escalation on error findings (v0.47)
            const errorFindings = (report.findings || []).filter((f) => f.severity === 'error');
            if (errorFindings.length > 0) {
              try {
                await ctx.call(
                  'hitl.create',
                  {
                    kind: 'energy-sharing-validation-error',
                    payload: {
                      validationId: id,
                      communityId: report.communityId || '',
                      communityName: report.communityName || '',
                      decision: report.decision,
                      errorCount: errorFindings.length,
                      errorCodes: errorFindings.map((f) => f.finding),
                      tenantId,
                    },
                    originService: 'energy-sharing',
                    originAction: 'validate',
                    severity: 'error',
                    requiredScope: 'full-access',
                  },
                  { meta: { ...ctx.meta, $gateway: false } }
                );
              } catch (hitlErr) {
                this.logger.warn(`[energy-sharing] HITL escalation failed: ${hitlErr.message}`);
              }
            }

            const doc = {
              _id: docId,
              id,
              tenantId,
              type: 'energy-sharing-validation',
              communityName: report.communityName,
              communityId: report.communityId,
              gridOperator: report.gridOperator,
              decision: report.decision,
              summary: report.summary,
              generators: report.generators,
              consumers: report.consumers,
              findings: report.findings,
              steps: report.steps,
              snapshot: report.snapshot,
              metadata: {
                ...report.metadata,
                inputParams: {
                  gridOperatorId: ctx.params.gridOperatorId || null,
                  gridOperatorBdew: ctx.params.gridOperatorBdew || null,
                  communityName: ctx.params.communityName || '',
                  communityId: ctx.params.communityId || '',
                  datapointTags: ctx.params.datapointTags || [],
                  maxAgeMinutes: ctx.params.maxAgeMinutes,
                },
              },
              createdAt: new Date().toISOString(),
            };

            await this.db.put(doc);
            return { success: true, id, ...report };
          },
        });
      },
    },

    /**
     * List past Energy Sharing validation reports (newest first).
     */
    list: {
      rest: 'GET /validations',
      params: {
        communityId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true, max: 200 },
        cursor: { type: 'string', optional: true },
        offset: { type: 'number', optional: true, convert: true, min: 0 },
      },
      openapi: {
        summary: 'List past Energy Sharing validation reports',
        description:
          'Returns validation reports stored in PouchDB, newest first. Filter by communityId.',
        tags: ['Energy Sharing Validation'],
        parameters: [
          {
            name: 'communityId',
            in: 'query',
            schema: { type: 'string', example: 'ES-2026-001' },
            description: 'Filter by external community ID',
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
            description: 'Paginated list of Energy Sharing validation report summaries',
            content: {
              'application/json': {
                example: {
                  count: 1,
                  validations: [
                    {
                      id: '...',
                      communityName: 'Solargemeinschaft Rheinallee',
                      communityId: 'ES-2026-001',
                      decision: 'APPROVED',
                      createdAt: '2026-03-30T...',
                    },
                  ],
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = resolveTenantId(ctx) || 'default';
        // Tenant-isolation: scope allDocs to tenant prefix (v0.47)
        const prefix = tenantId !== 'default' ? `es:${tenantId}:` : 'es:';
        const endkey = tenantId !== 'default' ? `es:${tenantId}:\ufff0` : 'es:\ufff0';
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: prefix,
          endkey,
        });

        // When listing 'default' tenant, exclude any tenant-prefixed docs
        let docs = result.rows
          .map((r) => r.doc)
          .filter((d) => (tenantId === 'default' ? !/^es:[^:]+:[^:]+$/.test(d._id) : true));

        if (ctx.params.communityId) {
          docs = docs.filter((d) => d.communityId === ctx.params.communityId);
        }

        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        const filterHash = buildFilterHash({ communityId: ctx.params.communityId || null });
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
          validations: page.data.map((d) => ({
            id: d.id,
            communityName: d.communityName,
            communityId: d.communityId,
            gridOperator: d.gridOperator,
            decision: d.decision,
            createdAt: d.createdAt,
            findingsCount: d.summary?.findingsCount,
            durationMs: d.summary?.durationMs,
          })),
          pageInfo: page.pageInfo,
        };
      },
    },

    /**
     * Retrieve a single Energy Sharing validation report by ID.
     */
    get: {
      rest: 'GET /validations/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get a specific Energy Sharing validation report by ID',
        description:
          'Returns the full EnergyShareValidationReport including all findings, per-generator status, and snapshot reference.',
        tags: ['Energy Sharing Validation'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' },
            description: 'Validation report UUID',
          },
        ],
        responses: {
          200: { description: 'Full EnergyShareValidationReport document' },
          404: { description: 'Validation not found' },
        },
      },
      async handler(ctx) {
        const tenantId = resolveTenantId(ctx) || 'default';
        // Try tenant-prefixed key first (v0.47), fall back to legacy key
        const tenantKey = tenantId !== 'default' ? `es:${tenantId}:${ctx.params.id}` : null;
        const legacyKey = `es:${ctx.params.id}`;

        let doc = null;
        const keysToTry = tenantKey ? [tenantKey, legacyKey] : [legacyKey];
        for (const key of keysToTry) {
          try {
            doc = await this.db.get(key);
            break;
          } catch (err) {
            if (err.status !== 404 && err.name !== 'not_found') throw err;
          }
        }

        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Validation ${ctx.params.id} not found` };
        }
        return { success: true, ...doc };
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

    /**
     * Weg B: try to load installation data from a tagged datapoint.
     * Returns rows array on success, or null to fall back to Weg A.
     */
    async tryDatapointFallback(ctx, datapointTags, maxAgeMinutes) {
      if (!datapointTags || datapointTags.length === 0) return null;
      try {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const dpList = await ctx.call(
          'datapoint.list',
          { tags: datapointTags.join(',') },
          callOpts
        );
        const dp = (dpList.datapoints || []).find((d) =>
          (d.tags || []).some((t) => ['mastr-portfolio', 'grid-connection-inventory'].includes(t))
        );
        if (!dp) return null;
        const ageMin = dp.lastRun?.timestamp
          ? (Date.now() - new Date(dp.lastRun.timestamp).getTime()) / 60_000
          : Infinity;
        if (ageMin > maxAgeMinutes) return null;
        const dpData = await ctx.call('datapoint.data', { name: dp.name }, callOpts);
        const rows = dpData?.data?.rows || dpData?.rows || [];
        if (rows.length > 0) {
          this.logger.debug(
            `tryDatapointFallback: using datapoint "${dp.name}" (${rows.length} rows)`
          );
          return rows;
        }
      } catch (err) {
        this.logger.debug(`tryDatapointFallback: skipped — ${err.message}`);
      }
      return null;
    },

    /**
     * Derives a normalized installation type string from a raw MaStR record.
     */
    deriveType(inst) {
      const et = String(inst.Energietraeger || inst.energietraeger || '').toLowerCase();
      if (['solar', 'photovoltaik', 'pv'].some((t) => et.includes(t))) return 'solar';
      if (['wind', 'windkraft'].some((t) => et.includes(t))) return 'wind';
      if (['speicher', 'battery', 'batterie', 'storage'].some((t) => et.includes(t)))
        return 'storage';
      if (['biomasse', 'biogas', 'biomethan'].some((t) => et.includes(t))) return 'biomass';
      if (['wasser', 'hydro'].some((t) => et.includes(t))) return 'hydro';
      if (inst.Modulanzahl || inst.GrossflächePv) return 'solar';
      if (inst.Nabenhoehe || inst.Rotordurchmesser) return 'wind';
      if (inst.Speicherkapazitaet) return 'storage';
      return 'other';
    },

    /**
     * Returns true if the installation has the DV remote-control flag set.
     * Field FernsteuerbarkeitDv is stored as string "1"/"0" in local MaStR data.
     */
    hasDvFlag(inst) {
      const v = inst?.FernsteuerbarkeitDv ?? inst?.fernsteuerbarkeitDv;
      return v === true || v === 1 || v === '1';
    },

    /**
     * Step 1: Resolve VNB identity via vnb_lookup_codes MCP tool.
     * Returns { identity, findings }.
     */
    async stepIdentity(ctx, params) {
      const findings = [];
      const { gridOperatorId, gridOperatorBdew } = params;
      const token = ctx.meta?.cernionToken;

      const identity = {
        mastrId: gridOperatorId || null,
        name: 'Unknown',
        bdew: gridOperatorBdew || null,
        bnr: null,
      };

      try {
        const lookupParam = gridOperatorId
          ? { mastrId: gridOperatorId }
          : { bdewCode: gridOperatorBdew };
        const result = await this.callMcp('vnb_lookup_codes', lookupParam, token);
        const canonical = result?.data?.canonical || result?.canonical || {};
        const candidates = result?.data?.candidates || result?.candidates || [];

        if (canonical.mastrId) identity.mastrId = String(canonical.mastrId).split(' ')[0].trim();
        if (canonical.name) identity.name = canonical.name;
        if (canonical.bdew) identity.bdew = canonical.bdew;
        if (canonical.bnr) identity.bnr = canonical.bnr;

        // If canonical came back empty the VNB was not found in the register
        if (!canonical.mastrId && !canonical.bdew && !canonical.name) {
          findings.push(
            createFinding(
              1,
              'identity',
              VNB_NOT_FOUND,
              'error',
              'VNB not found in register',
              'vnb_lookup_codes returned no canonical identity for the provided identifier.',
              { lookupParam },
              'Verify the grid operator identifier and resubmit.',
              1
            )
          );
          return { identity: null, findings };
        }

        const hasConflict = result?.data?.conflictFlag === true || result?.conflictFlag === true;
        const isAmbiguous = candidates.length > 1 || hasConflict;
        const code = isAmbiguous ? VNB_AMBIGUOUS : VNB_RESOLVED;
        const severity = isAmbiguous ? 'warning' : 'info';
        findings.push(
          createFinding(
            1,
            'identity',
            code,
            severity,
            isAmbiguous
              ? `VNB ambiguous — ${candidates.length} candidate(s), best selected: ${identity.name}`
              : `VNB identified: ${identity.name}`,
            `Canonical MaStR-ID: ${identity.mastrId || 'n/a'}, BDEW: ${identity.bdew || 'n/a'}.`,
            { identity, candidateCount: candidates.length },
            null,
            1
          )
        );
      } catch (err) {
        // Best-effort: proceed with provided IDs when lookup unavailable
        if (!identity.mastrId && !identity.bdew) {
          findings.push(
            createFinding(
              1,
              'identity',
              VNB_NOT_FOUND,
              'error',
              'VNB identity resolution failed',
              err.message,
              {},
              'Check MCP connectivity.',
              1
            )
          );
          return { identity: null, findings };
        }
        findings.push(
          createFinding(
            1,
            'identity',
            VNB_RESOLVED,
            'info',
            `VNB using provided identifier (lookup unavailable): ${identity.mastrId || identity.bdew}`,
            `vnb_lookup_codes unavailable — proceeding with input IDs.`,
            { identity },
            null,
            1
          )
        );
      }

      return { identity, findings };
    },

    /**
     * Builds per-generator findings from a matched MaStR installation record.
     * Pure function — no I/O.
     */
    buildGeneratorFindings(gen, inst, wrongGridArea, idx) {
      const findings = [];
      const genCodes = [];

      if (wrongGridArea) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_WRONG_GRID_AREA,
            'warning',
            `Generator ${gen.mastrNummer} found in different grid area`,
            'Installation is registered under a different grid operator — check if this VNB is responsible.',
            { mastrNummer: gen.mastrNummer },
            'Verify correct VNB for this installation.',
            idx
          )
        );
        genCodes.push(GENERATOR_WRONG_GRID_AREA);
      }

      const status = parseInt(inst.einheitBetriebsstatus ?? inst.EinheitBetriebsstatus ?? 0);
      if (status !== STATUS_IN_BETRIEB) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_NOT_OPERATIONAL,
            'error',
            `Generator ${gen.mastrNummer} not in operational status (status: ${status})`,
            'Energy Sharing generators must be "In Betrieb" (status 35).',
            { mastrNummer: gen.mastrNummer, status },
            'Activate the installation before submitting.',
            idx
          )
        );
        genCodes.push(GENERATOR_NOT_OPERATIONAL);
      }

      const type = this.deriveType(inst);
      if (!ELIGIBLE_TYPES.has(type)) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_TYPE_INELIGIBLE,
            'error',
            `Generator ${gen.mastrNummer} type "${type}" not eligible for Energy Sharing`,
            'Only solar, wind, biomass, hydro, and storage installations may participate (§ 42c EnWG).',
            { mastrNummer: gen.mastrNummer, type },
            null,
            idx
          )
        );
        genCodes.push(GENERATOR_TYPE_INELIGIBLE);
      }

      const capacityKW = parseFloat(inst.NettoNennleistung || inst.Bruttoleistung || 0);
      if (capacityKW <= 0) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_CAPACITY_ZERO,
            'error',
            `Generator ${gen.mastrNummer} has zero or missing capacity`,
            'MaStR record shows NettoNennleistung = 0 or null.',
            { mastrNummer: gen.mastrNummer, capacityKW },
            'Correct the capacity in MaStR.',
            idx
          )
        );
        genCodes.push(GENERATOR_CAPACITY_ZERO);
      }

      const napPresent = !!(inst.nap || inst.NapMastrNummer || inst.napMastrNummer);
      if (!napPresent) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_NO_NAP,
            'warning',
            `Generator ${gen.mastrNummer} has no NAP assignment`,
            'No Netzanschlusspunkt linked in MaStR.',
            { mastrNummer: gen.mastrNummer },
            'Submit NAP assignment via MaStR portal.',
            idx
          )
        );
        genCodes.push(GENERATOR_NO_NAP);
      }

      const meloPresent = !!(
        inst.MeloMastrNummer ||
        inst.meloMastrNummer ||
        inst.MeloId ||
        inst.meloId
      );
      if (!meloPresent) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_NO_MELO,
            'warning',
            `Generator ${gen.mastrNummer} has no MeLo assignment`,
            'No Messlokation linked in MaStR. Required for metering under Energy Sharing.',
            { mastrNummer: gen.mastrNummer },
            'Register MeLo via grid operator.',
            idx
          )
        );
        genCodes.push(GENERATOR_NO_MELO);
      }

      if (
        genCodes.filter((c) =>
          [GENERATOR_NOT_OPERATIONAL, GENERATOR_TYPE_INELIGIBLE, GENERATOR_CAPACITY_ZERO].includes(
            c
          )
        ).length === 0
      ) {
        findings.push(
          createFinding(
            2,
            'generators',
            GENERATOR_VALID,
            'info',
            `Generator ${gen.mastrNummer} passed MaStR validation`,
            `Type: ${type}, Capacity: ${capacityKW} kW, Status: InBetrieb.`,
            { mastrNummer: gen.mastrNummer, type, capacityKW, napPresent, meloPresent },
            null,
            idx
          )
        );
        genCodes.push(GENERATOR_VALID);
      }

      return { findings, genCodes, capacityKW, type, napPresent, meloPresent };
    },

    /**
     * Step 2: Validate all generators against MaStR data.
     * Returns { enrichedGenerators, findings }.
     */
    async stepGenerators(ctx, identity, params) {
      const { generators = [], datapointTags = [], maxAgeMinutes = 120 } = params;
      const token = ctx.meta?.cernionToken;
      const findings = [];

      // Weg B — datapoint fallback
      let allInstallations = await this.tryDatapointFallback(ctx, datapointTags, maxAgeMinutes);

      // Weg A — primary MCP call with VNB filter
      if (!allInstallations && identity?.mastrId) {
        const result = await this.callMcp(
          'cernion_installations_local',
          {
            gridOperatorMastrId: identity.mastrId,
            format: 'detailed',
            includeStats: false,
          },
          token
        );
        allInstallations = result?.installations || result?.data?.installations || [];
      }
      if (!allInstallations) allInstallations = [];

      // Build lookup map: MaStR-Nummer → installation record
      const installationMap = new Map();
      for (const inst of allInstallations) {
        const key = inst.EinheitMastrNummer || inst.einheitMastrNummer;
        if (key) installationMap.set(key, inst);
      }

      // Secondary search cache for out-of-area generators (one additional call if needed)
      let secondaryMap = null;

      const enrichedGenerators = [];
      let gIdx = 1;

      for (const gen of generators) {
        let inst = installationMap.get(gen.mastrNummer);
        let wrongGridArea = false;

        if (!inst) {
          // Lazy-load secondary search (all installations without VNB filter, best-effort)
          if (!secondaryMap) {
            try {
              const r = await this.callMcp(
                'cernion_installations_local',
                {
                  format: 'detailed',
                  includeStats: false,
                  limit: 5000,
                },
                token
              );
              const secondary = r?.installations || r?.data?.installations || [];
              secondaryMap = new Map();
              for (const s of secondary) {
                const k = s.EinheitMastrNummer || s.einheitMastrNummer;
                if (k) secondaryMap.set(k, s);
              }
            } catch (_) {
              secondaryMap = new Map();
            }
          }
          inst = secondaryMap.get(gen.mastrNummer);
          if (inst) wrongGridArea = true;
        }

        if (!inst) {
          findings.push(
            createFinding(
              2,
              'generators',
              GENERATOR_NOT_FOUND,
              'error',
              `Generator ${gen.mastrNummer} not found in MaStR`,
              'No installation with this MaStR number exists in the local MaStR database.',
              { mastrNummer: gen.mastrNummer },
              'Verify the MaStR number is correct.',
              gIdx
            )
          );
          enrichedGenerators.push({
            ...gen,
            status: 'invalid',
            mastrStatus: null,
            capacityKW: 0,
            type: null,
            gridArea: null,
            hasDvFlag: false,
            dvMastrId: null,
            napPresent: false,
            meloPresent: false,
            findings: [GENERATOR_NOT_FOUND],
          });
          gIdx++;
          continue;
        }

        const {
          findings: gFindings,
          genCodes,
          capacityKW,
          type,
          napPresent,
          meloPresent,
        } = this.buildGeneratorFindings(gen, inst, wrongGridArea, gIdx);
        findings.push(...gFindings);

        const isInvalid = genCodes.some((c) =>
          [GENERATOR_NOT_OPERATIONAL, GENERATOR_TYPE_INELIGIBLE, GENERATOR_CAPACITY_ZERO].includes(
            c
          )
        );

        enrichedGenerators.push({
          ...gen,
          status: isInvalid ? 'invalid' : 'valid',
          mastrStatus:
            parseInt(inst.einheitBetriebsstatus ?? inst.EinheitBetriebsstatus ?? 0) ===
            STATUS_IN_BETRIEB
              ? 'InBetrieb'
              : `status:${inst.einheitBetriebsstatus ?? inst.EinheitBetriebsstatus}`,
          capacityKW,
          type,
          gridArea: identity?.mastrId || null,
          hasDvFlag: this.hasDvFlag(inst),
          dvMastrId: inst.DirektvermarkterMastrNummer || inst.direktvermarkterMastrNummer || null,
          napPresent,
          meloPresent,
          findings: genCodes,
        });
        gIdx++;
      }

      return { enrichedGenerators, findings };
    },

    /**
     * Builds DV findings for a single generator.
     * Returns array of finding objects.
     */
    buildDvFindings(gen, dvLookupResult, idx) {
      const findings = [];
      const capacityKW = gen.capacityKW || 0;
      const isMandatory = capacityKW >= 100;

      if (!gen.hasDvFlag) {
        const code = isMandatory ? DV_MANDATORY_MISSING : DV_NOT_CONTROLLABLE;
        const severity = isMandatory ? 'error' : 'warning';
        findings.push(
          createFinding(
            3,
            'directMarketer',
            code,
            severity,
            isMandatory
              ? `Generator ${gen.mastrNummer} ≥100 kW without DV remote control (§ 21 Abs. 2 EEG violation)`
              : `Generator ${gen.mastrNummer} <100 kW without DV remote control flag`,
            isMandatory
              ? 'Installations ≥100 kW must participate in Direktvermarktung (§ 21 Abs. 2 EEG).'
              : 'Voluntary Direktvermarktung recommended for Energy Sharing efficiency.',
            { mastrNummer: gen.mastrNummer, capacityKW, isMandatory },
            isMandatory ? 'Register with a certified Direktvermarkter immediately.' : null,
            idx
          )
        );
        return findings;
      }

      // DV flag is set — check register if DV name was declared
      if (!gen.direktvermarkter) {
        findings.push(
          createFinding(
            3,
            'directMarketer',
            DV_VALID,
            'info',
            `Generator ${gen.mastrNummer} DV remote control confirmed`,
            'FernsteuerbarkeitDv flag is set. No declared DV name to cross-check.',
            { mastrNummer: gen.mastrNummer, capacityKW },
            null,
            idx
          )
        );
        return findings;
      }

      const dvEntries = dvLookupResult?.data || dvLookupResult || [];
      if (!Array.isArray(dvEntries) || dvEntries.length === 0) {
        findings.push(
          createFinding(
            3,
            'directMarketer',
            DV_NOT_FOUND,
            'error',
            `Declared DV "${gen.direktvermarkter}" not found in MaStR register`,
            'cernion_direktvermarkter_lookup returned no results for the declared Direktvermarkter name.',
            { mastrNummer: gen.mastrNummer, direktvermarkter: gen.direktvermarkter },
            'Verify the Direktvermarkter name matches the MaStR register exactly.',
            idx
          )
        );
        return findings;
      }

      // DV found — check for ID mismatch if we have the MaStR DV ID from the installation
      const dvEntry = dvEntries[0];
      if (gen.dvMastrId && dvEntry.mastrId && gen.dvMastrId !== dvEntry.mastrId) {
        findings.push(
          createFinding(
            3,
            'directMarketer',
            DV_MASTR_MISMATCH,
            'warning',
            `DV MaStR-ID mismatch for generator ${gen.mastrNummer}`,
            `Installation DV-ID "${gen.dvMastrId}" ≠ register result "${dvEntry.mastrId}".`,
            {
              mastrNummer: gen.mastrNummer,
              installationDvId: gen.dvMastrId,
              registerDvId: dvEntry.mastrId,
            },
            'Confirm the correct Direktvermarkter with the generator operator.',
            idx
          )
        );
        return findings;
      }

      findings.push(
        createFinding(
          3,
          'directMarketer',
          DV_VALID,
          'info',
          `Generator ${gen.mastrNummer} DV confirmed: ${gen.direktvermarkter}`,
          'FernsteuerbarkeitDv set and DV found in register.',
          {
            mastrNummer: gen.mastrNummer,
            direktvermarkter: gen.direktvermarkter,
            dvMastrId: dvEntry.mastrId || gen.dvMastrId,
          },
          null,
          idx
        )
      );
      return findings;
    },

    /**
     * Step 3: Validate direct marketer status for all generators.
     * Returns { enrichedGenerators, findings }.
     */
    async stepDirectMarketer(ctx, enrichedGenerators, _params) {
      const token = ctx.meta?.cernionToken;
      const findings = [];

      // Cache DV lookups by name to avoid duplicate MCP calls
      const dvCache = new Map();

      const updatedGenerators = [];
      let dvIdx = 1;

      for (const gen of enrichedGenerators) {
        // Skip generators that failed MaStR validation entirely
        if (gen.status === 'invalid' && !gen.hasDvFlag) {
          updatedGenerators.push(gen);
          dvIdx++;
          continue;
        }

        let dvResult = null;
        if (gen.direktvermarkter) {
          if (dvCache.has(gen.direktvermarkter)) {
            dvResult = dvCache.get(gen.direktvermarkter);
          } else {
            try {
              dvResult = await this.callMcp(
                'cernion_direktvermarkter_lookup',
                {
                  name: gen.direktvermarkter,
                  onlyActive: true,
                },
                token
              );
              dvCache.set(gen.direktvermarkter, dvResult);
            } catch (_) {
              dvResult = null;
            }
          }
        }

        const dvFindings = this.buildDvFindings(gen, dvResult, dvIdx);
        findings.push(...dvFindings);

        const dvConfirmed = dvFindings.some((f) => f.finding === DV_VALID);
        updatedGenerators.push({ ...gen, dvConfirmed });
        dvIdx++;
      }

      return { enrichedGenerators: updatedGenerators, findings };
    },

    /**
     * Step 4: Energy Sharing eligibility assessment (§ 42c EnWG).
     * Pure function — no I/O.
     */
    stepEligibility(params, enrichedGenerators) {
      const { generators = [], consumers = [] } = params;
      const findings = [];
      let idx = 1;

      if (generators.length === 0) {
        findings.push(
          createFinding(
            4,
            'eligibility',
            NO_GENERATORS,
            'error',
            'No generators submitted',
            'The generators array is empty.',
            {},
            'Add at least one generator to the application.',
            idx++
          )
        );
      }

      if (consumers.length === 0) {
        findings.push(
          createFinding(
            4,
            'eligibility',
            NO_CONSUMERS,
            'error',
            'No consumers submitted',
            'The consumers array is empty.',
            {},
            'Add at least one consumer to the application.',
            idx++
          )
        );
      }

      // Duplicate generator MaStR numbers
      const genNrs = generators.map((g) => g.mastrNummer);
      const genDupeSeen = new Set();
      const genDupeReported = new Set();
      for (const nr of genNrs) {
        if (genDupeSeen.has(nr) && !genDupeReported.has(nr)) {
          findings.push(
            createFinding(
              4,
              'eligibility',
              GENERATOR_DUPLICATE,
              'error',
              `Generator MaStR-Nr ${nr} appears more than once`,
              'Each generator may only appear once in an Energy Sharing application.',
              { mastrNummer: nr },
              'Remove duplicate entries.',
              idx++
            )
          );
          genDupeReported.add(nr);
        }
        genDupeSeen.add(nr);
      }

      // Share sum checks (allow ±0.1% rounding tolerance)
      if (generators.length > 0) {
        const genSum = generators.reduce((s, g) => s + (Number(g.sharePercent) || 0), 0);
        if (Math.abs(genSum - 100) > 0.1) {
          findings.push(
            createFinding(
              4,
              'eligibility',
              SHARE_SUM_GENERATORS_INVALID,
              'error',
              `Generator share sum is ${genSum.toFixed(2)}% (must be 100%)`,
              'The sharePercent values of all generators must sum to exactly 100%.',
              { sum: genSum },
              'Adjust generator sharePercent values to sum to 100%.',
              idx++
            )
          );
        }
      }

      if (consumers.length > 0) {
        const conSum = consumers.reduce((s, c) => s + (Number(c.sharePercent) || 0), 0);
        if (Math.abs(conSum - 100) > 0.1) {
          findings.push(
            createFinding(
              4,
              'eligibility',
              SHARE_SUM_CONSUMERS_INVALID,
              'error',
              `Consumer share sum is ${conSum.toFixed(2)}% (must be 100%)`,
              'The sharePercent values of all consumers must sum to exactly 100%.',
              { sum: conSum },
              'Adjust consumer sharePercent values to sum to 100%.',
              idx++
            )
          );
        }
      }

      // Consumer MaLo format and duplicate checks
      const maloSeen = new Set();
      for (const con of consumers) {
        const maloId = con.maloId || '';
        if (!MALO_REGEX.test(maloId)) {
          findings.push(
            createFinding(
              4,
              'eligibility',
              CONSUMER_MALO_INVALID,
              'error',
              `Consumer MaLo-ID "${maloId}" has invalid format`,
              'MaLo-IDs must match DE[0-9]{31} (33 characters: "DE" + 31 digits).',
              { maloId },
              'Correct the MaLo-ID format.',
              idx++
            )
          );
        }
        if (maloId && maloSeen.has(maloId)) {
          findings.push(
            createFinding(
              4,
              'eligibility',
              CONSUMER_MALO_DUPLICATE,
              'error',
              `Consumer MaLo-ID "${maloId}" appears more than once`,
              'Each MaLo-ID may only appear once per Energy Sharing application.',
              { maloId },
              'Remove duplicate consumer entries.',
              idx++
            )
          );
        }
        maloSeen.add(maloId);
      }

      // Mixed grid areas (warning)
      const gridAreas = new Set(
        enrichedGenerators.filter((g) => g.gridArea).map((g) => g.gridArea)
      );
      if (gridAreas.size > 1) {
        findings.push(
          createFinding(
            4,
            'eligibility',
            MIXED_GRID_AREAS,
            'warning',
            `Generators span ${gridAreas.size} different grid areas`,
            'Energy Sharing generators should be within the same grid operator area (§ 42c EnWG).',
            { gridAreas: [...gridAreas] },
            'Verify all generators are in the same network area.',
            idx++
          )
        );
      }

      // Capacity limit warnings (> 1 MW per generator)
      for (const gen of enrichedGenerators.filter((g) => (g.capacityKW || 0) > 1000)) {
        findings.push(
          createFinding(
            4,
            'eligibility',
            GENERATOR_EXCEEDS_LIMIT,
            'warning',
            `Generator ${gen.mastrNummer} exceeds 1 MW (${gen.capacityKW} kW)`,
            'Installations >1 MW may be subject to special Energy Sharing regulations.',
            { mastrNummer: gen.mastrNummer, capacityKW: gen.capacityKW },
            'Check applicable special provisions with the regulatory authority.',
            idx++
          )
        );
      }

      const hasErrors = findings.some((f) => f.severity === 'error');
      if (!hasErrors) {
        findings.push(
          createFinding(
            4,
            'eligibility',
            ELIGIBILITY_CONFIRMED,
            'info',
            '§ 42c EnWG eligibility confirmed',
            'All structural checks passed: share sums valid, no duplicates, all MaLo formats correct.',
            { generatorCount: generators.length, consumerCount: consumers.length },
            null,
            idx
          )
        );
      }

      return findings;
    },

    /**
     * Step 5: Deterministic Go/No-Go decision engine (pure function).
     * Follows the CR decision matrix exactly.
     */
    stepDecision(findings) {
      const errors = findings.filter((f) => f.severity === 'error');
      const structural = errors.filter((f) =>
        [
          NO_GENERATORS,
          NO_CONSUMERS,
          SHARE_SUM_GENERATORS_INVALID,
          SHARE_SUM_CONSUMERS_INVALID,
          GENERATOR_DUPLICATE,
        ].includes(f.finding)
      );
      const genErrors = errors.filter(
        (f) => f.finding.startsWith('GENERATOR_') || f.finding.startsWith('DV_')
      );

      let code = ES_APPROVED;
      if (structural.length > 0) code = ES_REJECTED_STRUCTURAL;
      else if (genErrors.length > 0) code = ES_REJECTED_GENERATOR_INVALID;
      else if (errors.length > 0) code = ES_REJECTED_OTHER;
      else if (findings.some((f) => f.severity === 'warning')) code = ES_APPROVED_WITH_CONDITIONS;

      const isApproved = code === ES_APPROVED || code === ES_APPROVED_WITH_CONDITIONS;
      const severity =
        code === ES_APPROVED ? 'info' : code === ES_APPROVED_WITH_CONDITIONS ? 'warning' : 'error';

      return createFinding(
        5,
        'decision',
        code,
        severity,
        `Energy Sharing decision: ${code}`,
        `Regulatory basis: § 42c EnWG, § 21 Abs. 2 EEG, § 20b EnWG. ` +
          `Total findings: ${findings.length} (errors: ${errors.length}, warnings: ${findings.filter((f) => f.severity === 'warning').length}).`,
        {
          errors: errors.length,
          warnings: findings.filter((f) => f.severity === 'warning').length,
        },
        isApproved
          ? null
          : 'Review and resolve listed findings before resubmitting the application.',
        1
      );
    },

    /**
     * Step 6: Audit trail — validates snapshot and seals the report.
     * Returns { findings, snapshotValidation }.
     */
    async stepAudit(ctx, snapshotInfo, allFindings) {
      const findings = [];
      let idx = 1;
      let snapshotValidation = null;
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };

      if (snapshotInfo?.id) {
        try {
          snapshotValidation = await ctx.call(
            'datapoint.validateSnapshot',
            { id: snapshotInfo.id },
            callOpts
          );

          if (snapshotValidation?.drift?.length > 0) {
            findings.push(
              createFinding(
                6,
                'audit',
                SNAPSHOT_DRIFT_DETECTED,
                'warning',
                `Data drift detected in ${snapshotValidation.drift.length} datapoint(s)`,
                'One or more datapoints changed during pipeline execution. Results may be inconsistent.',
                { drift: snapshotValidation.drift, snapshotId: snapshotInfo.id },
                'Re-run validation after a data refresh to obtain a consistent result.',
                idx++
              )
            );
          }
        } catch (err) {
          this.logger.debug(`stepAudit: snapshot validation skipped — ${err.message}`);
        }
      }

      findings.push(
        createFinding(
          6,
          'audit',
          AUDIT_TRAIL_CREATED,
          'info',
          `Audit trail created — pipeline v${PIPELINE_VERSION}`,
          `Deterministic pipeline v${PIPELINE_VERSION} completed. No LLM involvement. All findings are rule-based.`,
          {
            pipelineVersion: PIPELINE_VERSION,
            snapshotId: snapshotInfo?.id || null,
            snapshotHash: snapshotValidation?.snapshotHash || snapshotInfo?.snapshotHash || null,
            findingsTotal: allFindings.length + findings.length,
            consistent: snapshotValidation?.consistent ?? null,
          },
          null,
          idx
        )
      );

      return { findings, snapshotValidation };
    },

    /**
     * Builds the dvStatus summary field from enriched generators.
     */
    buildDvStatus(enrichedGenerators) {
      if (enrichedGenerators.length === 0) return 'not_applicable';
      const confirmed = enrichedGenerators.filter((g) => g.dvConfirmed).length;
      if (confirmed === enrichedGenerators.length) return 'all_confirmed';
      if (confirmed === 0) return 'none_confirmed';
      return 'partial';
    },

    /**
     * Orchestrates all 6 pipeline steps.
     */
    async runPipeline(ctx, params) {
      const startTime = Date.now();
      const { datapointTags = [], maxAgeMinutes = 120 } = params;
      const allFindings = [];
      const stepSummaries = [];
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };

      // Create snapshot if datapointTags provided
      let snapshotInfo = null;
      if (datapointTags.length > 0) {
        try {
          const snap = await ctx.call(
            'datapoint.createSnapshot',
            {
              tags: datapointTags.join(','),
              maxAgeMinutes,
              createdBy: 'agent',
              name: `es-${(params.communityId || 'unknown').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`,
              description: `Energy Sharing validation snapshot for ${params.communityName || params.communityId || 'community'}`,
            },
            callOpts
          );
          snapshotInfo = { id: snap.id, status: snap.status, snapshotHash: snap.snapshotHash };
        } catch (err) {
          this.logger.warn(`runPipeline: snapshot creation skipped — ${err.message}`);
        }
      }

      // Helper: run one step, catch errors, record timing
      const runStep = async (stepNum, stepName, fn) => {
        const t0 = Date.now();
        try {
          const result = await fn();
          const stepFindings = Array.isArray(result) ? result : result?.findings || [];
          allFindings.push(...stepFindings);
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'success',
            durationMs: Date.now() - t0,
            findingsCount: stepFindings.length,
          });
          return result;
        } catch (err) {
          this.logger.error(`ES pipeline step ${stepNum} (${stepName}) failed: ${err.message}`);
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'error',
            durationMs: Date.now() - t0,
            findingsCount: 0,
            error: err.message,
          });
          return null;
        }
      };

      // Step 1: VNB Identity
      let identity = null;
      await runStep(1, 'identity', async () => {
        const r = await this.stepIdentity(ctx, params);
        identity = r.identity;
        return r.findings;
      });

      // Step 2: Generator MaStR Validation
      let enrichedGenerators = (params.generators || []).map((g) => ({
        ...g,
        status: 'unknown',
        findings: [],
      }));
      await runStep(2, 'generators', async () => {
        const r = await this.stepGenerators(ctx, identity, params);
        enrichedGenerators = r.enrichedGenerators;
        return r.findings;
      });

      // Step 3: Direct Marketer Validation
      await runStep(3, 'directMarketer', async () => {
        const r = await this.stepDirectMarketer(ctx, enrichedGenerators, params);
        enrichedGenerators = r.enrichedGenerators;
        return r.findings;
      });

      // Step 4: Eligibility Assessment
      await runStep(4, 'eligibility', () => this.stepEligibility(params, enrichedGenerators));

      // Step 5: Decision (reads allFindings from steps 1–4)
      let decision = ES_APPROVED;
      await runStep(5, 'decision', () => {
        const decisionFinding = this.stepDecision(allFindings);
        decision = decisionFinding.finding;
        return [decisionFinding];
      });

      // Step 6: Audit
      let auditResult = null;
      await runStep(6, 'audit', async () => {
        auditResult = await this.stepAudit(ctx, snapshotInfo, allFindings);
        return auditResult.findings;
      });

      const generatorsValid = enrichedGenerators.filter((g) => g.status === 'valid').length;
      const totalGeneratorCapacityKW = enrichedGenerators.reduce(
        (s, g) => s + (g.capacityKW || 0),
        0
      );

      return {
        communityName: params.communityName || '',
        communityId: params.communityId || '',
        gridOperator: identity || {
          mastrId: params.gridOperatorId || null,
          name: 'Unknown',
          bdew: params.gridOperatorBdew || null,
        },
        decision,
        summary: {
          generatorsSubmitted: (params.generators || []).length,
          generatorsValid,
          generatorsInvalid: (params.generators || []).length - generatorsValid,
          consumersSubmitted: (params.consumers || []).length,
          dvStatus: this.buildDvStatus(enrichedGenerators),
          totalGeneratorCapacityKW,
          findingsCount: summarizeFindings(allFindings),
          durationMs: Date.now() - startTime,
        },
        generators: enrichedGenerators,
        consumers: (params.consumers || []).map((c) => ({
          ...c,
          status: MALO_REGEX.test(c.maloId || '') ? 'accepted' : 'invalid',
        })),
        findings: allFindings,
        steps: stepSummaries,
        snapshot: snapshotInfo
          ? {
              id: snapshotInfo.id,
              status: snapshotInfo.status,
              snapshotHash: snapshotInfo.snapshotHash,
              consistent: auditResult?.snapshotValidation?.consistent ?? null,
              drift: auditResult?.snapshotValidation?.drift || null,
            }
          : null,
        metadata: {
          pipelineVersion: PIPELINE_VERSION,
          executedAt: new Date().toISOString(),
          regulatoryBasis: '§ 42c EnWG, § 21 Abs. 2 EEG, § 20b EnWG',
          maxAgeMinutes,
        },
      };
    },
  },
};
