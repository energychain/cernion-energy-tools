/**
 * Grid Operations Service Tests
 * Tests for market partners endpoint
 */

const { ServiceBroker } = require('moleculer');
const GridOperationsService = require('../services/grid-operations.service');

describe('Grid Operations Service - Market Partners', () => {
  let broker;

  beforeAll(() => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(GridOperationsService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('marketPartners action', () => {
    it('should search for TWL Netze by name', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'TWL Netze',
        limit: 5,
      });

      expect(result).toBeDefined();
      // Result format depends on MCP response
      // Should contain BDEW code and company info
    });

    it('should search by BDEW code', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: '9900992720003',
      });

      expect(result).toBeDefined();
    });

    it('should search by city', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'Heidelberg',
        limit: 10,
      });

      expect(result).toBeDefined();
    });

    it('should validate limit parameter', async () => {
      await expect(
        broker.call('grid-operations.marketPartners', {
          query: 'TWL',
          limit: 25, // exceeds max 20
        })
      ).rejects.toThrow();
    });

    it('should require query parameter', async () => {
      await expect(broker.call('grid-operations.marketPartners', {})).rejects.toThrow();
    });
  });
});
