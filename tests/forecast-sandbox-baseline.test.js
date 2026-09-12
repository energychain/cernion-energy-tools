'use strict';

const {
  SANDBOX_VERSION,
  ERROR_CODES,
  SandboxRequestError,
  validateConsumptionSeries,
  dayAheadConsumption,
  backtestConsumption,
  toErrorResponse,
} = require('../src/forecast-sandbox-baseline');

const TIMEZONE = 'Europe/Berlin';
const QUARTER_HOUR_MS = 15 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Builds a synthetic PT15M series covering `days` calendar days starting at local midnight
// of `startDateIso` (YYYY-MM-DD) in Europe/Berlin, with a deterministic value per interval.
// Emits explicit +01:00/+02:00 offsets (matching real payloads) rather than UTC "Z"
// timestamps — all ranges used in these tests are chosen to stay clear of a DST
// transition, so a single fixed offset for the whole range is exact, not approximate.
function generateSeries(startDateIso, days, valueFn) {
  const [year, month, day] = startDateIso.split('-').map(Number);
  const offsetMinutes = month >= 4 && month <= 9 ? 120 : 60; // CEST vs CET
  const offsetStr = `+${pad2(offsetMinutes / 60)}:00`;
  let wallMs = Date.UTC(year, month - 1, day, 0, 0, 0); // wall-clock fields, not a real instant
  const totalIntervals = days * 96;
  const rows = [];
  for (let i = 0; i < totalIntervals; i += 1) {
    const wall = new Date(wallMs);
    const ts = `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}T${pad2(
      wall.getUTCHours()
    )}:${pad2(wall.getUTCMinutes())}:00${offsetStr}`;
    rows.push({ ts, value: valueFn(i) });
    wallMs += QUARTER_HOUR_MS;
  }
  return rows;
}

function constantSeries(startDateIso, days, value) {
  return generateSeries(startDateIso, days, () => value);
}

describe('forecast-sandbox-baseline / validateConsumptionSeries', () => {
  it('accepts a clean PT15M series and includes commercialBoundary', () => {
    const values = constantSeries('2025-06-01', 7, 10);
    const result = validateConsumptionSeries({
      seriesId: 'cells-demo-001',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
    });

    expect(result.status).toBe('ok');
    expect(result.sandboxVersion).toBe(SANDBOX_VERSION);
    expect(result.validation.accepted).toBe(true);
    expect(result.validation.valueCount).toBe(7 * 96);
    expect(result.validation.missingIntervals).toBe(0);
    expect(result.validation.duplicateIntervals).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.commercialBoundary).toMatchObject({
      productionUse: false,
      sla: false,
      forecastQualityGuarantee: false,
    });
  });

  it('detects missing intervals as a gap without crashing', () => {
    const values = constantSeries('2025-06-01', 2, 10);
    // Remove a chunk from the middle to create a gap.
    values.splice(50, 10);
    const result = validateConsumptionSeries({
      seriesId: 'gap-series',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
    });

    expect(result.status).toBe('ok');
    expect(result.validation.missingIntervals).toBe(10);
    expect(result.validation.coverageRatio).toBeLessThan(1);
  });

  it('reports missing values as a validation error once coverage drops below 50%', () => {
    const values = constantSeries('2025-06-01', 1, 10).slice(0, 20);
    // Stretch the series artificially by shifting the last point far into the future
    // so the expected grid becomes much larger than what was actually supplied.
    values.push({ ts: '2025-07-01T00:00:00.000Z', value: 10 });
    const result = validateConsumptionSeries({
      seriesId: 'sparse-series',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
    });

    expect(result.validation.accepted).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: ERROR_CODES.MISSING_VALUES })])
    );
  });

  it('detects duplicate intervals and keeps the first occurrence', () => {
    const values = constantSeries('2025-06-01', 1, 10);
    values.push({ ts: values[5].ts, value: 999 });
    const result = validateConsumptionSeries({
      seriesId: 'dup-series',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
    });

    expect(result.validation.duplicateIntervals).toBe(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: ERROR_CODES.DUPLICATE_INTERVALS })])
    );
  });

  it('reports negative values as a warning without blocking acceptance', () => {
    const values = constantSeries('2025-06-01', 1, 10);
    values[0].value = -5;
    values[1].value = -3;
    const result = validateConsumptionSeries({
      seriesId: 'negative-series',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
    });

    expect(result.validation.negativeValues).toBe(2);
    expect(result.validation.accepted).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NEGATIVE_VALUES_DETECTED' })])
    );
  });

  it('does not count negative values when allowNegativeValues is true', () => {
    const values = constantSeries('2025-06-01', 1, 10);
    values[0].value = -5;
    const result = validateConsumptionSeries({
      seriesId: 'feed-in-series',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
      options: { allowNegativeValues: true },
    });

    expect(result.validation.negativeValues).toBe(0);
  });

  it('flags outliers without echoing raw input values back', () => {
    const values = constantSeries('2025-06-01', 3, 10);
    values[100].value = 5000;
    const result = validateConsumptionSeries({
      seriesId: 'outlier-series',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      values,
    });

    expect(result.validation.outlierCount).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('5000');
  });

  it('rejects a non-PT15M declared granularity as INVALID_GRANULARITY', () => {
    expect(() =>
      validateConsumptionSeries({
        seriesId: 'hourly-series',
        granularity: 'PT1H',
        timezone: TIMEZONE,
        unit: 'kWh',
        values: constantSeries('2025-06-01', 1, 10),
      })
    ).toThrow(SandboxRequestError);
  });

  it('rejects an irregular quarter-hour grid as INVALID_GRANULARITY', () => {
    const values = [];
    let ms = Date.UTC(2025, 5, 1, 0, 0, 0);
    for (let i = 0; i < 50; i += 1) {
      values.push({ ts: new Date(ms).toISOString(), value: 10 });
      // Irregular, non-15-minute-multiple step.
      ms += 7 * 60 * 1000;
    }
    try {
      validateConsumptionSeries({
        seriesId: 'irregular-series',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        values,
      });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.INVALID_GRANULARITY);
    }
  });

  it('rejects an unsupported unit as UNSUPPORTED_UNIT', () => {
    try {
      validateConsumptionSeries({
        seriesId: 'bad-unit-series',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'MWh',
        values: constantSeries('2025-06-01', 1, 10),
      });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.UNSUPPORTED_UNIT);
    }
  });

  it('rejects a payload missing required fields as INVALID_PAYLOAD', () => {
    try {
      validateConsumptionSeries({ seriesId: 'incomplete-series' });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.INVALID_PAYLOAD);
    }
  });

  it('converts a thrown SandboxRequestError into the documented error envelope shape', () => {
    let caught;
    try {
      validateConsumptionSeries({ seriesId: 'x' });
    } catch (err) {
      caught = err;
    }
    const envelope = toErrorResponse(caught);
    expect(envelope).toMatchObject({
      status: 'error',
      sandboxVersion: SANDBOX_VERSION,
      error: { code: ERROR_CODES.INVALID_PAYLOAD },
      commercialBoundary: { productionUse: false },
    });
  });
});

describe('forecast-sandbox-baseline / dayAheadConsumption', () => {
  it('produces 96 intervals for a normal (non-DST) forecast day', () => {
    const historicalValues = constantSeries('2025-06-01', 30, 10);
    const result = dayAheadConsumption({
      seriesId: 'cells-demo-001',
      forecastDate: '2026-09-16',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      historicalValues,
    });

    expect(result.status).toBe('ok');
    expect(result.method.id).toBe('baseline_weekday_profile_v0');
    expect(result.forecast).toHaveLength(96);
    expect(result.summary.intervals).toBe(96);
    expect(result.forecast[0].value).toBeCloseTo(10, 5);
    expect(result.forecast[0]).toHaveProperty('lower');
    expect(result.forecast[0]).toHaveProperty('upper');
    expect(result.commercialBoundary.balancingEnergyRiskReductionGuarantee).toBe(false);
  });

  it('omits the confidence band when includeConfidenceBand is false', () => {
    const result = dayAheadConsumption({
      seriesId: 'cells-demo-001',
      forecastDate: '2026-09-16',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      historicalValues: constantSeries('2025-06-01', 30, 10),
      options: { includeConfidenceBand: false },
    });

    expect(result.forecast[0]).not.toHaveProperty('lower');
  });

  it('handles a European spring-forward DST transition day without crashing', () => {
    const result = dayAheadConsumption({
      seriesId: 'dst-spring',
      forecastDate: '2026-03-29', // last Sunday of March 2026 — clocks forward in Europe/Berlin
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      historicalValues: constantSeries('2025-06-01', 60, 10),
    });

    expect(result.status).toBe('ok');
    expect(result.summary.intervals).toBe(92);
    expect(result.forecast).toHaveLength(92);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DST_SPRING_FORWARD' })])
    );
  });

  it('handles a European fall-back DST transition day without crashing', () => {
    const result = dayAheadConsumption({
      seriesId: 'dst-fall',
      forecastDate: '2026-10-25', // last Sunday of October 2026 — clocks back in Europe/Berlin
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      historicalValues: constantSeries('2025-06-01', 60, 10),
    });

    expect(result.status).toBe('ok');
    expect(result.summary.intervals).toBe(100);
    expect(result.forecast).toHaveLength(100);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DST_FALL_BACK' })])
    );
  });

  it('rejects insufficient history with a structured INSUFFICIENT_HISTORY error', () => {
    try {
      dayAheadConsumption({
        seriesId: 'too-short',
        forecastDate: '2026-09-16',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        historicalValues: constantSeries('2026-09-01', 2, 10),
      });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.INSUFFICIENT_HISTORY);
    }
  });
});

describe('forecast-sandbox-baseline / backtestConsumption', () => {
  const trainValues = constantSeries('2024-01-01', 60, 10);

  it('computes MAE/RMSE/MAPE/bias for a perfect-match backtest', () => {
    const actualValues = constantSeries('2025-01-01', 7, 10);
    const result = backtestConsumption({
      seriesId: 'cells-demo-001',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      trainFrom: '2024-01-01',
      trainTo: '2024-03-01',
      testFrom: '2025-01-01',
      testTo: '2025-01-07',
      historicalValues: trainValues,
      actualValues,
    });

    expect(result.status).toBe('ok');
    expect(result.metrics.maeKwh).toBeCloseTo(0, 5);
    expect(result.metrics.rmseKwh).toBeCloseTo(0, 5);
    expect(result.metrics.mapePercent).toBeCloseTo(0, 5);
    expect(result.metrics.biasKwh).toBeCloseTo(0, 5);
    expect(result.readiness.backtestReady).toBe(true);
    expect(result.aeRiskProxy.available).toBe(true);
    expect(result.dailyBreakdown.length).toBe(7);
  });

  it('reports a non-zero MAE/bias when actuals deviate from the trained baseline', () => {
    const actualValues = constantSeries('2025-01-01', 7, 12);
    const result = backtestConsumption({
      seriesId: 'cells-demo-001',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      trainFrom: '2024-01-01',
      trainTo: '2024-03-01',
      testFrom: '2025-01-01',
      testTo: '2025-01-07',
      historicalValues: trainValues,
      actualValues,
    });

    expect(result.metrics.maeKwh).toBeCloseTo(2, 5);
    expect(result.metrics.biasKwh).toBeCloseTo(-2, 5);
  });

  it('guards MAPE against division by zero and surfaces a warning', () => {
    const actualValues = constantSeries('2025-01-01', 1, 0);
    const result = backtestConsumption({
      seriesId: 'zero-actuals',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      trainFrom: '2024-01-01',
      trainTo: '2024-03-01',
      testFrom: '2025-01-01',
      testTo: '2025-01-01',
      historicalValues: trainValues,
      actualValues,
    });

    expect(Number.isFinite(result.metrics.mapePercent)).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: ERROR_CODES.ZERO_VALUES_FOR_MAPE })])
    );
  });

  it('rejects an invalid backtest period (trainTo after testFrom)', () => {
    try {
      backtestConsumption({
        seriesId: 'bad-period',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        trainFrom: '2024-01-01',
        trainTo: '2025-06-01',
        testFrom: '2025-01-01',
        testTo: '2025-01-07',
        historicalValues: trainValues,
        actualValues: constantSeries('2025-01-01', 7, 10),
      });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.INVALID_BACKTEST_PERIOD);
    }
  });

  it('rejects insufficient training history', () => {
    try {
      backtestConsumption({
        seriesId: 'short-train',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        trainFrom: '2024-01-01',
        trainTo: '2024-01-03',
        testFrom: '2025-01-01',
        testTo: '2025-01-07',
        historicalValues: constantSeries('2024-01-01', 3, 10),
        actualValues: constantSeries('2025-01-01', 7, 10),
      });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.INSUFFICIENT_HISTORY);
    }
  });

  it('reports dataQuality "limited" when actualValues sparsely cover the test window', () => {
    // 96 intervals sourced from a single day, but declared as a 10-day test window —
    // coverage ratio should reflect how much of [testFrom, testTo] is actually present.
    const actualValues = constantSeries('2025-01-01', 1, 10);
    const result = backtestConsumption({
      seriesId: 'sparse-test-window',
      granularity: 'PT15M',
      timezone: TIMEZONE,
      unit: 'kWh',
      trainFrom: '2024-01-01',
      trainTo: '2024-03-01',
      testFrom: '2025-01-01',
      testTo: '2025-01-10',
      historicalValues: trainValues,
      actualValues,
    });

    expect(result.status).toBe('ok');
    expect(result.readiness.dataQuality).toBe('limited');
  });

  it('rejects a test window with no matching actualValues', () => {
    try {
      backtestConsumption({
        seriesId: 'empty-test-window',
        granularity: 'PT15M',
        timezone: TIMEZONE,
        unit: 'kWh',
        trainFrom: '2024-01-01',
        trainTo: '2024-03-01',
        testFrom: '2025-06-01',
        testTo: '2025-06-07',
        historicalValues: trainValues,
        actualValues: constantSeries('2025-01-01', 7, 10),
      });
      throw new Error('expected SandboxRequestError');
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxRequestError);
      expect(err.code).toBe(ERROR_CODES.INSUFFICIENT_HISTORY);
    }
  });
});
