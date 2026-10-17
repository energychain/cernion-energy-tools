'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DatasetSqlitePool = require('../src/dataset-sqlite-pool');
const { profileRows } = require('../src/tabular-intelligence');
const {
  variantDifference,
  compareDatasetResults,
  expandVariantCandidates,
} = require('../src/dataset-variants');
let pool, dir, serial;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-variant-'));
  pool = new DatasetSqlitePool(dir);
  serial = 0;
});
afterEach(() => {
  pool.closeAll();
  fs.rmSync(dir, { recursive: true, force: true });
});
function store(rows, sheet = 'a') {
  const id = 'ds_' + String(++serial).padStart(32, '0');
  const profile = profileRows(rows);
  const record = {
    id,
    tenantId: 'synthetic',
    sheet,
    columns: profile.columns,
    rowCount: rows.length,
    title: sheet,
    profile,
    semantic: { units: { Value: 'kg' } },
  };
  pool.putRows(record.tenantId, id, rows, record.columns);
  return record;
}
const rows = (offset = 0) =>
  Array.from({ length: 10 }, (_, i) => ({
    Key: `R${String(i + offset).padStart(3, '0')}`,
    Value: 100 + i,
  }));

test('80 percent identity overlap is accepted; lower overlap cannot be rescued by matching measured values', () => {
  const a = store(rows());
  const b = store(rows(2), 'b');
  expect(variantDifference(pool, a, b)).toMatchObject({ overlap: 8, onlyLeft: 2, onlyRight: 2 });
  const c = store(rows(3), 'c');
  expect(variantDifference(pool, a, c)).toBeNull();
});

test('stable identities count sparse changes as changed rows rather than missing identities', () => {
  const a = store(rows());
  const changed = rows();
  changed[0].Value += 1;
  const b = store(changed, 'b');
  expect(variantDifference(pool, a, b)).toEqual({
    keys: ['Key'],
    overlap: 10,
    changedRows: 1,
    onlyLeft: 0,
    onlyRight: 0,
  });
});

test('numeric identity columns, schema mismatch and cross-tenant records', () => {
  const a = store(rows().map((row, i) => ({ Key: i + 1000, Value: row.Value })));
  const b = store(
    rows().map((row, i) => ({ Key: i + 1000, Value: row.Value * 2 })),
    'b'
  );
  expect(variantDifference(pool, a, b)).toMatchObject({
    keys: ['Key'],
    overlap: 10,
    changedRows: 10,
  });
  expect(variantDifference(pool, a, { ...b, tenantId: 'other' })).toBeNull();
  expect(variantDifference(pool, a, { ...b, columns: b.columns.slice(1) })).toBeNull();
});

test('duplicate or null identity values fail conservatively', () => {
  const a = store(rows());
  const duplicate = rows();
  duplicate[0].Key = duplicate[1].Key;
  expect(variantDifference(pool, a, store(duplicate))).toBeNull();
  const missing = rows();
  missing[0].Key = null;
  expect(variantDifference(pool, a, store(missing))).toBeNull();
});

test('grouped and filtered differences use actual aggregate results, including numeric groups', () => {
  const a = store(rows()),
    b = store(rows(2), 'b');
  const aggregation = { groupBy: ['Group'], metrics: [{ fn: 'sum', field: 'Value', as: 'total' }] };
  const answers = [
    {
      aggregation,
      filtered: true,
      result: [{ Group: 1, total: 5 }],
      summaries: [{ field: 'Value', unit: 'kg', sum: 999 }],
    },
    {
      aggregation,
      filtered: true,
      result: [{ Group: 1, total: 8 }],
      summaries: [{ field: 'Value', unit: 'kg', sum: 999 }],
    },
  ];
  const text = compareDatasetResults([a, b], answers, []);
  expect(text).toContain('Group: 1');
  expect(text).toContain('Differenz 3 kg');
  expect(text).not.toContain('999');
  b.semantic.units.Value = 'm';
  expect(compareDatasetResults([a, b], answers, [])).toContain('keine Differenz berechnet');
});

test('variant expansion preserves scope, supports explicit sheets and comparison after selection', () => {
  const a = { id: 'a', sheet: 'Alpha', variants: ['b'] };
  const b = { id: 'b', sheet: 'Beta', variants: ['a'], selectedInConversations: ['chat'] };
  expect(expandVariantCandidates([a], [a], 'Summe', 'chat')).toEqual([a]);
  expect(expandVariantCandidates([a], [a, b], 'Summe', 'chat')).toEqual([b]);
  expect(expandVariantCandidates([a], [a, b], 'Vergleich', 'chat', true)).toEqual([a, b]);
  expect(expandVariantCandidates([a], [a, b], 'Blatt Alpha', 'chat')).toEqual([a]);
});

test('same-schema sibling sheets expand even when identity overlap cannot prove a variant', () => {
  const a = { ...store(rows(), 'Alpha'), sourceName: 'Export.xlsx' };
  const b = { ...store(rows(10), 'Beta'), sourceName: 'Export.xlsx' };
  expect(variantDifference(pool, a, b)).toBeNull();
  expect(expandVariantCandidates([a], [a, b], 'Summe', 'chat')).toEqual([a, b]);
  expect(
    expandVariantCandidates([a], [a, { ...b, sourceName: 'Other.xlsx' }], 'Summe', 'chat')
  ).toEqual([a]);
});

test('a sheet name inside the source filename is not an explicit sheet selection', () => {
  const a = { ...store(rows(), 'Alpha'), sourceName: 'Alpha.xlsx', variants: [] };
  const b = { ...store(rows(10), 'Beta'), sourceName: 'Alpha.xlsx', variants: [] };
  expect(expandVariantCandidates([a], [a, b], 'Summe Alpha.xlsx', 'chat')).toEqual([a, b]);
  expect(expandVariantCandidates([a], [a, b], 'Summe Alpha.xlsx Blatt Beta', 'chat')).toEqual([b]);
});
