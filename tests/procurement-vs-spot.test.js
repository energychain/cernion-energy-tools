/**
 * procurementVsSpot action tests
 *
 * Verifies that procurement portfolio rows with mixed Lieferperiode formats
 * (2026-Q1, Feb 2026, 2026-03, etc.) are correctly normalised, matched with
 * period-averaged Day-Ahead spot prices, and that delta values are computed
 * accurately.
 */

const { ServiceBroker } = require('moleculer');
const InMemoryJoinService = require('../services/in-memory-join.service');

describe('procurementVsSpot action', () => {
  let broker;

  // Mixed Lieferperiode formats — mirrors real beschaffungsportfolio.csv structure
  const procurementRows = [
    { Lieferperiode: 'Jan 2026', Menge_MWh: '100', Preis_EUR_MWh: '50', Produkt: 'Base' },
    { Lieferperiode: '2026-Q1', Menge_MWh: '200', Preis_EUR_MWh: '55', Produkt: 'Base' },
    { Lieferperiode: 'Feb 2026', Menge_MWh: '150', Preis_EUR_MWh: '45', Produkt: 'Peak' },
    { Lieferperiode: '2026-03', Menge_MWh: '120', Preis_EUR_MWh: '60', Produkt: 'Base' },
  ];

  // Second dataset: no volume field — tests graceful NaN handling
  const noVolumeRows = [
    { Lieferperiode: 'Jan 2026', Preis_EUR_MWh: '50' },
    { Lieferperiode: 'Feb 2026', Preis_EUR_MWh: '45' },
  ];

  // Third dataset: unknown Lieferperiode format — should appear in periodsWithoutSpotData
  // if spot coverage is missing, but the mock always returns prices so we test missing format
  const unknownPeriodRows = [
    { Lieferperiode: 'Sommer 2026', Menge_MWh: '100', Preis_EUR_MWh: '50' },
    { Lieferperiode: '2026-Q3', Menge_MWh: '80', Preis_EUR_MWh: '48' },
  ];

  const datasets = {
    'proc-test': procurementRows,
    'no-volume-test': noVolumeRows,
    'unknown-period-test': unknownPeriodRows,
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
            const limit = ctx.params.limit || 1000;
            const offset = ctx.params.offset || 0;
            const page = rows.slice(offset, offset + limit);
            return { success: true, totalRows: rows.length, count: page.length, data: page };
          },
        },
      },
    });

    // Returns one price entry per day at a constant 40 €/MWh
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
            const prices = [];
            const start = new Date(ctx.params.startDate + 'T00:00:00Z');
            const end = new Date(ctx.params.endDate + 'T00:00:00Z');
            const cursor = new Date(start.getTime());
            while (cursor.getTime() <= end.getTime()) {
              prices.push({ timestamp: cursor.toISOString(), priceEURMWh: 40 });
              cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
            return { success: true, data: { prices } };
          },
        },
      },
    });

    broker.createService({
      name: 'german-grid',
      actions: {
        spotprices: { handler() { return { success: true, dataPoints: [] }; } },
      },
    });

    broker.createService(InMemoryJoinService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should compute correct delta values for mixed Lieferperiode formats', async () => {
    const result = await broker.call('in-memory-join.procurementVsSpot', {
      sourceId: 'proc-test',
    });

    expect(result.success).toBe(true);
    expect(result.positions).toHaveLength(4);
    expect(result.periodsWithoutSpotData).toHaveLength(0);

    // Total volume: 100 + 200 + 150 + 120 = 570
    expect(result.totalVolumeMWh).toBeCloseTo(570, 1);

    // Jan 2026: procurement=50, spot=40 → delta=+10 (above-spot)
    const jan = result.positions.find((p) => p.Lieferperiode === 'Jan 2026');
    expect(jan).toBeDefined();
    expect(jan.procurementPrice).toBeCloseTo(50, 6);
    expect(jan.spotPrice).toBeCloseTo(40, 1);
    expect(jan.delta).toBeCloseTo(10, 1);
    expect(jan.deltaPercent).toBeCloseTo(25, 1);
    expect(jan.positionType).toBe('above-spot');
    expect(jan.normalisedPeriod).toBe('2026-01-01');

    // Feb 2026: procurement=45, spot=40 → delta=+5
    const feb = result.positions.find((p) => p.Lieferperiode === 'Feb 2026');
    expect(feb).toBeDefined();
    expect(feb.delta).toBeCloseTo(5, 1);
    expect(feb.positionType).toBe('above-spot');
    expect(feb.normalisedPeriod).toBe('2026-02-01');

    // 2026-03: procurement=60, spot=40 → delta=+20
    const mar = result.positions.find((p) => p.Lieferperiode === '2026-03');
    expect(mar).toBeDefined();
    expect(mar.delta).toBeCloseTo(20, 1);
    expect(mar.normalisedPeriod).toBe('2026-03-01');

    // 2026-Q1: procurement=55, spot=40 (full quarter Jan–Mar) → delta=+15
    const q1 = result.positions.find((p) => p.Lieferperiode === '2026-Q1');
    expect(q1).toBeDefined();
    expect(q1.delta).toBeCloseTo(15, 1);
    expect(q1.normalisedPeriod).toBe('2026-01-01');
  });

  it('should compute correct volume-weighted aggregate totals', async () => {
    const result = await broker.call('in-memory-join.procurementVsSpot', {
      sourceId: 'proc-test',
    });

    // Volume-weighted procurement avg:
    // (100×50 + 200×55 + 150×45 + 120×60) / 570 = 29950 / 570 ≈ 52.54
    expect(result.procurementAvgPrice).toBeCloseTo(52.54, 1);

    // Volume-weighted spot avg: all at 40 → 40.00
    expect(result.spotAvgPrice).toBeCloseTo(40.0, 1);

    // delta = 52.54 - 40 ≈ 12.54
    expect(result.delta).toBeCloseTo(12.54, 1);

    // deltaPercent = 12.54 / 40 × 100 ≈ 31.35
    expect(result.deltaPercent).toBeCloseTo(31.35, 1);
  });

  it('should auto-detect period and price fields when not explicitly specified', async () => {
    const result = await broker.call('in-memory-join.procurementVsSpot', {
      sourceId: 'proc-test',
    });

    expect(result.success).toBe(true);
    // Output uses the resolved period field name as key (Lieferperiode)
    expect(result.positions[0]).toHaveProperty('Lieferperiode');
    expect(result.positions[0]).toHaveProperty('procurementPrice');
    expect(result.positions[0]).toHaveProperty('spotPrice');
    expect(result.positions[0]).toHaveProperty('delta');
    expect(result.positions[0]).toHaveProperty('positionType');
    expect(result.positions[0]).toHaveProperty('normalisedPeriod');
    expect(result.positions[0]).toHaveProperty('Menge_MWh');
  });

  it('should respect explicit field overrides when provided', async () => {
    const result = await broker.call('in-memory-join.procurementVsSpot', {
      sourceId: 'proc-test',
      periodField: 'Lieferperiode',
      volumeField: 'Menge_MWh',
      priceField: 'Preis_EUR_MWh',
    });

    expect(result.success).toBe(true);
    expect(result.positions).toHaveLength(4);
    expect(result.procurementAvgPrice).toBeCloseTo(52.54, 1);
  });

  it('should return empty positions and zeros for empty datasource', async () => {
    // Mock returns empty for unknown sourceId
    const result = await broker.call('in-memory-join.procurementVsSpot', {
      sourceId: 'nonexistent-source',
    });

    expect(result.success).toBe(true);
    expect(result.positions).toHaveLength(0);
    expect(result.totalVolumeMWh).toBe(0);
    expect(result.procurementAvgPrice).toBeNull();
    expect(result.spotAvgPrice).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.periodsWithoutSpotData).toHaveLength(0);
  });

  it('should handle rows with no volume field gracefully', async () => {
    const result = await broker.call('in-memory-join.procurementVsSpot', {
      sourceId: 'no-volume-test',
    });

    expect(result.success).toBe(true);
    expect(result.positions).toHaveLength(2);
    // totalVolumeMWh = 0 because no volume field matches — positions carry Menge_MWh: null
    expect(result.totalVolumeMWh).toBe(0);
    expect(result.procurementAvgPrice).toBeNull();
  });

  it('should list periods in periodsWithoutSpotData when spot prices are unavailable', async () => {
    // Temporarily override energy-market.prices to return nothing
    const emptyPricesBroker = new ServiceBroker({ logger: false, transporter: null });
    emptyPricesBroker.createService({
      name: 'datasource-cache',
      actions: {
        query: {
          handler() {
            return {
              success: true,
              totalRows: procurementRows.length,
              count: procurementRows.length,
              data: procurementRows,
            };
          },
        },
      },
    });
    emptyPricesBroker.createService({
      name: 'energy-market',
      actions: { prices: { handler() { return { success: true, data: { prices: [] } }; } } },
    });
    emptyPricesBroker.createService({
      name: 'german-grid',
      actions: { spotprices: { handler() { return { success: true, dataPoints: [] }; } } },
    });
    emptyPricesBroker.createService(InMemoryJoinService);
    await emptyPricesBroker.start();

    try {
      const result = await emptyPricesBroker.call('in-memory-join.procurementVsSpot', {
        sourceId: 'unused',
      });

      expect(result.success).toBe(true);
      // All 4 unique periods have no spot coverage
      expect(result.periodsWithoutSpotData.length).toBeGreaterThan(0);
      // Aggregate spot price should be null
      expect(result.spotAvgPrice).toBeNull();
      expect(result.delta).toBeNull();
    } finally {
      await emptyPricesBroker.stop();
    }
  });
});
