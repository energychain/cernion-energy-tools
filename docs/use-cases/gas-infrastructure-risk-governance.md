# Gas Infrastructure Risk Governance

## Purpose

`gas_infrastructure_risk_governance` is a read-only Wave-2 evidence capability for gas infrastructure risk decisions. It makes a technical gas issue dossier-ready without creating a risk register entry, HITL ticket, VDMI record, monitoring decision, mitigation action, asset mutation, operations action, external connector call, or Personal Agent shortcut.

## First Slice

The first implementation slice is `dashboard-api.gasInfrastructureRiskGovernanceStatus` and `GET /api/dashboard/gas-infrastructure-risk-governance`.

The endpoint accepts supplied governance facts:

- `caseId`
- `technicalFact`
- `impactArea`
- `probability`
- `criticality`
- `existingMitigation`
- `threshold`
- `riskRegisterDecision`
- `owner`
- `nextDecisionWindow`
- `blockedFollowUp`
- `sourceRef`

The response returns deterministic status evidence:

- `needs_evidence` style gaps through specific `needs_*` statuses
- `ready_for_risk_decision` for formal risk-register evidence
- `monitoring_needed` for monitoring-oriented or high-risk evidence
- `ready_for_non_inclusion_decision` for documented non-inclusion evidence
- positive follow-ups for missing facts
- explicit side-effect guards

## Boundary

VDMI, HITL and Interface Placeholder remain downstream governance patterns and evidence references. Hydration may call only the read-only status action and must not create or mutate those downstream systems.

Out of scope:

- gas risk register persistence
- automatic formal risk-register creation
- monitoring or mitigation decisions
- HITL/VDMI/Asset-MDM/operations mutation
- legal or regulatory interpretation
- broad cockpit UI
- external connectors
