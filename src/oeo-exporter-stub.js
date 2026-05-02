/**
 * OEO Exporter Stub — Cernion Energy Tools
 *
 * This file is an intentional STUB designed for academic and open-source contributors.
 *
 * WHAT THIS DOES (today):
 *   Exports the internal Graphology asset graph (nodes: INSTALLATION, NAP, SUBSTATION,
 *   VNB, REGION; edges: VERBUNDEN_MIT, LIEGT_IN, BETRIEBEN_VON, ZUSTAENDIG_FUER)
 *   as a skeleton JSON-LD structure, ready to be mapped to OEO classes.
 *
 * WHAT WE NEED FROM YOU (Pull Requests welcome):
 *   Implement `transformToOEO()` with real OEO class mappings.
 *   The graph already contains real-world MaStR data (cleaned, topology-resolved).
 *   You bring the ontology expertise — we bring the data.
 *
 * TARGET ONTOLOGY:
 *   https://github.com/OpenEnergyPlatform/ontology
 *
 * OEO CLASSES TO MAP (suggestions, not exhaustive):
 *   INSTALLATION → oeo:PowerPlant, oeo:PhotovoltaicPlant, oeo:WindTurbine
 *   NAP           → oeo:GridConnectionPoint
 *   SUBSTATION    → oeo:Substation
 *   VNB           → oeo:ElectricityGridOperator
 *   REGION        → oeo:Region
 *
 * DESIGNED FOR INTEGRATION WITH:
 *   https://github.com/assume-framework/assume
 *   https://github.com/OpenEnergyPlatform/oeplatform
 *
 * SEE ALSO:
 *   src/cya-ontology-graph.js  — graph construction (Graphology, directed)
 *   CONTRIBUTING_SCIENCE.md    — contributor guide for researchers
 *
 * @module oeo-exporter-stub
 * @since v0.34.1
 */

'use strict';

/**
 * Skeleton JSON-LD @context for OEO mapping.
 * Contributors: replace stub URIs with real OEO IRIs.
 * OEO namespace: http://openenergy-platform.org/ontology/oeo/
 */
const OEO_CONTEXT_STUB = {
  '@vocab': 'http://openenergy-platform.org/ontology/oeo/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  // TODO (contributor): add full OEO prefix mappings
  oeo: 'http://openenergy-platform.org/ontology/oeo/',
  mastr: 'https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/',
};

/**
 * Node-type → OEO class mapping stub.
 * Each entry is a placeholder — replace with verified OEO IRIs.
 *
 * @see https://github.com/OpenEnergyPlatform/ontology/tree/dev/src/imports
 */
const NODE_TYPE_TO_OEO_CLASS = {
  INSTALLATION: 'oeo:PowerPlant', // TODO: differentiate by technologie
  NAP: 'oeo:GridConnectionPoint', // TODO: verify OEO term
  SUBSTATION: 'oeo:Substation', // TODO: verify OEO term
  VNB: 'oeo:ElectricityGridOperator', // TODO: verify OEO term
  REGION: 'oeo:Region', // TODO: verify OEO term
};

/**
 * Edge-type → OEO object property mapping stub.
 */
const EDGE_TYPE_TO_OEO_PROPERTY = {
  VERBUNDEN_MIT: 'oeo:connectedTo', // TODO: verify OEO property
  LIEGT_IN: 'oeo:locatedIn', // TODO: verify OEO property
  BETRIEBEN_VON: 'oeo:operatedBy', // TODO: verify OEO property
  ZUSTAENDIG_FUER: 'oeo:responsibleFor', // TODO: verify OEO property
};

/**
 * Transforms a serialized Graphology graph into a JSON-LD skeleton.
 *
 * CURRENT STATUS: Returns a structurally correct but semantically incomplete
 * JSON-LD document. OEO class mappings are stubs (see NODE_TYPE_TO_OEO_CLASS).
 *
 * CONTRIBUTOR TASK:
 *   1. Verify / replace OEO IRIs in NODE_TYPE_TO_OEO_CLASS and EDGE_TYPE_TO_OEO_PROPERTY
 *   2. Add OEO-required properties per class (e.g. oeo:nominalPower for PowerPlant)
 *   3. Map MaStR technologie codes to specific OEO subclasses
 *   4. Add SHACL shapes or JSON-LD framing if needed
 *
 * @param {object} graphologyExport - Output of graph.export() from Graphology
 * @param {object} [options]
 * @param {string} [options.baseIri] - Base IRI for generated node identifiers
 * @returns {object} JSON-LD skeleton document
 *
 * @throws {Error} NOT_IMPLEMENTED if called without a contributor implementation
 *   Remove the throw and implement the mapping to activate this exporter.
 */
function transformToOEO(graphologyExport, options = {}) {
  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  CONTRIBUTOR ENTRY POINT                                         ║
  // ║  Implement the mapping below and remove the NotImplementedError. ║
  // ║  See CONTRIBUTING_SCIENCE.md for instructions.                   ║
  // ╚══════════════════════════════════════════════════════════════════╝

  const NOT_IMPLEMENTED = true; // set to false after implementing
  if (NOT_IMPLEMENTED) {
    const err = new Error(
      'OEO mapping not yet implemented. ' +
        'See src/oeo-exporter-stub.js and CONTRIBUTING_SCIENCE.md. ' +
        'Pull Requests welcome: https://github.com/OpenEnergyPlatform/ontology'
    );
    err.code = 'OEO_NOT_IMPLEMENTED';
    throw err;
  }

  // --- STUB SKELETON (active after NOT_IMPLEMENTED = false) ---
  const baseIri = options.baseIri || 'https://cernion.example/graph/';

  const nodes = (graphologyExport.nodes || []).map((node) => ({
    '@id': `${baseIri}${node.key}`,
    '@type': NODE_TYPE_TO_OEO_CLASS[node.attributes?.type] || 'oeo:EnergyAsset',
    'rdfs:label': node.attributes?.name || node.key,
    // TODO (contributor): map remaining node.attributes to OEO properties
    _stub: true,
  }));

  const edges = (graphologyExport.edges || []).map((edge) => ({
    '@id': `${baseIri}edge/${edge.key || edge.source + '_' + edge.target}`,
    '@type': EDGE_TYPE_TO_OEO_PROPERTY[edge.attributes?.type] || 'oeo:relatedTo',
    'oeo:source': { '@id': `${baseIri}${edge.source}` },
    'oeo:target': { '@id': `${baseIri}${edge.target}` },
    // TODO (contributor): add OEO edge properties
    _stub: true,
  }));

  return {
    '@context': OEO_CONTEXT_STUB,
    '@graph': [...nodes, ...edges],
    _meta: {
      generator: 'cernion-energy-tools/oeo-exporter-stub',
      version: '0.34.1',
      status: 'STUB — not OEO-compliant',
      nodeCount: nodes.length,
      edgeCount: edges.length,
      oeoOntologyRef: 'https://github.com/OpenEnergyPlatform/ontology',
    },
  };
}

/**
 * Serializes the Graphology graph for the export endpoint.
 * Returns raw graph structure + OEO stub side-by-side.
 *
 * @param {import('graphology').Graph} graph - Live Graphology graph instance
 * @param {object} [options]
 * @returns {object} Export payload for the REST endpoint
 */
function exportGraphForOeo(graph, options = {}) {
  const serialized = graph.export();

  let oeoStub = null;
  let oeoError = null;
  try {
    oeoStub = transformToOEO(serialized, options);
  } catch (err) {
    oeoError = { code: err.code, message: err.message };
  }

  return {
    graphology: {
      nodes: serialized.nodes,
      edges: serialized.edges,
      nodeCount: serialized.nodes.length,
      edgeCount: serialized.edges.length,
    },
    oeoStub,
    oeoError,
    _contributor: {
      message: 'Implement transformToOEO() in this file to activate OEO export.',
      guide: 'CONTRIBUTING_SCIENCE.md',
      targetOntology: 'https://github.com/OpenEnergyPlatform/ontology',
      integratesWith: [
        'https://github.com/assume-framework/assume',
        'https://github.com/OpenEnergyPlatform/oeplatform',
      ],
    },
  };
}

module.exports = {
  transformToOEO,
  exportGraphForOeo,
  NODE_TYPE_TO_OEO_CLASS,
  EDGE_TYPE_TO_OEO_PROPERTY,
};
