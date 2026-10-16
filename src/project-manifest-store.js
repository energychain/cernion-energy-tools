'use strict';

const { principal, deny } = require('./domain-router-policy');
const { capability } = require('./project-manifest');
const { idParam } = require('./project-file-policy');

module.exports = {
  actions: {
    projectManifestRecord: {
      visibility: 'protected',
      params: {
        projectId: idParam,
        operation: { type: 'enum', values: ['list', 'put', 'remove'] },
        record: { type: 'object', optional: true },
      },
      async handler(ctx) {
        if (ctx.meta.projectManifest !== capability) deny('Use project manifest workflow');
        const p = principal(ctx);
        const { projectId, operation, record } = ctx.params;
        const prefix = `project-manifest:${encodeURIComponent(p.tenantId)}:${encodeURIComponent(projectId)}:`;
        if (operation === 'put') {
          if (record.tenantId !== p.tenantId || record.projectId !== projectId || !record.key)
            deny('Manifest identity mismatch');
          const _id = prefix + encodeURIComponent(record.key);
          let previous;
          try {
            previous = await this.db.get(_id);
          } catch (error) {
            if (error.status !== 404) throw error;
          }
          await this.db.put({ ...record, _id, _rev: previous?._rev });
          return { written: true };
        }
        const documents = [];
        let after = prefix;
        for (;;) {
          const { rows } = await this.db.allDocs({
            startkey: after,
            endkey: `${prefix}\uffff`,
            include_docs: true,
            limit: 100,
            ...(after === prefix ? {} : { skip: 1 }),
          });
          if (!rows.length) break;
          if (operation === 'remove') {
            const results = await this.db.bulkDocs(
              rows.map(({ doc }) => ({ _id: doc._id, _rev: doc._rev, _deleted: true }))
            );
            if (results.some((result) => result.error)) throw new Error('Manifest cleanup failed');
            after = prefix;
          } else {
            documents.push(...rows.map(({ doc }) => doc));
            after = rows.at(-1).id;
          }
        }
        return operation === 'remove' ? { deleted: true } : documents;
      },
    },
  },
};
