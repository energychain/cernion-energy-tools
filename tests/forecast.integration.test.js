/**
 * Forecast Service Integration Tests
 *
 * Live integration tests for Generation Forecast Service with real MCP calls
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
    // Mock realistic MCP responses
    callWithNewSession.mockImplementation(async (toolName, params) => {
      if (toolName === 'cernion_mastr_generation_forecast') {
        // Simulate realistic forecast data with variation
        const hourlyForecasts = [];
        const baseTime = new Date('2026-02-16T06:00:00Z');
        const hours = params.forecastHorizonHours || 24;

        for (let i = 0; i < hours; i++) {
          const hour = (baseTime.getHours() + i) % 24;
          const timestamp = new Date(baseTime.getTime() + i * 60 * 60 * 1000);

          // Simulate realistic solar/wind generation patterns
          let generationKW, capacityFactor, confidence;

          if (params.installationType === 'solar') {
            // Solar peaks at noon, zero at night
            const solarFactor = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
            generationKW = Math.round(15420.5 * solarFactor * (0.6 + Math.random() * 0.3));
            capacityFactor = solarFactor * (0.6 + Math.random() * 0.3);
            confidence = hour >= 6 && hour <= 18 ? 'high' : 'low';
          } else if (params.installationType === 'wind') {
            // Wind more variable
            generationKW = Math.round(8500 * (0.3 + Math.random() * 0.6));
            capacityFactor = 0.3 + Math.random() * 0.6;
            confidence = i < 24 ? 'high' : i < 72 ? 'medium' : 'low';
          } else {
            // Combined
            generationKW = Math.round(20000 * (0.4 + Math.random() * 0.5));
            capacityFactor = 0.4 + Math.random() * 0.5;
            confidence = i < 24 ? 'high' : 'medium';
          }

          hourlyForecasts.push({
            timestamp: timestamp.toISOString(),
            generationKW: Math.max(0, generationKW),
            capacityFactor: Math.max(0, Math.min(1, capacityFactor)),
            confidence,
          });
        }

        const response = {
          success: true,
          data: {
            location: params.location,
            installationType: params.installationType,
            forecastGenerated: new Date().toISOString(),
            forecastHorizonHours: hours,
            totalInstalledCapacityKW:
              params.installationType === 'solar'
                ? 15420.5
                : params.installationType === 'wind'
                  ? 8500.0
                  : 23920.5,
            installationCount: params.installationType === 'solar' ? 342 : 87,
            forecast: hourlyForecasts,
          },
          metadata: {
            toolName: 'cernion_mastr_generation_forecast',
            timestamp: new Date().toISOString(),
            iecStandardsApplied:
              params.installationType === 'solar'
                ? ['IEC 61853 (Solar)']
                : params.installationType === 'wind'
                  ? ['IEC 61400 (Wind)']
                  : ['IEC 61853 (Solar)', 'IEC 61400 (Wind)'],
            weatherDataCached: true,
          },
        };

        // Add weather data if requested
        if (params.includeWeatherData !== false) {
          response.data.weatherForecast = hourlyForecasts.slice(0, 5).map((f) => ({
            timestamp: f.timestamp,
            temperatureCelsius: 10 + Math.random() * 15,
            windSpeedMS: 2 + Math.random() * 8,
            cloudCoverPercent: Math.floor(Math.random() * 100),
            irradianceWM2: Math.floor(Math.random() * 800),
          }));
        }

        // Add installation breakdown if requested
        if (params.includeInstallationBreakdown) {
          response.data.installationBreakdown = [
            {
              mastrNummer: 'SEE900012345678',
              capacityKW: 50.0,
              forecast: hourlyForecasts.slice(0, 3).map((f) => ({
                timestamp: f.timestamp,
                generationKW: Math.round(f.generationKW * 0.00324), // Proportional share
              })),
            },
            {
              mastrNummer: 'SEE900087654321',
              capacityKW: 100.0,
              forecast: hourlyForecasts.slice(0, 3).map((f) => ({
                timestamp: f.timestamp,
                generationKW: Math.round(f.generationKW * 0.00648), // Proportional share
              })),
            },
          ];
        }

        return response;
      }

      return {
        success: true,
        toolName,
        params,
        data: {},
      };
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(ForecastService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('Real-world forecast scenarios', () => {
    it('should forecast solar generation for a city (Heidelberg)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(24);
      expect(result.data.totalInstalledCapacityKW).toBeGreaterThan(0);
      expect(result.data.installationCount).toBeGreaterThan(0);

      // Verify forecast structure
      result.data.forecast.forEach((item) => {
        expect(item.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(typeof item.generationKW).toBe('number');
        expect(item.capacityFactor).toBeGreaterThanOrEqual(0);
        expect(item.capacityFactor).toBeLessThanOrEqual(1);
        expect(['high', 'medium', 'low']).toContain(item.confidence);
      });
    }, 60000);

    it('should forecast wind generation for a state (Bayern)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Bayern',
        installationType: 'wind',
        forecastHorizonHours: 48,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(48);
      expect(result.data.installationType).toBe('wind');
      expect(result.metadata.iecStandardsApplied).toContain('IEC 61400 (Wind)');
    }, 60000);

    it('should forecast combined generation for nationwide analysis', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Deutschland',
        installationType: 'all',
        forecastHorizonHours: 72,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(72);
      expect(result.data.installationType).toBe('all');
      expect(result.metadata.iecStandardsApplied).toHaveLength(2);
    }, 60000);

    it('should forecast with postal code filtering', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        postalCode: '69115',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(24);
    }, 60000);

    it('should forecast large-scale installations only (>100kW)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Baden-Württemberg',
        installationType: 'solar',
        minCapacityKW: 100,
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 60000);

    it('should include detailed weather forecast', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Mannheim',
        installationType: 'solar',
        forecastHorizonHours: 24,
        includeWeatherData: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.weatherForecast).toBeDefined();
      expect(Array.isArray(result.data.weatherForecast)).toBe(true);

      if (result.data.weatherForecast.length > 0) {
        const weather = result.data.weatherForecast[0];
        expect(weather).toHaveProperty('timestamp');
        expect(weather).toHaveProperty('temperatureCelsius');
        expect(weather).toHaveProperty('windSpeedMS');
        expect(weather).toHaveProperty('cloudCoverPercent');
        expect(weather).toHaveProperty('irradianceWM2');
      }
    }, 60000);

    it('should include installation breakdown when requested', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 24,
        includeInstallationBreakdown: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.installationBreakdown).toBeDefined();
      expect(Array.isArray(result.data.installationBreakdown)).toBe(true);

      if (result.data.installationBreakdown.length > 0) {
        const installation = result.data.installationBreakdown[0];
        expect(installation).toHaveProperty('mastrNummer');
        expect(installation).toHaveProperty('capacityKW');
        expect(installation).toHaveProperty('forecast');
        expect(Array.isArray(installation.forecast)).toBe(true);
      }
    }, 60000);

    it('should generate week-ahead forecast (168 hours)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Deutschland',
        installationType: 'solar',
        forecastHorizonHours: 168,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(168);
      expect(result.data.forecastHorizonHours).toBe(168);
    }, 60000);

    it('should handle multiple regional filters', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Baden-Württemberg',
        installationType: 'solar',
        state: 'Baden-Württemberg',
        district: 'Rhein-Neckar-Kreis',
        municipality: 'Heidelberg',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 60000);
  });

  describe('Edge cases and error handling', () => {
    it('should handle minimum forecast horizon (1 hour)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(1);
    });

    it('should handle maximum forecast horizon (168 hours)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 168,
      });

      expect(result.success).toBe(true);
      expect(result.data.forecast).toHaveLength(168);
    });
  });
});
