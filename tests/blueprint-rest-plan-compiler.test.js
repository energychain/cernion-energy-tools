'use strict';

const mockDetectBlueprintIntent = jest.fn();
const mockLoadBlueprint = jest.fn();
const mockListBlueprints = jest.fn();

jest.mock('../src/l3-broker', () => ({
  detectBlueprintIntent: (...args) => mockDetectBlueprintIntent(...args),
}));
jest.mock('../src/blueprint-registry', () => ({
  listBlueprints: (...args) => mockListBlueprints(...args),
  loadBlueprint: (...args) => mockLoadBlueprint(...args),
}));

const {
  compileReadOnlyExecutionPlan,
  buildAskBlueprintAnswer,
} = require('../src/blueprint-rest-plan-compiler');

// Mirrors src/blueprints/mastr-asset-service-selection-v1.json
const ASSET_SELECTION_BLUEPRINT = {
  id: 'mastr-asset-service-selection-v1',
  version: '1.0.0',
  routing: { restPlanOnly: true },
  inputs: {
    assetType: {
      type: 'string',
      required: true,
      resolveStrategy: { method: 'static_default', defaultValue: 'solar' },
    },
    location: { type: 'string', required: true, semanticType: 'OEO:PostalCode' },
    minCapacity: { type: 'number', required: false },
    maxCapacity: { type: 'number', required: false },
    commissioningYear: { type: 'number', required: false },
    limit: {
      type: 'number',
      required: false,
      resolveStrategy: { method: 'static_default', defaultValue: 100 },
    },
  },
  execution: {
    steps: [
      {
        id: 'select_asset_service',
        action: 'assets.{{inputs.assetType}}',
        params: {
          location: '{{inputs.location}}',
          minCapacityKW: '{{inputs.minCapacity}}',
          maxCapacityKW: '{{inputs.maxCapacity}}',
          commissioningYear: '{{inputs.commissioningYear}}',
          limit: '{{inputs.limit}}',
        },
      },
    ],
  },
};

const GRID_CONNECTION_BLUEPRINT = {
  id: 'grid-connection-validation-v1',
  version: '1.0.0',
  routing: { restPlanOnly: true }, // hypothetical: flagged for this test only
  inputs: {
    postalCode: { type: 'string', required: true, semanticType: 'OEO:PostalCode' },
    capacityKW: { type: 'number', required: true },
  },
  execution: {
    steps: [
      {
        id: 'validate_connection',
        action: 'grid-connection.validate',
        params: { capacityKW: '{{inputs.capacityKW}}' },
      },
    ],
  },
};

function fakeBroker(actionsByService) {
  return {
    registry: {
      getServiceList: () =>
        Object.entries(actionsByService).map(([name, actions]) => ({ name, actions })),
    },
  };
}

const ASSETS_BROKER = fakeBroker({
  assets: {
    'assets.solar': { rest: 'GET /solar' },
    'assets.wind': { rest: 'GET /wind' },
  },
});

const GRID_CONNECTION_BROKER = fakeBroker({
  'grid-connection': {
    'grid-connection.validate': { rest: 'POST /validate' },
  },
});

// Architecture follow-up (https://github.com/energychain/cernion-energy-tools/issues/271#issuecomment-4786658464):
// a single blueprint may recommend MULTIPLE complementary read-only endpoints,
// each annotated with its own resultSemantics. Cernion never joins/synthesizes
// across them — that stays the consuming agent/orchestrator's job.
const MULTI_ENDPOINT_BLUEPRINT = {
  id: 'mastr-asset-with-market-context-v1',
  version: '1.0.0',
  routing: { restPlanOnly: true },
  inputs: {
    assetType: {
      type: 'string',
      required: true,
      resolveStrategy: { method: 'static_default', defaultValue: 'solar' },
    },
    location: { type: 'string', required: true, semanticType: 'OEO:PostalCode' },
  },
  execution: {
    steps: [
      {
        id: 'select_asset_service',
        action: 'assets.{{inputs.assetType}}',
        params: { location: '{{inputs.location}}' },
        resultSemantics: {
          kind: 'asset_list',
          description: 'Matching MaStR installations for the requested region.',
        },
      },
      {
        id: 'spot_price_context',
        action: 'market-data.spotPrices',
        params: { location: '{{inputs.location}}' },
        resultSemantics: {
          kind: 'market_signal',
          description: 'Day-ahead spot price time series for the same region.',
        },
      },
    ],
  },
};

const MULTI_ENDPOINT_BROKER = fakeBroker({
  assets: { 'assets.solar': { rest: 'GET /solar' } },
  'market-data': { 'market-data.spotPrices': { rest: 'GET /spot-prices' } },
});

// Same blueprint, but the second step's action is a write endpoint — must be
// skipped, not fatal, since the first step still resolves.
const MULTI_ENDPOINT_BROKER_PARTIAL = fakeBroker({
  assets: { 'assets.solar': { rest: 'GET /solar' } },
  'market-data': { 'market-data.spotPrices': { rest: 'POST /spot-prices' } },
});

beforeEach(() => {
  mockDetectBlueprintIntent.mockReset();
  mockLoadBlueprint.mockReset();
  mockListBlueprints.mockReset();
  mockListBlueprints.mockReturnValue([]);
});

describe('compileReadOnlyExecutionPlan', () => {
  test('compiles a successful read-only GET plan (issue #271 fixture scenario)', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste aller Erzeugungsanlagen in 69168',
      context: {
        assetType: 'solar',
        location: '69168',
        minCapacity: 10,
        maxCapacity: 13,
        commissioningYear: 2025,
        limit: 100,
      },
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.resolved).toEqual({
      kind: 'blueprint',
      id: 'mastr-asset-service-selection-v1',
      version: '1.0.0',
      source: 'blueprint_runtime',
    });
    expect(result.canonicalInputs).toEqual({
      assetType: 'solar',
      location: '69168',
      minCapacity: 10,
      maxCapacity: 13,
      commissioningYear: 2025,
      limit: 100,
    });
    expect(result.execution).toEqual({
      mode: 'read_only_rest_plan',
      method: 'GET',
      path: '/api/assets/solar',
      query: {
        location: '69168',
        minCapacityKW: 10,
        maxCapacityKW: 13,
        commissioningYear: 2025,
        limit: 100,
      },
    });
    expect(result.policy).toEqual({
      readOnly: true,
      sideEffects: 'none',
      tenantScoped: true,
      externalSideEffects: false,
    });
    expect(mockDetectBlueprintIntent).toHaveBeenCalledWith(
      'Liste aller Erzeugungsanlagen in 69168',
      expect.objectContaining({ assetType: 'solar' }),
      expect.objectContaining({ location: '69168' }),
      { includeRestPlanOnly: true }
    );
  });

  test('recommends multiple complementary read-only endpoints from one blueprint', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-with-market-context-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(MULTI_ENDPOINT_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Solaranlagen und Spotpreise in 69168',
      context: { assetType: 'solar', location: '69168' },
      broker: MULTI_ENDPOINT_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.recommendedEndpoints).toHaveLength(2);
    expect(result.recommendedEndpoints[0]).toEqual({
      method: 'GET',
      path: '/api/assets/solar',
      query: { location: '69168' },
      resultSemantics: {
        kind: 'asset_list',
        description: 'Matching MaStR installations for the requested region.',
      },
    });
    expect(result.recommendedEndpoints[1]).toEqual({
      method: 'GET',
      path: '/api/market-data/spot-prices',
      query: { location: '69168' },
      resultSemantics: {
        kind: 'market_signal',
        description: 'Day-ahead spot price time series for the same region.',
      },
    });
    // execution mirrors recommendedEndpoints[0] for #271 backward compatibility.
    expect(result.execution).toEqual({
      mode: 'read_only_rest_plan',
      ...result.recommendedEndpoints[0],
    });
  });

  test('skips an unresolvable step but still succeeds when at least one endpoint resolves', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-with-market-context-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(MULTI_ENDPOINT_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Solaranlagen und Spotpreise in 69168',
      context: { assetType: 'solar', location: '69168' },
      broker: MULTI_ENDPOINT_BROKER_PARTIAL, // spotPrices is POST here
    });

    expect(result.ok).toBe(true);
    expect(result.recommendedEndpoints).toHaveLength(1);
    expect(result.recommendedEndpoints[0].path).toBe('/api/assets/solar');
  });

  test('buildAskBlueprintAnswer lists every recommended endpoint with its result semantics', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-with-market-context-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(MULTI_ENDPOINT_BLUEPRINT);

    const restPlan = compileReadOnlyExecutionPlan({
      question: 'Solaranlagen und Spotpreise in 69168',
      context: { assetType: 'solar', location: '69168' },
      broker: MULTI_ENDPOINT_BROKER,
    });

    const answer = buildAskBlueprintAnswer(restPlan, {
      question: 'Solaranlagen und Spotpreise in 69168',
      sessionId: 'sess-1',
    });

    expect(answer.success).toBe(true);
    expect(answer.recommendedEndpoints).toHaveLength(2);
    expect(answer.groundingAnswer).toContain('GET /api/assets/solar — asset_list');
    expect(answer.groundingAnswer).toContain('GET /api/market-data/spot-prices — market_signal');
    expect(answer.groundingAnswer).toContain('responsibility of the consuming agent/orchestrator');
    expect(answer.forbiddenActions).toEqual([]);
  });

  test('selects a different underlying action when assetType differs', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste aller Windanlagen',
      context: { assetType: 'wind', location: '69168' },
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.execution.path).toBe('/api/assets/wind');
  });

  test('compiles a safe active runtime blueprint even when restPlanOnly is absent', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue({
      ...ASSET_SELECTION_BLUEPRINT,
      version: '1.0.0-runtime-mauer-solar-parameter-canonicalization',
      routing: {
        intentSignals: ['solar anlagen', 'leistung zwischen'],
      },
      execution: {
        steps: [
          {
            id: 'solar_asset_lookup',
            action: 'assets.solar',
            params: {
              location: '{{inputs.location}}',
              minCapacityKW: '{{inputs.minCapacity}}',
              maxCapacityKW: '{{inputs.maxCapacity}}',
              commissioningYear: '{{inputs.commissioningYear}}',
              limit: '{{inputs.limit}}',
            },
          },
        ],
      },
    });

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
      context: {
        assetType: 'solar',
        location: '69168',
        minCapacity: 10,
        maxCapacity: 13,
        commissioningYear: 2025,
        limit: 100,
      },
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.resolved).toMatchObject({
      kind: 'blueprint',
      id: 'mastr-asset-service-selection-v1',
      version: '1.0.0-runtime-mauer-solar-parameter-canonicalization',
    });
    expect(result.execution).toEqual({
      mode: 'read_only_rest_plan',
      method: 'GET',
      path: '/api/assets/solar',
      query: {
        location: '69168',
        minCapacityKW: 10,
        maxCapacityKW: 13,
        commissioningYear: 2025,
        limit: 100,
      },
    });
  });

  test('falls back to a single safe structured-input blueprint when intent signals do not match', () => {
    mockDetectBlueprintIntent.mockReturnValue(null);
    mockListBlueprints.mockReturnValue([
      {
        id: 'mastr-asset-service-selection-v1',
        version: '1.0.0-runtime-mauer-solar-parameter-canonicalization',
      },
    ]);
    mockLoadBlueprint.mockReturnValue({
      ...ASSET_SELECTION_BLUEPRINT,
      routing: {
        intentSignals: ['solar anlagen', 'leistung zwischen'],
      },
      execution: {
        steps: [
          {
            id: 'solar_asset_lookup',
            action: 'assets.solar',
            params: {
              location: '{{inputs.location}}',
              minCapacityKW: '{{inputs.minCapacity}}',
              maxCapacityKW: '{{inputs.maxCapacity}}',
              commissioningYear: '{{inputs.commissioningYear}}',
              limit: '{{inputs.limit}}',
            },
          },
        ],
      },
    });

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
      context: {
        tenantId: 'public',
        assetType: 'solar',
        location: '69168',
        minCapacity: 10,
        maxCapacity: 13,
        commissioningYear: 2025,
        limit: 100,
      },
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.resolved.id).toBe('mastr-asset-service-selection-v1');
    expect(result.execution).toEqual({
      mode: 'read_only_rest_plan',
      method: 'GET',
      path: '/api/assets/solar',
      query: {
        location: '69168',
        minCapacityKW: 10,
        maxCapacityKW: 13,
        commissioningYear: 2025,
        limit: 100,
      },
    });
  });

  test('does not pick a structured-input fallback when multiple GET blueprints fit', () => {
    mockDetectBlueprintIntent.mockReturnValue(null);
    mockListBlueprints.mockReturnValue([
      { id: 'mastr-asset-service-selection-v1', version: '1.0.0' },
      { id: 'mastr-asset-service-selection-v2', version: '1.0.0' },
    ]);
    mockLoadBlueprint.mockImplementation(() => ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
      context: { assetType: 'solar', location: '69168' },
      broker: ASSETS_BROKER,
    });

    expect(result).toEqual({ ok: false, reason: 'no_blueprint_match' });
  });

  test('derives fixture inputs from the natural-language question when structured inputs are absent', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 4,
    });
    mockLoadBlueprint.mockReturnValue(ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
      context: { tenantId: 'public' },
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.canonicalInputs).toEqual({
      assetType: 'solar',
      location: '69168',
      minCapacity: 10,
      maxCapacity: 13,
      commissioningYear: 2025,
      limit: 100,
    });
    expect(result.execution.query).toEqual({
      location: '69168',
      minCapacityKW: 10,
      maxCapacityKW: 13,
      commissioningYear: 2025,
      limit: 100,
    });
    expect(mockDetectBlueprintIntent).toHaveBeenCalledWith(
      'Liste alle Solaranlagen in 69168 zwischen 10 und 13 kW aus 2025',
      expect.objectContaining({ tenantId: 'public', location: '69168', assetType: 'solar' }),
      expect.objectContaining({ location: '69168', assetType: 'solar' }),
      { includeRestPlanOnly: true }
    );
  });

  test('returns no_blueprint_match when no blueprint matches the question', () => {
    mockDetectBlueprintIntent.mockReturnValue(null);

    const result = compileReadOnlyExecutionPlan({
      question: 'Wie ist das Wetter heute?',
      context: {},
      broker: ASSETS_BROKER,
    });

    expect(result).toEqual({ ok: false, reason: 'no_blueprint_match' });
    expect(mockLoadBlueprint).not.toHaveBeenCalled();
  });

  test('policy guardrail: refuses to emit a plan for a non-GET (side-effecting) action', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'grid-connection-validation-v1',
      score: 5,
    });
    mockLoadBlueprint.mockReturnValue(GRID_CONNECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Netzanschlussprüfung für 69168 mit 50 kW',
      context: { postalCode: '69168', capacityKW: 50 },
      broker: GRID_CONNECTION_BROKER,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_read_only');
    expect(result.method).toBe('POST');
    expect(result.action).toBe('grid-connection.validate');
  });

  test('reports missing_required_inputs when a required input cannot be resolved', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste aller Erzeugungsanlagen',
      context: { assetType: 'solar' }, // no location
      broker: ASSETS_BROKER,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'missing_required_inputs',
      blueprintId: 'mastr-asset-service-selection-v1',
      missing: ['location'],
    });
  });

  test('returns action_not_found when the resolved action has no live REST registration', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste aller Erzeugungsanlagen',
      context: { assetType: 'storage', location: '69168' }, // assets.storage not registered in fakeBroker
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('action_not_found');
    expect(result.action).toBe('assets.storage');
  });

  test('omits unset optional params from the compiled query', () => {
    mockDetectBlueprintIntent.mockReturnValue({
      blueprintId: 'mastr-asset-service-selection-v1',
      score: 6,
    });
    mockLoadBlueprint.mockReturnValue(ASSET_SELECTION_BLUEPRINT);

    const result = compileReadOnlyExecutionPlan({
      question: 'Liste aller Erzeugungsanlagen in 69168',
      context: { assetType: 'solar', location: '69168' },
      broker: ASSETS_BROKER,
    });

    expect(result.ok).toBe(true);
    expect(result.execution.query).toEqual({ location: '69168', limit: 100 });
  });

  test('fails soft (no throw) when called without a broker', () => {
    const result = compileReadOnlyExecutionPlan({ question: 'irrelevant', context: {} });
    expect(result).toEqual({ ok: false, reason: 'broker_unavailable' });
    expect(mockDetectBlueprintIntent).not.toHaveBeenCalled();
  });
});
