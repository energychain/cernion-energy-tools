'use strict';

const {
  OEO_VERSION,
  OEO_BASE_IRI,
  INSTALLATION_TYPES,
  GRID_CONCEPTS,
  VOLTAGE_LEVELS,
  MARKET_TYPES,
  PSR_MAP,
  ENERGY_CONCEPTS,
  GAS_STORAGE_CONCEPTS,
  UNITS,
  DOMAIN_OEO_MAPPINGS,
  byId,
  byIri,
  byCernionType,
  byPsrCode,
  forDomain,
  forDomainResolved,
  allGermanLabels,
  germanLabelsForDomain,
} = require('../src/oeo-mappings');

// ---------------------------------------------------------------------------
// Structural integrity
// ---------------------------------------------------------------------------
describe('oeo-mappings — structural integrity', () => {
  test('OEO_VERSION is a semver-like string', () => {
    expect(OEO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('OEO_BASE_IRI ends with /', () => {
    expect(OEO_BASE_IRI).toBe('https://openenergyplatform.org/ontology/oeo/');
  });

  test('INSTALLATION_TYPES has at least 15 entries', () => {
    expect(INSTALLATION_TYPES.length).toBeGreaterThanOrEqual(15);
  });

  test('every INSTALLATION_TYPES entry has required fields', () => {
    for (const entry of INSTALLATION_TYPES) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('iri');
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('labelDe');
      expect(entry).toHaveProperty('cernionType');
      expect(entry).toHaveProperty('cernionSubtype');
      expect(entry.iri).toMatch(/^https:\/\/openenergyplatform\.org\/ontology\/oeo\/OEO_\d{8}$/);
    }
  });

  test('every GRID_CONCEPTS entry has id, iri, label, labelDe', () => {
    for (const entry of GRID_CONCEPTS) {
      expect(entry.id).toBeTruthy();
      expect(entry.iri).toMatch(/OEO_\d{8}$/);
      expect(entry.label).toBeTruthy();
      expect(entry.labelDe).toBeTruthy();
    }
  });

  test('VOLTAGE_LEVELS maps NS/MS/HS/HöS', () => {
    expect(Object.keys(VOLTAGE_LEVELS)).toEqual(expect.arrayContaining(['NS', 'MS', 'HS', 'HöS']));
    for (const vl of Object.values(VOLTAGE_LEVELS)) {
      expect(vl.iri).toMatch(/OEO_004100\d{2}$/);
      expect(vl.label).toBeTruthy();
    }
  });

  test('MARKET_TYPES maps day-ahead/intraday/futures', () => {
    expect(MARKET_TYPES).toHaveProperty('day-ahead');
    expect(MARKET_TYPES).toHaveProperty('intraday');
    expect(MARKET_TYPES).toHaveProperty('futures');
  });

  test('PSR_MAP covers key ENTSO-E codes', () => {
    const required = ['B01', 'B02', 'B04', 'B05', 'B06', 'B14', 'B16', 'B18', 'B19'];
    for (const code of required) {
      expect(PSR_MAP).toHaveProperty(code);
      expect(PSR_MAP[code].iri).toMatch(/OEO_\d{8}$/);
    }
  });

  test('ENERGY_CONCEPTS has forecast, electricity-demand, co2-emission', () => {
    const ids = ENERGY_CONCEPTS.map((e) => e.id);
    expect(ids).toContain('forecast');
    expect(ids).toContain('electricity-demand');
    expect(ids).toContain('co2-emission');
  });

  test('GAS_STORAGE_CONCEPTS has energy-storage, natural-gas', () => {
    const ids = GAS_STORAGE_CONCEPTS.map((e) => e.id);
    expect(ids).toContain('energy-storage');
    expect(ids).toContain('natural-gas');
  });

  test('UNITS maps kW/MW/MWh/GWh', () => {
    for (const unit of ['kW', 'MW', 'MWh', 'GWh']) {
      expect(UNITS).toHaveProperty(unit);
      expect(UNITS[unit].iri).toMatch(/OEO_\d{8}$/);
    }
  });

  test('no duplicate IDs in INSTALLATION_TYPES', () => {
    const ids = INSTALLATION_TYPES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('no broken IRIs — every IRI uses OEO_BASE_IRI prefix', () => {
    const allEntries = [
      ...INSTALLATION_TYPES,
      ...GRID_CONCEPTS,
      ...ENERGY_CONCEPTS,
      ...GAS_STORAGE_CONCEPTS,
    ];
    for (const entry of allEntries) {
      expect(entry.iri.startsWith(OEO_BASE_IRI)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DOMAIN_OEO_MAPPINGS
// ---------------------------------------------------------------------------
describe('oeo-mappings — DOMAIN_OEO_MAPPINGS', () => {
  test('maps all 14 semantic domain ids', () => {
    const expectedDomains = [
      'metering',
      'grid-assets',
      'grid-incidents',
      'redispatch-queue',
      'mastr-local',
      'procurement',
      'forecast-vs-actual',
      'billing-overview',
      'receivables',
      'mako-process-log',
      'customer-projects',
      'other',
      'metering-point-master',
    ];
    for (const d of expectedDomains) {
      expect(DOMAIN_OEO_MAPPINGS).toHaveProperty(d);
      expect(Array.isArray(DOMAIN_OEO_MAPPINGS[d])).toBe(true);
    }
  });

  test('every mapped IRI is a valid OEO IRI', () => {
    for (const [, iris] of Object.entries(DOMAIN_OEO_MAPPINGS)) {
      for (const classIri of iris) {
        expect(classIri).toMatch(/^https:\/\/openenergyplatform\.org\/ontology\/oeo\/OEO_\d{8}$/);
      }
    }
  });

  test('"other" domain maps to empty array', () => {
    expect(DOMAIN_OEO_MAPPINGS.other).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------
describe('oeo-mappings — helpers', () => {
  test('byId returns entry for known id', () => {
    const solar = byId('solar');
    expect(solar).toBeTruthy();
    expect(solar.label).toBe('solar power unit');
  });

  test('byId returns null for unknown id', () => {
    expect(byId('does-not-exist')).toBeNull();
  });

  test('byIri finds entry by full IRI', () => {
    const solarIri = `${OEO_BASE_IRI}OEO_00000034`;
    const result = byIri(solarIri);
    expect(result).toBeTruthy();
    expect(result.id).toBe('solar');
  });

  test('byIri returns null for unknown IRI', () => {
    expect(byIri('https://example.com/unknown')).toBeNull();
  });

  test('byCernionType returns generic type', () => {
    const wind = byCernionType('wind');
    expect(wind).toBeTruthy();
    expect(wind.id).toBe('wind');
    expect(wind.cernionSubtype).toBeNull();
  });

  test('byCernionType returns sub-type when requested', () => {
    const offshore = byCernionType('wind', 'offshore');
    expect(offshore).toBeTruthy();
    expect(offshore.id).toBe('wind-offshore');
  });

  test('byCernionType falls back to generic if sub-type not found', () => {
    const result = byCernionType('wind', 'nonexistent');
    expect(result).toBeTruthy();
    expect(result.id).toBe('wind');
  });

  test('byCernionType returns null for unknown type', () => {
    expect(byCernionType('flux-capacitor')).toBeNull();
  });

  test('byPsrCode returns OEO entry for B16 (solar)', () => {
    const result = byPsrCode('B16');
    expect(result).toBeTruthy();
    expect(result.label).toBe('solar power unit');
  });

  test('byPsrCode returns null for unknown code', () => {
    expect(byPsrCode('B99')).toBeNull();
  });

  test('forDomain returns IRI array for known domain', () => {
    const iris = forDomain('grid-assets');
    expect(iris.length).toBeGreaterThan(0);
    iris.forEach((i) => expect(i).toMatch(/^https:\/\//));
  });

  test('forDomain returns empty array for unknown domain', () => {
    expect(forDomain('imaginary-domain')).toEqual([]);
  });

  test('forDomainResolved returns objects with iri and label', () => {
    const resolved = forDomainResolved('grid-assets');
    expect(resolved.length).toBeGreaterThan(0);
    for (const entry of resolved) {
      expect(entry).toHaveProperty('iri');
      expect(entry).toHaveProperty('label');
    }
  });

  test('allGermanLabels returns non-empty array of lowercase strings', () => {
    const labels = allGermanLabels();
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) {
      expect(l).toBe(l.toLowerCase());
    }
  });

  test('germanLabelsForDomain returns German labels for grid-assets', () => {
    const labels = germanLabelsForDomain('grid-assets');
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('stromnetz');
  });

  test('germanLabelsForDomain returns empty for unknown domain', () => {
    expect(germanLabelsForDomain('nope')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-validation: PSR_MAP entries match INSTALLATION_TYPES where applicable
// ---------------------------------------------------------------------------
describe('oeo-mappings — cross-validation', () => {
  test('PSR_MAP IRIs for solar/wind match INSTALLATION_TYPES', () => {
    const solarPsr = PSR_MAP.B16;
    const solarType = INSTALLATION_TYPES.find((e) => e.id === 'solar');
    expect(solarPsr.iri).toBe(solarType.iri);

    const windOnPsr = PSR_MAP.B19;
    const windOnType = INSTALLATION_TYPES.find((e) => e.id === 'wind-onshore');
    expect(windOnPsr.iri).toBe(windOnType.iri);
  });
});
