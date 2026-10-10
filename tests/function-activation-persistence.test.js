'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const schema = require('../services/function-activation.service');

test('real PouchDB lifecycle persists activation state and closes across broker restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activation-persistence-'));
  const model = {
    sourceHash: 'fixture-v1',
    functions: [
      { functionId: 'fn-a', neighbors: [{ functionId: 'fn-b', weight: 0.7, evidence: [] }] },
      { functionId: 'fn-b', neighbors: [] },
    ],
  };
  const make = () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    const service = broker.createService({
      ...schema,
      settings: { ...schema.settings, model, dbPath: path.join(root, 'db'), sweepIntervalMs: 0 },
    });
    return { broker, service };
  };
  let { broker, service } = make();
  try {
    await broker.start();
    await broker.emit('function.touched.v1', {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      functionId: 'fn-a',
      conversationId: 'conversation-a',
      confidence: 1,
      at: new Date().toISOString(),
    });
    await service.settle();
    const before = await broker.call('activation.list', { tenantId: 'tenant-a' });
    expect(before[1].responsibility.cet).toBe(true);
    await broker.stop();
    ({ broker, service } = make());
    await broker.start();
    expect(await broker.call('activation.list', { tenantId: 'tenant-a' })).toEqual(before);
    expect((await service.db.get('activation:tenant-a')).outbox).toEqual([]);
  } finally {
    await broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
