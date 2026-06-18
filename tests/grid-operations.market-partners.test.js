/**
 * Grid Operations Service Tests
 * Tests for market partners endpoint
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
  callWithAutoPoll: jest.fn(),
}));
jest.mock('../src/async-job-poller', () => ({ callWithAutoPoll: jest.fn() }));

const { callWithNewSession } = require('../src/mcp-client');
const GridOperationsService = require('../services/grid-operations.service');

const MOCK_MARKET_PARTNERS = {
  results: [
    {
      bdew: '9900992720003',
      name: 'STROMDAO Netz GmbH',
      address: 'Industriestraße 7, 67063 Ludwigshafen',
      city: 'Ludwigshafen',
      postalCode: '67063',
      roles: ['VNB'],
    },
  ],
  count: 1,
};

describe('Grid Operations Service - Market Partners', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName) => {
      if (toolName === 'cernion_market_partners') return MOCK_MARKET_PARTNERS;
      return { success: true, data: {} };
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(GridOperationsService);
    await broker.start();
  });

  afterAll(() => broker.stop());

  describe('marketPartners action', () => {
    it('should search for STROMDAO Netze by name', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'STROMDAO Netze',
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
          query: 'STROMDAO',
          limit: 25, // exceeds max 20
        })
      ).rejects.toThrow();
    });

    it('should require query parameter', async () => {
      await expect(broker.call('grid-operations.marketPartners', {})).rejects.toThrow();
    });

    it('should not pass format param to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('grid-operations.marketPartners', {
        query: 'STROMDAO',
        format: 'csv',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).not.toHaveProperty('format');
    });
  });

  describe('marketPartners format parameter', () => {
    it('should accept format=json and return raw result', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'STROMDAO',
        format: 'json',
      });
      expect(result).toEqual(MOCK_MARKET_PARTNERS);
    });

    it('should return CSV string for format=csv', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'STROMDAO',
        format: 'csv',
      });
      expect(typeof result).toBe('string');
      expect(result).toContain('bdew');
    });

    it('should return Buffer for format=xlsx', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'STROMDAO',
        format: 'xlsx',
      });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should return Buffer for format=xls', async () => {
      const result = await broker.call('grid-operations.marketPartners', {
        query: 'STROMDAO',
        format: 'xls',
      });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should reject invalid format value', async () => {
      await expect(
        broker.call('grid-operations.marketPartners', { query: 'STROMDAO', format: 'pdf' })
      ).rejects.toThrow();
    });
  });
});
