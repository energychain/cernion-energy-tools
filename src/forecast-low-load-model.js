'use strict';

// Two-part, nonnegative point forecast. Labels are fitted anew on each training
// fold; target actuals are never inputs to the classifier or either amount tree.
const VERSION = 'learned_low_load_v1';
const POLICY = Object.freeze({
  minimum_low_fraction: 0.2,
  minimum_active_fraction: 0.05,
  maximum_threshold_to_q90: 0.1,
  maximum_low_to_active_mean: 0.1,
  max_depth: 4,
  minimum_leaf: 96,
  split_bins: 12,
  probability_prior: 8,
});

function learnLowLoadLabels(rows) {
  if (!rows.length || rows.some((r) => !Number.isFinite(r.value) || r.value < 0))
    throw new Error('Low-load labels require finite nonnegative observations.');
  const values = rows.map((r) => r.value).sort((a, b) => a - b);
  const q90 = values[Math.floor((values.length - 1) * 0.9)];
  const scale = q90 || values.at(-1) || 1;
  const xs = values.map((v) => Math.log1p(v / scale));
  let low = xs[0];
  let high = xs[Math.floor((xs.length - 1) * 0.95)];
  for (let iteration = 0; iteration < 20 && high > low; iteration++) {
    const middle = (low + high) / 2;
    let lowSum = 0,
      lowN = 0,
      highSum = 0,
      highN = 0;
    for (const x of xs) {
      if (x <= middle) {
        lowSum += x;
        lowN++;
      } else {
        highSum += x;
        highN++;
      }
    }
    if (!lowN || !highN) break;
    low = lowSum / lowN;
    high = highSum / highN;
  }
  // This cap prevents a general low/high split being called near-zero demand.
  let threshold = Math.min(
    scale * Math.expm1((low + high) / 2),
    q90 * POLICY.maximum_threshold_to_q90
  );
  const stats = (limit) => {
    let lowN = 0,
      lowSum = 0,
      activeSum = 0;
    for (const value of values) {
      if (value <= limit) {
        lowN++;
        lowSum += value;
      } else activeSum += value;
    }
    return {
      low_count: lowN,
      active_count: values.length - lowN,
      low_mean: lowSum / Math.max(1, lowN),
      active_mean: activeSum / Math.max(1, values.length - lowN),
    };
  };
  let counts = stats(threshold);
  if (counts.low_mean > counts.active_mean * POLICY.maximum_low_to_active_mean) {
    threshold = 0;
    counts = stats(threshold);
  }
  return {
    version: VERSION,
    method: 'training_only_log_two_means_with_near_zero_cap',
    threshold,
    scale,
    ...counts,
    sample_count: values.length,
    low_fraction: counts.low_count / values.length,
    eligible:
      counts.low_count / values.length >= POLICY.minimum_low_fraction &&
      counts.active_count / values.length >= POLICY.minimum_active_fraction,
    definition: 'low_load iff observed value <= threshold; not an equipment state',
  };
}

function lowLoadFeatures(row, labeling) {
  const slot = Number(row.slot.slice(0, 2)) * 4 + Number(row.slot.slice(3)) / 15;
  const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay();
  const activity = row.activity || {};
  const lag = (value) => (Number.isFinite(value) ? value / labeling.scale : -1);
  const label = (value) => (Number.isFinite(value) ? Number(value > labeling.threshold) : -1);
  return [
    slot,
    weekday,
    weekday === 0 || weekday === 6 ? 1 : 0,
    Number(row.date.slice(5, 7)),
    lag(activity.lag2_value),
    lag(activity.lag7_value),
    lag(activity.lag2_day_mean),
    label(activity.lag2_value),
    label(activity.lag7_value),
  ];
}

// Small deterministic histogram CART. Fixed complexity avoids a hyperparameter
// search on the outer test period. Binary SSE is equivalent to Gini splitting.
function fitTree(samples, depth = 0, probability = false, parentMean = null) {
  const n = samples.length;
  if (!n) return { value: parentMean ?? 0, n: 0 };
  const sum = samples.reduce((s, r) => s + r.y, 0);
  const mean = sum / n;
  const prior = probability && parentMean !== null ? POLICY.probability_prior : 0;
  const leaf = { value: (sum + prior * (parentMean ?? mean)) / (n + prior), n };
  if (depth >= POLICY.max_depth || n < 2 * POLICY.minimum_leaf) return leaf;
  let best = null;
  for (let feature = 0; feature < samples[0].x.length; feature++) {
    let min = Infinity,
      max = -Infinity;
    for (const r of samples) {
      min = Math.min(min, r.x[feature]);
      max = Math.max(max, r.x[feature]);
    }
    if (min === max) continue;
    const counts = Array(POLICY.split_bins).fill(0);
    const sums = Array(POLICY.split_bins).fill(0);
    const width = (max - min) / POLICY.split_bins;
    for (const r of samples) {
      const bin = Math.min(POLICY.split_bins - 1, Math.floor((r.x[feature] - min) / width));
      counts[bin]++;
      sums[bin] += r.y;
    }
    let leftN = 0,
      leftSum = 0;
    for (let bin = 0; bin < POLICY.split_bins - 1; bin++) {
      leftN += counts[bin];
      leftSum += sums[bin];
      if (leftN < POLICY.minimum_leaf || n - leftN < POLICY.minimum_leaf) continue;
      const gain = leftSum ** 2 / leftN + (sum - leftSum) ** 2 / (n - leftN) - sum ** 2 / n;
      if (gain > Math.max(1e-12, Math.abs(sum ** 2 / n) * 1e-12) && (!best || gain > best.gain))
        best = { feature, split: min + (bin + 1) * width, gain };
    }
  }
  if (!best) return leaf;
  const left = [],
    right = [];
  for (const r of samples) (r.x[best.feature] < best.split ? left : right).push(r);
  if (left.length < POLICY.minimum_leaf || right.length < POLICY.minimum_leaf) return leaf;
  return {
    feature: best.feature,
    split: best.split,
    left: fitTree(left, depth + 1, probability, mean),
    right: fitTree(right, depth + 1, probability, mean),
  };
}

function treeValue(tree, x) {
  while (tree.feature !== undefined) tree = x[tree.feature] < tree.split ? tree.left : tree.right;
  return tree.value;
}

function fitLowLoadModel(rows, spec) {
  const labeling = learnLowLoadLabels(rows);
  const samples = rows.map((row) => ({ x: lowLoadFeatures(row, labeling), y: row.value }));
  const low = samples.filter((r) => r.y <= labeling.threshold);
  const active = samples.filter((r) => r.y > labeling.threshold);
  const snapshot = {
    kind: VERSION,
    spec,
    policy: POLICY,
    labeling,
    classifier: fitTree(
      samples.map((r) => ({ x: r.x, y: Number(r.y > labeling.threshold) })),
      0,
      true
    ),
    low_amount: fitTree(low),
    active_amount: fitTree(active),
  };
  return {
    snapshot,
    spec,
    sample_count: rows.length,
    weather_coverage: 1,
    coefficients: {},
    identifiable_columns: [],
    calendar_snapshot: null,
    predict: restoreLowLoadModel(snapshot).predict,
  };
}

function restoreLowLoadModel(snapshot) {
  return {
    spec: snapshot.spec,
    predict(row) {
      const x = lowLoadFeatures(row, snapshot.labeling);
      const probability = treeValue(snapshot.classifier, x);
      const lowMean = treeValue(snapshot.low_amount, x);
      const activeMean = treeValue(snapshot.active_amount, x);
      const value = (1 - probability) * lowMean + probability * activeMean;
      return {
        value,
        used_groups: ['weekday'],
        fallback: false,
        activity: {
          version: VERSION,
          probability,
          probability_target: 'value_above_low_load_threshold',
          low_load_probability: 1 - probability,
          predicted_label: probability >= 0.5 ? 'active' : 'low_load',
          low_load_threshold: snapshot.labeling.threshold,
          conditional_low_mean: lowMean,
          conditional_active_mean: activeMean,
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
  learnLowLoadLabels,
  lowLoadFeatures,
  fitLowLoadModel,
  restoreLowLoadModel,
};
