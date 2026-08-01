'use strict';

/**
 * Flexibilitätskosten Raster Service — Entscheidungsraster für Flexibilitätskosten
 *
 * Issue #132 — Enhancement: Flexibilitaetskosten Entscheidungsraster
 *
 * For flexible grid connections, storage systems, data centres, and other large
 * load cases, the technical feasibility, contractual logic, and flexibility costs
 * frequently diverge.
 *
 * This service implements a decision grid (Entscheidungsraster) that brings
 * together:
 *   - Flexibility costs per signal type
 *   - Grid signal priority hierarchy
 *   - Operational controllability assessment
 *   - Contract boundary classification
 *   - Open evidence points that must be resolved before a commitment
 *
 * VNB value: clear result responsibility before commitment, reduced liability
 * and expectation risk, better translation between technical, commercial, and
 * sales teams.
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const _OPENAPI_TAG = 'Flexibilitätskosten Raster';
const DOC_PREFIX = 'fkr:';

// Signal priority hierarchy (lower number = higher priority)
const SIGNAL_PRIORITY = Object.freeze({
  EMERGENCY_SHUTDOWN: 1,
  N1_REDISPATCH: 2,
  FNAV_CURTAILMENT: 3,
  AGNES_DYNAMIC_FEE: 4,
  MARKET_FLEXIBILITY: 5,
  SELF_OPTIMISATION: 6,
});

// Controllability status
const CONTROLLABILITY = Object.freeze({
  FULL: 'FULL', // real-time remote controllable with feedback
  PARTIAL: 'PARTIAL', // controllable with delay or without feedback
  MANUAL_ONLY: 'MANUAL_ONLY', // only manual on-site intervention
  NOT_CONTROLLABLE: 'NOT_CONTROLLABLE',
  UNKNOWN: 'UNKNOWN',
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Classify a flexibility signal against priority and cost.
 */
function classifySignal(signal) {
  const priority = SIGNAL_PRIORITY[signal.signalType] ?? 99;
  const costEurPerMwh = signal.costEurPerMwh ?? null;
  const activated = signal.isActivated ?? false;

  let costCategory;
  if (costEurPerMwh === null) costCategory = 'UNKNOWN';
  else if (costEurPerMwh <= 0) costCategory = 'FREE';
  else if (costEurPerMwh <= 10) costCategory = 'LOW';
  else if (costEurPerMwh <= 50) costCategory = 'MEDIUM';
  else costCategory = 'HIGH';

  const openEvidence = [];
  if (costEurPerMwh === null) {
    openEvidence.push({
      field: 'costEurPerMwh',
      label: 'Flexibilitätskosten noch nicht kalkuliert',
    });
  }
  if (signal.contractBoundary === undefined) {
    openEvidence.push({ field: 'contractBoundary', label: 'Vertragsgrenze nicht definiert' });
  }
  if (!signal.controllabilityStatus || signal.controllabilityStatus === CONTROLLABILITY.UNKNOWN) {
    openEvidence.push({
      field: 'controllabilityStatus',
      label: 'Operative Steuerbarkeit nicht verifiziert',
    });
  }

  return {
    signalType: signal.signalType,
    priority,
    costEurPerMwh,
    costCategory,
    isActivated: activated,
    controllabilityStatus: signal.controllabilityStatus ?? CONTROLLABILITY.UNKNOWN,
    contractBoundary: signal.contractBoundary ?? null,
    openEvidence,
    readyForCommitment: openEvidence.length === 0,
  };
}

module.exports = {
  name: 'flexibilitaetskosten-raster',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'FLEXIBILITAETSKOSTEN_RASTER_DB_PATH',
      defaultDbPath: './data/flexibilitaetskosten-raster',
      indexes: [['tenantId'], ['gridOperatorId'], ['createdAt'], ['tenantId', 'type', 'createdAt']],
    }),
  ],

  actions: {
    /**
     * @openapi
     * /api/flexibilitaetskosten-raster/grids:
     *   post:
     *     tags: [Flexibilitätskosten Raster]
     *     summary: Create a flexibility cost decision grid
     *     description: >
     *       Assembles a decision grid combining flexibility costs, signal priority,
     *       operational controllability, contract boundaries, and open evidence
     *       points. Produces a commitment-readiness assessment per signal type.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, assetReference, flexibilitySignals]
     *             properties:
     *               gridOperatorId: { type: string }
     *               assetReference: { type: string }
     *               flexibilitySignals:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [signalType]
     *                   properties:
     *                     signalType:
     *                       type: string
     *                       enum: [EMERGENCY_SHUTDOWN, N1_REDISPATCH, FNAV_CURTAILMENT, AGNES_DYNAMIC_FEE, MARKET_FLEXIBILITY, SELF_OPTIMISATION]
     *                     costEurPerMwh: { type: number }
     *                     isActivated: { type: boolean }
     *                     controllabilityStatus: { type: string }
     *                     contractBoundary: { type: string }
     *               assetCapacityKw: { type: number }
     *               label: { type: string }
     *     responses:
     *       200:
     *         description: Flexibility cost decision grid
     */
    create: {
      rest: 'POST /grids',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        assetReference: { type: 'string' },
        flexibilitySignals: { type: 'array', items: 'object', min: 1 },
        assetCapacityKw: { type: 'number', optional: true, convert: true },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, assetReference, flexibilitySignals, assetCapacityKw, label } =
          ctx.params;
        const gridId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const classifiedSignals = flexibilitySignals.map(classifySignal);

        // Sort by priority
        classifiedSignals.sort((a, b) => a.priority - b.priority);

        const totalOpenEvidence = classifiedSignals.reduce(
          (sum, s) => sum + s.openEvidence.length,
          0
        );
        const commitmentReadySignals = classifiedSignals.filter((s) => s.readyForCommitment).length;
        const highestPriorityActive = classifiedSignals
          .filter((s) => s.isActivated)
          .sort((a, b) => a.priority - b.priority)[0];

        // Cost summary
        const knownCosts = classifiedSignals.filter((s) => s.costEurPerMwh !== null);
        const minCostEurPerMwh =
          knownCosts.length > 0 ? Math.min(...knownCosts.map((s) => s.costEurPerMwh)) : null;
        const maxCostEurPerMwh =
          knownCosts.length > 0 ? Math.max(...knownCosts.map((s) => s.costEurPerMwh)) : null;

        const overallCommitmentReadiness =
          totalOpenEvidence === 0
            ? 'READY'
            : totalOpenEvidence <= 2
              ? 'MINOR_GAPS'
              : 'EVIDENCE_GAPS';

        const doc = {
          _id: gridId,
          type: 'flexibilitaetskosten-raster',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          createdAt: nowIso(),
          assetReference,
          assetCapacityKw: assetCapacityKw ?? null,
          overallCommitmentReadiness,
          summary: {
            signalCount: classifiedSignals.length,
            commitmentReadySignals,
            totalOpenEvidence,
            minCostEurPerMwh,
            maxCostEurPerMwh,
            highestPriorityActiveSignal: highestPriorityActive?.signalType ?? null,
          },
          classifiedSignals,
        };

        await this.db.put(doc);
        this.logger.info(
          `Flexibilitätskosten grid ${gridId}: readiness=${overallCommitmentReadiness}, openEvidence=${totalOpenEvidence}`
        );

        return {
          gridId,
          overallCommitmentReadiness,
          summary: doc.summary,
          classifiedSignals,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/flexibilitaetskosten-raster/grids:
     *   get:
     *     tags: [Flexibilitätskosten Raster]
     *     summary: List flexibility cost grids
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
     *         description: List of grids
     */
    list: {
      rest: 'GET /grids',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = {
          tenantId,
          type: 'flexibilitaetskosten-raster',
          createdAt: { $exists: true },
        };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { grids: result.docs };
      },
    },

    /**
     * @openapi
     * /api/flexibilitaetskosten-raster/grids/{id}:
     *   get:
     *     tags: [Flexibilitätskosten Raster]
     *     summary: Get flexibility cost grid by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Grid document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /grids/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Grid not found', 404, 'GRID_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
