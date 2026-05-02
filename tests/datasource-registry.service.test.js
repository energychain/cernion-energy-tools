/**
 * Datasource Registry Service Tests
 */

const { ServiceBroker } = require('moleculer');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const DatasourceRegistryService = require('../services/datasource-registry.service');
const DatasourceClassifierService = require('../services/datasource-classifier.service');

describe('Datasource Registry Service', () => {
  let broker;
  let outdatedEvents;

  beforeAll(async () => {
    outdatedEvents = [];
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      name: 'datasource-connector',
      actions: {
        inferSchema: {
          async handler() {
            return {
              success: true,
              sampledRowCount: 2,
              inferredSchema: {
                fields: [
                  { name: 'kundennummer', type: 'string', example: 'KD-123456' },
                  { name: 'anschlussleistung_kw', type: 'number', example: 15.5 },
                ],
              },
            };
          },
        },
      },
    });
    broker.createService({
      name: 'datasource-registry-test-listener',
      events: {
        'datasource.dictionary.outdated'(payload) {
          outdatedEvents.push(payload?.params || payload);
        },
      },
    });
    broker.createService({
      name: 'datasource-cache',
      actions: {
        status: {
          async handler() {
            return { success: true, exists: true, stale: false };
          },
        },
        refresh: {
          async handler() {
            return { success: true, rowCount: 3 };
          },
        },
        query: {
          async handler() {
            return {
              success: true,
              data: [
                {
                  Lieferzeitraum: '2026-Q1',
                  Volumen_MWh: '120',
                  Preis_EUR_MWh: '78.4',
                  Counterparty: 'Stadtwerke Handel Süd',
                  Produkt: 'Base Forward',
                },
                {
                  Lieferzeitraum: '2026-Q2',
                  Volumen_MWh: '130',
                  Preis_EUR_MWh: '76.8',
                  Counterparty: 'Trianel Energy',
                  Produkt: 'Peak Forward',
                },
              ],
            };
          },
        },
      },
    });
    broker.createService(DatasourceRegistryService);
    broker.createService(DatasourceClassifierService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should have correct service name', () => {
    expect(DatasourceRegistryService.name).toBe('datasource-registry');
  });

  it('should create and fetch a datasource', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Test Quelle',
      connectorType: 'csv',
      connectorConfig: { path: '/tmp/test.csv' },
      tags: ['test'],
    });

    expect(created.success).toBe(true);
    expect(created.data.id).toBeDefined();
    expect(created.data.dictionary.version).toBe(1);

    const fetched = await broker.call('datasource-registry.get', { id: created.data.id });
    expect(fetched.success).toBe(true);
    expect(fetched.data.name).toBe('Test Quelle');
  });

  it('should list datasources and filter by tag', async () => {
    await broker.call('datasource-registry.create', {
      name: 'GIS Quelle',
      connectorType: 'geojson',
      tags: ['gis'],
    });

    const all = await broker.call('datasource-registry.list', {});
    expect(all.success).toBe(true);
    expect(all.count).toBeGreaterThanOrEqual(2);

    const filtered = await broker.call('datasource-registry.list', { tag: 'gis' });
    expect(filtered.success).toBe(true);
    expect(filtered.data.every((item) => item.tags.includes('gis'))).toBe(true);
  });

  it('should update datasource fields', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Update Quelle',
      connectorType: 'rest',
    });

    const updated = await broker.call('datasource-registry.update', {
      id: created.data.id,
      description: 'Aktualisierte Beschreibung',
      tags: ['rest', 'internal'],
    });

    expect(updated.success).toBe(true);
    expect(updated.data.description).toBe('Aktualisierte Beschreibung');
    expect(updated.changes).toContain('description');
    expect(updated.changes).toContain('tags');
  });

  it('should version dictionary on update', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Dictionary Quelle',
      connectorType: 'csv',
    });

    const firstUpdate = await broker.call('datasource-registry.updateDictionary', {
      id: created.data.id,
      fields: [
        {
          name: 'kundennummer',
          type: 'string',
          privacyFlag: true,
        },
      ],
      updatedBy: 'tester',
    });

    expect(firstUpdate.success).toBe(true);
    expect(firstUpdate.data.version).toBe(2);

    const history = await broker.call('datasource-registry.getDictionaryHistory', {
      id: created.data.id,
    });

    expect(history.success).toBe(true);
    expect(history.count).toBe(2);

    const version1 = await broker.call('datasource-registry.getDictionaryVersion', {
      id: created.data.id,
      version: 1,
    });
    const version2 = await broker.call('datasource-registry.getDictionaryVersion', {
      id: created.data.id,
      version: 2,
    });

    expect(version1.data.fields).toEqual([]);
    expect(version2.data.fields).toHaveLength(1);
  });

  it('should flag outdated dictionary references and emit an event', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Version Guard Quelle',
      connectorType: 'csv',
    });

    await broker.call('datasource-registry.updateDictionary', {
      id: created.data.id,
      fields: [
        {
          name: 'zaehlernummer',
          type: 'string',
          privacyFlag: false,
        },
      ],
      updatedBy: 'tester',
    });

    const current = await broker.call('datasource-registry.checkDictionaryVersion', {
      id: created.data.id,
      referencedVersion: 2,
    });

    expect(current.success).toBe(true);
    expect(current.outdated).toBe(false);
    expect(current.isCurrent).toBe(true);

    const stale = await broker.call('datasource-registry.checkDictionaryVersion', {
      id: created.data.id,
      referencedVersion: 1,
    });

    expect(stale.success).toBe(true);
    expect(stale.currentVersion).toBe(2);
    expect(stale.referencedVersion).toBe(1);
    expect(stale.outdated).toBe(true);
    expect(stale.isCurrent).toBe(false);
    expect(outdatedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: created.data.id,
          currentVersion: 2,
          referencedVersion: 1,
        }),
      ])
    );
  });

  it('should return inferred draft and accept refresh trigger', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Infer Quelle',
      connectorType: 'csv',
    });

    const infer = await broker.call('datasource-registry.infer', { id: created.data.id });
    expect(infer.success).toBe(true);
    expect(infer.status).toBe('draft');
    expect(infer.dictionary.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining(['kundennummer', 'anschlussleistung_kw'])
    );
    expect(infer.diff.added).toContain('kundennummer');

    const refresh = await broker.call('datasource-registry.refresh', { id: created.data.id });
    expect(refresh.success).toBe(true);
    expect(refresh.refreshRequested).toBe(true);
  });

  it('should emit inference completion and persist semantic classification', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Beschaffungsportfolio Test',
      description: 'Procurement positions for Stadtwerk',
      connectorType: 'csv',
      connectorConfig: { path: '/tmp/procurement_portfolio.csv' },
    });

    await broker.call('datasource-registry.infer', { id: created.data.id });

    let classification;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await broker.call('datasource-registry.getClassification', {
        id: created.data.id,
      });
      classification = response.data;
      if (classification?.domainId) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(classification).toBeDefined();
    expect(classification.domainId).toBe('procurement');
    expect(classification.confirmedByUser).toBe(false);
    expect(classification.fieldMappings).toMatchObject({
      timeReference: 'Lieferzeitraum',
      quantityMWh: 'Volumen_MWh',
      priceEURperMWh: 'Preis_EUR_MWh',
    });
  });

  it('should delete a datasource', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Delete Quelle',
      connectorType: 'csv',
    });

    const removed = await broker.call('datasource-registry.remove', { id: created.data.id });
    expect(removed.success).toBe(true);

    await expect(broker.call('datasource-registry.get', { id: created.data.id })).rejects.toThrow(
      'Datasource not found'
    );
  });
});

describe('Datasource Registry Service – inference error path', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      name: 'datasource-connector',
      actions: {
        inferSchema: {
          async handler() {
            throw new Error('CSV header row is not a valid schema (skipRows required)');
          },
        },
      },
    });
    broker.createService({
      name: 'datasource-cache',
      actions: {
        status: {
          async handler() {
            return { success: true, exists: true, stale: false };
          },
        },
        refresh: {
          async handler() {
            return { success: true, rowCount: 0 };
          },
        },
        query: {
          async handler() {
            return { success: true, data: [] };
          },
        },
      },
    });
    broker.createService(DatasourceRegistryService);
    broker.createService(DatasourceClassifierService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should emit inference.complete and classify as unknown when inferSchema throws', async () => {
    const created = await broker.call('datasource-registry.create', {
      name: 'Kraftwerksliste',
      description: 'Bundesnetzagentur power plant list with metadata header rows',
      connectorType: 'csv',
      connectorConfig: { path: '/tmp/Kraftwerksliste_CSV.csv' },
    });

    const infer = await broker.call('datasource-registry.infer', { id: created.data.id });
    expect(infer.success).toBe(true);
    expect(infer.status).toBe('draft');
    expect(infer.warning).toBeDefined();

    let classification;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await broker.call('datasource-registry.getClassification', {
        id: created.data.id,
      });
      classification = response.data;
      if (classification?.domainId) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(classification).toBeDefined();
    expect(classification.domainId).toBe('unknown');
    expect(classification.requiresUserInput).toBe(true);
    expect(classification.confirmedByUser).toBe(false);
  });
});

describe('Datasource Registry Service – persistence across restart', () => {
  const persistenceFile = path.join(
    os.tmpdir(),
    `datasource-registry-persistence-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );

  afterAll(async () => {
    await fs.rm(persistenceFile, { force: true });
  });

  it('should keep datasource records after broker restart', async () => {
    const brokerA = new ServiceBroker({ logger: false, transporter: null });
    brokerA.createService({
      ...DatasourceRegistryService,
      settings: {
        ...DatasourceRegistryService.settings,
        persistenceEnabled: true,
        persistenceFile,
      },
    });
    await brokerA.start();

    const created = await brokerA.call('datasource-registry.create', {
      name: 'Persisted Quelle',
      connectorType: 'csv',
      connectorConfig: { path: '/tmp/persisted.csv' },
    });

    const sourceId = created.data.id;
    await brokerA.stop();

    const brokerB = new ServiceBroker({ logger: false, transporter: null });
    brokerB.createService({
      ...DatasourceRegistryService,
      settings: {
        ...DatasourceRegistryService.settings,
        persistenceEnabled: true,
        persistenceFile,
      },
    });
    await brokerB.start();

    const fetched = await brokerB.call('datasource-registry.get', { id: sourceId });
    expect(fetched.success).toBe(true);
    expect(fetched.data.name).toBe('Persisted Quelle');

    await brokerB.stop();
  });
});
