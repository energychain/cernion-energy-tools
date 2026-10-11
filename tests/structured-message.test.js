'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const {
  generateEdifactFixture,
  syntheticMessage,
  generateEscapedFixture,
} = require('../scripts/generate-edifact-fixtures');
const adapter = require('../src/edifact-message-adapter');
const { tokenizeSegments } = require('../src/edifact-base');
const { parseMscons } = require('../src/edm-mscons-parser');
const Dataset = require('../services/dataset.service');
const Datapoint = require('../services/datapoint.service');

describe('structured message adapter and shared tokenizer', () => {
  test('preserves escaped delimiters at every nesting level and custom UNA', () => {
    expect(tokenizeSegments(generateEscapedFixture())[1].elements[3]).toEqual(["a+b:c'd?e"]);
    expect(tokenizeSegments(generateEscapedFixture(true))[1].elements[3]).toEqual(['a;b*c~d!e']);
  });
  test('recognizes both anomalies with message and segment locations', () => {
    const data = adapter.parse(generateEdifactFixture(), 'Synthetic.txt');
    expect(data.rows).toHaveLength(3);
    expect(data.findings.some((f) => f.code === 'sum_mismatch')).toBe(true);
    expect(data.findings.some((f) => f.code === 'negative_amount')).toBe(true);
    expect(data.findings.every((f) => f.segment > 0)).toBe(true);
    expect(data.findings.filter((f) => /count/.test(f.code))).toEqual([]);
    expect(data.rows.map((r) => r.Betrag)).toEqual([1210, 1227, -25]);
  });
  test('invalid UNT yields a finding, not a crash', () => {
    expect(
      adapter
        .parse(generateEdifactFixture({ badCount: true }), 'Synthetic.txt')
        .findings.filter((f) => f.code === 'unt_count')
    ).toHaveLength(3);
  });
  test('MSCONS uses exactly the same tokenizer and retains edm interpretation', () => {
    const text = syntheticMessage(1, { type: 'MSCONS' });
    const edm = parseMscons(text);
    const adapted = JSON.parse(adapter.parse(text, 'Synthetic').rows[0].Inhalt).timeseries;
    expect(adapted).toEqual(edm);
    expect(edm.locations[0].timeseries[0].values[0]).toMatchObject({
      value: 4.25,
      quality: 'measured',
    });
  });
  test.each(['UTILMD', 'APERAK'])('%s preserves process/status groups', (type) => {
    const row = adapter.parse(syntheticMessage(1, { type }), 'Synthetic').rows[0];
    expect(JSON.parse(row.Inhalt).groups).toHaveLength(1);
  });
  test('large synthetic interchange parses all messages', () => {
    const text = generateEdifactFixture({ count: 150, padding: 100 });
    expect(Buffer.byteLength(text)).toBeGreaterThan(525000);
    expect(adapter.parse(text, 'Synthetic').rows).toHaveLength(150);
  });
});

describe('structured messages in tenant dataset catalog', () => {
  let broker, directory, env;
  const meta = (tenant = 'synthetic-a', flags = []) => ({
    authUser: {
      tenantId: tenant,
      userId: 'synthetic-person',
      name: 'Synthetic Person',
      roles: ['ROLE_EDM'],
      scope: 'full-access',
      sensitivityFlags: flags,
    },
  });
  const call = (action, params, identity = meta()) =>
    broker.call(action, params, { meta: identity });
  beforeAll(async () => {
    env = { ...process.env };
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'structured-message-'));
    process.env.WORKBENCH_DATASET_DB_PATH = path.join(directory, 'rows');
    process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...Datapoint,
      settings: { ...Datapoint.settings, dbPath: path.join(directory, 'catalog') },
    });
    broker.createService(Dataset);
    broker.createService({
      name: 'willi-mako',
      actions: {
        resolveStructure: (ctx) => ({
          success: true,
          data: {
            sources:
              ctx.params.query === 'MOA Qualifier 77'
                ? [
                    {
                      title: 'Synthetic code source',
                      sectionId: 'synthetic-77',
                      excerpt: 'MOA 77: Gesamtbetrag; synthetische Quelle.',
                    },
                  ]
                : [],
          },
        }),
      },
    });
    await broker.start();
  });
  afterAll(async () => {
    await broker.stop();
    process.env = env;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  test('ingests once, follows up deterministically, marks unknown codes and sources', async () => {
    const input = {
      question: 'Was kannst Du mir zu dieser Nachricht sagen?',
      documents: [{ name: 'Synthetic.txt', text: generateEdifactFixture() }],
      conversationId: 'synthetic-chat',
    };
    const answer = await call('dataset.turn', input);
    expect(answer.responseText).toContain('Positionssumme');
    expect(answer.responseText).toContain('Negativer Betrag');
    expect(answer.responseText).toContain('Worum geht');
    expect(answer.responseText).toContain('Quelle: Willi-Mako, Synthetic code source');
    expect(answer.responseText).toContain('Bedeutung ungeklärt');
    expect(answer.documents).toEqual([]);
    const catalog = await call('datapoint.datasetCatalog', { operation: 'list' });
    expect(catalog).toHaveLength(1);
    expect(catalog[0].rowCount).toBe(3);
    const detail = await call('dataset.query', {
      id: catalog[0].id,
      question: 'Schlüssele Rechnung SYN-INV-002 auf',
    });
    expect(detail.result).toHaveLength(1);
    expect(detail.responseText).toContain('1.227');
    expect(detail.responseText).toContain('MOA 203');
    const filtered = await call('dataset.turn', {
      question: 'Welche Rechnungen über 1.000 €?',
      conversationId: 'synthetic-chat',
      documents: [],
    });
    expect(filtered.responseText).toContain('SYN-INV-001');
    expect(filtered.responseText).toContain('SYN-INV-002');
    expect(filtered.responseText).not.toContain('SYN-INV-003');
    expect(filtered.responseText).not.toContain('Worum geht');
    const differentChat = await call('dataset.turn', {
      question: 'Schlüssele Rechnung SYN-INV-002 auf',
      conversationId: 'another-synthetic-chat',
      documents: [],
    });
    expect(differentChat.responseText).toContain('MOA 203');
    await call('dataset.turn', input);
    expect(await call('datapoint.datasetCatalog', { operation: 'list' })).toHaveLength(1);
    const other = await call(
      'dataset.query',
      { id: catalog[0].id, question: 'Überblick' },
      meta('synthetic-b')
    );
    expect(other.datasets).toEqual([]);
    expect(require('../src/llm-client').generateStructured).not.toHaveBeenCalled();
    const ordinary = await call('dataset.turn', {
      question: 'Prüfe das Angebot',
      documents: [
        {
          name: 'Synthetic-offer.txt',
          text: 'Ein synthetischer Fließtext ohne strukturierte Daten.',
        },
      ],
      conversationId: 'synthetic-chat',
    });
    expect(ordinary.handled).toBe(false);
    expect(ordinary.documents).toHaveLength(1);
    const privateDoc = {
      name: 'Synthetic-private.txt',
      text: generateEdifactFixture({ count: 1 }),
      sensitivityLevel: 'highly_sensitive',
      original: { requiredClearance: ['restricted', 'highly_sensitive'] },
    };
    await call(
      'dataset.turn',
      { question: 'Überblick', documents: [privateDoc], conversationId: 'synthetic-private' },
      meta('synthetic-a', ['restricted', 'highly_sensitive'])
    );
    const limited = await call(
      'datapoint.datasetCatalog',
      { operation: 'list' },
      meta('synthetic-a', ['highly_sensitive'])
    );
    expect(limited.some((record) => record.sourceName === privateDoc.name)).toBe(false);
    const full = await call(
      'datapoint.datasetCatalog',
      { operation: 'list' },
      meta('synthetic-a', ['restricted', 'highly_sensitive'])
    );
    expect(full.some((record) => record.sourceName === privateDoc.name)).toBe(true);
  });
});

describe('structured messages preserve ordinary dataset routing', () => {
  test.each(['table-chat', 'message-chat'])(
    'does not steal an ambiguous table sum in %s',
    async (conversationId) => {
      const records = require('../scripts/generate-edifact-fixtures').generateRoutingCatalogFixture(
        conversationId
      );
      const call = jest.fn().mockResolvedValue(records);
      const result = await require('../src/structured-message').structuredTurn(
        {},
        {
          params: { question: 'Wie hoch ist die Summe?', documents: [], conversationId },
          call,
        },
        {}
      );
      expect(result).toBeNull();
      expect(call.mock.calls.every(([action]) => action === 'datapoint.datasetCatalog')).toBe(true);
    }
  );
  test('a general question in another chat does not select the only message', async () => {
    const records = require('../scripts/generate-edifact-fixtures')
      .generateRoutingCatalogFixture('table-chat')
      .filter((record) => record.structuredFormat);
    const call = jest.fn().mockResolvedValue(records);
    const result = await require('../src/structured-message').structuredTurn(
      {},
      {
        params: {
          question: 'Wie hoch ist die Summe?',
          documents: [],
          conversationId: 'unrelated-chat',
        },
        call,
      },
      {}
    );
    expect(result).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });
  test('a newly pasted generated table takes precedence over prior messages', async () => {
    const question =
      'Überblick:\n' +
      require('../scripts/generate-dataset-fixtures').generateDatasetFixture('markdown');
    const call = jest.fn();
    const result = await require('../src/structured-message').structuredTurn(
      {},
      {
        params: { question, documents: [], conversationId: 'message-chat' },
        call,
      },
      {}
    );
    expect(result).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
