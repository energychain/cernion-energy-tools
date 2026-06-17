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
    // eslint-disable-next-line global-require
    _staticRoutesCache = require(STATIC_ROUTES_PATH);
  } catch (_err) {
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

function buildGapMarkerCapability(route) {
  return {
    capability: route.capability,
    domain: route.coverageCluster || 'gap-marker',
    abstractionLevel: 'domain_gap_marker',
    intent: route.capability,
    keywords: (route.triggers || []).slice(0, 10),
    preferredActions: route.preferredActions || ['interface-placeholder.markGap'],
    fallbackActions: route.fallbackActions || ['interface-placeholder.markGap'],
    avoid: ['query.ask', 'query.askLearned', 'vdmi.dossier'],
    requiredInputs: [],
    risksAndNotes: [
      `Runtime gap-marker for domain route ${route.id}. Source: issue #${route.sourceIssue || 'unknown'}.`,
    ],
    routingPattern: route.id,
    _isRuntimeMaterialized: true,
  };
}

module.exports = {
  listCompiledDomainRoutes,
  reloadDomainRoutes,
  setRuntimeRoute,
  removeRuntimeRoute,
  getStaticRoutes,
  getRuntimeRoutes,
  setRuntimeCapability,
  removeRuntimeCapability,
  findRuntimeCapability,
  listRuntimeCapabilities,
  buildGapMarkerCapability,
  isUnsafePattern,
  safeCompileRegex,
};
