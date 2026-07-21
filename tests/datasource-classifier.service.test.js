const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceConnectorService = require('../services/datasource-connector.service');
const DatasourceCacheService = require('../services/datasource-cache.service');
const DatasourceClassifierService = require('../services/datasource-classifier.service');
const CernionMCPClient = require('../src/mcp-client');

describe('Datasource Classifier Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(DatasourceRegistryService);
    broker.createService(DatasourceConnectorService);
    broker.createService(DatasourceCacheService);
    broker.createService(DatasourceClassifierService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  async function createCsvSource(fileName, label) {
    const createResult = await broker.call('datasource-registry.create', {
      name: label,
      description: `Fixture source for ${fileName}`,
      connectorType: 'csv',
      connectorConfig: {
        path: path.join(__dirname, 'fixtures', fileName),
        delimiter: ',',
        encoding: 'utf-8',
      },
      cachePolicy: {
        mode: 'ttl',
        ttlSeconds: 3600,
      },
    });

    await broker.call('datasource-cache.refresh', { sourceId: createResult.data.id });
    return createResult.data.id;
  }

  async function createConfiguredCsvSource({ filePath, label, description, connectorConfig }) {
    const createResult = await broker.call('datasource-registry.create', {
      name: label,
      description: description || `Fixture source for ${path.basename(filePath)}`,
      connectorType: 'csv',
      connectorConfig: {
        path: filePath,
        ...(connectorConfig || {}),
      },
      cachePolicy: {
        mode: 'ttl',
        ttlSeconds: 3600,
      },
    });

    await broker.call('datasource-cache.refresh', { sourceId: createResult.data.id });
    return createResult.data.id;
  }

  it('classifies all clean fixtures with expected domain and resolved mappings', async () => {
    const fixtureDir = path.join(__dirname, 'fixtures');
    const fixtureFiles = fs
      .readdirSync(fixtureDir)
      .filter((fileName) => fileName.endsWith('.fixture.json') && !fileName.includes('ambiguous'))
      // tabular-*.fixture.json belong to tabular-intelligence.service.test.js (a different
      // fixture schema: sourceId/dictionary/classification/rows, no label or matching .csv).
      .filter((fileName) =>
        fs.existsSync(path.join(fixtureDir, fileName.replace('.fixture.json', '.csv')))
      );

    for (const fixtureFile of fixtureFiles) {
      const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, fixtureFile), 'utf-8'));
      const csvFile = fixtureFile.replace('.fixture.json', '.csv');
      const sourceId = await createCsvSource(csvFile, fixture.label);

      const result = await broker.call('datasource-classifier.classify', {
        sourceId,
        filename: csvFile,
        description: fixture.description,
      });

      expect(result.domainId).toBe(fixture.domain);
      expect(result.confidence).toBeGreaterThanOrEqual(0.65);
      expect(result.requiresUserInput).toBe(false);

      Object.entries(fixture.expectedDictionary || {}).forEach(([columnName, meta]) => {
        if (!meta.semanticRole) return;
        if (result.fieldMappings[meta.semanticRole] === undefined) return;
        expect(result.fieldMappings[meta.semanticRole]).toBe(columnName);
      });
    }
  });

  it('marks ambiguous procurement fixture as requiring user input', async () => {
    const sourceId = await createCsvSource(
      'procurement_portfolio_ambiguous.csv',
      'Procurement Ambiguous'
    );

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'procurement_portfolio_ambiguous.csv',
      description: 'Ambiguous procurement fixture',
    });

    expect(result.domainId).toBe('procurement');
    expect(result.requiresUserInput).toBe(true);
    const unresolved = result.criticalFieldStatus.filter((item) => !item.resolved);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.some((item) => (item.candidates || []).includes('Wert_A'))).toBe(true);
    expect(unresolved.some((item) => (item.candidates || []).includes('Wert_B'))).toBe(true);
  });

  it('classifies a Kraftwerksliste-like CSV as grid-assets when parsing config is correct', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-kraftwerksliste-${Date.now()}.csv`);
    const content = [
      'Kraftwerksliste Bundesnetzagentur',
      'Datenstand 03.11.2025',
      'MaStR-Nr. der Stromerzeugungseinheit;Anlagenbetreiber;Energieträger;"Wärmeauskopplung (KWK)\n(ja/nein)";Jahr der Inbetriebnahme der Einheit;Spannungsebene;Technologie der Stromerzeugung',
      'SEE915851127786;STAWAG;Erdgas;Ja;2023;Mittelspannung;Verbrennungsmotor',
      'SEE973601397087;Hamburger Energiewerke;Wärme;Ja;2009;Hochspannung;Gegendruckmaschine ohne Entnahme',
    ].join('\n');
    fs.writeFileSync(tmpFile, content, 'utf-8');

    try {
      const sourceId = await createConfiguredCsvSource({
        filePath: tmpFile,
        label: 'Kraftwerksliste Test',
        description: 'Bundesnetzagentur Kraftwerksliste',
        connectorConfig: {
          delimiter: ';',
          skipRows: 2,
          encoding: 'utf-8',
        },
      });

      const result = await broker.call('datasource-classifier.classify', {
        sourceId,
        filename: 'Kraftwerksliste_CSV.csv',
        description: 'Bundesnetzagentur Kraftwerksliste mit Erzeugungseinheiten',
      });

      expect(result.domainId).toBe('grid-assets');
      expect(result.fieldMappings).toMatchObject({
        assetId: 'MaStR-Nr. der Stromerzeugungseinheit',
        assetType: 'Energieträger',
        voltageLevel: 'Spannungsebene',
        installYear: 'Jahr der Inbetriebnahme der Einheit',
      });
      expect(result.requiresUserInput).toBe(false);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('honors a user-forced domain override even when the score is low', async () => {
    const sourceId = await createCsvSource('procurement_portfolio.csv', 'Procurement Override');

    const result = await broker.call('datasource-classifier.confirm', {
      sourceId,
      domainId: 'grid-assets',
      fieldMappings: {},
      confirmedByUser: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.domainId).toBe('grid-assets');
    expect(result.data.domainLabel).toBe('Grid Assets');
    expect(result.data.confirmedByUser).toBe(true);
    expect(result.data.requiresUserInput).toBe(true);

    const stored = await broker.call('datasource-registry.getClassification', { id: sourceId });
    expect(stored.data.domainId).toBe('grid-assets');
  });

  it('marks procurement timeReference as periodFormat when mixed Lieferperiode values are detected', async () => {
    const sourceId = await createCsvSource(
      'procurement_portfolio.csv',
      'Procurement Period Format'
    );

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'procurement_portfolio.csv',
      description: 'Procurement fixture with Lieferperiode',
    });

    const timeReference = (result.criticalFieldStatus || []).find(
      (item) => item.fieldRole === 'timeReference'
    );

    expect(timeReference).toBeDefined();
    expect(timeReference.meta?.periodFormat).toBe(true);
  });

  it('does not call LLM fallback when heuristic classification is already above unknown threshold', async () => {
    const sourceId = await createCsvSource('grid_assets.csv', 'Grid Assets LLM Guard');
    const spy = jest.spyOn(CernionMCPClient, 'callWithNewSession');

    const service = broker.getLocalService('datasource-classifier');
    service.settings.llmFallbackEnabled = true;

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'grid_assets.csv',
      description: 'Clearly classifiable fixture',
    });

    expect(result.domainId).toBe('grid-assets');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('uses LLM fallback result when enabled and heuristic result is unknown', async () => {
    process.env.CERNION_TOKEN = 'test-token';

    const tmpFile = path.join(os.tmpdir(), `cernion-unknown-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, 'foo,bar\nalpha,beta\ngamma,delta\n', 'utf-8');

    const sourceId = await createConfiguredCsvSource({
      filePath: tmpFile,
      label: 'Unknown CSV',
      description: 'No obvious domain hints',
    });

    const spy = jest.spyOn(CernionMCPClient, 'callWithNewSession').mockResolvedValue({
      data: {
        content: [
          {
            text: JSON.stringify({
              domainId: 'metering-point-master',
              confidence: 0.82,
              reasoning: 'Strong Malo/Melo structure patterns.',
            }),
          },
        ],
      },
    });

    const service = broker.getLocalService('datasource-classifier');
    service.settings.llmFallbackEnabled = true;

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'unknown.csv',
      description: 'Unknown fixture',
    });

    expect(spy).toHaveBeenCalled();
    expect(result.domainId).toBe('metering-point-master');
    expect(result.llmAssisted).toBe(true);
    expect(result.llmReasoning).toContain('Strong');

    spy.mockRestore();
    fs.unlinkSync(tmpFile);
  });

  it('keeps unknown classification when LLM confidence is below threshold', async () => {
    process.env.CERNION_TOKEN = 'test-token';

    const tmpFile = path.join(os.tmpdir(), `cernion-unknown-low-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, 'foo,bar\nalpha,beta\ngamma,delta\n', 'utf-8');

    const sourceId = await createConfiguredCsvSource({
      filePath: tmpFile,
      label: 'Unknown CSV Low Confidence',
      description: 'No obvious domain hints',
    });

    const spy = jest.spyOn(CernionMCPClient, 'callWithNewSession').mockResolvedValue({
      data: {
        content: [
          {
            text: JSON.stringify({
              domainId: 'grid-assets',
              confidence: 0.4,
              reasoning: 'Weak signals only.',
            }),
          },
        ],
      },
    });

    const service = broker.getLocalService('datasource-classifier');
    service.settings.llmFallbackEnabled = true;

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'unknown-low.csv',
      description: 'Unknown fixture low confidence',
    });

    expect(spy).toHaveBeenCalled();
    // Short description (< 8 tokens) → still 'unknown', not 'other'
    expect(result.domainId).toBe('unknown');
    expect(result.requiresUserInput).toBe(true);
    expect(result.llmAssisted).toBe(true);

    spy.mockRestore();
    fs.unlinkSync(tmpFile);
  });

  it('classifies as "other" when description is rich but no domain keyword matches', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-other-${Date.now()}.csv`);
    // CSV content has no domain-specific keywords
    fs.writeFileSync(
      tmpFile,
      [
        'Complaint_ID,Customer_Name,Category,Date_Received,Resolution_Date,Satisfaction_Score',
        '1001,Alice Müller,Billing,2026-01-05,2026-01-12,4',
        '1002,Bob Schmidt,Technical,2026-01-06,,2',
        '1003,Clara Weber,Billing,2026-01-07,2026-01-09,5',
      ].join('\n'),
      'utf-8'
    );

    const sourceId = await createConfiguredCsvSource({
      filePath: tmpFile,
      label: 'Customer Complaints',
      description:
        'Customer complaints data containing complaint identifier, customer name, complaint category, date the complaint was received, resolution date, and customer satisfaction score',
    });

    const service = broker.getLocalService('datasource-classifier');
    service.settings.llmFallbackEnabled = false;

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'customer_complaints.csv',
      description:
        'Customer complaints data containing complaint identifier, customer name, complaint category, date the complaint was received, resolution date, and customer satisfaction score',
    });

    expect(result.domainId).toBe('other');
    expect(result.domainLabel).toBe('Other / Custom Dataset');
    expect(result.requiresUserInput).toBe(false);
    expect(result.descriptionAnalysis).toBeDefined();
    expect(result.descriptionAnalysis.conceptSummary).toContain('complaint');
    expect(Array.isArray(result.descriptionAnalysis.capabilities)).toBe(true);
    expect(Array.isArray(result.descriptionAnalysis.suggestedQueries)).toBe(true);
    expect(result.descriptionAnalysis.suggestedQueries.length).toBeGreaterThan(0);

    fs.unlinkSync(tmpFile);
  });

  it('infers timeseries and categorical capabilities from description for "other" domain', async () => {
    const tmpFile = path.join(os.tmpdir(), `cernion-other-caps-${Date.now()}.csv`);
    fs.writeFileSync(
      tmpFile,
      [
        'OrderID,Region,ProductCategory,OrderDate,Revenue',
        'A001,Bayern,Hardware,2026-02-01,1200.50',
        'A002,NRW,Software,2026-02-03,850.00',
        'A003,Bayern,Services,2026-02-05,500.00',
      ].join('\n'),
      'utf-8'
    );

    const sourceId = await createConfiguredCsvSource({
      filePath: tmpFile,
      label: 'Sales Orders',
      description:
        'Internal sales order data with order identifier, region, product category, order date, and revenue amount per order for quarterly reporting',
    });

    const service = broker.getLocalService('datasource-classifier');
    service.settings.llmFallbackEnabled = false;

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'sales_orders.csv',
      description:
        'Internal sales order data with order identifier, region, product category, order date, and revenue amount per order for quarterly reporting',
    });

    expect(result.domainId).toBe('other');
    expect(result.descriptionAnalysis.capabilities).toContain('timeseries');
    expect(result.descriptionAnalysis.capabilities).toContain('categorical');
    expect(result.descriptionAnalysis.capabilities).toContain('geographic');
    expect(result.descriptionAnalysis.capabilities).toContain('financial');

    fs.unlinkSync(tmpFile);
  });

  it('still returns "unknown" for very short descriptions even when LLM fails', async () => {
    // Use clearly ambiguous column names (foo, bar) that won't trigger
    // any domain's keyword list via substring matching.
    const tmpFile = path.join(os.tmpdir(), `cernion-short-desc-${Date.now()}.csv`);
    fs.writeFileSync(tmpFile, 'foo,bar\nalpha,beta\ngamma,delta\n', 'utf-8');

    const sourceId = await createConfiguredCsvSource({
      filePath: tmpFile,
      label: 'Minimal CSV',
      description: 'Short desc', // only 2 tokens — below the 8-token threshold for 'other'
    });

    const service = broker.getLocalService('datasource-classifier');
    service.settings.llmFallbackEnabled = false;

    const result = await broker.call('datasource-classifier.classify', {
      sourceId,
      filename: 'minimal.csv',
      description: 'Short desc',
    });

    // Short description must NOT trigger the 'other' domain
    expect(result.domainId).toBe('unknown');
    expect(result.requiresUserInput).toBe(true);
    expect(result.descriptionAnalysis).toBeUndefined();

    fs.unlinkSync(tmpFile);
  });
});
