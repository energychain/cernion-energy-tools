'use strict';
jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn().mockResolvedValue(null),
  generateText: jest.fn().mockResolvedValue('Synthetische Antwort.'),
}));
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { syntheticWorkbook } = require('./helpers/file-channel-fixtures');
const { prepareFileTurn } = require('../src/file-channel-turn');
const { namespace, storeCapability } = require('../src/file-channel-policy');

test('original workbook enters #774 with both sheets, cached formulas and confidentiality; no raw rows reach LLM', async () => {
  const app = await createCaseBroker();
  const previous = { ...process.env };
  Object.assign(process.env, {
    WORKBENCH_DATASET_DB_PATH: path.join(app.dir, 'datasets'),
    DATAPOINT_SCHEDULER_ENABLED: 'false',
  });
  const Datapoint = require('../services/datapoint.service');
  app.broker.createService({
    ...Datapoint,
    settings: { ...Datapoint.settings, dbPath: path.join(app.dir, 'catalog') },
  });
  app.broker.createService(require('../services/dataset.service'));
  app.broker.createService({
    ...require('../services/object-store.service'),
    settings: { dbPath: path.join(app.dir, 'objects') },
  });
  app.broker.createService(require('../services/files.service'));
  try {
    await app.broker.start();
    const meta = auth('actor-a', ['ROLE_USER'], 'tenant-a', ['restricted']);
    meta.apiToken.scope = 'read-only';
    const original = syntheticWorkbook();
    const ref = await app.broker.call(
      'files.upload',
      {
        name: 'Synthetic.xlsx',
        contentBase64: original.toString('base64'),
        sensitivityLevel: 'restricted',
      },
      { meta }
    );
    const envelope = {
      fileRefs: [ref],
      userRequest: 'Speichere die Tabelle.',
      conversationId: 'synthetic-dataset',
    };
    await prepareFileTurn(
      app.workbench,
      { call: (name, input, options) => app.broker.call(name, input, options) },
      { tenantId: 'tenant-a' },
      envelope,
      meta
    );
    expect(envelope.documents[0].original.hash).toBe(ref.hash);
    await app.broker.call(
      'dataset.turn',
      {
        question: envelope.userRequest,
        documents: envelope.documents,
        conversationId: envelope.conversationId,
      },
      { meta }
    );
    const records = await app.broker.call(
      'datapoint.datasetCatalog',
      { operation: 'list' },
      { meta }
    );
    expect(records.map((record) => record.sheet).sort()).toEqual(['First', 'Second']);
    expect(records.every((record) => record.sensitivityLevel === 'restricted')).toBe(true);
    const dataset = app.broker.getLocalService('dataset');
    for (const record of records) {
      const rows = dataset.datasetPool.rows('tenant-a', record.id, record.columns);
      expect(rows).toHaveLength(2);
      expect(rows[1].Value).toBe(record.sheet === 'First' ? 24 : 60);
    }
    expect(
      await app.broker.call(
        'datapoint.datasetCatalog',
        { operation: 'list' },
        { meta: auth('actor-b', ['ROLE_USER'], 'tenant-a') }
      )
    ).toEqual([]);
    const prompts = require('../src/llm-client').generateStructured.mock.calls;
    expect(prompts.every((call) => !String(call[1]).includes(original.toString('base64')))).toBe(
      true
    );
    const stored = await app.broker.call(
      'object-store.get',
      { namespace: namespace('tenant-a'), key: ref.fileId },
      { meta: { fileStoreCapability: storeCapability } }
    );
    expect(Buffer.from(stored.payload.contentBase64, 'base64').equals(original)).toBe(true);
  } finally {
    await app.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
