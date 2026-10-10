'use strict';

const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Workbench = require('../services/workbench.service');
const Router = require('../services/domain-router.service');
const PersonalAgent = require('../services/personal-agent.service');

function isolatedSettings(schema, directory, overrides = {}) {
  const settings = Object.assign(
    {},
    ...(schema.mixins || []).map((m) => m.settings),
    schema.settings,
    overrides
  );
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      key === 'dbPath' || key.endsWith('DbPath') ? path.join(directory, schema.name, key) : value,
    ])
  );
}

// Keep live validation persistence isolated while sharing the real evidence facade.
function createLiveHarness(directory, sourceServices) {
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const workbench = broker.createService({
    ...Workbench,
    settings: isolatedSettings(Workbench, directory),
  });
  broker.createService({
    ...Router,
    settings: isolatedSettings(Router, directory, { knowledgeTimeoutMs: 50 }),
  });
  const collector = PersonalAgent.actions.collectWorkbenchEvidence;
  broker.createService({
    name: 'personal-agent',
    methods: PersonalAgent.methods,
    actions: { collectWorkbenchEvidence: collector },
  });
  for (const schema of sourceServices) broker.createService(schema);
  return { broker, workbench };
}
module.exports = { createLiveHarness };
