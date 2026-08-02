'use strict';

const {
  queryKnowledgeOrientation,
  queryKnowledgeEvidence,
  queryFederatedEvidence,
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
        timeout: 25000,
        meta: expect.objectContaining({
          tenantId: 'tenant-a',
          $gateway: false,
        }),
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

  test('T-PA-KR-007: queryKnowledgeEvidence returns metadata-first hits only', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'doc-1',
              source: 'BNetzA',
              score: 0.91,
              summary: 'Kurzfassung zum Netzgebiet und VNB-Zuständigkeit.',
              referenceText: 'DO_NOT_EXPOSE_REFERENCE',
              vectorText: 'Suchvektor: Netzgebiet VNB Zuständigkeit',
              metadata: {
                docType: 'Festlegung',
                publishedAt: '2026-01-02T00:00:00.000Z',
              },
            },
          ],
        },
      }),
    };

    const result = await queryKnowledgeEvidence(ctx, {
      query: 'zuständiger VNB Wiesloch',
      limit: 2,
    });

    expect(result.status).toBe('available');
    expect(result.hits).toEqual([
      {
        hitId: 'doc-1',
        source: 'BNetzA',
        score: 0.91,
        summary: 'Kurzfassung zum Netzgebiet und VNB-Zuständigkeit.',
        retrievalHint: 'Suchvektor: Netzgebiet VNB Zuständigkeit',
        timestamp: '2026-01-02T00:00:00.000Z',
        documentType: 'Festlegung',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE_REFERENCE');
  });

  test('T-PA-KR-010: queryKnowledgeEvidence keeps canonical RAG snippets when summary is only a URL', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'doc-2',
              source: 'BNetzA',
              score: 0.82,
              summary: 'https://www.bundesnetzagentur.de/example.pdf',
              referenceText_L0:
                'Gemeinschaftliche Versorgungskonzepte muessen anhand Marktrollen, Messung und Abrechnung konkret geprueft werden.',
              referenceText: 'DO_NOT_EXPOSE_REFERENCE',
              vectorText: 'Energy Sharing Mieterstrom gemeinschaftliche Gebaeudeversorgung',
              metadata: {
                docType: 'Festlegung',
              },
            },
          ],
        },
      }),
    };

    const result = await queryKnowledgeEvidence(ctx, {
      query: 'Strom mit Nachbarn teilen',
      limit: 1,
    });

    expect(result.status).toBe('available');
    expect(result.hits[0].summary).toContain('Gemeinschaftliche Versorgungskonzepte');
    expect(result.hits[0].retrievalHint).toContain('Energy Sharing Mieterstrom');
    expect(result.hits[0].summary).not.toContain('https://www.bundesnetzagentur.de/example.pdf');
    expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE_REFERENCE');
  });

  test('T-PA-KR-008: queryKnowledgeEvidence returns timeout as first-class status', async () => {
    const timeoutCtx = {
      call: jest.fn().mockRejectedValue({
        type: 'REQUEST_TIMEOUT',
        message: 'Request timeout',
      }),
    };

    const result = await queryKnowledgeEvidence(timeoutCtx, {
      query: 'timeout test',
      timeoutMs: 1000,
    });

    expect(result.status).toBe('timeout');
    expect(result.hits).toEqual([]);
  });

  test('T-PA-KR-009: queryKnowledgeEvidence returns unavailable status on service outage', async () => {
    const unavailableCtx = {
      call: jest.fn().mockRejectedValue({
        type: 'SERVICE_NOT_FOUND',
        message: 'Service knowledge-rag not found',
      }),
    };

    const result = await queryKnowledgeEvidence(unavailableCtx, {
      query: 'service unavailable test',
    });

    expect(result.status).toBe('unavailable');
    expect(result.hits).toEqual([]);
  });

  test('T-PA-KR-011: queryFederatedEvidence calls knowledge-rag.federatedSearch with query+limit only', async () => {
    const ctx = {
      meta: { tenantId: 'tenant-a' },
      call: jest.fn().mockResolvedValue({
        success: true,
        data: {
          results: [
            {
              id: 'wm-1',
              source: 'willi-mako',
              score: 0.77,
              summary: 'APERAK Fehlercode Zusammenfassung.',
              metadata: { docType: 'article' },
            },
          ],
        },
      }),
    };

    const result = await queryFederatedEvidence(ctx, {
      query: 'APERAK Fehlercode Frist',
      limit: 4,
    });

    expect(ctx.call).toHaveBeenCalledTimes(1);
    expect(ctx.call).toHaveBeenCalledWith(
      'knowledge-rag.federatedSearch',
      { query: 'APERAK Fehlercode Frist', limit: 4 },
      expect.objectContaining({
        meta: expect.objectContaining({ tenantId: 'tenant-a', $gateway: false }),
      })
    );

    expect(result.status).toBe('available');
    expect(result.queryType).toBe('federated');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toEqual(
      expect.objectContaining({ hitId: 'wm-1', source: 'willi-mako', score: 0.77 })
    );
  });

  test('T-PA-KR-012: queryFederatedEvidence returns missing status for empty query without calling ctx', async () => {
    const ctx = { call: jest.fn() };

    const result = await queryFederatedEvidence(ctx, { query: '  ' });

    expect(result).toEqual({
      status: 'missing',
      hits: [],
      queryType: 'federated',
      query: '',
      trace: { hitCount: 0 },
    });
    expect(ctx.call).not.toHaveBeenCalled();
  });

  test('T-PA-KR-013: queryFederatedEvidence returns timeout/unavailable as first-class status', async () => {
    const timeoutCtx = {
      call: jest.fn().mockRejectedValue({ type: 'REQUEST_TIMEOUT', message: 'Request timeout' }),
    };
    const unavailableCtx = {
      call: jest
        .fn()
        .mockRejectedValue({ type: 'SERVICE_NOT_FOUND', message: 'Service not found' }),
    };

    const timeoutResult = await queryFederatedEvidence(timeoutCtx, {
      query: 'timeout test',
      timeoutMs: 1000,
    });
    expect(timeoutResult.status).toBe('timeout');
    expect(timeoutResult.hits).toEqual([]);

    const unavailableResult = await queryFederatedEvidence(unavailableCtx, {
      query: 'unavailable test',
    });
    expect(unavailableResult.status).toBe('unavailable');
    expect(unavailableResult.hits).toEqual([]);
  });

  test('T-PA-KR-014: queryKnowledgeEvidence still targets knowledge-rag.query unaffected by the federated addition', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({ success: true, data: { results: [] } }),
    };

    await queryKnowledgeEvidence(ctx, { query: 'regression guard' });

    expect(ctx.call).toHaveBeenCalledWith(
      'knowledge-rag.query',
      expect.objectContaining({ queryType: 'semantic', query: 'regression guard' }),
      expect.any(Object)
    );
  });
});
