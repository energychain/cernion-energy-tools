'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const MCP = require('./mcp-client');
const { clock, STEP, shiftDate, dateOnly, instant } = require('./forecast-evaluation-time');
const HOUR = 3600000;
const LOCATION = Object.freeze({
  id: 'DE-BY-Kempten-87435',
  name: 'Kempten (Allgäu)',
  postcode: '87435',
  latitude: 47.72674,
  longitude: 10.31389,
  timezone: 'Europe/Berlin',
});
const VERSION = 'cernion-vc-gfs-jma-weather-v2';
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.partial`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function checkPeriod(from, until) {
  if (!dateOnly(from) || !dateOnly(until) || from > until || from < '2020-01-01')
    throw new Error('Weather period must be ordered local dates from 2020 onward.');
  if ((Date.parse(until) - Date.parse(from)) / 86400000 > 2556)
    throw new Error('Weather period must not exceed seven years.');
}

async function cernionHours({
  from,
  until,
  token,
  root,
  call = MCP.callWithNewSession.bind(MCP),
  progress = () => {},
}) {
  checkPeriod(from, until);
  const time = clock(LOCATION.timezone);
  if (until >= time.parts(Date.now()).date)
    throw new Error('Historical observations must end before today.');
  const hours = [];
  const sources = [];
  for (let start = from; start <= until; start = shiftDate(start, 14)) {
    const end = [shiftDate(start, 13), until].sort()[0];
    const params = {
      location: { postleitzahl: LOCATION.postcode },
      installationType: 'solar',
      startDate: start,
      forecastDays: Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
      resolution: 'hourly',
    };
    const file = path.join(
      root,
      'raw',
      `${digest(['cernion-weather-with-radiation-v2', params])}.json`
    );
    let raw;
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      const result = await call('mastr_generation_forecast', params, token);
      if (
        !result.success ||
        result.summary?.dataMode !== 'historical_observation' ||
        !result.forecasts?.length
      )
        throw new Error(`Cernion returned no historical weather for ${start}–${end}.`);
      raw = {
        fetched_at: new Date().toISOString(),
        summary: result.summary,
        hours: result.forecasts.map((r) => ({
          timestamp: r.timestamp,
          temperature: r.weather?.temperature,
          global_radiation: r.weather?.solarIrradiance,
        })),
      };
      atomicJson(file, raw);
    }
    let count = 0;
    for (const row of raw.hours) {
      const ms = instant(row.timestamp);
      if (!Number.isFinite(ms) || ms % HOUR || !Number.isFinite(row.temperature)) continue;
      const day = time.parts(ms).date;
      if (day < start || day > end) continue;
      hours.push({
        ms,
        temperature: row.temperature,
        global_radiation: row.global_radiation,
        // Retrospective availability assumption, not a provider publication timestamp.
        known: ms + HOUR + 24 * HOUR,
      });
      count++;
    }
    if (!count) throw new Error(`Cernion returned no usable temperatures for ${start}–${end}.`);
    sources.push({
      from: start,
      until: end,
      fetched_at: raw.fetched_at,
      sha256: digest(raw),
      hours: count,
    });
    progress({ provider: 'cernion_visual_crossing', from: start, until: end, hours: count });
  }
  return { hours, sources };
}

async function archivedForecastHours({
  from,
  until,
  root,
  fetchJson,
  progress = () => {},
  model = 'gfs_global',
}) {
  checkPeriod(from, until);
  if (!['gfs_global', 'jma_gsm'].includes(model)) throw new Error('Unsupported archive model.');
  if (model === 'gfs_global' && from < '2021-04-01')
    throw new Error('GFS fixed-lead archive requires dates from April 2021.');
  const hours = [];
  const sources = [];
  // Bounded requests and stable model selection; never silently substitute Day 0.
  for (let start = from; start <= until; start = shiftDate(start, 90)) {
    const end = [shiftDate(start, 89), until].sort()[0];
    const query = {
      latitude: LOCATION.latitude,
      longitude: LOCATION.longitude,
      start_date: start,
      // One look-ahead hour is needed for preceding-hour radiation at the chunk edge.
      end_date: shiftDate(end, 1),
      hourly: 'temperature_2m_previous_day3,shortwave_radiation_previous_day3',
      models: model,
      timezone: 'UTC',
      timeformat: 'unixtime',
    };
    const file = path.join(root, 'raw', `${digest(['open_meteo_previous_runs', query])}.json`);
    let raw;
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      const url = `https://previous-runs-api.open-meteo.com/v1/forecast?${new URLSearchParams(query)}`;
      const data = fetchJson
        ? await fetchJson(url)
        : await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' }).then(
            async (r) => {
              if (!r.ok) throw new Error(`Weather archive HTTP ${r.status}.`);
              return r.json();
            }
          );
      if (
        data.hourly_units?.temperature_2m_previous_day3 !== '°C' ||
        !Array.isArray(data.hourly?.time)
      )
        throw new Error('Weather archive response lacks Celsius fixed-lead temperatures.');
      raw = { fetched_at: new Date().toISOString(), data };
      atomicJson(file, raw);
    }
    const h = raw.data.hourly;
    let count = 0;
    h.time.forEach((value, i) => {
      const ms = value * 1000;
      const temperature = h.temperature_2m_previous_day3?.[i];
      if (!Number.isFinite(ms) || ms % HOUR || !Number.isFinite(temperature)) return;
      if (ms < Date.parse(start) || ms >= Date.parse(shiftDate(end, 1))) return;
      const radiation =
        h.time[i + 1] * 1000 === ms + HOUR
          ? h.shortwave_radiation_previous_day3?.[i + 1]
          : undefined;
      hours.push({
        ms,
        temperature,
        forecast_source: `open_meteo_${model}_previous_day3`,
        ...(Number.isFinite(radiation) ? { global_radiation: radiation } : {}),
        issued: ms + HOUR - 72 * HOUR,
        known: ms + HOUR - 48 * HOUR,
      });
      count++;
    });
    sources.push({
      from: start,
      until: end,
      fetched_at: raw.fetched_at,
      sha256: digest(raw),
      hours: count,
      model,
    });
    progress({
      provider: `open_meteo_${model}_previous_day3`,
      from: start,
      until: end,
      hours: count,
    });
  }
  return { hours, sources };
}

// Prefer a fixed primary model; replacements depend on availability, never observed skill.
async function completeArchivedForecastHours(options) {
  const primary = await archivedForecastHours(options);
  const rows = new Map(primary.hours.map((row) => [row.ms, row]));
  const missingDates = new Set();
  for (
    let ms = Date.parse(options.from);
    ms < Date.parse(shiftDate(options.until, 1));
    ms += HOUR
  ) {
    if (!rows.has(ms)) missingDates.add(new Date(ms).toISOString().slice(0, 10));
  }
  const ranges = [];
  for (const date of missingDates) {
    const last = ranges[ranges.length - 1];
    if (last && shiftDate(last.until, 1) === date) last.until = date;
    else ranges.push({ from: date, until: date });
  }
  const errors = [];
  for (const range of ranges) {
    try {
      const fallback = await archivedForecastHours({ ...options, ...range, model: 'jma_gsm' });
      for (const row of fallback.hours) if (!rows.has(row.ms)) rows.set(row.ms, row);
      primary.sources.push(
        ...fallback.sources.map((source) => ({ ...source, role: 'missing_temperature_fallback' }))
      );
    } catch (error) {
      // A secondary provider failure must not discard valid primary forecasts.
      errors.push({ ...range, model: 'jma_gsm', error: error.message });
    }
  }
  return {
    hours: [...rows.values()].sort((a, b) => a.ms - b.ms),
    sources: primary.sources,
    fallback_errors: errors,
  };
}

function weatherCoverage(values, from, until) {
  const time = clock(LOCATION.timezone);
  const rows = new Map(values.map((row) => [Date.parse(row.timestamp), row]));
  const years = {};
  const missingDays = [];
  const sources = {};
  for (let date = from; date <= until; date = shiftDate(date, 1)) {
    const year = date.slice(0, 4);
    const counts = (years[year] ||= {
      expected_intervals: 0,
      temperature: 0,
      heating_degree_days_18: 0,
      global_radiation: 0,
    });
    let missing = 0;
    for (let ms = time.midnight(date); ms < time.midnight(shiftDate(date, 1)); ms += STEP) {
      counts.expected_intervals++;
      const row = rows.get(ms);
      for (const feature of ['temperature', 'heating_degree_days_18', 'global_radiation']) {
        if (Number.isFinite(row?.[feature])) counts[feature]++;
      }
      if (!Number.isFinite(row?.temperature)) missing++;
      if (row?.forecast_source)
        sources[row.forecast_source] = (sources[row.forecast_source] || 0) + 1;
    }
    if (missing) missingDays.push({ date, missing_temperature_intervals: missing });
  }
  return { from, until, years, missing_temperature_days: missingDays, source_intervals: sources };
}

function quarterHours(hours, kind, from, until) {
  const time = clock(LOCATION.timezone);
  const unique = new Map();
  const ambiguous = new Set();
  for (const hour of hours) {
    if (
      unique.has(hour.ms) &&
      (unique.get(hour.ms).temperature !== hour.temperature ||
        unique.get(hour.ms).global_radiation !== hour.global_radiation)
    )
      ambiguous.add(hour.ms);
    unique.set(hour.ms, hour);
  }
  for (const ms of ambiguous) unique.delete(ms);
  const days = new Map();
  for (const hour of unique.values()) {
    const date = time.parts(hour.ms).date;
    if (date < from || date > until) continue;
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(hour);
  }
  const values = [];
  let incompleteDays = 0;
  for (const [date, list] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const expected = (time.midnight(shiftDate(date, 1)) - time.midnight(date)) / HOUR;
    const complete = list.length === expected;
    if (!complete) incompleteDays++;
    const heating = complete
      ? Math.max(0, 18 - list.reduce((s, r) => s + r.temperature, 0) / list.length)
      : undefined;
    const known = Math.max(...list.map((r) => r.known));
    const issued = kind === 'forecasts' ? Math.max(...list.map((r) => r.issued)) : undefined;
    for (const hour of list.sort((a, b) => a.ms - b.ms)) {
      for (let quarter = 0; quarter < 4; quarter++)
        values.push({
          timestamp: new Date(hour.ms + quarter * STEP).toISOString(),
          temperature: hour.temperature,
          ...(hour.forecast_source ? { forecast_source: hour.forecast_source } : {}),
          ...(Number.isFinite(hour.global_radiation)
            ? { global_radiation: hour.global_radiation }
            : {}),
          ...(complete ? { heating_degree_days_18: heating } : {}),
          available_at: new Date(complete ? known : hour.known).toISOString(),
          ...(kind === 'forecasts'
            ? { issued_at: new Date(complete ? issued : hour.issued).toISOString() }
            : {}),
        });
    }
  }
  return { values, incomplete_days: incompleteDays, ambiguous_hours_omitted: ambiguous.size };
}

async function prepareWeatherDataset(
  params,
  { token, root = path.resolve('data/forecast-weather'), call, fetchJson, progress } = {}
) {
  if ((params.location || 'kempten').toLowerCase() !== 'kempten')
    throw new Error('This weather connector currently supports Kempten (Allgäu).');
  checkPeriod(params.history_from, params.history_until);
  checkPeriod(params.forecast_from, params.forecast_until);
  const time = clock(LOCATION.timezone);
  if (params.forecast_until >= time.parts(Date.now()).date)
    throw new Error(
      'Historical weather preparation requires past target dates; live forecast preparation is separate.'
    );
  const history = await cernionHours({
    from: params.history_from,
    until: params.history_until,
    token,
    root,
    call,
    progress,
  });
  // Include inner relationship discovery and state confirmation, plus UTC boundary hours.
  const forecastFrom = shiftDate(params.forecast_from, -126);
  const archive = await completeArchivedForecastHours({
    from: shiftDate(forecastFrom, -1),
    until: shiftDate(params.forecast_until, 1),
    root,
    fetchJson,
    progress,
  });
  const observations = quarterHours(
    history.hours,
    'observations',
    params.history_from,
    params.history_until
  );
  const forecasts = quarterHours(archive.hours, 'forecasts', forecastFrom, params.forecast_until);
  const weather = {
    source:
      'Cernion/Visual Crossing observations + Open-Meteo GFS previous_day3 forecasts; JMA GSM for missing GFS temperatures',
    version: VERSION,
    region: LOCATION.id,
    location: LOCATION,
    native_resolution: 'PT1H',
    radiation_alignment:
      'Open-Meteo preceding-hour mean shifted to interval start; missing radiation remains missing.',
    mapped_resolution: 'PT15M',
    resampling:
      'hourly value held for four physical quarter-hours; no synthetic sub-hour weather variation',
    heating_degree_days: {
      base_celsius: 18,
      method: 'max(0,18-local_day_mean_temperature)',
      unit: 'K.d per local day',
    },
    availability_policy: {
      observations:
        'Retrospective assumption: hour end + 24h; daily HDD uses the latest contributing hour availability.',
      forecasts:
        'Archived 72h fixed-lead forecast; issued_at is an upper bound derived from valid time, not an exact run timestamp. available_at adds a conservative 24h publication buffer.',
      publication_timestamps_verified: false,
      forecast_origin: 'Configured D-1 issue time; forecast availability must not exceed origin',
    },
    observations: observations.values,
    forecasts: forecasts.values,
    provenance: {
      history: history.sources,
      archive: archive.sources,
      fallback_errors: archive.fallback_errors,
    },
    coverage: {
      observation_intervals: observations.values.length,
      forecast_intervals: forecasts.values.length,
      incomplete_observation_days: observations.incomplete_days,
      ambiguous_observation_hours_omitted: observations.ambiguous_hours_omitted,
      incomplete_forecast_days: forecasts.incomplete_days,
      forecast_detail: weatherCoverage(forecasts.values, forecastFrom, params.forecast_until),
    },
  };
  const id = digest(weather);
  atomicJson(path.join(root, 'datasets', `${id}.json`), weather);
  return { weather_dataset_id: id, ...weatherMetadata(weather) };
}

function weatherMetadata(weather) {
  return Object.fromEntries(
    Object.entries(weather).filter(
      ([k]) => !['observations', 'forecasts', 'provenance'].includes(k)
    )
  );
}
function loadWeatherDataset(id, root = path.resolve('data/forecast-weather')) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid weather_dataset_id.');
  const weather = JSON.parse(fs.readFileSync(path.join(root, 'datasets', `${id}.json`), 'utf8'));
  if (digest(weather) !== id) throw new Error('Weather dataset integrity mismatch.');
  return weather;
}

module.exports = {
  LOCATION,
  VERSION,
  cernionHours,
  archivedForecastHours,
  completeArchivedForecastHours,
  weatherCoverage,
  quarterHours,
  prepareWeatherDataset,
  loadWeatherDataset,
  weatherMetadata,
};
