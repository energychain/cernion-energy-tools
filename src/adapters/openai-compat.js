'use strict';

const axios = require('axios');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

function getBaseUrl() {
  return (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

function getModelName() {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

function getEmbeddingModelName() {
  return process.env.LLM_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

function buildHeaders() {
  const apiKey = process.env.LLM_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function post(path, body) {
  const response = await axios.post(`${getBaseUrl()}${path}`, body, {
    headers: buildHeaders(),
    timeout: Number(process.env.LLM_TIMEOUT_MS) || 30000,
  });
  return response.data;
}

async function generateText(prompt) {
  const data = await post('/chat/completions', {
    model: getModelName(),
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });

  return data?.choices?.[0]?.message?.content || '';
}

async function generateStructured(_schema, prompt, options = {}) {
  const mode = options.structuredMode || 'json';

  if (mode === 'tool') {
    return await generateText(prompt);
  }

  const data = await post('/chat/completions', {
    model: getModelName(),
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  return data?.choices?.[0]?.message?.content || '';
}

async function embeddings(texts) {
  const data = await post('/embeddings', {
    model: getEmbeddingModelName(),
    input: texts,
  });

  return Array.isArray(data?.data) ? data.data.map((item) => item.embedding || []) : [];
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
  id: 'openai-compat',
  generateText,
  generateStructured,
  embeddings,
  capabilities,
};
