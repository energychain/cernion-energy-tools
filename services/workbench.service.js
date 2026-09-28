'use strict';

const crypto = require('crypto');
const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { WorkbenchStore } = require('../src/workbench-store');
const {
  cleanString,
  normalizeClient,
  normalizeConversationRef,
  normalizeTaskEnvelope,
  workbenchOpenApi,
} = require('../src/workbench-contract');
const { presentCase, presentCaseListItem } = require('../src/workbench-case-presenter');
const { presentEvent } = require('../src/workbench-event-presenter');
const { normalizeEvidenceInput } = require('../src/workbench-evidence');

const action = (rest, summary, handler, params = {}) => ({
  rest,
  params,
  openapi: workbenchOpenApi(rest, summary, [], params),
  handler,
});
const caseParams = { caseId: { type: 'string', min: 1 } };

module.exports = {
  name: 'workbench',
  mixins: [
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_workbench_conversations',
      dbPathEnvVar: 'CET_WORKBENCH_CONVERSATIONS_DB_PATH',
      dbProperty: 'conversationsDb',
    }),
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_workbench_identity_mappings',
      dbPathEnvVar: 'CET_WORKBENCH_IDENTITY_DB_PATH',
      settingsKey: 'identityDbPath',
      dbProperty: 'identityDb',
    }),
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_workbench_delivery_clients',
      dbPathEnvVar: 'CET_WORKBENCH_DELIVERY_DB_PATH',
      settingsKey: 'deliveryDbPath',
      dbProperty: 'deliveryDb',
    }),
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_workbench_evidence',
      dbPathEnvVar: 'CET_WORKBENCH_EVIDENCE_DB_PATH',
      settingsKey: 'evidenceDbPath',
      dbProperty: 'evidenceDb',
    }),
  ],
  actions: {
    'cases.get': action(
      'GET /cases/:caseId',
      'Return a UI-safe CET case summary for Workbench clients',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await ctx.call('domain-router.explain', {
          cetCaseId: ctx.params.caseId,
        });
        const full = await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const evidenceRefs = ctx.params.includeEvidence
          ? await this.store.listEvidence({ tenantId: p.tenantId, caseId: ctx.params.caseId })
          : [];
        return presentCase(
          { ...full, lastClassification: state },
          {
            evidenceRefs,
            eventSummary: await this.eventSummary(p, ctx.params.caseId),
          }
        );
      },
      caseParams
    ),
    'cases.list': action(
      'GET /cases',
      'Return UI-safe Workbench case inbox items',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const states = await ctx
          .call('domain-router.related-sessions.discover', {
            caseId: ctx.params.caseId || ctx.params.cetCaseId || '__none__',
          })
          .catch(() => null);
        void states;
        const items = [];
        for (const state of await this.visibleDomainStates(p)) {
          const summary = await this.eventSummary(p, state.cetCaseId);
          if (ctx.params.status && presentCaseListItem(state, summary).status !== ctx.params.status)
            continue;
          if (ctx.params.domain && state.currentDomain !== ctx.params.domain) continue;
          if (
            ctx.params.readinessState &&
            state.lastClassification?.readinessState !== ctx.params.readinessState
          )
            continue;
          items.push(presentCaseListItem(state, summary));
        }
        items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const limit = Number(ctx.params.limit || 50);
        return { items: items.slice(0, limit), nextCursor: null };
      },
      {
        status: { type: 'string', optional: true },
        domain: { type: 'string', optional: true },
        readinessState: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, integer: true, min: 1, max: 100 },
      }
    ),
    'conversations.linkCase': action(
      'POST /conversations/link-case',
      'Link an Open WebUI conversation to a CET case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const ref = normalizeConversationRef(ctx.params);
        const caseId = cleanString(ctx.params.caseId || ctx.params.cetCaseId, 'caseId', {
          required: true,
        });
        const full = await this.loadVisibleCase(ctx, p, caseId);
        const linked = await this.store.linkConversation({
          tenantId: p.tenantId,
          client: ref.client,
          conversationId: ref.conversationId,
          openWebuiConversationId: ref.openWebuiConversationId,
          openWebuiUserId: ref.openWebuiUserId,
          openWebuiOrgId: ref.openWebuiOrgId,
          cetCaseId: caseId,
          caseStateVersion: full.caseStateVersion,
          clientId: ctx.params.clientId || full.asyncDelivery?.clientId || null,
          overwrite: !!ctx.params.overwrite,
        });
        return { linked: true, conversationRef: this.conversationRef(linked) };
      }
    ),
    'conversations.resolve': action(
      'GET /conversations/resolve',
      'Resolve an Open WebUI conversation to a CET case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const ref = normalizeConversationRef(ctx.params);
        const mapping = await this.store.resolveConversation(
          { tenantId: p.tenantId, client: ref.client, conversationId: ref.conversationId },
          { optional: true }
        );
        if (!mapping) return { found: false };
        return {
          found: true,
          caseId: mapping.cetCaseId,
          cetCaseId: mapping.cetCaseId,
          caseStateVersion: mapping.caseStateVersion,
          status: 'active',
          conversationRef: this.conversationRef(mapping),
        };
      }
    ),
    'events.list': action(
      'GET /events',
      'Return UI-safe pending/delivered CET case events for Workbench clients',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const clientId = cleanString(ctx.params.clientId, 'clientId', { required: true });
        await this.ensureDeliveryClient(p, clientId);
        const response = await ctx.call('domain-router.events.list', {
          clientId,
          caseId: ctx.params.caseId || ctx.params.cetCaseId,
          since: ctx.params.since,
        });
        const items = [];
        for (const event of response.events || []) {
          if (ctx.params.attentionOnly && !event.requiresUserAttention) continue;
          const conversation = await this.findConversationForCase(p.tenantId, event.cetCaseId);
          items.push(presentEvent(event, conversation));
        }
        return { items, nextCursor: null };
      },
      {
        clientId: { type: 'string', min: 1 },
        caseId: { type: 'string', optional: true },
        cetCaseId: { type: 'string', optional: true },
        since: { type: 'string', optional: true },
        attentionOnly: { type: 'boolean', optional: true, convert: true },
      }
    ),
    'events.ack': action(
      'POST /events/:eventId/ack',
      'Acknowledge a Workbench event after visible delivery',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const clientId = cleanString(ctx.params.clientId, 'clientId', { required: true });
        await this.ensureDeliveryClient(p, clientId);
        const event = await ctx.call('domain-router.events.ack', {
          eventId: ctx.params.eventId,
          clientId,
        });
        return presentEvent(event, await this.findConversationForCase(p.tenantId, event.cetCaseId));
      },
      { eventId: 'string', clientId: 'string' }
    ),
    'admin.tenantMappings.create': action(
      'POST /admin/tenant-mappings',
      'Provision an Open WebUI organization to CET tenant mapping',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const cetTenantId = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const mapping = await this.store.saveTenantMapping({
          client,
          externalOrgId: cleanString(ctx.params.externalOrgId, 'externalOrgId', { required: true }),
          cetTenantId,
          defaultClientId: cleanString(ctx.params.defaultClientId, 'defaultClientId'),
          enabled: ctx.params.enabled !== false,
        });
        return { saved: true, mapping };
      }
    ),
    'admin.userMappings.create': action(
      'POST /admin/user-mappings',
      'Provision an Open WebUI user to CET actor and role mapping',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const roles = Array.isArray(ctx.params.roles) ? ctx.params.roles : p.roles;
        const cetTenantId = this.authorizeTargetTenant(
          p,
          cleanString(ctx.params.cetTenantId || p.tenantId, 'cetTenantId', { required: true })
        );
        const mapping = await this.store.saveUserMapping({
          client,
          externalOrgId: cleanString(
            ctx.params.externalOrgId || ctx.params.openWebuiOrgId,
            'externalOrgId',
            {
              required: true,
            }
          ),
          externalUserId: cleanString(
            ctx.params.externalUserId || ctx.params.openWebuiUserId,
            'externalUserId',
            {
              required: true,
            }
          ),
          cetTenantId,
          cetActorId: cleanString(
            ctx.params.cetActorId || ctx.params.actorId || p.actorId,
            'cetActorId',
            {
              required: true,
            }
          ),
          roles,
          sensitivityClearance: ctx.params.sensitivityClearance || p.clearance || [],
          defaultClientId: cleanString(ctx.params.defaultClientId, 'defaultClientId'),
          enabled: ctx.params.enabled !== false,
        });
        return { saved: true, mapping };
      }
    ),
    'admin.userMappings.get': action(
      'GET /admin/user-mappings/:externalUserId',
      'Resolve an Open WebUI user mapping',
      async function (ctx) {
        this.requireAdmin(ctx);
        const client = normalizeClient(ctx.params.client || 'open-webui');
        const mapping = await this.store.getUserMapping({
          client,
          externalOrgId: cleanString(
            ctx.params.externalOrgId || ctx.params.openWebuiOrgId,
            'externalOrgId',
            {
              required: true,
            }
          ),
          externalUserId: cleanString(ctx.params.externalUserId, 'externalUserId', {
            required: true,
          }),
        });
        return { found: true, mapping };
      },
      { externalUserId: 'string' }
    ),
    'deliveryClients.create': action(
      'POST /delivery-clients',
      'Register a tenant-bound Workbench delivery client for MWI polling',
      async function (ctx) {
        const p = this.requireAdmin(ctx);
        const deliveryClient = await this.store.registerDeliveryClient({
          tenantId: p.tenantId,
          clientId: cleanString(ctx.params.clientId, 'clientId', { required: true }),
          clientType: ctx.params.clientType || 'open-webui',
          deliveryMode: ctx.params.deliveryMode || 'poll',
          ackMode: ctx.params.ackMode || 'explicit',
          eventTypes: Array.isArray(ctx.params.eventTypes) ? ctx.params.eventTypes : [],
          enabled: ctx.params.enabled !== false,
        });
        return {
          clientId: deliveryClient.clientId,
          enabled: deliveryClient.enabled,
          pollUrl: `/api/workbench/events?clientId=${encodeURIComponent(deliveryClient.clientId)}`,
          deliveryClient,
        };
      }
    ),
    chat: action(
      'POST /chat',
      'Run a CET-led Workbench chat turn: classify new conversations, continue mapped cases',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const envelope = normalizeTaskEnvelope(ctx.params);
        const mapping = await this.resolveUserMapping(ctx, p, envelope);
        const conversation = await this.store.resolveConversation(
          {
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
          },
          { optional: true }
        );
        const meta = this.metaForMapping(ctx, p, mapping);
        const params = {
          ...envelope,
          requestedMode: conversation ? 'continue' : 'classify',
          ...(conversation ? { cetCaseId: conversation.cetCaseId } : {}),
        };
        const result = await ctx.call(
          conversation ? 'domain-router.continue' : 'domain-router.classify',
          params,
          { meta }
        );
        if (!conversation) {
          await this.store.linkConversation({
            tenantId: p.tenantId,
            client: envelope.channel,
            conversationId: envelope.conversationId,
            openWebuiConversationId: envelope.openWebuiConversationId,
            openWebuiUserId: envelope.openWebuiUserId,
            openWebuiOrgId: envelope.openWebuiOrgId,
            cetCaseId: result.cetCaseId,
            caseStateVersion: result.caseStateVersion,
            clientId: envelope.asyncDelivery.clientId,
          });
        }
        return this.chatResponse(conversation ? 'continue' : 'classify', result);
      }
    ),
    'cases.attachEvidence': action(
      'POST /cases/:caseId/evidence',
      'Attach Open WebUI file references as auditable CET EvidenceRefs',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const evidence = normalizeEvidenceInput(ctx.params);
        const saved = await this.store.saveEvidence({
          ...evidence,
          tenantId: p.tenantId,
          actorId: p.actorId,
          caseId: ctx.params.caseId,
        });
        await ctx.call('domain-router.ingestUpdate', {
          cetCaseId: ctx.params.caseId,
          kind: 'evidence_available',
          version: saved.evidenceId,
          validated: false,
          evidenceRef: saved.evidenceId,
        });
        return {
          evidenceRef: {
            evidenceId: saved.evidenceId,
            caseId: saved.caseId,
            type: saved.evidenceType,
            label: saved.label,
            status: saved.status,
            hash: saved.hash,
            createdAt: saved.createdAt,
          },
          generatedEvents: [{ eventType: 'evidence.available', severity: 'info' }],
        };
      },
      caseParams
    ),
    'cases.dossier': action(
      'POST /cases/:caseId/dossier',
      'Render a Workbench dossier wrapper around the current CET case',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadVisibleCase(ctx, p, ctx.params.caseId);
        const summary = presentCase(state, {
          evidenceRefs: await this.store.listEvidence({
            tenantId: p.tenantId,
            caseId: ctx.params.caseId,
          }),
          eventSummary: await this.eventSummary(p, ctx.params.caseId),
        });
        let content = `# ${summary.title}\n\n${summary.lastResponseText || 'CET case summary.'}`;
        try {
          const dossier = await ctx.call('personal-agent.answerDossier', {
            question: ctx.params.question || summary.title,
            sessionId: ctx.params.sessionId || `workbench:${ctx.params.caseId}`,
            context: { cetCaseId: ctx.params.caseId, workbenchSummary: summary },
          });
          content = dossier?.answer || dossier?.content || content;
        } catch (e) {
          if (![404, 503].includes(e.code) && ![404, 503].includes(e.status)) throw e;
        }
        return {
          caseId: ctx.params.caseId,
          dossierId: `dos_${crypto.randomUUID()}`,
          format: ctx.params.format || 'markdown',
          title: summary.title,
          content,
          evidenceRefs: summary.evidenceRefs,
          noCallGuards: summary.noCallGuards,
          readinessState: summary.readinessState,
          nonBinding: summary.readinessState !== 'ready',
          createdAt: new Date().toISOString(),
        };
      },
      caseParams
    ),
  },
  created() {
    this.store = new WorkbenchStore({
      conversationsDb: this.conversationsDb,
      identityDb: this.identityDb,
      deliveryDb: this.deliveryDb,
      evidenceDb: this.evidenceDb,
    });
  },
  methods: {
    requireAdmin(ctx) {
      const p = principal(ctx, ctx.params);
      if (
        !p.roles.some((r) => ['ROLE_TENANT_ADMIN', 'ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r))
      ) {
        deny('Workbench admin role required');
      }
      return p;
    },
    authorizeTargetTenant(p, targetTenantId) {
      const isPlatformAdmin = p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'].includes(r));
      if (!isPlatformAdmin && targetTenantId !== p.tenantId) {
        deny('Workbench tenant admin cannot provision foreign tenant');
      }
      return targetTenantId;
    },
    metaForMapping(ctx, p, mapping) {
      return {
        ...ctx.meta,
        apiToken: {
          ...(ctx.meta?.apiToken || {}),
          tenantId: p.tenantId,
          id: mapping?.cetActorId || p.actorId,
          roles: mapping?.roles?.length ? mapping.roles : p.roles,
          sensitivityFlags: mapping?.sensitivityClearance || p.clearance || [],
        },
      };
    },
    async resolveUserMapping(ctx, p, envelope) {
      if (!envelope.openWebuiUserId || !envelope.openWebuiOrgId) return null;
      const mapping = await this.store.getUserMapping(
        {
          client: envelope.channel,
          externalOrgId: envelope.openWebuiOrgId,
          externalUserId: envelope.openWebuiUserId,
        },
        { optional: true }
      );
      if (!mapping) {
        throw new Errors.MoleculerClientError(
          'Workbench identity mapping required',
          403,
          'WORKBENCH_MAPPING_REQUIRED'
        );
      }
      if (mapping.cetTenantId !== p.tenantId) deny('Workbench tenant mapping mismatch');
      return mapping;
    },
    conversationRef(mapping) {
      return {
        client: mapping.client,
        conversationId: mapping.externalConversationId,
        openWebuiConversationId: mapping.openWebuiConversationId,
        caseId: mapping.cetCaseId,
        cetCaseId: mapping.cetCaseId,
        caseStateVersion: mapping.caseStateVersion,
      };
    },
    async visibleDomainStates(p) {
      const service = this.broker.getLocalService('domain-router');
      return service ? await service.visibleStates(p) : [];
    },
    async loadVisibleCase(ctx, p, caseId) {
      const service = this.broker.getLocalService('domain-router');
      if (!service) throw new Errors.MoleculerClientError('Domain Router unavailable', 503);
      return service.loadCase(p, caseId);
    },
    async eventSummary(p, caseId) {
      const service = this.broker.getLocalService('domain-router');
      if (!service) return { pending: 0, attention: 0 };
      const rows = await service.eventsDb.allDocs({ include_docs: true });
      const events = rows.rows
        .map((r) => r.doc)
        .filter(
          (e) =>
            e.tenantId === p.tenantId &&
            e.cetCaseId === caseId &&
            ['pending', 'delivered'].includes(e.deliveryState)
        );
      return {
        pending: events.filter((e) => e.deliveryState === 'pending').length,
        attention: events.filter((e) => e.requiresUserAttention).length,
      };
    },
    async findConversationForCase(tenantId, caseId) {
      for (const row of (await this.conversationsDb.allDocs({ include_docs: true })).rows) {
        const doc = row.doc;
        if (doc.tenantId === tenantId && doc.cetCaseId === caseId && doc.enabled !== false)
          return doc;
      }
      return null;
    },
    async ensureDeliveryClient(p, clientId) {
      const registered = await this.store.getDeliveryClient(
        { tenantId: p.tenantId, clientId },
        { optional: true }
      );
      if (!registered) {
        throw new Errors.MoleculerClientError(
          'Workbench delivery client registration required',
          403,
          'WORKBENCH_DELIVERY_CLIENT_REQUIRED'
        );
      }
      return registered;
    },
    chatResponse(usedOperation, result) {
      return {
        caseId: result.cetCaseId,
        cetCaseId: result.cetCaseId,
        caseStateVersion: result.caseStateVersion,
        usedOperation,
        primaryDomain: result.primaryDomain,
        alternativeDomains: result.alternativeDomains || [],
        readinessState: result.readinessState,
        responseText: result.responseText || result.responseGuidance || '',
        requiredClarifications: result.requiredClarifications || [],
        missingEvidence: result.missingEvidence || [],
        noCallGuards: result.noCallGuards || [],
        events: [],
      };
    },
  },
};
