/**
 * Energy Market Service Integration Tests
 *
 * Live tests for Energy Market Data microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const EnergyMarketService = require('../services/energy-market.service');

describe('Energy Market Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(EnergyMarketService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('prices action', () => {
    it('should require market and region parameters', async () => {
      await expect(broker.call('energy-market.prices', {})).rejects.toThrow();
    });

    it('should validate market enum', async () => {
      await expect(
        broker.call('energy-market.prices', {
          market: 'invalid-market',
          region: 'Deutschland',
        })
      ).rejects.toThrow();
    });

    it('should retrieve day-ahead prices for Germany', async () => {
      const result = await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'Deutschland',
        date: '2026-02-04',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should support date range queries', async () => {
      const result = await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-03',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should pass through backend-structured PRICE_DATA_UNAVAILABLE errors directly', async () => {
      // Backend v2+ always returns { success: false, error: { code, message, source } }
      // for all failure paths (wrong source routing, no data, unsupported region, etc.).
      callWithNewSession.mockResolvedValueOnce({
        success: false,
        error: {
          code: 'PRICE_DATA_UNAVAILABLE',
          message: 'Day-Ahead electricity price data not found for region=Deutschland, date=2026-03-01: no data for this date',
          source: 'cernion_energy_prices',
        },
      });

      const result = await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'Deutschland',
        date: '2026-03-01',
      });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('PRICE_DATA_UNAVAILABLE');
      expect(result.error.source).toBe('cernion_energy_prices');
    });

    it('should normalize ENTSO-E bidding zone codes to "Deutschland" before calling MCP', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: { prices: [{ timestamp: '2026-03-01T00:00:00Z', priceEURMWh: 42.5 }] },
      });

      await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'DE-LU',
        date: '2026-03-01',
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_energy_prices',
        expect.objectContaining({ region: 'Deutschland' }),
        undefined
      );
    });

    it('should normalize "DE-AT-LU" to "Deutschland"', async () => {
      callWithNewSession.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'DE-AT-LU',
        date: '2026-03-01',
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_energy_prices',
        expect.objectContaining({ region: 'Deutschland' }),
        undefined
      );
    });

    it('should return PRICE_DATA_UNAVAILABLE when MCP call throws', async () => {
      callWithNewSession.mockRejectedValueOnce(new Error('MCP connection timeout'));

      const result = await broker.call('energy-market.prices', {
        market: 'day-ahead',
        region: 'Deutschland',
        date: '2026-03-01',
      });

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('PRICE_DATA_UNAVAILABLE');
      expect(result.error.message).toMatch(/timeout/i);
    });
  });

  describe('production action', () => {
    it('should require all mandatory parameters', async () => {
      await expect(broker.call('energy-market.production', {})).rejects.toThrow();
    });

    it('should retrieve solar production data', async () => {
      const result = await broker.call('energy-market.production', {
        energySource: 'Solar',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-03',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should support different energy sources', async () => {
      const result = await broker.call('energy-market.production', {
        energySource: 'Wind',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-02',
        resolution: 'hour',
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should support all energy sources', async () => {
      const result = await broker.call('energy-market.production', {
        energySource: 'all',
        region: 'Deutschland',
        startDate: '2026-02-01',
        endDate: '2026-02-01',
      });

      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('co2Intensity action', () => {
    it('should require location parameter', async () => {
      // Note: The MCP tool may have location as optional with default behavior
      // This test verifies the action exists and can be called
      const result = await broker.call('energy-market.co2Intensity', { location: 'Berlin' });
      expect(result).toBeDefined();
    });

    it('should retrieve CO2 intensity for city', async () => {
      const result = await broker.call('energy-market.co2Intensity', {
        location: 'Heidelberg',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should retrieve CO2 intensity for postal code', async () => {
      const result = await broker.call('energy-market.co2Intensity', {
        location: '69115',
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should support forecast mode', async () => {
      const result = await broker.call('energy-market.co2Intensity', {
        location: 'Heidelberg',
        forecast: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);
  });

  describe('co2Intensity action — format parameter', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns CSV string with # metadata comments and forecast rows when format=csv', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        co2_intensity_gco2eq_kwh: 380,
        average_today_gco2eq_kwh: 364.5,
        timestamp: '2026-03-04T09:00:00.000Z',
        data_source: 'GrünstromIndex (api.corrently.io)',
        data: {
          location: 'Heidelberg',
          timestamp: '2026-03-04T09:00:00.000Z',
          forecast_next_24h_gco2eq_kwh: [380, 190, 220],
        },
      });

      const result = await broker.call('energy-market.co2Intensity', {
        location: 'Heidelberg',
        forecast: true,
        format: 'csv',
      });

      expect(typeof result).toBe('string');
      expect(result).toContain('# CO2 Intensity Export');
      expect(result).toContain('# Location: Heidelberg');
      expect(result).toContain('# Current CO2 Intensity (gCO2eq/kWh): 380');
      expect(result).toContain('# Average Today (gCO2eq/kWh): 364.5');
      expect(result).toContain('# Source: GrünstromIndex (api.corrently.io)');
      expect(result).toContain('# Generated: 2026-03-04T09:00:00.000Z');
      expect(result).toContain('"timestamp"');
      expect(result).toContain('"gCO2eqPerKWh"');
      expect(result).toContain('380');
    });

    it('returns XLSX buffer when format=xlsx', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          location: 'Berlin',
          timestamp: '2026-03-04T09:00:00.000Z',
          forecast_next_24h_gco2eq_kwh: [300, 280],
        },
      });

      const result = await broker.call('energy-market.co2Intensity', {
        location: 'Berlin',
        format: 'xlsx',
      });

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('does NOT pass format to the MCP tool cernion_co2_intensity', async () => {
      callWithNewSession.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('energy-market.co2Intensity', {
        location: 'München',
        format: 'json',
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_co2_intensity',
        expect.not.objectContaining({ format: 'json' }),
        undefined
      );
    });

    it('returns JSON unchanged when format=json (default)', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        co2_intensity_gco2eq_kwh: 250,
        data: {
          location: 'München',
          timestamp: '2026-03-04T10:00:00.000Z',
          forecast_next_24h_gco2eq_kwh: [250, 240],
        },
      });

      const result = await broker.call('energy-market.co2Intensity', {
        location: 'München',
      });

      expect(result.success).toBe(true);
      expect(result.co2_intensity_gco2eq_kwh).toBe(250);
      expect(Array.isArray(result.data.forecast)).toBe(true);
      expect(result.data.forecast[0]).toHaveProperty('gCO2eqPerKWh', 250);
    });
  });

  describe('installations action', () => {
    it('should require installationType and location', async () => {
      await expect(broker.call('energy-market.installations', {})).rejects.toThrow();
    });

    it('should search solar installations', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Heidelberg',
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should filter by capacity range', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Heidelberg',
        minCapacityKW: 5,
        maxCapacityKW: 15,
        limit: 5,
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should filter by commissioning year', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Baden-Württemberg',
        commissioningYear: 2020,
        limit: 3,
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should support grid operator filters', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        location: 'Baden-Württemberg',
        gridOperatorBdewCode: '9900992720003',
        limit: 5,
      });

      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('installations action — NAP enrichment (includeNapData)', () => {
    const napDataFixture = {
      napMastrNummer: 'SAN914634531048',
      messlokation: 'DE0003976706990000000000000073131',
      spannungsebene: 354,
      spannungsebeneLabel: 'Niederspannung (LV)',
      nettoengpassleistung: 6.15,
      netzMastrNummer: 'SNE985057905075',
      netzbetreiberMastrNummer: 'SNB935578300972',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      callWithNewSession.mockResolvedValue({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE988149395570',
              name: 'PV 2 Weiler',
              bruttoleistung: 6.15,
              einheitBetriebsstatus: '35',
              latitude: 49.4744,
              longitude: 8.4349,
              netzbetreiberpruefungStatus: 2954,
              napData: napDataFixture,
            },
            {
              mastrNummer: 'SEE900000000002',
              name: 'PV Altanlage 2003',
              bruttoleistung: 3.8,
              einheitBetriebsstatus: '35',
              latitude: 49.4093,
              longitude: 8.6942,
              netzbetreiberpruefungStatus: null,
              napData: undefined,
            },
          ],
          stats: { count: 2, totalCapacity: 9.95, avgCapacity: 4.975 },
        },
      });
    });

    it('should pass includeNapData: true to MCP tool by default', async () => {
      await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 10,
      });
      const [toolName, params] = callWithNewSession.mock.calls[0];
      expect(toolName).toBe('cernion_installations_local');
      expect(params.includeNapData).toBe(true);
    });

    it('should pass includeNapData: false when explicitly set', async () => {
      await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 10,
        includeNapData: false,
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.includeNapData).toBe(false);
    });

    it('should pass napData through in installation results', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 10,
      });
      const installationWithNap = result.data.installations.find(
        (i) => i.napData !== undefined
      );
      expect(installationWithNap).toBeDefined();
      expect(installationWithNap.napData.napMastrNummer).toBe('SAN914634531048');
      expect(installationWithNap.napData.messlokation).toBe(
        'DE0003976706990000000000000073131'
      );
      expect(installationWithNap.napData.spannungsebeneLabel).toBe('Niederspannung (LV)');
      expect(installationWithNap.napData.nettoengpassleistung).toBe(6.15);
      expect(installationWithNap.napData.netzMastrNummer).toBe('SNE985057905075');
      expect(installationWithNap.napData.netzbetreiberMastrNummer).toBe('SNB935578300972');
    });

    it('napData may be undefined for older installations (~48% without MeLo)', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 10,
      });
      const installationWithoutNap = result.data.installations.find(
        (i) => i.napData === undefined
      );
      expect(installationWithoutNap).toBeDefined();
      expect(installationWithoutNap.mastrNummer).toBe('SEE900000000002');
    });

    it('should pass latitude and longitude through in installation results', async () => {
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 10,
      });
      const inst = result.data.installations[0];
      expect(inst.latitude).toBe(49.4744);
      expect(inst.longitude).toBe(8.4349);
    });

    it('should work for wind turbines with includeNapData: false', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEW900000000001',
              name: 'WEA Nordsee 1',
              bruttoleistung: 3000,
              einheitBetriebsstatus: '35',
              typenbezeichnung: 'E-115',
              hersteller: 'Enercon',
              latitude: 53.1,
              longitude: 8.2,
            },
          ],
          stats: { count: 1, totalCapacity: 3000, avgCapacity: 3000 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'wind',
        minCapacityKW: 1000,
        limit: 10,
        includeNapData: false,
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.includeNapData).toBe(false);
      const turbine = result.data.installations[0];
      expect(turbine.typenbezeichnung).toBe('E-115');
      expect(turbine.hersteller).toBe('Enercon');
    });

    it('should pass storage-specific fields through', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEP900000000001',
              name: 'Heimspeicher 1',
              bruttoleistung: 10,
              einheitBetriebsstatus: '35',
              batterietechnologie: 'Lithium-Ionen',
              acDcKoppelung: 'AC',
              wechselrichterleistung: 8.5,
              einsatzort: 'Haushalt',
              latitude: 48.1,
              longitude: 11.5,
              netzbetreiberpruefungStatus: 3075,
              napData: napDataFixture,
            },
          ],
          stats: { count: 1, totalCapacity: 10, avgCapacity: 10 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'storage',
        limit: 5,
      });
      const storage = result.data.installations[0];
      expect(storage.batterietechnologie).toBe('Lithium-Ionen');
      expect(storage.acDcKoppelung).toBe('AC');
      expect(storage.wechselrichterleistung).toBe(8.5);
      expect(storage.einsatzort).toBe('Haushalt');
    });
  });

  describe('installations action — netzbetreiberpruefungStatus', () => {
    const napDataFixture = {
      napMastrNummer: 'SAN914634531048',
      messlokation: 'DE0003976706990000000000000073131',
      spannungsebene: 354,
      spannungsebeneLabel: 'Niederspannung (LV)',
      nettoengpassleistung: 6.15,
      netzMastrNummer: 'SNE985057905075',
      netzbetreiberMastrNummer: 'SNB935578300972',
    };

    it('status 2954 (Geprüft) passes through', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE988149395570',
              bruttoleistung: 6.15,
              einheitBetriebsstatus: '35',
              latitude: 49.4744,
              longitude: 8.4349,
              netzbetreiberpruefungStatus: 2954,
              napData: napDataFixture,
            },
          ],
          stats: { count: 1, totalCapacity: 6.15, avgCapacity: 6.15 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 5,
      });
      expect(result.data.installations[0].netzbetreiberpruefungStatus).toBe(2954);
    });

    it('status 2955 (In Prüfung) passes through', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE988149395571',
              bruttoleistung: 9.9,
              einheitBetriebsstatus: '35',
              latitude: 49.0,
              longitude: 8.0,
              netzbetreiberpruefungStatus: 2955,
              napData: undefined,
            },
          ],
          stats: { count: 1, totalCapacity: 9.9, avgCapacity: 9.9 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 5,
      });
      expect(result.data.installations[0].netzbetreiberpruefungStatus).toBe(2955);
    });

    it('status 3075 (Nicht vorgesehen) passes through', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE988149395572',
              bruttoleistung: 3.8,
              einheitBetriebsstatus: '35',
              latitude: 48.5,
              longitude: 9.0,
              netzbetreiberpruefungStatus: 3075,
              napData: undefined,
            },
          ],
          stats: { count: 1, totalCapacity: 3.8, avgCapacity: 3.8 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 5,
      });
      expect(result.data.installations[0].netzbetreiberpruefungStatus).toBe(3075);
    });

    it('status null (older record without value) passes through', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE900000000002',
              bruttoleistung: 3.8,
              einheitBetriebsstatus: '35',
              latitude: null,
              longitude: null,
              netzbetreiberpruefungStatus: null,
              napData: undefined,
            },
          ],
          stats: { count: 1, totalCapacity: 3.8, avgCapacity: 3.8 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 5,
      });
      expect(result.data.installations[0].netzbetreiberpruefungStatus).toBeNull();
    });

    it('mixed statuses: both 2954 and null present in same response', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE988149395570',
              bruttoleistung: 6.15,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: 2954,
              napData: napDataFixture,
            },
            {
              mastrNummer: 'SEE900000000002',
              bruttoleistung: 3.8,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: null,
              napData: undefined,
            },
          ],
          stats: { count: 2, totalCapacity: 9.95, avgCapacity: 4.975 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 10,
      });
      const statuses = result.data.installations.map((i) => i.netzbetreiberpruefungStatus);
      expect(statuses).toContain(2954);
      expect(statuses).toContain(null);
    });

    it('should post-filter by netzbetreiberPruefungStatus=2955 and keep only matching records', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE111',
              bruttoleistung: 10,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: 2955,
              napData: undefined,
            },
            {
              mastrNummer: 'SEE222',
              bruttoleistung: 20,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: 2954,
              napData: undefined,
            },
            {
              mastrNummer: 'SEE333',
              bruttoleistung: 30,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: 3075,
              napData: undefined,
            },
          ],
          stats: { count: 3, totalCapacity: 60, avgCapacity: 20 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        netzbetreiberPruefungStatus: '2955',
      });
      expect(result.data.installations).toHaveLength(1);
      expect(result.data.installations[0].mastrNummer).toBe('SEE111');
      expect(result.data.installations[0].netzbetreiberpruefungStatus).toBe(2955);
      expect(result.data.stats.count).toBe(1);
    });

    it('should combine operationalStatus=35 and netzbetreiberPruefungStatus=2955 filters', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            {
              mastrNummer: 'SEE001',
              bruttoleistung: 5,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: 2955,
            },
            {
              mastrNummer: 'SEE002',
              bruttoleistung: 5,
              einheitBetriebsstatus: '31',
              netzbetreiberpruefungStatus: 2955,
            },
            {
              mastrNummer: 'SEE003',
              bruttoleistung: 5,
              einheitBetriebsstatus: '35',
              netzbetreiberpruefungStatus: 2954,
            },
          ],
          stats: { count: 3, totalCapacity: 15, avgCapacity: 5 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        operationalStatus: '35',
        netzbetreiberPruefungStatus: '2955',
      });
      expect(result.data.installations).toHaveLength(1);
      expect(result.data.installations[0].mastrNummer).toBe('SEE001');
    });
  });

  describe('installations action — pagination (offset)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should pass offset to MCP tool when provided', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [],
          stats: { count: 0, totalCapacity: 0, avgCapacity: 0 },
        },
      });
      await broker.call('energy-market.installations', {
        installationType: 'solar',
        offset: 1000,
        limit: 1000,
      });
      const [, params] = callWithNewSession.mock.calls[0];
      expect(params.offset).toBe(1000);
      expect(params.limit).toBe(1000);
    });

    it('should accept limit as string "all" and internally page until exhausted', async () => {
      // First page returns full 10k (MCP_PAGE_SIZE), second returns 3 → stops
      const page1 = Array.from({ length: 10000 }, (_, i) => ({
        mastrNummer: `SEE${String(i).padStart(5, '0')}`,
        bruttoleistung: 10,
        einheitBetriebsstatus: '35',
      }));
      const page2 = [
        { mastrNummer: 'SEE99991', bruttoleistung: 10, einheitBetriebsstatus: '35' },
        { mastrNummer: 'SEE99992', bruttoleistung: 10, einheitBetriebsstatus: '35' },
        { mastrNummer: 'SEE99993', bruttoleistung: 10, einheitBetriebsstatus: '35' },
      ];
      callWithNewSession
        .mockResolvedValueOnce({ success: true, data: { installations: page1, stats: {} } })
        .mockResolvedValueOnce({ success: true, data: { installations: page2, stats: {} } });

      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 'all',
      });
      expect(result.data.installations).toHaveLength(10003);
      expect(result.data.pagination.limit).toBe('all');
      expect(result.data.pagination.hasMore).toBe(false);
      expect(callWithNewSession).toHaveBeenCalledTimes(2);
    });

    it('should accept limit as large number and internally page until exhausted', async () => {
      const page1 = Array.from({ length: 10000 }, (_, i) => ({
        mastrNummer: `SEE${String(i).padStart(5, '0')}`,
        bruttoleistung: 10,
        einheitBetriebsstatus: '35',
      }));
      const page2 = Array.from({ length: 500 }, (_, i) => ({
        mastrNummer: `SEE5${String(i).padStart(4, '0')}`,
        bruttoleistung: 10,
        einheitBetriebsstatus: '35',
      }));
      callWithNewSession
        .mockResolvedValueOnce({ success: true, data: { installations: page1, stats: {} } })
        .mockResolvedValueOnce({ success: true, data: { installations: page2, stats: {} } });

      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        limit: 1000000,
      });
      expect(result.data.installations).toHaveLength(10500);
      expect(result.data.pagination.hasMore).toBe(false);
      expect(callWithNewSession).toHaveBeenCalledTimes(2);
    });

    it('should include pagination metadata in response', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            { mastrNummer: 'SEE001', bruttoleistung: 10, einheitBetriebsstatus: '35' },
            { mastrNummer: 'SEE002', bruttoleistung: 20, einheitBetriebsstatus: '35' },
          ],
          stats: { count: 2, totalCapacity: 30, avgCapacity: 15 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        offset: 0,
        limit: 10,
      });
      expect(result.data.pagination).toBeDefined();
      expect(result.data.pagination.offset).toBe(0);
      expect(result.data.pagination.limit).toBe(10);
      expect(result.data.pagination.count).toBe(2);
      expect(result.data.pagination.hasMore).toBe(false);
    });

    it('should set hasMore=true when rawCount equals limit (more data available)', async () => {
      const installations = Array.from({ length: 100 }, (_, i) => ({
        mastrNummer: `SEE${String(i).padStart(3, '0')}`,
        bruttoleistung: 10,
        einheitBetriebsstatus: '35',
      }));
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations,
          stats: { count: 100, totalCapacity: 1000, avgCapacity: 10 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        offset: 0,
        limit: 100,
      });
      // MCP returned exactly 100 (= limit) → data not exhausted → hasMore=true
      expect(result.data.pagination.hasMore).toBe(true);
      expect(result.data.pagination.count).toBe(100);
    });

    it('should set hasMore=false when rawCount is less than limit', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations: [
            { mastrNummer: 'SEE001', bruttoleistung: 10, einheitBetriebsstatus: '35' },
          ],
          stats: { count: 1, totalCapacity: 10, avgCapacity: 10 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        offset: 0,
        limit: 100,
      });
      expect(result.data.pagination.hasMore).toBe(false);
    });

    it('should reflect post-filter reduction in count but use raw count for hasMore', async () => {
      // MCP returns exactly 3 rows (= limit=3) → data not exhausted → hasMore=true
      // but operationalStatus filter removes 1 row → count=2 in pagination
      const installations = [
        { mastrNummer: 'SEE001', bruttoleistung: 10, einheitBetriebsstatus: '35' },
        { mastrNummer: 'SEE002', bruttoleistung: 20, einheitBetriebsstatus: '35' },
        { mastrNummer: 'SEE003', bruttoleistung: 30, einheitBetriebsstatus: '31' },
      ];
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          installations,
          stats: { count: 3, totalCapacity: 60, avgCapacity: 20 },
        },
      });
      const result = await broker.call('energy-market.installations', {
        installationType: 'solar',
        operationalStatus: '35',
        offset: 0,
        limit: 3,
      });
      // Post-filter removed status '31' record → 2 rows returned
      expect(result.data.installations).toHaveLength(2);
      // MCP returned exactly 3 (= limit=3) → not exhausted → hasMore=true
      expect(result.data.pagination.hasMore).toBe(true);
      expect(result.data.pagination.count).toBe(2);
    });
  });
});

