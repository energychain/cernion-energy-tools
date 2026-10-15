'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash, randomUUID } = require('node:crypto');
const projectPolicy = require('../src/project-file-policy');
const policy = require('../src/project-file-ingest-policy');
const disk = require('../src/project-file-disk');
const { zipDirectory, extractZipEntry } = require('../src/project-file-zip');
const { scanOriginal } = require('../src/file-channel-scan');
const { runAsync } = require('../src/async-job-runner');
const { ingestOpenApi } = require('../src/project-file-ingest-openapi');
const { TYPES } = require('../src/file-channel-policy');

const identity = { uploadId: policy.uploadParam };
const sensitivities = ['public', 'tenant_internal', 'restricted', 'highly_sensitive'];

async function* httpBytes(request) {
  // Isolate iterator.throw(error) from Readable.from/pipeline: only return() may
  // reach the request iterator, so a rejected chunk can still get an HTTP response.
  for await (const bytes of request.iterator({ destroyOnReturn: false })) yield bytes;
}

module.exports = {
  name: 'project-upload',
  dependencies: ['project-file', 'object-store'],
  settings: { dataPath: null, scanAction: null },
  actions: {
    start: {
      rest: 'POST /start',
      params: {
        projectId: projectPolicy.idParam,
        name: { type: 'string', min: 1, max: 200 },
        size: { type: 'number', integer: true, min: 1, max: 2 * 1024 ** 3 },
        hash: policy.hashParam,
        mimeType: { type: 'string', max: 200, optional: true },
        sensitivityLevel: { type: 'enum', values: sensitivities, default: 'tenant_internal' },
        requiredClearance: {
          type: 'array',
          items: { type: 'enum', values: sensitivities },
          max: 4,
          default: [],
        },
        chunks: {
          type: 'array',
          max: 32768,
          optional: true,
          items: {
            type: 'object',
            strict: true,
            props: { hash: policy.hashParam, size: { type: 'number', integer: true, min: 1 } },
          },
        },
      },
      openapi: ingestOpenApi('start', 'Start or resume a project object upload'),
      handler(ctx) {
        return this.withProject(ctx, ctx.params.projectId, () => this.startUpload(ctx));
      },
    },
    chunk: {
      rest: { method: 'PUT', path: '/uploads/:uploadId/chunks/:index', type: 'stream' },
      params: {
        ...identity,
        index: { type: 'number', integer: true, min: 0, max: 32767, convert: true },
        hash: policy.hashParam,
        bytes: { type: 'any', optional: true },
      },
      openapi: ingestOpenApi(
        'chunk',
        'Store one bounded binary chunk with server-side SHA-256 verification'
      ),
      async handler(ctx) {
        const upload = await this.findUpload(ctx);
        return this.withProject(ctx, upload.projectId, () =>
          this.receiveChunk(ctx, upload.objectId)
        );
      },
    },
    complete: {
      rest: 'POST /uploads/:uploadId/complete',
      params: identity,
      openapi: ingestOpenApi('complete', 'Verify an upload and queue asynchronous bundle ingest'),
      async handler(ctx) {
        const upload = await this.findUpload(ctx);
        return this.withProject(ctx, upload.projectId, () =>
          this.completeUpload(ctx, upload.objectId)
        );
      },
    },
    status: {
      rest: 'GET /uploads/:uploadId',
      params: identity,
      openapi: ingestOpenApi(
        'status',
        'Get received and missing chunks for a visible project upload'
      ),
      async handler(ctx) {
        const upload = await this.findUpload(ctx);
        await ctx.call('project-file.get', { projectId: upload.projectId });
        policy.assertObjectSensitivity(upload, projectPolicy.projectPrincipal(ctx));
        return this.uploadStatus(upload);
      },
    },
    objects: {
      rest: 'GET /:projectId/objects',
      params: { projectId: projectPolicy.idParam },
      openapi: ingestOpenApi(
        'objects',
        'List project object metadata without embedding original bytes'
      ),
      async handler(ctx) {
        await ctx.call('project-file.get', { projectId: ctx.params.projectId });
        const p = projectPolicy.projectPrincipal(ctx);
        const records = await this.records(ctx, ctx.params.projectId);
        return records.map((record) => {
          policy.assertObjectSensitivity(record, p);
          return policy.publicObject(record);
        });
      },
    },
    deleteProject: {
      visibility: 'protected',
      params: {
        projectId: projectPolicy.idParam,
        tenantId: projectPolicy.idParam,
        version: { type: 'number', equal: 1 },
      },
      async handler(ctx) {
        if (ctx.meta.projectFileOriginals !== projectPolicy.fileCapability)
          require('../src/domain-router-policy').deny('Use project deletion');
        const p = projectPolicy.projectPrincipal(ctx);
        return this.tenantMutation(p.tenantId, async () => {
          for (const record of await this.records(ctx, ctx.params.projectId))
            await this.record(ctx, 'remove', record.projectId, record.objectId);
          const directory = await disk.projectDirectory(
            this.basePath(),
            p.tenantId,
            ctx.params.projectId
          );
          await fs.promises.rm(path.join(directory, 'chunks'), { recursive: true, force: true });
          // Future SQLite/derived components own their files and cleanup acknowledgments.
          await fs.promises.rmdir(directory).catch((error) => {
            if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
          });
          return { deleted: true };
        });
      },
    },
    purge: {
      visibility: 'protected',
      params: { projectId: projectPolicy.idParam },
      handler(ctx) {
        return this.withProject(ctx, ctx.params.projectId, async () => {
          await this.purgeProject(ctx, ctx.params.projectId);
          await this.settleLifecycle(ctx, ctx.params.projectId);
          return { purged: true };
        });
      },
    },
  },
  methods: {
    basePath() {
      return (
        this.settings.dataPath || process.env.CET_PROJECT_DATA_PATH || './data/project-objects'
      );
    },
    record(ctx, operation, projectId, recordId, record) {
      return ctx.call(
        'object-store.projectObjectRecord',
        { operation, projectId, recordId, record },
        {
          meta: { ...ctx.meta, projectObjectStore: policy.objectCapability },
        }
      );
    },
    records(ctx, projectId) {
      return this.record(ctx, 'list', projectId);
    },
    async save(ctx, record) {
      const { rev } = await this.record(ctx, 'put', record.projectId, record.objectId, record);
      record._rev = rev;
      return record;
    },
    async tenantMutation(tenantId, work) {
      this.ingestQueues ||= new Map();
      const previous = this.ingestQueues.get(tenantId) || Promise.resolve();
      const next = previous.catch(() => {}).then(work);
      this.ingestQueues.set(tenantId, next);
      try {
        return await next;
      } finally {
        if (this.ingestQueues.get(tenantId) === next) this.ingestQueues.delete(tenantId);
      }
    },
    withProject(ctx, projectId, work) {
      const p = projectPolicy.projectPrincipal(ctx);
      return ctx.call(
        'project-file.ingestMutation',
        {
          projectId,
          work: (lock) =>
            this.tenantMutation(p.tenantId, async () => {
              ctx.meta.projectIngest = policy.ingestCapability;
              ctx.meta.projectIngestLock = lock;
              return work();
            }),
        },
        { timeout: 0, meta: { ...ctx.meta, projectIngest: policy.ingestCapability } }
      );
    },
    async findUpload(ctx) {
      projectPolicy.projectPrincipal(ctx);
      const record = (await this.records(ctx)).find(
        (item) => item.uploadId === ctx.params.uploadId
      );
      if (!record) policy.ingestError('Upload not found', 404, 'PROJECT_UPLOAD_NOT_FOUND');
      return record;
    },
    async chunkDirectory(ctx, projectId) {
      const p = projectPolicy.projectPrincipal(ctx);
      const directory = await disk.projectDirectory(this.basePath(), p.tenantId, projectId);
      return disk.safeDirectory(directory, 'chunks');
    },
    uploadStatus(record) {
      return {
        ...policy.publicObject(record),
        uploadId: record.uploadId,
        chunkSize: record.chunkSize,
        chunks: record.chunks.flatMap((chunk, index) => (chunk ? [{ index, ...chunk }] : [])),
        missing: record.chunks.flatMap((chunk, index) => (chunk ? [] : [index])),
        ...(record.job ? { job: record.job } : {}),
      };
    },
    async register(ctx, record, received = false) {
      return ctx.call('project-file.registerComponent', {
        projectId: record.projectId,
        componentId: record.objectId,
        sensitivityLevel: record.sensitivityLevel,
        requiredClearance: record.requiredClearance,
        stats: { files: received ? 1 : 0, bytes: received ? record.size : 0 },
        cleanupAction: 'project-upload.deleteProject',
      });
    },
    enforceBudget(records, limits, size = 0, files = 0) {
      if (
        records.length + files > limits.max_files ||
        records.reduce((sum, record) => sum + record.size, 0) + size > limits.max_bytes ||
        (files === 1 && size > limits.max_file_bytes)
      )
        policy.ingestError('Project byte/file quota exceeded', 413, 'PROJECT_INGEST_LIMIT');
    },
    async startUpload(ctx) {
      const p = projectPolicy.projectPrincipal(ctx),
        input = ctx.params;
      policy.safeName(input.name);
      policy.assertObjectSensitivity(input, p);
      await this.purgeProject(ctx, input.projectId);
      const limits = policy.limits(p.tenantId),
        records = await this.records(ctx, input.projectId);
      const existing = records.find(
        (r) =>
          r.uploadId &&
          r.name === input.name &&
          r.hash === input.hash &&
          r.size === input.size &&
          r.sensitivityLevel === input.sensitivityLevel &&
          JSON.stringify(r.requiredClearance) === JSON.stringify(input.requiredClearance)
      );
      if (existing) return this.uploadStatus(existing);
      this.enforceBudget(records, limits, input.size, 1);
      const chunkSize = limits.chunk_bytes,
        count = Math.ceil(input.size / chunkSize);
      if (
        input.chunks &&
        (input.chunks.length !== count ||
          input.chunks.some(
            (chunk, index) => chunk.size !== Math.min(chunkSize, input.size - index * chunkSize)
          ))
      )
        policy.ingestError('Invalid chunk manifest');
      const directory = await this.chunkDirectory(ctx, input.projectId);
      await disk.diskSpace(directory, input.size);
      const objectId = randomUUID();
      const record = {
        objectId,
        uploadId: objectId,
        tenantId: p.tenantId,
        projectId: input.projectId,
        name: input.name,
        mimeType:
          input.mimeType ||
          TYPES[input.name.split('.').at(-1).toLowerCase()] ||
          'application/octet-stream',
        size: input.size,
        hash: input.hash,
        chunks: Array(count).fill(null),
        chunkSize,
        status: 'receiving',
        sensitivityLevel: input.sensitivityLevel,
        requiredClearance: input.requiredClearance,
        provenance: { actorId: p.actorId, uploadId: objectId },
        extraction: { status: 'pending' },
        expiresAt: Date.now() + policy.setting('UPLOAD_TTL_HOURS', 24) * 3600000,
      };
      // Register cleanup and confidentiality before retaining any bytes or metadata.
      await this.register(ctx, record);
      await this.save(ctx, record);
      if (input.chunks) {
        for (let index = 0; index < count; index++) {
          if (await this.linkKnownChunk(ctx, record, input.chunks[index], directory))
            record.chunks[index] = input.chunks[index];
        }
        await this.save(ctx, record);
      }
      return this.uploadStatus(record);
    },
    async linkKnownChunk(ctx, record, chunk, directory) {
      const p = projectPolicy.projectPrincipal(ctx);
      for (const candidate of await this.records(ctx)) {
        if (
          candidate.status !== 'received' ||
          !candidate.chunks.some((c) => c?.hash === chunk.hash && c.size === chunk.size)
        )
          continue;
        try {
          policy.assertObjectSensitivity(candidate, p);
          await ctx.call('project-file.get', { projectId: candidate.projectId });
        } catch (_error) {
          continue;
        }
        const sourceDir = await this.chunkDirectory(ctx, candidate.projectId);
        const source = path.join(sourceDir, chunk.hash),
          target = path.join(directory, chunk.hash);
        await disk.regularFile(source);
        if (source !== target) {
          try {
            await fs.promises.link(source, target);
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
        }
        await disk.regularFile(target);
        return true;
      }
      return false;
    },
    async receiveChunk(ctx, objectId) {
      const found = await this.findUpload(ctx);
      const record = await this.record(ctx, 'get', found.projectId, objectId);
      const p = projectPolicy.projectPrincipal(ctx);
      policy.assertObjectSensitivity(record, p);
      if (record.status !== 'receiving' || record.ingestState === 'queued')
        policy.ingestError('Upload is no longer receiving', 409);
      if (record.expiresAt <= Date.now()) policy.ingestError('Upload expired', 410);
      const { index, hash, bytes } = ctx.params;
      if (index >= record.chunks.length) policy.ingestError('Chunk index out of range');
      const expected = Math.min(record.chunkSize, record.size - index * record.chunkSize);
      const incoming = ctx.stream;
      // pipeline destroys its input on error. Keep the HTTP socket alive until the
      // gateway has sent the 413/507 response; never buffer the remaining request.
      const stream = incoming?.headers
        ? Readable.from(httpBytes(incoming))
        : incoming || (Buffer.isBuffer(bytes) ? Readable.from([bytes]) : null);
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function')
        policy.ingestError('application/octet-stream body required');
      if (
        ctx.stream?.headers &&
        !/^application\/octet-stream(?:;|$)/i.test(ctx.stream.headers['content-type'] || '')
      )
        policy.ingestError('application/octet-stream body required', 415);
      if (record.chunks[index] && record.chunks[index].hash !== hash)
        policy.ingestError('Chunk index already has a different hash', 409);
      const directory = await this.chunkDirectory(ctx, record.projectId);
      try {
        await this.linkKnownChunk(ctx, record, { hash, size: expected }, directory);
        // Even repeated chunks are consumed and verified; a supplied hash is never trusted.
        const chunk = await disk.writeChunk(directory, stream, expected, hash);
        record.chunks[index] = chunk;
        record.expiresAt = Date.now() + policy.setting('UPLOAD_TTL_HOURS', 24) * 3600000;
        await this.save(ctx, record);
        await this.progress(
          record,
          'receiving',
          record.chunks.reduce((sum, c) => sum + (c?.size || 0), 0),
          record.size
        );
        return this.uploadStatus(record);
      } catch (error) {
        stream.destroy();
        if (incoming?.headers && !incoming.destroyed) {
          incoming.resume();
        }
        if (error.type === 'PROJECT_HASH_MISMATCH' || error.code === 413) {
          record.status = 'failed';
          record.error = error.message;
          await this.save(ctx, record);
          await this.progress(record, 'failed', 0, record.size);
          await this.settleLifecycle(ctx, record.projectId);
        }
        throw error;
      }
    },
    async completeUpload(ctx, objectId) {
      const found = await this.findUpload(ctx);
      const record = await this.record(ctx, 'get', found.projectId, objectId);
      policy.assertObjectSensitivity(record, projectPolicy.projectPrincipal(ctx));
      if (record.status === 'failed') policy.ingestError('Upload failed', 409);
      if (record.ingestState === 'complete') return this.uploadStatus(record);
      if (record.chunks.some((chunk) => !chunk)) policy.ingestError('Chunks missing', 409);
      if (record.expiresAt && record.expiresAt <= Date.now())
        policy.ingestError('Upload expired', 410);
      const workerCtx = ctx.copy();
      // Always asynchronous, including broker callers; reuse the existing tenant job quota.
      workerCtx.meta = {
        ...ctx.meta,
        $gateway: true,
        tenantId: record.tenantId,
        projectIngestLock: null,
      };
      const job = await runAsync(workerCtx, {
        service: 'project-upload',
        action: 'complete',
        params: { uploadId: record.uploadId },
        idempotencyKey: `project:${encodeURIComponent(record.tenantId)}:${record.uploadId}`,
        worker: (jobId) =>
          this.withProject(workerCtx, record.projectId, () =>
            this.ingestObject(workerCtx, objectId, record.projectId, jobId)
          ),
      });
      record.job = job;
      record.ingestState = 'queued';
      await this.save(ctx, record);
      await ctx.call('project-file.setLifecycle', {
        projectId: record.projectId,
        lifecycle: 'ingesting',
      });
      ctx.meta.$statusCode = 202;
      ctx.meta.$responseHeaders = workerCtx.meta.$responseHeaders;
      return job;
    },
    progress(record, phase, done, total) {
      return this.broker.emit('project.ingest.progress.v1', {
        tenantId: record.tenantId,
        projectId: record.projectId,
        objectId: record.objectId,
        phase,
        done,
        total,
      });
    },
    async markReceived(ctx, record) {
      await this.register(ctx, record, true);
      record.status = 'received';
      record.receivedAt ||= new Date().toISOString();
      delete record.expiresAt;
      await this.save(ctx, record);
      await this.progress(record, 'received', record.size, record.size);
      await this.broker.emit('project.object.received.v1', {
        version: 1,
        tenantId: record.tenantId,
        projectId: record.projectId,
        objectId: record.objectId,
      });
      if (this.broker.getLocalService('project-structure')) {
        const updated = await ctx.call(
          'project-structure.run',
          {
            projectId: record.projectId,
            objectId: record.objectId,
          },
          {
            timeout: 0,
            meta: {
              ...ctx.meta,
              projectStructure: require('../src/project-structure-policy').capability,
            },
          }
        );
        Object.assign(record, updated);
      }
    },
    async ingestObject(ctx, objectId, projectId, jobId) {
      const record = await this.record(ctx, 'get', projectId, objectId);
      const directory = await this.chunkDirectory(ctx, projectId);
      record.ingestState = 'processing';
      await this.save(ctx, record);
      try {
        let last = -1;
        await this.progress(record, 'verifying', 0, record.size);
        await disk.verifyObject(directory, record, async (done) => {
          const block = Math.floor(done / record.chunkSize);
          if (block !== last || done === record.size) {
            last = block;
            await this.progress(record, 'verifying', done, record.size);
          }
        });
        await this.scan(ctx, directory, record);
        if (/\.zip$/i.test(record.name) || record.mimeType === 'application/zip')
          await this.unpack(ctx, directory, record, 0);
        await this.markReceived(ctx, record);
        record.ingestState = 'complete';
        await this.save(ctx, record);
        require('../src/job-store').appendLog(
          jobId,
          'received',
          100,
          'Project original ingest complete'
        );
        return { objectId, projectId, status: 'received' };
      } catch (error) {
        // Preserve received entries on partial failure; failed original hashes stay failed.
        if (record.status !== 'received') record.status = 'failed';
        record.ingestState = 'failed';
        record.error = error.message;
        await this.save(ctx, record);
        await this.progress(record, 'failed', 0, record.size);
        throw error;
      } finally {
        await this.settleLifecycle(ctx, projectId);
      }
    },
    async scan(ctx, directory, record) {
      const scanner = this.settings.scanAction || process.env.CET_FILE_SCAN_ACTION;
      if (!scanner) return;
      await this.progress(record, 'scanning', 0, record.size);
      await scanOriginal(
        ctx,
        { mimeType: record.mimeType, hash: record.hash, size: record.size },
        scanner,
        Readable.from(disk.objectBytes(directory, record.chunks))
      );
      await this.progress(record, 'scanning', record.size, record.size);
    },
    async unpack(ctx, directory, parent, depth) {
      const maxDepth = policy.setting('ZIP_MAX_DEPTH', 4);
      if (depth >= maxDepth) policy.ingestError('Nested archive depth exceeded', 413);
      const limits = policy.limits(parent.tenantId);
      const records = await this.records(ctx, parent.projectId);
      const filename = await disk.spoolObject(directory, parent);
      try {
        const entries = await zipDirectory(filename, {
          entries: Math.min(limits.max_files, policy.setting('ZIP_MAX_ENTRIES', 10000)),
          depth: policy.setting('ZIP_PATH_DEPTH', 32),
          ratio: policy.setting('ZIP_MAX_RATIO', 200),
          budget: limits.max_bytes - records.reduce((sum, r) => sum + r.size, 0),
          fileBytes: limits.max_file_bytes,
        });
        this.enforceBudget(
          records,
          limits,
          entries.reduce((sum, e) => sum + e.expanded, 0),
          entries.length
        );
        // Check aggregate budget separately: a bundle can contain more than one max-file-sized entry.
        for (const entry of entries) {
          await this.progress(parent, 'unpacking', entries.indexOf(entry), entries.length);
          await disk.diskSpace(directory, entry.expanded * 2);
          const temp = path.join(directory, `pending-${randomUUID()}`);
          try {
            await extractZipEntry(filename, entry, temp);
            const child = await this.storeEntry(ctx, directory, parent, entry, temp);
            if (/\.zip$/i.test(child.name)) await this.unpack(ctx, directory, child, depth + 1);
          } finally {
            await fs.promises.rm(temp, { force: true });
          }
        }
        await this.progress(parent, 'unpacking', entries.length, entries.length);
      } finally {
        await fs.promises.rm(filename, { force: true });
      }
    },
    async storeEntry(ctx, directory, parent, entry, filename) {
      const p = projectPolicy.projectPrincipal(ctx),
        objectId = randomUUID();
      const record = {
        objectId,
        tenantId: p.tenantId,
        projectId: parent.projectId,
        name: policy.safeName(entry.name.split('/').at(-1)),
        bundlePath: entry.name,
        mimeType: /\.zip$/i.test(entry.name)
          ? 'application/zip'
          : TYPES[entry.name.split('.').at(-1).toLowerCase()] || 'application/octet-stream',
        size: entry.expanded,
        chunks: [],
        status: 'receiving',
        sensitivityLevel: parent.sensitivityLevel,
        requiredClearance: parent.requiredClearance,
        provenance: { ...parent.provenance, parentObjectId: parent.objectId },
        extraction: { status: 'pending' },
        expiresAt: Date.now() + policy.setting('UPLOAD_TTL_HOURS', 24) * 3600000,
      };
      this.enforceBudget(
        await this.records(ctx, parent.projectId),
        policy.limits(p.tenantId),
        record.size,
        1
      );
      await this.register(ctx, record);
      await this.save(ctx, record);
      const handle = await fs.promises.open(filename, 'r');
      const hash = createHash('sha256'),
        chunkSize = policy.limits(p.tenantId).chunk_bytes;
      try {
        const buffer = Buffer.alloc(Math.min(chunkSize, record.size));
        for (let offset = 0; offset < record.size; offset += chunkSize) {
          const size = Math.min(chunkSize, record.size - offset);
          if ((await handle.read(buffer, 0, size, offset)).bytesRead !== size)
            policy.ingestError('Truncated ZIP entry');
          const bytes = buffer.subarray(0, size);
          hash.update(bytes);
          const chunkHash = createHash('sha256').update(bytes).digest('hex');
          await this.linkKnownChunk(ctx, record, { hash: chunkHash, size }, directory);
          record.chunks.push(
            await disk.writeChunk(directory, Readable.from([bytes]), size, chunkHash)
          );
          await this.save(ctx, record);
          await this.progress(record, 'receiving', offset + size, record.size);
        }
        record.hash = hash.digest('hex');
        await this.scan(ctx, directory, record);
        await this.markReceived(ctx, record);
        return record;
      } catch (error) {
        record.status = 'failed';
        record.error = error.message;
        record.expiresAt = Date.now() + policy.setting('UPLOAD_TTL_HOURS', 24) * 3600000;
        await this.save(ctx, record);
        await this.progress(record, 'failed', 0, record.size);
        throw error;
      } finally {
        await handle.close();
      }
    },
    async settleLifecycle(ctx, projectId) {
      const records = await this.records(ctx, projectId);
      const lifecycle = records.some(
        (r) =>
          ['queued', 'processing'].includes(r.ingestState) ||
          (this.broker.getLocalService('project-structure') &&
            r.status === 'received' &&
            ['pending', 'processing'].includes(r.extraction?.status))
      )
        ? 'ingesting'
        : records.some(
              (r) =>
                r.status === 'failed' ||
                r.ingestState === 'failed' ||
                r.extraction?.status === 'failed'
            )
          ? 'degraded'
          : 'ready';
      await ctx.call('project-file.setLifecycle', { projectId, lifecycle });
    },
    async purgeProject(ctx, projectId) {
      const records = await this.records(ctx, projectId);
      for (const record of records)
        // The project mutation lock excludes a live worker. Expired queued/restarted
        // jobs must not pin incomplete uploads forever after a process failure.
        if (record.expiresAt <= Date.now())
          await this.record(ctx, 'remove', projectId, record.objectId);
      // Reachability is the reference count: metadata is committed before orphan unlink.
      // Re-running after a crash repairs orphan chunks without decrementing twice.
      const remaining = await this.records(ctx, projectId);
      const references = new Map();
      for (const record of remaining)
        for (const chunk of record.chunks.filter(Boolean))
          references.set(chunk.hash, (references.get(chunk.hash) || 0) + 1);
      const directory = await this.chunkDirectory(ctx, projectId);
      for (const name of await fs.promises.readdir(directory))
        if (/^(?:[a-f0-9]{64}|pending-[a-f0-9-]{36})$/.test(name) && !references.has(name))
          await fs.promises.rm(path.join(directory, name), { force: true });
      return references;
    },
  },
};
