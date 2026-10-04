'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const schema = require('../services/shared-service-wake.service');
const journalSchema = require('../services/shared-service-journal.service');

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
            return { findings: 0, consumedUnits: 0.1, proposals: [] };
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
