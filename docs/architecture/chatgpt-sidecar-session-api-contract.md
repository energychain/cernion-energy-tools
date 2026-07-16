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
  "actionOpenApiUrl": "https://cernion.example.com/api/chatgpt-sidecar/s/<opaque-ticket>/action-openapi.json",
  "initialAskUrl": "https://cernion.example.com/api/chatgpt-sidecar/s/<opaque-ticket>/ask?query=<encoded-initial-task>",
  "expiresAt": "2026-07-05T15:33:04.483Z",
  "promptText": "You are working inside a Cernion Fach-Sidecar session...",
  "actionSetup": {
    "recommended": true,
    "mode": "custom_gpt_action",
    "schemaUrl": "https://cernion.example.com/api/chatgpt-sidecar/s/<opaque-ticket>/action-openapi.json",
    "authentication": { "type": "none_ticket_scoped" }
  },
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

When the creator sends a prompt-generator task in `metadata.useCase`
(`metadata.initialQuestion`, `metadata.question`, `metadata.query` and
`metadata.task` are also accepted), the response also includes
`initialAskUrl`. The generated `promptText` repeats this exact URL so
ChatGPT.com can follow a browser-discovered link instead of constructing a
new query URL from the manifest template. This is a prompt-only Safe Browsing
compatibility measure; it does not expose tenant/user identity, session id,
POST routes, write endpoints or provider credentials.

### Ask/plan response contract

`ask`, `browserAsk`, `plan` and `browserPlan` preserve their existing payload
fields and add a stable prompt-only response envelope:

```json
{
  "success": true,
  "shortAnswer": "Cernion evidence answer",
  "answer": "Cernion evidence answer",
  "turnId": "cgs_turn_<uuid>",
  "resolvedQuestion": "Welche Daten liegen vor?",
  "followUpContext": {
    "turnId": "cgs_turn_<uuid>",
    "parentTurnId": "cgs_turn_<previous-uuid-or-null>",
    "resolvedQuestion": "Welche Daten liegen vor?",
    "capability": "knowledge-rag",
    "transport": "browser_get",
    "confidence": "high",
    "promptOnly": {
      "statefulContextAvailable": true,
      "requiresConcreteNextCall": true
    }
  },
  "responseContract": {
    "schemaVersion": "cernion.chatgpt-sidecar.response.v1",
    "turnIdField": "turnId",
    "resolvedQuestionField": "resolvedQuestion",
    "followUpContextField": "followUpContext"
  }
}
```

The server records each turn under the opaque session ticket so later calls
can pass `parentTurnId` and preserve conversational context. This improves
grounding and follow-up interpretation for prompt-only usage, but it does
not remove the transport boundary: a new free-form ChatGPT user question
still has to reach Cernion through a concrete browser URL, a Custom GPT
Action or an MCP/App tool call.

### Explicit capability grounding

The optional `capability` parameter is a hard grounding boundary for
`ask`/`browserAsk`, not just a ranking hint. If ChatGPT calls:

```http
GET /api/chatgpt-sidecar/s/<ticket>/ask?query=...&capability=datasource-mastr
```

the Sidecar may still ask downstream Cernion services to retrieve evidence,
but the final response must not silently reinterpret generic Knowledge-RAG
hits as evidence for that capability. If the downstream result only contains
generic fallback evidence while capability-specific datapoints/objects are
missing, the Sidecar returns a successful no-evidence answer with:

```json
{
  "confidence": "low",
  "evidence": [],
  "capabilityGrounding": {
    "requestedCapability": "datasource-mastr",
    "mode": "hard",
    "status": "missing",
    "reason": "no_capability_evidence",
    "genericFallbackSuppressed": true
  },
  "processContext": [
    "datapoints:missing",
    "objects:missing",
    "capability_evidence:missing",
    "generic_fallback:suppressed"
  ]
}
```

`knowledge-rag` remains the explicit capability for Knowledge-RAG answers.
For other capabilities, a fallback to generic Knowledge-RAG is only suitable
when no capability was pinned or a future API version explicitly requests
such fallback behavior.

### OpenAPI semantic fallback router

When a non-`knowledge-rag` capability is explicitly pinned but no dedicated
Sidecar resolver exists, the Sidecar may use a controlled read-only OpenAPI
fallback before returning `no_capability_evidence`.

The fallback builds an operation index from broker actions with REST/OpenAPI
metadata and selects only safe operations:

- `GET` operations are eligible unless their operation text contains an
  unsafe verb such as create, update, delete, execute, confirm or token.
- `POST` operations are eligible only for explicitly read-only data services
  such as `gas-storage`, `energy-market`, `entsoe`, `oep`, `osm-geo` and
  related datasource services.
- The router scores the user question plus requested capability against
  operation id, path, tags, summary, description and parameter metadata.
- Required parameters are resolved deterministically from `inputs`, `context`
  and common domain cues, for example `Deutschland` -> `country: "DE"`.

Responses produced by this route are deliberately marked as fallback evidence,
not as a dedicated capability route:

```json
{
  "confidence": "medium",
  "capabilityGrounding": {
    "requestedCapability": "datasource-gas-storage",
    "mode": "hard",
    "status": "fallback",
    "reason": "openapi_semantic_router",
    "fallbackSource": "openapi_semantic_router",
    "notDedicatedCapabilityRoute": true,
    "resolvedOperationId": "gas-storage_countryStorage",
    "resolvedPath": "/api/gas-storage/country-storage",
    "method": "POST"
  },
  "processContext": [
    "capability:datasource-gas-storage",
    "capability_evidence:fallback",
    "fallback:openapi_semantic_router",
    "not_dedicated_capability_route:true"
  ]
}
```

This keeps ChatGPT usable for newly exposed datasource endpoints without
relabeling generic RAG as source-specific evidence. Recurring high-value
fallback routes should still become dedicated capability resolvers.

### Python/Data Analysis fallback

Some ChatGPT sessions can construct and fetch dynamic URLs through the
Python/Data Analysis runtime even when browser navigation blocks the same
derived API URL. The manifest therefore exposes a read-only `pythonClient`
hint under `browserFacade`:

```json
{
  "pythonClient": {
    "usage": "python_read_only_http_client_when_browser_navigation_blocks_dynamic_get_urls",
    "askBaseUrl": "https://cernion.example.com/api/chatgpt-sidecar/s/<opaque-ticket>/ask",
    "planBaseUrl": "https://cernion.example.com/api/chatgpt-sidecar/s/<opaque-ticket>/plan",
    "queryEncoding": "Use urllib.parse.urlencode for query/task plus optional capability and parentTurnId.",
    "responseFields": {
      "answer": "Use answer first, then shortAnswer, then groundingAnswer.",
      "turnId": "Persist for the next follow-up call.",
      "followUpContext": "Use for conversational continuity; pass followUpContext.turnId as parentTurnId on the next Cernion call."
    }
  }
}
```

This remains a prompt-only fallback, not a guaranteed tool channel:
availability depends on the ChatGPT environment having Python/Data Analysis
and outbound HTTPS enabled. The fallback is strictly read-only and uses the
same ticket-scoped `ask`/`plan` GET facades as browser usage.

### Custom GPT Action setup

The preferred ChatGPT integration is a **Custom GPT Action**, with Prompt-only
kept as a fallback. A user cannot install an Action by pasting instructions
into a normal ChatGPT chat; they must create or edit a GPT and configure an
Action in the GPT Builder. Cernion therefore returns `actionSetup` and
`actionOpenApiUrl` next to the prompt data so the Solution page can show the
Action path first and the Prompt-only fallback below it.

The session-scoped schema is available at:

```http
GET /api/chatgpt-sidecar/s/<opaque-ticket>/action-openapi.json
```

It is intentionally small and embeds the opaque ticket directly into the
operation paths. This lets ChatGPT Actions call Cernion with structured JSON
for free-form follow-ups without asking the model to construct ticket URLs or
without relying on Python/Data Analysis network availability.

First-cut operations:

| Operation | Method/path | Purpose |
|-----------|-------------|---------|
| `askCernion` | `POST /api/chatgpt-sidecar/s/<ticket>/ask` | Free-form Cernion question with optional `capability`, `parentTurnId`, `context` and `inputs`. |
| `planCernion` | `POST /api/chatgpt-sidecar/s/<ticket>/plan` | Read-only planning/routing request with optional `capability`, `parentTurnId` and `context`. |

The schema sets `x-openai-isConsequential: false` on both operations and does
not include `datapoints`, `execute`, HITL, external connector or production
mutation routes. Draft datapoint writes remain available only through the
existing ticket endpoint and policy gate, not through the first Custom GPT
Action schema.

GPT Builder instructions shown by `actionSetup.steps`:

1. Open ChatGPT and create or edit a Custom GPT.
2. Go to `Configure -> Actions -> Create new action`.
3. Import the schema from `actionSetup.schemaUrl`.
4. Set Authentication to `None`.
5. Save the GPT and test `askCernion` with a short Cernion question.
6. Use the Prompt-only section only when a Custom GPT Action cannot be
   configured.

`Authentication = None` is deliberate for this slice: the opaque Sidecar
ticket is already embedded in the imported schema paths and expires with the
session TTL. This has the same shareability risk as Prompt-only ticket URLs,
but avoids asking non-technical users to configure an additional custom
header or bearer secret for the Action.

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
the credential. For prompt-only browser sessions the manifest also includes
absolute browser URL templates and, when present, the concrete `initialAskUrl`
for the first task. See `services/chatgpt-sidecar.service.js` for the full
facade contract (`manifest`, `ask`, `plan`, `datapoints`, `metering`).
