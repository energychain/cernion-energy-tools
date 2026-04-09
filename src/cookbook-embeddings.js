'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { scrubPromptText } = require('./prompt-scrubber');

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

let embeddingModel;

function getEmbeddingModel() {
  if (embeddingModel) return embeddingModel;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  return embeddingModel;
}

function buildSearchText(recipe) {
  const processText = (recipe.process || [])
    .map((step) => {
      const parts = [step.action, step.description, step.expectedOutput, step.restPath].filter(
        Boolean
      );
      return parts.join(' | ');
    })
    .join(' || ');

  return [
    recipe.title,
    recipe.domain,
    Array.isArray(recipe.tags) ? recipe.tags.join(' ') : '',
    recipe.problem,
    recipe.expectedResult,
    processText,
  ]
    .filter(Boolean)
    .join('\n');
}

async function computeEmbedding(text) {
  const model = getEmbeddingModel();
  if (!model) return null;

  const cleaned = scrubPromptText(String(text || '')).trim();
  if (!cleaned) return null;

  const response = await model.embedContent(cleaned);
  return Array.isArray(response?.embedding?.values) ? response.embedding.values : null;
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  if (vecA.length === 0 || vecA.length !== vecB.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s-]+/gi, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function keywordScore(query, candidateText) {
  const queryTokens = new Set(tokenize(query));
  const candidateTokens = new Set(tokenize(candidateText));

  if (!queryTokens.size || !candidateTokens.size) return 0;

  let overlap = 0;
  queryTokens.forEach((token) => {
    if (candidateTokens.has(token)) overlap += 1;
  });

  return overlap / queryTokens.size;
}

module.exports = {
  EMBEDDING_MODEL,
  buildSearchText,
  computeEmbedding,
  cosineSimilarity,
  keywordScore,
};
