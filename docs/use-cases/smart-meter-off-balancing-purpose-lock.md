# Smart-Meter Off-Balancing Purpose Lock

## Ziel

`smart_meter_off_balancing_purpose_lock` ist ein read-only Evidenzgate fuer VNB-/EVU-Entscheidungen, bei denen Smart-Meter-Assets extern finanziert oder off-balance gestellt werden. Der Gate-Wert liegt nicht in der Bilanzoptik selbst, sondern in der Frage, ob freiwerdende Liquiditaet nachweisbar in Steuerbarkeit, Leitwarte, Prozesse und Netzinfrastruktur fliesst.

## Nicht-Ziele

- Kein Finanzierungsprodukt, keine Accounting-/Legal-/Regulierungsentscheidung.
- Keine SAP-, Finance-, Investment-, Billing-, Settlement- oder MaKo-Mutation.
- Keine HITL-Erzeugung, keine externe Verbindung und keine Secret-/Key-Verarbeitung.
- Kein Personal-Agent-Sonderweg und kein breites Cockpit.

## Datenvertrag

Der erste Slice wird ueber `dashboard-api.smartMeterOffBalancingPurposeLockStatus` und `GET /api/dashboard/smart-meter-off-balancing-purpose-lock` bereitgestellt. Wichtige Felder:

- `caseId`, `gridOperatorId`, `assetScope`, `financingModel`
- `offBalanceVolumeEur`, `freedLiquidityEur`, `financierCostEur`
- `capexOpexTotexEffect`, `regulatoryRecognitionStatus`, `financeReviewStatus`
- `purposeLockedMeasures`, `controlRoomInvestments`, `processInvestments`, `gridInfrastructureInvestments`
- `budgetDilutionRisk`, `sourceSnapshotRef`, `evidenceRef`

## Bewertungslogik

Ein Fall ist nur `ready_for_committee_review`, wenn Zweckbindung, operativer Investitionseffekt, regulatorische Evidenz, Finance Review, Anti-Dilution-Guard und Quellenbelege vorhanden sind. Fehlende Evidenz erzeugt positive Follow-ups statt Scheinsicherheit.

Typische Statuswerte:

- `needs_purpose_lock`
- `needs_regulatory_evidence`
- `needs_finance_review`
- `budget_dilution_risk`
- `needs_investment_effect`
- `ready_for_committee_review`

## Side-Effect Guards

Die Capability darf nur read-only konsumiert werden. Dossier-Hydration und Smoke-Tests pruefen, dass unter anderem diese Aktionen nicht aufgerufen werden:

- `finance-agent.mutate`
- `sap.psp.write`
- `investment-planning.createPlan`
- `billing.release`
- `settlement.prepareBilling`
- `mako.dispatch`
- `hitl.create`
- `external.connector.call`
- `personal-agent.execute`
