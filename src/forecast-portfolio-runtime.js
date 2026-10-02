'use strict';

const { compareCanonicalStrings } = require('./canonical-order');
const product = require('./forecast-product');
const { normalizeMethod } = require('./forecast-portfolio-contract');
const fs = require('fs');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { gzipSync, gunzipSync, createGunzip } = require('zlib');
const { prepareDataset, EvaluationError } = require('./forecast-evaluation');
const { clock, dateOnly, shiftDate, forecastOrigin } = require('./forecast-evaluation-time');
const { loadPortfolioDatasets } = require('./forecast-portfolio-store');
const jobs = require('./job-store');
const hash = (x) => createHash('sha256').update(x).digest('hex');
const check = (ok, message) => {
  if (!ok) throw new EvaluationError('portfolio_invalid', message);
};
const canonical = (x) =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort(compareCanonicalStrings)
            .map((k) => [k, v[k]])
        )
      : v
  );
function root(meta = {}) {
  return path.join(
    process.env.FORECAST_PORTFOLIO_RUNTIME_PATH ||
      path.join(__dirname, '../data/forecast-portfolio-runtime'),
    hash(String(meta.tenantId || 'default'))
  );
}
function identifier(value) {
  check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'Invalid version/run ID');
  return value;
}
function read(file) {
  return JSON.parse(
    file.endsWith('.gz') ? gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file, 'utf8')
  );
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  const bytes = Buffer.from(JSON.stringify(value));
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, file.endsWith('.gz') ? gzipSync(bytes) : bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
function sourceHash() {
  return hash(
    Buffer.concat(
      [
        'engine.py',
        'persistence.py',
        'runtime.py',
        'contracts.py',
        'regimes.py',
        'product.py',
        'starter.py',
      ].map((name) => fs.readFileSync(path.join(__dirname, '../tools/forecast-portfolio', name)))
    )
  );
}
function history(meta, seriesId, version) {
  check(typeof seriesId === 'string' && seriesId.length > 0, 'series_id required');
  const dir = path.join(root(meta), 'history', hash(seriesId));
  const ref =
    version ||
    (fs.existsSync(path.join(dir, 'current.json'))
      ? read(path.join(dir, 'current.json')).version
      : null);
  check(ref, 'No history for this tenant/series; import history explicitly');
  const file = path.join(dir, identifier(ref) + '.json.gz');
  check(fs.existsSync(file), 'History version unavailable');
  const item = read(file);
  check(hash(canonical(item)) === ref, 'History checksum mismatch');
  return { item, version: ref };
}
function ingest(params, meta = {}, now = Date.now()) {
  product.tenant(meta);
  let dataset = params.dataset;
  if (params.dataset_id) {
    // The immutable upload loader deliberately requires a portfolio. Read one through
    // its tenant-scoped storage convention without changing the existing contract.
    const dir = path.join(
      process.env.FORECAST_PORTFOLIO_DATA_PATH ||
        path.join(__dirname, '../data/forecast-portfolio'),
      hash(String(meta.tenantId || 'sandbox'))
    );
    const bytes = gunzipSync(
      fs.readFileSync(path.join(dir, identifier(params.dataset_id) + '.json.gz'))
    );
    check(hash(bytes) === params.dataset_id, 'Dataset checksum mismatch');
    dataset = JSON.parse(bytes);
  }
  check(dataset && typeof dataset.series_id === 'string', 'dataset with series_id required');
  const time = clock(dataset.timezone);
  const dates = (dataset.values || [])
    .map((r) => Date.parse(r[dataset.field_mapping?.timestamp || 'timestamp']))
    .filter(Number.isFinite)
    .map((ms) => time.parts(ms).date)
    .sort();
  dataset = {
    ...dataset,
    period_from: dataset.period_from || dates[0],
    period_until: dataset.period_until || dates.at(-1),
  };
  const p = prepareDataset(dataset, { live: true });
  check(
    p.validation.validation_status !== 'fail' && !p.rows.some((r) => r.value < 0),
    'Invalid nonnegative PT15M history'
  );
  const dir = path.join(root(meta), 'history', hash(dataset.series_id));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, 'write.lock');
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') alive = false;
    }
    check(!alive, 'Concurrent history update; retry later');
    fs.unlinkSync(lock);
  }
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, String(process.pid));
  fs.closeSync(fd);
  try {
    const exists = fs.existsSync(path.join(dir, 'current.json'));
    const old = exists ? history(meta, dataset.series_id) : null;
    check(
      !old || (old.item.unit === dataset.unit && old.item.timezone === dataset.timezone),
      'History unit/timezone mismatch'
    );
    check(
      !params.historical_import || !old,
      'historical_import is allowed only for initial history'
    );
    const item = old
      ? old.item
      : {
          series_id: dataset.series_id,
          unit: dataset.unit,
          timezone: dataset.timezone,
          validation: p.validation,
          rows: [],
          availability_policy: params.historical_import
            ? 'declared_or_assumed_next_midnight'
            : 'received_at_or_later',
        };
    const latest = new Map();
    for (const row of item.rows) latest.set(row[0], row);
    let added = 0,
      corrections = 0;
    for (const r of p.rows) {
      check(r.ms <= now, 'Future measurements are not accepted');
      const prev = latest.get(r.ms);
      if (prev && prev[1] === r.value) continue;
      check(
        !prev || params.allow_corrections === true,
        'Conflicting measurement; set allow_corrections explicitly'
      );
      const floor = p.time.midnight(shiftDate(r.date, 1));
      const available = Math.max(
        floor,
        r.available ?? (params.historical_import ? floor : now),
        prev ? now : params.historical_import ? -Infinity : now
      );
      check(!prev || available >= prev[2], 'Correction availability cannot precede prior version');
      const row = [r.ms, r.value, available, now];
      item.rows.push(row);
      latest.set(r.ms, row);
      if (prev) corrections++;
      else added++;
    }
    const optionalChanged = product.mergeOptional(item, dataset, params, now, p.time);
    if (!added && !corrections && !optionalChanged && old)
      return {
        status: 'unchanged',
        series_id: dataset.series_id,
        history_version: old.version,
        added,
        corrections,
      };
    item.rows.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[3] - b[3]);
    const version = hash(canonical(item));
    atomic(path.join(dir, version + '.json.gz'), item);
    atomic(path.join(dir, 'current.json'), { version });
    return {
      status: 'stored',
      series_id: dataset.series_id,
      history_version: version,
      added,
      corrections,
    };
  } finally {
    fs.unlinkSync(lock);
  }
}
function assertOrigin(day, timezone) {
  check(dateOnly(day), 'forecast_for must be a local date');
  const origin = forecastOrigin(clock(timezone), day, { issue_time: '07:00' });
  check(origin <= Date.now(), 'Requested 07:00 information origin is still in the future');
  return origin;
}
function taskForTrain(params, meta) {
  product.tenant(meta);
  check(
    !params.strategy || ['portfolio', 'shared_baseline'].includes(params.strategy),
    'Invalid strategy'
  );
  if (
    params.strategy === 'shared_baseline' ||
    (!params.strategy && params.series_ids?.length === 1)
  ) {
    check(
      !params.portfolio_method,
      'shared_baseline has its own fixed D-3 training contract; omit portfolio_method'
    );
    const task = product.trainTask(params, meta, module.exports);
    assertOrigin(params.forecast_for, task.series[0].timezone);
    return task;
  }
  check(
    Array.isArray(params.series_ids) &&
      params.series_ids.length >= 2 &&
      params.series_ids.length <= 16 &&
      new Set(params.series_ids).size === params.series_ids.length,
    'Supply 2–16 unique series_ids'
  );
  const entries = params.series_ids.map((id) => history(meta, id));
  check(
    new Set(entries.map((x) => x.item.unit + ':' + x.item.timezone)).size === 1,
    'Portfolio requires common unit/timezone'
  );
  assertOrigin(params.forecast_for, entries[0].item.timezone);
  return {
    _operation: 'train',
    portfolio_method: normalizeMethod(params.portfolio_method),
    forecast_for: params.forecast_for,
    series: entries.map((x) => x.item),
    history_versions: Object.fromEntries(entries.map((x) => [x.item.series_id, x.version])),
  };
}
function model(meta, version) {
  product.tenant(meta);
  const dir = path.join(root(meta), 'runs', identifier(version));
  check(
    fs.existsSync(path.join(dir, 'result.json')) && fs.existsSync(path.join(dir, 'model.json')),
    'Model version not complete or unavailable for tenant'
  );
  const m = read(path.join(dir, 'model.json'));
  check(!m.owner || m.owner === hash(product.tenant(meta)), 'Model unavailable for tenant');
  check(m.engine_sha256 === sourceHash(), 'Model code changed; explicit retraining required');
  return { dir, model: m };
}
function taskForPredict(params, meta) {
  const artifact = model(meta, params.model_version);
  check(artifact.model.identities[params.series_id], 'Series is not a member of model');
  const id = artifact.model.identities[params.series_id];
  assertOrigin(params.forecast_for, id.timezone);
  check(
    params.forecast_for >= artifact.model.first_day,
    'Model information origin is after target origin'
  );
  check(
    !params.recent_dataset || !params.history_version,
    'Do not combine new measurements and a pinned historical snapshot'
  );
  if (params.recent_dataset) {
    check(
      !params.recent_dataset.series_id || params.recent_dataset.series_id === params.series_id,
      'Recent dataset series mismatch'
    );
    ingest(
      {
        dataset: { ...params.recent_dataset, series_id: params.series_id },
        allow_corrections: params.allow_corrections,
      },
      meta
    );
  }
  const entry = history(meta, params.series_id, params.history_version);
  return {
    _operation: 'predict',
    ...(artifact.model.strategy === 'shared_baseline'
      ? { _product: true, _owner: hash(product.tenant(meta)) }
      : {}),
    portfolio_method: normalizeMethod(artifact.model.benchmark_contract),
    forecast_for: params.forecast_for,
    model_version: params.model_version,
    _artifact_dir: artifact.dir,
    allow_stale_model: params.allow_stale_model === true,
    series: [entry.item],
    history_versions: { [params.series_id]: entry.version },
  };
}
function directory(meta, id) {
  const dir = path.join(root(meta), 'runs', identifier(id));
  check(fs.existsSync(path.join(dir, 'request.json.gz')), 'Run unavailable for this tenant');
  const task = read(path.join(dir, 'request.json.gz'));
  if (task._operation === 'train' || task._operation === 'predict') product.tenant(meta);
  if (task._product)
    check(task._owner === hash(product.tenant(meta)), 'Run unavailable for tenant');
  return dir;
}
function decorate(result, id) {
  if (!result.result_manifest) return result;
  return {
    ...result,
    result_manifest: result.result_manifest.map((v) => ({
      ...v,
      url: `/api/forecast-sandbox/consumption/portfolio/runs/${id}/series/${hash(v.series_id)}`,
    })),
  };
}
async function launch(ctx, id) {
  const dir = directory(ctx.meta, id);
  const task = read(path.join(dir, 'request.json.gz'));
  check(task._source === sourceHash(), 'Resume rejected: engine code changed');
  if (fs.existsSync(path.join(dir, 'result.json')))
    return decorate(read(path.join(dir, 'result.json')), id);
  const descriptor = await jobs.startJob(
    ctx,
    {
      service: 'forecast-sandbox',
      action: ['train', 'predict'].includes(task._operation) ? 'productForecast' : 'runEvaluation',
    },
    async (jobId) => {
      const { executeForecast } = require('./forecast-evaluation-jobs');
      return decorate(
        await executeForecast({}, ctx.meta, jobId, {
          portfolioTask: { ...task, _workspace: dir, _identity: id },
        }),
        id
      );
    },
    { idempotencyKey: hash(String(ctx.meta?.tenantId || 'default') + ':' + id) }
  );
  return { ...descriptor, run_id: id };
}
function begin(ctx, task) {
  task = { ...task, _source: sourceHash(), _transport_version: 2 };
  const id = hash(canonical(task));
  const dir = path.join(root(ctx.meta), 'runs', id);
  if (!fs.existsSync(path.join(dir, 'request.json.gz')))
    atomic(path.join(dir, 'request.json.gz'), task);
  return launch(ctx, id);
}
function backtest(ctx) {
  const p = ctx.params;
  const prepared = require('./forecast-portfolio').preparePortfolio({
    ...p,
    datasets: loadPortfolioDatasets(p.dataset_ids, ctx.meta),
  });
  return begin(ctx, prepared);
}
function status(ctx) {
  const dir = directory(ctx.meta, ctx.params.run_id);
  const complete = fs.existsSync(path.join(dir, 'result.json'));
  const blocks = fs.existsSync(path.join(dir, 'blocks'))
    ? fs.readdirSync(path.join(dir, 'blocks')).filter((n) => n.endsWith('.json')).length
    : 0;
  return {
    run_id: ctx.params.run_id,
    status: complete ? 'completed' : 'resumable',
    completed_blocks: blocks,
    ...(complete
      ? { result: decorate(read(path.join(dir, 'result.json')), ctx.params.run_id) }
      : {}),
  };
}
function resultSeries(ctx) {
  const dir = directory(ctx.meta, ctx.params.run_id);
  check(fs.existsSync(path.join(dir, 'result.json')), 'Result is not complete');
  const manifest = read(path.join(dir, 'result.json'));
  const item = manifest.result_manifest?.find((v) => hash(v.series_id) === ctx.params.series_key);
  check(item, 'Series result unavailable');
  const file = path.join(dir, 'results', item.file);
  check(hash(fs.readFileSync(file)) === item.sha256, 'Result checksum mismatch');
  ctx.meta.$responseType = 'application/json';
  const source = fs.createReadStream(file);
  const stream = createGunzip();
  source.on('error', (error) => stream.destroy(error));
  stream.on('close', () => source.destroy());
  return source.pipe(stream);
}
module.exports = {
  root,
  history,
  ingest,
  taskForTrain,
  taskForPredict,
  model,
  begin,
  backtest,
  launch,
  status,
  resultSeries,
  sourceHash,
  canonical,
  atomic,
  read,
};
