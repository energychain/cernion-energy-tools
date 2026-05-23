'use strict';

/**
 * E2E Connection Check Service — E2E-Steuerungslogik für komplexe Anschlussprüfungen
 *
 * Issue #117 — E2E-Steuerungslogik für komplexe Anschlussprüfungen
 *
 * Complex connection or area examinations at DSOs arise from multiple parallel
 * sub-threads: technical feasibility, asset management, grid connection,
 * possibly gas/electricity interfaces, and management communication. Without a
 * shared coordination anchor, the next reliable data point, clear responsibility,
 * and audience-appropriate decision logic are often missing.
 *
 * This service provides:
 *   - Multi-thread coordination for complex connection checks
 *   - Per-thread status tracking with responsible roles
 *   - Next-data-point identification and escalation routing
 *   - Audience-appropriate output (technical / commercial / management)
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'E2E Connection Check';
const DOC_PREFIX = 'e2ecc:';

const THREAD_STATUS = Object.freeze({
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  ESCALATED: 'ESCALATED',
});

const STANDARD_THREADS = [
  {
    threadId: 'TECHNICAL_FEASIBILITY',
    label: 'Technische Machbarkeit',
    defaultOwner: 'NETZPLANUNG',
  },
  { threadId: 'ASSET_MANAGEMENT', label: 'Asset Management', defaultOwner: 'ASSET_MANAGEMENT' },
  { threadId: 'GRID_CONNECTION', label: 'Netzanschluss / NAP', defaultOwner: 'NETZBETRIEB' },
  {
    threadId: 'COMMERCIAL',
    label: 'Kaufmännische Bewertung',
    defaultOwner: 'KAUFMAENNISCHE_LEITUNG',
  },
  {
    threadId: 'MANAGEMENT_COMMUNICATION',
    label: 'Management-Kommunikation',
    defaultOwner: 'GESCHAEFTSFUEHRUNG',
  },
];

function nowIso() {
  return new Date().toISOString();
}

/**
 * Compute overall check status from thread statuses.
 */
function computeOverallStatus(threads) {
  if (threads.every((t) => t.status === THREAD_STATUS.COMPLETED)) return 'COMPLETED';
  if (threads.some((t) => t.status === THREAD_STATUS.ESCALATED)) return 'ESCALATED';
  if (threads.some((t) => t.status === THREAD_STATUS.BLOCKED)) return 'BLOCKED';
  if (threads.some((t) => t.status === THREAD_STATUS.IN_PROGRESS)) return 'IN_PROGRESS';
  return 'PENDING';
}

module.exports = {
  name: 'e2e-connection-check',

  settings: {
    dbPath: process.env.E2E_CONNECTION_CHECK_DB_PATH || './data/e2e-connection-check',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['overallStatus'] } });
    this.logger.info(`E2E Connection Check DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/e2e-connection-check/checks:
     *   post:
     *     tags: [E2E Connection Check]
     *     summary: Create a new multi-thread E2E connection check
     *     description: >
     *       Opens a new coordinated E2E connection check with defined threads,
     *       responsibilities, and a shared anchor for the next decision point.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, projectName, powerKw]
     *             properties:
     *               gridOperatorId: { type: string }
     *               projectName: { type: string }
     *               powerKw: { type: number }
     *               applicantReference: { type: string }
     *               location: { type: object }
     *               threads:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     threadId: { type: string }
     *                     label: { type: string }
     *                     owner: { type: string }
     *                     status: { type: string }
     *                     nextDataPoint: { type: string }
     *                     dueDate: { type: string }
     *               includeGasInterface: { type: boolean }
     *     responses:
     *       200:
     *         description: E2E check created
     */
    create: {
      rest: 'POST /checks',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        projectName: { type: 'string' },
        powerKw: { type: 'number', convert: true },
        applicantReference: { type: 'string', optional: true },
        location: { type: 'object', optional: true },
        threads: { type: 'array', items: 'object', optional: true },
        includeGasInterface: { type: 'boolean', optional: true, default: false, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const checkId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        // Build thread list from standard templates + overrides
        let threads = STANDARD_THREADS.map((t) => ({
          ...t,
          owner: t.defaultOwner,
          status: THREAD_STATUS.PENDING,
          nextDataPoint: null,
          dueDate: null,
          lastUpdatedAt: nowIso(),
          notes: [],
        }));

        if (ctx.params.includeGasInterface) {
          threads.push({
            threadId: 'GAS_ELECTRICITY_INTERFACE',
            label: 'Gas-/Strom-Schnittstelle',
            defaultOwner: 'NETZBETRIEB',
            owner: 'NETZBETRIEB',
            status: THREAD_STATUS.PENDING,
            nextDataPoint: null,
            dueDate: null,
            lastUpdatedAt: nowIso(),
            notes: [],
          });
        }

        // Apply caller-provided thread overrides
        if (ctx.params.threads && ctx.params.threads.length > 0) {
          for (const override of ctx.params.threads) {
            const idx = threads.findIndex((t) => t.threadId === override.threadId);
            if (idx >= 0) {
              threads[idx] = { ...threads[idx], ...override, lastUpdatedAt: nowIso() };
            } else {
              threads.push({
                threadId: override.threadId,
                label: override.label ?? override.threadId,
                owner: override.owner ?? 'UNKNOWN',
                status: override.status ?? THREAD_STATUS.PENDING,
                nextDataPoint: override.nextDataPoint ?? null,
                dueDate: override.dueDate ?? null,
                lastUpdatedAt: nowIso(),
                notes: [],
              });
            }
          }
        }

        const overallStatus = computeOverallStatus(threads);

        const doc = {
          _id: checkId,
          type: 'e2e-connection-check',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          overallStatus,
          projectName: ctx.params.projectName,
          powerKw: ctx.params.powerKw,
          applicantReference: ctx.params.applicantReference ?? null,
          location: ctx.params.location ?? null,
          threads,
        };

        await this.db.put(doc);
        this.logger.info(
          `E2E connection check ${checkId}: project="${ctx.params.projectName}", threads=${threads.length}`
        );

        return {
          checkId,
          overallStatus,
          projectName: doc.projectName,
          threads,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/e2e-connection-check/checks/{id}/threads/{threadId}:
     *   patch:
     *     tags: [E2E Connection Check]
     *     summary: Update a thread within an E2E connection check
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: threadId
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               status: { type: string }
     *               nextDataPoint: { type: string }
     *               dueDate: { type: string }
     *               note: { type: string }
     *     responses:
     *       200:
     *         description: Thread updated
     *       404:
     *         description: Check or thread not found
     */
    updateThread: {
      rest: 'PATCH /checks/:id/threads/:threadId',
      params: {
        id: { type: 'string' },
        threadId: { type: 'string' },
        status: { type: 'enum', values: Object.values(THREAD_STATUS), optional: true },
        nextDataPoint: { type: 'string', optional: true },
        dueDate: { type: 'string', optional: true },
        note: { type: 'string', optional: true },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Check not found', 404, 'CHECK_NOT_FOUND');
          }
          throw err;
        }

        const threadIdx = doc.threads.findIndex((t) => t.threadId === ctx.params.threadId);
        if (threadIdx < 0) {
          throw new MoleculerClientError('Thread not found', 404, 'THREAD_NOT_FOUND');
        }

        const thread = doc.threads[threadIdx];
        if (ctx.params.status) thread.status = ctx.params.status;
        if (ctx.params.nextDataPoint !== undefined) thread.nextDataPoint = ctx.params.nextDataPoint;
        if (ctx.params.dueDate !== undefined) thread.dueDate = ctx.params.dueDate;
        if (ctx.params.note) {
          thread.notes = thread.notes ?? [];
          thread.notes.push({ note: ctx.params.note, at: nowIso() });
        }
        thread.lastUpdatedAt = nowIso();

        doc.overallStatus = computeOverallStatus(doc.threads);
        doc.updatedAt = nowIso();
        await this.db.put(doc);

        return {
          checkId: doc._id,
          overallStatus: doc.overallStatus,
          thread: doc.threads[threadIdx],
        };
      },
    },

    /**
     * @openapi
     * /api/e2e-connection-check/checks:
     *   get:
     *     tags: [E2E Connection Check]
     *     summary: List E2E connection checks
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: overallStatus
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of checks
     */
    list: {
      rest: 'GET /checks',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        overallStatus: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, overallStatus, limit } = ctx.params;

        const selector = { tenantId, type: 'e2e-connection-check' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (overallStatus) selector.overallStatus = overallStatus;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { checks: result.docs };
      },
    },

    /**
     * @openapi
     * /api/e2e-connection-check/checks/{id}:
     *   get:
     *     tags: [E2E Connection Check]
     *     summary: Get E2E connection check by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Check document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /checks/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Check not found', 404, 'CHECK_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
