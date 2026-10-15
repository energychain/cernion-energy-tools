'use strict';

const { principal, deny } = require('./domain-router-policy');
const { idParam } = require('./project-file-policy');
const { objectCapability, ingestError } = require('./project-file-ingest-policy');

module.exports = {
  actions: {
    projectStructurePending: {
      visibility: 'protected',
      params: {
        after: { type: 'string', optional: true, default: '' },
        limit: { type: 'number', integer: true, min: 1, max: 100, default: 50 },
      },
      async handler(ctx) {
        if (ctx.meta.projectStructure !== require('./project-structure-policy').capability)
          deny('Use project structure');
        const { rows } = await this.db.allDocs({
          startkey: ctx.params.after || 'project-object:',
          endkey: 'project-object:\uffff',
          include_docs: true,
          limit: ctx.params.limit,
          ...(ctx.params.after ? { skip: 1 } : {}),
        });
        const records = [];
        for (const { doc: object } of rows) {
          if (
            object.status !== 'received' ||
            (require('./project-structure-policy').completed(object) &&
              !['queued', 'processing'].includes(object.ingestState))
          )
            continue;
          let project;
          try {
            project = await this.db.get(
              require('./project-file-policy').projectPrefix(object.tenantId) + object.projectId
            );
          } catch (error) {
            if (error.status === 404) continue;
            throw error;
          }
          if (project.lifecycle === 'archived' || project.deletion) continue;
          records.push({ ...object, recoveryClearance: project.requiredClearance });
        }
        return {
          after: rows.at(-1)?.id,
          records,
        };
      },
    },
    projectObjectRecord: {
      visibility: 'protected',
      params: {
        operation: { type: 'enum', values: ['get', 'put', 'list', 'remove'] },
        projectId: { ...idParam, optional: true },
        recordId: { ...idParam, optional: true },
        record: { type: 'object', optional: true },
      },
      async handler(ctx) {
        if (ctx.meta.projectObjectStore !== objectCapability) deny('Use project ingest');
        const p = principal(ctx);
        const { operation, projectId, recordId, record } = ctx.params;
        const root = `project-object:${encodeURIComponent(p.tenantId)}:`;
        const prefix = projectId ? `${root}${encodeURIComponent(projectId)}:` : root;
        if (operation === 'list') {
          const { rows } = await this.db.allDocs({
            startkey: prefix,
            endkey: `${prefix}\uffff`,
            include_docs: true,
          });
          return rows.map((row) => row.doc);
        }
        if (!projectId || !recordId) ingestError('Missing object identity');
        const _id = `${prefix}${encodeURIComponent(recordId)}`;
        if (operation === 'put') {
          if (
            record.tenantId !== p.tenantId ||
            record.projectId !== projectId ||
            record.objectId !== recordId
          )
            deny('Object identity mismatch');
          return this.db.put({ ...record, _id });
        }
        let current;
        try {
          current = await this.db.get(_id);
        } catch (error) {
          if (error.status === 404)
            ingestError('Upload not found', 404, 'PROJECT_UPLOAD_NOT_FOUND');
          throw error;
        }
        return operation === 'remove' ? this.db.remove(current) : current;
      },
    },
  },
};
