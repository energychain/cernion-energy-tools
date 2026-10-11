'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const path = require('node:path');
const { createCaseBroker } = require('./helpers/case-linking-broker');
const llm = require('../src/llm-client');
const TokenManager = require('../services/token-manager.service');
const Api = require('../services/api.service');
const OpenAI = require('../services/openai-compatible.service');
const Dataset = require('../services/dataset.service');
const Datapoint = require('../services/datapoint.service');
const { GOVERNANCE_MODEL } = require('../src/openai-models');
const { provisionToken } = require('../scripts/provision-token');
const { provisionMapping } = require('../scripts/provision-workbench-mapping');
const {
  generateDatasetFixture,
  generateDatasetRoutingFixture,
} = require('../scripts/generate-dataset-fixtures');

describe('datasets through authenticated Open WebUI HTTP', () => {
  let app, env, base, gateway, attachment;
  const marketRead = jest.fn(() => ({
    success: true,
    data: { results: [{ name: 'Synthetic installation', capacityKW: 150, municipality: 'Uslar' }] },
  }));
  async function request(
    question,
    user = 'synthetic-uploader',
    conversationId = 'dataset-http',
    repeat = true,
    metadata = {}
  ) {
    const response = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GOVERNANCE_MODEL,
        messages: [
          {
            role: 'user',
            content: repeat
              ? `<context><source name="Synthetic.csv">${attachment}</source></context><user_query>${question}</user_query>`
              : question,
          },
        ],
        metadata: {
          conversationId,
          openWebuiOrgId: 'org-synthetic',
          openWebuiUserId: user,
          ...metadata,
        },
      }),
    });
    const body = await response.json();
    return { status: response.status, text: body.choices?.[0]?.message?.content, body };
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
      WORKBENCH_DATASET_DB_PATH: path.join(app.dir, 'dataset-rows'),
      DATAPOINT_SCHEDULER_ENABLED: 'false',
    });
    fs.writeFileSync(
      app.registry,
      JSON.stringify([{ tenantId: 'public', sharedService: { caseVisibility: 'team' } }])
    );
    app.broker.createService({
      ...Datapoint,
      settings: { ...Datapoint.settings, dbPath: path.join(app.dir, 'dataset-catalog') },
    });
    app.broker.createService(Dataset);
    const routingFixture = generateDatasetRoutingFixture();
    app.broker.createService({ name: 'energy-market', actions: { installations: marketRead } });
    app.broker.createService({
      name: 'object-store',
      actions: {
        query: () => ({ docs: [{ payload: { ...routingFixture.fact, tenantId: 'public' } }] }),
      },
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
      if (input.datasets)
        return {
          datasetIds: /Marktstammdatenregister|Ahornweg/.test(input.question)
            ? []
            : input.datasets.map((record) => record.id),
        };
      if (input.profile) return null;
      const { understandResult } = require('./fixtures/workbench-752.json');
      return (
        understandResult || {
          concern: input.message || 'Datensatz auswerten',
          situation: input.message || 'Datensatz auswerten',
          hypotheses: [],
          identifiers: [],
          deadlines: [],
          participants: [],
          missingInformation: [],
          requestedAction: {
            description: 'Auswerten',
            externalEffect: false,
            draftRequested: false,
          },
          turnKind: 'knowledge',
          retrievalTerms: [],
          dataNeeds: input.message || 'Datensatz auswerten',
          outputKind: 'analysis',
        }
      );
    });
    llm.generateChat.mockImplementation(async (_messages, options) => {
      const tool =
        options.tools.find((entry) => entry.function.description.startsWith('dataset.query:')) ||
        options.tools.find((entry) =>
          entry.function.description.startsWith('energy-market.installations:')
        );
      return tool
        ? {
            toolCalls: [
              {
                name: tool.function.name,
                args: {
                  input: tool.function.description.startsWith('dataset.query:')
                    ? { id: tool.function.parameters.properties.input.properties.id.enum[0] }
                    : { installationType: 'solar', minCapacityKW: 100 },
                },
              },
            ],
          }
        : { toolCalls: [] };
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
          org: 'org-synthetic',
        },
        app.broker
      )
    ).data;
    for (const user of ['synthetic-uploader', 'synthetic-colleague'])
      await provisionMapping(
        {
          tenant: 'public',
          client: 'open-webui',
          org: 'org-synthetic',
          user,
          actor: user,
          roles: 'ROLE_EDM,ROLE_GRID_OPERATOR',
        },
        app.broker
      );
    attachment = generateDatasetFixture();
  });
  afterAll(async () => {
    await app.cleanup();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });
  test('full CSV answers first question and repeated attachments answer the current question once', async () => {
    const first = await request('Gibt es Auffälligkeiten?');
    expect(first.status).toBe(200);
    expect(first.text).toContain('Hab ich abgelegt:');
    expect(first.text).toContain('1.243,7 kW am 14.01.2025 18:15');
    expect(first.text).toContain('3.478,874 MWh');
    expect(first.text).not.toContain('```');
    const repeated = await request('Wie hoch war der Mittelwert?');
    expect(repeated.status).toBe(200);
    expect(repeated.text).toContain('Mittelwert');
    expect(repeated.text).not.toContain('Hab ich abgelegt:');
    const colleague = await request(
      'Wie hoch war die Spitzenlast 2025?',
      'synthetic-colleague',
      'other-chat',
      false
    );
    expect(colleague.status).toBe(200);
    expect(colleague.text).toContain('1.243,7 kW');
    expect(colleague.text).toContain('Nutzerangabe von synthetic-uploader');
    expect(colleague.text).not.toContain('Hab ich abgelegt:');
    const foreign = await request(
      'Wie hoch war die Spitzenlast?',
      'synthetic-uploader',
      'other-chat',
      false,
      { openWebuiOrgId: 'foreign-org' }
    );
    expect(foreign.status).toBe(403);
  });
  test('a single catalog table cannot capture a foreign register or tenant-memory question', async () => {
    marketRead.mockClear();
    for (const scenario of generateDatasetRoutingFixture().questions.filter((entry) =>
      ['external', 'memory'].includes(entry.kind)
    )) {
      const response = await request(
        scenario.question,
        'synthetic-colleague',
        `foreign-${scenario.kind}`,
        false
      );
      expect(response.status).toBe(200);
      expect(response.text).not.toMatch(
        /35[.]?0(?:36|40)|1[.]243,7|3[.]478,874|synthetischer-lastgang/
      );
      expect(response.body.metadata.sources || []).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'dataset.query', status: 'available' }),
        ])
      );
      if (scenario.kind === 'external') expect(marketRead).toHaveBeenCalled();
      else expect(response.text).toContain(generateDatasetRoutingFixture().fact.text);
    }
  });
  test('HTTP answers peak, yearly energy and anomalies through the normal answer phase', async () => {
    const outputs = [
      ['Spitzenlast 2025?', 'Die Spitzenlast beträgt 1.243,7 kW (14.01.2025, 18:15 Uhr).'],
      [
        'Jahresenergie 2025?',
        'Die Jahresenergie beträgt 3.478,874 MWh; vier leere Werte sind ausgelassen.',
      ],
      [
        'Gibt es Auffälligkeiten?',
        'Es gibt 4 leere Werte und 2 Zeitumstellungen; die Spitze liegt bei 1.243,7 kW.',
      ],
    ];
    for (const [question, text] of outputs) {
      llm.generateText.mockResolvedValue(
        JSON.stringify({
          interpretation: [
            {
              text,
              origin: 'evidence',
              supported: 'evidence',
              completedAction: false,
              specific: true,
              evidenceIds: ['E1'],
            },
          ],
          expectation: [],
          nextSteps: [],
          assumptions: [],
          draft: [],
        })
      );
      const response = await request(question);
      expect(response.status).toBe(200);
      expect(response.body.metadata.phaseTimes.answerMs).toBeGreaterThan(0);
      if (question === 'Gibt es Auffälligkeiten?') expect(response.text).toContain('4 leere Werte');
      else expect(response.text).toContain(text);
      expect(response.text).not.toMatch(
        /energie_summe:|spitzenlast:|auffaelligkeiten_count:|13\.915/
      );
      expect(response.text.match(/Herkunft:/g)).toHaveLength(1);
    }
    const [prompt] = llm.generateText.mock.calls.at(-1);
    expect(prompt).not.toContain('Zeitstempel (Beginn);');
    expect(prompt).not.toContain('rows":[');
    const colleague = await request(
      'Wie hoch war die Jahresenergie 2025?',
      'synthetic-colleague',
      'year-check',
      false
    );
    expect(colleague.text).toContain('3.478,874 MWh');
    const result = await app.broker.call(
      'dataset.query',
      { question: 'Spitzenlast 2025?' },
      {
        meta: {
          authUser: {
            tenantId: 'public',
            userId: 'synthetic-colleague',
            roles: ['ROLE_EDM'],
            scope: 'read-only',
          },
        },
      }
    );
    expect(result.rowCount).toBe(35040);
    expect(result.summaries[0].integral / 1000).toBeCloseTo(3478.874, 9);
    llm.generateText.mockReset();
  });
  test('model cannot invent dataset figures or expose internal result keys', async () => {
    for (const [question, text, expected] of [
      ['Spitzenlast 2025?', 'Die Spitzenlast beträgt 9.999 kW.', '1.243,7 kW'],
      ['Jahresenergie 2025?', 'energie_summe: 3.478,874 MWh', '3.478,874 MWh'],
      ['Spitzenlast 2025?', 'Wir berücksichtigen die Angaben.', '1.243,7 kW'],
      ['Spitzenlast 2025?', 'Die Spitzenlast beträgt 14 kW.', '1.243,7 kW'],
      ['Spitzenlast 2025?', 'Die Spitzenlast beträgt -1.243,7 kW.', '1.243,7 kW'],
    ]) {
      llm.generateText.mockResolvedValue(
        JSON.stringify({
          interpretation: [
            {
              text,
              origin: 'evidence',
              supported: 'evidence',
              completedAction: false,
              specific: true,
              evidenceIds: ['E1'],
            },
          ],
          expectation: [],
          nextSteps: [],
          assumptions: [],
          draft: [],
        })
      );
      const response = await request(question);
      expect(response.text).toContain(expected);
      expect(response.text).not.toMatch(/9\.999|energie_summe:/);
    }
    llm.generateText.mockReset();
  });
  test('reattached file does not prevent semantic correction or deletion', async () => {
    llm.generateStructured.mockResolvedValueOnce({
      title: 'Synthetic.csv',
      timezone: 'Europe/Berlin',
      units: { 'Wirkleistung Bezug [kW]': 'kWh' },
      assumptions: [],
    });
    const correction = await request('Die Werte sind kWh je Viertelstunde.');
    expect(correction.status).toBe(200);
    expect(correction.text).toContain('Semantik');
    expect(correction.text).not.toContain('Hab ich abgelegt:');
    const deleted = await request('Lösch den Datensatz Synthetic.csv.');
    expect(deleted.status).toBe(200);
    expect(deleted.text).toContain('physisch gelöscht');
  });
  test('a deleted file replayed by Open WebUI stays deleted across text representations', async () => {
    attachment = generateDatasetFixture('markdown');
    const replayed = await request('Wie hoch war die Spitzenlast in Synthetic.csv?');
    expect(replayed.status).toBe(200);
    expect(replayed.text).toContain('kein zugänglicher Datensatz');
    expect(replayed.text).not.toContain('Hab ich abgelegt:');
    expect(
      await app.broker.call(
        'datapoint.datasetCatalog',
        { operation: 'list' },
        {
          meta: {
            authUser: {
              tenantId: 'public',
              userId: 'synthetic-uploader',
              scope: 'read-only',
              roles: ['ROLE_EDM'],
            },
          },
        }
      )
    ).toEqual([]);
  });
});
