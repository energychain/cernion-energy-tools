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
  fetchGridElements,
  fetchAndBuildGraph,
  buildGraph,
  computeMetrics,
  countConnectedComponents,
  shortestPath,
  MAX_BBOX_AREA_SQ_KM,
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
});

// ---------------------------------------------------------------------------
describe('buildGraph', () => {
  const nodesById = new Map([
    ['1', { id: 1, lat: 49.3, lon: 8.5, tags: { power: 'substation' } }],
    ['2', { id: 2, lat: 49.31, lon: 8.51, tags: { power: 'transformer' } }],
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
      { type: 'node', id: 4414642613, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } },
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
      { type: 'node', id: 1738604612, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } },
      { type: 'node', id: 1738604613, lat: 49.31, lon: 8.51, tags: { power: 'transformer' } },
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
