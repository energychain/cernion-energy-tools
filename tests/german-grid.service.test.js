/**
 * German Grid Service Tests
 */

const { ServiceBroker } = require('moleculer');
const GermanGridService = require('../services/german-grid.service');

describe('German Grid Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService(GermanGridService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('spotprices', () => {
    it('should have spotprices action', () => {
      const service = broker.getLocalService('german-grid');
      expect(service.actions.spotprices).toBeDefined();
    });

    it('should validate required parameters', async () => {
      await expect(broker.call('german-grid.spotprices', {})).rejects.toThrow();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('german-grid').schema.actions.spotprices;
      const rest = action.rest;
      expect(rest).toBe('POST /spotprices');
    });
  });

  describe('negativePrices', () => {
    it('should have negativePrices action', () => {
      const service = broker.getLocalService('german-grid');
      expect(service.actions.negativePrices).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('german-grid').schema.actions.negativePrices;
      const rest = action.rest;
      expect(rest).toBe('POST /negative-prices');
    });
  });

  describe('forecast', () => {
    it('should have forecast action', () => {
      const service = broker.getLocalService('german-grid');
      expect(service.actions.forecast).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('german-grid').schema.actions.forecast;
      const rest = action.rest;
      expect(rest).toBe('POST /forecast');
    });
  });

  describe('redispatch', () => {
    it('should have redispatch action', () => {
      const service = broker.getLocalService('german-grid');
      expect(service.actions.redispatch).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('german-grid').schema.actions.redispatch;
      const rest = action.rest;
      expect(rest).toBe('POST /redispatch');
    });
  });

  describe('Service Configuration', () => {
    it('should have correct service name', () => {
      expect(GermanGridService.name).toBe('german-grid');
    });

    it('should have default timeout setting', () => {
      expect(GermanGridService.settings.defaultTimeout).toBe(30000);
    });
  });
});
