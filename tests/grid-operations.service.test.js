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
    it('should require at least one grid operator identifier', async () => {
      await expect(broker.call('grid-operations.operatorAnalysis', {})).rejects.toThrow();
    });

    it('should accept valid operator analysis request', async () => {
      const result = await broker.call('grid-operations.operatorAnalysis', {
        gridOperator: 'Netze BW',
        includeRedispatch: true,
      });

      expect(result).toBeDefined();
    });

    it('should accept MaStR grid operator ID', async () => {
      const result = await broker.call('grid-operations.operatorAnalysis', {
        gridOperatorId: 'SNB935578300972',
        includeCapacityMap: true,
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
    it('should require at least one grid operator identifier', async () => {
      await expect(broker.call('grid-operations.redispatchExport', {})).rejects.toThrow();
    });

    it('should have default minCapacity of 100kW', async () => {
      const result = await broker.call('grid-operations.redispatchExport', {
        gridOperator: 'Stadtwerke Heidelberg',
      });

      expect(result).toBeDefined();
    });

    it('should accept types as an array', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: [] });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        types: ['solar', 'wind', 'storage'],
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.objectContaining({ types: ['solar', 'wind', 'storage'] }),
        expect.any(Object),
        undefined
      );
    });

    it('should coerce comma-separated string types to an array', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: [] });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        types: 'solar,wind,storage',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.objectContaining({ types: ['solar', 'wind', 'storage'] }),
        expect.any(Object),
        undefined
      );
    });

    it('should coerce comma-separated string types with spaces', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: [] });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        types: 'solar, wind, storage',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.objectContaining({ types: ['solar', 'wind', 'storage'] }),
        expect.any(Object),
        undefined
      );
    });

    it('should return JSON by default (no format param)', async () => {
      const mockResult = { success: true, data: { content: [{ type: 'text', text: 'some narrative' }] } };
      callWithAutoPoll.mockResolvedValueOnce(mockResult);

      const result = await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
      });

      expect(result).toEqual(mockResult);
    });

    it('should return CSV string with preamble for format=csv', async () => {
      const narrative = [
        '🔍 **Grid Operator Found**:',
        '   Name: TWL Netze GmbH',
        '   MaStR Number(s): SNB935578300972',
        '✅ **Query executed successfully**',
        '**Quality Report**:',
        '   Total Installations: 39',
        '   Total Capacity: 20590.00 kW',
        '**Preview** (first 5 installations):',
        '| Type | Capacity (kW) | City | Status |',
        '| --- | --- | --- | --- |',
        '| Solar | 100.43 | Ludwigshafen | In Betrieb |',
        '| Wind | 250.00 | Mannheim | In Betrieb |',
      ].join('\n');

      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        data: { content: [{ type: 'text', text: narrative }] },
      });

      const ctx = { meta: {} };
      const result = await broker.call(
        'grid-operations.redispatchExport',
        { gridOperatorId: 'SNB935578300972', format: 'csv' },
        ctx
      );

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^# Redispatch 2\.0 Export/);
      expect(result).toContain('# Grid Operator: TWL Netze GmbH');
      expect(result).toContain('# Total:');
      expect(result).toContain('# Generated:');
      expect(result).toContain('"type","capacity_kW","city","status"');
      expect(result).toContain('Solar');
      expect(result).toContain('Ludwigshafen');
    });

    it('should not forward format param to MCP tool', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        format: 'csv',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.not.objectContaining({ format: expect.anything() }),
        expect.any(Object),
        undefined
      );
    });
  });

  describe('vnbdigitalSearch action', () => {
    it('should require searchTerm', async () => {
      await expect(broker.call('grid-operations.vnbdigitalSearch', {})).rejects.toThrow();
    });

    it('should accept valid search', async () => {
      const result = await broker.call('grid-operations.vnbdigitalSearch', {
        searchTerm: 'Gerhard-Weiser-Ring 29, 69256 Mauer',
      });

      expect(result).toBeDefined();
    });
  });

  describe('vnbdigitalLookup action', () => {
    it('should require coordinates when searchType is coordinates', async () => {
      await expect(
        broker.call('grid-operations.vnbdigitalLookup', {
          searchType: 'coordinates',
        })
      ).rejects.toThrow();
    });

    it('should accept coordinates lookup', async () => {
      const result = await broker.call('grid-operations.vnbdigitalLookup', {
        searchType: 'coordinates',
        coordinates: '49.34206,8.80022',
      });

      expect(result).toBeDefined();
    });
  });

  describe('vnbLookup action', () => {
    it('should require bdew code', async () => {
      await expect(broker.call('grid-operations.vnbLookup', {})).rejects.toThrow();
    });

    it('should accept valid bdew lookup', async () => {
      const result = await broker.call('grid-operations.vnbLookup', {
        bdew: '9900992720003',
        limit: 5,
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
