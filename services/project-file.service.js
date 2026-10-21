'use strict';

const { randomUUID } = require('node:crypto');
const { Errors } = require('moleculer');
const { deny } = require('../src/domain-router-policy');
const policy = require('../src/project-file-policy');
const { projectOpenApi, administrationOverviewSchema } = require('../src/project-file-openapi');

const membersParam = {
  type: 'array',
  items: { type: 'string', min: 1, max: 200 },
  max: 1000,
  optional: true,
};
const refsParam = {
  type: 'array',
  max: 1000,
  optional: true,
  items: {
    type: 'object',
    strict: true,
    props: {
      caseId: { ...policy.idParam, optional: true },
      conversationId: { ...policy.idParam, optional: true },
    },
  },
};
const projectParams = { projectId: policy.idParam };
const editableParams = {
  title: { type: 'string', min: 1, max: 300, trim: true, optional: true },
  members: membersParam,
  projectRefs: refsParam,
};
const editableSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 300, example: 'Example project' },
    members: { type: 'array', items: { type: 'string' }, example: [] },
    projectRefs: {
      type: 'array',
      example: [{ caseId: 'example-case' }],
      items: {
        type: 'object',
        properties: { caseId: { type: 'string' }, conversationId: { type: 'string' } },
      },
    },
  },
};

module.exports = {
  name: 'project-file',
  dependencies: ['object-store'],
  settings: {
    cleanupActions: (process.env.CET_PROJECT_CLEANUP_ACTIONS || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  },
  actions: {
    ingestMutation: {
      visibility: 'protected',
      params: { ...projectParams, work: { type: 'function' } },
      handler(ctx) {
        const { ingestCapability } = require('../src/project-file-ingest-policy');
        if (ctx.meta.projectIngest !== ingestCapability) deny('Use project ingest');
        return this.mutateProject(ctx, async (project) => {
          this.assertMutable(project);
          const lock = { project, active: true };
          try {
            return await ctx.params.work(lock);
          } finally {
            lock.active = false;
          }
        });
      },
    },
    create: {
      rest: 'POST /',
      params: { ...editableParams, title: { ...editableParams.title, optional: false } },
      openapi: projectOpenApi('Create a durable tenant project file', {
        body: { ...editableSchema, required: ['title'] },
      }),
      async handler(ctx) {
        const p = policy.projectPrincipal(ctx);
        const at = new Date().toISOString();
        const project = {
          projectId: randomUUID(),
          tenantId: p.tenantId,
          title: ctx.params.title,
          lifecycle: 'ready',
          requiredClearance: [],
          createdBy: p.actorId,
          members: ctx.params.members || [],
          projectRefs: ctx.params.projectRefs || [],
          stats: policy.componentStats({}),
          createdAt: at,
          updatedAt: at,
          components: {},
          cleanupActions: [...this.settings.cleanupActions],
        };
        this.validateRefs(project.projectRefs);
        if (!policy.visibleProject(project, p)) deny('Creator must be a project member');
        await this.persist(ctx, project);
        await this.lifecycleEvent(project);
        return policy.publicProject(project);
      },
    },
    get: {
      rest: 'GET /:projectId',
      params: projectParams,
      openapi: projectOpenApi('Get a visible tenant project file', { id: true, read: true }),
      async handler(ctx) {
        return policy.publicProject(await this.loadProject(ctx, policy.projectPrincipal(ctx)));
      },
    },
    list: {
      rest: 'GET /',
      params: { routingOnly: { type: 'boolean', optional: true, default: false, convert: true } },
      openapi: projectOpenApi('List visible tenant project files', {
        query: ['routingOnly'],
        list: true,
        read: true,
      }),
      async handler(ctx) {
        return this.listProjects(ctx);
      },
    },
    administrationOverview: {
      rest: 'GET /administration-overview',
      params: {},
      openapi: projectOpenApi(
        'Read-only administration inventory with advisory deletion eligibility',
        {
          response: administrationOverviewSchema,
        }
      ),
      async handler(ctx) {
        // read_only_governance_projection (#898): reuses list visibility and performs no
        // write, audit, cleanup or lifecycle effect. Totals are deliberately omitted.
        return {
          safetyClass: 'read_only_governance_projection',
          advisory: true,
          projects: (await this.listProjects(ctx, false)).map(policy.administrationRow),
        };
      },
    },
    forReference: {
      rest: 'GET /refs',
      params: {
        caseId: { ...policy.idParam, optional: true },
        conversationId: { ...policy.idParam, optional: true },
      },
      openapi: projectOpenApi('List visible project refs for a case or conversation', {
        query: ['caseId', 'conversationId'],
        list: true,
        read: true,
      }),
      async handler(ctx) {
        this.validateRefs([ctx.params]);
        return (await this.listProjects(ctx)).filter((project) =>
          project.projectRefs.some(
            (ref) =>
              (!ctx.params.caseId || ref.caseId === ctx.params.caseId) &&
              (!ctx.params.conversationId || ref.conversationId === ctx.params.conversationId)
          )
        );
      },
    },
    update: {
      rest: 'PATCH /:projectId',
      params: { ...projectParams, ...editableParams },
      openapi: projectOpenApi('Update project title, members and structural refs', {
        id: true,
        body: editableSchema,
      }),
      handler(ctx) {
        return this.mutateProject(ctx, async (project) => {
          this.assertMutable(project);
          for (const name of ['title', 'members', 'projectRefs'])
            if (ctx.params[name] !== undefined) project[name] = ctx.params[name];
          this.validateRefs(project.projectRefs);
          await this.persist(ctx, project);
          return policy.publicProject(project);
        });
      },
    },
    archive: {
      rest: 'POST /:projectId/archive',
      params: projectParams,
      openapi: projectOpenApi('Archive a project file and exclude it from routing', { id: true }),
      handler(ctx) {
        return this.mutateProject(ctx, (project) => this.changeLifecycle(ctx, project, 'archived'));
      },
    },
    delete: {
      rest: 'DELETE /:projectId',
      params: projectParams,
      openapi: projectOpenApi('Delete a project file through acknowledged audited cleanup', {
        id: true,
        deleted: true,
      }),
      handler(ctx) {
        return this.mutateProject(ctx, (project, p) => this.deleteProject(ctx, project, p));
      },
    },
    setLifecycle: {
      visibility: 'protected',
      params: { ...projectParams, lifecycle: { type: 'enum', values: policy.lifecycles } },
      handler(ctx) {
        return this.mutateProject(ctx, (project) =>
          this.changeLifecycle(ctx, project, ctx.params.lifecycle)
        );
      },
    },
    registerComponent: {
      visibility: 'protected',
      params: {
        ...projectParams,
        componentId: policy.idParam,
        sensitivityLevel: {
          type: 'enum',
          values: ['public', 'tenant_internal', 'restricted', 'highly_sensitive'],
        },
        requiredClearance: { type: 'array', items: 'string', optional: true, default: [] },
        stats: {
          type: 'object',
          strict: true,
          optional: true,
          default: {},
          props: Object.fromEntries(
            policy.statNames.map((name) => [
              name,
              {
                type: 'number',
                integer: true,
                min: 0,
                max: Number.MAX_SAFE_INTEGER,
                optional: true,
              },
            ])
          ),
        },
        cleanupAction: { type: 'string', pattern: /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*$/ },
      },
      handler(ctx) {
        return this.mutateProject(ctx, async (project, p) => {
          this.assertMutable(project);
          const { componentId, sensitivityLevel, requiredClearance, stats, cleanupAction } =
            ctx.params;
          project.components = {
            ...project.components,
            [`component:${componentId}`]: {
              sensitivityLevel,
              requiredClearance,
              stats,
              cleanupAction,
            },
          };
          return this.recompute(ctx, project, p);
        });
      },
    },
    recomputeClearance: {
      visibility: 'protected',
      params: projectParams,
      handler(ctx) {
        return this.mutateProject(ctx, (project, p) => {
          this.assertMutable(project);
          return this.recompute(ctx, project, p);
        });
      },
    },
    addFile: {
      visibility: 'protected',
      params: { ...projectParams, fileId: { type: 'string', pattern: /^[a-f0-9]{64}$/ } },
      handler(ctx) {
        return this.mutateProject(ctx, async (project, p) => {
          this.assertMutable(project);
          const file = await ctx.call(
            'files.projectDescribe',
            { fileId: ctx.params.fileId },
            { meta: { ...ctx.meta, projectFileOriginals: policy.fileCapability } }
          );
          project.components[`file:${file.fileId}`] = {
            sensitivityLevel: file.sensitivityLevel,
            requiredClearance: file.requiredClearance,
            stats: { files: 1, bytes: file.size },
            cleanupAction: 'files.deleteProject',
          };
          // Persist the confidentiality boundary before exposing a retained original.
          await this.recompute(ctx, project, p);
          await ctx.call(
            'files.retainForProject',
            { projectId: project.projectId, fileId: file.fileId },
            { meta: { ...ctx.meta, projectFileOriginals: policy.fileCapability } }
          );
          return policy.publicProject(project);
        });
      },
    },
  },
  methods: {
    record(ctx, operation, extra = {}) {
      return ctx.call(
        'object-store.projectRecord',
        { operation, ...extra },
        { meta: { ...ctx.meta, projectFileStore: policy.storeCapability } }
      );
    },
    async persist(ctx, project) {
      project.updatedAt = new Date().toISOString();
      const { rev } = await this.record(ctx, 'put', {
        projectId: project.projectId,
        record: project,
      });
      project._rev = rev;
    },
    async loadProject(ctx, p) {
      const project = await this.record(ctx, 'get', { projectId: ctx.params.projectId });
      if (!policy.visibleProject(project, p)) policy.notFound();
      return project;
    },
    async listProjects(ctx, routingOnly = ctx.params.routingOnly) {
      const p = policy.projectPrincipal(ctx);
      return (await this.record(ctx, 'list'))
        .filter(
          (project) =>
            policy.visibleProject(project, p) &&
            (!routingOnly || (project.lifecycle !== 'archived' && !project.deletion))
        )
        .map(policy.publicProject);
    },
    validateRefs(refs) {
      if (refs.some((ref) => !ref.caseId && !ref.conversationId))
        throw new Errors.MoleculerClientError(
          'Case or conversation reference required',
          422,
          'PROJECT_REF_INVALID'
        );
    },
    assertMutable(project) {
      if (project.lifecycle === 'archived' || project.deletion)
        throw new Errors.MoleculerClientError(
          'Project is archived or deleting',
          409,
          'PROJECT_IMMUTABLE'
        );
    },
    async mutateProject(ctx, work) {
      const p = policy.projectPrincipal(ctx);
      const { ingestCapability } = require('../src/project-file-ingest-policy');
      const lock = ctx.meta.projectIngestLock;
      if (
        ctx.meta.projectIngest === ingestCapability &&
        lock?.active &&
        lock.project.tenantId === p.tenantId &&
        lock.project.projectId === ctx.params.projectId
      )
        return work(lock.project, p);
      const key = `${policy.projectPrefix(p.tenantId)}${ctx.params.projectId}`;
      this.projectQueues ||= new Map();
      const previous = this.projectQueues.get(key) || Promise.resolve();
      const job = previous
        .catch(() => {})
        .then(async () => work(await this.loadProject(ctx, p), p));
      this.projectQueues.set(key, job);
      try {
        return await job;
      } finally {
        if (this.projectQueues.get(key) === job) this.projectQueues.delete(key);
      }
    },
    lifecycleEvent(project) {
      return this.broker.emit('project.lifecycle.v1', {
        tenantId: project.tenantId,
        projectId: project.projectId,
        lifecycle: project.lifecycle,
      });
    },
    async changeLifecycle(ctx, project, lifecycle) {
      if (project.deletion || (project.lifecycle === 'archived' && lifecycle !== 'archived'))
        this.assertMutable(project);
      if (project.lifecycle !== lifecycle) {
        project.lifecycle = lifecycle;
        await this.persist(ctx, project);
        await this.lifecycleEvent(project);
      }
      return policy.publicProject(project);
    },
    async recompute(ctx, project, p) {
      project.requiredClearance = policy.componentClearance(project.components, p);
      project.stats = policy.componentStats(project.components);
      project.cleanupActions = [
        ...new Set([
          ...project.cleanupActions,
          ...Object.values(project.components).map((component) => component.cleanupAction),
        ]),
      ];
      await this.persist(ctx, project);
      return policy.publicProject(project);
    },
    async deleteProject(ctx, project, p) {
      const request = { version: 1, tenantId: p.tenantId, projectId: project.projectId };
      const handlers = [...new Set([...project.cleanupActions, ...this.settings.cleanupActions])];
      // The durable marker blocks writes/routing before any external cleanup runs.
      project.deletion = { status: 'pending', failedHandlers: handlers };
      await this.persist(ctx, project);
      try {
        await this.record(ctx, 'audit', {
          projectId: project.projectId,
          decision: 'project.delete.requested',
          metadata: { handlers },
        });
        await this.broker.emit('project.deleting.v1', request);
        const failed = [];
        for (const action of handlers) {
          try {
            const result = await ctx.call(action, request, {
              meta: { ...ctx.meta, projectFileOriginals: policy.fileCapability },
            });
            if (result?.deleted !== true) failed.push(action);
          } catch (_error) {
            failed.push(action);
          }
        }
        if (failed.length) {
          project.deletion.failedHandlers = failed;
          throw new Errors.MoleculerError(
            'Project cleanup incomplete',
            503,
            'PROJECT_DELETE_INCOMPLETE'
          );
        }
        // Audit must succeed before the durable project record is removed.
        await this.record(ctx, 'audit', {
          projectId: project.projectId,
          decision: 'project.delete.cleaned',
          metadata: { handlers, stats: project.stats },
        });
        await this.record(ctx, 'remove', { projectId: project.projectId });
        return { deleted: true, projectId: project.projectId };
      } catch (error) {
        project.deletion.status = 'incomplete';
        await this.persist(ctx, project);
        await this.record(ctx, 'audit', {
          projectId: project.projectId,
          decision: 'project.delete.incomplete',
          metadata: { failedHandlers: project.deletion.failedHandlers },
        });
        throw error;
      }
    },
  },
};
