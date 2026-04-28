'use strict';

const { buildOntologyGraph } = require('../src/cya-ontology-graph');
const { transformToOEO, exportGraphForOeo } = require('../src/oeo-exporter-stub');

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

  beforeAll(() => {
    graph = makeHoeheinoeGraph();
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

  test('exportGraphForOeo: oeoStub is null and oeoError.code is OEO_NOT_IMPLEMENTED', () => {
    const result = exportGraphForOeo(graph);
    expect(result.oeoStub).toBeNull();
    expect(result.oeoError).not.toBeNull();
    expect(result.oeoError.code).toBe('OEO_NOT_IMPLEMENTED');
  });

  test('exportGraphForOeo: _contributor.targetOntology contains OpenEnergyPlatform URL', () => {
    const result = exportGraphForOeo(graph);
    expect(result._contributor.targetOntology).toContain('OpenEnergyPlatform');
  });

  test('transformToOEO: throws Error with code OEO_NOT_IMPLEMENTED', () => {
    const serialized = graph.export();
    expect(() => transformToOEO(serialized)).toThrow(
      expect.objectContaining({ code: 'OEO_NOT_IMPLEMENTED' })
    );
  });
});
