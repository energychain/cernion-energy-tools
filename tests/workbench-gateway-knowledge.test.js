'use strict';

const { collectGatewayKnowledge } = require('../src/workbench-gateway-knowledge');

describe('knowledge gateway as a workbench source (AP4)', () => {
  test('searches with the person meta and keeps the citation', async () => {
    const call = jest.fn().mockResolvedValue({
      queryId: 'q1',
      results: [
        {
          citationId: 'cit_1',
          knowledgeBaseId: 'kb_1',
          documentId: 'doc_1',
          content: 'Transportquittung und fachliche Rückmeldung sind getrennte Belegarten.',
          title: 'Prozessbeschreibung',
          score: 0.71,
          location: { chunkIndex: 2, section: 'Belegarten' },
          source: { name: 'process.md', sha256: 'sha256:abc' },
        },
      ],
    });
    const meta = { apiToken: { tenantId: 't', id: 'a' } };
    const ctx = { broker: { getLocalService: () => ({}) }, call, meta };
    const result = await collectGatewayKnowledge(ctx, { question: 'Belegarten?', timeoutMs: 900 });
    expect(call).toHaveBeenCalledWith(
      'knowledge-gateway.search',
      expect.objectContaining({ question: 'Belegarten?' }),
      expect.objectContaining({ meta, timeout: 900 })
    );
    expect(result.status).toBe('available');
    expect(result.hits[0]).toMatchObject({
      source: 'Prozessbeschreibung',
      value: expect.stringContaining('getrennte Belegarten'),
      metadata: { citationId: 'cit_1', sourceId: 'doc_1', sectionId: 'Belegarten' },
    });
  });

  test('without the gateway service the source is skipped', async () => {
    const ctx = { broker: { getLocalService: () => null }, call: jest.fn(), meta: {} };
    await expect(collectGatewayKnowledge(ctx, { question: 'x' })).resolves.toMatchObject({
      status: 'skipped',
      hits: [],
    });
    expect(ctx.call).not.toHaveBeenCalled();
  });
});
