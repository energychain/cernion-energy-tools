'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { thresholdPrediction } = require('../src/forecast-prediction-threshold');
const { runEvaluation, resolveFeatureConfiguration } = require('../src/forecast-evaluation');
const { trainStateModel, predictStateModel } = require('../src/forecast-state-api');
const { createStateStore } = require('../src/forecast-state-store');

function input(actual = 0.01, unit = 'kWh') {
  const start = Date.parse('2024-12-01T00:00:00Z');
  const target = Date.parse('2025-01-01T00:00:00Z');
  return {
    payload_fit_confirmed: true,
    datasets: [
      {
        series_id: 'small-load',
        unit,
        timezone: 'UTC',
        period_from: '2024-12-01',
        period_until: '2025-01-01',
        values: Array.from({ length: 32 * 96 }, (_, i) => ({
          timestamp: new Date(start + i * 900000).toISOString(),
          value: start + i * 900000 < target ? 0.01 : actual,
        })),
      },
    ],
    configuration: {
      mode: 'rolling_day_ahead',
      relationship_mode: 'manual',
      feature_set: ['history'],
      forecast_period_from: '2025-01-01',
      forecast_period_until: '2025-01-01',
      prediction_threshold_w: 50,
    },
  };
}

test.each([
  ['kWh', 0.0125],
  ['kW', 0.05],
])('strict magnitude threshold in %s preserves boundary and both signs', (unit, boundary) => {
  for (const sign of [-1, 1]) {
    expect(thresholdPrediction((sign * boundary) / 2, unit, 50).predicted_value).toBe(0);
    expect(thresholdPrediction(sign * boundary, unit, 50).predicted_value).toBe(sign * boundary);
    expect(thresholdPrediction(sign * boundary * 2, unit, 50).predicted_value).toBe(
      sign * boundary * 2
    );
  }
  expect(thresholdPrediction(0, unit, 50).prediction_zeroed).toBe(false);
  expect(thresholdPrediction(boundary / 2, unit, 0)).toEqual({ predicted_value: boundary / 2 });
});

test.each([-1, NaN, Infinity, '50', true, null])(
  'invalid threshold %s fails configuration validation',
  (threshold) => {
    expect(() => resolveFeatureConfiguration({ prediction_threshold_w: threshold })).toThrow(
      'prediction_threshold_w'
    );
  }
);

test.each([0, 0.01])(
  'filtered and raw backtests retain original actuals (%s), including worse filtered scores',
  (actual) => {
    const request = input(actual);
    const before = structuredClone(request);
    const result = runEvaluation(request).results[0];
    expect(request).toEqual(before);
    expect(result.forecast_run.prediction_threshold_w).toBe(50);
    expect(result.filter_evaluation.changed_intervals).toBe(96);
    expect(result.filter_evaluation.actuals_modified).toBe(false);
    expect(
      result.forecast_values.every(
        (v) => v.predicted_value === 0 && v.actual_value === actual && v.deviation === actual
      )
    ).toBe(true);
    expect(result.backtest.rmse).toBeCloseTo(actual);
    expect(result.filter_evaluation.raw_backtest.rmse).toBeCloseTo(Math.abs(actual - 0.01));
    expect(result.daily_results[0].metrics.mae).toBeCloseTo(actual);
    expect(result.deviation_energy.cumulative_deviation).toBeCloseTo(actual * 96);
  }
);

test('omitted threshold and explicit zero preserve raw output and metrics', () => {
  const request = input();
  delete request.configuration.prediction_threshold_w;
  const first = runEvaluation(request).results[0];
  request.configuration.prediction_threshold_w = 0;
  const second = runEvaluation(request).results[0];
  expect(second.forecast_values.map((v) => v.predicted_value)).toEqual(
    first.forecast_values.map((v) => v.predicted_value)
  );
  expect(second.backtest.rmse).toBe(first.backtest.rmse);
  expect(second.filter_evaluation).toBeUndefined();
});

test('stored individual model retains threshold after reload for real next-day prediction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'threshold-model-'));
  try {
    const store = createStateStore(root);
    const request = input();
    const trained = trainStateModel(
      {
        dataset: request.datasets[0],
        forecast_for: '2025-01-01',
        configuration: { prediction_threshold_w: 50 },
      },
      { tenantId: 'threshold' },
      store
    );
    const artifact = store.load('threshold', 'small-load', trained.artifact_version);
    expect(artifact.feature_configuration.prediction_threshold_w).toBe(50);
    const result = predictStateModel(
      {
        series_id: 'small-load',
        artifact_version: trained.artifact_version,
        forecast_for: '2025-01-01',
      },
      { tenantId: 'threshold' },
      createStateStore(root)
    );
    expect(result.prediction_threshold_w).toBe(50);
    expect(result.forecast_values).toHaveLength(96);
    expect(
      result.forecast_values.every(
        (v) => v.predicted_value === 0 && v.raw_predicted_value > 0 && v.prediction_zeroed
      )
    ).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
