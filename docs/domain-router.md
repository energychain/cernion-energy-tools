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
