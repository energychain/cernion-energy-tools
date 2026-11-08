'use strict';
// Knowledge Gateway through the real /api authentication with a tenant-bound Open WebUI gateway
// token and a provisioned user mapping (#CernionWebUI B, UAT finding: 403 "Authenticated actor
// and energy role required" on the gateway read side).
const VOCABULARY = ['frist', 'zähler', 'wartung', 'netz'];
jest.mock('../src/llm-client', () => ({
  ...require('./helpers/workbench-llm-stub'),
  embeddings: jest.fn(async (texts) =>
    texts.map((text) =>
      VOCABULARY.map((word) => (String(text).toLowerCase().includes(word) ? 1 : 0))
    )
  ),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const Workbench = require('../services/workbench.service');
const Gateway = require('../services/knowledge-gateway.service');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');

describe('Knowledge Gateway over authenticated HTTP with a gateway token', () => {
  let broker, dir, base, gateway, admin, env;
  async function request(method, route, token, body, headers = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  const asAlice = { 'x-openwebui-user-id': 'alice' };

  beforeAll(async () => {
    env = { ...process.env };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-kg-http-'));
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
    broker.createService({
      ...require('../services/object-store.service'),
      settings: { dbPath: path.join(dir, 'objects') },
    });
    broker.createService(require('../services/files.service'));
    broker.createService({
      ...Gateway,
      settings: { ...Gateway.settings, dbPath: path.join(dir, 'kg') },
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
          org: 'org',
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
        roles: 'ROLE_USER',
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

  test('the mapped Open WebUI user lists, searches and resolves citations; management stays closed', async () => {
    const kb = await request('POST', '/api/workbench/knowledge-bases', admin.token, {
      name: 'Alpha',
      visibility: 'restricted',
      acl: { actorIds: ['cet-alice'] },
      defaultForChat: true,
    });
    expect(kb.status).toBe(200);
    const other = await request('POST', '/api/workbench/knowledge-bases', admin.token, {
      name: 'Beta',
      visibility: 'private',
    });
    const content = Buffer.from(
      '# Frist\n\nDie Frist für den Zählerwechsel beträgt zehn Werktage.'
    ).toString('base64');
    const doc = await request(
      'POST',
      `/api/workbench/knowledge-bases/${kb.body.knowledgeBaseId}/documents`,
      admin.token,
      {
        name: 'alpha.md',
        mimeType: 'text/markdown',
        contentBase64: content,
      }
    );
    expect(doc.status).toBe(200);
    await Promise.all([...broker.getLocalService('knowledge-gateway').ingestJobs.values()]);

    const list = await request(
      'GET',
      '/api/workbench/knowledge-bases',
      gateway.token,
      null,
      asAlice
    );
    expect(list.status).toBe(200);
    expect(list.body.knowledgeBases.map((base) => base.name)).toEqual(['Alpha']);
    const search = await request(
      'POST',
      '/api/workbench/knowledge/search',
      gateway.token,
      { question: 'Welche Frist gilt beim Zählerwechsel?' },
      asAlice
    );
    expect(search.status).toBe(200);
    expect(search.body.results[0]).toMatchObject({
      knowledgeBaseId: kb.body.knowledgeBaseId,
      title: 'alpha.md',
    });
    const citation = await request(
      'GET',
      `/api/workbench/knowledge/citations/${search.body.results[0].citationId}`,
      gateway.token,
      null,
      asAlice
    );
    expect(citation.status).toBe(200);
    const tool = await request(
      'GET',
      '/api/workbench/knowledge/openapi.json',
      gateway.token,
      null,
      asAlice
    );
    expect(tool.body.paths['/api/workbench/knowledge/search'].post.operationId).toBe(
      'cernion_knowledge_search'
    );
    // The private base of another actor stays invisible to the gateway user.
    const foreign = await request(
      'POST',
      '/api/workbench/knowledge/search',
      gateway.token,
      { question: 'Frist', knowledgeBaseIds: [other.body.knowledgeBaseId] },
      asAlice
    );
    expect(foreign.status).toBe(404);
    // Management routes stay closed to the gateway token.
    const create = await request(
      'POST',
      '/api/workbench/knowledge-bases',
      gateway.token,
      { name: 'X' },
      asAlice
    );
    expect([403, 404]).toContain(create.status);
    // A user without mapping is refused.
    const unmapped = await request('GET', '/api/workbench/knowledge-bases', gateway.token, null, {
      'x-openwebui-user-id': 'mallory',
    });
    expect(unmapped.status).toBe(403);
  });

  test('a normal CET token without full-access may search (a read); the ACL decides', async () => {
    const search = await request('POST', '/api/workbench/knowledge/search', admin.token, {
      question: 'Frist Zählerwechsel',
    });
    expect(search.status).toBe(200);
  });
});
