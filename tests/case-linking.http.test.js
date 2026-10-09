'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const llm = require('../src/llm-client');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const OpenAi = require('../services/openai-compatible.service');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');

// Entirely fictional actors and reference values. Exercise the authenticated
// gateway, persisted mappings, actual router/store and HTTP response renderer.
describe('Case linking #753 through authenticated gateway HTTP', () => {
  let app, env, base, gateway;
  const question = 'Bitte unterstütze die Bearbeitung der Referenz ANON-0001.';
  async function request(user, message, conversationId = `chat-${user}`, metadata = {}) {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content: message }],
        metadata: { conversationId, openWebuiOrgId: 'org-a', openWebuiUserId: user, ...metadata },
      }),
    });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    env = { ...process.env };
    app = await createCaseBroker();
    Object.assign(process.env, {
      CERNION_SUPPORT_TOKEN: 'anonymous-local-test-bootstrap',
      CERNION_SUPPORT_TOKEN_INPUT: 'anonymous-local-test-bootstrap',
      CERNION_TENANT_REGISTRY_FILE: app.registry,
      CERNION_USER_REGISTRY_FILE: path.join(app.dir, 'users.json'),
      TOKEN_ROLE_AUDIT_FILE: path.join(app.dir, 'role-audit.jsonl'),
      RATE_QUOTA_DIR: path.join(app.dir, 'quotas'),
    });
    fs.writeFileSync(
      app.registry,
      JSON.stringify([
        {
          tenantId: 'public',
          sharedService: {
            caseVisibility: 'team',
            identifierTypes: {
              'reference-a': { strength: 'strong' },
              'reference-b': { strength: 'strong' },
            },
          },
        },
      ])
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
    app.broker.createService(OpenAi);
    llm.generateStructured.mockImplementation(async (_schema, prompt) => {
      const input = JSON.parse(prompt);
      const value = input.message.match(/\[[^\]]*MASKED[^\]]*\]/)?.[0] || 'ANON-0001';
      return {
        concern: 'Anonymisierte Referenz bearbeiten.',
        situation: 'Die Bearbeitung wartet auf geprüfte Evidenz.',
        participants: ['Anfragende Person'],
        identifiers: [{ kind: 'reference-a', value }],
        deadlines: [],
        hypotheses: [],
        missingInformation: [],
        requestedAction: {
          description: 'Referenz prüfen.',
          externalEffect: false,
          draftRequested: false,
        },
        turnKind: 'work',
        retrievalTerms: ['Referenz'],
      };
    });
    llm.generateText.mockImplementation(async (prompt) => {
      const input = JSON.parse(prompt);
      const related = input.evidence.find((entry) => entry.source === 'related_case');
      return JSON.stringify({
        expectation: [
          {
            text: related
              ? 'Der verwandte Vorgang wartet auf geprüfte Evidenz.'
              : 'Prüfe die angegebene Referenz.',
            supported: related ? 'evidence' : 'model',
            evidenceIds: related ? [related.evidenceId] : [],
            completedAction: false,
            specific: false,
          },
        ],
        nextSteps: [],
        draft: [],
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
          user: 'svc:anonymous',
          name: 'Test gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org-a',
        },
        app.broker
      )
    ).data;
    for (const [user, actor, roles] of [
      ['person-a', 'actor-a', 'ROLE_GRID_OPERATOR'],
      ['person-b', 'actor-b', 'ROLE_GRID_OPERATOR'],
      ['person-c', 'actor-c', 'ROLE_GRID_OPERATOR,ROLE_USER'],
    ])
      await provisionMapping(
        { tenant: 'public', client: 'open-webui', org: 'org-a', user, actor, roles },
        app.broker
      );
  });
  afterAll(async () => {
    await app.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });

  test('two mapped colleagues create separate linked cases, first sentence names the colleague and status, correction and undo cross HTTP', async () => {
    const first = await request('person-a', question);
    expect(first.status).toBe(200);
    const firstId = first.body.metadata.cetCaseId;
    const existing = await app.router.loadCase(
      require('../src/domain-router-policy').principal({
        meta: auth('actor-a', ['ROLE_GRID_OPERATOR'], 'public'),
      }),
      firstId
    );
    const created = await app.create(
      [{ kind: 'reference-a', value: 'ANON-0001' }],
      auth('actor-b', ['ROLE_GRID_OPERATOR'], 'public'),
      { asyncDelivery: existing.asyncDelivery, knownContext: existing.knownContext }
    );
    await app.workbench.store.linkConversation({
      tenantId: 'public',
      client: 'open-webui',
      conversationId: 'chat-person-b',
      cetCaseId: created.cetCaseId,
    });
    const second = await request('person-b', question);
    expect(second.status).toBe(200);
    const secondId = second.body.metadata.cetCaseId;
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    expect(second.body.choices[0].message.content).not.toContain('evidence_required');
    const answerInput = JSON.parse(llm.generateText.mock.calls.at(-1)[0]);
    expect(answerInput.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'related_case' })])
    );
    expect(JSON.stringify(answerInput.evidence)).not.toContain(question);
    const confirmed = await request('person-b', 'gehört zusammen');
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.choices[0].message.content).toContain('journalisiert');
    const rejected = await request('person-b', 'gehört nicht zusammen');
    expect(rejected.status).toBe(200);
    const state = await app.router.loadCase(
      require('../src/domain-router-policy').principal({
        meta: auth('actor-b', ['ROLE_GRID_OPERATOR'], 'public'),
      }),
      secondId
    );
    expect(state.relatedCases.find((item) => item.cetCaseId === firstId).decision).toBe('rejected');
    const undo = await request('person-b', 'rückgängig');
    expect(undo.status).toBe(200);
    expect(undo.body.choices[0].message.content).toContain('rückgängig');
  });

  test('colleague status during open choice stays German and shows creator and last editing time through HTTP', async () => {
    const identifiers = [{ kind: 'reference-a', value: 'ANON-HTTP-CHOICE' }];
    await app.create(identifiers, auth('actor-a', ['ROLE_GRID_OPERATOR'], 'public'));
    await app.create(
      [...identifiers, { kind: 'reference-b', value: 'ANON-SECOND-PROCESS' }],
      auth('actor-a', ['ROLE_GRID_OPERATOR'], 'public')
    );
    const original = llm.generateStructured.getMockImplementation();
    llm.generateStructured.mockImplementation(async (...args) => ({
      ...(await original(...args)),
      identifiers,
    }));
    try {
      const start = await request(
        'person-b',
        'Bitte bearbeite ANON-HTTP-CHOICE.',
        'colleague-choice'
      );
      expect(start.status).toBe(200);
      expect(start.body.choices[0].message.content).toContain('Welchen Fall');
      const status = await request(
        'person-b',
        'Wer hat das bisher bearbeitet und was ist der Stand?',
        'colleague-choice'
      );
      expect(status.status).toBe(200);
      const text = status.body.choices[0].message.content;
      expect(text).toContain('Angelegt von actor-a');
      expect(text).toContain('zuletzt bearbeitet am');
      expect(text).toContain('Stand:');
      expect(text).not.toMatch(
        /Please|provide|Case:|Readiness:|Missing evidence|Belege fehlen|evidence_required|Der Nutzer fragt/u
      );
      expect(text).not.toContain('Welchen Fall');
      const chosen = await request('person-b', '1', 'colleague-choice');
      expect(chosen.status).toBe(200);
      const bound = await request(
        'person-b',
        'Wer hat das zuletzt bearbeitet?',
        'colleague-choice'
      );
      expect(bound.body.choices[0].message.content).toMatch(
        /Angelegt von actor-a[\s\S]*zuletzt bearbeitet am[\s\S]*von actor-b/u
      );
    } finally {
      llm.generateStructured.mockImplementation(original);
    }
  });

  test('identifier status is tenant-wide through HTTP; foreign tenant and spoofed organization reveal nothing', async () => {
    const foreign = await app.create(
      [{ kind: 'reference-a', value: 'ANON-FOREIGN' }],
      auth('actor-other', ['ROLE_GRID_OPERATOR'], 'tenant-b')
    );
    const response = await request('person-b', 'Wie ist der Stand bei ANON-0001?', 'status-b');
    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toContain('Stand: Die Bearbeitung ist offen');
    expect(response.body.choices[0].message.content).not.toContain('evidence_required');
    const foreignTeam = await request('person-c', 'Wie ist der Stand bei ANON-0001?', 'status-c');
    expect(foreignTeam.status).toBe(200);
    expect(foreignTeam.body.choices[0].message.content).toContain('actor-a');
    expect(foreignTeam.body.choices[0].message.content).not.toContain('evidence_required');
    const foreignTenant = await request(
      'person-b',
      'Wie ist der Stand bei ANON-FOREIGN?',
      'status-foreign'
    );
    expect(foreignTenant.status).toBe(200);
    expect(JSON.stringify(foreignTenant.body)).not.toContain(foreign.cetCaseId);
    expect(
      (
        await request('person-b', 'Wie ist der Stand bei ANON-0001?', 'spoof', {
          openWebuiOrgId: 'org-foreign',
        })
      ).status
    ).toBe(403);
  });
  test('draft follow-up keeps the safe variant and repairs an entirely rejected response across HTTP', async () => {
    let initial = await request('person-a', question, 'draft-hotfix');
    if (!initial.body.metadata.cetCaseId)
      initial = await request('person-a', 'neu', 'draft-hotfix');
    expect(initial.status).toBe(200);
    const claim = (text, condition) => ({
      text,
      condition,
      supported: 'model',
      completedAction: false,
      specific: false,
      evidenceIds: [],
    });
    const safe = claim(
      'Guten Tag, bitte teilen Sie uns den dokumentierten Bearbeitungsstand mit. Mit freundlichen Grüßen',
      'der Stand noch offen ist'
    );
    const unsafe = claim('Hiermit bestätigen wir die Netzanmeldung.', 'die Anmeldung vorliegt');
    const output = (draft) => JSON.stringify({ expectation: [], nextSteps: [], draft });
    llm.generateText.mockResolvedValueOnce(output([unsafe, safe]));
    const variants = await request('person-a', 'Mach mir die Antwort fertig', 'draft-hotfix');
    expect(variants.status).toBe(200);
    expect(variants.body.metadata.cetCaseId).toBe(initial.body.metadata.cetCaseId);
    expect(variants.body.choices[0].message.content).toContain('Bearbeitungsstand');
    expect(variants.body.choices[0].message.content).not.toMatch(
      /bestätigen|Als Nächstes:|unverbindlich|versendet.{0,40}nichts|keine externe Handlung/iu
    );
    llm.generateText.mockResolvedValueOnce(output([unsafe])).mockResolvedValueOnce(output([safe]));
    const repaired = await request('person-a', 'Entwurf bitte', 'draft-hotfix');
    expect(repaired.status).toBe(200);
    expect(repaired.body.choices[0].message.content).toContain('Bearbeitungsstand');
    expect(repaired.body.choices[0].message.content).not.toMatch(
      /bestätigen|Als Nächstes:|unverbindlich|versendet.{0,40}nichts|keine externe Handlung/iu
    );
    expect(JSON.parse(llm.generateText.mock.calls.at(-1)[0]).repairInstruction).toContain(
      'Keine verbindliche Prozessantwort'
    );
  });
  test('next-step follow-up followed by explicit draft returns both variants across HTTP', async () => {
    const structured = llm.generateStructured.getMockImplementation();
    const text = llm.generateText.getMockImplementation();
    const claim = (text, condition = '') => ({
      text,
      condition,
      supported: 'model',
      evidenceIds: [],
      specific: false,
      completedAction: false,
    });
    llm.generateStructured.mockImplementation(async (...args) => ({
      ...(await structured(...args)),
      followupKind: JSON.parse(args[1]).message.includes('konkret') ? 'next_step' : 'none',
    }));
    llm.generateText.mockImplementation(async (prompt) => {
      const input = JSON.parse(prompt);
      return JSON.stringify({
        expectation: [],
        nextSteps: input.nextStepInstruction ? [claim('Prüfe den dokumentierten Stand.')] : [],
        draft: input.turnInstruction.includes('vollständigen Entwurf')
          ? [
              claim(
                'Guten Tag, bitte teilen Sie uns den dokumentierten Stand Ihrer Anfrage mit. Mit freundlichen Grüßen',
                'der Stand noch offen ist'
              ),
              claim(
                'Guten Tag, bitte teilen Sie uns das dokumentierte Ergebnis Ihrer Anfrage mit. Mit freundlichen Grüßen',
                'das Ergebnis vorliegt'
              ),
            ]
          : [],
      });
    });
    try {
      let initial = await request('person-a', question, 'draft-after-step');
      if (!initial.body.metadata.cetCaseId)
        initial = await request('person-a', 'neu', 'draft-after-step');
      const next = await request('person-a', 'Was soll ich jetzt konkret tun?', 'draft-after-step');
      expect(next.status).toBe(200);
      expect(next.body.choices[0].message.content).toContain('Prüfe den dokumentierten Stand.');
      const draft = await request('person-a', 'Mach mir die Antwort fertig', 'draft-after-step');
      expect(draft.status).toBe(200);
      expect(draft.body.metadata.cetCaseId).toBe(initial.body.metadata.cetCaseId);
      expect(draft.body.choices[0].message.content).toMatch(/Variante A/);
      expect(draft.body.choices[0].message.content).toMatch(/Variante B/);
      expect(draft.body.choices[0].message.content).not.toMatch(
        /Als Nächstes:|nicht sauber zustande/
      );
      expect(JSON.parse(llm.generateText.mock.calls.at(-1)[0]).nextStepInstruction).toBe('');
    } finally {
      llm.generateStructured.mockImplementation(structured);
      llm.generateText.mockImplementation(text);
    }
  });
  test('AC01/03/04: a tenant colleague in a fresh HTTP chat continues one case and names it only in the assignment turn', async () => {
    const implementation = llm.generateStructured.getMockImplementation();
    const identifiers = [
      { kind: 'reference-a', value: 'ANON-764-HTTP' },
      { kind: 'reference-b', value: 'LOC-764-HTTP' },
    ];
    llm.generateStructured.mockImplementation(async (...args) => ({
      ...(await implementation(...args)),
      identifiers,
    }));
    try {
      const message = 'Bitte bearbeite ANON-764-HTTP und LOC-764-HTTP.';
      const first = await request('person-a', message, '764-first');
      const second = await request('person-b', message, '764-second');
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.metadata.cetCaseId).toBe(first.body.metadata.cetCaseId);
      const content = second.body.choices[0].message.content;
      expect(content).toMatch(/^Das gehört zu F-\d+ \(/u);
      expect(content).toContain('angelegt von actor-a');
      expect(content.match(/F-\d+/gu)).toHaveLength(1);
      for (const text of ['Bitte prüfe die neuen Angaben.', 'Welche Belege fehlen noch?']) {
        const turn = await request('person-b', text, '764-second');
        expect(turn.status).toBe(200);
        expect(turn.body.choices[0].message.content).not.toMatch(
          /Das gehört zu|Zu diesen Kennungen|evidence_required|human_review_required/u
        );
      }
      const events = (await app.router.eventsDb.allDocs({ include_docs: true })).rows.map(
        ({ doc }) => doc
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'contributed',
            cetCaseId: first.body.metadata.cetCaseId,
            conversationId: '764-second',
          }),
        ])
      );
    } finally {
      llm.generateStructured.mockImplementation(implementation);
    }
  });

  test('AC07: same-tenant HTTP caller without clearance cannot see, name or continue a sensitive case', async () => {
    const implementation = llm.generateStructured.getMockImplementation();
    const identifiers = [{ kind: 'reference-a', value: 'ANON-764-RESTRICTED' }];
    const existing = await app.create(
      identifiers,
      auth('actor-a', ['ROLE_GRID_OPERATOR'], 'public', ['restricted']),
      { sensitivityFlags: ['restricted'] }
    );
    llm.generateStructured.mockImplementation(async (...args) => ({
      ...(await implementation(...args)),
      identifiers,
    }));
    try {
      const status = await request(
        'person-b',
        'Wie ist der Stand bei ANON-764-RESTRICTED?',
        '764-secret-status'
      );
      expect(status.status).toBe(200);
      expect(JSON.stringify(status.body)).not.toContain(existing.cetCaseId);
      expect(status.body.choices[0].message.content).not.toContain('angelegt von actor-a');
      const next = await request(
        'person-b',
        'Bitte bearbeite ANON-764-RESTRICTED.',
        '764-secret-work'
      );
      expect(next.status).toBe(200);
      expect(next.body.metadata.cetCaseId).not.toBe(existing.cetCaseId);
      expect(next.body.choices[0].message.content).not.toMatch(
        /Das gehört zu|Zu diesen Kennungen|zusammenführen/u
      );
    } finally {
      llm.generateStructured.mockImplementation(implementation);
    }
  });
});
