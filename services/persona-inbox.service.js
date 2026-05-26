'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, validateTenantId } = require('../src/tenant-context');

const DOC_PREFIX = 'pi:';
const MESSAGE_STATUSES = Object.freeze(['queued', 'visible', 'acknowledged', 'resolved']);

function nowIso() {
  return new Date().toISOString();
}

function trimString(value) {
  return String(value || '').trim();
}

function toHash(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 24);
}

module.exports = {
  name: 'persona-inbox',

  settings: {
    dbPath: process.env.PERSONA_INBOX_DB_PATH || './data/persona-inbox',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['personaId'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['hitlItemId'] } });
    this.logger.info(`Persona Inbox DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    enqueue: {
      params: {
        tenantId: { type: 'string', optional: true },
        personaId: { type: 'string', min: 1 },
        sessionId: { type: 'string', optional: true },
        type: { type: 'string', optional: true, default: 'hitl-approval' },
        hitlItemId: { type: 'string', optional: true },
        embedRef: { type: 'string', optional: true },
        title: { type: 'string', optional: true },
        summary: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const record = await this.enqueueMessage(tenantId, ctx.params);
        return { success: true, deduplicated: record.deduplicated, item: this.toPublic(record.item) };
      },
    },

    listPendingForPersona: {
      params: {
        tenantId: { type: 'string', optional: true },
        personaId: { type: 'string', min: 1 },
        sessionId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50, min: 1, max: 200 },
        offset: { type: 'number', optional: true, convert: true, default: 0, min: 0 },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const personaId = trimString(ctx.params.personaId);
        const sessionId = trimString(ctx.params.sessionId);

        let docs = await this.getTenantInboxMessages(tenantId);
        docs = docs
          .filter((doc) => doc.personaId === personaId)
          .filter((doc) => doc.status === 'queued')
          .filter((doc) => !sessionId || !doc.sessionId || doc.sessionId === sessionId)
          .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));

        const offset = Number(ctx.params.offset || 0);
        const limit = Number(ctx.params.limit || 50);
        const items = docs.slice(offset, offset + limit).map((doc) => this.toPublic(doc));

        return {
          success: true,
          tenantId,
          personaId,
          count: items.length,
          total: docs.length,
          offset,
          limit,
          items,
        };
      },
    },

    markVisible: {
      params: {
        tenantId: { type: 'string', optional: true },
        ids: { type: 'array', min: 1, max: 200, items: 'string' },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const updated = await this.bulkTransition(tenantId, ctx.params.ids, 'visible');
        return {
          success: true,
          count: updated.length,
          items: updated.map((item) => this.toPublic(item)),
        };
      },
    },

    acknowledge: {
      params: {
        tenantId: { type: 'string', optional: true },
        id: { type: 'string', min: 1 },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const updated = await this.transitionById(tenantId, ctx.params.id, 'acknowledged');
        return { success: true, item: this.toPublic(updated) };
      },
    },

    resolveByHitlItem: {
      params: {
        tenantId: { type: 'string', optional: true },
        hitlItemId: { type: 'string', min: 1 },
        resolutionSource: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const hitlItemId = trimString(ctx.params.hitlItemId);
        const docs = await this.getTenantInboxMessages(tenantId);
        const candidates = docs.filter(
          (doc) => doc.hitlItemId === hitlItemId && doc.status !== 'resolved'
        );

        const updatedItems = [];
        for (const doc of candidates) {
          const updated = this.buildTransitionedDoc(doc, 'resolved', {
            resolutionSource: trimString(ctx.params.resolutionSource) || 'hitl-resolved',
          });
          const putResult = await this.db.put(updated);
          updated._rev = putResult.rev;
          updatedItems.push(updated);
        }

        return {
          success: true,
          hitlItemId,
          count: updatedItems.length,
          items: updatedItems.map((item) => this.toPublic(item)),
        };
      },
    },
  },

  methods: {
    resolveTenantId(ctx, providedTenantId) {
      const metaTenantId = trimString(getTenantId(ctx));
      const tenantId = trimString(providedTenantId || metaTenantId || 'default');
      validateTenantId(tenantId);

      if (providedTenantId && metaTenantId && tenantId !== metaTenantId) {
        throw new MoleculerClientError(
          'Cross-tenant persona inbox access is not allowed',
          403,
          'PERSONA_INBOX_TENANT_FORBIDDEN'
        );
      }

      return tenantId;
    },

    assertStatus(status) {
      const normalized = trimString(status);
      if (!MESSAGE_STATUSES.includes(normalized)) {
        throw new MoleculerClientError('Invalid persona inbox status', 422, 'VALIDATION_ERROR');
      }
      return normalized;
    },

    toDocId(tenantId, personaId, idempotencyKey) {
      return `${DOC_PREFIX}${tenantId}:${personaId}:${toHash(idempotencyKey)}`;
    },

    toPublic(doc) {
      const copy = { ...doc };
      delete copy._id;
      delete copy._rev;
      return copy;
    },

    async getTenantInboxMessages(tenantId) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: `${DOC_PREFIX}${tenantId}:`,
        endkey: `${DOC_PREFIX}${tenantId}:\ufff0`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async tryGet(docId) {
      try {
        return await this.db.get(docId);
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },

    async enqueueMessage(tenantId, params = {}) {
      const personaId = trimString(params.personaId);
      if (!personaId) {
        throw new MoleculerClientError('personaId is required', 422, 'VALIDATION_ERROR');
      }

      const idempotencyKey =
        trimString(params.idempotencyKey) ||
        `${tenantId}:${personaId}:${trimString(params.type)}:${trimString(params.hitlItemId)}`;
      const docId = this.toDocId(tenantId, personaId, idempotencyKey);

      const existing = await this.tryGet(docId);
      if (existing) {
        return { item: existing, deduplicated: true };
      }

      const timestamp = nowIso();
      const type = trimString(params.type) || 'hitl-approval';
      const hitlItemId = trimString(params.hitlItemId) || null;
      const title = trimString(params.title) || 'Freigabe erforderlich';
      const summary =
        trimString(params.summary) ||
        (hitlItemId
          ? `Für HITL-Item ${hitlItemId} ist eine menschliche Freigabe erforderlich.`
          : 'Es liegt eine neue proaktive Aufgabe vor.');

      const item = {
        _id: docId,
        id: crypto.randomUUID(),
        type,
        tenantId,
        personaId,
        sessionId: trimString(params.sessionId) || null,
        hitlItemId,
        embedRef: trimString(params.embedRef) || (hitlItemId ? `hitl_item_${hitlItemId}` : null),
        title,
        summary,
        status: 'queued',
        idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
        visibleAt: null,
        acknowledgedAt: null,
        resolvedAt: null,
        resolutionSource: null,
      };

      try {
        const putResult = await this.db.put(item);
        item._rev = putResult.rev;
        return { item, deduplicated: false };
      } catch (error) {
        if (error?.status === 409) {
          const latest = await this.tryGet(docId);
          if (latest) {
            return { item: latest, deduplicated: true };
          }
        }
        throw error;
      }
    },

    buildTransitionedDoc(doc, status, extras = {}) {
      const nextStatus = this.assertStatus(status);
      const timestamp = nowIso();

      const next = {
        ...doc,
        status: nextStatus,
        updatedAt: timestamp,
      };

      if (nextStatus === 'visible' && !next.visibleAt) {
        next.visibleAt = timestamp;
      }

      if (nextStatus === 'acknowledged' && !next.acknowledgedAt) {
        next.acknowledgedAt = timestamp;
      }

      if (nextStatus === 'resolved' && !next.resolvedAt) {
        next.resolvedAt = timestamp;
      }

      if (extras && typeof extras === 'object') {
        Object.assign(next, extras);
      }

      return next;
    },

    async transitionById(tenantId, id, status) {
      const docs = await this.getTenantInboxMessages(tenantId);
      const doc = docs.find((entry) => entry.id === id);
      if (!doc) {
        throw new MoleculerClientError('Persona inbox message not found', 404, 'PERSONA_INBOX_NOT_FOUND');
      }

      const updated = this.buildTransitionedDoc(doc, status);
      const putResult = await this.db.put(updated);
      updated._rev = putResult.rev;
      return updated;
    },

    async bulkTransition(tenantId, ids = [], status) {
      const wanted = new Set(ids.map((id) => trimString(id)).filter(Boolean));
      if (wanted.size === 0) return [];

      const docs = await this.getTenantInboxMessages(tenantId);
      const targets = docs.filter((doc) => wanted.has(doc.id));
      const updated = [];

      for (const doc of targets) {
        const next = this.buildTransitionedDoc(doc, status);
        const putResult = await this.db.put(next);
        next._rev = putResult.rev;
        updated.push(next);
      }

      return updated;
    },
  },
};
