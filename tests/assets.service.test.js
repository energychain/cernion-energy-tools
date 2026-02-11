/**
 * Assets Service Tests
 */

const { ServiceBroker } = require('moleculer');
const Service = require('../services/assets.service');

describe('Assets Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService({ name: 'energy-market', actions: {} });
    broker.createService(Service);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should have correct service name', () => {
    expect(Service.name).toBe('assets');
  });

  it('should expose actions', () => {
    const service = broker.getLocalService('assets');
    expect(service.actions.list).toBeDefined();
  });
});
