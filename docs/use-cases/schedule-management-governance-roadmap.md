# Fahrplanmanagement Governance Roadmap

## Use Case & Contract

- **Rolle:** Read-only dossier-safe Fahrplanmanagement Governance Roadmap Evidence Gate.
- **Key Principle:** Reuse existing fNAV/netzfahrplan/EDM/validation/finance layers rather than creating new stateful scheduling/dispatch engines, active load control databases, or operational mutation workflows.

## Technical Contract

- **Capability Key:** `schedule_management_governance_roadmap`
- **Evidence Registry Key:** `schedule_management_governance_roadmap`
- **Read-Only Action:** `dashboard-api.scheduleManagementGovernanceRoadmapStatus`
- **REST Path:** `GET /api/dashboard/schedule-management-governance-roadmap`
- **Dossier Hydration:** Allowlisted with `safety.readOnly: true`

## Inputs (Scalar / Query-Safe)

- `meteringPointId` (string, optional)
- `targetState` (string, optional)
- `capabilityMaturity` (string, optional)
- `dataObjects` (comma-separated or array, optional)
- `systemIntegrations` (comma-separated or array, optional)
- `roleOwnership` (comma-separated or array, optional)
- `redispatchBoundary` (string, optional)
- `fnavReadiness` (string, optional)
- `capacityManagementGaps` (comma-separated or array, optional)
- `roadmapItems` (comma-separated or array, optional)
- `decisionMeetings` (comma-separated or array, optional)
- `owner` (string, optional)
- `nextAction` (string, optional)
- `sourceRef` (comma-separated or array, optional)

## Outputs

Returns a deterministic status mapping, readiness score, normalized evidence items, missing evidence gaps, positive follow-ups, and strict `sourceActions.notCalled` side-effect guards.
