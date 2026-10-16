'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const llm = require('../src/llm-client');
const structuredMock = llm.generateStructured;
const textMock = llm.generateText;
const { createLiveHarness } = require('../scripts/workbench-live-harness');
const Datapoint = require('../services/datapoint.service');
const {
  tableQualityText,
  tableQualityWorkbook,
} = require('../scripts/generate-table-quality-fixtures');
const { extractOriginal } = require('../src/file-channel-extract');
let broker,
  dir,
  meta,
  serial = 0;
const env = { ...process.env };
const call = (action, params) => broker.call(action, params, { meta });
const catalog = () => call('datapoint.datasetCatalog', { operation: 'list' });
const upload = (text = tableQualityText(), name = 'Export.csv') =>
  call('dataset.turn', {
    question: 'Bitte ablegen.',
    documents: [{ text, name }],
    conversationId: 'quality',
  });
const chat = (message) =>
  call('workbench.chat', { channel: 'open-webui', conversationId: 'quality', message });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-926-'));
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'rows');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  ({ broker } = createLiveHarness(dir, [
    { ...Datapoint, settings: { ...Datapoint.settings, dbPath: path.join(dir, 'catalog') } },
    require('../services/dataset.service'),
    { name: 'object-store', actions: { query: () => ({ docs: [] }) } },
    {
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }), federatedSearch: () => ({ results: [] }) },
    },
  ]));
  await broker.start();
});
afterAll(async () => {
  await broker.stop();
  process.env = env;
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  meta = {
    authUser: {
      tenantId: `quality-${++serial}`,
      userId: 'synthetic-person',
      roles: ['ROLE_EDM'],
      scope: 'full-access',
    },
  };
  structuredMock.mockReset().mockImplementation(async (_schema, raw) => {
    const input = JSON.parse(raw);
    if (input.instruction?.startsWith('Ordne ausschließlich'))
      return { kind: 'none', datasetId: '', rowNumbers: [] };
    if (input.datasets) return { datasetIds: input.datasets.map((entry) => entry.id) };
    if (input.previous && input.question.includes('kg'))
      return {
        title: input.previous.title,
        timezone: 'Europe/Berlin',
        units: { Amount: 'kg' },
        assumptions: [],
      };
    return null;
  });
  textMock.mockRejectedValue(new Error('Unexpected answer call'));
});

test('AC-01/02: persistence, receipt, exact total and grouped sums exclude controls', async () => {
  const result = await upload();
  expect(result.confirmations[0]).toContain('3 Summenzeilen');
  expect(result.confirmations[0]).toContain('Summen stimmen mit der Datei überein');
  const [record] = await catalog();
  expect(record.rowCount).toBe(4);
  expect(record.quality.controls).toHaveLength(3);
  const total = await call('dataset.query', { id: record.id, question: 'Wie hoch ist die Summe?' });
  expect(total.result).toEqual([{ sum_Amount: 40 }]);
  const grouped = await call('dataset.query', {
    id: record.id,
    question: 'Gruppiere nach Group',
    plan: {
      sources: [{ alias: 'table', sourceId: record.id }],
      operations: [
        {
          op: 'aggregate',
          groupBy: ['Group'],
          metrics: [{ fn: 'sum', field: 'Amount', as: 'total' }],
        },
      ],
    },
  });
  expect(grouped.result).toEqual(
    expect.arrayContaining([
      { Group: 'a', total: 30 },
      { Group: 'b', total: 7 },
      { Group: null, total: 3 },
    ])
  );
  expect(grouped.responseText).not.toMatch(/120|200/);
});

test('AC-03: original XLSX yields distinct titles, both variants and query-based differences', async () => {
  const doc = await extractOriginal({
    extension: 'xlsx',
    name: 'Export.xlsx',
    contentBase64: tableQualityWorkbook({ withUnit: true }).toString('base64'),
  });
  const reply = await chat(
    `<context><source name="${doc.name}">${doc.text}</source></context><user_query>Vergleiche die Summen in beiden Blättern.</user_query>`
  );
  const records = await catalog();
  expect(records).toHaveLength(2);
  expect(new Set(records.map((record) => record.title)).size).toBe(2);
  expect(records.map((record) => record.sheet).sort()).toEqual(['Basis', 'Variant']);
  expect(records.every((record) => record.variants.length === 1)).toBe(true);
  expect(reply.responseText).toMatch(/Basis/);
  expect(reply.responseText).toMatch(/Variant/);
  expect(reply.responseText).toMatch(/Differenz 4 kg/);
  expect(reply.responseText).toMatch(/4 gemeinsame Zeilen/);
  expect(reply.responseText.match(/Hab ich abgelegt:/g)).toHaveLength(2);
  expect(reply.responseText).toMatch(/3 Summenzeilen/);
  const followup = await chat('Vergleiche die Summen in beiden Blättern.');
  expect(followup.responseText).toMatch(/Differenz 4 kg/);
  expect(followup.sources.filter((source) => source.source === 'dataset.query')).toHaveLength(2);
  const answer = await call('dataset.query', {
    question: 'Wie hoch ist die Summe?',
    conversationId: 'quality',
  });
  expect(answer.answers.map((entry) => entry.result)).toEqual([
    [{ 'sum_Amount [kg]': 40 }],
    [{ 'sum_Amount [kg]': 44 }],
  ]);
  expect(
    (await call('dataset.query', { question: 'Summe im Blatt Basis', conversationId: 'quality' }))
      .rowCount
  ).toBe(4);
});

test('identical sheets remain two distinguishable records and replay stays idempotent', async () => {
  const doc = await extractOriginal({
    extension: 'xlsx',
    name: 'Same.xlsx',
    contentBase64: tableQualityWorkbook({ identical: true }).toString('base64'),
  });
  const first = await upload(doc.text, doc.name);
  expect(first.datasetIds).toHaveLength(2);
  expect((await catalog()).map((record) => record.version)).toEqual([1, 1]);
  const again = await upload(doc.text, doc.name);
  expect(again.datasetIds).toEqual(first.datasetIds);
  expect(again.confirmations).toEqual([]);
  expect(await catalog()).toHaveLength(2);
});

test('AC-04: unit question only for a measured answer, once per persisted dataset, correction survives turns', async () => {
  const uploaded = await upload();
  const id = uploaded.datasetIds[0];
  expect(
    (await call('dataset.query', { id, question: 'Wie viele Zeilen?' })).responseText
  ).not.toMatch(/Welche Einheit/);
  expect((await catalog())[0].semantic.unitQuestion).toBeUndefined();
  const first = await call('dataset.query', { id, question: 'Wie hoch ist die Summe?' });
  expect(first.responseText).toMatch(/Welche Einheit.*Amount/);
  expect(
    (await call('dataset.query', { id, question: 'Wie hoch ist die Summe?' })).responseText
  ).not.toMatch(/Welche Einheit/);
  const corrected = await call('dataset.turn', {
    question: 'Einheit ist kg.',
    conversationId: 'quality',
  });
  expect(corrected.responseText).toMatch(/korrigiert.*Amount: kg/);
  const next = await call('dataset.query', { id, question: 'Wie hoch ist die Summe?' });
  expect(next.responseText).toContain('40 kg');
  expect(next.responseText).not.toMatch(/Einheit ungeklärt|Welche Einheit/);
  expect((await catalog())[0].audit.at(-1).kind).toBe('semantic-correction');
});

test('control-row correction uses existing audited turn and restores only confirmed rows', async () => {
  const uploaded = await upload();
  const [record] = await catalog();
  const defaultMock = structuredMock.getMockImplementation();
  structuredMock.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    if (input.instruction?.startsWith('Ordne ausschließlich'))
      return {
        kind: 'restore-rows',
        datasetId: record.id,
        rowNumbers: [record.quality.controls[0].rowNumber],
      };
    return defaultMock(schema, raw);
  });
  const result = await call('dataset.turn', {
    question: 'Das ist keine Summenzeile.',
    conversationId: 'quality',
  });
  expect(result.responseText).toContain('1 Kontrollzeilen');
  const answer = await call('dataset.query', { id: uploaded.datasetIds[0], question: 'Summe' });
  expect(answer.result).toEqual([{ sum_Amount: 70 }]);
  expect((await catalog())[0].quality.controls).toHaveLength(2);
  expect((await catalog())[0].audit.at(-1).kind).toBe('control-row-correction');
  for (const [, raw] of structuredMock.mock.calls)
    expect(raw).not.toMatch(/R001|R002|"rows"\s*:|"examples"\s*:/);
});

test('sheet correction persists a conversation-scoped selection', async () => {
  const text = `Sheet: Basis\n${tableQualityText()}\n\nSheet: Variant\n${tableQualityText({ variant: true })}`;
  await upload(text, 'Sheets.xlsx');
  const record = (await catalog()).find((entry) => entry.sheet === 'Variant');
  const defaultMock = structuredMock.getMockImplementation();
  structuredMock.mockImplementation(async (schema, raw) => {
    const input = JSON.parse(raw);
    if (input.instruction?.startsWith('Ordne ausschließlich'))
      return { kind: 'select-sheet', datasetId: record.id, rowNumbers: [] };
    return defaultMock(schema, raw);
  });
  const selected = await call('dataset.turn', {
    question: 'Blatt Variant verwenden.',
    conversationId: 'quality',
  });
  expect(selected.responseText).toContain('Variant');
  const answer = await call('dataset.query', {
    question: 'Wie hoch ist die Summe?',
    conversationId: 'quality',
  });
  expect(answer.datasetId).toBe(record.id);
  expect(answer.result).toEqual([{ sum_Amount: 44 }]);
});

test('same-schema sheets without matching identities ask for a sheet instead of silently using one', async () => {
  const text =
    'Sheet: Alpha\nKey;Amount [kg]\nR001;10\nR002;20\n\nSheet: Beta\nKey;Amount [kg]\nR101;12\nR102;22';
  const result = await chat(
    `<context><source name="Different.xlsx">${text}</source></context><user_query>Wie hoch ist die Summe?</user_query>`
  );
  expect(result.responseText).toMatch(/Mehrere Tabellenblätter/);
  expect(result.responseText).toContain('Alpha');
  expect(result.responseText).toContain('Beta');
  expect(result.responseText).not.toMatch(/Summe beträgt/);
});
