'use strict';

const { ServiceBroker } = require('moleculer');
const AssetsService = require('../services/assets.service');

describe('Assets Service - override stub', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, nodeID: `assets-override-${Date.now()}` });

    // Satisfy assets service dependency.
    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler() {
            return { data: { installations: [] } };
          },
        },
      },
    });

    broker.createService(AssetsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('returns success true', async () => {
    const result = await broker.call('assets.override', {
      assetId: 'trafo-brueckweg',
      field: 'capacityKW',
      value: 1250,
      reason: 'Manual correction from operator',
    });

    expect(result).toEqual({ success: true });
  });
});
