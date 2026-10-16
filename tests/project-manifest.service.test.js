'use strict';

jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
  generateStructured: jest.fn(),
  generateText: jest.fn(),
  generateChat: jest.fn(),
}));
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { harness, auth } = require('./helpers/project-ingest');
const { addObject } = require('./helpers/project-structure');
const llm = require('../src/llm-client');
const manifestPolicy = require('../src/project-manifest');
let h, dir, env;

function manifestStub(_schema, prompt) {
  if (!prompt.includes('Projektmanifest-Kandidaten')) return undefined;
  const input = JSON.parse(prompt);
  const sources = input.nodes.filter((node) => node.kind === 'dataset').map((node) => node.nodeId);
  return {
    summary: { text: input.title, sources },
    entities: [
      input.title,
      ...input.nodes
        .filter((node) => node.kind === 'dataset')
        .flatMap((node) => node.titles.map((title) => title.replace(/\.csv$/u, ''))),
    ].map((name) => ({ name, kind: 'subject', sources })),
    timeRanges: [],
    questionTypes: [
      {
        id: 'maximum',
        description: `Maximum ${input.datasets[0]?.columns.find((column) => column.type === 'number')?.name || 'Leistung'} ${input.nodes.find((node) => node.kind === 'dataset')?.titles[0]?.replace(/\.csv$/u, '') || input.title}`,
        inputs: [],
        skillRefs: [],
        sources,
      },
    ],
    externalLinks: [],
  };
}
beforeEach(async () => {
  env = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-manifest-887-'));
  process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'chat');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  llm.generateStructured.mockReset().mockImplementation(manifestStub);
  h = await harness(dir, {}, async (broker) => {
    const workbench = require('../services/workbench.service');
    broker.createService({
      ...workbench,
      settings: require('../scripts/workbench-live-harness').isolatedSettings(workbench, dir),
    });
    for (const name of [
      'datapoint',
      'dataset',
      'knowledge-rag',
      'project-structure',
      'project-graph',
      'project-manifest',
      'shared-service-learning',
    ]) {
      const schema = require(`../services/${name}.service`);
      broker.createService({
        ...schema,
        settings: {
          ...schema.settings,
          dbPath: path.join(dir, name),
          ...(name === 'project-graph' ? { catalog: [], operations: [], domains: [] } : {}),
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
async function settled() {
  for (const name of ['project-graph', 'project-manifest']) {
    const service = h.broker.getLocalService(name);
    await Promise.all(
      [...(service.graphRuns?.values() || service.runs?.values() || [])].map((run) => run.promise)
    );
  }
}
async function populate(meta = auth(), title = 'Standort Nord') {
  const project = await h.call('project-file.create', { title }, meta);
  await addObject(
    h,
    project.projectId,
    Buffer.from('Zeit,Leistung [kW]\n2025-01-01T00:00:00,17\n2025-01-01T01:00:00,23\n'),
    'values.csv',
    meta
  );
  await settled();
  return project.projectId;
}
const run = (projectId, meta = auth()) =>
  h.broker.call(
    'project-manifest.run',
    { projectId },
    { meta: { ...meta, projectManifest: manifestPolicy.capability }, timeout: 0 }
  );

test('AC-01/02/06: graph event generates a manifest; unmentioned project answers from actual project SQLite with provenance', async () => {
  const projectId = await populate();
  const manifest = await h.call('project-manifest.get', { projectId });
  expect(manifest).toMatchObject({ projectId, version: 1 });
  const ctx = {
    broker: h.broker,
    meta: auth(),
    call: (name, params, options) => h.broker.call(name, params, { ...options, meta: auth() }),
  };
  const result = await require('../src/project-manifest-evidence').projectManifestAnswer(
    ctx,
    'Wie hoch war das Maximum Leistung am Standort Nord 2025?'
  );
  expect(result.responseText).toContain(
    'Ich habe dafür die Projektakte „Standort Nord“ herangezogen.'
  );
  expect(result.responseText).toContain('23');
  expect(result.responseText).toMatch(/Datei: values.csv; Fundstelle:.*Hash: [a-f0-9]{64}/u);
  expect(result.evidence[0].source).toBe('dataset.query');
  expect(await run(projectId)).toEqual({ unchanged: true });
  const prompts = llm.generateStructured.mock.calls.filter(([, prompt]) =>
    prompt.includes('Projektmanifest-Kandidaten')
  );
  expect(prompts).toHaveLength(1);
  expect(prompts[0][1]).not.toContain('2025-01-01T01:00:00,23');
});

test('AC-04: unavailable year becomes a concrete gap without a guessed result', async () => {
  await populate();
  const ctx = { broker: h.broker, meta: auth(), call: (name, params) => h.call(name, params) };
  const result = await require('../src/project-manifest-evidence').projectManifestAnswer(
    ctx,
    'Maximum Leistung Standort Nord 2030?'
  );
  expect(result.evidence).toEqual([]);
  expect(result.gaps.join(' ')).toMatch(/2030.*fehlt/u);
  expect(result.responseText).not.toContain('23');
});

test('AC-05: other tenant, missing clearance, missing membership, ingesting, archive and deletion never appear', async () => {
  const projectId = await populate(auth('tenant-a', ['restricted']));
  await h.call(
    'project-file.update',
    { projectId, members: ['actor-a'] },
    auth('tenant-a', ['restricted'])
  );
  // Component clearance is updated using the existing workflow, with no gateway role exceptions.
  await h.broker.call(
    'project-file.registerComponent',
    {
      projectId,
      componentId: 'visibility-test',
      sensitivityLevel: 'restricted',
      cleanupAction: 'project-manifest.deleteProject',
    },
    { meta: auth('tenant-a', ['restricted']) }
  );
  for (const meta of [
    auth('tenant-b', ['restricted']),
    auth(),
    auth('tenant-a', ['restricted'], 'actor-b'),
  ]) {
    expect(await h.call('project-manifest.candidates', {}, meta)).toEqual([]);
    await expect(h.call('project-manifest.get', { projectId }, meta)).rejects.toMatchObject({
      code: 404,
    });
  }
  expect(
    await h.call('project-manifest.candidates', {}, auth('tenant-a', ['restricted']))
  ).toHaveLength(1);
  await h.call(
    'project-file.setLifecycle',
    { projectId, lifecycle: 'ingesting' },
    auth('tenant-a', ['restricted'])
  );
  expect(await h.call('project-manifest.candidates', {}, auth('tenant-a', ['restricted']))).toEqual(
    []
  );
  await h.call(
    'project-file.setLifecycle',
    { projectId, lifecycle: 'ready' },
    auth('tenant-a', ['restricted'])
  );
  await h.call('project-file.archive', { projectId }, auth('tenant-a', ['restricted']));
  expect(await h.call('project-manifest.candidates', {}, auth('tenant-a', ['restricted']))).toEqual(
    []
  );
});

test('wrong-project correction persists through the learning loop and affects the next actor turn only', async () => {
  const projectId = await populate();
  await h.call('shared-service-learning.apply', {
    target: 'projectManifest',
    correctionId: 'wrong-project',
    correction: { projectId, kind: 'reject' },
  });
  const select = require('../src/dataset-routing').selectProjectCandidates;
  expect(
    select(await h.call('project-manifest.candidates', {}), 'Maximum Leistung Standort Nord?')
  ).toEqual([]);
  expect(
    select(
      await h.call('project-manifest.candidates', {}, auth('tenant-a', [], 'actor-b')),
      'Maximum Leistung Standort Nord?'
    )
  ).toHaveLength(1);
  const admin = auth();
  admin.apiToken.roles.push('ROLE_TENANT_ADMIN');
  expect(await h.call('shared-service-learning.list', {}, admin)).toEqual(
    expect.arrayContaining([expect.objectContaining({ target: 'projectManifest', pending: false })])
  );
  await h.call('shared-service-learning.apply', {
    target: 'projectManifest',
    correction: { projectId, kind: 'confirm' },
  });
  expect(
    select(await h.call('project-manifest.candidates', {}), 'Maximum Leistung Standort Nord?')
  ).toHaveLength(1);
});

test('version changes coalesce and acknowledged deletion removes every manifest version/correction', async () => {
  const projectId = await populate();
  await addObject(
    h,
    projectId,
    Buffer.from('Zeit,Leistung [kW]\n2025-01-01T00:00:00,31\n'),
    'second.csv'
  );
  await settled();
  expect((await h.call('project-manifest.get', { projectId })).version).toBe(2);
  await Promise.all(Array.from({ length: 4 }, () => run(projectId)));
  expect(
    llm.generateStructured.mock.calls.filter(([, prompt]) =>
      prompt.includes('Projektmanifest-Kandidaten')
    )
  ).toHaveLength(2);
  await h.call('project-file.delete', { projectId });
  const records = await h.broker.call(
    'object-store.projectManifestRecord',
    { operation: 'list', projectId },
    { meta: { ...auth(), projectManifest: manifestPolicy.capability } }
  );
  expect(records).toEqual([]);
});

test('empty tenant and irrelevant questions leave the original routing path untouched', async () => {
  const ctx = {
    broker: h.broker,
    meta: auth(),
    call: jest.fn((name, params) => h.call(name, params)),
  };
  const { projectManifestAnswer } = require('../src/project-manifest-evidence');
  expect(await projectManifestAnswer(ctx, 'Maximum Leistung Standort Nord?')).toBeNull();
  expect(ctx.call.mock.calls.map(([name]) => name)).toEqual(['project-manifest.candidates']);
  await populate();
  ctx.call.mockClear();
  expect(await projectManifestAnswer(ctx, 'Wie ist die Temperatur im Depot West?')).toBeNull();
  expect(ctx.call).not.toHaveBeenCalledWith('dataset.query', expect.anything());
});

test('real workbench chat makes implicit selection visible and wrong-project correction works in the next turn', async () => {
  const projectId = await populate();
  const chat = (userRequest) =>
    h.call('workbench.chat', { channel: 'api', conversationId: 'manifest-chat', userRequest });
  expect((await chat('Maximum Leistung Standort Nord 2025?')).projectSelection.projectId).toBe(
    projectId
  );
  expect((await chat('falsche Akte')).responseText).toContain('Korrektur ist gespeichert');
  const nextTurn = await chat('Maximum Leistung Standort Nord 2025?');
  expect(nextTurn.projectSelection).toBeUndefined();
  expect(nextTurn.evidence || []).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ projectId }) }),
    ])
  );
  expect(nextTurn.responseText).not.toContain('23 kW');
  const candidates = await h.call('project-manifest.candidates', {});
  expect(
    require('../src/dataset-routing').selectProjectCandidates(
      candidates,
      'Maximum Leistung Standort Nord 2025?'
    )
  ).toEqual([]);
});

test.each(['a', 'b'])(
  'generated practice fixtures execute genuine ingestion, graph linking and separated read evidence (%s)',
  async (domain) => {
    const fixtures = require('../scripts/generate-project-manifest-fixtures');
    const schema = fixtures.referenceService;
    h.broker.createService(schema);
    for (const name of ['project-graph', 'project-manifest'])
      Object.assign(h.broker.getLocalService(name).settings, {
        catalog: fixtures.referenceCatalog,
        operations: [fixtures.referenceOperation],
        domains: [],
      });
    const scenario = require('../scripts/generate-practice-evaluation-fixtures')
      .generatePracticeCatalog()
      .scenarios.find((item) => item.id === `project-${domain}-mixed`);
    const meta = auth();
    meta.apiToken.scope = 'full-access';
    const state = {};
    await fixtures.prepareProjectFixtures({ broker: h.broker }, state, scenario, meta);
    const reply = await h.call(
      'workbench.chat',
      { channel: 'api', conversationId: 'fixture-chat', userRequest: scenario.turns[0].message },
      meta
    );
    expect(reply.responseText).toContain(`Aus Katalog ${domain.toUpperCase()}:`);
    expect(reply.responseText).toContain(String(scenario.projectFixtures[0].value));
    const checks = require('../scripts/practice-evaluation-checks').checkTurn(
      scenario.turns[0],
      reply
    );
    expect(checks.filter((item) => !item.passed)).toEqual([]);
    await h.call('project-file.delete', { projectId: state.projects[0] }, meta);
  }
);

test('failed generation publishes a current degraded minimum; recovery avoids duplicate generation', async () => {
  const projectId = await populate();
  llm.generateStructured.mockImplementation((schema, prompt) =>
    prompt.includes('Projektmanifest-Kandidaten') ? {} : manifestStub(schema, prompt)
  );
  await addObject(
    h,
    projectId,
    Buffer.from('Zeit,Leistung [kW]\n2025-01-01T00:00:00,37\n'),
    'replacement.csv'
  );
  await settled();
  const minimum = await h.call('project-manifest.get', { projectId });
  expect(minimum.version).toBe(2);
  expect(minimum.questionTypes.length).toBeGreaterThan(0);
  const candidate = (await h.call('project-manifest.candidates', {})).find(
    (item) => item.projectId === projectId
  );
  expect(candidate.generation).toMatchObject({ status: 'degraded', fallback: true, attempts: 2 });
  expect(minimum).not.toHaveProperty('generation');
  llm.generateStructured.mockImplementation(manifestStub);
  await run(projectId);
  expect((await h.call('project-manifest.get', { projectId })).version).toBe(2);
  const count = llm.generateStructured.mock.calls.length;
  await h.broker.getLocalService('project-manifest').recover();
  expect(llm.generateStructured.mock.calls).toHaveLength(count);
});

test('generation releases the mutation lock; archive during an outstanding LLM call prevents publication', async () => {
  const projectId = await populate();
  let release, entered;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  llm.generateStructured.mockImplementation(async (schema, prompt) => {
    if (!prompt.includes('Projektmanifest-Kandidaten')) return manifestStub(schema, prompt);
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return manifestStub(schema, prompt);
  });
  await addObject(
    h,
    projectId,
    Buffer.from('Zeit,Leistung [kW]\n2025-01-01T00:00:00,37\n'),
    'later.csv'
  );
  await enteredPromise;
  const pending = Promise.allSettled(
    [...(h.broker.getLocalService('project-manifest').runs?.values() || [])].map(
      (run) => run.promise
    )
  );
  try {
    await h.call('project-file.archive', { projectId });
  } finally {
    release();
  }
  await pending;
  expect(await h.call('project-manifest.candidates', {})).toEqual([]);
  const stored = await h.broker.call(
    'object-store.projectManifestRecord',
    { operation: 'list', projectId },
    { meta: { ...auth(), projectManifest: manifestPolicy.capability } }
  );
  expect(stored.filter((row) => row.key.startsWith('version:'))).toHaveLength(1);
});

test('deletion-incomplete and empty projects are not routing candidates; cleanup is repeatable', async () => {
  const empty = await h.create();
  expect(await h.call('project-manifest.candidates', {})).toEqual([]);
  await expect(h.call('project-manifest.get', { projectId: empty })).rejects.toMatchObject({
    code: 404,
  });
  const projectId = await populate();
  h.broker.createService({
    name: 'cleanup-blocker',
    actions: {
      remove: () => {
        throw new Error('try later');
      },
    },
  });
  await h.call('project-file.registerComponent', {
    projectId,
    componentId: 'blocker',
    sensitivityLevel: 'tenant_internal',
    cleanupAction: 'cleanup-blocker.remove',
  });
  await expect(h.call('project-file.delete', { projectId })).rejects.toThrow();
  expect(await h.call('project-manifest.candidates', {})).toEqual([]);
  await h.broker.call(
    'project-manifest.deleteProject',
    { projectId, tenantId: 'tenant-a', version: 1 },
    {
      meta: {
        ...auth(),
        projectFileOriginals: require('../src/project-file-policy').fileCapability,
      },
    }
  );
});

test('unexpected generation exception is contained by the service and persists a selectable minimum', async () => {
  jest
    .spyOn(manifestPolicy, 'generateManifest')
    .mockRejectedValue(new Error('Unknown project manifest source node'));
  const projectId = await populate();
  const candidate = (await h.call('project-manifest.candidates', {})).find(
    (item) => item.projectId === projectId
  );
  expect(candidate.generation).toMatchObject({
    status: 'degraded',
    fallback: true,
    reason: 'generation_failed',
  });
  expect(
    (await h.call('project-manifest.get', { projectId })).questionTypes.length
  ).toBeGreaterThan(0);
  expect(await run(projectId)).toEqual({ unchanged: true });
});

test('practice preparation continues after invalid LLM references and records degraded cause', async () => {
  llm.generateStructured.mockImplementation((schema, prompt) => {
    const result = manifestStub(schema, prompt);
    if (result)
      for (const item of [result.summary, ...result.entities, ...result.questionTypes])
        item.sources = ['invented'];
    return result;
  });
  const fixtures = require('../scripts/generate-project-manifest-fixtures');
  const scenario = require('../scripts/generate-practice-evaluation-fixtures')
    .generatePracticeCatalog()
    .scenarios.find((item) => item.id === 'project-a-implicit');
  const state = {};
  await fixtures.prepareProjectFixtures({ broker: h.broker }, state, scenario, auth());
  expect(state.projectPreparation).toEqual([
    expect.objectContaining({
      status: 'degraded',
      fallback: true,
      reason: 'insufficient_claims',
      discardedReferences: expect.any(Number),
    }),
  ]);
  expect(
    (await h.call('project-manifest.get', { projectId: state.projects[0] })).questionTypes.length
  ).toBeGreaterThan(0);
});

test.each([false, true])(
  'candidate reads preserve parent metadata (populated: %s)',
  async (populated) => {
    if (populated) await populate();
    h.broker.createService({
      name: 'candidate-parent',
      actions: {
        async read(ctx) {
          const before = structuredClone(ctx.meta);
          const candidates = await ctx.call('project-manifest.candidates', {});
          expect(candidates).toHaveLength(populated ? 1 : 0);
          expect(ctx.meta).toEqual(before);
          return structuredClone(ctx.meta);
        },
      },
    });
    await h.broker.waitForServices('candidate-parent');
    expect(await h.call('candidate-parent.read', {})).toEqual(auth());
  }
);
