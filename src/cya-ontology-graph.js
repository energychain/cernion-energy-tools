'use strict';

/**
 * CYA Central Asset Ontology Graph (v0.32.0)
 *
 * Builds an in-memory Graphology directed graph from MaStR installation data.
 * Node types: INSTALLATION, NAP, SUBSTATION, VNB, REGION
 * Edge types:  VERBUNDEN_MIT, LIEGT_IN, BETRIEBEN_VON, ZUSTAENDIG_FUER
 *
 * Replaces Regex-based signal evaluation in cya-regulatory-graph.js with
 * structural graph-property and edge-existence checks.
 *
 * EU AI Act Art. 12: all signals carry evidence node IDs for traceability.
 */

const Graph = require('graphology');

// ── Node-type constants ────────────────────────────────────────────────────
const NODE_TYPE = {
  INSTALLATION: 'INSTALLATION',
  NAP: 'NAP',
  SUBSTATION: 'SUBSTATION',
  VNB: 'VNB',
  REGION: 'REGION',
};

// ── Edge-type constants ────────────────────────────────────────────────────
const EDGE_TYPE = {
  VERBUNDEN_MIT: 'VERBUNDEN_MIT',
  LIEGT_IN: 'LIEGT_IN',
  BETRIEBEN_VON: 'BETRIEBEN_VON',
  ZUSTAENDIG_FUER: 'ZUSTAENDIG_FUER',
};

// ── OEO class URIs (mirrored from cya-regulatory-graph.js) ────────────────
const SIGNAL_OEO = {
  NOVA_BLOCKED:          'https://openenergyplatform.org/ontology/oeo/OEO_00020143',
  HIGH_CURTAILMENT:      'https://openenergyplatform.org/ontology/oeo/OEO_00020144',
  EWK_BELOW_MEDIAN:      'https://openenergyplatform.org/ontology/oeo/OEO_00020145',
  MISSING_NAP:           'https://openenergyplatform.org/ontology/oeo/OEO_00020146',
  SECTION14A_GAP:        'https://openenergyplatform.org/ontology/oeo/OEO_00020147',
  ENERGY_SHARING_DEADLINE: 'https://openenergyplatform.org/ontology/oeo/OEO_00020148',
  GRID_TOPOLOGY_RADIAL:  'https://openenergyplatform.org/ontology/oeo/OEO_00020149',
  HIGH_RENEWABLE_SHARE:  'https://openenergyplatform.org/ontology/oeo/OEO_00020150',
  VOLTAGE_HOP_REQUIRED:  'https://openenergyplatform.org/ontology/oeo/OEO_00020151',
};

// ── Internal helpers ───────────────────────────────────────────────────────

function _addInstallationNode(graph, inst, topologyHop) {
  const id = `INSTALLATION:${inst.EinheitMastrNummer}`;
  if (!graph.hasNode(id)) {
    graph.addNode(id, {
      nodeType: NODE_TYPE.INSTALLATION,
      mastrNummer: inst.EinheitMastrNummer,
      name: inst.EinheitName || null,
      leistungKw: inst.Bruttoleistung || inst.NettoLeistung || null,
      spannungsebene: inst.Spannungsebene || null,
      technologie: inst.Technologie || inst.EinheitTyp || null,
      ibJahr: inst.InbetriebnahmeDatum
        ? new Date(inst.InbetriebnahmeDatum).getFullYear()
        : null,
      status: inst.EinheitBetriebsstatus || null,
      koordinaten: (inst.Laengengrad && inst.Breitengrad)
        ? { lat: inst.Breitengrad, lon: inst.Laengengrad }
        : null,
      novaStatus:       inst.novaStatus       || null,
      abregelungQuote:  inst.abregelungQuote  != null ? inst.abregelungQuote : null,
      ewkBelowMedian:   inst.ewkBelowMedian   || false,
      section14aStatus: inst.section14aStatus || null,
      needsHop:         topologyHop?.needsHop || false,
    });
  }
  return id;
}

function _addNapNode(graph, inst, instNodeId) {
  const napRaw = inst.NetzanschlusspunktMastrNummer || inst.NapId;
  if (!napRaw) return null;
  const napNodeId = `NAP:${napRaw}`;
  if (!graph.hasNode(napNodeId)) {
    graph.addNode(napNodeId, {
      nodeType: NODE_TYPE.NAP,
      napId: napRaw,
      bezeichnung: inst.NapBezeichnung || null,
      spannungsebene: inst.Spannungsebene || null,
    });
  }
  if (!graph.hasEdge(instNodeId, napNodeId)) {
    graph.addEdge(instNodeId, napNodeId, { edgeType: EDGE_TYPE.VERBUNDEN_MIT });
  }
  return napNodeId;
}

function _addRegionAndVnb(graph, inst, instNodeId) {
  if (!inst.Postleitzahl) return;
  const regionId = `REGION:${inst.Postleitzahl}`;
  if (!graph.hasNode(regionId)) {
    graph.addNode(regionId, {
      nodeType: NODE_TYPE.REGION,
      plz: inst.Postleitzahl,
      gemeinde: inst.Gemeinde || null,
    });
  }
  if (!graph.hasEdge(instNodeId, regionId)) {
    graph.addEdge(instNodeId, regionId, { edgeType: EDGE_TYPE.LIEGT_IN });
  }

  const vnbKey = inst.NetzbetreiberMastrNummer || inst.Netzbetreiber;
  if (!vnbKey) return;
  const vnbId = `VNB:${vnbKey}`;
  if (!graph.hasNode(vnbId)) {
    graph.addNode(vnbId, {
      nodeType: NODE_TYPE.VNB,
      bdewCode: inst.NetzbetreiberBdewCode || null,
      mastrNummer: inst.NetzbetreiberMastrNummer || null,
      name: inst.Netzbetreiber || null,
    });
  }
  if (!graph.hasEdge(vnbId, regionId)) {
    graph.addEdge(vnbId, regionId, { edgeType: EDGE_TYPE.ZUSTAENDIG_FUER });
  }
}

function _addSubstationFromHop(graph, topologyHop) {
  if (!topologyHop?.needsHop || !topologyHop.physicalConnectionPoint) return;
  const pcp = topologyHop.physicalConnectionPoint;
  const subId = `SUBSTATION:${pcp.name || 'hop-substation'}`;

  if (!graph.hasNode(subId)) {
    graph.addNode(subId, {
      nodeType: NODE_TYPE.SUBSTATION,
      substationId: pcp.name || 'hop-substation',
      name: pcp.name || null,
      spannungsebene: topologyHop.voltageClass || null,
      koordinaten: (pcp.lat && pcp.lon) ? { lat: pcp.lat, lon: pcp.lon } : null,
    });
  }

  // Connect all existing NAP nodes to this substation
  graph.forEachNode((nodeId, attrs) => {
    if (attrs.nodeType === NODE_TYPE.NAP && !graph.hasEdge(nodeId, subId)) {
      graph.addEdge(nodeId, subId, { edgeType: EDGE_TYPE.LIEGT_IN });
    }
  });

  if (topologyHop.inferredOperator) {
    const vnbId = `VNB:${topologyHop.inferredOperator}`;
    if (!graph.hasNode(vnbId)) {
      graph.addNode(vnbId, {
        nodeType: NODE_TYPE.VNB,
        name: topologyHop.inferredOperator,
        bdewCode: null,
        mastrNummer: null,
      });
    }
    if (!graph.hasEdge(subId, vnbId)) {
      graph.addEdge(subId, vnbId, { edgeType: EDGE_TYPE.BETRIEBEN_VON });
    }
  }
}

// ── Signal deriver helpers ────────────────────────────────────────────────

function _signalMissingNap(graph, instId, _attrs) {
  const hasNap = graph.outEdges(instId)
    .some(e => graph.getEdgeAttributes(e).edgeType === EDGE_TYPE.VERBUNDEN_MIT);
  if (!hasNap) {
    return {
      ruleId: 'MISSING_NAP',
      severity: 'critical',
      oeoClass: SIGNAL_OEO.MISSING_NAP,
      rationale: 'INSTALLATION hat keine VERBUNDEN_MIT-Kante zu einem NAP.',
      evidence: [instId],
    };
  }
  return null;
}

function _signalVoltageHop(graph, instId, attrs) {
  if (attrs.needsHop) {
    return {
      ruleId: 'VOLTAGE_HOP_REQUIRED',
      severity: 'warning',
      oeoClass: SIGNAL_OEO.VOLTAGE_HOP_REQUIRED,
      rationale: 'Asset-Kapazität erfordert Anschluss an vorgelagerte HS/HöS-Ebene.',
      evidence: [instId],
    };
  }
  return null;
}

function _signalNovaBlocked(graph, instId, attrs) {
  if (attrs.novaStatus === 'blocked') {
    return {
      ruleId: 'NOVA_BLOCKED',
      severity: 'warning',
      oeoClass: SIGNAL_OEO.NOVA_BLOCKED,
      rationale: 'NOVA-Status der Anlage ist als blockiert markiert.',
      evidence: [instId],
    };
  }
  return null;
}

function _signalHighCurtailment(graph, instId, attrs) {
  if (attrs.abregelungQuote != null && attrs.abregelungQuote > 0.05) {
    return {
      ruleId: 'HIGH_CURTAILMENT',
      severity: 'warning',
      oeoClass: SIGNAL_OEO.HIGH_CURTAILMENT,
      rationale: `Abregelungsquote ${(attrs.abregelungQuote * 100).toFixed(1)}% überschreitet Schwellwert (5%).`,
      evidence: [instId],
    };
  }
  return null;
}

function _signalEwkBelowMedian(graph, instId, attrs) {
  if (attrs.ewkBelowMedian === true) {
    return {
      ruleId: 'EWK_BELOW_MEDIAN',
      severity: 'info',
      oeoClass: SIGNAL_OEO.EWK_BELOW_MEDIAN,
      rationale: 'Energiewendekoeffizient liegt unter dem regionalen Median.',
      evidence: [instId],
    };
  }
  return null;
}

function _signalSection14aGap(graph, instId, attrs) {
  if (attrs.section14aStatus === 'gap') {
    return {
      ruleId: 'SECTION14A_GAP',
      severity: 'warning',
      oeoClass: SIGNAL_OEO.SECTION14A_GAP,
      rationale: '§14a-bezogene Umsetzungslücke in der Anlage erkannt.',
      evidence: [instId],
    };
  }
  return null;
}

function _signalRadialTopology(graph, instId) {
  // Find connected NAP; radial = NAP has exactly 1 inbound INSTALLATION edge
  const napEdges = graph.outEdges(instId)
    .filter(e => graph.getEdgeAttributes(e).edgeType === EDGE_TYPE.VERBUNDEN_MIT);
  if (napEdges.length === 0) return null;
  const napId = graph.target(napEdges[0]);
  const inboundInstallations = graph.inEdges(napId)
    .filter(e => graph.getEdgeAttributes(e).edgeType === EDGE_TYPE.VERBUNDEN_MIT);
  if (inboundInstallations.length === 1) {
    return {
      ruleId: 'GRID_TOPOLOGY_RADIAL',
      severity: 'info',
      oeoClass: SIGNAL_OEO.GRID_TOPOLOGY_RADIAL,
      rationale: 'NAP-Knoten hat nur eine angeschlossene Anlage — radiale Topologie erkannt.',
      evidence: [instId, napId],
    };
  }
  return null;
}

function _signalHighRenewableShare(graph) {
  const renewable = ['solar', 'pv', 'wind', 'photovoltaik'];
  let renewableCount = 0;
  let totalCount = 0;
  graph.forEachNode((nodeId, attrs) => {
    if (attrs.nodeType !== NODE_TYPE.INSTALLATION) return;
    totalCount++;
    const tech = (attrs.technologie || '').toLowerCase();
    if (renewable.some(r => tech.includes(r))) renewableCount++;
  });
  if (totalCount > 0 && renewableCount / totalCount >= 0.7) {
    return {
      ruleId: 'HIGH_RENEWABLE_SHARE',
      severity: 'info',
      oeoClass: SIGNAL_OEO.HIGH_RENEWABLE_SHARE,
      rationale: `${renewableCount} von ${totalCount} Anlagen sind erneuerbar (≥70%).`,
      evidence: [],
    };
  }
  return null;
}

function _signalEnergySharingDeadline(graph, focusNodeId) {
  // Triggered when any INSTALLATION has energySharingEligible property set
  const attrs = graph.hasNode(focusNodeId)
    ? graph.getNodeAttributes(focusNodeId)
    : {};
  if (attrs.energySharingEligible === true) {
    return {
      ruleId: 'ENERGY_SHARING_DEADLINE',
      severity: 'warning',
      oeoClass: SIGNAL_OEO.ENERGY_SHARING_DEADLINE,
      rationale: 'Anlage ist für Energy Sharing (§42c EnWG) vorgemerkt — Frist 01.06.2026.',
      evidence: [focusNodeId],
    };
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a directed Graphology ontology graph from MaStR installation data.
 *
 * @param {Object[]} installations - Array of MaStR installation objects
 * @param {Object|null} topologyHopResult - Result from cya-topology-hop.js
 * @returns {import('graphology').Graph}
 */
function buildOntologyGraph(installations, topologyHopResult) {
  const graph = new Graph({ type: 'directed', allowSelfLoops: false });
  const instList = Array.isArray(installations) ? installations : [];

  for (const inst of instList) {
    if (!inst.EinheitMastrNummer) continue;
    const instNodeId = _addInstallationNode(graph, inst, topologyHopResult);
    _addNapNode(graph, inst, instNodeId);
    _addRegionAndVnb(graph, inst, instNodeId);
  }

  _addSubstationFromHop(graph, topologyHopResult);
  return graph;
}

/**
 * Query all nodes of a given nodeType, optionally filtered.
 *
 * @param {import('graphology').Graph} graph
 * @param {string} nodeType - One of NODE_TYPE constants
 * @param {((attrs: Object) => boolean)|null} [filterFn]
 * @returns {{ id: string, attrs: Object }[]}
 */
function queryNodes(graph, nodeType, filterFn) {
  const result = [];
  graph.forEachNode((nodeId, attrs) => {
    if (attrs.nodeType !== nodeType) return;
    if (filterFn && !filterFn(attrs)) return;
    result.push({ id: nodeId, attrs });
  });
  return result;
}

/**
 * BFS path between two node IDs (ignores edge direction).
 *
 * @param {import('graphology').Graph} graph
 * @param {string} fromId
 * @param {string} toId
 * @returns {{ id: string, attrs: Object }[]} Empty array if no path found.
 */
function findPath(graph, fromId, toId) {
  if (!graph.hasNode(fromId) || !graph.hasNode(toId)) return [];
  if (fromId === toId) return [{ id: fromId, attrs: graph.getNodeAttributes(fromId) }];

  const visited = new Set([fromId]);
  const queue = [[fromId]];

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    for (const neighbor of graph.neighbors(current)) {
      if (visited.has(neighbor)) continue;
      const newPath = [...path, neighbor];
      if (neighbor === toId) {
        return newPath.map(id => ({ id, attrs: graph.getNodeAttributes(id) }));
      }
      visited.add(neighbor);
      queue.push(newPath);
    }
  }
  return [];
}

/**
 * Get direct neighbors of a node, optionally filtered by edgeType.
 *
 * @param {import('graphology').Graph} graph
 * @param {string} nodeId
 * @param {string|null} [edgeType]
 * @returns {{ id: string, attrs: Object }[]}
 */
function getNeighbors(graph, nodeId, edgeType) {
  if (!graph.hasNode(nodeId)) return [];
  const result = [];
  graph.forEachNeighbor(nodeId, (neighborId, neighborAttrs) => {
    if (edgeType) {
      const connecting = graph.edges(nodeId, neighborId)
        .concat(graph.edges(neighborId, nodeId))
        .find(e => graph.getEdgeAttributes(e).edgeType === edgeType);
      if (!connecting) return;
    }
    result.push({ id: neighborId, attrs: neighborAttrs });
  });
  return result;
}

/**
 * Build a subgraph around a center node up to radius hops.
 *
 * @param {import('graphology').Graph} graph
 * @param {string} centerNodeId
 * @param {number} [radius=2]
 * @returns {import('graphology').Graph}
 */
function getSubgraph(graph, centerNodeId, radius) {
  const r = radius != null ? radius : 2;
  const subGraph = new Graph({ type: 'directed', allowSelfLoops: false });
  if (!graph.hasNode(centerNodeId)) return subGraph;

  const visited = new Set([centerNodeId]);
  let frontier = [centerNodeId];

  subGraph.addNode(centerNodeId, graph.getNodeAttributes(centerNodeId));

  for (let hop = 0; hop < r; hop++) {
    const nextFrontier = [];
    for (const nodeId of frontier) {
      for (const neighbor of graph.neighbors(nodeId)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          subGraph.addNode(neighbor, graph.getNodeAttributes(neighbor));
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // Add all edges between included nodes
  graph.forEachEdge((edgeId, edgeAttrs, source, target) => {
    if (subGraph.hasNode(source) && subGraph.hasNode(target) && !subGraph.hasEdge(source, target)) {
      subGraph.addEdge(source, target, edgeAttrs);
    }
  });

  return subGraph;
}

/**
 * Derive semantic signals from graph structure around a focus node.
 * No Regex — only structural property and edge-existence checks.
 *
 * @param {import('graphology').Graph} graph
 * @param {string} focusNodeId - Typically `INSTALLATION:<mastrNummer>`
 * @returns {Array<{ ruleId: string, severity: string, oeoClass: string, rationale: string, evidence: string[] }>}
 */
function deriveSignals(graph, focusNodeId) {
  if (!graph.hasNode(focusNodeId)) return [];

  const attrs = graph.getNodeAttributes(focusNodeId);
  const isInstallation = attrs.nodeType === NODE_TYPE.INSTALLATION;
  const signals = [];

  const push = (s) => { if (s) signals.push(s); };

  if (isInstallation) {
    push(_signalMissingNap(graph, focusNodeId, attrs));
    push(_signalVoltageHop(graph, focusNodeId, attrs));
    push(_signalNovaBlocked(graph, focusNodeId, attrs));
    push(_signalHighCurtailment(graph, focusNodeId, attrs));
    push(_signalEwkBelowMedian(graph, focusNodeId, attrs));
    push(_signalSection14aGap(graph, focusNodeId, attrs));
    push(_signalRadialTopology(graph, focusNodeId));
    push(_signalEnergySharingDeadline(graph, focusNodeId));
  }

  push(_signalHighRenewableShare(graph));

  return signals;
}

module.exports = {
  NODE_TYPE,
  EDGE_TYPE,
  SIGNAL_OEO,
  buildOntologyGraph,
  queryNodes,
  findPath,
  getNeighbors,
  getSubgraph,
  deriveSignals,
};
