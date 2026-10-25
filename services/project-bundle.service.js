'use strict';

const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { principal, deny } = require('../src/domain-router-policy');
const { projectBundleIntent } = require('../src/project-bundle-intent');
const { bundleSummary } = require('../src/project-bundle-chat');
const { idParam } = require('../src/project-file-policy');
const { hashParam, uploadParam } = require('../src/project-file-ingest-policy');
const conversation = { conversationId: idParam };
const action = (params, handler) => ({
  visibility: 'protected',
  params,
  handler,
  openapi: require('../src/project-bundle-openapi').bundleOpenApi(params),
});

module.exports = {
  name: 'project-bundle',
  dependencies: ['workbench', 'project-file', 'project-upload'],
  mixins: [createPouchDbLifecycleMixin({ defaultDbPath: './data/project-bundle' })],
  actions: {
    prepare: action(
      {
        ...conversation,
        message: { type: 'string', min: 1, max: 32000 },
        files: { type: 'array', max: 10000, optional: true, default: [] },
      },
      async function (ctx) {
        const identity = await this.identity(ctx);
        return this.serial(identity.key, () => this.prepare(ctx, identity));
      }
    ),
    start: action({ ...conversation, sourceId: idParam, hash: hashParam }, async function (ctx) {
      const identity = await this.identity(ctx);
      return this.serial(identity.key, async () => {
        const state = await this.state(identity.key);
        const file = state.files?.find((f) => f.id === ctx.params.sourceId);
        if (!file || state.mode !== 'upload') deny('No project upload requested');
        if (file.hash && file.hash !== ctx.params.hash) deny('Original changed; resend the bundle');
        const result = await ctx.call(
          'project-upload.start',
          {
            projectId: state.projectId,
            name: file.name,
            size: file.size,
            hash: ctx.params.hash,
          },
          { meta: identity.meta }
        );
        file.hash = ctx.params.hash;
        file.uploadId = result.uploadId;
        await this.db.put(state);
        return result;
      });
    }),
    chunk: action(
      {
        ...conversation,
        uploadId: uploadParam,
        index: { type: 'number', integer: true, min: 0, convert: true },
        hash: hashParam,
        stream: { type: 'any' },
      },
      async function (ctx) {
        const identity = await this.identity(ctx);
        await this.boundUpload(ctx, identity);
        return ctx.call(
          'project-upload.chunk',
          { uploadId: ctx.params.uploadId, index: ctx.params.index, hash: ctx.params.hash },
          { meta: identity.meta, stream: ctx.params.stream }
        );
      }
    ),
    complete: action({ ...conversation, uploadId: uploadParam }, async function (ctx) {
      const identity = await this.identity(ctx);
      await this.boundUpload(ctx, identity);
      return ctx.call(
        'project-upload.complete',
        { uploadId: ctx.params.uploadId },
        { meta: identity.meta }
      );
    }),
    status: action({ ...conversation, uploadId: uploadParam }, async function (ctx) {
      const identity = await this.identity(ctx);
      await this.boundUpload(ctx, identity);
      return ctx.call(
        'project-upload.status',
        { uploadId: ctx.params.uploadId },
        { meta: identity.meta }
      );
    }),
    result: action(conversation, async function (ctx) {
      const identity = await this.identity(ctx);
      const state = await this.state(identity.key);
      if (!state.mode) deny('No bundle turn');
      if (state.mode !== 'upload') return { mode: state.mode, reply: state.reply };
      const project = await ctx.call(
        'project-file.get',
        { projectId: state.projectId },
        { meta: identity.meta }
      );
      const objects = await ctx.call(
        'project-upload.objects',
        { projectId: state.projectId },
        { meta: identity.meta }
      );
      let manifest = null;
      try {
        manifest = await ctx.call(
          'project-manifest.get',
          { projectId: state.projectId },
          { meta: identity.meta }
        );
      } catch (error) {
        if (error.code !== 404 && error.type !== 'SERVICE_NOT_FOUND') throw error;
      }
      return {
        mode: 'upload',
        projectId: state.projectId,
        objects,
        manifest,
        reply: bundleSummary(project, objects, manifest),
        done:
          (!this.broker.getLocalService('project-manifest') ||
            Boolean(manifest) ||
            objects.every((o) => o.status === 'failed')) &&
          project.lifecycle !== 'ingesting' &&
          objects.every(
            (o) => !['queued', 'processing'].includes(o.ingestState) && o.status !== 'receiving'
          ),
      };
    }),
    deleteProject: {
      visibility: 'protected',
      params: { projectId: idParam, tenantId: idParam, version: { type: 'number', equal: 1 } },
      async handler(ctx) {
        const policy = require('../src/project-file-policy');
        if (ctx.meta.projectFileOriginals !== policy.fileCapability) deny('Use project deletion');
        const p = policy.projectPrincipal(ctx);
        const prefix = ['bundle', p.tenantId].map(encodeURIComponent).join(':') + ':';
        const rows = await this.db.allDocs({
          startkey: prefix,
          endkey: prefix + '\uffff',
          include_docs: true,
        });
        for (const { doc } of rows.rows) {
          if (doc.projectId === ctx.params.projectId) await this.db.remove(doc);
          else if (doc.receipts?.some((r) => r.projectId === ctx.params.projectId)) {
            doc.receipts = doc.receipts.filter((r) => r.projectId !== ctx.params.projectId);
            await this.db.put(doc);
          }
        }
        await this.db.compact();
        return { deleted: true };
      },
    },
    receipts: action(conversation, async function (ctx) {
      const p = principal(ctx);
      const state = await this.state(this.key(p, ctx.params.conversationId));
      return (state.receipts || [])
        .concat(state.files || [])
        .filter((f) => f.hash && f.uploadId)
        .map((f) => ({
          sourceId: f.id,
          hash: f.hash,
          textHash: f.textHash,
          projectId: f.projectId || state.projectId,
          uploadId: f.uploadId,
        }));
    }),
  },
  methods: {
    key(p, conversationId) {
      return ['bundle', p.tenantId, p.actorId, conversationId].map(encodeURIComponent).join(':');
    },
    async identity(ctx) {
      const token = ctx.meta.apiToken;
      const headers = ctx.meta.requestHeaders || {};
      const wb = this.broker.getLocalService('workbench');
      const { p, mapping } = await wb.resolveTurnPrincipal(ctx, {
        channel: 'open-webui',
        openWebuiOrgId: ctx.params.openWebuiOrgId ?? token?.externalOrgId,
        openWebuiUserId: ctx.params.openWebuiUserId ?? headers['x-openwebui-user-id'],
        openWebuiUserEmail: headers['x-openwebui-user-email'],
      });
      return {
        p,
        meta: wb.metaForMapping(ctx, p, mapping),
        key: this.key(p, ctx.params.conversationId),
      };
    },
    async state(key) {
      try {
        return await this.db.get(key);
      } catch (error) {
        if (error.status !== 404) throw error;
        return { _id: key };
      }
    },
    async serial(key, work) {
      this.queues ||= new Map();
      const next = (this.queues.get(key) || Promise.resolve()).catch(() => {}).then(work);
      this.queues.set(key, next);
      try {
        return await next;
      } finally {
        if (this.queues.get(key) === next) this.queues.delete(key);
      }
    },
    async boundUpload(ctx, identity) {
      const state = await this.state(identity.key);
      if (!state.files?.some((f) => f.uploadId === ctx.params.uploadId))
        deny('Upload not bound to this person and conversation');
    },
    validateFiles(files) {
      const ids = new Set();
      for (const f of files) {
        if (
          !f ||
          typeof f.id !== 'string' ||
          !f.id ||
          f.id.length > 200 ||
          ids.has(f.id) ||
          !Number.isSafeInteger(f.size) ||
          f.size < 1 ||
          f.size > 2 * 1024 ** 3 ||
          (f.textHash != null && !/^[a-f0-9]{64}$/.test(f.textHash)) ||
          (f.hash != null && !/^[a-f0-9]{64}$/.test(f.hash))
        )
          deny('Invalid original file metadata');
        require('../src/project-file-ingest-policy').safeName(f.name);
        ids.add(f.id);
      }
      return files.map(({ id, name, size, textHash, hash }) => ({
        id,
        name,
        size,
        ...(textHash ? { textHash } : {}),
        ...(hash ? { hash } : {}),
      }));
    },
    async prepare(ctx, identity) {
      const state = await this.state(identity.key);
      const files = this.validateFiles(ctx.params.files);
      if (!files.length && state.mode !== 'ask') return { mode: 'passthrough' };
      const intent = await projectBundleIntent(
        ctx.params.message,
        state.mode === 'ask',
        identity.p.tenantId
      );
      if (intent.action === 'decline') {
        state.mode = 'declined';
        state.reply = 'Die Dateien werden nicht als Projektakte abgelegt.';
      } else if (['create', 'append', 'accept'].includes(intent.action)) {
        const selected = files.length ? files : state.files || [];
        if (!selected.length) return { mode: 'passthrough' };
        if (
          state.mode !== 'upload' ||
          !this.sameFiles(selected, state.files) ||
          (intent.title && intent.title !== state.title)
        ) {
          let project;
          if (intent.action === 'append') {
            const projects = await ctx.call('project-file.list', {}, { meta: identity.meta });
            const matches = projects.filter((p) => p.title === intent.title);
            if (matches.length !== 1)
              deny('Akte nicht eindeutig gefunden. Bitte den genauen Namen angeben.');
            project = matches[0];
            if (
              !project.projectRefs.some((ref) => ref.conversationId === ctx.params.conversationId)
            ) {
              project = await ctx.call(
                'project-file.update',
                {
                  projectId: project.projectId,
                  projectRefs: [
                    ...project.projectRefs,
                    { conversationId: ctx.params.conversationId },
                  ],
                },
                { meta: identity.meta }
              );
            }
          } else {
            project = await ctx.call(
              'project-file.create',
              {
                title: intent.title || 'Projektakte',
                members: [identity.p.actorId],
                projectRefs: [{ conversationId: ctx.params.conversationId }],
              },
              { meta: identity.meta }
            );
          }
          state.receipts = (state.receipts || []).concat(
            (state.files || [])
              .filter((f) => f.hash)
              .map((f) => ({ ...f, projectId: state.projectId }))
          );
          state.projectId = project.projectId;
          state.title = project.title;
          state.files = selected;
        }
        await ctx.call(
          'project-file.registerComponent',
          {
            projectId: state.projectId,
            componentId: 'openwebui-bundle',
            sensitivityLevel: 'tenant_internal',
            cleanupAction: 'project-bundle.deleteProject',
          },
          { meta: identity.meta }
        );
        state.files = this.rebindFiles(selected, state.files);
        state.mode = 'upload';
      } else if (state.mode === 'upload' && files.length && this.sameFiles(files, state.files)) {
        // A retry may carry fresh OWUI IDs for the same original bytes.
        state.files = this.rebindFiles(files, state.files);
      } else if (!state.asked && (files.length > 1 || files.some((f) => f.size > 10 * 1024 ** 2))) {
        state.asked = true;
        state.mode = 'ask';
        state.files = files;
        state.reply = 'Soll ich das als Projektakte anlegen?';
      } else return { mode: 'passthrough' };
      await this.db.put(state);
      return {
        mode: state.mode,
        projectId: state.projectId,
        files: state.files,
        reply: state.reply,
      };
    },
    sameOriginal(a, b) {
      return (
        a.size === b.size &&
        a.name === b.name &&
        (a.hash && b.hash ? a.hash === b.hash : a.id === b.id)
      );
    },
    rebindFiles(files, previous) {
      return files.map((file) => ({
        ...previous.find((old) => this.sameOriginal(file, old)),
        ...file,
      }));
    },
    sameFiles(a, b = []) {
      return a.length === b.length && a.every((f) => b.some((g) => this.sameOriginal(f, g)));
    },
  },
};
