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

const { SchemaType } = require('@google/generative-ai');
const { MoleculerError } = require('moleculer').Errors;
const metrics = require('./metrics');
const { scrubPromptText } = require('./prompt-scrubber');
const tracing = require('./tracing');
const { getObservabilityContext } = require('./observability-context');
const geminiAdapter = require('./adapters/gemini');
const openAiCompatAdapter = require('./adapters/openai-compat');
const ollamaAdapter = require('./adapters/ollama');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return configured provider id.
 * @returns {string}
 */
function getProviderId() {
  return (process.env.LLM_PROVIDER || 'gemini').trim().toLowerCase();
}

function getStructuredMode() {
  const mode = (process.env.LLM_STRUCTURED_MODE || 'schema').trim().toLowerCase();
  return ['schema', 'json', 'tool'].includes(mode) ? mode : 'schema';
}

function getTimeoutMs(options = {}) {
  const timeout = Number(options.timeoutMs ?? process.env.LLM_TIMEOUT_MS ?? 30000);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 30000;
}

function getMaxRetries(options = {}) {
  const retries = Number(options.maxRetries ?? process.env.LLM_MAX_RETRIES ?? 1);
  if (!Number.isFinite(retries) || retries < 1) return 1;
  return Math.floor(retries);
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`LLM timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function withRetries(task, options = {}) {
  const retries = getMaxRetries(options);
  const timeoutMs = getTimeoutMs(options);

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await withTimeout(task(), timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const waitMs = Math.min(250 * attempt, 1000);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError;
}

function getAdapter() {
  const providers = {
    gemini: geminiAdapter,
    openai: openAiCompatAdapter,
    'openai-compat': openAiCompatAdapter,
    azure: openAiCompatAdapter,
    ollama: ollamaAdapter,
  };

  const providerId = getProviderId();
  const adapter = providers[providerId];
  if (!adapter) {
    throw new MoleculerError(
      `Unbekannter LLM Provider: ${providerId}`,
      503,
      'LLM_PROVIDER_NOT_SUPPORTED'
    );
  }
  return adapter;
}

/**
 * Parse JSON from text with permissive extraction.
 * @param {string|object} raw
 * @returns {object}
 */
function parseJsonResponse(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) {
    throw new SyntaxError('LLM returned empty response for structured output.');
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fencedMatch ? fencedMatch[1] : text;

  try {
    return JSON.parse(candidate);
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      throw new SyntaxError('LLM returned non-JSON structured response.');
    }
    return JSON.parse(objectMatch[0]);
  }
}

function buildStructuredFallbackPrompt(schema, prompt) {
  return [
    'Return ONLY valid JSON that satisfies the target schema. No markdown fences, no prose.',
    `Target schema:\n${JSON.stringify(schema || {}, null, 2)}`,
    `Task:\n${prompt}`,
  ].join('\n\n');
}

async function observeLlmCall(adapter, operation, options, task) {
  const startedAt = Date.now();
  const provider = adapter?.id || getProviderId();
  const model = options?.model || process.env.LLM_MODEL || 'default';

  return tracing.withSpan(
    `llm.${operation}`,
    {
      kind: tracing.SpanKind.CLIENT,
      parentCarrier: getObservabilityContext().traceCarrier || null,
      attributes: {
        'cernion.provider': provider,
        'cernion.model': model,
        'cernion.operation': operation,
      },
    },
    async (span) => {
      try {
        const result = await task();
        tracing.setOk(span);
        metrics.recordLlmRequest({
          provider,
          model,
          operation,
          status: 'success',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        tracing.setError(span, error);
        metrics.recordLlmRequest({
          provider,
          model,
          operation,
          status: 'error',
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    }
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate free-form text from a prompt.
 * PII is scrubbed from the prompt before the call (EU AI Act Art. 12).
 *
 * @param {string} prompt  The user prompt (may contain PII — will be scrubbed).
 * @param {object} [options] Optional provider call options (timeout/retries/model hints).
 * @returns {Promise<string>}  Raw response text from the model.
 * @throws {MoleculerError}  503 LLM_NOT_CONFIGURED if GEMINI_API_KEY is not set.
 */
async function generateText(prompt, options = {}) {
  const adapter = getAdapter();
  const scrubbedPrompt = scrubPromptText(prompt);
  return await observeLlmCall(adapter, 'generate_text', options, () =>
    withRetries(() => adapter.generateText(scrubbedPrompt, options), options)
  );
}

/**
 * Generate a structured JSON response from a prompt using Gemini responseSchema.
 * PII is scrubbed from the prompt before the call (EU AI Act Art. 12).
 *
 * @param {object} responseSchema  Gemini SchemaType-compatible schema object.
 * @param {string} prompt          The prompt (may contain PII — will be scrubbed).
 * @param {object} [options]       Optional provider call options.
 * @returns {Promise<object>}  Parsed JSON object conforming to responseSchema.
 * @throws {MoleculerError}  503 LLM_NOT_CONFIGURED if GEMINI_API_KEY is not set.
 * @throws {SyntaxError}     If the model returns non-parseable JSON (unexpected).
 */
async function generateStructured(responseSchema, prompt, options = {}) {
  const adapter = getAdapter();
  const mode = (options.structuredMode || getStructuredMode()).toLowerCase();
  const scrubbedPrompt = scrubPromptText(prompt);

  try {
    const raw = await observeLlmCall(adapter, 'generate_structured', options, () =>
      withRetries(
        () => adapter.generateStructured(responseSchema, scrubbedPrompt, { ...options, structuredMode: mode }),
        options
      )
    );
    return parseJsonResponse(raw);
  } catch (error) {
    const fallbackPrompt = buildStructuredFallbackPrompt(responseSchema, scrubbedPrompt);
    const fallbackRaw = await observeLlmCall(adapter, 'generate_structured_fallback', options, () =>
      withRetries(() => adapter.generateText(fallbackPrompt, options), options)
    );
    return parseJsonResponse(fallbackRaw);
  }
}

/**
 * Generate embeddings for a list of text snippets.
 * PII is scrubbed before embedding calls.
 *
 * @param {string[]} texts
 * @param {object} [options]
 * @returns {Promise<number[][]>} Embedding vectors in input order.
 */
async function embeddings(texts, options = {}) {
  const adapter = getAdapter();
  const caps = typeof adapter.capabilities === 'function' ? adapter.capabilities() : {};
  if (!caps.embeddings || typeof adapter.embeddings !== 'function') {
    throw new MoleculerError(
      'Der konfigurierte LLM Provider unterstützt keine Embeddings.',
      503,
      'LLM_CAPABILITY_MISSING'
    );
  }

  const scrubbed = (Array.isArray(texts) ? texts : []).map((text) => scrubPromptText(String(text || '')));
  return await observeLlmCall(adapter, 'embeddings', options, () =>
    withRetries(() => adapter.embeddings(scrubbed, options), options)
  );
}

/**
 * Return provider capability matrix.
 *
 * @returns {{provider: string, structured: boolean, embeddings: boolean, vision: boolean, contextWindow: (number|null)}}
 */
function capabilities() {
  const adapter = getAdapter();
  const caps = typeof adapter.capabilities === 'function' ? adapter.capabilities() : {};
  return {
    provider: adapter.id || getProviderId(),
    structured: !!caps.structured,
    embeddings: !!caps.embeddings,
    vision: !!caps.vision,
    contextWindow: caps.contextWindow ?? null,
  };
}

module.exports = { SchemaType, generateText, generateStructured, embeddings, capabilities };
