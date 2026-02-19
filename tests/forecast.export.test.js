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

const MOCK_FORECASTS = [
  {
    timestamp: '2026-02-19T00:00:00.000Z',
    generationMW: 0.01,
    capacityFactor: null,
    weather: { temperature: 4.3, windSpeed: 12.2, solarIrradiance: 30.8, cloudCover: 100 },
  },
  {
    timestamp: '2026-02-20T00:00:00.000Z',
    generationMW: 0.05,
    capacityFactor: null,
    weather: { temperature: 6.1, windSpeed: 8.5, solarIrradiance: 120.0, cloudCover: 60 },
  },
  {
    timestamp: '2026-02-21T00:00:00.000Z',
    generationMW: 0.03,
    capacityFactor: null,
    weather: { temperature: 9.5, windSpeed: 21.6, solarIrradiance: 11.0, cloudCover: 98.9 },
  },
];

const MOCK_SUMMARY = {
  location: 'Netzgebiet SNB935578300972',
  type: 'all',
  totalCapacityMW: 25.77,
  installationCount: 2756,
  forecastPeriod: { start: '2026-02-19T00:00:00.000Z', end: '2026-02-22T00:00:00.000Z' },
};

describe('Forecast Service - Export Formats', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName) => {
      if (toolName === 'mastr_generation_forecast') {
        return {
          success: true,
          summary: MOCK_SUMMARY,
          forecasts: MOCK_FORECASTS,
          metadata: { toolName: 'mastr_generation_forecast', timestamp: '2026-02-18T12:00:00Z' },
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
    it('should return CSV string when format=csv', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        installationType: 'all',
        format: 'csv',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('Timestamp');
      expect(result).toContain('Generation (MW)');
      expect(result).toContain('Capacity Factor');
      expect(result).toContain('Wind Speed (m/s)');
      expect(result).toContain('Solar Irradiance (W/m\u00b2)');
    });

    it('should include summary metadata in CSV comments', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        format: 'csv',
      });

      expect(result).toContain('# Location: Netzgebiet SNB935578300972');
      expect(result).toContain('# Total Capacity: 25.77 MW');
      expect(result).toContain('# Installation Count: 2756');
    });

    it('should include forecast data rows in CSV', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        format: 'csv',
      });

      expect(result).toContain('2026-02-19T00:00:00.000Z');
      expect(result).toContain('0.01');
      expect(result).toContain('4.3');
      expect(result).toContain('12.2');
    });

    it('should set correct Content-Type and Content-Disposition headers', async () => {
      const ctx = {
        params: { gridOperatorMastrId: 'SNB935578300972', format: 'csv' },
        meta: {},
      };
      await broker.call('forecast.generationForecast', ctx.params, { meta: ctx.meta });

      expect(ctx.meta.$responseHeaders).toBeDefined();
      expect(ctx.meta.$responseHeaders['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="forecast-\d+\.csv"$/
      );
    });

    it('should handle empty forecasts array', async () => {
      callWithNewSession.mockImplementationOnce(async () => ({
        success: true,
        summary: MOCK_SUMMARY,
        forecasts: [],
        metadata: { toolName: 'mastr_generation_forecast', timestamp: '2026-02-18T12:00:00Z' },
      }));

      const result = await broker.call('forecast.generationForecast', { format: 'csv' });
      expect(result).toBe('No forecast data available');
    });

    it('should include resolution in CSV metadata comments', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        resolution: 'hourly',
        format: 'csv',
      });
      expect(result).toContain('# Resolution: hourly');
    });
  });

  describe('XLSX Export', () => {
    it('should return Buffer when format=xlsx', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        format: 'xlsx',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Forecast');
    });

    it('should include correct columns in Forecast sheet', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        format: 'xlsx',
      });

      const workbook = XLSX.read(result, { type: 'buffer' });
      const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets['Forecast']);

      expect(jsonData).toHaveLength(3);
      expect(jsonData[0]).toHaveProperty('Timestamp');
      expect(jsonData[0]).toHaveProperty('Generation (MW)');
      expect(jsonData[0]).toHaveProperty('Capacity Factor');
      expect(jsonData[0]).toHaveProperty('Temperature (\u00b0C)');
      expect(jsonData[0]).toHaveProperty('Wind Speed (m/s)');
      expect(jsonData[0]).toHaveProperty('Solar Irradiance (W/m\u00b2)');
      expect(jsonData[0]).toHaveProperty('Cloud Cover (%)');
    });

    it('should include Metadata sheet in XLSX', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        format: 'xlsx',
      });

      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Metadata');

      const metadataJson = XLSX.utils.sheet_to_json(workbook.Sheets['Metadata']);
      expect(metadataJson.length).toBeGreaterThan(0);

      const locationRow = metadataJson.find((r) => r.Property === 'Location');
      expect(locationRow).toBeDefined();
      expect(locationRow.Value).toBe('Netzgebiet SNB935578300972');

      const capacityRow = metadataJson.find((r) => r.Property === 'Total Capacity (MW)');
      expect(capacityRow).toBeDefined();
      expect(capacityRow.Value).toBe(25.77);
    });

    it('should set correct XLSX headers', async () => {
      const ctx = {
        params: { gridOperatorMastrId: 'SNB935578300972', format: 'xlsx' },
        meta: {},
      };
      await broker.call('forecast.generationForecast', ctx.params, { meta: ctx.meta });

      expect(ctx.meta.$responseHeaders['Content-Type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="forecast-\d+\.xlsx"$/
      );
    });

    it('should handle empty forecasts in XLSX', async () => {
      callWithNewSession.mockImplementationOnce(async () => ({
        success: true,
        summary: MOCK_SUMMARY,
        forecasts: [],
        metadata: { toolName: 'mastr_generation_forecast', timestamp: '2026-02-18T12:00:00Z' },
      }));

      const result = await broker.call('forecast.generationForecast', { format: 'xlsx' });
      expect(result).toBeInstanceOf(Buffer);
      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Forecast');
    });

    it('should include Resolution row in XLSX Metadata sheet', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        resolution: 'hourly',
        format: 'xlsx',
      });
      const workbook = XLSX.read(result, { type: 'buffer' });
      const metadataJson = XLSX.utils.sheet_to_json(workbook.Sheets['Metadata']);
      const resolutionRow = metadataJson.find((r) => r.Property === 'Resolution');
      expect(resolutionRow).toBeDefined();
      expect(resolutionRow.Value).toBe('hourly');
    });
  });

  describe('Format Parameter Validation', () => {
    it('should reject invalid format value', async () => {
      await expect(
        broker.call('forecast.generationForecast', { format: 'pdf' })
      ).rejects.toThrow();
    });

    it('should default to JSON when format not specified', async () => {
      const result = await broker.call('forecast.generationForecast', {});
      expect(result).toBeInstanceOf(Object);
      expect(result).not.toBeInstanceOf(Buffer);
      expect(result.success).toBe(true);
    });

    it('should return JSON object when format=json explicitly', async () => {
      const result = await broker.call('forecast.generationForecast', { format: 'json' });
      expect(result.success).toBe(true);
      expect(result.forecasts).toBeDefined();
    });
  });

  describe('Method Tests', () => {
    it('should have convertForecastToCSV method', () => {
      const service = broker.getLocalService('forecast');
      expect(typeof service.convertForecastToCSV).toBe('function');
    });

    it('should have convertForecastToXLSX method', () => {
      const service = broker.getLocalService('forecast');
      expect(typeof service.convertForecastToXLSX).toBe('function');
    });

    it('should convert forecast array to CSV correctly', () => {
      const service = broker.getLocalService('forecast');
      const csv = service.convertForecastToCSV(MOCK_FORECASTS, MOCK_SUMMARY);

      expect(csv).toContain('Generation (MW)');
      expect(csv).toContain('2026-02-19T00:00:00.000Z');
      expect(csv).toContain('0.01');
      expect(csv).toContain('4.3');
    });

    it('should convert forecast array to XLSX correctly', () => {
      const service = broker.getLocalService('forecast');
      const buffer = service.convertForecastToXLSX(MOCK_FORECASTS, MOCK_SUMMARY);

      expect(buffer).toBeInstanceOf(Buffer);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Forecast');
      const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets['Forecast']);
      expect(jsonData[0]).toHaveProperty('Generation (MW)');
    });

    it('should include resolution in CSV comments when provided', () => {
      const service = broker.getLocalService('forecast');
      const csv = service.convertForecastToCSV(MOCK_FORECASTS, MOCK_SUMMARY, 'hourly');
      expect(csv).toContain('# Resolution: hourly');
    });

    it('should include Resolution in XLSX Metadata sheet when provided', () => {
      const service = broker.getLocalService('forecast');
      const buffer = service.convertForecastToXLSX(MOCK_FORECASTS, MOCK_SUMMARY, '15min');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const metadataJson = XLSX.utils.sheet_to_json(workbook.Sheets['Metadata']);
      const resolutionRow = metadataJson.find((r) => r.Property === 'Resolution');
      expect(resolutionRow).toBeDefined();
      expect(resolutionRow.Value).toBe('15min');
    });
  });
});

