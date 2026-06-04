'use strict';

const {
  extractBlueprintPolicy,
  checkStickinessRetain,
  buildSynthesisPolicyDirectives,
  resolveActivePolicy,
} = require('../src/blueprint-policy-interpreter');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMunicipalBlueprint(overrides = {}) {
  return {
    id: 'municipal-energy-site-precheck-v1',
    routingPolicy: {
      sessionIntent: 'municipal_energy_site_precheck',
      priority: 90,
      stickiness: {
        retainForTurns: 6,
        unlessNegativeSignals: ['nap wallet', 'prosumer onboarding', 'mieterstrom'],
      },
      llmSelectable: true,
    },
    synthesisPolicy: {
      audience: 'municipal_official',
      responseFrame: 'meeting_preparation',
      leadWith: ['location_resolution', 'known_context', 'limitations'],
      deprioritize: ['tool_failure_as_main_answer'],
      mustMention: ['municipality_level_only', 'vnb_not_authoritative'],
      askFor: ['concrete_site_or_coordinates', 'connection_power_mw'],
    },
    ...overrides,
  };
}

// ─── 1. Policy extraction ─────────────────────────────────────────────────────

describe('extractBlueprintPolicy', () => {
  it('BPI-001: extracts routingPolicy and synthesisPolicy from matching blueprint', () => {
    const bp = makeMunicipalBlueprint();
    const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);

    expect(routingPolicy).not.toBeNull();
    expect(routingPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
    expect(routingPolicy.stickiness.retainForTurns).toBe(6);

    expect(synthesisPolicy).not.toBeNull();
    expect(synthesisPolicy.audience).toBe('municipal_official');
    expect(synthesisPolicy.deprioritize).toContain('tool_failure_as_main_answer');
  });

  it('BPI-002: returns null policies for blueprint without policy fields', () => {
    const bp = { id: 'simple-blueprint-v1' };
    const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);
    expect(routingPolicy).toBeNull();
    expect(synthesisPolicy).toBeNull();
  });

  it('BPI-003: handles null/undefined input gracefully', () => {
    expect(extractBlueprintPolicy(null)).toEqual({ routingPolicy: null, synthesisPolicy: null });
    expect(extractBlueprintPolicy(undefined)).toEqual({ routingPolicy: null, synthesisPolicy: null });
  });
});

// ─── 2. Stickiness: retain across follow-up turns ─────────────────────────────

describe('checkStickinessRetain', () => {
  const municipalPolicy = makeMunicipalBlueprint().routingPolicy;

  it('BPI-004: retains session intent within retainForTurns window', () => {
    const result = checkStickinessRetain(
      municipalPolicy,
      'Können wir das für eine Gesprächsvorbereitung mit dem Stadtrat nutzen?',
      2
    );
    expect(result.retain).toBe(true);
    expect(result.reason).toBe('stickiness_active');
  });

  it('BPI-005: stickiness expires when turnsElapsed >= retainForTurns', () => {
    const result = checkStickinessRetain(
      municipalPolicy,
      'Welche Flächen kommen für BESS infrage?',
      6
    );
    expect(result.retain).toBe(false);
    expect(result.reason).toBe('stickiness_expired');
  });

  it('BPI-006: returns no_policy for null sessionPolicy', () => {
    const result = checkStickinessRetain(null, 'Was kostet das?', 1);
    expect(result.retain).toBe(false);
    expect(result.reason).toBe('no_policy');
  });

  it('BPI-007: returns no_stickiness for policy without stickiness block', () => {
    const policyWithoutStickiness = { sessionIntent: 'some_intent', priority: 50 };
    const result = checkStickinessRetain(policyWithoutStickiness, 'Frage', 0);
    expect(result.retain).toBe(false);
    expect(result.reason).toBe('no_stickiness');
  });
});

// ─── 3. Negative signals break stickiness ─────────────────────────────────────

describe('checkStickinessRetain — negative signals', () => {
  const municipalPolicy = makeMunicipalBlueprint().routingPolicy;

  it('BPI-008: "nap wallet" breaks stickiness', () => {
    const result = checkStickinessRetain(
      municipalPolicy,
      'Was muss ich für meine NAP Wallet DID eingeben?',
      1
    );
    expect(result.retain).toBe(false);
    expect(result.reason).toMatch(/negative_signal/);
  });

  it('BPI-009: "prosumer onboarding" breaks stickiness', () => {
    const result = checkStickinessRetain(
      municipalPolicy,
      'Ich möchte prosumer onboarding starten',
      2
    );
    expect(result.retain).toBe(false);
    expect(result.reason).toMatch(/negative_signal/);
  });

  it('BPI-010: unrelated follow-up without negative signal retains stickiness', () => {
    const result = checkStickinessRetain(
      municipalPolicy,
      'Welche Anschlussleistung wäre für ein Rechenzentrum realistisch?',
      3
    );
    expect(result.retain).toBe(true);
  });
});

// ─── 4. Synthesis policy directives ──────────────────────────────────────────

describe('buildSynthesisPolicyDirectives', () => {
  const { synthesisPolicy, routingPolicy } = extractBlueprintPolicy(makeMunicipalBlueprint());

  it('BPI-011: tool_failure_as_main_answer generates evidence-gap directive', () => {
    const directives = buildSynthesisPolicyDirectives(synthesisPolicy, null);
    const joined = directives.join('\n');
    expect(joined).toMatch(/Evidenzlücken/);
    expect(joined).toMatch(/nicht.*Hauptantwort|nie.*Hauptantwort/);
    // Internal policy key must NOT appear in the directive text
    expect(joined).not.toContain('tool_failure_as_main_answer');
  });

  it('BPI-012: stickiness note is injected from routingPolicy when present', () => {
    const directives = buildSynthesisPolicyDirectives(synthesisPolicy, routingPolicy);
    const joined = directives.join('\n');
    expect(joined).toMatch(/Sitzungsthema/);
    expect(joined).toContain('municipal_energy_site_precheck');
  });

  it('BPI-013: returns empty array for null synthesisPolicy and null routingPolicy', () => {
    expect(buildSynthesisPolicyDirectives(null, null)).toEqual([]);
    expect(buildSynthesisPolicyDirectives(undefined, undefined)).toEqual([]);
  });

  it('BPI-014: deprioritize without tool_failure does not add evidence-gap directive', () => {
    const sp = { deprioritize: ['something_else'] };
    const directives = buildSynthesisPolicyDirectives(sp, null);
    const joined = directives.join('\n');
    expect(joined).not.toMatch(/Evidenzlücken/);
  });

  it('BPI-014b: table-first numeric policies add format and source directives', () => {
    const sp = {
      numericFirst: true,
      outputFormat: 'markdown_table_first',
      tableColumns: ['Kennzahl', 'Wert', 'Quelle'],
      sourceCitationPolicy: 'Jede konkrete Zahl braucht eine sichtbare Quelle.',
    };
    const directives = buildSynthesisPolicyDirectives(sp, null);
    const joined = directives.join('\n');

    expect(joined).toMatch(/Zahlen zuerst/);
    expect(joined).toMatch(/Markdown-Tabelle/);
    expect(joined).toContain('Kennzahl | Wert | Quelle');
    expect(joined).toMatch(/Quellenregel/);
  });
});

// ─── 5. Regression: no NAP-Wallet-DID ask in municipal follow-up ──────────────

describe('Regression: municipal precheck follow-up does not ask for NAP-Wallet-DID', () => {
  it('BPI-015: "Gesprächsvorbereitung" follow-up retains municipal intent when stickiness is active', () => {
    const municipalPolicy = makeMunicipalBlueprint().routingPolicy;

    // Simulate: turn 1 activated the policy, now it's turn 2 (turnsElapsed = 1)
    const result = checkStickinessRetain(
      municipalPolicy,
      'Können Sie das als Gesprächsvorbereitung aufbereiten?',
      1
    );
    expect(result.retain).toBe(true);
    expect(result.reason).toBe('stickiness_active');
  });

  it('BPI-016: synthesis directives do not include NAP-Wallet references for municipal blueprint', () => {
    const { synthesisPolicy, routingPolicy } = extractBlueprintPolicy(makeMunicipalBlueprint());
    const directives = buildSynthesisPolicyDirectives(synthesisPolicy, routingPolicy);
    const joined = directives.join('\n').toLowerCase();
    expect(joined).not.toMatch(/nap.?wallet|did|wallet/);
  });
});

// ─── 6. resolveActivePolicy ───────────────────────────────────────────────────

describe('resolveActivePolicy', () => {
  const bp = makeMunicipalBlueprint();

  it('BPI-017: prefers freshly matched blueprint over session policy', () => {
    const session = {
      l3: {
        activeRoutingPolicy: { sessionIntent: 'old_intent', stickiness: { retainForTurns: 3 } },
        activeSynthesisPolicy: { audience: 'technical' },
      },
    };
    const { routingPolicy, synthesisPolicy } = resolveActivePolicy(bp, session);
    expect(routingPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
    expect(synthesisPolicy.audience).toBe('municipal_official');
  });

  it('BPI-018: falls back to session policy when no blueprint matched', () => {
    const sessionPolicy = {
      sessionIntent: 'bess_screening',
      stickiness: { retainForTurns: 4 },
    };
    const session = {
      l3: {
        activeRoutingPolicy: sessionPolicy,
        activeSynthesisPolicy: { audience: 'technical' },
      },
    };
    const { routingPolicy, synthesisPolicy } = resolveActivePolicy(null, session);
    expect(routingPolicy.sessionIntent).toBe('bess_screening');
    expect(synthesisPolicy.audience).toBe('technical');
  });

  it('BPI-019: returns null policies when no blueprint and no session policy', () => {
    const result = resolveActivePolicy(null, {});
    expect(result.routingPolicy).toBeNull();
    expect(result.synthesisPolicy).toBeNull();
  });
});
