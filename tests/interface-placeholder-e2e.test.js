'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ApiService = require('../services/api.service');
const ObjectStoreService = require('../services/object-store.service');
const InterfacePlaceholderService = require('../services/interface-placeholder.service');

describe('interface-placeholder api integration', () => {
  let broker;
  let objectStorePath;

  beforeAll(async () => {
    objectStorePath = path.join(os.tmpdir(), `interface-placeholder-api-${Date.now()}`);
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...ApiService,
      settings: {
        ...ApiService.settings,
        port: 0,
      },
    });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: objectStorePath,
      },
    });
    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler() {
            return { success: true, item: { id: 'hitl-test', status: 'pending' } };
          },
        },
      },
    });
    broker.createService(InterfacePlaceholderService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(objectStorePath, { recursive: true, force: true });
  });

  it('exposes interface-placeholder routes in explicit api aliases', () => {
    const apiRoute = ApiService.settings.routes.find((route) => route.path === '/api');
    const aliases = apiRoute?.aliases || {};

    expect(aliases['POST /interface-placeholder/mark-gap']).toBe('interface-placeholder.markGap');
    expect(aliases['POST /interface-placeholder/request-evidence']).toBe(
      'interface-placeholder.requestEvidence'
    );
    expect(aliases['GET /interface-placeholder/gaps']).toBe('interface-placeholder.listGaps');
    expect(aliases['GET /interface-placeholder/gaps/:placeholderId/status']).toBe(
      'interface-placeholder.returnMinimalStatus'
    );
    expect(aliases['POST /interface-placeholder/gaps/:placeholderId/resolve']).toBe(
      'interface-placeholder.resolveGap'
    );
  });

  it('publishes interface-placeholder paths in openapi', async () => {
    const schema = await broker.call('api.openapi');

    expect(schema.tags.some((tag) => tag.name === 'Interface Placeholder')).toBe(true);
    expect(schema.paths['/api/interface-placeholder/mark-gap']).toBeDefined();
    expect(schema.paths['/api/interface-placeholder/request-evidence']).toBeDefined();
    expect(schema.paths['/api/interface-placeholder/gaps']).toBeDefined();
    expect(schema.paths['/api/interface-placeholder/gaps/:placeholderId/status']).toBeDefined();
    expect(schema.paths['/api/interface-placeholder/gaps/:placeholderId/resolve']).toBeDefined();
  });
});
