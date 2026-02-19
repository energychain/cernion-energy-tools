'use strict';

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { ServiceBroker } = require('moleculer');
const { callWithNewSession } = require('../src/mcp-client');
const ResidualLoadService = require('../services/residual-load.service');

// ── helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a realistic mastr_net_residual_load mock response.
 *
 * @param {object} params - MCP params that were passed
 */
function buildResidualLoadResponse(params = {}) {
  const days = params.forecastDays || 1;
  const resolution = params.resolution || 'hourly';
  const ptsPerDay = resolution === '15min' ? 96 : 24;
  const totalPoints = days * ptsPerDay;
  const stepMs = resolution === '15min' ? 15 * 60 * 1000 : 60 * 60 * 1000;
  const startTs = new Date('2025-01-15T00:00:00.000Z');

  return {
    summary: {
      region: params.region || 'Ludwigshafen',
      forecastPeriod: {
        start: startTs.toISOString(),
        end: new Date(startTs.getTime() + totalPoints * stepMs).toISOString(),
      },
      resolution,
      dataPoints: totalPoints,
      installedCapacity: {
        totalPV_MW: 42.7,
        totalWind_MW: 8.1,
        pvInstallations: 1203,
        windInstallations: 12,
      },
      loadScaling: {
        populationUsed: params.populationOverride ? String(params.populationOverride) : '170.000',
        scalingFactorPct: '0.202%',
        isActualData: true,
        dataSource: 'SMARD filter 410 (realized)',
      },
      kpis: {
        peakResidualLoadMW: 87.4,
        peakResidualAt: '2025-01-15T18:00:00.000Z',
        minResidualLoadMW: 31.2,
        avgResidualLoadMW: 58.9,
        totalLoadMWh: 1413.6,
        totalEEGenerationMWh: 38.2,
        totalResidualLoadMWh: 1375.4,
        avgEESharePct: 2.7,
      },
    },
    forecast: Array.from({ length: totalPoints }, (_, i) => ({
      timestamp: new Date(startTs.getTime() + i * stepMs).toISOString(),
      loadMW: 60 + i * 0.1,
      pvGenerationMW: 0.5,
      windGenerationMW: 3.0,
      eeGenerationMW: 3.5,
      residualLoadMW: 56.5 + i * 0.1,
      eeSharePct: 5.8,
    })),
    methodology: {
      loadModel: 'SMARD national load × population ratio',
      eeModel: 'MaStR capacity × weather (Visual Crossing) × IEC coefficients',
      residualFormula: 'Residuallast = RegionaleLast − PV − Wind',
      interpolation: 'linear (§12 StromNZV)',
    },
  };
}

function buildLoadForecastRegionalResponse(params = {}) {
  return {
    success: true,
    region: params.region || 'Mannheim',
    forecastSummary: 'Load forecast generated with real MaStR capacity anchors.',
    installedCapacity: { pv_MW: 55.3, wind_MW: 4.2 },
    recommendation: 'Procure ~380 MWh on day-ahead. Peak 18–20h requires ~95 MW.',
  };
}

// ── test suite ─────────────────────────────────────────────────────────────────

describe('Residual Load Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      if (toolName === 'mastr_net_residual_load') return buildResidualLoadResponse(params);
      if (toolName === 'cernion_load_forecast_regional') return buildLoadForecastRegionalResponse(params);
      throw new Error(`Unexpected tool: ${toolName}`);
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(ResidualLoadService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    callWithNewSession.mockImplementation(async (toolName, params) => {
      if (toolName === 'mastr_net_residual_load') return buildResidualLoadResponse(params);
      if (toolName === 'cernion_load_forecast_regional') return buildLoadForecastRegionalResponse(params);
      throw new Error(`Unexpected tool: ${toolName}`);
    });
  });

  // ── service definition ──────────────────────────────────────────────────────

  describe('Service definition', () => {
    it('has name "residual-load"', () => {
      expect(ResidualLoadService.name).toBe('residual-load');
    });

    it('has defaultTimeout in settings', () => {
      expect(ResidualLoadService.settings.defaultTimeout).toBeGreaterThanOrEqual(60000);
    });

    it('exposes netResidualLoad action', () => {
      expect(ResidualLoadService.actions.netResidualLoad).toBeDefined();
    });

    it('exposes loadForecastRegional action', () => {
      expect(ResidualLoadService.actions.loadForecastRegional).toBeDefined();
    });

    it('netResidualLoad has REST POST mapping', () => {
      expect(ResidualLoadService.actions.netResidualLoad.rest).toBe('POST /net-residual-load');
    });

    it('loadForecastRegional has REST POST mapping', () => {
      expect(ResidualLoadService.actions.loadForecastRegional.rest).toBe('POST /load-forecast-regional');
    });
  });

  // ── netResidualLoad ─────────────────────────────────────────────────────────

  describe('netResidualLoad', () => {
    describe('required parameter validation', () => {
      it('succeeds with region only (minimum required)', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Ludwigshafen' });
        expect(result).toHaveProperty('summary');
        expect(result.summary.region).toBe('Ludwigshafen');
      });

      it('calls mastr_net_residual_load tool', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Mannheim' });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ region: 'Mannheim' }),
          undefined
        );
      });

      it('passes cernionToken from ctx.meta', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Test' }, { meta: { cernionToken: 'my-token' } });
        expect(callWithNewSession).toHaveBeenCalledWith('mastr_net_residual_load', expect.any(Object), 'my-token');
      });
    });

    describe('optional parameters', () => {
      it('passes gridOperatorMastrId when provided', async () => {
        await broker.call('residual-load.netResidualLoad', {
          region: 'Ludwigshafen',
          gridOperatorMastrId: 'SNB935578300972',
        });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ gridOperatorMastrId: 'SNB935578300972' }),
          undefined
        );
      });

      it('passes populationOverride when provided', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Ludwigshafen', populationOverride: 170000 });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ populationOverride: 170000 }),
          undefined
        );
      });

      it('passes forecastDays when provided', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Bayern', forecastDays: 7 });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ forecastDays: 7 }),
          undefined
        );
      });

      it('passes resolution "15min" when provided', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Test', resolution: '15min' });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ resolution: '15min' }),
          undefined
        );
      });

      it('passes installationType "solar" when provided', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Test', installationType: 'solar' });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ installationType: 'solar' }),
          undefined
        );
      });
    });

    describe('location object building', () => {
      it('builds nested location object from flat bundesland', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Bayern', bundesland: 'Bayern' });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ location: { bundesland: 'Bayern' } }),
          undefined
        );
      });

      it('builds nested location object from flat postleitzahl', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Heidelberg', postleitzahl: '69115' });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ location: { postleitzahl: '69115' } }),
          undefined
        );
      });

      it('builds nested location from lat/lon', async () => {
        await broker.call('residual-load.netResidualLoad', {
          region: 'Test',
          latitude: 49.4744,
          longitude: 8.4349,
        });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({ location: { latitude: 49.4744, longitude: 8.4349 } }),
          undefined
        );
      });

      it('builds complete location object from all flat fields', async () => {
        await broker.call('residual-load.netResidualLoad', {
          region: 'Heidelberg',
          bundesland: 'Baden-Württemberg',
          landkreis: 'Rhein-Neckar-Kreis',
          gemeinde: 'Heidelberg',
          postleitzahl: '69115',
          latitude: 49.4093,
          longitude: 8.6942,
        });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'mastr_net_residual_load',
          expect.objectContaining({
            location: {
              bundesland: 'Baden-Württemberg',
              landkreis: 'Rhein-Neckar-Kreis',
              gemeinde: 'Heidelberg',
              postleitzahl: '69115',
              latitude: 49.4093,
              longitude: 8.6942,
            },
          }),
          undefined
        );
      });

      it('does NOT add empty location object when no flat location fields', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Test' });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.location).toBeUndefined();
      });

      it('does NOT pass flat location fields directly to MCP (only nested)', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Test', bundesland: 'Bayern' });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.bundesland).toBeUndefined();
        expect(params.postleitzahl).toBeUndefined();
        expect(params.latitude).toBeUndefined();
        expect(params.longitude).toBeUndefined();
      });

      it('does NOT pass format field to MCP', async () => {
        await broker.call('residual-load.netResidualLoad', { region: 'Test', format: 'csv' });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.format).toBeUndefined();
      });
    });

    describe('response structure', () => {
      it('returns summary with region', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Ludwigshafen' });
        expect(result.summary.region).toBe('Ludwigshafen');
      });

      it('returns forecast array', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test' });
        expect(Array.isArray(result.forecast)).toBe(true);
        expect(result.forecast.length).toBeGreaterThan(0);
      });

      it('returns methodology with residualFormula', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test' });
        expect(result.methodology.residualFormula).toMatch(/Residuallast/);
      });

      it('forecast items contain required fields', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test' });
        const item = result.forecast[0];
        expect(item).toHaveProperty('timestamp');
        expect(item).toHaveProperty('loadMW');
        expect(item).toHaveProperty('residualLoadMW');
        expect(item).toHaveProperty('eeGenerationMW');
      });
    });

    describe('CSV format', () => {
      it('returns string when format=csv', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test', format: 'csv' });
        expect(typeof result).toBe('string');
      });

      it('CSV contains metadata comment header', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Heidelberg', format: 'csv' });
        expect(result).toContain('# Net Residual Load Forecast');
        expect(result).toContain('# Region: Heidelberg');
      });

      it('CSV contains column headers', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test', format: 'csv' });
        expect(result).toContain('Timestamp');
        expect(result).toContain('Residual Load (MW)');
        expect(result).toContain('EE Share (%)');
      });

      it('CSV contains data rows', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test', format: 'csv' });
        const lines = result.split('\n').filter((l) => l && !l.startsWith('#'));
        // header + at least one data row
        expect(lines.length).toBeGreaterThan(1);
      });
    });

    describe('XLSX format', () => {
      it('returns Buffer when format=xlsx', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test', format: 'xlsx' });
        expect(Buffer.isBuffer(result)).toBe(true);
      });

      it('XLSX starts with PK (ZIP magic bytes)', async () => {
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test', format: 'xlsx' });
        expect(result[0]).toBe(0x50); // P
        expect(result[1]).toBe(0x4b); // K
      });
    });

    describe('error handling', () => {
      it('returns error object when MCP throws', async () => {
        callWithNewSession.mockRejectedValueOnce(new Error('SMARD timeout'));
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test' });
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('RESIDUAL_LOAD_ERROR');
        expect(result.error.message).toContain('SMARD timeout');
      });

      it('returns generic message when error has no message', async () => {
        callWithNewSession.mockRejectedValueOnce({});
        const result = await broker.call('residual-load.netResidualLoad', { region: 'Test' });
        expect(result.success).toBe(false);
        expect(result.error.message).toBe('Failed to calculate residual load');
      });
    });
  });

  // ── loadForecastRegional ────────────────────────────────────────────────────

  describe('loadForecastRegional', () => {
    describe('required parameter', () => {
      it('succeeds with region only', async () => {
        const result = await broker.call('residual-load.loadForecastRegional', { region: 'Mannheim' });
        expect(result).toBeDefined();
        expect(result.success).toBe(true);
      });

      it('calls cernion_load_forecast_regional tool', async () => {
        await broker.call('residual-load.loadForecastRegional', { region: 'Mannheim' });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'cernion_load_forecast_regional',
          expect.objectContaining({ region: 'Mannheim' }),
          undefined
        );
      });

      it('passes cernionToken from ctx.meta', async () => {
        await broker.call(
          'residual-load.loadForecastRegional',
          { region: 'Test' },
          { meta: { cernionToken: 'bearer-xyz' } }
        );
        expect(callWithNewSession).toHaveBeenCalledWith(
          'cernion_load_forecast_regional',
          expect.any(Object),
          'bearer-xyz'
        );
      });
    });

    describe('optional parameters', () => {
      it('passes populationOverride', async () => {
        await broker.call('residual-load.loadForecastRegional', { region: 'Mannheim', populationOverride: 320000 });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'cernion_load_forecast_regional',
          expect.objectContaining({ populationOverride: 320000 }),
          undefined
        );
      });

      it('passes forecastDays', async () => {
        await broker.call('residual-load.loadForecastRegional', { region: 'Mannheim', forecastDays: 3 });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'cernion_load_forecast_regional',
          expect.objectContaining({ forecastDays: 3 }),
          undefined
        );
      });

      it('passes additionalContext', async () => {
        await broker.call('residual-load.loadForecastRegional', {
          region: 'Ludwigshafen',
          additionalContext: 'Large BASF industrial plant',
        });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'cernion_load_forecast_regional',
          expect.objectContaining({ additionalContext: 'Large BASF industrial plant' }),
          undefined
        );
      });

      it('passes gridOperatorMastrId', async () => {
        await broker.call('residual-load.loadForecastRegional', {
          region: 'Ludwigshafen',
          gridOperatorMastrId: 'SNB935578300972',
        });
        expect(callWithNewSession).toHaveBeenCalledWith(
          'cernion_load_forecast_regional',
          expect.objectContaining({ gridOperatorMastrId: 'SNB935578300972' }),
          undefined
        );
      });
    });

    describe('location building', () => {
      it('builds nested location from bundesland', async () => {
        await broker.call('residual-load.loadForecastRegional', { region: 'Test', bundesland: 'Bayern' });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.location).toEqual({ bundesland: 'Bayern' });
        expect(params.bundesland).toBeUndefined();
      });

      it('builds nested location from postleitzahl', async () => {
        await broker.call('residual-load.loadForecastRegional', { region: 'Test', postleitzahl: '68159' });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.location).toEqual({ postleitzahl: '68159' });
        expect(params.postleitzahl).toBeUndefined();
      });

      it('builds nested location combining bundesland and postleitzahl', async () => {
        await broker.call('residual-load.loadForecastRegional', {
          region: 'Test',
          bundesland: 'Baden-Württemberg',
          postleitzahl: '68159',
        });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.location).toEqual({ bundesland: 'Baden-Württemberg', postleitzahl: '68159' });
      });

      it('omits location key when no flat fields provided', async () => {
        await broker.call('residual-load.loadForecastRegional', { region: 'Test' });
        const [, params] = callWithNewSession.mock.calls[0];
        expect(params.location).toBeUndefined();
      });
    });

    describe('error handling', () => {
      it('returns error object when MCP throws', async () => {
        callWithNewSession.mockRejectedValueOnce(new Error('LLM timeout'));
        const result = await broker.call('residual-load.loadForecastRegional', { region: 'Test' });
        expect(result.success).toBe(false);
        expect(result.error.code).toBe('LOAD_FORECAST_ERROR');
        expect(result.error.message).toContain('LLM timeout');
      });

      it('returns fallback message when error has no message', async () => {
        callWithNewSession.mockRejectedValueOnce({});
        const result = await broker.call('residual-load.loadForecastRegional', { region: 'Test' });
        expect(result.error.message).toBe('Failed to generate load forecast');
      });
    });
  });

  // ── buildLocationObj method ─────────────────────────────────────────────────

  describe('buildLocationObj method', () => {
    let serviceInstance;

    beforeAll(() => {
      serviceInstance = broker.getLocalService('residual-load');
    });

    it('returns empty object when called with no args', () => {
      const result = serviceInstance.buildLocationObj();
      expect(result).toEqual({});
    });

    it('includes only defined fields', () => {
      const result = serviceInstance.buildLocationObj({ bundesland: 'Bayern', landkreis: undefined });
      expect(result).toEqual({ bundesland: 'Bayern' });
    });

    it('includes latitude 0 (falsy but defined)', () => {
      const result = serviceInstance.buildLocationObj({ latitude: 0, longitude: 0 });
      // lat/lon 0 is a valid value (albeit in the ocean) — check not filtered
      // Our implementation uses `!== undefined`, so 0 should be included
      expect(result.latitude).toBe(0);
      expect(result.longitude).toBe(0);
    });
  });

  // ── convertToCSV method ─────────────────────────────────────────────────────

  describe('convertToCSV method', () => {
    let serviceInstance;

    beforeAll(() => {
      serviceInstance = broker.getLocalService('residual-load');
    });

    it('returns placeholder string for empty data', () => {
      expect(serviceInstance.convertToCSV([])).toContain('No residual load data');
    });

    it('includes all required columns', () => {
      const data = [{ timestamp: 't', loadMW: 60, pvGenerationMW: 1, windGenerationMW: 2, eeGenerationMW: 3, residualLoadMW: 57, eeSharePct: 5 }];
      const csv = serviceInstance.convertToCSV(data, null);
      expect(csv).toContain('Load (MW)');
      expect(csv).toContain('Residual Load (MW)');
      expect(csv).toContain('EE Share (%)');
    });

    it('includes region in metadata comment when summary provided', () => {
      const summary = { region: 'Mannheim', resolution: 'hourly', kpis: {}, installedCapacity: {} };
      const data = [{ timestamp: 't', loadMW: 60, pvGenerationMW: 0, windGenerationMW: 0, eeGenerationMW: 0, residualLoadMW: 60, eeSharePct: 0 }];
      expect(serviceInstance.convertToCSV(data, summary)).toContain('# Region: Mannheim');
    });
  });

  // ── convertToXLSX method ───────────────────────────────────────────────────

  describe('convertToXLSX method', () => {
    let serviceInstance;

    beforeAll(() => {
      serviceInstance = broker.getLocalService('residual-load');
    });

    it('returns Buffer for empty data', () => {
      const result = serviceInstance.convertToXLSX([], null, null);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('returns valid XLSX buffer for real data', () => {
      const data = [{ timestamp: 't1', loadMW: 60, pvGenerationMW: 1, windGenerationMW: 2, eeGenerationMW: 3, residualLoadMW: 57, eeSharePct: 5 }];
      const result = serviceInstance.convertToXLSX(data, null, null);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result[0]).toBe(0x50); // ZIP/XLSX magic bytes
    });

    it('includes summary sheet when summary is provided', () => {
      const XLSX = require('xlsx');
      const data = [{ timestamp: 't1', loadMW: 60, pvGenerationMW: 1, windGenerationMW: 2, eeGenerationMW: 3, residualLoadMW: 57, eeSharePct: 5 }];
      const summary = { region: 'Test', resolution: 'hourly', dataPoints: 1, installedCapacity: { totalPV_MW: 10, totalWind_MW: 2, pvInstallations: 10, windInstallations: 1 }, loadScaling: {}, kpis: { peakResidualLoadMW: 60 } };
      const buf = serviceInstance.convertToXLSX(data, summary, { residualFormula: 'Test formula' });
      const wb = XLSX.read(buf, { type: 'buffer' });
      expect(wb.SheetNames).toContain('Forecast');
      expect(wb.SheetNames).toContain('Summary');
    });
  });
});
