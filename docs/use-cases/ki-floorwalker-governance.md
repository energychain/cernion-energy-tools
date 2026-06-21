# KI Floorwalker Governance

## Use Case & Contract

- **Rolle:** Read-only dossier-safe KI Floorwalker Governance Evidence Gate.
- **Key Principle:** Reuse existing personal-agent/cya/vdmi/datapoint layers rather than creating new prompt databases, LLM platforms, training apps, or automatic mutation/approval engines.

## Technical Contract

- **Capability Key:** `ki_floorwalker_governance`
- **Evidence Registry Key:** `ki_floorwalker_governance`
- **Read-Only Action:** `dashboard-api.kiFloorwalkerGovernanceStatus`
- **REST Path:** `GET /api/dashboard/ki-floorwalker-governance`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `useCaseId` (string, optional)
- `processOwner` (string, optional)
- `useCasePriority` (string, optional)
- `allowedDataspaces` (comma-separated or array, optional)
- `promptStandards` (string, optional)
- `processBoundaries` (string, optional)
- `rolesAndResponsibilities` (string, optional)
- `guidedApplication` (string, optional)
- `riskAndApprovalStatus` (string, optional)
- `proofOfBenefit` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping, readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
