'use strict';

const { createHash } = require('crypto');
const { shiftDate, STEP, forecastOrigin } = require('./forecast-evaluation-time');
const { fitModel, WEATHER_FIELDS, CONTEXT_FIELDS } = require('./forecast-relationship-model');

const {
  createActivityFeatures,
  VERSION: ACTIVITY_VERSION,
  POLICY: ACTIVITY_POLICY,
} = require('./forecast-activity-model');
const { VERSION: LOW_LOAD_VERSION, POLICY: LOW_LOAD_POLICY } = require('./forecast-low-load-model');
const ADAPTIVE_VERSION = 'temporal_rmse_windows_v1';
const VERSION = 'temporal_relationship_selection_v2';
const POLICY = Object.freeze({
  min_training_days: 56,
  discovery_days: 42,
  confirmation_days: 28,
  fold_days: 7,
  reselect_after_days: 28,
  default_window_days: null,
  recent_window_days: 84,
  minimum_gain: 0.03,
  minimum_coverage: 0.9,
  minimum_winning_fold_fraction: 0.75,
  max_selected_groups: 3,
  bootstrap_replicates: 1000,
  confidence_level: 0.95,
});

function specId(spec) {
  return `${spec.family ? `${spec.family}:` : ''}${spec.window_days === null ? 'all_history' : `${spec.window_days}d`}:${spec.groups.join('+') || 'quarter_hour_profile'}`;
}
function mean(values) {
  return values.length ? values.reduce((s, n) => s + n, 0) / values.length : null;
}
function gain(reference, candidate) {
  return reference > 1e-12 ? (reference - candidate) / reference : 0;
}

// Resample whole seven-day error blocks, not autocorrelated quarter-hours.
// Independent confirmation + Bonferroni across final-model/ablation claims limits
// optimistic reporting. These are predictive evidence intervals, not causal tests.
function pairedEvidence(reference, candidate, claims = 1, metric = 'mae') {
  if (!reference.length || reference.length !== candidate.length)
    return { supported: false, reason: 'insufficient_confirmation_blocks' };
  const differences = reference.map((v, i) => v - candidate[i]);
  let seed = 73471;
  const replicates = [];
  for (let i = 0; i < POLICY.bootstrap_replicates; i++) {
    let sum = 0;
    for (let j = 0; j < differences.length; j++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      sum += differences[Math.floor((seed / 4294967296) * differences.length)];
    }
    replicates.push(sum / differences.length);
  }
  replicates.sort((a, b) => a - b);
  const tail = (1 - POLICY.confidence_level) / (2 * claims);
  const lower = replicates[Math.floor(tail * (replicates.length - 1))];
  const upper = replicates[Math.ceil((1 - tail) * (replicates.length - 1))];
  const relative = gain(mean(reference), mean(candidate));
  const wins = differences.filter((v) => v > 1e-10).length / differences.length;
  return {
    supported:
      differences.length >= 4 &&
      lower > 0 &&
      relative >= POLICY.minimum_gain &&
      wins >= POLICY.minimum_winning_fold_fraction,
    metric: metric.toUpperCase(),
    [`reference_${metric}`]: mean(reference),
    [`candidate_${metric}`]: mean(candidate),
    [`absolute_${metric}_reduction`]: mean(differences),
    [`relative_${metric}_reduction`]: relative,
    winning_block_fraction: wins,
    [`${metric}_reduction_interval`]: [lower, upper],
    block_count: differences.length,
    method: 'paired_7_day_block_bootstrap',
    confidence_level: POLICY.confidence_level,
    multiple_comparison_correction: `Bonferroni_${claims}_claims`,
    limitation:
      'Approximate evidence from a small number of temporal blocks; no causal identification.',
  };
}

function createRelationshipSelector({ time, features, config }) {
  const adaptive = config.selection_policy === 'adaptive_rmse_v1';
  const metric = adaptive ? 'rmse' : config.selection_metric || 'mae';
  const windows = adaptive
    ? [28, 84, 365, null]
    : [config.recent_window_days ?? POLICY.recent_window_days];
  let activityLookup;
  const recentWindowDays = config.recent_window_days ?? POLICY.recent_window_days;
  let lastSelection = null;
  let nextSelectionDate = null;
  let staticFit = null;
  const reports = [];
  const calendarFields = [
    'weekday',
    'weekend',
    'month',
    ...(config.extended_features ? ['season'] : []),
    'holiday',
    'bridge_day',
    'school_holiday',
    'special_day',
  ];
  const enabled = [
    ...(features.calendarEnabled ? calendarFields : []),
    ...(features.weatherEnabled ? WEATHER_FIELDS : []),
    ...(features.contextEnabled ? CONTEXT_FIELDS : []),
  ];

  const historicalObservations = new WeakMap();
  function observation(row, issue, target = false) {
    if (!target) {
      const cached = historicalObservations.get(row);
      if (cached && cached.from <= issue && issue < cached.until) return cached.value;
    }
    const value = {
      ...row,
      calendar: features.calendarAttributes(row, issue),
      context: features.externalContext?.(row.ms, issue) || {},
      ...(activityLookup ? { activity: activityLookup(row, issue) } : {}),
      weather: target
        ? features.forecastWeather(row.ms, issue)
        : features.historicalWeather(row.ms, issue),
    };
    if (!target) {
      const [from, until] = features.observationValidity?.(row, issue) || [issue, issue + 1];
      historicalObservations.set(row, { from, until, value });
    }
    return value;
  }
  function prepareTraining(rows, issue, windowDays, groups) {
    const from =
      windowDays === null
        ? -Infinity
        : time.midnight(shiftDate(time.parts(issue).date, -windowDays));
    const cutoff = time.midnight(time.parts(issue).date);
    const eligible = rows.filter((r) => r.ms >= from && r.ms < cutoff && r.eligible <= issue);
    return groups?.length === 0 ? eligible : eligible.map((r) => observation(r, issue));
  }
  function select(rows, issue, forecastDay) {
    const asOfDate = time.parts(issue).date;
    const confirmationStart = shiftDate(asOfDate, -POLICY.confirmation_days);
    const discoveryStart = shiftDate(confirmationStart, -POLICY.discovery_days);
    const discoveryEnd = confirmationStart;
    const baseSpec = { groups: [], window_days: POLICY.default_window_days };
    const fingerprint = createHash('sha256');
    for (const r of rows) fingerprint.update(`${r.ms}:${r.value}:${r.eligible};`);
    const report = {
      version: adaptive ? ADAPTIVE_VERSION : VERSION,
      selection_id: '',
      as_of: new Date(issue).toISOString(),
      forecast_for: forecastDay,
      history_digest: fingerprint.digest('hex'),
      training_data_until: new Date(
        rows.reduce((max, r) => Math.max(max, r.ms), -Infinity)
      ).toISOString(),
      causal_claim: false,
      interpretation:
        'Validated predictive associations conditional on the tested model family; not proven causal effects.',
      policy: {
        ...POLICY,
        recent_window_days: recentWindowDays,
        ...(adaptive
          ? { history_windows: windows, objective: 'RMSE', maximum_mae_regression: 0.02 }
          : {}),
      },
      selection_metric: metric.toUpperCase(),
      feature_sources: features.sources,
      requested_groups: enabled,
      validation_design: {
        type: 'forward_chaining_discovery_then_untouched_confirmation',
        discovery_from: discoveryStart,
        discovery_until_exclusive: discoveryEnd,
        confirmation_from: confirmationStart,
        confirmation_until_exclusive: asOfDate,
        fit_frequency: 'one frozen model per 7-day fold; D-2 gap at fold origin',
        target_features: `features as known at D-1 ${config.issue_time || '00:00'} local time; meter cutoff D-2`,
        actuals_available_by: new Date(issue).toISOString(),
      },
      candidates: [],
      relationships: [],
      selected_groups: [],
      selected_model: specId(baseSpec),
      status: 'insufficient_evidence',
      fallback_reason: null,
    };
    const firstFoldIssue = forecastOrigin(time, discoveryStart, config);
    const earliestNeeded = time.midnight(shiftDate(discoveryStart, -POLICY.min_training_days - 1));
    const initialRows = rows.filter(
      (r) => r.ms >= earliestNeeded && r.ms < firstFoldIssue && r.eligible <= firstFoldIssue
    );
    if (
      initialRows.length < POLICY.min_training_days * 96 * POLICY.minimum_coverage ||
      new Set(initialRows.map((r) => r.date)).size <
        POLICY.min_training_days * POLICY.minimum_coverage
    ) {
      report.fallback_reason = 'insufficient_history_for_independent_temporal_validation';
      report.relationships = enabled.map((feature) => ({
        feature,
        status: 'insufficient_evidence',
        reason: report.fallback_reason,
      }));
      return finalize(baseSpec, report);
    }

    const rowsByDay = new Map();
    for (const row of rows) {
      if (!rowsByDay.has(row.date)) rowsByDay.set(row.date, []);
      rowsByDay.get(row.date).push(row);
    }
    const folds = [];
    for (let start = discoveryStart; start < asOfDate; start = shiftDate(start, 7)) {
      const end = shiftDate(start, 7);
      const fitIssue = forecastOrigin(time, start, config);
      const targets = [];
      for (let d = start; d < end; d = shiftDate(d, 1)) {
        const predictionIssue = forecastOrigin(time, d, config);
        for (const row of rowsByDay.get(d) || [])
          targets.push(observation(row, predictionIssue, true));
      }
      folds.push({
        start,
        end,
        fitIssue,
        targets,
        expected: (time.midnight(end) - time.midnight(start)) / STEP,
        training: new Map(),
        phase: start < confirmationStart ? 'discovery' : 'confirmation',
      });
    }
    const cache = new Map();
    function score(spec, phase) {
      const id = `${specId(spec)}:${phase}`;
      if (cache.has(id)) return cache.get(id);
      const results = [];
      for (const fold of folds.filter((f) => f.phase === phase)) {
        if (!fold.training.has(spec.window_days))
          fold.training.set(
            spec.window_days,
            prepareTraining(rows, fold.fitIssue, spec.window_days)
          );
        const training = fold.training.get(spec.window_days);
        const model = fitModel(training, spec);
        let sum = 0;
        let square = 0;
        let n = 0;
        let usable = 0;
        let brier = 0;
        let activityCount = 0;
        for (const row of fold.targets) {
          const prediction = model.predict(row);
          if (!Number.isFinite(prediction.value)) continue;
          sum += Math.abs(row.value - prediction.value);
          square += (row.value - prediction.value) ** 2;
          n++;
          if (prediction.activity) {
            brier +=
              (prediction.activity.probability -
                (row.value > (prediction.activity.low_load_threshold ?? 0) ? 1 : 0)) **
              2;
            activityCount++;
          }
          if (spec.groups.every((g) => prediction.used_groups.includes(g))) usable++;
        }
        results.push({
          from: fold.start,
          until_exclusive: fold.end,
          training_cutoff_exclusive: new Date(fold.fitIssue).toISOString(),
          training_intervals: training.length,
          mae: n ? sum / n : null,
          mse: n ? square / n : null,
          rmse: n ? Math.sqrt(square / n) : null,
          sample_count: n,
          ...(activityCount ? { activity_brier_score: brier / activityCount } : {}),
          ...(model.snapshot?.labeling ? { low_load_labeling: model.snapshot.labeling } : {}),
          expected_intervals: fold.expected,
          actual_coverage: n / fold.expected,
          feature_coverage: n ? usable / n : 0,
          training_weather_coverage: model.weather_coverage,
          identifiable_columns: model.identifiable_columns,
          valid:
            (spec.family !== LOW_LOAD_VERSION || model.snapshot.labeling.eligible) &&
            training.length >= 1344 &&
            n / fold.expected >= POLICY.minimum_coverage &&
            (!spec.groups.length || usable / Math.max(1, n) >= POLICY.minimum_coverage) &&
            model.weather_coverage >= POLICY.minimum_coverage,
        });
      }
      const valid = results.length > 0 && results.every((f) => f.valid);
      const output = {
        model: specId(spec),
        groups: spec.groups,
        window_days: spec.window_days,
        phase,
        valid,
        mae: valid ? mean(results.map((f) => f.mae)) : null,
        mse: valid
          ? results.reduce((s, f) => s + f.mse * f.sample_count, 0) /
            results.reduce((s, f) => s + f.sample_count, 0)
          : null,
        folds: results,
      };
      output.rmse = output.mse === null ? null : Math.sqrt(output.mse);
      cache.set(id, output);
      report.candidates.push(output);
      return output;
    }

    const reference = score(baseSpec, 'discovery');
    if (!reference.valid) {
      report.fallback_reason = 'insufficient_temporal_validation_coverage';
      report.relationships = enabled.map((feature) => ({
        feature,
        status: 'insufficient_evidence',
        reason: report.fallback_reason,
      }));
      return finalize(baseSpec, report);
    }
    let currentSpec = baseSpec;
    let currentScore = reference;
    const discoveryEvidence = new Map();
    for (let step = 0; step < POLICY.max_selected_groups + 1; step++) {
      const candidates = enabled
        .filter((g) => !currentSpec.groups.includes(g))
        .filter(
          (g) =>
            !(g === 'weekend' && currentSpec.groups.includes('weekday')) &&
            !(g === 'weekday' && currentSpec.groups.includes('weekend'))
        )
        .filter(() => currentSpec.groups.length < POLICY.max_selected_groups)
        .map((g) => ({ groups: [...currentSpec.groups, g], window_days: currentSpec.window_days }));
      for (const window of windows) {
        if (currentSpec.window_days !== window)
          candidates.push({ ...currentSpec, groups: [...currentSpec.groups], window_days: window });
      }
      let best = null;
      for (const spec of candidates) {
        const candidate = score(spec, 'discovery');
        const feature = spec.groups.at(-1);
        const improvement = candidate.valid ? gain(currentScore[metric], candidate[metric]) : null;
        const wins = candidate.valid
          ? candidate.folds.filter((f, i) => f[metric] < currentScore.folds[i][metric] - 1e-10)
              .length / candidate.folds.length
          : 0;
        if (spec.groups.length > currentSpec.groups.length)
          discoveryEvidence.set(feature, {
            metric: metric.toUpperCase(),
            [`relative_${metric}_reduction`]: improvement,
            winning_fold_fraction: wins,
            valid: candidate.valid,
          });
        if (
          candidate.valid &&
          improvement >= POLICY.minimum_gain &&
          wins >= POLICY.minimum_winning_fold_fraction &&
          (!best || candidate[metric] < best.score[metric] - 1e-10)
        )
          best = { spec, score: candidate };
      }
      if (!best) break;
      currentSpec = best.spec;
      currentScore = best.score;
    }

    function finish(selectedSpec, selectionReport) {
      if (!config.activity_model) return finalize(selectedSpec, selectionReport);
      const learnedLabels = config.activity_labeling === LOW_LOAD_VERSION;
      const zeroFraction = rows.filter((r) => r.value === 0).length / rows.length;
      if (
        (!learnedLabels && zeroFraction < ACTIVITY_POLICY.minimum_zero_fraction) ||
        rows.some((r) => r.value < 0)
      ) {
        selectionReport.activity_selection = {
          supported: false,
          reason: 'not_nonnegative_intermittent_history',
          zero_fraction: zeroFraction,
        };
        return finalize(selectedSpec, selectionReport);
      }
      const candidates = windows.map((window) => ({
        family: learnedLabels ? LOW_LOAD_VERSION : ACTIVITY_VERSION,
        groups: ['weekday'],
        window_days: window,
      }));
      const evaluated = candidates
        .map((spec) => ({ spec, score: score(spec, 'discovery') }))
        .filter((c) => c.score.valid)
        .sort((a, b) => a.score.rmse - b.score.rmse);
      if (!evaluated.length) {
        selectionReport.activity_selection = {
          supported: false,
          reason: 'insufficient_eligible_activity_folds',
          labeling: config.activity_labeling || 'exact_zero',
        };
        return finalize(selectedSpec, selectionReport);
      }
      const winner = evaluated[0];
      const reference = score(selectedSpec, 'confirmation');
      const candidate = score(winner.spec, 'confirmation');
      const evidence =
        reference.valid && candidate.valid
          ? pairedEvidence(
              reference.folds.map((f) => f.rmse),
              candidate.folds.map((f) => f.rmse),
              1,
              'rmse'
            )
          : { supported: false };
      const maeGuard =
        candidate.valid && candidate.mae <= reference.mae * (learnedLabels ? 1 : 1.02);
      const supported = evidence.supported && maeGuard;
      selectionReport.activity_selection = {
        ...evidence,
        supported,
        mae_guard_passed: maeGuard,
        zero_fraction: zeroFraction,
        selected_candidate: specId(winner.spec),
        reference,
        candidate,
        policy: learnedLabels ? LOW_LOAD_POLICY : ACTIVITY_POLICY,
        ...(learnedLabels ? { labeling: LOW_LOAD_VERSION, maximum_mae_regression: 0 } : {}),
      };
      if (supported) {
        selectionReport.status = 'validated_activity_amount';
        selectionReport.historical_quality = {
          ...selectionReport.historical_quality,
          confirmation: candidate,
          baseline_confirmation: reference,
        };
      }
      return finalize(supported ? winner.spec : selectedSpec, selectionReport);
    }
    report.discovery_selected_model = specId(currentSpec);
    if (specId(currentSpec) === specId(baseSpec)) {
      const baselineConfirmation = score(baseSpec, 'confirmation');
      report.historical_quality = {
        interpretation:
          'Out-of-sample historical validation, not training error or a future guarantee.',
        selected_model: specId(baseSpec),
        confirmation: baselineConfirmation,
      };
      report.status = 'baseline_retained';
      report.fallback_reason = 'no_stable_predictive_gain_in_discovery';
      report.relationships = enabled.map((feature) => ({
        feature,
        status: discoveryEvidence.get(feature)?.valid ? 'not_selected' : 'insufficient_evidence',
        reason: discoveryEvidence.get(feature)?.valid
          ? 'no_material_stable_incremental_gain'
          : 'insufficient_feature_or_archive_coverage',
        discovery: discoveryEvidence.get(feature) || null,
      }));
      return finish(baseSpec, report);
    }
    // The selected model is fixed before any confirmation errors are examined.
    const confirmationReference = score(baseSpec, 'confirmation');
    const confirmationCandidate = score(currentSpec, 'confirmation');
    const claims =
      1 + currentSpec.groups.length + (currentSpec.window_days !== baseSpec.window_days ? 1 : 0);
    const evidence =
      confirmationReference.valid && confirmationCandidate.valid
        ? pairedEvidence(
            confirmationReference.folds.map((f) => f[metric]),
            confirmationCandidate.folds.map((f) => f[metric]),
            claims,
            metric
          )
        : { supported: false, reason: 'insufficient_confirmation_coverage' };
    report.confirmation = evidence;
    const ablations = new Map();
    for (const feature of currentSpec.groups) {
      const ablated = score(
        { ...currentSpec, groups: currentSpec.groups.filter((g) => g !== feature) },
        'confirmation'
      );
      ablations.set(
        feature,
        ablated.valid && confirmationCandidate.valid
          ? pairedEvidence(
              ablated.folds.map((f) => f[metric]),
              confirmationCandidate.folds.map((f) => f[metric]),
              claims,
              metric
            )
          : { supported: false, reason: 'insufficient_ablation_coverage' }
      );
    }
    let windowSupported = true;
    if (currentSpec.window_days !== baseSpec.window_days) {
      const fullWindow = score(
        { ...currentSpec, window_days: baseSpec.window_days },
        'confirmation'
      );
      report.recency_evidence =
        fullWindow.valid && confirmationCandidate.valid
          ? pairedEvidence(
              fullWindow.folds.map((f) => f[metric]),
              confirmationCandidate.folds.map((f) => f[metric]),
              claims,
              metric
            )
          : { supported: false, reason: 'insufficient_recency_validation' };
      windowSupported = report.recency_evidence.supported;
    }
    const accepted =
      (!adaptive || confirmationCandidate.mae <= confirmationReference.mae * 1.02) &&
      evidence.supported &&
      [...ablations.values()].every((e) => e.supported) &&
      windowSupported;
    report.relationships = enabled.map((feature) => ({
      feature,
      status: currentSpec.groups.includes(feature)
        ? accepted
          ? 'accepted_predictive'
          : 'unconfirmed'
        : discoveryEvidence.get(feature)?.valid
          ? 'not_selected'
          : 'insufficient_evidence',
      reason: currentSpec.groups.includes(feature)
        ? accepted
          ? 'independent_confirmation_and_conditional_ablation_passed'
          : 'confirmation_gate_failed_model_reverted'
        : discoveryEvidence.get(feature)?.valid
          ? 'no_material_stable_incremental_gain'
          : 'insufficient_feature_or_archive_coverage',
      discovery: discoveryEvidence.get(feature) || null,
      conditional_ablation: ablations.get(feature) || null,
    }));
    report.status = accepted ? 'validated_relationships' : 'baseline_retained';
    report.fallback_reason = accepted ? null : 'independent_confirmation_failed';
    report.historical_quality = {
      interpretation:
        'Out-of-sample historical validation, not training error or a future guarantee.',
      selected_model: specId(accepted ? currentSpec : baseSpec),
      confirmation: accepted ? confirmationCandidate : confirmationReference,
      baseline_confirmation: confirmationReference,
    };
    return finish(accepted ? currentSpec : baseSpec, report);
  }

  function finalize(spec, report) {
    if (adaptive) {
      report.selected_family = spec.family || 'conditional_mean';
      if (report.historical_quality) report.historical_quality.selected_model = specId(spec);
    }
    report.selected_groups = spec.groups;
    report.selected_model = specId(spec);
    report.selected_window_days = spec.window_days;
    report.selection_id = createHash('sha256')
      .update(JSON.stringify(report))
      .digest('hex')
      .slice(0, 24);
    reports.push(report);
    return { spec, report };
  }

  return {
    reports,
    forDay(rows, issue, day) {
      const cutoff = time.midnight(time.parts(issue).date);
      if (config.activity_model) activityLookup = createActivityFeatures(rows, time, config);
      if (config.mode === 'static_year_forecast' && staticFit) return staticFit;
      if (!lastSelection || (config.mode !== 'static_year_forecast' && day >= nextSelectionDate)) {
        lastSelection = select(rows, issue, day);
        nextSelectionDate = shiftDate(day, POLICY.reselect_after_days);
      }
      let training = prepareTraining(
        rows,
        issue,
        lastSelection.spec.window_days,
        lastSelection.spec.groups
      );
      let fitFallback = false;
      if (training.length < 1344 || new Set(training.map((r) => r.slot)).size < 96) {
        training = rows
          .filter((r) => r.ms < cutoff && r.eligible <= issue)
          .map((r) => observation(r, issue));
        fitFallback = true;
      }
      const spec = fitFallback ? { groups: [], window_days: null } : lastSelection.spec;
      const model = fitModel(training, spec);
      const fitted = {
        report: lastSelection.report,
        model,
        fitFallback,
        training_intervals: training.length,
        training_data_until: new Date(
          training.reduce((max, r) => Math.max(max, r.ms), -Infinity)
        ).toISOString(),
        predict: (row) => model.predict(observation(row, issue, true)),
      };
      if (config.mode === 'static_year_forecast') staticFit = fitted;
      return fitted;
    },
  };
}

module.exports = { createRelationshipSelector, POLICY, VERSION, ADAPTIVE_VERSION, pairedEvidence };
