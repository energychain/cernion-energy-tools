'use strict';

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

jest.mock('axios', () => ({
  post: jest.fn(),
}));

const axios = require('axios');

describe('webhooks service', () => {
  const originalDbPath = process.env.WEBHOOKS_DB_PATH;
  const originalKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  const originalTick = process.env.WEBHOOKS_PROCESS_INTERVAL_MS;
  let broker;

  beforeAll(async () => {
    process.env.WEBHOOKS_DB_PATH = path.join(os.tmpdir(), `cernion-webhooks-test-${Date.now()}`);
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = 'test-webhook-key';
    process.env.WEBHOOKS_PROCESS_INTERVAL_MS = '1000000';

    broker = new ServiceBroker({ logger: false });
    broker.createService(require('../services/webhooks.service'));
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    process.env.WEBHOOKS_DB_PATH = originalDbPath;
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalKey;
    process.env.WEBHOOKS_PROCESS_INTERVAL_MS = originalTick;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates subscription and sends signed delivery for whitelisted event', async () => {
    axios.post.mockResolvedValue({ status: 200, data: {} });

    const created = await broker.call(
      'webhooks.create',
      {
        url: 'https://example.com/hook',
        events: ['cya.a2a.consensus.failed'],
        secret: 'abc123',
        headers: { 'X-Custom': 'yes' },
      },
      { meta: { tenantId: 'tenant-a' } }
    );

    expect(created.success).toBe(true);
    expect(created.subscription.hasSecret).toBe(true);

    broker.emit('cya.a2a.consensus.failed', { sessionId: 'S-1', eventId: 'evt-1' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(axios.post).toHaveBeenCalledTimes(1);
    const call = axios.post.mock.calls[0];
    expect(call[0]).toBe('https://example.com/hook');
    expect(call[2].headers['X-Cernion-Signature']).toMatch(/^sha256=/);

    const deliveries = await broker.call(
      'webhooks.listDeliveries',
      { id: created.subscription.id },
      { meta: { tenantId: 'tenant-a' } }
    );
    expect(deliveries.count).toBe(1);
    expect(deliveries.deliveries[0].status).toBe('sent');
  });

  test('retries failed delivery and allows replay', async () => {
    axios.post.mockResolvedValueOnce({ status: 503 }).mockResolvedValueOnce({ status: 200 });

    const created = await broker.call(
      'webhooks.create',
      {
        url: 'https://example.com/retry',
        events: ['mastr-monitor.delta.detected'],
      },
      { meta: { tenantId: 'tenant-r' } }
    );

    broker.emit('mastr-monitor.delta.detected', { watchId: 'w1', eventId: 'evt-retry' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    let deliveries = await broker.call(
      'webhooks.listDeliveries',
      { id: created.subscription.id },
      { meta: { tenantId: 'tenant-r' } }
    );

    expect(deliveries.deliveries[0].status).toBe('retrying');

    const replayed = await broker.call(
      'webhooks.replay',
      { id: created.subscription.id, deliveryId: deliveries.deliveries[0].id },
      { meta: { tenantId: 'tenant-r' } }
    );

    expect(replayed.delivery.status).toBe('sent');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
