'use strict';

/**
 * CAPEX Prioritization Service — Harte Netzengpässe
 *
 * Issue #125 — CAPEX-Priorisierung für harte Netzengpässe
 *
 * When VNBs discuss physical redundancy or N-1 bottlenecks together with
 * flexibility, fNAV, or OPEX bridges, there is a risk that a mandatory
 * supply-security measure is not clearly separated from optional flexibility
 * levers.
 *
 * This service classifies grid measures by:
 *   - NON_NEGOTIABLE_PHYSICAL: measures that must not be replaced by market flexibility
 *   - FLEXIBILITY_BRIDGE: temporary flex option while physical measure is planned
 *   - REGULATORY_OBLIGATION: required by statute regardless of grid situation
 *   - COMMERCIAL_OPTION: purely economic, can be deferred or replaced
 *
 * Output: C-Level-ready decision template showing which measures cannot be
 * replaced by market flexibility.
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'CAPEX Prioritization';
const DOC_PREFIX = 'capex:';

const MEASURE_CLASS = Object.freeze({
  NON_NEGOTIABLE_PHYSICAL: 'NON_NEGOTIABLE_PHYSICAL',
  FLEXIBILITY_BRIDGE: 'FLEXIBILITY_BRIDGE',
  REGULATORY_OBLIGATION: 'REGULATORY_OBLIGATION',
  COMMERCIAL_OPTION: 'COMMERCIAL_OPTION',
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Classify a single grid measure based on its declared properties.
 */
function classifyMeasure(measure) {
  const findings = [];
  let classification = MEASURE_CLASS.COMMERCIAL_OPTION;
  let canBeReplacedByFlex = true;
  let urgency = 'LOW';

  // Hard N-1 gap → non-negotiable
  if (measure.isN1Gap || measure.supplySecurityImpact === 'HIGH') {
    classification = MEASURE_CLASS.NON_NEGOTIABLE_PHYSICAL;
    canBeReplacedByFlex = false;
    urgency = 'CRITICAL';
    findings.push({
      code: 'HARD_N1_GAP',
      message: 'N-1-Lücke: Physische Maßnahme zwingend, Flexibilität kein Ersatz',
    });
  }

  // Regulatory obligation overrides everything
  if (measure.regulatoryBasis) {
    classification = MEASURE_CLASS.REGULATORY_OBLIGATION;
    canBeReplacedByFlex = false;
    urgency = urgency === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    findings.push({
      code: 'REGULATORY_MANDATORY',
      message: `Gesetzliche Verpflichtung nach ${measure.regulatoryBasis}: Nicht verzichtbar`,
    });
  }

  // Temporary flex bridge (only if physical is already planned)
  if (
    !measure.isN1Gap &&
    !measure.regulatoryBasis &&
    measure.isBridgeUntilPhysical &&
    measure.physicalMeasurePlannedDate
  ) {
    classification = MEASURE_CLASS.FLEXIBILITY_BRIDGE;
    canBeReplacedByFlex = true;
    urgency = 'MEDIUM';
    findings.push({
      code: 'FLEX_BRIDGE_ACCEPTED',
      message: `Flexibilitätsbrücke bis physische Maßnahme am ${measure.physicalMeasurePlannedDate} realisiert ist`,
    });
  }

  const priorityScore = (() => {
    const base = { CRITICAL: 100, HIGH: 75, MEDIUM: 50, LOW: 25 }[urgency] ?? 25;
    const capexBonus = measure.capexEur > 1_000_000 ? 10 : 0;
    const loadingBonus = (measure.currentLoadingPct ?? 0) > 85 ? 15 : 0;
    return Math.min(100, base + capexBonus + loadingBonus);
  })();

  return {
    classification,
    canBeReplacedByFlex,
    urgency,
    priorityScore,
    findings,
    flexReplacementRisk: canBeReplacedByFlex
      ? 'LOW'
      : 'HIGH — Flexibilität darf diese Maßnahme NICHT ersetzen',
  };
}

module.exports = {
  name: 'capex-prioritization',

  settings: {
    dbPath: process.env.CAPEX_PRIORITIZATION_DB_PATH || './data/capex-prioritization',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`CAPEX Prioritization DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/capex-prioritization/analyses:
     *   post:
     *     tags: [CAPEX Prioritization]
     *     summary: Classify and prioritize grid measures by physical necessity
     *     description: >
     *       Separates non-negotiable physical safety measures from optional
     *       flexibility options. Produces a C-Level decision template.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, measures]
     *             properties:
     *               gridOperatorId:
     *                 type: string
     *               measures:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [measureId, description]
     *                   properties:
     *                     measureId: { type: string }
     *                     description: { type: string }
     *                     isN1Gap: { type: boolean }
     *                     supplySecurityImpact: { type: string, enum: [HIGH, MEDIUM, LOW] }
     *                     regulatoryBasis: { type: string }
     *                     isBridgeUntilPhysical: { type: boolean }
     *                     physicalMeasurePlannedDate: { type: string }
     *                     capexEur: { type: number }
     *                     currentLoadingPct: { type: number }
     *                     voltageLevel: { type: string }
     *     responses:
     *       200:
     *         description: Classified and prioritized measure list with C-Level template
     */
    analyze: {
      rest: 'POST /analyses',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        measures: { type: 'array', items: 'object', min: 1 },
        label: { type: 'string', optional: true },
        urgencyDriver: { type: 'string', optional: true, max: 500 },
        decisionFrameId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, measures, label, urgencyDriver, decisionFrameId } = ctx.params;
        const analysisId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const classifiedMeasures = measures.map((m) => ({
          ...m,
          ...classifyMeasure(m),
        }));

        // Sort by priority score descending
        classifiedMeasures.sort((a, b) => b.priorityScore - a.priorityScore);

        const nonNegotiable = classifiedMeasures.filter(
          (m) => m.classification === MEASURE_CLASS.NON_NEGOTIABLE_PHYSICAL
        );
        const regulatory = classifiedMeasures.filter(
          (m) => m.classification === MEASURE_CLASS.REGULATORY_OBLIGATION
        );
        const flexBridges = classifiedMeasures.filter(
          (m) => m.classification === MEASURE_CLASS.FLEXIBILITY_BRIDGE
        );
        const commercial = classifiedMeasures.filter(
          (m) => m.classification === MEASURE_CLASS.COMMERCIAL_OPTION
        );

        const totalCapexNonNegotiable = nonNegotiable.reduce(
          (sum, m) => sum + (m.capexEur ?? 0),
          0
        );
        const totalCapexAll = classifiedMeasures.reduce((sum, m) => sum + (m.capexEur ?? 0), 0);

        const clevelTemplate = {
          headline: `${nonNegotiable.length} Maßnahme(n) sind nicht durch Marktflexibilität ersetzbar`,
          nonNegotiableSummary:
            nonNegotiable.length > 0
              ? `CAPEX-Pflichtblock: ${(totalCapexNonNegotiable / 1e6).toFixed(1)} Mio. € — diese Investitionen sind Voraussetzung für Versorgungssicherheit`
              : 'Keine zwingenden physischen Maßnahmen identifiziert',
          flexRisk:
            flexBridges.length > 0
              ? `${flexBridges.length} Flexibilitätsbrücke(n) akzeptabel bis physische Maßnahmen realisiert sind`
              : 'Keine Flexibilitätsbrücken vorgeschlagen',
          forbiddenAssumption:
            'Marktflexibilität (fNAV, Agnes, Redispatch) darf N-1-kritische Maßnahmen NICHT ersetzen oder dauerhaft verschieben',
          scqaUrgencyDriver: urgencyDriver ?? null,
          decisionRequired: nonNegotiable.length > 0 || regulatory.length > 0,
        };

        const doc = {
          _id: analysisId,
          type: 'capex-prioritization-analysis',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          urgencyDriver: urgencyDriver ?? null,
          decisionFrameId: decisionFrameId ?? null,
          createdAt: nowIso(),
          summary: {
            totalMeasures: measures.length,
            nonNegotiableCount: nonNegotiable.length,
            regulatoryCount: regulatory.length,
            flexBridgeCount: flexBridges.length,
            commercialCount: commercial.length,
            totalCapexEur: totalCapexAll,
            totalCapexNonNegotiableEur: totalCapexNonNegotiable,
          },
          classifiedMeasures,
          clevelTemplate,
        };

        await this.db.put(doc);
        this.logger.info(
          `CAPEX analysis ${analysisId}: ${nonNegotiable.length} non-negotiable, ${flexBridges.length} flex bridges`
        );

        return {
          analysisId,
          summary: doc.summary,
          classifiedMeasures,
          clevelTemplate,
          urgencyDriver: doc.urgencyDriver,
          decisionFrameId: doc.decisionFrameId,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/capex-prioritization/analyses:
     *   get:
     *     tags: [CAPEX Prioritization]
     *     summary: List CAPEX prioritization analyses
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
     *         description: List of analyses
     */
    list: {
      rest: 'GET /analyses',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = {
          tenantId,
          type: 'capex-prioritization-analysis',
          createdAt: { $exists: true },
        };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { analyses: result.docs };
      },
    },

    /**
     * @openapi
     * /api/capex-prioritization/analyses/{id}:
     *   get:
     *     tags: [CAPEX Prioritization]
     *     summary: Get CAPEX analysis by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Analysis document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /analyses/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Analysis not found', 404, 'ANALYSIS_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
