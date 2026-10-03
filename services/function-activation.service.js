'use strict';

const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { getFunctionModel, getFunction, resolveFunctionId } = require('../src/function-model');
const { validateTenantId } = require('../src/tenant-context');
const { activationRows, resolveRecords } = require('../src/function-activation-state');

const copy = (value) => JSON.parse(JSON.stringify(value));
const tenantParams = { tenantId: { type: 'string', min: 1 } };
const getParams = { ...tenantParams, functionId: { type: 'string', min: 1 } };

module.exports = {
  name: 'activation',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'FUNCTION_ACTIVATION_DB_PATH',
      defaultDbPath: './data/function-activation',
    }),
  ],
  settings: {
    model: null,
    tenantBudget: 8,
    tenantBudgets: {},
    minWeight: 0.2,
    coverageThreshold: 0.5,
    restWindowMs: 86400000,
    sweepIntervalMs: 60000,
    clock: null,
  },
  actions: {
    list: {
      params: tenantParams,
      async handler(ctx) {
        const tenantId = this.checkedTenant(ctx.params.tenantId, ctx.meta);
        return this.readRows(tenantId);
      },
    },
    get: {
      params: getParams,
      async handler(ctx) {
        const tenantId = this.checkedTenant(ctx.params.tenantId, ctx.meta);
        const resolutions = resolveFunctionId(ctx.params.functionId, { model: this.model });
        const ids = new Set(resolutions.map((item) => item.functionId));
        return {
          resolutions,
          activations: (await this.readRows(tenantId)).filter((row) => ids.has(row.functionId)),
        };
      },
    },
    explain: {
      params: getParams,
      async handler(ctx) {
        const tenantId = this.checkedTenant(ctx.params.tenantId, ctx.meta);
        await this.pending.get(tenantId);
        const document = await this.readDocument(tenantId);
        const resolutions = resolveFunctionId(ctx.params.functionId, { model: this.model });
        const ids = new Set(resolutions.map((item) => item.functionId));
        return {
          resolutions,
          activations: activationRows(document, this.model, this.settings, this.now()).filter(
            (row) => ids.has(row.functionId)
          ),
          history: resolveRecords(document.history, this.model).filter((entry) =>
            ids.has(entry.functionId)
          ),
        };
      },
    },
  },
  events: {
    'function.touched.v1': {
      async handler(ctx) {
        await this.acceptTouch(ctx.params);
      },
    },
    'function.coverage.changed.v1': {
      async handler(ctx) {
        await this.acceptCoverage(ctx.params);
      },
    },
    'shared-agent.lifecycle.v1': {
      async handler(ctx) {
        await this.acceptActivity(ctx.params);
      },
    },
  },
  methods: {
    now() {
      return this.settings.clock ? this.settings.clock() : Date.now();
    },
    checkedTenant(tenantId, meta = {}) {
      if (typeof tenantId !== 'string' || !tenantId)
        throw new Errors.MoleculerClientError('tenantId required', 400);
      validateTenantId(tenantId);
      if (meta.tenantId && meta.tenantId !== tenantId)
        throw new Errors.MoleculerClientError('Tenant mismatch', 403);
      return tenantId;
    },
    checkedFunction(functionId) {
      const resolutions = getFunction(functionId, { model: this.model })
        ? [{ functionId, relation: 'same', overlap: 1 }]
        : resolveFunctionId(functionId, { model: this.model });
      if (!resolutions.length) throw new Errors.MoleculerClientError('Unresolved functionId', 404);
      return resolutions;
    },
    async readDocument(tenantId) {
      try {
        return await this.db.get(`activation:${tenantId}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        return {
          _id: `activation:${tenantId}`,
          tenantId,
          touches: [],
          coverage: [],
          activity: [],
          activations: [],
          history: [],
          outbox: [],
        };
      }
    },
    async readRows(tenantId) {
      await this.pending.get(tenantId);
      return activationRows(
        await this.readDocument(tenantId),
        this.model,
        this.settings,
        this.now()
      );
    },
    enqueue(tenantId, operation) {
      const before = this.pending.get(tenantId) || Promise.resolve();
      const current = before.catch(() => {}).then(operation);
      this.pending.set(tenantId, current);
      current
        .finally(() => {
          if (this.pending.get(tenantId) === current) this.pending.delete(tenantId);
        })
        .catch(() => {});
      return current;
    },
    async acceptTouch(event) {
      const tenantId = this.checkedTenant(event.tenantId);
      const resolved = this.checkedFunction(event.functionId);
      const at = Date.parse(event.at);
      if (
        typeof event.actorId !== 'string' ||
        !event.actorId.trim() ||
        typeof event.conversationId !== 'string' ||
        !event.conversationId.trim() ||
        !Number.isFinite(at) ||
        at > this.now() ||
        !Number.isFinite(event.confidence) ||
        event.confidence < 0 ||
        event.confidence > 1
      )
        throw new Errors.MoleculerClientError('Invalid touch', 400);
      return this.enqueue(tenantId, () =>
        this.updateDocument(tenantId, (document) => {
          for (const { functionId } of resolved) {
            const previous = document.touches.find(
              (item) =>
                item.functionId === functionId &&
                item.actorId === event.actorId &&
                item.conversationId === event.conversationId &&
                item.modelSourceHash === this.model.sourceHash
            );
            if (previous && Date.parse(previous.at) >= at) continue;
            const record = {
              tenantId,
              actorId: event.actorId,
              conversationId: event.conversationId,
              confidence: event.confidence,
              functionId,
              modelSourceHash: this.model.sourceHash,
              capabilities: getFunction(functionId, { model: this.model }).capabilities || [],
              at: new Date(at).toISOString(),
            };
            if (previous) Object.assign(previous, record);
            else document.touches.push(record);
          }
        })
      );
    },
    async acceptCoverage(event) {
      const tenantId = this.checkedTenant(event.tenantId);
      const resolved = this.checkedFunction(event.functionId);
      if (resolved.length !== 1)
        throw new Errors.MoleculerClientError('Ambiguous coverage functionId', 409);
      if (
        typeof event.actorId !== 'string' ||
        !event.actorId.trim() ||
        !Number.isFinite(event.score) ||
        event.score < 0 ||
        event.score > 1 ||
        !['observed', 'corrected'].includes(event.origin)
      )
        throw new Errors.MoleculerClientError('Invalid coverage', 400);
      return this.enqueue(tenantId, () =>
        this.updateDocument(
          tenantId,
          (document) => {
            const functionId = resolved[0].functionId;
            const previous = document.coverage.find(
              (item) =>
                item.functionId === functionId &&
                item.actorId === event.actorId &&
                item.modelSourceHash === this.model.sourceHash
            );
            if (previous && previous.score === event.score && previous.origin === event.origin)
              return;
            const sequence =
              Math.max(0, ...document.coverage.map((item) => item.sequence || 0)) + 1;
            const record = {
              tenantId,
              actorId: event.actorId,
              score: event.score,
              origin: event.origin,
              functionId,
              modelSourceHash: this.model.sourceHash,
              capabilities: getFunction(functionId, { model: this.model }).capabilities || [],
              sequence,
            };
            if (previous) Object.assign(previous, record);
            else document.coverage.push(record);
          },
          event
        )
      );
    },
    async acceptActivity(event) {
      const tenantId = this.checkedTenant(event.tenantId);
      const resolved = this.checkedFunction(event.functionId);
      if (resolved.length !== 1)
        throw new Errors.MoleculerClientError('Ambiguous activity functionId', 409);
      const functionId = resolved[0].functionId;
      if (
        typeof event.agentId !== 'string' ||
        !event.agentId.trim() ||
        !['proposed', 'active', 'sleeping', 'retired'].includes(event.lifecycle)
      )
        throw new Errors.MoleculerClientError('Invalid lifecycle', 400);
      return this.enqueue(tenantId, () =>
        this.updateDocument(tenantId, (document) => {
          const previous = document.activity.find(
            (item) => item.agentId === event.agentId && item.functionId === functionId
          );
          if (previous?.lifecycle === event.lifecycle) return;
          const entry = {
            agentId: event.agentId,
            functionId,
            lifecycle: event.lifecycle,
            at:
              event.lifecycle === 'active'
                ? new Date(this.now()).toISOString()
                : previous?.at || null,
            modelSourceHash: this.model.sourceHash,
            capabilities: getFunction(functionId, { model: this.model })?.capabilities || [],
          };
          if (previous) Object.assign(previous, entry);
          else document.activity.push(entry);
        })
      );
    },

    async updateDocument(tenantId, mutate, event) {
      const document = await this.readDocument(tenantId);
      const original = JSON.stringify(document);
      mutate(document);
      const previous = resolveRecords(document.activations, this.model);
      const next = activationRows(document, this.model, this.settings, this.now());
      for (const row of next) {
        const old = previous.find((item) => item.functionId === row.functionId);
        const oldState = old
          ? [old.state, old.responsibility]
          : ['latent', { humans: [], cet: false }];
        if (JSON.stringify(oldState) === JSON.stringify([row.state, row.responsibility])) continue;
        const handoff =
          old?.responsibility.cet && !row.responsibility.cet && row.responsibility.humans.length;
        const entry = {
          functionId: row.functionId,
          modelSourceHash: this.model.sourceHash,
          capabilities: getFunction(row.functionId, { model: this.model }).capabilities || [],
          kind: handoff ? 'handoff' : 'changed',
          at: new Date(this.now()).toISOString(),
          state: row.state,
          responsibility: copy(row.responsibility),
          reason: copy(row.reason),
        };
        if (handoff) entry.actorId = event?.actorId || row.responsibility.humans[0];
        document.history.push(entry);
        document.outbox.push({
          tenantId,
          modelSourceHash: this.model.sourceHash,
          capabilities: getFunction(row.functionId, { model: this.model }).capabilities || [],
          functionId: row.functionId,
          state: row.state,
          responsibility: copy(row.responsibility),
        });
      }
      document.activations = next.map((row) => ({
        ...row,
        modelSourceHash: this.model.sourceHash,
        capabilities: getFunction(row.functionId, { model: this.model }).capabilities || [],
      }));
      document.activations = activationRows(document, this.model, this.settings, this.now()).map(
        (row) => ({
          ...row,
          modelSourceHash: this.model.sourceHash,
          capabilities: getFunction(row.functionId, { model: this.model }).capabilities || [],
        })
      );
      if (JSON.stringify(document) !== original) {
        const result = await this.db.put(document);
        document._rev = result.rev;
      }
      await this.flushOutbox(document);
    },
    async flushOutbox(document) {
      if (!document.outbox.length) return;
      const ids = new Set(
        resolveRecords(document.outbox, this.model).map((entry) => entry.functionId)
      );
      for (const row of document.activations.filter((entry) => ids.has(entry.functionId))) {
        await this.broker.emit('function.activation.changed.v1', {
          tenantId: document.tenantId,
          functionId: row.functionId,
          state: row.state,
          responsibility: copy(row.responsibility),
        });
      }
      document.outbox = [];
      await this.db.put(document);
    },
    async settle() {
      await Promise.all([...this.pending.values()]);
    },
    async sweep() {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: 'activation:',
        endkey: 'activation:\uffff',
      });
      for (const { doc } of result.rows)
        await this.enqueue(doc.tenantId, () => this.updateDocument(doc.tenantId, () => {}));
    },
  },
  created() {
    this.model = getFunctionModel({ model: this.settings.model });
    this.pending = new Map();
    const {
      restWindowMs,
      sweepIntervalMs,
      tenantBudget,
      tenantBudgets,
      minWeight,
      coverageThreshold,
    } = this.settings;
    if (
      !Number.isFinite(restWindowMs) ||
      restWindowMs < 0 ||
      !Number.isFinite(sweepIntervalMs) ||
      sweepIntervalMs < 0 ||
      !Number.isInteger(tenantBudget) ||
      tenantBudget < 0 ||
      Object.values(tenantBudgets).some((budget) => !Number.isInteger(budget) || budget < 0) ||
      [minWeight, coverageThreshold].some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1
      )
    )
      throw new Error('Invalid activation settings');
  },
  async started() {
    await this.sweep();
    if (this.settings.sweepIntervalMs)
      this.restTimer = setInterval(
        () => this.sweep().catch((error) => this.logger.error(error)),
        this.settings.sweepIntervalMs
      );
  },
  async stopped() {
    clearInterval(this.restTimer);
    await this.settle();
  },
};
