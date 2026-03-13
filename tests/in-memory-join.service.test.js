/**
 * In-Memory Join Service Tests
 */

const { ServiceBroker } = require('moleculer');
const InMemoryJoinService = require('../services/in-memory-join.service');

describe('In-Memory Join Service', () => {
  let broker;

  const datasets = {
    'left-source': [
      { Zeit: '10.03.2026 00:15', value: 1 },
      { Zeit: '10.03.2026 01:45', value: 2 },
    ],
    LPTest: [
      { Zeit: '10.03.2026 00:00', 'Leistung Bezug (W)': '1000', 'Leistung Einspeisung (W)': '0' },
      { Zeit: '10.03.2026 00:15', 'Leistung Bezug (W)': '500', 'Leistung Einspeisung (W)': '0' },
      { Zeit: '10.03.2026 01:00', 'Leistung Bezug (W)': '2000', 'Leistung Einspeisung (W)': '0' },
      { Zeit: '11.03.2026 00:00', 'Leistung Bezug (W)': '3000', 'Leistung Einspeisung (W)': '0' },
    ],
    LPTestSingleColumn: [
      {
        column_1:
          'Zeit,Zeit (UTC),Zählerstand Bezug (Wh),Zählerstand Einspeisung (Wh),Leistung Bezug (W),Leistung Einspeisung (W)',
      },
      { column_1: '10.03.2026 00:00,09.03.2026 23:00,1,1,1000,0' },
      { column_1: '10.03.2026 00:15,09.03.2026 23:15,1,1,500,0' },
      { column_1: '10.03.2026 01:00,10.03.2026 00:00,1,1,2000,0' },
    ],
    ABCD: [
      { Zeit: '10.03.2026 00:00', 'Leistung Einspeisung (W)': '1000000' },
      { Zeit: '10.03.2026 01:00', 'Leistung Einspeisung (W)': '1800000' },
      { Zeit: '10.03.2026 02:00', 'Leistung Einspeisung (W)': '900000' },
    ],
  };

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'datasource-cache',
      actions: {
        query: {
          params: {
            sourceId: { type: 'string' },
            limit: { type: 'number', optional: true },
            offset: { type: 'number', optional: true },
          },
          handler(ctx) {
            const rows = datasets[ctx.params.sourceId] || [];
            const limit = ctx.params.limit || 100;
            const offset = ctx.params.offset || 0;
            const page = rows.slice(offset, offset + limit);
            return {
              success: true,
              sourceId: ctx.params.sourceId,
              totalRows: rows.length,
              count: page.length,
              data: page,
            };
          },
        },
      },
    });

    broker.createService({
      name: 'mock-prices',
      actions: {
        get() {
          return {
            success: true,
            data: {
              prices: [
                { timestamp: '2026-03-10T00:00:00Z', priceEURMWh: 100 },
                { timestamp: '2026-03-10T01:00:00Z', priceEURMWh: 50 },
              ],
            },
          };
        },
      },
    });

    broker.createService({
      name: 'energy-market',
      actions: {
        prices: {
          params: {
            market: { type: 'string' },
            region: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
          },
            handler(ctx) {
              if (ctx.params.region === 'NoData') {
                return {
                  success: true,
                  data: {
                    prices: [],
                  },
                };
              }
            return {
              success: true,
              data: {
                prices: [
                  { timestamp: '2026-03-10T00:00:00Z', priceEURMWh: 100 },
                  { timestamp: '2026-03-10T01:00:00Z', priceEURMWh: 50 },
                ],
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'german-grid',
      actions: {
        spotprices: {
          params: {
            dateFrom: { type: 'string' },
            dateTo: { type: 'string' },
            includeStatistics: { type: 'boolean', optional: true },
          },
          handler() {
            return {
              success: true,
              dataPoints: [
                { timestamp: '2026-03-10T00:00:00Z', priceEURperMWh: 120 },
                { timestamp: '2026-03-10T01:00:00Z', priceEURperMWh: 60 },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'forecast',
      actions: {
        generationForecast: {
          handler() {
            return {
              success: true,
              forecasts: [
                { timestamp: '2026-03-10T00:00:00Z', generationMW: 0.8 },
                { timestamp: '2026-03-10T01:00:00Z', generationMW: 1.9 },
                { timestamp: '2026-03-10T02:00:00Z', generationMW: 1.0 },
              ],
            };
          },
        },
      },
    });

    broker.createService(InMemoryJoinService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should join datasource and action arrays by hourly timestamp', async () => {
    const result = await broker.call('in-memory-join.join', {
      left: {
        kind: 'datasource',
        sourceId: 'left-source',
      },
      right: {
        kind: 'action',
        action: 'mock-prices.get',
      },
      join: {
        leftField: 'Zeit',
        rightField: 'timestamp',
        matchMode: 'hourly-time',
        joinType: 'inner',
        collisionStrategy: 'prefix-all',
        rightPrefix: 'price_',
      },
    });

    expect(result.success).toBe(true);
    expect(result.joinedCount).toBe(2);
    expect(result.data[0].price_priceEURMWh).toBe(100);
    expect(result.data[1].price_priceEURMWh).toBe(50);
  });

  it('should calculate metering cost using market spot prices for a given day', async () => {
    const result = await broker.call('in-memory-join.meteringSpotCost', {
      sourceId: 'LPTest',
      date: '10.03.2026',
      aggregateBy: 'hourly',
    });

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.missingPriceIntervals).toBe(0);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].period).toBe('2026-03-10T00:00:00Z');
    expect(result.data[1].period).toBe('2026-03-10T01:00:00Z');

    expect(result.data[0].totalEnergyKWh).toBeCloseTo(0.375, 6);
    expect(result.data[0].totalCostEur).toBeCloseTo(0.0375, 6);
    expect(result.data[1].totalEnergyKWh).toBeCloseTo(0.5, 6);
    expect(result.data[1].totalCostEur).toBeCloseTo(0.025, 6);

    expect(result.totals.totalEnergyKWh).toBeCloseTo(0.875, 6);
    expect(result.totals.totalCostEur).toBeCloseTo(0.0625, 6);
  });

  it('should compare inhouse actual generation with forecast and compute deltas', async () => {
    const result = await broker.call('in-memory-join.compareForecastActual', {
      sourceId: 'ABCD',
      date: '10.03.2026',
      leftTimeField: 'Zeit',
      leftActualField: 'Leistung Einspeisung (W)',
      actualUnit: 'W',
      aggregateBy: 'hourly',
      bundesland: 'Bayern',
    });

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.missingForecastIntervals).toBe(0);
    expect(result.data).toHaveLength(3);

    expect(result.data[0].actualSumMW).toBeCloseTo(1.0, 6);
    expect(result.data[0].forecastSumMW).toBeCloseTo(0.8, 6);
    expect(result.data[0].deltaMW).toBeCloseTo(0.2, 6);

    expect(result.totals.totalActualMW).toBeCloseTo(3.7, 6);
    expect(result.totals.totalForecastMW).toBeCloseTo(3.7, 6);
    expect(result.totals.totalDeltaMW).toBeCloseTo(0, 6);
  });

  it('should parse single-column CSV cache rows in meteringSpotCost', async () => {
    const result = await broker.call('in-memory-join.meteringSpotCost', {
      sourceId: 'LPTestSingleColumn',
      date: '10.03.2026',
      aggregateBy: 'hourly',
    });

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.missingPriceIntervals).toBe(0);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].totalEnergyKWh).toBeCloseTo(0.375, 6);
    expect(result.data[1].totalEnergyKWh).toBeCloseTo(0.5, 6);
    expect(result.totals.totalCostEur).toBeCloseTo(0.0625, 6);
  });

  it('should fallback to german-grid spotprices when energy-market returns no rows', async () => {
    const result = await broker.call('in-memory-join.meteringSpotCost', {
      sourceId: 'LPTest',
      date: '10.03.2026',
      aggregateBy: 'hourly',
      region: 'NoData',
    });

    expect(result.success).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].totalCostEur).toBeCloseTo(0.045, 6);
    expect(result.data[1].totalCostEur).toBeCloseTo(0.03, 6);
    expect(result.totals.totalCostEur).toBeCloseTo(0.075, 6);
  });
});
