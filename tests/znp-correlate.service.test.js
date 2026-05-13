'use strict';

const { ServiceBroker } = require('moleculer');
const ZnpService = require('../services/znp.service');
const HitlService = require('../services/hitl.service');
const InterfacePlaceholderService = require('../services/interface-placeholder.service');

describe('Service: znp.correlateDisturbance', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(ZnpService);
    broker.createService(HitlService);
    broker.createService(InterfacePlaceholderService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
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
  });
});
