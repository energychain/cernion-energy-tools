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
 *   Edges  — derived by SPATIAL PROXIMITY between topology nodes and line
 *            geometry (within PROXIMITY_THRESHOLD_M, see buildGraph()),
 *            not exact OSM node-ID membership. An earlier version required
 *            a topology node to be a literal way-member of the line; that
 *            matched the pilot area (Hockenheim, mapped with lines traced
 *            through the transformer points) but was proven wrong for
 *            general use by a second real area (Weinheim): 32 real,
 *            fully-fetched topology nodes, 0 way-members of 65 real nearby
 *            lines — the community mapped them as geometrically close but
 *            topologically separate points, which is the more common OSM
 *            style. Node-ID membership (distance 0) is a proper subset of
 *            the proximity model, so it's superseded rather than kept as a
 *            separate path. Every attachment is additionally gated by
 *            voltage plausibility (isVoltageCompatible()) — a 380kV
 *            transmission line must not connect to a low-voltage
 *            distribution transformer merely because it runs nearby.
 *
 *            Even proximity has a real ceiling, though: measured live for
 *            Weinheim, the closest of 32 real substation/transformer nodes
 *            to any real line was 60m, most were 300m–3.4km away — German
 *            MS (~20kV) distribution cables are overwhelmingly underground
 *            and essentially never mapped in OSM, unlike HS/EHS which are
 *            overhead and reliably mapped. For a power=transformer node
 *            left with zero mapped-line attachment, buildGraph() falls
 *            back to pairing it with the nearest power=substation node
 *            (straight-line distance, bounded by
 *            MAX_NEAREST_SUBSTATION_DISTANCE_M) — a structural assumption
 *            (German MS networks are predominantly radial from a local
 *            substation), not a digitised connection. These inferred edges
 *            are tagged `evidenceType: 'nearest_substation_inferred'`
 *            (vs. `'mapped_line'` for the rest) so callers can tell real
 *            OSM-derived topology apart from this approximation. This
 *            fallback deliberately only applies to power=transformer nodes,
 *            not orphaned power=substation nodes — a substation genuinely
 *            not near any mapped line most likely reflects a real gap in
 *            HS/EHS line coverage for that specific substation, and pairing
 *            two substations just because they're geographically close is a
 *            much weaker assumption than the transformer→local-substation
 *            radial-network one (Weinheim's real 32 unattached nodes are, in
 *            fact, all tagged power=substation, so this fallback does not
 *            resolve that specific case — see FETCH_PADDING_M below for the
 *            fix that does apply there).
 *   fetchGridElements() also widens the queried bbox by FETCH_PADDING_M on
 *   every side before calling Overpass, so a substation right at the edge
 *   of the caller's bbox can still find its real feeding line (or, for the
 *   transformer fallback, its real nearest substation) even if that
 *   infrastructure's coordinates fall just outside the requested area.
 *   This intentionally does not model towers/poles as graph nodes — matches
 *   the coarse "which substations are grid-connected to which" question the
 *   original tool's output shape (topologyMetrics, voltageBreakdown) implies,
 *   without exploding into a many-thousand-node pole-level graph.
 *   German railway traction power lines (Bahnstrom, DB Energie, 16.7 Hz)
 *   are excluded at the Overpass query level — out of scope for VNB/
 *   distribution-grid topology.
 *
 * Environment variables:
 *   OVERPASS_ENDPOINT   Override Overpass API URL (default: public instance)
 *   NOMINATIM_ENDPOINT_SEARCH  Override Nominatim forward-geocoding URL
 */

const axios = require('axios');
const { haversineDistanceM } = require('./znp-clustering-heuristics');
const { nearestPointOnPolyline, bboxAreaSqKm, padBbox } = require('./osm-geometry');

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
 * Amount by which fetchGridElements() widens the queried bbox before
 * calling Overpass. A power=substation right at the edge of the requested
 * bbox may have its real feeding HS/EHS line — or, for the nearest-
 * substation fallback, the actual nearest power=substation — just outside
 * it; without padding, that connection is invisible not because it's
 * unmapped but purely because of where the caller happened to draw the
 * box. Sized generously above the largest real gap measured live in this
 * investigation (Weinheim: up to 3.4km from a substation to the nearest
 * mapped line).
 */
const FETCH_PADDING_M = 4000;

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

/** Voltage bucket order, low to high, for adjacency checks. */
const VOLTAGE_ORDER = ['NS', 'MS', 'HS', 'EHS'];

/**
 * Is it physically plausible for a topology node to attach to a way of the
 * given voltage level? A transformer/substation is a boundary between two
 * adjacent voltage levels (e.g. a distribution transformer bridges MS↔NS),
 * so same-or-adjacent-bucket is allowed; anything further apart is rejected
 * regardless of geometric proximity — a 380kV (EHS) transmission line does
 * not connect to a household-scale (NS) transformer just because it happens
 * to run past it.
 *
 * When the *node's own* voltage is unknown (no `voltage` tag — the common
 * case for plain `power=transformer` points, which are overwhelmingly small
 * pole/ground distribution transformers) it is restricted to NS/MS ways
 * only, never auto-attached to HS/EHS transmission infrastructure.
 * `power=substation` nodes span the full range (from small distribution
 * substations to large EHS switching stations) and are left unrestricted
 * when their own voltage is unknown.
 *
 * @param {string} nodeVoltageLevel  NS|MS|HS|EHS|UNKNOWN
 * @param {string} nodeType          'substation'|'transformer'
 * @param {string} wayVoltageLevel   NS|MS|HS|EHS|UNKNOWN
 * @returns {boolean}
 */
function isVoltageCompatible(nodeVoltageLevel, nodeType, wayVoltageLevel) {
  if (wayVoltageLevel === 'UNKNOWN') return true; // way itself unclassified — can't judge

  if (nodeVoltageLevel === 'UNKNOWN') {
    if (nodeType === 'transformer') return wayVoltageLevel === 'NS' || wayVoltageLevel === 'MS';
    return true; // substation, unknown voltage — allow any level
  }

  const nodeIdx = VOLTAGE_ORDER.indexOf(nodeVoltageLevel);
  const wayIdx = VOLTAGE_ORDER.indexOf(wayVoltageLevel);
  return Math.abs(nodeIdx - wayIdx) <= 1;
}

// ─── Spatial geometry helpers ───────────────────────────────────────────────
// The actual projection/distance math lives in src/osm-geometry.js, shared
// with src/osm-landuse-areas.js (polygon area calculation needs the same
// local-metres projection). nearestPointOnWay is kept as a name/param-order
// compatible wrapper around nearestPointOnPolyline since it's part of this
// module's existing public API (services/osm-geo.service.js, tests).

/**
 * @param {number} nodeLat @param {number} nodeLon
 * @param {Array<{lat:number, lon:number}>} wayCoords  Resolved way geometry, >= 2 points.
 * @returns {{distanceM: number, alongM: number}}
 */
function nearestPointOnWay(nodeLat, nodeLon, wayCoords) {
  return nearestPointOnPolyline(nodeLat, nodeLon, wayCoords);
}

// ─── Overpass fetch ─────────────────────────────────────────────────────────

/**
 * Fetches substation/transformer nodes and line/cable/minor_line ways
 * (with full node-membership lists) for a bbox in a single Overpass call.
 * The queried bbox is widened by FETCH_PADDING_M on every side first (see
 * its docstring) so that infrastructure just outside the caller's exact
 * bbox is still visible for line/nearest-substation matching — the
 * returned nodes/ways are NOT filtered back down to the original bbox.
 * @param {{south,west,north,east}} bbox
 * @returns {Promise<{nodes: Map<string, object>, ways: object[]}>}
 */
async function fetchGridElements(bbox) {
  const padded = padBbox(bbox, FETCH_PADDING_M);

  // Excludes German railway traction power lines (Bahnstrom, operated by DB
  // Energie) — out of scope for VNB/distribution-grid topology. These are
  // reliably tagged frequency=16.7 (vs. 50 Hz for the public grid) in OSM;
  // the operator regex is a defensive backup for the rarer case where
  // frequency isn't tagged but the operator name still identifies it.
  const NON_TRACTION = `["frequency"!="16.7"]["operator"!~"DB Energie|Bahnstrom",i]`;
  const query =
    `[out:json][timeout:30];` +
    `(` +
    `node["power"~"^(substation|transformer)$"](${padded.south},${padded.west},${padded.north},${padded.east});` +
    `way["power"~"^(line|cable|minor_line)$"]${NON_TRACTION}(${padded.south},${padded.west},${padded.north},${padded.east});` +
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
 * Fetches grid elements and builds the graph, retrying when the result looks
 * like a truncated/degraded Overpass response rather than a genuinely empty
 * area. Three regressions were found in production, each a more complete
 * form of the same underlying failure (the public Overpass instance
 * silently truncating part of a compound node+way query under load, with
 * no error and no `remark` field, while the way portion stays complete):
 *   (a) real line ways present, real (but wrong) topology nodes present,
 *       zero derivable edges (v0.99.9: identical query back to back
 *       alternated between 8 correct nodes/106 ways and 2 unrelated
 *       nodes/106 ways);
 *   (b) a completely empty response — zero ways AND zero nodes (v0.99.10:
 *       the same bbox, reproduced 3x, returned nothing at all);
 *   (c) real line ways present, but *zero* tagged topology nodes at all —
 *       not wrong ones, none (v0.99.11: reproduced 5/5 with the v0.99.10
 *       fix already deployed, because that fix's "partially truncated"
 *       clause still required `nodes.length > 0` and so didn't cover this
 *       case; the "totally empty" clause didn't apply either since
 *       `ways.length > 0` here).
 *
 * The fix is a single unified rule: if ways were returned, any zero-edge
 * result is implausible regardless of node count; if no ways were
 * returned, only a fully empty response (no nodes either) is implausible —
 * isolated transformers with no nearby lines in the queried bbox is a
 * legitimate, non-implausible result and shouldn't cost an extra retry.
 *
 * This does mean a *genuinely* empty area (no power infrastructure at all
 * within the bbox) pays for one extra retry before settling — an acceptable
 * cost given this platform only ever queries real German municipality
 * areas, which essentially always have some grid infrastructure. Not a bug
 * in buildGraph() itself in any of the three cases (unchanged, still
 * covered by its deterministic unit tests) — the failure is entirely at
 * the Overpass fetch layer.
 *
 * @param {{south,west,north,east}} bbox
 * @param {string|null} voltageLevelFilter
 * @param {{maxRetries?: number, backoffMs?: number}} [options]
 * @returns {Promise<{nodes: object[], edges: object[], retried: boolean}>}
 */
async function fetchAndBuildGraph(bbox, voltageLevelFilter, options = {}) {
  const maxRetries = options.maxRetries ?? 2;
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

    // Unified implausibility check: if real line ways were returned, *any*
    // zero-edge result is suspicious regardless of how many topology nodes
    // came back — this also covers a case found after v0.99.10 shipped:
    // ways present but *zero* tagged substation/transformer nodes at all
    // (not just the wrong ones), which the old two-clause check (requiring
    // nodes.length > 0 for the "partially truncated" case) missed entirely
    // and let through as a final NO_NODES result without ever retrying.
    // If no ways were returned, only retry when nodes are absent too — a
    // bbox with isolated transformers but no nearby lines is a legitimate,
    // non-implausible result and shouldn't cost an extra retry.
    const implausible = ways.length > 0 ? result.edges.length === 0 : nodesById.size === 0;
    if (!implausible) break;
  }

  return { ...result, retried };
}

// ─── Graph construction ─────────────────────────────────────────────────────

/**
 * Distance within which a topology node is considered physically attached
 * to a line way. Chosen to comfortably cover pole/ground distribution
 * transformers sited right next to their line (often exactly on it — see
 * the isVoltageCompatible / node-ID-membership case, distance 0, still
 * within any positive threshold) as well as substations set back into a
 * fenced compound reachable by a short, frequently-unmapped spur — while
 * staying tight enough not to false-positive-connect unrelated nearby
 * infrastructure.
 */
const PROXIMITY_THRESHOLD_M = 50;

/**
 * Maximum distance for the nearest-substation fallback (see buildGraph()).
 * Bounds how far a distribution transformer can be paired with a substation
 * it isn't really confirmed to belong to — generously covers even a large
 * rural MS feeder radius while refusing to pair transformers and
 * substations in different, unrelated settlements.
 */
const MAX_NEAREST_SUBSTATION_DISTANCE_M = 5000;

/**
 * Builds the topology graph: nodes = substation/transformer elements,
 * edges = derived from spatial proximity between topology nodes and line
 * geometry, not exact OSM node-ID membership.
 *
 * Background: exact node-ID-membership (a topology node literally listed as
 * a way-member of a line) was the original model and matched the pilot
 * bbox (Hockenheim) by coincidence — that area happens to be mapped with
 * lines traced topologically through the transformer points. A second real
 * area (Weinheim) proved this is not the general OSM convention: 32 real,
 * fully-fetched substation/transformer nodes, 0 of them way-members of any
 * of 65 real nearby line ways — the community mapped them as geometrically
 * close but topologically separate point features, which is in fact the
 * more common OSM style for German distribution infrastructure. Node-ID
 * membership is a proper subset of "within PROXIMITY_THRESHOLD_M of the
 * line" (distance 0), so this model supersedes it without a separate code
 * path.
 *
 * Every candidate attachment is additionally gated by isVoltageCompatible()
 * — proximity alone is not sufficient plausibility: a 380kV transmission
 * line must not connect to a low-voltage distribution transformer merely
 * because it happens to run nearby.
 *
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
    const { level: wayVoltageLevel, volts } = classifyVoltage(way.tags.voltage);
    if (voltageLevelFilter && wayVoltageLevel !== voltageLevelFilter) continue;

    const wayCoords = (way.nodes || [])
      .map((id) => nodesById.get(String(id)))
      .filter((el) => el && el.lat != null && el.lon != null)
      .map((el) => ({ lat: el.lat, lon: el.lon }));
    if (wayCoords.length < 2) continue;

    // Find every topology node within the proximity threshold of this way,
    // gated by voltage plausibility, ordered by position along the line so
    // multiple attachments to the same way chain correctly rather than
    // forming a clique.
    const attachments = [];
    for (const node of nodes) {
      if (!isVoltageCompatible(node.voltageLevel, node.type, wayVoltageLevel)) continue;
      const nearest = nearestPointOnWay(node.location.lat, node.location.lon, wayCoords);
      if (nearest.distanceM <= PROXIMITY_THRESHOLD_M) {
        attachments.push({ node, alongM: nearest.alongM });
      }
    }
    attachments.sort((a, b) => a.alongM - b.alongM);

    for (let i = 1; i < attachments.length; i++) {
      const fromNode = attachments[i - 1].node;
      const toNode = attachments[i].node;
      if (fromNode.osmId === toNode.osmId) continue; // same node attached twice (shouldn't happen, defensive)

      const key = [fromNode.osmId, toNode.osmId].sort().join('|');
      if (edgesByKey.has(key)) continue;

      const lengthKm =
        haversineDistanceM(
          fromNode.location.lat,
          fromNode.location.lon,
          toNode.location.lat,
          toNode.location.lon
        ) / 1000;
      edgesByKey.set(key, {
        from: fromNode.osmId,
        to: toNode.osmId,
        voltageLevel: wayVoltageLevel,
        voltageVolts: volts,
        osmWayId: `way/${way.id}`,
        ref: way.tags.ref || null,
        operator: way.tags.operator || null,
        lengthKmApprox: Number(lengthKm.toFixed(3)),
        evidenceType: 'mapped_line',
      });
      const fromNodeRef = nodesByOsmId.get(fromNode.osmId);
      const toNodeRef = nodesByOsmId.get(toNode.osmId);
      fromNodeRef.degree += 1;
      toNodeRef.degree += 1;
    }
  }

  // ─── Fallback: nearest-substation inference for still-isolated transformers ──
  //
  // MS (~20kV) distribution cables in Germany are overwhelmingly underground
  // and essentially never mapped in OSM (unlike HS/EHS, which are overhead
  // and reliably mapped — confirmed live for Hockenheim: 106 real, correctly
  // tagged lines). A small distribution transformer (power=transformer) that
  // found no real mapped-line attachment above is not actually disconnected
  // in reality — physically, every such transformer must be fed from some
  // substation (Umspannwerk), it's just that the connecting cable isn't in
  // the data. The nearest power=substation node is used as a structural
  // approximation of that real-but-unmapped connection (German MS networks
  // are predominantly radial from a local substation), bounded by
  // MAX_NEAREST_SUBSTATION_DISTANCE_M to avoid pairing a rural transformer
  // with a substation towns away.
  //
  // This is fundamentally different evidence than a mapped_line edge — an
  // assumption grounded in grid topology conventions, not a real digitised
  // connection — so it's tagged evidenceType: 'nearest_substation_inferred'
  // and callers should treat the two differently (e.g. exclude inferred
  // edges from claims about "confirmed" OSM line coverage).
  if (!voltageLevelFilter || voltageLevelFilter === 'MS') {
    const substationNodes = nodes.filter((n) => n.type === 'substation');
    if (substationNodes.length > 0) {
      for (const node of nodes) {
        if (node.type !== 'transformer' || node.degree > 0) continue;

        let nearestSubstation = null;
        let nearestDistanceM = Infinity;
        for (const sub of substationNodes) {
          const distanceM = haversineDistanceM(
            node.location.lat,
            node.location.lon,
            sub.location.lat,
            sub.location.lon
          );
          if (distanceM < nearestDistanceM) {
            nearestDistanceM = distanceM;
            nearestSubstation = sub;
          }
        }
        if (!nearestSubstation || nearestDistanceM > MAX_NEAREST_SUBSTATION_DISTANCE_M) continue;

        const key = [node.osmId, nearestSubstation.osmId].sort().join('|');
        if (edgesByKey.has(key)) continue;

        edgesByKey.set(key, {
          from: node.osmId,
          to: nearestSubstation.osmId,
          voltageLevel: 'MS',
          voltageVolts: null,
          osmWayId: null,
          ref: null,
          operator: null,
          lengthKmApprox: Number((nearestDistanceM / 1000).toFixed(3)),
          evidenceType: 'nearest_substation_inferred',
        });
        node.degree += 1;
        nearestSubstation.degree += 1;
      }
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
  padBbox,
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
  MAX_NEAREST_SUBSTATION_DISTANCE_M,
  FETCH_PADDING_M,
  VOLTAGE_BUCKETS,
};
