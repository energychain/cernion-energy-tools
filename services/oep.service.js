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
            const name = typeof entry === 'string' ? entry : (entry.name || '');
            const description = typeof entry === 'object' ? (entry.description || '') : '';

            const nameMatch = name.toLowerCase().includes(term);
            const descMatch = description.toLowerCase().includes(term);

            if (nameMatch || descMatch) {
              matches.push({
                schema,
                table: name,
                description: description || null,
                matchedOn: nameMatch && descMatch ? 'name+description' : nameMatch ? 'name' : 'description',
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
