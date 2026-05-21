'use strict';

const Graph = require('graphology');
const { buildOntologyGraph } = require('../src/cya-ontology-graph');
const { getOeoContext } = require('../src/oeo-context');
const {
  buildOeoExport,
  transformToOEO,
  exportGraphForOeo,
  NODE_TYPE_TO_OEO_CLASS,
  EDGE_TYPE_TO_OEO_PROPERTY,
} = require('../src/oeo-exporter-stub');

// ── Höheinöd fixture ────────────────────────────────────────────────────────

function makeHoeheinoeGraph() {
  const installations = [
    {
      EinheitMastrNummer: 'SEE999952467552',
      EinheitName: 'PV Höheinöd Demo',
      Bruttoleistung: 2103.7,
      Technologie: 'Solarenergie',
      InbetriebnahmeDatum: '2009-01-01',
      EinheitBetriebsstatus: 'InBetrieb',
      Postleitzahl: '66989',
      Gemeinde: 'Höheinöd',
      Laengengrad: 7.6333,
      Breitengrad: 49.2167,
      NetzbetreiberMastrNummer: 'SNB_PFALZ_001',
      Netzbetreiber: 'Pfalzwerke Netz AG',
      NetzanschlusspunktMastrNummer: 'NAP_HOEHEINOED_001',
    },
  ];
  return buildOntologyGraph(installations, null);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('oeo-exporter-stub', () => {
  let graph;
  let serialized;

  beforeAll(() => {
    graph = makeHoeheinoeGraph();
    serialized = graph.export();
  });

  test('exportGraphForOeo: returns graphology.nodes and graphology.edges', () => {
    const result = exportGraphForOeo(graph);
    expect(result).toHaveProperty('graphology');
    expect(Array.isArray(result.graphology.nodes)).toBe(true);
    expect(Array.isArray(result.graphology.edges)).toBe(true);
  });

  test('exportGraphForOeo: nodeCount and edgeCount match array lengths', () => {
    const result = exportGraphForOeo(graph);
    expect(result.graphology.nodeCount).toBe(result.graphology.nodes.length);
    expect(result.graphology.edgeCount).toBe(result.graphology.edges.length);
  });

  test('exportGraphForOeo: returns productive oeo payload without oeoError', () => {
    const result = exportGraphForOeo(graph);
    expect(result.oeo).toBeDefined();
    expect(result.oeoError).toBeUndefined();
    expect(result.validationSummary.status).toBe('ok');
  });

  test('exportGraphForOeo: _meta.targetOntology contains OpenEnergyPlatform URL', () => {
    const result = exportGraphForOeo(graph);
    expect(result._meta.targetOntology).toContain('OpenEnergyPlatform');
  });

  test('transformToOEO: returns central @context and @graph', () => {
    const result = transformToOEO(serialized);
    expect(result['@context']).toEqual(getOeoContext());
    expect(Array.isArray(result['@graph'])).toBe(true);
  });

  test('buildOeoExport: returns pinned OEO version metadata', () => {
    const result = buildOeoExport(serialized);
    expect(result.oeoVersion).toBe('2.11.0');
    expect(result.oeoVersionIri).toContain('/releases/tag/v2.11.0');
  });

  test('NODE_TYPE_TO_OEO_CLASS maps required graph node types', () => {
    expect(NODE_TYPE_TO_OEO_CLASS).toMatchObject({
      INSTALLATION: 'oeo:PowerPlant',
      NAP: 'oeo:GridConnectionPoint',
      SUBSTATION: 'oeo:Substation',
      VNB: 'oeo:GridOperator',
      REGION: 'oeo:GeographicRegion',
    });
  });

  test('EDGE_TYPE_TO_OEO_PROPERTY maps required graph edge types', () => {
    expect(EDGE_TYPE_TO_OEO_PROPERTY).toMatchObject({
      VERBUNDEN_MIT: 'oeo:connectedTo',
      LIEGT_IN: 'oeo:locatedIn',
      BETRIEBEN_VON: 'oeo:operatedBy',
      ZUSTAENDIG_FUER: 'oeo:responsibleFor',
    });
  });

  test('transformToOEO: INSTALLATION maps to PowerPlant plus photovoltaic subclass', () => {
    const result = transformToOEO(serialized);
    const installation = result['@graph'].find(
      (entry) => entry['mastr:mastrNummer'] === 'SEE999952467552'
    );
    expect(installation['@type']).toEqual(
      expect.arrayContaining(['oeo:PowerPlant', 'oeo:PhotovoltaicPlant'])
    );
  });

  test('transformToOEO: NAP maps to GridConnectionPoint', () => {
    const result = transformToOEO(serialized);
    const napNode = result['@graph'].find((entry) =>
      entry['@id'].includes('NAP:NAP_HOEHEINOED_001')
    );
    expect(napNode['@type']).toEqual(expect.arrayContaining(['oeo:GridConnectionPoint']));
  });

  test('transformToOEO: INSTALLATION contains connectedTo reference', () => {
    const result = transformToOEO(serialized);
    const installation = result['@graph'].find(
      (entry) => entry['mastr:mastrNummer'] === 'SEE999952467552'
    );
    expect(installation['oeo:connectedTo']).toEqual(
      expect.objectContaining({ '@id': expect.stringContaining('NAP:NAP_HOEHEINOED_001') })
    );
  });

  test('transformToOEO: INSTALLATION contains locatedIn reference', () => {
    const result = transformToOEO(serialized);
    const installation = result['@graph'].find(
      (entry) => entry['mastr:mastrNummer'] === 'SEE999952467552'
    );
    expect(installation['oeo:locatedIn']).toEqual(
      expect.objectContaining({ '@id': expect.stringContaining('REGION:66989') })
    );
  });

  test('transformToOEO: VNB contains responsibleFor reference', () => {
    const result = transformToOEO(serialized);
    const vnbNode = result['@graph'].find((entry) => entry['@id'].includes('VNB:SNB_PFALZ_001'));
    expect(vnbNode['oeo:responsibleFor']).toEqual(
      expect.objectContaining({ '@id': expect.stringContaining('REGION:66989') })
    );
  });

  test('buildOeoExport: unknown node type produces warning and validation summary', () => {
    const customGraph = graph.export();
    customGraph.nodes.push({
      key: 'CUSTOM:1',
      attributes: { nodeType: 'CUSTOM_ASSET', name: 'Custom Asset' },
    });

    const result = buildOeoExport(customGraph);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OEO_UNKNOWN_NODE_TYPE' })])
    );
    expect(result.validationSummary.unknownNodeTypes).toBe(1);
  });

  test('buildOeoExport: unknown edge type produces warning and validation summary', () => {
    const customGraph = graph.export();
    customGraph.edges.push({
      source: customGraph.nodes[0].key,
      target: customGraph.nodes[1].key,
      attributes: { edgeType: 'CUSTOM_LINK' },
    });

    const result = buildOeoExport(customGraph);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OEO_UNKNOWN_EDGE_TYPE' })])
    );
    expect(result.validationSummary.unknownEdgeTypes).toBe(1);
  });

  test('buildOeoExport: empty graph is valid and warning-free', () => {
    const emptyGraph = new Graph({ type: 'directed' });
    const result = exportGraphForOeo(emptyGraph);
    expect(result.oeo['@graph']).toEqual([]);
    expect(result.validationSummary).toMatchObject({
      totalNodes: 0,
      totalEdges: 0,
      warningCount: 0,
      hasWarnings: false,
    });
  });

  test('exportGraphForOeo: custom baseIri is reflected in output', () => {
    const result = exportGraphForOeo(graph, { baseIri: 'https://example.org/cernion/' });
    expect(result.oeo['@graph'][0]['@id']).toContain('https://example.org/cernion/');
  });

  test('exportGraphForOeo: unsupported OEO version throws explicit error', () => {
    expect(() => exportGraphForOeo(graph, { oeoVersion: '9.9.9' })).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_OEO_VERSION' })
    );
  });
});
