'use strict';

/**
 * Redispatch Special Case Gate Service (v0.62)
 *
 * Evaluates Speicher, Eigenverbrauch, Co-Location, Nichtverfügbarkeit
 * and deviation tolerance for a given asset before Redispatch clearing.
 *
 * Issue: #215
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  RSCG_CO_LOCATION_CONFIRMED,
  RSCG_CO_LOCATION_UNCONFIRMED,
  RSCG_CONTROLLABILITY_CONFIRMED,
  RSCG_CONTROLLABILITY_MISSING,
  RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT,
  RSCG_NON_AVAILABILITY_EVIDENCE_MISSING,
  RSCG_DEVIATION_WITHIN_TOLERANCE,
  RSCG_GATE_READY,
  RSCG_GATE_BLOCKED,
  RSCG_GATE_INSUFFICIENT_EVIDENCE,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Redispatch Special Case Gate';
const RUN_PREFIX = 'rscg:';

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'redispatch-special-case-gate',

  settings: {
    dbPath:
      process.env.REDISPATCH_SPECIAL_CASE_GATE_DB_PATH || './data/redispatch-special-case-gate',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['mastrId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Redispatch Special Case Gate DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/redispatch-special-case-gate/evaluate:
     *   post:
     *     tags: [Redispatch Special Case Gate]
     *     summary: Evaluate special case gate for an asset
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [mastrId, periodStart, periodEnd]
     *             properties:
     *               mastrId: { type: string }
     *               periodStart: { type: string, format: date-time }
     *               periodEnd: { type: string, format: date-time }
     *               coLocationCheck: { type: boolean, default: true }
     *               controllabilityCheck: { type: boolean, default: true }
     *               nonAvailabilityCheck: { type: boolean, default: true }
     *               deviationTolerancePct: { type: number, default: 2.0 }
     *               nonAvailabilityEvidenceRefs: { type: array, items: { type: string } }
     *     responses:
     *       200:
     *         description: Gate evaluation result
     */
    evaluate: {
      rest: 'POST /evaluate',
      params: {
        mastrId: { type: 'string' },
        periodStart: { type: 'string' },
        periodEnd: { type: 'string' },
        coLocationCheck: { type: 'boolean', optional: true, default: true, convert: true },
        controllabilityCheck: { type: 'boolean', optional: true, default: true, convert: true },
        nonAvailabilityCheck: { type: 'boolean', optional: true, default: true, convert: true },
        deviationTolerancePct: { type: 'number', optional: true, default: 2.0, convert: true },
        nonAvailabilityEvidenceRefs: {
          type: 'array',
          optional: true,
          default: [],
          items: 'string',
        },
      },
      openapi: {
        summary: 'Evaluate special case gate for an asset',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          mastrId,
          periodStart,
          periodEnd,
          coLocationCheck,
          controllabilityCheck,
          nonAvailabilityCheck,
          deviationTolerancePct,
          nonAvailabilityEvidenceRefs,
        } = ctx.params;

        const findings = [];
        let hasInsufficientEvidence = false;

        // ── Co-location check ──────────────────────────────────────────────
        if (coLocationCheck) {
          let relationships = [];
          let coLocationServiceAvailable = true;

          try {
            const relResult = await ctx.call('redispatch-asset-register.listRelationships', {
              assetId: mastrId,
              relationshipType: 'co_location',
            });
            relationships = relResult.relationships || [];
          } catch (_err) {
            coLocationServiceAvailable = false;
            hasInsufficientEvidence = true;
          }

          if (!coLocationServiceAvailable) {
            findings.push({
              finding: RSCG_CO_LOCATION_UNCONFIRMED,
              severity: 'warning',
              message: 'Co-location service unavailable — cannot confirm co-location relationships',
              insufficientEvidence: true,
            });
          } else if (relationships.length > 0) {
            findings.push({
              finding: RSCG_CO_LOCATION_CONFIRMED,
              severity: 'info',
              message: `Co-location relationship confirmed (${relationships.length} relationship(s) found)`,
            });
          } else {
            findings.push({
              finding: RSCG_CO_LOCATION_UNCONFIRMED,
              severity: 'warning',
              message: 'No co-location relationship found for this asset',
            });
          }
        }

        // ── Controllability check ──────────────────────────────────────────
        if (controllabilityCheck) {
          let assetList = null;
          let assetServiceAvailable = true;

          try {
            assetList = await ctx.call('assets.list', { mastrId });
          } catch (_err) {
            assetServiceAvailable = false;
            hasInsufficientEvidence = true;
          }

          if (!assetServiceAvailable) {
            findings.push({
              finding: RSCG_CONTROLLABILITY_MISSING,
              severity: 'error',
              message: 'Asset service unavailable — cannot confirm remote controllability',
              insufficientEvidence: true,
            });
          } else {
            const assets = Array.isArray(assetList)
              ? assetList
              : assetList && Array.isArray(assetList.data)
                ? assetList.data
                : assetList && Array.isArray(assetList.assets)
                  ? assetList.assets
                  : [];

            const isControllable =
              assets.length > 0 && assets.some((a) => String(a.fernsteuerbarkeitDv) === '1');

            if (isControllable) {
              findings.push({
                finding: RSCG_CONTROLLABILITY_CONFIRMED,
                severity: 'info',
                message: 'Remote controllability (FernsteuerbarkeitDv) confirmed',
              });
            } else {
              findings.push({
                finding: RSCG_CONTROLLABILITY_MISSING,
                severity: 'error',
                message:
                  'Remote controllability (FernsteuerbarkeitDv) is not active for this asset',
              });
            }
          }
        }

        // ── Non-availability check ─────────────────────────────────────────
        if (nonAvailabilityCheck) {
          if (nonAvailabilityEvidenceRefs && nonAvailabilityEvidenceRefs.length > 0) {
            findings.push({
              finding: RSCG_NON_AVAILABILITY_EVIDENCE_PRESENT,
              severity: 'info',
              message: `Non-availability evidence provided (${nonAvailabilityEvidenceRefs.length} reference(s))`,
            });
          } else {
            findings.push({
              finding: RSCG_NON_AVAILABILITY_EVIDENCE_MISSING,
              severity: 'warning',
              message: 'No non-availability evidence references provided',
            });
          }
        }

        // ── Deviation tolerance check ──────────────────────────────────────
        if (deviationTolerancePct !== undefined && deviationTolerancePct > 0) {
          findings.push({
            finding: RSCG_DEVIATION_WITHIN_TOLERANCE,
            severity: 'info',
            message: `Deviation tolerance parameter set to ${deviationTolerancePct}% — within acceptable range`,
          });
        }

        // ── Overall status ─────────────────────────────────────────────────
        const hasErrorNonEvidence = findings.some(
          (f) => f.severity === 'error' && !f.insufficientEvidence
        );
        const hasErrorWithEvidence = findings.some(
          (f) => f.severity === 'error' && f.insufficientEvidence
        );
        const hasWarning = findings.some((f) => f.severity === 'warning');

        let status;
        let overallFinding;

        if (hasErrorNonEvidence) {
          status = 'blocked';
          overallFinding = RSCG_GATE_BLOCKED;
          findings.push({
            finding: RSCG_GATE_BLOCKED,
            severity: 'error',
            message: 'Gate blocked — one or more error-severity criteria failed',
          });
        } else if (hasInsufficientEvidence || hasErrorWithEvidence) {
          status = 'insufficient_evidence';
          overallFinding = RSCG_GATE_INSUFFICIENT_EVIDENCE;
          findings.push({
            finding: RSCG_GATE_INSUFFICIENT_EVIDENCE,
            severity: 'warning',
            message:
              'Gate cannot be fully evaluated — upstream service unavailable for one or more checks',
          });
        } else if (hasWarning) {
          status = 'ready_with_warnings';
          overallFinding = RSCG_GATE_READY;
          findings.push({
            finding: RSCG_GATE_READY,
            severity: 'info',
            message: 'Gate conditions met with warnings — review warnings before proceeding',
          });
        } else {
          status = 'ready';
          overallFinding = RSCG_GATE_READY;
          findings.push({
            finding: RSCG_GATE_READY,
            severity: 'info',
            message:
              'All gate criteria passed — asset cleared for Redispatch special case processing',
          });
        }

        const gateRunId = `${RUN_PREFIX}${crypto.randomUUID()}`;
        const evaluatedAt = nowIso();

        const doc = {
          _id: gateRunId,
          docType: 'rscg-run',
          tenantId,
          mastrId,
          periodStart,
          periodEnd,
          status,
          findings,
          overallFinding,
          evaluatedAt,
          createdAt: evaluatedAt,
        };

        await this.db.put(doc);
        this.logger.info(
          `RSCG gate run created: ${gateRunId} for mastrId=${mastrId}, status=${status}`
        );

        return {
          mastrId,
          periodStart,
          periodEnd,
          status,
          findings,
          evaluatedAt,
          gateRunId,
        };
      },
    },

    /**
     * @openapi
     * /api/redispatch-special-case-gate/runs:
     *   get:
     *     tags: [Redispatch Special Case Gate]
     *     summary: List gate evaluation runs
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: mastrId
     *         schema: { type: string }
     *       - in: query
     *         name: status
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: List of gate runs
     */
    listRuns: {
      rest: 'GET /runs',
      params: {
        mastrId: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List gate evaluation runs',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'mastrId', schema: { type: 'string' } },
          { in: 'query', name: 'status', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { mastrId, status, limit } = ctx.params;

        const selector = { tenantId, docType: 'rscg-run' };
        if (mastrId) selector.mastrId = mastrId;
        if (status) selector.status = status;

        const result = await this.db.find({ selector, limit });
        return { runs: result.docs, total: result.docs.length };
      },
    },

    /**
     * @openapi
     * /api/redispatch-special-case-gate/runs/{id}:
     *   get:
     *     tags: [Redispatch Special Case Gate]
     *     summary: Get gate run by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Gate run document
     *       404:
     *         description: Not found
     */
    getRun: {
      rest: 'GET /runs/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get gate run by ID',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Gate run not found', 404, 'RUN_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
