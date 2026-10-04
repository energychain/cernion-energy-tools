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
  wakeSettings = {},
  agentSettings = {},
  signalSettings = {},
  cacheObservations = !model,
  withAgents = !model,
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
  let agentSchema;
  let inboxSchema;
  let wakeSchema;
  let signalSchema;
  jestApi.doMock('pouchdb', () => Pouch);
  try {
    jestApi.isolateModules(() => {
      schema = require('../../../services/function-activation.service');
      coverageSchema = require('../../../services/function-coverage.service');
      journalSchema = require('../../../services/shared-service-journal.service');
      agentSchema = require('../../../services/shared-service-agent.service');
      inboxSchema = require('../../../services/persona-inbox.service');
      wakeSchema = require('../../../services/shared-service-wake.service');
      signalSchema = require('../../../services/signals.service');
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
  const operationAttempts = [];
  const handoffs = [];
  const agentEvents = [];
  broker.createService({
    name: 'agent-observer',
    events: {
      'shared-agent.lifecycle.v1': (ctx) => agentEvents.push(ctx.params),
      'shared-agent.feedback.v1': (ctx) => agentEvents.push(ctx.params),
      'shared-agent.consumption.v1': (ctx) => agentEvents.push(ctx.params),
    },
  });
  const inbox = broker.createService({
    ...inboxSchema,
    settings: { ...inboxSchema.settings, dbPath: path.join(root, 'inbox') },
  });
  const committedCatalog = require('../../../signal-catalog.json');
  const replayActions = {};
  for (const entry of committedCatalog.operations.filter((o) => o.probe.responded))
    replayActions[entry.action.slice(entry.action.lastIndexOf('.') + 1)] = () => ({
      ...structuredClone(entry.probe.response),
      signals: structuredClone(entry.signals),
    });
  if (!model)
    broker.createService({
      name: committedCatalog.operations[0].action.split('.')[0],
      actions: replayActions,
    });
  const signalObservations = [];
  const signalCalls = [];
  let cycleDepth = 0;
  let requestDepth = 0;
  const signals = broker.createService({
    ...signalSchema,
    actions: {
      ...signalSchema.actions,
      observe: {
        ...signalSchema.actions.observe,
        async handler(ctx) {
          signalCalls.push({
            tenantId: ctx.params.tenantId,
            functionId: ctx.params.functionId,
            source: cycleDepth ? 'agent-cycle' : requestDepth ? 'request' : 'outside',
          });
          return signalSchema.actions.observe.handler.call(this, ctx);
        },
      },
    },
    settings: {
      ...signalSchema.settings,
      model: service.model,
      dbPath: path.join(root, 'signals'),
      ...(agentSettings.operationIndex
        ? {
            operationIndex: agentSettings.operationIndex,
            catalog: {
              version: 1,
              operations: agentSettings.operationIndex.operations.map((op) => ({
                operationId: op.operationId,
                action: op.action,
                functionIds: [],
                classification: 'standing',
                parameterNames: [],
                signals: [],
              })),
            },
          }
        : {}),
      ...signalSettings,
    },
  });
  const persistSignals = signals.persist.bind(signals);
  signals.persist = async (...args) => {
    const projected = await persistSignals(...args);
    const { signalKey } = require('../../../src/signal-projection');
    const input = signalKey(args);
    const fingerprint = signalKey(projected);
    const previous = signalObservations.findLast((row) => row.input === input);
    signalObservations.push({
      input,
      signals: projected.map(({ signalId, kind, state }) => ({ signalId, kind, state })),
      previousSignals:
        previous?.signals ||
        projected.map(({ signalId, kind, state }) => ({ signalId, kind, state })),
      fingerprint,
      previousFingerprint: previous?.fingerprint || fingerprint,
      source: cycleDepth ? 'agent-cycle' : requestDepth ? 'request' : 'outside',
      findings: projected.filter(require('../../../src/signal-projection').isFinding),
      proposals: 0,
    });
    return projected;
  };
  const agents = withAgents
    ? broker.createService({
        ...agentSchema,
        settings: {
          ...agentSchema.settings,
          model: service.model,
          signalCatalog: signals.signalCatalog,
          dbPath: dbPath ? `${dbPath}-agents` : path.join(root, 'agents'),
          clock: () => now.value,
          ...agentSettings,
        },
      })
    : null;
  if (agents) {
    const cycle = agents.cycle.bind(agents);
    agents.cycle = async (input) => {
      const start = signalObservations.length;
      cycleDepth++;
      try {
        const result = await cycle(input);
        for (const row of signalObservations.slice(start)) row.proposals = result.proposals;
        return result;
      } finally {
        cycleDepth--;
      }
    };
  }
  const wake = broker.createService({
    ...wakeSchema,
    settings: {
      ...wakeSchema.settings,
      model: service.model,
      dbPath: dbPath ? `${dbPath}-wake` : path.join(root, 'wake'),
      clock: () => now.value,
      pushMode: 'hybrid',
      ...wakeSettings,
    },
  });
  const emptyWakes = [];
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
  let cachedObservation;
  const adapter = {
    broker,
    service,
    coverageService,
    coverageEvents,
    journal,
    signals,
    signalObservations,
    signalCalls,
    async observeSignals(input, options) {
      requestDepth++;
      try {
        return await signals.actions.observe(input, options);
      } finally {
        requestDepth--;
      }
    },
    wake,
    agentMode: 'real',
    events,
    agents,
    inbox,
    agentEvents,
    clock: now,
    async apply(step) {
      if (step.type === 'signal-exercise') {
        const entry = signals
          .catalogEntries()
          .find(
            (row) =>
              row.classification === 'contextual' &&
              row.contextKinds.length &&
              row.functionIds.length &&
              row.signals.length
          );
        if (!entry) return;
        const input = {
          tenantId: 'tenant-a',
          functionId: entry.functionIds[0],
          context: { kind: entry.contextKinds[0], ref: 'fixture-context' },
          operationIds: [entry.operationId],
        };
        const options = {
          meta: {
            authUser: {
              tenantId: 'tenant-a',
              id: 'request-a',
              roles: ['ROLE_USER'],
              scope: 'read-only',
            },
          },
        };
        await adapter.observeSignals(input, options);
        await adapter.observeSignals(input, options);
        return;
      }
      if (step.type === 'advance') {
        now.value += step.milliseconds;
        await service.sweep();
        await agents?.settle();
        await wake.settle();
        await journal.serializeWrite(() => journal.compactEntries());
        return;
      }
      if (step.type === 'wake-exercise' && agents) {
        await agents.settle();
        await wake.settle();
        const records = await wake.records('tenant-a');
        const before = records.find(
          (item) => item.lifecycle === 'active' && !item.blocked && item.nextAt
        );
        if (!before) return;
        now.value = Math.max(now.value, before.nextAt);
        await wake.drainDue();
        await agents.settle();
        await service.settle();
        await wake.settle();
        const after = (await wake.records('tenant-a')).find(
          (item) => item.agentId === before.agentId
        );
        if (after.stats.emptyWakes > (before.stats.emptyWakes || 0))
          emptyWakes.push({
            beforeIntervalSec: before.wake.intervalSec,
            afterIntervalSec: after.wake.intervalSec,
            maximumIntervalSec: wake.settings.maximumIntervalSec,
          });
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
        await agents?.settle();
        await wake.settle();
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
      await agents?.settle();
      await wake.settle();
      await journal.writeQueue;
      fresh = false;
    },
    async snapshot() {
      if (cacheObservations && cachedObservation) return cachedObservation;
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
      const observation = {
        fresh,
        signalObservations: structuredClone(signalObservations.slice(-64)),
        signalCalls: structuredClone(signalCalls.slice(-128)),
        attentionTransitions: structuredClone(attentionTransitions),
        activatingTurns: (
          await Promise.all([...tenants].map((id) => service.readDocument(id)))
        ).reduce((sum, doc) => sum + (doc.activatingTurns || 0), 0),
        allowancePerTurn: service.settings.allowancePerTurn,
        allowanceCap: service.settings.allowanceCap,
        activations,
        agents: agents
          ? (
              await Promise.all(
                [...tenants].map(async (id) => agents.publicAgents(await agents.readDocument(id)))
              )
            ).flat()
          : [],
        functions: service.model.functions,
        tenantBudget: service.settings.tenantBudget,
        minWeight: service.settings.minWeight,
        now: now.value,
        restWindowMs: service.settings.restWindowMs,
        operationAttempts: structuredClone(operationAttempts),
        activityQueries: [],
        emptyWakes: structuredClone(emptyWakes),
        corrections: [],
        authorizationChecks: structuredClone(authorizationChecks),
        coverage,
        coverageEvents: structuredClone(coverageEvents),
        journal: (
          await Promise.all([...tenants].map((tenantId) => journal.readEntries(tenantId)))
        ).flat(),
        handoffs: structuredClone(handoffs),
      };
      if (cacheObservations) cachedObservation = observation;
      return observation;
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
  function observeHandoffs(before, after) {
    for (const row of after.activations) {
      const prior = before.activations.find(
        (item) => item.tenantId === row.tenantId && item.functionId === row.functionId
      );
      if (
        prior?.responsibility.cet &&
        !row.responsibility.cet &&
        row.responsibility.humans.length
      ) {
        const source = prior.reason.find((reason) => reason.kind === 'neighbor')?.functionId;
        const firstActorId = before.activations.find(
          (item) => item.functionId === source && item.tenantId === row.tenantId
        )?.touchedBy[0];
        const secondActorId = row.responsibility.humans.find((id) => id !== firstActorId);
        if (firstActorId && secondActorId)
          handoffs.push({
            firstActorId,
            secondActorId,
            before: prior,
            after: row,
            agents: after.agents.filter(
              (item) => item.tenantId === row.tenantId && item.functionId === row.functionId
            ),
          });
      }
    }
  }
  async function observeDeniedOperation(after) {
    if (agents && !operationAttempts.length && after.agents.length) {
      const agent = after.agents[0];
      const operation = agents.operations.find((item) =>
        item.sideEffects.includes('external_system_call')
      );
      if (operation) {
        let executed = false;
        try {
          await agents.actions.executeOperation(
            {
              tenantId: agent.tenantId,
              agentId: agent.agentId,
              operationId: operation.operationId,
            },
            {
              meta: {
                authUser: { tenantId: agent.tenantId, id: 'reviewer-a', roles: ['ROLE_USER'] },
              },
            }
          );
          executed = true;
        } catch {
          /* Expected policy rejection is an observed attempt. */
        }
        operationAttempts.push({
          externalEffect: true,
          authorized: true,
          noCallBlocked: true,
          executed,
        });
      }
    }
  }
  const apply = adapter.apply.bind(adapter);
  adapter.apply = async (step) => {
    const before = await adapter.snapshot();
    const eventOffset = coverageEvents.length;
    await apply(step);
    cachedObservation = null;
    const after = await adapter.snapshot();
    observeHandoffs(before, after);
    await observeDeniedOperation(after);
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
    after.attentionTransitions = structuredClone(attentionTransitions);
    after.operationAttempts = structuredClone(operationAttempts);
    after.handoffs = structuredClone(handoffs);
    after.emptyWakes = structuredClone(emptyWakes);
  };
  return adapter;
}

module.exports = { createAdapter };
