'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareLiveWeather, prepareLiveContext } = require('../src/forecast-live-features');
const { loadWeatherDataset } = require('../src/forecast-weather-provider');
const { loadContextDataset, contextFeatures } = require('../src/forecast-context-provider');
const { clock, STEP } = require('../src/forecast-evaluation-time');
const time = clock('Europe/Berlin');
const acquired = Date.parse('2024-01-03T16:00:00Z');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-live-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('live weather records actual acquisition time and never accepts observed target weather', async () => {
  const forecasts = Array.from({ length: 24 }, (_, i) => ({
    timestamp: new Date(time.midnight('2024-01-04') + i * 3600000).toISOString(),
    weather: { temperature: 8, solarIrradiance: 25 },
  }));
  const params = { from: '2024-01-04', until: '2024-01-04' };
  const result = await prepareLiveWeather(params, {
    root,
    now: () => acquired,
    call: async () => ({ success: true, summary: { dataMode: 'weather_forecast' }, forecasts }),
  });
  const weather = loadWeatherDataset(result.weather_dataset_id, root);
  expect(weather.forecasts).toHaveLength(96);
  expect(
    weather.forecasts.every(
      (v) => v.available_at === new Date(acquired).toISOString() && v.issued_at === v.available_at
    )
  ).toBe(true);
  expect(weather.forecasts.every((v) => v.heating_degree_days_18 === 10)).toBe(true);
  await expect(
    prepareLiveWeather(params, {
      root,
      now: () => acquired,
      call: async () => ({
        success: true,
        summary: { dataMode: 'historical_observation' },
        forecasts,
      }),
    })
  ).rejects.toThrow(/observations/);
  await expect(
    prepareLiveWeather({ from: '2024-01-01', until: '2024-01-01' }, { root, now: () => acquired })
  ).rejects.toThrow(/Live features/);
});

test('live market preparation preserves quarter-hour prices, flags unpublished prices and verifies first-seen time', async () => {
  const stamp = time.midnight('2024-01-01');
  const load = Array.from({ length: 96 }, (_, i) => [time.midnight('2024-01-02') + i * STEP, 100]);
  const price = Array.from({ length: 48 }, (_, i) => [
    time.midnight('2024-01-04') + i * STEP,
    -7 + i,
  ]);
  const result = await prepareLiveContext(
    { from: '2024-01-04', until: '2024-01-04' },
    {
      root,
      now: () => acquired,
      fetchJson: async (url) => {
        if (url.includes('index_')) return { timestamps: [stamp] };
        return { series: url.includes('/410/') ? load : price, meta_data: { version: 1 } };
      },
    }
  );
  const context = loadContextDataset(result.context_dataset_id, root);
  expect(context.rows).toHaveLength(96);
  expect(context.rows.filter((r) => r.day_ahead_price !== undefined)).toHaveLength(48);
  expect(context.rows[0].day_ahead_price).toBe(-7);
  expect(context.rows[1].day_ahead_price).toBe(-6);
  expect(context.rows.every((r) => r.grid_load_lag2 === 400)).toBe(true);
  expect(result.warnings).toContain('missing_or_unpublished_day_ahead_prices:2024-01-04');
  const features = contextFeatures(context, true);
  expect(features.at(time.midnight('2024-01-04'), acquired - 1)).toEqual({});
  expect(features.at(time.midnight('2024-01-04'), acquired).grid_load_lag2).toBe(400);
});
