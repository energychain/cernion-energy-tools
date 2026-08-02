# OAuth 2.1 for the MCP server (v0.99.4)

The MCP server (`docs/mcp-server.md`) authenticates with the same Bearer
tokens as the REST API — but some MCP clients (notably claude.ai's remote
connector UI) can't accept a raw Bearer token at all; they only support
OAuth (a Client ID + Client Secret, then a browser authorization step).
This adds an OAuth 2.1 authorization-code + PKCE flow that fronts
`/api/mcp`, without introducing a second identity system: the OAuth
`access_token` an MCP client ends up with **is** the same `ck_...` API
token (or `csess_...` session token) a Bearer-auth caller would use
directly. `src/mcp-auth.js` needed zero changes — it already resolves
`ck_...`/`csess_...` tokens via `token-manager.verify`/`auth.verify`,
exactly what `/oauth/token` also calls here.

- Implementation: `src/oauth-server.js` (HTTP/protocol layer, raw handlers)
  + `src/oauth-store.js` (in-memory clients/authorization-codes, mirrors
  `copilot-process.service.js`'s `ProcessIntentStore` pattern)
- Registered on the root `/` route in `services/api.service.js` (same
  pattern as `/metrics` and `src/mcp-transport.js`'s `/api/mcp` handlers)
- Tests: `tests/oauth-server.test.js` — full authorization-code + PKCE
  round trip over a real HTTP server, including a check that the resulting
  `access_token` authenticates via the real `resolveMcpAuth`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource` | RFC 9728 — points MCP clients at the authorization server |
| GET | `/.well-known/oauth-authorization-server` | RFC 8414 — endpoint + capability metadata |
| GET | `/oauth/client-info` | Returns the statically-configured client (`{client_id, client_secret, ...}`), 404 if `MCP_OAUTH_CLIENT_ID` is unset — lets a page outside this repo (e.g. cernion.de's token-issuance page) display it without duplicating the env vars as a second copy |
| POST | `/oauth/register` | RFC 7591 Dynamic Client Registration (auto-accepted) |
| GET | `/oauth/authorize` | Renders the consent form |
| POST | `/oauth/authorize` | Consent submission → redirects with `code` |
| POST | `/oauth/token` | Exchanges `code` (+ PKCE `code_verifier`) for `access_token` |

All unauthenticated by design (raw handlers, bypass `onBeforeCall`) —
that's the point of the flow: it's how a client *gets* a token, so it
can't require one first.

## The consent step, and why it's a token paste, not a new login

`/oauth/authorize` doesn't build a password/SSO login page. It renders a
single field: paste an existing CET API token (`ck_...`, created via
`npm run token:create` or https://cernion.de/cet-token/, or a `csess_...`
session token). The server verifies it (`token-manager.verify` /
`auth.verify` — the same calls `services/api.service.js`'s `onBeforeCall`
makes for every other REST request) and, if valid, issues a short-lived
authorization `code` bound to that token, the PKCE `code_challenge`, and
the client's `redirect_uri`. `/oauth/token` later exchanges the code (with
PKCE verification) for that **same token, verbatim**, as `access_token`.

This was a deliberate scope decision, not a shortcut: building a real
self-service login (password or working SSO) is a materially bigger
project — `services/auth.service.js`'s existing OIDC/SAML support is
explicitly gated behind `AUTH_FOUNDATION_MODE` and documented as not
production-ready ("no openid-client PKCE/discovery flow" — see its v0.99.0
CHANGELOG entry). Token-paste reuses 100% of the existing, already-hardened
token verification path instead of half-building a second one.

**Consequence worth knowing**: because the OAuth access_token *is* the
pasted token, there's no separate per-OAuth-grant revocation — revoking
the underlying CET token (`DELETE /api/tokens/:id`) revokes every OAuth
client holding it too, and there's no way to revoke "just claude.ai's
access" while leaving the token itself valid elsewhere. Acceptable for v1;
a v2 could mint a distinct child token per grant via
`token-manager.create` (deriving `tenantId`/`userId`/`scope` from the
pasted token's own verification) for independent revocability — not done
here to avoid `token-manager`'s `maxTokensPerInstallation` cap (20) being
consumed by repeated OAuth (re-)authorizations.

## Configuring a static client (recommended for claude.ai)

claude.ai's custom-connector UI expects a Client ID + Client Secret typed
in manually, not Dynamic Client Registration. Set:

```
MCP_OAUTH_CLIENT_ID=claude-ai
MCP_OAUTH_CLIENT_SECRET=<a long random value>
```

and enter those two values into claude.ai's connector setup — its
`authorization_endpoint`/`token_endpoint` come from
`/.well-known/oauth-authorization-server`, discovered automatically from
the MCP server URL (`https://api.cernion.de/api/mcp`).

If unset, the static client is skipped entirely and only dynamically
registered clients (`POST /oauth/register`) are accepted — fine for
clients that do perform DCR, but claude.ai's generic connector flow does
not, per user testing.

`GET /oauth/client-info` returns this same `client_id`/`client_secret`
(200) or a 404 if unset — a page on cernion.de (outside this repo, where
CET tokens are issued at `/cet-token/`) can fetch it to display alongside
the token, rather than that codebase hardcoding a second copy of the env
vars. Publishing the secret this way is intentional, not an oversight: see
"why token-paste, not a new login" above — this client authenticates the
shared connector application, not individual users, and PKCE (mandatory
regardless of whether a client has a secret) is what actually binds a
specific `/oauth/authorize` flow to its `/oauth/token` exchange.

## Known v1 limitations

- **In-memory only** (`src/oauth-store.js`): authorization codes and
  dynamically-registered clients don't survive a process restart, and
  don't work across multiple horizontally-scaled instances without a
  shared store. Codes live 5 minutes (RFC 6749 §4.1.2's suggested max is
  10) — a restart mid-flow just means retrying `/oauth/authorize`, the
  underlying CET token is unaffected.
- **No refresh tokens.** The issued `access_token` doesn't expire on our
  side (it's the underlying CET token, whose own lifetime is managed via
  `token-manager`), so there's nothing to refresh — re-running the
  authorize flow gets a client back to the same token.
- **`redirect_uri` isn't allowlisted** — any `https://` (or `http://`
  for local testing) URI is accepted as long as it matches between
  `/oauth/authorize` and `/oauth/token` (standard CSRF/mix-up protection),
  but there's no server-side allowlist restricting *which* URIs a
  registered client may use. Tightening this (e.g. an
  `MCP_OAUTH_ALLOWED_REDIRECT_URIS` allowlist) is a reasonable follow-up
  if this is exposed beyond a small set of known clients.
