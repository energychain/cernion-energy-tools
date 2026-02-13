/**
 * ENTSO-E Service Tests
 */

const { ServiceBroker } = require('moleculer');
const EntsoeService = require('../services/entsoe.service');

describe('ENTSO-E Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService(EntsoeService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('dayAheadPrices', () => {
    it('should have dayAheadPrices action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.dayAheadPrices).toBeDefined();
    });

    it('should validate required parameters', async () => {
      await expect(broker.call('entsoe.dayAheadPrices', {})).rejects.toThrow();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.dayAheadPrices;
      const rest = action.rest;
      expect(rest).toBe('POST /day-ahead-prices');
    });
  });

  describe('unavailability', () => {
    it('should have unavailability action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.unavailability).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.unavailability;
      const rest = action.rest;
      expect(rest).toBe('POST /unavailability');
    });
  });

  describe('physicalFlows', () => {
    it('should have physicalFlows action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.physicalFlows).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.physicalFlows;
      const rest = action.rest;
      expect(rest).toBe('POST /physical-flows');
    });
  });

  describe('actualGeneration', () => {
    it('should have actualGeneration action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.actualGeneration).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.actualGeneration;
      const rest = action.rest;
      expect(rest).toBe('POST /actual-generation');
    });
  });

  describe('windSolarForecast', () => {
    it('should have windSolarForecast action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.windSolarForecast).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.windSolarForecast;
      const rest = action.rest;
      expect(rest).toBe('POST /wind-solar-forecast');
    });
  });

  describe('loadForecast', () => {
    it('should have loadForecast action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.loadForecast).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.loadForecast;
      const rest = action.rest;
      expect(rest).toBe('POST /load-forecast');
    });
  });

  describe('windSolarActual', () => {
    it('should have windSolarActual action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.windSolarActual).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.windSolarActual;
      const rest = action.rest;
      expect(rest).toBe('POST /wind-solar-actual');
    });
  });

  describe('generationForecast', () => {
    it('should have generationForecast action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.generationForecast).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.generationForecast;
      const rest = action.rest;
      expect(rest).toBe('POST /generation-forecast');
    });
  });

  describe('psrTypes', () => {
    it('should have psrTypes action', () => {
      const service = broker.getLocalService('entsoe');
      expect(service.actions.psrTypes).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('entsoe').schema.actions.psrTypes;
      const rest = action.rest;
      expect(rest).toBe('GET /psr-types');
    });
  });

  describe('Service Configuration', () => {
    it('should have correct service name', () => {
      expect(EntsoeService.name).toBe('entsoe');
    });

    it('should have default timeout setting', () => {
      expect(EntsoeService.settings.defaultTimeout).toBe(30000);
    });
  });
});
