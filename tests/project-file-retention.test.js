'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Store = require('../services/object-store.service');
const Project = require('../services/project-file.service');
const Files = require('../services/files.service');
const { principal } = require('../src/domain-router-policy');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { auth, createCaseBroker } = require('./helpers/case-linking-broker');
const filePolicy = require('../src/file-channel-policy');

test('AC-02 one-day retention expires chat originals while project originals survive, including stale expiresAt and shared membership', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-project-retention-'));
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({ ...Store, settings: { dbPath: path.join(dir, 'objects') } });
  broker.createService(Project);
  broker.createService({
    name: 'workbench',
    mixins: [
      createPouchDbLifecycleMixin({
        defaultDbPath: path.join(dir, 'evidence'),
        dbProperty: 'evidenceDb',
      }),
    ],
  });
  const files = broker.createService({
    ...Files,
    methods: { ...Files.methods, identity: async (ctx) => ({ p: principal(ctx) }) },
  });
  const meta = auth();
  const call = (name, params = {}, who = meta) =>
    broker.call(name, params, { meta: { ...who, apiToken: structuredClone(who.apiToken) } });
  const oldRetention = process.env.CET_FILE_RETENTION_DAYS;
  process.env.CET_FILE_RETENTION_DAYS = '1';
  const object = (operation, key, extra = {}) =>
    call(
      `object-store.${operation}`,
      { namespace: filePolicy.namespace('tenant-a'), ...(key ? { key } : {}), ...extra },
      { ...meta, fileStoreCapability: filePolicy.storeCapability }
    );
  const original = (text) => ({
    name: 'Synthetic.txt',
    contentBase64: Buffer.from(text).toString('base64'),
  });
  try {
    await broker.start();
    const a = await call('project-file.create', { title: 'A' });
    const b = await call('project-file.create', { title: 'B' });
    const ref = await call('files.upload', original('Project synthetic original'));
    const chat = await call('files.upload', original('Chat synthetic original'));
    const created = (await object('get', ref.fileId)).payload;
    expect(created.expiresAt - created.createdAt).toBeGreaterThanOrEqual(86400000);
    expect(created.expiresAt - created.createdAt).toBeLessThan(86401000);
    await expect(
      call('files.retainForProject', { projectId: a.projectId, fileId: ref.fileId })
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      call(
        'project-file.addFile',
        { projectId: a.projectId, fileId: ref.fileId },
        auth('foreign', ['ROLE_ALPHA'], 'tenant-b')
      )
    ).rejects.toMatchObject({ code: 404 });
    await call('project-file.addFile', { projectId: a.projectId, fileId: ref.fileId });
    await call('project-file.addFile', { projectId: a.projectId, fileId: ref.fileId });
    await call('project-file.addFile', { projectId: b.projectId, fileId: ref.fileId });
    const retained = (await object('get', ref.fileId)).payload;
    expect(retained.expiresAt).toBeUndefined();
    expect(retained.projectIds).toEqual([a.projectId, b.projectId]);
    expect(await call('project-file.get', { projectId: a.projectId })).toMatchObject({
      stats: { files: 1, bytes: ref.size },
    });
    // Two days later: deliberately keep a legacy expiry on the retained row too.
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 2 * 86400000);
    await object('put', ref.fileId, { payload: { ...retained, expiresAt: created.expiresAt } });
    expect(await call('files.purge')).toEqual({ removed: 1 });
    expect(await call('files.purge')).toEqual({ removed: 0 });
    expect(await call('files.read', { fileId: ref.fileId })).toMatchObject({
      text: 'Project synthetic original',
    });
    await expect(call('files.read', { fileId: chat.fileId })).rejects.toMatchObject({ code: 404 });
    expect(
      await files.removeFile(
        { meta, call: (name, params, opts) => broker.call(name, params, opts) },
        principal({ meta }),
        ref.fileId,
        'retention'
      )
    ).toMatchObject({ deleted: false });
    await call('project-file.archive', { projectId: a.projectId });
    await call('project-file.delete', { projectId: a.projectId });
    expect((await object('get', ref.fileId)).payload.projectIds).toEqual([b.projectId]);
    expect(await call('files.read', { fileId: ref.fileId })).toHaveProperty('text');
    await call('project-file.delete', { projectId: b.projectId });
    expect((await object('query', null)).docs).toHaveLength(0);
    await expect(call('files.read', { fileId: ref.fileId })).rejects.toMatchObject({ code: 404 });
    clock.mockRestore();
  } finally {
    jest.restoreAllMocks();
    if (oldRetention === undefined) delete process.env.CET_FILE_RETENTION_DAYS;
    else process.env.CET_FILE_RETENTION_DAYS = oldRetention;
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retention exception leaves tenant and sensitivity checks active', () => {
  const p = { tenantId: 'tenant-a', clearance: [] };
  const file = {
    tenantId: 'tenant-a',
    projectId: 'synthetic',
    sensitivityLevel: 'tenant_internal',
    expiresAt: 0,
  };
  expect(() => filePolicy.authorizeFile(p, file)).not.toThrow();
  expect(() =>
    filePolicy.authorizeFile(p, { ...file, projectId: undefined, projectIds: ['synthetic'] })
  ).not.toThrow();
  expect(() => filePolicy.authorizeFile(p, { ...file, tenantId: 'tenant-b' })).toThrow();
  expect(() => filePolicy.authorizeFile(p, { ...file, sensitivityLevel: 'restricted' })).toThrow();
  expect(() => filePolicy.authorizeFile(p, { ...file, deletedAt: 1 })).toThrow();
  expect(() => filePolicy.authorizeFile(p, { ...file, projectId: undefined })).toThrow();
});

test('failed derived cleanup retains the original and project for an explicit retry', async () => {
  const app = await createCaseBroker();
  app.broker.createService({ ...Store, settings: { dbPath: path.join(app.dir, 'objects') } });
  app.broker.createService(Project);
  app.broker.createService({
    ...Files,
    methods: { ...Files.methods, identity: async (ctx) => ({ p: principal(ctx) }) },
  });
  let fail = true;
  let sources = [];
  app.broker.createService({
    name: 'knowledge-rag',
    actions: {
      documentList: () => sources,
      documentCorrect: () => {
        if (fail) throw new Error('Synthetic derived cleanup failure');
        sources = [];
        return { status: 'deleted' };
      },
    },
  });
  const call = (name, params = {}) => app.broker.call(name, params, { meta: auth() });
  try {
    await app.broker.start();
    const { projectId } = await call('project-file.create', { title: 'Retry original cleanup' });
    const { fileId } = await call('files.upload', {
      name: 'Synthetic.txt',
      contentBase64: Buffer.from('Synthetic retry').toString('base64'),
    });
    sources = [{ id: 'synthetic-copy', refs: [{ fileId }] }];
    await call('project-file.addFile', { projectId, fileId });
    await expect(call('project-file.delete', { projectId })).rejects.toMatchObject({
      type: 'PROJECT_DELETE_INCOMPLETE',
    });
    expect(await call('files.read', { fileId })).toMatchObject({ text: 'Synthetic retry' });
    expect(sources).toHaveLength(1);
    expect(await call('project-file.get', { projectId })).toHaveProperty(
      'deletion.status',
      'incomplete'
    );
    fail = false;
    expect(await call('project-file.delete', { projectId })).toHaveProperty('deleted', true);
    expect(sources).toHaveLength(0);
    await expect(call('files.read', { fileId })).rejects.toMatchObject({ code: 404 });
  } finally {
    await app.cleanup();
  }
});
