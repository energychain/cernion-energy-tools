const { ServiceBroker } = require('moleculer');

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map((t) => [String(t).length, 1, 0.5])),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));

const { callWithAutoPoll } = require('../src/async-job-poller');
const KnowledgeRagService = require('../services/knowledge-rag.service');

describe('Knowledge RAG ingest extension', () => {
  let broker;

  beforeAll(async () => {
    callWithAutoPoll.mockResolvedValue({ success: true, data: { queryType: 'semantic', results: [] } });

    broker = new ServiceBroker({ logger: false });

    const store = new Map();

    broker.createService({
      name: 'object-store',
      actions: {
        put: {
          async handler(ctx) {
            const key = `${ctx.params.namespace}:${ctx.params.key}`;
            const now = new Date().toISOString();
            store.set(key, {
              namespace: ctx.params.namespace,
              key: ctx.params.key,
              payload: ctx.params.payload,
              createdAt: store.get(key)?.createdAt || now,
              updatedAt: now,
            });
            return store.get(key);
          },
        },
        get: {
          async handler(ctx) {
            const key = `${ctx.params.namespace}:${ctx.params.key}`;
            if (!store.has(key)) {
              const err = new Error('not found');
              err.status = 404;
              err.type = 'OBJECT_NOT_FOUND';
              throw err;
            }
            return store.get(key);
          },
        },
        delete: {
          async handler(ctx) {
            const key = `${ctx.params.namespace}:${ctx.params.key}`;
            store.delete(key);
            return { success: true };
          },
        },
        query: {
          async handler(ctx) {
            const docs = Array.from(store.values()).filter((doc) => doc.namespace === ctx.params.namespace);
            const selector = ctx.params.selector || {};
            const filtered = docs.filter((doc) => {
              return Object.entries(selector).every(([path, expected]) => {
                const parts = path.split('.');
                let value = doc;
                for (const part of parts) {
                  value = value?.[part];
                }
                return String(value) === String(expected);
              });
            });
            return { docs: filtered.slice(ctx.params.skip || 0, (ctx.params.skip || 0) + (ctx.params.limit || 50)) };
          },
        },
      },
    });

    broker.createService({
      name: 'datasource-registry',
      actions: {
        get: {
          async handler(ctx) {
            return {
              success: true,
              data: {
                id: ctx.params.id,
                name: 'Demo Source',
                description: 'Demo rows',
                connectorType: 'csv',
                updatedAt: '2026-05-05T00:00:00.000Z',
                dictionary: { version: 2 },
                tags: ['finance'],
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'datasource-cache',
      actions: {
        query: {
          async handler() {
            return {
              success: true,
              data: [
                { name: 'Max', email: 'max@example.com', capex: 1200 },
                { name: 'Erika', email: 'erika@example.com', capex: 800 },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'cya',
      actions: {
        listProfiles: {
          async handler() {
            return {
              success: true,
              items: [{ key: 'profile-1', payload: { note: 'test' }, updatedAt: '2026-05-01T00:00:00Z' }],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'mastr-quality',
      actions: {
        list: {
          async handler() {
            return { audits: [{ id: 'mq-1', createdAt: '2026-05-01T00:00:00Z', qualityScore: 88 }] };
          },
        },
      },
    });

    broker.createService({
      name: 'redispatch-expost',
      actions: {
        list: {
          async handler() {
            return { audits: [{ id: 'rd-1', createdAt: '2026-05-01T00:00:00Z', riskLevel: 'low' }] };
          },
        },
      },
    });

    broker.createService({
      name: 'energy-sharing',
      actions: {
        list: {
          async handler() {
            return { validations: [{ id: 'es-1', createdAt: '2026-05-01T00:00:00Z', decision: 'APPROVED' }] };
          },
        },
      },
    });

    broker.createService(KnowledgeRagService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  test('creates default tenant collection', async () => {
    const result = await broker.call('knowledge-rag.createCollection', {}, { meta: { tenantId: 'acme' } });
    expect(result.success).toBe(true);
    expect(result.collection.name).toBe('tenant:acme:knowledge');
  });

  test('ingests direct documents with scrubbed content', async () => {
    const result = await broker.call(
      'knowledge-rag.ingest',
      {
        collection: 'tenant:acme:knowledge',
        documents: [
          {
            id: 'doc-1',
            text: 'Kontakt: max@example.com',
            metadata: { contactEmail: 'max@example.com', source: 'internal' },
          },
        ],
      },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.chunksIngested).toBeGreaterThan(0);
  });

  test('local semantic query returns ingested hits', async () => {
    const result = await broker.call(
      'knowledge-rag.query',
      {
        queryType: 'semantic',
        query: 'Kontakt',
        collection: 'tenant:acme:knowledge',
        limit: 5,
      },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.queryType).toBe('semantic');
    expect(result.data.results.length).toBeGreaterThan(0);
  });

  test('external query path is used when local collection is missing', async () => {
    await broker.call('knowledge-rag.query', {
      queryType: 'semantic',
      query: 'external only',
      collection: 'cernion_knowledge_v1',
    });

    expect(callWithAutoPoll).toHaveBeenCalled();
  });

  test('ingest from datasource builds chunks', async () => {
    const result = await broker.call(
      'knowledge-rag.ingestFromDatasource',
      { sourceId: 'source-1', collection: 'tenant:acme:knowledge' },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.documentsIngested).toBeGreaterThan(0);
  });

  test('ingest from audit defaults to audit_history collection', async () => {
    const result = await broker.call(
      'knowledge-rag.ingestFromAudit',
      { limit: 3 },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.collection).toBe('tenant:acme:audit_history');
  });

  test('ingest from audit supports explicit energy-sharing type', async () => {
    const result = await broker.call(
      'knowledge-rag.ingestFromAudit',
      { collection: 'tenant:acme:audit_history', auditTypes: ['energy-sharing'] },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.documentsIngested).toBeGreaterThan(0);
  });

  test('collection info works for local collection', async () => {
    const result = await broker.call(
      'knowledge-rag.collectionInfo',
      { collection: 'tenant:acme:knowledge' },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.queryType).toBe('collection_info');
  });

  test('reindex creates a new active model version', async () => {
    const result = await broker.call(
      'knowledge-rag.reindex',
      { collection: 'tenant:acme:knowledge', embeddingModelVersion: 'embed-v2' },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.data.toModelVersion).toBe('embed-v2');
  });

  test('cutover switches active version to requested version', async () => {
    const result = await broker.call(
      'knowledge-rag.cutover',
      { collection: 'tenant:acme:knowledge', modelVersion: 'embed-v2' },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.collection.activeModelVersion).toBe('embed-v2');
  });

  test('remove collection deletes local collection', async () => {
    const result = await broker.call(
      'knowledge-rag.removeCollection',
      { name: 'tenant:acme:knowledge' },
      { meta: { tenantId: 'acme' } }
    );

    expect(result.success).toBe(true);
    expect(result.collection).toBe('tenant:acme:knowledge');
  });

  test('fetch validation still requires ids', async () => {
    await expect(
      broker.call('knowledge-rag.query', {
        queryType: 'fetch',
      })
    ).rejects.toMatchObject({ type: 'VALIDATION_ERROR' });
  });
});
