# Investment Owner Deadline Budget Gate

## Purpose

`investment_owner_deadline_budget_gate` is a read-only evidence gate for VNB/EVU investment measures. It connects measure identity, accountable owner, deadline, budget effect, required evidence, approval status, blocked follow-up decision and next escalation step into one dossier-safe status view.

## First Slice

- Dashboard action: `dashboard-api.investmentOwnerDeadlineBudgetGateStatus`
- REST endpoint: `GET /api/dashboard/investment-owner-deadline-budget-gate`
- Capability key: `investment_owner_deadline_budget_gate`
- Evidence registry: owner, deadline, budget effect, approval status, blocked follow-up decision, escalation step and provenance.
- Dossier hydration: slim answer-ready facts and missing-evidence follow-ups.

## Guards

The gate never approves budgets, creates bookings, mutates investment workflows, creates HITL items, triggers MaKo/A96/billing/settlement/tariff effects, calls external connectors or adds Personal-Agent shortcuts.

## Related

For a PSP/budget-cap overrun decision dossier (measure/PSP reference, cap, variance, cause/effect, risk of deferral) that reuses this same read-only pattern, see [investment-budget-cap-exception-governance.md](investment-budget-cap-exception-governance.md) (issue #518).
