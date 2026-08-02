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

    broker.createService({
      name: 'agent-receipts',
      actions: {
        list: {
          handler() {
            return {
              success: true,
              data: [
                { receiptId: 'bess-screening-v1', title: 'BESS screening', description: 'storage' },
              ],
            };
          },
        },
        get: {
          params: { id: { type: 'string' } },
          handler(ctx) {
            return { success: true, data: { receiptId: ctx.params.id, title: 'BESS screening' } };
          },
        },
        explainStored: {
          params: { id: { type: 'string' } },
          handler() {
            return { success: true, data: { summary: 'would run 1 step' } };
          },
        },
      },
    });

    broker.createService({
      name: 'blueprint-management',
      actions: {
        list: {
          handler() {
            return {
              success: true,
              data: [
                {
                  blueprintId: 'ev-charging-co2-optimization-v1',
                  title: 'EV CO2',
                  description: 'charging',
                },
              ],
            };
          },
        },
        get: {
          params: { id: { type: 'string' } },
          handler(ctx) {
            return { success: true, data: { blueprintId: ctx.params.id, title: 'EV CO2' } };
          },
        },
      },
    });

    broker.createService({
      name: 'cookbook',
      actions: {
        list: {
          handler() {
            return {
              success: true,
              data: [
                {
                  id: 'vnb-assets-from-name',
                  title: 'Find VNB assets from company name',
                  problem: 'A user mentions a grid operator by name.',
                  process: [
                    {
                      step: 1,
                      service: 'grid-operations',
                      action: 'grid-operations.marketPartners',
                      description: 'Resolve market partner record.',
                    },
                  ],
                  expectedResult: 'A list of matching installations.',
                },
              ],
            };
          },
        },
        get: {
          params: { id: { type: 'string' } },
          handler(ctx) {
            return {
              success: true,
              data: { id: ctx.params.id, title: 'Find VNB assets from company name' },
            };
          },
        },
        search: {
          params: { query: { type: 'string' }, limit: { type: 'number', optional: true } },
          handler() {
            return {
              success: true,
              data: [
                {
                  id: 'vnb-assets-from-name',
                  title: 'Find VNB assets from company name',
                  description: 'lookup',
                },
              ],
            };
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

  test('resources/list returns entries from all 4 browsable kinds', async () => {
    const client = await connectClient('legacy-plain-token');
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('cernion://capability/redispatch_asset_register');
    expect(uris).toContain('cernion://receipt/bess-screening-v1');
    expect(uris).toContain('cernion://blueprint/ev-charging-co2-optimization-v1');
    expect(uris).toContain('cernion://recipe/vnb-assets-from-name');
    await client.close();
  });

  test('resources/read fetches the full describe() payload for a receipt', async () => {
    const client = await connectClient('legacy-plain-token');
    const result = await client.readResource({ uri: 'cernion://receipt/bess-screening-v1' });
    expect(result.contents).toHaveLength(1);
    const data = JSON.parse(result.contents[0].text);
    expect(data.receipt.receiptId).toBe('bess-screening-v1');
    await client.close();
  });

  test('prompts/list exposes one prompt per cookbook recipe', async () => {
    const client = await connectClient('legacy-plain-token');
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('vnb-assets-from-name');
    await client.close();
  });

  test('prompts/get renders the recipe as a task + step-by-step message', async () => {
    const client = await connectClient('legacy-plain-token');
    const result = await client.getPrompt({ name: 'vnb-assets-from-name' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content.text).toContain('A user mentions a grid operator by name.');
    expect(result.messages[0].content.text).toContain('Resolve market partner record.');
    await client.close();
  });
});

describe('MCP transport self-healing (v0.99.4) — mcp-server missing from the broker at boot', () => {
  // Reproduces the production symptom that motivated this: initialize and
  // tools/list work (both served from this file's static TOOL_DEFS), but
  // every actual tool call previously failed with SERVICE_NOT_FOUND because
  // services/mcp-server.service.js hadn't been loaded into the broker.
  // Deliberately does NOT call broker.createService(McpServerService) here.
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
            return { success: true, data: [{ capability: 'redispatch_asset_register' }] };
          },
        },
      },
    });

    await broker.start();

    const handlers = createMcpHttpHandlers(broker);
    httpServer = http.createServer(async (req, res) => {
      if (req.url !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      if (req.method === 'POST') return handlers.post(req, res);
      if (req.method === 'GET') return handlers.get(req, res);
      res.writeHead(405).end();
    });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  });

  afterAll(async () => {
    await broker.stop();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test('connecting self-heals mcp-server eagerly, before tools/list or any tool call', async () => {
    expect(broker.registry.getServiceList({}).some((s) => s.name === 'mcp-server')).toBe(false);

    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: 'Bearer legacy-plain-token' } },
    });
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(transport);

    // buildSessionMcpServer() awaits ensureMcpServerReady() itself (to
    // register recipe prompts, which need mcp-server's actions) — so the
    // self-heal already happened by the time connect() resolves, before
    // any tool call.
    expect(broker.registry.getServiceList({}).some((s) => s.name === 'mcp-server')).toBe(true);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    await client.close();
  });

  test('a real tool call works after the eager self-heal (no SERVICE_NOT_FOUND)', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: 'Bearer legacy-plain-token' } },
    });
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await client.connect(transport);

    const result = await client.callTool({
      name: 'cernion_search',
      arguments: { query: 'redispatch', kind: 'capability' },
    });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.results[0].ref).toBe('cernion://capability/redispatch_asset_register');

    expect(broker.registry.getServiceList({}).some((s) => s.name === 'mcp-server')).toBe(true);
    await client.close();
  });
});
