'use strict';

/**
 * Evidence Router tests (issue energychain/cernion-energy-tools#272).
 *
 * Deliberately a separate test file from tests/process-intake.test.js so the
 * two contracts' test surfaces stay as distinguishable as the contracts
 * themselves. Uses a fake broker registry (no real services booted) —
 * mirrors tests/blueprint-rest-plan-compiler.test.js's fakeBroker pattern.
 */

const { routeEvidence } = require('../src/evidence-router');
const {
  EVIDENCE_ENDPOINT_CATALOG,
  validateEvidenceEndpointCatalog,
} = require('../src/evidence-endpoint-catalog');

function fakeBroker(actionsByService) {
  return {
    registry: {
      getServiceList: () =>
        Object.entries(actionsByService).map(([name, actions]) => ({ name, actions })),
    },
  };
}

const FULL_BROKER = fakeBroker({
  assets: { 'assets.solar': { rest: 'GET /solar' } },
  entsoe: {
    'entsoe.loadForecast': { rest: 'POST /load-forecast' },
    'entsoe.windSolarForecast': { rest: 'POST /wind-solar-forecast' },
    'entsoe.dayAheadPrices': { rest: 'POST /day-ahead-prices' },
  },
  'energy-market': {
    'energy-market.co2Intensity': { rest: 'POST /co2-intensity' },
    'energy-market.prices': { rest: 'POST /prices' },
  },
});

describe('evidence-endpoint-catalog', () => {
  test('every hydration-rule-sourced entry is grounded in a safety-approved hydration rule', () => {
    const problems = validateEvidenceEndpointCatalog(EVIDENCE_ENDPOINT_CATALOG);
    expect(problems).toEqual([]);
  });

  test('covers exactly the three intended result kinds', () => {
    const kinds = new Set(EVIDENCE_ENDPOINT_CATALOG.map((e) => e.resultKind));
    expect(kinds).toEqual(new Set(['asset_table', 'time_series', 'market_signal']));
  });
});

describe('routeEvidence', () => {
  test('CO2/time-series request never substitutes the unrelated asset-list endpoint (the reported bug)', () => {
    const result = routeEvidence({
      question: 'Wie hoch ist die CO2-Intensität in den nächsten 24 Stunden in 69168?',
      context: { location: '69168' },
      broker: FULL_BROKER,
    });

    expect(result.success).toBe(true);
    expect(result.resolved).toEqual({ kind: 'evidence_plan', source: 'evidence_router' });
    expect(result.requiredEvidenceTypes).toEqual(['time_series']);
    expect(result.coverage.coveredEvidenceTypes).toEqual(['time_series']);
    expect(result.coverage.missingEvidenceTypes).toEqual([]);
    expect(result.coverage.noSubstitution).toBe(true);

    const purposes = result.recommendedEndpoints.map((e) => e.purpose);
    expect(purposes).toContain('co2_intensity_time_series');
    expect(purposes).not.toContain('mastr_asset_table');
    expect(result.recommendedEndpoints.some((e) => e.path === '/api/assets/solar')).toBe(false);
  });

  test('recommends multiple complementary time_series endpoints for one request', () => {
    const result = routeEvidence({
      question: 'CO2 Prognose und Einspeiseprognose für morgen',
      context: { location: '69168' },
      broker: FULL_BROKER,
    });

    const kinds = new Set(result.recommendedEndpoints.map((e) => e.resultKind));
    expect(kinds).toEqual(new Set(['time_series']));
    expect(result.recommendedEndpoints.length).toBeGreaterThan(1);
    for (const endpoint of result.recommendedEndpoints) {
      expect(endpoint.policy).toEqual({
        readOnly: true,
        sideEffects: 'none',
        tenantScoped: true,
        externalSideEffects: false,
      });
      expect(typeof endpoint.semanticFacts[0]).toBe('string');
    }
  });

  test('asset-table request recommends only the asset_table endpoint, not a market/time-series one', () => {
    const result = routeEvidence({
      question: 'Liste aller Solaranlagen in 69168',
      context: { assetType: 'solar', location: '69168' },
      broker: FULL_BROKER,
    });

    expect(result.requiredEvidenceTypes).toEqual(['asset_table']);
    expect(result.recommendedEndpoints).toHaveLength(1);
    expect(result.recommendedEndpoints[0]).toMatchObject({
      method: 'GET',
      path: '/api/assets/solar',
      resultKind: 'asset_table',
    });
  });

  test('reports a missing evidence type without substituting an unrelated endpoint when required inputs are absent', () => {
    const result = routeEvidence({
      question: 'Liste aller Solaranlagen', // no location anywhere
      context: {},
      broker: FULL_BROKER,
    });

    expect(result.requiredEvidenceTypes).toEqual(['asset_table']);
    expect(result.coverage.coveredEvidenceTypes).toEqual([]);
    expect(result.coverage.missingEvidenceTypes).toEqual(['asset_table']);
    expect(result.coverage.noSubstitution).toBe(true);
    expect(result.recommendedEndpoints).toEqual([]);
  });

  test('returns empty, non-substituting result for a question with no inferable evidence type', () => {
    const result = routeEvidence({
      question: 'Wie ist das Wetter heute?',
      context: {},
      broker: FULL_BROKER,
    });

    expect(result.success).toBe(true);
    expect(result.requiredEvidenceTypes).toEqual([]);
    expect(result.recommendedEndpoints).toEqual([]);
    expect(result.coverage.noSubstitution).toBe(true);
  });

  test('market_signal request resolves day-ahead price endpoints', () => {
    const result = routeEvidence({
      question: 'Wie hoch ist der Spotpreis morgen?',
      context: {},
      broker: FULL_BROKER,
    });

    expect(result.requiredEvidenceTypes).toEqual(['market_signal']);
    expect(result.coverage.coveredEvidenceTypes).toEqual(['market_signal']);
    expect(result.recommendedEndpoints.every((e) => e.resultKind === 'market_signal')).toBe(true);
  });

  test('fails soft (no throw) when called without a broker', () => {
    const result = routeEvidence({ question: 'irrelevant', context: {} });
    expect(result.success).toBe(false);
    expect(result.error).toBe('broker_unavailable');
  });

  test('response shape is structurally distinguishable from a Process Intake response', () => {
    const result = routeEvidence({
      question: 'Liste aller Solaranlagen in 69168',
      context: { assetType: 'solar', location: '69168' },
      broker: FULL_BROKER,
    });

    expect(result.resolved.kind).toBe('evidence_plan');
    expect(result.resolved.kind).not.toBe('process_intake');
    expect(result).not.toHaveProperty('receipt');
    expect(result.recommendedEndpoints[0].policy.readOnly).toBe(true);
  });

  test('a non-GET read-only action (POST body query) is still a valid recommendation — read-only is not HTTP-method-gated', () => {
    const result = routeEvidence({
      question: 'CO2 Intensität jetzt',
      context: { location: '69168' },
      broker: FULL_BROKER,
    });
    const co2 = result.recommendedEndpoints.find((e) => e.purpose === 'co2_intensity_time_series');
    expect(co2.method).toBe('POST');
    expect(co2.policy.readOnly).toBe(true);
  });
});
