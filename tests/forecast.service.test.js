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
              weather: {
                temperature: 4.3,
                windSpeed: 12.2,
                solarIrradiance: 30.8,
                cloudCover: 100,
              },
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

    it('should validate resolution enum (invalid value rejects)', async () => {
      await expect(
        broker.call('forecast.generationForecast', { resolution: 'weekly' })
      ).rejects.toThrow();
    });

    it('should accept all valid resolution values', async () => {
      for (const res of ['daily', 'hourly', '15min']) {
        const result = await broker.call('forecast.generationForecast', { resolution: res });
        expect(result.success).toBe(true);
      }
    });

    it('normalises resolution "hour" alias to "hourly"', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', { resolution: 'hour' });
      const calledWith = callWithNewSession.mock.calls[0][1];
      expect(calledWith.resolution).toBe('hourly');
    });

    it('accepts "hourly" resolution unchanged', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', { resolution: 'hourly' });
      const calledWith = callWithNewSession.mock.calls[0][1];
      expect(calledWith.resolution).toBe('hourly');
    });

    it('should use default resolution=daily if not provided', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', { forecastDays: 3 });
      const calledWith = callWithNewSession.mock.calls[0][1];
      expect(calledWith.resolution).toBe('daily');
    });

    it('should pass resolution to the MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        resolution: 'hourly',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({ resolution: 'hourly' }),
        undefined
      );
    });
  });

  describe('single-installation forecast (installationMastrNummer)', () => {
    const singleInstResult = {
      success: true,
      summary: {
        location: '49.48,8.45',
        type: 'solar',
        totalCapacityMW: 0.00741,
        installationCount: 1,
        forecastPeriod: {
          start: '2026-02-20T00:00:00.000Z',
          end: '2026-02-23T00:00:00.000Z',
        },
      },
      forecasts: [
        {
          timestamp: '2026-02-20T06:00:00.000Z',
          generationMW: 0.001,
          capacityFactor: 0.135,
          weather: { temperature: 8.2, solarIrradiance: 145.3, cloudCover: 32 },
        },
      ],
      metadata: {
        toolName: 'mastr_generation_forecast',
        weatherDataSource: 'Visual Crossing',
        iecStandardApplied: 'IEC 61853',
        orientationCorrectionApplied: true,
        portfolioOrientationFactor: 0.97,
        orientationDataCoverage: 1.0,
      },
    };

    beforeEach(() => {
      callWithNewSession.mockClear();
    });

    it('should pass installationMastrNummer to MCP tool', async () => {
      await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SEE984033548619',
        forecastDays: 3,
        resolution: 'hourly',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({ installationMastrNummer: 'SEE984033548619' }),
        undefined
      );
    });

    it('should auto-derive installationType=solar for SEE prefix', async () => {
      await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SEE984033548619',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.installationType).toBe('solar');
    });

    it('should auto-derive installationType=wind for SWE prefix', async () => {
      await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SWE900000000001',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.installationType).toBe('wind');
    });

    it('should NOT include location object when installationMastrNummer is set', async () => {
      await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SEE984033548619',
        bundesland: 'Bayern', // should be ignored in single-installation mode
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).not.toHaveProperty('location');
    });

    it('should return single-installation summary (installationCount: 1)', async () => {
      callWithNewSession.mockResolvedValueOnce(singleInstResult);
      const result = await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SEE984033548619',
        forecastDays: 3,
      });
      expect(result.success).toBe(true);
      expect(result.summary.installationCount).toBe(1);
      expect(result.summary.totalCapacityMW).toBe(0.00741);
    });
  });

  describe('single-installation forecast via MeLo (messlokationId)', () => {
    const meloInstResult = {
      success: true,
      summary: {
        location: '49.47,8.44',
        type: 'solar',
        totalCapacityMW: 0.00741,
        installationCount: 1,
        forecastPeriod: {
          start: '2026-02-20T00:00:00.000Z',
          end: '2026-02-21T00:00:00.000Z',
        },
      },
      forecasts: [
        {
          timestamp: '2026-02-20T00:00:00.000Z',
          generationMW: 0.0,
          capacityFactor: 0.0,
          weather: { temperature: 4.1, solarIrradiance: 0, cloudCover: 100 },
        },
      ],
      metadata: { toolName: 'mastr_generation_forecast' },
    };

    beforeEach(() => {
      callWithNewSession.mockClear();
    });

    it('should pass messlokationId to MCP tool', async () => {
      await broker.call('forecast.generationForecast', {
        messlokationId: 'DE0010107352900000000000000336372',
        forecastDays: 1,
        resolution: '15min',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({ messlokationId: 'DE0010107352900000000000000336372' }),
        undefined
      );
    });

    it('should NOT include location object when messlokationId is set', async () => {
      await broker.call('forecast.generationForecast', {
        messlokationId: 'DE0010107352900000000000000336372',
        bundesland: 'Baden-Württemberg', // should be ignored
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).not.toHaveProperty('location');
    });

    it('should return single-installation forecast result via MeLo', async () => {
      callWithNewSession.mockResolvedValueOnce(meloInstResult);
      const result = await broker.call('forecast.generationForecast', {
        messlokationId: 'DE0010107352900000000000000336372',
        forecastDays: 1,
      });
      expect(result.success).toBe(true);
      expect(result.summary.installationCount).toBe(1);
    });

    it('installationMastrNummer takes priority over messlokationId', async () => {
      await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SEE984033548619',
        messlokationId: 'DE0010107352900000000000000336372',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).toHaveProperty('installationMastrNummer', 'SEE984033548619');
      expect(params).not.toHaveProperty('messlokationId');
    });
  });

  describe('historical forecast (startDate parameter)', () => {
    beforeEach(() => {
      callWithNewSession.mockClear();
    });

    it('passes startDate to the MCP tool when provided', async () => {
      await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        startDate: '2026-01-15',
        forecastDays: 7,
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_generation_forecast',
        expect.objectContaining({ startDate: '2026-01-15' }),
        undefined
      );
    });

    it('does NOT include startDate in MCP params when omitted', async () => {
      await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).not.toHaveProperty('startDate');
    });

    it('returns isHistorical and dataMode from MCP response summary', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        summary: {
          location: 'Netzgebiet SNB935578300972',
          type: 'all',
          totalCapacityMW: 25.77,
          installationCount: 2756,
          isHistorical: true,
          dataMode: 'historical_observation',
          forecastPeriod: {
            start: '2026-01-15T00:00:00.000Z',
            end: '2026-01-22T00:00:00.000Z',
          },
        },
        forecasts: [],
        metadata: { toolName: 'mastr_generation_forecast' },
      });
      const result = await broker.call('forecast.generationForecast', {
        gridOperatorMastrId: 'SNB935578300972',
        startDate: '2026-01-15',
        forecastDays: 7,
      });
      expect(result.success).toBe(true);
      expect(result.summary.isHistorical).toBe(true);
      expect(result.summary.dataMode).toBe('historical_observation');
    });

    it('startDate works together with installationMastrNummer', async () => {
      await broker.call('forecast.generationForecast', {
        installationMastrNummer: 'SEE984033548619',
        startDate: '2026-01-10',
        forecastDays: 3,
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).toHaveProperty('installationMastrNummer', 'SEE984033548619');
      expect(params).toHaveProperty('startDate', '2026-01-10');
    });

    it('startDate works together with messlokationId', async () => {
      await broker.call('forecast.generationForecast', {
        messlokationId: 'DE0010107352900000000000000336372',
        startDate: '2026-02-01',
        forecastDays: 1,
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params).toHaveProperty('messlokationId', 'DE0010107352900000000000000336372');
      expect(params).toHaveProperty('startDate', '2026-02-01');
    });
  });
});
