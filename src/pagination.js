'use strict';

const crypto = require('crypto');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const OFFSET_SUNSET_DATE = '2026-11-05';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function encodeBase64Url(input) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function decodeBase64Url(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function resolveBaseSecret() {
  if (process.env.PAGINATION_HMAC_SECRET) return process.env.PAGINATION_HMAC_SECRET;
  const seed = [
    'cernion-pagination-v1',
    process.env.CERNION_TOKEN || '',
    process.env.MCP_API_KEY || '',
    process.env.HOSTNAME || '',
    process.cwd(),
  ].join('|');
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function resolveTenantId(ctx, fallbackTenantId = null) {
  return (
    fallbackTenantId ||
    ctx?.meta?.tenantId ||
    ctx?.meta?.user?.tenantId ||
    ctx?.params?.tenantId ||
    'default'
  );
}

function tenantSalt(tenantId) {
  const key = resolveBaseSecret();
  return crypto.createHmac('sha256', key).update(String(tenantId || 'default')).digest('hex');
}

function createSignature(payload, tenantId) {
  return crypto
    .createHmac('sha256', tenantSalt(tenantId))
    .update(stableStringify(payload))
    .digest('hex');
}

function buildFilterHash(filter = {}) {
  return crypto.createHash('sha256').update(stableStringify(filter || {})).digest('hex');
}

function encodeCursor({ pivot, direction = 'next', filterHash = null, tenantId = 'default' }) {
  const basePayload = { pivot, direction, filterHash };
  const hash = createSignature(basePayload, tenantId);
  return encodeBase64Url(JSON.stringify({ ...basePayload, hash }));
}

function decodeCursor(cursor, { tenantId = 'default', expectedFilterHash = null } = {}) {
  try {
    const raw = decodeBase64Url(cursor);
    const payload = JSON.parse(raw);
    const { pivot, direction = 'next', filterHash = null, hash } = payload || {};
    if (!pivot || !hash) throw new Error('INVALID_CURSOR_FORMAT');

    const expectedHash = createSignature({ pivot, direction, filterHash }, tenantId);
    if (expectedHash !== hash) throw new Error('INVALID_CURSOR_SIGNATURE');

    if (expectedFilterHash && filterHash && expectedFilterHash !== filterHash) {
      throw new Error('INVALID_CURSOR_FILTER');
    }

    return { pivot, direction, filterHash };
  } catch (err) {
    const wrapped = new Error('INVALID_CURSOR');
    wrapped.code = 'INVALID_CURSOR';
    wrapped.statusCode = 400;
    wrapped.cause = err;
    throw wrapped;
  }
}

function normalizeLimit(limit, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return defaultLimit;
  return Math.min(Math.floor(value), maxLimit);
}

function pivotFromItem(item) {
  return {
    createdAt: item?.createdAt || item?.timestamp || null,
    id: item?.id || item?._id || item?.key || null,
  };
}

function samePivot(a, b) {
  return String(a?.createdAt || '') === String(b?.createdAt || '') && String(a?.id || '') === String(b?.id || '');
}

function applyCursorPagination({
  items,
  limit,
  cursor,
  offset,
  tenantId,
  filterHash,
  defaultLimit = DEFAULT_LIMIT,
  maxLimit = MAX_LIMIT,
}) {
  const list = Array.isArray(items) ? items : [];
  const normalizedLimit = normalizeLimit(limit, defaultLimit, maxLimit);
  let startIndex = 0;

  if (cursor) {
    const decoded = decodeCursor(cursor, { tenantId, expectedFilterHash: filterHash });
    const idx = list.findIndex((item) => samePivot(pivotFromItem(item), decoded.pivot));
    startIndex = idx >= 0 ? idx + 1 : 0;
  } else if (Number.isFinite(Number(offset)) && Number(offset) > 0) {
    startIndex = Math.max(0, Math.floor(Number(offset)));
  }

  const data = list.slice(startIndex, startIndex + normalizedLimit);
  const hasMore = startIndex + normalizedLimit < list.length;

  const nextCursor =
    hasMore && data.length
      ? encodeCursor({
          pivot: pivotFromItem(data[data.length - 1]),
          direction: 'next',
          filterHash,
          tenantId,
        })
      : null;

  const prevCursor =
    startIndex > 0 && data.length
      ? encodeCursor({
          pivot: pivotFromItem(data[0]),
          direction: 'prev',
          filterHash,
          tenantId,
        })
      : null;

  return {
    data,
    pageInfo: {
      nextCursor,
      prevCursor,
      hasMore,
      totalCountApprox: list.length,
    },
    limit: normalizedLimit,
    offset: startIndex,
  };
}

function applyOffsetDeprecationHeader(ctx, enabled = false) {
  if (!enabled) return;
  ctx.meta.$responseHeaders = {
    ...(ctx.meta.$responseHeaders || {}),
    Deprecation: 'true',
    Sunset: OFFSET_SUNSET_DATE,
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  OFFSET_SUNSET_DATE,
  resolveTenantId,
  buildFilterHash,
  normalizeLimit,
  encodeCursor,
  decodeCursor,
  applyCursorPagination,
  applyOffsetDeprecationHeader,
};
