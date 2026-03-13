/**
 * Datasource Discovery Service Tests
 */

const { ServiceBroker } = require('moleculer');
const DatasourceDiscoveryService = require('../services/datasource-discovery.service');

describe('Datasource Discovery Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'datasource-registry',
      actions: {
        list: {
          async handler() {
            return {
              success: true,
              data: [
                {
                  id: 'source-fresh',
                  name: 'Netzanschlüsse TWL 2025',
                  description: 'Interne Liste aller Netzanschlüsse GW29',
                  tags: ['netz', 'gis'],
                  connectorConfig: { path: '/uploads/GW29_metering_2026.csv' },
                  dictionary: {
                    fields: [
                      { name: 'Zeit', privacyFlag: false },
                      { name: 'Leistung Bezug (W)', privacyFlag: false },
                      { name: 'Leistung Einspeisung (W)', privacyFlag: false },
                      { name: 'anschlussnummer', privacyFlag: false },
                      { name: 'kundennummer', privacyFlag: true },
                    ],
                  },
                },
                {
                  id: 'source-stale',
                  name: 'Altquelle',
                  description: 'Soll nicht angezeigt werden',
                  tags: ['alt'],
                  dictionary: {
                    fields: [{ name: 'old_field', privacyFlag: false }],
                  },
                },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'datasource-cache',
      actions: {
        status: {
          async handler(ctx) {
            if (ctx.params.sourceId === 'source-fresh') {
              return {
                success: true,
                exists: true,
                stale: false,
                lastRefreshed: '2026-03-12T06:00:00Z',
              };
            }

            return {
              success: true,
              exists: true,
              stale: true,
              lastRefreshed: '2026-01-01T00:00:00Z',
            };
          },
        },
      },
    });

    broker.createService(DatasourceDiscoveryService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should list descriptors for both fresh and stale existing caches', async () => {
    const result = await broker.call('datasource-discovery.list', {});
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    const fresh = result.data.find((d) => d.sourceId === 'source-fresh');
    const stale = result.data.find((d) => d.sourceId === 'source-stale');

    expect(fresh).toBeDefined();
    expect(stale).toBeDefined();

    expect(fresh.cacheStatus).toBe('fresh');
    expect(stale.cacheStatus).toBe('stale');

    expect(fresh.privacyFlaggedFields).toContain('kundennummer');
    expect(fresh.aliases).toContain('Netzanschlüsse TWL 2025');
    expect(fresh.aliases).toContain('GW29');
    expect(fresh.aliases).toContain('2026');
    expect(fresh.capabilities).toContain('timeseries');
    expect(fresh.capabilities).toContain('timeseries_cost_enrichment');
    expect(fresh.semanticHints.timeField).toBe('Zeit');
  });

  it('should search descriptors by name and fields', async () => {
    const byName = await broker.call('datasource-discovery.search', { q: 'netzanschlüsse' });
    expect(byName.success).toBe(true);
    expect(byName.count).toBe(1);

    const byField = await broker.call('datasource-discovery.search', { q: 'anschlussnummer' });
    expect(byField.success).toBe(true);
    expect(byField.count).toBe(1);
  });

  it('should return one descriptor by source id', async () => {
    const result = await broker.call('datasource-discovery.descriptor', {
      sourceId: 'source-fresh',
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toContain('inhouse__');
    expect(result.data.source).toBe('inhouse');
  });
});
