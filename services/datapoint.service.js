'use strict';

/**
 * Datapoint Service (v0.11–v0.13)
 *
 * Promotes agent sessions to named, versioned, health-monitored data points.
 * Persistence is provided by PouchDB (embedded, zero-config, no external DB).
 * Only metadata is persisted — raw data always flows through RAM.
 *
 * v0.12: OEMetadata v2.0, OEO context, interval scheduling.
 * v0.13: Snapshot-Semantik (AP1), global concurrency limit (AP2),
 *        tag-based filtering (AP3).
 *
 * KRITIS note: PouchDB has no native C-bindings, no network port, and no
 * external process. It is functionally equivalent to the existing file-based
 * stores (data/sessions/, data/jobs/, .datasource-registry.json) but adds revision
 * semantics and index-based queries.
 */

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;

const EXAMPLE_DATAPOINT_NAME = 'pv-portfolio-twl-netze';

module.exports = {
  name: 'datapoint',

  settings: {
    dbPath: process.env.DATAPOINT_DB_PATH || './data/datapoints',
    defaultTimeout: 120000,
    maxConcurrentRefreshes: parseInt(process.env.DATAPOINT_MAX_CONCURRENT_REFRESHES || '3', 10),
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
    this.activeRefreshes = new Set();
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['sourceType', 'createdAt'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Datapoint DB initialized at ${this.settings.dbPath}`);
    if (process.env.DATAPOINT_SCHEDULER_ENABLED !== 'false') {
      this.schedulerInterval = setInterval(() => this.runScheduledRefreshes(), 60_000);
      this.logger.info('Datapoint scheduler started (60 s tick)');
    }
  },

  async stopped() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
    await this.db.close();
  },

  actions: {
    // ------------------------------------------------------------------
    // promote — elevate an agent session to a named, managed datapoint
    // ------------------------------------------------------------------
    promote: {
      rest: 'POST /promote',
      params: {
        sessionId: { type: 'string' },
        name: { type: 'string', pattern: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/ },
        description: { type: 'string', optional: true, default: '' },
        owner: { type: 'string', optional: true, default: '' },
        tags: { type: 'array', items: 'string', optional: true, default: [] },
        fixedParams: { type: 'object', optional: true, default: {} },
        refresh: {
          type: 'object',
          optional: true,
          default: { strategy: 'manual' },
        },
      },
      openapi: {
        summary: 'Promote an Agent Session to a named Datapoint',
        tags: ['Datapoints'],
        description:
          'Creates a managed, named datapoint from an existing agent session. ' +
          'The plan and parameters are extracted from the session and stored in PouchDB. ' +
          'Raw data is NOT stored.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId', 'name'],
                properties: {
                  sessionId: {
                    type: 'string',
                    example: '9209aa45-93f7-471c-8883-76326c4083f1',
                  },
                  name: {
                    type: 'string',
                    example: EXAMPLE_DATAPOINT_NAME,
                  },
                  description: { type: 'string', default: '' },
                  owner: { type: 'string', default: '' },
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                    default: [],
                  },
                  fixedParams: { type: 'object', default: {} },
                  refresh: {
                    type: 'object',
                    default: { strategy: 'manual' },
                    example: { strategy: 'manual' },
                  },
                },
              },
              examples: {
                promote: {
                  summary: 'Promote a PV forecast session',
                  value: {
                    sessionId: '9209aa45-93f7-471c-8883-76326c4083f1',
                    name: EXAMPLE_DATAPOINT_NAME,
                    description: 'PV generation forecast for TWL Netze',
                    tags: ['solar', 'forecast', 'twl'],
                    fixedParams: { query: 'TWL Netze', forecastDays: 3 },
                    refresh: { strategy: 'manual' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { sessionId, name, description, owner, tags, fixedParams, refresh } = ctx.params;

        // 1. Check for duplicate name
        try {
          await this.db.get(`dp:${name}`);
          throw new MoleculerClientError(
            `Datapoint '${name}' already exists`,
            409,
            'DUPLICATE_NAME'
          );
        } catch (e) {
          if (e.code === 'DUPLICATE_NAME') throw e;
          if (e.status !== 404) throw e;
          // 404 → name is available, continue
        }

        // 2. Load session via agent.loadSession action
        const session = await ctx.call('agent.loadSession', { id: sessionId });
        if (!session || !session.plan) {
          throw new MoleculerClientError(
            `Session '${sessionId}' not found or has no plan`,
            404,
            'SESSION_NOT_FOUND'
          );
        }

        // 3. Create PouchDB document
        const doc = {
          _id: `dp:${name}`,
          name,
          description,
          owner,
          tags,
          createdAt: new Date().toISOString(),
          sourceType: 'agent-session',
          sessionId,
          plan: {
            steps: session.plan.steps,
            requiredInputs: session.plan.requiredInputs || [],
          },
          fixedParams: { ...(session.userInputs || {}), ...fixedParams },
          refresh: refresh || { strategy: 'manual' },
          lastRun: {
            timestamp: null,
            durationMs: null,
            status: 'never',
            errorMessage: null,
            summary: null,
            schemaHash: null,
          },
          health: {
            totalRuns: 0,
            consecutiveSuccesses: 0,
            consecutiveFailures: 0,
            lastFailure: null,
            avgDurationMs: 0,
            schemaStable: true,
          },
          // Issue #32: Explainability-log for automated agent corrections
          agent_interventions: [],
          // Issue #30: EU AI Act Art. 12 — data provenance hash
          provenanceHash: null,
        };

        const result = await this.db.put(doc);
        return { success: true, name, _rev: result.rev };
      },
    },

    // ------------------------------------------------------------------
    // list — return all datapoints with optional health info
    // ------------------------------------------------------------------
    list: {
      rest: 'GET /',
      params: {
        sourceType: { type: 'string', optional: true },
        includeHealth: { type: 'boolean', optional: true, convert: true, default: true },
        tags: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List all registered Datapoints',
        tags: ['Datapoints'],
        parameters: [
          {
            name: 'sourceType',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'agent-session' },
          },
          {
            name: 'includeHealth',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: true },
          },
          {
            name: 'tags',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'solar,twl-netze' },
            description:
              'Comma-separated tag filter. Returns only datapoints that have ALL specified tags (case-insensitive AND match).',
          },
        ],
      },
      async handler(ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'dp:',
          endkey: 'dp:\ufff0',
        });
        let docs = result.rows.map((r) => r.doc);

        if (ctx.params.sourceType) {
          docs = docs.filter((d) => d.sourceType === ctx.params.sourceType);
        }

        if (ctx.params.tags) {
          const requiredTags = ctx.params.tags.split(',').map((t) => t.trim().toLowerCase());
          docs = docs.filter((d) =>
            requiredTags.every((tag) => (d.tags || []).map((t) => t.toLowerCase()).includes(tag))
          );
        }

        return {
          count: docs.length,
          datapoints: docs.map((d) => ({
            name: d.name,
            description: d.description,
            sourceType: d.sourceType,
            tags: d.tags,
            createdAt: d.createdAt,
            lastRun: ctx.params.includeHealth ? d.lastRun : undefined,
            health: ctx.params.includeHealth ? d.health : undefined,
          })),
        };
      },
    },

    // ------------------------------------------------------------------
    // oeoContext — JSON-LD @context mapping datapoint fields to OEO IRIs
    // @OpenEnergyPlatform/ontology
    // ------------------------------------------------------------------
    oeoContext: {
      rest: 'GET /oeo-context',
      params: {
        name: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'JSON-LD @context mapping datapoint fields to OEO class IRIs',
        tags: ['Datapoints'],
        // @OpenEnergyPlatform/ontology — linked-data context
        'x-oeo-class': ['https://openenergyplatform.org/ontology/oeo/'],
        description:
          'Returns a JSON-LD @context document that maps datapoint field names ' +
          'to Open Energy Ontology (OEO) class IRIs. Optionally scoped to a ' +
          'specific datapoint (by name) for field-level mappings.',
        parameters: [
          {
            name: 'name',
            in: 'query',
            schema: { type: 'string', example: 'my-datapoint' },
            description: 'Optional datapoint name for field-level OEO mappings',
          },
        ],
      },
      async handler(ctx) {
        const {
          OEO_VERSION,
          OEO_BASE_IRI,
          DOMAIN_OEO_MAPPINGS,
          forDomainResolved,
        } = require('../src/oeo-mappings');

        const base = {
          '@context': {
            oeo: OEO_BASE_IRI,
            schema: 'https://schema.org/',
          },
          oeoVersion: OEO_VERSION,
          generatedAt: new Date().toISOString(),
        };

        // If a name is given, enrich with datapoint-specific domain mapping
        if (ctx.params.name) {
          try {
            const doc = await this.db.get(`dp:${ctx.params.name}`);
            const domainId = doc.sourceType || doc.tags?.[0];
            if (domainId && DOMAIN_OEO_MAPPINGS[domainId]) {
              base['@context']['@type'] = forDomainResolved(domainId).map((c) => c.iri);
              base.domainId = domainId;
            }
            // Add field-level mappings if the datapoint has fieldProfiles
            if (doc.fieldProfiles) {
              const fieldCtx = this.buildOeoContext(doc.fieldProfiles, domainId);
              Object.assign(base['@context'], fieldCtx);
            }
          } catch (err) {
            if (err.status === 404) {
              throw new MoleculerClientError(`Datapoint '${ctx.params.name}' not found`, 404);
            }
            throw err;
          }
        }

        // Append global domain catalogue
        base.domainCatalogue = Object.entries(DOMAIN_OEO_MAPPINGS).map(
          ([id, iris]) => ({ domainId: id, oeoClasses: iris })
        );

        return base;
      },
    },

    // ------------------------------------------------------------------
    // oemetadata — EU AI Act Art. 12 provenance metadata (Issue #30)
    // Returns a schema.json-style document with cryptographic provenance
    // hash, source audit trail, OEO context, and intervention log.
    // @see https://github.com/energychain/cernion-energy-tools/issues/30
    // ------------------------------------------------------------------
    oemetadata: {
      rest: 'GET /:name/oemetadata',
      params: {
        name: { type: 'string' },
        validate: { type: 'boolean', optional: true, convert: true, default: false },
      },
      openapi: {
        summary: 'OEMetadata v2.0 — FAIR Data metadata for a Datapoint (EU AI Act Art. 12)',
        tags: ['Datapoints'],
        description:
          'Returns a fully OEMetadata v2.0 conformant metadata document. Includes a ' +
          'SHA-256 cryptographic provenance hash (EU AI Act Art. 12), OEO semantic ' +
          'class mappings, spatial/temporal coverage, source licensing, and a ' +
          'Cernion-specific extension for agent interventions and scheduling state. ' +
          'Set ?validate=true to include a JSON-Schema validation report against the ' +
          'OEMetadata v2.0 schema (requires prior `npm run sync:oemetadata`).',
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string', example: EXAMPLE_DATAPOINT_NAME },
          },
          {
            name: 'validate',
            in: 'query',
            required: false,
            schema: { type: 'boolean', default: false },
            description:
              'Run ajv JSON-Schema validation against the OEMetadata v2.0 schema ' +
              'and append a `_validation` report to the response.',
          },
        ],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }

        const { buildOEMetadata, validateAgainstSchema } = require('../src/oemetadata-builder');
        const metadata = buildOEMetadata(doc);

        if (ctx.params.validate) {
          const validation = await validateAgainstSchema(metadata);
          return { ...metadata, _validation: validation };
        }

        return metadata;
      },
    },

    // ------------------------------------------------------------------
    // interventions — dedicated endpoint for the agent_interventions log
    // Closes Issue #32: explainability-log queryable via dedicated endpoint
    // ------------------------------------------------------------------
    interventions: {
      rest: 'GET /:name/interventions',
      params: {
        name: { type: 'string' },
        limit: { type: 'number', optional: true, convert: true, default: 50, min: 1, max: 500 },
        since: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Agent intervention log for a Datapoint (Issue #32)',
        tags: ['Datapoints'],
        'x-oeo-class': ['http://openenergy-platform.org/ontology/oeo/OEO_00000143'],
        description:
          'Returns the `agent_interventions` array for a Datapoint — a structured log ' +
          'of every automated correction the agent made during plan execution. ' +
          'Each entry contains `timestamp`, `action`, `reason`, `confidence_score`, ' +
          'and `agent_id`. Use `?since=<ISO-8601>` to retrieve only recent entries. ' +
          'Use `?limit=N` to cap the number of returned entries (default: 50, max: 500). ' +
          'Satisfies the Explainable AI (XAI) auditability requirement of Issue #32.',
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string', example: EXAMPLE_DATAPOINT_NAME },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 50, minimum: 1, maximum: 500, example: 50 },
            description: 'Maximum number of intervention entries to return (newest first).',
          },
          {
            name: 'since',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date-time', example: '2026-03-01T00:00:00Z' },
            description:
              'ISO-8601 timestamp. Only interventions at or after this timestamp are returned.',
          },
        ],
        responses: {
          200: {
            description: 'Agent intervention log',
            content: {
              'application/json': {
                example: {
                  name: EXAMPLE_DATAPOINT_NAME,
                  total: 2,
                  interventions: [
                    {
                      timestamp: '2026-03-29T12:00:00.000Z',
                      action: 'param_repair',
                      reason: 'Corrected gridOperatorId alias from bnr to bdewCode',
                      confidence_score: 0.95,
                      agent_id: 'executePlan',
                    },
                  ],
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }

        let entries = Array.isArray(doc.agent_interventions) ? doc.agent_interventions : [];

        if (ctx.params.since) {
          const sinceTs = new Date(ctx.params.since).getTime();
          if (!isNaN(sinceTs)) {
            entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceTs);
          }
        }

        // Return newest first, capped at limit
        const sorted = entries.slice().reverse().slice(0, ctx.params.limit);

        return {
          name: ctx.params.name,
          total: entries.length,
          interventions: sorted,
        };
      },
    },

    // ------------------------------------------------------------------
    // health — aggregated health overview of all datapoints
    // ------------------------------------------------------------------
    health: {
      rest: 'GET /health/overview',
      openapi: {
        summary: 'Health overview of all Datapoints',
        tags: ['Datapoints'],
      },
      async handler(_ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'dp:',
          endkey: 'dp:\ufff0',
        });
        const docs = result.rows.map((r) => r.doc);
        const now = Date.now();

        const summary = { total: docs.length, healthy: 0, stale: 0, errored: 0, neverRun: 0 };

        const datapoints = docs.map((d) => {
          let status;
          if (d.lastRun.status === 'never') {
            status = 'never_run';
            summary.neverRun++;
          } else if (d.lastRun.status === 'error') {
            status = 'errored';
            summary.errored++;
          } else if (
            d.refresh.strategy === 'interval' &&
            d.refresh.intervalMinutes
          ) {
            const ageMs = now - new Date(d.lastRun.timestamp).getTime();
            const staleThresholdMs = d.refresh.intervalMinutes * 60 * 1000 * 2;
            if (ageMs > staleThresholdMs) {
              status = 'stale';
              summary.stale++;
            } else {
              status = 'healthy';
              summary.healthy++;
            }
          } else {
            status = 'healthy';
            summary.healthy++;
          }

          return {
            name: d.name,
            status,
            sourceType: d.sourceType,
            lastRun: d.lastRun.timestamp,
            ageMinutes: d.lastRun.timestamp
              ? Math.round((now - new Date(d.lastRun.timestamp).getTime()) / 60000)
              : null,
            rowCount: d.lastRun.summary?.rowCount || null,
            schemaStable: d.health.schemaStable,
            consecutiveFailures: d.health.consecutiveFailures,
          };
        });

        return { ...summary, datapoints };
      },
    },

    // ------------------------------------------------------------------
    // get — retrieve a single datapoint by name
    // ------------------------------------------------------------------
    get: {
      rest: 'GET /:name',
      params: {
        name: { type: 'string' },
      },
      openapi: {
        summary: 'Get Datapoint details by name',
        tags: ['Datapoints'],
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string', example: EXAMPLE_DATAPOINT_NAME },
          },
        ],
      },
      async handler(ctx) {
        try {
          return await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }
      },
    },

    // ------------------------------------------------------------------
    // update — modify definition metadata (description, owner, tags, etc.)
    // ------------------------------------------------------------------
    update: {
      rest: 'PUT /:name',
      params: {
        name: { type: 'string' },
        description: { type: 'string', optional: true },
        owner: { type: 'string', optional: true },
        tags: { type: 'array', items: 'string', optional: true },
        fixedParams: { type: 'object', optional: true },
        refresh: { type: 'object', optional: true },
      },
      openapi: {
        summary: 'Update Datapoint definition',
        tags: ['Datapoints'],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }

        if (ctx.params.description !== undefined) doc.description = ctx.params.description;
        if (ctx.params.owner !== undefined) doc.owner = ctx.params.owner;
        if (ctx.params.tags !== undefined) doc.tags = ctx.params.tags;
        if (ctx.params.fixedParams !== undefined) doc.fixedParams = ctx.params.fixedParams;
        if (ctx.params.refresh !== undefined) doc.refresh = ctx.params.refresh;

        const result = await this.db.put(doc);
        return { success: true, name: doc.name, _rev: result.rev };
      },
    },

    // ------------------------------------------------------------------
    // remove — delete a datapoint
    // ------------------------------------------------------------------
    remove: {
      rest: 'DELETE /:name',
      params: { name: { type: 'string' } },
      openapi: {
        summary: 'Delete a Datapoint',
        tags: ['Datapoints'],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }
        await this.db.remove(doc);
        return { success: true, name: ctx.params.name, deleted: true };
      },
    },

    // ------------------------------------------------------------------
    // refresh — re-execute stored plan, update metadata (not raw data)
    // ------------------------------------------------------------------
    refresh: {
      rest: 'POST /:name/refresh',
      params: { name: { type: 'string' } },
      openapi: {
        summary: 'Refresh a Datapoint (re-execute plan, update health)',
        tags: ['Datapoints'],
        description:
          'Re-executes the stored plan with fixedParams via agent.executePlan. ' +
          'Only metadata (lastRun, health) is persisted — raw data flows through RAM.',
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string', example: EXAMPLE_DATAPOINT_NAME },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [],
                properties: {},
              },
              examples: {
                refresh: {
                  summary: 'Trigger a refresh (no body required)',
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }

        const startTime = Date.now();

        try {
          const result = await ctx.call(
            'agent.executePlan',
            { plan: doc.plan, userInputs: doc.fixedParams },
            {
              timeout: doc.refresh?.timeoutMs || this.settings.defaultTimeout,
              meta: ctx.meta,
            }
          );

          const durationMs = Date.now() - startTime;
          const summary = this.buildSummary(result.stepResults);
          const schemaHash = this.hashSchema(result.stepResults);
          const oldSchemaHash = doc.lastRun.schemaHash;

          // Issue #30: Compute SHA-256 provenance hash of raw step results
          const provenanceHash = this.computeProvenanceHash(result.stepResults);

          doc.lastRun = {
            timestamp: new Date().toISOString(),
            durationMs,
            status: result.success ? 'success' : 'partial',
            errorMessage: null,
            summary,
            schemaHash,
          };
          doc.provenanceHash = provenanceHash;
          doc.health = this.updateHealth(doc.health, 'success', durationMs, oldSchemaHash, schemaHash);

          // Issue #32: Record agent interventions from executePlan if any
          if (Array.isArray(result.interventions) && result.interventions.length > 0) {
            doc.agent_interventions = [
              ...(doc.agent_interventions || []),
              ...result.interventions,
            ];
          }

          await this.db.put(doc);
          return { success: true, name: doc.name, lastRun: doc.lastRun };
        } catch (error) {
          const durationMs = Date.now() - startTime;
          doc.lastRun = {
            timestamp: new Date().toISOString(),
            durationMs,
            status: 'error',
            errorMessage: error.message,
            summary: null,
            schemaHash: null,
          };
          doc.health = this.updateHealth(doc.health, 'error', durationMs);

          await this.db.put(doc);
          return { success: false, name: doc.name, error: error.message, lastRun: doc.lastRun };
        }
      },
    },

    // ------------------------------------------------------------------
    // data — live data pass-through as JSON or CSV
    // ------------------------------------------------------------------
    data: {
      rest: 'GET /:name/data',
      params: {
        name: { type: 'string' },
        format: { type: 'enum', values: ['json', 'csv'], optional: true, default: 'json' },
        $$strict: false, // allow arbitrary overrides as query params
      },
      openapi: {
        summary: 'Get live data from a Datapoint (re-executes plan)',
        tags: ['Datapoints'],
        description:
          'Re-executes the stored plan with fixedParams (and optional query-param overrides). ' +
          'Pass format=csv to receive the last step result as a CSV download.',
        parameters: [
          {
            name: 'name',
            in: 'path',
            required: true,
            schema: { type: 'string', example: EXAMPLE_DATAPOINT_NAME },
          },
          {
            name: 'format',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
          },
        ],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(`dp:${ctx.params.name}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Datapoint '${ctx.params.name}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }

        // Merge fixedParams with query-param overrides (exclude routing params)
        const overrides = {};
        for (const [k, v] of Object.entries(ctx.params)) {
          if (!['name', 'format'].includes(k) && v !== undefined && v !== '') {
            overrides[k] = v;
          }
        }
        const effectiveParams = { ...doc.fixedParams, ...overrides };

        // Deep-clone plan so we can safely mutate the last step for CSV
        const plan = JSON.parse(JSON.stringify(doc.plan));
        if (ctx.params.format === 'csv' && plan.steps.length > 0) {
          plan.steps[plan.steps.length - 1].params.format = 'csv';
        }

        const result = await ctx.call(
          'agent.executePlan',
          { plan, userInputs: effectiveParams },
          { timeout: this.settings.defaultTimeout, meta: ctx.meta }
        );

        if (ctx.params.format === 'csv') {
          const lastStep = result.stepResults[result.stepResults.length - 1];
          if (typeof lastStep?.result === 'string') {
            ctx.meta.$responseType = 'text/csv';
            ctx.meta.$responseHeaders = {
              'Content-Disposition': `attachment; filename="${doc.name}.csv"`,
            };
            return lastStep.result;
          }
        }

        return {
          datapoint: doc.name,
          executedAt: result.executedAt,
          stepResults: result.stepResults,
        };
      },
    },

    // ------------------------------------------------------------------
    // createSnapshot — seal a consistent set of datapoints (AP1 v0.13)
    // Phases: (1) freshness-check, (2) sequential refresh, (3) seal
    // @see docs/change-requests/snapshot-semantik.md
    // ------------------------------------------------------------------
    createSnapshot: {
      rest: 'POST /snapshot',
      params: {
        datapointNames: { type: 'array', items: 'string', optional: true, default: [] },
        tags: { type: 'string', optional: true },
        maxAgeMinutes: { type: 'number', optional: true, default: 60, convert: true },
        name: { type: 'string', optional: true },
        description: { type: 'string', optional: true, default: '' },
        createdBy: {
          type: 'enum',
          values: ['manual', 'agent', 'scheduler'],
          optional: true,
          default: 'manual',
        },
      },
      openapi: {
        summary: 'Create a Snapshot — seal a consistent set of Datapoints',
        tags: ['Datapoints'],
        description:
          'Refreshes all specified datapoints (sequentially) if their cached data is older ' +
          'than `maxAgeMinutes`, then seals the consistent state as a snapshot document in ' +
          'PouchDB. The snapshot records each datapoint`s `provenanceHash` and a combined ' +
          '`snapshotHash` (SHA-256 over sorted individual hashes). ' +
          'Accepts either `datapointNames` (array) or `tags` (comma-separated string). ' +
          'Raw data is NOT stored (KRITIS constraint).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  datapointNames: {
                    type: 'array',
                    items: { type: 'string' },
                    example: [EXAMPLE_DATAPOINT_NAME, 'redispatch-anlagen-twl-netze'],
                  },
                  tags: {
                    type: 'string',
                    example: 'twl-netze,redispatch-pipeline',
                    description:
                      'Comma-separated tag filter. Mutually exclusive with datapointNames.',
                  },
                  maxAgeMinutes: {
                    type: 'number',
                    default: 60,
                    description: 'Maximum age of a datapoint before a refresh is triggered.',
                  },
                  name: { type: 'string', example: 'twl-validierung-q1-2026' },
                  description: { type: 'string', default: '' },
                  createdBy: {
                    type: 'string',
                    enum: ['manual', 'agent', 'scheduler'],
                    default: 'manual',
                  },
                },
              },
              examples: {
                byNames: {
                  summary: 'Snapshot by datapoint names',
                  value: {
                    datapointNames: [EXAMPLE_DATAPOINT_NAME, 'ewk-benchmark-twl'],
                    maxAgeMinutes: 60,
                    name: 'twl-validierung-q1-2026',
                    description: 'Consistency check TWL Netze Q1 2026',
                  },
                },
                byTags: {
                  summary: 'Snapshot by tag filter',
                  value: { tags: 'twl-netze,redispatch-pipeline', maxAgeMinutes: 30 },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { maxAgeMinutes = 60, name, description = '', createdBy = 'manual' } = ctx.params;

        // Resolve datapointNames: explicit list takes precedence, otherwise tag-based lookup
        let datapointNames = ctx.params.datapointNames || [];
        if (datapointNames.length === 0) {
          if (!ctx.params.tags) {
            throw new MoleculerClientError(
              'Either datapointNames or tags must be provided',
              400,
              'MISSING_PARAMS'
            );
          }
          const listed = await ctx.call('datapoint.list', {
            tags: ctx.params.tags,
            includeHealth: false,
          });
          datapointNames = listed.datapoints.map((d) => d.name);
          if (datapointNames.length === 0) {
            throw new MoleculerClientError(
              `No datapoints found for tags '${ctx.params.tags}'`,
              404,
              'NO_DATAPOINTS'
            );
          }
        }

        const snapshotId = crypto.randomUUID();
        const now = Date.now();
        const results = [];

        // Phase 1 + 2: Freshness-Check + sequential refresh (no parallel → MCP session limits)
        for (const dpName of datapointNames) {
          let dp;
          try {
            dp = await this.db.get(`dp:${dpName}`);
          } catch (e) {
            if (e.status === 404) {
              results.push({
                name: dpName,
                status: 'error',
                provenanceHash: null,
                schemaHash: null,
                timestamp: null,
                durationMs: null,
                summary: null,
                errorMessage: `Datapoint '${dpName}' not found`,
              });
              continue;
            }
            throw e;
          }

          const ageMinutes =
            dp.lastRun?.timestamp
              ? (now - new Date(dp.lastRun.timestamp).getTime()) / 60000
              : Infinity;

          if (ageMinutes <= maxAgeMinutes && dp.lastRun?.status === 'success') {
            // Fresh enough — skip refresh
            results.push({
              name: dpName,
              status: 'fresh',
              provenanceHash: dp.provenanceHash,
              schemaHash: dp.lastRun.schemaHash,
              timestamp: dp.lastRun.timestamp,
              durationMs: dp.lastRun.durationMs,
              summary: dp.lastRun.summary,
              errorMessage: null,
            });
          } else {
            // Needs refresh — sequential to respect MCP session limits
            try {
              await ctx.call('datapoint.refresh', { name: dpName });
              const updated = await this.db.get(`dp:${dpName}`);
              if (updated.lastRun?.status === 'error') {
                results.push({
                  name: dpName,
                  status: 'error',
                  provenanceHash: null,
                  schemaHash: null,
                  timestamp: updated.lastRun.timestamp,
                  durationMs: updated.lastRun.durationMs,
                  summary: null,
                  errorMessage: updated.lastRun.errorMessage,
                });
              } else {
                results.push({
                  name: dpName,
                  status: 'refreshed',
                  provenanceHash: updated.provenanceHash,
                  schemaHash: updated.lastRun.schemaHash,
                  timestamp: updated.lastRun.timestamp,
                  durationMs: updated.lastRun.durationMs,
                  summary: updated.lastRun.summary,
                  errorMessage: null,
                });
              }
            } catch (err) {
              results.push({
                name: dpName,
                status: 'error',
                provenanceHash: null,
                schemaHash: null,
                timestamp: null,
                durationMs: null,
                summary: null,
                errorMessage: err.message,
              });
            }
          }
        }

        // Phase 3: Seal — compute snapshotHash and final status
        const hasErrors = results.some((r) => r.status === 'error');
        const hasSuccesses = results.some((r) => r.status !== 'error');
        let snapshotStatus;
        if (!hasErrors) snapshotStatus = 'complete';
        else if (hasSuccesses) snapshotStatus = 'partial';
        else snapshotStatus = 'failed';

        let snapshotHash = null;
        if (snapshotStatus === 'complete') {
          const hashes = results
            .map((r) => r.provenanceHash)
            .filter(Boolean)
            .sort();
          if (hashes.length === datapointNames.length) {
            snapshotHash = crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
          }
        }

        const doc = {
          _id: `snap:${snapshotId}`,
          id: snapshotId,
          name: name || null,
          description,
          createdAt: new Date().toISOString(),
          createdBy,
          maxAgeMinutes,
          datapointNames,
          status: snapshotStatus,
          datapoints: results,
          snapshotHash,
          lastValidation: { timestamp: null, consistent: null, drift: null },
        };

        await this.db.put(doc);
        return doc;
      },
    },

    // ------------------------------------------------------------------
    // listSnapshots — list all snapshot documents
    // ------------------------------------------------------------------
    listSnapshots: {
      rest: 'GET /snapshots',
      params: {
        status: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List all Snapshots',
        tags: ['Datapoints'],
        description:
          'Returns all snapshot documents stored in PouchDB, optionally filtered by status. ' +
          'Snapshots are listed in PouchDB key order (by creation UUID).',
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['complete', 'partial', 'failed'], example: 'complete' },
            description: 'Filter snapshots by status.',
          },
        ],
      },
      async handler(ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'snap:',
          endkey: 'snap:\ufff0',
        });
        let docs = result.rows.map((r) => r.doc);
        if (ctx.params.status) {
          docs = docs.filter((d) => d.status === ctx.params.status);
        }
        return {
          count: docs.length,
          snapshots: docs.map((d) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            createdAt: d.createdAt,
            createdBy: d.createdBy,
            status: d.status,
            datapointCount: d.datapointNames?.length || 0,
            snapshotHash: d.snapshotHash,
            lastValidation: d.lastValidation,
          })),
        };
      },
    },

    // ------------------------------------------------------------------
    // getSnapshot — retrieve a single snapshot by id
    // ------------------------------------------------------------------
    getSnapshot: {
      rest: 'GET /snapshot/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get Snapshot details by ID',
        tags: ['Datapoints'],
        description:
          'Returns the full snapshot document including per-datapoint provenance hashes, ' +
          'refresh status, and the last validation result.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '3f1a2b4c-8e9d-4c7a-b1f2-0a3e5d6c7b8a' },
          },
        ],
      },
      async handler(ctx) {
        try {
          return await this.db.get(`snap:${ctx.params.id}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Snapshot '${ctx.params.id}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }
      },
    },

    // ------------------------------------------------------------------
    // validateSnapshot — check current provenanceHashes against snapshot
    // ------------------------------------------------------------------
    validateSnapshot: {
      rest: 'POST /snapshot/:id/validate',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Validate a Snapshot — check provenance hash consistency',
        tags: ['Datapoints'],
        description:
          'Compares each datapoint`s current `provenanceHash` against the hash recorded ' +
          'at snapshot creation. Returns `consistent: true` if all hashes match, or ' +
          '`consistent: false` with a `drift` array listing changed datapoints. ' +
          'The validation result is persisted back to the snapshot document.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '3f1a2b4c-8e9d-4c7a-b1f2-0a3e5d6c7b8a' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object' },
              examples: {
                validate: {
                  summary: 'Trigger validation (no body required)',
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        let snap;
        try {
          snap = await this.db.get(`snap:${ctx.params.id}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Snapshot '${ctx.params.id}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }

        const drift = [];
        for (const dp of snap.datapoints) {
          if (!dp.provenanceHash) continue; // skip error entries
          try {
            const current = await this.db.get(`dp:${dp.name}`);
            if (current.provenanceHash !== dp.provenanceHash) {
              drift.push({
                name: dp.name,
                snapshotHash: dp.provenanceHash,
                currentHash: current.provenanceHash,
              });
            }
          } catch (e) {
            drift.push({
              name: dp.name,
              snapshotHash: dp.provenanceHash,
              currentHash: null,
            });
          }
        }

        snap.lastValidation = {
          timestamp: new Date().toISOString(),
          consistent: drift.length === 0,
          drift: drift.length > 0 ? drift : null,
        };

        await this.db.put(snap);
        return snap.lastValidation;
      },
    },

    // ------------------------------------------------------------------
    // removeSnapshot — delete a snapshot document
    // ------------------------------------------------------------------
    removeSnapshot: {
      rest: 'DELETE /snapshot/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Delete a Snapshot',
        tags: ['Datapoints'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '3f1a2b4c-8e9d-4c7a-b1f2-0a3e5d6c7b8a' },
          },
        ],
      },
      async handler(ctx) {
        let snap;
        try {
          snap = await this.db.get(`snap:${ctx.params.id}`);
        } catch (e) {
          if (e.status === 404) {
            throw new MoleculerClientError(
              `Snapshot '${ctx.params.id}' not found`,
              404,
              'NOT_FOUND'
            );
          }
          throw e;
        }
        await this.db.remove(snap);
        return { success: true, id: ctx.params.id, deleted: true };
      },
    },
  },

  methods: {
    /**
     * Build a compact summary from stepResults.
     * Only the last step's result is summarised — that is the primary data output.
     */
    buildSummary(stepResults) {
      if (!stepResults || stepResults.length === 0) return null;
      const lastStep = stepResults[stepResults.length - 1];
      const data = lastStep?.result;

      if (Array.isArray(data)) {
        return {
          rowCount: data.length,
          columns: data.length > 0 ? Object.keys(data[0]) : [],
          sampleValues:
            data.length > 0
              ? { firstRow: Object.fromEntries(Object.entries(data[0]).slice(0, 5)) }
              : null,
        };
      }

      if (data?.data && Array.isArray(data.data)) {
        return {
          rowCount: data.data.length,
          columns: data.data.length > 0 ? Object.keys(data.data[0]) : [],
        };
      }

      if (data?.forecasts && Array.isArray(data.forecasts)) {
        return {
          rowCount: data.forecasts.length,
          columns: data.forecasts.length > 0 ? Object.keys(data.forecasts[0]) : [],
          totalCapacityMW: data.summary?.totalCapacityMW || null,
          installationCount: data.summary?.installationCount || null,
        };
      }

      // Fallback: describe the top-level shape
      return { type: 'object', keys: data ? Object.keys(data) : [] };
    },

    /**
     * SHA-256 hash of sorted column names from the last step result.
     * Used to detect schema changes between successive refreshes.
     */
    hashSchema(stepResults) {
      if (!stepResults || stepResults.length === 0) return null;
      const lastStep = stepResults[stepResults.length - 1];
      const data = lastStep?.result;

      let columns = [];
      if (Array.isArray(data) && data.length > 0) {
        columns = Object.keys(data[0]).sort();
      } else if (data?.data?.[0]) {
        columns = Object.keys(data.data[0]).sort();
      } else if (data?.forecasts?.[0]) {
        columns = Object.keys(data.forecasts[0]).sort();
      }

      return crypto
        .createHash('sha256')
        .update(JSON.stringify(columns))
        .digest('hex')
        .slice(0, 16);
    },

    /**
     * Compute a SHA-256 hash of the full raw step-results payload.
     * Used for EU AI Act Art. 12 data provenance (Issue #30).
     * The hash proves the exact data the agent processed at refresh time.
     */
    computeProvenanceHash(stepResults) {
      if (!stepResults || stepResults.length === 0) return null;
      try {
        const canonical = JSON.stringify(
          stepResults.map((sr) => ({
            step: sr.step,
            action: sr.action,
            result: sr.result,
            error: sr.error,
          }))
        );
        return crypto.createHash('sha256').update(canonical).digest('hex');
      } catch {
        return null;
      }
    },

    /**
     * Update rolling health counters after a refresh run.
     */
    updateHealth(health, status, durationMs, oldSchemaHash, newSchemaHash) {
      const h = { ...health };
      h.totalRuns++;

      if (status === 'success') {
        h.consecutiveSuccesses++;
        h.consecutiveFailures = 0;
      } else {
        h.consecutiveSuccesses = 0;
        h.consecutiveFailures++;
        h.lastFailure = new Date().toISOString();
      }

      // Exponential moving average (80/20 weighting)
      if (h.totalRuns === 1) {
        h.avgDurationMs = durationMs;
      } else {
        h.avgDurationMs = Math.round(h.avgDurationMs * 0.8 + durationMs * 0.2);
      }

      // Schema stability check
      if (oldSchemaHash && newSchemaHash && oldSchemaHash !== newSchemaHash) {
        h.schemaStable = false;
      }

      return h;
    },

    /**
     * Scan all datapoints with strategy:'interval' and trigger a refresh for
     * any that are overdue.  The activeRefreshes Set acts as a concurrency
     * guard — a datapoint that is already refreshing is skipped without error
     * and retried on the next 60-second tick.
     */
    async runScheduledRefreshes() {
      let docs;
      try {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'dp:',
          endkey: 'dp:\ufff0',
        });
        docs = result.rows.map((r) => r.doc);
      } catch (err) {
        this.logger.warn('Scheduler: failed to list datapoints', err.message);
        return;
      }

      const now = Date.now();

      for (const doc of docs) {
        if (doc.refresh?.strategy !== 'interval') continue;
        if (!doc.refresh.intervalMinutes || doc.refresh.intervalMinutes <= 0) continue;
        if (this.activeRefreshes.has(doc.name)) continue;

        if (this.activeRefreshes.size >= this.settings.maxConcurrentRefreshes) {
          this.logger.debug(`Concurrency limit reached (${this.settings.maxConcurrentRefreshes}), deferring remaining refreshes`);
          break;
        }

        const lastRunAt = doc.lastRun?.timestamp
          ? new Date(doc.lastRun.timestamp).getTime()
          : 0;
        const dueAt = lastRunAt + doc.refresh.intervalMinutes * 60 * 1000;

        if (now < dueAt) continue;

        this.activeRefreshes.add(doc.name);
        this.logger.info(`Scheduler: refreshing '${doc.name}' (overdue by ${Math.round((now - dueAt) / 60000)} min)`);

        this.broker
          .call('datapoint.refresh', { name: doc.name })
          .catch((err) =>
            this.logger.error(`Scheduler: refresh failed for '${doc.name}': ${err.message}`)
          )
          .finally(() => this.activeRefreshes.delete(doc.name));
      }
    },

    /**
     * Build a JSON-LD @context for a specific datapoint, mapping its field
     * profiles to OEO class IRIs. Enables linked-data consumers to interpret
     * datapoint columns using standardised ontology terms.
     *
     * @see https://github.com/OpenEnergyPlatform/ontology — @OpenEnergyPlatform/ontology
     */
    buildOeoContext(fieldProfiles, domainId) {
      const { OEO_BASE_IRI, forDomainResolved, UNITS, byCernionType } = require('../src/oeo-mappings');
      const ctx = {
        oeo: OEO_BASE_IRI,
        schema: 'https://schema.org/',
      };

      // Map domain classes
      const domainClasses = forDomainResolved(domainId);
      if (domainClasses.length) {
        ctx['@type'] = domainClasses.map((c) => c.iri);
      }

      // Map field profiles to OEO concepts
      if (fieldProfiles && typeof fieldProfiles === 'object') {
        for (const [field, profile] of Object.entries(fieldProfiles)) {
          if (profile.unit && UNITS[profile.unit]) {
            ctx[field] = { '@id': UNITS[profile.unit].iri, '@type': '@id' };
          } else if (profile.role === 'technology' && profile.type) {
            const mapping = byCernionType(profile.type);
            if (mapping) ctx[field] = { '@id': mapping.iri, '@type': '@id' };
          }
        }
      }

      return ctx;
    },
  },
};
