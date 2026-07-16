# Cernion Open WebUI Integration

This directory contains a dependency-light OpenAPI tool server and its local smoke harness. The
server exposes one Open WebUI-importable, read-only Evidence Lookup operation and delegates only
to Cernion's existing Agent Sidecar policy gate.

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
node --test integrations/open-webui/cernion-openapi-tool-server.test.js integrations/open-webui/smoke-test.test.js
node integrations/open-webui/smoke-test.js
```

The adapter and harness must remain read-only. They must not call MaKo, billing, settlement,
tariff, device control, HITL resolution, deployment, external messaging, webhooks, tenant
mutations, process intake, or direct database paths.
