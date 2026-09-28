# Open WebUI Tenant-Gateway / Cernion Workbench RC3

RC3 exposes CET as a customer-usable Workbench API for Open WebUI without requiring AgentOS, Hermes or OpenClaw.

## Architecture

Open WebUI is the tenant-branded chat UI. The Workbench/Tenant-Gateway API is the server-side bridge. CET remains the governance engine, case-state owner and audit source.

Flow:

1. Open WebUI sends a message, conversation id and user/org ids to `/api/workbench/chat`.
2. Workbench resolves the stored Open-WebUI user/org mapping to CET `tenantId`, `actorId`, roles and sensitivity clearance.
3. For a new conversation, Workbench calls `domain-router.classify` and links the Open WebUI conversation to the returned `cetCaseId`.
4. For a mapped conversation, Workbench calls `domain-router.continue`.
5. Case Event Outbox / MWI is exposed through `/api/workbench/events` and explicit ack via `/api/workbench/events/:eventId/ack`.

Open WebUI never receives CET service tokens. Authorization and fachliche Zulässigkeit remain CET-governed.

## Endpoints

Core:

- `POST /api/workbench/chat`
- `GET /api/workbench/cases/:caseId`
- `GET /api/workbench/cases`
- `POST /api/workbench/conversations/link-case`
- `GET /api/workbench/conversations/resolve`
- `GET /api/workbench/events`
- `POST /api/workbench/events/:eventId/ack`
- `POST /api/workbench/cases/:caseId/evidence`
- `POST /api/workbench/cases/:caseId/dossier`

Admin/provisioning:

- `POST /api/workbench/admin/tenant-mappings`
- `POST /api/workbench/admin/user-mappings`
- `GET /api/workbench/admin/user-mappings/:externalUserId`
- `POST /api/workbench/delivery-clients`

OpenAI-compatible:

- `POST /v1/chat/completions` with `model: "cernion-governance-assistant"` forces the Workbench path and returns OpenAI-compatible output plus CET metadata.

## Minimal Open WebUI call

```json
{
  "client": "open-webui",
  "channel": "open-webui",
  "openWebuiOrgId": "owui-org-1",
  "openWebuiUserId": "owui-user-1",
  "openWebuiConversationId": "owui-chat-1",
  "clientId": "openwebui-tenant-1",
  "message": "MSCONS fehlt, APERAK Z18 ist vorhanden. Was ist der nächste sichere Schritt?"
}
```

Expected response fields:

- `cetCaseId`
- `caseStateVersion`
- `usedOperation` (`classify` or `continue`)
- `primaryDomain`
- `alternativeDomains`
- `readinessState`
- `requiredClarifications`
- `missingEvidence`
- `noCallGuards`

## MWI / events

Open WebUI should poll:

`GET /api/workbench/events?clientId=<tenant-client-id>&attentionOnly=true`

The Workbench wrapper returns UI-safe fields such as `title`, `safeDisplayText`, `severity`, `conversationRef` and `sensitivityLevel`. Polling marks events as delivered in the underlying CET outbox but does not acknowledge them. Ack is explicit:

`POST /api/workbench/events/:eventId/ack`

## Evidence

Files uploaded through Open WebUI must be attached as CET EvidenceRefs using `/api/workbench/cases/:caseId/evidence`. The Workbench endpoint stores provenance and hashes or marks hash as pending for external file references. Raw file content is not placed into model output by this contract.

## Safety boundaries

- Open WebUI is not the fachliche policy engine.
- CET classify/continue is mandatory for Workbench chat.
- Tenant/user/role mapping is server-side and fail-closed.
- CET service tokens stay server-side.
- Case State, Event Outbox, EvidenceRefs and audit stay in CET.
- External or binding effects remain protected by CET RBAC/HITL/No-Call-Guards.
