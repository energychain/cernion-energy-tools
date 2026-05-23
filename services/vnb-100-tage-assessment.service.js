'use strict';

/**
 * VNB 100-Tage Assessment Service
 *
 * Issue #124 — VNB 100-Tage Quick Assessment
 *
 * In DSO organisations, leadership changes or strategic reorganisations often
 * lack a compact, reliable map of E2E process risks, benchmark KPIs, ROI levers,
 * grid planning gaps, and forbidden assumptions.
 *
 * This service provides a 100-day Quick Assessment framework:
 *   - Structured questionnaire (6 domains)
 *   - KPI/benchmark set with targets
 *   - ROI model for 4–6 measures
 *   - Evidence requirements per domain
 *   - Management-ready decision template
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'VNB 100-Tage Assessment';
const DOC_PREFIX = 'v100:';

// Standard assessment domains
const ASSESSMENT_DOMAINS = [
  {
    domainId: 'GRID_PLANNING',
    label: 'Netzplanung & Investitionsstrategie',
    kpis: ['capex_efficiency_pct', 'n1_compliance_rate_pct', 'asset_age_avg_years'],
    benchmarkTargets: { capex_efficiency_pct: 85, n1_compliance_rate_pct: 99, asset_age_avg_years: 25 },
  },
  {
    domainId: 'OPERATIONS',
    label: 'Netzbetrieb & Entstörung',
    kpis: ['saidi_minutes', 'saifi_count', 'mttr_hours'],
    benchmarkTargets: { saidi_minutes: 15, saifi_count: 0.5, mttr_hours: 4 },
  },
  {
    domainId: 'REGULATORY',
    label: 'Regulierung & Anreizregulierung',
    kpis: ['arev_efficiency_score', 'capex_recognition_rate_pct', 'complaint_resolution_days'],
    benchmarkTargets: { arev_efficiency_score: 80, capex_recognition_rate_pct: 90, complaint_resolution_days: 30 },
  },
  {
    domainId: 'COMMERCIAL',
    label: 'Kaufmännische Steuerung & ERP',
    kpis: ['invoice_cycle_days', 'bad_debt_rate_pct', 'process_automation_pct'],
    benchmarkTargets: { invoice_cycle_days: 14, bad_debt_rate_pct: 0.5, process_automation_pct: 60 },
  },
  {
    domainId: 'DATA_QUALITY',
    label: 'Daten- & Stammdatenqualität',
    kpis: ['mastr_accuracy_pct', 'edm_completeness_pct', 'geo_data_currency_pct'],
    benchmarkTargets: { mastr_accuracy_pct: 98, edm_completeness_pct: 95, geo_data_currency_pct: 90 },
  },
  {
    domainId: 'MARKET_INTEGRATION',
    label: 'Marktintegration (Redispatch, fNAV, §14a)',
    kpis: ['redispatch_ready_pct', 'fnav_portfolio_size', 'section14a_enrollment_pct'],
    benchmarkTargets: { redispatch_ready_pct: 100, fnav_portfolio_size: 10, section14a_enrollment_pct: 30 },
  },
];

function nowIso() {
  return new Date().toISOString();
}

/**
 * Score a domain based on provided KPI values vs. benchmark targets.
 */
function scoreDomain(domain, kpiValues) {
  const scores = [];
  for (const kpiId of domain.kpis) {
    const value = kpiValues[kpiId];
    const target = domain.benchmarkTargets[kpiId];
    if (value == null || target == null) {
      scores.push({ kpiId, value: null, target, score: null, status: 'NO_DATA' });
      continue;
    }
    // For metrics where lower = better (SAIDI, MTTR, etc.)
    const lowerIsBetter = ['saidi_minutes', 'saifi_count', 'mttr_hours', 'invoice_cycle_days', 'bad_debt_rate_pct', 'complaint_resolution_days', 'asset_age_avg_years'].includes(kpiId);
    const ratio = lowerIsBetter ? target / Math.max(value, 0.001) : value / Math.max(target, 0.001);
    const score = Math.min(100, Math.round(ratio * 100));
    scores.push({
      kpiId,
      value,
      target,
      score,
      status: score >= 90 ? 'ON_TARGET' : score >= 70 ? 'NEAR_TARGET' : 'OFF_TARGET',
    });
  }

  const scoredKpis = scores.filter((s) => s.score !== null);
  const domainScore =
    scoredKpis.length > 0
      ? Math.round(scoredKpis.reduce((s, k) => s + k.score, 0) / scoredKpis.length)
      : null;

  return { ...domain, kpiScores: scores, domainScore };
}

module.exports = {
  name: 'vnb-100-tage-assessment',

  settings: {
    dbPath: process.env.VNB_100_TAGE_ASSESSMENT_DB_PATH || './data/vnb-100-tage-assessment',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    this.logger.info(`VNB 100-Tage Assessment DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/vnb-100-tage-assessment/assessments:
     *   post:
     *     tags: [VNB 100-Tage Assessment]
     *     summary: Run a 100-day quick assessment for a grid operator
     *     description: >
     *       Runs a structured 100-day assessment across 6 domains. Scores KPIs
     *       against benchmarks, identifies top ROI levers, and produces a
     *       management decision template.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, kpiValues]
     *             properties:
     *               gridOperatorId: { type: string }
     *               kpiValues:
     *                 type: object
     *                 description: >
     *                   Map of KPI ID to current value. Supported KPIs:
     *                   capex_efficiency_pct, n1_compliance_rate_pct, asset_age_avg_years,
     *                   saidi_minutes, saifi_count, mttr_hours, arev_efficiency_score,
     *                   capex_recognition_rate_pct, complaint_resolution_days,
     *                   invoice_cycle_days, bad_debt_rate_pct, process_automation_pct,
     *                   mastr_accuracy_pct, edm_completeness_pct, geo_data_currency_pct,
     *                   redispatch_ready_pct, fnav_portfolio_size, section14a_enrollment_pct
     *               roiMeasures:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     measureId: { type: string }
     *                     description: { type: string }
     *                     estimatedRoiEurPerYear: { type: number }
     *                     implementationCostEur: { type: number }
     *                     paybackMonths: { type: number }
     *               forbiddenAssumptions: { type: array, items: { type: string } }
     *               assessorRole: { type: string }
     *     responses:
     *       200:
     *         description: 100-day assessment result with management template
     */
    assess: {
      rest: 'POST /assessments',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        kpiValues: { type: 'object' },
        roiMeasures: { type: 'array', items: 'object', optional: true, default: [] },
        forbiddenAssumptions: { type: 'array', items: 'string', optional: true, default: [] },
        assessorRole: { type: 'string', optional: true },
        label: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, kpiValues, roiMeasures, forbiddenAssumptions, assessorRole, label } =
          ctx.params;
        const assessmentId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const scoredDomains = ASSESSMENT_DOMAINS.map((d) => scoreDomain(d, kpiValues));

        const scoredWithData = scoredDomains.filter((d) => d.domainScore !== null);
        const overallScore =
          scoredWithData.length > 0
            ? Math.round(scoredWithData.reduce((s, d) => s + d.domainScore, 0) / scoredWithData.length)
            : null;

        // Top 3 priority actions (lowest scoring domains)
        const priorityActions = [...scoredWithData]
          .sort((a, b) => (a.domainScore ?? 0) - (b.domainScore ?? 0))
          .slice(0, 3)
          .map((d) => ({
            domainId: d.domainId,
            domainLabel: d.label,
            domainScore: d.domainScore,
            worstKpis: d.kpiScores
              .filter((k) => k.status === 'OFF_TARGET')
              .slice(0, 2)
              .map((k) => k.kpiId),
          }));

        const totalRoiEur = roiMeasures.reduce((s, m) => s + (m.estimatedRoiEurPerYear ?? 0), 0);

        const managementTemplate = {
          headline: `VNB 100-Tage Quick Assessment — Gesamtscore: ${overallScore ?? 'Unvollständig'}%`,
          topPriorityActions: priorityActions,
          roiTopLine:
            roiMeasures.length > 0
              ? `${roiMeasures.length} Hebel identifiziert, geschätztes ROI-Potenzial: ${(totalRoiEur / 1000).toFixed(0)} T€/Jahr`
              : 'ROI-Hebel noch nicht bewertet',
          forbiddenAssumptions:
            forbiddenAssumptions.length > 0
              ? forbiddenAssumptions
              : [
                  'Kein N-1-Mangel ohne physische Messung annehmen',
                  'Kein regulatorisches Ergebnis ohne Rechtsberatung zusagen',
                  'Keine Kostensenkung annehmen ohne Baseline-Messung',
                ],
          nextSteps: [
            'Datenqualitätslücken je Domain schließen (Benchmark-Vergleich)',
            'ROI-Hebel durch Einzelmaßnahmen konkretisieren',
            'Priorisierungsentscheidung in Managementbriefing dokumentieren',
          ],
        };

        const doc = {
          _id: assessmentId,
          type: 'vnb-100-tage-assessment',
          tenantId,
          gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          label: label ?? null,
          assessorRole: assessorRole ?? null,
          createdAt: nowIso(),
          overallScore,
          scoredDomains,
          roiMeasures,
          forbiddenAssumptions: managementTemplate.forbiddenAssumptions,
          managementTemplate,
        };

        await this.db.put(doc);
        this.logger.info(
          `VNB 100-Tage assessment ${assessmentId}: overallScore=${overallScore}, roiHebel=${roiMeasures.length}`
        );

        return {
          assessmentId,
          overallScore,
          scoredDomains,
          roiMeasures,
          managementTemplate,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/vnb-100-tage-assessment/assessments:
     *   get:
     *     tags: [VNB 100-Tage Assessment]
     *     summary: List VNB 100-Tage assessments
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
     *         description: List of assessments
     */
    list: {
      rest: 'GET /assessments',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, limit } = ctx.params;

        const selector = { tenantId, type: 'vnb-100-tage-assessment' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { assessments: result.docs };
      },
    },

    /**
     * @openapi
     * /api/vnb-100-tage-assessment/assessments/{id}:
     *   get:
     *     tags: [VNB 100-Tage Assessment]
     *     summary: Get assessment by ID
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
