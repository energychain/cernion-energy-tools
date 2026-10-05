'use strict';

const { randomUUID } = require('node:crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { getFunctionModel } = require('../src/function-model');
const { correctionPrincipal, validateCorrection } = require('../src/shared-service-learning');
const { compareCanonicalStrings } = require('../src/canonical-order');

const admin = (p) => {
  if (!p.roles.some((r) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(r)))
    deny('Admin role required');
};
const id = { type: 'string', min: 1, max: 256 };
const correctionParams = {
  target: { type: 'enum', values: ['coverage', 'activation', 'agent', 'neighbor'] },
  correction: 'object',
  correctionId: { ...id, optional: true },
  tenantId: { ...id, optional: true },
};
const action = (rest, summary, handler, params = {}) => ({
  rest,
  params,
  openapi: { summary },
  handler,
});
module.exports = {
  name: 'shared-service-learning',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'SHARED_SERVICE_LEARNING_DB_PATH',
      defaultDbPath: './data/shared-service-learning',
    }),
  ],
  settings: { model: null, maxRecordsPerTenant: 2048 },
  created() {
    this.queue = Promise.resolve();
  },
  async stopped() {
    await this.queue;
  },
  actions: {
    apply: action(
      'POST /corrections',
      'Apply an authenticated admin correction',
      function (ctx) {
        admin(principal(ctx, ctx.params));
        return this.enqueue(() => this.apply(ctx));
      },
      correctionParams
    ),
    confirm: {
      visibility: 'protected',
      params: correctionParams,
      handler(ctx) {
        return this.enqueue(() => this.apply(ctx));
      },
    },
    undo: action(
      'POST /corrections/:correctionId/undo',
      'Undo a correction',
      function (ctx) {
        return this.enqueue(() => this.undo(ctx));
      },
      { correctionId: id }
    ),
    list: action('GET /corrections', 'Read correction audit records', async function (ctx) {
      const p = principal(ctx, ctx.params);
      admin(p);
      return this.records(p.tenantId);
    }),
    overrideProposals: action(
      'GET /corrections/override-proposals',
      'Read aggregate suggestions; never apply them',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        if (!p.roles.includes('ROLE_ADMIN')) deny('Global admin required');
        const groups = new Map();
        const rows = await this.db.allDocs({
          include_docs: true,
          startkey: 'correction:',
          endkey: 'correction:\uffff',
        });
        for (const { doc } of rows.rows) {
          if (doc.target !== 'neighbor' || doc.undone || doc.pending) continue;
          const pair = [doc.correction.functionId, doc.correction.neighborId].sort(
            compareCanonicalStrings
          );
          const key = JSON.stringify(pair);
          if (!groups.has(key)) groups.set(key, { pair, tenants: new Map() });
          const prior = groups.get(key).tenants.get(doc.tenantId);
          if (!prior || prior.sequence < doc.sequence)
            groups
              .get(key)
              .tenants.set(doc.tenantId, { sequence: doc.sequence, weight: doc.correction.weight });
        }
        return {
          applied: false,
          proposals: [...groups.values()]
            .map(({ pair, tenants }) => ({
              functionId: pair[0],
              neighborId: pair[1],
              tenantCount: tenants.size,
              weight: [...tenants.values()].reduce((a, b) => a + b.weight, 0) / tenants.size,
            }))
            .sort(
              (a, b) =>
                compareCanonicalStrings(a.functionId, b.functionId) ||
                compareCanonicalStrings(a.neighborId, b.neighborId)
            ),
        };
      }
    ),
  },
  methods: {
    enqueue(task) {
      const work = this.queue.then(task);
      this.queue = work.catch(() => {});
      return work;
    },
    async records(tenantId) {
      const start = `correction:${encodeURIComponent(tenantId)}:`;
      return (
        await this.db.allDocs({ include_docs: true, startkey: start, endkey: `${start}\uffff` })
      ).rows.map((r) => r.doc);
    },
    async apply(ctx) {
      const p = principal(ctx, ctx.params);
      const correction = validateCorrection(
        ctx.params,
        getFunctionModel({ model: this.settings.model })
      );
      const correctionId = ctx.params.correctionId || randomUUID();
      if (typeof correctionId !== 'string' || correctionId.length > 256)
        deny('Invalid correction identity');
      const event = {
        tenantId: p.tenantId,
        actorId: p.actorId,
        target: ctx.params.target,
        ref: correctionId,
        correctionId,
        correction,
        at: new Date().toISOString(),
      };
      correctionPrincipal(event, ctx.meta);
      const _id = `correction:${encodeURIComponent(p.tenantId)}:${encodeURIComponent(correctionId)}`;
      let doc;
      try {
        doc = await this.db.get(_id);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (
        doc &&
        (doc.actorId !== p.actorId ||
          doc.target !== event.target ||
          JSON.stringify(doc.correction) !== JSON.stringify(correction))
      )
        deny('Correction identity conflict');
      if (doc?.undone) deny('Correction already undone');
      if (!doc) {
        const records = await this.records(p.tenantId);
        if (records.length >= this.settings.maxRecordsPerTenant)
          deny('Correction audit record limit reached');
        doc = { _id, ...event, sequence: records.length, pending: true };
        doc._rev = (await this.db.put(doc)).rev;
      }
      if (doc.pending) {
        const consumer =
          doc.target === 'coverage' ? 'function-coverage.correct' : 'activation.correct';
        await ctx.call(consumer, { ...event, at: doc.at });
        await this.broker.emit('shared-service.correction.v1', event, { meta: ctx.meta });
        doc.pending = false;
        doc._rev = (await this.db.put(doc)).rev;
      }
      return { correctionId, target: event.target, correction };
    },
    async undo(ctx) {
      const p = principal(ctx, ctx.params);
      const doc = await this.db.get(
        `correction:${encodeURIComponent(p.tenantId)}:${encodeURIComponent(ctx.params.correctionId)}`
      );
      if (doc.actorId !== p.actorId) admin(p);
      correctionPrincipal({ ...doc, actorId: p.actorId }, ctx.meta);
      if (!doc.undone) {
        const event = {
          tenantId: p.tenantId,
          actorId: p.actorId,
          target: doc.target,
          ref: `undo-${doc.ref}`,
          correctionId: `undo-${doc.ref}`,
          correction: { ...doc.correction, undoRef: doc.ref },
          at: new Date().toISOString(),
        };
        await ctx.call(
          doc.target === 'coverage' ? 'function-coverage.correct' : 'activation.correct',
          event
        );
        await this.broker.emit('shared-service.correction.v1', event, { meta: ctx.meta });
        doc.undone = true;
        await this.db.put(doc);
      }
      return { undone: true, correctionId: doc.ref };
    },
  },
};
