'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { principal, deny } = require('./domain-router-policy');

// Only identifier-shaped scalar parameters cross this boundary. Never forward
// free text, nested workbench context, evidence bodies, roles or routing memory.
function parameterIds(knownContext) {
  return Object.fromEntries(
    Object.entries(knownContext || {}).filter(
      ([name, value]) =>
        /(?:Id|Ref)$/.test(name) &&
        !/token|secret|password|key/i.test(name) &&
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 256
    )
  );
}

function caseContextAccess(tenantId, registryFile) {
  if (!fs.existsSync(registryFile)) return 'ids_only';
  const tenants = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  const setting =
    tenants.find((tenant) => tenant.tenantId === tenantId)?.sharedService?.caseContextAccess ??
    'ids_only';
  if (!['ids_only', 'off'].includes(setting)) deny('Invalid case context setting');
  return setting;
}

module.exports = {
  settings: {
    tenantRegistryFile: process.env.CERNION_TENANT_REGISTRY_FILE || './uploads/.api-tenants.json',
  },
  actions: {
    agentCaseContext: {
      visibility: 'protected',
      params: {
        tenantId: 'string',
        functionId: 'string',
        caseId: { type: 'string', min: 1, max: 256 },
      },
      openapi: {
        summary: 'Read only case parameter IDs for a tenant Shared Service agent',
        tags: ['Domain Router'],
      },
      async handler(ctx) {
        const p = principal(ctx, ctx.params);
        const auth = ctx.meta.authUser || ctx.meta.apiToken;
        const agents = this.broker.getLocalService('shared-service-agent');
        const agent =
          agents &&
          (await agents.readDocument(p.tenantId)).agents.find(
            (item) => item.agentId === p.actorId && item.functionId === ctx.params.functionId
          );
        if (!agent || auth.actorType !== 'shared-service-agent' || auth.scope !== 'read-only')
          deny('Read-only Shared Service agent required');
        let allowed = false;
        try {
          if (caseContextAccess(p.tenantId, this.settings.tenantRegistryFile) === 'off')
            deny('Case context access disabled');
          const state = await this.db.get(
            `${encodeURIComponent(p.tenantId)}:${encodeURIComponent(ctx.params.caseId)}`
          );
          if (
            state.tenantId !== p.tenantId ||
            !state.sensitivityFlags.every((flag) => p.clearance.includes(flag))
          )
            deny('Case context not accessible');
          const knownContext = parameterIds(state.knownContext);
          allowed = true;
          return { knownContext };
        } finally {
          // Fail closed if audit persistence fails. No content or IDs in the summary.
          await ctx.call(
            'journal.append',
            {
              entryId: randomUUID(),
              tenantId: p.tenantId,
              agentId: p.actorId,
              functionId: ctx.params.functionId,
              kind: 'observed',
              summary: allowed
                ? 'Fallbezug: ausschließlich Parameter-IDs gelesen.'
                : 'Zugriff auf Fall-Parameter-IDs verweigert.',
              refs: [{ kind: 'case', id: ctx.params.caseId }],
            },
            { meta: ctx.meta }
          );
        }
      },
    },
  },
};
module.exports.parameterIds = parameterIds;
module.exports.caseContextAccess = caseContextAccess;
