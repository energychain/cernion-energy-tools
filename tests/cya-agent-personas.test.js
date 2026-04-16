'use strict';

const {
  PERSONA_ENUM,
  PERSONAS,
  validatePerspectives,
  getPersona,
  getPersonasOrderedByPriority,
  isKnownConflictRule,
} = require('../src/cya-agent-personas');

describe('cya-agent-personas', () => {
  describe('PERSONA_ENUM', () => {
    it('exports a frozen enum of valid persona IDs', () => {
      expect(PERSONA_ENUM).toEqual(['technical', 'commercial', 'compliance']);
      expect(Object.isFrozen(PERSONA_ENUM)).toBe(true);
    });

    it('is immutable', () => {
      expect(() => {
        PERSONA_ENUM.push('new_persona');
      }).toThrow();
    });
  });

  describe('PERSONAS registry', () => {
    it('contains all three personas', () => {
      expect(Object.keys(PERSONAS)).toEqual([
        'technical',
        'commercial',
        'compliance',
      ]);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(PERSONAS)).toBe(true);
    });

    it('each persona has required fields', () => {
      Object.values(PERSONAS).forEach((persona) => {
        expect(persona.id).toBeTruthy();
        expect(persona.label).toBeTruthy();
        expect(persona.objectStoreNamespace).toBeTruthy();
        expect(persona.systemPrompt).toBeTruthy();
        expect(persona.systemPrompt.length).toBeGreaterThan(100);
        expect(Array.isArray(persona.conflictRules)).toBe(true);
        expect(persona.conflictRules.length).toBeGreaterThan(0);
        expect(typeof persona.resolutionPriority).toBe('number');
      });
    });

    it('each persona has a unique resolutionPriority', () => {
      const priorities = Object.values(PERSONAS).map(
        (p) => p.resolutionPriority
      );
      expect(new Set(priorities).size).toBe(priorities.length);
    });

    it('priorities are ordered: technical=1, commercial=2, compliance=3', () => {
      expect(PERSONAS.technical.resolutionPriority).toBe(1);
      expect(PERSONAS.commercial.resolutionPriority).toBe(2);
      expect(PERSONAS.compliance.resolutionPriority).toBe(3);
    });

    describe('technical persona', () => {
      it('has system prompt focused on grid planning and VDE standards', () => {
        const prompt = PERSONAS.technical.systemPrompt;
        expect(prompt).toContain('Netzplaner');
        expect(prompt).toContain('VDE');
        expect(prompt).toContain('Transformator');
      });

      it('has technical conflict rules', () => {
        expect(PERSONAS.technical.conflictRules).toContain(
          'high_missing_nap'
        );
        expect(PERSONAS.technical.conflictRules).toContain('voltage_mismatch');
      });
    });

    describe('commercial persona', () => {
      it('has system prompt focused on costs and ROI', () => {
        const prompt = PERSONAS.commercial.systemPrompt;
        expect(prompt).toContain('Betriebswirt');
        expect(prompt).toContain('Kosten');
        expect(prompt).toContain('EUR');
      });

      it('has commercial conflict rules', () => {
        expect(PERSONAS.commercial.conflictRules).toContain(
          'capex_exceeds_budget'
        );
        expect(PERSONAS.commercial.conflictRules).toContain('poor_roi_forecast');
      });
    });

    describe('compliance persona', () => {
      it('has system prompt focused on regulations and legal compliance', () => {
        const prompt = PERSONAS.compliance.systemPrompt;
        expect(prompt).toContain('Compliance');
        expect(prompt).toContain('EnWG');
        expect(prompt).toContain('BNetzA');
      });

      it('has compliance conflict rules', () => {
        expect(PERSONAS.compliance.conflictRules).toContain(
          'regulatory_deadline_missed'
        );
        expect(PERSONAS.compliance.conflictRules).toContain(
          'eeg_termination_imminent'
        );
      });
    });
  });

  describe('validatePerspectives()', () => {
    it('returns valid:true for empty array (fallback to classic mode)', () => {
      const result = validatePerspectives([]);
      expect(result.valid).toBe(true);
      expect(result.invalidPersonas).toBeUndefined();
    });

    it('returns valid:true for single valid persona', () => {
      const result = validatePerspectives(['technical']);
      expect(result.valid).toBe(true);
      expect(result.invalidPersonas).toBeUndefined();
    });

    it('returns valid:true for multiple valid personas', () => {
      const result = validatePerspectives([
        'technical',
        'commercial',
        'compliance',
      ]);
      expect(result.valid).toBe(true);
      expect(result.invalidPersonas).toBeUndefined();
    });

    it('returns valid:false for single invalid persona', () => {
      const result = validatePerspectives(['unknown']);
      expect(result.valid).toBe(false);
      expect(result.invalidPersonas).toContain('unknown');
    });

    it('returns valid:false for mixed valid/invalid personas', () => {
      const result = validatePerspectives(['technical', 'unknown', 'marketing']);
      expect(result.valid).toBe(false);
      expect(result.invalidPersonas).toContain('unknown');
      expect(result.invalidPersonas).toContain('marketing');
      expect(result.invalidPersonas).not.toContain('technical');
    });

    it('returns valid:false for non-array input', () => {
      const result = validatePerspectives('technical');
      expect(result.valid).toBe(false);
      expect(result.invalidPersonas).toContain('not_an_array');
    });

    it('returns valid:false for null', () => {
      const result = validatePerspectives(null);
      expect(result.valid).toBe(false);
    });

    it('returns valid:false for object', () => {
      const result = validatePerspectives({ technical: true });
      expect(result.valid).toBe(false);
    });
  });

  describe('getPersona()', () => {
    it('returns persona definition for valid ID', () => {
      const persona = getPersona('technical');
      expect(persona).toBeTruthy();
      expect(persona.id).toBe('technical');
      expect(persona.label).toBe('Grid Planning & Operations');
    });

    it('returns null for invalid ID', () => {
      const persona = getPersona('unknown');
      expect(persona).toBeNull();
    });

    it('returns null for undefined ID', () => {
      const persona = getPersona();
      expect(persona).toBeNull();
    });

    it('returns all three personas when called with their IDs', () => {
      const technical = getPersona('technical');
      const commercial = getPersona('commercial');
      const compliance = getPersona('compliance');

      expect(technical).toBeTruthy();
      expect(commercial).toBeTruthy();
      expect(compliance).toBeTruthy();

      expect(technical.id).toBe('technical');
      expect(commercial.id).toBe('commercial');
      expect(compliance.id).toBe('compliance');
    });
  });

  describe('getPersonasOrderedByPriority()', () => {
    it('returns all personas sorted by resolution priority', () => {
      const ordered = getPersonasOrderedByPriority();
      expect(ordered.length).toBe(3);

      expect(ordered[0].id).toBe('technical');
      expect(ordered[0].resolutionPriority).toBe(1);

      expect(ordered[1].id).toBe('commercial');
      expect(ordered[1].resolutionPriority).toBe(2);

      expect(ordered[2].id).toBe('compliance');
      expect(ordered[2].resolutionPriority).toBe(3);
    });

    it('priorities are strictly ascending', () => {
      const ordered = getPersonasOrderedByPriority();
      for (let i = 0; i < ordered.length - 1; i++) {
        expect(ordered[i].resolutionPriority).toBeLessThan(
          ordered[i + 1].resolutionPriority
        );
      }
    });
  });

  describe('isKnownConflictRule()', () => {
    it('returns true for known technical conflict rule', () => {
      expect(isKnownConflictRule('high_missing_nap')).toBe(true);
      expect(isKnownConflictRule('voltage_mismatch')).toBe(true);
      expect(isKnownConflictRule('overload_risk')).toBe(true);
    });

    it('returns true for known commercial conflict rule', () => {
      expect(isKnownConflictRule('capex_exceeds_budget')).toBe(true);
      expect(isKnownConflictRule('poor_roi_forecast')).toBe(true);
    });

    it('returns true for known compliance conflict rule', () => {
      expect(isKnownConflictRule('regulatory_deadline_missed')).toBe(true);
      expect(isKnownConflictRule('eeg_termination_imminent')).toBe(true);
    });

    it('returns false for unknown conflict rule', () => {
      expect(isKnownConflictRule('unknown_rule')).toBe(false);
      expect(isKnownConflictRule('')).toBe(false);
      expect(isKnownConflictRule(null)).toBe(false);
    });

    it('recognizes all conflict rules from all personas', () => {
      const allRules = Object.values(PERSONAS).flatMap((p) =>
        p.conflictRules
      );
      allRules.forEach((rule) => {
        expect(isKnownConflictRule(rule)).toBe(true);
      });
    });
  });

  describe('object store namespace isolation', () => {
    it('each persona has a unique namespace', () => {
      const namespaces = Object.values(PERSONAS).map(
        (p) => p.objectStoreNamespace
      );
      expect(new Set(namespaces).size).toBe(namespaces.length);
    });

    it('namespaces follow the cya_persona_* pattern', () => {
      Object.values(PERSONAS).forEach((persona) => {
        expect(persona.objectStoreNamespace).toMatch(/^cya_persona_/);
      });
    });
  });
});
