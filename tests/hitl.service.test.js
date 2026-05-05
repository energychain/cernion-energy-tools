'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

describe('hitl service', () => {
  const originalDbPath = process.env.HITL_DB_PATH;
  const originalInterval = process.env.HITL_EXPIRY_CHECK_INTERVAL_MS;
  let broker;
  let emitted;

  beforeAll(async () => {
    process.env.HITL_DB_PATH = path.join(os.tmpdir(), `cernion-hitl-test-${Date.now()}`);
    process.env.HITL_EXPIRY_CHECK_INTERVAL_MS = '1000000';

    emitted = [];
    broker = new ServiceBroker({ logger: false });
    const originalEmit = broker.emit.bind(broker);
    broker.emit = (eventName, payload, groups) => {
      emitted.push({ eventName, payload });
      return originalEmit(eventName, payload, groups);
    };

    broker.createService(require('../services/hitl.service'));
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    process.env.HITL_DB_PATH = originalDbPath;
    process.env.HITL_EXPIRY_CHECK_INTERVAL_MS = originalInterval;
  });

  test('creates and resolves hitl item with events', async () => {
    const created = await broker.call(
      'hitl.create',
      {
        kind: 'cya-consensus-failed',
        payload: { sessionId: 'S-1' },
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.item.status).toBe('pending');

    const approved = await broker.call(
      'hitl.approve',
      { id: created.item.id, comment: 'approved' },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(approved.item.status).toBe('approved');

    const createdEvent = emitted.find((evt) => evt.eventName === 'hitl.item.created');
    const resolvedEvent = emitted.find((evt) => evt.eventName === 'hitl.item.resolved');

    expect(createdEvent).toBeTruthy();
    expect(resolvedEvent).toBeTruthy();
    expect(resolvedEvent.payload.itemId).toBe(created.item.id);
  });

  test('isolates items by tenant', async () => {
    const item = await broker.call(
      'hitl.create',
      { kind: 'finance-hypothetical-review' },
      { meta: { tenantId: 'tenant-b' } }
    );

    await expect(
      broker.call('hitl.get', { id: item.item.id }, { meta: { tenantId: 'tenant-c' } })
    ).rejects.toMatchObject({ code: 404 });
  });
});
