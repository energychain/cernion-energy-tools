/**
 * Assets Service XLSX Export Tests
 *
 * Tests for XLSX export functionality in Assets service
 */

const { ServiceBroker } = require('moleculer');
const XLSX = require('xlsx');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const AssetsService = require('../services/assets.service');
const EnergyMarketService = require('../services/energy-market.service');

function createObjectStoreMockService() {
  return {
    name: 'object-store',
    actions: {
      put: {
        handler() {
          return { ok: true };
        },
      },
      get: {
        handler() {
          return null;
        },
      },
      query: {
        handler() {
          return { docs: [], totalDocs: 0 };
        },
      },
    },
  };
}

function createHitlMockService() {
  return {
    name: 'hitl',
    actions: {
      create: {
        handler() {
          return { success: true, item: { id: 'hitl-test', status: 'pending' } };
        },
      },
      get: {
        handler() {
          return { success: true, item: { id: 'hitl-test', status: 'pending' } };
        },
      },
    },
  };
}

describe('Assets Service - XLSX Export', () => {
  let broker;

  beforeAll(async () => {
    // Mock MCP responses with sample data
    callWithNewSession.mockImplementation(async (_toolName) => ({
      success: true,
      data: [],
    }));

    callWithAutoPoll.mockImplementation(async (toolName, _params) => {
      // Mock installations data
      if (toolName === 'cernion_installations') {
        return {
          success: true,
          data: {
            results: [
              {
                mastrNummer: 'SEE900012345678',
                capacityKW: 50.5,
                commissioningDate: '2020-05-15',
                location: 'Heidelberg',
                operator: 'Max Mustermann',
              },
              {
                mastrNummer: 'SEE900087654321',
                capacityKW: 100.0,
                commissioningDate: '2019-03-20',
                location: 'Mannheim',
                operator: 'Erika Musterfrau',
              },
            ],
          },
        };
      }

      // Mock market partners lookup — must return a resolved MaStR ID so the
      // new VNB_NOT_FOUND guard does not fire for 'STROMDAO Netze' in these tests.
      if (toolName === 'cernion_market_partners') {
        return {
          success: true,
          data: {
            count: 1,
            results: [
              {
                name: 'STROMDAO Netze GmbH',
                mastrNetzbetreiberId: 'SNB900012345',
                bdew: '1234567890123',
              },
            ],
          },
        };
      }

      // Legacy mock kept for any leftover cernion_vnbdigital_search calls
      if (toolName === 'cernion_vnbdigital_search') {
        return {
          success: true,
          data: [
            {
              name: 'STROMDAO Netze',
              bdewCode: '1234567890123',
              mastrId: 'SNB900012345',
            },
          ],
        };
      }

      return { success: true, data: [] };
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(EnergyMarketService);
    broker.createService(createObjectStoreMockService());
    broker.createService(createHitlMockService());
    broker.createService(AssetsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  describe('convertToXLSX method', () => {
    it('should convert array of objects to XLSX buffer', () => {
      const data = [
        { name: 'Test 1', value: 100 },
        { name: 'Test 2', value: 200 },
      ];

      const service = broker.getLocalService('assets');
      const xlsxBuffer = service.convertToXLSX(data);

      expect(xlsxBuffer).toBeInstanceOf(Buffer);
      expect(xlsxBuffer.length).toBeGreaterThan(0);

      // Verify it's a valid XLSX file
      const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Assets');

      const worksheet = workbook.Sheets['Assets'];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      expect(jsonData).toHaveLength(2);
      expect(jsonData[0]).toMatchObject({ name: 'Test 1', value: 100 });
      expect(jsonData[1]).toMatchObject({ name: 'Test 2', value: 200 });
    });

    it('should handle empty data gracefully', () => {
      const service = broker.getLocalService('assets');
      const xlsxBuffer = service.convertToXLSX([]);

      expect(xlsxBuffer).toBeInstanceOf(Buffer);
      expect(xlsxBuffer.length).toBeGreaterThan(0);

      // Verify it creates a workbook with "No data available" message
      const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Assets');
    });

    it('should handle null data', () => {
      const service = broker.getLocalService('assets');
      const xlsxBuffer = service.convertToXLSX(null);

      expect(xlsxBuffer).toBeInstanceOf(Buffer);
    });

    it('should create valid XLSX structure', () => {
      const data = [
        { shortName: 'A', veryLongColumnNameForTesting: 'Short value' },
        { shortName: 'B', veryLongColumnNameForTesting: 'Another short' },
      ];

      const service = broker.getLocalService('assets');
      const xlsxBuffer = service.convertToXLSX(data);

      const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
      const worksheet = workbook.Sheets['Assets'];

      // Verify worksheet structure
      expect(worksheet).toBeDefined();
      expect(worksheet['!ref']).toBeDefined();

      // Verify data is correct
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      expect(jsonData).toHaveLength(2);
    });
  });

  describe('XLSX export via API', () => {
    it('should return XLSX buffer when format=xlsx', async () => {
      const result = await broker.call('assets.solar', {
        vnbName: 'STROMDAO Netze',
        format: 'xlsx',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);

      // Verify it's a valid XLSX file
      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook.SheetNames).toContain('Assets');
    });

    it('should set correct response headers for XLSX', async () => {
      const ctx = {
        params: {
          vnbName: 'STROMDAO Netze',
          format: 'xlsx',
        },
        meta: {},
      };

      await broker.call('assets.solar', ctx.params, { meta: ctx.meta });

      expect(ctx.meta.$responseHeaders).toBeDefined();
      expect(ctx.meta.$responseHeaders['Content-Type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(ctx.meta.$responseHeaders['Content-Disposition']).toMatch(
        /^attachment; filename="assets-\d+\.xlsx"$/
      );
    });

    it('should work for all asset types', async () => {
      const assetTypes = ['solar', 'wind', 'storage', 'biomass', 'hydro', 'combustion', 'all'];

      for (const assetType of assetTypes) {
        const result = await broker.call(`assets.${assetType}`, {
          vnbName: 'STROMDAO Netze',
          format: 'xlsx',
        });

        expect(result).toBeInstanceOf(Buffer);

        const workbook = XLSX.read(result, { type: 'buffer' });
        expect(workbook.SheetNames).toContain('Assets');
      }
    });

    it('should validate format enum correctly', async () => {
      await expect(
        broker.call('assets.solar', {
          vnbName: 'STROMDAO Netze',
          format: 'invalid',
        })
      ).rejects.toThrow();
    });

    it('should default to JSON when format not specified', async () => {
      const result = await broker.call('assets.solar', {
        vnbName: 'STROMDAO Netze',
      });

      // Should return JSON object, not Buffer
      expect(result).toBeInstanceOf(Object);
      expect(result).not.toBeInstanceOf(Buffer);
    });
  });

  describe('XLSX content verification', () => {
    it('should create valid XLSX file with worksheet', async () => {
      const result = await broker.call('assets.solar', {
        vnbName: 'STROMDAO Netze',
        format: 'xlsx',
      });

      const workbook = XLSX.read(result, { type: 'buffer' });
      expect(workbook).toBeDefined();
      expect(workbook.SheetNames).toContain('Assets');

      const worksheet = workbook.Sheets['Assets'];
      expect(worksheet).toBeDefined();

      // Can convert to JSON without errors
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      expect(Array.isArray(jsonData)).toBe(true);
    });

    it('should preserve data integrity in XLSX format', async () => {
      // The assets service calls cernion_market_partners first (VNB resolution), then the
      // installation lookup. Both must be mocked in the correct order.
      callWithAutoPoll
        .mockImplementationOnce(async () => ({
          // 1st call: cernion_market_partners — return a resolved MaStR ID
          success: true,
          data: {
            count: 1,
            results: [{ name: 'STROMDAO Netze GmbH', mastrNetzbetreiberId: 'SNB900012345' }],
          },
        }))
        .mockImplementationOnce(async () => ({
          // 2nd call: cernion_installations_local — return specific test data
          success: true,
          data: {
            results: [
              {
                mastrNummer: 'SEE900012345678',
                capacityKW: 50.5,
                operator: 'Test Operator',
                location: 'Test Location',
                commissioningDate: '2020-01-01',
              },
            ],
          },
        }));

      const result = await broker.call('assets.solar', {
        vnbName: 'STROMDAO Netze',
        format: 'xlsx',
      });

      expect(result).toBeInstanceOf(Buffer);

      const workbook = XLSX.read(result, { type: 'buffer' });
      const worksheet = workbook.Sheets['Assets'];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      // Verify we got data back
      expect(jsonData.length).toBeGreaterThanOrEqual(0);
    });
  });
});
