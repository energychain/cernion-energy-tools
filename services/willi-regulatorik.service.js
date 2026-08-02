/**
 * Willi-Regulatorik regulatory knowledge wrapper.
 *
 * Dedicated CET microservice for read-only regulatory (BNetzA-Festlegungen,
 * EnWG/EEG-Rahmen, Netzentgelt- und Marktregeln, etc.) article/context
 * search, backed by the internal Cernion MCP tool
 * `cernion_willi_regulatorik_search`. Kept separate from the generic
 * `knowledge-rag` service so regulatory knowledge stays scoped to
 * validation logic, structural hints and explanation context rather than
 * overloading the general RAG contract. Same schema/structure as
 * `services/willi-mako.service.js` (v0.99.1), only the wrapped MCP tool
 * and domain differ.
 *
 * This service is read-only evidence/context: it never makes a binding
 * legal/regulatory decision, and `resolveStructure` never triggers or
 * instructs any regulatory filing, submission or process step.
 */

const CernionMCPClient = require('../src/mcp-client');

const OPENAPI_TAG = 'Willi-Regulatorik';
const MCP_TOOL = 'cernion_willi_regulatorik_search';

const NO_CALL_BOUNDARIES = [
  'This response is not legally binding and is not an instruction to file, submit or act on any regulatory process step.',
  'No BNetzA-Festlegung, EnWG/EEG-Verfahren, Netzentgeltantrag or other regulatory filing is created, validated against authority rules, or dispatched from this service.',
  'No regulatory production decision, tariff, billing, settlement, or device-control action is taken.',
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
 * `results[]` (backward-compatibility fallback), mirroring
 * `services/willi-mako.service.js`.
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
      source: raw.source || 'willi-regulatorik-service',
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
  name: 'willi-regulatorik',

  actions: {
    /**
     * Read-only regulatory article/context search.
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
        summary: 'Willi-Regulatorik regulatory knowledge search (read-only)',
        tags: [OPENAPI_TAG],
        description:
          'Read-only search over regulatory (BNetzA/EnWG/EEG) articles via the internal MCP tool ' +
          '`cernion_willi_regulatorik_search`. Returns article/context evidence for validation logic, ' +
          'structural hints and explanation context; it does not file, submit or act on any regulatory process step.',
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
                    example: 'BNetzA Festlegung Netzanschluss Fristen',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 5, example: 3 },
                  tag: { type: 'string', example: 'Festlegung' },
                  category: { type: 'string', example: 'regulatory' },
                  includeContent: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: { query: 'BNetzA Festlegung Netzanschluss Fristen', limit: 3 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Read-only Willi-Regulatorik search result',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    source: 'willi-regulatorik-service',
                    returned: 3,
                    results: [
                      {
                        id: 'wr-1',
                        slug: 'bk6-festlegung-netzanschluss-fristen',
                        title: 'BK6-Festlegung: Fristen für Netzanschlussprüfung',
                        score: 32,
                        category: 'regulatory',
                        tags: ['BNetzA', 'Festlegung'],
                        excerpt: 'Kurzfassung des Artikels...',
                        url: 'https://stromhaltig.de/wissen/bk6-festlegung-netzanschluss-fristen',
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
     * Structure-oriented view over a Willi-Regulatorik search, useful as
     * conservative input for regulatory validation planning. Never executes,
     * validates, or dispatches any regulatory filing itself.
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
        summary:
          'Willi-Regulatorik structure-oriented validation-planning view (read-only, advisory)',
        tags: [OPENAPI_TAG],
        description:
          'Calls `willi-regulatorik.search` internally and returns a conservative, structure-oriented view ' +
          '(sources, structural hints, validation candidates, no-call boundaries, confidence) useful for ' +
          'regulatory validation planning. Never autonomously executes, validates, or dispatches any regulatory filing.',
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
                    example: 'BNetzA Festlegung Netzanschluss Fristen',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 5, example: 5 },
                  tag: { type: 'string', example: 'Festlegung' },
                  category: { type: 'string', example: 'regulatory' },
                },
              },
              examples: {
                default: {
                  value: { query: 'BNetzA Festlegung Netzanschluss Fristen' },
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
        const searchResult = await ctx.call('willi-regulatorik.search', {
          query,
          limit,
          tag,
          category,
        });

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
            hint: `Willi-Regulatorik article "${item.title}" is categorized as "${item.category}".`,
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
