'use strict';

const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const {
  clock,
  STEP,
  shiftDate,
  dateOnly,
  instant,
  forecastOrigin,
} = require('./forecast-evaluation-time');
const { CONTEXT_FIELDS } = require('./forecast-relationship-model');
const ROOT = path.resolve('data/forecast-context');
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.partial`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
async function smardSeries(filter, area, resolution, from, until, { root, fetchJson }) {
  const base = `https://www.smard.de/app/chart_data/${filter}/${area}`;
  const get = async (url) => {
    const file = path.join(root, 'raw', `${hash(url)}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    const data = await fetchJson(url);
    const raw = { fetched_at: new Date().toISOString(), data };
    write(file, raw);
    return raw;
  };
  const index = await get(`${base}/index_${resolution}.json`);
  const timestamps = index.data.timestamps.filter(
    (t, i, a) => t < until && (a[i + 1] === undefined || a[i + 1] > from)
  );
  const values = new Map();
  const provenance = [];
  for (const timestamp of timestamps) {
    const raw = await get(`${base}/${filter}_${area}_${resolution}_${timestamp}.json`);
    if (!Array.isArray(raw.data.series)) throw new Error('Invalid SMARD time series.');
    for (const [ms, value] of raw.data.series) {
      if (ms >= from && ms < until && Number.isFinite(value)) values.set(ms, value);
    }
    provenance.push({
      timestamp,
      sha256: hash(raw),
      fetched_at: raw.fetched_at,
      metadata: raw.data.meta_data,
    });
  }
  return { values, provenance };
}
async function prepareContextDataset(
  params,
  {
    root = ROOT,
    fetchJson = async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error(`SMARD HTTP ${response.status}`);
      return response.json();
    },
  } = {}
) {
  const { from, until } = params;
  if (
    !dateOnly(from) ||
    !dateOnly(until) ||
    from > until ||
    from < '2020-01-01' ||
    Date.parse(until) - Date.parse(from) > 7 * 366 * 86400000
  )
    throw new Error('Context requires ordered dates from 2020, at most seven years.');
  const time = clock('Europe/Berlin');
  if (until >= time.parts(Date.now()).date)
    throw new Error('Historical SMARD preparation requires past dates.');
  const start = time.midnight(shiftDate(from, -2));
  const end = time.midnight(shiftDate(until, 1));
  const load = await smardSeries(410, 'DE', 'quarterhour', start, end, { root, fetchJson });
  const price = await smardSeries(4169, 'DE-LU', 'hour', start, end, { root, fetchJson });
  const rows = [];
  for (let date = from; date <= until; date = shiftDate(date, 1)) {
    const lagDate = shiftDate(date, -2);
    const lagStart = time.midnight(lagDate);
    const lagEnd = time.midnight(shiftDate(lagDate, 1));
    let total = 0;
    let count = 0;
    for (let ms = lagStart; ms < lagEnd; ms += STEP) {
      if (load.values.has(ms)) {
        total += load.values.get(ms);
        count++;
      }
    }
    // SMARD 410 is MWh/quarter; aggregate physical duration, including DST.
    const meanMW =
      count === (lagEnd - lagStart) / STEP ? total / ((lagEnd - lagStart) / 3600000) : undefined;
    for (let ms = time.midnight(date); ms < time.midnight(shiftDate(date, 1)); ms += STEP) {
      if (Number.isFinite(meanMW))
        rows.push({
          timestamp: new Date(ms).toISOString(),
          grid_load_lag2: meanMW,
          available_at: new Date(lagEnd + 6 * 3600000).toISOString(),
          source_period_until: new Date(lagEnd).toISOString(),
        });
      const value = price.values.get(Math.floor(ms / 3600000) * 3600000);
      if (Number.isFinite(value))
        rows.push({
          timestamp: new Date(ms).toISOString(),
          day_ahead_price: value,
          available_at: new Date(forecastOrigin(time, date, { issue_time: '18:00' })).toISOString(),
        });
    }
  }
  const context = {
    source: 'Bundesnetzagentur SMARD',
    version: 'smard-context-v1',
    region: 'DE / DE-LU',
    units: { grid_load_lag2: 'MW (daily mean D-2)', day_ahead_price: 'EUR/MWh' },
    availability_policy: {
      publication_timestamps_verified: false,
      vintage: 'Retrospective final exports; revisions may postdate historical origin.',
      grid_load_lag2: 'Assumed available six hours after the complete D-2 day.',
      day_ahead_price: 'Assumed available at 18:00 D-1. No verified historical release times.',
    },
    rows,
    provenance: { load: load.provenance, price: price.provenance },
    coverage: { context_rows: rows.length },
  };
  const id = hash(context);
  write(path.join(root, 'datasets', `${id}.json`), context);
  return { context_dataset_id: id, ...contextMetadata(context) };
}
function contextMetadata(context) {
  return Object.fromEntries(
    Object.entries(context).filter(([key]) => !['rows', 'provenance'].includes(key))
  );
}
function loadContextDataset(id, root = ROOT) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid context_dataset_id.');
  const value = JSON.parse(fs.readFileSync(path.join(root, 'datasets', `${id}.json`), 'utf8'));
  if (hash(value) !== id) throw new Error('Context integrity mismatch.');
  return value;
}
function contextFeatures(context, enabled) {
  const values = new Map();
  if (enabled && context) {
    if (
      !context.source ||
      !context.version ||
      !context.region ||
      !Array.isArray(context.rows) ||
      context.rows.length > 600000
    )
      throw new Error('Context requires provenance and at most 600000 timestamped rows.');
    for (const row of context.rows) {
      const ms = instant(row.timestamp);
      const known = instant(row.available_at);
      if (
        !Number.isFinite(ms) ||
        ms % STEP ||
        !Number.isFinite(known) ||
        !CONTEXT_FIELDS.some((k) => Number.isFinite(row[k])) ||
        CONTEXT_FIELDS.some((k) => row[k] !== undefined && !Number.isFinite(row[k]))
      )
        throw new Error('Invalid context instant, availability or value.');
      if (
        row.grid_load_lag2 !== undefined &&
        (!Number.isFinite(instant(row.source_period_until)) ||
          instant(row.source_period_until) > known ||
          instant(row.source_period_until) > ms)
      )
        throw new Error(
          'Grid load requires a completed source period before availability and target.'
        );
      if (!values.has(ms)) values.set(ms, []);
      values.get(ms).push({ ...row, known });
    }
    for (const list of values.values()) list.sort((a, b) => b.known - a.known);
  }
  return {
    enabled: Boolean(enabled && context),
    source: enabled && context ? contextMetadata(context) : null,
    knownTimes: (ms) => (values.get(ms) || []).map((row) => row.known),
    at(ms, issue) {
      const result = {};
      for (const row of values.get(ms) || []) {
        if (row.known > issue) continue;
        for (const field of CONTEXT_FIELDS)
          if (result[field] === undefined && Number.isFinite(row[field]))
            result[field] = row[field];
      }
      return result;
    },
  };
}
module.exports = {
  prepareContextDataset,
  loadContextDataset,
  contextFeatures,
  contextMetadata,
  smardSeries,
};
