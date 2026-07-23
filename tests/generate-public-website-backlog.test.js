'use strict';

const {
  buildChannelPackages,
  buildBacklogCandidates,
  inferClaimRisk,
  inferDemoReadiness,
  loadOpenApiOperations,
  parseChangelogEntries,
  renderMarkdownReport,
} = require('../scripts/generate-public-website-backlog');

const fixtureOpenApi = {
  paths: {
    '/api/energy-market/portfolio-backtest': {
      post: {
        operationId: 'energy-market_portfolioBacktest',
        summary: 'Historical portfolio market value backtest',
        tags: ['Energy Market'],
        'x-ui-page': 'energy-market',
      },
    },
    '/api/dashboard/municipal-energy-value-analysis': {
      get: {
        operationId: 'dashboard_municipalEnergyValueAnalysisStatus',
        summary: 'Municipal Energy Value Lagebild Endpoint',
        tags: ['Dashboard API'],
        'x-ui-page': 'dashboard',
      },
    },
  },
};

describe('generate-public-website-backlog', () => {
  describe('parseChangelogEntries', () => {
    it('extracts release, section, title, body, and issue references', () => {
      const entries = parseChangelogEntries(`
# Changelog

## [0.67.10] — 2026-07-01

### Added
- **Historical portfolio market value backtest** (\`services/energy-market.service.js\`, #357): New endpoint \`POST /api/energy-market/portfolio-backtest\` computes market value.
  - Includes no-call guardrails.
`);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        release: '0.67.10',
        section: 'Added',
        title: 'Historical portfolio market value backtest',
        issueRefs: ['#357'],
      });
      expect(entries[0].text).toContain('no-call guardrails');
    });
  });

  describe('loadOpenApiOperations', () => {
    it('extracts HTTP operations with UI annotations and tags', () => {
      const operations = loadOpenApiOperations(fixtureOpenApi);
      expect(operations).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: '/api/energy-market/portfolio-backtest',
          operationId: 'energy-market_portfolioBacktest',
          uiPage: 'energy-market',
          tags: ['Energy Market'],
        }),
        expect.objectContaining({
          method: 'GET',
          path: '/api/dashboard/municipal-energy-value-analysis',
        }),
      ]);
    });
  });

  describe('buildBacklogCandidates', () => {
    it('maps changelog entries to public backlog fields', () => {
      const changelogMarkdown = `
## [0.67.10] — 2026-07-01

### Added
- **Historical portfolio market value backtest** (\`services/energy-market.service.js\`, #357): New endpoint \`POST /api/energy-market/portfolio-backtest\` computes the Day-Ahead spot market value for an asset portfolio. Includes read-only no-call guardrails and demo-ready API output.
`;

      const [candidate] = buildBacklogCandidates({
        changelogMarkdown,
        openApiSpec: fixtureOpenApi,
      });
      expect(candidate).toMatchObject({
        capability: 'historical-portfolio-market-value-backtest',
        endpoints: ['POST /api/energy-market/portfolio-backtest'],
        serviceOrTag: 'Energy Market',
        targetRole: 'Felix',
        websiteTargetPage: 'cernion.de/energy-market-api',
        demoReadiness: 'demo-ready',
        claimRisk: 'low',
      });
      expect(candidate.recommendedFollowUp).toContain('Endpoint-Bezug prüfen');
      expect(candidate.channelPackages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recipient: 'Felix',
            channels: expect.arrayContaining(['LinkedIn', 'Pubbler', 'B2B-E-Mail-Kontakte']),
            sendReadiness: 'send-ready-draft',
            safeClaim: expect.stringContaining('Read-only-Fähigkeit'),
          }),
          expect.objectContaining({
            recipient: 'Webmaster',
            channels: expect.arrayContaining(['cernion.de', 'corrently.io', 'stromdao.de']),
          }),
          expect.objectContaining({ recipient: 'Viki' }),
          expect.objectContaining({ recipient: 'Rhajaina', sendReadiness: 'review-package' }),
        ])
      );
    });

    it('keeps unmapped capabilities visible as concept-only candidates', () => {
      const changelogMarkdown = `
## Unreleased

### Added
- **VDMI Blueprint Pack seed**: Adds a read-only seed with explicit no-call guards and evidence gates.
`;

      const [candidate] = buildBacklogCandidates({
        changelogMarkdown,
        openApiSpec: fixtureOpenApi,
      });
      expect(candidate.endpoints).toEqual([]);
      expect(candidate.websiteTargetPage).toBe('cernion.de/vdmi-governance');
      expect(candidate.demoReadiness).toBe('concept-only');
      expect(candidate.claimRisk).toBe('low');
    });

    it('acceptance: turns example changelog and OpenAPI into at least two routed report candidates', () => {
      const changelogMarkdown = `
# Changelog

## [0.68.0] — 2026-07-22

### Added
- **Municipal Energy Value Lagebild Endpoint** (#501): New endpoint \`GET /api/dashboard/municipal-energy-value-analysis\` exposes read-only dashboard rows with SLP proxy evidence and no billing relevance.
- **Historical portfolio market value backtest** (#502): New endpoint \`POST /api/energy-market/portfolio-backtest\` provides demo-ready read-only market value backtests with no-call guardrails.
`;

      const candidates = buildBacklogCandidates({
        changelogMarkdown,
        openApiSpec: fixtureOpenApi,
      });

      expect(candidates).toHaveLength(2);
      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capability: 'municipal-energy-value-lagebild-endpoint',
            endpoints: ['GET /api/dashboard/municipal-energy-value-analysis'],
            serviceOrTag: 'Dashboard API',
            targetRole: expect.any(String),
            websiteTargetPage: 'cernion.de/kommunale-energiedaten',
            demoReadiness: expect.stringMatching(/needs-demo-copy-review|demo-ready/),
            claimRisk: expect.stringMatching(/low|medium/),
            recommendedFollowUpAgent: expect.stringMatching(
              /webmaster|felix-demo-sales|rhajaina-claim-review|devops-api-check/
            ),
          }),
          expect.objectContaining({
            capability: 'historical-portfolio-market-value-backtest',
            endpoints: ['POST /api/energy-market/portfolio-backtest'],
            serviceOrTag: 'Energy Market',
            targetRole: expect.any(String),
            websiteTargetPage: 'cernion.de/energy-market-api',
            demoReadiness: 'demo-ready',
            claimRisk: 'low',
            recommendedFollowUpAgent: 'felix-demo-sales',
          }),
        ])
      );
    });
  });

  describe('risk/readiness helpers', () => {
    it('marks public billing/settlement claims as high risk without guardrails', () => {
      expect(
        inferClaimRisk({ text: 'Guarantee settlement approval and billing automation.' })
      ).toEqual({
        level: 'high',
        reasons: ['guarantee', 'settlement', 'approval'],
      });
    });

    it('requires demo copy review when an endpoint has guardrails but no demo signal', () => {
      expect(
        inferDemoReadiness({ text: 'Read-only endpoint with no-call guardrails.' }, [
          { method: 'GET', path: '/api/dashboard/example' },
        ])
      ).toBe('needs-demo-copy-review');
    });
  });

  describe('buildChannelPackages', () => {
    it('blocks external send-readiness for high-risk claims and keeps proof requirements', () => {
      const packages = buildChannelPackages({
        title: 'Billing approval automation',
        capability: 'billing-approval-automation',
        endpoints: ['POST /api/billing/approve'],
        targetRole: 'Felix',
        websiteTargetPage: 'cernion.de/api',
        demoReadiness: 'api-visible-needs-demo-story',
        claimRisk: 'high',
      });

      expect(packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recipient: 'Felix',
            sendReadiness: 'blocked-claim-review',
            proofRequired: expect.arrayContaining([
              'CHANGELOG-Eintrag',
              'openapi-export.json',
              'POST /api/billing/approve',
              'fachliche Claim-Prüfung',
            ]),
          }),
        ])
      );
      expect(packages.map((pkg) => pkg.recipient)).not.toContain('Viki');
    });
  });

  describe('renderMarkdownReport', () => {
    it('renders the required public-backlog columns', () => {
      const report = renderMarkdownReport(
        [
          {
            capability: 'portfolioBacktest',
            endpoints: ['POST /api/energy-market/portfolio-backtest'],
            serviceOrTag: 'Energy Market',
            targetRole: 'Felix',
            websiteTargetPage: 'cernion.de/energy-market-api',
            demoReadiness: 'demo-ready',
            claimRisk: 'low',
            claimRiskReasons: ['read-only'],
            channelPackages: [
              {
                recipient: 'Felix',
                channels: ['LinkedIn', 'Pubbler'],
                sendReadiness: 'send-ready-draft',
              },
            ],
            recommendedFollowUp: 'Claim als read-only formulieren.',
          },
        ],
        { generatedAt: '2026-07-21T00:00:00.000Z' }
      );

      expect(report).toContain('Capability | Endpoint/Service | Zielrolle | Website-Zielseite');
      expect(report).toContain('Folge-Agent');
      expect(report).toContain('POST /api/energy-market/portfolio-backtest');
      expect(report).toContain('demo-ready');
      expect(report).toContain('Kanalpakete');
      expect(report).toContain('Felix: send-ready-draft via LinkedIn/Pubbler');
    });
  });
});
