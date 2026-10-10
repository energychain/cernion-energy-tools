'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { namespace, storeCapability, signDownload } = require('../src/file-channel-policy');
const { syntheticWorkbook } = require('./helpers/file-channel-fixtures');
const { loadDocuments } = require('../src/workbench-document');

describe('authenticated original-file channel HTTP', () => {
  let app, env, base, gateway, foreign, reference;
  async function request(url, method = 'GET', body, token = gateway.token, user = 'person-a') {
    const response = await fetch(base + url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-OpenWebUI-User-Id': user,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      body: response.headers.get('content-type')?.includes('json')
        ? JSON.parse(bytes.toString())
        : null,
    };
  }
  beforeAll(async () => {
    env = { ...process.env };
    app = await createCaseBroker();
    Object.assign(process.env, {
      CET_FILE_SIGNING_KEY: 'synthetic-signing-key-for-tests-790-only',
      CERNION_SUPPORT_TOKEN: 'synthetic-bootstrap',
      CERNION_SUPPORT_TOKEN_INPUT: 'synthetic-bootstrap',
      CERNION_TENANT_REGISTRY_FILE: app.registry,
      CERNION_USER_REGISTRY_FILE: path.join(app.dir, 'users.json'),
      TOKEN_ROLE_AUDIT_FILE: path.join(app.dir, 'audit.jsonl'),
      RATE_QUOTA_DIR: path.join(app.dir, 'quotas'),
    });
    fs.writeFileSync(
      app.registry,
      JSON.stringify([
        { tenantId: 'public', sharedService: { caseVisibility: 'team' } },
        { tenantId: 'foreign' },
      ])
    );
    const Tokens = require('../services/token-manager.service');
    const Api = require('../services/api.service');
    const Store = require('../services/object-store.service');
    app.broker.createService({
      ...Tokens,
      settings: {
        ...Tokens.settings,
        storageFile: path.join(app.dir, 'tokens.json'),
        signalQueueFile: path.join(app.dir, 'signals.json'),
      },
    });
    app.broker.createService({ ...Store, settings: { dbPath: path.join(app.dir, 'objects') } });
    app.broker.createService(require('../services/files.service'));
    app.broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
    app.broker.createService(require('../services/openai-compatible.service'));
    require('../src/llm-client').generateStructured.mockResolvedValue({
      concern: 'Dokument speichern',
      situation: 'Synthetische Prüfung',
      participants: [],
      identifiers: [],
      deadlines: [],
      hypotheses: [],
      missingInformation: [],
      requestedAction: { description: 'speichern', externalEffect: false, draftRequested: false },
      turnKind: 'work',
      retrievalTerms: [],
    });
    require('../src/llm-client').generateText.mockResolvedValue('Dokument gespeichert.');
    await app.broker.start();
    const api = app.broker.getLocalService('api');
    for (const route of api.routes.filter((entry) => entry.opts.autoAliases))
      api.regenerateAutoAliases(route);
    base = `http://127.0.0.1:${api.server.address().port}`;
    gateway = (
      await provisionToken(
        {
          tenant: 'public',
          user: 'svc:synthetic',
          name: 'Synthetic gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org-test',
        },
        app.broker
      )
    ).data;
    foreign = (
      await provisionToken(
        {
          tenant: 'foreign',
          user: 'svc:foreign',
          name: 'Synthetic foreign gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org-foreign',
        },
        app.broker
      )
    ).data;
    for (const [tenant, org, user] of [
      ['public', 'org-test', 'person-a'],
      ['public', 'org-test', 'person-b'],
      ['foreign', 'org-foreign', 'person-a'],
    ])
      await provisionMapping(
        { tenant, client: 'open-webui', org, user, actor: user, roles: 'ROLE_GRID_OPERATOR' },
        app.broker
      );
  });
  afterAll(async () => {
    await app.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });
  test('original XLSX bytes/hash, all sheets/formulas, repeated/concurrent uploads deduplicate', async () => {
    const bytes = syntheticWorkbook();
    const body = { name: 'Synthetic.xlsx', contentBase64: bytes.toString('base64') };
    const first = await request('/v1/files', 'POST', body);
    expect(first.status).toBe(200);
    reference = first.body;
    expect(reference.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    const repeats = await Promise.all([
      request('/v1/files', 'POST', body),
      request('/v1/files', 'POST', body),
    ]);
    expect(repeats.every((result) => result.status === 200 && result.body.duplicate)).toBe(true);
    const meta = auth('person-a', ['ROLE_GRID_OPERATOR'], 'public');
    const parsed = await app.broker.call('files.read', { fileId: reference.fileId }, { meta });
    expect(parsed.text).toContain('Sheet: First');
    expect(parsed.text).toContain('Sheet: Second');
    expect(parsed.text).toContain('"12"');
    expect(parsed.text).toContain('"30"');
    const link = await request(`/v1/files/${reference.fileId}/link`);
    const downloaded = await request(link.body.url);
    expect(downloaded.bytes.equals(bytes)).toBe(true);
    expect(downloaded.headers.get('content-disposition')).toContain('attachment');
  });
  test('chat prefers original over RAG snippets and generated case document returns a seven-day link', async () => {
    const chat = await request('/v1/chat/completions', 'POST', {
      model: GOVERNANCE_MODEL,
      messages: [
        {
          role: 'user',
          content:
            '<context><source name="Synthetic.xlsx">WRONG-SNIPPET</source></context><user_query>Dokument speichern.</user_query>',
        },
      ],
      metadata: { conversationId: 'files-chat', fileRefs: [reference] },
    });
    expect(chat.status).toBe(200);
    const caseId = chat.body.metadata.cetCaseId;
    expect(caseId).toBeTruthy();
    const docs = await loadDocuments(app.workbench.store, { tenantId: 'public', caseId });
    expect(docs[0].text).toContain('Sheet: Second');
    expect(docs[0].text).not.toContain('WRONG-SNIPPET');
    const generated = await request('/v1/chat/completions', 'POST', {
      model: GOVERNANCE_MODEL,
      messages: [{ role: 'user', content: 'Exportiere Fallunterlagen als txt' }],
      metadata: { conversationId: 'files-chat' },
    });
    expect(generated.status).toBe(200);
    const url = generated.body.choices[0].message.content.match(/\]\(([^)]+)\)/)[1];
    const downloaded = await request(url, 'GET', null, gateway.token, 'person-b');
    expect(downloaded.status).toBe(200);
    expect(downloaded.bytes.toString()).toContain('Sheet: Second');
    expect((await request(url, 'GET', null, foreign.token)).status).toBeGreaterThanOrEqual(400);
    const id = url.match(/files\/([a-f0-9]+)/)[1];
    const file = (
      await app.broker.call(
        'object-store.get',
        { namespace: namespace('public'), key: id },
        { meta: { fileStoreCapability: storeCapability } }
      )
    ).payload;
    const expired = signDownload(file, Date.now() - 8 * 86400000);
    expect((await request(`/v1/files/${id}/content?ticket=${expired.ticket}`)).status).toBe(403);
    const audits = await app.broker.call(
      'object-store.query',
      { namespace: namespace('public').replace('files:', 'files_audit:') },
      { meta: { fileStoreCapability: storeCapability } }
    );
    expect(
      audits.docs.some(
        (doc) => doc.payload.operation === 'download' && doc.payload.outcome === 'allowed'
      )
    ).toBe(true);
    expect(audits.docs.some((doc) => doc.payload.outcome === 'denied')).toBe(true);
  });
  test('auth, org, path, MIME, type, size and generic-store bypass fail closed', async () => {
    const valid = {
      name: 'Synthetic.txt',
      contentBase64: Buffer.from('Synthetic only.').toString('base64'),
    };
    expect((await request('/v1/files', 'POST', valid, '')).status).toBe(401);
    expect((await request('/v1/files', 'POST', valid, gateway.token, 'unmapped')).status).toBe(403);
    expect((await request('/v1/files', 'POST', { ...valid, openWebuiOrgId: 'wrong' })).status).toBe(
      403
    );
    for (const name of ['../escape.txt', 'test.exe', 'a\\b.txt', 'evil\n.txt'])
      expect((await request('/v1/files', 'POST', { ...valid, name })).status).toBe(422);
    expect((await request('/v1/files', 'POST', { ...valid, mimeType: 'text/html' })).status).toBe(
      422
    );
    process.env.CET_FILE_MAX_BYTES = '2';
    expect((await request('/v1/files', 'POST', valid)).status).toBe(413);
    delete process.env.CET_FILE_MAX_BYTES;
    await expect(
      app.broker.call(
        'object-store.get',
        { namespace: namespace('public'), key: reference.fileId },
        { meta: auth() }
      )
    ).rejects.toMatchObject({ code: 403 });
    expect((await request('/api/workbench/cases', 'GET')).status).toBe(403);
  });
  test('deletion revokes links, removes evidence and original bytes', async () => {
    const link = await request(`/v1/files/${reference.fileId}/link`);
    expect((await request(`/v1/files/${reference.fileId}`, 'DELETE')).status).toBe(200);
    expect((await request(link.body.url)).status).toBeGreaterThanOrEqual(400);
    await expect(
      app.broker.call(
        'object-store.get',
        { namespace: namespace('public'), key: reference.fileId },
        { meta: { fileStoreCapability: storeCapability } }
      )
    ).rejects.toMatchObject({ code: 404 });
  });
});
