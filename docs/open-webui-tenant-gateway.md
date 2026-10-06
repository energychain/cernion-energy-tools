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
- `GET /api/workbench/activities`
- `GET /api/workbench/activities/:activityId`
- `GET /api/workbench/case-starters`
- `POST /api/workbench/case-starters/:starterId/start`
- `GET /api/workbench/tools`
- `POST /api/workbench/cases/:caseId/tools/:toolId/run`
- `POST /api/workbench/mail/accounts`
- `GET /api/workbench/mail/accounts`
- `DELETE /api/workbench/mail/accounts/:mailAccountRef`

Admin/provisioning:

- `POST /api/workbench/admin/tenant-mappings`
- `POST /api/workbench/admin/user-mappings`
- `GET /api/workbench/admin/user-mappings/:externalUserId`
- `POST /api/workbench/delivery-clients`

OpenAI-compatible:

- `POST /v1/chat/completions` with `model: "cernion-governance-assistant"` uses Workbench intent routing and returns OpenAI-compatible output plus CET metadata. Status, knowledge and list queries use mapped read-only actions; case and tool requests retain the governed chat path (see [intent modes](../integrations/open-webui/README.md#rc3-cernion-workbench--tenant-gateway-setup)).

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

## Workbench Activity Taxonomy

CET exposes a machine-readable Workbench Activity Taxonomy so Open WebUI can present energy-utility activities without exposing raw API/tool names. Use `GET /api/workbench/activities` to list activities or `GET /api/workbench/activities?query=<user text>` to get prompt-matched activity candidates.

Each activity includes:

- `activityId` and leading `domain`
- example prompts and routing keywords
- typical roles
- required evidence types
- allowed and blocked actions
- handoff domains
- Capability Broker / receipt / OpenAPI operation candidates
- case-starter eligibility and dossier template hint

The taxonomy supports Domain Router decisions, but it does not replace Capability Broker, receipts or EvidenceRefs. It is routing/process context only: missing evidence still leads to clarification/evidence-required guidance, and external/binding actions remain blocked by CET governance.


## Guided Case Starters

Guided Case Starters are a curated Open WebUI projection over the Workbench Activity Taxonomy. They are not a second domain registry and they do not bypass CET classify/continue. Use `GET /api/workbench/case-starters` to render starter buttons/cards and `POST /api/workbench/case-starters/:starterId/start` to start or resume a case through the normal Workbench chat path.

Starter launch is fail-closed for Open WebUI: both `openWebuiOrgId` and `openWebuiUserId` must be supplied and mapped to the CET tenant/user before a starter can create case state. Starter inputs are allowlisted scalar fields; nested objects, secret-like values and raw payloads are rejected or omitted before a prompt is assembled. Missing required inputs are carried as `missingInputs` and should render as clarification/evidence-required guidance, never as approval, rejection or factual conclusion.

Each starter inherits its domain hint, role families, suggested evidence types, blocked actions, handoff domains and dossier hint from the activity taxonomy. Starter-specific copy may add a UI title, prompt text and next-safe-step guidance, but it must not weaken no-call guards or blocked actions.

## API sequence

### Workbench REST mode

```text
POST /api/workbench/admin/tenant-mappings
POST /api/workbench/admin/user-mappings
POST /api/workbench/delivery-clients
POST /api/workbench/mail/accounts
POST /api/workbench/chat
GET  /api/workbench/tools?domain=market_communication
POST /api/workbench/cases/:caseId/tools/mail_search/run
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
- `mail_message`
- `mail_thread`
- `mail_attachment_metadata`
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
- `mail_ref`

Sensitivity levels are `public`, `tenant_internal`, `restricted` and `highly_sensitive`. `restricted` and `highly_sensitive` EvidenceRefs require matching CET sensitivity clearance on attach and are redacted in Workbench case summaries/dossiers for users without clearance.

`sourceRef` and optional `extracts` are allowlisted and length-limited. Secret-like fields (`authorization`, `token`, `apiKey`, `password`, `cookie`, `secret`, `credential`, bearer values) are rejected; arbitrary nested payloads and raw message/file bodies are not echoed to the UI or LLM context. Duplicate EvidenceRefs with the same tenant/case/source fingerprint are idempotent and do not emit duplicate `evidence.available` events.

### Mail evidence

Tenant mailboxes are registered through `/api/workbench/mail/accounts`. Credentials are encrypted in CET using AES-256-GCM and are never exposed to Open WebUI, the LLM, ToolRuns or EvidenceRefs. Mail tooling is read-only: `mail_search`, `mail_read` and `mail_attachment_ref` create supporting EvidenceRefs (`mail_thread`, `mail_message`, `mail_attachment_metadata`) for the active case. `mail_send`, reply and forward remain blocked external effects.

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


## Provisionierung bei laufendem CET / pm2

`workbench:map` und `workbench:map --list` verwenden automatisch die laufende CET-Instanz,
wenn deren lokaler Provisionierungskanal erreichbar ist. Die CLI öffnet dabei keine zweite
PouchDB/LevelDB und benötigt weder einen zusätzlichen Admin-Token noch einen Neustart:

```bash
# Im gleichen Projektverzeichnis (pm2 cwd) und unter dem CET-Betriebsbenutzer ausführen.
npm run workbench:map -- --tenant=stadtwerk-a --client=open-webui --org=owui-org-1 --email=user@example.org --actor=cet-user-1 --roles=ROLE_USER --clearance=tenant_internal
npm run workbench:map -- --tenant=stadtwerk-a --client=open-webui --list
```

Der vorhandene Bootstrap-Schutz gilt unverändert: `CERNION_SUPPORT_TOKEN` muss in CET und
CLI konfiguriert sein, und die CLI benötigt den passenden `CERNION_SUPPORT_TOKEN_INPUT`
oder `--support-token`. Support-Credentials gehören nicht in Open WebUI. Der Kanal stellt
nur den festen Mapping-Workflow bereit; beliebige Action-Namen oder Rollen-Kontexte aus
Requests werden nicht übernommen. Mapping-Schreibvorgänge verwenden dieselben Admin-Actions,
Mandantengrenzen, Rollen-/Clearance-Validierungen und persistierten Mapping-Metadaten wie
REST. Die Liste verwendet `workbench.admin.mappings.list` mit derselben Admin-/Tenant-Prüfung.

Der Kanal ist ein **Unix-Socket**, kein TCP-Port. Sein Verzeichnis hat Modus `0700`, der
Socket `0600`; Zugriff haben der CET-Betriebsbenutzer und root. Bei einem als root gestarteten
pm2 ist der Kanal entsprechend nur für root zugänglich. Zusätzlich prüft der Server bei
jedem Request das bestehende Support-Secret. Der Standardpfad wird aus dem absoluten
`CET_WORKBENCH_IDENTITY_DB_PATH` und der Unix-UID abgeleitet und liegt unter
`<os.tmpdir()>/cet-provisioning-<uid>/<hash>.sock`.

Für explizite pm2-Konfiguration kann `CET_PROVISIONING_SOCKET=/run/cet-provisioning/admin.sock`
in **Dienst und CLI** gesetzt werden. Das Elternverzeichnis muss dem CET-Betriebsbenutzer
gehören und Modus `0700` haben. Neue Umgebungswerte bei pm2 einmalig mit
`pm2 restart <cet-prozess> --update-env` übernehmen; spätere Mapping-Änderungen brauchen
keinen Neustart. CET muss den neuen Code einmal laden, damit der Kanal bereitsteht.
`CET_PROVISIONING_CHANNEL_ENABLED=false` deaktiviert den lokalen Kanal.

Ohne laufenden Dienst bleibt das Offline-Verhalten erhalten: Die CLI startet ihren lokalen
Broker und legt die Mappings wie bisher an. Ein verweigerter Zugriff, falsches Secret oder
Timeout am Online-Kanal führt **nicht** zum Offline-Fallback. Verwaiste Socket-Dateien nach
einem Prozessabbruch werden beim nächsten Dienststart geprüft und ersetzt.

Hält eine ältere CET-Instanz die DB-Sperre und bietet noch keinen Kanal, nennt die CLI
statt des LevelDB-Fehlers den API-Weg. Falls bereits ein berechtigter Tenant-Admin-Token
vorhanden ist, kann er optional verwendet werden:

```bash
npm run workbench:map -- --tenant=stadtwerk-a --client=open-webui --org=owui-org-1 --user=owui-user-1 --actor=cet-user-1 --roles=ROLE_USER --via-api --url=http://127.0.0.1:3000 --token="$ADMIN_TOKEN"
npm run workbench:map -- --tenant=stadtwerk-a --client=open-webui --list --via-api --url=http://127.0.0.1:3000 --token="$ADMIN_TOKEN"
```

Der API-Weg verwendet die vorhandene HTTP-Authentifizierung und deren Berechtigungen.
Ein Gateway-Token eignet sich dafür nicht. `--url` bezeichnet die CET-Basis-URL ohne `/v1`;
für entfernte Hosts HTTPS verwenden. Dieser optionale Weg benötigt kein Support-Secret.

### Prüfung der übrigen Provisioning-CLIs

| CLI | Speicherung | LevelDB-Lock betroffen? |
| --- | --- | --- |
| `workbench:map` / `--list` | Workbench-PouchDB | Online-Kanal, ansonsten Offline-/API-Weg |
| `tenant:create` | JSON-Tenant-Registry | Nein |
| `user:create` | JSON-Tenant-/User-Registry | Nein |
| `token:create` | JSON-Registry und Token-/Signal-Dateien | Nein |

Die separaten PouchDB-Migrations-/Seed-Skripte (`migrate-jobs`,
`migrate-tenant-energy-sharing`, `seed-rcs-demo-tenant`) sind keine Provisioning-CLIs und
werden nicht über den lokalen Admin-Kanal exponiert.
