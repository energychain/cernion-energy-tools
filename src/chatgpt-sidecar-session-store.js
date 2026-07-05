'use strict';

/**
 * ChatGPT Sidecar session-ticket store (energychain/cernion-energy-tools#388,
 * first-card slice per docs/architecture/chatgpt-sidecar-session-ticket-gate.md).
 *
 * The store is deliberately behind a small interface (create/getByTicket/
 * getById/revoke/recordMeteringEvent/getMeteringSummary) so a persistent
 * backend can replace `createInMemorySessionStore` later without touching
 * callers. Per the owner's implementation-contract answer, the in-memory
 * store is acceptable for this slice's test/dev path only.
 *
 * The ticket is a high-entropy opaque random value — never a signed payload
 * that encodes tenant/user data ChatGPT could inspect. Tenant/user context,
 * capability profile, write scope and metering detail all live server-side,
 * keyed by ticket/sessionId only.
 */

const crypto = require('crypto');

const TTL_OPTIONS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
});
const DEFAULT_TTL = '1h';
const MAX_TTL_MS = TTL_OPTIONS['1d'];

function isValidTtl(ttl) {
  return Object.prototype.hasOwnProperty.call(TTL_OPTIONS, ttl);
}

function resolveTtlMs(ttl) {
  if (!isValidTtl(ttl)) return null;
  const ms = TTL_OPTIONS[ttl];
  return ms > MAX_TTL_MS ? MAX_TTL_MS : ms;
}

function generateTicket() {
  // 32 bytes of entropy, URL-safe — opaque, non-guessable, carries no data.
  return crypto.randomBytes(32).toString('base64url');
}

function generateSessionId() {
  return `cgs_${crypto.randomUUID()}`;
}

function createInMemorySessionStore() {
  const byTicket = new Map();
  const byId = new Map();

  function createSession({
    tenantId,
    userId,
    ttl,
    capabilityProfile,
    writeScope,
    origin,
    metadata,
    baseUrl,
  }) {
    const now = Date.now();
    const ttlMs = resolveTtlMs(ttl);
    if (ttlMs === null) {
      return { ok: false, reason: 'invalid_ttl', allowedTtl: Object.keys(TTL_OPTIONS) };
    }

    const sessionId = generateSessionId();
    const ticket = generateTicket();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();

    const session = {
      sessionId,
      ticket,
      tenantId,
      userId: userId || null,
      ttl,
      createdAt,
      expiresAt,
      revokedAt: null,
      capabilityProfile: [...(capabilityProfile || [])],
      writeScope,
      origin: origin || 'chatgpt_prompt_generator',
      metadata: { ...(metadata || {}) },
      baseUrl: baseUrl || null,
      meteringEvents: [],
      meteringCounts: {},
    };

    byTicket.set(ticket, session);
    byId.set(sessionId, session);
    return { ok: true, session };
  }

  // Resolution status is deliberately coarse for unknown vs revoked tickets:
  // both must fail identically so a caller cannot use response shape to
  // confirm a ticket ever existed (gate doc threat model).
  function resolveByTicket(ticket) {
    const session = ticket ? byTicket.get(ticket) : null;
    if (!session) return { status: 'not_found' };
    if (session.revokedAt) return { status: 'not_found' };
    if (Date.parse(session.expiresAt) <= Date.now()) return { status: 'expired', session };
    return { status: 'active', session };
  }

  function getById(sessionId) {
    return byId.get(sessionId) || null;
  }

  function revoke(sessionId, { tenantId } = {}) {
    const session = byId.get(sessionId);
    if (!session) return { ok: false, reason: 'not_found' };
    if (tenantId && session.tenantId !== tenantId) return { ok: false, reason: 'not_found' };
    if (session.revokedAt) return { ok: true, session, alreadyRevoked: true };
    session.revokedAt = new Date().toISOString();
    return { ok: true, session };
  }

  function recordMeteringEvent(sessionId, eventType, detail = {}) {
    const session = byId.get(sessionId);
    if (!session) return null;
    const event = { eventType, at: new Date().toISOString(), detail };
    session.meteringEvents.push(event);
    session.meteringCounts[eventType] = (session.meteringCounts[eventType] || 0) + 1;
    return event;
  }

  // Redacted summary: counts only, no raw tenant/user/credential detail —
  // safe to expose through the ticket-scoped GET metering endpoint.
  function getMeteringSummary(sessionId) {
    const session = byId.get(sessionId);
    if (!session) return null;
    return {
      sessionCreatedAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      counts: { ...session.meteringCounts },
      eventCount: session.meteringEvents.length,
    };
  }

  function _getInternalEvents(sessionId) {
    const session = byId.get(sessionId);
    return session ? [...session.meteringEvents] : [];
  }

  return {
    createSession,
    resolveByTicket,
    getById,
    revoke,
    recordMeteringEvent,
    getMeteringSummary,
    _getInternalEvents,
  };
}

// Process-wide default instance for the running service. Tests should build
// their own store via createInMemorySessionStore() for isolation.
const defaultStore = createInMemorySessionStore();

module.exports = {
  TTL_OPTIONS,
  DEFAULT_TTL,
  MAX_TTL_MS,
  isValidTtl,
  resolveTtlMs,
  createInMemorySessionStore,
  defaultStore,
};
