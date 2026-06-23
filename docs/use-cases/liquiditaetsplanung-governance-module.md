# Liquiditaetsplanung Governance Module

## Ziel

Das `liquidity_planning_governance_module` beschreibt kurzfristige Liquiditaets-, Zins- und Cash-Pool-Planungen als belegbare Governance-Sicht. Es macht Quellenregister, Dictionary-Versionen, SAP-/Controlling-/TMS-Quellen, Umsatzsteuerlogik, Cash-Pool-Referenzen, Szenarioannahmen, Validierungsregeln, Owner/RACI, Korrekturworkflow und Review-Status dossierfaehig.

## Nicht-Ziele

- keine Treasury-, Cashflow-, Zins-, VAT-, Billing-, Settlement-, Tarif-, Contract- oder EOG-Rechenengine
- keine SAP-, TMS-, Cash-Pool- oder externe Connector-Ausfuehrung
- keine Zahlung, Freigabe, HITL-Anlage, Finanzkommunikation oder Produktionsmutation
- keine Personal-Agent-Sonderlogik und kein n8n-Sonderzweig

## Erster Slice

Der erste Slice liefert `dashboard-api.liquidityPlanningGovernanceStatus` und `GET /api/dashboard/liquidity-planning-governance`. Die Aktion ist read-only und normalisiert nur request-provided evidence in Status, Readiness, Missing Evidence, Risk Flags, positive Follow-ups und Slim-Dossier-Evidence.

## Evidenzvertrag

Wichtige Felder:

- `planningRunId`, `planningHorizon`
- `sourceRegister`, `dictionaryVersion`
- `sapAccountSources`, `controllingSourceIds`, `loanTmsSourceIds`
- `vatLogicRef`, `cashPoolSettlementRef`
- `scenarioAssumptions`, `validationRules`, `plausibilityChecks`
- `ownerRaci`, `correctionWorkflow`, `approvalStatus`
- `liquidityRiskFlags`, `interestRiskFlags`, `investmentLinkRefs`
- `sourceDatapoints`, `sourceActions`

Fehlende Evidenz erzeugt positive Follow-ups. `approvalStatus` ist nur ein Evidenzstatus und keine automatische Freigabe.

## Dossier- und Broker-Anbindung

Capability Broker routet Liquiditaetsplanung, Cash Planning, Cash Pool, Zinsplanung, SAP-Sachkonto, TMS-Darlehen, Umsatzsteuerlogik, Plausibilitaetscheck, Szenarioannahme, Korrekturworkflow und Finance-Quellenregister auf die read-only Dashboard-Aktion. Evidence Registry und Hydration Registry nutzen `liquidity_planning_governance_module` fuer dossierfaehige Folgefragen.
