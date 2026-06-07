'use strict';

const ASSET_REQUIRED_FIELDS = ['technology', 'awCentsPerKwh'];
const ASSET_RECOMMENDED_FIELDS = ['capacityKw', 'commissioningDate'];
const VALID_TECHNOLOGIES = ['solar', 'wind_onshore', 'wind_offshore', 'biomass'];
const QUARTER_HOUR_MS = 15 * 60 * 1000;

// ── Internal helpers ──────────────────────────────────────────────────────────

function expectedQuarterHourSlots(timeframe) {
  const startMs = new Date(timeframe.start).getTime();
  const endMs = new Date(timeframe.end).getTime();
  const durationMs = endMs - startMs;
  return Math.max(0, Math.round(durationMs / QUARTER_HOUR_MS));
}

function coveragePercent(actual, expected) {
  if (expected <= 0) return 100;
  return Math.min(100, Math.round((actual / expected) * 100));
}

function detectGaps(entries, expected, startIso, entryTimestampKey = 'timestamp') {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const slotSet = new Set(entries.map((e) => new Date(e[entryTimestampKey]).toISOString()));
  const gaps = [];
  const base = new Date(startIso).getTime();
  for (let i = 0; i < expected; i++) {
    const ts = new Date(base + i * QUARTER_HOUR_MS).toISOString();
    if (!slotSet.has(ts)) gaps.push(ts);
  }
  return gaps.slice(0, 10); // cap gap list for readability
}

// ── Public assessors ──────────────────────────────────────────────────────────

function assessAsset(assetRaw) {
  if (!assetRaw || typeof assetRaw !== 'object') {
    return {
      status: 'not_ready',
      issues: [{ field: 'asset', severity: 'error', message: 'Asset not found or empty.' }],
    };
  }
  const issues = [];
  for (const field of ASSET_REQUIRED_FIELDS) {
    const val = assetRaw[field] ?? assetRaw[field.replace(/([A-Z])/g, '_$1').toLowerCase()];
    if (val == null || val === '') {
      issues.push({ field, severity: 'error', message: `Required field '${field}' is missing.` });
    }
  }
  const techRaw = assetRaw.technology ?? assetRaw.tech;
  if (techRaw && !VALID_TECHNOLOGIES.includes(techRaw)) {
    issues.push({
      field: 'technology',
      severity: 'error',
      message: `Technology '${techRaw}' is not supported. Valid: ${VALID_TECHNOLOGIES.join(', ')}.`,
    });
  }
  for (const field of ASSET_RECOMMENDED_FIELDS) {
    const val = assetRaw[field] ?? assetRaw[field.replace(/([A-Z])/g, '_$1').toLowerCase()];
    if (val == null || val === '') {
      issues.push({ field, severity: 'warning', message: `Recommended field '${field}' is missing.` });
    }
  }
  const hasErrors = issues.some((i) => i.severity === 'error');
  return { status: hasErrors ? 'not_ready' : 'ready', issues };
}

function assessTimeseries(entries, timeframe, label) {
  const expected = expectedQuarterHourSlots(timeframe);
  const actual = Array.isArray(entries) ? entries.length : 0;
  const coverage = coveragePercent(actual, expected);
  const issues = [];

  if (actual === 0) {
    issues.push({ severity: 'error', message: `No ${label} data available for the timeframe.` });
    return { status: 'not_ready', expected, actual, coveragePercent: 0, issues };
  }

  const gaps = detectGaps(entries, expected, timeframe.start);
  if (gaps.length > 0) {
    issues.push({
      severity: coverage < 90 ? 'error' : 'warning',
      message: `${label} has ${gaps.length === 10 ? '10+' : gaps.length} gap(s). First gap at ${gaps[0]}.`,
      sampleGaps: gaps,
    });
  }

  let status;
  if (coverage >= 95) status = 'ready';
  else if (coverage >= 70) status = 'partial';
  else status = 'not_ready';

  return { status, expected, actual, coveragePercent: coverage, issues };
}

/**
 * Compute a full readiness report from pre-fetched data.
 *
 * @param {object} assetRaw   - Raw asset object from assets.effective
 * @param {Array}  prices     - Price timeseries from energy-market.prices
 * @param {Array}  injection  - Injection timeseries from edm.getTimeseries
 * @param {object} timeframe  - { start, end }
 * @returns {{ overallStatus, sources, recommendations }}
 */
function computeReadiness(assetRaw, prices, injection, timeframe) {
  const assetResult = assessAsset(assetRaw);
  const pricesResult = assessTimeseries(prices, timeframe, 'price');
  const injectionResult = assessTimeseries(injection, timeframe, 'injection');

  const statuses = [assetResult.status, pricesResult.status, injectionResult.status];
  let overallStatus;
  if (statuses.every((s) => s === 'ready')) overallStatus = 'ready';
  else if (statuses.some((s) => s === 'not_ready')) overallStatus = 'not_ready';
  else overallStatus = 'partial';

  const recommendations = [];
  if (pricesResult.coveragePercent < 95)
    recommendations.push('Request price data with higher resolution or extended range.');
  if (injectionResult.coveragePercent < 95)
    recommendations.push('Verify EDM metering completeness for the requested period.');
  if (assetResult.issues.some((i) => i.severity === 'warning'))
    recommendations.push('Enrich asset record with capacityKw and commissioningDate for full analysis.');

  return {
    overallStatus,
    sources: {
      asset: assetResult,
      prices: pricesResult,
      injection: injectionResult,
    },
    recommendations,
  };
}

module.exports = {
  assessAsset,
  assessTimeseries,
  computeReadiness,
  VALID_TECHNOLOGIES,
  QUARTER_HOUR_MS,
};
