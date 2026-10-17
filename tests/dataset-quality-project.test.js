'use strict';

jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
  generateStructured: jest.fn(),
  generateText: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const llm = require('../src/llm-client');
const { structureHarness, addObject } = require('./helpers/project-structure');
const {
  tableQualityWorkbook,
  tableQualityText,
} = require('../scripts/generate-table-quality-fixtures');
const { parseDatasetText } = require('../src/dataset-input');
let h, dir, env;

beforeEach(async () => {
  env = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-quality-project-'));
  process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
  llm.generateStructured.mockReset().mockImplementation(async (_schema, raw) => {
    const input = JSON.parse(raw);
    return input.datasets ? { datasetIds: input.datasets.map((record) => record.id) } : null;
  });
  h = await structureHarness(dir);
});
afterEach(async () => {
  await h?.broker.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = env;
});

test('AC-01/03/05: project streaming and chat share control detection; variants stay distinct across batches', async () => {
  process.env.CET_PROJECT_DATASET_SAMPLE_ROWS = '2';
  process.env.CET_PROJECT_DATASET_BATCH_ROWS = '2';
  const projectId = await h.create();
  await h.call('project-file.update', { projectId, projectRefs: [{ conversationId: 'quality' }] });
  const object = await addObject(
    h,
    projectId,
    tableQualityWorkbook({ withUnit: true }),
    'Export.xlsx'
  );
  expect(object.extraction).toMatchObject({ status: 'extracted' });
  const records = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(records).toHaveLength(2);
  for (const record of records) {
    expect(record.rowCount).toBe(4);
    expect(record.quality.controls).toHaveLength(3);
    expect(record.variants).toHaveLength(1);
    expect(record.title).toContain(record.sheet);
    const [chat] = parseDatasetText(
      tableQualityText({ variant: record.sheet === 'Variant', withUnit: true })
    );
    expect(record.quality.controls).toEqual(chat.controls);
  }
  const answer = await h.call('dataset.query', {
    question: 'Vergleiche die Summen',
    conversationId: 'quality',
  });
  expect(answer.responseText).toMatch(/Differenz 4 kg/);
  expect(answer.comparisons).toEqual([
    { keys: ['Key'], overlap: 4, changedRows: 4, onlyLeft: 0, onlyRight: 0 },
  ]);
  for (const [, raw] of llm.generateStructured.mock.calls)
    expect(raw).not.toMatch(/R001|R002|"rows"\s*:|"examples"\s*:/);
});

test('project controls after a large sample preserve exact grouped and overall sums', async () => {
  process.env.CET_PROJECT_DATASET_SAMPLE_ROWS = '2';
  const projectId = await h.create();
  const object = await addObject(
    h,
    projectId,
    Buffer.from(tableQualityText({ withUnit: true })),
    'Export.csv'
  );
  expect(object.extraction.status).toBe('extracted');
  const [record] = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  const total = await h.call('dataset.query', { id: record.id, question: 'Summe' });
  expect(total.result).toEqual([{ 'sum_Amount [kg]': 40 }]);
  expect(total.summaries[0]).toMatchObject({ sum: 40, present: 4, rows: 4 });
  const grouped = await h.call('dataset.query', {
    id: record.id,
    question: 'Gruppiert',
    plan: {
      sources: [{ alias: 'table', sourceId: record.id }],
      operations: [
        {
          op: 'aggregate',
          groupBy: ['Group'],
          metrics: [{ fn: 'sum', field: 'Amount [kg]', as: 'total' }],
        },
      ],
    },
  });
  expect(grouped.result).toEqual(
    expect.arrayContaining([
      { Group: null, total: 3 },
      { Group: 'a', total: 30 },
      { Group: 'b', total: 7 },
    ])
  );
});

test('manifest reads expand a single selected node to both variants and include deterministic differences', async () => {
  const projectId = await h.create();
  const object = await addObject(
    h,
    projectId,
    tableQualityWorkbook({ withUnit: true }),
    'Export.xlsx'
  );
  const records = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  const graph = {
    nodes: records.map((record, i) => ({
      nodeId: `n-${i}`,
      kind: 'dataset',
      ref: record.id,
      attributes: { columns: record.columns },
      provenance: {
        objectId: object.objectId,
        hash: object.hash,
        location: { sheet: record.sheet },
      },
    })),
  };
  const source = graph.nodes.find((node) => node.kind === 'dataset');
  expect(source).toBeDefined();
  const selected = {
    projectId,
    title: 'Synthetic',
    questionType: { id: 'compare', sources: [source.nodeId] },
    manifest: { externalLinks: [] },
  };
  const { readProjectEvidence } = require('../src/project-manifest-evidence');
  const ctx = {
    call: (action, input) =>
      action === 'project-graph.nodes' ? Promise.resolve(graph) : h.call(action, input),
    meta: require('./helpers/project-ingest').auth(),
  };
  const reply = await readProjectEvidence(ctx, selected, 'Vergleiche die Summen', {
    catalog: [],
    operations: [],
  });
  expect(reply.gaps).toEqual([]);
  expect(reply.evidence).toHaveLength(2);
  expect(reply.evidence.map((hit) => hit.value).join('\n')).toMatch(/Differenz 4 kg/);
  const explicit = await readProjectEvidence(ctx, selected, 'Summe im Blatt Basis', {
    catalog: [],
    operations: [],
  });
  expect(explicit.evidence).toHaveLength(1);
  expect(explicit.evidence[0].value).toContain('40 kg');
});

test('project control correction uses the audited dataset path and preserves query indexes', async () => {
  const projectId = await h.create();
  await h.call('project-file.update', { projectId, projectRefs: [{ conversationId: 'quality' }] });
  await addObject(h, projectId, Buffer.from(tableQualityText({ withUnit: true })), 'Export.csv');
  const [record] = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  llm.generateStructured.mockImplementation(async (_schema, raw) => {
    const input = JSON.parse(raw);
    if (input.instruction?.startsWith('Ordne ausschließlich'))
      return {
        kind: 'restore-rows',
        basis: input.question,
        units: [],
        datasetId: record.id,
        rowNumbers: [record.quality.controls[0].rowNumber],
      };
    return null;
  });
  const reply = await h.call('dataset.turn', {
    question: 'Das ist keine Summenzeile.',
    conversationId: 'quality',
  });
  expect(reply.responseText).toContain('1 Kontrollzeilen');
  const answer = await h.call('dataset.query', { id: record.id, question: 'Summe' });
  expect(answer.result).toEqual([{ 'sum_Amount [kg]': 70 }]);
  const service = h.broker.getLocalService('dataset');
  const pool = await [...service.projectDatasetPools.values()][0];
  expect(
    pool
      .tenant(record.tenantId)
      .prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='index' AND tbl_name = ?")
      .get(record.id).n
  ).toBeGreaterThanOrEqual(2);
});

test('numeric identities allow a late label only when its row is numerically proven as a control', async () => {
  process.env.CET_PROJECT_DATASET_SAMPLE_ROWS = '2';
  process.env.CET_PROJECT_DATASET_BATCH_ROWS = '2';
  const projectId = await h.create();
  const text = tableQualityText({ withUnit: true }).replace(/R00([1-4])/g, (_match, n) =>
    String(1000 + Number(n))
  );
  const object = await addObject(h, projectId, Buffer.from(text), 'Numeric.csv');
  expect(object.extraction.status).toBe('extracted');
  const [record] = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(record.rowCount).toBe(4);
  expect(record.quality.controls).toHaveLength(3);
  expect(record.columns.find((column) => column.name === 'Key').type).toBe('number');
  const answer = await h.call('dataset.query', { id: record.id, question: 'Summe' });
  expect(answer.result).toEqual([{ 'sum_Amount [kg]': 40 }]);
  const invalid = await addObject(
    h,
    projectId,
    Buffer.from('Key,Value\nR001,10\nR002,20\nR003,broken'),
    'Invalid.csv'
  );
  expect(invalid.extraction.status).toBe('failed');
  expect(invalid.extraction.reason).toMatch(/Inconsistent numeric/);
});

test('project metadata corrections do not expand the ordinary dataset deletion path', async () => {
  const projectId = await h.create();
  await h.call('project-file.update', { projectId, projectRefs: [{ conversationId: 'quality' }] });
  await addObject(h, projectId, Buffer.from(tableQualityText({ withUnit: true })), 'Retained.csv');
  const [record] = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  const result = await h.call('dataset.turn', {
    question: `Bitte Datensatz ${record.id} löschen.`,
    conversationId: 'quality',
  });
  expect(result.handled).toBe(false);
  expect(
    (await h.call('datapoint.datasetCatalog', { operation: 'list' })).map((entry) => entry.id)
  ).toContain(record.id);
});
