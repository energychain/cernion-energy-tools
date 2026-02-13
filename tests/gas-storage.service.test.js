const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const GasStorageService = require('../services/gas-storage.service');

describe('Gas Storage Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      switch (toolName) {
        case 'agsi_country_storage':
          return {
            success: true,
            data: {
              country: params.country,
              storage: {
                gasInStorage: 100,
                fillPercentage: 50,
              },
            },
          };
        case 'agsi_operator_storage':
          return {
            success: true,
            data: {
              operatorName: 'RWE Gas Storage West',
              facilities: params.includeFacilities ? [] : undefined,
            },
          };
        case 'agsi_historical_data':
          return {
            success: true,
            data: {
              timeSeries: [],
              aggregation: params.aggregation || 'daily',
            },
          };
        case 'agsi_eu_statistics':
          return {
            success: true,
            data: {
              totalCapacity: 1000,
              fillPercentage: 45,
              countryBreakdown: params.includeCountryBreakdown ? [] : undefined,
            },
          };
        case 'agsi_compare_countries':
          return {
            success: true,
            data: {
              metric: params.metric,
              comparison: params.countries.map((country) => ({
                country,
                value: 1,
              })),
            },
          };
        case 'agsi_storage_trend':
          return {
            success: true,
            data: {
              trend: 'stable',
              period: params.period,
            },
          };
        case 'agsi_supply_security_check':
          return {
            success: true,
            data: {
              status: 'ADEQUATE',
              fillPercentage: 55,
              mandateCompliant: true,
            },
          };
        default:
          return { success: true, data: {} };
      }
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(GasStorageService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('countryStorage action', () => {
    it('should require country parameter', async () => {
      await expect(broker.call('gas-storage.countryStorage', {})).rejects.toThrow();
    });

    it('should validate country code length', async () => {
      await expect(broker.call('gas-storage.countryStorage', { country: 'DEU' })).rejects.toThrow();
    });

    it('should retrieve Germany gas storage data', async () => {
      const result = await broker.call('gas-storage.countryStorage', {
        country: 'DE',
        includeOperators: false,
        includeFacilities: false,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      // Gas storage data should have country and storage info
      expect(result.data).toHaveProperty('country');
      expect(result.data).toHaveProperty('storage');
      expect(result.data.storage).toHaveProperty('gasInStorage');
      expect(result.data.storage).toHaveProperty('fillPercentage');
    }, 30000);

    it('should support includeOperators option', async () => {
      const result = await broker.call('gas-storage.countryStorage', {
        country: 'DE',
        includeOperators: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }, 30000);

    it('should work for multiple countries', async () => {
      const countries = ['DE', 'FR', 'IT'];

      for (const country of countries) {
        const result = await broker.call('gas-storage.countryStorage', {
          country,
          includeOperators: false,
        });

        expect(result.success).toBe(true);
        expect(result.data.country).toBe(country);
      }
    }, 60000);
  });

  describe('operatorStorage action', () => {
    it('should require operatorCode parameter', async () => {
      await expect(broker.call('gas-storage.operatorStorage', {})).rejects.toThrow();
    });

    it('should retrieve RWE operator data', async () => {
      const result = await broker.call('gas-storage.operatorStorage', {
        operatorCode: '21X000000001262B',
        includeFacilities: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('operatorName');
    }, 30000);

    it('should support date parameter', async () => {
      const result = await broker.call('gas-storage.operatorStorage', {
        operatorCode: '21X000000001262B',
        date: '2024-01-15',
        includeFacilities: false,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('historicalData action', () => {
    it('should require all mandatory parameters', async () => {
      await expect(broker.call('gas-storage.historicalData', { country: 'DE' })).rejects.toThrow();
    });

    it('should retrieve daily historical data', async () => {
      const result = await broker.call('gas-storage.historicalData', {
        country: 'DE',
        from: '2024-01-01',
        to: '2024-01-31',
        aggregation: 'daily',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('timeSeries');
    }, 30000);

    it('should support weekly aggregation', async () => {
      const result = await broker.call('gas-storage.historicalData', {
        country: 'DE',
        from: '2024-01-01',
        to: '2024-03-31',
        aggregation: 'weekly',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }, 30000);

    it('should support monthly aggregation', async () => {
      const result = await broker.call('gas-storage.historicalData', {
        country: 'DE',
        from: '2024-01-01',
        to: '2024-12-31',
        aggregation: 'monthly',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('euStatistics action', () => {
    it('should retrieve EU-wide statistics', async () => {
      const result = await broker.call('gas-storage.euStatistics', {
        includeCountryBreakdown: false,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('totalCapacity');
      expect(result.data).toHaveProperty('fillPercentage');
    }, 30000);

    it('should support country breakdown', async () => {
      const result = await broker.call('gas-storage.euStatistics', {
        includeCountryBreakdown: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('compareCountries action', () => {
    it('should require countries and metric parameters', async () => {
      await expect(broker.call('gas-storage.compareCountries', {})).rejects.toThrow();
    });

    it('should require at least 2 countries', async () => {
      await expect(
        broker.call('gas-storage.compareCountries', {
          countries: ['DE'],
          metric: 'fill_percentage',
        })
      ).rejects.toThrow();
    });

    it('should compare fill percentages', async () => {
      const result = await broker.call('gas-storage.compareCountries', {
        countries: ['DE', 'FR', 'IT'],
        metric: 'fill_percentage',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('comparison');
      expect(result.data.comparison).toHaveLength(3);
    }, 30000);

    it('should support different metrics', async () => {
      const metrics = ['capacity', 'withdrawal_rate', 'coverage_days'];

      for (const metric of metrics) {
        const result = await broker.call('gas-storage.compareCountries', {
          countries: ['DE', 'FR'],
          metric,
        });

        expect(result.success).toBe(true);
        expect(result.data.metric).toBe(metric);
      }
    }, 60000);
  });

  describe('storageTrend action', () => {
    it('should require country and period parameters', async () => {
      await expect(broker.call('gas-storage.storageTrend', {})).rejects.toThrow();
    });

    it('should analyze weekly trends', async () => {
      const result = await broker.call('gas-storage.storageTrend', {
        country: 'DE',
        period: 'week',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('trend');
    }, 30000);

    it('should support different time periods', async () => {
      const periods = ['month', 'quarter', 'year'];

      for (const period of periods) {
        const result = await broker.call('gas-storage.storageTrend', {
          country: 'DE',
          period,
        });

        expect(result.success).toBe(true);
        expect(result.data.period).toBe(period);
      }
    }, 60000);

    it('should support endDate parameter', async () => {
      const result = await broker.call('gas-storage.storageTrend', {
        country: 'DE',
        period: 'month',
        endDate: '2024-12-31',
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('supplySecurityCheck action', () => {
    it('should require country parameter', async () => {
      await expect(broker.call('gas-storage.supplySecurityCheck', {})).rejects.toThrow();
    });

    it('should assess supply security for Germany', async () => {
      const result = await broker.call('gas-storage.supplySecurityCheck', {
        country: 'DE',
        winterMandateCheck: true,
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('status');
      expect(result.data).toHaveProperty('fillPercentage');
      expect(['SECURE', 'ADEQUATE', 'WARNING', 'CRITICAL']).toContain(result.data.status);
    }, 30000);

    it('should check winter mandate compliance', async () => {
      const result = await broker.call('gas-storage.supplySecurityCheck', {
        country: 'DE',
        winterMandateCheck: true,
      });

      expect(result).toBeDefined();
      expect(result.data).toHaveProperty('mandateCompliant');
      expect(typeof result.data.mandateCompliant).toBe('boolean');
    }, 30000);
  });
});
