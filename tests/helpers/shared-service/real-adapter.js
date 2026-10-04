'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { memoryPouch } = require('./memory-pouch');
const { visible } = require('../../../src/domain-router-policy');
const { getFunctionModel } = require('../../../src/function-model');

async function createAdapter({
  functions,
  jest: jestApi,
  model,
  settings = {},
  stores,
  dbPath,
  clock,
  journalSettings = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-adapter-'));
  const events = [];
  const coverageEvents = [];
  const authorizationChecks = [];
  const now = clock || { value: Date.UTC(2026, 0, 1) };
  const Pouch = memoryPouch(stores);
  let schema;
  let coverageSchema;
  let journalSchema;
  jestApi.doMock('pouchdb', () => Pouch);
  try {
    jestApi.isolateModules(() => {
      schema = require('../../../services/function-activation.service');
      coverageSchema = require('../../../services/function-coverage.service');
      journalSchema = require('../../../services/shared-service-journal.service');
    });
  } finally {
    jestApi.dontMock('pouchdb');
  }
  const broker = new ServiceBroker({ logger: false, transporter: null, metrics: false });
  broker.createService({
    name: 'activation-observer',
    events: {
      'function.touched.v1': (ctx) =>
        coverageEvents.push({ name: 'function.touched.v1', payload: ctx.params }),
      'function.coverage.changed.v1': (ctx) =>
        coverageEvents.push({ name: 'function.coverage.changed.v1', payload: ctx.params }),
      'function.activation.changed.v1': {
        handler(ctx) {
          events.push(ctx.params);
        },
      },
    },
  });
  const service = broker.createService({
    ...schema,
    settings: {
      ...schema.settings,
      model: model || { ...getFunctionModel(), ...(functions ? { functions } : {}) },
      dbPath: dbPath || path.join(root, 'db'),
      tenantBudget: 3,
      minWeight: 0.2,
      restWindowMs: 86400000,
      sweepIntervalMs: 0,
      clock: () => now.value,
      ...settings,
    },
  });
  const coverageService = broker.createService({
    ...coverageSchema,
    settings: {
      ...coverageSchema.settings,
      model: service.model,
      dbPath: path.join(root, 'coverage'),
      clock: () => now.value,
    },
  });
  let sequence = 0;
  const journal = broker.createService({
    ...journalSchema,
    settings: {
      ...journalSchema.settings,
      functionModel: () => service.model,
      dbPath: dbPath ? `${dbPath}-journal` : path.join(root, 'journal'),
      clock: () => now.value,
      ...journalSettings,
    },
  });
  const attentionTransitions = [];
  let fresh = true;
  const tenants = new Set(['tenant-a']);
  try {
    await broker.start();
  } catch (error) {
    await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const adapter = {
    broker,
    service,
    coverageService,
    coverageEvents,
    journal,
    events,
    clock: now,
    async apply(step) {
      if (step.type === 'advance') {
        now.value += step.milliseconds;
        await service.sweep();
        await journal.serializeWrite(() => journal.compactEntries());
        return;
      }
      if (step.type === 'signal') {
        const fn = service.model.functions.find((item) => item.functionId === step.functionId);
        if (!fn) return;
        const policy = {
          tenantId: step.tenantId,
          actorId: step.actorId,
          roles: ['ROLE_USER'],
          clearance: [],
          domainsAllowed: [],
          roleFamilies: [],
          sensitivityClearance: [],
        };
        const target = {
          tenantId: step.tenantId,
          actorId: step.actorId,
          accessRoles: ['ROLE_ADMIN'],
          sensitivityFlags: [],
          sharedWithRoles: [],
        };
        const before = visible(policy, target);
        const policyBefore = structuredClone(policy);
        tenants.add(step.tenantId);
        await coverageService.actions.recordTouch(
          {
            tenantId: step.tenantId,
            actorId: step.actorId,
            sourceType: 'completed_turn',
            sourceRef: `ref-${sequence++}`,
            conversationId: step.conversationId || 'conv-a',
            signalClass: step.signalKind === 'question' ? 'knowledge_query' : 'case_followup',
            capabilities: (fn.capabilities || []).slice(0, 1),
            operations: fn.capabilities?.length ? [] : (fn.operations || []).slice(0, 1),
          },
          { meta: { apiToken: { tenantId: step.tenantId, id: step.actorId, roles: policy.roles } } }
        );
        await service.settle();
        authorizationChecks.push({
          before,
          after: visible(policy, target),
          policyBefore,
          policyAfter: structuredClone(policy),
        });
        fresh = false;
        return;
      }
      if (
        step.type !== 'touch' &&
        step.event !== 'function.coverage.changed.v1' &&
        step.event !== 'shared-agent.lifecycle.v1' &&
        step.event !== 'shared-agent.feedback.v1' &&
        step.event !== 'shared-agent.consumption.v1' &&
        step.event !== 'function.activation.changed.v1' &&
        step.event !== 'shared-service.correction.v1'
      )
        return;
      const event = { ...step.payload };
      tenants.add(event.tenantId);
      if (step.type === 'touch') event.at = new Date(now.value).toISOString();
      await broker.emit(step.event || 'function.touched.v1', event, { meta: step.meta || {} });
      await service.settle();
      await journal.writeQueue;
      fresh = false;
    },
    async snapshot() {
      const activations = [];
      const coverage = [];
      for (const tenantId of tenants) {
        activations.push(...(await broker.call('activation.list', { tenantId })));
        const result = await coverageService.actions.matrix(
          {},
          { meta: { apiToken: { tenantId, id: 'admin-a', roles: ['ROLE_TENANT_ADMIN'] } } }
        );
        coverage.push(...result.items);
      }
      return {
        fresh,
        attentionTransitions: structuredClone(attentionTransitions),
        activatingTurns: (
          await Promise.all([...tenants].map((id) => service.readDocument(id)))
        ).reduce((sum, doc) => sum + (doc.activatingTurns || 0), 0),
        allowancePerTurn: service.settings.allowancePerTurn,
        allowanceCap: service.settings.allowanceCap,
        activations,
        agents: [],
        functions: service.model.functions,
        tenantBudget: service.settings.tenantBudget,
        minWeight: service.settings.minWeight,
        now: now.value,
        restWindowMs: service.settings.restWindowMs,
        operationAttempts: [],
        activityQueries: [],
        emptyWakes: [],
        corrections: [],
        authorizationChecks: structuredClone(authorizationChecks),
        coverage,
        coverageEvents: structuredClone(coverageEvents),
        journal: (
          await Promise.all([...tenants].map((tenantId) => journal.readEntries(tenantId)))
        ).flat(),
        handoffs: [],
      };
    },
    async close() {
      const stopping = broker.stop();
      // Moleculer waits on internal timers while stopping; advance only fake timers.
      if (typeof setTimeout.clock === 'object') {
        let done = false;
        stopping.then(
          () => (done = true),
          () => (done = true)
        );
        while (!done) await jestApi.advanceTimersByTimeAsync(50);
      }
      await stopping;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  const apply = adapter.apply.bind(adapter);
  adapter.apply = async (step) => {
    const before = await adapter.snapshot();
    const eventOffset = coverageEvents.length;
    await apply(step);
    const after = await adapter.snapshot();
    for (const row of after.activations.filter((item) => item.attention)) {
      const prior = before.activations.find(
        (item) => item.tenantId === row.tenantId && item.functionId === row.functionId
      );
      const touchEvents =
        step.type === 'touch'
          ? [step.payload]
          : step.type === 'signal'
            ? coverageEvents
                .slice(eventOffset)
                .filter((entry) => entry.name === 'function.touched.v1')
                .map((entry) => entry.payload)
            : [];
      const refreshedByTouch = touchEvents.some(
        (event) =>
          event.tenantId === row.tenantId &&
          event.confidence >= service.settings.minTouchConfidence &&
          (event.functionId === row.functionId ||
            (prior?.reason || row.reason).some(
              (reason) => reason.kind === 'neighbor' && reason.functionId === event.functionId
            ))
      );
      const targeted =
        step.payload?.tenantId === row.tenantId &&
        (step.payload?.functionId || step.payload?.correction?.functionId || step.payload?.ref) ===
          row.functionId;
      attentionTransitions.push({
        tenantId: row.tenantId,
        functionId: row.functionId,
        before: prior?.attention || {
          relevance: 1,
          allowance: 0,
          consumedUnits: 0,
          replenishedUnits: 0,
        },
        after: row.attention,
        turns: after.activatingTurns - before.activatingTurns,
        refreshed:
          refreshedByTouch ||
          (targeted &&
            ['shared-agent.feedback.v1', 'shared-service.correction.v1'].includes(step.event)),
      });
    }
  };
  return adapter;
}

module.exports = { createAdapter };
