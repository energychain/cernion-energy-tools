/**
 * DataStatus Module Tests (CR-11)
 */

'use strict';

const { DataStatus, ds, dsValue, dsFallbackReason, dsFallbackDisplay, dsRender } = require('../src/data-status');

describe('DataStatus (CR-11)', () => {
  describe('enum values', () => {
    it('should export all 6 status constants', () => {
      expect(DataStatus.OK).toBe('ok');
      expect(DataStatus.NOT_CALLED).toBe('not_called');
      expect(DataStatus.TOOL_ERROR).toBe('tool_error');
      expect(DataStatus.NOT_LICENSED).toBe('not_licensed');
      expect(DataStatus.NO_DATA).toBe('no_data');
      expect(DataStatus.FALLBACK).toBe('fallback');
    });
  });

  describe('ds() factory', () => {
    it('should create an OK tagged object', () => {
      const obj = ds(DataStatus.OK, 42.5);
      expect(obj.status).toBe(DataStatus.OK);
      expect(obj.value).toBe(42.5);
    });

    it('should create a FALLBACK tagged object with source', () => {
      const obj = ds(DataStatus.FALLBACK, '6–12', '% Branchenspanne', 'BDEW Kundenstudie 2023');
      expect(obj.status).toBe(DataStatus.FALLBACK);
      expect(obj.value).toBe('6–12');
      expect(obj.unit).toBe('% Branchenspanne');
      expect(obj.source).toBe('BDEW Kundenstudie 2023');
    });

    it('should default value to null when not provided', () => {
      const obj = ds(DataStatus.NOT_CALLED);
      expect(obj.value).toBeNull();
    });
  });

  describe('dsValue()', () => {
    it('should return value for OK status', () => {
      expect(dsValue(ds(DataStatus.OK, 99))).toBe(99);
    });

    it('should return null for non-OK statuses', () => {
      expect(dsValue(ds(DataStatus.NOT_CALLED))).toBeNull();
      expect(dsValue(ds(DataStatus.NOT_LICENSED))).toBeNull();
    });

    it('should return null for invalid input', () => {
      expect(dsValue(null)).toBeNull();
      expect(dsValue(undefined)).toBeNull();
      expect(dsValue('string')).toBeNull();
    });
  });

  describe('dsFallbackReason()', () => {
    it('should return empty string for OK status', () => {
      expect(dsFallbackReason(ds(DataStatus.OK, 5))).toBe('');
    });

    it('should return warning for NOT_CALLED', () => {
      const reason = dsFallbackReason(ds(DataStatus.NOT_CALLED));
      expect(reason).toContain('⚠');
      expect(reason).toContain('n/v');
    });

    it('should return "nicht lizenziert" for NOT_LICENSED', () => {
      expect(dsFallbackReason(ds(DataStatus.NOT_LICENSED))).toBe('nicht lizenziert');
    });

    it('should include source in NOT_CALLED reason when provided', () => {
      const reason = dsFallbackReason(ds(DataStatus.NOT_CALLED, null, '', 'MaStR-ID fehlt'));
      expect(reason).toContain('MaStR-ID fehlt');
    });

    it('should return "Branchenschätzung" for FALLBACK without source', () => {
      expect(dsFallbackReason(ds(DataStatus.FALLBACK, 8.0))).toBe('Branchenschätzung');
    });

    it('should include source in FALLBACK reason', () => {
      const reason = dsFallbackReason(ds(DataStatus.FALLBACK, 8.0, '%', 'BDEW 2023'));
      expect(reason).toContain('BDEW 2023');
    });

    it('should use defaultReason override when provided', () => {
      const reason = dsFallbackReason(ds(DataStatus.NOT_CALLED), 'Custom reason');
      expect(reason).toBe('Custom reason');
    });
  });

  describe('dsFallbackDisplay()', () => {
    it('should prepend ~ to numeric FALLBACK values', () => {
      expect(dsFallbackDisplay(ds(DataStatus.FALLBACK, 8.5))).toBe('~8.5');
    });

    it('should append unit when present', () => {
      expect(dsFallbackDisplay(ds(DataStatus.FALLBACK, 8.5, '%'))).toBe('~8.5 %');
    });

    it('should return null for non-FALLBACK status', () => {
      expect(dsFallbackDisplay(ds(DataStatus.OK, 8.5))).toBeNull();
    });

    it('should return null when value is null', () => {
      expect(dsFallbackDisplay(ds(DataStatus.FALLBACK))).toBeNull();
    });
  });

  describe('dsRender()', () => {
    it('should return [value, ""] for OK status', () => {
      const [val, reason] = dsRender(ds(DataStatus.OK, 42));
      expect(val).toBe(42);
      expect(reason).toBe('');
    });

    it('should apply formatter for OK status', () => {
      const [val] = dsRender(ds(DataStatus.OK, 72.5), (v) => `${v.toFixed(1)} %`);
      expect(val).toBe('72.5 %');
    });

    it('should return [~value, fallbackReason] for FALLBACK status', () => {
      const [val, reason] = dsRender(ds(DataStatus.FALLBACK, 8.0, '%', 'BDEW'));
      expect(val).toBe('~8.0 %');
      expect(reason).toContain('BDEW');
    });

    it('should return [null, reason] for NOT_CALLED', () => {
      const [val, reason] = dsRender(ds(DataStatus.NOT_CALLED));
      expect(val).toBeNull();
      expect(reason).toContain('⚠');
    });

    it('should return [null, "nicht lizenziert"] for NOT_LICENSED', () => {
      const [val, reason] = dsRender(ds(DataStatus.NOT_LICENSED));
      expect(val).toBeNull();
      expect(reason).toBe('nicht lizenziert');
    });
  });
});
