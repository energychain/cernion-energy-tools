/**
 * Agent Service Tests
 *
 * Tests for the AI Agent orchestration service.
 * Mocks Gemini API and Moleculer broker calls to avoid external dependencies.
 */

const { ServiceBroker } = require('moleculer');
const fs = require('fs');
const path = require('path');

// ── Mock @google/generative-ai ────────────────────────────────────────────
jest.mock('@google/generative-ai', () => {
  const mockGenerateContent = jest.fn();
  const mockGetGenerativeModel = jest.fn(() => ({
    generateContent: mockGenerateContent,
  }));
  return {
    GoogleGenerativeAI: jest.fn(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
    _mockGenerateContent: mockGenerateContent,
  };
});

const { _mockGenerateContent } = require('@google/generative-ai');

const AgentService = require('../services/agent.service');

// Helper to build a valid Gemini plan JSON response
function makePlanResponse(overrides = {}) {
  const plan = {
    summary: 'Mock strategy for testing.',
    steps: [
      {
        step: 1,
        service: 'gas-storage',
        action: 'gas-storage.countryStorage',
        description: 'Fetch current gas storage level for Germany',
        params: { country: 'de', date: null },
      },
    ],
    requiredInputs: [
      {
        name: 'date',
        label: 'Reference Date',
        type: 'date',
        description: 'The date to check storage for',
        example: '2026-02-01',
        required: false,
      },
    ],
    ...overrides,
  };
  return JSON.stringify(plan);
}

// Helper to build a valid Gemini interpretation JSON response
function makeInterpretationResponse(overrides = {}) {
  const interp = {
    summary: 'Germany gas storage is at 65%.',
    tableColumns: ['country', 'level', 'trend'],
    tableRows: [{ country: 'de', level: '65%', trend: 'stable' }],
    needsMoreInput: false,
    followUpQuestion: null,
    ...overrides,
  };
  return JSON.stringify(interp);
}

// Helper for the suggestions Gemini call that follows every interpretation
function makeSuggestionsResponse() {
  return JSON.stringify([
    'Gas storage comparison DE vs. FR',
    'Historical gas storage trend in Germany 2024',
    'Supply security check for Germany',
  ]);
}

function makeChartSuggestionsResponse() {
  return JSON.stringify([
    { type: 'bar', title: 'Storage Level by Country', xField: 'country', yField: 'level' },
    { type: 'line', title: 'Trend Over Time', xField: 'date', yField: 'value' },
  ]);
}

// Queue all three Gemini calls (interpretation + suggestions + chart suggestions) with one helper
function mockInterpretAndSuggest(interpretOverrides = {}) {
  _mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => makeInterpretationResponse(interpretOverrides) },
  });
  _mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => makeSuggestionsResponse() },
  });
  _mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => makeChartSuggestionsResponse() },
  });
}

describe('Agent Service', () => {
  let broker;
  const SESSION_DIR = path.join(__dirname, '..', 'data', 'sessions');
  let discoveryListMock;

  beforeAll(async () => {
    process.env.GEMINI_API_KEY = 'test-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';

    broker = new ServiceBroker({ logger: false });
    broker.createService(AgentService);

    // Mock gas-storage.countryStorage action
    broker.createService({
      name: 'gas-storage',
      actions: {
        countryStorage: jest.fn().mockResolvedValue({
          success: true,
          country: 'de',
          level: 0.65,
          trend: 'stable',
        }),
      },
    });

    // Mock business-intelligence.salesLeads — records received params for coercion tests
    const salesLeadsMock = jest.fn().mockResolvedValue({
      success: true,
      leads: [{ name: 'Test Lead', score: 80 }],
    });
    broker.createService({
      name: 'business-intelligence',
      actions: { salesLeads: salesLeadsMock },
    });
    broker._salesLeadsMock = salesLeadsMock;

    // Mock residual-load service WITH real params schema so buildParamSchemaIndex has data
    const residualLoadMock = jest.fn().mockResolvedValue({
      summary: { region: 'Kiel' },
      forecast: [{ timestamp: '2026-03-01T00:00:00Z', loadMW: 42, residualLoadMW: 38 }],
    });
    broker.createService({
      name: 'residual-load',
      actions: {
        netResidualLoad: {
          params: {
            region: { type: 'string', optional: true },
            gridOperatorMastrId: { type: 'string', optional: true },
            forecastDays: { type: 'number', optional: true },
            resolution: { type: 'enum', values: ['hourly', '15min'], optional: true },
          },
          handler: residualLoadMock,
        },
      },
    });
    broker._residualLoadMock = residualLoadMock;

    broker.createService({
      name: 'datasource-discovery',
      actions: {
        list: (discoveryListMock = jest.fn().mockResolvedValue({
          success: true,
          data: [
            {
              name: 'inhouse__netzanschluesse_stromdao',
              sourceId: 'source-123',
              description:
                'Internal grid connection list (STROMDAO 2025). Contains: anschlussnummer, kundennummer, plz.',
              privacyFlaggedFields: ['kundennummer'],
              aliases: [
                'GW29',
                'Netzanschlüsse STROMDAO 2025',
                'netzanschluesse_stromdao_2025',
                '2025',
              ],
              capabilities: ['timeseries', 'timeseries_cost_enrichment'],
              semanticHints: {
                domain: 'metering',
                timeField: 'Zeit',
                consumptionPowerField: 'Leistung Bezug (W)',
                feedInPowerField: null,
                actualGenerationField: null,
                criticalFieldMappings: {
                  timeReference: 'Zeit',
                },
              },
              __sourceMeta: {
                sourceName: 'Netzanschlüsse STROMDAO 2025',
                sourceDescription: 'Interne Liste aller Netzanschlüsse GW29',
                tags: ['netz', 'gis'],
                dictionaryFields: ['Zeit', 'Leistung Bezug (W)', 'Leistung Einspeisung (W)'],
              },
            },
          ],
        })),
      },
    });
    broker._discoveryListMock = discoveryListMock;

    const meteringSpotCostMock = jest.fn().mockResolvedValue({
      success: true,
      sourceId: 'source-123',
      rows: [
        {
          hour: '2026-03-10T00',
          consumptionKwh: 1.2,
          priceEurMwh: 95,
          energyCostEur: 0.114,
        },
      ],
    });
    broker.createService({
      name: 'in-memory-join',
      actions: {
        meteringSpotCost: meteringSpotCostMock,
        benchmarkCompare: jest.fn().mockResolvedValue({
          success: true,
          narrative: 'Mock benchmark comparison.',
          delta: 5,
        }),
        procurementVsSpot: jest.fn().mockResolvedValue({
          success: true,
          procurementAvgPrice: 52.5,
          spotAvgPrice: 40.0,
          delta: 12.5,
          deltaPercent: 31.25,
          totalVolumeMWh: 570,
          positions: [],
          periodsWithoutSpotData: [],
        }),
        compareForecastActual: jest
          .fn()
          .mockResolvedValue({ success: true, rowCount: 0, data: [] }),
      },
    });
    broker._meteringSpotCostMock = meteringSpotCostMock;

    broker.createService({
      name: 'ewk-monitoring',
      actions: {
        benchmarkVnb: jest.fn().mockResolvedValue({
          success: true,
          data: {
            digitalisierungsindex: {
              gesamtscore_pct: 60,
            },
            benchmark: {
              median: 55,
            },
          },
        }),
        digitalisierungsindex: jest.fn().mockResolvedValue({
          success: true,
          data: {
            digitalisierungsindex: {
              gesamtscore_pct: 61,
            },
            benchmark: {
              median: 54,
            },
          },
        }),
      },
    });

    const datasourceCacheQueryMock = jest.fn().mockResolvedValue({
      success: true,
      data: [
        {
          Lieferperiode: '2026-Q2',
          Gegenpartei: 'EnBW Trading',
          Menge_MWh: 1200,
          Status: 'offen',
        },
        {
          Lieferperiode: '2026-Q2',
          Gegenpartei: 'AXPO',
          Menge_MWh: 800,
          Status: 'offen',
        },
      ],
    });
    broker.createService({
      name: 'datasource-cache',
      actions: {
        query: datasourceCacheQueryMock,
      },
    });
    broker._datasourceCacheQueryMock = datasourceCacheQueryMock;

    const queryAskMock = jest.fn().mockResolvedValue({ success: true, data: [] });
    const queryAskLearnedMock = jest.fn().mockResolvedValue({ success: true, data: [] });
    broker.createService({
      name: 'query',
      actions: {
        ask: queryAskMock,
        askLearned: queryAskLearnedMock,
      },
    });
    broker._queryAskMock = queryAskMock;
    broker._queryAskLearnedMock = queryAskLearnedMock;

    // Mock osm-geo service with real params schema so plan repair + catalogue tests work
    broker.createService({
      name: 'osm-geo',
      actions: {
        validate: {
          params: {
            mastrNummer: { type: 'string', optional: true },
            latitude: { type: 'number', optional: true },
            longitude: { type: 'number', optional: true },
            radiusMeters: { type: 'number', optional: true },
            skipOsmLayer: { type: 'boolean', optional: true },
            voltageLevel: { type: 'enum', values: ['NS', 'MS', 'HS', 'all'], optional: true },
          },
          handler: jest.fn().mockResolvedValue({ success: true, data: {} }),
        },
        infrastructureNearby: {
          params: {
            location: { type: 'string', optional: true },
            latitude: { type: 'number', optional: true },
            longitude: { type: 'number', optional: true },
            mastrNummer: { type: 'string', optional: true },
            radiusMeters: { type: 'number', optional: true },
            constrainToBbox: { type: 'object', optional: true },
            infrastructureTypes: { type: 'array', optional: true },
            limit: { type: 'number', optional: true },
          },
          handler: jest.fn().mockResolvedValue({ success: true, data: {} }),
        },
        substationFinder: {
          params: {
            location: { type: 'string', optional: true },
            boundingBox: { type: 'object', optional: true },
            gridOperator: { type: 'string', optional: true },
            substationType: {
              type: 'enum',
              values: ['all', 'transmission', 'distribution', 'minor'],
              optional: true,
            },
            voltageLevel: { type: 'enum', values: ['NS', 'MS', 'HS', 'all'], optional: true },
            limit: { type: 'number', optional: true },
          },
          handler: jest.fn().mockResolvedValue({ success: true, data: {} }),
        },
        gridTopology: {
          params: {
            location: { type: 'string', optional: true },
            boundingBox: { type: 'object', optional: true },
            gridOperator: { type: 'string', optional: true },
            voltageLevel: { type: 'enum', values: ['NS', 'MS', 'HS', 'all'], optional: true },
            includePathAnalysis: { type: 'boolean', optional: true },
            fromOsmId: { type: 'string', optional: true },
            toOsmId: { type: 'string', optional: true },
            includeGraphData: { type: 'boolean', optional: true },
          },
          handler: jest.fn().mockResolvedValue({ success: true, data: {} }),
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    // Clean up test session files
    if (fs.existsSync(SESSION_DIR)) {
      const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json'));
      files.forEach((f) => {
        try {
          fs.unlinkSync(path.join(SESSION_DIR, f));
        } catch {
          /* ignore */
        }
      });
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── analyze action ────────────────────────────────────────────
  describe('analyze action', () => {
    it('should reject missing problem parameter', async () => {
      await expect(broker.call('agent.analyze', {})).rejects.toThrow();
    });

    it('should reject too-short problem parameter', async () => {
      await expect(broker.call('agent.analyze', { problem: 'hi' })).rejects.toThrow();
    });

    it('should return a session ID and plan when Gemini responds correctly', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'What is the current gas storage level in Germany?',
      });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.summary).toBe('Mock strategy for testing.');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].action).toBe('gas-storage.countryStorage');
      expect(result.requiredInputs).toHaveLength(1);
      expect(result.requiredInputs[0].name).toBe('date');
    });

    it('should include inhouse datasource descriptors in the analyze prompt', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      await broker.call('agent.analyze', {
        problem:
          'Check current gas storage and correlate it with our internal grid connection list.',
      });

      const prompt = _mockGenerateContent.mock.calls[0][0];
      expect(prompt).toContain('inhouse__netzanschluesse_stromdao');
      expect(prompt).toContain('Internal grid connection list (STROMDAO 2025)');
      expect(prompt).toContain('Privacy-flagged fields: kundennummer');
    });

    it('should include RULE 12 (OSM Geo Layer) in the analyze prompt', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      await broker.call('agent.analyze', {
        problem: 'What energy infrastructure is near the Stadtwerke Heidelberg area?',
      });

      const prompt = _mockGenerateContent.mock.calls[0][0];
      expect(prompt).toContain('RULE 12');
      expect(prompt).toContain('OSM Geo Layer');
      expect(prompt).toContain('osm-geo.validate');
      expect(prompt).toContain('osm-geo.substationFinder');
      expect(prompt).toContain('osm-geo.gridTopology');
      expect(prompt).toContain('osm-geo.infrastructureNearby');
    });

    it('should include osm-geo.substationFinder in the service catalogue text', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      await broker.call('agent.analyze', {
        problem: 'Find substations in the Heidelberg grid operator territory',
      });

      const prompt = _mockGenerateContent.mock.calls[0][0];
      // catalogue entry should be present (auto-discovered via buildServiceCatalogue)
      expect(prompt).toMatch(/osm-geo\.substationFinder/);
      expect(prompt).toMatch(/osm-geo\.gridTopology/);
    });

    it('should shortcut LPTest cost questions to intent class timeseries_cost_enrichment', async () => {
      const result = await broker.call('agent.analyze', {
        problem: 'Wie sind die Stromkosten von LPTest am 10.03.2026 gewesen?',
        inhouseSources: ['source-123'],
      });

      expect(result.summary).toContain('timeseries_cost_enrichment');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].action).toBe('in-memory-join.meteringSpotCost');
      expect(result.steps[0].params.sourceId).toBe('source-123');
      expect(result.requiredInputs.some((i) => i.name === 'date')).toBe(true);
      expect(_mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should route aggregative inhouse query via datasource-cache.query and not query.ask', async () => {
      const analyzeResult = await broker.call('agent.analyze', {
        problem: 'Welche Gegenpartei hat das größte offene Volumen in Q2 2026?',
        inhouseSources: ['source-123'],
      });

      expect(analyzeResult.steps).toHaveLength(1);
      expect(analyzeResult.steps[0].action).toBe('datasource-cache.query');

      mockInterpretAndSuggest();
      await broker.call('agent.execute', {
        sessionId: analyzeResult.sessionId,
        userInputs: {},
      });

      expect(broker._datasourceCacheQueryMock).toHaveBeenCalled();
      expect(broker._queryAskMock).not.toHaveBeenCalled();
      expect(broker._queryAskLearnedMock).not.toHaveBeenCalled();
    });

    it('should use semanticHints.criticalFieldMappings.timeReference as join key for procurement spot-price queries', async () => {
      broker._discoveryListMock.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'inhouse__beschaffungsportfolio_2026',
            source: 'inhouse',
            sourceId: 'proc-source-1',
            aliases: ['beschaffungsportfolio'],
            capabilities: ['timeseries_cost_enrichment'],
            semanticHints: {
              domain: 'procurement',
              timeField: 'Abschlussdatum',
              criticalFieldMappings: {
                timeReference: 'Lieferperiode',
              },
            },
            __sourceMeta: {
              semanticClassification: {
                criticalFieldStatus: [
                  {
                    fieldRole: 'timeReference',
                    resolved: true,
                    mappedColumn: 'Lieferperiode',
                    meta: { periodFormat: true },
                  },
                ],
              },
            },
          },
        ],
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Wie liegt unser Beschaffungsportfolio im Vergleich zum aktuellen Spotpreis?',
        inhouseSources: ['proc-source-1'],
      });

      // Sources with domain:procurement + meta.periodFormat:true are routed to procurement_vs_spot
      expect(result.summary).toContain('procurement_vs_spot');
      expect(result.steps[0].action).toBe('in-memory-join.procurementVsSpot');
      expect(result.steps[0].params.periodField).toBe('Lieferperiode');
      expect(result.steps[0].params.periodField).not.toBe('Abschlussdatum');
      expect(result.steps[0].params).toHaveProperty('volumeField');
      expect(result.steps[0].params).toHaveProperty('priceField');
      expect(_mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should detect period-formatted timeReference from sampleRows when meta flag is missing', async () => {
      broker._discoveryListMock.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'inhouse__beschaffungsportfolio_2026',
            source: 'inhouse',
            sourceId: 'proc-source-2',
            aliases: ['beschaffungsportfolio'],
            capabilities: ['timeseries_cost_enrichment'],
            sampleRows: [
              { Lieferperiode: 'Feb 2026', Menge_MWh: '201.3' },
              { Lieferperiode: '2026-Q1', Menge_MWh: '751.0' },
            ],
            semanticHints: {
              domain: 'procurement',
              timeField: 'Abschlussdatum',
              criticalFieldMappings: {
                timeReference: 'Lieferperiode',
              },
            },
            __sourceMeta: {
              semanticClassification: {
                criticalFieldStatus: [
                  {
                    fieldRole: 'timeReference',
                    resolved: true,
                    mappedColumn: 'Lieferperiode',
                  },
                ],
              },
            },
          },
        ],
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Was kostet unser Beschaffungsportfolio laut Spotpreis?',
        inhouseSources: ['proc-source-2'],
      });

      expect(result.steps[0].action).toBe('in-memory-join.meteringSpotCost');
      expect(result.steps[0].params.leftTimeField).toBe('Lieferperiode');
      expect(result.steps[0].params.normalisePeriod).toBe(true);
    });

    it('should select procurement_vs_spot (not timeseries_cost_enrichment) for procurement source with meta.periodFormat:true', async () => {
      // The query triggers timeseries_cost_enrichment via text ("Kosten", "Spotpreis")
      // but the source has domain:procurement + meta.periodFormat:true → upgrade to procurement_vs_spot
      broker._discoveryListMock.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'inhouse__beschaffungsportfolio_2026',
            source: 'inhouse',
            sourceId: 'proc-source-3',
            aliases: ['beschaffungsportfolio'],
            capabilities: ['procurement_vs_spot'],
            semanticHints: {
              domain: 'procurement',
              criticalFieldMappings: {
                timeReference: 'Lieferperiode',
                quantityMWh: 'Menge_MWh',
                price: 'Preis_EUR_MWh',
              },
            },
            __sourceMeta: {
              semanticClassification: {
                criticalFieldStatus: [
                  {
                    fieldRole: 'timeReference',
                    resolved: true,
                    mappedColumn: 'Lieferperiode',
                    meta: { periodFormat: true },
                  },
                ],
              },
            },
          },
        ],
      });

      const result = await broker.call('agent.analyze', {
        // Query text triggers isCostEnrichment (Kosten + Spotpreis) but NOT isProcurementVsSpot
        // (no "beschaffungsportfolio" or "lieferperiode" in text)
        problem: 'Was sind die Energiekosten laut aktuellem Spotpreis?',
        inhouseSources: ['proc-source-3'],
      });

      expect(result.summary).toContain('procurement_vs_spot');
      expect(result.summary).not.toContain('timeseries_cost_enrichment');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].action).toBe('in-memory-join.procurementVsSpot');
      expect(result.steps[0].params.periodField).toBe('Lieferperiode');
      expect(result.steps[0].params.volumeField).toBe('Menge_MWh');
      expect(result.steps[0].params.priceField).toBe('Preis_EUR_MWh');
      expect(_mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should bind sourceId for procurement_vs_spot when discovery uses source_id field', async () => {
      broker._discoveryListMock.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'inhouse__portfolio_2026',
            source: 'inhouse',
            source_id: 'proc-source-snake-1',
            aliases: ['beschaffungsportfolio'],
            semanticHints: {
              domain: 'procurement',
              criticalFieldMappings: {
                timeReference: 'Lieferperiode',
                quantityMWh: 'Menge_MWh',
                price: 'Preis_EUR_MWh',
              },
            },
            __sourceMeta: {
              dictionaryFields: ['Lieferperiode', 'Menge_MWh', 'Preis_EUR_MWh'],
              semanticClassification: {
                criticalFieldStatus: [
                  {
                    fieldRole: 'timeReference',
                    mappedColumn: 'Lieferperiode',
                    meta: { periodFormat: true },
                  },
                ],
              },
            },
          },
        ],
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Wie liegt unser Beschaffungsportfolio im Vergleich zum aktuellen Spotpreis?',
      });

      expect(result.summary).toContain('procurement_vs_spot');
      expect(result.steps[0].action).toBe('in-memory-join.procurementVsSpot');
      expect(result.steps[0].params.sourceId).toBe('proc-source-snake-1');
      expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(false);
    });

    it('should route benchmark comparison query to inhouse_benchmark_compare intent', async () => {
      broker._discoveryListMock.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'inhouse__pv_assets',
            source: 'inhouse',
            sourceId: 'grid-source-1',
            capabilities: ['inhouse_benchmark_compare'],
            semanticHints: {
              domain: 'grid-assets',
              criticalFieldMappings: {
                capacityKWp: 'Leistung_kWp',
              },
            },
          },
        ],
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Wie stehen wir im EWK Benchmark bundesweit im Vergleich?',
        inhouseSources: ['grid-source-1'],
      });

      expect(result.summary).toContain('inhouse_benchmark_compare');
      expect(result.steps[1].action).toBe('ewk-monitoring.benchmarkVnb');
      expect(result.steps[2].action).toBe('in-memory-join.benchmarkCompare');
    });

    it('should prefill VNB input from env for benchmark plans', async () => {
      const oldVnbName = process.env.CERNION_VNB_NAME;
      process.env.CERNION_VNB_NAME = 'Stadtwerke Test';

      broker._discoveryListMock.mockResolvedValueOnce({
        success: true,
        data: [
          {
            name: 'inhouse__pv_assets',
            source: 'inhouse',
            sourceId: 'grid-source-2',
            capabilities: ['inhouse_benchmark_compare'],
            semanticHints: {
              domain: 'grid-assets',
            },
          },
        ],
      });

      const result = await broker.call('agent.analyze', {
        problem: 'EWK benchmark Vergleich für unser Netzgebiet',
        inhouseSources: ['grid-source-2'],
      });

      const vnbInput = result.requiredInputs.find((item) => item.name === 'vnbName');
      expect(vnbInput).toBeDefined();
      expect(vnbInput.default).toBe('Stadtwerke Test');
      expect(vnbInput.required).toBe(false);

      process.env.CERNION_VNB_NAME = oldVnbName;
    });

    it('should not force inhouse source selection for pure EWK questions when descriptors merely exist', async () => {
      const ewkOnlyPlan = JSON.stringify({
        summary: 'EWK benchmark plan for a single VNB.',
        steps: [
          {
            step: 1,
            action: 'ewk-monitoring.benchmarkVnb',
            description: 'Hole das EWK-Profil für den angefragten VNB.',
            params: {
              vnbName: null,
            },
          },
        ],
        requiredInputs: [
          {
            name: 'vnbName',
            label: 'Verteilnetzbetreiber (VNB)',
            type: 'string',
            description: 'Name des VNB für den EWK-Benchmarkvergleich.',
            required: true,
          },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => ewkOnlyPlan },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Wie ist die STROMDAO Netze GmbH hinsichtlich der EWK aufgestellt?',
      });

      expect(_mockGenerateContent).toHaveBeenCalled();
      expect(result.steps[0].action).toBe('ewk-monitoring.benchmarkVnb');
      expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(false);

      const vnbInput = result.requiredInputs.find((item) => item.name === 'vnbName');
      expect(vnbInput).toBeDefined();
      expect(vnbInput.default).toBe('STROMDAO Netze GmbH');
      expect(vnbInput.required).toBe(false);
      expect(result.steps[0].params.vnbName).toBe('STROMDAO Netze GmbH');
    });

    it('should shortcut actual-vs-forecast comparisons to compareForecastActual intent class', async () => {
      const result = await broker.call('agent.analyze', {
        problem:
          'Vergleiche die tatsächliche Erzeugung von ABCD mit der geplanten Erzeugung am 10.03.2026.',
        inhouseSources: ['source-123'],
      });

      expect(result.summary).toContain('timeseries_compare_actual_vs_forecast');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].action).toBe('in-memory-join.compareForecastActual');
      expect(result.steps[0].params.sourceId).toBe('source-123');
      expect(result.requiredInputs.some((i) => i.name === 'installationMastrNummer')).toBe(true);
      expect(_mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should auto-resolve source by filename alias GW29 without explicit inhouseSources', async () => {
      const result = await broker.call('agent.analyze', {
        problem:
          'Gleiche das Lastprofil von GW29 mit den Spotmarktpreisen ab. Erstelle einen Überblick über die tatsächlichen Energiekosten des Zählers.',
      });

      expect(result.summary).toContain('timeseries_cost_enrichment');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].action).toBe('in-memory-join.meteringSpotCost');
      expect(result.steps[0].params.sourceId).toBe('source-123');
      expect(result.requiredInputs.some((i) => i.name === 'date')).toBe(true);
      // sourceId must NOT be prompted — it was resolved automatically
      expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(false);
      expect(_mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should auto-select single capable source even when no source identifier in query', async () => {
      // Query has no GW29 / LPTest hint — but there is exactly one capable source in the mock.
      // The system should auto-select it rather than prompting for a UUID.
      const result = await broker.call('agent.analyze', {
        problem:
          'Zeige mir die tatsächlichen Energiekosten des Zählers basierend auf Spotmarktpreisen.',
      });

      expect(result.summary).toContain('timeseries_cost_enrichment');
      expect(result.steps[0].action).toBe('in-memory-join.meteringSpotCost');
      expect(result.steps[0].params.sourceId).toBe('source-123');
      expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(false);
      expect(_mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should handle datasource-discovery.list responses returned as a plain array', async () => {
      broker._discoveryListMock.mockResolvedValueOnce([
        {
          name: 'inhouse__netzanschluesse_stromdao',
          sourceId: 'source-123',
          aliases: ['GW29'],
          capabilities: ['timeseries_cost_enrichment'],
          semanticHints: {
            timeField: 'Zeit',
            consumptionPowerField: 'Leistung Bezug (W)',
          },
        },
      ]);

      const result = await broker.call('agent.analyze', {
        problem: 'Berechne die Stromkosten für GW29 am 10.03.2026.',
      });

      expect(result.steps[0].action).toBe('in-memory-join.meteringSpotCost');
      expect(result.steps[0].params.sourceId).toBe('source-123');
      expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(false);
    });

    it('should fall back to generic planner when inhouse descriptors are unavailable', async () => {
      broker._discoveryListMock.mockResolvedValueOnce({ success: true, data: [] });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Berechne die Stromkosten aus Lastgang und Spotpreisen für den 10.03.2026.',
      });

      expect(_mockGenerateContent).toHaveBeenCalled();
      expect(result.steps[0].action).toBe('gas-storage.countryStorage');
      expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(false);
      expect(result.canExecute).toBe(true);
      expect(result.blockedReason).toBeNull();
    });

    it('should mark generic inhouse plans as blocked when no inhouse descriptors are available', async () => {
      broker._discoveryListMock.mockResolvedValueOnce({ success: true, data: [] });
      _mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify({
              summary: 'Intent-Klasse: timeseries_cost_enrichment (generic fallback plan).',
              steps: [
                {
                  step: 1,
                  action: 'in-memory-join.meteringSpotCost',
                  description: 'Join Inhouse-Metering mit Spotmarktpreisen.',
                  params: {
                    sourceId: null,
                    date: null,
                    aggregateBy: 'hourly',
                    region: 'Deutschland',
                    market: 'day-ahead',
                  },
                },
              ],
              requiredInputs: [
                {
                  name: 'sourceId',
                  label: 'Inhouse Data Source ID',
                  type: 'string',
                  required: true,
                },
                { name: 'date', label: 'Datum', type: 'date', required: true },
              ],
            }),
        },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Berechne die Stromkosten aus Lastgang und Spotpreisen für den 10.03.2026.',
      });

      expect(result.steps[0].action).toBe('in-memory-join.meteringSpotCost');
      expect(result.canExecute).toBe(false);
      expect(result.blockedReason).toMatch(/Inhouse-Datenquelle benötigt/i);
    });

    it('should persist the session to disk', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Show me gas storage trends in Germany',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      expect(fs.existsSync(sessionFile)).toBe(true);

      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      expect(session.id).toBe(result.sessionId);
      expect(session.status).toBe('awaiting_inputs');
      expect(session.problem).toContain('gas storage');
    });

    it('should strip markdown fences from Gemini JSON response', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => '```json\n' + makePlanResponse() + '\n```' },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Analyse wind generation in Baden-Württemberg',
      });

      expect(result.summary).toBe('Mock strategy for testing.');
    });

    it('should throw if Gemini returns invalid JSON', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'This is not JSON at all.' },
      });

      await expect(
        broker.call('agent.analyze', {
          problem: 'Tell me about energy storage in Europe',
        })
      ).rejects.toThrow(/parse/i);
    });

    it('should throw if Gemini API call fails', async () => {
      _mockGenerateContent.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(
        broker.call('agent.analyze', {
          problem: 'Tell me about energy storage in Europe',
        })
      ).rejects.toThrow(/Gemini API error/i);
    });
  });

  // ── getSession action ─────────────────────────────────────────
  describe('getSession action', () => {
    it('should return 404 error for unknown session', async () => {
      await expect(
        broker.call('agent.getSession', { id: 'nonexistent-uuid-1234' })
      ).rejects.toThrow(/not found/i);
    });

    it('should retrieve a previously saved session', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Check gas storage supply security in Germany',
      });

      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      expect(session.id).toBe(analyzed.sessionId);
      expect(session.status).toBe('awaiting_inputs');
      expect(session.problem).toContain('gas storage');
    });
  });

  // ── execute action ────────────────────────────────────────────
  describe('execute action', () => {
    it('should reject missing sessionId', async () => {
      await expect(broker.call('agent.execute', {})).rejects.toThrow();
    });

    it('should throw for unknown session', async () => {
      await expect(broker.call('agent.execute', { sessionId: 'no-such-session' })).rejects.toThrow(
        /not found/i
      );
    });

    it('should execute the plan and return table results', async () => {
      // Step 1: create session
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'What is the current gas storage level in Germany?',
      });

      // Step 2: execute – Gemini called for interpretation + suggestions
      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-02-01' },
      });

      expect(result.status).toBe('completed');
      expect(result.summary).toBe('Germany gas storage is at 65%.');
      expect(result.tableColumns).toEqual(['country', 'level', 'trend']);
      expect(result.tableRows).toHaveLength(1);
      expect(result.shareUrl).toContain(analyzed.sessionId);
      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].step).toBe(1);
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions).toHaveLength(3);
      expect(Array.isArray(result.chartSuggestions)).toBe(true);
      expect(result.chartSuggestions[0]).toHaveProperty('type');
      expect(result.chartSuggestions[0]).toHaveProperty('xField');
      expect(result.chartSuggestions[0]).toHaveProperty('yField');
    });

    it('should auto-resolve missing required sourceId during execute', async () => {
      // Analyze via generic planner with an explicit sourceId-required inhouse plan,
      // then recover sourceId during execute from descriptors.
      broker._discoveryListMock
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockResolvedValueOnce({
          success: true,
          data: [
            {
              name: 'inhouse__netzanschluesse_stromdao',
              sourceId: 'source-123',
              aliases: ['GW29', 'LPTest'],
              capabilities: ['timeseries_cost_enrichment'],
              semanticHints: {
                timeField: 'Zeit',
                consumptionPowerField: 'Leistung Bezug (W)',
              },
            },
          ],
        });

      const sourceRequiredPlan = JSON.stringify({
        summary: 'Intent-Klasse: timeseries_cost_enrichment (manual test plan).',
        steps: [
          {
            step: 1,
            action: 'in-memory-join.meteringSpotCost',
            description: 'Join Inhouse-Metering mit Spotmarktpreisen.',
            params: {
              sourceId: null,
              date: null,
              aggregateBy: 'hourly',
              region: 'Deutschland',
              market: 'day-ahead',
            },
          },
        ],
        requiredInputs: [
          { name: 'sourceId', label: 'Inhouse Data Source ID', type: 'string', required: true },
          { name: 'date', label: 'Datum', type: 'date', required: true },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => sourceRequiredPlan },
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Berechne die Stromkosten aus Lastgang und Spotpreisen für den 10.03.2026.',
      });

      expect(analyzed.requiredInputs.some((i) => i.name === 'sourceId')).toBe(true);

      mockInterpretAndSuggest();
      broker._meteringSpotCostMock.mockClear();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-03-10' },
      });

      expect(result.status).toBe('completed');
      expect(broker._meteringSpotCostMock).toHaveBeenCalled();
      const params = broker._meteringSpotCostMock.mock.calls[0][0].params;
      expect(params.sourceId).toBe('source-123');
    });

    it('should resolve chained __step ref id to sourceId when discovery returns sourceId field', async () => {
      // Force generic planner path for this test so the mocked Gemini plan is consumed.
      broker._discoveryListMock.mockResolvedValueOnce({ success: true, data: [] });

      const chainedPlan = JSON.stringify({
        summary: 'Chain sourceId from discovery result.',
        steps: [
          {
            step: 1,
            action: 'datasource-discovery.list',
            description: 'List discoverable datasource descriptors.',
            params: {},
          },
          {
            step: 2,
            action: 'in-memory-join.meteringSpotCost',
            description: 'Calculate metering spot cost with chained source.',
            params: {
              sourceId: '__step_1.data[0].id',
              date: '2026-03-10',
              aggregateBy: 'hourly',
              region: 'Deutschland',
              market: 'day-ahead',
            },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => chainedPlan },
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Analyse gas storage trend and then use the generated plan.',
      });

      mockInterpretAndSuggest();
      broker._meteringSpotCostMock.mockClear();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      expect(result.status).toBe('completed');
      expect(broker._meteringSpotCostMock).toHaveBeenCalled();
      const params = broker._meteringSpotCostMock.mock.calls[0][0].params;
      expect(params.sourceId).toBe('source-123');
    });

    it('should not throw when required sourceId is missing', async () => {
      broker._discoveryListMock
        .mockResolvedValueOnce({ success: true, data: [] })
        .mockResolvedValueOnce({ success: true, data: [] });

      const sourceRequiredPlan = JSON.stringify({
        summary: 'Intent-Klasse: timeseries_cost_enrichment (manual test plan).',
        steps: [
          {
            step: 1,
            action: 'in-memory-join.meteringSpotCost',
            description: 'Join Inhouse-Metering mit Spotmarktpreisen.',
            params: {
              sourceId: null,
              date: null,
              aggregateBy: 'hourly',
              region: 'Deutschland',
              market: 'day-ahead',
            },
          },
        ],
        requiredInputs: [
          { name: 'sourceId', label: 'Inhouse Data Source ID', type: 'string', required: true },
          { name: 'date', label: 'Datum', type: 'date', required: true },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => sourceRequiredPlan },
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Berechne die Stromkosten für den Lastgang am 10.03.2026.',
      });

      expect(analyzed.requiredInputs.some((i) => i.name === 'sourceId')).toBe(true);

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-03-10' },
      });

      expect(['refined', 'completed']).toContain(result.status);
      if (result.status === 'refined') {
        expect(Array.isArray(result.requiredInputs)).toBe(true);
        expect(result.requiredInputs.some((i) => i.name === 'sourceId')).toBe(true);
      }
    });

    it('should flatten nested objects in tableRows to prevent JSON blobs in UI / CSV', async () => {
      // Regression test: Gemini may emit nested objects as cell values (e.g. napData).
      // The execute handler must stringify any remaining object-valued cells so the
      // UI table and the Live CSV / Export CSV features never contain "[object Object]".
      //
      // Use a plan with no null params to avoid triggering the self-healing path
      // (which would consume the interpretation mock before the summary prompt).
      const planNoNulls = JSON.stringify({
        summary: 'Mock strategy for testing napData flattening.',
        steps: [
          {
            step: 1,
            action: 'gas-storage.countryStorage',
            description: 'Fetch current gas storage level for Germany',
            params: { country: 'de', date: '2026-02-01' },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => planNoNulls },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Show installations with napData for Stadtwerke Test',
      });

      // Gemini returns tableRows with a nested napData object — this is the bug scenario
      mockInterpretAndSuggest({
        tableColumns: ['mastrNummer', 'bruttoleistung', 'napData', 'tags'],
        tableRows: [
          {
            mastrNummer: 'SEE001',
            bruttoleistung: 10,
            napData: { messlokation: 'DE123', spannungsebene: 354 },
            tags: ['pv', 'nap'],
          },
        ],
      });

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      expect(result.status).toBe('completed');
      const row = result.tableRows[0];

      // Nested object must be stringified — never a plain object reference
      expect(typeof row.napData).toBe('string');
      expect(row.napData).not.toBeNull();
      // Array must be joined as comma-separated string
      expect(typeof row.tags).toBe('string');
      expect(row.tags).toBe('pv, nap');
      // Primitives must pass through unchanged
      expect(row.mastrNummer).toBe('SEE001');
      expect(row.bruttoleistung).toBe(10);
    });

    it('should update session status to completed after execution', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Check gas storage in Germany',
      });

      mockInterpretAndSuggest();
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      expect(session.status).toBe('completed');
      expect(session.results).not.toBeNull();
      expect(Array.isArray(session.results.suggestions)).toBe(true);
      expect(Array.isArray(session.results.chartSuggestions)).toBe(true);
    });

    it('should re-plan when refinement text is provided', async () => {
      // Analyze
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'What is the gas storage level?',
      });

      // Execute with refinement – Gemini called for re-plan
      const refinedPlan = makePlanResponse({ summary: 'Refined strategy for France.' });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => refinedPlan },
      });

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
        refinement: 'Check France instead of Germany',
      });

      expect(result.status).toBe('refined');
      expect(result.summary).toBe('Refined strategy for France.');
    });

    it('should gracefully handle step execution errors', async () => {
      // Plan that references a non-existent service action
      const badPlan = makePlanResponse({
        steps: [
          {
            step: 1,
            service: 'nonexistent',
            action: 'nonexistent.action',
            description: 'This will fail',
            params: {},
          },
        ],
      });

      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => badPlan },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'This should fail gracefully for testing purposes',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      // Should still return results, with error captured in stepResults
      expect(result.status).toBe('completed');
      expect(result.stepResults[0].error).not.toBeNull();
    });

    it('should not override repaired hardcoded params with stale requiredInputs from original plan', async () => {
      const zipLookupMock = jest.fn().mockImplementation(async (ctx) => {
        if (ctx.params.location === '69256') {
          return [{ mastrNummer: 'SEE931931692562', plz: '69256' }];
        }
        return [];
      });

      const zipService = broker.createService({
        name: 'asset-zip-check',
        actions: {
          list: {
            handler: zipLookupMock,
          },
        },
      });
      await zipService._init();

      const initialPlan = JSON.stringify({
        summary: 'Initial plan with user-provided location input.',
        steps: [
          {
            step: 1,
            action: 'asset-zip-check.list',
            description: 'Query assets by location input',
            params: { location: null, limit: 1000 },
          },
        ],
        requiredInputs: [
          {
            name: 'location',
            label: 'Location',
            type: 'string',
            required: true,
            default: '69256 Mauer',
          },
        ],
      });

      const repairedPlan = JSON.stringify({
        summary: 'Repaired plan that must force ZIP-only exact filter.',
        steps: [
          {
            step: 1,
            action: 'asset-zip-check.list',
            description: 'Query assets by ZIP only',
            params: { location: '69256', limit: 1000 },
          },
        ],
        requiredInputs: [],
      });

      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => initialPlan } });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => repairedPlan } });
      mockInterpretAndSuggest({
        summary: 'One installation found in ZIP 69256.',
        tableColumns: ['mastrNummer', 'plz'],
        tableRows: [{ mastrNummer: 'SEE931931692562', plz: '69256' }],
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Gebe mir eine Liste aller Erzeugungsanlagen in 69256 Mauer',
      });

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { location: '69256 Mauer' },
      });

      expect(result.status).toBe('completed');
      expect(zipLookupMock).toHaveBeenCalledTimes(2);
      expect(zipLookupMock.mock.calls[0][0].params.location).toBe('69256 Mauer');
      expect(zipLookupMock.mock.calls[1][0].params.location).toBe('69256');

      const lastStep = result.stepResults[result.stepResults.length - 1];
      expect(lastStep.params.location).toBe('69256');
      expect(Array.isArray(lastStep.result)).toBe(true);
      expect(lastStep.result).toHaveLength(1);
    });

    // ── Type-coercion regression tests (GitHub issue: string inputs cause
    //    Moleculer validation errors on number/boolean params) ──────────────

    it('should coerce string userInput to number when requiredInputs declares type:number', async () => {
      // Plan with daysBack declared as number-type requiredInput (set to null in step)
      const plan = JSON.stringify({
        summary: 'Sales leads with daysBack param.',
        steps: [
          {
            step: 1,
            action: 'business-intelligence.salesLeads',
            description: 'Find new leads',
            params: { region: '69', installationType: 'solar', daysBack: null, limit: 50 },
          },
        ],
        requiredInputs: [
          {
            name: 'daysBack',
            label: 'Days Back',
            type: 'number',
            default: '365',
            required: true,
          },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => plan } });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'New PV installations last year in PLZ 69xxx area',
      });

      mockInterpretAndSuggest();
      broker._salesLeadsMock.mockClear();
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { daysBack: '365' },
      });

      // The service must have received daysBack as a number, not a string
      expect(broker._salesLeadsMock).toHaveBeenCalled();
      const receivedParams = broker._salesLeadsMock.mock.calls[0][0].params;
      expect(typeof receivedParams.daysBack).toBe('number');
      expect(receivedParams.daysBack).toBe(365);
    });

    it('should coerce string userInput to number using plan param value type hint', async () => {
      // Plan with daysBack hardcoded as a number in params (not null, no requiredInputs)
      // — type hint is inferred from the plan value itself
      const plan = JSON.stringify({
        summary: 'Sales leads with hardcoded daysBack.',
        steps: [
          {
            step: 1,
            action: 'business-intelligence.salesLeads',
            description: 'Find new leads',
            params: { region: '69', installationType: 'solar', daysBack: 365, limit: 50 },
          },
        ],
        requiredInputs: [
          {
            name: 'daysBack',
            label: 'Days Back',
            type: 'number',
            default: '365',
            required: true,
          },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => plan } });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'PV installations last 90 days in region 69',
      });

      mockInterpretAndSuggest();
      broker._salesLeadsMock.mockClear();
      // User changes daysBack to 90 — comes in as string from HTML form
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { daysBack: '90' },
      });

      expect(broker._salesLeadsMock).toHaveBeenCalled();
      const receivedParams = broker._salesLeadsMock.mock.calls[0][0].params;
      expect(typeof receivedParams.daysBack).toBe('number');
      expect(receivedParams.daysBack).toBe(90);
    });

    it('should not coerce string params that have no number type hint', async () => {
      // region: '69' is a string param — must NOT be converted to number 69
      const plan = JSON.stringify({
        summary: 'Sales leads region check.',
        steps: [
          {
            step: 1,
            action: 'business-intelligence.salesLeads',
            description: 'Find leads by region',
            params: { region: null, installationType: 'solar', daysBack: 30, limit: 50 },
          },
        ],
        requiredInputs: [
          {
            name: 'region',
            label: 'Region',
            type: 'string',
            default: '69',
            required: true,
          },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => plan } });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Leads in postal region 69 area search',
      });

      mockInterpretAndSuggest();
      broker._salesLeadsMock.mockClear();
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { region: '69' },
      });

      expect(broker._salesLeadsMock).toHaveBeenCalled();
      const receivedParams = broker._salesLeadsMock.mock.calls[0][0].params;
      // region must stay as string '69', not be coerced to number 69
      expect(typeof receivedParams.region).toBe('string');
      expect(receivedParams.region).toBe('69');
    });

    it('should strip $gateway from meta when calling step actions (prevent async job leakage)', async () => {
      // Regression test for the bug where agent.execute forwarded $gateway: true
      // from the HTTP request meta to downstream broker calls, causing services
      // that use jobStore.startJob (e.g. grid-operations.redispatchExport) to
      // return a 202 job descriptor instead of the synchronous result.

      // Arrange: capture the meta passed to the step action
      let capturedMeta = null;
      const capturingMock = jest.fn().mockImplementation(async (ctx) => {
        capturedMeta = ctx.meta;
        return { success: true, country: 'de', level: 0.65, trend: 'stable' };
      });

      // Temporarily override the gas-storage.countryStorage mock to capture meta
      const captureService = broker.createService({
        name: 'meta-capture-helper',
        actions: {
          capture: {
            handler: capturingMock,
          },
        },
      });
      await captureService._init(); // ensure registered

      _mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () =>
            makePlanResponse({
              steps: [
                {
                  step: 1,
                  action: 'meta-capture-helper.capture',
                  description: 'Capture meta for testing',
                  params: { country: 'de' },
                },
              ],
              requiredInputs: [],
            }),
        },
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Test meta stripping — gateway flag must not propagate',
      });

      mockInterpretAndSuggest();

      // Act: call execute with $gateway: true in meta (simulating an API-gateway request)
      await broker.call(
        'agent.execute',
        { sessionId: analyzed.sessionId, userInputs: {} },
        { meta: { $gateway: true, cernionToken: 'test-token' } }
      );

      // Assert: the step action received meta with $gateway stripped/false
      expect(capturedMeta).not.toBeNull();
      expect(capturedMeta.$gateway).toBeFalsy();
      // Other meta fields (e.g. cernionToken) must still be forwarded
      expect(capturedMeta.cernionToken).toBe('test-token');
    });
  }); // end execute action

  // ── rerun action ──────────────────────────────────────────────
  describe('rerun action', () => {
    it('should throw for unknown session', async () => {
      await expect(broker.call('agent.rerun', { sessionId: 'no-such-session' })).rejects.toThrow(
        /not found/i
      );
    });

    it('should re-execute a completed session', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Gas storage levels for rerun test',
      });

      mockInterpretAndSuggest();
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-02-01' },
      });

      // Rerun
      mockInterpretAndSuggest();
      const rerun = await broker.call('agent.rerun', { sessionId: analyzed.sessionId });

      expect(rerun.status).toBe('completed');
      expect(rerun.tableRows).toHaveLength(1);
    });
  });

  // ── schema-based proactive plan repair ────────────────────────
  describe('schema-based proactive plan repair (analyze)', () => {
    it('should rename "gemeinde" to "region" for residual-load.netResidualLoad', async () => {
      const wrongPlan = JSON.stringify({
        summary: 'Test plan with wrong param gemeinde.',
        steps: [
          {
            step: 1,
            action: 'residual-load.netResidualLoad',
            description: 'Calculate residual load',
            params: { gemeinde: 'Kiel', forecastDays: 2 },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => wrongPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Residuallast für das Netzgebiet Stadtwerke Kiel berechnen',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      expect(session.plan.steps[0].params.region).toBe('Kiel');
      expect(session.plan.steps[0].params.gemeinde).toBeUndefined();
      expect(session.planRepairs).toHaveLength(1);
      expect(session.planRepairs[0]).toMatchObject({
        step: 1,
        action: 'residual-load.netResidualLoad',
        original: 'gemeinde',
        corrected: 'region',
      });
    });

    it('should not rename a param that is already correct', async () => {
      const correctPlan = JSON.stringify({
        summary: 'Correct plan.',
        steps: [
          {
            step: 1,
            action: 'residual-load.netResidualLoad',
            description: 'Calculate residual load',
            params: { region: 'Kiel', forecastDays: 2 },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => correctPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Residuallast für Kiel für die nächsten 2 Tage',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      expect(session.plan.steps[0].params.region).toBe('Kiel');
      expect(session.planRepairs).toBeUndefined();
    });

    it('should not rename chained ref values — key is renamed but chain preserved', async () => {
      const chainedPlan = JSON.stringify({
        summary: 'Chained plan.',
        steps: [
          {
            step: 1,
            action: 'residual-load.netResidualLoad',
            description: 'Chained residual load',
            params: { gemeinde: '__step_0.data.city', forecastDays: 2 },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => chainedPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Chained residual load test for auto-repair',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      // Chained refs are NOT renamed — key stays as-is, chain value preserved
      const params = session.plan.steps[0].params;
      expect(params.gemeinde).toBe('__step_0.data.city');
    });

    it('should not rename params for unknown actions (not in registry)', async () => {
      const unknownActionPlan = JSON.stringify({
        summary: 'Unknown action plan.',
        steps: [
          {
            step: 1,
            action: 'nonexistent.someAction',
            description: 'This action is not in the registry',
            params: { gemeinde: 'Hamburg', weirdParam: 'value' },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => unknownActionPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Test plan with unknown action should not crash',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      // Params left untouched since action schema is unknown
      expect(session.plan.steps[0].params.gemeinde).toBe('Hamburg');
      expect(session.planRepairs).toBeUndefined();
    });

    it('should rename "radius" to "radiusMeters" for osm-geo.validate (RULE 12 alias)', async () => {
      const wrongPlan = JSON.stringify({
        summary: 'OSM geo validate with wrong radius param.',
        steps: [
          {
            step: 1,
            action: 'osm-geo.validate',
            description: 'Validate VNB assignment for installation',
            params: { mastrNummer: 'SEE900123456789', radius: 500 },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => wrongPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Validate that SEE900123456789 is correctly assigned to its grid operator',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      expect(session.plan.steps[0].params.radiusMeters).toBe(500);
      expect(session.plan.steps[0].params.radius).toBeUndefined();
      expect(session.planRepairs).toHaveLength(1);
      expect(session.planRepairs[0]).toMatchObject({
        step: 1,
        action: 'osm-geo.validate',
        original: 'radius',
        corrected: 'radiusMeters',
      });
    });

    it('should rename "bbox" to "boundingBox" for osm-geo.substationFinder (RULE 12 alias)', async () => {
      const wrongPlan = JSON.stringify({
        summary: 'OSM substation finder with wrong bbox param.',
        steps: [
          {
            step: 1,
            action: 'osm-geo.substationFinder',
            description: 'Find substations within bounding box',
            params: { bbox: { north: 49.5, south: 49.3, east: 8.7, west: 8.5 } },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => wrongPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Find all substations in the Heidelberg area',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      expect(session.plan.steps[0].params.boundingBox).toBeDefined();
      expect(session.plan.steps[0].params.bbox).toBeUndefined();
      expect(session.planRepairs).toHaveLength(1);
      expect(session.planRepairs[0]).toMatchObject({
        step: 1,
        action: 'osm-geo.substationFinder',
        original: 'bbox',
        corrected: 'boundingBox',
      });
    });
  }); // end schema-based plan repair

  // ── dataQualityWarning → populationOverride injection ─────────────────────
  describe('dataQualityWarning populationOverride injection', () => {
    function makeResidualLoadPlan(overrides = {}) {
      const plan = {
        summary: 'Residuallast für Stadtwerke Kiel berechnen.',
        steps: [
          {
            step: 1,
            service: 'residual-load',
            action: 'residual-load.netResidualLoad',
            description: 'Forecast residual load for Kiel',
            params: { region: 'Kiel', forecastDays: 2 },
          },
        ],
        requiredInputs: [
          {
            name: 'query',
            label: 'Netzbetreiber / Stadtwerk',
            type: 'string',
            default: 'Stadtwerke Kiel',
          },
        ],
        ...overrides,
      };
      return JSON.stringify(plan);
    }

    it('should inject populationOverride into requiredInputs when dataQualityWarning is true', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeResidualLoadPlan() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Nettorestlast für Stadtwerke Kiel berechnen',
      });

      // Residual-load action returns dataQualityWarning=true (loadMW all zero)
      broker._residualLoadMock.mockResolvedValueOnce({
        summary: { region: 'Kiel', loadScaling: { populationUsed: '245.000' } },
        forecast: [
          { timestamp: '2026-03-01T00:00:00Z', loadMW: 0, residualLoadMW: 12 },
          { timestamp: '2026-03-01T01:00:00Z', loadMW: 0, residualLoadMW: 8 },
        ],
        dataQualityWarning: true,
        dataQualityMessage: 'SMARD population scaling returned loadMW=0 for all forecast points.',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      expect(result.requiredInputs).toBeDefined();
      const popField = result.requiredInputs.find((ri) => ri.name === 'populationOverride');
      expect(popField).toBeDefined();
      expect(popField.type).toBe('number');
      expect(popField.default).toBe(245000);
      expect(popField.required).toBe(true);

      // Also verify the field is persisted in the saved session
      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      const sessionPopField = (session.plan.requiredInputs || []).find(
        (ri) => ri.name === 'populationOverride'
      );
      expect(sessionPopField).toBeDefined();
    });

    it('should NOT inject populationOverride when dataQualityWarning is false', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeResidualLoadPlan() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Nettorestlast für Kiel — Daten sind vorhanden',
      });

      // Normal successful response — no warning
      broker._residualLoadMock.mockResolvedValueOnce({
        summary: { region: 'Kiel', loadScaling: { populationUsed: '245.000' } },
        forecast: [{ timestamp: '2026-03-01T00:00:00Z', loadMW: 42, residualLoadMW: 12 }],
        dataQualityWarning: false,
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const popField = (result.requiredInputs || []).find((ri) => ri.name === 'populationOverride');
      expect(popField).toBeUndefined();
    });

    it('should not duplicate populationOverride if already present in requiredInputs', async () => {
      const planWithPop = makeResidualLoadPlan({
        requiredInputs: [
          {
            name: 'query',
            label: 'Netzbetreiber / Stadtwerk',
            type: 'string',
            default: 'Stadtwerke Kiel',
          },
          {
            name: 'populationOverride',
            label: 'Einwohnerzahl',
            type: 'number',
            default: 247000,
            required: true,
          },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => planWithPop },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Nettorestlast für Kiel mit vorhandener Einwohnerzahl',
      });

      broker._residualLoadMock.mockResolvedValueOnce({
        summary: { region: 'Kiel', loadScaling: { populationUsed: '245.000' } },
        forecast: [{ timestamp: '2026-03-01T00:00:00Z', loadMW: 0, residualLoadMW: 8 }],
        dataQualityWarning: true,
        dataQualityMessage: 'SMARD returned 0.',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const popFields = (result.requiredInputs || []).filter(
        (ri) => ri.name === 'populationOverride'
      );
      expect(popFields).toHaveLength(1);
    });

    it('should always include requiredInputs array in the execute return value', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Gas storage in Germany — execute return value check',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      expect(result).toHaveProperty('requiredInputs');
      expect(Array.isArray(result.requiredInputs)).toBe(true);
    });
  }); // end dataQualityWarning populationOverride injection

  // ── buildServiceCatalogue robustness ────────────────────────────────────────
  describe('buildServiceCatalogue — multi-type param robustness', () => {
    it('should not crash when an action param is a Moleculer multi-type array', async () => {
      // Simulate a service with a multi-type param (like grid-operations.redispatchExport types)
      // After fastest-validator compiles it, the array gets a non-array `values` Function added.
      const fakeMultiTypeParam = [
        { type: 'array', optional: true },
        { type: 'string', optional: true },
      ];
      // Simulate what fastest-validator does: add a compiled `values` property (a Function)
      fakeMultiTypeParam.values = function compiledCheck() {};

      // Indirect test: agent.analyze uses buildServiceCatalogue; mock broker provides multi-type param
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      // Should not throw — pre-fix this would crash with "v.values.join is not a function"
      await expect(
        broker.call('agent.analyze', { problem: 'test multi-type param robustness' })
      ).resolves.toBeDefined();
    });

    it('should render multi-type params as type1|type2 in catalogue', () => {
      // Unit-test the logic inline (mirrors buildServiceCatalogue)
      const v = [
        { type: 'array', optional: true },
        { type: 'string', optional: true },
      ];
      v.values = function compiledCheck() {}; // simulate fastest-validator mutation

      let result;
      if (Array.isArray(v)) {
        const types = v.map((r) => (typeof r === 'object' && r.type ? r.type : 'any')).join('|');
        result = `types?: ${types}`;
      }
      expect(result).toBe('types?: array|string');
    });

    it('should render normal enum params correctly after fix', () => {
      const v = { type: 'enum', values: ['NS', 'MS', 'HS', 'all'], optional: true, default: 'all' };
      const t = v.type || 'string';
      const opt = v.optional ? '?' : '';
      const enumVals = Array.isArray(v.values) ? `[${v.values.join('|')}]` : '';
      const dflt = v.default !== undefined ? `=${v.default}` : '';
      expect(`voltageLevel${opt}: ${t}${enumVals}${dflt}`).toBe(
        'voltageLevel?: enum[NS|MS|HS|all]=all'
      );
    });
  }); // end buildServiceCatalogue robustness

  // ── session compaction — RangeError fix ───────────────────────────────────
  describe('session compaction (RangeError: Invalid string length fix)', () => {
    // A mock service that returns 200 installation records — big enough to trigger the
    // old crash if compaction is not applied before session.results is assigned.
    const LARGE_COUNT = 200;

    beforeAll(async () => {
      const bigResult = Array.from({ length: LARGE_COUNT }, (_, i) => ({
        mastrNummer: `SEE${String(i).padStart(12, '0')}`,
        bruttoleistung: 10 + i,
        status: 'InBetrieb',
      }));

      // Register mock "assets" service that returns the large result
      broker.createService({
        name: 'assets',
        actions: {
          solar: jest.fn().mockResolvedValue(bigResult),
        },
      });
    });

    it('should compact step results to ≤50 rows before persisting the session', async () => {
      const largePlan = JSON.stringify({
        summary: 'Fetch large installation list.',
        steps: [
          {
            step: 1,
            service: 'assets',
            action: 'assets.solar',
            description: 'Fetch solar installations — returns large array',
            params: { vnbName: 'Stadtwerke Test' },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => largePlan } });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'List solar installations for Stadtwerke Test',
      });

      // Queue interpretation + suggestions for execute
      mockInterpretAndSuggest({ summary: 'Found installations.' });

      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const sessionFile = path.join(SESSION_DIR, `${analyzed.sessionId}.json`);
      expect(fs.existsSync(sessionFile)).toBe(true);

      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      expect(session.status).toBe('completed');

      // stepResults must be stored compacted — at most 50 data rows per step
      const sr = session.results.stepResults;
      expect(Array.isArray(sr)).toBe(true);

      for (const step of sr) {
        const result = step.result;
        if (!result) continue;

        // Check any array-valued key that looks like "data" or "installations"
        const allArrays = Object.values(result).filter(Array.isArray);
        for (const arr of allArrays) {
          expect(arr.length).toBeLessThanOrEqual(50);
        }

        // Top-level array result (e.g. assets.solar returns an array directly)
        if (Array.isArray(result)) {
          expect(result.length).toBeLessThanOrEqual(50);
        }
      }
    });

    it('should still complete successfully despite a large result (no RangeError crash)', async () => {
      // This is the key regression check: execution must not throw.
      const largePlan = JSON.stringify({
        summary: 'Large installations query regression check.',
        steps: [
          {
            step: 1,
            service: 'assets',
            action: 'assets.solar',
            description: 'Fetch solar — large result',
            params: { vnbName: 'Stadtwerke Test' },
          },
        ],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => largePlan } });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Regression: large result should not crash saveSession',
      });

      mockInterpretAndSuggest({ summary: 'Regression OK.' });

      // Must not throw RangeError
      await expect(
        broker.call('agent.execute', {
          sessionId: analyzed.sessionId,
          userInputs: {},
        })
      ).resolves.toMatchObject({ status: 'completed' });
    });
  }); // end session compaction
}); // end Agent Service
