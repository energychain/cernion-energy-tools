'use strict';
const { Errors } = require('moleculer');
const { principal, deny } = require('../src/domain-router-policy');
const project = require('../src/project-file-policy');
const ingest = require('../src/project-file-ingest-policy');
const policy = require('../src/project-graph-policy');
const { deriveGraph } = require('../src/project-graph-derive');
const { openGraphSource, graphSource } = require('../src/project-graph-sqlite');
const { documentAnchors } = require('../src/project-graph-anchors');
const { catalogLinks } = require('../src/project-graph-catalog');
const { graphOpenApi } = require('../src/project-graph-openapi');
const { correctionPrincipal, validateCorrection } = require('../src/shared-service-learning');
const params = { projectId: project.idParam };
const traversal = {
  ...params,
  nodeId: project.idParam,
  depth: { type: 'number', integer: true, min: 1, max: 3, default: 1, convert: true },
  limit: { type: 'number', integer: true, min: 1, max: 1000, default: 100, convert: true },
};
const clean = ({ _id, _rev, recordType: _recordType, tenantId: _tenantId, ...record }) => record;
module.exports = {
  name: 'project-graph',
  dependencies: ['object-store', 'project-file', 'project-structure'],
  settings: { catalog: null, operations: null, domains: null },
  actions: {
    nodes: {
      rest: 'GET /:projectId/nodes',
      params: {
        ...params,
        kind: { type: 'enum', values: policy.kinds, optional: true },
        label: { type: 'string', max: 300, optional: true },
        limit: traversal.limit,
      },
      openapi: graphOpenApi('Find visible project nodes by kind and label', [
        'kind',
        'label',
        'limit',
      ]),
      async handler(ctx) {
        await this.visible(ctx);
        const docs = await this.record(ctx, 'list', {
          filter: { recordType: 'node', ...(ctx.params.kind ? { kind: ctx.params.kind } : {}) },
        });
        const { normalizeAnchor } = require('../src/tenant-memory-store');
        const matches = docs.filter(
          (doc) =>
            !ctx.params.label ||
            doc.labels.some((label) =>
              normalizeAnchor(label).includes(normalizeAnchor(ctx.params.label))
            )
        );
        return {
          nodes: matches.slice(0, ctx.params.limit).map(clean),
          edges: [],
          truncated: matches.length > ctx.params.limit,
        };
      },
    },
    neighbors: {
      rest: 'GET /:projectId/neighbors',
      params: {
        ...traversal,
        relation: { type: 'enum', values: policy.relations, optional: true },
      },
      openapi: graphOpenApi('Read project neighbors with bounded depth', [
        'nodeId',
        'relation',
        'depth',
        'limit',
      ]),
      handler(ctx) {
        return this.traverse(ctx, ctx.params.relation ? [ctx.params.relation] : policy.relations);
      },
    },
    resolve: {
      rest: 'GET /:projectId/resolve',
      params: traversal,
      openapi: graphOpenApi('Resolve project attributes through sameEntity and joinsOn', [
        'nodeId',
        'depth',
        'limit',
      ]),
      handler(ctx) {
        return this.traverse(ctx, ['sameEntity', 'joinsOn']);
      },
    },
    run: {
      visibility: 'protected',
      params: { ...params, force: { type: 'boolean', default: false } },
      handler(ctx) {
        if (ctx.meta.projectGraph !== policy.capability) deny('Use project workflow');
        return this.enqueue(ctx);
      },
    },
    request: {
      visibility: 'protected',
      params,
      handler(ctx) {
        if (ctx.meta.projectGraph !== policy.capability) deny('Use project workflow');
        this.enqueue(ctx).catch((error) =>
          this.logger.warn('Project graph retry pending', { errorClass: error.type || error.name })
        );
        return { queued: true };
      },
    },
    correct: {
      visibility: 'protected',
      params: {
        tenantId: 'string',
        actorId: 'string',
        target: { type: 'enum', values: ['projectEdge'] },
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
        return this.mutation(safe, (locked) => this.correctEdge(locked, correction));
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
    'shared-service.correction.v1': {
      handler(ctx) {
        if (ctx.params.target !== 'projectEdge') return;
        return this.actions.correct(ctx.params, { meta: ctx.meta });
      },
    },
  },
  async started() {
    this.graphReady = true;
    this.recovery = this.recover().catch((error) =>
      this.logger.warn('Project graph recovery pending', { errorClass: error.type || error.name })
    );
    await this.recovery;
  },
  async stopped() {
    this.graphReady = false;
    await Promise.allSettled([...(this.graphRuns?.values() || [])].map((run) => run.promise));
  },
  methods: {
    enqueue(ctx) {
      this.graphRuns ||= new Map();
      const key = JSON.stringify([principal(ctx).tenantId, ctx.params.projectId]);
      const safe = Object.assign(Object.create(ctx), {
        meta: { ...ctx.meta, projectIngestLock: null },
        params: { ...ctx.params },
      });
      const current = this.graphRuns.get(key);
      if (current) {
        current.dirty = true;
        safe.params.force ||= current.ctx.params.force;
        current.ctx = safe;
        return current.promise;
      }
      const run = { ctx: safe, dirty: false };
      // Do not inherit or await an upload's active mutation lock.
      run.promise = new Promise((resolve) => setImmediate(resolve))
        .then(async () => {
          let result;
          do {
            run.dirty = false;
            result = await this.derive(run.ctx);
            run.dirty ||= result.retry === true;
          } while (run.dirty);
          return result;
        })
        .finally(() => this.graphRuns.delete(key));
      this.graphRuns.set(key, run);
      return run.promise;
    },
    record(ctx, operation, extra = {}) {
      return ctx.call(
        'object-store.projectGraphRecord',
        { operation, projectId: ctx.params.projectId, ...extra },
        { meta: { ...ctx.meta, projectGraph: policy.capability } }
      );
    },
    async visible(ctx) {
      const record = await ctx.call('project-file.get', { projectId: ctx.params.projectId });
      if (record.lifecycle === 'archived' || record.deletion) project.notFound();
      const state = await this.record(ctx, 'list', { filter: { recordType: 'state' } });
      if (state.some((doc) => doc.pending))
        throw new Errors.MoleculerError(
          'Project graph derivation pending; retry required',
          503,
          'PROJECT_GRAPH_PENDING'
        );
      return record;
    },
    mutation(ctx, work) {
      return ctx.call(
        'project-file.ingestMutation',
        {
          projectId: ctx.params.projectId,
          work: (lock) =>
            work(
              Object.assign(Object.create(ctx), {
                meta: {
                  ...ctx.meta,
                  projectIngest: ingest.ingestCapability,
                  projectIngestLock: lock,
                },
              })
            ),
        },
        { timeout: 0, meta: { ...ctx.meta, projectIngest: ingest.ingestCapability } }
      );
    },
    async sources(ctx) {
      return ctx.call(
        'object-store.projectObjectRecord',
        { operation: 'list', projectId: ctx.params.projectId },
        { meta: { ...ctx.meta, projectObjectStore: ingest.objectCapability } }
      );
    },
    configuration() {
      const catalog = this.settings.catalog || [
        ...require('../src/evidence-endpoint-catalog').EVIDENCE_ENDPOINT_CATALOG,
        ...require('../src/evidence-endpoint-catalog').PROJECT_GRAPH_ENDPOINTS,
      ];
      const operations =
        this.settings.operations ||
        require('../src/operation-capability-index').loadOperationCapabilityIndex().operations;
      const domains = this.settings.domains || require('../src/semantic-domains').semanticDomains;
      return { catalog, operations, domains, bounds: policy.limits() };
    },
    sourceVersion(objects, { catalog, operations, domains, bounds }) {
      return policy.identity(
        policy.VERSION,
        objects.map((object) => [
          object.objectId,
          object.hash,
          object.status,
          object.ingestState,
          object.extraction?.status,
          object.derivation,
        ]),
        bounds,
        catalog,
        domains,
        operations.filter((op) => catalog.some((entry) => entry.action === op.action))
      );
    },
    component(ctx, stats) {
      return ctx.call('project-file.registerComponent', {
        projectId: ctx.params.projectId,
        componentId: 'graph',
        sensitivityLevel: 'tenant_internal',
        requiredClearance: ctx.meta.projectIngestLock.project.requiredClearance,
        cleanupAction: 'project-graph.deleteProject',
        stats,
      });
    },
    async snapshot(ctx) {
      const all = await this.sources(ctx);
      const configuration = this.configuration();
      const version = this.sourceVersion(all, configuration);
      const { bounds } = configuration;
      const previous = await this.record(ctx, 'list');
      // Register acknowledged cleanup before the first possible graph batch.
      await this.component(ctx, {
        nodes: previous.filter((doc) => doc.recordType === 'node').length,
        edges: previous.filter((doc) => doc.recordType === 'edge').length,
      });
      const state = {
        recordType: 'state',
        projectId: ctx.params.projectId,
        tenantId: principal(ctx).tenantId,
        version: null,
        pending: true,
        derivation: { version: policy.VERSION },
      };
      if (all.some(policy.sourcePending)) {
        await this.record(ctx, 'write', { documents: [state] });
        return { pending: true };
      }
      if (
        !ctx.params.force &&
        previous.some(
          (doc) => doc.recordType === 'state' && !doc.pending && doc.version === version
        )
      )
        return { unchanged: true, version };
      await this.record(ctx, 'write', { documents: [state] });
      const objects = all.filter((object) => object.extraction?.status === 'extracted');
      let datasets = [],
        documents = [],
        source = { columns: [], candidates: [] };
      if (objects.length) {
        datasets = (await ctx.call('datapoint.datasetCatalog', { operation: 'list' })).filter(
          (record) =>
            record.provenance?.projectId === ctx.params.projectId &&
            objects.some((object) => object.objectId === record.provenance.objectId)
        );
        documents = (await ctx.call('knowledge-rag.documentList', {})).filter(
          (record) =>
            record.provenance?.projectId === ctx.params.projectId &&
            objects.some((object) => object.objectId === record.provenance.objectId)
        );
        if (documents.length > Math.min(bounds.nodes, bounds.runNodes))
          throw new Error('Graph section limit exceeded');
        const basePath =
          this.broker.getLocalService('project-upload')?.basePath() ||
          process.env.CET_PROJECT_DATA_PATH ||
          './data/project-objects';
        const db = await openGraphSource(basePath, principal(ctx).tenantId, ctx.params.projectId);
        try {
          source = graphSource(db, datasets, bounds);
        } finally {
          db.close();
        }
      }
      return { ...configuration, version, state, objects, datasets, documents, source };
    },
    async derive(ctx) {
      const snapshot = await this.mutation(ctx, (safe) => this.snapshot(safe));
      if (snapshot.unchanged || snapshot.pending) return snapshot;
      const { objects, datasets, documents, source, bounds, catalog, operations, domains } =
        snapshot;
      let graph, anchors;
      try {
        anchors = await documentAnchors(ctx, documents, objects, source.candidates, bounds);
        graph = deriveGraph({
          tenantId: principal(ctx).tenantId,
          projectId: ctx.params.projectId,
          objects,
          datasets,
          documents,
          source,
          limits: bounds,
        });
        await catalogLinks(ctx, graph, { entries: catalog, operations, domains, limits: bounds });
      } catch (error) {
        // Source replacement can remove a document while its text is being read.
        const changed = await this.mutation(ctx, (safe) => this.snapshotStatus(safe, snapshot));
        if (changed) return changed;
        throw error;
      }
      return this.mutation(ctx, (safe) => this.commitGraph(safe, snapshot, graph, anchors));
    },
    async snapshotStatus(ctx, snapshot) {
      const all = await this.sources(ctx);
      if (all.some(policy.sourcePending)) return { pending: true };
      if (this.sourceVersion(all, this.configuration()) !== snapshot.version)
        return { retry: true };
      return null;
    },
    async commitGraph(ctx, snapshot, graph, anchors) {
      const changed = await this.snapshotStatus(ctx, snapshot);
      if (changed) return changed;
      // Corrections made while the snapshot was being evaluated take precedence.
      const previous = await this.record(ctx, 'list');
      for (const old of previous.filter((doc) => doc.origin === 'corrected')) {
        graph.edges.set(old.edgeId, old);
        for (const id of [old.from, old.to]) {
          if (!graph.nodes.has(id)) {
            const prior = previous.find((doc) => doc.nodeId === id);
            if (prior) graph.nodes.set(id, prior);
          }
        }
      }
      if (
        graph.nodes.size > Math.min(snapshot.bounds.nodes, snapshot.bounds.runNodes) ||
        graph.edges.size > Math.min(snapshot.bounds.edges, snapshot.bounds.runEdges)
      )
        throw new Error('Graph corrected volume limit exceeded');
      const state = {
        ...snapshot.state,
        pending: false,
        version: snapshot.version,
        anchors,
      };
      const pendingState = { ...state, version: null, pending: true };
      await this.record(ctx, 'write', { documents: [pendingState] });
      await this.record(ctx, 'write', {
        replace: true,
        documents: [...graph.nodes.values(), ...graph.edges.values(), pendingState],
      });
      await this.component(ctx, { nodes: graph.nodes.size, edges: graph.edges.size });
      await this.record(ctx, 'write', { documents: [state] });
      const event = {
        tenantId: principal(ctx).tenantId,
        projectId: ctx.params.projectId,
        nodes: graph.nodes.size,
        edges: graph.edges.size,
        version: policy.VERSION,
      };
      await this.broker.emit('project.graph.changed.v1', event);
      return { ...event, anchors };
    },
    async correctEdge(ctx, correction) {
      const docs = await this.record(ctx, 'list');
      const edge = docs.find((doc) => doc.edgeId === correction.edgeId);
      if (!edge) project.notFound();
      const correctionId = ctx.params.correctionId || ctx.params.ref;
      if (
        edge.correctionId === correctionId ||
        edge.correctionRefs?.includes(correctionId) ||
        (ctx.params.at && edge.correction?.at && ctx.params.at < edge.correction.at)
      )
        return clean(edge);
      const corrected = {
        ...edge,
        origin: 'corrected',
        correctionId,
        correctionRefs: [...(edge.correctionRefs || []), correctionId].slice(-64),
        weight:
          correction.kind === 'reject' ? 0 : correction.kind === 'confirm' ? 1 : correction.weight,
        correction: {
          ...correction,
          actorId: principal(ctx).actorId,
          at: ctx.params.at || new Date().toISOString(),
        },
      };
      await this.record(ctx, 'write', { documents: [corrected] });
      await this.broker.emit('project.graph.changed.v1', {
        tenantId: principal(ctx).tenantId,
        projectId: ctx.params.projectId,
        nodes: docs.filter((doc) => doc.recordType === 'node').length,
        edges: docs.filter((doc) => doc.recordType === 'edge').length,
        version: policy.VERSION,
      });
      return clean(corrected);
    },
    async traverse(ctx, relations) {
      await this.visible(ctx);
      const docs = await this.record(ctx, 'list'),
        nodes = docs.filter((doc) => doc.recordType === 'node');
      const start = nodes.find((node) => node.nodeId === ctx.params.nodeId);
      if (!start) project.notFound();
      const found = new Set([start.nodeId]),
        edges = new Map();
      let frontier = [start.nodeId],
        truncated = false;
      for (let depth = 0; depth < ctx.params.depth && frontier.length; depth++) {
        const next = [];
        for (const edge of docs.filter(
          (doc) =>
            doc.recordType === 'edge' &&
            doc.weight >= policy.limits().threshold &&
            relations.includes(doc.relation) &&
            (frontier.includes(doc.from) || frontier.includes(doc.to))
        )) {
          const missing = [edge.from, edge.to].filter((id) => !found.has(id));
          if (found.size + missing.length > ctx.params.limit || edges.size >= ctx.params.limit) {
            truncated = true;
            continue;
          }
          edges.set(edge.edgeId, edge);
          missing.forEach((id) => {
            found.add(id);
            next.push(id);
          });
        }
        frontier = next;
      }
      return {
        nodes: nodes.filter((node) => found.has(node.nodeId)).map(clean),
        edges: [...edges.values()].map(clean),
        truncated,
      };
    },
    async recover() {
      let after = '';
      const visited = new Set();
      for (;;) {
        const page = await this.broker.call(
          'object-store.projectGraphSources',
          { after },
          { meta: { projectGraph: policy.capability } }
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
                  projectGraph: policy.capability,
                  apiToken: {
                    id: object.provenance.actorId,
                    tenantId: object.tenantId,
                    roles: ['ROLE_PROJECT_GRAPH'],
                    sensitivityFlags: object.recoveryClearance,
                  },
                },
                timeout: 0,
              }
            );
          } catch (error) {
            this.logger.warn('Project graph retry pending', {
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
