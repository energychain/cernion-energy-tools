'use strict';

const { Errors } = require('moleculer');
const { callWithAutoPoll } = require('../src/async-job-poller');
const { appendLog, startJob } = require('../src/job-store');
const metrics = require('../src/metrics');

const OPENAPI_TAG = 'Knowledge RAG';
const MCP_TOOL = 'cernion_rag_search';
const OEO_CLASS = ['https://openenergyplatform.org/ontology/oeo/OEO_00000143'];

const QUERY_TYPE_VALUES = ['semantic', 'scroll', 'fetch', 'collection_info'];

const BASE_PARAMS = {
  queryType: { type: 'enum', values: QUERY_TYPE_VALUES, optional: true, default: 'semantic' },
  query: { type: 'string', optional: true, trim: true },
  limit: { type: 'number', optional: true, convert: true, min: 1, max: 100, default: 10 },
  scoreThreshold: { type: 'number', optional: true, convert: true },
  ids: { type: 'array', optional: true },
  offset: { type: 'any', optional: true },
  filter: { type: 'object', optional: true },
  withPayload: { type: 'boolean', optional: true, default: false },
  withVectors: { type: 'boolean', optional: true, default: false },
};

const JOB_202_RESPONSE = {
  202: {
    description: 'Job accepted and queued for async processing',
    headers: {
      Location: {
        schema: { type: 'string' },
        description: 'Relative URI to job status endpoint (/api/jobs/:jobId/status)',
      },
      'Retry-After': {
        schema: { type: 'string' },
        description: 'Suggested polling interval in seconds',
      },
    },
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            jobId: { type: 'string', example: '6fd38b12-a3f4-41d5-8f49-e7f9c1b2d3e4' },
            status: { type: 'string', enum: ['queued'], example: 'queued' },
            message: {
              type: 'string',
              example: 'Job started. Poll /api/jobs/:jobId/status for progress.',
            },
            statusUrl: {
              type: 'string',
              example: '/api/jobs/6fd38b12-a3f4-41d5-8f49-e7f9c1b2d3e4/status',
            },
            resultUrl: {
              type: 'string',
              example: '/api/jobs/6fd38b12-a3f4-41d5-8f49-e7f9c1b2d3e4/result',
            },
          },
        },
      },
    },
  },
};

const SUCCESS_200_RESPONSE = {
  200: {
    description: 'RAG query result (internal/direct calls only; external callers receive 202)',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              properties: {
                queryType: { type: 'string', example: 'semantic' },
                collection: { type: 'string', example: 'cernion_knowledge_v1' },
                returned: { type: 'number', example: 2 },
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      pointId: { type: 'string', example: 'doc-123' },
                      score: { type: 'number', example: 0.91 },
                      referenceText_L0: { type: 'string', example: 'Die Festlegung regelt ...' },
                      vectorText: { type: 'string', example: 'Welche Regeln gelten für ...' },
                      metadata: {
                        type: 'object',
                        properties: {
                          title: { type: 'string', example: 'BK6-24-xxx' },
                          docType: { type: 'string', example: 'Festlegung' },
                          authority: { type: 'string', example: 'BNetzA' },
                          status: { type: 'string', example: 'gültig' },
                        },
                      },
                      oeoTags: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

function inferHitCount(result) {
  return (
    result?.data?.returned ||
    result?.returned ||
    result?.data?.results?.length ||
    result?.results?.length ||
    0
  );
}

function buildQuerySchema(requiredFields = []) {
  return {
    type: 'object',
    required: requiredFields,
    properties: {
      queryType: {
        type: 'string',
        enum: QUERY_TYPE_VALUES,
        default: 'semantic',
        example: 'semantic',
      },
      query: {
        type: 'string',
        example: 'Welche Festlegungen der BNetzA gibt es zum Netzanschluss?',
      },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 100,
        default: 10,
        example: 5,
      },
      scoreThreshold: {
        type: 'number',
        example: 0.4,
      },
      ids: {
        type: 'array',
        items: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
        example: ['doc-123'],
      },
      offset: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'object' }],
        example: 'next_offset_token',
      },
      filter: {
        type: 'object',
        example: {
          must: [
            { key: 'metadata.docType', match: { value: 'Festlegung' } },
            { key: 'metadata.authority', match: { value: 'BNetzA' } },
          ],
        },
      },
      withPayload: {
        type: 'boolean',
        default: false,
        example: false,
      },
      withVectors: {
        type: 'boolean',
        default: false,
        example: false,
      },
    },
  };
}

module.exports = {
  name: 'knowledge-rag',
  timeout: 15 * 60 * 1000,

  actions: {
    query: {
      rest: 'POST /query',
      params: BASE_PARAMS,
      openapi: {
        summary: 'Knowledge RAG query (semantic, scroll, fetch, collection_info)',
        tags: [OPENAPI_TAG],
        'x-oeo-class': OEO_CLASS,
        description:
          'Async RAG wrapper for `cernion_rag_search` with full Qdrant-style filter support. ' +
          'Uses job pattern for REST calls (HTTP 202 + /api/jobs polling).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: buildQuerySchema([]),
              examples: {
                semantic: {
                  summary: 'Semantic query with explicit metadata filters',
                  value: {
                    queryType: 'semantic',
                    query: 'Welche Festlegungen der BNetzA gibt es zum Netzanschluss?',
                    limit: 5,
                    filter: {
                      must: [
                        { key: 'metadata.docType', match: { value: 'Festlegung' } },
                        { key: 'metadata.authority', match: { value: 'BNetzA' } },
                      ],
                    },
                  },
                },
                scroll: {
                  summary: 'Scroll first page',
                  value: { queryType: 'scroll', limit: 10, withPayload: false },
                },
                fetch: {
                  summary: 'Fetch by point IDs',
                  value: { queryType: 'fetch', ids: ['doc-123', 42] },
                },
                collectionInfo: {
                  summary: 'Collection metadata',
                  value: { queryType: 'collection_info' },
                },
              },
            },
          },
        },
        responses: {
          ...JOB_202_RESPONSE,
          ...SUCCESS_200_RESPONSE,
        },
      },
      async handler(ctx) {
        return this.startRagJob(ctx, ctx.params, 'query');
      },
    },

    semantic: {
      rest: 'POST /semantic',
      params: {
        query: { type: 'string', min: 1 },
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 100, default: 10 },
        scoreThreshold: { type: 'number', optional: true, convert: true },
        filter: { type: 'object', optional: true },
        withPayload: { type: 'boolean', optional: true, default: false },
        withVectors: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Convenience semantic RAG endpoint',
        tags: [OPENAPI_TAG],
        'x-oeo-class': OEO_CLASS,
        description:
          'Shortcut endpoint that forces queryType=semantic. Supports full Qdrant-style filtering.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: {
                    type: 'string',
                    example: 'Welche Festlegungen der BNetzA gibt es zum Netzanschluss?',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 100, default: 10, example: 5 },
                  scoreThreshold: { type: 'number', example: 0.4 },
                  filter: {
                    type: 'object',
                    example: {
                      must: [
                        { key: 'metadata.docType', match: { value: 'Festlegung' } },
                        { key: 'metadata.authority', match: { value: 'BNetzA' } },
                      ],
                    },
                  },
                  withPayload: { type: 'boolean', default: false, example: false },
                  withVectors: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: {
                    query: 'Welche Festlegungen der BNetzA gibt es zum Netzanschluss?',
                    limit: 5,
                    filter: {
                      must: [
                        { key: 'metadata.docType', match: { value: 'Festlegung' } },
                        { key: 'metadata.authority', match: { value: 'BNetzA' } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          ...JOB_202_RESPONSE,
          ...SUCCESS_200_RESPONSE,
        },
      },
      async handler(ctx) {
        return this.startRagJob(ctx, { ...ctx.params, queryType: 'semantic' }, 'semantic');
      },
    },

    scroll: {
      rest: 'POST /scroll',
      params: {
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 100, default: 10 },
        offset: { type: 'any', optional: true },
        filter: { type: 'object', optional: true },
        withPayload: { type: 'boolean', optional: true, default: false },
        withVectors: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Convenience scroll endpoint for paginated retrieval',
        tags: [OPENAPI_TAG],
        'x-oeo-class': OEO_CLASS,
        description: 'Shortcut endpoint that forces queryType=scroll.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  limit: { type: 'number', minimum: 1, maximum: 100, default: 10, example: 10 },
                  offset: {
                    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'object' }],
                    example: 'next_offset_token',
                  },
                  filter: {
                    type: 'object',
                    example: {
                      must: [{ key: 'metadata.authority', match: { value: 'BNetzA' } }],
                    },
                  },
                  withPayload: { type: 'boolean', default: false, example: false },
                  withVectors: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: {
                    limit: 10,
                    offset: 'next_offset_token',
                    filter: {
                      must: [{ key: 'metadata.authority', match: { value: 'BNetzA' } }],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          ...JOB_202_RESPONSE,
          ...SUCCESS_200_RESPONSE,
        },
      },
      async handler(ctx) {
        return this.startRagJob(ctx, { ...ctx.params, queryType: 'scroll' }, 'scroll');
      },
    },

    fetch: {
      rest: 'POST /fetch',
      params: {
        ids: { type: 'array', min: 1 },
        withPayload: { type: 'boolean', optional: true, default: false },
        withVectors: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Convenience fetch endpoint for point IDs',
        tags: [OPENAPI_TAG],
        'x-oeo-class': OEO_CLASS,
        description: 'Shortcut endpoint that forces queryType=fetch.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids'],
                properties: {
                  ids: {
                    type: 'array',
                    minItems: 1,
                    items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                    example: ['doc-123', 42],
                  },
                  withPayload: { type: 'boolean', default: false, example: false },
                  withVectors: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: {
                    ids: ['doc-123', 42],
                    withPayload: false,
                    withVectors: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          ...JOB_202_RESPONSE,
          ...SUCCESS_200_RESPONSE,
        },
      },
      async handler(ctx) {
        return this.startRagJob(ctx, { ...ctx.params, queryType: 'fetch' }, 'fetch');
      },
    },

    collectionInfo: {
      rest: 'POST /collection-info',
      params: {
        withPayload: { type: 'boolean', optional: true, default: false },
        withVectors: { type: 'boolean', optional: true, default: false },
      },
      openapi: {
        summary: 'Convenience endpoint for collection metadata',
        tags: [OPENAPI_TAG],
        'x-oeo-class': OEO_CLASS,
        description: 'Shortcut endpoint that forces queryType=collection_info.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  withPayload: { type: 'boolean', default: false, example: false },
                  withVectors: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: {
                    withPayload: false,
                    withVectors: false,
                  },
                },
              },
            },
          },
        },
        responses: {
          ...JOB_202_RESPONSE,
          ...SUCCESS_200_RESPONSE,
        },
      },
      async handler(ctx) {
        return this.startRagJob(
          ctx,
          { ...ctx.params, queryType: 'collection_info' },
          'collection_info'
        );
      },
    },
  },

  methods: {
    validateRagParams(params) {
      const queryType = params.queryType || 'semantic';

      if (queryType === 'semantic') {
        if (!params.query || !String(params.query).trim()) {
          throw new Errors.MoleculerClientError(
            'Parameter "query" is required for queryType=semantic',
            400,
            'VALIDATION_ERROR'
          );
        }
      }

      if (queryType === 'fetch') {
        if (!Array.isArray(params.ids) || params.ids.length === 0) {
          throw new Errors.MoleculerClientError(
            'Parameter "ids" is required and must be non-empty for queryType=fetch',
            400,
            'VALIDATION_ERROR'
          );
        }
        const invalidId = params.ids.find((id) => typeof id !== 'string' && typeof id !== 'number');
        if (invalidId !== undefined) {
          throw new Errors.MoleculerClientError(
            'Each entry in "ids" must be either a string or number',
            400,
            'VALIDATION_ERROR'
          );
        }
      }

      return queryType;
    },

    startRagJob(ctx, rawParams, actionName) {
      const queryType = this.validateRagParams(rawParams);

      const toolParams = {
        ...rawParams,
        queryType,
      };

      return startJob(
        ctx,
        { service: 'knowledge-rag', action: actionName },
        async (jobId) => {
          if (jobId) {
            appendLog(jobId, 'queued', 0, `Starting ${MCP_TOOL} (${queryType})`);
          }

          const result = await callWithAutoPoll(
            MCP_TOOL,
            toolParams,
            {
              maxWaitTime: 8 * 60 * 1000,
              pollInterval: 2000,
              onStatusUpdate: (update) => {
                if (!jobId) return;
                const statusLabel = String(update.status || 'running');
                const progress = statusLabel === 'succeeded' ? 100 : 50;
                appendLog(jobId, statusLabel, progress, `MCP job status: ${statusLabel}`);
              },
            },
            ctx.meta.cernionToken
          );

          if (jobId) {
            appendLog(jobId, 'completed', 100, `${MCP_TOOL} finished`);
          }

          return result;
        }
      );
    },
  },
};

// v0.43.1 extension: own tenant-aware ingestion pipeline + local retrieval
module.exports = (() => {
  const crypto = require('crypto');
  const pdfParse = require('pdf-parse');
  const { embeddings, capabilities } = require('../src/llm-client');
  const { scrubForLLM, scrubPromptText } = require('../src/prompt-scrubber');
  const { getTenantId, tenantNamespace } = require('../src/tenant-context');
  const { chunkText, normalizeMode } = require('../src/knowledge-rag-chunker');

  const COLLECTION_NS = 'knowledge_rag_collections';
  const CHUNK_NS = 'knowledge_rag_chunks';
  const DEFAULT_EXTERNAL_COLLECTION = 'cernion_knowledge_v1';
  const DEFAULT_EMBEDDING_VERSION = process.env.LLM_EMBEDDING_MODEL || 'default';
  const AUDIT_TYPES = ['cya', 'mastr-quality', 'redispatch', 'energy-sharing'];

  function parseOffset(offset) {
    if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) return Math.floor(offset);
    if (typeof offset === 'string' && /^\d+$/.test(offset)) return parseInt(offset, 10);
    return 0;
  }

  function clamp(n, min, max) {
    const value = Number(n);
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let a2 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i += 1) {
      const av = Number(a[i]) || 0;
      const bv = Number(b[i]) || 0;
      dot += av * bv;
      a2 += av * av;
      b2 += bv * bv;
    }
    if (!a2 || !b2) return 0;
    return dot / (Math.sqrt(a2) * Math.sqrt(b2));
  }

  return {
    name: 'knowledge-rag',
    timeout: 15 * 60 * 1000,

    actions: {
      query: {
        rest: 'POST /query',
        params: {
          queryType: { type: 'enum', values: QUERY_TYPE_VALUES, optional: true, default: 'semantic' },
          query: { type: 'string', optional: true, trim: true },
          collection: { type: 'string', optional: true, trim: true },
          limit: { type: 'number', optional: true, convert: true, min: 1, max: 100, default: 10 },
          scoreThreshold: { type: 'number', optional: true, convert: true },
          ids: { type: 'array', optional: true },
          offset: { type: 'any', optional: true },
          filter: { type: 'object', optional: true },
          withPayload: { type: 'boolean', optional: true, default: false },
          withVectors: { type: 'boolean', optional: true, default: false },
        },
        openapi: {
          summary: 'Knowledge RAG query (external MCP + local tenant index)',
          tags: [OPENAPI_TAG],
          'x-oeo-class': OEO_CLASS,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: buildQuerySchema([]),
                examples: {
                  semantic: {
                    value: {
                      queryType: 'semantic',
                      query: 'Welche BNetzA Festlegungen sind relevant?',
                      collection: 'tenant:stadtwerk-a:knowledge',
                      limit: 5,
                    },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
            ...SUCCESS_200_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startRagJob(ctx, ctx.params, 'query');
        },
      },

      semantic: {
        rest: 'POST /semantic',
        params: {
          query: { type: 'string', min: 1 },
          collection: { type: 'string', optional: true, trim: true },
          limit: { type: 'number', optional: true, convert: true, min: 1, max: 100, default: 10 },
          scoreThreshold: { type: 'number', optional: true, convert: true },
          filter: { type: 'object', optional: true },
          withPayload: { type: 'boolean', optional: true, default: false },
          withVectors: { type: 'boolean', optional: true, default: false },
        },
        openapi: {
          summary: 'Convenience semantic endpoint',
          tags: [OPENAPI_TAG],
          'x-oeo-class': OEO_CLASS,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['query'],
                  properties: {
                    query: { type: 'string', example: 'Welche CAPEX-Regeln gelten?' },
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    limit: { type: 'number', default: 10, example: 5 },
                    scoreThreshold: { type: 'number', example: 0.3 },
                    filter: { type: 'object', example: { must: [] } },
                    withPayload: { type: 'boolean', default: false, example: false },
                    withVectors: { type: 'boolean', default: false, example: false },
                  },
                },
                examples: {
                  default: {
                    value: {
                      query: 'Welche CAPEX-Regeln gelten?',
                      collection: 'tenant:stadtwerk-a:knowledge',
                      limit: 5,
                    },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
            ...SUCCESS_200_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startRagJob(ctx, { ...ctx.params, queryType: 'semantic' }, 'semantic');
        },
      },

      scroll: {
        rest: 'POST /scroll',
        params: {
          collection: { type: 'string', optional: true, trim: true },
          limit: { type: 'number', optional: true, convert: true, min: 1, max: 100, default: 10 },
          offset: { type: 'any', optional: true },
          filter: { type: 'object', optional: true },
          withPayload: { type: 'boolean', optional: true, default: false },
          withVectors: { type: 'boolean', optional: true, default: false },
        },
        openapi: {
          summary: 'Convenience scroll endpoint',
          tags: [OPENAPI_TAG],
          'x-oeo-class': OEO_CLASS,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    limit: { type: 'number', default: 10, example: 10 },
                    offset: { oneOf: [{ type: 'number' }, { type: 'string' }], example: 0 },
                    filter: { type: 'object', example: { must: [] } },
                    withPayload: { type: 'boolean', default: false, example: false },
                    withVectors: { type: 'boolean', default: false, example: false },
                  },
                },
                examples: {
                  default: {
                    value: { collection: 'tenant:stadtwerk-a:knowledge', limit: 10, offset: 0 },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
            ...SUCCESS_200_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startRagJob(ctx, { ...ctx.params, queryType: 'scroll' }, 'scroll');
        },
      },

      fetch: {
        rest: 'POST /fetch',
        params: {
          collection: { type: 'string', optional: true, trim: true },
          ids: { type: 'array', min: 1 },
          withPayload: { type: 'boolean', optional: true, default: false },
          withVectors: { type: 'boolean', optional: true, default: false },
        },
        openapi: {
          summary: 'Convenience fetch endpoint',
          tags: [OPENAPI_TAG],
          'x-oeo-class': OEO_CLASS,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['ids'],
                  properties: {
                    ids: {
                      type: 'array',
                      items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
                      example: ['doc-1:1:abc123def0'],
                    },
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    withPayload: { type: 'boolean', default: false, example: false },
                    withVectors: { type: 'boolean', default: false, example: false },
                  },
                },
                examples: {
                  default: {
                    value: {
                      collection: 'tenant:stadtwerk-a:knowledge',
                      ids: ['doc-1:1:abc123def0'],
                    },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
            ...SUCCESS_200_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startRagJob(ctx, { ...ctx.params, queryType: 'fetch' }, 'fetch');
        },
      },

      collectionInfo: {
        rest: 'POST /collection-info',
        params: {
          collection: { type: 'string', optional: true, trim: true },
          withPayload: { type: 'boolean', optional: true, default: false },
          withVectors: { type: 'boolean', optional: true, default: false },
        },
        openapi: {
          summary: 'Convenience collection info endpoint',
          tags: [OPENAPI_TAG],
          'x-oeo-class': OEO_CLASS,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    withPayload: { type: 'boolean', default: false, example: false },
                    withVectors: { type: 'boolean', default: false, example: false },
                  },
                },
                examples: {
                  default: {
                    value: { collection: 'tenant:stadtwerk-a:knowledge' },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
            ...SUCCESS_200_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startRagJob(
            ctx,
            { ...ctx.params, queryType: 'collection_info' },
            'collection_info'
          );
        },
      },

      createCollection: {
        rest: 'POST /collections',
        params: {
          name: { type: 'string', optional: true, trim: true },
          chunking: { type: 'object', optional: true },
          metadata: { type: 'object', optional: true },
          embeddingModelVersion: { type: 'string', optional: true, trim: true },
        },
        openapi: {
          summary: 'Create tenant-isolated RAG collection',
          tags: [OPENAPI_TAG],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    chunking: { type: 'object', example: { mode: 'markdown-section' } },
                    metadata: { type: 'object', example: { domain: 'regulatory' } },
                    embeddingModelVersion: { type: 'string', default: 'default', example: 'default' },
                  },
                },
                examples: {
                  default: {
                    value: {
                      name: 'tenant:stadtwerk-a:knowledge',
                      chunking: { mode: 'markdown-section' },
                    },
                  },
                },
              },
            },
          },
        },
        async handler(ctx) {
          const collection = await this.createCollectionRecord(ctx, ctx.params);
          return { success: true, collection };
        },
      },

      ingest: {
        rest: 'POST /ingest',
        params: {
          collection: { type: 'string', optional: true, trim: true },
          documents: { type: 'array', min: 1, items: 'object' },
          chunking: { type: 'object', optional: true },
          metadata: { type: 'object', optional: true },
        },
        openapi: {
          summary: 'Ingest documents into local RAG index',
          tags: [OPENAPI_TAG],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['documents'],
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    documents: { type: 'array', items: { type: 'object' }, example: [{ text: '§21a EnWG ...' }] },
                    chunking: { type: 'object', example: { mode: 'paragraph' } },
                    metadata: { type: 'object', example: { source: 'internal-policy' } },
                  },
                },
                examples: {
                  default: {
                    value: {
                      collection: 'tenant:stadtwerk-a:knowledge',
                      documents: [{ id: 'doc-1', text: '§21a EnWG ...' }],
                      chunking: { mode: 'paragraph' },
                    },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startIngestJob(ctx, ctx.params, 'documents');
        },
      },

      ingestFromDatasource: {
        rest: 'POST /ingest/from-datasource',
        params: {
          collection: { type: 'string', optional: true, trim: true },
          sourceId: { type: 'string', min: 1, trim: true },
          limit: { type: 'number', optional: true, convert: true, min: 1, max: 1000, default: 200 },
          offset: { type: 'number', optional: true, convert: true, min: 0, default: 0 },
          rowsPerDocument: {
            type: 'number',
            optional: true,
            convert: true,
            min: 1,
            max: 200,
            default: 40,
          },
          chunking: { type: 'object', optional: true },
          metadata: { type: 'object', optional: true },
        },
        openapi: {
          summary: 'Ingest from datasource cache/registry',
          tags: [OPENAPI_TAG],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sourceId'],
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    sourceId: { type: 'string', example: 'source-1' },
                    limit: { type: 'number', default: 200, example: 200 },
                    offset: { type: 'number', default: 0, example: 0 },
                    rowsPerDocument: { type: 'number', default: 40, example: 40 },
                    chunking: { type: 'object', example: { mode: 'fixed-window' } },
                    metadata: { type: 'object', example: { sourceClass: 'datasource' } },
                  },
                },
                examples: {
                  default: {
                    value: {
                      collection: 'tenant:stadtwerk-a:knowledge',
                      sourceId: 'source-1',
                      limit: 200,
                    },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startIngestJob(ctx, ctx.params, 'datasource');
        },
      },

      ingestFromAudit: {
        rest: 'POST /ingest/from-audit',
        params: {
          collection: { type: 'string', optional: true, trim: true },
          auditTypes: {
            type: 'array',
            optional: true,
            items: { type: 'enum', values: AUDIT_TYPES },
          },
          limit: { type: 'number', optional: true, convert: true, min: 1, max: 50, default: 10 },
          metadata: { type: 'object', optional: true },
        },
        openapi: {
          summary: 'Ingest self-knowledge from audit/report stores',
          tags: [OPENAPI_TAG],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:audit_history' },
                    auditTypes: { type: 'array', items: { type: 'string' }, example: ['cya', 'redispatch'] },
                    limit: { type: 'number', default: 10, example: 10 },
                    metadata: { type: 'object', example: { sourceClass: 'audit' } },
                  },
                },
                examples: {
                  default: {
                    value: { auditTypes: ['cya', 'mastr-quality'], limit: 10 },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startIngestJob(ctx, ctx.params, 'audit');
        },
      },

      removeCollection: {
        rest: 'DELETE /collections/:name',
        params: {
          name: { type: 'string', min: 3, trim: true },
        },
        openapi: {
          summary: 'Delete collection + chunks',
          tags: [OPENAPI_TAG],
        },
        async handler(ctx) {
          const removed = await this.deleteCollection(ctx, ctx.params.name);
          return { success: true, ...removed };
        },
      },

      reindex: {
        rest: 'POST /reindex/:collection',
        params: {
          collection: { type: 'string', min: 3, trim: true },
          embeddingModelVersion: { type: 'string', min: 1, trim: true },
        },
        openapi: {
          summary: 'Re-embed collection with new embedding model version',
          tags: [OPENAPI_TAG],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['collection', 'embeddingModelVersion'],
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    embeddingModelVersion: { type: 'string', default: 'default', example: 'embed-v2' },
                  },
                },
                examples: {
                  default: {
                    value: {
                      collection: 'tenant:stadtwerk-a:knowledge',
                      embeddingModelVersion: 'embed-v2',
                    },
                  },
                },
              },
            },
          },
          responses: {
            ...JOB_202_RESPONSE,
          },
        },
        async handler(ctx) {
          return this.startReindexJob(ctx, ctx.params);
        },
      },

      cutover: {
        rest: 'POST /cutover/:collection',
        params: {
          collection: { type: 'string', min: 3, trim: true },
          modelVersion: { type: 'string', min: 1, trim: true },
        },
        openapi: {
          summary: 'Cut over active model version in collection',
          tags: [OPENAPI_TAG],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['collection', 'modelVersion'],
                  properties: {
                    collection: { type: 'string', example: 'tenant:stadtwerk-a:knowledge' },
                    modelVersion: { type: 'string', default: 'default', example: 'embed-v2' },
                  },
                },
                examples: {
                  default: {
                    value: {
                      collection: 'tenant:stadtwerk-a:knowledge',
                      modelVersion: 'embed-v2',
                    },
                  },
                },
              },
            },
          },
        },
        async handler(ctx) {
          const collection = await this.cutoverCollectionVersion(
            ctx,
            ctx.params.collection,
            ctx.params.modelVersion
          );
          return { success: true, collection };
        },
      },
    },

    methods: {
      validateRagParams(params) {
        const queryType = params.queryType || 'semantic';

        if (queryType === 'semantic') {
          if (!params.query || !String(params.query).trim()) {
            throw new Errors.MoleculerClientError(
              'Parameter "query" is required for queryType=semantic',
              400,
              'VALIDATION_ERROR'
            );
          }
        }

        if (queryType === 'fetch') {
          if (!Array.isArray(params.ids) || params.ids.length === 0) {
            throw new Errors.MoleculerClientError(
              'Parameter "ids" is required and must be non-empty for queryType=fetch',
              400,
              'VALIDATION_ERROR'
            );
          }
          const invalidId = params.ids.find((id) => typeof id !== 'string' && typeof id !== 'number');
          if (invalidId !== undefined) {
            throw new Errors.MoleculerClientError(
              'Each entry in "ids" must be either a string or number',
              400,
              'VALIDATION_ERROR'
            );
          }
        }

        return queryType;
      },

      resolveTenantCollection(ctx, requestedCollection, suffix = 'knowledge') {
        const explicit = String(requestedCollection || '').trim();
        if (explicit) return explicit;
        return `tenant:${getTenantId(ctx)}:${suffix}`;
      },

      resolveQueryCollection(requestedCollection) {
        const explicit = String(requestedCollection || '').trim();
        return explicit || DEFAULT_EXTERNAL_COLLECTION;
      },

      getCollectionNamespace(ctx) {
        return tenantNamespace(COLLECTION_NS, getTenantId(ctx));
      },

      getChunkNamespace(ctx) {
        return tenantNamespace(CHUNK_NS, getTenantId(ctx));
      },

      hashString(value) {
        return crypto.createHash('sha256').update(String(value || '')).digest('hex');
      },

      collectionKey(name) {
        return `collection-${this.hashString(name).slice(0, 24)}`;
      },

      chunkKey(payload) {
        const base = [
          payload.collection,
          payload.modelVersion,
          payload.sourceId,
          payload.sourceVersion,
          payload.sha256,
          payload.chunkIndex,
        ].join('|');
        return `chunk-${this.hashString(base).slice(0, 40)}`;
      },

      normalizeChunkingConfig(input = {}) {
        return {
          mode: normalizeMode(input.mode || 'paragraph'),
          windowSize: clamp(input.windowSize || 1000, 200, 5000),
          overlap: clamp(input.overlap || 120, 0, 1000),
          maxChars: clamp(input.maxChars || 900, 200, 5000),
        };
      },

      sanitizeOeoTags(...candidateLists) {
        const tags = new Set();
        for (const list of candidateLists) {
          if (!Array.isArray(list)) continue;
          for (const entry of list) {
            const value = String(entry || '').trim();
            if (value) tags.add(value);
          }
        }
        return Array.from(tags).slice(0, 50);
      },

      async objectQuery(ctx, namespace, selector = {}, limit = 1000, skip = 0) {
        return ctx.call(
          'object-store.query',
          { namespace, selector, limit, skip },
          { meta: ctx.meta }
        );
      },

      async objectPut(ctx, namespace, key, payload) {
        return ctx.call('object-store.put', { namespace, key, payload }, { meta: ctx.meta });
      },

      async objectDelete(ctx, namespace, key) {
        return ctx.call('object-store.delete', { namespace, key }, { meta: ctx.meta });
      },

      async findCollectionRecord(ctx, collectionName) {
        const namespace = this.getCollectionNamespace(ctx);
        const response = await this.objectQuery(
          ctx,
          namespace,
          {
            'payload.name': collectionName,
          },
          1,
          0
        );
        const first = Array.isArray(response?.docs) && response.docs.length > 0 ? response.docs[0] : null;
        return first ? first.payload : null;
      },

      async createCollectionRecord(ctx, params = {}) {
        const now = new Date().toISOString();
        const collectionName = this.resolveTenantCollection(ctx, params.name);
        const chunking = this.normalizeChunkingConfig(params.chunking || {});
        const embeddingModelVersion =
          String(params.embeddingModelVersion || '').trim() || DEFAULT_EMBEDDING_VERSION;
        const metadata = scrubForLLM(params.metadata || {}).scrubbed;

        const existing = await this.findCollectionRecord(ctx, collectionName);
        const indexRows = Array.isArray(existing?.indexes) ? existing.indexes : [];
        const hasModel = indexRows.some((row) => row.modelVersion === embeddingModelVersion);
        const indexes = hasModel
          ? indexRows.map((row) =>
              row.modelVersion === embeddingModelVersion
                ? { ...row, status: 'active', cutoverAt: now, expiresAt: null }
                : row
            )
          : [
              ...indexRows.map((row) => ({ ...row, status: row.status === 'active' ? 'grace' : row.status })),
              {
                modelVersion: embeddingModelVersion,
                status: 'active',
                createdAt: now,
                cutoverAt: now,
                expiresAt: null,
              },
            ];

        const payload = {
          name: collectionName,
          tenantId: getTenantId(ctx),
          metadata,
          chunking,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          activeModelVersion: embeddingModelVersion,
          indexes,
        };

        await this.objectPut(ctx, this.getCollectionNamespace(ctx), this.collectionKey(collectionName), payload);
        return payload;
      },

      async getCollectionRecord(ctx, collectionName, options = {}) {
        const record = await this.findCollectionRecord(ctx, collectionName);
        if (record || options.createIfMissing !== true) return record;
        return this.createCollectionRecord(ctx, { name: collectionName, chunking: options.chunking });
      },

      async deleteCollection(ctx, collectionName) {
        const record = await this.findCollectionRecord(ctx, collectionName);
        if (!record) {
          throw new Errors.MoleculerClientError(
            `Collection not found: ${collectionName}`,
            404,
            'NOT_FOUND'
          );
        }

        const page = await this.objectQuery(
          ctx,
          this.getChunkNamespace(ctx),
          { 'payload.collection': collectionName },
          1000,
          0
        );
        const docs = Array.isArray(page?.docs) ? page.docs : [];
        for (const doc of docs) {
          await this.objectDelete(ctx, this.getChunkNamespace(ctx), doc.key);
        }

        await this.objectDelete(ctx, this.getCollectionNamespace(ctx), this.collectionKey(collectionName));
        return { collection: collectionName, removedChunks: docs.length };
      },

      async listCollectionChunks(ctx, collectionName, modelVersion) {
        const response = await this.objectQuery(
          ctx,
          this.getChunkNamespace(ctx),
          {
            'payload.collection': collectionName,
            'payload.modelVersion': modelVersion,
          },
          1000,
          0
        );
        return (Array.isArray(response?.docs) ? response.docs : []).map((doc) => doc.payload);
      },

      getByPath(value, path) {
        const key = String(path || '').trim();
        if (!key) return undefined;
        const parts = key.split('.');
        let current = value;
        for (const part of parts) {
          if (current === null || current === undefined) return undefined;
          current = current[part];
        }
        return current;
      },

      matchesClause(row, clause) {
        const key = clause?.key;
        if (!key) return true;

        const rowValue = this.getByPath(row, key);
        const match = clause.match || {};

        if (Object.prototype.hasOwnProperty.call(match, 'value')) {
          return String(rowValue) === String(match.value);
        }

        if (Array.isArray(match.any)) {
          if (Array.isArray(rowValue)) {
            return rowValue.some((entry) => match.any.map(String).includes(String(entry)));
          }
          return match.any.map(String).includes(String(rowValue));
        }

        if (typeof match.text === 'string') {
          return String(rowValue || '').toLowerCase().includes(match.text.toLowerCase());
        }

        return true;
      },

      matchesFilter(row, filter = {}) {
        const must = Array.isArray(filter.must) ? filter.must : [];
        const should = Array.isArray(filter.should) ? filter.should : [];
        const mustNot = Array.isArray(filter.must_not) ? filter.must_not : [];
        if (must.some((clause) => !this.matchesClause(row, clause))) return false;
        if (mustNot.some((clause) => this.matchesClause(row, clause))) return false;
        if (should.length > 0 && !should.some((clause) => this.matchesClause(row, clause))) return false;
        return true;
      },

      async localSemanticSearch(ctx, collection, record, params) {
        const queryVector = (await embeddings([String(params.query || '')]))[0] || [];
        const chunks = await this.listCollectionChunks(ctx, collection, record.activeModelVersion);
        const rows = chunks
          .map((chunk) => ({
            pointId: chunk.pointId,
            score: cosine(queryVector, chunk.vector || []),
            referenceText_L0: chunk.text,
            vectorText: chunk.text,
            metadata: chunk.metadata,
            oeoTags: chunk.oeoTags,
            vector: chunk.vector,
          }))
          .filter((row) => this.matchesFilter(row, params.filter || {}));

        const threshold = Number.isFinite(params.scoreThreshold) ? params.scoreThreshold : -1;
        const filtered = rows.filter((row) => row.score >= threshold).sort((a, b) => b.score - a.score);
        const offset = parseOffset(params.offset);
        const limit = clamp(params.limit || 10, 1, 100);
        const sliced = filtered.slice(offset, offset + limit).map((row) => {
          const out = { ...row };
          if (!params.withVectors) delete out.vector;
          return out;
        });

        return {
          success: true,
          data: {
            queryType: 'semantic',
            collection,
            returned: sliced.length,
            total: filtered.length,
            offset,
            nextOffset: offset + sliced.length < filtered.length ? String(offset + sliced.length) : null,
            results: sliced,
          },
        };
      },

      async localScroll(ctx, collection, record, params) {
        const chunks = await this.listCollectionChunks(ctx, collection, record.activeModelVersion);
        const rows = chunks
          .map((chunk) => ({
            pointId: chunk.pointId,
            referenceText_L0: chunk.text,
            vectorText: chunk.text,
            metadata: chunk.metadata,
            oeoTags: chunk.oeoTags,
            vector: chunk.vector,
          }))
          .filter((row) => this.matchesFilter(row, params.filter || {}));

        const offset = parseOffset(params.offset);
        const limit = clamp(params.limit || 10, 1, 100);
        const sliced = rows.slice(offset, offset + limit).map((row) => {
          const out = { ...row };
          if (!params.withVectors) delete out.vector;
          return out;
        });

        return {
          success: true,
          data: {
            queryType: 'scroll',
            collection,
            returned: sliced.length,
            total: rows.length,
            offset,
            nextOffset: offset + sliced.length < rows.length ? String(offset + sliced.length) : null,
            results: sliced,
          },
        };
      },

      async localFetch(ctx, collection, record, params) {
        const chunks = await this.listCollectionChunks(ctx, collection, record.activeModelVersion);
        const idSet = new Set((params.ids || []).map((id) => String(id)));
        const rows = chunks
          .filter((chunk) => idSet.has(String(chunk.pointId)))
          .map((chunk) => ({
            pointId: chunk.pointId,
            referenceText_L0: chunk.text,
            vectorText: chunk.text,
            metadata: chunk.metadata,
            oeoTags: chunk.oeoTags,
            vector: chunk.vector,
          }))
          .filter((row) => this.matchesFilter(row, params.filter || {}));

        const output = rows.map((row) => {
          const out = { ...row };
          if (!params.withVectors) delete out.vector;
          return out;
        });

        return {
          success: true,
          data: {
            queryType: 'fetch',
            collection,
            returned: output.length,
            results: output,
          },
        };
      },

      async localCollectionInfo(ctx, collection, record) {
        const chunks = await this.listCollectionChunks(ctx, collection, record.activeModelVersion);
        return {
          success: true,
          data: {
            queryType: 'collection_info',
            collection,
            returned: 1,
            results: [
              {
                name: record.name,
                tenantId: record.tenantId,
                chunking: record.chunking,
                activeModelVersion: record.activeModelVersion,
                indexes: record.indexes,
                chunkCount: chunks.length,
                metadata: record.metadata,
              },
            ],
          },
        };
      },

      async tryHandleLocalQuery(ctx, toolParams) {
        const collection = String(toolParams.collection || '').trim();
        if (!collection) return null;

        let record;
        try {
          record = await this.getCollectionRecord(ctx, collection, { createIfMissing: false });
        } catch (error) {
          if (error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError') return null;
          throw error;
        }

        if (!record) return null;

        if (toolParams.queryType === 'semantic') return this.localSemanticSearch(ctx, collection, record, toolParams);
        if (toolParams.queryType === 'scroll') return this.localScroll(ctx, collection, record, toolParams);
        if (toolParams.queryType === 'fetch') return this.localFetch(ctx, collection, record, toolParams);
        return this.localCollectionInfo(ctx, collection, record);
      },

      startRagJob(ctx, rawParams, actionName) {
        const queryType = this.validateRagParams(rawParams);
        const collection = this.resolveQueryCollection(rawParams.collection);
        const toolParams = {
          ...rawParams,
          queryType,
          collection,
        };

        return startJob(
          ctx,
          { service: 'knowledge-rag', action: actionName },
          async (jobId) => {
            if (jobId) appendLog(jobId, 'queued', 0, `Starting RAG query (${queryType})`);

            const localResult = await this.tryHandleLocalQuery(ctx, toolParams);
            if (localResult) {
              metrics.recordRagQuery(collection, inferHitCount(localResult));
              if (jobId) appendLog(jobId, 'completed', 100, 'Local RAG query finished');
              return localResult;
            }

            const result = await callWithAutoPoll(
              MCP_TOOL,
              toolParams,
              {
                maxWaitTime: 8 * 60 * 1000,
                pollInterval: 2000,
                onStatusUpdate: (update) => {
                  if (!jobId) return;
                  const statusLabel = String(update.status || 'running');
                  const progress = statusLabel === 'succeeded' ? 100 : 50;
                  appendLog(jobId, statusLabel, progress, `MCP job status: ${statusLabel}`);
                },
              },
              ctx.meta.cernionToken
            );

            metrics.recordRagQuery(collection, inferHitCount(result));
            if (jobId) appendLog(jobId, 'completed', 100, `${MCP_TOOL} finished`);
            return result;
          }
        );
      },

      ensureEmbeddingCapability() {
        const cap = capabilities();
        if (!cap.embeddings) {
          throw new Errors.MoleculerError(
            'Embeddings capability is required for knowledge-rag ingestion.',
            503,
            'LLM_CAPABILITY_MISSING'
          );
        }
      },

      async extractDocumentText(doc) {
        if (typeof doc?.text === 'string' && doc.text.trim()) return doc.text;

        if (typeof doc?.content === 'string' && doc.content.trim()) {
          const mimeType = String(doc.mimeType || doc.format || '').toLowerCase();
          if (mimeType.includes('pdf')) {
            try {
              const bytes = Buffer.from(doc.content, 'base64');
              const parsed = await pdfParse(bytes);
              return parsed.text || '';
            } catch {
              return '';
            }
          }
          return doc.content;
        }

        if (doc?.payload && typeof doc.payload === 'object') {
          return JSON.stringify(doc.payload, null, 2);
        }

        return '';
      },

      normalizeDocumentMetadata(doc, defaults = {}) {
        const merged = { ...defaults, ...(doc?.metadata || {}) };
        return scrubForLLM(merged).scrubbed;
      },

      async buildDocumentsFromDatasource(ctx, params) {
        const sourceResponse = await ctx.call(
          'datasource-registry.get',
          { id: params.sourceId },
          { meta: ctx.meta }
        );
        const source = sourceResponse?.data || {};

        const cache = await ctx.call(
          'datasource-cache.query',
          {
            sourceId: params.sourceId,
            limit: params.limit || 200,
            offset: params.offset || 0,
            privacyContext: 'ai-agent',
          },
          { meta: ctx.meta }
        );

        const rows = Array.isArray(cache?.data) ? cache.data : [];
        const rowsPerDocument = clamp(params.rowsPerDocument || 40, 1, 200);
        const docs = [];

        for (let i = 0; i < rows.length; i += rowsPerDocument) {
          const slice = rows.slice(i, i + rowsPerDocument);
          const scrubbedRows = scrubForLLM(slice).scrubbed;
          docs.push({
            id: `${params.sourceId}-${i + 1}`,
            sourceId: params.sourceId,
            sourceVersion: source.updatedAt || source.dictionary?.updatedAt || 'unknown',
            title: `${source.name || params.sourceId} rows ${i + 1}-${i + slice.length}`,
            text: [
              `Datasource: ${source.name || params.sourceId}`,
              `Description: ${source.description || ''}`,
              `Connector: ${source.connectorType || 'unknown'}`,
              '',
              JSON.stringify(scrubbedRows, null, 2),
            ].join('\n'),
            metadata: {
              sourceName: source.name || params.sourceId,
              connectorType: source.connectorType || null,
              tags: source.tags || [],
              dictionaryVersion: source.dictionary?.version || null,
              privacyContext: 'ai-agent',
            },
            oeoTags: source.semanticClassification?.semanticHints?.oeoTags || [],
          });
        }

        return docs;
      },

      async buildDocumentsFromAudit(ctx, params) {
        const types = Array.isArray(params.auditTypes) && params.auditTypes.length > 0
          ? params.auditTypes
          : ['cya', 'mastr-quality', 'redispatch'];
        const limit = clamp(params.limit || 10, 1, 50);
        const docs = [];

        if (types.includes('cya')) {
          try {
            const profiles = await ctx.call('cya.listProfiles', { limit }, { meta: ctx.meta });
            const items = Array.isArray(profiles?.items) ? profiles.items : [];
            for (const item of items) {
              docs.push({
                id: `cya-profile-${item.key}`,
                sourceId: 'cya.profile',
                sourceVersion: item.updatedAt || item.createdAt || 'unknown',
                title: `CYA profile ${item.key}`,
                text: JSON.stringify(scrubForLLM(item.payload || {}).scrubbed, null, 2),
                metadata: { auditType: 'cya', key: item.key },
                oeoTags: item.payload?.oeoTags || [],
              });
            }
          } catch (error) {
            if (!(error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError')) throw error;
          }
        }

        if (types.includes('mastr-quality')) {
          try {
            const response = await ctx.call('mastr-quality.list', { limit }, { meta: ctx.meta });
            const audits = Array.isArray(response?.audits) ? response.audits : [];
            for (const audit of audits) {
              docs.push({
                id: `mq-${audit.id}`,
                sourceId: 'mastr-quality.audit',
                sourceVersion: audit.createdAt || 'unknown',
                title: `MaStR Quality Audit ${audit.id}`,
                text: JSON.stringify(scrubForLLM(audit).scrubbed, null, 2),
                metadata: { auditType: 'mastr-quality', auditId: audit.id },
                oeoTags: ['oeo:Audit'],
              });
            }
          } catch (error) {
            if (!(error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError')) throw error;
          }
        }

        if (types.includes('redispatch')) {
          try {
            const response = await ctx.call('redispatch-expost.list', { limit }, { meta: ctx.meta });
            const audits = Array.isArray(response?.audits) ? response.audits : [];
            for (const audit of audits) {
              docs.push({
                id: `rd-${audit.id}`,
                sourceId: 'redispatch-expost.audit',
                sourceVersion: audit.createdAt || 'unknown',
                title: `Redispatch Ex-Post Audit ${audit.id}`,
                text: JSON.stringify(scrubForLLM(audit).scrubbed, null, 2),
                metadata: { auditType: 'redispatch', auditId: audit.id },
                oeoTags: ['oeo:Audit'],
              });
            }
          } catch (error) {
            if (!(error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError')) throw error;
          }
        }

        if (types.includes('energy-sharing')) {
          try {
            const response = await ctx.call('energy-sharing.list', { limit }, { meta: ctx.meta });
            const validations = Array.isArray(response?.validations) ? response.validations : [];
            for (const report of validations) {
              docs.push({
                id: `es-${report.id}`,
                sourceId: 'energy-sharing.validation',
                sourceVersion: report.createdAt || 'unknown',
                title: `Energy Sharing Validation ${report.id}`,
                text: JSON.stringify(scrubForLLM(report).scrubbed, null, 2),
                metadata: { auditType: 'energy-sharing', validationId: report.id },
                oeoTags: ['oeo:Validation'],
              });
            }
          } catch (error) {
            if (!(error?.type === 'SERVICE_NOT_FOUND' || error?.name === 'ServiceNotFoundError')) throw error;
          }
        }

        return docs;
      },

      async buildDocumentsForIngest(ctx, params, sourceType) {
        if (sourceType === 'datasource') return this.buildDocumentsFromDatasource(ctx, params);
        if (sourceType === 'audit') return this.buildDocumentsFromAudit(ctx, params);
        return Array.isArray(params.documents) ? params.documents : [];
      },

      async persistDocumentChunks(ctx, collectionRecord, doc, options = {}) {
        const tenantId = getTenantId(ctx);
        const now = new Date().toISOString();
        const baseMetadata = this.normalizeDocumentMetadata(doc, options.metadata || {});
        const text = scrubPromptText(await this.extractDocumentText(doc));
        if (!text || !text.trim()) return { chunks: 0, pointIds: [] };

        const chunks = chunkText(text, collectionRecord.chunking);
        if (!Array.isArray(chunks) || chunks.length === 0) return { chunks: 0, pointIds: [] };

        const vectors = await embeddings(chunks.map((chunk) => scrubPromptText(chunk)));
        const pointIds = [];

        for (let i = 0; i < chunks.length; i += 1) {
          const chunkTextValue = String(chunks[i] || '').trim();
          if (!chunkTextValue) continue;

          const sourceId = String(doc.sourceId || doc.id || `doc-${i + 1}`);
          const sourceVersion = String(doc.sourceVersion || doc.version || '1');
          const chunkSha = this.hashString(chunkTextValue);
          const pointId = `${sourceId}:${i + 1}:${chunkSha.slice(0, 10)}`;

          const payload = {
            pointId,
            collection: collectionRecord.name,
            modelVersion: collectionRecord.activeModelVersion,
            sourceId,
            sourceVersion,
            sha256: chunkSha,
            chunkIndex: i,
            title: String(doc.title || sourceId),
            text: chunkTextValue,
            vector: Array.isArray(vectors[i]) ? vectors[i] : [],
            oeoTags: this.sanitizeOeoTags(doc.oeoTags, baseMetadata.oeoTags),
            metadata: {
              ...baseMetadata,
              title: String(doc.title || sourceId),
              sourceType: options.sourceType || 'documents',
              tenantId,
              ingestedAt: now,
            },
            tenantId,
            ingestedAt: now,
          };

          await this.objectPut(ctx, this.getChunkNamespace(ctx), this.chunkKey(payload), payload);
          pointIds.push(pointId);
        }

        return { chunks: pointIds.length, pointIds };
      },

      startIngestJob(ctx, params, sourceType) {
        return startJob(
          ctx,
          { service: 'knowledge-rag', action: `ingest:${sourceType}` },
          async (jobId) => {
            this.ensureEmbeddingCapability();

            const collectionName =
              sourceType === 'audit'
                ? this.resolveTenantCollection(ctx, params.collection, 'audit_history')
                : this.resolveTenantCollection(ctx, params.collection, 'knowledge');

            if (jobId) appendLog(jobId, 'setup', 5, `Preparing ingest for ${collectionName}`);

            const collectionRecord = await this.getCollectionRecord(ctx, collectionName, {
              createIfMissing: true,
              chunking: params.chunking || {},
            });

            const documents = await this.buildDocumentsForIngest(ctx, params, sourceType);
            if (jobId) appendLog(jobId, 'prepare_documents', 20, `Prepared ${documents.length} document(s)`);

            let totalChunks = 0;
            let totalDocuments = 0;
            const pointIds = [];

            for (let i = 0; i < documents.length; i += 1) {
              const result = await this.persistDocumentChunks(ctx, collectionRecord, documents[i], {
                sourceType,
                metadata: params.metadata || {},
              });
              totalDocuments += 1;
              totalChunks += result.chunks;
              pointIds.push(...result.pointIds);
              if (jobId) {
                const pct = Math.floor(20 + ((i + 1) / Math.max(documents.length, 1)) * 75);
                appendLog(jobId, 'ingest', pct, `Ingested document ${i + 1}/${documents.length}`);
              }
            }

            await this.objectPut(
              ctx,
              this.getCollectionNamespace(ctx),
              this.collectionKey(collectionRecord.name),
              {
                ...collectionRecord,
                updatedAt: new Date().toISOString(),
              }
            );

            if (jobId) appendLog(jobId, 'completed', 100, 'Ingest completed');

            return {
              success: true,
              data: {
                collection: collectionName,
                sourceType,
                documentsIngested: totalDocuments,
                chunksIngested: totalChunks,
                pointIds: pointIds.slice(0, 100),
              },
            };
          }
        );
      },

      async reembedChunk(ctx, chunk, targetModelVersion) {
        const vector = (await embeddings([chunk.text]))[0] || [];
        const payload = {
          ...chunk,
          modelVersion: targetModelVersion,
          vector,
          metadata: {
            ...(chunk.metadata || {}),
            reembeddedAt: new Date().toISOString(),
            sourceModelVersion: chunk.modelVersion,
            modelVersion: targetModelVersion,
          },
        };
        await this.objectPut(ctx, this.getChunkNamespace(ctx), this.chunkKey(payload), payload);
      },

      startReindexJob(ctx, params) {
        return startJob(
          ctx,
          { service: 'knowledge-rag', action: 'reindex' },
          async (jobId) => {
            this.ensureEmbeddingCapability();
            const collectionName = String(params.collection || '').trim();
            const targetModelVersion = String(params.embeddingModelVersion || '').trim();
            const record = await this.getCollectionRecord(ctx, collectionName, { createIfMissing: false });

            if (!record) {
              throw new Errors.MoleculerClientError(
                `Collection not found: ${collectionName}`,
                404,
                'NOT_FOUND'
              );
            }

            const previousModel = record.activeModelVersion;
            const chunks = await this.listCollectionChunks(ctx, collectionName, previousModel);
            if (jobId) appendLog(jobId, 'prepare_reindex', 10, `Reindex ${chunks.length} chunk(s)`);

            for (let i = 0; i < chunks.length; i += 1) {
              await this.reembedChunk(ctx, chunks[i], targetModelVersion);
              if (jobId) {
                const pct = Math.floor(10 + ((i + 1) / Math.max(chunks.length, 1)) * 80);
                appendLog(jobId, 'reembed', pct, `Re-embedded chunk ${i + 1}/${chunks.length}`);
              }
            }

            const now = new Date();
            const graceExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
            const updated = {
              ...record,
              activeModelVersion: targetModelVersion,
              updatedAt: now.toISOString(),
              indexes: [
                ...(Array.isArray(record.indexes) ? record.indexes : [])
                  .map((row) =>
                    row.modelVersion === previousModel && row.status === 'active'
                      ? { ...row, status: 'grace', expiresAt: graceExpiresAt }
                      : row
                  )
                  .filter((row) => row.modelVersion !== targetModelVersion),
                {
                  modelVersion: targetModelVersion,
                  status: 'active',
                  createdAt: now.toISOString(),
                  cutoverAt: now.toISOString(),
                  expiresAt: null,
                },
              ],
            };

            await this.objectPut(ctx, this.getCollectionNamespace(ctx), this.collectionKey(collectionName), updated);
            if (jobId) appendLog(jobId, 'completed', 100, 'Reindex completed');

            return {
              success: true,
              data: {
                collection: collectionName,
                fromModelVersion: previousModel,
                toModelVersion: targetModelVersion,
                chunksReembedded: chunks.length,
                graceExpiresAt,
              },
            };
          }
        );
      },

      async cutoverCollectionVersion(ctx, collectionName, modelVersion) {
        const record = await this.getCollectionRecord(ctx, collectionName, { createIfMissing: false });
        if (!record) {
          throw new Errors.MoleculerClientError(`Collection not found: ${collectionName}`, 404, 'NOT_FOUND');
        }

        const now = new Date().toISOString();
        const indexes = Array.isArray(record.indexes) ? [...record.indexes] : [];
        if (!indexes.some((row) => row.modelVersion === modelVersion)) {
          throw new Errors.MoleculerClientError(
            `Model version not available in collection: ${modelVersion}`,
            400,
            'VALIDATION_ERROR'
          );
        }

        const updated = {
          ...record,
          activeModelVersion: modelVersion,
          updatedAt: now,
          indexes: indexes.map((row) => {
            if (row.modelVersion === modelVersion) {
              return { ...row, status: 'active', cutoverAt: now, expiresAt: null };
            }
            if (row.status === 'active') {
              return {
                ...row,
                status: 'grace',
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              };
            }
            return row;
          }),
        };

        await this.objectPut(ctx, this.getCollectionNamespace(ctx), this.collectionKey(collectionName), updated);
        return updated;
      },
    },
  };
})();
