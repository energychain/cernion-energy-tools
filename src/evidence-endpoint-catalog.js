'use strict';

/**
 * Curated read-only Evidence Endpoint Catalog (issue energychain/cernion-energy-tools#272).
 *
 * Each entry maps an abstract evidence kind (`resultKind`) to ONE concrete,
 * pre-vetted read-only Cernion action. This is the data src/evidence-router.js
 * matches against — evidence-TYPE first, never domain-keyword/location-only —
 * which is the architectural fix for the reported bug ("a narrower time-series/
 * CO2 endpoint request can incorrectly recommend GET /api/assets/solar").
 *
 * Deliberately small and cross-checked rather than exhaustive (per the issue's
 * own guidance: "lieber wenige gut typisierte Evidence-Kinds als ein großer
 * unscharfer Katalog"). Two provenance strategies, both "maintained from
 * existing API/capability/hydration metadata" as suggested by the issue:
 *
 *  1. `asset_table` is derived programmatically from the existing
 *     src/blueprints/mastr-asset-service-selection-v1.json blueprint step
 *     (energychain/cernion-energy-tools#271) — zero duplication, the action
 *     template and params live in exactly one place.
 *  2. The ENTSO-E / energy-market entries are hand-curated but their
 *     `action` + read-only claim are cross-checked against
 *     src/dossier-hydration-registry.js#getRule() by
 *     validateEvidenceEndpointCatalog() — getRule() only compiles (returns
 *     non-null for) a rule whose safety.readOnly is true, with no mutation
 *     and no HITL requirement, so a non-null result IS the read-only proof.
 *     See tests/evidence-router.test.js. A drifted/removed hydration rule
 *     fails that test loudly instead of silently mis-certifying an entry.
 *
 * Read-only is asserted via this catalog's curation + the hydration-registry
 * cross-check — NOT via HTTP method (unlike #271's compiler, which is
 * deliberately GET-only because it feeds a GET-only Sidecar REST proxy).
 * Many genuinely read-only actions in this codebase use POST for body-based
 * queries (e.g. entsoe.loadForecast, energy-market.prices).
 */

const { loadBlueprint } = require('./blueprint-registry');

const RESULT_KINDS = Object.freeze(['asset_table', 'time_series', 'market_signal']);

function buildAssetTableEntry() {
  const blueprint = loadBlueprint('mastr-asset-service-selection-v1');
  const step = blueprint?.execution?.steps?.[0];
  if (!step) {
    // Fails loud rather than silently omitting asset_table coverage.
    throw new Error(
      '[evidence-endpoint-catalog] mastr-asset-service-selection-v1 blueprint step not found'
    );
  }
  return {
    id: 'mastr_asset_table',
    resultKind: 'asset_table',
    action: step.action,
    params: step.params,
    requiredInputs: ['location'],
    optionalInputs: ['assetType', 'minCapacity', 'maxCapacity', 'commissioningYear', 'limit'],
    inputDefaults: { assetType: 'solar', limit: 100 },
    semanticFacts: [
      'A list of MaStR installation records matching the filter (capacity, commissioning date, location, grid operator, operational status).',
      'Not pre-aggregated — may return the complete matching row set; counting, ranking or windowing is the caller\'s responsibility.',
    ],
    freshness: 'static_registry',
    granularity: 'per_installation',
    timeRangeSupport: false,
    evidenceTypeSignals: [
      'erzeugungsanlage',
      'erzeugungsanlagen',
      'mastr anlage',
      'mastr anlagen',
      'asset lookup',
      'anlagenliste',
      'anlagen liste',
      'solaranlage(?!.*(prognose|forecast))',
      'solaranlagen(?!.*(prognose|forecast))',
      'windanlage(?!.*(prognose|forecast))',
      'windanlagen(?!.*(prognose|forecast))',
      'installations lookup',
      'asset inventory',
      'liste aller anlagen',
    ],
    sourceProvenance: 'blueprint:mastr-asset-service-selection-v1',
  };
}

const ENTSOE_ENERGY_MARKET_ENTRIES = [
  {
    id: 'entsoe_load_forecast',
    resultKind: 'time_series',
    action: 'entsoe.loadForecast',
    params: {
      region: '{{inputs.region}}',
      dateFrom: '{{inputs.dateFrom}}',
      dateTo: '{{inputs.dateTo}}',
      resolution: '{{inputs.resolution}}',
    },
    requiredInputs: ['dateFrom', 'dateTo'],
    optionalInputs: ['region', 'resolution'],
    inputDefaults: { region: 'Germany', resolution: 'hourly' },
    semanticFacts: [
      'Hourly (or daily) German electricity load/demand forecast time series with min/max/avg statistics.',
    ],
    freshness: 'forecast',
    granularity: 'hourly',
    timeRangeSupport: true,
    evidenceTypeSignals: ['lastprognose', 'last prognose', 'verbrauchsprognose', 'load forecast', 'demand forecast'],
    sourceProvenance: 'hydration_rule:entsoe.loadForecast',
  },
  {
    id: 'entsoe_wind_solar_forecast',
    resultKind: 'time_series',
    action: 'entsoe.windSolarForecast',
    params: {
      region: '{{inputs.region}}',
      dateFrom: '{{inputs.dateFrom}}',
      dateTo: '{{inputs.dateTo}}',
      forecastType: '{{inputs.forecastType}}',
    },
    requiredInputs: ['dateFrom', 'dateTo'],
    optionalInputs: ['region', 'forecastType'],
    inputDefaults: { region: 'Germany', forecastType: 'both' },
    semanticFacts: [
      'Hourly wind/solar generation forecast time series (renewable infeed) with min/max/avg statistics.',
    ],
    freshness: 'forecast',
    granularity: 'hourly',
    timeRangeSupport: true,
    evidenceTypeSignals: [
      'einspeiseprognose',
      'erzeugungsprognose',
      'wind.*prognose',
      'solar.*prognose',
      'wind.*forecast',
      'solar.*forecast',
      'renewable.*forecast',
    ],
    sourceProvenance: 'hydration_rule:entsoe.windSolarForecast',
  },
  {
    id: 'co2_intensity_time_series',
    resultKind: 'time_series',
    action: 'energy-market.co2Intensity',
    params: {
      location: '{{inputs.location}}',
      forecast: '{{inputs.forecast}}',
    },
    requiredInputs: ['location'],
    optionalInputs: ['forecast', 'timestamp'],
    inputDefaults: { forecast: true },
    semanticFacts: [
      'Regional CO₂ intensity (GrünstromIndex), optionally as a forecast time series rather than a single current value.',
    ],
    freshness: 'current_or_forecast',
    granularity: 'hourly',
    timeRangeSupport: false,
    evidenceTypeSignals: ['co2', 'co₂', 'co2-intensität', 'co2 intensität', 'grünstromindex', 'grünstrom index'],
    sourceProvenance: 'hydration_rule:energy-market.co2Intensity',
  },
  {
    id: 'entsoe_day_ahead_prices',
    resultKind: 'market_signal',
    action: 'entsoe.dayAheadPrices',
    params: {
      region: '{{inputs.region}}',
      dateFrom: '{{inputs.dateFrom}}',
      dateTo: '{{inputs.dateTo}}',
    },
    requiredInputs: ['dateFrom', 'dateTo'],
    optionalInputs: ['region'],
    inputDefaults: { region: 'Germany' },
    semanticFacts: ['Day-ahead electricity spot price time series (EUR/MWh) with min/max/avg statistics.'],
    freshness: 'current',
    granularity: 'hourly',
    timeRangeSupport: true,
    evidenceTypeSignals: ['day-ahead', 'day ahead preis', 'großhandelspreis', 'spotmarkt preis', 'spot preis'],
    sourceProvenance: 'hydration_rule:entsoe.dayAheadPrices',
  },
  {
    id: 'energy_market_prices',
    resultKind: 'market_signal',
    action: 'energy-market.prices',
    params: {
      market: '{{inputs.market}}',
      region: '{{inputs.region}}',
      date: '{{inputs.date}}',
    },
    requiredInputs: ['market', 'region'],
    optionalInputs: ['date', 'startDate', 'endDate'],
    inputDefaults: { market: 'day-ahead', region: 'Germany' },
    semanticFacts: ['Day-ahead/intraday/futures electricity market price array for the requested market and region.'],
    freshness: 'current',
    granularity: 'hourly',
    timeRangeSupport: true,
    evidenceTypeSignals: ['strompreis', 'spotpreis', 'marktpreis', 'preis', 'preise', 'electricity price'],
    sourceProvenance: 'hydration_rule:energy-market.prices',
  },
];

function buildCatalog() {
  return [buildAssetTableEntry(), ...ENTSOE_ENERGY_MARKET_ENTRIES];
}

// Cross-checks every hydration-rule-sourced entry against the authoritative
// read-only signal in src/dossier-hydration-registry.js. getRule() compiles a
// raw rule from answer-dossier-hydration-rules.json into a non-null result
// ONLY when _isSafetyRejected() passes (safety.readOnly === true, no mutation,
// no HITL requirement, not on the blocked-action list) — so a non-null
// getRule(action) result IS itself the read-only proof; no need to re-read
// `safety` off the (stripped) compiled object. Returns a list of problems
// (empty = catalog is fully grounded). Intentionally NOT run at module load
// (would couple require-time to the hydration registry's load order) — call
// this from a test instead (see tests/evidence-router.test.js).
function validateEvidenceEndpointCatalog(catalog) {
  const { getRule } = require('./dossier-hydration-registry');
  const problems = [];

  for (const entry of catalog) {
    if (!entry.sourceProvenance?.startsWith('hydration_rule:')) continue;
    const rule = getRule(entry.action);
    if (!rule) {
      problems.push(
        `${entry.id}: no safety-approved hydration rule found for action "${entry.action}" (missing, disabled, or rejected by _isSafetyRejected)`
      );
    }
  }

  return problems;
}

module.exports = {
  RESULT_KINDS,
  EVIDENCE_ENDPOINT_CATALOG: buildCatalog(),
  buildCatalog,
  validateEvidenceEndpointCatalog,
};
