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

const { version: packageVersion } = require('../package.json');
const { OEO_VERSION, OEO_VERSION_IRI, getOeoContext } = require('./oeo-context');

const OEO_EXPORTER_RELEASE = '0.42.0';
const DEFAULT_BASE_IRI = 'https://cernion.example/graph/';

/**
 * Node-type → OEO class mapping stub.
 * Each entry is a placeholder — replace with verified OEO IRIs.
 *
 * @see https://github.com/OpenEnergyPlatform/ontology/tree/dev/src/imports
 */
const NODE_TYPE_TO_OEO_CLASS = {
  INSTALLATION: 'oeo:PowerPlant',
  NAP: 'oeo:GridConnectionPoint',
  SUBSTATION: 'oeo:Substation',
  VNB: 'oeo:GridOperator',
  REGION: 'oeo:GeographicRegion',
  UNKNOWN: 'oeo:EnergyAsset',
};

/**
 * Edge-type → OEO object property mapping stub.
 */
const EDGE_TYPE_TO_OEO_PROPERTY = {
  VERBUNDEN_MIT: 'oeo:connectedTo',
  LIEGT_IN: 'oeo:locatedIn',
  BETRIEBEN_VON: 'oeo:operatedBy',
  ZUSTAENDIG_FUER: 'oeo:responsibleFor',
  UNKNOWN: 'oeo:relatedTo',
};

const TECHNOLOGY_TO_OEO_SUBCLASS = [
  { match: /solar|pv|photovolta/i, type: 'oeo:PhotovoltaicPlant' },
  { match: /wind/i, type: 'oeo:WindPowerPlant' },
  { match: /bio|biogas|biomass/i, type: 'oeo:BiomassPowerPlant' },
  { match: /wasser|hydro/i, type: 'oeo:HydroPowerPlant' },
  { match: /speicher|storage|battery|batterie/i, type: 'oeo:EnergyStorageObject' },
  { match: /gas|coal|lignite|oil|combustion|verbrennung/i, type: 'oeo:CombustionPowerPlant' },
];

function createExporterError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, details);
  return err;
}

function ensureSupportedVersion(requestedVersion) {
  if (requestedVersion && requestedVersion !== OEO_VERSION) {
    throw createExporterError(
      'UNSUPPORTED_OEO_VERSION',
      `Unsupported OEO version '${requestedVersion}'. This release pins OEO ${OEO_VERSION}.`,
      { supportedVersion: OEO_VERSION, supportedVersionIri: OEO_VERSION_IRI }
    );
  }
  return OEO_VERSION;
}

function normalizeNodeType(attributes = {}) {
  return attributes.nodeType || attributes.type || 'UNKNOWN';
}

function normalizeEdgeType(attributes = {}) {
  return attributes.edgeType || attributes.type || 'UNKNOWN';
}

function detectInstallationSubclass(attributes = {}) {
  const technology = [attributes.technologie, attributes.Technologie, attributes.EnergieTraeger]
    .filter(Boolean)
    .join(' ');

  const match = TECHNOLOGY_TO_OEO_SUBCLASS.find((entry) => entry.match.test(technology));
  return match ? match.type : null;
}

function makeNodeWarning(nodeKey, nodeType) {
  return {
    code: 'OEO_UNKNOWN_NODE_TYPE',
    severity: 'warning',
    message: `Unknown node type '${nodeType}' mapped to fallback class '${NODE_TYPE_TO_OEO_CLASS.UNKNOWN}'.`,
    nodeKey,
    nodeType,
  };
}

function makeEdgeWarning(edgeKey, edgeType) {
  return {
    code: 'OEO_UNKNOWN_EDGE_TYPE',
    severity: 'warning',
    message: `Unknown edge type '${edgeType}' mapped to fallback property '${EDGE_TYPE_TO_OEO_PROPERTY.UNKNOWN}'.`,
    edgeKey,
    edgeType,
  };
}

function addReference(subject, property, targetId) {
  if (!subject[property]) {
    subject[property] = { '@id': targetId };
    return;
  }

  if (!Array.isArray(subject[property])) {
    subject[property] = [subject[property]];
  }

  subject[property].push({ '@id': targetId });
}

function buildNodeDocument(node, baseIri, warnings) {
  const attributes = node.attributes || {};
  const nodeType = normalizeNodeType(attributes);
  const mappedClass = NODE_TYPE_TO_OEO_CLASS[nodeType] || NODE_TYPE_TO_OEO_CLASS.UNKNOWN;
  const oeoTypes = [mappedClass];

  if (!NODE_TYPE_TO_OEO_CLASS[nodeType]) {
    warnings.push(makeNodeWarning(node.key, nodeType));
  }

  if (nodeType === 'INSTALLATION') {
    const subclass = detectInstallationSubclass(attributes);
    if (subclass && !oeoTypes.includes(subclass)) {
      oeoTypes.push(subclass);
    }
  }

  const document = {
    '@id': `${baseIri}${node.key}`,
    '@type': oeoTypes,
    'rdfs:label': attributes.name || attributes.gemeinde || attributes.bezeichnung || node.key,
  };

  if (attributes.mastrNummer) document['mastr:mastrNummer'] = attributes.mastrNummer;
  if (attributes.technologie) document['mastr:technologie'] = attributes.technologie;
  if (attributes.leistungKw != null) document['mastr:leistungKw'] = attributes.leistungKw;
  if (attributes.ibJahr != null) document['mastr:inbetriebnahmeJahr'] = attributes.ibJahr;
  if (attributes.status != null) document['mastr:betriebsstatus'] = attributes.status;
  if (attributes.plz != null) document['mastr:postleitzahl'] = attributes.plz;
  if (attributes.bdewCode) document['mastr:bdewCode'] = attributes.bdewCode;
  if (attributes.spannungsebene) document['mastr:spannungsebene'] = attributes.spannungsebene;
  if (attributes.koordinaten?.lat != null) document['geo:lat'] = attributes.koordinaten.lat;
  if (attributes.koordinaten?.lon != null) document['geo:long'] = attributes.koordinaten.lon;

  return document;
}

function summarizeValidation({ graphologyExport, warnings, mappedNodes, mappedEdges }) {
  const nodeWarnings = warnings.filter((warning) => warning.code === 'OEO_UNKNOWN_NODE_TYPE').length;
  const edgeWarnings = warnings.filter((warning) => warning.code === 'OEO_UNKNOWN_EDGE_TYPE').length;

  return {
    status: warnings.length > 0 ? 'warning' : 'ok',
    totalNodes: graphologyExport.nodes.length,
    totalEdges: graphologyExport.edges.length,
    mappedNodes,
    mappedEdges,
    unknownNodeTypes: nodeWarnings,
    unknownEdgeTypes: edgeWarnings,
    warningCount: warnings.length,
    hasWarnings: warnings.length > 0,
  };
}

function validateGraphologyExport(graphologyExport) {
  if (!graphologyExport || !Array.isArray(graphologyExport.nodes) || !Array.isArray(graphologyExport.edges)) {
    throw createExporterError(
      'OEO_INVALID_GRAPH_EXPORT',
      'transformToOEO expects a Graphology export with nodes[] and edges[].'
    );
  }
}

function buildOeoExport(graphologyExport, options = {}) {
  validateGraphologyExport(graphologyExport);

  const baseIri = options.baseIri || DEFAULT_BASE_IRI;
  const oeoVersion = ensureSupportedVersion(options.oeoVersion);
  const warnings = [];
  const nodeDocs = new Map();
  let mappedNodes = 0;
  let mappedEdges = 0;

  for (const node of graphologyExport.nodes) {
    const document = buildNodeDocument(node, baseIri, warnings);
    nodeDocs.set(node.key, document);
    mappedNodes += 1;
  }

  for (const edge of graphologyExport.edges) {
    const edgeType = normalizeEdgeType(edge.attributes || {});
    const property = EDGE_TYPE_TO_OEO_PROPERTY[edgeType] || EDGE_TYPE_TO_OEO_PROPERTY.UNKNOWN;
    const source = nodeDocs.get(edge.source);
    const target = nodeDocs.get(edge.target);

    if (!source || !target) {
      throw createExporterError(
        'OEO_INVALID_EDGE_REFERENCE',
        `Edge '${edge.key || `${edge.source}_${edge.target}`}' references a missing source or target node.`
      );
    }

    if (!EDGE_TYPE_TO_OEO_PROPERTY[edgeType]) {
      warnings.push(makeEdgeWarning(edge.key || `${edge.source}_${edge.target}`, edgeType));
    }

    addReference(source, property, target['@id']);
    mappedEdges += 1;
  }

  const oeo = {
    '@context': getOeoContext(),
    '@graph': Array.from(nodeDocs.values()),
  };

  return {
    oeo,
    warnings,
    validationSummary: summarizeValidation({ graphologyExport, warnings, mappedNodes, mappedEdges }),
    oeoVersion,
    oeoVersionIri: OEO_VERSION_IRI,
    generator: `cernion-energy-tools/${packageVersion}`,
    exporterRelease: OEO_EXPORTER_RELEASE,
    baseIri,
  };
}

/**
 * Transforms a serialized Graphology graph into a JSON-LD skeleton.
 *
 * CURRENT STATUS: Returns a productive JSON-LD graph with pinned OEO versioning,
 * class/property mappings and validation performed during transformation.
 *
 * @param {object} graphologyExport - Output of graph.export() from Graphology
 * @param {object} [options]
 * @param {string} [options.baseIri] - Base IRI for generated node identifiers
 * @param {string} [options.oeoVersion] - Requested OEO version. Must match the
 *   release-pinned OEO version.
 * @returns {object} JSON-LD document
 */
function transformToOEO(graphologyExport, options = {}) {
  return buildOeoExport(graphologyExport, options).oeo;
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

  const exportPayload = buildOeoExport(serialized, options);

  return {
    graphology: {
      nodes: serialized.nodes,
      edges: serialized.edges,
      nodeCount: serialized.nodes.length,
      edgeCount: serialized.edges.length,
    },
    oeo: exportPayload.oeo,
    warnings: exportPayload.warnings,
    validationSummary: exportPayload.validationSummary,
    oeoVersion: exportPayload.oeoVersion,
    oeoVersionIri: exportPayload.oeoVersionIri,
    _meta: {
      baseIri: exportPayload.baseIri,
      generator: exportPayload.generator,
      exporterRelease: exportPayload.exporterRelease,
      targetOntology: 'https://github.com/OpenEnergyPlatform/ontology',
      shaclReady: true,
    },
  };
}

module.exports = {
  OEO_EXPORTER_RELEASE,
  buildOeoExport,
  transformToOEO,
  exportGraphForOeo,
  NODE_TYPE_TO_OEO_CLASS,
  EDGE_TYPE_TO_OEO_PROPERTY,
};
