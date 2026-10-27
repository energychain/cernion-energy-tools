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
        return recorded;
      },
    },
  },
  methods: {
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
