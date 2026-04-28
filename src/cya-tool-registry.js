'use strict';

/**
 * CYA Dynamic Tool Router — Hyper-Relevance Engine (v0.33.0)
 *
 * Determines the minimal, precise set of data-source tools for a given
 * actor role + focus-area combination, optionally adjusted by ontology
 * signals (severity-driven overrides).
 *
 * Design: every role sees ONLY the tools relevant to its context.
 * No context overflow — the LLM receives exactly what it needs.
 *
 * EU AI Act Art. 12: every resolved tool set carries a `rationale` string
 * that records why specific tools were chosen or overridden.
 */

const { MoleculerError } = require('moleculer').Errors;

// ── Data-path identifiers ─────────────────────────────────────────────────

const DATA_PATHS = Object.freeze({
  MASTR_DETERMINISTIC: 'energy-market.installations',
  LLM_RAG:             'query.ask',
  MCP_DIRECT:          'mcp_direct',
});

// ── MCP tool handles ──────────────────────────────────────────────────────

const MCP_TOOLS = Object.freeze({
  INSTALLATIONS_LOCAL:  'cernion_installations_local',
  GRID_DATA:            'cernion_grid_data',
  GRID_TOPOLOGY:        'osm_grid_topology',
  ENERGY_PRODUCTION:    'cernion_energy_production',
  DAY_AHEAD_PRICES:     'entsoe_day_ahead_prices',
  WIND_SOLAR_FORECAST:  'entsoe_wind_solar_forecast',
  REDISPATCH:           'cernion_redispatch_export',
  SUBSTATION_FINDER:    'osm_substation_finder',
});

// ── Valid actor roles (mirrors ACTOR_ROLES in cya.service.js) ─────────────

const VALID_ACTOR_ROLES = Object.freeze([
  'grid_operator',
  'supplier',
  'project_developer',
  'direct_marketer',
  'metering_operator',
  'regulator',
  'municipality',
  'journalist',
  'citizen',
]);

// ── Role → allowed MCP tools ──────────────────────────────────────────────

const ROLE_TOOL_WHITELIST = Object.freeze({
  grid_operator: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.GRID_DATA,
    MCP_TOOLS.GRID_TOPOLOGY,
    MCP_TOOLS.SUBSTATION_FINDER,
    MCP_TOOLS.REDISPATCH,
    MCP_TOOLS.WIND_SOLAR_FORECAST,
  ],
  supplier: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.DAY_AHEAD_PRICES,
    MCP_TOOLS.ENERGY_PRODUCTION,
    MCP_TOOLS.WIND_SOLAR_FORECAST,
  ],
  project_developer: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.GRID_DATA,
    MCP_TOOLS.SUBSTATION_FINDER,
    MCP_TOOLS.DAY_AHEAD_PRICES,
  ],
  direct_marketer: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.DAY_AHEAD_PRICES,
    MCP_TOOLS.ENERGY_PRODUCTION,
    MCP_TOOLS.WIND_SOLAR_FORECAST,
  ],
  metering_operator: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.GRID_DATA,
  ],
  regulator: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.GRID_DATA,
    MCP_TOOLS.REDISPATCH,
  ],
  municipality: [
    MCP_TOOLS.INSTALLATIONS_LOCAL,
    MCP_TOOLS.ENERGY_PRODUCTION,
  ],
  journalist: [
    MCP_TOOLS.ENERGY_PRODUCTION,
    MCP_TOOLS.DAY_AHEAD_PRICES,
  ],
  citizen: [
    MCP_TOOLS.ENERGY_PRODUCTION,
  ],
});

// ── focusArea → ordered tool priority ────────────────────────────────────

const FOCUS_AREA_TOOL_PRIORITY = Object.freeze({
  capacity:       [MCP_TOOLS.INSTALLATIONS_LOCAL, DATA_PATHS.MASTR_DETERMINISTIC],
  grid_capacity:  [MCP_TOOLS.INSTALLATIONS_LOCAL, MCP_TOOLS.GRID_DATA, DATA_PATHS.MASTR_DETERMINISTIC],
  renewables:     [MCP_TOOLS.INSTALLATIONS_LOCAL, MCP_TOOLS.WIND_SOLAR_FORECAST, DATA_PATHS.MASTR_DETERMINISTIC],
  grid_expansion: [MCP_TOOLS.GRID_TOPOLOGY, MCP_TOOLS.GRID_DATA, DATA_PATHS.LLM_RAG],
  redispatch:     [MCP_TOOLS.REDISPATCH, MCP_TOOLS.GRID_DATA, DATA_PATHS.LLM_RAG],
  energy_sharing: [MCP_TOOLS.INSTALLATIONS_LOCAL, DATA_PATHS.LLM_RAG],
  digitalization: [DATA_PATHS.LLM_RAG],
  compliance:     [DATA_PATHS.LLM_RAG],
  customer:       [DATA_PATHS.LLM_RAG],
  investment:     [MCP_TOOLS.DAY_AHEAD_PRICES, DATA_PATHS.LLM_RAG],
  section14a:     [MCP_TOOLS.INSTALLATIONS_LOCAL, MCP_TOOLS.GRID_DATA, DATA_PATHS.LLM_RAG],
  nova:           [MCP_TOOLS.GRID_DATA, MCP_TOOLS.INSTALLATIONS_LOCAL, DATA_PATHS.LLM_RAG],
});

// ── Signal-override rules ─────────────────────────────────────────────────

const SIGNAL_OVERRIDE_RULES = [
  {
    ruleId: 'VOLTAGE_HOP_REQUIRED',
    severities: ['warning', 'critical'],
    injectTool: MCP_TOOLS.SUBSTATION_FINDER,
    reason: 'VOLTAGE_HOP_REQUIRED → SUBSTATION_FINDER forced',
  },
  {
    ruleId: 'MISSING_NAP',
    severities: ['critical'],
    injectTool: MCP_TOOLS.GRID_DATA,
    reason: 'MISSING_NAP critical → GRID_DATA forced',
  },
  {
    ruleId: 'HIGH_CURTAILMENT',
    severities: ['warning', 'critical'],
    injectTool: MCP_TOOLS.REDISPATCH,
    reason: 'HIGH_CURTAILMENT → REDISPATCH added',
  },
  {
    ruleId: 'GRID_TOPOLOGY_RADIAL',
    severities: ['info', 'warning', 'critical'],
    injectTool: MCP_TOOLS.GRID_TOPOLOGY,
    reason: 'GRID_TOPOLOGY_RADIAL → GRID_TOPOLOGY added',
  },
];

// ── Internal helpers ──────────────────────────────────────────────────────

/**
 * Extract MCP tool names from a list of tool-priority entries
 * (skipping DATA_PATHS entries like 'query.ask', 'energy-market.installations').
 */
function _extractMcpToolNames(toolList) {
  const dataPathValues = new Set(Object.values(DATA_PATHS));
  return toolList.filter(t => !dataPathValues.has(t));
}

/**
 * Find the first entry in a tool priority list that is in the role's whitelist.
 * Returns the entry (could be a DATA_PATH or MCP_TOOL), or LLM_RAG as fallback.
 */
function _resolvePrimaryPath(toolPriorityList, allowedTools) {
  for (const tool of toolPriorityList) {
    if (Object.values(DATA_PATHS).includes(tool)) return tool;
    if (allowedTools.includes(tool)) return DATA_PATHS.MCP_DIRECT;
  }
  return DATA_PATHS.LLM_RAG;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Check whether a specific MCP tool is allowed for a given actor role.
 *
 * @param {string} actorRole
 * @param {string} mcpToolName
 * @returns {boolean}
 */
function isToolAllowed(actorRole, mcpToolName) {
  const whitelist = ROLE_TOOL_WHITELIST[actorRole];
  if (!whitelist) return false;
  return whitelist.includes(mcpToolName);
}

/**
 * Get all allowed tools for a role.
 *
 * @param {string} actorRole
 * @returns {string[]}
 */
function getAllowedTools(actorRole) {
  if (!ROLE_TOOL_WHITELIST[actorRole]) {
    throw new MoleculerError(
      `Unknown actor role: ${actorRole}`,
      400,
      'UNKNOWN_ACTOR_ROLE',
      { actorRole }
    );
  }
  return Array.from(ROLE_TOOL_WHITELIST[actorRole]);
}

/**
 * Resolve the optimal tool set for a given actor role + focus areas,
 * adjusted by ontology signals and optional profile-derived hints.
 *
 * @param {string} actorRole - One of VALID_ACTOR_ROLES
 * @param {string[]} focusAreas - List of focus area identifiers
 * @param {Array<{ruleId: string, severity: string}>|string[]|null} ontologySignals
 * @param {{boostedFocusAreas?: string[], preferredTools?: string[], avoidSignals?: string[]}|null} [profileHints]
 * @returns {{
 *   primaryPath: string,
 *   mcpTools: string[],
 *   fallbackPath: string,
 *   rationale: string,
 *   signalOverrides: Array<{ruleId: string, tool: string, injectedTool: string, reason: string}>
 * }}
 */
function resolveToolSet(actorRole, focusAreas, ontologySignals, profileHints) {
  if (!actorRole) {
    throw new MoleculerError(
      'actorRole is required for resolveToolSet',
      400,
      'INVALID_ACTOR_ROLE'
    );
  }
  if (!VALID_ACTOR_ROLES.includes(actorRole)) {
    throw new MoleculerError(
      `Unknown actor role: ${actorRole}`,
      400,
      'UNKNOWN_ACTOR_ROLE',
      { actorRole }
    );
  }

  const areas = Array.isArray(focusAreas) ? focusAreas : [];
  const allowedTools = getAllowedTools(actorRole);
  const rationaleLines = [`actorRole=${actorRole}`];

  // Step 1: Collect candidate tools from focus-area priorities
  const candidateToolsSet = new Set();
  let primaryPath = DATA_PATHS.LLM_RAG;
  let primaryResolved = false;

  if (areas.length === 0) {
    rationaleLines.push('no focusAreas → fallback to LLM_RAG');
  } else {
    for (const area of areas) {
      const priority = FOCUS_AREA_TOOL_PRIORITY[area];
      if (!priority) continue;
      const mcpNames = _extractMcpToolNames(priority);
      for (const tool of mcpNames) {
        if (allowedTools.includes(tool)) candidateToolsSet.add(tool);
      }
      if (!primaryResolved) {
        const resolved = _resolvePrimaryPath(priority, allowedTools);
        primaryPath = resolved;
        primaryResolved = true;
      }
    }
    rationaleLines.push(`focusAreas=[${areas.join(',')}]`);
  }

  // Step 2: Signal-based overrides
  const signalOverrides = [];
  const signals = Array.isArray(ontologySignals) ? ontologySignals : [];

  for (const rawSignal of signals) {
    // Accept both string shorthand ('VOLTAGE_HOP_REQUIRED') and
    // full object ({ ruleId, severity }) forms.
    // String shorthand uses 'critical' so all severity tiers match.
    const signalRuleId = typeof rawSignal === 'string' ? rawSignal : rawSignal.ruleId;
    const signalSeverity = typeof rawSignal === 'string' ? 'critical' : (rawSignal.severity || 'warning');
    const rule = SIGNAL_OVERRIDE_RULES.find(
      r => r.ruleId === signalRuleId && r.severities.includes(signalSeverity)
    );
    if (!rule) continue;
    if (!allowedTools.includes(rule.injectTool)) continue; // role gate
    if (!candidateToolsSet.has(rule.injectTool)) {
      candidateToolsSet.add(rule.injectTool);
      signalOverrides.push({
        ruleId: signalRuleId,
        tool: rule.injectTool,
        injectedTool: rule.injectTool,
        reason: rule.reason,
      });
      rationaleLines.push(`signal-override: ${rule.reason}`);
    }
  }

  // Step 3: Profile hints (v0.34.0) — optional, non-blocking
  const hints = (profileHints && typeof profileHints === 'object') ? profileHints : null;
  if (hints) {
    // boostedFocusAreas: treat as additional focusAreas for tool resolution
    const boosted = Array.isArray(hints.boostedFocusAreas) ? hints.boostedFocusAreas : [];
    for (const area of boosted) {
      const priority = FOCUS_AREA_TOOL_PRIORITY[area];
      if (!priority) continue;
      for (const tool of _extractMcpToolNames(priority)) {
        if (allowedTools.includes(tool)) candidateToolsSet.add(tool);
      }
    }
    if (boosted.length > 0) rationaleLines.push(`profile-boost: [${boosted.join(',')}]`);

    // preferredTools: promote to front of mcpTools if whitelisted
    const preferred = Array.isArray(hints.preferredTools) ? hints.preferredTools : [];
    for (const tool of preferred) {
      if (allowedTools.includes(tool)) candidateToolsSet.add(tool);
    }
    if (preferred.length > 0) rationaleLines.push(`profile-preferred: [${preferred.join(',')}]`);

    // avoidSignals: suppress signal overrides for these ruleIds
    const avoid = new Set(Array.isArray(hints.avoidSignals) ? hints.avoidSignals : []);
    if (avoid.size > 0) {
      const before = signalOverrides.length;
      const filtered = signalOverrides.filter(o => !avoid.has(o.ruleId));
      if (filtered.length < before) {
        rationaleLines.push(`profile-avoid: [${[...avoid].join(',')}]`);
      }
      signalOverrides.length = 0;
      for (const o of filtered) signalOverrides.push(o);
      // Also remove suppressed tools from candidateSet if not added by other means
    }
  }

  const mcpTools = Array.from(candidateToolsSet);

  // Promote preferredTools to front of mcpTools list
  if (hints?.preferredTools?.length > 0) {
    const preferred = new Set(hints.preferredTools.filter(t => allowedTools.includes(t)));
    const front = mcpTools.filter(t => preferred.has(t));
    const rest  = mcpTools.filter(t => !preferred.has(t));
    mcpTools.length = 0;
    for (const t of [...front, ...rest]) mcpTools.push(t);
  }

  return {
    primaryPath,
    mcpTools,
    fallbackPath: DATA_PATHS.LLM_RAG,
    rationale: rationaleLines.join('; '),
    signalOverrides,
  };
}

module.exports = {
  DATA_PATHS,
  MCP_TOOLS,
  VALID_ACTOR_ROLES,
  ROLE_TOOL_WHITELIST,
  FOCUS_AREA_TOOL_PRIORITY,
  resolveToolSet,
  isToolAllowed,
  getAllowedTools,
};
