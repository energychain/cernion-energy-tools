'use strict';

const path = require('path');
const fs = require('fs');

const BLUEPRINTS_DIR = path.join(__dirname, 'blueprints');

// Lazily-loaded cache: populated on first access
let _cache = null;

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
      // Non-blocking: log to stderr and continue
      process.stderr.write(`[blueprint-registry] Failed to load ${file}: ${err.message}\n`);
    }
  }

  _cache = blueprints;
  return _cache;
}

function loadBlueprint(id) {
  const blueprints = _loadAll();
  return blueprints[id] || null;
}

function listBlueprints() {
  const blueprints = _loadAll();
  return Object.values(blueprints).map((bp) => ({
    id: bp.id,
    version: bp.version,
    title: bp.meta?.title || '',
    description: bp.meta?.description || '',
    targetAudience: bp.meta?.targetAudience || '',
    intentSignals: bp.routing?.intentSignals || [],
    negativeSignals: bp.routing?.negativeSignals || [],
    priorityBoost: bp.routing?.priorityBoost ?? 0,
  }));
}

// Reset cache (useful for testing)
function _resetCache() {
  _cache = null;
}

module.exports = {
  loadBlueprint,
  listBlueprints,
  _resetCache,
  BLUEPRINTS_DIR,
};
