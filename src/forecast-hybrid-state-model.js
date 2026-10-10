'use strict';

const { STEP, shiftDate, forecastOrigin } = require('./forecast-evaluation-time');
const { pairedEvidence } = require('./forecast-relationship-selection');
const { dailyHistory, fitStateModel, statePrediction, hash } = require('./forecast-state-model');
const { restoreModel } = require('./forecast-relationship-model');
const LEGACY_CONTEXT_VERSION = 'relationship_state_context_v3';
const EXTENDED_VERSION = 'relationship_state_context_guard_v4';
const ADAPTIVE_VERSION = 'relationship_state_adaptive_v5';
const { createContextSelector } = require('./forecast-context-selection');
const VERSION = 'relationship_state_correction_v2';
const POLICY = Object.freeze({
  correction_weight: 0.5,
  validation_days: 28,
  fold_days: 7,
  refit_days: 28,
  minimum_training_days: 84,
  minimum_coverage: 0.9,
  maximum_mae_regression: 0.02,
});

function builtinFeatures() {
  return {
    calendarEnabled: true,
    weatherEnabled: false,
    calendarAttributes: (row) => ({
      weekday: row.weekday,
      weekend: row.weekday === 0 || row.weekday === 6,
      month: Number(row.date.slice(5, 7)),
      season: Math.floor((Number(row.date.slice(5, 7)) % 12) / 3),
      holiday: false,
      bridge_day: false,
      school_holiday: false,
      special_day: '',
    }),
    forecastWeather: () => ({}),
    historicalWeather: () => ({}),
  };
}

// The residual state signal is added to the automatically selected seasonal/recent
// reference. Fixed shrinkage is declared in advance, not tuned on the outer test.
function correction(base, state) {
  return Math.max(0, base + POLICY.correction_weight * (state.candidate - state.reference));
}

function calendarPredictor(snapshot) {
  const buckets = new Map(snapshot.buckets);
  const slots = new Map(snapshot.slots);
  const features = builtinFeatures();
  return (row) => {
    const calendar = features.calendarAttributes(row);
    const exact = buckets.get(
      JSON.stringify([row.slot, ...snapshot.spec.groups.map((g) => calendar[g])])
    );
    const stats = exact?.n >= 3 ? exact : slots.get(row.slot);
    if (!stats?.n) throw new Error('Stored calendar reference lacks the requested slot.');
    return stats.sum / stats.n;
  };
}

function hybridPrediction(model, context, time, date, slot, issue, referencePredict) {
  const state = statePrediction(model, context, time, date, slot, issue);
  const reference = (referencePredict || calendarPredictor(model.reference_snapshot))({
    date,
    slot,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  });
  return { ...state, reference, candidate: correction(reference, state) };
}

function validateHybrid(rows, days, issue, time, config, features) {
  const end = time.parts(issue).date;
  const start = shiftDate(end, -POLICY.validation_days);
  const firstOrigin = forecastOrigin(time, start, config);
  const past = days.filter(
    (d) => d.available <= firstOrigin && time.midnight(shiftDate(d.date, 1)) <= firstOrigin
  );
  if (past.length < POLICY.minimum_training_days)
    return { supported: false, reason: 'insufficient_history', folds: [] };
  // Label transforms and transition parameters remain frozen over this holdout,
  // matching the 28-day operational state refit cadence.
  const model = fitStateModel(past, firstOrigin, time);
  const lookup = new Map(days.map((d) => [d.date, d]));
  const baseline = createContextSelector({ time, features, config });
  const folds = [];
  let baselineAbsolute = 0;
  let candidateAbsolute = 0;
  for (let from = start; from < end; from = shiftDate(from, 7)) {
    let baseSquare = 0;
    let candidateSquare = 0;
    let n = 0;
    const referenceFits = [];
    const until = time.midnight(shiftDate(from, 7));
    for (let date = from; date < shiftDate(from, 7); date = shiftDate(date, 1)) {
      const origin = forecastOrigin(time, date, config);
      const cutoff = time.midnight(shiftDate(date, -1));
      const eligible = rows.filter((r) => r.ms < cutoff && r.eligible <= origin);
      // Selection and fitting use only data known at this inner forecast origin.
      const fitted = baseline.forDay(eligible, origin, date);
      referenceFits.push({
        forecast_for: date,
        spec: fitted.model.spec,
        training_data_until: fitted.training_data_until,
      });
      for (const r of rows) {
        if (r.date !== date || r.eligible > issue) continue;
        const p = statePrediction(model, lookup, time, r.date, r.slot, origin);
        const base = fitted.predict(r).value;
        const candidate = correction(base, p);
        baseSquare += (r.value - base) ** 2;
        candidateSquare += (r.value - candidate) ** 2;
        baselineAbsolute += Math.abs(r.value - base);
        candidateAbsolute += Math.abs(r.value - candidate);
        n++;
      }
    }
    const expected = (until - time.midnight(from)) / STEP;
    folds.push({
      from,
      until_exclusive: shiftDate(from, 7),
      coverage: n / expected,
      reference_rmse: n ? Math.sqrt(baseSquare / n) : null,
      candidate_rmse: n ? Math.sqrt(candidateSquare / n) : null,
      reference_fits: referenceFits,
      state_training_until: model.training_data_until,
    });
  }
  if (folds.some((f) => f.coverage < POLICY.minimum_coverage))
    return { supported: false, reason: 'insufficient_validation_coverage', folds };
  const evidence = pairedEvidence(
    folds.map((f) => f.reference_rmse),
    folds.map((f) => f.candidate_rmse),
    1,
    'rmse'
  );
  const maeSupported = candidateAbsolute <= baselineAbsolute * (1 + POLICY.maximum_mae_regression);
  return {
    ...evidence,
    supported: evidence.supported && maeSupported,
    mae_guard_passed: maeSupported,
    reference: 'automatic_relationship_selection_without_state_correction',
    reference_fit_cadence: 'daily',
    folds,
  };
}

function createHybridStateSelector({ time, config = {}, features = builtinFeatures() }) {
  config = { ...config, mode: 'rolling_day_ahead' };
  const baseline = createContextSelector({ time, features, config });
  let nextFit;
  let model;
  let report;
  let snapshot;
  const reports = [];
  return {
    reports,
    snapshot: () => snapshot,
    forDay(rows, issue, date) {
      const days = dailyHistory(rows, time);
      const reference = baseline.forDay(rows, issue, date);
      if (!model || date >= nextFit) {
        const validation = validateHybrid(rows, days, issue, time, config, features);
        model = fitStateModel(days, issue, time);
        model.version =
          config.selection_policy === 'adaptive_rmse_v1'
            ? ADAPTIVE_VERSION
            : config.extended_features ||
                features.weatherEnabled ||
                features.contextEnabled ||
                config.issue_time === '18:00'
              ? EXTENDED_VERSION
              : VERSION;
        model.hybrid_policy = POLICY;
        model.state_features_enabled = validation.supported;
        model.validation = validation;
        nextFit = shiftDate(date, POLICY.refit_days);
        report = {
          selection_id: hash([model.history_digest, issue, config, VERSION]).slice(0, 24),
          as_of: new Date(issue).toISOString(),
          forecast_for: date,
          version: model.version,
          history_digest: model.history_digest,
          policy: POLICY,
          selection_metric: 'RMSE',
          status: validation.supported
            ? 'validated_state_correction'
            : 'automatic_reference_retained',
          selected_groups: reference.model.spec.groups,
          selected_window_days: reference.model.spec.window_days,
          state_features_enabled: validation.supported,
          state_definitions: {
            center: model.center,
            scale: model.scale,
            centroids: model.centroids,
          },
          reference_selection: reference.report,
          validation,
          causal_claim: false,
        };
        reports.push(report);
      }
      model = {
        ...model,
        reference_snapshot: reference.model.calendar_snapshot,
        reference_model: reference.model.snapshot,
        fallback_reference_model: reference.fallback_model?.snapshot,
        reference_validation: reference.report,
        issue_time: config.issue_time || '00:00',
        reference_training_data_until: reference.training_data_until,
        reference_fitted_at: new Date(issue).toISOString(),
      };
      const context = days.filter((d) => d.date >= shiftDate(date, -9));
      snapshot = {
        model,
        context,
        context_as_of: new Date(issue).toISOString(),
        next_refit_date: nextFit,
        feature_configuration: {
          ...config,
          weather: config.weather_dataset_id ? undefined : config.weather,
          context: config.context_dataset_id ? undefined : config.context,
        },
        feature_sources: features.sources,
      };
      const lookup = new Map(context.map((d) => [d.date, d]));
      return {
        report,
        model: reference.model,
        fitFallback: reference.fitFallback,
        training_intervals: Math.max(reference.training_intervals, model.training_intervals),
        training_data_until: new Date(
          Math.max(
            Date.parse(reference.training_data_until),
            Date.parse(model.training_data_until),
            ...context.map((d) => time.midnight(shiftDate(d.date, 1)) - STEP)
          )
        ).toISOString(),
        predict(row) {
          const base = reference.predict(row);
          const p = hybridPrediction(
            model,
            lookup,
            time,
            row.date,
            row.slot,
            issue,
            () => base.value
          );
          return {
            ...base,
            used_groups: model.state_features_enabled
              ? [...new Set([...base.used_groups, 'weekday'])]
              : base.used_groups,
            value: model.state_features_enabled ? p.candidate : p.reference,
            state: {
              probabilities: p.probabilities,
              known_lag_states: p.known,
              enabled: model.state_features_enabled,
              without_state_prediction: p.reference,
              candidate_prediction: p.candidate,
              model_fitted_at: model.fitted_at,
              correction_weight: POLICY.correction_weight,
            },
          };
        },
      };
    },
  };
}

module.exports = {
  EXTENDED_VERSION,
  ADAPTIVE_VERSION,
  LEGACY_CONTEXT_VERSION,
  restoreModel,
  VERSION,
  POLICY,
  builtinFeatures,
  calendarPredictor,
  correction,
  hybridPrediction,
  validateHybrid,
  createHybridStateSelector,
};
