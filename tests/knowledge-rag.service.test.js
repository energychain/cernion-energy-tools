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
    expect(actions.scroll.rest).toBe('POST /scroll');
    expect(actions.fetch.rest).toBe('POST /fetch');
    expect(actions.collectionInfo.rest).toBe('POST /collection-info');
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
});
