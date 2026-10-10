'use strict';

const { ServiceBroker } = require('moleculer');
const { runEvaluation, validateEvaluation } = require('../src/forecast-evaluation');
const { clock, STEP } = require('../src/forecast-evaluation-time');
const service = require('../services/forecast-sandbox.service');
const berlin = clock('Europe/Berlin');

function series(from, until, value = 10) {
  const result = [];
  for (let ms = berlin.midnight(from); ms < berlin.midnight(until); ms += STEP) {
    result.push({
      timestamp: new Date(ms).toISOString(),
      value: typeof value === 'function' ? value(ms) : value,
    });
  }
  return result;
}
function request(overrides = {}) {
  return {
    payload_fit_confirmed: true,
    datasets: [
      {
        series_id: 'pseudo-1',
        unit: 'kWh',
        timezone: 'Europe/Berlin',
        period_from: '2024-12-01',
        period_until: '2025-01-05',
        values: series('2024-12-01', '2025-01-06'),
      },
    ],
    configuration: {
      mode: 'rolling_day_ahead',
      relationship_mode: 'manual',
      forecast_period_from: '2025-01-01',
      forecast_period_until: '2025-01-05',
      feature_set: ['history'],
    },
    ...overrides,
  };
}
function predictions(result) {
  return result.results[0].forecast_values.map((v) => v.predicted_value);
}

describe('Rolling EDM evaluation UAT', () => {
  test('historical 2024 rolling holdout uses only prior data and retains the static 2025 boundary', () => {
    const input = request();
    input.datasets[0].period_from = '2023-12-01';
    input.datasets[0].period_until = '2024-01-03';
    input.datasets[0].values = series('2023-12-01', '2024-01-04', (ms) =>
      ms >= berlin.midnight('2024-01-01') ? 30 : 10
    );
    input.configuration.forecast_period_from = '2024-01-01';
    input.configuration.forecast_period_until = '2024-01-03';
    const result = runEvaluation(input).results[0];
    expect(result.forecast_values[0].predicted_value).toBe(10);
    expect(result.daily_results[0].training_data_until).toBe('2023-12-30T22:45:00.000Z');
    expect(result.backtest.sample_count).toBe(288);
    expect(result.backtest.rmse).toBeGreaterThan(0);
    input.configuration.mode = 'static_year_forecast';
    expect(() => runEvaluation(input)).toThrow(/within 2025 for static/);
  });

  test('D-2 cutoffs, actual availability and per-day trace', () => {
    const result = runEvaluation(request()).results[0];
    expect(result.daily_results.map((d) => d.training_data_until)).toEqual([
      '2024-12-30T22:45:00.000Z',
      '2024-12-31T22:45:00.000Z',
      '2025-01-01T22:45:00.000Z',
      '2025-01-02T22:45:00.000Z',
      '2025-01-03T22:45:00.000Z',
    ]);
    expect(result.backtest.mae).toBe(0);
    expect(result.forecast_run.state_history.at(-1)).toBe('readiness_dossier_created');
    expect(result.forecast_run.uses_weather_features).toBe(false);
    expect(result.readiness_dossier.warnings.join(' ')).toMatch(/missing_weather_data/);
  });

  test('changing D-1, D and later actuals cannot change the forecast for D', () => {
    const first = request();
    first.configuration.forecast_period_until = '2025-01-03';
    const changed = structuredClone(first);
    for (const row of changed.datasets[0].values) {
      if (row.timestamp >= '2025-01-01T23:00:00.000Z') row.value = 100000;
    }
    expect(predictions(runEvaluation(changed))).toEqual(predictions(runEvaluation(first)));
    expect(runEvaluation(changed).results[0].backtest.mae).toBeGreaterThan(0);
  });

  test('new actuals affect only later eligible rolling days, while static stays frozen', () => {
    const input = request();
    input.datasets[0].values = series('2024-12-01', '2025-01-06', (ms) =>
      ms >= berlin.midnight('2025-01-01') ? 30 : 10
    );
    const rolling = runEvaluation(input).results[0];
    expect(rolling.forecast_values[0].predicted_value).toBe(10);
    expect(rolling.forecast_values[192].predicted_value).toBeGreaterThan(10);
    input.configuration.mode = 'static_year_forecast';
    const frozen = runEvaluation(input).results[0];
    expect(frozen.forecast_values.every((v) => v.predicted_value === 10)).toBe(true);
    expect(rolling.backtest.mae).toBeLessThan(frozen.backtest.mae);
  });

  test('late measurements are not used before available_at', () => {
    const input = request();
    for (const r of input.datasets[0].values) {
      if (r.timestamp >= '2024-12-31T23:00:00.000Z') {
        r.value = 100;
        r.available_at = '2025-02-01T00:00:00Z';
      }
    }
    expect(predictions(runEvaluation(input)).every((v) => v === 10)).toBe(true);
  });

  test.each([
    ['2025-03-30', 92],
    ['2025-10-26', 100],
  ])('DST day %s has %i unique instants', (day, count) => {
    const input = request();
    input.configuration.forecast_period_from = day;
    input.configuration.forecast_period_until = day;
    const result = runEvaluation(input).results[0];
    expect(result.forecast_values).toHaveLength(count);
    expect(new Set(result.forecast_values.map((v) => v.timestamp)).size).toBe(count);
    expect(result.backtest.mae).toBeNull();
  });

  test('validates missing, duplicate, invalid, negative, off-grid and inconsistent-unit values', () => {
    const input = request();
    const values = input.datasets[0].values;
    values.splice(10, 1);
    values[20].value = -2;
    values.push({ ...values[0] });
    values.push({ timestamp: '2025-02-30T00:00:00Z', value: 1 });
    values.push({ timestamp: '2025-01-01T00:02:00Z', value: 1, unit: 'kW' });
    const validation = validateEvaluation(input).validations[0];
    expect(validation).toMatchObject({
      validation_status: 'fail',
      duplicate_intervals: 1,
      invalid_timestamps: 1,
      negative_value_count: 1,
      off_grid_intervals: 1,
      inconsistent_metadata: 1,
    });
    expect(() => runEvaluation(input)).toThrow('Dataset failed validation');
  });

  test('rejects ambiguous local timestamps, invalid dates, timezones and insufficient history', () => {
    const input = request();
    input.datasets[0].values[0].timestamp = '2025-10-26T02:00:00';
    expect(validateEvaluation(input).status).toBe('validation_failed');
    input.datasets[0].timezone = 'No/SuchZone';
    expect(() => validateEvaluation(input)).toThrow('Invalid IANA');
    const short = request();
    short.datasets[0].values = series('2024-12-29', '2025-01-01');
    expect(() => runEvaluation(short)).toThrow('1344');
    const bad = request();
    bad.configuration.forecast_period_from = '2025-02-30';
    expect(() => runEvaluation(bad)).toThrow('Forecast period');
  });

  test('MAPE excludes zero actuals and kW errors convert to quarter-hour kWh', () => {
    const input = request();
    input.datasets[0].unit = 'kW';
    input.datasets[0].values = series('2024-12-01', '2025-01-06', (ms) =>
      ms >= berlin.midnight('2025-01-01') ? 0 : 10
    );
    input.configuration.mode = 'static_year_forecast';
    const result = runEvaluation(input).results[0];
    expect(result.backtest).toMatchObject({
      mae: 10,
      rmse: 10,
      mape: null,
      bias: -10,
      max_error: 10,
      cumulative_error: -4800,
    });
    expect(result.deviation_energy).toMatchObject({
      unit: 'kWh',
      absolute_deviation: 1200,
      negative_deviation: -1200,
      positive_deviation: 0,
    });
    expect(result.deviation_energy.note).toMatch(/Proxy und keine Abrechnungs/);
  });

  test('calendar holiday buckets change predictions and document region/source/version', () => {
    const input = request();
    const holidays = ['2024-12-04', '2024-12-11', '2024-12-18', '2024-12-25', '2025-01-01'];
    for (const r of input.datasets[0].values)
      if (holidays.includes(berlin.parts(Date.parse(r.timestamp)).date)) r.value = 3;
    input.configuration.feature_set = ['history', 'calendar'];
    input.configuration.calendar = {
      source: 'uat',
      version: '1',
      country: 'DE',
      region: 'BW',
      days: holidays.map((date) => ({ date, holiday: true })),
    };
    const result = runEvaluation(input).results[0];
    expect(result.forecast_values[0].predicted_value).toBe(3);
    expect(result.forecast_run.feature_sources.calendar.region).toBe('BW');
    delete input.configuration.calendar;
    expect(() => runEvaluation(input)).toThrow('Calendar source');
  });

  test('weather uses archived forecasts only and ignores future-issued temperature', () => {
    const input = request();
    input.configuration.forecast_period_until = '2025-01-01';
    input.datasets[0].weather_region = 'region-1';
    const observations = [];
    for (const row of input.datasets[0].values) {
      const ms = Date.parse(row.timestamp);
      const temperature = new Date(ms).getUTCDate();
      row.value = 20 + 2 * temperature;
      observations.push({
        timestamp: row.timestamp,
        temperature,
        available_at: new Date(ms + STEP).toISOString(),
      });
    }
    const forecasts = series('2025-01-01', '2025-01-02').map((row) => ({
      timestamp: row.timestamp,
      temperature: 5,
      issued_at: '2024-12-30T12:00:00Z',
    }));
    input.configuration.feature_set = ['history', 'weather'];
    input.configuration.weather = {
      source: 'archived-uat',
      version: '1',
      region: 'region-1',
      observations,
      forecasts,
    };
    const original = runEvaluation(input);
    expect(predictions(original)[0]).toBeCloseTo(30);
    expect(original.results[0].forecast_run.uses_weather_features).toBe(true);
    input.configuration.weather.forecasts.push(
      ...forecasts.map((f) => ({ ...f, temperature: 999, issued_at: '2025-01-01T00:00:00Z' }))
    );
    expect(predictions(runEvaluation(input))).toEqual(predictions(original));
    input.configuration.weather.forecasts = [];
    expect(runEvaluation(input).results[0].forecast_run.uses_weather_features).toBe(false);
  });

  test('field mapping, multi-series isolation and explicit payload confirmation', () => {
    const input = request();
    const second = structuredClone(input.datasets[0]);
    second.series_id = 'pseudo-2';
    second.field_mapping = { timestamp: 'ts', value: 'load' };
    second.values = second.values.map((r) => ({ ts: r.timestamp, load: 20 }));
    input.datasets.push(second);
    const results = runEvaluation(input).results;
    expect(results.map((r) => r.forecast_values[0].predicted_value)).toEqual([10, 20]);
    input.payload_fit_confirmed = false;
    expect(() => runEvaluation(input)).toThrow('payload_fit_confirmed');
  });

  test('missing actuals remain null and partial coverage cannot receive a high rating', () => {
    const input = request();
    input.datasets[0].values = input.datasets[0].values.filter(
      (r) => r.timestamp < '2025-01-01T00:00:00.000Z'
    );
    const result = runEvaluation(input).results[0];
    expect(result.backtest.sample_count).toBe(4);
    expect(result.backtest.missing_actuals).toBe(476);
    expect(result.backtest.quality_rating).toBe('low');
    expect(result.forecast_values[4].actual_value).toBeNull();
    expect(result.forecast_values[4].deviation).toBeNull();
  });

  test('missing and anomalous values are reported, with descriptive structural diagnostics', () => {
    const input = request();
    input.datasets[0].values[1].value = null;
    input.datasets[0].values[2].quality_flag = 'missing';
    input.datasets[0].values[3].value = 100000;
    const result = runEvaluation(input).results[0];
    expect(result.validation.invalid_values).toBe(2);
    expect(result.validation.missing_intervals).toBe(2);
    expect(result.validation.outlier_count).toBe(1);
    expect(result.diagnostics.scope).toMatch(/not_training_features/);
  });

  test('calendar features are only reported when a matching training bucket is used', () => {
    const input = request();
    input.configuration.feature_set = ['history', 'calendar'];
    input.configuration.calendar = {
      source: 'uat',
      version: '1',
      country: 'DE',
      region: 'BW',
      features: ['month'],
      days: [],
    };
    input.configuration.forecast_period_until = '2025-01-01';
    const result = runEvaluation(input).results[0];
    expect(result.forecast_run.uses_calendar_features).toBe(false);
    expect(result.forecast_values[0].feature_set).toEqual(['history']);
    expect(result.readiness_dossier.warnings.join(' ')).toMatch(/calendar_profile_fallback/);
  });

  test('future-known calendar changes cannot influence earlier forecasts', () => {
    const input = request();
    input.configuration.feature_set = ['history', 'calendar'];
    input.configuration.calendar = {
      source: 'uat',
      version: '1',
      country: 'DE',
      region: 'BW',
      days: [],
    };
    const before = predictions(runEvaluation(input));
    input.configuration.calendar.days = [
      { date: '2024-12-02', holiday: true, known_at: '2025-02-01T00:00:00Z' },
    ];
    expect(predictions(runEvaluation(input))).toEqual(before);
  });

  test('malformed feature rows are structured client errors, and commercial scope is rejected', async () => {
    const input = request();
    input.configuration.feature_set = ['history', 'calendar'];
    input.configuration.calendar = {
      source: 'uat',
      version: '1',
      country: 'DE',
      region: 'BW',
      days: [null],
    };
    expect(() => runEvaluation(input)).toThrow('Calendar days');
    input.configuration.feature_set = ['history'];
    input.configuration.commercial_commitment = true;
    expect(() => runEvaluation(input)).toThrow('sandbox evaluation only');
  });

  test('complete 2020–2025 series supports a full rolling year including both DST transitions', () => {
    const input = request();
    input.datasets[0].period_from = '2020-01-01';
    input.datasets[0].period_until = '2025-12-31';
    input.datasets[0].values = series('2020-01-01', '2026-01-01', 10);
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(25 * 1024 * 1024);
    input.configuration.forecast_period_until = '2025-12-31';
    const result = runEvaluation(input).results[0];
    expect(result.validation.missing_intervals).toBe(0);
    expect(result.forecast_values).toHaveLength(365 * 96);
    expect(result.daily_results).toHaveLength(365);
    expect(result.backtest.mae).toBe(0);
    expect(result.daily_results.find((d) => d.forecast_for === '2025-10-26').intervals).toBe(100);
  }, 30000);

  test('Moleculer actions return structured failures and discoverable OpenAPI operations', async () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(service);
    await broker.start();
    try {
      const meta = {};
      const invalid = request();
      invalid.configuration.mode = 'unsupported';
      const error = await broker.call('forecast-sandbox.runEvaluation', invalid, { meta });
      expect(error.status).toBe('validation_failed');
      expect(meta.$statusCode).toBe(400);
      const good = await broker.call('forecast-sandbox.runEvaluation', request());
      expect(good.results[0].backtest.mae).toBe(0);
      const spec = await broker.call('forecast-sandbox.openapi');
      expect(
        spec.paths['/api/forecast-sandbox/consumption/evaluation/run'].post.requestBody
      ).toBeDefined();
    } finally {
      await broker.stop();
    }
  });
});
