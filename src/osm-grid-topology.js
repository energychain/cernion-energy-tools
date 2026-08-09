'use strict';

/**
 * OSM Grid Topology — local replacement for the mcp.cernion.de `osm_grid_topology`
 * MCP tool.
 *
 * Background: `osm-geo.gridTopology` used to proxy to an external Cernion MCP
 * service (see src/mcp-client.js) whose edge-derivation logic was found to be
 * broken — it reported 0 edges for a bbox with 106 real OSM power lines, even
 * though 6/7 sampled substation/transformer nodes were confirmed to be actual
 * way-members of those lines (i.e. the topological connectivity exists in the
 * raw data; the external tool's graph construction was silently dropping it).
 * Since the actual bug lives in a service we don't have source access to,
 * this module re-implements grid topology extraction directly against
 * Overpass (the same OSM data source, same pattern as src/znp-osm-buildings.js),
 * removing the mcp.cernion.de dependency entirely for this one capability.
 *
 * Graph model:
 *   Nodes  — OSM elements tagged power=substation or power=transformer.
 *   Edges  — derived by walking each power=line/cable/minor_line way's ordered
 *            node list and connecting consecutive pairs of *our* node-set
 *            members found along that way. A line that only touches zero or
 *            one such node within the queried bbox contributes no edge from
 *            that way (a legitimate boundary effect — the line continues via
 *            towers/poles we don't model as graph nodes, or leaves the bbox).
 *   This intentionally does not model towers/poles as graph nodes — matches
 *   the coarse "which substations are grid-connected to which" question the
 *   original tool's output shape (topologyMetrics, voltageBreakdown) implies,
 *   without exploding into a many-thousand-node pole-level graph.
 *
 * Environment variables:
 *   OVERPASS_ENDPOINT   Override Overpass API URL (default: public instance)
 *   NOMINATIM_ENDPOINT_SEARCH  Override Nominatim forward-geocoding URL
 */

const axios = require('axios');
const { haversineDistanceM } = require('./znp-clustering-heuristics');

const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter';
const NOMINATIM_SEARCH_ENDPOINT =
  process.env.NOMINATIM_ENDPOINT_SEARCH || 'https://nominatim.openstreetmap.org/search';

const REQUEST_TIMEOUT_MS = 30000;
const USER_AGENT = 'cernion-energy-tools/osm-grid-topology (+https://cernion.energy)';

/** Bbox area guard — protects the public Overpass instance from oversized queries. */
const MAX_BBOX_AREA_SQ_KM = 2500; // ~50km x 50km

/**
 * German grid voltage-level buckets (BNetzA convention), by max volts on the tag.
 * NS  < 1 kV, MS 1–60 kV, HS 60–150 kV, EHS >= 150 kV.
 */
const VOLTAGE_BUCKETS = [
  { level: 'NS', maxV: 1000 },
  { level: 'MS', maxV: 60000 },
  { level: 'HS', maxV: 150000 },
  { level: 'EHS', maxV: Infinity },
];

// ─── Geocoding ──────────────────────────────────────────────────────────────

/**
 * Forward-geocode a place name to a bounding box via Nominatim.
 * @param {string} locationName
 * @returns {Promise<{south:number, west:number, north:number, east:number}|null>}
 */
async function geocodeLocationToBbox(locationName) {
  const response = await axios.get(NOMINATIM_SEARCH_ENDPOINT, {
    params: { q: locationName, format: 'json', limit: 1, addressdetails: 0 },
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
  });
  const results = Array.isArray(response.data) ? response.data : [];
  if (!results.length || !Array.isArray(results[0].boundingbox)) return null;

  const [south, north, west, east] = results[0].boundingbox.map(Number);
  if (![south, north, west, east].every(Number.isFinite)) return null;
  return { south, west, north, east };
}

/**
 * @param {{south,west,north,east}} bbox
 * @returns {number} approximate area in km^2
 */
function bboxAreaSqKm(bbox) {
  const latKm = haversineDistanceM(bbox.south, bbox.west, bbox.north, bbox.west) / 1000;
  const lonKm = haversineDistanceM(bbox.south, bbox.west, bbox.south, bbox.east) / 1000;
  return latKm * lonKm;
}

// ─── Voltage classification ────────────────────────────────────────────────

/**
 * Parses an OSM `voltage` tag (volts, optionally ";"-separated for shared
 * towers/multi-circuit ways) and buckets the highest value into NS/MS/HS/EHS.
 * @param {string|undefined} voltageTag
 * @returns {{level: string, volts: number|null}}
 */
function classifyVoltage(voltageTag) {
  if (!voltageTag) return { level: 'UNKNOWN', volts: null };
  const values = String(voltageTag)
    .split(';')
    .map((v) => Number(v.trim()))
    .filter(Number.isFinite);
  if (!values.length) return { level: 'UNKNOWN', volts: null };

  const maxVolts = Math.max(...values);
  const bucket = VOLTAGE_BUCKETS.find((b) => maxVolts < b.maxV) || VOLTAGE_BUCKETS.at(-1);
  return { level: bucket.level, volts: maxVolts };
}

// ─── Overpass fetch ─────────────────────────────────────────────────────────

/**
 * Fetches substation/transformer nodes and line/cable/minor_line ways
 * (with full node-membership lists) for a bbox in a single Overpass call.
 * @param {{south,west,north,east}} bbox
 * @returns {Promise<{nodes: Map<string, object>, ways: object[]}>}
 */
async function fetchGridElements(bbox) {
  const query =
    `[out:json][timeout:30];` +
    `(` +
    `node["power"~"^(substation|transformer)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `way["power"~"^(line|cable|minor_line)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});` +
    `);` +
    `out body;>;out skel qt;`;

  const response = await axios.post(OVERPASS_ENDPOINT, `data=${encodeURIComponent(query)}`, {
    timeout: REQUEST_TIMEOUT_MS + 5000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
  });

  const elements = response.data?.elements || [];
  const nodesById = new Map();
  for (const el of elements) {
    if (el.type === 'node') {
      nodesById.set(String(el.id), el);
    }
  }

  const ways = elements.filter((el) => el.type === 'way' && el.tags?.power);
  return { nodesById, ways };
}

/** Backoff between retries in fetchAndBuildGraph. */
const RETRY_BACKOFF_MS = 2000;

/**
 * Fetches grid elements and builds the graph, retrying the fetch once if the
 * result is topologically implausible: real line ways present, at least one
 * topology node present, but zero derivable edges.
 *
 * This exists because the public Overpass instance was observed live to
 * silently truncate the node portion of a compound node+way query under
 * load while the way portion stayed complete (identical query, back to
 * back: 8 nodes/106 ways, then only 2 unrelated nodes/106 ways, with no
 * error or `remark` field either time) — a v0.99.9 regression report
 * reproduced the exact same 2 spurious node IDs independently, which is
 * consistent with a fixed internal processing/truncation order on an
 * overloaded shared instance rather than a bug in buildGraph() (already
 * covered by deterministic unit tests). A short-backoff retry resolves this
 * in practice; if it recurs, the caller gets an honest zero-edges result
 * (see osm-geo.service.js's dataQuality messaging) rather than a fabricated
 * explanation.
 *
 * @param {{south,west,north,east}} bbox
 * @param {string|null} voltageLevelFilter
 * @param {{maxRetries?: number, backoffMs?: number}} [options]
 * @returns {Promise<{nodes: object[], edges: object[], retried: boolean}>}
 */
async function fetchAndBuildGraph(bbox, voltageLevelFilter, options = {}) {
  const maxRetries = options.maxRetries ?? 1;
  const backoffMs = options.backoffMs ?? RETRY_BACKOFF_MS;
  let result = { nodes: [], edges: [] };
  let retried = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      retried = true;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    const { nodesById, ways } = await fetchGridElements(bbox);
    result = buildGraph(nodesById, ways, voltageLevelFilter);

    const implausible = ways.length > 0 && result.nodes.length > 0 && result.edges.length === 0;
    if (!implausible) break;
  }

  return { ...result, retried };
}

// ─── Graph construction ─────────────────────────────────────────────────────

/**
 * Builds the topology graph: nodes = substation/transformer elements,
 * edges = derived from way node-membership adjacency (see module docstring).
 * @param {Map<string, object>} nodesById  All fetched OSM nodes (Overpass `>` recursion), keyed by id.
 * @param {object[]} ways                  power=line/cable/minor_line ways with `.nodes` id arrays.
 * @param {string|null} voltageLevelFilter NS|MS|HS|EHS or null for no filter.
 * @returns {{nodes: object[], edges: object[]}}
 */
function buildGraph(nodesById, ways, voltageLevelFilter) {
  // Topology nodes are only those explicitly tagged substation/transformer —
  // not every node Overpass returned (which includes plain line-geometry points).
  const topologyNodeIds = new Set();
  for (const [id, el] of nodesById) {
    if (el.tags?.power === 'substation' || el.tags?.power === 'transformer') {
      topologyNodeIds.add(id);
    }
  }

  const nodes = [...topologyNodeIds].map((id) => {
    const el = nodesById.get(id);
    const { level } = classifyVoltage(el.tags?.voltage);
    return {
      osmId: `node/${id}`,
      type: el.tags.power,
      location: { lat: el.lat, lon: el.lon },
      voltageLevel: level,
      degree: 0,
    };
  });
  const nodesByOsmId = new Map(nodes.map((n) => [n.osmId, n]));

  const edgesByKey = new Map(); // dedupe: "node/a|node/b" (sorted) -> edge
  for (const way of ways) {
    const wayNodeIds = way.nodes || [];
    const { level: wayVoltageLevel, volts } = classifyVoltage(way.tags.voltage);
    if (voltageLevelFilter && wayVoltageLevel !== voltageLevelFilter) continue;

    // Walk the ordered node list, connecting consecutive topology-node members.
    let prevIdx = -1;
    for (let i = 0; i < wayNodeIds.length; i++) {
      const id = String(wayNodeIds[i]);
      if (!topologyNodeIds.has(id)) continue;
      if (prevIdx === -1) {
        prevIdx = i;
        continue;
      }

      const fromId = `node/${wayNodeIds[prevIdx]}`;
      const toId = `node/${id}`;
      const key = [fromId, toId].sort().join('|');
      if (!edgesByKey.has(key)) {
        const fromNode = nodesByOsmId.get(fromId);
        const toNode = nodesByOsmId.get(toId);
        const lengthKm =
          haversineDistanceM(
            fromNode.location.lat,
            fromNode.location.lon,
            toNode.location.lat,
            toNode.location.lon
          ) / 1000;
        edgesByKey.set(key, {
          from: fromId,
          to: toId,
          voltageLevel: wayVoltageLevel,
          voltageVolts: volts,
          osmWayId: `way/${way.id}`,
          ref: way.tags.ref || null,
          operator: way.tags.operator || null,
          lengthKmApprox: Number(lengthKm.toFixed(3)),
        });
        fromNode.degree += 1;
        toNode.degree += 1;
      }
      prevIdx = i;
    }
  }

  return { nodes, edges: [...edgesByKey.values()] };
}

// ─── Graph metrics ──────────────────────────────────────────────────────────

/**
 * Union-find over node osmIds to count connected components.
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {number}
 */
function countConnectedComponents(nodes, edges) {
  const parent = new Map(nodes.map((n) => [n.osmId, n.osmId]));
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (const e of edges) union(e.from, e.to);
  return new Set(nodes.map((n) => find(n.osmId))).size;
}

/**
 * Computes graph-level topology metrics.
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {object} topologyMetrics (matches the pre-existing response shape)
 */
function computeMetrics(nodes, edges) {
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const avgNodeDegree = nodeCount > 0 ? (2 * edgeCount) / nodeCount : 0;

  // Meshedness / redundancy: cyclomatic number (first Betti number) of the
  // graph, normalized by node count. 0 for a pure tree (RADIAL, no cycles);
  // a single simple loop between a handful of nodes still reads as mostly
  // radial (one redundant edge is not a "meshed" network), while a densely
  // interconnected cluster (many redundant edges relative to node count)
  // approaches 1.
  let topologyIndicator = 0;
  if (edgeCount > 0) {
    const components = countConnectedComponents(nodes, edges);
    const cyclomaticNumber = edgeCount - (nodeCount - components);
    topologyIndicator = Math.max(0, Math.min(1, cyclomaticNumber / nodeCount));
  }
  const topologyType =
    topologyIndicator > 0.7 ? 'RING' : topologyIndicator >= 0.5 ? 'MIXED' : 'RADIAL';

  const voltageBreakdown = {};
  for (const bucket of [...VOLTAGE_BUCKETS.map((b) => b.level), 'UNKNOWN']) {
    voltageBreakdown[bucket] = { nodes: 0, edges: 0, lineLengthKmApprox: 0 };
  }
  for (const n of nodes) voltageBreakdown[n.voltageLevel].nodes += 1;
  for (const e of edges) {
    voltageBreakdown[e.voltageLevel].edges += 1;
    voltageBreakdown[e.voltageLevel].lineLengthKmApprox = Number(
      (voltageBreakdown[e.voltageLevel].lineLengthKmApprox + e.lengthKmApprox).toFixed(3)
    );
  }

  return {
    nodes: nodeCount,
    edges: edgeCount,
    avgNodeDegree: Number(avgNodeDegree.toFixed(2)),
    topologyType,
    topologyIndicator: Number(topologyIndicator.toFixed(2)),
    voltageBreakdown,
  };
}

// ─── Path analysis (Dijkstra) ───────────────────────────────────────────────

/**
 * Shortest path between two node osmIds by edge length (km).
 * @param {object[]} nodes
 * @param {object[]} edges
 * @param {string} fromOsmId
 * @param {string} toOsmId
 * @returns {{found: boolean, hopCount: number|null, totalLengthKmApprox: number|null, path: string[]|null, confidence: string}}
 */
function shortestPath(nodes, edges, fromOsmId, toOsmId) {
  const nodeIds = new Set(nodes.map((n) => n.osmId));
  if (!nodeIds.has(fromOsmId) || !nodeIds.has(toOsmId)) {
    return { found: false, hopCount: null, totalLengthKmApprox: null, path: null, confidence: 'low' };
  }

  const adjacency = new Map(nodes.map((n) => [n.osmId, []]));
  for (const e of edges) {
    adjacency.get(e.from).push({ to: e.to, weight: e.lengthKmApprox });
    adjacency.get(e.to).push({ to: e.from, weight: e.lengthKmApprox });
  }

  const dist = new Map(nodes.map((n) => [n.osmId, Infinity]));
  const prev = new Map();
  dist.set(fromOsmId, 0);
  const visited = new Set();
  const queue = new Set(nodeIds);

  while (queue.size) {
    let current = null;
    let currentDist = Infinity;
    for (const id of queue) {
      if (dist.get(id) < currentDist) {
        currentDist = dist.get(id);
        current = id;
      }
    }
    if (current === null) break;
    queue.delete(current);
    visited.add(current);
    if (current === toOsmId) break;

    for (const { to, weight } of adjacency.get(current) || []) {
      if (visited.has(to)) continue;
      const alt = dist.get(current) + weight;
      if (alt < dist.get(to)) {
        dist.set(to, alt);
        prev.set(to, current);
      }
    }
  }

  if (!prev.has(toOsmId) && fromOsmId !== toOsmId) {
    return { found: false, hopCount: null, totalLengthKmApprox: null, path: null, confidence: 'low' };
  }

  const path = [toOsmId];
  let cursor = toOsmId;
  while (cursor !== fromOsmId) {
    cursor = prev.get(cursor);
    path.unshift(cursor);
  }

  return {
    found: true,
    hopCount: path.length - 1,
    totalLengthKmApprox: Number(dist.get(toOsmId).toFixed(3)),
    path,
    confidence: 'medium', // derived from local OSM topology only, not a VNB-authoritative source
  };
}

module.exports = {
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
  VOLTAGE_BUCKETS,
};
