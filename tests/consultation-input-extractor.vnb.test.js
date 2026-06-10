'use strict';

const { extractAvailableInputs, INPUT_PATTERNS } = require('../src/consultation-input-extractor');

// Helper: find extracted param by key
const find = (inputs, param) => inputs.find((i) => i.param === param);

describe('consultation-input-extractor — VNB Lookup Parameter Mapping (Issue #177)', () => {
  // ── PLZ extraction ──────────────────────────────────────────────────────────

  describe('PLZ → postalCode', () => {
    it('extracts postalCode from "PLZ 12045" mention', () => {
      const inputs = extractAvailableInputs(
        'Welcher Netzbetreiber ist für PLZ 12045 in Berlin zuständig?',
        {},
        {}
      );
      const plz = find(inputs, 'postalCode');
      expect(plz).toBeDefined();
      expect(plz.value).toBe('12045');
      expect(plz.source).toBe('message');
    });

    it('extracts postalCode from bare 5-digit PLZ', () => {
      const inputs = extractAvailableInputs('VNB für 80333 München', {}, {});
      const plz = find(inputs, 'postalCode');
      expect(plz).toBeDefined();
      expect(plz.value).toBe('80333');
    });

    it('does NOT extract PLZ from a 13-digit BDEW code (BDEW wins)', () => {
      const inputs = extractAvailableInputs('BDEW-Code 9900992720003', {}, {});
      const bdew = find(inputs, 'bdewCode');
      expect(bdew).toBeDefined();
      expect(bdew.value).toBe('9900992720003');
      // postalCode must not grab the first 5 digits of a BDEW code
      const plz = find(inputs, 'postalCode');
      expect(plz).toBeUndefined();
    });
  });

  // ── Ort/Stadt extraction ────────────────────────────────────────────────────

  describe('Ort/Stadt → municipality (alias: city)', () => {
    it('extracts municipality from hardcoded major-city list', () => {
      const inputs = extractAvailableInputs(
        'Welcher VNB ist für den Standort Hamburg zuständig?',
        {},
        {}
      );
      const city = find(inputs, 'municipality');
      expect(city).toBeDefined();
      expect(city.value.toLowerCase()).toContain('hamburg');
    });

    it('extracts municipality for Frankfurt', () => {
      const inputs = extractAvailableInputs(
        'Netzbetreiber für Frankfurt ermitteln',
        {},
        {}
      );
      const city = find(inputs, 'municipality');
      expect(city).toBeDefined();
      expect(city.value.toLowerCase()).toContain('frankfurt');
    });

    it('extracts municipality from "Ort X" prefix', () => {
      const inputs = extractAvailableInputs(
        'VNB Lookup: Ort München – welcher Netzbetreiber?',
        {},
        {}
      );
      const city = find(inputs, 'municipality');
      expect(city).toBeDefined();
    });

    it('municipality aliases include "city"', () => {
      expect(INPUT_PATTERNS.municipality.aliases).toContain('city');
    });
  });

  // ── BDEW-Code extraction ────────────────────────────────────────────────────

  describe('BDEW-Code → bdewCode', () => {
    it('extracts 13-digit BDEW code', () => {
      const inputs = extractAvailableInputs(
        'BDEW-Code 9900992720003 – welcher VNB steckt dahinter?',
        {},
        {}
      );
      const bdew = find(inputs, 'bdewCode');
      expect(bdew).toBeDefined();
      expect(bdew.value).toBe('9900992720003');
    });

    it('extracts BDEW code from knownContext', () => {
      const inputs = extractAvailableInputs('VNB Lookup', {}, { bdewCode: '9907473000008' });
      const bdew = find(inputs, 'bdewCode');
      expect(bdew).toBeDefined();
      expect(bdew.value).toBe('9907473000008');
      expect(bdew.source).toBe('knownContext');
    });
  });

  // ── Firmenname extraction ───────────────────────────────────────────────────

  describe('Firmenname → companyName', () => {
    it('extracts companyName from explicit "Firmenname:" prefix', () => {
      const inputs = extractAvailableInputs(
        'Firmenname: Stadtwerke Köln – BDEW-Code und SNB gesucht',
        {},
        {}
      );
      const company = find(inputs, 'companyName');
      expect(company).toBeDefined();
      expect(company.value).toMatch(/Stadtwerke/i);
    });

    it('extracts companyName from "Unternehmen:" prefix', () => {
      const inputs = extractAvailableInputs(
        'Unternehmen: Netz GmbH Hannover – VNB Zuordnung',
        {},
        {}
      );
      const company = find(inputs, 'companyName');
      expect(company).toBeDefined();
      expect(company.value).toMatch(/Netz/i);
    });

    it('gridOperatorName still extracted for "Netzbetreiber: X" pattern', () => {
      const inputs = extractAvailableInputs(
        'Netzbetreiber: Bayernwerk Netz GmbH – zuständig für Standort',
        {},
        {}
      );
      const name = find(inputs, 'gridOperatorName');
      expect(name).toBeDefined();
      expect(name.value).toMatch(/Bayernwerk/i);
    });
  });

  // ── Missing evidence — no false extractions ─────────────────────────────────

  describe('missing evidence — no false extractions', () => {
    it('returns no postalCode or bdewCode for vague VNB query without location data', () => {
      const inputs = extractAvailableInputs('Welcher VNB ist zuständig?', {}, {});
      expect(find(inputs, 'postalCode')).toBeUndefined();
      expect(find(inputs, 'bdewCode')).toBeUndefined();
    });

    it('does not extract municipality from generic routing terms only', () => {
      const inputs = extractAvailableInputs('Netzbetreiber-Zuordnung klären', {}, {});
      expect(find(inputs, 'municipality')).toBeUndefined();
    });

    it('does not extract municipality from Bundesland name (state vs. city guard)', () => {
      const inputs = extractAvailableInputs('VNB in Bayern zuständig', {}, {});
      // Bayern is a Bundesland, not a city — should not be a municipality
      const mun = find(inputs, 'municipality');
      expect(mun).toBeUndefined();
    });
  });
});
