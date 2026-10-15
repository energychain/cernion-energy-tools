'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-ingest-jobs-'));
const oldJobDir = process.env.JOB_STORE_DIR;
process.env.JOB_STORE_DIR = jobDir;
const { harness, hash, auth, zip } = require('./helpers/project-ingest');
const disk = require('../src/project-file-disk');
const quotaStore = require('../src/rate-quota-store');
const { objectCapability } = require('../src/project-file-ingest-policy');

let dir, h;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-ingest-test-'));
  h = await harness(dir);
});
afterEach(async () => {
  jest.restoreAllMocks();
  await h.broker.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const name of [
    'ZIP_MAX_DEPTH',
    'ZIP_MAX_ENTRIES',
    'ZIP_MAX_RATIO',
    'MAX_BYTES',
    'MAX_FILES',
  ])
    delete process.env[`CET_PROJECT_${name}`];
  const state = quotaStore.getTenantState('tenant-a');
  for (const key of Object.keys(state.config.quotas))
    if (key.startsWith('project_')) state.config.quotas[key] = 0;
  quotaStore.saveTenantState('tenant-a', state);
});
afterAll(() => {
  fs.rmSync(jobDir, { recursive: true, force: true });
  if (oldJobDir === undefined) delete process.env.JOB_STORE_DIR;
  else process.env.JOB_STORE_DIR = oldJobDir;
});

async function ingest(bytes, extra = {}, meta = auth()) {
  const projectId = await h.create(meta),
    started = await h.start(projectId, bytes, extra, meta);
  await h.send(started, bytes, meta);
  const job = await h.complete(started.uploadId, meta);
  return { projectId, started, job };
}

test('AC-02 resumes after restart, verifies repeated chunks and stores only metadata in Object Store', async () => {
  const projectId = await h.create(),
    bytes = Buffer.alloc(9 * 1024 ** 2, 97);
  const started = await h.start(projectId, bytes);
  const chunk = bytes.subarray(0, started.chunkSize);
  const params = { uploadId: started.uploadId, index: 0, hash: hash(chunk), bytes: chunk };
  await h.call('project-upload.chunk', params);
  await h.call('project-upload.chunk', params);
  await h.broker.stop();
  h = await harness(dir);
  const resumed = await h.start(projectId, bytes);
  expect(resumed.uploadId).toBe(started.uploadId);
  expect(resumed.missing).toEqual([1]);
  await h.send(resumed, bytes);
  expect((await h.complete(started.uploadId)).status).toBe('completed');
  const status = await h.call('project-upload.status', { uploadId: started.uploadId });
  expect(status).toMatchObject({
    status: 'received',
    ingestState: 'complete',
    hash: hash(bytes),
    extraction: { status: 'pending' },
  });
  const objects = await h.call('project-upload.objects', { projectId });
  expect(objects).toHaveLength(1);
  expect(JSON.stringify(objects)).not.toContain('contentBase64');
  expect((await h.call('project-file.get', { projectId })).stats).toMatchObject({
    files: 1,
    bytes: bytes.length,
  });
  expect((await h.complete(started.uploadId)).status).toBe('received');
});

test('AC-03 rejects a manipulated chunk, persists failed object, and rejects total hash mismatch asynchronously', async () => {
  const bytes = Buffer.from('synthetic content'),
    projectId = await h.create();
  const started = await h.start(projectId, bytes);
  await expect(
    h.call('project-upload.chunk', {
      uploadId: started.uploadId,
      index: 0,
      hash: hash(bytes),
      bytes: Buffer.alloc(bytes.length),
    })
  ).rejects.toMatchObject({ type: 'PROJECT_HASH_MISMATCH' });
  expect(await h.call('project-upload.status', { uploadId: started.uploadId })).toMatchObject({
    status: 'failed',
  });
  await expect(h.complete(started.uploadId)).rejects.toMatchObject({ code: 409 });
  const other = await h.start(projectId, bytes, { name: 'other.txt', hash: '0'.repeat(64) });
  await h.send(other, bytes);
  expect((await h.complete(other.uploadId)).status).toBe('error');
  expect(await h.call('project-upload.status', { uploadId: other.uploadId })).toMatchObject({
    status: 'failed',
  });
  expect(await h.call('project-file.get', { projectId })).toMatchObject({ lifecycle: 'degraded' });
});

test('AC-05 emits scoped per-object phases and the #885 handoff only after durable storage', async () => {
  const emit = jest.spyOn(h.broker, 'emit');
  const { projectId, started, job } = await ingest(Buffer.from('synthetic'));
  expect(job.status).toBe('completed');
  const progress = emit.mock.calls
    .filter(([name]) => name === 'project.ingest.progress.v1')
    .map(([, data]) => data);
  expect(new Set(progress.map((p) => p.phase))).toEqual(
    new Set(['receiving', 'verifying', 'received'])
  );
  for (const p of progress)
    expect(p).toMatchObject({
      tenantId: 'tenant-a',
      projectId,
      objectId: started.objectId,
      done: expect.any(Number),
      total: 9,
    });
  expect(emit).toHaveBeenCalledWith('project.object.received.v1', {
    version: 1,
    tenantId: 'tenant-a',
    projectId,
    objectId: started.objectId,
  });
  const lifecycle = emit.mock.calls
    .filter(([name]) => name === 'project.lifecycle.v1')
    .map(([, data]) => data.lifecycle);
  expect(lifecycle).toEqual(['ready', 'ingesting', 'ready']);
});

test('AC-06 isolates equal hashes between tenants, deduplicates within tenant, and cascades reference release', async () => {
  const bytes = Buffer.from('same original'),
    chunkHash = hash(bytes);
  const a = await ingest(bytes),
    b = await ingest(bytes, {}, auth('tenant-b'));
  const cProject = await h.create();
  const c = await h.start(cProject, bytes, { chunks: [{ hash: chunkHash, size: bytes.length }] });
  expect(c.missing).toEqual([]);
  expect((await h.complete(c.uploadId)).status).toBe('completed');
  const base = path.join(dir, 'originals');
  const file = async (tenant, project) =>
    path.join(await disk.projectDirectory(base, tenant, project), 'chunks', chunkHash);
  const aPath = await file('tenant-a', a.projectId),
    bPath = await file('tenant-b', b.projectId),
    cPath = await file('tenant-a', cProject);
  expect(fs.statSync(aPath).ino).not.toBe(fs.statSync(bPath).ino);
  expect(fs.statSync(aPath).ino).toBe(fs.statSync(cPath).ino);
  expect(fs.statSync(aPath).nlink).toBe(2);
  for (const action of ['status', 'complete', 'chunk'])
    await expect(
      h.call(
        `project-upload.${action}`,
        { uploadId: a.started.uploadId, index: 0, hash: chunkHash, bytes },
        auth('tenant-b')
      )
    ).rejects.toMatchObject({ code: 404 });
  await h.call('project-file.delete', { projectId: a.projectId });
  expect(fs.existsSync(aPath)).toBe(false);
  expect(fs.statSync(cPath).nlink).toBe(1);
  await h.call('project-file.delete', { projectId: cProject });
  expect(fs.existsSync(cPath)).toBe(false);
  expect(fs.existsSync(bPath)).toBe(true);
  await expect(
    h.call(
      'project-upload.deleteProject',
      { version: 1, tenantId: 'tenant-b', projectId: b.projectId },
      auth('tenant-b')
    )
  ).rejects.toMatchObject({ code: 403 });
  const meta = {
    ...auth('tenant-b'),
    projectFileOriginals: require('../src/project-file-policy').fileCapability,
  };
  await h.broker.call(
    'project-upload.deleteProject',
    { version: 1, tenantId: 'tenant-b', projectId: b.projectId },
    { meta }
  );
  expect(
    await h.broker.call(
      'project-upload.deleteProject',
      { version: 1, tenantId: 'tenant-b', projectId: b.projectId },
      { meta }
    )
  ).toEqual({ deleted: true });
});

test.each([false, true])(
  'streams mixed ZIP entries, including ZIP64=%s, as individual objects',
  async (zip64) => {
    const bytes = zip(
      [
        { name: 'folder/input.csv', bytes: Buffer.from('a,b\n1,2') },
        { name: 'note.txt' },
        { name: 'empty.txt', bytes: Buffer.alloc(0) },
      ],
      { zip64 }
    );
    const { projectId, job } = await ingest(bytes, { name: 'bundle.zip' });
    expect(job.status).toBe('completed');
    const objects = await h.call('project-upload.objects', { projectId });
    expect(objects).toHaveLength(4);
    expect(objects.every((o) => o.status === 'received')).toBe(true);
    expect(objects.find((o) => o.name === 'input.csv')).toMatchObject({
      bundlePath: 'folder/input.csv',
      size: 7,
      hash: hash(Buffer.from('a,b\n1,2')),
    });
  }
);

test.each([
  ['traversal', [{ name: '../escape.txt' }]],
  ['absolute', [{ name: '/escape.txt' }]],
  ['drive', [{ name: 'C:/escape.txt' }]],
  ['backslash', [{ name: 'a\\escape.txt' }]],
  ['encryption', [{ name: 'secret.txt', flags: 1 }]],
  ['symlink', [{ name: 'link.txt', attributes: 0xa0000000 }]],
  ['expansion bomb', [{ name: 'bomb.txt', bytes: Buffer.alloc(1024 ** 2) }]],
  ['forged size', [{ name: 'wrong.txt', expanded: 1 }]],
  ['duplicate', [{ name: 'same.txt' }, { name: 'same.txt' }]],
  ['path depth', [{ name: `${'d/'.repeat(33)}deep.txt` }]],
])('AC-04 rejects ZIP %s without successful original handoff', async (_name, entries) => {
  const emit = jest.spyOn(h.broker, 'emit');
  const { projectId, job } = await ingest(zip(entries), { name: 'unsafe.zip' });
  expect(job.status).toBe('error');
  expect(await h.call('project-file.get', { projectId })).toMatchObject({ lifecycle: 'degraded' });
  expect(emit.mock.calls.filter(([name]) => name === 'project.object.received.v1')).toHaveLength(0);
});

test('rejects excessive entry count and nested archives; keeps successful objects on partial failure', async () => {
  process.env.CET_PROJECT_ZIP_MAX_ENTRIES = '1';
  expect(
    (await ingest(zip([{ name: 'a.txt' }, { name: 'b.txt' }]), { name: 'many.zip' })).job.status
  ).toBe('error');
  delete process.env.CET_PROJECT_ZIP_MAX_ENTRIES;
  process.env.CET_PROJECT_ZIP_MAX_DEPTH = '1';
  const bytes = zip([
    { name: 'ok.txt' },
    { name: 'nested.zip', bytes: zip([{ name: 'deep.txt' }]) },
  ]);
  const { projectId, job } = await ingest(bytes, { name: 'nested-bundle.zip' });
  expect(job.status).toBe('error');
  const objects = await h.call('project-upload.objects', { projectId });
  expect(objects.some((o) => o.name === 'ok.txt' && o.status === 'received')).toBe(true);
  expect(objects.some((o) => o.name === 'deep.txt')).toBe(false);
});

test('tenant-quota overrides constrain project/file size, file count and chunk size; includes pending reservations', async () => {
  h.broker.createService(require('../services/tenant-quota.service'));
  await h.broker.waitForServices('tenant-quota');
  await h.call(
    'tenant-quota.setQuotas',
    {
      id: 'tenant-a',
      quotas: {
        project_max_bytes: 100,
        project_max_file_bytes: 80,
        project_max_files: 2,
        project_chunk_bytes: 65536,
      },
    },
    { ...auth(), tenantId: 'tenant-a' }
  );
  const projectId = await h.create();
  await expect(h.start(projectId, Buffer.alloc(81))).rejects.toMatchObject({ code: 413 });
  expect((await h.start(projectId, Buffer.alloc(60))).chunkSize).toBe(65536);
  await expect(h.start(projectId, Buffer.alloc(41), { name: 'b.txt' })).rejects.toMatchObject({
    code: 413,
  });
  await h.start(projectId, Buffer.alloc(30), { name: 'c.txt' });
  await expect(h.start(projectId, Buffer.alloc(1), { name: 'd.txt' })).rejects.toMatchObject({
    code: 413,
  });
});

test('scan hook consumes a stream and fails closed; sensitivity boundary applies to every projection', async () => {
  h.upload.settings.scanAction = 'scanner.scan';
  let clean = true,
    seen = 0;
  h.broker.createService({
    name: 'scanner',
    actions: {
      scan: {
        async handler(ctx) {
          expect(ctx.params.bytes).toBeUndefined();
          for await (const bytes of ctx.stream) seen += bytes.length;
          return { clean };
        },
      },
    },
  });
  const bytes = Buffer.from('scan-me'),
    meta = auth('tenant-a', ['restricted']);
  const projectId = await h.create();
  await expect(h.start(projectId, bytes, { sensitivityLevel: 'restricted' })).rejects.toMatchObject(
    { code: 403 }
  );
  const first = await h.start(projectId, bytes, { sensitivityLevel: 'restricted' }, meta);
  await h.send(first, bytes, meta);
  expect((await h.complete(first.uploadId, meta)).status).toBe('completed');
  expect(seen).toBe(bytes.length);
  for (const action of ['objects', 'status'])
    await expect(
      h.call(`project-upload.${action}`, { projectId, uploadId: first.uploadId })
    ).rejects.toMatchObject({ code: 404 });
  clean = false;
  const rejected = await h.start(projectId, bytes, { name: 'rejected.txt' }, meta);
  await h.send(rejected, bytes, meta);
  expect((await h.complete(rejected.uploadId, meta)).status).toBe('error');
});

test('purges expired uploads idempotently, releases only unreferenced chunks and removes interrupted writes', async () => {
  const bytes = Buffer.from('retained'),
    retained = await ingest(bytes);
  const pending = await h.start(retained.projectId, bytes, { name: 'pending.txt' });
  await h.send(pending, bytes);
  const doc = await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'get', projectId: retained.projectId, recordId: pending.objectId },
    { meta: { ...auth(), projectObjectStore: objectCapability } }
  );
  doc.expiresAt = 1;
  doc.ingestState = 'processing'; // Simulate a process crash without a surviving worker.
  await h.broker.call(
    'object-store.projectObjectRecord',
    { operation: 'put', projectId: doc.projectId, recordId: doc.objectId, record: doc },
    { meta: { ...auth(), projectObjectStore: objectCapability } }
  );
  const directory = path.join(
    await disk.projectDirectory(path.join(dir, 'originals'), 'tenant-a', doc.projectId),
    'chunks'
  );
  const orphan = path.join(directory, 'a'.repeat(64));
  fs.writeFileSync(orphan, 'orphan');
  await h.call('project-upload.purge', { projectId: doc.projectId });
  await h.call('project-upload.purge', { projectId: doc.projectId });
  expect(fs.existsSync(orphan)).toBe(false);
  expect(fs.existsSync(path.join(directory, hash(bytes)))).toBe(true);
  expect(await h.call('project-upload.objects', { projectId: doc.projectId })).toHaveLength(1);
});

test('checks free disk before writes, rejects unsafe directories and cleans aborted streams', async () => {
  const base = path.join(dir, 'disk');
  const directory = await disk.projectDirectory(base, '../tenant', '../../project');
  expect(path.relative(base, directory).startsWith('..')).toBe(false);
  const link = path.join(base, disk.segment('linked'));
  fs.symlinkSync(dir, link);
  await expect(disk.projectDirectory(base, 'linked', 'project')).rejects.toThrow(
    'Unsafe storage directory'
  );
  await expect(disk.projectDirectory(base, 'tenant', '\x00')).rejects.toThrow(
    'Invalid storage identity'
  );
  jest.spyOn(fs.promises, 'statfs').mockResolvedValueOnce({ bavail: 0n, bsize: 4096n });
  await expect(
    disk.writeChunk(directory, Readable.from([Buffer.from('data')]), 4, hash(Buffer.from('data')))
  ).rejects.toMatchObject({ code: 507 });
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('a');
      throw new Error('abort');
    })()
  );
  await expect(disk.writeChunk(directory, source, 4, hash(Buffer.from('data')))).rejects.toThrow(
    'abort'
  );
  expect(fs.readdirSync(directory)).toEqual([]);
});

test('archive serializes with ingest and blocks further writes, and generic storage cannot address objects', async () => {
  const bytes = Buffer.from('content'),
    projectId = await h.create();
  const started = await h.start(projectId, bytes);
  await expect(h.complete(started.uploadId)).rejects.toMatchObject({ code: 409 });
  await h.call('project-file.archive', { projectId });
  await expect(h.send(started, bytes)).rejects.toMatchObject({ code: 409 });
  expect(await h.call('project-upload.status', { uploadId: started.uploadId })).toMatchObject({
    status: 'receiving',
  });
  await expect(
    h.call('object-store.projectObjectRecord', { operation: 'list' })
  ).rejects.toMatchObject({ code: 403 });
  await expect(
    h.call('object-store.get', { namespace: 'project-object:tenant-a', key: started.objectId })
  ).rejects.toMatchObject({ code: 422 });
  await h.call('project-file.delete', { projectId });
  expect(
    fs.existsSync(path.join(dir, 'originals', disk.segment('tenant-a'), disk.segment(projectId)))
  ).toBe(false);
});

test('a running ingest owns the project mutation boundary until archive can commit', async () => {
  let entered, release;
  const scanning = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  h.upload.settings.scanAction = 'gate.scan';
  h.broker.createService({
    name: 'gate',
    actions: {
      scan: {
        async handler(ctx) {
          for await (const _bytes of ctx.stream) {
            /* consume a bounded stream */
          }
          entered();
          await gate;
          return { clean: true };
        },
      },
    },
  });
  const bytes = Buffer.from('serialize'),
    projectId = await h.create();
  const started = await h.start(projectId, bytes);
  await h.send(started, bytes);
  await h.call('project-upload.complete', { uploadId: started.uploadId });
  await scanning;
  let archived = false;
  const archive = h.call('project-file.archive', { projectId }).then(() => {
    archived = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(archived).toBe(false);
  expect(await h.call('project-file.get', { projectId })).toMatchObject({ lifecycle: 'ingesting' });
  release();
  await archive;
  expect(await h.call('project-file.get', { projectId })).toMatchObject({
    lifecycle: 'archived',
    stats: { files: 1 },
  });
});

test('ingest cleanup preserves future components in the shared project directory', async () => {
  const { projectId } = await ingest(Buffer.from('component'));
  const directory = await disk.projectDirectory(path.join(dir, 'originals'), 'tenant-a', projectId);
  const future = path.join(directory, 'project.sqlite');
  fs.writeFileSync(future, 'owned-by-885');
  await h.broker.call(
    'project-upload.deleteProject',
    { projectId, tenantId: 'tenant-a', version: 1 },
    {
      meta: {
        ...auth(),
        projectFileOriginals: require('../src/project-file-policy').fileCapability,
      },
    }
  );
  expect(fs.readFileSync(future, 'utf8')).toBe('owned-by-885');
  expect(fs.existsSync(path.join(directory, 'chunks'))).toBe(false);
});

test('a background ingest outlives the broker request timeout and retains its job result', async () => {
  h.broker.options.requestTimeout = 50;
  h.upload.settings.scanAction = 'slow.scan';
  h.broker.createService({
    name: 'slow',
    actions: {
      scan: {
        async handler(ctx) {
          for await (const _bytes of ctx.stream) {
            /* consume */
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          return { clean: true };
        },
      },
    },
  });
  const result = await ingest(Buffer.from('background'));
  expect(result.job.status).toBe('completed');
  expect(await h.call('project-file.get', { projectId: result.projectId })).toMatchObject({
    lifecycle: 'ready',
  });
});
