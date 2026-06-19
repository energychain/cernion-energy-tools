# E2E Controllability Check Governance

## Product Cut

Issue #173 is implemented as a read-only governance and evidence matrix for E2E Steuerbarkeitscheck handovers. It is not a new switching engine, not a new HITL queue, not a settlement release workflow, and not a cockpit build.

The first slice exposes `dashboard-api.e2eControllabilityGovernanceStatus` via `GET /api/dashboard/e2e-controllability-governance`. The action accepts source facts for connection intake, metering concept, asset control capability, grid operations decision, market communication handover, billing impact, owner, deadline, and open measure. It returns a deterministic matrix with process steps, decision boundaries, explicit gaps, positive follow-ups, and dossier-safe evidence.

## Evidence Matrix

Required evidence slots:

- `connection_intake`: Netzanschluss and asset identity context.
- `metering_concept`: TAF, Messkonzept, and EDM readiness.
- `asset_control_capability`: controllability evidence for the asset.
- `grid_operations_decision`: Redispatch or §14a operations readiness.
- `market_communication_handover`: MaKo handover traceability.
- `billing_impact_check`: billing and settlement boundary clarity.
- `owner_deadline_open_measure`: accountable owner, due date, and next open measure.

Missing slots are reported as gaps and positive follow-ups. The action never infers controllability from partial evidence.

## Guardrails

- Read-only and non-consequential.
- No VDMI, HITL, MaKo, billing, settlement, tariff, device-control, or production mutation.
- No Personal Agent hardcoding and no one-off n8n branch.
- Existing VDMI, HITL, interface-placeholder, Grid Operations, EDM, and Settlement surfaces are referenced as source surfaces only.
