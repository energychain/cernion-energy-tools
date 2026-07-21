'use strict';

/**
 * Operation Capability Index - ranking helper (issue #416)
 *
 * Loads the generated operation-capability-index.json artifact (see
 * scripts/generate-operation-capability-index.js) and exposes a deterministic
 * ranking API so agent integrations (Capability Broker, Blueprints, Personal
 * Agent, OpenClaw/ChatGPT/Copilot Sidecars) can find the right operation for
 * a natural-language request without hand-built per-endpoint routing rules.
 *
 * This module never decides whether an agent is ALLOWED to call an
 * operation - that remains a tenant/scope/backend concern. It only ranks
 * candidates and reports missing required parameters; see
 * docs/OPERATION_CAPABILITY_INDEX.md for the full contract.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_INDEX_PATH = path.join(__dirname, '..', 'operation-capability-index.json');

// Below this score a match is considered too weak to surface at all. Kept
// low relative to HIGH/MEDIUM thresholds deliberately: the product principle
// behind issue #416 is to maximize visibility (never blanket-hide an
// operation), so a single strong keyword hit should still surface the
// operation - just at 'low' confidence - rather than be dropped entirely.
const MIN_ROUTABLE_SCORE = 12;
const HIGH_CONFIDENCE_SCORE = 150;
const MEDIUM_CONFIDENCE_SCORE = 60;

let cachedIndex = null;
let cachedIndexPath = null;

// -- loading --------------------------------------------------------------

function loadOperationCapabilityIndex(indexPath = DEFAULT_INDEX_PATH) {
  if (cachedIndex && cachedIndexPath === indexPath) return cachedIndex;
  const raw = fs.readFileSync(indexPath, 'utf8');
  const parsed = JSON.parse(raw);
  cachedIndex = parsed;
  cachedIndexPath = indexPath;
  return parsed;
}

// Test/caller hook: bypass the file cache with an in-memory index object
// (e.g. a fixture built from a handful of classified operations).
function resolveIndex(options = {}) {
  if (options.index) return options.index;
  return loadOperationCapabilityIndex(options.indexPath || DEFAULT_INDEX_PATH);
}

function resetOperationCapabilityIndexCache() {
  cachedIndex = null;
  cachedIndexPath = null;
}

// -- text normalization --------------------------------------------------

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactIdentifier(text) {
  return normalizeText(text).replace(/\s+/g, '');
}

function tokenize(text) {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(' ') : [];
}

// Naive suffix-stripping so plural/singular and simple verb-form variants
// (forecasts/forecast, prices/price) still match without pulling in a real
// stemming dependency - deliberately conservative to avoid collapsing
// unrelated short words (e.g. "gas", "co2").
function stem(token) {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && /(ches|shes|xes|ses)$/.test(token)) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

// -- scoring --------------------------------------------------------------

// Tokenizes every phrase in `phrases` and unions the resulting stems - used
// to turn rankingSignals.positiveKeywords/negativeCues (which may mix single
// words and multi-word phrases) into one token set for intersection scoring
// against the query's (also stemmed) tokens.
function tokenSetOf(phrases) {
  const tokens = new Set();
  for (const phrase of phrases || []) {
    for (const token of tokenize(phrase)) tokens.add(stem(token));
  }
  return tokens;
}

function tokenWeight(token) {
  return token.length > 5 ? 12 : token.length > 3 ? 8 : 3;
}

function scoreOperationEntry(entry, queryContext) {
  const { queryTokens, normalizedQuery, compactQuery, capability, domain } = queryContext;
  const signals = entry.rankingSignals || {};
  let score = 0;

  // Curated (per-operation, hand-tuned) signals from OPERATION_SIGNAL_OVERLAY
  // are trusted more than the generic per-domain fallback, which is
  // identical across every operation in a domain and is meant only as a
  // weak domain-level hint, not a disambiguator between operations that
  // share a domain.
  const positiveWeightBonus = signals.curated ? 4 : 0;
  const synonymWeight = signals.curated ? 25 : 5;
  const negativeCueWeight = signals.curated ? 40 : 15;

  const positiveTokens = tokenSetOf(signals.positiveKeywords);
  for (const token of queryTokens) {
    if (positiveTokens.has(stem(token))) score += tokenWeight(token) + positiveWeightBonus;
  }

  for (const synonym of signals.synonyms || []) {
    const normalizedSynonym = normalizeText(synonym);
    if (normalizedSynonym && normalizedQuery.includes(normalizedSynonym)) {
      score += synonymWeight;
    }
  }

  // Phrase-level (not token-bag) matching: negativeCues like "single country
  // fill level" must appear as that phrase, not merely contribute individual
  // words that happen to co-occur with an unrelated query (e.g. "fill" +
  // "level" alone should not veto every multi-country comparison operation).
  for (const cue of signals.negativeCues || []) {
    const normalizedCue = normalizeText(cue);
    if (normalizedCue && normalizedQuery.includes(normalizedCue)) {
      score -= negativeCueWeight;
    }
  }

  if (capability && (entry.capabilityCandidates || []).includes(capability)) {
    score += 100;
  }

  if (domain && (entry.domains || []).includes(domain)) {
    score += 30;
  }

  // Deliberately excludes the bare `entry.service`/`entry.path` - service
  // names like "forecast" or "assets" are common English words that can
  // false-positive substring-match inside an unrelated compacted query
  // (e.g. "...intensity**forecast**for..."). `action`/`operationId` are
  // service+action compounds (e.g. "gasStorageCompareCountries"), long and
  // specific enough that a substring hit is a genuine identifier mention.
  const explicitIdentifiers = [entry.action, entry.operationId]
    .filter(Boolean)
    .map(compactIdentifier)
    .filter((identifier) => identifier.length >= 10);
  if (explicitIdentifiers.some((identifier) => compactQuery.includes(identifier))) {
    score += 200;
  }

  return score;
}

function buildQueryContext(query, { capability = null, domain = null } = {}) {
  const combinedQueryText = `${query || ''} ${capability || ''} ${domain || ''}`;
  return {
    normalizedQuery: normalizeText(combinedQueryText),
    queryTokens: tokenize(combinedQueryText),
    compactQuery: compactIdentifier(query || ''),
    capability,
    domain,
  };
}

function confidenceForScore(score) {
  if (score >= HIGH_CONFIDENCE_SCORE) return 'high';
  if (score >= MEDIUM_CONFIDENCE_SCORE) return 'medium';
  if (score >= MIN_ROUTABLE_SCORE) return 'low';
  return 'none';
}

// -- parameter gap analysis ----------------------------------------------

// `extractedInputs` is a flat object of already-resolved values, keyed by
// either the raw parameter name or its extractionHint (e.g. `date_range_start`).
// Matching is case-insensitive on both keys.
function findMissingRequiredParameters(entry, extractedInputs = {}) {
  const provided = new Set(Object.keys(extractedInputs || {}).map((k) => k.toLowerCase()));
  const required = (entry.parameters && entry.parameters.required) || [];
  return required.filter((param) => {
    const nameMatch = provided.has(String(param.name || '').toLowerCase());
    const hintMatch =
      param.extractionHint && provided.has(String(param.extractionHint).toLowerCase());
    return !nameMatch && !hintMatch;
  });
}

// -- public ranking API ----------------------------------------------------

/**
 * Ranks operations in the index against a natural-language query.
 *
 * @param {string} query - natural-language request text.
 * @param {object} [options]
 * @param {string} [options.capability] - capability slug to bias toward (see src/capability-catalog.js).
 * @param {string} [options.domain] - canonical domain to bias toward (see src/llm-manifest-taxonomy.js).
 * @param {number} [options.limit=5] - max candidates to return.
 * @param {boolean} [options.includeNonAgentable=false] - include agentable:false entries.
 * @param {object} [options.extractedInputs] - already-resolved parameter values, used to compute missingRequiredParameters.
 * @param {object} [options.index] - pre-loaded index object (bypasses file read; for tests).
 * @param {string} [options.indexPath] - alternate index file path.
 * @returns {Array<object>} candidates sorted by descending score, each with score/confidence/missingRequiredParameters.
 */
function rankOperations(query, options = {}) {
  const {
    capability = null,
    domain = null,
    limit = 5,
    includeNonAgentable = false,
    extractedInputs = {},
  } = options;
  const index = resolveIndex(options);

  const queryContext = buildQueryContext(query, { capability, domain });
  const lexicalQueryContext = buildQueryContext(query);

  const candidates = (index.operations || [])
    .filter((entry) => includeNonAgentable || entry.agentable)
    .map((entry) => {
      const score = scoreOperationEntry(entry, queryContext);
      const querySignalScore = scoreOperationEntry(entry, lexicalQueryContext);
      return {
        operationId: entry.operationId,
        action: entry.action,
        method: entry.method,
        path: entry.path,
        service: entry.service,
        summary: entry.summary,
        operationKind: entry.operationKind,
        consequenceLevel: entry.consequenceLevel,
        recommendedExecutionMode: entry.recommendedExecutionMode,
        agentable: entry.agentable,
        domains: entry.domains,
        capabilityCandidates: entry.capabilityCandidates,
        score,
        querySignalScore,
        confidence: confidenceForScore(score),
        requiredParameters: (entry.parameters && entry.parameters.required) || [],
        optionalParameters: (entry.parameters && entry.parameters.optional) || [],
        missingRequiredParameters: findMissingRequiredParameters(entry, extractedInputs),
      };
    })
    .filter(
      (candidate) =>
        candidate.score >= MIN_ROUTABLE_SCORE && candidate.querySignalScore >= MIN_ROUTABLE_SCORE
    )
    .sort((a, b) => b.score - a.score || a.operationId.localeCompare(b.operationId));

  return candidates.slice(0, limit);
}

/**
 * Convenience wrapper: returns the single best candidate (or null if nothing
 * clears MIN_ROUTABLE_SCORE), with the runner-up candidates attached as
 * `alternatives` for transparency/debugging.
 */
function selectTopOperation(query, options = {}) {
  const candidates = rankOperations(query, { ...options, limit: (options.limit || 5) + 1 });
  if (!candidates.length) return null;
  const [best, ...rest] = candidates.slice(0, (options.limit || 5) + 1);
  return { ...best, alternatives: rest.slice(0, options.limit || 4) };
}

function findOperationById(operationId, options = {}) {
  const index = resolveIndex(options);
  return (index.operations || []).find((entry) => entry.operationId === operationId) || null;
}

function listOperationsByCapability(capability, options = {}) {
  const index = resolveIndex(options);
  return (index.operations || []).filter((entry) =>
    (entry.capabilityCandidates || []).includes(capability)
  );
}

function listOperationsByDomain(domain, options = {}) {
  const index = resolveIndex(options);
  return (index.operations || []).filter((entry) => (entry.domains || []).includes(domain));
}

module.exports = {
  DEFAULT_INDEX_PATH,
  MIN_ROUTABLE_SCORE,
  loadOperationCapabilityIndex,
  resetOperationCapabilityIndexCache,
  rankOperations,
  selectTopOperation,
  findOperationById,
  listOperationsByCapability,
  listOperationsByDomain,
  findMissingRequiredParameters,
  // exported for targeted unit testing
  scoreOperationEntry,
  normalizeText,
  compactIdentifier,
  tokenize,
  stem,
};
