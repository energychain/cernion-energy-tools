'use strict';

jest.mock('../src/llm-client', () => ({
  generateStructured: jest.fn(),
  embeddings: jest.fn(),
  capabilities: jest.fn(() => ({ embeddings: true })),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PouchDB = require('pouchdb');
const { ProjectDatasetPool } = require('../src/project-dataset-pool');
const { WorkbenchStore } = require('../src/workbench-store');
const {
  validateProjectSkill,
  additionalInput,
  checkExpected,
} = require('../src/project-skill-validation');
const { parse, Budgets } = require('../src/cet-script');
const { projectSkills, save, validateSkillCorrection } = require('../src/project-skill-store');
const { correct, learnedSkillScope } = require('../src/workbench-project-skills');
const learning = require('../src/project-skill-learning');
const llm = require('../src/llm-client');
const id = 'ds_' + 'a'.repeat(32);
const columns = [
  { name: 'time', type: 'timestamp' },
  { name: 'value', type: 'number' },
];
const originalInput = { from: '2025-01-01', to: '2026-01-01' };
const manifest = {
  version: 1,
  timeRanges: [{ from: '2025-01-01', to: '2026-01-01' }],
  entities: [],
};
function source(
  body = `const data=cet.table('${id}'); const rows=await cet.sql\u0060SELECT SUM(\u0024{data.col('value')}) AS total FROM \u0024{data} WHERE \u0024{data.col('time')} >= \u0024{input.from} AND \u0024{data.col('time')} < \u0024{input.to}\u0060; return cet.result.table(rows);`
) {
  return `export const meta=${JSON.stringify({ id: 'sample', version: 1, language: 'cet-script/1', intent: 'Zeitraumsumme', inputs: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } }, outputs: { kind: 'table' } })}; export const tests=${JSON.stringify([{ input: originalInput, expect: { rows: 1, contains: [{ total: 30 }], tolerance: 1e-8 } }])}; export default async function skill(input,cet){${body}}`;
}
let directory, pool, db, store, service, ctx, record, graph, events, journal;
function skill() {
  return {
    skillId: 'sample',
    title: 'Zeitraumsumme',
    tenantId: 't1',
    projectId: 'p1',
    program: source(),
    lifecycle: 'draft',
    usage: { count: 0, corrections: 0 },
    asOf: '2025-01-01T00:00:00Z',
    baseline: { input: originalInput, expected: [{ total: 30 }], tolerance: 1e-8 },
  };
}
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-skills-'));
  pool = await ProjectDatasetPool.open(directory, 't1', 'p1');
  pool.putRows(
    't1',
    id,
    [
      { time: '2025-01-01', value: 10 },
      { time: '2025-02-01', value: 20 },
    ],
    columns
  );
  db = new PouchDB(path.join(directory, 'register'));
  store = new WorkbenchStore({ conversationsDb: db });
  service = {
    store,
    settings: { projectSkills: { delayMs: 2 ** 31 - 1 } },
    logger: { warn: jest.fn() },
  };
  record = {
    id,
    tenantId: 't1',
    title: 'data',
    version: 1,
    hash: 'h1',
    provenance: { projectId: 'p1', objectId: 'o1' },
    columns,
    semantic: { timeField: 'time', timezone: 'Europe/Berlin', units: { value: 'kg' } },
  };
  graph = [
    {
      tenantId: 't1',
      projectId: 'p1',
      recordType: 'node',
      nodeId: 'n1',
      kind: 'dataset',
      ref: id,
      labels: ['data'],
      attributes: {},
    },
  ];
  events = [];
  journal = [];
  ctx = {
    meta: { apiToken: { id: 'u1', tenantId: 't1', roles: ['ROLE_ALPHA'], scope: 'read-only' } },
    params: { conversationId: 'c1' },
    broker: {
      emit: async (name, data) => events.push({ name, data }),
      getLocalService: (name) =>
        name === 'workbench'
          ? service
          : name === 'project-upload'
            ? { basePath: () => directory }
            : name === 'journal'
              ? {}
              : null,
    },
  };
  ctx.call = jest.fn(async (name, params) => {
    if (name === 'project-file.get') {
      if (
        params.projectId !== 'p1' ||
        ctx.meta.apiToken.tenantId !== 't1' ||
        ctx.meta.apiToken.id !== 'u1'
      )
        throw new Error('Project invisible');
      return { tenantId: 't1', projectId: 'p1', lifecycle: 'ready' };
    }
    if (name === 'project-file.ingestMutation') return params.work();
    if (name === 'datapoint.datasetCatalog') return [record];
    if (name === 'object-store.projectGraphRecord') return graph;
    if (name === 'knowledge-rag.documentList') return [];
    if (name === 'project-manifest.get') return manifest;
    if (name === 'journal.append') {
      journal.push(params);
      return params;
    }
    throw new Error(`Unexpected ${name}`);
  });
});
afterEach(async () => {
  await learning.stop(service);
  for (const connection of pool.connections.values()) connection.close();
  await db.destroy();
  fs.rmSync(directory, { recursive: true, force: true });
});
test('automatic chain compares original rows, runs script tests and derives independent manifest input', async () => {
  const validation = await validateProjectSkill(ctx, skill(), manifest);
  expect(validation.checks.map((check) => check.kind)).toEqual([
    'static',
    'original',
    'replay',
    'script',
    'additional',
    'container_readonly',
    'budgets',
  ]);
  expect(validation.replayHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(validation.additionalInput).not.toEqual(originalInput);
  const active = await save(
    ctx,
    { ...skill(), validation, lifecycle: 'active' },
    'decided',
    'automatic_validation_passed'
  );
  expect((await projectSkills(ctx, 'p1'))[0].lifecycle).toBe('active');
  expect(await store.listPlaybooks({ tenantId: 't1' })).toEqual([]);
  expect(journal[0].kind).toBe('decided');
  expect(events[0].data).toMatchObject({
    tenantId: 't1',
    projectId: 'p1',
    skillId: 'sample',
    lifecycle: 'active',
  });
  expect((await store.getSkill({ tenantId: 't1', skillId: active.skillId })).program).toBe(
    source()
  );
});
test.each([
  ['wrong result', 'return cet.result.table([{total:31}]);'],
  [
    'foreign table',
    "const data=cet.table('foreign');return cet.result.table(await cet.sql\u0060SELECT * FROM \u0024{data}\u0060);",
  ],
  [
    'write',
    `const data=cet.table('${id}');return cet.result.table(await cet.sql\u0060DELETE FROM \u0024{data}\u0060);`,
  ],
  [
    'derived write',
    "await cet.derived.put('x',1,{describes:['n1']});return cet.result.table([{total:30}]);",
  ],
  ['loop budget', 'while(true){} return cet.result.table([]);'],
  ['operation write', "return cet.result.table(await cet.op('files-upload',{}));"],
])('%s cannot pass automatic validation', async (_name, body) => {
  await expect(
    validateProjectSkill(ctx, { ...skill(), program: source(body) }, manifest)
  ).rejects.toThrow();
  expect(await projectSkills(ctx, 'p1')).toEqual([]);
  expect(pool.db).toBeUndefined();
});
test('no independent manifest case fails closed and all replays share one source snapshot', async () => {
  await expect(validateProjectSkill(ctx, skill(), { ...manifest, timeRanges: [] })).rejects.toThrow(
    'independent'
  );
  let calls = 0;
  const call = ctx.call.getMockImplementation();
  ctx.call.mockImplementation(async (name, params) => {
    if (name === 'datapoint.datasetCatalog') return [{ ...record, version: ++calls }];
    return call(name, params);
  });
  expect(
    (await validateProjectSkill(ctx, skill(), manifest)).checks.every((check) => check.passed)
  ).toBe(true);
  expect(calls).toBe(1);
});
test('changed data degrades an active skill and correction retires it with journal history', async () => {
  const validation = await validateProjectSkill(ctx, skill(), manifest);
  await save(
    ctx,
    { ...skill(), lifecycle: 'active', validation },
    'created',
    'repeated_evidenced_question'
  );
  pool
    .tenant('t1')
    .prepare('UPDATE \"' + id + '\" SET c1=99')
    .run();
  await learning.revalidate(ctx, 'p1');
  expect((await projectSkills(ctx, 'p1'))[0].lifecycle).toBe('degraded');
  ctx.params = {
    tenantId: 't1',
    actorId: 'u1',
    correctionId: 'correction-1',
    correction: { projectId: 'p1', skillId: 'sample', kind: 'retire' },
  };
  await correct(service, ctx);
  await correct(service, ctx);
  const row = (await projectSkills(ctx, 'p1'))[0];
  expect(row.lifecycle).toBe('retired');
  expect(row.usage.corrections).toBe(1);
  expect(journal.map((entry) => entry.kind)).toEqual([
    'created',
    'decided',
    'corrected',
    'retired',
  ]);
});
test('incorrect result correction degrades and schedules bounded redesign', async () => {
  await save(ctx, { ...skill(), lifecycle: 'active' }, 'created', 'repeated_evidenced_question');
  ctx.params = {
    tenantId: 't1',
    actorId: 'u1',
    correctionId: 'correction-2',
    correction: { projectId: 'p1', skillId: 'sample', kind: 'incorrect' },
  };
  await correct(service, ctx);
  expect((await projectSkills(ctx, 'p1'))[0].lifecycle).toBe('degraded');
  expect(service.projectSkillWorker.pending.size).toBe(1);
});
test.each(['tenant', 'actor', 'project'])(
  '%s boundary applies before reading registry or executing program',
  async (kind) => {
    await save(ctx, skill(), 'created', 'manifest_without_skill');
    if (kind === 'tenant') ctx.meta.apiToken.tenantId = 't2';
    if (kind === 'actor') ctx.meta.apiToken.id = 'other';
    await expect(projectSkills(ctx, kind === 'project' ? 'p2' : 'p1')).rejects.toThrow();
  }
);
test('embeddings are required for recurrence and similarity threshold is respected', async () => {
  const observations = [{ question: 'q1' }, { question: 'q2' }];
  llm.capabilities.mockReturnValue({ embeddings: false });
  expect(await learning.similar(ctx, observations, 0.9)).toBe(false);
  llm.capabilities.mockReturnValue({ embeddings: true });
  llm.embeddings.mockResolvedValue([
    [1, 0],
    [0, 1],
  ]);
  expect(await learning.similar(ctx, observations, 0.9)).toBe(false);
  llm.embeddings.mockResolvedValue([
    [1, 0],
    [0.99, 0.01],
  ]);
  expect(await learning.similar(ctx, observations, 0.9)).toBe(true);
  llm.embeddings.mockRejectedValue(new Error('missing'));
  expect(await learning.similar(ctx, observations, 0.9)).toBe(false);
});
test('test expectations implement tolerance, columns, contained values, rows, gap and expected errors', () => {
  const output = { result: { rows: [{ a: 2.00001 }], value: 2.00001 }, log: [] };
  checkExpected(output, {
    rows: 1,
    columns: ['a'],
    contains: [{ a: 2 }],
    value: 2,
    tolerance: 0.0001,
    gap: false,
  });
  for (const expect of [
    { rows: 2 },
    { columns: ['b'] },
    { value: 9 },
    { contains: [{ a: 9 }] },
    { gap: true },
    { error: 'CET_SCRIPT_RUNTIME_ERROR' },
  ])
    expectFailure(output, expect);
});
function expectFailure(output, expected) {
  expect(() => checkExpected(output, expected)).toThrow();
}
test('additional entity inputs and structural learned-skill state query are metadata-driven', () => {
  const module = parse(source(), new Budgets());
  expect(() => additionalInput(module, originalInput, { timeRanges: [], entities: [] })).toThrow();
  expect(learnedSkillScope('Welche Skills hast du für Projekt X gelernt?')).toEqual({
    projectSkills: true,
    target: 'X',
  });
  expect(learnedSkillScope('Welche Werte hat Projekt X?')).toBeNull();
  expect(() =>
    validateSkillCorrection({
      projectId: 'p1',
      skillId: 'sample',
      kind: 'transfer',
      destinationProjectId: 'p1',
    })
  ).toThrow();
});

test('queued jobs coalesce, keep a detached principal and cap pending project work', () => {
  learning.enqueue(service, ctx, {
    key: 'p1',
    projectId: 'p1',
    observations: [{ question: 'q1' }],
  });
  learning.enqueue(service, ctx, {
    key: 'p1',
    projectId: 'p1',
    observations: [{ question: 'q2' }],
  });
  const state = service.projectSkillWorker;
  expect(state.pending.get('p1').observations.map((item) => item.question)).toEqual(['q1', 'q2']);
  expect(state.pending.get('p1').ctx.params).toEqual({ conversationId: 'c1' });
  expect(Object.getPrototypeOf(state.pending.get('p1').ctx)).toBe(Object.prototype);
  for (let i = 2; i < 80; i++)
    learning.enqueue(service, ctx, { key: `p${i}`, projectId: `p${i}`, observations: [] });
  expect(state.pending.size).toBe(64);
});
test('persisted hourly draft quotas bound both project and tenant work', async () => {
  service.settings.projectSkills.draftsPerProject = 1;
  service.settings.projectSkills.draftsPerTenant = 2;
  expect(await learning.withinDraftBudget(service, ctx, 'p1')).toBe(true);
  await save(
    ctx,
    { ...skill(), createdAt: new Date().toISOString() },
    'created',
    'manifest_without_skill'
  );
  expect(await learning.withinDraftBudget(service, ctx, 'p1')).toBe(false);
  expect(await learning.withinDraftBudget(service, ctx, 'p2')).toBe(true);
  service.settings.projectSkills.draftsPerTenant = 1;
  expect(await learning.withinDraftBudget(service, ctx, 'p2')).toBe(false);
});
test('concurrent retirement cannot be overwritten and manual governance cannot activate a learned draft', async () => {
  const original = await save(ctx, skill(), 'created', 'manifest_without_skill');
  await save(ctx, { ...original, lifecycle: 'retired' }, 'retired', 'user_retired');
  await expect(
    save(ctx, { ...original, lifecycle: 'active' }, 'decided', 'automatic_validation_passed')
  ).rejects.toMatchObject({ code: 409 });
  await expect(
    store.transitionSkillStatus({
      tenantId: 't1',
      skillId: original.skillId,
      actorId: 'u1',
      actorRoles: ['ROLE_ADMIN'],
      transition: 'activated',
      fromStatuses: ['retired'],
      toStatus: 'active',
    })
  ).rejects.toMatchObject({ code: 409 });
  expect((await projectSkills(ctx, 'p1'))[0].lifecycle).toBe('retired');
});
test('a failed journal append prevents activation without reviving a corrected lifecycle', async () => {
  const original = await save(ctx, skill(), 'created', 'manifest_without_skill');
  const call = ctx.call.getMockImplementation();
  ctx.call.mockImplementation(async (name, params) => {
    if (name === 'journal.append') throw new Error('offline');
    return call(name, params);
  });
  await expect(
    save(ctx, { ...original, lifecycle: 'active' }, 'decided', 'automatic_validation_passed')
  ).rejects.toThrow('offline');
  expect((await projectSkills(ctx, 'p1'))[0].lifecycle).toBe('draft');
});

test('retirement also stops descendant drafts and invalidates in-flight work in the same project', async () => {
  const parent = await save(
    ctx,
    { ...skill(), lifecycle: 'degraded' },
    'created',
    'repeated_evidenced_question'
  );
  await save(
    ctx,
    { ...skill(), skillId: 'child', lifecycle: 'draft', derivedFrom: [parent.skillId] },
    'created',
    'degraded_skill'
  );
  ctx.params = {
    tenantId: 't1',
    actorId: 'u1',
    correctionId: 'retire-family',
    correction: { projectId: 'p1', skillId: parent.skillId, kind: 'retire' },
  };
  await correct(service, ctx);
  expect((await projectSkills(ctx, 'p1')).every((row) => row.lifecycle === 'retired')).toBe(true);
  expect(service.projectSkillWorker.versions.get(JSON.stringify(['t1', 'p1']))).toBe(1);
});
test('invalidation history cannot evict the currently executing project epoch', () => {
  const state = learning.stateFor(service);
  state.activeKey = JSON.stringify(['t1', 'p1']);
  learning.invalidate(service, ctx, 'p1');
  for (let index = 0; index < 150; index++) learning.invalidate(service, ctx, `other-${index}`);
  expect(state.versions.size).toBe(128);
  expect(state.versions.get(state.activeKey)).toBe(1);
});

test('an auxiliary count result cannot substitute for the numeric answer shown to the user', () => {
  expect(
    learning.supportsOriginalAnswer({
      result: [{ rows: 2 }],
      responseText:
        'Der höchste Wert beträgt 23 kg am 2025-01-01T01:00:00.\n\nHerkunft: Messreihe, Version 1.',
    })
  ).toBe(false);
  expect(
    learning.supportsOriginalAnswer({
      result: [{ maximum: 23 }],
      responseText:
        'Der höchste Wert beträgt 23 kg am 2025-01-01T01:00:00.\n\nHerkunft: Messreihe, Version 1.',
    })
  ).toBe(true);
});
