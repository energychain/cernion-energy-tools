'use strict';
const { clock, forecastOrigin, STEP } = require('../src/forecast-evaluation-time');
const { fitModel, restoreModel } = require('../src/forecast-relationship-model');
const { featureContext } = require('../src/forecast-evaluation');
const { contextFeatures } = require('../src/forecast-context-provider');
const { quarterHours, archivedForecastHours } = require('../src/forecast-weather-provider');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('18:00 origin resolves local DST correctly and leaves D-2 cutoff distinct', () => {
  const time = clock('Europe/Berlin');
  for (const day of ['2024-04-01', '2024-10-28']) {
    const ms = forecastOrigin(time, day, { issue_time: '18:00' });
    expect(time.parts(ms).slot).toBe('18:00');
    expect(ms).toBeGreaterThan(time.midnight(time.parts(ms).date));
  }
});
test('continuous context/weather model survives JSON persistence exactly', () => {
  const rows = Array.from({ length: 96 }, (_, i) => ({
    slot: '12:00',
    calendar: { season: i % 4 },
    weather: { global_radiation: (i * 17) % 400 },
    context: { day_ahead_price: ((i * 31) % 80) - 20 },
    value: 30 - ((i * 17) % 400) * 0.02 - (((i * 31) % 80) - 20) * 0.1,
  }));
  const fit = fitModel(rows, {
    groups: ['season', 'global_radiation', 'day_ahead_price'],
    window_days: null,
  });
  const restored = restoreModel(JSON.parse(JSON.stringify(fit.snapshot)));
  for (const row of rows) expect(restored.predict(row)).toEqual(fit.predict(row));
  expect(fit.coefficients.global_radiation).toBeLessThan(0);
  expect(fit.coefficients.day_ahead_price).toBeLessThan(0);
  expect(restored.predict(rows[0]).used_groups).toContain('day_ahead_price');
  expect(restored.predict({ ...rows[0], weather: {} }).fallback).toBe(true);
});
test('weather forecasts respect both issued_at and delayed available_at', () => {
  const stamp = '2024-01-03T12:00:00Z';
  const features = featureContext(
    {
      feature_set: ['history', 'weather'],
      weather: {
        source: 'test',
        version: 'v1',
        region: 'Kempten',
        observations: [],
        forecasts: [
          {
            timestamp: stamp,
            temperature: 3,
            issued_at: '2024-01-01T12:00:00Z',
            available_at: '2024-01-02T19:00:00Z',
          },
        ],
      },
    },
    { weather_region: 'Kempten' }
  );
  expect(features.forecastWeather(Date.parse(stamp), Date.parse('2024-01-02T18:00:00Z'))).toEqual(
    {}
  );
  expect(
    features.forecastWeather(Date.parse(stamp), Date.parse('2024-01-02T20:00:00Z')).temperature
  ).toBe(3);
});
test('external features select latest known revision per field, allow negative prices, reject future source periods', () => {
  const timestamp = '2024-01-03T00:00:00Z';
  const rows = [
    { timestamp, available_at: '2024-01-02T17:00:00Z', day_ahead_price: -10 },
    { timestamp, available_at: '2024-01-03T17:00:00Z', day_ahead_price: 999 },
    {
      timestamp,
      available_at: '2024-01-02T06:00:00Z',
      grid_load_lag2: 30000,
      source_period_until: '2024-01-01T23:00:00Z',
    },
  ];
  const context = { source: 'test', region: 'DE', version: '1', rows };
  expect(
    contextFeatures(context, true).at(Date.parse(timestamp), Date.parse('2024-01-02T18:00:00Z'))
  ).toEqual({ day_ahead_price: -10, grid_load_lag2: 30000 });
  expect(() =>
    contextFeatures(
      { ...context, rows: [{ ...rows[2], source_period_until: '2024-01-04T00:00:00Z' }] },
      true
    )
  ).toThrow();
});
test.each(['2024-03-31', '2024-10-27'])(
  'weather %s maps physical DST hours and daily HDD',
  (date) => {
    const time = clock('Europe/Berlin');
    const end = time.midnight(date === '2024-03-31' ? '2024-04-01' : '2024-10-28');
    const hours = [];
    for (let ms = time.midnight(date); ms < end; ms += 3600000)
      hours.push({ ms, temperature: 8, global_radiation: 20, known: ms + 3600000 });
    const result = quarterHours(hours, 'observations', date, date);
    expect(result.values).toHaveLength((end - time.midnight(date)) / STEP);
    expect(result.values.every((v) => v.heating_degree_days_18 === 10)).toBe(true);
    expect(new Set(result.values.map((v) => v.timestamp)).size).toBe(result.values.length);
    expect(result.values.every((v) => Date.parse(v.available_at) === end)).toBe(true);
  }
);
test('ambiguous weather hours are omitted instead of invented DST repairs', () => {
  const ms = Date.parse('2024-10-27T00:00:00Z');
  const result = quarterHours(
    [
      { ms, temperature: 2, known: ms },
      { ms, temperature: 4, known: ms },
    ],
    'observations',
    '2024-10-27',
    '2024-10-27'
  );
  expect(result.values).toHaveLength(0);
  expect(result.ambiguous_hours_omitted).toBe(1);
});
test('archive uses fixed lead and shifts preceding-hour radiation without substituting missing values', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-archive-'));
  try {
    const ms = Date.parse('2024-01-01T00:00:00Z');
    const result = await archivedForecastHours({
      from: '2024-01-01',
      until: '2024-01-01',
      root,
      fetchJson: async (url) => {
        expect(url).toContain('previous_day3');
        return {
          hourly_units: { temperature_2m_previous_day3: '°C' },
          hourly: {
            time: [ms / 1000, ms / 1000 + 3600],
            temperature_2m_previous_day3: [1, 2],
            shortwave_radiation_previous_day3: [7, 11],
          },
        };
      },
    });
    expect(result.hours[0].global_radiation).toBe(11);
    expect(result.hours[1].global_radiation).toBeUndefined();
    expect(result.hours[0].known).toBeLessThan(ms);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('persisted extended model uses refreshed target features and replays exact continuous predictions', () => {
  const { trainStateModel, predictStateModel } = require('../src/forecast-state-api');
  const { createStateStore } = require('../src/forecast-state-store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-model-'));
  try {
    const store = createStateStore(root);
    const start = Date.parse('2024-01-01T00:00:00Z');
    const values = Array.from({ length: 30 * 96 }, (_, i) => ({
      timestamp: new Date(start + i * STEP).toISOString(),
      value: 20,
    }));
    const dataset = {
      series_id: 'context-test',
      timezone: 'UTC',
      unit: 'kWh',
      weather_region: 'Kempten',
      period_from: '2024-01-01',
      period_until: '2024-01-30',
      values,
    };
    const trained = trainStateModel(
      {
        dataset,
        forecast_for: '2024-02-01',
        configuration: { extended_features: true, issue_time: '18:00' },
      },
      {},
      store
    );
    const artifact = store.load('sandbox', dataset.series_id, trained.artifact_version);
    const rows = values.map((v, i) => ({
      value: 20 - (i % 17),
      slot: clock('UTC').parts(Date.parse(v.timestamp)).slot,
      calendar: {},
      weather: { temperature: i % 17 },
    }));
    const fit = fitModel(rows, { groups: ['temperature'], window_days: null });
    artifact.model.reference_model = fit.snapshot;
    artifact.model.state_features_enabled = false;
    const saved = store.save('sandbox', artifact);
    const forecasts = Array.from({ length: 96 }, (_, i) => ({
      timestamp: new Date(Date.parse('2024-02-01T00:00:00Z') + i * STEP).toISOString(),
      temperature: i % 10,
      issued_at: '2024-01-31T12:00:00Z',
      available_at: '2024-01-31T17:00:00Z',
    }));
    const result = predictStateModel(
      {
        series_id: dataset.series_id,
        artifact_version: saved.artifact_version,
        forecast_for: '2024-02-01',
        configuration: {
          weather: { source: 'test', version: '1', region: 'Kempten', observations: [], forecasts },
        },
      },
      {},
      store
    );
    expect(result.forecast_values).toHaveLength(96);
    for (const [i, value] of result.forecast_values.entries()) {
      const expected = fit.predict({
        slot: clock('UTC').parts(Date.parse(value.timestamp)).slot,
        calendar: {},
        weather: forecasts[i],
      });
      expect(value.predicted_value).toBe(expected.value);
      expect(value.forecast_created_at).toBe('2024-01-31T18:00:00.000Z');
    }
    expect(result.warnings).not.toContain('missing_feature_values_reference_fallback');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('auto selection confirms price response, rejects constant grid context and ignores later price revisions', () => {
  const { runEvaluation } = require('../src/forecast-evaluation');
  const time = clock('UTC');
  const values = [];
  const rows = [];
  const start = time.midnight('2024-01-01');
  for (let ms = start; ms < time.midnight('2024-09-02'); ms += STEP) {
    const { date } = time.parts(ms);
    const day = Math.floor((ms - start) / 86400000);
    const price = ((day * 37) % 91) - 20;
    const timestamp = new Date(ms).toISOString();
    values.push({ timestamp, value: 100 - 0.3 * price });
    rows.push({
      timestamp,
      day_ahead_price: price,
      available_at: new Date(forecastOrigin(time, date, { issue_time: '18:00' })).toISOString(),
      grid_load_lag2: 40000,
      source_period_until: new Date(time.midnight(date) - 86400000).toISOString(),
    });
  }
  const input = {
    payload_fit_confirmed: true,
    datasets: [
      {
        series_id: 'price-test',
        timezone: 'UTC',
        unit: 'kWh',
        period_from: '2024-01-01',
        period_until: '2024-09-01',
        values,
      },
    ],
    configuration: {
      mode: 'rolling_day_ahead',
      forecast_period_from: '2024-09-01',
      forecast_period_until: '2024-09-01',
      issue_time: '18:00',
      feature_set: ['history', 'context'],
      context: { source: 'synthetic', version: '1', region: 'DE', rows },
    },
  };
  const result = runEvaluation(input).results[0];
  const report = result.relationship_analysis.selections[0];
  expect(report.selected_groups).toEqual(['day_ahead_price']);
  expect(
    report.relationships.find((r) => r.feature === 'day_ahead_price').conditional_ablation.supported
  ).toBe(true);
  expect(result.backtest.rmse).toBeLessThan(0.1);
  expect(result.forecast_run.uses_context_features).toBe(true);
  expect(result.forecast_run.uses_weather_features).toBe(false);
  for (const row of rows.filter((r) => r.timestamp.startsWith('2024-09-01')))
    input.configuration.context.rows.push({
      ...row,
      day_ahead_price: 999,
      available_at: '2024-09-01T00:00:00Z',
    });
  const revised = runEvaluation(input).results[0];
  expect(revised.forecast_values.map((v) => v.predicted_value)).toEqual(
    result.forecast_values.map((v) => v.predicted_value)
  );
}, 60000);
