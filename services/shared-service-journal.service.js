'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { Errors } = require('moleculer');
const { correctionPrincipal, validateCorrection } = require('../src/shared-service-learning');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal } = require('../src/domain-router-policy');
const { canViewEvidence } = require('../src/workbench-evidence');
const { getFunctionModel, getFunction, resolveFunctionId } = require('../src/function-model');
const {
  JOURNAL_KINDS,
  compareEntries,
  resolveEntries,
  computeJournalDigest,
} = require('../src/shared-service-journal');

const requiredId = { type: 'string', min: 1, max: 256 };
const readParams = {
  tenantId: { ...requiredId, optional: true },
  since: { type: 'string', optional: true },
  kinds: { type: 'array', items: { type: 'enum', values: JOURNAL_KINDS }, optional: true },
};
const prefix = (tenantId) => `journal:${encodeURIComponent(tenantId)}:`;
const fail = (message, code = 422) => {
  throw new Errors.MoleculerClientError(message, code, 'JOURNAL_INVALID');
};
const action = (params, summary, handler) => ({
  params,
  openapi: { summary, tags: ['Shared Service Journal'] },
  handler,
});

module.exports = {
  name: 'journal',
  mixins: [
    createPouchDbLifecycleMixin({
      defaultDbPath: './data/shared_service_journal',
      dbPathEnvVar: 'SHARED_SERVICE_JOURNAL_DB_PATH',
    }),
  ],
  settings: {
    retentionMs: Number(process.env.SHARED_SERVICE_JOURNAL_RETENTION_MS || 2592000000),
    retentionIntervalMs: 3600000,
    archiveBatchSize: 100,
    functionModel: null,
    clock: null,
  },
  actions: {
    append: action(
      {
        tenantId: { ...requiredId, optional: true },
        entryId: { ...requiredId, optional: true },
        agentId: { ...requiredId, optional: true },
        functionId: requiredId,
        kind: { type: 'enum', values: JOURNAL_KINDS },
        summary: { type: 'string', min: 1, max: 280 },
        refs: { type: 'array', optional: true, max: 100 },
        at: { type: 'string', optional: true },
      },
      'Append an immutable tenant journal entry',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const entry = await this.serializeWrite(() =>
          this.appendEntry({ ...ctx.params, tenantId: p.tenantId })
        );
        return this.presentEntry(ctx, p, entry);
      }
    ),
    byFunction: action(
      { ...readParams, functionId: requiredId },
      'Read a function journal using current identities',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const entries = await this.readEntries(p.tenantId);
        const ids = new Set(
          this.readIdentities(ctx.params.functionId).map((item) => item.functionId)
        );
        return this.presentEntries(
          ctx,
          p,
          this.filterEntries(entries, ctx.params).filter((entry) => ids.has(entry.functionId))
        );
      }
    ),
    byAgent: action(
      { ...readParams, agentId: requiredId },
      'Read an agent journal within the authenticated tenant',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        return this.presentEntries(
          ctx,
          p,
          this.filterEntries(await this.readEntries(p.tenantId), ctx.params).filter(
            (entry) => entry.agentId === ctx.params.agentId
          )
        );
      }
    ),
    digest: action(
      { functionId: requiredId, tenantId: { ...requiredId, optional: true } },
      'Compute a deterministic function state without a language model',
      async function (ctx) {
        const p = principal(ctx, ctx.params);
        const ids = this.readIdentities(ctx.params.functionId);
        if (ids.length !== 1) fail('Use a current function identity for the digest');
        const digest = computeJournalDigest(
          await this.readEntries(p.tenantId),
          ids[0].functionId,
          p.tenantId
        );
        for (const field of ['openExpectations', 'lastDecisions', 'openProposals'])
          digest[field] = await this.presentEntries(ctx, p, digest[field]);
        return digest;
      }
    ),
  },
  events: {
    'function.activation.changed.v1': {
      async handler(ctx) {
        await this.serializeWrite(() => this.recordActivation(ctx.params));
      },
    },
    'shared-agent.lifecycle.v1': {
      async handler(ctx) {
        await this.serializeWrite(() => this.recordLifecycle(ctx.params));
      },
    },
    'shared-service.correction.v1': {
      async handler(ctx) {
        await this.serializeWrite(() => this.recordCorrection(ctx.params, ctx.meta));
      },
    },
  },
  created() {
    this.writeQueue = Promise.resolve();
  },
  started() {
    if (
      !Number.isFinite(this.settings.retentionMs) ||
      this.settings.retentionMs < 0 ||
      !Number.isInteger(this.settings.archiveBatchSize) ||
      this.settings.archiveBatchSize < 1 ||
      this.settings.archiveBatchSize > 100
    )
      fail('Invalid journal retention settings');
    this.retentionTimer = setInterval(() => {
      this.serializeWrite(() => this.compactEntries()).catch((error) =>
        this.logger.warn('Journal retention deferred', error.message)
      );
    }, this.settings.retentionIntervalMs);
    this.retentionTimer.unref();
  },
  async stopped() {
    clearInterval(this.retentionTimer);
    await this.writeQueue;
  },
  methods: {
    model() {
      const model =
        typeof this.settings.functionModel === 'function'
          ? this.settings.functionModel()
          : this.settings.functionModel;
      return getFunctionModel({ model });
    },
    now() {
      return this.settings.clock ? this.settings.clock() : Date.now();
    },
    readIdentities(functionId) {
      const model = this.model();
      const current = getFunction(functionId, { model });
      return current
        ? [{ functionId: current.functionId }]
        : resolveFunctionId(functionId, { model });
    },
    serializeWrite(work) {
      const result = this.writeQueue.then(work);
      this.writeQueue = result.catch(() => {});
      return result;
    },
    async rawEntries(tenantId) {
      const options = { include_docs: true };
      if (tenantId) {
        options.startkey = prefix(tenantId);
        options.endkey = `${prefix(tenantId)}\uffff`;
      }
      const docs = (await this.db.allDocs(options)).rows.map((row) => row.doc).filter(Boolean);
      const entries = new Map();
      for (const doc of docs) {
        const records =
          doc.type === 'journal-archive'
            ? JSON.parse(gunzipSync(Buffer.from(doc.payload, 'base64')).toString())
            : doc.type === 'journal-entry'
              ? [doc.entry]
              : [];
        for (const entry of records)
          if (!tenantId || entry.tenantId === tenantId)
            entries.set(`${entry.tenantId}:${entry.entryId}`, entry);
      }
      return [...entries.values()].sort(compareEntries);
    },
    async readEntries(tenantId) {
      await this.writeQueue;
      return resolveEntries(await this.rawEntries(tenantId), this.model());
    },
    filterEntries(entries, params) {
      const since = params.since && Date.parse(params.since);
      if (params.since && !Number.isFinite(since)) fail('Invalid since timestamp');
      return entries.filter(
        (entry) =>
          (!params.since || Date.parse(entry.at) >= since) &&
          (!params.kinds || params.kinds.includes(entry.kind))
      );
    },
    async appendEntry(input, internal = {}) {
      for (const field of ['tenantId', 'functionId', 'summary'])
        if (typeof input[field] !== 'string' || !input[field].trim()) fail(`Missing ${field}`);
      if (input.summary.length > 280 || !JOURNAL_KINDS.includes(input.kind))
        fail('Invalid journal entry');
      if (!resolveFunctionId(input.functionId, { model: this.model() }).length)
        fail('Unknown function identity');
      if (input.refs && (!Array.isArray(input.refs) || input.refs.length > 100))
        fail('Invalid refs');
      const at = input.at || new Date(this.now()).toISOString();
      if (!Number.isFinite(Date.parse(at))) fail('Invalid timestamp');
      const previous = await this.rawEntries(input.tenantId);
      const currentFunction = getFunction(input.functionId, { model: this.model() });
      const entry = JSON.parse(
        JSON.stringify({
          entryId: input.entryId || randomUUID(),
          tenantId: input.tenantId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          functionId: input.functionId,
          kind: input.kind,
          summary: input.summary.trim(),
          refs: input.refs || [],
          at: new Date(at).toISOString(),
          position: previous.reduce((maximum, old) => Math.max(maximum, old.position || 0), 0) + 1,
          modelSourceHash: currentFunction ? this.model().sourceHash || null : null,
          capabilities: currentFunction?.capabilities || [],
          ...internal,
        })
      );
      if (previous.some((old) => old.entryId === entry.entryId))
        fail('Entry identity already exists', 409);
      await this.db.put({
        _id: `${prefix(entry.tenantId)}entry:${encodeURIComponent(entry.entryId)}`,
        type: 'journal-entry',
        entry,
      });
      return entry;
    },
    async recordActivation(input) {
      if (
        !['latent', 'active', 'dormant'].includes(input.state) ||
        !Array.isArray(input.responsibility?.humans) ||
        typeof input.responsibility?.cet !== 'boolean'
      )
        fail('Invalid activation event');
      const messages = {
        active: 'Funktion ist aktiv.',
        dormant: 'Funktion ruht.',
        latent: 'Funktion ist bereit.',
      };
      const handoff = !input.responsibility.cet && input.responsibility.humans.length;
      const activation = {
        state: input.state,
        responsibility: input.responsibility,
        ...(input.attention
          ? {
              attention: {
                tier: input.attention.tier,
                retired: input.attention.retired,
                allowanceExhausted: input.attention.allowanceExhausted,
              },
            }
          : {}),
      };
      const attentionReason = input.attention?.retired
        ? 'attention_retired'
        : input.attention?.allowanceExhausted
          ? 'allowance_exhausted'
          : input.attention
            ? `attention_${input.attention.tier}`
            : null;
      const previous = (await this.rawEntries(input.tenantId)).findLast(
        (entry) => entry.functionId === input.functionId && entry.activation
      );
      if (previous && JSON.stringify(previous.activation) === JSON.stringify(activation))
        return previous;
      return this.appendEntry(
        {
          ...input,
          kind: 'decided',
          summary: handoff
            ? 'Verantwortung liegt bei Menschen.'
            : attentionReason
              ? `${messages[input.state]} ${attentionReason}`
              : messages[input.state],
          refs: [],
        },
        { activation }
      );
    },
    async recordLifecycle(input) {
      const kinds = { proposed: 'created', active: 'woke', sleeping: 'slept', retired: 'retired' };
      const messages = {
        proposed: 'Agent wurde angelegt.',
        active: 'Agent ist aktiv.',
        sleeping: 'Agent ruht.',
        retired: 'Agent wurde beendet.',
      };
      if (!input.agentId || !kinds[input.lifecycle]) fail('Invalid lifecycle event');
      const previous = (await this.rawEntries(input.tenantId)).findLast(
        (entry) =>
          entry.functionId === input.functionId &&
          entry.agentId === input.agentId &&
          entry.lifecycle
      );
      if (previous?.lifecycle === input.lifecycle) return previous;
      return this.appendEntry(
        { ...input, kind: kinds[input.lifecycle], summary: messages[input.lifecycle], refs: [] },
        { lifecycle: input.lifecycle }
      );
    },
    async recordCorrection(input, meta = {}) {
      if (input.target === 'gap') {
        correctionPrincipal(input, meta);
        validateCorrection(input, this.model());
      }
      if (
        input.target === 'agent' &&
        ['retain', 'unretain', 'pin', 'unpin'].includes(input.correction?.kind)
      ) {
        const p = principal({ meta }, input);
        if (
          p.actorId !== input.actorId ||
          (['pin', 'unpin'].includes(input.correction.kind) &&
            !p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role)))
        )
          fail('Unauthorized attention correction', 403);
      }
      if (
        !['coverage', 'activation', 'agent', 'neighbor', 'gap'].includes(input.target) ||
        !input.ref ||
        !input.actorId ||
        !input.correction
      )
        fail('Invalid correction event');
      let functionId = input.correction.functionId || input.functionId;
      if (!functionId && resolveFunctionId(input.ref, { model: this.model() }).length)
        functionId = input.ref;
      if (!functionId)
        functionId = (await this.rawEntries(input.tenantId)).findLast(
          (entry) => entry.agentId === input.ref
        )?.functionId;
      if (!functionId) fail('Correction requires a resolvable function reference');
      if (input.correctionId) {
        const existing = (await this.rawEntries(input.tenantId)).find(
          (entry) => entry.entryId === `correction-${input.correctionId}`
        );
        if (existing) return existing;
      }
      return this.appendEntry({
        ...(input.correctionId ? { entryId: `correction-${input.correctionId}` } : {}),
        tenantId: input.tenantId,
        ...(input.target === 'agent' ? { agentId: input.ref } : {}),
        functionId,
        kind: 'corrected',
        summary: 'Korrektur wurde protokolliert.',
        refs: [input.ref],
        at: input.at,
      });
    },
    async presentEntries(ctx, p, entries) {
      return Promise.all(entries.map((entry) => this.presentEntry(ctx, p, entry)));
    },
    async presentEntry(ctx, p, entry) {
      const refs = [];
      for (const ref of entry.refs) if (await this.referenceVisible(ctx, p, ref)) refs.push(ref);
      return {
        entryId: entry.entryId,
        tenantId: entry.tenantId,
        ...(entry.agentId ? { agentId: entry.agentId } : {}),
        functionId: entry.functionId,
        kind: entry.kind,
        summary: entry.summary,
        refs,
        hiddenRefCount: entry.refs.length - refs.length,
        at: entry.at,
      };
    },
    async referenceVisible(ctx, p, ref) {
      if (!ref || typeof ref !== 'object' || !ref.id) return false;
      try {
        const router = this.broker.getLocalService('domain-router');
        if (ref.kind === 'case') {
          await router.loadCase(p, ref.id);
          return true;
        }
        if (ref.kind === 'journal')
          return (await this.rawEntries(p.tenantId)).some((entry) => entry.entryId === ref.id);
        if (ref.kind === 'hitl') {
          const response = await ctx.call(
            'hitl.get',
            { id: ref.id },
            { meta: { ...ctx.meta, tenantId: p.tenantId } }
          );
          return response.item?.tenantId === p.tenantId;
        }
        if (!ref.caseId) return false;
        await router.loadCase(p, ref.caseId);
        if (ref.kind === 'event') {
          const event = await router.eventsDb.get(ref.id);
          return event.tenantId === p.tenantId && event.cetCaseId === ref.caseId;
        }
        const workbench = this.broker.getLocalService('workbench');
        if (ref.kind === 'evidence') {
          const evidence = (
            await workbench.store.listEvidence({ tenantId: p.tenantId, caseId: ref.caseId })
          ).find((item) => item.evidenceId === ref.id);
          return !!evidence && canViewEvidence(evidence, p.clearance, p.tenantId);
        }
        if (ref.kind === 'operation') {
          const response = await ctx.call('workbench.tool-runs.get', {
            caseId: ref.caseId,
            toolRunId: ref.id,
          });
          return !!response.toolRun;
        }
        return false;
      } catch (error) {
        if (
          [403, 404, 503].includes(error.code) ||
          [403, 404, 503].includes(error.status) ||
          error.type === 'SERVICE_NOT_FOUND' ||
          error instanceof TypeError
        )
          return false;
        throw error;
      }
    },
    async archiveBatch(tenantId, batch) {
      const payload = JSON.stringify(batch.map((doc) => doc.entry).sort(compareEntries));
      const hash = createHash('sha256').update(payload).digest('hex');
      try {
        await this.db.put({
          _id: `${prefix(tenantId)}archive:${hash}`,
          type: 'journal-archive',
          tenantId,
          count: batch.length,
          payload: gzipSync(payload).toString('base64'),
        });
      } catch (error) {
        if (error.status !== 409) throw error;
      }
      for (const doc of batch) await this.db.remove(doc);
    },
    async compactEntries() {
      const cutoff = this.now() - this.settings.retentionMs;
      const docs = (await this.db.allDocs({ include_docs: true })).rows
        .map((row) => row.doc)
        .filter((doc) => doc?.type === 'journal-entry' && Date.parse(doc.entry.at) < cutoff);
      const tenants = new Map();
      for (const doc of docs) {
        if (!tenants.has(doc.entry.tenantId)) tenants.set(doc.entry.tenantId, []);
        tenants.get(doc.entry.tenantId).push(doc);
      }
      for (const [tenantId, records] of tenants) {
        for (let start = 0; start < records.length; start += this.settings.archiveBatchSize) {
          const batch = records.slice(start, start + this.settings.archiveBatchSize);
          await this.archiveBatch(tenantId, batch);
        }
      }
      if (docs.length && this.db.compact) await this.db.compact();
      return { compacted: docs.length };
    },
  },
};
