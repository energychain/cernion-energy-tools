/**
 * MCP Client Tests
 *
 * Unit tests for the Cernion MCP client utility
 */

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn(),
}));

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const CernionMCPClient = require('../src/mcp-client');

describe('CernionMCPClient', () => {
  let client;
  let clientInstance;

  beforeEach(() => {
    process.env.CERNION_TOKEN = 'test_token_123';
    // Reset sequential call queue and disable inter-call delay so tests run fast.
    CernionMCPClient._callQueue = Promise.resolve();
    CernionMCPClient.INTER_CALL_DELAY_MS = 0;
    clientInstance = {
      connect: jest.fn(),
      callTool: jest.fn(),
      listTools: jest.fn(),
      close: jest.fn(),
    };
    Client.mockImplementation(() => clientInstance);
    StreamableHTTPClientTransport.mockImplementation(() => ({}));
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect();
      client = null;
    }
    CernionMCPClient.INTER_CALL_DELAY_MS = 500; // restore production default
    CernionMCPClient._callQueue = Promise.resolve();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create client with valid token', () => {
      client = new CernionMCPClient('test_token');
      expect(client).toBeDefined();
      expect(client.token).toBe('test_token');
      expect(client.baseUrl).toBe('https://mcp.cernion.de/test_token/mcp');
    });

    it('should throw error without token', () => {
      expect(() => new CernionMCPClient()).toThrow('CERNION_TOKEN is required');
    });
  });

  describe('callWithNewSession', () => {
    it('should return error when token is missing', async () => {
      delete process.env.CERNION_TOKEN;
      const result = await CernionMCPClient.callWithNewSession('test_tool', {});

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('MISSING_TOKEN');
    });

    it('should handle successful tool call', async () => {
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockResolvedValue({
        success: true,
        data: { ok: true },
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const result = await CernionMCPClient.callWithNewSession('test_tool', { foo: 'bar' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ ok: true });
    });
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      clientInstance.connect.mockResolvedValue(true);
      client = new CernionMCPClient('test_token');

      const result = await client.connect();

      expect(result).toBe(true);
      expect(Client).toHaveBeenCalled();
      expect(StreamableHTTPClientTransport).toHaveBeenCalled();
      expect(clientInstance.connect).toHaveBeenCalled();
    });

    it('should retry on connection failure', async () => {
      jest.useFakeTimers();
      clientInstance.connect
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockResolvedValueOnce(true);
      client = new CernionMCPClient('test_token');

      const connectPromise = client.connect();
      await jest.runAllTimersAsync();
      const result = await connectPromise;

      expect(result).toBe(true);
      expect(clientInstance.connect).toHaveBeenCalledTimes(3);
      jest.useRealTimers();
    });
  });

  describe('callTool', () => {
    it('should parse JSON content and merge response', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: '{"value": 42}' }],
      });
      client = new CernionMCPClient('test_token');
      await client.connect();

      const result = await client.callTool('test_tool', {});

      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
      expect(result.metadata.toolName).toBe('test_tool');
    });

    it('should return additional data when present', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'not-json' }],
        statistics: { total: 1 },
      });
      client = new CernionMCPClient('test_token');
      await client.connect();

      const result = await client.callTool('test_tool', {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ statistics: { total: 1 } });
    });

    it('should handle async job response', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.callTool.mockResolvedValue({
        content: [{ type: 'text', text: '{"job_id":"job-123"}' }],
      });
      client = new CernionMCPClient('test_token');
      jest.spyOn(client, 'pollJobResult').mockResolvedValue({
        success: true,
        data: { done: true },
      });
      await client.connect();

      const result = await client.callTool('test_tool', {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ done: true });
    });

    it('should return error on tool call failure', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.callTool.mockRejectedValue({ code: 'ERR', message: 'Boom' });
      client = new CernionMCPClient('test_token');
      await client.connect();

      const result = await client.callTool('test_tool', {});

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('ERR');
    });
  });

  describe('pollJobResult', () => {
    it('should return data when job succeeds with JSON content', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'succeeded',
              content: [{ text: '{"result":true}' }],
            }),
          },
        ],
      });
      client = new CernionMCPClient('test_token');
      await client.connect();

      const result = await client.pollJobResult('job-1', 1, 1);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ result: true });
    });

    it('should return error when job fails', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'failed', message: 'Failed' }),
          },
        ],
      });
      client = new CernionMCPClient('test_token');
      await client.connect();

      const result = await client.pollJobResult('job-1', 1, 1);

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('JOB_FAILED');
    });
  });

  describe('listTools', () => {
    it('should return tools list', async () => {
      clientInstance.connect.mockResolvedValue(true);
      clientInstance.listTools.mockResolvedValue({ tools: [{ name: 'tool-1' }] });
      client = new CernionMCPClient('test_token');
      await client.connect();

      const result = await client.listTools();

      expect(result.success).toBe(true);
      expect(result.tools).toHaveLength(1);
    });
  });

  describe('disconnect', () => {
    it('should close client and reset state', async () => {
      clientInstance.connect.mockResolvedValue(true);
      client = new CernionMCPClient('test_token');
      await client.connect();

      await client.disconnect();

      expect(clientInstance.close).toHaveBeenCalled();
      expect(client.client).toBeNull();
    });
  });

  describe('CR-25: sequential call queue and quota-error retry', () => {
    // Each test overrides INTER_CALL_DELAY_MS and QUOTA_RETRY_BASE_MS for speed.
    // The global beforeEach already sets INTER_CALL_DELAY_MS = 0 and resets _callQueue.

    it('should retry on quota error and succeed on later attempt', async () => {
      let attempts = 0;
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed to connect to Cernion MCP: Token quota exhausted. Please contact administrator.');
        }
        return true;
      });
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockResolvedValue({ success: true, data: { ok: true } });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0; // instant backoff for test

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      expect(result.success).toBe(true);
      expect(attempts).toBe(3); // failed twice, succeeded on third
    });

    it('should return QUOTA_EXHAUSTED error after all retries fail', async () => {
      jest.spyOn(CernionMCPClient.prototype, 'connect')
        .mockRejectedValue(new Error('Token quota exhausted. Please contact administrator.'));
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      const origMax = CernionMCPClient.MAX_QUOTA_RETRIES;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0;
      CernionMCPClient.MAX_QUOTA_RETRIES = 2;

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      CernionMCPClient.MAX_QUOTA_RETRIES = origMax;

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('QUOTA_EXHAUSTED');
      expect(result.error.toolName).toBe('test_tool');
    });

    it('should NOT retry on non-quota errors', async () => {
      let attempts = 0;
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockImplementation(async () => {
        attempts++;
        throw new Error('Network error: connection refused');
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      await expect(
        CernionMCPClient.callWithNewSession('test_tool', {}, 'tok')
      ).rejects.toThrow('connection refused');

      expect(attempts).toBe(1); // no retry
    });

    it('should serialise concurrent calls so they never overlap', async () => {
      const callOrder = [];
      CernionMCPClient.INTER_CALL_DELAY_MS = 10; // small non-zero delay

      jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockImplementation(async (name) => {
        callOrder.push(`start-${name}`);
        await new Promise((r) => setTimeout(r, 5));
        callOrder.push(`end-${name}`);
        return { success: true };
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      // Fire 3 calls simultaneously (simulating Promise.all in the pipeline)
      await Promise.all([
        CernionMCPClient.callWithNewSession('tool-1', {}, 'tok'),
        CernionMCPClient.callWithNewSession('tool-2', {}, 'tok'),
        CernionMCPClient.callWithNewSession('tool-3', {}, 'tok'),
      ]);

      // Sequential queue must prevent interleaving: each call must fully complete
      // before the next one starts.
      expect(callOrder).toEqual([
        'start-tool-1', 'end-tool-1',
        'start-tool-2', 'end-tool-2',
        'start-tool-3', 'end-tool-3',
      ]);
    });

    it('should handle INTER_CALL_DELAY_MS = 0 without delay', async () => {
      // INTER_CALL_DELAY_MS is already 0 (set in outer beforeEach)
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockResolvedValue({ success: true });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const start = Date.now();
      await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');
      const elapsed = Date.now() - start;

      // Should complete in well under 100ms with no delay
      expect(elapsed).toBeLessThan(100);
    });
  });
});
