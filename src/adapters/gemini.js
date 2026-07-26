'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MoleculerError } = require('moleculer').Errors;

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

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

function getImageModelName() {
  return process.env.LLM_IMAGE_MODEL || process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
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

// Requests both modalities: Gemini image-generation models only return image
// parts when TEXT is also requested (an IMAGE-only request is rejected).
const IMAGE_GENERATION_CONFIG = { responseModalities: ['TEXT', 'IMAGE'] };

async function generateImage(prompt, options = {}) {
  const model = getClient().getGenerativeModel({
    model: options.model || getImageModelName(),
    generationConfig: IMAGE_GENERATION_CONFIG,
  });
  const result = await model.generateContent(prompt);
  const parts = result?.response?.candidates?.[0]?.content?.parts || [];

  const images = parts
    .filter((part) => part?.inlineData?.data)
    .map((part) => ({
      b64Json: part.inlineData.data,
      mimeType: part.inlineData.mimeType || 'image/png',
    }));

  if (images.length === 0) {
    throw new MoleculerError(
      'Gemini returned no image data for this prompt (it may have been blocked or the model only produced text).',
      502,
      'IMAGE_GENERATION_NO_IMAGE'
    );
  }

  const text = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return { images, text: text || null };
}

function capabilities() {
  return {
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: true,
    contextWindow: null,
  };
}

module.exports = {
  id: 'gemini',
  generateText,
  generateStructured,
  embeddings,
  generateImage,
  capabilities,
};
