'use strict';

const { runEvaluation } = require('../src/forecast-evaluation');
const { clock, shiftDate, STEP } = require('../src/forecast-evaluation-time');
const { fitModel } = require('../src/forecast-relationship-model');
const time = clock('Europe/Berlin');

function fixture(kind = 'weekday', seed = 1) {
  const values = [];
  const observations = [];
  const forecasts = [];
  let random = seed;
  let windRandom = (seed + 991) >>> 0;
  const start = time.midnight('2024-04-01');
  for (let ms = start; ms < time.midnight('2025-01-05'); ms += STEP) {
    const { date, slot, weekday } = time.parts(ms);
    const day = Math.floor(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse('2024-04-01T00:00:00Z')) / 86400000
    );
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const noise = random / 4294967296 - 0.5;
    windRandom ^= windRandom << 13;
    windRandom ^= windRandom >>> 17;
    windRandom ^= windRandom << 5;
    const wind = (windRandom >>> 0) / 4294967296;
    const temperature = kind === 'confounded' ? 5 + weekday * 3 : -5 + ((day * 17) % 41);
    const hour = Number(slot.slice(0, 2));
    let value = 100 + hour;
    if (['weekday', 'combined', 'confounded'].includes(kind)) value += weekday * 15;
    if (['weather', 'combined'].includes(kind))
      value +=
        2 * temperature + 3 * Math.max(0, 18 - temperature) + 4 * Math.max(0, temperature - 22);
    if (kind === 'noise') value += noise * 20;
    const timestamp = new Date(ms).toISOString();
    values.push({ timestamp, value });
    observations.push({
      timestamp,
      temperature,
      wind_speed: wind + 1,
      available_at: new Date(ms + STEP).toISOString(),
    });
    forecasts.push({
      timestamp,
      temperature,
      wind_speed: wind + 1,
      issued_at: new Date(time.midnight(shiftDate(date, -1)) - 3600000).toISOString(),
    });
  }
  return {
    payload_fit_confirmed: true,
    datasets: [
      {
        series_id: `synthetic-${kind}`,
        unit: 'kWh',
        timezone: 'Europe/Berlin',
        weather_region: 'test',
        period_from: '2024-04-01',
        period_until: '2025-01-04',
        values,
      },
    ],
    configuration: {
      mode: 'rolling_day_ahead',
      forecast_period_from: '2025-01-01',
      forecast_period_until: '2025-01-01',
      weather: { source: 'synthetic', version: '1', region: 'test', observations, forecasts },
    },
  };
}

function selection(result) {
  return result.results[0].relationship_analysis.selections[0];
}

describe('Automatic per-series predictive relationships', () => {
  jest.setTimeout(120000);

  test('RMSE policy uses quadratic loss for confirmation and ablation without future leakage', () => {
    const input = fixture('weekday');
    delete input.configuration.weather;
    input.configuration.selection_metric = 'rmse';
    input.configuration.recent_window_days = 28;
    const before = runEvaluation(input);
    const report = selection(before);
    expect(report.selection_metric).toBe('RMSE');
    expect(report.policy.recent_window_days).toBe(28);
    expect(report.selected_groups).toContain('weekday');
    expect(report.confirmation.metric).toBe('RMSE');
    expect(report.confirmation.rmse_reduction_interval[0]).toBeGreaterThan(0);
    expect(report.confirmation.mae_reduction_interval).toBeUndefined();
    expect(
      report.relationships.find((r) => r.feature === 'weekday').conditional_ablation.metric
    ).toBe('RMSE');
    for (const row of input.datasets[0].values)
      if (row.timestamp >= '2024-12-30T23:00:00.000Z') row.value += 10000;
    const after = runEvaluation(input);
    expect(selection(after)).toEqual(report);
    expect(after.results[0].forecast_values.map((v) => v.predicted_value)).toEqual(
      before.results[0].forecast_values.map((v) => v.predicted_value)
    );
  });

  test.each([
    { selection_metric: 'mape' },
    { recent_window_days: 2 },
    { recent_window_days: '28' },
  ])('rejects unsupported optimization policies: %j', (policy) => {
    const input = fixture('weekday');
    Object.assign(input.configuration, policy);
    expect(() => runEvaluation(input)).toThrow(/selection_metric|recent_window_days/);
  });

  test('different loss objectives make different historically supported window decisions', () => {
    const input = fixture('weekday');
    delete input.configuration.weather;
    input.configuration.feature_set = ['history'];
    input.configuration.recent_window_days = 28;
    input.datasets[0].period_from = '2024-01-01';
    input.datasets[0].values = [];
    for (let ms = time.midnight('2024-01-01'); ms < time.midnight('2025-01-05'); ms += STEP) {
      const local = time.parts(ms);
      input.datasets[0].values.push({
        timestamp: new Date(ms).toISOString(),
        value: local.date < '2024-06-01' ? 0 : local.weekday === 3 ? 1000 : 90,
      });
    }
    input.configuration.selection_metric = 'mae';
    const absoluteLoss = selection(runEvaluation(input));
    input.configuration.selection_metric = 'rmse';
    const quadraticLoss = selection(runEvaluation(input));
    expect(absoluteLoss.selected_window_days).toBeNull();
    expect(quadraticLoss.selected_window_days).toBe(28);
    expect(quadraticLoss.recency_evidence.supported).toBe(true);
    expect(quadraticLoss.recency_evidence.metric).toBe('RMSE');
  });

  test('detects weekday effects, confirms on untouched data and reports conditional ablation', () => {
    const input = fixture('weekday');
    delete input.configuration.weather;
    const result = runEvaluation(input);
    const report = selection(result);
    expect(report.status).toBe('validated_relationships');
    expect(report.selected_groups).toContain('weekday');
    expect(report.causal_claim).toBe(false);
    expect(report.confirmation.supported).toBe(true);
    expect(
      report.relationships.find((r) => r.feature === 'weekday').conditional_ablation.supported
    ).toBe(true);
    expect(
      report.candidates
        .filter((c) => c.phase === 'confirmation')
        .every((c) => c.folds.every((f) => f.from >= report.validation_design.confirmation_from))
    ).toBe(true);
    expect(result.results[0].backtest.mae).toBeLessThan(1e-8);
  });

  test('detects nonlinear heating/cooling temperature dependence with archived weather', () => {
    const input = fixture('weather');
    input.configuration.feature_set = ['history', 'weather'];
    const result = runEvaluation(input);
    const report = selection(result);
    expect(report.selected_groups).toContain('temperature');
    expect(report.selected_groups).not.toContain('wind_speed');
    expect(
      report.relationships.find((r) => r.feature === 'temperature').conditional_ablation.supported
    ).toBe(true);
    expect(result.results[0].backtest.mae).toBeLessThan(0.5);
    expect(result.results[0].forecast_run.uses_weather_features).toBe(true);
  });

  test('history alone provides held-out MSE and RMSE without claiming future forecast accuracy', () => {
    const input = fixture('weekday');
    delete input.configuration.weather;
    input.datasets[0].values = input.datasets[0].values.filter(
      (r) => r.timestamp < '2024-12-31T23:00:00.000Z'
    );
    input.datasets[0].period_until = '2024-12-31';
    const result = runEvaluation(input);
    const quality = selection(result).historical_quality.confirmation;
    expect(quality.valid).toBe(true);
    expect(Number.isFinite(quality.mse)).toBe(true);
    expect(quality.rmse).toBeCloseTo(Math.sqrt(quality.mse), 10);
    expect(result.results[0].backtest.rmse).toBeNull();
    expect(result.results[0].forecast_values.every((v) => v.actual_value === null)).toBe(true);
  });

  test('separates weekday and temperature contributions instead of a raw correlation ranking', () => {
    const result = runEvaluation(fixture('combined'));
    const report = selection(result);
    expect(report.selected_groups).toEqual(expect.arrayContaining(['weekday', 'temperature']));
    expect(report.relationships.filter((r) => r.status === 'accepted_predictive')).toHaveLength(2);
    expect(result.results[0].backtest.mae).toBeLessThan(0.5);
  });

  test('does not claim a weather effect for a perfect weekday proxy', () => {
    const report = selection(runEvaluation(fixture('confounded')));
    expect(report.selected_groups).toContain('weekday');
    expect(report.selected_groups).not.toContain('temperature');
    expect(report.relationships.find((r) => r.feature === 'temperature').status).not.toBe(
      'accepted_predictive'
    );
  });

  test.each([11, 42, 103])(
    'noise-only series does not manufacture a relationship (seed %i)',
    (seed) => {
      const report = selection(runEvaluation(fixture('noise', seed)));
      expect(report.selected_groups).toEqual([]);
      expect(report.status).toBe('baseline_retained');
    }
  );

  test('weather without historic forecast vintages is not admitted using observed target weather', () => {
    const input = fixture('weather');
    input.configuration.feature_set = ['history', 'weather'];
    input.configuration.weather.forecasts = input.configuration.weather.forecasts.filter(
      (r) => r.timestamp >= '2024-12-31T23:00:00.000Z'
    );
    const result = runEvaluation(input);
    expect(selection(result).selected_groups).toEqual([]);
    expect(result.results[0].forecast_run.uses_weather_features).toBe(false);
    expect(selection(result).relationships.find((r) => r.feature === 'temperature').status).toBe(
      'insufficient_evidence'
    );
  });

  test('future actual and weather changes leave selection evidence and predictions invariant', () => {
    const input = fixture('combined');
    const before = runEvaluation(input);
    for (const row of input.datasets[0].values)
      if (row.timestamp >= '2024-12-30T23:00:00.000Z') row.value += 100000;
    input.configuration.weather.forecasts.push(
      ...input.configuration.weather.forecasts
        .slice(-100)
        .map((r) => ({ ...r, temperature: 9999, issued_at: '2025-01-03T00:00:00Z' }))
    );
    const after = runEvaluation(input);
    expect(selection(after)).toEqual(selection(before));
    expect(after.results[0].forecast_values.map((v) => v.predicted_value)).toEqual(
      before.results[0].forecast_values.map((v) => v.predicted_value)
    );
  });

  test('short history falls back transparently instead of calling a relationship proven', () => {
    const input = fixture('weekday');
    delete input.configuration.weather;
    input.datasets[0].values = input.datasets[0].values.filter(
      (r) => r.timestamp >= '2024-11-30T23:00:00.000Z'
    );
    input.datasets[0].period_from = '2024-12-01';
    const result = runEvaluation(input);
    expect(selection(result).status).toBe('insufficient_evidence');
    expect(selection(result).selected_groups).toEqual([]);
    expect(result.results[0].forecast_values).toHaveLength(96);
  });

  test('distinct meters are trained independently and receive distinct selection evidence', () => {
    const input = fixture('weekday');
    delete input.configuration.weather;
    const constant = structuredClone(input.datasets[0]);
    constant.series_id = 'constant';
    constant.values.forEach((r) => {
      r.value = 12;
    });
    input.datasets.push(constant);
    const result = runEvaluation(input);
    expect(result.results[0].relationship_analysis.selections[0].selected_groups).toContain(
      'weekday'
    );
    expect(result.results[1].relationship_analysis.selections[0].selected_groups).toEqual([]);
    expect(result.results[1].forecast_values.every((v) => v.predicted_value === 12)).toBe(true);
  });

  test('model falls back on unavailable target weather and remains finite under collinearity', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      slot: '00:00',
      calendar: { weekday: 1 },
      weather: { temperature: 5 + (i % 10) },
      value: 2 * (5 + (i % 10)),
    }));
    const model = fitModel(rows, { groups: ['weekday', 'temperature'], window_days: null });
    const missing = model.predict({ slot: '00:00', calendar: { weekday: 1 }, weather: {} });
    expect(missing.used_groups).toEqual(['weekday']);
    expect(Number.isFinite(missing.value)).toBe(true);
    expect(Object.values(model.coefficients).every(Number.isFinite)).toBe(true);
  });
});
