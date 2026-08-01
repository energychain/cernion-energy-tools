'use strict';

const path = require('path');

const STATIC_ROUTES_PATH = path.join(__dirname, 'answer-dossier-domain-routes.json');

// Patterns that are catastrophically broad, empty, or one-character wildcards.
function isUnsafePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return true;
  const trimmed = pattern.trim();
  if (trimmed.length <= 1) return true;
  // Rejects: .* .+ . .? .*$ ^.* etc.
  if (/^\.\*\$?$/.test(trimmed)) return true;
  if (/^\.\+\$?$/.test(trimmed)) return true;
  if (/^\.\??\$?$/.test(trimmed)) return true;
  if (/^\^?\.\*\$?$/.test(trimmed)) return true;
  return false;
}

function safeCompileRegex(pattern) {
  if (isUnsafePattern(pattern)) {
    throw new Error(`Unsafe or too-broad regex pattern: "${pattern}"`);
  }
  return new RegExp(pattern, 'i');
}

function compileRoute(route) {
  const compiledCombos = (route.combos || []).map((combo) => ({
    all: combo.all.map((p) => safeCompileRegex(p)),
  }));
  return { ...route, _compiledCombos: compiledCombos };
}

// ── In-memory stores ──────────────────────────────────────────────────────────

let _staticRoutesCache = null;
const _runtimeRouteOverlay = new Map(); // id → raw route (not compiled)
const _runtimeCapabilities = new Map(); // capabilityName → capability object
let _compiledRoutesCache = null;

// ── Static route loader ────────────────────────────────────────────────────────

function _loadStaticRoutes() {
  if (_staticRoutesCache !== null) return _staticRoutesCache;
  try {
    _staticRoutesCache = require(STATIC_ROUTES_PATH);
  } catch (_err) {
    process.stderr.write(
      `[domain-routes-registry] silent-catch-fallback (line 47): ${_err && _err.message}\n`
    );
    _staticRoutesCache = [];
  }
  return _staticRoutesCache;
}

// ── Compiled-routes builder (merge static + runtime, compile regexes) ─────────

function _buildCompiledRoutes() {
  const staticRoutes = _loadStaticRoutes();
  const merged = new Map();

  for (const route of staticRoutes) {
    if (route && route.id) merged.set(route.id, route);
  }

  // Runtime overrides static by id
  for (const [id, route] of _runtimeRouteOverlay) {
    merged.set(id, route);
  }

  const compiled = [];
  for (const route of merged.values()) {
    try {
      compiled.push(compileRoute(route));
    } catch (_compileErr) {
      // Fail closed: skip invalid routes rather than crashing broker
    }
  }

  return compiled;
}

// ── Public API ────────────────────────────────────────────────────────────────

function listCompiledDomainRoutes() {
  if (_compiledRoutesCache === null) {
    _compiledRoutesCache = _buildCompiledRoutes();
  }
  return _compiledRoutesCache;
}

function reloadDomainRoutes() {
  _compiledRoutesCache = _buildCompiledRoutes();
  return _compiledRoutesCache;
}

function setRuntimeRoute(id, route) {
  _runtimeRouteOverlay.set(id, route);
  _compiledRoutesCache = null;
}

function removeRuntimeRoute(id) {
  const had = _runtimeRouteOverlay.has(id);
  _runtimeRouteOverlay.delete(id);
  if (had) _compiledRoutesCache = null;
  return had;
}

function getStaticRoutes() {
  return _loadStaticRoutes();
}

function getRuntimeRoutes() {
  return Array.from(_runtimeRouteOverlay.values());
}

function getRuntimeRoute(id) {
  return _runtimeRouteOverlay.get(id) || null;
}

// ── Runtime capability overlay (Option B: gap-marker materialization) ─────────

function setRuntimeCapability(capabilityName, capabilityObject) {
  _runtimeCapabilities.set(capabilityName, capabilityObject);
}

function removeRuntimeCapability(capabilityName) {
  _runtimeCapabilities.delete(capabilityName);
}

function findRuntimeCapability(capabilityName) {
  return _runtimeCapabilities.get(capabilityName) || null;
}

function listRuntimeCapabilities() {
  return Array.from(_runtimeCapabilities.values());
}

const SAFE_ACTION_PREFIX = 'interface-placeholder.';

function _filterSafeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  const safe = actions.filter((a) => typeof a === 'string' && a.startsWith(SAFE_ACTION_PREFIX));
  return safe.length > 0 ? safe : null;
}

function buildGapMarkerCapability(route) {
  // Runtime-materialized capabilities are constrained to interface-placeholder actions only.
  // Any non-placeholder actions passed via route fields are silently dropped; if nothing
  // remains after filtering the safe fallback is used.
  const preferredActions = _filterSafeActions(route.preferredActions) || [
    'interface-placeholder.markGap',
  ];
  const fallbackActions = _filterSafeActions(route.fallbackActions) || [
    'interface-placeholder.markGap',
  ];

  return {
    capability: route.capability,
    domain: route.coverageCluster || 'gap-marker',
    abstractionLevel: 'domain_gap_marker',
    intent: route.capability,
    keywords: (route.triggers || []).slice(0, 10),
    preferredActions,
    fallbackActions,
    avoid: ['query.ask', 'query.askLearned', 'vdmi.dossier'],
    requiredInputs: [],
    risksAndNotes: [
      `Runtime gap-marker for domain route ${route.id}. Source: issue #${route.sourceIssue || 'unknown'}.`,
    ],
    routingPattern: route.id,
    _isRuntimeMaterialized: true,
  };
}

// Clears all in-memory state. Intended for test isolation only.
function _resetRegistry() {
  _staticRoutesCache = null;
  _compiledRoutesCache = null;
  _runtimeRouteOverlay.clear();
  _runtimeCapabilities.clear();
}

module.exports = {
  listCompiledDomainRoutes,
  reloadDomainRoutes,
  setRuntimeRoute,
  removeRuntimeRoute,
  getStaticRoutes,
  getRuntimeRoutes,
  getRuntimeRoute,
  setRuntimeCapability,
  removeRuntimeCapability,
  findRuntimeCapability,
  listRuntimeCapabilities,
  buildGapMarkerCapability,
  isUnsafePattern,
  safeCompileRegex,
  _resetRegistry,
};
