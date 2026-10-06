'use strict';

const { ServiceBroker } = require('moleculer');
const WorkbenchService = require('../services/workbench.service');
const { normalizeTenantId, tenantExistsInRegistry } = require('../src/provisioning-registry');
const {
  parseArgs,
  required,
  optional,
  requireSupport,
  printJson,
  fail,
} = require('./provisioning-cli-utils');

async function provisionMapping(args, broker) {
  requireSupport(args);
  const tenantId = normalizeTenantId(required(args, 'tenant'));
  if (!tenantExistsInRegistry(tenantId))
    throw new Error('Create the tenant/token before mapping users.');
  const client = optional(args, 'client', 'open-webui');
  if (args.list === true) {
    const rows = await broker
      .getLocalService('workbench')
      .identityDb.allDocs({ include_docs: true });
    return {
      tenantId,
      mappings: rows.rows
        .map((row) => row.doc)
        .filter(
          (doc) =>
            ['workbench_tenant_mapping', 'workbench_user_mapping'].includes(doc.type) &&
            doc.cetTenantId === tenantId &&
            doc.client === client
        ),
    };
  }
  // Local bootstrap authenticates with the existing support secret, then calls
  // the actual admin actions. Their validation and tenant isolation are shared.
  const meta = {
    authUser: {
      tenantId,
      userId: 'svc:workbench-bootstrap',
      roles: ['ROLE_TENANT_ADMIN'],
    },
  };
  const externalOrgId = required(args, 'org');
  const user = {
    client,
    externalOrgId,
    cetTenantId: tenantId,
    externalUserId: required(args, 'user'),
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

async function main() {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService(WorkbenchService);
  await broker.start();
  try {
    printJson(await provisionMapping(parseArgs(), broker));
  } finally {
    await broker.stop();
  }
}

if (require.main === module) main().catch(fail);
module.exports = { provisionMapping };
