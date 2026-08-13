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

    it('should ignore a custom token and always use CERNION_TOKEN from environment', async () => {
      // Per 8068d97: ctx.meta.cernionToken (ck_* REST Bearer token) is not a
      // valid MCP credential and must never be forwarded to MCP auth.
      const connectSpy = jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockResolvedValue({
        success: true,
        data: { ok: true },
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      await CernionMCPClient.callWithNewSession('test_tool', {}, 'custom_token_abc');

      // Instance was created with the env token, not the ignored custom token
      expect(connectSpy.mock.instances[0].token).toBe('test_token_123');
    });

    it('should use CERNION_TOKEN from environment when custom token is not provided', async () => {
      process.env.CERNION_TOKEN = 'env_token_xyz';
      const connectSpy = jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockResolvedValue({
        success: true,
        data: { ok: true },
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      await CernionMCPClient.callWithNewSession('test_tool', {});

      // Instance was created with env token fallback
      expect(connectSpy.mock.instances[0].token).toBe('env_token_xyz');
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

  describe('CR-25/26: quota-error retry', () => {
    // Each test overrides QUOTA_RETRY_BASE_MS for speed.

    it('should retry on quota error and succeed on later attempt', async () => {
      let attempts = 0;
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error(
            'Failed to connect to Cernion MCP: Token quota exhausted. Please contact administrator.'
          );
        }
        return true;
      });
      jest
        .spyOn(CernionMCPClient.prototype, 'callTool')
        .mockResolvedValue({ success: true, data: { ok: true } });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0; // instant backoff for test

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      expect(result.success).toBe(true);
      expect(attempts).toBe(3); // failed twice, succeeded on third
    });

    it('should return QUOTA_EXHAUSTED error after all retries fail', async () => {
      jest
        .spyOn(CernionMCPClient.prototype, 'connect')
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

      await expect(CernionMCPClient.callWithNewSession('test_tool', {}, 'tok')).rejects.toThrow(
        'connection refused'
      );

      expect(attempts).toBe(1); // no retry
    });

    it('should sanitize token data in QUOTA_EXHAUSTED error message', async () => {
      jest
        .spyOn(CernionMCPClient.prototype, 'connect')
        .mockRejectedValue(
          new Error('quota exhausted for https://mcp.cernion.de/superSecretToken/mcp?token=abc123')
        );
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      const origMax = CernionMCPClient.MAX_QUOTA_RETRIES;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0;
      CernionMCPClient.MAX_QUOTA_RETRIES = 1;

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      CernionMCPClient.MAX_QUOTA_RETRIES = origMax;

      expect(result.success).toBe(false);
      expect(result.error.message).toContain('https://mcp.cernion.de/[REDACTED]/mcp');
      expect(result.error.message).not.toContain('superSecretToken');
      expect(result.error.message).not.toContain('abc123');
    });

    it('should sanitize token data in thrown non-quota errors', async () => {
      jest
        .spyOn(CernionMCPClient.prototype, 'connect')
        .mockRejectedValue(new Error('connection refused Bearer tokenValue123'));
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      await expect(CernionMCPClient.callWithNewSession('test_tool', {}, 'tok')).rejects.toThrow(
        'Bearer [REDACTED]'
      );
    });
  });

  describe('MCP session-error retry (-32001 "Session not found")', () => {
    // Reproduces the reported failure mode: connect() succeeds (a session was
    // issued), but the actual tool-call POST later fails because that
    // session expired/was recycled server-side. callTool()'s own catch block
    // turns this into a returned {success:false, error:{...}} rather than a
    // thrown exception, so the retry decision happens on the *returned*
    // object, not via a caught exception like the quota-error tests above.

    it('retries with a fresh session on a -32001 "Session not found" result and succeeds', async () => {
      let attempts = 0;
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          return {
            success: false,
            error: {
              code: 404,
              message:
                'Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}',
              toolName: 'test_tool',
            },
          };
        }
        return { success: true, data: { ok: true } };
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0;

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      expect(result.success).toBe(true);
      expect(attempts).toBe(2); // failed once with a session error, succeeded on retry
    });

    it('returns SESSION_ERROR_EXHAUSTED (not QUOTA_EXHAUSTED) after all session-error retries fail', async () => {
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockResolvedValue(true);
      jest.spyOn(CernionMCPClient.prototype, 'callTool').mockResolvedValue({
        success: false,
        error: { code: 404, message: 'Session not found', toolName: 'test_tool' },
      });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      const origMax = CernionMCPClient.MAX_QUOTA_RETRIES;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0;
      CernionMCPClient.MAX_QUOTA_RETRIES = 2;

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      CernionMCPClient.MAX_QUOTA_RETRIES = origMax;

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('SESSION_ERROR_EXHAUSTED');
      expect(result.error.toolName).toBe('test_tool');
    });

    it('also retries when the session error surfaces as a thrown connect() exception', async () => {
      let attempts = 0;
      jest.spyOn(CernionMCPClient.prototype, 'connect').mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Failed to connect to Cernion MCP: -32001 Session not found');
        }
        return true;
      });
      jest
        .spyOn(CernionMCPClient.prototype, 'callTool')
        .mockResolvedValue({ success: true, data: { ok: true } });
      jest.spyOn(CernionMCPClient.prototype, 'disconnect').mockResolvedValue();

      const origBase = CernionMCPClient.QUOTA_RETRY_BASE_MS;
      CernionMCPClient.QUOTA_RETRY_BASE_MS = 0;

      const result = await CernionMCPClient.callWithNewSession('test_tool', {}, 'tok');

      CernionMCPClient.QUOTA_RETRY_BASE_MS = origBase;
      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });
});
