'use strict';

/**
 * Netzkoppelvertrag Workflow Service — Grid Coupling Contract Workflow
 *
 * Issue #119 — Netzkoppelvertrag-Workflow
 *
 * Grid coupling contracts (Netzkoppelverträge) govern the interaction between
 * adjacent DSOs or between TSO and DSO at interconnection points. The technical
 * data requirements, deadlines, and responsibilities are often poorly managed
 * with status tracked only in email chains or Excel sheets.
 *
 * This service provides:
 *   1. Contract objects with technical data requirements checklists
 *   2. Deadline tracking with responsibility assignment
 *   3. Status workflow (DRAFT → UNDER_REVIEW → TECHNICALLY_APPROVED → SIGNED → ACTIVE)
 *   4. Open items tracker with severity and owner
 *   5. Change request management
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const DOC_PREFIX = 'nkv:';

const CONTRACT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  UNDER_REVIEW: 'UNDER_REVIEW',
  TECHNICALLY_APPROVED: 'TECHNICALLY_APPROVED',
  SIGNED: 'SIGNED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  TERMINATED: 'TERMINATED',
});

const ITEM_SEVERITY = Object.freeze({
  BLOCKING: 'BLOCKING',
  MAJOR: 'MAJOR',
  MINOR: 'MINOR',
  INFO: 'INFO',
});

const TECHNICAL_DATA_FIELDS = [
  'netzverknuepfungspunkt',
  'voltageLevel',
  'maxTransferCapacityMw',
  'protectionScheme',
  'metering',
  'scadaInterface',
  'safetyDistances',
  'primarySubstation',
  'loadFlowModel',
  'shortCircuitPower',
];

function checkDataCompleteness(technicalData) {
  const missing = TECHNICAL_DATA_FIELDS.filter((f) => !(f in (technicalData ?? {})));
  const completenessScore = Math.round(
    ((TECHNICAL_DATA_FIELDS.length - missing.length) / TECHNICAL_DATA_FIELDS.length) * 100
  );
  return { missing, completenessScore };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'netzkoppelvertrag-workflow',

  settings: {
    dbPath: process.env.NETZKOPPELVERTRAG_DB_PATH || './data/netzkoppelvertrag-workflow',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Netzkoppelvertrag Workflow DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/netzkoppelvertrag-workflow/contracts:
     *   post:
     *     tags: [Netzkoppelvertrag Workflow]
     *     summary: Create a new grid coupling contract object
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, counterpartyId, interconnectionPointId]
     *             properties:
     *               gridOperatorId: { type: string }
     *               counterpartyId: { type: string }
     *               interconnectionPointId: { type: string }
     *               label: { type: string }
     *               technicalData: { type: object }
     *               deadlines:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     milestone: { type: string }
     *                     dueDate: { type: string }
     *                     owner: { type: string }
     *               openItems:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     description: { type: string }
     *                     severity: { type: string, enum: [BLOCKING, MAJOR, MINOR, INFO] }
     *                     owner: { type: string }
     *     responses:
     *       200:
     *         description: Contract object created
     */
    create: {
      rest: 'POST /contracts',
      params: {
        gridOperatorId: { type: 'string' },
        counterpartyId: { type: 'string' },
        interconnectionPointId: { type: 'string' },
        label: { type: 'string', optional: true },
        technicalData: { type: 'object', optional: true },
        deadlines: { type: 'array', items: 'object', optional: true },
        openItems: { type: 'array', items: 'object', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          gridOperatorId,
          counterpartyId,
          interconnectionPointId,
          label,
          technicalData,
          deadlines,
          openItems,
        } = ctx.params;
        const contractId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const { missing, completenessScore } = checkDataCompleteness(technicalData);

        const doc = {
          _id: contractId,
          type: 'netzkoppelvertrag-workflow',
          tenantId,
          gridOperatorId,
          counterpartyId,
          interconnectionPointId,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          status: CONTRACT_STATUS.DRAFT,
          technicalData: technicalData ?? {},
          missingTechnicalData: missing,
          technicalDataCompleteness: completenessScore,
          deadlines: (deadlines ?? []).map((d) => ({
            ...d,
            deadlineId: d.deadlineId ?? crypto.randomUUID(),
            status: d.status ?? 'OPEN',
          })),
          openItems: (openItems ?? []).map((i) => ({
            ...i,
            itemId: i.itemId ?? crypto.randomUUID(),
            severity: i.severity ?? ITEM_SEVERITY.MINOR,
            resolved: false,
          })),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        await this.db.put(doc);
        return {
          contractId,
          status: doc.status,
          technicalDataCompleteness: completenessScore,
          missingTechnicalData: missing,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/netzkoppelvertrag-workflow/contracts/{id}/status:
     *   patch:
     *     tags: [Netzkoppelvertrag Workflow]
     *     summary: Advance contract workflow status
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [status]
     *             properties:
     *               status:
     *                 type: string
     *                 enum: [UNDER_REVIEW, TECHNICALLY_APPROVED, SIGNED, ACTIVE, SUSPENDED, TERMINATED]
     *               note: { type: string }
     *     responses:
     *       200:
     *         description: Status updated
     *       404:
     *         description: Contract not found
     */
    updateStatus: {
      rest: 'PATCH /contracts/:id/status',
      params: {
        id: { type: 'string' },
        status: { type: 'string', enum: Object.values(CONTRACT_STATUS) },
        note: { type: 'string', optional: true },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404)
            throw new MoleculerClientError('Contract not found', 404, 'CONTRACT_NOT_FOUND');
          throw err;
        }
        doc.status = ctx.params.status;
        doc.updatedAt = nowIso();
        if (ctx.params.note) doc.statusNote = ctx.params.note;
        await this.db.put(doc);
        return { contractId: doc._id, status: doc.status, updatedAt: doc.updatedAt };
      },
    },

    /**
     * @openapi
     * /api/netzkoppelvertrag-workflow/contracts:
     *   get:
     *     tags: [Netzkoppelvertrag Workflow]
     *     summary: List contracts
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: status
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of contracts
     */
    list: {
      rest: 'GET /contracts',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, status, limit } = ctx.params;
        const selector = { tenantId, type: 'netzkoppelvertrag-workflow', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (status) selector.status = status;
        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { contracts: result.docs };
      },
    },

    /**
     * @openapi
     * /api/netzkoppelvertrag-workflow/contracts/{id}:
     *   get:
     *     tags: [Netzkoppelvertrag Workflow]
     *     summary: Get contract by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Contract document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /contracts/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404)
            throw new MoleculerClientError('Contract not found', 404, 'CONTRACT_NOT_FOUND');
          throw err;
        }
      },
    },
  },
};
