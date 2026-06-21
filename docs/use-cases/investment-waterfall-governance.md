# Investment Waterfall Governance

## Purpose

`investment_waterfall_governance` is a read-only evidence capability for strategic investment waterfall planning. It turns a multi-year investment item into a dossier-safe governance status projection with strategic budget allocation, Related bottleneck reference, target process, committee window, evidence readiness, accountable owner, planned next action, mandate status, verzugsrisiko (risk if delayed), source references, and explicit evidence gaps.

The first slice supports coordination and evidence readiness only. It does not decide CAPEX priority, allocate budgets, create HITL or VDMI work items, mutate investment plans, call external SharePoint/Excel/ERP connectors, or trigger billing, settlement, tariff or payment effects.

## Service Boundary

- Moleculer action: `dashboard-api.investmentWaterfallGovernanceStatus`
- REST endpoint: `GET /api/dashboard/investment-waterfall-governance`
- Capability key: `investment_waterfall_governance`
- Evidence registry key: `investment_waterfall_governance`
- Safety: `read_only`

## Inputs

- `investmentItemId`
- `targetProcess`
- `budgetAmount`
- `bottleneckRef`
- `committeeWindow`
- `evidenceReadiness`
- `owner`
- `nextAction`
- `mandateStatus`
- `riskIfDelayed`
- `sourceRef`

## Output Contract

The response contains deterministic dossier-ready facts:

- `status` and `readinessScore`
- `governanceContext`
- `governanceEvidence`
- `evidenceItems`
- `missingEvidence`
- `positiveFollowUps`
- `blockingFindings`
- `sourceActions.notCalled`
- `dossierEvidence`

Missing budget allocation, bottleneck relation, committee window, evidence readiness, owner, next action, mandate status, delay risk or source references are returned as explicit `missingEvidence` with positive follow-ups.

## Side-Effect Guard

Hydration and broker plans must not call:

- `pmo-budget.create`
- `pmo-budget.allocate`
- `pmo-budget.mutate`
- `hitl.create`
- `vdmi.create`
- `vdmi.mutate`
- `investment-planning.createPlan`
- `investment-planning.mutate`
- `finance-agent.mutate`
- `budget.release`
- `billing.release`
- `settlement.prepareBilling`
- `tariff.mutate`
- `payment.execute`
- `external.connector.call`
- `personal-agent.execute`
