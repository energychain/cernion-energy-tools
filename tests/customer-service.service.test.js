/**
 * Customer Service Service Tests
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const CustomerServiceService = require('../services/customer-service.service');

describe('Customer Service Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    callWithAutoPoll.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService(CustomerServiceService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('portalWidget', () => {
    it('should have portalWidget action', () => {
      const service = broker.getLocalService('customer-service');
      expect(service.actions.portalWidget).toBeDefined();
    });

    it('should validate required parameters', async () => {
      await expect(broker.call('customer-service.portalWidget', {})).rejects.toThrow();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('customer-service').schema.actions.portalWidget;
      const rest = action.rest;
      expect(rest).toBe('POST /portal-widget');
    });
  });

  describe('installationHealthCheck', () => {
    it('should have installationHealthCheck action', () => {
      const service = broker.getLocalService('customer-service');
      expect(service.actions.installationHealthCheck).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action =
        broker.getLocalService('customer-service').schema.actions.installationHealthCheck;
      const rest = action.rest;
      expect(rest).toBe('POST /installation-health-check');
    });
  });

  describe('installationChangeWizard', () => {
    it('should have installationChangeWizard action', () => {
      const service = broker.getLocalService('customer-service');
      expect(service.actions.installationChangeWizard).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action =
        broker.getLocalService('customer-service').schema.actions.installationChangeWizard;
      const rest = action.rest;
      expect(rest).toBe('POST /installation-change-wizard');
    });
  });

  describe('Service Configuration', () => {
    it('should have correct service name', () => {
      expect(CustomerServiceService.name).toBe('customer-service');
    });

    it('should have default timeout setting', () => {
      expect(CustomerServiceService.settings.defaultTimeout).toBe(5 * 60 * 1000);
    });
  });
});
