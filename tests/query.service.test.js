/**
 * Query Service Integration Tests
 *
 * Test the Query Tools microservice
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
const QueryService = require('../services/query.service');

describe('Query Service', () => {
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
    broker.createService(QueryService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('ask action', () => {
    it('should validate required query parameter', async () => {
      await expect(broker.call('query.ask', {})).rejects.toThrow();
    });

    it('should accept valid query', async () => {
      const result = await broker.call('query.ask', {
        query: 'Wieviel PV-Leistung in Bayern?',
      });

      // Result structure depends on MCP response
      expect(result).toBeDefined();
    });

    it('should handle explain parameter', async () => {
      const result = await broker.call('query.ask', {
        query: 'Wieviel PV-Leistung in Bayern?',
        explain: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('askLearned action', () => {
    it('should validate confidence parameter range', async () => {
      await expect(
        broker.call('query.askLearned', {
          query: 'Test query',
          confidence: 1.5,
        })
      ).rejects.toThrow();
    });

    it('should accept valid learned query', async () => {
      const result = await broker.call('query.askLearned', {
        query: 'PV-Leistung in Hessen',
        confidence: 0.7,
      });

      expect(result).toBeDefined();
    });
  });

  describe('discover action', () => {
    it('should validate scope enum', async () => {
      await expect(
        broker.call('query.discover', {
          scope: 'invalid_scope',
        })
      ).rejects.toThrow();
    });

    it('should discover databases', async () => {
      const result = await broker.call('query.discover', {
        scope: 'databases',
      });

      expect(result).toBeDefined();
    });

    it('should discover tools', async () => {
      const result = await broker.call('query.discover', {
        scope: 'tools',
      });

      expect(result).toBeDefined();
    });
  });
});
