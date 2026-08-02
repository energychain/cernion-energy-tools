'use strict';

const http = require('http');
const crypto = require('crypto');
const { ServiceBroker } = require('moleculer');
const { createOAuthHttpHandlers } = require('../src/oauth-server');
const { resolveMcpAuth } = require('../src/mcp-auth');

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('OAuth authorization server (fronting /api/mcp)', () => {
  let broker;
  let httpServer;
  let baseUrl;
  let originalApiUrl;
  let originalClientId;
  let originalClientSecret;

  beforeAll(async () => {
    // getBaseUrl() prefers process.env.API_URL over the request's Host
    // header by design (a fixed, operator-controlled issuer URL is safer
    // for OAuth metadata than trusting client-supplied headers) — unset it
    // here so these tests exercise the dynamic Host-header fallback
    // against the ephemeral test server instead. Restored in afterAll.
    originalApiUrl = process.env.API_URL;
    delete process.env.API_URL;

    // OAuthStore seeds its static client from these at construction time —
    // set before createOAuthHttpHandlers() below so GET /oauth/client-info
    // has something to return.
    originalClientId = process.env.MCP_OAUTH_CLIENT_ID;
    originalClientSecret = process.env.MCP_OAUTH_CLIENT_SECRET;
    process.env.MCP_OAUTH_CLIENT_ID = 'claude-ai';
    process.env.MCP_OAUTH_CLIENT_SECRET = 'static-secret-value';

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'token-manager',
      actions: {
        verify: {
          handler(ctx) {
            if (ctx.params.token === 'ck_valid') {
              return { valid: true, tokenId: 't1', scope: 'full-access', tenantId: 'tenant-a' };
            }
            return { valid: false, reason: 'INVALID' };
          },
        },
      },
    });

    broker.createService({
      name: 'auth',
      actions: {
        verify: {
          handler(ctx) {
            if (ctx.params.token === 'csess_valid') {
              return { valid: true, sessionId: 's1', tenantId: 'tenant-a', roles: ['read-only'] };
            }
            return { valid: false };
          },
        },
      },
    });

    await broker.start();

    const handlers = createOAuthHttpHandlers(broker);
    httpServer = http.createServer(async (req, res) => {
      const path = req.url.split('?')[0];
      if (path === '/.well-known/oauth-protected-resource' && req.method === 'GET')
        return handlers.wellKnownProtectedResource(req, res);
      if (path === '/.well-known/oauth-authorization-server' && req.method === 'GET')
        return handlers.wellKnownAuthorizationServer(req, res);
      if (path === '/oauth/client-info' && req.method === 'GET')
        return handlers.clientInfo(req, res);
      if (path === '/oauth/register' && req.method === 'POST') return handlers.register(req, res);
      if (path === '/oauth/authorize' && req.method === 'GET')
        return handlers.authorizeGet(req, res);
      if (path === '/oauth/authorize' && req.method === 'POST')
        return handlers.authorizePost(req, res);
      if (path === '/oauth/token' && req.method === 'POST') return handlers.token(req, res);
      res.writeHead(404).end();
    });

    await new Promise((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  });

  afterAll(async () => {
    await broker.stop();
    await new Promise((resolve) => httpServer.close(resolve));
    if (originalApiUrl !== undefined) process.env.API_URL = originalApiUrl;
    if (originalClientId !== undefined) process.env.MCP_OAUTH_CLIENT_ID = originalClientId;
    else delete process.env.MCP_OAUTH_CLIENT_ID;
    if (originalClientSecret !== undefined)
      process.env.MCP_OAUTH_CLIENT_SECRET = originalClientSecret;
    else delete process.env.MCP_OAUTH_CLIENT_SECRET;
  });

  test('GET /oauth/client-info returns the statically-configured client', async () => {
    const res = await fetch(`${baseUrl}/oauth/client-info`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client_id).toBe('claude-ai');
    expect(body.client_secret).toBe('static-secret-value');
    expect(body.token_endpoint_auth_method).toBe('client_secret_post');
    expect(body.authorization_endpoint).toBe(`${baseUrl}/oauth/authorize`);
  });

  test('getBaseUrl prefers a configured API_URL over the request Host header', async () => {
    process.env.API_URL = 'https://api.cernion.de';
    try {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
      const body = await res.json();
      expect(body.resource).toBe('https://api.cernion.de/api/mcp');
    } finally {
      delete process.env.API_URL;
    }
  });

  async function registerClient() {
    const res = await fetch(`${baseUrl}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/callback'] }),
    });
    expect(res.status).toBe(201);
    return res.json();
  }

  test('protected-resource metadata points to /api/mcp and this origin', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    const body = await res.json();
    expect(body.resource).toBe(`${baseUrl}/api/mcp`);
    expect(body.authorization_servers).toEqual([baseUrl]);
  });

  test('authorization-server metadata advertises the 3 endpoints and PKCE S256', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    const body = await res.json();
    expect(body.authorization_endpoint).toBe(`${baseUrl}/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${baseUrl}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${baseUrl}/oauth/register`);
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });

  test('dynamic client registration issues a client_id', async () => {
    const client = await registerClient();
    expect(client.client_id).toMatch(/^mcp_/);
    expect(client.token_endpoint_auth_method).toBe('client_secret_post');
    expect(client.client_secret).toBeTruthy();
  });

  test('GET /oauth/authorize rejects an unknown client_id', async () => {
    const { challenge } = pkcePair();
    const res = await fetch(
      `${baseUrl}/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent('https://x/cb')}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_client');
  });

  test('GET /oauth/authorize rejects a request missing PKCE', async () => {
    const client = await registerClient();
    const res = await fetch(
      `${baseUrl}/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent('https://x/cb')}&response_type=code`
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_request');
  });

  test('GET /oauth/authorize renders the consent form for a valid request', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const redirectUri = 'https://claude.ai/api/mcp/callback';
    const res = await fetch(
      `${baseUrl}/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/oauth/authorize"');
    expect(html).toContain(`value="${client.client_id}"`);
    expect(html).toContain('name="token"');
  });

  test('full authorization-code + PKCE flow yields an access_token equal to the pasted CET token', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'https://claude.ai/api/mcp/callback';

    const authorizeRes = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        state: 'xyz',
        code_challenge: challenge,
        token: 'ck_valid',
      }),
    });
    expect(authorizeRes.status).toBe(302);
    const location = new URL(authorizeRes.headers.get('location'));
    expect(location.origin + location.pathname).toBe(redirectUri);
    expect(location.searchParams.get('state')).toBe('xyz');
    const code = location.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        client_secret: client.client_secret,
        code_verifier: verifier,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokenBody = await tokenRes.json();
    expect(tokenBody.access_token).toBe('ck_valid');
    expect(tokenBody.token_type).toBe('bearer');

    // The OAuth-issued access_token must work exactly like a directly-pasted
    // Bearer token against the MCP transport's own auth resolution.
    const mcpAuth = await resolveMcpAuth(broker, `Bearer ${tokenBody.access_token}`);
    expect(mcpAuth.ok).toBe(true);
    expect(mcpAuth.meta.apiToken.tenantId).toBe('tenant-a');
  });

  test('POST /oauth/authorize with an invalid token re-renders the form with an error', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const res = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'https://claude.ai/api/mcp/callback',
        code_challenge: challenge,
        token: 'ck_bogus',
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid or revoked token');
  });

  test('POST /oauth/token rejects a reused (already-consumed) code', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'https://claude.ai/api/mcp/callback';

    const authorizeRes = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        token: 'ck_valid',
      }),
    });
    const code = new URL(authorizeRes.headers.get('location')).searchParams.get('code');

    const exchangeOnce = () =>
      fetch(`${baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: client.client_id,
          client_secret: client.client_secret,
          code_verifier: verifier,
        }),
      });

    expect((await exchangeOnce()).status).toBe(200);
    const second = await exchangeOnce();
    expect(second.status).toBe(400);
    expect((await second.json()).error).toBe('invalid_grant');
  });

  test('POST /oauth/token rejects a wrong code_verifier (PKCE failure)', async () => {
    const client = await registerClient();
    const { challenge } = pkcePair();
    const redirectUri = 'https://claude.ai/api/mcp/callback';

    const authorizeRes = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        token: 'ck_valid',
      }),
    });
    const code = new URL(authorizeRes.headers.get('location')).searchParams.get('code');

    const res = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        client_secret: client.client_secret,
        code_verifier: 'totally-wrong-verifier',
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  test('POST /oauth/token accepts a csess_ session token the same way', async () => {
    const client = await registerClient();
    const { verifier, challenge } = pkcePair();
    const redirectUri = 'https://claude.ai/api/mcp/callback';

    const authorizeRes = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        token: 'csess_valid',
      }),
    });
    expect(authorizeRes.status).toBe(302);
    const code = new URL(authorizeRes.headers.get('location')).searchParams.get('code');

    const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        client_secret: client.client_secret,
        code_verifier: verifier,
      }),
    });
    expect(tokenRes.status).toBe(200);
    expect((await tokenRes.json()).access_token).toBe('csess_valid');
  });
});

describe('GET /oauth/client-info without a static client configured', () => {
  let httpServer;
  let baseUrl;
  let originalClientId;

  beforeAll(async () => {
    originalClientId = process.env.MCP_OAUTH_CLIENT_ID;
    delete process.env.MCP_OAUTH_CLIENT_ID;

    const handlers = createOAuthHttpHandlers(new ServiceBroker({ logger: false }));
    httpServer = http.createServer((req, res) => handlers.clientInfo(req, res));
    await new Promise((resolve) => httpServer.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    if (originalClientId !== undefined) process.env.MCP_OAUTH_CLIENT_ID = originalClientId;
  });

  test('returns 404 when no static client is configured', async () => {
    const res = await fetch(baseUrl);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('no_static_client_configured');
  });
});
