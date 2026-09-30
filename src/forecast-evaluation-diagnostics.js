'use strict';

// Descriptive evaluation only. These full-dataset statistics never enter the model.
function diagnosePatterns(rows) {
  const daily = new Map();
  const weekday = new Map();
  const slots = new Map();
  const months = new Map();
  function accumulate(map, key, value) {
    if (!map.has(key)) map.set(key, { sum: 0, n: 0 });
    const item = map.get(key);
    item.sum += value;
    item.n++;
  }
  for (const row of rows) {
    accumulate(daily, row.date, row.value);
    accumulate(weekday, row.weekday, row.value);
    accumulate(slots, row.slot, row.value);
    accumulate(months, row.date.slice(5, 7), row.value);
  }
  function means(map) {
    return Object.fromEntries([...map.entries()].map(([key, value]) => [key, value.sum / value.n]));
  }
  function spread(map) {
    const values = Object.values(means(map));
    if (values.length < 2) return null;
    const scale = values.reduce((s, value) => s + Math.abs(value), 0) / values.length;
    return scale ? (Math.max(...values) - Math.min(...values)) / scale : 0;
  }
  const days = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
  const recent = days.slice(-28);
  const preceding = days.slice(-56, -28);
  const average = (items) => items.reduce((s, [, v]) => s + v.sum / v.n, 0) / items.length;
  const previous = preceding.length === 28 ? average(preceding) : null;
  const change =
    previous !== null && previous !== 0 ? (average(recent) - previous) / Math.abs(previous) : null;
  return {
    scope: 'full_dataset_descriptive_only_not_training_features',
    observed_days: daily.size,
    weekday_mean_values: means(weekday),
    monthly_mean_values: means(months),
    daily_pattern_relative_spread: spread(slots),
    weekly_pattern_relative_spread: spread(weekday),
    seasonal_relative_spread: spread(months),
    structural_change: {
      method: 'last_28_observed_days_vs_previous_28',
      relative_change: change,
      suspected: change === null ? null : Math.abs(change) > 0.3,
    },
    interpretation:
      'Descriptive indicators, not causal or statistical significance tests. Gaps, seasonality and holiday composition can explain changes.',
  };
}
module.exports = { diagnosePatterns };
