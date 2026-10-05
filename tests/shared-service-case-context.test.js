'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const { parameterIds } = require('../src/shared-service-case-context');
const { memoryPouch } = require('./helpers/shared-service/memory-pouch');
let broker, dir, db, journal, agent, state;
const call = (auth = agent, extra = {}) =>
  broker.call(
    'domain-router.agentCaseContext',
    { tenantId: 'tenant-a', functionId: 'fn-a', caseId: 'case-a', ...extra },
    { meta: { authUser: auth } }
  );
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ids-only-'));
  const Pouch = memoryPouch();
  db = new Pouch('cases');
  journal = jest.fn(() => ({}));
  agent = {
    tenantId: 'tenant-a',
    id: 'agent-a',
    actorType: 'shared-service-agent',
    roles: ['ROLE_USER'],
    scope: 'read-only',
    sensitivityFlags: [],
  };
  state = {
    _id: 'tenant-a:case-a',
    tenantId: 'tenant-a',
    actorId: 'human-a',
    accessRoles: ['ROLE_USER'],
    sensitivityFlags: [],
    knownContext: {
      assetId: 'asset-a',
      processRef: 'process-a',
      subject: 'SECRET CONTENT',
      nested: { value: 'SECRET CONTENT' },
      evidence: 'SECRET CONTENT',
    },
  };
  await db.put(state);
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.createService({
    ...Router,
    mixins: [Router.mixins[0]],
    created() {
      this.db = db;
    },
    started() {},
    stopped() {},
    settings: { tenantRegistryFile: path.join(dir, 'tenants.json') },
  });
  broker.createService({
    name: 'shared-service-agent',
    methods: {
      async readDocument() {
        return { agents: [{ agentId: 'agent-a', functionId: 'fn-a' }] };
      },
    },
  });
  broker.createService({ name: 'journal', actions: { append: { handler: journal } } });
  await broker.start();
});
afterEach(async () => {
  await broker.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});
test('ids_only default: own-tenant agent receives scalar parameter IDs, never case contents; ordinary visibility unchanged', async () => {
  expect(await call()).toEqual({ knownContext: { assetId: 'asset-a', processRef: 'process-a' } });
  expect(journal).toHaveBeenCalledTimes(1);
  expect(journal.mock.calls[0][0].params).toMatchObject({
    functionId: 'fn-a',
    agentId: 'agent-a',
    summary: expect.stringContaining('Parameter-IDs gelesen'),
  });
  const p = require('../src/domain-router-policy').principal({ meta: { authUser: agent } });
  await expect(broker.getLocalService('domain-router').loadCase(p, 'case-a')).rejects.toThrow(
    'Case not accessible'
  );
});
test('off and invalid tenant settings fail closed and journal each attempt', async () => {
  for (const setting of ['off', 'invalid']) {
    fs.writeFileSync(
      path.join(dir, 'tenants.json'),
      JSON.stringify([{ tenantId: 'tenant-a', sharedService: { caseContextAccess: setting } }])
    );
    await expect(call()).rejects.toThrow();
  }
  expect(journal).toHaveBeenCalledTimes(2);
});
test('clearance, tenant equality, actual agent identity and read-only scope remain mandatory', async () => {
  const doc = await db.get(state._id);
  await db.put({ ...doc, sensitivityFlags: ['confidential'] });
  await expect(call()).rejects.toThrow('Case context not accessible');
  expect(journal).toHaveBeenCalledTimes(1);
  await expect(call({ ...agent, sensitivityFlags: ['confidential'] })).resolves.toMatchObject({
    knownContext: { assetId: 'asset-a' },
  });
  await expect(call(agent, { tenantId: 'tenant-b' })).rejects.toThrow('Tenant mismatch');
  await expect(call({ ...agent, id: 'human-a' })).rejects.toThrow(
    'Read-only Shared Service agent required'
  );
  await expect(call({ ...agent, scope: 'full-access' })).rejects.toThrow(
    'Read-only Shared Service agent required'
  );
  await expect(call(agent, { functionId: 'fn-other' })).rejects.toThrow(
    'Read-only Shared Service agent required'
  );
});
test('audit failure prevents returning identifiers; nested/secret/non-ID parameters are excluded', async () => {
  journal.mockImplementation(() => {
    throw new Error('Audit unavailable');
  });
  await expect(call()).rejects.toThrow('Audit unavailable');
  expect(
    parameterIds({
      tokenId: 'secret',
      assetId: ['nested'],
      ownerId: { value: 'secret' },
      stationId: 'station-a',
      body: 'secret',
      accessRole: 'ROLE_ADMIN',
    })
  ).toEqual({ stationId: 'station-a' });
});
