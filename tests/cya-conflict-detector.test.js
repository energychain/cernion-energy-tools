'use strict';

const {
  MAX_DIALOGUE_ROUNDS,
  detectConflicts,
  buildNegotiationPrompt,
} = require('../src/cya-conflict-detector');

describe('cya-conflict-detector', () => {
  describe('MAX_DIALOGUE_ROUNDS', () => {
    it('is 3', () => {
      expect(MAX_DIALOGUE_ROUNDS).toBe(3);
    });
  });

  describe('detectConflicts', () => {
    it('detects no conflict when all approved', () => {
      const states = {
        technical: { verdict: 'approved', summary: 'ok', conflictTriggers: [] },
        commercial: { verdict: 'conditional', summary: 'ok', conflictTriggers: [] },
      };
      expect(detectConflicts(states).hasConflict).toBe(false);
    });

    it('detects no conflict when all blocked', () => {
      const states = {
        technical: { verdict: 'blocked', summary: 'no', conflictTriggers: ['overload_risk'] },
        commercial: { verdict: 'blocked', summary: 'no', conflictTriggers: ['poor_roi_forecast'] },
      };
      expect(detectConflicts(states).hasConflict).toBe(false);
    });

    it('detects conflict when one blocked and one approved', () => {
      const states = {
        technical: { verdict: 'blocked', summary: 'overload', conflictTriggers: ['overload_risk'] },
        commercial: { verdict: 'approved', summary: 'roi ok', conflictTriggers: [] },
      };
      const result = detectConflicts(states);
      expect(result.hasConflict).toBe(true);
      expect(result.blockers).toContain('technical');
      expect(result.approvers).toContain('commercial');
    });

    it('detects conflict with conditional approver', () => {
      const states = {
        compliance: {
          verdict: 'blocked',
          summary: 'deadline missed',
          conflictTriggers: ['regulatory_deadline_missed'],
        },
        technical: { verdict: 'conditional', summary: 'needs upgrade', conflictTriggers: [] },
      };
      const result = detectConflicts(states);
      expect(result.hasConflict).toBe(true);
      expect(result.blockers).toContain('compliance');
    });

    it('collects all conflict triggers from blockers', () => {
      const states = {
        technical: { verdict: 'blocked', conflictTriggers: ['overload_risk', 'voltage_mismatch'] },
        commercial: { verdict: 'blocked', conflictTriggers: ['capex_exceeds_budget'] },
        compliance: { verdict: 'approved', conflictTriggers: [] },
      };
      const result = detectConflicts(states);
      expect(result.triggers).toContain('overload_risk');
      expect(result.triggers).toContain('voltage_mismatch');
      expect(result.triggers).toContain('capex_exceeds_budget');
    });

    it('deduplicates triggers', () => {
      const states = {
        technical: { verdict: 'blocked', conflictTriggers: ['overload_risk', 'overload_risk'] },
        commercial: { verdict: 'approved', conflictTriggers: [] },
      };
      const result = detectConflicts(states);
      const count = result.triggers.filter((t) => t === 'overload_risk').length;
      expect(count).toBe(1);
    });

    it('handles empty stakeholderStates', () => {
      expect(detectConflicts({}).hasConflict).toBe(false);
      expect(detectConflicts(null).hasConflict).toBe(false);
    });

    it('handles missing conflictTriggers gracefully', () => {
      const states = {
        technical: { verdict: 'blocked', summary: 'issue' },
        commercial: { verdict: 'approved', summary: 'ok' },
      };
      const result = detectConflicts(states);
      expect(result.hasConflict).toBe(true);
      expect(result.triggers).toEqual([]);
    });
  });

  describe('buildNegotiationPrompt', () => {
    const conflict = {
      blockers: ['technical'],
      approvers: ['commercial'],
      triggers: ['overload_risk'],
    };
    const states = {
      technical: {
        verdict: 'blocked',
        summary: 'Overload at transformer',
        conflictTriggers: ['overload_risk'],
      },
      commercial: { verdict: 'approved', summary: 'ROI positive', conflictTriggers: [] },
    };
    const facts = [
      { focusArea: 'capacity', statement: 'Current load 85% of rated capacity' },
      { focusArea: 'investment', statement: 'Estimated upgrade cost 120k EUR' },
    ];

    it('includes mediator framing', () => {
      const prompt = buildNegotiationPrompt(conflict, states, facts);
      expect(prompt).toContain('Mediator');
    });

    it('includes blocker details', () => {
      const prompt = buildNegotiationPrompt(conflict, states, facts);
      expect(prompt).toContain('TECHNICAL');
      expect(prompt).toContain('BLOCKIERT');
      expect(prompt).toContain('overload_risk');
    });

    it('includes approver details', () => {
      const prompt = buildNegotiationPrompt(conflict, states, facts);
      expect(prompt).toContain('COMMERCIAL');
    });

    it('includes shared facts', () => {
      const prompt = buildNegotiationPrompt(conflict, states, facts);
      expect(prompt).toContain('capacity');
      expect(prompt).toContain('Current load 85%');
    });

    it('limits shared facts to 10', () => {
      const manyFacts = Array.from({ length: 20 }, (_, i) => ({
        focusArea: `area_${i}`,
        statement: `statement_${i}`,
      }));
      const prompt = buildNegotiationPrompt(conflict, states, manyFacts);
      // Should not include all 20 areas
      const areaCount = (prompt.match(/area_\d+/g) || []).length;
      expect(areaCount).toBeLessThanOrEqual(10);
    });

    it('handles empty facts gracefully', () => {
      const prompt = buildNegotiationPrompt(conflict, states, []);
      expect(prompt).toContain('Keine Fakten');
    });

    it('handles null facts gracefully', () => {
      const prompt = buildNegotiationPrompt(conflict, states, null);
      expect(prompt).toContain('Keine Fakten');
    });

    it('returns JSON schema reminder', () => {
      const prompt = buildNegotiationPrompt(conflict, states, facts);
      expect(prompt).toContain('JSON');
    });
  });
});
