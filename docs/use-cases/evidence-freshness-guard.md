# Evidence Freshness Guard

`evidence_freshness_guard` is a read-only VNB signal-monitoring capability for
caller-supplied metadata. It helps recurring leadership, cockpit and evidence
queues distinguish stale context anchors from true new operational deltas.

The first slice accepts explicit metadata only: source kind, source timestamp,
received timestamp, last-seen timestamp, known/current snapshot id or hash,
process area, owner, due date, blocked decision, severity hint and escalation
threshold. It returns scalar dossier facts for freshness state, delta state,
staleness days, known-anchor status, new-delta status, escalation
recommendation, non-escalation reason, evidence gaps and positive follow-ups.

Out of scope:

- no email, Teams, calendar, monitoring or task connector ingestion
- no ACF card creation, ticket creation, notification dispatch, HITL or
  workflow execution
- no MaKo, billing, settlement, tariff or device-control path
- no Personal-Agent hardcoding or one-off n8n branch
- no raw private message content persistence

The #251 consumption path is:

`Capability Broker -> dashboard-api.evidenceFreshnessGuardStatus -> Hydration Registry -> Slim Dossier`

