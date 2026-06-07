'use strict';

const fs = require('fs');
const path = require('path');

const RULES_DIR = path.join(__dirname, 'rcs-rules');
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SUPPORTED_TECHNOLOGIES = ['solar', 'wind_onshore', 'wind_offshore', 'biomass'];
const CALCULATION_MODES = ['simulation', 'validation', 'audit'];
const STATUS_VALUES = ['active', 'superseded', 'draft', 'deprecated'];

let _cache = null;
const _runtimeOverlay = new Map();

// ── Validation ────────────────────────────────────────────────────────────────

function validateRuleSet(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return { valid: false, errors: [{ field: 'rule', message: 'Must be an object.' }] };
  }
  if (typeof rule.id !== 'string' || !ID_PATTERN.test(rule.id)) {
    errors.push({ field: 'id', message: 'id must be a lowercase kebab-case slug.' });
  }
  if (typeof rule.version !== 'string' || !rule.version.trim()) {
    errors.push({ field: 'version', message: 'version is required.' });
  }
  if (typeof rule.effectiveFrom !== 'string' || !rule.effectiveFrom.trim()) {
    errors.push({ field: 'effectiveFrom', message: 'effectiveFrom (ISO date) is required.' });
  }
  if (!CALCULATION_MODES.includes(rule.calculationMode)) {
    errors.push({
      field: 'calculationMode',
      message: `calculationMode must be one of: ${CALCULATION_MODES.join(', ')}.`,
    });
  }
  const p = rule.parameters;
  if (!p || typeof p !== 'object') {
    errors.push({ field: 'parameters', message: 'parameters object is required.' });
  } else {
    if (typeof p.s51ConsecutiveNegHours !== 'number' || p.s51ConsecutiveNegHours <= 0) {
      errors.push({
        field: 'parameters.s51ConsecutiveNegHours',
        message: 'Must be a positive number.',
      });
    }
    if (!p.technologyFloors || typeof p.technologyFloors !== 'object') {
      errors.push({ field: 'parameters.technologyFloors', message: 'Must be an object.' });
    }
    if (!Array.isArray(p.supportedTechnologies) || p.supportedTechnologies.length === 0) {
      errors.push({
        field: 'parameters.supportedTechnologies',
        message: 'Must be a non-empty array.',
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── File loading ──────────────────────────────────────────────────────────────

function loadFileRules() {
  if (_cache) return _cache;
  const rules = {};
  if (!fs.existsSync(RULES_DIR)) {
    _cache = rules;
    return _cache;
  }
  for (const file of fs.readdirSync(RULES_DIR).filter((f) => f.endsWith('.json'))) {
    try {
      const rule = JSON.parse(fs.readFileSync(path.join(RULES_DIR, file), 'utf8'));
      if (rule && typeof rule.id === 'string') {
        rules[rule.id] = rule;
      }
    } catch (err) {
      process.stderr.write(`[rcs-rule-registry] Failed to load ${file}: ${err.message}\n`);
    }
  }
  _cache = rules;
  return _cache;
}

// ── Public API ────────────────────────────────────────────────────────────────

function listRuleSets() {
  const merged = { ...loadFileRules() };
  for (const [id, rule] of _runtimeOverlay) {
    merged[id] = rule;
  }
  return Object.values(merged)
    .map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status || 'active',
      effectiveFrom: r.effectiveFrom,
      calculationMode: r.calculationMode,
      sourceReference: r.sourceReference || '',
      source: _runtimeOverlay.has(r.id) ? 'runtime' : 'repo',
    }))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
}

function getRuleSet(id) {
  if (_runtimeOverlay.has(id)) return _runtimeOverlay.get(id);
  return loadFileRules()[id] ?? null;
}

/**
 * Resolves a rule set by explicit id, 'latest' (most recent effectiveFrom among active),
 * or falls back to 'latest' when id is falsy.
 */
function resolveRuleSet(idOrLatest) {
  if (!idOrLatest || idOrLatest === 'latest') {
    const active = listRuleSets().filter((r) => r.status === 'active');
    if (active.length === 0) return null;
    return getRuleSet(active[0].id); // already sorted desc by effectiveFrom
  }
  return getRuleSet(idOrLatest);
}

function registerRuleSet(rule) {
  const result = validateRuleSet(rule);
  if (!result.valid) return result;
  _runtimeOverlay.set(rule.id, rule);
  return { valid: true, errors: [] };
}

function unregisterRuleSet(id) {
  _runtimeOverlay.delete(id);
}

function _resetCache() {
  _cache = null;
  _runtimeOverlay.clear();
}

module.exports = {
  RULES_DIR,
  SUPPORTED_TECHNOLOGIES,
  validateRuleSet,
  listRuleSets,
  getRuleSet,
  resolveRuleSet,
  registerRuleSet,
  unregisterRuleSet,
  _resetCache,
};
