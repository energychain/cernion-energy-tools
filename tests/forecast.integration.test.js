/**
 * Forecast Service Integration Tests
 *
 * Integration tests for Generation Forecast Service with mocked MCP responses
 * matching the real mastr_generation_forecast tool schema.
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const ForecastService = require('../services/forecast.service');

describe('Forecast Service Integration', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      if (toolName === 'mastr_generation_forecast') {
        const days = params.forecastDays || 7;
        const type = params.installationType || 'solar';
        const resolution = params.resolution || 'daily';
        const pointsPerDay = resolution === '15min' ? 96 : resolution === 'hourly' ? 24 : 1;
        const intervalMs =
          resolution === '15min'
            ? 15 * 60 * 1000
            : resolution === 'hourly'
              ? 60 * 60 * 1000
              : 86400000;
        const totalPoints = days * pointsPerDay;

        const forecasts = [];
        const baseDate = new Date('2026-02-19T00:00:00.000Z');
        for (let i = 0; i < totalPoints; i++) {
          const ts = new Date(baseDate.getTime() + i * intervalMs);
          forecasts.push({
            timestamp: ts.toISOString(),
            generationMW: parseFloat((Math.random() * 20).toFixed(3)),
            capacityFactor: null,
            weather: {
              temperature: parseFloat((5 + Math.random() * 10).toFixed(1)),
              windSpeed: parseFloat((5 + Math.random() * 15).toFixed(1)),
              solarIrradiance: parseFloat((Math.random() * 300).toFixed(1)),
              cloudCover: parseFloat((Math.random() * 100).toFixed(1)),
            },
          });
        }

        const location = params.gridOperatorMastrId
          ? `Netzgebiet ${params.gridOperatorMastrId}`
          : params.location?.bundesland || params.location?.postleitzahl || 'Germany';

        return {
          success: true,
          summary: {
            location,
            type,
            totalCapacityMW: type === 'solar' ? 18.5 : type === 'wind' ? 12.3 : 30.8,
            installationCount: type === 'solar' ? 2200 : type === 'wind' ? 45 : 2245,
            forecastPeriod: {
              start: baseDate.toISOString(),
              end: new Date(baseDate.getTime() + days * 86400000).toISOString(),
            },
          },
          forecasts,
          metadata: {
            toolName: 'mastr_generation_forecast',
            timestamp: new Date().toISOString(),
            weatherDataSource: 'Visual Crossing',
            iecStandardApplied: type === 'wind' ? 'IEC 61400' : 'IEC 61853',
            cachingEnabled: true,
            apiCallsUsed: resolution === 'daily' ? 1 : 24,
          },
        };
      }
      return { success: true, toolName, params, data: {} };
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(ForecastService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('Real-world forecast scenarios', () => {
    it('should forecast solar generation for a grid operator (SNB935578300972)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        installationType: 'solar',
        forecastDays: 7,
      });

      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(7);
      expect(result.summary.location).toBe('Netzgebiet SNB935578300972');
      expect(result.summary.totalCapacityMW).toBeGreaterThan(0);
      expect(result.summary.installationCount).toBeGreaterThan(0);

      result.forecasts.forEach((item) => {
        expect(item.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(typeof item.generationMW).toBe('number');
        expect(item.weather).toHaveProperty('temperature');
        expect(item.weather).toHaveProperty('windSpeed');
        expect(item.weather).toHaveProperty('solarIrradiance');
        expect(item.weather).toHaveProperty('cloudCover');
      });
    });

    it('should forecast wind generation for a Bundesland', async () => {
      const result = await broker.call('forecast.generationForecast', {
        bundesland: 'Bayern',
        installationType: 'wind',
        forecastDays: 7,
      });

      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(7);
      expect(result.summary.type).toBe('wind');
      expect(result.metadata.toolName).toBe('mastr_generation_forecast');
    });

    it('should forecast combined generation with postal code filter', async () => {
      const result = await broker.call('forecast.generationForecast', {
        postleitzahl: '69115',
        installationType: 'all',
        forecastDays: 3,
      });

      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(3);
      expect(result.summary.type).toBe('all');
    });

    it('should support maximum forecastDays (14)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        installationType: 'solar',
        forecastDays: 14,
      });

      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(14);
    });

    it('should support minimum forecastDays (1)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        installationType: 'solar',
        forecastDays: 1,
      });

      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(1);
    });

    it('should build correct location object for multiple location params', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        bundesland: 'Baden-W\u00fcrttemberg',
        landkreis: 'Rhein-Neckar-Kreis',
        gemeinde: 'Heidelberg',
        postleitzahl: '69115',
        installationType: 'solar',
        forecastDays: 3,
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({
          location: {
            bundesland: 'Baden-W\u00fcrttemberg',
            landkreis: 'Rhein-Neckar-Kreis',
            gemeinde: 'Heidelberg',
            postleitzahl: '69115',
          },
        }),
        undefined
      );
    });

    it('should pass coordinates to location object', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        latitude: 49.3988,
        longitude: 8.6724,
        installationType: 'solar',
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({
          location: { latitude: 49.3988, longitude: 8.6724 },
        }),
        undefined
      );
    });

    it('should return 1 point per day with resolution=daily', async () => {
      const result = await broker.call('forecast.generationForecast', {
        installationType: 'solar',
        forecastDays: 3,
        resolution: 'daily',
      });
      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(3);
    });

    it('should return 24 points per day with resolution=hourly', async () => {
      const result = await broker.call('forecast.generationForecast', {
        installationType: 'solar',
        forecastDays: 2,
        resolution: 'hourly',
      });
      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(48); // 2 days × 24
    });

    it('should return 96 points per day with resolution=15min', async () => {
      const result = await broker.call('forecast.generationForecast', {
        postleitzahl: '67063',
        installationType: 'solar',
        forecastDays: 2,
        resolution: '15min',
      });
      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(192); // 2 days × 96
    });

    it('should pass resolution to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        installationType: 'all',
        forecastDays: 3,
        resolution: 'hourly',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({ resolution: 'hourly' }),
        undefined
      );
    });
  });

  describe('Edge cases and error handling', () => {
    it('should work with no params at all (all defaults)', async () => {
      const result = await broker.call('forecast.generationForecast', {});
      expect(result.success).toBe(true);
      expect(result.forecasts).toHaveLength(7); // default forecastDays
    });

    it('should reject forecastDays = 0', async () => {
      await expect(
        broker.call('forecast.generationForecast', { forecastDays: 0 })
      ).rejects.toThrow();
    });

    it('should reject forecastDays = 15', async () => {
      await expect(
        broker.call('forecast.generationForecast', { forecastDays: 15 })
      ).rejects.toThrow();
    });

    it('should handle MCP errors gracefully', async () => {
      callWithNewSession.mockImplementationOnce(async () => {
        throw new Error('MCP connection timeout');
      });
      const result = await broker.call('forecast.generationForecast', {});
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('FORECAST_ERROR');
    });

    it('should reject invalid resolution value', async () => {
      await expect(
        broker.call('forecast.generationForecast', { resolution: 'weekly' })
      ).rejects.toThrow();
    });
  });
});
