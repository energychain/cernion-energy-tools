'use strict';

/**
 * Connection Rejection Evidence Service — Anschlussablehnung als prüfbares Evidenzpaket
 *
 * Issue #126 — Anschlussablehnung als prüfbares Evidenzpaket
 *
 * For large connection requests, storage systems, or area developments, a
 * blanket capacity statement is insufficient. Technical teams, commercial,
 * regulatory counsel, and applicant communication all need the same auditable
 * decision tree covering:
 *   - Load assumptions
 *   - Network connection point (Netzverknüpfungspunkt)
 *   - Bottleneck logic
 *   - N-1 quality
 *   - Expansion path
 *   - Possible fNAV / Redispatch options
 *
 * This service creates revision-safe evidence packages for connection
 * decisions (GO / CONDITIONAL / NO-GO) and converts them into reusable
 * VDMI/Personal-Agent templates.
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'Connection Rejection Evidence';
const DOC_PREFIX = 'cre:';

const DECISION = Object.freeze({
  GO: 'GO',
  CONDITIONAL: 'CONDITIONAL',
  NO_GO: 'NO_GO',
  PENDING: 'PENDING',
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Validate completeness of the evidence fields for the decision tree.
 * Returns { complete, missingFields, warnings }
 */
function validateEvidenceCompleteness(params) {
  const required = [
    { field: 'loadAssumptionKw', label: 'Lastannahme (kW)' },
    { field: 'netzverknuepfungspunktId', label: 'Netzverknüpfungspunkt-ID' },
    { field: 'voltageLevel', label: 'Spannungsebene' },
    { field: 'bottleneckDescription', label: 'Engpassbeschreibung' },
    { field: 'n1QualityStatus', label: 'N-1-Qualitätsstatus' },
  ];

  const missingFields = required
    .filter((r) => !params[r.field])
    .map((r) => ({ field: r.field, label: r.label }));

  const warnings = [];
  if (!params.expansionPathDescription && params.decision === DECISION.CONDITIONAL) {
    warnings.push('Bedingte Zusage ohne dokumentierten Ausbaupfad ist nicht revisionssicher');
  }
  if (!params.fnavOption && !params.redispatchOption && params.decision === DECISION.NO_GO) {
    warnings.push(
      'Ablehnung ohne Prüfung von fNAV/Redispatch-Optionen kann regulatorisch anfechtbar sein'
    );
  }

  return {
    complete: missingFields.length === 0,
    missingFields,
    warnings,
  };
}

module.exports = {
  name: 'connection-rejection-evidence',

  settings: {
    dbPath:
      process.env.CONNECTION_REJECTION_EVIDENCE_DB_PATH || './data/connection-rejection-evidence',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['decision'] } });
    this.logger.info(`Connection Rejection Evidence DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/connection-rejection-evidence/packages:
     *   post:
     *     tags: [Connection Rejection Evidence]
     *     summary: Create a revision-safe connection decision evidence package
     *     description: >
     *       Assembles a revision-safe evidence package for a grid connection
     *       decision (GO / CONDITIONAL / NO-GO). Validates completeness and
     *       produces a VDMI-compatible decision tree document.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, applicantReference, loadAssumptionKw, netzverknuepfungspunktId, voltageLevel, bottleneckDescription, n1QualityStatus, decision]
     *             properties:
     *               gridOperatorId: { type: string }
     *               applicantReference: { type: string }
     *               loadAssumptionKw: { type: number }
     *               netzverknuepfungspunktId: { type: string }
     *               voltageLevel: { type: string }
     *               bottleneckDescription: { type: string }
     *               n1QualityStatus: { type: string, enum: [COMPLIANT, NON_COMPLIANT, CONDITIONALLY_COMPLIANT, UNKNOWN] }
     *               expansionPathDescription: { type: string }
     *               fnavOption: { type: object }
     *               redispatchOption: { type: object }
     *               decision: { type: string, enum: [GO, CONDITIONAL, NO_GO, PENDING] }
     *               decisionRationale: { type: string }
     *               conditions: { type: array, items: { type: string } }
     *     responses:
     *       200:
     *         description: Evidence package created
     */
    create: {
      rest: 'POST /packages',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        applicantReference: { type: 'string' },
        loadAssumptionKw: { type: 'number', convert: true },
        netzverknuepfungspunktId: { type: 'string' },
        voltageLevel: { type: 'string' },
        bottleneckDescription: { type: 'string' },
        n1QualityStatus: {
          type: 'enum',
          values: ['COMPLIANT', 'NON_COMPLIANT', 'CONDITIONALLY_COMPLIANT', 'UNKNOWN'],
        },
        decision: { type: 'enum', values: Object.values(DECISION) },
        expansionPathDescription: { type: 'string', optional: true },
        fnavOption: { type: 'object', optional: true },
        redispatchOption: { type: 'object', optional: true },
        decisionRationale: { type: 'string', optional: true },
        conditions: { type: 'array', items: 'string', optional: true, default: [] },
        internalReference: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const packageId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const evidenceCheck = validateEvidenceCompleteness(ctx.params);

        const doc = {
          _id: packageId,
          type: 'connection-rejection-evidence-package',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
          decision: ctx.params.decision,
          evidenceComplete: evidenceCheck.complete,
          evidenceWarnings: evidenceCheck.warnings,
          evidenceMissingFields: evidenceCheck.missingFields,
          applicantReference: ctx.params.applicantReference,
          internalReference: ctx.params.internalReference ?? null,
          decisionTree: {
            loadAssumptionKw: ctx.params.loadAssumptionKw,
            netzverknuepfungspunktId: ctx.params.netzverknuepfungspunktId,
            voltageLevel: ctx.params.voltageLevel,
            bottleneckDescription: ctx.params.bottleneckDescription,
            n1QualityStatus: ctx.params.n1QualityStatus,
            expansionPathDescription: ctx.params.expansionPathDescription ?? null,
            fnavOption: ctx.params.fnavOption ?? null,
            redispatchOption: ctx.params.redispatchOption ?? null,
          },
          decisionRationale: ctx.params.decisionRationale ?? null,
          conditions: ctx.params.conditions,
          auditHash: crypto
            .createHash('sha256')
            .update(
              JSON.stringify({
                gridOperatorId: ctx.params.gridOperatorId,
                applicantReference: ctx.params.applicantReference,
                decision: ctx.params.decision,
                createdAt: nowIso(),
              })
            )
            .digest('hex'),
        };

        await this.db.put(doc);
        this.logger.info(
          `Connection evidence package ${packageId}: decision=${ctx.params.decision}, complete=${evidenceCheck.complete}`
        );

        return {
          packageId,
          decision: doc.decision,
          evidenceComplete: doc.evidenceComplete,
          evidenceWarnings: doc.evidenceWarnings,
          evidenceMissingFields: doc.evidenceMissingFields,
          decisionTree: doc.decisionTree,
          conditions: doc.conditions,
          auditHash: doc.auditHash,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/connection-rejection-evidence/packages:
     *   get:
     *     tags: [Connection Rejection Evidence]
     *     summary: List connection decision evidence packages
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: decision
     *         schema: { type: string, enum: [GO, CONDITIONAL, NO_GO, PENDING] }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of evidence packages
     */
    list: {
      rest: 'GET /packages',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        decision: { type: 'enum', values: Object.values(DECISION), optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, decision, limit } = ctx.params;

        const selector = { tenantId, type: 'connection-rejection-evidence-package' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (decision) selector.decision = decision;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { packages: result.docs };
      },
    },

    /**
     * @openapi
     * /api/connection-rejection-evidence/packages/{id}:
     *   get:
     *     tags: [Connection Rejection Evidence]
     *     summary: Get evidence package by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Evidence package
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /packages/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Package not found', 404, 'PACKAGE_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
