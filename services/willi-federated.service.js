/**
 * Willi-Federated knowledge wrapper.
 *
 * Dedicated CET microservice for read-only federated search that runs in
 * parallel across multiple collections optimized for Marktkommunikation
 * (MaKo/EDIFACT) and regulatory (BNetzA/EnWG/EEG) content, backed by the
 * internal Cernion MCP tool `cernion_willi_federated_search`. Kept separate
 * from the generic `knowledge-rag` service so this broader, multi-collection
 * search stays scoped to validation logic, structural hints and explanation
 * context rather than overloading the general RAG contract. Same
 * schema/structure as `services/willi-mako.service.js` (v0.99.1), only the
 * wrapped MCP tool and domain differ.
 *
 * This service is read-only evidence/context: it never makes a binding
 * legal/regulatory decision, and `resolveStructure` never triggers or
 * instructs a MaKo message send or any regulatory process step.
 */

const CernionMCPClient = require('../src/mcp-client');

const OPENAPI_TAG = 'Willi-Federated';
const MCP_TOOL = 'cernion_willi_federated_search';

const NO_CALL_BOUNDARIES = [
  'This response is not legally binding and is not an instruction to send a MaKo message or to file/submit any regulatory process step.',
  'No APERAK, UTILMD, MSCONS or other EDIFACT message is created, validated against BDEW rules, or dispatched from this service.',
  'No BNetzA-Festlegung, EnWG/EEG-Verfahren, Netzentgeltantrag or other regulatory filing is created, validated against authority rules, or dispatched from this service.',
  'No MaKo or regulatory production decision, tariff, billing, settlement, or device-control action is taken.',
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
      source: raw.source || 'willi-federated-service',
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
  name: 'willi-federated',

  actions: {
    /**
     * Read-only federated search across Marktkommunikation/regulatory collections.
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
        summary: 'Willi-Federated Marktkommunikation/regulatory knowledge search (read-only)',
        tags: [OPENAPI_TAG],
        description:
          'Read-only federated search in parallel across Marktkommunikation/EDIFACT and regulatory ' +
          '(BNetzA/EnWG/EEG) collections via the internal MCP tool `cernion_willi_federated_search`. ' +
          'Returns article/context evidence for validation logic, structural hints and explanation context; ' +
          'it does not send, validate or dispatch any MaKo message and does not file, submit or act on any ' +
          'regulatory process step.',
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
                    example: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 5, example: 3 },
                  tag: { type: 'string', example: 'GPKE' },
                  category: { type: 'string', example: 'edifact' },
                  includeContent: { type: 'boolean', default: false, example: false },
                },
              },
              examples: {
                default: {
                  value: {
                    query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
                    limit: 3,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Read-only Willi-Federated search result',
            content: {
              'application/json': {
                example: {
                  success: true,
                  data: {
                    source: 'willi-federated-service',
                    returned: 3,
                    results: [
                      {
                        id: 'wf-1',
                        slug: 'gpke-lieferantenwechsel-fristen',
                        title: 'GPKE: Fristen beim Lieferantenwechsel',
                        score: 32,
                        category: 'edifact',
                        tags: ['GPKE', 'Frist'],
                        excerpt: 'Kurzfassung des Artikels...',
                        url: 'https://stromhaltig.de/wissen/gpke-lieferantenwechsel-fristen',
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
     * Structure-oriented view over a Willi-Federated search, useful as
     * conservative input for MaKo/regulatory validation planning. Never
     * executes, validates, or dispatches a MaKo message or regulatory
     * filing itself.
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
          'Willi-Federated structure-oriented validation-planning view (read-only, advisory)',
        tags: [OPENAPI_TAG],
        description:
          'Calls `willi-federated.search` internally and returns a conservative, structure-oriented view ' +
          '(sources, structural hints, validation candidates, no-call boundaries, confidence) useful for ' +
          'MaKo/regulatory validation planning. Never autonomously executes, validates, or dispatches a MaKo ' +
          'message or regulatory filing.',
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
                    example: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 5, example: 5 },
                  tag: { type: 'string', example: 'GPKE' },
                  category: { type: 'string', example: 'edifact' },
                },
              },
              examples: {
                default: {
                  value: { query: 'Welche Fristen gelten für den Lieferantenwechsel nach GPKE?' },
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
        const searchResult = await ctx.call('willi-federated.search', {
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
            hint: `Willi-Federated article "${item.title}" is categorized as "${item.category}".`,
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
