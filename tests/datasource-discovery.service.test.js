/**
 * Datasource Discovery Service Tests
 */

const { ServiceBroker } = require('moleculer');
const DatasourceDiscoveryService = require('../services/datasource-discovery.service');

describe('Datasource Discovery Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'datasource-registry',
      actions: {
        list: {
          async handler() {
            return {
              success: true,
              data: [
                {
                  id: 'source-fresh',
                  name: 'Netzanschlüsse TWL 2025',
                  description: 'Interne Liste aller Netzanschlüsse GW29',
                  tags: ['netz', 'gis'],
                  connectorConfig: { path: '/uploads/GW29_metering_2026.csv' },
                  dictionary: {
                    fields: [
                      { name: 'Zeit', privacyFlag: false },
                      { name: 'Leistung Bezug (W)', privacyFlag: false },
                      { name: 'Leistung Einspeisung (W)', privacyFlag: false },
                      { name: 'anschlussnummer', privacyFlag: false },
                      { name: 'kundennummer', privacyFlag: true },
                    ],
                  },
                  semanticClassification: {
                    domainId: 'metering',
                    domainLabel: 'Metering Load Profile',
                    confirmedByUser: true,
                    fieldMappings: {
                      timeReference: 'Zeit',
                      consumptionKWh: 'Leistung Bezug (W)',
                      feedInKWh: 'Leistung Einspeisung (W)',
                    },
                    criticalFieldStatus: [
                      {
                        fieldRole: 'timeReference',
                        resolved: true,
                        mappedColumn: 'Zeit',
                        candidates: ['Zeit'],
                      },
                      {
                        fieldRole: 'consumptionKWh',
                        resolved: true,
                        mappedColumn: 'Leistung Bezug (W)',
                        candidates: ['Leistung Bezug (W)'],
                      },
                      {
                        fieldRole: 'feedInKWh',
                        resolved: true,
                        mappedColumn: 'Leistung Einspeisung (W)',
                        candidates: ['Leistung Einspeisung (W)'],
                      },
                    ],
                  },
                },
                {
                  id: 'source-stale',
                  name: 'Altquelle',
                  description: 'Soll nicht angezeigt werden',
                  tags: ['alt'],
                  dictionary: {
                    fields: [{ name: 'old_field', privacyFlag: false }],
                  },
                },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'datasource-cache',
      actions: {
        status: {
          async handler(ctx) {
            if (ctx.params.sourceId === 'source-fresh') {
              return {
                success: true,
                exists: true,
                stale: false,
                lastRefreshed: '2026-03-12T06:00:00Z',
              };
            }

            return {
              success: true,
              exists: true,
              stale: true,
              lastRefreshed: '2026-01-01T00:00:00Z',
            };
          },
        },
      },
    });

    broker.createService(DatasourceDiscoveryService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should list descriptors for both fresh and stale existing caches', async () => {
    const result = await broker.call('datasource-discovery.list', {});
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);

    const fresh = result.data.find((d) => d.sourceId === 'source-fresh');
    const stale = result.data.find((d) => d.sourceId === 'source-stale');

    expect(fresh).toBeDefined();
    expect(stale).toBeDefined();

    expect(fresh.cacheStatus).toBe('fresh');
    expect(stale.cacheStatus).toBe('stale');

    expect(fresh.privacyFlaggedFields).toContain('kundennummer');
    expect(fresh.aliases).toContain('Netzanschlüsse TWL 2025');
    expect(fresh.aliases).toContain('GW29');
    expect(fresh.aliases).toContain('2026');
    expect(fresh.capabilities).toContain('timeseries');
    expect(fresh.capabilities).toContain('timeseries_cost_enrichment');
    expect(fresh.semanticHints.timeField).toBe('Zeit');
    expect(fresh.semanticHints.domain).toBe('metering');
    expect(fresh.semanticHints.criticalFieldMappings).toMatchObject({
      timeReference: 'Zeit',
      consumptionKWh: 'Leistung Bezug (W)',
      feedInKWh: 'Leistung Einspeisung (W)',
    });
    expect(fresh.semanticStatus).toBe('ready');
  });

  it('should search descriptors by name and fields', async () => {
    const byName = await broker.call('datasource-discovery.search', { q: 'netzanschlüsse' });
    expect(byName.success).toBe(true);
    expect(byName.count).toBe(1);

    const byField = await broker.call('datasource-discovery.search', { q: 'anschlussnummer' });
    expect(byField.success).toBe(true);
    expect(byField.count).toBe(1);
  });

  it('should return one descriptor by source id', async () => {
    const result = await broker.call('datasource-discovery.descriptor', {
      sourceId: 'source-fresh',
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toContain('inhouse__');
    expect(result.data.source).toBe('inhouse');
  });

  it('should expose description_guided capability and runtimeContext for "other" domain sources', async () => {
    // Extend the broker's mock registry to include an 'other' domain source
    const broker2 = new (require('moleculer').ServiceBroker)({ logger: false });
    broker2.createService({
      name: 'datasource-registry',
      actions: {
        list: {
          async handler() {
            return {
              success: true,
              data: [
                {
                  id: 'source-other',
                  name: 'Customer Complaints Q1',
                  description:
                    'Customer complaints data with complaint identifier, category, date received, resolution date and satisfaction score for Q1 analysis',
                  tags: ['customer', 'support'],
                  connectorConfig: { path: '/uploads/complaints_q1.csv' },
                  dictionary: {
                    fields: [
                      { name: 'Complaint_ID', privacyFlag: false },
                      { name: 'Category', privacyFlag: false },
                      { name: 'Date_Received', privacyFlag: false },
                      { name: 'Satisfaction_Score', privacyFlag: false },
                    ],
                  },
                  semanticClassification: {
                    domainId: 'other',
                    domainLabel: 'Other / Custom Dataset',
                    confirmedByUser: false,
                    fieldMappings: {},
                    criticalFieldStatus: [],
                    requiresUserInput: false,
                    descriptionAnalysis: {
                      capabilities: ['timeseries', 'aggregate', 'categorical'],
                      suggestedQueries: [
                        'Wie entwickeln sich die Werte im Zeitverlauf?',
                        'Wie verteilen sich die Werte nach Kategorie / Typ?',
                      ],
                      conceptSummary:
                        'Customer complaints data with complaint identifier, category, date received, resolution date and satisfaction score',
                      detectedColumnCount: 4,
                    },
                  },
                },
              ],
            };
          },
        },
      },
    });
    broker2.createService({
      name: 'datasource-cache',
      actions: {
        status: {
          async handler() {
            return { success: true, exists: true, stale: false, lastRefreshed: '2026-03-20T08:00:00Z' };
          },
        },
      },
    });
    broker2.createService(require('../services/datasource-discovery.service'));
    await broker2.start();

    const result = await broker2.call('datasource-discovery.list', {});
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const descriptor = result.data[0];
    expect(descriptor.sourceId).toBe('source-other');
    expect(descriptor.semanticStatus).toBe('description-guided');
    expect(descriptor.capabilities).toContain('description_guided');
    expect(descriptor.semanticHints.domain).toBe('other');
    expect(descriptor.semanticHints.freeformDescription).toContain('complaints');
    expect(descriptor.semanticHints.runtimeContext).toBeDefined();
    expect(descriptor.semanticHints.runtimeContext.capabilities).toContain('timeseries');
    expect(descriptor.semanticHints.runtimeContext.suggestedQueries.length).toBeGreaterThan(0);
    expect(descriptor.semanticHints.runtimeContext.conceptSummary).toContain('complaint');

    await broker2.stop();
  });
});
