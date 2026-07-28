'use strict';

/**
 * fNAV Commercial Hedging Service — Engpass-Szenarien
 *
 * Issue #114 — fNAV Commercial Hedging / Engpass-Szenarien
 *
 * Grid operators increasingly use flexible grid connection agreements (fNAV) to
 * resolve capacity bottlenecks. The core problem: commercial hedging in real
 * bottleneck scenarios. There is no end-to-end data flow between technical
 * operations and the commercial backend to calculate curtailment risk and
 * compensation payments.
 *
 * This service:
 *   1. Manages fNAV contracts with power limits and compensation rules
 *   2. Models bottleneck scenarios with expected curtailment volumes
 *   3. Calculates commercial risk (compensation liability) per scenario
 *   4. Provides an audit-ready link between technical curtailment and €-values
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'fNAV Commercial Hedging';
const DOC_PREFIX_CONTRACT = 'fnav-c:';
const DOC_PREFIX_SCENARIO = 'fnav-s:';

function nowIso() {
  return new Date().toISOString();
}

/**
 * Calculate commercial risk for a curtailment scenario.
 *
 * @param {object} contract - fNAV contract parameters
 * @param {object} scenario - Bottleneck scenario parameters
 * @returns {object} Commercial risk calculation
 */
function calculateCurtailmentRisk(contract, scenario) {
  const {
    installedCapacityKw,
    minimumGuaranteedPowerKw = 0,
    compensationRateEurPerMwh = 0,
    annualCompensationCapEur = null,
  } = contract;

  const {
    expectedAnnualCurtailmentHours = 0,
    expectedCurtailmentDepthPct = 100,
    electricityMarketPriceEurPerMwh = 60,
  } = scenario;

  // Curtailed energy per year
  const curtailedPowerKw = Math.max(
    0,
    (installedCapacityKw - minimumGuaranteedPowerKw) * (expectedCurtailmentDepthPct / 100)
  );
  const curtailedEnergyMwh = (curtailedPowerKw * expectedAnnualCurtailmentHours) / 1000;

  // Compensation liability (based on contract rate)
  let compensationLiabilityEur = curtailedEnergyMwh * compensationRateEurPerMwh;
  if (annualCompensationCapEur !== null) {
    compensationLiabilityEur = Math.min(compensationLiabilityEur, annualCompensationCapEur);
  }

  // Opportunity cost for the asset operator (market value of curtailed energy)
  const opportunityCostEur = curtailedEnergyMwh * electricityMarketPriceEurPerMwh;

  // Net financial impact (liability + regulatory risk)
  const netImpactEur = compensationLiabilityEur;
  const riskLevel = netImpactEur > 500_000 ? 'HIGH' : netImpactEur > 100_000 ? 'MEDIUM' : 'LOW';

  return {
    curtailedPowerKw,
    curtailedEnergyMwh: Math.round(curtailedEnergyMwh * 10) / 10,
    compensationLiabilityEur: Math.round(compensationLiabilityEur),
    opportunityCostEur: Math.round(opportunityCostEur),
    netImpactEur: Math.round(netImpactEur),
    riskLevel,
    compensationCapped:
      annualCompensationCapEur !== null && compensationLiabilityEur >= annualCompensationCapEur,
  };
}

module.exports = {
  name: 'fnav-commercial-hedging',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'FNAV_COMMERCIAL_HEDGING_DB_PATH',
      defaultDbPath: './data/fnav-commercial-hedging',
      indexes: [
        ['tenantId'],
        ['tenantId', 'type', 'createdAt'],
        ['gridOperatorId'],
        ['createdAt'],
        ['type'],
      ],
    }),
  ],

  actions: {
    /**
     * @openapi
     * /api/fnav-commercial-hedging/contracts:
     *   post:
     *     tags: [fNAV Commercial Hedging]
     *     summary: Register a flexible grid connection agreement (fNAV contract)
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, mastrNummer, installedCapacityKw, netzverknuepfungspunktId]
     *             properties:
     *               gridOperatorId: { type: string }
     *               mastrNummer: { type: string }
     *               installedCapacityKw: { type: number }
     *               minimumGuaranteedPowerKw: { type: number }
     *               compensationRateEurPerMwh: { type: number }
     *               annualCompensationCapEur: { type: number }
     *               netzverknuepfungspunktId: { type: string }
     *               voltageLevel: { type: string }
     *               contractStartDate: { type: string }
     *               contractEndDate: { type: string }
     *               status: { type: string, enum: [ACTIVE, DRAFT, TERMINATED] }
     *     responses:
     *       200:
     *         description: fNAV contract registered
     */
    createContract: {
      rest: 'POST /contracts',
      params: {
        gridOperatorId: { type: 'string' },
        mastrNummer: { type: 'string' },
        installedCapacityKw: { type: 'number', convert: true },
        minimumGuaranteedPowerKw: { type: 'number', optional: true, default: 0, convert: true },
        compensationRateEurPerMwh: { type: 'number', optional: true, default: 0, convert: true },
        annualCompensationCapEur: { type: 'number', optional: true, convert: true },
        netzverknuepfungspunktId: { type: 'string' },
        voltageLevel: { type: 'string', optional: true },
        contractStartDate: { type: 'string', optional: true },
        contractEndDate: { type: 'string', optional: true },
        status: {
          type: 'enum',
          values: ['ACTIVE', 'DRAFT', 'TERMINATED'],
          optional: true,
          default: 'DRAFT',
        },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const contractId = `${DOC_PREFIX_CONTRACT}${crypto.randomUUID()}`;

        const doc = {
          _id: contractId,
          type: 'fnav-contract',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId,
          mastrNummer: ctx.params.mastrNummer,
          installedCapacityKw: ctx.params.installedCapacityKw,
          minimumGuaranteedPowerKw: ctx.params.minimumGuaranteedPowerKw,
          compensationRateEurPerMwh: ctx.params.compensationRateEurPerMwh,
          annualCompensationCapEur: ctx.params.annualCompensationCapEur ?? null,
          netzverknuepfungspunktId: ctx.params.netzverknuepfungspunktId,
          voltageLevel: ctx.params.voltageLevel ?? null,
          contractStartDate: ctx.params.contractStartDate ?? null,
          contractEndDate: ctx.params.contractEndDate ?? null,
          status: ctx.params.status,
          label: ctx.params.label ?? null,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        return doc;
      },
    },

    /**
     * @openapi
     * /api/fnav-commercial-hedging/scenarios:
     *   post:
     *     tags: [fNAV Commercial Hedging]
     *     summary: Model a bottleneck scenario and calculate commercial risk
     *     description: >
     *       Given an fNAV contract and scenario assumptions (curtailment hours,
     *       depth), calculates compensation liability and commercial risk level.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, contractId, scenarioName]
     *             properties:
     *               gridOperatorId: { type: string }
     *               contractId: { type: string }
     *               scenarioName: { type: string }
     *               expectedAnnualCurtailmentHours: { type: number }
     *               expectedCurtailmentDepthPct: { type: number }
     *               electricityMarketPriceEurPerMwh: { type: number }
     *               scenarioDescription: { type: string }
     *     responses:
     *       200:
     *         description: Commercial risk scenario result
     */
    createScenario: {
      rest: 'POST /scenarios',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        contractId: { type: 'string' },
        scenarioName: { type: 'string' },
        expectedAnnualCurtailmentHours: {
          type: 'number',
          optional: true,
          default: 200,
          min: 0,
          max: 8760,
          convert: true,
        },
        expectedCurtailmentDepthPct: {
          type: 'number',
          optional: true,
          default: 100,
          min: 0,
          max: 100,
          convert: true,
        },
        electricityMarketPriceEurPerMwh: {
          type: 'number',
          optional: true,
          default: 60,
          convert: true,
        },
        scenarioDescription: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);

        let contract;
        try {
          contract = await this.db.get(ctx.params.contractId);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Contract not found', 404, 'CONTRACT_NOT_FOUND');
          }
          throw err;
        }

        if (contract.tenantId !== tenantId) {
          throw new MoleculerClientError('Contract not found', 404, 'CONTRACT_NOT_FOUND');
        }

        const scenarioId = `${DOC_PREFIX_SCENARIO}${crypto.randomUUID()}`;
        const scenarioParams = {
          expectedAnnualCurtailmentHours: ctx.params.expectedAnnualCurtailmentHours,
          expectedCurtailmentDepthPct: ctx.params.expectedCurtailmentDepthPct,
          electricityMarketPriceEurPerMwh: ctx.params.electricityMarketPriceEurPerMwh,
        };

        const commercialRisk = calculateCurtailmentRisk(contract, scenarioParams);

        const doc = {
          _id: scenarioId,
          type: 'fnav-scenario',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId,
          contractId: ctx.params.contractId,
          mastrNummer: contract.mastrNummer,
          scenarioName: ctx.params.scenarioName,
          scenarioDescription: ctx.params.scenarioDescription ?? null,
          scenarioParams,
          commercialRisk,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
        };

        await this.db.put(doc);
        this.logger.info(
          `fNAV scenario ${scenarioId}: riskLevel=${commercialRisk.riskLevel}, liability=${commercialRisk.compensationLiabilityEur}€`
        );

        return {
          scenarioId,
          contractId: ctx.params.contractId,
          scenarioName: ctx.params.scenarioName,
          commercialRisk,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/fnav-commercial-hedging/contracts:
     *   get:
     *     tags: [fNAV Commercial Hedging]
     *     summary: List fNAV contracts
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: status
     *         schema: { type: string, enum: [ACTIVE, DRAFT, TERMINATED] }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of fNAV contracts
     */
    listContracts: {
      rest: 'GET /contracts',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        status: { type: 'enum', values: ['ACTIVE', 'DRAFT', 'TERMINATED'], optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, status, limit } = ctx.params;

        const selector = { tenantId, type: 'fnav-contract', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (status) selector.status = status;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { contracts: result.docs };
      },
    },

    /**
     * @openapi
     * /api/fnav-commercial-hedging/scenarios:
     *   get:
     *     tags: [fNAV Commercial Hedging]
     *     summary: List fNAV commercial risk scenarios
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: contractId
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of scenarios
     */
    listScenarios: {
      rest: 'GET /scenarios',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        contractId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, contractId, limit } = ctx.params;

        const selector = { tenantId, type: 'fnav-scenario', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (contractId) selector.contractId = contractId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { scenarios: result.docs };
      },
    },
  },
};
