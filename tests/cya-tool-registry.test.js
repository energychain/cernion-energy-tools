'use strict';

const {
  resolveToolSet,
  isToolAllowed,
  getAllowedTools,
  VALID_ACTOR_ROLES,
  MCP_TOOLS,
  DATA_PATHS,
} = require('../src/cya-tool-registry');

describe('cya-tool-registry — DATA_PATHS + MCP_TOOLS constants', () => {
  test('DATA_PATHS has expected keys', () => {
    expect(DATA_PATHS.MASTR_DETERMINISTIC).toBe('energy-market.installations');
    expect(DATA_PATHS.LLM_RAG).toBe('query.ask');
    expect(DATA_PATHS.MCP_DIRECT).toBe('mcp_direct');
  });

  test('MCP_TOOLS exposes INSTALLATIONS_LOCAL', () => {
    expect(MCP_TOOLS.INSTALLATIONS_LOCAL).toBeDefined();
  });

  test('MCP_TOOLS exposes SUBSTATION_FINDER', () => {
    expect(MCP_TOOLS.SUBSTATION_FINDER).toBeDefined();
  });

  test('VALID_ACTOR_ROLES includes all 9 roles', () => {
    const expected = [
      'grid_operator',
      'supplier',
      'project_developer',
      'direct_marketer',
      'metering_operator',
      'regulator',
      'municipality',
      'journalist',
      'citizen',
    ];
    for (const role of expected) {
      expect(VALID_ACTOR_ROLES).toContain(role);
    }
  });
});

describe('cya-tool-registry — resolveToolSet', () => {
  test('grid_operator + capacity focusArea → primaryPath is MCP_DIRECT', () => {
    const ts = resolveToolSet('grid_operator', ['grid_capacity'], null);
    expect(ts.primaryPath).toBe(DATA_PATHS.MCP_DIRECT);
  });

  test('grid_operator → includes INSTALLATIONS_LOCAL in mcpTools', () => {
    const ts = resolveToolSet('grid_operator', ['grid_capacity'], null);
    expect(ts.mcpTools).toContain(MCP_TOOLS.INSTALLATIONS_LOCAL);
  });

  test('fallbackPath is always LLM_RAG', () => {
    const ts = resolveToolSet('supplier', ['pricing'], null);
    expect(ts.fallbackPath).toBe(DATA_PATHS.LLM_RAG);
  });

  test('journalist → mcpTools does NOT include REDISPATCH', () => {
    const ts = resolveToolSet('journalist', ['grid_capacity'], null);
    expect(ts.mcpTools).not.toContain(MCP_TOOLS.REDISPATCH);
  });

  test('citizen → at most 1 mcpTool', () => {
    const ts = resolveToolSet('citizen', ['energy_production'], null);
    expect(ts.mcpTools.length).toBeLessThanOrEqual(1);
  });

  test('rationale is non-empty string', () => {
    const ts = resolveToolSet('regulator', ['compliance'], null);
    expect(typeof ts.rationale).toBe('string');
    expect(ts.rationale.length).toBeGreaterThan(0);
  });

  test('rationale contains actorRole', () => {
    const ts = resolveToolSet('municipality', ['grid_capacity'], null);
    expect(ts.rationale).toContain('municipality');
  });

  test('signalOverrides is an array', () => {
    const ts = resolveToolSet('grid_operator', [], null);
    expect(Array.isArray(ts.signalOverrides)).toBe(true);
  });

  test('empty focusAreas still returns valid toolSet', () => {
    const ts = resolveToolSet('supplier', [], null);
    expect(ts).toHaveProperty('mcpTools');
    expect(Array.isArray(ts.mcpTools)).toBe(true);
  });

  test('unknown focusArea → no crash, returns valid toolSet', () => {
    const ts = resolveToolSet('grid_operator', ['nonexistent_focus_area_xyz'], null);
    expect(ts).toHaveProperty('primaryPath');
  });

  test('VOLTAGE_HOP_REQUIRED signal → SUBSTATION_FINDER in signalOverrides', () => {
    const ts = resolveToolSet('grid_operator', [], ['VOLTAGE_HOP_REQUIRED']);
    const hasSubstation = ts.signalOverrides.some((o) => o.tool === MCP_TOOLS.SUBSTATION_FINDER);
    expect(hasSubstation).toBe(true);
  });

  test('MISSING_NAP signal → GRID_DATA in signalOverrides', () => {
    const ts = resolveToolSet('grid_operator', [], ['MISSING_NAP']);
    const hasGrid = ts.signalOverrides.some((o) => o.tool === MCP_TOOLS.GRID_DATA);
    expect(hasGrid).toBe(true);
  });

  test('HIGH_CURTAILMENT signal → REDISPATCH in signalOverrides', () => {
    const ts = resolveToolSet('grid_operator', [], ['HIGH_CURTAILMENT']);
    const hasRd = ts.signalOverrides.some((o) => o.tool === MCP_TOOLS.REDISPATCH);
    expect(hasRd).toBe(true);
  });

  test('GRID_TOPOLOGY_RADIAL signal → GRID_TOPOLOGY in signalOverrides', () => {
    const ts = resolveToolSet('grid_operator', [], ['GRID_TOPOLOGY_RADIAL']);
    const hasTopo = ts.signalOverrides.some((o) => o.tool === MCP_TOOLS.GRID_TOPOLOGY);
    expect(hasTopo).toBe(true);
  });

  test('journalist signal override blocked by whitelist — tool not in mcpTools', () => {
    const ts = resolveToolSet('journalist', [], ['HIGH_CURTAILMENT']);
    // REDISPATCH override exists in signalOverrides but should NOT be in mcpTools (not whitelisted)
    expect(ts.mcpTools).not.toContain(MCP_TOOLS.REDISPATCH);
  });

  test('unknown signal → silently ignored, no crash', () => {
    expect(() => resolveToolSet('grid_operator', [], ['UNKNOWN_SIGNAL_XYZ'])).not.toThrow();
  });

  test('null signals → signalOverrides is empty array', () => {
    const ts = resolveToolSet('grid_operator', [], null);
    expect(ts.signalOverrides).toEqual([]);
  });
});

describe('cya-tool-registry — error handling', () => {
  test('null actorRole throws INVALID_ACTOR_ROLE (400)', () => {
    expect(() => resolveToolSet(null, [], null)).toThrow(expect.objectContaining({ code: 400 }));
  });

  test('undefined actorRole throws INVALID_ACTOR_ROLE', () => {
    expect(() => resolveToolSet(undefined, [], null)).toThrow();
  });

  test('unknown actorRole throws UNKNOWN_ACTOR_ROLE (400)', () => {
    expect(() => resolveToolSet('alien_role', [], null)).toThrow(
      expect.objectContaining({ code: 400 })
    );
  });

  test('UNKNOWN_ACTOR_ROLE error type string', () => {
    let err;
    try {
      resolveToolSet('unknown_role_xyz', [], null);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.type || err.message).toMatch(/UNKNOWN_ACTOR_ROLE|unknown/i);
  });
});

describe('cya-tool-registry — isToolAllowed + getAllowedTools', () => {
  test('grid_operator is allowed INSTALLATIONS_LOCAL', () => {
    expect(isToolAllowed('grid_operator', MCP_TOOLS.INSTALLATIONS_LOCAL)).toBe(true);
  });

  test('citizen is not allowed REDISPATCH', () => {
    expect(isToolAllowed('citizen', MCP_TOOLS.REDISPATCH)).toBe(false);
  });

  test('regulator is allowed GRID_DATA', () => {
    expect(isToolAllowed('regulator', MCP_TOOLS.GRID_DATA)).toBe(true);
  });

  test('getAllowedTools returns array for grid_operator', () => {
    const tools = getAllowedTools('grid_operator');
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('getAllowedTools citizen returns fewer tools than grid_operator', () => {
    const citizen = getAllowedTools('citizen');
    const grid = getAllowedTools('grid_operator');
    expect(citizen.length).toBeLessThan(grid.length);
  });

  test('getAllowedTools unknown role throws', () => {
    expect(() => getAllowedTools('alien')).toThrow();
  });
});
