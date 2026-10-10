'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const schema = require('../services/shared-service-agent.service');
const activation = require('../services/function-activation.service');
const journal = require('../services/shared-service-journal.service');
const aliases = require('../services/shared-service-agents.service');

test('AC-07: real PouchDB restart preserves agents and counters without a timed cycle', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-persistence-'));
  const model = {
    sourceHash: 'neutral-v1',
    functions: [
      {
        functionId: 'fn-a',
        capabilities: [],
        operations: [],
        neighbors: [{ functionId: 'fn-b', weight: 0.8 }],
      },
      { functionId: 'fn-b', capabilities: [], operations: [], neighbors: [] },
    ],
  };
  const make = async () => {
    const broker = new ServiceBroker({ logger: false, transporter: null });
    const service = broker.createService({
      ...schema,
      settings: { ...schema.settings, model, dbPath: path.join(root, 'agents') },
    });
    const producer = broker.createService({
      ...activation,
      settings: {
        ...activation.settings,
        model,
        sweepIntervalMs: 0,
        dbPath: path.join(root, 'activation'),
      },
    });
    broker.createService({
      ...journal,
      settings: {
        ...journal.settings,
        functionModel: () => model,
        dbPath: path.join(root, 'journal'),
      },
    });
    broker.createService(aliases);
    await broker.start();
    return { broker, service, producer };
  };
  let instance = await make();
  const auth = {
    meta: { authUser: { tenantId: 'tenant-a', id: 'person-a', roles: ['ROLE_USER'] } },
  };
  try {
    await instance.broker.emit('function.touched.v1', {
      tenantId: 'tenant-a',
      actorId: 'person-a',
      functionId: 'fn-a',
      conversationId: 'conv-a',
      confidence: 1,
      at: new Date().toISOString(),
    });
    await instance.producer.settle();
    await instance.service.settle();
    const before = await instance.broker.call('agents.list', { tenantId: 'tenant-a' }, auth);
    expect(before).toHaveLength(1);
    expect(before[0].stats.cycles).toBe(1);
    expect(before[0].stats.consumedUnits).toBeCloseTo(0.1);
    await instance.broker.stop();
    instance = await make();
    expect(await instance.broker.call('agents.list', { tenantId: 'tenant-a' }, auth)).toEqual(
      before
    );
    expect(
      await instance.broker.call(
        'agents.get',
        { tenantId: 'tenant-a', agentId: before[0].agentId },
        auth
      )
    ).toEqual(before[0]);
    expect(
      await instance.broker.call('shared-service-agent.runCycle', {
        tenantId: 'tenant-a',
        agentId: before[0].agentId,
      })
    ).toEqual({ findings: 0, proposals: 0, consumedUnits: 0.1 });
    await instance.broker.call(
      'agents.retire',
      { tenantId: 'tenant-a', agentId: before[0].agentId },
      { meta: { authUser: { tenantId: 'tenant-a', id: 'person-a', roles: ['ROLE_TENANT_ADMIN'] } } }
    );
    expect(
      (
        await instance.broker.call(
          'agents.get',
          { tenantId: 'tenant-a', agentId: before[0].agentId },
          auth
        )
      ).lifecycle
    ).toBe('retired');
  } finally {
    await instance.broker.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);
