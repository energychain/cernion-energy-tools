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

CET-governed Sidecar clients may call these routes with existing authenticated CET tokens. The token is identity/client context. Tenant isolation, action authorization, delivery preferences and No-Call checks still run inside CET. Case content is shared within the authenticated tenant; this does not grant permission for external actions or connectors.

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
      "caseVisibility": "tenant",
      "identifierTypes": {
        "reference-a": { "caseFold": true, "stripWhitespace": true, "strength": "strong" }
      }
    }
  }
]
```

Configure this in the existing tenant registry selected by
`CERNION_TENANT_REGISTRY_FILE`. Case visibility is tenant-wide by product decision
in #764: missing settings and legacy cases without a visibility field are treated
as `tenant`, without a migration. Earlier explicit `own`/`team` values are accepted
for compatibility but no longer restrict access inside the tenant. Clients cannot
select another tenant or supply authentication. Authentication, mapping checks and
validation of new sensitivity labels remain enforced.

Within the authenticated tenant, all case content, identifiers, situation summaries,
case evidence and inbox tasks are accessible across actors and role sets. Existing
sensitivity labels remain recorded; they do not hide case material from another
person in the same tenant. Evidence read helpers receive the authenticated tenant
scope explicitly. Reads from another tenant remain blocked even for public evidence
or matching reference values. Permissions for external connectors, governance,
capability execution and binding effects are unchanged.

Matching normalized kind **and** value adds `same_subject` with confidence 0.8,
`matching_typed_identifier` provenance and the matching identifiers. A different
kind with the same value is not a subject match. Technical `LINK_KEYS` remain
supported. Cases remain independent; discovery never merges them or copies their
raw content. A correction to the identifier removes obsolete automatic links.

Reads of another person's case remain content-free audited in the **existing case
Event Outbox database** before disclosure; an audit failure blocks the response.
When related summaries contribute to a response, sensitivity labels are retained.

Typed relationships preserve identifier provenance. “gehört zusammen” / “gehört
nicht zusammen” confirms or rejects a unique related case; with multiple candidates,
specify its `F-` reference. Rejections are honored in both directions. Link
corrections retain the predecessor's owner check, case-version guard, correction
history and immutable case journal, and can be undone with “rückgängig”. No new
database or persistence lifecycle is introduced. These corrections are separate
from function-neighbor corrections.

Internal authenticated actions used by Workbench are
`domain-router.cases.searchIdentifiers` and `domain-router.cases.correctLink`.
Public reads remain available through Workbench/Gateway and the existing
`related-sessions.discover` route.

## Continuing an existing case (#764)

Workbench resolves open, visible cases **before** reserving or creating a new
case. A unique tenant case with matching strong typed identifiers is continued;
the new chat is bound to that case, the situation is updated incrementally and
the new material is recorded in the existing case event database. Case lookup,
assignment and persistence are
serialized per authenticated tenant across people and conversations, so two
simultaneous fresh chats cannot both create the same work item. Understanding,
retrieval and answer generation remain outside that critical section; normal
turns retain their conversation queue, and independent chats can answer in parallel.

Multiple matches produce one selection question with at most three descriptions,
newest first, including the creator of each case. A number or displayed `F-`
reference selects an offered case; `neu` creates a separate case using the original
material. Candidates and tenant scope are checked again at selection. A unique
match is continued across people without an extra sharing or participation grant.
The assignment sentence always names who originally created the case. Newly
contributed material records its own authenticated author, without replacing the
original case creator.

Identifier comparison reuses the normalization in `case-linking.js`. The existing
identifier-kind and code catalogs exclude weak features and response codes.
Only reference kinds explicitly classified in the existing identifier-kind catalog
are strong by default. Generic, untyped and unknown kinds, including arbitrary
attributes such as status, date and capacity, remain weak unless tenant data
explicitly marks them strong. Deployments can mark a kind weak with
`sharedService.identifierTypes[kind].strength = "weak"`, or strong with
`"strong"`. Place, postal-code and personal fields never become strong through
this setting. A continuation requires all supplied strong identifiers to match
the candidate; one shared location with a different process reference is not
enough. Technical `LINK_KEYS` remain relationship-discovery keys and do not
automatically bind a new conversation.

The assignment turn uses a short description and the central readable status
mapping in `src/case-status-labels.json`. Subsequent turns on that bound chat do
not repeat the assignment notice, including after turn-memory expiry. Related
case summaries still contribute authorized answer evidence using readable status
labels; the former repeated multi-sentence prefix is removed.

After selecting a case, other open cases in the same tenant with exactly the same strong
identifiers are proposed once for merging. Only the explicit command
`Fälle zusammenführen` or `Zusammenführung bestätigen` applies the saved proposal;
an ordinary `ja` does not merge anything. The protected merge action rechecks
authenticated tenant, open state and exact identifiers. It audits each merge
before mutation, retains the complete source snapshot and original source
document/journal, and marks the source with its destination. Existing Workbench
conversation bindings are moved with the existing store helper. Sources cease
to be continuation candidates; no background migration or automatic merge runs.

Validation: `tests/case-continuation.test.js` covers persistence, three-turn
notices, selection/new, weak and conflicting identifiers, cross-tenant
negatives, tenant-scope rechecks, concurrent fresh chats and explicit audited
merges. `tests/case-linking.http.test.js` covers the authenticated HTTP path and
retains the predecessor's correction, undo, draft and visibility regressions.

Validation: `tests/case-linking.test.js` exercises real broker/PouchDB persistence,
normalization, tenant-wide case access, cross-tenant event/inbox boundaries, failed
audits, corrections and restart. `tests/case-linking.http.test.js` uses the real
HTTP gateway with two mapped colleagues and negative tenant/organization
checks. Fixtures contain fictional actors and identifiers.
