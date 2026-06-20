# Invest-Risiko Uebersetzungsstatus

## Scope

Issue #191 is implemented as a read-only, dossier-native status for `investment_risk_translation_status`.

The slice translates one GF slide, risk-register item, monthly report, or workshop anchor into an evidence status for investment/risk handover. It is not a new queue engine, document repository, AI pipeline, VDMI workflow, HITL task creator, Finance mutation, Investment Planning mutation, SAP/PSP writer, external connector, or cockpit UI.

## Read-Only Surface

- Moleculer action: `dashboard-api.investmentRiskTranslationStatus`
- REST route: `GET /api/dashboard/investment-risk-translation`
- Capability key: `investment_risk_translation_status`
- Hydration action: `dashboard-api.investmentRiskTranslationStatus`

## Evidence Contract

The status is based only on request/evidence fields:

- `sourceRef`, `sourceType`
- `period`, `division`
- `classification`
- `financialImpact`, `assetImpact`, `budgetRef`, `riskRef`
- `ownerRole`
- `decisionReadiness`
- `blockedDecisionId`
- `nextAction`
- `sourceSnapshot`
- `evidenceRefs`
- `forbiddenAssumptions`

Missing fields are returned as positive follow-ups instead of inferred facts.

## Side-Effect Guards

The read-only path reports these actions as not called:

- `vdmi.create`
- `vdmi-evidence.inject`
- `finance-agent.analyze`
- `investment-planning.createPlan`
- `hitl.create`
- `sap.psp.write`
- `sap.budget.write`
- `settlement.exportA96`
- `settlement.prepareBilling`
- `billing.release`
- `mako.dispatch`
- `external.connector.call`
- `personal-agent.execute`

## Dossier Consumption

The intended consumption path stays generic:

`Capability Broker -> dashboard-api.investmentRiskTranslationStatus -> Hydration Registry -> Slim Answer Dossier`

There is no Personal-Agent hardcoding and no one-off n8n branch.
