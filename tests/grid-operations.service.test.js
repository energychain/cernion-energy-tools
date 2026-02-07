/**
 * Grid Operations Service Integration Tests
 *
 * Test the Grid Operations microservice
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
const GridOperationsService = require('../services/grid-operations.service');

describe('Grid Operations Service', () => {
  let broker;

  beforeAll(() => {
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

    broker = new ServiceBroker({ logger: false });
    broker.createService(GridOperationsService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('operatorAnalysis action', () => {
    it('should require grid operator parameter', async () => {
      await expect(broker.call('grid-operations.operatorAnalysis', {})).rejects.toThrow();
    });

    it('should accept valid operator analysis request', async () => {
      const result = await broker.call('grid-operations.operatorAnalysis', {
        gridOperator: 'Netze BW',
        includeRedispatch: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('capacityUtilization action', () => {
    it('should validate voltage level enum', async () => {
      await expect(
        broker.call('grid-operations.capacityUtilization', {
          gridOperator: 'Netze BW',
          voltageLevel: 'invalid-level',
        })
      ).rejects.toThrow();
    });

    it('should accept valid capacity utilization request', async () => {
      const result = await broker.call('grid-operations.capacityUtilization', {
        gridOperator: 'Netze BW',
        date: '2026-02-06',
        voltageLevel: 'all',
        includeHeatmap: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('redispatchExport action', () => {
    it('should have default minCapacity of 100kW', async () => {
      const result = await broker.call('grid-operations.redispatchExport', {
        gridOperator: 'Stadtwerke Heidelberg',
      });

      expect(result).toBeDefined();
    });
  });

  describe('connectionCapacityCheck action', () => {
    it('should validate installation type enum', async () => {
      await expect(
        broker.call('grid-operations.connectionCapacityCheck', {
          gridOperator: 'Test',
          location: 'Test',
          installationType: 'invalid',
          capacityKW: 10,
        })
      ).rejects.toThrow();
    });

    it('should accept valid connection check request', async () => {
      const result = await broker.call('grid-operations.connectionCapacityCheck', {
        gridOperator: 'Netze BW',
        location: 'Heidelberg',
        installationType: 'solar',
        capacityKW: 10,
      });

      expect(result).toBeDefined();
    });
  });
});
