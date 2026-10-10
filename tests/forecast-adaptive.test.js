'use strict';
const { clock, STEP, shiftDate } = require('../src/forecast-evaluation-time');
const { createRelationshipSelector } = require('../src/forecast-relationship-selection');
const { builtinFeatures } = require('../src/forecast-hybrid-state-model');
const { restoreModel } = require('../src/forecast-relationship-model');
const {
  activityFeatures,
  createActivityFeatures,
  fitActivityModel,
  VERSION,
} = require('../src/forecast-activity-model');
const { resolveFeatureConfiguration } = require('../src/forecast-evaluation');
const time = clock('Europe/Berlin');
function history(days, value) {
  const rows = [];
  for (let d = 0; d < days; d++) {
    const date = shiftDate('2022-01-01', d);
    const eligible = time.midnight(shiftDate(date, 1));
    for (let ms = time.midnight(date); ms < eligible; ms += STEP) {
      const row = { ms, ...time.parts(ms), eligible };
      rows.push({ ...row, value: value(d, row) });
    }
  }
  return rows;
}
test('adaptive policy rejects contradictory objectives and activity-only flags', () => {
  expect(() =>
    resolveFeatureConfiguration({ selection_policy: 'adaptive_rmse_v1', selection_metric: 'mae' })
  ).toThrow(/RMSE/);
  expect(() => resolveFeatureConfiguration({ activity_model: true })).toThrow(/requires/);
  expect(
    resolveFeatureConfiguration({ selection_policy: 'adaptive_rmse_v1' }).selection_metric
  ).toBe('rmse');
});
test('adaptive window selection discovers recent level shift without using future rows', () => {
  const rows = history(450, (d) => (d < 340 ? 100 : 3));
  const config = {
    selection_policy: 'adaptive_rmse_v1',
    selection_metric: 'rmse',
    mode: 'rolling_day_ahead',
  };
  const selector = createRelationshipSelector({ time, config, features: builtinFeatures() });
  const date = shiftDate('2022-01-01', 451);
  const fitted = selector.forDay(rows, time.midnight(shiftDate(date, -1)), date);
  expect(fitted.report.selected_window_days).toBe(28);
  expect(fitted.report.selection_metric).toBe('RMSE');
  expect(fitted.report.policy.history_windows).toEqual([28, 84, 365, null]);
  expect(
    fitted.predict({ ...time.parts(time.midnight(date)), ms: time.midnight(date) }).value
  ).toBe(3);
}, 60000);
test('activity is a separate probability and amount model with exact serialized inference', () => {
  const rows = history(240, (d, r) => (d % 4 < 2 ? 0 : 10 + r.weekday));
  const date = shiftDate('2022-01-01', 241),
    issue = time.midnight(shiftDate(date, -1));
  const features = createActivityFeatures(rows, time, {});
  const trained = rows.map((r) => ({ ...r, activity: features(r, issue) }));
  const model = fitActivityModel(trained, {
    family: VERSION,
    groups: ['weekday'],
    window_days: null,
  });
  const restored = restoreModel(JSON.parse(JSON.stringify(model.snapshot)));
  const base = { date, slot: '12:00' };
  const low = { ...base, activity: { lag2_active: 1, lag7_active: 0, lag2_day_regime: 2 } };
  const high = { ...base, activity: { lag2_active: 0, lag7_active: 1, lag2_day_regime: 0 } };
  expect(restored.predict(low)).toEqual(model.predict(low));
  expect(model.predict(low).activity.probability).toBeLessThan(
    model.predict(high).activity.probability
  );
  const p = model.predict(high);
  expect(p.value).toBe(p.activity.probability * p.activity.conditional_positive_mean);
  expect(p.activity.conditional_positive_mean).toBeGreaterThan(10);
});
test('late lag values and missing DST slots are not interpreted as inactive', () => {
  const days = new Map([
    [
      '2024-01-01',
      { available: 100, counts: Array(96).fill(1), values: Array(96).fill(8), positive: 96, n: 96 },
    ],
  ]);
  const row = { date: '2024-01-03', slot: '12:00' };
  expect(activityFeatures(row, days, 99).lag2_active).toBe(-1);
  expect(activityFeatures(row, days, 100).lag2_active).toBe(1);
  days.get('2024-01-01').counts[48] = 0;
  expect(activityFeatures(row, days, 100).lag2_active).toBe(-1);
});
test('activity candidate must demonstrate held-out gain before enabling', () => {
  const rows = history(210, (d) => (d % 4 < 2 ? 0 : 10));
  const date = shiftDate('2022-01-01', 211),
    issue = time.midnight(shiftDate(date, -1));
  const selector = createRelationshipSelector({
    time,
    config: {
      mode: 'rolling_day_ahead',
      selection_policy: 'adaptive_rmse_v1',
      activity_model: true,
    },
    features: builtinFeatures(),
  });
  const fitted = selector.forDay(rows, issue, date);
  expect(fitted.report.activity_selection.supported).toBe(true);
  expect(fitted.model.snapshot.kind).toBe(VERSION);
  expect(
    fitted.predict({ ...time.parts(time.midnight(date)), ms: time.midnight(date) }).activity
      .probability
  ).toBeGreaterThan(0.8);
  for (const fold of fitted.report.activity_selection.candidate.folds)
    expect(Date.parse(fold.training_cutoff_exclusive)).toBeLessThan(time.midnight(fold.from));
}, 60000);

test('trained activity artifact survives store reload and forecasts with causal lag context', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { runEvaluation } = require('../src/forecast-evaluation');
  const { createStateStore } = require('../src/forecast-state-store');
  const { predictStateModel } = require('../src/forecast-state-api');
  const rows = history(212, (d) => (d % 4 < 2 ? 0 : 10));
  const date = shiftDate('2022-01-01', 211);
  const dataset = {
    series_id: 'activity-persist',
    unit: 'kWh',
    timezone: 'Europe/Berlin',
    period_from: '2022-01-01',
    period_until: date,
    values: rows.map((r) => ({ timestamp: new Date(r.ms).toISOString(), value: r.value })),
  };
  const configuration = {
    mode: 'rolling_day_ahead',
    relationship_mode: 'auto',
    model_family: 'learned_states',
    selection_policy: 'adaptive_rmse_v1',
    activity_model: true,
    feature_set: ['history', 'calendar'],
    forecast_period_from: date,
    forecast_period_until: date,
    history_from: '2022-01-01',
  };
  const result = runEvaluation({ datasets: [dataset], configuration, payload_fit_confirmed: true })
    .results[0];
  expect(result.forecast_run.model_version).toBe('relationship_state_adaptive_v5');
  expect(result.forecast_values.every((v) => v.activity_model)).toBe(true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-persist-'));
  try {
    const saved = createStateStore(root).save('sandbox', result.state_model_snapshot);
    const reloaded = predictStateModel(
      { ...saved, forecast_for: date },
      {},
      createStateStore(root)
    );
    expect(reloaded.forecast_values.map((v) => v.predicted_value)).toEqual(
      result.forecast_values.map((v) => v.predicted_value)
    );
    expect(reloaded.forecast_values.map((v) => v.activity_model)).toEqual(
      result.forecast_values.map((v) => v.activity_model)
    );
    for (const value of reloaded.forecast_values)
      for (const lag of value.activity_model.known_lags)
        expect(Date.parse(lag.available_at)).toBeLessThanOrEqual(
          Date.parse(value.forecast_created_at)
        );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120000);
