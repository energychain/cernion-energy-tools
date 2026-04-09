'use strict';

/**
 * object-store.service.js
 *
 * Generic PouchDB-backed Object Store microservice.
 * Provides namespaced document CRUD and Mango query support for frontend
 * clients (ZNP Workspaces, User Settings, etc.) to persist arbitrary JSON
 * without requiring backend schema changes.
 *
 * Storage: local PouchDB (KRITIS-compliant — no external dependencies).
 * Documents are keyed as `${namespace}:${key}` for namespace isolation
 * and fast single-document retrieval via PouchDB's B-tree.
 *
 * Namespace isolation in queries is enforced via an injected `_ns` field
 * in every Mango selector — callers cannot query across namespaces.
 *
 * @version 0.20.5
 */

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;

const DB_PATH = process.env.OBJECT_STORE_DB_PATH || './data/object-store';

/** Namespace: lowercase letter start, alphanumeric + underscores, 1–64 chars. */
const NS_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Key: any printable non-whitespace string, 1–256 chars. */
const KEY_PATTERN = /^[^\s]{1,256}$/;

/**
 * Build the PouchDB _id from namespace + key.
 * @param {string} ns
 * @param {string} key
 * @returns {string}
 */
function docId(ns, key) {
  return `${ns}:${key}`;
}

/**
 * Strip PouchDB internals and reconstruct namespace/key from the stored _id.
 * Handles compound keys that themselves contain colons (e.g. "project:sub:123").
 *
 * @param {object} doc  Raw PouchDB document
 * @returns {object}    Clean public document
 */
function toPublic(doc) {
  // eslint-disable-next-line no-unused-vars
  const { _id, _rev, ns, ...rest } = doc;
  const colonIdx = _id.indexOf(':');
  return {
    namespace: _id.slice(0, colonIdx),
    key:       _id.slice(colonIdx + 1),
    ...rest,
  };
}

module.exports = {
  name: 'object-store',

  settings: {
    dbPath: DB_PATH,
  },

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    // Index on ns field for efficient namespace-scoped Mango queries.
    await this.db.createIndex({ index: { fields: ['ns'] } });
    await this.db.createIndex({ index: { fields: ['ns', 'updatedAt'] } });
    this.logger.info(`[object-store] DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  // ─── Actions ────────────────────────────────────────────────────────────────

  actions: {

    /**
     * get — Retrieve a single document by namespace + key.
     *
     * GET /api/objects/:namespace/:key
     */
    get: {
      rest: 'GET /:namespace/:key',
      params: {
        namespace: { type: 'string', pattern: NS_PATTERN },
        key:       { type: 'string', pattern: KEY_PATTERN },
      },
      openapi: {
        summary: 'Get a document from the Object Store',
        tags: ['Object Store'],
        description:
          'Retrieves a single document by namespace and key. ' +
          'Returns the stored JSON payload together with namespace, key, createdAt, and updatedAt.',
        parameters: [
          {
            name: 'namespace',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'znp_projects' },
            description: 'Logical namespace (lowercase letter start, underscores allowed, 1–64 chars).',
          },
          {
            name: 'key',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4' },
            description: 'Unique document key within the namespace (1–256 non-whitespace chars).',
          },
        ],
        responses: {
          200: {
            description: 'Document found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    namespace:  { type: 'string', example: 'znp_projects' },
                    key:        { type: 'string', example: 'a1b2c3d4' },
                    payload:    { type: 'object', example: { name: 'My Project' } },
                    createdAt:  { type: 'string', example: '2026-04-06T12:00:00.000Z' },
                    updatedAt:  { type: 'string', example: '2026-04-06T12:00:00.000Z' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { namespace, key } = ctx.params;
        const id = docId(namespace, key);
        try {
          const doc = await this.db.get(id);
          return toPublic(doc);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              `Document not found: ${namespace}/${key}`,
              404,
              'OBJECT_NOT_FOUND',
              { namespace, key }
            );
          }
          throw err;
        }
      },
    },

    /**
     * put — Create or update a document (upsert).
     *
     * PUT /api/objects/:namespace/:key   body: { payload: { ... } }
     */
    put: {
      rest: 'PUT /:namespace/:key',
      params: {
        namespace: { type: 'string', pattern: NS_PATTERN },
        key:       { type: 'string', pattern: KEY_PATTERN },
        payload:   { type: 'object' },
      },
      openapi: {
        summary: 'Create or update a document in the Object Store (upsert)',
        tags: ['Object Store'],
        description:
          'Upserts a document identified by namespace + key. ' +
          'On update the payload is fully replaced and updatedAt is refreshed; createdAt is preserved. ' +
          'PouchDB revision (_rev) handling is fully transparent — callers never see or send _rev.',
        parameters: [
          {
            name: 'namespace',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'znp_projects' },
          },
          {
            name: 'key',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['payload'],
                properties: {
                  payload: {
                    type: 'object',
                    description: 'Arbitrary JSON payload to store.',
                    example: { name: 'My Project', status: 'active' },
                  },
                },
              },
              examples: {
                default: {
                  value: { payload: { name: 'My Project', status: 'active' } },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Document created or updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    namespace: { type: 'string', example: 'znp_projects' },
                    key:       { type: 'string', example: 'a1b2c3d4' },
                    payload:   { type: 'object', example: { name: 'My Project' } },
                    createdAt: { type: 'string', example: '2026-04-06T12:00:00.000Z' },
                    updatedAt: { type: 'string', example: '2026-04-06T12:00:00.000Z' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { namespace, key, payload } = ctx.params;
        const id  = docId(namespace, key);
        const now = new Date().toISOString();

        let rev;
        let createdAt = now;
        try {
          const existing = await this.db.get(id);
          rev       = existing._rev;
          createdAt = existing.createdAt || now;
        } catch (_) {
          // New document — no _rev needed.
        }

        const doc = {
          _id: id,
          ...(rev ? { _rev: rev } : {}),
          ns:        namespace,
          payload,
          createdAt,
          updatedAt: now,
        };

        await this.db.put(doc);
        this.logger.info(`[object-store] put ${namespace}/${key}`);
        return toPublic(doc);
      },
    },

    /**
     * delete — Remove a document by namespace + key.
     *
     * DELETE /api/objects/:namespace/:key
     */
    delete: {
      rest: 'DELETE /:namespace/:key',
      params: {
        namespace: { type: 'string', pattern: NS_PATTERN },
        key:       { type: 'string', pattern: KEY_PATTERN },
      },
      openapi: {
        summary: 'Delete a document from the Object Store',
        tags: ['Object Store'],
        description:
          'Permanently removes a document. Returns 404 OBJECT_NOT_FOUND if the document does not exist.',
        parameters: [
          {
            name: 'namespace',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'znp_projects' },
          },
          {
            name: 'key',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4' },
          },
        ],
        responses: {
          200: {
            description: 'Document deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success:   { type: 'boolean', example: true },
                    namespace: { type: 'string',  example: 'znp_projects' },
                    key:       { type: 'string',  example: 'a1b2c3d4' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { namespace, key } = ctx.params;
        const id = docId(namespace, key);

        let doc;
        try {
          doc = await this.db.get(id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError(
              `Document not found: ${namespace}/${key}`,
              404,
              'OBJECT_NOT_FOUND',
              { namespace, key }
            );
          }
          throw err;
        }

        await this.db.remove(doc);
        this.logger.info(`[object-store] delete ${namespace}/${key}`);
        return { success: true, namespace, key };
      },
    },

    /**
     * query — Search for documents within a namespace using Mango selector syntax.
     *
     * POST /api/objects/:namespace/query   body: { selector?, limit?, skip? }
     */
    query: {
      rest: 'POST /:namespace/query',
      params: {
        namespace: { type: 'string', pattern: NS_PATTERN },
        selector:  { type: 'object', default: {}, optional: true },
        limit:     { type: 'number', integer: true, default: 50, max: 1000, min: 1, convert: true, optional: true },
        skip:      { type: 'number', integer: true, default: 0, min: 0, convert: true, optional: true },
      },
      openapi: {
        summary: 'Query documents in a namespace (Mango selector)',
        tags: ['Object Store'],
        description:
          'Searches for documents within a namespace using PouchDB Mango query syntax. ' +
          'The `ns` namespace guard is injected automatically into every selector — ' +
          'callers cannot escape their namespace. ' +
          'Use dotted paths to filter on payload fields: `{ "payload.status": "active" }`.',
        parameters: [
          {
            name: 'namespace',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'znp_projects' },
            description: 'Namespace to search within.',
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  selector: {
                    type: 'object',
                    example: { 'payload.status': 'active' },
                    description: 'Mango selector for payload fields (namespace guard injected automatically).',
                  },
                  limit: {
                    type: 'integer',
                    default: 50,
                    maximum: 1000,
                    example: 50,
                    description: 'Maximum results to return (1–1000).',
                  },
                  skip: {
                    type: 'integer',
                    default: 0,
                    example: 0,
                    description: 'Number of documents to skip (for pagination).',
                  },
                },
              },
              examples: {
                default: {
                  value: { selector: { 'payload.status': 'active' }, limit: 10 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Query results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    docs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          namespace: { type: 'string', example: 'znp_projects' },
                          key:       { type: 'string', example: 'a1b2c3d4' },
                          payload:   { type: 'object' },
                          createdAt: { type: 'string', example: '2026-04-06T12:00:00.000Z' },
                          updatedAt: { type: 'string', example: '2026-04-06T12:00:00.000Z' },
                        },
                      },
                    },
                    totalDocs: { type: 'integer', example: 3 },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { namespace, selector = {}, limit = 50, skip = 0 } = ctx.params;

        // Inject namespace guard — overwrites any ns the caller may have supplied.
        const scopedSelector = {
          ...selector,
          ns: namespace,
        };

        const result = await this.db.find({
          selector: scopedSelector,
          limit,
          skip,
        });

        const docs = result.docs.map(toPublic);
        return { docs, totalDocs: docs.length };
      },
    },

  },
};
