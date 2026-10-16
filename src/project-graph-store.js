'use strict';
const { principal, deny } = require('./domain-router-policy');
const { idParam } = require('./project-file-policy');
const policy = require('./project-graph-policy');

module.exports = {
  actions: {
    projectGraphRecord: {
      visibility: 'protected',
      params: {
        operation: { type: 'enum', values: ['list', 'write', 'remove'] },
        projectId: idParam,
        documents: { type: 'array', items: 'object', optional: true, default: [] },
        filter: { type: 'object', optional: true, default: {} },
        replace: { type: 'boolean', default: false },
      },
      async handler(ctx) {
        if (ctx.meta.projectGraph !== policy.capability) deny('Use project graph');
        const p = principal(ctx),
          { projectId, operation, filter } = ctx.params;
        const root = policy.prefix(p.tenantId, projectId),
          bounds = policy.limits();
        if (operation !== 'list' && Object.keys(filter).length)
          deny('Mutation filters are not supported');
        if (operation === 'remove') {
          for (;;) {
            const page = await this.db.allDocs({
              startkey: root,
              endkey: `${root}\uffff`,
              include_docs: true,
              limit: bounds.batch,
            });
            if (!page.rows.length) return { deleted: true };
            const results = await this.db.bulkDocs(
              page.rows.map(({ doc }) => ({ _id: doc._id, _rev: doc._rev, _deleted: true }))
            );
            if (results.some((result) => result.error))
              throw new Error('Graph cleanup batch failed');
          }
        }
        const selector = {
          _id: { $gte: root, $lt: `${root}\uffff` },
          tenantId: p.tenantId,
          projectId,
        };
        for (const key of Object.keys(filter)) {
          if (
            !['kind', 'from', 'to', 'relation', 'recordType'].includes(key) ||
            typeof filter[key] !== 'string'
          )
            deny('Invalid graph filter');
          selector[key] = filter[key];
        }
        const { docs } = await this.db.find({ selector, limit: bounds.nodes + bounds.edges + 2 });
        if (docs.length > bounds.nodes + bounds.edges + 1)
          throw new Error('Stored graph exceeds configured limits');
        if (operation === 'list') return docs;
        const current = new Map(docs.map((doc) => [doc._id, doc]));
        const documents =
          operation === 'remove'
            ? docs.map((doc) => ({ _id: doc._id, _rev: doc._rev, _deleted: true }))
            : ctx.params.documents.map((doc) => {
                const id = doc.nodeId || doc.edgeId || 'state';
                if (
                  doc.tenantId !== p.tenantId ||
                  doc.projectId !== projectId ||
                  !['node', 'edge', 'state'].includes(doc.recordType)
                )
                  deny('Graph identity mismatch');
                if (doc.recordType === 'node' && (!doc.nodeId || !policy.kinds.includes(doc.kind)))
                  deny('Invalid graph node');
                if (
                  doc.recordType === 'edge' &&
                  (!doc.edgeId ||
                    !policy.relations.includes(doc.relation) ||
                    !Number.isFinite(doc.weight) ||
                    doc.weight < 0 ||
                    doc.weight > 1)
                )
                  deny('Invalid graph edge');
                const _id = root + encodeURIComponent(id);
                return { ...doc, _id, _rev: current.get(_id)?._rev };
              });
        if (operation === 'write') {
          const merged = new Map([
            ...(ctx.params.replace ? [] : current),
            ...documents.map((doc) => [doc._id, doc]),
          ]);
          for (const [type, max] of [
            ['node', bounds.nodes],
            ['edge', bounds.edges],
          ])
            if ([...merged.values()].filter((doc) => doc.recordType === type).length > max)
              throw new Error('Graph volume limit exceeded');
          if (
            documents.filter((doc) => doc.recordType === 'node').length > bounds.runNodes ||
            documents.filter((doc) => doc.recordType === 'edge').length > bounds.runEdges ||
            documents.length > bounds.runNodes + bounds.runEdges + 1
          )
            throw new Error('Graph run limit exceeded');
        }
        if (ctx.params.replace) {
          const retained = new Set(documents.map((doc) => doc._id));
          const removed = docs
            .filter((doc) => !retained.has(doc._id))
            .map((doc) => ({ _id: doc._id, _rev: doc._rev, _deleted: true }));
          documents.unshift(...removed);
        }
        for (let offset = 0; offset < documents.length; offset += bounds.batch) {
          const results = await this.db.bulkDocs(documents.slice(offset, offset + bounds.batch));
          if (results.some((result) => result.error))
            throw new Error('Graph batch failed; retry required');
        }
        return { written: documents.length };
      },
    },
    projectGraphSources: {
      visibility: 'protected',
      params: { after: { type: 'string', default: '' } },
      async handler(ctx) {
        if (ctx.meta.projectGraph !== policy.capability) deny('Use project graph');
        const { rows } = await this.db.allDocs({
          startkey: ctx.params.after || 'project-object:',
          endkey: 'project-object:\uffff',
          include_docs: true,
          limit: 50,
          ...(ctx.params.after ? { skip: 1 } : {}),
        });
        const records = [];
        for (const { doc } of rows) {
          if (doc.extraction?.status !== 'extracted') continue;
          try {
            const project = await this.db.get(
              require('./project-file-policy').projectPrefix(doc.tenantId) + doc.projectId
            );
            if (project.lifecycle !== 'archived' && !project.deletion)
              records.push({ ...doc, recoveryClearance: project.requiredClearance });
          } catch (error) {
            if (error.status !== 404) throw error;
          }
        }
        return { records, after: rows.at(-1)?.id };
      },
    },
  },
};
