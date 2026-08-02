'use strict';

const { ServiceBroker } = require('moleculer');
const McpServerService = require('../services/mcp-server.service');

describe('MCP Server meta-tools', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'agent-manifest',
      actions: {
        listCapabilities: {
          params: { domain: { type: 'string', optional: true } },
          handler(ctx) {
            const rows = [
              {
                capability: 'redispatch_asset_register',
                domain: 'redispatch',
                intent: 'List assets',
              },
            ];
            return {
              success: true,
              data: ctx.params.domain ? rows.filter((r) => r.domain === ctx.params.domain) : rows,
            };
          },
        },
        getCapability: {
          params: { name: { type: 'string' } },
          handler(ctx) {
            if (ctx.params.name !== 'redispatch_asset_register') {
              throw new (require('moleculer').Errors.MoleculerClientError)('not found', 404);
            }
            return { success: true, data: { capability: ctx.params.name, intent: 'List assets' } };
          },
        },
        listOperations: {
          params: { domain: { type: 'string', optional: true } },
          handler() {
            return {
              success: true,
              data: [
                {
                  method: 'GET',
                  path: '/api/energy-market/prices',
                  operationId: 'getPrices',
                  summary: 'Prices',
                  tags: [],
                },
                {
                  method: 'POST',
                  path: '/api/copilot-process/intents',
                  operationId: 'prepareProcessIntent',
                  summary: 'Prepare intent',
                  tags: [],
                },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'personal-agent',
      actions: {
        askCernionAgent: {
          params: { question: { type: 'string' } },
          handler(ctx) {
            return {
              sessionId: 's1',
              question: ctx.params.question,
              shortAnswer: 'answer',
              evidence: [],
            };
          },
        },
        answerDossier: {
          params: { question: { type: 'string' } },
          handler(ctx) {
            return { sessionId: 's1', question: ctx.params.question, dossierMarkdown: '# dossier' };
          },
        },
      },
    });

    broker.createService({
      name: 'evidence-router',
      actions: {
        route: {
          params: { question: { type: 'string' } },
          handler() {
            return { success: true, resolved: { kind: 'evidence_plan' } };
          },
        },
      },
    });

    broker.createService({
      name: 'agent-receipts',
      actions: {
        list: {
          params: {
            domain: { type: 'string', optional: true },
            limit: { type: 'number', optional: true },
          },
          handler() {
            return {
              success: true,
              data: [
                {
                  receiptId: 'bess-screening-v1',
                  title: 'BESS screening',
                  description: 'storage receipt',
                  tags: ['bess'],
                },
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
        test: {
          params: {
            id: { type: 'string', optional: true },
            receipt: { type: 'object', optional: true },
            context: { type: 'object', optional: true },
            input: { type: 'object', optional: true },
          },
          handler(ctx) {
            const executable = ctx.params.input && ctx.params.input.gridOperator === 'Netze BW';
            return {
              success: true,
              data: {
                receiptId: ctx.params.id || 'inline-receipt',
                executable: !!executable,
                plan: { steps: [{ action: 'grid-operations.marketPartners', params: {} }] },
                missingRequiredInputs: executable ? [] : ['gridOperator'],
                warnings: [],
                errors: [],
              },
            };
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
        search: {
          params: { query: { type: 'string' }, limit: { type: 'number', optional: true } },
          handler() {
            return {
              success: true,
              data: [{ id: 'vnb-assets-from-name', title: 'VNB assets', description: 'lookup' }],
            };
          },
        },
        get: {
          params: { id: { type: 'string' } },
          handler(ctx) {
            return { success: true, data: { id: ctx.params.id, title: 'VNB assets' } };
          },
        },
      },
    });

    broker.createService({
      name: 'copilot-process',
      actions: {
        prepareProcessIntent: {
          params: { operationFamily: { type: 'string' }, proposedAction: { type: 'string' } },
          handler(ctx) {
            return {
              success: true,
              resolved: { kind: 'process_intake' },
              receipt: {
                intentId: 'intent-1',
                operationFamily: ctx.params.operationFamily,
                proposedAction: ctx.params.proposedAction,
                status: 'pending_confirmation',
              },
              executeVia: { operationId: 'executeProcessIntent', note: 'human executes' },
            };
          },
        },
        getProcessIntent: {
          params: { intentId: { type: 'string' } },
          handler(ctx) {
            return { intentId: ctx.params.intentId, status: 'pending_confirmation' };
          },
        },
        listProcessIntents: {
          handler() {
            return {
              count: 1,
              intents: [{ intentId: 'intent-1', status: 'pending_confirmation' }],
            };
          },
        },
        executeProcessIntent: {
          params: { intentId: { type: 'string' } },
          handler(ctx) {
            if (ctx.params.intentId === 'generic-intent') {
              const err = new (require('moleculer').Errors.MoleculerClientError)(
                'Unknown operationFamily',
                400,
                'UNKNOWN_OPERATION_FAMILY'
              );
              throw err;
            }
            return { intentId: ctx.params.intentId, status: 'executed' };
          },
        },
        rejectProcessIntent: {
          params: { intentId: { type: 'string' }, reason: { type: 'string' } },
          handler(ctx) {
            return { intentId: ctx.params.intentId, status: 'rejected', reason: ctx.params.reason };
          },
        },
      },
    });

    broker.createService({
      name: 'job-status',
      actions: {
        status: {
          params: { jobId: { type: 'string' } },
          handler(ctx) {
            return {
              jobId: ctx.params.jobId,
              status: 'completed',
              resultUrl: `/api/jobs/${ctx.params.jobId}/result`,
            };
          },
        },
      },
    });

    broker.createService({
      name: 'hitl',
      actions: {
        get: {
          params: { id: { type: 'string' } },
          handler(ctx) {
            return { success: true, item: { id: ctx.params.id, status: 'pending' } };
          },
        },
        list: {
          handler() {
            return { success: true, count: 1, items: [{ id: 'hitl-1', status: 'pending' }] };
          },
        },
      },
    });

    broker.createService({
      name: 'agent-sidecar',
      actions: {
        descriptor: {
          handler() {
            return { name: 'cernion', tools: [] };
          },
        },
      },
    });

    broker.createService({
      name: 'tenant-quota',
      actions: {
        getQuotas: {
          params: { id: { type: 'string' } },
          handler(ctx) {
            return { success: true, data: { tenantId: ctx.params.id, limits: {} } };
          },
        },
      },
    });

    broker.createService(McpServerService);
    await broker.start();
  });

  afterAll(() => broker.stop());

  const FULL_ACCESS_META = { authUser: { roles: ['full-access'] } };

  test('ask (compact) delegates to personal-agent.askCernionAgent', async () => {
    const res = await broker.call(
      'mcp-server.ask',
      { question: 'Wieviel PV in Bayern?' },
      { meta: FULL_ACCESS_META }
    );
    expect(res.success).toBe(true);
    expect(res.shortAnswer).toBe('answer');
  });

  test('ask (dossier) delegates to personal-agent.answerDossier', async () => {
    const res = await broker.call(
      'mcp-server.ask',
      { question: 'Frage', format: 'dossier' },
      { meta: FULL_ACCESS_META }
    );
    expect(res.dossierMarkdown).toBe('# dossier');
  });

  test('ask refuses a caller without the full-access role', async () => {
    await expect(
      broker.call(
        'mcp-server.ask',
        { question: 'Frage' },
        { meta: { authUser: { roles: ['read-only'] } } }
      )
    ).rejects.toMatchObject({ type: 'ROLE_REQUIRED' });
  });

  test('ask allows a legacy bearer token (bypassRbac, matches REST gateway parity)', async () => {
    const res = await broker.call(
      'mcp-server.ask',
      { question: 'Frage' },
      { meta: { bypassRbac: true, authUser: null } }
    );
    expect(res.success).toBe(true);
  });

  test('search fans out across kinds and filters by query', async () => {
    const res = await broker.call('mcp-server.search', { query: 'bess' });
    expect(res.success).toBe(true);
    expect(
      res.results.some(
        (r) => r.kind === 'receipt' && r.ref === 'cernion://receipt/bess-screening-v1'
      )
    ).toBe(true);
  });

  test('search with kind filter only queries that kind', async () => {
    const res = await broker.call('mcp-server.search', { query: 'ev-charging', kind: 'blueprint' });
    expect(res.results).toHaveLength(1);
    expect(res.results[0].kind).toBe('blueprint');
  });

  test('describe resolves a receipt ref', async () => {
    const res = await broker.call('mcp-server.describe', {
      ref: 'cernion://receipt/bess-screening-v1',
    });
    expect(res.success).toBe(true);
    expect(res.data.receipt.receiptId).toBe('bess-screening-v1');
    expect(res.data.explanation.summary).toBe('would run 1 step');
  });

  test('describe an operation includes execute-read policy', async () => {
    const res = await broker.call('mcp-server.describe', { kind: 'operation', id: 'getPrices' });
    expect(res.data.executeReadPolicy.allowed).toBe(true);
  });

  test('executeRead refuses a non-allowlisted write operation', async () => {
    await expect(
      broker.call(
        'mcp-server.executeRead',
        { operationId: 'prepareProcessIntent' },
        { meta: { mcpBearerToken: 'tok' } }
      )
    ).rejects.toMatchObject({ type: 'MCP_EXECUTE_READ_FORBIDDEN' });
  });

  test('executeRead requires a bearer token', async () => {
    await expect(
      broker.call('mcp-server.executeRead', { operationId: 'getPrices' })
    ).rejects.toMatchObject({
      type: 'MCP_NO_BEARER_TOKEN',
    });
  });

  test('runReceipt returns a plan when not executable', async () => {
    const res = await broker.call('mcp-server.runReceipt', {
      id: 'bess-screening-v1',
      mode: 'run',
    });
    expect(res.mode).toBe('plan');
    expect(res.plan.executable).toBe(false);
  });

  test('runReceipt mode=run creates a confirmation intent when executable', async () => {
    const res = await broker.call(
      'mcp-server.runReceipt',
      { id: 'bess-screening-v1', mode: 'run', input: { gridOperator: 'Netze BW' } },
      { meta: FULL_ACCESS_META }
    );
    expect(res.mode).toBe('run');
    expect(res.intent.intentId).toBe('intent-1');
    expect(res.intent.operationFamily).toBe('agent-receipt');
  });

  test('runReceipt mode=run refuses a caller without full-access when executable', async () => {
    await expect(
      broker.call(
        'mcp-server.runReceipt',
        { id: 'bess-screening-v1', mode: 'run', input: { gridOperator: 'Netze BW' } },
        { meta: { authUser: { roles: ['read-only'] } } }
      )
    ).rejects.toMatchObject({ type: 'ROLE_REQUIRED' });
  });

  test('prepareProcess creates an intent and returns its ref', async () => {
    const res = await broker.call(
      'mcp-server.prepareProcess',
      { operationFamily: 'customer_master_data_correction', proposedAction: 'correct_address' },
      { meta: FULL_ACCESS_META }
    );
    expect(res.ref).toBe('cernion://intent/intent-1');
  });

  test('prepareProcess refuses a caller without the full-access role', async () => {
    await expect(
      broker.call(
        'mcp-server.prepareProcess',
        { operationFamily: 'customer_master_data_correction', proposedAction: 'correct_address' },
        { meta: { authUser: { roles: ['read-only'] } } }
      )
    ).rejects.toMatchObject({ type: 'ROLE_REQUIRED' });
  });

  test('executeProcess rejects an intent when action=reject', async () => {
    const res = await broker.call(
      'mcp-server.executeProcess',
      { intentId: 'intent-1', action: 'reject', reason: 'no longer needed' },
      { meta: FULL_ACCESS_META }
    );
    expect(res.status).toBe('rejected');
  });

  test('executeProcess surfaces a friendly error for generic-family intents', async () => {
    await expect(
      broker.call(
        'mcp-server.executeProcess',
        { intentId: 'generic-intent' },
        { meta: FULL_ACCESS_META }
      )
    ).rejects.toMatchObject({ type: 'MCP_INTENT_REQUIRES_MANUAL_EXECUTION' });
  });

  test('executeProcess refuses a caller without the full-access role', async () => {
    await expect(
      broker.call(
        'mcp-server.executeProcess',
        { intentId: 'intent-1' },
        { meta: { authUser: { roles: ['read-only'] } } }
      )
    ).rejects.toMatchObject({ type: 'ROLE_REQUIRED' });
  });

  test('processStatus resolves an intent ref', async () => {
    const res = await broker.call('mcp-server.processStatus', { ref: 'cernion://intent/intent-1' });
    expect(res.data.status).toBe('pending_confirmation');
  });

  test('processStatus list=open merges intents and hitl items', async () => {
    const res = await broker.call('mcp-server.processStatus', { list: 'open' });
    expect(res.intents).toHaveLength(1);
    expect(res.hitlItems).toHaveLength(1);
  });

  test('getContext includes descriptor and quotas when tenantId is known', async () => {
    const res = await broker.call('mcp-server.getContext', { tenantId: 'stadtwerk-a' });
    expect(res.descriptor.name).toBe('cernion');
    expect(res.quotas.tenantId).toBe('stadtwerk-a');
  });

  test('getContext omits quotas gracefully when no tenantId is known', async () => {
    const res = await broker.call('mcp-server.getContext', {});
    expect(res.quotas).toBeNull();
    expect(res.quotasNote).toBeTruthy();
  });
});
