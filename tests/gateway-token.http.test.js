'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const Workbench = require('../services/workbench.service');
const OpenAi = require('../services/openai-compatible.service');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const { rolesFromToken, validateRoles } = require('../src/auth/token-policy');

describe('Gateway identity over authenticated HTTP (#736)', () => {
  let broker, dir, base, gateway, admin;
  let env;
  let mappedCalls;
  const complete = (metadata = {}) => ({
    model: 'cernion-governance-assistant',
    messages: [{ role: 'user', content: 'What does APERAK Z18 mean?' }],
    metadata: { conversationId: 'chat', openWebuiOrgId: 'org', ...metadata },
  });
  async function request(route, token, body, headers = {}) {
    const response = await fetch(`${base}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    env = { ...process.env };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-gateway-http-'));
    Object.assign(process.env, {
      CERNION_SUPPORT_TOKEN: 'test-local-bootstrap',
      CERNION_SUPPORT_TOKEN_INPUT: 'test-local-bootstrap',
      CERNION_TENANT_REGISTRY_FILE: path.join(dir, 'tenants.json'),
      CERNION_USER_REGISTRY_FILE: path.join(dir, 'users.json'),
      TOKEN_ROLE_AUDIT_FILE: path.join(dir, 'role-audit.jsonl'),
      RATE_QUOTA_DIR: path.join(dir, 'quotas'),
    });
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...TokenManager,
      settings: {
        ...TokenManager.settings,
        storageFile: path.join(dir, 'tokens.json'),
        signalQueueFile: path.join(dir, 'signals.json'),
      },
    });
    broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
    const settings = {};
    for (const key of [
      'dbPath',
      'identityDbPath',
      'deliveryDbPath',
      'evidenceDbPath',
      'turnMemoryDbPath',
      'contextDbPath',
      'playbookDbPath',
      'inboxDbPath',
      'toolRunDbPath',
      'mailAccountDbPath',
    ])
      settings[key] = path.join(dir, key);
    broker.createService({ ...Workbench, settings });
    broker.createService(OpenAi);
    mappedCalls = [];
    broker.createService({
      name: 'personal-agent',
      actions: {
        chat: (ctx) => {
          mappedCalls.push(structuredClone(ctx.meta));
          return { reply: 'Read-only answer' };
        },
      },
    });
    await broker.start();
    const api = broker.getLocalService('api');
    for (const route of api.routes.filter((entry) => entry.opts.autoAliases))
      api.regenerateAutoAliases(route);
    base = `http://127.0.0.1:${api.server.address().port}`;
    gateway = (
      await provisionToken(
        {
          tenant: 'public',
          user: 'svc:owui',
          name: 'Gateway',
          gateway: true,
          client: 'open-webui',
        },
        broker
      )
    ).data;
    admin = (
      await provisionToken(
        { tenant: 'public', user: 'admin', name: 'Admin', roles: 'ROLE_USER,ROLE_TENANT_ADMIN' },
        broker
      )
    ).data;
    await provisionMapping(
      {
        tenant: 'public',
        client: 'open-webui',
        org: 'org',
        user: 'alice',
        actor: 'cet-alice',
        roles: 'ROLE_EDM',
        clearance: 'tenant_internal',
      },
      broker
    );
  });
  afterAll(async () => {
    await broker?.stop();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('gateway stores neither personal roles nor scope privileges', () => {
    const stored = broker
      .getLocalService('token-manager')
      .loadTokens()
      .find((entry) => entry.id === gateway.id);
    expect(stored).toMatchObject({
      type: 'gateway',
      client: 'open-webui',
      tenantId: 'public',
      scopes: [],
    });
    expect(stored).not.toHaveProperty('roles');
    expect(rolesFromToken(stored)).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain(gateway.token);
  });
  test('headers delegate mapped actor, roles, clearance, with a content-free durable audit', async () => {
    const response = await request('/v1/chat/completions', gateway.token, complete(), {
      'X-OpenWebUI-User-Id': 'alice',
      'X-OpenWebUI-Chat-Id': 'header-chat',
      'X-OpenWebUI-User-Role': 'admin',
    });
    expect(response.status).toBe(200);
    expect(mappedCalls.at(-1).authUser).toMatchObject({
      userId: 'cet-alice',
      roles: ['ROLE_EDM'],
      sensitivityFlags: ['tenant_internal'],
    });
    expect(mappedCalls.at(-1).apiToken.scopes).toEqual([]);
    const audits = (
      await broker.getLocalService('workbench').identityDb.allDocs({ include_docs: true })
    ).rows
      .map((row) => row.doc)
      .filter((doc) => doc.type === 'workbench_gateway_delegation');
    expect(audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tokenId: gateway.id,
          client: 'open-webui',
          externalUserId: 'alice',
          cetActorId: 'cet-alice',
        }),
      ])
    );
    expect(JSON.stringify(audits)).not.toMatch(/APERAK|messages|content|Read-only/);
  });
  test('metadata identity takes precedence over a valid forwarded header', async () => {
    const response = await request(
      '/v1/chat/completions',
      gateway.token,
      complete({ openWebuiUserId: 'missing' }),
      { 'X-OpenWebUI-User-Id': 'alice' }
    );
    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/Nutzer.*Zugang eingerichtet/);
  });
  test('normal token ignores identity metadata and forwarded headers', async () => {
    const response = await request(
      '/v1/chat/completions',
      admin.token,
      complete({ openWebuiUserId: 'missing' }),
      { 'X-OpenWebUI-User-Id': 'alice', 'X-OpenWebUI-Chat-Id': 'ignored' }
    );
    expect(response.status).toBe(200);
    expect(mappedCalls.at(-1).authUser).toMatchObject({
      userId: 'admin',
      roles: expect.arrayContaining(['ROLE_USER', 'ROLE_TENANT_ADMIN']),
    });
    expect(mappedCalls.at(-1)).not.toHaveProperty('workbenchMappedActor');
  });
  test.each([
    '/api/workbench/admin/tenant-mappings',
    '/api/workbench/chat',
    '/api/domain-router/classify',
    '/api/chatgpt-sidecar/sessions',
    '/api/mcp',
    '/v1/embeddings',
    '/v1/images/generations',
    '/api/tokens',
  ])('gateway cannot enter %s', async (route) => {
    expect((await request(route, gateway.token, {})).status).toBe(403);
  });
  test('gateway cannot enter model discovery or the agent model', async () => {
    expect((await request('/v1/models', gateway.token)).status).toBe(403);
    expect(
      (
        await request('/v1/chat/completions', gateway.token, {
          ...complete({ openWebuiUserId: 'alice' }),
          model: 'cernion-agent-mvp',
        })
      ).status
    ).toBe(403);
  });
  test('missing, disabled and foreign-tenant mappings fail closed', async () => {
    expect((await request('/v1/chat/completions', gateway.token, complete())).status).toBe(403);
    expect(
      (
        await request(
          '/v1/chat/completions',
          gateway.token,
          complete({ openWebuiUserId: 'alice', openWebuiOrgId: 'unknown' })
        )
      ).status
    ).toBe(403);
    const other = (
      await provisionToken(
        {
          tenant: 'other-736',
          user: 'svc:owui',
          name: 'Other',
          gateway: true,
          client: 'open-webui',
        },
        broker
      )
    ).data;
    expect(
      (await request('/v1/chat/completions', other.token, complete({ openWebuiUserId: 'alice' })))
        .status
    ).toBe(403);
    await provisionMapping(
      { tenant: 'public', org: 'org', user: 'disabled', actor: 'cet-disabled', roles: 'ROLE_USER' },
      broker
    );
    const store = broker.getLocalService('workbench').store;
    const mapping = await store.getUserMapping({
      client: 'open-webui',
      externalOrgId: 'org',
      externalUserId: 'disabled',
    });
    await store.saveUserMapping({ ...mapping, enabled: false });
    expect(
      (
        await request(
          '/v1/chat/completions',
          gateway.token,
          complete({ openWebuiUserId: 'disabled' })
        )
      ).status
    ).toBe(403);
  });
  test('bootstrap lists tenant/client mappings and shares admin validation', async () => {
    const listed = await provisionMapping(
      { tenant: 'public', client: 'open-webui', list: true },
      broker
    );
    expect(listed.mappings.some((row) => row.cetActorId === 'cet-alice')).toBe(true);
    await expect(
      provisionMapping(
        { tenant: 'public', org: 'org', user: 'invalid', actor: 'invalid', roles: 'ROLE_UNKNOWN' },
        broker
      )
    ).rejects.toMatchObject({ code: 422 });
    await expect(
      provisionMapping(
        { tenant: 'public', org: 'org', user: 'invalid', actor: 'invalid', roles: 'ROLE_ADMIN' },
        broker
      )
    ).rejects.toMatchObject({ code: 422 });
    await expect(
      provisionMapping(
        {
          tenant: 'public',
          org: 'org',
          user: 'invalid',
          actor: 'invalid',
          roles: 'ROLE_USER',
          clearance: 'invalid',
        },
        broker
      )
    ).rejects.toMatchObject({ code: 422 });
    expect(
      (
        await request('/api/workbench/admin/user-mappings', admin.token, {
          client: 'open-webui',
          externalOrgId: 'org',
          externalUserId: 'invalid',
          cetActorId: 'invalid',
          roles: ['ROLE_UNKNOWN'],
        })
      ).status
    ).toBe(422);
  });
  test('normal tokens cannot delegate on direct Workbench query or use HTTP CLI provisioning', async () => {
    const verified = await broker.call('token-manager.verify', { token: admin.token });
    const meta = {
      apiToken: verified,
      authUser: {
        authType: 'legacy-token',
        tenantId: verified.tenantId,
        userId: verified.userId,
        roles: rolesFromToken(verified),
      },
    };
    await broker.call(
      'workbench.query',
      {
        intentMode: 'knowledge_query',
        message: 'What does APERAK Z18 mean?',
        conversationId: 'direct',
        openWebuiOrgId: 'org',
        openWebuiUserId: 'alice',
      },
      { meta }
    );
    expect(mappedCalls.at(-1).authUser.userId).toBe('admin');
    expect(mappedCalls.at(-1)).not.toHaveProperty('workbenchMappedActor');
    expect(
      (
        await request('/api/token-manager/createCli', admin.token, {
          name: 'Escalation',
          tenantId: 'public',
          userId: 'admin',
          roles: ['ROLE_ADMIN'],
          support: true,
        })
      ).status
    ).toBe(403);
  });
  test('audit write failure stops delegation before a personal operation executes', async () => {
    const count = mappedCalls.length;
    const db = broker.getLocalService('workbench').identityDb;
    const spy = jest.spyOn(db, 'put').mockRejectedValueOnce(new Error('audit unavailable'));
    try {
      expect(
        (
          await request(
            '/v1/chat/completions',
            gateway.token,
            complete({ openWebuiUserId: 'alice' })
          )
        ).status
      ).toBe(500);
      expect(mappedCalls).toHaveLength(count);
    } finally {
      spy.mockRestore();
    }
  });
  test('roles are allowlisted, privileged issuance requires support and is audited', async () => {
    expect(() => validateRoles(['ROLE_UNKNOWN'])).toThrow();
    for (const roles of [['ROLE_ADMIN'], ['ROLE_UTILITY_HQ']]) {
      await expect(
        broker.call('token-manager.createCli', {
          tenantId: 'public',
          userId: 'admin',
          name: 'Invalid',
          roles,
        })
      ).rejects.toMatchObject({ code: 422 });
    }
    const created = await provisionToken(
      {
        tenant: 'public',
        user: 'support',
        name: 'Support',
        roles: 'ROLE_ADMIN,ROLE_UTILITY_HQ',
        support: true,
      },
      broker
    );
    const audit = JSON.parse(fs.readFileSync(path.join(dir, 'role-audit.jsonl'), 'utf8').trim());
    expect(audit).toMatchObject({
      tokenId: created.data.id,
      roles: ['ROLE_ADMIN', 'ROLE_UTILITY_HQ'],
    });
    expect(JSON.stringify(audit)).not.toContain(created.data.token);
    await expect(
      provisionToken(
        {
          tenant: 'public',
          user: 'invalid',
          name: 'Invalid',
          gateway: true,
          client: 'open-webui',
          roles: 'ROLE_USER',
        },
        broker
      )
    ).rejects.toMatchObject({ code: 422 });
    expect(
      (
        await request('/api/tokens', admin.token, {
          name: 'Escalation',
          tenantId: 'public',
          userId: 'admin',
          roles: ['ROLE_ADMIN'],
          support: true,
        })
      ).status
    ).toBe(403);
  });
});

test('chat header fallback and explicit metadata precedence use the configured gateway client', async () => {
  const call = jest.fn().mockResolvedValue({ responseText: 'Answer' });
  const handler = OpenAi.actions.chatCompletions.handler;
  const params = {
    model: 'cernion-governance-assistant',
    messages: [{ role: 'user', content: 'What does APERAK Z18 mean?' }],
    metadata: {
      openWebuiOrgId: 'org',
      openWebuiUserId: 'metadata-person',
      openWebuiConversationId: 'metadata-chat',
    },
  };
  const meta = {
    apiToken: { type: 'gateway', client: 'open-webui', tenantId: 'public' },
    requestHeaders: {
      'x-openwebui-user-id': 'header-person',
      'x-openwebui-chat-id': 'header-chat',
    },
  };
  await handler({ params, meta, call });
  expect(call.mock.calls[0][1]).toMatchObject({
    openWebuiUserId: 'metadata-person',
    openWebuiConversationId: 'metadata-chat',
  });
  call.mockClear();
  await handler({ params: { ...params, metadata: { openWebuiOrgId: 'org' } }, meta, call });
  expect(call.mock.calls[0][1]).toMatchObject({
    openWebuiUserId: 'header-person',
    openWebuiConversationId: 'header-chat',
  });
  await expect(
    handler({ params: { ...params, metadata: { ...params.metadata, client: 'api' } }, meta, call })
  ).rejects.toMatchObject({ code: 403 });
});
