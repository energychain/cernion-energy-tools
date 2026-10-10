'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-runtime-'));
process.env.FORECAST_PORTFOLIO_RUNTIME_PATH = root;
const r = require('../src/forecast-portfolio-runtime');
const now = Date.parse('2026-09-26T10:00:00Z');
const sample = (value = 1) => ({
  series_id: 'meter-a',
  unit: 'kWh',
  timezone: 'Europe/Berlin',
  values: [{ timestamp: '2026-09-24T12:00:00Z', value }],
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
test('history accepts deltas without period, deduplicates, versions corrections and isolates tenants', () => {
  const a = r.ingest(
    { dataset: sample(), historical_import: true },
    { tenantId: 'a', authUser: { tenantId: 'a' } },
    now
  );
  expect(a.added).toBe(1);
  expect(
    r.ingest({ dataset: sample() }, { tenantId: 'a', authUser: { tenantId: 'a' } }, now + 1)
      .history_version
  ).toBe(a.history_version);
  expect(() =>
    r.ingest({ dataset: sample(2) }, { tenantId: 'a', authUser: { tenantId: 'a' } }, now)
  ).toThrow('allow_corrections');
  const b = r.ingest(
    { dataset: sample(2), allow_corrections: true },
    { tenantId: 'a', authUser: { tenantId: 'a' } },
    now
  );
  const old = r.history(
    { tenantId: 'a', authUser: { tenantId: 'a' } },
    'meter-a',
    a.history_version
  );
  const current = r.history({ tenantId: 'a', authUser: { tenantId: 'a' } }, 'meter-a');
  expect(old.item.rows).toHaveLength(1);
  expect(current.item.rows).toHaveLength(2);
  expect(current.item.rows[1][2]).toBe(now);
  expect(b.corrections).toBe(1);
  expect(() =>
    r.history({ tenantId: 'b', authUser: { tenantId: 'b' } }, 'meter-a', a.history_version)
  ).toThrow('unavailable');
  expect(() =>
    r.ingest(
      { dataset: { ...sample(), unit: 'kW' } },
      { tenantId: 'a', authUser: { tenantId: 'a' } },
      now
    )
  ).toThrow('mismatch');
});
test('ordinary live delivery is never backdated; initial history import is explicit', () => {
  const a = r.ingest(
    { dataset: sample() },
    { tenantId: 'live', authUser: { tenantId: 'live' } },
    now
  );
  expect(
    r.history({ tenantId: 'live', authUser: { tenantId: 'live' } }, 'meter-a', a.history_version)
      .item.rows[0][2]
  ).toBe(now);
  expect(() =>
    r.ingest(
      { dataset: sample(), historical_import: true },
      { tenantId: 'live', authUser: { tenantId: 'live' } },
      now
    )
  ).toThrow('initial');
  const d = sample();
  d.values[0].timestamp = '2027-01-01T00:00:00Z';
  expect(() =>
    r.ingest({ dataset: d }, { tenantId: 'future', authUser: { tenantId: 'future' } }, now)
  ).toThrow('Future');
});
test('artifact lookup and resume cannot traverse another tenant or directories', () => {
  expect(() => r.model({ tenantId: 'a', authUser: { tenantId: 'a' } }, '../other')).toThrow(
    'Invalid'
  );
  expect(() => r.model({ tenantId: 'a', authUser: { tenantId: 'a' } }, 'a'.repeat(64))).toThrow(
    'unavailable'
  );
  expect(() =>
    r.status({
      meta: { tenantId: 'b', authUser: { tenantId: 'b' } },
      params: { run_id: 'a'.repeat(64) },
    })
  ).toThrow('unavailable');
});
test('history metadata rejects shifted availability and preserves explicit gaps', () => {
  const data = sample();
  data.series_id = 'gaps';
  data.values.push({ timestamp: '2026-09-24T12:30:00Z', value: 0 });
  const saved = r.ingest(
    { dataset: data, historical_import: true },
    { tenantId: 'gaps', authUser: { tenantId: 'gaps' } },
    now
  );
  expect(
    r.history({ tenantId: 'gaps', authUser: { tenantId: 'gaps' } }, 'gaps', saved.history_version)
      .item.rows
  ).toHaveLength(2);
  const changed = {
    ...data,
    values: [
      { timestamp: data.values[0].timestamp, value: 2, available_at: '2026-09-24T12:00:00Z' },
    ],
  };
  r.ingest(
    { dataset: changed, allow_corrections: true },
    { tenantId: 'gaps', authUser: { tenantId: 'gaps' } },
    now
  );
  expect(
    r
      .history({ tenantId: 'gaps', authUser: { tenantId: 'gaps' } }, 'gaps')
      .item.rows.find((v) => v[1] === 2)[2]
  ).toBe(now);
});
test('per-series endpoint streams verified JSON and rejects corrupt result files', async () => {
  const { createHash } = require('crypto');
  const { gzipSync } = require('zlib');
  const sha = (x) => createHash('sha256').update(x).digest('hex');
  const runId = 'b'.repeat(64),
    key = sha('stream-series');
  const meta = { tenantId: 'stream', authUser: { tenantId: 'stream' } };
  const dir = path.join(r.root(meta), 'runs', runId);
  r.atomic(path.join(dir, 'request.json.gz'), {});
  fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
  const bytes = gzipSync(JSON.stringify({ forecast_values: [{ predicted_value: 1 }] }));
  fs.writeFileSync(path.join(dir, 'results', 'result.json.gz'), bytes);
  r.atomic(path.join(dir, 'result.json'), {
    result_manifest: [{ series_id: 'stream-series', file: 'result.json.gz', sha256: sha(bytes) }],
  });
  const ctx = { meta, params: { run_id: runId, series_key: key } };
  let result = '';
  for await (const chunk of r.resultSeries(ctx)) result += chunk;
  expect(JSON.parse(result).forecast_values[0].predicted_value).toBe(1);
  fs.writeFileSync(path.join(dir, 'results', 'result.json.gz'), 'corrupt');
  expect(() => r.resultSeries(ctx)).toThrow('checksum');
});
