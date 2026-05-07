'use strict';

const crypto = require('crypto');
const jobStore = require('./job-store');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',');
  return `{${body}}`;
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === String(name).toLowerCase());
  return key ? String(headers[key] || '').trim() : '';
}

function resolveClientKey(ctx, explicitClientKey) {
  if (typeof explicitClientKey === 'string' && explicitClientKey.trim()) return explicitClientKey.trim();
  if (typeof ctx?.params?.clientKey === 'string' && ctx.params.clientKey.trim()) {
    return ctx.params.clientKey.trim();
  }
  if (typeof ctx?.meta?.clientKey === 'string' && ctx.meta.clientKey.trim()) {
    return ctx.meta.clientKey.trim();
  }

  const headers = ctx?.meta?.requestHeaders || {};
  return (
    readHeader(headers, 'x-client-key') ||
    readHeader(headers, 'x-idempotency-key') ||
    readHeader(headers, 'idempotency-key')
  );
}

function buildIdempotencyKey({ service, action, params, explicitIdempotencyKey, clientKey }) {
  if (typeof explicitIdempotencyKey === 'string' && explicitIdempotencyKey.trim()) {
    return explicitIdempotencyKey.trim();
  }

  const payloadHash = crypto
    .createHash('sha256')
    .update(stableStringify(params || {}))
    .digest('hex');

  if (clientKey) {
    return `ck:${clientKey}:${service || 'unknown'}:${action || 'unknown'}:${payloadHash}`;
  }

  return `hash:${service || 'unknown'}:${action || 'unknown'}:${payloadHash}`;
}

async function runAsync(ctx, options) {
  const {
    service,
    action,
    params,
    clientKey,
    idempotencyKey,
    worker,
  } = options || {};

  if (typeof worker !== 'function') {
    throw new Error('runAsync requires a worker function');
  }

  const resolvedClientKey = resolveClientKey(ctx, clientKey);
  const resolvedIdempotencyKey = buildIdempotencyKey({
    service,
    action,
    params,
    explicitIdempotencyKey: idempotencyKey,
    clientKey: resolvedClientKey,
  });

  return jobStore.startJob(
    ctx,
    { service, action },
    worker,
    {
      idempotencyKey: resolvedIdempotencyKey,
    }
  );
}

module.exports = {
  runAsync,
  resolveClientKey,
  buildIdempotencyKey,
};
