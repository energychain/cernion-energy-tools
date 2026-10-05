'use strict';

const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { getFunctionModel, resolveFunctionId } = require('../src/function-model');
const { principal, deny } = require('../src/domain-router-policy');
const { assertReadObservation, readKinds } = require('../src/shared-service-agent-policy');
const { signalKey, projectSignals, operationInput } = require('../src/signal-projection');
const { compareCanonicalStrings } = require('../src/canonical-order');
const id = { type: 'string', min: 1, max: 256 };

module.exports = {
  name: 'signals',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'SIGNALS_DB_PATH',
      defaultDbPath: './data/signals',
    }),
  ],
  settings: {
    model: null,
    catalog: null,
    operationIndex: null,
    maxStatesPerTenant: 512,
    conflictRetries: 8,
  },
  actions: {
    catalog: {
      params: { tenantId: { ...id, optional: true }, functionId: { ...id, optional: true } },
      openapi: {
        summary: 'Read signal operation classifications and function associations',
        tags: ['Signals'],
      },
      handler(ctx) {
        principal(ctx, ctx.params);
        return {
          version: this.signalCatalog.version,
          operations: this.catalogEntries(ctx.params.functionId),
        };
      },
    },
    observe: {
      params: {
        tenantId: id,
        functionId: id,
        context: { type: 'object', optional: true },
        operationIds: { type: 'array', items: 'string', max: 128, optional: true },
      },
      openapi: { summary: 'Observe function signals under caller permissions', tags: ['Signals'] },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const functionId = this.functionIdentity(ctx.params.functionId);
        const fn = this.model.functions.find((f) => f.functionId === functionId);
        const context = this.contextIdentity(ctx.params.context);
        const signals = [];
        let calledOperations = 0;
        for (const entry of this.catalogEntries(functionId)) {
          if (ctx.params.operationIds && !ctx.params.operationIds.includes(entry.operationId))
            continue;
          if (entry.classification === 'contextual' && !context) continue;
          const operation = this.operations.find((o) => o.operationId === entry.operationId);
          if (!readKinds.has(operation?.operationKind)) continue;
          const input = operationInput(entry, ctx.params.context, p.tenantId);
          if (
            entry.classification === 'contextual' &&
            !Object.keys(input).some((k) => k !== 'tenantId')
          )
            continue;
          assertReadObservation(operation, fn, ctx, input, this.broker);
          const response = await ctx.call(operation.action, input, { meta: ctx.meta });
          calledOperations++;
          const projected = await this.persist(p.tenantId, entry, response, context);
          signals.push(...projected);
        }
        return { signals, calledOperations };
      },
    },
  },
  created() {
    this.model = getFunctionModel({ model: this.settings.model });
    this.signalCatalog = this.settings.catalog || require('../signal-catalog.json');
    this.operations = (
      this.settings.operationIndex || require('../operation-capability-index.json')
    ).operations;
    if (!Number.isInteger(this.settings.maxStatesPerTenant) || this.settings.maxStatesPerTenant < 1)
      throw new Error('Positive state limit required');
  },
  methods: {
    functionIdentity(value) {
      if (this.model.functions.some((f) => f.functionId === value)) return value;
      const resolved = resolveFunctionId(value, { model: this.model });
      if (resolved.length !== 1) deny('Unresolved or ambiguous function');
      return resolved[0].functionId;
    },
    catalogEntries(functionId) {
      const resolved = functionId && this.functionIdentity(functionId);
      return this.signalCatalog.operations
        .map((entry) => ({
          ...entry,
          functionIds: this.model.functions
            .filter((fn) => fn.operations.includes(entry.action))
            .map((fn) => fn.functionId)
            .sort(compareCanonicalStrings),
        }))
        .filter((entry) => !resolved || entry.functionIds.includes(resolved));
    },
    contextIdentity(context) {
      if (!context) return null;
      if (
        typeof context.kind !== 'string' ||
        !context.kind ||
        typeof context.ref !== 'string' ||
        !context.ref ||
        context.ref.length > 256
      )
        deny('Context kind and ref required');
      return { kind: context.kind, ref: context.ref };
    },
    async persist(tenantId, entry, response, context) {
      const documentId = `signals:${tenantId}`;
      for (let attempt = 0; attempt < this.settings.conflictRetries; attempt++) {
        let doc;
        try {
          doc = await this.db.get(documentId);
        } catch (error) {
          if (error.status !== 404) throw error;
          doc = { _id: documentId, tenantId, states: [] };
        }
        const contextKey = signalKey(context);
        const previous = Object.fromEntries(
          doc.states.filter((s) => s.contextKey === contextKey).map((s) => [s.signalId, s.state])
        );
        const signals = projectSignals(response, entry, { context, previous });
        const changes = [];
        for (const signal of signals) {
          const old = doc.states.find(
            (s) => s.signalId === signal.signalId && s.contextKey === contextKey
          );
          if (old && old.state !== signal.state)
            changes.push({
              tenantId,
              signalId: signal.signalId,
              functionIds: signal.functionIds,
              ...(context ? { context } : {}),
              fromState: old.state,
              toState: signal.state,
              asOf: signal.asOf,
              eventId: signalKey(documentId, doc._rev, signal.signalId, contextKey, signal.state),
            });
          doc.states = doc.states.filter(
            (s) => !(s.signalId === signal.signalId && s.contextKey === contextKey)
          );
          doc.states.push({ signalId: signal.signalId, contextKey, state: signal.state });
        }
        doc.states = doc.states.slice(-this.settings.maxStatesPerTenant);
        try {
          await this.db.put(doc);
        } catch (error) {
          if (error.status === 409) continue;
          throw error;
        }
        // Persist first; no lifecycle hook, timer or event subscriber observes data.
        // Do not await downstream cycles from inside an agent's current cycle.
        for (const event of changes) {
          try {
            await this.broker.emit('signal.state.changed.v1', event);
          } catch (error) {
            this.logger.warn(error.type || error.name);
          }
        }
        return signals;
      }
      throw new Errors.MoleculerError('Signal revision contention', 409, 'SIGNAL_CONFLICT');
    },
  },
};
