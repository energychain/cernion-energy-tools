'use strict';

const { principal, deny } = require('./domain-router-policy');
const { DecisionEvidenceAuditTrail } = require('./decision-evidence-audit-trail');
const { storeCapability, projectPrefix, idParam, notFound } = require('./project-file-policy');

// Additive storage adapter on the existing Object Store DB. Its lifecycle remains
// exclusively owned by createPouchDbLifecycleMixin; this adapter opens no handle.
module.exports = {
  actions: {
    projectRecord: {
      visibility: 'protected',
      params: {
        operation: { type: 'enum', values: ['get', 'list', 'put', 'remove', 'audit'] },
        projectId: { ...idParam, optional: true },
        record: { type: 'object', optional: true },
        decision: { type: 'string', optional: true },
        metadata: { type: 'object', optional: true },
      },
      async handler(ctx) {
        if (ctx.meta.projectFileStore !== storeCapability) deny('Use the project workflow');
        const p = principal(ctx);
        const { operation, projectId, record } = ctx.params;
        const prefix = projectPrefix(p.tenantId);
        if (operation === 'list') {
          const { rows } = await this.db.allDocs({
            startkey: prefix,
            endkey: `${prefix}\uffff`,
            include_docs: true,
          });
          return rows.map((row) => row.doc);
        }
        if (!projectId) notFound();
        if (operation === 'audit') {
          return new DecisionEvidenceAuditTrail(this.db).appendEntry({
            tenantId: p.tenantId,
            entityId: projectId,
            actor: p.actorId,
            role: p.roles.join(','),
            decision: ctx.params.decision,
            metadata: ctx.params.metadata || {},
          });
        }
        const _id = `${prefix}${projectId}`;
        if (operation === 'put') {
          if (record.tenantId !== p.tenantId || record.projectId !== projectId)
            deny('Tenant mismatch');
          return this.db.put({ ...record, _id });
        }
        let current;
        try {
          current = await this.db.get(_id);
        } catch (error) {
          if (error.status === 404) notFound();
          throw error;
        }
        if (operation === 'remove') return this.db.remove(current);
        return current;
      },
    },
  },
};
