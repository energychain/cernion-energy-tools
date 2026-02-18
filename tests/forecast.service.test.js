/**
 * Forecast Service Unit Tests
 *
 * Tests for Renewable Energy Generation Forecast microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const ForecastService = require('../services/forecast.service');

describe('Forecast Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      // Simulate successful forecast response
      if (toolName === 'cernion_mastr_generation_forecast') {
        return {
          success: true,
          data: {
            location: params.location,
            installationType: params.installationType,
            forecastGenerated: '2026-02-16T12:00:00Z',
            forecastHorizonHours: params.forecastHorizonHours || 24,
            totalInstalledCapacityKW: 15420.5,
            installationCount: 342,
            forecast: [
              {
                timestamp: '2026-02-16T13:00:00Z',
                generationKW: 8456.2,
                capacityFactor: 0.548,
                confidence: 'high',
              },
              {
                timestamp: '2026-02-16T14:00:00Z',
                generationKW: 9234.7,
                capacityFactor: 0.599,
                confidence: 'high',
              },
              {
                timestamp: '2026-02-16T15:00:00Z',
                generationKW: 7890.3,
                capacityFactor: 0.512,
                confidence: 'medium',
              },
            ],
            weatherForecast: params.includeWeatherData
              ? [
                  {
                    timestamp: '2026-02-16T13:00:00Z',
                    temperatureCelsius: 12.5,
                    windSpeedMS: 3.2,
                    cloudCoverPercent: 25,
                    irradianceWM2: 650,
                  },
                  {
                    timestamp: '2026-02-16T14:00:00Z',
                    temperatureCelsius: 14.2,
                    windSpeedMS: 3.8,
                    cloudCoverPercent: 15,
                    irradianceWM2: 720,
                  },
                ]
              : undefined,
            installationBreakdown: params.includeInstallationBreakdown
              ? [
                  {
                    mastrNummer: 'SEE900012345678',
                    capacityKW: 50.0,
                    forecast: [
                      {
                        timestamp: '2026-02-16T13:00:00Z',
                        generationKW: 27.4,
                      },
                    ],
                  },
                ]
              : undefined,
          },
          metadata: {
            toolName: 'cernion_mastr_generation_forecast',
            timestamp: '2026-02-16T12:00:00Z',
            iecStandardsApplied: ['IEC 61853 (Solar)'],
            weatherDataCached: true,
          },
        };
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

  describe('generationForecast action', () => {
    it('should require location and installationType parameters', async () => {
      await expect(broker.call('forecast.generationForecast', {})).rejects.toThrow();
    });

    it('should validate installationType enum', async () => {
      await expect(
        broker.call('forecast.generationForecast', {
          location: 'Heidelberg',
          installationType: 'invalid-type',
        })
      ).rejects.toThrow();
    });

    it('should generate solar forecast for Heidelberg', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 24,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.location).toBe('Heidelberg');
      expect(result.data.installationType).toBe('solar');
      expect(result.data.forecast).toBeInstanceOf(Array);
      expect(result.data.forecast.length).toBeGreaterThan(0);
    });

    it('should generate wind forecast for Bayern', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Bayern',
        installationType: 'wind',
        forecastHorizonHours: 48,
      });

      expect(result.success).toBe(true);
      expect(result.data.installationType).toBe('wind');
      expect(result.data.forecastHorizonHours).toBe(48);
    });

    it('should support combined solar+wind forecast', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Baden-Württemberg',
        installationType: 'all',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data.installationType).toBe('all');
    });

    it('should accept forecastHorizonHours between 1 and 168', async () => {
      // Test minimum
      const result1 = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 1,
      });
      expect(result1.success).toBe(true);

      // Test maximum
      const result2 = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 168,
      });
      expect(result2.success).toBe(true);
    });

    it('should reject invalid forecastHorizonHours', async () => {
      await expect(
        broker.call('forecast.generationForecast', {
          location: 'Heidelberg',
          installationType: 'solar',
          forecastHorizonHours: 0,
        })
      ).rejects.toThrow();

      await expect(
        broker.call('forecast.generationForecast', {
          location: 'Heidelberg',
          installationType: 'solar',
          forecastHorizonHours: 200,
        })
      ).rejects.toThrow();
    });

    it('should support regional filtering with state parameter', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Deutschland',
        installationType: 'solar',
        state: 'Baden-Württemberg',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should support postal code filtering', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        postalCode: '69115',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should support capacity filtering', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Deutschland',
        installationType: 'solar',
        minCapacityKW: 100,
        maxCapacityKW: 1000,
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should include weather data by default', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        includeWeatherData: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.weatherForecast).toBeDefined();
      expect(result.data.weatherForecast).toBeInstanceOf(Array);
    });

    it('should support installation breakdown when requested', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        includeInstallationBreakdown: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.installationBreakdown).toBeDefined();
      expect(result.data.installationBreakdown).toBeInstanceOf(Array);
    });

    it('should return forecast with proper structure', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
        forecastHorizonHours: 24,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('location');
      expect(result.data).toHaveProperty('installationType');
      expect(result.data).toHaveProperty('forecastGenerated');
      expect(result.data).toHaveProperty('totalInstalledCapacityKW');
      expect(result.data).toHaveProperty('installationCount');
      expect(result.data).toHaveProperty('forecast');

      const forecastItem = result.data.forecast[0];
      expect(forecastItem).toHaveProperty('timestamp');
      expect(forecastItem).toHaveProperty('generationKW');
      expect(forecastItem).toHaveProperty('capacityFactor');
      expect(forecastItem).toHaveProperty('confidence');
    });

    it('should include metadata with IEC standards', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
      });

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.toolName).toBe('cernion_mastr_generation_forecast');
      expect(result.metadata.iecStandardsApplied).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      // Mock an error
      callWithNewSession.mockImplementationOnce(async () => {
        throw new Error('Weather API unavailable');
      });

      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('FORECAST_ERROR');
      expect(result.error.message).toContain('Weather API unavailable');
    });

    it('should use default forecastHorizonHours if not provided', async () => {
      const result = await broker.call('forecast.generationForecast', {
        location: 'Heidelberg',
        installationType: 'solar',
      });

      expect(result.success).toBe(true);
      expect(result.data.forecastHorizonHours).toBe(24);
    });
  });
});
