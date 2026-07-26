'use strict';

const axios = require('axios');
const { MoleculerError } = require('moleculer').Errors;

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

function getBaseUrl() {
  return (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getModelName() {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

function getEmbeddingModelName() {
  return process.env.LLM_EMBEDDING_MODEL || getModelName() || DEFAULT_EMBEDDING_MODEL;
}

async function generateText(prompt) {
  const response = await axios.post(
    `${getBaseUrl()}/api/generate`,
    {
      model: getModelName(),
      prompt,
      stream: false,
    },
    { timeout: Number(process.env.LLM_TIMEOUT_MS) || 30000 }
  );

  return response?.data?.response || '';
}

async function generateStructured(_schema, prompt, options = {}) {
  const mode = options.structuredMode || 'json';
  const body = {
    model: getModelName(),
    prompt,
    stream: false,
  };

  if (mode === 'schema' || mode === 'json' || mode === 'tool') {
    body.format = 'json';
  }

  const response = await axios.post(`${getBaseUrl()}/api/generate`, body, {
    timeout: Number(process.env.LLM_TIMEOUT_MS) || 30000,
  });
  return response?.data?.response || '';
}

async function embeddings(texts) {
  const vectors = [];

  for (const text of texts) {
    const response = await axios.post(
      `${getBaseUrl()}/api/embeddings`,
      {
        model: getEmbeddingModelName(),
        prompt: String(text || ''),
      },
      { timeout: Number(process.env.LLM_TIMEOUT_MS) || 30000 }
    );
    vectors.push(response?.data?.embedding || []);
  }

  return vectors;
}

async function generateImage() {
  throw new MoleculerError(
    'The configured Ollama provider does not support image generation.',
    503,
    'IMAGE_GENERATION_NOT_SUPPORTED'
  );
}

function capabilities() {
  return {
    structured: true,
    embeddings: true,
    vision: false,
    imageGeneration: false,
    contextWindow: null,
  };
}

module.exports = {
  id: 'ollama',
  generateText,
  generateStructured,
  embeddings,
  generateImage,
  capabilities,
};
