# Gas Decommissioning Roadmap Status

Issue #190 is cut as a read-only dossier/evidence capability, not as a gas transformation backend.

## First Slice

`dashboard-api.gasDecommissioningRoadmapStatus` and `GET /api/dashboard/gas-decommissioning-roadmap` return a deterministic status object for a gas-network decommissioning roadmap:

- roadmap identity, current phase and owner
- asset-risk evidence
- dependency and blocker state
- investment-impact handover reference
- committee-gate date and next decision gate
- execution-handover owner
- source snapshot and evidence references
- missing evidence, positive follow-ups and side-effect guards

The capability is safe for Answer Dossier hydration because it is read-only and does not persist roadmap state.

## Reuse Path

Later iterations can back the fields with existing components:

- VDMI for roadmap phases, owners, blockers and evidence requirements
- `investment-planning` / Finance evidence for investment-impact handover
- HITL for committee gates after an explicit separate product decision
- Presentation service for decision briefs or roadmap tables

This slice deliberately keeps those components as referenced sources, not called side-effect paths.

## Non-Goals

- no gas transformation service or execution workflow
- no forecast, route optimisation or legal/regulatory assertion engine
- no SAP, Finance, Investment Planning, settlement, billing or MaKo mutation
- no HITL creation, customer communication, external connector or production action
- no Personal Agent shortcut and no one-off n8n branch
- no broad cockpit UI
