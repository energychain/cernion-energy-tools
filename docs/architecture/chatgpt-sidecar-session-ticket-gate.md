# ChatGPT Sidecar Session Ticket Gate

Issue #388 is security-sensitive and should start as a narrow product and
architecture gate, not as a broad endpoint implementation. The goal is a
ChatGPT-facing session facade that lets a user paste a generated prompt into
ChatGPT while Cernion remains the tenant, policy, capability, Knowledge RAG,
Blueprint, datasource and execution owner.

## Product Cut

First slice:

- Create a server-side session-ticket model and policy contract for a
  read-only/draft-only facade.
- Generate opaque, revocable ticket URLs that resolve only to session-scoped
  logical capabilities.
- Expose `manifest`, `ask`, `plan`, `datapoints` draft creation and `metering`
  as the initial contract.
- Keep `execute` and any controlled/process write behind explicit policy stubs
  that return blocked or requires-confirmation decisions.
- Route datasource-backed work through existing capabilities and Blueprints,
  never through raw provider endpoints.
- Surface OEO/energy-domain ontology support as a capability family when
  enabled for the session.

The OEO-specific semantic trust boundary is tracked separately in
[`chatgpt-sidecar-oeo-trust-boundary.md`](./chatgpt-sidecar-oeo-trust-boundary.md).

Out of the first slice:

- No broad ChatGPT access to the full OpenAPI.
- No unrestricted write proxy.
- No raw provider credentials, bearer tokens, tenant IDs or user IDs in prompt
  text, ticket URLs, manifests, logs or metering payloads.
- No external ChatGPT OAuth flow.
- No production mutation or HITL resolution.

## Trust Boundaries

```text
Authenticated Cernion user
  -> POST /api/chatgpt-sidecar/sessions
    -> server-side session store
      -> opaque ticket URL + generated prompt text

ChatGPT / Custom GPT
  -> /api/chatgpt-sidecar/s/:ticket/*
    -> ticket resolution, expiry and revocation gate
      -> session capability allowlist
        -> Cernion policy/governance gate
          -> Capability Broker / Blueprint / Knowledge RAG / datasource service
```

Only the opaque ticket crosses into ChatGPT. Tenant, user, session metadata,
provider credentials and raw internal endpoint topology stay server-side.

## Threat Model

Primary risks:

- Ticket leakage from prompt text, browser history, chat transcript or logs.
- Prompt injection asking ChatGPT to invent capabilities or call raw endpoints.
- Tenant/user confusion if the prompt carries identifiers instead of an opaque
  server-side ticket.
- Replay after expiry or after administrative revocation.
- Write escalation from draft datapoint creation to controlled/process writes.
- Credential leakage from datasource-backed capabilities such as MaStR, VNB
  Digital, ENTSO-E, gas, Grid/OSM, Redispatch, EDM/MaKo, Knowledge RAG or OEO.
- Metering payloads leaking provider internals or raw identity.
- OpenAPI drift exposing the session facade as a generic proxy.

Required controls:

- Ticket values must be high-entropy opaque identifiers, not signed payloads that
  encode tenant/user data for ChatGPT to inspect.
- Session state must store `tenantContext`, `userContext`, `sessionId`,
  `expiresAt`, `revokedAt`, `capabilityProfile`, `writeScope`, limits,
  datasource family policy, origin and metadata server-side.
- Expired tickets return HTTP `410 Gone` with a regenerate-session instruction.
- Unknown or revoked tickets return hard failures without revealing whether a
  tenant/user exists.
- Manifest is an allowlist. It lists logical capabilities, write scope and
  evidence families, not raw endpoint paths or provider secrets.
- `plan` may recommend only Blueprint/Capability Broker routes that the session
  allowlist permits.
- `execute` is blocked in the first slice except for explicit read execution or
  policy-decided dry-run/draft operations.
- `datapoints` may create only draft datapoints with provenance bound to
  server-side tenant/user/session context.
- Metering stores event detail internally but returns a redacted summary through
  the ticket endpoint.

## Module Map

Existing components to reuse:

- `services/agent-sidecar.service.js`: current sidecar service and policy-gated
  invocation pattern.
- `src/agent-sidecar-tool-manifest.js`: compact manifest shape and safety
  metadata conventions.
- `src/agent-sidecar-policy.js`: tenant, scope and forbidden target checks.
- `services/capability-broker.service.js` and `src/capability-catalog.js`:
  curated capability routing and datasource-family intent mapping.
- `src/blueprint-rest-plan-compiler.js`: read-only Blueprint-to-REST plan
  compiler that avoids direct execution.
- `services/personal-agent.service.js`: `askCernionAgent` and `answerDossier`
  fallback/evidence flows.
- `services/datapoint.service.js`: metadata-only datapoint creation and
  provenance hash pattern.
- `src/governance-policy-evaluator.js` and blueprint policy tests:
  write-class decisions and blocked/requires-confirmation semantics.
- `src/oeo-mappings.js` and OEO tests: energy-domain ontology guardrail source.
- `tests/agent-sidecar.service.test.js`: policy-gated sidecar test style.
- `tests/datasource-metering.integration.test.js`: datasource family metering
  expectations.

New components should stay small:

- `src/chatgpt-sidecar-session-store.js`: interface plus default file-backed
  runtime store and in-memory test store for create/get/revoke/expire/meter
  events. Non-test runtimes persist tickets, metering and turn summaries under
  `data/chatgpt-sidecar-sessions/sessions.json` unless
  `CHATGPT_SIDECAR_SESSION_STORE=memory` is explicitly set.
- `src/chatgpt-sidecar-session-policy.js`: ticket, capability, write-scope and
  redaction decisions.
- `src/chatgpt-sidecar-prompt.js`: backend-generated prompt text from redacted
  session view.
- `services/chatgpt-sidecar.service.js`: HTTP facade only; delegates policy,
  routing and metering.

## First Implementation Card

Title: Read-only/draft-only ChatGPT Sidecar session facade.

Scope:

- `POST /api/chatgpt-sidecar/sessions`
- `GET /api/chatgpt-sidecar/s/:ticket/manifest`
- `POST /api/chatgpt-sidecar/s/:ticket/ask`
- `GET /api/chatgpt-sidecar/s/:ticket/ask?query=...`
- `POST /api/chatgpt-sidecar/s/:ticket/plan`
- `GET /api/chatgpt-sidecar/s/:ticket/plan?task=...`
- `POST /api/chatgpt-sidecar/s/:ticket/datapoints`
- `GET /api/chatgpt-sidecar/s/:ticket/metering`

Constraints:

- TTL choices are bounded server-side, with `expiresAt` stored in the session.
- Prompt text includes only the manifest URL, capability contract and expiry
  behavior.
- `ask` and `plan` reuse existing sidecar/personal-agent/capability broker paths.
- Browser `GET` ask/plan routes are read-only prompt-only facades over the
  same policy gates. They accept bounded URL query text, return policy-blocked
  responses with positive follow-ups, and must not expose POST write handles as
  browser actions.
- `datapoints` supports only `draft_write`, with provenance:
  `origin=chatgpt_sidecar`, `sessionId`, capability, prompt/user message hash,
  timestamp and policy result.
- Datasource family and OEO usage are metered by family name only.
- `execute`, `controlled_write`, `process_execute` and
  `requires_confirmation` return policy decisions but do not mutate state.

## Evidence Checklist

Focused tests before any smoke:

- TTL expiry returns `410 Gone`.
- Unknown and revoked tickets fail hard without identity leakage.
- Manifest contains only the session capability allowlist.
- Manifest exposes browser `GET` templates, max query length, unavailable
  operations, and prompt-safe follow-ups without leaking credentials.
- Prompt text and manifest do not contain raw tenant ID, user ID, bearer token,
  provider credential, `ck_` token or raw internal endpoint topology.
- Browser `GET` ask/plan reject overlong query text before downstream calls.
- Blocked write attempt increments blocked-policy metering.
- Allowed draft datapoint carries server-side tenant/user/session provenance.
- Metering increments for session creation, manifest read, ask, plan,
  datapoint draft and datasource/OEO family usage.
- Datasource-backed capability planning records family metering without leaking
  provider credentials.
- Policy decisions cover `draft_write`, `controlled_write`, `process_execute`
  and `requires_confirmation`.

Additional evidence when API surface changes:

- Focused Jest tests for the new session store, policy, prompt and service.
- `npm run check:llm` if agent-facing manifests or LLM artifacts change.
- `npm run audit:openapi` or generated OpenAPI checks if routes are exported.
- `git diff --check`.
- Later DevServer smoke on the read-only/draft-only facade only.
