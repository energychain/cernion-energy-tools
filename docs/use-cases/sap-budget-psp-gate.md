# SAP Budget PSP Gate

The first slice exposes `dashboard-api.sapBudgetPspGateStatus` via `GET /api/dashboard/sap-budget-psp-gate`. It is a read-only evidence gate for one investment measure before finance or board submission. SAP migration and PSP carry-over are treated as dossier evidence, not as an operational SAP integration.

## Goal

Make budget, plan value, committed value, PSP carry-over, owner, approval state, finance gate, data quality and asset benefit visible in one dossier-safe status object. The output supports Answer Dossier and cockpit consumers with explicit gaps, blocked decisions and positive follow-ups.

## Non-Goals

- No SAP connector or PSP writer
- No budget workflow engine or investment persistence
- No finance booking, settlement, billing, MaKo or tariff mutation
- No HITL item creation in the read-only path
- No external connector, new secret handling, broad cockpit UI or Personal-Agent hardcoding

## Input Contract

`measureId`, `measureName`, `migrationWave`, `sapSystemRef`, `pspElementId`, `legacyInternalOrderId`, `availableBudgetEur`, `plannedValueEur`, `committedValueEur`, `pspCarryOverEur`, `budgetOverhangEur`, `assetBenefit`, `priorityScore`, `ownerRole`, `approvalStatus`, `financeGate`, `dataQualityStatus`, `sourceSnapshotId`, and optional `blockedDecisions`.

## Statuses

- `ready_for_finance_gate`
- `needs_psp_snapshot`
- `needs_budget_owner`
- `needs_asset_benefit`
- `needs_sap_mapping`
- `needs_finance_gate`
- `blocked_by_approval`
- `blocked_by_data_quality`
- `needs_budget_evidence`

## Evidence Flow

Capability Broker routes SAP Budget / PSP / Budgetueberhang / interner Auftrag / Finance Gate / Massnahmenpriorisierung / Assetnutzen prompts to `dashboard-api.sapBudgetPspGateStatus`. The Hydration Registry allowlists only this read-only action and formats a slim dossier summary with gate status, readiness, measure, PSP, budget gap, owner, finance gate, leading gap and side-effect guard.

## Related

For a budget-cap exception decision dossier centered on no-regret/technical/KPI exception justification and committee readiness (rather than the SAP migration/finance-gate angle above), see [investment-budget-cap-exception-governance.md](investment-budget-cap-exception-governance.md) (issue #518).
