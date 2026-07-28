'use strict';

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, validateTenantId } = require('../src/tenant-context');
const DISPATCH_TYPE_DEFINITIONS = require('../src/notification-dispatch-types.json');

const DOC_PREFIX = 'nd:';
const DISPATCH_STATUSES = Object.freeze([
  'queued',
  'partially_delivered',
  'delivered',
  'failed',
  'unresolved_recipient',
]);
const CHANNEL_STATUSES = Object.freeze(['pending', 'delivered', 'failed', 'skipped']);

function nowIso() {
  return new Date().toISOString();
}

function trimString(value) {
  return String(value || '').trim();
}

function sanitizeError(error) {
  const message = trimString(error?.message || 'notification_dispatch_failed');
  return message.replace(/\s+/g, ' ').slice(0, 240);
}

function getDispatchTypeDefinition(dispatchType) {
  const normalized = trimString(dispatchType) || 'internal';
  return DISPATCH_TYPE_DEFINITIONS[normalized] || DISPATCH_TYPE_DEFINITIONS.internal;
}

function renderTemplate(template, payload = {}) {
  const text = trimString(template);
  if (!text) return '';
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => trimString(payload[key]));
}

function buildInboxSummary(
  payload = {},
  definition = getDispatchTypeDefinition(payload?.dispatchType)
) {
  const inbox = definition?.inbox || {};
  const title = trimString(inbox.title) || 'Freigabe erforderlich';
  const summary = renderTemplate(inbox.summary, payload);
  return {
    title,
    summary: summary || 'Es liegt eine neue proaktive Aufgabe vor.',
  };
}

function toHash(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex')
    .slice(0, 24);
}

module.exports = {
  name: 'notification',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'NOTIFICATION_DB_PATH',
      defaultDbPath: './data/notifications',
      indexes: [['tenantId'], ['status']],
    }),
  ],

  actions: {
    dispatchHitlApproval: {
      params: {
        tenantId: { type: 'string', optional: true },
        hitlItemId: { type: 'string', min: 1 },
        personaId: { type: 'string', optional: true },
        responsibleRole: { type: 'string', optional: true },
        routingContext: { type: 'object', optional: true, default: {} },
        embedRef: { type: 'string', optional: true },
        sourceService: { type: 'string', optional: true, default: 'hitl' },
        sourceAction: { type: 'string', optional: true, default: 'create' },
        idempotencyKey: { type: 'string', optional: true },
      },
      async handler(ctx) {
        return this.dispatchCore(ctx, {
          dispatchType: 'hitl_approval',
          ...ctx.params,
        });
      },
    },

    dispatch: {
      params: {
        dispatchType: { type: 'string', optional: true, default: 'internal' },
        tenantId: { type: 'string', optional: true },
        hitlItemId: { type: 'string', min: 1, optional: true },
        evidenceRequirementId: { type: 'string', min: 1, optional: true },
        originSessionId: { type: 'string', min: 1, optional: true },
        revalidationStatus: { type: 'string', optional: true },
        personaId: { type: 'string', optional: true },
        responsibleRole: { type: 'string', optional: true },
        routingContext: { type: 'object', optional: true, default: {} },
        embedRef: { type: 'string', optional: true },
        sourceService: { type: 'string', optional: true, default: 'unknown' },
        sourceAction: { type: 'string', optional: true, default: 'unknown' },
        idempotencyKey: { type: 'string', optional: true },
      },
      async handler(ctx) {
        return this.dispatchCore(ctx, ctx.params);
      },
    },

    getDispatch: {
      params: {
        id: { type: 'string', min: 1 },
        tenantId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const dispatch = await this.getDispatchOrThrow(ctx.params.id, tenantId);
        return { success: true, dispatch: this.toPublic(dispatch) };
      },
    },

    listDispatches: {
      params: {
        tenantId: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        hitlItemId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50, min: 1, max: 200 },
        offset: { type: 'number', optional: true, convert: true, default: 0, min: 0 },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const status = trimString(ctx.params.status);
        const hitlItemId = trimString(ctx.params.hitlItemId);

        let docs = await this.getTenantDispatches(tenantId);
        if (status) {
          docs = docs.filter((doc) => doc.status === status);
        }
        if (hitlItemId) {
          docs = docs.filter((doc) => doc.payload?.hitlItemId === hitlItemId);
        }

        docs.sort((left, right) =>
          String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
        );

        const offset = Number(ctx.params.offset || 0);
        const limit = Number(ctx.params.limit || 50);
        const items = docs.slice(offset, offset + limit).map((doc) => this.toPublic(doc));

        return {
          success: true,
          count: items.length,
          total: docs.length,
          offset,
          limit,
          items,
        };
      },
    },

    retryDispatch: {
      params: {
        id: { type: 'string', min: 1 },
        tenantId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const existing = await this.getDispatchOrThrow(ctx.params.id, tenantId);
        const retried = await this.retryDispatchRecord(ctx, existing, tenantId);
        return { success: true, dispatch: this.toPublic(retried) };
      },
    },

    markChannelDelivered: {
      params: {
        id: { type: 'string', min: 1 },
        channelId: { type: 'string', min: 1 },
        tenantId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const existing = await this.getDispatchOrThrow(ctx.params.id, tenantId);
        const updated = await this.updateChannelStatus(
          existing,
          ctx.params.channelId,
          'delivered',
          null
        );
        return { success: true, dispatch: this.toPublic(updated) };
      },
    },

    markChannelFailed: {
      params: {
        id: { type: 'string', min: 1 },
        channelId: { type: 'string', min: 1 },
        tenantId: { type: 'string', optional: true },
        error: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantId(ctx, ctx.params.tenantId);
        const existing = await this.getDispatchOrThrow(ctx.params.id, tenantId);
        const updated = await this.updateChannelStatus(
          existing,
          ctx.params.channelId,
          'failed',
          trimString(ctx.params.error)
        );
        return { success: true, dispatch: this.toPublic(updated) };
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
          'Cross-tenant notification access is not allowed',
          403,
          'NOTIFICATION_TENANT_FORBIDDEN'
        );
      }
      return tenantId;
    },

    toPublic(doc) {
      const copy = { ...doc };
      delete copy._id;
      delete copy._rev;
      return copy;
    },

    toDocId(tenantId, idempotencyKey) {
      return `${DOC_PREFIX}${tenantId}:${toHash(idempotencyKey)}`;
    },

    buildPayload(tenantId, params = {}) {
      const dispatchType = trimString(params.dispatchType) || 'internal';
      const definition = getDispatchTypeDefinition(dispatchType);
      const hitlItemId = trimString(params.hitlItemId) || null;
      const evidenceRequirementId = trimString(params.evidenceRequirementId) || null;
      const originSessionId = trimString(params.originSessionId) || null;

      if (definition.requiresHitlItem && !hitlItemId) {
        throw new MoleculerClientError('hitlItemId is required', 422, 'VALIDATION_ERROR');
      }

      if (definition.requiresEvidenceRequirement && !evidenceRequirementId) {
        throw new MoleculerClientError(
          'evidenceRequirementId is required',
          422,
          'VALIDATION_ERROR'
        );
      }

      const personaId = trimString(params.personaId) || null;
      const responsibleRole = trimString(params.responsibleRole) || null;
      const embedRef =
        trimString(params.embedRef) ||
        (hitlItemId
          ? `hitl_item_${hitlItemId}`
          : evidenceRequirementId
            ? `evidence_requirement_${toHash(evidenceRequirementId)}`
            : null);

      return {
        tenantId,
        dispatchType,
        hitlItemId,
        evidenceRequirementId,
        originSessionId,
        revalidationStatus: trimString(params.revalidationStatus) || null,
        personaId,
        responsibleRole,
        routingContext:
          params.routingContext && typeof params.routingContext === 'object'
            ? params.routingContext
            : null,
        embedRef,
        sourceService: trimString(params.sourceService) || 'unknown',
        sourceAction: trimString(params.sourceAction) || 'unknown',
      };
    },

    buildIdempotencyKey(payload, providedKey) {
      const explicit = trimString(providedKey);
      if (explicit) return explicit;
      const recipientPart = payload.personaId || payload.responsibleRole || 'unknown';
      const subjectPart =
        payload.hitlItemId ||
        payload.evidenceRequirementId ||
        payload.originSessionId ||
        payload.dispatchType ||
        'unknown';
      return `${payload.tenantId}:${payload.dispatchType}:${subjectPart}:${recipientPart}`;
    },

    async getTenantDispatches(tenantId) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: `${DOC_PREFIX}${tenantId}:`,
        endkey: `${DOC_PREFIX}${tenantId}:\ufff0`,
      });
      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async getDispatchOrThrow(id, tenantId) {
      const docs = await this.getTenantDispatches(tenantId);
      const found = docs.find((doc) => doc.id === id);
      if (!found) {
        throw new MoleculerClientError(
          'Notification dispatch not found',
          404,
          'NOTIFICATION_DISPATCH_NOT_FOUND'
        );
      }
      return found;
    },

    async resolvePersonaById(ctx, tenantId, personaId) {
      try {
        const result = await ctx.call(
          'agent-persona.get',
          { tenantId, id: personaId },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );
        return result?.item || null;
      } catch (error) {
        if (
          error?.code === 404 ||
          error?.type === 'PERSONA_NOT_FOUND' ||
          error?.type === 'PERSONA_TENANT_FORBIDDEN'
        ) {
          return null;
        }
        throw error;
      }
    },

    async resolvePersonaByRole(ctx, tenantId, role) {
      try {
        const result = await ctx.call(
          'agent-persona.resolveByRole',
          { tenantId, role },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );
        const items = Array.isArray(result?.items) ? result.items : [];
        return items.find((item) => item && item.status === 'active') || null;
      } catch (error) {
        if (
          error?.code === 404 ||
          error?.type === 'PERSONA_NOT_FOUND' ||
          error?.type === 'PERSONA_TENANT_FORBIDDEN'
        ) {
          return null;
        }
        throw error;
      }
    },

    async resolveRecipient(ctx, tenantId, payload) {
      if (payload.personaId) {
        const persona = await this.resolvePersonaById(ctx, tenantId, payload.personaId);
        if (persona?.status === 'active') {
          return { persona, source: 'personaId', warnings: [] };
        }

        return {
          persona: null,
          source: 'personaId',
          warnings: ['recipient_unresolved'],
        };
      }

      if (payload.responsibleRole) {
        const persona = await this.resolvePersonaByRole(ctx, tenantId, payload.responsibleRole);
        if (persona?.status === 'active') {
          return { persona, source: 'responsibleRole', warnings: [] };
        }

        return {
          persona: null,
          source: 'responsibleRole',
          warnings: ['recipient_unresolved'],
        };
      }

      return {
        persona: null,
        source: 'none',
        warnings: ['recipient_unresolved'],
      };
    },

    buildInitialChannels(persona, dispatchId, timestamp) {
      const channels = [];
      const configured = Array.isArray(persona?.communicationChannels)
        ? persona.communicationChannels
        : [];

      for (const [index, channel] of configured.entries()) {
        const type = trimString(channel?.type);
        const address = trimString(channel?.address);
        if (!type || !address) continue;

        channels.push({
          channelId: `${dispatchId}:ch:${index + 1}`,
          type,
          address,
          status: type === 'openclaw-chat' ? 'pending' : 'skipped',
          attemptCount: 0,
          queuedAt: timestamp,
          deliveredAt: null,
          failedAt: null,
          lastAttemptAt: null,
          error: null,
        });
      }

      if (channels.length === 0 && trimString(persona?.defaultPersonalAgentSessionId)) {
        channels.push({
          channelId: `${dispatchId}:ch:1`,
          type: 'openclaw-chat',
          address: trimString(persona.defaultPersonalAgentSessionId),
          status: 'pending',
          attemptCount: 0,
          queuedAt: timestamp,
          deliveredAt: null,
          failedAt: null,
          lastAttemptAt: null,
          error: null,
        });
      }

      return channels;
    },

    computeDispatchStatus(channels = [], recipientResolved = true) {
      if (!recipientResolved) return 'unresolved_recipient';

      const delivered = channels.filter((channel) => channel.status === 'delivered').length;
      const pending = channels.filter((channel) => channel.status === 'pending').length;
      const failed = channels.filter((channel) => channel.status === 'failed').length;

      if (delivered > 0 && pending === 0 && failed === 0) return 'delivered';
      if (delivered > 0 && (pending > 0 || failed > 0)) return 'partially_delivered';
      if (delivered === 0 && pending > 0) return 'queued';
      if (delivered === 0 && pending === 0 && failed > 0) return 'failed';
      return 'failed';
    },

    async buildDispatchRecord(ctx, tenantId, params = {}, dispatchType = 'internal') {
      const payload = this.buildPayload(tenantId, params);
      const idempotencyKey = this.buildIdempotencyKey(payload, params.idempotencyKey);
      const docId = this.toDocId(tenantId, idempotencyKey);

      const existing = await this.tryGetByDocId(docId);
      if (existing) {
        return { doc: existing, deduplicated: true };
      }

      const timestamp = nowIso();
      const dispatchId = crypto.randomUUID();
      const recipient = await this.resolveRecipient(ctx, tenantId, payload);

      const channels = recipient.persona
        ? this.buildInitialChannels(recipient.persona, dispatchId, timestamp)
        : [];

      const inboxHandoff = await this.dispatchPersonaInboxHandoff(
        ctx,
        tenantId,
        recipient.persona,
        payload,
        idempotencyKey
      );

      const status = this.computeDispatchStatus(channels, Boolean(recipient.persona));
      const warnings = [...(recipient.warnings || []), ...(inboxHandoff?.warnings || [])];
      const doc = {
        _id: docId,
        id: dispatchId,
        type: 'notification-dispatch',
        dispatchType,
        tenantId,
        idempotencyKey,
        payload,
        status,
        recipient: recipient.persona
          ? {
              source: recipient.source,
              personaId: recipient.persona.id,
              personaName: recipient.persona.personaName || null,
              personaType: recipient.persona.personaType || null,
            }
          : {
              source: recipient.source,
              personaId: null,
              personaName: null,
              personaType: null,
            },
        channels,
        inboxHandoff,
        warnings,
        attemptCount: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastAttemptAt: timestamp,
      };

      try {
        const putResult = await this.db.put(doc);
        doc._rev = putResult.rev;
        return { doc, deduplicated: false };
      } catch (error) {
        if (error?.status === 409) {
          const latest = await this.tryGetByDocId(docId);
          if (latest) {
            return { doc: latest, deduplicated: true };
          }
        }
        throw error;
      }
    },

    async tryGetByDocId(docId) {
      try {
        return await this.db.get(docId);
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },

    async dispatchCore(ctx, params = {}) {
      const tenantId = this.resolveTenantId(ctx, params.tenantId);
      const { doc, deduplicated } = await this.buildDispatchRecord(
        ctx,
        tenantId,
        params,
        trimString(params.dispatchType) || 'internal'
      );
      return { success: true, deduplicated, dispatch: this.toPublic(doc) };
    },

    async retryDispatchRecord(ctx, existing, tenantId) {
      const timestamp = nowIso();
      const updated = {
        ...existing,
        attemptCount: Number(existing.attemptCount || 0) + 1,
        updatedAt: timestamp,
        lastAttemptAt: timestamp,
      };

      const recipient = await this.resolveRecipient(ctx, tenantId, existing.payload || {});
      updated.recipient = recipient.persona
        ? {
            source: recipient.source,
            personaId: recipient.persona.id,
            personaName: recipient.persona.personaName || null,
            personaType: recipient.persona.personaType || null,
          }
        : {
            source: recipient.source,
            personaId: null,
            personaName: null,
            personaType: null,
          };
      updated.channels = recipient.persona
        ? this.buildInitialChannels(recipient.persona, existing.id, timestamp)
        : [];
      const inboxHandoff = await this.dispatchPersonaInboxHandoff(
        ctx,
        tenantId,
        recipient.persona,
        existing.payload || {},
        existing.idempotencyKey || ''
      );
      updated.inboxHandoff = inboxHandoff;
      updated.warnings = [...(recipient.warnings || []), ...(inboxHandoff?.warnings || [])];
      updated.status = this.computeDispatchStatus(updated.channels, Boolean(recipient.persona));

      const putResult = await this.db.put(updated);
      updated._rev = putResult.rev;
      return updated;
    },

    async dispatchPersonaInboxHandoff(ctx, tenantId, persona, payload, idempotencyKey) {
      if (!persona?.id) {
        return {
          messageId: null,
          status: 'skipped',
          queuedAt: null,
          warnings: [],
        };
      }

      const definition = getDispatchTypeDefinition(payload?.dispatchType);
      const inboxPayload = buildInboxSummary(payload, definition);
      const inboxConfig = definition?.inbox || {};
      const sessionId =
        inboxConfig.targetSession === 'originSession'
          ? trimString(payload?.originSessionId) ||
            trimString(persona?.defaultPersonalAgentSessionId) ||
            null
          : trimString(persona?.defaultPersonalAgentSessionId) || null;

      try {
        const response = await ctx.call(
          'persona-inbox.enqueue',
          {
            tenantId,
            personaId: persona.id,
            sessionId,
            type: trimString(inboxConfig.type) || 'hitl-approval',
            hitlItemId: payload?.hitlItemId || null,
            embedRef: payload?.embedRef || null,
            title: inboxPayload.title,
            summary: inboxPayload.summary,
            idempotencyKey: `${idempotencyKey}:persona-inbox`,
          },
          { meta: { ...ctx.meta, tenantId, $gateway: false } }
        );

        return {
          messageId: response?.item?.id || null,
          status: response?.item?.status || 'queued',
          queuedAt: response?.item?.createdAt || nowIso(),
          warnings: [],
        };
      } catch (error) {
        if (
          error?.code === 404 ||
          error?.type === 'SERVICE_NOT_FOUND' ||
          error?.type === 'SERVICE_NOT_AVAILABLE'
        ) {
          return {
            messageId: null,
            status: 'failed',
            queuedAt: null,
            warnings: ['persona_inbox_unavailable'],
          };
        }

        this.logger.warn(
          `[notification] persona inbox handoff failed for ${payload?.hitlItemId || 'unknown'}: ${sanitizeError(error)}`
        );
        return {
          messageId: null,
          status: 'failed',
          queuedAt: null,
          warnings: ['persona_inbox_handoff_failed'],
        };
      }
    },

    assertChannelStatus(status) {
      if (!CHANNEL_STATUSES.includes(status)) {
        throw new MoleculerClientError('Invalid channel status', 422, 'VALIDATION_ERROR');
      }
    },

    assertDispatchStatus(status) {
      if (!DISPATCH_STATUSES.includes(status)) {
        throw new MoleculerClientError('Invalid dispatch status', 422, 'VALIDATION_ERROR');
      }
    },

    async updateChannelStatus(existing, channelId, status, errorMessage) {
      this.assertChannelStatus(status);
      const timestamp = nowIso();
      const channels = Array.isArray(existing.channels) ? [...existing.channels] : [];
      const index = channels.findIndex((channel) => channel.channelId === channelId);
      if (index < 0) {
        throw new MoleculerClientError(
          'Notification channel not found',
          404,
          'NOTIFICATION_CHANNEL_NOT_FOUND'
        );
      }

      const previous = channels[index];
      const next = {
        ...previous,
        status,
        attemptCount: Number(previous.attemptCount || 0) + 1,
        lastAttemptAt: timestamp,
        error: status === 'failed' ? sanitizeError({ message: errorMessage }) : null,
        deliveredAt: status === 'delivered' ? timestamp : previous.deliveredAt || null,
        failedAt: status === 'failed' ? timestamp : previous.failedAt || null,
      };
      channels[index] = next;

      const updated = {
        ...existing,
        channels,
        attemptCount: Number(existing.attemptCount || 0) + 1,
        updatedAt: timestamp,
        lastAttemptAt: timestamp,
      };
      updated.status = this.computeDispatchStatus(channels, Boolean(updated.recipient?.personaId));
      this.assertDispatchStatus(updated.status);

      const putResult = await this.db.put(updated);
      updated._rev = putResult.rev;
      return updated;
    },
  },
};
