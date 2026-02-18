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
      if (toolName === 'mastr_generation_forecast') {
        return {
          success: true,
          summary: {
            location: params.gridOperatorMastrId
              ? `Netzgebiet ${params.gridOperatorMastrId}`
              : params.location?.bundesland || params.location?.postleitzahl || 'Germany',
            type: params.installationType || 'solar',
            totalCapacityMW: 25.77,
            installationCount: 2756,
            forecastPeriod: {
              start: '2026-02-19T00:00:00.000Z',
              end: '2026-02-26T00:00:00.000Z',
            },
          },
          forecasts: [
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
          ],
          metadata: {
            toolName: 'mastr_generation_forecast',
            timestamp: '2026-02-18T23:00:00.000Z',
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

  describe('generationForecast action', () => {
    it('should work with no required params (all optional)', async () => {
      const result = await broker.call('forecast.generationForecast', {});
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should validate installationType enum', async () => {
      await expect(
        broker.call('forecast.generationForecast', { installationType: 'invalid-type' })
      ).rejects.toThrow();
    });

    it('should validate forecastDays range (min 1)', async () => {
      await expect(
        broker.call('forecast.generationForecast', { forecastDays: 0 })
      ).rejects.toThrow();
    });

    it('should validate forecastDays range (max 14)', async () => {
      await expect(
        broker.call('forecast.generationForecast', { forecastDays: 15 })
      ).rejects.toThrow();
    });

    it('should accept forecastDays 1 and 14 as valid boundaries', async () => {
      const r1 = await broker.call('forecast.generationForecast', { forecastDays: 1 });
      expect(r1.success).toBe(true);
      const r2 = await broker.call('forecast.generationForecast', { forecastDays: 14 });
      expect(r2.success).toBe(true);
    });

    it('should generate solar forecast for a postal code', async () => {
      const result = await broker.call('forecast.generationForecast', {
        postleitzahl: '69115',
        installationType: 'solar',
        forecastDays: 3,
      });
      expect(result.success).toBe(true);
      expect(result.forecasts).toBeInstanceOf(Array);
      expect(result.forecasts.length).toBeGreaterThan(0);
    });

    it('should generate wind forecast for a Bundesland', async () => {
      const result = await broker.call('forecast.generationForecast', {
        bundesland: 'Bayern',
        installationType: 'wind',
        forecastDays: 7,
      });
      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
    });

    it('should support combined solar+wind forecast', async () => {
      const result = await broker.call('forecast.generationForecast', {
        installationType: 'all',
        forecastDays: 7,
      });
      expect(result.success).toBe(true);
    });

    it('should filter by gridOperatorMastrId (SNB935578300972)', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        installationType: 'all',
        forecastDays: 7,
      });
      expect(result.success).toBe(true);
      expect(result.summary.location).toBe('Netzgebiet SNB935578300972');
      expect(result.summary.installationCount).toBe(2756);
    });

    it('should pass gridOperatorMastrId to the MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        installationType: 'all',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({ gridOperatorMastrId: 'SNB935578300972' }),
        undefined
      );
    });

    it('should build nested location object from flat params', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        bundesland: 'Bayern',
        landkreis: 'Rhein-Neckar-Kreis',
        postleitzahl: '69115',
        installationType: 'solar',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({
          location: {
            bundesland: 'Bayern',
            landkreis: 'Rhein-Neckar-Kreis',
            postleitzahl: '69115',
          },
          installationType: 'solar',
        }),
        undefined
      );
    });

    it('should NOT include location key when no location params given', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
      });
      const calledWith = callWithNewSession.mock.calls[0][1];
      expect(calledWith).not.toHaveProperty('location');
    });

    it('should NOT forward format param to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        format: 'json',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.not.objectContaining({ format: 'json' }),
        undefined
      );
    });

    it('should return forecast with correct response structure', async () => {
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        installationType: 'all',
      });
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('forecasts');
      expect(result).toHaveProperty('metadata');
      expect(result.summary).toHaveProperty('totalCapacityMW');
      expect(result.summary).toHaveProperty('installationCount');
      expect(result.summary).toHaveProperty('forecastPeriod');

      const item = result.forecasts[0];
      expect(item).toHaveProperty('timestamp');
      expect(item).toHaveProperty('generationMW');
      expect(item).toHaveProperty('weather');
      expect(item.weather).toHaveProperty('temperature');
      expect(item.weather).toHaveProperty('windSpeed');
    });

    it('should include correct metadata toolName', async () => {
      const result = await broker.call('forecast.generationForecast', {});
      expect(result.metadata.toolName).toBe('mastr_generation_forecast');
    });

    it('should handle errors gracefully', async () => {
      callWithNewSession.mockImplementationOnce(async () => {
        throw new Error('Weather API unavailable');
      });
      const result = await broker.call('forecast.generationForecast', {});
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('FORECAST_ERROR');
      expect(result.error.message).toContain('Weather API unavailable');
    });

    it('should use default forecastDays of 7 if not provided', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', { installationType: 'solar' });
      const calledWith = callWithNewSession.mock.calls[0][1];
      expect(calledWith.forecastDays).toBe(7);
    });

    it('should use default installationType of solar if not provided', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', { forecastDays: 3 });
      const calledWith = callWithNewSession.mock.calls[0][1];
      expect(calledWith.installationType).toBe('solar');
    });
  });
});

