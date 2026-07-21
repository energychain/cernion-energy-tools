#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { readJsonBody } = require('./http-json');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8087;
const DEFAULT_MODEL_ID = 'cernion-sidecar-session';
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TURN_STATE_MAX_ENTRIES = 1_000;
const DEFAULT_TURN_STATE_TTL_MS = 30 * 60 * 1_000;
const REQUIRED_CONFIG = ['manifestUrl', 'askUrl', 'planUrl', 'expiresAt'];

function buildConfigFromEnv(env = process.env) {
  return {
    host: env.CERNION_OPEN_WEBUI_BRIDGE_HOST || DEFAULT_HOST,
    port: clampInteger(env.CERNION_OPEN_WEBUI_BRIDGE_PORT, 1, 65_535, DEFAULT_PORT),
    manifestUrl: env.CERNION_SIDECAR_MANIFEST_URL || '',
    askUrl: env.CERNION_SIDECAR_ASK_URL || '',
    planUrl: env.CERNION_SIDECAR_PLAN_URL || '',
    expiresAt: env.CERNION_SIDECAR_EXPIRES_AT || '',
    modelId: env.CERNION_OPEN_WEBUI_MODEL_ID || DEFAULT_MODEL_ID,
    token: env.CERNION_SIDECAR_TOKEN || '',
    timeoutMs: clampNumber(
      env.CERNION_OPEN_WEBUI_BRIDGE_TIMEOUT_MS,
      1_000,
      60_000,
      DEFAULT_TIMEOUT_MS
    ),
    turnStateMaxEntries: clampInteger(
      env.CERNION_OPEN_WEBUI_TURN_STATE_MAX_ENTRIES,
      1,
      10_000,
      DEFAULT_TURN_STATE_MAX_ENTRIES
    ),
    turnStateTtlMs: clampNumber(
      env.CERNION_OPEN_WEBUI_TURN_STATE_TTL_MS,
      1_000,
      24 * 60 * 60 * 1_000,
      DEFAULT_TURN_STATE_TTL_MS
    ),
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateHttpUrl(url, field) {
  if (!url) return `${field} is required`;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return `${field} must be an HTTP(S) URL without embedded credentials`;
    }
  } catch {
    return `${field} must be a valid URL`;
  }
  return null;
}

function missingConfig(config) {
  return REQUIRED_CONFIG.filter((key) => !config[key]);
}

function configErrors(config) {
  const errors = [];
  for (const key of ['manifestUrl', 'askUrl', 'planUrl']) {
    const error = validateHttpUrl(config[key], key);
    if (error && config[key]) errors.push(error);
  }
  if (config.expiresAt && Number.isNaN(Date.parse(config.expiresAt))) {
    errors.push('expiresAt must be an ISO-8601 date');
  }
  return errors;
}

function isExpired(config, now = Date.now()) {
  if (!config.expiresAt) return false;
  const expiresAt = Date.parse(config.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

function healthBody(config, now = Date.now()) {
  const missing = missingConfig(config);
  const errors = configErrors(config);
  const expired = isExpired(config, now);
  const status = missing.length || errors.length ? 'misconfigured' : expired ? 'expired' : 'ok';
  return {
    status,
    service: 'cernion-open-webui-sidecar-bridge',
    modelId: config.modelId || DEFAULT_MODEL_ID,
    expiresAt: config.expiresAt || null,
    expired,
    missing,
    errors,
    configuration: {
      manifestUrl: config.manifestUrl ? 'configured' : 'missing',
      askUrl: config.askUrl ? 'configured' : 'missing',
      planUrl: config.planUrl ? 'configured' : 'missing',
      expiresAt: config.expiresAt ? 'configured' : 'missing',
      token: config.token ? 'configured' : 'missing',
    },
  };
}

function transportModeFrom(body, req) {
  const metadata = isPlainObject(body.metadata) ? body.metadata : {};
  const requestedMode = firstDefined(metadata.sidecarMode, req.headers['x-cernion-sidecar-mode']);
  if (requestedMode === undefined || requestedMode === null || requestedMode === '') return 'ask';
  if (requestedMode === 'ask' || requestedMode === 'plan') return requestedMode;
  return null;
}

function extractQuestion(body) {
  if (!isPlainObject(body)) return '';
  if (typeof body.prompt === 'string') return body.prompt.trim();
  if (!Array.isArray(body.messages)) return '';
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    const message = body.messages[i];
    if (!message || message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content.trim();
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

function conversationIdFrom(body, req) {
  const metadata = isPlainObject(body.metadata) ? body.metadata : {};
  const candidates = [
    metadata.chat_id,
    metadata.chatId,
    metadata.conversation_id,
    metadata.conversationId,
    metadata.session_id,
    metadata.sessionId,
    body.conversation_id,
    req.headers['x-openwebui-chat-id'],
    req.headers['x-cernion-conversation-id'],
  ];
  const value = candidates.find((entry) => typeof entry === 'string' && entry.trim());
  return value ? value.trim().slice(0, 200) : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function createTurnState(options = {}) {
  const maxEntries = clampInteger(options.maxEntries, 1, 10_000, DEFAULT_TURN_STATE_MAX_ENTRIES);
  const ttlMs = clampNumber(options.ttlMs, 1, 24 * 60 * 60 * 1_000, DEFAULT_TURN_STATE_TTL_MS);
  const now = options.now || Date.now;
  const entries = new Map();

  const pruneExpired = () => {
    const currentTime = now();
    for (const [conversationId, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(conversationId);
    }
  };

  return {
    get(conversationId) {
      if (!conversationId) return undefined;
      const entry = entries.get(conversationId);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(conversationId);
        return undefined;
      }
      entries.delete(conversationId);
      entries.set(conversationId, entry);
      return entry.turnId;
    },
    set(conversationId, turnId) {
      if (!conversationId || !turnId) return;
      pruneExpired();
      entries.delete(conversationId);
      entries.set(conversationId, { turnId, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    get size() {
      pruneExpired();
      return entries.size;
    },
  };
}

function normalizeAnswer(upstream) {
  const source = isPlainObject(upstream?.structuredContent) ? upstream.structuredContent : upstream;
  const answer = firstDefined(
    source?.answer,
    source?.shortAnswer,
    source?.groundingAnswer,
    source?.summary,
    upstream?.answer,
    upstream?.shortAnswer,
    upstream?.groundingAnswer,
    upstream?.summary
  );
  const content =
    typeof answer === 'string' && answer.trim()
      ? answer
      : 'Cernion did not return an expected answer field for this Sidecar response.';
  const evidence = firstDefined(
    source?.evidence,
    source?.sources,
    upstream?.evidence,
    upstream?.sources
  );
  const resolvedQuestion = firstDefined(source?.resolvedQuestion, upstream?.resolvedQuestion);
  const confidence = firstDefined(source?.confidence, upstream?.confidence);
  const turnId = firstDefined(
    source?.turnId,
    upstream?.turnId,
    source?.followUpContext?.turnId,
    upstream?.followUpContext?.turnId
  );
  const followUpContext = firstDefined(source?.followUpContext, upstream?.followUpContext);
  const ontology = firstDefined(
    source?.ontology,
    source?.ontologyStatus,
    upstream?.ontology,
    upstream?.ontologyStatus
  );
  const sections = [content];
  if (Array.isArray(evidence) && evidence.length) {
    sections.push(
      `Evidence:\n${evidence.map((item, index) => `- [${index + 1}] ${formatEvidence(item)}`).join('\n')}`
    );
  }
  const metadata = [];
  if (resolvedQuestion) metadata.push(`resolvedQuestion: ${resolvedQuestion}`);
  if (confidence !== undefined) metadata.push(`confidence: ${confidence}`);
  if (turnId) metadata.push(`turnId: ${turnId}`);
  if (followUpContext?.turnId && followUpContext.turnId !== turnId) {
    metadata.push(`followUpContext.turnId: ${followUpContext.turnId}`);
  }
  if (ontology !== undefined) metadata.push(`ontology: ${JSON.stringify(ontology)}`);
  if (metadata.length) sections.push(`Metadata:\n${metadata.join('\n')}`);
  return { content: sections.join('\n\n'), turnId };
}

function formatEvidence(item) {
  if (typeof item === 'string') return item;
  if (!isPlainObject(item)) return JSON.stringify(item);
  return firstDefined(item.text, item.title, item.sourceRef, item.url, JSON.stringify(item));
}

function openAiError(type, message, code = type) {
  return { error: { message, type, code } };
}

async function callSidecar({ config, url, payload, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Sidecar returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { raw: text.slice(0, 500) };
    }
  } finally {
    clearTimeout(timer);
  }
}

function upstreamFailure(error) {
  if (error.name === 'AbortError') {
    return {
      status: 504,
      body: openAiError(
        'sidecar_upstream_timeout',
        'The Cernion Sidecar request timed out. Retry the request.'
      ),
    };
  }
  if (error.status === 410) {
    return {
      status: 410,
      body: openAiError(
        'sidecar_session_expired',
        'The Cernion Sidecar session has expired. Generate a new Sidecar session and update the bridge environment variables.',
        'new_session_required'
      ),
    };
  }
  if (error.status === 401) {
    return {
      status: 401,
      body: openAiError(
        'sidecar_authentication_error',
        'The Cernion Sidecar rejected the configured session credential.',
        'session_authentication_required'
      ),
    };
  }
  if (error.status === 403) {
    return {
      status: 403,
      body: openAiError(
        'sidecar_authorization_error',
        'The configured Cernion Sidecar session is not permitted to perform this request.',
        'session_scope_insufficient'
      ),
    };
  }
  return {
    status: 502,
    body: openAiError(
      'sidecar_upstream_error',
      'Cernion Sidecar request failed. Check the configured session URL, token scope and expiry.'
    ),
  };
}

function chatCompletionBody({ modelId, content }) {
  return {
    id: `chatcmpl_cernion_${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function createBridgeServer(options = {}) {
  const config = { ...buildConfigFromEnv({}), ...options };
  const fetchImpl = options.fetchImpl || fetch;
  const turnState = createTurnState({
    maxEntries: config.turnStateMaxEntries,
    ttlMs: config.turnStateTtlMs,
    now: options.now,
  });

  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;

    if (req.method === 'GET' && path === '/health') {
      const body = healthBody(config);
      sendJson(res, body.status === 'ok' ? 200 : 503, body);
      return;
    }

    if (req.method === 'GET' && path === '/v1/models') {
      sendJson(res, 200, {
        object: 'list',
        data: [{ id: config.modelId || DEFAULT_MODEL_ID, object: 'model', owned_by: 'cernion' }],
      });
      return;
    }

    if (req.method !== 'POST' || path !== '/v1/chat/completions') {
      sendJson(res, 404, openAiError('not_found', 'Endpoint not found', 'not_found'));
      return;
    }

    const missing = missingConfig(config);
    const errors = configErrors(config);
    if (missing.length || errors.length) {
      sendJson(
        res,
        503,
        openAiError(
          'sidecar_configuration_error',
          'Cernion Sidecar bridge configuration is incomplete. Generate a Sidecar session and set manifest, ask, plan and expiry environment variables.',
          'configuration_required'
        )
      );
      return;
    }

    if (isExpired(config)) {
      sendJson(
        res,
        410,
        openAiError(
          'sidecar_session_expired',
          'The configured Cernion Sidecar session has expired. Generate a new Sidecar session and update the bridge environment variables.',
          'new_session_required'
        )
      );
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
    } catch (error) {
      sendJson(
        res,
        error.code === 'BODY_TOO_LARGE' ? 413 : 400,
        openAiError('invalid_request_error', error.message)
      );
      return;
    }

    const question = extractQuestion(body);
    if (!question) {
      sendJson(res, 400, openAiError('invalid_request_error', 'A user message is required.'));
      return;
    }

    const transportMode = transportModeFrom(body, req);
    if (!transportMode) {
      sendJson(
        res,
        400,
        openAiError(
          'invalid_request_error',
          'metadata.sidecarMode or x-cernion-sidecar-mode must be "ask" or "plan".'
        )
      );
      return;
    }

    const conversationId = conversationIdFrom(body, req);
    const parentTurnId = turnState.get(conversationId);
    const payload = {
      [transportMode === 'plan' ? 'task' : 'question']: question,
      ...(parentTurnId ? { parentTurnId } : {}),
    };

    try {
      const upstream = await callSidecar({
        config,
        url: transportMode === 'plan' ? config.planUrl : config.askUrl,
        payload,
        fetchImpl,
      });
      const normalized = normalizeAnswer(upstream);
      if (normalized.turnId) turnState.set(conversationId, normalized.turnId);
      sendJson(
        res,
        200,
        chatCompletionBody({
          modelId: config.modelId || DEFAULT_MODEL_ID,
          content: normalized.content,
        })
      );
    } catch (error) {
      const failure = upstreamFailure(error);
      sendJson(res, failure.status, failure.body);
    }
  });
}

if (require.main === module) {
  const config = buildConfigFromEnv(process.env);
  const server = createBridgeServer(config);
  server.listen(config.port, config.host, () => {
    console.log(
      `Cernion Open WebUI Sidecar bridge listening on http://${config.host}:${config.port}`
    );
  });
}

module.exports = {
  buildConfigFromEnv,
  createBridgeServer,
  createTurnState,
  healthBody,
  normalizeAnswer,
  transportModeFrom,
};
