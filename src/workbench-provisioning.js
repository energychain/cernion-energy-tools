'use strict';

const { normalizeTenantId, tenantExistsInRegistry } = require('./provisioning-registry');
const { required, optional } = require('../scripts/provisioning-cli-utils');

function mappingMeta(tenantId) {
  return {
    authUser: { tenantId, userId: 'svc:workbench-bootstrap', roles: ['ROLE_TENANT_ADMIN'] },
  };
}

async function applyMapping(args, broker) {
  const tenantId = normalizeTenantId(required(args, 'tenant'));
  if (!broker.remote && !tenantExistsInRegistry(tenantId))
    throw new Error('Create the tenant/token before mapping users.');
  const client = optional(args, 'client', 'open-webui');
  if (args.list === true) {
    return broker.call(
      'workbench.admin.mappings.list',
      { tenantId, client },
      { meta: mappingMeta(tenantId) }
    );
  }
  // Local bootstrap authenticates with the existing support secret, then calls
  // the actual admin actions. Their validation and tenant isolation are shared.
  const meta = mappingMeta(tenantId);
  const externalOrgId = required(args, 'org');
  const user = {
    client,
    externalOrgId,
    cetTenantId: tenantId,
    externalUserId: optional(args, 'user'),
    externalUserEmail: optional(args, 'email'),
    cetActorId: required(args, 'actor'),
    roles: required(args, 'roles')
      .split(',')
      .map((value) => value.trim()),
    sensitivityClearance: optional(args, 'clearance', '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
  await broker.call(
    'workbench.admin.tenantMappings.create',
    {
      client,
      externalOrgId,
      cetTenantId: tenantId,
    },
    { meta }
  );
  return broker.call('workbench.admin.userMappings.create', user, { meta });
}

module.exports = { applyMapping };
