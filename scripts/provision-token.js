'use strict';

const { ServiceBroker } = require('moleculer');
const TokenManagerService = require('../services/token-manager.service');
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
  const name = required(args, 'name');
  const scope = optional(args, 'scope', 'read-only');
  const email = optional(args, 'email');

  const tenant = upsertTenant({ tenantId, name: optional(args, 'tenant-name', tenantId) });
  const user = upsertUser({ tenantId: tenant.tenantId, userId, email });

  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService(TokenManagerService);
  await broker.start();
  try {
    const created = await broker.call('token-manager.create', {
      name,
      scope,
      tenantId: tenant.tenantId,
      userId: user.userId,
    });
    printJson({
      success: true,
      data: created.data,
      message: created.message,
    });
  } finally {
    await broker.stop();
  }
}

main().catch(fail);
