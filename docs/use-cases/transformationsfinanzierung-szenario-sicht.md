# Transformationsfinanzierung Szenario Sicht

## Ziel

Die Sicht buendelt Cashflow-, Rueckbau-, Waerme-/H2-, kommunale Last-, EOG-, Liquiditaets- und Stressannahmen zu einem dossier-faehigen Entscheidungsbild fuer VNB-/Stadtwerke-Management. Sie ist ein read-only Evidence Gate, keine Treasury-, Accounting-, Gasnetz- oder Billing-Engine.

## Nicht-Ziele

- keine Buchung, Zahlung, Bilanzierung oder Treasury-Transaktion
- keine Billing-, Settlement-, Tarif-, A96- oder MaKo-Ausgabe
- keine Gasasset-Stilllegung, Asset-MDM-Mutation oder Investment-Freigabe
- keine HITL-/VDMI-Mutation und kein externer Connector
- keine verbindliche Rechts- oder Regulierungsinterpretation
- kein Personal-Agent-Sonderweg

## Datenvertrag

`dashboard-api.transformationFinancingScenarioViewStatus` nimmt explizite Szenario- und Evidenzparameter entgegen:

- `scenarioId`, `gridOperatorId`, `planningHorizon`, `scenarioType`
- `cashflowSource` oder `cashflowSourceRef`
- `marginCompensationAssumption`, `capitalReallocationOption`
- `gasDecommissioningPath`, `rollbackCostBasis`
- `heatInvestmentMeasure`, `h2OptionMeasure`
- `municipalBurdenAssumption`, `publicTransportShareholderBurden`
- `operationalInvestmentNeed`
- `eogImpact` oder `regulatoryImpactAssumption`
- `liquidityImpact`, `stressThreshold`
- `committeeDecisionGate`, `owner`, `vdmiProcessId`
- `sourceDatapoints`, `sourceActions`

Die Antwort enthaelt `scenarioSummary`, `decisionReadiness`, `evidenceGroups`, `missingEvidence`, `positiveFollowUps`, `nextActions`, `sourceDatapoints`, `sourceActions` und `dossierEvidence`.

## Readiness

- `ready_for_decision`: alle Pflichtnachweise liegen als Quelle oder Annahme vor.
- `needs_scenario_identity`: Szenario-ID, Netzbetreiber, Horizont oder Typ fehlt.
- `needs_cashflow_source`: Cashflow-Quelle fehlt.
- `needs_rollback_cost_basis`: Rueckbau-/Removal-Kostenbasis fehlt.
- `needs_municipal_burden_basis`: kommunale, OePNV- oder Gesellschafterlast fehlt.
- `needs_regulatory_assessment`: EOG-/Regulierungsannahme fehlt.
- `needs_liquidity_assumption`: Liquiditaetsannahme fehlt.
- `blocked_by_missing_threshold`: Stressschwelle fehlt.
- `needs_committee_gate`: Gremiengate oder Owner fehlt.

## #251 Verbrauchspfad

Der Capability Broker routet Transformationsfinanzierungsfragen auf `dashboard-api.transformationFinancingScenarioViewStatus`. Die Hydration Registry darf nur diese read-only Aktion aufrufen und formatiert daraus ein schlankes Dossier. Personal Agent und n8n brauchen keine harte Sonderroute.

## Beispiel unvollstaendig

Nur `scenarioId`, `gridOperatorId`, `planningHorizon` und `cashflowSource` sind vorhanden. Das Ergebnis bleibt read-only, meldet `needs_rollback_cost_basis` oder eine spaetere fuehrende Luecke und gibt positive Follow-ups fuer Rueckbaukosten, kommunale Lasten, EOG, Liquiditaet, Stressschwelle und Gremiengate aus.

## Beispiel entscheidungsreif

Ein vollstaendiges Szenario enthaelt Cashflow-Quelle, Rueckbaukostenbasis, Waerme-/H2-Option, kommunale Last, operative Investition, EOG-/Regulierungsannahme, Liquiditaet, Stressschwelle, Gremiengate, Owner und Quellen. Das Ergebnis ist `ready_for_decision`, ohne Buchung, Gasasset-Mutation, HITL, Billing, Settlement, Tarif, MaKo oder externen Connector auszufuehren.
