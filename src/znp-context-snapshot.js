// src/znp-context-snapshot.js
// v0.56.3 — ZNP Context Snapshot normalization helpers
// Shared between agent-persona.service.js and personal-agent.service.js.
// All functions are null-safe and never throw.
'use strict';

const ALLOWED_ACTIVE_LAYERS = Object.freeze([
  'planning',
  'grid',
  'asset',
  'scenario',
  'topology',
  'redispatch',
]);

// ASCII-canonical keys only — no § characters
const ALLOWED_PLANNING_SCENARIOS = Object.freeze([
  'enwg_14a',
  'enwg_42c',
  'redispatch_expost',
  'nap_expansion',
  'asset_review',
  'grid_connection_validation',
  'market_communication',
  'governance_review',
]);

const ALLOWED_ASSET_TYPES = Object.freeze([
  'storage',
  'solar',
  'wind',
  'heatpump',
  'wallbox',
  'datacenter',
  'ev_charging',
  'chp',
  'other',
]);

// workflowType → planningScenario proxy (used when planningScenario not explicitly set)
const WORKFLOW_TO_SCENARIO = Object.freeze({
  grid_connection_validation: 'grid_connection_validation',
  redispatch_expost: 'redispatch_expost',
  asset_review: 'asset_review',
  market_communication: 'market_communication',
  governance_review: 'governance_review',
  nap_expansion: 'nap_expansion',
});

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeActiveLayer(value) {
  const s = trimStr(value);
  return ALLOWED_ACTIVE_LAYERS.includes(s) ? s : null;
}

function normalizePlanningScenario(value) {
  const s = trimStr(value);
  return ALLOWED_PLANNING_SCENARIOS.includes(s) ? s : null;
}

/**
 * Normalize assetContext — only assetType + capacityClass.
 * mastrId and all other fields are excluded.
 */
function normalizeZnpAssetContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const assetType = ALLOWED_ASSET_TYPES.includes(trimStr(value.assetType))
    ? trimStr(value.assetType)
    : null;
  const capacityClass =
    typeof value.capacityClass === 'string'
      ? trimStr(value.capacityClass).slice(0, 20) || null
      : null;
  if (!assetType && !capacityClass) return null;
  return { assetType, capacityClass };
}

/**
 * Build the ZNP context snapshot from chat turn inputs.
 * Used by personal-agent.service.js before calling resolvePersonaForTrace.
 * All fields are null-safe. Never throws.
 */
function buildZnpContextSnapshot(ctx, session, semanticClassification) {
  const kc = ctx?.params?.knownContext ?? {};
  const rp = session?.resolvedParams ?? {};

  const znpProjectId =
    typeof kc.znpProjectId === 'string'
      ? kc.znpProjectId.trim().slice(0, 120) || null
      : typeof rp.znpProjectId === 'string'
        ? rp.znpProjectId.trim().slice(0, 120) || null
        : null;

  const activeLayer = normalizeActiveLayer(kc.activeLayer ?? null);

  const explicitScenario = normalizePlanningScenario(kc.planningScenario ?? null);
  const proxyScenario = normalizePlanningScenario(
    WORKFLOW_TO_SCENARIO[semanticClassification?.workflowType] ?? null
  );
  const planningScenario = explicitScenario ?? proxyScenario ?? null;

  const assetContext = normalizeZnpAssetContext(kc.assetContext ?? null);

  return { znpProjectId, activeLayer, planningScenario, assetContext };
}

module.exports = {
  ALLOWED_ACTIVE_LAYERS,
  ALLOWED_PLANNING_SCENARIOS,
  ALLOWED_ASSET_TYPES,
  WORKFLOW_TO_SCENARIO,
  normalizeActiveLayer,
  normalizePlanningScenario,
  normalizeZnpAssetContext,
  buildZnpContextSnapshot,
};
