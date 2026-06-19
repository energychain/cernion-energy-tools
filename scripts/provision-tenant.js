'use strict';

const { upsertTenant } = require('../src/provisioning-registry');
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
  const name = optional(args, 'name', tenantId);
  const tenant = upsertTenant({ tenantId, name });
  printJson({ success: true, tenant });
}

main().catch(fail);
