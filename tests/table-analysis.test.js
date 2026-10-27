'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const llm = require('../src/llm-client');
const DatasetSqlitePool = require('../src/dataset-sqlite-pool');
const { analyzeTables, isRecordTable, tableViews } = require('../src/table-analysis');

const tenantId = 'synthetic-tenant-a';
const record = (id, sourceName, columns, rowCount, extra = {}) => ({
  id,
  tenantId,
  title: sourceName,
  sourceName,
  version: 1,
  rowCount,
  columns: columns.map(([name, type, sensitive]) => ({
    name,
    type,
    sensitive: Boolean(sensitive),
  })),
  semantic: { units: {} },
  quality: {},
  ...extra,
});
const bills = record(
  `ds_${'a'.repeat(32)}`,
  'rechnungen.csv',
  [
    ['Nummer', 'text'],
    ['Betrag', 'number'],
    ['Vertraulich', 'text', true],
  ],
  3
);
const advices = record(
  `ds_${'b'.repeat(32)}`,
  'avise.csv',
  [
    ['Nummer', 'text'],
    ['Gezahlt', 'number'],
  ],
  2
);
const events = record(
  `ds_${'c'.repeat(32)}`,
  'ereignisse.csv',
  [
    ['Vorgang', 'text'],
    ['Zeitpunkt', 'text'],
  ],
  4
);
const foreign = record(`ds_${'d'.repeat(32)}`, 'fremd.csv', [['Geheim', 'text']], 1);
let dir, pool;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'table-analysis-'));
  pool = new DatasetSqlitePool(dir);
  const put = (item, rows) => pool.putRows(tenantId, item.id, rows, item.columns, [], []);
  put(bills, [
    { Nummer: 'R-1', Betrag: 100, Vertraulich: 'x' },
    { Nummer: 'R-2', Betrag: 250, Vertraulich: 'y' },
    { Nummer: 'R-3', Betrag: 80, Vertraulich: 'z' },
  ]);
  put(advices, [
    { Nummer: 'R-1', Gezahlt: 100 },
    { Nummer: 'R-2', Gezahlt: 50 },
  ]);
  put(events, [
    { Vorgang: 'V-1', Zeitpunkt: '2026-01-01T08:00' },
    { Vorgang: 'V-1', Zeitpunkt: '2026-01-02T20:00' },
    { Vorgang: 'V-2', Zeitpunkt: '2026-01-03T08:00' },
    { Vorgang: 'V-2', Zeitpunkt: '2026-01-03T14:00' },
  ]);
  put(foreign, [{ Geheim: 'nie' }]);
});
afterAll(() => {
  pool.closeAll();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => llm.generateStructured.mockReset());

const run = (records, question = 'Frage') =>
  analyzeTables({ filename: pool.databasePath(tenantId), records, question, tenantId });

test('joins two tables through readable views and answers only from the result', async () => {
  llm.generateStructured
    .mockResolvedValueOnce({
      sql: 'SELECT r."Nummer", r."Betrag" - coalesce(a."Gezahlt", 0) AS "Offen" FROM rechnungen r LEFT JOIN avise a ON a."Nummer" = r."Nummer" WHERE r."Betrag" - coalesce(a."Gezahlt", 0) > 0 ORDER BY r."Nummer"',
    })
    .mockImplementationOnce(async (_schema, prompt) => {
      const input = JSON.parse(prompt);
      expect(input.result[0].rows).toEqual([
        { Nummer: 'R-2', Offen: 200 },
        { Nummer: 'R-3', Offen: 80 },
      ]);
      return { answer: 'Offen sind R-2 (200,00 €) und R-3 (80,00 €).' };
    });
  const result = await run([bills, advices], 'Welche Rechnungen sind offen?');
  expect(result.answer).toContain('R-2');
  expect(result.provenance).toBe('Herkunft: rechnungen.csv, Version 1; avise.csv, Version 1.');
  // The model never sees cell values while drafting, nor restricted columns.
  const draft = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(JSON.stringify(draft)).not.toMatch(/R-1|Vertraulich/u);
});

test('durations use a deterministic julianday over explicit timestamps', async () => {
  llm.generateStructured
    .mockResolvedValueOnce({
      sql: 'SELECT "Vorgang", round((julianday(max("Zeitpunkt")) - julianday(min("Zeitpunkt"))) * 24, 2) AS "Stunden" FROM ereignisse GROUP BY "Vorgang" ORDER BY "Vorgang"',
    })
    .mockImplementationOnce(async (_schema, prompt) => {
      expect(JSON.parse(prompt).result[0].rows).toEqual([
        { Vorgang: 'V-1', Stunden: 36 },
        { Vorgang: 'V-2', Stunden: 6 },
      ]);
      return { answer: 'V-1 dauerte 36 Stunden.' };
    });
  await expect(run([events])).resolves.toMatchObject({ rows: 2 });
});

test('two-step aggregates run as materialized steps', async () => {
  llm.generateStructured
    .mockResolvedValueOnce({
      sql: 'WITH je_vorgang AS (SELECT "Vorgang", (julianday(max("Zeitpunkt")) - julianday(min("Zeitpunkt"))) * 24 AS "Stunden" FROM ereignisse GROUP BY "Vorgang") SELECT count(*) AS "Vorgaenge", round(avg("Stunden"), 2) AS "Mittel" FROM je_vorgang',
    })
    .mockImplementationOnce(async (_schema, prompt) => {
      expect(JSON.parse(prompt).result[0].rows).toEqual([{ Vorgaenge: 2, Mittel: 21 }]);
      return { answer: 'Im Mittel 21 Stunden.' };
    });
  await expect(run([events])).resolves.toMatchObject({ rows: 1 });
});

test.each([
  ['a foreign table', `SELECT * FROM "${foreign.id}"`],
  ['a restricted column', `SELECT "c2" FROM "${bills.id}"`],
  ['a write', 'DELETE FROM rechnungen'],
  ['the system clock', "SELECT julianday('now')"],
])('rejects %s even after redrafts', async (_label, sql) => {
  llm.generateStructured.mockResolvedValue({ sql });
  await expect(run([bills, advices])).rejects.toThrow();
  expect(llm.generateStructured).toHaveBeenCalledTimes(3);
  expect(JSON.parse(llm.generateStructured.mock.calls[1][1]).previousAttempt.rejected[0].sql).toBe(
    sql
  );
});

test('record lists and measurement series are told apart by their time grid', () => {
  expect(isRecordTable(bills)).toBe(true);
  const series = {
    rowCount: 96,
    semantic: { timeField: 'Zeit' },
    quality: { intervalMinutes: 15, gaps: 1, duplicates: 0 },
  };
  expect(isRecordTable(series)).toBe(false);
  expect(
    isRecordTable({ ...series, quality: { intervalMinutes: 1440, gaps: 30, duplicates: 5 } })
  ).toBe(true);
});

test('view names stay unique and readable', () => {
  const views = tableViews([bills, { ...bills, id: `ds_${'e'.repeat(32)}` }]);
  expect(views.map((view) => view.name)).toEqual(['rechnungen', 'rechnungen_2']);
  expect(views[0].columns.map((column) => column.name)).toEqual(['Nummer', 'Betrag']);
});

test('a final top-level LIMIT is applied to the result rows, nested ones stay in SQL', () => {
  const { splitLimit } = require('../src/table-analysis');
  expect(splitLimit('SELECT a FROM t ORDER BY a DESC LIMIT 1;')).toEqual({
    sql: 'SELECT a FROM t ORDER BY a DESC',
    limit: 1,
  });
  expect(splitLimit('SELECT a FROM (SELECT b FROM t LIMIT 2)').limit).toBeNull();
});

test('a ranked aggregate over a two-step query runs and keeps its limit', async () => {
  llm.generateStructured
    .mockResolvedValueOnce({
      sql: 'WITH je AS (SELECT "Vorgang", (julianday(max("Zeitpunkt")) - julianday(min("Zeitpunkt"))) * 24 AS "Stunden" FROM ereignisse GROUP BY "Vorgang") SELECT "Vorgang", round(avg("Stunden"), 2) AS "Mittel" FROM je GROUP BY "Vorgang" ORDER BY "Mittel" DESC LIMIT 1',
    })
    .mockImplementationOnce(async (_schema, prompt) => {
      expect(JSON.parse(prompt).result[0].rows).toEqual([{ Vorgang: 'V-1', Mittel: 36 }]);
      return { answer: 'V-1 dauerte am längsten.' };
    });
  await expect(run([events])).resolves.toMatchObject({ rows: 1 });
});

test('each part of a question may run as its own simple query', async () => {
  llm.generateStructured
    .mockResolvedValueOnce({
      queries: [
        {
          purpose: 'offene Beträge',
          sql: 'SELECT "Nummer", "Betrag" FROM rechnungen ORDER BY "Nummer"',
        },
        { purpose: 'Zahlungen', sql: 'SELECT count(*) AS "Avise" FROM avise' },
      ],
    })
    .mockImplementationOnce(async (_schema, prompt) => {
      const parts = JSON.parse(prompt).result;
      expect(parts.map((part) => part.purpose)).toEqual(['offene Beträge', 'Zahlungen']);
      expect(parts[1].rows).toEqual([{ Avise: 2 }]);
      return { answer: 'Drei Rechnungen, zwei Avise.' };
    });
  await expect(run([bills, advices])).resolves.toMatchObject({ rows: 4 });
});
