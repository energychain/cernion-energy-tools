'use strict';

const {
  QUERY_SCOPE,
  classifyQueryScope,
  isOperatorScopeResolved,
  hasLocationScope,
} = require('../src/query-scope-classifier');

describe('query-scope-classifier', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // hasLocationScope
  // ─────────────────────────────────────────────────────────────────────────
  describe('hasLocationScope', () => {
    it('returns true when city is set', () => {
      expect(hasLocationScope({ city: 'Wiesloch' })).toBe(true);
    });
    it('returns true when municipality is set', () => {
      expect(hasLocationScope({ municipality: 'Heidelberg' })).toBe(true);
    });
    it('returns true when postalCode is set', () => {
      expect(hasLocationScope({ postalCode: '69168' })).toBe(true);
    });
    it('returns true when region is set', () => {
      expect(hasLocationScope({ region: 'Baden-Württemberg' })).toBe(true);
    });
    it('returns false for empty context', () => {
      expect(hasLocationScope({})).toBe(false);
    });
    it('returns false when only operator fields set', () => {
      expect(hasLocationScope({ bdew: '9900277000000', vnbName: 'Netze BW' })).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // isOperatorScopeResolved
  // ─────────────────────────────────────────────────────────────────────────
  describe('isOperatorScopeResolved', () => {
    it('returns true for valid BDEW code (9-digit)', () => {
      expect(isOperatorScopeResolved({ bdew: '9900277000000' })).toBe(true);
    });
    it('returns true for bdewCode field', () => {
      expect(isOperatorScopeResolved({ bdewCode: '9900277000000' })).toBe(true);
    });
    it('returns true when vnbName is set', () => {
      expect(isOperatorScopeResolved({ vnbName: 'Netze BW GmbH' })).toBe(true);
    });
    it('returns true when gridOperatorName is set', () => {
      expect(isOperatorScopeResolved({ gridOperatorName: 'Bayernwerk' })).toBe(true);
    });
    it('returns true when gridOperatorMastrId is set', () => {
      expect(isOperatorScopeResolved({ gridOperatorMastrId: 'SNB938476571321' })).toBe(true);
    });
    it('returns false for city alone', () => {
      // Domain rule: city is NOT operator identity
      expect(isOperatorScopeResolved({ city: 'Wiesloch' })).toBe(false);
    });
    it('returns false for postalCode alone', () => {
      expect(isOperatorScopeResolved({ postalCode: '69168' })).toBe(false);
    });
    it('returns false for municipality alone', () => {
      expect(isOperatorScopeResolved({ municipality: 'Heidelberg' })).toBe(false);
    });
    it('returns false for non-numeric BDEW-like string', () => {
      // Prevents NLP garbage tokens (e.g. "KANNST", "WER") from being treated as BDEW
      expect(isOperatorScopeResolved({ bdew: 'KANNST' })).toBe(false);
      expect(isOperatorScopeResolved({ bdew: 'Heidelberg' })).toBe(false);
    });
    it('returns false for empty context', () => {
      expect(isOperatorScopeResolved({})).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // classifyQueryScope — domain regression cases (user-specified)
  // ─────────────────────────────────────────────────────────────────────────

  describe('SCOPE-REGRESSION-001: Asset query by location — no VNB lookup required', () => {
    it('Wiesloch city → assetByLocation, no operatorScope, locationScope available', () => {
      const result = classifyQueryScope(
        'Zeige mir Anlagen in Wiesloch / PLZ 69168',
        { city: 'Wiesloch', postalCode: '69168' }
      );
      expect(result.primaryScope).toBe(QUERY_SCOPE.ASSET_BY_LOCATION);
      expect(result.locationScopeAvailable).toBe(true);
      expect(result.operatorScopeResolved).toBe(false);
      expect(result.scopes).toContain(QUERY_SCOPE.LOCATION_SCOPE);
      expect(result.scopes).not.toContain(QUERY_SCOPE.OPERATOR_SCOPE);
    });
  });

  describe('SCOPE-REGRESSION-002: Asset query by operator — not a location query', () => {
    it('Netze BW → assetByOperator, operatorScope via name, no locationScope needed', () => {
      const result = classifyQueryScope(
        'Zeige mir Anlagen der Netze BW',
        { gridOperatorName: 'Netze BW' }
      );
      expect(result.primaryScope).toBe(QUERY_SCOPE.ASSET_BY_OPERATOR);
      expect(result.operatorScopeResolved).toBe(true);
      // Location scope is not required for an operator query
    });
  });

  describe('SCOPE-REGRESSION-003: GrünstromIndex / weather / CO2 — locationScope only', () => {
    it('GrünstromIndex for Wiesloch 69168 → assetByLocation or locationScope primary', () => {
      const result = classifyQueryScope(
        'Wie ist der GrünstromIndex für Wiesloch 69168?',
        { city: 'Wiesloch', postalCode: '69168' }
      );
      // locationScope should be available; no VNB lookup should be triggered
      expect(result.locationScopeAvailable).toBe(true);
      expect(result.operatorScopeResolved).toBe(false);
      expect(result.scopes).not.toContain(QUERY_SCOPE.VNB_RESOLUTION);
      // Primary scope should be location-related, not VNB resolution
      expect([QUERY_SCOPE.LOCATION_SCOPE, QUERY_SCOPE.ASSET_BY_LOCATION]).toContain(
        result.primaryScope
      );
    });
  });

  describe('SCOPE-REGRESSION-004: VNB resolution request — explicit intent with uncertainty', () => {
    it('Wer ist der zuständige VNB für Wiesloch → vnbResolution intent', () => {
      const result = classifyQueryScope(
        'Wer ist der zuständige Netzbetreiber für Wiesloch?',
        { city: 'Wiesloch' }
      );
      expect(result.primaryScope).toBe(QUERY_SCOPE.VNB_RESOLUTION);
      expect(result.scopes).toContain(QUERY_SCOPE.VNB_RESOLUTION);
      // locationScope is available (disambiguation context)
      expect(result.locationScopeAvailable).toBe(true);
      // operatorScope is NOT yet resolved — that's why we need the resolution workflow
      expect(result.operatorScopeResolved).toBe(false);
    });

    it('Welcher Netzbetreiber ist zuständig → vnbResolution', () => {
      const result = classifyQueryScope('Welcher Netzbetreiber ist zuständig?', { city: 'Heidelberg' });
      expect(result.primaryScope).toBe(QUERY_SCOPE.VNB_RESOLUTION);
    });
  });

  describe('SCOPE-REGRESSION-005: No city-only vnbLookup — Heidelberg must NOT have operatorScope', () => {
    it('city=Heidelberg → no operatorScope resolved', () => {
      const result = classifyQueryScope(
        'Wer ist der Netzbetreiber in Heidelberg?',
        { municipality: 'Heidelberg' }
      );
      // This is a VNB resolution request
      expect(result.primaryScope).toBe(QUERY_SCOPE.VNB_RESOLUTION);
      // Critical: locationScope≠operatorScope
      expect(result.operatorScopeResolved).toBe(false);
      expect(result.locationScopeAvailable).toBe(true);
      // scopeTrace should explain why operator is not resolved
      expect(result.scopeTrace.some((t) => t.includes('locationScope'))).toBe(true);
    });

    it('city=Heidelberg with bdew → now operatorScope IS resolved', () => {
      const result = classifyQueryScope(
        'VNB für Heidelberg, BDEW 9900277000000',
        { municipality: 'Heidelberg', bdew: '9900277000000' }
      );
      expect(result.operatorScopeResolved).toBe(true);
      expect(result.operatorScope.bdew).toBe('9900277000000');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // scopeTrace — execution trace shows what drove tool selection
  // ─────────────────────────────────────────────────────────────────────────
  describe('scopeTrace', () => {
    it('includes location and operator trace when both present', () => {
      const result = classifyQueryScope('VNB Wiesloch BDEW 9900277000000', {
        city: 'Wiesloch',
        bdew: '9900277000000',
      });
      expect(result.scopeTrace.some((t) => t.includes('locationScope'))).toBe(true);
      expect(result.scopeTrace.some((t) => t.includes('operatorScope'))).toBe(true);
    });

    it('explains when no scope is resolved', () => {
      const result = classifyQueryScope('Was ist ein VNB?', {});
      expect(result.scopeTrace.some((t) => t.includes('null') || t.includes('no scope') || t.includes('neither'))).toBe(true);
    });
  });
});
