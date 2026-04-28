'use strict';

const {
  buildOntologyGraph,
  queryNodes,
  findPath,
  getNeighbors,
  getSubgraph,
  deriveSignals,
  NODE_TYPE,
  EDGE_TYPE,
} = require('../src/cya-ontology-graph');

// ── Fixtures (Höheinöd PV installations) ─────────────────────────────────

const PFALZWERKE_VNB = 'Pfalzwerke Netz AG';
const NAP_ID = 'NAP_TEST_001';

function makeInstallation(mastrNummer, opts) {
  return {
    EinheitMastrNummer: mastrNummer,
    EinheitName: opts.name || `Anlage ${mastrNummer}`,
    Bruttoleistung: opts.leistungKw || 10,
    Technologie: opts.tech || 'Solarenergie',
    InbetriebnahmeDatum: '2020-01-01',
    EinheitBetriebsstatus: 'InBetrieb',
    Postleitzahl: '67752',
    Gemeinde: 'Höheinöd',
    Laengengrad: 7.63,
    Breitengrad: 49.47,
    NetzbetreiberMastrNummer: 'SNB_PFALZ_001',
    Netzbetreiber: PFALZWERKE_VNB,
    NetzanschlusspunktMastrNummer: opts.napId !== undefined ? opts.napId : NAP_ID,
    ...opts.extra,
  };
}

const installations = [
  makeInstallation('SEE999952467552', { name: 'PV Höheinöd 1', leistungKw: 9.9 }),
  makeInstallation('SEE976608984557', { name: 'PV Höheinöd 2', leistungKw: 14.4 }),
  makeInstallation('SEE982890040772', { name: 'PV Höheinöd 3', leistungKw: 7.56 }),
];

// ── Helpers ───────────────────────────────────────────────────────────────

function buildTestGraph(overrideInstallations, topologyHop) {
  return buildOntologyGraph(
    overrideInstallations || installations,
    topologyHop || null
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('buildOntologyGraph', () => {
  it('creates correct node count (3 installations + 1 NAP + 1 VNB + 1 REGION = 6)', () => {
    const graph = buildTestGraph();
    // 3 INSTALLATION + 1 NAP (shared) + 1 VNB + 1 REGION
    expect(graph.order).toBe(6);
  });

  it('creates INSTALLATION→NAP edge (VERBUNDEN_MIT)', () => {
    const graph = buildTestGraph();
    const instId = 'INSTALLATION:SEE999952467552';
    const napId = `NAP:${NAP_ID}`;
    expect(graph.hasEdge(instId, napId)).toBe(true);
    const edge = graph.edges(instId, napId)[0];
    expect(graph.getEdgeAttributes(edge).edgeType).toBe(EDGE_TYPE.VERBUNDEN_MIT);
  });

  it('creates INSTALLATION→REGION edge (LIEGT_IN)', () => {
    const graph = buildTestGraph();
    const instId = 'INSTALLATION:SEE999952467552';
    const regionId = 'REGION:67752';
    expect(graph.hasEdge(instId, regionId)).toBe(true);
  });

  it('creates VNB→REGION edge (ZUSTAENDIG_FUER)', () => {
    const graph = buildTestGraph();
    expect(graph.hasEdge('VNB:SNB_PFALZ_001', 'REGION:67752')).toBe(true);
  });

  it('adds SUBSTATION node when topologyHop.needsHop=true', () => {
    const hop = {
      needsHop: true,
      voltageClass: 'HS',
      physicalConnectionPoint: { name: 'UW Kaiserslautern', lat: 49.45, lon: 7.75, distance_km: 12 },
      inferredOperator: 'Pfalzwerke Netz AG',
    };
    const graph = buildTestGraph(null, hop);
    const substationNodes = queryNodes(graph, NODE_TYPE.SUBSTATION);
    expect(substationNodes.length).toBe(1);
    expect(substationNodes[0].attrs.name).toBe('UW Kaiserslautern');
  });

  it('gracefully handles installations without NAP (no crash)', () => {
    const withoutNap = [makeInstallation('SEE999952467552', { napId: null })];
    withoutNap[0].NetzanschlusspunktMastrNummer = undefined;
    const graph = buildOntologyGraph(withoutNap, null);
    expect(graph.order).toBeGreaterThanOrEqual(1);
  });
});

describe('queryNodes', () => {
  it('returns only INSTALLATION nodes', () => {
    const graph = buildTestGraph();
    const result = queryNodes(graph, NODE_TYPE.INSTALLATION);
    expect(result.length).toBe(3);
    expect(result.every(n => n.attrs.nodeType === NODE_TYPE.INSTALLATION)).toBe(true);
  });

  it('filters by custom filterFn', () => {
    const graph = buildTestGraph();
    const result = queryNodes(graph, NODE_TYPE.INSTALLATION, a => a.leistungKw > 10);
    expect(result.length).toBe(1);
    expect(result[0].attrs.mastrNummer).toBe('SEE976608984557');
  });

  it('returns empty array for unknown nodeType', () => {
    const graph = buildTestGraph();
    expect(queryNodes(graph, 'UNKNOWN_TYPE')).toEqual([]);
  });
});

describe('getSubgraph', () => {
  it('radius=1 returns center + direct neighbors', () => {
    const graph = buildTestGraph();
    const instId = 'INSTALLATION:SEE999952467552';
    const sub = getSubgraph(graph, instId, 1);
    expect(sub.hasNode(instId)).toBe(true);
    // Direct neighbors: NAP, REGION
    expect(sub.order).toBeGreaterThanOrEqual(2);
  });

  it('radius=2 includes second-hop nodes (VNB via REGION)', () => {
    const graph = buildTestGraph();
    const instId = 'INSTALLATION:SEE999952467552';
    const sub = getSubgraph(graph, instId, 2);
    // Should include INSTALLATION, NAP, REGION, and VNB
    expect(sub.order).toBeGreaterThanOrEqual(3);
  });

  it('returns empty graph for unknown nodeId', () => {
    const graph = buildTestGraph();
    const sub = getSubgraph(graph, 'INSTALLATION:UNKNOWN_999', 2);
    expect(sub.order).toBe(0);
  });
});

describe('findPath', () => {
  it('finds path from INSTALLATION to NAP', () => {
    const graph = buildTestGraph();
    const path = findPath(graph, 'INSTALLATION:SEE999952467552', `NAP:${NAP_ID}`);
    expect(path.length).toBe(2);
    expect(path[0].id).toBe('INSTALLATION:SEE999952467552');
    expect(path[path.length - 1].id).toBe(`NAP:${NAP_ID}`);
  });

  it('finds path from INSTALLATION to SUBSTATION via NAP (with hop)', () => {
    const hop = {
      needsHop: true,
      voltageClass: 'HS',
      physicalConnectionPoint: { name: 'UW-Test', lat: 49.4, lon: 7.7, distance_km: 5 },
    };
    const graph = buildTestGraph(null, hop);
    const instId = 'INSTALLATION:SEE999952467552';
    const subId = 'SUBSTATION:UW-Test';
    const path = findPath(graph, instId, subId);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[path.length - 1].id).toBe(subId);
  });

  it('returns empty array when no path exists', () => {
    const graph = buildTestGraph();
    expect(findPath(graph, 'INSTALLATION:SEE999952467552', 'INSTALLATION:NONEXISTENT')).toEqual([]);
  });

  it('returns single-element array when fromId === toId', () => {
    const graph = buildTestGraph();
    const id = 'INSTALLATION:SEE999952467552';
    const path = findPath(graph, id, id);
    expect(path.length).toBe(1);
  });
});

describe('getNeighbors', () => {
  it('returns all neighbors of INSTALLATION node', () => {
    const graph = buildTestGraph();
    const neighbors = getNeighbors(graph, 'INSTALLATION:SEE999952467552');
    expect(neighbors.length).toBeGreaterThanOrEqual(2); // NAP + REGION
  });

  it('filters neighbors by edgeType', () => {
    const graph = buildTestGraph();
    const napNeighbors = getNeighbors(
      graph,
      'INSTALLATION:SEE999952467552',
      EDGE_TYPE.VERBUNDEN_MIT
    );
    expect(napNeighbors.length).toBe(1);
    expect(napNeighbors[0].attrs.nodeType).toBe(NODE_TYPE.NAP);
  });

  it('returns empty array for unknown node', () => {
    const graph = buildTestGraph();
    expect(getNeighbors(graph, 'INSTALLATION:NONEXISTENT')).toEqual([]);
  });
});

describe('deriveSignals', () => {
  it('returns MISSING_NAP when installation has no NAP edge', () => {
    const withoutNap = [makeInstallation('SEE999952467552', {})];
    withoutNap[0].NetzanschlusspunktMastrNummer = undefined;
    const graph = buildOntologyGraph(withoutNap, null);
    const signals = deriveSignals(graph, 'INSTALLATION:SEE999952467552');
    const missing = signals.find(s => s.ruleId === 'MISSING_NAP');
    expect(missing).toBeDefined();
    expect(missing.severity).toBe('critical');
  });

  it('does NOT return MISSING_NAP when NAP edge exists', () => {
    const graph = buildTestGraph();
    const signals = deriveSignals(graph, 'INSTALLATION:SEE999952467552');
    expect(signals.find(s => s.ruleId === 'MISSING_NAP')).toBeUndefined();
  });

  it('returns VOLTAGE_HOP_REQUIRED when topologyHop.needsHop=true', () => {
    const withHop = [makeInstallation('SEE999952467552', { extra: {} })];
    const hop = { needsHop: true, voltageClass: 'HS', physicalConnectionPoint: { name: 'UW-X', lat: 49, lon: 7, distance_km: 10 } };
    const graph = buildOntologyGraph(withHop, hop);
    const signals = deriveSignals(graph, 'INSTALLATION:SEE999952467552');
    expect(signals.find(s => s.ruleId === 'VOLTAGE_HOP_REQUIRED')).toBeDefined();
  });

  it('does NOT return VOLTAGE_HOP_REQUIRED when needsHop=false', () => {
    const graph = buildTestGraph();
    const signals = deriveSignals(graph, 'INSTALLATION:SEE999952467552');
    expect(signals.find(s => s.ruleId === 'VOLTAGE_HOP_REQUIRED')).toBeUndefined();
  });

  it('returns HIGH_RENEWABLE_SHARE for 3/3 solar installations', () => {
    const graph = buildTestGraph();
    const signals = deriveSignals(graph, 'INSTALLATION:SEE999952467552');
    expect(signals.find(s => s.ruleId === 'HIGH_RENEWABLE_SHARE')).toBeDefined();
  });

  it('returns empty array for unknown focusNodeId', () => {
    const graph = buildTestGraph();
    expect(deriveSignals(graph, 'INSTALLATION:NONEXISTENT')).toEqual([]);
  });

  it('all returned signals have required fields', () => {
    const withoutNap = [makeInstallation('SEE999952467552', {})];
    withoutNap[0].NetzanschlusspunktMastrNummer = undefined;
    const graph = buildOntologyGraph(withoutNap, null);
    const signals = deriveSignals(graph, 'INSTALLATION:SEE999952467552');
    for (const s of signals) {
      expect(s).toHaveProperty('ruleId');
      expect(s).toHaveProperty('severity');
      expect(s).toHaveProperty('oeoClass');
      expect(s).toHaveProperty('rationale');
      expect(Array.isArray(s.evidence)).toBe(true);
    }
  });
});
