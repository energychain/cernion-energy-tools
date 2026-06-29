'use strict';

/**
 * Re4DE-aligned Layer-3 variable grid-fee service.
 *
 * Issue: #224
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const OPENAPI_TAG = 'Re4DE Variable Grid Fee';
const CALCULATION_PREFIX = 're4de-vgf:';
const CALCULATION_VERSION = 'cernion.re4de.variableGridFeeCalculation.v1';
const TARIFF_SCHEMA = 'cernion.re4de.tariffSheet.v1';

function nowIso() {
  return new Date().toISOString();
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function roundKwh(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
}

function parseClock(value) {
  if (value === '24:00') return 24 * 60;
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseIsoOffsetMinutes(value) {
  const text = String(value || '');
  if (text.endsWith('Z')) return 0;
  const match = text.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function shiftedDate(date, offsetMinutes) {
  return new Date(date.getTime() + offsetMinutes * 60 * 1000);
}

function minutesOfDay(date, offsetMinutes) {
  const local = shiftedDate(date, offsetMinutes);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function dayTypeFor(date, offsetMinutes) {
  const day = shiftedDate(date, offsetMinutes).getUTCDay();
  return day === 0 || day === 6 ? 'weekend' : 'workday';
}

function normalizeWindow(window, index) {
  const from = parseClock(window.from);
  const to = parseClock(window.to);
  if (from == null || to == null || from === to || typeof window.priceCtPerKwh !== 'number') {
    return {
      valid: false,
      finding: {
        finding: 'RE4DE_TARIFF_WINDOW_INVALID',
        severity: 'error',
        message: `Tariff window ${window.windowId || index} is invalid`,
        windowId: window.windowId || null,
      },
    };
  }
  return {
    valid: true,
    window: {
      windowId: window.windowId || `window-${index + 1}`,
      dayType: window.dayType || 'all',
      from,
      to,
      priceCtPerKwh: window.priceCtPerKwh,
      priority: Number(window.priority || 0),
      raw: window,
    },
  };
}

function windowSegmentsForDay(window) {
  if (window.from < window.to) {
    return [{ from: window.from, to: window.to }];
  }
  return [
    { from: window.from, to: 24 * 60 },
    { from: 0, to: window.to },
  ];
}

function validateTariffSheet(tariffSheet) {
  const findings = [];
  if (!tariffSheet || typeof tariffSheet !== 'object') {
    findings.push({
      finding: 'RE4DE_TARIFF_SHEET_MISSING',
      severity: 'error',
      message: 'A tariff sheet is required for variable grid-fee calculation',
    });
    return { findings, windows: [] };
  }

  for (const field of [
    'tariffSheetId',
    'version',
    'gridAreaId',
    'currency',
    'priceUnit',
    'timezone',
  ]) {
    if (!tariffSheet[field]) {
      findings.push({
        finding: 'RE4DE_TARIFF_FIELD_MISSING',
        severity: 'error',
        message: `Tariff sheet field ${field} is required`,
        field,
      });
    }
  }

  if (tariffSheet.currency && tariffSheet.currency !== 'EUR') {
    findings.push({
      finding: 'RE4DE_TARIFF_CURRENCY_UNSUPPORTED',
      severity: 'error',
      message: 'Only EUR tariff sheets are supported in v1',
    });
  }
  if (tariffSheet.priceUnit && tariffSheet.priceUnit !== 'ct/kWh') {
    findings.push({
      finding: 'RE4DE_TARIFF_PRICE_UNIT_UNSUPPORTED',
      severity: 'error',
      message: 'Only ct/kWh tariff windows are supported in v1',
    });
  }

  const windows = [];
  for (const [index, window] of (tariffSheet.windows || []).entries()) {
    const normalized = normalizeWindow(window, index);
    if (!normalized.valid) findings.push(normalized.finding);
    else windows.push(normalized.window);
  }
  if (windows.length === 0) {
    findings.push({
      finding: 'RE4DE_TARIFF_WINDOWS_MISSING',
      severity: 'error',
      message: 'At least one valid tariff window is required',
    });
  }

  return { findings, windows };
}

function validateMeteringInput(meteringInput, tariffSheet) {
  const findings = [];
  if (!meteringInput || typeof meteringInput !== 'object') {
    findings.push({
      finding: 'RE4DE_METERING_INPUT_MISSING',
      severity: 'error',
      message: 'JSON interval metering input is required',
    });
    return findings;
  }
  if (!Array.isArray(meteringInput.values) || meteringInput.values.length === 0) {
    findings.push({
      finding: 'RE4DE_METERING_INTERVALS_MISSING',
      severity: 'error',
      message: 'At least one metering interval is required',
    });
  }
  if (
    tariffSheet?.timezone &&
    meteringInput.timezone &&
    tariffSheet.timezone !== meteringInput.timezone
  ) {
    findings.push({
      finding: 'RE4DE_TIMEZONE_MISMATCH',
      severity: 'error',
      message: `Tariff timezone ${tariffSheet.timezone} does not match metering timezone ${meteringInput.timezone}`,
    });
  }
  return findings;
}

function findApplicableWindow(windows, date, offsetMinutes) {
  const minute = minutesOfDay(date, offsetMinutes);
  const dayType = dayTypeFor(date, offsetMinutes);
  const candidates = windows
    .filter((window) => window.dayType === 'all' || window.dayType === dayType)
    .filter((window) =>
      windowSegmentsForDay(window).some((segment) => minute >= segment.from && minute < segment.to)
    )
    .sort((a, b) => b.priority - a.priority);
  return candidates[0] || null;
}

function calculateWindowBreakdown(meteringInput, windows) {
  const breakdown = new Map();
  const findings = [];
  let totalKwh = 0;
  let variableFeeEur = 0;
  let periodFrom = null;
  let periodTo = null;

  for (const [index, interval] of meteringInput.values.entries()) {
    const from = new Date(interval.from);
    const to = new Date(interval.to);
    const kwh = Number(interval.kwh);
    if (
      !interval.from ||
      !interval.to ||
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from ||
      Number.isNaN(kwh)
    ) {
      findings.push({
        finding: 'RE4DE_METERING_INTERVAL_INVALID',
        severity: 'error',
        message: `Metering interval ${index} is invalid`,
        index,
      });
      continue;
    }

    periodFrom = periodFrom && periodFrom < from ? periodFrom : from;
    periodTo = periodTo && periodTo > to ? periodTo : to;
    totalKwh += kwh;

    const durationMs = to.getTime() - from.getTime();
    const offsetMinutes = parseIsoOffsetMinutes(interval.from);
    let cursor = new Date(from);
    while (cursor < to) {
      const window = findApplicableWindow(windows, cursor, offsetMinutes);
      if (!window) {
        findings.push({
          finding: 'RE4DE_TARIFF_WINDOW_NOT_FOUND',
          severity: 'error',
          message: `No tariff window covers interval ${index}`,
          index,
        });
        break;
      }

      const localCursor = shiftedDate(cursor, offsetMinutes);
      const localDayStart = Date.UTC(
        localCursor.getUTCFullYear(),
        localCursor.getUTCMonth(),
        localCursor.getUTCDate()
      );
      const cursorMinute = minutesOfDay(cursor, offsetMinutes);
      const segment = windowSegmentsForDay(window).find(
        (s) => cursorMinute >= s.from && cursorMinute < s.to
      );
      const segmentEnd = new Date(
        localDayStart + segment.to * 60 * 1000 - offsetMinutes * 60 * 1000
      );
      const next = segmentEnd < to ? segmentEnd : to;
      const share = (next.getTime() - cursor.getTime()) / durationMs;
      const segmentKwh = kwh * share;
      const eur = (segmentKwh * window.priceCtPerKwh) / 100;
      const current = breakdown.get(window.windowId) || {
        windowId: window.windowId,
        kwh: 0,
        priceCtPerKwh: window.priceCtPerKwh,
        eur: 0,
      };
      current.kwh += segmentKwh;
      current.eur += eur;
      breakdown.set(window.windowId, current);
      variableFeeEur += eur;
      cursor = next;
    }
  }

  return {
    findings,
    totalKwh: roundKwh(totalKwh),
    variableFeeEur: roundMoney(variableFeeEur),
    period:
      periodFrom && periodTo
        ? { from: periodFrom.toISOString(), to: periodTo.toISOString() }
        : null,
    windowBreakdown: Array.from(breakdown.values()).map((entry) => ({
      ...entry,
      kwh: roundKwh(entry.kwh),
      eur: roundMoney(entry.eur),
    })),
  };
}

function prorateBasePrice(basePriceEurPerYear, period) {
  if (!basePriceEurPerYear || !period) return 0;
  const from = new Date(period.from);
  const to = new Date(period.to);
  const days = Math.max(0, (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  return roundMoney((Number(basePriceEurPerYear) * days) / 365);
}

function buildEvidence(calculation) {
  return {
    found: true,
    evidenceId: calculation.evidenceId,
    calculationId: calculation.calculationId,
    tariffSheetId: calculation.tariffSheetId,
    tariffSheetVersion: calculation.tariffSheetVersion,
    gridAreaId: calculation.gridAreaId,
    period: calculation.period,
    totalKwh: calculation.totalKwh,
    variableFeeEur: calculation.variableFeeEur,
    basePriceEur: calculation.basePriceEur,
    totalEur: calculation.totalEur,
    section14aApplied: calculation.section14aApplied,
    validationFindings: calculation.validationFindings,
    sourceActions: calculation.sourceActions,
    calculatedAt: calculation.calculatedAt,
  };
}

module.exports = {
  name: 're4de-variable-grid-fee',

  settings: {
    dbPath: process.env.RE4DE_VARIABLE_GRID_FEE_DB_PATH || './data/re4de-variable-grid-fee',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId', 'docType'] } });
    await this.db.createIndex({ index: { fields: ['calculationId'] } });
    await this.db.createIndex({ index: { fields: ['gridAreaId'] } });
    await this.db.createIndex({ index: { fields: ['calculatedAt'] } });
    this.logger.info(`Re4DE Variable Grid Fee DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/re4de-variable-grid-fee/calculate:
     *   post:
     *     tags: [Re4DE Variable Grid Fee]
     *     summary: Calculate a Re4DE-aligned variable grid fee
     *     security:
     *       - bearerAuth: []
     */
    calculate: {
      rest: 'POST /calculate',
      params: {
        tariffSheet: { type: 'object' },
        meteringInput: { type: 'object' },
        section14aConfig: { type: 'object', optional: true },
        sourceActions: { type: 'array', optional: true, default: [] },
      },
      openapi: {
        summary: 'Calculate a Re4DE-aligned variable grid fee',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { tariffSheet, meteringInput, section14aConfig, sourceActions } = ctx.params;
        const tariffValidation = validateTariffSheet(tariffSheet);
        const findings = [
          ...tariffValidation.findings,
          ...validateMeteringInput(meteringInput, tariffSheet),
        ];

        let calculation = {
          findings: [],
          totalKwh: 0,
          variableFeeEur: 0,
          basePriceEur: 0,
          totalEur: 0,
          period: null,
          windowBreakdown: [],
        };

        if (!findings.some((finding) => finding.severity === 'error')) {
          calculation = calculateWindowBreakdown(meteringInput, tariffValidation.windows);
          findings.push(...calculation.findings);
        }

        const hasError = findings.some((finding) => finding.severity === 'error');
        const basePriceEur = hasError
          ? 0
          : prorateBasePrice(tariffSheet.basePriceEurPerYear, calculation.period);
        const calculationId = `${CALCULATION_PREFIX}${crypto.randomUUID()}`;
        const evidenceId = `evidence:${calculationId}`;
        const calculatedAt = nowIso();
        const doc = {
          _id: calculationId,
          docType: 're4de-variable-grid-fee-calculation',
          tenantId,
          calculationId,
          evidenceId,
          schema: CALCULATION_VERSION,
          tariffSchema: TARIFF_SCHEMA,
          tariffSheetId: tariffSheet?.tariffSheetId || null,
          tariffSheetVersion: tariffSheet?.version || null,
          gridAreaId: tariffSheet?.gridAreaId || null,
          period: calculation.period,
          totalKwh: calculation.totalKwh,
          variableFeeEur: calculation.variableFeeEur,
          basePriceEur,
          totalEur: hasError ? 0 : roundMoney(calculation.variableFeeEur + basePriceEur),
          windowBreakdown: calculation.windowBreakdown,
          section14aConfig: section14aConfig || null,
          section14aApplied: Boolean(section14aConfig?.eligible),
          validationFindings: findings,
          status: hasError ? 'invalid' : 'calculated',
          sourceActions: Array.isArray(sourceActions) ? sourceActions : [],
          inputHash: crypto
            .createHash('sha256')
            .update(JSON.stringify({ tariffSheet, meteringInput, section14aConfig }))
            .digest('hex'),
          calculationVersion: CALCULATION_VERSION,
          calculatedAt,
        };

        await this.db.put(doc);
        return doc;
      },
    },

    getCalculation: {
      rest: 'GET /calculations/:calculationId',
      params: { calculationId: { type: 'string' } },
      openapi: {
        summary: 'Get a variable grid-fee calculation',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const calculation = await this.db.get(ctx.params.calculationId);
          if (calculation.tenantId !== tenantId) {
            throw new MoleculerClientError('Calculation not found', 404, 'CALCULATION_NOT_FOUND');
          }
          return calculation;
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Calculation not found', 404, 'CALCULATION_NOT_FOUND');
          }
          throw err;
        }
      },
    },

    getEvidence: {
      rest: 'GET /calculations/:calculationId/evidence',
      params: { calculationId: { type: 'string' } },
      openapi: {
        summary: 'Get dossier-safe evidence for a variable grid-fee calculation',
        tags: [OPENAPI_TAG],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        try {
          const calculation = await this.db.get(ctx.params.calculationId);
          if (calculation.tenantId !== tenantId) {
            throw new MoleculerClientError(
              'Calculation evidence not found',
              404,
              'EVIDENCE_NOT_FOUND'
            );
          }
          return buildEvidence(calculation);
        } catch (err) {
          if (err.status === 404) {
            return {
              found: false,
              message:
                'No Re4DE variable grid-fee calculation evidence is available for this tenant yet',
            };
          }
          throw err;
        }
      },
    },
  },
};
