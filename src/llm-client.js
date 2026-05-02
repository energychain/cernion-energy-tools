'use strict';

/**
 * Centralized LLM Client (v0.23)
 *
 * Single entry-point for all Google Gemini calls in the Cernion backend.
 * Provides:
 *   - generateText(prompt)                 — free-form text generation
 *   - generateStructured(schema, prompt)   — structured JSON output (responseSchema)
 *
 * Guarantees:
 *   - PII scrubbing via prompt-scrubber before every call (EU AI Act Art. 12)
 *   - HTTP 503 MoleculerError when GEMINI_API_KEY is not configured, so services
 *     can return a clean error to the frontend instead of crashing
 *   - Single point for future model-swap (Claude, Mistral) or rate-limit retry logic
 *
 * @module llm-client
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const { MoleculerError } = require('moleculer').Errors;
const { scrubPromptText } = require('./prompt-scrubber');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return the configured Gemini API key, or throw HTTP 503 LLM_NOT_CONFIGURED.
 * @returns {string}
 */
function requireApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new MoleculerError(
      'Cernion KI-Funktionen erfordern einen konfigurierten API-Key (GEMINI_API_KEY).',
      503,
      'LLM_NOT_CONFIGURED'
    );
  }
  return key;
}

/**
 * Build and return a GoogleGenerativeAI model instance.
 * @param {object} [generationConfig={}]  Optional generation config override.
 * @returns {import('@google/generative-ai').GenerativeModel}
 */
function buildModel(generationConfig = {}) {
  const apiKey = requireApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate free-form text from a prompt.
 * PII is scrubbed from the prompt before the call (EU AI Act Art. 12).
 *
 * @param {string} prompt  The user prompt (may contain PII — will be scrubbed).
 * @returns {Promise<string>}  Raw response text from the model.
 * @throws {MoleculerError}  503 LLM_NOT_CONFIGURED if GEMINI_API_KEY is not set.
 */
async function generateText(prompt) {
  const model = buildModel();
  const result = await model.generateContent(scrubPromptText(prompt));
  return result.response.text();
}

/**
 * Generate a structured JSON response from a prompt using Gemini responseSchema.
 * PII is scrubbed from the prompt before the call (EU AI Act Art. 12).
 *
 * @param {object} responseSchema  Gemini SchemaType-compatible schema object.
 * @param {string} prompt          The prompt (may contain PII — will be scrubbed).
 * @returns {Promise<object>}  Parsed JSON object conforming to responseSchema.
 * @throws {MoleculerError}  503 LLM_NOT_CONFIGURED if GEMINI_API_KEY is not set.
 * @throws {SyntaxError}     If the model returns non-parseable JSON (unexpected).
 */
async function generateStructured(responseSchema, prompt) {
  const model = buildModel({
    responseMimeType: 'application/json',
    responseSchema,
  });
  const result = await model.generateContent(scrubPromptText(prompt));
  return JSON.parse(result.response.text());
}

module.exports = { SchemaType, generateText, generateStructured };
