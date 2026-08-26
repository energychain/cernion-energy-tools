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

## Issue #518 Crosswalk: PSP-Budgetueberschreitung Entscheidungsakte

Issue #518 asks for a versioned, read-only decision-evidence dossier for a PSP (Projektstrukturplan/SAP) budget-cap overrun: measure/PSP reference, budget status/cap/variance, cause/effect, risk of deferral, missing evidence, owner, committee/approval readiness and the next safe human gate. No new contract is introduced — every concept below is already served by the existing action and route documented above.

| #518 dossier concept | Field(s) on this contract |
|---|---|
| Measure / PSP reference | `governanceContext.measureId`, `governanceContext.measureName`, `governanceContext.scope` (a PSP element id is passed as a caller-supplied string, e.g. `measureId=psp:4711` or `evidenceRefs=psp:4711`; there is no dedicated `pspElementId` field on this contract — see [sap-budget-psp-gate.md](sap-budget-psp-gate.md) for a contract with a first-class `pspElementId` param) |
| Budget status / cap / variance | `status`, `governanceContext.budgetCapEur`, `governanceContext.requiredBudgetEur`, `budgetDeltaEur`, `governanceContext.aboveCap` |
| Cause (why the cap is exceeded) | `governanceContext.technicalJustification`, `governanceContext.regulatoryContext`, `governanceContext.noRegretCriterion`, `governanceContext.kpiReference` |
| Effect / risk of deferral | `governanceContext.riskIfDeferred` |
| Missing evidence | `missingEvidence[]` (each entry names a `missingDataPoint` and the follow-up it enables), `positiveFollowUps[]` |
| Owner / next safe human gate | `governanceContext.owner`, `governanceContext.deadline`, `governanceContext.nextDecisionGate` |
| Committee / approval readiness | `exceptionJustificationStatus` (`blocked` / `draft` / `evidence_ready`), `readinessScore`, `governanceContext.exceptionJustification` |
| Explicit non-decision | `decisionBoundary` (`budgetApproved`, `committeeDecisionCreated`, `productionMutation` — all always `false`), `governanceContext.budgetApproved`, `governanceContext.committeeDecisionCreated`, `governanceContext.erpWritten`, `governanceContext.hitlCreated`, `governanceContext.externalConnectorCalled` (all always `false`) |

"Versioned" in the issue means each request is a point-in-time, caller-supplied snapshot identified by `investmentBudgetCapExceptionGovernanceStatusId` (a deterministic hash of measure/owner/next-gate) — not a persisted revision history. See the provenance caveats below.

## Source-class and provenance caveats

- This route is an **aggregator contract, not a system of record**. It derives `status`, `budgetDeltaEur`, `readinessScore` and `exceptionJustificationStatus` only from the query parameters a caller supplies; it does not read SAP, an ERP, a PSP store or any investment-planning database.
- Every field under `governanceContext` is a **caller-supplied fact**, not a fact this platform observed, fetched or independently verified. `evidenceRefs` and `sourceDatapoints` name where a human says supporting evidence lives; the route does not fetch, parse or validate that evidence.
- There is no freshness guarantee beyond the request itself. Two calls with different parameter values for the same `measureId` return different derived status; neither call re-reads a prior snapshot. Callers are responsible for supplying the current PSP/budget figures.
- **Missing evidence produces a `needs_*` clarification status, never a negative or approval-adjacent conclusion.** An absent `owner`/`deadline`/`nextDecisionGate` renders as `needs_governance_gate`, not "measure has no owner" or "measure was rejected."

## Synthetic operator walkthrough

The following example is **explicitly synthetic**. It names no real measure, PSP element, Stadtwerk, VNB or person; any resemblance is coincidental and unintended.

An investment-governance reviewer checks a PSP budget overrun before a committee session:

```
GET /api/dashboard/investment-budget-cap-exception-governance
  ?measureId=psp:synthetic-4711
  &measureName=Beispielhafte%20UW-Ertuechtigung%20(synthetisch)
  &scope=mittelspannung
  &budgetCapEur=1000000
  &requiredBudgetEur=1250000
  &noRegretCriterion=supply-security
  &technicalJustification=load-growth
  &kpiReference=saidi-risk
  &division=strom
  &dataQuality=reviewed
  &evidenceRefs=psp:synthetic-4711,kpi:saidi
  &riskIfDeferred=redispatch-cost-increase
```

With `owner`, `deadline` and `nextDecisionGate` left unset, the response reports `status: "needs_governance_gate"`, computes `budgetDeltaEur: 250000` and `governanceContext.aboveCap: true`, and lists `owner_deadline_missing` and `exception_justification_missing` in `missingEvidence` — each paired with the follow-up it enables (e.g. "add accountable owner, due date, and next decision gate"). `decisionBoundary.budgetApproved`, `.committeeDecisionCreated` and `.productionMutation` are all `false`, and `sourceActions.notCalled` lists `investment.approve`, `sap.psp.write`, `erp.write`, `committee.createDecision` and the other guarded actions explicitly. The dossier is committee-ready evidence for "is this PSP overrun explained and who must decide next" — it is not a committee decision.

A caller integrating a real PSP budget-cap review must supply its own real measure/PSP identifiers; this walkthrough defines the read pattern, not example data to reuse verbatim.

## No-call / no-write boundaries

This route, and this document, do not:

- write, approve or release an investment budget;
- create, approve or record a committee decision;
- write to SAP, an ERP or a PSP system;
- create a finance/accounting booking or journal entry;
- create a HITL item, workflow task, or send email/webhook/notification;
- touch MaKo, billing, settlement, tariff, dispatch or device-control state;
- call an external connector;
- persist or cache-write beyond the existing route-level TTL cache;
- add Personal-Agent hardcoding, private routing or agent-specific behavior;
- deploy to or otherwise touch production systems;
- cover issue #252 scope.

## Positive human follow-ups

Missing evidence maps to an actionable next step for a human, not a dead end — see `missingEvidence[].enablesDossierAddition` and `positiveFollowUps[]`, e.g. missing `evidenceRefs` enables "add audit-ready evidence references," and missing owner/deadline/next-gate evidence enables assigning the accountable reviewer and scheduling the next committee session.

## Safety class

`read_only_evidence_dossier_documentation`, non-consequential. Matches the existing `safety: 'read_only'` field on every response and the `decisionBoundary`/`sourceActions.notCalled` guards already returned by the action.
