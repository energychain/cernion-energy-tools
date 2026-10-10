'use strict';

const policy = require('../src/tenant-memory-policy');
const { principal, deny } = require('../src/domain-router-policy');
async function admin(ctx) {
  const p = principal(ctx);
  if (!p.roles.includes('ROLE_TENANT_ADMIN')) {
    await policy.audit(ctx, p, 'admin_denied', { action: ctx.action.name });
    deny('Tenant administrator required');
  }
  return p;
}
module.exports = {
  name: 'tenant-memory-policy',
  actions: {
    list: {
      rest: 'GET /statements',
      openapi: {
        summary: 'List visible tenant statements with an audit entry',
        tags: ['Tenant Memory Policy'],
      },
      async handler(ctx) {
        return policy.adminList(ctx, await admin(ctx));
      },
    },
    revoke: {
      rest: 'POST /statements/:id/revoke',
      openapi: { summary: 'Audit and revoke a tenant statement', tags: ['Tenant Memory Policy'] },
      params: { id: 'string', reason: { type: 'string', min: 1, max: 1200 } },
      async handler(ctx) {
        return policy.change(ctx, await admin(ctx), ctx.params.id, 'revoked', ctx.params.reason, {
          admin: true,
        });
      },
    },
    delete: {
      rest: 'DELETE /statements/:id',
      openapi: {
        summary: 'Audit and redact a tenant statement, retaining its tombstone',
        tags: ['Tenant Memory Policy'],
      },
      params: { id: 'string', reason: { type: 'string', min: 1, max: 1200 } },
      async handler(ctx) {
        return policy.change(ctx, await admin(ctx), ctx.params.id, 'deleted', ctx.params.reason, {
          admin: true,
        });
      },
    },
    cleanup: {
      rest: 'POST /cleanup',
      openapi: {
        summary: 'Mark exhausted pending assessments failed with an audit entry',
        tags: ['Tenant Memory Policy'],
      },
      async handler(ctx) {
        return policy.cleanup(ctx, await admin(ctx));
      },
    },
  },
};
