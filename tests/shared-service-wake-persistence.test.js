'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const schema = require('../services/shared-service-wake.service');
const journalSchema = require('../services/shared-service-journal.service');

test('startup isolates unresolved persisted identities without deleting or scheduling them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-model-change-'));
  const dbPath = path.join(root, 'wake');
  const model = {
    sourceHash: 'current-model',
    functions: ['fn-current', 'fn-split-a', 'fn-split-b'].map((functionId) => ({
      functionId,
      capabilities: [],
      neighbors: [],
      events: { emits: [], listens: [] },
      derivation: {
        lineage: functionId.startsWith('fn-split')
          ? [{ previousId: 'fn-old-split', relation: 'split', overlap: 0.5 }]
          : [],
      },
    })),
  };
  const db = new (require('pouchdb'))(dbPath);
  const unresolved = ['fn-removed', 'fn-old-split'].map((functionId, index) => ({
    _id: `wake:old-${index}`,
    tenantId: 'tenant-a',
    agentId: `old-agent-${index}`,
    functionId,
    modelSourceHash: 'previous-model',
    lifecycle: 'active',
    blocked: false,
    nextAt: 0,
    wake: { mode: 'hybrid', intervalSec: 60, pushGaps: [], events: [] },
    stats: {},
  }));
  await db.bulkDocs(unresolved);
  const persisted = (await db.allDocs({ include_docs: true })).rows.map((row) => row.doc);
  await db.close();
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const runCycle = jest.fn(() => ({ findings: 0, consumedUnits: 0.1, proposals: 0 }));
  broker.createService({ name: 'shared-service-agent', actions: { runCycle } });
  broker.createService({ name: 'journal', actions: { append: () => ({}) } });
  const wake = broker.createService({
    ...schema,
    settings: { ...schema.settings, model, dbPath, availableEvents: [], clock: () => 1000 },
  });
  const warn = jest.spyOn(wake.logger, 'warn');
  try {
    await expect(broker.start()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(await wake.records()).toEqual([]);
    await wake.drainDue();
    await wake.receiveEvent('source.changed', { tenantId: 'tenant-a' }, 'delivery-a');
    expect(runCycle).not.toHaveBeenCalled();
    expect((await wake.db.allDocs({ include_docs: true })).rows.map((row) => row.doc)).toEqual(
      persisted
    );
    expect(() => wake.functionId('fn-removed')).toThrow('unambiguously');
    expect(() => wake.functionId('fn-old-split', 'previous-model')).toThrow('unambiguously');
    await wake.receiveActivation({
      tenantId: 'tenant-a',
      functionId: 'fn-current',
      state: 'active',
      responsibility: { cet: true },
      attention: {
        tier: 'transient',
        allowance: 2,
        allowanceExhausted: false,
        replenishedUnits: 2,
      },
    });
    await wake.receiveLifecycle({
      tenantId: 'tenant-a',
      agentId: 'current-agent',
      functionId: 'fn-current',
      lifecycle: 'active',
    });
    expect(await wake.records()).toHaveLength(1);
    await wake.invoke((await wake.records())[0]._id, 'event', 'current-event');
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
  } finally {
    await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('record isolation does not hide database or unexpected resolver errors', async () => {
  const dbError = new Error('database unavailable');
  await expect(
    schema.methods.records.call({ db: { allDocs: () => Promise.reject(dbError) } })
  ).rejects.toBe(dbError);
  const resolverError = new Error('unexpected resolver failure');
  await expect(
    schema.methods.records.call({
      db: { allDocs: async () => ({ rows: [{ doc: { _id: 'wake:a', _rev: '1-a' } }] }) },
      functionId: () => {
        throw resolverError;
      },
    })
  ).rejects.toBe(resolverError);
});

test('current identities and unique lineage stay readable while a reused old ID stays suspended', async () => {
  const model = {
    sourceHash: 'current-model',
    functions: [
      {
        functionId: 'fn-a',
        derivation: { lineage: [{ previousId: 'fn-legacy', relation: 'rename', overlap: 1 }] },
      },
      {
        functionId: 'fn-b',
        derivation: { lineage: [{ previousId: 'fn-a', relation: 'split', overlap: 0.5 }] },
      },
    ],
  };
  const docs = [
    { _id: 'wake:current', functionId: 'fn-a', modelSourceHash: 'current-model' },
    { _id: 'wake:legacy', functionId: 'fn-legacy', modelSourceHash: 'old-model' },
    { _id: 'wake:ambiguous', functionId: 'fn-a', modelSourceHash: 'old-model' },
  ].map((doc, index) => ({ ...doc, _rev: '1-a', tenantId: 'tenant-a', agentId: `agent-${index}` }));
  const service = {
    model,
    logger: { warn: jest.fn() },
    db: { allDocs: async () => ({ rows: docs.map((doc) => ({ doc })) }) },
  };
  service.functionId = schema.methods.functionId.bind(service);
  const records = await schema.methods.records.call(service);
  expect(records.map((doc) => [doc._id, doc.functionId])).toEqual([
    ['wake:current', 'fn-a'],
    ['wake:legacy', 'fn-a'],
  ]);
  expect(service.logger.warn).toHaveBeenCalledTimes(1);
  expect(docs[1].functionId).toBe('fn-legacy');
});

test('AC-04: real PouchDB restart preserves due times, stats and digest; one cycle per deadline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-persistence-'));
  const model = {
    sourceHash: 'fixture-v1',
    functions: [
      { functionId: 'fn-a', capabilities: [], neighbors: [], events: { emits: [], listens: [] } },
    ],
  };
  const meta = { apiToken: { tenantId: 'tenant-a', id: 'actor-a', roles: ['ROLE_USER'] } };
  let now = Date.UTC(2026, 0, 1);
  let calls = 0;
  const make = () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      name: 'shared-service-agent',
      actions: {
        runCycle: {
          params: { tenantId: 'string', agentId: 'string' },
          handler() {
            calls++;
            return { findings: 0, consumedUnits: 0.1, proposals: 0 };
          },
        },
      },
    });
    broker.createService({
      ...journalSchema,
      settings: {
        ...journalSchema.settings,
        functionModel: model,
        dbPath: path.join(root, 'journal'),
        clock: () => now,
      },
    });
    const wake = broker.createService({
      ...schema,
      settings: {
        ...schema.settings,
        model,
        dbPath: path.join(root, 'wake'),
        clock: () => now,
        availableEvents: [],
      },
    });
    return { broker, wake };
  };
  let { broker, wake } = make();
  try {
    await broker.start();
    await broker.emit('function.activation.changed.v1', {
      tenantId: 'tenant-a',
      functionId: 'fn-a',
      state: 'active',
      responsibility: { cet: true, humans: [] },
      attention: {
        tier: 'transient',
        allowance: 2,
        allowanceExhausted: false,
        replenishedUnits: 2,
      },
    });
    await broker.emit('shared-agent.lifecycle.v1', {
      tenantId: 'tenant-a',
      agentId: 'agent-a',
      functionId: 'fn-a',
      lifecycle: 'active',
    });
    const before = (await wake.records())[0];
    await broker.stop();
    ({ broker, wake } = make());
    await broker.start();
    expect((await wake.records())[0].nextAt).toBe(before.nextAt);
    expect(calls).toBe(0);
    now = before.nextAt;
    await Promise.all([wake.drainDue(), wake.drainDue()]);
    expect(calls).toBe(1);
    const after = (await wake.records())[0];
    expect(after.wake.intervalSec).toBe(before.wake.intervalSec * 2);
    expect(await broker.call('journal.digest', { functionId: 'fn-a' }, { meta })).toMatchObject({
      wakeMetrics: [
        {
          agentId: 'agent-a',
          wakes: 1,
          emptyWakes: 1,
          pushWakes: 0,
          pushShare: 0,
          consumedUnits: 0.1,
          errors: 0,
        },
      ],
    });
    await broker.stop();
    ({ broker, wake } = make());
    await broker.start();
    expect((await wake.records())[0].nextAt).toBe(after.nextAt);
    expect((await wake.records())[0].stats.wakes).toBe(1);
    await wake.drainDue();
    expect(calls).toBe(1);
  } finally {
    await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
