/**
 * EIC Codes Service Integration Tests
 *
 * Live tests for EIC Code Management microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const EICCodesService = require('../services/eic-codes.service');

describe('EIC Codes Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      switch (toolName) {
        case 'cernion_eic_search':
          return {
            success: true,
            data: [{ code: params.code || '21X', name: params.name || 'Mock Operator' }],
          };
        case 'cernion_eic_validate':
          return {
            success: true,
            data: { valid: true, code: params.code },
          };
        case 'cernion_eic_gas_operators':
          return {
            success: true,
            data: [{ code: '21X000000001262B', name: 'RWE Gas Storage West' }],
          };
        case 'cernion_eic_gas_facilities':
          return {
            success: true,
            data: [{ code: '21X000000001262B', name: 'Mock Facility' }],
          };
        case 'cernion_eic_statistics':
          return {
            success: true,
            data: {
              statistics: {
                total: 80000,
                byType: [{ type: 'A', count: 1000 }],
                bySector: [{ sector: 'gas', count: 1000 }],
                byCountry: [{ country: 'DE', count: 1000 }],
              },
            },
          };
        default:
          return { success: true, data: {} };
      }
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(EICCodesService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('search action', () => {
    it('should require at least code or name parameter', async () => {
      const result = await broker.call('eic-codes.search', {});
      expect(result.success).toBeDefined();
    });

    it('should search by EIC code', async () => {
      const result = await broker.call('eic-codes.search', {
        code: '21X',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should search by company name', async () => {
      const result = await broker.call('eic-codes.search', {
        name: 'Netze',
        country: 'DE',
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should filter by sector', async () => {
      const result = await broker.call('eic-codes.search', {
        name: 'RWE',
        sector: 'gas',
        limit: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should respect limit parameter', async () => {
      const result = await broker.call('eic-codes.search', {
        name: 'Stadt',
        limit: 2,
      });

      expect(result.success).toBe(true);
    }, 30000);
  });

  describe('validate action', () => {
    it('should require code parameter', async () => {
      await expect(broker.call('eic-codes.validate', {})).rejects.toThrow();
    });

    it('should validate valid EIC code', async () => {
      const result = await broker.call('eic-codes.validate', {
        code: '21X000000001254A',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should reject invalid EIC code length', async () => {
      await expect(
        broker.call('eic-codes.validate', {
          code: 'INVALID',
        })
      ).rejects.toThrow();
    });

    it('should reject code with wrong length', async () => {
      await expect(
        broker.call('eic-codes.validate', {
          code: '21X0000000012',
        })
      ).rejects.toThrow();
    });
  });

  describe('search format parameter', () => {
    it('should accept format=json and return JSON result', async () => {
      const result = await broker.call('eic-codes.search', {
        name: 'Netze',
        format: 'json',
      });
      expect(result.success).toBe(true);
    });

    it('should return CSV string for format=csv', async () => {
      const result = await broker.call('eic-codes.search', { name: 'Netze', format: 'csv' });
      expect(typeof result).toBe('string');
    });

    it('should return Buffer for format=xlsx', async () => {
      const result = await broker.call('eic-codes.search', { name: 'Netze', format: 'xlsx' });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should return Buffer for format=xls', async () => {
      const result = await broker.call('eic-codes.search', { name: 'Netze', format: 'xls' });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should reject invalid format value', async () => {
      await expect(
        broker.call('eic-codes.search', { name: 'Netze', format: 'pdf' })
      ).rejects.toThrow();
    });
  });

  describe('gasOperators action', () => {
    it('should list German gas operators', async () => {
      const result = await broker.call('eic-codes.gasOperators', {
        country: 'DE',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should use default country DE', async () => {
      const result = await broker.call('eic-codes.gasOperators', {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should include metadata when requested', async () => {
      const result = await broker.call('eic-codes.gasOperators', {
        includeMetadata: true,
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should return Buffer for format=xlsx', async () => {
      const result = await broker.call('eic-codes.gasOperators', { format: 'xlsx' });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should return CSV string for format=csv', async () => {
      const result = await broker.call('eic-codes.gasOperators', { format: 'csv' });
      expect(typeof result).toBe('string');
    });
  });

  describe('gasFacilities action', () => {
    it('should list all German gas facilities', async () => {
      const result = await broker.call('eic-codes.gasFacilities', {
        country: 'DE',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    }, 30000);

    it('should filter by operator code', async () => {
      const result = await broker.call('eic-codes.gasFacilities', {
        operatorCode: '21X000000001262B',
      });

      expect(result.success).toBe(true);
    }, 30000);

    it('should return Buffer for format=xlsx', async () => {
      const result = await broker.call('eic-codes.gasFacilities', { format: 'xlsx' });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should return CSV string for format=csv', async () => {
      const result = await broker.call('eic-codes.gasFacilities', { format: 'csv' });
      expect(typeof result).toBe('string');
    });
  });

  describe('statistics action', () => {
    it('should return database statistics', async () => {
      const result = await broker.call('eic-codes.statistics', {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.statistics).toBeDefined();
      expect(result.data.statistics.total).toBeGreaterThan(70000);
    }, 30000);

    it('should include breakdown by type', async () => {
      const result = await broker.call('eic-codes.statistics', {});

      expect(result.success).toBe(true);
      expect(result.data.statistics.byType).toBeDefined();
      expect(Array.isArray(result.data.statistics.byType)).toBe(true);
    }, 30000);

    it('should include breakdown by sector', async () => {
      const result = await broker.call('eic-codes.statistics', {});

      expect(result.success).toBe(true);
      expect(result.data.statistics.bySector).toBeDefined();
      expect(Array.isArray(result.data.statistics.bySector)).toBe(true);
    }, 30000);

    it('should include breakdown by country', async () => {
      const result = await broker.call('eic-codes.statistics', {});

      expect(result.success).toBe(true);
      expect(result.data.statistics.byCountry).toBeDefined();
      expect(Array.isArray(result.data.statistics.byCountry)).toBe(true);
    }, 30000);
  });
});
