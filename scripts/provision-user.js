'use strict';

const { upsertTenant, upsertUser } = require('../src/provisioning-registry');
const {
  fail,
  optional,
  parseArgs,
  printJson,
  requireSupport,
  required,
} = require('./provisioning-cli-utils');

async function main() {
  const args = parseArgs();
  requireSupport(args);
  const tenantId = required(args, 'tenant');
  const userId = required(args, 'user');
  const email = optional(args, 'email');
  const name = optional(args, 'tenant-name', tenantId);
  const tenant = upsertTenant({ tenantId, name });
  const user = upsertUser({ tenantId: tenant.tenantId, userId, email });
  printJson({ success: true, tenant, user });
}

main().catch(fail);
