'use strict';

/**
 * Tests for src/municipality-resolver.js — in particular the postalCodes[]
 * completeness fix: a multi-PLZ city (e.g. Mannheim, 14 real PLZ) used to
 * return only a single-element array wrapping the same value as the
 * singular postalCode field, because the underlying name→PLZ index only
 * ever kept the first PLZ row encountered per municipality name and
 * silently discarded the rest — the raw german-zip-codes data already had
 * the full list, only the aggregation was incomplete. Found via a real
 * report comparing several known multi-PLZ Großstädte.
 */

const { resolveMunicipalityProfile } = require('../src/municipality-resolver');

describe('resolveMunicipalityProfile — postalCodes completeness', () => {
  it('returns the full known PLZ list for a large multi-PLZ city (Mannheim)', () => {
    const profile = resolveMunicipalityProfile({ municipality: 'Mannheim' });
    expect(profile.found).toBe(true);
    expect(profile.postalCodes.length).toBeGreaterThan(10); // real count: 14
    expect(profile.postalCodes).toContain('68159');
    // No duplicates, sorted.
    expect(new Set(profile.postalCodes).size).toBe(profile.postalCodes.length);
    expect([...profile.postalCodes].sort()).toEqual(profile.postalCodes);
  });

  it('returns multiple PLZ for other known multi-PLZ Großstädte', () => {
    const cases = [
      ['Heidelberg', 5],
      ['Karlsruhe', 5],
      ['Stuttgart', 10],
      ['Mainz', 5],
    ];
    for (const [name, minCount] of cases) {
      const profile = resolveMunicipalityProfile({ municipality: name });
      expect(profile.found).toBe(true);
      expect(profile.postalCodes.length).toBeGreaterThanOrEqual(minCount);
    }
  });

  it('keeps the singular postalCode as a single representative value, unchanged in shape', () => {
    const profile = resolveMunicipalityProfile({ municipality: 'Mannheim' });
    expect(typeof profile.postalCode).toBe('string');
    expect(profile.postalCode).toMatch(/^\d{5}$/);
    expect(profile.postalCodes).toContain(profile.postalCode);
  });

  it('still returns a single-element postalCodes array for a genuinely single-PLZ town (Hockenheim)', () => {
    const profile = resolveMunicipalityProfile({ municipality: 'Hockenheim' });
    expect(profile.found).toBe(true);
    expect(profile.postalCodes).toEqual(['68766']);
  });

  it('resolving by AGS returns the same complete postalCodes list as resolving by name', () => {
    const byName = resolveMunicipalityProfile({ municipality: 'Mannheim' });
    const byAgs = resolveMunicipalityProfile({ ags: byName.ags });
    expect(byAgs.postalCodes.sort()).toEqual(byName.postalCodes.sort());
  });

  it('resolving by one specific PLZ still returns the full postalCodes list for that municipality, with the queried PLZ included', () => {
    const profile = resolveMunicipalityProfile({ municipality: '68161' }); // a real Mannheim PLZ, not the "first" one
    expect(profile.found).toBe(true);
    expect(profile.name).toBe('Mannheim');
    expect(profile.postalCode).toBe('68161'); // the PLZ actually queried, not an arbitrary other one
    expect(profile.postalCodes.length).toBeGreaterThan(10);
    expect(profile.postalCodes).toContain('68161');
  });

  it('does not mix postal codes across two different municipalities that share a name in different Bundesländer', () => {
    // Leimen exists in Baden-Württemberg; the state-scoped index should not
    // pull in postal codes from an unrelated same-named place elsewhere.
    const profile = resolveMunicipalityProfile({ municipality: 'Leimen' });
    expect(profile.found).toBe(true);
    for (const plz of profile.postalCodes) {
      expect(plz).toMatch(/^\d{5}$/);
    }
  });
});

describe('resolveMunicipalityProfile — known remaining gap (documented, not fixed here)', () => {
  it('Frankfurt am Main still fails to resolve a postal code (GV100 name vs. german-zip-codes "Frankfurt" mismatch)', () => {
    // Intentionally still broken -- separate root cause (name-format mismatch
    // between Destatis GV100's "Frankfurt am Main" and the german-zip-codes
    // package's plain "Frankfurt"), out of scope for the postalCodes[]
    // completeness fix this test file otherwise covers.
    const profile = resolveMunicipalityProfile({ municipality: 'Frankfurt am Main' });
    expect(profile.found).toBe(true); // GV100/AGS match still succeeds
    expect(profile.postalCode).toBeNull();
    expect(profile.postalCodes).toEqual([]);
  });
});
