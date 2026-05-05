/**
 * System Service Integration Tests
 *
 * Test the System Tools microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

jest.mock('../src/llm-client', () => ({
  capabilities: jest.fn(() => ({
    provider: 'gemini',
    structured: true,
    embeddings: true,
    vision: false,
    contextWindow: null,
  })),
  generateText: jest.fn(async () => 'pong'),
  embeddings: jest.fn(async () => [[0.1, 0.2, 0.3]]),
}));

const { callWithNewSession } = require('../src/mcp-client');
const llmClient = require('../src/llm-client');
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

  beforeEach(() => {
    llmClient.capabilities.mockReturnValue({
      provider: 'gemini',
      structured: true,
      embeddings: true,
      vision: false,
      contextWindow: null,
    });
    llmClient.generateText.mockResolvedValue('pong');
    llmClient.embeddings.mockResolvedValue([[0.1, 0.2, 0.3]]);
  });

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

  describe('llmHealth action', () => {
    it('returns ok when text and embeddings probes succeed', async () => {
      const result = await broker.call('system.llmHealth', {});

      expect(result.status).toBe('ok');
      expect(result.signal).toBe('green');
      expect(result.provider).toBe('gemini');
      expect(result.checks.text.ok).toBe(true);
      expect(result.checks.embeddings.ok).toBe(true);
    });

    it('returns degraded when embeddings are unavailable', async () => {
      llmClient.capabilities.mockReturnValue({
        provider: 'ollama',
        structured: true,
        embeddings: false,
        vision: false,
        contextWindow: null,
      });

      const result = await broker.call('system.llmHealth', {});

      expect(result.status).toBe('degraded');
      expect(result.signal).toBe('yellow');
      expect(result.checks.text.ok).toBe(true);
      expect(result.checks.embeddings.ok).toBe(false);
      expect(result.checks.embeddings.message).toMatch(/does not support embeddings/i);
    });

    it('returns unhealthy when text probe fails', async () => {
      llmClient.generateText.mockRejectedValue(new Error('text failed'));

      const result = await broker.call('system.llmHealth', {});

      expect(result.status).toBe('unhealthy');
      expect(result.signal).toBe('red');
      expect(result.checks.text.ok).toBe(false);
      expect(result.checks.text.message).toMatch(/text failed/i);
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
