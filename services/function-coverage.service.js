'use strict';

const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const modelApi = require('../src/function-model');
const {
  reference,
  configuration,
  mapSignals,
  resolvedTouches,
  project,
} = require('../src/function-coverage');
const { compareCanonicalStrings } = require('../src/canonical-order');

const TOUCHED_EVENT = 'function.touched.v1';
const CHANGED_EVENT = 'function.coverage.changed.v1';
const managers = ['ROLE_TENANT_ADMIN', 'ROLE_ADMIN', 'ROLE_UTILITY_HQ'];
const isManager = (p) => p.roles.some((role) => managers.includes(role));
const prefix = (tenantId) => `touch:${reference(tenantId)}:`;

module.exports = {
  name: 'function-coverage',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'CET_FUNCTION_COVERAGE_DB_PATH',
      defaultDbPath: './data/cet_function_coverage',
    }),
  ],
  settings: { coverage: {}, model: null, clock: Date.now },
  created() {
    this.config = configuration(this.settings.coverage);
    this.pendingTurns = 0;
    this.droppedTurns = 0;
    this.unresolvedSignals = 0;
    this.suppressedOperations = 0;
    this.signalOverflow = 0;
    this.queue = Promise.resolve();
  },
  async stopped() {
    await this.queue;
  },
  actions: {
    recordTouch: {
      visibility: 'protected',
      params: {
        tenantId: 'string',
        actorId: 'string',
        sourceType: { type: 'enum', values: ['completed_turn'] },
        sourceRef: { type: 'string', min: 1, max: 256 },
        conversationId: { type: 'string', min: 1, max: 256 },
        signalClass: 'string',
        capabilities: { type: 'array', items: 'string', max: 1024, optional: true },
        operations: { type: 'array', items: 'string', max: 1024, optional: true },
        observationOverflow: { type: 'number', integer: true, min: 0, optional: true },
      },
      handler(ctx) {
        const p = principal(ctx, ctx.params);
        if (p.actorId !== ctx.params.actorId) deny('Actor mismatch');
        return this.serialize(() => this.record(ctx.params));
      },
    },
    byActor: {
      visibility: 'protected',
      async handler(ctx) {
        return this.read(ctx, 'actor');
      },
    },
    byFunction: {
      visibility: 'protected',
      async handler(ctx) {
        return this.read(ctx, 'function');
      },
    },
    matrix: {
      visibility: 'protected',
      async handler(ctx) {
        return this.read(ctx, 'matrix');
      },
    },
    maintain: {
      visibility: 'protected',
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        if (!isManager(p)) deny('Management role required');
        return this.serialize(async () => {
          const now = this.settings.clock();
          let deleted = 0;
          let replayed = 0;
          for (const doc of await this.documents(p.tenantId)) {
            if (
              ctx.params.deleteActorId
                ? doc.actorId === ctx.params.deleteActorId
                : doc.expiresAt <= now
            ) {
              await this.db.remove(doc);
              deleted++;
            } else if (doc.pendingEvents.length) {
              await this.deliver(doc);
              replayed++;
            }
          }
          return { deleted, replayed };
        });
      },
    },
  },
  methods: {
    serialize(task) {
      const work = this.queue.then(task);
      this.queue = work.catch(() => {});
      return work;
    },
    async documents(tenantId) {
      const start = prefix(tenantId);
      const docs = [];
      let cursor = start;
      let skip = 0;
      while (true) {
        const page = await this.db.allDocs({
          startkey: cursor,
          endkey: `${start}\uffff`,
          include_docs: true,
          limit: 256,
          skip,
        });
        for (const row of page.rows) {
          if (row.doc?.tenantId === tenantId) docs.push(row.doc);
        }
        if (page.rows.length < 256) break;
        cursor = page.rows.at(-1).id;
        skip = 1;
      }
      return docs;
    },
    async record(input) {
      const model = this.settings.model || modelApi.getFunctionModel();
      const mapped = mapSignals(input, model, this.config);
      this.unresolvedSignals = Math.min(1000000, this.unresolvedSignals + mapped.unresolved);
      this.suppressedOperations = Math.min(
        1000000,
        this.suppressedOperations + mapped.suppressedOperations
      );
      this.signalOverflow = Math.min(1000000, this.signalOverflow + mapped.overflow);
      if (mapped.overflow)
        this.logger.warn('Coverage signal budget exceeded', { overflow: mapped.overflow });
      const weight = Object.hasOwn(this.config.weights, input.signalClass)
        ? this.config.weights[input.signalClass]
        : undefined;
      if (!weight) throw new Error('Unknown signal class');
      const now = this.settings.clock();
      const documents = [];
      for (const doc of await this.documents(input.tenantId)) {
        if (doc.expiresAt <= now) await this.db.remove(doc);
        else documents.push(doc);
      }
      const canonical = resolvedTouches(documents, model);
      let recorded = 0;
      for (const functionId of mapped.functionIds) {
        const id = `${prefix(input.tenantId)}${reference(input.actorId, input.sourceType, input.sourceRef, functionId, input.signalClass)}`;
        const duplicate = canonical.find(
          (doc) =>
            doc._id === id ||
            (doc.actorId === input.actorId &&
              doc.functionId === functionId &&
              doc.sourceType === input.sourceType &&
              doc.sourceRef === reference(input.sourceRef) &&
              doc.signalClass === input.signalClass)
        );
        if (duplicate) {
          await this.deliver(documents.find((doc) => doc._id === duplicate._id));
          continue;
        }
        const previous = canonical.filter(
          (doc) =>
            doc.actorId === input.actorId &&
            doc.functionId === functionId &&
            doc.expiresAt > now &&
            doc.at <= now
        );
        const conversationId = reference(input.tenantId, input.conversationId);
        const crossConversation = previous.some((doc) => doc.conversationId !== conversationId);
        const doc = {
          _id: id,
          tenantId: input.tenantId,
          actorId: input.actorId,
          functionId,
          ordinal: previous.length,
          signalClass: input.signalClass,
          weight: weight * (crossConversation ? this.config.crossConversationMultiplier : 1),
          at: now,
          expiresAt: now + this.config.retentionMs,
          sourceType: input.sourceType,
          sourceRef: reference(input.sourceRef),
          conversationId,
          scoreVersion: this.config.scoreVersion,
          ...(model.sourceHash ? { modelSourceHash: model.sourceHash } : {}),
          modelVersion: String(model.derivation?.version || model.version || '1'),
          pendingEvents: [],
        };
        const projection = project([...previous, doc], now, this.config);
        const latestChanged = [...previous]
          .filter((item) => item.changedScore !== undefined)
          .sort(
            (a, b) => b.at - a.at || b.ordinal - a.ordinal || compareCanonicalStrings(b._id, a._id)
          )[0];
        doc.pendingEvents.push({
          name: TOUCHED_EVENT,
          payload: {
            tenantId: doc.tenantId,
            actorId: doc.actorId,
            functionId,
            conversationId,
            turnRef: doc.sourceRef,
            confidence: weight,
            at: new Date(now).toISOString(),
          },
        });
        if (
          Math.abs(projection.score - (latestChanged?.changedScore || 0)) >= this.config.hysteresis
        ) {
          doc.changedScore = projection.score;
          doc.pendingEvents.push({
            name: CHANGED_EVENT,
            payload: {
              tenantId: doc.tenantId,
              actorId: doc.actorId,
              functionId,
              score: projection.score,
              origin: 'observed',
            },
          });
        }
        const saved = await this.db.put(doc);
        doc._rev = saved.rev;
        documents.push(doc);
        canonical.push(doc);
        recorded++;
        await this.deliver(doc);
      }
      return {
        recorded,
        unresolved: mapped.unresolved,
        suppressedOperations: mapped.suppressedOperations,
        overflow: mapped.overflow,
      };
    },
    async deliver(doc) {
      while (doc.pendingEvents.length) {
        try {
          const event = doc.pendingEvents[0];
          if (event.name === TOUCHED_EVENT) await this.broker.emit(TOUCHED_EVENT, event.payload);
          else await this.broker.emit(CHANGED_EVENT, event.payload);
          const updated = { ...doc, pendingEvents: doc.pendingEvents.slice(1) };
          const saved = await this.db.put(updated);
          Object.assign(doc, updated, { _rev: saved.rev });
        } catch {
          this.logger.warn('Coverage delivery pending');
          return;
        }
      }
    },
    readRow(item, p, kind) {
      if (
        kind === 'actor' ||
        p.roles.some((role) => ['ROLE_TENANT_ADMIN', 'ROLE_ADMIN'].includes(role))
      )
        return item;
      return { ...item, actorId: reference(p.tenantId, item.actorId), recentSourceReferences: [] };
    },
    async read(ctx, kind) {
      const p = principal(ctx, ctx.params);
      const actorId = ctx.params.actorId || p.actorId;
      if ((kind !== 'actor' || actorId !== p.actorId) && !isManager(p))
        deny('Management role required');
      const now =
        ctx.params.asOf === undefined ? this.settings.clock() : Date.parse(ctx.params.asOf);
      if (!Number.isFinite(now) || now > this.settings.clock()) deny('Invalid asOf');
      const limit = ctx.params.limit ?? 50;
      const offset = ctx.params.offset ?? 0;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isInteger(offset) ||
        offset < 0
      )
        deny('Invalid pagination');
      if (kind === 'function' && typeof ctx.params.functionId !== 'string')
        deny('Function required');
      const model = this.settings.model || modelApi.getFunctionModel();
      const groups = new Map();
      for (const doc of resolvedTouches(await this.documents(p.tenantId), model)) {
        if (doc.expiresAt <= now || doc.at > now || (kind === 'actor' && doc.actorId !== actorId))
          continue;
        const functionId = doc.functionId;
        if (kind === 'function' && functionId !== ctx.params.functionId) continue;
        const key = reference(doc.actorId, functionId);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ ...doc, functionId });
      }
      const items = [...groups.values()]
        .map((docs) => project(docs, now, this.config))
        .sort(
          (a, b) =>
            compareCanonicalStrings(a.functionId, b.functionId) ||
            compareCanonicalStrings(a.actorId, b.actorId)
        );
      const page = items.slice(offset, offset + limit).map((item) => this.readRow(item, p, kind));
      return { items: page, nextOffset: offset + limit < items.length ? offset + limit : null };
    },
  },
};
