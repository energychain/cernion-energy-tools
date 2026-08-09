'use strict';

/**
 * Tests for src/osm-grid-topology.js — local grid topology extraction,
 * replacing the broken mcp.cernion.de `osm_grid_topology` proxy (see
 * services/osm-geo.service.js's gridTopology action).
 */

jest.mock('axios');

const axios = require('axios');
const {
  geocodeLocationToBbox,
  bboxAreaSqKm,
  classifyVoltage,
  isVoltageCompatible,
  nearestPointOnWay,
  fetchGridElements,
  fetchAndBuildGraph,
  buildGraph,
  computeMetrics,
  countConnectedComponents,
  shortestPath,
  MAX_BBOX_AREA_SQ_KM,
  PROXIMITY_THRESHOLD_M,
} = require('../src/osm-grid-topology');

beforeEach(() => {
  axios.get.mockReset();
  axios.post.mockReset();
});

// ---------------------------------------------------------------------------
describe('classifyVoltage', () => {
  it('buckets NS/MS/HS/EHS correctly at the boundaries', () => {
    expect(classifyVoltage('400')).toEqual({ level: 'NS', volts: 400 });
    expect(classifyVoltage('999')).toEqual({ level: 'NS', volts: 999 });
    expect(classifyVoltage('1000')).toEqual({ level: 'MS', volts: 1000 });
    expect(classifyVoltage('20000')).toEqual({ level: 'MS', volts: 20000 });
    expect(classifyVoltage('60000')).toEqual({ level: 'HS', volts: 60000 });
    expect(classifyVoltage('110000')).toEqual({ level: 'HS', volts: 110000 });
    expect(classifyVoltage('150000')).toEqual({ level: 'EHS', volts: 150000 });
    expect(classifyVoltage('380000')).toEqual({ level: 'EHS', volts: 380000 });
  });

  it('takes the max of a ";"-separated shared-tower voltage list', () => {
    expect(classifyVoltage('380000;220000')).toEqual({ level: 'EHS', volts: 380000 });
  });

  it('returns UNKNOWN for missing or unparsable tags', () => {
    expect(classifyVoltage(undefined)).toEqual({ level: 'UNKNOWN', volts: null });
    expect(classifyVoltage('')).toEqual({ level: 'UNKNOWN', volts: null });
    expect(classifyVoltage('not-a-number')).toEqual({ level: 'UNKNOWN', volts: null });
  });
});

// ---------------------------------------------------------------------------
// isVoltageCompatible — the plausibility gate requested after a real report:
// a low-voltage transformer must not connect to a 380kV transmission line
// merely because it happens to be the geometrically nearest infrastructure.
// ---------------------------------------------------------------------------
describe('isVoltageCompatible', () => {
  it('rejects an unknown-voltage transformer near an EHS (380kV) line', () => {
    expect(isVoltageCompatible('UNKNOWN', 'transformer', 'EHS')).toBe(false);
  });

  it('rejects an unknown-voltage transformer near an HS (110kV) line', () => {
    expect(isVoltageCompatible('UNKNOWN', 'transformer', 'HS')).toBe(false);
  });

  it('allows an unknown-voltage transformer near NS or MS lines (the common case)', () => {
    expect(isVoltageCompatible('UNKNOWN', 'transformer', 'NS')).toBe(true);
    expect(isVoltageCompatible('UNKNOWN', 'transformer', 'MS')).toBe(true);
  });

  it('allows an unknown-voltage substation near any line (substations span the full range)', () => {
    expect(isVoltageCompatible('UNKNOWN', 'substation', 'NS')).toBe(true);
    expect(isVoltageCompatible('UNKNOWN', 'substation', 'MS')).toBe(true);
    expect(isVoltageCompatible('UNKNOWN', 'substation', 'HS')).toBe(true);
    expect(isVoltageCompatible('UNKNOWN', 'substation', 'EHS')).toBe(true);
  });

  it('allows a known-voltage node to attach to a line at the same or adjacent bucket', () => {
    expect(isVoltageCompatible('MS', 'substation', 'MS')).toBe(true);
    expect(isVoltageCompatible('MS', 'substation', 'NS')).toBe(true); // MS/NS distribution transformer
    expect(isVoltageCompatible('MS', 'substation', 'HS')).toBe(true); // HS/MS substation
  });

  it('rejects a known-voltage node more than one bucket away from the line', () => {
    expect(isVoltageCompatible('NS', 'substation', 'EHS')).toBe(false);
    expect(isVoltageCompatible('NS', 'substation', 'HS')).toBe(false);
    expect(isVoltageCompatible('EHS', 'substation', 'NS')).toBe(false);
  });

  it('cannot judge compatibility against an unclassified line — allows it', () => {
    expect(isVoltageCompatible('NS', 'transformer', 'UNKNOWN')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nearestPointOnWay — point-to-polyline projection used for proximity-based
// edge derivation (replaces exact node-ID membership, see buildGraph).
// ---------------------------------------------------------------------------
describe('nearestPointOnWay', () => {
  it('returns ~0 distance for a point exactly on a way vertex', () => {
    const wayCoords = [
      { lat: 49.3, lon: 8.5 },
      { lat: 49.31, lon: 8.51 },
    ];
    const result = nearestPointOnWay(49.3, 8.5, wayCoords);
    expect(result.distanceM).toBeLessThan(1);
    expect(result.alongM).toBeCloseTo(0, 0);
  });

  it('returns a positive distance for a point offset from the way', () => {
    const wayCoords = [
      { lat: 49.3, lon: 8.5 },
      { lat: 49.31, lon: 8.5 }, // due north, ~1.1km
    ];
    // ~0.0003 deg east of the line ~= ~25m at this latitude
    const result = nearestPointOnWay(49.305, 8.5003, wayCoords);
    expect(result.distanceM).toBeGreaterThan(15);
    expect(result.distanceM).toBeLessThan(35);
  });

  it('orders the projection along a multi-segment way correctly', () => {
    const wayCoords = [
      { lat: 49.3, lon: 8.5 },
      { lat: 49.31, lon: 8.5 },
      { lat: 49.32, lon: 8.5 },
    ];
    const near0 = nearestPointOnWay(49.3, 8.5, wayCoords);
    const nearMid = nearestPointOnWay(49.31, 8.5, wayCoords);
    const nearEnd = nearestPointOnWay(49.32, 8.5, wayCoords);
    expect(near0.alongM).toBeLessThan(nearMid.alongM);
    expect(nearMid.alongM).toBeLessThan(nearEnd.alongM);
  });
});

// ---------------------------------------------------------------------------
describe('bboxAreaSqKm', () => {
  it('computes a plausible area for the Hockenheim pilot bbox', () => {
    const area = bboxAreaSqKm({ south: 49.273, west: 8.483, north: 49.363, east: 8.621 });
    expect(area).toBeGreaterThan(50);
    expect(area).toBeLessThan(150);
  });

  it('flags a Germany-sized bbox as exceeding MAX_BBOX_AREA_SQ_KM', () => {
    const area = bboxAreaSqKm({ south: 47, west: 5, north: 55, east: 15 });
    expect(area).toBeGreaterThan(MAX_BBOX_AREA_SQ_KM);
  });
});

// ---------------------------------------------------------------------------
describe('geocodeLocationToBbox', () => {
  it('parses Nominatim boundingbox (south,north,west,east order) into {south,west,north,east}', async () => {
    axios.get.mockResolvedValueOnce({
      data: [{ boundingbox: ['49.3034154', '49.3593176', '8.4554738', '8.6040426'] }],
    });
    const bbox = await geocodeLocationToBbox('Hockenheim');
    expect(bbox).toEqual({ south: 49.3034154, north: 49.3593176, west: 8.4554738, east: 8.6040426 });
  });

  it('sends an identifying User-Agent (Nominatim usage-policy requirement)', async () => {
    axios.get.mockResolvedValueOnce({ data: [{ boundingbox: ['1', '2', '3', '4'] }] });
    await geocodeLocationToBbox('Hockenheim');
    const [, config] = axios.get.mock.calls[0];
    expect(config.headers['User-Agent']).toBeTruthy();
  });

  it('returns null when Nominatim finds no match', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });
    const bbox = await geocodeLocationToBbox('NichtExistierenderOrtXYZ');
    expect(bbox).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('fetchGridElements', () => {
  it('parses Overpass elements into a node map and a way list', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        elements: [
          { type: 'node', id: 1, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } },
          { type: 'way', id: 100, nodes: [1, 2], tags: { power: 'line', voltage: '110000' } },
        ],
      },
    });
    const { nodesById, ways } = await fetchGridElements({
      south: 49.27,
      west: 8.48,
      north: 49.36,
      east: 8.62,
    });
    expect(nodesById.get('1').tags.power).toBe('transformer');
    expect(ways).toHaveLength(1);
  });

  it('sends an identifying User-Agent (Overpass 406 lesson from the addLayer1 fix)', async () => {
    axios.post.mockResolvedValueOnce({ data: { elements: [] } });
    await fetchGridElements({ south: 49.27, west: 8.48, north: 49.36, east: 8.62 });
    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers['User-Agent']).toBeTruthy();
  });

  it('excludes German railway traction power lines (16.7 Hz / DB Energie) from the query', async () => {
    axios.post.mockResolvedValueOnce({ data: { elements: [] } });
    await fetchGridElements({ south: 49.27, west: 8.48, north: 49.36, east: 8.62 });
    const [, body] = axios.post.mock.calls[0];
    const decoded = decodeURIComponent(body);
    expect(decoded).toContain('"frequency"!="16.7"');
    expect(decoded).toMatch(/"operator"!~"DB Energie\|Bahnstrom"/);
  });
});

// ---------------------------------------------------------------------------
describe('buildGraph', () => {
  // node/2 is a 'substation' (not 'transformer') deliberately: it sits
  // between an HS (110kV) and an MS (20kV) way, and a plain 'transformer'
  // with unknown voltage is restricted to NS/MS-only by isVoltageCompatible
  // (see dedicated voltage-plausibility tests below) — a substation is
  // unrestricted, matching real German convention where HS-connected points
  // are mapped as substations, not small distribution transformers.
  const nodesById = new Map([
    ['1', { id: 1, lat: 49.3, lon: 8.5, tags: { power: 'substation' } }],
    ['2', { id: 2, lat: 49.31, lon: 8.51, tags: { power: 'substation' } }],
    ['3', { id: 3, lat: 49.32, lon: 8.52, tags: { power: 'transformer' } }],
    ['9', { id: 9, lat: 49.315, lon: 8.515, tags: { power: 'tower' } }],
  ]);
  const ways = [
    { id: 100, nodes: [1, 9, 2], tags: { power: 'line', voltage: '110000', ref: 'L1' } },
    { id: 101, nodes: [2, 3], tags: { power: 'minor_line', voltage: '20000' } },
  ];

  it('only treats substation/transformer nodes as graph nodes (towers excluded)', () => {
    const { nodes } = buildGraph(nodesById, ways, null);
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.osmId).sort()).toEqual(['node/1', 'node/2', 'node/3']);
  });

  it('derives an edge by walking past a non-topology node (tower) along a way', () => {
    const { edges } = buildGraph(nodesById, ways, null);
    const edge12 = edges.find((e) => e.from === 'node/1' && e.to === 'node/2');
    expect(edge12).toBeDefined();
    expect(edge12.voltageLevel).toBe('HS');
    expect(edge12.osmWayId).toBe('way/100');
    expect(edge12.ref).toBe('L1');
  });

  it('filters edges by voltageLevel', () => {
    const { edges } = buildGraph(nodesById, ways, 'HS');
    expect(edges).toHaveLength(1);
    expect(edges[0].voltageLevel).toBe('HS');
  });

  it('increments node degree for each connected edge', () => {
    const { nodes } = buildGraph(nodesById, ways, null);
    const node2 = nodes.find((n) => n.osmId === 'node/2');
    expect(node2.degree).toBe(2); // connects to both node/1 and node/3
  });

  it('produces zero edges when no way references more than one topology node (reproduces the original bug scenario inverted — i.e. proves the fix path)', () => {
    const isolatedNodes = new Map([
      ['1', { id: 1, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } }],
    ]);
    const { nodes, edges } = buildGraph(isolatedNodes, ways, null);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
  });

  // ─── Spatial proximity model (the Weinheim fix) ────────────────────────
  // A straight north-south way; test nodes are offset east of it by a known
  // distance rather than being literal way-members — reproducing the real
  // finding that OSM substations/transformers are usually geometrically
  // close to, but not topologically threaded into, the line way.
  const straightWay = [
    {
      id: 700,
      nodes: [1000, 1001],
      tags: { power: 'line', voltage: '20000' }, // MS
    },
  ];
  const straightWayNodes = new Map([
    ['1000', { id: 1000, lat: 49.3, lon: 8.5 }],
    ['1001', { id: 1001, lat: 49.31, lon: 8.5 }],
  ]);

  it('connects a substation ~22m from the line even though it is not a way-member (Weinheim pattern)', () => {
    const nodesById = new Map(straightWayNodes);
    nodesById.set('2000', {
      id: 2000,
      lat: 49.305,
      lon: 8.5003, // ~22m east of the line at this latitude
      tags: { power: 'substation' },
    });
    const { nodes, edges } = buildGraph(nodesById, straightWay, null);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0); // only one topology node -- can't form an edge alone, but it IS included
    expect(nodes[0].osmId).toBe('node/2000');
  });

  it('connects two substations near the same line into an edge, even though neither is a way-member', () => {
    const nodesById = new Map(straightWayNodes);
    nodesById.set('2000', {
      id: 2000,
      lat: 49.302,
      lon: 8.5003, // ~22m east, near the start
      tags: { power: 'substation' },
    });
    nodesById.set('2001', {
      id: 2001,
      lat: 49.308,
      lon: 8.5003, // ~22m east, near the end
      tags: { power: 'substation' },
    });
    const { nodes, edges } = buildGraph(nodesById, straightWay, null);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0].voltageLevel).toBe('MS');
  });

  it('does NOT connect a substation ~218m from the line (beyond PROXIMITY_THRESHOLD_M)', () => {
    expect(PROXIMITY_THRESHOLD_M).toBeLessThan(218);
    const nodesById = new Map(straightWayNodes);
    nodesById.set('2000', { id: 2000, lat: 49.302, lon: 8.503, tags: { power: 'substation' } });
    nodesById.set('2001', { id: 2001, lat: 49.308, lon: 8.503, tags: { power: 'substation' } });
    const { edges } = buildGraph(nodesById, straightWay, null);
    expect(edges).toHaveLength(0);
  });

  it('rejects an implausible connection: an unknown-voltage transformer right next to a 380kV (EHS) line', () => {
    const ehsWay = [{ id: 800, nodes: [1000, 1001], tags: { power: 'line', voltage: '380000' } }];
    const nodesById = new Map(straightWayNodes);
    // 2m from the line -- would trivially match on proximity alone.
    nodesById.set('2000', {
      id: 2000,
      lat: 49.305,
      lon: 8.50003,
      tags: { power: 'transformer' }, // no voltage tag -- unknown
    });
    const { nodes, edges } = buildGraph(nodesById, ehsWay, null);
    expect(nodes).toHaveLength(1); // the node is still reported (found, isolated)
    expect(edges).toHaveLength(0); // but not connected -- voltage-implausible
  });

  it('does connect a substation right next to the same 380kV line (substations are unrestricted)', () => {
    const ehsWay = [{ id: 800, nodes: [1000, 1001], tags: { power: 'line', voltage: '380000' } }];
    const nodesById = new Map(straightWayNodes);
    nodesById.set('2000', { id: 2000, lat: 49.302, lon: 8.50003, tags: { power: 'substation' } });
    nodesById.set('2001', { id: 2001, lat: 49.308, lon: 8.50003, tags: { power: 'substation' } });
    const { edges } = buildGraph(nodesById, ehsWay, null);
    expect(edges).toHaveLength(1);
    expect(edges[0].voltageLevel).toBe('EHS');
  });
});

// ---------------------------------------------------------------------------
describe('computeMetrics', () => {
  it('classifies a pure tree (no cycles) as RADIAL with indicator 0', () => {
    const nodes = [
      { osmId: 'node/1', voltageLevel: 'HS', degree: 1 },
      { osmId: 'node/2', voltageLevel: 'HS', degree: 2 },
      { osmId: 'node/3', voltageLevel: 'HS', degree: 1 },
    ];
    const edges = [
      { from: 'node/1', to: 'node/2', voltageLevel: 'HS', lengthKmApprox: 1 },
      { from: 'node/2', to: 'node/3', voltageLevel: 'HS', lengthKmApprox: 1 },
    ];
    const metrics = computeMetrics(nodes, edges);
    expect(metrics.topologyType).toBe('RADIAL');
    expect(metrics.topologyIndicator).toBe(0);
    expect(metrics.nodes).toBe(3);
    expect(metrics.edges).toBe(2);
  });

  it('classifies a single 3-node loop as still mostly RADIAL (one redundant edge is not "meshed")', () => {
    const nodes = [
      { osmId: 'node/1', voltageLevel: 'HS', degree: 2 },
      { osmId: 'node/2', voltageLevel: 'HS', degree: 2 },
      { osmId: 'node/3', voltageLevel: 'HS', degree: 2 },
    ];
    const edges = [
      { from: 'node/1', to: 'node/2', voltageLevel: 'HS', lengthKmApprox: 1 },
      { from: 'node/2', to: 'node/3', voltageLevel: 'HS', lengthKmApprox: 1 },
      { from: 'node/3', to: 'node/1', voltageLevel: 'HS', lengthKmApprox: 1 },
    ];
    const metrics = computeMetrics(nodes, edges);
    expect(metrics.topologyIndicator).toBeCloseTo(1 / 3, 2);
    expect(metrics.topologyType).toBe('RADIAL');
  });

  it('classifies a densely interconnected 4-node cluster (K4) as RING', () => {
    const nodes = ['node/1', 'node/2', 'node/3', 'node/4'].map((osmId) => ({
      osmId,
      voltageLevel: 'HS',
      degree: 3,
    }));
    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        edges.push({ from: nodes[i].osmId, to: nodes[j].osmId, voltageLevel: 'HS', lengthKmApprox: 1 });
      }
    }
    const metrics = computeMetrics(nodes, edges);
    expect(metrics.edges).toBe(6);
    expect(metrics.topologyIndicator).toBeGreaterThan(0.7);
    expect(metrics.topologyType).toBe('RING');
  });

  it('returns 0 nodes/edges/indicator for an empty graph without throwing', () => {
    const metrics = computeMetrics([], []);
    expect(metrics.nodes).toBe(0);
    expect(metrics.edges).toBe(0);
    expect(metrics.avgNodeDegree).toBe(0);
    expect(metrics.topologyIndicator).toBe(0);
    expect(metrics.topologyType).toBe('RADIAL');
  });

  it('aggregates voltageBreakdown per bucket including lineLengthKmApprox', () => {
    const nodes = [{ osmId: 'node/1', voltageLevel: 'HS', degree: 1 }];
    const edges = [{ from: 'node/1', to: 'node/1', voltageLevel: 'HS', lengthKmApprox: 2.5 }];
    const metrics = computeMetrics(nodes, edges);
    expect(metrics.voltageBreakdown.HS).toEqual({ nodes: 1, edges: 1, lineLengthKmApprox: 2.5 });
    expect(metrics.voltageBreakdown.NS).toEqual({ nodes: 0, edges: 0, lineLengthKmApprox: 0 });
  });
});

// ---------------------------------------------------------------------------
describe('countConnectedComponents', () => {
  it('counts isolated nodes as their own component', () => {
    const nodes = [{ osmId: 'node/1' }, { osmId: 'node/2' }];
    expect(countConnectedComponents(nodes, [])).toBe(2);
  });

  it('merges nodes connected by an edge into one component', () => {
    const nodes = [{ osmId: 'node/1' }, { osmId: 'node/2' }, { osmId: 'node/3' }];
    const edges = [{ from: 'node/1', to: 'node/2' }];
    expect(countConnectedComponents(nodes, edges)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('shortestPath', () => {
  const nodes = [
    { osmId: 'node/1' },
    { osmId: 'node/2' },
    { osmId: 'node/3' },
    { osmId: 'node/4' }, // disconnected
  ];
  const edges = [
    { from: 'node/1', to: 'node/2', lengthKmApprox: 1 },
    { from: 'node/2', to: 'node/3', lengthKmApprox: 2 },
  ];

  it('finds the shortest path across two hops', () => {
    const result = shortestPath(nodes, edges, 'node/1', 'node/3');
    expect(result.found).toBe(true);
    expect(result.hopCount).toBe(2);
    expect(result.totalLengthKmApprox).toBe(3);
    expect(result.path).toEqual(['node/1', 'node/2', 'node/3']);
  });

  it('returns found:false for a disconnected node', () => {
    const result = shortestPath(nodes, edges, 'node/1', 'node/4');
    expect(result.found).toBe(false);
  });

  it('returns found:false when an endpoint is not in the node set', () => {
    const result = shortestPath(nodes, edges, 'node/1', 'node/999');
    expect(result.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchAndBuildGraph — retry on a topologically implausible zero-edge result
// (regression: public Overpass observed live silently truncating the node
// portion of a compound query under load, while the way portion stayed
// complete — no error, no `remark` field, just fewer/wrong nodes).
// ---------------------------------------------------------------------------
describe('fetchAndBuildGraph', () => {
  const IMPLAUSIBLE_RESPONSE = {
    elements: [
      // A tagged node present, but not a way-member of the one line way below
      // -- exactly the shape of the live regression (ways complete, nodes
      // silently wrong/incomplete).
      { type: 'node', id: 4414642613, lat: 49.3, lon: 8.5, tags: { power: 'substation' } },
      {
        type: 'way',
        id: 500,
        nodes: [1738604612, 1738604613],
        tags: { power: 'line', voltage: '110000' },
      },
    ],
  };
  const GOOD_RESPONSE = {
    elements: [
      { type: 'node', id: 1738604612, lat: 49.3, lon: 8.5, tags: { power: 'substation' } },
      { type: 'node', id: 1738604613, lat: 49.31, lon: 8.51, tags: { power: 'substation' } },
      {
        type: 'way',
        id: 500,
        nodes: [1738604612, 1738604613],
        tags: { power: 'line', voltage: '110000' },
      },
    ],
  };
  // Ways present, but *zero* tagged substation/transformer nodes at all --
  // not wrong ones (that's IMPLAUSIBLE_RESPONSE above), literally none. The
  // v0.99.11 regression: this fell through both the old "partially
  // truncated" clause (required nodes.length > 0) and the "totally empty"
  // clause (required ways.length === 0), so it was never retried.
  const WAYS_BUT_NO_TAGGED_NODES_RESPONSE = {
    elements: [
      // Untagged skeleton node from way-recursion (`>`) -- present in
      // nodesById but not a topology node, matching real Overpass output.
      { type: 'node', id: 9999999999, lat: 49.305, lon: 8.505 },
      {
        type: 'way',
        id: 500,
        nodes: [1738604612, 9999999999, 1738604613],
        tags: { power: 'line', voltage: '110000' },
      },
    ],
  };

  // No ways at all, but a real isolated tagged node -- a legitimate,
  // non-implausible result (e.g. a small transformer with no nearby line
  // within the queried bbox) that should NOT cost an extra retry.
  const ISOLATED_NODE_NO_WAYS_RESPONSE = {
    elements: [{ type: 'node', id: 42, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } }],
  };

  const bbox = { south: 49.27, west: 8.48, north: 49.36, east: 8.62 };

  it('returns the first result directly when it is plausible (no retry)', async () => {
    axios.post.mockResolvedValueOnce({ data: GOOD_RESPONSE });
    const result = await fetchAndBuildGraph(bbox, null);
    expect(result.edges).toHaveLength(1);
    expect(result.retried).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('retries once and uses the retry result when the first fetch is implausible (ways present, 0 edges)', async () => {
    axios.post.mockResolvedValueOnce({ data: IMPLAUSIBLE_RESPONSE });
    axios.post.mockResolvedValueOnce({ data: GOOD_RESPONSE });
    const result = await fetchAndBuildGraph(bbox, null, { maxRetries: 1, backoffMs: 0 });
    expect(result.edges).toHaveLength(1);
    expect(result.retried).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and returns the last (still implausible) result honestly', async () => {
    axios.post.mockResolvedValue({ data: IMPLAUSIBLE_RESPONSE });
    const result = await fetchAndBuildGraph(bbox, null, { maxRetries: 1, backoffMs: 0 });
    expect(result.edges).toHaveLength(0);
    expect(result.nodes).toHaveLength(1);
    expect(result.retried).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('retries a totally empty response (0 ways, 0 nodes) — the v0.99.10 regression pattern', async () => {
    axios.post.mockResolvedValueOnce({ data: { elements: [] } });
    axios.post.mockResolvedValueOnce({ data: GOOD_RESPONSE });
    const result = await fetchAndBuildGraph(bbox, null, { maxRetries: 1, backoffMs: 0 });
    expect(result.edges).toHaveLength(1);
    expect(result.retried).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('gives up on a genuinely empty area after exhausting retries', async () => {
    axios.post.mockResolvedValue({ data: { elements: [] } });
    const result = await fetchAndBuildGraph(bbox, null, { maxRetries: 1, backoffMs: 0 });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.retried).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('propagates a hard fetch error without retrying', async () => {
    axios.post.mockRejectedValueOnce(new Error('OVERPASS_TIMEOUT'));
    await expect(fetchAndBuildGraph(bbox, null)).rejects.toThrow('OVERPASS_TIMEOUT');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('retries when ways are present but zero tagged topology nodes came back at all — the v0.99.11 regression pattern', async () => {
    axios.post.mockResolvedValueOnce({ data: WAYS_BUT_NO_TAGGED_NODES_RESPONSE });
    axios.post.mockResolvedValueOnce({ data: GOOD_RESPONSE });
    const result = await fetchAndBuildGraph(bbox, null, { maxRetries: 1, backoffMs: 0 });
    expect(result.edges).toHaveLength(1);
    expect(result.retried).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry a real isolated node with no nearby lines (legitimate, non-implausible result)', async () => {
    axios.post.mockResolvedValueOnce({ data: ISOLATED_NODE_NO_WAYS_RESPONSE });
    const result = await fetchAndBuildGraph(bbox, null);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
    expect(result.retried).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
