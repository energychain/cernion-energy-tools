'use strict';

const mockDetectBlueprintIntent = jest.fn();
const mockLoadBlueprint = jest.fn();

jest.mock('../src/l3-broker', () => ({
  detectBlueprintIntent: (...args) => mockDetectBlueprintIntent(...args),
}));
jest.mock('../src/blueprint-registry', () => ({
  loadBlueprint: (...args) => mockLoadBlueprint(...args),
}));

const { compileReadOnlyExecutionPlan } = require('../src/blueprint-rest-plan-compiler');

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

beforeEach(() => {
  mockDetectBlueprintIntent.mockReset();
  mockLoadBlueprint.mockReset();
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
      {},
      { includeRestPlanOnly: true }
    );
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
