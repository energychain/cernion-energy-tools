'use strict';

const { parseDatasetText } = require('../src/dataset-input');
const { separateControlRows, closeTotal } = require('../src/dataset-table-quality');
const { profileRows } = require('../src/tabular-intelligence');
const { tableQualityText } = require('../scripts/generate-table-quality-fixtures');

test('AC-01/02: excludes intermediate, repeated final controls and keeps a real empty group', () => {
  const [table] = parseDatasetText(tableQualityText());
  expect(table.rows).toHaveLength(4);
  expect(table.rows.at(-1)).toMatchObject({ Key: 'R004', Group: null, Amount: 3 });
  expect(table.controls).toHaveLength(3);
  expect(table.controls.every((entry) => entry.matched)).toBe(true);
  expect(table.rows.reduce((sum, row) => sum + row.Amount, 0)).toBe(40);
  expect(table.profile.totalRows).toBe(4);
});

test.each(['before', 'after', 'both'])('leading and trailing controls: %s', (where) => {
  const data = [
    { Key: 'R001', Value: 0.1 },
    { Key: 'R002', Value: 0.2 },
  ];
  const control = { Key: null, Value: 0.3 };
  const rows = [
    ...(where !== 'after' ? [control] : []),
    ...data,
    ...(where !== 'before' ? [control] : []),
  ];
  const result = separateControlRows(rows, profileRows(rows).columns);
  expect(result.rows).toEqual(data);
  expect(result.controls).toHaveLength(where === 'both' ? 2 : 1);
});

test('rounding tolerance, signed values and nonzero numerical evidence', () => {
  expect(closeTotal(10.019, 10)).toBe(true);
  expect(closeTotal(10.021, 10)).toBe(false);
  expect(closeTotal(1e9 + 5, 1e9)).toBe(true);
  const [table] = parseDatasetText('Key;Value\nR001;10.1\nR002;-2.2\n;;');
  expect(table.rows).toHaveLength(2);
  const rows = [
    { Key: 'R001', Value: 10.1 },
    { Key: 'R002', Value: -2.2 },
    { Key: null, Value: 7.91 },
  ];
  expect(separateControlRows(rows, profileRows(rows).columns).controls).toHaveLength(1);
});

test('AC-02: sparse data stays data even when its number equals preceding values', () => {
  const rows = [
    { Key: 'R001', Group: 'a', Value: 10 },
    { Key: 'R002', Group: 'a', Value: 20 },
    { Key: 'R003', Group: null, Value: 30 },
    { Key: null, Group: null, Value: 8 },
  ];
  expect(separateControlRows(rows, profileRows(rows).columns).rows).toEqual(rows);
});

test('all populated measures must agree unless multiple independent measures prove a discrepancy', () => {
  const data = [
    { Key: 'R001', A: 10, B: 20 },
    { Key: 'R002', A: 12, B: 21 },
  ];
  const rows = [...data, { Key: null, A: 22, B: 999 }];
  expect(separateControlRows(rows, profileRows(rows).columns).rows).toEqual(rows);
  const wide = ['A', 'B', 'C', 'D', 'E'];
  const multi = [1, 2].map((n) => ({
    Key: `R00${n}`,
    ...Object.fromEntries(wide.map((f) => [f, n])),
  }));
  multi.push({ Key: null, A: 3, B: 3, C: 3, D: 3, E: 4 });
  const result = separateControlRows(multi, profileRows(multi).columns);
  expect(result.controls).toHaveLength(1);
  expect(result.controls[0].matched).toBe(false);
});

test('value-only sequences, zeros and unproven sparse rows never become controls', () => {
  for (const rows of [
    [{ Value: 1 }, { Value: 2 }, { Value: 3 }],
    [
      { Key: 'R001', Value: 0 },
      { Key: 'R002', Value: 0 },
      { Key: null, Value: 0 },
    ],
    [
      { Key: 'R001', Value: 1 },
      { Key: null, Value: 3 },
      { Key: null, Value: 4 },
    ],
  ])
    expect(separateControlRows(rows, profileRows(rows).columns).rows).toEqual(rows);
});

test('bounded control metadata fails conservatively without excluding a partial set', () => {
  const rows = [
    { Key: 'R001', Value: 1 },
    { Key: 'R002', Value: 2 },
    ...Array.from({ length: 1001 }, () => ({ Key: null, Value: 3 })),
  ];
  expect(separateControlRows(rows, profileRows(rows).columns).controls).toEqual([]);
});

test('numerical identifiers can be structurally empty without any text columns', () => {
  const rows = [
    { Key: 1001, Value: 10 },
    { Key: 1002, Value: 20 },
    { Key: null, Value: 30 },
  ];
  const result = separateControlRows(rows, profileRows(rows).columns);
  expect(result.controls).toHaveLength(1);
  expect(result.rows).toEqual(rows.slice(0, 2));
});

test('numeric keys protect real rows with an empty group while totals still exclude correctly', () => {
  const rows = [
    { Key: 1001, Group: 'a', Value: 10 },
    { Key: 1002, Group: null, Value: 20 },
    { Key: 1003, Group: 'b', Value: 7 },
    { Key: 1004, Group: 'b', Value: 3 },
    { Key: null, Group: null, Value: 40 },
  ];
  const result = separateControlRows(rows, profileRows(rows).columns);
  expect(result.controls).toHaveLength(1);
  expect(result.rows).toEqual(rows.slice(0, 4));
});

test('source column row_number cannot replace the physical SQLite row identity', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
  const Pool = require('../src/dataset-sqlite-pool');
  const { storedTableQuality, excludeStoredControls } = require('../src/dataset-stored-quality');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-column-'));
  const pool = new Pool(directory),
    id = 'ds_' + 'a'.repeat(32);
  try {
    const rows = [
      { row_number: 'R001', Value: 10 },
      { row_number: 'R002', Value: 20 },
      { row_number: null, Value: 30 },
    ];
    const columns = profileRows(rows).columns;
    pool.putRows('synthetic', id, rows, columns);
    const controls = storedTableQuality(pool, 'synthetic', id, columns);
    expect(controls).toHaveLength(1);
    expect(controls[0].index).toBe(2);
    expect(excludeStoredControls(pool, 'synthetic', id, columns, controls).count).toBe(2);
    expect(pool.rows('synthetic', id, columns)).toEqual(rows.slice(0, 2));
  } finally {
    pool.closeAll();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('decimal-comma exports rank delimiters by original rows including excluded controls', () => {
  const [table] = parseDatasetText(tableQualityText({ decimalComma: true }));
  expect(table.profile.columns.map((column) => column.name)).toEqual(['Amount', 'Group', 'Key']);
  expect(table.rows).toHaveLength(4);
  expect(table.controls).toHaveLength(3);
  expect(table.rows.reduce((sum, row) => sum + row.Amount, 0)).toBe(40);
  const { practiceDocument } = require('../scripts/generate-practice-evaluation-fixtures');
  const sheets = parseDatasetText(practiceDocument({ kind: 'table-quality' }));
  expect(sheets.map((sheet) => sheet.rows.length)).toEqual([4, 4]);
  expect(sheets.map((sheet) => sheet.rows.reduce((sum, row) => sum + row.Amount, 0))).toEqual([
    40, 44,
  ]);
});
