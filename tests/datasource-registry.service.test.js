/**
 * Datasource Registry Service Tests
 */

const { ServiceBroker } = require('moleculer');
const DatasourceRegistryService = require('../services/datasource-registry.service');

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
          outdatedEvents.push(payload);
        },
      },
    });
    broker.createService(DatasourceRegistryService);
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
