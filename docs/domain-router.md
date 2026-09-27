# Domain Router

The Domain Router is an advisory Cernion Energy Tools component for AgentOS/Hermes/OpenClaw integration.

It classifies a task envelope into an energy-domain case state, persists local PouchDB metadata, exposes no-dead-end transitions, and feeds a PouchDB Case Event Outbox for asynchronous message-waiting indication.

Boundary rules:

- Advisory/read-only integration surface only.
- No operational writes, approvals, bookings, invoices, budget commitments, or binding regulatory assessments.
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

Read-only tokens may call these routes because the service is an advisory/local-state routing surface. Tenant, actor role, sensitivity, and delivery-preference checks still run inside the Domain Router before state or events are exposed.
