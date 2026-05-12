'use strict';

const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ZnpService = require('../services/znp.service');

describe('znp tenant isolation', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ZnpService,
      settings: {
        ...ZnpService.settings,
        dbPath: path.join(os.tmpdir(), `cernion-znp-test-${Date.now()}`),
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    if (broker) await broker.stop();
  });

  it('should only list projects belonging to the caller tenant', async () => {
    // Create project for tenant-alpha
    const alpha = await broker.call('znp.createProject', {
      bbox: { south: 50, north: 51, west: 7, east: 8 },
      name: 'Alpha-Projekt',
    }, { meta: { tenantId: 'tenant-alpha' } });

    expect(alpha.projectId).toBeTruthy();

    // Create project for tenant-beta
    const beta = await broker.call('znp.createProject', {
      bbox: { south: 52, north: 53, west: 9, east: 10 },
      name: 'Beta-Projekt',
    }, { meta: { tenantId: 'tenant-beta' } });

    expect(beta.projectId).toBeTruthy();

    // List as alpha — should only see Alpha
    const listAlpha = await broker.call('znp.listProjects', {}, { meta: { tenantId: 'tenant-alpha' } });
    expect(listAlpha.projects.map((p) => p.name)).toEqual(['Alpha-Projekt']);

    // List as beta — should only see Beta
    const listBeta = await broker.call('znp.listProjects', {}, { meta: { tenantId: 'tenant-beta' } });
    expect(listBeta.projects.map((p) => p.name)).toEqual(['Beta-Projekt']);

    // List as default — should see neither (they belong to alpha/beta)
    const listDefault = await broker.call('znp.listProjects', {}, { meta: {} });
    const defaultNames = listDefault.projects.map((p) => p.name);
    expect(defaultNames).not.toContain('Alpha-Projekt');
    expect(defaultNames).not.toContain('Beta-Projekt');
  });

  it('should block getProjectMeta for a foreign tenant', async () => {
    const created = await broker.call('znp.createProject', {
      bbox: { south: 50, north: 51, west: 7, east: 8 },
      name: 'Guard-Projekt',
    }, { meta: { tenantId: 'owner-tenant' } });

    await expect(
      broker.call('znp.getProjectMeta', { projectId: created.projectId }, { meta: { tenantId: 'intruder-tenant' } })
    ).rejects.toThrow(/not found/);
  });

  it('should block deleteProject for a foreign tenant', async () => {
    const created = await broker.call('znp.createProject', {
      bbox: { south: 50, north: 51, west: 7, east: 8 },
      name: 'Delete-Guard',
    }, { meta: { tenantId: 'owner-tenant' } });

    await expect(
      broker.call('znp.deleteProject', { projectId: created.projectId }, { meta: { tenantId: 'intruder-tenant' } })
    ).rejects.toThrow(/not found/);
  });

  it('should isolate legacy projects without tenantId to default tenant only', async () => {
    // Simulate a legacy project by injecting into activeGraphs directly
    const svc = broker.getLocalService('znp');
    const legacyId = 'legacy-project-001';
    svc.activeGraphs.set(legacyId, {
      graph: { order: 0, size: 0, forEachNode: () => {}, forEachEdge: () => {} },
      name: 'Legacy Projekt',
      bbox: {},
      createdAt: new Date().toISOString(),
      tenantId: null, // no tenant — legacy
      layers: [],
      layer1GFactorAdjustment: 1.0,
      layer2CalibrationFactor: 0,
    });

    // Default tenant should see it
    const listDefault = await broker.call('znp.listProjects', {}, { meta: { tenantId: 'default' } });
    expect(listDefault.projects.map((p) => p.name)).toContain('Legacy Projekt');

    // Other tenants must NOT see it
    const listOther = await broker.call('znp.listProjects', {}, { meta: { tenantId: 'other-tenant' } });
    expect(listOther.projects.map((p) => p.name)).not.toContain('Legacy Projekt');

    svc.activeGraphs.delete(legacyId);
  });
});
