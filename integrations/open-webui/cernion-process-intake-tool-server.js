#!/usr/bin/env node
'use strict';

/**
 * Draft-only Process Intake tool server (issue #427).
 *
 * Completely separate adapter from cernion-openapi-tool-server.js (read-only
 * Evidence Lookup): different port, different env-only credential
 * (CERNION_PROCESS_TOKEN vs CERNION_READONLY_TOKEN), different upstream path.
 *
 * The single upstream call this server is allowed to make is
 * POST <CERNION_BASE_URL>/api/copilot-process/intents — the existing
 * prepareProcessIntent action (services/copilot-process.service.js). That
 * action only ever creates a ProcessIntentStore entry in
 * pending_confirmation status; its operationFamily has no case in the
 * service's execute dispatch table, so nothing it creates can be
 * auto-executed. Cernion remains authoritative for tenant/role/policy/HITL —
 * this adapter never decides policy itself, it only previews and forwards.
 *
 * This server never calls any execute/approve/reject/sign/send/publish/
 * dispatch/settle/bill/tariff/device/webhook/connector endpoint. It has no
 * knowledge of any such endpoint to call.
 */

const http = require('node:http');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3911;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PAYLOAD_BYTES = 12 * 1024;
const MAX_PAYLOAD_DEPTH = 5;
const MAX_PAYLOAD_KEYS = 100;
const UPSTREAM_PATH = '/api/copilot-process/intents';
const DEFAULT_TIMEOUT_MS = 30_000;
const SECRET_KEY_PATTERN = /(authorization|bearer|credential|password|secret|token)/i;

const FORBIDDEN_ACTION_TERMS = [
  ['execute', /\bexecut\w*\b/i],
  ['approve', /\bapprov\w*\b/i],
  ['auto-confirm', /\bauto[-\s]?confirm\w*\b/i],
  ['sign', /\bsign\w*\b/i],
  ['delete', /\bdelet\w*\b/i],
  ['send', /\bsend\w*\b/i],
  ['publish', /\bpublish\w*\b/i],
  ['dispatch', /\bdispatch\w*\b/i],
  ['settle', /\bsettl\w*\b/i],
  ['bill', /\bbill\w*\b/i],
  ['mutate tariff', /\btariff\w*\b/i],
  ['control device', /\bdevice\w*\b/i],
  ['emit webhook', /\bwebhook\w*\b/i],
  ['invoke external connector', /\bconnector\w*\b/i],
];

const FORBIDDEN_ACTIONS = FORBIDDEN_ACTION_TERMS.map(([label]) => label);

const NOT_CALLED = [
  'executeProcessIntent',
  'rejectProcessIntent',
  'MaKo',
  'CRM',
  'billing',
  'settlement',
  'device control',
  'customer messaging',
  'webhooks',
  'digital signatures',
  'automatic approval',
  'Open WebUI-side policy decisions',
];

const ALLOWED_NEXT_ACTIONS = [
  'Ask a human reviewer to confirm or reject this intent before anything downstream happens.',
  'Inspect the pending intent via the direct Cernion API (GET /api/copilot-process/intents/:intentId).',
];

function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Cernion draft-only Process Intake',
      version: '1.0.0',
      description:
        'Open WebUI adapter that previews a user-supplied process intent as a bounded, pending-human-confirmation draft. It is NOT a production write path: it never executes, approves, auto-confirms, signs, deletes, sends, publishes, dispatches, settles, bills, mutates tariffs, controls devices, emits webhooks, or invokes external connectors. All consequential decisions remain with Cernion policy and a human reviewer.',
    },
    paths: {
      '/tools/cernion-process-intake-draft': {
        post: {
          operationId: 'cernionProcessIntakeDraft',
          summary: 'Preview a draft-only process intake (no execution)',
          description:
            'Forwards a bounded process intent to the existing Cernion Process Intake action (prepareProcessIntent), which creates a pending_confirmation receipt only. Returns a draft-only preview: draftOnly is always true, hitlRequired is always true, and policyStatus is always pending_human_confirmation on success. This tool never executes real process mutations and has no code path to any execute/approve/sign/send/publish/dispatch/settle/bill/tariff/device/webhook/connector endpoint.',
          'x-openai-isConsequential': false,
          'x-cernion-safety-class': 'draft_only_process_intake',
          'x-cernion-draft-only': true,
          'x-cernion-hitl-required': true,
          'x-cernion-side-effects': 'pending_human_confirmation',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['operationFamily', 'proposedAction'],
                  properties: {
                    operationFamily: { type: 'string', minLength: 1, maxLength: 64 },
                    proposedAction: { type: 'string', minLength: 1, maxLength: 200 },
                    targetType: { type: 'string', minLength: 1, maxLength: 128 },
                    targetId: { type: 'string', minLength: 1, maxLength: 128 },
                    inputSummary: { type: 'string', maxLength: 500 },
                    payload: {
                      type: 'object',
                      description:
                        'Bounded, JSON-only process data. Must not contain credential-like keys.',
                      additionalProperties: true,
                    },
                    risk: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
                    reason: { type: 'string', maxLength: 500 },
                    correlationId: { type: 'string', minLength: 1, maxLength: 128 },
                    decisionFrameId: { type: 'string', minLength: 1, maxLength: 128 },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description:
                'Draft-only intake preview. draftOnly, hitlRequired are always true; policyStatus is always pending_human_confirmation.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: [
                      'draftOnly',
                      'acceptedIntent',
                      'policyStatus',
                      'hitlRequired',
                      'allowedNextActions',
                      'forbiddenActions',
                      'notCalled',
                      'auditContext',
                    ],
                    properties: {
                      draftOnly: { type: 'boolean', enum: [true] },
                      acceptedIntent: { type: 'object', additionalProperties: true },
                      receipt: { type: 'object', additionalProperties: true },
                      policyStatus: { type: 'string', enum: ['pending_human_confirmation'] },
                      hitlRequired: { type: 'boolean', enum: [true] },
                      allowedNextActions: { type: 'array', items: { type: 'string' } },
                      forbiddenActions: { type: 'array', items: { type: 'string' } },
                      notCalled: { type: 'array', items: { type: 'string' } },
                      executeVia: {
                        type: 'object',
                        description: 'Informational only — not a callable operation.',
                        additionalProperties: true,
                      },
                      auditContext: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
            400: { description: 'Bounded input validation failed; no upstream call was made.' },
            403: {
              description:
                'Request text asked for a consequential action (execute/approve/sign/…); rejected before any upstream call.',
            },
            409: { description: 'Cernion policy rejected the intent; no draft was created.' },
            503: { description: 'The Process Intake upstream configuration is incomplete.' },
            504: { description: 'The upstream Process Intake call timed out.' },
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
    draftOnly: true,
    hitlRequired: true,
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectPayload(value, depth = 0, state = { keys: 0 }) {
  if (depth > MAX_PAYLOAD_DEPTH) return 'payload exceeds maximum nesting depth';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return null;
  if (Array.isArray(value)) {
    if (value.length > MAX_PAYLOAD_KEYS) return 'payload contains too many array entries';
    for (const entry of value) {
      const error = inspectPayload(entry, depth + 1, state);
      if (error) return error;
    }
    return null;
  }
  if (!isPlainObject(value)) return 'payload must contain only JSON values';
  for (const [key, entry] of Object.entries(value)) {
    state.keys += 1;
    if (state.keys > MAX_PAYLOAD_KEYS) return 'payload contains too many keys';
    if (key.length > 128) return 'payload contains an overlong key';
    if (SECRET_KEY_PATTERN.test(key)) return 'payload must not contain credential-like keys';
    const error = inspectPayload(entry, depth + 1, state);
    if (error) return error;
  }
  return null;
}

function findForbiddenTerm(text) {
  for (const [label, pattern] of FORBIDDEN_ACTION_TERMS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function validateInput(input) {
  if (!isPlainObject(input)) return { error: 'request body must be a JSON object' };
  const allowed = new Set([
    'operationFamily',
    'proposedAction',
    'targetType',
    'targetId',
    'inputSummary',
    'payload',
    'risk',
    'reason',
    'correlationId',
    'decisionFrameId',
  ]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) return { error: `unsupported request field: ${unknown[0]}` };

  const normalized = {};

  for (const [key, maxLength] of [
    ['operationFamily', 64],
    ['proposedAction', 200],
  ]) {
    const raw = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!raw) return { error: `${key} is required` };
    if (raw.length > maxLength) return { error: `${key} must not exceed ${maxLength} characters` };
    if (SECRET_KEY_PATTERN.test(raw)) return { error: `${key} must not contain credential-like content` };
    normalized[key] = raw;
  }

  for (const [key, maxLength] of [
    ['targetType', 128],
    ['targetId', 128],
    ['correlationId', 128],
    ['decisionFrameId', 128],
  ]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      return { error: `${key} must be a non-empty string` };
    }
    const value = input[key].trim();
    if (value.length > maxLength) return { error: `${key} must not exceed ${maxLength} characters` };
    normalized[key] = value;
  }

  for (const key of ['inputSummary', 'reason']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key].trim()) {
      return { error: `${key} must be a non-empty string` };
    }
    const value = input[key].trim();
    if (value.length > 500) return { error: `${key} must not exceed 500 characters` };
    normalized[key] = value;
  }

  if (input.risk !== undefined) {
    if (!['low', 'medium', 'high'].includes(input.risk)) {
      return { error: 'risk must be one of low, medium, high' };
    }
    normalized.risk = input.risk;
  } else {
    normalized.risk = 'medium';
  }

  if (input.payload !== undefined) {
    if (!isPlainObject(input.payload)) return { error: 'payload must be a JSON object' };
    if (Buffer.byteLength(JSON.stringify(input.payload)) > MAX_PAYLOAD_BYTES) {
      return { error: `payload must not exceed ${MAX_PAYLOAD_BYTES} bytes` };
    }
    const payloadError = inspectPayload(input.payload);
    if (payloadError) return { error: payloadError };
    normalized.payload = input.payload;
  } else {
    normalized.payload = {};
  }

  const forbiddenScanText = JSON.stringify({
    operationFamily: normalized.operationFamily,
    proposedAction: normalized.proposedAction,
    targetType: normalized.targetType,
    targetId: normalized.targetId,
    inputSummary: normalized.inputSummary,
    reason: normalized.reason,
    payload: normalized.payload,
  });
  const forbiddenTerm = findForbiddenTerm(forbiddenScanText);
  if (forbiddenTerm) return { error: forbiddenTerm, forbidden: true };

  return { value: normalized };
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

function resolveUpstreamUrl(baseUrl) {
  if (!baseUrl) return null;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('CERNION_BASE_URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('CERNION_BASE_URL must be an HTTP(S) URL without credentials');
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

function normalizeUpstreamSuccess(upstream, acceptedIntent, secretValues = []) {
  const clean = scrubSecrets(upstream, secretValues);
  const receiptSrc = isPlainObject(clean.receipt) ? clean.receipt : {};
  const auditSrc = isPlainObject(clean.auditTrail) ? clean.auditTrail : {};
  const executeViaSrc = isPlainObject(clean.executeVia) ? clean.executeVia : {};

  return {
    draftOnly: true,
    acceptedIntent,
    receipt: {
      intentId: receiptSrc.intentId,
      status: receiptSrc.status,
      expiresAt: receiptSrc.expiresAt,
    },
    policyStatus: 'pending_human_confirmation',
    hitlRequired: true,
    allowedNextActions: ALLOWED_NEXT_ACTIONS,
    forbiddenActions: FORBIDDEN_ACTIONS,
    notCalled: NOT_CALLED,
    executeVia: {
      operationId: executeViaSrc.operationId,
      note: 'Informational only — not a callable action from this tool. A human must act via the direct Cernion API after review.',
    },
    auditContext: {
      correlationId: auditSrc.correlationId,
      requestedAt: auditSrc.requestedAt,
      requestedBy: auditSrc.requestedBy,
    },
  };
}

function createToolServer(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.CERNION_BASE_URL;
  const token = options.token ?? process.env.CERNION_PROCESS_TOKEN;
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs =
    Number(options.timeoutMs || process.env.CERNION_PROCESS_INTAKE_TIMEOUT_MS) ||
    DEFAULT_TIMEOUT_MS;
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
        service: 'cernion-process-intake-tool-server',
        draftOnly: true,
        hitlRequired: true,
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
    if (req.method !== 'POST' || requestUrl.pathname !== '/tools/cernion-process-intake-draft') {
      sendJson(
        res,
        404,
        errorBody(
          'not_found',
          'Route not found.',
          'Use /openapi.json to inspect the single draft-only process intake tool.'
        )
      );
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      if (!res.writableEnded) {
        sendJson(
          res,
          error.code === 'BODY_TOO_LARGE' ? 413 : 400,
          errorBody(
            'invalid_request',
            error.message,
            'Send a bounded JSON request with operationFamily and proposedAction.'
          )
        );
      }
      return;
    }

    const validation = validateInput(body);
    if (validation.error) {
      if (validation.forbidden) {
        sendJson(
          res,
          403,
          errorBody(
            'consequential_action_rejected',
            `Request text asked for a forbidden consequential action: "${validation.error}". This tool is draft-only and never executes real process mutations.`,
            'Remove the consequential action language; only a human reviewer via the direct Cernion API may execute, approve, or reject a pending intent.'
          )
        );
        return;
      }
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
          'process_intake_base_url_missing',
          configurationError || 'The Cernion Process Intake base URL is not configured.',
          'Configure CERNION_BASE_URL for the Process Intake upstream.'
        )
      );
      return;
    }
    if (!token) {
      sendJson(
        res,
        503,
        errorBody(
          'process_token_missing',
          'The Cernion process credential is not configured.',
          'Configure CERNION_PROCESS_TOKEN outside the request body.'
        )
      );
      return;
    }

    const acceptedIntent = validation.value;
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
        body: JSON.stringify(acceptedIntent),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        sendJson(
          res,
          502,
          errorBody(
            'upstream_authorization_failed',
            'The configured Process Intake credential was rejected by Cernion.',
            'Renew or correct the process credential; do not retry with broader scope.'
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
            'Retry the draft-only request later.'
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
            'Retry the draft-only request later.'
          )
        );
        return;
      }

      if (response.status === 409) {
        const clean = scrubSecrets(upstream, [token]);
        sendJson(
          res,
          409,
          {
            ...errorBody(
              'upstream_policy_rejected',
              typeof clean.message === 'string'
                ? clean.message
                : 'Cernion policy rejected this intent.',
              'Adjust the intent per Cernion policy guidance; no draft was created.'
            ),
            policyStatus: 'rejected_by_policy',
            notCalled: NOT_CALLED,
          }
        );
        return;
      }

      if (!response.ok) {
        sendJson(
          res,
          502,
          errorBody(
            'upstream_unavailable',
            `The Process Intake upstream failed with status ${response.status}.`,
            'Retry later; do not fall back to a different write path.'
          )
        );
        return;
      }

      sendJson(res, 200, normalizeUpstreamSuccess(upstream, acceptedIntent, [token]));
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      sendJson(
        res,
        timedOut ? 504 : 502,
        errorBody(
          timedOut ? 'upstream_timeout' : 'upstream_unavailable',
          timedOut
            ? 'The Process Intake upstream call timed out.'
            : 'The Process Intake upstream is unavailable.',
          'Retry later; do not fall back to a different write path.'
        )
      );
    } finally {
      clearTimeout(timer);
    }
  });
}

function startServer() {
  const host = process.env.CERNION_PROCESS_INTAKE_HOST || DEFAULT_HOST;
  const port = Number(process.env.CERNION_PROCESS_INTAKE_PORT) || DEFAULT_PORT;
  const server = createToolServer();
  server.listen(port, host, () => {
    console.log(
      `[cernion-process-intake] draft-only tool server listening on http://${host}:${port}`
    );
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  FORBIDDEN_ACTIONS,
  MAX_BODY_BYTES,
  NOT_CALLED,
  UPSTREAM_PATH,
  buildOpenApiSpec,
  createToolServer,
  normalizeUpstreamSuccess,
  resolveUpstreamUrl,
  validateInput,
};
