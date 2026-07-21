# Cernion Open WebUI Integration

This directory contains two independent, dependency-light OpenAPI tool servers and a local smoke
harness for the first one. Each server exposes exactly one Open WebUI-importable operation and
uses its own env-only credential:

> **Deployment and safety:** before running this beyond a disposable local demo, read
> [`RUNBOOK.md`](./RUNBOOK.md) — it covers the local-only vs. shared/team profile, RBAC,
> user/global tool-server registration, session/credential lifecycle, and the smoke checklist.

- `cernion-openapi-tool-server.js` — read-only Evidence Lookup (delegates to the Agent Sidecar).
- `cernion-process-intake-tool-server.js` — **draft-only** Process Intake preview (delegates to
  the existing Process Intake action). **This is not a production write path.**

## Read-only Evidence tool server

Start the adapter:

```bash
CERNION_AGENT_SIDECAR_BASE_URL=http://127.0.0.1:3900 \
CERNION_READONLY_TOKEN='<read-only token>' \
node integrations/open-webui/cernion-openapi-tool-server.js
```

It listens on `127.0.0.1:3910` by default. Optional configuration:

- `CERNION_OPEN_WEBUI_HOST`
- `CERNION_OPEN_WEBUI_PORT`
- `CERNION_OPEN_WEBUI_TIMEOUT_MS` (bounded to 1–60 seconds)

Import `http://127.0.0.1:3910/openapi.json` in Open WebUI. The adapter exposes:

- `GET /health` — reports only configured/missing state; never returns the token
- `GET /openapi.json` — OpenAPI 3.x document with exactly one tool operation
- `POST /tools/cernion-evidence-lookup` — accepts `question` and optional `tenantId`,
  `sessionId`, `domain`, and bounded `context` hints

Every valid tool request is sent only to:

```text
POST <CERNION_AGENT_SIDECAR_BASE_URL>/api/agent-sidecar/tools/cernion.answer_dossier/call
```

The credential is read from the environment and is never accepted in the request body. Cernion
remains authoritative for tenant, role, scope, capability routing, evidence hydration, and policy.
The adapter does not execute returned plans, select domain endpoints, access a database, use a
process-intake/write path, or call Personal Agent actions directly. Responses preserve structured
Answer Dossier content plus answer, evidence, confidence, trace IDs, positive follow-ups,
guardrails and `notCalled` metadata where present, always with `readOnly: true` and
`sideEffects: "none"`.

## Draft-only Process Intake tool server

> **This is not a production write path.** The server only ever creates a bounded
> `pending_confirmation` intake receipt via Cernion's existing, authoritative Process Intake
> action. It never executes, approves, auto-confirms, signs, deletes, sends, publishes,
> dispatches, settles, bills, mutates tariffs, controls devices, emits webhooks, or invokes
> external connectors — and it has no code path to any such endpoint. A human must review and act
> on the pending intent via the direct Cernion API; this tool and Open WebUI never make that
> decision.

Start the adapter:

```bash
CERNION_BASE_URL=http://127.0.0.1:3900 \
CERNION_PROCESS_TOKEN='<process intake token>' \
node integrations/open-webui/cernion-process-intake-tool-server.js
```

It listens on `127.0.0.1:3911` by default — a separate port and a separate, env-only credential
from the Evidence Lookup server above. Optional configuration:

- `CERNION_PROCESS_INTAKE_HOST`
- `CERNION_PROCESS_INTAKE_PORT`
- `CERNION_PROCESS_INTAKE_TIMEOUT_MS` (bounded to 1–60 seconds)

Import `http://127.0.0.1:3911/openapi.json` in Open WebUI. The adapter exposes:

- `GET /health` — reports only configured/missing state; never returns the token
- `GET /openapi.json` — OpenAPI 3.x document with exactly one tool operation
- `POST /tools/cernion-process-intake-draft` — accepts `operationFamily`, `proposedAction`, and
  optional `targetType`, `targetId`, `inputSummary`, bounded `payload`, `risk`, `reason`,
  `correlationId`, `decisionFrameId`

Every valid tool request is sent only to:

```text
POST <CERNION_BASE_URL>/api/copilot-process/intents
```

The credential is read from the environment and is never accepted in the request body or
returned in any response. Before making any upstream call, the adapter fails closed and rejects
(403, zero upstream calls) any request whose text asks to execute, approve, auto-confirm, sign,
delete, send, publish, dispatch, settle, bill, mutate a tariff, control a device, emit a webhook,
or invoke an external connector — and it separately rejects (400, zero upstream calls) any
request carrying credential-like keys (`token`, `password`, `credential`, `secret`,
`authorization`, `bearer`).

On success the response always includes `draftOnly: true`, `hitlRequired: true`, and
`policyStatus: "pending_human_confirmation"`, plus `acceptedIntent`, a scrubbed `receipt`
(`intentId`, `status`, `expiresAt`), `allowedNextActions` (human review / status inspection only),
`forbiddenActions`, `notCalled`, an informational-only `executeVia` note (not a callable
operation), and a bounded `auditContext`. Cernion remains authoritative for tenant, role, scope,
and HITL/policy decisions — this adapter and Open WebUI never decide policy themselves.

## Local smoke test

Run the self-contained smoke test with safe in-process mocks:

```bash
node integrations/open-webui/smoke-test.js
```

Expected output includes:

```text
[open-webui-smoke] bridge health, models, and chat completion shape passed
[open-webui-smoke] toolserver health, OpenAPI, and read-only tool shape passed
```

The mock path validates the bridge health/models/chat shape and the tool server health, OpenAPI,
and `POST /tools/cernion-evidence-lookup` response shape without secrets or consequential calls.

To smoke locally started services instead:

```bash
OPEN_WEBUI_SMOKE_USE_MOCKS=0 \
OPEN_WEBUI_BRIDGE_BASE_URL=http://127.0.0.1:3900 \
OPEN_WEBUI_TOOLSERVER_BASE_URL=http://127.0.0.1:3910 \
node integrations/open-webui/smoke-test.js
```

Optional smoke overrides:

- `OPEN_WEBUI_SMOKE_MODEL`
- `OPEN_WEBUI_SMOKE_CHAT_BODY`
- `OPEN_WEBUI_TOOL_REQUEST_PATH` (default `/tools/cernion-evidence-lookup`)
- `OPEN_WEBUI_TOOL_REQUEST_METHOD` (default `POST`)
- `OPEN_WEBUI_TOOL_REQUEST_BODY`

## Verification

```bash
node --check integrations/open-webui/cernion-openapi-tool-server.js
node --check integrations/open-webui/cernion-process-intake-tool-server.js
node --test integrations/open-webui/cernion-process-intake-tool-server.test.js integrations/open-webui/cernion-openapi-tool-server.test.js integrations/open-webui/smoke-test.test.js
node integrations/open-webui/smoke-test.js
```

The Evidence Lookup adapter and smoke harness must remain read-only. The Process Intake adapter
must remain draft-only. Neither may call MaKo, CRM, billing, settlement, tariff mutation, device
control, HITL resolution, deployment, external messaging, webhooks, signatures, automatic
approval, tenant mutations, or direct database paths. The Process Intake adapter's only permitted
upstream call is `POST <CERNION_BASE_URL>/api/copilot-process/intents`, and it never decides
policy itself — only Cernion and a human reviewer do.
