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
const { createLiveHarness } = require('../scripts/workbench-live-harness');
const {
  generateDatasetFixture,
  generateDatasetWorkbookFixture,
  generateDatasetSafetyFixture,
  generateDatasetLegacyFixture,
} = require('../scripts/generate-dataset-fixtures');
const { parseDatasetText } = require('../src/dataset-input');
const { extractOriginal } = require('../src/file-channel-extract');
const Datapoint = require('../services/datapoint.service');
let broker,
  dir,
  meta,
  serial = 0;
const savedEnv = { ...process.env };
const call = (action, params) => broker.call(action, params, { meta });
const chat = (question, text, name = 'synthetic-838.csv') =>
  call('workbench.chat', {
    channel: 'open-webui',
    conversationId: 'synthetic-838',
    message: text
      ? `<context><source name="${name}">${text}</source></context><user_query>${question}</user_query>`
      : question,
  });
const catalog = () => call('datapoint.datasetCatalog', { operation: 'list' });
const csv = generateDatasetFixture();
const broken = generateDatasetFixture('openwebui');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-838-'));
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
beforeEach(() => {
  meta = {
    authUser: {
      tenantId: `synthetic-838-${++serial}`,
      userId: 'synthetic-person',
      roles: ['ROLE_EDM'],
      scope: 'full-access',
    },
  };
  llm.generateStructured.mockImplementation(async (_schema, raw) => {
    const input = JSON.parse(raw);
    if (input.datasets) return { datasetIds: input.datasets.map((entry) => entry.id) };
    return null;
  });
  llm.generateText.mockRejectedValue(new Error('Unexpected answer call'));
});
afterAll(async () => {
  await broker.stop();
  process.env = savedEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('838 scenario 1 / A.1–A.3: upload and peak question answer first in one turn', async () => {
  const result = await chat('Wann war die Spitzenlast?', csv);
  expect(result.responseText).toContain('1.243,7 kW am 14.01.2025 18:15');
  expect(result.responseText.indexOf('1.243,7')).toBeLessThan(
    result.responseText.indexOf('Hab ich abgelegt')
  );
  expect(result.responseText).not.toMatch(/Tabellenkalkulation|Lesewerkzeug|sortieren/);
  expect(result.sources).toContainEqual(
    expect.objectContaining({ source: 'dataset.query', status: 'available' })
  );
  expect((await catalog())[0].rowCount).toBe(35040);
});

test('838 scenario 2: upload and annual energy question retain missing values', async () => {
  const result = await chat('Wie viel Energie im Jahr 2025?', csv);
  expect(result.responseText).toContain('3.478,874 MWh');
  expect(result.responseText).toContain('4 leere Werte');
  expect(result.responseText.indexOf('3.478,874')).toBeLessThan(
    result.responseText.indexOf('Hab ich abgelegt')
  );
});

test('838 scenario 3: generated original XLSX answers from the selected sheet', async () => {
  const file = {
    extension: 'xlsx',
    name: 'synthetic-two-sheets.xlsx',
    contentBase64: generateDatasetWorkbookFixture().toString('base64'),
  };
  const doc = await extractOriginal(file);
  const result = await chat(
    'Wie hoch ist das Maximum im Blatt Vertrieb? Bitte speichern.',
    doc.text,
    doc.name
  );
  expect(result.responseText).toContain('41 Stück');
  expect(result.responseText).not.toContain('11 Stück');
  expect((await catalog()).map((record) => record.sheet).sort()).toEqual(['Lager', 'Vertrieb']);
});

test('838 scenario 4 / B.1: actual Python comma reader output reconstructs identically', async () => {
  expect(broken).toContain('None: 2');
  const original = parseDatasetText(csv)[0];
  const repaired = parseDatasetText(broken)[0];
  expect(repaired.hash).toBe(original.hash);
  expect(repaired.rows).toEqual(original.rows);
  const result = await chat('Wann war die Spitzenlast?', broken);
  expect(result.responseText).toContain('1.243,7 kW am 14.01.2025 18:15');
  expect((await catalog())[0].quality.missingValues).toBe(4);
});

test('838 B.2: ambiguous remnants reject the entire upload without success or persistence', async () => {
  const result = await chat(
    'Wann war die Spitzenlast?',
    generateDatasetSafetyFixture('irreversible')
  );
  expect(result.responseText).toMatch(/beschädigt.*erneut.*Dateikanal/);
  expect(result.responseText).not.toMatch(/abgelegt|gespeichert/);
  expect(await catalog()).toEqual([]);
});

test.each(['empty', 'none', 'unnamed', 'truncated'])(
  '838 B.3: generated %s table is blocked',
  async (kind) => {
    const result = await chat('Bitte speichern und prüfen?', generateDatasetSafetyFixture(kind));
    expect(result.responseText).toMatch(/beschädigt/);
    expect(await catalog()).toEqual([]);
  }
);

test('838 B.3: empty ratio is configurable and rejects before storage', async () => {
  process.env.WORKBENCH_DATASET_MAX_EMPTY_RATIO = '0.4';
  try {
    const result = await chat('Bitte speichern?', generateDatasetSafetyFixture('sparse'));
    expect(result.responseText).toMatch(/beschädigt/);
    expect(await catalog()).toEqual([]);
  } finally {
    delete process.env.WORKBENCH_DATASET_MAX_EMPTY_RATIO;
  }
});

test('838 scenario 5 / B.4: corrupt hash duplicate is quarantined and replaced by a correct version', async () => {
  const uploaded = await call('dataset.turn', {
    question: 'Bitte speichern.',
    documents: [{ name: 'synthetic-838.csv', text: csv }],
    conversationId: 'synthetic-838',
  });
  const [old] = await catalog();
  // Synthetic legacy corruption retains the incoming hash, matching the historical duplicate failure.
  await call('datapoint.datasetCatalog', {
    operation: 'put',
    record: generateDatasetLegacyFixture(old),
  });
  const result = await chat('Wann war die Spitzenlast?', csv);
  expect(result.responseText).toContain('1.243,7');
  const records = await catalog();
  const retired = records.find((record) => record.id === uploaded.datasetIds[0]);
  expect(retired.current).toBe(false);
  expect(retired.quality.unusable).toBe(true);
  expect(retired.audit.at(-1).kind).toBe('quarantined');
  expect(records.find((record) => record.current).version).toBe(2);
  expect(records.find((record) => record.current).rowCount).toBe(35040);
  const denied = await call('dataset.query', { id: retired.id, version: 1, question: 'Maximum?' });
  expect(denied.responseText).toMatch(/unbrauchbar/);
});

test('838 scenario 6 / C.1–C.2: missing requested column yields a concrete cause', async () => {
  const result = await chat('Maximum der Spalte "Blindleistung"?', csv);
  expect(result.responseText).toMatch(/Spalte.*nicht gefunden/);
  expect(result.responseText).not.toMatch(/0 Zeilen|Spalte \d+|1.243,7/);
});

test('838 C.1: out-of-range calendar filter does not produce an empty result answer', async () => {
  await chat('Wann war die Spitzenlast?', csv);
  const [record] = await catalog();
  const result = await call('dataset.query', { id: record.id, question: 'Spitzenlast 2026?' });
  expect(result.responseText).toMatch(/Zeitraum.*außerhalb/);
  expect(result.responseText).not.toMatch(/0 Zeilen|null|Maximum/);
});

test('838 C.1: all-empty requested measure gives its cause instead of a null aggregate', async () => {
  await call('dataset.turn', {
    question: 'Bitte speichern.',
    documents: [
      { name: 'synthetic-empty.csv', text: generateDatasetSafetyFixture('blankMeasure') },
    ],
    conversationId: 'synthetic-838',
  });
  const [record] = await catalog();
  expect(record).toBeDefined();
  const result = await call('dataset.query', {
    id: record.id,
    question: 'Maximum?',
    plan: {
      sources: [{ alias: 'table', sourceId: record.id }],
      operations: [{ op: 'aggregate', metrics: [{ fn: 'max', field: 'Menge', as: 'maximum' }] }],
    },
  });
  expect(result.responseText).toMatch(/keine ausgefüllten/);
  expect(result.responseText).not.toMatch(/0 Zeilen|null|Spalte \d+/);
  const natural = await call('dataset.query', { id: record.id, question: 'Wann war das Maximum?' });
  expect(natural.responseText).toMatch(/keine verwendbaren Werte/);
  expect(natural.responseText).not.toMatch(/Zeilen|null|Maximum:/);
});

test('838 scenario 7 / D: grounded follow-up has no appended filler recommendation', async () => {
  await chat('Wie viel Energie im Jahr 2025?', csv);
  const result = await chat('Und wie ist die Spitzenlast?');
  expect(result.responseText).toContain('1.243,7 kW am 14.01.2025 18:15');
  expect(result.responseText).not.toMatch(
    /Netznutzung|abrechnung|heranziehen|nächster Schritt|abgelegt|MWh/
  );
});

test('838 A.1: question uses newly received rows rather than a different catalog dataset', async () => {
  await chat('Bitte speichern.', generateDatasetSafetyFixture('healthy'), 'synthetic-products.csv');
  const result = await chat('Wann war die Spitzenlast?', csv);
  expect(result.responseText).toContain('1.243,7');
  expect(result.responseText).not.toContain('Produkt');
});

test('838 B.2: a damaged sheet prevents all tables in the request from being persisted', async () => {
  const result = await call('dataset.turn', {
    question: 'Bitte speichern und auswerten?',
    conversationId: 'synthetic-838',
    documents: [
      { name: 'synthetic-good.csv', text: generateDatasetSafetyFixture('healthy') },
      { name: 'synthetic-bad.csv', text: generateDatasetSafetyFixture('none') },
    ],
  });
  expect(result.responseText).toMatch(/beschädigt/);
  expect(await catalog()).toEqual([]);
});

test('838 B.2: pasted damaged rows receive the same clear response', async () => {
  const result = await call('workbench.chat', {
    channel: 'open-webui',
    conversationId: 'synthetic-838',
    message: generateDatasetSafetyFixture('none') + '\nWie hoch ist das Maximum?',
  });
  expect(result.responseText).toMatch(/beschädigt/);
  expect(await catalog()).toEqual([]);
});
