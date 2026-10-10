'use strict';

const { VERSION, learnLowLoadLabels, fitLowLoadModel } = require('../src/forecast-low-load-model');
const { createActivityFeatures, activityFeatures } = require('../src/forecast-activity-model');
const { fitModel, restoreModel } = require('../src/forecast-relationship-model');
const { createRelationshipSelector } = require('../src/forecast-relationship-selection');
const { builtinFeatures } = require('../src/forecast-hybrid-state-model');
const { clock, STEP, shiftDate } = require('../src/forecast-evaluation-time');
const { resolveFeatureConfiguration, runEvaluation } = require('../src/forecast-evaluation');
const time = clock('Europe/Berlin');
const spec = { family: VERSION, groups: ['weekday'], window_days: 84 };
const configuration = {
  mode: 'rolling_day_ahead',
  relationship_mode: 'auto',
  selection_policy: 'adaptive_rmse_v1',
  activity_model: true,
  activity_labeling: VERSION,
  feature_set: ['history', 'calendar'],
};

function history(days, value = (d) => (d % 4 < 2 ? 0.01 : 10)) {
  const rows = [];
  for (let d = 0; d < days; d++) {
    const date = shiftDate('2022-01-01', d);
    const eligible = time.midnight(shiftDate(date, 1));
    for (let ms = time.midnight(date); ms < eligible; ms += STEP)
      rows.push({ ms, ...time.parts(ms), eligible, value: value(d) });
  }
  return rows;
}

test('learns small nonzero standby labels, scales with units, rejects invalid data', () => {
  const rows = history(28);
  const labels = learnLowLoadLabels(rows);
  expect(labels.eligible).toBe(true);
  expect(labels.threshold).toBeGreaterThan(0.01);
  expect(labels.threshold).toBeLessThan(10);
  const scaled = learnLowLoadLabels(rows.map((r) => ({ ...r, value: r.value * 4 })));
  expect(scaled.threshold).toBeCloseTo(labels.threshold * 4, 12);
  expect(scaled.low_count).toBe(labels.low_count);
  expect(learnLowLoadLabels(history(14, () => 5)).eligible).toBe(false);
  for (const value of [-1, NaN, null, Infinity])
    expect(() => learnLowLoadLabels([{ value }])).toThrow(/finite nonnegative/);
});

test('all-zero and all-active histories give finite forecasts without inventing a second regime', () => {
  for (const value of [0, 7]) {
    const model = fitLowLoadModel(
      history(14, () => value),
      spec
    );
    expect(model.snapshot.labeling.eligible).toBe(false);
    expect(model.predict({ date: '2022-02-01', slot: '12:00' }).value).toBe(value);
  }
});

test('raw lag features enforce historical origin, late data and missing slots', () => {
  const rows = history(14);
  const lookup = createActivityFeatures(rows, time, { issue_time: '18:00' });
  const row = { date: '2022-01-10', slot: '12:00' };
  const before = lookup(row, time.midnight('2022-01-15'));
  for (const r of rows.filter((r) => r.date === '2022-01-08'))
    r.eligible = time.midnight('2022-01-10');
  const delayed = createActivityFeatures(rows, time, { issue_time: '18:00' })(
    row,
    time.midnight('2022-01-15')
  );
  expect(before.lag2_value).toBe(10);
  expect(delayed.lag2_value).toBeNull();
  const days = new Map([
    ['2022-01-08', { available: 1, counts: Array(96).fill(0), values: Array(96).fill(0) }],
  ]);
  expect(activityFeatures(row, days, 2).lag2_value).toBeNull();
});

test('two-part prediction learns alternating standby, ignores target actual and round-trips exactly', () => {
  const rows = history(84);
  const features = createActivityFeatures(rows, time, configuration);
  const issue = time.midnight('2022-04-01');
  const model = fitModel(
    rows.map((r) => ({ ...r, activity: features(r, issue) })),
    spec
  );
  const restored = restoreModel(JSON.parse(JSON.stringify(model.snapshot)));
  const row = {
    date: '2022-03-27',
    slot: '12:00',
    activity: { lag2_value: 10, lag7_value: 10, lag2_day_mean: 10 },
  };
  const p = model.predict(row);
  expect(p.value).toBeLessThan(0.1);
  expect(p.activity.predicted_label).toBe('low_load');
  expect(p.activity.conditional_low_mean).toBeCloseTo(0.01, 8);
  expect(p.value).toBe(
    (1 - p.activity.probability) * p.activity.conditional_low_mean +
      p.activity.probability * p.activity.conditional_active_mean
  );
  expect(restored.predict(row)).toEqual(p);
  expect(restored.predict({ ...row, value: 1e9 })).toEqual(p);
});

test('validates opt-in configuration and exposes the option in OpenAPI', () => {
  expect(resolveFeatureConfiguration(configuration).activity_labeling).toBe(VERSION);
  expect(() => resolveFeatureConfiguration({ activity_labeling: VERSION })).toThrow(
    /activity_model/
  );
  expect(() =>
    resolveFeatureConfiguration({ ...configuration, activity_labeling: 'unknown' })
  ).toThrow(/activity_labeling/);
  expect(() => resolveFeatureConfiguration({ ...configuration, feature_set: ['history'] })).toThrow(
    /calendar/
  );
  const { evaluationOperation } = require('../src/forecast-evaluation-openapi');
  const schema = evaluationOperation(true).requestBody.content['application/json'].schema;
  expect(schema.properties.configuration.properties.activity_labeling.enum).toEqual([VERSION]);
});

test('selector confirms standby without exact zeros and reports fold-specific labels and Brier score', () => {
  const rows = history(210);
  const date = shiftDate('2022-01-01', 211),
    issue = time.midnight(shiftDate(date, -1));
  const fitted = createRelationshipSelector({
    time,
    config: configuration,
    features: builtinFeatures(),
  }).forDay(rows, issue, date);
  const report = fitted.report.activity_selection;
  expect(report.supported).toBe(true);
  expect(report.maximum_mae_regression).toBe(0);
  expect(fitted.model.snapshot.kind).toBe(VERSION);
  for (const fold of report.candidate.folds) {
    expect(fold.low_load_labeling.threshold).toBeGreaterThan(0.01);
    expect(fold.activity_brier_score).toBeLessThan(0.02);
    expect(Date.parse(fold.training_cutoff_exclusive)).toBeLessThan(time.midnight(fold.from));
  }
}, 60000);

test('full evaluation and saved-model inference agree for learned low-load forecasts', () => {
  const fs = require('fs'),
    os = require('os'),
    path = require('path');
  const { createStateStore } = require('../src/forecast-state-store');
  const { predictStateModel } = require('../src/forecast-state-api');
  const rows = history(212);
  const date = shiftDate('2022-01-01', 211);
  const result = runEvaluation({
    datasets: [
      {
        series_id: 'low-load-roundtrip',
        unit: 'kWh',
        timezone: 'Europe/Berlin',
        period_from: '2022-01-01',
        period_until: date,
        values: rows.map((r) => ({ timestamp: new Date(r.ms).toISOString(), value: r.value })),
      },
    ],
    configuration: {
      ...configuration,
      model_family: 'learned_states',
      history_from: '2022-01-01',
      forecast_period_from: date,
      forecast_period_until: date,
    },
    payload_fit_confirmed: true,
  }).results[0];
  expect(result.forecast_values.every((v) => v.activity_model?.version === VERSION)).toBe(true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'low-load-roundtrip-'));
  try {
    const store = createStateStore(root);
    const saved = store.save('sandbox', result.state_model_snapshot);
    const restored = predictStateModel(
      { ...saved, forecast_for: date },
      {},
      createStateStore(root)
    );
    expect(restored.forecast_values.map((v) => v.predicted_value)).toEqual(
      result.forecast_values.map((v) => v.predicted_value)
    );
    expect(restored.forecast_values.map((v) => v.activity_model)).toEqual(
      result.forecast_values.map((v) => v.activity_model)
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120000);
