'use strict';

const crypto = require('crypto');
const axios = require('axios');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');
const { encryptSecret, decryptSecret, signPayload } = require('../src/webhook-crypto');

const OPENAPI_TAG = 'Webhooks';
const SUB_PREFIX = 'sub:';
const DEL_PREFIX = 'del:';
const MAX_HEADER_VALUE_LEN = 200;
const EVENT_WHITELIST = [
  'cya.a2a.consensus.failed',
  'cya.a2a.conflict.detected',
  'mastr-monitor.delta.detected',
  'hitl.item.created',
  'hitl.item.resolved',
  'hitl.item.expired',
  'redispatch-expost.audit.completed',
  'mastr-quality.audit.completed',
  'finance-agent.analysis.completed',
  'decision.proposed',
  'decision.approved',
  'decision.rejected',
  'decision.applied',
  'decision.expired',
  'auth.session.created',
  'auth.session.expired',
  'rate_limit.exceeded',
  'quota.threshold.reached',
  'quota.exhausted',
];

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'webhooks',

  settings: {
    dbPath: process.env.WEBHOOKS_DB_PATH || './data/webhooks',
    retryScheduleMs: [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000],
    maxAttempts: 5,
    processIntervalMs: Number(process.env.WEBHOOKS_PROCESS_INTERVAL_MS || 15_000),
    deliveryTimeoutMs: Number(process.env.WEBHOOKS_DELIVERY_TIMEOUT_MS || 8_000),
    deadDisableThreshold: Number(process.env.WEBHOOKS_DEAD_DISABLE_THRESHOLD || 50),
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
    this.processTimer = null;
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type'] } });
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    this.logger.info(`Webhook DB initialized at ${this.settings.dbPath}`);

    this.processTimer = setInterval(() => {
      this.processDueDeliveries().catch((err) =>
        this.logger.warn(`[webhooks] processDueDeliveries failed: ${err.message}`)
      );
    }, this.settings.processIntervalMs);
  },

  async stopped() {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    create: {
      rest: 'POST /',
      params: {
        url: { type: 'string', min: 8 },
        events: { type: 'array', items: 'string', min: 1 },
        secret: { type: 'string', optional: true },
        headers: { type: 'object', optional: true, default: {} },
        isActive: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        summary: 'Create webhook subscription',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', example: 'https://example.com/hooks/cernion' },
                  events: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['cya.a2a.consensus.failed'],
                  },
                  secret: { type: 'string', example: 'my-shared-secret' },
                  headers: { type: 'object', example: { 'X-Customer': 'tenant-a' } },
                  isActive: { type: 'boolean', default: true },
                },
              },
              examples: {
                default: {
                  value: {
                    url: 'https://example.com/hooks/cernion',
                    events: ['cya.a2a.consensus.failed', 'hitl.item.created'],
                    secret: 'my-shared-secret',
                    headers: { 'X-Customer': 'tenant-a' },
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const events = this.validateEvents(ctx.params.events || []);
        const headers = this.sanitizeHeaders(ctx.params.headers || {});
        const secretEncrypted = ctx.params.secret ? encryptSecret(ctx.params.secret) : null;

        const createdAt = nowIso();
        const id = crypto.randomUUID();
        const doc = {
          _id: `${SUB_PREFIX}${id}`,
          id,
          type: 'webhook-subscription',
          tenantId,
          url: ctx.params.url,
          events,
          headers,
          secretEncrypted,
          isActive: ctx.params.isActive !== false,
          deadCount: 0,
          createdAt,
          updatedAt: createdAt,
        };

        await this.db.put(doc);
        return { success: true, subscription: this.toPublicSubscription(doc) };
      },
    },

    list: {
      rest: 'GET /',
      params: {
        event: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List webhook subscriptions',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'event',
            in: 'query',
            schema: { type: 'string', example: 'cya.a2a.consensus.failed' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        let subs = await this.getAllSubscriptions();
        subs = subs.filter((sub) => sub.tenantId === tenantId);

        if (ctx.params.event) {
          subs = subs.filter((sub) => Array.isArray(sub.events) && sub.events.includes(ctx.params.event));
        }

        subs.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        return { success: true, count: subs.length, subscriptions: subs.map((s) => this.toPublicSubscription(s)) };
      },
    },

    remove: {
      rest: 'DELETE /:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Delete webhook subscription',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000010' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const sub = await this.getSubscription(ctx.params.id, tenantId);
        await this.db.remove(sub);
        return { success: true, id: ctx.params.id };
      },
    },

    test: {
      rest: 'POST /:id/test',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Send test webhook delivery',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000010' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {},
              },
              examples: {
                default: {
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const sub = await this.getSubscription(ctx.params.id, tenantId);

        const eventId = crypto.randomUUID();
        const delivery = await this.createDelivery(sub, {
          eventName: 'webhook.test',
          eventId,
          payload: {
            message: 'Webhook test delivery',
            timestamp: nowIso(),
          },
        });

        await this.dispatchDelivery(delivery);
        const refreshed = await this.getDelivery(sub.id, delivery.id, tenantId);
        return { success: true, delivery: this.toPublicDelivery(refreshed) };
      },
    },

    listDeliveries: {
      rest: 'GET /:id/deliveries',
      params: {
        id: { type: 'string' },
        status: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 50, max: 200, convert: true },
      },
      openapi: {
        summary: 'List webhook deliveries',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000010' },
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', example: 'failed' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        await this.getSubscription(ctx.params.id, tenantId);

        let deliveries = await this.getAllDeliveries();
        deliveries = deliveries.filter((item) => item.subscriptionId === ctx.params.id && item.tenantId === tenantId);

        if (ctx.params.status) {
          const status = String(ctx.params.status).toLowerCase();
          deliveries = deliveries.filter((item) => String(item.status || '').toLowerCase() === status);
        }

        deliveries.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const limit = Math.min(ctx.params.limit || 50, 200);

        return {
          success: true,
          count: Math.min(deliveries.length, limit),
          deliveries: deliveries.slice(0, limit).map((item) => this.toPublicDelivery(item)),
        };
      },
    },

    replay: {
      rest: 'POST /:id/deliveries/:deliveryId/replay',
      params: {
        id: { type: 'string' },
        deliveryId: { type: 'string' },
      },
      openapi: {
        summary: 'Replay webhook delivery',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000010' },
          },
          {
            name: 'deliveryId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '00000000-0000-4000-8000-000000000011' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {},
              },
              examples: {
                default: {
                  value: {},
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        await this.getSubscription(ctx.params.id, tenantId);
        const delivery = await this.getDelivery(ctx.params.id, ctx.params.deliveryId, tenantId);

        const updated = {
          ...delivery,
          status: 'pending',
          nextAttemptAt: nowIso(),
          lastError: null,
          updatedAt: nowIso(),
        };
        await this.db.put(updated);

        await this.dispatchDelivery(updated);
        const refreshed = await this.getDelivery(ctx.params.id, ctx.params.deliveryId, tenantId);
        return { success: true, delivery: this.toPublicDelivery(refreshed) };
      },
    },
  },

  events: {
    'cya.a2a.consensus.failed': {
      async handler(ctx) {
        await this.enqueueFromEvent('cya.a2a.consensus.failed', ctx.params);
      },
    },
    'cya.a2a.conflict.detected': {
      async handler(ctx) {
        await this.enqueueFromEvent('cya.a2a.conflict.detected', ctx.params);
      },
    },
    'mastr-monitor.delta.detected': {
      async handler(ctx) {
        await this.enqueueFromEvent('mastr-monitor.delta.detected', ctx.params);
      },
    },
    'hitl.item.created': {
      async handler(ctx) {
        await this.enqueueFromEvent('hitl.item.created', ctx.params);
      },
    },
    'hitl.item.resolved': {
      async handler(ctx) {
        await this.enqueueFromEvent('hitl.item.resolved', ctx.params);
      },
    },
    'hitl.item.expired': {
      async handler(ctx) {
        await this.enqueueFromEvent('hitl.item.expired', ctx.params);
      },
    },
    'redispatch-expost.audit.completed': {
      async handler(ctx) {
        await this.enqueueFromEvent('redispatch-expost.audit.completed', ctx.params);
      },
    },
    'mastr-quality.audit.completed': {
      async handler(ctx) {
        await this.enqueueFromEvent('mastr-quality.audit.completed', ctx.params);
      },
    },
    'finance-agent.analysis.completed': {
      async handler(ctx) {
        await this.enqueueFromEvent('finance-agent.analysis.completed', ctx.params);
      },
    },
    'decision.proposed': {
      async handler(ctx) {
        await this.enqueueFromEvent('decision.proposed', ctx.params);
      },
    },
    'decision.approved': {
      async handler(ctx) {
        await this.enqueueFromEvent('decision.approved', ctx.params);
      },
    },
    'decision.rejected': {
      async handler(ctx) {
        await this.enqueueFromEvent('decision.rejected', ctx.params);
      },
    },
    'decision.applied': {
      async handler(ctx) {
        await this.enqueueFromEvent('decision.applied', ctx.params);
      },
    },
    'decision.expired': {
      async handler(ctx) {
        await this.enqueueFromEvent('decision.expired', ctx.params);
      },
    },
    'auth.session.created': {
      async handler(ctx) {
        await this.enqueueFromEvent('auth.session.created', ctx.params);
      },
    },
    'auth.session.expired': {
      async handler(ctx) {
        await this.enqueueFromEvent('auth.session.expired', ctx.params);
      },
    },
    'rate_limit.exceeded': {
      async handler(ctx) {
        await this.enqueueFromEvent('rate_limit.exceeded', ctx.params);
      },
    },
    'quota.threshold.reached': {
      async handler(ctx) {
        await this.enqueueFromEvent('quota.threshold.reached', ctx.params);
      },
    },
    'quota.exhausted': {
      async handler(ctx) {
        await this.enqueueFromEvent('quota.exhausted', ctx.params);
      },
    },
  },

  methods: {
    validateEvents(events) {
      const unique = [...new Set((events || []).map((event) => String(event || '').trim()).filter(Boolean))];
      if (unique.length === 0) {
        throw new MoleculerClientError('events must contain at least one event name', 422, 'INVALID_EVENTS');
      }
      const invalid = unique.filter((event) => !EVENT_WHITELIST.includes(event));
      if (invalid.length > 0) {
        throw new MoleculerClientError(
          `Unsupported events: ${invalid.join(', ')}`,
          422,
          'UNSUPPORTED_EVENTS'
        );
      }
      return unique;
    },

    sanitizeHeaders(headers) {
      const safeHeaders = {};
      for (const [name, value] of Object.entries(headers || {})) {
        const key = String(name || '').trim();
        if (!key) continue;
        const normalizedValue = String(value == null ? '' : value).trim();
        if (!normalizedValue) continue;
        safeHeaders[key] = normalizedValue.slice(0, MAX_HEADER_VALUE_LEN);
      }
      return safeHeaders;
    },

    toPublicSubscription(sub) {
      const publicDoc = { ...sub };
      delete publicDoc._id;
      delete publicDoc._rev;
      delete publicDoc.secretEncrypted;
      publicDoc.hasSecret = !!sub.secretEncrypted;
      return publicDoc;
    },

    toPublicDelivery(delivery) {
      const publicDoc = { ...delivery };
      delete publicDoc._id;
      delete publicDoc._rev;
      return publicDoc;
    },

    async getAllSubscriptions() {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: SUB_PREFIX,
        endkey: `${SUB_PREFIX}\ufff0`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async getAllDeliveries() {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: DEL_PREFIX,
        endkey: `${DEL_PREFIX}\ufff0`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async getSubscription(id, tenantId) {
      let sub;
      try {
        sub = await this.db.get(`${SUB_PREFIX}${id}`);
      } catch (err) {
        if (err?.status === 404 || err?.name === 'not_found') {
          throw new MoleculerClientError('Webhook subscription not found', 404, 'WEBHOOK_NOT_FOUND');
        }
        throw err;
      }
      if (sub.tenantId !== tenantId) {
        throw new MoleculerClientError('Webhook subscription not found', 404, 'WEBHOOK_NOT_FOUND');
      }
      return sub;
    },

    async getDelivery(subscriptionId, deliveryId, tenantId) {
      let delivery;
      try {
        delivery = await this.db.get(`${DEL_PREFIX}${deliveryId}`);
      } catch (err) {
        if (err?.status === 404 || err?.name === 'not_found') {
          throw new MoleculerClientError('Webhook delivery not found', 404, 'WEBHOOK_DELIVERY_NOT_FOUND');
        }
        throw err;
      }

      if (delivery.subscriptionId !== subscriptionId || delivery.tenantId !== tenantId) {
        throw new MoleculerClientError('Webhook delivery not found', 404, 'WEBHOOK_DELIVERY_NOT_FOUND');
      }

      return delivery;
    },

    getBackoffMs(failedAttemptCount) {
      const idx = Math.max(0, Math.min(failedAttemptCount - 1, this.settings.retryScheduleMs.length - 1));
      return this.settings.retryScheduleMs[idx];
    },

    async enqueueFromEvent(eventName, payload) {
      if (!EVENT_WHITELIST.includes(eventName)) return;

      const subscriptions = await this.getAllSubscriptions();
      const active = subscriptions.filter(
        (sub) => sub.isActive !== false && Array.isArray(sub.events) && sub.events.includes(eventName)
      );

      if (active.length === 0) return;

      const eventId = String(payload?.eventId || payload?.messageId || crypto.randomUUID());
      const createdDeliveries = [];

      for (const sub of active) {
        const delivery = await this.createDelivery(sub, { eventName, eventId, payload });
        createdDeliveries.push(delivery);
      }

      for (const delivery of createdDeliveries) {
        await this.dispatchDelivery(delivery);
      }
    },

    async createDelivery(sub, eventData) {
      const id = crypto.randomUUID();
      const createdAt = nowIso();
      const delivery = {
        _id: `${DEL_PREFIX}${id}`,
        id,
        type: 'webhook-delivery',
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        eventName: eventData.eventName,
        eventId: eventData.eventId,
        payload: eventData.payload || {},
        status: 'pending',
        attemptCount: 0,
        maxAttempts: this.settings.maxAttempts,
        nextAttemptAt: createdAt,
        lastAttemptAt: null,
        lastError: null,
        responseStatus: null,
        deadAt: null,
        createdAt,
        updatedAt: createdAt,
      };

      await this.db.put(delivery);
      return delivery;
    },

    async processDueDeliveries(limit = 20) {
      const deliveries = await this.getAllDeliveries();
      const nowMs = Date.now();

      const due = deliveries
        .filter((item) => ['pending', 'retrying'].includes(item.status))
        .filter((item) => {
          const dueMs = Date.parse(item.nextAttemptAt || '');
          return !Number.isNaN(dueMs) && dueMs <= nowMs;
        })
        .sort((a, b) => String(a.nextAttemptAt || '').localeCompare(String(b.nextAttemptAt || '')))
        .slice(0, limit);

      for (const delivery of due) {
        await this.dispatchDelivery(delivery);
      }

      return { success: true, processed: due.length };
    },

    async dispatchDelivery(delivery) {
      const current = await this.db.get(`${DEL_PREFIX}${delivery.id}`);
      if (!['pending', 'retrying'].includes(current.status)) return current;

      let sub;
      try {
        sub = await this.db.get(`${SUB_PREFIX}${current.subscriptionId}`);
      } catch (err) {
        const dead = {
          ...current,
          status: 'dead',
          updatedAt: nowIso(),
          lastError: 'Subscription missing',
          deadAt: nowIso(),
        };
        await this.db.put(dead);
        return dead;
      }

      if (sub.isActive === false) {
        return current;
      }

      const attempt = Number(current.attemptCount || 0) + 1;
      const lastAttemptAt = nowIso();
      const body = {
        eventId: String(current.eventId || crypto.randomUUID()),
        deliveryId: current.id,
        event: current.eventName,
        timestamp: lastAttemptAt,
        tenantId: current.tenantId,
        attempt,
        payload: current.payload,
      };
      const bodyString = JSON.stringify(body);

      const secret = sub.secretEncrypted ? decryptSecret(sub.secretEncrypted) : '';
      const signature = signPayload(bodyString, secret);
      const headers = {
        'Content-Type': 'application/json',
        ...(sub.headers || {}),
      };
      if (signature) {
        headers['X-Cernion-Signature'] = signature;
      }

      try {
        const response = await axios.post(sub.url, bodyString, {
          timeout: this.settings.deliveryTimeoutMs,
          headers,
          validateStatus: () => true,
        });

        if (response.status >= 200 && response.status < 300) {
          const sent = {
            ...current,
            status: 'sent',
            attemptCount: attempt,
            responseStatus: response.status,
            lastAttemptAt,
            updatedAt: nowIso(),
            lastError: null,
          };
          await this.db.put(sent);
          return sent;
        }

        return this.markDeliveryFailure(current, sub, attempt, `HTTP ${response.status}`, lastAttemptAt);
      } catch (err) {
        const reason = err?.message ? String(err.message) : 'Delivery failed';
        return this.markDeliveryFailure(current, sub, attempt, reason, lastAttemptAt);
      }
    },

    async markDeliveryFailure(current, sub, attempt, reason, attemptedAt) {
      if (attempt >= this.settings.maxAttempts) {
        const deadAt = nowIso();
        const dead = {
          ...current,
          status: 'dead',
          attemptCount: attempt,
          lastAttemptAt: attemptedAt,
          lastError: reason,
          deadAt,
          updatedAt: deadAt,
        };
        await this.db.put(dead);

        const deadCount = Number(sub.deadCount || 0) + 1;
        const subscriptionUpdate = {
          ...sub,
          deadCount,
          updatedAt: nowIso(),
        };
        if (deadCount >= this.settings.deadDisableThreshold) {
          subscriptionUpdate.isActive = false;
        }
        await this.db.put(subscriptionUpdate);
        return dead;
      }

      const delayMs = this.getBackoffMs(attempt);
      const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
      const retry = {
        ...current,
        status: 'retrying',
        attemptCount: attempt,
        lastAttemptAt: attemptedAt,
        lastError: reason,
        nextAttemptAt,
        updatedAt: nowIso(),
      };
      await this.db.put(retry);
      return retry;
    },
  },
};
