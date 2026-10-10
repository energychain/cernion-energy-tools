'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal } = require('../src/domain-router-policy');
const { getFunctionModel, resolveFunctionId } = require('../src/function-model');
const { compareCanonicalStrings } = require('../src/canonical-order');
const {
  WAKE_DEFAULTS,
  validateWakeSettings,
  deriveWake,
  adaptInterval,
  canWake,
  eventMatches,
  wakeMetrics,
} = require('../src/shared-service-wake');

const key = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const idParam = { type: 'string', min: 1, max: 256 };
const invalid = (message) => {
  throw new Errors.MoleculerClientError(message, 422, 'WAKE_INVALID');
};

module.exports = {
  name: 'wake',
  mixins: [
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/shared_service_wake',
      dbPathEnvVar: 'SHARED_SERVICE_WAKE_DB_PATH',
    }),
  ],
  settings: {
    ...WAKE_DEFAULTS,
    model: null,
    clock: null,
    availableEvents: null,
    dataSources: [],
    signalCatalog: null,
  },
  actions: {
    pushGaps: {
      params: { tenantId: { ...idParam, optional: true } },
      openapi: {
        summary: 'Read tenant-scoped missing push sources',
        tags: ['Shared Service Wake'],
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const records = await this.records(p.tenantId);
        return records.flatMap((record) =>
          record.wake.pushGaps.map((gap) => ({
            tenantId: record.tenantId,
            functionId: record.functionId,
            agentId: record.agentId,
            ...gap,
          }))
        );
      },
    },
    metrics: {
      params: { tenantId: { ...idParam, optional: true } },
      openapi: { summary: 'Read tenant-scoped wake metrics', tags: ['Shared Service Wake'] },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        return (await this.records(p.tenantId)).map((record) => ({
          tenantId: record.tenantId,
          functionId: record.functionId,
          agentId: record.agentId,
          ...wakeMetrics(record.stats),
        }));
      },
    },
  },
  events: {
    'function.activation.changed.v1': {
      handler(ctx) {
        return this.track(this.receiveActivation(ctx.params));
      },
    },
    'shared-agent.lifecycle.v1': {
      handler(ctx) {
        return this.track(this.receiveLifecycle(ctx.params));
      },
    },
    'signal.state.changed.v1': {
      handler(ctx) {
        // A signal producer may be inside the agent cycle this event wakes.
        // Accept work without awaiting the next cycle from the producer callback.
        this.track(this.receiveEvent(ctx.eventName, ctx.params, ctx.id)).catch((error) =>
          this.logger.warn('Signal wake deferred', error.type || error.name)
        );
      },
    },
    '**': {
      group: 'shared-service-wake-push',
      handler(ctx) {
        if (
          ctx.eventName === 'signal.state.changed.v1' ||
          ctx.eventName.startsWith('function.') ||
          ctx.eventName.startsWith('shared-agent.') ||
          ctx.eventName.startsWith('$') ||
          ctx.eventName.startsWith('shared-service.')
        )
          return;
        return this.track(this.receiveEvent(ctx.eventName, ctx.params, ctx.id));
      },
    },
  },
  created() {
    this.pending = new Set();
    this.stopping = false;
    this.draining = false;
    this.instanceId = randomUUID();
    validateWakeSettings(this.settings);
    for (const name of ['total', 'empty', 'push.share', 'consumed.units'])
      this.broker.metrics.register({
        name: `shared.service.wake.${name}`,
        type: 'gauge',
        labelNames: ['tenantId', 'agentId'],
        description: 'Persisted shared service wake state',
      });
  },
  async started() {
    this.model = getFunctionModel({ model: this.settings.model });
    this.settings.signalCatalog ||= require('../signal-catalog.json');
    this.availableEvents = [
      ...new Set([
        ...(this.settings.availableEvents ||
          this.model.functions.flatMap((fn) => fn.events?.emits || [])),
        'signal.state.changed.v1',
      ]),
    ];
    for (const record of await this.records()) {
      await this.flushJournal(record);
      this.reportMetrics(record);
    }
    this.timer = setInterval(() => {
      this.track(this.drainDue()).catch((error) =>
        this.logger.warn('Wake tick deferred', error.type)
      );
    }, this.settings.timerIntervalMs);
    this.timer.unref();
  },
  async stopped() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.settle();
  },
  methods: {
    now() {
      return this.settings.clock ? this.settings.clock() : Date.now();
    },
    track(work) {
      this.pending.add(work);
      work.finally(() => this.pending.delete(work)).catch(() => {});
      return work;
    },
    async settle() {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
    },
    functionId(id, _modelSourceHash = this.model.sourceHash) {
      if (this.model.functions.some((fn) => fn.functionId === id)) return id;
      const resolved = resolveFunctionId(id, { model: this.model });
      if (resolved.length !== 1) invalid('Function identity must resolve unambiguously');
      return resolved[0].functionId;
    },
    async load(id) {
      try {
        return await this.db.get(id);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    },
    async update(id, work) {
      for (let attempt = 0; attempt < this.settings.conflictRetries; attempt++) {
        const old = await this.load(id);
        const next = await work(old);
        if (!next) return old;
        try {
          const result = await this.db.put({
            ...next,
            _id: id,
            ...(old ? { _rev: old._rev } : {}),
          });
          return { ...next, _id: id, _rev: result.rev };
        } catch (error) {
          if (error.status !== 409) throw error;
        }
      }
      throw new Errors.MoleculerError('Wake revision contention', 409, 'WAKE_CONFLICT');
    },
    async records(tenantId) {
      const docs = (
        await this.db.allDocs({ startkey: 'wake:', endkey: 'wake:\uffff', include_docs: true })
      ).rows
        .map((row) => row.doc)
        .filter((doc) => doc && (!tenantId || doc.tenantId === tenantId))
        .filter(Boolean);
      const records = [];
      for (const doc of docs) {
        this.unresolvedWakeRecords ||= new Map();
        try {
          const functionId = this.functionId(doc.functionId, doc.modelSourceHash || null);
          this.unresolvedWakeRecords.delete(doc._id);
          const current =
            doc.functionId !== functionId || doc.modelSourceHash !== this.model.sourceHash
              ? await this.update(doc._id, (latest) =>
                  latest
                    ? {
                        ...latest,
                        functionId: this.functionId(latest.functionId),
                        modelSourceHash: this.model.sourceHash,
                      }
                    : null
                )
              : doc;
          if (current)
            records.push({ ...current, functionId: this.functionId(current.functionId) });
        } catch (error) {
          if (error.type !== 'WAKE_INVALID') throw error;
          // Model changes can remove or split stored identities. Keep their
          // state intact, but never schedule them or abort the whole broker.
          if (this.unresolvedWakeRecords.get(doc._id) !== doc._rev) {
            this.logger.warn('Wake record suspended: unresolved function identity', {
              recordId: doc._id,
              functionId: doc.functionId,
              modelSourceHash: doc.modelSourceHash || null,
              currentModelSourceHash: this.model.sourceHash || null,
            });
            this.unresolvedWakeRecords.set(doc._id, doc._rev);
          }
        }
      }
      return records.sort(
        (a, b) =>
          compareCanonicalStrings(a.tenantId, b.tenantId) ||
          compareCanonicalStrings(a.agentId, b.agentId)
      );
    },
    async activation(tenantId, functionId) {
      return (await this.load(`activation:${key(tenantId, functionId)}`))?.activation;
    },
    async receiveActivation(input) {
      if (
        !input.tenantId ||
        !['latent', 'active', 'dormant'].includes(input.state) ||
        typeof input.responsibility?.cet !== 'boolean'
      )
        invalid('Invalid activation');
      const functionId = this.functionId(input.functionId);
      const activation = { ...input, functionId };
      const id = `activation:${key(input.tenantId, functionId)}`;
      const previous = (await this.load(id))?.activation;
      await this.update(id, () => ({ activation }));
      const funded = Number(activation.attention?.replenishedUnits || 0);
      const replenished = funded > Number(previous?.attention?.replenishedUnits || 0);
      for (const item of (await this.records(input.tenantId)).filter(
        (r) => r.functionId === functionId
      )) {
        await this.update(item._id, (record) => {
          const permitted =
            activation.state === 'active' &&
            activation.responsibility.cet &&
            !activation.attention?.retired &&
            !activation.attention?.allowanceExhausted &&
            activation.attention?.allowance >= this.settings.minimumAllowance;
          const blocked = !permitted || (record.blocked && !replenished);
          return {
            ...record,
            blocked,
            tier: activation.attention?.tier || null,
            nextAt:
              blocked || record.lifecycle !== 'active' || record.wake.mode === 'event'
                ? null
                : (record.nextAt ?? this.now() + record.wake.intervalSec * 1000),
          };
        });
      }
    },
    async receiveLifecycle(input) {
      if (
        !input.tenantId ||
        !input.agentId ||
        !['proposed', 'active', 'sleeping', 'retired'].includes(input.lifecycle)
      )
        invalid('Invalid lifecycle');
      const functionId = this.functionId(input.functionId);
      const fn = this.model.functions.find((entry) => entry.functionId === functionId);
      const activation = await this.activation(input.tenantId, functionId);
      const id = `wake:${key(input.tenantId, input.agentId)}`;
      const record = await this.update(id, (old) => {
        if (old && this.functionId(old.functionId, old.modelSourceHash || null) !== functionId)
          invalid('Agent function mismatch');
        if (old?.lifecycle === input.lifecycle) return null;
        const wake =
          old?.wake ||
          deriveWake(fn, this.settings, this.availableEvents, this.settings.dataSources);
        const next = {
          ...old,
          tenantId: input.tenantId,
          agentId: input.agentId,
          functionId,
          modelSourceHash: this.model.sourceHash || null,
          lifecycle: input.lifecycle,
          wake,
          stats: old?.stats || {},
          blocked:
            ['sleeping', 'retired'].includes(input.lifecycle) ||
            old?.blocked ||
            !activation?.attention ||
            activation.attention.allowanceExhausted,
          sequence: old?.sequence || 0,
          eventKeys: old?.eventKeys || [],
          tier: activation?.attention?.tier || null,
        };
        next.nextAt =
          canWake(next, activation, this.settings) && wake.mode !== 'event'
            ? (old?.nextAt ?? this.now() + wake.intervalSec * 1000)
            : null;
        if (!old && wake.pushGaps.length) next.pendingGap = true;
        return next;
      });
      await this.flushJournal(record);
    },
    async receiveEvent(eventName, payload, deliveryId) {
      if (!payload?.tenantId || this.stopping) return;
      for (const record of await this.records(payload.tenantId)) {
        const fn = this.model.functions.find((entry) => entry.functionId === record.functionId);
        const wake = deriveWake(
          fn,
          this.settings,
          [...this.availableEvents, eventName],
          this.settings.dataSources
        );
        if (!eventMatches(fn, eventName, payload, wake)) continue;
        await this.update(record._id, (current) => ({
          ...current,
          wake: {
            ...current.wake,
            mode: this.settings.pushMode,
            events: wake.events,
            pushGaps: wake.pushGaps,
          },
          nextAt: this.settings.pushMode === 'event' ? null : current.nextAt,
        }));
        await this.invoke(record._id, 'event', payload.eventId || payload.messageId || deliveryId);
      }
    },
    async drainDue() {
      if (this.stopping || this.draining) return;
      this.draining = true;
      try {
        for (const record of await this.records()) {
          await this.flushJournal(record);
          if (record.wake.mode !== 'event' && record.nextAt !== null && record.nextAt <= this.now())
            await this.invoke(record._id, 'schedule');
        }
      } finally {
        this.draining = false;
      }
    },
    async invoke(id, trigger, eventId) {
      if (this.stopping) return;
      const current = await this.load(id);
      const activation = await this.activation(
        current.tenantId,
        this.functionId(current.functionId)
      );
      if (!canWake(current, activation, this.settings) || current.running || current.pendingJournal)
        return;
      if (trigger === 'schedule' && (current.wake.mode === 'event' || current.nextAt > this.now()))
        return;
      const eventKey = eventId && key(trigger, eventId);
      if (eventKey && current.eventKeys.includes(eventKey)) return;
      const cycleId = key(id, current.sequence + 1);
      const claim = { cycleId, owner: this.instanceId, startedAt: this.now(), trigger };
      const claimed = {
        ...current,
        sequence: current.sequence + 1,
        running: claim,
        pendingClaim: true,
        nextAt: null,
        eventKeys: eventKey
          ? [...current.eventKeys, eventKey].slice(-this.settings.eventHistoryLimit)
          : current.eventKeys,
      };
      try {
        await this.db.put(claimed);
      } catch (error) {
        if (error.status === 409) return;
        throw error;
      }
      let result;
      let errorClass;
      let dispatched = false;
      try {
        await this.flushJournal(await this.load(id));
        const latest = await this.load(id);
        const latestActivation = await this.activation(
          latest.tenantId,
          this.functionId(latest.functionId)
        );
        if (
          this.stopping ||
          latest.pendingClaim ||
          !canWake(latest, latestActivation, this.settings)
        )
          throw new Errors.MoleculerError('Wake blocked after claim', 409, 'WAKE_BLOCKED');
        dispatched = true;
        result = await this.broker.call('shared-service-agent.runCycle', {
          tenantId: current.tenantId,
          agentId: current.agentId,
        });
        adaptInterval(current.wake, result, this.settings, this.now());
      } catch (error) {
        errorClass = error.type || error.name || 'Error';
      }
      const completed = await this.update(id, (record) => {
        if (record.running?.cycleId !== cycleId) return null;
        const adapted = errorClass
          ? { intervalSec: record.wake.intervalSec, findingStreak: 0 }
          : adaptInterval(record.wake, result, this.settings, this.now());
        const stats = {
          ...wakeMetrics(record.stats),
          wakes: (record.stats.wakes || 0) + (dispatched ? 1 : 0),
          emptyWakes: (record.stats.emptyWakes || 0) + (!errorClass && !adapted.findings ? 1 : 0),
          pushWakes: (record.stats.pushWakes || 0) + (dispatched && trigger === 'event' ? 1 : 0),
          consumedUnits:
            (record.stats.consumedUnits || 0) + (!errorClass ? result.consumedUnits : 0),
          errors: (record.stats.errors || 0) + (errorClass ? 1 : 0),
        };
        const blocked = record.blocked || !!errorClass;
        return {
          ...record,
          wake: {
            ...record.wake,
            intervalSec: adapted.intervalSec,
            findingStreak: adapted.findingStreak,
          },
          stats,
          running: null,
          blocked,
          nextAt:
            !blocked && record.lifecycle === 'active' && record.wake.mode !== 'event'
              ? this.now() + adapted.intervalSec * 1000
              : null,
          pendingJournal: {
            cycleId,
            errorClass: errorClass || null,
            stats: wakeMetrics(stats),
            at: new Date(this.now()).toISOString(),
            trigger,
            findings: adapted.findings ?? null,
            beforeIntervalSec: current.wake.intervalSec,
            afterIntervalSec: adapted.intervalSec,
          },
        };
      });
      await this.flushJournal(completed);
      this.reportMetrics(completed);
    },
    reportMetrics(record) {
      const stats = wakeMetrics(record.stats);
      const labels = { tenantId: record.tenantId, agentId: record.agentId };
      for (const [name, value] of Object.entries({
        total: stats.wakes,
        empty: stats.emptyWakes,
        'push.share': stats.pushShare,
        'consumed.units': stats.consumedUnits,
      }))
        this.broker.metrics.set(`shared.service.wake.${name}`, value, labels);
    },
    async flushJournal(record) {
      if (!record) return;
      const meta = {
        apiToken: { tenantId: record.tenantId, id: record.agentId, roles: ['ROLE_USER'] },
      };
      const base = {
        tenantId: record.tenantId,
        functionId: this.functionId(record.functionId),
        agentId: record.agentId,
      };
      const append = async (entry) => {
        try {
          await this.broker.call('journal.append', { ...base, ...entry }, { meta });
        } catch (error) {
          if (error.code !== 409) throw error;
        }
      };
      try {
        if (record.pendingClaim && record.running) {
          await append({
            entryId: `wake-claim-${record.running.cycleId}`,
            kind: 'awaiting',
            summary: 'Wake cycle claimed; outcome pending.',
            refs: [],
          });
          await this.update(record._id, (latest) => ({ ...latest, pendingClaim: false }));
        }
        if (
          record.pendingGap &&
          canWake(
            record,
            await this.activation(record.tenantId, this.functionId(record.functionId)),
            this.settings
          )
        ) {
          await append({
            entryId: `wake-gap-${key(record._id, record.wake.pushGaps)}`,
            kind: 'awaiting',
            summary: 'Push source unavailable; scheduled observation is required.',
            refs: record.wake.pushGaps.map((gap) => ({
              kind: 'push-gap',
              id: gap.eventType,
              reason: gap.reason,
            })),
          });
          await this.update(record._id, (latest) => ({ ...latest, pendingGap: false }));
        }
        const entry = record.pendingJournal;
        if (entry) {
          await append({
            entryId: `wake-cycle-${entry.cycleId}`,
            kind: 'observed',
            at: entry.at,
            summary: entry.errorClass
              ? `Wake cycle stopped: ${entry.errorClass}`
              : `Wake cycle completed; findings=${entry.findings}; trigger=${entry.trigger}.`,
            refs: [
              { kind: 'wake-metrics', id: entry.cycleId, stats: entry.stats },
              { kind: 'journal', id: `wake-claim-${entry.cycleId}` },
            ],
          });
          await this.update(record._id, (latest) =>
            latest.pendingJournal?.cycleId === entry.cycleId
              ? { ...latest, pendingJournal: null }
              : null
          );
        }
      } catch (error) {
        this.logger.warn('Wake journal deferred', error.type || error.name);
      }
    },
  },
};
