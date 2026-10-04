'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { memoryPouch } = require('./helpers/shared-service/memory-pouch');
const {
  WAKE_DEFAULTS,
  deriveWake,
  adaptInterval,
  validateWakeSettings,
} = require('../src/shared-service-wake');
const { getFunctionModel } = require('../src/function-model');

const model = {
  functions: [
    {
      functionId: 'fn-a',
      capabilities: [],
      dataSources: ['source-a'],
      events: { listens: ['source.changed'], emits: [] },
      neighbors: [],
    },
  ],
  parameters: {},
};
const stores = new Map();
let schema;
jest.doMock('pouchdb', () => memoryPouch(stores));
jest.isolateModules(() => {
  schema = require('../services/shared-service-wake.service');
});
jest.dontMock('pouchdb');
const meta = { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_USER'] } };
const activation = (attention = {}) => ({
  tenantId: 'tenant-a',
  functionId: 'fn-a',
  state: 'active',
  responsibility: { cet: true, humans: [] },
  attention: {
    tier: 'transient',
    allowance: 2,
    allowanceExhausted: false,
    replenishedUnits: 2,
    ...attention,
  },
});
const lifecycle = (state = 'active') => ({
  tenantId: 'tenant-a',
  functionId: 'fn-a',
  agentId: 'agent-a',
  lifecycle: state,
});

async function setup({ sharedPath, settings = {}, result, run } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-test-'));
  const clock = { value: Date.UTC(2026, 0, 1) };
  const calls = [];
  const entries = [];
  const broker = new ServiceBroker({
    logger: false,
    transporter: null,
    registry: { strategy: 'RoundRobin' },
  });
  broker.createService({
    name: 'shared-service-agent',
    actions: {
      runCycle: {
        params: { tenantId: 'string', agentId: 'string' },
        async handler(ctx) {
          calls.push(ctx.params);
          return run ? run(ctx) : result || { findings: 0, consumedUnits: 0.1, proposals: [] };
        },
      },
    },
  });
  broker.createService({
    name: 'journal',
    actions: {
      append: {
        handler(ctx) {
          if (entries.some((entry) => entry.entryId === ctx.params.entryId))
            throw Object.assign(new Error('exists'), { code: 409 });
          entries.push(ctx.params);
          return ctx.params;
        },
      },
    },
  });
  const wake = broker.createService({
    ...schema,
    settings: {
      ...schema.settings,
      model,
      availableEvents: [],
      defaultIntervalSec: 60,
      minimumIntervalSec: 10,
      maximumIntervalSec: 240,
      timerIntervalMs: 1000,
      clock: () => clock.value,
      dbPath: sharedPath || path.join(root, 'db'),
      ...settings,
    },
  });
  await broker.start();
  return {
    broker,
    wake,
    clock,
    calls,
    entries,
    root,
    async activate() {
      await broker.emit('function.activation.changed.v1', activation());
      await broker.emit('shared-agent.lifecycle.v1', lifecycle());
    },
    async close() {
      const stopping = broker.stop();
      let done = false;
      stopping.finally(() => {
        done = true;
      });
      while (!done) await jest.advanceTimersByTimeAsync(50);
      await stopping;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 0, 1), doNotFake: ['hrtime', 'performance'] });
});
afterEach(() => {
  jest.useRealTimers();
  stores.clear();
});

test('real activation funds the harness wake through actual activating turns', async () => {
  const { createAdapter } = require('./helpers/shared-service/real-adapter');
  const { generateHistory, loadFunctions } = require('./helpers/shared-service/simulation');
  const functions = loadFunctions().functions;
  const adapter = await createAdapter({ jest, functions });
  try {
    for (const step of generateHistory({ seed: 702, functions }).slice(0, 7)) {
      await adapter.apply(step);
    }
    expect((await adapter.snapshot()).emptyWakes.length).toBeGreaterThan(0);
  } finally {
    await adapter.close();
  }
});

test('AC-01: empty cycles double until the configured maximum; no consumption emitted by scheduler', async () => {
  const s = await setup();
  const consumption = jest.fn();
  s.broker.createService({
    name: 'observer',
    events: { 'shared-agent.consumption.v1': consumption },
  });
  try {
    await s.activate();
    for (const expected of [120, 240, 240]) {
      const [before] = await s.wake.records();
      s.clock.value = before.nextAt;
      await s.wake.drainDue();
      const [after] = await s.wake.records();
      expect(after.wake.intervalSec).toBe(expected);
    }
    expect(s.calls).toHaveLength(3);
    expect(consumption).not.toHaveBeenCalled();
    expect(s.entries.filter((e) => e.refs.some((ref) => ref.kind === 'wake-metrics'))).toHaveLength(
      3
    );
  } finally {
    await s.close();
  }
});

test.each(['event', 'hybrid'])(
  'AC-02: matching event wakes immediately and promotes to %s; event mode has no polling',
  async (pushMode) => {
    const s = await setup({ settings: { pushMode } });
    try {
      await s.activate();
      await s.broker.emit('source.changed', {
        tenantId: 'tenant-a',
        functionId: 'fn-a',
        eventId: 'event-a',
      });
      expect(s.calls).toEqual([{ tenantId: 'tenant-a', agentId: 'agent-a' }]);
      expect((await s.wake.records())[0].wake.mode).toBe(pushMode);
      await s.broker.emit('source.changed', {
        tenantId: 'tenant-a',
        functionId: 'fn-a',
        eventId: 'event-a',
      });
      expect(s.calls).toHaveLength(1);
      s.clock.value += 1000000;
      await s.wake.drainDue();
      expect(s.calls).toHaveLength(pushMode === 'event' ? 1 : 2);
    } finally {
      await s.close();
    }
  }
);

test('push requires tenant and exact function/source scope; absent tenant, wrong tenant and unrelated sources do not wake', async () => {
  const s = await setup({ settings: { availableEvents: ['source.changed'] } });
  try {
    await s.activate();
    for (const payload of [
      { sourceId: 'source-a' },
      { tenantId: 'tenant-b', sourceId: 'source-a' },
      { tenantId: 'tenant-a', sourceId: 'source-b' },
      { tenantId: 'tenant-a' },
    ])
      await s.broker.emit('source.changed', payload);
    expect(s.calls).toHaveLength(0);
    await s.broker.emit('source.changed', { tenantId: 'tenant-a', sourceId: 'source-a' });
    expect(s.calls).toHaveLength(1);
  } finally {
    await s.close();
  }
});

test.each([{ allowance: 0, allowanceExhausted: true }, { allowance: 0.09 }, { retired: true }])(
  'no wake with insufficient or exhausted attention %j; only funded activation re-arms',
  async (attention) => {
    const s = await setup();
    try {
      await s.activate();
      await s.broker.emit('function.activation.changed.v1', activation(attention));
      await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
      s.clock.value += 1000000;
      await s.wake.drainDue();
      await s.broker.emit('shared-agent.lifecycle.v1', lifecycle('sleeping'));
      await s.broker.emit('shared-agent.lifecycle.v1', lifecycle());
      expect(s.calls).toHaveLength(0);
      await s.broker.emit('function.activation.changed.v1', activation());
      await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
      expect(s.calls).toHaveLength(0);
      await s.broker.emit('function.activation.changed.v1', activation({ replenishedUnits: 4 }));
      await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
      expect(s.calls).toHaveLength(1);
    } finally {
      await s.close();
    }
  }
);

test.each(['sleeping', 'retired'])(
  'lifecycle %s blocks polling and push; no CET and dormant also block',
  async (state) => {
    const s = await setup();
    try {
      await s.activate();
      await s.broker.emit('shared-agent.lifecycle.v1', lifecycle(state));
      s.clock.value += 1000000;
      await s.wake.drainDue();
      await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
      expect(s.calls).toHaveLength(0);
      await s.broker.emit('shared-agent.lifecycle.v1', lifecycle());
      for (const change of [
        { state: 'dormant' },
        { responsibility: { cet: false, humans: ['actor-a'] } },
      ]) {
        await s.broker.emit('function.activation.changed.v1', { ...activation(), ...change });
        await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
      }
      expect(s.calls).toHaveLength(0);
    } finally {
      await s.close();
    }
  }
);

test('AC-03: push gaps and metrics are tenant-scoped actions; journal records gaps', async () => {
  const s = await setup();
  try {
    await s.activate();
    expect(await s.broker.call('wake.pushGaps', {}, { meta })).toEqual([
      {
        tenantId: 'tenant-a',
        functionId: 'fn-a',
        agentId: 'agent-a',
        eventType: 'source.changed',
        reason: 'missing_producer',
      },
    ]);
    expect(s.entries[0].kind).toBe('awaiting');
    await expect(
      s.broker.call('wake.pushGaps', { tenantId: 'tenant-b' }, { meta })
    ).rejects.toThrow('Tenant mismatch');
    await expect(s.broker.call('wake.metrics')).rejects.toThrow('Authenticated tenant');
    expect(await s.broker.call('wake.metrics', {}, { meta })).toHaveLength(1);
  } finally {
    await s.close();
  }
});

test('AC-04: revision claim prevents two instances from executing the same due or duplicate event cycle', async () => {
  let finish;
  const run = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const a = await setup({ sharedPath: '/tmp/wake-shared-test-db', run });
  const b = await setup({ sharedPath: '/tmp/wake-shared-test-db' });
  try {
    await a.activate();
    a.clock.value = b.clock.value = (await a.wake.records())[0].nextAt;
    const running = a.wake.drainDue();
    while (!finish) await Promise.resolve();
    await b.wake.drainDue();
    await b.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(0);
    finish({ findings: 0, consumedUnits: 0.1, proposals: [] });
    await running;
    expect((await a.wake.records())[0].sequence).toBe(1);
  } finally {
    await a.close();
    await b.close();
  }
});

test('unknown in-flight claim is never automatically replayed after restart', async () => {
  const a = await setup({ sharedPath: '/tmp/wake-unknown-test-db' });
  await a.activate();
  const [record] = await a.wake.records();
  await a.wake.db.put({
    ...record,
    running: { cycleId: 'cycle-a', owner: 'old-instance' },
    nextAt: null,
  });
  await a.close();
  const b = await setup({ sharedPath: '/tmp/wake-unknown-test-db' });
  try {
    b.clock.value += 1000000;
    await b.wake.drainDue();
    await b.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
    expect(b.calls).toHaveLength(0);
  } finally {
    await b.close();
  }
});

test('AC-05: exactly one scheduler timer independent of agents; stopped drains and clears it', async () => {
  const s = await setup();
  try {
    const initial = jest.getTimerCount();
    await s.activate();
    for (let index = 0; index < 20; index++)
      await s.broker.emit('shared-agent.lifecycle.v1', {
        ...lifecycle(),
        agentId: `agent-${index}`,
      });
    expect(jest.getTimerCount()).toBe(initial);
    expect(s.wake.timer).toBeDefined();
    const timer = s.wake.timer;
    await schema.stopped.call(s.wake);
    expect(s.wake.stopping).toBe(true);
    expect(jest.getTimerCount()).toBe(initial - 1);
    expect(timer).toBeDefined();
  } finally {
    await s.close();
  }
});

test('errors, invalid cycle results and journal unavailability stop further wakes with durable journal retry', async () => {
  const s = await setup({
    run: () => {
      throw Object.assign(new Error('failed'), { type: 'CYCLE_FAILED' });
    },
  });
  try {
    await s.activate();
    s.clock.value = (await s.wake.records())[0].nextAt;
    await s.wake.drainDue();
    expect((await s.wake.records())[0].blocked).toBe(true);
    expect(s.entries.at(-1).summary).toContain('CYCLE_FAILED');
    await s.wake.drainDue();
    expect(s.calls).toHaveLength(1);
  } finally {
    await s.close();
  }
});

test('journal failure before dispatch spends nothing and retains bounded publication state for retry', async () => {
  const s = await setup();
  const originalCall = s.broker.call.bind(s.broker);
  let unavailable = true;
  s.broker.call = async (name, ...args) => {
    if (name === 'journal.append' && unavailable)
      throw Object.assign(new Error('unavailable'), { type: 'SERVICE_NOT_FOUND' });
    return originalCall(name, ...args);
  };
  try {
    await s.activate();
    s.clock.value = (await s.wake.records())[0].nextAt;
    await s.wake.drainDue();
    expect(s.calls).toHaveLength(0);
    const [record] = await s.wake.records();
    expect(record.pendingJournal.errorClass).toBe('WAKE_BLOCKED');
    expect(record.stats.wakes).toBe(0);
    expect(record.stats.consumedUnits).toBe(0);
    unavailable = false;
    await s.wake.drainDue();
    expect((await s.wake.records())[0].pendingJournal).toBeNull();
    expect(s.entries.at(-1).summary).toContain('WAKE_BLOCKED');
  } finally {
    await s.close();
  }
});

test('invalid results never create negative counters; fresh funding and active lifecycle are both required', async () => {
  const s = await setup({ result: { findings: 0, consumedUnits: -1, proposals: [] } });
  try {
    await s.activate();
    s.clock.value = (await s.wake.records())[0].nextAt;
    await s.wake.drainDue();
    expect((await s.wake.records())[0].stats.consumedUnits).toBe(0);
    expect((await s.wake.records())[0].blocked).toBe(true);
    await s.broker.emit('shared-agent.lifecycle.v1', lifecycle('sleeping'));
    await s.broker.emit('function.activation.changed.v1', activation({ replenishedUnits: 4 }));
    expect((await s.wake.records())[0].nextAt).toBeNull();
    await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
    expect(s.calls).toHaveLength(1);
    await s.broker.emit('shared-agent.lifecycle.v1', lifecycle());
    await s.broker.emit('source.changed', { tenantId: 'tenant-a', functionId: 'fn-a' });
    expect(s.calls).toHaveLength(2);
  } finally {
    await s.close();
  }
});

test('AC-06: rhythms are data-driven, no-listener gaps are explicit, findings/deadlines adapt and settings validate', () => {
  const settings = { ...WAKE_DEFAULTS };
  expect(
    deriveWake(
      { ...model.functions[0], events: { listens: [] } },
      settings,
      [],
      [{ sourceId: 'source-a', options: { intervalMinutes: 5 } }]
    )
  ).toMatchObject({ intervalSec: 300, pushGaps: [{ eventType: '*', reason: 'missing_listener' }] });
  const wake = { intervalSec: 900, findingStreak: 1 };
  expect(
    adaptInterval(wake, { findings: 1, consumedUnits: 1, proposals: [] }, settings, 0).intervalSec
  ).toBe(450);
  expect(
    adaptInterval(
      wake,
      { findings: [{ dueAt: new Date(1000).toISOString() }], consumedUnits: 1, proposals: [] },
      settings,
      0
    ).intervalSec
  ).toBe(112.5);
  expect(() => adaptInterval(wake, { findings: -1 }, settings, 0)).toThrow();
  expect(() => validateWakeSettings({ ...settings, emptyFactor: 1 })).toThrow();
  expect(() => validateWakeSettings({ ...settings, minimumAllowance: 0 })).toThrow();
  const functions = getFunctionModel().functions;
  let seed = 699;
  const sampled = [...functions]
    .map((fn) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return { fn, order: seed };
    })
    .sort((a, b) => a.order - b.order)
    .slice(0, 20);
  expect(new Set(sampled.map(({ fn }) => fn.functionId)).size).toBe(20);
  for (const { fn } of sampled) {
    const derived = deriveWake(
      fn,
      settings,
      functions.flatMap((entry) => entry.events.emits)
    );
    expect(['hybrid', 'schedule']).toContain(derived.mode);
    expect(derived.intervalSec).toBeGreaterThanOrEqual(settings.minimumIntervalSec);
    expect(derived.intervalSec).toBeLessThanOrEqual(settings.maximumIntervalSec);
  }
});
