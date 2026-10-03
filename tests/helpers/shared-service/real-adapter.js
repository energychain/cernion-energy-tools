'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { memoryPouch } = require('./memory-pouch');
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
  const now = clock || { value: Date.UTC(2026, 0, 1) };
  const Pouch = memoryPouch(stores);
  let schema;
  let journalSchema;
  jestApi.doMock('pouchdb', () => Pouch);
  try {
    jestApi.isolateModules(() => {
      schema = require('../../../services/function-activation.service');
      journalSchema = require('../../../services/shared-service-journal.service');
    });
  } finally {
    jestApi.dontMock('pouchdb');
  }
  const broker = new ServiceBroker({ logger: false, transporter: null, metrics: false });
  broker.createService({
    name: 'activation-observer',
    events: {
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
  let fresh = true;
  const tenants = new Set(['tenant-a']);
  try {
    await broker.start();
  } catch (error) {
    await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    broker,
    service,
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
      if (
        step.type !== 'touch' &&
        step.event !== 'function.coverage.changed.v1' &&
        step.event !== 'shared-agent.lifecycle.v1' &&
        step.event !== 'function.activation.changed.v1' &&
        step.event !== 'shared-service.correction.v1'
      )
        return;
      const event = { ...step.payload };
      tenants.add(event.tenantId);
      if (step.type === 'touch') event.at = new Date(now.value).toISOString();
      await broker.emit(step.event || 'function.touched.v1', event);
      await service.settle();
      await journal.writeQueue;
      fresh = false;
    },
    async snapshot() {
      const activations = [];
      for (const tenantId of tenants)
        activations.push(...(await broker.call('activation.list', { tenantId })));
      return {
        fresh,
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
        journal: (
          await Promise.all([...tenants].map((tenantId) => journal.readEntries(tenantId)))
        ).flat(),
        authorizationChecks: [],
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
}

module.exports = { createAdapter };
