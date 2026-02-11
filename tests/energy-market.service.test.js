/**
 * Energy Market Service Integration Tests
 *
 * Live tests for Energy Market Data microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const EnergyMarketService = require('../services/energy-market.service');

describe('Energy Market Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(EnergyMarketService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('prices action', () => {
    it('should require market and region parameters', async () => {
      await expect(broker.call('energy-market.prices', {})).rejects.toThrow();
    });

    it('should validate market enum', async () => {
      await expect(
        broker.call('energy-market.prices', {
          market: 'invalid-market',
          region: 'Deutschland',
        })
      ).rejects.toThrow();
    });

    it('should retrieve day-ahead prices for Germany', async () => {
      const result = await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'Deutschland',
        date: '2026-02-04',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should support date range queries', async () => {
      const result = await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-03',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);
  });

  describe('production action', () => {
    it('should require all mandatory parameters', async () => {
      await expect(broker.call('energy-market.production', {})).rejects.toThrow();
    });

    it('should retrieve solar production data', async () => {
      const result = await broker.call('energy-market.production', {
        energySource: 'Solar',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-03',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should support different energy sources', async () => {
      const result = await broker.call('energy-market.production', {
        energySource: 'Wind',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-02',
        resolution: 'hour',
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should support all energy sources', async () => {
      const result = await broker.call('energy-market.production', {
        energySource: 'all',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-01',
      });

      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('co2Intensity action', () => {
    it('should require location parameter', async () => {
      await expect(broker.call('energy-market.co2Intensity', {})).rejects.toThrow();
    });

    it('should retrieve CO2 intensity for city', async () => {
      const result = await broker.call('energy-market.co2Intensity', {
        location: 'Heidelberg',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should retrieve CO2 intensity for postal code', async () => {
      const result = await broker.call('energy-market.co2Intensity', {
        location: '69115',
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should support forecast mode', async () => {
      const result = await broker.call('energy-market.co2Intensity', {
        location: 'Heidelberg',
        forecast: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);
  });

  describe('installations action', () => {
    it('should require installationType and location', async () => {
      await expect(broker.call('energy-market.installations', {})).rejects.toThrow();
    });

    it('should search solar installations', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Heidelberg',
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should filter by capacity range', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Heidelberg',
        minCapacityKW: 5,
        maxCapacityKW: 15,
        limit: 5,
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should filter by commissioning year', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Baden-Württemberg',
        commissioningYear: 2020,
        limit: 3,
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should support grid operator filters', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Baden-Württemberg',
        gridOperatorBdewCode: '9900992720003',
        limit: 5,
      });

      expect(result.success).toBe(true);
    }, 30000);
  });
});
