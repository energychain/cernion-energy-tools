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

module.exports = {
  CYA_NARRATIVE_SCHEMA,
  buildPrompt,
  synthesizeNarrative,
};
