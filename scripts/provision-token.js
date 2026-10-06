'use strict';

const { ServiceBroker } = require('moleculer');
const TokenManagerService = require('../services/token-manager.service');
const { validateTokenIdentity } = require('../src/auth/token-policy');
const { upsertTenant, upsertUser } = require('../src/provisioning-registry');
const {
  fail,
  optional,
  parseArgs,
  printJson,
  requireSupport,
  required,
} = require('./provisioning-cli-utils');

async function provisionToken(args, broker) {
  requireSupport(args);

  const tenantId = required(args, 'tenant');
  const userId = required(args, 'user');
  const name = required(args, 'name');
  const scope = optional(args, 'scope', 'full-access');
  const email = optional(args, 'email');
  const scopes = optional(args, 'scopes', '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const roles =
    args.roles === undefined
      ? undefined
      : required(args, 'roles')
          .split(',')
          .map((r) => r.trim());
  const gateway = args.gateway === true;
  const client = optional(args, 'client');
  const support = args.support === true;
  validateTokenIdentity({ gateway, client, roles, support });

  const tenant = upsertTenant({ tenantId, name: optional(args, 'tenant-name', tenantId) });
  const user = upsertUser({ tenantId: tenant.tenantId, userId, email });

  return broker.call('token-manager.createCli', {
    name,
    scope,
    scopes,
    gateway,
    client,
    roles,
    support,
    tenantId: tenant.tenantId,
    userId: user.userId,
  });
}

async function main() {
  const args = parseArgs();
  const broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService(TokenManagerService);
  await broker.start();
  try {
    const created = await provisionToken(args, broker);
    printJson({ success: true, data: created.data, message: created.message });
  } finally {
    await broker.stop();
  }
}

if (require.main === module) main().catch(fail);
module.exports = { provisionToken };
