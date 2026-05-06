'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const OPENAPI_TAG = 'HITL';
const DOC_PREFIX = 'hi:';
const DEFAULT_DUE_DAYS = 7;
const DEFAULT_SUMMARY_WINDOW_DAYS = 30;
const DEFAULT_HEATMAP_WINDOW_DAYS = 14;
const MAX_BULK_IDS = 100;

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return 'pending';
  return value;
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function toBucketKey(date) {
  return new Date(date).toISOString().slice(0, 10);
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
        originService: { type: 'string', optional: true },
        originAction: { type: 'string', optional: true },
        severity: { type: 'string', optional: true },
        overdueOnly: { type: 'boolean', optional: true, convert: true, default: false },
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
          {
            name: 'originService',
            in: 'query',
            schema: { type: 'string', example: 'finance-agent' },
          },
          {
            name: 'originAction',
            in: 'query',
            schema: { type: 'string', example: 'analyze' },
          },
          {
            name: 'severity',
            in: 'query',
            schema: { type: 'string', example: 'warning' },
          },
          {
            name: 'overdueOnly',
            in: 'query',
            schema: { type: 'boolean', default: false },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantItems(tenantId);
        let filtered = this.filterItems(docs, ctx.params);

        filtered.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

        const limit = Math.min(ctx.params.limit || 50, 200);
        const items = filtered.slice(0, limit).map((doc) => this.toPublic(doc));

        return { success: true, count: items.length, items };
      },
    },

    summary: {
      rest: 'GET /summary',
      params: {
        sinceDays: {
          type: 'number',
          optional: true,
          convert: true,
          integer: true,
          default: DEFAULT_SUMMARY_WINDOW_DAYS,
          min: 1,
          max: 365,
        },
      },
      openapi: {
        summary: 'Summarize HITL queue and workload',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'sinceDays',
            in: 'query',
            schema: { type: 'integer', default: DEFAULT_SUMMARY_WINDOW_DAYS, maximum: 365 },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const items = await this.getTenantItems(tenantId);
        return this.buildSummaryResponse(items, ctx.params.sinceDays);
      },
    },

    slaHeatmap: {
      rest: 'GET /sla-heatmap',
      params: {
        sinceDays: {
          type: 'number',
          optional: true,
          convert: true,
          integer: true,
          default: DEFAULT_HEATMAP_WINDOW_DAYS,
          min: 1,
          max: 90,
        },
      },
      openapi: {
        summary: 'Get HITL SLA heatmap buckets',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'sinceDays',
            in: 'query',
            schema: { type: 'integer', default: DEFAULT_HEATMAP_WINDOW_DAYS, maximum: 90 },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const items = await this.getTenantItems(tenantId);
        return this.buildHeatmapResponse(items, ctx.params.sinceDays);
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
        const updated = await this.resolveItem(item, 'approved', ctx, {
          comment: ctx.params.comment || null,
        });
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
        const updated = await this.resolveItem(item, 'rejected', ctx, {
          comment: ctx.params.comment || null,
          feedbackToAgent: ctx.params.feedbackToAgent || null,
        });
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

    bulkApprove: {
      rest: 'POST /items/bulk-approve',
      params: {
        ids: { type: 'array', items: 'string', min: 1, max: MAX_BULK_IDS },
        comment: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Approve multiple HITL items',
        tags: [OPENAPI_TAG],
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
                    maxItems: MAX_BULK_IDS,
                    example: ['00000000-0000-4000-8000-000000000001'],
                    items: {
                      type: 'string',
                      example: '00000000-0000-4000-8000-000000000001',
                    },
                  },
                  comment: { type: 'string', example: 'Bulk approval by shift lead' },
                },
              },
              examples: {
                default: {
                  value: {
                    ids: ['00000000-0000-4000-8000-000000000001'],
                    comment: 'Bulk approval by shift lead',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return this.bulkResolveItems(ctx, 'approved', { comment: ctx.params.comment || null });
      },
    },

    bulkReject: {
      rest: 'POST /items/bulk-reject',
      params: {
        ids: { type: 'array', items: 'string', min: 1, max: MAX_BULK_IDS },
        comment: { type: 'string', optional: true },
        feedbackToAgent: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Reject multiple HITL items',
        tags: [OPENAPI_TAG],
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
                    maxItems: MAX_BULK_IDS,
                    example: ['00000000-0000-4000-8000-000000000001'],
                    items: {
                      type: 'string',
                      example: '00000000-0000-4000-8000-000000000001',
                    },
                  },
                  comment: { type: 'string', example: 'Bulk rejection after policy review' },
                  feedbackToAgent: {
                    type: 'string',
                    example: 'Evidence package missing legal references.',
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    ids: ['00000000-0000-4000-8000-000000000001'],
                    comment: 'Bulk rejection after policy review',
                    feedbackToAgent: 'Evidence package missing legal references.',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return this.bulkResolveItems(ctx, 'rejected', {
          comment: ctx.params.comment || null,
          feedbackToAgent: ctx.params.feedbackToAgent || null,
        });
      },
    },

    bulkEscalate: {
      rest: 'POST /items/bulk-escalate',
      params: {
        ids: { type: 'array', items: 'string', min: 1, max: MAX_BULK_IDS },
        comment: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Escalate multiple HITL items',
        tags: [OPENAPI_TAG],
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
                    maxItems: MAX_BULK_IDS,
                    example: ['00000000-0000-4000-8000-000000000001'],
                    items: {
                      type: 'string',
                      example: '00000000-0000-4000-8000-000000000001',
                    },
                  },
                  comment: { type: 'string', example: 'Escalate batch to legal queue' },
                },
              },
              examples: {
                default: {
                  value: {
                    ids: ['00000000-0000-4000-8000-000000000001'],
                    comment: 'Escalate batch to legal queue',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return this.bulkEscalateItems(ctx, ctx.params.comment || null);
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

    async getTenantItems(tenantId) {
      const docs = await this.getAllItems();
      return docs.filter((doc) => doc.tenantId === tenantId);
    },

    isOverdue(item, atMs = Date.now()) {
      if (normalizeStatus(item?.status) !== 'pending') return false;
      const dueMs = Date.parse(item?.dueAt || '');
      return !Number.isNaN(dueMs) && dueMs <= atMs;
    },

    filterItems(items, filters) {
      const status = filters.status ? normalizeStatus(filters.status) : null;
      const kind = normalizeValue(filters.kind);
      const originService = normalizeValue(filters.originService);
      const originAction = normalizeValue(filters.originAction);
      const severity = normalizeValue(filters.severity);

      return items.filter((doc) => {
        if (status && normalizeStatus(doc.status) !== status) return false;
        if (kind && normalizeValue(doc.kind) !== kind) return false;
        if (originService && normalizeValue(doc.originService) !== originService) return false;
        if (originAction && normalizeValue(doc.originAction) !== originAction) return false;
        if (severity && normalizeValue(doc.severity) !== severity) return false;
        if (filters.overdueOnly && !this.isOverdue(doc)) return false;
        return true;
      });
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

    async resolveItem(item, status, ctx, options = {}) {
      if (normalizeStatus(item.status) !== 'pending') {
        throw new MoleculerClientError(
          `Cannot resolve item with status '${item.status}'`,
          400,
          'HITL_INVALID_STATUS'
        );
      }

      const resolvedAt = nowIso();
      const comment = options.comment || options.feedbackToAgent || null;
      const intervention = {
        at: resolvedAt,
        action: status,
        actor: ctx.meta?.apiToken?.id || 'system',
        comment: comment || null,
      };
      if (options.feedbackToAgent) {
        intervention.feedbackToAgent = options.feedbackToAgent;
      }

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
        feedbackToAgent: options.feedbackToAgent || null,
      });

      return updated;
    },

    async buildSummaryResponse(items, sinceDays) {
      const generatedAt = nowIso();
      const windowStartMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
      const relevant = items.filter((item) => {
        const reference = Date.parse(item.updatedAt || item.createdAt || '');
        return !Number.isNaN(reference) && reference >= windowStartMs;
      });
      const current = items;

      return {
        success: true,
        generatedAt,
        window: {
          sinceDays,
          dateFrom: new Date(windowStartMs).toISOString(),
          dateTo: generatedAt,
        },
        currentQueue: {
          total: current.length,
          pending: current.filter((item) => normalizeStatus(item.status) === 'pending').length,
          overdue: current.filter((item) => this.isOverdue(item)).length,
          approved: current.filter((item) => normalizeStatus(item.status) === 'approved').length,
          rejected: current.filter((item) => normalizeStatus(item.status) === 'rejected').length,
          expired: current.filter((item) => normalizeStatus(item.status) === 'expired').length,
        },
        byStatus: this.countByField(relevant, 'status', normalizeStatus),
        byKind: this.countByField(relevant, 'kind'),
        byOriginService: this.countByField(relevant, 'originService'),
        bySeverity: this.countByField(relevant, 'severity'),
      };
    },

    buildHeatmapResponse(items, sinceDays) {
      const generatedAt = nowIso();
      const bucketStarts = [];
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - (sinceDays - 1));

      for (let offset = 0; offset < sinceDays; offset += 1) {
        const current = new Date(start);
        current.setUTCDate(start.getUTCDate() + offset);
        bucketStarts.push(current);
      }

      const buckets = bucketStarts.map((bucketStart) => {
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setUTCHours(23, 59, 59, 999);
        const bucketDate = toBucketKey(bucketStart);
        const bucketEndMs = bucketEnd.getTime();

        const created = items.filter((item) => toBucketKey(item.createdAt) === bucketDate).length;
        const resolved = items.filter(
          (item) => item.resolvedAt && toBucketKey(item.resolvedAt) === bucketDate
        );

        return {
          date: bucketDate,
          created,
          approved: resolved.filter((item) => normalizeStatus(item.status) === 'approved').length,
          rejected: resolved.filter((item) => normalizeStatus(item.status) === 'rejected').length,
          expired: resolved.filter((item) => normalizeStatus(item.status) === 'expired').length,
          resolvedWithinSla: resolved.filter((item) => {
            const dueMs = Date.parse(item.dueAt || '');
            const resolvedMs = Date.parse(item.resolvedAt || '');
            return !Number.isNaN(dueMs) && !Number.isNaN(resolvedMs) && resolvedMs <= dueMs;
          }).length,
          pendingOpen: items.filter((item) => {
            const createdMs = Date.parse(item.createdAt || '');
            return !Number.isNaN(createdMs) && createdMs <= bucketEndMs && normalizeStatus(item.status) === 'pending';
          }).length,
          overdueOpen: items.filter((item) => {
            const createdMs = Date.parse(item.createdAt || '');
            const dueMs = Date.parse(item.dueAt || '');
            return (
              !Number.isNaN(createdMs) &&
              createdMs <= bucketEndMs &&
              normalizeStatus(item.status) === 'pending' &&
              !Number.isNaN(dueMs) &&
              dueMs <= bucketEndMs
            );
          }).length,
        };
      });

      return {
        success: true,
        generatedAt,
        window: {
          sinceDays,
          dateFrom: bucketStarts[0].toISOString(),
          dateTo: generatedAt,
        },
        buckets,
      };
    },

    countByField(items, field, normalizer = (value) => String(value || '').trim()) {
      const counts = new Map();
      for (const item of items) {
        const key = normalizer(item[field]);
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .map(([value, count]) => ({ value, count }));
    },

    async bulkResolveItems(ctx, status, options) {
      const tenantId = getTenantId(ctx);
      const processed = [];
      const failed = [];

      for (const id of ctx.params.ids) {
        try {
          const item = await this.getItemById(id, tenantId);
          const updated = await this.resolveItem(item, status, ctx, options);
          processed.push(this.toPublic(updated));
        } catch (err) {
          failed.push({
            id,
            code: err?.type || err?.code || 'HITL_BULK_ITEM_FAILED',
            message: err?.message || 'Unknown HITL bulk processing error',
          });
        }
      }

      return {
        success: failed.length === 0,
        processed: ctx.params.ids.length,
        succeeded: processed.length,
        failed,
        items: processed,
      };
    },

    async bulkEscalateItems(ctx, comment) {
      const tenantId = getTenantId(ctx);
      const processed = [];
      const failed = [];

      for (const id of ctx.params.ids) {
        try {
          const item = await this.getItemById(id, tenantId);
          if (normalizeStatus(item.status) !== 'pending') {
            throw new MoleculerClientError(
              `Cannot escalate item with status '${item.status}'`,
              400,
              'HITL_INVALID_STATUS'
            );
          }
          const updatedAt = nowIso();
          const updated = {
            ...item,
            escalationLevel: Number(item.escalationLevel || 0) + 1,
            updatedAt,
            agent_interventions: [
              ...(item.agent_interventions || []),
              {
                at: updatedAt,
                action: 'escalated',
                actor: ctx.meta?.apiToken?.id || 'system',
                comment: comment || 'Escalated to second review level',
              },
            ],
          };
          await this.db.put(updated);
          processed.push(this.toPublic(updated));
        } catch (err) {
          failed.push({
            id,
            code: err?.type || err?.code || 'HITL_BULK_ITEM_FAILED',
            message: err?.message || 'Unknown HITL bulk processing error',
          });
        }
      }

      return {
        success: failed.length === 0,
        processed: ctx.params.ids.length,
        succeeded: processed.length,
        failed,
        items: processed,
      };
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
