'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  completeArchivedForecastHours,
  archivedForecastHours,
  quarterHours,
  weatherCoverage,
} = require('../src/forecast-weather-provider');

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-coverage-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function archiveResponse(url, missingPrimary = true) {
  const query = new URL(url).searchParams;
  const fallback = query.get('models') === 'jma_gsm';
  const start = Date.parse(query.get('start_date'));
  const stop = Date.parse(query.get('end_date')) + 86400000;
  const time = [];
  const temperature = [];
  const radiation = [];
  for (let ms = start; ms < stop; ms += 3600000) {
    time.push(ms / 1000);
    temperature.push(!fallback && missingPrimary && ms % 86400000 === 0 ? null : fallback ? 9 : 2);
    radiation.push(fallback ? null : 100);
  }
  return {
    hourly_units: { temperature_2m_previous_day3: '°C' },
    hourly: {
      time,
      temperature_2m_previous_day3: temperature,
      shortwave_radiation_previous_day3: radiation,
    },
  };
}

test('fallback fills missing primary hours only; no fabricated radiation; availability remains conservative', async () => {
  const result = await completeArchivedForecastHours({
    from: '2023-12-31',
    until: '2024-01-02',
    root,
    fetchJson: async (url) => archiveResponse(url),
  });
  expect(result.hours).toHaveLength(72);
  expect(result.hours.filter((r) => r.temperature === 9)).toHaveLength(3);
  expect(result.hours.filter((r) => r.temperature === 2)).toHaveLength(69);
  expect(
    result.hours.filter((r) => r.temperature === 9).every((r) => r.global_radiation === undefined)
  ).toBe(true);
  expect(result.hours.every((r) => r.known === r.ms - 47 * 3600000)).toBe(true);
  expect(
    result.sources.some((s) => s.model === 'jma_gsm' && s.role === 'missing_temperature_fallback')
  ).toBe(true);
  const quarters = quarterHours(result.hours, 'forecasts', '2024-01-01', '2024-01-01');
  expect(quarters.values).toHaveLength(96);
  expect(quarters.values.every((r) => Number.isFinite(r.heating_degree_days_18))).toBe(true);
  expect(
    quarters.values.every(
      (r) => Date.parse(r.available_at) <= Date.parse('2023-12-31T00:00:00+01:00')
    )
  ).toBe(true);
  expect(quarters.values.some((r) => r.forecast_source.includes('jma'))).toBe(true);
});

test('complete primary needs no fallback and radiation survives UTC chunk boundary', async () => {
  const models = [];
  const result = await completeArchivedForecastHours({
    from: '2024-01-01',
    until: '2024-01-01',
    root,
    fetchJson: async (url) => {
      models.push(new URL(url).searchParams.get('models'));
      return archiveResponse(url, false);
    },
  });
  expect(models).toEqual(['gfs_global']);
  expect(result.hours).toHaveLength(24);
  expect(result.hours[23].global_radiation).toBe(100);
});

test('fallback failure retains primary and records missing coverage', async () => {
  const result = await completeArchivedForecastHours({
    from: '2024-01-01',
    until: '2024-01-01',
    root,
    fetchJson: async (url) => {
      if (new URL(url).searchParams.get('models') === 'jma_gsm') throw new Error('offline');
      return archiveResponse(url);
    },
  });
  expect(result.hours).toHaveLength(23);
  expect(result.fallback_errors[0].error).toBe('offline');
});

test('coverage counts entirely absent days and both DST transitions', () => {
  for (const [date, count] of [
    ['2024-03-31', 92],
    ['2024-10-27', 100],
  ]) {
    const coverage = weatherCoverage([], date, date);
    expect(coverage.years['2024'].expected_intervals).toBe(count);
    expect(coverage.missing_temperature_days[0].missing_temperature_intervals).toBe(count);
  }
});

test('unknown models cannot silently substitute forecasts', async () => {
  await expect(
    archivedForecastHours({ from: '2024-01-01', until: '2024-01-01', root, model: 'best_match' })
  ).rejects.toThrow('Unsupported');
});
