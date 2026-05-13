'use strict';

const { ServiceBroker } = require('moleculer');
const BlindflugRadarService = require('../services/blindflug-radar.service');

describe('Service: blindflug-radar', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(BlindflugRadarService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should run a scan and return disturbances', async () => {
    const res = await broker.call('v1.blindflug-radar.scan', { vnbId: 'VNB-123' });
    expect(res).toBeDefined();
    expect(res.vnbId).toBe('VNB-123');
    expect(res.disturbances).toHaveLength(1);
    expect(res.disturbances[0].pattern).toBe('CAPACITY_BOTTLENECK');
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].finding).toBe('BLINDFLUG_ANOMALY_DETECTED');
  });
});
