'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fitModel } = require('../src/forecast-relationship-model');
const {
  builtinFeatures,
  calendarPredictor,
  correction,
  VERSION,
} = require('../src/forecast-hybrid-state-model');
const { runEvaluation } = require('../src/forecast-evaluation');
const { createStateStore } = require('../src/forecast-state-store');
const { predictStateModel } = require('../src/forecast-state-api');
const { clock, STEP, shiftDate } = require('../src/forecast-evaluation-time');
const { createStateSelector, VERSION: LEGACY_VERSION } = require('../src/forecast-state-model');

const time = clock('Europe/Berlin');
function fixture() {
  const values = [];
  for (let ms = time.midnight('2024-01-01'); ms < time.midnight('2024-02-04'); ms += STEP) {
    const p = time.parts(ms);
    values.push({
      timestamp: new Date(ms).toISOString(),
      value: 10 + p.weekday + Number(p.slot.slice(0, 2)) / 24,
    });
  }
  return {
    series_id: 'hybrid-test',
    unit: 'kWh',
    timezone: 'Europe/Berlin',
    period_from: '2024-01-01',
    period_until: '2024-02-03',
    values,
  };
}

test('serialized seasonal reference has exact parity including sparse bucket fallback', () => {
  const features = builtinFeatures();
  const rows = [];
  for (let month = 1; month <= 12; month++)
    for (let day = 1; day <= 8; day++) {
      const date = `2023-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const row = {
        date,
        weekday: new Date(date).getUTCDay(),
        slot: '12:00',
        value: month * 3 + day,
      };
      rows.push({ ...row, calendar: features.calendarAttributes(row) });
    }
  for (const groups of [[], ['month'], ['weekday'], ['month', 'weekday']]) {
    const model = fitModel(rows, { groups, window_days: 84 });
    const restored = calendarPredictor(JSON.parse(JSON.stringify(model.calendar_snapshot)));
    for (const row of rows) expect(restored(row)).toBe(model.predict(row).value);
  }
});

test('state correction preserves the reference level and has fixed shrinkage', () => {
  expect(correction(100, { candidate: 15, reference: 5 })).toBe(105);
  expect(correction(100, { candidate: 5, reference: 5 })).toBe(100);
  expect(correction(1, { candidate: 0, reference: 20 })).toBe(0);
});

test('unconfirmed state signal retains exact automatic output and persisted replay', () => {
  const dataset = fixture();
  const configuration = {
    mode: 'rolling_day_ahead',
    forecast_period_from: '2024-02-03',
    forecast_period_until: '2024-02-03',
  };
  const request = { datasets: [dataset], configuration, payload_fit_confirmed: true };
  const baseline = runEvaluation(request).results[0];
  const hybrid = runEvaluation({
    ...request,
    configuration: { ...configuration, model_family: 'learned_states' },
  }).results[0];
  expect(hybrid.forecast_values.map((v) => v.predicted_value)).toEqual(
    baseline.forecast_values.map((v) => v.predicted_value)
  );
  expect(
    hybrid.forecast_values.every((v) => !v.state_features.enabled && v.model_version === VERSION)
  ).toBe(true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-replay-'));
  try {
    const store = createStateStore(root);
    const saved = store.save('sandbox', hybrid.state_model_snapshot);
    const replay = predictStateModel(
      { ...saved, forecast_for: '2024-02-03' },
      {},
      createStateStore(root)
    );
    expect(replay.forecast_values.map((v) => v.predicted_value)).toEqual(
      hybrid.forecast_values.map((v) => v.predicted_value)
    );
    expect(replay.model_version).toBe(VERSION);
    // Exercise persisted inference with the correction enabled as well. The gate
    // is bypassed only in this unit fixture, never by the API.
    const enabledArtifact = structuredClone(hybrid.state_model_snapshot);
    enabledArtifact.model.state_features_enabled = true;
    const enabled = store.save('sandbox', enabledArtifact);
    const corrected = predictStateModel(
      { ...enabled, forecast_for: '2024-02-03' },
      {},
      createStateStore(root)
    );
    expect(corrected.forecast_values.map((v) => v.predicted_value)).toEqual(
      hybrid.forecast_values.map((v) => v.state_features.candidate_prediction)
    );
    const rows = dataset.values
      .map((v) => {
        const ms = Date.parse(v.timestamp);
        const p = time.parts(ms);
        return { ms, value: v.value, ...p, eligible: time.midnight(shiftDate(p.date, 1)) };
      })
      .filter((r) => r.date < '2024-02-02');
    const legacy = createStateSelector({ time });
    legacy.forDay(rows, time.midnight('2024-02-02'), '2024-02-03');
    const old = store.save('sandbox', {
      ...legacy.snapshot(),
      series_id: dataset.series_id,
      unit: dataset.unit,
      timezone: dataset.timezone,
    });
    const oldReplay = predictStateModel({ ...old, forecast_for: '2024-02-03' }, {}, store);
    expect(oldReplay.model_version).toBe(LEGACY_VERSION);
    expect(oldReplay.forecast_values).toHaveLength(96);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('past-only validation activates useful persistent regimes over the automatic reference', () => {
  const { createHybridStateSelector } = require('../src/forecast-hybrid-state-model');
  const rows = [];
  for (let ms = time.midnight('2023-01-01'); ms < time.midnight('2024-01-01'); ms += STEP) {
    const p = time.parts(ms);
    rows.push({
      ms,
      ...p,
      eligible: time.midnight(shiftDate(p.date, 1)),
      value: Math.floor(Date.parse(p.date) / 86400000 / 35) % 2 ? 20 : 0,
    });
  }
  const selector = createHybridStateSelector({ time });
  const result = selector.forDay(rows, time.midnight('2024-01-01'), '2024-01-02');
  expect(result.report.validation.supported).toBe(true);
  expect(result.report.validation.mae_guard_passed).toBe(true);
  expect(result.report.validation.folds).toHaveLength(4);
  for (const fold of result.report.validation.folds) {
    expect(Date.parse(fold.state_training_until)).toBeLessThan(
      time.midnight(shiftDate(fold.from, -1))
    );
    for (const reference of fold.reference_fits)
      expect(Date.parse(reference.training_data_until)).toBeLessThan(
        time.midnight(shiftDate(reference.forecast_for, -1))
      );
  }
  const p = result.predict({
    ...time.parts(time.midnight('2024-01-02')),
    ms: time.midnight('2024-01-02'),
  });
  expect(p.state.enabled).toBe(true);
  expect(p.used_groups).toContain('weekday');
  expect(p.value).toBe(p.state.candidate_prediction);
});
