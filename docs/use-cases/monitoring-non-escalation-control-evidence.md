# Monitoring Non-Escalation Control Evidence

Issue: #368

This slice defines `non_escalation_control_evidence` as a read-only evidence
contract for recurring VNB monitoring. It documents why a signal was not
escalated after a check, without becoming a monitoring, scheduler, alerting,
workflow or ticketing system.

## Read-Only Boundary

Canonical action:

- `dashboard-api.monitoringNonEscalationStatus`
- `GET /api/dashboard/monitoring-non-escalation`

The action accepts query-safe facts such as `signalId`, `sourceName`,
`sourceCheckedAt`, `novelty`, `blockingFinding`, `nextCheckAt`, `owner` and
`rationale`. It returns deterministic dossier-safe evidence with missing
evidence and positive follow-ups.

## Evidence Contract

Required evidence:

- checked monitoring source
- last check timestamp
- novelty classification
- absent blocker / non-hit evidence
- next check timestamp
- owner
- non-escalation rationale

Missing fields are expressed as positive follow-ups, for example
`owner -> add accountable follow-up owner`.

## Guards

Out of scope:

- no scheduler or monitoring run
- no automatic escalation, HITL ticket, mail, webhook or workflow
- no external connector, Object Store/RAG ingestion or Cernion table write
- no MaKo, billing, settlement, tariff, SMGW, CLS or device-control effect
- no Budibase live edit/apply
- no Personal Agent hardcoding or one-off n8n branch
