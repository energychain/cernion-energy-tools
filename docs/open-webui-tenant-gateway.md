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

## Required provisioning

Workbench chat fails closed when an Open-WebUI user/org is supplied without a matching CET mapping.
Provision these records before the first customer chat:

1. `POST /api/workbench/admin/tenant-mappings` maps `externalOrgId` to `cetTenantId` and an optional default `clientId`.
2. `POST /api/workbench/admin/user-mappings` maps `externalUserId` to `cetActorId`, CET roles and sensitivity clearance.
3. `POST /api/workbench/delivery-clients` registers the tenant-bound polling client used for MWI.

Tenant admins may only provision their own CET tenant. Platform/HQ admins can provision cross-tenant mappings. Mapping errors intentionally fail closed; do not bypass them in prompts or Open WebUI system messages.

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
- `turnMemorySummary`

## CET Turn Memory

Workbench does not treat Open WebUI chat history as the fachliche source of truth. After each successful Workbench chat turn, CET stores a compact, case-bound Turn Memory for the `cetCaseId`:

- `primaryDomain` / `alternativeDomains`
- `readinessState`
- `activeRole` and bounded `roleHistory`
- open questions / required clarifications
- missing evidence
- working assumptions
- latest safe, non-binding conclusion
- no-call/no-claim guards

On follow-up turns, Workbench passes this compact memory into `domain-router.continue` as `knownContext.cetTurnMemory`. Case summaries expose `turnMemorySummary`, `workingAssumptions`, `openQuestions` and `activeRoleProjection` for UI rendering. Raw Open WebUI chat history, file bodies, credentials and untrusted long payloads are not persisted as Turn Memory.

## API sequence

### Workbench REST mode

```text
POST /api/workbench/admin/tenant-mappings
POST /api/workbench/admin/user-mappings
POST /api/workbench/delivery-clients
POST /api/workbench/chat
GET  /api/workbench/cases/:caseId
GET  /api/workbench/events?clientId=...
POST /api/workbench/events/:eventId/ack
```

`/api/workbench/chat` chooses `domain-router.classify` for a new conversation and `domain-router.continue` for a mapped conversation. The client should persist only its own `openWebuiConversationId`; CET owns `cetCaseId` and case state.

### OpenAI-compatible mode

Open WebUI can use `POST /v1/chat/completions` with `model: "cernion-governance-assistant"`. The required Workbench identifiers are passed in `metadata`:

```json
{
  "model": "cernion-governance-assistant",
  "messages": [{ "role": "user", "content": "APERAK Z18 nach MSCONS-Versand" }],
  "metadata": {
    "client": "open-webui",
    "openWebuiOrgId": "owui-org-1",
    "openWebuiUserId": "owui-user-1",
    "openWebuiConversationId": "owui-chat-1",
    "clientId": "openwebui-tenant-1"
  }
}
```

The response stays OpenAI-compatible and includes CET metadata such as `cetCaseId`, `primaryDomain`, `readinessState` and pending event counts where supported by the caller.

## MWI / events

Open WebUI should poll:

`GET /api/workbench/events?clientId=<tenant-client-id>&attentionOnly=true`

The Workbench wrapper returns UI-safe fields such as `title`, `safeDisplayText`, `severity`, `conversationRef` and `sensitivityLevel`. Polling marks events as delivered in the underlying CET outbox but does not acknowledge them. Ack is explicit:

`POST /api/workbench/events/:eventId/ack`

## Evidence

Files uploaded through Open WebUI must be attached as CET EvidenceRefs using `/api/workbench/cases/:caseId/evidence`. The Workbench endpoint stores provenance and either a caller-provided file/content hash or `hashStatus: "unavailable"`; it does not fabricate an Inhalts-Hash for external references. Raw file content is not placed into model output by this contract.

Allowed `evidenceType` values in the RC3 EvidenceRef contract:

- `aperak_message`
- `contrl_message`
- `mscons_message_status`
- `utilmd_master_data`
- `mako_process_trace`
- `mako_error_code_diagnosis`
- `market_partner_protocol`
- `metering_values_export`
- `grid_connection_document`
- `calculation_assumption`
- `generic_document`

Allowed `sourceType` values:

- `openwebui_file_ref`
- `external_url_ref`
- `manual_metadata`
- `uploaded_file`
- `existing_cet_evidence_ref`
- `willi_mako_ref`

Sensitivity levels are `public`, `tenant_internal`, `restricted` and `highly_sensitive`. `restricted` and `highly_sensitive` EvidenceRefs require matching CET sensitivity clearance on attach and are redacted in Workbench case summaries/dossiers for users without clearance.

`sourceRef` and optional `extracts` are allowlisted and length-limited. Secret-like fields (`authorization`, `token`, `apiKey`, `password`, `cookie`, `secret`, `credential`, bearer values) are rejected; arbitrary nested payloads and raw message/file bodies are not echoed to the UI or LLM context. Duplicate EvidenceRefs with the same tenant/case/source fingerprint are idempotent and do not emit duplicate `evidence.available` events.

### Willi-MaKo references

MaKo diagnostics from `willi.cernion.de` should be attached with `sourceType: "willi_mako_ref"`. Willi is modeled as a supporting Evidence-/Diagnosequelle, not as the case decision owner. CET remains the case-state, audit and governance authority.

A Willi-MaKo APERAK Z18 reference may include allowlisted fields such as `williCaseRef`, `messageId`, `processRef`, `messageType`, `relatedMessageType`, `errorCode`, `segmentRef`, `ahbVersion`, `maloId`, `meloId`, `marketPartner`, `direction`, `timestamp` and `safeSummary`. It produces a UI-safe EvidenceRef with `provenance.system: "willi.cernion.de"`, `evidenceRole: "diagnostic_signal"`, `claimStrength: "supporting"` and `readinessReviewRequired: true`. APERAK Z18 is a strong `market_communication` signal and may add `market_master_data` routing hints when MaLo/MeLo/Lieferbeginn context is present, but it must not be treated as a final cause without APERAK/AHB segment context and Stammdatenhistorie.

## Common failure modes

- `WORKBENCH_TENANT_MAPPING_REQUIRED`: the Open-WebUI org has not been mapped to a CET tenant. Create `/api/workbench/admin/tenant-mappings`.
- `WORKBENCH_MAPPING_REQUIRED`: the Open-WebUI user has no CET actor/role mapping. Create `/api/workbench/admin/user-mappings`.
- `WORKBENCH_DELIVERY_CLIENT_REQUIRED`: the requested `clientId` is not registered for MWI. Create `/api/workbench/delivery-clients`.
- `WORKBENCH_IDENTITY_INCOMPLETE`: Open-WebUI user and org ids must be sent together; sending only one fails closed.
- Evidence attach rejects unknown evidence/source/sensitivity types, restricted evidence without clearance, oversized fields and secret-like `sourceRef` keys by design.

## Safety boundaries

- Open WebUI is not the fachliche policy engine.
- CET classify/continue is mandatory for Workbench chat.
- Tenant/user/role mapping is server-side and fail-closed.
- CET service tokens stay server-side.
- Case State, Event Outbox, EvidenceRefs and audit stay in CET.
- External or binding effects remain protected by CET RBAC/HITL/No-Call-Guards.
