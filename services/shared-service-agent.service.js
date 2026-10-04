'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { Errors } = require('moleculer');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { getFunctionModel, getFunction, resolveFunctionId } = require('../src/function-model');
const { resolveRecords } = require('../src/function-activation-records');
const { validateTenantId } = require('../src/tenant-context');
const { principal, deny } = require('../src/domain-router-policy');
const llm = require('../src/llm-client');
const {
  deriveMandate,
  assertOperation,
  collectFindings,
  readKinds,
} = require('../src/shared-service-agent-policy');
const { compareCanonicalStrings } = require('../src/canonical-order');
const idParam = { type: 'string', min: 1, max: 256 };
const cycleParams = { tenantId: idParam, agentId: idParam };
const key = (tenantId, functionId) => JSON.stringify([tenantId, functionId]);
const agentIdFor = (tenantId, functionId) =>
  `agent-${createHash('sha256').update(key(tenantId, functionId)).digest('hex').slice(0, 32)}`;
const eligible = (row) =>
  row?.state === 'active' && row.responsibility?.cet === true && !row.attention?.retired;
const available = (row, units) =>
  eligible(row) &&
  row.attention &&
  !row.attention.allowanceExhausted &&
  row.attention.allowance >= units;

module.exports = {
  name: 'shared-service-agent',
  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'SHARED_SERVICE_AGENT_DB_PATH',
      defaultDbPath: './data/shared-service-agent',
    }),
  ],
  settings: {
    model: null,
    operationIndex: null,
    clock: null,
    unitCosts: { wake: 0.1, operation: 0.25, llm: 1 },
    actorRoles: ['ROLE_USER'],
    actorScopes: ['read-only'],
    maxOperationsPerCycle: 2,
    maxFindings: 20,
    maxProposalsPerAgent: 20,
    maxCoverageRecords: 256,
    coverageThreshold: 0.5,
  },
  actions: {
    list: {
      params: { tenantId: idParam },
      async handler(ctx) {
        principal(ctx, ctx.params);
        await this.settle();
        return this.publicAgents(await this.readDocument(ctx.params.tenantId));
      },
    },
    get: {
      params: cycleParams,
      async handler(ctx) {
        principal(ctx, ctx.params);
        await this.settle();
        return (
          this.publicAgents(await this.readDocument(ctx.params.tenantId)).find(
            (item) => item.agentId === ctx.params.agentId
          ) || null
        );
      },
    },
    retire: {
      params: cycleParams,
      handler(ctx) {
        const p = principal(ctx, ctx.params);
        if (!p.roles.some((role) => ['ROLE_ADMIN', 'ROLE_TENANT_ADMIN'].includes(role)))
          deny('Management role required');
        return this.enqueue(async () => {
          const doc = await this.readDocument(p.tenantId);
          const agent = this.findAgent(doc, ctx.params.agentId);
          agent.manuallyRetired = true;
          await this.transition(agent, 'retired');
          await this.save(doc);
          await this.publish(agent);
          await this.save(doc);
          return this.publicAgent(agent);
        });
      },
    },
    runCycle: {
      visibility: 'protected',
      params: cycleParams,
      handler(ctx) {
        this.checkTenant(ctx.params.tenantId, ctx.meta);
        return this.enqueue(() => this.cycle(ctx.params));
      },
    },
    resolveProposal: {
      params: {
        tenantId: idParam,
        ref: idParam,
        outcome: { type: 'enum', values: ['accepted', 'used', 'rejected'] },
      },
      handler(ctx) {
        const p = principal(ctx, ctx.params);
        return this.enqueue(async () => {
          const doc = await this.readDocument(p.tenantId);
          const agent = doc.agents.find((item) =>
            item.proposals.some((proposal) => proposal.ref === ctx.params.ref)
          );
          const proposal = agent?.proposals.find((item) => item.ref === ctx.params.ref);
          if (!proposal || !proposal.recipients.includes(p.actorId))
            deny('Proposal not accessible');
          if (proposal.outcome) {
            await this.deliverFeedback(doc, agent, proposal);
            return { outcome: proposal.outcome };
          }
          const result = await ctx.call(
            'persona-inbox.resolveByHitlItem',
            {
              tenantId: p.tenantId,
              hitlItemId: proposal.ref,
              resolutionSource: ctx.params.outcome,
            },
            { meta: { ...ctx.meta, tenantId: p.tenantId } }
          );
          if (!result.count) deny('Proposal not delivered');
          await this.feedback({
            tenantId: p.tenantId,
            itemId: proposal.ref,
            status: { accepted: 'approved', used: 'completed', rejected: 'rejected' }[
              ctx.params.outcome
            ],
          });
          return { outcome: ctx.params.outcome };
        });
      },
    },
    executeOperation: {
      visibility: 'protected',
      params: {
        ...cycleParams,
        operationId: idParam,
        input: { type: 'object', optional: true, default: {} },
      },
      handler(ctx) {
        principal(ctx, ctx.params);
        return this.enqueue(async () => {
          const doc = await this.readDocument(ctx.params.tenantId);
          const agent = this.findAgent(doc, ctx.params.agentId);
          let consumedUnits = 0;
          let errorClass = null;
          try {
            return await this.execute(agent, ctx.params.operationId, ctx.params.input, (units) => {
              consumedUnits += units;
            });
          } catch (error) {
            errorClass = error.type || error.name;
            throw error;
          } finally {
            agent.stats.consumedUnits += consumedUnits;
            await this.appendCycle(agent, { findings: 0, proposals: 0, consumedUnits }, errorClass);
            await this.save(doc);
          }
        });
      },
    },
  },
  events: {
    'function.activation.changed.v1': {
      handler(ctx) {
        this.receiveActivation(ctx.params);
      },
    },
    'function.coverage.changed.v1': {
      handler(ctx) {
        const event = ctx.params;
        this.checkTenant(event.tenantId);
        this.enqueue(async () => {
          const doc = await this.readDocument(event.tenantId);
          const resolved = resolveFunctionId(event.functionId, { model: this.model });
          if (
            resolved.length !== 1 ||
            !event.actorId ||
            !Number.isFinite(event.score) ||
            event.score < 0 ||
            event.score > 1
          )
            return;
          doc.coverage = doc.coverage.filter(
            (row) => !(row.actorId === event.actorId && row.functionId === resolved[0].functionId)
          );
          doc.coverage.push({
            actorId: event.actorId,
            functionId: resolved[0].functionId,
            score: event.score,
          });
          doc.coverage = doc.coverage.slice(-this.settings.maxCoverageRecords);
          await this.save(doc);
        }).catch((error) => this.logger.warn(error.type || error.name));
      },
    },
    'hitl.item.resolved': {
      handler(ctx) {
        return this.enqueue(() => this.feedback(ctx.params));
      },
    },
  },
  methods: {
    now() {
      return this.settings.clock ? this.settings.clock() : Date.now();
    },
    checkTenant(tenantId, meta = {}) {
      if (!tenantId) deny('Tenant required');
      validateTenantId(tenantId);
      for (const supplied of [meta.tenantId, meta.authUser?.tenantId, meta.apiToken?.tenantId])
        if (supplied && supplied !== tenantId) deny('Tenant mismatch');
    },
    enqueue(work) {
      const next = this.queue.then(work);
      this.queue = next.catch((error) => {
        this.logger.warn(error.type || error.name);
      });
      return next;
    },
    async settle() {
      let prior;
      do {
        prior = this.queue;
        await prior;
      } while (prior !== this.queue);
    },
    async readDocument(tenantId) {
      this.checkTenant(tenantId);
      try {
        return await this.db.get(`agents:${tenantId}`);
      } catch (error) {
        if (error.status !== 404) throw error;
        return { _id: `agents:${tenantId}`, tenantId, agents: [], coverage: [] };
      }
    },
    async save(doc) {
      const result = await this.db.put(doc);
      doc._rev = result.rev;
    },
    publicAgent(agent) {
      const {
        modelSourceHash: _hash,
        capabilities: _caps,
        proposals: _proposals,
        pendingJournal: _journal,
        pendingLifecycle: _lifecycle,
        ...item
      } = agent;
      return structuredClone(item);
    },
    publicAgents(doc) {
      const resolved = resolveRecords(doc.agents, this.model);
      const byFunction = new Map();
      for (const agent of resolved) {
        const previous = byFunction.get(agent.functionId);
        if (!previous || previous.lifecycle === 'retired') byFunction.set(agent.functionId, agent);
      }
      return [...byFunction.values()]
        .map((agent) => this.publicAgent(agent))
        .sort((a, b) => compareCanonicalStrings(a.agentId, b.agentId));
    },
    findAgent(doc, agentId) {
      const saved = doc.agents.find((agent) => agent.agentId === agentId);
      if (!saved) throw new Errors.MoleculerClientError('Agent not found', 404, 'AGENT_NOT_FOUND');
      const resolved = resolveRecords([saved], this.model);
      if (resolved.length !== 1) deny('Unresolved or ambiguous function');
      saved.functionId = resolved[0].functionId;
      return saved;
    },
    actorMeta(agent) {
      return {
        tenantId: agent.tenantId,
        actorType: 'shared-service-agent',
        authUser: {
          tenantId: agent.tenantId,
          id: agent.agentId,
          actorType: 'shared-service-agent',
          roles: [...this.settings.actorRoles],
          scope: this.settings.actorScopes[0],
          scopes: [...this.settings.actorScopes],
        },
      };
    },
    receiveActivation(event) {
      this.checkTenant(event.tenantId);
      const resolved = getFunction(event.functionId, { model: this.model })
        ? [{ functionId: event.functionId }]
        : resolveFunctionId(event.functionId, { model: this.model });
      if (resolved.length !== 1) deny('Unresolved or ambiguous function');
      const row = structuredClone({ ...event, functionId: resolved[0].functionId });
      const identity = key(row.tenantId, row.functionId);
      const previous = this.activations.get(identity);
      this.activations.set(identity, row);
      // Do not await work from an activation producer's serialized outbox: charging
      // and lifecycle emissions call that producer again after its commit.
      this.enqueue(() => this.reconcile(row, previous)).catch((error) =>
        this.logger.warn(error.type || error.name)
      );
    },
    async transition(agent, lifecycle) {
      if (agent.lifecycle === lifecycle) return;
      agent.lifecycle = lifecycle;
      agent.pendingLifecycle = true;
    },
    async publish(agent) {
      if (!agent.pendingLifecycle) return;
      await this.broker.emit('shared-agent.lifecycle.v1', {
        tenantId: agent.tenantId,
        agentId: agent.agentId,
        functionId: agent.functionId,
        lifecycle: agent.lifecycle,
        attention: agent.attention,
      });
      agent.pendingLifecycle = false;
    },
    async reconcile(row, previous) {
      const doc = await this.readDocument(row.tenantId);
      doc.agents = resolveRecords(doc.agents, this.model).filter(
        (agent, index, rows) =>
          rows.findIndex((other) => other.functionId === agent.functionId) === index
      );
      let agent = doc.agents.find((item) => item.functionId === row.functionId);
      if (!agent && !eligible(row)) return;
      if (!agent) {
        const fn = getFunction(row.functionId, { model: this.model });
        agent = {
          agentId: agentIdFor(row.tenantId, row.functionId),
          tenantId: row.tenantId,
          functionId: row.functionId,
          lifecycle: 'proposed',
          mandate: deriveMandate(fn, this.operations),
          wake: { mode: 'event', intervalSec: 0, events: [...(fn.events?.listens || [])] },
          stats: { cycles: 0, findings: 0, consumedUnits: 0, proposals: 0 },
          proposals: [],
          capabilities: fn.capabilities || [],
          modelSourceHash: this.model.sourceHash,
          pendingLifecycle: true,
        };
        doc.agents.push(agent);
        await this.save(doc);
        await this.publish(agent);
      }
      agent.attention = row.attention;
      const lifecycle =
        !eligible(row) || agent.manuallyRetired
          ? 'retired'
          : available(row, agent.minimumAllowance || this.minimumCycleUnits(agent))
            ? 'active'
            : 'sleeping';
      const changed = agent.lifecycle !== lifecycle;
      await this.transition(agent, lifecycle);
      await this.save(doc);
      await this.publish(agent);
      await this.save(doc);
      if (
        lifecycle === 'active' &&
        (changed || !previous || previous.attention?.tier !== row.attention?.tier)
      )
        await this.cycle({ tenantId: row.tenantId, agentId: agent.agentId });
    },
    minimumCycleUnits(agent) {
      const reads = this.operations.filter(
        (op) => agent.mandate.operations.includes(op.operationId) && readKinds.has(op.operationKind)
      );
      return (
        this.settings.unitCosts.wake +
        this.settings.unitCosts.operation *
          Math.min(reads.length, this.settings.maxOperationsPerCycle)
      );
    },
    async current(agent) {
      const result = await this.broker.call(
        'activation.get',
        { tenantId: agent.tenantId, functionId: agent.functionId },
        { meta: this.actorMeta(agent) }
      );
      return result.activations.find((row) => row.functionId === agent.functionId);
    },
    async charge(agent, kind, record) {
      const units = this.settings.unitCosts[kind];
      const before = await this.current(agent);
      if (!available(before, units) || agent.manuallyRetired) {
        agent.minimumAllowance = this.settings.unitCosts.wake + (kind === 'wake' ? 0 : units);
        await this.transition(
          agent,
          eligible(before) && !agent.manuallyRetired ? 'sleeping' : 'retired'
        );
        throw new Errors.MoleculerClientError('Allowance unavailable', 429, 'AGENT_ALLOWANCE');
      }
      await this.broker.emit('shared-agent.consumption.v1', {
        tenantId: agent.tenantId,
        agentId: agent.agentId,
        functionId: agent.functionId,
        units,
        kind,
        at: new Date(this.now()).toISOString(),
      });
      const after = await this.current(agent);
      if (
        (after?.attention?.consumedUnits || 0) - (before.attention.consumedUnits || 0) <
        units - 1e-9
      )
        throw new Errors.MoleculerClientError('Charge not committed', 429, 'AGENT_ALLOWANCE');
      record(units);
      agent.attention = after.attention;
      if (!eligible(after)) deny('Responsibility ended');
    },
    async execute(agent, operationId, input, record) {
      const operation = this.operations.find((entry) => entry.operationId === operationId);
      const fn = getFunction(agent.functionId, { model: this.model });
      const meta = this.actorMeta(agent);
      assertOperation(operation, fn, { meta }, input);
      const backend = this.broker.getLocalService(operation.service)?.schema.actions;
      const actionName = operation.action.slice(operation.service.length + 1);
      const definition = backend?.[actionName];
      if (
        definition?.requiredRoles?.length &&
        !definition.requiredRoles.some((role) => meta.authUser.roles.includes(role))
      )
        deny('Role required');
      await this.charge(agent, 'operation', record);
      return this.broker.call(operation.action, { ...input, tenantId: agent.tenantId }, { meta });
    },
    async propose(doc, agent, findings, record) {
      const fn = getFunction(agent.functionId, { model: this.model });
      const neighbors = new Set(fn.neighbors.map((row) => row.functionId));
      const actors = [
        ...new Set(
          resolveRecords(doc.coverage, this.model)
            .filter(
              (row) => neighbors.has(row.functionId) && row.score >= this.settings.coverageThreshold
            )
            .map((row) => row.actorId)
        ),
      ].sort(compareCanonicalStrings);
      if (
        !actors.length ||
        agent.proposals.filter((item) => !item.outcome).length >= this.settings.maxProposalsPerAgent
      )
        return 0;
      await this.charge(agent, 'operation', record);
      const directory = await this.broker.call(
        'agent-persona.list',
        { tenantId: agent.tenantId },
        { meta: this.actorMeta(agent) }
      );
      const recipients = (directory.items || []).filter(
        (item) =>
          item.tenantId === agent.tenantId &&
          item.personaType === 'human' &&
          item.status === 'active' &&
          actors.includes(item.openclawUserId || item.id)
      );
      if (!recipients.length) return 0;
      // Keep enough units for the model AND at least one internal delivery.
      if (
        !available(
          await this.current(agent),
          this.settings.unitCosts.llm + this.settings.unitCosts.operation
        )
      ) {
        agent.minimumAllowance =
          this.settings.unitCosts.wake +
          this.settings.unitCosts.operation *
            (2 + Math.min(this.settings.maxOperationsPerCycle, agent.mandate.operations.length)) +
          this.settings.unitCosts.llm;
        await this.transition(agent, 'sleeping');
        throw new Errors.MoleculerClientError('Allowance unavailable', 429, 'AGENT_ALLOWANCE');
      }
      await this.charge(agent, 'llm', record);
      const response = await this.llmClient.generateStructured(
        { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
        `Create a brief internal review proposal. Do not execute actions. Function: ${JSON.stringify(fn.label)}. Findings: ${JSON.stringify(findings)}.`,
        { tenantId: agent.tenantId, broker: this.broker, maxOutputTokens: 256 }
      );
      if (typeof response?.summary !== 'string' || !response.summary.trim())
        throw new Errors.MoleculerError('Invalid model result', 502, 'AGENT_LLM_RESULT');
      const summary = response.summary.trim().slice(0, 280);
      const proposal = {
        ref: randomUUID(),
        functionId: agent.functionId,
        outcome: null,
        recipients: [],
      };
      // Persist the association before publishing a human-facing proposal.
      agent.proposals = [...agent.proposals.filter((item) => !item.outcome), proposal].slice(
        -this.settings.maxProposalsPerAgent
      );
      await this.save(doc);
      let delivered = 0;
      for (const recipient of recipients.slice(0, 10)) {
        if (!available(await this.current(agent), this.settings.unitCosts.operation)) break;
        await this.charge(agent, 'operation', record);
        const result = await this.broker.call(
          'persona-inbox.enqueue',
          {
            tenantId: agent.tenantId,
            personaId: recipient.id,
            type: 'shared-service-proposal',
            title: 'Review requested',
            summary,
            hitlItemId: proposal.ref,
            idempotencyKey: proposal.ref,
          },
          { meta: this.actorMeta(agent) }
        );
        if (result.success) {
          delivered++;
          proposal.recipients.push(recipient.openclawUserId || recipient.id);
          await this.save(doc);
        }
      }
      return delivered ? 1 : 0;
    },
    async appendCycle(agent, result, errorClass) {
      const entry = {
        entryId: randomUUID(),
        tenantId: agent.tenantId,
        agentId: agent.agentId,
        functionId: agent.functionId,
        kind: result.proposals ? 'proposed' : errorClass ? 'slept' : 'observed',
        summary: errorClass
          ? `Cycle stopped (${String(errorClass).slice(0, 80)}).`
          : `Cycle observed ${result.findings} findings and prepared ${result.proposals} proposals.`,
        refs: [],
        at: new Date(this.now()).toISOString(),
      };
      if (result.proposals)
        agent.proposals.findLast((item) => item.recipients.length && !item.outcome).journalEntryId =
          entry.entryId;
      if (agent.pendingJournal)
        throw new Errors.MoleculerError('Journal delivery pending', 503, 'AGENT_JOURNAL_PENDING');
      agent.pendingJournal = entry;
      await this.deliverJournal(agent, entry);
      agent.pendingJournal = null;
    },
    async deliverJournal(agent, entry) {
      try {
        await this.broker.call('journal.append', entry, { meta: this.actorMeta(agent) });
      } catch (error) {
        if (error.code !== 409) throw error;
        const stored = await this.broker.call(
          'journal.byAgent',
          { tenantId: agent.tenantId, agentId: agent.agentId },
          { meta: this.actorMeta(agent) }
        );
        if (
          !stored.some(
            (item) =>
              item.entryId === entry.entryId &&
              item.summary === entry.summary &&
              item.kind === entry.kind
          )
        )
          throw error;
      }
    },
    async cycle({ tenantId, agentId }) {
      const doc = await this.readDocument(tenantId);
      const agent = this.findAgent(doc, agentId);
      if (agent.pendingJournal) {
        await this.deliverJournal(agent, agent.pendingJournal);
        agent.pendingJournal = null;
        await this.save(doc);
      }
      const result = { findings: 0, consumedUnits: 0, proposals: 0 };
      const record = (units) => {
        result.consumedUnits += units;
      };
      let errorClass = null;
      try {
        if (agent.lifecycle === 'retired') deny('Agent retired');
        const row = await this.current(agent);
        if (!available(row, agent.minimumAllowance || this.minimumCycleUnits(agent))) {
          await this.transition(agent, eligible(row) ? 'sleeping' : 'retired');
          throw new Errors.MoleculerClientError('Allowance unavailable', 429, 'AGENT_ALLOWANCE');
        }
        await this.charge(agent, 'wake', record);
        const fn = getFunction(agent.functionId, { model: this.model });
        agent.mandate = deriveMandate(fn, this.operations);
        const reads = this.operations.filter(
          (op) =>
            agent.mandate.operations.includes(op.operationId) && readKinds.has(op.operationKind)
        );
        const findings = [];
        for (const operation of reads.slice(0, this.settings.maxOperationsPerCycle)) {
          const observation = await this.execute(agent, operation.operationId, {}, record);
          findings.push(...collectFindings(observation, this.now(), this.settings.maxFindings));
        }
        result.findings = Math.min(findings.length, this.settings.maxFindings);
        if (result.findings)
          result.proposals = await this.propose(
            doc,
            agent,
            findings.slice(0, this.settings.maxFindings),
            record
          );
      } catch (error) {
        errorClass = error.type || error.name;
      } finally {
        agent.stats.cycles++;
        for (const field of ['findings', 'consumedUnits', 'proposals'])
          agent.stats[field] += result[field];
        let row;
        try {
          row = await this.current(agent);
        } catch (error) {
          errorClass = error.type || error.name;
        }
        if (!eligible(row)) await this.transition(agent, 'retired');
        else if (!available(row, this.settings.unitCosts.wake))
          await this.transition(agent, 'sleeping');
        try {
          await this.appendCycle(agent, result, errorClass);
        } finally {
          await this.save(doc);
          await this.publish(agent);
          await this.save(doc);
        }
      }
      return result;
    },
    async feedback(event) {
      this.checkTenant(event.tenantId);
      const doc = await this.readDocument(event.tenantId);
      const agent = doc.agents.find((item) =>
        item.proposals.some((proposal) => proposal.ref === event.itemId)
      );
      const proposal = agent?.proposals.find((item) => item.ref === event.itemId);
      if (!proposal) return;
      if (proposal.outcome) return this.deliverFeedback(doc, agent, proposal);
      const outcome = { approved: 'accepted', rejected: 'rejected', completed: 'used' }[
        event.status
      ];
      if (!outcome) return;
      proposal.outcome = outcome;
      proposal.pendingFeedback = true;
      await this.save(doc);
      await this.deliverFeedback(doc, agent, proposal);
    },
    async deliverFeedback(doc, agent, proposal) {
      if (!proposal.pendingFeedback) return;
      const resolved = resolveRecords([agent], this.model);
      if (resolved.length !== 1) return;
      await this.broker.emit('shared-agent.feedback.v1', {
        tenantId: agent.tenantId,
        agentId: agent.agentId,
        functionId: resolved[0].functionId,
        outcome: proposal.outcome,
        ref: proposal.ref,
        at: new Date(this.now()).toISOString(),
      });
      await this.deliverJournal(agent, {
        entryId: `feedback-${proposal.ref}`,
        tenantId: agent.tenantId,
        agentId: agent.agentId,
        functionId: resolved[0].functionId,
        kind: 'decided',
        summary: `Human proposal feedback: ${proposal.outcome}.`,
        refs: proposal.journalEntryId ? [{ kind: 'journal', id: proposal.journalEntryId }] : [],
        at: new Date(this.now()).toISOString(),
      });
      proposal.pendingFeedback = false;
      await this.save(doc);
    },
  },
  created() {
    this.llmClient = llm;
    this.model = getFunctionModel({ model: this.settings.model });
    this.operations = (
      this.settings.operationIndex || require('../operation-capability-index.json')
    ).operations;
    this.queue = Promise.resolve();
    this.activations = new Map();
    for (const kind of ['wake', 'operation', 'llm'])
      if (!Number.isFinite(this.settings.unitCosts[kind]) || this.settings.unitCosts[kind] <= 0)
        throw new Error('Positive unit costs required');
    for (const field of [
      'maxOperationsPerCycle',
      'maxFindings',
      'maxProposalsPerAgent',
      'maxCoverageRecords',
    ])
      if (!Number.isInteger(this.settings[field]) || this.settings[field] < 1)
        throw new Error('Positive limits required');
  },
  async started() {
    const docs = await this.db.allDocs({
      include_docs: true,
      startkey: 'agents:',
      endkey: 'agents:\uffff',
    });
    for (const { doc } of docs.rows) {
      for (const agent of doc.agents) {
        await this.publish(agent);
        for (const proposal of agent.proposals) await this.deliverFeedback(doc, agent, proposal);
        if (agent.pendingJournal) {
          try {
            await this.deliverJournal(agent, agent.pendingJournal);
            agent.pendingJournal = null;
          } catch (error) {
            this.logger.warn(error.type || error.name);
          }
        }
      }
      await this.save(doc);
    }
  },
  async stopped() {
    await this.settle();
  },
};
