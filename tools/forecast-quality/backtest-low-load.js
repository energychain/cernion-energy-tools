'use strict';

// Local production-engine experiment, not replay and not an HTTP API test.
// Compare policies on identical actuals. Never tune against the user target table.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { gunzipSync, gzipSync } = require('zlib');
const { runEvaluation } = require('../../src/forecast-evaluation');
const { VERSION } = require('../../src/forecast-low-load-model');
const baseline = require('./user-baseline-2026-09-26.json');

function metrics(values) {
  if (!values.length) return null;
  let square = 0,
    absolute = 0,
    actual = 0,
    bias = 0;
  for (const v of values) {
    const error = v.predicted_value - v.actual_value;
    square += error ** 2;
    absolute += Math.abs(error);
    actual += Math.abs(v.actual_value);
    bias += error;
  }
  return {
    n: values.length,
    rmse: Math.sqrt(square / values.length),
    mae: absolute / values.length,
    wape_percent: actual ? (100 * absolute) / actual : null,
    bias: bias / values.length,
    mean_absolute_actual: actual / values.length,
  };
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--archive', '--out', '--from', '--until', '--profiles'].includes(args[i]) ||
      !args[i + 1]
    )
      throw new Error(
        'Usage: node tools/forecast-quality/backtest-low-load.js --archive DIR --out NEW_DIR --from YYYY-MM-DD --until YYYY-MM-DD [--profiles 1,3,5]'
      );
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.archive || !options.out || !options.from || !options.until)
    throw new Error('archive, out, from and until required');
  fs.mkdirSync(options.out); // Refuse to overwrite evidence.
  const archiveReport = JSON.parse(fs.readFileSync(path.join(options.archive, 'report.json')));
  const profiles = (options.profiles || '1,2,3,4,5,6,7,8,9,10,11').split(',').map(Number);
  const configuration = {
    mode: 'rolling_day_ahead',
    relationship_mode: 'auto',
    model_family: 'relationship',
    selection_policy: 'adaptive_rmse_v1',
    selection_metric: 'rmse',
    activity_model: true,
    feature_set: ['history', 'calendar'],
    issue_time: '18:00',
    forecast_period_from: options.from,
    forecast_period_until: options.until,
  };
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const sourceHashes = Object.fromEntries(
    fs
      .readdirSync(path.resolve(__dirname, '../../src'))
      .filter((f) => f.startsWith('forecast-') && f.endsWith('.js'))
      .map((f) => [f, digest(fs.readFileSync(path.resolve(__dirname, '../../src', f)))])
  );
  const report = {
    execution: 'local_production_engine',
    status: 'running',
    configuration,
    candidate_override: { activity_labeling: VERSION },
    from: options.from,
    until: options.until,
    user_baseline_comparable: false,
    user_baseline_reason: baseline.comparison_status,
    limitation:
      'Development evidence on previously inspected profiles; calendar/history-only policy, without hybrid state correction or weather/context. No superiority claim versus supplied E2 table.',
    source_hashes: sourceHashes,
    files: [],
  };
  const save = () =>
    fs.writeFileSync(path.join(options.out, 'report.json'), JSON.stringify(report, null, 2));
  save();
  for (const number of profiles) {
    const prefix = String(number).padStart(3, '0');
    const input = fs.readFileSync(path.join(options.archive, `${prefix}-forecast.request.json.gz`));
    const payload = JSON.parse(gunzipSync(input));
    const entry = archiveReport.files.find((f) => f.file.startsWith(`${number}_`));
    const result = {
      file: entry.file,
      input_sha256: entry.sha256,
      request_sha256: digest(input),
      unit: payload.datasets[0].unit,
    };
    const curves = {};
    for (const variant of ['reference', 'labeled']) {
      process.stdout.write(`${prefix} ${variant} ${new Date().toISOString()}\n`);
      const evaluated = runEvaluation({
        datasets: payload.datasets,
        payload_fit_confirmed: true,
        configuration: {
          ...configuration,
          ...(variant === 'labeled' ? { activity_labeling: VERSION } : {}),
        },
      }).results[0];
      curves[variant] = evaluated.forecast_values;
      fs.writeFileSync(
        path.join(options.out, `${prefix}-${variant}.json.gz`),
        gzipSync(JSON.stringify(evaluated))
      );
      result[variant] = {
        metrics: metrics(evaluated.forecast_values),
        zero_intervals: metrics(evaluated.forecast_values.filter((v) => v.actual_value === 0)),
        positive_intervals: metrics(evaluated.forecast_values.filter((v) => v.actual_value > 0)),
        labeled_intervals: evaluated.forecast_values.filter(
          (v) => v.activity_model?.version === VERSION
        ).length,
      };
      const active = evaluated.forecast_values.filter((v) => v.activity_model?.version === VERSION);
      if (active.length) {
        result[variant].low_intervals = metrics(
          active.filter((v) => v.actual_value <= v.activity_model.low_load_threshold)
        );
        result[variant].active_intervals = metrics(
          active.filter((v) => v.actual_value > v.activity_model.low_load_threshold)
        );
        result[variant].brier_score =
          active.reduce(
            (s, v) =>
              s +
              (v.activity_model.probability -
                Number(v.actual_value > v.activity_model.low_load_threshold)) **
                2,
            0
          ) / active.length;
      }
    }
    if (
      curves.reference.length !== curves.labeled.length ||
      curves.reference.some(
        (v, i) =>
          v.timestamp !== curves.labeled[i].timestamp ||
          v.actual_value !== curves.labeled[i].actual_value
      )
    )
      throw new Error('Reference/candidate actuals differ');
    const naive = curves.labeled.map((v) => ({ ...v, predicted_value: 0 }));
    result.zero_baseline = metrics(naive);
    const past = new Map(payload.datasets[0].values.map((v) => [Date.parse(v.timestamp), v]));
    const {
      clock,
      shiftDate,
      STEP,
      forecastOrigin,
    } = require('../../src/forecast-evaluation-time');
    const time = clock(payload.datasets[0].timezone);
    // Same local weekday/slot, preserving physical slot count at DST. Missing
    // slots remain missing and their coverage is reported, never filled with zero.
    const seasonal = [];
    for (const v of curves.labeled) {
      const target = time.parts(Date.parse(v.timestamp));
      const date = shiftDate(target.date, -7);
      const issue = forecastOrigin(time, target.date, configuration);
      const matches = [];
      for (let ms = time.midnight(date); ms < time.midnight(shiftDate(date, 1)); ms += STEP) {
        const r = past.get(ms);
        if (
          time.parts(ms).slot === target.slot &&
          r &&
          Number.isFinite(r.value) &&
          Math.max(time.midnight(shiftDate(date, 1)), Date.parse(r.available_at || '1970-01-01')) <=
            issue
        )
          matches.push(r.value);
      }
      if (matches.length)
        seasonal.push({
          ...v,
          predicted_value: matches.reduce((a, b) => a + b, 0) / matches.length,
        });
    }
    result.weekly_baseline = {
      metrics: metrics(seasonal),
      coverage: seasonal.length / naive.length,
    };
    result.improvement_percent = Object.fromEntries(
      ['rmse', 'mae', 'wape_percent'].map((key) => [
        key,
        result.reference.metrics[key]
          ? 100 * (1 - result.labeled.metrics[key] / result.reference.metrics[key])
          : null,
      ])
    );
    result.user_target = baseline.series.find((f) => f.file === result.file);
    report.files.push(result);
    save();
  }
  report.status = 'completed';
  save();
  const lines = [
    '# Niedriglast-Labeling: gepaarter Entwicklungstest',
    '',
    report.limitation,
    '',
    `Zeitraum: ${options.from} bis ${options.until}. Ausführung: ${report.execution}.`,
    '',
    '| Datei | RMSE vorher | RMSE Labeling | MAE vorher | MAE Labeling | WAPE vorher | WAPE Labeling | Label-Modell Intervalle |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const f of report.files) {
    const r = f.reference.metrics,
      c = f.labeled.metrics;
    lines.push(
      `| ${f.file} | ${r.rmse.toFixed(6)} | ${c.rmse.toFixed(6)} | ${r.mae.toFixed(6)} | ${c.mae.toFixed(6)} | ${r.wape_percent?.toFixed(3) ?? '—'} | ${c.wape_percent?.toFixed(3) ?? '—'} | ${f.labeled.labeled_intervals} |`
    );
  }
  fs.writeFileSync(path.join(options.out, 'report.md'), lines.join('\n') + '\n');
}

if (require.main === module) main();
module.exports = { metrics };
