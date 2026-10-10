'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker } = require('./helpers/case-linking-broker');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { generateEdifactFixture } = require('../scripts/generate-edifact-fixtures');
const llm = require('../src/llm-client');

describe('structured messages through authenticated chat and original-file HTTP', () => {
  let app, env, base, gateway;
  async function request(url, body, user = 'synthetic-person') {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.token}`,
        'Content-Type': 'application/json',
        'X-OpenWebUI-User-Id': user,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const chat = (content, fileRefs, user) =>
    request(
      '/v1/chat/completions',
      {
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content }],
        metadata: {
          conversationId: 'synthetic-structured-http',
          openWebuiOrgId: 'synthetic-org',
          openWebuiUserId: user || 'synthetic-person',
          ...(fileRefs ? { fileRefs } : {}),
        },
      },
      user
    );
  beforeAll(async () => {
    env = { ...process.env };
    app = await createCaseBroker();
    Object.assign(process.env, {
      CERNION_SUPPORT_TOKEN: 'synthetic-bootstrap',
      CERNION_SUPPORT_TOKEN_INPUT: 'synthetic-bootstrap',
      CERNION_TENANT_REGISTRY_FILE: app.registry,
      CERNION_USER_REGISTRY_FILE: path.join(app.dir, 'users.json'),
      TOKEN_ROLE_AUDIT_FILE: path.join(app.dir, 'audit.jsonl'),
      RATE_QUOTA_DIR: path.join(app.dir, 'quotas'),
      WORKBENCH_DATASET_DB_PATH: path.join(app.dir, 'rows'),
      DATAPOINT_SCHEDULER_ENABLED: 'false',
      CET_FILE_SIGNING_KEY: 'synthetic-key-814-only',
    });
    fs.writeFileSync(
      app.registry,
      JSON.stringify([{ tenantId: 'public', sharedService: { caseVisibility: 'team' } }])
    );
    for (const [file, settings] of [
      ['datapoint', { dbPath: path.join(app.dir, 'catalog') }],
      ['object-store', { dbPath: path.join(app.dir, 'objects') }],
      ['dataset', {}],
      ['files', {}],
      [
        'token-manager',
        {
          storageFile: path.join(app.dir, 'tokens.json'),
          signalQueueFile: path.join(app.dir, 'signals.json'),
        },
      ],
      ['api', { port: 0 }],
      ['openai-compatible', {}],
    ]) {
      const schema = require(`../services/${file}.service`);
      app.broker.createService({ ...schema, settings: { ...schema.settings, ...settings } });
    }
    app.broker.createService({
      name: 'willi-mako',
      actions: { resolveStructure: () => ({ success: true, data: { sources: [] } }) },
    });
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
          org: 'synthetic-org',
        },
        app.broker
      )
    ).data;
    for (const user of ['synthetic-person', 'synthetic-colleague'])
      await provisionMapping(
        {
          tenant: 'public',
          client: 'open-webui',
          org: 'synthetic-org',
          user,
          actor: user,
          roles: 'ROLE_EDM',
        },
        app.broker
      );
  });
  afterAll(async () => {
    await app.cleanup();
    process.env = env;
  });
  test('original and full-text paths ingest, answer AC questions and never prompt raw segments', async () => {
    const text = generateEdifactFixture({ padding: 6000 });
    const upload = await request('/v1/files', {
      name: 'Synthetic.edi',
      mimeType: 'application/edifact',
      contentBase64: Buffer.from(text).toString('base64'),
    });
    expect(upload.status).toBe(200);
    const original = await chat('Was kannst Du mir zu dieser Nachricht sagen?', [
      upload.body.reference || upload.body,
    ]);
    expect(original.status).toBe(200);
    const overview = original.body.choices[0].message.content;
    expect(overview).toContain('3 Nachrichten');
    expect(overview).toContain('Positionssumme');
    expect(overview).toContain('Negativer Betrag');
    expect(overview.match(/\?/g)).toHaveLength(1);
    const detail = await chat(
      'Schlüssele Rechnung SYN-INV-002 auf',
      undefined,
      'synthetic-colleague'
    );
    expect(detail.status).toBe(200);
    expect(detail.body.choices[0].message.content).toContain('1.227');
    const filtered = await chat('Welche Rechnungen über 1.000 €?');
    const filteredText = filtered.body.choices[0].message.content;
    expect(filteredText).toContain('SYN-INV-001');
    expect(filteredText).not.toContain('SYN-INV-003');
    const fallback = await chat(
      `<context><source name="Synthetic.edi">${text}</source></context><user_query>Was kannst Du mir dazu sagen?</user_query>`
    );
    expect(fallback.status).toBe(200);
    expect(fallback.body.choices[0].message.content).not.toContain('Worum geht');
    for (const args of llm.generateText.mock.calls) {
      const prompt = JSON.stringify(args);
      expect(prompt).not.toMatch(/UNB\+|UNH\+|MOA\+|FTX\+/);
    }
  });
});
