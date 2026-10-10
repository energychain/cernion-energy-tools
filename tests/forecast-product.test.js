'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-product-'));
process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = root;
const r = require('../src/forecast-portfolio-runtime');
const product = require('../src/forecast-product');
const { assertForecastJobAccess } = require('../src/forecast-job-access');
const meta = (tenantId) => ({ tenantId, authUser: { tenantId, authType: 'session' } });
const now = Date.parse('2026-09-26T10:00:00Z');
const dataset = (value = 1) => ({
  series_id: 'same-id',
  unit: 'kWh',
  timezone: 'Europe/Berlin',
  values: [{ timestamp: '2026-09-24T12:00:00Z', value }],
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
test('tenant must be credential-bound; header-only and mismatched claims cannot ingest or train', () => {
  for (const caller of [{}, { tenantId: 'a' }, { tenantId: 'a', authUser: { tenantId: 'b' } }]) {
    expect(() => r.ingest({ dataset: dataset() }, caller, now)).toThrow('credential');
    expect(() =>
      r.taskForTrain({ series_ids: ['same-id'], forecast_for: '2026-09-26' }, caller)
    ).toThrow('credential');
  }
});
test('same series ID is independently owned; single-meter train draws only compatible private references', () => {
  r.ingest({ dataset: dataset(), historical_import: true }, meta('a'), now);
  r.ingest({ dataset: dataset(9), historical_import: true }, meta('b'), now);
  const key = product.contributionKey('b', 'same-id');
  r.atomic(path.join(product.sharedRoot(), 'contributors', key + '.json'), {
    version: '1'.repeat(64),
    unit: 'kWh',
    timezone: 'Europe/Berlin',
  });
  r.atomic(path.join(product.sharedRoot(), 'contributors', '2'.repeat(64) + '.json'), {
    version: '3'.repeat(64),
    unit: 'kW',
    timezone: 'Europe/Berlin',
  });
  const a = r.taskForTrain({ series_ids: ['same-id'], forecast_for: '2026-09-26' }, meta('a'));
  expect(a._product).toBe(true);
  expect(a.series).toHaveLength(1);
  expect(a.series[0].rows[0][1]).toBe(1);
  expect(a.reference_snapshots).toHaveLength(1);
  const b = r.taskForTrain({ series_ids: ['same-id'], forecast_for: '2026-09-26' }, meta('b'));
  expect(b.series[0].rows[0][1]).toBe(9);
  expect(b.reference_snapshots).toHaveLength(0);
});
test('optional-only updates are persisted and late corrections never backdate', () => {
  const input = dataset();
  input.series_id = 'aux';
  const old = r.ingest({ dataset: input, historical_import: true }, meta('a'), now);
  input.values[0].reactive_power_kvar = 0;
  input.profile_label = 'office';
  const updated = r.ingest({ dataset: input }, meta('a'), now + 1000);
  expect(updated.history_version).not.toBe(old.history_version);
  const snapshot = r.history(meta('a'), 'aux').item;
  expect(snapshot.auxiliary_rows[0][1]).toBe(0);
  expect(snapshot.auxiliary_rows[0][2]).toBe(now + 1000);
  expect(snapshot.profile_revisions[0].available_at).toBe(now + 1000);
  input.values[0].reactive_power_kvar = -3;
  expect(() => r.ingest({ dataset: input }, meta('a'), now + 2000)).toThrow('correction');
  r.ingest({ dataset: input, allow_corrections: true }, meta('a'), now + 2000);
  expect(r.history(meta('a'), 'aux').item.auxiliary_rows.at(-1)[2]).toBe(now + 2000);
  expect(r.history(meta('a'), 'aux', old.history_version).item.auxiliary_rows).toBeUndefined();
  expect(() =>
    r.ingest({ dataset: { ...input, value_semantics: 'cumulative' } }, meta('a'), now + 3000)
  ).toThrow('Cumulative');
});
test('model, predict, run and job IDs do not confer access across tenants', () => {
  const version = 'a'.repeat(64);
  const dir = path.join(r.root(meta('a')), 'runs', version);
  const own = require('crypto').createHash('sha256').update('a').digest('hex');
  r.atomic(path.join(dir, 'request.json.gz'), { _product: true, _owner: own });
  r.atomic(path.join(dir, 'result.json'), { status: 'completed' });
  r.atomic(path.join(dir, 'model.json'), {
    strategy: 'shared_baseline',
    engine_sha256: r.sourceHash(),
    owner: own,
    first_day: '2026-09-26',
    identities: { 'same-id': { unit: 'kWh', timezone: 'Europe/Berlin' } },
  });
  expect(() => r.model(meta('b'), version)).toThrow('unavailable');
  expect(() =>
    r.taskForPredict(
      { series_id: 'same-id', model_version: version, forecast_for: '2026-09-26' },
      meta('b')
    )
  ).toThrow('unavailable');
  expect(() => r.status({ meta: meta('b'), params: { run_id: version } })).toThrow('unavailable');
  expect(() => r.model({ tenantId: 'a' }, version)).toThrow('credential');
  const job = { service: 'forecast-sandbox', action: 'productForecast', tenantId: 'a' };
  expect(() => assertForecastJobAccess({ meta: meta('a') }, job)).not.toThrow();
  expect(() => assertForecastJobAccess({ meta: meta('b') }, job)).toThrow('not found');
  expect(() => assertForecastJobAccess({ meta: { tenantId: 'a' } }, job)).toThrow('not found');
});
