'use strict';

// Self-improvement register, step 1 (#1010): failure signals are observed and kept, nothing is
// triggered. A signal carries no message text, only reason codes, sources and function ids, so it
// can later be bundled and anonymized without ever holding chat content.
const { randomUUID } = require('node:crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { KINDS } = require('../src/failure-signals');

const RETENTION_MS = Number(process.env.FAILURE_SIGNAL_RETENTION_DAYS || 90) * 24 * 3600 * 1000;
const PRUNE_INTERVAL_MS = 6 * 3600 * 1000;
// Consecutive turns of one conversation before a repetition or a clarification loop is a signal.
const REPEAT_TURNS = 2;
const CLARIFICATION_TURNS = 3;
const TRAIL_TTL_MS = 24 * 3600 * 1000;
// Corrections that only set attention or close an item are no failure of CET.
const NON_FAILURE_TARGETS = new Set(['agent', 'gap']);
const DEGRADED_LIFECYCLES = new Set(['degraded', 'retired']);

const short = (value, max = 200) =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined;
const admin = (p) => {
  if (!p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role)))
    deny('Admin role required');
};
const prefix = (tenantId) => `fs:${encodeURIComponent(tenantId)}:`;
const trailId = (tenantId, conversationId) =>
  `trail:${encodeURIComponent(tenantId)}:${encodeURIComponent(conversationId)}`;

module.exports = {
  name: 'failure-signals',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'FAILURE_SIGNALS_DB_PATH',
      defaultDbPath: './data/failure-signals',
    }),
  ],
  actions: {
    list: {
      params: {
        kind: { type: 'enum', values: KINDS, optional: true },
        since: { type: 'string', optional: true, max: 40 },
        limit: { type: 'number', integer: true, min: 1, max: 500, optional: true, default: 100 },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        admin(p);
        return (await this.signals(p.tenantId, ctx.params.since))
          .filter((signal) => !ctx.params.kind || signal.kind === ctx.params.kind)
          .slice(0, ctx.params.limit);
      },
    },
    summary: {
      params: { since: { type: 'string', optional: true, max: 40 } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const since = ctx.params.since || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const signals = await this.signals(p.tenantId, since);
        return {
          since,
          total: signals.length,
          byKind: Object.fromEntries(
            KINDS.map((kind) => [kind, signals.filter((signal) => signal.kind === kind).length])
          ),
        };
      },
    },
    // Internal entry for sources outside a turn (replay and harness runs, later steps).
    record: {
      visibility: 'protected',
      params: {
        tenantId: { type: 'string', min: 1, max: 200 },
        kind: { type: 'enum', values: KINDS },
        conversationId: { type: 'string', optional: true, max: 200 },
        turnRef: { type: 'string', optional: true, max: 120 },
        functionIds: { type: 'array', items: 'string', optional: true, max: 10 },
        sources: { type: 'array', optional: true, max: 10 },
        reason: { type: 'string', optional: true, max: 120 },
      },
      handler(ctx) {
        return this.record(ctx.params);
      },
    },
  },
  events: {
    'shared-service.correction.v1': {
      async handler(ctx) {
        const event = ctx.params || {};
        if (!event.tenantId || NON_FAILURE_TARGETS.has(event.target)) return;
        if (String(event.ref || '').startsWith('undo-')) return;
        await this.record({
          tenantId: event.tenantId,
          kind: 'user_correction',
          functionIds: [event.correction?.functionId || event.functionId].filter(Boolean),
          sources: [{ source: short(event.target, 80) || 'unknown' }],
          reason: short(event.correction?.kind, 120),
          origin: short(event.correctionId, 200),
        });
      },
    },
    'project.skill.lifecycle.v1': {
      async handler(ctx) {
        const event = ctx.params || {};
        if (!event.tenantId || !DEGRADED_LIFECYCLES.has(event.lifecycle)) return;
        await this.record({
          tenantId: event.tenantId,
          kind: 'skill_degraded',
          sources: [{ source: 'projectSkill', name: short(event.skillId, 120) }],
          reason: short(event.reason, 120),
        });
      },
    },
  },
  started() {
    this.pruneTimer = setInterval(() => {
      this.prune().catch((error) => this.logger.warn('Failure signal retention deferred', error));
    }, PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  },
  stopped() {
    clearInterval(this.pruneTimer);
  },
  methods: {
    async record(input) {
      const at = new Date().toISOString();
      const signal = {
        _id: `${prefix(input.tenantId)}${at}:${randomUUID()}`,
        type: 'failure_signal',
        signalId: randomUUID(),
        tenantId: input.tenantId,
        kind: input.kind,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.turnRef ? { turnRef: input.turnRef } : {}),
        functionIds: (input.functionIds || []).filter((id) => typeof id === 'string').slice(0, 10),
        sources: (input.sources || [])
          .map((item) => ({ source: short(item?.source, 80), name: short(item?.name, 120) }))
          .filter((item) => item.source)
          .slice(0, 10),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.streak ? { streak: input.streak } : {}),
        ...(input.origin ? { origin: input.origin } : {}),
        at,
      };
      await this.db.put(signal);
      const view = this.view(signal);
      await this.broker.emit('self-improvement.signal.v1', view);
      return view;
    },
    // One turn: direct signals plus the conversation trail for repetitions and loops.
    async observeTurn({ tenantId, conversationId, turnRef, outcome }) {
      const base = { tenantId, conversationId, turnRef, functionIds: outcome.functionIds };
      const recorded = [];
      if (outcome.unanswered)
        recorded.push(await this.record({ ...base, kind: 'unanswered', reason: outcome.reason }));
      if (outcome.timeouts.length)
        recorded.push(
          await this.record({ ...base, kind: 'source_timeout', sources: outcome.timeouts })
        );
      if (!conversationId) return recorded;
      const trail = await this.updateTrail(tenantId, conversationId, outcome);
      if (outcome.unanswered && trail.unanswered === REPEAT_TURNS)
        recorded.push(
          await this.record({ ...base, kind: 'repeated_question', streak: trail.unanswered })
        );
      if (outcome.openQuestions && trail.clarifications === CLARIFICATION_TURNS)
        recorded.push(
          await this.record({ ...base, kind: 'clarification_loop', streak: trail.clarifications })
        );
      return recorded;
    },
    async updateTrail(tenantId, conversationId, outcome) {
      const _id = trailId(tenantId, conversationId);
      const now = Date.now();
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await this.db.get(_id).catch(() => null);
        const fresh = existing && now - Date.parse(existing.at) < TRAIL_TTL_MS;
        const trail = {
          _id,
          ...(existing ? { _rev: existing._rev } : {}),
          type: 'failure_signal_trail',
          tenantId,
          unanswered: outcome.unanswered ? (fresh ? existing.unanswered : 0) + 1 : 0,
          clarifications: outcome.openQuestions ? (fresh ? existing.clarifications : 0) + 1 : 0,
          at: new Date(now).toISOString(),
        };
        try {
          await this.db.put(trail);
          return trail;
        } catch (error) {
          if (error.status !== 409) throw error;
        }
      }
      return { unanswered: 0, clarifications: 0 };
    },
    async signals(tenantId, since) {
      const start = prefix(tenantId);
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: since ? `${start}${since}` : start,
        endkey: `${start}￿`,
      });
      return result.rows
        .map((row) => row.doc)
        .filter((doc) => doc.tenantId === tenantId && doc.type === 'failure_signal')
        .map((doc) => this.view(doc))
        .reverse();
    },
    async prune() {
      const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
      const result = await this.db.allDocs({ include_docs: true });
      const expired = result.rows
        .map((row) => row.doc)
        .filter(
          (doc) =>
            ['failure_signal', 'failure_signal_trail'].includes(doc.type) &&
            String(doc.at) <
              (doc.type === 'failure_signal_trail'
                ? new Date(Date.now() - TRAIL_TTL_MS).toISOString()
                : cutoff)
        )
        .map((doc) => ({ ...doc, _deleted: true }));
      if (expired.length) await this.db.bulkDocs(expired);
      return expired.length;
    },
    view(doc) {
      const { _id, _rev, type, ...signal } = doc;
      return signal;
    },
  },
};
