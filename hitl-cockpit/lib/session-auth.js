'use strict';

const crypto = require('node:crypto');

const DEFAULT_COOKIE_NAME = '__Host-agentos_hitl_session';
const DEFAULT_TTL_SECONDS = 30 * 60;
const MAX_TTL_SECONDS = 8 * 60 * 60;
const SESSION_VERSION = 1;
const BOOTSTRAP_TICKET_VERSION = 1;
const BOOTSTRAP_TICKET_TTL_SECONDS = 60;

function timingSafeTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function boundedTtl(value) {
  const parsed = Number(value || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.max(60, Math.min(MAX_TTL_SECONDS, Math.floor(parsed)));
}

function parseCookies(header) {
  const cookies = new Map();
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

function deriveSigningKey(staticToken) {
  return crypto
    .createHash('sha256')
    .update('agentos-hitl-session-v1\0', 'utf8')
    .update(String(staticToken || ''), 'utf8')
    .digest();
}

function sign(encodedPayload, signingKey) {
  return crypto.createHmac('sha256', signingKey).update(encodedPayload, 'utf8').digest('base64url');
}

function bootstrapTicketSignature({ staticToken, timestamp, nonce, pathname }) {
  return crypto
    .createHmac('sha256', deriveSigningKey(staticToken))
    .update(
      `agentos-hitl-bootstrap-ticket-v${BOOTSTRAP_TICKET_VERSION}\0${timestamp}\0${nonce}\0${pathname}`,
      'utf8'
    )
    .digest('base64url');
}

function createBootstrapTicket(options = {}) {
  const staticToken = String(options.staticToken || '');
  if (!staticToken) throw new Error('session_auth_token_missing');
  const timestamp = Number.isInteger(options.timestamp)
    ? options.timestamp
    : Math.floor(Date.now() / 1000);
  const pathname = options.pathname === '/' ? '/' : '/management';
  const nonce = options.nonce || crypto.randomBytes(18).toString('base64url');
  const signature = bootstrapTicketSignature({ staticToken, timestamp, nonce, pathname });
  return { timestamp, nonce, signature };
}

function secureHeaders({ html = false } = {}) {
  const headers = {
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
  if (html) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function createSessionAuth(options = {}) {
  const staticToken = String(options.staticToken || '');
  const cookieName = String(options.cookieName || DEFAULT_COOKIE_NAME);
  const ttlSeconds = boundedTtl(options.ttlSeconds);
  const allowLegacyBearer = options.allowLegacyBearer === true;
  const now = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const randomBytes =
    typeof options.randomBytes === 'function'
      ? options.randomBytes
      : (size) => crypto.randomBytes(size);
  const signingKey = deriveSigningKey(staticToken);
  const usedBootstrapTickets = new Map();
  const sessionPrincipal = `cockpit_session_${crypto
    .createHmac('sha256', signingKey)
    .update('rate-limit-principal\0session', 'utf8')
    .digest('base64url')}`;

  function createSession() {
    if (!staticToken) throw new Error('session_auth_token_missing');
    const issuedAt = now();
    const payload = Buffer.from(
      JSON.stringify({
        v: SESSION_VERSION,
        iat: issuedAt,
        exp: issuedAt + ttlSeconds,
        nonce: randomBytes(18).toString('base64url'),
      }),
      'utf8'
    ).toString('base64url');
    return `${payload}.${sign(payload, signingKey)}`;
  }

  function validateSession(value) {
    if (!staticToken || !value || String(value).length > 2048) return false;
    const parts = String(value).split('.');
    if (parts.length !== 2) return false;
    const expected = sign(parts[0], signingKey);
    if (!timingSafeTextEqual(parts[1], expected)) return false;
    try {
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const current = now();
      return Boolean(
        payload &&
        payload.v === SESSION_VERSION &&
        Number.isInteger(payload.iat) &&
        Number.isInteger(payload.exp) &&
        typeof payload.nonce === 'string' &&
        payload.nonce.length >= 16 &&
        payload.iat <= current + 60 &&
        payload.exp > current &&
        payload.exp - payload.iat <= MAX_TTL_SECONDS
      );
    } catch (_) {
      return false;
    }
  }

  function sessionCookie(value) {
    return `${cookieName}=${value}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Strict`;
  }

  function authorize(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sessionValue = cookies.get(cookieName);
    if (validateSession(sessionValue))
      return { ok: true, method: 'session', identity: sessionPrincipal };
    if (allowLegacyBearer) {
      const authorization = String(req.headers.authorization || '');
      if (
        authorization.startsWith('Bearer ') &&
        timingSafeTextEqual(authorization.slice('Bearer '.length), staticToken)
      ) {
        return { ok: true, method: 'legacy_bearer', identity: 'legacy_bearer' };
      }
    }
    return { ok: false, method: null, identity: null };
  }

  function bootstrap(req, url) {
    if (req.method !== 'GET' || !['/', '/management'].includes(url.pathname)) return null;
    const token = url.searchParams.get('token');
    const ticketTimestamp = Number(url.searchParams.get('bootstrap_ts'));
    const ticketNonce = String(url.searchParams.get('bootstrap_nonce') || '');
    const ticketSignature = String(url.searchParams.get('bootstrap_sig') || '');
    let authenticated = Boolean(token && staticToken && timingSafeTextEqual(token, staticToken));
    if (!authenticated && staticToken && Number.isInteger(ticketTimestamp)) {
      const current = now();
      const expected = bootstrapTicketSignature({
        staticToken,
        timestamp: ticketTimestamp,
        nonce: ticketNonce,
        pathname: url.pathname,
      });
      const ticketKey = `${ticketTimestamp}:${ticketNonce}:${ticketSignature}`;
      authenticated = Boolean(
        ticketNonce.length >= 16 &&
        ticketNonce.length <= 128 &&
        ticketSignature &&
        Math.abs(current - ticketTimestamp) <= BOOTSTRAP_TICKET_TTL_SECONDS &&
        timingSafeTextEqual(ticketSignature, expected) &&
        !usedBootstrapTickets.has(ticketKey)
      );
      if (authenticated) {
        usedBootstrapTickets.set(ticketKey, current);
        for (const [key, usedAt] of usedBootstrapTickets) {
          if (current - usedAt > BOOTSTRAP_TICKET_TTL_SECONDS) usedBootstrapTickets.delete(key);
        }
      }
    }
    if (!authenticated) return null;
    const clean = new URL(url.toString());
    clean.searchParams.delete('token');
    clean.searchParams.delete('bootstrap_ts');
    clean.searchParams.delete('bootstrap_nonce');
    clean.searchParams.delete('bootstrap_sig');
    const location = `${clean.pathname}${clean.search}`;
    return {
      status: 303,
      headers: {
        ...secureHeaders({ html: true }),
        location,
        'set-cookie': sessionCookie(createSession()),
      },
    };
  }

  return {
    authorize,
    bootstrap,
    cookieName,
    createSession,
    sessionCookie,
    ttlSeconds,
    validateSession,
  };
}

module.exports = {
  BOOTSTRAP_TICKET_TTL_SECONDS,
  DEFAULT_COOKIE_NAME,
  DEFAULT_TTL_SECONDS,
  createBootstrapTicket,
  createSessionAuth,
  parseCookies,
  secureHeaders,
  timingSafeTextEqual,
};
