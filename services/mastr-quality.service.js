'use strict';

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const CernionMCPClient = require('../src/mcp-client');
const jobStore = require('../src/job-store');
const {
  applyCursorPagination,
  applyOffsetDeprecationHeader,
  buildFilterHash,
  resolveTenantId,
} = require('../src/pagination');
const {
  createFinding,
  summarizeFindings,
  AUDIT_TRAIL_CREATED,
  SNAPSHOT_DRIFT_DETECTED,
  VNB_RESOLVED,
  VNB_AMBIGUOUS,
  VNB_NOT_FOUND,
  MQ_INVENTORY_COMPLETE,
  MQ_INVENTORY_EMPTY,
  MQ_STALE_PLANNING,
  MQ_STALE_TEMPORARY_SHUTDOWN,
  MQ_MISSING_COMMISSIONING_DATE,
  MQ_FUTURE_COMMISSIONING,
  MQ_NBP_PENDING,
  MQ_NBP_NOT_PLANNED,
  MQ_ZERO_CAPACITY,
  MQ_NEGATIVE_CAPACITY,
  MQ_IMPLAUSIBLE_HIGH_CAPACITY,
  MQ_NETTO_EXCEEDS_BRUTTO,
  MQ_MISSING_FEED_IN_TYPE,
  MQ_MISSING_NAP,
  MQ_MISSING_MELO,
  MQ_NAP_VNB_MISMATCH,
  MQ_VOLTAGE_MISMATCH,
  MQ_NAP_MULTI_UNIT,
  MQ_REDISPATCH_NO_NAP,
  MQ_PROBABLE_DUPLICATE,
  MQ_POSSIBLE_DUPLICATE,
  MQ_GEO_DUPLICATE,
  MQ_GEO_PLAUSIBLE,
  MQ_GEO_MISASSIGNMENT,
  MQ_GEO_CHECK_FAILED,
  QUALITY_DIMENSION_WEIGHTS,
  computeDimensionScore,
  computeQualityScore,
} = require('../src/validation-findings');

const PIPELINE_VERSION = '0.17.0';

// Dimension → step number mapping for score computation
const DIMENSION_STEPS = {
  status: [3],
  capacity: [4],
  connectionPoints: [5],
  duplicates: [6],
  geo: [7],
};

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'mastr-quality',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'MASTR_QUALITY_DB_PATH',
      defaultDbPath: './data/mastr-quality',
      indexes: [['createdAt'], ['gridOperator.mastrId']],
    }),
  ],

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: {
    /**
     * Run the 8-step MaStR portfolio quality audit pipeline.
     * Deterministic — no LLM, no probabilistic logic.
     */
    audit: {
      rest: 'POST /audit',
      timeout: 180_000,
      params: {
        gridOperatorId: { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        gridOperatorName: { type: 'string', optional: true },
        bdewCode: { type: 'string', optional: true },
        gridOperatorBnr: { type: 'string', optional: true },
        bnr: { type: 'string', optional: true },
        datapointTags: { type: 'array', items: 'string', optional: true, default: [] },
        maxAgeMinutes: { type: 'number', optional: true, default: 120, convert: true },
        skipSteps: { type: 'array', items: 'number', optional: true, default: [] },
        geoSampleSize: { type: 'number', optional: true, default: 10, convert: true, max: 50 },
      },
      openapi: {
        summary: 'Run MaStR portfolio quality audit (8-step, deterministic)',
        description:
          'Executes a deterministic 8-step MaStR data quality audit for a VNB portfolio: ' +
          'VNB identity → full inventory → status anomalies → capacity anomalies → ' +
          'connection point integrity → duplicate detection → geo spot check → audit trail. ' +
          'Returns a qualityScore (0–100) across 5 weighted dimensions. ' +
          'No LLM involvement — identical inputs always produce identical finding codes. ' +
          'Steps 3–7 can be skipped via the skipSteps parameter; scores are re-normalised. ' +
          'Steps 1, 2, and 8 are mandatory.',
        tags: ['MaStR Data Quality'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR grid operator ID (SNB.../GNB...)',
                    example: 'SNB935578300972',
                  },
                  gridOperatorBdew: {
                    type: 'string',
                    description: '13-digit BDEW market-partner code',
                    example: '9907473000008',
                  },
                  gridOperatorName: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy match)',
                    example: 'STROMDAO Netze',
                  },
                  bdewCode: {
                    type: 'string',
                    description: 'Alias for gridOperatorBdew',
                    example: '9907473000008',
                  },
                  gridOperatorBnr: {
                    type: 'string',
                    description: 'Alias BNR input (7/8 digits; tolerant format accepted)',
                    example: '10002977',
                  },
                  bnr: {
                    type: 'string',
                    description: 'Alias for gridOperatorBnr',
                    example: '10002977',
                  },
                  datapointTags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for datapoint snapshot (Weg B)',
                    example: ['stromdao-netze'],
                  },
                  maxAgeMinutes: {
                    type: 'integer',
                    default: 120,
                    description: 'Datapoint freshness threshold in minutes',
                  },
                  skipSteps: {
                    type: 'array',
                    items: { type: 'integer' },
                    description: 'Steps to skip (valid: 3–7; steps 1, 2, 8 are mandatory)',
                    example: [7],
                  },
                  geoSampleSize: {
                    type: 'integer',
                    default: 10,
                    maximum: 50,
                    description: 'Number of installations to geo-validate in step 7',
                  },
                },
              },
              examples: {
                'By MaStR ID': {
                  value: { gridOperatorId: 'SNB935578300972', datapointTags: ['stromdao-netze'] },
                },
                'By BDEW code, skip geo': {
                  value: { gridOperatorBdew: '9907473000008', skipSteps: [7] },
                },
                'By name, full audit': {
                  value: { gridOperatorName: 'STROMDAO Netze', geoSampleSize: 20 },
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
              'Internal (non-gateway) call: direct AuditReport with qualityScore, dimensions, and findings from all executed pipeline steps',
            content: {
              'application/json': {
                example: {
                  success: true,
                  id: 'a1b2c3d4-...',
                  qualityScore: 82,
                  qualityDimensions: {
                    status: { score: 90, findings: 2 },
                    capacity: { score: 85, findings: 3 },
                    connectionPoints: { score: 70, findings: 5 },
                    duplicates: { score: 100, findings: 0 },
                    geo: { score: 80, findings: 4 },
                  },
                  summary: {
                    totalInstallations: 142,
                    findingsCount: { info: 5, warning: 8, error: 2 },
                    missingNapFindings: 6,
                    missingNapDistinctAssets: 4,
                    missingNapRedispatchFindings: 3,
                    missingNapRedispatchDistinctAssets: 3,
                    napFindings: {
                      missingNapFindings: 6,
                      missingNapDistinctAssets: 4,
                      missingNapRedispatchFindings: 3,
                      missingNapRedispatchDistinctAssets: 3,
                      distinctAssetsAffected: 4,
                      perAssetFindingCount: {
                        SEE900000001: 2,
                        SEE900000002: 1,
                      },
                      duplicateByAsset: {
                        SEE900000001: 2,
                      },
                    },
                    durationMs: 45230,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return jobStore.startJob(
          ctx,
          { service: 'mastr-quality', action: 'audit' },
          async (jobId) => this.executeAudit(ctx, jobId)
        );
      },
    },

    /**
     * List past audit reports (newest first).
     */
    list: {
      rest: 'GET /audits',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true, max: 200 },
        cursor: { type: 'string', optional: true },
        offset: { type: 'number', optional: true, convert: true, min: 0 },
      },
      openapi: {
        summary: 'List past MaStR quality audit reports',
        description:
          'Returns audit reports stored in PouchDB, newest first. Filter by gridOperatorId.',
        tags: ['MaStR Data Quality'],
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
            description: 'List of audit report summaries',
            content: {
              'application/json': {
                example: {
                  count: 2,
                  audits: [
                    {
                      id: '...',
                      gridOperator: { name: 'STROMDAO Netze' },
                      qualityScore: 82,
                      createdAt: '2026-03-31T...',
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
          startkey: 'mq:',
          endkey: 'mq:\ufff0',
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
          audits: page.data.map((d) => ({
            id: d.id,
            gridOperator: d.gridOperator,
            qualityScore: d.qualityScore,
            qualityDimensions: d.qualityDimensions,
            skippedSteps: d.skippedSteps,
            createdAt: d.createdAt,
            findingsCount: d.findingsCount,
            durationMs: d.summary?.durationMs,
          })),
          pageInfo: page.pageInfo,
        };
      },
    },

    /**
     * Retrieve a single audit report by ID.
     */
    get: {
      rest: 'GET /audits/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get a specific MaStR quality audit report by ID',
        description:
          'Returns the full AuditReport document including all findings and quality dimensions.',
        tags: ['MaStR Data Quality'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' },
            description: 'Audit report UUID',
          },
        ],
        responses: {
          200: { description: 'Full AuditReport document' },
          404: { description: 'Audit report not found' },
        },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`mq:${ctx.params.id}`);
          return {
            success: true,
            ...doc,
            findings: Array.isArray(doc.findings) ? doc.findings : [],
          };
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Audit ${ctx.params.id} not found` };
          }
          throw err;
        }
      },
    },

    /**
     * Retrieve the OEMetadata v2.0 FAIR metadata for a specific audit report.
     */
    oemetadata: {
      rest: 'GET /audits/:id/oemetadata',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get OEMetadata v2.0 FAIR metadata for an audit report by ID',
        description: 'Returns a fully OEMetadata v2.0 conformant JSON-LD metadata document.',
        tags: ['MaStR Data Quality'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' },
            description: 'Audit report UUID',
          },
        ],
        responses: {
          200: { description: 'OEMetadata JSON-LD document' },
          404: { description: 'Audit report not found' },
        },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`mq:${ctx.params.id}`);
          const { buildOemetadataForAudit } = require('../src/audit-oemetadata-builder');
          return buildOemetadataForAudit(doc);
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Audit ${ctx.params.id} not found` };
          }
          throw err;
        }
      },
    },

    /**
     * Retrieve enriched details for a single finding within an audit.
     * Useful for UI drilldown without relying on compact rows only.
     */
    findingDetails: {
      rest: 'GET /audits/:id/findings/:findingId/details',
      params: {
        id: { type: 'string' },
        findingId: { type: 'string' },
      },
      openapi: {
        summary: 'Get details for a specific finding in an audit',
        description:
          'Returns the finding row with enriched standardized detail fields from finding.context.details ' +
          '(installation, connection, measurement).',
        tags: ['MaStR Data Quality'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' },
            description: 'Audit report UUID',
          },
          {
            name: 'findingId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'F-5-002' },
            description: 'Finding row ID within the audit (findings[].id)',
          },
        ],
        responses: {
          200: {
            description: 'Finding detail object',
            content: {
              'application/json': {
                example: {
                  success: true,
                  auditId: 'a1b2c3d4-1234-5678-90ab-cdef12345678',
                  findingId: 'F-5-002',
                  finding: {
                    id: 'F-5-002',
                    finding: 'MQ_REDISPATCH_NO_NAP',
                    step: 5,
                    severity: 'error',
                    context: {
                      mastrNummer: 'SEE900000001',
                      details: {
                        installation: {
                          mastrNummer: 'SEE900000001',
                          einheitId: 'EE123',
                          technology: 'solar',
                          status: '35',
                          commissioningDate: '2020-01-15',
                          brutto: 200,
                          operatorName: 'Musterbetreiber GmbH',
                        },
                        connection: {
                          napId: null,
                          napMastrNummer: null,
                          spannungsebene: null,
                          netzbetreiberName: null,
                        },
                        measurement: {
                          melo: null,
                          value: null,
                          rawValue: null,
                          resolvedValue: null,
                          valueSource: null,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Audit or finding not found',
          },
        },
      },
      async handler(ctx) {
        const { id, findingId } = ctx.params;

        let doc;
        try {
          doc = await this.db.get(`mq:${id}`);
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Audit ${id} not found` };
          }
          throw err;
        }

        const findings = Array.isArray(doc.findings) ? doc.findings : [];
        const finding = findings.find((f) => String(f?.id || '') === String(findingId));
        if (!finding) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Finding ${findingId} not found in audit ${id}` };
        }

        return {
          success: true,
          auditId: id,
          findingId,
          finding,
          details: finding?.context?.details || null,
        };
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Methods — pipeline steps and helpers
  // ---------------------------------------------------------------------------
  methods: {
    async executeAudit(ctx, jobId = null) {
      const normalizedInput = this.normalizeResolverInput(ctx.params);
      const { gridOperatorId, gridOperatorBdew, gridOperatorName, gridOperatorBnr } =
        normalizedInput;
      if (!gridOperatorId && !gridOperatorBdew && !gridOperatorName && !gridOperatorBnr) {
        throw new Error(
          'At least one of gridOperatorId, gridOperatorBdew, gridOperatorName, bdewCode, gridOperatorBnr, or bnr is required'
        );
      }

      const rawSkip = ctx.params.skipSteps || [];
      const invalidSteps = rawSkip.filter((s) => ![3, 4, 5, 6, 7].includes(s));
      if (invalidSteps.length > 0) {
        throw new Error(
          `Invalid skipSteps values: [${invalidSteps.join(', ')}]. Only steps 3–7 can be skipped.`
        );
      }

      if (jobId) jobStore.appendLog(jobId, 'pipeline', 5, 'Starting MaStR quality audit pipeline');
      const report = await this.runPipeline(ctx, {
        ...ctx.params,
        ...normalizedInput,
      });

      if (jobId) jobStore.appendLog(jobId, 'persistence', 90, 'Persisting audit report');
      const id = crypto.randomUUID();
      const doc = {
        _id: `mq:${id}`,
        id,
        type: 'mastr-quality-audit',
        gridOperator: report.gridOperator,
        qualityScore: report.qualityScore,
        qualityDimensions: report.qualityDimensions,
        summary: report.summary,
        findings: Array.isArray(report.findings) ? report.findings : [],
        findingsCount: report.summary?.findingsCount,
        skippedSteps: rawSkip,
        steps: report.steps,
        metadata: {
          ...report.metadata,
          inputParams: {
            gridOperatorId: ctx.params.gridOperatorId || null,
            gridOperatorBdew: ctx.params.gridOperatorBdew || null,
            gridOperatorName: ctx.params.gridOperatorName || null,
            bdewCode: ctx.params.bdewCode || null,
            gridOperatorBnr: ctx.params.gridOperatorBnr || null,
            bnr: ctx.params.bnr || null,
            datapointTags: ctx.params.datapointTags || [],
            maxAgeMinutes: ctx.params.maxAgeMinutes,
            skipSteps: rawSkip,
            geoSampleSize: ctx.params.geoSampleSize || 10,
          },
          resolver: report.resolver || null,
        },
        pipelineVersion: PIPELINE_VERSION,
        createdAt: new Date().toISOString(),
      };

      await this.db.put(doc);

      this.broker.emit('mastr-quality.audit.completed', {
        eventId: crypto.randomUUID(),
        auditId: id,
        gridOperator: report.gridOperator || null,
        qualityScore: report.qualityScore,
        findingsCount: report.summary?.findingsCount || null,
        timestamp: doc.createdAt,
      });

      if (jobId) jobStore.appendLog(jobId, 'completed', 100, 'MaStR quality audit completed');
      return { success: true, id, ...report };
    },

    // -------------------------------------------------------------------------
    // Step 1: VNB Identity resolution (MCP vnb_lookup_codes)
    // -------------------------------------------------------------------------
    normalizeResolverInput(params = {}) {
      const pick = (...values) => {
        for (const value of values) {
          if (value === null || value === undefined) continue;
          const text = String(value).trim();
          if (text) return text;
        }
        return null;
      };

      return {
        gridOperatorId: pick(params.gridOperatorId),
        gridOperatorBdew: pick(params.gridOperatorBdew, params.bdewCode),
        gridOperatorName: pick(params.gridOperatorName),
        gridOperatorBnr: pick(params.gridOperatorBnr, params.bnr),
      };
    },

    normalizeMastrId(rawValue) {
      if (!rawValue) return null;
      const normalized = String(rawValue).trim().split(' ')[0].toUpperCase();
      return normalized || null;
    },

    normalizeDigitCode(rawValue) {
      if (!rawValue) return null;
      const digits = String(rawValue).replace(/\D+/g, '');
      return digits || null;
    },

    createCodeVariants(rawValue, lengths = []) {
      const base = this.normalizeDigitCode(rawValue);
      if (!base) return [];
      const variants = new Set([base]);
      for (const len of lengths) {
        if (!Number.isFinite(len) || len <= 0) continue;
        if (base.length < len) variants.add(base.padStart(len, '0'));
        if (base.length > len) variants.add(base.slice(-len));
      }
      return Array.from(variants);
    },

    extractResolverCandidates(lookupResult) {
      const normalizeCandidate = (candidate, source) => ({
        mastrId: this.normalizeMastrId(candidate?.mastrId),
        name: candidate?.name || null,
        bdew: this.normalizeDigitCode(
          candidate?.bdew || candidate?.bdewCode || candidate?.bdewCodePrimary
        ),
        bnr: this.normalizeDigitCode(candidate?.bnr),
        source,
      });

      const merged = [];
      const canonical = lookupResult?.canonical || lookupResult?.data?.canonical;
      if (canonical) merged.push(normalizeCandidate(canonical, 'canonical'));

      const candidates = lookupResult?.candidates || lookupResult?.data?.candidates || [];
      for (const candidate of candidates) {
        merged.push(normalizeCandidate(candidate, 'candidate'));
      }

      const aliases = lookupResult?.aliases || lookupResult?.data?.aliases || [];
      for (const alias of aliases) {
        merged.push(normalizeCandidate(alias, 'alias'));
      }

      const seen = new Set();
      return merged.filter((candidate) => {
        if (!candidate.mastrId && !candidate.name && !candidate.bdew && !candidate.bnr)
          return false;
        const key = `${candidate.mastrId || ''}|${candidate.name || ''}|${candidate.bdew || ''}|${candidate.bnr || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },

    async resolveByMarketPartnerName(ctx, name, resolver) {
      if (!name) return null;
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      try {
        const result = await ctx.call(
          'grid-operations.marketPartners',
          { query: name, limit: 5 },
          callOpts
        );
        const candidates = result?.data?.results || [];
        const mapped = candidates.map((candidate) => ({
          mastrId: this.normalizeMastrId(candidate?.mastrId),
          name: candidate?.companyName || null,
          bdew: this.normalizeDigitCode(candidate?.bdewCode || candidate?.bdew),
          bnr: this.normalizeDigitCode(candidate?.bnr),
          source: 'marketPartners',
        }));

        resolver.candidates.push(...mapped);
        const match = mapped.find((candidate) => candidate.mastrId);
        if (!match) return null;

        resolver.strategy.push({
          path: 'name→marketPartners',
          input: name,
          matched: true,
          candidateCount: mapped.length,
        });

        return {
          mastrId: match.mastrId,
          name: match.name || name,
          bdew: match.bdew || null,
          bnr: match.bnr || null,
          matchedBy: 'name-marketPartners',
          confidence: 0.78,
        };
      } catch (err) {
        resolver.strategy.push({
          path: 'name→marketPartners',
          input: name,
          matched: false,
          error: err.message,
        });
        return null;
      }
    },

    async stepIdentity(ctx, params) {
      const normalizedInput = this.normalizeResolverInput(params);
      const { gridOperatorId, gridOperatorBdew, gridOperatorName, gridOperatorBnr } =
        normalizedInput;
      const token = ctx.meta?.cernionToken;
      const findings = [];
      let idx = 1;
      let operator = {
        mastrId: this.normalizeMastrId(gridOperatorId),
        name: gridOperatorName || 'Unknown',
        bdew: this.normalizeDigitCode(gridOperatorBdew),
        bnr: this.normalizeDigitCode(gridOperatorBnr),
      };

      const bdewVariants = this.createCodeVariants(gridOperatorBdew, [13, 7]);
      const bnrVariants = this.createCodeVariants(gridOperatorBnr, [8, 7]);
      const resolver = {
        input: {
          gridOperatorId: params.gridOperatorId || null,
          gridOperatorBdew: params.gridOperatorBdew || null,
          gridOperatorName: params.gridOperatorName || null,
          bdewCode: params.bdewCode || null,
          gridOperatorBnr: params.gridOperatorBnr || null,
          bnr: params.bnr || null,
        },
        normalized: {
          gridOperatorId: operator.mastrId,
          gridOperatorBdew: operator.bdew,
          gridOperatorName: operator.name === 'Unknown' ? null : operator.name,
          gridOperatorBnr: operator.bnr,
          bdewVariants,
          bnrVariants,
        },
        strategy: [],
        matchedBy: operator.mastrId ? 'gridOperatorId' : null,
        confidence: operator.mastrId ? 1.0 : 0,
        candidates: [],
      };

      const attempts = [];
      if (operator.mastrId) {
        attempts.push({
          path: 'mastrId',
          payload: { mastrId: operator.mastrId },
          confidence: 0.99,
        });
      }
      for (const code of bdewVariants) {
        attempts.push({ path: 'bdewCode', payload: { bdewCode: code }, confidence: 0.95 });
      }
      for (const code of bnrVariants) {
        attempts.push({ path: 'bnr', payload: { bnr: code }, confidence: 0.9 });
      }
      if (gridOperatorName) {
        attempts.push({ path: 'vnbName', payload: { vnbName: gridOperatorName }, confidence: 0.8 });
      }

      for (const attempt of attempts) {
        try {
          const result = await CernionMCPClient.callWithNewSession(
            'vnb_lookup_codes',
            { ...attempt.payload, includeAliases: true, limitCandidates: 10 },
            token
          );
          const candidates = this.extractResolverCandidates(result);
          resolver.candidates.push(...candidates);

          const canonical =
            candidates.find((candidate) => candidate.source === 'canonical') ||
            candidates[0] ||
            null;
          const matched = Boolean(canonical && canonical.mastrId);
          resolver.strategy.push({
            path: attempt.path,
            input: attempt.payload,
            matched,
            candidateCount: candidates.length,
          });

          if (matched) {
            operator = {
              mastrId: canonical.mastrId,
              name: canonical.name || operator.name,
              bdew: canonical.bdew || operator.bdew,
              bnr: canonical.bnr || operator.bnr,
            };
            resolver.matchedBy = attempt.path;
            resolver.confidence = attempt.confidence;
            break;
          }
        } catch (err) {
          resolver.strategy.push({
            path: attempt.path,
            input: attempt.payload,
            matched: false,
            error: err.message,
          });
        }
      }

      if (!operator.mastrId && gridOperatorName) {
        const mpResolved = await this.resolveByMarketPartnerName(ctx, gridOperatorName, resolver);
        if (mpResolved?.mastrId) {
          operator = {
            mastrId: mpResolved.mastrId,
            name: mpResolved.name || operator.name,
            bdew: mpResolved.bdew || operator.bdew,
            bnr: mpResolved.bnr || operator.bnr,
          };
          resolver.matchedBy = mpResolved.matchedBy;
          resolver.confidence = mpResolved.confidence;
        }
      }

      const dedupeResolverCandidates = [];
      const seen = new Set();
      for (const candidate of resolver.candidates) {
        const key = `${candidate.mastrId || ''}|${candidate.name || ''}|${candidate.bdew || ''}|${candidate.bnr || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedupeResolverCandidates.push(candidate);
      }
      resolver.candidates = dedupeResolverCandidates.slice(0, 20);

      if (operator.mastrId) {
        findings.push(
          createFinding(
            1,
            'identity',
            VNB_RESOLVED,
            'info',
            `VNB resolved: ${operator.name}`,
            `Operator identity resolved via ${resolver.matchedBy}. MaStR ID: ${operator.mastrId}.`,
            {
              operator,
              resolver: {
                matchedBy: resolver.matchedBy,
                confidence: resolver.confidence,
                candidateCount: resolver.candidates.length,
              },
            },
            null,
            idx++
          )
        );
      } else if (resolver.candidates.length > 1) {
        findings.push(
          createFinding(
            1,
            'identity',
            VNB_AMBIGUOUS,
            'warning',
            `Ambiguous VNB: ${resolver.candidates.length} candidates found`,
            'Resolver could not derive a unique MaStR ID from the provided inputs.',
            { resolver },
            'Provide gridOperatorId (MaStR SNB/GNB) or refine BDEW/BNR/name input.',
            idx++
          )
        );
      } else {
        findings.push(
          createFinding(
            1,
            'identity',
            VNB_NOT_FOUND,
            'warning',
            'VNB not resolved from provided identifiers',
            'Resolver attempted all lookup paths (BDEW, BNR, name, MaStR) but no MaStR ID could be determined.',
            { resolver },
            'Verify BDEW/BNR format or provide explicit gridOperatorId.',
            idx++
          )
        );
      }

      return { operator, findings, resolver };
    },

    // -------------------------------------------------------------------------
    // Step 2: Full portfolio inventory (MCP cernion_installations_local)
    // One call, no status/minCapacity filter — full portfolio
    // -------------------------------------------------------------------------
    async stepInventory(ctx, operator) {
      const token = ctx.meta?.cernionToken;

      if (!operator.mastrId) {
        throw new Error(
          `Cannot fetch inventory: MaStR ID not resolved for operator "${operator.name}". ` +
            'Provide gridOperatorId or a resolvable gridOperatorBdew.'
        );
      }

      const result = await CernionMCPClient.callWithNewSession(
        'cernion_installations_local',
        {
          gridOperatorMastrId: operator.mastrId,
          format: 'detailed',
          includeStats: true,
          limit: 10000,
        },
        token
      );

      // Normalize flat response shape (see v0.10.3 pattern)
      let installations = result?.installations || result?.data?.installations || [];

      try {
        const overrideResult = await ctx.call('assets.applyOverridesToInstallations', {
          installations,
          onlyApproved: true,
        });
        if (Array.isArray(overrideResult?.installations)) {
          installations = overrideResult.installations;
        }
      } catch (err) {
        this.logger.debug(
          `assets.applyOverridesToInstallations unavailable in stepInventory: ${err.message}`
        );
      }

      const findings = [];
      let idx = 1;

      if (installations.length === 0) {
        findings.push(
          createFinding(
            2,
            'inventory',
            MQ_INVENTORY_EMPTY,
            'error',
            'No installations found in MaStR for this grid operator',
            'cernion_installations_local returned 0 installations. The MaStR ID may be incorrect or the portfolio is unregistered.',
            { gridOperatorMastrId: operator.mastrId },
            'Verify the MaStR grid operator ID. Check MaStR portal for portfolio registrations.',
            idx++
          )
        );
        return { installations: [], findings };
      }

      // Build type and status maps for the summary finding
      const byType = {};
      const byStatus = {};
      for (const inst of installations) {
        const t = this.deriveInstallationType(inst);
        byType[t] = (byType[t] || 0) + 1;
        const s = String(inst.einheitBetriebsstatus || inst.EinheitBetriebsstatus || 'unknown');
        byStatus[s] = (byStatus[s] || 0) + 1;
      }

      const totalBruttoKW = installations.reduce((sum, i) => {
        return sum + parseFloat(i.bruttoleistung || i.Bruttoleistung || i.NettoNennleistung || 0);
      }, 0);

      findings.push(
        createFinding(
          2,
          'inventory',
          MQ_INVENTORY_COMPLETE,
          'info',
          `${installations.length} installations found (${(totalBruttoKW / 1000).toFixed(1)} MW total)`,
          `Full portfolio inventory complete: ${Object.entries(byType)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ')}.`,
          {
            total: installations.length,
            capacityMW: parseFloat((totalBruttoKW / 1000).toFixed(2)),
            byType,
            byStatus,
          },
          null,
          idx++
        )
      );

      return { installations, findings };
    },

    normalizeIdentifier(value) {
      if (value === undefined || value === null) return null;
      const normalized = String(value).trim();
      return normalized || null;
    },

    getFirstNormalizedValue(inst = {}, paths = []) {
      for (const path of paths) {
        const segments = String(path).split('.');
        let current = inst;
        for (const segment of segments) {
          if (!current || typeof current !== 'object') {
            current = null;
            break;
          }
          current = current[segment];
        }
        const normalized = this.normalizeIdentifier(current);
        if (normalized) return normalized;
      }
      return null;
    },

    getInstallationMastrNummer(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'EinheitMastrNummer',
        'einheitMastrNummer',
        'mastrNummer',
        'mastrnummer',
        'mastrNumber',
        'MastrNummer',
        'einheitNummer',
      ]);
    },

    getInstallationMelo(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'MeLo',
        'meLo',
        'melo',
        'messlokationsId',
        'MesslokationsId',
        'messlokation',
        'Messlokation',
        'nap.Messlokation',
        'nap.messlokation',
        'napData.messlokation',
      ]);
    },

    getInstallationNapId(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'nap.MastrNummer',
        'nap.mastrNummer',
        'NapMastrNummer',
        'napMastrNummer',
        'napId',
        'napData.napMastrNummer',
        'napData.MastrNummer',
      ]);
    },

    /**
     * Get NAP ID with full fallback chain (same paths as detail enrichment).
     * Matches getNapVoltageLevelWithFallback() logic to ensure checks and enrichment
     * use the same resolution paths. This prevents false positives like MQ_MISSING_NAP
     * when enrichment can resolve the NAP but checks cannot.
     * @returns { napId: string|null, source: string|null }
     */
    getInstallationNapIdWithFallback(inst = {}) {
      // Primary: direct NAP ID
      let napId = this.getInstallationNapId(inst);
      if (napId) return { napId, source: 'nap.MastrNummer' };

      // Fallback 1: alternate field paths (same as detail enrichment)
      napId = this.getFirstNormalizedValue(inst, [
        'napData.napMastrNummer',
        'napData.MastrNummer',
        'napData.mastrNummer',
      ]);
      if (napId) return { napId, source: 'napData' };

      // No NAP found via any path
      return { napId: null, source: null };
    },

    getInstallationEinheitId(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'EinheitId',
        'einheitId',
        'einheit_id',
        'unitId',
        'AnlagenbetreiberMastrNummer',
      ]);
    },

    getInstallationCommissioningDate(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'commissioningDate',
        'CommissioningDate',
        'inbetriebnahmedatum',
        'InbetriebnahmeDatum',
        'inbetriebnahmeDatum',
        'Inbetriebnahmedatum',
      ]);
    },

    getInstallationOperatorName(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'AnlagenbetreiberName',
        'anlagenbetreiberName',
        'betreiberName',
        'operatorName',
      ]);
    },

    getNapVoltageLevel(inst = {}) {
      return this.getFirstNormalizedValue(inst, [
        'nap.Spannungsebene',
        'nap.spannungsebene',
        'napSpannungsebene',
        'spannungsebene',
      ]);
    },

    resolveSpannungsebeneLabel(rawValue) {
      if (rawValue === undefined || rawValue === null) return null;
      const normalized = String(rawValue).trim();
      if (!normalized) return null;

      const lower = normalized.toLowerCase();
      if (lower === '354' || lower === 'ns' || lower === 'lv' || lower.includes('niederspan')) {
        return 'Niederspannung (LV)';
      }
      if (lower === '352' || lower === 'ms' || lower === 'mv' || lower.includes('mittelspan')) {
        return 'Mittelspannung (MV)';
      }
      if (lower === '347' || lower === 'hs' || lower === 'hv' || lower.includes('hochspan')) {
        return 'Hochspannung (HV)';
      }
      if (
        lower === '342' ||
        lower === 'ehs' ||
        lower === 'ehv' ||
        lower.includes('hoechst') ||
        lower.includes('höchst')
      ) {
        return 'Höchstspannung (EHV)';
      }

      return null;
    },

    getNapOperatorName(inst = {}) {
      // Try NAP-specific paths first
      let value = this.getFirstNormalizedValue(inst, [
        'nap.NetzbetreiberName',
        'nap.netzbetreiberName',
        'nap.netzbetreibername',
        'netzbetreiberName',
        'napNetzbetreiberName',
        'napData.netzbetreiberName',
        'nap.MastrNummer', // Last resort: use NAP MaStR ID to imply netzbetreiber
      ]);
      if (value && !value.match(/^SAN|^GAN/)) return value; // Return if not an ID
      // If we got a NAP ID, we'd need MCP lookup (deferred to detail enrichment)
      return value && value.match(/^SAN|^GAN/) ? null : value; // Nullify if it's just an ID without name
    },

    getInstallationOperatorNameWithFallback(inst = {}) {
      // Primary: explicit operator name field
      let name = this.getInstallationOperatorName(inst);
      if (name) return { name, source: 'AnlagenbetreiberName' };

      // Fallback: try to extract from owner data
      name = this.getFirstNormalizedValue(inst, ['betreiber', 'Betreiber', 'owner', 'Owner']);
      if (name) return { name, source: 'owner-field' };

      // Fallback: operator MaStR ID (would need external lookup)
      const operatorId = this.getFirstNormalizedValue(inst, [
        'AnlagenbetreiberMastrNummer',
        'anlagenbetreiberMastrNummer',
        'operatorMastrId',
      ]);
      if (operatorId) return { name: null, source: 'AnlagenbetreiberMastrNummer', operatorId };

      return { name: null, source: null };
    },

    getNapOperatorNameWithFallback(inst = {}) {
      // Primary: NAP operator name
      let name = this.getNapOperatorName(inst);
      if (name && !name.match(/^SAN|^GAN/)) return { name, source: 'nap.NetzbetreiberName' };

      // Fallback: try parent structure
      name = this.getFirstNormalizedValue(inst, [
        'napData.NetzbetreiberName',
        'napData.netzbetreiberName',
        'netzbetreiber',
        'Netzbetreiber',
      ]);
      if (name) return { name, source: 'napData' };

      // Last resort: NAP MaStR ID (would need external lookup)
      const napId = this.getInstallationNapId(inst);
      if (napId) return { name: null, source: 'napId', napMastrNummer: napId };

      return { name: null, source: null };
    },

    getNapVoltageLevelWithFallback(inst = {}) {
      // Primary: direct voltage level
      let level = this.getNapVoltageLevel(inst);
      if (level && !level.match(/^SAN|^GAN/)) return { level, source: 'nap.Spannungsebene' };

      // Fallback: try alternate paths
      level = this.getFirstNormalizedValue(inst, [
        'napData.Spannungsebene',
        'napData.spannungsebene',
        'Spannungsebene',
        'voltageLevel',
        'voltage_level',
      ]);
      if (level) return { level, source: 'napData' };

      // Try to infer from capacity (heuristic only)
      const brutto = inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung;
      const brutoNum = Number(brutto);
      if (Number.isFinite(brutoNum)) {
        if (brutoNum <= 10) return { level: '354', source: 'inferred-NS' }; // Niederspannung
        if (brutoNum <= 100) return { level: '352', source: 'inferred-MS' }; // Mittelspannung
        return { level: '347', source: 'inferred-HS' }; // Hochspannung
      }

      return { level: null, source: null };
    },

    getValueSourceInfo(inst = {}, details = {}) {
      // Determine where measurement data comes from
      if (details.valueSource) return details.valueSource;

      const melo = this.getInstallationMelo(inst);
      if (melo) return 'MeLo';

      const napId = this.getInstallationNapId(inst);
      if (napId) return 'NAP';

      if (inst.datapoint) return 'datapoint';
      if (inst.value !== undefined && inst.value !== null) return 'context';

      return null;
    },

    buildStandardizedFindingDetails(inst = {}, details = {}) {
      const mastrNummer = this.getInstallationMastrNummer(inst);
      const einheitId = this.getInstallationEinheitId(inst);
      const commissioningDate = this.getInstallationCommissioningDate(inst);
      const melo = this.getInstallationMelo(inst);
      const napId = this.getInstallationNapId(inst);

      const operatorInfo = this.getInstallationOperatorNameWithFallback(inst);
      const napOpInfo = this.getNapOperatorNameWithFallback(inst);
      const voltageInfo = this.getNapVoltageLevelWithFallback(inst);
      const spannungsebeneLabel = this.resolveSpannungsebeneLabel(voltageInfo.level);
      const valueSource = this.getValueSourceInfo(inst, details);

      const rawBrutto =
        details.brutto !== undefined
          ? details.brutto
          : inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung;
      const brutto = Number.isFinite(Number(rawBrutto)) ? Number(rawBrutto) : null;

      const technology =
        details.type !== undefined ? details.type : this.deriveInstallationType(inst);

      const status =
        details.status !== undefined
          ? String(details.status || '').trim() || null
          : String(inst.einheitBetriebsstatus || inst.EinheitBetriebsstatus || '').trim() || null;

      const rawValue = details.rawValue !== undefined ? details.rawValue : null;
      const resolvedValue =
        details.resolvedValue !== undefined ? details.resolvedValue : melo || null;

      return {
        installation: {
          mastrNummer: mastrNummer || null,
          einheitId: einheitId || null,
          technology: technology || null,
          status,
          commissioningDate: commissioningDate || null,
          brutto,
          operatorName: operatorInfo.name || null,
          operatorNameSource: operatorInfo.source,
          operatorMastrNummer: operatorInfo.operatorId || null,
        },
        connection: {
          napId: napId || null,
          napMastrNummer: napId || null,
          spannungsebene: voltageInfo.level || null,
          spannungsebeneLabel,
          spannungsebeneSource: voltageInfo.source,
          netzbetreiberName: napOpInfo.name || null,
          netzbetreiberNameSource: napOpInfo.source,
          netzbetreiberMastrNummer: napOpInfo.napMastrNummer || null,
        },
        measurement: {
          melo: melo || null,
          value: details.value !== undefined ? details.value : null,
          rawValue,
          resolvedValue,
          valueSource: valueSource || null,
        },
      };
    },

    buildInstallationFindingContext(inst, details = {}) {
      const {
        datapoint = null,
        value = null,
        expectedValue,
        status,
        type,
        brutto,
        ...rest
      } = details;

      const mastrNummer = this.getInstallationMastrNummer(inst);
      const einheitId = this.getInstallationEinheitId(inst);
      const napId = this.getInstallationNapId(inst);
      const melo = this.getInstallationMelo(inst);

      const context = {
        mastrNummer,
        datapoint,
        value,
      };

      if (melo) context.melo = melo;
      if (einheitId) context.einheitId = einheitId;
      if (napId) context.napId = napId;

      const resolvedStatus =
        status !== undefined
          ? status
          : String(inst.einheitBetriebsstatus || inst.EinheitBetriebsstatus || '');
      if (resolvedStatus) context.status = resolvedStatus;

      const resolvedType = type !== undefined ? type : this.deriveInstallationType(inst);
      if (resolvedType) context.type = resolvedType;

      let resolvedBrutto = brutto;
      if (resolvedBrutto === undefined) {
        const rawBrutto = inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung;
        if (rawBrutto !== undefined && rawBrutto !== null && rawBrutto !== '') {
          resolvedBrutto = parseFloat(rawBrutto);
        }
      }
      if (
        resolvedBrutto !== undefined &&
        resolvedBrutto !== null &&
        Number.isFinite(resolvedBrutto)
      ) {
        context.brutto = resolvedBrutto;
      }

      if (expectedValue !== undefined) context.expectedValue = expectedValue;

      if (!context.mastrNummer) {
        context.mastrNummer = null;
        if (!einheitId && !napId && !melo) {
          context.identifierMissing = true;
          context.identifierReason =
            'No traceable installation identifier found (mastrNummer, einheitId, napId, melo)';
        }
      }

      const merged = {
        ...context,
        ...rest,
      };

      const standardizedDetails = this.buildStandardizedFindingDetails(inst, {
        ...details,
        status: resolvedStatus || null,
        type: resolvedType || null,
        brutto: resolvedBrutto,
        value,
      });

      merged.details = standardizedDetails;
      merged.technology = standardizedDetails.installation.technology;
      merged.commissioningDate = standardizedDetails.installation.commissioningDate;
      merged.operatorName = standardizedDetails.installation.operatorName;
      merged.napMastrNummer = standardizedDetails.connection.napMastrNummer;
      merged.spannungsebene = standardizedDetails.connection.spannungsebene;
      merged.netzbetreiberName = standardizedDetails.connection.netzbetreiberName;
      if (merged.rawValue === undefined) merged.rawValue = standardizedDetails.measurement.rawValue;
      if (merged.resolvedValue === undefined)
        merged.resolvedValue = standardizedDetails.measurement.resolvedValue;
      if (merged.valueSource === undefined)
        merged.valueSource = standardizedDetails.measurement.valueSource;

      return {
        ...merged,
        mastr: merged.mastrNummer,
      };
    },

    buildPairFindingContext(instA, instB, details = {}) {
      const {
        datapoint = null,
        value = null,
        expectedValue,
        status,
        type,
        brutto,
        ...rest
      } = details;

      const mastrA = this.getInstallationMastrNummer(instA);
      const mastrB = this.getInstallationMastrNummer(instB);
      const meloA = this.getInstallationMelo(instA);
      const meloB = this.getInstallationMelo(instB);
      const napIdA = this.getInstallationNapId(instA);
      const napIdB = this.getInstallationNapId(instB);
      const einheitIdA = this.getInstallationEinheitId(instA);
      const einheitIdB = this.getInstallationEinheitId(instB);

      const context = {
        mastrNummer: [mastrA, mastrB],
        mastrNummerA: mastrA,
        mastrNummerB: mastrB,
        datapoint,
        value,
      };

      if (meloA || meloB) {
        context.melo = { a: meloA || null, b: meloB || null };
      }

      if (status !== undefined) context.status = status;
      if (type !== undefined) context.type = type;
      if (brutto !== undefined) context.brutto = brutto;
      if (expectedValue !== undefined) context.expectedValue = expectedValue;

      if (einheitIdA || einheitIdB)
        context.einheitId = { a: einheitIdA || null, b: einheitIdB || null };
      if (napIdA || napIdB) context.napId = { a: napIdA || null, b: napIdB || null };

      const missingA = !mastrA && !einheitIdA && !napIdA && !meloA;
      const missingB = !mastrB && !einheitIdB && !napIdB && !meloB;
      if (missingA || missingB) {
        context.identifierMissing = true;
        context.identifierReason = {
          a: missingA
            ? 'No traceable identifier in source record A (mastrNummer/einheitId/napId/melo)'
            : null,
          b: missingB
            ? 'No traceable identifier in source record B (mastrNummer/einheitId/napId/melo)'
            : null,
        };
      }

      context.details = {
        a: this.buildStandardizedFindingDetails(instA, {
          value: value?.a !== undefined ? value.a : value,
          status,
          type,
          brutto: typeof brutto === 'object' && brutto !== null ? brutto.a : brutto,
        }),
        b: this.buildStandardizedFindingDetails(instB, {
          value: value?.b !== undefined ? value.b : value,
          status,
          type,
          brutto: typeof brutto === 'object' && brutto !== null ? brutto.b : brutto,
        }),
      };

      return {
        ...context,
        mastrA,
        mastrB,
        ...rest,
      };
    },

    extractFindingMastrNumbers(finding) {
      const raw = finding?.context?.mastrNummer;
      if (Array.isArray(raw)) {
        return raw.filter((v) => typeof v === 'string' && v.trim() !== '');
      }
      if (typeof raw === 'string' && raw.trim() !== '') {
        return [raw];
      }
      return [];
    },

    summarizeNapFindings(findings = []) {
      const general = findings.filter((f) => f.finding === MQ_MISSING_NAP);
      const redispatch = findings.filter((f) => f.finding === MQ_REDISPATCH_NO_NAP);

      const uniqueGeneral = new Set();
      const uniqueRedispatch = new Set();
      const uniqueAll = new Set();
      const perAssetFindingCount = {};

      for (const finding of general) {
        for (const mastr of this.extractFindingMastrNumbers(finding)) {
          uniqueGeneral.add(mastr);
          uniqueAll.add(mastr);
          perAssetFindingCount[mastr] = (perAssetFindingCount[mastr] || 0) + 1;
        }
      }

      for (const finding of redispatch) {
        for (const mastr of this.extractFindingMastrNumbers(finding)) {
          uniqueRedispatch.add(mastr);
          uniqueAll.add(mastr);
          perAssetFindingCount[mastr] = (perAssetFindingCount[mastr] || 0) + 1;
        }
      }

      const duplicateByAsset = Object.fromEntries(
        Object.entries(perAssetFindingCount).filter(([, count]) => count > 1)
      );

      return {
        missingNapFindings: general.length,
        missingNapDistinctAssets: uniqueGeneral.size,
        missingNapRedispatchFindings: redispatch.length,
        missingNapRedispatchDistinctAssets: uniqueRedispatch.size,
        distinctAssetsAffected: uniqueAll.size,
        perAssetFindingCount,
        duplicateByAsset,
      };
    },

    // -------------------------------------------------------------------------
    // Step 3: Status anomalies (pure sync)
    // -------------------------------------------------------------------------
    stepStatusAnomalies(installations, now) {
      const findings = [];
      let idx = 1;
      const cutoffDate = now || new Date();
      const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
      const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

      const statusLabel = (inst) =>
        String(inst.einheitBetriebsstatus || inst.EinheitBetriebsstatus || '').toLowerCase();

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const status = statusLabel(inst);

        // Rule 1: Stale "InPlanung" — planning for >2 years
        const regDateStr = inst.registrierungsDatum || inst.Registrierungsdatum;
        if ((status === '31' || status === 'inplanung') && regDateStr) {
          const regDate = new Date(regDateStr);
          if (!isNaN(regDate) && cutoffDate - regDate > TWO_YEARS_MS) {
            findings.push(
              createFinding(
                3,
                'statusAnomalies',
                MQ_STALE_PLANNING,
                'warning',
                `${mastr}: stale planning status (${regDateStr})`,
                `Installation has been "InPlanung" since ${regDateStr} (>2 years). Likely abandoned or mislabelled.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: ['einheitBetriebsstatus', 'registrierungsDatum'],
                  value: { status, registrierungsDatum: regDateStr },
                  expectedValue: 'Status progression from InPlanung within 2 years',
                  status,
                  registrierungsDatum: regDateStr,
                  ageDays: Math.floor((cutoffDate - regDate) / 86400000),
                }),
                'Update MaStR status or deregister if project was abandoned.',
                idx++
              )
            );
          }
        }

        // Rule 2: Stale temporary shutdown >365 days
        const shutdownDateStr =
          inst.datumBeginnVoruebergehenderStilllegung ||
          inst.DatumBeginnVoruebergehenderStilllegung;
        if ((status === '37' || status === 'voruebergehendstillgelegt') && shutdownDateStr) {
          const shutdownDate = new Date(shutdownDateStr);
          if (!isNaN(shutdownDate) && cutoffDate - shutdownDate > ONE_YEAR_MS) {
            findings.push(
              createFinding(
                3,
                'statusAnomalies',
                MQ_STALE_TEMPORARY_SHUTDOWN,
                'warning',
                `${mastr}: temporary shutdown exceeds 365 days (${shutdownDateStr})`,
                `Installation has been temporarily shut down since ${shutdownDateStr}. Consider permanent decommissioning.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: ['einheitBetriebsstatus', 'datumBeginnVoruebergehenderStilllegung'],
                  value: { status, shutdownDate: shutdownDateStr },
                  expectedValue: 'Temporary shutdown should not exceed 365 days',
                  status,
                  shutdownDate: shutdownDateStr,
                  ageDays: Math.floor((cutoffDate - shutdownDate) / 86400000),
                }),
                'Update MaStR with actual operational status or register permanent decommissioning.',
                idx++
              )
            );
          }
        }

        // Rule 3: Missing commissioning date for operational units
        // Use centralized fallback chain to avoid false positives from field name variants.
        const ibDate = this.getInstallationCommissioningDate(inst);
        if ((status === '35' || status === 'inbetrieb') && !ibDate) {
          findings.push(
            createFinding(
              3,
              'statusAnomalies',
              MQ_MISSING_COMMISSIONING_DATE,
              'warning',
              `${mastr}: missing commissioning date (operational unit)`,
              'Operational installation has no Inbetriebnahmedatum in MaStR. Required for EEG tariff calculation.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'commissioningDate | inbetriebnahmedatum (with fallback)',
                value: null,
                expectedValue: 'YYYY-MM-DD',
                status,
              }),
              'Submit commissioning date correction via MaStR portal.',
              idx++
            )
          );
        }

        // Rule 4: Future commissioning date
        if (ibDate) {
          const ibDateObj = new Date(ibDate);
          if (!isNaN(ibDateObj) && ibDateObj > cutoffDate) {
            findings.push(
              createFinding(
                3,
                'statusAnomalies',
                MQ_FUTURE_COMMISSIONING,
                'error',
                `${mastr}: commissioning date in the future (${ibDate})`,
                `Inbetriebnahmedatum ${ibDate} is in the future for a registered installation. Data integrity issue.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: 'inbetriebnahmeDatum',
                  value: ibDate,
                  expectedValue: `<= ${cutoffDate.toISOString().slice(0, 10)}`,
                  status,
                  inbetriebnahmeDatum: ibDate,
                }),
                'Correct the commissioning date in MaStR. If genuinely future-dated, status should be "InPlanung".',
                idx++
              )
            );
          }
        }

        // Rule 5: NBP status = "InPrüfung" (2955)
        const nbpStatus = String(inst.netzbetreiberPruefungStatus || '');
        if (nbpStatus === '2955') {
          findings.push(
            createFinding(
              3,
              'statusAnomalies',
              MQ_NBP_PENDING,
              'warning',
              `${mastr}: NBP review pending (InPrüfung)`,
              'NetzbetreiberPrüfung status is 2955 (In Prüfung). Grid operator review not completed.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'netzbetreiberPruefungStatus',
                value: nbpStatus,
                expectedValue: '2954 (Geprüft)',
                status,
                netzbetreiberPruefungStatus: nbpStatus,
              }),
              'Complete Netzbetreiberprüfung in MaStR portal.',
              idx++
            )
          );
        }

        // Rule 6: NBP status = "NichtVorgesehen" (3075)
        if (nbpStatus === '3075') {
          findings.push(
            createFinding(
              3,
              'statusAnomalies',
              MQ_NBP_NOT_PLANNED,
              'warning',
              `${mastr}: NBP review not planned (NichtVorgesehen)`,
              'NetzbetreiberPrüfung status is 3075 (Nicht Vorgesehen). Regulatory review may be required.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'netzbetreiberPruefungStatus',
                value: nbpStatus,
                expectedValue: '2954 (Geprüft) or justified exemption',
                status,
                netzbetreiberPruefungStatus: nbpStatus,
              }),
              'Verify if NBP is required for this installation type. Update status if applicable.',
              idx++
            )
          );
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 4: Capacity anomalies (pure sync)
    // -------------------------------------------------------------------------
    stepCapacityAnomalies(installations) {
      const findings = [];
      let idx = 1;

      // Type-specific implausible-high thresholds (kW)
      const HIGH_THRESHOLDS = { solar: 50000, wind: 20000 };
      const DEFAULT_HIGH = 100000;

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const brutto = parseFloat(
          inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung || 0
        );
        const netto = parseFloat(inst.nettoNennleistung || inst.NettoNennleistung || 0);
        const type = this.deriveInstallationType(inst);

        // Rule 1: Zero capacity
        if (brutto === 0 && netto === 0) {
          findings.push(
            createFinding(
              4,
              'capacityAnomalies',
              MQ_ZERO_CAPACITY,
              'error',
              `${mastr}: zero capacity (brutto=0, netto=0)`,
              'Both Bruttoleistung and NettoNennleistung are 0. This installation contributes no capacity to grid calculations.',
              this.buildInstallationFindingContext(inst, {
                datapoint: ['bruttoleistung', 'nettoNennleistung'],
                value: { brutto, netto },
                expectedValue: '> 0',
                type,
                brutto,
                netto,
              }),
              'Enter correct capacity values in MaStR or deregister.',
              idx++
            )
          );
          continue;
        }

        // Rule 2: Negative capacity
        if (brutto < 0 || netto < 0) {
          findings.push(
            createFinding(
              4,
              'capacityAnomalies',
              MQ_NEGATIVE_CAPACITY,
              'error',
              `${mastr}: negative capacity (brutto=${brutto}, netto=${netto})`,
              'Negative capacity is physically impossible and indicates a data entry error.',
              this.buildInstallationFindingContext(inst, {
                datapoint: ['bruttoleistung', 'nettoNennleistung'],
                value: { brutto, netto },
                expectedValue: '>= 0',
                type,
                brutto,
                netto,
              }),
              'Correct capacity values in MaStR.',
              idx++
            )
          );
          continue;
        }

        // Rule 3: Implausibly high capacity
        const threshold = HIGH_THRESHOLDS[type] || DEFAULT_HIGH;
        if (brutto > threshold) {
          findings.push(
            createFinding(
              4,
              'capacityAnomalies',
              MQ_IMPLAUSIBLE_HIGH_CAPACITY,
              'warning',
              `${mastr}: implausibly high capacity ${brutto.toFixed(0)} kW (type: ${type}, threshold: ${threshold} kW)`,
              `Bruttoleistung of ${brutto} kW exceeds the plausibility threshold for type "${type}". Likely a unit error (kW vs. MW).`,
              this.buildInstallationFindingContext(inst, {
                datapoint: 'bruttoleistung',
                value: brutto,
                expectedValue: `<= ${threshold} kW`,
                type,
                brutto,
                netto,
                threshold,
              }),
              'Verify unit (kW vs. MW). Correct in MaStR if erroneous.',
              idx++
            )
          );
        }

        // Rule 4: NettoNennleistung > Bruttoleistung (physical impossibility)
        if (netto > 0 && brutto > 0 && netto > brutto) {
          findings.push(
            createFinding(
              4,
              'capacityAnomalies',
              MQ_NETTO_EXCEEDS_BRUTTO,
              'error',
              `${mastr}: netto (${netto} kW) > brutto (${brutto} kW)`,
              'NettoNennleistung cannot exceed Bruttoleistung. This violates physics and indicates a data entry error.',
              this.buildInstallationFindingContext(inst, {
                datapoint: ['nettoNennleistung', 'bruttoleistung'],
                value: { brutto, netto },
                expectedValue: 'nettoNennleistung <= bruttoleistung',
                type,
                brutto,
                netto,
              }),
              'Swap or correct capacity values in MaStR.',
              idx++
            )
          );
        }

        // Rule 5: Missing Einspeisungsart (feed-in type) for operational solar
        const feedInType = inst.einspeisungsart || inst.Einspeisungsart;
        if (type === 'solar' && !feedInType && String(inst.einheitBetriebsstatus || '') === '35') {
          findings.push(
            createFinding(
              4,
              'capacityAnomalies',
              MQ_MISSING_FEED_IN_TYPE,
              'warning',
              `${mastr}: missing feed-in type (Einspeisungsart)`,
              'Operational solar installation has no Einspeisungsart. Required for EEG tariff and billing.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'einspeisungsart',
                value: null,
                expectedValue: 'Volleinspeisung|Überschusseinspeisung',
                type,
                brutto,
              }),
              'Add Einspeisungsart (Volleinspeisung/Überschusseinspeisung) in MaStR.',
              idx++
            )
          );
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 5: Connection point integrity (pure sync)
    // -------------------------------------------------------------------------
    stepConnectionPointIntegrity(installations, gridOperatorId) {
      const findings = [];
      let idx = 1;

      // Build NAP → installations map to detect multi-unit NAPs
      // Use fallback resolution to match enrichment logic (prevents false positives)
      const napUnits = {};
      for (const inst of installations) {
        const { napId } = this.getInstallationNapIdWithFallback(inst);
        if (napId) {
          if (!napUnits[napId]) napUnits[napId] = [];
          napUnits[napId].push(inst.EinheitMastrNummer || inst.einheitMastrNummer);
        }
      }

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const { napId, source: napIdSource } = this.getInstallationNapIdWithFallback(inst);
        // Use getInstallationMelo() for consistency with context builder (same fallback chain)
        const melo = this.getInstallationMelo(inst);
        const brutto = parseFloat(
          inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung || 0
        );
        const type = this.deriveInstallationType(inst);

        // Rule 1: Missing NAP (now uses fallback resolution like enrichment logic)
        // Only fire if NAP cannot be resolved via ANY path (direct or fallback).
        // This eliminates false positives where enrichment successfully resolves NAP
        // but direct field is null (e.g., NAP via napData structure).
        if (!napId) {
          findings.push(
            createFinding(
              5,
              'connectionPoints',
              MQ_MISSING_NAP,
              'warning',
              `${mastr}: no NAP (Netzanschlusspunkt) assigned`,
              'General data quality issue: installation has no linked NAP in MaStR (checked via direct field and fallback paths). Grid operator routing and voltage level validation are not possible.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'nap.MastrNummer (with fallback)',
                value: null,
                expectedValue: 'NAP...',
                type,
                brutto,
                napId: null,
                napIdSource,
                rootIssue: 'MISSING_NAP',
                scope: 'general',
              }),
              'Assign correct NAP via MaStR portal or request assignment from grid operator.',
              idx++
            )
          );
        }

        // Rule 2: Missing MeLo for operational units ≥100 kW
        // Check effective MeLo value (using same resolution as getInstallationMelo for consistency)
        if (!melo && brutto >= 100 && String(inst.einheitBetriebsstatus || '') === '35') {
          findings.push(
            createFinding(
              5,
              'connectionPoints',
              MQ_MISSING_MELO,
              'warning',
              `${mastr}: missing MeLo (Messlokation) for ≥100 kW operational unit`,
              'Operational installation ≥100 kW has no Messlokations-ID. Required for billing and metering.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'meLo',
                value: null,
                expectedValue: 'DE... (33 chars)',
                type,
                brutto,
                rawValue: inst.MeLo || inst.meLo || inst.messlokationsId || null,
                resolvedValue: null,
                valueSource: 'Effective MeLo check (no raw value + no fallback)',
              }),
              'Register Messlokation with metering operator and link in MaStR.',
              idx++
            )
          );
        }

        // Rule 3: NAP VNB mismatch (if NAP data available with VNB info)
        if (napId && gridOperatorId) {
          const napVnb = inst.nap?.NetzbetreiberMastrNummer || inst.napNetzbetreiberMastrNummer;
          if (napVnb && napVnb !== gridOperatorId) {
            findings.push(
              createFinding(
                5,
                'connectionPoints',
                MQ_NAP_VNB_MISMATCH,
                'error',
                `${mastr}: NAP ${napId} belongs to different VNB (${napVnb})`,
                `The NAP assigned to this installation belongs to VNB ${napVnb}, not the audited VNB ${gridOperatorId}.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: 'nap.NetzbetreiberMastrNummer',
                  value: napVnb,
                  expectedValue: gridOperatorId,
                  type,
                  brutto,
                  napId,
                  napVnb,
                  auditedVnb: gridOperatorId,
                }),
                'Verify grid area assignment. Re-assign NAP to correct VNB if needed.',
                idx++
              )
            );
          }
        }

        // Rule 4: Voltage level mismatch — brutto ≥100 kW but NAP at NS (354)
        if (napId && brutto >= 100) {
          const napVoltage = String(inst.nap?.Spannungsebene || inst.napSpannungsebene || '');
          if (napVoltage === '354' || napVoltage.toLowerCase() === 'ns') {
            findings.push(
              createFinding(
                5,
                'connectionPoints',
                MQ_VOLTAGE_MISMATCH,
                'warning',
                `${mastr}: ${brutto.toFixed(0)} kW connected at Niederspannung (NS) — expected MS or higher`,
                'Installations ≥100 kW are typically connected at Mittelspannung or higher. NS connection may indicate a data error.',
                this.buildInstallationFindingContext(inst, {
                  datapoint: 'nap.Spannungsebene',
                  value: napVoltage,
                  expectedValue: 'MS|HS|EHS',
                  type,
                  brutto,
                  napVoltage,
                  napId,
                }),
                'Verify voltage level with grid operator. Update NAP voltage level in MaStR if incorrect.',
                idx++
              )
            );
          }
        }

        // Rule 5: NAP shared by >3 units — may indicate master-meter grouping issue
        if (
          napId &&
          napUnits[napId] &&
          napUnits[napId].length > 3 &&
          napUnits[napId][0] === mastr
        ) {
          findings.push(
            createFinding(
              5,
              'connectionPoints',
              MQ_NAP_MULTI_UNIT,
              'warning',
              `NAP ${napId}: shared by ${napUnits[napId].length} installations`,
              `More than 3 installations share the same NAP (${napId}). This may indicate incorrect NAP assignment or a master-meter grouping.`,
              this.buildInstallationFindingContext(inst, {
                mastrNummer: napUnits[napId].slice(0, 10),
                datapoint: 'nap.MastrNummer',
                value: napId,
                expectedValue: 'Unique NAP per installation (unless intentional grouping)',
                type,
                brutto,
                napId,
                unitCount: napUnits[napId].length,
                mastrNumbers: napUnits[napId].slice(0, 10),
              }),
              'Review NAP assignment. Each installation should have its own NAP unless intentionally grouped.',
              idx++
            )
          );
        }

        // Rule 6: Redispatch-relevant (≥100 kW) without NAP
        // Uses fallback resolution (same as Rule 1) to prevent false positives.
        if (!napId && brutto >= 100) {
          findings.push(
            createFinding(
              5,
              'connectionPoints',
              MQ_REDISPATCH_NO_NAP,
              'error',
              `${mastr}: Redispatch-relevant unit (${brutto.toFixed(0)} kW) without NAP`,
              'Regulatory Redispatch scope (subset of missing NAP): installations ≥100 kW must participate in Redispatch 2.0. Without a NAP (checked via direct field and fallback paths), they cannot be registered in the Redispatch process.',
              this.buildInstallationFindingContext(inst, {
                datapoint: 'nap.MastrNummer (with fallback)',
                value: null,
                expectedValue: 'NAP... (required for redispatch >=100kW)',
                type,
                brutto,
                napId: null,
                napIdSource,
                rootIssue: 'MISSING_NAP',
                scope: 'redispatch',
              }),
              'Assign NAP immediately. Report to TSO/DSO for Redispatch registration.',
              idx++
            )
          );
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 6: Duplicate detection (pure sync)
    // Heuristic: match on PLZ + type + capacity ±10% + commissioning date ±90d
    // 4/4 criteria → MQ_PROBABLE_DUPLICATE
    // 3/4 criteria → MQ_POSSIBLE_DUPLICATE
    // lat/lon ±0.001° + type → MQ_GEO_DUPLICATE
    // -------------------------------------------------------------------------
    stepDuplicateDetection(installations) {
      const findings = [];
      let idx = 1;
      const reported = new Set();

      for (let i = 0; i < installations.length; i++) {
        const a = installations[i];
        const mastrA = a.EinheitMastrNummer || a.einheitMastrNummer || `idx-${i}`;

        for (let j = i + 1; j < installations.length; j++) {
          const b = installations[j];
          const mastrB = b.EinheitMastrNummer || b.einheitMastrNummer || `idx-${j}`;
          const pairKey = [mastrA, mastrB].sort().join('|');
          if (reported.has(pairKey)) continue;

          const typeA = this.deriveInstallationType(a);
          const typeB = this.deriveInstallationType(b);
          const plzA = a.Postleitzahl || a.postleitzahl;
          const plzB = b.Postleitzahl || b.postleitzahl;
          const capA = parseFloat(a.bruttoleistung || a.Bruttoleistung || a.NettoNennleistung || 0);
          const capB = parseFloat(b.bruttoleistung || b.Bruttoleistung || b.NettoNennleistung || 0);
          const ibA = a.inbetriebnahmeDatum || a.Inbetriebnahmedatum;
          const ibB = b.inbetriebnahmeDatum || b.Inbetriebnahmedatum;
          const latA = parseFloat(a.koordinatenBreitengrad || a.lat || 0);
          const latB = parseFloat(b.koordinatenBreitengrad || b.lat || 0);
          const lonA = parseFloat(a.koordinatenLaengengrad || a.lon || 0);
          const lonB = parseFloat(b.koordinatenLaengengrad || b.lon || 0);

          // Geo duplicate: same type + coordinates within 0.001°
          if (
            typeA === typeB &&
            latA !== 0 &&
            latB !== 0 &&
            Math.abs(latA - latB) <= 0.001 &&
            Math.abs(lonA - lonB) <= 0.001
          ) {
            findings.push(
              createFinding(
                6,
                'duplicateDetection',
                MQ_GEO_DUPLICATE,
                'warning',
                `Geo duplicate: ${mastrA} / ${mastrB} at same coordinates`,
                `Two ${typeA} installations at nearly identical coordinates (Δlat=${Math.abs(latA - latB).toFixed(4)}°, Δlon=${Math.abs(lonA - lonB).toFixed(4)}°).`,
                this.buildPairFindingContext(a, b, {
                  datapoint: ['koordinatenBreitengrad', 'koordinatenLaengengrad'],
                  value: { latA, lonA, latB, lonB },
                  expectedValue: 'Distinct coordinates per physical installation',
                  type: typeA,
                  brutto: { a: capA, b: capB },
                  latA,
                  lonA,
                  latB,
                  lonB,
                }),
                'Check if these are the same physical installation registered twice. Deregister the duplicate.',
                idx++
              )
            );
            reported.add(pairKey);
            continue;
          }

          // Criteria matching
          const samePLZ = plzA && plzB && plzA === plzB;
          const sameType = typeA === typeB;
          const sameCap =
            capA > 0 && capB > 0 && Math.abs(capA - capB) / Math.max(capA, capB) <= 0.1;
          let sameDate = false;
          if (ibA && ibB) {
            const dA = new Date(ibA);
            const dB = new Date(ibB);
            if (!isNaN(dA) && !isNaN(dB)) {
              sameDate = Math.abs(dA - dB) <= 90 * 24 * 60 * 60 * 1000;
            }
          }

          const score = [samePLZ, sameType, sameCap, sameDate].filter(Boolean).length;

          if (score === 4) {
            findings.push(
              createFinding(
                6,
                'duplicateDetection',
                MQ_PROBABLE_DUPLICATE,
                'error',
                `Probable duplicate: ${mastrA} / ${mastrB}`,
                `All 4 criteria match (PLZ, type, capacity ±10%, commissioning date ±90d). Very likely the same physical installation.`,
                this.buildPairFindingContext(a, b, {
                  datapoint: [
                    'Postleitzahl',
                    'energietraeger',
                    'bruttoleistung',
                    'inbetriebnahmeDatum',
                  ],
                  value: {
                    plz: { a: plzA, b: plzB },
                    type: { a: typeA, b: typeB },
                    cap: { a: capA, b: capB },
                    commissioningDate: { a: ibA, b: ibB },
                  },
                  expectedValue: 'At least one duplicate criterion should differ',
                  type: typeA,
                  brutto: { a: capA, b: capB },
                  plzA,
                  plzB,
                  typeA,
                  typeB,
                  capA,
                  ibA,
                  capB,
                  ibB,
                }),
                'Review both records. Deregister the duplicate in MaStR immediately.',
                idx++
              )
            );
            reported.add(pairKey);
          } else if (score === 3) {
            findings.push(
              createFinding(
                6,
                'duplicateDetection',
                MQ_POSSIBLE_DUPLICATE,
                'warning',
                `Possible duplicate: ${mastrA} / ${mastrB} (3/4 criteria match)`,
                `3 of 4 duplicate criteria match (PLZ: ${samePLZ}, type: ${sameType}, cap: ${sameCap}, date: ${sameDate}).`,
                this.buildPairFindingContext(a, b, {
                  datapoint: [
                    'Postleitzahl',
                    'energietraeger',
                    'bruttoleistung',
                    'inbetriebnahmeDatum',
                  ],
                  value: {
                    plz: { a: plzA, b: plzB },
                    type: { a: typeA, b: typeB },
                    cap: { a: capA, b: capB },
                    commissioningDate: { a: ibA, b: ibB },
                  },
                  expectedValue: 'No more than 2 of 4 duplicate criteria should match',
                  type: typeA,
                  brutto: { a: capA, b: capB },
                  plzA: plzA || plzB,
                  typeA,
                  capA,
                  ibA,
                  capB,
                  ibB,
                  matchedCriteria: { samePLZ, sameType, sameCap, sameDate },
                }),
                'Review both records. Deregister if confirmed duplicate.',
                idx++
              )
            );
            reported.add(pairKey);
          }
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 7: Geo spot check (async — broker calls to osm-geo.validate)
    // Selects up to geoSampleSize installations:
    //   priority 1: bruttoleistung ≥100 kW (Redispatch-relevant)
    //   priority 2: type diversity
    // -------------------------------------------------------------------------
    async stepGeoSpotCheck(ctx, installations, params, callOpts) {
      const findings = [];
      let idx = 1;
      const geoSampleSize = Math.min(params.geoSampleSize || 10, 50);
      const operator = params._resolvedOperator || {};

      if (installations.length === 0) return findings;

      // Filter to installations with coordinates
      const withCoords = installations.filter((i) => {
        const lat = parseFloat(i.koordinatenBreitengrad || i.lat || 0);
        const lon = parseFloat(i.koordinatenLaengengrad || i.lon || 0);
        return lat !== 0 && lon !== 0;
      });

      if (withCoords.length === 0) {
        findings.push(
          createFinding(
            7,
            'geoSpotCheck',
            MQ_GEO_CHECK_FAILED,
            'warning',
            'Geo spot check skipped: no installations with coordinates',
            'None of the portfolio installations have coordinate data in MaStR. Geo validation not possible.',
            { total: installations.length, withCoords: 0 },
            'Register coordinates for installations in MaStR portal.',
            idx++
          )
        );
        return findings;
      }

      // Priority 1: Redispatch-relevant (≥100 kW)
      const redispatch = withCoords.filter(
        (i) => parseFloat(i.bruttoleistung || i.Bruttoleistung || i.NettoNennleistung || 0) >= 100
      );
      // Build a diverse sample: alternate types
      const typeGroups = {};
      for (const inst of redispatch.length > 0 ? redispatch : withCoords) {
        const t = this.deriveInstallationType(inst);
        if (!typeGroups[t]) typeGroups[t] = [];
        typeGroups[t].push(inst);
      }

      const sample = [];
      const typeKeys = Object.keys(typeGroups);
      let ti = 0;
      while (sample.length < geoSampleSize) {
        let added = false;
        for (let k = 0; k < typeKeys.length && sample.length < geoSampleSize; k++) {
          const typeKey = typeKeys[(ti + k) % typeKeys.length];
          if (typeGroups[typeKey].length > 0) {
            sample.push(typeGroups[typeKey].shift());
            added = true;
          }
        }
        ti++;
        if (!added) break;
      }

      // Run osm-geo.validate for each sampled installation
      for (const inst of sample) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer;
        if (!mastr) continue;

        try {
          const geoResult = await ctx.call(
            'osm-geo.validate',
            { mastrNummer: mastr, gridOperatorId: operator.mastrId },
            callOpts
          );

          const verdict = geoResult?.data?.validation?.verdict || geoResult?.validation?.verdict;
          const confidence = geoResult?.data?.validation?.confidenceScore || 0;

          if (verdict === 'CONSISTENT') {
            findings.push(
              createFinding(
                7,
                'geoSpotCheck',
                MQ_GEO_PLAUSIBLE,
                'info',
                `${mastr}: geo assignment plausible (${verdict})`,
                `OSM geo validation confirmed installation is in the correct grid area. Confidence: ${(confidence * 100).toFixed(0)}%.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: 'geoValidation.verdict',
                  value: verdict,
                  expectedValue: 'CONSISTENT',
                  verdict,
                  confidenceScore: confidence,
                }),
                null,
                idx++
              )
            );
          } else if (['DEFINITIVE_MISASSIGNMENT', 'LIKELY_MISASSIGNMENT'].includes(verdict)) {
            findings.push(
              createFinding(
                7,
                'geoSpotCheck',
                MQ_GEO_MISASSIGNMENT,
                'error',
                `${mastr}: geo misassignment detected (${verdict})`,
                `OSM geo validation indicates installation may be assigned to wrong grid operator. Verdict: ${verdict}. Confidence: ${(confidence * 100).toFixed(0)}%.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: 'geoValidation.verdict',
                  value: verdict,
                  expectedValue: 'CONSISTENT',
                  verdict,
                  confidenceScore: confidence,
                }),
                'Investigate grid area assignment. Escalate to BNetzA if confirmed definitive misassignment.',
                idx++
              )
            );
          } else {
            // UNCERTAIN, INSUFFICIENT_DATA — informational
            findings.push(
              createFinding(
                7,
                'geoSpotCheck',
                MQ_GEO_PLAUSIBLE,
                'info',
                `${mastr}: geo check inconclusive (${verdict || 'no verdict'})`,
                `OSM geo validation returned an inconclusive result. Not enough data for a definitive assessment.`,
                this.buildInstallationFindingContext(inst, {
                  datapoint: 'geoValidation.verdict',
                  value: verdict || null,
                  expectedValue: 'CONSISTENT',
                  verdict,
                  confidenceScore: confidence,
                }),
                null,
                idx++
              )
            );
          }
        } catch (err) {
          findings.push(
            createFinding(
              7,
              'geoSpotCheck',
              MQ_GEO_CHECK_FAILED,
              'warning',
              `${mastr}: geo check failed — ${err.message}`,
              `osm-geo.validate call failed for installation ${mastr}. Geo data not available.`,
              this.buildInstallationFindingContext(inst, {
                datapoint: 'geoValidation.error',
                value: err.message,
                expectedValue: 'Successful geo validation response',
                error: err.message,
              }),
              'Check OSM geo service availability. Re-run audit when service is restored.',
              idx++
            )
          );
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 8: Audit trail (mirrors v0.14/v0.15 pattern)
    // -------------------------------------------------------------------------
    async stepAudit(ctx, params, reportData, callOpts) {
      const findings = [];
      let idx = 1;
      let snapshotValidation = null;
      const { datapointTags = [], maxAgeMinutes = 120, _resolvedOperator: operator = {} } = params;

      if (datapointTags.length > 0) {
        try {
          const snap = await ctx.call(
            'datapoint.createSnapshot',
            {
              tags: datapointTags.join(','),
              maxAgeMinutes,
              createdBy: 'agent',
              name: `mq-${(operator.mastrId || 'unknown').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`,
              description: `MaStR quality audit snapshot for ${operator.name || 'unknown'}`,
            },
            callOpts
          );

          if (snap?.id) {
            try {
              snapshotValidation = await ctx.call(
                'datapoint.validateSnapshot',
                { id: snap.id },
                callOpts
              );
              if (snapshotValidation?.drift?.length > 0) {
                findings.push(
                  createFinding(
                    8,
                    'audit',
                    SNAPSHOT_DRIFT_DETECTED,
                    'warning',
                    `Data drift detected in ${snapshotValidation.drift.length} datapoint(s)`,
                    'One or more datapoints changed during pipeline execution. Results may be inconsistent.',
                    { drift: snapshotValidation.drift, snapshotId: snap.id },
                    'Re-run audit after data refresh for a consistent result.',
                    idx++
                  )
                );
              }
            } catch (err) {
              this.logger.debug(`stepAudit: snapshot validation skipped — ${err.message}`);
            }
          }
        } catch (err) {
          this.logger.warn(`stepAudit: snapshot creation skipped — ${err.message}`);
        }
      }

      findings.push(
        createFinding(
          8,
          'audit',
          AUDIT_TRAIL_CREATED,
          'info',
          `Audit trail created — pipeline v${PIPELINE_VERSION}`,
          `Deterministic MaStR quality pipeline v${PIPELINE_VERSION} completed. ` +
            `No LLM involvement. Total findings: ${reportData.allFindingsCount + findings.length}. ` +
            `qualityScore: ${reportData.qualityScore}.`,
          {
            pipelineVersion: PIPELINE_VERSION,
            qualityScore: reportData.qualityScore,
            totalInstallations: reportData.totalInstallations,
            findingsTotal: reportData.allFindingsCount + findings.length,
            consistent: snapshotValidation?.consistent ?? null,
          },
          null,
          idx++
        )
      );

      return { findings, snapshotValidation };
    },

    // -------------------------------------------------------------------------
    // Derive installation type from raw MaStR record (shared helper)
    // -------------------------------------------------------------------------
    deriveInstallationType(inst) {
      const et = String(
        inst.Energietraeger || inst.energietraeger || inst.energieTraeger || ''
      ).toLowerCase();
      if (['solar', 'photovoltaik', 'pv'].some((t) => et.includes(t))) return 'solar';
      if (['wind', 'windkraft'].some((t) => et.includes(t))) return 'wind';
      if (['speicher', 'battery', 'batterie', 'storage'].some((t) => et.includes(t)))
        return 'storage';
      if (['biomasse', 'biogas', 'biomethan'].some((t) => et.includes(t))) return 'biomass';
      if (['verbrennung', 'gas', 'kohle', 'combustion'].some((t) => et.includes(t)))
        return 'combustion';
      if (inst.Modulanzahl || inst.GrossflächePv) return 'solar';
      if (inst.Nabenhoehe || inst.Rotordurchmesser) return 'wind';
      if (inst.Speicherkapazitaet) return 'storage';
      return 'other';
    },

    // -------------------------------------------------------------------------
    // Main pipeline orchestrator
    // -------------------------------------------------------------------------
    async runPipeline(ctx, params) {
      const startTime = Date.now();
      const { skipSteps = [] } = params;
      const skip = new Set(skipSteps);
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      const allFindings = [];
      const stepSummaries = [];

      // Helper: run one step, catch errors, record timing
      const runStep = async (stepNum, stepName, fn, options = {}) => {
        const { fatal = false } = options;
        if (skip.has(stepNum)) {
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
          this.logger.error(
            `MaStR quality pipeline step ${stepNum} (${stepName}) failed: ${err.message}`
          );
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'error',
            durationMs: Date.now() - t0,
            findingsCount: 0,
            error: err.message,
          });
          if (fatal) throw err;
          return null;
        }
      };

      // Step 1: VNB Identity (mandatory)
      let operator = {
        mastrId: params.gridOperatorId || null,
        name: params.gridOperatorName || 'Unknown',
        bdew: params.gridOperatorBdew || null,
        bnr: null,
      };
      let resolver = null;
      await runStep(1, 'identity', async () => {
        const res = await this.stepIdentity(ctx, params);
        operator = res.operator;
        resolver = res.resolver || null;
        return res.findings;
      });

      if (!operator.mastrId) {
        throw new MoleculerClientError(
          `VNB could not be resolved from provided identifiers. Unable to continue inventory step for operator "${operator.name || 'Unknown'}".`,
          422,
          'VNB_RESOLUTION_FAILED',
          {
            resolver,
            candidates: resolver?.candidates || [],
            normalized: resolver?.normalized || null,
          }
        );
      }

      // Inject resolved operator into params for downstream steps
      params._resolvedOperator = operator;

      // Step 2: Inventory (mandatory)
      let installations = [];
      await runStep(
        2,
        'inventory',
        async () => {
          const res = await this.stepInventory(ctx, operator);
          installations = res.installations;
          return res.findings;
        },
        { fatal: true }
      );

      const now = new Date();

      // Step 3: Status anomalies (skippable)
      if (!skip.has(3)) {
        await runStep(3, 'statusAnomalies', () => this.stepStatusAnomalies(installations, now));
      } else {
        stepSummaries.push({
          step: 3,
          name: 'statusAnomalies',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 4: Capacity anomalies (skippable)
      if (!skip.has(4)) {
        await runStep(4, 'capacityAnomalies', () => this.stepCapacityAnomalies(installations));
      } else {
        stepSummaries.push({
          step: 4,
          name: 'capacityAnomalies',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 5: Connection point integrity (skippable)
      if (!skip.has(5)) {
        await runStep(5, 'connectionPoints', () =>
          this.stepConnectionPointIntegrity(installations, operator.mastrId)
        );
      } else {
        stepSummaries.push({
          step: 5,
          name: 'connectionPoints',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 6: Duplicate detection (skippable)
      if (!skip.has(6)) {
        await runStep(6, 'duplicateDetection', () => this.stepDuplicateDetection(installations));
      } else {
        stepSummaries.push({
          step: 6,
          name: 'duplicateDetection',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 7: Geo spot check (skippable)
      if (!skip.has(7)) {
        await runStep(7, 'geoSpotCheck', () =>
          this.stepGeoSpotCheck(ctx, installations, params, callOpts)
        );
      } else {
        stepSummaries.push({
          step: 7,
          name: 'geoSpotCheck',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Compute quality dimensions and scores
      const qualityDimensions = {};
      for (const [dim, stepNums] of Object.entries(DIMENSION_STEPS)) {
        const stepSkipped = stepNums.every((s) => skip.has(s));
        if (stepSkipped) {
          qualityDimensions[dim] = {
            score: null,
            findings: 0,
            weight: QUALITY_DIMENSION_WEIGHTS[dim],
          };
        } else {
          const dimFindings = allFindings.filter((f) => stepNums.includes(f.step));
          qualityDimensions[dim] = {
            score: computeDimensionScore(allFindings, stepNums),
            findings: dimFindings.length,
            weight: QUALITY_DIMENSION_WEIGHTS[dim],
          };
        }
      }

      const qualityScore = computeQualityScore(qualityDimensions);
      const napSummary = this.summarizeNapFindings(allFindings);

      // Step 8: Audit trail (mandatory)
      let auditResult = null;
      await runStep(8, 'audit', async () => {
        auditResult = await this.stepAudit(
          ctx,
          params,
          {
            qualityScore,
            totalInstallations: installations.length,
            allFindingsCount: allFindings.length,
          },
          callOpts
        );
        return auditResult.findings;
      });

      const byType = {};
      for (const inst of installations) {
        const t = this.deriveInstallationType(inst);
        byType[t] = (byType[t] || 0) + 1;
      }

      return {
        gridOperator: operator,
        resolver,
        qualityScore,
        qualityDimensions,
        summary: {
          totalInstallations: installations.length,
          installationsByType: byType,
          findingsCount: summarizeFindings(allFindings),
          missingNapFindings: napSummary.missingNapFindings,
          missingNapDistinctAssets: napSummary.missingNapDistinctAssets,
          missingNapRedispatchFindings: napSummary.missingNapRedispatchFindings,
          missingNapRedispatchDistinctAssets: napSummary.missingNapRedispatchDistinctAssets,
          napFindings: {
            ...napSummary,
          },
          skippedSteps: skipSteps,
          durationMs: Date.now() - startTime,
        },
        findings: allFindings,
        steps: stepSummaries,
        metadata: {
          pipelineVersion: PIPELINE_VERSION,
          executedAt: new Date().toISOString(),
          maxAgeMinutes: params.maxAgeMinutes || 120,
          geoSampleSize: params.geoSampleSize || 10,
        },
      };
    },
  },
};
