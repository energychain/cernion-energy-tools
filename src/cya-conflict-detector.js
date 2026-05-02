'use strict';

/**
 * CYA Multi-Agent Conflict Detector.
 *
 * Detects mutually exclusive stakeholder positions (e.g., one persona blocks
 * while another approves) and builds LLM negotiation prompts to attempt
 * automated resolution before escalating to the human operator (HITL).
 *
 * @module cya-conflict-detector
 */

/** Maximum LLM-mediated negotiation rounds before HITL escalation. */
const MAX_DIALOGUE_ROUNDS = 3;

const BLOCKING_VERDICT = 'blocked';
const APPROVED_VERDICTS = ['approved', 'conditional'];

/**
 * Detect conflicts in a set of stakeholder states.
 * A conflict exists when at least one persona is `blocked` while at least one
 * other persona is `approved` or `conditional`.
 *
 * @param {Object.<string, { verdict: string, summary: string, conflictTriggers: string[] }>} stakeholderStates
 * @returns {{ hasConflict: boolean, blockers: string[], approvers: string[], triggers: string[] }}
 */
function detectConflicts(stakeholderStates) {
  const entries = Object.entries(stakeholderStates || {});

  const blockers = entries.filter(([, s]) => s?.verdict === BLOCKING_VERDICT).map(([id]) => id);

  const approvers = entries
    .filter(([, s]) => APPROVED_VERDICTS.includes(s?.verdict))
    .map(([id]) => id);

  const triggers = [
    ...new Set(blockers.flatMap((id) => stakeholderStates[id]?.conflictTriggers || [])),
  ];

  return {
    hasConflict: blockers.length > 0 && approvers.length > 0,
    blockers,
    approvers,
    triggers,
  };
}

/**
 * Build a prompt for LLM-mediated conflict negotiation.
 * The prompt frames the mediator role, presents blocking and approving
 * positions with their conflict triggers, and provides the shared fact base.
 *
 * @param {{ blockers: string[], approvers: string[], triggers: string[] }} conflict
 * @param {Object.<string, Object>} stakeholderStates - Full states per personaId
 * @param {Object[]} sharedFacts - Facts from the baseline grounding
 * @returns {string}
 */
function buildNegotiationPrompt(conflict, stakeholderStates, sharedFacts) {
  const blockerDetails = conflict.blockers
    .map((id) => {
      const s = stakeholderStates[id] || {};
      const triggers = (s.conflictTriggers || []).join(', ') || 'keine';
      return `${id.toUpperCase()}: BLOCKIERT\nBegründung: ${s.summary || 'Kein Detail'}\nKonflikttrigger: ${triggers}`;
    })
    .join('\n\n');

  const approverDetails = conflict.approvers
    .map((id) => {
      const s = stakeholderStates[id] || {};
      return `${id.toUpperCase()}: ${(s.verdict || 'conditional').toUpperCase()} — ${s.summary || ''}`;
    })
    .join('\n');

  const factsStr =
    Array.isArray(sharedFacts) && sharedFacts.length > 0
      ? sharedFacts
          .slice(0, 10)
          .map((f) => `- ${f.focusArea}: ${f.statement}`)
          .join('\n')
      : 'Keine Fakten verfügbar.';

  return [
    'Sie sind ein neutraler Mediator zwischen widerstreitenden Stakeholder-Perspektiven.',
    'Analysieren Sie den Konflikt und schlagen Sie eine konsensfähige Lösung vor.',
    'Nutzen Sie ausschließlich die übergebenen Fakten — keine erfundenen Kompromisse.',
    '',
    `BLOCKIERENDE POSITIONEN:\n${blockerDetails}`,
    '',
    `GENEHMIGENDE POSITIONEN:\n${approverDetails}`,
    '',
    `GETEILTE FAKTENBASIS:\n${factsStr}`,
    '',
    'Antwort NUR als JSON gemäß Schema.',
  ].join('\n');
}

module.exports = {
  MAX_DIALOGUE_ROUNDS,
  detectConflicts,
  buildNegotiationPrompt,
};
