# Investment Budget Cap Exception Governance

## Scope

`investment_budget_cap_exception_governance` is a read-only evidence slice for investment measures that exceed a supplied budget cap or still lack a committee-ready exception justification.

The slice is designed for Stadtwerk/VNB investment governance where technical need, no-regret rationale, KPI reference, asset context, owner, deadline and the next decision gate must stay auditable without turning Cernion into a finance or approval system of record.

## Boundary

In scope:

- `dashboard-api.investmentBudgetCapExceptionGovernanceStatus`
- `GET /api/dashboard/investment-budget-cap-exception-governance`
- Capability Broker routing for Budgetdeckel, Deckel-Ausnahme, No-Regret, KPI-Begruendung and Gremienpfad intents
- Evidence Registry and Answer Dossier Hydration Registry consumption
- Positive follow-ups for missing evidence

Out of scope:

- Budget approval or committee decision
- SAP, ERP or PSP writes
- Finance/accounting bookings
- HITL/workflow or communication creation
- MaKo, billing, settlement, tariff, device-control or external connector mutation
- Personal-Agent hardcoding

## Dossier Result

The endpoint returns status, budget cap, required budget, delta above cap, exception justification status, missing evidence, positive follow-ups and explicit `sourceActions.notCalled` guards. Complete evidence yields `exception_evidence_ready`; incomplete evidence yields a focused `needs_*` status.
