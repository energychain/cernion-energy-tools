'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MoleculerError } = require('moleculer').Errors;

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

function requireGeminiApiKey() {
  const key = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new MoleculerError(
      'Cernion KI-Funktionen erfordern einen konfigurierten API-Key (LLM_API_KEY oder GEMINI_API_KEY).',
      503,
      'LLM_NOT_CONFIGURED'
    );
  }
  return key;
}

function getModelName() {
  return process.env.LLM_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function getEmbeddingModelName() {
  return (
    process.env.LLM_EMBEDDING_MODEL || process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL
  );
}

function getClient() {
  const apiKey = requireGeminiApiKey();
  return new GoogleGenerativeAI(apiKey);
}

async function generateText(prompt) {
  const model = getClient().getGenerativeModel({ model: getModelName() });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateStructured(schema, prompt, options = {}) {
  const mode = options.structuredMode || 'schema';

  if (mode === 'json' || mode === 'tool') {
    return await generateText(prompt);
  }

  const model = getClient().getGenerativeModel({
    model: getModelName(),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function embeddings(texts) {
  const model = getClient().getGenerativeModel({ model: getEmbeddingModelName() });
  const vectors = [];

  for (const text of texts) {
    const response = await model.embedContent(String(text || ''));
    vectors.push(Array.isArray(response?.embedding?.values) ? response.embedding.values : []);
  }

  return vectors;
}

function capabilities() {
  return {
    structured: true,
    embeddings: true,
    vision: false,
    contextWindow: null,
  };
}

module.exports = {
  id: 'gemini',
  generateText,
  generateStructured,
  embeddings,
  capabilities,
};
