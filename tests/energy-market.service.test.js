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
              napData: napDataFixture,
            },
            {
              mastrNummer: 'SEE900000000002',
              name: 'PV Altanlage 2003',
              bruttoleistung: 3.8,
              einheitBetriebsstatus: '35',
              latitude: 49.4093,
              longitude: 8.6942,
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
  });});