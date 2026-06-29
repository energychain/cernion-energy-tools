'use strict';

/**
 * Altdaten Assessment Service — Fit-to-Template Altdaten-Assessment
 *
 * Issue #127 — Fit-to-Template Altdaten-Assessment
 *
 * DSOs going through ERP, SAP, or billing system migrations carry decades-old
 * special logic, master data liabilities, and unclear process variants. Standard
 * templates become technically risky when fit-gap, data cleansing, regulatory
 * must-criteria, and consciously allowed deviations are not available as an
 * auditable decision grid.
 *
 * This service provides:
 *   1. Structured intake of historical process/data deviations
 *   2. Fit-to-Template gap assessment (FIT / GAP / MUST_DEVIATION / ALLOWED_DEVIATION)
 *   3. Regulatory must-criteria gate (mandatory requirements that cannot be skipped)
 *   4. Evidence gates per gap (what evidence is needed before migration decision)
 *   5. Prioritised cleansing and migration roadmap
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const DOC_PREFIX = 'ada:';

const FIT_STATUS = Object.freeze({
  FIT: 'FIT', // matches template, no action needed
  GAP: 'GAP', // standard template cannot accommodate this process/data variant
  MUST_DEVIATION: 'MUST_DEVIATION', // legally or operationally required deviation
  ALLOWED_DEVIATION: 'ALLOWED_DEVIATION', // business decision to deviate
  UNKNOWN: 'UNKNOWN', // not yet assessed
});

const GAP_PRIORITY = Object.freeze({
  BLOCKING: 'BLOCKING', // migration cannot proceed without resolving this
  HIGH: 'HIGH', // must be resolved in first sprint
  MEDIUM: 'MEDIUM', // resolve in migration project
  LOW: 'LOW', // document and accept or defer
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Classify a single deviation/gap entry.
 */
function classifyDeviationEntry(entry) {
  const fitStatus = entry.fitStatus ?? FIT_STATUS.UNKNOWN;
  const hasRegulatoryBasis = !!entry.regulatoryBasis;
  const hasEvidenceGate = !!entry.evidenceGate;

  let priority = GAP_PRIORITY.LOW;
  if (fitStatus === FIT_STATUS.GAP && !hasEvidenceGate) {
    priority = GAP_PRIORITY.BLOCKING;
  } else if (fitStatus === FIT_STATUS.MUST_DEVIATION && !hasRegulatoryBasis) {
    priority = GAP_PRIORITY.BLOCKING; // claimed must but no legal basis documented
  } else if (fitStatus === FIT_STATUS.GAP) {
    priority = GAP_PRIORITY.HIGH;
  } else if (fitStatus === FIT_STATUS.ALLOWED_DEVIATION) {
    priority = GAP_PRIORITY.MEDIUM;
  } else if (fitStatus === FIT_STATUS.MUST_DEVIATION) {
    priority = GAP_PRIORITY.MEDIUM;
  }

  const openEvidenceGates = [];
  if (
    (fitStatus === FIT_STATUS.GAP || fitStatus === FIT_STATUS.MUST_DEVIATION) &&
    !hasEvidenceGate
  ) {
    openEvidenceGates.push({
      gate: 'EVIDENCE_REQUIRED',
      description:
        'Entscheidungsgrundlage fehlt: Evidenz oder Lösung definieren bevor Migrationsfreigabe',
    });
  }
  if (fitStatus === FIT_STATUS.MUST_DEVIATION && !hasRegulatoryBasis) {
    openEvidenceGates.push({
      gate: 'REGULATORY_BASIS_REQUIRED',
      description:
        'Pflichtabweichung ohne gesetzliche/betriebliche Begründung — muss dokumentiert werden',
    });
  }
  if (fitStatus === FIT_STATUS.ALLOWED_DEVIATION && !entry.approvalStatus) {
    openEvidenceGates.push({
      gate: 'APPROVAL_REQUIRED',
      description: 'Erlaubte Abweichung braucht formale Freigabe durch Prozessverantwortlichen',
    });
  }

  return {
    entryId: entry.entryId ?? crypto.randomUUID(),
    processArea: entry.processArea,
    deviationDescription: entry.deviationDescription,
    fitStatus,
    priority,
    regulatoryBasis: entry.regulatoryBasis ?? null,
    evidenceGate: entry.evidenceGate ?? null,
    approvalStatus: entry.approvalStatus ?? null,
    openEvidenceGates,
    migrationApproved: openEvidenceGates.length === 0 && fitStatus !== FIT_STATUS.UNKNOWN,
    cleansingRequired: fitStatus === FIT_STATUS.GAP || entry.requiresDataCleansing === true,
  };
}

module.exports = {
  name: 'altdaten-assessment',

  settings: {
    dbPath: process.env.ALTDATEN_ASSESSMENT_DB_PATH || './data/altdaten-assessment',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    this.logger.info(`Altdaten Assessment DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/altdaten-assessment/assessments:
     *   post:
     *     tags: [Altdaten Assessment]
     *     summary: Run a Fit-to-Template altdata assessment for a migration project
     *     description: >
     *       Classifies process/data deviations against a migration template. Returns
     *       a prioritised gap list with evidence gates and a migration readiness score.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, migrationProjectId, deviations]
     *             properties:
     *               gridOperatorId: { type: string }
     *               migrationProjectId: { type: string }
     *               templateName: { type: string }
     *               deviations:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [processArea, deviationDescription, fitStatus]
     *                   properties:
     *                     entryId: { type: string }
     *                     processArea: { type: string }
     *                     deviationDescription: { type: string }
     *                     fitStatus:
     *                       type: string
     *                       enum: [FIT, GAP, MUST_DEVIATION, ALLOWED_DEVIATION, UNKNOWN]
     *                     regulatoryBasis: { type: string }
     *                     evidenceGate: { type: string }
     *                     approvalStatus: { type: string }
     *                     requiresDataCleansing: { type: boolean }
     *     responses:
     *       200:
     *         description: Altdata assessment result with migration roadmap
     */
    assess: {
      rest: 'POST /assessments',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        migrationProjectId: { type: 'string' },
        templateName: { type: 'string', optional: true },
        deviations: { type: 'array', items: 'object', min: 1 },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, migrationProjectId, templateName, deviations, label } = ctx.params;
        const assessmentId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const classifiedDeviations = deviations.map(classifyDeviationEntry);
        classifiedDeviations.sort((a, b) => {
          const pOrder = { BLOCKING: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
          return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
        });

        const blocking = classifiedDeviations.filter((d) => d.priority === GAP_PRIORITY.BLOCKING);
        const requiresCleansing = classifiedDeviations.filter((d) => d.cleansingRequired);
        const migrationApprovedCount = classifiedDeviations.filter(
          (d) => d.migrationApproved
        ).length;

        const migrationReadinessPct =
          deviations.length > 0
            ? Math.round((migrationApprovedCount / deviations.length) * 100)
            : 100;

        const roadmap = {
          blockerCount: blocking.length,
          cleansingCount: requiresCleansing.length,
          migrationReadinessPct,
          readinessStatus:
            blocking.length > 0 ? 'BLOCKED' : migrationReadinessPct >= 90 ? 'READY' : 'PARTIAL',
          prioritisedActions: [
            ...blocking.slice(0, 3).map((d) => ({
              action: `BLOCKING: ${d.processArea} — ${d.deviationDescription.slice(0, 80)}`,
              openGates: d.openEvidenceGates.length,
            })),
            ...requiresCleansing.slice(0, 2).map((d) => ({
              action: `CLEANSING: ${d.processArea} — Datenbereinigung erforderlich`,
              openGates: 0,
            })),
          ],
        };

        const doc = {
          _id: assessmentId,
          type: 'altdaten-assessment',
          tenantId,
          gridOperatorId,
          migrationProjectId,
          templateName: templateName ?? null,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          createdAt: nowIso(),
          roadmap,
          summary: {
            totalDeviations: deviations.length,
            blockingCount: blocking.length,
            cleansingCount: requiresCleansing.length,
            migrationApprovedCount,
            migrationReadinessPct,
          },
          classifiedDeviations,
        };

        await this.db.put(doc);
        this.logger.info(
          `Altdaten assessment ${assessmentId}: readiness=${migrationReadinessPct}%, blockers=${blocking.length}`
        );

        return {
          assessmentId,
          migrationProjectId,
          roadmap,
          summary: doc.summary,
          classifiedDeviations,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/altdaten-assessment/assessments:
     *   get:
     *     tags: [Altdaten Assessment]
     *     summary: List altdata assessments
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: migrationProjectId
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of assessments
     */
    list: {
      rest: 'GET /assessments',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        migrationProjectId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, migrationProjectId, limit } = ctx.params;

        const selector = { tenantId, type: 'altdaten-assessment', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (migrationProjectId) selector.migrationProjectId = migrationProjectId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { assessments: result.docs };
      },
    },

    /**
     * @openapi
     * /api/altdaten-assessment/assessments/{id}:
     *   get:
     *     tags: [Altdaten Assessment]
     *     summary: Get altdata assessment by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Assessment document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /assessments/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Assessment not found', 404, 'ASSESSMENT_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
