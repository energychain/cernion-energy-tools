# Automation Risk Gate

## Ziel

Das Automation Risk Gate macht vor einer RPA- oder Bot-Umsetzung sichtbar, ob ein Prozess stabil, testbar, stoppbar, rueckrollbar, ueberwachbar und eindeutig verantwortet ist. Der erste Slice ist dossier-native und read-only.

## Datenvertrag

`dashboard-api.automationRiskGateStatus` bewertet ausschliesslich gelieferte Fakten:

- `processId`, `processName`, `processClass`, `runFrequency`, `massRunVolume`
- `affectedDomains`
- `customerCommunicationImpact`, `billingImpact`, `marketCommunicationImpact`, `massDataImpact`
- `testCaseCoverage`, `edgeCaseCatalog`, `acceptanceMethod`
- `monitoringSignals`, `stopCriteria`, `rollbackPath`
- `processOwner`, `operationsOwner`, `blockedDecision`, `riskLevel`, `sourceRef`

## Statuslogik

- `needs_process_context`: Prozess, Klasse oder Massenlauf-Kontext fehlt.
- `needs_process_owner`: Process Owner oder Operations Owner fehlt.
- `needs_test_coverage`: Testabdeckung fehlt oder ist nicht belastbar.
- `needs_edge_case_catalog`: Sonderfall-/Edge-Case-Katalog fehlt.
- `needs_stop_criteria`: Stop-Kriterien fehlen.
- `needs_rollback_path`: Rueckrollpfad fehlt.
- `needs_monitoring`: Monitoring-/Observability-Signale fehlen.
- `blocked_by_uncontrolled_mass_run`: Massenlauf oder kritische Kund:innen-, Billing-, MaKo- oder Massendatenwirkung ist ohne Stop-/Rollback-Evidenz nicht beherrschbar.
- `ready_for_automation_decision`: alle gelieferten Gate-Nachweise sind belastbar.

## Out of Scope

Keine RPA-Laufzeit, keine Bot-Orchestrierung, keine automatische Freigabe, kein Workflow-/HITL-/VDMI-Mutieren, keine Kund:innenkommunikation, keine Abrechnung, keine Marktkommunikation, keine externen Connectoren, keine Persistenz und kein Personal-Agent-Sonderweg.

## #251 Consumption Contract

Die Capability ist ueber `automation_risk_gate` im Capability Broker auffindbar, hat eine statische Hydration-Regel fuer `dashboard-api.automationRiskGateStatus` und formatiert nur schlanke Antwort-Evidenz: Status, Prozesskontext, Risikokontext, Gaps, Findings, positive Follow-ups und Side-Effect-Guards.
