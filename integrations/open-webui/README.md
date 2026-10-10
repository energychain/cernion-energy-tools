# Cernion Open WebUI Integration

This directory contains two independent, dependency-light OpenAPI tool servers and a local smoke
harness for the first one. Each server exposes exactly one Open WebUI-importable operation and
uses its own env-only credential:

> **Deployment and safety:** before running this beyond a disposable local demo, read
> [`RUNBOOK.md`](./RUNBOOK.md) — it covers the local-only vs. shared/team profile, RBAC,
> user/global tool-server registration, session/credential lifecycle, and the smoke checklist.

- `cernion-sidecar-bridge.js` — OpenAI-compatible provider bridge for one configured Cernion
  Sidecar session (`/v1/models`, `/v1/chat/completions`, `/health`).
- `cernion-openapi-tool-server.js` — read-only Evidence Lookup (delegates to the Agent Sidecar).
- `cernion-process-intake-tool-server.js` — **draft-only** Process Intake preview (delegates to
  the existing Process Intake action). **This is not a production write path.**

## RC3 Cernion Workbench / Tenant-Gateway setup

For customer-facing Open WebUI access, prefer the RC3 Workbench path over direct tool wiring. Open
WebUI remains the tenant-branded UI; `/api/workbench/*` maps Open-WebUI org/user/conversation ids to
CET tenant/actor/case state, and `model: "cernion-governance-assistant"` forces the CET
Workbench path through `/v1/chat/completions`. The latest user prompt is classified as
`status_query`, `knowledge_query`, `data_lookup`, `case_start`, `case_followup`,
`decision_support` or `tool_run_request`; the mode is returned as `metadata.intentMode`.
Status and list queries use mapped, read-only Workbench actions without creating cases.
Knowledge questions use the mapped Personal Agent in consultation mode. Case and tool
requests retain the existing Workbench classify/continue and governance checks. Tool
intent alone does not execute a tool. Empty or internal routing-policy responses are
rendered from safe structured fields, with the original output retained in CET metadata.
For status queries, pass `metadata.cetCaseId` or use an already linked conversation.

Provisioning sequence:

1. Create the Open-WebUI organization to CET tenant mapping:

```bash
curl -X POST https://api.cernion.de/api/workbench/admin/tenant-mappings \
  -H "Authorization: Bearer <tenant-admin-or-platform-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "client": "open-webui",
    "externalOrgId": "owui-org-1",
    "cetTenantId": "tenant-1",
    "defaultClientId": "openwebui-tenant-1",
    "enabled": true
  }'
```

2. Create the Open-WebUI user to CET actor/role mapping:

```bash
curl -X POST https://api.cernion.de/api/workbench/admin/user-mappings \
  -H "Authorization: Bearer <tenant-admin-or-platform-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "client": "open-webui",
    "externalOrgId": "owui-org-1",
    "externalUserId": "owui-user-1",
    "cetTenantId": "tenant-1",
    "cetActorId": "user:mako-analyst",
    "roles": ["ROLE_MARKET_COMMUNICATION", "ROLE_EDM"],
    "sensitivityClearance": ["tenant_internal", "restricted"],
    "defaultClientId": "openwebui-tenant-1",
    "enabled": true
  }'
```

3. Register the Workbench MWI delivery client before polling events:

```bash
curl -X POST https://api.cernion.de/api/workbench/delivery-clients \
  -H "Authorization: Bearer <tenant-admin-or-platform-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "openwebui-tenant-1",
    "clientType": "open-webui",
    "deliveryMode": "poll",
    "ackMode": "explicit",
    "eventTypes": ["clarification.required", "evidence.required", "evidence.available", "domain.changed"],
    "enabled": true
  }'
```

4. Configure Open WebUI with the CET OpenAI-compatible endpoint and use
`cernion-governance-assistant`:

```json
{
  "model": "cernion-governance-assistant",
  "messages": [{ "role": "user", "content": "MSCONS fehlt, APERAK Z18 ist vorhanden." }],
  "metadata": {
    "client": "open-webui",
    "openWebuiOrgId": "owui-org-1",
    "openWebuiUserId": "owui-user-1",
    "openWebuiConversationId": "owui-chat-1",
    "clientId": "openwebui-tenant-1"
  }
}
```

5. Poll and acknowledge MWI events through the Workbench wrapper:

```bash
curl "https://api.cernion.de/api/workbench/events?clientId=openwebui-tenant-1&attentionOnly=true" \
  -H "Authorization: Bearer <user-or-service-token>"

curl -X POST https://api.cernion.de/api/workbench/events/<eventId>/ack \
  -H "Authorization: Bearer <user-or-service-token>" \
  -H "Content-Type: application/json" \
  -d '{ "clientId": "openwebui-tenant-1" }'
```

Common fail-closed errors:

- `WORKBENCH_TENANT_MAPPING_REQUIRED`: create `/api/workbench/admin/tenant-mappings` for the Open-WebUI organization.
- `WORKBENCH_MAPPING_REQUIRED`: create `/api/workbench/admin/user-mappings` for the Open-WebUI user.
- `WORKBENCH_DELIVERY_CLIENT_REQUIRED`: register `/api/workbench/delivery-clients` before event polling/ack.
- `WORKBENCH_IDENTITY_INCOMPLETE`: send Open-WebUI user and organization ids together.
- Evidence attach errors for unknown `evidenceType`, `sourceType`, missing sensitivity clearance or secret-like `sourceRef` fields are intentional fail-closed behavior.


## Forecast & Data-Quality Fit self-service preview

For buyer-readable RC3 demos, use [`forecast-data-review-self-service.md`](./forecast-data-review-self-service.md) instead of leading with API documentation. The flow is intentionally file/result oriented:

1. show the synthetic CSV input shape in `examples/forecast-fit/sample-load-profile.csv`;
2. show the synthetic fit matrix in `examples/forecast-fit/sample-fit-matrix.json`;
3. show the report-style output in `examples/forecast-fit/sample-report.md`;
4. only then offer paid review, pilot or advanced API/model access.

The preview is public-safe and must not claim a forecast-quality guarantee, productive operation, SLA, legal/regulatory advice or custom integration.

## OpenAI-compatible Sidecar bridge

The legacy bridge lets an existing Open WebUI instance use a single, explicit Cernion Sidecar
session as an OpenAI-compatible chat provider. For customer-facing RC3 deployments use the
Workbench setup above. Open WebUI remains only the interchangeable frontend; Cernion remains
authoritative for capability routing, policy, evidence, lifecycle and all write-boundary decisions.

Start the bridge after generating or receiving a Sidecar session manifest:

```bash
CERNION_SIDECAR_MANIFEST_URL='https://.../manifest.json' \
CERNION_SIDECAR_ASK_URL='https://.../ask' \
CERNION_SIDECAR_PLAN_URL='https://.../plan' \
CERNION_SIDECAR_EXPIRES_AT='2999-01-01T00:00:00.000Z' \
CERNION_OPEN_WEBUI_MODEL_ID='cernion-dev-sidecar' \
CERNION_SIDECAR_TOKEN='<session token if required>' \
node integrations/open-webui/cernion-sidecar-bridge.js
```

It listens on `127.0.0.1:8087` by default. Configure Open WebUI as an OpenAI-compatible provider
with base URL `http://127.0.0.1:8087/v1` and any placeholder API key. The bridge exposes:

- `GET /health` — reports configured/missing/expired state without returning session secrets
- `GET /v1/models` — returns the configured model id
- `POST /v1/chat/completions` — forwards the last user message to the configured Sidecar `ask` or
  `plan` URL and returns an OpenAI-style chat completion

Session lifecycle and routing rules:

- Missing session config fails closed with HTTP 503.
- Expired sessions fail closed with HTTP 410 and recovery guidance to generate a new Sidecar
  session; the bridge never guesses replacement URLs.
- Latest `turnId` is stored only when Open WebUI supplies a conversation id (`metadata.chat_id`,
  `metadata.conversation_id`, compatible aliases, or headers) and sent as `parentTurnId` only for
  that conversation. Requests without an id do not share fallback state. The in-process store is
  bounded by LRU eviction and TTL expiry (`CERNION_OPEN_WEBUI_TURN_STATE_MAX_ENTRIES`, default
  `1000`; `CERNION_OPEN_WEBUI_TURN_STATE_TTL_MS`, default `1800000`).
- Routing is transport-explicit: `metadata.sidecarMode: "plan"` (or the
  `x-cernion-sidecar-mode: plan` header) selects `plan`; `ask` is the default. Prompt words and
  domain terms never select a transport. Unknown explicit modes fail closed with HTTP 400.
- The `ask` transport sends `{ "question": "..." }`; the `plan` transport sends
  `{ "task": "..." }`, plus `parentTurnId` only when isolated conversation state exists.
- Upstream `410`, `401`, and `403` retain their HTTP semantics with sanitized error bodies; other
  upstream failures are mapped to `502` and timeouts to `504`.

Local disposable demo stack:

```bash
CERNION_SIDECAR_MANIFEST_URL='https://.../manifest.json' \
CERNION_SIDECAR_ASK_URL='https://.../ask' \
CERNION_SIDECAR_PLAN_URL='https://.../plan' \
CERNION_SIDECAR_EXPIRES_AT='2999-01-01T00:00:00.000Z' \
docker compose -f integrations/open-webui/docker-compose.yml up
```

`WEBUI_AUTH=False` in the compose file is for loopback-only local testing. Do not expose that
Open WebUI instance on a shared network or the public internet without authentication and separate
Dev/Production credentials.

The bridge currently returns non-streaming OpenAI chat completions and keeps bounded turn state in
one process. Before a shared or multi-replica deployment, add/verify streaming semantics and use
sticky routing or an external tenant-scoped state store; the TTL/LRU store is local hardening, not
a distributed-session design.

## Read-only Evidence tool server

Start the adapter:

```bash
CERNION_AGENT_SIDECAR_BASE_URL=http://127.0.0.1:3900 \
CERNION_READONLY_TOKEN='<authenticated CET sidecar token>' \
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
OPEN_WEBUI_BRIDGE_BASE_URL=http://127.0.0.1:8087 \
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
node --check integrations/open-webui/cernion-sidecar-bridge.js
node --check integrations/open-webui/cernion-openapi-tool-server.js
node --check integrations/open-webui/cernion-process-intake-tool-server.js
node --test integrations/open-webui/cernion-sidecar-bridge.test.js integrations/open-webui/cernion-process-intake-tool-server.test.js integrations/open-webui/cernion-openapi-tool-server.test.js integrations/open-webui/smoke-test.test.js
docker compose -f integrations/open-webui/docker-compose.yml config
node integrations/open-webui/smoke-test.js
```

The Evidence Lookup adapter and smoke harness must remain read-only. The Process Intake adapter
must remain draft-only. Neither may call MaKo, CRM, billing, settlement, tariff mutation, device
control, HITL resolution, deployment, external messaging, webhooks, signatures, automatic
approval, tenant mutations, or direct database paths. The Process Intake adapter's only permitted
upstream call is `POST <CERNION_BASE_URL>/api/copilot-process/intents`, and it never decides
policy itself — only Cernion and a human reviewer do.

## Inbetriebnahme in vier Schritten (Gateway-Tokens, Issue #736)

Die lokalen Provisionierungs-CLIs verwenden weiterhin den vorhandenen Bootstrap-Schutz:
`CERNION_SUPPORT_TOKEN` muss konfiguriert sein und der passende Wert über
`CERNION_SUPPORT_TOKEN_INPUT` oder `--support-token` vorliegen. Der Schlüssel gehört auf den
CET-Server, nicht in Open WebUI. Alle Befehle im CET-Projektverzeichnis ausführen.

1. **Gateway-Token erzeugen.**

   ```bash
   npm run token:create -- --tenant=stadtwerk-a --user=svc:open-webui --name=OpenWebUI --gateway --client=open-webui --org=owui-org-1
   ```

   Den einmalig ausgegebenen `data.token` sicher speichern. Der Datensatz trägt
   `type: 'gateway'`, `client: 'open-webui'`, `tenantId` und `externalOrgId`, aber keine eigenen Rollen oder
   Zusatz-Scopes. `--gateway` und `--roles` schließen sich aus.

2. **Jeden Nutzer zuordnen und kontrollieren.**

   ```bash
   npm run workbench:map -- --tenant=stadtwerk-a --client=open-webui --org=owui-org-1 --email=user@example.org --actor=cet-user-1 --roles=ROLE_USER --clearance=tenant_internal
   # Alternativ zur E-Mail: --user=owui-user-1 (nicht zusammen mit --email).
   npm run workbench:map -- --tenant=stadtwerk-a --client=open-webui --list
   ```

   Die CLI legt Organisations- und Nutzer-Mapping über dieselben Admin-Actions und
   Validierungen wie die REST-API an. `--clearance` ist optional; ohne Angabe ist die
   Clearance leer. `--list` zeigt ausschließlich Mappings des angegebenen Mandanten/Clients.

3. **Open WebUI verbinden.**

   OpenAI-kompatible Verbindung auf `https://<cet-host>/v1` setzen, als API-Schlüssel den
   Gateway-Token verwenden und `cernion-governance-assistant` als Standardmodell wählen.
   In Open WebUI `ENABLE_FORWARD_USER_INFO_HEADERS=true` setzen. Die Organisation ist durch
   `--org` am Token gebunden. Eine Standard-Verbindung genügt; Pipe, Function oder zusätzliche
   Request-Metadata sind nicht erforderlich.

   CET verwendet `X-OpenWebUI-User-Id`, `X-OpenWebUI-Chat-Id` und als optionalen Fallback
   `X-OpenWebUI-User-Email`. E-Mail-Adressen werden getrimmt und kleingeschrieben, danach exakt
   verglichen; es gibt keine Domain-, Alias- oder Teilstring-Suche. Eine bestehende User-ID-
   Zuordnung hat immer Vorrang, auch wenn sie deaktiviert ist. Ein fehlendes oder deaktiviertes
   Mapping bleibt gesperrt. Akteur, Rollen und Clearance kommen ausschließlich aus dem Mapping.
   Explizite `metadata.openWebuiUserId` und `metadata.openWebuiConversationId` bzw.
   `conversationId` haben Vorrang vor den jeweiligen Headern. `metadata.openWebuiOrgId` ist
   optional: der Token-Wert wird verwendet, ein gleicher Metadata-Wert ist erlaubt und ein
   abweichender ergibt 403. Identitäts-Header und Nutzer-/Organisations-Metadata werden bei
   normalen API-Tokens nicht zur Delegation verwendet. Rollen-Header werden immer ignoriert.
   Die offiziellen Namen und die Schalterwirkung sind in der
   [Open-WebUI-Dokumentation](https://docs.openwebui.com/reference/env-configuration/#enable_forward_user_info_headers)
   beschrieben. Die Standardnamen müssen beibehalten werden.

   Der Gateway-Token erlaubt `GET /v1/models` (HTTP 200, ausschließlich
   `cernion-governance-assistant`) und `POST /v1/chat/completions` mit diesem Modell sowie
   die daraus entstehenden internen Workbench-Chat/Query-Aufrufe. Direkte Workbench-, Admin-,
   Notices-, Domain-Router-, MCP- und Sidecar-Aufrufe sowie andere Modelle erhalten 403.

   **Altfall:** Bereits gespeicherte Gateway-Tokens ohne `externalOrgId` benötigen weiterhin
   `metadata.openWebuiOrgId`. Ein Hinweis im Server-Log macht auf diesen Fall aufmerksam.
   Für den Header-only-Betrieb einen neuen Gateway-Token mit `--org` erzeugen und die
   Verbindung umstellen. Neue Gateway-Tokens ohne `--org` werden abgewiesen.

4. **Smoke-Test ausführen.**

   ```bash
   # GATEWAY_TOKEN enthält den zuvor einmalig ausgegebenen data.token.
   curl --fail-with-body https://<cet-host>/v1/models -H "Authorization: Bearer $GATEWAY_TOKEN"
   curl --fail-with-body https://<cet-host>/v1/chat/completions \
     -H "Authorization: Bearer $GATEWAY_TOKEN" \
     -H 'Content-Type: application/json' \
     -H 'X-OpenWebUI-User-Id: owui-user-1' \
     -H 'X-OpenWebUI-User-Email: user@example.org' \
     -H 'X-OpenWebUI-Chat-Id: smoke-736' \
     -d '{"model":"cernion-governance-assistant","messages":[{"role":"user","content":"Starte einen Fall: Netzanschluss für einen Batteriespeicher prüfen."}]}'
   ```

   Erwartet: HTTP 200, OpenAI-kompatible `choices` und CET-Metadata. Ein unbekannter Nutzer,
   deaktiviertes Mapping oder fremder Mandant erhält 403. Bei fehlender Zuordnung enthält
   die Antwort einen verständlichen Hinweis, sich an die Administration zu wenden.

### Normale API-Tokens und Support-Rollen

```bash
npm run token:create -- --tenant=stadtwerk-a --user=admin --name=TenantAdmin --roles=ROLE_USER,ROLE_TENANT_ADMIN
npm run token:create -- --tenant=stadtwerk-a --user=support --name=Support --roles=ROLE_ADMIN,ROLE_UTILITY_HQ --support
```

Die Rollen-Allowlist liegt zentral in `src/auth/token-policy.js`. Nicht erlaubte Rollen
werden mit 422 abgewiesen. `ROLE_ADMIN` und die mandantenübergreifende `ROLE_UTILITY_HQ`
setzen zusätzlich `--support` voraus. Support-Ausstellungen werden ohne Tokengeheimnis in
`TOKEN_ROLE_AUDIT_FILE` (Standard: `uploads/.token-role-audit.jsonl`) auditiert. Bestehende
Token-Datensätze erhalten keine neuen Rollen und behalten ihre bisherigen Scopes.

Jede erfolgreiche Gateway-Delegation schreibt vor der Ausführung einen dauerhaften
`workbench_gateway_delegation`-Datensatz in die Workbench-Identitätsdatenbank: Token-ID,
Client, externe Nutzer-ID, CET-Akteur, Mandant und Zeitstempel; keine Gesprächsinhalte.
Akteur, Rollen und Clearance stammen ausschließlich aus dem Mapping. Die interne
Personenprojektion ist auf kontextuelle Lesezugriffe begrenzt (`read-only`); sie erbt
keinen `full-access`-Scope vom Verbindungsschlüssel. Fachliche Rechte und No-Call-Guards
werden weiterhin von CET geprüft. Fehler beim Mapping oder Audit bleiben fail-closed.
