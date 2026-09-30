'use strict';

const slotIndex = (slot) => Number(slot.slice(0, 2)) * 4 + Number(slot.slice(3)) / 15;
const { shiftDate, forecastOrigin } = require('./forecast-evaluation-time');
const VERSION = 'activity_amount_v1';
const POLICY = Object.freeze({
  probability_prior: 24,
  amount_prior: 8,
  minimum_zero_fraction: 0.2,
});

// Both lags were available at the historical row's OWN forecast origin, not just
// at the current training origin. Missing/DST-absent slots remain unknown.
function activityFeatures(row, days, issue) {
  const index = slotIndex(row.slot);
  const known = [];
  const values = [];
  const lags = [2, 7].map((lag) => {
    const day = days.get(shiftDate(row.date, -lag));
    if (!day || day.available > issue || !day.counts[index]) {
      values.push(null);
      return -1;
    }
    values.push(day.values[index]);
    known.push({
      date: day.date,
      available_at: new Date(day.available).toISOString(),
      lag_days: lag,
    });
    return day.values[index] > 0 ? 1 : 0;
  });
  const d2 = days.get(shiftDate(row.date, -2));
  const activity = d2 && d2.available <= issue ? d2.positive / d2.n : null;
  return {
    lag2_value: values[0],
    lag7_value: values[1],
    lag2_day_mean: d2 && d2.available <= issue ? d2.sum / d2.n : null,
    lag2_active: lags[0],
    lag7_active: lags[1],
    lag2_day_regime: activity === null ? -1 : activity < 0.25 ? 0 : activity < 0.75 ? 1 : 2,
    known_lags: known,
  };
}
function createActivityFeatures(rows, time, config) {
  const { dailyHistory } = require('./forecast-state-model');
  const days = new Map(dailyHistory(rows, time).map((d) => [d.date, d]));
  const origins = new Map();
  return (row, targetIssue) => {
    if (!origins.has(row.date)) origins.set(row.date, forecastOrigin(time, row.date, config));
    return activityFeatures(row, days, Math.min(targetIssue, origins.get(row.date)));
  };
}
function keys(row) {
  const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
  const block = Math.floor(Number(row.slot.split(':')[0]) / 6);
  const a = row.activity || {};
  return {
    probability: JSON.stringify([
      weekday === 0 || weekday === 6,
      block,
      a.lag2_active ?? -1,
      a.lag7_active ?? -1,
      a.lag2_day_regime ?? -1,
    ]),
    prior: JSON.stringify([weekday === 0 || weekday === 6, block]),
    amount: JSON.stringify([weekday, row.slot]),
    slot: row.slot,
  };
}
function fitActivityModel(rows, spec) {
  const tables = Object.fromEntries(
    ['probability', 'prior', 'amount', 'slot'].map((k) => [k, new Map()])
  );
  let positive = 0,
    total = 0;
  for (const row of rows) {
    const active = row.value > 0 ? 1 : 0;
    positive += active;
    total += row.value;
    for (const [kind, key] of Object.entries(keys(row))) {
      if (!tables[kind].has(key)) tables[kind].set(key, { n: 0, positive: 0, sum: 0 });
      const s = tables[kind].get(key);
      s.n++;
      s.positive += active;
      s.sum += row.value;
    }
  }
  const snapshot = {
    kind: VERSION,
    spec,
    policy: POLICY,
    global_probability: rows.length ? positive / rows.length : 0,
    global_positive_mean: positive ? total / positive : 0,
    tables: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, [...v]])),
  };
  return {
    snapshot,
    spec,
    sample_count: rows.length,
    weather_coverage: 1,
    coefficients: {},
    identifiable_columns: [],
    calendar_snapshot: null,
    predict: restoreActivityModel(snapshot).predict,
  };
}
function restoreActivityModel(snapshot) {
  const tables = Object.fromEntries(
    Object.entries(snapshot.tables).map(([k, v]) => [k, new Map(v)])
  );
  return {
    spec: snapshot.spec,
    predict(row) {
      const k = keys(row);
      const prior = tables.prior.get(k.prior);
      const p0 = prior?.n ? prior.positive / prior.n : snapshot.global_probability;
      const ps = tables.probability.get(k.probability);
      const strength = snapshot.policy.probability_prior;
      const probability = ((ps?.positive || 0) + strength * p0) / ((ps?.n || 0) + strength);
      const slot = tables.slot.get(k.slot);
      const mean = slot?.positive ? slot.sum / slot.positive : snapshot.global_positive_mean;
      const amount = tables.amount.get(k.amount);
      const weight = snapshot.policy.amount_prior;
      const positiveMean =
        ((amount?.sum || 0) + weight * mean) / ((amount?.positive || 0) + weight);
      const value = probability * positiveMean;
      return {
        value,
        used_groups: ['weekday'],
        fallback: false,
        activity: {
          version: VERSION,
          probability,
          conditional_positive_mean: positiveMean,
          expected_value: value,
          known_lags: row.activity?.known_lags || [],
        },
      };
    },
  };
}
module.exports = {
  VERSION,
  POLICY,
  activityFeatures,
  createActivityFeatures,
  fitActivityModel,
  restoreActivityModel,
};
