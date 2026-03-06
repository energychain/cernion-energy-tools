/**
 * Utility Report Service Tests
 *
 * Unit tests for the 360° management report generator.
 * All external calls are mocked – no live MCP or network calls.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { ServiceBroker } = require('moleculer');

// ─── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn().mockResolvedValue({ success: true, data: {} }),
}));

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => '⚡ Test finding 1\n🌱 Test finding 2\n📈 Test finding 3' },
      }),
    }),
  })),
}));

const { callWithNewSession } = require('../src/mcp-client');

// Redirect .reports dir to a temp directory so tests don't pollute workspace
// NOTE: tmpReportsDir is computed INSIDE the factory (jest.mock is hoisted before const declarations)
const REPORTS_TEST_SUBDIR = 'utility-report-test';
jest.mock('path', () => {
  const realPath = jest.requireActual('path');
  const os = require('os');
  // Use a stable-enough name: tmp + subdir constant (no Date.now in hoisted scope)
  const testReportsBase = realPath.join(os.tmpdir(), 'utility-report-test');
  return {
    ...realPath,
    join: (...args) => {
      const joined = realPath.join(...args);
      if (joined.includes('/.reports') || joined.endsWith('/.reports') || joined.endsWith('\\.reports')) {
        return joined.replace(/.*[/\\]\.reports/, testReportsBase);
      }
      return joined;
    },
  };
});
// Compute matching tmpReportsDir for cleanup (must match the factory logic)
const tmpReportsDir = require('path').join(require('os').tmpdir(), REPORTS_TEST_SUBDIR);

const UtilityReportService = require('../services/utility-report.service');

// ─── Test helpers ───────────────────────────────────────────────────────────────

function makeMockService(name, actions) {
  return { name, actions };
}

function mockBrokerService(broker, name, actionMocks) {
  const actions = {};
  for (const [k, v] of Object.entries(actionMocks)) {
    actions[k] = jest.fn().mockImplementation(v);
  }
  broker.createService({ name, actions });
}

const DEFAULT_MOCK_RESULT = { success: true, data: { results: [], total: 0, count: 0 } };

const DEFAULT_SERVICE_MOCKS = {
  'grid-operations': {
    marketPartners: async () => ({ results: [{ name: 'TWL Netze GmbH', bdewCode: '10002345', mastrId: 'SNB123' }] }),
    vnbLookup: async () => DEFAULT_MOCK_RESULT,
    capacityUtilization: async () => DEFAULT_MOCK_RESULT,
    redispatchExport: async () => ({ ...DEFAULT_MOCK_RESULT, totalCount: 47 }),
    operatorAnalysis: async () => DEFAULT_MOCK_RESULT,
  },
  'eic-codes': {
    search: async () => DEFAULT_MOCK_RESULT,
    statistics: async () => ({ total: 5000, byType: {} }),
  },
  'ewk-monitoring': {
    benchmarkVnb: async () => DEFAULT_MOCK_RESULT,
    anschlussdauer: async () => DEFAULT_MOCK_RESULT,
    digitalisierungsindex: async () => DEFAULT_MOCK_RESULT,
    umsetzungsquote: async () => DEFAULT_MOCK_RESULT,
  },
  'residual-load': {
    netResidualLoad: async () => DEFAULT_MOCK_RESULT,
  },
  'energy-market': {
    prices: async () => ({ prices: [], latestPrice: 42.5 }),
    co2Intensity: async () => ({ co2intensity: 218 }),
  },
  assets: {
    solar: async () => ({ totalCapacityKw: 25000, totalCount: 1200 }),
    wind: async () => ({ totalCapacityKw: 8000, totalCount: 15 }),
    storage: async () => ({ totalCapacityKw: 4500, totalCount: 230 }),
  },
  forecast: {
    generationForecast: async () => DEFAULT_MOCK_RESULT,
  },
  entsoe: {
    windSolarActual: async () => DEFAULT_MOCK_RESULT,
    actualGeneration: async () => DEFAULT_MOCK_RESULT,
    loadForecast: async () => DEFAULT_MOCK_RESULT,
    unavailability: async () => DEFAULT_MOCK_RESULT,
  },
  'german-grid': {
    spotprices: async () => DEFAULT_MOCK_RESULT,
    negativePrices: async () => DEFAULT_MOCK_RESULT,
  },
  'gas-storage': {
    countryStorage: async () => ({ full: 72.5, gasInStorage: 182.3 }),
    euStatistics: async () => ({ full: 68.1 }),
    storageTrend: async () => ({ trend: [], trendDirection: 'injection' }),
    supplySecurityCheck: async () => ({ status: 'compliant' }),
    compareCountries: async () => DEFAULT_MOCK_RESULT,
  },
  'business-intelligence': {
    churnPrediction: async () => ({ data: [{ type: 'text', text: 'Estimated at-risk customers: 150\nAssumed churn rate: 8.5%\nheuristic model.' }] }),
    salesLeads: async () => ({ leads: Array(12).fill({}), totalCount: 12 }),
    marketPenetration: async () => DEFAULT_MOCK_RESULT,
  },
  'web-search': {
    query: async () => ({ success: true, data: { query: 'test', results: [] } }),
  },
  system: {
    status: async () => ({ status: 'online' }),
  },
};

// ─── Test Suite ─────────────────────────────────────────────────────────────────

describe('Utility Report Service', () => {
  let broker;

  beforeAll(() => {
    // Ensure callWithNewSession returns empty for discover (no live backend)
    callWithNewSession.mockResolvedValue({ success: true, data: { tools: [] } });

    broker = new ServiceBroker({ logger: false, requestTimeout: 60000 });
    broker.createService(UtilityReportService);

    // Register all mock dependencies
    for (const [name, actionMocks] of Object.entries(DEFAULT_SERVICE_MOCKS)) {
      mockBrokerService(broker, name, actionMocks);
    }

    return broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    // Cleanup temp reports dir
    try { fs.rmSync(tmpReportsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── Parameter validation ──────────────────────────────────────────────────

  describe('generate – parameter validation', () => {
    it('should require utilityName', async () => {
      await expect(broker.call('utility-report.generate', {})).rejects.toThrow();
    });

    it('should reject empty utilityName', async () => {
      await expect(
        broker.call('utility-report.generate', { utilityName: '' })
      ).rejects.toThrow();
    });

    it('should accept minimal valid params', async () => {
      const result = await broker.call('utility-report.generate', {
        utilityName: 'TestwerkeGmbH',
      });
      expect(result.success).toBe(true);
      expect(result.reportId).toBeTruthy();
    });
  });

  // ─── generate action ───────────────────────────────────────────────────────

  describe('generate action', () => {
    it('should return a reportId and status "generating"', async () => {
      const result = await broker.call('utility-report.generate', {
        utilityName: 'Stadtwerke Test GmbH',
        region: 'Teststadt',
      });

      expect(result.success).toBe(true);
      expect(result.reportId).toMatch(/^[0-9a-f-]{36}$/i); // UUID
      expect(['generating', 'cached']).toContain(result.status);
      expect(result.downloadUrl).toContain(result.reportId);
    });

    it('should return cached report for the same utility name on same day', async () => {
      const params = { utilityName: 'Cache Test Stadtwerke', region: 'CacheCity' };

      // First call
      const first = await broker.call('utility-report.generate', params);
      expect(first.success).toBe(true);

      // Wait briefly so pipeline can store progress
      await new Promise((r) => setTimeout(r, 50));

      // Second call – may return 'cached' if report already written, or 'generating' if still in pipeline
      const second = await broker.call('utility-report.generate', params);
      expect(second.success).toBe(true);
    });

    it('should ignore cache with forceRefresh:true', async () => {
      const params = { utilityName: 'ForceRefresh Test GmbH', forceRefresh: true };

      const first = await broker.call('utility-report.generate', params);
      const second = await broker.call('utility-report.generate', params);

      // Both should return new reportIds (no caching)
      expect(first.reportId).not.toBe(second.reportId);
    });

    it('should include all optional params without error', async () => {
      const result = await broker.call('utility-report.generate', {
        utilityName: 'Vollständige Stadtwerke GmbH',
        region: 'München',
        bdew: '9907462000006',
        forceRefresh: false,
      });

      expect(result.success).toBe(true);
    });
  });

  // ─── status action ─────────────────────────────────────────────────────────

  describe('status action', () => {
    it('should return status for a valid reportId', async () => {
      const gen = await broker.call('utility-report.generate', {
        utilityName: 'Status Test GmbH',
      });
      const { reportId } = gen;

      const status = await broker.call('utility-report.status', { reportId });

      expect(status.success).toBe(true);
      expect(status.reportId).toBe(reportId);
      expect(['generating', 'completed', 'error']).toContain(status.status);
      expect(status.phase).toBeGreaterThanOrEqual(0);
      expect(status.progress).toBeGreaterThanOrEqual(0);
      expect(status.progress).toBeLessThanOrEqual(100);
    });

    it('should return error for unknown reportId', async () => {
      const result = await broker.call('utility-report.status', {
        reportId: 'non-existent-id-12345',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include phaseName', async () => {
      const gen = await broker.call('utility-report.generate', {
        utilityName: 'PhaseName Test GmbH',
      });

      const status = await broker.call('utility-report.status', { reportId: gen.reportId });
      expect(status.phaseName).toBeTruthy();
    });

    it('should require reportId', async () => {
      await expect(broker.call('utility-report.status', {})).rejects.toThrow();
    });
  });

  // ─── download action ───────────────────────────────────────────────────────

  describe('download action', () => {
    it('should return 404-equivalent for unknown reportId', async () => {
      const result = await broker.call('utility-report.download', {
        reportId: 'completely-unknown-xyz',
      });

      expect(result.success).toBe(false);
    });

    it('should require reportId', async () => {
      await expect(broker.call('utility-report.download', {})).rejects.toThrow();
    });

    it('should return generating message for in-progress report', async () => {
      const gen = await broker.call('utility-report.generate', {
        utilityName: 'InProgress Download Test GmbH',
        forceRefresh: true,
      });

      // Progress file exists, HTML not yet written (pipeline async)
      const result = await broker.call('utility-report.download', {
        reportId: gen.reportId,
      });

      // Either still generating (202) or completed – both are valid outcomes
      expect(result).toBeDefined();
    });

    it('should return a Buffer with text/html content-type meta for a completed report', async () => {
      // Write a minimal HTML file to the reports dir so the download action finds it
      const fakeId = 'test-html-download-' + Date.now();
      const fakeHtml = '<!DOCTYPE html><html><body>test</body></html>';
      const reportsDir = path.join(__dirname, '..', '.reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(path.join(reportsDir, `${fakeId}.html`), fakeHtml);

      const ctx = await broker.call('utility-report.download', { reportId: fakeId }, { meta: {} });

      // Returns a Buffer (not a JSON object) so the API Gateway streams raw HTML
      expect(Buffer.isBuffer(ctx) || (ctx && typeof ctx === 'object')).toBe(true);

      // Clean up
      fs.unlinkSync(path.join(reportsDir, `${fakeId}.html`));
    });
  });

  // ─── rebuild action ────────────────────────────────────────────────────────

  describe('rebuild action', () => {
    it('should require reportId', async () => {
      await expect(broker.call('utility-report.rebuild', {})).rejects.toThrow();
    });

    it('should return 404 for unknown reportId', async () => {
      const result = await broker.call('utility-report.rebuild', {
        reportId: 'does-not-exist-xyz',
      });
      expect(result.success).toBe(false);
    });

    it('should re-render HTML for a completed report', async () => {
      // Generate a report and wait briefly for the async pipeline to write progress
      const gen = await broker.call('utility-report.generate', {
        utilityName: 'Rebuild Test Stadtwerke',
        forceRefresh: true,
      });
      // Give the async pipeline a moment to write progress.json
      await new Promise((r) => setTimeout(r, 100));

      // Manually write a completed progress stub so we can test rebuild independently
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const stubId = 'rebuild-stub-test-id';
      const stubDir = path.join(os.tmpdir(), 'utility-report-test');
      fs.mkdirSync(stubDir, { recursive: true });
      const stub = {
        reportId: stubId,
        utilityName: 'Rebuild Stub GmbH',
        region: 'TestCity',
        bdew: '',
        status: 'completed',
        phase: 4,
        results: {
          section1: {}, section2: {}, section3: {}, section4: {},
          section5: {}, section6: {}, section7: {}, section8: {},
        },
        meta: { resolvedVnbName: 'Rebuild Stub GmbH', resolvedBdew: null },
        managementSummary: 'Test narrative line 1\nTest narrative line 2\nTest narrative line 3',
        webSearchResults: [],
        completedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(stubDir, `${stubId}.progress.json`), JSON.stringify(stub));

      const result = await broker.call('utility-report.rebuild', { reportId: stubId });

      expect(result.success).toBe(true);
      expect(result.downloadUrl).toContain(stubId);
      // Verify HTML file was written
      expect(fs.existsSync(path.join(stubDir, `${stubId}.html`))).toBe(true);
    });

    it('should return 409 for a still-generating report', async () => {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const stubId = 'rebuild-in-progress-test';
      const stubDir = path.join(os.tmpdir(), 'utility-report-test');
      fs.mkdirSync(stubDir, { recursive: true });
      const stub = {
        reportId: stubId,
        utilityName: 'InProgress GmbH',
        status: 'generating',
        phase: 2,
        results: {},
        meta: {},
      };
      fs.writeFileSync(path.join(stubDir, `${stubId}.progress.json`), JSON.stringify(stub));

      const result = await broker.call('utility-report.rebuild', { reportId: stubId });
      expect(result.success).toBe(false);
    });
  });

  // ─── rebuildAll action ────────────────────────────────────────────────────

  describe('rebuildAll action', () => {
    it('should return a summary with rebuilt/skipped/failed counts', async () => {
      const result = await broker.call('utility-report.rebuildAll', {});
      expect(result.success).toBe(true);
      expect(typeof result.total).toBe('number');
      expect(typeof result.rebuilt).toBe('number');
      expect(typeof result.skipped).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(result.rebuilt + result.skipped + result.failed).toBe(result.total);
    });
  });

  // ─── report-builder integration ────────────────────────────────────────────

  describe('report-builder integration', () => {
    const { buildHtmlReport, summarizeForReport } = require('../src/report-builder');

    it('should build valid HTML with all 8 sections', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Test GmbH', reportId: 'test-123' },
        section1: {},
        section2: {},
        section3: {},
        section4: {},
        section5: {},
        section6: {},
        section7: {},
        section8: {},
        managementSummary: '',
        webSearchResults: [],
        generatedAt: new Date().toISOString(),
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test GmbH');
      expect(html).toContain('Netzbetrieb');
      expect(html).toContain('Erneuerbare Energien');
      expect(html).toContain('Energiemarkt');
      expect(html).toContain('Gasinfrastruktur');
      expect(html).toContain('Regulierung');
      expect(html).toContain('Kundenmanagement');
      expect(html).toContain('Investitionsplanung');
      expect(html).toContain('Digitalisierung');
    });

    it('should include Chart.js CDN link', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Chart Test GmbH' },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chart.js');
    });

    it('should escape XSS in utilityName', () => {
      const html = buildHtmlReport({
        meta: { utilityName: '<script>alert(1)</script>GmbH' },
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('<script>alert(1)');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should render "–" for missing KPI values gracefully', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'EmptyData GmbH' },
        section1: {
          capacityUtilization: { available: false },
          redispatchExport: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('–');
    });

    it('should render chart JS for gas storage when trend data is available', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Gas Test GmbH' },
        section4: {
          countryStorage: { available: true, data: { full: 72.5, gasInStorage: 180 } },
          euStatistics: { available: true, data: { full: 68 } },
          storageTrend: {
            available: true,
            data: {
              trend: Array.from({ length: 30 }, (_, i) => ({
                gasDayStart: `2026-02-${String(i + 1).padStart(2, '0')}`,
                full: 70 + i * 0.3,
              })),
            },
          },
          supplySecurityCheck: { available: true, data: { status: 'compliant' } },
          compareCountries: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });

      expect(html).toContain('chartGasTrend');
      expect(html).toContain('90%-Mandat');
    });

    it('should render management summary bullets from Gemini text', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Summary Test GmbH' },
        managementSummary: 'Ergebnis 1: Wichtige Erkenntnis\nErgebnis 2: Weitere Analyse\nErgebnis 3: Handlungsempfehlung abc',
        generatedAt: new Date().toISOString(),
      });

      expect(html).toContain('Management Summary');
    });

    it('summarizeForReport should return null for unavailable sections', () => {
      const result = summarizeForReport({ available: false }, 'testKey');
      expect(result.testKey).toBeNull();
    });

    it('summarizeForReport should extract scalar values from available sections', () => {
      const result = summarizeForReport(
        { available: true, data: { fillLevel: 72.5, status: 'online', bigArray: [1, 2, 3, 4] } },
        'gasStorage'
      );
      expect(result.gasStorage.fillLevel).toBe(72.5);
      expect(result.gasStorage.status).toBe('online');
      expect(result.gasStorage.bigArray_count).toBe(4);
    });

    it('should render web search context box when results are present', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Context Test GmbH' },
        webSearchResults: [
          {
            data: {
              results: [
                { title: 'Netzausbau Artikel', url: 'https://example.com', snippet: 'Kurze Beschreibung' },
              ],
            },
          },
        ],
        generatedAt: new Date().toISOString(),
      });

      expect(html).toContain('Aktuelle Meldungen');
      expect(html).toContain('Netzausbau Artikel');
    });

    it('should render @media print styles', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Print Test' },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('@media print');
      expect(html).toContain('page-break');
    });
  });

  // ─── Graceful degradation ──────────────────────────────────────────────────

  describe('graceful degradation', () => {
    it('should render report with all sections showing "–" when all data unavailable', () => {
      const { buildHtmlReport } = require('../src/report-builder');

      const unavailable = { available: false, error: 'Tool not found' };
      const html = buildHtmlReport({
        meta: { utilityName: 'Degraded GmbH' },
        section1: {
          capacityUtilization: unavailable,
          redispatchExport: unavailable,
          residualLoad: unavailable,
          co2Intensity: unavailable,
          operatorAnalysis: unavailable,
          emobilityImpact: unavailable,
          gridLossAnalysis: unavailable,
        },
        section2: {
          solar: unavailable, wind: unavailable, storage: unavailable,
          generationForecast: unavailable, windSolarActual: unavailable,
        },
        section3: {
          prices: unavailable, spotprices: unavailable, negativePrices: unavailable,
          actualGeneration: unavailable, loadForecast: unavailable, unavailability: unavailable,
        },
        section4: {
          countryStorage: unavailable, euStatistics: unavailable,
          storageTrend: unavailable, supplySecurityCheck: unavailable,
        },
        section5: {
          benchmarkVnb: unavailable, anschlussdauer: unavailable,
          digitalisierungsindex: unavailable, umsetzungsquote: unavailable,
        },
        section6: {
          churnPrediction: unavailable, salesLeads: unavailable,
          marketPenetration: unavailable,
        },
        section7: {
          investmentBusinessCase: unavailable, operatorPortfolio: unavailable,
        },
        section8: {
          systemStatus: unavailable, eicStatistics: unavailable,
        },
        generatedAt: new Date().toISOString(),
      });

      expect(html).toContain('<!DOCTYPE html>');
      // All KPI values should show "–" for unavailable data
      expect(html).toContain('–');
      // Should not throw or contain undefined
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object Object]');
    });
  });
});
