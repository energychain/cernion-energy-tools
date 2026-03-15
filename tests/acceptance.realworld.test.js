const fs = require('fs');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceConnectorService = require('../services/datasource-connector.service');
const DatasourceCacheService = require('../services/datasource-cache.service');
const DatasourceClassifierService = require('../services/datasource-classifier.service');

const ACCEPTANCE_DIR = path.join(__dirname, 'acceptance');

const FIXTURES = [
  {
    csvFile: 'beschaffungsportfolio.csv',
    sidecarFile: 'beschaffungsportfolio.acceptance.json',
    minRows: 40,
    maxRows: 60,
  },
  {
    csvFile: 'imsys_rollout.csv',
    sidecarFile: 'imsys_rollout.acceptance.json',
    minRows: 80,
    maxRows: 120,
  },
  {
    csvFile: 'stoerungshistorie.csv',
    sidecarFile: 'stoerungshistorie.acceptance.json',
    minRows: 50,
    maxRows: 80,
  },
  {
    csvFile: 'pv_anlagenliste.csv',
    sidecarFile: 'pv_anlagenliste.acceptance.json',
    minRows: 60,
    maxRows: 100,
  },
];

function rowCount(filePath) {
  const lines = fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

describe('Real-World Acceptance Test v0.9.3 fixtures', () => {
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

  it('provides all required fixture and sidecar files', () => {
    FIXTURES.forEach(({ csvFile, sidecarFile, minRows, maxRows }) => {
      const csvPath = path.join(ACCEPTANCE_DIR, csvFile);
      const sidecarPath = path.join(ACCEPTANCE_DIR, sidecarFile);

      expect(fs.existsSync(csvPath)).toBe(true);
      expect(fs.existsSync(sidecarPath)).toBe(true);

      const rows = rowCount(csvPath);
      expect(rows).toBeGreaterThanOrEqual(minRows);
      expect(rows).toBeLessThanOrEqual(maxRows);

      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
      expect(sidecar.domain).toBeTruthy();
      expect(sidecar.label).toBeTruthy();
      expect(sidecar.description).toBeTruthy();
      expect(Array.isArray(sidecar.acceptanceQueries)).toBe(true);
      expect(sidecar.acceptanceQueries).toHaveLength(3);
    });
  });

  it.each(FIXTURES)(
    'classifies $csvFile into expected domain without user input',
    async (fixture) => {
      const csvPath = path.join(ACCEPTANCE_DIR, fixture.csvFile);
      const sidecar = JSON.parse(
        fs.readFileSync(path.join(ACCEPTANCE_DIR, fixture.sidecarFile), 'utf-8')
      );

      const createResult = await broker.call('datasource-registry.create', {
        name: sidecar.label,
        description: sidecar.description,
        connectorType: 'csv',
        connectorConfig: {
          path: csvPath,
          delimiter: sidecar.connectorConfig?.delimiter,
          encoding: sidecar.connectorConfig?.encoding || 'utf-8',
          skipRows: sidecar.connectorConfig?.skipRows || 0,
        },
        cachePolicy: {
          mode: 'ttl',
          ttlSeconds: 3600,
        },
      });

      const sourceId = createResult.data.id;

      await broker.call('datasource-cache.refresh', { sourceId });
      const result = await broker.call('datasource-classifier.classify', {
        sourceId,
        filename: fixture.csvFile,
        description: sidecar.description,
      });

      expect(result.domainId).toBe(sidecar.domain);
      expect(result.requiresUserInput).toBe(false);
    }
  );
});
