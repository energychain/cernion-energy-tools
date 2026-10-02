'use strict';

const { compareCanonicalStrings } = require('./canonical-order');

const {
  prepareDataset,
  EvaluationError,
  featureContext,
  resolveFeatureConfiguration,
} = require('./forecast-evaluation');
const { STEP, clock, dateOnly, shiftDate, forecastOrigin } = require('./forecast-evaluation-time');
const { dailyHistory, statePrediction } = require('./forecast-state-model');
const {
  createHybridStateSelector,
  hybridPrediction,
  calendarPredictor,
  VERSION: HYBRID_VERSION,
  EXTENDED_VERSION,
  ADAPTIVE_VERSION,
  LEGACY_CONTEXT_VERSION,
  builtinFeatures,
  restoreModel,
} = require('./forecast-hybrid-state-model');
const { thresholdPrediction } = require('./forecast-prediction-threshold');
const { activityFeatures } = require('./forecast-activity-model');
const { GROUPS } = require('./forecast-relationship-model');
const { createStateStore } = require('./forecast-state-store');

function check(condition, message) {
  if (!condition) throw new EvaluationError('validation_failed', message);
}
function tenant(meta) {
  // The sandbox gateway already controls access. Unscoped API tokens share the
  // sandbox namespace; request-body tenant values are deliberately ignored.
  return meta?.tenantId || 'sandbox';
}
function load(store, meta, params) {
  check(
    typeof params.series_id === 'string' && /^[a-f0-9]{64}$/.test(params.artifact_version || ''),
    'series_id and artifact_version are required.'
  );
  try {
    return store.load(tenant(meta), params.series_id, params.artifact_version);
  } catch {
    throw new EvaluationError(
      'model_not_found',
      'Model version unavailable or invalid for this tenant and series.'
    );
  }
}
function eligibleRows(prepared, issue) {
  const cutoff = prepared.time.midnight(prepared.time.parts(issue).date);
  return prepared.rows
    .map((r) => ({
      ...r,
      eligible: Math.max(r.available ?? -Infinity, prepared.time.midnight(shiftDate(r.date, 1))),
    }))
    .filter((r) => r.ms < cutoff && r.eligible <= issue);
}
function checkedDataset(dataset) {
  const p = prepareDataset(dataset, { live: true });
  check(
    p.validation.validation_status !== 'fail' && !p.rows.some((r) => r.value < 0),
    'State models require a valid nonnegative PT15M dataset.'
  );
  return p;
}
function trainStateModel(params, meta = {}, store = createStateStore()) {
  check(dateOnly(params.forecast_for), 'forecast_for must be a valid local date.');
  const prepared = checkedDataset(params.dataset);
  const config = resolveFeatureConfiguration(params.configuration || {});
  const issue = forecastOrigin(prepared.time, params.forecast_for, config);
  const features = configuredFeatures(config, params.dataset);
  check(issue <= Date.now(), 'Training knowledge time must not be in the future.');
  const rows = eligibleRows(prepared, issue);
  const selector = createHybridStateSelector({ time: prepared.time, config, features });
  check(
    dailyHistory(rows, prepared.time).length >= 14,
    'At least 14 complete eligible days are required.'
  );
  selector.forDay(rows, issue, params.forecast_for);
  const artifact = {
    ...selector.snapshot(),
    series_id: params.dataset.series_id,
    unit: params.dataset.unit,
    timezone: params.dataset.timezone,
    weather_region: params.dataset.weather_region,
  };
  return {
    status: 'trained',
    ...store.save(tenant(meta), artifact),
    validation: artifact.model.validation,
    reference_spec: artifact.model.reference_model?.spec || artifact.model.reference_snapshot?.spec,
    reference_validation: artifact.model.reference_validation,
    hybrid_policy: artifact.model.hybrid_policy,
    state_definitions: {
      center: artifact.model.center,
      scale: artifact.model.scale,
      centroids: artifact.model.centroids,
    },
    next_refit_date: artifact.next_refit_date,
  };
}
function inspectStateModel(params, meta = {}, store = createStateStore()) {
  const a = load(store, meta, params);
  return {
    series_id: a.series_id,
    artifact_version: params.artifact_version,
    model_version: a.model.version,
    unit: a.unit,
    timezone: a.timezone,
    training_data_until: [a.model.training_data_until, a.model.reference_training_data_until]
      .filter(Boolean)
      .sort(compareCanonicalStrings)
      .at(-1),
    state_training_data_until: a.model.training_data_until,
    reference_training_data_until: a.model.reference_training_data_until,
    context_as_of: a.context_as_of,
    next_refit_date: a.next_refit_date,
    state_features_enabled: a.model.state_features_enabled,
    validation: a.model.validation,
    feature_sources: a.feature_sources,
    issue_time: a.model.issue_time || '00:00',
    reference_spec: a.model.reference_model?.spec || a.model.reference_snapshot?.spec,
    reference_validation: a.model.reference_validation,
    hybrid_policy: a.model.hybrid_policy,
    state_definitions: {
      descriptor_names: a.model.descriptor_names,
      center: a.model.center,
      scale: a.model.scale,
      centroids: a.model.centroids,
    },
  };
}
function predictStateModel(params, meta = {}, store = createStateStore()) {
  check(dateOnly(params.forecast_for), 'forecast_for must be a valid local date.');
  const a = load(store, meta, params);
  const time = clock(a.timezone);
  const issue = forecastOrigin(time, params.forecast_for, a.model);
  check(issue <= Date.now(), 'Prediction issue time must not be in the future.');
  check(
    Date.parse(a.context_as_of) <= issue && Date.parse(a.model.fitted_at) <= issue,
    'Model/context was created after the requested historical forecast origin.'
  );
  let version = params.artifact_version;
  if (params.recent_dataset) {
    const d = params.recent_dataset;
    check(
      d.series_id === a.series_id && d.unit === a.unit && d.timezone === a.timezone,
      'Recent dataset identity, timezone or unit mismatch.'
    );
    const recent = checkedDataset(d);
    const context = new Map(a.context.map((day) => [day.date, day]));
    for (const day of dailyHistory(eligibleRows(recent, issue), time)) context.set(day.date, day);
    a.context = [...context.values()].filter(
      (day) => day.date >= shiftDate(params.forecast_for, -9)
    );
    a.context_as_of = new Date(issue).toISOString();
    // Persist context updates as another immutable version; model parameters remain frozen.
    version = store.save(tenant(meta), a).artifact_version;
  }
  const warnings = [];
  if (params.forecast_for >= a.next_refit_date) warnings.push('model_refit_due');
  const predictions = [];
  const lookup = new Map(a.context.map((d) => [d.date, d]));
  const hybrid = [
    HYBRID_VERSION,
    EXTENDED_VERSION,
    ADAPTIVE_VERSION,
    LEGACY_CONTEXT_VERSION,
  ].includes(a.model.version);
  let featureConfiguration = a.feature_configuration || {};
  if (params.configuration) {
    const allowed = ['weather', 'weather_dataset_id', 'context', 'context_dataset_id'];
    check(
      Object.keys(params.configuration).every((k) => allowed.includes(k)),
      'Inference may refresh weather/context inputs only.'
    );
    featureConfiguration = { ...featureConfiguration, ...params.configuration };
    if (params.configuration.weather) delete featureConfiguration.weather_dataset_id;
    if (params.configuration.weather_dataset_id) delete featureConfiguration.weather;
    if (params.configuration.context) delete featureConfiguration.context_dataset_id;
    if (params.configuration.context_dataset_id) delete featureConfiguration.context;
  }
  const resolved = resolveFeatureConfiguration(featureConfiguration);
  const features = configuredFeatures(resolved, a);
  const restored = a.model.reference_model ? restoreModel(a.model.reference_model) : null;
  const backup = a.model.fallback_reference_model
    ? restoreModel(a.model.fallback_reference_model)
    : null;
  let referenceFallback = false;
  let lastReferencePrediction;
  const referencePredict = restored
    ? (row) => {
        // DST repeated slots have identical calendar attributes but distinct weather/price.
        const ms = row.ms;
        const observation = {
          ...row,
          calendar: features.calendarAttributes(row, issue),
          weather: features.forecastWeather(ms, issue),
          context: features.externalContext?.(ms, issue) || {},
          activity: activityFeatures(row, lookup, issue),
        };
        const p = restored.predict(observation);
        referenceFallback ||= p.fallback;
        lastReferencePrediction = p.fallback && backup ? backup.predict(observation) : p;
        return lastReferencePrediction.value;
      }
    : hybrid
      ? calendarPredictor(a.model.reference_snapshot)
      : null;
  if (hybrid && issue > Date.parse(a.model.reference_fitted_at))
    warnings.push('reference_refit_recommended');
  for (
    let ms = time.midnight(params.forecast_for);
    ms < time.midnight(shiftDate(params.forecast_for, 1));
    ms += STEP
  ) {
    const local = time.parts(ms);
    const p = hybrid
      ? hybridPrediction(a.model, lookup, time, local.date, local.slot, issue, (row) =>
          referencePredict({ ...row, ms })
        )
      : statePrediction(a.model, lookup, time, local.date, local.slot, issue);
    if (p.known.length < 2 && !warnings.includes('missing_recent_state_context'))
      warnings.push('missing_recent_state_context');
    const usedUntil = Math.max(
      Date.parse(a.model.training_data_until),
      Date.parse(a.model.reference_training_data_until || a.model.training_data_until),
      ...p.known.map((d) => time.midnight(shiftDate(d.date, 1)) - STEP)
    );
    predictions.push({
      series_id: a.series_id,
      timestamp: new Date(ms).toISOString(),
      forecast_for: params.forecast_for,
      forecast_created_at: new Date(issue).toISOString(),
      ...thresholdPrediction(
        a.model.state_features_enabled ? p.candidate : p.reference,
        a.unit,
        resolved.prediction_threshold_w
      ),
      unit: a.unit,
      model_version: a.model.version,
      artifact_version: version,
      training_data_until: new Date(usedUntil).toISOString(),
      model_training_data_until: [
        a.model.training_data_until,
        a.model.reference_training_data_until,
      ]
        .filter(Boolean)
        .sort(compareCanonicalStrings)
        .at(-1),
      state_training_data_until: a.model.training_data_until,
      reference_training_data_until: a.model.reference_training_data_until,
      ...(lastReferencePrediction?.activity
        ? { activity_model: lastReferencePrediction.activity }
        : {}),
      state_probabilities: p.probabilities,
      known_lag_states: p.known,
      state_features_enabled: a.model.state_features_enabled,
      ...(lastReferencePrediction
        ? {
            selected_predictors: [
              ...new Set([
                ...lastReferencePrediction.used_groups,
                ...(a.model.state_features_enabled ? ['weekday'] : []),
              ]),
            ],
            feature_set: [
              'history',
              ...new Set(lastReferencePrediction.used_groups.map((g) => GROUPS[g].kind)),
              ...(a.model.state_features_enabled &&
              !lastReferencePrediction.used_groups.some((g) => GROUPS[g].kind === 'calendar')
                ? ['calendar']
                : []),
            ],
          }
        : {}),
    });
  }
  if (referenceFallback) warnings.push('missing_feature_values_reference_fallback');
  if (
    resolved.weather?.live_acquisition?.validation_limitation &&
    predictions.some((p) => p.feature_set?.includes('weather'))
  )
    warnings.push('live_weather_source_differs_from_historical_validation');
  return {
    feature_sources: features.sources,
    status: warnings.length ? 'completed_with_warnings' : 'completed',
    series_id: a.series_id,
    artifact_version: version,
    model_version: a.model.version,
    forecast_values: predictions,
    prediction_threshold_w: resolved.prediction_threshold_w || 0,
    warnings,
    availability_policy: `D-2 inclusive; issue at D-1 ${a.model.issue_time || '00:00'} local time`,
    production_use: false,
  };
}
function persistStateEvaluation(result, meta = {}, store = createStateStore()) {
  for (const row of result.results) {
    if (!row.state_model_snapshot) continue;
    row.state_model_artifact = store.save(tenant(meta), row.state_model_snapshot);
    delete row.state_model_snapshot;
  }
  return result;
}
function configuredFeatures(config, dataset) {
  if (!config.weather && !config.context && !config.feature_set) return builtinFeatures();
  return featureContext(
    {
      ...config,
      feature_set: config.feature_set || [
        'history',
        'calendar',
        ...(config.weather ? ['weather'] : []),
        ...(config.context ? ['context'] : []),
      ],
      calendar: config.calendar || {
        source: 'IANA-local-Gregorian-calendar',
        version: 'derived-calendar-v1',
        country: 'unspecified',
        region: 'unspecified',
        features: ['weekday', 'weekend', 'month', 'season'],
        days: [],
      },
    },
    dataset
  );
}
module.exports = { trainStateModel, inspectStateModel, predictStateModel, persistStateEvaluation };
