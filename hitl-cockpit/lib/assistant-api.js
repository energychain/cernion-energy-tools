'use strict';

const crypto = require('node:crypto');
const { toBrowserAssistantConfig } = require('./assistant-config');

const ENTITY_ID =
  /^(?:conversation|run|proposal)_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status, body) {
  return { status, body };
}
function apiError(error) {
  if (
    ['PROJECTION_UNAVAILABLE', 'PROJECTION_READ_FAILED', 'PROJECTION_BUSY'].includes(error.code)
  ) {
    return response(503, { ok: false, error: 'management_projection_unavailable' });
  }
  if (['PROJECTION_STALE', 'PROJECTION_DEGRADED'].includes(error.code)) {
    return response(409, { ok: false, error: error.code });
  }
  return response(error.status || 400, { ok: false, error: error.code || 'invalid_request' });
}

async function readJson(req, limit) {
  if (
    !String(req.headers['content-type'] || '')
      .toLowerCase()
      .startsWith('application/json')
  ) {
    const error = new Error('json_required');
    error.status = 415;
    error.code = 'json_required';
    throw error;
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) {
      const error = new Error('body_too_large');
      error.status = 413;
      error.code = 'body_too_large';
      throw error;
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (_) {
    const error = new Error('invalid_json_body');
    error.status = 400;
    error.code = 'invalid_json_body';
    throw error;
  }
}

function sameOrigin(req, trustProxy = false) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const forwarded = trustProxy ? String(req.headers['x-forwarded-proto'] || '') : '';
  const protocol =
    forwarded.split(',')[0].trim() === 'https' || req.socket?.encrypted ? 'https:' : 'http:';
  try {
    return new URL(origin).origin === `${protocol}//${String(req.headers.host || '')}`;
  } catch (_) {
    return false;
  }
}

function createAssistantApi(options = {}) {
  const { config, service } = options;
  const trustProxy = options.trustProxy === true;
  const freshnessGuard = options.freshnessGuard || null;
  const bodyLimit = options.bodyLimit || 16 * 1024;
  const policy = { windowMs: 60000, max: 30, maxBuckets: 1024, ...(options.rateLimit || {}) };
  const buckets = new Map();
  function limited(req) {
    const identity = typeof req.authIdentity === 'string' ? req.authIdentity : '';
    if (!identity) return true;
    const key = crypto.createHash('sha256').update(identity, 'utf8').digest('base64url');
    const now = typeof policy.now === 'function' ? policy.now() : Date.now();
    for (const [bucketKey, bucket] of buckets) {
      if (now - bucket.started >= policy.windowMs) buckets.delete(bucketKey);
    }
    const current = buckets.get(key);
    if (!current) {
      if (buckets.size >= policy.maxBuckets) {
        const oldest = [...buckets.entries()].sort(
          (left, right) => left[1].started - right[1].started
        )[0];
        if (oldest) buckets.delete(oldest[0]);
      }
      buckets.set(key, { started: now, count: 1 });
      return false;
    }
    current.count += 1;
    return current.count > policy.max;
  }
  async function handle(req, url) {
    if (url.pathname === '/api/assistant/config') {
      if (req.method !== 'GET') return response(405, { ok: false, error: 'method_not_allowed' });
      return response(200, { ok: true, ...toBrowserAssistantConfig(config) });
    }
    if (!url.pathname.startsWith('/api/assistant/'))
      return response(404, { ok: false, error: 'not_found' });
    if (!config.enabled) return response(404, { ok: false, error: 'assistant_disabled' });
    const known =
      url.pathname === '/api/assistant/conversations' ||
      url.pathname === '/api/assistant/proposals' ||
      /^\/api\/assistant\/conversations\/[^/]+\/messages$/.test(url.pathname) ||
      /^\/api\/assistant\/runs\/[^/]+$/.test(url.pathname) ||
      /^\/api\/assistant\/proposals\/[^/]+\/(?:confirm|reject)$/.test(url.pathname);
    if (!known) return response(404, { ok: false, error: 'not_found' });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !sameOrigin(req, trustProxy))
      return response(403, { ok: false, error: 'same_origin_required' });
    try {
      if (url.pathname === '/api/assistant/conversations') {
        if (req.method === 'GET') {
          return response(200, { ok: true, items: service.listConversations() });
        }
        if (req.method !== 'POST') return response(405, { ok: false, error: 'method_not_allowed' });
        const body = await readJson(req, bodyLimit);
        const allowed = new Set(['context']);
        if (Object.keys(body).some((key) => !allowed.has(key)))
          return response(400, { ok: false, error: 'invalid_body' });
        const context = body.context;
        if (
          context !== null &&
          (!context ||
            typeof context !== 'object' ||
            Array.isArray(context) ||
            Object.keys(context).some((key) => !['objectType', 'objectId'].includes(key)))
        )
          return response(400, { ok: false, error: 'invalid_body' });
        if (limited(req)) return response(429, { ok: false, error: 'rate_limited' });
        return response(201, {
          ok: true,
          ...service.createConversation({
            objectType: (context && context.objectType) || null,
            objectId: (context && context.objectId) || null,
          }),
        });
      }
      if (url.pathname === '/api/assistant/proposals') {
        if (req.method !== 'GET') return response(405, { ok: false, error: 'method_not_allowed' });
        const conversationId = url.searchParams.get('conversationId');
        if (
          conversationId &&
          (!ENTITY_ID.test(conversationId) || !conversationId.startsWith('conversation_'))
        ) {
          return response(400, { ok: false, error: 'invalid_conversation_id' });
        }
        return response(200, {
          ok: true,
          items: service.listProposals({
            conversationId: conversationId || null,
            status: url.searchParams.get('status') || null,
          }),
        });
      }
      const messages = url.pathname.match(/^\/api\/assistant\/conversations\/([^/]+)\/messages$/);
      if (messages) {
        const conversationId = decodeURIComponent(messages[1]);
        if (!ENTITY_ID.test(conversationId) || !conversationId.startsWith('conversation_'))
          return response(400, { ok: false, error: 'invalid_conversation_id' });
        if (req.method === 'GET') {
          return response(200, {
            ok: true,
            ...service.listMessages(conversationId, {
              limit: url.searchParams.get('limit'),
              cursor: url.searchParams.get('cursor'),
            }),
          });
        }
        if (req.method !== 'POST') return response(405, { ok: false, error: 'method_not_allowed' });
        const body = await readJson(req, bodyLimit);
        if (!body || Object.keys(body).some((key) => !['text', 'clientMessageId'].includes(key)))
          return response(400, { ok: false, error: 'invalid_body' });
        if (limited(req)) return response(429, { ok: false, error: 'rate_limited' });
        return response(202, {
          ok: true,
          ...service.submitMessage({
            conversationId,
            text: body.text,
            clientMessageId: body.clientMessageId,
          }),
        });
      }
      const runs = url.pathname.match(/^\/api\/assistant\/runs\/([^/]+)$/);
      if (runs) {
        if (req.method !== 'GET') return response(405, { ok: false, error: 'method_not_allowed' });
        const runId = decodeURIComponent(runs[1]);
        if (!ENTITY_ID.test(runId) || !runId.startsWith('run_'))
          return response(400, { ok: false, error: 'invalid_run_id' });
        return response(200, { ok: true, ...service.getRun(runId) });
      }
      const proposalAction = url.pathname.match(
        /^\/api\/assistant\/proposals\/([^/]+)\/(confirm|reject)$/
      );
      if (proposalAction) {
        if (req.method !== 'POST') return response(405, { ok: false, error: 'method_not_allowed' });
        const proposalId = decodeURIComponent(proposalAction[1]);
        if (!ENTITY_ID.test(proposalId) || !proposalId.startsWith('proposal_')) {
          return response(400, { ok: false, error: 'invalid_proposal_id' });
        }
        const body = await readJson(req, bodyLimit);
        const allowedBodyKeys = proposalAction[2] === 'confirm' ? ['assignee'] : [];
        if (
          !body ||
          Object.keys(body).some((key) => !allowedBodyKeys.includes(key)) ||
          (body.assignee !== undefined &&
            (typeof body.assignee !== 'string' ||
              !body.assignee.trim() ||
              body.assignee.trim().length > 128))
        ) {
          return response(400, { ok: false, error: 'invalid_body' });
        }
        if (limited(req)) return response(429, { ok: false, error: 'rate_limited' });
        if (proposalAction[2] === 'confirm') {
          if (!config.writesEnabled) {
            return response(403, { ok: false, error: 'assistant_writes_disabled' });
          }
          if (freshnessGuard) freshnessGuard();
          return response(200, {
            ok: true,
            ...(await service.confirmProposal(proposalId, {
              assignee: body.assignee === undefined ? undefined : body.assignee.trim(),
            })),
          });
        }
        return response(200, { ok: true, ...service.rejectProposal(proposalId) });
      }
      return response(404, { ok: false, error: 'not_found' });
    } catch (error) {
      return apiError(error);
    }
  }
  return {
    handle,
    // Server-side test/diagnostic surface only; this object is never serialized to the browser.
    bucketCount: () => buckets.size,
  };
}

module.exports = { createAssistantApi, readJson, sameOrigin };
