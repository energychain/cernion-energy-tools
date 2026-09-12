# Budget Waterfall Governance

Issue #189 is implemented as a read-only, dossier-native status for
`budget_waterfall_governance`.

The first slice exposes `dashboard-api.budgetWaterfallGovernanceStatus` and
`GET /api/dashboard/budget-waterfall-governance` so Answer Dossier can validate
budget-waterfall claims through the standard Capability Broker and Hydration
Registry path.

## Contract

- Moleculer action: `dashboard-api.budgetWaterfallGovernanceStatus`
- REST route: `GET /api/dashboard/budget-waterfall-governance`
- Capability key: `budget_waterfall_governance`
- Hydration action: `dashboard-api.budgetWaterfallGovernanceStatus`
- Safety: `read_only`, non-consequential

## Evidence Fields

- `waterfallId` / `sourceId`
- `period`
- `division`
- `baselineRef`
- `forecastCutoff`
- `carryoverLogic`
- `signConvention`
- `ownerRole`
- `approvalStatus`
- `followUpDecision`
- `sourceSnapshotRef`
- `evidenceRef`

## Status Values

- `needs_source_identity`
- `needs_period_division`
- `needs_baseline`
- `needs_sign_convention`
- `needs_forecast_cutoff`
- `needs_carryover_logic`
- `needs_owner_role`
- `needs_approval`
- `needs_follow_up_decision`
- `needs_source_evidence`
- `blocked_by_approval_status`
- `ready_for_committee_review`

## Out Of Scope

This is not a controlling backend, SAP/PSP writer, finance mutation path,
investment workflow engine, chart renderer, legal/accounting authority claim,
external ingestion connector, HITL queue or Personal Agent shortcut.

`Capability Broker -> dashboard-api.budgetWaterfallGovernanceStatus -> Hydration Registry -> Slim Answer Dossier`

## Related

For a measure-level PSP/budget-cap exception decision dossier (cap, variance, cause/effect, risk of deferral, committee readiness), see [investment-budget-cap-exception-governance.md](investment-budget-cap-exception-governance.md) (issue #518).
