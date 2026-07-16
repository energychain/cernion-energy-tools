# Cernion Open WebUI Integration

This directory contains local verification helpers for the Open WebUI path. The smoke harness
checks the Cernion chat-provider bridge and the OpenAPI toolserver contract without requiring
secrets, expiring Sidecar sessions, real process mutations, webhooks or tenant data.

## Local Smoke Test

Run the self-contained smoke test with safe in-process mocks:

```bash
node integrations/open-webui/smoke-test.js
```

Expected output:

```text
[open-webui-smoke] bridge health, models, and chat completion shape passed
[open-webui-smoke] toolserver health, OpenAPI, and read-only tool shape passed
```

The default mock path validates:

- bridge `GET /health`
- bridge `GET /v1/models`
- bridge `POST /v1/chat/completions` OpenAI-compatible response shape
- toolserver `GET /health`
- toolserver `GET /openapi.json`
- one read-only tool request at `POST /tools/read-only-status`

To run the same checks against locally started services, pass explicit base URLs and disable mocks:

```bash
OPEN_WEBUI_SMOKE_USE_MOCKS=0 \
OPEN_WEBUI_BRIDGE_BASE_URL=http://127.0.0.1:3900 \
OPEN_WEBUI_TOOLSERVER_BASE_URL=http://127.0.0.1:3910 \
node integrations/open-webui/smoke-test.js
```

Optional overrides:

- `OPEN_WEBUI_SMOKE_MODEL`: model id sent to `/v1/chat/completions`
- `OPEN_WEBUI_SMOKE_CHAT_BODY`: full JSON chat completion request body
- `OPEN_WEBUI_TOOL_REQUEST_PATH`: read-only tool path, default `/tools/read-only-status`
- `OPEN_WEBUI_TOOL_REQUEST_METHOD`: read-only tool method, default `POST`
- `OPEN_WEBUI_TOOL_REQUEST_BODY`: full JSON read-only tool request body

Failure messages include the broken layer name, such as `bridge-health`,
`bridge-models-shape`, `bridge-chat-shape`, `toolserver-health`, `toolserver-openapi`,
`toolserver-read-only-tool-shape`, `backend reachability`, or `smoke-config`.

## Verification

Focused checks:

```bash
node --test integrations/open-webui/*.test.js
node integrations/open-webui/smoke-test.js
```

The harness is intentionally read-only. It must not call MaKo, billing, settlement, tariff,
device-control, HITL, production deployment, external messaging, webhooks or mutating tenant
operations.
