/**
 * German Grid Service Tests
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const GermanGridService = require('../services/german-grid.service');

describe('German Grid Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      data: { content: [{ type: 'text', text: `mock response for ${toolName}` }] },
    }));

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

    it('should declare format param', () => {
      const action = broker.getLocalService('german-grid').schema.actions.negativePrices;
      expect(action.params.format).toBeDefined();
      expect(action.params.format.values).toEqual(['json', 'csv', 'xlsx', 'xls']);
    });

    it('should have OpenAPI responses block', () => {
      const action = broker.getLocalService('german-grid').schema.actions.negativePrices;
      expect(action.openapi.responses).toBeDefined();
      expect(action.openapi.responses[200]).toBeDefined();
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

    it('should return CSV string with preamble for format=csv', async () => {
      const narrative = [
        '⚡ **Redispatch Measures** (2026-02-02 to 2026-03-04)',
        '**Found**: 3 measures',
        '- 2026-02-01T23:00:00Z: 1350 MWh (Strombedingter Redispatch)',
        '- 2026-02-02T00:00:00Z: 1954 MWh (Strombedingter Redispatch)',
        '- 2026-02-02T01:00:00Z: 800 MWh (Einspeisemanagement)',
        '**Analysis**:',
        '- Total energy: 4104 MWh',
      ].join('\n');

      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: { content: [{ type: 'text', text: narrative }] },
      });

      const ctx = { meta: {} };
      const result = await broker.call(
        'german-grid.redispatch',
        {
          dateFrom: '2026-02-02',
          dateTo: '2026-03-04',
          format: 'csv',
        },
        ctx
      );

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^# Redispatch Measures Export/);
      expect(result).toContain('# Period: 2026-02-02 to 2026-03-04');
      expect(result).toContain('# Total Measures: 3');
      expect(result).toContain('# Total Energy: 4104 MWh');
      expect(result).toContain('# Generated:');
      expect(result).toContain('"timestamp","quantityMWh","measureType"');
      expect(result).toContain('2026-02-01T23:00:00Z');
      expect(result).toContain('Strombedingter Redispatch');
    });

    it('should return JSON for format=json', async () => {
      const mockResult = {
        success: true,
        data: { content: [{ type: 'text', text: '**Found**: 10 measures\n- Total energy: 500 MWh' }] },
      };
      callWithNewSession.mockResolvedValueOnce(mockResult);

      const result = await broker.call('german-grid.redispatch', {
        dateFrom: '2026-02-01',
        dateTo: '2026-02-28',
        format: 'json',
      });

      expect(result).toEqual(mockResult);
    });

    it('should throw when MCP returns null', async () => {
      callWithNewSession.mockResolvedValueOnce(null);

      await expect(
        broker.call('german-grid.redispatch', {
          dateFrom: '2026-02-01',
          dateTo: '2026-02-28',
        })
      ).rejects.toThrow();
    });

    it('should throw when MCP returns success=false', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: false,
        error: { message: 'Upstream tool error' },
      });

      await expect(
        broker.call('german-grid.redispatch', {
          dateFrom: '2026-02-01',
          dateTo: '2026-02-28',
        })
      ).rejects.toThrow('Upstream tool error');
    });
  });

  describe('spotprices ENTSO-E fallback', () => {
    beforeEach(() => {
      callWithNewSession.mockReset();
    });

    afterEach(() => {
      callWithNewSession.mockReset();
    });

    it('should return ENTSO-E data when Netztransparenz returns isError', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: [{ type: 'text', text: 'No price data available for the requested period' }],
            isError: true,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: [{ type: 'text', text: '✅ Day-Ahead prices Germany: 100 EUR/MWh' }],
          },
        });

      const result = await broker.call('german-grid.spotprices', {
        dateFrom: '2026-03-04',
        dateTo: '2026-03-04',
      });

      expect(result.data.fallback).toBe(true);
      expect(result.data.fallbackSource).toBe('entsoe_day_ahead_prices');
      expect(result.data.content[0].text).toContain('ENTSO-E');
      expect(result.data.content[0].text).toContain('Day-Ahead prices Germany');
    });

    it('should call entsoe_day_ahead_prices with correct params on fallback', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'No price data' }], isError: true },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'ENTSO-E OK' }] },
        });

      await broker.call('german-grid.spotprices', {
        dateFrom: '2026-03-04',
        dateTo: '2026-03-05',
        includeStatistics: true,
      });

      expect(callWithNewSession).toHaveBeenCalledTimes(2);
      const [fallbackTool, fallbackParams] = callWithNewSession.mock.calls[1];
      expect(fallbackTool).toBe('entsoe_day_ahead_prices');
      expect(fallbackParams.region).toBe('Deutschland');
      expect(fallbackParams.dateFrom).toBe('2026-03-04');
      expect(fallbackParams.dateTo).toBe('2026-03-05');
      expect(fallbackParams.includeStatistics).toBe(true);
    });

    it('should include primaryError annotation in fallback result', async () => {
      const primaryErrorText = '❌ **Netztransparenz API Error**\nAPI error 500: Internal Server Error';
      callWithNewSession
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: primaryErrorText }], isError: true },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'ENTSO-E data' }] },
        });

      const result = await broker.call('german-grid.spotprices', {
        dateFrom: '2026-03-04',
        dateTo: '2026-03-04',
      });

      expect(result.data.primaryError).toBe(primaryErrorText);
    });

    it('should throw combined error when both sources fail', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'No price data available' }], isError: true },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'ENTSO-E also failed' }], isError: true },
        });

      await expect(
        broker.call('german-grid.spotprices', { dateFrom: '2026-03-04', dateTo: '2026-03-04' })
      ).rejects.toThrow('Beide Datenquellen nicht verfügbar');
    });

    it('should throw original error when ENTSO-E call itself throws', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'No price data available' }], isError: true },
        })
        .mockRejectedValueOnce(new Error('ENTSO-E connection timeout'));

      await expect(
        broker.call('german-grid.spotprices', { dateFrom: '2026-03-04', dateTo: '2026-03-04' })
      ).rejects.toThrow('No price data available');
    });

    it('should not attempt fallback when primary source succeeds', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: { content: [{ type: 'text', text: '✅ Spot prices: 95 EUR/MWh' }] },
      });

      const result = await broker.call('german-grid.spotprices', {
        dateFrom: '2026-01-15',
        dateTo: '2026-01-15',
      });

      expect(callWithNewSession).toHaveBeenCalledTimes(1);
      expect(result.data.fallback).toBeUndefined();
    });

    it('should return CSV from ENTSO-E fallback dataPoints when format=csv', async () => {
      const dataPoints = [
        { timestamp: '2026-03-04T00:00:00Z', hour: 0, priceEURperMWh: 91.22 },
        { timestamp: '2026-03-04T01:00:00Z', hour: 1, priceEURperMWh: 87.45 },
      ];
      callWithNewSession
        .mockResolvedValueOnce({
          success: true,
          data: { content: [{ type: 'text', text: 'No price data available' }], isError: true },
        })
        .mockResolvedValueOnce({
          success: true,
          dataPoints,
          region: 'Deutschland',
          statistics: { minPrice: 87.45, maxPrice: 91.22 },
        });

      const ctx = { meta: {} };
      const result = await broker.call('german-grid.spotprices', {
        dateFrom: '2026-03-04',
        dateTo: '2026-03-06',
        format: 'csv',
      }, { meta: ctx.meta });

      expect(typeof result).toBe('string');
      expect(result).toContain('timestamp');
      expect(result).toContain('priceEURperMWh');
      expect(result).toContain('91.22');
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
