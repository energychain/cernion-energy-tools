'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const OPENAPI_TAG = 'HITL';
const DOC_PREFIX = 'hi:';
const DEFAULT_DUE_DAYS = 7;

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'pending';
  return value;
}

module.exports = {
  name: 'hitl',

  settings: {
    dbPath: process.env.HITL_DB_PATH || './data/hitl',
    expiryCheckIntervalMs: Number(process.env.HITL_EXPIRY_CHECK_INTERVAL_MS || 60_000),
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
    this.expiryTimer = null;
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['kind'] } });
    this.logger.info(`HITL DB initialized at ${this.settings.dbPath}`);

    this.expiryTimer = setInterval(() => {
      this.expireDueItems().catch((err) =>
        this.logger.warn(`[hitl] expireDueItems failed: ${err.message}`)
      );
    }, this.settings.expiryCheckIntervalMs);
  },

  async stopped() {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    create: {
      rest: 'POST /items',
      params: {
        kind: { type: 'string', min: 2 },
        payload: { type: 'object', optional: true, default: {} },
        originService: { type: 'string', optional: true },
        originAction: { type: 'string', optional: true },
        severity: { type: 'string', optional: true, default: 'warning' },
        requiredScope: { type: 'string', optional: true, default: 'full-access' },
        dueAt: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Create HITL item',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind'],
                properties: {
                  kind: { type: 'string', example: 'cya-consensus-failed' },
                  payload: { type: 'object', example: { sessionId: 'S-123' } },
                  originService: { type: 'string', example: 'cya' },
                  originAction: { type: 'string', example: 'refine' },
                  severity: { type: 'string', example: 'warning' },
                  requiredScope: { type: 'string', example: 'full-access' },
                  dueAt: {
                    type: 'string',
                    format: 'date-time',
                    example: '2026-05-12T12:00:00.000Z',
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    kind: 'cya-consensus-failed',
                    payload: { sessionId: 'S-123' },
                    originService: 'cya',
                    originAction: 'refine',
                    severity: 'warning',
                    requiredScope: 'full-access',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const id = crypto.randomUUID();
        const createdAt = nowIso();
        const dueAt =
          ctx.params.dueAt ||
          new Date(Date.now() + DEFAULT_DUE_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const item = {
          _id: `${DOC_PREFIX}${id}`,
          id,
          type: 'hitl-item',
          tenantId,
          status: 'pending',
          kind: ctx.params.kind,
          severity: ctx.params.severity,
          requiredScope: ctx.params.requiredScope,
          payload: ctx.params.payload || {},
          originService: ctx.params.originService || null,
          originAction: ctx.params.originAction || null,
          dueAt,
          createdAt,
          updatedAt: createdAt,
          resolvedAt: null,
          agent_interventions: [
            {
              at: createdAt,
              action: 'created',
              actor: 'system',
              comment: 'HITL item created',
            },
          ],
        };

        await this.db.put(item);

        this.broker.emit('hitl.item.created', {
          eventId: crypto.randomUUID(),
          itemId: id,
          tenantId,
          kind: item.kind,
          status: item.status,
          severity: item.severity,
          dueAt: item.dueAt,
          originService: item.originService,
          originAction: item.originAction,
          timestamp: createdAt,
        });

        return { success: true, item: this.toPublic(item) };
      },
    },

    list: {
      rest: 'GET /items',
      params: {
        status: { type: 'string', optional: true },
        kind: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50, max: 200 },
      },
      openapi: {
        summary: 'List HITL items',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', example: 'pending' } },
          {
            name: 'kind',
            in: 'query',
            schema: { type: 'string', example: 'finance-hypothetical-review' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const status = normalizeStatus(ctx.params.status);
        const kind = String(ctx.params.kind || '').trim();

        const docs = await this.getAllItems();
        let filtered = docs.filter((doc) => doc.tenantId === tenantId);

        if (ctx.params.status) {
          filtered = filtered.filter((doc) => normalizeStatus(doc.status) === status);
        }
        if (kind) {
          filtered = filtered.filter((doc) => String(doc.kind || '') === kind);
        }

        filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        const limit = Math.min(ctx.params.limit || 50, 200);
        const items = filtered.slice(0, limit).map((doc) => this.toPublic(doc));

        return { success: true, count: items.length, items };
      },
    },

    get: {
      rest: 'GET /items/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get HITL item',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000001' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const item = await this.getItemById(ctx.params.id, tenantId);
        return { success: true, item: this.toPublic(item) };
      },
    },

    approve: {
      rest: 'POST /items/:id/approve',
      params: {
        id: { type: 'string' },
        comment: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Approve HITL item',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000001' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  comment: { type: 'string', example: 'Looks good' },
                },
              },
              examples: {
                default: {
                  value: { comment: 'Looks good' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const item = await this.getItemById(ctx.params.id, tenantId);
        const updated = await this.resolveItem(item, 'approved', ctx.params.comment || null, ctx);
        return { success: true, item: this.toPublic(updated) };
      },
    },

    reject: {
      rest: 'POST /items/:id/reject',
      params: {
        id: { type: 'string' },
        comment: { type: 'string', optional: true },
        feedbackToAgent: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Reject HITL item',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000001' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  comment: { type: 'string', example: 'Missing supporting evidence' },
                  feedbackToAgent: {
                    type: 'string',
                    example: 'Please provide legal reference to §21a EnWG.',
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    comment: 'Missing supporting evidence',
                    feedbackToAgent: 'Please provide legal reference to §21a EnWG.',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const item = await this.getItemById(ctx.params.id, tenantId);
        const comment =
          ctx.params.feedbackToAgent && !ctx.params.comment
            ? ctx.params.feedbackToAgent
            : ctx.params.comment || null;
        const updated = await this.resolveItem(item, 'rejected', comment, ctx);
        return { success: true, item: this.toPublic(updated) };
      },
    },

    escalate: {
      rest: 'POST /items/:id/escalate',
      params: {
        id: { type: 'string' },
        comment: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Escalate HITL item',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000001' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  comment: { type: 'string', example: 'Escalate to legal review' },
                },
              },
              examples: {
                default: {
                  value: { comment: 'Escalate to legal review' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const item = await this.getItemById(ctx.params.id, tenantId);
        if (normalizeStatus(item.status) !== 'pending') {
          throw new MoleculerClientError(
            `Cannot escalate item with status '${item.status}'`,
            400,
            'HITL_INVALID_STATUS'
          );
        }

        const updatedAt = nowIso();
        const intervention = {
          at: updatedAt,
          action: 'escalated',
          actor: ctx.meta?.apiToken?.id || 'system',
          comment: ctx.params.comment || 'Escalated to second review level',
        };
        const updated = {
          ...item,
          escalationLevel: Number(item.escalationLevel || 0) + 1,
          updatedAt,
          agent_interventions: [...(item.agent_interventions || []), intervention],
        };

        await this.db.put(updated);
        return { success: true, item: this.toPublic(updated) };
      },
    },
  },

  methods: {
    async getAllItems() {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: DOC_PREFIX,
        endkey: `${DOC_PREFIX}\ufff0`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async getItemById(id, tenantId) {
      let item;
      try {
        item = await this.db.get(`${DOC_PREFIX}${id}`);
      } catch (err) {
        if (err?.status === 404 || err?.name === 'not_found') {
          throw new MoleculerClientError('HITL item not found', 404, 'HITL_ITEM_NOT_FOUND');
        }
        throw err;
      }

      if (item.tenantId !== tenantId) {
        throw new MoleculerClientError('HITL item not found', 404, 'HITL_ITEM_NOT_FOUND');
      }

      return item;
    },

    toPublic(item) {
      const publicDoc = { ...item };
      delete publicDoc._rev;
      delete publicDoc._id;
      return publicDoc;
    },

    async resolveItem(item, status, comment, ctx) {
      if (normalizeStatus(item.status) !== 'pending') {
        throw new MoleculerClientError(
          `Cannot resolve item with status '${item.status}'`,
          400,
          'HITL_INVALID_STATUS'
        );
      }

      const resolvedAt = nowIso();
      const intervention = {
        at: resolvedAt,
        action: status,
        actor: ctx.meta?.apiToken?.id || 'system',
        comment: comment || null,
      };

      const updated = {
        ...item,
        status,
        updatedAt: resolvedAt,
        resolvedAt,
        agent_interventions: [...(item.agent_interventions || []), intervention],
      };

      await this.db.put(updated);

      this.broker.emit('hitl.item.resolved', {
        eventId: crypto.randomUUID(),
        itemId: updated.id,
        tenantId: updated.tenantId,
        kind: updated.kind,
        status: updated.status,
        resolvedAt,
        originService: updated.originService,
        originAction: updated.originAction,
        comment: comment || null,
      });

      return updated;
    },

    async expireDueItems() {
      const docs = await this.getAllItems();
      const nowMs = Date.now();

      for (const item of docs) {
        if (normalizeStatus(item.status) !== 'pending') continue;
        const dueMs = Date.parse(item.dueAt || '');
        if (Number.isNaN(dueMs) || dueMs > nowMs) continue;

        const updatedAt = nowIso();
        const updated = {
          ...item,
          status: 'expired',
          updatedAt,
          resolvedAt: updatedAt,
          agent_interventions: [
            ...(item.agent_interventions || []),
            {
              at: updatedAt,
              action: 'expired',
              actor: 'system',
              comment: 'SLA expired',
            },
          ],
        };
        await this.db.put(updated);
        this.broker.emit('hitl.item.expired', {
          eventId: crypto.randomUUID(),
          itemId: updated.id,
          tenantId: updated.tenantId,
          kind: updated.kind,
          status: updated.status,
          timestamp: updatedAt,
        });
      }
    },
  },
};
