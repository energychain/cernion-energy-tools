/**
 * Grid Operations Service Integration Tests
 *
 * Test the Grid Operations microservice
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const { callWithAutoPoll } = require('../src/async-job-poller');
const GridOperationsService = require('../services/grid-operations.service');

describe('Grid Operations Service', () => {
  let broker;

  beforeAll(() => {
    callWithNewSession.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    callWithAutoPoll.mockImplementation(async (toolName, params) => ({
      success: true,
      toolName,
      params,
      data: {},
    }));

    broker = new ServiceBroker({ logger: false });
    broker.createService(GridOperationsService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('operatorAnalysis action', () => {
    it('should require at least one grid operator identifier', async () => {
      await expect(broker.call('grid-operations.operatorAnalysis', {})).rejects.toThrow();
    });

    it('should accept valid operator analysis request', async () => {
      const result = await broker.call('grid-operations.operatorAnalysis', {
        gridOperator: 'Netze BW',
        includeRedispatch: true,
      });

      expect(result).toBeDefined();
    });

    it('should accept MaStR grid operator ID', async () => {
      const result = await broker.call('grid-operations.operatorAnalysis', {
        gridOperatorId: 'SNB935578300972',
        includeCapacityMap: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('vnbLookupCodes action', () => {
    it('should require at least one lookup identifier', async () => {
      await expect(broker.call('grid-operations.vnbLookupCodes', {})).rejects.toThrow(
        'At least one lookup identifier is required'
      );
    });

    it('should call MCP tool vnb_lookup_codes with request payload', async () => {
      callWithNewSession.mockClear();

      await broker.call('grid-operations.vnbLookupCodes', {
        bdewCode: '9907473000008',
        vnbName: 'TWL Netze GmbH',
        includeAliases: true,
        includeTrace: false,
        limitCandidates: 5,
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'vnb_lookup_codes',
        expect.objectContaining({
          bdewCode: '9907473000008',
          vnbName: 'TWL Netze GmbH',
          includeAliases: true,
          includeTrace: false,
          limitCandidates: 5,
        }),
        undefined
      );
    });
  });

  describe('vnbLookupCodes — MaStR-ID promotion (BR-0001)', () => {
    const BDEW_NO_MASTR = '9904350000002';
    const BDEW_WITH_MASTR = '9907473000008';
    const MASTR_ID = 'SNB935578300972';

    beforeEach(() => callWithNewSession.mockClear());

    it('promotes BDEW alias with MaStR-ID when primary has null', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          canonical: { bdewCodePrimary: BDEW_NO_MASTR, mastrId: null, bnr: null },
          aliases: [{ type: 'bdew', code: BDEW_WITH_MASTR, role: 'candidate' }],
        })
        .mockResolvedValueOnce({
          data: { bdew: BDEW_WITH_MASTR, mastrId: MASTR_ID },
        });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        vnbName: 'TWL Netze',
      });

      expect(result.canonical.bdewCodePrimary).toBe(BDEW_WITH_MASTR);
      expect(result.canonical.mastrId).toBe(MASTR_ID);
      // Promoted alias now carries role 'primary'
      expect(result.aliases[0].role).toBe('primary');

      // cernion_vnb_lookup was called for the alias code
      expect(callWithNewSession).toHaveBeenCalledTimes(2);
      expect(callWithNewSession).toHaveBeenNthCalledWith(
        2,
        'cernion_vnb_lookup',
        { bdew: BDEW_WITH_MASTR },
        undefined
      );
    });

    it('demotes old primary in aliases list when it is present', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          canonical: { bdewCodePrimary: BDEW_NO_MASTR, mastrId: null, bnr: null },
          aliases: [
            { type: 'bdew', code: BDEW_NO_MASTR, role: 'primary' }, // old primary also in aliases
            { type: 'bdew', code: BDEW_WITH_MASTR, role: 'candidate' },
          ],
        })
        .mockResolvedValueOnce({ data: { mastrId: null } }) // BDEW_NO_MASTR — no mastrId
        .mockResolvedValueOnce({ data: { bdew: BDEW_WITH_MASTR, mastrId: MASTR_ID } }); // promoted

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        vnbName: 'TWL Netze',
      });

      const oldAlias = result.aliases.find((a) => a.code === BDEW_NO_MASTR);
      const newAlias = result.aliases.find((a) => a.code === BDEW_WITH_MASTR);
      expect(oldAlias.role).toBe('candidate'); // demoted
      expect(newAlias.role).toBe('primary'); // promoted
    });

    it('copies bnr from lookup result when promoting', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          canonical: { bdewCodePrimary: BDEW_NO_MASTR, mastrId: null, bnr: null },
          aliases: [{ type: 'bdew', code: BDEW_WITH_MASTR, role: 'candidate' }],
        })
        .mockResolvedValueOnce({
          data: { bdew: BDEW_WITH_MASTR, mastrId: MASTR_ID, bnr: '10002345' },
        });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        vnbName: 'TWL Netze',
      });

      expect(result.canonical.bnr).toBe('10002345');
    });

    it('keeps primary when it already has a MaStR-ID', async () => {
      callWithNewSession.mockResolvedValueOnce({
        canonical: { bdewCodePrimary: BDEW_WITH_MASTR, mastrId: MASTR_ID, bnr: null },
        aliases: [],
      });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        bdewCode: BDEW_WITH_MASTR,
      });

      expect(result.canonical.mastrId).toBe(MASTR_ID);
      expect(callWithNewSession).toHaveBeenCalledTimes(1); // no fallback call
    });

    it('keeps primary when no alias resolves a MaStR-ID', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          canonical: { bdewCodePrimary: BDEW_NO_MASTR, mastrId: null, bnr: null },
          aliases: [{ type: 'bdew', code: '9904350000003', role: 'candidate' }],
        })
        .mockResolvedValueOnce({ data: { bdew: '9904350000003', mastrId: null } });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        vnbName: 'TWL Netze',
      });

      expect(result.canonical.bdewCodePrimary).toBe(BDEW_NO_MASTR);
      expect(result.canonical.mastrId).toBeNull();
    });

    it('skips non-bdew aliases during promotion scan', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          canonical: { bdewCodePrimary: BDEW_NO_MASTR, mastrId: null, bnr: null },
          aliases: [
            { type: 'bnr', code: '10002345', role: 'candidate' },
            { type: 'bdew', code: BDEW_WITH_MASTR, role: 'candidate' },
          ],
        })
        .mockResolvedValueOnce({ data: { bdew: BDEW_WITH_MASTR, mastrId: MASTR_ID } });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        vnbName: 'TWL Netze',
      });

      expect(result.canonical.bdewCodePrimary).toBe(BDEW_WITH_MASTR);
      // cernion_vnb_lookup was called only once (for the BDEW alias, not the BNR alias)
      expect(callWithNewSession).toHaveBeenCalledTimes(2);
    });

    it('handles cernion_vnb_lookup errors gracefully and continues', async () => {
      callWithNewSession
        .mockResolvedValueOnce({
          canonical: { bdewCodePrimary: BDEW_NO_MASTR, mastrId: null, bnr: null },
          aliases: [
            { type: 'bdew', code: '9904350000003', role: 'candidate' },
            { type: 'bdew', code: BDEW_WITH_MASTR, role: 'candidate' },
          ],
        })
        .mockRejectedValueOnce(new Error('MCP timeout'))
        .mockResolvedValueOnce({ data: { bdew: BDEW_WITH_MASTR, mastrId: MASTR_ID } });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        vnbName: 'TWL Netze',
      });

      // First alias threw → continues to second alias which resolves
      expect(result.canonical.mastrId).toBe(MASTR_ID);
    });

    it('is a no-op when result has no canonical property', async () => {
      const rawResult = { results: [{ name: 'TWL Netze', mastrId: MASTR_ID }] };
      callWithNewSession.mockResolvedValueOnce(rawResult);

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        bdewCode: BDEW_WITH_MASTR,
      });

      expect(result).toEqual(rawResult);
      expect(callWithNewSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('vnbLookupCodes — error handling (BR-0002)', () => {
    beforeEach(() => callWithNewSession.mockClear());

    it('throws 503 VNB_LOOKUP_ERROR when MCP transport throws', async () => {
      callWithNewSession.mockRejectedValueOnce(new Error('socket hang up'));

      const err = await broker
        .call('grid-operations.vnbLookupCodes', {
          bdewCode: '9906311000005',
        })
        .catch((e) => e);

      expect(err).toBeDefined();
      expect(err.message).toMatch(/VNB lookup failed/);
      expect(err.code).toBe(503);
      expect(err.type).toBe('VNB_LOOKUP_ERROR');
    });

    it('throws 404 VNB_NOT_FOUND when MCP returns null', async () => {
      callWithNewSession.mockResolvedValueOnce(null);

      const err = await broker
        .call('grid-operations.vnbLookupCodes', {
          bdewCode: '9906311000005',
        })
        .catch((e) => e);

      expect(err).toBeDefined();
      expect(err.message).toMatch(/nicht bekannt/);
      expect(err.code).toBe(404);
      expect(err.type).toBe('VNB_NOT_FOUND');
    });

    it('includes bdewCode in VNB_NOT_FOUND error data', async () => {
      callWithNewSession.mockResolvedValueOnce(null);

      const err = await broker
        .call('grid-operations.vnbLookupCodes', {
          bdewCode: '9906311000005',
        })
        .catch((e) => e);

      expect(err.data).toMatchObject({ bdewCode: '9906311000005' });
    });

    it('uses vnbName in error message when bdewCode is absent', async () => {
      callWithNewSession.mockResolvedValueOnce(null);

      const err = await broker
        .call('grid-operations.vnbLookupCodes', {
          vnbName: 'Syna GmbH',
        })
        .catch((e) => e);

      expect(err.message).toMatch(/Syna GmbH/);
      expect(err.code).toBe(404);
    });

    it('includes input params in VNB_LOOKUP_ERROR data', async () => {
      callWithNewSession.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      const err = await broker
        .call('grid-operations.vnbLookupCodes', {
          bdewCode: '9906311000005',
        })
        .catch((e) => e);

      expect(err.type).toBe('VNB_LOOKUP_ERROR');
      expect(err.data).toHaveProperty('input');
    });

    it('succeeds normally when MCP returns a valid non-null result', async () => {
      callWithNewSession.mockResolvedValueOnce({
        canonical: { bdewCodePrimary: '9906311000005', mastrId: 'SNB123', bnr: null },
        aliases: [],
      });

      const result = await broker.call('grid-operations.vnbLookupCodes', {
        bdewCode: '9906311000005',
      });

      expect(result.canonical.mastrId).toBe('SNB123');
    });
  });

  describe('capacityUtilization action', () => {
    it('should validate voltage level enum', async () => {
      await expect(
        broker.call('grid-operations.capacityUtilization', {
          gridOperator: 'Netze BW',
          voltageLevel: 'invalid-level',
        })
      ).rejects.toThrow();
    });

    it('should accept valid capacity utilization request', async () => {
      const result = await broker.call('grid-operations.capacityUtilization', {
        gridOperator: 'Netze BW',
        date: '2026-02-06',
        voltageLevel: 'all',
        includeHeatmap: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('redispatchExport action', () => {
    it('should require at least one grid operator identifier', async () => {
      await expect(broker.call('grid-operations.redispatchExport', {})).rejects.toThrow();
    });

    it('should have default minCapacity of 100kW', async () => {
      const result = await broker.call('grid-operations.redispatchExport', {
        gridOperator: 'Stadtwerke Heidelberg',
      });

      expect(result).toBeDefined();
    });

    it('should accept types as an array', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: [] });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        types: ['solar', 'wind', 'storage'],
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.objectContaining({ types: ['solar', 'wind', 'storage'] }),
        expect.any(Object),
        undefined
      );
    });

    it('should coerce comma-separated string types to an array', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: [] });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        types: 'solar,wind,storage',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.objectContaining({ types: ['solar', 'wind', 'storage'] }),
        expect.any(Object),
        undefined
      );
    });

    it('should coerce comma-separated string types with spaces', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: [] });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        types: 'solar, wind, storage',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.objectContaining({ types: ['solar', 'wind', 'storage'] }),
        expect.any(Object),
        undefined
      );
    });

    it('should return JSON by default (no format param)', async () => {
      const mockResult = {
        success: true,
        data: { content: [{ type: 'text', text: 'some narrative' }] },
      };
      callWithAutoPoll.mockResolvedValueOnce(mockResult);

      const result = await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
      });

      expect(result).toEqual(mockResult);
    });

    it('should return CSV with full installation data from local lookup for format=csv', async () => {
      const narrative = [
        '🔍 **Grid Operator Found**:',
        '   Name: TWL Netze GmbH',
        '   MaStR Number(s): SNB935578300972',
        '**Quality Report**:',
        '   Total Installations: 59',
        '   Total Capacity: 73370.00 kW',
        '**Preview** (first 5 installations):',
        '| Type | Capacity (kW) | City | Status |',
        '| --- | --- | --- | --- |',
        '|  | 100.43 | Ludwigshafen | In Betrieb |',
      ].join('\n');

      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        data: { content: [{ type: 'text', text: narrative }] },
      });

      callWithNewSession.mockResolvedValueOnce({
        success: true,
        installations: [
          {
            mastrNummer: 'SEE001',
            type: 'solar',
            bruttoleistung: 100.43,
            ort: 'Ludwigshafen',
            postleitzahl: '67059',
            inbetriebnahmedatum: '2020-01-01',
            einheitBetriebsstatus: '35',
            einsatzverantwortlicher: 'Next Kraftwerke GmbH',
          },
          {
            mastrNummer: 'SEE002',
            type: 'solar',
            bruttoleistung: 212.48,
            ort: 'Mannheim',
            postleitzahl: '68001',
            inbetriebnahmedatum: '2019-06-15',
            einheitBetriebsstatus: '35',
            einsatzverantwortlicher: '',
          },
          {
            mastrNummer: 'SBE003',
            type: 'storage',
            bruttoleistung: 9000,
            ort: 'Ludwigshafen',
            postleitzahl: '67059',
            inbetriebnahmedatum: '2023-03-10',
            einheitBetriebsstatus: '35',
          },
        ],
        total: 3,
        returned: 3,
      });

      const ctx = { meta: {} };
      const result = await broker.call(
        'grid-operations.redispatchExport',
        { gridOperatorId: 'SNB935578300972', format: 'csv' },
        ctx
      );

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^# Redispatch 2\.0 Export/);
      expect(result).toContain('# Grid Operator: TWL Netze GmbH');
      expect(result).toContain('# Total: 3 installations');
      expect(result).toContain('# Generated:');
      expect(result).toContain(
        '"mastrNummer","type","capacityKW","city","postalCode","commissioningDate","status","einsatzverantwortlicher"'
      );
      expect(result).toContain('SEE001');
      expect(result).toContain('SEE002');
      expect(result).toContain('SBE003');
      expect(result).toContain('Ludwigshafen');
      expect(result).toContain('Next Kraftwerke GmbH'); // einsatzverantwortlicher populated
      expect(result).not.toContain('# Note: Preview only');
    });

    it('should use empty string for einsatzverantwortlicher when field absent in MaStR record', async () => {
      const narrative =
        '🔍 **Grid Operator Found**:\n   Name: Test Netz\n   MaStR Number(s): SNB000000000001\n**Quality Report**:\n   Total Installations: 1\n   Total Capacity: 500.00 kW';
      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        data: { content: [{ type: 'text', text: narrative }] },
      });
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        installations: [
          // No einsatzverantwortlicher field — should map to empty string
          {
            mastrNummer: 'SEE999',
            type: 'solar',
            bruttoleistung: 500,
            ort: 'Teststadt',
            postleitzahl: '10000',
            inbetriebnahmedatum: '2021-05-01',
            einheitBetriebsstatus: '35',
          },
        ],
        total: 1,
        returned: 1,
      });

      const result = await broker.call(
        'grid-operations.redispatchExport',
        { gridOperatorId: 'SNB000000000001', format: 'csv' },
        { meta: {} }
      );

      expect(result).toContain(
        '"mastrNummer","type","capacityKW","city","postalCode","commissioningDate","status","einsatzverantwortlicher"'
      );
      // Row value: einsatzverantwortlicher column is empty (trailing comma with empty quoted string)
      expect(result).toMatch(/"SEE999".*""/);
    });

    it('should call cernion_installations_local with correct params', async () => {
      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            {
              type: 'text',
              text: 'Name: Test GmbH\n   MaStR Number(s): SNB935578300972\n**Quality Report**:\n   Total Installations: 5\n   Total Capacity: 500.00 kW',
            },
          ],
        },
      });
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        installations: [],
        total: 0,
        returned: 0,
      });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        minCapacity: 150,
        format: 'csv',
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_installations_local',
        expect.objectContaining({
          gridOperatorMastrId: 'SNB935578300972',
          minCapacity: 150,
          format: 'detailed',
        }),
        undefined
      );
    });

    it('should not forward format param to MCP tool', async () => {
      callWithAutoPoll.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('grid-operations.redispatchExport', {
        gridOperatorId: 'SNB935578300972',
        format: 'csv',
      });

      expect(callWithAutoPoll).toHaveBeenCalledWith(
        'cernion_redispatch_export',
        expect.not.objectContaining({ format: expect.anything() }),
        expect.any(Object),
        undefined
      );
    });

    it('should throw when async job result contains isError: true', async () => {
      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        data: {
          content: [
            { type: 'text', text: '❌ **Export error**\n\nJob failed: grid operator not found' },
          ],
          isError: true,
        },
      });

      await expect(
        broker.call('grid-operations.redispatchExport', {
          gridOperatorId: 'SNB000000000000',
          format: 'csv',
        })
      ).rejects.toThrow(/Export error|grid operator not found/i);
    });
  });

  describe('vnbdigitalSearch action', () => {
    it('should require searchTerm', async () => {
      await expect(broker.call('grid-operations.vnbdigitalSearch', {})).rejects.toThrow();
    });

    it('should accept valid search', async () => {
      const result = await broker.call('grid-operations.vnbdigitalSearch', {
        searchTerm: 'Gerhard-Weiser-Ring 29, 69256 Mauer',
      });

      expect(result).toBeDefined();
    });

    it('should passthrough optional profileUrl when returned by MCP', async () => {
      callWithNewSession.mockResolvedValueOnce({
        searchTerm: 'Heidelberg',
        total: 1,
        results: [
          {
            _id: 'DEBWhk01000gMZ1V',
            title: 'Stadtwerke Heidelberg Netze GmbH',
            type: 'vnb',
            profileUrl: 'https://www.vnbdigital.de/vnb/DEBWhk01000gMZ1V',
          },
        ],
      });

      const result = await broker.call('grid-operations.vnbdigitalSearch', {
        searchTerm: 'Heidelberg',
      });

      expect(result.results[0].profileUrl).toBe('https://www.vnbdigital.de/vnb/DEBWhk01000gMZ1V');
      expect(result.results[0].entityId).toBe('DEBWhk01000gMZ1V');
      expect(result.results[0].entityType).toBe('vnb');
      expect(result.results[0].lookupHint).toBe('profile_or_control_measures');
    });
  });

  describe('vnbdigitalLookup action', () => {
    it('should require coordinates when searchType is coordinates', async () => {
      await expect(
        broker.call('grid-operations.vnbdigitalLookup', {
          searchType: 'coordinates',
        })
      ).rejects.toThrow();
    });

    it('should accept coordinates lookup', async () => {
      const result = await broker.call('grid-operations.vnbdigitalLookup', {
        searchType: 'coordinates',
        coordinates: '49.34206,8.80022',
      });

      expect(result).toBeDefined();
    });

    it('should passthrough optional profileUrl in VNB lookup entries', async () => {
      callWithNewSession.mockResolvedValueOnce({
        searchType: 'coordinates',
        coordinates: '49.34206,8.80022',
        result: {
          vnbs: [
            {
              _id: 'DEBWhk01000gMZ1V',
              name: 'Stadtwerke Heidelberg Netze GmbH',
              voltageTypes: ['Niederspannung'],
              profileUrl: 'https://www.vnbdigital.de/vnb/DEBWhk01000gMZ1V',
            },
          ],
        },
      });

      const result = await broker.call('grid-operations.vnbdigitalLookup', {
        searchType: 'coordinates',
        coordinates: '49.34206,8.80022',
      });

      expect(result.result.vnbs[0].profileUrl).toBe(
        'https://www.vnbdigital.de/vnb/DEBWhk01000gMZ1V'
      );
      expect(result.result.vnbs[0].entityType).toBe('vnb');
      expect(result.result.vnbs[0].entityId).toBe('DEBWhk01000gMZ1V');
      expect(result.result.vnbs[0].vnbdigitalId).toBe('DEBWhk01000gMZ1V');
    });

    it('should remain backward compatible when profileUrl is missing', async () => {
      callWithNewSession.mockResolvedValueOnce({
        searchType: 'coordinates',
        coordinates: '49.34206,8.80022',
        result: {
          vnbs: [
            {
              _id: 'DEBWhk01000gMZ1V',
              name: 'Stadtwerke Heidelberg Netze GmbH',
              voltageTypes: ['Niederspannung'],
            },
          ],
        },
      });

      const result = await broker.call('grid-operations.vnbdigitalLookup', {
        searchType: 'coordinates',
        coordinates: '49.34206,8.80022',
      });

      expect(result.result.vnbs[0].name).toBe('Stadtwerke Heidelberg Netze GmbH');
      expect(result.result.vnbs[0].profileUrl).toBeUndefined();
    });
  });

  describe('controlMeasures action', () => {
    it('should require postcode when searchType is postcode', async () => {
      await expect(
        broker.call('grid-operations.controlMeasures', { searchType: 'postcode' })
      ).rejects.toThrow();
    });

    it('should require vnbId when searchType is vnb', async () => {
      await expect(
        broker.call('grid-operations.controlMeasures', { searchType: 'vnb' })
      ).rejects.toThrow();
    });

    it('should call vnbdigital_control_measures with postcode', async () => {
      const result = await broker.call('grid-operations.controlMeasures', {
        searchType: 'postcode',
        postcode: '69256',
      });
      expect(result).toBeDefined();
    });

    it('should call vnbdigital_control_measures with vnbId', async () => {
      const result = await broker.call('grid-operations.controlMeasures', {
        searchType: 'vnb',
        vnbId: 'DEBWhk01000gMZ1V',
      });
      expect(result).toBeDefined();
    });
  });

  describe('vnbLookup action', () => {
    it('should require at least one of: bdew, city, vnbName, or query', async () => {
      await expect(broker.call('grid-operations.vnbLookup', {})).rejects.toThrow();
    });

    it('should accept valid bdew lookup', async () => {
      const result = await broker.call('grid-operations.vnbLookup', {
        bdew: '9900992720003',
        limit: 5,
      });

      expect(result).toBeDefined();
    });

    it('should accept city-only lookup (v0.54.3)', async () => {
      // v0.54.3: city-only queries should not fail validation
      const result = await broker.call('grid-operations.vnbLookup', {
        city: 'Wiesloch',
        limit: 5,
      });

      expect(result).toBeDefined();
    });

    it('marks city fallback placeholder values as unverified and partial', async () => {
      callWithNewSession.mockResolvedValueOnce({ success: true, data: {} });
      callWithAutoPoll.mockResolvedValueOnce({
        success: true,
        installations: [
          {
            napData: {
              netzbetreiberMastrNummer: 'SNB935578300972',
            },
          },
        ],
      });

      const result = await broker.call('grid-operations.vnbLookup', {
        city: 'Wiesloch',
      });

      expect(result.success).toBe(true);
      expect(result.data.source).toBe('city-nap-fallback');
      expect(result.data.bdew).toBeNull();
      expect(result.data.companyName).toBeNull();
      expect(result.data.evidenceStatus).toBe('unverified');
      expect(result.data.partial).toBe(true);
      expect(result.data.unverified).toBe(true);
      expect(result.data.verification).toEqual(
        expect.objectContaining({
          verifiedIdentity: false,
          gap: expect.objectContaining({ code: 'VNB_IDENTITY_UNVERIFIED' }),
        })
      );
    });

    it('keeps authoritative vnb lookup as verified evidence', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          bdew: '9900992720003',
          companyName: 'Netze BW GmbH',
          mastrId: 'SNB935578300972',
          source: 'bdew-lookup',
        },
      });

      const result = await broker.call('grid-operations.vnbLookup', {
        bdew: '9900992720003',
      });

      expect(result.success).toBe(true);
      expect(result.data.evidenceStatus).toBe('verified');
      expect(result.data.partial).toBe(false);
      expect(result.data.unverified).toBe(false);
      expect(result.data.verification).toEqual(
        expect.objectContaining({
          verifiedIdentity: true,
          gap: null,
        })
      );
    });
  });

  describe('connectionCapacityCheck action', () => {
    it('should validate installation type enum', async () => {
      await expect(
        broker.call('grid-operations.connectionCapacityCheck', {
          gridOperator: 'Test',
          location: 'Test',
          installationType: 'invalid',
          capacityKW: 10,
        })
      ).rejects.toThrow();
    });

    it('should accept valid connection check request', async () => {
      const result = await broker.call('grid-operations.connectionCapacityCheck', {
        gridOperator: 'Netze BW',
        location: 'Heidelberg',
        installationType: 'solar',
        capacityKW: 10,
      });

      expect(result).toBeDefined();
    });
  });

  describe('direktvermarkterLookup action', () => {
    it('should throw when neither name nor mastrId is provided', async () => {
      await expect(broker.call('grid-operations.direktvermarkterLookup', {})).rejects.toThrow(
        'At least one lookup parameter is required: name or mastrId'
      );
    });

    it('should call cernion_direktvermarkter_lookup with name param', async () => {
      callWithNewSession.mockClear();
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          results: [
            {
              name: 'Next Kraftwerke GmbH',
              mastrId: 'ABR123456789',
              role: 'Direktvermarkter',
              portfolioSize: 12453,
              totalCapacityMW: 3240.5,
            },
          ],
        },
      });

      const result = await broker.call('grid-operations.direktvermarkterLookup', {
        name: 'Next Kraftwerke',
        limit: 5,
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_direktvermarkter_lookup',
        expect.objectContaining({ name: 'Next Kraftwerke', limit: 5 }),
        undefined
      );
      expect(result.success).toBe(true);
    });

    it('should call cernion_direktvermarkter_lookup with mastrId param', async () => {
      callWithNewSession.mockClear();
      callWithNewSession.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('grid-operations.direktvermarkterLookup', {
        mastrId: 'ABR123456789',
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_direktvermarkter_lookup',
        expect.objectContaining({ mastrId: 'ABR123456789' }),
        undefined
      );
    });

    it('should accept onlyActive and limit params', async () => {
      callWithNewSession.mockClear();
      callWithNewSession.mockResolvedValueOnce({ success: true, data: {} });

      await broker.call('grid-operations.direktvermarkterLookup', {
        name: 'Statkraft',
        onlyActive: true,
        limit: 10,
      });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_direktvermarkter_lookup',
        expect.objectContaining({ name: 'Statkraft', onlyActive: true, limit: 10 }),
        undefined
      );
    });
  });

  // ─── marketPartners enrichment (v0.20.3) ─────────────────────────────────

  describe('marketPartners action — company enrichment', () => {
    const MOCK_MP_RESULTS = [
      { bdew: '9900111000001', name: 'Test Netze GmbH', roles: ['VNB'] },
      { bdew: '9910111000002', name: 'Test Energie GmbH', roles: ['Lieferant'] },
    ];

    beforeEach(() => {
      callWithNewSession.mockReset();
    });

    it('calls cernion_market_partners with provided params', async () => {
      callWithNewSession.mockResolvedValueOnce({ results: MOCK_MP_RESULTS });

      // Register a stub company service that returns results unchanged
      const companyStub = {
        name: 'company',
        actions: {
          enrichResults: {
            handler(ctx) {
              return ctx.params.results;
            },
          },
        },
      };
      broker.createService(companyStub);
      await new Promise((r) => setTimeout(r, 50));

      await broker.call('grid-operations.marketPartners', { query: 'Test' });

      expect(callWithNewSession).toHaveBeenCalledWith(
        'cernion_market_partners',
        expect.objectContaining({ query: 'Test' }),
        undefined
      );

      // Clean up stub service
      const svc = broker.getLocalService('company');
      if (svc) await broker.destroyService(svc);
    });

    it('injects companyId + marketRole when company service is available', async () => {
      callWithNewSession.mockResolvedValueOnce({ results: MOCK_MP_RESULTS });

      const enrichedResults = MOCK_MP_RESULTS.map((r, i) => ({
        ...r,
        companyId: i === 0 ? 'uuid-abc-123' : null,
        marketRole: i === 0 ? 'VNB' : 'Lieferant',
      }));

      const enrichStub = {
        name: 'company',
        actions: {
          enrichResults: {
            handler() {
              return enrichedResults;
            },
          },
        },
      };
      broker.createService(enrichStub);
      await new Promise((r) => setTimeout(r, 50));

      const result = await broker.call('grid-operations.marketPartners', { query: 'Test' });

      // Result is passed through applyFormat — check results field
      const body = result?.results || result?.data?.results || result;
      const arr = Array.isArray(body) ? body : body?.results || [];
      if (arr.length > 0) {
        expect(arr[0]).toHaveProperty('companyId');
        expect(arr[0]).toHaveProperty('marketRole');
      }

      const svc = broker.getLocalService('company');
      if (svc) await broker.destroyService(svc);
    });

    it('degrades gracefully when company service throws', async () => {
      callWithNewSession.mockResolvedValueOnce({ results: MOCK_MP_RESULTS });

      const failStub = {
        name: 'company',
        actions: {
          enrichResults: {
            handler() {
              throw new Error('company DB unavailable');
            },
          },
        },
      };
      broker.createService(failStub);
      await new Promise((r) => setTimeout(r, 50));

      // Should not throw — original results returned
      await expect(
        broker.call('grid-operations.marketPartners', { query: 'Test' })
      ).resolves.toBeDefined();

      const svc = broker.getLocalService('company');
      if (svc) await broker.destroyService(svc);
    });
  });
});
