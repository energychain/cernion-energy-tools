'use strict';
// Internal product orchestration. Shared evidence has no public read endpoint.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { EvaluationError } = require('./forecast-evaluation');
const sha = (v) => createHash('sha256').update(v).digest('hex');
function tenant(meta = {}) {
  const authenticated = meta.authUser?.tenantId || meta.apiToken?.tenantId;
  if (!authenticated || authenticated !== meta.tenantId) {
    throw new EvaluationError(
      'tenant_auth_required',
      'A credential bound to the tenant is required'
    );
  }
  return String(authenticated);
}
function sharedRoot() {
  return path.join(
    process.env.FORECAST_PORTFOLIO_RUNTIME_PATH ||
      path.join(__dirname, '../data/forecast-portfolio-runtime'),
    '_shared-baseline'
  );
}
function contributionKey(tenantId, seriesId) {
  return sha(JSON.stringify([tenantId, seriesId]));
}
function trainTask(params, meta, runtime) {
  const owner = tenant(meta);
  const ids = params.series_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 16 || new Set(ids).size !== ids.length) {
    throw new EvaluationError('portfolio_invalid', 'Supply 1–16 unique series_ids');
  }
  const entries = ids.map((id) => runtime.history(meta, id));
  if (new Set(entries.map((e) => e.item.unit + ':' + e.item.timezone)).size !== 1) {
    throw new EvaluationError('portfolio_invalid', 'Portfolio requires common unit/timezone');
  }
  const ownKeys = entries.map((e) => contributionKey(owner, e.item.series_id));
  const refs = [];
  const dir = path.join(sharedRoot(), 'contributors');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (!/^[a-f0-9]{64}\.json$/.test(name) || ownKeys.includes(name.slice(0, -5))) continue;
      const ref = runtime.read(path.join(dir, name));
      if (ref.unit === entries[0].item.unit && ref.timezone === entries[0].item.timezone) {
        refs.push(ref);
      }
    }
  }
  return {
    _operation: 'train',
    _starter: require('./forecast-starter').candidate(),
    _product: true,
    _owner: sha(owner),
    _shared_root: sharedRoot(),
    reference_snapshots: refs,
    contribution_keys: Object.fromEntries(entries.map((e, i) => [e.item.series_id, ownKeys[i]])),
    forecast_for: params.forecast_for,
    series: entries.map((e) => e.item),
    history_versions: Object.fromEntries(entries.map((e) => [e.item.series_id, e.version])),
    portfolio_method: {
      latest_measurement_lag: 3,
      feature_profile: 'e2_v1',
      selection_objective: 'mae',
      candidate_set: 'extended',
      training_mode: 'rolling',
    },
  };
}
function mergeOptional(item, dataset, params, now, time) {
  if (
    dataset.value_semantics &&
    !['interval_energy', 'average_power'].includes(dataset.value_semantics)
  ) {
    throw new EvaluationError(
      'portfolio_invalid',
      'Cumulative register readings must first be converted to interval energy'
    );
  }
  if (
    (dataset.value_semantics === 'interval_energy' && dataset.unit !== 'kWh') ||
    (dataset.value_semantics === 'average_power' && dataset.unit !== 'kW')
  ) {
    throw new EvaluationError('portfolio_invalid', 'value_semantics does not match unit');
  }
  let changed = false;
  for (const value of dataset.values || []) {
    if (!Object.hasOwn(value, 'reactive_power_kvar')) continue;
    const q = value.reactive_power_kvar;
    if (q !== null && (typeof q !== 'number' || !Number.isFinite(q))) {
      throw new EvaluationError('portfolio_invalid', 'reactive_power_kvar must be finite or null');
    }
    const ms = Date.parse(value[dataset.field_mapping?.timestamp || 'timestamp']);
    if (!Number.isFinite(ms) || ms > now || ms % 900000 !== 0) {
      throw new EvaluationError('portfolio_invalid', 'Invalid auxiliary timestamp');
    }
    item.auxiliary_rows ||= [];
    const old = item.auxiliary_rows.filter((r) => r[0] === ms).at(-1);
    if (old && old[1] === q) continue;
    if (old && !params.allow_corrections) {
      throw new EvaluationError(
        'portfolio_invalid',
        'Auxiliary correction requires allow_corrections'
      );
    }
    const date = time.parts(ms).date;
    const next = require('./forecast-evaluation-time').shiftDate(date, 1);
    const floor = time.midnight(next);
    const declared = value.available_at === undefined ? floor : Date.parse(value.available_at);
    if (!Number.isFinite(declared))
      throw new EvaluationError('portfolio_invalid', 'Invalid available_at');
    const available = Math.max(floor, declared, old || !params.historical_import ? now : floor);
    item.auxiliary_rows.push([ms, q, available, now]);
    changed = true;
  }
  if (dataset.profile_label !== undefined) {
    const label = dataset.profile_label;
    if (typeof label !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(label)) {
      throw new EvaluationError(
        'portfolio_invalid',
        'profile_label must be a short category, not free text'
      );
    }
    item.profile_revisions ||= [];
    if (item.profile_revisions.at(-1)?.label !== label) {
      const supplied =
        dataset.profile_available_at === undefined ? now : Date.parse(dataset.profile_available_at);
      if (!Number.isFinite(supplied) || supplied > now)
        throw new EvaluationError('portfolio_invalid', 'Invalid profile_available_at');
      item.profile_revisions.push({
        label,
        available_at: params.historical_import ? supplied : Math.max(now, supplied),
      });
      changed = true;
    }
  }
  return changed;
}
module.exports = { tenant, sharedRoot, contributionKey, trainTask, mergeOptional };
