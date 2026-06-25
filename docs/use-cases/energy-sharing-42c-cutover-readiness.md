# Energy-Sharing §42c Cutover Readiness

## Purpose

`energy_sharing_42c_cutover_readiness` is a read-only evidence gate for the §42c cutover sub-tracks A-G. It turns the broad production-cutover checklist into dossier-safe readiness facts before any operational release is automated.

## Read-only Boundary

The first slice only evaluates provided status facts and evidence references. It does not provision tenants, migrate data, release A96 exports, run allocation or settlement, create HITL tasks, trigger rollback/restore, call external connectors, read secrets, or add Personal Agent special routing.

## Evidence Model

The gate checks:

- A96 defaults and spec-freeze evidence
- Pilot-tenant and balance-group readiness
- Settlement-readiness hardening
- Allocation/load-test evidence
- Incident/runbook readiness
- Compliance/sign-off evidence
- Rollback/DR readiness

Missing evidence is returned as positive follow-ups so a dossier can show which fact becomes addable when the evidence arrives.

## Consumption Path

The standard path is:

`Capability Broker -> dashboard-api.energySharing42cCutoverReadinessStatus -> Hydration Registry -> Slim Answer Dossier`

The route is available as `GET /api/dashboard/energy-sharing-42c-cutover-readiness`.
