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
const fs = require('fs');
const path = require('path');

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
      turns: [],
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

  function recordTurn(sessionId, turn = {}) {
    const session = byId.get(sessionId);
    if (!session) return null;
    const event = { at: new Date().toISOString(), ...turn };
    if (!Array.isArray(session.turns)) session.turns = [];
    session.turns.push(event);
    return event;
  }

  function getTurns(sessionId) {
    const session = byId.get(sessionId);
    return session && Array.isArray(session.turns) ? [...session.turns] : null;
  }

  // Redacted summary: no raw tenant/user/credential detail. Recent turns are
  // ticket-scoped diagnostics for ChatGPT Action debugging.
  function getMeteringSummary(sessionId) {
    const session = byId.get(sessionId);
    if (!session) return null;
    const recentTurns = Array.isArray(session.turns)
      ? session.turns.slice(-10).map((turn) => ({
          at: turn.at,
          turnId: turn.turnId,
          parentTurnId: turn.parentTurnId || null,
          operation: turn.operation || null,
          transport: turn.transport || null,
          capability: turn.capability || null,
          promptHash: turn.promptHash || null,
          queryPreview: turn.queryPreview || null,
          answerPreview: turn.answerPreview || null,
          confidence: turn.confidence || null,
          responseKind: turn.responseKind || null,
          capabilityGrounding: turn.capabilityGrounding || null,
          restPlan: turn.restPlan || null,
        }))
      : [];
    return {
      sessionCreatedAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      counts: { ...session.meteringCounts },
      eventCount: session.meteringEvents.length,
      recentTurns,
    };
  }

  function _getInternalEvents(sessionId) {
    const session = byId.get(sessionId);
    return session ? [...session.meteringEvents] : [];
  }

  function _allSessions() {
    return [...byId.values()];
  }

  function _loadSession(session) {
    if (!session?.sessionId || !session?.ticket) return false;
    const normalized = {
      ...session,
      capabilityProfile: Array.isArray(session.capabilityProfile)
        ? [...session.capabilityProfile]
        : [],
      metadata: { ...(session.metadata || {}) },
      meteringEvents: Array.isArray(session.meteringEvents) ? [...session.meteringEvents] : [],
      meteringCounts: { ...(session.meteringCounts || {}) },
      turns: Array.isArray(session.turns) ? [...session.turns] : [],
    };
    byTicket.set(normalized.ticket, normalized);
    byId.set(normalized.sessionId, normalized);
    return true;
  }

  return {
    createSession,
    resolveByTicket,
    getById,
    revoke,
    recordMeteringEvent,
    recordTurn,
    getTurns,
    getMeteringSummary,
    _getInternalEvents,
    _allSessions,
    _loadSession,
  };
}

function createFileBackedSessionStore({
  filePath = process.env.CHATGPT_SIDECAR_SESSION_STORE_PATH ||
    path.join(process.cwd(), 'data', 'chatgpt-sidecar-sessions', 'sessions.json'),
} = {}) {
  const memory = createInMemorySessionStore();

  function ensureDirectory() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function persist() {
    ensureDirectory();
    const sessions = [];
    for (const session of memory._allSessions()) {
      sessions.push(session);
    }
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ schemaVersion: 1, sessions }, null, 2));
    fs.renameSync(tempPath, filePath);
  }

  function hydrate() {
    if (!fs.existsSync(filePath)) return;
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
    for (const session of sessions) {
      memory._loadSession(session);
    }
  }

  hydrate();

  return {
    createSession(params) {
      const result = memory.createSession(params);
      if (result.ok) persist();
      return result;
    },
    resolveByTicket: memory.resolveByTicket,
    getById: memory.getById,
    revoke(sessionId, options) {
      const result = memory.revoke(sessionId, options);
      if (result.ok) persist();
      return result;
    },
    recordMeteringEvent(sessionId, eventType, detail) {
      const event = memory.recordMeteringEvent(sessionId, eventType, detail);
      if (event) persist();
      return event;
    },
    recordTurn(sessionId, turn) {
      const event = memory.recordTurn(sessionId, turn);
      if (event) persist();
      return event;
    },
    getTurns: memory.getTurns,
    getMeteringSummary: memory.getMeteringSummary,
    _getInternalEvents: memory._getInternalEvents,
    _filePath: filePath,
  };
}

function createDefaultSessionStore() {
  if (process.env.CHATGPT_SIDECAR_SESSION_STORE === 'memory') {
    return createInMemorySessionStore();
  }
  if (
    process.env.CHATGPT_SIDECAR_SESSION_STORE === 'file' ||
    process.env.NODE_ENV !== 'test'
  ) {
    return createFileBackedSessionStore();
  }
  return createInMemorySessionStore();
}

// Process-wide default instance for the running service. Production uses a
// durable file-backed store so expiry, revocation and metering survive PM2
// restarts even when PM2 does not set NODE_ENV=production. Tests keep the
// in-memory implementation unless CHATGPT_SIDECAR_SESSION_STORE=file is set.
const defaultStore = createDefaultSessionStore();

module.exports = {
  TTL_OPTIONS,
  DEFAULT_TTL,
  MAX_TTL_MS,
  isValidTtl,
  resolveTtlMs,
  createInMemorySessionStore,
  createFileBackedSessionStore,
  createDefaultSessionStore,
  defaultStore,
};
