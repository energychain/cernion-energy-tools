'use strict';

const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
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
  const budget = require('./live-validation-budget').installLiveBudget();
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const call = broker.call.bind(broker);
  const cleanup = new AsyncLocalStorage();
  broker.call = async (...args) => {
    if (!cleanup.getStore()) budget.assertReady();
    const result = await call(...args);
    if (!cleanup.getStore()) budget.assertReady();
    return result;
  };
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
  const cleanupCall = (name, params, options) => {
    if (
      ![
        'tenant-memory-policy.list',
        'tenant-memory-policy.delete',
        'files.remove',
        'project-file.delete',
        'dataset.turn',
        'datapoint.datasetCatalog',
        'workbench.chat',
        'journal.append',
      ].includes(name)
    )
      throw new Error('Only audited cleanup actions are available');
    if (name === 'workbench.chat' && params.userRequest !== 'Kein Fall')
      throw new Error('Cleanup chat is limited to case discard');
    if (name === 'datapoint.datasetCatalog' && params.operation !== 'list')
      throw new Error('Cleanup catalog access is read-only');
    if (name === 'dataset.turn' && !/^Bitte Datensatz .+ löschen\.$/u.test(params.question))
      throw new Error('Cleanup dataset action is limited to deletion');
    return cleanup.run(true, () => call(name, params, options));
  };
  const drainDescriptors = async () => {
    for (const service of broker.services) {
      while (service.evidenceWorker?.pending.size || service.evidenceWorker?.running) {
        await require('../src/tenant-evidence-background').runDescriptorJob(service);
      }
    }
  };
  return { broker, workbench, cleanupCall, drainDescriptors };
}
module.exports = { createLiveHarness, isolatedSettings };
