'use strict';

/**
 * NKP Reporting Service — Netzkoppelpunkt-Rohdaten zu Steuerungsimpulsen
 *
 * Issue #118 — NKP-Reporting Rohdaten zu Steuerungsimpulsen
 *
 * DSOs regularly generate network node / network coupling point (NKP) reports
 * as Excel or raw data snapshots. These data are technically valuable but are
 * frequently manually plausibilized, consolidated, and only late converted into
 * control/KPI/regulatory processes.
 *
 * This service provides:
 *   1. Import and plausibility check of NKP raw report data
 *   2. Automatic conversion to controllable action impulses
 *   3. Data quality checks (completeness, outliers, timestamp gaps)
 *   4. KPI extraction (load factor, availability, voltage band violations)
 *   5. Regulatory-relevant metrics output
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'NKP Reporting';
const DOC_PREFIX = 'nkp:';

// Data quality check thresholds
const LOAD_FACTOR_WARNING = 0.85;
const LOAD_FACTOR_CRITICAL = 0.95;
const VOLTAGE_DEVIATION_WARNING_PCT = 2.5;
const VOLTAGE_DEVIATION_CRITICAL_PCT = 3.0;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Run plausibility checks on raw NKP measurement rows.
 */
function runPlausibilityChecks(rows) {
  const issues = [];
  const stats = {
    totalRows: rows.length,
    nullLoadingRows: 0,
    nullVoltageRows: 0,
    timestampGaps: 0,
    outliersHigh: 0,
  };

  let lastTs = null;
  for (const row of rows) {
    if (row.loadingPct == null) stats.nullLoadingRows++;
    if (row.voltagePu == null) stats.nullVoltageRows++;
    if (row.timestamp && lastTs) {
      // detect gaps > 60 minutes in 15-min data
      const diffMin = (new Date(row.timestamp) - new Date(lastTs)) / 60000;
      if (diffMin > 60) stats.timestampGaps++;
    }
    if (row.timestamp) lastTs = row.timestamp;
    if (row.loadingPct > 120) stats.outliersHigh++;
  }

  if (stats.nullLoadingRows / rows.length > 0.1) {
    issues.push({
      code: 'NKP_DQ_MISSING_LOADING',
      severity: 'WARNING',
      message: `${stats.nullLoadingRows} Zeilen ohne Auslastungswert (>${((stats.nullLoadingRows / rows.length) * 100).toFixed(0)}%)`,
    });
  }
  if (stats.nullVoltageRows / rows.length > 0.1) {
    issues.push({
      code: 'NKP_DQ_MISSING_VOLTAGE',
      severity: 'WARNING',
      message: `${stats.nullVoltageRows} Zeilen ohne Spannungswert`,
    });
  }
  if (stats.timestampGaps > 0) {
    issues.push({
      code: 'NKP_DQ_TIMESTAMP_GAP',
      severity: 'INFO',
      message: `${stats.timestampGaps} Zeitlücken > 60 Minuten erkannt`,
    });
  }
  if (stats.outliersHigh > 0) {
    issues.push({
      code: 'NKP_DQ_OUTLIER_HIGH_LOADING',
      severity: 'WARNING',
      message: `${stats.outliersHigh} Messwerte mit Auslastung > 120% (implausibel)`,
    });
  }

  return { issues, stats };
}

/**
 * Extract KPIs from measurement rows.
 */
function extractKpis(rows) {
  const validLoading = rows.filter((r) => r.loadingPct != null).map((r) => r.loadingPct);
  const validVoltage = rows.filter((r) => r.voltagePu != null).map((r) => r.voltagePu);

  if (validLoading.length === 0) {
    return {
      avgLoadingPct: null,
      maxLoadingPct: null,
      loadFactorStatus: 'NO_DATA',
      voltageDeviationStatus: 'NO_DATA',
      availabilityPct: 0,
    };
  }

  const avgLoading = validLoading.reduce((s, v) => s + v, 0) / validLoading.length;
  const maxLoading = Math.max(...validLoading);

  // Voltage deviation from nominal (1.0 pu)
  const maxVoltageDeviation =
    validVoltage.length > 0
      ? Math.max(...validVoltage.map((v) => Math.abs(v - 1.0) * 100))
      : null;

  const loadFactorStatus =
    maxLoading >= LOAD_FACTOR_CRITICAL * 100
      ? 'CRITICAL'
      : maxLoading >= LOAD_FACTOR_WARNING * 100
        ? 'WARNING'
        : 'OK';

  const voltageDeviationStatus =
    maxVoltageDeviation === null
      ? 'NO_DATA'
      : maxVoltageDeviation >= VOLTAGE_DEVIATION_CRITICAL_PCT
        ? 'CRITICAL'
        : maxVoltageDeviation >= VOLTAGE_DEVIATION_WARNING_PCT
          ? 'WARNING'
          : 'OK';

  // Availability = rows with loading data / expected rows
  const availabilityPct = (validLoading.length / rows.length) * 100;

  return {
    avgLoadingPct: Math.round(avgLoading * 10) / 10,
    maxLoadingPct: Math.round(maxLoading * 10) / 10,
    maxVoltageDeviationPct: maxVoltageDeviation !== null ? Math.round(maxVoltageDeviation * 100) / 100 : null,
    loadFactorStatus,
    voltageDeviationStatus,
    availabilityPct: Math.round(availabilityPct * 10) / 10,
  };
}

/**
 * Derive action impulses from KPIs and quality issues.
 */
function deriveActionImpulses(kpis, qualityIssues, nkpId) {
  const impulses = [];

  if (kpis.loadFactorStatus === 'CRITICAL') {
    impulses.push({
      impulseType: 'OVERLOAD_ALERT',
      priority: 'CRITICAL',
      nkpId,
      message: `NKP ${nkpId}: Kritische Auslastung ${kpis.maxLoadingPct}% — Sofortmaßnahme prüfen`,
      regulatoryRelevance: 'HIGH',
      actionRequired: 'Kapazitätserweiterung oder Lastmanagement einleiten',
    });
  } else if (kpis.loadFactorStatus === 'WARNING') {
    impulses.push({
      impulseType: 'LOAD_WARNING',
      priority: 'MEDIUM',
      nkpId,
      message: `NKP ${nkpId}: Erhöhte Auslastung ${kpis.maxLoadingPct}% — Beobachtung intensivieren`,
      regulatoryRelevance: 'MEDIUM',
      actionRequired: 'Auslastungsprognose aktualisieren, Erweiterungsplanung prüfen',
    });
  }

  if (kpis.voltageDeviationStatus === 'CRITICAL') {
    impulses.push({
      impulseType: 'VOLTAGE_VIOLATION',
      priority: 'CRITICAL',
      nkpId,
      message: `NKP ${nkpId}: Spannungsabweichung ${kpis.maxVoltageDeviationPct}% überschreitet EN 50160 Grenzwert`,
      regulatoryRelevance: 'HIGH',
      actionRequired: 'Spannungsregelung prüfen, ggf. Blindleistungsmanagement aktivieren',
    });
  }

  for (const issue of qualityIssues.filter((i) => i.severity !== 'INFO')) {
    impulses.push({
      impulseType: 'DATA_QUALITY_ACTION',
      priority: issue.severity === 'WARNING' ? 'LOW' : 'INFO',
      nkpId,
      message: issue.message,
      regulatoryRelevance: 'LOW',
      actionRequired: 'Datenqualität im Quellsystem verbessern',
    });
  }

  return impulses;
}

module.exports = {
  name: 'nkp-reporting',

  settings: {
    dbPath: process.env.NKP_REPORTING_DB_PATH || './data/nkp-reporting',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['gridOperatorId'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['nkpId'] } });
    this.logger.info(`NKP Reporting DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/nkp-reporting/imports:
     *   post:
     *     tags: [NKP Reporting]
     *     summary: Import NKP raw report data and convert to action impulses
     *     description: >
     *       Accepts NKP measurement rows, runs plausibility checks, extracts KPIs,
     *       and derives prioritised action impulses for operations and management.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, nkpId, reportRows]
     *             properties:
     *               gridOperatorId: { type: string }
     *               nkpId: { type: string }
     *               nkpLabel: { type: string }
     *               reportRows:
     *                 type: array
     *                 description: Measurement rows with at least timestamp, loadingPct, and/or voltagePu
     *                 items:
     *                   type: object
     *                   properties:
     *                     timestamp: { type: string }
     *                     loadingPct: { type: number }
     *                     voltagePu: { type: number }
     *               reportPeriodStart: { type: string }
     *               reportPeriodEnd: { type: string }
     *     responses:
     *       200:
     *         description: Import result with KPIs and action impulses
     */
    importReport: {
      rest: 'POST /imports',
      timeout: 60_000,
      params: {
        gridOperatorId: { type: 'string' },
        nkpId: { type: 'string' },
        nkpLabel: { type: 'string', optional: true },
        reportRows: { type: 'array', items: 'object', min: 1 },
        reportPeriodStart: { type: 'string', optional: true },
        reportPeriodEnd: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, nkpId, nkpLabel, reportRows, reportPeriodStart, reportPeriodEnd } =
          ctx.params;
        const importId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const { issues: qualityIssues, stats: qualityStats } = runPlausibilityChecks(reportRows);
        const kpis = extractKpis(reportRows);
        const actionImpulses = deriveActionImpulses(kpis, qualityIssues, nkpId);

        const overallDataQuality =
          qualityIssues.filter((i) => i.severity === 'WARNING').length > 2
            ? 'POOR'
            : qualityIssues.filter((i) => i.severity === 'WARNING').length > 0
              ? 'ACCEPTABLE'
              : 'GOOD';

        const doc = {
          _id: importId,
          type: 'nkp-report-import',
          tenantId,
          gridOperatorId,
          nkpId,
          nkpLabel: nkpLabel ?? null,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
          reportPeriodStart: reportPeriodStart ?? null,
          reportPeriodEnd: reportPeriodEnd ?? null,
          rowCount: reportRows.length,
          overallDataQuality,
          qualityStats,
          qualityIssues,
          kpis,
          actionImpulses,
          actionImpulseCount: actionImpulses.length,
          criticalImpulseCount: actionImpulses.filter((i) => i.priority === 'CRITICAL').length,
        };

        await this.db.put(doc);
        this.logger.info(
          `NKP import ${importId} (${nkpId}): quality=${overallDataQuality}, impulses=${actionImpulses.length}`
        );

        return {
          importId,
          nkpId,
          overallDataQuality,
          qualityStats,
          qualityIssues,
          kpis,
          actionImpulses,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/nkp-reporting/imports:
     *   get:
     *     tags: [NKP Reporting]
     *     summary: List NKP report imports
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: nkpId
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of imports
     */
    list: {
      rest: 'GET /imports',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        nkpId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, nkpId, limit } = ctx.params;

        const selector = { tenantId, type: 'nkp-report-import' };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (nkpId) selector.nkpId = nkpId;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { imports: result.docs };
      },
    },

    /**
     * @openapi
     * /api/nkp-reporting/imports/{id}:
     *   get:
     *     tags: [NKP Reporting]
     *     summary: Get NKP report import by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Import document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /imports/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Import not found', 404, 'IMPORT_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
