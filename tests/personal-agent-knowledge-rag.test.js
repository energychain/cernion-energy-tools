'use strict';

const {
  queryKnowledgeOrientation,
} = require('../src/personal-agent-knowledge-rag');

describe('personal-agent-knowledge-rag adapter', () => {
  test('T-PA-KR-001: calls knowledge-rag.query with expected payload', async () => {
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      call: jest.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              metadata: {
                authority: 'BNetzA',
                docType: 'Festlegung',
                keywords: ['Netzanschluss'],
              },
              oeoTags: ['regulatory'],
              score: 0.88,
              referenceText: 'raw-reference',
              vectorText: 'raw-vector',
            },
          ],
        },
      }),
    };

    const result = await queryKnowledgeOrientation(ctx, {
      message: 'Welche regulatorischen Vorgaben gelten beim Netzanschluss?',
      activeDomains: ['market-regulatory'],
      limit: 7,
    });

    expect(ctx.call).toHaveBeenCalledTimes(1);
    expect(ctx.call).toHaveBeenCalledWith(
      'knowledge-rag.query',
      expect.objectContaining({
        queryType: 'semantic',
        query: 'Welche regulatorischen Vorgaben gelten beim Netzanschluss?',
        limit: 7,
      }),
      expect.objectContaining({
        timeout: 2000,
        meta: ctx.meta,
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        domainHint: expect.any(String),
        synthesisStyle: expect.any(String),
      })
    );
  });

  test('T-PA-KR-002: filters raw hit payload and returns only derived knowledgeContext fields', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              score: 0.99,
              referenceText: 'DO_NOT_LEAK_REFERENCE',
              vectorText: 'DO_NOT_LEAK_VECTOR',
              metadata: {
                authority: 'BNetzA',
                docType: 'Festlegung',
                tags: ['Regulatory'],
              },
            },
          ],
        },
      }),
    };

    const result = await queryKnowledgeOrientation(ctx, {
      message: 'Regulatorische Bewertung für das Projekt',
      activeDomains: ['market-regulatory'],
      limit: 5,
    });

    expect(result).toEqual({
      domainHint: 'market-regulatory',
      regulatoryFrame: 'BNetzA-Festlegung',
      synthesisStyle: 'methodological',
    });

    expect(result.score).toBeUndefined();
    expect(result.referenceText).toBeUndefined();
    expect(result.vectorText).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK_REFERENCE');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK_VECTOR');
  });

  test('T-PA-KR-005: returns null when RAG query has zero hits', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({ success: true, data: { results: [] } }),
    };

    const result = await queryKnowledgeOrientation(ctx, {
      message: 'Nur wenn Treffer vorliegen',
      activeDomains: ['grid-operations'],
      limit: 3,
    });

    expect(result).toBeNull();
    expect(ctx.call).toHaveBeenCalledTimes(1);
  });

  test('T-PA-KR-006: graceful degradation on service outage/timeout returns null', async () => {
    const timeoutCtx = {
      call: jest.fn().mockRejectedValue({
        type: 'REQUEST_TIMEOUT',
        message: 'Request timeout',
      }),
    };

    const unavailableCtx = {
      call: jest.fn().mockRejectedValue({
        type: 'SERVICE_NOT_FOUND',
        message: 'Service knowledge-rag not found',
      }),
    };

    await expect(
      queryKnowledgeOrientation(timeoutCtx, {
        message: 'Timeout fallback',
        activeDomains: ['market-regulatory'],
      })
    ).resolves.toBeNull();

    await expect(
      queryKnowledgeOrientation(unavailableCtx, {
        message: 'Service fallback',
        activeDomains: ['market-regulatory'],
      })
    ).resolves.toBeNull();

    expect(timeoutCtx.call).toHaveBeenCalledTimes(1);
    expect(unavailableCtx.call).toHaveBeenCalledTimes(1);
  });
});
