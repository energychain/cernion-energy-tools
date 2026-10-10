'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const MCP = require('./mcp-client');
const { clock, shiftDate, dateOnly, instant, STEP } = require('./forecast-evaluation-time');
const {
  LOCATION,
  quarterHours,
  loadWeatherDataset,
  weatherMetadata,
} = require('./forecast-weather-provider');
const { smardSeries, loadContextDataset, contextMetadata } = require('./forecast-context-provider');

function store(root, dataset) {
  const id = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  const directory = path.join(root, 'datasets');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${id}.json`);
  const temporary = `${file}.${randomUUID()}.partial`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(dataset), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return id;
}
function period(params, now, maximumDays) {
  const today = clock(LOCATION.timezone).parts(now).date;
  if (
    !dateOnly(params.from) ||
    !dateOnly(params.until) ||
    params.from < today ||
    params.until < params.from ||
    params.until > shiftDate(today, maximumDays - 1)
  )
    throw new Error(`Live features require dates between today and ${maximumDays - 1} days ahead.`);
}
async function prepareLiveWeather(
  params,
  {
    root = path.resolve('data/forecast-weather'),
    token,
    call = MCP.callWithNewSession.bind(MCP),
    now = Date.now,
  } = {}
) {
  period(params, now(), 14);
  const base = params.base_dataset_id ? loadWeatherDataset(params.base_dataset_id, root) : null;
  if (base && base.region !== LOCATION.id)
    throw new Error('Live weather base region must be Kempten.');
  const raw = await call(
    'mastr_generation_forecast',
    {
      location: { postleitzahl: LOCATION.postcode },
      installationType: 'solar',
      startDate: params.from,
      forecastDays: Math.round((Date.parse(params.until) - Date.parse(params.from)) / 86400000) + 1,
      resolution: 'hourly',
    },
    token
  );
  const acquired = now();
  if (!raw.success || raw.summary?.dataMode !== 'weather_forecast' || !raw.forecasts?.length)
    throw new Error(
      'Cernion did not return future weather forecasts; observations are not accepted.'
    );
  const hours = raw.forecasts.flatMap((row) => {
    const ms = instant(row.timestamp);
    return Number.isFinite(ms) && ms % 3600000 === 0 && Number.isFinite(row.weather?.temperature)
      ? [
          {
            ms,
            temperature: row.weather.temperature,
            global_radiation: row.weather.solarIrradiance,
            known: acquired,
            issued: acquired,
          },
        ]
      : [];
  });
  const forecast = quarterHours(hours, 'forecasts', params.from, params.until);
  if (!forecast.values.length) throw new Error('No usable live weather intervals.');
  const weather = {
    ...(base || {}),
    source: `${base?.source ? base.source + '; ' : ''}Cernion/Visual Crossing live weather forecast`,
    version: 'cernion-live-weather-v1',
    region: LOCATION.id,
    location: LOCATION,
    observations: base?.observations || [],
    forecasts: [...(base?.forecasts || []), ...forecast.values],
    live_acquisition: {
      acquired_at: new Date(acquired).toISOString(),
      provider_metadata: raw.metadata,
      issued_at_interpretation:
        'Conservative first-seen time, not claimed provider model-run time.',
      availability: 'Prefetch BEFORE the configured forecast origin. No backdating.',
      base_dataset_id: params.base_dataset_id || null,
      validation_limitation:
        'Live Visual Crossing forecast differs from the historical GFS fixed-lead validation source; quality is not guaranteed by that backtest.',
    },
    live_coverage: {
      intervals: forecast.values.length,
      incomplete_days: forecast.incomplete_days,
      ambiguous_hours_omitted: forecast.ambiguous_hours_omitted,
    },
  };
  return { weather_dataset_id: store(root, weather), ...weatherMetadata(weather) };
}
async function prepareLiveContext(
  params,
  {
    root = path.resolve('data/forecast-context'),
    now = Date.now,
    fetchJson = async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error(`SMARD HTTP ${response.status}`);
      return response.json();
    },
  } = {}
) {
  period(params, now(), 2);
  const time = clock(LOCATION.timezone);
  const base = params.base_dataset_id ? loadContextDataset(params.base_dataset_id, root) : null;
  // Isolate every live acquisition: a cached current-week file may lack newly published prices/load.
  const acquisitionRoot = path.join(root, 'live-acquisitions', randomUUID());
  const from = time.midnight(params.from),
    until = time.midnight(shiftDate(params.until, 1));
  const prices = await smardSeries(4169, 'DE-LU', 'quarterhour', from, until, {
    root: acquisitionRoot,
    fetchJson,
  });
  const loads = await smardSeries(
    410,
    'DE',
    'quarterhour',
    time.midnight(shiftDate(params.from, -2)),
    time.midnight(shiftDate(params.until, -1)),
    { root: acquisitionRoot, fetchJson }
  );
  const acquired = new Date(now()).toISOString();
  const rows = [];
  const warnings = [];
  for (let date = params.from; date <= params.until; date = shiftDate(date, 1)) {
    const lagStart = time.midnight(shiftDate(date, -2)),
      lagEnd = time.midnight(shiftDate(date, -1));
    let sum = 0,
      count = 0,
      priceCount = 0;
    for (let ms = lagStart; ms < lagEnd; ms += STEP)
      if (loads.values.has(ms)) {
        sum += loads.values.get(ms);
        count++;
      }
    const complete = count === (lagEnd - lagStart) / STEP;
    for (let ms = time.midnight(date); ms < time.midnight(shiftDate(date, 1)); ms += STEP) {
      const entry = { timestamp: new Date(ms).toISOString(), available_at: acquired };
      if (prices.values.has(ms)) {
        entry.day_ahead_price = prices.values.get(ms);
        priceCount++;
      }
      if (complete) {
        entry.grid_load_lag2 = sum / ((lagEnd - lagStart) / 3600000);
        entry.source_period_until = new Date(lagEnd).toISOString();
      }
      if (entry.day_ahead_price !== undefined || complete) rows.push(entry);
    }
    if (priceCount < (time.midnight(shiftDate(date, 1)) - time.midnight(date)) / STEP)
      warnings.push(`missing_or_unpublished_day_ahead_prices:${date}`);
    if (!complete) warnings.push(`incomplete_grid_load_lag2:${date}`);
  }
  const context = {
    ...(base || {}),
    source: 'Bundesnetzagentur SMARD',
    version: 'smard-live-context-v1',
    region: 'DE / DE-LU',
    units: { day_ahead_price: 'EUR/MWh', grid_load_lag2: 'MW (daily mean D-2)' },
    rows: [...(base?.rows || []), ...rows],
    live_acquisition: {
      acquired_at: acquired,
      base_dataset_id: params.base_dataset_id || null,
      availability: 'Verified acquisition time, never backdated to auction/publication time.',
      provenance: { price: prices.provenance, load: loads.provenance },
    },
    live_coverage: { context_rows: rows.length },
    warnings,
  };
  return { context_dataset_id: store(root, context), ...contextMetadata(context) };
}
module.exports = { prepareLiveWeather, prepareLiveContext };
