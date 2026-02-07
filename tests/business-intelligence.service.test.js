/**
 * Business Intelligence Service Integration Tests
 *
 * Test the Business Intelligence microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const BusinessIntelligenceService = require('../services/business-intelligence.service');

describe('Business Intelligence Service', () => {
  let broker;

  beforeAll(() => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    callWithAutoPoll.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(BusinessIntelligenceService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('salesLeads action', () => {
    it('should require region and installation type', async () => {
      await expect(broker.call('business-intelligence.salesLeads', {})).rejects.toThrow();
    });

    it('should validate minScore range', async () => {
      await expect(
        broker.call('business-intelligence.salesLeads', {
          region: 'Heidelberg',
          installationType: 'solar',
          minScore: 150,
        })
      ).rejects.toThrow();
    });

    it('should accept valid sales leads query', async () => {
      const result = await broker.call('business-intelligence.salesLeads', {
        region: 'Heidelberg',
        installationType: 'solar',
        daysBack: 30,
        limit: 5,
        minScore: 80,
      });

      expect(result).toBeDefined();
    });
  });

  describe('churnPrediction action', () => {
    it('should validate customer segment enum', async () => {
      await expect(
        broker.call('business-intelligence.churnPrediction', {
          customerSegment: 'invalid',
          region: 'Heidelberg',
        })
      ).rejects.toThrow();
    });

    it('should accept valid churn prediction request', async () => {
      const result = await broker.call('business-intelligence.churnPrediction', {
        customerSegment: 'prosumer',
        region: 'Heidelberg',
        riskThreshold: 'high',
        limit: 10,
      });

      expect(result).toBeDefined();
    });
  });

  describe('dynamicTariffCalculator action', () => {
    it('should require all mandatory parameters', async () => {
      await expect(
        broker.call('business-intelligence.dynamicTariffCalculator', {})
      ).rejects.toThrow();
    });

    it('should accept valid tariff calculation request', async () => {
      const result = await broker.call('business-intelligence.dynamicTariffCalculator', {
        region: 'Heidelberg',
        tariffType: 'dynamic-spot',
        calculationPeriod: '2024',
        customerProfile: {
          annualConsumption: 4500,
          flexibleLoad: true,
        },
      });

      expect(result).toBeDefined();
    });
  });

  describe('marketPenetration action', () => {
    it('should require region parameter', async () => {
      await expect(broker.call('business-intelligence.marketPenetration', {})).rejects.toThrow();
    });

    it('should accept valid market penetration request', async () => {
      const result = await broker.call('business-intelligence.marketPenetration', {
        region: 'Heidelberg',
        currentCustomers: 1000,
        installationType: 'solar',
        includeWhiteSpots: true,
      });

      expect(result).toBeDefined();
    });
  });
});
