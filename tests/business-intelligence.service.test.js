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

    it('should return CSV with summary row for format=csv', async () => {
      const narrative = [
        '\uD83D\uDCCA **Churn Prediction Analysis**',
        'Estimated at-risk customers (max 100): 60',
        'Assumed churn rate (segment): 8.0%',
        '\u2139\uFE0F This tool currently uses a heuristic model without customer-level CRM data.',
      ].join('\n');

      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        data: { content: [{ type: 'text', text: narrative }] },
      });

      const ctx = { meta: {} };
      const result = await broker.call(
        'business-intelligence.churnPrediction',
        { customerSegment: 'all', region: '67059', riskThreshold: 'medium', predictionWindowMonths: 3, format: 'csv' },
        ctx
      );

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^# Churn Prediction Export/);
      expect(result).toContain('# Segment: all');
      expect(result).toContain('# Region: 67059');
      expect(result).toContain('# Note: Heuristic model');
      expect(result).toContain('"customerSegment","region","riskThreshold","predictionWindowMonths","estimatedAtRiskCustomers","assumedChurnRatePct","isHeuristicModel","analysisText"');
      expect(result).toContain('"all","67059","medium",3,60,8,"true"');
    });

    it('should not forward format to MCP tool', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('business-intelligence.churnPrediction', {
        customerSegment: 'all',
        region: '67059',
        format: 'csv',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_customer_churn_prediction',
        expect.not.objectContaining({ format: expect.anything() }),
        expect.any(Object),
        undefined
      );
    });

    it('should return JSON for format=json (default)', async () => {
      const mockResult = { success: true, data: { content: [{ type: 'text', text: 'Estimated at-risk customers (max 100): 30\nAssumed churn rate (segment): 5.0%' }] } };
      callWithAutoPoll.mockResolvedValueOnce(mockResult);

      const result = await broker.call('business-intelligence.churnPrediction', {
        customerSegment: 'prosumer',
        region: 'Bayern',
      });

      expect(result).toEqual(mockResult);
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
