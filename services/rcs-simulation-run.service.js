'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;

const DB_NAME = process.env.RCS_SIM_RUN_DB ?? 'rcs-simulation-runs';

function makeRunId() {
  return `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function docId(runId) {
  return `rcs:run:${runId}`;
}

function toPublic(doc) {
  return {
    runId: doc.runId,
    assetId: doc.assetId,
    assetName: doc.assetName ?? doc.assetId,
    timeframe: doc.timeframe,
    ruleSetId: doc.ruleSetId ?? null,
    blueprintId: doc.blueprintId ?? null,
    status: doc.status,
    summary: doc.summary ?? null,
    options: doc.options ?? null,
    createdAt: doc.createdAt,
    completedAt: doc.completedAt ?? null,
    errorMessage: doc.errorMessage ?? null,
  };
}

module.exports = {
  name: 'rcs-simulation-run',

  created() {
    this._db = new PouchDB(DB_NAME);
  },

  actions: {
    /**
     * Save a completed simulation result as a persistent run record.
     * Called internally by the simulate orchestrator or by external callers.
     * Maps to: POST /api/vnb/rcs/runs
     */
    saveRun: {
      rest: 'POST /runs',
      params: {
        assetId: { type: 'string', min: 1 },
        timeframe: {
          type: 'object',
          props: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
        summary: { type: 'object' },
        assetName: { type: 'string', optional: true },
        ruleSetId: { type: 'string', optional: true },
        blueprintId: { type: 'string', optional: true },
        options: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const runId = makeRunId();
        const now = new Date().toISOString();
        const doc = {
          _id: docId(runId),
          runId,
          assetId: ctx.params.assetId,
          assetName: ctx.params.assetName ?? ctx.params.assetId,
          timeframe: ctx.params.timeframe,
          ruleSetId: ctx.params.ruleSetId ?? null,
          blueprintId: ctx.params.blueprintId ?? null,
          summary: ctx.params.summary,
          options: ctx.params.options ?? null,
          status: 'completed',
          createdAt: now,
          completedAt: now,
        };
        await this._db.put(doc);
        return toPublic(doc);
      },
    },

    /**
     * Retrieve a single run by runId.
     * Maps to: GET /api/vnb/rcs/runs/:runId
     */
    getRun: {
      rest: 'GET /runs/:runId',
      params: {
        runId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        try {
          const doc = await this._db.get(docId(ctx.params.runId));
          return toPublic(doc);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              `Simulation run '${ctx.params.runId}' not found.`,
              404,
              'RCS_RUN_NOT_FOUND'
            );
          }
          throw err;
        }
      },
    },

    /**
     * List all simulation runs, newest first. Supports optional assetId filter.
     * Maps to: GET /api/vnb/rcs/runs
     */
    listRuns: {
      rest: 'GET /runs',
      params: {
        assetId: { type: 'string', optional: true },
        limit: { type: 'number', integer: true, positive: true, optional: true, default: 50 },
      },
      async handler(ctx) {
        const { assetId, limit } = ctx.params;
        const result = await this._db.allDocs({
          include_docs: true,
          startkey: 'rcs:run:',
          endkey: 'rcs:run:￿',
          descending: false,
        });
        let docs = result.rows.map((r) => r.doc);
        if (assetId) docs = docs.filter((d) => d.assetId === assetId);
        // Sort newest first
        docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return docs.slice(0, limit).map(toPublic);
      },
    },

    /**
     * Delete a run record permanently.
     * Maps to: DELETE /api/vnb/rcs/runs/:runId
     */
    deleteRun: {
      rest: 'DELETE /runs/:runId',
      params: {
        runId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this._db.get(docId(ctx.params.runId));
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              `Simulation run '${ctx.params.runId}' not found.`,
              404,
              'RCS_RUN_NOT_FOUND'
            );
          }
          throw err;
        }
        await this._db.remove(doc);
        return { deleted: true, runId: ctx.params.runId };
      },
    },
  },
};
