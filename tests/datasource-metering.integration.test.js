'use strict';

const path = require('path');
const { ServiceBroker } = require('moleculer');

const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceConnectorService = require('../services/datasource-connector.service');
const DatasourceCacheService = require('../services/datasource-cache.service');

describe('Datasource metering cost E2E flow', () => {
  let broker;
  let sourceId;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(DatasourceRegistryService);
    broker.createService(DatasourceConnectorService);
    broker.createService(DatasourceCacheService);
    await broker.start();

    const csvPath = path.join(__dirname, 'fixtures', 'sample_metering.csv');
    const createResult = await broker.call('datasource-registry.create', {
      name: 'Sample Metering CSV',
      description: 'Fixture for E2E metering-cost enrichment',
      connectorType: 'csv',
      connectorConfig: {
        path: csvPath,
        delimiter: ',',
        encoding: 'utf-8',
      },
      cachePolicy: {
        mode: 'ttl',
        ttlSeconds: 3600,
      },
      tags: ['e2e', 'metering'],
    });

    sourceId = createResult?.data?.id;
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
  });

  it('refreshes CSV cache and enriches rows with interval cost via request params', async () => {
    const refreshResult = await broker.call('datasource-cache.refresh', { sourceId });

    expect(refreshResult.success).toBe(true);
    expect(refreshResult.rowCount).toBeGreaterThan(100);

    const result = await broker.call('datasource-cache.query', {
      sourceId,
      privacyContext: 'internal',
      includeCost: true,
      priceCentPerKWh: 40,
      intervalMinutes: 15,
      consumptionPowerField: 'Leistung Bezug (W)',
      feedInPowerField: 'Leistung Einspeisung (W)',
      limit: 3,
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);

    const firstRow = result.data[0];
    expect(firstRow).toHaveProperty('Leistung Bezug (W)', '309');
    expect(firstRow).toHaveProperty('Leistung Einspeisung (W)', '0');
    expect(firstRow).toHaveProperty('netPowerW', 309);
    expect(firstRow).toHaveProperty('intervalEnergyKWh');
    expect(firstRow).toHaveProperty('intervalCostEur');

    // 309W * 0.25h = 0.07725 kWh; at 40 cent/kWh => 0.0309 EUR
    expect(firstRow.intervalEnergyKWh).toBeCloseTo(0.07725, 6);
    expect(firstRow.intervalCostEur).toBeCloseTo(0.0309, 6);
  });
});
