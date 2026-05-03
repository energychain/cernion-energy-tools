'use strict';

const { Errors } = require('moleculer');
const { callWithAutoPoll } = require('../src/async-job-poller');
const { appendLog, startJob } = require('../src/job-store');

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
