'use strict';

const { createHash } = require('crypto');
const {
  createRelationshipSelector,
  pairedEvidence,
  POLICY,
} = require('./forecast-relationship-selection');
const { GROUPS } = require('./forecast-relationship-model');
const { shiftDate } = require('./forecast-evaluation-time');
const VERSION = 'temporal_context_guard_v1';
const GUARD = Object.freeze({
  minimum_rmse_gain: POLICY.minimum_gain,
  maximum_mae_regression: 0.02,
  reference: 'existing_automatic_calendar_and_recency_model',
  target_feature_fallback: 'preserve_reference',
});

function compareConfirmation(reference, candidate) {
  if (
    candidate.status !== 'validated_relationships' ||
    !candidate.selected_groups.some((g) => g === 'season' || GROUPS[g].kind !== 'calendar')
  )
    return { supported: false, reason: 'no_confirmed_additional_predictor' };
  const r = reference.historical_quality?.confirmation;
  const c = candidate.historical_quality?.confirmation;
  if (
    !r?.valid ||
    !c?.valid ||
    r.folds.length !== c.folds.length ||
    r.folds.some(
      (f, i) => f.from !== c.folds[i].from || f.until_exclusive !== c.folds[i].until_exclusive
    )
  )
    return { supported: false, reason: 'no_aligned_valid_confirmation' };
  const evidence = pairedEvidence(
    r.folds.map((f) => f.rmse),
    c.folds.map((f) => f.rmse),
    1,
    'rmse'
  );
  const maePassed = c.mae <= r.mae * (1 + GUARD.maximum_mae_regression);
  return {
    ...evidence,
    supported: evidence.supported && maePassed,
    mae_guard_passed: maePassed,
    reference_mae: r.mae,
    candidate_mae: c.mae,
    reason:
      evidence.supported && maePassed
        ? 'incremental_confirmation_passed'
        : 'existing_automatic_model_preserved',
  };
}
function createContextSelector({ time, features, config }, internal = false) {
  if (config.selection_policy === 'adaptive_rmse_v1' && !internal) {
    const { createAdaptiveGuard } = require('./forecast-adaptive-guard');
    return createAdaptiveGuard({ time, features, config }, (options) =>
      createContextSelector(options, true)
    );
  }
  if (!config.extended_features && !features.weatherEnabled && !features.contextEnabled)
    return createRelationshipSelector({ time, features, config });
  const baseFeatures = {
    ...features,
    weatherEnabled: false,
    contextEnabled: false,
    historicalWeather: () => ({}),
    forecastWeather: () => ({}),
    externalContext: () => ({}),
    sources: { ...features.sources, weather: null, context: null },
  };
  const baseline = createRelationshipSelector({
    time,
    features: baseFeatures,
    config: { ...config, extended_features: false },
  });
  const candidate = createRelationshipSelector({ time, features, config });
  const reports = [];
  let candidateFit, nextSelection, decision, report, key;
  return {
    reports,
    forDay(rows, issue, date) {
      const base = baseline.forDay(rows, issue, date);
      if (!candidateFit || date >= nextSelection || decision?.supported)
        candidateFit = candidate.forDay(rows, issue, date);
      const nextKey = `${base.report.selection_id}:${candidateFit.report.selection_id}`;
      if (nextKey !== key) {
        key = nextKey;
        nextSelection = shiftDate(date, POLICY.reselect_after_days);
        decision = compareConfirmation(base.report, candidateFit.report);
        const selected = decision.supported ? candidateFit : base;
        const baseRelations = new Map(base.report.relationships.map((r) => [r.feature, r]));
        report = {
          ...selected.report,
          version: VERSION,
          selection_id: createHash('sha256')
            .update(`${key}:${decision.supported}`)
            .digest('hex')
            .slice(0, 24),
          feature_sources: features.sources,
          requested_groups: candidateFit.report.requested_groups,
          relationships: decision.supported
            ? candidateFit.report.relationships
            : candidateFit.report.relationships.map(
                (r) =>
                  baseRelations.get(r.feature) || {
                    ...r,
                    status: r.status === 'accepted_predictive' ? 'unconfirmed' : r.status,
                    reason:
                      r.status === 'accepted_predictive'
                        ? 'no_confirmed_gain_over_automatic_reference'
                        : r.reason,
                  }
              ),
          extended_feature_guard: {
            ...decision,
            policy: GUARD,
            baseline_selection: base.report,
            candidate_selection: candidateFit.report,
          },
        };
        reports.push(report);
      }
      const selected = decision.supported ? candidateFit : base;
      return {
        ...selected,
        report,
        fallback_model: base.model,
        predict(row) {
          const prediction = selected.predict(row);
          if (decision.supported && prediction.fallback)
            return { ...base.predict(row), extended_feature_fallback: true };
          return prediction;
        },
      };
    },
  };
}
module.exports = { VERSION, GUARD, compareConfirmation, createContextSelector };
