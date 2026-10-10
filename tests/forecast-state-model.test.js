'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clock, STEP, shiftDate } = require('../src/forecast-evaluation-time');
const {
  dailyHistory,
  fitStateModel,
  statePrediction,
  validateStates,
} = require('../src/forecast-state-model');
const { runEvaluation } = require('../src/forecast-evaluation');
const { createStateStore } = require('../src/forecast-state-store');
const {
  trainStateModel,
  predictStateModel,
  inspectStateModel,
} = require('../src/forecast-state-api');
const time = clock('Europe/Berlin');
function dataset(from, until, fn = () => 5) {
  const values = [];
  for (let ms = time.midnight(from); ms < time.midnight(shiftDate(until, 1)); ms += STEP) {
    values.push({ timestamp: new Date(ms).toISOString(), value: fn(time.parts(ms), ms) });
  }
  return {
    series_id: 'state-test',
    unit: 'kWh',
    timezone: 'Europe/Berlin',
    period_from: from,
    period_until: until,
    values,
  };
}
function rows(d) {
  return d.values.map((r) => {
    const ms = Date.parse(r.timestamp);
    const local = time.parts(ms);
    return {
      ms,
      value: r.value,
      ...local,
      eligible: Math.max(
        time.midnight(shiftDate(local.date, 1)),
        Date.parse(r.available_at || '1970-01-01')
      ),
    };
  });
}
const regime = (p) => (Math.floor(Date.parse(p.date) / 86400000 / 35) % 2 ? 20 : 0);

describe('Causal learned daily states', () => {
  let root;
  let store;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-state-'));
    store = createStateStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  test('persistent regimes improve held-out forecasts, probabilities sum to one', () => {
    const d = dataset('2023-01-01', '2024-03-01', regime);
    const days = dailyHistory(rows(d), time);
    const issue = time.midnight('2024-01-01');
    const m = fitStateModel(days, issue, time);
    let candidate = 0;
    let reference = 0;
    for (let date = '2024-01-02'; date < '2024-03-01'; date = shiftDate(date, 1)) {
      const p = statePrediction(m, days, time, date, '12:00', time.midnight(shiftDate(date, -1)));
      expect(p.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(p.probabilities.every((v) => v >= 0 && v <= 1)).toBe(true);
      candidate += (p.candidate - regime({ date })) ** 2;
      reference += (p.reference - regime({ date })) ** 2;
    }
    expect(candidate).toBeLessThan(reference * 0.8);
    const evidence = validateStates(
      days.filter((d) => d.date < '2024-01-01'),
      issue,
      time
    );
    expect(evidence.folds).toHaveLength(4);
  });
  test('future and late measurements cannot change labels, selection or predictions', () => {
    const d = dataset('2023-08-01', '2024-01-10', regime);
    const config = {
      model_family: 'learned_states',
      mode: 'rolling_day_ahead',
      forecast_period_from: '2024-01-03',
      forecast_period_until: '2024-01-03',
    };
    const request = { datasets: [d], configuration: config, payload_fit_confirmed: true };
    const first = runEvaluation(request).results[0];
    const changed = structuredClone(request);
    for (const r of changed.datasets[0].values)
      if (Date.parse(r.timestamp) >= time.midnight('2024-01-02')) r.value = 100000;
    const second = runEvaluation(changed).results[0];
    expect(second.relationship_analysis).toEqual(first.relationship_analysis);
    expect(second.forecast_values.map((v) => v.predicted_value)).toEqual(
      first.forecast_values.map((v) => v.predicted_value)
    );
    expect(second.state_model_snapshot).toEqual(first.state_model_snapshot);
    const late = rows(d);
    for (const r of late) if (r.date === '2024-01-01') r.eligible = time.midnight('2024-01-10');
    const days = dailyHistory(late, time);
    const m = fitStateModel(days, time.midnight('2024-01-02'), time);
    const p = statePrediction(m, days, time, '2024-01-03', '12:00', time.midnight('2024-01-02'));
    expect(p.known.some((k) => k.date === '2024-01-01')).toBe(false);
  });
  test('train, reload in a fresh store, predict without retraining; tenant isolation and tamper detection', () => {
    const d = dataset('2024-09-01', '2024-12-31', regime);
    const trained = trainStateModel(
      { dataset: d, forecast_for: '2025-01-02' },
      { tenantId: 'a' },
      store
    );
    const params = {
      series_id: d.series_id,
      artifact_version: trained.artifact_version,
      forecast_for: '2025-01-02',
    };
    const predicted = predictStateModel(params, { tenantId: 'a' }, createStateStore(root));
    expect(predicted.forecast_values).toHaveLength(96);
    expect(predicted.forecast_values[0].training_data_until < '2025-01-01T00:00:00Z').toBe(true);
    expect(() => inspectStateModel(params, { tenantId: 'b' }, store)).toThrow(/unavailable/);
    expect(() =>
      predictStateModel({ ...params, forecast_for: '2024-12-01' }, { tenantId: 'a' }, store)
    ).toThrow(/after/);
    const files = fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.json'));
    fs.writeFileSync(path.join(root, files[0]), '{}');
    expect(() => inspectStateModel(params, { tenantId: 'a' }, store)).toThrow(/unavailable/);
  });
  test.each([
    ['2025-03-30', 92],
    ['2025-10-26', 100],
  ])('DST target %s returns %i intervals after reload', (date, count) => {
    const d = dataset(shiftDate(date, -35), shiftDate(date, -2));
    const trained = trainStateModel({ dataset: d, forecast_for: date }, {}, store);
    const p = predictStateModel(
      { series_id: d.series_id, artifact_version: trained.artifact_version, forecast_for: date },
      {},
      store
    );
    expect(p.forecast_values).toHaveLength(count);
    expect(new Set(p.forecast_values.map((v) => v.timestamp)).size).toBe(count);
    expect(p.forecast_values.every((v) => Number.isFinite(v.predicted_value))).toBe(true);
  });
  test('all-zero series retains finite zero reference; context updates persist without parameter changes', () => {
    const d = dataset('2025-01-01', '2025-02-01', () => 0);
    const trained = trainStateModel({ dataset: d, forecast_for: '2025-02-03' }, {}, store);
    const p = predictStateModel(
      {
        series_id: d.series_id,
        artifact_version: trained.artifact_version,
        forecast_for: '2025-02-05',
        recent_dataset: dataset('2025-02-02', '2025-02-03', () => 0),
      },
      {},
      store
    );
    expect(p.artifact_version).not.toBe(trained.artifact_version);
    expect(
      p.forecast_values.every((v) => v.predicted_value === 0 && !v.state_features_enabled)
    ).toBe(true);
    expect(store.load('sandbox', d.series_id, p.artifact_version).model).toEqual(
      store.load('sandbox', d.series_id, trained.artifact_version).model
    );
  });
  test('real live dates after 2025 are supported by persistent train/predict, evaluation stays historical', () => {
    const d = dataset('2026-01-01', '2026-02-01');
    const t = trainStateModel({ dataset: d, forecast_for: '2026-02-03' }, {}, store);
    expect(
      predictStateModel(
        {
          series_id: d.series_id,
          artifact_version: t.artifact_version,
          forecast_for: '2026-02-03',
        },
        {},
        store
      ).forecast_values
    ).toHaveLength(96);
    expect(() =>
      runEvaluation({
        datasets: [d],
        configuration: {
          mode: 'rolling_day_ahead',
          forecast_period_from: '2026-02-03',
          forecast_period_until: '2026-02-03',
        },
        payload_fit_confirmed: true,
      })
    ).toThrow(/2025/);
  });
  test('rejects negative consumption and malformed feature requests', () => {
    expect(() =>
      trainStateModel(
        { dataset: dataset('2025-01-01', '2025-02-01', () => -1), forecast_for: '2025-02-03' },
        {},
        store
      )
    ).toThrow(/nonnegative/);
    expect(() =>
      runEvaluation({
        datasets: [],
        configuration: { mode: 'rolling_day_ahead', model_family: 'learned_states', weather: {} },
      })
    ).toThrow(/Forecast period/);
  });
});

// Equal folded autumn-slot means can conceal distinct physical observations.
test('history fingerprint includes physical DST dispersion and label descriptors', () => {
  const d = dataset('2024-10-01', '2024-10-31', () => 1);
  const altered = structuredClone(d);
  for (const r of altered.values) {
    if (r.timestamp === '2024-10-27T00:00:00.000Z') r.value = 0;
    if (r.timestamp === '2024-10-27T01:00:00.000Z') r.value = 2;
  }
  const a = fitStateModel(dailyHistory(rows(d), time), time.midnight('2024-11-01'), time);
  const b = fitStateModel(dailyHistory(rows(altered), time), time.midnight('2024-11-01'), time);
  expect(a.all).toEqual(b.all);
  expect(a.history_digest).not.toBe(b.history_digest);
});
