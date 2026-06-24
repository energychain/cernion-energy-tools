# Gasnetztransformation VDMI Asset Cockpit

## Ziel

Die erste #200-Produktstufe ist eine read-only Evidenz- und Statussicht fuer Gasnetztransformation. Sie macht Transformationsprogramme, Arbeitspakete, Assetsegmente, H2-/Stilllegungs-/Umwidmungsoptionen, Rueckbaukosten, Cashflow-/TOTEX-Wirkung, Waerme-/Stromnetz-/Kundenabhaengigkeiten, Entscheidungsgates und Owner dossier-faehig sichtbar.

## Nicht-Ziele

- keine neue Gasnetz-Assetdatenbank, kein Gaszielnetz-Optimizer und kein neues Graphmodell
- keine H2-Feasibility-Engine und keine rechtliche, regulatorische oder buchhalterische Ausfuehrung
- keine Billing-, Settlement-, MaKo-, Tarif- oder Produktionsmutation
- keine HITL-/VDMI-Mutation, kein externer Connector und kein Personal-Agent-Sonderweg
- kein breites Cockpit-UI in der ersten Stufe

## Datenvertrag

`dashboard-api.gasGridTransformationAssetCockpitStatus` nimmt explizite, caller-gelieferte Evidenzparameter entgegen:

- `gridOperatorId`, `transformationProgramId`, `workPackageId`
- `assetSegmentRef`, `targetOption`
- `technicalReuseStatus`
- `decommissioningCostEur`, `rollbackOrRemovalRisk`
- `cashflowImpact`, `totexImpact`, `regulatoryRecognitionStatus`
- `heatNetworkDependency`, `powerGridDependency`, `customerTransitionDependency`
- `decisionGate`, `ownerRole`
- optionale Referenzen wie `vdmiProcessId`, `investmentPlanId`, `financeAnalysisId`, `sourceDatapoints`, `sourceActions`

Die Ausgabe ist `gas_grid_transformation_asset_cockpit` mit `status`, `readinessScore`, `programSummary`, `evidenceGroups`, `missingEvidence`, `positiveFollowUps`, `nextActions`, `sourceActions.notCalled` und `dossierEvidence`.

## Statuslogik

Die Sicht erzeugt deterministisch einen der folgenden Zustaende:

- `ready_for_committee`
- `needs_program_identity`
- `needs_asset_scope`
- `needs_target_option`
- `needs_h2_assessment`
- `needs_decommissioning_cost`
- `needs_finance_review`
- `needs_dependency_review`
- `needs_decision_gate`
- `needs_source_evidence`

Fehlende Evidenz wird als positives Follow-up formuliert. Die Sicht erfindet keine Freigabe und wertet Annahmen nicht als produktive Entscheidung.

## Wiederverwendung

Die Capability referenziert vorhandene Cernion-Flaechen als Kontext: `datasource-registry.get`, `datapoint.health`, `investment-planning.createPlan`, `finance-agent.analyze`, `znp.assessPortfolio`, `assets.all`, `gas-storage.countryStorage`, `vdmi.dossier` und `presentation.generate`. Diese Aktionen werden in der read-only Statussicht nicht automatisch ausgefuehrt; sie dokumentieren die anschlussfaehigen Evidenzquellen.

## Dossier-Pfad

Der Capability Broker routet Gasnetztransformation-, H2-, Stilllegungs-, Rueckbaukosten- und Asset-Cockpit-Fragen auf `dashboard-api.gasGridTransformationAssetCockpitStatus`. Die Hydration Registry darf nur diese read-only Aktion aufrufen und formatiert daraus schlanke Dossier-Fakten. Personal Agent und n8n brauchen keine harte Sonderroute.

## Seiteneffekt-Grenze

Die Antwort weist explizit aus, dass keine Gasasset-Mutation, kein Zielnetz-Optimizer, keine H2-Ausfuehrung, keine Investment- oder Finance-Freigabe, keine HITL-/VDMI-Mutation, keine Billing-/Settlement-/Tarif-/MaKo-Aktion, kein externer Connector und keine Personal-Agent-Ausfuehrung stattgefunden hat.
