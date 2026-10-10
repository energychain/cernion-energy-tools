'use strict';

const { createContextSelector, VERSION: CONTEXT_VERSION } = require('./forecast-context-selection');
const { interpretFeatures } = require('./forecast-feature-interpretation');
const { EXTENDED_VERSION, ADAPTIVE_VERSION } = require('./forecast-hybrid-state-model');
const { forecastOrigin } = require('./forecast-evaluation-time');
const { loadWeatherDataset, weatherMetadata } = require('./forecast-weather-provider');
const { contextFeatures, loadContextDataset } = require('./forecast-context-provider');
const { randomUUID } = require('crypto');
const { STEP, dateOnly, shiftDate, instant, clock } = require('./forecast-evaluation-time');
const { diagnosePatterns } = require('./forecast-evaluation-diagnostics');
const { VERSION: RELATIONSHIP_VERSION } = require('./forecast-relationship-selection');
const { dailyHistory } = require('./forecast-state-model');
const {
  createHybridStateSelector,
  VERSION: STATE_VERSION,
} = require('./forecast-hybrid-state-model');
const { WEATHER_FIELDS, GROUPS } = require('./forecast-relationship-model');

const { thresholdInUnit, thresholdPrediction } = require('./forecast-prediction-threshold');

const MODEL = 'expanding_profile_temperature_v1';
const PROXY_NOTE =
  'Die AE-/Kostenbewertung ist ein Proxy und keine Abrechnungs-, Beschaffungs- oder Handelsentscheidung.';
const BOUNDARY = Object.freeze({
  period: '2020-2025',
  granularity: 'PT15M',
  futureLeakageAllowed: false,
  personalDataRequired: false,
  productionUse: false,
  slaIncluded: false,
  forecastQualityGuarantee: false,
  commercialCommitment: false,
});

class EvaluationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function requireCondition(condition, code, message, details) {
  if (!condition) throw new EvaluationError(code, message, details);
}

function prepareDataset(dataset, { live = false } = {}) {
  requireCondition(
    dataset && typeof dataset.series_id === 'string' && dataset.series_id.trim(),
    'validation_failed',
    'A pseudonymous series_id is required.'
  );
  requireCondition(
    ['kW', 'kWh'].includes(dataset.unit),
    'validation_failed',
    'unit must be kW or kWh.'
  );
  requireCondition(
    typeof dataset.timezone === 'string' && dataset.timezone.length > 0,
    'validation_failed',
    'An explicit IANA timezone is required.'
  );
  let time;
  try {
    time = clock(dataset.timezone);
  } catch {
    throw new EvaluationError('validation_failed', 'Invalid IANA timezone.', {
      timezone_status: 'fail',
    });
  }
  requireCondition(
    Array.isArray(dataset.values) && dataset.values.length > 0 && dataset.values.length <= 220000,
    'validation_failed',
    'values must contain 1–220000 intervals per series.'
  );
  const mapping = { timestamp: 'timestamp', value: 'value', ...dataset.field_mapping };
  const rows = [];
  const seen = new Set();
  const counts = {
    invalid_values: 0,
    invalid_timestamps: 0,
    duplicate_intervals: 0,
    negative_value_count: 0,
    off_grid_intervals: 0,
    inconsistent_metadata: 0,
    flagged_values: 0,
  };
  for (const raw of dataset.values) {
    if (!raw || typeof raw !== 'object') {
      counts.invalid_values++;
      continue;
    }
    const ms = instant(raw[mapping.timestamp]);
    if (!Number.isFinite(ms)) {
      counts.invalid_timestamps++;
      continue;
    }
    if (
      (raw.unit && raw.unit !== dataset.unit) ||
      (raw.timezone && raw.timezone !== dataset.timezone) ||
      (raw.series_id && raw.series_id !== dataset.series_id)
    )
      counts.inconsistent_metadata++;
    if (seen.has(ms)) {
      counts.duplicate_intervals++;
      continue;
    }
    seen.add(ms);
    const local = time.parts(ms);
    if (ms % STEP !== 0 || Number(local.slot.slice(3)) % 15 !== 0) counts.off_grid_intervals++;
    if (local.date < '2020-01-01' || (!live && local.date > '2025-12-31'))
      counts.inconsistent_metadata++;
    const value = raw[mapping.value];
    if (typeof value !== 'number' || !Number.isFinite(value) || raw.quality_flag === 'missing') {
      counts.invalid_values++;
      continue;
    }
    if (value < 0) counts.negative_value_count++;
    if (raw.quality_flag && raw.quality_flag !== 'measured' && raw.quality_flag !== 'plausible')
      counts.flagged_values++;
    const available = raw.available_at === undefined ? null : instant(raw.available_at);
    if (available !== null && !Number.isFinite(available)) {
      counts.invalid_timestamps++;
      continue;
    }
    rows.push({ ms, value, ...local, available });
  }
  rows.sort((a, b) => a.ms - b.ms);
  const from = dataset.period_from || '2020-01-01';
  const until = dataset.period_until || '2025-12-31';
  requireCondition(
    dateOnly(from) &&
      dateOnly(until) &&
      from <= until &&
      from >= '2020-01-01' &&
      (live || until <= '2025-12-31'),
    'validation_failed',
    'Dataset period must be an ordered range within 2020–2025.'
  );
  const start = time.midnight(from);
  const end = time.midnight(shiftDate(until, 1));
  const covered = rows.filter((r) => r.ms >= start && r.ms < end);
  if (covered.length !== rows.length) counts.inconsistent_metadata++;
  const expected = Math.round((end - start) / STEP);
  const missing = Math.max(0, expected - covered.length);
  let longestGap = 0;
  let previous = start - STEP;
  for (const row of covered) {
    longestGap = Math.max(longestGap, (row.ms - previous) / STEP - 1);
    previous = row.ms;
  }
  longestGap = Math.max(longestGap, (end - previous) / STEP - 1);
  const mean = rows.reduce((s, r) => s + r.value, 0) / (rows.length || 1);
  const std = Math.sqrt(rows.reduce((s, r) => s + (r.value - mean) ** 2, 0) / (rows.length || 1));
  const outliers = std ? rows.filter((r) => Math.abs(r.value - mean) > 5 * std).length : 0;
  const fatal =
    counts.invalid_timestamps +
    counts.duplicate_intervals +
    counts.off_grid_intervals +
    counts.inconsistent_metadata;
  const warnings = [];
  if (missing) warnings.push('missing_intervals');
  if (counts.invalid_values) warnings.push('missing_or_invalid_values_excluded');
  if (counts.negative_value_count) warnings.push('negative_values');
  if (counts.flagged_values) warnings.push('estimated_or_corrected_values');
  if (outliers) warnings.push('outliers');
  if (from !== '2020-01-01' || until !== '2025-12-31') warnings.push('partial_2020_2025_period');
  const validation = {
    series_id: dataset.series_id,
    validation_status: fatal || !rows.length ? 'fail' : warnings.length ? 'warning' : 'ok',
    interval_count: rows.length,
    expected_intervals: expected,
    missing_intervals: missing,
    ...counts,
    outlier_count: outliers,
    longest_gap_intervals: longestGap,
    timezone_status: 'ok',
    dst_status: counts.off_grid_intervals ? 'fail' : 'ok',
    readiness:
      fatal || rows.length < 1344 || missing / expected > 0.5
        ? 'low'
        : warnings.length
          ? 'medium'
          : 'high',
    detected_from: rows.length ? rows[0].date : null,
    detected_until: rows.length ? rows.at(-1).date : null,
    period_from: from,
    period_until: until,
    warnings,
  };
  return { dataset, rows, time, validation };
}

function datasetsOf(payload) {
  requireCondition(
    payload &&
      Array.isArray(payload.datasets) &&
      payload.datasets.length >= 1 &&
      payload.datasets.length <= 10,
    'validation_failed',
    'datasets must contain 1–10 pseudonymous series.'
  );
  requireCondition(
    new Set(payload.datasets.map((d) => d?.series_id)).size === payload.datasets.length,
    'validation_failed',
    'series_id must be unique within a request.'
  );
  requireCondition(
    payload.datasets.reduce((s, d) => s + (d?.values?.length || 0), 0) <= 1000000,
    'validation_failed',
    'At most 1000000 intervals per request.'
  );
  return payload.datasets.map((dataset) => prepareDataset(dataset));
}

function validateEvaluation(payload) {
  const prepared = datasetsOf(payload);
  return {
    status: prepared.some((p) => p.validation.validation_status === 'fail')
      ? 'validation_failed'
      : 'data_validated',
    validations: prepared.map((p) => p.validation),
    testcaseBoundary: BOUNDARY,
  };
}

function featureContext(config, dataset) {
  const selected = config.feature_set || ['history'];
  requireCondition(
    Array.isArray(selected) &&
      selected.includes('history') &&
      selected.every((f) => ['history', 'calendar', 'weather', 'context'].includes(f)),
    'validation_failed',
    'feature_set supports history, calendar and weather.'
  );
  const calendar = config.calendar;
  const weather = config.weather;
  let external;
  try {
    external = contextFeatures(config.context, selected.includes('context'));
  } catch (error) {
    throw new EvaluationError('validation_failed', error.message);
  }
  const calendarEnabled = selected.includes('calendar');
  const calendarFeatures = calendar?.features || ['weekday', 'holiday', 'special_day'];
  if (calendarEnabled) {
    requireCondition(
      calendar && calendar.source && calendar.version && calendar.country && calendar.region,
      'missing_calendar_data',
      'Calendar source, version, country and region are required.'
    );
    requireCondition(
      Array.isArray(calendar.days || []) &&
        Array.isArray(calendarFeatures) &&
        calendarFeatures.length > 0 &&
        calendarFeatures.every((f) =>
          [
            'weekday',
            'weekend',
            'holiday',
            'working_day',
            'month',
            'season',
            'calendar_week',
            'bridge_day',
            'school_holiday',
            'special_day',
          ].includes(f)
        ),
      'missing_calendar_data',
      'Invalid calendar days or feature selection.'
    );
  }
  const special = new Map();
  for (const row of calendarEnabled ? calendar.days || [] : []) {
    requireCondition(
      row && dateOnly(row.date) && !special.has(row.date),
      'missing_calendar_data',
      'Calendar days must have unique valid dates.'
    );
    requireCondition(
      row.known_at === undefined || Number.isFinite(instant(row.known_at)),
      'missing_calendar_data',
      'Invalid calendar known_at timestamp.'
    );
    requireCondition(
      ['holiday', 'bridge_day', 'school_holiday'].every(
        (k) => row[k] === undefined || typeof row[k] === 'boolean'
      ),
      'missing_calendar_data',
      'Calendar flags must be boolean.'
    );
    special.set(row.date, row);
  }
  const weatherEnabled = selected.includes('weather') && Boolean(weather);
  const observations = new Map();
  const forecasts = new Map();
  if (weatherEnabled) {
    requireCondition(
      weather.source &&
        weather.version &&
        weather.region &&
        dataset.weather_region === weather.region,
      'missing_weather_data',
      'Weather provenance and matching dataset.weather_region are required.'
    );
    for (const [kind, target] of [
      ['observations', observations],
      ['forecasts', forecasts],
    ]) {
      requireCondition(
        Array.isArray(weather[kind] || []) && (weather[kind] || []).length <= 500000,
        'missing_weather_data',
        'Weather arrays must contain at most 500000 entries.'
      );
      for (const row of weather[kind] || []) {
        requireCondition(
          row && typeof row === 'object',
          'missing_weather_data',
          'Weather entries must be objects.'
        );
        const ms = instant(row.timestamp);
        const known =
          kind === 'observations'
            ? instant(row.available_at)
            : Math.max(
                instant(row.issued_at),
                row.available_at === undefined ? -Infinity : instant(row.available_at)
              );
        requireCondition(
          Number.isFinite(ms) &&
            ms % STEP === 0 &&
            Number.isFinite(known) &&
            WEATHER_FIELDS.some((field) => Number.isFinite(row[field])) &&
            WEATHER_FIELDS.every(
              (field) => row[field] === undefined || Number.isFinite(row[field])
            ),
          'missing_weather_data',
          'Weather requires PT15M instants, numeric weather features and explicit availability/issue timestamps.'
        );
        if (!target.has(ms)) target.set(ms, []);
        target.get(ms).push({
          known,
          ...Object.fromEntries(
            WEATHER_FIELDS.filter((field) => row[field] !== undefined).map((field) => [
              field,
              row[field],
            ])
          ),
        });
      }
    }
    for (const map of [observations, forecasts]) {
      for (const entries of map.values()) entries.sort((a, b) => b.known - a.known);
    }
  }
  function temperature(map, ms, issue) {
    return map.get(ms)?.find((v) => v.known <= issue)?.temperature;
  }
  function weatherAt(map, ms, issue) {
    return map.get(ms)?.find((v) => v.known <= issue) || {};
  }
  function calendarAttributes(row, issue) {
    const day = special.get(row.date);
    const usable = day && (day.known_at === undefined || instant(day.known_at) <= issue);
    return {
      weekday: row.weekday,
      weekend: row.weekday === 0 || row.weekday === 6,
      month: Number(row.date.slice(5, 7)),
      season: Math.floor((Number(row.date.slice(5, 7)) % 12) / 3),
      holiday: Boolean(usable && day.holiday),
      bridge_day: Boolean(usable && day.bridge_day),
      school_holiday: Boolean(usable && day.school_holiday),
      special_day: usable ? day.special_day || '' : '',
    };
  }
  function bucket(row, issue) {
    if (!calendarEnabled) return row.slot;
    const day = special.get(row.date);
    const usable = day && (day.known_at === undefined || instant(day.known_at) <= issue);
    const holiday = Boolean(usable && day.holiday);
    const weekend = row.weekday === 0 || row.weekday === 6;
    const month = Number(row.date.slice(5, 7));
    const values = {
      weekday: row.weekday,
      weekend,
      holiday,
      working_day: !weekend && !holiday,
      month,
      season: Math.floor((month % 12) / 3),
      bridge_day: Boolean(usable && day.bridge_day),
      school_holiday: Boolean(usable && day.school_holiday),
      special_day: usable ? day.special_day || '' : '',
    };
    if (calendarFeatures.includes('calendar_week')) {
      const thursday = new Date(`${row.date}T00:00:00Z`);
      thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
      values.calendar_week = Math.ceil(
        ((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7
      );
    }
    // Holidays and configured special days supersede ordinary weekday matching.
    if (calendarFeatures.includes('holiday') && holiday) values.weekday = 'holiday';
    if (calendarFeatures.includes('special_day') && values.special_day) values.weekday = 'special';
    return `${JSON.stringify(calendarFeatures.map((f) => values[f]))}:${row.slot}`;
  }
  return {
    observationValidity(row, issue) {
      const known = [
        ...(observations.get(row.ms) || []).map((v) => v.known),
        ...external.knownTimes(row.ms),
      ];
      const day = special.get(row.date);
      if (day?.known_at !== undefined) known.push(instant(day.known_at));
      let lower = -Infinity;
      let upper = Infinity;
      for (const stamp of known) {
        if (stamp <= issue) lower = Math.max(lower, stamp);
        else upper = Math.min(upper, stamp);
      }
      return [lower, upper];
    },
    selected,
    contextEnabled: external.enabled,
    externalContext: external.at,
    calendarEnabled,
    weatherEnabled,
    bucket,
    calendarAttributes,
    historicalWeather: (ms, issue) => weatherAt(observations, ms, issue),
    forecastWeather: (ms, issue) => weatherAt(forecasts, ms, issue),
    historicalTemperature: (ms, issue) => temperature(observations, ms, issue),
    forecastTemperature: (ms, issue) => temperature(forecasts, ms, issue),
    sources: {
      context: external.source,
      calendar: calendarEnabled
        ? {
            source: calendar.source,
            version: calendar.version,
            country: calendar.country,
            region: calendar.region,
            features: calendarFeatures,
            holiday_policy: 'caller_supplied_dates',
          }
        : null,
      weather: weatherEnabled
        ? {
            ...weatherMetadata(weather),
            source: weather.source,
            version: weather.version,
            region: weather.region,
            features: WEATHER_FIELDS.filter((field) =>
              (weather.observations || []).some((row) => row[field] !== undefined)
            ),
          }
        : null,
    },
  };
}

function statistics() {
  return { n: 0, sum: 0, wn: 0, x: 0, y: 0, xx: 0, xy: 0 };
}
function addObservation(stats, value, temperature) {
  stats.n++;
  stats.sum += value;
  if (temperature === undefined) return;
  stats.wn++;
  stats.x += temperature;
  stats.y += value;
  stats.xx += temperature * temperature;
  stats.xy += temperature * value;
}
function prediction(stats, temperature) {
  const denominator = stats.wn * stats.xx - stats.x * stats.x;
  if (temperature !== undefined && stats.wn >= 14 && denominator > 1e-8) {
    const slope = (stats.wn * stats.xy - stats.x * stats.y) / denominator;
    return {
      value: stats.y / stats.wn + slope * (temperature - stats.x / stats.wn),
      weather: true,
    };
  }
  return { value: stats.sum / stats.n, weather: false };
}

function summarizeErrors(pairs, expected) {
  if (!pairs.length)
    return {
      sample_count: 0,
      missing_actuals: expected,
      mae: null,
      mse: null,
      rmse: null,
      mape: null,
      bias: null,
      max_error: null,
      cumulative_error: null,
      quality_rating: 'low',
      notes: ['missing_actuals'],
    };
  let absolute = 0;
  let square = 0;
  let signed = 0;
  let max = 0;
  let pct = 0;
  let pctN = 0;
  let scale = 0;
  for (const p of pairs) {
    const error = p.actual_value - p.predicted_value;
    absolute += Math.abs(error);
    square += error * error;
    signed += error;
    max = Math.max(max, Math.abs(error));
    scale += Math.abs(p.actual_value);
    if (p.actual_value !== 0) {
      pct += Math.abs(error / p.actual_value) * 100;
      pctN++;
    }
  }
  const n = pairs.length;
  const relative = scale ? absolute / scale : absolute === 0 ? 0 : Infinity;
  const notes = [];
  if (pctN !== n) notes.push('MAPE excludes zero actuals; null when all actuals are zero.');
  if (n < expected)
    notes.push('Metrics cover matched intervals only; missing actuals are not zero-filled.');
  return {
    sample_count: n,
    missing_actuals: expected - n,
    mae: absolute / n,
    mse: square / n,
    rmse: Math.sqrt(square / n),
    mape: pctN ? pct / pctN : null,
    bias: signed / n,
    max_error: max,
    cumulative_error: signed,
    quality_rating:
      n / expected < 0.9 ? 'low' : relative <= 0.1 ? 'high' : relative <= 0.3 ? 'medium' : 'low',
    rating_policy:
      'WAPE <=10% high, <=30% medium; <90% actual coverage low; evaluation heuristic only.',
    error_convention: 'actual_minus_forecast',
    notes,
  };
}

function deviationEnergy(pairs, unit) {
  const factor = unit === 'kW' ? 0.25 : 1;
  let positive = 0;
  let negative = 0;
  let maximum = 0;
  for (const p of pairs) {
    const e = (p.actual_value - p.predicted_value) * factor;
    positive += Math.max(0, e);
    negative += Math.min(0, e);
    maximum = Math.max(maximum, Math.abs(e));
  }
  return {
    unit: 'kWh',
    sample_count: pairs.length,
    positive_deviation: positive,
    negative_deviation: negative,
    absolute_deviation: positive - negative,
    cumulative_deviation: positive + negative,
    maximum_deviation: maximum,
    monetary_evaluation: null,
    proxy: true,
    note: PROXY_NOTE,
  };
}

function evaluateSeries(prepared, config, progress = () => {}) {
  const { dataset, rows, time, validation } = prepared;
  requireCondition(
    validation.validation_status !== 'fail',
    'validation_failed',
    'Dataset failed validation.',
    { validation }
  );
  const features = featureContext(config, dataset);
  const automatic = config.relationship_mode === 'auto';
  const stateMode = config.model_family === 'learned_states';
  requireCondition(
    !stateMode || !rows.some((r) => r.value < 0),
    'validation_failed',
    'State models require nonnegative consumption.'
  );
  const extended =
    config.extended_features ||
    features.weatherEnabled ||
    features.contextEnabled ||
    config.issue_time === '18:00';
  const modelVersion =
    config.selection_policy === 'adaptive_rmse_v1'
      ? ADAPTIVE_VERSION
      : stateMode
        ? extended
          ? EXTENDED_VERSION
          : STATE_VERSION
        : automatic
          ? extended
            ? CONTEXT_VERSION
            : RELATIONSHIP_VERSION
          : MODEL;
  const selector = stateMode
    ? createHybridStateSelector({ time, features, config })
    : automatic
      ? createContextSelector({ time, features, config })
      : null;
  const runId = randomUUID();
  const from = config.forecast_period_from;
  const until = config.forecast_period_until;
  const staticMode = config.mode === 'static_year_forecast';
  const staticIssue = time.midnight('2025-01-01');
  const historyStart = time.midnight(config.history_from || '2020-01-01');
  const availability = new Map();
  // Delayed measurements are ordered by knowledge time, not just event time.
  const training = rows
    .filter((r) => r.ms >= historyStart)
    .map((r) => {
      if (!availability.has(r.date)) availability.set(r.date, time.midnight(shiftDate(r.date, 1)));
      return { ...r, eligible: Math.max(availability.get(r.date), r.available ?? -Infinity) };
    })
    .sort((a, b) => a.eligible - b.eligible || a.ms - b.ms);
  const actuals = new Map(rows.map((r) => [r.ms, r.value]));
  const bySlot = new Map();
  const buckets = new Map();
  let pointer = 0;
  let trainingCount = 0;
  let trainingUntil = null;
  const values = [];
  const days = [];
  const matched = [];
  let weatherUsed = 0;
  let weatherFallback = 0;
  let calendarUsed = 0;
  let calendarFallback = 0;
  // Features with later availability require rebuilding eligible sufficient statistics.
  const dynamicFeatures =
    features.weatherEnabled ||
    (features.calendarEnabled && (config.calendar.days || []).some((d) => d.known_at));
  let includedRows = [];
  for (let day = from; day <= until; day = shiftDate(day, 1)) {
    const issue = staticMode ? staticIssue : forecastOrigin(time, day, config);
    const cutoff = staticMode ? staticIssue : time.midnight(shiftDate(day, -1));
    const newlyEligible = [];
    while (pointer < training.length && training[pointer].eligible <= issue) {
      const row = training[pointer++];
      if (row.ms >= cutoff) continue;
      newlyEligible.push(row);
      trainingCount++;
      trainingUntil = Math.max(trainingUntil ?? -Infinity, row.ms);
    }
    includedRows = includedRows.concat(newlyEligible);
    if (dynamicFeatures) {
      buckets.clear();
      bySlot.clear();
    }
    for (const row of automatic ? [] : dynamicFeatures ? includedRows : newlyEligible) {
      const key = features.bucket(row, issue);
      if (!buckets.has(key)) buckets.set(key, statistics());
      if (!bySlot.has(row.slot)) bySlot.set(row.slot, statistics());
      const temp = features.historicalTemperature(row.ms, issue);
      addObservation(buckets.get(key), row.value, temp);
      addObservation(bySlot.get(row.slot), row.value, temp);
    }
    requireCondition(
      trainingCount >= 1344 &&
        (automatic ? new Set(includedRows.map((r) => r.slot)).size === 96 : bySlot.size === 96),
      'insufficient_history',
      'At least 1344 eligible PT15M values covering all 96 local quarter-hours are required.',
      {
        forecast_for: day,
        training_intervals: trainingCount,
        cutoff_exclusive: new Date(cutoff).toISOString(),
      }
    );
    const start = time.midnight(day);
    const end = time.midnight(shiftDate(day, 1));
    if (stateMode && day === from)
      requireCondition(
        dailyHistory(includedRows, time).length >= 14,
        'insufficient_history',
        'At least 14 complete eligible days are required for state models.'
      );
    progress({
      phase: 'model_selection',
      forecast_for: day,
      completed_days: days.length,
      message: `Model selection / fit for ${day}`,
    });
    const learned = selector?.forDay(includedRows, issue, day);
    const dailyPairs = [];
    let dailyWeather = 0;
    for (let ms = start; ms < end; ms += STEP) {
      const local = time.parts(ms);
      const matchedBucket = buckets.get(features.bucket(local, issue));
      const autoPrediction = learned?.predict({ ms, ...local });
      const usesCalendar = automatic
        ? autoPrediction.used_groups.some((g) => GROUPS[g].kind === 'calendar')
        : features.calendarEnabled && Boolean(matchedBucket);
      if (usesCalendar) calendarUsed++;
      else if (
        features.calendarEnabled &&
        (!automatic || learned.model.spec.groups.some((g) => GROUPS[g].kind === 'calendar'))
      )
        calendarFallback++;
      const stats = matchedBucket || bySlot.get(local.slot);
      const forecast = automatic
        ? {
            value: autoPrediction.value,
            weather: autoPrediction.used_groups.some((g) => GROUPS[g].kind === 'weather'),
          }
        : prediction(stats, features.forecastTemperature(ms, issue));
      requireCondition(
        Number.isFinite(forecast.value),
        'forecast_failed',
        'Forecast produced a non-finite value.'
      );
      if (forecast.weather) {
        dailyWeather++;
        weatherUsed++;
      } else if (
        features.selected.includes('weather') &&
        (!automatic || learned.model.spec.groups.some((g) => GROUPS[g].kind === 'weather'))
      )
        weatherFallback++;
      const entry = {
        series_id: dataset.series_id,
        forecast_run_id: runId,
        forecast_created_at: new Date(issue).toISOString(),
        forecast_for: day,
        timestamp: new Date(ms).toISOString(),
        ...thresholdPrediction(forecast.value, dataset.unit, config.prediction_threshold_w),
        unit: dataset.unit,
        model_version: modelVersion,
        feature_set: [
          'history',
          ...(usesCalendar ? ['calendar'] : []),
          ...(forecast.weather ? ['weather'] : []),
          ...(autoPrediction?.used_groups.some((g) => GROUPS[g].kind === 'context')
            ? ['context']
            : []),
        ],
        training_data_until: learned?.training_data_until || new Date(trainingUntil).toISOString(),
        ...(automatic
          ? {
              relationship_selection_id: learned.report.selection_id,
              selected_predictors: autoPrediction.used_groups,
              profile_fallback: autoPrediction.fallback || learned.fitFallback,
            }
          : {}),
        ...(stateMode ? { state_features: autoPrediction.state } : {}),
        ...(autoPrediction?.activity ? { activity_model: autoPrediction.activity } : {}),
        actual_value: actuals.get(ms) ?? null,
        deviation: actuals.has(ms) ? actuals.get(ms) - forecast.value : null,
      };
      entry.deviation = actuals.has(ms) ? actuals.get(ms) - entry.predicted_value : null;
      values.push(entry);
      if (actuals.has(ms)) {
        dailyPairs.push(entry);
        matched.push(entry);
      }
    }
    days.push({
      forecast_for: day,
      forecast_created_at: new Date(issue).toISOString(),
      training_data_until: learned?.training_data_until || new Date(trainingUntil).toISOString(),
      training_cutoff_exclusive: new Date(cutoff).toISOString(),
      training_intervals: learned?.training_intervals || trainingCount,
      ...(automatic
        ? {
            relationship_selection_id: learned.report.selection_id,
            selected_predictors:
              stateMode && learned.report.state_features_enabled
                ? [...new Set([...learned.model.spec.groups, 'weekday'])]
                : learned.model.spec.groups,
            ...(stateMode
              ? {
                  reference_predictors: learned.model.spec.groups,
                  state_features_enabled: learned.report.state_features_enabled,
                }
              : {}),
            selected_history_window_days: learned.model.spec.window_days,
            weather_coefficients: learned.model.coefficients,
            predictor_coefficients: learned.model.coefficients,
            feature_interpretation: interpretFeatures(
              learned.model.spec.groups,
              learned.model.coefficients
            ),
            selection_fit_fallback: learned.fitFallback,
          }
        : {}),
      intervals: (end - start) / STEP,
      weather_intervals: dailyWeather,
      metrics: summarizeErrors(dailyPairs, (end - start) / STEP),
      deviation_energy: deviationEnergy(dailyPairs, dataset.unit),
    });
    progress({
      phase: 'forecast_day_completed',
      forecast_for: day,
      completed_days: days.length,
      message: `Forecast day ${day} completed`,
    });
  }
  const warnings = [...validation.warnings];
  if (
    [features.sources.weather, features.sources.context].some(
      (source) => source?.availability_policy?.publication_timestamps_verified === false
    )
  )
    warnings.push(
      'retrospective_feature_availability_assumptions: source publication times/revision vintages are not fully verified'
    );
  if (!weatherUsed)
    warnings.push(
      automatic && features.weatherEnabled
        ? 'weather_not_used: no validated and available weather contribution; see relationship_analysis'
        : 'missing_weather_data: forecast completed without weather features'
    );
  else if (weatherFallback)
    warnings.push(`missing_weather_data: ${weatherFallback} intervals used the profile fallback`);
  if (matched.length < values.length) warnings.push('missing_actuals');
  if (calendarFallback)
    warnings.push(
      `calendar_profile_fallback: ${calendarFallback} intervals had no matching calendar history`
    );
  const metrics = {
    series_id: dataset.series_id,
    forecast_run_id: runId,
    evaluation_period_from: from,
    evaluation_period_until: until,
    unit: dataset.unit,
    ...summarizeErrors(matched, values.length),
  };
  const stateHistory = [
    'draft',
    'data_uploaded',
    'data_validated',
    'payload_fit_confirmed',
    'forecast_configured',
    'forecast_running',
    'forecast_completed',
  ];
  if (matched.length) stateHistory.push('backtest_completed');
  stateHistory.push('readiness_dossier_created');
  const run = {
    forecast_run_id: runId,
    series_id: dataset.series_id,
    mode: config.mode,
    history_from: config.history_from || '2020-01-01',
    history_until: new Date(trainingUntil).toISOString(),
    forecast_period_from: from,
    forecast_period_until: until,
    uses_calendar_features: calendarUsed > 0,
    uses_weather_features: weatherUsed > 0,
    uses_context_features: values.some((v) => v.feature_set.includes('context')),
    issue_time: config.issue_time || '00:00',
    requested_feature_set: features.selected,
    prediction_threshold_w: config.prediction_threshold_w || 0,
    status: warnings.length ? 'completed_with_warnings' : 'completed',
    executed_at: new Date().toISOString(),
    model_version: modelVersion,
    relationship_mode: config.relationship_mode,
    model_family: config.model_family || 'relationship',
    timezone: dataset.timezone,
    weather_region: dataset.weather_region,
    availability_policy: staticMode
      ? 'frozen_at_2025_local_midnight'
      : `D-2 inclusive; issue at D-1 ${config.issue_time || '00:00'} local time`,
    feature_sources: features.sources,
    state_history: stateHistory,
  };
  const worstDays = days
    .filter((d) => d.metrics.sample_count)
    .slice()
    .sort((a, b) => b.metrics.mae - a.metrics.mae)
    .slice(0, 10)
    .map((d) => ({ date: d.forecast_for, mae: d.metrics.mae }));
  const energy = deviationEnergy(matched, dataset.unit);
  const filterEvaluation =
    config.prediction_threshold_w > 0
      ? {
          threshold_w: config.prediction_threshold_w,
          threshold_value: thresholdInUnit(config.prediction_threshold_w, dataset.unit),
          unit: dataset.unit,
          changed_intervals: values.filter((value) => value.prediction_zeroed).length,
          actuals_modified: false,
          raw_backtest: summarizeErrors(
            matched.map((value) => ({ ...value, predicted_value: value.raw_predicted_value })),
            values.length
          ),
          filtered_backtest: metrics,
        }
      : undefined;
  const diagnostics = diagnosePatterns(rows);
  return {
    ...(stateMode
      ? {
          state_model_snapshot: {
            ...selector.snapshot(),
            series_id: dataset.series_id,
            unit: dataset.unit,
            timezone: dataset.timezone,
            weather_region: dataset.weather_region,
          },
        }
      : {}),
    forecast_run: run,
    validation,
    forecast_values: values,
    daily_results: days,
    backtest: metrics,
    ...(filterEvaluation ? { filter_evaluation: filterEvaluation } : {}),
    deviation_energy: energy,
    worst_days: worstDays,
    diagnostics,
    relationship_analysis: automatic
      ? { version: modelVersion, causal_claim: false, selections: selector.reports }
      : null,
    readiness_dossier: {
      status: 'readiness_dossier_created',
      validation,
      configuration: run,
      diagnostics,
      relationship_analysis: automatic
        ? { version: modelVersion, causal_claim: false, selections: selector.reports }
        : null,
      worst_days: worstDays,
      forecast_summary: {
        interval_count: values.length,
        weather_intervals: weatherUsed,
        weather_fallback_intervals: weatherFallback,
      },
      backtest: metrics,
      ...(filterEvaluation ? { filter_evaluation: filterEvaluation } : {}),
      deviation_energy: energy,
      feature_sources: features.sources,
      warnings,
      limitations: [
        stateMode
          ? 'State correction augments automatic calendar/recency selection; enabled only after past-only RMSE and MAE validation. No external independent confirmation required; no quality guarantee.'
          : automatic
            ? 'Automatic predictive relationship selection with independent temporal confirmation; observational evidence does not establish causation.'
            : 'Deterministic expanding profile baseline; no guaranteed improvement or quality.',
        automatic
          ? 'Weather groups require archived forecasts during historical validation and target forecasting; coverage and conditional ablation gates apply.'
          : 'Manual weather model uses temperature only; archived forecasts with issued_at are required.',
        'Calendar holidays and special days are caller-supplied; no implicit holiday provider.',
        'Historical revisions require their actual available_at; final corrected exports alone cannot prove historical availability.',
        'Synchronous evaluation; state_history is an execution trace. State model snapshots are persisted by the API when requested through the learned_states family.',
        'Structural change, seasonality and holiday effects require expert review; readiness is a technical heuristic.',
      ],
      next_recommended_step:
        matched.length < values.length
          ? 'provide_missing_actuals_and_repeat_evaluation'
          : 'compare_static_and_rolling_errors_before_pilot',
      testcaseBoundary: BOUNDARY,
    },
  };
}

function runEvaluation(payload, progress = () => {}) {
  let config = resolveFeatureConfiguration(payload?.configuration);
  requireCondition(
    ['00:00', '07:00', '18:00'].includes(config?.issue_time || '00:00'),
    'validation_failed',
    'issue_time must be 00:00, 07:00 or 18:00.'
  );
  requireCondition(
    config && ['static_year_forecast', 'rolling_day_ahead'].includes(config.mode),
    'validation_failed',
    'Select static_year_forecast or rolling_day_ahead.'
  );
  requireCondition(
    config.model_family === undefined ||
      ['relationship', 'learned_states'].includes(config.model_family),
    'validation_failed',
    'Unknown model_family.'
  );
  requireCondition(
    config.model_family !== 'learned_states' ||
      (config.mode === 'rolling_day_ahead' &&
        (config.relationship_mode || 'auto') === 'auto' &&
        (!config.feature_set || config.feature_set.includes('calendar')) &&
        !config.calendar),
    'validation_failed',
    'learned_states requires rolling auto mode and built-in calendar; optional versioned weather/context features.'
  );
  const relationshipMode = config.relationship_mode || 'auto';
  requireCondition(
    ['auto', 'manual'].includes(relationshipMode),
    'validation_failed',
    'relationship_mode must be auto or manual.'
  );
  config = { ...config, relationship_mode: relationshipMode };
  requireCondition(
    config.selection_metric === undefined || ['mae', 'rmse'].includes(config.selection_metric),
    'validation_failed',
    'selection_metric must be mae or rmse.'
  );
  requireCondition(
    config.recent_window_days === undefined || [28, 84].includes(config.recent_window_days),
    'validation_failed',
    'recent_window_days must be 28 or 84; full eligible history remains the reference.'
  );
  if (relationshipMode === 'auto') {
    config.feature_set = config.feature_set || [
      'history',
      'calendar',
      ...(config.weather ? ['weather'] : []),
      ...(config.context ? ['context'] : []),
    ];
    if (config.feature_set.includes('calendar') && !config.calendar)
      config.calendar = {
        source: 'IANA-local-Gregorian-calendar',
        version: 'derived-calendar-v1',
        country: 'unspecified',
        region: 'unspecified',
        features: ['weekday', 'weekend', 'month', ...(config.extended_features ? ['season'] : [])],
        days: [],
      };
  }
  requireCondition(
    dateOnly(config.forecast_period_from) &&
      dateOnly(config.forecast_period_until) &&
      config.forecast_period_from <= config.forecast_period_until &&
      config.forecast_period_from >=
        (config.mode === 'rolling_day_ahead' ? '2020-01-01' : '2025-01-01') &&
      config.forecast_period_until <= '2025-12-31',
    'validation_failed',
    'Forecast period must be ordered and within 2020–2025 for rolling backtests, or within 2025 for static forecasts.'
  );
  requireCondition(
    !config.history_from ||
      (dateOnly(config.history_from) &&
        config.history_from >= '2020-01-01' &&
        config.history_from <= '2024-12-31'),
    'validation_failed',
    'history_from must be within 2020–2024.'
  );
  requireCondition(
    payload.payload_fit_confirmed === true,
    'validation_failed',
    'Set payload_fit_confirmed after reviewing dataset validation.'
  );
  requireCondition(
    !config.production_use && !config.commercial_commitment,
    'commercial_scope_required',
    'This endpoint supports sandbox evaluation only.'
  );
  const preparedDatasets = datasetsOf(payload);
  const daysPerSeries =
    Math.round(
      (Date.parse(config.forecast_period_until) - Date.parse(config.forecast_period_from)) /
        86400000
    ) + 1;
  const totalDays = daysPerSeries * preparedDatasets.length;
  const results = preparedDatasets.map((prepared, index) =>
    evaluateSeries(prepared, config, (event) => {
      const completed = index * daysPerSeries + event.completed_days;
      progress({
        ...event,
        series_id: prepared.dataset.series_id,
        series_index: index + 1,
        completed_days: completed,
        total_days: totalDays,
        percent: (98 * completed) / totalDays,
      });
    })
  );
  return {
    status: results.some((r) => r.forecast_run.status === 'completed_with_warnings')
      ? 'completed_with_warnings'
      : 'completed',
    results,
    testcaseBoundary: BOUNDARY,
  };
}

function resolveFeatureConfiguration(config) {
  if (!config) return config;
  const result = { ...config };
  requireCondition(
    config.activity_labeling === undefined || config.activity_labeling === 'learned_low_load_v1',
    'validation_failed',
    'Unknown activity_labeling.'
  );
  requireCondition(
    !config.activity_labeling || config.activity_model === true,
    'validation_failed',
    'activity_labeling requires activity_model: true.'
  );
  requireCondition(
    config.prediction_threshold_w === undefined ||
      (typeof config.prediction_threshold_w === 'number' &&
        Number.isFinite(config.prediction_threshold_w) &&
        config.prediction_threshold_w >= 0),
    'validation_failed',
    'prediction_threshold_w must be a finite nonnegative number.'
  );
  requireCondition(
    config.selection_policy === undefined || config.selection_policy === 'adaptive_rmse_v1',
    'validation_failed',
    'Unknown selection_policy.'
  );
  requireCondition(
    config.activity_model === undefined || typeof config.activity_model === 'boolean',
    'validation_failed',
    'activity_model must be boolean.'
  );
  requireCondition(
    !config.activity_model || config.selection_policy === 'adaptive_rmse_v1',
    'validation_failed',
    'activity_model requires adaptive_rmse_v1.'
  );
  requireCondition(
    !config.activity_model || !config.feature_set || config.feature_set.includes('calendar'),
    'validation_failed',
    'activity_model requires calendar features.'
  );
  if (config.selection_policy === 'adaptive_rmse_v1') {
    requireCondition(
      !config.selection_metric || config.selection_metric === 'rmse',
      'validation_failed',
      'adaptive_rmse_v1 requires RMSE; remove MAE override.'
    );
    requireCondition(
      (!config.mode || config.mode === 'rolling_day_ahead') &&
        (!config.relationship_mode || config.relationship_mode === 'auto'),
      'validation_failed',
      'adaptive_rmse_v1 requires rolling auto mode.'
    );
    result.selection_metric = 'rmse';
  }
  if (config.weather_dataset_id) {
    requireCondition(
      !config.weather,
      'validation_failed',
      'Use weather or weather_dataset_id, not both.'
    );
    try {
      result.weather = loadWeatherDataset(config.weather_dataset_id);
    } catch {
      throw new EvaluationError(
        'missing_weather_data',
        'Weather dataset is unavailable or invalid on this server.'
      );
    }
  }
  if (config.context_dataset_id) {
    requireCondition(
      !config.context,
      'validation_failed',
      'Use context or context_dataset_id, not both.'
    );
    try {
      result.context = loadContextDataset(config.context_dataset_id);
    } catch {
      throw new EvaluationError(
        'validation_failed',
        'Context dataset is unavailable or invalid on this server.'
      );
    }
  }
  return result;
}
module.exports = {
  validateEvaluation,
  runEvaluation,
  EvaluationError,
  BOUNDARY,
  prepareDataset,
  featureContext,
  resolveFeatureConfiguration,
};
