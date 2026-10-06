'use strict';
const { randomUUID } = require('crypto');
const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { classifyDomain, LINK_KEYS } = require('../src/domain-router');
const { evaluateEventTriggers } = require('../src/domain-router-events');
const { principal, visible, authorize, deny } = require('../src/domain-router-policy');
const { tenantNamespace } = require('../src/tenant-context');
const jobStore = require('../src/job-store');
const {
  _internal: { extractHits },
} = require('../src/personal-agent-knowledge-rag');
const { SESSION_NAMESPACE } = require('./personal-agent/shared');

const { taskParams, routerOpenApi } = require('../src/domain-router-contract');
const params = {
  ...taskParams,
  taskEnvelope: { type: 'object', optional: true, props: taskParams },
};
const eventListParams = {
  clientId: { type: 'string', min: 1 },
  since: { type: 'string', optional: true },
  caseId: { type: 'string', optional: true },
  cetCaseId: { type: 'string', optional: true },
};
const action = (rest, summary, handler, extra = {}, baseParams = params) => ({
  rest,
  params: { ...baseParams, ...extra },
  openapi: routerOpenApi(rest, summary),
  handler,
});
const key = (tenant, id) => `${encodeURIComponent(tenant)}:${encodeURIComponent(id)}`;
const KNOWLEDGE_COLLECTIONS = [
  'agentos_stadtwerk_laufkarten_atlas_v1',
  'agentos_stadtwerk_operational_glossary_v1',
  'agentos_stadtwerk_governance_adr_v1',
  'agentos_stadtwerk_broad_governance_v1',
  'agentos_cet_current_state_mapping_v1',
  'agentos_stadtwerk_claim_bridges_v1',
  'agentos_stadtwerk_digital_laufkarten_atlas_v1',
];

module.exports = {
  name: 'domain-router',
  mixins: [
    require('../src/shared-service-case-context'),
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_case_state',
      dbPathEnvVar: 'CET_CASE_STATE_DB_PATH',
    }),
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/cet_case_events',
      dbPathEnvVar: 'CET_CASE_EVENTS_DB_PATH',
      settingsKey: 'eventsDbPath',
      dbProperty: 'eventsDb',
    }),
  ],
  settings: { knowledgeTimeoutMs: 1500 },
  actions: {
    classify: action(
      'POST /classify',
      'Classify a task and persist advisory case state',
      async function (ctx) {
        return this.routeCase(ctx, false);
      }
    ),
    continue: action(
      'POST /continue',
      'Continue, reclassify, branch, clarify, handoff or fall back',
      async function (ctx) {
        return this.routeCase(ctx, true);
      }
    ),
    explain: action(
      'POST /explain',
      'Explain the last persisted routing decision',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadCase(p, ctx.params.cetCaseId || ctx.params.caseId);
        return state.lastClassification;
      }
    ),
    'events.list': action(
      'GET /events',
      'Poll pending and delivered case events until explicit acknowledgement',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        if (!ctx.params.clientId) deny('clientId required');
        const states = await this.visibleStates(p);
        for (const state of states) {
          await this.reconcileJobs(p, state);
          await this.flushEvents(p, state);
        }
        const events = [];
        for (const { doc } of (await this.eventsDb.allDocs({ include_docs: true })).rows) {
          if (
            doc.tenantId !== p.tenantId ||
            doc.targetClient !== ctx.params.clientId ||
            !['pending', 'delivered'].includes(doc.deliveryState)
          )
            continue;
          if (
            (ctx.params.caseId || ctx.params.cetCaseId) &&
            doc.cetCaseId !== (ctx.params.caseId || ctx.params.cetCaseId)
          )
            continue;
          if (ctx.params.since && doc.createdAt < ctx.params.since) continue;
          const state = states.find((s) => s.cetCaseId === doc.cetCaseId);
          if (
            !state ||
            state.asyncDelivery.mode !== 'poll' ||
            state.asyncDelivery.clientId !== doc.targetClient
          )
            continue;
          const delivered = await this.updateEvent(doc._id, (current) => ({
            ...current,
            deliveryState: current.deliveryState === 'acknowledged' ? 'acknowledged' : 'delivered',
          }));
          if (delivered.deliveryState !== 'acknowledged') events.push(delivered);
        }
        return { events };
      },
      {},
      eventListParams
    ),
    'events.ack': action(
      'POST /events/:eventId/ack',
      'Idempotently acknowledge an addressed event',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const event = await this.eventsDb.get(ctx.params.eventId);
        await this.loadCase(p, event.cetCaseId);
        if (event.tenantId !== p.tenantId || event.targetClient !== ctx.params.clientId)
          deny('Event not accessible');
        return this.updateEvent(event._id, (current) => ({
          ...current,
          deliveryState: 'acknowledged',
        }));
      },
      { eventId: 'string', clientId: 'string' }
    ),
    'related-sessions.discover': action(
      'POST /cases/:caseId/related-sessions/discover',
      'Discover authorized cases through process, session and Laufkarten identifiers',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadCase(p, ctx.params.caseId || ctx.params.cetCaseId);
        return this.discover(ctx, p, state);
      }
    ),
    'related-sessions.link': action(
      'POST /cases/:caseId/related-sessions/link',
      'Link two visible cases for evidence delivery',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadCase(p, ctx.params.caseId || ctx.params.cetCaseId);
        const target = await this.loadCase(p, ctx.params.targetCaseId);
        await this.linkCases(p, state, target, 'dependent_evidence');
        return { linked: true, sourceCaseId: state.cetCaseId, targetCaseId: target.cetCaseId };
      },
      { targetCaseId: 'string' }
    ),
    trackJob: {
      visibility: 'protected',
      params: { cetCaseId: 'string', jobId: 'string' },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadCase(p, ctx.params.cetCaseId);
        const job = jobStore.getJob(ctx.params.jobId);
        if (!job || job.tenantId !== p.tenantId) deny('Job tenant mismatch');
        state.pendingJobs = [...new Set([...(state.pendingJobs || []), ctx.params.jobId])];
        state.caseStateVersion++;
        await this.saveState(p, state);
        return { tracked: true };
      },
    },
    // Internal authenticated producers use this action after asynchronous receipt/evidence work.
    ingestUpdate: {
      visibility: 'protected',
      params: {
        cetCaseId: 'string',
        kind: {
          type: 'enum',
          values: [
            'async_result',
            'receipt_complete',
            'receipt_failed',
            'receipt_expired',
            'evidence_available',
            'related_reply',
            'qdrant_process_hit',
          ],
        },
        version: { type: 'string', min: 1 },
        validated: { type: 'boolean', optional: true },
        evidenceRef: { type: 'string', optional: true },
        payloadRef: { type: 'string', optional: true },
        routingSignals: { type: 'array', items: 'string', optional: true },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const state = await this.loadCase(p, ctx.params.cetCaseId);
        await this.recordUpdate(p, state, ctx.params);
        for (const relation of state.relatedCases || []) {
          let target;
          try {
            target = await this.loadCase(p, relation.cetCaseId);
          } catch (e) {
            if (e.code === 403 || e.status === 404) continue;
            throw e;
          }
          await this.recordUpdate(p, target, {
            ...ctx.params,
            sourceCaseId: state.cetCaseId,
            kind: ['receipt_complete', 'evidence_available'].includes(ctx.params.kind)
              ? 'evidence_available'
              : ctx.params.kind === 'qdrant_process_hit'
                ? ctx.params.kind
                : 'related_reply',
          });
        }
        return { accepted: true };
      },
    },
  },
  events: {
    'domain-router.evidence.updated': {
      async handler(ctx) {
        await ctx.call('domain-router.ingestUpdate', ctx.params);
      },
    },
    'domain-router.receipt.updated': {
      async handler(ctx) {
        await ctx.call('domain-router.ingestUpdate', ctx.params);
      },
    },
  },
  started() {
    this.jobTimer = setInterval(() => {
      if (this.jobSweep) return;
      this.jobSweep = this.sweepJobs()
        .catch((e) => this.logger.warn('Router job reconciliation deferred', e.message))
        .finally(() => {
          this.jobSweep = null;
        });
    }, 5000);
    this.jobTimer.unref();
  },
  async stopped() {
    clearInterval(this.jobTimer);
    if (this.jobSweep) await this.jobSweep;
  },
  methods: {
    async sweepJobs() {
      for (const { doc } of (await this.db.allDocs({ include_docs: true })).rows) {
        if (!doc.pendingJobs?.length) continue;
        // Minimal policy snapshot from an authenticated case, never bearer credentials.
        await this.reconcileJobs(
          {
            tenantId: doc.tenantId,
            actorId: doc.actorId,
            roles: doc.accessRoles,
            clearance: doc.sensitivityFlags,
          },
          doc
        );
      }
    },
    async reconcileJobs(p, state) {
      for (const jobId of state.pendingJobs || []) {
        const job = jobStore.getJob(jobId);
        if (!job || job.tenantId !== p.tenantId || !['completed', 'error'].includes(job.status))
          continue;
        await this.recordUpdate(p, state, {
          kind: job.status === 'completed' ? 'async_result' : 'receipt_failed',
          version: `${jobId}:${job.status}`,
          payloadRef: `/api/jobs/${jobId}/result`,
        });
        for (const relation of state.relatedCases || []) {
          const target = await this.db.get(key(p.tenantId, relation.cetCaseId));
          if (visible(p, target))
            await this.recordUpdate(p, target, {
              kind: 'related_reply',
              version: `${jobId}:${job.status}`,
              sourceCaseId: state.cetCaseId,
              payloadRef: `/api/jobs/${jobId}/result`,
            });
        }
        state.pendingJobs = state.pendingJobs.filter((id) => id !== jobId);
        await this.saveState(p, state);
      }
    },
    async loadCase(p, id) {
      if (!id) throw new Errors.MoleculerClientError('cetCaseId required', 422);
      const state = await this.db.get(key(p.tenantId, id));
      authorize(p, state);
      return state;
    },
    async visibleStates(p) {
      return (await this.db.allDocs({ include_docs: true })).rows
        .map((r) => r.doc)
        .filter((s) => s.cetCaseId && visible(p, s));
    },
    async saveState(p, state) {
      authorize(p, state);
      state.lastClassification.caseStateVersion = state.caseStateVersion;
      state.lastClassification.nextState = {
        cetCaseId: state.cetCaseId,
        currentDomain: state.currentDomain,
        caseStateVersion: state.caseStateVersion,
      };
      const saved = await this.db.put(state);
      state._rev = saved.rev;
      await this.flushEvents(p, state);
      return state;
    },
    async flushEvents(p, state) {
      authorize(p, state);
      if (state.asyncDelivery.mode !== 'poll' || !state.asyncDelivery.clientId) return;
      for (const intent of state.eventIntents || []) {
        if (
          state.asyncDelivery.supportedEventTypes?.length &&
          !state.asyncDelivery.supportedEventTypes.includes(intent.eventType)
        )
          continue;
        const now = state.updatedAt;
        const event = {
          _id: intent.eventId,
          ...intent,
          tenantId: state.tenantId,
          cetCaseId: state.cetCaseId,
          targetCaseId: state.cetCaseId,
          conversationId: state.conversationId,
          agentSessionId: state.agentSessionId,
          targetClient: state.asyncDelivery.clientId,
          severity: /required|blocked/.test(intent.eventType) ? 'attention' : 'info',
          requiresUserAttention: /required|blocked/.test(intent.eventType),
          payloadSummary: intent.eventType,
          deliveryState: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        try {
          await this.eventsDb.put(event);
        } catch (e) {
          if (e.status !== 409) throw e;
        }
      }
    },
    async updateEvent(id, change) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await this.eventsDb.get(id);
        const next = change(current);
        if (current.deliveryState === next.deliveryState) return current;
        next.updatedAt = new Date().toISOString();
        try {
          const saved = await this.eventsDb.put(next);
          return { ...next, _rev: saved.rev };
        } catch (e) {
          if (e.status !== 409 || attempt === 4) throw e;
        }
      }
    },
    async routeCase(ctx, continuing) {
      const input = { ...(ctx.params.taskEnvelope || ctx.params) };
      const p = principal(ctx, input);
      if (
        typeof input.userRequest !== 'string' ||
        input.userRequest.trim().length < 3 ||
        input.userRequest.length > 8000
      )
        throw new Errors.MoleculerClientError('userRequest must contain 3–8000 characters', 422);
      if (input.schemaVersion && input.schemaVersion !== '1.1')
        throw new Errors.MoleculerClientError('Unsupported Task Envelope version', 422);
      const previous = input.cetCaseId ? await this.loadCase(p, input.cetCaseId) : null;
      if (continuing && !previous)
        throw new Errors.MoleculerClientError('Continue requires cetCaseId', 422);
      if (
        input.caseStateVersion !== undefined &&
        input.caseStateVersion !== previous?.caseStateVersion
      )
        throw new Errors.MoleculerClientError('Case version conflict', 409);
      input.knownContext = { ...previous?.knownContext, ...input.knownContext };
      for (const k of LINK_KEYS) if (input[k]) input.knownContext[k] = input[k];
      input.actorRoles = p.roles;
      input.actorId = p.actorId;
      input.tenantId = p.tenantId;
      const classification = await classifyDomain(input, {
        previousState: previous,
        validatedEvidence: previous?.validatedEvidence || [],
        recommend: (i) =>
          ctx.call(
            'capability-broker.recommend',
            {
              task: i.userRequest,
              knownContext: i.knownContext,
              agentRole: p.roles[0],
              primaryDomain: i.primaryDomain,
            },
            { timeout: 5000 }
          ),
        selectReceipts: (i) =>
          ctx.call(
            'agent-receipts.select',
            {
              question: i.userRequest,
              knownContext: i.knownContext,
              context: { tenantId: p.tenantId },
              forceReceipt: i.forceReceipt,
              preferredReceipts: i.preferredReceipts || [],
              disableReceiptSelection: !!i.disableReceiptSelection,
              explainReceiptSelection: true,
              includeEvaluation: true,
            },
            { timeout: 5000 }
          ),
        knowledge: (i) => this.knowledgeHints(ctx, p, i),
      });
      const id = previous?.cetCaseId || randomUUID();
      const asyncDelivery = input.asyncDelivery || previous?.asyncDelivery || { mode: 'none' };
      if (
        !['none', 'poll'].includes(asyncDelivery.mode) ||
        (asyncDelivery.mode === 'poll' && !asyncDelivery.clientId)
      )
        throw new Errors.MoleculerClientError(
          'Only none or poll with clientId delivery is supported',
          422
        );
      if (previous && asyncDelivery.clientId !== previous.asyncDelivery.clientId)
        deny('Delivery client is immutable');
      const state = {
        ...previous,
        _id: key(p.tenantId, id),
        cetCaseId: id,
        tenantId: p.tenantId,
        actorId: previous?.actorId || p.actorId,
        accessRoles: previous?.accessRoles || p.roles,
        sharedWithRoles:
          previous?.sharedWithRoles ||
          (input.sharedWithRoles || []).filter((r) => p.roles.includes(r)),
        sensitivityFlags: [
          ...new Set([...(previous?.sensitivityFlags || []), ...(input.sensitivityFlags || [])]),
        ],
        caseStateVersion: (previous?.caseStateVersion || 0) + 1,
        currentDomain: classification.primaryDomain,
        initialRequest: previous?.initialRequest || input.userRequest,
        conversationId: input.conversationId || previous?.conversationId || null,
        agentSessionId: input.agentSessionId || previous?.agentSessionId || null,
        knownContext: input.knownContext,
        asyncDelivery,
        domainHistory: [
          ...(previous?.domainHistory || []),
          { domain: classification.primaryDomain, transition: classification.transition.type },
        ],
        branchStates: previous?.branchStates || [],
        relatedCases: previous?.relatedCases || [],
        lastClassification: classification,
        activeReceiptIds: classification.selectedReceipts,
        activeCapabilityIds: classification.selectedCapabilities.map((c) => c.capability),
        knowledgeRefs: classification.knowledgeRefs,
        openClarifications: classification.requiredClarifications,
        lastTransition: classification.transition,
        updatedAt: new Date().toISOString(),
        identifiers: {
          ...previous?.identifiers,
          ...Object.fromEntries(
            LINK_KEYS.map((k) => [
              k,
              input[k] || input.knownContext[k] || previous?.identifiers?.[k],
            ]).filter(([, v]) => v)
          ),
        },
      };
      state.identifiers.cetCaseId = id;
      classification.cetCaseId = id;
      classification.caseStateVersion = state.caseStateVersion;
      classification.nextState = {
        cetCaseId: id,
        currentDomain: state.currentDomain,
        caseStateVersion: state.caseStateVersion,
      };
      state.eventIntents = [
        ...(previous?.eventIntents || []),
        ...evaluateEventTriggers(previous, state),
      ];
      await this.saveState(p, state);
      if (classification.transition.type === 'branch') await this.createBranch(p, state);
      await this.discover(ctx, p, state);
      return state.lastClassification;
    },
    async knowledgeHints(ctx, p, input) {
      const requested = input.knownContext.knowledgeCollection;
      const collection = requested || KNOWLEDGE_COLLECTIONS[0];
      if (!KNOWLEDGE_COLLECTIONS.includes(collection))
        throw new Errors.MoleculerClientError('Knowledge collection not approved', 403);
      const result = await ctx.call(
        'knowledge-rag.query',
        {
          query: input.userRequest,
          collection,
          limit: 5,
          withPayload: true,
          filter: {
            must: [
              { key: 'metadata.tenantId', match: { value: p.tenantId } },
              { key: 'metadata.status', match: { value: 'approved' } },
              { key: 'metadata.sensitivity', match: { value: 'public' } },
            ],
          },
        },
        { timeout: this.settings.knowledgeTimeoutMs, meta: { ...ctx.meta, $gateway: false } }
      );
      const hits = extractHits(result);
      return {
        refs: hits
          .filter((h) => {
            const m = h.payload?.metadata || h.metadata || {};
            return (
              m.tenantId === p.tenantId && m.status === 'approved' && m.sensitivity === 'public'
            );
          })
          .map((h) => {
            const m = h.payload?.metadata || h.metadata;
            return {
              id: h.id,
              collection,
              domain: m.domain,
              processRef: m.processRef,
              laufkarteId: m.laufkarteId,
              stationId: m.stationId,
              controlPoint: m.controlPoint,
              source: 'unverified_routing_hint',
            };
          }),
      };
    },
    async recordUpdate(p, state, update) {
      const previous = JSON.parse(JSON.stringify(state));
      if (
        update.validated === true &&
        update.evidenceRef &&
        ['evidence_available', 'receipt_complete'].includes(update.kind)
      ) {
        state.validatedEvidence = [
          ...new Set([...(state.validatedEvidence || []), update.evidenceRef]),
        ];
        const c = state.lastClassification;
        c.missingEvidence = c.missingEvidence.filter(
          (e) => ![update.evidenceRef, 'validated_process_evidence'].includes(e)
        );
        c.evidenceRequirements = c.missingEvidence;
        c.readinessState = c.missingEvidence.length ? 'evidence_required' : 'human_review_required';
      }
      if (
        Array.isArray(update.routingSignals) &&
        update.routingSignals.length &&
        state.lastClassification
      ) {
        const signalDomains = [];
        if (update.routingSignals.includes('market_communication'))
          signalDomains.push('market_communication');
        if (
          update.routingSignals.includes('market_master_data') ||
          update.routingSignals.includes('utilmd')
        ) {
          signalDomains.push('market_master_data');
        }
        if (update.routingSignals.includes('mscons')) signalDomains.push('edm');
        if (signalDomains.length) {
          const c = state.lastClassification;
          c.routingSignals = [...new Set([...(c.routingSignals || []), ...update.routingSignals])];
          c.matchedSignals = [
            ...(c.matchedSignals || []),
            ...update.routingSignals.map((signal) => ({
              domain: signalDomains[0],
              score: signal === 'aperak_z18' ? 20 : 10,
              source: 'evidence_extract',
              ref: signal,
            })),
          ];
          for (const domain of signalDomains) {
            if (domain === c.primaryDomain) continue;
            if (!(c.alternativeDomains || []).some((d) => d.domain === domain)) {
              c.alternativeDomains = [
                ...(c.alternativeDomains || []),
                { domain, confidence: domain === 'market_communication' ? 0.75 : 0.55 },
              ];
            }
          }
          if (signalDomains.includes('market_communication')) {
            c.primaryDomain = 'market_communication';
            state.currentDomain = 'market_communication';
            c.domainConfidence = Math.max(c.domainConfidence || 0, 0.75);
          }
        }
      }
      const intents = evaluateEventTriggers(previous, state, update);
      const existing = new Set((state.eventIntents || []).map((i) => i.dedupeKey));
      const fresh = intents.filter((i) => !existing.has(i.dedupeKey));
      if (!fresh.length) return;
      state.eventIntents = [...(state.eventIntents || []), ...fresh];
      state.caseStateVersion++;
      state.updatedAt = new Date().toISOString();
      if (update.evidenceRef) state.identifiers.evidenceRef = update.evidenceRef;
      await this.saveState(p, state);
    },
    async createBranch(p, state) {
      const id = randomUUID();
      const child = JSON.parse(JSON.stringify(state));
      delete child._rev;
      child._id = key(p.tenantId, id);
      child.cetCaseId = id;
      child.parentCaseId = state.cetCaseId;
      child.caseStateVersion = 1;
      child.currentDomain =
        state.lastClassification.alternativeDomains[0]?.domain ||
        state.lastTransition.fromDomain ||
        state.currentDomain;
      child.branchStates = [];
      child.relatedCases = [{ cetCaseId: state.cetCaseId, relationshipType: 'branch_parent' }];
      child.identifiers.cetCaseId = id;
      child.lastClassification.primaryDomain = child.currentDomain;
      child.lastClassification.cetCaseId = id;
      child.eventIntents = evaluateEventTriggers(null, child);
      await this.saveState(p, child);
      state.branchStates.push({ cetCaseId: id, domain: child.currentDomain });
      state.relatedCases.push({ cetCaseId: id, relationshipType: 'branch_child' });
      await this.saveState(p, state);
    },
    async linkCases(p, state, target, relationshipType) {
      for (const [source, other] of [
        [state, target],
        [target, state],
      ]) {
        if (source.relatedCases.some((r) => r.cetCaseId === other.cetCaseId)) continue;
        source.relatedCases.push({ cetCaseId: other.cetCaseId, relationshipType });
        await this.recordUpdate(p, source, {
          kind: 'related_found',
          sourceCaseId: other.cetCaseId,
          version: other.cetCaseId,
        });
      }
    },
    async discover(ctx, p, state) {
      const relatedCases = [];
      for (const target of await this.visibleStates(p)) {
        if (target.cetCaseId === state.cetCaseId) continue;
        const values = (doc, k) =>
          [
            doc.identifiers[k],
            ...(k === 'evidenceRef' ? (doc.eventIntents || []).map((e) => e.evidenceRef) : []),
            ...(doc.knowledgeRefs || []).map((r) => r[k]),
          ].filter(Boolean);
        const matched = LINK_KEYS.filter((k) =>
          values(state, k).some((value) => values(target, k).includes(value))
        );
        const link =
          state.relatedCases.find((r) => r.cetCaseId === target.cetCaseId) ||
          (target.parentCaseId === state.cetCaseId
            ? { relationshipType: 'branch_child' }
            : state.parentCaseId === target.cetCaseId
              ? { relationshipType: 'branch_parent' }
              : null);
        if (!matched.length && !link) continue;
        relatedCases.push({
          cetCaseId: target.cetCaseId,
          relationshipType: link?.relationshipType || 'same_process',
          confidence: link ? 1 : 0.8,
          reason: link ? 'explicit_link' : matched.join(','),
          allowedEventTypes: ['related.session.reply', 'evidence.available'],
        });
        if (!link) await this.linkCases(p, state, target, 'same_process');
      }
      const relatedSessions = [];
      // Read the existing artifact only; never create/copy a Personal Agent session.
      if (state.agentSessionId) {
        try {
          const doc = await ctx.call('object-store.get', {
            namespace: tenantNamespace(SESSION_NAMESPACE, p.tenantId),
            key: state.agentSessionId,
          });
          const payload = doc?.payload || {};
          if (
            payload.tenantId === p.tenantId &&
            (payload.userId === p.actorId || payload.actorId === p.actorId)
          ) {
            relatedSessions.push({
              agentSessionId: state.agentSessionId,
              relationshipType: 'same_process',
              confidence: 1,
              reason: payload.dossier
                ? 'personal_agent_and_dossier_reference'
                : 'personal_agent_reference',
              allowedEventTypes: ['related.session.reply'],
            });
          }
        } catch (e) {
          if (e.status !== 404 && e.code !== 404 && e.code !== 503)
            this.logger.debug('Session reference unavailable', e.type);
        }
      }
      return { relatedCases, relatedSessions };
    },
  },
};
