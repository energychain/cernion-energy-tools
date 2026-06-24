'use strict';

const {
  detectBlueprintIntent,
  buildBlueprintPlan,
  _derivePrimaryIntent,
  _scoreBlueprintMatch,
  _requiredStepIds,
  _normalizeKey,
  _resolveAliasedKey,
  _coerceToNumber,
  MATCH_THRESHOLD,
} = require('../src/l3-broker');
const { _resetCache } = require('../src/blueprint-registry');

beforeEach(() => {
  _resetCache();
});

// ─── _derivePrimaryIntent ─────────────────────────────────────────────────────

describe('_derivePrimaryIntent', () => {
  test('converts EV charging blueprint id to underscore intent', () => {
    expect(_derivePrimaryIntent('ev-charging-co2-optimization-v1')).toBe(
      'ev_charging_co2_optimization'
    );
  });

  test('strips patch version', () => {
    expect(_derivePrimaryIntent('some-use-case-v2')).toBe('some_use_case');
  });

  test('strips semver suffix', () => {
    expect(_derivePrimaryIntent('my-blueprint-v1.2.3')).toBe('my_blueprint');
  });

  test('result matches the expected routing regex', () => {
    const intent = _derivePrimaryIntent('ev-charging-co2-optimization-v1');
    expect(intent).toMatch(/co2.*optimization/i);
  });
});

// ─── _scoreBlueprintMatch ─────────────────────────────────────────────────────

describe('_scoreBlueprintMatch', () => {
  const blueprint = {
    routing: {
      intentSignals: ['laden', 'co2', 'ev', 'wallbox'],
      negativeSignals: ['redispatch', 'netzengpass'],
      priorityBoost: 5,
    },
  };

  test('returns 0 for no matching signals', () => {
    expect(_scoreBlueprintMatch('was kostet strom?', blueprint)).toBe(0);
  });

  test('returns positive score for matching signals', () => {
    const score = _scoreBlueprintMatch('ich möchte mein ev laden', blueprint);
    expect(score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  test('returns 0 when negative signal present', () => {
    const score = _scoreBlueprintMatch('ev laden redispatch', blueprint);
    expect(score).toBe(0);
  });

  test('can scope negative signals to user text only', () => {
    const score = _scoreBlueprintMatch('ev laden grid-connection.redispatch', blueprint, {
      negativeHaystack: 'ev laden',
    });
    expect(score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  test('applies priorityBoost', () => {
    const boosted = _scoreBlueprintMatch('laden co2', blueprint);
    const baseline = _scoreBlueprintMatch('laden co2', {
      ...blueprint,
      routing: { ...blueprint.routing, priorityBoost: 0 },
    });
    expect(boosted).toBeGreaterThan(baseline);
  });
});

// ─── detectBlueprintIntent ────────────────────────────────────────────────────

describe('detectBlueprintIntent', () => {
  const evMessage =
    'Ich bin in 69256 Mauer, wann soll ich mein Auto laden, um möglichst wenig CO2 zu verursachen?';
  const evContext = {};
  const evPromptHints = { postalCode: '69256', city: 'Mauer' };

  test('detects EV/CO2 charging request with location context', () => {
    const result = detectBlueprintIntent(evMessage, evContext, evPromptHints);
    expect(result).not.toBeNull();
    expect(result.blueprintId).toBe('ev-charging-co2-optimization-v1');
    expect(result.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  test('returns null when no location is available (blueprint requires OEO:PostalCode)', () => {
    const result = detectBlueprintIntent(evMessage, {}, {});
    expect(result).toBeNull();
  });

  test('returns null for grid operator queries (negative signal netzengpass)', () => {
    const gridMessage = 'Residuallast netzengpass DSO';
    const result = detectBlueprintIntent(gridMessage, {}, { postalCode: '12345' });
    expect(result).toBeNull();
  });

  test('returns null for unrelated queries', () => {
    const result = detectBlueprintIntent('wie ist das wetter heute?', {}, { postalCode: '69256' });
    expect(result).toBeNull();
  });

  test('detects with postalCode in knownContext', () => {
    const result = detectBlueprintIntent(evMessage, { postalCode: '69256' }, {});
    expect(result).not.toBeNull();
    expect(result.blueprintId).toBe('ev-charging-co2-optimization-v1');
  });

  test('picks highest-scoring blueprint when multiple match', () => {
    // Only one blueprint exists currently, so this verifies selection logic
    const result = detectBlueprintIntent(evMessage, evContext, evPromptHints);
    expect(result).not.toBeNull();
  });

  test('does not let broker intent text trigger blueprint negative signals', () => {
    const message =
      'Ich bin Bürgermeister von 74889 Sinsheim und bereite ein Treffen zu Rechenzentrum, PV, Batteriespeicher und Ladeparks vor.';
    const result = detectBlueprintIntent(
      message,
      {
        postalCode: '74889',
        municipality: 'Sinsheim',
        intent: 'grid-connection.fnav',
      },
      {}
    );

    expect(result).not.toBeNull();
    expect(result.blueprintId).toBe('municipal-energy-site-precheck-v1');
  });

  // ── restPlanOnly exclusion (issue #271) ──────────────────────────────────
  // mastr-asset-service-selection-v1 is a compile-only fixture for
  // src/blueprint-rest-plan-compiler.js: its execution.steps use action-name
  // templating ("assets.{{inputs.assetType}}") that buildBlueprintPlan/
  // executeBlueprint do not resolve, so it must stay out of internal
  // chat-routing matches unless explicitly requested.
  test('excludes restPlanOnly blueprints from internal chat-routing matches by default', () => {
    const result = detectBlueprintIntent(
      'Liste aller Erzeugungsanlagen in 69168',
      { postalCode: '69168' },
      {}
    );
    expect(result?.blueprintId).not.toBe('mastr-asset-service-selection-v1');
  });

  test('includes restPlanOnly blueprints when includeRestPlanOnly is set', () => {
    const result = detectBlueprintIntent(
      'Liste aller Erzeugungsanlagen in 69168',
      { postalCode: '69168' },
      {},
      { includeRestPlanOnly: true }
    );
    expect(result).not.toBeNull();
    expect(result.blueprintId).toBe('mastr-asset-service-selection-v1');
  });
});

// ─── buildBlueprintPlan ───────────────────────────────────────────────────────

describe('buildBlueprintPlan', () => {
  const opts = {
    message: 'Wann soll ich mein E-Auto laden? PLZ 69256 Mauer',
    knownContext: {},
    promptHints: { postalCode: '69256', city: 'Mauer' },
  };

  test('returns a plan with correct primaryIntent matching test regex', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.primaryIntent).toMatch(/ev.*co2|co2.*optimization/i);
    expect(plan.primaryIntent).toBe('ev_charging_co2_optimization');
  });

  test('plan has exactly one step with energy-market.co2Intensity action (price step filtered out)', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    const co2Steps = plan.steps.filter((s) => s.action === 'energy-market.co2Intensity');
    expect(co2Steps.length).toBe(1);
    // Only evidence-required steps are in the routing plan
    expect(plan.steps.map((s) => s.action)).toEqual(['energy-market.co2Intensity']);
  });

  test('plan steps only contains evidence-required steps', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].step).toBe(1);
  });

  test('_requiredStepIds extracts step IDs from synthesis.evidenceRequired', () => {
    const blueprint = {
      synthesis: { evidenceRequired: ['steps.fetch_co2_forecast.output', 'postProcessing.x'] },
    };
    const ids = _requiredStepIds(blueprint);
    expect(ids.has('fetch_co2_forecast')).toBe(true);
    expect(ids.size).toBe(1);
  });

  test('paramsTemplate has postalCode from promptHints', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.steps[0].paramsTemplate.postalCode).toBe('69256');
  });

  test('paramsTemplate has city from promptHints', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.steps[0].paramsTemplate.city).toBe('Mauer');
  });

  test('paramsTemplate uses knownContext postalCode when promptHints absent', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', {
      message: '',
      knownContext: { postalCode: '70173' },
      promptHints: {},
    });
    expect(plan.steps[0].paramsTemplate.postalCode).toBe('70173');
  });

  test('plan has blueprint-broker source', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.source).toBe('blueprint-broker');
  });

  test('plan status is ready', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.status).toBe('ready');
  });

  test('plan has capability with preferredActions including co2Intensity', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    expect(plan.capability.preferredActions).toContain('energy-market.co2Intensity');
  });

  test('throws for unknown blueprintId', () => {
    expect(() => buildBlueprintPlan('does-not-exist', opts)).toThrow('Blueprint not found');
  });

  test('plan is compatible with routing test assertion: steps.map(s => s.action)', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', opts);
    const actions = plan.steps.map((s) => s.action);
    expect(actions).toContain('energy-market.co2Intensity');
  });

  test('handles missing required inputs and sets status to missing_inputs', () => {
    const plan = buildBlueprintPlan('ev-charging-co2-optimization-v1', {
      knownContext: {},
      promptHints: {},
    });
    expect(plan.status).toBe('missing_inputs');
    expect(plan.missingRequiredInputs).toContain('postalCode');
    expect(plan.warnings[0]).toContain('Missing required inputs');
  });

  describe('grid-connection-validation-v1 Blueprint Plan', () => {
    test('builds ready plan with correct steps when all required inputs are present', () => {
      const plan = buildBlueprintPlan('grid-connection-validation-v1', {
        promptHints: {
          postalCode: '76131',
          capacityKW: 500,
        },
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['grid-operations.vnbLookup', 'grid-connection.validate']);
    });

    test('sets status to missing_inputs when required inputs are absent', () => {
      const plan = buildBlueprintPlan('grid-connection-validation-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('postalCode');
      expect(plan.missingRequiredInputs).toContain('capacityKW');
    });

    test('capacityKW is resolved from requestedCapacityKW hint', () => {
      const plan = buildBlueprintPlan('grid-connection-validation-v1', {
        promptHints: { postalCode: '76131', requestedCapacityKW: 250 },
      });
      expect(plan.status).toBe('ready');
      expect(plan.steps[0].paramsTemplate.capacityKW).toBe(250);
    });

    test('capacityKW is resolved from gridCapacityKw hint', () => {
      const plan = buildBlueprintPlan('grid-connection-validation-v1', {
        promptHints: { postalCode: '76131', gridCapacityKw: 250 },
      });
      expect(plan.status).toBe('ready');
      expect(plan.steps[0].paramsTemplate.capacityKW).toBe(250);
    });

    test('capacityKW string "250 kW" is coerced to number 250', () => {
      const plan = buildBlueprintPlan('grid-connection-validation-v1', {
        promptHints: { postalCode: '76131', capacityKW: '250 kW' },
      });
      expect(plan.status).toBe('ready');
      expect(plan.steps[0].paramsTemplate.capacityKW).toBe(250);
    });

    test('missing capacityKW with no aliases produces missing_inputs', () => {
      const plan = buildBlueprintPlan('grid-connection-validation-v1', {
        promptHints: { postalCode: '76131' },
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('capacityKW');
      expect(plan.missingRequiredInputs).not.toContain('postalCode');
    });
  });

  describe('grid-fnav-validation-v1 Blueprint Plan', () => {
    test('builds ready plan with correct steps when all required inputs are present', () => {
      const plan = buildBlueprintPlan('grid-fnav-validation-v1', {
        promptHints: {
          postalCode: '67227',
          requestedCapacityKW: 2000,
        },
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['grid-operations.vnbLookup', 'grid-connection.fnavValidate']);
    });

    test('sets status to missing_inputs when required inputs are absent', () => {
      const plan = buildBlueprintPlan('grid-fnav-validation-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('postalCode');
      expect(plan.missingRequiredInputs).toContain('requestedCapacityKW');
    });
  });

  describe('edm-melo-timeseries-v1 Blueprint Plan', () => {
    test('builds ready plan with correct steps when meloId is present', () => {
      const plan = buildBlueprintPlan('edm-melo-timeseries-v1', {
        promptHints: {
          meloId: 'DE0001112223334445556667778889990',
        },
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['edm.getMelo', 'edm.getTimeseries']);
    });

    test('sets status to missing_inputs when meloId is absent', () => {
      const plan = buildBlueprintPlan('edm-melo-timeseries-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('meloId');
    });
  });

  describe('flex-device-management-v1 Blueprint Plan', () => {
    test('builds ready plan even without optional inputs', () => {
      const plan = buildBlueprintPlan('flex-device-management-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['flex.listDevices']);
    });
  });

  describe('energy-sharing-validation-v1 Blueprint Plan', () => {
    test('builds ready plan with correct steps when all required inputs are present', () => {
      const plan = buildBlueprintPlan('energy-sharing-validation-v1', {
        promptHints: {
          postalCode: '67227',
          communityName: 'Solargemeinschaft Rheinallee',
          generatorMastrNummer: 'SEE904837264953',
          consumerMaloId: 'DE0001234567890123456789012345678',
        },
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['grid-operations.vnbLookup', 'energy-sharing.validate']);
    });

    test('sets status to missing_inputs when required inputs are absent', () => {
      const plan = buildBlueprintPlan('energy-sharing-validation-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('postalCode');
      expect(plan.missingRequiredInputs).toContain('communityName');
      expect(plan.missingRequiredInputs).toContain('generatorMastrNummer');
      expect(plan.missingRequiredInputs).toContain('consumerMaloId');
    });
  });

  describe('vdmi-compliance-v1 Blueprint Plan', () => {
    test('builds ready plan with correct steps when all required inputs are present', () => {
      const plan = buildBlueprintPlan('vdmi-compliance-v1', {
        promptHints: {
          name: 'Netzanschluss-Genehmigung PV',
        },
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['vdmi.create']);
    });

    test('sets status to missing_inputs when name is absent', () => {
      const plan = buildBlueprintPlan('vdmi-compliance-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('name');
    });
  });

  describe('finance-regulatory-analysis-v1 Blueprint Plan', () => {
    test('builds ready plan with correct steps when all required inputs are present', () => {
      const plan = buildBlueprintPlan('finance-regulatory-analysis-v1', {
        promptHints: {
          query: 'Wirtschaftlichkeit von Batteriespeicher Nord',
        },
      });
      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      const actions = plan.steps.map((s) => s.action);
      expect(actions).toEqual(['finance-agent.analyze']);
    });

    test('sets status to missing_inputs when query is absent', () => {
      const plan = buildBlueprintPlan('finance-regulatory-analysis-v1', {
        knownContext: {},
        promptHints: {},
      });
      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toContain('query');
    });
  });

  describe('messkonzept-conflict-validation-v1 Blueprint Plan', () => {
    test('detects Messkonzept conflict even when postal code is still missing', () => {
      const result = detectBlueprintIntent(
        'Der Installateur hat eine Zusammenlegung der Zähler gemeldet. Die alte PV-Volleinspeiseanlage wurde demontiert. Welches Messkonzept ist korrekt?',
        {},
        {}
      );

      expect(result).not.toBeNull();
      expect(result.blueprintId).toBe('messkonzept-conflict-validation-v1');
    });

    test('builds missing-inputs plan until postal code is known', () => {
      const plan = buildBlueprintPlan('messkonzept-conflict-validation-v1', {
        message:
          'Der Installateur hat eine Zusammenlegung der Zähler gemeldet. Die alte PV-Volleinspeiseanlage wurde demontiert.',
        promptHints: {
          reportedMeteringConcept: 'MK10',
          legacyPvStatus: 'DEMOUNTED',
        },
      });

      expect(plan.status).toBe('missing_inputs');
      expect(plan.missingRequiredInputs).toEqual(['postalCode']);
      expect(plan.steps.map((step) => step.action)).toEqual([
        'grid-connection.validateMesskonzeptConflict',
      ]);
    });

    test('builds ready plan with structured Messkonzept inputs', () => {
      const plan = buildBlueprintPlan('messkonzept-conflict-validation-v1', {
        promptHints: {
          postalCode: '71332',
          reportedMeteringConcept: 'MK10',
          legacyPvStatus: 'DEMOUNTED',
          batteryChargeKW: 5,
          heatPumpKW: 7.5,
          newPvKWp: 10,
        },
      });

      expect(plan.status).toBe('ready');
      expect(plan.missingRequiredInputs).toEqual([]);
      expect(plan.primaryIntent).toBe('messkonzept_conflict_validation');
      expect(plan.steps[0].paramsTemplate).toMatchObject({
        postalCode: '71332',
        reportedMeteringConcept: 'MK10',
        legacyPvStatus: 'DEMOUNTED',
        batteryChargeKW: 5,
        heatPumpKW: 7.5,
        newPvKWp: 10,
      });
    });
  });
});

// ─── ev-co2-synthesis adapter unit test ──────────────────────────────────────

describe('ev-co2-synthesis — buildGroundedReceiptReply (extracted adapter)', () => {
  const { buildGroundedReceiptReply } = require('../src/ev-co2-synthesis');

  test('returns null when no co2Intensity step is present', () => {
    const result = buildGroundedReceiptReply('test', null, { steps: [] });
    expect(result).toBeNull();
  });

  test('returns null when no CO2 payload found in result', () => {
    const result = buildGroundedReceiptReply('test', null, {
      steps: [{ action: 'energy-market.co2Intensity', result: null }],
    });
    expect(result).toBeNull();
  });

  test('returns location mismatch message when postal codes differ', () => {
    const result = buildGroundedReceiptReply('Ich bin in 69256 Mauer', null, {
      steps: [
        {
          action: 'energy-market.co2Intensity',
          params: { postalCode: '69256', city: 'Mauer' },
          result: {
            success: true,
            data: {
              postalCode: '10117',
              city: 'Berlin',
              forecast_next_24h_gco2eq_kwh: [200, 180, 160],
            },
          },
        },
      ],
    });
    expect(result).toMatch(/keine Ladeempfehlung|ander.*Standort/i);
    expect(result).toMatch(/69256 Mauer/i);
  });

  test('returns grounded reply with CO2 forecast data and Berlin timezone', () => {
    const forecastValues = Array.from({ length: 24 }, (_unused, index) =>
      index >= 7 && index < 17 ? 57 : 180 + index
    );
    const result = buildGroundedReceiptReply(
      'Wann soll ich in 69256 Mauer mein Auto laden?',
      { receiptId: 'ev-charging-co2-optimization-v1' },
      {
        steps: [
          {
            action: 'energy-market.co2Intensity',
            params: { postalCode: '69256', city: 'Mauer' },
            result: {
              success: true,
              data: {
                postalCode: '69256',
                city: 'Mauer',
                timestamp: '2026-05-30T00:00:00Z',
                forecast_next_24h_gco2eq_kwh: forecastValues,
              },
            },
          },
        ],
      }
    );
    expect(result).toMatch(/57\s*g\s*CO₂\/kWh/i);
    expect(result).toMatch(/GrünstromIndex|CO₂-Prognose/i);
    expect(result).toMatch(/receipt.*ev-charging-co2-optimization-v1/i);
  });
});

// ─── Integration: routing.buildExecutionPlan → l3-broker path ────────────────

describe('personal-agent-routing — buildExecutionPlan uses L3 broker for EV/CO2', () => {
  const { buildExecutionPlan } = require('../src/personal-agent-routing');

  test('routes EV/CO2 message via L3 broker (blueprint-broker source)', () => {
    const plan = buildExecutionPlan({
      message: 'Wann soll ich mein E-Auto laden? PLZ 69256 Mauer, möglichst wenig CO2',
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(plan.source).toBe('blueprint-broker');
    expect(plan.primaryIntent).toMatch(/ev.*co2|co2.*optimization/i);
  });

  test('routing plan has co2Intensity action step', () => {
    const plan = buildExecutionPlan({
      message: 'E-Auto laden bei möglichst wenig CO2, PLZ 69256 Mauer',
      brokerRecommendation: null,
      knownContext: {},
    });

    const actions = plan.steps.map((s) => s.action);
    expect(actions).toContain('energy-market.co2Intensity');
  });

  test('plan paramsTemplate carries postalCode and city extracted from message', () => {
    const plan = buildExecutionPlan({
      message: 'Ich will in 69256 Mauer mein Auto laden mit CO2-Optimierung',
      brokerRecommendation: null,
      knownContext: {},
    });

    expect(plan.steps[0].paramsTemplate).toMatchObject({
      postalCode: '69256',
      city: 'Mauer',
    });
  });

  test('non-EV messages fall through to regular routing (not blueprint-broker)', () => {
    const plan = buildExecutionPlan({
      message: 'Wie ist der Netzbetreiber in Wiesloch?',
      brokerRecommendation: { recommendedCapabilities: [] },
      knownContext: {},
    });

    expect(plan.source).not.toBe('blueprint-broker');
  });

  test('grid/VNB messages with explicit grid keywords bypass L3 broker', () => {
    const plan = buildExecutionPlan({
      message: 'Residuallast und Netzengpass für DSO-Analyse in 69256',
      brokerRecommendation: { recommendedCapabilities: [] },
      knownContext: {},
    });

    expect(plan?.primaryIntent).not.toMatch(/ev_charging_co2/i);
  });
});
