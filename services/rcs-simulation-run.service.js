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
    assetId: doc.assetId,
    assetName: doc.assetName ?? doc.assetId,
    assetIds: doc.assetIds ?? [doc.assetId],
    timeframe: doc.timeframe,
    scope: doc.scope ?? 'asset',
    ruleSetId: doc.ruleSetId ?? null,
    ruleSetVersion: doc.ruleSetVersion ?? null,
    legalStatus: doc.legalStatus ?? null,
    blueprintId: doc.blueprintId ?? null,
    status: doc.status,
    summary: doc.summary ?? null,
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
        // Pre-computed hashes may be passed in, or raw series for hashing here
        inputHash: { type: 'string', optional: true },
        priceSeriesHash: { type: 'string', optional: true },
        injectionSeriesHash: { type: 'string', optional: true },
        // Raw series for on-save hashing (not persisted)
        priceSeries: { type: 'array', optional: true },
        injectionSeries: { type: 'array', optional: true },
        warnings: { type: 'array', optional: true },
      },
      async handler(ctx) {
        const runId = makeRunId();
        const now = new Date().toISOString();
        const p = ctx.params;

        // Resolve hashes: caller may supply pre-computed hashes or raw series
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
     * Supports filter by assetId, ruleSetId, status, and date range.
     * Maps to: GET /api/vnb/rcs/runs
     */
    listRuns: {
      rest: 'GET /runs',
      params: {
        assetId: { type: 'string', optional: true },
        ruleSetId: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        from: { type: 'string', optional: true },
        to: { type: 'string', optional: true },
        includeDeleted: { type: 'boolean', optional: true, default: false },
        limit: { type: 'number', integer: true, positive: true, optional: true, default: 50 },
      },
      async handler(ctx) {
        const { assetId, ruleSetId, status, from, to, includeDeleted, limit } = ctx.params;
        const result = await this._db.allDocs({
          include_docs: true,
          startkey: 'rcs:run:',
          endkey: 'rcs:run:￿',
        });
        let docs = result.rows.map((r) => r.doc).filter(Boolean);

        // Filter soft-deleted
        if (!includeDeleted) docs = docs.filter((d) => !d.deletedAt);

        // Apply filters
        if (assetId) docs = docs.filter((d) => d.assetId === assetId);
        if (ruleSetId) docs = docs.filter((d) => d.ruleSetId === ruleSetId);
        if (status) docs = docs.filter((d) => d.status === status);
        if (from) docs = docs.filter((d) => d.createdAt >= from);
        if (to) docs = docs.filter((d) => d.createdAt <= to);

        // Newest first
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
          // Already soft-deleted — idempotent
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
  },
};
