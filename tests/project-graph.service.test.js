'use strict';
jest.mock('../src/llm-client', () => ({
  embeddings: jest.fn(async (texts) => texts.map(() => [1, 0])),
  capabilities: jest.fn(() => ({ embeddings: true })),
  generateStructured: jest.fn(async (_schema, prompt) =>
    prompt.includes('assertions=[]')
      ? {
          assertions: [],
          correction: { kind: 'none', basis: '', factId: '' },
          query: { requested: false, anchor: '', functionLabel: '' },
        }
      : undefined
  ),
  generateText: jest.fn(),
}));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { harness, auth } = require('./helpers/project-ingest');
const { addObject } = require('./helpers/project-structure');
const policy = require('../src/project-graph-policy');
const { fileCapability } = require('../src/project-file-policy');
const { openGraphSource } = require('../src/project-graph-sqlite');
let h, dir, env;
beforeEach(async () => {
  env = { ...process.env };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-graph-886-'));
  process.env.JOB_STORE_DIR = path.join(dir, 'jobs');
  process.env.WORKBENCH_DATASET_DB_PATH = path.join(dir, 'chat');
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  h = await boot();
});
async function boot() {
  return harness(dir, {}, async (broker) => {
    broker.createService({
      ...require('../services/datapoint.service'),
      settings: { dbPath: path.join(dir, 'datapoints') },
    });
    broker.createService(require('../services/dataset.service'));
    broker.createService(require('../services/knowledge-rag.service'));
    broker.createService(require('../services/project-structure.service'));
    broker.createService({
      ...require('../services/project-graph.service'),
      settings: { catalog: [], operations: [], domains: [] },
    });
    broker.createService({
      ...require('../services/shared-service-learning.service'),
      settings: { dbPath: path.join(dir, 'learning') },
    });
  });
}
afterEach(async () => {
  if (h) await h.broker.stop();
  h = null;
  fs.rmSync(dir, { recursive: true, force: true });
  process.env = env;
  jest.restoreAllMocks();
});
const internal = (action, params, meta = auth()) =>
  h.broker.call(action, params, { meta: { ...meta, projectGraph: policy.capability }, timeout: 0 });
const records = (projectId) =>
  internal('object-store.projectGraphRecord', { operation: 'list', projectId });
async function populate(projectId, meta = auth()) {
  const a = await addObject(
    h,
    projectId,
    Buffer.from('Token,Ordinal\nLumen-A7,1\nLumen-B8,2\n'),
    'a.csv',
    meta
  );
  const b = await addObject(
    h,
    projectId,
    Buffer.from('Token,Value\nLumen-A7,7\nLumen-B8,8\n'),
    'b.csv',
    meta
  );
  return { a, b };
}
test('incremental ingest, idempotent recovery, bounded reading and acknowledged cleanup', async () => {
  const projectId = await h.create();
  await populate(projectId);
  const docs = await records(projectId);
  expect(docs.filter((doc) => doc.recordType === 'node').length).toBeGreaterThan(3);
  const edge = docs.find((doc) => doc.relation === 'joinsOn');
  expect(edge).toBeDefined();
  const event = jest.spyOn(h.broker, 'emit');
  expect(await internal('project-graph.run', { projectId })).toMatchObject({ unchanged: true });
  expect(event).not.toHaveBeenCalledWith('project.graph.changed.v1', expect.anything());
  const get = await h.call('project-graph.nodes', { projectId, kind: 'dataset', label: 'a.csv' });
  expect(get.nodes).toHaveLength(1);
  const neighborhood = await h.call('project-graph.neighbors', {
    projectId,
    nodeId: edge.from,
    relation: 'joinsOn',
    depth: 3,
  });
  expect(neighborhood.edges.map((row) => row.edgeId)).toContain(edge.edgeId);
  const resolved = await h.call('project-graph.resolve', {
    projectId,
    nodeId: edge.from,
    depth: 3,
  });
  expect(resolved.nodes).toHaveLength(2);
  expect(resolved.nodes.some((row) => row.attributes.columns)).toBe(true);
  expect(
    (await h.call('project-graph.neighbors', { projectId, nodeId: edge.from, depth: 3, limit: 1 }))
      .truncated
  ).toBe(true);
  await expect(
    h.call('project-graph.neighbors', { projectId, nodeId: edge.from, depth: 4 })
  ).rejects.toThrow();
  await expect(
    h.call('project-graph.resolve', { projectId, nodeId: 'missing' })
  ).rejects.toMatchObject({ code: 404 });
  const current = await h.call('project-file.get', { projectId });
  expect(current.stats.nodes).toBe(docs.filter((doc) => doc.recordType === 'node').length);
  const db = await openGraphSource(h.upload.basePath(), 'tenant-a', projectId);
  expect(() => db.exec('CREATE TABLE forbidden (x TEXT)')).toThrow();
  db.close();
  await h.broker.getLocalService('project-graph').recover();
  expect((await records(projectId)).map((doc) => [doc._id, doc._rev])).toEqual(
    docs.map((doc) => [doc._id, doc._rev])
  );
  await h.call('project-file.delete', { projectId });
  expect(await records(projectId)).toEqual([]);
  await h.broker.call(
    'project-graph.deleteProject',
    { version: 1, tenantId: 'tenant-a', projectId },
    { meta: { ...auth(), projectFileOriginals: fileCapability } }
  );
  expect(await records(projectId)).toEqual([]);
});
test('correction audit persists rejection, confirm and weighting across derivation', async () => {
  const projectId = await h.create();
  await populate(projectId);
  const edge = (await records(projectId)).find((doc) => doc.relation === 'joinsOn');
  const meta = auth('tenant-a', [], 'actor-a');
  meta.apiToken.roles = ['ROLE_ADMIN'];
  for (const [kind, weight] of [
    ['reject', 0],
    ['confirm', 1],
    ['weight', 0.7],
  ]) {
    const result = await h.call(
      'shared-service-learning.apply',
      {
        target: 'projectEdge',
        correction: {
          projectId,
          edgeId: edge.edgeId,
          kind,
          ...(kind === 'weight' ? { weight } : {}),
        },
      },
      meta
    );
    await internal('project-graph.run', { projectId, force: true });
    expect((await records(projectId)).find((doc) => doc.edgeId === edge.edgeId)).toMatchObject({
      origin: 'corrected',
      weight,
    });
    if (kind === 'reject')
      expect(
        (await h.call('project-graph.resolve', { projectId, nodeId: edge.from })).edges
      ).toEqual([]);
    await expect(
      h.call('shared-service-learning.undo', { correctionId: result.correctionId }, meta)
    ).rejects.toThrow('new project edge correction');
  }
  expect(
    (await h.call('shared-service-learning.list', {}, meta)).filter((doc) => !doc.pending)
  ).toHaveLength(3);
});
test('authenticated namespaces, Mango filters, capability and project visibility cannot be bypassed', async () => {
  const projectId = await h.create();
  await populate(projectId);
  const otherId = await h.create();
  await populate(otherId);
  const otherTenant = auth('tenant-b');
  const foreignId = await h.create(otherTenant);
  await populate(foreignId, otherTenant);
  const local = await records(projectId);
  expect(local.every((doc) => doc.tenantId === 'tenant-a' && doc.projectId === projectId)).toBe(
    true
  );
  const foreign = await internal(
    'object-store.projectGraphRecord',
    { operation: 'list', projectId: foreignId },
    otherTenant
  );
  expect(foreign.every((doc) => doc.tenantId === 'tenant-b')).toBe(true);
  expect(
    await internal('object-store.projectGraphRecord', { operation: 'list', projectId }, otherTenant)
  ).toEqual([]);
  await expect(
    h.call('object-store.projectGraphRecord', { operation: 'list', projectId })
  ).rejects.toMatchObject({ code: 403 });
  for (const filter of [
    { tenantId: 'tenant-b' },
    { $or: [{ projectId: otherId }] },
    { from: { $exists: true } },
  ])
    await expect(
      internal('object-store.projectGraphRecord', { operation: 'list', projectId, filter })
    ).rejects.toMatchObject({ code: 403 });
  const query = jest.spyOn(h.store.db, 'find');
  await internal('object-store.projectGraphRecord', {
    operation: 'list',
    projectId,
    filter: { kind: 'dataset' },
  });
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({
      selector: expect.objectContaining({
        tenantId: { $eq: 'tenant-a' },
        projectId: { $eq: projectId },
        kind: { $eq: 'dataset' },
        _id: {
          $gte: policy.prefix('tenant-a', projectId),
          $lt: policy.prefix('tenant-a', projectId) + '\uffff',
        },
      }),
    })
  );
  await expect(h.call('project-graph.nodes', { projectId }, otherTenant)).rejects.toMatchObject({
    code: 404,
  });
  await h.call('project-file.update', { projectId, members: ['someone-else'] });
  await expect(h.call('project-graph.nodes', { projectId })).rejects.toMatchObject({ code: 404 });
  await expect(internal('project-graph.run', { projectId, force: true })).rejects.toMatchObject({
    code: 404,
  });
  for (const namespace of [
    policy.prefix('tenant-a', projectId).slice(0, -1),
    `tenant:tenant-a:project_${projectId}`,
  ]) {
    if (namespace.startsWith('project-'))
      await expect(h.call('object-store.query', { namespace, selector: {} })).rejects.toThrow();
    else expect((await h.call('object-store.query', { namespace, selector: {} })).docs).toEqual([]);
  }
});
test('archive/deletion and clearance exclude all graph reading and derivation', async () => {
  const meta = auth('tenant-a', ['restricted']);
  const projectId = await h.create(meta);
  const bytes = Buffer.from('Token\nLumen-A7\n');
  const start = await h.start(
    projectId,
    bytes,
    { name: 'a.csv', sensitivityLevel: 'restricted' },
    meta
  );
  await h.send(start, bytes, meta);
  await h.complete(start.uploadId, meta);
  await expect(h.call('project-graph.nodes', { projectId })).rejects.toMatchObject({ code: 404 });
  expect((await h.call('project-graph.nodes', { projectId }, meta)).nodes.length).toBeGreaterThan(
    0
  );
  await h.call('project-file.archive', { projectId }, meta);
  await expect(h.call('project-graph.nodes', { projectId }, meta)).rejects.toMatchObject({
    code: 404,
  });
  await expect(
    internal('project-graph.run', { projectId, force: true }, meta)
  ).rejects.toMatchObject({ code: 409 });
  await h.call('project-file.delete', { projectId }, meta);
  expect(await records(projectId)).toEqual([]);
});
test('batch errors remain retryable, state is last, limits reject and cleanup remains complete after lowering limits', async () => {
  const projectId = await h.create();
  await populate(projectId);
  const original = h.store.db.bulkDocs.bind(h.store.db);
  let fail = true;
  jest.spyOn(h.store.db, 'bulkDocs').mockImplementation((docs, ...args) => {
    if (fail && Array.isArray(docs) && docs.some((doc) => doc.recordType)) {
      fail = false;
      return Promise.resolve([{ error: true }]);
    }
    return original(docs, ...args);
  });
  await expect(internal('project-graph.run', { projectId, force: true })).rejects.toThrow('batch');
  await internal('project-graph.run', { projectId, force: true });
  expect((await records(projectId)).some((doc) => doc.recordType === 'state')).toBe(true);
  process.env.CET_PROJECT_GRAPH_MAX_NODES = '1';
  await expect(internal('project-graph.run', { projectId, force: true })).rejects.toThrow(/limit/);
  await h.call('project-file.delete', { projectId });
  expect(await records(projectId)).toEqual([]);
});

test.each(require('./fixtures/project-graph-cases.json').cases)(
  'offline end-to-end synthetic project from $domain',
  async ({ tokens, description, measureField }) => {
    const projectId = await h.create();
    await addObject(
      h,
      projectId,
      Buffer.from(`Token,Ordinal\n${tokens[0]},1\n${tokens[1]},2\n`),
      'directory.csv'
    );
    await addObject(
      h,
      projectId,
      Buffer.from(
        `Token,Timestamp,${measureField}\n${tokens[0]},2026-01-01T00:00:00Z,7\n${tokens[1]},2026-01-01T01:00:00Z,8\n`
      ),
      'series.csv'
    );
    await addObject(
      h,
      projectId,
      Buffer.from(
        'Reference,Timestamp,Value\nOther-A7,2026-01-01T00:00:00Z,2\nOther-B8,2026-01-01T01:00:00Z,3\n'
      ),
      'parallel.csv'
    );
    await addObject(
      h,
      projectId,
      Buffer.from(`${description}\nToken: ${tokens[0]}\n`),
      'description.txt'
    );
    const docs = await records(projectId);
    expect(
      docs
        .filter((doc) => ['joinsOn', 'timeAligned', 'describes'].includes(doc.relation))
        .map((doc) => doc.relation)
        .sort()
    ).toEqual(['describes', 'describes', 'joinsOn', 'timeAligned']);
    await h.call('project-file.delete', { projectId });
    expect(await records(projectId)).toEqual([]);
  }
);

test('pending checkpoint hides partial graphs and restart recovery repairs them', async () => {
  const projectId = await h.create();
  const { a } = await populate(projectId);
  await sourceState(projectId, a.objectId, 'pending');
  await internal('object-store.projectGraphRecord', {
    operation: 'write',
    projectId,
    documents: [
      { recordType: 'state', tenantId: 'tenant-a', projectId, version: null, pending: true },
    ],
  });
  await expect(h.call('project-graph.nodes', { projectId })).rejects.toMatchObject({ code: 503 });
  await h.broker.stop();
  h = await boot();
  expect((await h.call('project-graph.nodes', { projectId })).nodes.length).toBeGreaterThan(0);
});

test('failed source replacement removes obsolete derived graph instead of keeping stale hits', async () => {
  const projectId = await h.create();
  await populate(projectId);
  for (const object of await h.call('project-upload.objects', { projectId })) {
    await sourceState(projectId, object.objectId, 'failed');
  }
  await internal('project-graph.run', { projectId, force: true });
  expect((await h.call('project-graph.nodes', { projectId })).nodes).toEqual([]);
  expect((await h.call('project-file.get', { projectId })).stats).toMatchObject({
    nodes: 0,
    edges: 0,
  });
});

async function sourceState(projectId, objectId, status) {
  const options = {
    meta: {
      ...auth(),
      projectObjectStore: require('../src/project-file-ingest-policy').objectCapability,
    },
  };
  const record = await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'get', projectId, recordId: objectId },
    options
  );
  return h.broker.call(
    'object-store.projectObjectRecord',
    {
      operation: 'put',
      projectId,
      recordId: objectId,
      record: { ...record, extraction: { status } },
    },
    options
  );
}
