'use strict';

/**
 * Blueprint Policy Interpreter
 *
 * Reads optional routingPolicy and synthesisPolicy fields from a blueprint document
 * and produces runtime directives for routing stickiness and synthesis framing.
 *
 * Zero hardcoded domain logic — all behavior is driven by the blueprint's declarations.
 * Internal policy names (e.g. "tool_failure_as_main_answer", "municipal_energy_site_precheck")
 * are rendered as natural German instructions and must not appear verbatim in LLM output.
 */

/**
 * Extracts routingPolicy and synthesisPolicy from a blueprint.
 * Returns { routingPolicy: null, synthesisPolicy: null } for blueprints without these fields.
 *
 * @param {object|null} blueprint
 * @returns {{ routingPolicy: object|null, synthesisPolicy: object|null }}
 */
function extractBlueprintPolicy(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') {
    return { routingPolicy: null, synthesisPolicy: null };
  }
  return {
    routingPolicy: blueprint.routingPolicy || null,
    synthesisPolicy: blueprint.synthesisPolicy || null,
  };
}

/**
 * Decides whether the current turn should retain the session's active routing intent.
 * Returns { retain: boolean, reason: string }.
 *
 * @param {object|null} sessionPolicy - routingPolicy stored in session.l3.activeRoutingPolicy
 * @param {string}      message       - current user message
 * @param {number}      turnsElapsed  - turns since the policy was first activated
 */
function checkStickinessRetain(sessionPolicy, message, turnsElapsed) {
  if (!sessionPolicy || typeof sessionPolicy !== 'object') {
    return { retain: false, reason: 'no_policy' };
  }

  const stickiness = sessionPolicy.stickiness;
  if (!stickiness || typeof stickiness !== 'object') {
    return { retain: false, reason: 'no_stickiness' };
  }

  const retainForTurns =
    typeof stickiness.retainForTurns === 'number' ? stickiness.retainForTurns : 0;
  if (retainForTurns <= 0) {
    return { retain: false, reason: 'stickiness_disabled' };
  }
  if (typeof turnsElapsed === 'number' && turnsElapsed >= retainForTurns) {
    return { retain: false, reason: 'stickiness_expired' };
  }

  const negativeSignals = Array.isArray(stickiness.unlessNegativeSignals)
    ? stickiness.unlessNegativeSignals
    : [];

  if (negativeSignals.length > 0) {
    const lowerMessage = String(message || '').toLowerCase();
    for (const signal of negativeSignals) {
      if (lowerMessage.includes(String(signal).toLowerCase())) {
        return { retain: false, reason: `negative_signal:${signal}` };
      }
    }
  }

  return { retain: true, reason: 'stickiness_active' };
}

/**
 * Builds synthesis directive lines to inject into the consultation prompt's facts array.
 *
 * Both routingPolicy (for session-intent stickiness note) and synthesisPolicy (for framing
 * rules) contribute to the output. Internal keys never surface verbatim in LLM output because
 * they are placed in the system prompt only, not in assistant replies.
 *
 * @param {object|null} synthesisPolicy
 * @param {object|null} routingPolicy  - optional, used to inject the stickiness note
 * @returns {string[]}
 */
function buildSynthesisPolicyDirectives(synthesisPolicy, routingPolicy) {
  const lines = [];

  // Stickiness note (from routingPolicy): keep the session thread
  if (routingPolicy && routingPolicy.stickiness && routingPolicy.sessionIntent) {
    lines.push(
      `- Aktives Sitzungsthema: ${routingPolicy.sessionIntent} — Gesprächsfaden beibehalten, sofern der Nutzer kein anderes Thema anstößt.`
    );
  }

  if (!synthesisPolicy || typeof synthesisPolicy !== 'object') {
    return lines;
  }

  if (synthesisPolicy.responseFrame) {
    lines.push(`- Antwortrahmen: ${synthesisPolicy.responseFrame}`);
  }

  const leadWith = Array.isArray(synthesisPolicy.leadWith) ? synthesisPolicy.leadWith : [];
  if (leadWith.length > 0) {
    lines.push(`- Beginne mit: ${leadWith.join(', ')}`);
  }

  const deprioritize = Array.isArray(synthesisPolicy.deprioritize)
    ? synthesisPolicy.deprioritize
    : [];
  if (deprioritize.includes('tool_failure_as_main_answer')) {
    lines.push(
      '- Tool-Fehler oder fehlende Daten sind Evidenzlücken ("noch nicht verifiziert"), nie die Hauptantwort.'
    );
  }

  const mustMention = Array.isArray(synthesisPolicy.mustMention) ? synthesisPolicy.mustMention : [];
  if (mustMention.length > 0) {
    lines.push(`- Inhaltliche Hinweise: ${mustMention.join(', ')}`);
  }

  const askFor = Array.isArray(synthesisPolicy.askFor) ? synthesisPolicy.askFor : [];
  if (askFor.length > 0) {
    lines.push(`- Frage nach: ${askFor.join(', ')}`);
  }

  return lines;
}

/**
 * Resolves the active blueprint policy for the current turn.
 *
 * Priority:
 *   1. freshly matched blueprint (routingPolicy / synthesisPolicy from its JSON)
 *   2. session-stored policy (l3.activeRoutingPolicy / l3.activeSynthesisPolicy)
 *
 * @param {object|null} matchedBlueprint - blueprint matched this turn (may be null)
 * @param {object}      session          - session object; reads l3.activeRoutingPolicy as fallback
 * @returns {{ routingPolicy: object|null, synthesisPolicy: object|null }}
 */
function resolveActivePolicy(matchedBlueprint, session) {
  const fromBlueprint = extractBlueprintPolicy(matchedBlueprint);
  if (fromBlueprint.routingPolicy || fromBlueprint.synthesisPolicy) {
    return fromBlueprint;
  }

  const sessionRoutingPolicy = session && session.l3 ? session.l3.activeRoutingPolicy || null : null;
  if (sessionRoutingPolicy) {
    return {
      routingPolicy: sessionRoutingPolicy,
      synthesisPolicy:
        session && session.l3 ? session.l3.activeSynthesisPolicy || null : null,
    };
  }

  return { routingPolicy: null, synthesisPolicy: null };
}

/**
 * Filters missingInputs by removing entries whose param matches a doNotAskFor entry.
 * Matching is case-insensitive and normalises underscores/hyphens/spaces.
 * Exported for reuse in tests and other modules.
 *
 * @param {object[]} missingInputs
 * @param {string[]} doNotAskFor
 * @returns {object[]}
 */
function filterSuppressedInputs(missingInputs, doNotAskFor) {
  if (!Array.isArray(doNotAskFor) || doNotAskFor.length === 0) return missingInputs;
  const norm = (s) => String(s || '').toLowerCase().replace(/[_\s-]+/g, '');
  return (Array.isArray(missingInputs) ? missingInputs : []).filter((missing) => {
    const normParam = norm(missing.param);
    return !doNotAskFor.some((excluded) => {
      const normExcluded = norm(excluded);
      return (
        normParam === normExcluded ||
        normExcluded.includes(normParam) ||
        normParam.includes(normExcluded)
      );
    });
  });
}

module.exports = {
  extractBlueprintPolicy,
  checkStickinessRetain,
  buildSynthesisPolicyDirectives,
  resolveActivePolicy,
  filterSuppressedInputs,
};
