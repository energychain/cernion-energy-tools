'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DEFAULT_COOKIE_NAME,
  createSessionAuth,
  parseCookies,
  secureHeaders,
} = require('../lib/session-auth');

function request({ method = 'GET', cookie = '', authorization = '' } = {}) {
  return { method, headers: { cookie, authorization } };
}

function url(pathname) {
  return new URL(pathname, 'https://hitl.example.test');
}

test('bootstrap exchanges the legacy URL token for a hardened short-lived session', () => {
  const auth = createSessionAuth({
    staticToken: 'transition-token-with-sufficient-entropy',
    ttlSeconds: 900,
    now: () => 1700000000,
    randomBytes: () => Buffer.alloc(18, 7),
  });
  const result = auth.bootstrap(
    request(),
    url('/management?view=overview&token=transition-token-with-sufficient-entropy')
  );

  assert.equal(result.status, 303);
  assert.equal(result.headers.location, '/management?view=overview');
  assert.doesNotMatch(result.headers.location, /token/i);
  assert.match(result.headers['set-cookie'], new RegExp(`^${DEFAULT_COOKIE_NAME}=`));
  assert.match(result.headers['set-cookie'], /HttpOnly/);
  assert.match(result.headers['set-cookie'], /Secure/);
  assert.match(result.headers['set-cookie'], /SameSite=Strict/);
  assert.match(result.headers['set-cookie'], /Path=\//);
  assert.match(result.headers['set-cookie'], /Max-Age=900/);
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('query tokens never authorize API calls and invalid bootstrap attempts do not set cookies', () => {
  const auth = createSessionAuth({ staticToken: 'correct-token' });
  assert.equal(auth.bootstrap(request(), url('/api/health?token=correct-token')), null);
  assert.equal(auth.bootstrap(request(), url('/?token=wrong-token')), null);
  assert.equal(auth.bootstrap(request({ method: 'POST' }), url('/?token=correct-token')), null);
  assert.deepEqual(auth.authorize(request()), { ok: false, method: null });
});

test('valid sessions authorize requests while tampered and expired sessions fail closed', () => {
  let current = 1700000000;
  const auth = createSessionAuth({
    staticToken: 'session-signing-token',
    ttlSeconds: 120,
    now: () => current,
    randomBytes: () => Buffer.alloc(18, 9),
  });
  const session = auth.createSession();
  const cookie = `${auth.cookieName}=${session}`;

  assert.deepEqual(auth.authorize(request({ cookie })), { ok: true, method: 'session' });
  assert.equal(auth.validateSession(`${session.slice(0, -1)}x`), false);
  assert.equal(auth.validateSession('not-a-session'), false);

  current += 121;
  assert.deepEqual(auth.authorize(request({ cookie })), { ok: false, method: null });
});

test('legacy bearer is disabled by default and can be enabled only for explicit transition clients', () => {
  const disabled = createSessionAuth({ staticToken: 'legacy-token' });
  const enabled = createSessionAuth({ staticToken: 'legacy-token', allowLegacyBearer: true });
  const req = request({ authorization: 'Bearer legacy-token' });

  assert.deepEqual(disabled.authorize(req), { ok: false, method: null });
  assert.deepEqual(enabled.authorize(req), { ok: true, method: 'legacy_bearer' });
  assert.deepEqual(enabled.authorize(request({ authorization: 'Bearer wrong' })), {
    ok: false,
    method: null,
  });
});

test('cookie parser and security headers reject ambient browser authority', () => {
  assert.deepEqual(Object.fromEntries(parseCookies('one=1; two=value=with=equals; one=ignored')), {
    one: '1',
    two: 'value=with=equals',
  });
  const headers = secureHeaders({ html: true });
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'], /default-src 'self'/);
  assert.match(headers['permissions-policy'], /camera=\(\)/);
  assert.ok(!JSON.stringify(headers).includes('legacy-token'));
});
