'use strict';

/**
 * Agnes Bottleneck Service — N-1 Engpass-Detektion mit fNAV + dynamischen Netzentgelten
 *
 * Issue #122 — Automated detection and management of N-1 bottlenecks via fNAV
 * and dynamic grid fees (Agnes)
 *
 * Medium-sized grid operators face a surge in battery connection requests leading
 * to N-1 bottlenecks. Traditional copper expansion is too slow and costly.
 * This service provides a deterministic check engine for:
 *   - N-1 voltage/reactive-power constraint tracking
 *   - fNAV portfolio management
 *   - Agnes (dynamic grid fee) scenario modelling
 *   - DER observability gaps
 *   - Auditable evidence layer between TSO/DSO/DER
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'Agnes Bottleneck';
const DOC_PREFIX = 'agnes:';

// Constraint severity thresholds (configurable)
const N1_VOLTAGE_DROP_THRESHOLD_PCT = 3.0; // EN 50160
const N1_LOADING_CRITICAL_PCT = 90;
const N1_LOADING_WARNING_PCT = 70;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Evaluate N-1 constraint severity for a single network element.
 */
function evaluateN1Constraint(element) {
  const findings = [];
  const loadingPct = element.currentLoadingPct ?? 0;
  const voltageDrop = element.voltageDrop ?? 0;

  if (loadingPct >= N1_LOADING_CRITICAL_PCT) {
    findings.push({
      code: 'N1_LOADING_CRITICAL',
      severity: 'CRITICAL',
      value: loadingPct,
      threshold: N1_LOADING_CRITICAL_PCT,
      message: `Auslastung ${loadingPct}% überschreitet N-1-Grenzwert ${N1_LOADING_CRITICAL_PCT}%`,
    });
  } else if (loadingPct >= N1_LOADING_WARNING_PCT) {
    findings.push({
      code: 'N1_LOADING_WARNING',
      severity: 'WARNING',
      value: loadingPct,
      threshold: N1_LOADING_WARNING_PCT,
      message: `Auslastung ${loadingPct}% nähert sich N-1-Grenzwert`,
    });
  }

  if (voltageDrop > N1_VOLTAGE_DROP_THRESHOLD_PCT) {
    findings.push({
      code: 'N1_VOLTAGE_DROP_EXCEEDED',
      severity: 'CRITICAL',
      value: voltageDrop,
      threshold: N1_VOLTAGE_DROP_THRESHOLD_PCT,
      message: `Spannungsfall ${voltageDrop}% überschreitet EN 50160 Grenzwert ${N1_VOLTAGE_DROP_THRESHOLD_PCT}%`,
    });
  }

  return findings;
}

/**
 * Assess fNAV portfolio coverage for identified bottlenecks.
 */
function assessFnavCoverage(bottlenecks, fnavContracts) {
  return bottlenecks.map((bottleneck) => {
    const covering = fnavContracts.filter(
      (c) =>
        c.netzverknuepfungspunktId === bottleneck.elementId &&
        c.status === 'ACTIVE' &&
        c.flexPowerKw >= bottleneck.flexRequirementKw
    );
    return {
      elementId: bottleneck.elementId,
      flexRequirementKw: bottleneck.flexRequirementKw,
      coverageKw: covering.reduce((sum, c) => sum + c.flexPowerKw, 0),
      contractCount: covering.length,
      coverageStatus:
        covering.length === 0
          ? 'UNCOVERED'
          : covering.reduce((sum, c) => sum + c.flexPowerKw, 0) >= bottleneck.flexRequirementKw
            ? 'SUFFICIENT'
            : 'PARTIAL',
    };
  });
}

/**
 * Model Agnes (dynamic grid fee) scenario impact for a bottleneck.
 */
function modelAgnesScenario(bottleneck, agnesConfig) {
  if (!agnesConfig) return null;
  const {
    currentGridFeeEurPerMwh = 10,
    dynamicMultiplierAtCritical = 3.0,
    dynamicMultiplierAtWarning = 1.5,
    expectedDerResponsePct = 40,
  } = agnesConfig;

  const isCritical = bottleneck.severity === 'CRITICAL';
  const multiplier = isCritical ? dynamicMultiplierAtCritical : dynamicMultiplierAtWarning;
  const expectedLoadReductionPct = isCritical
    ? expectedDerResponsePct
    : expectedDerResponsePct * 0.6;

  return {
    scenarioName: isCritical ? 'AGNES_PEAK_SIGNAL' : 'AGNES_ELEVATED_SIGNAL',
    dynamicFeeEurPerMwh: currentGridFeeEurPerMwh * multiplier,
    multiplier,
    expectedLoadReductionPct,
    estimatedReliefKw: (bottleneck.flexRequirementKw * expectedLoadReductionPct) / 100,
    recommendation: isCritical
      ? 'Agnes-Hochpreistarif auslösen + fNAV-Steuerungsbefehl senden'
      : 'Agnes-Warntarif aktivieren zur präventiven Lastreduktion',
  };
}

module.exports = {
  name: 'agnes-bottleneck',

  settings: {
    dbPath: process.env.AGNES_BOTTLENECK_DB_PATH || './data/agnes-bottleneck',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['overallSeverity'] } });
    this.logger.info(`Agnes Bottleneck DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/agnes-bottleneck/assessments:
     *   post:
     *     tags: [Agnes Bottleneck]
     *     summary: Run N-1 bottleneck assessment with fNAV + Agnes scenario
     *     description: >
     *       Evaluates network elements for N-1 loading and voltage constraints,
     *       assesses fNAV portfolio coverage, and models Agnes (dynamic grid fee)
     *       scenarios for identified bottlenecks.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, networkElements]
     *             properties:
     *               gridOperatorId:
     *                 type: string
     *               networkElements:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     elementId: { type: string }
     *                     elementType: { type: string, enum: [transformer, line, busbar] }
     *                     currentLoadingPct: { type: number }
     *                     voltageDrop: { type: number }
     *                     flexRequirementKw: { type: number }
     *                     voltageLevel: { type: string }
     *               fnavContracts:
     *                 type: array
     *                 items:
     *                   type: object
     *               agnesConfig:
     *                 type: object
     *     responses:
     *       200:
     *         description: N-1 bottleneck assessment with fNAV coverage and Agnes scenarios
     */
    assess: {
      rest: 'POST /assessments',
      timeout: 60_000,
      params: {
        gridOperatorId: { type: 'string' },
        networkElements: { type: 'array', items: 'object', min: 1 },
        fnavContracts: { type: 'array', items: 'object', optional: true, default: [] },
        agnesConfig: { type: 'object', optional: true },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, networkElements, fnavContracts, agnesConfig, label } = ctx.params;
        const assessmentId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const bottlenecks = [];
        let criticalCount = 0;
        let warningCount = 0;

        for (const element of networkElements) {
          const findings = evaluateN1Constraint(element);
          if (findings.length > 0) {
            const severity = findings.some((f) => f.severity === 'CRITICAL')
              ? 'CRITICAL'
              : 'WARNING';
            if (severity === 'CRITICAL') criticalCount++;
            else warningCount++;
            bottlenecks.push({
              elementId: element.elementId,
              elementType: element.elementType,
              voltageLevel: element.voltageLevel,
              severity,
              flexRequirementKw: element.flexRequirementKw ?? 0,
              findings,
            });
          }
        }

        const fnavCoverage = assessFnavCoverage(bottlenecks, fnavContracts);
        const agnesScenarios = bottlenecks.map((b) => ({
          elementId: b.elementId,
          agnesScenario: modelAgnesScenario(b, agnesConfig),
        }));

        const uncoveredBottlenecks = fnavCoverage.filter(
          (c) => c.coverageStatus !== 'SUFFICIENT'
        ).length;
        const overallSeverity =
          criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'NORMAL';

        const doc = {
          _id: assessmentId,
          type: 'agnes-bottleneck-assessment',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          createdAt: nowIso(),
          overallSeverity,
          summary: {
            totalElements: networkElements.length,
            bottleneckCount: bottlenecks.length,
            criticalCount,
            warningCount,
            uncoveredBottlenecks,
            fnavContractCount: fnavContracts.length,
          },
          bottlenecks,
          fnavCoverage,
          agnesScenarios,
        };

        await this.db.put(doc);
        this.logger.info(
          `Agnes assessment ${assessmentId}: severity=${overallSeverity}, bottlenecks=${bottlenecks.length}, uncovered=${uncoveredBottlenecks}`
        );

        return {
          assessmentId,
          overallSeverity,
          summary: doc.summary,
          bottlenecks,
          fnavCoverage,
          agnesScenarios,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/agnes-bottleneck/assessments:
     *   get:
     *     tags: [Agnes Bottleneck]
     *     summary: List bottleneck assessments
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: overallSeverity
     *         schema: { type: string, enum: [CRITICAL, WARNING, NORMAL] }
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
        overallSeverity: {
          type: 'enum',
          values: ['CRITICAL', 'WARNING', 'NORMAL'],
          optional: true,
        },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, overallSeverity, limit } = ctx.params;

        const selector = {
          tenantId,
          type: 'agnes-bottleneck-assessment',
          createdAt: { $exists: true },
        };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (overallSeverity) selector.overallSeverity = overallSeverity;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { assessments: result.docs };
      },
    },

    /**
     * @openapi
     * /api/agnes-bottleneck/assessments/{id}:
     *   get:
     *     tags: [Agnes Bottleneck]
     *     summary: Get bottleneck assessment by ID
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
