'use strict';

const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const {
  getFunctionModel,
  getFunction,
  resolveFunctionId,
  getNeighbors,
} = require('../src/function-model');
const { retainCaseContexts } = require('../src/function-case-contexts');
const { validateTenantId } = require('../src/tenant-context');
const {
  activationRows,
  resolveRecords,
  coverageRecords,
} = require('../src/function-activation-state');
const { compareCanonicalStrings } = require('../src/canonical-order');

const { principal, deny } = require('../src/domain-router-policy');
const {
  attentionState,
  advanceAttention,
  refillAttention,
  validateAttentionSettings,
} = require('../src/function-attention');

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
    contextRetentionTurns: 20,
    maxNeighborsPerTouch: 2,
    halfLifeTurns: 20,
    retireThreshold: 0.05,
    retainFactor: 4,
    maxRetainFactor: 20,
    establishedFactor: 10,
    establishThreshold: 3,
    hysteresis: 0.5,
    allowanceCap: 10,
    allowancePerTurn: 2,
    turnDedupLimit: 256,
    tenantBudgets: {},
    minWeight: 0.2,
    minTouchConfidence: 0.2,
    coverageThreshold: 0.5,
    restWindowMs: 86400000,
    sweepIntervalMs: 60000,
    touchRetentionWindows: 4,
    historyLimit: 200,
    historyRetentionMs: 2592000000,
    clock: null,
  },
  actions: {
    neighbors: {
      visibility: 'protected',
      params: getParams,
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const ids = this.checkedFunction(ctx.params.functionId);
        if (ids.length !== 1) deny('Ambiguous function');
        await this.pending.get(p.tenantId);
        const doc = await this.readDocument(p.tenantId);
        return getNeighbors(ids[0].functionId, {
          model: this.model,
          overlay: doc.neighborCorrections || [],
          minWeight: this.settings.minWeight,
        });
      },
    },
    correct: {
      visibility: 'protected',
      handler(ctx) {
        return this.acceptCorrection(ctx.params, ctx.meta);
      },
    },
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
    'shared-agent.feedback.v1': {
      async handler(ctx) {
        await this.acceptFeedback(ctx.params);
      },
    },
    'shared-agent.consumption.v1': {
      async handler(ctx) {
        await this.acceptConsumption(ctx.params);
      },
    },
    'shared-service.correction.v1': {
      async handler(ctx) {
        await this.acceptCorrection(ctx.params, ctx.meta);
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
      if (
        event.turnRef !== undefined &&
        (typeof event.turnRef !== 'string' || !event.turnRef.trim() || event.turnRef.length > 256)
      )
        throw new Errors.MoleculerClientError('Invalid turnRef', 400);
      if (
        event.context !== undefined &&
        (event.context?.kind !== 'case' ||
          typeof event.context.ref !== 'string' ||
          !event.context.ref.trim() ||
          event.context.ref.length > 256)
      )
        throw new Errors.MoleculerClientError('Invalid case context', 400);
      if (event.confidence < this.settings.minTouchConfidence) return;
      return this.enqueue(tenantId, () =>
        this.updateDocument(tenantId, (document) => {
          const newer = resolved.some(({ functionId }) => {
            const prior = document.touches.find(
              (item) => item.functionId === functionId && item.actorId === event.actorId
            );
            return (
              !prior ||
              Date.parse(prior.at) < at ||
              (Date.parse(prior.at) === at && event.turnRef && prior.turnRef !== event.turnRef)
            );
          });
          if (!newer) return;
          const priorTurns = document.activatingTurns || 0;
          advanceAttention(
            document,
            { ...event, functionIds: resolved.map((item) => item.functionId) },
            this.model,
            this.settings
          );
          retainCaseContexts(
            document,
            event,
            resolved,
            this.model,
            this.settings,
            document.activatingTurns > priorTurns
          );
          for (const { functionId } of resolved) {
            const previous = document.touches.find(
              (item) =>
                item.functionId === functionId &&
                item.actorId === event.actorId &&
                item.modelSourceHash === this.model.sourceHash
            );
            if (
              previous &&
              (Date.parse(previous.at) > at ||
                (Date.parse(previous.at) === at &&
                  (!event.turnRef || previous.turnRef === event.turnRef)))
            )
              continue;
            const record = {
              tenantId,
              actorId: event.actorId,
              conversationId: event.conversationId,
              ...(event.turnRef ? { turnRef: event.turnRef } : {}),
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

    checkedAgentEvent(event) {
      const tenantId = this.checkedTenant(event.tenantId);
      const resolved = this.checkedFunction(event.functionId);
      if (
        resolved.length !== 1 ||
        typeof event.agentId !== 'string' ||
        !event.agentId.trim() ||
        !Number.isFinite(Date.parse(event.at)) ||
        Date.parse(event.at) > this.now()
      )
        throw new Errors.MoleculerClientError('Invalid agent event', 400);
      return { tenantId, functionId: resolved[0].functionId };
    },
    async acceptConsumption(event) {
      const { tenantId, functionId } = this.checkedAgentEvent(event);
      if (
        !Number.isFinite(event.units) ||
        event.units <= 0 ||
        !['wake', 'llm', 'operation'].includes(event.kind)
      )
        throw new Errors.MoleculerClientError('Invalid consumption', 400);
      return this.enqueue(tenantId, () =>
        this.updateDocument(
          tenantId,
          (document) => {
            const row = resolveRecords(document.activations, this.model).find(
              (item) => item.functionId === functionId && item.responsibility.cet
            );
            if (!row) return;
            document.activations = resolveRecords(document.activations, this.model);
            const saved = document.activations.find((item) => item.functionId === functionId);
            const attention = attentionState(saved.attention, this.settings);
            if (event.units > attention.allowance) {
              attention.allowanceExhausted = true;
            } else {
              attention.allowance -= event.units;
              attention.consumedUnits += event.units;
              attention.allowanceExhausted = attention.allowance === 0;
            }
            saved.attention = attention;
          },
          { ...event, functionId, consumption: true }
        )
      );
    },
    async acceptFeedback(event) {
      const { tenantId, functionId } = this.checkedAgentEvent(event);
      if (
        !['accepted', 'used', 'rejected'].includes(event.outcome) ||
        typeof event.ref !== 'string' ||
        !event.ref.trim() ||
        event.ref.length > 256
      )
        throw new Errors.MoleculerClientError('Invalid feedback', 400);
      return this.enqueue(tenantId, () =>
        this.updateDocument(tenantId, (document) => {
          document.activations = resolveRecords(document.activations, this.model);
          const row = document.activations.find(
            (item) => item.functionId === functionId && item.attention
          );
          if (!row) return;
          const identity = JSON.stringify([event.agentId, event.outcome, event.ref]);
          document.feedbackKeys ||= [];
          if (document.feedbackKeys.includes(identity)) return;
          document.feedbackKeys.push(identity);
          document.feedbackKeys = document.feedbackKeys.slice(-this.settings.turnDedupLimit);
          row.attention.turnsSinceRefresh = 0;
          row.attention.retired = false;
          if (event.outcome !== 'rejected') row.attention.reactivationScore += 1;
          row.attention = attentionState(row.attention, this.settings);
        })
      );
    },
    async acceptCorrection(event, meta = {}) {
      if (['activation', 'neighbor'].includes(event.target))
        return this.acceptModelCorrection(event, meta);
      if (
        event.target !== 'agent' ||
        !['retain', 'unretain', 'pin', 'unpin'].includes(event.correction?.kind)
      )
        return;
      let p;
      try {
        p = principal({ meta }, event);
        if (p.actorId !== event.actorId) deny('Actor mismatch');
        if (
          ['pin', 'unpin'].includes(event.correction.kind) &&
          !p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role))
        )
          deny('Admin role required');
      } catch (error) {
        this.logger.warn('Attention correction rejected', {
          tenantId: event.tenantId,
          actorId: event.actorId,
          reason: error.message,
        });
        throw error;
      }
      const tenantId = this.checkedTenant(p.tenantId);
      const resolved = this.checkedFunction(
        event.correction.functionId || event.functionId || event.ref
      );
      if (resolved.length !== 1) throw new Errors.MoleculerClientError('Ambiguous correction', 409);
      const functionId = resolved[0].functionId;
      const factor = event.correction.factor ?? this.settings.retainFactor;
      if (!Number.isFinite(factor) || factor < 1)
        throw new Errors.MoleculerClientError('Invalid retain factor', 400);
      return this.enqueue(tenantId, () =>
        this.updateDocument(tenantId, (document) => {
          document.activations = resolveRecords(document.activations, this.model);
          const row = document.activations.find(
            (item) => item.functionId === functionId && item.attention
          );
          if (!row) return;
          document.agentCorrections ||= [];
          const c = event.correction;
          if (c.undoRef) {
            const record = document.agentCorrections.find((item) => item.ref === c.undoRef);
            if (!record || record.undone) return;
            const newer = document.agentCorrections
              .slice(document.agentCorrections.indexOf(record) + 1)
              .some((item) => item.functionId === functionId && !item.undone);
            if (newer) deny('Undo newer agent corrections first');
            row.attention.retainFactor = record.before.retainFactor;
            row.attention.inventory = record.before.inventory;
            record.undone = true;
            row.attention = attentionState(row.attention, this.settings);
            return;
          }
          if (
            document.agentCorrections.some((item) => item.ref === event.ref && item.kind === c.kind)
          )
            return;
          document.agentCorrections.push({
            ref: event.ref,
            kind: c.kind,
            functionId,
            at: event.at || new Date(this.now()).toISOString(),
            before: {
              retainFactor: row.attention.retainFactor,
              inventory: row.attention.inventory,
            },
          });
          const attention = row.attention;
          if (event.correction.kind === 'retain')
            attention.retainFactor = Math.min(factor, this.settings.maxRetainFactor);
          if (event.correction.kind === 'unretain') attention.retainFactor = 1;
          if (event.correction.kind === 'pin') attention.inventory = true;
          if (event.correction.kind === 'unpin') attention.inventory = false;
          attention.turnsSinceRefresh = 0;
          attention.retired = false;
          row.attention = attentionState(attention, this.settings);
        })
      );
    },

    async acceptModelCorrection(event, meta) {
      const { correctionPrincipal } = require('../src/shared-service-learning');
      correctionPrincipal(event, meta);
      const c = event.correction;
      const ids = this.checkedFunction(c.functionId || event.ref);
      if (ids.length !== 1) deny('Ambiguous correction');
      const functionId = ids[0].functionId;
      if (event.target === 'activation' && typeof c.cet !== 'boolean')
        deny('Invalid responsibility');
      let neighborId;
      if (event.target === 'neighbor') {
        const neighbors = this.checkedFunction(c.neighborId);
        if (neighbors.length !== 1 || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 1)
          deny('Invalid neighbor');
        neighborId = neighbors[0].functionId;
      }
      return this.enqueue(event.tenantId, () =>
        this.updateDocument(event.tenantId, (document) => {
          const field =
            event.target === 'neighbor' ? 'neighborCorrections' : 'responsibilityCorrections';
          document[field] ||= [];
          if (c.undoRef) document[field] = document[field].filter((row) => row.ref !== c.undoRef);
          else if (!document[field].some((row) => row.ref === event.ref))
            document[field].push({
              ref: event.ref,
              functionId,
              ...(neighborId ? { neighborId, weight: c.weight } : { cet: c.cet }),
              modelSourceHash: this.model.sourceHash,
            });
        })
      );
    },
    compactTouches(document) {
      const latest = new Map();
      for (const record of resolveRecords(document.touches, this.model)) {
        const key = JSON.stringify([record.functionId, record.actorId]);
        const previous = latest.get(key);
        if (!previous || Date.parse(record.at) > Date.parse(previous.at))
          latest.set(key, {
            ...record,
            modelSourceHash: this.model.sourceHash,
            capabilities: getFunction(record.functionId, { model: this.model }).capabilities || [],
          });
      }
      document.touches = [...latest.values()];
    },
    async updateDocument(tenantId, mutate, event) {
      const document = await this.readDocument(tenantId);
      const original = JSON.stringify(document);
      const priorCoverage = coverageRecords(document, this.model);
      this.compactTouches(document);
      mutate(document);
      const previous = resolveRecords(JSON.parse(original).activations, this.model);
      const next = activationRows(document, this.model, this.settings, this.now());
      refillAttention(document, next, this.settings);
      for (const row of next) {
        const old = previous.find((item) => item.functionId === row.functionId);
        const oldState = old
          ? [old.state, old.responsibility, old.attention]
          : [
              'latent',
              {
                humans: priorCoverage
                  .filter(
                    (entry) =>
                      entry.functionId === row.functionId &&
                      entry.score >= this.settings.coverageThreshold
                  )
                  .map((entry) => entry.actorId)
                  .sort(compareCanonicalStrings),
                cet: false,
              },
              undefined,
            ];
        if (
          JSON.stringify(oldState) ===
            JSON.stringify([row.state, row.responsibility, row.attention]) &&
          !(
            event?.consumption &&
            event.functionId === row.functionId &&
            row.responsibility.cet &&
            row.attention?.allowanceExhausted
          )
        )
          continue;
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
          ...(row.attention ? { attention: copy(row.attention) } : {}),
          reason: copy(row.reason),
        };
        if (handoff) entry.actorId = event?.actorId || row.responsibility.humans[0];
        const status = (value) => [value?.tier, value?.retired, value?.allowanceExhausted];
        if (
          !old ||
          JSON.stringify([old.state, old.responsibility, status(old.attention)]) !==
            JSON.stringify([row.state, row.responsibility, status(row.attention)])
        )
          document.history.push(entry);
        if (handoff) row.reason.push({ kind: entry.kind, actorId: entry.actorId, at: entry.at });
        const notification = {
          tenantId,
          modelSourceHash: this.model.sourceHash,
          capabilities: getFunction(row.functionId, { model: this.model }).capabilities || [],
          functionId: row.functionId,
          state: row.state,
          responsibility: copy(row.responsibility),
          ...(row.attention ? { attention: copy(row.attention) } : {}),
        };
        const queued = document.outbox.find((item) => item.functionId === row.functionId);
        if (queued) Object.assign(queued, notification);
        else document.outbox.push(notification);
      }
      document.activations = next
        .filter((row) => row.state !== 'latent')
        .map((row) => ({
          ...row,
          modelSourceHash: this.model.sourceHash,
          capabilities: getFunction(row.functionId, { model: this.model }).capabilities || [],
        }));
      const cutoff = this.now() - this.settings.restWindowMs * this.settings.touchRetentionWindows;
      const influencing = new Set(
        next.filter((row) => row.state === 'active').map((row) => row.functionId)
      );
      document.touches = document.touches.filter(
        (record) => Date.parse(record.at) >= cutoff || influencing.has(record.functionId)
      );
      document.history = document.history
        .filter((entry) => this.now() - Date.parse(entry.at) <= this.settings.historyRetentionMs)
        .slice(-this.settings.historyLimit);
      if (JSON.stringify(document) !== original) {
        const result = await this.db.put(document);
        document._rev = result.rev;
      }
      await this.flushOutbox(document);
    },
    async flushOutbox(document) {
      if (!document.outbox.length) return;
      const notifications = resolveRecords(document.outbox, this.model);
      const ids = new Set(notifications.map((entry) => entry.functionId));
      for (const functionId of ids) {
        const row = document.activations.find((entry) => entry.functionId === functionId) ||
          notifications.findLast((entry) => entry.functionId === functionId) || {
            functionId,
            state: 'latent',
            responsibility: { humans: [], cet: false },
          };
        await this.broker.emit('function.activation.changed.v1', {
          tenantId: document.tenantId,
          functionId: row.functionId,
          state: row.state,
          responsibility: copy(row.responsibility),
          ...(row.attention ? { attention: copy(row.attention) } : {}),
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
    validateAttentionSettings(this.settings);
    const {
      restWindowMs,
      sweepIntervalMs,
      tenantBudget,
      tenantBudgets,
      minWeight,
      minTouchConfidence,
      coverageThreshold,
      touchRetentionWindows,
      historyLimit,
      historyRetentionMs,
    } = this.settings;
    if (
      !Number.isInteger(this.settings.contextRetentionTurns) ||
      this.settings.contextRetentionTurns < 1 ||
      !Number.isFinite(touchRetentionWindows) ||
      touchRetentionWindows < 1 ||
      !Number.isInteger(historyLimit) ||
      historyLimit < 1 ||
      !Number.isFinite(historyRetentionMs) ||
      historyRetentionMs < 0 ||
      !Number.isFinite(restWindowMs) ||
      restWindowMs < 0 ||
      !Number.isFinite(sweepIntervalMs) ||
      sweepIntervalMs < 0 ||
      !Number.isInteger(tenantBudget) ||
      tenantBudget < 0 ||
      Object.values(tenantBudgets).some((budget) => !Number.isInteger(budget) || budget < 0) ||
      [minWeight, minTouchConfidence, coverageThreshold].some(
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
