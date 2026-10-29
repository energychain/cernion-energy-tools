'use strict';

// Self-improvement register (#1010). Step 1: failure signals are observed and kept. Step 2:
// similar signals become a FailureCase with a proposed level; nothing is fixed or published yet.
// Signals and cases hold no message text, only reason codes, sources and function ids, so they
// can later be anonymized without ever holding chat content.
const { randomUUID } = require('node:crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { KINDS } = require('../src/failure-signals');
const cases = require('../src/failure-cases');

const RETENTION_MS = Number(process.env.FAILURE_SIGNAL_RETENTION_DAYS || 90) * 24 * 3600 * 1000;
const PRUNE_INTERVAL_MS = 6 * 3600 * 1000;
// Consecutive turns of one conversation before a repetition or a clarification loop is a signal.
const REPEAT_TURNS = 2;
const CLARIFICATION_TURNS = 3;
const TRAIL_TTL_MS = 24 * 3600 * 1000;
// Corrections that only set attention or close an item are no failure of CET.
const NON_FAILURE_TARGETS = new Set(['agent', 'gap']);
const DEGRADED_LIFECYCLES = new Set(['degraded', 'retired']);
// Bundling: signals of one key count within this window; an open case without new signals for
// STALE_MS becomes stale. Classification calls are capped per tenant and day.
const CASE_WINDOW_MS = 7 * 24 * 3600 * 1000;
const STALE_MS = 30 * 24 * 3600 * 1000;
const CLASSIFY_PER_DAY = Number(process.env.FAILURE_CASE_CLASSIFY_PER_DAY || 20);
const TERMINAL = new Set(['resolved_runtime', 'merged', 'rejected', 'stale']);
const BUNDLE_ATTEMPTS = 4;

const short = (value, max = 200) =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined;
const admin = (p) => {
  if (!p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role)))
    deny('Admin role required');
};
const prefix = (tenantId) => `fs:${encodeURIComponent(tenantId)}:`;
const bundleId = (tenantId, key) =>
  `case:${encodeURIComponent(tenantId)}:${encodeURIComponent(key)}`;
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
        const overview = await this.caseOverview(p.tenantId, since);
        return {
          since,
          total: signals.length,
          byKind: Object.fromEntries(
            KINDS.map((kind) => [kind, signals.filter((signal) => signal.kind === kind).length])
          ),
          cases: { total: overview.total, byLevel: overview.byLevel, byStatus: overview.byStatus },
        };
      },
    },
    cases: {
      params: {
        status: { type: 'enum', values: cases.STATUSES, optional: true },
        level: { type: 'enum', values: cases.LEVELS, optional: true },
        limit: { type: 'number', integer: true, min: 1, max: 200, optional: true, default: 50 },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        admin(p);
        return (await this.caseDocs(p.tenantId))
          .filter((doc) => !ctx.params.status || doc.status === ctx.params.status)
          .filter((doc) => !ctx.params.level || doc.level === ctx.params.level)
          .sort((a, b) => String(b.lastSignalAt).localeCompare(String(a.lastSignalAt)))
          .slice(0, ctx.params.limit)
          .map((doc) => this.caseView(doc));
      },
    },
    // Internal: later steps (runtime fixes, issues, PRs) move cases through this.
    setCaseStatus: {
      visibility: 'protected',
      params: {
        tenantId: { type: 'string', min: 1, max: 200 },
        caseId: { type: 'string', min: 1, max: 100 },
        status: { type: 'enum', values: cases.STATUSES },
        refs: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const doc = (await this.caseDocs(ctx.params.tenantId)).find(
          (item) => item.caseId === ctx.params.caseId
        );
        if (!doc) deny('Unknown failure case');
        const refs = Object.fromEntries(
          Object.entries(ctx.params.refs || {})
            .filter(([key, value]) => ['skillId', 'issue', 'pr'].includes(key) && value != null)
            .map(([key, value]) => [key, String(value).slice(0, 200)])
        );
        const next = {
          ...doc,
          status: ctx.params.status,
          refs: { ...(doc.refs || {}), ...refs },
          updatedAt: new Date().toISOString(),
        };
        await this.db.put(next);
        await this.caseChanged(next);
        return this.caseView(next);
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
  created() {
    this.inflight = new Set();
    this.classifyBudget = new Map();
  },
  started() {
    this.pruneTimer = setInterval(() => {
      this.prune().catch((error) => this.logger.warn('Failure signal retention deferred', error));
    }, PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  },
  async stopped() {
    clearInterval(this.pruneTimer);
    await this.idle();
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
      await this.bundle(view).catch((error) =>
        this.logger.warn('Failure signal not bundled', error.message)
      );
      return view;
    },
    // Merge a signal into the bundle of its key; at the threshold the bundle becomes a case.
    async bundle(signal) {
      const key = cases.dedupKey(signal);
      const _id = bundleId(signal.tenantId, key);
      for (let attempt = 0; attempt < BUNDLE_ATTEMPTS; attempt++) {
        const existing = await this.db.get(_id).catch(() => null);
        const expired =
          existing &&
          !existing.caseId &&
          Date.parse(signal.at) - Date.parse(existing.lastSignalAt) > CASE_WINDOW_MS;
        const base =
          existing && !expired
            ? existing
            : {
                _id,
                ...(existing ? { _rev: existing._rev } : {}),
                type: 'failure_case',
                tenantId: signal.tenantId,
                kind: signal.kind,
                dedupKey: key,
                createdAt: signal.at,
              };
        let doc = cases.merge(base, signal);
        let changed = false;
        const due = doc.count >= cases.threshold(doc.kind, this.settings.caseThresholds);
        if (!doc.caseId && due) {
          doc = {
            ...doc,
            caseId: randomUUID(),
            status: 'open',
            level: cases.PRIOR_LEVEL[doc.kind] || 'C',
            levelReason: 'Vorschlag nach Signalart; Einstufung ausstehend.',
            summary: cases.readable(doc),
            reproduction: { steps: doc.steps, observed: cases.observed(doc), expected: '' },
            anonymization: { state: 'pending', checks: [] },
            refs: {},
            openedAt: signal.at,
          };
          changed = true;
        } else if (doc.caseId && TERMINAL.has(doc.status)) {
          // A fixed or stale case that fails again is reopened, not duplicated.
          doc = { ...doc, status: 'open', reopenedAt: signal.at };
          changed = true;
        }
        if (doc.caseId)
          doc.reproduction = {
            ...doc.reproduction,
            steps: doc.steps,
            observed: cases.observed(doc),
          };
        try {
          const { rev } = await this.db.put(doc);
          doc._rev = rev;
        } catch (error) {
          if (error.status === 409) continue;
          throw error;
        }
        if (changed) {
          await this.caseChanged(doc);
          this.track(this.classifyCase(doc.tenantId, _id));
        }
        return doc;
      }
      throw new Error('Failure case update conflicted');
    },
    async classifyCase(tenantId, _id) {
      const day = new Date().toISOString().slice(0, 10);
      const budgetKey = `${tenantId}\u0000${day}`;
      const used = this.classifyBudget.get(budgetKey) || 0;
      if (used >= CLASSIFY_PER_DAY) return null;
      this.classifyBudget.set(budgetKey, used + 1);
      if (this.classifyBudget.size > 1000) this.classifyBudget.clear();
      const current = await this.db.get(_id);
      const proposal = await cases.classify(current, {
        tenantId,
        broker: this.broker,
        functionLabels: this.functionLabels(current.functionIds),
      });
      for (let attempt = 0; attempt < BUNDLE_ATTEMPTS; attempt++) {
        const latest = await this.db.get(_id);
        const next = {
          ...latest,
          level: proposal.level,
          levelReason: proposal.levelReason,
          summary: proposal.summary || latest.summary,
          hypothesis: proposal.hypothesis,
          classifiedBy: proposal.classifiedBy,
          reproduction: { ...latest.reproduction, expected: proposal.expected },
          classifiedAt: new Date().toISOString(),
        };
        try {
          await this.db.put(next);
          await this.caseChanged(next);
          return next;
        } catch (error) {
          if (error.status !== 409) throw error;
        }
      }
      return null;
    },
    functionLabels(ids = []) {
      if (!ids.length) return {};
      const wanted = new Set(ids);
      return Object.fromEntries(
        require('../src/function-model')
          .getFunctionModel()
          .functions.filter((fn) => wanted.has(fn.functionId))
          .map((fn) => [fn.functionId, fn.label])
      );
    },
    track(promise) {
      const tracked = promise
        .catch((error) => this.logger.warn('Failure case not classified', error.message))
        .finally(() => this.inflight.delete(tracked));
      this.inflight.add(tracked);
    },
    // Resolves once pending classifications have finished (tests, orderly shutdown).
    async idle() {
      while (this.inflight.size) await Promise.all([...this.inflight]);
    },
    caseChanged(doc) {
      return this.broker.emit('self-improvement.case.changed.v1', this.caseView(doc));
    },
    async caseDocs(tenantId) {
      const start = `case:${encodeURIComponent(tenantId)}:`;
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: start,
        endkey: `${start}\uffff`,
      });
      return result.rows
        .map((row) => row.doc)
        .filter((doc) => doc.tenantId === tenantId && doc.type === 'failure_case' && doc.caseId);
    },
    // Counts and the latest cases, for the summary and the self-report (#700).
    async caseOverview(tenantId, since) {
      const docs = (await this.caseDocs(tenantId)).filter(
        (doc) => !since || String(doc.lastSignalAt) >= since || String(doc.openedAt) >= since
      );
      const count = (field, values) =>
        Object.fromEntries(
          values.map((value) => [value, docs.filter((doc) => doc[field] === value).length])
        );
      return {
        total: docs.length,
        byLevel: count('level', cases.LEVELS),
        byStatus: count('status', cases.STATUSES),
        latest: docs
          .sort((a, b) => String(b.lastSignalAt).localeCompare(String(a.lastSignalAt)))
          .slice(0, 5)
          .map((doc) => this.caseView(doc)),
      };
    },
    caseView(doc) {
      const { _id, _rev, type, steps, signals, ...rest } = doc;
      return { ...rest, signals: signals || [] };
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
      const now = Date.now();
      const old = (doc, ms) => now - Date.parse(doc.lastSignalAt) > ms;
      const bundles = result.rows
        .map((row) => row.doc)
        .filter((doc) => doc.type === 'failure_case')
        .flatMap((doc) => {
          // Pending bundles leave the window; quiet open cases become stale; old closed ones go.
          if (!doc.caseId) return old(doc, CASE_WINDOW_MS) ? [{ ...doc, _deleted: true }] : [];
          if (TERMINAL.has(doc.status))
            return old(doc, RETENTION_MS) ? [{ ...doc, _deleted: true }] : [];
          return old(doc, STALE_MS)
            ? [{ ...doc, status: 'stale', updatedAt: new Date(now).toISOString() }]
            : [];
        });
      const changes = [...expired, ...bundles];
      if (changes.length) await this.db.bulkDocs(changes);
      for (const doc of bundles.filter((item) => !item._deleted)) await this.caseChanged(doc);
      return changes.length;
    },
    view(doc) {
      const { _id, _rev, type, ...signal } = doc;
      return signal;
    },
  },
};
