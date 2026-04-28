'use strict';

/**
 * CYA Profile Observer — Progressive Profiling (v0.34.0)
 *
 * Implements the Zwiebelmodus (onion model) for implicit and explicit
 * profile learning:
 *
 *  Outer layers (implicit — auto-updated after every completed session):
 *    implicitStats.focusAreaFrequency
 *    implicitStats.signalReactions
 *    implicitStats.toolUsage
 *    preferences.focusAreaWeights
 *    preferences.preferredTools
 *
 *  Inner layers (explicit — only via PATCH /api/cya/profile/:id):
 *    constraints
 *    explicitPreferences
 *    priorityFocusAreas
 *    tone, strategic_goals
 *
 *  Zwiebel-Invariante: explicit fields are NEVER overwritten by implicit updates.
 *
 * EU AI Act Art. 12: all profile mutations carry updatedAt + profileVersion
 * for full provenance traceability.
 *
 * @module cya-profile-observer
 */

// ── Constants ─────────────────────────────────────────────────────────────

/** Minimum tool usage count before a tool is added to preferredTools */
const PREFERRED_TOOL_MIN_USAGE = 2;

/** Confidence string → numeric map for moving average */
const CONFIDENCE_NUMERIC = Object.freeze({
  high:   1.0,
  medium: 0.5,
  low:    0.1,
});

/** Fields that explicitUpdate is NOT allowed to set */
const FORBIDDEN_EXPLICIT_FIELDS = new Set([
  'implicitStats',
  'profileVersion',
  'createdAt',
  'actor',
]);

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Parse tool names from a toolSetRationale string.
 * Rationale format: "actorRole=X; focusAreas=[...]; signal-override: ..."
 * We extract any token that looks like a known MCP tool handle (contains '_').
 * @param {string|null} rationale
 * @returns {string[]}
 */
function _parseToolsFromRationale(rationale) {
  if (!rationale || typeof rationale !== 'string') return [];
  // Tools are snake_case identifiers separated by whitespace, '→', ';', or ','
  const tokens = rationale.split(/[\s,;→]+/);
  return tokens.filter(t => t.includes('_') && t.length > 5 && !t.includes('=') && !t.includes('['));
}

/**
 * Normalise a frequency map so the highest value = 1.0.
 * @param {Object<string,number>} freq
 * @returns {Object<string,number>}
 */
function _normaliseFrequency(freq) {
  const entries = Object.entries(freq);
  if (entries.length === 0) return {};
  const max = Math.max(...entries.map(([, v]) => v));
  if (max === 0) return Object.fromEntries(entries.map(([k]) => [k, 0]));
  return Object.fromEntries(entries.map(([k, v]) => [k, Math.round((v / max) * 100) / 100]));
}

/**
 * Deep-clone a plain object (no circular refs, no class instances).
 * @param {Object} obj
 * @returns {Object}
 */
function _clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Build a default implicitStats block.
 * @returns {Object}
 */
function _defaultImplicitStats() {
  return {
    sessionCount:        0,
    lastActiveAt:        null,
    focusAreaFrequency:  {},
    signalReactions:     {},
    toolUsage:           {},
    averageConfidence:   null,
  };
}

/**
 * Build a default preferences block.
 * @returns {Object}
 */
function _defaultPreferences() {
  return {
    focusAreaWeights:  {},
    signalSensitivity: {},
    preferredTools:    [],
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract implicit learning signals from a completed session object.
 *
 * @param {Object} session - Completed session from cya_sessions
 * @returns {{
 *   focusAreas: string[],
 *   signalsSeen: string[],
 *   toolsUsed: string[],
 *   confidence: string|null,
 *   hadRefinement: boolean,
 * }}
 */
function extractImplicitSignals(session) {
  if (!session || typeof session !== 'object') {
    return { focusAreas: [], signalsSeen: [], toolsUsed: [], confidence: null, hadRefinement: false };
  }

  // focusAreas — from context
  const focusAreas = Array.isArray(session.context?.focus_areas)
    ? session.context.focus_areas.filter(a => typeof a === 'string')
    : [];

  // signalsSeen — from regulatory_graph.signals[].ruleId
  const signalsSeen = Array.isArray(session.regulatory_graph?.signals)
    ? session.regulatory_graph.signals
        .map(s => s.ruleId)
        .filter(Boolean)
    : [];

  // toolsUsed — from grounding.toolSetRationale (parse) + grounding.signalOverrides[].tool
  const toolsFromRationale = _parseToolsFromRationale(session.grounding?.toolSetRationale);
  const toolsFromOverrides = Array.isArray(session.grounding?.signalOverrides)
    ? session.grounding.signalOverrides.map(o => o.tool || o.injectedTool).filter(Boolean)
    : [];
  // Also check retrieval-level fields (belt-and-suspenders)
  const toolsFromRetrievalRationale = _parseToolsFromRationale(session.retrieval?.toolSetRationale);
  const toolsFromRetrievalOverrides = Array.isArray(session.retrieval?.signalOverrides)
    ? session.retrieval.signalOverrides.map(o => o.tool || o.injectedTool).filter(Boolean)
    : [];

  const toolsUsed = [
    ...new Set([
      ...toolsFromRationale,
      ...toolsFromOverrides,
      ...toolsFromRetrievalRationale,
      ...toolsFromRetrievalOverrides,
    ]),
  ].filter(t => typeof t === 'string' && t.length > 0);

  // confidence — from grounding
  const confidence = session.grounding?.confidence || null;

  // hadRefinement — user called /refine at least once
  const hadRefinement = Array.isArray(session.history) && session.history.length > 0;

  return { focusAreas, signalsSeen, toolsUsed, confidence, hadRefinement };
}

/**
 * Merge implicit signals from a completed session into an existing profile.
 * Outer-layer operation — NEVER touches explicitPreferences, constraints,
 * priorityFocusAreas.
 *
 * @param {Object} existingProfile - Profile payload from object-store
 * @param {{
 *   focusAreas: string[],
 *   signalsSeen: string[],
 *   toolsUsed: string[],
 *   confidence: string|null,
 *   hadRefinement: boolean,
 * }} implicitSignals
 * @returns {Object} Updated profile (new object, existingProfile not mutated)
 */
function mergeImplicitIntoProfile(existingProfile, implicitSignals) {
  const profile = _clone(existingProfile || {});

  // Ensure required blocks exist
  if (!profile.implicitStats || typeof profile.implicitStats !== 'object') {
    profile.implicitStats = _defaultImplicitStats();
  }
  if (!profile.preferences || typeof profile.preferences !== 'object') {
    profile.preferences = _defaultPreferences();
  }
  if (!profile.preferences.focusAreaWeights) profile.preferences.focusAreaWeights = {};
  if (!profile.preferences.signalSensitivity) profile.preferences.signalSensitivity = {};
  if (!Array.isArray(profile.preferences.preferredTools)) profile.preferences.preferredTools = [];

  const stats = profile.implicitStats;
  const prefs = profile.preferences;

  // sessionCount + lastActiveAt
  stats.sessionCount = (stats.sessionCount || 0) + 1;
  stats.lastActiveAt = new Date().toISOString();

  // focusAreaFrequency
  if (!stats.focusAreaFrequency) stats.focusAreaFrequency = {};
  for (const area of (implicitSignals.focusAreas || [])) {
    stats.focusAreaFrequency[area] = (stats.focusAreaFrequency[area] || 0) + 1;
  }

  // signalReactions
  if (!stats.signalReactions) stats.signalReactions = {};
  for (const ruleId of (implicitSignals.signalsSeen || [])) {
    if (!stats.signalReactions[ruleId]) {
      stats.signalReactions[ruleId] = { seen: 0, refined: 0 };
    }
    stats.signalReactions[ruleId].seen += 1;
    if (implicitSignals.hadRefinement) {
      stats.signalReactions[ruleId].refined += 1;
    }
  }

  // toolUsage
  if (!stats.toolUsage) stats.toolUsage = {};
  for (const tool of (implicitSignals.toolsUsed || [])) {
    stats.toolUsage[tool] = (stats.toolUsage[tool] || 0) + 1;
  }

  // averageConfidence — exponential moving average (weight = 1/sessionCount)
  const confNum = CONFIDENCE_NUMERIC[implicitSignals.confidence] ?? null;
  if (confNum !== null) {
    const prev = stats.averageConfidence ?? confNum;
    const w = 1 / stats.sessionCount;
    stats.averageConfidence = Math.round((prev * (1 - w) + confNum * w) * 100) / 100;
  }

  // preferences.focusAreaWeights — normalised frequency
  prefs.focusAreaWeights = _normaliseFrequency(stats.focusAreaFrequency);

  // preferences.preferredTools — tools with usage > threshold, sorted by usage
  prefs.preferredTools = Object.entries(stats.toolUsage)
    .filter(([, count]) => count > PREFERRED_TOOL_MIN_USAGE)
    .sort(([, a], [, b]) => b - a)
    .map(([tool]) => tool);

  // Version + timestamp
  profile.profileVersion = (profile.profileVersion || 1) + 1;
  profile.updatedAt = new Date().toISOString();

  return profile;
}

/**
 * Merge explicit user-provided preferences into an existing profile.
 * Inner-layer operation — NEVER touches implicitStats.
 *
 * Allowed fields in explicitUpdate:
 *   constraints, explicitPreferences, priorityFocusAreas, tone, strategic_goals
 *
 * Forbidden: implicitStats, profileVersion, createdAt, actor
 *
 * @param {Object} existingProfile
 * @param {{
 *   constraints?: Array<{topic: string, rule: string}>,
 *   explicitPreferences?: Object,
 *   priorityFocusAreas?: string[],
 *   tone?: string,
 *   strategic_goals?: string[],
 * }} explicitUpdate
 * @returns {Object} Updated profile
 */
function mergeExplicitIntoProfile(existingProfile, explicitUpdate) {
  const profile = _clone(existingProfile || {});
  const update = explicitUpdate || {};

  // Apply only allowed fields — silently drop forbidden ones
  for (const [key, value] of Object.entries(update)) {
    if (FORBIDDEN_EXPLICIT_FIELDS.has(key)) continue;

    if (key === 'constraints') {
      profile.constraints = Array.isArray(value)
        ? value.map(c => ({
            topic: String(c.topic || ''),
            rule:  String(c.rule  || ''),
            setAt: new Date().toISOString(),
          }))
        : profile.constraints || [];
    } else if (key === 'explicitPreferences') {
      profile.explicitPreferences = (value && typeof value === 'object')
        ? { ...(profile.explicitPreferences || {}), ...value }
        : profile.explicitPreferences || {};
    } else if (key === 'priorityFocusAreas') {
      profile.priorityFocusAreas = Array.isArray(value)
        ? value.filter(a => typeof a === 'string')
        : profile.priorityFocusAreas || [];
    } else if (key === 'tone' && typeof value === 'string') {
      profile.tone = value;
    } else if (key === 'strategic_goals' && Array.isArray(value)) {
      profile.strategic_goals = value.filter(g => typeof g === 'string');
    }
    // unknown keys are silently dropped
  }

  // Version + timestamp
  profile.profileVersion = (profile.profileVersion || 1) + 1;
  profile.updatedAt = new Date().toISOString();

  return profile;
}

/**
 * Derive tool-router hints from a profile.
 * Output is consumed by cya-tool-registry.resolveToolSet as profileHints.
 *
 * @param {Object} profile - Profile payload
 * @returns {{
 *   boostedFocusAreas: string[],
 *   preferredTools: string[],
 *   avoidSignals: string[],
 * }}
 */
function deriveToolHints(profile) {
  if (!profile || typeof profile !== 'object') {
    return { boostedFocusAreas: [], preferredTools: [], avoidSignals: [] };
  }

  const weights = profile.preferences?.focusAreaWeights || {};
  const boostedFocusAreas = Object.entries(weights)
    .filter(([, w]) => w > 0.6)
    .map(([area]) => area);

  const preferredTools = Array.isArray(profile.preferences?.preferredTools)
    ? [...profile.preferences.preferredTools]
    : [];

  const sensitivity = profile.preferences?.signalSensitivity || {};
  const avoidSignals = Object.entries(sensitivity)
    .filter(([, level]) => level === 'low')
    .map(([ruleId]) => ruleId);

  return { boostedFocusAreas, preferredTools, avoidSignals };
}

module.exports = {
  extractImplicitSignals,
  mergeImplicitIntoProfile,
  mergeExplicitIntoProfile,
  deriveToolHints,
  // Exported for testing
  _parseToolsFromRationale,
  _normaliseFrequency,
  PREFERRED_TOOL_MIN_USAGE,
};
