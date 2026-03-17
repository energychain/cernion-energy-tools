/**
 * VNB Monitor Service Tests
 *
 * Core tests for VNB monitoring service schema and structure
 */

const { ServiceBroker } = require('moleculer');

describe('vnb-monitor.service', () => {
  let broker;
  let service;

  beforeAll(() => {
    broker = new ServiceBroker({
      logger: false,
    });

    // Mock grid-operations service
    broker.createService({
      name: 'grid-operations',
      actions: {
        vnbLookup: {
          handler() {
            return {
              success: true,
              data: {
                bdew: '10002954',
                mastrId: null,
                companyName: null,
                source: 'not-found',
              },
            };
          },
        },
        marketPartners: {
          handler() {
            return {
              success: true,
              data: {
                results: [
                  {
                    companyName: 'EWR Netz GmbH',
                    bdewCode: '9900701000005',
                    mastrNetzbetreiberId: 'SNB969068596941 (strom, 100% Match)',
                    contacts: [{ city: 'Alzey' }],
                  },
                ],
              },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'ewk-monitoring',
      actions: {
        anschlussdauer: {
          handler() {
            return {
              success: true,
              data: [
                {
                  type: 'text',
                  json: {
                    stats: {
                      ee_ns_gesamt: { median: 40 },
                      verbrauch_ns_gesamt: { median: 30 },
                    },
                    rows: [
                      {
                        firmenname: 'EWR Netz GmbH',
                        ee_ns_phase1_wochen: 7,
                        ee_ns_phase2_wochen: 75,
                        ee_ns_gesamt_wochen: 82,
                        ee_ms_gesamt_wochen: 141,
                        verbrauch_ns_gesamt_wochen: 218,
                        rank_ee_ns: '604 / 740',
                        rank_verbrauch_ns: '701 / 708',
                      },
                    ],
                  },
                },
              ],
            };
          },
        },
        umsetzungsquote: {
          handler() {
            return {
              success: true,
              data: [
                {
                  type: 'text',
                  json: {
                    rows: [
                      {
                        firmenname: 'EWR Netz GmbH',
                        umsetzungsquote_ee_ns: 38.6,
                        umsetzungsquote_verbrauch_ns: 11.7,
                        umsetzungsquote_verbrauch_ms: 98.6,
                        rank_umsetzungsquote_ee_ns: '639 / 698',
                      },
                    ],
                  },
                },
              ],
            };
          },
        },
        digitalisierungsindex: {
          handler() {
            return {
              success: true,
              data: [
                {
                  type: 'text',
                  json: {
                    stats: {
                      gesamtscore: { median: 30, n: 656 },
                    },
                    rows: [
                      {
                        firmenname: 'EWR Netz GmbH',
                        smart_grids_ns: 19,
                        datenmanagement: 44,
                        kundenmanagement_webportale: 84,
                        digitale_prozesse_ai: 0,
                      },
                    ],
                  },
                },
              ],
            };
          },
        },
      },
    });

    // Mock energy-market service
    broker.createService({
      name: 'energy-market',
      actions: {
        prices: {
          handler() {
            return {
              success: true,
              dataPoints: [{ timestamp: '2026-03-17T00:00:00.000Z', priceEURperMWh: 89.08 }],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'gas-storage',
      actions: {
        countryStorage: {
          handler() {
            return {
              success: true,
              data: {
                storage: { fillPercentage: 21.98 },
              },
              metadata: { timestamp: '2026-03-17T00:00:00.000Z' },
            };
          },
        },
      },
    });

    broker.createService({
      name: 'assets',
      actions: {
        all: {
          handler(ctx) {
            if (ctx.params.netzbetreiberPruefungStatus === '2955') {
              return [
                { Anlagentyp: 'solar', 'Leistung MW': 12.5 },
                { Anlagentyp: 'storage', 'Leistung MW': 4.0 },
              ];
            }

            if (ctx.params.operationalStatus === '31') {
              return [
                { Anlagentyp: 'solar', 'Leistung MW': 15.0 },
                { Anlagentyp: 'wind', 'Leistung MW': 5.0 },
              ];
            }

            return [
              { Anlagentyp: 'solar', 'Leistung MW': 61.0 },
              { Anlagentyp: 'solar', 'Leistung MW': 10.0 },
              { Anlagentyp: 'wind', 'Leistung MW': 135.0 },
              { Anlagentyp: 'storage', 'Leistung MW': 7.0 },
            ];
          },
        },
      },
    });

    // Load the VNB Monitor service
    service = broker.createService(require('../services/vnb-monitor.service'));

    return broker.start();
  });

  afterAll(() => broker.stop());

  describe('snapshot action', () => {
    it('should return object with required top-level properties', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
        alerts: false,
      });

      expect(result).toHaveProperty('schemaVersion');
      expect(result).toHaveProperty('bdewCode');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('cachedAt');
      expect(result).toHaveProperty('ttlSeconds');
      expect(result).toHaveProperty('identity');
      expect(result).toHaveProperty('ewk');
      expect(result).toHaveProperty('mastr');
      expect(result).toHaveProperty('market');
      expect(result).toHaveProperty('alerts');
      expect(result).toHaveProperty('alertSummary');
      expect(result).toHaveProperty('sourceErrors');
    });

    it('should have correct schema version', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.schemaVersion).toBe('1.0');
    });

    it('should return correct BDEW code', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.bdewCode).toBe('10002954');
    });

    it('should have valid identity object', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.identity).toHaveProperty('name');
      expect(result.identity).toHaveProperty('mastrId');
      expect(result.identity).toHaveProperty('bdewCode');
      expect(result.identity).toHaveProperty('location');
      expect(result.identity).toHaveProperty('resolvedAt');
    });

    it('should have EWK object structure', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.ewk).toHaveProperty('sourceAvailable');
      expect(result.ewk).toHaveProperty('reportYear');
      expect(result.ewk).toHaveProperty('anschlussdauer');
      expect(result.ewk).toHaveProperty('umsetzungsquote');
      expect(result.ewk).toHaveProperty('digitalisierungsindex');
    });

    it('should have MaStR object structure', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.mastr).toHaveProperty('sourceAvailable');
      expect(result.mastr).toHaveProperty('asOf');
      expect(result.mastr).toHaveProperty('inBetrieb');
      expect(result.mastr).toHaveProperty('inPlanung');
      expect(result.mastr).toHaveProperty('netzbetreiberPruefung');
    });

    it('should have market object structure', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.market).toHaveProperty('sourceAvailable');
      expect(result.market).toHaveProperty('dayAheadPrice_eurMWh');
      expect(result.market).toHaveProperty('co2Intensity_gCO2eqKWh');
      expect(result.market).toHaveProperty('gasStorageDE_percent');
      expect(result.market).toHaveProperty('gasStorageStatus');
      expect(result.market).toHaveProperty('timestamp');
    });

    it('should have alertSummary object with required fields', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.alertSummary).toHaveProperty('total');
      expect(result.alertSummary).toHaveProperty('critical');
      expect(result.alertSummary).toHaveProperty('warning');
      expect(result.alertSummary).toHaveProperty('info');
      expect(result.alertSummary).toHaveProperty('ewkRelevant');
    });

    it('should have valid ISO timestamps', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.cachedAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should have sourceErrors array', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(Array.isArray(result.sourceErrors)).toBe(true);
    });

    it('should respect alerts parameter', async () => {
      const resultWithAlerts = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
        alerts: true,
      });

      const resultWithoutAlerts = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
        alerts: false,
      });

      expect(Array.isArray(resultWithAlerts.alerts)).toBe(true);
      expect(resultWithoutAlerts.alerts).toEqual([]);
    });

    it('should use cache when refresh=false', async () => {
      // Prime cache
      await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      // Call again with cache
      const start = Date.now();
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: false,
      });
      const elapsed = Date.now() - start;

      // Cache should be much faster
      expect(elapsed).toBeLessThan(100);
      expect(result.schemaVersion).toBe('1.0');
    });
  });

  describe('snapshotMulti action', () => {
    it('should return array of snapshots', async () => {
      const result = await broker.call('vnb-monitor.snapshotMulti', {
        bdewCodes: '10002954,10002954',
        refresh: true,
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should have schema v1.0 for all items', async () => {
      const result = await broker.call('vnb-monitor.snapshotMulti', {
        bdewCodes: '10002954,10002954',
        refresh: true,
      });

      result.forEach((item) => {
        expect(item.schemaVersion).toBe('1.0');
      });
    });

    it('should parse BDEW codes correctly with spaces', async () => {
      const result = await broker.call('vnb-monitor.snapshotMulti', {
        bdewCodes: '10002954, 10002954',
        refresh: true,
      });

      expect(result.length).toBe(2);
    });
  });

  describe('alerts action', () => {
    it('should return alerts summary object', async () => {
      const result = await broker.call('vnb-monitor.alerts', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result).toHaveProperty('bdewCode');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('alertCount');
      expect(result).toHaveProperty('criticalCount');
      expect(result).toHaveProperty('alerts');
    });

    it('should have alerts as array', async () => {
      const result = await broker.call('vnb-monitor.alerts', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(Array.isArray(result.alerts)).toBe(true);
    });

    it('should have numeric alert counts', async () => {
      const result = await broker.call('vnb-monitor.alerts', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(typeof result.alertCount).toBe('number');
      expect(typeof result.criticalCount).toBe('number');
    });
  });

  describe('clearCache action', () => {
    it('should clear cache for a VNB', async () => {
      // Prime cache
      await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      // Clear cache
      const result = await broker.call('vnb-monitor.clearCache', {
        bdewCode: '10002954',
      });

      expect(result).toHaveProperty('cleared');
      expect(result.cleared).toBe(true);
    });

    it('should return success for non-existent cache entry', async () => {
      const result = await broker.call('vnb-monitor.clearCache', {
        bdewCode: '99999999',
      });

      expect(result.cleared).toBe(true);
    });
  });

  describe('Response schema compliance', () => {
    it('should always return v1.0 schema', async () => {
      const snapshot = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      const multi = await broker.call('vnb-monitor.snapshotMulti', {
        bdewCodes: '10002954',
        refresh: true,
      });

      expect(snapshot.schemaVersion).toBe('1.0');
      expect(multi[0].schemaVersion).toBe('1.0');
    });

    it('should have ttlSeconds property', async () => {
      const result = await broker.call('vnb-monitor.snapshot', {
        bdewCode: '10002954',
        refresh: true,
      });

      expect(result.ttlSeconds).toBe(3600);
    });
  });
});
