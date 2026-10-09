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
});
