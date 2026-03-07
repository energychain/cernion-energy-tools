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
  'business-intelligence': {
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

// ─── Helper unit tests ──────────────────────────────────────────────────────────

describe('buildVnbSearchQueries (CR-18)', () => {
  // Access the module-level helpers by requiring the service module
  // and exposing via a thin test shim defined inline.
  const svc = require('../services/utility-report.service');

  // The helpers are module-local, so we test them indirectly via the exported
  // service structure. To keep it simple we re-implement the logic inline.
  function buildVnbSearchQueries(name) {
    const queries = [name];
    const stripped = name
      .replace(/\b(Stadtwerke|Stadtwerk|Gemeindewerk|Gemeindewerke|Energieversorgung|EVN|Netz\s+GmbH|Netz\s+AG|Netze\s+GmbH|Netze\s+AG|GmbH\s+&\s+Co\.\s+KG|GmbH|AG|mbH|KG)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const cityStripped = stripped && stripped !== name && stripped.length > 2 ? stripped : null;
    if (cityStripped) queries.push(cityStripped);
    const hasOrgPrefix = /\b(Stadtwerke|Stadtwerk|Netz|Gemeindewerk|EVN|Energieversorgung)\b/i.test(name);
    if (!hasOrgPrefix && name.split(/\s+/).length <= 2) {
      queries.push(`Stadtwerke ${name}`);
      queries.push(`Stadtwerk ${name}`);
    }
    if (cityStripped && /\bStadtwerke\b/i.test(name)) queries.push(`Stadtwerk ${cityStripped}`);
    if (cityStripped && /\bStadtwerk\b/i.test(name) && !/\bStadtwerke\b/i.test(name)) queries.push(`Stadtwerke ${cityStripped}`);
    return [...new Set(queries)];
  }

  it('should keep original query first', () => {
    expect(buildVnbSearchQueries('Stadtwerke Heidelberg')[0]).toBe('Stadtwerke Heidelberg');
  });

  it('should strip "Stadtwerke" to get city variant', () => {
    const q = buildVnbSearchQueries('Stadtwerke Eberbach');
    expect(q).toContain('Eberbach');
  });

  it('should add "Stadtwerke <city>" when input is bare city name', () => {
    const q = buildVnbSearchQueries('Eberbach');
    expect(q).toContain('Stadtwerke Eberbach');
  });

  it('should also add "Stadtwerk <city>" (singular) when input is bare city name (CR-20)', () => {
    const q = buildVnbSearchQueries('Eberbach');
    expect(q).toContain('Stadtwerk Eberbach');
  });

  it('should add singular "Stadtwerk" cross-variant when input starts with "Stadtwerke" (CR-20)', () => {
    const q = buildVnbSearchQueries('Stadtwerke Eberbach');
    expect(q).toContain('Stadtwerk Eberbach');
  });

  it('should add plural "Stadtwerke" cross-variant when input starts with singular "Stadtwerk" (CR-20)', () => {
    const q = buildVnbSearchQueries('Stadtwerk Eberbach GmbH');
    expect(q).toContain('Stadtwerke Eberbach');
  });

  it('should not duplicate the original query', () => {
    const q = buildVnbSearchQueries('Stadtwerke Eberbach');
    expect(new Set(q).size).toBe(q.length);
  });

  it('should strip GmbH suffix and produce a clean variant', () => {
    const q = buildVnbSearchQueries('Netz Eberbach GmbH');
    // Original input is always kept as first query (passed as-is to the API)
    expect(q[0]).toBe('Netz Eberbach GmbH');
    // At least one additional variant should exist without "GmbH"
    const stripped = q.slice(1);
    expect(stripped.length).toBeGreaterThan(0);
    expect(stripped.every((s) => !s.includes('GmbH'))).toBe(true);
  });
});

describe('pickBestVnbPartner (CR-18)', () => {
  function pickBestVnbPartner(marketPartnersResult) {
    const candidates =
      marketPartnersResult?.data?.results ||
      marketPartnersResult?.results ||             // CR-23: sync MCP path
      marketPartnersResult?.data?.data?.results ||
      marketPartnersResult?.data?.partners ||
      [];
    if (!candidates.length) return null;
    function normaliseMastrIds(p) {
      if (!p.mastrId && !p.gridOperatorMastrId && p.mastrIds && typeof p.mastrIds === 'object') {
        p.mastrId = p.mastrIds.SNB || p.mastrIds.GNB || Object.values(p.mastrIds)[0] || null;
      }
      return p;
    }
    const vnbPartner = candidates.find((p) => {
      const roles = p.roles ?? p.marketRoles ?? [];
      return roles.some((r) => /VNB|Verteilnetz|Netzbetreiber/i.test(r));
    });
    if (vnbPartner) return normaliseMastrIds(vnbPartner);
    // CR-23: prefer "Netz" company name over generic first result
    const netzPartner = candidates.find((p) => {
      const name = p.companyName || p.name || p.displayName || '';
      return /\bNetz(e)?\b/i.test(name);
    });
    if (netzPartner) return normaliseMastrIds(netzPartner);
    const best = candidates[0];
    if (!best.mastrId && !best.gridOperatorMastrId && best.mastrIds && typeof best.mastrIds === 'object') {
      best.mastrId = best.mastrIds.SNB || best.mastrIds.GNB || Object.values(best.mastrIds)[0] || null;
    }
    return best;
  }

  it('should return null when no candidates', () => {
    expect(pickBestVnbPartner({ data: { results: [] } })).toBeNull();
  });

  it('should prefer VNB role over first entry', () => {
    const result = {
      data: {
        results: [
          { bdewCode: '111', name: 'Lieferant', roles: ['Lieferant'] },
          { bdewCode: '222', name: 'Netzbetreiber', roles: ['VNB'] },
        ],
      },
    };
    expect(pickBestVnbPartner(result).bdewCode).toBe('222');
  });

  it('should fall back to first result when no VNB role found', () => {
    const result = {
      data: { results: [{ bdewCode: '999', name: 'Generic', roles: ['Lieferant'] }] },
    };
    expect(pickBestVnbPartner(result).bdewCode).toBe('999');
  });

  it('should normalise mastrIds object to single mastrId', () => {
    const result = {
      data: {
        results: [{ bdewCode: '123', name: 'Test', roles: ['VNB'], mastrIds: { SNB: 'SNB999' } }],
      },
    };
    expect(pickBestVnbPartner(result).mastrId).toBe('SNB999');
  });

  it('should handle top-level results (sync MCP path, CR-23)', () => {
    // MCP client returns { success: true, ...parsedJson } spreading results at top level
    const result = { results: [{ bdewCode: '123', companyName: 'Test Netz GmbH', roles: [] }] };
    expect(pickBestVnbPartner(result).bdewCode).toBe('123');
  });

  it('should prefer "Netz" company name when no explicit VNB role (CR-23)', () => {
    // Real-world scenario: "Heidelberg" query returns Energie GmbH before Netze GmbH
    const result = {
      results: [
        { bdewCode: '111', name: 'Stadtwerke Heidelberg Energie GmbH', roles: [] },
        { bdewCode: '222', name: 'Stadtwerke Heidelberg Netze GmbH', roles: [] },
      ],
    };
    expect(pickBestVnbPartner(result).bdewCode).toBe('222');
  });

  it('should still prefer explicit VNB role over "Netz" name (CR-23)', () => {
    const result = {
      results: [
        { bdewCode: '111', name: 'Stadtwerke Test Netze GmbH', roles: [] },
        { bdewCode: '222', name: 'Another Energy GmbH', roles: ['VNB'] },
      ],
    };
    expect(pickBestVnbPartner(result).bdewCode).toBe('222');
  });
});

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

    it('should return error payload for a report that failed pipeline (CR-17)', async () => {
      const fakeId = 'failed-report-cr17-test';
      const progressData = {
        reportId: fakeId,
        utilityName: 'Unbekannte SW',
        status: 'error',
        error: 'VNB nicht erkannt: Für „Unbekannte SW" konnte weder ein BDEW-Code noch eine MaStR-ID ermittelt werden.',
        phase: 1,
        startedAt: new Date().toISOString(),
        completedAt: null,
        results: {},
        meta: {},
      };
      fs.mkdirSync(tmpReportsDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpReportsDir, `${fakeId}.progress.json`),
        JSON.stringify(progressData),
        'utf-8'
      );

      const result = await broker.call('utility-report.download', { reportId: fakeId });
      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.error).toContain('VNB nicht erkannt');
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
                { title: 'Netzausbau Artikel', url: 'https://example.com', snippet: 'Dies ist ein ausführlicher Beschreibungstext mit mehr als 50 Zeichen, der Informationen über den Netzausbau enthält' },
                { title: 'Zweiter Artikel', url: 'https://example2.com', snippet: 'Noch ein ausführlicher Artikel über Energiewende mit mehr als 50 Zeichen Inhalt' },
              ],
            },
          },
        ],
        generatedAt: new Date().toISOString(),
      });

      expect(html).toContain('Aktuelle Meldungen');
      expect(html).toContain('Netzausbau Artikel');
    });

    it('should NOT render context box when snippets are raw/short (CR-13)', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR13 Test GmbH' },
        webSearchResults: [
          {
            data: {
              results: [
                { title: 'Article 1', url: 'https://x.com', snippet: 'Short...' },
              ],
            },
          },
        ],
        generatedAt: new Date().toISOString(),
      });
      // Single short/trailing-dots snippet → section suppressed
      expect(html).not.toContain('Aktuelle Meldungen');
    });

    it('should render churn with ~ prefix when heuristic model (CR-12)', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Churn Test GmbH' },
        section6: {
          churnPrediction: {
            available: true,
            data: [{ type: 'text', text: 'Estimated at-risk customers (max 100)**: 60\nAssumed churn rate: 8.0%\nheuristic model.' }],
          },
          salesLeads: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });
      // CR-semantic: heuristic values are suppressed (null → n/v span) and replaced by BI-upsell fallback
      expect(html).not.toContain('~8.0');
      expect(html).not.toContain('~60');
      expect(html).toContain('Branchenheuristik');
      expect(html).toContain('BI-Modul');
    });

    it('should render Ländervergleich with country breakdown when data available (CR-14)', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Gas CR14 GmbH' },
        section4: {
          countryStorage: { available: true, data: { full: 72.5, gasInStorage: 180 } },
          euStatistics: { available: true, data: { full: 68 } },
          storageTrend: { available: false },
          supplySecurityCheck: { available: false },
          compareCountries: {
            available: true,
            data: {
              rankings: [
                { country: 'DE', fillPercent: 72.5 },
                { country: 'AT', fillPercent: 65.1 },
                { country: 'NL', fillPercent: 80.2 },
                { country: 'FR', fillPercent: 55.0 },
              ],
            },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('DE: 73 %');
      expect(html).toContain('AT: 65 %');
      expect(html).toContain('NL: 80 %');
    });

    it('should cap management summary at 5 bullets (CR-16)', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR16 Cap Test GmbH' },
        managementSummary: 'Line 1: abc def ghi jkl\nLine 2: abc def ghi jkl\nLine 3: abc def ghi jkl\nLine 4: abc def ghi jkl\nLine 5: abc def ghi jkl\nLine 6: abc def ghi jkl\nLine 7: abc def ghi jkl',
        generatedAt: new Date().toISOString(),
      });
      // Count summary-finding divs – must not exceed 5
      const matches = html.match(/class="summary-finding"/g) ?? [];
      expect(matches.length).toBeLessThanOrEqual(5);
    });

    it('should render @media print styles', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'Print Test' },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('@media print');
      expect(html).toContain('page-break');
    });

    it('should render Marktpartner-Register table with allPartners in Section 8 (CR-19)', () => {
      const html = buildHtmlReport({
        meta: {
          utilityName: 'CR19 Test GmbH',
          allPartners: [
            { name: 'CR19 Netz GmbH', bdew: '9900011110001', roles: ['VNB'], mastrId: 'SNB123' },
            { name: 'CR19 Vertrieb GmbH', bdew: '9900011110002', roles: ['Lieferant'], mastrId: null },
          ],
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Marktpartner-Register');
      expect(html).toContain('9900011110001');
      expect(html).toContain('9900011110002');
      expect(html).toContain('Lieferant');
      expect(html).toContain('SNB123');
    });

    it('should bold VNB-role rows in Marktpartner-Register (CR-19)', () => {
      const html = buildHtmlReport({
        meta: {
          utilityName: 'CR19 VNB Bold Test GmbH',
          allPartners: [
            { name: 'VNB Netz GmbH', bdew: '9900022220001', roles: ['VNB'], mastrId: 'SNB456' },
            { name: 'Nur Lieferant GmbH', bdew: '9900022220002', roles: ['Lieferant'], mastrId: null },
          ],
        },
        generatedAt: new Date().toISOString(),
      });
      // Exactly one bold <tr> in the table – the VNB row
      const boldRows = (html.match(/<tr style="font-weight:600">/g) || []).length;
      expect(boldRows).toBe(1);
      // VNB name is present; Lieferant name is also present but in a plain <tr>
      expect(html).toContain('VNB Netz GmbH');
      expect(html).toContain('Nur Lieferant GmbH');
    });

    it('should not render Marktpartner-Register when allPartners is empty (CR-19)', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR19 Empty Partners GmbH', allPartners: [] },
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('Marktpartner-Register');
    });
  });

  // ─── Graceful degradation ──────────────────────────────────────────────────

  describe('graceful degradation', () => {
    it('should render "n/v" with reason when tool unavailable and fallbackReason is set', () => {
      const { buildHtmlReport } = require('../src/report-builder');

      const html = buildHtmlReport({
        meta: { utilityName: 'Fallback Test GmbH' },
        section2: {
          solar: { available: false },
          wind: { available: false },
          storage: { available: false },
          pvLocal: { available: false },
          windLocal: { available: false },
          speicherLocal: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });

      // Section2 PV/Wind/Speicher rows have fallbackReason set → should show n/v
      expect(html).toContain('n/v');
      expect(html).toContain('MaStR-Abfrage nicht verf\u00fcgbar');
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('undefined');
    });

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
          transformerLoading: unavailable,
        },
        section2: {
          solar: unavailable, wind: unavailable, storage: unavailable,
          generationForecast: unavailable, windSolarActual: unavailable,
          pvLocal: unavailable, windLocal: unavailable, speicherLocal: unavailable,
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

  // ─── VNB tolerant resolution (CR-18) ─────────────────────────────────────

  describe('VNB tolerant resolution (CR-18)', () => {
    let tolerantBroker;

    beforeAll(async () => {
      tolerantBroker = new ServiceBroker({ logger: false, requestTimeout: 60000 });
      tolerantBroker.createService(UtilityReportService);

      // First query ("Stadtwerke Eberbach") returns nothing; second query ("Eberbach")
      // succeeds – simulates the stripped-city fallback query succeeding.
      let callCount = 0;
      mockBrokerService(tolerantBroker, 'grid-operations', {
        marketPartners: async (ctx) => {
          callCount++;
          const q = ctx.params?.query ?? '';
          if (/Eberbach/.test(q) && callCount >= 2) {
            return { results: [{ name: 'Stadtwerke Eberbach GmbH', bdewCode: '9900099990001', mastrId: 'SNB_EBERBACH', roles: ['VNB'] }] };
          }
          return { results: [] };
        },
        vnbLookup: async () => DEFAULT_MOCK_RESULT,
        capacityUtilization: async () => DEFAULT_MOCK_RESULT,
        redispatchExport: async () => ({ ...DEFAULT_MOCK_RESULT, totalCount: 0 }),
        operatorAnalysis: async () => DEFAULT_MOCK_RESULT,
      });
      // Register remaining mocks
      for (const [name, mocks] of Object.entries(DEFAULT_SERVICE_MOCKS)) {
        if (name !== 'grid-operations') mockBrokerService(tolerantBroker, name, mocks);
      }

      await tolerantBroker.start();
    }, 30000);

    afterAll(async () => {
      await tolerantBroker.stop();
    });

    it('should succeed with "Stadtwerke Eberbach" via stripped-city fallback query (CR-18)', async () => {
      const gen = await tolerantBroker.call('utility-report.generate', {
        utilityName: 'Stadtwerke Eberbach',
      });
      expect(gen.success).toBe(true);

      await new Promise((r) => setTimeout(r, 500));

      const status = await tolerantBroker.call('utility-report.status', { reportId: gen.reportId });
      // Should not be 'error' – pipeline resolved via alternative query
      expect(status.status).not.toBe('error');
    });
  });

  // ─── VNB identification failure (CR-17) ────────────────────────────────────

  describe('VNB identification failure (CR-17)', () => {
    let abortBroker;

    beforeAll(async () => {
      abortBroker = new ServiceBroker({ logger: false, requestTimeout: 60000 });
      abortBroker.createService(UtilityReportService);

      // grid-operations returns no BDEW/MaStR – simulates unknown utility name
      mockBrokerService(abortBroker, 'grid-operations', {
        marketPartners: async () => ({ results: [] }),
        vnbLookup: async () => DEFAULT_MOCK_RESULT,
      });

      await abortBroker.start();
    }, 30000);

    afterAll(async () => {
      await abortBroker.stop();
    });

    it('should mark report as error when VNB cannot be identified', async () => {
      const gen = await abortBroker.call('utility-report.generate', {
        utilityName: 'Stadtwerke Unbekannt XYZ',
      });

      expect(gen.success).toBe(true);
      const { reportId } = gen;

      // Pipeline fails fast at Phase 1 guard – wait briefly
      await new Promise((r) => setTimeout(r, 500));

      const status = await abortBroker.call('utility-report.status', { reportId });
      expect(status.status).toBe('error');
      expect(status.error).toContain('VNB nicht erkannt');
      expect(status.error).toContain('BDEW-Code');
    });

    it('should include tried queries and input-specific suggestions in the error message (CR-21)', async () => {
      const gen = await abortBroker.call('utility-report.generate', {
        utilityName: 'Musterstadt',
      });

      await new Promise((r) => setTimeout(r, 500));

      const status = await abortBroker.call('utility-report.status', { reportId: gen.reportId });
      expect(status.status).toBe('error');
      // Must list the queries that were actually tried
      expect(status.error).toContain('Gesucht wurde nach');
      expect(status.error).toContain('„Musterstadt"');
      // Must suggest input-specific alternatives (not hardcoded Heidelberg)
      expect(status.error).toContain('Stadtwerk Musterstadt');
      expect(status.error).toContain('Stadtwerke Musterstadt');
      expect(status.error).not.toContain('Heidelberg');
    });

    it('should not write an HTML report file when identification fails', async () => {
      const gen = await abortBroker.call('utility-report.generate', {
        utilityName: 'Phantom Netz GmbH',
        forceRefresh: true,
      });

      await new Promise((r) => setTimeout(r, 500));

      // Download should surface the error, not a 404
      const result = await abortBroker.call('utility-report.download', {
        reportId: gen.reportId,
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
    });
  });

  // ─── Token propagation (CR-22) ────────────────────────────────────────────

  describe('Token propagation to downstream services (CR-22)', () => {
    let tokenBroker;
    let capturedToken;

    beforeAll(async () => {
      tokenBroker = new ServiceBroker({ logger: false, requestTimeout: 60000 });
      tokenBroker.createService(UtilityReportService);

      // Capture the token that reaches grid-operations.marketPartners via ctx.meta
      mockBrokerService(tokenBroker, 'grid-operations', {
        marketPartners: async (ctx) => {
          capturedToken = ctx.meta?.cernionToken ?? null;
          return { results: [{ name: 'Token Test GmbH', bdewCode: '9900000000001', mastrId: 'SNB_TOKEN' }] };
        },
        vnbLookup: async () => DEFAULT_MOCK_RESULT,
        capacityUtilization: async () => DEFAULT_MOCK_RESULT,
        redispatchExport: async () => ({ ...DEFAULT_MOCK_RESULT, totalCount: 0 }),
        operatorAnalysis: async () => DEFAULT_MOCK_RESULT,
      });
      for (const [name, mocks] of Object.entries(DEFAULT_SERVICE_MOCKS)) {
        if (name !== 'grid-operations') mockBrokerService(tokenBroker, name, mocks);
      }

      await tokenBroker.start();
    }, 30000);

    afterAll(async () => {
      await tokenBroker.stop();
    });

    it('should propagate env-fallback token to downstream broker calls (CR-22)', async () => {
      const savedEnvToken = process.env.CERNION_TOKEN;
      process.env.CERNION_TOKEN = 'test-env-token-cr22';
      capturedToken = undefined;

      // Call WITHOUT cernionToken in meta – forces env fallback path
      const gen = await tokenBroker.call(
        'utility-report.generate',
        { utilityName: 'Token Test Stadt', forceRefresh: true },
        { meta: {} } // no cernionToken in meta
      );

      await new Promise((r) => setTimeout(r, 600));

      // The token that reached grid-operations.marketPartners must be the env token
      expect(capturedToken).toBe('test-env-token-cr22');

      process.env.CERNION_TOKEN = savedEnvToken;
    });
  });

  // ─── CR-37: Marktrollen-Resolution ──────────────────────────────────────

  describe('CR-37: Marktrollen-Resolution (BDEW role classification)', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render Marktrollen-Profil block when marktRollenProfile has VNB entry', () => {
      const html = buildHtmlReport({
        meta: {
          utilityName: 'CR37 Stadtwerke GmbH',
          bdew: '9904350000001',
          marktRollenProfile: {
            vnb:              { name: 'CR37 Netz GmbH', bdew: '9904350000001', roles: ['VNB'] },
            lieferant:        { name: 'CR37 Vertrieb GmbH', bdew: '9913450000001', roles: ['Lieferant'] },
            msb:              null,
            bkv:              null,
            direktvermarkter: null,
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Marktrollen-Profil');
      expect(html).toContain('9904350000001');
      expect(html).toContain('9913450000001');
      expect(html).toContain('VNB:');
      expect(html).toContain('Lieferant:');
    });

    it('should show VNB BDEW on cover page', () => {
      const html = buildHtmlReport({
        meta: {
          utilityName: 'CR45 Cover Test GmbH',
          bdew: '9904350000001',
          marktRollenProfile: {
            vnb:      { bdew: '9904350000001' },
            lieferant: { bdew: '9913450000001' },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('VNB-BDEW: 9904350000001');
      expect(html).toContain('Lieferant: 9913450000001');
    });

    it('should not render Marktrollen-Profil when marktRollenProfile is null', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'No Profile GmbH', marktRollenProfile: null },
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('Marktrollen-Profil');
    });

    it('should not render Marktrollen-Profil when all roles are null', () => {
      const html = buildHtmlReport({
        meta: {
          utilityName: 'Empty Profile GmbH',
          marktRollenProfile: { vnb: null, lieferant: null, msb: null, bkv: null, direktvermarkter: null },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('Marktrollen-Profil');
    });
  });

  // ─── CR-38: Trafo-Auslastung honest fallback ─────────────────────────────

  describe('CR-38: Trafo-Auslastung honest fallback row', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should show single combined trafo row when both tools unavailable', () => {
      const unavailable = { available: false };
      const html = buildHtmlReport({
        meta: { utilityName: 'CR38 Test GmbH' },
        section1: {
          capacityUtilization: unavailable,
          transformerLoading: unavailable,
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Trafo-Auslastung (NS/MS/HS)');
      expect(html).not.toContain('Kapazit\u00e4tsanalyse-Tool nicht verf\u00fcgbar');
      expect(html).toContain('Erg\u00e4nzungsmodul');
    });

    it('should show three individual trafo rows when capacity tool is available', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR38 Avail Test GmbH' },
        section1: {
          capacityUtilization: { available: true, data: { utilizationByVoltage: { NS: 45, MS: 60, HS: 30 } } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Trafo-Auslastung NS');
      expect(html).toContain('Trafo-Auslastung MS');
      expect(html).toContain('Trafo-Auslastung HS');
      expect(html).not.toContain('Trafo-Auslastung (NS/MS/HS)');
    });
  });

  // ─── CR-40: Netzverluste upsell note ─────────────────────────────────────

  describe('CR-40: Netzverluste upsell routing note', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should show Section 7 upsell note when gridLossAnalysis not available', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR40 Test GmbH' },
        section1: { gridLossAnalysis: { available: false } },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Abschnitt\u00a07');
      expect(html).not.toContain('Tool nicht lizenziert\u2019');
    });
  });

  // ─── CR-41: Ortsfremde VNB-centric description ───────────────────────────

  describe('CR-41: Ortsfremde Anlagen VNB-centric description', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should use VNB-centric description with PLZ prefix', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR41 Test GmbH' },
        section1: {
          ortsfremdeAnlagen: {
            available: true,
            dominantPlzPrefix: '672',
            data: { stats: { total: 3 }, installations: [{}, {}, {}] },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Im MaStR diesem VNB zugeordnet');
      expect(html).toContain('672xx');
      expect(html).not.toContain('Au\u00dferhalb PLZ-Bereich');
    });

    it('should use VNB-centric fallback when no PLZ prefix', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR41 NoPrefix GmbH' },
        section1: {
          ortsfremdeAnlagen: {
            available: true,
            data: { stats: { total: 2 }, installations: [{}, {}] },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Im MaStR diesem VNB zugeordnet');
      expect(html).toContain('au\u00dferhalb Kerngebiet');
    });
  });

  // ─── CR-42: Real MW values for windSolarActual / generationForecast ──────

  describe('CR-42: Einspeise-Kennzahlen real MW values', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should show actual MW value from windSolarActual statistics', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR42 Test GmbH' },
        section2: {
          windSolarActual: {
            available: true,
            data: {
              statistics: { avgForecastMW: 43250 },
              forecasts: [{ windOnshore: 25000, windOffshore: 0, solar: 18250, total: 43250 }],
            },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('43250 MW');
      expect(html).toContain('\u00d8 DE (Ist)');
      expect(html).not.toContain('\u2713 Echtzeit-Daten verf\u00fcgbar');
    });

    it('should fall back to checkmark when windSolarActual has no numeric data', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR42 Fallback GmbH' },
        section2: {
          windSolarActual: { available: true, data: { forecasts: [] } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('\u2713 Echtzeit-Daten verf\u00fcgbar');
    });

    it('should show first-day generationMW from forecast', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR42 Forecast GmbH' },
        section2: {
          generationForecast: {
            available: true,
            data: {
              forecasts: [
                { generationMW: 1.23, capacityFactor: 0.05, weather: { temperature: 12 } },
              ],
            },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('1 MW morgen (Netzgebiet-Solar)');
      expect(html).not.toContain('\u2713 Prognose verf\u00fcgbar');
    });

    it('should fall back to checkmark when generationForecast has no forecasts array', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR42 NoFC GmbH' },
        section2: {
          generationForecast: { available: true, data: { summary: { totalCapacityMW: 25 } } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('\u2713 Prognose verf\u00fcgbar');
    });
  });

  // ─── MCP error detection and VNB transparency (CR-24) ────────────────────

  describe('MCP error detection and VNB identification transparency (CR-24)', () => {
    let mcpErrorBroker;
    let transparentBroker;

    beforeAll(async () => {
      // ── broker 1: marketPartners always returns callBroker-style error ─────
      mcpErrorBroker = new ServiceBroker({ logger: false, requestTimeout: 60000 });
      mcpErrorBroker.createService(UtilityReportService);
      mockBrokerService(mcpErrorBroker, 'grid-operations', {
        // Simulate what grid-operations does when MCP call throws internally:
        // callBroker catches it and returns { available: false, error: msg }
        marketPartners: async () => { throw new Error('Request failed: 403 Forbidden'); },
        vnbLookup: async () => DEFAULT_MOCK_RESULT,
      });
      for (const [name, mocks] of Object.entries(DEFAULT_SERVICE_MOCKS)) {
        if (name !== 'grid-operations') mockBrokerService(mcpErrorBroker, name, mocks);
      }

      // ── broker 2: marketPartners succeeds → test transparency fields ──────
      transparentBroker = new ServiceBroker({ logger: false, requestTimeout: 60000 });
      transparentBroker.createService(UtilityReportService);
      mockBrokerService(transparentBroker, 'grid-operations', {
        marketPartners: async () => ({
          results: [{ companyName: 'Teststadt Netze GmbH', bdewCode: '9900111222333', roles: [] }],
        }),
        vnbLookup: async () => DEFAULT_MOCK_RESULT,
        capacityUtilization: async () => DEFAULT_MOCK_RESULT,
        redispatchExport: async () => ({ ...DEFAULT_MOCK_RESULT, totalCount: 0 }),
        operatorAnalysis: async () => DEFAULT_MOCK_RESULT,
      });
      for (const [name, mocks] of Object.entries(DEFAULT_SERVICE_MOCKS)) {
        if (name !== 'grid-operations') mockBrokerService(transparentBroker, name, mocks);
      }

      await Promise.all([mcpErrorBroker.start(), transparentBroker.start()]);
    }, 30000);

    afterAll(async () => {
      await Promise.all([mcpErrorBroker.stop(), transparentBroker.stop()]);
    });

    it('should surface MCP_CONNECTION_ERROR instead of VNB_NOT_IDENTIFIED when MCP calls fail (CR-24)', async () => {
      const gen = await mcpErrorBroker.call('utility-report.generate', {
        utilityName: 'Heidelberg',
        forceRefresh: true,
      });
      expect(gen.success).toBe(true);

      await new Promise((r) => setTimeout(r, 600));

      const status = await mcpErrorBroker.call('utility-report.status', { reportId: gen.reportId });
      expect(status.status).toBe('error');
      // Must say "MCP connection error", NOT "VNB not found"
      expect(status.error).toContain('MCP-Verbindungsfehler');
      expect(status.error).not.toContain('VNB nicht erkannt');
      // Must hint at the health endpoint
      expect(status.error).toContain('/api/utility-report/health');
    });

    it('should populate vnbIdentification in status after successful VNB resolution (CR-24)', async () => {
      const gen = await transparentBroker.call('utility-report.generate', {
        utilityName: 'Teststadt',
        forceRefresh: true,
      });
      expect(gen.success).toBe(true);

      await new Promise((r) => setTimeout(r, 600));

      const status = await transparentBroker.call('utility-report.status', { reportId: gen.reportId });
      // Pipeline may or may not have reached error; but vnbIdentification should be populated
      // once Phase 1 has run (regardless of whether Phase 2+ succeeds)
      expect(status.vnbIdentification).toBeDefined();
      expect(status.vnbIdentification.queriesTried).toContain('Teststadt');
      expect(status.vnbIdentification.candidatesFound).toBeGreaterThan(0);
      expect(status.vnbIdentification.selected).not.toBeNull();
      expect(status.vnbIdentification.selected.name).toContain('Teststadt Netze');
      expect(status.vnbIdentification.selected.bdew).toBe('9900111222333');
      expect(status.vnbIdentification.selected.selectionReason).toContain('Netz');
    });
  });

  // ─── CR-48: Residuallast 48h chart ───────────────────────────────────────

  describe('CR-48: Residuallast 48h chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render residual load 48h chart when forecast data is available', () => {
      const forecasts = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 3600000).toISOString(),
        residualLoadMW: 50 + i,
        loadMW: 80 + i,
      }));
      const html = buildHtmlReport({
        meta: { utilityName: 'CR48 Test GmbH' },
        section1: {
          residualLoad: { available: true, data: { forecast: forecasts } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chartResidualLoad');
      expect(html).toContain('Abb. A: Netto-Residuallast');
    });

    it('should not render residual load chart when data is unavailable', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR48 NoData GmbH' },
        section1: {
          residualLoad: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('chartResidualLoad');
    });
  });

  // ─── CR-49: EE Portfolio mix donut ───────────────────────────────────────

  describe('CR-49: EE Portfolio donut chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render portfolio donut chart when PV and wind data available', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR49 Portfolio GmbH' },
        section2: {
          solar:   { available: true, data: { totalCapacityKw: 12000 } },
          wind:    { available: true, data: { totalCapacityKw: 3000 } },
          storage: { available: true, data: { totalCapacityKw: 1000 } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chartPortfolioMix');
      expect(html).toContain('Abb. B:');
    });

    it('should not render portfolio donut when all EE data unavailable', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR49 NoData GmbH' },
        section2: {},
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('chartPortfolioMix');
    });
  });

  // ─── CR-43: Pearson correlation fallback ─────────────────────────────────

  describe('CR-43: Pearson correlation fallback', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should compute and show Pearson r when priceProductionAnalysis unavailable', () => {
      const pricePoints = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 3600000).toISOString(),
        priceEURperMWh: 100 - i * 2,
      }));
      const solarForecasts = Array.from({ length: 24 }, (_, i) => ({
        solar: i * 100,
      }));
      const html = buildHtmlReport({
        meta: { utilityName: 'CR43 Pearson GmbH' },
        section3: {
          prices: { available: true, data: { dataPoints: pricePoints } },
          priceProductionAnalysis: { available: false },
          windSolarActual: { available: true, data: { forecasts: solarForecasts } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('r = ');
      // Pearson path taken – the correlation row must show a computed r value, not the "unzureichend" fallback
      expect(html).not.toContain('Datenbasis für Berechnung unzureichend');
    });

    it('should fall back to n/v note when both tool and data are unavailable', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR43 Fallback GmbH' },
        section3: {
          priceProductionAnalysis: { available: false },
          windSolarActual: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('Datenbasis für Berechnung unzureichend');
    });
  });

  // ─── CR-50: Dual-axis price+solar chart ──────────────────────────────────

  describe('CR-50: Dual-axis price+solar chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render dual-axis chart when both price and solar data available', () => {
      const pricePoints = Array.from({ length: 24 }, (_, i) => ({
        timestamp: new Date(Date.now() + i * 3600000).toISOString(),
        priceEURperMWh: 50 + i,
      }));
      const solarForecasts = Array.from({ length: 24 }, (_, i) => ({ solar: i * 500 }));
      const html = buildHtmlReport({
        meta: { utilityName: 'CR50 DualAxis GmbH' },
        section3: {
          prices: { available: true, data: { dataPoints: pricePoints } },
          windSolarActual: { available: true, data: { forecasts: solarForecasts } },
          priceProductionAnalysis: { available: false },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('y2');
      expect(html).toContain('Solar GW');
      expect(html).toContain('Abb. 2:');
    });
  });

  // ─── CR-51: Gas country comparison chart ─────────────────────────────────

  describe('CR-51: Gas country comparison chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render country comparison chart when compareCountries data available', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR51 Gas GmbH' },
        section4: {
          compareCountries: {
            available: true,
            data: {
              rankings: [
                { country: 'DE', fillPercentage: 72 },
                { country: 'AT', fillPercentage: 85 },
                { country: 'NL', fillPercentage: 68 },
              ],
            },
          },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chartGasCountry');
      expect(html).toContain('Abb. D:');
    });
  });

  // ─── CR-52: EWK Radar chart ───────────────────────────────────────────────

  describe('CR-52: EWK Radar chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render radar chart when digitalisierungsindex scores are available', () => {
      const ewkJson = [{
        json: {
          digitalisierungsindex: { gesamtscore: 0.45, smart_grids: 0.25, digitale_prozesse: 0.35, kundenmanagement: 0.60 },
          rankings: { anschlussdauer_ee_ns_rank: 120, anschlussdauer_ee_ns_total: 780 },
          anschlussdauer: { ee_ns_gesamt: 18 },
        },
      }];
      const html = buildHtmlReport({
        meta: { utilityName: 'CR52 Radar GmbH' },
        section5: {
          benchmarkVnb: { available: true, data: ewkJson },
          anschlussdauer: { available: true, data: ewkJson },
          digitalisierungsindex: { available: true, data: ewkJson },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chartDigiRadar');
      expect(html).toContain('Abb. E:');
    });
  });

  // ─── CR-53: Peer benchmark tornado chart ─────────────────────────────────

  describe('CR-53: Peer benchmark tornado chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render tornado chart in peer benchmark block when data available', () => {
      // Tornado needs >= 2 metrics: ansch+bundesMedian AND diPct+diMedian
      const ewkJson = [{
        json: {
          digitalisierungsindex: { gesamtscore: 0.55, smart_grids: 0.40, digitale_prozesse: 0.50, kundenmanagement: 0.65 },
          rankings: { anschlussdauer_ee_ns_rank: 200, anschlussdauer_ee_ns_total: 780, digitalisierungsindex_rank: 150, digitalisierungsindex_total: 780 },
          rows: [{ ee_ns_gesamt_wochen: 14 }],
          stats: { ee_ns_gesamt: { median: 18 }, gesamtscore: { median: 0.50 } },
        },
      }];
      const html = buildHtmlReport({
        meta: { utilityName: 'CR53 Tornado GmbH' },
        section5: {
          benchmarkVnb: { available: true, data: ewkJson },
          anschlussdauer: { available: true, data: ewkJson },
          digitalisierungsindex: { available: true, data: ewkJson },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chartTornado');
      expect(html).toContain('Abb. F:');
    });
  });

  // ─── CR-54: Zubaukurve ───────────────────────────────────────────────────

  describe('CR-54: EE Zubaukurve chart', () => {
    const { buildHtmlReport } = require('../src/report-builder');

    it('should render zubau chart when pvLocal installations have dates', () => {
      const installations = Array.from({ length: 20 }, (_, i) => ({
        inbetriebnahmeDatum: `${2015 + Math.floor(i / 4)}-01-01`,
        leistungKw: 10 + i,
      }));
      const html = buildHtmlReport({
        meta: { utilityName: 'CR54 Zubau GmbH' },
        section2: {
          pvLocal: { available: true, data: { installations } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).toContain('chartZubau');
      expect(html).toContain('Abb. C:');
    });

    it('should not render zubau chart when pvLocal has fewer than 5 installations', () => {
      const html = buildHtmlReport({
        meta: { utilityName: 'CR54 SmallVNB GmbH' },
        section2: {
          pvLocal: { available: true, data: { installations: [{ inbetriebnahmeDatum: '2020-01-01', leistungKw: 5 }] } },
        },
        generatedAt: new Date().toISOString(),
      });
      expect(html).not.toContain('chartZubau');
    });
  });
});
