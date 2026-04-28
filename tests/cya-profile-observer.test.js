'use strict';

const {
  extractImplicitSignals,
  mergeImplicitIntoProfile,
  mergeExplicitIntoProfile,
  deriveToolHints,
  _parseToolsFromRationale,
  _normaliseFrequency,
  PREFERRED_TOOL_MIN_USAGE,
} = require('../src/cya-profile-observer');

// ── Fixtures ──────────────────────────────────────────────────────────────

const minimalSession = {
  context: { focus_areas: ['capacity'], location: 'Höheinöd', trigger: null },
  regulatory_graph: {
    graphBased: true,
    signals: [{ ruleId: 'HIGH_RENEWABLE_SHARE', severity: 'info' }],
  },
  grounding: {
    confidence: 'high',
    toolSetRationale: 'actorRole=grid_operator; focusAreas=[capacity]',
    signalOverrides: [],
  },
  retrieval: { toolSetRationale: null, signalOverrides: [] },
  history: [],
  narrative: { title: 'Höheinöd Analyse', headline: 'Starker Ausbau erneuerbar' },
};

const sessionWithRefinement = {
  ...minimalSession,
  history: [{ timestamp: '2026-04-28T10:01:00.000Z', user_feedback: 'Bitte mehr Detail' }],
};

const sessionWithSignalOverrides = {
  context: { focus_areas: ['grid_expansion', 'redispatch'] },
  regulatory_graph: {
    signals: [{ ruleId: 'VOLTAGE_HOP_REQUIRED', severity: 'warning' }],
  },
  grounding: {
    confidence: 'medium',
    toolSetRationale: 'actorRole=grid_operator; focusAreas=[grid_expansion]',
    signalOverrides: [
      { ruleId: 'VOLTAGE_HOP_REQUIRED', tool: 'osm_substation_finder', injectedTool: 'osm_substation_finder', reason: 'VOLTAGE_HOP_REQUIRED → SUBSTATION_FINDER forced' },
    ],
  },
  retrieval: { toolSetRationale: null, signalOverrides: [] },
  history: [],
  narrative: null,
};

const emptyProfile = {
  actor: { role: 'grid_operator', organization: 'Stadtwerke Test' },
  strategic_goals: ['Investition optimieren'],
  tone: 'sachlich',
  createdAt: '2026-04-01T00:00:00.000Z',
};

const profileWithExplicit = {
  ...emptyProfile,
  explicitPreferences: { reportFormat: 'pdf' },
  constraints: [{ topic: 'Dunkelflaute', rule: 'Keine Spekulation', setAt: '2026-04-10T00:00:00.000Z' }],
};

// ── extractImplicitSignals ────────────────────────────────────────────────

describe('extractImplicitSignals', () => {
  test('focusAreas korrekt extrahiert', () => {
    const s = extractImplicitSignals(minimalSession);
    expect(s.focusAreas).toEqual(['capacity']);
  });

  test('signalsSeen aus regulatory_graph.signals', () => {
    const s = extractImplicitSignals(minimalSession);
    expect(s.signalsSeen).toContain('HIGH_RENEWABLE_SHARE');
  });

  test('signalsSeen aus sessionWithSignalOverrides', () => {
    const s = extractImplicitSignals(sessionWithSignalOverrides);
    expect(s.signalsSeen).toContain('VOLTAGE_HOP_REQUIRED');
  });

  test('toolsUsed enthält Tool aus signalOverrides', () => {
    const s = extractImplicitSignals(sessionWithSignalOverrides);
    expect(s.toolsUsed).toContain('osm_substation_finder');
  });

  test('toolsUsed aus toolSetRationale parsed', () => {
    const session = {
      ...minimalSession,
      grounding: {
        confidence: 'high',
        toolSetRationale: 'actorRole=grid_operator; cernion_grid_data used',
        signalOverrides: [],
      },
      retrieval: { toolSetRationale: null, signalOverrides: [] },
    };
    const s = extractImplicitSignals(session);
    expect(s.toolsUsed).toContain('cernion_grid_data');
  });

  test('confidence aus grounding.confidence', () => {
    const s = extractImplicitSignals(minimalSession);
    expect(s.confidence).toBe('high');
  });

  test('confidence null wenn grounding fehlt', () => {
    const s = extractImplicitSignals({ context: { focus_areas: [] } });
    expect(s.confidence).toBeNull();
  });

  test('hadRefinement: false ohne history', () => {
    const s = extractImplicitSignals(minimalSession);
    expect(s.hadRefinement).toBe(false);
  });

  test('hadRefinement: true wenn history.length > 0', () => {
    const s = extractImplicitSignals(sessionWithRefinement);
    expect(s.hadRefinement).toBe(true);
  });

  test('leere Session wirft keinen Fehler (graceful)', () => {
    expect(() => extractImplicitSignals(null)).not.toThrow();
    expect(() => extractImplicitSignals({})).not.toThrow();
    expect(() => extractImplicitSignals(undefined)).not.toThrow();
  });

  test('mehrere focusAreas korrekt extrahiert', () => {
    const s = extractImplicitSignals(sessionWithSignalOverrides);
    expect(s.focusAreas).toEqual(['grid_expansion', 'redispatch']);
  });
});

// ── mergeImplicitIntoProfile ───────────────────────────────────────────────

describe('mergeImplicitIntoProfile', () => {
  test('sessionCount steigt von 0 auf 1', () => {
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(emptyProfile, signals);
    expect(updated.implicitStats.sessionCount).toBe(1);
  });

  test('sessionCount steigt von 1 auf 2 (zweite Session)', () => {
    const signals = extractImplicitSignals(minimalSession);
    const after1 = mergeImplicitIntoProfile(emptyProfile, signals);
    const after2 = mergeImplicitIntoProfile(after1, signals);
    expect(after2.implicitStats.sessionCount).toBe(2);
  });

  test('focusAreaFrequency: capacity nach 1 Session = 1', () => {
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(emptyProfile, signals);
    expect(updated.implicitStats.focusAreaFrequency.capacity).toBe(1);
  });

  test('focusAreaFrequency: capacity nach 2 Sessions = 2', () => {
    const signals = extractImplicitSignals(minimalSession);
    const after1 = mergeImplicitIntoProfile(emptyProfile, signals);
    const after2 = mergeImplicitIntoProfile(after1, signals);
    expect(after2.implicitStats.focusAreaFrequency.capacity).toBe(2);
  });

  test('focusAreaWeights normalisiert: höchste Frequenz = 1.0', () => {
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(emptyProfile, signals);
    const maxWeight = Math.max(...Object.values(updated.preferences.focusAreaWeights));
    expect(maxWeight).toBe(1.0);
  });

  test('signalReactions.seen steigt bei erneutem Signal', () => {
    const signals = extractImplicitSignals(minimalSession);
    const after1 = mergeImplicitIntoProfile(emptyProfile, signals);
    const after2 = mergeImplicitIntoProfile(after1, signals);
    expect(after2.implicitStats.signalReactions.HIGH_RENEWABLE_SHARE.seen).toBe(2);
  });

  test('toolUsage wird befüllt wenn toolsUsed vorhanden', () => {
    const signals = extractImplicitSignals(sessionWithSignalOverrides);
    const updated = mergeImplicitIntoProfile(emptyProfile, signals);
    expect(updated.implicitStats.toolUsage['osm_substation_finder']).toBeGreaterThanOrEqual(1);
  });

  test('preferredTools: Tool mit usage > threshold erscheint', () => {
    // Need usage > PREFERRED_TOOL_MIN_USAGE sessions with same tool
    let profile = emptyProfile;
    const signals = extractImplicitSignals(sessionWithSignalOverrides);
    for (let i = 0; i <= PREFERRED_TOOL_MIN_USAGE; i++) {
      profile = mergeImplicitIntoProfile(profile, signals);
    }
    expect(profile.preferences.preferredTools).toContain('osm_substation_finder');
  });

  test('explicitPreferences werden NICHT überschrieben', () => {
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(profileWithExplicit, signals);
    expect(updated.explicitPreferences.reportFormat).toBe('pdf');
  });

  test('constraints werden NICHT verändert', () => {
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(profileWithExplicit, signals);
    expect(updated.constraints[0].topic).toBe('Dunkelflaute');
  });

  test('profileVersion steigt um 1', () => {
    const base = { ...emptyProfile, profileVersion: 3 };
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(base, signals);
    expect(updated.profileVersion).toBe(4);
  });

  test('updatedAt wird gesetzt', () => {
    const signals = extractImplicitSignals(minimalSession);
    const updated = mergeImplicitIntoProfile(emptyProfile, signals);
    expect(updated.updatedAt).toBeDefined();
    expect(typeof updated.updatedAt).toBe('string');
  });

  test('existingProfile wird nicht mutiert', () => {
    const original = JSON.parse(JSON.stringify(emptyProfile));
    const signals = extractImplicitSignals(minimalSession);
    mergeImplicitIntoProfile(emptyProfile, signals);
    expect(emptyProfile).toEqual(original);
  });
});

// ── mergeExplicitIntoProfile ───────────────────────────────────────────────

describe('mergeExplicitIntoProfile', () => {
  test('constraints werden gesetzt', () => {
    const updated = mergeExplicitIntoProfile(emptyProfile, {
      constraints: [{ topic: 'Kosten', rule: 'Max 50k EUR CAPEX' }],
    });
    expect(updated.constraints).toHaveLength(1);
    expect(updated.constraints[0].topic).toBe('Kosten');
    expect(updated.constraints[0].setAt).toBeDefined();
  });

  test('explicitPreferences werden gesetzt', () => {
    const updated = mergeExplicitIntoProfile(emptyProfile, {
      explicitPreferences: { darkMode: true },
    });
    expect(updated.explicitPreferences.darkMode).toBe(true);
  });

  test('explicitPreferences werden gemergt (bestehende bleiben erhalten)', () => {
    const updated = mergeExplicitIntoProfile(profileWithExplicit, {
      explicitPreferences: { language: 'de' },
    });
    expect(updated.explicitPreferences.reportFormat).toBe('pdf');
    expect(updated.explicitPreferences.language).toBe('de');
  });

  test('tone wird überschrieben', () => {
    const updated = mergeExplicitIntoProfile(emptyProfile, { tone: 'direkt und klar' });
    expect(updated.tone).toBe('direkt und klar');
  });

  test('strategic_goals wird überschrieben', () => {
    const updated = mergeExplicitIntoProfile(emptyProfile, {
      strategic_goals: ['Kostensenkung', 'Compliance'],
    });
    expect(updated.strategic_goals).toEqual(['Kostensenkung', 'Compliance']);
  });

  test('implicitStats.sessionCount bleibt unverändert', () => {
    const signals = extractImplicitSignals(minimalSession);
    const afterImplicit = mergeImplicitIntoProfile(emptyProfile, signals);
    const afterExplicit = mergeExplicitIntoProfile(afterImplicit, { tone: 'neutral' });
    expect(afterExplicit.implicitStats.sessionCount).toBe(afterImplicit.implicitStats.sessionCount);
  });

  test('profileVersion steigt um 1', () => {
    const base = { ...emptyProfile, profileVersion: 5 };
    const updated = mergeExplicitIntoProfile(base, { tone: 'test' });
    expect(updated.profileVersion).toBe(6);
  });

  test('updatedAt wird gesetzt', () => {
    const updated = mergeExplicitIntoProfile(emptyProfile, {});
    expect(typeof updated.updatedAt).toBe('string');
  });

  test('unerlaubtes Feld implicitStats in explicitUpdate wird ignoriert', () => {
    const hacked = mergeExplicitIntoProfile(emptyProfile, {
      implicitStats: { sessionCount: 999 },
      tone: 'ok',
    });
    // implicitStats should not be set from explicit update
    expect(hacked.implicitStats?.sessionCount).not.toBe(999);
  });

  test('leeres explicitUpdate ist valide (no-op außer Version + updatedAt)', () => {
    const base = { ...emptyProfile, profileVersion: 2 };
    const updated = mergeExplicitIntoProfile(base, {});
    expect(updated.profileVersion).toBe(3);
    expect(updated.tone).toBe(base.tone);
  });

  test('priorityFocusAreas wird gesetzt', () => {
    const updated = mergeExplicitIntoProfile(emptyProfile, {
      priorityFocusAreas: ['redispatch', 'capacity'],
    });
    expect(updated.priorityFocusAreas).toEqual(['redispatch', 'capacity']);
  });
});

// ── deriveToolHints ────────────────────────────────────────────────────────

describe('deriveToolHints', () => {
  test('boostedFocusAreas enthält Areas mit weight > 0.6', () => {
    const profile = {
      preferences: {
        focusAreaWeights: { capacity: 1.0, redispatch: 0.5, renewables: 0.8 },
        signalSensitivity: {},
        preferredTools: [],
      },
    };
    const hints = deriveToolHints(profile);
    expect(hints.boostedFocusAreas).toContain('capacity');
    expect(hints.boostedFocusAreas).toContain('renewables');
    expect(hints.boostedFocusAreas).not.toContain('redispatch');
  });

  test('preferredTools korrekt übernommen', () => {
    const profile = {
      preferences: {
        focusAreaWeights: {},
        signalSensitivity: {},
        preferredTools: ['cernion_grid_data', 'osm_grid_topology'],
      },
    };
    const hints = deriveToolHints(profile);
    expect(hints.preferredTools).toEqual(['cernion_grid_data', 'osm_grid_topology']);
  });

  test('avoidSignals aus signalSensitivity=low', () => {
    const profile = {
      preferences: {
        focusAreaWeights: {},
        signalSensitivity: { VOLTAGE_HOP_REQUIRED: 'low', HIGH_CURTAILMENT: 'high' },
        preferredTools: [],
      },
    };
    const hints = deriveToolHints(profile);
    expect(hints.avoidSignals).toContain('VOLTAGE_HOP_REQUIRED');
    expect(hints.avoidSignals).not.toContain('HIGH_CURTAILMENT');
  });

  test('leeres Profil gibt leere Hints zurück', () => {
    const hints = deriveToolHints({});
    expect(hints.boostedFocusAreas).toEqual([]);
    expect(hints.preferredTools).toEqual([]);
    expect(hints.avoidSignals).toEqual([]);
  });

  test('null Profil gibt leere Hints zurück ohne Fehler', () => {
    expect(() => deriveToolHints(null)).not.toThrow();
    const hints = deriveToolHints(null);
    expect(hints.boostedFocusAreas).toEqual([]);
  });
});

// ── _parseToolsFromRationale helper ───────────────────────────────────────

describe('_parseToolsFromRationale', () => {
  test('extrahiert cernion_grid_data aus Rationale', () => {
    const tools = _parseToolsFromRationale('actorRole=grid_operator; cernion_grid_data selected');
    expect(tools).toContain('cernion_grid_data');
  });

  test('null gibt leeres Array zurück', () => {
    expect(_parseToolsFromRationale(null)).toEqual([]);
  });
});

// ── _normaliseFrequency helper ─────────────────────────────────────────────

describe('_normaliseFrequency', () => {
  test('normalisiert korrekt', () => {
    const norm = _normaliseFrequency({ a: 4, b: 2, c: 1 });
    expect(norm.a).toBe(1.0);
    expect(norm.b).toBe(0.5);
  });

  test('leeres Objekt gibt leeres Objekt zurück', () => {
    expect(_normaliseFrequency({})).toEqual({});
  });
});
