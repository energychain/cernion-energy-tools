'use strict';

const {
  LOCATION_PRECISION,
  MARKET_PARTNER_ROLE,
  resolveLocationFromText,
  buildLocationContextPatch,
  isSufficientForMunicipalPrecheck,
  buildLocationResolutionTrace,
  classifyMarketPartnerRole,
  classifyLocationPrecision,
  extractState,
  inferStateFromPostalCode,
  isCanonicalStateName,
} = require('../src/location-resolution');

// ─── Acceptance Test 1: "74889 Sinsheim" is recognised ───────────────────────

describe('Location Resolution — Acceptance Test 1: PLZ + Gemeinde extraction', () => {
  it('extracts postalCode and municipality from "74889 Sinsheim"', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(result.postalCode).toBe('74889');
    expect(result.municipality).toBe('Sinsheim');
  });

  it('sets precision to MUNICIPALITY for PLZ + city', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(result.precision).toBe(LOCATION_PRECISION.MUNICIPALITY);
  });

  it('sets municipalityResolved = true for PLZ + city', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(result.municipalityResolved).toBe(true);
  });

  it('sets siteCoordinatesMissing = true when no coordinates given', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(result.siteCoordinatesMissing).toBe(true);
  });

  it('locationConfidence is sufficient for communal precheck (≥ 0.7)', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(result.locationConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it('isSufficientForMunicipalPrecheck returns true for PLZ + city', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(isSufficientForMunicipalPrecheck(result)).toBe(true);
  });

  it('evidence array contains postalCode and municipality entries', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    const fields = result.evidence.map((e) => e.field);
    expect(fields).toContain('postalCode');
    expect(fields).toContain('municipality');
  });
});

// ─── Acceptance Test 2: "Bürgermeister von 74889 Sinsheim" ───────────────────

describe('Location Resolution — Acceptance Test 2: Bürgermeister context phrase', () => {
  const phrases = [
    'Ich bin Bürgermeister von 74889 Sinsheim und soll einschätzen, ob Rechenzentrum, PV, BESS und Ladepark angesiedelt werden können.',
    'Als Bürgermeisterin der Stadt 74889 Sinsheim frage ich mich...',
    'Bürgermeister von Sinsheim',
  ];

  it.each(phrases)('extracts municipality from: "%s"', (phrase) => {
    const result = resolveLocationFromText(phrase);
    expect(result.municipality).toMatch(/Sinsheim/i);
  });

  it('extracts postalCode from full mayor phrase', () => {
    const result = resolveLocationFromText(
      'Ich bin Bürgermeister von 74889 Sinsheim und soll einschätzen, ob Rechenzentrum, PV, BESS und Ladepark angesiedelt werden können.'
    );
    expect(result.postalCode).toBe('74889');
    expect(result.municipalityResolved).toBe(true);
  });

  it('buildLocationContextPatch produces usable context keys', () => {
    const resolved = resolveLocationFromText(
      'Ich bin Bürgermeister von 74889 Sinsheim und soll einschätzen, ob Rechenzentrum, PV, BESS und Ladepark angesiedelt werden können.'
    );
    const patch = buildLocationContextPatch(resolved);
    expect(patch.postalCode).toBe('74889');
    expect(patch.municipality).toBe('Sinsheim');
    expect(patch.city).toBe('Sinsheim');
    expect(patch.location).toBe('Sinsheim');
    expect(patch.postleitzahl).toBe('74889');
  });
});

// ─── Acceptance Test 3: Netzbetreiber vs Stadtwerk ───────────────────────────

describe('Location Resolution — Acceptance Test 3: VNB vs Stadtwerk role classification', () => {
  const vnbCases = [
    ['Netze BW GmbH', MARKET_PARTNER_ROLE.VNB],
    ['Bayernwerk Netz GmbH', MARKET_PARTNER_ROLE.VNB],
    ['E.DIS Netz GmbH', MARKET_PARTNER_ROLE.VNB],
    ['Mitnetz Strom', MARKET_PARTNER_ROLE.VNB],
    ['Westnetz GmbH', MARKET_PARTNER_ROLE.VNB],
  ];

  it.each(vnbCases)('classifies "%s" as VNB', (name, expected) => {
    const result = classifyMarketPartnerRole(name);
    expect(result.role).toBe(expected);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  const stadtwerkCases = [
    'Stadtwerke Sinsheim GmbH',
    'Stadtwerke Heidelberg',
    'SW Sinsheim',
    'Stadtwerk Tauberfranken',
  ];

  it.each(stadtwerkCases)('classifies "%s" as Stadtwerk (not VNB)', (name) => {
    const result = classifyMarketPartnerRole(name);
    expect(result.role).toBe(MARKET_PARTNER_ROLE.STADTWERK);
    expect(result.role).not.toBe(MARKET_PARTNER_ROLE.VNB);
  });

  it('classifies Stadtwerke with Netz-subsidiary as Stadtwerk with disambiguation note', () => {
    const result = classifyMarketPartnerRole('Stadtwerke Karlsruhe Netz GmbH');
    expect(result.role).toBe(MARKET_PARTNER_ROLE.STADTWERK);
    expect(result.note).toMatch(/VNB|Netz-Tochter/i);
  });

  const lieferantCases = [
    'E-Werk Vertrieb GmbH',
    'Grundversorger Region Sinsheim',
    'Stromlieferant Baden',
  ];

  it.each(lieferantCases)('classifies "%s" as Lieferant (not VNB)', (name) => {
    const result = classifyMarketPartnerRole(name);
    expect(result.role).toBe(MARKET_PARTNER_ROLE.LIEFERANT);
    expect(result.note).toBeTruthy(); // must have a clarification note
  });

  it('classifies Messstellenbetreiber correctly', () => {
    const result = classifyMarketPartnerRole('Grundzuständiger Messstellenbetreiber AG');
    expect(result.role).toBe(MARKET_PARTNER_ROLE.MESSSTELLENBETREIBER);
    expect(result.note).toMatch(/≠ VNB|Messstellenbetreiber/i);
  });
});

// ─── Acceptance Test 4: Tool failure does not lose location ──────────────────

describe('Location Resolution — Acceptance Test 4: location survives tool failure', () => {
  it('resolveLocationFromText returns location even when called standalone (no tool I/O)', () => {
    // Simulates: location resolved but VNB lookup would fail — location must remain
    const location = resolveLocationFromText('74889 Sinsheim');
    expect(location.municipalityResolved).toBe(true);
    expect(location.postalCode).toBe('74889');
    // No tool is called — location stands on its own
  });

  it('buildLocationContextPatch is non-empty even without VNB data', () => {
    const location = resolveLocationFromText('74889 Sinsheim');
    const patch = buildLocationContextPatch(location);
    // The patch has location fields independent of any VNB lookup
    expect(Object.keys(patch).length).toBeGreaterThan(0);
    expect(patch.postalCode).toBe('74889');
  });
});

// ─── Acceptance Test 5: Site precision upgrade ───────────────────────────────

describe('Location Resolution — Acceptance Test 5: Gewerbegebiet stays approximate, coordinates upgrade to site', () => {
  it('Gewerbegebiet phrase gets approximateHint but stays MUNICIPALITY precision', () => {
    const result = resolveLocationFromText('Gewerbegebiet nahe A6 bei Sinsheim, PLZ 74889');
    expect(result.approximateHint).toMatch(/Gewerbegebiet|nahe/i);
    expect(result.postalCode).toBe('74889');
    // Still MUNICIPALITY because no exact coordinates/address
    expect(result.precision).toBe(LOCATION_PRECISION.MUNICIPALITY);
    expect(result.siteCoordinatesMissing).toBe(true);
  });

  it('Coordinates upgrade precision to SITE', () => {
    const result = resolveLocationFromText('Standort: 49.2456, 8.9734 nahe Sinsheim');
    expect(result.precision).toBe(LOCATION_PRECISION.SITE);
    expect(result.latitude).toBeCloseTo(49.2456, 3);
    expect(result.longitude).toBeCloseTo(8.9734, 3);
    expect(result.siteCoordinatesMissing).toBe(false);
  });

  it('Street address upgrades precision to SITE', () => {
    const result = resolveLocationFromText('Hauptstraße 12, 74889 Sinsheim');
    expect(result.precision).toBe(LOCATION_PRECISION.SITE);
    expect(result.address).toMatch(/Hauptstraße/i);
    expect(result.siteCoordinatesMissing).toBe(false);
  });
});

// ─── Additional unit tests ────────────────────────────────────────────────────

describe('Location Resolution — Unit tests', () => {
  it('extractState: recognises BW / Baden-Württemberg', () => {
    expect(extractState('Raum Baden-Württemberg')).toBe('Baden-Württemberg');
    expect(extractState('BW')).toBe('Baden-Württemberg');
  });

  it('extractState: recognises Thüringen variants', () => {
    expect(extractState('in Thüringen')).toBe('Thüringen');
    expect(extractState('Thueringen')).toBe('Thüringen');
  });

  it('extractState: returns null for unknown text', () => {
    expect(extractState('Berlin')).toBe(null);
  });

  it('classifyLocationPrecision: UNKNOWN when nothing provided', () => {
    expect(classifyLocationPrecision({})).toBe(LOCATION_PRECISION.UNKNOWN);
  });

  it('classifyLocationPrecision: REGION for state only', () => {
    expect(classifyLocationPrecision({ state: 'Bayern' })).toBe(LOCATION_PRECISION.REGION);
  });

  it('classifyLocationPrecision: MUNICIPALITY for postalCode', () => {
    expect(classifyLocationPrecision({ postalCode: '74889' })).toBe(
      LOCATION_PRECISION.MUNICIPALITY
    );
  });

  it('classifyLocationPrecision: SITE for lat/lon', () => {
    expect(classifyLocationPrecision({ latitude: 49.1, longitude: 8.9 })).toBe(
      LOCATION_PRECISION.SITE
    );
  });

  it('buildLocationResolutionTrace: contains required fields', () => {
    const resolved = resolveLocationFromText('74889 Sinsheim');
    const trace = buildLocationResolutionTrace(resolved);
    expect(trace.type).toBe('location_resolution');
    expect(trace.precision).toBe(LOCATION_PRECISION.MUNICIPALITY);
    expect(trace.postalCode).toBe('74889');
    expect(trace.municipality).toBe('Sinsheim');
    expect(trace.municipalityResolved).toBe(true);
    expect(trace.siteCoordinatesMissing).toBe(true);
    expect(Array.isArray(trace.evidenceFields)).toBe(true);
  });

  it('resolveLocationFromText: structured context wins over text extraction', () => {
    const result = resolveLocationFromText('74889 Sinsheim', {
      postalCode: '69256',
      city: 'Mauer',
    });
    expect(result.postalCode).toBe('69256'); // context beats text
    expect(result.municipality).toBe('Mauer');
  });

  it('resolveLocationFromText: handles PLZ-only without city', () => {
    const result = resolveLocationFromText('PLZ 74889');
    expect(result.postalCode).toBe('74889');
    expect(result.municipalityResolved).toBe(true);
    expect(result.municipality).toBeNull();
  });

  it('resolveLocationFromText: returns empty result for unrelated text', () => {
    const result = resolveLocationFromText('Ich möchte CO2 sparen.');
    expect(result.postalCode).toBeNull();
    expect(result.municipality).toBeNull();
    expect(result.municipalityResolved).toBe(false);
    expect(result.precision).toBe(LOCATION_PRECISION.UNKNOWN);
  });

  it('buildLocationContextPatch: empty patch when nothing resolved', () => {
    const result = resolveLocationFromText('Kein Ort genannt hier.');
    const patch = buildLocationContextPatch(result);
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it('classifyMarketPartnerRole: handles empty string gracefully', () => {
    const result = classifyMarketPartnerRole('');
    expect(result.role).toBe(MARKET_PARTNER_ROLE.UNKNOWN);
    expect(result.confidence).toBe(0);
  });
});

// ─── Integration: buildLocationContextPatch feeds consultation bridge ─────────

describe('Location Resolution — Integration: context patch is consultation-bridge ready', () => {
  it('patch keys are compatible with BESS_SCREEN_REQUIRED keys', () => {
    // BESS_SCREEN_REQUIRED checks: ['state', 'bundesland', 'region', 'municipality', 'location', 'postalCode']
    const resolved = resolveLocationFromText('74889 Sinsheim');
    const patch = buildLocationContextPatch(resolved);

    const bessScreenKeys = [
      'state',
      'bundesland',
      'region',
      'municipality',
      'location',
      'postalCode',
    ];
    const hasSomeKey = bessScreenKeys.some((key) =>
      Object.prototype.hasOwnProperty.call(patch, key)
    );
    expect(hasSomeKey).toBe(true);
  });
});

// ─── Bug-regression: Sinsheim state + Schleswig-Holstein false positive ───────

describe('Location Resolution — Bug regression: Sinsheim / Schleswig-Holstein', () => {
  // Acceptance Test 1 (spec): 74889 Sinsheim → correct state
  it('AT1: resolveLocationFromText("74889 Sinsheim") gives state = Baden-Württemberg, NOT Schleswig-Holstein', () => {
    const result = resolveLocationFromText('74889 Sinsheim');
    expect(result.postalCode).toBe('74889');
    expect(result.municipality).toBe('Sinsheim');
    expect(result.state).toBe('Baden-Württemberg');
    expect(result.state).not.toBe('Schleswig-Holstein');
  });

  // Acceptance Test 2 (spec): explicit state + PLZ
  it('AT2: "Sinsheim in Baden-Württemberg, PLZ 74889" gives municipality=Sinsheim, state=Baden-Württemberg', () => {
    const result = resolveLocationFromText('Sinsheim in Baden-Württemberg, PLZ 74889');
    expect(result.municipality).toBe('Sinsheim');
    expect(result.postalCode).toBe('74889');
    expect(result.state).toBe('Baden-Württemberg');
    expect(result.municipality).not.toBe('Baden-Württemberg');
  });

  // Acceptance Test 3 (spec): precision without site coordinates
  it('AT3: mayor phrase gives precision=municipality_resolved, siteCoordinatesMissing=true', () => {
    const result = resolveLocationFromText(
      'Ich bin Bürgermeister von 74889 Sinsheim und soll einschätzen, ob Rechenzentrum, PV, BESS und Ladepark angesiedelt werden können.'
    );
    expect(result.postalCode).toBe('74889');
    expect(result.municipality).toBe('Sinsheim');
    expect(result.state).toBe('Baden-Württemberg');
    expect(result.precision).toBe(LOCATION_PRECISION.MUNICIPALITY);
    expect(result.siteCoordinatesMissing).toBe(true);
    expect(result.municipalityResolved).toBe(true);
  });

  it('extractState does not false-positive on "sinsheim" (regression: sh → Schleswig-Holstein)', () => {
    expect(extractState('sinsheim')).toBeNull();
    expect(extractState('74889 Sinsheim')).toBeNull(); // no text state; PLZ→state via inferStateFromPostalCode
    expect(extractState('Standort Sinsheim')).toBeNull();
  });

  it('extractState does not false-positive on city names containing abbreviations', () => {
    // "ni" in "Nidderau", "he" in "Herne", "st" in "Stadtallendorf", "sl" in "Soltau", "sn" in "Sinsheim"
    expect(extractState('Nidderau')).toBeNull();
    expect(extractState('Herne')).toBeNull();
    expect(extractState('Stadtallendorf')).toBeNull();
  });

  it('extractState correctly identifies state from explicit mention', () => {
    expect(extractState('Standort in Baden-Württemberg')).toBe('Baden-Württemberg');
    expect(extractState('Gebiet NRW')).toBe('Nordrhein-Westfalen');
    expect(extractState('Bundesland SH')).toBe('Schleswig-Holstein');
  });

  it('inferStateFromPostalCode: PLZ 74xxx → Baden-Württemberg', () => {
    expect(inferStateFromPostalCode('74889')).toBe('Baden-Württemberg');
    expect(inferStateFromPostalCode('74072')).toBe('Baden-Württemberg');
  });

  it('inferStateFromPostalCode: PLZ 80xxx → Bayern', () => {
    expect(inferStateFromPostalCode('80331')).toBe('Bayern');
    expect(inferStateFromPostalCode('85049')).toBe('Bayern');
  });

  it('inferStateFromPostalCode: PLZ 99xxx → Thüringen', () => {
    expect(inferStateFromPostalCode('99084')).toBe('Thüringen');
  });

  it('isCanonicalStateName: identifies state names correctly', () => {
    expect(isCanonicalStateName('Bayern')).toBe(true);
    expect(isCanonicalStateName('Baden-Württemberg')).toBe(true);
    expect(isCanonicalStateName('Sachsen')).toBe(true);
    expect(isCanonicalStateName('Sinsheim')).toBe(false);
    expect(isCanonicalStateName('Heidelberg')).toBe(false);
    expect(isCanonicalStateName('')).toBe(false);
  });

  it('municipality is never set to a canonical state name from keyword extraction', () => {
    const result = resolveLocationFromText('Anlage in Baden-Württemberg');
    // "Baden-Württemberg" must NOT be extracted as municipality
    expect(result.municipality).not.toBe('Baden-Württemberg');
  });

  it('buildLocationResolutionTrace: includes nextVerificationSteps', () => {
    const resolved = resolveLocationFromText('74889 Sinsheim');
    const trace = buildLocationResolutionTrace(resolved);
    expect(Array.isArray(trace.nextVerificationSteps)).toBe(true);
    expect(trace.nextVerificationSteps.length).toBeGreaterThan(0);
  });

  it('buildLocationResolutionTrace: includes operator fields when operatorInfo provided', () => {
    const resolved = resolveLocationFromText('74889 Sinsheim');
    const operatorInfo = {
      lookupStatus: 'mastr_asset_fallback',
      candidates: [{ name: 'Netze BW GmbH', confidence: 0.8, source: 'mastr_asset_fallback' }],
      ambiguous: false,
      fallbackUsed: true,
      nextVerificationSteps: ['Formelle Netzanschlussanfrage stellen'],
    };
    const trace = buildLocationResolutionTrace(resolved, null, operatorInfo);
    expect(trace.operatorLookupStatus).toBe('mastr_asset_fallback');
    expect(trace.operatorCandidates).toHaveLength(1);
    expect(trace.fallbackUsed).toBe(true);
    expect(trace.operatorAmbiguous).toBe(false);
  });
});
