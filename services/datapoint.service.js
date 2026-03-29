'use strict';

/**
 * Datapoint Service (v0.11)
 *
 * Promotes agent sessions to named, versioned, health-monitored data points.
 * Persistence is provided by PouchDB (embedded, zero-config, no external DB).
 * Only metadata is persisted — raw data always flows through RAM.
 *
 * KRITIS note: PouchDB has no native C-bindings, no network port, and no
 * external process. It is functionally equivalent to the existing file-based
 * stores (.sessions/, .jobs/, .datasource-registry.json) but adds revision
 * semantics and index-based queries.
 */

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;

module.exports = {
  name: 'datapoint',

  settings: {
    dbPath: process.env.DATAPOINT_DB_PATH || './.datapoints',
    defaultTimeout: 120000,
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['sourceType', 'createdAt'] } });
    this.logger.info(`Datapoint DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
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
                    example: 'pv-portfolio-twl-netze',
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
                    name: 'pv-portfolio-twl-netze',
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
    // health — aggregated health overview of all datapoints
    // ------------------------------------------------------------------
    health: {
      rest: 'GET /health/overview',
      openapi: {
        summary: 'Health overview of all Datapoints',
        tags: ['Datapoints'],
      },
      async handler(ctx) {
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
            schema: { type: 'string', example: 'pv-portfolio-twl-netze' },
          },
        ],
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`dp:${ctx.params.name}`);
          return doc;
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
            schema: { type: 'string', example: 'pv-portfolio-twl-netze' },
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

          doc.lastRun = {
            timestamp: new Date().toISOString(),
            durationMs,
            status: result.success ? 'success' : 'partial',
            errorMessage: null,
            summary,
            schemaHash,
          };
          doc.health = this.updateHealth(doc.health, 'success', durationMs, oldSchemaHash, schemaHash);

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
            schema: { type: 'string', example: 'pv-portfolio-twl-netze' },
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
  },
};
