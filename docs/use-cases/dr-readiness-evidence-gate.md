# DR Readiness Evidence Gate

Issue #74 is cut as a read-only `dr_readiness_evidence_gate` capability.

The first slice answers whether a tenant or cutover process has dossier-ready
disaster-recovery evidence. It projects request facts such as store inventory,
snapshot manifest, restore drill, RTO/RPO objectives, per-tenant restore proof,
owner, and next drill due date into a deterministic status payload.

## In Scope

- `dashboard-api.drReadinessEvidenceStatus`
- `GET /api/dashboard/dr-readiness-evidence`
- Capability Broker routing for DR readiness, backup evidence, restore drill,
  RTO/RPO, snapshot manifest, cutover snapshot, and tenant restore wording
- Evidence Registry key `dr_readiness_evidence_gate`
- Hydration Registry allowlist and slim formatter for dossier evidence

## Out of Scope

- Backup or restore scripts
- Backup scheduler, retention engine, or replication sidecar
- Self-service restore or tenant data mutation
- Archive encryption/key handling or external storage connector
- Webhook emission, production DR action, or KRITIS certification claim
- Personal Agent hardcoding or broad cockpit UI

## Safety Contract

The capability is `read_only`. It may reference existing evidence sources and
runbooks but must not call backup, restore, scheduler, replication, tenant
mutation, webhook, external connector, HITL creation, or Personal Agent
execution actions.
