'use strict';

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { ServiceBroker } = require('moleculer');
const { callWithNewSession } = require('../src/mcp-client');
const ResidualLoadService = require('../services/residual-load.service');

// ── test data factories ────────────────────────────────────────────────────────

/**
 * Build a time-series forecast array for the given number of days and resolution.
 * Used by the mock and data-point count assertions.
 */
function buildForecastArray(days, resolution) {
  const ptsPerDay = resolution === '15min' ? 96 : 24;
  const totalPoints = days * ptsPerDay;
  const stepMs = resolution === '15min' ? 15 * 60 * 1000 : 60 * 60 * 1000;
  const start = new Date('2025-01-15T00:00:00.000Z');

  return Array.from({ length: totalPoints }, (_, i) => ({
    timestamp: new Date(start.getTime() + i * stepMs).toISOString(),
    loadMW: 55 + (i % 24) * 1.2,
    pvGenerationMW: i % 24 >= 8 && i % 24 <= 18 ? 3.5 : 0,
    windGenerationMW: 2.0 + (i % 7) * 0.3,
    eeGenerationMW: (i % 24 >= 8 && i % 24 <= 18 ? 3.5 : 0) + 2.0 + (i % 7) * 0.3,
    residualLoadMW:
      55 + (i % 24) * 1.2 - ((i % 24 >= 8 && i % 24 <= 18 ? 3.5 : 0) + 2.0 + (i % 7) * 0.3),
    eeSharePct: 5.0,
  }));
}

function buildResidualLoadMockResponse(params) {
  const days = params.forecastDays || 1;
  const resolution = params.resolution || 'hourly';
  const forecast = buildForecastArray(days, resolution);

  return {
    summary: {
      region: params.region,
      forecastPeriod: {
        start: forecast[0].timestamp,
        end: forecast[forecast.length - 1].timestamp,
      },
      resolution,
      dataPoints: forecast.length,
      installedCapacity: {
        totalPV_MW: params.region === 'Bayern' ? 12500 : 42.7,
        totalWind_MW: params.region === 'Bayern' ? 4200 : 8.1,
        pvInstallations: params.region === 'Bayern' ? 420000 : 1203,
        windInstallations: params.region === 'Bayern' ? 1800 : 12,
      },
      loadScaling: {
        populationUsed: params.populationOverride
          ? String(params.populationOverride)
          : params.region === 'Bayern'
            ? '13.100.000'
            : '170.000',
        scalingFactorPct: params.region === 'Bayern' ? '15.6%' : '0.202%',
        isActualData: days <= 1,
        dataSource:
          days <= 1
            ? 'SMARD filter 410 (realized)'
            : days === 2
              ? 'SMARD filter 411 (day-ahead)'
              : 'SMARD filter 410 reference week',
      },
      kpis: {
        peakResidualLoadMW: 87.4,
        peakResidualAt: '2025-01-15T18:00:00.000Z',
        minResidualLoadMW: 31.2,
        avgResidualLoadMW: 58.9,
        totalLoadMWh:
          forecast.reduce((s, p) => s + p.loadMW, 0) * (resolution === '15min' ? 0.25 : 1),
        totalEEGenerationMWh:
          forecast.reduce((s, p) => s + p.eeGenerationMW, 0) * (resolution === '15min' ? 0.25 : 1),
        totalResidualLoadMWh:
          forecast.reduce((s, p) => s + p.residualLoadMW, 0) * (resolution === '15min' ? 0.25 : 1),
        avgEESharePct: 5.0,
      },
    },
    forecast,
    methodology: {
      loadModel: 'SMARD national load × population ratio',
      eeModel: 'MaStR capacity × weather (Visual Crossing) × IEC coefficients',
      residualFormula: 'Residuallast = RegionaleLast − PV − Wind',
      interpolation: resolution === '15min' ? 'linear (§12 StromNZV)' : 'n/a (native hourly)',
    },
  };
}

// ── suite ──────────────────────────────────────────────────────────────────────

describe('Residual Load Service — Integration Tests', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      if (toolName === 'mastr_net_residual_load') return buildResidualLoadMockResponse(params);
      if (toolName === 'cernion_load_forecast_regional')
        return { success: true, region: params.region };
      if (toolName === 'cernion_installations_local') {
        return {
          success: true,
          data: {
            installations: [{ gemeinde: 'IntegrationCity', bundesland: 'IntegrationState' }],
          },
        };
      }
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
      if (toolName === 'mastr_net_residual_load') return buildResidualLoadMockResponse(params);
      if (toolName === 'cernion_load_forecast_regional')
        return { success: true, region: params.region };
      if (toolName === 'cernion_installations_local') {
        return {
          success: true,
          data: {
            installations: [{ gemeinde: 'IntegrationCity', bundesland: 'IntegrationState' }],
          },
        };
      }
      throw new Error(`Unexpected tool: ${toolName}`);
    });
  });

  // ── §12 StromNZV: 15-min day-ahead procurement (TWL Ludwigshafen) ────────────

  describe('Day-ahead procurement scenario (TWL Ludwigshafen, 15-min)', () => {
    let result;
    beforeEach(async () => {
      result = await broker.call('residual-load.netResidualLoad', {
        region: 'Ludwigshafen',
        gridOperatorMastrId: 'SNB935578300972',
        forecastDays: 1,
        resolution: '15min',
        installationType: 'all',
      });
    });

    it('returns exactly 96 data points (D+1, 15-min)', () => {
      expect(result.forecast).toHaveLength(96);
      expect(result.summary.dataPoints).toBe(96);
    });

    it('summary shows region Ludwigshafen', () => {
      expect(result.summary.region).toBe('Ludwigshafen');
    });

    it('summary shows 15min resolution', () => {
      expect(result.summary.resolution).toBe('15min');
    });

    it('all forecast items have required fields', () => {
      result.forecast.forEach((item) => {
        expect(item).toHaveProperty('timestamp');
        expect(item).toHaveProperty('loadMW');
        expect(item).toHaveProperty('pvGenerationMW');
        expect(item).toHaveProperty('windGenerationMW');
        expect(item).toHaveProperty('eeGenerationMW');
        expect(item).toHaveProperty('residualLoadMW');
        expect(item).toHaveProperty('eeSharePct');
      });
    });

    it('residualLoadMW = loadMW − eeGenerationMW for each point', () => {
      result.forecast.forEach((item) => {
        const expected = parseFloat((item.loadMW - item.eeGenerationMW).toFixed(6));
        const actual = parseFloat(item.residualLoadMW.toFixed(6));
        expect(actual).toBeCloseTo(expected, 3);
      });
    });

    it('eeGenerationMW = pvGenerationMW + windGenerationMW for each point', () => {
      result.forecast.forEach((item) => {
        const expected = parseFloat((item.pvGenerationMW + item.windGenerationMW).toFixed(6));
        expect(item.eeGenerationMW).toBeCloseTo(expected, 3);
      });
    });

    it('timestamps are 15-min apart', () => {
      const ts1 = new Date(result.forecast[0].timestamp).getTime();
      const ts2 = new Date(result.forecast[1].timestamp).getTime();
      expect(ts2 - ts1).toBe(15 * 60 * 1000);
    });

    it('calls MCP with correct tool and params', () => {
      expect(callWithNewSession).toHaveBeenCalledWith(
        'mastr_net_residual_load',
        expect.objectContaining({
          region: 'Ludwigshafen',
          gridOperatorMastrId: 'SNB935578300972',
          forecastDays: 1,
          resolution: '15min',
          installationType: 'all',
        }),
        undefined
      );
    });

    it('methodology states §12 StromNZV interpolation', () => {
      expect(result.methodology.interpolation).toMatch(/§12 StromNZV/);
    });
  });

  // ── Bayern 7-day hourly ─────────────────────────────────────────────────────

  describe('Bayern weekly hourly forecast', () => {
    let result;
    beforeEach(async () => {
      result = await broker.call('residual-load.netResidualLoad', {
        region: 'Bayern',
        bundesland: 'Bayern',
        forecastDays: 7,
        resolution: 'hourly',
      });
    });

    it('returns exactly 168 data points (7 days × 24 hours)', () => {
      expect(result.forecast).toHaveLength(168);
      expect(result.summary.dataPoints).toBe(168);
    });

    it('summary shows hourly resolution', () => {
      expect(result.summary.resolution).toBe('hourly');
    });

    it('timestamps are 1 hour apart', () => {
      const ts1 = new Date(result.forecast[0].timestamp).getTime();
      const ts2 = new Date(result.forecast[1].timestamp).getTime();
      expect(ts2 - ts1).toBe(60 * 60 * 1000);
    });

    it('builds nested location.bundesland=Bayern', () => {
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.location).toEqual({ bundesland: 'Bayern' });
    });

    it('large Bayern capacity: PV >1000 MW and Wind >100 MW', () => {
      expect(result.summary.installedCapacity.totalPV_MW).toBeGreaterThan(1000);
      expect(result.summary.installedCapacity.totalWind_MW).toBeGreaterThan(100);
    });

    it('loadScaling shows reference week fallback for multi-day (isActualData depends on days)', () => {
      // For 7 days, D+2..D+7 use reference week → isActualData false
      expect(result.summary.loadScaling.dataSource).toContain('reference week');
    });

    it('has KPIs with peak and average values', () => {
      const kpis = result.summary.kpis;
      expect(kpis.peakResidualLoadMW).toBeGreaterThan(0);
      expect(kpis.avgResidualLoadMW).toBeGreaterThan(0);
      expect(kpis.totalLoadMWh).toBeGreaterThan(0);
    });
  });

  // ── populationOverride industrial site ──────────────────────────────────────

  describe('Industrial site with populationOverride', () => {
    let result;
    beforeEach(async () => {
      result = await broker.call('residual-load.netResidualLoad', {
        region: 'Ludwigshafen',
        populationOverride: 500000,
        forecastDays: 2,
        resolution: 'hourly',
      });
    });

    it('returns exactly 48 data points (2 days × 24 hours)', () => {
      expect(result.forecast).toHaveLength(48);
      expect(result.summary.dataPoints).toBe(48);
    });

    it('populationOverride is passed to MCP', () => {
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.populationOverride).toBe(500000);
    });

    it('populationUsed in response reflects override', () => {
      expect(result.summary.loadScaling.populationUsed).toContain('500000');
    });

    it('has total MWh values consistent with 48 hourly data points', () => {
      const expectedLoad = result.forecast.reduce((s, p) => s + p.loadMW, 0);
      // totalLoadMWh ≈ sum of loadMW (hourly = MWh directly)
      expect(result.summary.kpis.totalLoadMWh).toBeCloseTo(expectedLoad, 0);
    });
  });

  // ── data point count validation ─────────────────────────────────────────────

  describe('Data point count assertions', () => {
    const cases = [
      { days: 1, resolution: 'hourly', expected: 24, label: '1-day hourly' },
      { days: 2, resolution: 'hourly', expected: 48, label: '2-day hourly' },
      { days: 7, resolution: 'hourly', expected: 168, label: '7-day hourly' },
      { days: 14, resolution: 'hourly', expected: 336, label: '14-day hourly' },
      { days: 1, resolution: '15min', expected: 96, label: '1-day 15-min' },
      { days: 2, resolution: '15min', expected: 192, label: '2-day 15-min' },
      { days: 7, resolution: '15min', expected: 672, label: '7-day 15-min' },
    ];

    cases.forEach(({ days, resolution, expected, label }) => {
      it(`${label}: returns ${expected} data points`, async () => {
        const result = await broker.call('residual-load.netResidualLoad', {
          region: 'Test',
          forecastDays: days,
          resolution,
        });
        expect(result.forecast).toHaveLength(expected);
        expect(result.summary.dataPoints).toBe(expected);
      });
    });
  });

  // ── installationType filtering ───────────────────────────────────────────────

  describe('installationType filtering', () => {
    it('passes installationType=solar to MCP', async () => {
      await broker.call('residual-load.netResidualLoad', {
        region: 'Test',
        installationType: 'solar',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.installationType).toBe('solar');
    });

    it('passes installationType=wind to MCP', async () => {
      await broker.call('residual-load.netResidualLoad', {
        region: 'Test',
        installationType: 'wind',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.installationType).toBe('wind');
    });

    it('passes installationType=all to MCP', async () => {
      await broker.call('residual-load.netResidualLoad', {
        region: 'Test',
        installationType: 'all',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.installationType).toBe('all');
    });
  });

  // ── CSV export integration ───────────────────────────────────────────────────

  describe('CSV export — 15-min, 2 days', () => {
    let csv;
    beforeEach(async () => {
      csv = await broker.call('residual-load.netResidualLoad', {
        region: 'Heidelberg',
        postleitzahl: '69115',
        forecastDays: 2,
        resolution: '15min',
        format: 'csv',
      });
    });

    it('returns a string', () => {
      expect(typeof csv).toBe('string');
    });

    it('contains region metadata header', () => {
      expect(csv).toContain('# Region: Heidelberg');
    });

    it('has 192 data rows (2 days × 96 pts)', () => {
      const dataLines = csv
        .split('\n')
        .filter((l) => l && !l.startsWith('#') && !l.includes('Timestamp'));
      expect(dataLines).toHaveLength(192);
    });
  });

  // ── XLSX export integration ──────────────────────────────────────────────────

  describe('XLSX export — Bayern 3-day 15-min', () => {
    let buffer;
    beforeEach(async () => {
      buffer = await broker.call('residual-load.netResidualLoad', {
        region: 'Bayern',
        bundesland: 'Bayern',
        forecastDays: 3,
        resolution: '15min',
        format: 'xlsx',
      });
    });

    it('returns a Buffer', () => {
      expect(Buffer.isBuffer(buffer)).toBe(true);
    });

    it('XLSX has Forecast and Summary sheets', () => {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      expect(wb.SheetNames).toContain('Forecast');
      expect(wb.SheetNames).toContain('Summary');
    });

    it('Forecast sheet has 288 rows + 1 header (3 × 96 = 288)', () => {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets['Forecast'];
      const data = XLSX.utils.sheet_to_json(ws);
      expect(data).toHaveLength(288);
    });

    it('Summary sheet includes region', () => {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const ws = wb.Sheets['Summary'];
      const rows = XLSX.utils.sheet_to_json(ws);
      const regionRow = rows.find((r) => r.Property === 'Region');
      expect(regionRow).toBeDefined();
      expect(regionRow.Value).toBe('Bayern');
    });
  });

  // ── loadForecastRegional integration ────────────────────────────────────────

  describe('loadForecastRegional integration', () => {
    it('calls correct tool with region', async () => {
      await broker.call('residual-load.loadForecastRegional', { region: 'Heidelberg' });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_load_forecast_regional',
        expect.objectContaining({ region: 'Heidelberg' }),
        undefined
      );
    });

    it('passes real-world params through unchanged', async () => {
      await broker.call('residual-load.loadForecastRegional', {
        region: 'Mannheim',
        populationOverride: 320000,
        forecastDays: 3,
        gridOperatorMastrId: 'SNB935578300972',
        additionalContext: 'Large BASF industrial plant adds ~200 MW base load',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.region).toBe('Mannheim');
      expect(params.populationOverride).toBe(320000);
      expect(params.forecastDays).toBe(3);
      expect(params.gridOperatorMastrId).toBe('SNB935578300972');
      expect(params.additionalContext).toContain('BASF');
    });

    it('builds nested location for bundesland + postleitzahl', async () => {
      await broker.call('residual-load.loadForecastRegional', {
        region: 'Test',
        bundesland: 'Baden-Württemberg',
        postleitzahl: '68159',
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.location).toEqual({ bundesland: 'Baden-Württemberg', postleitzahl: '68159' });
    });

    it('returns success true from mock', async () => {
      const result = await broker.call('residual-load.loadForecastRegional', {
        region: 'Mannheim',
      });
      expect(result.success).toBe(true);
    });

    it('only calls cernion_load_forecast_regional (not mastr_net_residual_load)', async () => {
      await broker.call('residual-load.loadForecastRegional', { region: 'Mannheim' });
      const allTools = callWithNewSession.mock.calls.map(([tool]) => tool);
      expect(allTools).not.toContain('mastr_net_residual_load');
    });
  });
});
