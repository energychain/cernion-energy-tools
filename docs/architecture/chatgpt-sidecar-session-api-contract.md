# ChatGPT Sidecar — Session Creation REST API Contract

Issues: [energychain/cernion-energy-tools#388](https://github.com/energychain/cernion-energy-tools/issues/388)
(first slice), [#390](https://github.com/energychain/cernion-energy-tools/issues/390)
(full-scope capability expansion).
Status: implemented per
[`chatgpt-sidecar-session-ticket-gate.md`](./chatgpt-sidecar-session-ticket-gate.md) and
[`chatgpt-sidecar-oeo-trust-boundary.md`](./chatgpt-sidecar-oeo-trust-boundary.md).

#390's product-cut questions (capability profile source of truth, full-scope
definition, write-scope boundary) were resolved directly with the repo owner
rather than via an async GitHub round-trip:
- **Source of truth:** no per-tenant/user capability-entitlement store exists
  in this codebase, so "full scope" means every `capability-catalog.js` entry
  that resolves to a canonical taxonomy domain — not a tenant-differentiated
  grant. The session creator still explicitly requests capabilities at
  creation time (same trust model as #388), just from a much larger,
  server-curated menu instead of a fixed 11-item list.
- **Write scope:** write-classified capabilities also expand to the full
  catalog, but `draft_write` remains the only class that mutates — expanding
  the id space only changes which labels a `controlled_write` /
  `process_execute` / `requires_confirmation` request may carry, not what
  those requests are allowed to do.

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

### Capability family enumeration

The 11 fixed core handles from the #388 first slice remain valid session-level
toggles:

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

**#390 full-scope expansion:** `capabilityProfile` also accepts any capability
id from `src/capability-catalog.js` (`CURATED_CAPABILITIES[].capability`) whose
domain resolves to a canonical `llm-manifest-taxonomy` domain — currently all
157 catalog entries qualify. A catalog capability whose domain does **not**
resolve is excluded fail-closed (never silently granted), per
`src/chatgpt-sidecar-session-policy.js`'s `FULL_CAPABILITY_CATALOG` builder.

To request every available capability without enumerating ~168 ids by hand,
pass the wildcard as the sole entry:

```json
{ "capabilityProfile": ["*"] }
```

This resolves server-side to the fixed core handles plus the full catalog —
nothing more, and only at session-creation time (ChatGPT itself never sees or
can request this parameter). Mixing `"*"` with other ids does **not** trigger
the wildcard; it is only recognized as the sole array entry.

These are **logical session capability names**, not raw endpoints or provider
identifiers — the manifest returned by `GET /s/:ticket/manifest` exposes only
the granted subset, grouped by canonical taxonomy domain under
`capabilityDomains` (e.g. `grid-ops`, `redispatch`, `market-data`) alongside
the existing flat `capabilityProfile` list.

Granting a capability id only changes which label an `ask`/`plan`/`datapoints`
call may carry — it does not add a new invocation pathway. Those three routes
always call the same fixed, already-safe primitives regardless of which
capability id was requested, so widening this id space does not loosen tenant,
policy or write-scope authority.

### Write scope enumeration

```text
draft_write            (mutates: the only write class that actually creates
                         a draft datapoint in this slice)
controlled_write        (policy decision only — never mutates)
process_execute         (policy decision only — never mutates)
requires_confirmation   (policy decision only — never mutates)
```

This is unchanged by the #390 capability expansion: any granted capability id
— fixed handle or full-catalog id — can be attached to a `controlled_write` /
`process_execute` / `requires_confirmation` request and receive a policy
decision, but `draft_write` remains the only class that actually mutates.

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
