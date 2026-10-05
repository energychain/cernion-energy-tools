'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const schema = require('../services/signals.service');
const op = {
  operationId: 'neutral_read',
  action: 'neutral.read',
  operationKind: 'data_read',
  agentable: true,
  consequenceLevel: 'none',
  sideEffects: [],
  parameters: { required: [] },
};
const fn = { functionId: 'fn-a', capabilities: [], operations: [op.action], neighbors: [] };
const catalog = {
  version: 1,
  operations: [
    {
      ...op,
      classification: 'standing',
      parameterNames: ['caseId'],
      functionIds: ['fn-a'],
      signals: [],
    },
  ],
};
const meta = {
  authUser: { tenantId: 'tenant-a', id: 'person-a', roles: ['ROLE_USER'], scope: 'read-only' },
};

test('AC-05: real PouchDB restart, concurrent observations and contexts keep one bounded latest state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signals-persistence-'));
  let value = 0.4;
  const events = [];
  async function make() {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    const service = broker.createService({
      ...schema,
      settings: {
        ...schema.settings,
        dbPath: path.join(root, 'db'),
        model: { sourceHash: 'neutral', functions: [fn] },
        catalog,
        operationIndex: { operations: [op] },
        maxStatesPerTenant: 2,
      },
    });
    broker.createService({ name: 'neutral', actions: { read: () => ({ neutralScore: value }) } });
    broker.createService({
      name: 'observer',
      events: { 'signal.state.changed.v1': (ctx) => events.push(ctx.params) },
    });
    await broker.start();
    return { broker, service };
  }
  let instance;
  const observe = (context) =>
    instance.service.actions.observe(
      { tenantId: 'tenant-a', functionId: 'fn-a', ...(context ? { context } : {}) },
      { meta }
    );
  try {
    instance = await make();
    await observe();
    expect(events).toEqual([]);
    await instance.broker.stop();
    instance = await make();
    await observe();
    expect(events).toEqual([]);
    value = 0.9;
    await Promise.all([observe(), observe()]);
    await new Promise(setImmediate);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromState: 'breach', toState: 'ok' });
    await observe({ kind: 'case', ref: 'a' });
    await observe({ kind: 'case', ref: 'b' });
    const states = (await instance.service.db.get('signals:tenant-a')).states;
    expect(states).toHaveLength(2);
    expect(new Set(states.map((s) => s.contextKey)).size).toBe(2);
    expect(states.every((s) => Object.keys(s).length === 3)).toBe(true);
  } finally {
    if (instance) await instance.broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
