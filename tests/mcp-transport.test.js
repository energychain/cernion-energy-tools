'use strict';

const http = require('http');
const { ServiceBroker } = require('moleculer');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const McpServerService = require('../services/mcp-server.service');
const { createMcpHttpHandlers } = require('../src/mcp-transport');

describe('MCP transport (real streamable-HTTP round trip)', () => {
  let broker;
  let httpServer;
  let baseUrl;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'agent-manifest',
      actions: {
        listCapabilities: {
          handler() {
            return {
              success: true,
              data: [{ capability: 'redispatch_asset_register', intent: 'List assets' }],
            };
          },
        },
        listOperations: {
          handler() {
            return { success: true, data: [] };
          },
        },
      },
    });

    broker.createService({
      name: 'personal-agent',
      actions: {
        askCernionAgent: {
          handler(ctx) {
            return { sessionId: 's1', shortAnswer: `answered: ${ctx.params.question}` };
          },
        },
      },
    });

    broker.createService({
      name: 'copilot-process',
      actions: {
        prepareProcessIntent: {
          handler() {
            return {
              success: true,
              receipt: { intentId: 'intent-1', status: 'pending_confirmation' },
              executeVia: { operationId: 'executeProcessIntent' },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'token-manager',
      actions: {
        verify: {
          handler(ctx) {
            if (ctx.params.token === 'ck_full') {
              return { valid: true, tokenId: 't1', scope: 'full-access', scopes: [] };
            }
            if (ctx.params.token === 'ck_readonly') {
              return { valid: true, tokenId: 't2', scope: 'read-only', scopes: [] };
            }
            return { valid: false, reason: 'INVALID' };
          },
        },
      },
    });

    broker.createService(McpServerService);
    await broker.start();

    const handlers = createMcpHttpHandlers(broker);
    httpServer = http.createServer(async (req, res) => {
      if (req.url !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      if (req.method === 'POST') return handlers.post(req, res);
      if (req.method === 'GET') return handlers.get(req, res);
      if (req.method === 'DELETE') return handlers.delete(req, res);
      res.writeHead(405).end();
    });

    await new Promise((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  });

  afterAll(async () => {
    await broker.stop();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  async function connectClient(bearerToken) {
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(transport);
    return client;
  }

  test('lists exactly the 9 documented meta-tools', async () => {
    const client = await connectClient('legacy-plain-token');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'cernion_ask',
        'cernion_describe',
        'cernion_execute_process',
        'cernion_execute_read',
        'cernion_get_context',
        'cernion_prepare_process',
        'cernion_process_status',
        'cernion_run_receipt',
        'cernion_search',
      ].sort()
    );
    await client.close();
  });

  test('cernion_search works over a legacy bearer token', async () => {
    const client = await connectClient('legacy-plain-token');
    const result = await client.callTool({
      name: 'cernion_search',
      arguments: { query: 'redispatch', kind: 'capability' },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.results[0].ref).toBe('cernion://capability/redispatch_asset_register');
    await client.close();
  });

  test('cernion_ask works over a legacy bearer token (RBAC bypass parity)', async () => {
    const client = await connectClient('legacy-plain-token');
    const result = await client.callTool({
      name: 'cernion_ask',
      arguments: { question: 'Wieviel PV?' },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.shortAnswer).toBe('answered: Wieviel PV?');
    await client.close();
  });

  test('cernion_prepare_process succeeds for a full-access ck_ token', async () => {
    const client = await connectClient('ck_full');
    const result = await client.callTool({
      name: 'cernion_prepare_process',
      arguments: { operationFamily: 'test_family', proposedAction: 'do_thing' },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ref).toBe('cernion://intent/intent-1');
    await client.close();
  });

  test('cernion_prepare_process is refused for a read-only ck_ token', async () => {
    const client = await connectClient('ck_readonly');
    const result = await client.callTool({
      name: 'cernion_prepare_process',
      arguments: { operationFamily: 'test_family', proposedAction: 'do_thing' },
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.type).toBe('ROLE_REQUIRED');
    await client.close();
  });

  test('a bad ck_ token is refused at session initialization', async () => {
    await expect(connectClient('ck_bogus')).rejects.toThrow();
  });
});
