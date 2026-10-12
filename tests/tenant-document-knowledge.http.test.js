'use strict';

jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
  generateStructured: jest.fn(),
  generateText: jest.fn(),
}));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker } = require('./helpers/case-linking-broker');
const Objects = require('../services/object-store.service');
const Knowledge = require('../services/knowledge-rag.service');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const OpenAI = require('../services/openai-compatible.service');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const llm = require('../src/llm-client');
const {
  generateDocument,
  generateThread,
} = require('../scripts/generate-tenant-document-fixtures');

describe('document knowledge through authenticated Open WebUI HTTP (#789)', () => {
  let app, env, base, gateway;
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
    });
    require('../src/rate-quota-store').resetForTests();
    fs.writeFileSync(app.registry, JSON.stringify([{ tenantId: 'public' }]));
    app.broker.createService({ ...Objects, settings: { dbPath: path.join(app.dir, 'objects') } });
    app.broker.createService(Knowledge);
    app.broker.createService({
      ...TokenManager,
      settings: {
        ...TokenManager.settings,
        storageFile: path.join(app.dir, 'tokens.json'),
        signalQueueFile: path.join(app.dir, 'signals.json'),
      },
    });
    app.broker.createService({ ...Api, settings: { ...Api.settings, port: 0 } });
    app.broker.createService(OpenAI);
    app.broker.createService({
      name: 'personal-agent',
      actions: { collectWorkbenchEvidence: () => ({ evidence: [], trace: [] }) },
    });
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const input = JSON.parse(prompt);
      if (input.document)
        return {
          assertions: [],
          correction: { kind: 'none', basis: '', factId: '' },
          query: { requested: false, anchor: '', functionLabel: '' },
        };
      const command = input.message.startsWith('Entferne')
        ? 'delete'
        : input.message.startsWith('Welche Unterlagen')
          ? 'list'
          : input.message.startsWith('Lies Version')
            ? 'read'
            : 'none';
      return {
        concern: input.message,
        situation: input.message,
        participants: [],
        identifiers: [],
        deadlines: [],
        hypotheses: [],
        missingInformation: [],
        requestedAction: {
          description: input.message,
          externalEffect: false,
          draftRequested: false,
        },
        turnKind: input.message.includes('Richtwert') ? 'knowledge' : 'work',
        retrievalTerms: ['Delta'],
        conversationShape:
          input.message.includes('Kenntnis') || input.message.startsWith('Von:')
            ? 'filing'
            : 'knowledge',
        documentKnowledge: {
          action: command,
          query: command === 'none' ? '' : 'Beschluss Delta',
          id: '',
          version: command === 'read' ? 1 : 0,
        },
      };
    });
    llm.generateText.mockImplementation(async (prompt) => {
      const input = JSON.parse(prompt);
      const hit = input.evidence?.find((row) => row.value.includes('Einheiten'));
      return JSON.stringify({
        expectation: [],
        nextSteps: [],
        interpretation: [
          {
            text: hit ? hit.value : 'Dazu liegt kein sichtbarer Beleg vor.',
            supported: hit ? 'evidence' : 'model',
            specific: false,
            completedAction: false,
            evidenceIds: hit ? [hit.evidenceId] : [],
          },
        ],
      });
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
          user: 'svc:documents',
          name: 'Synthetic file gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org-test',
        },
        app.broker
      )
    ).data;
    for (const id of ['alice', 'bob'])
      await provisionMapping(
        {
          tenant: 'public',
          client: 'open-webui',
          org: 'org-test',
          user: id,
          actor: `cet-${id}`,
          roles: 'ROLE_GRID_OPERATOR',
        },
        app.broker
      );
  });
  afterAll(async () => {
    await app.cleanup();
    process.env = env;
  });
  async function chat(actor, conversationId, text) {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content: text }],
        metadata: { conversationId, openWebuiOrgId: 'org-test', openWebuiUserId: actor },
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    return body.choices[0].message.content;
  }
  const upload = (document, question = 'Zur Kenntnis') =>
    `<context><source id="synthetic" name="${document.name}">${document.text}</source></context><user_query>${question}</user_query>`;

  test('AC-01/03/04/05/06: two people, fresh chats, filing, repeat upload, version access and audited deletion', async () => {
    const first = await chat('alice', 'doc-a', upload(generateDocument()));
    expect(first).toContain('Abgelegt:');
    expect(first).not.toContain('Als Nächstes');
    const responseCalls = llm.generateText.mock.calls.length;
    const duplicate = await chat('alice', 'doc-a', upload(generateDocument()));
    expect(duplicate).not.toContain('Abgelegt:');
    expect(llm.generateText.mock.calls.length).toBe(responseCalls);
    const answer = await chat('bob', 'doc-b', 'Wie hoch ist der Richtwert im Bezirk Delta?');
    expect(answer).toContain('47 Einheiten');
    expect(answer).toContain('Beschluss Delta');
    expect(answer).toContain('cet-alice');
    expect(answer).toContain('Kapitel 2');
    await chat('alice', 'doc-c', upload(generateDocument(2)));
    expect(await chat('bob', 'doc-d', 'Wie hoch ist der Richtwert im Bezirk Delta?')).toContain(
      '53 Einheiten'
    );
    expect(await chat('bob', 'doc-e', 'Lies Version 1 von Beschluss Delta')).toContain(
      '47 Einheiten'
    );
    const removed = await chat('alice', 'doc-f', 'Entferne bitte Beschluss Delta');
    expect(removed).toContain('entfernt');
    expect(await chat('bob', 'doc-g', 'Welche Unterlagen haben wir zu Beschluss Delta?')).toContain(
      'keine sichtbaren'
    );
  });

  test('AC-03: generated pasted thread without question gets a short receipt and no advice', async () => {
    const answer = await chat('alice', 'thread-a', generateThread().text);
    expect(answer).toContain('Abgelegt:');
    expect(answer).not.toMatch(/Entwurf|Als Nächstes|Schritte/);
  });
});
