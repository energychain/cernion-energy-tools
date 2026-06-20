# iMSys Fahrplan Value Chain

## Ziel

Die `imsys_schedule_value_chain_readiness`-Sicht uebersetzt iMSys-/CLS-Messdaten in eine dossierfaehige Fahrplan- und Uebergabebewertung. Sie zeigt, ob Messdaten, Prognose, Engpasssignal, Asset-/Flex-Mapping, Netzfahrplan-Bewertung, operative Entscheidung und Leitwartenuebergabe ausreichend belegt sind, damit ein VNB den naechsten Review starten kann.

## Nicht-Ziele

- Keine iMSys-/CLS-Plattform.
- Keine SMGW-, CLS-, Device-Control- oder Leitwarten-Ausfuehrung.
- Kein neuer Forecast-, Datapoint- oder Grid-Control-Kern.
- Keine MaKo-, Billing-, Settlement-, Tarif-, HITL- oder externe Connector-Mutation.
- Kein Personal-Agent-Sonderweg und kein breites Cockpit.

## Datenvertrag

Die erste Slice ist read-only und wird ueber `dashboard-api.imsysScheduleValueChainReadinessStatus` sowie `GET /api/dashboard/imsys-schedule-value-chain-readiness` bereitgestellt.

Kernfelder:

- `caseId`, `gridOperatorId`, `meteringScope`
- `sourceDatapoints`, `dataQualityStatus`
- `forecastWindow`, `congestionSignal`
- `assetScope`, `controllabilityStatus`, `flexibilityOptions`
- `netzfahrplanAssessmentRef`, `operationalDecision`
- `controlReadiness`, `lineOwnerRole`
- `sourceSnapshotRef`, `evidenceRef`

## Value-Chain-Stufen

1. Messbereich und Datenquellen belegen.
2. Datenqualitaet und Prognosefenster bewerten.
3. Engpasssignal und Netzfahrplan-Bezug herstellen.
4. Asset-Scope, Steuerbarkeitsstatus und Flex-Optionen pruefen.
5. Operative Entscheidung und Leitwartenuebergabe als Review-Grenze ausweisen.

## Evidence Requirements

Die Evidence Registry fuehrt `imsys_schedule_value_chain_readiness` als eigenen Schluessel. Fehlende Evidenz wird als positive Follow-up-Mapping ausgegeben, damit das Answer Dossier ergaenzen kann, was nach Eingang der Daten zusaetzlich belegbar wird.

## Side-Effect Guards

Die Antwort enthaelt `sourceActions.notCalled` fuer Device-/CLS-/SMGW-Control, Grid-Control, HITL, MaKo, Billing, Settlement, externe Connectoren und Personal-Agent-Ausfuehrung. Damit bleibt die Sicht als #251-konformer read-only Evidence Gate konsumierbar.
