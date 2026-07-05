# ChatGPT Sidecar — Session Creation REST API Contract

Issue: [energychain/cernion-energy-tools#388](https://github.com/energychain/cernion-energy-tools/issues/388)
Status: First-card slice, implemented per
[`chatgpt-sidecar-session-ticket-gate.md`](./chatgpt-sidecar-session-ticket-gate.md) and
[`chatgpt-sidecar-oeo-trust-boundary.md`](./chatgpt-sidecar-oeo-trust-boundary.md).

This document is the authoritative contract for **creating** a ChatGPT
Sidecar session. It covers only `POST /api/chatgpt-sidecar/sessions` (and its
counterpart `DELETE /api/chatgpt-sidecar/sessions/:sessionId`) — the
session-scoped facade (`manifest`, `ask`, `plan`, `datapoints`, `metering`) is
described in the action-level OpenAPI annotations in
`services/chatgpt-sidecar.service.js` and in the issue body.

## Who may call this endpoint

`POST /api/chatgpt-sidecar/sessions` is called by an **authenticated Cernion
user or service**, never directly by ChatGPT. The generated `ticketUrl` is
what gets embedded in the prompt pasted into ChatGPT — the creation call
itself never happens from within a ChatGPT conversation.

Three checks gate this endpoint, all enforced both at the gateway (RBAC) and
inside the service handler (defense in depth):

1. **Authenticated tenant context required.** A request with no resolvable
   tenant (no valid session token, no valid API token) is rejected with
   `401 AUTH_REQUIRED`.
2. **Token scope must not be `read-only`.** A bare `CERNION_READONLY_TOKEN` —
   or any token/session with `read-only` scope — is rejected with
   `403 CHATGPT_SIDECAR_CREATE_FORBIDDEN`, even if a tenant is resolved.
3. **Explicit `chatgpt-sidecar-creator` role required.** This role is **not**
   implied by `full-access` (unlike the existing `hitl-approver` transition
   role) — an operator must grant it deliberately, either as a custom scope
   string on an API token (`token-manager` `scopes` array) or via an IdP
   group→role mapping (`mapRolesFromClaims`). A `full-access` token without
   this role still gets `403 CHATGPT_SIDECAR_CREATE_FORBIDDEN`.

This mirrors the owner's implementation-contract answer on #388: "do not
allow anonymous creation and do not treat `CERNION_READONLY_TOKEN` by itself
as authority to mint user sessions... add/enforce an explicit create
permission or feature gate."

## Request

```http
POST /api/chatgpt-sidecar/sessions
Authorization: Bearer <session-token-or-ck_-token-with-chatgpt-sidecar-creator-role>
Content-Type: application/json

{
  "ttl": "1h",
  "capabilityProfile": ["knowledge-rag", "datasource-mastr", "ontology-guardrail"],
  "writeScope": "draft_write",
  "origin": "chatgpt_prompt_generator",
  "metadata": { "useCase": "zielnetzplanung" },
  "baseUrl": "https://cernion.example.com"
}
```

All fields are optional except that an invalid `ttl` is rejected explicitly
(see below). Tenant and user context are **never** taken from the request
body — they come only from the authenticated caller's session/token.

| Field               | Type     | Default                    | Notes |
|---------------------|----------|-----------------------------|-------|
| `ttl`                | string   | `"1h"`                      | Must be one of the enumerated values below. |
| `capabilityProfile`  | string[] | `["knowledge-rag"]`         | Filtered against the fixed allowlist; unknown values are silently dropped. If the filtered result is empty, falls back to the default. |
| `writeScope`         | string   | `"draft_write"`             | Must be one of the enumerated write classes below. |
| `origin`             | string   | `"chatgpt_prompt_generator"` | Free-text provenance tag, stored server-side. |
| `metadata`           | object   | `{}`                        | Free-form use-case metadata (e.g. `{ "useCase": "zielnetzplanung" }`), stored server-side only — never echoed to the ticket caller. |
| `baseUrl`            | string   | none (relative path)        | Absolute origin used to build `ticketUrl`, e.g. `https://cernion.example.com`. Same pattern as `agent-sidecar.descriptor`'s `baseUrl` parameter. |

### TTL enumeration (server-enforced, first slice)

| Value | Duration | Notes |
|-------|----------|-------|
| `1h`  | 1 hour   | Default. |
| `4h`  | 4 hours  | |
| `1d`  | 24 hours | Hard maximum for this slice. Longer-lived/paid-tier TTLs are a later product decision. |

Any other value is rejected with `400 CHATGPT_SIDECAR_INVALID_TTL` and the
response includes the allowed set.

### Capability family enumeration (fixed allowlist, first slice)

```text
knowledge-rag
blueprint-plan
datasource-mastr
datasource-vnb-digital
datasource-entsoe
datasource-gas-storage
datasource-grid-osm
redispatch-evidence
edm-mako-evidence
ontology-guardrail
draft-datapoints
```

These are **logical session capability names**, not raw endpoints or provider
identifiers — the manifest returned by `GET /s/:ticket/manifest` exposes only
this allowlist filtered to what the session was granted.

### Write scope enumeration

```text
draft_write            (mutates: the only write class that actually creates
                         a draft datapoint in this slice)
controlled_write        (policy decision only — never mutates)
process_execute         (policy decision only — never mutates)
requires_confirmation   (policy decision only — never mutates)
```

## Response

```json
{
  "success": true,
  "sessionId": "cgs_9e33a964-cff7-4cf9-a788-a0823df85edf",
  "ticketUrl": "https://cernion.example.com/api/chatgpt-sidecar/s/<opaque-ticket>/manifest",
  "expiresAt": "2026-07-05T15:33:04.483Z",
  "promptText": "You are working inside a Cernion Fach-Sidecar session...",
  "capabilities": ["knowledge-rag", "datasource-mastr", "ontology-guardrail"],
  "writeScope": "draft_write"
}
```

`sessionId` is returned **only to the authenticated creator**, for later
`DELETE /api/chatgpt-sidecar/sessions/:sessionId` revocation. It is never
sent to ChatGPT and never appears inside `promptText`, the ticket URL, the
manifest, or metering responses. The opaque ticket embedded in `ticketUrl`
carries no encoded tenant/user data — it is a 256-bit random value used only
as a server-side lookup key.

### Error responses

| Status | Code | Cause |
|--------|------|-------|
| 401 | `AUTH_REQUIRED` | No authenticated tenant context. |
| 403 | `CHATGPT_SIDECAR_CREATE_FORBIDDEN` | Read-only token/session, or missing `chatgpt-sidecar-creator` role. |
| 400 | `CHATGPT_SIDECAR_INVALID_TTL` | `ttl` not in the enumerated set. |

## Revocation

```http
DELETE /api/chatgpt-sidecar/sessions/:sessionId
Authorization: Bearer <same tenant, chatgpt-sidecar-creator role>
```

Requires the same three checks as creation, plus the caller's tenant must
match the session's tenant (cross-tenant revocation attempts return
`404 CHATGPT_SIDECAR_SESSION_NOT_FOUND`, not a tenant-mismatch error — this
avoids confirming that a session id belongs to another tenant). This route is
for the authenticated Cernion app/API owner only; ticket callers only ever
observe the resulting revoked state (as a hard `404` on their next call),
never the revocation action itself.

## What ChatGPT actually sees

ChatGPT (or a Custom GPT) never calls `/sessions`. It is given `promptText`
and starts from the `ticketUrl` (`GET /s/:ticket/manifest`). Every
`/s/:ticket/*` route resolves the ticket against the server-side session
store and requires **no Cernion authentication of its own** — the ticket is
the credential. See `services/chatgpt-sidecar.service.js` for the full
facade contract (`manifest`, `ask`, `plan`, `datapoints`, `metering`).
