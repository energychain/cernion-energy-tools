#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { readJsonBody } = require('./http-json');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3910;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_QUESTION_LENGTH = 4000;
const MAX_CONTEXT_BYTES = 12 * 1024;
const MAX_CONTEXT_DEPTH = 5;
const MAX_CONTEXT_KEYS = 100;
const UPSTREAM_PATH = '/api/agent-sidecar/tools/cernion.answer_dossier/call';
const DEFAULT_TIMEOUT_MS = 30_000;
const SECRET_KEY_PATTERN = /(authorization|bearer|credential|password|secret|token)/i;

function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Cernion read-only Evidence Lookup',
      version: '1.0.0',
      description:
        'Open WebUI adapter for Cernion Answer Dossiers. All calls are read-only and have no side effects.',
    },
    paths: {
      '/tools/cernion-evidence-lookup': {
        post: {
          operationId: 'cernionEvidenceLookup',
          summary: 'Look up Cernion evidence',
          description:
            'Read-only advisory evidence lookup delegated to the configured Cernion Agent Sidecar policy gate. It never executes plans or consequential actions.',
          readOnly: true,
          'x-cernion-safety-class': 'advisory_reasoning',
          'x-cernion-read-only': true,
          'x-cernion-side-effects': 'none',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['question'],
                  properties: {
                    question: { type: 'string', minLength: 1, maxLength: MAX_QUESTION_LENGTH },
                    tenantId: { type: 'string', minLength: 1, maxLength: 128 },
                    sessionId: { type: 'string', minLength: 1, maxLength: 128 },
                    domain: { type: 'string', minLength: 1, maxLength: 80 },
                    context: {
                      type: 'object',
                      description:
                        'Bounded advisory context hints; never treated as authorization.',
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Read-only evidence answer; sideEffects is always none.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['readOnly', 'sideEffects'],
                    properties: {
                      readOnly: { type: 'boolean', enum: [true] },
                      sideEffects: { type: 'string', enum: ['none'] },
                      answer: { type: 'string' },
                      evidence: { type: 'array', items: {} },
                      confidence: {},
                      trace: { type: 'object', additionalProperties: true },
                      followups: { type: 'array', items: {} },
                      guardrails: {},
                      notCalled: { type: 'array', items: { type: 'string' } },
                      structuredContent: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
            400: { description: 'Bounded input validation failed; no upstream call was made.' },
            503: { description: 'The read-only Cernion Sidecar configuration is incomplete.' },
            504: { description: 'The read-only upstream lookup timed out.' },
          },
        },
      },
    },
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function errorBody(code, message, recovery) {
  return {
    success: false,
    error: code,
    message,
    recovery,
    readOnly: true,
    sideEffects: 'none',
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectContext(value, depth = 0, state = { keys: 0 }) {
  if (depth > MAX_CONTEXT_DEPTH) return 'context exceeds maximum nesting depth';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return null;
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTEXT_KEYS) return 'context contains too many array entries';
    for (const entry of value) {
      const error = inspectContext(entry, depth + 1, state);
      if (error) return error;
    }
    return null;
  }
  if (!isPlainObject(value)) return 'context must contain only JSON values';
  for (const [key, entry] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > MAX_CONTEXT_KEYS) return 'context contains too many keys';
    if (key.length > 128) return 'context contains an overlong key';
    const error = inspectContext(entry, depth + 1, state);
    if (error) return error;
  }
  return null;
}

function validateInput(input) {
  if (!isPlainObject(input)) return { error: 'request body must be a JSON object' };
  const allowed = new Set(['question', 'tenantId', 'sessionId', 'domain', 'context']);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `unsupported request field: ${unknown[0]}` };

  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) return { error: 'question is required' };
  if (question.length > MAX_QUESTION_LENGTH) {
    return { error: `question must not exceed ${MAX_QUESTION_LENGTH} characters` };
  }

  const normalized = { question };
  for (const [key, maxLength] of [
    ['tenantId', 128],
    ['sessionId', 128],
    ['domain', 80],
  ]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      return { error: `${key} must be a non-empty string` };
    }
    const value = input[key].trim();
    if (value.length > maxLength)
      return { error: `${key} must not exceed ${maxLength} characters` };
    normalized[key] = value;
  }

  if (input.context !== undefined) {
    if (!isPlainObject(input.context)) return { error: 'context must be a JSON object' };
    if (Buffer.byteLength(JSON.stringify(input.context)) > MAX_CONTEXT_BYTES) {
      return { error: `context must not exceed ${MAX_CONTEXT_BYTES} bytes` };
    }
    const contextError = inspectContext(input.context);
    if (contextError) return { error: contextError };
    normalized.context = input.context;
  }

  return { value: normalized };
}

function resolveUpstreamUrl(baseUrl) {
  if (!baseUrl) return null;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('CERNION_AGENT_SIDECAR_BASE_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('CERNION_AGENT_SIDECAR_BASE_URL must be an HTTP(S) URL without credentials');
  }
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}${UPSTREAM_PATH}`;
  return parsed.toString();
}

function scrubSecrets(value, secretValues = [], seen = new WeakSet()) {
  if (typeof value === 'string') {
    return secretValues.reduce(
      (safe, secret) => (secret ? safe.split(secret).join('[redacted]') : safe),
      value
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubSecrets(entry, secretValues, seen));
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SECRET_KEY_PATTERN.test(key)) output[key] = scrubSecrets(entry, secretValues, seen);
  }
  return output;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeUpstreamResult(upstream, secretValues = []) {
  const clean = scrubSecrets(upstream, secretValues);
  const content = isPlainObject(clean.structuredContent) ? clean.structuredContent : clean;
  const trace = {};
  for (const key of ['turnId', 'traceId', 'dossierId', 'sessionId']) {
    const value = firstDefined(content[key], clean[key]);
    if (value !== undefined) trace[key] = value;
  }

  const result = {
    success: clean.success !== false,
    readOnly: true,
    sideEffects: 'none',
    safetyClass: firstDefined(clean.safetyClass, 'advisory_reasoning'),
  };
  const answer = firstDefined(content.answer, content.summary, content.response, content.message);
  const evidence = firstDefined(content.evidence, content.evidenceItems, content.sources);
  const confidence = firstDefined(
    content.confidence,
    content.routingConfidence,
    content.evidenceConfidence,
    content.confidenceLevel
  );
  const followups = firstDefined(
    content.positiveFollowUps,
    content.possibleFollowUp,
    content.followups,
    content.followUps
  );
  const guardrails = firstDefined(content.guardrails, clean.guardrails);
  const notCalled = firstDefined(
    content.notCalled,
    content.sourceActions?.notCalled,
    clean.notCalled
  );

  if (typeof answer === 'string') result.answer = answer;
  if (evidence !== undefined) result.evidence = evidence;
  if (confidence !== undefined) result.confidence = confidence;
  if (Object.keys(trace).length) result.trace = trace;
  if (followups !== undefined) result.followups = followups;
  if (guardrails !== undefined) result.guardrails = guardrails;
  if (notCalled !== undefined) result.notCalled = notCalled;
  result.structuredContent = content;
  return result;
}

function createToolServer(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.CERNION_AGENT_SIDECAR_BASE_URL;
  const token = options.token ?? process.env.CERNION_READONLY_TOKEN;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs =
    Number(options.timeoutMs || process.env.CERNION_OPEN_WEBUI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let upstreamUrl;
  let configurationError = null;
  try {
    upstreamUrl = resolveUpstreamUrl(baseUrl);
  } catch (error) {
    configurationError = error.message;
  }

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'cernion-openapi-tool-server',
        readOnly: true,
        sideEffects: 'none',
        configuration: {
          baseUrl: configurationError ? 'invalid' : upstreamUrl ? 'configured' : 'missing',
          token: token ? 'configured' : 'missing',
        },
      });
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/openapi.json') {
      sendJson(res, 200, buildOpenApiSpec());
      return;
    }
    if (req.method !== 'POST' || requestUrl.pathname !== '/tools/cernion-evidence-lookup') {
      sendJson(
        res,
        404,
        errorBody(
          'not_found',
          'Route not found.',
          'Use /openapi.json to inspect the single read-only tool.'
        )
      );
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
    } catch (error) {
      if (!res.writableEnded) {
        sendJson(
          res,
          error.code === 'BODY_TOO_LARGE' ? 413 : 400,
          errorBody(
            'invalid_request',
            error.message,
            'Send a bounded JSON request with a question.'
          )
        );
      }
      return;
    }
    const validation = validateInput(body);
    if (validation.error) {
      sendJson(
        res,
        400,
        errorBody(
          'invalid_request',
          validation.error,
          'Correct the bounded input; no upstream call was made.'
        )
      );
      return;
    }
    if (configurationError || !upstreamUrl) {
      sendJson(
        res,
        503,
        errorBody(
          'sidecar_base_url_missing',
          configurationError || 'The Cernion Agent Sidecar base URL is not configured.',
          'Configure CERNION_AGENT_SIDECAR_BASE_URL for the read-only Sidecar.'
        )
      );
      return;
    }
    if (!token) {
      sendJson(
        res,
        503,
        errorBody(
          'readonly_token_missing',
          'The read-only Cernion credential is not configured.',
          'Configure CERNION_READONLY_TOKEN outside the request body.'
        )
      );
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 60_000));
    try {
      const response = await fetchImpl(upstreamUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ input: validation.value }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        sendJson(
          res,
          502,
          errorBody(
            'upstream_authorization_failed',
            'The configured read-only credential was rejected by Cernion.',
            'Renew or correct the read-only credential; do not retry with broader scope.'
          )
        );
        return;
      }
      if (!response.ok) {
        sendJson(
          res,
          502,
          errorBody(
            'upstream_unavailable',
            `The read-only Cernion lookup failed with status ${response.status}.`,
            'Retry the read-only lookup later; do not fall back to a write or direct database path.'
          )
        );
        return;
      }
      let upstream;
      try {
        upstream = await response.json();
      } catch {
        sendJson(
          res,
          502,
          errorBody(
            'invalid_upstream_response',
            'Cernion returned a non-JSON response.',
            'Retry the read-only lookup later.'
          )
        );
        return;
      }
      if (!isPlainObject(upstream)) {
        sendJson(
          res,
          502,
          errorBody(
            'invalid_upstream_response',
            'Cernion returned an invalid response shape.',
            'Retry the read-only lookup later.'
          )
        );
        return;
      }
      sendJson(res, 200, normalizeUpstreamResult(upstream, [token]));
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      sendJson(
        res,
        timedOut ? 504 : 502,
        errorBody(
          timedOut ? 'upstream_timeout' : 'upstream_unavailable',
          timedOut
            ? 'The read-only Cernion lookup timed out.'
            : 'The read-only Cernion lookup is unavailable.',
          'Retry the read-only lookup later; do not fall back to a write or direct database path.'
        )
      );
    } finally {
      clearTimeout(timer);
    }
  });
}

function startServer() {
  const host = process.env.CERNION_OPEN_WEBUI_HOST || DEFAULT_HOST;
  const port = Number(process.env.CERNION_OPEN_WEBUI_PORT) || DEFAULT_PORT;
  const server = createToolServer();
  server.listen(port, host, () => {
    console.log(`[cernion-open-webui] read-only tool server listening on http://${host}:${port}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  MAX_BODY_BYTES,
  UPSTREAM_PATH,
  buildOpenApiSpec,
  createToolServer,
  normalizeUpstreamResult,
  resolveUpstreamUrl,
  validateInput,
};
