# Cost Review Committee Status

`cost_review_committee_status` is a read-only evidence board for VNB/EVU cost reviews.
It turns supplied review facts into dossier-safe evidence, gaps and positive follow-ups
before a committee or management gate.

## First Slice

- Action: `dashboard-api.costReviewCommitteeStatus`
- Route: `GET /api/dashboard/cost-review-committee-status`
- Capability key: `cost_review_committee_status`
- Safety: read-only / dossier-safe

The response covers owner, review status, data origin, asset relevance, revenue relevance,
decision readiness, escalation threshold, next committee gate, optional due date, amount
class, rationale and evidence references.

## Out Of Scope

- No ERP, SAP, PSP or accounting writes
- No budget approval or committee decision execution
- No billing, settlement, tariff, MaKo or device-control mutation
- No HITL, mail, webhook, workflow or external connector call
- No legal or regulatory interpretation engine
- No Personal Agent shortcut

Missing evidence is returned as positive dossier follow-up material so the Answer Dossier
can ask for owner, provenance, operational/economic relevance, readiness rationale,
escalation boundary or next governance gate without executing finance workflows.
