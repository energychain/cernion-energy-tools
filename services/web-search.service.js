/**
 * Web Search Service
 *
 * Provides web search capabilities via the corrently.cloud SearXNG instance.
 * Used internally by the utility-report service to enrich reports with
 * current news and context about grid operators.
 */

const axios = require('axios');

const SEARCH_BASE_URL = 'https://search.corrently.cloud/search';

module.exports = {
  name: 'web-search',

  settings: {
    defaultTimeout: 15000,
  },

  actions: {
    /**
     * Perform a web search
     * Tool: corrently.cloud SearXNG
     */
    query: {
      rest: 'POST /query',
      params: {
        query: { type: 'string', min: 1 },
        language: { type: 'string', optional: true, default: 'de' },
        numResults: { type: 'number', optional: true, default: 5, min: 1, max: 20, convert: true },
      },
      openapi: {
        summary: 'Web search via corrently.cloud (SearXNG)',
        tags: ['Web Search'],
        description:
          'Perform a web search using the corrently.cloud privacy-respecting search engine. ' +
          'Used internally to enrich utility reports with current news and context.',
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
                    description: 'Search query string',
                    example: 'Stadtwerke Heidelberg Netzgebiet 2026',
                  },
                  language: {
                    type: 'string',
                    description: 'Language for results',
                    default: 'de',
                    example: 'de',
                  },
                  numResults: {
                    type: 'number',
                    description: 'Maximum number of results to return',
                    default: 5,
                    minimum: 1,
                    maximum: 20,
                  },
                },
              },
              examples: {
                utilityNews: {
                  summary: 'News about a utility operator',
                  value: { query: 'STROMDAO Netze GmbH Netzausbau 2026', language: 'de', numResults: 5 },
                },
                ewkBenchmark: {
                  summary: 'EWK benchmark context',
                  value: { query: 'BNetzA EWK Anschlussdauer Vergleich 2024', numResults: 3 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        query: { type: 'string' },
                        language: { type: 'string' },
                        total: { type: 'number' },
                        results: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              title: { type: 'string' },
                              url: { type: 'string' },
                              snippet: { type: 'string' },
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
        },
      },

      async handler(ctx) {
        const { query, language = 'de', numResults = 5 } = ctx.params;

        try {
          const response = await axios.get(SEARCH_BASE_URL, {
            params: {
              q: query,
              format: 'json',
              language,
              pageno: 1,
            },
            timeout: this.settings.defaultTimeout,
          });

          const raw = response.data?.results || [];
          const results = raw.slice(0, numResults).map((r) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || r.snippet || '',
          }));

          return {
            success: true,
            data: { query, language, total: results.length, results },
          };
        } catch (error) {
          this.logger.warn(`[WebSearch] Search failed for "${query}": ${error.message}`);
          return {
            success: false,
            data: { query, language, total: 0, results: [] },
            error: error.message,
          };
        }
      },
    },
  },
};
