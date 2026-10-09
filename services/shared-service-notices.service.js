'use strict';

const { createHash } = require('node:crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { getFunctionModel, getNeighbors, resolveFunctionId } = require('../src/function-model');
const { validateTenantId } = require('../src/tenant-context');
const { assertReadObservation } = require('../src/shared-service-agent-policy');
const { signalKey, operationInput } = require('../src/signal-projection');
const {
  noticeKey,
  eligibleNotices,
  renderNoticeBlock,
  resolvedNotice,
} = require('../src/shared-service-notices');

const personParams = {
  tenantId: { type: 'string', min: 1, max: 256 },
  actorId: { type: 'string', min: 1, max: 256 },
};
const events = [
  'shared-agent.proposal.created.v1',
  'signal.state.changed.v1',
  'function.activation.changed.v1',
  'shared-agent.gaps.changed.v1',
];

module.exports = {
  name: 'notices',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'SHARED_SERVICE_NOTICES_DB_PATH',
      defaultDbPath: './data/shared-service-notices',
    }),
  ],
  settings: {
    model: null,
    maxQueue: 50,
    maxHistory: 100,
    dedupLimit: 256,
    expireAfterTurns: 20,
    maxPerResponse: 3,
    coverageThreshold: 0.5,
  },
  created() {
    this.model = getFunctionModel({ model: this.settings.model });
    this.queue = Promise.resolve();
    this.failures = 0;
    if (
      !Number.isFinite(this.settings.coverageThreshold) ||
      this.settings.coverageThreshold < 0 ||
      this.settings.coverageThreshold > 1
    )
      throw new Error('Invalid notices coverage threshold');
    for (const name of [
      'maxQueue',
      'maxHistory',
      'dedupLimit',
      'expireAfterTurns',
      'maxPerResponse',
    ])
      if (
        !Number.isInteger(this.settings[name]) ||
        this.settings[name] < 1 ||
        this.settings[name] > 1000
      )
        throw new Error(`Invalid notices setting: ${name}`);
  },
  async stopped() {
    await this.queue;
  },
  actions: {
    enqueueMemory: {
      visibility: 'protected',
      params: {
        ...personParams,
        relationId: { type: 'string' },
        factIds: { type: 'array', items: 'string' },
        confirmation: { type: 'boolean', optional: true },
      },
      async handler(ctx) {
        const p = principal(ctx, { tenantId: ctx.params.tenantId });
        const text = await require('../src/tenant-memory-store').relationText(
          ctx,
          p,
          ctx.params.relationId
        );
        if (!text && !ctx.params.confirmation) return { queued: false };
        if (ctx.params.confirmation) {
          const doc = await require('../src/tenant-memory-store').get(
            ctx,
            p,
            ctx.params.relationId
          );
          if (doc.payload.type !== 'tenant_memory_fact') return { queued: false };
        }
        return this.serialize(async () => {
          const doc = await this.read(p.tenantId, ctx.params.actorId);
          const key = noticeKey('tenant-memory', [
            ctx.params.relationId,
            Boolean(ctx.params.confirmation),
          ]);
          if (doc.seen.includes(key)) return { queued: false };
          doc.seen = [...doc.seen, key].slice(-this.settings.dedupLimit);
          const sequence = ++doc.sequence;
          doc.queue.push({
            kind: 'memory',
            ref: `G-${sequence}`,
            sequence,
            turn: doc.turn,
            relationId: ctx.params.relationId,
            confirmation: Boolean(ctx.params.confirmation),
            factIds: ctx.params.factIds,
            eventKey: key,
          });
          doc.queue = doc.queue.slice(-this.settings.maxQueue);
          await this.save(doc);
          return { queued: true };
        });
      },
    },
    list: {
      rest: 'GET /',
      openapi: {
        summary: 'Read own visible next-turn notices',
        tags: ['Shared Service Notices'],
        parameters: [
          {
            name: 'tenantId',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'tenant-a' },
          },
          {
            name: 'actorId',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'actor-a' },
          },
        ],
      },
      params: personParams,
      handler(ctx) {
        const p = this.self(ctx);
        return this.serialize(async () =>
          this.present(ctx, p, await this.read(p.tenantId, p.actorId))
        );
      },
    },
    resolveRef: {
      params: { ...personParams, ref: { type: 'string', min: 1, max: 32 } },
      handler(ctx) {
        const p = this.self(ctx);
        return this.serialize(async () => {
          const doc = await this.read(p.tenantId, p.actorId);
          const item = [...doc.queue, ...doc.history].find((row) => row.ref === ctx.params.ref);
          const resolved = item && resolvedNotice(item, this.model);
          return resolved && (await this.canSee(ctx, p, resolved))
            ? this.publicNotice(resolved)
            : null;
        });
      },
    },
    setPreference: {
      rest: 'POST /preference',
      openapi: {
        summary: 'Set own next-turn notice preference',
        tags: ['Shared Service Notices'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'actorId', 'preference'],
                properties: {
                  tenantId: { type: 'string', example: 'tenant-a' },
                  actorId: { type: 'string', example: 'actor-a' },
                  preference: {
                    type: 'string',
                    enum: ['all', 'proposals_only', 'off'],
                    example: 'all',
                  },
                },
              },
              examples: {
                own: { value: { tenantId: 'tenant-a', actorId: 'actor-a', preference: 'all' } },
              },
            },
          },
        },
      },
      params: {
        ...personParams,
        preference: { type: 'enum', values: ['all', 'proposals_only', 'off'] },
      },
      handler(ctx) {
        const p = this.self(ctx);
        return this.serialize(async () => {
          const doc = await this.read(p.tenantId, p.actorId);
          doc.preference = ctx.params.preference;
          await this.save(doc);
          return { preference: doc.preference };
        });
      },
    },
    completeTurn: {
      visibility: 'protected',
      params: {
        ...personParams,
        turnRef: { type: 'string', min: 1, max: 256 },
        structured: { type: 'boolean', optional: true },
        fullQueue: { type: 'boolean', optional: true },
      },
      handler(ctx) {
        const p = this.self(ctx);
        return this.serialize(async () => {
          const doc = await this.read(p.tenantId, p.actorId);
          if (doc.turnRefs.includes(ctx.params.turnRef))
            return { items: [], remaining: 0, block: '' };
          doc.turnRefs = [...doc.turnRefs, ctx.params.turnRef].slice(-this.settings.dedupLimit);
          const result = ctx.params.structured
            ? { items: [], remaining: 0, block: '' }
            : await this.present(ctx, p, doc);
          const selected = ctx.params.fullQueue
            ? result.items
            : result.items.slice(0, this.settings.maxPerResponse);
          const refs = new Set(selected.map((item) => item.ref));
          doc.history = [...doc.history, ...doc.queue.filter((item) => refs.has(item.ref))].slice(
            -this.settings.maxHistory
          );
          doc.queue = doc.queue.filter((item) => !refs.has(item.ref));
          doc.turn++;
          doc.queue = doc.queue.filter(
            (item) => doc.turn - item.turn < this.settings.expireAfterTurns
          );
          await this.save(doc);
          return {
            items: selected,
            remaining: result.items.length - selected.length,
            block: renderNoticeBlock(selected, result.items.length - selected.length, this.model),
          };
        }).then(async (result) => {
          // Release the notice queue before entering the agent queue. Agent cycles
          // publish notices and must be able to complete while this turn waits.
          for (const item of result.items.filter((row) => row.kind === 'gap'))
            await ctx.call('shared-service-agent.markGapDelivered', {
              tenantId: p.tenantId,
              gapRef: item.objectRef,
              contentHash: item.contentHash,
            });
          return result;
        });
      },
    },
  },
  events: {
    'function.coverage.changed.v1': {
      handler(ctx) {
        return this.serialize(() => this.coverage(ctx.params));
      },
    },
    ...Object.fromEntries(
      events.map((source) => [
        source,
        {
          handler(ctx) {
            return this.serialize(() => this.receive(source, ctx.params));
          },
        },
      ])
    ),
  },
  methods: {
    self(ctx) {
      const p = principal(ctx, ctx.params);
      if (p.actorId !== ctx.params.actorId) deny('Actor mismatch');
      return p;
    },
    serialize(work) {
      const next = this.queue.then(work);
      this.queue = next.catch((error) => {
        this.failures = Math.min(1000000, this.failures + 1);
        this.logger.warn('Notice processing failed', { errorClass: error.type || error.name });
      });
      return next;
    },
    async settle() {
      let prior;
      do {
        prior = this.queue;
        await prior;
      } while (prior !== this.queue);
    },
    personId(tenantId, actorId) {
      return `notice:${createHash('sha256')
        .update(JSON.stringify([tenantId, actorId]))
        .digest('hex')}`;
    },
    async read(tenantId, actorId) {
      try {
        return await this.db.get(this.personId(tenantId, actorId));
      } catch (error) {
        if (error.status !== 404) throw error;
        return {
          _id: this.personId(tenantId, actorId),
          tenantId,
          actorId,
          turn: 0,
          sequence: 0,
          preference: 'all',
          expireAfterTurns: this.settings.expireAfterTurns,
          queue: [],
          history: [],
          seen: [],
          turnRefs: [],
          coverage: {},
          activations: {},
        };
      }
    },
    async save(doc) {
      const result = await this.db.put(doc);
      doc._rev = result.rev;
    },
    async coverage(event) {
      if (!event.tenantId || !event.actorId || !Number.isFinite(event.score)) return;
      validateTenantId(event.tenantId);
      const candidates = resolveFunctionId(event.functionId, { model: this.model });
      const matches = this.model.functions.some((fn) => fn.functionId === event.functionId)
        ? candidates.filter((match) => match.functionId === event.functionId)
        : candidates;
      if (!matches.length) return;
      const doc = await this.read(event.tenantId, event.actorId);
      for (const match of matches) doc.coverage[match.functionId] = event.score;
      const current = new Set(this.model.functions.map((fn) => fn.functionId));
      doc.coverage = Object.fromEntries(
        Object.entries(doc.coverage).filter(([id]) => current.has(id))
      );
      await this.save(doc);
    },
    kinds(source, event, prior = {}) {
      if (source === events[3])
        return event.agentId && event.gapRef && event.contentHash
          ? [
              {
                kind: 'gap',
                objectRef: event.gapRef,
                agentId: event.agentId,
                contentHash: event.contentHash,
              },
            ]
          : [];
      if (source === events[0])
        return event.agentId && event.proposalRef
          ? [{ kind: 'proposal', objectRef: event.proposalRef, agentId: event.agentId }]
          : [];
      if (source === events[1])
        return ['warn', 'breach', 'ok'].includes(event.toState) &&
          event.fromState !== 'gap' &&
          event.toState !== event.fromState &&
          event.signalId
          ? [
              {
                kind: 'signal',
                objectRef: event.signalId,
                state: event.toState,
                context: event.context || null,
              },
            ]
          : [];
      const result = [];
      if (
        typeof event.responsibility?.cet === 'boolean' &&
        event.responsibility.cet !== (prior.cet || false)
      )
        result.push({ kind: 'responsibility', cet: event.responsibility.cet });
      if (
        ['established', 'inventory'].includes(event.attention?.tier) &&
        event.attention.tier !== prior.tier
      )
        result.push({ kind: 'tier', tier: event.attention.tier });
      return result;
    },
    async receive(source, event) {
      if (source === events[1]) {
        for (const functionId of event.functionIds || [])
          await this.receiveSignal(event, functionId);
        return;
      }
      return this.receiveFunction(source, event);
    },
    async receiveSignal(event, functionId) {
      return this.receiveFunction(events[1], { ...event, functionId });
    },
    resolveEventFunction(event) {
      const candidates = resolveFunctionId(event.functionId, { model: this.model });
      const matches = this.model.functions.some((fn) => fn.functionId === event.functionId)
        ? candidates.filter((match) => match.functionId === event.functionId)
        : candidates;
      return matches.length === 1 ? matches[0].functionId : null;
    },
    async receiveFunction(source, event) {
      if (!event.tenantId || !event.functionId) return;
      validateTenantId(event.tenantId);
      const functionId = this.resolveEventFunction(event);
      if (!functionId) return;
      const related = await this.relatedFunctions(functionId, event.tenantId);
      const docs = (await this.db.allDocs({ include_docs: true })).rows
        .map((row) => row.doc)
        .filter((doc) => doc.tenantId === event.tenantId);
      const recipients = new Set();
      if ([events[0], events[3]].includes(source)) {
        const agents = this.broker.getLocalService('shared-service-agent');
        const state = await agents?.readDocument(event.tenantId);
        const agent =
          state &&
          agents
            .resolvedAgents(state.agents)
            .find((row) => row.agentId === event.agentId && row.functionId === functionId);
        const association =
          source === events[0]
            ? agent?.proposals.find((item) => item.ref === event.proposalRef && !item.outcome)
            : agent?.gapLists?.find(
                (item) => item.ref === event.gapRef && item.contentHash === event.contentHash
              );
        const eligible =
          agent && agents.gapRecipients
            ? await agents.gapRecipients(state, agent, association?.context)
            : [];
        for (const actorId of association?.recipients || []) {
          if (!eligible.includes(actorId)) continue;
          recipients.add(actorId);
          if (!docs.some((doc) => doc.actorId === actorId))
            docs.push(await this.read(event.tenantId, actorId));
        }
      }
      for (const doc of docs)
        await this.recordForPerson(
          doc,
          source,
          event,
          functionId,
          related,
          recipients.has(doc.actorId)
        );
    },
    async relatedFunctions(functionId, tenantId) {
      const activation = this.broker.getLocalService('activation');
      const state = await activation?.readDocument?.(tenantId);
      const neighbors = getNeighbors(functionId, {
        model: this.model,
        overlay: state?.neighborCorrections || [],
        minWeight: activation?.settings.minWeight ?? this.model.parameters?.minWeight ?? 0,
      });
      return new Set([functionId, ...neighbors.map((edge) => edge.functionId)]);
    },
    async recordForPerson(doc, source, event, functionId, related, associatedRecipient = false) {
      const prior = doc.activations[functionId];
      const kinds = this.kinds(source, event, prior);
      if (source === events[2])
        doc.activations[functionId] = {
          cet: event.responsibility?.cet,
          tier: event.attention?.tier,
          transition: (prior?.transition || 0) + (kinds.length ? 1 : 0),
        };
      const covered = Object.entries(doc.coverage).some(
        ([id, score]) => related.has(id) && score >= this.settings.coverageThreshold
      );
      if (covered || associatedRecipient)
        for (const kind of kinds) this.addNotice(doc, source, event, functionId, kind);
      const current = new Set(this.model.functions.map((row) => row.functionId));
      doc.activations = Object.fromEntries(
        Object.entries(doc.activations).filter(([id]) => current.has(id))
      );
      await this.save(doc);
    },
    addNotice(doc, source, event, functionId, kind) {
      const reference =
        kind.kind === 'proposal'
          ? kind.objectRef
          : source === events[2]
            ? doc.activations[functionId].transition
            : event.eventId;
      const key = noticeKey(source, [functionId, kind, reference]);
      if (doc.seen.includes(key)) return;
      if (kind.kind === 'gap')
        doc.queue = doc.queue.filter(
          (row) => row.kind !== 'gap' || row.objectRef !== kind.objectRef
        );
      doc.seen = [...doc.seen, key].slice(-this.settings.dedupLimit);
      const sequence = ++doc.sequence;
      const prefix = { proposal: 'V', signal: 'S', responsibility: 'R', tier: 'R', gap: 'L' }[
        kind.kind
      ];
      const ref = `${prefix}-${sequence}`;
      doc.queue.push({
        ...kind,
        functionId,
        ref,
        sequence,
        turn: doc.turn,
        modelSourceHash: this.model.sourceHash,
        eventKey: key,
        source,
      });
      doc.queue = doc.queue.slice(-this.settings.maxQueue);
    },
    async canSee(ctx, p, item) {
      try {
        if (item.kind === 'memory') {
          const memoryStore = require('../src/tenant-memory-store');
          if (item.confirmation) {
            const fact = (await memoryStore.get(ctx, p, item.relationId)).payload;
            item.text = memoryStore.active(fact) ? `Hab ich festgehalten: ${fact.text}` : '';
          } else item.text = await memoryStore.relationText(ctx, p, item.relationId);
          return Boolean(item.text);
        }
        if (item.kind === 'proposal') {
          // Apply the same recipient predicate as resolveProposal, using its persisted association.
          const agentService = this.broker.getLocalService('shared-service-agent');
          if (!agentService) return false;
          const doc = await agentService.readDocument(p.tenantId);
          const agent = agentService
            .resolvedAgents(doc.agents)
            .find((row) => row.agentId === item.agentId && row.functionId === item.functionId);
          const proposal = agent?.proposals.find((row) => row.ref === item.objectRef);
          return !!proposal && !proposal.outcome && proposal.recipients.includes(p.actorId);
        }
        if (item.kind === 'gap') return await this.canSeeGap(ctx, p, item);
        if (item.kind === 'signal') return await this.canSeeSignal(ctx, p, item);
        const explanation = await ctx.call('activation.explain', {
          tenantId: p.tenantId,
          functionId: item.functionId,
        });
        return (
          explanation.activations?.some(
            (row) => row.tenantId === p.tenantId && row.functionId === item.functionId
          ) || false
        );
      } catch {
        return false;
      }
    },
    async canSeeGap(ctx, p, item) {
      const agents = this.broker.getLocalService('shared-service-agent');
      if (!agents) return false;
      const doc = await agents.readDocument(p.tenantId);
      const agent = agents
        .resolvedAgents(doc.agents)
        .find((row) => row.agentId === item.agentId && row.functionId === item.functionId);
      const gap = agent?.gapLists?.find((row) => row.ref === item.objectRef);
      if (
        !gap ||
        gap.state !== 'open' ||
        gap.contentHash !== item.contentHash ||
        gap.ignoredHash === gap.contentHash ||
        !gap.recipients.includes(p.actorId)
      )
        return false;
      if (
        agents.gapRecipients &&
        !(await agents.gapRecipients(doc, agent, gap.context)).includes(p.actorId)
      )
        return false;
      for (const part of gap.parts)
        for (const objectRef of part.signalRefs)
          if (!(await this.canSeeSignal(ctx, p, { ...item, objectRef, context: gap.context })))
            return false;
      return gap.parts.length > 0;
    },
    async canSeeSignal(ctx, p, item) {
      const signals = this.broker.getLocalService('signals');
      if (!signals) return false;
      const entry = signals
        .catalogEntries(item.functionId)
        .find((row) => item.objectRef.startsWith(`${row.operationId}:`));
      if (!entry || (entry.classification === 'contextual' && !item.context)) return false;
      const doc = await signals.db.get(`signals:${p.tenantId}`);
      if (
        !doc.states.some(
          (row) => row.signalId === item.objectRef && row.contextKey === signalKey(item.context)
        )
      )
        return false;
      const operation = signals.operations.find((row) => row.operationId === entry.operationId);
      const fn = signals.model.functions.find((row) => row.functionId === item.functionId);
      assertReadObservation(
        operation,
        fn,
        ctx,
        operationInput(entry, item.context, p.tenantId),
        this.broker
      );
      if (!item.context) return entry.classification === 'standing';
      if (item.context.kind !== 'case') return false;
      const journal = this.broker.getLocalService('journal');
      return journal
        ? await journal.referenceVisible(ctx, p, { kind: 'case', id: item.context.ref })
        : false;
    },
    publicNotice(item) {
      return { ...item };
    },
    async present(ctx, p, doc) {
      const items = [];
      for (const item of eligibleNotices(doc, this.model))
        if (await this.canSee(ctx, p, item)) {
          const publicItem = this.publicNotice(item);
          if (item.kind === 'gap') {
            const doc = await this.broker
              .getLocalService('shared-service-agent')
              .readDocument(p.tenantId);
            const gap = doc.agents
              .flatMap((row) => row.gapLists || [])
              .find((row) => row.ref === item.objectRef);
            publicItem.labels = gap.labels;
            publicItem.context = gap.context;
          }
          items.push(publicItem);
        }
      return { items, preference: doc.preference, block: renderNoticeBlock(items, 0, this.model) };
    },
  },
};
