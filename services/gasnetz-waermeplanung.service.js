'use strict';

/**
 * Gasnetz Wärmeplanung Service — Gas Network vs. Municipal Heat Planning
 *
 * Issue #115 — Gasnetz-/Wärmeplanungsabgleich
 *
 * §14 EnWG and the German Wärmeplanungsgesetz (WPG) require DSOs and municipalities
 * to align gas network asset planning with municipal heat development plans. In
 * practice, gas infrastructure GIS data lives in operations, heat planning maps
 * live in urban planning offices, and no systematic reconciliation tooling exists.
 *
 * This service provides:
 *   1. Gas network asset registry with segment / pressure level / age metadata
 *   2. Heat planning area registry (Fernwärmevorranggebiet, dezentrale Wärme, etc.)
 *   3. Overlap analysis → stranded asset risk classification
 *   4. TOTEX optimisation signals (when does gas network investment conflict with heat plan?)
 *   5. Decommissioning timeline recommendations per segment
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const DOC_PREFIX = 'gwp:';

const HEAT_ZONE_TYPE = Object.freeze({
  DISTRICT_HEATING_PRIORITY: 'DISTRICT_HEATING_PRIORITY', // Fernwärmevorranggebiet
  DECENTRALISED_RENEWABLE: 'DECENTRALISED_RENEWABLE', // dezentrale erneuerbare Wärme
  BUILDING_RENOVATION: 'BUILDING_RENOVATION', // Sanierungsgebiet — demand reduction expected
  HYDROGEN_READY: 'HYDROGEN_READY', // potential H2 conversion area
  UNCLASSIFIED: 'UNCLASSIFIED',
});

const STRANDED_RISK = Object.freeze({
  HIGH: 'HIGH', // gas investment in district heating priority zone
  MEDIUM: 'MEDIUM', // overlaps with decentralised renewable zone
  LOW: 'LOW', // hydrogen-ready or minimal overlap
  NONE: 'NONE', // no heat planning conflict
});

const DECOMMISSION_HORIZON = Object.freeze({
  BEFORE_2030: 'BEFORE_2030',
  BEFORE_2035: 'BEFORE_2035',
  BEFORE_2040: 'BEFORE_2040',
  BEYOND_2040: 'BEYOND_2040',
  NOT_RECOMMENDED: 'NOT_RECOMMENDED', // H2-ready, keep
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Assess stranded asset risk for a gas segment given its overlapping heat zones.
 */
function assessSegmentRisk(segment, heatZones) {
  const overlappingZones = heatZones.filter((z) =>
    (segment.coverageAreaIds ?? []).includes(z.zoneId)
  );

  const zoneTypes = overlappingZones.map((z) => z.zoneType);

  let strandedRisk = STRANDED_RISK.NONE;
  let horizon = DECOMMISSION_HORIZON.BEYOND_2040;
  const conflictingZones = [];
  const supportingZones = [];

  for (const zone of overlappingZones) {
    if (zone.zoneType === HEAT_ZONE_TYPE.DISTRICT_HEATING_PRIORITY) {
      strandedRisk = STRANDED_RISK.HIGH;
      horizon = DECOMMISSION_HORIZON.BEFORE_2035;
      conflictingZones.push(zone.zoneId);
    } else if (
      zone.zoneType === HEAT_ZONE_TYPE.DECENTRALISED_RENEWABLE &&
      strandedRisk !== STRANDED_RISK.HIGH
    ) {
      strandedRisk = STRANDED_RISK.MEDIUM;
      if (horizon === DECOMMISSION_HORIZON.BEYOND_2040) horizon = DECOMMISSION_HORIZON.BEFORE_2040;
      conflictingZones.push(zone.zoneId);
    } else if (zone.zoneType === HEAT_ZONE_TYPE.HYDROGEN_READY) {
      supportingZones.push(zone.zoneId);
      horizon = DECOMMISSION_HORIZON.NOT_RECOMMENDED;
    } else if (zone.zoneType === HEAT_ZONE_TYPE.BUILDING_RENOVATION) {
      if (strandedRisk === STRANDED_RISK.NONE) strandedRisk = STRANDED_RISK.LOW;
    }
  }

  // Override: H2-ready removes decommission risk unless district heating
  if (
    supportingZones.length > 0 &&
    strandedRisk !== STRANDED_RISK.HIGH &&
    strandedRisk !== STRANDED_RISK.MEDIUM
  ) {
    strandedRisk = STRANDED_RISK.NONE;
    horizon = DECOMMISSION_HORIZON.NOT_RECOMMENDED;
  }

  const investmentAllowed =
    strandedRisk === STRANDED_RISK.NONE ||
    (strandedRisk === STRANDED_RISK.LOW && segment.remainingLifeYears > 10);

  return {
    segmentId: segment.segmentId,
    strandedRisk,
    decommissionHorizon: horizon,
    overlappingZoneCount: overlappingZones.length,
    conflictingZones,
    supportingZones,
    overlappingZoneTypes: [...new Set(zoneTypes)],
    investmentAllowed,
    totexSignal:
      strandedRisk === STRANDED_RISK.HIGH
        ? 'HALT_NEW_INVESTMENT'
        : strandedRisk === STRANDED_RISK.MEDIUM
          ? 'DEFER_INVESTMENT_PENDING_CLARIFICATION'
          : strandedRisk === STRANDED_RISK.NONE && horizon === DECOMMISSION_HORIZON.NOT_RECOMMENDED
            ? 'H2_CONVERSION_CANDIDATE'
            : 'STANDARD_PLANNING',
  };
}

module.exports = {
  name: 'gasnetz-waermeplanung',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'GASNETZ_WAERMEPLANUNG_DB_PATH',
      defaultDbPath: './data/gasnetz-waermeplanung',
      indexes: [
        ['tenantId'],
        ['tenantId', 'type', 'createdAt'],
        ['gridOperatorId'],
        ['type'],
        ['createdAt'],
      ],
    }),
  ],

  actions: {
    /**
     * @openapi
     * /api/gasnetz-waermeplanung/reconciliations:
     *   post:
     *     tags: [Gasnetz Wärmeplanung]
     *     summary: Reconcile gas network assets against municipal heat planning zones
     *     description: >
     *       Analyses each gas network segment against registered heat planning zones
     *       to classify stranded asset risk, TOTEX signals, and decommissioning horizons.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, segments, heatZones]
     *             properties:
     *               gridOperatorId: { type: string }
     *               municipalityKey: { type: string }
     *               planningYear: { type: integer }
     *               label: { type: string }
     *               segments:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [segmentId]
     *                   properties:
     *                     segmentId: { type: string }
     *                     pressureLevel: { type: string }
     *                     lengthM: { type: number }
     *                     installationYear: { type: integer }
     *                     remainingLifeYears: { type: number }
     *                     annualInvestmentEur: { type: number }
     *                     coverageAreaIds: { type: array, items: { type: string } }
     *               heatZones:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [zoneId, zoneType]
     *                   properties:
     *                     zoneId: { type: string }
     *                     zoneName: { type: string }
     *                     zoneType:
     *                       type: string
     *                       enum: [DISTRICT_HEATING_PRIORITY, DECENTRALISED_RENEWABLE,
     *                              BUILDING_RENOVATION, HYDROGEN_READY, UNCLASSIFIED]
     *                     planningHorizonYear: { type: integer }
     *     responses:
     *       200:
     *         description: Reconciliation result with stranded asset risk map
     */
    reconcile: {
      rest: 'POST /reconciliations',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        municipalityKey: { type: 'string', optional: true },
        planningYear: { type: 'number', optional: true, convert: true },
        label: { type: 'string', optional: true },
        segments: { type: 'array', items: 'object', min: 1 },
        heatZones: { type: 'array', items: 'object', min: 0 },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, municipalityKey, planningYear, label, segments, heatZones } =
          ctx.params;
        const reconciliationId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const segmentResults = segments.map((seg) => assessSegmentRisk(seg, heatZones));

        const highRiskCount = segmentResults.filter(
          (r) => r.strandedRisk === STRANDED_RISK.HIGH
        ).length;
        const mediumRiskCount = segmentResults.filter(
          (r) => r.strandedRisk === STRANDED_RISK.MEDIUM
        ).length;
        const haltedInvestmentSegments = segmentResults.filter(
          (r) => r.totexSignal === 'HALT_NEW_INVESTMENT'
        );

        const totalAnnualInvestmentAtRisk = segments.reduce((sum, seg, idx) => {
          if (segmentResults[idx].strandedRisk === STRANDED_RISK.HIGH) {
            return sum + (seg.annualInvestmentEur ?? 0);
          }
          return sum;
        }, 0);

        const kpis = {
          totalSegments: segments.length,
          highRiskCount,
          mediumRiskCount,
          lowRiskCount: segmentResults.filter((r) => r.strandedRisk === STRANDED_RISK.LOW).length,
          noRiskCount: segmentResults.filter((r) => r.strandedRisk === STRANDED_RISK.NONE).length,
          h2CandidateCount: segmentResults.filter(
            (r) => r.decommissionHorizon === DECOMMISSION_HORIZON.NOT_RECOMMENDED
          ).length,
          totalAnnualInvestmentAtRiskEur: totalAnnualInvestmentAtRisk,
          haltedInvestmentSegmentCount: haltedInvestmentSegments.length,
        };

        const doc = {
          _id: reconciliationId,
          type: 'gasnetz-waermeplanung',
          tenantId,
          gridOperatorId,
          municipalityKey: municipalityKey ?? null,
          planningYear: planningYear ?? null,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          createdAt: nowIso(),
          kpis,
          heatZoneCount: heatZones.length,
          haltedInvestmentSegments: haltedInvestmentSegments.map((r) => ({
            segmentId: r.segmentId,
            conflictingZones: r.conflictingZones,
            totexSignal: r.totexSignal,
          })),
          segmentResults,
        };

        await this.db.put(doc);
        this.logger.info(
          `Gasnetz Wärmeplanung ${reconciliationId}: highRisk=${highRiskCount}, investmentAtRisk=${totalAnnualInvestmentAtRisk}€`
        );

        return {
          reconciliationId,
          gridOperatorId,
          kpis,
          haltedInvestmentSegments: doc.haltedInvestmentSegments,
          segmentResults,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/gasnetz-waermeplanung/reconciliations:
     *   get:
     *     tags: [Gasnetz Wärmeplanung]
     *     summary: List reconciliation records
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
     *         description: List of reconciliation documents
     */
    list: {
      rest: 'GET /reconciliations',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = { tenantId, type: 'gasnetz-waermeplanung', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { reconciliations: result.docs };
      },
    },

    /**
     * @openapi
     * /api/gasnetz-waermeplanung/reconciliations/{id}:
     *   get:
     *     tags: [Gasnetz Wärmeplanung]
     *     summary: Get reconciliation by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Reconciliation document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /reconciliations/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              'Reconciliation not found',
              404,
              'RECONCILIATION_NOT_FOUND'
            );
          }
          throw err;
        }
      },
    },
  },
};
