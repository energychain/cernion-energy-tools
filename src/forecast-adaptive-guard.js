'use strict';
const { createHash } = require('crypto');
const { pairedEvidence, POLICY } = require('./forecast-relationship-selection');
const { shiftDate } = require('./forecast-evaluation-time');
const VERSION = 'adaptive_reference_guard_v1';
function compareAdaptive(reference, candidate) {
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
    return { supported: false, reason: 'no_aligned_confirmation' };
  const evidence = pairedEvidence(
    r.folds.map((f) => f.rmse),
    c.folds.map((f) => f.rmse),
    1,
    'rmse'
  );
  const maePassed = c.mae <= r.mae * 1.02;
  return {
    ...evidence,
    supported: evidence.supported && maePassed,
    mae_guard_passed: maePassed,
    reference_mae: r.mae,
    candidate_mae: c.mae,
    reason:
      evidence.supported && maePassed
        ? 'confirmed_gain_over_existing_automatic_model'
        : 'existing_automatic_model_preserved',
  };
}
function createAdaptiveGuard({ time, features, config }, factory) {
  // This legacy comparator is a protected incumbent, not a new MAE-selected
  // challenger. Every replacement decision is based on RMSE with an MAE guard.
  const baseline = factory({
    time,
    features,
    config: {
      ...config,
      selection_policy: undefined,
      activity_model: false,
      selection_metric: 'mae',
    },
  });
  const candidate = factory({ time, features, config });
  const reports = [];
  let fitted, decision, report, nextSelection, lastKey;
  return {
    reports,
    forDay(rows, issue, date) {
      const base = baseline.forDay(rows, issue, date);
      if (!fitted || date >= nextSelection || decision?.supported)
        fitted = candidate.forDay(rows, issue, date);
      const key = `${base.report.selection_id}:${fitted.report.selection_id}`;
      if (key !== lastKey) {
        lastKey = key;
        nextSelection = shiftDate(date, POLICY.reselect_after_days);
        decision = compareAdaptive(base.report, fitted.report);
        report = {
          ...(decision.supported ? fitted.report : base.report),
          version: VERSION,
          selection_metric: 'RMSE',
          selection_id: createHash('sha256')
            .update(`${key}:${decision.supported}`)
            .digest('hex')
            .slice(0, 24),
          adaptive_guard: {
            ...decision,
            incumbent_policy: 'existing_mae_calendar_context_and_recency',
            challenger_policy: 'adaptive_rmse_v1',
            baseline_selection: base.report,
            candidate_selection: fitted.report,
          },
        };
        reports.push(report);
      }
      const selected = decision.supported ? fitted : base;
      return {
        ...selected,
        report,
        fallback_model: base.model,
        predict(row) {
          const p = selected.predict(row);
          return decision.supported && (p.fallback || p.extended_feature_fallback)
            ? { ...base.predict(row), adaptive_reference_fallback: true }
            : p;
        },
      };
    },
  };
}
module.exports = { VERSION, compareAdaptive, createAdaptiveGuard };
