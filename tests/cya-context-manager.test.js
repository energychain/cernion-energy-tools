'use strict';

const { CyaContextManager } = require('../src/cya-context-manager');
const { buildOntologyGraph } = require('../src/cya-ontology-graph');

// ── Fixture ───────────────────────────────────────────────────────────────

function makeInstallation(mastrNummer, opts) {
  return {
    EinheitMastrNummer: mastrNummer,
    EinheitName: opts.name || `Anlage ${mastrNummer}`,
    Bruttoleistung: opts.leistungKw || 10,
    Technologie: 'Solarenergie',
    InbetriebnahmeDatum: '2020-01-01',
    EinheitBetriebsstatus: 'InBetrieb',
    Postleitzahl: '67752',
    Gemeinde: 'Höheinöd',
    Laengengrad: 7.63,
    Breitengrad: 49.47,
    NetzbetreiberMastrNummer: 'SNB_PFALZ_001',
    Netzbetreiber: 'Pfalzwerke Netz AG',
    NetzanschlusspunktMastrNummer: opts.napId !== undefined ? opts.napId : 'NAP_TEST_001',
  };
}

const installations = [
  makeInstallation('SEE999952467552', { name: 'PV Höheinöd 1' }),
  makeInstallation('SEE976608984557', { name: 'PV Höheinöd 2' }),
  makeInstallation('SEE982890040772', { name: 'PV Höheinöd 3' }),
];

function makeManager(maxIterations) {
  const graph = buildOntologyGraph(installations, null);
  return new CyaContextManager(graph, maxIterations);
}

const INST_ID = 'INSTALLATION:SEE999952467552';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('CyaContextManager.setOuterContext', () => {
  it('stores goal correctly', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('Netzausbauplanung Höheinöd', ['renewables', 'grid_expansion']);
    const log = mgr.getIterationLog();
    expect(log.length).toBe(1);
    expect(log[0].operation).toBe('set_outer_context');
    expect(log[0].meta.goal).toBe('Netzausbauplanung Höheinöd');
  });

  it('accepts single string focusArea', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('Goal X', 'redispatch');
    const log = mgr.getIterationLog();
    expect(log[0].meta.focusArea).toBe('redispatch');
  });
});

describe('CyaContextManager.zoomIn', () => {
  it('returns subgraph with radius=1', () => {
    const mgr = makeManager(3);
    const sub = mgr.zoomIn(INST_ID, 1);
    expect(sub).toBeDefined();
    expect(sub.hasNode(INST_ID)).toBe(true);
    expect(sub.order).toBeGreaterThanOrEqual(2); // center + at least NAP
  });

  it('increments zoom counter', () => {
    const mgr = makeManager(3);
    mgr.zoomIn(INST_ID, 1);
    mgr.zoomIn(INST_ID, 1);
    expect(mgr.getIterationLog().filter(e => e.operation === 'zoom_in').length).toBe(2);
  });

  it('throws CONTEXT_MAX_ITERATIONS when maxIterations exceeded', () => {
    const mgr = makeManager(3);
    mgr.zoomIn(INST_ID, 1);
    mgr.zoomIn(INST_ID, 1);
    mgr.zoomIn(INST_ID, 1);
    expect(() => mgr.zoomIn(INST_ID, 1)).toThrow('CONTEXT_MAX_ITERATIONS');
  });

  it('thrown error has type CONTEXT_MAX_ITERATIONS', () => {
    const mgr = makeManager(3);
    for (let i = 0; i < 3; i++) mgr.zoomIn(INST_ID, 1);
    let err;
    try { mgr.zoomIn(INST_ID, 1); } catch (e) { err = e; }
    expect(err.type).toBe('CONTEXT_MAX_ITERATIONS');
  });
});

describe('CyaContextManager.zoomOut', () => {
  it('pops zoom stack after zoomIn', () => {
    const mgr = makeManager(3);
    mgr.zoomIn(INST_ID, 1);
    mgr.zoomOut();
    const log = mgr.getIterationLog().filter(e => e.operation === 'zoom_out');
    expect(log.length).toBe(1);
  });

  it('is a no-op when already at outer context', () => {
    const mgr = makeManager(3);
    expect(() => mgr.zoomOut()).not.toThrow();
  });

  it('restores ability to zoomIn after zoomOut (counter not decremented)', () => {
    // zoomCounter is intentionally NOT decremented on zoomOut
    // (prevents infinite zoom-out→zoom-in loops while respecting maxIterations)
    const mgr = makeManager(2);
    mgr.zoomIn(INST_ID, 1);
    mgr.zoomOut();
    mgr.zoomIn(INST_ID, 1);
    expect(() => mgr.zoomIn(INST_ID, 1)).toThrow('CONTEXT_MAX_ITERATIONS');
  });
});

describe('CyaContextManager.needsRetrieval', () => {
  it('returns false for installation that has NAP edge', () => {
    const mgr = makeManager(3);
    expect(mgr.needsRetrieval(INST_ID)).toBe(false);
  });

  it('returns true for installation without NAP edge', () => {
    const withoutNap = [makeInstallation('SEE999952467552', {})];
    withoutNap[0].NetzanschlusspunktMastrNummer = undefined;
    const graph = buildOntologyGraph(withoutNap, null);
    const mgr = new CyaContextManager(graph, 3);
    expect(mgr.needsRetrieval(INST_ID)).toBe(true);
  });

  it('returns true for unknown nodeId', () => {
    const mgr = makeManager(3);
    expect(mgr.needsRetrieval('INSTALLATION:NONEXISTENT')).toBe(true);
  });

  it('returns false for non-INSTALLATION node (NAP does not need retrieval)', () => {
    const mgr = makeManager(3);
    expect(mgr.needsRetrieval('NAP:NAP_TEST_001')).toBe(false);
  });
});

describe('CyaContextManager.getFocusedContext', () => {
  it('returns nodes, edges and breadcrumb', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('Test Goal', 'renewables');
    const ctx = mgr.getFocusedContext(INST_ID);
    expect(Array.isArray(ctx.nodes)).toBe(true);
    expect(Array.isArray(ctx.edges)).toBe(true);
    expect(Array.isArray(ctx.breadcrumb)).toBe(true);
  });

  it('breadcrumb has at least 1 entry', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('Netzanalyse', 'grid_expansion');
    const ctx = mgr.getFocusedContext(INST_ID);
    expect(ctx.breadcrumb.length).toBeGreaterThanOrEqual(1);
  });

  it('breadcrumb includes goal when set', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('Wichtiges Ziel', 'redispatch');
    const ctx = mgr.getFocusedContext(INST_ID);
    expect(ctx.breadcrumb[0]).toContain('Wichtiges Ziel');
  });

  it('breadcrumb includes Fokus entry after zoomIn', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('Ziel', 'renewables');
    mgr.zoomIn(INST_ID, 1);
    const { breadcrumb } = mgr.getFocusedContext(INST_ID);
    expect(breadcrumb.some(c => c.startsWith('Fokus:'))).toBe(true);
  });
});

describe('CyaContextManager.getIterationLog', () => {
  it('2 zoomIn operations = 2 zoom_in log entries', () => {
    const mgr = makeManager(3);
    mgr.zoomIn(INST_ID, 1);
    mgr.zoomIn(INST_ID, 2);
    const log = mgr.getIterationLog().filter(e => e.operation === 'zoom_in');
    expect(log.length).toBe(2);
  });

  it('all log entries have timestamp', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('G', 'renewables');
    mgr.zoomIn(INST_ID, 1);
    for (const entry of mgr.getIterationLog()) {
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('returns a copy (mutation does not affect internal log)', () => {
    const mgr = makeManager(3);
    mgr.setOuterContext('G', 'renewables');
    const log = mgr.getIterationLog();
    log.push({ fake: true });
    expect(mgr.getIterationLog().length).toBe(1);
  });
});
