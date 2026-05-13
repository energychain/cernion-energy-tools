'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ZnpService = require('../services/znp.service');
const HitlService = require('../services/hitl.service');
const ObjectStoreService = require('../services/object-store.service');
const InterfacePlaceholderService = require('../services/interface-placeholder.service');

describe('Service: znp.correlateDisturbance', () => {
  const tempRoot = path.join(os.tmpdir(), `cernion-znp-correlate-${Date.now()}`);
  let broker;

  beforeAll(async () => {
    fs.mkdirSync(path.join(tempRoot, 'object-store'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'znp'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'hitl'), { recursive: true });

    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: path.join(tempRoot, 'object-store'),
      },
    });
    broker.createService({
      ...ZnpService,
      settings: {
        ...ZnpService.settings,
        dbPath: path.join(tempRoot, 'znp'),
      },
    });
    broker.createService({
      ...HitlService,
      settings: {
        ...HitlService.settings,
        dbPath: path.join(tempRoot, 'hitl'),
      },
    });
    broker.createService(InterfacePlaceholderService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('should correlate a high-severity disturbance into a hitl action', async () => {
    // 1. Create a dummy project
    const projectRes = await broker.call('znp.createProject', {
      bbox: { south: 49.47, west: 8.43, north: 49.52, east: 8.52 },
      name: 'Test Project'
    });
    const projectId = projectRes.projectId;

    // 2. Correlate a high severity signal
    const correlateRes = await broker.call('znp.correlateDisturbance', {
      projectId,
      disturbanceId: 'SIG-123',
      pattern: 'CAPACITY_BOTTLENECK',
      severity: 'high'
    });

    expect(correlateRes.success).toBe(true);
    expect(correlateRes.novaOption.sourceSignal).toBe('SIG-123');
    expect(correlateRes.governanceAction).toBe('hitl.create');

    const hitlQueue = await broker.call('hitl.list');
    const createdHitl = (hitlQueue.items || []).find(
      (item) => item.kind === 'blindflug-radar-high-impact'
    );
    expect(createdHitl).toBeTruthy();
    expect(createdHitl.payload.novaOption.sourceSignal).toBe('SIG-123');
  });

  it('should correlate a medium-severity disturbance into an interface placeholder', async () => {
    // 1. Create a dummy project
    const projectRes = await broker.call('znp.createProject', {
      bbox: { south: 49.47, west: 8.43, north: 49.52, east: 8.52 },
      name: 'Test Project 2'
    });
    const projectId = projectRes.projectId;

    // 2. Correlate a medium severity signal
    const correlateRes = await broker.call('znp.correlateDisturbance', {
      projectId,
      disturbanceId: 'SIG-456',
      pattern: 'REPEATING_FAULT',
      severity: 'medium'
    });

    expect(correlateRes.success).toBe(true);
    expect(correlateRes.novaOption.sourceSignal).toBe('SIG-456');
    expect(correlateRes.governanceAction).toBe('interface-placeholder.markGap');

    const placeholders = await broker.call('interface-placeholder.listGaps');
    const createdPlaceholder = (placeholders.placeholders || []).find(
      (item) => item.placeholderGapKey === 'disturbance_SIG-456'
    );
    expect(createdPlaceholder).toBeTruthy();
    expect(createdPlaceholder.reason).toBe('NEEDS_EVIDENCE');
  });
});
