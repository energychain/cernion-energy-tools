'use strict';

/**
 * Redispatch Asset Register Service (v0.62)
 *
 * Asset projection layer over MaStR data with deterministic identifier-conflict
 * and market-location findings. Relationship API for co-location, shared-NAP,
 * shared-metering, and control-group associations.
 *
 * Issues: #215, #216
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const {
  RDAR_RESOURCE_MAPPING_MISSING,
  RDAR_MARKET_LOCATION_MISSING,
  RDAR_CONTROL_GROUP_AMBIGUOUS,
  RDAR_ASSET_PROJECTION_COMPLETE,
} = require('../src/validation-findings');

const OPENAPI_TAG = 'Redispatch Asset Register';
const PROJECTION_PREFIX = 'rdar-proj:';
const RELATIONSHIP_PREFIX = 'rdar-rel:';

const RELATIONSHIP_TYPES = ['co_location', 'shared_nap', 'shared_metering', 'control_group_member'];

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'redispatch-asset-register',

  settings: {
    dbPath: process.env.REDISPATCH_ASSET_REGISTER_DB_PATH || './data/redispatch-asset-register',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['mastrId'] } });
    await this.db.createIndex({ index: { fields: ['assetIdA'] } });
    await this.db.createIndex({ index: { fields: ['assetIdB'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Redispatch Asset Register DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    // ── Projections ───────────────────────────────────────────────────────

    /**
     * @openapi
     * /api/redispatch-asset-register/projections:
     *   post:
     *     tags: [Redispatch Asset Register]
     *     summary: Create an asset projection with deterministic finding checks
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [mastrId]
     *             properties:
     *               mastrId: { type: string }
     *               technicalResourceId: { type: string }
     *               controllableResourceId: { type: string }
     *               maloId: { type: string }
     *               meloId: { type: string }
     *               operatorEvidenceRef: { type: string }
     *               energyCarrier: { type: string }
     *               capacityKw: { type: number }
     *               sourceArtifactRefs: { type: array, items: { type: string } }
     *     responses:
     *       200:
     *         description: Asset projection with findings
     */
    createProjection: {
      rest: 'POST /projections',
      params: {
        mastrId: { type: 'string' },
        technicalResourceId: { type: 'string', optional: true },
        controllableResourceId: { type: 'string', optional: true },
        maloId: { type: 'string', optional: true },
        meloId: { type: 'string', optional: true },
        operatorEvidenceRef: { type: 'string', optional: true },
        energyCarrier: { type: 'string', optional: true },
        capacityKw: { type: 'number', optional: true, convert: true },
        sourceArtifactRefs: { type: 'array', optional: true, default: [], items: 'string' },
      },
      openapi: {
        summary: 'Create an asset projection with deterministic finding checks',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          mastrId,
          technicalResourceId,
          controllableResourceId,
          maloId,
          meloId,
          operatorEvidenceRef,
          energyCarrier,
          capacityKw,
          sourceArtifactRefs,
        } = ctx.params;

        const findings = [];

        // Deterministic finding checks
        if (!technicalResourceId) {
          findings.push({
            finding: RDAR_RESOURCE_MAPPING_MISSING,
            severity: 'warning',
            message: 'No technical resource ID (BTR) mapping found for this MaStR unit',
          });
        }

        if (!maloId && !meloId) {
          findings.push({
            finding: RDAR_MARKET_LOCATION_MISSING,
            severity: 'error',
            message: 'Neither MaLo (maloId) nor MeLo (meloId) is assigned to this asset',
          });
        }

        if (!operatorEvidenceRef) {
          findings.push({
            finding: RDAR_CONTROL_GROUP_AMBIGUOUS,
            severity: 'warning',
            message:
              'Control group assignment cannot be determined without operator evidence reference',
          });
        }

        const hasConflict = findings.some((f) => f.severity === 'error');

        if (findings.length === 0) {
          findings.push({
            finding: RDAR_ASSET_PROJECTION_COMPLETE,
            severity: 'info',
            message: 'Asset projection is complete — all required identifiers and evidence present',
          });
        }

        const projectionId = `${PROJECTION_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: projectionId,
          docType: 'rdar-projection',
          tenantId,
          mastrId,
          technicalResourceId: technicalResourceId || null,
          controllableResourceId: controllableResourceId || null,
          maloId: maloId || null,
          meloId: meloId || null,
          operatorEvidenceRef: operatorEvidenceRef || null,
          energyCarrier: energyCarrier || null,
          capacityKw: capacityKw !== undefined ? capacityKw : null,
          sourceArtifactRefs,
          findings,
          hasConflict,
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(`RDAR projection created: ${projectionId} for mastrId=${mastrId}`);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/redispatch-asset-register/projections:
     *   get:
     *     tags: [Redispatch Asset Register]
     *     summary: List asset projections
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: mastrId
     *         schema: { type: string }
     *       - in: query
     *         name: hasConflict
     *         schema: { type: boolean }
     *     responses:
     *       200:
     *         description: List of projections
     */
    listProjections: {
      rest: 'GET /projections',
      params: {
        mastrId: { type: 'string', optional: true },
        hasConflict: { type: 'boolean', optional: true, convert: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List asset projections',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'mastrId', schema: { type: 'string' } },
          { in: 'query', name: 'hasConflict', schema: { type: 'boolean' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { mastrId, hasConflict, limit } = ctx.params;

        const selector = { tenantId, docType: 'rdar-projection' };
        if (mastrId) selector.mastrId = mastrId;
        if (hasConflict !== undefined) selector.hasConflict = hasConflict;

        const result = await this.db.find({ selector, limit });
        return { projections: result.docs };
      },
    },

    /**
     * @openapi
     * /api/redispatch-asset-register/projections/{id}:
     *   get:
     *     tags: [Redispatch Asset Register]
     *     summary: Get asset projection by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Projection document
     *       404:
     *         description: Not found
     */
    getProjection: {
      rest: 'GET /projections/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get asset projection by ID',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Projection not found', 404, 'PROJECTION_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    // ── Relationships ─────────────────────────────────────────────────────

    /**
     * @openapi
     * /api/redispatch-asset-register/relationships:
     *   post:
     *     tags: [Redispatch Asset Register]
     *     summary: Create an asset relationship
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [assetIdA, assetIdB, relationshipType]
     *             properties:
     *               assetIdA: { type: string }
     *               assetIdB: { type: string }
     *               relationshipType:
     *                 type: string
     *                 enum: [co_location, shared_nap, shared_metering, control_group_member]
     *               evidenceRefs: { type: array, items: { type: string } }
     *               notes: { type: string }
     *     responses:
     *       200:
     *         description: Created relationship
     */
    createRelationship: {
      rest: 'POST /relationships',
      params: {
        assetIdA: { type: 'string' },
        assetIdB: { type: 'string' },
        relationshipType: { type: 'enum', values: RELATIONSHIP_TYPES },
        evidenceRefs: { type: 'array', optional: true, default: [], items: 'string' },
        notes: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Create an asset relationship',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { assetIdA, assetIdB, relationshipType, evidenceRefs, notes } = ctx.params;

        const relId = `${RELATIONSHIP_PREFIX}${crypto.randomUUID()}`;
        const doc = {
          _id: relId,
          docType: 'rdar-relationship',
          tenantId,
          assetIdA,
          assetIdB,
          relationshipType,
          evidenceRefs,
          notes: notes || null,
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(
          `RDAR relationship created: ${relId} (${assetIdA} <-> ${assetIdB}, type=${relationshipType})`
        );
        return doc;
      },
    },

    /**
     * @openapi
     * /api/redispatch-asset-register/relationships:
     *   get:
     *     tags: [Redispatch Asset Register]
     *     summary: List asset relationships
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: assetId
     *         schema: { type: string }
     *       - in: query
     *         name: relationshipType
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: List of relationships
     */
    listRelationships: {
      rest: 'GET /relationships',
      params: {
        assetId: { type: 'string', optional: true },
        relationshipType: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'List asset relationships',
        tags: [OPENAPI_TAG],

        parameters: [
          { in: 'query', name: 'assetId', schema: { type: 'string' } },
          { in: 'query', name: 'relationshipType', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'number' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { assetId, relationshipType, limit } = ctx.params;

        const selector = { tenantId, docType: 'rdar-relationship' };
        if (relationshipType) selector.relationshipType = relationshipType;

        const result = await this.db.find({ selector, limit: limit * 2 });

        let docs = result.docs;
        if (assetId) {
          docs = docs.filter((d) => d.assetIdA === assetId || d.assetIdB === assetId);
        }
        // Respect limit after filtering
        if (docs.length > limit) {
          docs = docs.slice(0, limit);
        }

        return { relationships: docs };
      },
    },

    /**
     * @openapi
     * /api/redispatch-asset-register/relationships/{id}:
     *   get:
     *     tags: [Redispatch Asset Register]
     *     summary: Get relationship by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Relationship document
     *       404:
     *         description: Not found
     */
    getRelationship: {
      rest: 'GET /relationships/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get relationship by ID',
        tags: [OPENAPI_TAG],

        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Relationship not found', 404, 'RELATIONSHIP_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    /**
     * @openapi
     * /api/redispatch-asset-register/relationships/{id}:
     *   delete:
     *     tags: [Redispatch Asset Register]
     *     summary: Delete relationship by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Deleted
     *       404:
     *         description: Not found
     */
    deleteRelationship: {
      rest: 'DELETE /relationships/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Delete relationship by ID',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Relationship not found', 404, 'RELATIONSHIP_NOT_FOUND');
          }
          throw err;
        }
        await this.db.remove(doc);
        return { success: true, id: ctx.params.id };
      },
    },
  },
};
