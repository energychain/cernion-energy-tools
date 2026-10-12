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
        Connection: 'close',
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
  test('846 HTTP scenarios 1–6: mail/protocol stay textual; only an explicit reference selects the foreign invoice', async () => {
    const fixture = require('./fixtures/workbench-846.generated.json');
    const stub = require('./helpers/workbench-llm-stub');
    const minutes = fs.readFileSync(
      path.join(__dirname, 'fixtures/document-review/neutral-minutes.txt'),
      'utf8'
    );
    const claim = (text) => ({
      text,
      origin: 'model',
      supported: 'model',
      specific: false,
      completedAction: false,
      evidenceIds: [],
    });
    llm.generateStructured.mockImplementation(async (schema, raw) => {
      const input = JSON.parse(raw);
      if (input.datasets) return { datasetIds: [] };
      if (input.sections)
        return {
          answer: 'Die Netzanmeldung ist offen; die Freigabe steht aus. Klärung bis 09.10.2026.',
        };
      if (!input.catalog) return null;
      const understood = await stub.generateStructured(schema, raw);
      understood.missingInformation = [];
      understood.requestedAction.draftRequested = false;
      return understood;
    });
    llm.generateText.mockImplementation(async (raw) => {
      const input = JSON.parse(raw);
      const draft = input.message === fixture.draftQuestion;
      return JSON.stringify({
        interpretation: draft
          ? []
          : [
              claim(
                'Die fachliche Antwort auf die Netzanmeldung steht aus; der Empfang der APERAK reicht nicht.'
              ),
            ],
        expectation: [],
        nextSteps: [],
        assumptions: [],
        draft: draft
          ? [
              claim(
                'Betreff: Netzanmeldung vom 21.09.2026\nGuten Tag,\nbitte klären Sie die ausstehende fachliche Antwort zur Netzanmeldung.\nMit freundlichen Grüßen'
              ),
            ]
          : [],
      });
    });
    const send = (message, conversationId) =>
      request('/v1/chat/completions', {
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content: message }],
        metadata: {
          conversationId,
          openWebuiOrgId: 'synthetic-org',
          openWebuiUserId: 'synthetic-person',
        },
      });
    const first = await send(fixture.mail, 'synthetic-846-mail-http');
    expect(first.status).toBe(200);
    expect(first.body.choices[0].message.content).toContain('Netzanmeldung');
    const draft = await send(fixture.draftQuestion, 'synthetic-846-mail-http');
    expect(draft.status).toBe(200);
    expect(draft.body.choices[0].message.content).toContain('Netzanmeldung vom 21.09.2026');
    const protocol = await send(
      `<context><source name="synthetic-minutes.txt">${minutes}</source></context><user_query>Fass mir das Protokoll kurz zusammen.</user_query>`,
      'synthetic-846-minutes-http'
    );
    expect(protocol.status).toBe(200);
    expect(protocol.body.choices[0].message.content).toContain('Freigabe steht aus');
    expect(protocol.body.choices[0].message.content).not.toMatch(
      /Zeitintervalle|Zeitumstellungen|Freigabe bestätigt/
    );
    const thread = await send(fixture.thread, 'synthetic-846-thread-http');
    expect(thread.status).toBe(200);
    expect(thread.body.choices[0].message.content).not.toMatch(/INVOIC|SYN-INV-00/);
    const detail = await send(fixture.explicitQuestion, 'synthetic-846-explicit-http');
    expect(detail.status).toBe(200);
    expect(detail.body.choices[0].message.content).toContain('SYN-INV-002');
    expect(detail.body.choices[0].message.content).toContain('MOA 203');
    expect(detail.body.choices[0].message.content).not.toContain('SYN-INV-001');
  });
});
