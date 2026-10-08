# Domain Router

The Domain Router is a CET-governed Cernion Energy Tools component for AgentOS/Hermes/OpenClaw integration.

It classifies a task envelope into an energy-domain case state, persists local PouchDB metadata, exposes no-dead-end transitions, and feeds a PouchDB Case Event Outbox for asynchronous message-waiting indication.

Boundary rules:

- CET-governed integration surface: authentication identifies tenant, actor and client; CET authorization/governance decides what the actor may do.
- Internal CET state operations are allowed where authorized, including case state, event outbox delivery state, related-session links and future internal CET process/master-data changes.
- External or legally/processually binding effects remain gated by CET RBAC, tenant/user enablement, HITL and No-Call-Guards.
- No ungated external sends, approvals, bookings, invoices, budget commitments, market-process dispatches, or binding regulatory assessments.
- No new external database, queue, or cache dependency; case state and events use existing PouchDB patterns.
- Capability Broker, Agent Receipts, Domain Routes, Semantic Domains, Personal-Agent state, and Knowledge/QDrant routing hints remain the source systems. The router orchestrates them and stores references, not duplicated catalogs.
- Knowledge/QDrant hits are routing evidence only, not answer facts.

REST routes:

- POST /api/domain-router/classify
- POST /api/domain-router/continue
- POST /api/domain-router/explain
- GET /api/domain-router/events
- POST /api/domain-router/events/:eventId/ack
- POST /api/domain-router/cases/:caseId/related-sessions/discover
- POST /api/domain-router/cases/:caseId/related-sessions/link

Sidecar tools:

- cernion.classify_task
- cernion.continue_case
- cernion.list_case_events
- cernion.ack_case_event
- cernion.discover_related_sessions

CET-governed Sidecar clients may call these routes with existing authenticated CET tokens. The token is identity/client context, not the fachliche read/write permission boundary. Tenant, actor role, sensitivity, case visibility, delivery-preference and No-Call checks still run inside CET before state or events are exposed or changed.

Sidecar manifest metadata distinguishes legacy compatibility from the canonical effect model:

- `requiredScope: read-only` and `sideEffects: none` remain for older clients.
- `effectClass` is canonical for CET governance, e.g. `internal_case_state`, `internal_event_outbox` or `advisory_reasoning`.
- `externalSideEffects: false` is required for the current Sidecar tools.
- `requiresCetAuthorization: true` means the downstream CET service remains responsible for tenant/user/process authorization.

## Typed case identifiers and colleague visibility (#753)

The situation supplied by Workbench contributes `identifiers: [{ kind, value }]`.
API callers can supply the same array as `knownContext.identifiers` (at most 20
entries; kind up to 100 characters, value up to 256). The router stores normalized
`typedIdentifiers`. Kind is NFKC-normalized, trimmed and lowercased; values are
NFKC-normalized and trimmed, retaining leading zeros and case by default. No
identifier-type list is embedded in the core. Comparison rules are tenant data:

```json
[
  {
    "tenantId": "anonymous-tenant",
    "sharedService": {
      "caseVisibility": "team",
      "identifierTypes": {
        "reference-a": { "caseFold": true, "stripWhitespace": true }
      }
    }
  }
]
```

Configure this in the existing tenant registry selected by
`CERNION_TENANT_REGISTRY_FILE`. Missing `caseVisibility` means `own`. Client
metadata cannot set it. Invalid settings fail closed. New cases snapshot the
explicit setting; existing documents without the field stay `own` without a
migration. Tightening the current tenant setting to `team` or `own` also restricts
previously shared cases. Raising it does not expose old private cases.

- `own`: creator, recorded participants or an existing explicit role release.
- `team`: additionally people with the same assigned role set as the creator, or
  overlapping current function coverage at score >= 0.5. Expired/future coverage
  does not count. Coverage adds no roles or clearance.
- `tenant`: additionally people in the authenticated tenant, still subject to the
  existing case role ACL and sensitivity clearance.

Matching normalized kind **and** value adds `same_subject` with confidence 0.8,
`matching_typed_identifier` provenance and the matching identifiers. A different
kind with the same value is not a subject match. Technical `LINK_KEYS` remain
supported. Cases remain independent; discovery never merges them or copies their
raw content. A correction to the identifier removes obsolete automatic links.

Foreign case views return only a situation summary (up to 600 characters), status,
responsible actor IDs and typed identifiers, plus the case reference. They omit
initial text, complete situations, classification prompts, evidence, drafts,
turn-memory, inbox tasks and event payload references. Raw reads and mutations
still require participation or an existing explicit role release. Every foreign
summary read writes a content-free immutable audit entry in the **existing case
Event Outbox database** before disclosure; an audit failure blocks the response.
Subject links never forward asynchronous payloads. When a related summary is used
in a case response, its sensitivity flags are retained on that case.

Workbench starts the answer with the related case's `F-` reference, responsible
actor and status, and supplies only its safe summary as answer evidence (at most
five related cases per turn). “Wie ist der Stand bei ANON-0001?” looks up complete
visible reference values even in a fresh conversation; `reference-a:ANON-0001`
can disambiguate the type. Partial values do not match.

“gehört zusammen” / “gehört nicht zusammen” confirms or rejects the unique related
subject case. With multiple candidates, specify its `F-` reference. Rejections are
honored from both sides of discovery. The owner can use “rückgängig” to undo the
latest active case-link correction. Changes use a case-version guard, persist
actor, previous relation, decision and undo reference in the case correction
history, and write an immutable `corrected` case journal entry in the same existing
Event Outbox database. Neither a new database nor a new persistence lifecycle is
introduced. These records survive restart and do not modify function-neighbor
learning or another person's case turn. A conversation marker preserves the existing undo
path when a function correction follows a case-link correction.

Internal authenticated actions used by Workbench are
`domain-router.cases.searchIdentifiers` and `domain-router.cases.correctLink`.
Public reads remain available through Workbench/Gateway and the existing
`related-sessions.discover` route.

Validation: `tests/case-linking.test.js` exercises real broker/PouchDB persistence,
normalization, visibility, clearance, raw-content/event/inbox boundaries, failed
audits, corrections and restart. `tests/case-linking.http.test.js` uses the real
HTTP gateway with two mapped colleagues and negative team/tenant/organization
checks. Fixtures contain fictional actors and identifiers.
