'use strict';

jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { harness, auth } = require('./helpers/project-ingest');
const fixtures = require('../scripts/generate-project-manifest-fixtures');
const facade = require('./helpers/workbench-llm-stub');
const llm = require('../src/llm-client');
let h, dir, env, mode, phases, sourceKind;

beforeEach(async () => {
  env = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-routing-887-'));
  process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'tables');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  phases = [];
  mode = 'knowledge';
  sourceKind = 'dataset';
  llm.generateText.mockImplementation(facade.generateText);
  llm.generateStructured.mockImplementation(async (schema, prompt) => {
    const input = JSON.parse(prompt);
    if (prompt.includes('Projektmanifest-Kandidaten')) {
      const sources = input.nodes
        .filter((node) => node.kind === sourceKind)
        .map((node) => node.nodeId);
      return {
        summary: { text: 'Archivierte Unterlagen für einen abgegrenzten Gegenstand.', sources },
        entities: [
          {
            name: input.title.endsWith('A') ? 'Nördliche Niederlassung' : 'Westliches Lager',
            kind: 'subject',
            sources,
          },
        ],
        timeRanges: [],
        questionTypes: [
          {
            id: 'upper-bound',
            description:
              'Ermittle den größten dokumentierten Messwert der betrachteten Reihe im archivierten Geschäftsjahr',
            inputs: [],
            skillRefs: [],
            sources,
          },
        ],
        externalLinks: [],
      };
    }
    if (input.catalog && input.message) {
      phases.push('understanding');
      const output = await facade.generateStructured(schema, prompt);
      return {
        ...output,
        turnKind: mode,
        requestedAction: { description: '', externalEffect: false, draftRequested: false },
        missingInformation: [
          {
            key: 'basis',
            blocking: true,
            question: 'Welche Datenquelle und welcher Zeitraum sind gemeint?',
          },
        ],
      };
    }
    if (input.untrustedEvidence) {
      const entry = input.untrustedEvidence.find((entry) => entry.source === 'dataset.query');
      const number = input.projectTitle.endsWith('A') ? 23 : 29;
      const external = input.untrustedEvidence.find((entry) => entry.metadata?.sourceLabel);
      return {
        answer: `Aus Projektakte „${input.projectTitle}“ stammt der Höchstwert ${number} (${entry.metadata.filename}).${external ? ` Aus ${external.metadata.sourceLabel} stammt der Referenzwert ${input.projectTitle.endsWith('A') ? 41 : 43}.` : ''}`,
      };
    }
    return undefined;
  });
  h = await harness(dir, {}, async (broker) => {
    broker.middlewares.add({
      localAction(next, action) {
        return async (ctx) => {
          phases.push(action.name);
          return next(ctx);
        };
      },
    });
    const workbench = require('../services/workbench.service');
    broker.createService({
      ...workbench,
      settings: require('../scripts/workbench-live-harness').isolatedSettings(workbench, dir),
    });
    const router = require('../services/domain-router.service');
    broker.createService({
      ...router,
      settings: {
        ...router.settings,
        dbPath: path.join(dir, 'router'),
        eventsDbPath: path.join(dir, 'events'),
        knowledgeTimeoutMs: 10,
      },
    });
    broker.createService(fixtures.referenceService);
    for (const name of [
      'datapoint',
      'dataset',
      'knowledge-rag',
      'project-structure',
      'project-graph',
      'project-manifest',
      'shared-service-learning',
    ]) {
      const service = require(`../services/${name}.service`);
      broker.createService({
        ...service,
        settings: {
          ...service.settings,
          dbPath: path.join(dir, name),
          ...(['project-graph', 'project-manifest'].includes(name)
            ? {
                catalog: fixtures.referenceCatalog,
                operations: [fixtures.referenceOperation],
                domains: [],
              }
            : {}),
        },
      });
    }
  });
});
afterEach(async () => {
  await h?.broker.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = env;
  jest.restoreAllMocks();
});
const meta = () => {
  const value = auth();
  value.apiToken.scope = 'full-access';
  return value;
};
async function setup(id) {
  const scenario = require('../scripts/generate-practice-evaluation-fixtures')
    .generatePracticeCatalog()
    .scenarios.find((item) => item.id === id);
  const state = {};
  await fixtures.prepareProjectFixtures({ broker: h.broker }, state, scenario, meta());
  return { scenario, projectId: state.projects[0] };
}
const chat = (message, conversationId = 'routing-chat') =>
  h.call('workbench.chat', { channel: 'api', conversationId, userRequest: message }, meta());

test.each([
  ['a', 'knowledge'],
  ['a', 'work'],
  ['b', 'knowledge'],
  ['b', 'work'],
])('paraphrased %s %s manifest answers through the complete chat action', async (domain, kind) => {
  mode = kind;
  const { scenario, projectId } = await setup(`project-${domain}-implicit`);
  const candidates = await h.call('project-manifest.candidates', {}, meta());
  phases.length = 0;
  const reply = await chat(scenario.turns[0].message);
  fs.writeFileSync(
    path.join(os.tmpdir(), `887-routing-repro-${domain}-${kind}.json`),
    JSON.stringify({ phases, candidates, reply }, null, 2)
  );
  expect(reply.projectSelection?.projectId).toBe(projectId);
  expect(reply.responseText).toContain('Ich habe dafür die Projektakte');
  expect(reply.responseText).toContain(String(scenario.projectFixtures[0].value));
  expect(reply.evidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'dataset.query',
        metadata: expect.objectContaining({
          filename: scenario.projectFixtures[0].subject + '.csv',
          hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          location: expect.any(Object),
        }),
      }),
    ])
  );
  expect(phases).not.toContain('understanding');
  expect(phases).not.toContain('dataset.turn');
  expect(reply.metadata.projectRouting).toMatchObject({
    bestProjectId: projectId,
    reason: 'selected',
    score: 1,
  });
});

test.each(['a', 'b'])(
  'paraphrased mixed %s answer retains actual catalog provenance',
  async (domain) => {
    const { scenario, projectId } = await setup(`project-${domain}-mixed`);
    const reply = await chat(scenario.turns[0].message);
    expect(reply.projectSelection?.projectId).toBe(projectId);
    expect(
      require('../scripts/practice-evaluation-checks')
        .checkTurn(scenario.turns[0], reply)
        .filter((check) => !check.passed)
    ).toEqual([]);
  }
);

test('unrelated and empty-tenant questions retain the same classification and answer', async () => {
  const question = 'Wie ist die Temperatur am Standort C?';
  const empty = await chat(question, 'empty');
  expect(phases).toContain('understanding');
  await setup('project-a-unrelated');
  phases.length = 0;
  const unrelated = await chat(question, 'unrelated');
  expect(phases).toContain('understanding');
  expect(unrelated.projectSelection).toBeUndefined();
  expect(unrelated.evidence || []).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ source: 'dataset.query' })])
  );
  expect(unrelated.responseText).toBe(empty.responseText);
  expect(empty.metadata.projectRouting.reason).toBe('no_candidates');
  expect(unrelated.metadata.projectRouting.reason).toBe('no_subject');
});

test('an object-referenced paraphrase resolves the actual source before reading', async () => {
  sourceKind = 'object';
  const { scenario, projectId } = await setup('project-a-implicit');
  const reply = await chat(scenario.turns[0].message);
  expect(reply.projectSelection.projectId).toBe(projectId);
  expect(reply.evidence[0].source).toBe('dataset.query');
});

test('priority project evidence wins over an existing memory answer', async () => {
  const { projectId } = await setup('project-a-implicit');
  const memoryStore = require('../src/tenant-memory-store');
  const { principal } = require('../src/domain-router-policy');
  const p = principal({ meta: meta() });
  const ctx = {
    meta: meta(),
    params: {},
    broker: h.broker,
    call: (name, params, options) =>
      h.broker.call(name, params, { ...options, meta: { ...meta(), ...options?.meta } }),
  };
  const anchor = { value: 'Standort Nord Leistung', qualifier: '', aliases: [] };
  await memoryStore.put(ctx, p, {
    id: 'fact-a',
    type: 'tenant_memory_fact',
    tenantId: p.tenantId,
    person: { actorId: p.actorId, displayName: 'Person A', functionLabel: '' },
    status: 'valid',
    checking: 'complete',
    at: '2026-10-16',
    text: 'Zu Standort Nord Leistung fehlt eine Datenquelle.',
    basis: 'Zu Standort Nord Leistung fehlt eine Datenquelle.',
    anchors: [anchor],
    anchorKeys: memoryStore.anchorKeys(anchor),
    relationIds: [],
  });
  const question = 'Was wissen wir zu Standort Nord Leistung?';
  const memory = await require('../src/tenant-memory').preturn(
    ctx,
    p,
    { userRequest: question },
    { queryOnly: true }
  );
  expect(memory.state).toBe('tenant_memory_query');
  expect(memory.statements).toHaveLength(1);
  const reply = await chat(question);
  expect(reply.projectSelection.projectId).toBe(projectId);
  expect(reply.evidence[0].source).toBe('dataset.query');
});

test('explicit pasted tables keep their dataset path even with matching project words', async () => {
  await setup('project-a-implicit');
  phases.length = 0;
  const reply = await chat(
    'Zeit,Leistung [kW]\n2025-01-01T00:00:00,37\n2025-01-01T01:00:00,39\nWie hoch war das Maximum der Leistung am Standort Nord 2025?'
  );
  expect(reply.projectSelection).toBeUndefined();
  expect(phases).toContain('dataset.turn');
  expect(phases).not.toContain('project-manifest.candidates');
});

test('wrong-project correction still blocks the next paraphrased turn', async () => {
  const { scenario } = await setup('project-a-implicit');
  expect((await chat(scenario.turns[0].message)).projectSelection).toBeDefined();
  expect((await chat('falsche Akte')).responseText).toContain('Korrektur ist gespeichert');
  const next = await chat(scenario.turns[0].message);
  expect(next.projectSelection).toBeUndefined();
  expect(next.metadata.projectRouting.reason).toBe('corrected');
});

test.each(['a', 'b'])(
  'paraphrased %s gap chooses the source and reports the missing period',
  async (domain) => {
    const { scenario, projectId } = await setup(`project-${domain}-gap`);
    phases.length = 0;
    const reply = await chat(scenario.turns[0].message);
    expect(reply.projectSelection.projectId).toBe(projectId);
    expect(reply.evidence).toEqual([]);
    expect(reply.gaps.join(' ')).toMatch(/2030.*fehlt/u);
    expect(reply.metadata.projectRouting).toMatchObject({
      score: 0.9,
      periodMatch: false,
      reason: 'selected',
    });
    expect(phases).not.toContain('understanding');
  }
);

test('forwarded document without projects preserves source citations and the original answer', async () => {
  const collected = [];
  h.broker.createService({
    name: 'personal-agent',
    actions: {
      collectWorkbenchEvidence: {
        visibility: 'protected',
        handler(ctx) {
          // Same serialization boundary as the shared-service HTTP e2e collector.
          collected.push(structuredClone({ params: ctx.params, meta: ctx.meta }));
          return {
            evidence: [
              {
                source: 'document-reference',
                value: `${ctx.params.situation.concern}: Referenzen und Eingangsbestätigung prüfen.`,
                metadata: { score: 0.92, documentTitle: 'Synthetischer Ablaufleitfaden' },
              },
            ],
            trace: [],
          };
        },
      },
    },
  });
  await h.broker.waitForServices('personal-agent');
  llm.generateStructured.mockImplementation(facade.generateStructured);
  const row = require('./fixtures/capability-routing-eval.json').cases.find(
    (entry) => entry.source === 'independent-regression'
  );
  const message = `Weitergeleitetes Dokument:\n${row.query}\nKannst du mir helfen?`;
  const actual = await chat(message, 'document-with-candidates');
  expect(actual.responseText).toContain('Quellen: Synthetischer Ablaufleitfaden');
  expect(actual.projectSelection).toBeUndefined();
  const getLocalService = h.broker.getLocalService.bind(h.broker);
  const lookup = jest
    .spyOn(h.broker, 'getLocalService')
    .mockImplementation((name) =>
      name === 'project-manifest' ? undefined : getLocalService(name)
    );
  let baseline;
  try {
    const baselineMeta = meta();
    baselineMeta.apiToken.tenantId = 'tenant-baseline';
    baseline = await h.call(
      'workbench.chat',
      {
        channel: 'api',
        conversationId: 'document-without-candidates',
        userRequest: message,
      },
      baselineMeta
    );
  } finally {
    lookup.mockRestore();
  }
  expect(actual.caseDisplayRef).toBe(baseline.caseDisplayRef);
  expect(actual.responseText).toBe(baseline.responseText);
  const sourceDetails = (sources) => sources.map(({ ms: _ms, ...source }) => source);
  expect(sourceDetails(actual.sources)).toEqual(sourceDetails(baseline.sources));
  expect(new Set(collected.map(({ meta: metadata }) => metadata.apiToken.tenantId))).toEqual(
    new Set(['tenant-a', 'tenant-baseline'])
  );
  for (const { meta: metadata } of collected) {
    expect(metadata).not.toHaveProperty('projectFileStore');
    expect(metadata).not.toHaveProperty('projectGraph');
    expect(metadata).not.toHaveProperty('projectManifest');
  }
});
