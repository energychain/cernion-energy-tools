/**
 * EWK Monitoring Service Tests
 *
 * Unit tests for the BNetzA EWK monitoring microservice.
 * All MCP client calls are mocked – no live network calls.
 */

const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const EWKMonitoringService = require('../services/ewk-monitoring.service');

// ─── Shared mock factories ────────────────────────────────────────────────────

function makeAnschlussdauerResult(vnbName = 'STROMDAO Netze GmbH') {
  return {
    success: true,
    data: {
      results: [
        {
          vnbName,
          bnr: '10002345',
          anschlussdauer_ee_ns_phase1_weeks: 14,
          anschlussdauer_ee_ns_phase2_weeks: 21,
          anschlussdauer_ee_ns_total_weeks: 35,
          rank: '234 / 739',
        },
      ],
      statistics: { median_weeks: 28, q25_weeks: 18, q75_weeks: 42 },
      total: 1,
    },
  };
}

function makeDigitalisierungsindexResult(vnbName = 'Bayernwerk Netz GmbH') {
  return {
    success: true,
    data: {
      results: [
        {
          vnbName,
          bnr: '10001796',
          gesamtscore_pct: 72.4,
          smart_grids_pct: 85.0,
          digitale_prozesse_pct: 68.0,
          datenmanagement_pct: 61.5,
          kundenmanagement_pct: 74.8,
          rank: '45 / 789',
        },
      ],
      statistics: { median_gesamtscore_pct: 52.0, q25_pct: 38.0, q75_pct: 67.0 },
      total: 1,
    },
  };
}

function makeUmsetzungsquoteResult(vnbName = 'STROMDAO Netze GmbH') {
  return {
    success: true,
    data: {
      results: [
        {
          vnbName,
          bnr: '10002345',
          umsetzungsquote_ee_ns_pct: 100.0,
          antraege_ee_ns: 37,
          realisiert_ee_ns: 37,
          umsetzungsquote_verbrauch_ns_pct: 92.9,
          antraege_verbrauch_ns: 28,
          realisiert_verbrauch_ns: 26,
          rank: '145 / 745',
        },
      ],
      statistics: { median_ee_ns_pct: 97.5, q25_pct: 91.0, q75_pct: 100.0 },
      total: 1,
    },
  };
}

function makeBenchmarkResult(vnbName = 'STROMDAO Netze GmbH') {
  return {
    success: true,
    data: {
      vnbName,
      bnr: '10002345',
      anschlussdauer: { rank: '234 / 739', ee_ns_total_weeks: 35, verbrauch_ns_total_weeks: 17 },
      digitalisierungsindex: {
        rank: '156 / 789',
        gesamtscore_pct: 58.2,
        smart_grids_pct: 71.0,
        digitale_prozesse_pct: 52.0,
        datenmanagement_pct: 48.5,
        kundenmanagement_pct: 61.3,
      },
      umsetzungsquote: { rank: '145 / 745', ee_ns_pct: 100.0, verbrauch_ns_pct: 92.9 },
    },
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('EWK Monitoring Service', () => {
  let broker;

  beforeAll(() => {
    callWithNewSession.mockImplementation(async (toolName, params) => {
      switch (toolName) {
        case 'ewk_anschlussdauer':
          return makeAnschlussdauerResult(params.vnbName || 'Mock VNB');
        case 'ewk_digitalisierungsindex':
          return makeDigitalisierungsindexResult(params.vnbName || 'Mock VNB');
        case 'ewk_umsetzungsquote':
          return makeUmsetzungsquoteResult(params.vnbName || 'Mock VNB');
        case 'ewk_benchmark_vnb':
          return makeBenchmarkResult(params.vnbName || 'Mock VNB');
        default:
          return { success: true, data: {} };
      }
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(EWKMonitoringService);
    return broker.start();
  });

  afterAll(() => broker.stop());

  // ─── Service definition ────────────────────────────────────────────────────

  describe('Service definition', () => {
    it('should have correct service name', () => {
      expect(EWKMonitoringService.name).toBe('ewk-monitoring');
    });

    it('should expose 4 actions', () => {
      const actions = Object.keys(EWKMonitoringService.actions);
      expect(actions).toContain('anschlussdauer');
      expect(actions).toContain('digitalisierungsindex');
      expect(actions).toContain('umsetzungsquote');
      expect(actions).toContain('benchmarkVnb');
      expect(actions).toHaveLength(4);
    });

    it('should have defaultTimeout setting', () => {
      expect(EWKMonitoringService.settings.defaultTimeout).toBe(30000);
    });
  });

  // ─── anschlussdauer ────────────────────────────────────────────────────────

  describe('anschlussdauer action', () => {
    it('should return data with default params', async () => {
      const result = await broker.call('ewk-monitoring.anschlussdauer', {});
      expect(result.success).toBe(true);
      expect(result.data.results).toBeDefined();
      expect(Array.isArray(result.data.results)).toBe(true);
    });

    it('should accept vnbName filter', async () => {
      const result = await broker.call('ewk-monitoring.anschlussdauer', {
        vnbName: 'STROMDAO Netze',
      });
      expect(result.success).toBe(true);
      expect(result.data.results[0].vnbName).toBe('STROMDAO Netze');
    });

    it('should accept voltageLevel enum values', async () => {
      for (const level of ['NS', 'MS', 'HS', 'all']) {
        const result = await broker.call('ewk-monitoring.anschlussdauer', {
          voltageLevel: level,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid voltageLevel', async () => {
      await expect(
        broker.call('ewk-monitoring.anschlussdauer', { voltageLevel: 'UHV' })
      ).rejects.toThrow();
    });

    it('should accept installationType enum values', async () => {
      for (const type of ['EE', 'Verbrauch', 'all']) {
        const result = await broker.call('ewk-monitoring.anschlussdauer', {
          installationType: type,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid installationType', async () => {
      await expect(
        broker.call('ewk-monitoring.anschlussdauer', { installationType: 'INVALID' })
      ).rejects.toThrow();
    });

    it('should reject limit below minimum', async () => {
      await expect(broker.call('ewk-monitoring.anschlussdauer', { limit: 0 })).rejects.toThrow();
    });

    it('should call ewk_anschlussdauer MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.anschlussdauer', { vnbName: 'Netze BW' });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'ewk_anschlussdauer',
        expect.objectContaining({ vnbName: 'Netze BW' }),
        undefined
      );
    });

    it('should NOT forward format to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.anschlussdauer', { format: 'csv' });
      const calledParams = callWithNewSession.mock.calls[0][1];
      expect(calledParams).not.toHaveProperty('format');
    });

    it('should return CSV string for format=csv', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: true,
        data: {
          results: [
            {
              vnbName: 'STROMDAO Netze GmbH',
              bnr: '10002345',
              anschlussdauer_ee_ns_total_weeks: 35,
            },
          ],
          total: 1,
        },
      });
      const result = await broker.call('ewk-monitoring.anschlussdauer', {
        vnbName: 'STROMDAO Netze',
        format: 'csv',
      });
      expect(typeof result === 'string' || Buffer.isBuffer(result)).toBe(true);
    });
  });

  // ─── digitalisierungsindex ────────────────────────────────────────────────

  describe('digitalisierungsindex action', () => {
    it('should return data with default params', async () => {
      const result = await broker.call('ewk-monitoring.digitalisierungsindex', {});
      expect(result.success).toBe(true);
      expect(result.data.results).toBeDefined();
    });

    it('should accept category enum values', async () => {
      for (const cat of [
        'gesamtscore',
        'smart_grids',
        'digitale_prozesse',
        'datenmanagement',
        'kundenmanagement',
        'all',
      ]) {
        const result = await broker.call('ewk-monitoring.digitalisierungsindex', {
          category: cat,
        });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid category', async () => {
      await expect(
        broker.call('ewk-monitoring.digitalisierungsindex', { category: 'unknown' })
      ).rejects.toThrow();
    });

    it('should accept vnbName filter and return matching result', async () => {
      const result = await broker.call('ewk-monitoring.digitalisierungsindex', {
        vnbName: 'Bayernwerk Netz',
      });
      expect(result.success).toBe(true);
      expect(result.data.results[0].vnbName).toBe('Bayernwerk Netz');
    });

    it('should call ewk_digitalisierungsindex MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.digitalisierungsindex', { category: 'smart_grids' });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'ewk_digitalisierungsindex',
        expect.objectContaining({ category: 'smart_grids' }),
        undefined
      );
    });

    it('should NOT forward format to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.digitalisierungsindex', { format: 'xlsx' });
      const calledParams = callWithNewSession.mock.calls[0][1];
      expect(calledParams).not.toHaveProperty('format');
    });
  });

  // ─── umsetzungsquote ──────────────────────────────────────────────────────

  describe('umsetzungsquote action', () => {
    it('should return data with default params', async () => {
      const result = await broker.call('ewk-monitoring.umsetzungsquote', {});
      expect(result.success).toBe(true);
      expect(result.data.results).toBeDefined();
    });

    it('should accept voltageLevel and installationType filters together', async () => {
      const result = await broker.call('ewk-monitoring.umsetzungsquote', {
        voltageLevel: 'NS',
        installationType: 'EE',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid voltageLevel', async () => {
      await expect(
        broker.call('ewk-monitoring.umsetzungsquote', { voltageLevel: 'EHV' })
      ).rejects.toThrow();
    });

    it('should accept bnr for exact lookup', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.umsetzungsquote', { bnr: '10002345' });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'ewk_umsetzungsquote',
        expect.objectContaining({ bdewCode: '10002345' }),
        undefined
      );
    });

    it('should accept pagination params', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.umsetzungsquote', { limit: 20, offset: 40 });
      const calledParams = callWithNewSession.mock.calls[0][1];
      expect(calledParams.limit).toBe(20);
      expect(calledParams.offset).toBe(40);
    });

    it('should call ewk_umsetzungsquote MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.umsetzungsquote', {
        installationType: 'Verbrauch',
        voltageLevel: 'NS',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'ewk_umsetzungsquote',
        expect.objectContaining({ installationType: 'Verbrauch', voltageLevel: 'NS' }),
        undefined
      );
    });

    it('should NOT forward format to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.umsetzungsquote', { format: 'csv' });
      const calledParams = callWithNewSession.mock.calls[0][1];
      expect(calledParams).not.toHaveProperty('format');
    });
  });

  // ─── benchmarkVnb ─────────────────────────────────────────────────────────

  describe('benchmarkVnb action', () => {
    it('should require vnbName', async () => {
      await expect(broker.call('ewk-monitoring.benchmarkVnb', {})).rejects.toThrow();
    });

    it('should reject empty vnbName', async () => {
      await expect(broker.call('ewk-monitoring.benchmarkVnb', { vnbName: '' })).rejects.toThrow();
    });

    it('should return combined benchmark profile', async () => {
      const result = await broker.call('ewk-monitoring.benchmarkVnb', {
        vnbName: 'STROMDAO Netze',
      });
      expect(result.success).toBe(true);
      expect(result.data.anschlussdauer).toBeDefined();
      expect(result.data.digitalisierungsindex).toBeDefined();
      expect(result.data.umsetzungsquote).toBeDefined();
    });

    it('should accept optional bnr alongside vnbName', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.benchmarkVnb', {
        vnbName: 'Netze BW',
        bnr: '10001796',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'ewk_benchmark_vnb',
        expect.objectContaining({ vnbName: 'Netze BW', bnr: '10001796' }),
        undefined
      );
    });

    it('should call ewk_benchmark_vnb MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.benchmarkVnb', { vnbName: 'Bayernwerk Netz' });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'ewk_benchmark_vnb',
        expect.objectContaining({ vnbName: 'Bayernwerk Netz' }),
        undefined
      );
    });

    it('should NOT forward format to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.benchmarkVnb', {
        vnbName: 'STROMDAO Netze',
        format: 'csv',
      });
      const calledParams = callWithNewSession.mock.calls[0][1];
      expect(calledParams).not.toHaveProperty('format');
    });

    it('should pass vnbName correctly to MCP tool', async () => {
      callWithNewSession.mockClear();
      await broker.call('ewk-monitoring.benchmarkVnb', { vnbName: 'Stadtwerke Heidelberg' });
      expect(callWithNewSession.mock.calls[0][1].vnbName).toBe('Stadtwerke Heidelberg');
    });
  });
});
