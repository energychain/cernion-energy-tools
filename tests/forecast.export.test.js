/**
 * Forecast Service Export Tests (CSV and XLSX)
 *
 * Tests for CSV and XLSX export functionality in Forecast service
 */

const { ServiceBroker } = require('moleculer');
const XLSX = require('xlsx');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const ForecastService = require('../services/forecast.service');

describe('Forecast Service - Export Formats', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      if (toolName === 'cernion_mastr_generation_forecast') {
        return {
          success: true,
          data: {
            location: params.location,
            installationType: params.installationType,
            forecastGenerated: '2026-02-18T12:00:00Z',
            forecastHorizonHours: params.forecastHorizonHours || 24,
            totalInstalledCapacityKW: 15420.5,
            installationCount: 342,
            forecast: [
              {
                timestamp: '2026-02-18T13:00:00Z',
                generationKW: 8456.2,
                capacityFactor: 0.548,
                confidence: 'high',
              },
              {
                timestamp: '2026-02-18T14:00:00Z',
                generationKW: 9234.7,
                capacityFactor: 0.599,
                confidence: 'high',
              },
              {
                timestamp: '2026-02-18T15:00:00Z',
                generationKW: 7890.3,
                capacityFactor: 0.512,
                confidence: 'medium',
              },
            ],
          },
          metadata: {
            toolName: 'cernion_mastr_generation_forecast',
            timestamp: '2026-02-18T12:00:00Z',
          },
        };
      }
      return { success: true, data: {} };
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(ForecastService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('CSV Export', () => {
    it('should return CSV when format=csv', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'csv',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('Timestamp');
      expect(result).toContain('Generation (kW)');
      expect(result).toContain('Capacity Factor');
      expect(result).toContain('Confidence');
    });

    it('should include metadata in CSV comments', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'csv',
      });

      expect(result).toContain('# Location: Heidelberg');
      expect(result).toContain('# Installation Type: solar');
      expect(result).toContain('# Total Capacity:');
    });

    it('should include forecast data in CSV', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'csv',
      });

      expect(result).toContain('2026-02-18T13:00:00Z');
      expect(result).toContain('8456.2');
      expect(result).toContain('0.548');
      expect(result).toContain('high');
    });

    it('should set correct CSV headers', async () => {
      const ctx = {
        params: {
          location: 'Heidelberg',
          installationType: 'solar',
          format: 'csv',
        },
        meta: {},
      };

      await broker.call('forecast.generationForecast', ctx.params, { meta: ctx.meta });

      expect(ctx.meta.$responseHeaders).toBeDefined();
      expect(ctx.meta.$responseHeaders['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="forecast-\d+\.csv"$/
      );
    });

    it('should handle empty forecast data', async () => {
      callWithNewSession.mockImplementationOnce(async () => ({
        success: true,
        data: {
          forecast: [],
        },
      }));

      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'csv',
      });

      expect(result).toBe('No forecast data available');
    });
  });

  describe('XLSX Export', () => {
    it('should return XLSX buffer when format=xlsx', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'xlsx',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      // Verify it's a valid XLSX file
      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Forecast');
    });

    it('should include forecast data in XLSX', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'xlsx',
      });

      const workbook = XLSX.read(result, { type: 'buffer' });
      const worksheet = workbook.Sheets['Forecast'];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      expect(jsonData).toHaveLength(3);
      expect(jsonData[0]).toHaveProperty('Timestamp');
      expect(jsonData[0]).toHaveProperty('Generation (kW)');
      expect(jsonData[0]).toHaveProperty('Capacity Factor');
      expect(jsonData[0]).toHaveProperty('Confidence');
    });

    it('should include metadata sheet in XLSX', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'xlsx',
      });

      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Metadata');

      const metadataSheet = workbook.Sheets['Metadata'];
      const metadataJson = XLSX.utils.sheet_to_json(metadataSheet);

      expect(metadataJson.length).toBeGreaterThan(0);
      const locationRow = metadataJson.find((row) => row.Property === 'Location');
      expect(locationRow).toBeDefined();
      expect(locationRow.Value).toBe('Heidelberg');
    });

    it('should set correct XLSX headers', async () => {
      const ctx = {
        params: {
          location: 'Heidelberg',
          installationType: 'solar',
          format: 'xlsx',
        },
        meta: {},
      };

      await broker.call('forecast.generationForecast', ctx.params, { meta: ctx.meta });

      expect(ctx.meta.$responseHeaders).toBeDefined();
      expect(ctx.meta.$responseHeaders['Content-Type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="forecast-\d+\.xlsx"$/
      );
    });

    it('should handle empty forecast data in XLSX', async () => {
      callWithNewSession.mockImplementationOnce(async () => ({
        success: true,
        data: {
          forecast: [],
        },
      }));

      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'xlsx',
      });

      expect(result).toBeInstanceOf(Buffer);

      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Forecast');
    });
  });

  describe('Format Parameter Validation', () => {
    it('should validate format enum', async () => {
      await expect(
        broker.call('forecast.generationForecast', {
          location: 'Heidelberg',
          installationType: 'solar',
          format: 'invalid',
        })
      ).rejects.toThrow();
    });

    it('should default to JSON when format not specified', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
      });

      expect(result).toBeInstanceOf(Object);
      expect(result).not.toBeInstanceOf(Buffer);
      expect(result.success).toBe(true);
    });

    it('should work with format=json explicitly', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        format: 'json',
      });

      expect(result).toBeInstanceOf(Object);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('Method Tests', () => {
    it('should have convertForecastToCSV method', () => {
      const service = broker.getLocalService('forecast');
      expect(service.convertForecastToCSV).toBeDefined();
      expect(typeof service.convertForecastToCSV).toBe('function');
    });

    it('should have convertForecastToXLSX method', () => {
      const service = broker.getLocalService('forecast');
      expect(service.convertForecastToXLSX).toBeDefined();
      expect(typeof service.convertForecastToXLSX).toBe('function');
    });

    it('should convert forecast array to CSV', () => {
      const service = broker.getLocalService('forecast');
      const testData = [
        {
          timestamp: '2026-02-18T13:00:00Z',
          generationKW: 1000,
          capacityFactor: 0.5,
          confidence: 'high',
        },
      ];

      const csv = service.convertForecastToCSV(testData);

      expect(csv).toContain('Timestamp');
      expect(csv).toContain('2026-02-18T13:00:00Z');
      expect(csv).toContain('1000');
    });

    it('should convert forecast array to XLSX', () => {
      const service = broker.getLocalService('forecast');
      const testData = [
        {
          timestamp: '2026-02-18T13:00:00Z',
          generationKW: 1000,
          capacityFactor: 0.5,
          confidence: 'high',
        },
      ];

      const buffer = service.convertForecastToXLSX(testData);

      expect(buffer).toBeInstanceOf(Buffer);

      const workbook = XLSX.read(buffer, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Forecast');
    });
  });

  describe('Integration with Different Parameters', () => {
    it('should export wind forecasts as CSV', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Bayern',
        installationType: 'wind',
        forecastHorizonHours: 48,
        format: 'csv',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('# Installation Type: wind');
    });

    it('should export combined forecasts as XLSX', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Deutschland',
        installationType: 'all',
        format: 'xlsx',
      });

      expect(result).toBeInstanceOf(Buffer);

      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames.length).toBeGreaterThan(0);
    });

    it('should work with regional filters and CSV export', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        state: 'Baden-Württemberg',
        postalCode: '69115',
        format: 'csv',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('Heidelberg');
    });
  });
});
