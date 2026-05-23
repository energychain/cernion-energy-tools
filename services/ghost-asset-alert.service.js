'use strict';

/**
 * Ghost Asset Alert Service
 *
 * Issue #103 — Gemarkungs-Heuristik zur Identifikation von Geister-Anlagen
 *
 * Checks MaStR geo-coordinates of EEG installations against the grid operator's
 * registered network polygons. Installations whose coordinates fall outside the
 * operator's declared network territory are flagged as potential "ghost assets"
 * — assets the operator is paying EEG remuneration for but that are physically
 * connected to another operator's grid.
 *
 * Findings are stored as persistent alerts and can be forwarded to the EDM
 * pipeline as action items.
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'Ghost Asset Alert';
const DOC_PREFIX = 'gaa:';

/** Maximum allowed distance in km before an asset is flagged as suspicious */
const DEFAULT_DISTANCE_THRESHOLD_KM = 2.0;
/** Confidence below which a geo check result is considered unreliable */
const DEFAULT_MIN_GEO_CONFIDENCE = 0.6;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Haversine distance between two WGS-84 coordinate pairs in kilometres.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Point-in-polygon test using the ray-casting algorithm.
 * polygon: array of [lat, lon] pairs forming a closed ring.
 */
function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Evaluate a single installation against a set of network polygons.
 * Returns { status, distanceKm, containingPolygon, confidence }
 */
function evaluateInstallationGeo(installation, networkPolygons, thresholdKm) {
  const lat = installation.lat ?? installation.latitude;
  const lon = installation.lon ?? installation.longitude;

  if (lat == null || lon == null) {
    return { status: 'NO_COORDINATES', distanceKm: null, confidence: 0 };
  }

  // Check direct containment first
  for (const polygon of networkPolygons) {
    if (pointInPolygon(lat, lon, polygon.coordinates)) {
      return {
        status: 'IN_TERRITORY',
        distanceKm: 0,
        containingPolygon: polygon.id,
        confidence: 1.0,
      };
    }
  }

  // Find nearest polygon boundary point (centroid approximation)
  let minDist = Infinity;
  let nearestPolygon = null;
  for (const polygon of networkPolygons) {
    const coords = polygon.coordinates;
    for (const [pLat, pLon] of coords) {
      const d = haversineKm(lat, lon, pLat, pLon);
      if (d < minDist) {
        minDist = d;
        nearestPolygon = polygon.id;
      }
    }
  }

  if (minDist <= thresholdKm) {
    return {
      status: 'BOUNDARY_PROXIMITY',
      distanceKm: minDist,
      nearestPolygon,
      confidence: Math.max(0, 1 - minDist / thresholdKm),
    };
  }

  return {
    status: 'OUTSIDE_TERRITORY',
    distanceKm: minDist,
    nearestPolygon,
    confidence: 1.0,
  };
}

module.exports = {
  name: 'ghost-asset-alert',

  settings: {
    dbPath: process.env.GHOST_ASSET_ALERT_DB_PATH || './data/ghost-asset-alert',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    this.logger.info(`Ghost Asset Alert DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/ghost-asset-alert/scans:
     *   post:
     *     tags: [Ghost Asset Alert]
     *     summary: Run ghost-asset geo scan for a grid operator
     *     description: >
     *       Checks MaStR geo-coordinates of EEG installations associated with a
     *       grid operator against the provided network polygons. Installations
     *       whose coordinates fall outside the operator's territory are flagged
     *       as "ghost assets".
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, installations, networkPolygons]
     *             properties:
     *               gridOperatorId:
     *                 type: string
     *               installations:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     mastrNummer: { type: string }
     *                     lat: { type: number }
     *                     lon: { type: number }
     *                     kapazitaetKw: { type: number }
     *                     eegVergaetungCentPerKwh: { type: number }
     *               networkPolygons:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     id: { type: string }
     *                     coordinates:
     *                       type: array
     *                       items:
     *                         type: array
     *                         items: { type: number }
     *               distanceThresholdKm:
     *                 type: number
     *                 default: 2.0
     *               minGeoConfidence:
     *                 type: number
     *                 default: 0.6
     *     responses:
     *       200:
     *         description: Scan result with ghost asset findings
     */
    scan: {
      rest: 'POST /scans',
      timeout: 60_000,
      params: {
        gridOperatorId: { type: 'string' },
        installations: { type: 'array', items: 'object', min: 1 },
        networkPolygons: { type: 'array', items: 'object', min: 0 },
        distanceThresholdKm: {
          type: 'number',
          optional: true,
          default: DEFAULT_DISTANCE_THRESHOLD_KM,
          min: 0.1,
          max: 50,
          convert: true,
        },
        minGeoConfidence: {
          type: 'number',
          optional: true,
          default: DEFAULT_MIN_GEO_CONFIDENCE,
          min: 0,
          max: 1,
          convert: true,
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const {
          gridOperatorId,
          installations,
          networkPolygons,
          distanceThresholdKm,
          minGeoConfidence,
        } = ctx.params;

        const scanId = `${DOC_PREFIX}${crypto.randomUUID()}`;
        const findings = [];
        let checkedCount = 0;
        let noCoordinatesCount = 0;
        let ghostCount = 0;
        let boundaryCount = 0;

        for (const inst of installations) {
          const result = evaluateInstallationGeo(inst, networkPolygons, distanceThresholdKm);
          checkedCount++;

          if (result.status === 'NO_COORDINATES') {
            noCoordinatesCount++;
            continue;
          }

          if (
            result.status === 'OUTSIDE_TERRITORY' ||
            (result.status === 'BOUNDARY_PROXIMITY' && result.confidence < minGeoConfidence)
          ) {
            ghostCount++;
            findings.push({
              findingCode: 'GHOST_ASSET_SUSPECTED',
              mastrNummer: inst.mastrNummer,
              lat: inst.lat ?? inst.latitude,
              lon: inst.lon ?? inst.longitude,
              kapazitaetKw: inst.kapazitaetKw,
              eegVergaetungCentPerKwh: inst.eegVergaetungCentPerKwh,
              distanceKm: result.distanceKm,
              nearestPolygon: result.nearestPolygon,
              confidence: result.confidence,
              status: result.status,
              severity: result.distanceKm > 10 ? 'HIGH' : 'MEDIUM',
              actionRequired: 'VERIFY_PHYSICAL_CONNECTION_POINT',
            });
          } else if (result.status === 'BOUNDARY_PROXIMITY') {
            boundaryCount++;
            findings.push({
              findingCode: 'GHOST_ASSET_BOUNDARY_AMBIGUOUS',
              mastrNummer: inst.mastrNummer,
              lat: inst.lat ?? inst.latitude,
              lon: inst.lon ?? inst.longitude,
              kapazitaetKw: inst.kapazitaetKw,
              distanceKm: result.distanceKm,
              nearestPolygon: result.nearestPolygon,
              confidence: result.confidence,
              status: result.status,
              severity: 'LOW',
              actionRequired: 'MANUAL_BOUNDARY_CHECK',
            });
          }
        }

        const doc = {
          _id: scanId,
          type: 'ghost-asset-scan',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
          status: 'COMPLETED',
          summary: {
            totalInstallations: installations.length,
            checkedCount,
            noCoordinatesCount,
            inTerritoryCount: checkedCount - ghostCount - boundaryCount - noCoordinatesCount,
            boundaryCount,
            ghostCount,
          },
          findings,
          params: { distanceThresholdKm, minGeoConfidence },
        };

        await this.db.put(doc);
        this.logger.info(
          `Ghost asset scan ${scanId}: ${ghostCount} ghost assets found in ${checkedCount} installations`
        );

        return {
          scanId,
          gridOperatorId,
          summary: doc.summary,
          findings,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/ghost-asset-alert/scans:
     *   get:
     *     tags: [Ghost Asset Alert]
     *     summary: List ghost-asset scans
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
     *         description: List of scans
     */
    list: {
      rest: 'GET /scans',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = { tenantId, type: 'ghost-asset-scan' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { scans: result.docs };
      },
    },

    /**
     * @openapi
     * /api/ghost-asset-alert/scans/{id}:
     *   get:
     *     tags: [Ghost Asset Alert]
     *     summary: Get a specific ghost-asset scan
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Scan document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /scans/:id',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(ctx.params.id);
          return doc;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Scan not found', 404, 'SCAN_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    /**
     * @openapi
     * /api/ghost-asset-alert/scans/{id}/edm-actions:
     *   post:
     *     tags: [Ghost Asset Alert]
     *     summary: Forward ghost asset findings to EDM as action items
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: EDM action items created
     *       404:
     *         description: Scan not found
     */
    forwardToEdm: {
      rest: 'POST /scans/:id/edm-actions',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        let doc;
        try {
          doc = await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Scan not found', 404, 'SCAN_NOT_FOUND');
          }
          throw err;
        }

        const ghostFindings = doc.findings.filter((f) => f.findingCode === 'GHOST_ASSET_SUSPECTED');

        // Emit action items — downstream EDM service picks these up via events
        const actionItems = ghostFindings.map((f) => ({
          actionItemId: `gaa-action-${crypto.randomUUID()}`,
          source: 'ghost-asset-alert',
          scanId: doc._id,
          mastrNummer: f.mastrNummer,
          findingCode: f.findingCode,
          severity: f.severity,
          actionRequired: f.actionRequired,
          distanceKm: f.distanceKm,
          createdAt: nowIso(),
        }));

        ctx.emit('ghost-asset-alert.edmActionsRequested', {
          scanId: doc._id,
          gridOperatorId: doc.gridOperatorId,
          actionItems,
        });

        // Persist forwarding record
        await this.db.put({
          ...doc,
          edmForwardedAt: nowIso(),
          edmActionItemCount: actionItems.length,
        });

        return { actionItemCount: actionItems.length, actionItems };
      },
    },
  },
};
