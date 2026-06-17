'use strict';

/**
 * ReInvest Signal Service — Automatisierte Identifikation von Re-Invest-Signalen
 *
 * Issue #105 — Automatisierte Identifikation von Re-Invest Signalen (Fotojahr 2026)
 *
 * In the current ARegV base year (Fotojahr) 2026, DSOs are under significant
 * pressure to optimally represent their CAPEX/TOTEX efficiency values. Existing
 * data on grid disturbances, maintenance deficiencies, and pending follow-up
 * orders are locked in operational silos and not quickly enough qualified as
 * commercial "re-invest" signals.
 *
 * This service:
 *   1. Accepts maintenance/SCADA log entries
 *   2. Classifies entries as re-invest signals (unplanned disturbance → budget-relevant CAPEX)
 *   3. Assigns ARegV relevance scores for Fotojahr 2026
 *   4. Produces an investment candidate list for regulatory efficiency scoring
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'ReInvest Signal';
const DOC_PREFIX = 'ris:';

const FOTOJAHR = 2026;

// Re-invest signal classification rules
const REINVEST_CATEGORIES = Object.freeze({
  EMERGENCY_REINVESTMENT: 'EMERGENCY_REINVESTMENT', // unplanned outage requiring immediate capex
  PLANNED_REPLACEMENT: 'PLANNED_REPLACEMENT', // scheduled end-of-life replacement
  CAPACITY_EXPANSION: 'CAPACITY_EXPANSION', // bottleneck-driven expansion
  REGULATORY_MANDATORY: 'REGULATORY_MANDATORY', // legally required upgrade
  PREDICTIVE_MAINTENANCE: 'PREDICTIVE_MAINTENANCE', // condition-based replacement signal
  DEFERRED_MAINTENANCE: 'DEFERRED_MAINTENANCE', // backlog item now qualifying for capex
});

const AREG_RELEVANCE = Object.freeze({
  HIGH: 'HIGH', // direct TOTEX-Effizienz relevance
  MEDIUM: 'MEDIUM', // partial relevance (may qualify for CAPEX allowance)
  LOW: 'LOW', // informational only
});

function nowIso() {
  return new Date().toISOString();
}

/**
 * Classify a maintenance/SCADA log entry as a re-invest signal.
 */
function classifyEntry(entry) {
  const isInFotojahr = entry.eventDate && new Date(entry.eventDate).getFullYear() === FOTOJAHR;
  const isUnplanned = entry.eventType === 'UNPLANNED_OUTAGE' || entry.isEmergency;
  const isRecurring = (entry.occurrenceCount ?? 1) >= 3;
  const estimatedCapexEur = entry.estimatedRepairCostEur ?? 0;

  let category = REINVEST_CATEGORIES.PREDICTIVE_MAINTENANCE;
  let aregRelevance = AREG_RELEVANCE.LOW;
  let reinvestScore = 20;

  if (isUnplanned && estimatedCapexEur >= 50_000) {
    category = REINVEST_CATEGORIES.EMERGENCY_REINVESTMENT;
    aregRelevance = AREG_RELEVANCE.HIGH;
    reinvestScore = 100;
  } else if (entry.eventType === 'REGULATORY_REQUIREMENT') {
    category = REINVEST_CATEGORIES.REGULATORY_MANDATORY;
    aregRelevance = AREG_RELEVANCE.HIGH;
    reinvestScore = 95;
  } else if (isRecurring && estimatedCapexEur >= 20_000) {
    category = REINVEST_CATEGORIES.DEFERRED_MAINTENANCE;
    aregRelevance = AREG_RELEVANCE.MEDIUM;
    reinvestScore = 70;
  } else if (entry.eventType === 'CAPACITY_BOTTLENECK') {
    category = REINVEST_CATEGORIES.CAPACITY_EXPANSION;
    aregRelevance = AREG_RELEVANCE.HIGH;
    reinvestScore = 85;
  } else if (entry.eventType === 'END_OF_LIFE') {
    category = REINVEST_CATEGORIES.PLANNED_REPLACEMENT;
    aregRelevance = isInFotojahr ? AREG_RELEVANCE.HIGH : AREG_RELEVANCE.MEDIUM;
    reinvestScore = isInFotojahr ? 80 : 55;
  }

  // Fotojahr bonus
  if (isInFotojahr && aregRelevance !== AREG_RELEVANCE.LOW) {
    reinvestScore = Math.min(100, reinvestScore + 10);
  }

  return {
    assetId: entry.assetId,
    assetLabel: entry.assetLabel ?? entry.assetId,
    eventDate: entry.eventDate ?? null,
    eventType: entry.eventType ?? 'UNKNOWN',
    isInFotojahr,
    category,
    aregRelevance,
    reinvestScore,
    estimatedCapexEur,
    qualifiesForFotojahr: isInFotojahr && aregRelevance === AREG_RELEVANCE.HIGH,
    actionRequired:
      category === REINVEST_CATEGORIES.EMERGENCY_REINVESTMENT
        ? 'Sofort als CAPEX-Antrag einreichen'
        : category === REINVEST_CATEGORIES.REGULATORY_MANDATORY
          ? 'Regulatorischen Nachweis dokumentieren und CAPEX-Plan aktualisieren'
          : 'In CAPEX-Priorisierungsliste aufnehmen',
  };
}

module.exports = {
  name: 'reinvest-signal',

  settings: {
    dbPath: process.env.REINVEST_SIGNAL_DB_PATH || './data/reinvest-signal',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    this.logger.info(`ReInvest Signal DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/reinvest-signal/analyses:
     *   post:
     *     tags: [ReInvest Signal]
     *     summary: Classify maintenance/SCADA log entries as re-invest signals
     *     description: >
     *       Extracts and classifies re-invest signals from maintenance or SCADA
     *       log entries. Assigns ARegV/Fotojahr 2026 relevance scores and produces
     *       a prioritized investment candidate list.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, logEntries]
     *             properties:
     *               gridOperatorId: { type: string }
     *               logEntries:
     *                 type: array
     *                 items:
     *                   type: object
     *                   required: [assetId]
     *                   properties:
     *                     assetId: { type: string }
     *                     assetLabel: { type: string }
     *                     eventDate: { type: string }
     *                     eventType:
     *                       type: string
     *                       enum: [UNPLANNED_OUTAGE, PLANNED_MAINTENANCE, CAPACITY_BOTTLENECK, END_OF_LIFE, REGULATORY_REQUIREMENT, OTHER]
     *                     isEmergency: { type: boolean }
     *                     estimatedRepairCostEur: { type: number }
     *                     occurrenceCount: { type: number }
     *               label: { type: string }
     *     responses:
     *       200:
     *         description: Re-invest signal analysis result
     */
    analyze: {
      rest: 'POST /analyses',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        logEntries: { type: 'array', items: 'object', min: 1 },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, logEntries, label } = ctx.params;
        const analysisId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const signals = logEntries.map(classifyEntry);
        signals.sort((a, b) => b.reinvestScore - a.reinvestScore);

        const fotojahrQualified = signals.filter((s) => s.qualifiesForFotojahr);
        const highAregRelevance = signals.filter((s) => s.aregRelevance === AREG_RELEVANCE.HIGH);
        const totalEstimatedCapexEur = signals.reduce((s, e) => s + (e.estimatedCapexEur ?? 0), 0);
        const fotojahrCapexEur = fotojahrQualified.reduce(
          (s, e) => s + (e.estimatedCapexEur ?? 0),
          0
        );

        const doc = {
          _id: analysisId,
          type: 'reinvest-signal-analysis',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          fotojahr: FOTOJAHR,
          label: label ?? null,
          createdAt: nowIso(),
          summary: {
            totalEntries: logEntries.length,
            signalCount: signals.length,
            fotojahrQualifiedCount: fotojahrQualified.length,
            highAregRelevanceCount: highAregRelevance.length,
            totalEstimatedCapexEur,
            fotojahrCapexEur,
          },
          signals,
        };

        await this.db.put(doc);
        this.logger.info(
          `ReInvest analysis ${analysisId}: ${fotojahrQualified.length} Fotojahr-qualified, ${fotojahrCapexEur}€ capex`
        );

        return {
          analysisId,
          fotojahr: FOTOJAHR,
          summary: doc.summary,
          signals,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/reinvest-signal/analyses:
     *   get:
     *     tags: [ReInvest Signal]
     *     summary: List re-invest signal analyses
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

        const selector = { tenantId, type: 'reinvest-signal-analysis' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { analyses: result.docs };
      },
    },

    /**
     * @openapi
     * /api/reinvest-signal/analyses/{id}:
     *   get:
     *     tags: [ReInvest Signal]
     *     summary: Get re-invest signal analysis by ID
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
