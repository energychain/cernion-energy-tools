/**
 * Willi-Mako Marktkommunikation knowledge wrapper.
 *
 * Dedicated CET microservice for read-only Willi-Mako / Marktkommunikation
 * article/context search, backed by the internal Cernion MCP tool
 * `cernion_willi_mako_search`. Kept separate from the generic
 * `knowledge-rag` service so MaKo knowledge stays scoped to validation
 * logic, structural hints and explanation context rather than overloading
 * the general RAG contract.
 *
 * This service is read-only evidence/context: it never makes a binding
 * legal/regulatory decision, and `resolveStructure` never triggers or
 * instructs a MaKo message send.
 */

const CernionMCPClient = require('../src/mcp-client');

const OPENAPI_TAG = 'Willi-Mako Marktkommunikation';
const MCP_TOOL = 'cernion_willi_mako_search';

const NO_CALL_BOUNDARIES = [
  'This response is not legally binding and is not an instruction to send a MaKo message.',
  'No APERAK, UTILMD, MSCONS or other EDIFACT message is created, validated against BDEW rules, or dispatched from this service.',
  'No MaKo production decision, tariff, billing, settlement, or device-control action is taken.',
];

function normalizeResultItem(item = {}, includeContent) {
  const normalized = {
    id: item.id,
    slug: item.slug,
    title: item.title,
    score: item.score,
    category: item.category,
    tags: Array.isArray(item.tags) ? item.tags : [],
    excerpt: item.excerpt,
    url: item.url,
  };
  if (includeContent && item.content !== undefined) {
    normalized.content = item.content;
  }
  return normalized;
}

/**
 * Normalizes the raw MCP tool response into a stable CET shape.
 * Accepts both `data.results[]` (documented shape) and a top-level
 * `results[]` (backward-compatibility fallback) per #494 test requirements.
 */
function normalizeSearchResponse(rawResult, includeContent) {
  if (!rawResult || rawResult.success === false) {
    return rawResult || { success: false, error: { code: 'MCP_NO_RESPONSE' } };
  }

  const raw = rawResult.data || rawResult;
  const rawResults = Array.isArray(raw.results) ? raw.results : [];
  const results = rawResults.map((item) => normalizeResultItem(item, includeContent));

  return {
    success: true,
    data: {
      source: raw.source || 'willi-mako-service',
      queryType: raw.queryType,
      query: raw.query,
      returned: results.length,
      totalScanned: raw.totalScanned,
      warning: raw.warning,
      results,
    },
  };
}

module.exports = {
  name: 'willi-mako',

  actions: {
    /**
     * Read-only Willi-Mako / Marktkommunikation article/context search.
     */
    search: {
      rest: 'POST /search',
      params: {
        query: { type: 'string', min: 1 },
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 20, default: 5 },
        tag: { type: 'string', optional: true },
        category: { type: 'string', optional: true },
        includeContent: { type: 'boolean', optional: true, convert: true, default: false },
      },
      openapi: {
        summary: 'Willi-Mako Marktkommunikation knowledge search (read-only)',
        tags: [OPENAPI_TAG],
        description:
          'Read-only search over Willi-Mako / Marktkommunikation articles via the internal MCP tool ' +
          '`cernion_willi_mako_search`. Returns article/context evidence for validation logic, structural ' +
          'hints and explanation context; it does not send, validate or dispatch any MaKo message.',
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
                    example: 'APERAK Fehlercode Frist Marktkommunikation',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 5, example: 3 },
                  tag: { type: 'string', example: 'APERAK' },
                  category: { type: 'string', example: 'edifact' },
                  includeContent: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: { query: 'APERAK Fehlercode Frist Marktkommunikation', limit: 3 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Read-only Willi-Mako search result',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    source: 'willi-mako-service',
                    returned: 3,
                    results: [
                      {
                        id: 'wm-1',
                        slug: 'aperak-frist-effizienz',
                        title: 'APERAK-Frist: Effizienz in der Marktkommunikation steigern',
                        score: 32,
                        category: 'edifact',
                        tags: ['APERAK', 'Frist'],
                        excerpt: 'Kurzfassung des Artikels...',
                        url: 'https://stromhaltig.de/wissen/aperak-frist-effizienz',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { query, limit, tag, category, includeContent } = ctx.params;
        try {
          const rawResult = await CernionMCPClient.callWithNewSession(
            MCP_TOOL,
            { query, limit, tag, category },
            ctx.meta.cernionToken
          );
          return normalizeSearchResponse(rawResult, includeContent);
        } catch (err) {
          return {
            success: false,
            error: { code: 'MCP_ERROR', message: err.message },
          };
        }
      },
    },

    /**
     * Structure-oriented view over a Willi-Mako search, useful as
     * conservative input for MaKo validation planning. Never executes,
     * validates, or dispatches a MaKo message itself.
     */
    resolveStructure: {
      rest: 'POST /resolve-structure',
      params: {
        query: { type: 'string', min: 1 },
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 20, default: 5 },
        tag: { type: 'string', optional: true },
        category: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Willi-Mako structure-oriented validation-planning view (read-only, advisory)',
        tags: [OPENAPI_TAG],
        description:
          'Calls `willi-mako.search` internally and returns a conservative, structure-oriented view ' +
          '(sources, structural hints, validation candidates, no-call boundaries, confidence) useful for ' +
          'MaKo validation planning. Never autonomously executes, validates, or dispatches a MaKo message.',
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
                    example: 'APERAK Fehlercode Frist Marktkommunikation',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 5, example: 5 },
                  tag: { type: 'string', example: 'APERAK' },
                  category: { type: 'string', example: 'edifact' },
                },
              },
              examples: {
                default: {
                  value: { query: 'APERAK Fehlercode Frist Marktkommunikation' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Read-only structure-oriented validation-planning view',
          },
        },
      },
      async handler(ctx) {
        const { query, limit, tag, category } = ctx.params;
        const searchResult = await ctx.call('willi-mako.search', { query, limit, tag, category });

        if (!searchResult || searchResult.success === false) {
          return {
            success: false,
            error: searchResult?.error || { code: 'MCP_NO_RESPONSE' },
          };
        }

        const results = Array.isArray(searchResult.data?.results) ? searchResult.data.results : [];

        const sources = results.map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          score: item.score,
        }));

        const structuralHints = results
          .filter((item) => item.category)
          .map((item) => ({
            category: item.category,
            tags: item.tags,
            hint: `Willi-Mako article "${item.title}" is categorized as "${item.category}".`,
          }));

        const validationCandidates = results.map((item) => ({
          topic: item.title,
          sourceId: item.id,
          confidenceHint: item.score,
          suggestedUse: 'structural_hint_only',
        }));

        const confidence = results.length === 0 ? 'none' : results.length < 3 ? 'low' : 'medium';

        return {
          success: true,
          data: {
            topic: query,
            sources,
            structuralHints,
            validationCandidates,
            noCallBoundaries: NO_CALL_BOUNDARIES,
            confidence,
          },
        };
      },
    },
  },
};
