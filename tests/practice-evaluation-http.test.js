'use strict';
jest.mock('../src/llm-client', () => require('./helpers/workbench-llm-stub'));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const OpenAi = require('../services/openai-compatible.service');
const { provisionToken } = require('../scripts/provision-token');
const { instantiatePracticeScenario } = require('../scripts/generate-practice-evaluation-fixtures');
const { createHttpTransport } = require('../scripts/practice-evaluation-transport');

test('real HTTP gateway restrictions, tenant preflight, facade response and own-author cleanup', async () => {
  const fixture = instantiatePracticeScenario('boundaries');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-gateway-suite-'));
  const environment = { ...process.env };
  const tenantId = `test-${fixture.anchor.replace('Prüfbezug', 'anchor-')}`;
  Object.assign(process.env, {
    CERNION_SUPPORT_TOKEN: 'synthetic-local-bootstrap',
    CERNION_SUPPORT_TOKEN_INPUT: 'synthetic-local-bootstrap',
    CERNION_TENANT_REGISTRY_FILE: path.join(directory, 'tenants.json'),
    CERNION_USER_REGISTRY_FILE: path.join(directory, 'users.json'),
    TOKEN_ROLE_AUDIT_FILE: path.join(directory, 'role-audit.jsonl'),
    RATE_QUOTA_DIR: path.join(directory, 'quotas'),
  });
  const broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 10000 });
  broker.createService({
    ...TokenManager,
    settings: {
      ...TokenManager.settings,
      storageFile: path.join(directory, 'tokens.json'),
      signalQueueFile: path.join(directory, 'signals.json'),
    },
  });
  broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
  broker.createService(OpenAi);
  const calls = [];
  const actors = fixture.actors.map((actor) => ({
    ...actor,
    actorId: `practice-${actor.id}`,
    externalUserId: `evaluation-${actor.id}`,
  }));
  const mappings = actors.map((actor) => ({
    client: 'open-webui',
    externalOrgId: tenantId,
    externalUserId: actor.externalUserId,
    cetActorId: actor.actorId,
    cetTenantId: tenantId,
    displayName: actor.name,
    roles: ['ROLE_GRID_OPERATOR', 'ROLE_EDM'],
    enabled: true,
  }));
  broker.createService({
    name: 'workbench',
    actions: {
      'admin.mappings.list': {
        rest: 'GET /admin/mappings',
        handler: () => ({ tenantId, mappings }),
      },
      chat: {
        rest: 'POST /chat',
        handler(ctx) {
          calls.push({ params: ctx.params, auth: ctx.meta.apiToken });
          return {
            responseText: 'Ein Entwurf ist möglich; ein Versand erfolgt hier nicht.',
            metadata: { notices: [] },
          };
        },
      },
    },
  });
  broker.createService({
    name: 'tenant-memory-policy',
    actions: {
      list: {
        rest: 'GET /statements',
        handler: () => ({ statements: [] }),
      },
    },
  });
  try {
    await broker.start();
    const api = broker.getLocalService('api');
    for (const route of api.routes.filter((entry) => entry.opts.autoAliases))
      api.regenerateAutoAliases(route);
    const baseUrl = `http://127.0.0.1:${api.server.address().port}`;
    const issue = async (user, extra = {}) =>
      (
        await provisionToken(
          { tenant: tenantId, user, name: 'Sachbearbeitung A', ...extra },
          broker
        )
      ).data.token;
    const gatewayToken = await issue('evaluation-gateway', {
      gateway: true,
      client: 'open-webui',
      org: tenantId,
    });
    for (const actor of actors)
      actor.cleanupToken = await issue(actor.actorId, {
        roles: 'ROLE_TENANT_ADMIN,ROLE_GRID_OPERATOR,ROLE_EDM',
      });
    const config = {
      baseUrl,
      tenantId,
      orgId: tenantId,
      actors,
      gatewayToken,
      adminToken: actors[0].cleanupToken,
      requestTimeoutMs: 10000,
      remoteTokenReservation: 20000,
    };
    const budget = { reserveExternal: jest.fn(() => () => {}), stopForQuota: jest.fn() };
    const denied = await fetch(`${baseUrl}/api/workbench/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${gatewayToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ userRequest: 'Kein Fall' }),
    });
    expect(denied.status).toBe(403);
    expect(calls).toHaveLength(0);
    const transport = await createHttpTransport({ config, budget });
    const run = await transport.startRun(fixture);
    run.anchor = fixture.anchor;
    const response = await transport.send(run, {
      actor: 'a',
      chat: 'main',
      message: 'Bitte einen Entwurf vorbereiten; nichts versenden.',
    });
    expect(response.responseText).toContain('Entwurf');
    expect(response.metadata.notices).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].auth.type).toBe('gateway');
    const cleaned = await transport.cleanup(run);
    expect(cleaned.every((item) => item.passed)).toBe(true);
    expect(calls[1].params.userRequest).toBe('Kein Fall');
    expect(calls[1].auth.userId).toBe(actors[0].actorId);
    expect(calls[1].auth.type).not.toBe('gateway');
    const before = calls.length;
    const foreign = await issue('evaluation-foreign', {
      gateway: true,
      client: 'open-webui',
      org: 'test-other-org',
    });
    await expect(
      createHttpTransport({ config: { ...config, gatewayToken: foreign }, budget })
    ).rejects.toThrow('verification');
    expect(calls).toHaveLength(before);
    const foreignTenant = await issue('evaluation-other-tenant', {
      tenant: 'test-other-tenant',
      gateway: true,
      client: 'open-webui',
      org: tenantId,
    });
    await expect(
      createHttpTransport({ config: { ...config, gatewayToken: foreignTenant }, budget })
    ).rejects.toThrow('tenant mismatch');
    await expect(
      createHttpTransport({
        config: {
          ...config,
          actors: [{ ...actors[0], cleanupToken: actors[1].cleanupToken }, actors[1]],
        },
        budget,
      })
    ).rejects.toThrow('cleanup token');
    expect(calls).toHaveLength(before);
    mappings[0].externalOrgId = 'test-other-org';
    await expect(createHttpTransport({ config, budget })).rejects.toThrow('mapping');
    mappings[0].externalOrgId = tenantId;
    mappings[0].roles = ['ROLE_GRID_OPERATOR'];
    await expect(createHttpTransport({ config, budget })).rejects.toThrow('mapping');
  } finally {
    await broker.stop();
    for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
    Object.assign(process.env, environment);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
