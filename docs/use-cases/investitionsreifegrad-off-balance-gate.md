# Investitionsreifegrad Off-Balance Gate

Issue #246 defines a dossier-consumable gate for investment and external-financing readiness. The gate connects investment maturity, process quality, financing-cost transparency, regulatory-return hypotheses, asset-risk reference, ISO/risk-control traceability, and the responsible decision forum.

## Purpose

- Make an investment case auditable before it is discussed as off-balance or externally financed.
- Separate observed evidence from hypotheses.
- Show whether external financing creates real grid headroom or only shifts valuation and balance-sheet assumptions.
- Produce slim Answer Dossier evidence through the standard Capability Broker and Hydration Registry path.

## Non-Goals

- No financing approval.
- No accounting write or off-balance legal determination.
- No investment-plan mutation.
- No HITL approval creation from hydration.
- No settlement, billing, MaKo, dispatch, or control-command execution.
- No parallel finance engine or cockpit.

## Data Contract

`investment-maturity-off-balance-gate.evaluate` accepts:

- `investmentCaseId`
- `assetScope`
- `maturityLevel`
- `processQualityScore`
- `offBalanceStructure`
- `additionalFinancingCostEur`
- `regulatoryReturnHypothesis`
- `assetRiskReference`
- `isoRiskReference`
- `decisionForum`
- optional `decisionFrameId`, `financeAnalysisId`, `investmentPlanId`
- `sourceActions`
- `evidence[]`

`investment-maturity-off-balance-gate.getStatus` is read-only and dossier-safe. It returns the latest tenant-scoped evidence by `investmentCaseId` or a specific `gateId`.

## Re-Use Relationship

- `investment-planning.*` remains the plan/source-of-measures system.
- `finance-agent.analyze` remains the finance evidence and hypothesis source.
- `decision-frame.*` remains the decision container.
- `vdmi-evidence.*` and `vdmi-findings.*` remain role, evidence and forbidden-assumption sources.
- `hitl.create` remains consequential workflow outside automatic hydration.
- `presentation.generate` can render a decision brief after evidence is available.

## Example

A grid reinforcement investment can be marked `ready_with_warnings` when maturity, process quality, financing cost, asset risk, and decision forum are present but the regulatory-return basis is still a hypothesis. The dossier may show the missing return-evidence follow-up; it must not classify the structure as legally off-balance.
