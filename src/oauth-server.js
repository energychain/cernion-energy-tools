'use strict';

/**
 * OAuth 2.1 (authorization code + mandatory PKCE) authorization server that
 * fronts `/api/mcp` for MCP clients that only support OAuth, not raw
 * Bearer token entry (e.g. claude.ai's remote-connector UI — see
 * docs/oauth.md). Deliberately does NOT introduce a new identity system:
 * the `/oauth/authorize` consent step is "paste an existing CET API token
 * to authorize this client" — the same credential Bearer-auth callers
 * already use (created via `npm run token:create` or
 * https://cernion.de/cet-token/). The token the user proves ownership of
 * becomes the OAuth `access_token` verbatim; `src/mcp-auth.js` needs no
 * changes since it already resolves `ck_...` tokens via
 * `token-manager.verify`, exactly what `/oauth/token` also uses here.
 *
 * Registered as raw (non-aliased) handlers on the root `/` route in
 * services/api.service.js — same pattern as `/metrics` and
 * `src/mcp-transport.js`'s `/api/mcp` handlers, since these endpoints
 * render HTML / issue redirects rather than JSON, and must be reachable
 * *before* any Bearer auth exists (that's the whole point of the flow).
 */

const crypto = require('node:crypto');
const querystring = require('node:querystring');
const { OAuthStore } = require('./oauth-store');

const AUTHORIZE_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';
const REGISTER_PATH = '/oauth/register';

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}

function getBaseUrl(req) {
  if (process.env.API_URL) return process.env.API_URL;
  const proto = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      // Pre-parsed by moleculer-web's bodyParsers when mounted behind
      // services/api.service.js (same situation as src/mcp-transport.js).
      resolve(req.body);
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readFormOrJsonBody(req) {
  const raw = await readBody(req);
  if (raw && typeof raw === 'object') return raw; // already parsed (object body)
  const text = typeof raw === 'string' ? raw : '';
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    return text ? JSON.parse(text) : {};
  }
  return querystring.parse(text);
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function writeHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function verifyPkce(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(codeChallenge));
}

function renderAuthorizeForm({ clientId, redirectUri, state, codeChallenge, error }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorize — Cernion Energy Tools</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  p.hint { color: #555; font-size: 0.9rem; }
  input[type=password] { width: 100%; padding: 0.6rem; box-sizing: border-box; font-size: 1rem; margin: 0.5rem 0 1rem; }
  button { padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; margin-bottom: 1rem; }
</style></head>
<body>
  <h1>Authorize access to Cernion Energy Tools</h1>
  <p class="hint">An application is requesting access to the CET MCP server on your behalf.
  Paste an existing CET API token to authorize it. Don't have one?
  Create one at <a href="https://cernion.de/cet-token/" target="_blank" rel="noopener">cernion.de/cet-token</a>.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="POST" action="${AUTHORIZE_PATH}">
    <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
    <input type="hidden" name="state" value="${escapeHtml(state)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
    <label for="token">CET API Token</label>
    <input type="password" id="token" name="token" placeholder="ck_..." autofocus required>
    <button type="submit">Authorize</button>
  </form>
</body></html>`;
}

async function wellKnownProtectedResource(req, res) {
  const baseUrl = getBaseUrl(req);
  writeJson(res, 200, {
    resource: `${baseUrl}/api/mcp`,
    authorization_servers: [baseUrl],
  });
}

async function wellKnownAuthorizationServer(req, res) {
  const baseUrl = getBaseUrl(req);
  writeJson(res, 200, {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}${AUTHORIZE_PATH}`,
    token_endpoint: `${baseUrl}${TOKEN_PATH}`,
    registration_endpoint: `${baseUrl}${REGISTER_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['mcp'],
  });
}

/**
 * @param {import('moleculer').ServiceBroker} broker
 */
function createOAuthHttpHandlers(broker) {
  const store = new OAuthStore();

  // Lets a page outside this repo (e.g. cernion.de's token-issuance page)
  // display the static OAuth client to paste into an MCP client's connector
  // setup, without duplicating MCP_OAUTH_CLIENT_ID/SECRET as a second copy
  // in that codebase. Publishing the secret here is intentional, not an
  // oversight — see docs/oauth.md: this client authenticates the shared
  // "MCP connector" application, not individual users (per-user access
  // control is the /oauth/authorize consent step, PKCE-bound regardless of
  // whether the client has a secret at all).
  async function clientInfo(req, res) {
    const clientId = process.env.MCP_OAUTH_CLIENT_ID;
    if (!clientId) {
      writeJson(res, 404, {
        error: 'no_static_client_configured',
        error_description:
          'Set MCP_OAUTH_CLIENT_ID (and optionally MCP_OAUTH_CLIENT_SECRET) to enable this endpoint.',
      });
      return;
    }
    const client = store.getClient(clientId);
    writeJson(res, 200, {
      client_id: client.clientId,
      client_secret: client.clientSecret || undefined,
      token_endpoint_auth_method: client.clientSecret ? 'client_secret_post' : 'none',
      authorization_endpoint: `${getBaseUrl(req)}${AUTHORIZE_PATH}`,
      token_endpoint: `${getBaseUrl(req)}${TOKEN_PATH}`,
    });
  }

  async function register(req, res) {
    let body;
    try {
      body = await readFormOrJsonBody(req);
    } catch (err) {
      writeJson(res, 400, { error: 'invalid_client_metadata', error_description: err.message });
      return;
    }
    // Dynamic Client Registration (RFC 7591) — auto-accepted. The real
    // access boundary is the /oauth/authorize consent step (an existing
    // valid CET token), not client identity, so there is nothing to gate
    // here beyond issuing an id (and secret, if the client asked for a
    // confidential client via token_endpoint_auth_method).
    const wantsSecret = body.token_endpoint_auth_method !== 'none';
    const client = store.registerClient({
      clientSecret: wantsSecret ? crypto.randomBytes(24).toString('base64url') : null,
    });
    writeJson(res, 201, {
      client_id: client.clientId,
      client_secret: client.clientSecret || undefined,
      client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
      client_secret_expires_at: 0,
      redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
      token_endpoint_auth_method: wantsSecret ? 'client_secret_post' : 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  }

  async function authorizeGet(req, res) {
    // Dummy base — only req.url's path/query are used below; discarded
    // immediately, never a real network endpoint.
    const url = new URL(req.url, 'https://internal');
    const clientId = url.searchParams.get('client_id') || '';
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const state = url.searchParams.get('state') || '';
    const responseType = url.searchParams.get('response_type') || '';
    const codeChallenge = url.searchParams.get('code_challenge') || '';
    const codeChallengeMethod = url.searchParams.get('code_challenge_method') || '';

    if (!store.getClient(clientId)) {
      writeJson(res, 400, { error: 'invalid_client', error_description: 'Unknown client_id' });
      return;
    }
    if (!redirectUri || !/^https?:\/\//.test(redirectUri)) {
      writeJson(res, 400, {
        error: 'invalid_request',
        error_description: 'redirect_uri is required',
      });
      return;
    }
    if (responseType !== 'code') {
      writeJson(res, 400, { error: 'unsupported_response_type' });
      return;
    }
    if (!codeChallenge || codeChallengeMethod !== 'S256') {
      writeJson(res, 400, {
        error: 'invalid_request',
        error_description: 'PKCE (code_challenge with S256) is required',
      });
      return;
    }

    writeHtml(res, 200, renderAuthorizeForm({ clientId, redirectUri, state, codeChallenge }));
  }

  async function authorizePost(req, res) {
    let body;
    try {
      body = await readFormOrJsonBody(req);
    } catch (err) {
      writeJson(res, 400, { error: 'invalid_request', error_description: err.message });
      return;
    }
    const {
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
    } = body;
    const token = (body.token || '').trim();

    const renderError = (message) => {
      writeHtml(
        res,
        401,
        renderAuthorizeForm({ clientId, redirectUri, state, codeChallenge, error: message })
      );
    };

    if (!token) {
      renderError('Please paste a CET API token.');
      return;
    }

    let tokenMeta;
    try {
      if (token.startsWith('ck_')) {
        const verification = await broker.call('token-manager.verify', {
          token,
          method: 'POST',
          path: '/oauth/authorize',
          trackUsage: false,
        });
        if (!verification?.valid) {
          renderError('Invalid or revoked token.');
          return;
        }
        tokenMeta = { type: 'ck', scope: verification.scope, tenantId: verification.tenantId };
      } else if (token.startsWith('csess_')) {
        const verification = await broker.call('auth.verify', { token, trackUsage: false });
        if (!verification?.valid) {
          renderError('Invalid or expired session token.');
          return;
        }
        tokenMeta = { type: 'csess', tenantId: verification.tenantId };
      } else {
        renderError('Unrecognized token format — expected a ck_... API token.');
        return;
      }
    } catch (err) {
      renderError(`Token verification failed: ${err.message}`);
      return;
    }

    const code = store.createAuthorizationCode({
      clientId,
      redirectUri,
      codeChallenge,
      accessToken: token,
      tokenMeta,
    });

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (state) redirectUrl.searchParams.set('state', state);
    res.writeHead(302, { Location: redirectUrl.toString() });
    res.end();
  }

  async function token(req, res) {
    let body;
    try {
      body = await readFormOrJsonBody(req);
    } catch (err) {
      writeJson(res, 400, { error: 'invalid_request', error_description: err.message });
      return;
    }

    if (body.grant_type !== 'authorization_code') {
      writeJson(res, 400, { error: 'unsupported_grant_type' });
      return;
    }

    const record = store.consumeAuthorizationCode(body.code);
    if (!record) {
      writeJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'Unknown, expired, or already-used code',
      });
      return;
    }
    if (record.redirectUri !== body.redirect_uri) {
      writeJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }
    if (record.clientId !== body.client_id) {
      writeJson(res, 400, { error: 'invalid_grant', error_description: 'client_id mismatch' });
      return;
    }
    const client = store.getClient(body.client_id);
    if (client?.clientSecret && client.clientSecret !== body.client_secret) {
      writeJson(res, 401, { error: 'invalid_client' });
      return;
    }
    if (!verifyPkce(body.code_verifier, record.codeChallenge)) {
      writeJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'PKCE verification failed',
      });
      return;
    }

    writeJson(res, 200, {
      access_token: record.accessToken,
      token_type: 'bearer',
      scope: 'mcp',
    });
  }

  return {
    wellKnownProtectedResource,
    wellKnownAuthorizationServer,
    clientInfo,
    register,
    authorizeGet,
    authorizePost,
    token,
  };
}

module.exports = { createOAuthHttpHandlers, AUTHORIZE_PATH, TOKEN_PATH, REGISTER_PATH };
