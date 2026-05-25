'use strict';

const {
  extractEnergyIds,
  extractFirstOfType,
  hasEnergyIdOfType,
} = require('../src/utils/energy-id-extractor');

describe('energy-id-extractor', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // MeLo — Messlokation
  // ───────────────────────────────────────────────────────────────────────────
  describe('MeLo (Messlokation)', () => {
    const VALID_MELO = 'DE1234567890123456789012345678901';

    it('extracts a valid MeLo (DE + 31 digits)', () => {
      const results = extractEnergyIds(`Messlokation: ${VALID_MELO}`);
      expect(results.some((r) => r.type === 'meloId' && r.value === VALID_MELO)).toBe(true);
    });

    it('extracts MeLo case-insensitively (lowercase "de")', () => {
      const lower = 'de1234567890123456789012345678901';
      const results = extractEnergyIds(lower);
      expect(results.some((r) => r.type === 'meloId')).toBe(true);
    });

    it('does NOT match DE + 30 digits (too short)', () => {
      expect(extractFirstOfType('DE123456789012345678901234567890', 'meloId')).toBeNull();
    });

    it('does NOT match DE + 32 digits (too long)', () => {
      expect(extractFirstOfType('DE12345678901234567890123456789012', 'meloId')).toBeNull();
    });

    it('does NOT match a MeLo embedded inside a longer token without word boundary', () => {
      // Prefix "X" makes it a longer token — should not match
      expect(extractFirstOfType('XDE1234567890123456789012345678901', 'meloId')).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MaLo — Marktlokation
  // ───────────────────────────────────────────────────────────────────────────
  describe('MaLo (Marktlokation)', () => {
    it('extracts a valid 11-digit MaLo', () => {
      expect(extractFirstOfType('MaLo: 50599012345', 'maloId')).toBe('50599012345');
    });

    it('does NOT match 10 digits (too short for MaLo)', () => {
      expect(extractFirstOfType('1234567890', 'maloId')).toBeNull();
    });

    it('does NOT match 12 digits (too long for MaLo, could be BDEW range)', () => {
      expect(extractFirstOfType('123456789012', 'maloId')).toBeNull();
    });

    it('does NOT match 11 digits embedded inside a 13-digit number', () => {
      // The 13-digit number should match bdewCode, not maloId for its substring
      const ids = extractEnergyIds('4012345678901');
      const maloHits = ids.filter((r) => r.type === 'maloId');
      expect(maloHits).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MaStR-ID
  // ───────────────────────────────────────────────────────────────────────────
  // Real MaStR-IDs: 3-letter prefix + 12 decimal digits (15 chars total)
  describe('MaStR-ID', () => {
    it('extracts SEE prefix MaStR-ID', () => {
      expect(extractFirstOfType('Anlage SEE900123456789', 'mastrId')).toBe('SEE900123456789');
    });

    it('extracts SNB prefix MaStR-ID (grid operator)', () => {
      expect(extractFirstOfType('Netzbetreiber SNB900000012345', 'mastrId')).toBe(
        'SNB900000012345'
      );
    });

    it('extracts GNB prefix MaStR-ID', () => {
      expect(extractFirstOfType('GNB900000012345', 'mastrId')).toBe('GNB900000012345');
    });

    it('does NOT match an unknown prefix like "XYZ" + 12 digits', () => {
      expect(extractFirstOfType('XYZ123456789012', 'mastrId')).toBeNull();
    });

    it('does NOT match SEE + 11 digits (too short)', () => {
      expect(extractFirstOfType('SEE12345678901', 'mastrId')).toBeNull();
    });

    it('does NOT match SEE + 13 digits (too long)', () => {
      expect(extractFirstOfType('SEE1234567890123', 'mastrId')).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BDEW Code / GLN (13 digits)
  // ───────────────────────────────────────────────────────────────────────────
  describe('BDEW Code / GLN', () => {
    it('extracts a valid 13-digit BDEW/GLN code', () => {
      expect(extractFirstOfType('BDEW 4012345678901', 'bdewCode')).toBe('4012345678901');
    });

    it('does NOT match 12 digits', () => {
      expect(extractFirstOfType('401234567890', 'bdewCode')).toBeNull();
    });

    it('does NOT match 14 digits', () => {
      expect(extractFirstOfType('40123456789012', 'bdewCode')).toBeNull();
    });

    it('does NOT match the word "Hier" as a BDEW code', () => {
      // This was the critical hallucination bug in the old extractor
      expect(extractFirstOfType('Hier ist die Anfrage', 'bdewCode')).toBeNull();
    });

    it('does NOT match an alphanumeric string shorter than 13 digits as BDEW', () => {
      expect(extractFirstOfType('ABC1234', 'bdewCode')).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EIC (Energy Identification Code)
  // ───────────────────────────────────────────────────────────────────────────
  describe('EIC Code', () => {
    it('extracts a valid EIC code (11X format)', () => {
      expect(extractFirstOfType('EIC: 11XBAYERNWERK--N', 'eicCode')).toBe('11XBAYERNWERK--N');
    });

    it('extracts an EIC with dashes (16 chars)', () => {
      // 2 digits + 1 letter + 12 mixed + 1 alphanumeric = 16 chars
      expect(extractFirstOfType('11X------------L', 'eicCode')).toBe('11X------------L');
    });

    it('does NOT match a 15-char alphanumeric (too short for EIC)', () => {
      expect(extractFirstOfType('11XBAYERNWERK-N', 'eicCode')).toBeNull();
    });

    it('does NOT match a 17-char string (too long for EIC)', () => {
      // word boundary after 16 chars will prevent a longer token from matching
      expect(extractFirstOfType('11XBAYERNWERK---NX', 'eicCode')).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // OBIS Code
  // ───────────────────────────────────────────────────────────────────────────
  describe('OBIS Code', () => {
    it('extracts a standard OBIS code', () => {
      expect(extractFirstOfType('Zählerstand 1-0:1.8.0', 'obisCode')).toBe('1-0:1.8.0');
    });

    it('extracts an OBIS code with tariff suffix (*255)', () => {
      expect(extractFirstOfType('OBIS 1-0:1.8.1*255', 'obisCode')).toBe('1-0:1.8.1*255');
    });

    it('does NOT match a plain number as OBIS', () => {
      expect(hasEnergyIdOfType('12345', 'obisCode')).toBe(false);
    });

    it('does NOT match an incomplete OBIS-like fragment "1-0:1.8" (missing third segment)', () => {
      expect(hasEnergyIdOfType('1-0:1.8', 'obisCode')).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PLZ (Postleitzahl)
  // ───────────────────────────────────────────────────────────────────────────
  describe('PLZ (Postleitzahl)', () => {
    it('extracts a valid 5-digit PLZ', () => {
      expect(extractFirstOfType('PLZ 69115', 'postalCode')).toBe('69115');
    });

    it('extracts PLZ embedded in a sentence', () => {
      expect(extractFirstOfType('Ich wohne in 10117 Berlin', 'postalCode')).toBe('10117');
    });

    it('does NOT match 4 digits as a PLZ', () => {
      expect(extractFirstOfType('1234', 'postalCode')).toBeNull();
    });

    it('does NOT match 6 digits as a PLZ', () => {
      expect(extractFirstOfType('123456', 'postalCode')).toBeNull();
    });

    it('does NOT match 5 digits embedded inside an 11-digit MaLo', () => {
      // A pure 11-digit number satisfies \b\d{11}\b (maloId) but its sub-sequence
      // should not independently produce a postalCode match because the word
      // boundaries of the 11-digit token prevent a 5-digit sub-match.
      const results = extractEnergyIds('50599012345');
      const plzHits = results.filter((r) => r.type === 'postalCode');
      expect(plzHits).toHaveLength(0);
    });

    it('does NOT match 5 digits inside a 13-digit BDEW/GLN code', () => {
      const results = extractEnergyIds('4012345678901');
      const plzHits = results.filter((r) => r.type === 'postalCode');
      expect(plzHits).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Multiple IDs in one text
  // ───────────────────────────────────────────────────────────────────────────
  describe('multiple IDs in one message', () => {
    it('extracts MeLo and PLZ from the same text without cross-contamination', () => {
      const text =
        'Zähler DE1234567890123456789012345678901 befindet sich in 69115 Heidelberg.';
      const results = extractEnergyIds(text);
      expect(results.some((r) => r.type === 'meloId')).toBe(true);
      expect(results.some((r) => r.type === 'postalCode' && r.value === '69115')).toBe(true);
      // The MeLo itself must not bleed into postalCode
      const plzHits = results.filter((r) => r.type === 'postalCode');
      expect(plzHits.every((r) => r.value === '69115')).toBe(true);
    });

    it('extracts MaStR-ID and PLZ without collision', () => {
      const text = 'Anlage SEE900123456789 in 76137 Karlsruhe.'; // SEE + 12 digits
      const results = extractEnergyIds(text);
      expect(results.some((r) => r.type === 'mastrId' && r.value === 'SEE900123456789')).toBe(
        true
      );
      expect(results.some((r) => r.type === 'postalCode' && r.value === '76137')).toBe(true);
    });

    it('de-duplicates repeated occurrences of the same value', () => {
      const text = '69115 und 69115';
      const results = extractEnergyIds(text);
      const plzHits = results.filter((r) => r.type === 'postalCode');
      expect(plzHits).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // extractFirstOfType / hasEnergyIdOfType helpers
  // ───────────────────────────────────────────────────────────────────────────
  describe('helper functions', () => {
    it('extractFirstOfType returns null for empty text', () => {
      expect(extractFirstOfType('', 'postalCode')).toBeNull();
    });

    it('extractFirstOfType returns null for non-string input', () => {
      expect(extractFirstOfType(null, 'postalCode')).toBeNull();
    });

    it('hasEnergyIdOfType returns false when no match', () => {
      expect(hasEnergyIdOfType('kein Code hier', 'mastrId')).toBe(false);
    });

    it('hasEnergyIdOfType returns true when match exists', () => {
      expect(hasEnergyIdOfType('PLZ 80331', 'postalCode')).toBe(true);
    });
  });
});
