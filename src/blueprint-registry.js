'use strict';

const path = require('path');
const fs = require('fs');

const BLUEPRINTS_DIR = path.join(__dirname, 'blueprints');

// Lazily-loaded filesystem cache
let _cache = null;

// In-memory runtime overlay: populated by blueprint-management.service.js on start/promote/rollback.
// Runtime blueprints shadow repo blueprints of the same id without touching the filesystem.
const _runtimeOverlay = new Map();

function _loadAll() {
  if (_cache) return _cache;

  const blueprints = {};
  const files = fs.readdirSync(BLUEPRINTS_DIR).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const blueprint = JSON.parse(fs.readFileSync(path.join(BLUEPRINTS_DIR, file), 'utf8'));
      if (blueprint && typeof blueprint.id === 'string') {
        blueprints[blueprint.id] = blueprint;
      }
    } catch (err) {
      process.stderr.write(`[blueprint-registry] Failed to load ${file}: ${err.message}\n`);
    }
  }

  _cache = blueprints;
  return _cache;
}

function loadBlueprint(id) {
  if (_runtimeOverlay.has(id)) return _runtimeOverlay.get(id);
  const blueprints = _loadAll();
  return blueprints[id] || null;
}

function listBlueprints() {
  const repoBlueprints = _loadAll();
  // Merge: runtime overlay entries shadow repo entries of the same id
  const merged = { ...repoBlueprints };
  for (const [id, bp] of _runtimeOverlay) {
    merged[id] = bp;
  }
  return Object.values(merged).map((bp) => ({
    id: bp.id,
    version: bp.version,
    title: bp.meta?.title || '',
    description: bp.meta?.description || '',
    targetAudience: bp.meta?.targetAudience || '',
    intentSignals: bp.routing?.intentSignals || [],
    negativeSignals: bp.routing?.negativeSignals || [],
    priorityBoost: bp.routing?.priorityBoost ?? 0,
    source: _runtimeOverlay.has(bp.id) ? 'runtime' : 'repo',
  }));
}

// Called by blueprint-management.service.js after promote/rollback/startup
function setRuntimeBlueprint(id, blueprint) {
  _runtimeOverlay.set(id, blueprint);
}

// Called by blueprint-management.service.js when a runtime blueprint is removed/reset
function clearRuntimeBlueprint(id) {
  _runtimeOverlay.delete(id);
}

// Reset both filesystem cache and runtime overlay (for testing)
function _resetCache() {
  _cache = null;
  _runtimeOverlay.clear();
}

module.exports = {
  loadBlueprint,
  listBlueprints,
  setRuntimeBlueprint,
  clearRuntimeBlueprint,
  _resetCache,
  BLUEPRINTS_DIR,
};
