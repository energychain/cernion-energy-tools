'use strict';

jest.mock('../src/llm-client', () => ({ generateStructured: jest.fn(), generateText: jest.fn() }));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker, auth } = require('./helpers/case-linking-broker');
const ObjectStore = require('../services/object-store.service');
const Notices = require('../services/shared-service-notices.service');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const OpenAI = require('../services/openai-compatible.service');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const llm = require('../src/llm-client');
const fixture = require('./fixtures/tenant-memory.json');

describe('tenant memory through authenticated OpenAI HTTP', () => {
  let app, env, base, gateway, otherGateway;
  beforeEach(async () => {
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
      JSON.stringify([{ tenantId: 'public' }, { tenantId: 'tenant-other' }])
    );
    app.broker.createService({
      ...ObjectStore,
      settings: { dbPath: path.join(app.dir, 'objects') },
    });
    app.broker.createService({
      ...Notices,
      settings: { ...Notices.settings, dbPath: path.join(app.dir, 'notices') },
    });
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
      if (input.fact)
        return {
          relations: input.candidates.map((item) => ({
            candidateId: item.id,
            kind: 'gap',
            reason: fixture.reason,
            uncertainty: 0.2,
            evidenceIds: [],
            question: fixture.question,
          })),
          plausibility: [],
        };
      const record = /^Die Leitung|^Das Stromnetz/.test(input.message);
      return {
        concern: 'Organisation planen',
        situation: input.message,
        participants: [],
        identifiers: [],
        deadlines: [],
        hypotheses: [],
        missingInformation: [],
        requestedAction: { description: '', externalEffect: false, draftRequested: false },
        turnKind: record ? 'work' : 'knowledge',
        retrievalTerms: [],
        tenantMemory: {
          assertions: record
            ? [
                {
                  text: input.message,
                  basis: input.message,
                  commitment: 'planned',
                  anchors: [{ value: 'Hauptstraße', qualifier: '', aliases: [] }],
                  time: {
                    from: '',
                    until: '',
                    latest: input.message.includes('2030') ? '2030' : '',
                    earliest: input.message.includes('2034') ? '2034' : '',
                    date: '',
                  },
                  expiresAt: '',
                },
              ]
            : [],
          correction: { kind: 'none', basis: '', factId: '' },
          query: { requested: false, anchor: '', functionLabel: '' },
        },
      };
    });
    llm.generateText.mockResolvedValue(
      JSON.stringify({
        expectation: [
          {
            text: 'Wir berücksichtigen die Angaben.',
            supported: 'model',
            completedAction: false,
            specific: false,
            evidenceIds: [],
          },
        ],
        nextSteps: [],
      })
    );
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
    otherGateway = (
      await provisionToken(
        {
          tenant: 'tenant-other',
          user: 'svc:synthetic-other',
          name: 'Synthetic other gateway',
          gateway: true,
          client: 'open-webui',
          org: 'org-other',
        },
        app.broker
      )
    ).data;
    await provisionMapping(
      {
        tenant: 'tenant-other',
        client: 'open-webui',
        org: 'org-other',
        user: 'Doris',
        actor: 'Doris',
        roles: 'ROLE_GRID_OPERATOR',
      },
      app.broker
    );
    for (const item of [fixture.first, fixture.second]) {
      await provisionMapping(
        {
          tenant: 'public',
          client: 'open-webui',
          org: 'org-test',
          user: item.actor,
          actor: item.actor,
          roles: 'ROLE_GRID_OPERATOR',
        },
        app.broker
      );
      await app.workbench.store.saveUserContext({
        tenantId: 'public',
        actorId: item.actor,
        roleFamilies: [item.functionLabel],
      });
    }
  });
  afterEach(async () => {
    await app.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });
  async function request(
    item,
    message = item.text,
    conversationId = `memory-http-${item.actor}`,
    extra = {},
    token = gateway.token
  ) {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GOVERNANCE_MODEL,
        messages: [{ role: 'user', content: message }],
        metadata: {
          conversationId,
          openWebuiOrgId: 'org-test',
          openWebuiUserId: item.actor,
          ...extra,
        },
      }),
    });
    const body = await response.json();
    return { status: response.status, body, text: body.choices?.[0]?.message?.content || '' };
  }
  test('AC-01/07/08: sources and one next-turn notice survive the HTTP renderer, queries use tenant memory', async () => {
    const first = await request(fixture.first);
    expect(first.status).toBe(200);
    expect(first.text).toContain('Hab ich festgehalten:');
    const second = await request(fixture.second);
    expect(second.text).toContain('Charly');
    expect(second.text).toContain('Gasnetzplanung');
    expect(second.text).toContain('2030 bis 2034');
    const next = await request(fixture.first, 'Was ist der nächste Schritt?');
    expect(next.text).toContain('2030 bis 2034');
    const later = await request(fixture.first, 'Danke.');
    expect(later.text).not.toContain('Hinweise für dich:');
    const query = await request(fixture.second, 'Was wissen wir zu Hauptstraße?');
    expect(query.text).toContain('Charly');
    expect(query.text).toContain('Doris');
    expect(query.text).toContain('gültig');
    const byFunction = await request(fixture.second, 'Was hat die Gasnetzplanung festgehalten?');
    expect(byFunction.text).toContain('Charly');
    const foreign = await request(
      fixture.second,
      'Was wissen wir zu Hauptstraße?',
      'foreign',
      { openWebuiOrgId: 'org-other' },
      otherGateway.token
    );
    expect(foreign.status).toBe(200);
    expect(foreign.text).toContain('noch keine sichtbaren Aussagen');
    expect(foreign.text).not.toContain('Charly');
  });
  test('HTTP statements inherit active-case classification and remain hidden from un-cleared actors', async () => {
    const mapping = await app.workbench.store.getUserMapping({
      client: 'open-webui',
      externalOrgId: 'org-test',
      externalUserId: 'Charly',
    });
    await app.workbench.store.saveUserMapping({ ...mapping, sensitivityClearance: ['restricted'] });
    const classified = await app.call(
      'domain-router.classify',
      {
        userRequest: 'Synthetic restricted planning case',
        disableKnowledgeRouting: true,
        sensitivityFlags: ['restricted'],
        knownContext: {
          situation: {
            concern: 'Plan',
            situation: 'Plan',
            identifiers: [],
            participants: [],
            deadlines: [],
            hypotheses: [],
            missingInformation: [],
            requestedAction: { description: '', externalEffect: false, draftRequested: false },
            turnKind: 'work',
            retrievalTerms: [],
          },
        },
      },
      auth('Charly', ['ROLE_GRID_OPERATOR'], 'public', ['restricted'])
    );
    await app.workbench.store.linkConversation({
      tenantId: 'public',
      client: 'open-webui',
      conversationId: 'classified',
      cetCaseId: classified.cetCaseId,
    });
    const recorded = await request(fixture.first, fixture.first.text, 'classified');
    expect(recorded.body).not.toHaveProperty('error');
    expect(recorded.status).toBe(200);
    expect(recorded.text).toContain('Hab ich festgehalten:');
    const query = await request(fixture.second, 'Was wissen wir zu Hauptstraße?');
    expect(query.text).not.toContain('Charly');
    const own = await request(fixture.first, 'Was wissen wir zu Hauptstraße?');
    expect(own.text).toContain('Charly');
  });
  test('AC-02: reverse order in fresh conversations retains symmetric links', async () => {
    const d = await request(
      fixture.second,
      `${fixture.second.text} Neuer Bezug Projekt-S.`,
      'reverse-d'
    );
    expect(d.text).toContain('Hab ich festgehalten:');
    const c = await request(
      fixture.first,
      `${fixture.first.text} Neuer Bezug Projekt-S.`,
      'reverse-c'
    );
    expect(c.text).toContain('Doris');
    expect(c.text).toContain('Stromnetz');
    expect(c.text).toContain('2030 bis 2034');
  });
});
