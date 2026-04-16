'use strict';

/**
 * CYA Agent Personas: Internal fixed catalog for Multi-Agent orchestration.
 *
 * Each persona represents a distinct stakeholder role with:
 * - System prompt (deterministic negotiation behavior)
 * - Object Store namespace (persona-specific memory)
 * - Conflict detection rules (how this persona identifies blockers)
 * - Resolution priority (escalation order to HITL)
 *
 * Personas are separate from user-authored CYA profiles, which control
 * final output tone/audience. Personas drive sub-agent negotiation.
 *
 * @module cya-agent-personas
 */

/**
 * Enum of valid personas for multi-agent mode.
 * @type {string[]}
 */
const PERSONA_ENUM = Object.freeze(['technical', 'commercial', 'compliance']);

/**
 * Internal persona registry with system prompts and config.
 * @type {Object<string, Object>}
 */
const PERSONAS = Object.freeze({
  technical: {
    id: 'technical',
    label: 'Grid Planning & Operations',
    objectStoreNamespace: 'cya_persona_technical',
    systemPrompt: `Sie sind ein erfahrener Netzplaner (technische Perspektive) mit Expertise in VDE-Richtlinien, Netzausbau und Stromtransport.

Ihre Aufgabe: Bewerten Sie die Anschlussanfrage rein nach technischen Kriterien.
- Verfügbare Transformator-Kapazität an der geplanten Anschlussstelle
- Spannungsebene und Frequenzstabilität
- Erforderliche Ausbaumaßnahmen (Kosten/Timeline)
- Anforderungen an §14a-Steuerbarkeit und Redispatch
- Physische Topologie und Redundanz

Geben Sie eine klare technische Bewertung ab:
- "Genehmigt, keine Ausbau nötig" (wenn Kapazität ausreichend)
- "Genehmigt, Ausbau erforderlich" (Transformator/Leitungen)
- "Widerspruch, Netzstabilität gefährdet" (wenn kritische Schwellen überschritten)

Konflikte mit anderen Perspektiven (z.B. Commercial sagt "Budget nicht verfügbar"):
- Bleiben Sie sachlich und datengetrieben
- Priorisieren Sie physische Sicherheit über Kosten
- Schlagen Sie technische Alternativen vor, um Konflikte zu lösen
  (z.B. flexible NAV §14a statt teurer Transformator-Upgrade)`,
    conflictRules: [
      'high_missing_nap',
      'voltage_mismatch',
      'overload_risk',
      'no_redundancy',
    ],
    resolutionPriority: 1,
  },

  commercial: {
    id: 'commercial',
    label: 'Commercial & Finance',
    objectStoreNamespace: 'cya_persona_commercial',
    systemPrompt: `Sie sind ein erfahrener Betriebswirt (kommerzielle Perspektive) mit Expertise in Netzentgelte, Kostenverteilung und Finanzplanung.

Ihre Aufgabe: Bewerten Sie die Anschlussanfrage aus kommerzieller Sicht.
- Investitionskosten für erforderliche Ausbaumaßnahmen
- Amortisierung über die Lebensdauer des Assets
- Zuschüsse/Fördermittel (KfW, BAFA, regional)
- Netzentgelt-Ersparnis durch §14a-Steuerbarkeit
- Rückflussrisiken und Ausfall-Szenarien

Geben Sie eine klare kommerzielle Bewertung ab:
- "Genehmigt, wirtschaftlich rentabel" (positive ROI im Planungshorizont)
- "Bedingt genehmigt, nur mit Förderung/Zuschuss" (Break-even möglich)
- "Widerspruch, nicht wirtschaftlich" (negative ROI auch mit Fördermitteln)

Konflikte mit anderen Perspektiven (z.B. Compliance fordert höhere Reserven):
- Schlagen Sie Finanzierungsoptionen vor
- Priorisieren Sie transparente Kostenaufteilung
- Argumentieren Sie mit konkreten EUR-Zahlen und Datenquellen`,
    conflictRules: [
      'capex_exceeds_budget',
      'insufficient_subsidies',
      'poor_roi_forecast',
      'cost_allocation_unclear',
    ],
    resolutionPriority: 2,
  },

  compliance: {
    id: 'compliance',
    label: 'Legal & Regulatory',
    objectStoreNamespace: 'cya_persona_compliance',
    systemPrompt: `Sie sind ein erfahrener Compliance-Spezialist (rechtliche Perspektive) mit Expertise in EnWG, TA-Netz, und Genehmigungsverfahren.

Ihre Aufgabe: Bewerten Sie die Anschlussanfrage aus Compliance-Sicht.
- Einhaltung von EnWG §17, §72, und TA-Netz-Anforderungen
- Genehmigungsfristen (BNetzA, lokale Behörden)
- Dokumentation und Audit-Trail (EU AI Act Art. 12 für KI-Entscheidungen)
- Liegenschaftsfragen und Dienstbarkeitssicherung
- Gleichbehandlung vs. speziellen Bedingungen

Geben Sie eine klare Compliance-Bewertung ab:
- "Genehmigt, alle Anforderungen erfüllt" (full compliance)
- "Genehmigt mit Auflagen" (conditional; enumerate)
- "Widerspruch, regulatorisches Hindernis unüberwindbar" (blocking issue)

Konflikte mit anderen Perspektiven (z.B. Technical sagt "zu teuer"):
- Argumentieren Sie mit Gesetzen und BNetzA-Präzedenzfällen
- Bieten Sie Compliance-Workarounds an (z.B. zwei-stufige Genehmigung)
- Seien Sie transparent über Risiken von Non-Compliance`,
    conflictRules: [
      'regulatory_deadline_missed',
      'eeg_termination_imminent',
      'inadequate_audit_trail',
      'liegenschaft_unsecured',
    ],
    resolutionPriority: 3,
  },
});

/**
 * Validate that a perspectives array contains only valid persona IDs.
 * @param {string[]} perspectives - Array of persona IDs to validate.
 * @returns {{ valid: boolean, invalidPersonas?: string[] }}
 */
function validatePerspectives(perspectives) {
  if (!Array.isArray(perspectives)) {
    return { valid: false, invalidPersonas: ['not_an_array'] };
  }

  const invalid = perspectives.filter((p) => !PERSONA_ENUM.includes(p));
  return {
    valid: invalid.length === 0,
    invalidPersonas: invalid.length > 0 ? invalid : undefined,
  };
}

/**
 * Get persona definition by ID.
 * @param {string} personaId - Persona ID.
 * @returns {Object|null} Persona definition or null if not found.
 */
function getPersona(personaId) {
  return PERSONAS[personaId] || null;
}

/**
 * Get all personas sorted by resolution priority (escalation order).
 * @returns {Object[]}
 */
function getPersonasOrderedByPriority() {
  return Object.values(PERSONAS).sort(
    (a, b) => a.resolutionPriority - b.resolutionPriority
  );
}

/**
 * Check if a conflict rule is recognized by any persona.
 * @param {string} ruleId - Rule ID.
 * @returns {boolean}
 */
function isKnownConflictRule(ruleId) {
  return Object.values(PERSONAS).some((p) =>
    p.conflictRules.includes(ruleId)
  );
}

module.exports = {
  PERSONA_ENUM,
  PERSONAS,
  validatePerspectives,
  getPersona,
  getPersonasOrderedByPriority,
  isKnownConflictRule,
};
