const { ServiceBroker } = require('moleculer');

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithAutoPoll } = require('../src/async-job-poller');
const KnowledgeRagService = require('../services/knowledge-rag.service');

describe('Knowledge RAG Service', () => {
  let broker;

  beforeAll(async () => {
    callWithAutoPoll.mockResolvedValue({
      success: true,
      data: {
        queryType: 'semantic',
        collection: 'cernion_knowledge_v1',
        returned: 1,
        results: [
          {
            pointId: 'doc-123',
            score: 0.91,
            referenceText_L0: 'Die Festlegung regelt ...',
            vectorText: 'Welche Regeln gelten für ...',
            metadata: {
              title: 'BK6-24-xxx',
              docType: 'Festlegung',
              authority: 'BNetzA',
              status: 'gültig',
            },
            oeoTags: ['Netzanschluss'],
          },
        ],
      },
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(KnowledgeRagService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    callWithAutoPoll.mockClear();
  });

  it('should expose all configured actions', () => {
    const actions = broker.getLocalService('knowledge-rag').schema.actions;
    expect(actions.query.rest).toBe('POST /query');
    expect(actions.semantic.rest).toBe('POST /semantic');
    expect(actions.federatedSearch.rest).toBe('POST /federated-search');
    expect(actions.scroll.rest).toBe('POST /scroll');
    expect(actions.fetch.rest).toBe('POST /fetch');
    expect(actions.collectionInfo.rest).toBe('POST /collection-info');
    expect(actions.createCollection.rest).toBe('POST /collections');
    expect(actions.ingest.rest).toBe('POST /ingest');
    expect(actions.ingestFromDatasource.rest).toBe('POST /ingest/from-datasource');
    expect(actions.ingestFromAudit.rest).toBe('POST /ingest/from-audit');
    expect(actions.removeCollection.rest).toBe('DELETE /collections/:name');
    expect(actions.reindex.rest).toBe('POST /reindex/:collection');
    expect(actions.cutover.rest).toBe('POST /cutover/:collection');
  });

  it('should run semantic query via canonical endpoint', async () => {
    const response = await broker.call('knowledge-rag.query', {
      queryType: 'semantic',
      query: 'Netzanschluss BNetzA',
      limit: 3,
    });

    expect(response.success).toBe(true);
    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ queryType: 'semantic', query: 'Netzanschluss BNetzA', limit: 3 }),
      expect.objectContaining({ pollInterval: 2000 }),
      undefined
    );
  });

  it('should pass full qdrant-style filter object unchanged', async () => {
    const filter = {
      must: [
        { key: 'metadata.docType', match: { value: 'Festlegung' } },
        { key: 'metadata.authority', match: { value: 'BNetzA' } },
      ],
      should: [{ key: 'oeoTags', match: { any: ['Netzanschluss', 'Regulierung'] } }],
      must_not: [{ key: 'metadata.status', match: { value: 'archiviert' } }],
      nested: { arbitrary: { qdrant: ['shape', 'supported'] } },
    };

    await broker.call('knowledge-rag.query', {
      queryType: 'semantic',
      query: 'Welche Festlegungen gibt es?',
      filter,
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ filter }),
      expect.any(Object),
      undefined
    );
  });

  it('should require query for semantic calls', async () => {
    await expect(
      broker.call('knowledge-rag.query', {
        queryType: 'semantic',
      })
    ).rejects.toMatchObject({ code: 400, type: 'VALIDATION_ERROR' });
  });

  it('should require ids for fetch calls', async () => {
    await expect(
      broker.call('knowledge-rag.query', {
        queryType: 'fetch',
      })
    ).rejects.toMatchObject({ code: 400, type: 'VALIDATION_ERROR' });
  });

  it('should enforce string/number ids for fetch', async () => {
    await expect(
      broker.call('knowledge-rag.query', {
        queryType: 'fetch',
        ids: [{ invalid: true }],
      })
    ).rejects.toMatchObject({ code: 400, type: 'VALIDATION_ERROR' });
  });

  it('should force queryType=semantic in semantic convenience action', async () => {
    await broker.call('knowledge-rag.semantic', {
      query: 'BNetzA Festlegung Netzanschluss',
      limit: 2,
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ queryType: 'semantic', query: 'BNetzA Festlegung Netzanschluss' }),
      expect.any(Object),
      undefined
    );
  });

  it('should run federated search via cernion_willi_federated_search', async () => {
    await broker.call('knowledge-rag.federatedSearch', {
      query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
      limit: 5,
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_willi_federated_search',
      { query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?', limit: 5 },
      expect.objectContaining({ pollInterval: 2000 }),
      undefined
    );
  });

  it('should default federated search limit to 10 when omitted', async () => {
    await broker.call('knowledge-rag.federatedSearch', {
      query: 'MaKo Prüfidentifikator 11039',
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_willi_federated_search',
      { query: 'MaKo Prüfidentifikator 11039', limit: 10 },
      expect.any(Object),
      undefined
    );
  });

  it('should require query for federated search', async () => {
    await expect(broker.call('knowledge-rag.federatedSearch', {})).rejects.toMatchObject({
      code: 422,
      type: 'VALIDATION_ERROR',
    });
    expect(callWithAutoPoll).not.toHaveBeenCalled();
  });

  it('should reject a whitespace-only query for federated search', async () => {
    await expect(
      broker.call('knowledge-rag.federatedSearch', { query: ' ' })
    ).rejects.toMatchObject({
      code: 400,
      type: 'VALIDATION_ERROR',
    });
    expect(callWithAutoPoll).not.toHaveBeenCalled();
  });

  it('should forward cernion token from context meta on federated search', async () => {
    await broker.call(
      'knowledge-rag.federatedSearch',
      { query: 'EDIFACT UTILMD Segmentstruktur' },
      { meta: { cernionToken: 'ck_test_token' } }
    );

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_willi_federated_search',
      expect.objectContaining({ query: 'EDIFACT UTILMD Segmentstruktur' }),
      expect.any(Object),
      'ck_test_token'
    );
  });

  it('should force queryType=scroll in scroll convenience action', async () => {
    await broker.call('knowledge-rag.scroll', {
      limit: 2,
      offset: 'abc',
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ queryType: 'scroll', limit: 2, offset: 'abc' }),
      expect.any(Object),
      undefined
    );
  });

  it('should force queryType=fetch in fetch convenience action', async () => {
    await broker.call('knowledge-rag.fetch', {
      ids: ['doc-123', 42],
      withPayload: true,
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ queryType: 'fetch', ids: ['doc-123', 42], withPayload: true }),
      expect.any(Object),
      undefined
    );
  });

  it('should force queryType=collection_info in collection info convenience action', async () => {
    await broker.call('knowledge-rag.collectionInfo', {});

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ queryType: 'collection_info' }),
      expect.any(Object),
      undefined
    );
  });

  it('should forward cernion token from context meta', async () => {
    await broker.call(
      'knowledge-rag.query',
      {
        queryType: 'semantic',
        query: 'Netzanschluss',
      },
      {
        meta: { cernionToken: 'test-token-abc' },
      }
    );

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_rag_search',
      expect.objectContaining({ queryType: 'semantic', query: 'Netzanschluss' }),
      expect.any(Object),
      'test-token-abc'
    );
  });

  it('should deduplicate external semantic duplicates by document and text', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: {
        queryType: 'semantic',
        collection: 'cernion_knowledge_v1',
        returned: 3,
        total: 3,
        results: [
          {
            pointId: 'p-1',
            score: 0.7,
            referenceText_L0: 'Duplikat Abschnitt',
            metadata: { documentId: 'doc-a', title: 'A' },
          },
          {
            pointId: 'p-2',
            score: 0.95,
            referenceText_L0: 'Duplikat Abschnitt',
            metadata: { documentId: 'doc-a', title: 'A' },
          },
          {
            pointId: 'p-3',
            score: 0.6,
            referenceText_L0: 'Anderer Abschnitt',
            metadata: { documentId: 'doc-b', title: 'B' },
          },
        ],
      },
    });

    const response = await broker.call('knowledge-rag.query', {
      queryType: 'semantic',
      query: 'Duplikat',
      limit: 10,
    });

    expect(response.success).toBe(true);
    expect(response.data.results).toHaveLength(2);
    expect(response.data.results.map((row) => row.pointId)).toEqual(['p-2', 'p-3']);
    expect(response.data.returned).toBe(2);
    expect(response.data.total).toBe(2);
  });

  it('should keep duplicates when dedupe is disabled', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: {
        queryType: 'semantic',
        collection: 'cernion_knowledge_v1',
        returned: 2,
        total: 2,
        results: [
          {
            pointId: 'p-11',
            score: 0.7,
            referenceText_L0: 'Duplikat Abschnitt',
            metadata: { documentId: 'doc-a', title: 'A' },
          },
          {
            pointId: 'p-12',
            score: 0.95,
            referenceText_L0: 'Duplikat Abschnitt',
            metadata: { documentId: 'doc-a', title: 'A' },
          },
        ],
      },
    });

    const response = await broker.call('knowledge-rag.query', {
      queryType: 'semantic',
      query: 'Duplikat',
      dedupe: false,
      limit: 10,
    });

    expect(response.success).toBe(true);
    expect(response.data.results).toHaveLength(2);
    expect(response.data.total).toBe(2);
    expect(response.data.reranking).toMatchObject({
      dedupe: false,
      rerank: true,
      removedDuplicates: 0,
    });
  });

  it('should include reranking metadata for semantic responses', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: {
        queryType: 'semantic',
        collection: 'cernion_knowledge_v1',
        returned: 1,
        total: 1,
        results: [
          {
            pointId: 'p-meta-1',
            score: 0.88,
            referenceText_L0: 'Ein Treffer',
            metadata: { documentId: 'doc-meta', title: 'Meta' },
          },
        ],
      },
    });

    const response = await broker.call('knowledge-rag.semantic', {
      query: 'Ein Treffer',
      limit: 5,
    });

    expect(response.success).toBe(true);
    expect(response.data.reranking).toMatchObject({
      applied: true,
      dedupe: true,
      rerank: true,
      inputCount: 1,
      outputCount: 1,
      removedDuplicates: 0,
      diversityPerDocument: 2,
    });
  });
});
