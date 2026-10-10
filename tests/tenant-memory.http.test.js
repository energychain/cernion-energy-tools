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
const Dataset = require('../services/dataset.service');
const Datapoint = require('../services/datapoint.service');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const llm = require('../src/llm-client');
const fixture = require('./fixtures/tenant-memory.json');

describe('tenant memory through authenticated OpenAI HTTP', () => {
  let app, env, base, gateway, otherGateway;
  beforeEach(async () => {
    jest.clearAllMocks();
    env = { ...process.env };
    app = await createCaseBroker();
    Object.assign(process.env, {
      CERNION_SUPPORT_TOKEN: 'synthetic-bootstrap',
      CERNION_SUPPORT_TOKEN_INPUT: 'synthetic-bootstrap',
      CERNION_TENANT_REGISTRY_FILE: app.registry,
      CERNION_USER_REGISTRY_FILE: path.join(app.dir, 'users.json'),
      TOKEN_ROLE_AUDIT_FILE: path.join(app.dir, 'audit.jsonl'),
      RATE_QUOTA_DIR: path.join(app.dir, 'quotas'),
      WORKBENCH_DATASET_DB_PATH: path.join(app.dir, 'dataset-rows'),
      DATAPOINT_SCHEDULER_ENABLED: 'false',
    });
    require('../src/rate-quota-store').resetForTests();
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
    app.broker.createService({
      ...Datapoint,
      settings: { ...Datapoint.settings, dbPath: path.join(app.dir, 'dataset-catalog') },
    });
    app.broker.createService(Dataset);
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
      const record = /^Die Leitung|^Das Stromnetz|^Gerade komme/.test(input.message);
      const production = input.message.includes('Lindenallee');
      return {
        concern: 'Organisation planen',
        situation: input.message,
        participants: [],
        identifiers: [],
        deadlines: [],
        hypotheses: [],
        missingInformation: [],
        requestedAction: { description: '', externalEffect: false, draftRequested: false },
        turnKind: record && !production ? 'work' : 'knowledge',
        retrievalTerms: [],
        tenantMemory: {
          assertions: record
            ? [
                {
                  text: input.message,
                  basis: production
                    ? input.message
                        .replace('aktuell ', '')
                        .replace('akzeptieren können', 'akzeptieren kann')
                        .replace('Die Kunden sollen zeitnah informiert werden.', '')
                    : input.message,
                  commitment: 'planned',
                  anchors: [
                    {
                      value: production ? 'Lindenallee' : 'Hauptstraße',
                      qualifier: production ? 'Testbezirk' : '',
                      aliases: [],
                    },
                  ],
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
        expectation: [],
        interpretation: [
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
    for (const item of [
      fixture.first,
      fixture.second,
      { actor: 'ben', functionLabel: 'Gasnetzplanung' },
      { actor: 'anna', functionLabel: 'Stromnetz' },
    ]) {
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
    jest.restoreAllMocks();
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
  test.each([
    ['ben', 'anna', false],
    ['anna', 'ben', false],
    ['ben', 'anna', true],
    ['anna', 'ben', true],
  ])('production regression: %s → %s, source timeout=%s', async (firstActor, secondActor, slow) => {
    const people = {
      ben: {
        actor: 'ben',
        functionLabel: 'Gasnetzplanung',
        text: 'Gerade komme ich aus der Gasnetzplanung. Die Leitung in der Lindenallee müssen wir spätestens 2030 außer Betrieb nehmen. Die Kunden sollen zeitnah informiert werden.',
      },
      anna: {
        actor: 'anna',
        functionLabel: 'Stromnetz',
        text: 'Das Stromnetz in der Lindenallee ist aktuell so weit am Limit, dass wir frühestens im Jahr 2034 neue Anträge für Wallboxen oder Wärmepumpen akzeptieren können.',
      },
    };
    if (slow) {
      process.env.WORKBENCH_RETRIEVAL_TIMEOUT_MS = '80';
      const original = app.broker.call.bind(app.broker);
      jest.spyOn(app.broker, 'call').mockImplementation((name, ...args) => {
        if (name === 'personal-agent.collectWorkbenchEvidence')
          return new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  Object.assign(new Error('Synthetic source timeout'), {
                    code: 504,
                    type: 'SOURCE_TIMEOUT',
                  })
                ),
              120
            )
          );
        return original(name, ...args);
      });
    }
    const memoryInfo = jest.spyOn(app.broker.logger, 'info');
    const first = await request(people[firstActor]);
    expect(first.status).toBe(200);
    expect(first.text).toContain('Hab ich festgehalten:');
    const second = await request(people[secondActor]);
    expect(second.status).toBe(200);
    expect(second.text).toContain('Hab ich festgehalten:');
    await new Promise((resolve) => setImmediate(resolve));
    const memoryLogs = memoryInfo.mock.calls.filter(([label]) => label === 'Tenant memory');
    expect(memoryLogs).toHaveLength(2);
    expect(memoryLogs[1][1]).toMatchObject({
      candidates: 1,
      accepted: 1,
      assessmentStarted: 1,
      relations: 1,
      notices: 1,
    });
    expect(JSON.stringify(memoryLogs)).not.toMatch(/Lindenallee|Gasnetzplanung|ben|anna/);
    if (slow)
      expect(
        app.broker.call.mock.calls.some(
          ([name]) => name === 'personal-agent.collectWorkbenchEvidence'
        )
      ).toBe(true);
    expect(second.text).toContain(firstActor);
    expect(second.text).toContain(people[firstActor].functionLabel);
    expect(second.text).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(second.text).toContain('2030 bis 2034');
    expect(second.text).not.toMatch(
      /unverbindlich|versendet[^\n]*nichts|keine externe Handlung|Unverbindliche Einschätzung/i
    );
    const query = await request(people[secondActor], 'Was wissen wir insgesamt zur Lindenallee?');
    expect(query.text).toContain('ben');
    expect(query.text).toContain('anna');
    expect(query.text).toContain('2030 bis 2034');
    const draft = await request(
      people.ben,
      'Bitte entwirf mir die Kundeninformation zur Gasstilllegung in der Lindenallee.'
    );
    expect(draft.text).toContain('2030 bis 2034');
    expect(draft.text).not.toMatch(
      /unverbindlich|versendet[^\n]*nichts|keine externe Handlung|Unverbindliche Einschätzung/i
    );
    expect(draft.text.indexOf('2030 bis 2034')).toBeLessThan(
      draft.text.indexOf('Wir berücksichtigen')
    );
    const next = await request(people[firstActor], 'Danke.');
    if (firstActor === 'anna') expect(next.text).toContain('Hinweise für dich:');
    else expect(draft.text).toContain('Hinweise für dich:');
    const later = await request(people[firstActor], 'Danke nochmals.');
    expect(later.text).not.toContain('Hinweise für dich:');
    const docs = await app.call(
      'object-store.query',
      {
        namespace: 'tenant:public:workbench_facts',
        selector: { 'payload.type': 'tenant_memory_fact' },
      },
      auth(firstActor, ['ROLE_GRID_OPERATOR'], 'public')
    );
    expect(docs.docs).toHaveLength(2);
  });
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
  test('table storage stays in the dataset catalog and never creates tenant assertions', async () => {
    const response = await request(
      fixture.first,
      `<context><source name="Synthetic.csv">timestamp;value\n2031-01-01T00:00:00Z;1\n2031-01-01T00:15:00Z;2</source></context><user_query>${fixture.first.text}</user_query>`,
      'table-only'
    );
    expect(response.status).toBe(200);
    const meta = auth('Charly', ['ROLE_GRID_OPERATOR'], 'public');
    const catalog = await app.call('datapoint.datasetCatalog', { operation: 'list' }, meta);
    expect(catalog).toHaveLength(1);
    const facts = await app.call(
      'object-store.query',
      {
        namespace: 'tenant:public:workbench_facts',
        selector: { 'payload.type': 'tenant_memory_fact' },
      },
      meta
    );
    expect(facts.docs).toHaveLength(0);
  });
  test('bare correction follows the latest statement or dataset without changing the other', async () => {
    const table =
      '<context><source name="Synthetic.csv">timestamp;value\n2031-01-01T00:00:00Z;1\n2031-01-01T00:15:00Z;2</source></context><user_query>Tabelle behalten.</user_query>';
    const conversation = 'mixed-correction';
    expect((await request(fixture.first, table, conversation)).status).toBe(200);
    expect((await request(fixture.first, fixture.first.text, conversation)).text).toContain(
      'Hab ich festgehalten:'
    );
    const corrected = await request(fixture.first, 'korrigier das', conversation);
    expect(corrected.text).toContain('als korrigiert');
    const meta = auth('Charly', ['ROLE_GRID_OPERATOR'], 'public');
    const query = () =>
      app.call(
        'object-store.query',
        {
          namespace: 'tenant:public:workbench_facts',
          selector: { 'payload.type': 'tenant_memory_fact' },
        },
        meta
      );
    expect((await query()).docs[0].payload.status).toBe('corrected');
    const next = `${fixture.first.text} Andere Variante.`;
    expect((await request(fixture.first, next, conversation)).text).toContain(
      'Hab ich festgehalten:'
    );
    const tableAnswer = await request(
      fixture.first,
      table.replace('Tabelle behalten.', 'Welche Daten haben wir?'),
      conversation
    );
    expect(tableAnswer.status).toBe(200);
    expect(tableAnswer.text).toContain('Synthetic');
    const datasetCorrection = await request(fixture.first, 'korrigier das', conversation);
    expect(datasetCorrection.text).toContain('Semantikkorrektur');
    expect((await query()).docs.find((doc) => doc.payload.text === next).payload.status).toBe(
      'valid'
    );
    expect(await app.call('datapoint.datasetCatalog', { operation: 'list' }, meta)).toHaveLength(1);
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
    expect(c.status).toBe(200);
    expect(c.body).not.toHaveProperty('error');
    expect(c.text).toContain('Doris');
    expect(c.text).toContain('Stromnetz');
    expect(c.text).toContain('2030 bis 2034');
  });
});
