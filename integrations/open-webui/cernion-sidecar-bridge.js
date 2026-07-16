#!/usr/bin/env node
'use strict';

const http = require('node:http');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8087;
const DEFAULT_MODEL_ID = 'cernion-sidecar-session';
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const REQUIRED_CONFIG = ['manifestUrl', 'askUrl', 'planUrl', 'expiresAt'];
const PLANNING_PATTERN =
  /(^|[^\p{L}\p{N}])(plan|planung|planen|plane|vorgehen|roadmap|schritte|blueprint)([^\p{L}\p{N}]|$)/iu;

function buildConfigFromEnv(env = process.env) {
  return {
    host: env.CERNION_OPEN_WEBUI_BRIDGE_HOST || DEFAULT_HOST,
    port: Number(env.CERNION_OPEN_WEBUI_BRIDGE_PORT || DEFAULT_PORT),
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
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        const error = new Error('request body too large');
        error.code = 'BODY_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        const error = new Error('request body must be valid JSON');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });
    req.on('error', reject);
  });
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

function isPlanningRequest(question, metadata = {}) {
  if (metadata.sidecarMode === 'plan') return true;
  if (metadata.sidecarMode === 'ask') return false;
  return PLANNING_PATTERN.test(String(question || ''));
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
  return value ? value.trim().slice(0, 200) : 'default';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
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
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      const error = new Error(`Sidecar returned HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
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
  const turnState = options.turnState || new Map();

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
      body = await readJsonBody(req);
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

    const metadata = isPlainObject(body.metadata) ? body.metadata : {};
    const conversationId = conversationIdFrom(body, req);
    const parentTurnId = turnState.get(conversationId);
    const usePlan = isPlanningRequest(question, metadata);
    const payload = {
      question,
      ...(parentTurnId ? { parentTurnId } : {}),
      ...(isPlainObject(metadata) ? { metadata } : {}),
    };

    try {
      const upstream = await callSidecar({
        config,
        url: usePlan ? config.planUrl : config.askUrl,
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
      sendJson(
        res,
        error.name === 'AbortError' ? 504 : 502,
        openAiError(
          'sidecar_upstream_error',
          'Cernion Sidecar request failed. Check the configured session URL, token scope and expiry.'
        )
      );
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
  healthBody,
  isPlanningRequest,
  normalizeAnswer,
};
