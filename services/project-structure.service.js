'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { principal, deny } = require('../src/domain-router-policy');
const projectPolicy = require('../src/project-file-policy');
const ingest = require('../src/project-file-ingest-policy');
const policy = require('../src/project-structure-policy');
const disk = require('../src/project-file-disk');
const { ProjectDatasetPool } = require('../src/project-dataset-pool');
const { csvRows, xlsxSheets } = require('../src/project-structure-stream');
const { structureTable, derivedId } = require('../src/project-structure-table');
const { documentParts } = require('../src/project-structure-document');

module.exports = {
  name: 'project-structure',
  dependencies: ['project-file', 'object-store', 'datapoint', 'dataset', 'knowledge-rag'],
  actions: {
    run: {
      visibility: 'protected',
      params: { projectId: projectPolicy.idParam, objectId: projectPolicy.idParam },
      async handler(ctx) {
        if (ctx.meta.projectStructure !== policy.capability) deny('Use project ingest');
        const work = (lock) => {
          const safe = Object.assign(Object.create(ctx), {
            meta: { ...ctx.meta, projectIngest: ingest.ingestCapability, projectIngestLock: lock },
          });
          return this.structureObject(safe);
        };
        const lock = ctx.meta.projectIngestLock;
        if (
          ctx.meta.projectIngest === ingest.ingestCapability &&
          lock?.active &&
          lock.project.tenantId === principal(ctx).tenantId &&
          lock.project.projectId === ctx.params.projectId
        )
          return work(lock);
        return ctx.call(
          'project-file.ingestMutation',
          { projectId: ctx.params.projectId, work },
          { timeout: 0, meta: { ...ctx.meta, projectIngest: ingest.ingestCapability } }
        );
      },
    },
    deleteProject: {
      visibility: 'protected',
      params: {
        version: { type: 'number', integer: true, equal: 1 },
        tenantId: 'string',
        projectId: projectPolicy.idParam,
      },
      async handler(ctx) {
        if (ctx.meta.projectFileOriginals !== projectPolicy.fileCapability)
          deny('Use project deletion');
        const p = projectPolicy.projectPrincipal(ctx);
        await this.removeDerived(ctx, ctx.params.projectId);
        const dataset = this.broker.getLocalService('dataset');
        const key = JSON.stringify([p.tenantId, ctx.params.projectId]);
        const pending = dataset?.projectDatasetPools?.get(key);
        if (pending) {
          (await pending).closeAll();
          dataset.projectDatasetPools.delete(key);
        }
        const directory = await disk.projectDirectory(
          this.basePath(),
          p.tenantId,
          ctx.params.projectId
        );
        for (const suffix of ['', '-wal', '-shm']) {
          const filename = path.join(directory, `project.sqlite${suffix}`);
          try {
            await disk.regularFile(filename);
            await fs.promises.rm(filename);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
        }
        await fs.promises.rmdir(directory).catch((error) => {
          if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
        });
        return { deleted: true };
      },
    },
  },
  async started() {
    // Durable source records, rather than volatile event delivery, drive restart recovery.
    this.recovery = this.recover().catch((error) =>
      this.logger.warn('Project structure recovery pending', {
        errorClass: error.type || error.name,
      })
    );
    await this.recovery;
  },
  methods: {
    basePath() {
      return (
        this.broker.getLocalService('project-upload')?.basePath() ||
        process.env.CET_PROJECT_DATA_PATH ||
        './data/project-objects'
      );
    },
    record(ctx, operation, object) {
      return ctx.call(
        'object-store.projectObjectRecord',
        {
          operation,
          projectId: object.projectId,
          recordId: object.objectId,
          ...(operation === 'put' ? { record: object } : {}),
        },
        { meta: { ...ctx.meta, projectObjectStore: ingest.objectCapability } }
      );
    },
    async save(ctx, object) {
      const result = await this.record(ctx, 'put', object);
      object._rev = result.rev;
    },
    async progress(object, done, total = 0) {
      await this.broker.emit('project.ingest.progress.v1', {
        tenantId: object.tenantId,
        projectId: object.projectId,
        objectId: object.objectId,
        phase: 'structure',
        done,
        total,
      });
    },
    async register(ctx, object, count = 0, componentId = `structure:${object.objectId}`) {
      await ctx.call('project-file.registerComponent', {
        projectId: object.projectId,
        componentId,
        sensitivityLevel: object.sensitivityLevel,
        requiredClearance: object.requiredClearance,
        stats: { datasets: count },
        cleanupAction: 'project-structure.deleteProject',
      });
    },
    async removeDerived(ctx, projectId, objectId) {
      const safe = { meta: { ...ctx.meta, projectFileOriginals: projectPolicy.fileCapability } };
      const owned = (record) =>
        record.provenance?.projectId === projectId &&
        (!objectId || record.provenance.objectId === objectId);
      const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' }, safe);
      for (const record of records.filter(owned))
        await ctx.call('datapoint.datasetCatalog', { operation: 'remove', id: record.id }, safe);
      const documents = await ctx.call(
        'knowledge-rag.documentList',
        { includeDeleting: true },
        safe
      );
      for (const document of documents.filter(owned))
        await ctx.call('knowledge-rag.documentCorrect', { id: document.id, kind: 'delete' }, safe);
    },
    async structureObject(ctx) {
      const object = await this.record(ctx, 'get', ctx.params);
      const p = principal(ctx);
      ingest.assertObjectSensitivity(object, p);
      if (object.status !== 'received') throw new Error('Project original is not received');
      if (policy.completed(object)) {
        if (
          ctx.meta.projectStructureRecovery &&
          ['queued', 'processing'].includes(object.ingestState)
        ) {
          object.ingestState = 'complete';
          await this.save(ctx, object);
          await this.broker
            .getLocalService('project-upload')
            ?.settleLifecycle(ctx, object.projectId);
        }
        return object;
      }
      let pool, spool, chunks;
      const previousDatasets = [
        ...(object.derivation?.datasets || []),
        ...(object.derivation?.obsoleteDatasets || []),
      ];
      object.derivation = {
        version: policy.VERSION,
        hash: object.hash,
        datasets: [],
        documents: [],
        obsoleteDatasets: previousDatasets,
      };
      object.extraction = { status: 'processing' };
      try {
        await this.register(ctx, object);
        await this.save(ctx, object);
        await this.removeDerived(ctx, object.projectId, object.objectId);
        for (const id of previousDatasets) await this.register(ctx, object, 0, id);
        const directory = await disk.projectDirectory(
          this.basePath(),
          p.tenantId,
          object.projectId
        );
        chunks = await disk.safeDirectory(directory, 'chunks');
        pool = await ProjectDatasetPool.open(this.basePath(), p.tenantId, object.projectId);
        const db = pool.tenant(p.tenantId);
        // Metadata may have been lost after a batch commit. Deterministic IDs and this
        // per-object manifest make incomplete tables reclaimable after process failure.
        for (const row of db
          .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'ds_%'")
          .all()) {
          if (previousDatasets.includes(row.name))
            db.exec(`DROP TABLE IF EXISTS ${pool.table(row.name)}`);
        }
        db.prepare('DELETE FROM project_candidates WHERE object_id = ?').run(object.objectId);
        object.derivation.obsoleteDatasets = [];
        // Only the first block is needed to classify the object; close the stream afterwards.
        const head = disk.objectBytes(chunks, object.chunks)[Symbol.asyncIterator]();
        let prefix = '';
        try {
          const first = await head.next();
          if (!first.done) prefix = first.value.subarray(0, 4096).toString('utf8');
        } finally {
          await head.return?.();
        }
        const type = policy.objectType(object, prefix);
        object.derivation.type = type;
        const table = async (sheet, rows) => {
          const id = derivedId(object, sheet);
          db.exec(`DROP TABLE IF EXISTS ${pool.table(id)}`);
          object.derivation.datasets.push(id);
          await this.save(ctx, object);
          const record = await structureTable(ctx, object, sheet, rows, pool, (done) =>
            this.progress(object, done)
          );
          await this.register(ctx, object, 1, id);
          return record;
        };
        await this.progress(object, 0);
        if (type === 'csv')
          await table('Sheet1', csvRows(disk.objectBytes(chunks, object.chunks), object.name));
        else if (type !== 'unknown') {
          spool = await disk.spoolObject(chunks, object);
          if (type === 'xlsx') {
            for await (const sheet of xlsxSheets(spool)) await table(sheet.name, sheet.rows);
          } else if (type === 'structured') await this.structured(ctx, object, spool, table);
          else await this.documents(ctx, object, spool, type, pool);
        } else object.extraction.reason = 'Unsupported object type; original retained';
        object.extraction.status = 'extracted';
        object.extraction.at = new Date().toISOString();
        await this.progress(object, 1, 1);
      } catch (error) {
        object.extraction = {
          status: 'failed',
          reason: error.message,
          at: new Date().toISOString(),
        };
        try {
          await this.removeDerived(ctx, object.projectId, object.objectId);
          if (pool) {
            for (const id of [...object.derivation.datasets, ...previousDatasets])
              pool.tenant(p.tenantId).exec(`DROP TABLE IF EXISTS ${pool.table(id)}`);
            pool
              .tenant(p.tenantId)
              .prepare('DELETE FROM project_candidates WHERE object_id = ?')
              .run(object.objectId);
          }
        } catch (cleanupError) {
          object.extraction.cleanupReason = cleanupError.message;
        }
        await this.register(ctx, object, 0);
        for (const id of object.derivation.datasets) await this.register(ctx, object, 0, id);
        await ctx.call('project-file.setLifecycle', {
          projectId: object.projectId,
          lifecycle: 'degraded',
        });
        await this.progress(object, 0, 1);
      } finally {
        pool?.closeAll();
        if (spool) await fs.promises.rm(spool, { force: true });
        if (
          ctx.meta.projectStructureRecovery &&
          object.uploadId &&
          ['queued', 'processing'].includes(object.ingestState)
        )
          object.ingestState = 'complete';
        await this.save(ctx, object);
        await this.broker.getLocalService('project-upload')?.settleLifecycle(ctx, object.projectId);
      }
      const graph = this.broker.getLocalService('project-graph');
      if (graph?.graphReady) {
        try {
          await ctx.call(
            'project-graph.run',
            { projectId: object.projectId, force: true },
            {
              meta: {
                ...ctx.meta,
                projectGraph: require('../src/project-graph-policy').capability,
              },
              timeout: 0,
            }
          );
        } catch (error) {
          this.logger.warn('Project graph retry pending', { errorClass: error.type || error.name });
        }
      }
      return object;
    },
    async structured(ctx, object, filename, table) {
      if (object.size > policy.setting('MESSAGE_MAX_BYTES', 16 * 1024 ** 2))
        throw new Error('Structured message budget exceeded');
      const text = await fs.promises.readFile(filename, 'utf8');
      const adapter = require('../src/structured-message-adapters.json').adapters.find((entry) =>
        require(`../src/${entry.module}`).recognizes(text)
      );
      if (!adapter) throw new Error('Unrecognized structured message');
      const parsed = require(`../src/${adapter.module}`).parse(text, object.name);
      if (!parsed.rows.length) throw new Error('No structured records');
      const names = Object.keys(parsed.rows[0]);
      async function* rows() {
        yield names;
        for (const row of parsed.rows) yield names.map((name) => row[name]);
      }
      const record = await table('Messages', rows());
      record.structuredFormat = adapter.id;
      record.structured = {
        ...parsed,
        rows: undefined,
        resolutions: await require(`../src/${adapter.module}`).resolve(ctx, parsed.codes),
        references: [],
      };
      const content = record.columns.find((column) => column.name === names.at(-1));
      if (content) content.sensitive = true;
      await ctx.call('datapoint.datasetCatalog', { operation: 'put', record });
    },
    async documents(ctx, object, filename, type, pool) {
      let ordinal = 0,
        candidateCount = 0;
      const objectLimit = policy.setting('MEMORY_MAX_SECTIONS_PER_OBJECT', 50);
      const projectLimit = policy.setting('MEMORY_MAX_SECTIONS_PER_PROJECT', 500);
      // The existing project mutation lock serializes reservations across all objects.
      const records = await this.record(ctx, 'list', object);
      let projectAttempts = records.reduce(
        (sum, record) => sum + (record.memory?.attemptedSections || 0),
        0
      );
      object.memory = {
        attemptedSections: object.memory?.attemptedSections || 0,
        extractedSections: 0,
        skippedSections: 0,
      };
      const budget = {
        claimSection: async () => {
          const allowed =
            object.memory.attemptedSections < objectLimit && projectAttempts < projectLimit;
          if (allowed) {
            object.memory.attemptedSections++;
            projectAttempts++;
          } else object.memory.skippedSections++;
          // Reserve before the LLM call. Failed attempts and restarts consume budget too.
          await this.save(ctx, object);
          return allowed;
        },
        onExtracted: async () => {
          object.memory.extractedSections++;
          await this.save(ctx, object);
        },
      };
      await this.save(ctx, object);
      for await (const part of documentParts(filename, type)) {
        if (!part.text.trim()) continue;
        const row = await ctx.call('knowledge-rag.documentIngest', {
          name: `${object.objectId}:${++ordinal}`,
          title: object.name,
          text: part.text,
          sourceLocation: part.location,
          sensitivityFlags: [
            ...new Set([
              ...(object.requiredClearance || []),
              ...(['restricted', 'highly_sensitive'].includes(object.sensitivityLevel)
                ? [object.sensitivityLevel]
                : []),
            ]),
          ],
          provenance: {
            projectId: object.projectId,
            objectId: object.objectId,
            ...object.provenance,
          },
          refs: [{ projectId: object.projectId, objectId: object.objectId }],
        });
        object.derivation.documents.push(row.id);
        await this.save(ctx, object);
        const full = await ctx.call('knowledge-rag.documentGet', { id: row.id });
        await require('../src/workbench-document-knowledge').rememberDocument(
          this,
          ctx,
          principal(ctx),
          full,
          {},
          budget
        );
        await ctx.call('knowledge-rag.documentExtractionState', { id: row.id, state: 'complete' });
        if (candidateCount < policy.setting('ENTITY_CANDIDATE_LIMIT', 10000)) {
          const values = [
            { kind: 'label', value: part.location.chapter || object.name, location: part.location },
            ...require('../src/project-structure-table').documentCandidates(
              part.text,
              part.location
            ),
          ].slice(0, policy.setting('ENTITY_CANDIDATE_LIMIT', 10000) - candidateCount);
          pool.candidates(object.objectId, policy.VERSION, values);
          candidateCount += values.length;
        }
        await this.progress(object, ordinal);
      }
      if (!ordinal) throw new Error('No readable document text; OCR required');
    },
    async recover() {
      let after = '';
      for (;;) {
        const page = await this.broker.call(
          'object-store.projectStructurePending',
          { after },
          { meta: { projectStructure: policy.capability } }
        );
        for (const object of page.records) {
          const meta = {
            projectStructure: policy.capability,
            projectStructureRecovery: true,
            apiToken: {
              id: object.provenance.actorId,
              tenantId: object.tenantId,
              roles: ['ROLE_PROJECT_STRUCTURE'],
              sensitivityFlags: object.recoveryClearance || [],
            },
          };
          try {
            await this.actions.run(
              { projectId: object.projectId, objectId: object.objectId },
              { meta, timeout: 0 }
            );
          } catch (error) {
            this.logger.warn('Project object recovery pending', {
              objectId: object.objectId,
              errorClass: error.type || error.name,
            });
          }
        }
        if (!page.after) break;
        after = page.after;
      }
    },
  },
};
