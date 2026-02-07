/**
 * System Service Integration Tests
 *
 * Test the System Tools microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const SystemService = require('../services/system.service');

describe('System Service', () => {
  let broker;

  beforeAll(() => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(SystemService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('status action', () => {
    it('should return system status', async () => {
      const result = await broker.call('system.status', {});

      expect(result).toBeDefined();
    });

    it('should accept verbose parameter', async () => {
      const result = await broker.call('system.status', {
        verbose: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('validateParams action', () => {
    it('should require tool and params', async () => {
      await expect(broker.call('system.validateParams', {})).rejects.toThrow();
    });

    it('should accept valid validation request', async () => {
      const result = await broker.call('system.validateParams', {
        tool: 'cernion_ask',
        params: { query: 'test query' },
      });

      expect(result).toBeDefined();
    });
  });

  describe('jobStatus action', () => {
    it('should require jobId parameter', async () => {
      await expect(broker.call('system.jobStatus', {})).rejects.toThrow();
    });

    it('should accept valid job ID', async () => {
      const result = await broker.call('system.jobStatus', {
        jobId: 'test-job-123',
      });

      expect(result).toBeDefined();
    });
  });

  describe('jobResult action', () => {
    it('should require jobId parameter', async () => {
      await expect(broker.call('system.jobResult', {})).rejects.toThrow();
    });

    it('should accept valid job ID', async () => {
      const result = await broker.call('system.jobResult', {
        jobId: 'test-job-123',
      });

      expect(result).toBeDefined();
    });
  });
});
