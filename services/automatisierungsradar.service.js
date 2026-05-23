'use strict';

/**
 * Automatisierungsradar Service — E2E Process Chain Automation Radar
 *
 * Issue #129 — E2E Prozessketten Automatisierungsradar
 *
 * DSOs and energy market operators run complex E2E process chains crossing
 * system boundaries (SAP, GIS, MaStR portal, Excel silos, ticketing systems).
 * Manual handoffs, data garbage sources, and broken interface points hide as
 * organisational routine, making the real automation potential invisible.
 *
 * This service provides:
 *   1. Process chain registry with individual steps and system assignments
 *   2. Automation blocker identification (MANUAL_HANDOFF, DATA_GARBAGE, MISSING_INTERFACE, etc.)
 *   3. Impact/effort scoring → automation priority matrix (QUICK_WIN, STRATEGIC, BACK_BURNER, AVOID)
 *   4. Failure consequence modelling (regulatory, financial, operational risk)
 *   5. Portfolio-level automation potential KPIs
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const DOC_PREFIX = 'aur:';

const BLOCKER_TYPE = Object.freeze({
  MANUAL_HANDOFF: 'MANUAL_HANDOFF', // step requires human to copy/move data
  DATA_GARBAGE_SOURCE: 'DATA_GARBAGE_SOURCE', // upstream data quality prevents automation
  MISSING_INTERFACE: 'MISSING_INTERFACE', // no machine-readable interface exists
  INSUFFICIENT_AUTHORISATION: 'INSUFFICIENT_AUTHORISATION', // system lacks write/trigger permissions
  PROCESS_EXCEPTION_RATE: 'PROCESS_EXCEPTION_RATE', // too many edge cases for rules-based automation
  REGULATORY_SIGN_OFF: 'REGULATORY_SIGN_OFF', // regulatory/compliance requires human approval
  LEGACY_FORMAT: 'LEGACY_FORMAT', // data format cannot be parsed by modern systems
  ORGANISATIONAL_SILO: 'ORGANISATIONAL_SILO', // cross-department handoff without clear ownership
});

const AUTOMATION_QUADRANT = Object.freeze({
  QUICK_WIN: 'QUICK_WIN', // high impact + low effort → automate immediately
  STRATEGIC: 'STRATEGIC', // high impact + high effort → roadmap item
  BACK_BURNER: 'BACK_BURNER', // low impact + low effort → opportunistic
  AVOID: 'AVOID', // low impact + high effort → do not invest
});

const RISK_LEVEL = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

/**
 * Map a 1–10 impact and 1–10 effort score into a quadrant.
 * Impact ≥ 6 → HIGH; Effort ≥ 6 → HIGH.
 */
function deriveQuadrant(impactScore, effortScore) {
  const highImpact = impactScore >= 6;
  const highEffort = effortScore >= 6;
  if (highImpact && !highEffort) return AUTOMATION_QUADRANT.QUICK_WIN;
  if (highImpact && highEffort) return AUTOMATION_QUADRANT.STRATEGIC;
  if (!highImpact && !highEffort) return AUTOMATION_QUADRANT.BACK_BURNER;
  return AUTOMATION_QUADRANT.AVOID;
}

/**
 * Analyse a single process step for automation blockers and scoring.
 */
function analyseProcessStep(step) {
  const detectedBlockers = [];

  (step.blockers ?? []).forEach((b) => {
    const type = b.type ?? BLOCKER_TYPE.MANUAL_HANDOFF;
    detectedBlockers.push({
      blocker: type,
      description: b.description ?? null,
      systemAffected: b.systemAffected ?? null,
      resolvable: b.resolvable !== false, // default true
    });
  });

  // Auto-detect obvious blockers from metadata flags
  if (step.isManualHandoff && !detectedBlockers.find((b) => b.blocker === BLOCKER_TYPE.MANUAL_HANDOFF)) {
    detectedBlockers.push({
      blocker: BLOCKER_TYPE.MANUAL_HANDOFF,
      description: 'Manuelle Übergabe erkannt aus Step-Metadaten',
      systemAffected: step.targetSystem ?? null,
      resolvable: true,
    });
  }
  if (step.hasExcelSilo && !detectedBlockers.find((b) => b.blocker === BLOCKER_TYPE.DATA_GARBAGE_SOURCE)) {
    detectedBlockers.push({
      blocker: BLOCKER_TYPE.DATA_GARBAGE_SOURCE,
      description: 'Excel-Silo als Datenquelle erkannt — Datenqualität kritisch prüfen',
      systemAffected: step.sourceSystem ?? null,
      resolvable: true,
    });
  }
  if (step.requiresRegulatorySignOff) {
    detectedBlockers.push({
      blocker: BLOCKER_TYPE.REGULATORY_SIGN_OFF,
      description: 'Regulatorische/compliance Freigabe erforderlich',
      systemAffected: null,
      resolvable: false, // regulatory sign-off may not be automatable
    });
  }

  const impactScore = step.impactScore ?? 5;
  const effortScore = step.effortScore ?? 5;
  const quadrant = deriveQuadrant(impactScore, effortScore);
  const automationBlockerCount = detectedBlockers.filter((b) => !b.resolvable).length;
  const automationFeasible = automationBlockerCount === 0;

  return {
    stepId: step.stepId ?? crypto.randomUUID(),
    stepName: step.stepName,
    sourceSystem: step.sourceSystem ?? null,
    targetSystem: step.targetSystem ?? null,
    processingTime: step.processingTime ?? null,
    impactScore,
    effortScore,
    quadrant,
    automationFeasible,
    automationBlockerCount,
    detectedBlockers,
    failureConsequence: step.failureConsequence ?? null,
    failureRisk: step.failureRisk ?? RISK_LEVEL.LOW,
    currentAutomationLevel: step.currentAutomationLevel ?? 0, // 0=manual…100=fully automated
    targetAutomationLevel: step.targetAutomationLevel ?? null,
  };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'automatisierungsradar',

  settings: {
    dbPath: process.env.AUTOMATISIERUNGSRADAR_DB_PATH || './data/automatisierungsradar',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`Automatisierungsradar DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/automatisierungsradar/radars:
     *   post:
     *     tags: [Automatisierungsradar]
     *     summary: Analyse an E2E process chain for automation potential
     *     description: >
     *       Each step in the process chain is scored for impact, effort, and automation
     *       blockers. The response provides a prioritised automation roadmap matrix
     *       (QUICK_WIN / STRATEGIC / BACK_BURNER / AVOID) and portfolio KPIs.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, processChainName, steps]
     *             properties:
     *               gridOperatorId: { type: string }
     *               processChainName: { type: string }
     *               label: { type: string }
     *               steps:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [stepName]
     *                   properties:
     *                     stepId: { type: string }
     *                     stepName: { type: string }
     *                     sourceSystem: { type: string }
     *                     targetSystem: { type: string }
     *                     processingTime: { type: string }
     *                     impactScore: { type: number, minimum: 1, maximum: 10 }
     *                     effortScore: { type: number, minimum: 1, maximum: 10 }
     *                     currentAutomationLevel: { type: number }
     *                     targetAutomationLevel: { type: number }
     *                     isManualHandoff: { type: boolean }
     *                     hasExcelSilo: { type: boolean }
     *                     requiresRegulatorySignOff: { type: boolean }
     *                     failureConsequence: { type: string }
     *                     failureRisk:
     *                       type: string
     *                       enum: [CRITICAL, HIGH, MEDIUM, LOW]
     *                     blockers:
     *                       type: array
     *                       items:
     *                         type: object
     *                         properties:
     *                           type:
     *                             type: string
     *                             enum: [MANUAL_HANDOFF, DATA_GARBAGE_SOURCE, MISSING_INTERFACE,
     *                                    INSUFFICIENT_AUTHORISATION, PROCESS_EXCEPTION_RATE,
     *                                    REGULATORY_SIGN_OFF, LEGACY_FORMAT, ORGANISATIONAL_SILO]
     *                           description: { type: string }
     *                           systemAffected: { type: string }
     *                           resolvable: { type: boolean }
     *     responses:
     *       200:
     *         description: Automation radar result with quadrant matrix and KPIs
     */
    analyze: {
      rest: 'POST /radars',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        processChainName: { type: 'string' },
        label: { type: 'string', optional: true },
        steps: { type: 'array', items: 'object', min: 1 },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, processChainName, label, steps } = ctx.params;
        const radarId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const analysedSteps = steps.map(analyseProcessStep);

        // Quadrant breakdown
        const quadrantMatrix = {
          [AUTOMATION_QUADRANT.QUICK_WIN]: [],
          [AUTOMATION_QUADRANT.STRATEGIC]: [],
          [AUTOMATION_QUADRANT.BACK_BURNER]: [],
          [AUTOMATION_QUADRANT.AVOID]: [],
        };
        for (const s of analysedSteps) {
          quadrantMatrix[s.quadrant].push(s.stepName);
        }

        const totalBlockers = analysedSteps.reduce((sum, s) => sum + s.detectedBlockers.length, 0);
        const irresolvableBlockers = analysedSteps.reduce(
          (sum, s) => sum + s.automationBlockerCount,
          0
        );
        const quickWinSteps = quadrantMatrix[AUTOMATION_QUADRANT.QUICK_WIN];
        const avgCurrentAutomation =
          analysedSteps.length > 0
            ? Math.round(
                analysedSteps.reduce((s, step) => s + step.currentAutomationLevel, 0) /
                  analysedSteps.length
              )
            : 0;

        const avgTargetAutomation = (() => {
          const withTarget = analysedSteps.filter((s) => s.targetAutomationLevel !== null);
          if (withTarget.length === 0) return null;
          return Math.round(
            withTarget.reduce((s, step) => s + step.targetAutomationLevel, 0) / withTarget.length
          );
        })();

        const criticalFailureSteps = analysedSteps.filter(
          (s) => s.failureRisk === RISK_LEVEL.CRITICAL || s.failureRisk === RISK_LEVEL.HIGH
        );

        const kpis = {
          totalSteps: steps.length,
          quickWinCount: quickWinSteps.length,
          strategicCount: quadrantMatrix[AUTOMATION_QUADRANT.STRATEGIC].length,
          backBurnerCount: quadrantMatrix[AUTOMATION_QUADRANT.BACK_BURNER].length,
          avoidCount: quadrantMatrix[AUTOMATION_QUADRANT.AVOID].length,
          totalBlockers,
          irresolvableBlockers,
          criticalFailureStepCount: criticalFailureSteps.length,
          avgCurrentAutomationPct: avgCurrentAutomation,
          avgTargetAutomationPct: avgTargetAutomation,
          overallAutomationPotential:
            avgTargetAutomation !== null
              ? `${avgCurrentAutomation}% → ${avgTargetAutomation}%`
              : `currently ${avgCurrentAutomation}%`,
        };

        const doc = {
          _id: radarId,
          type: 'automatisierungsradar',
          tenantId,
          gridOperatorId,
          processChainName,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          createdAt: nowIso(),
          kpis,
          quadrantMatrix,
          criticalFailureSteps: criticalFailureSteps.map((s) => ({
            stepName: s.stepName,
            failureRisk: s.failureRisk,
            failureConsequence: s.failureConsequence,
          })),
          analysedSteps,
        };

        await this.db.put(doc);
        this.logger.info(
          `Automatisierungsradar ${radarId}: quickWins=${quickWinSteps.length}, blockers=${totalBlockers}`
        );

        return {
          radarId,
          processChainName,
          kpis,
          quadrantMatrix,
          criticalFailureSteps: doc.criticalFailureSteps,
          analysedSteps,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/automatisierungsradar/radars:
     *   get:
     *     tags: [Automatisierungsradar]
     *     summary: List automation radars
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
     *         description: List of radar documents
     */
    list: {
      rest: 'GET /radars',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = { tenantId, type: 'automatisierungsradar' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { radars: result.docs };
      },
    },

    /**
     * @openapi
     * /api/automatisierungsradar/radars/{id}:
     *   get:
     *     tags: [Automatisierungsradar]
     *     summary: Get automation radar by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Radar document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /radars/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Radar not found', 404, 'RADAR_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
