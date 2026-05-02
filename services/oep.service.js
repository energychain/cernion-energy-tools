'use strict';

/**
 * OEP Service — Open Energy Platform read-only connector (AP2, v0.12.0)
 *
 * Provides structured access to the Open Energy Platform REST API v0.
 * All endpoints are read-only; no OEP authentication token is required for
 * public data tables.
 *
 * OEP API docs: https://openenergyplatform.org/api/v0/swagger/
 * OEP website:  https://openenergyplatform.org
 *
 * TTL-cache strategy:
 *   - Schema list:  24 h (rarely changes)
 *   - Table list:   24 h per schema
 *   - Table meta:   24 h per table
 *   Raw row queries are NOT cached (potentially large, ephemeral use).
 *
 * KRITIS note: All HTTP calls go to the public OEP instance.
 *   OEP_API_BASE_URL can be overridden in .env for an internal mirror.
 */

const axios = require('axios');
const { MoleculerClientError } = require('moleculer').Errors;
const { CERNION_RELEVANT_OEP_TABLES } = require('../src/oep-tables');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const OEP_BASE = process.env.OEP_API_BASE_URL || 'https://openenergyplatform.org/api/v0';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'oep',

  settings: {
    defaultRowLimit: 100,
    maxRowLimit: 1000,
  },

  created() {
    // Instance-level TTL cache — cleared on service restart.
    // Keyed by resource path; value: { data, expiresAt }
    this._cache = new Map();
  },

  methods: {
    /**
     * Retrieve a value from the instance cache; returns null if absent or expired.
     * @param {string} key
     * @returns {*|null}
     */
    _cacheGet(key) {
      const entry = this._cache.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        this._cache.delete(key);
        return null;
      }
      return entry.data;
    },

    /**
     * Store a value in the instance cache with the configured TTL.
     * @param {string} key
     * @param {*} data
     */
    _cacheSet(key, data) {
      this._cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    },

    /**
     * Perform a GET request to the OEP REST API.
     * @param {string} urlPath - path relative to OEP_BASE
     * @param {object} [params] - query parameters
     * @returns {Promise<*>}
     */
    async _oepGet(urlPath, params = {}) {
      const url = `${OEP_BASE}${urlPath}`;
      const response = await axios.get(url, {
        params,
        timeout: 20000,
        headers: { Accept: 'application/json' },
      });
      return response.data;
    },
  },

  actions: {
    // ------------------------------------------------------------------
    // listSchemas — get available OEP database schemas
    // ------------------------------------------------------------------
    listSchemas: {
      rest: 'GET /schemas',
      params: {},
      openapi: {
        summary: 'List OEP database schemas',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Returns the list of available database schemas on the Open Energy Platform. ' +
          'Schemas group related research datasets (e.g. model_draft, scenario, supply). ' +
          'Results are cached for 24 hours.',
      },
      async handler() {
        const cacheKey = 'schemas';
        const cached = this._cacheGet(cacheKey);
        if (cached) return { schemas: cached, cached: true };

        const data = await this._oepGet('/schema/');
        const schemas = Array.isArray(data) ? data : [];
        this._cacheSet(cacheKey, schemas);
        return { schemas, cached: false };
      },
    },

    // ------------------------------------------------------------------
    // listTables — list tables in a schema
    // ------------------------------------------------------------------
    listTables: {
      rest: 'GET /schemas/:schema/tables',
      params: {
        schema: { type: 'string' },
      },
      openapi: {
        summary: 'List tables within an OEP schema',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Returns all tables available in the given OEP schema. ' +
          'Includes table name and description where provided. ' +
          'Results are cached for 24 hours.',
        parameters: [
          {
            name: 'schema',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'model_draft' },
          },
        ],
      },
      async handler(ctx) {
        const { schema } = ctx.params;
        const cacheKey = `tables:${schema}`;
        const cached = this._cacheGet(cacheKey);
        if (cached) return { schema, tables: cached, cached: true };

        let data;
        try {
          data = await this._oepGet(`/schema/${schema}/tables/`);
        } catch (err) {
          if (err.response?.status === 404) {
            throw new MoleculerClientError(`Schema '${schema}' not found on OEP`, 404, 'NOT_FOUND');
          }
          throw err;
        }

        const tables = Array.isArray(data) ? data : [];
        this._cacheSet(cacheKey, tables);
        return { schema, tables, cached: false };
      },
    },

    // ------------------------------------------------------------------
    // getTableMeta — retrieve column metadata for a specific table
    // ------------------------------------------------------------------
    getTableMeta: {
      rest: 'GET /tables/:schema/:table/meta',
      params: {
        schema: { type: 'string' },
        table: { type: 'string' },
      },
      openapi: {
        summary: 'Get OEP table metadata (columns, types, OEO annotations)',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Returns the column schema (name, data type, description) for an OEP table, ' +
          'including OEMetadata v2.0 annotations where available. ' +
          'Results are cached for 24 hours.',
        parameters: [
          {
            name: 'schema',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'model_draft' },
          },
          {
            name: 'table',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'oed_scenario_bundle' },
          },
        ],
      },
      async handler(ctx) {
        const { schema, table } = ctx.params;
        const cacheKey = `meta:${schema}:${table}`;
        const cached = this._cacheGet(cacheKey);
        if (cached) return { schema, table, meta: cached, cached: true };

        let data;
        try {
          data = await this._oepGet(`/schema/${schema}/tables/${table}/meta/`);
        } catch (err) {
          if (err.response?.status === 404) {
            throw new MoleculerClientError(
              `Table '${schema}.${table}' not found on OEP`,
              404,
              'NOT_FOUND'
            );
          }
          throw err;
        }

        this._cacheSet(cacheKey, data);
        return { schema, table, meta: data, cached: false };
      },
    },

    // ------------------------------------------------------------------
    // query — fetch rows from an OEP table
    // ------------------------------------------------------------------
    query: {
      rest: 'GET /tables/:schema/:table/rows',
      params: {
        schema: { type: 'string' },
        table: { type: 'string' },
        limit: {
          type: 'number',
          optional: true,
          convert: true,
          default: 100,
          min: 1,
          max: 1000,
        },
        offset: { type: 'number', optional: true, convert: true, default: 0, min: 0 },
        where: { type: 'string', optional: true },
        orderby: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Query rows from an OEP table',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Returns up to 1000 rows from the specified OEP table. ' +
          'Supports optional server-side filtering via the `where` parameter ' +
          '(OEP filter syntax, e.g. `year=2030`) and result ordering. ' +
          'Row data is NOT cached \u2014 each call fetches live from OEP.',
        parameters: [
          {
            name: 'schema',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'model_draft' },
          },
          {
            name: 'table',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'oed_scenario_bundle' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, minimum: 1, maximum: 1000 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 0, minimum: 0 },
          },
          {
            name: 'where',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'year=2030' },
            description: 'OEP server-side filter expression (passed directly to the OEP API).',
          },
          {
            name: 'orderby',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'year' },
          },
        ],
      },
      async handler(ctx) {
        const { schema, table, limit, offset, where, orderby } = ctx.params;

        const oepParams = { limit, offset };
        if (where) oepParams.where = where;
        if (orderby) oepParams.orderby = orderby;

        let data;
        try {
          data = await this._oepGet(`/schema/${schema}/tables/${table}/rows/`, oepParams);
        } catch (err) {
          if (err.response?.status === 404) {
            throw new MoleculerClientError(
              `Table '${schema}.${table}' not found on OEP`,
              404,
              'NOT_FOUND'
            );
          }
          throw err;
        }

        const rows = Array.isArray(data) ? data : [];
        return { schema, table, rowCount: rows.length, limit, offset, rows };
      },
    },

    // ------------------------------------------------------------------
    // energyTables — vorkonfigurierte Cernion-relevante OEP-Tabellen (TRL6)
    // ------------------------------------------------------------------
    energyTables: {
      rest: 'GET /energy-tables',
      params: {},
      openapi: {
        summary: 'List pre-configured Cernion-relevant OEP tables',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Returns the curated list of OEP tables that are directly relevant for the Cernion/VNB ' +
          'context — EU AI Act Art. 12 data provenance, MaStR comparison, residual load validation, ' +
          'and energy scenario planning. No free-text search needed; tables are immediately usable. ' +
          'TRL5→6: demonstrated in relevant energy domain environment.',
        'x-oeo-class': 'oeo:DataCatalog',
        responses: {
          200: {
            description: 'List of pre-configured OEP tables with Cernion use cases',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tables: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          schema: { type: 'string', example: 'supply' },
                          table: { type: 'string', example: 'ego_dp_res_powerplant' },
                          description: { type: 'string' },
                          cernionUseCase: { type: 'string' },
                          oeoClass: { type: 'string', example: 'oeo:PowerPlant' },
                        },
                      },
                    },
                    count: { type: 'integer', example: 5 },
                  },
                },
              },
            },
          },
        },
      },
      async handler() {
        return {
          tables: CERNION_RELEVANT_OEP_TABLES,
          count: CERNION_RELEVANT_OEP_TABLES.length,
        };
      },
    },

    // ------------------------------------------------------------------
    // compareWithMastr — OEP ↔ MaStR Kapazitätsvergleich
    // ------------------------------------------------------------------
    compareWithMastr: {
      rest: 'POST /compare-mastr',
      params: {
        gridOperatorId: { type: 'string' },
        oepSchema: { type: 'string', optional: true, default: 'supply' },
        oepTable: { type: 'string', optional: true, default: 'ego_dp_res_powerplant' },
        // TODO: use installationType: 'all' once energy-market.installations Enum erweitert
        installationType: {
          type: 'enum',
          values: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
          optional: true,
          default: 'solar',
        },
        limit: { type: 'number', optional: true, default: 100, max: 1000, convert: true },
      },
      openapi: {
        summary: 'Compare OEP research data with MaStR installations for a grid operator',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Loads OEP table rows and MaStR installations in parallel (Promise.allSettled) and ' +
          'returns a side-by-side capacity comparison. Graceful when OEP is offline — ' +
          'oep.available will be false but the MaStR data is still returned. ' +
          'Semantic linking via oeo:PowerPlant is planned via src/oeo-exporter-stub.js.',
        'x-oeo-class': 'oeo:PowerPlant',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['gridOperatorId'],
                properties: {
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR grid operator ID (SNB…)',
                    example: 'SNB924510006275',
                  },
                  oepSchema: {
                    type: 'string',
                    default: 'supply',
                    example: 'supply',
                  },
                  oepTable: {
                    type: 'string',
                    default: 'ego_dp_res_powerplant',
                    example: 'ego_dp_res_powerplant',
                  },
                  installationType: {
                    type: 'string',
                    default: 'solar',
                    enum: ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion'],
                    description:
                      'Installation type for MaStR query. TODO: support "all" once energy-market enum is extended.',
                  },
                  limit: {
                    type: 'integer',
                    default: 100,
                    maximum: 1000,
                  },
                },
              },
              examples: {
                twlNetze: {
                  summary: 'Compare OEP renewable plants with TWL Netze MaStR data',
                  value: {
                    gridOperatorId: 'SNB924510006275',
                    oepSchema: 'supply',
                    oepTable: 'ego_dp_res_powerplant',
                    installationType: 'solar',
                    limit: 100,
                  },
                },
                windComparison: {
                  summary: 'Compare wind installations for a grid operator',
                  value: {
                    gridOperatorId: 'SNB900599182315',
                    installationType: 'wind',
                    limit: 200,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'OEP and MaStR counts with availability flags',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    oep: {
                      type: 'object',
                      properties: {
                        available: { type: 'boolean' },
                        count: { type: 'integer' },
                        source: { type: 'string' },
                      },
                    },
                    mastr: {
                      type: 'object',
                      properties: {
                        available: { type: 'boolean' },
                        count: { type: 'integer' },
                        source: { type: 'string' },
                      },
                    },
                    delta: { type: 'object', nullable: true },
                    oeoMappingNote: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { gridOperatorId, oepSchema, oepTable, installationType, limit } = ctx.params;

        const [oepData, mastrData] = await Promise.allSettled([
          ctx.call('oep.query', {
            schema: oepSchema,
            table: oepTable,
            limit,
          }),
          ctx.call('energy-market.installations', {
            gridOperatorId,
            // TODO: use installationType: 'all' once energy-market.installations Enum erweitert
            installationType: installationType || 'solar',
            limit,
          }),
        ]);

        return {
          oep: {
            available: oepData.status === 'fulfilled',
            count: oepData.value?.rows?.length ?? 0,
            source: `${oepSchema}.${oepTable}`,
          },
          mastr: {
            available: mastrData.status === 'fulfilled',
            count: mastrData.value?.data?.installations?.length ?? 0,
            source: 'MaStR (cernion_installations_local)',
          },
          delta: null, // TODO: semantische Verknüpfung via OEO-Klassen
          oeoMappingNote:
            'Verknüpfung über oeo:PowerPlant — ' +
            'Implementierung via src/oeo-exporter-stub.js erwartet',
        };
      },
    },

    // ------------------------------------------------------------------
    // search — full-text search over OEP table names and descriptions
    // ------------------------------------------------------------------
    search: {
      rest: 'GET /search',
      params: {
        q: { type: 'string', min: 2 },
        schema: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 20, min: 1, max: 100 },
      },
      openapi: {
        summary: 'Search OEP tables by name or description',
        tags: ['OEP (Open Energy Platform)'],
        description:
          'Case-insensitive substring search across all OEP table names and descriptions. ' +
          'Optionally scoped to a specific schema. Uses the cached table list (24 h TTL) \u2014 ' +
          'no per-search API call is made to OEP. ' +
          'Useful for discovering scenario datasets, e.g. "NEP", "Kohleausstieg", "photovoltaik".',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'NEP 2023' },
            description: 'Search term (minimum 2 characters, case-insensitive).',
          },
          {
            name: 'schema',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'model_draft' },
            description: 'Restrict search to this OEP schema (optional).',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
        ],
      },
      async handler(ctx) {
        const { q, schema: schemaFilter, limit } = ctx.params;
        const term = q.toLowerCase();

        // Determine which schemas to search
        let schemasToSearch;
        if (schemaFilter) {
          schemasToSearch = [schemaFilter];
        } else {
          // Fetch schema list (cached)
          const schemaResult = await ctx.call('oep.listSchemas');
          schemasToSearch = schemaResult.schemas;
        }

        const matches = [];

        for (const schema of schemasToSearch) {
          if (matches.length >= limit) break;

          const tableResult = await ctx.call('oep.listTables', { schema });
          const tables = tableResult.tables || [];

          for (const entry of tables) {
            if (matches.length >= limit) break;

            // OEP returns either a string name or an object with name/description
            const name = typeof entry === 'string' ? entry : entry.name || '';
            const description = typeof entry === 'object' ? entry.description || '' : '';

            const nameMatch = name.toLowerCase().includes(term);
            const descMatch = description.toLowerCase().includes(term);

            if (nameMatch || descMatch) {
              matches.push({
                schema,
                table: name,
                description: description || null,
                matchedOn:
                  nameMatch && descMatch ? 'name+description' : nameMatch ? 'name' : 'description',
              });
            }
          }
        }

        return {
          query: q,
          schemaFilter: schemaFilter || null,
          total: matches.length,
          results: matches,
        };
      },
    },
  },
};
