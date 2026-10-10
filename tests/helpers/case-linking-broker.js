'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Router = require('../../services/domain-router.service');
const Workbench = require('../../services/workbench.service');

const auth = (
  actorId = 'actor-a',
  roles = ['ROLE_ALPHA'],
  tenantId = 'tenant-a',
  clearance = []
) => ({
  apiToken: { id: actorId, tenantId, roles, sensitivityFlags: clearance, scope: 'agentos-session' },
});

async function createCaseBroker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-753-'));
  const registry = path.join(dir, 'tenants.json');
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const router = broker.createService({
    ...Router,
    settings: {
      ...Router.settings,
      dbPath: path.join(dir, 'cases'),
      eventsDbPath: path.join(dir, 'events'),
      tenantRegistryFile: registry,
    },
  });
  const settings = Object.assign(
    {},
    ...Workbench.mixins.map((mixin) => mixin.settings || {}),
    Workbench.settings
  );
  for (const name of Object.keys(settings))
    if (name === 'dbPath' || name.endsWith('DbPath')) settings[name] = path.join(dir, name);
  const workbench = broker.createService({ ...Workbench, settings });
  broker.createService({
    name: 'capability-broker',
    actions: { recommend: () => ({ recommendedCapabilities: [] }) },
  });
  broker.createService({
    name: 'agent-receipts',
    actions: { select: () => ({ data: { selected: false } }) },
  });
  broker.createService({
    name: 'personal-agent',
    actions: {
      collectWorkbenchEvidence: () => ({ evidence: [], trace: [] }),
      chat: () => ({ reply: 'Unverbindliche Antwort.' }),
    },
  });
  const policy = (caseVisibility, identifierTypes = {}) =>
    fs.writeFileSync(
      registry,
      JSON.stringify([
        {
          tenantId: 'tenant-a',
          sharedService: {
            caseVisibility,
            identifierTypes: Object.fromEntries(
              [...new Set(['reference-a', 'reference-b', ...Object.keys(identifierTypes)])].map(
                (kind) => [
                  kind,
                  {
                    ...(['reference-a', 'reference-b'].includes(kind)
                      ? { strength: 'strong' }
                      : {}),
                    ...identifierTypes[kind],
                  },
                ]
              )
            ),
          },
        },
      ])
    );
  policy();
  const call = (action, params, meta = auth()) =>
    broker.call(action, params, { meta: structuredClone(meta) });
  const create = (ids, meta = auth(), extra = {}) =>
    call(
      'domain-router.classify',
      {
        userRequest: 'RAW-CONTENT-PRIVATE anonymous document',
        disableKnowledgeRouting: true,
        knownContext: {
          identifiers: ids,
          situation: { situation: 'Anonymisierte Lagebild-Zusammenfassung.', identifiers: ids },
        },
        ...extra,
      },
      meta
    );
  const cleanup = async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { broker, router, workbench, dir, registry, policy, call, create, cleanup };
}
module.exports = { auth, createCaseBroker };
