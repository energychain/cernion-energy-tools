# Investment Committee Steering Cards

## Purpose

`investment_committee_steering_cards` is a read-only evidence capability for preparing investment committee review. It turns an investment item into a dossier-safe management card with asset/project reference, review status, evidence status, committee window, owner, blocked follow-up action, source references and explicit evidence gaps.

The first slice supports coordination and evidence readiness only. It does not decide CAPEX priority, release budgets, create HITL or VDMI work items, mutate investment plans, call external SharePoint/Excel connectors, or trigger billing, settlement, tariff or payment effects.

## Service Boundary

- Moleculer action: `dashboard-api.investmentCommitteeSteeringCardsStatus`
- REST endpoint: `GET /api/dashboard/investment-committee-steering-cards`
- Capability key: `investment_committee_steering_cards`
- Evidence registry key: `investment_committee_steering_cards`
- Safety: `read_only`

## Inputs

- `investmentItemId`
- `projectId`
- `assetId`
- `reviewStatus`
- `evidenceStatus`
- `committeeWindow`
- `owner`
- `blockedFollowUpAction`
- `capexEur`
- `riskFlag`
- `sourceRef`

## Output Contract

The response contains deterministic dossier-ready facts:

- `status` and `readinessScore`
- `cardContext`
- `committeeContext`
- `evidenceItems`
- `missingEvidence`
- `positiveFollowUps`
- `blockedDecisions`
- `sourceActions.notCalled`
- `dossierEvidence`

Missing investment item, asset/project reference, review status, evidence status, owner, committee window, blocked follow-up action or source references are returned as explicit `missingEvidence` with positive follow-ups.

## Side-Effect Guard

Hydration and broker plans must not call:

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

