'use strict';

/**
 * Reporting Governance Service — VNB-Steuerungsberichte
 *
 * Issue #123 — Reporting-Governance für VNB-Steuerungsberichte
 *
 * Many DSOs generate commercial grid, budget, and efficiency reports from
 * fragile Excel, folder-path, or unordered BI sources. This makes Power BI
 * reports unstable, permissions unclear, and management decisions hard to
 * audit.
 *
 * This service provides a Reporting Governance Check covering:
 *   1. Data source inventory (which sources feed which reports)
 *   2. Object-ID-capable intermediate standards (stable identifiers)
 *   3. Permission / owner matrix (who owns and who reads what)
 *   4. Target picture for Fabric/OneLake or comparable data product governance
 *   5. Maturity score per data source / report
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'Reporting Governance';
const DOC_PREFIX = 'rg:';

// Maturity levels for data sources
const SOURCE_MATURITY = Object.freeze({
  AD_HOC: 'AD_HOC', // manual, fragile, no versioning
  STRUCTURED: 'STRUCTURED', // structured but manually maintained
  GOVERNED: 'GOVERNED', // source-of-record with owner and SLA
  AUTOMATED: 'AUTOMATED', // fully automated pipeline with tests
});

// Risk scores per maturity level (higher = more risk)
const MATURITY_RISK = {
  [SOURCE_MATURITY.AD_HOC]: 4,
  [SOURCE_MATURITY.STRUCTURED]: 3,
  [SOURCE_MATURITY.GOVERNED]: 1,
  [SOURCE_MATURITY.AUTOMATED]: 0,
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * Assess a single data source for governance maturity.
 */
function assessDataSource(source) {
  const maturity = source.maturity ?? SOURCE_MATURITY.AD_HOC;
  const riskScore = MATURITY_RISK[maturity] ?? 4;

  const gaps = [];
  if (!source.ownerId) {
    gaps.push({ field: 'ownerId', label: 'Kein Datenquelle-Owner definiert' });
  }
  if (!source.updateFrequency) {
    gaps.push({ field: 'updateFrequency', label: 'Aktualisierungsfrequenz nicht dokumentiert' });
  }
  if (!source.hasObjectId) {
    gaps.push({ field: 'hasObjectId', label: 'Keine objekt-ID-fähige Identifikation vorhanden' });
  }
  if (!source.accessPermissionsDocumented) {
    gaps.push({ field: 'accessPermissionsDocumented', label: 'Berechtigungen nicht dokumentiert' });
  }
  if (maturity === SOURCE_MATURITY.AD_HOC || maturity === SOURCE_MATURITY.STRUCTURED) {
    gaps.push({
      field: 'targetMigration',
      label: `Migration zu ${SOURCE_MATURITY.GOVERNED} oder ${SOURCE_MATURITY.AUTOMATED} empfohlen`,
    });
  }

  return {
    sourceId: source.sourceId,
    sourceLabel: source.sourceLabel ?? source.sourceId,
    maturity,
    riskScore,
    gaps,
    governanceReadiness: gaps.length === 0 ? 'READY' : riskScore >= 3 ? 'HIGH_RISK' : 'PARTIAL',
  };
}

/**
 * Compute overall governance score (0–100, 100 = fully governed).
 */
function computeGovernanceScore(assessedSources) {
  if (assessedSources.length === 0) return 0;
  const maxRisk = 4;
  const avgRisk = assessedSources.reduce((s, a) => s + a.riskScore, 0) / assessedSources.length;
  return Math.round(((maxRisk - avgRisk) / maxRisk) * 100);
}

module.exports = {
  name: 'reporting-governance',

  settings: {
    dbPath: process.env.REPORTING_GOVERNANCE_DB_PATH || './data/reporting-governance',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Reporting Governance DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/reporting-governance/checks:
     *   post:
     *     tags: [Reporting Governance]
     *     summary: Run a reporting governance check for a grid operator
     *     description: >
     *       Assesses all data sources feeding management reports. Returns maturity
     *       scores, permission gaps, and a target picture for data product governance.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, dataSources]
     *             properties:
     *               gridOperatorId: { type: string }
     *               dataSources:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [sourceId]
     *                   properties:
     *                     sourceId: { type: string }
     *                     sourceLabel: { type: string }
     *                     maturity:
     *                       type: string
     *                       enum: [AD_HOC, STRUCTURED, GOVERNED, AUTOMATED]
     *                     ownerId: { type: string }
     *                     updateFrequency: { type: string }
     *                     hasObjectId: { type: boolean }
     *                     accessPermissionsDocumented: { type: boolean }
     *                     reportsUsing: { type: array, items: { type: string } }
     *               reportPermissionMatrix:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     reportId: { type: string }
     *                     ownerId: { type: string }
     *                     readAccess: { type: array, items: { type: string } }
     *     responses:
     *       200:
     *         description: Governance check result
     */
    check: {
      rest: 'POST /checks',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        dataSources: { type: 'array', items: 'object', min: 1 },
        reportPermissionMatrix: { type: 'array', items: 'object', optional: true, default: [] },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, dataSources, reportPermissionMatrix, label } = ctx.params;
        const checkId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const assessedSources = dataSources.map(assessDataSource);
        const governanceScore = computeGovernanceScore(assessedSources);

        // Permission matrix analysis
        const reportsWithoutOwner = reportPermissionMatrix.filter((r) => !r.ownerId).length;
        const reportsWithoutReadAccess = reportPermissionMatrix.filter(
          (r) => !r.readAccess || r.readAccess.length === 0
        ).length;

        const highRiskSources = assessedSources.filter((s) => s.riskScore >= 3);
        const totalGaps = assessedSources.reduce((sum, s) => sum + s.gaps.length, 0);

        const targetPicture = {
          recommendedArchitecture:
            governanceScore >= 75
              ? 'FABRIC_ONELAKE_READY'
              : governanceScore >= 50
                ? 'INTERMEDIATE_GOVERNANCE_NEEDED'
                : 'FOUNDATIONAL_GOVERNANCE_REQUIRED',
          priorityActions: highRiskSources.slice(0, 3).map((s) => ({
            sourceId: s.sourceId,
            action: `Migration von ${s.maturity} → ${SOURCE_MATURITY.GOVERNED} starten`,
            impact: 'HIGH',
          })),
          permissionActions:
            reportsWithoutOwner > 0
              ? [`${reportsWithoutOwner} Berichte ohne Owner — sofortige Zuweisung erforderlich`]
              : [],
        };

        const doc = {
          _id: checkId,
          type: 'reporting-governance-check',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          createdAt: nowIso(),
          governanceScore,
          summary: {
            sourceCount: dataSources.length,
            highRiskSourceCount: highRiskSources.length,
            totalGaps,
            reportCount: reportPermissionMatrix.length,
            reportsWithoutOwner,
            reportsWithoutReadAccess,
          },
          assessedSources,
          reportPermissionMatrix,
          targetPicture,
        };

        await this.db.put(doc);
        this.logger.info(
          `Reporting governance check ${checkId}: score=${governanceScore}, highRisk=${highRiskSources.length}`
        );

        return {
          checkId,
          governanceScore,
          summary: doc.summary,
          assessedSources,
          targetPicture,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/reporting-governance/checks:
     *   get:
     *     tags: [Reporting Governance]
     *     summary: List reporting governance checks
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
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
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = { tenantId, type: 'reporting-governance-check' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { checks: result.docs };
      },
    },

    /**
     * @openapi
     * /api/reporting-governance/checks/{id}:
     *   get:
     *     tags: [Reporting Governance]
     *     summary: Get governance check by ID
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
