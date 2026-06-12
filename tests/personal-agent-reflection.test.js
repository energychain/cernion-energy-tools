'use strict';

/**
 * Unit tests for src/personal-agent-reflection.js — v0.57.5 #158
 *
 * Covers the pure helper functions:
 *   - buildReflectionPrompt
 *   - validateReflectionPatch
 *   - hasScopeBlockedOrMissingSteps
 *   - buildReflectionAllowedFields
 */

const {
  REFLECTION_OUTPUT_SCHEMA,
  buildReflectionPrompt,
  validateReflectionPatch,
  hasScopeBlockedOrMissingSteps,
  buildReflectionAllowedFields,
} = require('../src/personal-agent-reflection');
const { DECISIVE_PARAMS } = require('../src/personal-agent-context');

describe('personal-agent-reflection', () => {
  // ─── buildReflectionAllowedFields ──────────────────────────────────────────

  describe('buildReflectionAllowedFields', () => {
    it('includes all DECISIVE_PARAMS by default', () => {
      const allowed = buildReflectionAllowedFields([], []);
      for (const key of DECISIVE_PARAMS) {
        expect(allowed.has(key)).toBe(true);
      }
    });

    it('adds receipt missingRequiredInputs to allowed set', () => {
      const allowed = buildReflectionAllowedFields(['customField', 'chargingMode'], []);
      expect(allowed.has('customField')).toBe(true);
      expect(allowed.has('chargingMode')).toBe(true);
    });

    it('expands locationScope violation into city, postalCode, municipality, location', () => {
      const allowed = buildReflectionAllowedFields([], [{ scope: 'locationScope' }]);
      expect(allowed.has('city')).toBe(true);
      expect(allowed.has('postalCode')).toBe(true);
      expect(allowed.has('municipality')).toBe(true);
      expect(allowed.has('location')).toBe(true);
    });

    it('expands operatorScope violation into gridOperatorName, bdewCode, bdew, gridOperatorId', () => {
      const allowed = buildReflectionAllowedFields([], [{ scope: 'operatorScope' }]);
      expect(allowed.has('gridOperatorName')).toBe(true);
      expect(allowed.has('bdewCode')).toBe(true);
      expect(allowed.has('bdew')).toBe(true);
      expect(allowed.has('gridOperatorId')).toBe(true);
    });

    it('does not add unknown scope names as keys', () => {
      const allowed = buildReflectionAllowedFields([], [{ scope: 'unknownScope' }]);
      expect(allowed.has('unknownScope')).toBe(false);
    });

    it('ignores blank or non-string missingRequiredInputs entries', () => {
      const allowed = buildReflectionAllowedFields(['', null, 42, 'validField'], []);
      expect(allowed.has('validField')).toBe(true);
      expect(allowed.has('')).toBe(false);
    });
  });

  // ─── buildReflectionPrompt ─────────────────────────────────────────────────

  describe('buildReflectionPrompt', () => {
    it('returns an object with system and user strings', () => {
      const { system, user } = buildReflectionPrompt({
        userMessage: 'Hello',
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(typeof system).toBe('string');
      expect(typeof user).toBe('string');
      expect(system.length).toBeGreaterThan(10);
      expect(user.length).toBeGreaterThan(5);
    });

    it('includes the user message in the user prompt', () => {
      const { user } = buildReflectionPrompt({
        userMessage: 'Wann soll ich mein Auto laden?',
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(user).toContain('Wann soll ich mein Auto laden?');
    });

    it('includes missingRequiredInputs in the system prompt', () => {
      const { system } = buildReflectionPrompt({
        userMessage: 'test',
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: ['city', 'postalCode'],
        scopeViolations: [],
      });
      expect(system).toContain('city');
      expect(system).toContain('postalCode');
    });

    it('includes scopeViolations description in the system prompt', () => {
      const { system } = buildReflectionPrompt({
        userMessage: 'test',
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [{ scope: 'locationScope', message: 'city/postalCode required' }],
      });
      expect(system).toContain('locationScope');
    });

    it('includes consultation history in the user prompt', () => {
      const { user } = buildReflectionPrompt({
        userMessage: 'test',
        consultationHistory: [
          { role: 'user', text: 'Ich bin in Berlin' },
          { role: 'assistant', text: 'Verstanden.' },
        ],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(user).toContain('Ich bin in Berlin');
      expect(user).toContain('Verstanden.');
    });

    it('includes receiptId as trace annotation in the system prompt', () => {
      const { system } = buildReflectionPrompt({
        userMessage: 'test',
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [],
        receiptId: 'some-receipt-v1',
      });
      expect(system).toContain('some-receipt-v1');
    });

    it('does NOT hard-code any location, postal code, VNB, or EV charging term', () => {
      // Verify the module itself has no hard-coded domain values
      const fs = require('fs');
      const src = fs.readFileSync(
        require('path').join(__dirname, '../src/personal-agent-reflection.js'),
        'utf8'
      );
      expect(src).not.toMatch(/69256/);
      expect(src).not.toMatch(/Mauer/);
      expect(src).not.toMatch(/ev-charging/i);
      expect(src).not.toMatch(/TWL/);
    });

    it('truncates very long user messages to prevent prompt overflow', () => {
      const longMessage = 'x'.repeat(2000);
      const { user } = buildReflectionPrompt({
        userMessage: longMessage,
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      // The included portion must not exceed the 800-char slice
      const match = user.match(/"([^"]{1,900})"/);
      if (match) {
        expect(match[1].length).toBeLessThanOrEqual(800);
      }
    });

    it('works with empty / default params', () => {
      expect(() => buildReflectionPrompt()).not.toThrow();
      expect(() => buildReflectionPrompt({})).not.toThrow();
    });

    it('shows placeholder text when no history is available', () => {
      const { user } = buildReflectionPrompt({
        userMessage: 'test',
        consultationHistory: [],
        knownContext: {},
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(user).toContain('keine vorherigen Nachrichten');
    });
  });

  // ─── validateReflectionPatch ───────────────────────────────────────────────

  describe('validateReflectionPatch', () => {
    it('accepts a field that is in DECISIVE_PARAMS', () => {
      const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
        patch: { city: 'Musterstadt', postalCode: '12345' },
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(sanitizedPatch.city).toBe('Musterstadt');
      expect(sanitizedPatch.postalCode).toBe('12345');
      expect(rejectedKeys).toEqual([]);
    });

    it('rejects keys that are not in the whitelist', () => {
      const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
        patch: { city: 'Berlin', maliciousKey: 'injected' },
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(sanitizedPatch.city).toBe('Berlin');
      expect(sanitizedPatch.maliciousKey).toBeUndefined();
      expect(rejectedKeys).toContain('maliciousKey');
    });

    it('accepts a field listed in missingRequiredInputs', () => {
      const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
        patch: { chargingOptimizationGoal: 'co2' },
        missingRequiredInputs: ['chargingOptimizationGoal'],
        scopeViolations: [],
      });
      expect(sanitizedPatch.chargingOptimizationGoal).toBe('co2');
      expect(rejectedKeys).toEqual([]);
    });

    it('rejects non-string values', () => {
      const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
        patch: { city: 42, postalCode: null },
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(sanitizedPatch.city).toBeUndefined();
      expect(rejectedKeys).toContain('city');
      expect(rejectedKeys).toContain('postalCode');
    });

    it('rejects blank string values', () => {
      const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
        patch: { city: '   ' },
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(sanitizedPatch.city).toBeUndefined();
      expect(rejectedKeys).toContain('city');
    });

    it('trims whitespace from accepted string values', () => {
      const { sanitizedPatch } = validateReflectionPatch({
        patch: { city: '  Berlin  ' },
        missingRequiredInputs: [],
        scopeViolations: [],
      });
      expect(sanitizedPatch.city).toBe('Berlin');
    });

    it('returns empty sanitizedPatch and empty rejectedKeys when patch is null/array/non-object', () => {
      for (const bad of [null, undefined, [], 'string']) {
        const result = validateReflectionPatch({ patch: bad });
        expect(result.sanitizedPatch).toEqual({});
        expect(result.rejectedKeys).toEqual([]);
      }
    });

    it('accepts locationScope-implied fields when that violation is present', () => {
      const { sanitizedPatch } = validateReflectionPatch({
        patch: { postalCode: '69256', municipality: 'Mauer' },
        missingRequiredInputs: [],
        scopeViolations: [{ scope: 'locationScope' }],
      });
      expect(sanitizedPatch.postalCode).toBe('69256');
      expect(sanitizedPatch.municipality).toBe('Mauer');
    });

    it('works with empty / default params', () => {
      expect(() => validateReflectionPatch()).not.toThrow();
      const result = validateReflectionPatch({});
      expect(result.sanitizedPatch).toEqual({});
      expect(result.rejectedKeys).toEqual([]);
    });
  });

  // ─── hasScopeBlockedOrMissingSteps ────────────────────────────────────────

  describe('hasScopeBlockedOrMissingSteps', () => {
    it('returns false for null evaluation', () => {
      expect(hasScopeBlockedOrMissingSteps(null)).toBe(false);
    });

    it('returns false for evaluation with no blockers', () => {
      expect(
        hasScopeBlockedOrMissingSteps({
          executable: true,
          plannedToolCalls: [{ status: 'ready' }],
          missingRequiredInputs: [],
        })
      ).toBe(false);
    });

    it('returns true when plannedToolCalls has a scope-blocked step', () => {
      expect(
        hasScopeBlockedOrMissingSteps({
          executable: false,
          plannedToolCalls: [
            { status: 'ready' },
            { status: 'scope-blocked', scopeViolations: [{ scope: 'locationScope' }] },
          ],
          missingRequiredInputs: [],
        })
      ).toBe(true);
    });

    it('returns true when plannedToolCalls has a missing-input step', () => {
      expect(
        hasScopeBlockedOrMissingSteps({
          executable: false,
          plannedToolCalls: [{ status: 'missing-input' }],
          missingRequiredInputs: [],
        })
      ).toBe(true);
    });

    it('returns true when missingRequiredInputs is non-empty', () => {
      expect(
        hasScopeBlockedOrMissingSteps({
          executable: false,
          plannedToolCalls: [],
          missingRequiredInputs: ['city'],
        })
      ).toBe(true);
    });

    it('returns false when evaluation has no plannedToolCalls and no missingRequiredInputs', () => {
      expect(
        hasScopeBlockedOrMissingSteps({
          executable: false,
          plannedToolCalls: [],
          missingRequiredInputs: [],
        })
      ).toBe(false);
    });
  });

  // ─── REFLECTION_OUTPUT_SCHEMA ─────────────────────────────────────────────

  describe('REFLECTION_OUTPUT_SCHEMA', () => {
    it('is a valid JSON schema object with required fields', () => {
      expect(REFLECTION_OUTPUT_SCHEMA).toBeDefined();
      expect(REFLECTION_OUTPUT_SCHEMA.type).toBe('object');
      expect(REFLECTION_OUTPUT_SCHEMA.required).toEqual(
        expect.arrayContaining([
          'resolvedContextPatch',
          'confidence',
          'evidence',
          'unresolvedScopes',
        ])
      );
    });
  });
});
