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

function assetDocId(runId, assetId) {
  return `rcs:asset:${runId}:${assetId}`;
}

function hashData(data) {
  if (data == null) return null;
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return `sha256:${crypto.createHash('sha256').update(str).digest('hex')}`;
}

function toPublic(doc, { includeDeleted = false } = {}) {
  const isDeleted = Boolean(doc.deletedAt);
  if (isDeleted && !includeDeleted) return null;
  return {
    runId: doc.runId,
    assetId: doc.assetId ?? null,
    assetName: doc.assetName ?? doc.assetId ?? null,
    assetIds: doc.assetIds ?? [doc.assetId],
    assetCount: doc.assetCount ?? null,
    timeframe: doc.timeframe,
    scope: doc.scope ?? 'asset',
    ruleSetId: doc.ruleSetId ?? null,
    ruleSetVersion: doc.ruleSetVersion ?? null,
    legalStatus: doc.legalStatus ?? null,
    blueprintId: doc.blueprintId ?? null,
    jobId: doc.jobId ?? null,
    executionMode: doc.executionMode ?? 'sync',
    status: doc.status,
    progress: doc.progress ?? null,
    workloadEstimate: doc.workloadEstimate ?? null,
    resultLocation: doc.resultLocation ?? null,
    summary: doc.summary ?? null,
    portfolioSummary: doc.portfolioSummary ?? null,
    ruleArmSummary: doc.ruleArmSummary ?? null,
    errorCount: doc.errorCount ?? null,
    options: doc.options ?? null,
    ruleSetSnapshot: doc.ruleSetSnapshot ?? null,
    assetSnapshot: doc.assetSnapshot ?? null,
    readinessSnapshot: doc.readinessSnapshot ?? null,
    inputHash: doc.inputHash ?? null,
    priceSeriesHash: doc.priceSeriesHash ?? null,
    injectionSeriesHash: doc.injectionSeriesHash ?? null,
    warnings: doc.warnings ?? [],
    createdAt: doc.createdAt,
    completedAt: doc.completedAt ?? null,
    errorMessage: doc.errorMessage ?? null,
    isDeleted,
    deletedAt: doc.deletedAt ?? null,
    deletedBy: doc.deletedBy ?? null,
    deleteReason: doc.deleteReason ?? null,
  };
}

function toPublicAsset(doc) {
  return {
    assetId: doc.assetId,
    runId: doc.runId,
    assetName: doc.assetName ?? doc.assetId,
    technology: doc.technology ?? null,
    status: doc.status,
    readinessStatus: doc.readinessStatus ?? null,
    summary: doc.summary ?? null,
    ruleArmSummary: doc.ruleArmSummary ?? null,
    errorCode: doc.errorCode ?? null,
    message: doc.message ?? null,
    savedAt: doc.savedAt,
  };
}

// PouchDB read-modify-write with conflict retry
async function updateRunDoc(db, runId, updates, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const doc = await db.get(docId(runId));
    try {
      await db.put({ ...doc, ...updates });
      return;
    } catch (err) {
      if (err.status === 409 && attempt < maxAttempts - 1) continue;
      throw err;
    }
  }
}

module.exports = {
  name: 'rcs-simulation-run',

  created() {
    this._db = new PouchDB(DB_NAME);
  },

  actions: {
    /**
     * Save a completed simulation run with full audit trail.
     * Maps to: POST /api/vnb/rcs/runs
     */
    saveRun: {
      rest: 'POST /runs',
      params: {
        assetId: { type: 'string', min: 1 },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
        summary: { type: 'object' },
        assetName: { type: 'string', optional: true },
        assetIds: { type: 'array', optional: true },
        scope: { type: 'string', optional: true, default: 'asset' },
        ruleSetId: { type: 'string', optional: true },
        ruleSetVersion: { type: 'string', optional: true },
        legalStatus: { type: 'string', optional: true },
        blueprintId: { type: 'string', optional: true },
        options: { type: 'object', optional: true },
        ruleSetSnapshot: { type: 'object', optional: true },
        assetSnapshot: { type: 'object', optional: true },
        readinessSnapshot: { type: 'object', optional: true },
        inputHash: { type: 'string', optional: true },
        priceSeriesHash: { type: 'string', optional: true },
        injectionSeriesHash: { type: 'string', optional: true },
        priceSeries: { type: 'array', optional: true },
        injectionSeries: { type: 'array', optional: true },
        warnings: { type: 'array', optional: true },
        jobId: { type: 'string', optional: true },
        executionMode: {
          type: 'enum',
          values: ['sync', 'async', 'auto'],
          optional: true,
          default: 'sync',
        },
      },
      async handler(ctx) {
        const runId = makeRunId();
        const now = new Date().toISOString();
        const p = ctx.params;

        const priceSeriesHash = p.priceSeriesHash ?? (p.priceSeries ? hashData(p.priceSeries) : null);
        const injectionSeriesHash = p.injectionSeriesHash ?? (p.injectionSeries ? hashData(p.injectionSeries) : null);
        const inputHash =
          p.inputHash ??
          hashData({
            assetSnapshot: p.assetSnapshot ?? null,
            ruleSetSnapshot: p.ruleSetSnapshot ?? null,
            timeframe: p.timeframe,
            options: p.options ?? null,
            priceSeriesHash,
            injectionSeriesHash,
          });

        const doc = {
          _id: docId(runId),
          runId,
          assetId: p.assetId,
          assetName: p.assetName ?? p.assetId,
          assetIds: p.assetIds ?? [p.assetId],
          scope: p.scope ?? 'asset',
          timeframe: p.timeframe,
          ruleSetId: p.ruleSetId ?? null,
          ruleSetVersion: p.ruleSetVersion ?? null,
          legalStatus: p.legalStatus ?? null,
          blueprintId: p.blueprintId ?? null,
          jobId: p.jobId ?? null,
          executionMode: p.executionMode ?? 'sync',
          summary: p.summary,
          options: p.options ?? null,
          ruleSetSnapshot: p.ruleSetSnapshot ?? null,
          assetSnapshot: p.assetSnapshot ?? null,
          readinessSnapshot: p.readinessSnapshot ?? null,
          inputHash,
          priceSeriesHash,
          injectionSeriesHash,
          warnings: p.warnings ?? [],
          status: 'completed',
          createdAt: now,
          completedAt: now,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        };

        await this._db.put(doc);
        return toPublic(doc, { includeDeleted: true });
      },
    },

    /**
     * Create a run in 'running' state at the start of an async portfolio job.
     * Internal only — called from the portfolio worker, not exposed via REST.
     * WP4
     */
    createRun: {
      params: {
        assetIds: { type: 'array', min: 1 },
        assetCount: { type: 'number', integer: true, positive: true },
        timeframe: {
          type: 'object',
          props: { start: { type: 'string' }, end: { type: 'string' } },
        },
        scope: { type: 'string', optional: true, default: 'portfolio' },
        jobId: { type: 'string', min: 1 },
        executionMode: { type: 'string', optional: true, default: 'async' },
        ruleSetId: { type: 'string', optional: true },
        ruleSetVersion: { type: 'string', optional: true },
        legalStatus: { type: 'string', optional: true },
        workloadEstimate: { type: 'object', optional: true },
        resultLocation: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const runId = makeRunId();
        const now = new Date().toISOString();
        const p = ctx.params;

        const doc = {
          _id: docId(runId),
          runId,
          assetId: null,
          assetName: null,
          assetIds: p.assetIds,
          assetCount: p.assetCount,
          scope: p.scope ?? 'portfolio',
          timeframe: p.timeframe,
          ruleSetId: p.ruleSetId ?? null,
          ruleSetVersion: p.ruleSetVersion ?? null,
          legalStatus: p.legalStatus ?? null,
          blueprintId: null,
          jobId: p.jobId,
          executionMode: p.executionMode ?? 'async',
          status: 'running',
          progress: { processedAssets: 0, totalAssets: p.assetCount, percent: 0 },
          workloadEstimate: p.workloadEstimate ?? null,
          resultLocation: p.resultLocation ?? null,
          summary: null,
          portfolioSummary: null,
          ruleArmSummary: null,
          errorCount: null,
          options: null,
          ruleSetSnapshot: null,
          assetSnapshot: null,
          readinessSnapshot: null,
          inputHash: null,
          priceSeriesHash: null,
          injectionSeriesHash: null,
          warnings: [],
          createdAt: now,
          completedAt: null,
          errorMessage: null,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null,
        };

        await this._db.put(doc);
        return { runId };
      },
    },

    /**
     * Update run status and/or fields during/after execution.
     * Internal only — not exposed via REST. Uses conflict-safe read-modify-write.
     * WP4
     */
    updateRun: {
      params: {
        runId: { type: 'string', min: 1 },
        status: {
          type: 'enum',
          values: ['running', 'completed', 'failed'],
          optional: true,
        },
        progress: { type: 'object', optional: true },
        portfolioSummary: { type: 'object', optional: true },
        ruleArmSummary: { type: 'object', optional: true },
        errorCount: { type: 'number', integer: true, min: 0, optional: true },
        completedAt: { type: 'string', optional: true },
        errorMessage: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { runId, ...updates } = ctx.params;
        const cleanUpdates = Object.fromEntries(
          Object.entries(updates).filter(([, v]) => v !== undefined)
        );

        try {
          await updateRunDoc(this._db, runId, cleanUpdates);
          return { updated: true, runId };
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              `Simulation run '${runId}' not found.`,
              404,
              'RCS_RUN_NOT_FOUND'
            );
          }
          throw err;
        }
      },
    },

    /**
     * Retrieve a single run by runId (returns deleted runs with isDeleted flag).
     * Maps to: GET /api/vnb/rcs/runs/:runId
     */
    getRun: {
      rest: 'GET /runs/:runId',
      params: { runId: { type: 'string', min: 1 } },
      async handler(ctx) {
        try {
          const doc = await this._db.get(docId(ctx.params.runId));
          return toPublic(doc, { includeDeleted: true });
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
     * List runs. By default excludes soft-deleted records.
     * Maps to: GET /api/vnb/rcs/runs
     */
    listRuns: {
      rest: 'GET /runs',
      params: {
        assetId: { type: 'string', optional: true },
        ruleSetId: { type: 'string', optional: true },
        jobId: { type: 'string', optional: true },
        executionMode: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        from: { type: 'string', optional: true },
        to: { type: 'string', optional: true },
        includeDeleted: { type: 'boolean', optional: true, default: false },
        limit: { type: 'number', integer: true, positive: true, optional: true, default: 50 },
      },
      async handler(ctx) {
        const { assetId, ruleSetId, jobId, executionMode, status, from, to, includeDeleted, limit } =
          ctx.params;
        const result = await this._db.allDocs({
          include_docs: true,
          startkey: 'rcs:run:',
          endkey: 'rcs:run:￿',
        });
        let docs = result.rows.map((r) => r.doc).filter(Boolean);

        if (!includeDeleted) docs = docs.filter((d) => !d.deletedAt);
        if (assetId) docs = docs.filter((d) => d.assetId === assetId);
        if (ruleSetId) docs = docs.filter((d) => d.ruleSetId === ruleSetId);
        if (jobId) docs = docs.filter((d) => d.jobId === jobId);
        if (executionMode) docs = docs.filter((d) => d.executionMode === executionMode);
        if (status) docs = docs.filter((d) => d.status === status);
        if (from) docs = docs.filter((d) => d.createdAt >= from);
        if (to) docs = docs.filter((d) => d.createdAt <= to);

        docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return docs
          .slice(0, limit)
          .map((d) => toPublic(d, { includeDeleted: true }))
          .filter(Boolean);
      },
    },

    /**
     * Soft-delete a run: sets deletedAt/deletedBy/deleteReason, never removes the document.
     * Maps to: DELETE /api/vnb/rcs/runs/:runId
     */
    deleteRun: {
      rest: 'DELETE /runs/:runId',
      params: {
        runId: { type: 'string', min: 1 },
        deletedBy: { type: 'string', optional: true },
        deleteReason: { type: 'string', optional: true },
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
        if (doc.deletedAt) {
          return { deleted: true, runId: ctx.params.runId, alreadyDeleted: true };
        }
        const updated = {
          ...doc,
          deletedAt: new Date().toISOString(),
          deletedBy: ctx.params.deletedBy ?? null,
          deleteReason: ctx.params.deleteReason ?? null,
        };
        await this._db.put(updated);
        return { deleted: true, runId: ctx.params.runId, alreadyDeleted: false };
      },
    },

    /**
     * Bulk-persist per-asset simulation results as separate PouchDB docs.
     * Internal only — called from runPortfolioSimulationCore per chunk.
     * WP5
     */
    saveAssetResults: {
      params: {
        runId: { type: 'string', min: 1 },
        results: { type: 'array', min: 1 },
      },
      async handler(ctx) {
        const { runId, results } = ctx.params;
        const now = new Date().toISOString();

        const docs = results.map((r) => ({
          _id: assetDocId(runId, r.assetId),
          runId,
          assetId: r.assetId,
          assetName: r.assetName ?? r.assetId,
          technology: r.technology ?? null,
          status: r.status,
          readinessStatus: r.readinessStatus ?? null,
          summary: r.summary ?? null,
          ruleArmSummary: r.ruleArmSummary ?? null,
          errorCode: r.errorCode ?? null,
          message: r.message ?? null,
          savedAt: now,
        }));

        // Best-effort bulk write; ignore 409 conflicts (idempotent retry safety)
        const bulkResult = await this._db.bulkDocs(docs);
        const errors = bulkResult.filter(
          (r) => r.error && r.status !== 409
        );

        return {
          saved: bulkResult.length - errors.length,
          errors: errors.length,
          runId,
        };
      },
    },

    /**
     * List per-asset results for a given run.
     * Maps to: GET /api/vnb/rcs/runs/:runId/assets
     * WP5
     */
    listRunAssets: {
      rest: 'GET /runs/:runId/assets',
      params: {
        runId: { type: 'string', min: 1 },
        status: { type: 'string', optional: true },
        limit: { type: 'number', integer: true, positive: true, optional: true, default: 100 },
        offset: { type: 'number', integer: true, min: 0, optional: true, default: 0 },
      },
      async handler(ctx) {
        const { runId, status, limit, offset } = ctx.params;

        const result = await this._db.allDocs({
          include_docs: true,
          startkey: `rcs:asset:${runId}:`,
          endkey: `rcs:asset:${runId}:￿`,
        });

        let docs = result.rows.map((r) => r.doc).filter(Boolean);
        if (status) docs = docs.filter((d) => d.status === status);

        const total = docs.length;
        const page = docs.slice(offset, offset + limit);
        const hasMore = offset + limit < total;

        return {
          runId,
          total,
          offset,
          hasMore,
          assetResults: page.map(toPublicAsset),
        };
      },
    },

    /**
     * Get a single per-asset result for a run.
     * Maps to: GET /api/vnb/rcs/runs/:runId/assets/:assetId
     * WP5
     */
    getRunAsset: {
      rest: 'GET /runs/:runId/assets/:assetId',
      params: {
        runId: { type: 'string', min: 1 },
        assetId: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const { runId, assetId } = ctx.params;
        try {
          const doc = await this._db.get(assetDocId(runId, assetId));
          return toPublicAsset(doc);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              `Asset result '${assetId}' not found for run '${runId}'.`,
              404,
              'RCS_ASSET_RESULT_NOT_FOUND'
            );
          }
          throw err;
        }
      },
    },

    /**
     * List only failed/error asset results for a run.
     * Maps to: GET /api/vnb/rcs/runs/:runId/errors
     * WP5
     */
    listRunErrors: {
      rest: 'GET /runs/:runId/errors',
      params: {
        runId: { type: 'string', min: 1 },
        limit: { type: 'number', integer: true, positive: true, optional: true, default: 50 },
      },
      async handler(ctx) {
        const { runId, limit } = ctx.params;

        const result = await this._db.allDocs({
          include_docs: true,
          startkey: `rcs:asset:${runId}:`,
          endkey: `rcs:asset:${runId}:￿`,
        });

        const errorDocs = result.rows
          .map((r) => r.doc)
          .filter((d) => d && d.status === 'error')
          .slice(0, limit);

        return {
          runId,
          errorCount: errorDocs.length,
          errors: errorDocs.map(toPublicAsset),
        };
      },
    },
  },
};
