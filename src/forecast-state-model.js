'use strict';

// Serializable daily regime model. All label transforms are fitted on the past.
const { createHash } = require('crypto');
const { STEP, shiftDate } = require('./forecast-evaluation-time');
const { pairedEvidence } = require('./forecast-relationship-selection');
const VERSION = 'causal_daily_states_v1';
const POLICY = Object.freeze({
  states: 3,
  min_training_days: 84,
  validation_days: 28,
  fold_days: 7,
  refit_days: 28,
  transition_prior_days: 14,
  template_prior_days: 7,
  minimum_coverage: 0.9,
  selection_metric: 'RMSE',
});
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const slotIndex = (slot) => Number(slot.slice(0, 2)) * 4 + Number(slot.slice(3)) / 15;

function dailyHistory(rows, time) {
  const map = new Map();
  for (const row of rows) {
    let d = map.get(row.date);
    if (!d) {
      d = {
        date: row.date,
        sum: 0,
        n: 0,
        positive: 0,
        daytime: 0,
        available: 0,
        values: Array(96).fill(0),
        counts: Array(96).fill(0),
        squares: Array(96).fill(0),
      };
      map.set(row.date, d);
    }
    const slot = slotIndex(row.slot);
    d.sum += row.value;
    d.n++;
    d.positive += row.value > 0 ? 1 : 0;
    if (slot >= 32 && slot < 80) d.daytime += row.value;
    d.available = Math.max(d.available, row.eligible);
    d.values[slot] += row.value;
    d.squares[slot] += row.value ** 2;
    d.counts[slot]++;
  }
  return [...map.values()]
    .filter((d) => {
      const expected = (time.midnight(shiftDate(d.date, 1)) - time.midnight(d.date)) / STEP;
      return d.n === expected;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      // Fold repeated autumn slots by their mean; absent spring slots have count zero.
      values: d.values.map((v, i) => (d.counts[i] ? v / d.counts[i] : 0)),
      descriptor: [Math.log1p(d.sum / d.n), d.positive / d.n, d.sum ? d.daytime / d.sum : 0],
    }));
}

function distance(a, b) {
  return a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
}
function label(model, day) {
  const x = day.descriptor.map((v, i) => (v - model.center[i]) / model.scale[i]);
  let best = 0;
  for (let k = 1; k < model.centroids.length; k++)
    if (distance(x, model.centroids[k]) < distance(x, model.centroids[best])) best = k;
  return best;
}
function learnLabels(days) {
  const center = [0, 1, 2].map((i) => mean(days.map((d) => d.descriptor[i])));
  const scale = center.map(
    (v, i) => Math.sqrt(mean(days.map((d) => (d.descriptor[i] - v) ** 2))) || 1
  );
  const xs = days.map((d) => d.descriptor.map((v, i) => (v - center[i]) / scale[i]));
  const sorted = xs.slice().sort((a, b) => a[0] - b[0]);
  let centroids = [0.15, 0.5, 0.85].map((q) => sorted[Math.floor((sorted.length - 1) * q)].slice());
  for (let step = 0; step < 20; step++) {
    const groups = centroids.map(() => []);
    for (const x of xs) {
      let best = 0;
      for (let k = 1; k < centroids.length; k++)
        if (distance(x, centroids[k]) < distance(x, centroids[best])) best = k;
      groups[best].push(x);
    }
    centroids = groups.map((g, k) =>
      g.length ? [0, 1, 2].map((i) => mean(g.map((x) => x[i]))) : centroids[k]
    );
  }
  centroids.sort((a, b) => a[0] - b[0]);
  return {
    center,
    scale,
    centroids,
    descriptor_names: ['log1p_daily_mean', 'positive_fraction', 'daytime_energy_fraction'],
  };
}
function emptyProfile() {
  return { sum: Array(96).fill(0), count: Array(96).fill(0) };
}
function addProfile(profile, day) {
  day.values.forEach((v, i) => {
    profile.sum[i] += v * day.counts[i];
    profile.count[i] += day.counts[i];
  });
}

function fitStateModel(days, issue, time) {
  const past = days.filter(
    (d) => d.available <= issue && time.midnight(shiftDate(d.date, 1)) <= issue
  );
  if (past.length < 14)
    throw new Error('At least 14 complete eligible days are required for state models.');
  const transform = learnLabels(past);
  const model = {
    version: VERSION,
    policy: POLICY,
    ...transform,
    fitted_at: new Date(issue).toISOString(),
    training_data_until: new Date(
      time.midnight(shiftDate(past.at(-1).date, 1)) - STEP
    ).toISOString(),
    training_days: past.length,
    training_intervals: past.reduce((n, d) => n + d.n, 0),
    history_digest: hash(
      past.map((d) => [d.date, d.available, d.values, d.counts, d.squares, d.descriptor])
    ),
    all: emptyProfile(),
    calendar: Array.from({ length: 7 }, emptyProfile),
    templates: Array.from({ length: 3 }, emptyProfile),
    state_counts: Array(3).fill(0),
    weekday_counts: Array.from({ length: 7 }, () => Array(3).fill(0)),
    transitions: {},
  };
  const lookup = new Map(past.map((d) => [d.date, d]));
  for (const d of past) {
    const state = label(model, d);
    const wd = weekday(d.date);
    addProfile(model.all, d);
    addProfile(model.calendar[wd], d);
    addProfile(model.templates[state], d);
    model.state_counts[state]++;
    model.weekday_counts[wd][state]++;
    const origin = time.midnight(shiftDate(d.date, -1));
    for (const lag of [2, 7]) {
      const previous = lookup.get(shiftDate(d.date, -lag));
      if (!previous || previous.available > origin) continue;
      const key = `${lag}:${label(model, previous)}:${wd}`;
      model.transitions[key] ||= Array(3).fill(0);
      model.transitions[key][state]++;
    }
  }
  return model;
}

function statePrediction(model, days, time, date, slot, issue) {
  const lookup = days instanceof Map ? days : new Map(days.map((d) => [d.date, d]));
  const wd = weekday(date);
  const i = slotIndex(slot);
  const calendar = model.calendar[wd];
  const reference = calendar.count[i]
    ? calendar.sum[i] / calendar.count[i]
    : model.all.sum[i] / model.all.count[i];
  const counts = model.weekday_counts[wd];
  const n = counts.reduce((a, b) => a + b, 0);
  const prior = counts.map(
    (v, k) => (v + (7 * model.state_counts[k]) / model.training_days) / (n + 7)
  );
  const distributions = [];
  const known = [];
  for (const lag of [2, 7]) {
    const d = lookup.get(shiftDate(date, -lag));
    if (!d || d.available > issue || time.midnight(shiftDate(d.date, 1)) > issue) continue;
    const state = label(model, d);
    const transitions = model.transitions[`${lag}:${state}:${wd}`] || [0, 0, 0];
    const total = transitions.reduce((a, b) => a + b, 0);
    distributions.push(
      transitions.map(
        (v, k) =>
          (v + POLICY.transition_prior_days * prior[k]) / (total + POLICY.transition_prior_days)
      )
    );
    known.push({
      lag_days: lag,
      date: d.date,
      state,
      available_at: new Date(d.available).toISOString(),
    });
  }
  const probabilities = distributions.length
    ? prior.map((_, k) => mean(distributions.map((p) => p[k])))
    : prior;
  const candidate = probabilities.reduce((sum, p, k) => {
    const t = model.templates[k];
    const stateMean = t.count[i] ? t.sum[i] / t.count[i] : reference;
    return sum + p * stateMean;
  }, 0);
  // A small prior on the matched calendar reference limits sparse-regime variance.
  const weight = model.training_days / (model.training_days + POLICY.template_prior_days);
  return {
    candidate: weight * candidate + (1 - weight) * reference,
    reference,
    probabilities,
    known,
  };
}

function validateStates(days, issue, time) {
  const end = time.parts(issue).date;
  const start = shiftDate(end, -POLICY.validation_days);
  const folds = [];
  const lookup = new Map(days.map((d) => [d.date, d]));
  for (let from = start; from < end; from = shiftDate(from, 7)) {
    const cutoff = time.midnight(shiftDate(from, -1));
    const eligible = days.filter((d) => d.available <= cutoff && d.date < shiftDate(from, -1));
    if (eligible.length < POLICY.min_training_days)
      return { supported: false, reason: 'insufficient_history', folds };
    const model = fitStateModel(eligible, cutoff, time);
    let stateSquare = 0;
    let baseSquare = 0;
    let n = 0;
    for (let date = from; date < shiftDate(from, 7); date = shiftDate(date, 1)) {
      const actual = lookup.get(date);
      if (!actual || actual.available > issue) continue;
      const origin = time.midnight(shiftDate(date, -1));
      for (let i = 0; i < 96; i++) {
        if (!actual.counts[i]) continue;
        const slot = `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
        const p = statePrediction(model, lookup, time, date, slot, origin);
        const withinSlotSquare = Math.max(
          0,
          actual.squares[i] - actual.counts[i] * actual.values[i] ** 2
        );
        stateSquare += withinSlotSquare + actual.counts[i] * (actual.values[i] - p.candidate) ** 2;
        baseSquare += withinSlotSquare + actual.counts[i] * (actual.values[i] - p.reference) ** 2;
        n += actual.counts[i];
      }
    }
    const expected = (time.midnight(shiftDate(from, 7)) - time.midnight(from)) / STEP;
    folds.push({
      from,
      until_exclusive: shiftDate(from, 7),
      training_cutoff_exclusive: new Date(cutoff).toISOString(),
      training_days: model.training_days,
      coverage: n / expected,
      reference_rmse: n ? Math.sqrt(baseSquare / n) : null,
      candidate_rmse: n ? Math.sqrt(stateSquare / n) : null,
    });
  }
  if (folds.some((f) => f.coverage < POLICY.minimum_coverage))
    return { supported: false, reason: 'insufficient_validation_coverage', folds };
  return {
    ...pairedEvidence(
      folds.map((f) => f.reference_rmse),
      folds.map((f) => f.candidate_rmse),
      1,
      'rmse'
    ),
    reference: 'identical_training_calendar_profile_without_states',
    folds,
  };
}

function createStateSelector({ time }) {
  let nextFit = null;
  let model;
  let report;
  let snapshot;
  const reports = [];
  return {
    reports,
    snapshot: () => snapshot,
    forDay(rows, issue, date) {
      // The caller supplies eligible rows only. Past availability is still retained
      // so inner validation cannot use late measurements at earlier origins.
      const days = dailyHistory(rows, time);
      if (!model || date >= nextFit) {
        const validation = validateStates(days, issue, time);
        model = fitStateModel(days, issue, time);
        model.state_features_enabled = validation.supported;
        model.validation = validation;
        nextFit = shiftDate(date, POLICY.refit_days);
        report = {
          selection_id: hash([model.history_digest, issue]).slice(0, 24),
          as_of: new Date(issue).toISOString(),
          forecast_for: date,
          version: VERSION,
          history_digest: model.history_digest,
          policy: POLICY,
          selection_metric: 'RMSE',
          status: validation.supported ? 'validated_states' : 'calendar_reference_retained',
          selected_groups: ['weekday'],
          state_features_enabled: validation.supported,
          state_definitions: {
            center: model.center,
            scale: model.scale,
            centroids: model.centroids,
          },
          validation,
          causal_claim: false,
        };
        reports.push(report);
      }
      const context = days.filter((d) => d.date >= shiftDate(date, -9));
      snapshot = {
        model,
        context,
        context_as_of: new Date(issue).toISOString(),
        next_refit_date: nextFit,
      };
      const lookup = new Map(context.map((d) => [d.date, d]));
      const usedUntil = Math.max(
        Date.parse(model.training_data_until),
        ...context.map((d) => time.midnight(shiftDate(d.date, 1)) - STEP)
      );
      return {
        report,
        model: { spec: { groups: ['weekday'], window_days: null }, coefficients: {} },
        training_intervals: model.training_intervals,
        training_data_until: new Date(usedUntil).toISOString(),
        fitFallback: false,
        predict(row) {
          const p = statePrediction(model, lookup, time, row.date, row.slot, issue);
          return {
            value: model.state_features_enabled ? p.candidate : p.reference,
            used_groups: ['weekday'],
            fallback: !model.state_features_enabled,
            state: {
              probabilities: p.probabilities,
              known_lag_states: p.known,
              enabled: model.state_features_enabled,
              without_state_prediction: p.reference,
              candidate_prediction: p.candidate,
              model_fitted_at: model.fitted_at,
            },
          };
        },
      };
    },
  };
}

module.exports = {
  VERSION,
  POLICY,
  dailyHistory,
  fitStateModel,
  statePrediction,
  validateStates,
  createStateSelector,
  hash,
};
