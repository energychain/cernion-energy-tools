'use strict';

const { OEO_VERSION, OEO_BASE_IRI } = require('./oeo-mappings');

const OEO_VERSION_IRI = `https://github.com/OpenEnergyPlatform/ontology/releases/tag/v${OEO_VERSION}`;

function getOeoContext() {
  return {
    '@version': 1.1,
    oeo: OEO_BASE_IRI,
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    geo: 'http://www.w3.org/2003/01/geo/wgs84_pos#',
    mastr: 'https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/',
  };
}

module.exports = {
  OEO_VERSION,
  OEO_BASE_IRI,
  OEO_VERSION_IRI,
  getOeoContext,
};
