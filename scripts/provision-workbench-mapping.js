'use strict';

const { ServiceBroker } = require('moleculer');
const { parseArgs, requireSupport, printJson, fail } = require('./provisioning-cli-utils');
const { applyMapping } = require('../src/workbench-provisioning');
const {
  callLocalProvisioning,
  socketPath,
  isDatabaseLocked,
} = require('../src/local-provisioning-channel');
const { apiMappingBroker } = require('../src/provisioning-api-client');

async function provisionMapping(args, broker) {
  requireSupport(args);
  return applyMapping(args, broker);
}

async function main() {
  const args = parseArgs();
  if (args['via-api'] === true) {
    printJson(await applyMapping(args, apiMappingBroker(args)));
    return;
  }
  requireSupport(args);
  const live = await callLocalProvisioning(socketPath(), args);
  if (live !== null) {
    printJson(live);
    return;
  }
  // Load service only after dotenv and online discovery; never open another DB online.
  const WorkbenchService = require('../services/workbench.service');
  const broker = new ServiceBroker({ logger: false, transporter: null });
  try {
    broker.createService({ ...WorkbenchService, settings: { provisioningChannelEnabled: false } });
    await broker.start();
    printJson(await provisionMapping(args, broker));
  } catch (error) {
    if (isDatabaseLocked(error)) {
      throw new Error(
        'Dienst läuft – bitte über API oder mit --via-api --url=http://127.0.0.1:3000 --token=... aufrufen. Der lokale Admin-Kanal ist nicht verfügbar.'
      );
    }
    throw error;
  } finally {
    await broker.stop();
  }
}

if (require.main === module) main().catch(fail);
module.exports = { provisionMapping };
