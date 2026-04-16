'use strict';

const { generateStructured, SchemaType } = require('./llm-client');
const { scrubForLLM } = require('./prompt-scrubber');

const CYA_NARRATIVE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    headline: { type: SchemaType.STRING },
    executiveSummary: { type: SchemaType.STRING },
    keyPoints: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    recommendedActions: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    riskNotes: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: ['headline', 'executiveSummary', 'keyPoints', 'recommendedActions', 'riskNotes'],
};

function buildPrompt(payload) {
  const profile = payload?.profile || {};
  const context = payload?.context || {};
  const grounding = payload?.grounding || {};
  const regulatoryGraph = payload?.regulatoryGraph || {};
  const mode = payload?.mode || 'generate';
  const userFeedback = payload?.userFeedback || '';

  const scrubInput = {
    actor: profile.actor || {},
    strategicGoals: profile.strategic_goals || [],
    tone: profile.tone || 'diplomatisch, rechtssicher',
    targetAudience: payload?.target_audience || 'allgemein',
    context,
    grounding,
    regulatoryGraph,
    userFeedback,
  };
  const scrubbed = scrubForLLM(scrubInput).scrubbed;

  // EU AI Act Art. 12 — XAI guardrail:
  // Annotate user-asserted facts so the LLM cannot represent them as
  // machine-verified data. The marker is injected into the serialised prompt
  // text, not just stored in metadata, because the LLM reads only text.
  if (Array.isArray(scrubbed?.grounding?.facts)) {
    scrubbed.grounding.facts = scrubbed.grounding.facts.map((fact) => {
      if (fact.trusted === true) {
        return {
          ...fact,
          statement: `[Nutzerangabe – nicht maschinell verifiziert] ${fact.statement}`,
        };
      }
      return fact;
    });
  }

  return [
    'Du bist ein Senior-Policy-Advisor für deutsche Energiewirtschaft.',
    'Erstelle eine belastbare, diplomatische und rechtssichere Argumentation.',
    'Nutze nur die übergebenen Fakten. Keine erfundenen Zahlen oder Quellen.',
    'WICHTIG: Fakten mit dem Präfix "[Nutzerangabe – nicht maschinell verifiziert]" stammen von einem menschlichen Nutzer und wurden NICHT durch offizielle Datenquellen (MaStR, BNetzA, OSM) bestätigt. Kennzeichne diese im Text als Behauptungen oder Angaben des Auftraggebers – niemals als amtliche Messung oder Behördenaussage.',
    `Modus: ${mode}.`,
    `Eingabedaten:\n${JSON.stringify(scrubbed, null, 2)}`,
    'Antwort NUR als JSON gemäß Schema.',
  ].join('\n\n');
}

async function synthesizeNarrative(payload) {
  const prompt = buildPrompt(payload);
  const response = await generateStructured(CYA_NARRATIVE_SCHEMA, prompt);

  return {
    generatedAt: new Date().toISOString(),
    narrative: {
      headline: String(response?.headline || '').trim(),
      executiveSummary: String(response?.executiveSummary || '').trim(),
      keyPoints: Array.isArray(response?.keyPoints) ? response.keyPoints : [],
      recommendedActions: Array.isArray(response?.recommendedActions)
        ? response.recommendedActions
        : [],
      riskNotes: Array.isArray(response?.riskNotes) ? response.riskNotes : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Per-persona evaluation schema & synthesis (multi-agent mode)
// ---------------------------------------------------------------------------

const CYA_PERSONA_EVALUATION_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    verdict: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    conflictTriggers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    keyPoints: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    riskNotes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: ['verdict', 'summary', 'conflictTriggers', 'keyPoints', 'riskNotes'],
};

function buildPersonaEvaluationPrompt(payload) {
  const persona = payload.persona || {};
  const profile = payload.profile || {};
  const context = payload.context || {};
  const grounding = payload.grounding || {};
  const regulatoryGraph = payload.regulatoryGraph || {};

  const factsSnippet = Array.isArray(grounding.facts)
    ? grounding.facts.slice(0, 8)
    : [];

  const memoryHint = grounding.personaMemoryHint
    ? `\n\nHINTERGRUND-ERINNERUNGEN:\n${grounding.personaMemoryHint}`
    : '';

  return [
    persona.systemPrompt || '',
    '',
    `Stakeholder-Profil: ${JSON.stringify({ actor: profile.actor, strategic_goals: profile.strategic_goals })}`,
    `Zielgruppe: ${payload.target_audience || 'allgemein'}`,
    `Kontext: ${JSON.stringify(context)}`,
    `Fakten (${factsSnippet.length}): ${JSON.stringify(factsSnippet)}`,
    `Konfidenz: ${grounding.confidence || 'low'}`,
    `Regulatorische Signale: ${JSON.stringify((regulatoryGraph.signals || []).slice(0, 8))}`,
    memoryHint,
    '',
    'Verdict MUSS eines sein von: approved, conditional, blocked.',
    'Antwort NUR als JSON gemäß Schema.',
  ].join('\n');
}

/**
 * Synthesize a single-persona evaluation (verdict + key points).
 *
 * @param {{ persona: Object, profile: Object, target_audience: string, context: Object, grounding: Object, regulatoryGraph: Object }} payload
 * @returns {Promise<{ personaId: string, personaLabel: string, verdict: string, summary: string, conflictTriggers: string[], keyPoints: string[], riskNotes: string[] }>}
 */
async function synthesizePersonaEvaluation(payload) {
  const VALID_VERDICTS = ['approved', 'conditional', 'blocked'];
  const prompt = buildPersonaEvaluationPrompt(payload);
  const response = await generateStructured(CYA_PERSONA_EVALUATION_SCHEMA, prompt);

  return {
    personaId: payload.persona?.id || 'unknown',
    personaLabel: payload.persona?.label || '',
    verdict: VALID_VERDICTS.includes(response?.verdict) ? response.verdict : 'conditional',
    summary: String(response?.summary || '').trim(),
    conflictTriggers: Array.isArray(response?.conflictTriggers)
      ? response.conflictTriggers
      : [],
    keyPoints: Array.isArray(response?.keyPoints) ? response.keyPoints : [],
    riskNotes: Array.isArray(response?.riskNotes) ? response.riskNotes : [],
  };
}

// ---------------------------------------------------------------------------
// Consensus schema & synthesis (multi-agent negotiation)
// ---------------------------------------------------------------------------

const CYA_CONSENSUS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    headline: { type: SchemaType.STRING },
    executiveSummary: { type: SchemaType.STRING },
    keyPoints: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    recommendedActions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    riskNotes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    consensusReached: { type: SchemaType.BOOLEAN },
    unresolvedConflicts: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: [
    'headline',
    'executiveSummary',
    'keyPoints',
    'recommendedActions',
    'riskNotes',
    'consensusReached',
    'unresolvedConflicts',
  ],
};

function buildConsensusPrompt(payload) {
  const { stakeholderStates, sharedFacts, profile, target_audience, context, round } =
    payload;

  const statesStr = Object.entries(stakeholderStates || {})
    .map(([id, s]) => {
      const points = (s.keyPoints || []).slice(0, 2).join('; ');
      return `${id.toUpperCase()} [${s.verdict || '?'}]: ${s.summary || ''}\n  Kernpunkte: ${points}`;
    })
    .join('\n\n');

  const factsStr = Array.isArray(sharedFacts)
    ? sharedFacts
        .slice(0, 8)
        .map((f) => `- ${f.focusArea}: ${f.statement}`)
        .join('\n')
    : 'Keine Fakten verfügbar.';

  return [
    'Du bist ein Senior-Policy-Advisor. Erstelle eine Konsens-Argumentation über alle Stakeholder-Perspektiven.',
    `Verhandlungsrunde: ${round || 1} von 3`,
    `Profil: ${JSON.stringify({ actor: profile?.actor, tone: profile?.tone || 'diplomatisch' })}`,
    `Zielgruppe: ${target_audience || 'allgemein'}`,
    `Kontext: ${JSON.stringify(context || {})}`,
    '',
    `STAKEHOLDER-POSITIONEN:\n${statesStr}`,
    '',
    `GETEILTE FAKTEN:\n${factsStr}`,
    '',
    'Setze consensusReached=true wenn ein Kompromiss über alle Positionen möglich ist.',
    'Setze consensusReached=false und liste unresolvedConflicts wenn grundlegende Widersprüche bestehen.',
    'Antwort NUR als JSON gemäß Schema.',
  ].join('\n');
}

/**
 * Synthesize a consensus narrative from multiple stakeholder states.
 * Used in multi-agent negotiation rounds to attempt conflict resolution.
 *
 * @param {{ stakeholderStates: Object, sharedFacts: Object[], profile: Object, target_audience: string, context: Object, round?: number }} payload
 * @returns {Promise<{ generatedAt: string, consensusReached: boolean, unresolvedConflicts: string[], narrative: Object }>}
 */
async function synthesizeConsensusWith(payload) {
  const prompt = buildConsensusPrompt(payload);
  const response = await generateStructured(CYA_CONSENSUS_SCHEMA, prompt);

  return {
    generatedAt: new Date().toISOString(),
    consensusReached: response?.consensusReached === true,
    unresolvedConflicts: Array.isArray(response?.unresolvedConflicts)
      ? response.unresolvedConflicts
      : [],
    narrative: {
      headline: String(response?.headline || '').trim(),
      executiveSummary: String(response?.executiveSummary || '').trim(),
      keyPoints: Array.isArray(response?.keyPoints) ? response.keyPoints : [],
      recommendedActions: Array.isArray(response?.recommendedActions)
        ? response.recommendedActions
        : [],
      riskNotes: Array.isArray(response?.riskNotes) ? response.riskNotes : [],
    },
  };
}

module.exports = {
  CYA_NARRATIVE_SCHEMA,
  CYA_PERSONA_EVALUATION_SCHEMA,
  CYA_CONSENSUS_SCHEMA,
  buildPrompt,
  synthesizeNarrative,
  synthesizePersonaEvaluation,
  synthesizeConsensusWith,
};
