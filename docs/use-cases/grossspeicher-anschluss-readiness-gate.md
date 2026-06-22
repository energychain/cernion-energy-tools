# Grossspeicher Anschluss Readiness Gate

## Ziel

Das Grossspeicher Anschluss Readiness Gate ist ein read-only Evidence- und Entscheidungsreife-Vertrag fuer Grossspeicher- und Flexibilitaetsfaelle. Es fuehrt gelieferte Fakten zu Speicher-Asset, Netzanschlusspunkt, fNAV-/Vertragsgrenze, Fahrplanannahme, Steuerbarkeit, Leitwartenuebergabe, Owner und Quelle in eine dossierfaehige Statusaussage zusammen.

Der erste Slice baut keine neue Anschlussplattform und kein Speicher-Backend. Er bewertet nur, ob ein Fall fuer eine Anschluss-, Vertrags- oder Fahrplanentscheidung reif ist oder welche Evidenz noch fehlt.

## Datenvertrag

Die read-only Action `dashboard-api.grossspeicherAnschlussReadinessGateStatus` akzeptiert unter anderem:

- `gridOperatorId`, `projectId`, `storageAssetId`, `location`
- `requestedCapacityKW`, `storageCapacityKWh`, `voltageLevel`
- `assetContextStatus`, `napMastrNummer`, `napEvidenceStatus`
- `connectionRequestStatus`, `formalRequestEvidence`
- `networkSignalPriority`, `gridSignalStatus`, `fnavProfile`, `contractBoundaryStatus`
- `scheduleRequirement`, `storageDispatchAssumption`, `scheduleEvidenceStatus`
- `controllabilityStatus`, `controlRoomHandoverStatus`
- `owner`, `nextDecision`, `source`, `sourceRef`, `missingEvidence`, `evidenceGaps`

## Statusmodell

- `unknown`: keine belastbare Bewertung aus gelieferten Fakten moeglich.
- `needs_asset_context`: Speicher-/Projektkontext fehlt.
- `needs_formal_request`: formaler Anschlussantrag oder Beleg fehlt.
- `needs_nap_evidence`: NAP-/MaStR-Anschlussnachweis fehlt.
- `needs_fnav_contract_boundary`: fNAV-Profil oder Vertragsgrenze fehlt.
- `needs_schedule_assumption`: Speicherfahrplan oder Dispatch-Annahme fehlt.
- `needs_controllability_proof`: Steuerbarkeits- oder Leitwartenachweis fehlt.
- `blocked_by_grid_signal`: ein geliefertes Netzsignal blockiert die naechste Entscheidung.
- `ready_for_connection_decision`: alle benoetigten gelieferten Nachweise sind vollstaendig.

## Evidenz und Follow-ups

Fehlende Datenpunkte werden als `evidenceGaps[]`, `positiveFollowUps[]` und `validationFindings[]` ausgegeben. Beispiele:

- `asset_context` -> Speicher-Asset und Projektkontext ergaenzen.
- `nap_evidence` -> NAP-/MaStR-Anschlussnachweis ergaenzen.
- `formal_request` -> formalen Anschlussantrag ergaenzen.
- `fnav_contract_boundary` -> fNAV-Profil und Vertragsgrenze ergaenzen.
- `schedule_assumption` -> Speicherfahrplan oder Dispatch-Annahme ergaenzen.
- `controllability_proof` -> Steuerbarkeits- und Leitwartennachweis ergaenzen.
- `owner_or_source` -> verantwortlichen Owner oder Quelle fuer die naechste Entscheidung ergaenzen.

## Wiederverwendung

Der Gate-Vertrag referenziert bestehende Cernion-Bausteine, ohne sie auszufuehren:

- `assets.storage` fuer Speicher-/Projektkontext
- `grid-connection.fnavValidate` und `grid-operations.netzfahrplanGenerate` fuer Anschluss-/fNAV-/Netzfahrplan-Kontext
- `forecast-engine.storageDispatch` und `forecast-engine.createSchedule` fuer Fahrplanannahmen
- `flex.listDevices` fuer Steuerbarkeitsbezug
- `vdmi.dossier` und `presentation.generate` fuer Owner-/Evidence-/Decision-Brief-Kontext
- Cookbook-Referenzen: `cybergrid-counter-location-scout` und `znp-flexible-nav-stresstest`

## Nicht-Ziele

- Keine neue Speicher-, Asset- oder Anschluss-Persistenz.
- Keine Dispatch-Optimierung oder Dispatch-Ausfuehrung.
- Keine Device-Control-, SMGW- oder CLS-Aktion.
- Keine fNAV-Vertragsentscheidung und keine Rechtsauslegung.
- Keine ZNP-, VDMI-, HITL-, Workflow-, Notification- oder Eskalationsmutation.
- Keine externen Connectoren, Billing-, Settlement-, Tarif- oder Marktseitenwirkung.
- Kein Personal-Agent-Hardcoding und kein n8n-Sonderpfad.

## Smoke-Pfad

Sichere Smoke-Checks nutzen ausschliesslich `GET /api/dashboard/grossspeicher-anschluss-readiness-gate`:

- Minimaler Fall mit nur `gridOperatorId` und `projectId` muss fehlende Evidenz melden.
- Vollstaendiger Fall mit Speicher-, NAP-, fNAV-, Fahrplan-, Steuerbarkeits-, Owner- und Source-Evidenz muss `ready_for_connection_decision` liefern.
- Blockiertes Netzsignal muss `blocked_by_grid_signal` liefern und in `sourceActions.notCalled` dokumentieren, dass keine konsequente Aktion ausgefuehrt wurde.
