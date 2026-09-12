'use strict';

/**
 * Forecast Sandbox v0.1 — deterministic baseline logic (CR-CET-FORECAST-SANDBOX-V0.1).
 *
 * Pure, stateless functions: no PouchDB, no I/O, nothing persisted. That statelessness is
 * deliberate — it is what lets the sandbox run without ever needing to store customer
 * consumption data server-side. Reuses `calculateForecastQuality` from
 * `./forecast-calculator` for MAE/RMSE/MAPE/bias rather than re-deriving those (same
 * division-by-zero guard on MAPE the rest of the forecast stack already relies on).
 */

const { calculateForecastQuality } = require('./forecast-calculator');

const SANDBOX_VERSION = 'forecast_sandbox_v0.1';
const METHOD_ID = 'baseline_weekday_profile_v0';
const QUARTER_HOUR_MS = 15 * 60 * 1000;
const SUPPORTED_GRANULARITY = 'PT15M';
const SUPPORTED_UNITS = new Set(['kWh', 'kW']);

// Minimum training coverage before a weekday-profile baseline is considered meaningful.
// 14 days ensures every weekday/weekend bucket has at least one historical sample; below
// that the profile would silently fall back to overall-average for entire weekdays.
const MIN_HISTORY_INTERVALS = 14 * 96;
const MIN_BACKTEST_TRAIN_INTERVALS = 14 * 96;

const ERROR_CODES = Object.freeze({
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_GRANULARITY: 'INVALID_GRANULARITY',
  MISSING_VALUES: 'MISSING_VALUES',
  DUPLICATE_INTERVALS: 'DUPLICATE_INTERVALS',
  INSUFFICIENT_HISTORY: 'INSUFFICIENT_HISTORY',
  INVALID_BACKTEST_PERIOD: 'INVALID_BACKTEST_PERIOD',
  ZERO_VALUES_FOR_MAPE: 'ZERO_VALUES_FOR_MAPE',
  UNSUPPORTED_UNIT: 'UNSUPPORTED_UNIT',
  INTERNAL_FORECAST_ERROR: 'INTERNAL_FORECAST_ERROR',
});

class SandboxRequestError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SandboxRequestError';
    this.code = code;
    this.details = details || {};
  }
}

function commercialBoundary(overrides = {}) {
  return {
    scope: 'sandbox',
    productionUse: false,
    sla: false,
    forecastQualityGuarantee: false,
    balancingEnergyRiskReductionGuarantee: false,
    nextCommercialStep: 'paid_backtest_mini_check',
    ...overrides,
  };
}

function errorEnvelope(err, extraBoundary = {}) {
  const code = err instanceof SandboxRequestError ? err.code : ERROR_CODES.INTERNAL_FORECAST_ERROR;
  return {
    status: 'error',
    sandboxVersion: SANDBOX_VERSION,
    error: {
      code,
      message: err.message || 'Forecast sandbox request could not be processed.',
      details: (err instanceof SandboxRequestError && err.details) || {},
    },
    commercialBoundary: commercialBoundary({
      nextCommercialStep: 'data_readiness_clarification',
      ...extraBoundary,
    }),
  };
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * factor) / factor : 0;
}

function toEpochMs(ts) {
  const parsed = new Date(ts);
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Instant-of-day parts (year/month/day/hour/minute/weekday) in a given IANA timezone,
// derived from the UTC instant rather than trusting the offset embedded in the source
// string — so a mislabelled offset in a submitted timestamp can't skew bucketing.
function getLocalParts(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    parts[part.type] = part.value;
  }
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

function getUtcOffsetMinutes(utcMs, timeZone) {
  const p = getLocalParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  return Math.round((asUtc - utcMs) / 60000);
}

// Resolves the UTC instant for local midnight of {year, month, day} in timeZone, using a
// two-pass fixed-point correction so the result is exact across a DST transition.
function localMidnightUtcMs(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset1 = getUtcOffsetMinutes(guess, timeZone);
  const corrected = guess - offset1 * 60000;
  const offset2 = getUtcOffsetMinutes(corrected, timeZone);
  return guess - offset2 * 60000;
}

function toIsoWithOffset(utcMs, timeZone) {
  const p = getLocalParts(utcMs, timeZone);
  const offsetMinutes = getUtcOffsetMinutes(utcMs, timeZone);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${offH}:${offM}`;
}

// Weekday+quarter-hour-of-day bucket key, e.g. "Tue-08:30".
function bucketKey(utcMs, timeZone) {
  const p = getLocalParts(utcMs, timeZone);
  return `${p.weekday}-${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function dayKey(utcMs, timeZone) {
  const p = getLocalParts(utcMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

// Normalises a raw {ts, value}[] into sorted, deduplicated instants plus quality counters.
// Values whose ts cannot be parsed at all are reported separately (invalidTimestampCount)
// rather than silently dropped, since an unparseable-ts payload is a hard INVALID_TIMESTAMP.
function normalizeSeries(rawValues) {
  const parsed = [];
  let invalidTimestampCount = 0;

  for (const row of Array.isArray(rawValues) ? rawValues : []) {
    const ms = toEpochMs(row && row.ts);
    const value = Number(row && row.value);
    if (ms === null) {
      invalidTimestampCount += 1;
      continue;
    }
    if (!Number.isFinite(value)) {
      invalidTimestampCount += 1;
      continue;
    }
    parsed.push({ ms, value });
  }

  parsed.sort((a, b) => a.ms - b.ms);

  const deduped = [];
  const seen = new Map();
  let duplicateIntervals = 0;
  for (const row of parsed) {
    if (seen.has(row.ms)) {
      duplicateIntervals += 1;
      continue;
    }
    seen.set(row.ms, true);
    deduped.push(row);
  }

  let missingIntervals = 0;
  let irregularGaps = 0;
  for (let i = 1; i < deduped.length; i += 1) {
    const delta = deduped[i].ms - deduped[i - 1].ms;
    if (delta === QUARTER_HOUR_MS) continue;
    if (delta > 0 && delta % QUARTER_HOUR_MS === 0) {
      missingIntervals += delta / QUARTER_HOUR_MS - 1;
    } else {
      irregularGaps += 1;
    }
  }

  return {
    rows: deduped,
    invalidTimestampCount,
    duplicateIntervals,
    missingIntervals,
    irregularGaps,
  };
}

function median(sortedValues) {
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[mid - 1] + sortedValues[mid]) / 2
    : sortedValues[mid];
}

function detectOutliers(rows) {
  if (rows.length < 5) return 0;
  const values = rows.map((r) => r.value);
  const sortedValues = values.slice().sort((a, b) => a - b);
  const med = median(sortedValues);
  const deviations = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = median(deviations);
  // Scaled MAD (×1.4826) approximates a standard deviation for normally distributed data;
  // 5 scaled-MAD is a conservative threshold chosen to avoid flagging routine load swings.
  let scale = mad * 1.4826;
  if (scale === 0) {
    // Bulk of the series is identical (MAD collapses to 0) — fall back to the population
    // standard deviation so a single extreme spike in an otherwise-flat series is still
    // flagged instead of being masked by the degenerate MAD.
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    scale = Math.sqrt(variance);
  }
  if (scale === 0) return 0;
  const threshold = 5 * scale;
  return rows.reduce(
    (count, row) => (Math.abs(row.value - med) > threshold ? count + 1 : count),
    0
  );
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null);
  if (missing.length > 0) {
    throw new SandboxRequestError(
      ERROR_CODES.INVALID_PAYLOAD,
      `Missing required field(s): ${missing.join(', ')}.`,
      { missingFields: missing }
    );
  }
}

function assertSupportedGranularity(granularity) {
  if (granularity !== SUPPORTED_GRANULARITY) {
    throw new SandboxRequestError(
      ERROR_CODES.INVALID_GRANULARITY,
      `Expected ${SUPPORTED_GRANULARITY} quarter-hourly values but received granularity "${granularity}".`,
      { expectedGranularity: SUPPORTED_GRANULARITY, receivedGranularity: String(granularity) }
    );
  }
}

function assertSupportedUnit(unit) {
  if (!SUPPORTED_UNITS.has(unit)) {
    throw new SandboxRequestError(
      ERROR_CODES.UNSUPPORTED_UNIT,
      `Unit "${unit}" is not supported in forecast sandbox v0.1. Supported units: ${[...SUPPORTED_UNITS].join(', ')}.`,
      { receivedUnit: String(unit), supportedUnits: [...SUPPORTED_UNITS] }
    );
  }
}

/**
 * POST /consumption/validate
 */
function validateConsumptionSeries(payload) {
  requireFields(payload, ['seriesId', 'granularity', 'timezone', 'unit', 'values']);
  assertSupportedGranularity(payload.granularity);
  assertSupportedUnit(payload.unit);

  if (!Array.isArray(payload.values) || payload.values.length === 0) {
    throw new SandboxRequestError(ERROR_CODES.INVALID_PAYLOAD, 'values must be a non-empty array.');
  }

  const options = payload.options || {};
  const timezone = payload.timezone;
  const { rows, invalidTimestampCount, duplicateIntervals, missingIntervals, irregularGaps } =
    normalizeSeries(payload.values);

  if (invalidTimestampCount > 0 && rows.length === 0) {
    throw new SandboxRequestError(
      ERROR_CODES.INVALID_TIMESTAMP,
      'None of the submitted values had a parseable timestamp/value pair.',
      { invalidTimestampCount }
    );
  }

  const irregularRatio = rows.length > 1 ? irregularGaps / (rows.length - 1) : 0;
  if (irregularRatio > 0.1) {
    throw new SandboxRequestError(
      ERROR_CODES.INVALID_GRANULARITY,
      `Expected ${SUPPORTED_GRANULARITY} quarter-hourly values but detected irregular intervals.`,
      { expectedGranularity: SUPPORTED_GRANULARITY, detectedIssues: irregularGaps }
    );
  }

  const expectedIntervals = rows.length + missingIntervals;
  const coverageRatio = expectedIntervals > 0 ? round(rows.length / expectedIntervals, 6) : 0;

  const negativeValues = options.allowNegativeValues
    ? 0
    : rows.reduce((count, row) => (row.value < 0 ? count + 1 : count), 0);
  const outlierCount = options.detectOutliers === false ? 0 : detectOutliers(rows);

  const warnings = [];
  const errors = [];

  if (invalidTimestampCount > 0) {
    warnings.push({
      code: ERROR_CODES.INVALID_TIMESTAMP,
      message: `${invalidTimestampCount} value(s) had an unparseable ts/value pair and were skipped.`,
    });
  }
  if (duplicateIntervals > 0) {
    warnings.push({
      code: ERROR_CODES.DUPLICATE_INTERVALS,
      message: `${duplicateIntervals} duplicate interval(s) detected; first occurrence kept.`,
    });
  }
  if (outlierCount > 0) {
    warnings.push({
      code: 'OUTLIERS_DETECTED',
      message: `${outlierCount} potential outlier(s) detected. Forecast can proceed, but quality interpretation should consider them.`,
    });
  }
  if (negativeValues > 0) {
    warnings.push({
      code: 'NEGATIVE_VALUES_DETECTED',
      message: `${negativeValues} negative value(s) detected. Allowed for feed-in/prosumer series; check meteringType if unexpected.`,
    });
  }

  // Missing more than half the expected grid makes the series unfit for a baseline —
  // report it as a validation-level error (still status: "ok"; the request itself
  // processed fine, the *series* just isn't accepted).
  let accepted = true;
  if (coverageRatio < 0.5) {
    accepted = false;
    errors.push({
      code: ERROR_CODES.MISSING_VALUES,
      message: `Only ${Math.round(coverageRatio * 100)}% of the expected ${SUPPORTED_GRANULARITY} grid is present.`,
    });
  }

  const from = rows.length > 0 ? toIsoWithOffset(rows[0].ms, timezone) : null;
  const to = rows.length > 0 ? toIsoWithOffset(rows[rows.length - 1].ms, timezone) : null;

  return {
    status: 'ok',
    sandboxVersion: SANDBOX_VERSION,
    seriesId: payload.seriesId,
    validation: {
      accepted,
      detectedGranularity: SUPPORTED_GRANULARITY,
      timezone,
      valueCount: rows.length,
      from,
      to,
      missingIntervals,
      duplicateIntervals,
      negativeValues,
      outlierCount,
      coverageRatio,
    },
    warnings,
    errors,
    commercialBoundary: commercialBoundary({ scope: 'sandbox_validation' }),
  };
}

// Builds a weekday+quarter-hour-of-day baseline profile from historical rows, plus a
// same-quarter-hour-any-weekday fallback and a global fallback, for buckets with no
// direct weekday match yet.
function buildProfile(rows, timezone) {
  const byWeekdayQuarter = new Map();
  const byQuarterOnly = new Map();
  let globalSum = 0;

  for (const row of rows) {
    const wq = bucketKey(row.ms, timezone);
    const quarterOnly = wq.split('-')[1];

    if (!byWeekdayQuarter.has(wq)) byWeekdayQuarter.set(wq, []);
    byWeekdayQuarter.get(wq).push(row.value);

    if (!byQuarterOnly.has(quarterOnly)) byQuarterOnly.set(quarterOnly, []);
    byQuarterOnly.get(quarterOnly).push(row.value);

    globalSum += row.value;
  }

  const globalAverage = rows.length > 0 ? globalSum / rows.length : 0;

  const stats = (values) => {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.length > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1) : 0;
    return { mean, stdDev: Math.sqrt(variance), sampleSize: values.length };
  };

  return {
    predict(utcMs) {
      const wq = bucketKey(utcMs, timezone);
      const quarterOnly = wq.split('-')[1];

      if (byWeekdayQuarter.has(wq)) return stats(byWeekdayQuarter.get(wq));
      if (byQuarterOnly.has(quarterOnly)) return stats(byQuarterOnly.get(quarterOnly));
      return { mean: globalAverage, stdDev: 0, sampleSize: 0 };
    },
  };
}

/**
 * POST /consumption/day-ahead
 */
function dayAheadConsumption(payload) {
  requireFields(payload, [
    'seriesId',
    'forecastDate',
    'granularity',
    'timezone',
    'unit',
    'historicalValues',
  ]);
  assertSupportedGranularity(payload.granularity);
  assertSupportedUnit(payload.unit);

  const dateParts = parseDateOnly(payload.forecastDate);
  if (!dateParts) {
    throw new SandboxRequestError(
      ERROR_CODES.INVALID_TIMESTAMP,
      'forecastDate must be an ISO calendar date (YYYY-MM-DD).',
      { receivedForecastDate: String(payload.forecastDate) }
    );
  }

  const { rows } = normalizeSeries(payload.historicalValues);
  if (rows.length < MIN_HISTORY_INTERVALS) {
    throw new SandboxRequestError(
      ERROR_CODES.INSUFFICIENT_HISTORY,
      `At least ${MIN_HISTORY_INTERVALS} historical quarter-hour values (14 days) are required for a weekday-profile baseline; received ${rows.length}.`,
      { requiredIntervals: MIN_HISTORY_INTERVALS, receivedIntervals: rows.length }
    );
  }

  const timezone = payload.timezone;
  const options = payload.options || {};
  const includeConfidenceBand = options.includeConfidenceBand !== false;
  const includeQualityHints = options.includeQualityHints !== false;

  const dayStartMs = localMidnightUtcMs(dateParts.year, dateParts.month, dateParts.day, timezone);
  const nextDayStartMs = localMidnightUtcMs(
    dateParts.year,
    dateParts.month,
    dateParts.day + 1,
    timezone
  );
  const dayLengthMs = nextDayStartMs - dayStartMs;
  const intervalCount = Math.round(dayLengthMs / QUARTER_HOUR_MS);

  const warnings = [];
  if (dayLengthMs !== 24 * 3600 * 1000) {
    warnings.push({
      code: dayLengthMs < 24 * 3600 * 1000 ? 'DST_SPRING_FORWARD' : 'DST_FALL_BACK',
      message: `forecastDate ${payload.forecastDate} is a daylight-saving transition day in ${timezone}: ${intervalCount} quarter-hour intervals instead of 96.`,
    });
  }

  const profile = buildProfile(rows, timezone);
  const forecast = [];
  let lowSampleBuckets = 0;

  for (let i = 0; i < intervalCount; i += 1) {
    const utcMs = dayStartMs + i * QUARTER_HOUR_MS;
    const { mean, stdDev, sampleSize } = profile.predict(utcMs);
    if (sampleSize < 2) lowSampleBuckets += 1;

    const entry = { ts: toIsoWithOffset(utcMs, timezone), value: round(mean, 4) };
    if (includeConfidenceBand) {
      const band = stdDev > 0 ? 1.28 * stdDev : Math.abs(mean) * 0.15;
      entry.lower = round(Math.max(0, mean - band), 4);
      entry.upper = round(mean + band, 4);
    }
    forecast.push(entry);
  }

  if (includeQualityHints && lowSampleBuckets > 0) {
    warnings.push({
      code: 'LOW_SAMPLE_BUCKETS',
      message: `${lowSampleBuckets} of ${intervalCount} quarter-hour buckets had fewer than 2 historical samples for their weekday and fell back to a broader average.`,
    });
  }

  const values = forecast.map((f) => f.value);
  const totalKwh = round(
    values.reduce((s, v) => s + v, 0),
    4
  );
  const minKwEquivalent = round(Math.min(...values) * 4, 4);
  const maxKwEquivalent = round(Math.max(...values) * 4, 4);

  const qualityHints = includeQualityHints
    ? [
        {
          code: 'BASELINE_ONLY',
          message:
            'This forecast uses a baseline method and is intended for sandbox evaluation, not production commitment.',
        },
      ]
    : [];

  return {
    status: 'ok',
    sandboxVersion: SANDBOX_VERSION,
    seriesId: payload.seriesId,
    forecastDate: payload.forecastDate,
    granularity: SUPPORTED_GRANULARITY,
    timezone,
    unit: payload.unit,
    method: {
      id: METHOD_ID,
      description:
        'Deterministic baseline forecast based on historical quarter-hour weekday profiles.',
      productionModel: false,
    },
    forecast,
    summary: {
      intervals: intervalCount,
      totalKwh,
      minKwEquivalent,
      maxKwEquivalent,
    },
    warnings,
    qualityHints,
    commercialBoundary: commercialBoundary({ scope: 'sandbox_forecast' }),
  };
}

function parsePlainDateBoundaryMs(value, endOfDay) {
  const parts = parseDateOnly(value);
  if (!parts) return null;
  return endOfDay
    ? Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999)
    : Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
}

/**
 * POST /consumption/backtest
 */
function backtestConsumption(payload) {
  requireFields(payload, [
    'seriesId',
    'granularity',
    'timezone',
    'unit',
    'trainFrom',
    'trainTo',
    'testFrom',
    'testTo',
    'historicalValues',
    'actualValues',
  ]);
  assertSupportedGranularity(payload.granularity);
  assertSupportedUnit(payload.unit);

  const trainFromMs = parsePlainDateBoundaryMs(payload.trainFrom, false);
  const trainToMs = parsePlainDateBoundaryMs(payload.trainTo, true);
  const testFromMs = parsePlainDateBoundaryMs(payload.testFrom, false);
  const testToMs = parsePlainDateBoundaryMs(payload.testTo, true);

  if (
    trainFromMs === null ||
    trainToMs === null ||
    testFromMs === null ||
    testToMs === null ||
    trainFromMs > trainToMs ||
    testFromMs > testToMs ||
    trainToMs > testFromMs
  ) {
    throw new SandboxRequestError(
      ERROR_CODES.INVALID_BACKTEST_PERIOD,
      'trainFrom must be <= trainTo, testFrom must be <= testTo, and trainTo must be <= testFrom.',
      {
        trainFrom: payload.trainFrom,
        trainTo: payload.trainTo,
        testFrom: payload.testFrom,
        testTo: payload.testTo,
      }
    );
  }

  const timezone = payload.timezone;
  const options = payload.options || {};
  const includeDailyBreakdown = options.includeDailyBreakdown !== false;
  const includeAeRiskProxy = options.includeAeRiskProxy !== false;

  const { rows: allHistorical } = normalizeSeries(payload.historicalValues);
  const trainRows = allHistorical.filter((r) => r.ms >= trainFromMs && r.ms <= trainToMs);

  if (trainRows.length < MIN_BACKTEST_TRAIN_INTERVALS) {
    throw new SandboxRequestError(
      ERROR_CODES.INSUFFICIENT_HISTORY,
      `At least ${MIN_BACKTEST_TRAIN_INTERVALS} training quarter-hour values (14 days) within [trainFrom, trainTo] are required; received ${trainRows.length}.`,
      { requiredIntervals: MIN_BACKTEST_TRAIN_INTERVALS, receivedIntervals: trainRows.length }
    );
  }

  const { rows: allActual } = normalizeSeries(payload.actualValues);
  const testRows = allActual.filter((r) => r.ms >= testFromMs && r.ms <= testToMs);

  if (testRows.length === 0) {
    throw new SandboxRequestError(
      ERROR_CODES.INSUFFICIENT_HISTORY,
      'No actualValues fall within [testFrom, testTo]; cannot run a backtest.',
      { testFrom: payload.testFrom, testTo: payload.testTo }
    );
  }

  const profile = buildProfile(trainRows, timezone);
  const forecastPairs = [];
  const actualPairs = [];
  const dailyMap = new Map();
  let totalAbsoluteDeviation = 0;
  let zeroActualCount = 0;

  for (const row of testRows) {
    const predicted = profile.predict(row.ms).mean;
    forecastPairs.push({ value: predicted });
    actualPairs.push({ value: row.value });
    totalAbsoluteDeviation += Math.abs(predicted - row.value);
    if (row.value === 0) zeroActualCount += 1;

    const dKey = dayKey(row.ms, timezone);
    if (!dailyMap.has(dKey)) dailyMap.set(dKey, { actual: 0, forecast: 0 });
    const bucket = dailyMap.get(dKey);
    bucket.actual += row.value;
    bucket.forecast += predicted;
  }

  const quality = calculateForecastQuality(forecastPairs, actualPairs);

  let dailyEnergyErrorSum = 0;
  let dailyEnergyErrorCount = 0;
  const dailyBreakdown = [];
  for (const [date, bucket] of [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const absoluteErrorKwh = round(Math.abs(bucket.forecast - bucket.actual), 4);
    const mapePercent =
      bucket.actual !== 0 ? round((absoluteErrorKwh / Math.abs(bucket.actual)) * 100, 4) : 0;
    if (bucket.actual !== 0) {
      dailyEnergyErrorSum += mapePercent;
      dailyEnergyErrorCount += 1;
    }
    dailyBreakdown.push({
      date,
      actualKwh: round(bucket.actual, 4),
      forecastKwh: round(bucket.forecast, 4),
      absoluteErrorKwh,
      mapePercent,
    });
  }

  const warnings = [];
  if (zeroActualCount > 0) {
    warnings.push({
      code: ERROR_CODES.ZERO_VALUES_FOR_MAPE,
      message: `${zeroActualCount} actual value(s) were exactly zero and excluded from MAPE (division-by-zero guard).`,
    });
  }

  const expectedTestIntervals = Math.round((testToMs - testFromMs + 1) / QUARTER_HOUR_MS);
  const dataQualityRatio = expectedTestIntervals > 0 ? testRows.length / expectedTestIntervals : 0;
  const dataQuality =
    quality.sampleSize < 96 ? 'limited' : dataQualityRatio >= 0.5 ? 'usable' : 'limited';
  const backtestReady = quality.mape < 30 && quality.sampleSize >= 96;

  const response = {
    status: 'ok',
    sandboxVersion: SANDBOX_VERSION,
    seriesId: payload.seriesId,
    method: { id: METHOD_ID, productionModel: false },
    period: {
      trainFrom: payload.trainFrom,
      trainTo: payload.trainTo,
      testFrom: payload.testFrom,
      testTo: payload.testTo,
    },
    metrics: {
      maeKwh: quality.mae,
      rmseKwh: quality.rmse,
      mapePercent: quality.mape,
      biasKwh: quality.bias,
      dailyEnergyErrorMeanPercent:
        dailyEnergyErrorCount > 0 ? round(dailyEnergyErrorSum / dailyEnergyErrorCount, 4) : 0,
    },
    readiness: {
      backtestReady,
      dataQuality,
      recommendedNextStep: backtestReady ? 'commercial_mini_check' : 'data_readiness_clarification',
    },
    warnings,
    commercialBoundary: commercialBoundary({ scope: 'sandbox_backtest' }),
  };

  if (includeAeRiskProxy) {
    response.aeRiskProxy = {
      available: true,
      method: 'absolute_forecast_error_proxy_v0',
      totalAbsoluteDeviationKwh: round(totalAbsoluteDeviation, 4),
      note: 'Proxy only. No commercial or balancing-energy cost guarantee.',
    };
  }
  if (includeDailyBreakdown) {
    response.dailyBreakdown = dailyBreakdown;
  }

  return response;
}

function toErrorResponse(err) {
  return errorEnvelope(err);
}

module.exports = {
  SANDBOX_VERSION,
  METHOD_ID,
  ERROR_CODES,
  SandboxRequestError,
  commercialBoundary,
  validateConsumptionSeries,
  dayAheadConsumption,
  backtestConsumption,
  toErrorResponse,
};
