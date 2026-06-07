'use strict';

const { assessAsset, assessTimeseries, computeReadiness } = require('../src/rcs-readiness');

// ── Helper: build a quarter-hour timeseries ───────────────────────────────────

function makeQhSeries(count, startIso = '2027-04-01T00:00:00Z') {
  const base = new Date(startIso).getTime();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(base + i * 15 * 60000).toISOString(),
    value: Math.random(),
  }));
}

const TIMEFRAME_24H = { start: '2027-04-01T00:00:00Z', end: '2027-04-02T00:00:00Z' };
// 24 hours × 4 slots = 96 quarter-hour slots expected

// ── assessAsset ───────────────────────────────────────────────────────────────

describe('assessAsset', () => {
  test('ready for complete asset', () => {
    const result = assessAsset({
      technology: 'solar',
      awCentsPerKwh: 7.5,
      capacityKw: 100,
      commissioningDate: '2024-01-01',
    });
    expect(result.status).toBe('ready');
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('not_ready when technology is missing', () => {
    const result = assessAsset({ awCentsPerKwh: 7.5 });
    expect(result.status).toBe('not_ready');
  });

  test('not_ready when awCentsPerKwh is missing', () => {
    const result = assessAsset({ technology: 'solar' });
    expect(result.status).toBe('not_ready');
  });

  test('not_ready for unsupported technology', () => {
    const result = assessAsset({ technology: 'nuclear', awCentsPerKwh: 5.0 });
    expect(result.status).toBe('not_ready');
    expect(result.issues.some((i) => i.field === 'technology')).toBe(true);
  });

  test('ready with warning when optional fields are absent', () => {
    const result = assessAsset({ technology: 'wind_onshore', awCentsPerKwh: 9.0 });
    expect(result.status).toBe('ready');
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  test('not_ready for null input', () => {
    const result = assessAsset(null);
    expect(result.status).toBe('not_ready');
    expect(result.issues).toHaveLength(1);
  });
});

// ── assessTimeseries ──────────────────────────────────────────────────────────

describe('assessTimeseries', () => {
  test('ready when 100% coverage', () => {
    const series = makeQhSeries(96); // exactly 96 slots for 24h
    const result = assessTimeseries(series, TIMEFRAME_24H, 'price');
    expect(result.status).toBe('ready');
    expect(result.coveragePercent).toBe(100);
  });

  test('not_ready when empty array', () => {
    const result = assessTimeseries([], TIMEFRAME_24H, 'injection');
    expect(result.status).toBe('not_ready');
    expect(result.coveragePercent).toBe(0);
  });

  test('partial when coverage 70–94%', () => {
    const series = makeQhSeries(80); // 80/96 ≈ 83%
    const result = assessTimeseries(series, TIMEFRAME_24H, 'price');
    expect(result.status).toBe('partial');
    expect(result.coveragePercent).toBeGreaterThanOrEqual(70);
    expect(result.coveragePercent).toBeLessThan(95);
  });

  test('not_ready when coverage < 70%', () => {
    const series = makeQhSeries(50); // 50/96 ≈ 52%
    const result = assessTimeseries(series, TIMEFRAME_24H, 'price');
    expect(result.status).toBe('not_ready');
    expect(result.coveragePercent).toBeLessThan(70);
  });

  test('reports expected and actual slot counts', () => {
    const series = makeQhSeries(96);
    const result = assessTimeseries(series, TIMEFRAME_24H, 'price');
    expect(result.expected).toBe(96);
    expect(result.actual).toBe(96);
  });
});

// ── computeReadiness ──────────────────────────────────────────────────────────

describe('computeReadiness', () => {
  const validAsset = {
    technology: 'solar',
    awCentsPerKwh: 7.5,
    capacityKw: 100,
    commissioningDate: '2024-01-01',
  };
  const fullPrices = makeQhSeries(96);
  const fullInjection = makeQhSeries(96);

  test('overallStatus is "ready" when all sources are ready', () => {
    const report = computeReadiness(validAsset, fullPrices, fullInjection, TIMEFRAME_24H);
    expect(report.overallStatus).toBe('ready');
  });

  test('overallStatus is "not_ready" when asset is missing', () => {
    const report = computeReadiness(null, fullPrices, fullInjection, TIMEFRAME_24H);
    expect(report.overallStatus).toBe('not_ready');
  });

  test('overallStatus is "not_ready" when prices are empty', () => {
    const report = computeReadiness(validAsset, [], fullInjection, TIMEFRAME_24H);
    expect(report.overallStatus).toBe('not_ready');
  });

  test('overallStatus is "not_ready" when injection is empty', () => {
    const report = computeReadiness(validAsset, fullPrices, [], TIMEFRAME_24H);
    expect(report.overallStatus).toBe('not_ready');
  });

  test('overallStatus is "partial" when prices partial but asset+injection ready', () => {
    const partialPrices = makeQhSeries(80); // ≈83% coverage → partial
    const report = computeReadiness(validAsset, partialPrices, fullInjection, TIMEFRAME_24H);
    expect(report.overallStatus).toBe('partial');
  });

  test('report has sources with asset, prices, injection keys', () => {
    const report = computeReadiness(validAsset, fullPrices, fullInjection, TIMEFRAME_24H);
    expect(report.sources).toHaveProperty('asset');
    expect(report.sources).toHaveProperty('prices');
    expect(report.sources).toHaveProperty('injection');
  });

  test('recommendations array is present', () => {
    const report = computeReadiness(validAsset, fullPrices, fullInjection, TIMEFRAME_24H);
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  test('recommendations include guidance for low price coverage', () => {
    const partialPrices = makeQhSeries(50);
    const report = computeReadiness(validAsset, partialPrices, fullInjection, TIMEFRAME_24H);
    expect(report.recommendations.some((r) => r.toLowerCase().includes('price'))).toBe(true);
  });
});
