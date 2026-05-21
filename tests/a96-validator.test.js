'use strict';

/**
 * tests/a96-validator.test.js
 *
 * Sub-Track A — A96 Validator Tests (v0.47.0)
 *
 * Tests: validateA96Message, applyA96Defaults, buildDriftFinding
 */

const {
  validateA96Message,
  applyA96Defaults,
  buildDriftFinding,
  OPEN_FIELDS,
  REQUIRED_FIELDS,
} = require('../src/a96-validator');

describe('A96 Validator (v0.47.0)', () => {
  describe('validateA96Message', () => {
    const VALID_MESSAGE = {
      GemeinschaftsId: 'ES-2026-001',
      MaloIdVerbraucher: `DE${Array(31).fill('1').join('')}`,
      ZugeteilteEnergieMenge: 125.4,
      AllokationsZeitraumVon: '2026-06-01T00:00:00.000Z',
      AllokationsZeitraumBis: '2026-06-30T23:59:59.999Z',
    };

    test('valid message passes with no errors', () => {
      const result = validateA96Message(VALID_MESSAGE);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('missing required fields produce errors', () => {
      const result = validateA96Message({ GemeinschaftsId: 'ES-001' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('MaloIdVerbraucher'))).toBe(true);
    });

    test('null input returns invalid', () => {
      const result = validateA96Message(null);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('[BNetzA-OFFEN] absent fields produce warnings and driftFields', () => {
      const result = validateA96Message(VALID_MESSAGE);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.driftFields.length).toBeGreaterThan(0);
      // All open fields should appear in drift or warning
      for (const field of OPEN_FIELDS) {
        const mentioned =
          result.warnings.some((w) => w.includes(field)) || result.driftFields.includes(field);
        expect(mentioned).toBe(true);
      }
    });

    test('invalid MaLo format produces error', () => {
      const msg = { ...VALID_MESSAGE, MaloIdVerbraucher: 'INVALID_MALO' };
      const result = validateA96Message(msg);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('MaloIdVerbraucher'))).toBe(true);
    });

    test('[BNetzA-OFFEN] present with defensive default produces drift warning', () => {
      const msg = { ...VALID_MESSAGE, QualitaetskennzeichenMscons: 'E01' };
      const result = validateA96Message(msg);
      const hasDriftWarn =
        result.driftFields.includes('QualitaetskennzeichenMscons') ||
        result.warnings.some((w) => w.includes('QualitaetskennzeichenMscons'));
      expect(hasDriftWarn).toBe(true);
    });

    test('[BNetzA-OFFEN] field with non-default value does not produce drift', () => {
      const msg = { ...VALID_MESSAGE, QualitaetskennzeichenMscons: 'E02' };
      const result = validateA96Message(msg);
      expect(result.driftFields).not.toContain('QualitaetskennzeichenMscons');
    });
  });

  describe('applyA96Defaults', () => {
    test('fills ErzeugerMastrNummer from context.mastrNummer', () => {
      const out = applyA96Defaults({}, { mastrNummer: 'SEE904837264953' });
      expect(out.ErzeugerMastrNummer).toBe('SEE904837264953');
    });

    test('fills Bilanzierungsmonat from context.month', () => {
      const out = applyA96Defaults({}, { month: '2026-06' });
      expect(out.Bilanzierungsmonat).toBe('2026-06');
    });

    test('fills BdewCodeNetzbetreiber from context.bdew', () => {
      const out = applyA96Defaults({}, { bdew: '9907473000008' });
      expect(out.BdewCodeNetzbetreiber).toBe('9907473000008');
    });

    test('sets QualitaetskennzeichenMscons to E01 when no gaps', () => {
      const out = applyA96Defaults({}, { msconsMissing: 0 });
      expect(out.QualitaetskennzeichenMscons).toBe('E01');
    });

    test('sets QualitaetskennzeichenMscons to E02 when gaps present', () => {
      const out = applyA96Defaults({}, { msconsMissing: 5 });
      expect(out.QualitaetskennzeichenMscons).toBe('E02');
    });

    test('does not overwrite existing field', () => {
      const out = applyA96Defaults({ ErzeugerMastrNummer: 'SEE111' }, { mastrNummer: 'SEE999' });
      expect(out.ErzeugerMastrNummer).toBe('SEE111');
    });
  });

  describe('buildDriftFinding', () => {
    test('returns null for empty driftFields', () => {
      expect(buildDriftFinding([])).toBeNull();
      expect(buildDriftFinding(null)).toBeNull();
    });

    test('returns finding with ES_A96_FIELD_DRIFT code', () => {
      const finding = buildDriftFinding(['ErzeugerMastrNummer', 'Bilanzierungsmonat']);
      expect(finding).not.toBeNull();
      expect(finding.finding).toBe('ES_A96_FIELD_DRIFT');
      expect(finding.severity).toBe('warning');
      expect(finding.fields).toContain('ErzeugerMastrNummer');
    });
  });

  describe('OPEN_FIELDS and REQUIRED_FIELDS exports', () => {
    test('OPEN_FIELDS contains the 4 BNetzA-OFFEN fields', () => {
      expect(OPEN_FIELDS).toContain('ErzeugerMastrNummer');
      expect(OPEN_FIELDS).toContain('Bilanzierungsmonat');
      expect(OPEN_FIELDS).toContain('BdewCodeNetzbetreiber');
      expect(OPEN_FIELDS).toContain('QualitaetskennzeichenMscons');
    });

    test('REQUIRED_FIELDS contains the 5 stable required fields', () => {
      expect(REQUIRED_FIELDS).toContain('GemeinschaftsId');
      expect(REQUIRED_FIELDS).toContain('MaloIdVerbraucher');
      expect(REQUIRED_FIELDS).toContain('ZugeteilteEnergieMenge');
    });
  });
});
