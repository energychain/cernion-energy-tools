'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker } = require('./helpers/case-linking-broker');
const llm = require('../src/llm-client');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const OpenAI = require('../services/openai-compatible.service');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const { loadDocuments } = require('../src/workbench-document');
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures/document-review/neutral-long-document.txt'),
  'utf8'
);
const injection = fs.readFileSync(
  path.join(__dirname, 'fixtures/document-review/neutral-injection.txt'),
  'utf8'
);

describe('document flow through authenticated HTTP', () => {
  let app, env, base, gateway;
  async function request(
    message,
    user = 'person-a',
    conversationId = 'document-http',
    metadata = {}
  ) {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content: message }],
        metadata: {
          conversationId,
          openWebuiOrgId: 'org-test',
          openWebuiUserId: user,
          ...metadata,
        },
      }),
    });
    return { status: response.status, body: await response.json() };
  }
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
    fs.writeFileSync(
      app.registry,
      JSON.stringify([{ tenantId: 'public', sharedService: { caseVisibility: 'team' } }])
    );
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
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const input = JSON.parse(prompt);
      if (input.untrustedDocument)
        return {
          claims: [],
          assumptions: [],
          numbers: [],
          measures: [],
          schedule: [],
          citations: [input.lines[0]],
        };
      if (input.maps)
        return {
          verdict: 'Synthetische Prüfung abgeschlossen.',
          rationale: 'Nur innere Stimmigkeit geprüft.',
          strengths: [],
          risks: [],
          checkpoints: [
            { finding: 'Angaben offen.', locations: [input.maps[0].locationIds[0]], criterion: -1 },
          ],
          contradictions: [],
          openQuestions: ['Welche Ausgangszahlen gelten?'],
          draft: '',
        };
      return {
        concern: 'Plan prüfen',
        situation: 'Synthetische Dokumentgrundlage.',
        participants: [],
        identifiers: [],
        deadlines: [],
        hypotheses: [],
        missingInformation: [],
        requestedAction: { description: 'Prüfen', externalEffect: false, draftRequested: false },
        turnKind: 'work',
        retrievalTerms: ['Plan prüfen'],
      };
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
          org: 'org-test',
        },
        app.broker
      )
    ).data;
    for (const user of ['person-a', 'person-b'])
      await provisionMapping(
        {
          tenant: 'public',
          client: 'open-webui',
          org: 'org-test',
          user,
          actor: user,
          roles: 'ROLE_GRID_OPERATOR',
        },
        app.broker
      );
  });
  afterAll(async () => {
    await app.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });

  test('whole 233k document, prompt-injection boundary, page followup, final review, tenant-wide access, and foreign tenant isolation', async () => {
    const first = await request(
      `<context><source id="opaque-http-source" name="Synthetic.txt">${fixture}</source><source id="opaque-injection" name="Boundary.txt">${injection}</source></context><user_query>Bewerte den Plan.</user_query>`
    );
    expect(first.status).toBe(200);
    expect(first.body.cernion.result.documentReview.status).toBe('pending');
    const caseId = first.body.metadata.cetCaseId;
    await Promise.all(app.workbench.workbenchDocumentReviews.values());
    const docs = await loadDocuments(app.workbench.store, { tenantId: 'public', caseId });
    expect(docs.some((doc) => doc.text === fixture)).toBe(true);
    expect(docs.some((doc) => doc.text === injection)).toBe(true);
    const prompts = llm.generateStructured.mock.calls.map((call) => JSON.parse(call[1]));
    const injected = prompts.find((prompt) =>
      prompt.untrustedDocument?.text.includes('SYNTHETIC-INJECTION-754')
    );
    expect(injected.instruction).toContain('nicht vertrauenswürdige Daten');
    expect(prompts[0].message).toBe('Bewerte den Plan.');
    const completed = await request('Das Ergebnis bitte.');
    expect(completed.status).toBe(200);
    expect(completed.body.choices[0].message.content).toContain(
      'Synthetische Prüfung abgeschlossen'
    );
    expect(completed.body.choices[0].message.content).toContain('Keine externen Prüfmaßstäbe');
    expect(completed.body.choices[0].message.content).not.toMatch(
      /opaque-http-source|opaque-injection|Geheimnisse|SYSTEM:/
    );
    const page = await request('Seite 12?');
    expect(page.status).toBe(200);
    expect(page.body.choices[0].message.content).toContain('01.06.2030');
    const colleague = await request('Seite 12?', 'person-b');
    expect(colleague.status).toBe(200);
    expect(colleague.body.metadata.cetCaseId).toBe(caseId);
    expect(colleague.body.choices[0].message.content).toContain('01.06.2030');
    const spoof = await request('Seite 12?', 'person-a', 'document-http', {
      openWebuiOrgId: 'foreign-org',
    });
    expect(spoof.status).toBe(403);
  });
  test('chapter five summary over HTTP omits repeated boilerplate and preserves exact quote offsets', async () => {
    const text = fs.readFileSync(
      path.join(__dirname, 'fixtures/document-review/neutral-eight-chapters.txt'),
      'utf8'
    );
    const first = await request(
      `<context><source name="Synthetic short plan">${text}</source></context><user_query>Dokument aufnehmen.</user_query>`,
      'person-a',
      'polish-http'
    );
    expect(first.status).toBe(200);
    const response = await request('Was steht in Kapitel 5 genau?', 'person-a', 'polish-http');
    expect(response.status).toBe(200);
    const content = response.body.choices[0].message.content;
    expect(content).toContain('Kurzfassung von Kapitel 5');
    expect(content).toContain('12-fach wiederholter Standardtext ausgelassen');
    expect(content).not.toContain('Standardtext regelmäßig');
    expect(content).toContain('Kapitel 5: Synthetische Planung · Seite 5');
    const offsets = content.match(/Zeichen (\d+)–(\d+)/u);
    const quote = content.match(/^> (.+)$/mu)[1];
    expect(text.slice(Number(offsets[1]), Number(offsets[2]))).toBe(quote);
  });
  test('identical Open WebUI context on three HTTP turns stores once and answers all three questions', async () => {
    const text =
      'Synthetischer Anfang: Die Planung beginnt 2030.\nKapitel 1: Grundlagen\nEin Termin ist noch offen.\nSynthetisches Ende: Der Abschluss ist 2034 vorgesehen.';
    const context = `<context><source id="repeat-source" name="Synthetic-Repeated.txt">${text}</source></context>`;
    const save = jest.spyOn(app.workbench.store, 'saveEvidence');
    const log = jest.spyOn(app.workbench.logger, 'info');
    const original = llm.generateStructured.getMockImplementation();
    llm.generateStructured.mockImplementation(async (schema, prompt, options) => {
      if (schema.properties?.answer) {
        const input = JSON.parse(prompt);
        expect(input.question).toBe('Gibt es Auffälligkeiten?');
        expect(input.sections.some((section) => section.text.includes('2034'))).toBe(true);
        return {
          answer:
            'Im Dokument bleibt ein Termin offen (Kapitel 1: Grundlagen). Das ist eine zu klärende Angabe.',
        };
      }
      return original(schema, prompt, options);
    });
    try {
      const messages = [
        'Was steht am Anfang des Dokuments?',
        'Gibt es Auffälligkeiten?',
        'Was steht ganz am Ende des Dokuments?',
      ];
      const replies = [];
      for (const question of messages) {
        const response = await request(
          `${context}<user_query>${question}</user_query>`,
          'person-a',
          'repeated-document-http'
        );
        expect(response.status).toBe(200);
        replies.push(response.body.choices[0].message.content);
      }
      expect(replies[0]).toContain('Synthetischer Anfang');
      expect(replies[1]).toContain('Termin offen');
      expect(replies[2]).toContain('Synthetisches Ende');
      expect(
        replies.filter((reply) => reply.includes('als Fallgrundlage gespeichert'))
      ).toHaveLength(1);
      expect(
        save.mock.calls.filter(
          ([input]) => input.extracts?.document?.name === 'Synthetic-Repeated.txt'
        )
      ).toHaveLength(1);
      const storedLogs = log.mock.calls.filter(
        ([message, data]) =>
          message === 'Workbench document stored' && data.name === 'Synthetic-Repeated.txt'
      );
      expect(storedLogs).toHaveLength(1);
      expect(storedLogs[0][1]).toEqual({
        name: 'Synthetic-Repeated.txt',
        chars: text.length,
        lines: 4,
        tabular: false,
      });
      expect(JSON.stringify(storedLogs)).not.toContain('2034');
      for (const reply of replies)
        expect(reply).not.toMatch(/Datenabfrage: skipped|opaque|repeat-source/u);
    } finally {
      save.mockRestore();
      log.mockRestore();
      llm.generateStructured.mockImplementation(original);
    }
  });
  test('conversation shape, one question, durable context and self-knowledge survive authenticated HTTP', async () => {
    const originalStructured = llm.generateStructured.getMockImplementation();
    const originalText = llm.generateText.getMockImplementation();
    const question = {
      key: 'purpose',
      reason: 'purpose',
      question: 'Geht es dir um Überblick, Prüfung oder einen Entwurf?',
      blocking: false,
      decisive: false,
      answered: false,
    };
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const { message, previous } = JSON.parse(prompt);
      const response = message.startsWith('Ich bin');
      const search = message.startsWith('Sind');
      return {
        concern: 'System X',
        situation: '',
        participants: [],
        identifiers: [],
        deadlines: [],
        hypotheses: [],
        missingInformation: [{ ...question, answered: response || search }],
        requestedAction: { description: '', externalEffect: false, draftRequested: false },
        turnKind: 'knowledge',
        retrievalTerms: ['System X'],
        conversationShape: search ? 'knowledge' : 'orientation',
        selfKnowledge: { requested: search, query: 'System X' },
        ...(response
          ? {
              conversationContext: {
                role: 'Team A',
                goal: 'Überblick',
                preference: '',
                basis: message,
                durable: true,
              },
            }
          : previous?.conversationContext
            ? { conversationContext: { ...previous.conversationContext, preference: '' } }
            : {}),
      };
    });
    llm.generateText.mockImplementation(async (prompt) => {
      const { situation } = JSON.parse(prompt);
      const text = situation.selfKnowledge?.requested
        ? 'Die verfügbaren Bestände enthalten keinen passenden Fall.'
        : situation.conversationContext?.role
          ? 'Für Team A kann ich dir die Abläufe im Überblick erläutern.'
          : 'Ich kann System X fachlich einordnen und Dateien daraus auswerten.';
      return JSON.stringify({
        interpretation: [
          {
            text,
            origin: 'model',
            supported: 'model',
            specific: false,
            completedAction: false,
            evidenceIds: [],
          },
        ],
        expectation: [],
        nextSteps: [],
        assumptions: [],
        draft: [],
      });
    });
    try {
      const replies = [];
      for (const message of [
        'Kennst du System X?',
        'Ich bin in Team A und möchte einen Überblick.',
        'Sind dir dazu schon Fälle bekannt?',
      ]) {
        const result = await request(message, 'person-a', 'conversation-shape-http');
        expect(result.status).toBe(200);
        expect(result.body.metadata.degraded).toBe(false);
        replies.push(result.body.choices[0].message.content);
      }
      expect(replies[0].match(/\?/g) || []).toHaveLength(1);
      expect(replies[1]).toContain('Für Team A');
      expect(replies[1]).not.toContain('?');
      expect(replies[2]).not.toContain('?');
      for (const source of ['Fälle', 'Tenant-Gedächtnis', 'Dokumente', 'Datensätze'])
        expect(replies[2]).toContain(source);
      expect(replies.join('\n')).not.toMatch(
        /Der Nutzer|Der Anfragende|Es wird erwartet|Nenne|Kläre/u
      );
      const profile = await app.workbench.store.getUserContext({
        tenantId: 'public',
        actorId: 'person-a',
      });
      expect(profile.conversationContext.role).toBe('Team A');
      expect(profile.conversationContext.goal).toBe('Überblick');
    } finally {
      llm.generateStructured.mockImplementation(originalStructured);
      llm.generateText.mockImplementation(originalText);
    }
  });
});
