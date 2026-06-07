'use strict';

const fs = require('fs');
const path = require('path');

const POLICIES_DIR = path.join(__dirname, 'clarification-policies');
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let _cache = null;
const _runtimeOverlay = new Map();

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesTerm(haystack, term) {
  return haystack.includes(normalizeText(term));
}

function loadRepoPolicies() {
  if (_cache) return _cache;
  const policies = {};
  if (!fs.existsSync(POLICIES_DIR)) {
    _cache = policies;
    return _cache;
  }
  for (const file of fs.readdirSync(POLICIES_DIR).filter((item) => item.endsWith('.json'))) {
    try {
      const policy = JSON.parse(fs.readFileSync(path.join(POLICIES_DIR, file), 'utf8'));
      if (policy && typeof policy.id === 'string') {
        policies[policy.id] = policy;
      }
    } catch (error) {
      process.stderr.write(
        `[clarification-policy-registry] Failed to load ${file}: ${error.message}\n`
      );
    }
  }
  _cache = policies;
  return _cache;
}

function listClarificationPolicies() {
  const merged = { ...loadRepoPolicies() };
  for (const [id, policy] of _runtimeOverlay) {
    merged[id] = policy;
  }
  return Object.values(merged)
    .filter((policy) => policy.status !== 'inactive')
    .map((policy) => ({
      id: policy.id,
      version: policy.version,
      status: policy.status || 'active',
      title: policy.title || '',
      description: policy.description || '',
      source: _runtimeOverlay.has(policy.id) ? 'runtime' : 'repo',
      priority: Number(policy.routing?.priority || 0),
    }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function loadClarificationPolicy(id) {
  if (_runtimeOverlay.has(id)) return _runtimeOverlay.get(id);
  return loadRepoPolicies()[id] || null;
}

function validateClarificationPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) {
    return { valid: false, errors: [{ field: 'policy', message: 'Policy must be an object.' }] };
  }
  if (typeof policy.id !== 'string' || !ID_PATTERN.test(policy.id)) {
    errors.push({ field: 'id', message: 'id must be a lowercase slug.' });
  }
  if (typeof policy.version !== 'string' || !policy.version.trim()) {
    errors.push({ field: 'version', message: 'version is required.' });
  }
  if (!isPlainObject(policy.routing)) {
    errors.push({ field: 'routing', message: 'routing is required.' });
  }
  if (!isPlainObject(policy.clarification)) {
    errors.push({ field: 'clarification', message: 'clarification is required.' });
  } else if (
    typeof policy.clarification.question !== 'string' ||
    !policy.clarification.question.trim()
  ) {
    errors.push({ field: 'clarification.question', message: 'question is required.' });
  }
  return { valid: errors.length === 0, errors };
}

function scorePolicy(policy, message, knownContext = {}) {
  const validation = validateClarificationPolicy(policy);
  if (!validation.valid) return 0;

  const routing = policy.routing || {};
  const haystack = normalizeText(
    [
      message,
      knownContext.intent,
      knownContext.domainIntent,
      knownContext.topic,
      knownContext.optimizationGoal,
      knownContext.chargingOptimizationGoal,
    ]
      .filter(Boolean)
      .join(' ')
  );

  const absentAnyTerms = Array.isArray(routing.absentAnyTerms) ? routing.absentAnyTerms : [];
  if (absentAnyTerms.some((term) => includesTerm(haystack, term))) {
    return 0;
  }

  const anyTerms = Array.isArray(routing.anyTerms) ? routing.anyTerms : [];
  if (anyTerms.length > 0 && !anyTerms.some((term) => includesTerm(haystack, term))) {
    return 0;
  }

  const requiredAnyTerms = Array.isArray(routing.requiredAnyTerms) ? routing.requiredAnyTerms : [];
  if (
    requiredAnyTerms.length > 0 &&
    !requiredAnyTerms.some((term) => includesTerm(haystack, term))
  ) {
    return 0;
  }

  const signals = Array.isArray(routing.intentSignals) ? routing.intentSignals : [];
  const hits = signals.filter((signal) => includesTerm(haystack, signal)).length;
  const termHit = anyTerms.some((term) => includesTerm(haystack, term)) ? 1 : 0;
  const requiredHit = requiredAnyTerms.some((term) => includesTerm(haystack, term)) ? 1 : 0;
  return hits + termHit + requiredHit + Number(routing.priority || 0) / 100;
}

function findClarificationPolicyMatch({ message, knownContext = {}, chatMode = null } = {}) {
  const effectiveChatMode = String(chatMode || '').toLowerCase();
  let best = null;
  for (const summary of listClarificationPolicies()) {
    const policy = loadClarificationPolicy(summary.id);
    if (!policy) continue;
    const chatModes = Array.isArray(policy.routing?.chatModes)
      ? policy.routing.chatModes.map((item) => String(item).toLowerCase())
      : [];
    if (chatModes.length > 0 && !chatModes.includes(effectiveChatMode)) {
      continue;
    }
    const score = scorePolicy(policy, message, knownContext);
    if (score > 0 && (!best || score > best.score)) {
      best = { policy, score };
    }
  }
  return best;
}

function setRuntimeClarificationPolicy(id, policy) {
  _runtimeOverlay.set(id, policy);
}

function clearRuntimeClarificationPolicy(id) {
  _runtimeOverlay.delete(id);
}

function _resetCache() {
  _cache = null;
  _runtimeOverlay.clear();
}

module.exports = {
  POLICIES_DIR,
  listClarificationPolicies,
  loadClarificationPolicy,
  validateClarificationPolicy,
  findClarificationPolicyMatch,
  setRuntimeClarificationPolicy,
  clearRuntimeClarificationPolicy,
  _resetCache,
  _scorePolicy: scorePolicy,
};
