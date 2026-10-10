'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const llm = require('../src/llm-client');
const { parseDatasetText } = require('../src/dataset-input');
const { generateDatasetFixture } = require('../scripts/generate-dataset-fixtures');
const Dataset = require('../services/dataset.service');
const Datapoint = require('../services/datapoint.service');

describe('tenant dataset catalog', () => {
  it('normalizes floating and offset timestamps independently of server timezone', () => {
    const { normalizeDatasetTimes } = require('../src/dataset-time');
    const original = process.env.TZ;
    try {
      for (const timezone of ['UTC', 'Europe/Berlin']) {
        process.env.TZ = timezone;
        for (const value of [
          '14.01.2025 18:15',
          '2025-01-14 18:15:00',
          '2025-01-14T18:15:00+01:00',
        ])
          expect(normalizeDatasetTimes([{ Zeit: value }], 'Zeit', 'Europe/Berlin').utc).toEqual([
            '2025-01-14T17:15:00.000Z',
          ]);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it('offers the dataset read only when its backend is available for the turn', () => {
    const { candidatesFor } = require('../src/workbench-capability-loop');
    const options = {
      model: require('../src/function-model').getFunctionModel(),
      index: require('../src/operation-capability-index').loadOperationCapabilityIndex(),
      api: require('../openapi-export.json'),
    };
    const situation = {
      dataNeeds: 'Nutzerdatensatz Spitzenwert',
      hypotheses: [],
      retrievalTerms: [],
    };
    expect(
      candidatesFor(situation, { ...options, datasetAvailable: false }).some(
        (entry) => entry.operation.action === 'dataset.query'
      )
    ).toBe(false);
    expect(
      candidatesFor(situation, { ...options, datasetAvailable: true }).some(
        (entry) => entry.operation.action === 'dataset.query'
      )
    ).toBe(true);
  });
  it('does not parse an assistant draft with labelled lines as a table', () => {
    expect(parseDatasetText('Antwort.\nEntwurf:\nBetreff: Rückmeldung\nGuten Tag,\nText.')).toEqual(
      []
    );
  });
  it('keeps correspondence metadata out of the dataset parser', () => {
    const { mail } = require('./fixtures/workbench-758.json');
    expect(parseDatasetText(mail)).toEqual([]);
  });
  let broker, dir, env;
  const meta = (
    tenantId = 'synthetic-a',
    userId = 'synthetic-person-a',
    sensitivityFlags = []
  ) => ({
    authUser: {
      tenantId,
      userId,
      name: userId,
      roles: ['ROLE_EDM'],
      scope: 'full-access',
      sensitivityFlags,
    },
  });
  const call = (action, input, identity = meta()) => broker.call(action, input, { meta: identity });
  const upload = (format = 'csv', corrected = false) =>
    call('dataset.turn', {
      question: 'Gibt es Auffälligkeiten?',
      documents: [
        { name: 'synthetischer-lastgang.csv', text: generateDatasetFixture(format, corrected) },
      ],
      conversationId: 'synthetic-chat',
    });
  beforeAll(async () => {
    env = { ...process.env };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataset-test-'));
    process.env.DATAPOINT_DB_PATH = path.join(dir, 'catalog');
    process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'rows');
    process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
    llm.generateStructured.mockResolvedValue(null);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...Datapoint,
      settings: { ...Datapoint.settings, dbPath: path.join(dir, 'catalog') },
    });
    broker.createService(Dataset);
    await broker.start();
  });
  afterAll(async () => {
    await broker.stop();
    process.env = env;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each(['csv', 'markdown', 'pairs'])(
    'full synthetic year parses identically: %s',
    (format) => {
      const table = parseDatasetText(generateDatasetFixture(format))[0];
      expect(table.rows).toHaveLength(35040);
      expect(table.hash).toBe(parseDatasetText(generateDatasetFixture('csv'))[0].hash);
    }
  );
  test('persists complete rows, answers anomalies and exact reference calculations', async () => {
    const result = await upload();
    expect(result.responseText).toContain('Hab ich abgelegt:');
    expect(result.responseText).toContain('1.243,7 kW am 14.01.2025 18:15');
    expect(result.responseText).toContain('3.478,874 MWh');
    expect(result.responseText).toContain('4 leere Werte');
    expect(result.responseText).toContain('0 fehlende Zeitintervalle');
    expect(result.responseText).toContain('2 Zeitumstellungen');
    expect(result.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'dataset.query', called: true })])
    );
    const catalog = await call('datapoint.datasetCatalog', { operation: 'list' });
    expect(catalog).toHaveLength(1);
    expect(catalog[0].rowCount).toBe(35040);
    expect(catalog[0].oemetadata._cernion.dataset.provenance.person).toBe('synthetic-person-a');
    const query = await call(
      'dataset.query',
      { question: 'Wie hoch war die Spitzenlast 2025?' },
      meta('synthetic-a', 'synthetic-person-b')
    );
    expect(query.summaries[0].integral / 1000).toBeCloseTo(3478.874, 9);
    expect(query.responseText).toContain('Nutzerangabe von synthetic-person-a');
  });
  test('repeated attachments in all renderings produce neither versions nor confirmations', async () => {
    for (const format of ['csv', 'markdown', 'pairs']) {
      const response = await upload(format);
      expect(response.responseText).not.toContain('Hab ich abgelegt:');
      expect(response.responseText).toContain('1.243,7');
    }
    expect(await call('datapoint.datasetCatalog', { operation: 'list' })).toHaveLength(1);
  });
  test('no source rows or cell samples reach the model', () => {
    expect(llm.generateStructured).toHaveBeenCalled();
    for (const [, prompt] of llm.generateStructured.mock.calls) {
      expect(prompt).not.toContain('14.01.2025 18:15');
      expect(prompt).not.toContain('Zeitstempel (Beginn);');
      expect(prompt).not.toContain('examples');
      expect(prompt).not.toContain('rows":[');
    }
  });
  test('local months and DST days match independent integer CSV totals exactly', async () => {
    const query = await call('dataset.query', { question: 'Monatswerte?' });
    const expected = new Map();
    const daily = new Map();
    for (const line of generateDatasetFixture().split('\n').slice(1)) {
      const [time, value] = line.split(';');
      const month = `${time.slice(6, 10)}-${time.slice(3, 5)}`;
      expected.set(
        month,
        (expected.get(month) || 0) + (value ? Number(value.replace(',', '')) : 0)
      );
      const day = `${time.slice(6, 10)}-${time.slice(3, 5)}-${time.slice(0, 2)}`;
      daily.set(day, (daily.get(day) || 0) + 1);
    }
    expect(query.summaries[0].monthly).toHaveLength(12);
    for (const month of query.summaries[0].monthly)
      expect(month.value).toBeCloseTo(expected.get(month.month) / 40, 7);
    expect(query.summaries[0].daily.find((day) => day.day === '2025-03-30').intervals).toBe(92);
    expect(query.summaries[0].daily.find((day) => day.day === '2025-10-26').intervals).toBe(100);
    expect(daily.get('2025-03-30')).toBe(92);
    expect(daily.get('2025-10-26')).toBe(100);
  });
  test('small throwaway table answers without catalog persistence', async () => {
    const before = await call('datapoint.datasetCatalog', { operation: 'list' });
    const response = await call('dataset.turn', {
      question: 'Berechne die Summe?',
      documents: [{ name: 'Synthetic snippet', text: 'Gruppe;Wert\na;1\nb;2\nc;3\nd;4\ne;5' }],
      conversationId: 'snippet',
    });
    expect(response.responseText).toContain('nur für diese Frage');
    expect(await call('datapoint.datasetCatalog', { operation: 'list' })).toHaveLength(
      before.length
    );
  });
  test('schema-checked SQL filters constrain the entire summary and aggregate with units', async () => {
    const records = await call('datapoint.datasetCatalog', { operation: 'list' });
    const record = records[0];
    const field = 'Wirkleistung Bezug [kW]';
    const query = await call('dataset.query', {
      id: record.id,
      plan: {
        sources: [{ alias: 'table', sourceId: record.id }],
        operations: [
          { op: 'filter', field, operator: 'gt', value: 1000 },
          { op: 'aggregate', metrics: [{ fn: 'sum', field, as: 'Summe' }] },
        ],
      },
    });
    expect(query.summaries[0].rows).toBe(1);
    expect(query.summaries[0].integral).toBeCloseTo(310.925, 9);
    expect(query.result).toEqual([{ Summe: 1243.7 }]);
    expect(query.responseText).toContain('Summe: 1.243,7 kW');
    const month = await call('dataset.query', {
      id: record.id,
      plan: {
        sources: [{ alias: 'table', sourceId: record.id }],
        operations: [
          { op: 'timeBucket', field: 'Zeitstempel (Beginn)', as: 'Monat', interval: 'month' },
          { op: 'aggregate', groupBy: ['Monat'], metrics: [{ fn: 'count', as: 'Intervalle' }] },
        ],
      },
    });
    expect(month.result).toHaveLength(12);
    expect(month.result.reduce((sum, row) => sum + row.Intervalle, 0)).toBe(35040);
  });
  test('multiple sheets and inline XLSX pairs retain all data, multiline headers retain units', () => {
    const sheets = parseDatasetText(
      'Sheet: One\nGruppe;Wert\na;1\nb;2\nSheet: Two\nGruppe;Wert\na;3\nb;4'
    );
    expect(sheets.map((sheet) => [sheet.sheet, sheet.rows.length])).toEqual([
      ['One', 2],
      ['Two', 2],
    ]);
    const inline = parseDatasetText(
      Array.from({ length: 5 }, (_, i) => `Zeit: 01.01.2025 0${i}:00; Wert [kW]: ${i},1`).join('\n')
    );
    expect(inline[0].rows).toHaveLength(5);
    const headers = parseDatasetText(
      'Zeit;Wert\n(Beginn);[kW]\n01.01.2025 00:00;1,0\n01.01.2025 00:15;2,0'
    );
    expect(headers[0].profile.columns.map((column) => column.name)).toContain('Wert [kW]');
  });
  test('confidentiality prevents discovery, querying and mutation without clearance', async () => {
    const identity = meta('synthetic-private', 'synthetic-person', ['restricted']);
    await call(
      'dataset.turn',
      {
        question: 'Speichern und Daten prüfen?',
        documents: [
          { name: 'Synthetic private', text: 'ID;Wert\nsynthetic-id-a;1\nsynthetic-id-b;2' },
        ],
        conversationId: 'private',
        sensitivityLevel: 'restricted',
      },
      identity
    );
    const privateRecords = await call('datapoint.datasetCatalog', { operation: 'list' }, identity);
    expect(privateRecords).toHaveLength(1);
    expect(
      await call('datapoint.datasetCatalog', { operation: 'list' }, meta('synthetic-private'))
    ).toEqual([]);
    expect(
      (await call('dataset.query', { id: privateRecords[0].id }, meta('synthetic-private')))
        .datasets
    ).toEqual([]);
    await expect(
      call(
        'datapoint.datasetCatalog',
        { operation: 'remove', id: privateRecords[0].id },
        meta('synthetic-private')
      )
    ).rejects.toThrow();
  });
  test('foreign tenant cannot discover or read catalog, public datapoint listing excludes it', async () => {
    const records = await call('datapoint.datasetCatalog', { operation: 'list' });
    expect(
      await call('datapoint.datasetCatalog', { operation: 'list' }, meta('synthetic-b'))
    ).toEqual([]);
    expect(
      (await call('dataset.query', { id: records[0].id }, meta('synthetic-b'))).datasets
    ).toEqual([]);
    expect((await call('datapoint.list', {})).datapoints).toEqual([]);
  });
  test('corrected content gets a new version while old rows remain queryable', async () => {
    await upload('csv', true);
    const records = await call('datapoint.datasetCatalog', { operation: 'list' });
    expect(records).toHaveLength(2);
    const first = records.find((record) => record.version === 1);
    const historical = await call('dataset.query', { id: first.id, version: 1 });
    expect(historical.summaries[0].integral / 1000).toBeCloseTo(3478.874, 9);
  });
  test('semantic correction changes energy calculation without row upload', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      title: 'synthetischer-lastgang.csv',
      timezone: 'Europe/Berlin',
      units: { 'Wirkleistung Bezug [kW]': 'kWh' },
      assumptions: [],
    });
    await call('dataset.turn', {
      question: 'Die Werte sind kWh je Viertelstunde.',
      conversationId: 'synthetic-chat',
    });
    const query = await call('dataset.query', {});
    expect(query.summaries[0].integralUnit).toBe('kWh');
    expect(query.summaries[0].integral / 1000).toBeCloseTo((3478.874 + 0.00025) * 4, 8);
  });
  test('byte limit refuses the whole dataset', async () => {
    process.env.WORKBENCH_DATASET_MAX_BYTES = '100';
    await expect(upload()).rejects.toMatchObject({ type: 'WORKBENCH_DATASET_LIMIT' });
    delete process.env.WORKBENCH_DATASET_MAX_BYTES;
  });
  test('row and column limits reject instead of truncating', async () => {
    process.env.WORKBENCH_DATASET_MAX_ROWS = '100';
    await expect(upload()).rejects.toMatchObject({ type: 'WORKBENCH_DATASET_LIMIT' });
    delete process.env.WORKBENCH_DATASET_MAX_ROWS;
    process.env.WORKBENCH_DATASET_MAX_COLUMNS = '1';
    await expect(upload()).rejects.toMatchObject({ type: 'WORKBENCH_DATASET_LIMIT' });
    delete process.env.WORKBENCH_DATASET_MAX_COLUMNS;
  });
  test('read capability accepts no SQL, foreign plans or mutation', async () => {
    const records = await call('datapoint.datasetCatalog', { operation: 'list' });
    await expect(
      call('dataset.query', {
        plan: {
          sources: [{ alias: 'table', sourceId: records[0].id }],
          operations: [{ op: 'delete' }],
        },
      })
    ).rejects.toThrow();
  });
  test('delete removes all versions and physical tables', async () => {
    const records = await call('datapoint.datasetCatalog', { operation: 'list' });
    const result = await call('dataset.turn', {
      question: 'Lösch den Datensatz synthetischer-lastgang.csv.',
      conversationId: 'synthetic-chat',
    });
    expect(result.responseText).toContain('physisch gelöscht');
    expect(await call('datapoint.datasetCatalog', { operation: 'list' })).toEqual([]);
    const pool = broker.getLocalService('dataset').datasetPool;
    for (const record of records)
      expect(
        pool
          .tenant('synthetic-a')
          .prepare('SELECT name FROM sqlite_master WHERE name = ?')
          .get(record.id)
      ).toBeUndefined();
    const audits = await broker.getLocalService('datapoint').db.allDocs({
      startkey: 'dataset-audit:',
      endkey: 'dataset-audit:\uffff',
      include_docs: true,
    });
    expect(
      audits.rows.some(
        (row) => row.doc.kind === 'deleted' && row.doc.actorId === 'synthetic-person-a'
      )
    ).toBe(true);
  });
  test('deleted attachment replay neither recreates it nor deletes a different dataset', async () => {
    const replayed = await upload('pairs');
    expect(replayed.handled).toBe(true);
    expect(replayed.responseText).toContain('kein zugänglicher Datensatz');
    expect(replayed.responseText).not.toContain('Hab ich abgelegt:');
    await call('dataset.turn', {
      question: 'Bitte speichern.',
      documents: [{ name: 'andere-synthetische-tabelle.csv', text: 'Tag;Wert\nA;2\nB;4' }],
      conversationId: 'synthetic-other-chat',
    });
    const repeatedDelete = await call('dataset.turn', {
      question: 'Lösch den Datensatz synthetischer-lastgang.csv.',
      documents: [{ name: 'synthetischer-lastgang.csv', text: generateDatasetFixture('markdown') }],
      conversationId: 'synthetic-chat',
    });
    expect(repeatedDelete.responseText).toContain('kein zugänglicher Datensatz');
    const records = await call('datapoint.datasetCatalog', { operation: 'list' });
    expect(records).toHaveLength(1);
    expect(records[0].sourceName).toBe('andere-synthetische-tabelle.csv');
    const newContent = await call('dataset.turn', {
      question: 'Wie hoch war das Maximum in synthetischer-lastgang.csv?',
      documents: [
        { name: 'synthetischer-lastgang.csv', text: generateDatasetFixture('csv') },
        {
          name: 'synthetischer-lastgang.csv',
          text: 'Zeit;Wert [kW]\n01.01.2026 00:00;2\n01.01.2026 00:15;4',
        },
      ],
      conversationId: 'synthetic-chat',
    });
    expect(newContent.responseText).toContain('4 kW');
    const current = await call('datapoint.datasetCatalog', { operation: 'list' });
    expect(current).toHaveLength(2);
    expect(
      current.find((record) => record.sourceName === 'synthetischer-lastgang.csv').rowCount
    ).toBe(2);
  });
});
