/**
 * Datasource Cache Service Tests
 */

const { ServiceBroker } = require('moleculer');
const DatasourceCacheService = require('../services/datasource-cache.service');

describe('Datasource Cache Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'datasource-registry',
      actions: {
        get: {
          async handler(ctx) {
            if (ctx.params.id !== 'source-1') throw new Error('not found');
            return {
              success: true,
              data: {
                id: 'source-1',
                connectorType: 'csv',
                connectorConfig: { path: '/tmp/does-not-matter.csv' },
                cachePolicy: { mode: 'ttl', ttlSeconds: 60 },
                dictionary: {
                  fields: [
                    {
                      name: 'kundennummer',
                      type: 'string',
                      privacyFlag: true,
                      syntheticPattern: 'KD-{{random.numeric(6)}}',
                    },
                    {
                      name: 'name',
                      type: 'string',
                      privacyFlag: false,
                    },
                  ],
                },
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'datasource-connector',
      actions: {
        read: {
          async handler() {
            return {
              success: true,
              rows: [
                { kundennummer: 'KD-123456', name: 'Alice' },
                { kundennummer: 'KD-654321', name: 'Bob' },
              ],
              inferredSchema: {
                fields: [
                  { name: 'kundennummer', type: 'string' },
                  { name: 'name', type: 'string' },
                ],
              },
            };
          },
        },
      },
    });

    broker.createService(DatasourceCacheService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should refresh cache and expose status', async () => {
    const refresh = await broker.call('datasource-cache.refresh', { sourceId: 'source-1' });
    expect(refresh.success).toBe(true);
    expect(refresh.rowCount).toBe(2);

    const status = await broker.call('datasource-cache.status', { sourceId: 'source-1' });
    expect(status.success).toBe(true);
    expect(status.exists).toBe(true);
    expect(status.rowCount).toBe(2);
    expect(status.stale).toBe(false);
  });

  it('should return internal context without masking', async () => {
    const result = await broker.call('datasource-cache.query', {
      sourceId: 'source-1',
      privacyContext: 'internal',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].kundennummer).toBe('KD-123456');
  });

  it('should mask privacy fields for ai-agent context', async () => {
    const result = await broker.call('datasource-cache.query', {
      sourceId: 'source-1',
      privacyContext: 'ai-agent',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].kundennummer).not.toBe('KD-123456');
    expect(result.data[0].name).toBe('Alice');
  });

  it('should remove privacy fields for public context and create audit entries', async () => {
    const result = await broker.call('datasource-cache.query', {
      sourceId: 'source-1',
      privacyContext: 'public',
    });

    expect(result.success).toBe(true);
    expect(result.data[0].kundennummer).toBeUndefined();

    const audit = await broker.call('datasource-cache.audit', { sourceId: 'source-1' });
    expect(audit.success).toBe(true);
    expect(audit.count).toBeGreaterThan(0);
  });

  it('should invalidate cache', async () => {
    const invalidated = await broker.call('datasource-cache.invalidate', { sourceId: 'source-1' });
    expect(invalidated.success).toBe(true);
    expect(invalidated.invalidated).toBe(true);

    const status = await broker.call('datasource-cache.status', { sourceId: 'source-1' });
    expect(status.exists).toBe(false);
  });
});
