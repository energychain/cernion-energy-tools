'use strict';

const { principal, deny } = require('../src/domain-router-policy');
const project = require('../src/project-file-policy');
const ingest = require('../src/project-file-ingest-policy');
const graph = require('../src/project-graph-policy');
const manifest = require('../src/project-manifest');
const { validateCorrection, correctionPrincipal } = require('../src/shared-service-learning');
const params = { projectId: project.idParam };
const publicManifest = ({ _id, _rev, key, tenantId, graphVersion, corrections, ...record }) =>
  record;
const openapi = (summary, list = false) => ({
  summary,
  tags: ['Project manifest'],
  'x-agentable': true,
  security: [{ bearerAuth: [] }],
  parameters: list
    ? []
    : [
        {
          name: 'projectId',
          in: 'path',
          required: true,
          schema: { type: 'string', example: 'project-example' },
        },
      ],
  responses: {
    200: {
      description: 'Routing candidates only; never answer evidence',
      content: {
        'application/json': {
          schema: list
            ? { type: 'array', items: { type: 'object', additionalProperties: true } }
            : manifest.schema,
        },
      },
    },
    404: { description: 'Project manifest absent or invisible' },
  },
});

module.exports = {
  name: 'project-manifest',
  dependencies: ['object-store', 'project-file', 'project-graph'],
  settings: { catalog: null, operations: null },
  actions: {
    get: {
      rest: 'GET /:projectId',
      params,
      openapi: openapi('Read a visible, current project manifest candidate'),
      async handler(ctx) {
        const current = await this.current(ctx);
        if (!current) project.notFound();
        return publicManifest(current.manifest);
      },
    },
    candidates: {
      rest: 'GET /',
      params: {},
      openapi: openapi('List tenant-visible dynamic evidence endpoint candidates', true),
      async handler(ctx) {
        const projects = await ctx.call('project-file.list', { routingOnly: true });
        const candidates = [];
        for (const record of projects.filter((entry) =>
          ['ready', 'degraded'].includes(entry.lifecycle)
        )) {
          const safe = Object.assign(Object.create(ctx), {
            params: { projectId: record.projectId },
          });
          try {
            const current = await this.current(safe);
            if (current)
              candidates.push({
                id: `project:${record.projectId}`,
                title: record.title,
                projectId: record.projectId,
                manifest: publicManifest(current.manifest),
                corrections: current.corrections,
              });
          } catch (error) {
            if (![404, 503].includes(error.code)) throw error;
          }
        }
        return candidates;
      },
    },
    run: {
      visibility: 'protected',
      params,
      handler(ctx) {
        if (ctx.meta.projectManifest !== manifest.capability) deny('Use project manifest workflow');
        return this.enqueue(ctx);
      },
    },
    correct: {
      visibility: 'protected',
      params: {
        tenantId: 'string',
        actorId: 'string',
        target: { type: 'enum', values: ['projectManifest'] },
        ref: 'string',
        correctionId: { type: 'string', optional: true },
        correction: 'object',
        at: { type: 'string', optional: true },
      },
      handler(ctx) {
        correctionPrincipal(ctx.params, ctx.meta);
        const correction = validateCorrection(ctx.params);
        const safe = Object.assign(Object.create(ctx), {
          params: { ...ctx.params, projectId: correction.projectId },
        });
        return this.mutation(safe, async (locked) => {
          const records = await this.record(locked, 'list');
          const active = await this.current(locked);
          if (!active) project.notFound();
          if (
            correction.questionTypeId &&
            !active.manifest.questionTypes.some((item) => item.id === correction.questionTypeId)
          )
            deny('Unknown manifest question type');
          if (
            correction.kind === 'entity' &&
            !active.manifest.entities.some((item) => item.sources.includes(correction.nodeId))
          )
            deny('Unknown manifest entity node');
          const key = `correction:${principal(ctx).actorId}:${correction.kind === 'entity' ? correction.nodeId : correction.questionTypeId || '*'}`;
          const current = records.find((row) => row.key === key);
          const correctionId = ctx.params.correctionId || ctx.params.ref;
          if (
            current &&
            (current.correctionId === correctionId || (ctx.params.at && ctx.params.at < current.at))
          )
            return { corrected: true };
          await this.record(locked, 'put', {
            record: {
              ...correction,
              key,
              tenantId: principal(ctx).tenantId,
              actorId: principal(ctx).actorId,
              correctionId,
              at: ctx.params.at || new Date().toISOString(),
            },
          });
          return { corrected: true };
        });
      },
    },
    deleteProject: {
      visibility: 'protected',
      params: {
        ...params,
        tenantId: 'string',
        version: { type: 'number', integer: true, equal: 1 },
      },
      async handler(ctx) {
        if (ctx.meta.projectFileOriginals !== project.fileCapability) deny('Use project deletion');
        project.projectPrincipal(ctx);
        await this.record(ctx, 'remove');
        return { deleted: true };
      },
    },
  },
  events: {
    'project.graph.changed.v1': {
      handler(ctx) {
        const p = principal(ctx);
        if (ctx.params.tenantId !== p.tenantId) deny('Manifest event tenant mismatch');
        this.enqueue(ctx).catch((error) =>
          this.logger.warn('Project manifest generation pending', {
            errorClass: error.type || error.name,
          })
        );
        return { queued: true };
      },
    },
    'shared-service.correction.v1': {
      handler(ctx) {
        if (ctx.params.target === 'projectManifest')
          return this.actions.correct(ctx.params, { meta: ctx.meta });
      },
    },
  },
  async started() {
    await this.recover();
  },
  async stopped() {
    await Promise.allSettled([...(this.runs?.values() || [])].map((run) => run.promise));
  },
  methods: {
    record(ctx, operation, extra = {}) {
      return ctx.call(
        'object-store.projectManifestRecord',
        { operation, projectId: ctx.params.projectId, ...extra },
        { meta: { ...ctx.meta, projectManifest: manifest.capability } }
      );
    },
    graphRecords(ctx) {
      return ctx.call(
        'object-store.projectGraphRecord',
        { operation: 'list', projectId: ctx.params.projectId },
        { meta: { ...ctx.meta, projectGraph: graph.capability } }
      );
    },
    async active(ctx) {
      const record = await ctx.call('project-file.get', { projectId: ctx.params.projectId });
      if (!['ready', 'degraded'].includes(record.lifecycle) || record.deletion) project.notFound();
      return record;
    },
    async current(ctx) {
      await this.active(ctx);
      const version = manifest.graphVersion(await this.graphRecords(ctx));
      if (!version) return null;
      const records = await this.record(ctx, 'list');
      const current = records
        .filter((row) => row.key.startsWith('version:') && row.graphVersion === version)
        .sort((a, b) => b.version - a.version)[0];
      if (!current) return null;
      return {
        manifest: current,
        corrections: records
          .filter(
            (row) => row.key.startsWith('correction:') && row.actorId === principal(ctx).actorId
          )
          .map(({ kind, questionTypeId, nodeId, name }) => ({
            kind,
            questionTypeId,
            nodeId,
            name,
          })),
      };
    },
    mutation(ctx, work) {
      return ctx.call(
        'project-file.ingestMutation',
        {
          projectId: ctx.params.projectId,
          work: (lock) =>
            work(
              Object.assign(Object.create(ctx), { meta: { ...ctx.meta, projectIngestLock: lock } })
            ),
        },
        { timeout: 0, meta: { ...ctx.meta, projectIngest: ingest.ingestCapability } }
      );
    },
    enqueue(ctx) {
      this.runs ||= new Map();
      const key = JSON.stringify([principal(ctx).tenantId, ctx.params.projectId]);
      const safe = Object.assign(Object.create(ctx), {
        params: { projectId: ctx.params.projectId },
        meta: { ...ctx.meta, projectIngestLock: null },
      });
      const current = this.runs.get(key);
      if (current) {
        current.dirty = true;
        current.ctx = safe;
        return current.promise;
      }
      const run = { ctx: safe, dirty: false };
      run.promise = new Promise((resolve) => setImmediate(resolve))
        .then(async () => {
          let result;
          do {
            run.dirty = false;
            result = await this.generate(run.ctx);
            run.dirty ||= result.retry === true;
          } while (run.dirty);
          return result;
        })
        .finally(() => this.runs.delete(key));
      this.runs.set(key, run);
      return run.promise;
    },
    async generate(ctx) {
      const snapshot = await this.mutation(ctx, async (locked) => {
        const project = await this.active(locked);
        const graph = await this.graphRecords(locked);
        const version = manifest.graphVersion(graph);
        if (!version) return { pending: true };
        const records = await this.record(locked, 'list');
        if (records.some((row) => row.graphVersion === version)) return { unchanged: true };
        const datasets = (await ctx.call('datapoint.datasetCatalog', { operation: 'list' })).filter(
          (record) => record.provenance?.projectId === project.projectId
        );
        return {
          project,
          graph,
          datasets,
          graphVersion: version,
          version: Math.max(0, ...records.map((row) => row.version || 0)) + 1,
        };
      });
      if (snapshot.pending || snapshot.unchanged) return snapshot;
      const catalog = this.settings.catalog || [
        ...require('../src/evidence-endpoint-catalog').EVIDENCE_ENDPOINT_CATALOG,
        ...require('../src/evidence-endpoint-catalog').PROJECT_GRAPH_ENDPOINTS,
      ];
      const generated = await manifest.generateManifest(
        snapshot.project,
        snapshot.graph,
        snapshot.datasets,
        snapshot.version,
        { broker: this.broker, catalog }
      );
      if (!generated) return { empty: true };
      return this.mutation(ctx, async (locked) => {
        const current = await this.active(locked);
        if (manifest.graphVersion(await this.graphRecords(locked)) !== snapshot.graphVersion)
          return { retry: true };
        await ctx.call(
          'project-file.registerComponent',
          {
            projectId: current.projectId,
            componentId: 'manifest',
            sensitivityLevel: 'tenant_internal',
            requiredClearance: current.requiredClearance,
            cleanupAction: 'project-manifest.deleteProject',
          },
          { meta: locked.meta }
        );
        await this.record(locked, 'put', {
          record: {
            ...generated,
            tenantId: current.tenantId,
            key: `version:${generated.version}`,
            graphVersion: snapshot.graphVersion,
          },
        });
        await this.broker.emit(
          'project.manifest.changed.v1',
          { tenantId: current.tenantId, projectId: current.projectId, version: generated.version },
          { meta: ctx.meta }
        );
        return generated;
      });
    },
    async recover() {
      let after = '';
      const visited = new Set();
      do {
        const page = await this.broker.call(
          'object-store.projectGraphSources',
          { after },
          { meta: { projectGraph: graph.capability } }
        );
        for (const object of page.records) {
          const key = JSON.stringify([object.tenantId, object.projectId]);
          if (visited.has(key)) continue;
          visited.add(key);
          try {
            await this.actions.run(
              { projectId: object.projectId },
              {
                meta: {
                  projectManifest: manifest.capability,
                  apiToken: {
                    id: object.provenance.actorId,
                    tenantId: object.tenantId,
                    roles: ['ROLE_PROJECT_MANIFEST'],
                    sensitivityFlags: object.recoveryClearance,
                  },
                },
                timeout: 0,
              }
            );
          } catch (error) {
            this.logger.warn('Project manifest recovery pending', {
              errorClass: error.type || error.name,
            });
          }
        }
        after = page.after;
      } while (after);
    },
  },
};
