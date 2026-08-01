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

const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

const { MoleculerClientError } = require('moleculer').Errors;

/** Namespace: lowercase letter start, alphanumeric + underscores, optionally
 * followed by colon-separated segments (alphanumeric + hyphens) for tenant isolation.
 * Examples: 'cya_profiles', 'tenant:stadtwerk-a:cya_profiles' */
const NS_PATTERN = /^[a-z][a-z0-9_]*(:[a-z0-9_-]+)*$/;

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
  const { _id, _rev, ns, ...rest } = doc;
  // Use the stored `ns` field to determine the namespace boundary, so that
  // multi-segment namespaces like 'tenant:stadtwerk-a:cya_profiles' are
  // returned correctly. The key starts immediately after "namespace:".
  return {
    namespace: ns,
    key: _id.slice(ns.length + 1),
    ...rest,
  };
}

function isConflictError(err) {
  return err?.status === 409 || err?.code === 409 || err?.type === 'OBJECT_OCC_CONFLICT';
}

module.exports = {
  name: 'object-store',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'OBJECT_STORE_DB_PATH',
      defaultDbPath: './data/object-store',
      indexes: [['ns'], ['ns', 'updatedAt']],
    }),
  ],

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
        key: { type: 'string', pattern: KEY_PATTERN },
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
            description:
              'Logical namespace (lowercase letter start, underscores allowed, 1–64 chars).',
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
                    namespace: { type: 'string', example: 'znp_projects' },
                    key: { type: 'string', example: 'a1b2c3d4' },
                    payload: { type: 'object', example: { name: 'My Project' } },
                    _rev: {
                      type: 'string',
                      example: '2-4f8a63d0f9c94d97a0b5b6f8cdef1234',
                      description: 'Current PouchDB document revision for CAS updates.',
                    },
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
        const { namespace, key } = ctx.params;
        const id = docId(namespace, key);
        try {
          const doc = await this.db.get(id);
          return {
            ...toPublic(doc),
            _rev: doc._rev,
          };
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
        key: { type: 'string', pattern: KEY_PATTERN },
        payload: { type: 'object' },
        _rev: { type: 'string', optional: true, nullable: true },
      },
      openapi: {
        summary: 'Create or update a document in the Object Store (upsert)',
        tags: ['Object Store'],
        description:
          'Upserts a document identified by namespace + key. ' +
          'On update the payload is fully replaced and updatedAt is refreshed; createdAt is preserved. ' +
          'Optional CAS: callers may pass _rev. On revision mismatch, the action returns HTTP 409 OBJECT_OCC_CONFLICT.',
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
                  _rev: {
                    type: 'string',
                    nullable: true,
                    description:
                      'Optional PouchDB revision for CAS updates. Use null for create-if-not-exists CAS semantics.',
                    example: '2-4f8a63d0f9c94d97a0b5b6f8cdef1234',
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
                    key: { type: 'string', example: 'a1b2c3d4' },
                    payload: { type: 'object', example: { name: 'My Project' } },
                    _rev: {
                      type: 'string',
                      example: '2-4f8a63d0f9c94d97a0b5b6f8cdef1234',
                      description: 'Current PouchDB document revision after upsert.',
                    },
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
        const hasRevToken = Object.prototype.hasOwnProperty.call(ctx.params, '_rev');
        const requestedRev = hasRevToken ? ctx.params._rev : undefined;
        const normalizedRequestedRev =
          typeof requestedRev === 'string' ? requestedRev.trim() : requestedRev;
        const hasCasRequestedRev =
          hasRevToken &&
          normalizedRequestedRev !== null &&
          normalizedRequestedRev !== undefined &&
          normalizedRequestedRev !== '';
        const id = docId(namespace, key);
        const now = new Date().toISOString();

        let rev;
        let createdAt = now;
        try {
          const existing = await this.db.get(id);
          if (hasCasRequestedRev && normalizedRequestedRev !== existing._rev) {
            throw new MoleculerClientError(
              `Revision conflict for ${namespace}/${key}`,
              409,
              'OBJECT_OCC_CONFLICT',
              {
                namespace,
                key,
                expectedRev: normalizedRequestedRev,
                currentRev: existing._rev,
              }
            );
          }
          rev = existing._rev;
          createdAt = existing.createdAt || now;
        } catch (err) {
          if (err?.status === 404) {
            if (hasCasRequestedRev) {
              throw new MoleculerClientError(
                `Revision conflict for ${namespace}/${key}: document does not exist`,
                409,
                'OBJECT_OCC_CONFLICT',
                {
                  namespace,
                  key,
                  expectedRev: normalizedRequestedRev,
                  currentRev: null,
                }
              );
            }
          } else if (isConflictError(err) || err?.type === 'OBJECT_OCC_CONFLICT') {
            throw err;
          } else {
            throw err;
          }
        }

        const doc = {
          _id: id,
          ...(rev ? { _rev: rev } : {}),
          ns: namespace,
          payload,
          createdAt,
          updatedAt: now,
        };

        try {
          const putResult = await this.db.put(doc);
          const storedRev = putResult?.rev || doc._rev || rev || null;
          doc._rev = storedRev;

          this.logger.info(`[object-store] put ${namespace}/${key}`);
          return {
            ...toPublic(doc),
            _rev: storedRev,
          };
        } catch (err) {
          if (err?.status === 409) {
            throw new MoleculerClientError(
              `Revision conflict for ${namespace}/${key}`,
              409,
              'OBJECT_OCC_CONFLICT',
              {
                namespace,
                key,
                expectedRev: hasCasRequestedRev ? normalizedRequestedRev : rev || null,
                currentRev: rev || null,
              }
            );
          }
          throw err;
        }
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
        key: { type: 'string', pattern: KEY_PATTERN },
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
                    success: { type: 'boolean', example: true },
                    namespace: { type: 'string', example: 'znp_projects' },
                    key: { type: 'string', example: 'a1b2c3d4' },
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
        selector: { type: 'object', default: {}, optional: true },
        limit: {
          type: 'number',
          integer: true,
          default: 50,
          max: 1000,
          min: 1,
          convert: true,
          optional: true,
        },
        skip: { type: 'number', integer: true, default: 0, min: 0, convert: true, optional: true },
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
                    description:
                      'Mango selector for payload fields (namespace guard injected automatically).',
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
                          key: { type: 'string', example: 'a1b2c3d4' },
                          payload: { type: 'object' },
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
