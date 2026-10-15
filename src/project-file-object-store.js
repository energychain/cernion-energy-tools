'use strict';

const { principal, deny } = require('./domain-router-policy');
const { idParam } = require('./project-file-policy');
const { objectCapability, ingestError } = require('./project-file-ingest-policy');

module.exports = {
  actions: {
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
