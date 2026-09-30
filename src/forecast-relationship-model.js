'use strict';

// Fixed-effect regression: quarter-hour/calendar profiles control for timing before
// weather coefficients are estimated from WITHIN-profile variation. No raw Pearson
// correlation is used as a reason to admit a predictor.
const {
  fitActivityModel,
  restoreActivityModel,
  VERSION: ACTIVITY_VERSION,
} = require('./forecast-activity-model');
const {
  fitLowLoadModel,
  restoreLowLoadModel,
  VERSION: LOW_LOAD_VERSION,
} = require('./forecast-low-load-model');
const GROUPS = {
  weekday: { kind: 'calendar' },
  weekend: { kind: 'calendar' },
  month: { kind: 'calendar' },
  season: { kind: 'calendar' },
  day_ahead_price: { kind: 'context', columns: ['day_ahead_price'] },
  grid_load_lag2: { kind: 'context', columns: ['grid_load_lag2'] },
  heating_degree_days_18: { kind: 'weather', columns: ['heating_degree_days_18'] },
  holiday: { kind: 'calendar' },
  bridge_day: { kind: 'calendar' },
  school_holiday: { kind: 'calendar' },
  special_day: { kind: 'calendar' },
  temperature: {
    kind: 'weather',
    columns: ['temperature', 'heating_degree_18', 'cooling_degree_22'],
  },
  humidity: { kind: 'weather', columns: ['humidity'] },
  wind_speed: { kind: 'weather', columns: ['wind_speed'] },
  global_radiation: { kind: 'weather', columns: ['global_radiation'] },
  cloud_cover: { kind: 'weather', columns: ['cloud_cover'] },
  precipitation: { kind: 'weather', columns: ['precipitation'] },
};
const WEATHER_FIELDS = Object.keys(GROUPS).filter((key) => GROUPS[key].kind === 'weather');

function vector(observation, columns) {
  return columns.map((column) => {
    const temperature = observation.weather?.temperature;
    if (column === 'heating_degree_18')
      return Number.isFinite(temperature) ? Math.max(0, 18 - temperature) : undefined;
    if (column === 'cooling_degree_22')
      return Number.isFinite(temperature) ? Math.max(0, temperature - 22) : undefined;
    return observation.weather?.[column] ?? observation.context?.[column];
  });
}

function keyFunction(groups) {
  const calendar = groups.filter((g) => GROUPS[g].kind === 'calendar');
  if (!calendar.length) {
    const keys = new Map();
    return (row) => {
      if (!keys.has(row.slot)) keys.set(row.slot, JSON.stringify([row.slot]));
      return keys.get(row.slot);
    };
  }
  return (row) => JSON.stringify([row.slot, ...calendar.map((g) => row.calendar[g])]);
}

function emptyStats(p) {
  return {
    n: 0,
    sum: 0,
    complete: 0,
    y: 0,
    x: new Float64Array(p),
    xy: new Float64Array(p),
    xx: new Float64Array(p * p),
  };
}

function add(stats, y, x, complete) {
  stats.n++;
  stats.sum += y;
  if (!complete) return;
  stats.complete++;
  stats.y += y;
  for (let i = 0; i < x.length; i++) {
    stats.x[i] += x[i];
    stats.xy[i] += x[i] * y;
    for (let j = 0; j <= i; j++) stats.xx[i * x.length + j] += x[i] * x[j];
  }
}

function solveRidge(matrix, rhs, p) {
  if (!p) return [];
  const scales = Array.from({ length: p }, (_, i) => Math.sqrt(Math.max(0, matrix[i * p + i])));
  const augmented = Array.from({ length: p }, (_, i) => {
    const row = Array.from({ length: p }, (_, j) =>
      scales[i] > 1e-8 && scales[j] > 1e-8 ? matrix[i * p + j] / (scales[i] * scales[j]) : 0
    );
    row[i] += 0.001;
    row.push(scales[i] > 1e-8 ? rhs[i] / scales[i] : 0);
    return row;
  });
  for (let i = 0; i < p; i++) {
    let pivot = i;
    for (let j = i + 1; j < p; j++)
      if (Math.abs(augmented[j][i]) > Math.abs(augmented[pivot][i])) pivot = j;
    [augmented[i], augmented[pivot]] = [augmented[pivot], augmented[i]];
    const divisor = augmented[i][i];
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) return Array(p).fill(0);
    for (let j = i; j <= p; j++) augmented[i][j] /= divisor;
    for (let k = 0; k < p; k++) {
      if (k === i) continue;
      const factor = augmented[k][i];
      for (let j = i; j <= p; j++) augmented[k][j] -= factor * augmented[i][j];
    }
  }
  return scales.map((scale, i) => (scale > 1e-8 ? augmented[i][p] / scale : 0));
}

function fitModel(observations, spec) {
  if (spec.family === LOW_LOAD_VERSION) return fitLowLoadModel(observations, spec);
  if (spec.family === ACTIVITY_VERSION) return fitActivityModel(observations, spec);
  const groups = spec.groups;
  const columns = groups.flatMap((g) => GROUPS[g].columns || []);
  const p = columns.length;
  const groupKey = keyFunction(groups);
  const emptyVector = [];
  const buckets = new Map();
  const slots = new Map();
  let completeCount = 0;
  for (const row of observations) {
    const key = groupKey(row);
    if (!buckets.has(key)) buckets.set(key, emptyStats(p));
    if (!slots.has(row.slot)) slots.set(row.slot, emptyStats(p));
    const x = p ? vector(row, columns) : emptyVector;
    const complete = x.every(Number.isFinite);
    if (complete) completeCount++;
    add(buckets.get(key), row.value, x, complete);
    add(slots.get(row.slot), row.value, x, complete);
  }
  const xx = new Float64Array(p * p);
  const xy = new Float64Array(p);
  for (const stats of buckets.values()) {
    if (stats.complete < 3) continue;
    for (let i = 0; i < p; i++) {
      xy[i] += stats.xy[i] - (stats.x[i] * stats.y) / stats.complete;
      for (let j = 0; j <= i; j++) {
        const centered = stats.xx[i * p + j] - (stats.x[i] * stats.x[j]) / stats.complete;
        xx[i * p + j] += centered;
        if (i !== j) xx[j * p + i] += centered;
      }
    }
  }
  const coefficients = solveRidge(xx, xy, p);
  const identifiable = columns.filter((_, i) => xx[i * p + i] > 1e-8);
  const snapshot = {
    spec,
    columns,
    coefficients,
    identifiable,
    buckets: [...buckets].map(([k, v]) => [k, { ...v, x: [...v.x], xy: [], xx: [] }]),
    slots: [...slots].map(([k, v]) => [k, { ...v, x: [...v.x], xy: [], xx: [] }]),
  };
  return {
    snapshot,
    spec,
    sample_count: observations.length,
    weather_coverage: observations.length ? completeCount / observations.length : 0,
    coefficients: Object.fromEntries(columns.map((name, i) => [name, coefficients[i]])),
    identifiable_columns: identifiable,
    // Calendar-only snapshots support exact persisted inference without observations.
    calendar_snapshot:
      p === 0
        ? {
            spec,
            buckets: [...buckets].map(([key, s]) => [key, { n: s.n, sum: s.sum }]),
            slots: [...slots].map(([key, s]) => [key, { n: s.n, sum: s.sum }]),
          }
        : null,
    predict: restoreModel(snapshot).predict,
  };
}

function restoreModel(snapshot) {
  if (snapshot.kind === LOW_LOAD_VERSION) return restoreLowLoadModel(snapshot);
  if (snapshot.kind === ACTIVITY_VERSION) return restoreActivityModel(snapshot);
  const { spec, columns, coefficients, identifiable } = snapshot;
  const groups = spec.groups;
  const groupKey = keyFunction(groups);
  const buckets = new Map(snapshot.buckets);
  const slots = new Map(snapshot.slots);
  return {
    spec,
    predict(row) {
      const exact = buckets.get(groupKey(row));
      const stats = exact?.n >= 3 ? exact : slots.get(row.slot);
      if (!stats?.n) return { value: null, used_groups: [], fallback: true };
      const calendar = exact?.n >= 3 ? groups.filter((g) => GROUPS[g].kind === 'calendar') : [];
      const x = vector(row, columns);
      const continuous =
        columns.length > 0 &&
        stats.complete >= 14 &&
        identifiable.length > 0 &&
        x.every(Number.isFinite);
      let value = stats.sum / stats.n;
      if (continuous) {
        value = stats.y / stats.complete;
        for (let i = 0; i < columns.length; i++)
          value += coefficients[i] * (x[i] - stats.x[i] / stats.complete);
      }
      return {
        value: Number.isFinite(value) ? value : null,
        used_groups: [
          ...calendar,
          ...(continuous ? groups.filter((g) => GROUPS[g].kind !== 'calendar') : []),
        ],
        fallback:
          calendar.length < groups.filter((g) => GROUPS[g].kind === 'calendar').length ||
          (columns.length > 0 && !continuous),
      };
    },
  };
}
const CONTEXT_FIELDS = Object.keys(GROUPS).filter((k) => GROUPS[k].kind === 'context');
module.exports = { fitModel, restoreModel, GROUPS, WEATHER_FIELDS, CONTEXT_FIELDS };
