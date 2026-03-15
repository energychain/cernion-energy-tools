const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceConnectorService = require('../services/datasource-connector.service');
const DatasourceCacheService = require('../services/datasource-cache.service');
const DatasourceClassifierService = require('../services/datasource-classifier.service');

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
      .filter((fileName) => fileName.endsWith('.fixture.json') && !fileName.includes('ambiguous'));

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
});
