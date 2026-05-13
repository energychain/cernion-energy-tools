'use strict';

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
  SIMULTANEITY_FACTORS,
  INVENTORY_COMPLETE,
  INVENTORY_EMPTY,
  INSTALLATION_NO_NAP,
  INSTALLATION_STATUS_ANOMALY,
  MASTR_DUPLICATE_SUSPECTED,
  OPERATOR_DATA_STALE,
  VOLTAGE_LEVEL_MISMATCH,
  CAPACITY_HEADROOM_OK,
  TRANSFORMER_DATA_MISSING,
  EWK_BENCHMARK_SLOW,
  EWK_BENCHMARK_FAST,
  EWK_IMPLEMENTATION_LOW,
  GO_DIRECT,
  GO_CONDITIONAL,
  NO_GO_EXPANSION,
  DATA_QUALITY_INSUFFICIENT,
  AUDIT_TRAIL_CREATED,
  SNAPSHOT_DRIFT_DETECTED,
} = require('../src/validation-findings');

const PIPELINE_VERSION = '0.14.0';

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'grid-connection',

  settings: {
    dbPath: process.env.GRID_CONNECTION_DB_PATH || './data/grid-connections',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperator.mastrId'] } });
    this.logger.info(`Grid-connection validation DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: {
    /**
     * Run the 6-step Netzanschluss validation pipeline.
     * Deterministic - no LLM, no probabilistic logic.
     */
    validate: {
      rest: 'POST /validate',
      timeout: 120_000,
      params: {
        gridOperatorId: { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        gridOperatorName: { type: 'string', optional: true },
        datapointTags: { type: 'array', items: 'string', optional: true, default: [] },
        maxAgeMinutes: { type: 'number', optional: true, default: 120, convert: true },
        skipSteps: { type: 'array', items: 'number', optional: true, default: [] },
        includeCapacityCheck: { type: 'boolean', optional: true, default: false, convert: true },
        scenarioAdditions: {
          type: 'array',
          optional: true,
          default: [],
          items: {
            type: 'object',
            props: {
              id: { type: 'string', optional: true },
              type: { type: 'string', optional: true },
              capacityKW: { type: 'number', optional: true, convert: true },
              capacityMW: { type: 'number', optional: true, convert: true },
              energietraeger: { type: 'string', optional: true },
              voltageLevel: { type: 'string', optional: true },
            },
          },
        },
        scenarioCapacityMW: { type: 'number', optional: true, convert: true },
      },
      openapi: {
        summary: 'Run Netzanschluss validation pipeline (6-step, deterministic)',
        description:
          'Executes a deterministic 6-step grid connection validation pipeline: ' +
          'inventory → delta → capacity → EWK benchmark → Go/No-Go decision → audit trail. ' +
          'No LLM involvement — identical inputs always produce identical finding codes. ' +
          'Results are persisted to the validation database and retrievable via GET /validations/:id.',
        tags: ['Grid Connection Validation'],
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
                  gridOperatorName: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy match via marketPartners)',
                    example: 'TWL Netze',
                  },
                  datapointTags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for datapoint snapshot creation (Weg B)',
                    example: ['twl-netze'],
                  },
                  maxAgeMinutes: {
                    type: 'integer',
                    default: 120,
                    description: 'Datapoint freshness threshold in minutes',
                  },
                  skipSteps: {
                    type: 'array',
                    items: { type: 'integer' },
                    description: 'Pipeline step numbers to skip (e.g. [4] skips EWK benchmark)',
                    example: [],
                  },
                  includeCapacityCheck: {
                    type: 'boolean',
                    default: false,
                    description: 'Call cernion_connection_capacity_check for headroom data',
                  },
                  scenarioAdditions: {
                    type: 'array',
                    description:
                      'Optional What-If installations added virtually for this validation run only.',
                    example: [
                      { id: 'whatif-pv-1', type: 'solar', capacityMW: 1.5, voltageLevel: 'MS' },
                    ],
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', example: 'whatif-1' },
                        type: { type: 'string', example: 'solar' },
                        capacityKW: { type: 'number', example: 1500 },
                        capacityMW: { type: 'number', example: 1.5 },
                        energietraeger: { type: 'string', example: 'solar' },
                        voltageLevel: { type: 'string', example: 'MS' },
                      },
                    },
                  },
                  scenarioCapacityMW: {
                    type: 'number',
                    description:
                      'Optional extra capacity (MW) injected as a synthetic What-If installation.',
                    example: 2.5,
                  },
                },
              },
              examples: {
                'By MaStR ID': {
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    datapointTags: ['twl-netze'],
                    maxAgeMinutes: 120,
                  },
                },
                'By BDEW code': {
                  value: { gridOperatorBdew: '9907473000008' },
                },
                'By name': {
                  value: { gridOperatorName: 'TWL Netze', skipSteps: [4] },
                },
                'What-If scenario': {
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    scenarioAdditions: [
                      { id: 'whatif-pv-1', type: 'solar', capacityMW: 1.5, voltageLevel: 'MS' },
                    ],
                    scenarioCapacityMW: 0.8,
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
            description: 'ValidationReport with findings from all 6 pipeline steps',
            content: {
              'application/json': {
                example: {
                  success: true,
                  id: 'a1b2c3d4-...',
                  decision: 'GO_CONDITIONAL',
                  summary: {
                    totalInstallations: 59,
                    totalCapacityMW: 73.4,
                    findingsCount: { info: 4, warning: 7, error: 1 },
                    durationMs: 12450,
                  },
                  snapshot: { id: 'snap-uuid', consistent: true, drift: null },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return runAsync(ctx, {
          service: 'grid-connection',
          action: 'validate',
          params: ctx.params,
          worker: async () => {
            const { gridOperatorId, gridOperatorBdew, gridOperatorName } = ctx.params;
            if (!gridOperatorId && !gridOperatorBdew && !gridOperatorName) {
              throw new Error(
                'At least one of gridOperatorId, gridOperatorBdew, or gridOperatorName is required'
              );
            }

            const operator = await this.resolveOperator(ctx, ctx.params);
            const report = await this.runPipeline(ctx, ctx.params, operator);

            // Persist to PouchDB (KRITIS: raw installation data NOT stored, only report metadata)
            const id = crypto.randomUUID();
            const doc = {
              _id: `val:${id}`,
              id,
              type: 'grid-connection-validation',
              gridOperator: report.gridOperator,
              decision: report.decision,
              summary: report.summary,
              findings: report.findings,
              snapshot: report.snapshot,
              steps: report.steps,
              metadata: {
                ...report.metadata,
                inputParams: {
                  gridOperatorId: ctx.params.gridOperatorId || null,
                  gridOperatorBdew: ctx.params.gridOperatorBdew || null,
                  gridOperatorName: ctx.params.gridOperatorName || null,
                  datapointTags: ctx.params.datapointTags || [],
                  maxAgeMinutes: ctx.params.maxAgeMinutes,
                  skipSteps: ctx.params.skipSteps || [],
                  includeCapacityCheck: ctx.params.includeCapacityCheck || false,
                  scenarioAdditionsCount: (ctx.params.scenarioAdditions || []).length,
                  scenarioCapacityMW: ctx.params.scenarioCapacityMW || 0,
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
     * List past validation reports (newest first).
     */
    list: {
      rest: 'GET /validations',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true, max: 200 },
        cursor: { type: 'string', optional: true },
        offset: { type: 'number', optional: true, convert: true, min: 0 },
      },
      openapi: {
        summary: 'List past grid connection validation reports',
        description:
          'Returns validation reports stored in PouchDB, newest first. Filter by gridOperatorId.',
        tags: ['Grid Connection Validation'],
        parameters: [
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB935578300972' },
            description: 'Filter by MaStR grid operator ID',
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
            description: 'Paginated list of validation report summaries',
            content: {
              'application/json': {
                example: {
                  count: 3,
                  validations: [
                    {
                      id: '...',
                      gridOperator: { name: 'TWL Netze' },
                      decision: 'GO_CONDITIONAL',
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
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'val:',
          endkey: 'val:\ufff0',
        });

        let docs = result.rows.map((r) => r.doc);

        if (ctx.params.gridOperatorId) {
          docs = docs.filter((d) => d.gridOperator?.mastrId === ctx.params.gridOperatorId);
        }

        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        const tenantId = resolveTenantId(ctx);
        const filterHash = buildFilterHash({ gridOperatorId: ctx.params.gridOperatorId || null });
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
     * Retrieve a single validation report by ID.
     */
    get: {
      rest: 'GET /validations/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get a specific validation report by ID',
        description:
          'Returns the full ValidationReport document including all findings and snapshot reference.',
        tags: ['Grid Connection Validation'],
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
          200: { description: 'Full ValidationReport document' },
          404: { description: 'Validation not found' },
        },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`val:${ctx.params.id}`);
          return { success: true, ...doc };
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Validation ${ctx.params.id} not found` };
          }
          throw err;
        }
      },
    },

    // -----------------------------------------------------------------------
    // Phase 5 — fNAV Validation (v0.51.5)
    // -----------------------------------------------------------------------

    /**
     * Validate an fNAV profile against grid connection capacity.
     * Delegates to grid-operations.netzfahrplanGenerate (deterministic core).
     */
    fnavValidate: {
      rest: 'POST /fnav/validate',
      timeout: 60_000,
      params: {
        gridOperatorId: { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        gridOperatorName: { type: 'string', optional: true },
        fnavProfile: {
          type: 'object',
          props: {
            requestedCapacity: { type: 'number', min: 0, convert: true },
            firmCapacity: { type: 'number', min: 0, optional: true, convert: true },
            flexibleCapacity: { type: 'number', min: 0, optional: true, default: 0, convert: true },
            curtailmentWindow: { type: 'number', min: 0, max: 24, optional: true, default: 0, convert: true },
            operatingConstraint: { type: 'string', optional: true },
            contractStatus: { type: 'string', optional: true },
            legalStatus: { type: 'string', optional: true },
            evidenceLevel: { type: 'string', optional: true },
          },
        },
        voltageLevel: { type: 'enum', values: ['NS', 'MS', 'HS'], optional: true, default: 'MS' },
        n1ThresholdOverride: {
          type: 'object', optional: true,
          props: {
            tenant: { type: 'number', optional: true, convert: true },
            project: { type: 'number', optional: true, convert: true },
            scenario: { type: 'number', optional: true, convert: true },
          },
        },
        ownerContact: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Validate fNAV profile against grid connection capacity (Phase 5)',
        description:
          'Applies the fNAV capacity model (§14a EnWG) for a proposed grid connection. ' +
          'Runs N-1 compliance check with hybrid threshold (Option C: domain default + ' +
          'tenant/project/scenario override). Reports technical feasibility and enforces ' +
          'governance gate (Option B: final status is requires_governance_decision until ' +
          'legalStatus=approved AND contractStatus=signed). ' +
          'Delegates to grid-operations.netzfahrplanGenerate for the deterministic core.',
        tags: ['Netzfahrplan / fNAV'],
        'x-oeo-class': [
          'https://openenergyplatform.org/ontology/oeo/OEO_00000143',
          'https://openenergyplatform.org/ontology/oeo/OEO_00020107',
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fnavProfile'],
                properties: {
                  gridOperatorName: { type: 'string', example: 'TWL Netze' },
                  voltageLevel: {
                    type: 'string',
                    enum: ['NS', 'MS', 'HS'],
                    default: 'MS',
                    description: 'Voltage level of the connection point',
                  },
                  fnavProfile: {
                    type: 'object',
                    example: { requestedCapacity: 5000, firmCapacity: 3000, flexibleCapacity: 2000, curtailmentWindow: 4, contractStatus: 'negotiating', legalStatus: 'pending' },
                    required: ['requestedCapacity'],
                    properties: {
                      requestedCapacity: { type: 'number', example: 5000, description: 'Requested capacity in kW' },
                      firmCapacity: { type: 'number', example: 3000, description: 'Guaranteed firm capacity in kW' },
                      flexibleCapacity: { type: 'number', example: 2000, description: 'Curtailable §14a flex capacity in kW' },
                      curtailmentWindow: { type: 'number', example: 4, description: 'Max curtailment hours per day (0–24)' },
                      operatingConstraint: { type: 'string', example: '§14a max 2h/event' },
                      contractStatus: { type: 'string', example: 'negotiating' },
                      legalStatus: { type: 'string', example: 'pending' },
                    },
                  },
                  n1ThresholdOverride: {
                    type: 'object',
                    example: { project: 78 },
                    description: 'Override N-1 threshold (MVA) at tenant/project/scenario level',
                    properties: {
                      tenant: { type: 'number', example: 85 },
                      project: { type: 'number', example: 78 },
                      scenario: { type: 'number', example: 70 },
                    },
                  },
                  ownerContact: {
                    type: 'string',
                    example: 'netzplanung@twl.de',
                    description: 'Responsible owner — required for governance approval',
                  },
                },
              },
              examples: {
                'fNAV hybrid MS': {
                  value: {
                    gridOperatorName: 'TWL Netze',
                    voltageLevel: 'MS',
                    fnavProfile: {
                      requestedCapacity: 5000,
                      firmCapacity: 3000,
                      flexibleCapacity: 2000,
                      curtailmentWindow: 4,
                      contractStatus: 'signed',
                      legalStatus: 'approved',
                    },
                    ownerContact: 'netzplanung@twl.de',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'fNAV validation result with capacity model, N-1 check, and governance status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    capacityModel: { type: 'object', description: 'Normalised fNAV capacity model' },
                    n1Check: { type: 'object', description: 'N-1 compliance result' },
                    feasibility: { type: 'string', enum: ['feasible', 'conditional', 'copper_needed'] },
                    governanceStatus: { type: 'string' },
                    governanceBlockers: { type: 'array', items: { type: 'string' } },
                    findings: { type: 'array', items: { type: 'object' } },
                    metadata: { type: 'object' },
                    source: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          fnavProfile,
          voltageLevel,
          n1ThresholdOverride,
          ownerContact,
          gridOperatorId,
          gridOperatorBdew,
          gridOperatorName,
        } = ctx.params;

        const result = await ctx.call(
          'grid-operations.netzfahrplanGenerate',
          {
            gridOperatorId,
            gridOperatorName: gridOperatorName || gridOperatorBdew,
            voltageLevel: voltageLevel || 'MS',
            requestedCapacityKW: fnavProfile.requestedCapacity,
            firmCapacityKW: fnavProfile.firmCapacity,
            flexibleCapacityKW: fnavProfile.flexibleCapacity || 0,
            curtailmentWindow: fnavProfile.curtailmentWindow || 0,
            operatingConstraint: fnavProfile.operatingConstraint,
            contractStatus: fnavProfile.contractStatus,
            legalStatus: fnavProfile.legalStatus,
            ownerContact,
            n1ThresholdOverride,
          },
          { meta: { ...ctx.meta, $gateway: false } }
        );

        return { ...result, source: 'grid-connection.fnavValidate' };
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Methods — pipeline steps and helpers
  // ---------------------------------------------------------------------------
  methods: {
    /**
     * Resolves grid operator identity from any input form.
     * Returns { mastrId, name, bdew, bnr }.
     */
    async resolveOperator(ctx, params) {
      const { gridOperatorId, gridOperatorBdew, gridOperatorName } = params;
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      const stripAnnotation = (id) => (id || '').split(' ')[0].trim();

      if (gridOperatorId) {
        let name = 'Unknown';
        let bdew = gridOperatorBdew || null;
        let bnr = null;
        if (bdew) {
          try {
            const r = await ctx.call(
              'grid-operations.vnbLookupCodes',
              { bdewCode: bdew },
              callOpts
            );
            const c = r?.data?.canonical || r?.canonical || {};
            if (c.name) name = c.name;
            if (c.bnr) bnr = c.bnr;
          } catch (_) {
            /* best effort */
          }
        }
        return { mastrId: gridOperatorId, name, bdew, bnr };
      }

      if (gridOperatorBdew) {
        try {
          const r = await ctx.call(
            'grid-operations.vnbLookupCodes',
            { bdewCode: gridOperatorBdew },
            callOpts
          );
          const c = r?.data?.canonical || r?.canonical || {};
          return {
            mastrId: stripAnnotation(c.mastrId) || null,
            name: c.name || 'Unknown',
            bdew: gridOperatorBdew,
            bnr: c.bnr || null,
          };
        } catch (_) {
          return { mastrId: null, name: 'Unknown', bdew: gridOperatorBdew, bnr: null };
        }
      }

      if (gridOperatorName) {
        try {
          const mp = await ctx.call(
            'grid-operations.marketPartners',
            { query: gridOperatorName },
            callOpts
          );
          const results = mp?.data?.results || [];
          if (results.length > 0) {
            const r = results[0];
            return {
              mastrId: stripAnnotation(r.mastrId) || null,
              name: r.companyName || gridOperatorName,
              bdew: r.bdewCode || null,
              bnr: null,
            };
          }
        } catch (_) {
          /* best effort */
        }
        return { mastrId: null, name: gridOperatorName, bdew: null, bnr: null };
      }

      throw new Error(
        'At least one of gridOperatorId, gridOperatorBdew, or gridOperatorName is required'
      );
    },

    /**
     * Step 1: Fetch installation inventory.
     * Weg B: datapoint.data if matching datapoint exists.
     * Weg A: cernion_installations_local via MCP.
     */
    async stepInventory(ctx, operator, params) {
      const { datapointTags = [] } = params;
      const token = ctx.meta?.cernionToken;
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };

      // Weg B: check for datapoint with matching tags
      if (datapointTags.length > 0) {
        try {
          const dpList = await ctx.call(
            'datapoint.list',
            { tags: datapointTags.join(',') },
            callOpts
          );
          const inventoryDp = (dpList.datapoints || []).find((dp) =>
            (dp.tags || []).some((t) =>
              ['mastr-portfolio', 'grid-connection-inventory'].includes(t)
            )
          );
          if (inventoryDp) {
            const dpData = await ctx.call('datapoint.data', { name: inventoryDp.name }, callOpts);
            const rows = dpData?.data?.rows || dpData?.rows || [];
            if (rows.length > 0) {
              this.logger.debug(
                `stepInventory: using datapoint "${inventoryDp.name}" (${rows.length} rows)`
              );
              return rows;
            }
          }
        } catch (err) {
          this.logger.debug(`stepInventory: datapoint fallback skipped — ${err.message}`);
        }
      }

      // Weg A: direct MCP call
      if (!operator.mastrId) {
        throw new Error(
          `Cannot fetch inventory: MaStR ID not resolved for operator "${operator.name}". ` +
            'Provide gridOperatorId or a resolvable gridOperatorBdew/gridOperatorName.'
        );
      }

      const result = await CernionMCPClient.callWithNewSession(
        'cernion_installations_local',
        {
          gridOperatorMastrId: operator.mastrId,
          minCapacity: 100,
          format: 'detailed',
          includeStats: true,
          limit: 5000,
        },
        token
      );

      // Normalize flat response shape (see v0.10.3)
      return result?.installations || result?.data?.installations || [];
    },

    /**
     * Derives an installation type string from a raw MaStR record.
     */
    deriveInstallationType(inst) {
      const et = String(inst.Energietraeger || inst.energietraeger || '').toLowerCase();
      if (['solar', 'photovoltaik', 'pv'].some((t) => et.includes(t))) return 'solar';
      if (['wind', 'windkraft'].some((t) => et.includes(t))) return 'wind';
      if (['speicher', 'battery', 'batterie', 'storage'].some((t) => et.includes(t)))
        return 'storage';
      if (['biomasse', 'biogas', 'biomethan'].some((t) => et.includes(t))) return 'biomass';
      if (['verbrennung', 'gas', 'kohle', 'combustion'].some((t) => et.includes(t)))
        return 'combustion';
      // Field-based heuristics
      if (inst.Modulanzahl || inst.GrossflächePv) return 'solar';
      if (inst.Nabenhoehe || inst.Rotordurchmesser) return 'wind';
      if (inst.Speicherkapazitaet) return 'storage';
      return 'other';
    },

    /**
     * Builds Step 1 findings from the installations array (pure function).
     */
    buildInventoryFindings(installations) {
      const findings = [];
      let idx = 1;

      if (installations.length === 0) {
        findings.push(
          createFinding(
            1,
            'inventory',
            INVENTORY_EMPTY,
            'error',
            'No installations ≥100 kW found in grid area',
            'cernion_installations_local returned no results for this grid operator with minCapacity: 100.',
            { query: { minCapacity: 100 } },
            'Verify the MaStR ID is correct and the grid operator has registered installations.',
            idx++
          )
        );
        return findings;
      }

      const byType = {};
      let totalCapacityKW = 0;
      for (const inst of installations) {
        const t = this.deriveInstallationType(inst);
        byType[t] = (byType[t] || 0) + 1;
        totalCapacityKW += parseFloat(inst.NettoNennleistung || 0);
      }

      findings.push(
        createFinding(
          1,
          'inventory',
          INVENTORY_COMPLETE,
          'info',
          `${installations.length} installations ≥100 kW found (${(totalCapacityKW / 1000).toFixed(1)} MW total)`,
          `Inventory complete: ${Object.entries(byType)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ')}.`,
          {
            total: installations.length,
            capacityMW: parseFloat((totalCapacityKW / 1000).toFixed(2)),
            byType,
          },
          null,
          idx++
        )
      );

      const noNap = installations.filter((i) => !i.nap && !i.NapMastrNummer && !i.napMastrNummer);
      if (noNap.length > 0) {
        findings.push(
          createFinding(
            1,
            'inventory',
            INSTALLATION_NO_NAP,
            'warning',
            `${noNap.length} installation(s) without NAP assignment`,
            'These installations lack a Netzanschlusspunkt in MaStR, making voltage level validation impossible.',
            {
              count: noNap.length,
              mastrNumbers: noNap.slice(0, 10).map((i) => i.EinheitMastrNummer),
            },
            'Request NAP assignment from grid operator or submit correction via MaStR portal.',
            idx++
          )
        );
      }

      const anomalous = installations.filter((i) => parseInt(i.einheitBetriebsstatus || 0) !== 35);
      if (anomalous.length > 0) {
        findings.push(
          createFinding(
            1,
            'inventory',
            INSTALLATION_STATUS_ANOMALY,
            'warning',
            `${anomalous.length} installation(s) with status other than "In Betrieb" (35)`,
            'Some installations are not in operational status. This may include "In Planung" (31) or decommissioned units.',
            {
              count: anomalous.length,
              mastrNumbers: anomalous.slice(0, 10).map((i) => i.EinheitMastrNummer),
            },
            'Review status of listed installations and deregister inactive units from MaStR.',
            idx++
          )
        );
      }

      return findings;
    },

    /**
     * Step 2: Delta analysis — pure function, no async.
     */
    stepDelta(installations) {
      const findings = [];
      let idx = 1;

      // Check for suspected duplicates (same PLZ + capacity within ±10%)
      const seen = [];
      for (const inst of installations) {
        const plz = inst.Postleitzahl;
        const cap = parseFloat(inst.NettoNennleistung || 0);
        if (!plz || cap <= 0) continue;
        const dup = seen.find(
          (s) => s.plz === plz && cap > 0 && Math.abs(s.cap - cap) / Math.max(s.cap, cap) <= 0.1
        );
        if (dup) {
          findings.push(
            createFinding(
              2,
              'delta',
              MASTR_DUPLICATE_SUSPECTED,
              'warning',
              `Possible duplicate: ${dup.mastr} / ${inst.EinheitMastrNummer}`,
              `Two installations in PLZ ${plz} with similar capacity (${dup.cap} kW / ${cap} kW, ≤10% difference).`,
              { mastrA: dup.mastr, mastrB: inst.EinheitMastrNummer, plz, capA: dup.cap, capB: cap },
              'Review both records in the MaStR portal. Deregister any duplicate.',
              idx++
            )
          );
        } else {
          seen.push({ plz, cap, mastr: inst.EinheitMastrNummer });
        }
      }

      // Check for stale operator data (NBP status ≠ 2954 Geprüft)
      const stale = installations.filter((i) => {
        const s = i.netzbetreiberPruefungStatus;
        return s !== undefined && s !== null && String(s) !== '2954';
      });
      if (stale.length > 0) {
        findings.push(
          createFinding(
            2,
            'delta',
            OPERATOR_DATA_STALE,
            'warning',
            `${stale.length} installation(s) not confirmed by grid operator (NBP ≠ Geprüft)`,
            `NetzbetreiberPrüfung status is not 2954 (Geprüft) for ${stale.length} installations.`,
            {
              count: stale.length,
              mastrNumbers: stale.slice(0, 10).map((i) => i.EinheitMastrNummer),
            },
            'Initiate Netzbetreiberprüfung for listed installations.',
            idx++
          )
        );
      }

      // Check for voltage level mismatch (unit vs. NAP)
      const mismatched = installations.filter((i) => {
        const unitV = i.spannungsebene || i.Spannungsebene;
        const napV = i.nap?.Spannungsebene || i.napSpannungsebene;
        return unitV && napV && String(unitV) !== String(napV);
      });
      if (mismatched.length > 0) {
        findings.push(
          createFinding(
            2,
            'delta',
            VOLTAGE_LEVEL_MISMATCH,
            'error',
            `${mismatched.length} installation(s) with voltage level mismatch (unit vs. NAP)`,
            'Installation voltage level does not match the connected NAP voltage level. This invalidates capacity calculations.',
            {
              count: mismatched.length,
              mastrNumbers: mismatched.slice(0, 10).map((i) => i.EinheitMastrNummer),
            },
            'Correct voltage level assignments in MaStR. Escalate to grid operator for NAP re-assignment.',
            idx++
          )
        );
      }

      return findings;
    },

    /**
     * Step 3: Capacity assessment — pure function.
     * Returns { capacityByVoltage, findings }.
     */
    stepCapacity(installations) {
      const findings = [];
      let idx = 1;
      const capacityByVoltage = {};

      for (const inst of installations) {
        const voltageLevel =
          inst.nap?.Spannungsebene || inst.spannungsebene || inst.Spannungsebene || 'UNKNOWN';
        const type = this.deriveInstallationType(inst);
        const capacityKW = parseFloat(inst.NettoNennleistung || 0);
        const factor = (SIMULTANEITY_FACTORS[type] || SIMULTANEITY_FACTORS.other).default;

        if (!capacityByVoltage[voltageLevel]) {
          capacityByVoltage[voltageLevel] = {
            installedKW: 0,
            simultaneousKW: 0,
            headroomPercent: null,
          };
        }
        capacityByVoltage[voltageLevel].installedKW += capacityKW;
        capacityByVoltage[voltageLevel].simultaneousKW += capacityKW * factor;
      }

      // MaStR does not provide transformer capacity ratings — headroom cannot be calculated
      findings.push(
        createFinding(
          3,
          'capacity',
          TRANSFORMER_DATA_MISSING,
          'warning',
          'No transformer capacity data available — headroom cannot be calculated',
          'MaStR does not contain transformer ratings. Use cernion_connection_capacity_check or request the grid network plan from the VNB.',
          { voltages: Object.keys(capacityByVoltage) },
          'Request transformer capacity data from grid operator or enable includeCapacityCheck.',
          idx++
        )
      );

      const totalInstalledKW = Object.values(capacityByVoltage).reduce(
        (s, v) => s + v.installedKW,
        0
      );
      const totalSimultaneousKW = Object.values(capacityByVoltage).reduce(
        (s, v) => s + v.simultaneousKW,
        0
      );

      findings.push(
        createFinding(
          3,
          'capacity',
          CAPACITY_HEADROOM_OK,
          'info',
          `Simultaneous capacity: ${(totalSimultaneousKW / 1000).toFixed(1)} MW ` +
            `(${(totalInstalledKW / 1000).toFixed(1)} MW installed, headroom: unknown)`,
          'Simultaneity-adjusted aggregate. Transformer headroom cannot be assessed without grid network data.',
          { totalInstalledKW, totalSimultaneousKW, byVoltage: capacityByVoltage },
          null,
          idx++
        )
      );

      return { capacityByVoltage, findings };
    },

    /**
     * Step 4: EWK regulatory benchmark.
     * Calls ewk-monitoring service actions (which handle BNr/BDEW mapping internally).
     */
    async stepBenchmark(ctx, operator) {
      const findings = [];
      let idx = 1;
      const bdewOrBnr = operator.bnr || operator.bdew;
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };

      if (!bdewOrBnr) {
        return findings; // Cannot run EWK benchmark without a code
      }

      let anschlussdauerRows = [];
      let umsetzungsquoteRows = [];

      try {
        const r = await ctx.call('ewk-monitoring.anschlussdauer', { bnr: bdewOrBnr }, callOpts);
        anschlussdauerRows = r?.data?.rows || r?.rows || [];
      } catch (err) {
        this.logger.debug(`stepBenchmark: ewk-monitoring.anschlussdauer failed — ${err.message}`);
      }

      try {
        const r = await ctx.call('ewk-monitoring.umsetzungsquote', { bnr: bdewOrBnr }, callOpts);
        umsetzungsquoteRows = r?.data?.rows || r?.rows || [];
      } catch (err) {
        this.logger.debug(`stepBenchmark: ewk-monitoring.umsetzungsquote failed — ${err.message}`);
      }

      if (anschlussdauerRows.length > 0) {
        const row = anschlussdauerRows[0];
        const avgDays = parseFloat(
          row.durchschnittliche_anschlussdauer_tage || row.anschlussdauer_tage || row.avg_days || 0
        );
        const medianDays = parseFloat(row.bundesmedian_tage || row.bundesmedian || 60);

        if (avgDays > 0 && avgDays > medianDays) {
          findings.push(
            createFinding(
              4,
              'benchmark',
              EWK_BENCHMARK_SLOW,
              'warning',
              `Connection time ${avgDays} days > federal median ${medianDays} days`,
              `${operator.name} average connection time (${avgDays} days) exceeds the federal median (${medianDays} days).`,
              { avgDays, medianDays, operator: operator.name },
              'Review internal processes for grid connection applications. Consider BNetzA inquiry if systematically slow.',
              idx++
            )
          );
        } else if (avgDays > 0) {
          findings.push(
            createFinding(
              4,
              'benchmark',
              EWK_BENCHMARK_FAST,
              'info',
              `Connection time ${avgDays} days ≤ federal median ${medianDays} days`,
              `${operator.name} average connection time (${avgDays} days) meets or beats the federal median.`,
              { avgDays, medianDays, operator: operator.name },
              null,
              idx++
            )
          );
        }
      }

      if (umsetzungsquoteRows.length > 0) {
        const row = umsetzungsquoteRows[0];
        const quote = parseFloat(
          row.umsetzungsquote_prozent || row.quote_prozent || row.umsetzungsquote || 0
        );
        if (quote > 0 && quote < 50) {
          findings.push(
            createFinding(
              4,
              'benchmark',
              EWK_IMPLEMENTATION_LOW,
              'warning',
              `Implementation rate ${quote.toFixed(1)}% below 50% threshold`,
              'Less than 50% of registered projects have been implemented, indicating bottlenecks.',
              { quote, operator: operator.name },
              'Investigate backlogs in the grid connection process. Proactive scheduling recommended.',
              idx++
            )
          );
        }
      }

      return findings;
    },

    /**
     * Step 5: Deterministic Go/No-Go decision engine (pure function).
     * Returns a single Finding.
     */
    stepDecision(findings) {
      const hasCapacityError = findings.some((f) => f.finding === 'CAPACITY_EXPANSION_NEEDED');
      const hasDataQualityIssue = findings.some(
        (f) => f.finding === 'INVENTORY_EMPTY' || f.finding === 'VOLTAGE_LEVEL_MISMATCH'
      );
      const isConditional = findings.some((f) => f.finding === 'CAPACITY_CONDITIONAL');

      if (hasDataQualityIssue) {
        return createFinding(
          5,
          'decision',
          DATA_QUALITY_INSUFFICIENT,
          'error',
          'Data quality insufficient for grid connection decision',
          'Critical issues (missing inventory or voltage level mismatches) prevent a reliable decision.',
          { hasCapacityError, hasDataQualityIssue, isConditional, totalFindings: findings.length },
          'Resolve data quality findings before re-running the validation pipeline.',
          1
        );
      }
      if (hasCapacityError) {
        return createFinding(
          5,
          'decision',
          NO_GO_EXPANSION,
          'error',
          'No-Go: Grid expansion required before connection',
          'Available capacity is below the 10% threshold. Grid expansion must precede new connections.',
          { hasCapacityError, hasDataQualityIssue, isConditional, totalFindings: findings.length },
          'Commission grid expansion study and submit reinforcement request to VNB.',
          1
        );
      }
      if (isConditional) {
        return createFinding(
          5,
          'decision',
          GO_CONDITIONAL,
          'warning',
          'Conditional Go: connection possible with §14a requirements',
          'Available capacity is between 10–20%. Connection is possible subject to §14a EnWG controllable device obligations.',
          { hasCapacityError, hasDataQualityIssue, isConditional, totalFindings: findings.length },
          'Prepare §14a agreement. Install SMGW + Steuerbox. Inform customer of potential 2h dimming windows.',
          1
        );
      }
      return createFinding(
        5,
        'decision',
        GO_DIRECT,
        'info',
        'Go: Direct grid connection possible',
        'Sufficient grid capacity available (>20% headroom). No §14a conditions required.',
        { hasCapacityError, hasDataQualityIssue, isConditional, totalFindings: findings.length },
        null,
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

      if (snapshotInfo?.id) {
        try {
          snapshotValidation = await ctx.call(
            'datapoint.validateSnapshot',
            { id: snapshotInfo.id },
            { meta: { ...ctx.meta, $gateway: false } }
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
                'Re-run validation after data refresh to obtain a consistent result.',
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
          idx++
        )
      );

      return { findings, snapshotValidation };
    },

    /**
     * Orchestrates all 6 pipeline steps.
     */
    async runPipeline(ctx, params, operator) {
      const startTime = Date.now();
      const {
        maxAgeMinutes = 120,
        skipSteps = [],
        datapointTags = [],
        scenarioAdditions = [],
        scenarioCapacityMW = 0,
      } = params;
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
              name: `gc-${(operator.mastrId || 'unknown').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`,
              description: `Grid connection validation snapshot for ${operator.name}`,
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
        if ((skipSteps || []).includes(stepNum)) {
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'skipped',
            durationMs: 0,
            findingsCount: 0,
          });
          return null;
        }
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
          this.logger.error(`Pipeline step ${stepNum} (${stepName}) failed: ${err.message}`);
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

      // Step 1: Inventory
      let installations = [];
      await runStep(1, 'inventory', async () => {
        installations = await this.stepInventory(ctx, operator, params);
        const scenarioResult = this.applyWhatIfScenario(installations, {
          scenarioAdditions,
          scenarioCapacityMW,
        });
        installations = scenarioResult.installations;
        const findings = this.buildInventoryFindings(installations);
        if (scenarioResult.finding) {
          findings.push(scenarioResult.finding);
        }
        return findings;
      });

      // Step 2: Delta
      await runStep(2, 'delta', () => this.stepDelta(installations));

      // Step 3: Capacity
      await runStep(3, 'capacity', () => {
        const result = this.stepCapacity(installations);
        return result.findings;
      });

      // Step 4: EWK benchmark
      await runStep(4, 'benchmark', () => this.stepBenchmark(ctx, operator));

      // Step 5: Decision (reads allFindings from steps 1–4)
      let decision = GO_DIRECT;
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

      // Build summary
      const byType = {};
      for (const inst of installations) {
        const t = this.deriveInstallationType(inst);
        byType[t] = (byType[t] || 0) + 1;
      }
      const totalCapacityMW =
        installations.reduce((sum, i) => sum + parseFloat(i.NettoNennleistung || 0), 0) / 1000;

      return {
        gridOperator: operator,
        decision,
        summary: {
          totalInstallations: installations.length,
          totalCapacityMW: parseFloat(totalCapacityMW.toFixed(2)),
          installationsByType: byType,
          findingsCount: summarizeFindings(allFindings),
          durationMs: Date.now() - startTime,
        },
        findings: allFindings,
        snapshot: snapshotInfo
          ? {
              id: snapshotInfo.id,
              status: snapshotInfo.status,
              snapshotHash: snapshotInfo.snapshotHash,
              consistent: auditResult?.snapshotValidation?.consistent ?? null,
              drift: auditResult?.snapshotValidation?.drift || null,
            }
          : null,
        steps: stepSummaries,
        metadata: {
          pipelineVersion: PIPELINE_VERSION,
          executedAt: new Date().toISOString(),
          maxAgeMinutes,
          scenario: {
            additionsCount: scenarioAdditions.length,
            extraCapacityMW: parseFloat((scenarioCapacityMW || 0).toFixed(3)),
            applied: scenarioAdditions.length > 0 || scenarioCapacityMW > 0,
          },
        },
      };
    },

    applyWhatIfScenario(installations, scenario = {}) {
      const base = Array.isArray(installations) ? [...installations] : [];
      const additions = Array.isArray(scenario.scenarioAdditions) ? scenario.scenarioAdditions : [];
      const capacityMW = Number(scenario.scenarioCapacityMW || 0);

      const virtualInstallations = additions.map((item, index) => {
        const mw = Number(item.capacityMW || 0);
        const kw = Number(item.capacityKW || 0);
        const netKW = mw > 0 ? mw * 1000 : kw > 0 ? kw : 0;
        return {
          EinheitMastrNummer: item.id || `WHATIF-${Date.now()}-${index + 1}`,
          Energietraeger: item.energietraeger || item.type || 'other',
          NettoNennleistung: netKW,
          nap: {
            Spannungsebene: item.voltageLevel || 'MS',
          },
          _scenario: true,
        };
      });

      if (capacityMW > 0) {
        virtualInstallations.push({
          EinheitMastrNummer: `WHATIF-CAPACITY-${Date.now()}`,
          Energietraeger: 'other',
          NettoNennleistung: capacityMW * 1000,
          nap: { Spannungsebene: 'MS' },
          _scenario: true,
        });
      }

      if (virtualInstallations.length === 0) {
        return { installations: base, finding: null };
      }

      const totalScenarioMW =
        virtualInstallations.reduce((sum, inst) => sum + Number(inst.NettoNennleistung || 0), 0) /
        1000;

      return {
        installations: [...base, ...virtualInstallations],
        finding: createFinding(
          1,
          'inventory',
          'GC_WHAT_IF_SCENARIO_APPLIED',
          'info',
          'What-If scenario applied',
          `${virtualInstallations.length} virtual installation(s) added to this validation run.`,
          {
            scenarioInstallations: virtualInstallations.length,
            scenarioCapacityMW: parseFloat(totalScenarioMW.toFixed(3)),
          },
          'Review decision and capacity findings against baseline run without scenario.',
          999
        ),
      };
    },
  },
};
