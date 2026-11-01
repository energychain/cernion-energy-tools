'use strict';

// Tenant register of knowledge needs (#997). The needs themselves are the generated, versioned
// projection `knowledge-needs.json`; this service keeps their tenant-specific state. Learned
// knowledge never changes permissions: this register holds no role, clearance or domain grant.
const path = require('node:path');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');

const STATES = ['unknown', 'asked', 'answered', 'confirmed', 'disputed', 'stale'];
const TRANSITIONS = {
  unknown: ['asked', 'answered', 'stale'],
  asked: ['asked', 'unknown', 'answered', 'stale'],
  answered: ['answered', 'confirmed', 'disputed', 'stale'],
  confirmed: ['disputed', 'stale', 'answered'],
  disputed: ['answered', 'confirmed', 'stale'],
  stale: ['unknown', 'answered'],
};
const AUDIT_LIMIT = 50;
const BACKFILL_FACTS = 100;
const ASK_MIN_SCORE = Number(process.env.KNOWLEDGE_ASK_MIN_SCORE || 0.35);
const ASK_COOLDOWN_ACTOR_MS = 7 * 24 * 3600 * 1000;
const ASK_COOLDOWN_TENANT_MS = 24 * 3600 * 1000;
const COVERAGE_MIN = Number(process.env.KNOWLEDGE_COVERAGE_MIN || 0.3);
const CONFIRM_MIN_UNLOCKS = Number(process.env.KNOWLEDGE_CONFIRM_MIN_UNLOCKS || 10);

function loadArtifact(file) {
  // A fresh read per version check keeps a regenerated artifact effective without restart.
  return JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
}

function docId(tenantId, needId) {
  return `kn:${encodeURIComponent(tenantId)}:${needId}`;
}

module.exports = {
  name: 'knowledge-needs',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'KNOWLEDGE_NEEDS_DB_PATH',
      defaultDbPath: './data/knowledge-needs',
      indexes: [['tenantId', 'state']],
    }),
  ],
  settings: {
    artifactPath: path.join(__dirname, '..', 'knowledge-needs.json'),
  },
  created() {
    this.initialized = new Map();
  },
  actions: {
    list: {
      params: {
        state: { type: 'enum', values: STATES, optional: true },
        kind: { type: 'string', optional: true, max: 40 },
        limit: { type: 'number', integer: true, min: 1, max: 500, optional: true, default: 100 },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        await this.reconcile(ctx, p);
        const docs = await this.tenantDocs(p.tenantId);
        return docs
          .filter((doc) => !ctx.params.state || doc.state === ctx.params.state)
          .filter((doc) => !ctx.params.kind || doc.kind === ctx.params.kind)
          .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
          .slice(0, ctx.params.limit)
          .map((doc) => this.view(doc));
      },
    },
    get: {
      params: { needId: { type: 'string', max: 300 } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        await this.ensureTenant(p.tenantId);
        const doc = await this.db.get(docId(p.tenantId, ctx.params.needId)).catch(() => null);
        if (!doc || doc.tenantId !== p.tenantId) deny('Unknown knowledge need');
        return this.view(doc);
      },
    },
    summary: {
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const docs = await this.tenantDocs(p.tenantId);
        return {
          total: docs.length,
          byState: Object.fromEntries(
            STATES.map((state) => [state, docs.filter((doc) => doc.state === state).length])
          ),
          derivation: this.artifact().derivation,
        };
      },
    },
    // Internal: later steps (recognition, asking, confirmation) move needs through this.
    markState: {
      visibility: 'protected',
      params: {
        needId: { type: 'string', max: 300 },
        state: { type: 'enum', values: STATES },
        reason: { type: 'string', max: 200 },
        answerRef: { type: 'string', max: 300, optional: true },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        await this.ensureTenant(p.tenantId);
        const doc = await this.db.get(docId(p.tenantId, ctx.params.needId)).catch(() => null);
        if (!doc || doc.tenantId !== p.tenantId) deny('Unknown knowledge need');
        if (!TRANSITIONS[doc.state].includes(ctx.params.state))
          deny(`Transition ${doc.state} -> ${ctx.params.state} is not allowed`);
        const from = doc.state;
        const updated = {
          ...doc,
          state: ctx.params.state,
          answers: ctx.params.answerRef
            ? [
                ...(doc.answers || []).filter((answer) => answer.answerId !== ctx.params.answerRef),
                { answerId: ctx.params.answerRef },
              ]
            : doc.answers || [],
          audit: [
            ...(doc.audit || []),
            {
              at: new Date().toISOString(),
              actorId: p.actorId || null,
              from,
              to: ctx.params.state,
              reason: ctx.params.reason,
            },
          ].slice(-AUDIT_LIMIT),
          updatedAt: new Date().toISOString(),
        };
        await this.db.put(updated);
        this.broker.emit('knowledge.need.changed.v1', {
          tenantId: p.tenantId,
          needId: doc.needId,
          state: updated.state,
        });
        return this.view(updated);
      },
    },
    // Internal (#997 step 3): at most one open need that fits the current turn; recorded as asked.
    selectAsk: {
      visibility: 'protected',
      params: {
        conversationId: { type: 'string', max: 300 },
        capabilities: { type: 'array', items: 'string', optional: true, default: [] },
        operations: { type: 'array', items: 'string', optional: true, default: [] },
        functionIds: { type: 'array', items: 'string', optional: true, default: [] },
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const docs = await this.tenantDocs(p.tenantId);
        const now = Date.now();
        const capabilities = new Set(ctx.params.capabilities);
        const operations = new Set(ctx.params.operations);
        const functions = new Set(ctx.params.functionIds);
        // Functions this person covers: open needs there reach them, not everyone (#997 step 4).
        const covered = new Set(
          (await this.coverage(p.tenantId, { actorId: p.actorId }))
            .filter((row) => row.score >= COVERAGE_MIN)
            .map((row) => row.functionId)
        );
        const openDocs = docs.filter(
          (doc) => ['unknown', 'asked'].includes(doc.state) && doc.kind !== 'dataset'
        );
        // Facts come from the performing person once a role is known (#1019 A3).
        const roles = await this.roles(
          p.tenantId,
          openDocs.flatMap((doc) => doc.functionIds || [])
        );
        const scored = openDocs
          .filter((doc) => {
            const performers = this.actorsWithRole(roles, doc.functionIds, 'D');
            return !performers.length || performers.includes(p.actorId);
          })
          .filter(
            (doc) =>
              !(doc.asks || []).some(
                (ask) =>
                  now - Date.parse(ask.askedAt) <
                  (ask.actorId === p.actorId ? ASK_COOLDOWN_ACTOR_MS : ASK_COOLDOWN_TENANT_MS)
              )
          )
          .map((doc) => {
            // Fit to the current work: shared capabilities, operations or functions.
            const overlap =
              (doc.unlocks || []).filter(
                (entry) => capabilities.has(entry.capabilityId) || operations.has(entry.operation)
              ).length + (doc.functionIds || []).filter((id) => functions.has(id)).length;
            const coveredOverlap = (doc.functionIds || []).filter((id) => covered.has(id)).length;
            const reason = overlap ? 'current_task' : 'neighbor_function';
            const fit = overlap
              ? Math.min(1, overlap / 3) * 0.6
              : Math.min(1, coveredOverlap) * 0.5;
            return {
              doc,
              overlap: overlap || coveredOverlap,
              reason,
              score: fit + doc.priority * 0.4,
            };
          })
          .filter((entry) => entry.overlap > 0 && entry.score >= ASK_MIN_SCORE)
          .sort((a, b) => b.score - a.score || a.doc.key.localeCompare(b.doc.key));
        const chosen = scored[0]?.doc;
        if (!chosen) return null;
        const reason = scored[0].reason;
        const askedAt = new Date().toISOString();
        const ask = {
          askId: `ask:${ctx.params.conversationId}:${askedAt}`,
          actorId: p.actorId || null,
          conversationId: ctx.params.conversationId,
          mode: reason === 'current_task' ? 'inline' : 'notice',
          reason,
          askedAt,
          expiresAt: new Date(now + ASK_COOLDOWN_ACTOR_MS).toISOString(),
          outcome: null,
        };
        const updated = {
          ...chosen,
          state: 'asked',
          asks: [...(chosen.asks || []), ask].slice(-AUDIT_LIMIT),
          audit: [
            ...(chosen.audit || []),
            {
              at: askedAt,
              actorId: ask.actorId,
              from: chosen.state,
              to: 'asked',
              reason: 'inline',
            },
          ].slice(-AUDIT_LIMIT),
          updatedAt: askedAt,
        };
        await this.db.put(updated);
        this.broker.emit('knowledge.ask.v1', {
          tenantId: p.tenantId,
          needId: chosen.needId,
          actorId: ask.actorId,
          mode: ask.mode,
        });
        return {
          needId: chosen.needId,
          key: chosen.key,
          label: chosen.label,
          kind: chosen.kind,
          reason,
        };
      },
    },
    // Internal (#997 step 2): link newly captured tenant-memory facts to the needs they answer.
    recognizeFacts: {
      visibility: 'protected',
      params: { factIds: { type: 'array', items: 'string', min: 1, max: 20 } },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const store = require('../src/tenant-memory-store');
        const facts = (
          await Promise.all(
            ctx.params.factIds.map((id) =>
              store
                .get(ctx, p, id)
                .then((doc) => doc.payload)
                .catch(() => null)
            )
          )
        ).filter((fact) => fact?.status === 'valid');
        const recorded = await this.recognize(ctx, p, facts);
        await this.backfill(ctx, p);
        await this.requestConfirmations(ctx, p, recorded);
        await this.reconcile(ctx, p);
        return recorded;
      },
    },
  },
  methods: {
    async roles(tenantId, functionIds) {
      const service = this.broker.getLocalService('role-proposals');
      if (typeof service?.rolesFor !== 'function' || !functionIds?.length) return {};
      return service.rolesFor(tenantId, [...new Set(functionIds)]).catch(() => ({}));
    },
    actorsWithRole(roles, functionIds, role) {
      return [
        ...new Set(
          (functionIds || []).flatMap((functionId) =>
            (roles[functionId] || [])
              .filter((row) => row.role === role && row.actorRef.actorType === 'user')
              .map((row) => row.actorRef.actorId)
          )
        ),
      ];
    },
    async coverage(tenantId, filter) {
      const service = this.broker.getLocalService('function-coverage');
      if (typeof service?.coverageRows !== 'function') return [];
      return service.coverageRows(tenantId, filter).catch(() => []);
    },
    // An answer with wide reach is confirmed by a second person with coverage, through the existing
    // tenant-memory confirmation notice for the source fact.
    async requestConfirmations(ctx, p, recorded) {
      if (!recorded.length || !this.broker.getLocalService('shared-service-notices')) return;
      const docs = await this.tenantDocs(p.tenantId);
      for (const item of recorded) {
        const doc = docs.find((entry) => entry.needId === item.needId);
        const answer = doc?.answers?.find((entry) => entry.answerId === item.answerId);
        if (!doc || !answer?.storeRef || (doc.unlocks || []).length < CONFIRM_MIN_UNLOCKS) continue;
        // The accountable person confirms (#1019 A3); without a role, a second covering person.
        const roles = await this.roles(p.tenantId, doc.functionIds);
        const accountable = this.actorsWithRole(roles, doc.functionIds, 'V').find(
          (actorId) => actorId !== answer.actorId
        );
        const second = accountable
          ? { actorId: accountable }
          : (await this.coverage(p.tenantId, { functionIds: doc.functionIds })).find(
              (row) => row.score >= COVERAGE_MIN && row.actorId !== answer.actorId
            );
        // Informed people get the change as a notice, without being asked.
        for (const informed of this.actorsWithRole(roles, doc.functionIds, 'I').filter(
          (actorId) => actorId !== answer.actorId && actorId !== second?.actorId
        ))
          await ctx
            .call('shared-service-notices.enqueueMemory', {
              tenantId: p.tenantId,
              actorId: informed,
              relationId: answer.storeRef,
              factIds: [answer.storeRef],
            })
            .catch(() => null);
        if (!second) continue;
        const queued = await ctx
          .call('shared-service-notices.enqueueMemory', {
            tenantId: p.tenantId,
            actorId: second.actorId,
            relationId: answer.storeRef,
            factIds: [answer.storeRef],
            confirmation: true,
          })
          .catch(() => ({ queued: false }));
        if (!queued.queued) continue;
        const now = new Date().toISOString();
        await this.db.put({
          ...doc,
          asks: [
            ...(doc.asks || []),
            {
              askId: `ask:confirm:${answer.answerId}`,
              actorId: second.actorId,
              mode: 'notice',
              reason: 'confirmation',
              askedAt: now,
              outcome: null,
            },
          ].slice(-AUDIT_LIMIT),
          updatedAt: now,
        });
        this.broker.emit('knowledge.ask.v1', {
          tenantId: p.tenantId,
          needId: doc.needId,
          actorId: second.actorId,
          mode: 'notice',
        });
      }
    },
    // The source fact decides: confirmed by another person, disputed by a conflict or a
    // correction, open again when it was withdrawn. Uses the tenant-memory lifecycle as is.
    async reconcile(ctx, p) {
      const store = require('../src/tenant-memory-store');
      const docs = (await this.tenantDocs(p.tenantId)).filter((doc) =>
        ['answered', 'confirmed', 'disputed'].includes(doc.state)
      );
      for (const doc of docs) {
        const answer = [...(doc.answers || [])]
          .filter((entry) => entry.storeRef)
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
        if (!answer) continue;
        const fact = await store
          .get(ctx, p, answer.storeRef)
          .then((entry) => entry.payload)
          .catch(() => null);
        if (!fact) continue;
        let next = doc.state;
        if (!store.active(fact)) next = 'disputed';
        else {
          const relations = (
            await Promise.all(
              (fact.relationIds || []).map((id) =>
                store
                  .get(ctx, p, id)
                  .then((entry) => entry.payload)
                  .catch(() => null)
              )
            )
          ).filter((relation) => relation?.type === 'tenant_memory_relation');
          const others = async (relation) =>
            (
              await Promise.all(
                relation.factIds
                  .filter((id) => id !== fact.id)
                  .map((id) =>
                    store
                      .get(ctx, p, id)
                      .then((entry) => entry.payload)
                      .catch(() => null)
                  )
              )
            ).filter((other) => other && store.active(other));
          for (const relation of relations) {
            const linked = await others(relation);
            if (relation.kind === 'conflict' && linked.length) next = 'disputed';
            else if (
              relation.kind === 'confirmation' &&
              next !== 'disputed' &&
              linked.some((other) => (other.person?.actorId || '') !== answer.actorId)
            )
              next = 'confirmed';
          }
        }
        if (next === doc.state || !TRANSITIONS[doc.state].includes(next)) continue;
        const now = new Date().toISOString();
        await this.db.put({
          ...doc,
          state: next,
          audit: [
            ...(doc.audit || []),
            { at: now, actorId: null, from: doc.state, to: next, reason: 'source_fact' },
          ].slice(-AUDIT_LIMIT),
          updatedAt: now,
        });
        this.broker.emit('knowledge.need.changed.v1', {
          tenantId: p.tenantId,
          needId: doc.needId,
          state: next,
        });
      }
    },
    // Local read of open needs for the second capture path inside an authenticated turn.
    async openNeeds(tenantId) {
      return (await this.tenantDocs(tenantId))
        .filter((doc) => ['unknown', 'asked'].includes(doc.state))
        .map((doc) => this.view(doc));
    },
    // Local read for prefills inside an authenticated turn of the same tenant (#997 step 5).
    async answeredNeeds(tenantId) {
      return (await this.tenantDocs(tenantId))
        .filter((doc) => ['answered', 'confirmed'].includes(doc.state))
        .map((doc) => this.view(doc));
    },
    // Facts captured before the register existed are matched once per tenant and derivation.
    async backfill(ctx, p) {
      const marker = `kn-meta:${encodeURIComponent(p.tenantId)}`;
      const meta = await this.db.get(marker).catch(() => null);
      const version = this.artifact().sourceHash;
      if (meta?.backfilled === version) return;
      const facts = (
        await require('../src/tenant-memory-store').query(ctx, p, {
          'payload.type': 'tenant_memory_fact',
        })
      )
        .filter((fact) => fact.status === 'valid')
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, BACKFILL_FACTS);
      const { MAX_FACTS } = require('../src/knowledge-need-recognition');
      for (let start = 0; start < facts.length; start += MAX_FACTS)
        await this.recognize(ctx, p, facts.slice(start, start + MAX_FACTS));
      await this.db.put({
        ...(meta || { _id: marker, type: 'knowledge_need_meta', tenantId: p.tenantId }),
        backfilled: version,
        updatedAt: new Date().toISOString(),
      });
    },
    async recognize(ctx, p, facts) {
      if (!facts.length) return [];
      const docs = await this.tenantDocs(p.tenantId);
      // A fact that already answers a need is not reused for a neighbouring one.
      const used = new Set(
        docs.flatMap((doc) => (doc.answers || []).map((answer) => answer.storeRef).filter(Boolean))
      );
      facts = facts.filter((fact) => !used.has(fact.id));
      if (!facts.length) return [];
      const open = docs.filter((doc) => ['unknown', 'asked', 'stale'].includes(doc.state));
      const matches = await require('../src/knowledge-need-recognition').matchFacts(facts, open, {
        tenantId: p.tenantId,
        broker: this.broker,
      });
      const byFact = new Map(facts.map((fact) => [fact.id, fact]));
      const recorded = [];
      for (const match of matches) {
        const doc = docs.find((item) => item.needId === match.needId);
        // One answer per need and batch; a later fact can still update it in its own turn.
        if (!doc || recorded.some((item) => item.needId === doc.needId)) continue;
        const fact = byFact.get(match.factId);
        const answer = {
          answerId: `answer:${match.factId}`,
          value: match.value.trim(),
          confidence: match.confidence,
          evidence: { quote: match.value.trim(), factId: fact.id },
          storedAs: 'memory',
          storeRef: fact.id,
          actorId: fact.person?.actorId || fact.recoveryPrincipal?.actorId || null,
          conversationId: fact.conversationId || null,
          at: new Date().toISOString(),
        };
        const now = new Date().toISOString();
        const updated = {
          ...doc,
          state: 'answered',
          answers: [
            ...(doc.answers || []).filter((item) => item.answerId !== answer.answerId),
            answer,
          ],
          audit: [
            ...(doc.audit || []),
            {
              at: now,
              actorId: answer.actorId,
              from: doc.state,
              to: 'answered',
              reason: 'recognized',
            },
          ].slice(-AUDIT_LIMIT),
          updatedAt: now,
        };
        await this.db.put(updated);
        this.broker.emit('knowledge.need.changed.v1', {
          tenantId: p.tenantId,
          needId: doc.needId,
          state: 'answered',
        });
        this.broker.emit('knowledge.answered.v1', {
          tenantId: p.tenantId,
          needId: doc.needId,
          answerId: answer.answerId,
          storedAs: answer.storedAs,
        });
        recorded.push({ needId: doc.needId, answerId: answer.answerId, value: answer.value });
      }
      return recorded;
    },
    artifact() {
      return loadArtifact(this.settings.artifactPath);
    },
    // Storage keys and the tenant binding stay internal.
    view(doc) {
      return Object.fromEntries(
        Object.entries(doc).filter(([key]) => !['_id', '_rev', 'tenantId'].includes(key))
      );
    },
    async tenantDocs(tenantId) {
      await this.ensureTenant(tenantId);
      const prefix = `kn:${encodeURIComponent(tenantId)}:`;
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}￰`,
      });
      return result.rows.map((row) => row.doc).filter((doc) => doc.tenantId === tenantId);
    },
    // Lazy, versioned initialization: new needs start unknown, removed ones become stale,
    // states and answers of continuing needs are kept.
    async ensureTenant(tenantId) {
      const artifact = this.artifact();
      if (this.initialized.get(tenantId) === artifact.sourceHash) return;
      const prefix = `kn:${encodeURIComponent(tenantId)}:`;
      const existing = new Map(
        (
          await this.db.allDocs({ include_docs: true, startkey: prefix, endkey: `${prefix}￰` })
        ).rows.map((row) => [row.doc.needId, row.doc])
      );
      const now = new Date().toISOString();
      const writes = [];
      for (const need of artifact.needs) {
        const doc = existing.get(need.needId);
        const definition = {
          key: need.key,
          label: need.label,
          kind: need.kind,
          priority: need.basePriority,
          functionIds: need.functionIds,
          unlocks: need.unlocks,
          derivedFrom: need.derivedFrom,
          derivationVersion: artifact.derivation.version,
        };
        if (!doc)
          writes.push({
            _id: docId(tenantId, need.needId),
            type: 'knowledge_need',
            tenantId,
            needId: need.needId,
            ...definition,
            state: 'unknown',
            answers: [],
            audit: [],
            createdAt: now,
            updatedAt: now,
          });
        else if (doc.derivationVersion !== definition.derivationVersion || doc.state === 'stale')
          writes.push({
            ...doc,
            ...definition,
            state: doc.state === 'stale' ? 'unknown' : doc.state,
            updatedAt: now,
          });
      }
      const current = new Set(artifact.needs.map((need) => need.needId));
      for (const doc of existing.values())
        if (!current.has(doc.needId) && doc.state !== 'stale')
          writes.push({ ...doc, state: 'stale', updatedAt: now });
      if (writes.length) await this.db.bulkDocs(writes);
      this.initialized.set(tenantId, artifact.sourceHash);
    },
  },
};
