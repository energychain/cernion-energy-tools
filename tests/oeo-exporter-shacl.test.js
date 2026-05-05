'use strict';

const Graph = require('graphology');
const { DataFactory, Parser, Store } = require('n3');
const { buildOntologyGraph } = require('../src/cya-ontology-graph');
const { getOeoContext } = require('../src/oeo-context');
const { transformToOEO } = require('../src/oeo-exporter-stub');

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_DECIMAL = 'http://www.w3.org/2001/XMLSchema#decimal';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

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

function expandTerm(term, context) {
  if (term.startsWith('http://') || term.startsWith('https://')) return term;
  if (term === '@type') return RDF_TYPE;

  const [prefix, localName] = term.split(':');
  const base = context[prefix];
  if (!base) {
    throw new Error(`Cannot expand term '${term}'`);
  }
  return `${base}${localName}`;
}

function literalForValue(value) {
  if (typeof value === 'number') {
    const dataType = Number.isInteger(value) ? XSD_INTEGER : XSD_DECIMAL;
    return literal(String(value), namedNode(dataType));
  }

  return literal(String(value), namedNode(XSD_STRING));
}

function jsonLdToStore(document) {
  const context = document['@context'];
  const store = new Store();

  for (const entry of document['@graph']) {
    const subject = namedNode(entry['@id']);
    const types = Array.isArray(entry['@type']) ? entry['@type'] : [entry['@type']];

    for (const type of types) {
      store.addQuad(quad(subject, namedNode(RDF_TYPE), namedNode(expandTerm(type, context))));
    }

    for (const [key, value] of Object.entries(entry)) {
      if (key === '@id' || key === '@type') continue;

      const predicate = namedNode(expandTerm(key, context));
      const values = Array.isArray(value) ? value : [value];

      for (const item of values) {
        if (item && typeof item === 'object' && item['@id']) {
          store.addQuad(quad(subject, predicate, namedNode(item['@id'])));
        } else {
          store.addQuad(quad(subject, predicate, literalForValue(item)));
        }
      }
    }
  }

  return store;
}

const SHAPES_TURTLE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix oeo: <https://openenergyplatform.org/ontology/oeo/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

oeo:PowerPlantShape a sh:NodeShape ;
  sh:targetClass oeo:PowerPlant ;
  sh:property [ sh:path rdfs:label ; sh:minCount 1 ] ;
  sh:property [ sh:path oeo:connectedTo ; sh:minCount 1 ] ;
  sh:property [ sh:path oeo:locatedIn ; sh:minCount 1 ] .

oeo:GridConnectionPointShape a sh:NodeShape ;
  sh:targetClass oeo:GridConnectionPoint ;
  sh:property [ sh:path rdfs:label ; sh:minCount 1 ] .

oeo:GridOperatorShape a sh:NodeShape ;
  sh:targetClass oeo:GridOperator ;
  sh:property [ sh:path rdfs:label ; sh:minCount 1 ] ;
  sh:property [ sh:path oeo:responsibleFor ; sh:minCount 1 ] .

oeo:GeographicRegionShape a sh:NodeShape ;
  sh:targetClass oeo:GeographicRegion ;
  sh:property [ sh:path rdfs:label ; sh:minCount 1 ] .
`;

describe('oeo exporter SHACL validation', () => {
  let rdf;
  let SHACLValidator;

  beforeAll(async () => {
    rdf = (await import('@zazuko/env-node')).default;
    SHACLValidator = (await import('rdf-validate-shacl')).default;
  });

  test('Höheinöd export passes SHACL validation', async () => {
    const graph = makeHoeheinoeGraph();
    const document = transformToOEO(graph.export());
    const dataStore = jsonLdToStore(document);
    const shapeStore = new Store(new Parser().parse(SHAPES_TURTLE));
    const validator = new SHACLValidator(shapeStore, { factory: rdf });

    const report = await validator.validate(dataStore);
    expect(report.conforms).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  test('empty export also passes SHACL validation', async () => {
    const emptyGraph = new Graph({ type: 'directed' });
    const emptyDocument = {
      '@context': getOeoContext(),
      '@graph': [],
    };
    const dataStore = jsonLdToStore(emptyDocument);
    const shapeStore = new Store(new Parser().parse(SHAPES_TURTLE));
    const validator = new SHACLValidator(shapeStore, { factory: rdf });

    expect(transformToOEO(emptyGraph.export())['@graph']).toEqual([]);
    const report = await validator.validate(dataStore);
    expect(report.conforms).toBe(true);
  });
});
