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
const { Readable } = require('node:stream');
const iconv = require('iconv-lite');
const llm = require('../src/llm-client');
const { auth, zip } = require('./helpers/project-ingest');
const { structureHarness, addObject } = require('./helpers/project-structure');
const { csvRows, xlsxSheets } = require('../src/project-structure-stream');
const { objectType, capability } = require('../src/project-structure-policy');
const { ProjectDatasetPool } = require('../src/project-dataset-pool');
const { scopedDatasets } = require('../src/workbench-data-scope');
const { objectCapability } = require('../src/project-file-ingest-policy');
let dir, h, env;

beforeEach(async () => {
  env = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-structure-885-'));
  process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
  llm.generateStructured.mockReset().mockImplementation(async (_schema, prompt) => {
    if (prompt.includes('assertions=[]'))
      return {
        assertions: [],
        correction: { kind: 'none', basis: '', factId: '' },
        query: { requested: false, anchor: '', functionLabel: '' },
      };
    return undefined;
  });
});
afterEach(async () => {
  if (h) await h.broker.stop();
  h = null;
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = env;
  jest.restoreAllMocks();
});

test.each([
  ['a.csv', 'csv'],
  ['a.tsv', 'csv'],
  ['a.xlsx', 'xlsx'],
  ['a.pdf', 'pdf'],
  ['a.docx', 'docx'],
  ['a.pptx', 'pptx'],
  ['a.txt', 'txt'],
  ['a.eml', 'eml'],
  ['a.bin', 'unknown'],
  ['a.edi', 'structured'],
])('detects %s as %s', (name, type) => expect(objectType({ name })).toBe(type));

test('streaming CSV reuses delimiter detection across byte, quote, CRLF and encoding boundaries', async () => {
  let closed = false;
  async function* invalidHeader() {
    try {
      yield ['Duplicate', 'Duplicate'];
      yield ['a', 'b'];
    } finally {
      closed = true;
    }
  }
  await expect(
    require('../src/project-structure-table').structureTable({}, {}, '', invalidHeader(), null)
  ).rejects.toThrow('duplicate');
  expect(closed).toBe(true);
  for (const encoding of ['utf8', 'windows-1252', 'utf16le']) {
    const bytes = iconv.encode('A;B\r\n"Müller\nZwei";"a""b"\r\nx;3\r\n', encoding, {
      addBOM: encoding === 'utf16le',
    });
    const pieces = Array.from(bytes, (byte) => Buffer.from([byte]));
    const rows = [];
    for await (const row of csvRows(Readable.from(pieces), 'a.csv')) rows.push(row);
    expect(rows).toEqual([
      ['A', 'B'],
      ['Müller\nZwei', 'a"b'],
      ['x', '3'],
    ]);
  }
  await expect(async () => {
    for await (const _row of csvRows(Readable.from([Buffer.from('A,B\n"bad')]), 'a.csv')) {
      /* consume */
    }
  }).rejects.toThrow('quote');
});

test('AC-01/04/05 project files, known aggregates, bounded batches, prompt privacy, live reference scope and archive exclusion', async () => {
  h = await structureHarness(dir);
  const projectId = await h.create();
  await h.call('project-file.update', {
    projectId,
    projectRefs: [{ conversationId: 'chat-a' }, { caseId: 'case-a' }],
  });
  process.env.CET_PROJECT_DATASET_BATCH_ROWS = '2';
  const append = jest.spyOn(ProjectDatasetPool.prototype, 'appendRows');
  const object = await addObject(
    h,
    projectId,
    Buffer.from(
      'Key,Amount,Timestamp\nprivate-cell-a,11,2025-01-01T00:00:00Z\nprivate-cell-b,23,2025-01-01T00:15:00Z\nprivate-cell-c,37,2025-01-01T00:30:00Z'
    ),
    'alpha.csv'
  );
  expect(object.extraction).toMatchObject({ status: 'extracted' });
  const records = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(records).toHaveLength(1);
  const record = records[0];
  expect(record.provenance).toMatchObject({ projectId, objectId: object.objectId });
  expect(append.mock.calls.every((call) => call[1].length <= 2)).toBe(true);
  const answer = await h.call('dataset.query', { id: record.id, question: 'Summe Amount' });
  expect(answer.result).toEqual([{ sum_Amount: 71 }]);
  expect(scopedDatasets(records, 'Summe', { conversationId: 'chat-a' })).toHaveLength(1);
  expect(scopedDatasets(records, 'Summe', { caseId: 'case-a' })).toHaveLength(1);
  expect(scopedDatasets(records, 'alpha.csv', { conversationId: 'other' })).toEqual([]);
  expect(scopedDatasets(records, 'Summe')).toEqual([]);
  for (const call of llm.generateStructured.mock.calls) {
    expect(call[1]).not.toMatch(/private-cell|"rows"\s*:|"examples"\s*:/);
  }
  const filename = path.join(dir, 'originals', 'id-tenant-a', `id-${projectId}`, 'project.sqlite');
  expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  const Database = require('better-sqlite3');
  const db = new Database(filename, { readonly: true });
  expect(db.prepare('SELECT COUNT(*) AS n FROM project_candidates').get().n).toBeGreaterThan(0);
  expect(
    db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name LIKE 'ds_%'")
      .get().n
  ).toBeGreaterThan(0);
  db.close();
  const before = append.mock.calls.length;
  await h.broker.call(
    'project-structure.run',
    { projectId, objectId: object.objectId },
    { meta: { ...auth(), projectStructure: capability } }
  );
  expect(append).toHaveBeenCalledTimes(before);
  await h.call('project-file.archive', { projectId });
  expect(await h.call('datapoint.datasetCatalog', { operation: 'list' })).toEqual([]);
  expect((await h.call('dataset.query', { id: record.id })).datasets).toEqual([]);
});

test('physical isolation across projects and tenants, traversal-safe paths and symlink rejection', async () => {
  const pools = [];
  for (const [tenant, project] of [
    ['a', 'x'],
    ['a', 'y'],
    ['b', 'x'],
    ['../a', '../x'],
  ]) {
    const pool = await ProjectDatasetPool.open(dir, tenant, project);
    const id = 'ds_' + 'a'.repeat(32);
    pool.putRows(tenant, id, [{ v: tenant + project }], [{ name: 'v', type: 'string' }]);
    expect(pool.rows(tenant, id, [{ name: 'v' }])).toEqual([{ v: tenant + project }]);
    expect(() => pool.tenant('foreign')).toThrow('tenant mismatch');
    pools.push(pool);
  }
  expect(new Set(pools.map((pool) => pool.filename)).size).toBe(4);
  pools.forEach((pool) => pool.closeAll());
  const project = path.join(dir, 'id-c', 'id-z');
  fs.mkdirSync(project, { recursive: true });
  fs.symlinkSync(pools[0].filename, path.join(project, 'project.sqlite'));
  await expect(ProjectDatasetPool.open(dir, 'c', 'z')).rejects.toThrow('Unsafe');
});

test('AC-02 streams multiple XLSX worksheets with shared strings and cached dates', async () => {
  const XLSX = require('xlsx');
  const book = XLSX.utils.book_new();
  for (const sheet of ['Alpha', 'Beta'])
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Label', 'Amount'],
        ['shared-value', 7],
        ['shared-value', 9],
      ]),
      sheet
    );
  const filename = path.join(dir, 'fixture.xlsx');
  fs.writeFileSync(filename, XLSX.write(book, { type: 'buffer', bookType: 'xlsx', bookSST: true }));
  const found = [];
  for await (const sheet of xlsxSheets(filename)) {
    const rows = [];
    for await (const row of sheet.rows) rows.push(row);
    found.push({ name: sheet.name, rows });
  }
  expect(found).toHaveLength(2);
  expect(found[1].rows).toEqual([
    ['Label', 'Amount'],
    ['shared-value', '7'],
    ['shared-value', '9'],
  ]);
  h = await structureHarness(dir);
  const projectId = await h.create();
  const object = await addObject(h, projectId, fs.readFileSync(filename), 'sheets.xlsx');
  expect(object.extraction).toMatchObject({ status: 'extracted' });
  expect(
    (await h.call('datapoint.datasetCatalog', { operation: 'list' })).map(
      (record) => record.provenance.sheet
    )
  ).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  process.env.CET_PROJECT_XLSX_SHARED_STRING_BYTES = '1';
  await expect(async () => {
    for await (const _sheet of xlsxSheets(filename)) {
      /* consume */
    }
  }).rejects.toThrow('Shared string budget');
});

test('AC-06 partial errors degrade the project, keep successful objects and clean everything idempotently', async () => {
  h = await structureHarness(dir);
  const projectId = await h.create();
  const good = await addObject(h, projectId, Buffer.from('Label,Amount\nA,4\nB,6'), 'valid.csv');
  const bad = await addObject(h, projectId, Buffer.from('Label,Amount\nA,"unclosed'), 'bad.csv');
  expect(good.extraction.status).toBe('extracted');
  expect(bad.extraction).toMatchObject({
    status: 'failed',
    reason: expect.stringMatching(/quote/),
  });
  expect((await h.call('project-file.get', { projectId })).lifecycle).toBe('degraded');
  expect(await h.call('datapoint.datasetCatalog', { operation: 'list' })).toHaveLength(1);
  await h.call('project-file.delete', { projectId });
  expect(await h.call('datapoint.datasetCatalog', { operation: 'list' })).toEqual([]);
  const meta = {
    ...auth(),
    projectFileOriginals: require('../src/project-file-policy').fileCapability,
  };
  await h.broker.call(
    'project-structure.deleteProject',
    { version: 1, tenantId: 'tenant-a', projectId },
    { meta }
  );
  expect(
    fs.existsSync(path.join(dir, 'originals', 'id-tenant-a', `id-${projectId}`, 'project.sqlite'))
  ).toBe(false);
});

test('durable received originals recover after restart and stale derivation versions rebuild once', async () => {
  h = await structureHarness(dir, { enabled: false });
  const projectId = await h.create();
  const object = await addObject(h, projectId, Buffer.from('Label,Amount\nA,4\nB,6'), 'resume.csv');
  expect(object.extraction.status).toBe('pending');
  await h.broker.stop();
  h = await structureHarness(dir);
  const current = (await h.call('project-upload.objects', { projectId }))[0];
  expect(current.extraction).toMatchObject({ status: 'extracted' });
  const raw = await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'get', projectId, recordId: object.objectId },
    { meta: { ...auth(), projectObjectStore: objectCapability } }
  );
  raw.derivation.version = 'older';
  await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'put', projectId, recordId: object.objectId, record: raw },
    { meta: { ...auth(), projectObjectStore: objectCapability } }
  );
  await h.broker.stop();
  h = await structureHarness(dir);
  expect(await h.call('datapoint.datasetCatalog', { operation: 'list' })).toHaveLength(1);
  expect((await h.call('project-file.get', { projectId })).stats.datasets).toBe(1);
  const complete = await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'get', projectId, recordId: object.objectId },
    { meta: { ...auth(), projectObjectStore: objectCapability } }
  );
  complete.ingestState = 'processing';
  await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'put', projectId, recordId: object.objectId, record: complete },
    { meta: { ...auth(), projectObjectStore: objectCapability } }
  );
  await h.broker.stop();
  const append = jest.spyOn(ProjectDatasetPool.prototype, 'appendRows');
  h = await structureHarness(dir);
  expect(append).not.toHaveBeenCalled();
  expect((await h.call('project-upload.objects', { projectId }))[0].ingestState).toBe('complete');
});

test('AC-03 PDF/DOCX/PPTX/TXT sections preserve original locations and project provenance', async () => {
  h = await structureHarness(dir);
  const projectId = await h.create();
  const docx = zip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>') },
    {
      name: 'word/document.xml',
      bytes: Buffer.from(
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Kapitel 1 Übersicht</w:t></w:r></w:p><w:p><w:r><w:t>private-document-value</w:t></w:r></w:p></w:body></w:document>'
      ),
    },
  ]);
  const pptx = zip([
    { name: '[Content_Types].xml', bytes: Buffer.from('<Types/>') },
    { name: 'ppt/presentation.xml', bytes: Buffer.from('<presentation/>') },
    ...[1, 2].map((index) => ({
      name: `ppt/slides/slide${index}.xml`,
      bytes: Buffer.from(
        `<slide xmlns:a="a"><a:p><a:r><a:t>Slide ${index} private-document-value</a:t></a:r></a:p></slide>`
      ),
    })),
  ]);
  for (const [name, bytes] of [
    ['notes.docx', docx],
    ['slides.pptx', pptx],
    ['text.txt', Buffer.from('Chapter 1 Summary\nprivate-document-value')],
  ]) {
    const object = await addObject(h, projectId, bytes, name);
    expect(object.extraction).toMatchObject({ status: 'extracted' });
  }
  const PDFDocument = require('pdfkit');
  const pdf = new PDFDocument({ autoFirstPage: false });
  const pieces = [];
  pdf.on('data', (bytes) => pieces.push(bytes));
  const finished = new Promise((resolve) => pdf.on('end', resolve));
  pdf.addPage().text('Page alpha private-document-value');
  pdf.addPage().text('Page beta private-document-value');
  pdf.end();
  await finished;
  expect(
    (await addObject(h, projectId, Buffer.concat(pieces), 'pages.pdf')).extraction
  ).toMatchObject({ status: 'extracted' });
  const docs = await h.call('knowledge-rag.documentList', {});
  expect(docs.every((doc) => doc.provenance.projectId === projectId)).toBe(true);
  expect(docs.some((doc) => doc.sourceLocation.page === 2)).toBe(true);
  expect(docs.some((doc) => doc.sourceLocation.slide === 2)).toBe(true);
  const hits = await h.call('knowledge-rag.documentSearch', {
    query: 'private-document-value',
    limit: 20,
  });
  expect(hits.some((hit) => hit.metadata.location.includes('page 2'))).toBe(true);
  expect(hits.every((hit) => hit.metadata.projectId === projectId)).toBe(true);
  expect(
    llm.generateStructured.mock.calls.some((call) => {
      const input = JSON.parse(call[1]);
      return (
        input.document?.includes('private-document-value') &&
        input.instruction.includes('untrusted')
      );
    })
  ).toBe(true);
  await h.call('project-file.delete', { projectId });
  expect(await h.call('knowledge-rag.documentList', {})).toEqual([]);
});

test('synthetic files from two catalog domains keep independent table and document provenance', async () => {
  h = await structureHarness(dir);
  for (const fixture of require('./fixtures/project-structure-cases.json')) {
    const projectId = await h.create();
    await addObject(h, projectId, Buffer.from(fixture.table), `${fixture.id}.csv`);
    const document = await addObject(
      h,
      projectId,
      Buffer.from(fixture.document),
      `${fixture.id}.txt`
    );
    expect(document.extraction.status).toBe('extracted');
    const record = (await h.call('datapoint.datasetCatalog', { operation: 'list' })).find(
      (entry) => entry.provenance.projectId === projectId
    );
    const answer = await h.call('dataset.query', {
      id: record.id,
      question: `Summe ${fixture.field}`,
    });
    expect(answer.result[0][`sum_${fixture.field}`]).toBe(fixture.total);
    const documents = await h.call('knowledge-rag.documentList', {});
    expect(documents.some((entry) => entry.provenance.objectId === document.objectId)).toBe(true);
  }
});

test('project row/column limits do not use chat limits, and unknown originals retain a reason', async () => {
  process.env.WORKBENCH_DATASET_MAX_ROWS = '1';
  process.env.CET_PROJECT_DATASET_MAX_ROWS = '2';
  h = await structureHarness(dir);
  const projectId = await h.create();
  expect(
    (await addObject(h, projectId, Buffer.from('A,B\nx,1\ny,2'), 'two.csv')).extraction.status
  ).toBe('extracted');
  expect(
    (await addObject(h, projectId, Buffer.from('A,B\nx,1\ny,2\nz,3'), 'three.csv')).extraction
  ).toMatchObject({ status: 'failed', reason: expect.stringContaining('row limit') });
  process.env.CET_PROJECT_DATASET_MAX_COLUMNS = '1';
  expect(
    (await addObject(h, projectId, Buffer.from('A,B\nx,1'), 'wide.csv')).extraction.status
  ).toBe('failed');
  const unknown = await addObject(h, projectId, Buffer.from('original-only'), 'unknown.bin');
  expect(unknown.extraction).toMatchObject({
    status: 'extracted',
    reason: expect.stringContaining('Unsupported'),
  });
  await expect(
    h.call('project-structure.run', { projectId, objectId: unknown.objectId })
  ).rejects.toMatchObject({ code: 403 });
  await expect(h.call('object-store.projectStructurePending', {})).rejects.toMatchObject({
    code: 403,
  });
});

test('time normalization preserves repeated wall clocks across single-row batches', async () => {
  const { normalizeDatasetTimes } = require('../src/dataset-time');
  const rows = [
    '2025-10-26 02:30:00',
    '2025-10-26 02:45:00',
    '2025-10-26 02:00:00',
    '2025-10-26 02:15:00',
    '2025-10-26 02:30:00',
  ];
  let state = {};
  const instants = [];
  for (const value of rows) {
    const normalized = normalizeDatasetTimes([{ time: value }], 'time', 'Europe/Berlin', 15, state);
    state = normalized.state;
    instants.push(...normalized.utc);
  }
  expect(instants).toEqual(
    normalizeDatasetTimes(
      rows.map((time) => ({ time })),
      'time',
      'Europe/Berlin',
      15
    ).utc
  );
});

test('large multi-sheet XML is read incrementally and formulas, XML declarations and relationships fail closed', async () => {
  const count = Number(process.env.CET_PROJECT_XLSX_TEST_ROWS || 10000);
  const XLSX = require('xlsx');
  const book = XLSX.utils.book_new();
  for (const name of ['Alpha', 'Beta'])
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Label', 'Amount'],
        ...Array.from({ length: count }, (_, index) => [`item-${index}`, index]),
      ]),
      name
    );
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', bookSST: true });
  const filename = path.join(dir, 'large.xlsx');
  fs.writeFileSync(filename, bytes);
  const read = jest.spyOn(XLSX, 'read').mockImplementation(() => {
    throw new Error('Whole-workbook reader forbidden');
  });
  for await (const sheet of xlsxSheets(filename)) {
    let rows = 0,
      sum = 0;
    for await (const row of sheet.rows) {
      if (rows++) sum += Number(row[1]);
    }
    expect(rows).toBe(count + 1);
    expect(sum).toBe((count * (count - 1)) / 2);
  }
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
  book.Sheets.Alpha.B2 = { t: 'n', f: '1+1' };
  fs.writeFileSync(filename, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  await expect(async () => {
    for await (const sheet of xlsxSheets(filename))
      for await (const _row of sheet.rows) {
        /* consume */
      }
  }).rejects.toThrow('Missing cached formula');
  const { xmlValues } = require('../src/project-structure-stream');
  for (const source of [
    '<!DOCTYPE x [<!ENTITY a "bad">]><x>&a;</x>',
    '<x><Relationship TargetMode="External"/></x>',
  ]) {
    const archive = zip([{ name: 'part.xml', bytes: Buffer.from(source) }]);
    fs.writeFileSync(filename, archive);
    const [entry] = await require('../src/project-file-zip').zipDirectory(filename, {
      entries: 10,
      depth: 32,
      budget: 10000,
      fileBytes: 10000,
      ratio: 200,
    });
    await expect(async () => {
      for await (const _part of xmlValues(filename, entry, 'x')) {
        /* consume */
      }
    }).rejects.toThrow('Unsafe');
  }
});

test('structured messages reuse the existing adapter and query path without raw prompt content', async () => {
  h = await structureHarness(dir);
  const projectId = await h.create();
  const text =
    "UNB+UNOC:3+SENDER+RECEIVER+250101:1200+REF'UNH+1+MSCONS:D:04B:UN'BGM+7+REF-01'UNT+3+1'UNZ+1+REF'";
  const object = await addObject(h, projectId, Buffer.from(text), 'message.edi');
  expect(object.extraction).toMatchObject({ status: 'extracted' });
  const [record] = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(record.structuredFormat).toBe('edifact');
  const result = await h.call('dataset.query', { id: record.id, question: 'Zusammenfassung' });
  expect(result.datasetId).toBe(record.id);
  expect(llm.generateStructured.mock.calls.every((call) => !call[1].includes('REF-01'))).toBe(true);
});

test('membership, deletion-incomplete and changed references are checked at read time', async () => {
  h = await structureHarness(dir);
  h.broker.getLocalService('project-file').settings.cleanupActions = ['synthetic.cleanup'];
  let fail = true;
  h.broker.createService({
    name: 'synthetic',
    actions: {
      cleanup: () => {
        if (fail) throw new Error('Retry cleanup');
        return { deleted: true };
      },
    },
  });
  const projectId = await h.create();
  await addObject(h, projectId, Buffer.from('Label,Amount\nA,4\nB,6'), 'table.csv');
  await h.call('project-file.update', {
    projectId,
    projectRefs: [{ conversationId: 'new' }],
    members: ['actor-a'],
  });
  const records = await h.call('datapoint.datasetCatalog', { operation: 'list' });
  expect(scopedDatasets(records, '', { conversationId: 'new' })).toHaveLength(1);
  expect(scopedDatasets(records, '', { conversationId: 'old' })).toEqual([]);
  expect(
    await h.call('datapoint.datasetCatalog', { operation: 'list' }, auth('tenant-a', [], 'actor-b'))
  ).toEqual([]);
  await expect(h.call('project-file.delete', { projectId })).rejects.toMatchObject({
    type: 'PROJECT_DELETE_INCOMPLETE',
  });
  expect(await h.call('datapoint.datasetCatalog', { operation: 'list' })).toEqual([]);
  fail = false;
  expect(await h.call('project-file.delete', { projectId })).toMatchObject({ deleted: true });
});

test('project prose uses untrusted extraction and deferred regular memory checking, and cleanup invalidates it', async () => {
  h = await structureHarness(dir);
  const projectId = await h.create();
  const quote = 'Die gemeinsam genutzte Werkstatt Delta bleibt bis Januar gesperrt.';
  const start = jest.spyOn(require('../src/tenant-memory'), 'start');
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const input = JSON.parse(prompt);
    if (!input.document) return undefined;
    return {
      assertions: [
        {
          text: quote,
          basis: quote,
          scope: 'organization',
          commitment: 'decided',
          anchors: [{ value: 'Werkstatt Delta', qualifier: '', aliases: [] }],
          time: { from: '', until: '', latest: '', earliest: '', date: '' },
          expiresAt: '',
        },
      ],
      correction: { kind: 'none', basis: '', factId: '' },
      query: { requested: false, anchor: '', functionLabel: '' },
    };
  });
  const object = await addObject(
    h,
    projectId,
    Buffer.from(`Chapter 1 Overview\n${quote}\nprivate-body-only-885\n`),
    'notes.txt'
  );
  expect(object.extraction.status).toBe('extracted');
  const store = require('../src/tenant-memory-store');
  const ctx = h.broker.ContextFactory.create(h.broker, null, {}, { meta: auth() });
  const p = require('../src/domain-router-policy').principal(ctx);
  const facts = await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({
    text: quote,
    checking: 'complete',
    documentSource: { projectId, objectId: object.objectId },
  });
  expect(facts[0].assessmentScope).toBeUndefined();
  expect(JSON.stringify(facts)).toContain('private-body-only-885');
  const input = JSON.parse(
    llm.generateStructured.mock.calls.find((call) =>
      JSON.parse(call[1]).document?.includes('private-body-only-885')
    )[1]
  );
  expect(input.document).toContain(quote);
  expect(input.instruction).toContain('untrusted');
  expect(start).toHaveBeenCalled();
  expect(start.mock.results[0].value).toMatchObject({ deferred: true, renderedConfirmation: true });
  expect(start.mock.calls[0][3].envelope.userRequest).toContain('private-body-only-885');
  const secondQuote = 'Die gemeinsam genutzte Werkstatt Delta öffnet im Februar.';
  llm.generateStructured.mockImplementation(async (_schema, prompt) => {
    const value = JSON.parse(prompt);
    if (!value.document) throw new Error('Assessment temporarily unavailable');
    return {
      assertions: [
        {
          text: secondQuote,
          basis: secondQuote,
          scope: 'organization',
          commitment: 'decided',
          anchors: [{ value: 'Werkstatt Delta', qualifier: '', aliases: [] }],
          time: { from: '', until: '', latest: '', earliest: '', date: '' },
          expiresAt: '',
        },
      ],
      correction: { kind: 'none', basis: '', factId: '' },
      query: { requested: false, anchor: '', functionLabel: '' },
    };
  });
  await addObject(h, projectId, Buffer.from(secondQuote), 'further.txt');
  const checked = await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
  expect(checked.find((fact) => fact.text === secondQuote)).toMatchObject({ checking: 'pending' });
  expect(
    llm.generateStructured.mock.calls.some((call) => JSON.parse(call[1]).candidates?.length)
  ).toBe(true);
  jest
    .spyOn(h.broker.getLocalService('knowledge-rag'), 'objectDelete')
    .mockRejectedValueOnce(new Error('Index cleanup interrupted'));
  await expect(h.call('project-file.delete', { projectId })).rejects.toMatchObject({
    type: 'PROJECT_DELETE_INCOMPLETE',
  });
  await h.call('project-file.delete', { projectId });
  expect((await store.query(ctx, p, { 'payload.type': 'tenant_memory_fact' }))[0]).toMatchObject({
    status: 'deleted',
    text: '',
  });
});

test('project memory caps actual extraction sections per object/project while all text stays searchable', async () => {
  process.env.CET_PROJECT_DOCUMENT_SECTION_CHARS = '256';
  process.env.CET_PROJECT_MEMORY_MAX_SECTIONS_PER_OBJECT = '2';
  process.env.CET_PROJECT_MEMORY_MAX_SECTIONS_PER_PROJECT = '3';
  h = await structureHarness(dir);
  const projectId = await h.create();
  const text = 'Searchable remaining document text. '.repeat(45);
  const first = await addObject(h, projectId, Buffer.from(text), 'first.txt');
  expect(first.memory).toMatchObject({ attemptedSections: 2, extractedSections: 2 });
  expect(first.memory.skippedSections).toBeGreaterThan(0);
  const second = await addObject(h, projectId, Buffer.from(text), 'second.txt');
  expect(second.memory).toMatchObject({ attemptedSections: 1, extractedSections: 1 });
  expect(second.memory.skippedSections).toBeGreaterThan(first.memory.skippedSections);
  await h.broker.stop();
  h = await structureHarness(dir);
  const third = await addObject(
    h,
    projectId,
    Buffer.from(text + ' DistinctiveThirdMarker'),
    'third.txt'
  );
  expect(third.memory).toMatchObject({ attemptedSections: 0, extractedSections: 0 });
  expect(third.memory.skippedSections).toBeGreaterThan(0);
  const documents = await h.call('knowledge-rag.documentList', {});
  const skipped = documents.filter((doc) => doc.provenance.objectId === third.objectId);
  expect(skipped.length).toBeGreaterThan(2);
  expect((await h.call('knowledge-rag.documentGet', { id: skipped.at(-1).id })).text).toContain(
    'document text'
  );
  expect(
    (
      await h.call('knowledge-rag.documentSearch', { query: 'DistinctiveThirdMarker', limit: 20 })
    ).some((hit) => hit.metadata.objectId === third.objectId)
  ).toBe(true);
  const otherProject = await h.create();
  const other = await addObject(h, otherProject, Buffer.from(text), 'independent.txt');
  expect(other.memory.extractedSections).toBe(2);
  expect(
    llm.generateStructured.mock.calls.filter((call) => JSON.parse(call[1]).document)
  ).toHaveLength(5);
});

test('failed extraction reservations survive restart and consume the project budget', async () => {
  process.env.CET_PROJECT_MEMORY_MAX_SECTIONS_PER_PROJECT = '1';
  h = await structureHarness(dir);
  const projectId = await h.create();
  llm.generateStructured.mockRejectedValue(new Error('Extraction unavailable'));
  const failed = await addObject(h, projectId, Buffer.from('A readable source.'), 'failed.txt');
  expect(failed.extraction.status).toBe('failed');
  expect(failed.memory).toMatchObject({ attemptedSections: 1, extractedSections: 0 });
  await h.broker.stop();
  h = await structureHarness(dir);
  const next = await addObject(h, projectId, Buffer.from('Another readable source.'), 'next.txt');
  expect(next.extraction.status).toBe('extracted');
  expect(next.memory).toMatchObject({
    attemptedSections: 0,
    extractedSections: 0,
    skippedSections: 1,
  });
  expect(llm.generateStructured).toHaveBeenCalledTimes(1);
});
