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

  return [
    'Du bist ein Senior-Policy-Advisor für deutsche Energiewirtschaft.',
    'Erstelle eine belastbare, diplomatische und rechtssichere Argumentation.',
    'Nutze nur die übergebenen Fakten. Keine erfundenen Zahlen oder Quellen.',
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
