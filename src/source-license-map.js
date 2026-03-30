'use strict';

/**
 * source-license-map.js — Action prefix → human-readable source metadata
 *
 * Maps Moleculer action name prefixes to a human-readable title, REST path,
 * and default license for use in OEMetadata v2.0 `sources` and `licenses`
 * fields.
 *
 * License identifiers follow SPDX and Open Definition conventions.
 *
 * @see https://github.com/OpenEnergyPlatform/oemetadata (OEMetadata v2.0)
 */

const SOURCE_LICENSE_MAP = {
  // MaStR-backed sources (Marktstammdatenregister)
  'assets': {
    title: 'Marktstammdatenregister (MaStR) — Installation Data',
    path: '/api/assets',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Ensure proper attribution to the Marktstammdatenregister (MaStR), Bundesnetzagentur.',
      },
    ],
  },
  'energy-market': {
    title: 'Marktstammdatenregister (MaStR) — Energy Market Data',
    path: '/api/energy-market',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Ensure proper attribution to the Marktstammdatenregister (MaStR), Bundesnetzagentur.',
      },
    ],
  },
  'grid-operations': {
    title: 'BDEW / MaStR — Grid Operations & Market Partners',
    path: '/api/grid-operations',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Ensure proper attribution to the Marktstammdatenregister (MaStR), Bundesnetzagentur.',
      },
    ],
  },

  // ENTSO-E sources
  'entsoe': {
    title: 'ENTSO-E Transparency Platform — European Power System Data',
    path: '/api/entsoe',
    licenses: [
      {
        name: 'CC-BY-4.0',
        title: 'Creative Commons Attribution 4.0 International',
        path: 'https://creativecommons.org/licenses/by/4.0/',
        instruction: 'Credit ENTSO-E as the data source. See https://transparency.entsoe.eu/content/static_content/Static%20content/terms%20and%20conditions/terms%20and%20conditions.html',
      },
    ],
  },
  'forecast': {
    title: 'ENTSO-E / Cernion — Energy Forecast Data',
    path: '/api/forecast',
    licenses: [
      {
        name: 'CC-BY-4.0',
        title: 'Creative Commons Attribution 4.0 International',
        path: 'https://creativecommons.org/licenses/by/4.0/',
        instruction: 'Credit ENTSO-E as the data source for forecast inputs.',
      },
    ],
  },
  'residual-load': {
    title: 'ENTSO-E / Cernion — Residual Load Analysis',
    path: '/api/residual-load',
    licenses: [
      {
        name: 'CC-BY-4.0',
        title: 'Creative Commons Attribution 4.0 International',
        path: 'https://creativecommons.org/licenses/by/4.0/',
        instruction: 'Credit ENTSO-E as the data source for generation and load data.',
      },
    ],
  },

  // Gas storage (AGSI/GIE)
  'gas-storage': {
    title: 'GIE AGSI+ — European Gas Storage Data',
    path: '/api/gas-storage',
    licenses: [
      {
        name: 'CC-BY-4.0',
        title: 'Creative Commons Attribution 4.0 International',
        path: 'https://creativecommons.org/licenses/by/4.0/',
        instruction: 'Credit Gas Infrastructure Europe (GIE) AGSI+ as the data source.',
      },
    ],
  },

  // German grid / spot prices
  'german-grid': {
    title: 'EPEX SPOT / Bundesnetzagentur — German Grid & Spot Prices',
    path: '/api/german-grid',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Ensure proper attribution to Bundesnetzagentur and EPEX SPOT SE.',
      },
    ],
  },

  // EWK / grid operator benchmarks
  'ewk-monitoring': {
    title: 'EWK / Bundesnetzagentur — Grid Operator Benchmarking',
    path: '/api/ewk-monitoring',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Ensure proper attribution to Bundesnetzagentur (EWK benchmarking data).',
      },
    ],
  },

  // OpenStreetMap-based sources
  'osm-geo': {
    title: 'OpenStreetMap — Physical Grid Infrastructure (via Overpass API)',
    path: '/api/osm-geo',
    licenses: [
      {
        name: 'ODbL-1.0',
        title: 'Open Data Commons Open Database License 1.0',
        path: 'https://opendatacommons.org/licenses/odbl/',
        instruction: '© OpenStreetMap contributors. This data is made available under the Open Database License (ODbL). Any rights in individual contents of the database are licensed under the Database Contents License.',
      },
    ],
  },

  // Open Energy Platform
  'oep': {
    title: 'Open Energy Platform (OEP) — Research & Scenario Data',
    path: '/api/oep',
    licenses: [
      {
        name: 'CC-BY-4.0',
        title: 'Creative Commons Attribution 4.0 International',
        path: 'https://creativecommons.org/licenses/by/4.0/',
        instruction: 'Credit the Open Energy Platform (openenergyplatform.org) and the original dataset authors. Individual tables may carry different licenses — check table metadata.',
      },
    ],
  },

  // VNB monitor
  'vnb-monitor': {
    title: 'VNB Monitor — Grid Operator KPI Snapshot',
    path: '/api/vnb-monitor',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Ensure proper attribution to Bundesnetzagentur (MaStR and EWK data sources).',
      },
    ],
  },

  // Inhouse / datasource cache (operator-supplied data)
  'datasource-cache': {
    title: 'Inhouse Datasource — Operator-supplied Data',
    path: '/api/datasource-cache',
    licenses: [
      {
        name: 'proprietary',
        title: 'Proprietary — All Rights Reserved',
        path: null,
        instruction: 'This data is operator-supplied. Usage rights are defined by the data owner.',
      },
    ],
  },
  'in-memory-join': {
    title: 'Cernion In-Memory Join — Cross-source Analytics',
    path: '/api/in-memory-join',
    licenses: [
      {
        name: 'DL-DE/BY-2.0',
        title: 'Data licence Germany – attribution – Version 2.0',
        path: 'https://www.govdata.de/dl-de/by-2-0',
        instruction: 'Attribution required for underlying data sources (MaStR, ENTSO-E, operator data).',
      },
    ],
  },
};

/**
 * Default license when no specific mapping exists.
 */
const DEFAULT_LICENSE = {
  name: 'DL-DE/BY-2.0',
  title: 'Data licence Germany – attribution – Version 2.0',
  path: 'https://www.govdata.de/dl-de/by-2-0',
  instruction: 'Ensure proper attribution to the original data sources.',
};

/**
 * Resolve source metadata for a Moleculer action name.
 * Falls back to the action prefix (service name) and default license.
 *
 * @param {string} actionName - e.g. 'assets.solar', 'grid-operations.marketPartners'
 * @returns {{ title: string, path: string, licenses: object[] }}
 */
function resolveSourceMeta(actionName) {
  if (!actionName || typeof actionName !== 'string') {
    return { title: 'Unknown Source', path: null, licenses: [DEFAULT_LICENSE] };
  }

  const prefix = actionName.split('.')[0];
  const entry = SOURCE_LICENSE_MAP[prefix];

  if (entry) {
    return { ...entry };
  }

  // Fallback: generate a readable title from the service name
  const humanTitle = prefix
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    title: `${humanTitle} — Cernion Energy Tools`,
    path: `/api/${prefix}`,
    licenses: [DEFAULT_LICENSE],
  };
}

/**
 * Collect unique licenses from a list of source entries.
 * Deduplicates by license name.
 *
 * @param {object[]} sources - array from buildOEMetadata sources field
 * @returns {object[]}
 */
function collectUniqueLicenses(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    for (const lic of source.licenses || []) {
      if (!seen.has(lic.name)) {
        seen.add(lic.name);
        result.push(lic);
      }
    }
  }
  if (result.length === 0) {
    result.push(DEFAULT_LICENSE);
  }
  return result;
}

module.exports = {
  SOURCE_LICENSE_MAP,
  DEFAULT_LICENSE,
  resolveSourceMeta,
  collectUniqueLicenses,
};
