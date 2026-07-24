'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildReleaseSignals,
  extractOpenApiOperations,
  parseChangelogEntries,
  renderMarkdownReport,
} = require('../scripts/extract-release-signals');

const fixtureOpenApi = {
  openapi: '3.0.0',
  info: { title: 'Cernion Energy Tools API', version: '0.67.test' },
  paths: {
    '/api/dashboard/municipal-energy-value-analysis': {
      get: {
        operationId: 'dashboard_municipalEnergyValueAnalysisStatus',
        summary: 'Municipal Energy Value Lagebild Endpoint',
        description: 'Read-only municipal energy value analysis for public evidence work.',
        tags: ['Dashboard API'],
      },
    },
    '/api/energy-market/portfolio-backtest': {
      post: {
        operationId: 'energy-market_portfolioBacktest',
        summary: 'Historical portfolio market value backtest',
        tags: ['Energy Market'],
      },
    },
  },
};

const fixtureChangelog = `
# Changelog

## Unreleased

### Added
- **Municipal Energy Value Lagebild Endpoint** (\`services/dashboard-api.service.js\`, #324): New endpoint \`GET /api/dashboard/municipal-energy-value-analysis\` exposes read-only rows for public evidence work.

## [0.67.10] — 2026-07-01

### Changed
- **portfolioBacktest runs as async background job** (\`services/energy-market.service.js\`, #357): The endpoint \`POST /api/energy-market/portfolio-backtest\` now returns 202 job links.
`;

describe('extract-release-signals', () => {
  describe('parseChangelogEntries', () => {
    it('extracts release hints, issue refs, and endpoint refs', () => {
      const entries = parseChangelogEntries(fixtureChangelog);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        release: 'Unreleased',
        section: 'Added',
        title: 'Municipal Energy Value Lagebild Endpoint',
        issueRefs: ['#324'],
        endpointRefs: ['GET /api/dashboard/municipal-energy-value-analysis'],
      });
      expect(entries[1]).toMatchObject({
        release: '0.67.10',
        releaseDate: '2026-07-01',
        endpointRefs: ['POST /api/energy-market/portfolio-backtest'],
      });
    });
  });

  describe('extractOpenApiOperations', () => {
    it('extracts method, path, service, tags, summaries, and descriptions', () => {
      expect(extractOpenApiOperations(fixtureOpenApi)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: 'GET',
            path: '/api/dashboard/municipal-energy-value-analysis',
            service: 'Dashboard API',
            tags: ['Dashboard API'],
            summary: 'Municipal Energy Value Lagebild Endpoint',
          }),
        ])
      );
    });

    it('rejects OpenAPI documents without a paths object', () => {
      expect(() => extractOpenApiOperations({ info: {} })).toThrow('paths object');
    });
  });

  describe('buildReleaseSignals', () => {
    it('builds neutral raw signals with extraction/publication boundary', () => {
      const report = buildReleaseSignals({
        changelogMarkdown: fixtureChangelog,
        openApiSpec: fixtureOpenApi,
        limit: 10,
      });

      expect(report).toMatchObject({
        schemaVersion: 'cernion.releaseSignals.v1',
        extractionOnly: true,
        openapi: {
          title: 'Cernion Energy Tools API',
          version: '0.67.test',
          pathCount: 2,
          operationCount: 2,
        },
        changelog: { entryCount: 2, latestRelease: 'Unreleased' },
      });
      expect(report.publicationBoundary).toContain('No GitHub issues');
      expect(report.signals.endpointSignals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            changeClass: 'changelog-added',
            method: 'GET',
            path: '/api/dashboard/municipal-energy-value-analysis',
            changelogLinks: [expect.objectContaining({ release: 'Unreleased' })],
            publicationBoundary: 'raw-extraction-only',
          }),
          expect.objectContaining({
            changeClass: 'changelog-changed',
            method: 'POST',
            path: '/api/energy-market/portfolio-backtest',
          }),
        ])
      );
      expect(report.signals.serviceSignals[0]).toHaveProperty(
        'publicationBoundary',
        'raw-extraction-only'
      );
    });
  });

  describe('renderMarkdownReport', () => {
    it('renders endpoint and changelog sections plus publication boundary', () => {
      const report = buildReleaseSignals({
        changelogMarkdown: fixtureChangelog,
        openApiSpec: fixtureOpenApi,
        limit: 2,
      });
      const markdown = renderMarkdownReport(report);

      expect(markdown).toContain('# CET Release Signal Extraction Report');
      expect(markdown).toContain('GET | /api/dashboard/municipal-energy-value-analysis');
      expect(markdown).toContain('Trennung Extraction vs. Veröffentlichung');
      expect(markdown).toContain('schreibt nicht in GitHub');
    });
  });

  describe('CLI error handling', () => {
    it('returns a clear error for missing files', () => {
      const result = spawnSync(
        process.execPath,
        ['scripts/extract-release-signals.js', '--changelog=/tmp/cet-missing-changelog.md'],
        { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('MISSING_FILE');
    });

    it('returns a clear error for invalid JSON', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-release-signals-'));
      const changelogPath = path.join(tmpDir, 'CHANGELOG.md');
      const openapiPath = path.join(tmpDir, 'openapi.json');
      fs.writeFileSync(changelogPath, fixtureChangelog, 'utf8');
      fs.writeFileSync(openapiPath, '{not-json', 'utf8');

      const result = spawnSync(
        process.execPath,
        [
          'scripts/extract-release-signals.js',
          `--changelog=${changelogPath}`,
          `--openapi=${openapiPath}`,
        ],
        { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('INVALID_JSON');
    });
  });
});
