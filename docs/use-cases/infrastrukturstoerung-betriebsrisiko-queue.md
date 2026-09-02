# Infrastrukturstoerung Betriebsrisiko-Queue

## Zweck und Betreiberfrage

Rechenzentrums-, Standort-, Leitungs- oder Terminalstoerungen werden bei EVUs/VNB haeufig als reine IT-Meldung gefuehrt, obwohl Fachprozesse, Fallbackwege, Nachbuchungen, Dienstleisterstatus und Betriebsrisiko betroffen sind (Issue #527). Ohne fachliche Nachhaltequeue bleiben Prozesswirkung und Abschlussnachweis unklar. Die Betreiberfrage lautet: *"Welcher Fachprozess ist von dieser synthetischen Infrastrukturstoerung betroffen, welche Fallback-/Nachweis-Luecke besteht, wer ist Owner, und welches sichere Entstoerungs- oder Abschluss-Gate folgt — bevor irgendeine Entwarnung oder ein Abschluss ausgesprochen wird?"*

Dieser Cut fuehrt **keine neue Incident-, ITSM-, Monitoring- oder Ticket-Plattform** ein. Er ist eine **read-only Budibase-Workbench-Projektion** (`read_only_workbench_projection`) fuer `ROLE_GRID_OPERATIONS_LEAD`, die ausschliesslich sechs bereits vorhandene `GET /api/dashboard/*` Bricks fuer genau drei explizit synthetische Stoerungsfaelle komponiert.

Datenklassen: Alle Fall-, System-, Prozess- und Dienstleisterlabels sind explizit synthetisch (`synthetic_tenant_seed`). Es werden keine realen Rechenzentren, Standorte, Leitungen, Terminals, Dienstleister oder Kundendaten benannt.

## Sechs wiederverwendete Bricks

Kein neuer Service, keine neue Route, keine neue Persistenz. Die Betriebsrisiko-Queue komponiert ausschliesslich bestehende read-only Actions:

| Brick | Action | Route |
| --- | --- | --- |
| Kommunikations-/Prozessrisiko Gate | `dashboard-api.communicationBreakProcessRiskStatus` | `GET /api/dashboard/communication-break-process-risk` |
| Cross-Channel VNB Signal Queue | `dashboard-api.crossChannelVnbSignalQueueStatus` | `GET /api/dashboard/cross-channel-vnb-signal-queue` |
| Monitoring Nicht-Eskalation | `dashboard-api.monitoringNonEscalationStatus` | `GET /api/dashboard/monitoring-non-escalation` |
| Evidence Freshness Guard | `dashboard-api.evidenceFreshnessGuardStatus` | `GET /api/dashboard/evidence-freshness-guard` |
| Automation Risk Gate | `dashboard-api.automationRiskGateStatus` | `GET /api/dashboard/automation-risk-gate` |
| Owner-Frist-Evidenz Gate | `dashboard-api.ownerDeadlineEvidenceGateStatus` | `GET /api/dashboard/owner-deadline-evidence-gate` |

Jeder Brick bleibt eigenstaendig aufrufbar; die Queue ist eine **Rendering-Komposition** im Budibase-Manifest (`integrations/budibase/manifests/stadtwerk-mauer-workbench.json`, `infrastructure_disruption_operating_risk_*` Sections), kein neuer aggregierender Endpoint.

## Feld-zu-Brick Mapping

| Betriebsrisiko-Feld (Issue #527) | Brick | Felder auf dem bestehenden Contract |
| --- | --- | --- |
| Fall/Stoerungsart, betroffener Fachprozess, blockierte Entscheidung, naechster Evidenzpunkt, Eskalations-/Rueckzugskriterium, Owner/Vertretung | `communication-break-process-risk` | `process.processDomain`, `process.affectedDecision`, `process.blockedDecision`, `process.nextEvidencePoint`, `governanceContext.escalationCriterion`, `ownerContext.owner`, `ownerContext.deputy`, `missingEvidence[]`, `positiveFollowUps[]` |
| Fallback-/Evidenzreferenz, synthetischer Dienstleister-/Systemstatus, Kommunikations-/Dedupe-Status, Owner/Faelligkeit | `cross-channel-vnb-signal-queue` | `normalizedSignals[].evidenceRefs`, `normalizedSignals[].evidenceStatus`, `normalizedSignals[].sourceSystem`, `normalizedSignals[].channel`, `normalizedSignals[].dedupeKey`, `queueStatus`, `missingEvidence[]` |
| Geprueftes Monitoring, Neuheit, dokumentiert abwesender Blocker | `monitoring-non-escalation` | `checkedSource.sourceName`, `signal.novelty`/`novelty`, `absentBlocker.classification`, `missingEvidence[]` |
| Evidenz-Aktualitaet/Delta-Status, Eskalationsempfehlung, fehlende Evidenz | `evidence-freshness-guard` | `freshnessState`, `deltaState`, `escalationRecommended`, `evidenceGaps[]`/`missingEvidence[]`, `positiveFollowUps[]` |
| Naechstes sicheres Entstoerungs-/Abschluss-Gate, Stopp-/Rollback-Kriterium | `automation-risk-gate` | `riskContext.riskLevel`, `readinessSignals[]` (Codes `stop_criteria`, `rollback_path`), `missingEvidence[]`/`evidenceGaps[]` |
| Owner & Frist (Klaerung), blockierte Entscheidung | `owner-deadline-evidence-gate` | `ownerContext.ownerRole`, `ownerContext.dueAt`, `signalContext.blockedDecision`, `missingEvidence[]`/`evidenceGaps[]`, `positiveFollowUps[]` |

## Genau drei synthetische Stoerungsfaelle

Der Selector (`getInfrastructureDisruptionOperatingRiskSelectorRows`) rendert exakt drei explizit synthetische Faelle mit unterschiedlichem Evidenz-Zustand; ein vierter Fall wird nie synthetisiert und die Auswahl ist reiner Renderer-/Query-State (keine Persistenz):

1. `smm-incident-datacenter-communication-001` — Rechenzentrums-Stoerung, Evidenz-Zustand `communication_process_impact_gap` (Kommunikations-/Prozesswirkungs-Luecke).
2. `smm-incident-field-terminal-fallback-002` — Standort-/Terminalstoerung Aussendienst, Evidenz-Zustand `fallback_evidence_review` (Fallback-Evidenz-Review) — **default-selected**; alle sechs Detail-Queries binden konsistent an diesen Fall.
3. `smm-incident-service-provider-delay-003` — Leitungsstoerung Ersatzstandort/Dienstleister-Entstoerung, Evidenz-Zustand `stale_provider_completion_evidence` (veraltete Dienstleister-Abschlussevidenz).

Fehlende oder veraltete Evidenz wird in jedem Brick ausschliesslich als `clarification`/`human_review_required` mit einer positiven Folgeaktion abgebildet — nie als abgeleitete reale Stoerung, Dienstleisterausfall, Wiederherstellung oder automatische Eskalation/Abschluss.

## Erlaubte Interaktionen

Der `infrastructure_disruption_operating_risk_interactions` Abschnitt rendert genau vier erlaubte, nicht-konsequentielle Interaktionsklassen:

- `select_synthetic_case` — einen der drei synthetischen Faelle auswaehlen;
- `refresh_read_models` — die sechs read-only Lesemodelle aktualisieren;
- `inspect_fallback_evidence` — Fallback-/Evidenzreferenz des ausgewaehlten Falls pruefen;
- `open_owner_clarification` — nur Anzeige-/Navigationshinweis auf die Owner-Klaerung, keine Task-/Ticket-Erstellung.

## Positive Follow-ups

Fehlende Datenpunkte fuehren ausschliesslich zu **refresh/inspect/clarify** Folgeaktionen fuer Menschen, niemals zu einer automatisierten Aktion:

- fehlende Prozesswirkungs-/Kommunikationsevidenz -> synthetischen Prozesswirkungs-Nachweis liefern/pruefen, dann aktualisieren;
- fehlende Fallback-Evidenz -> zustaendige Betriebsrolle klaert die Evidenzreferenz, dann aktualisieren;
- veraltete Dienstleister-/Abschlussevidenz -> aktuelleren synthetischen Status-/Evidenzverweis einholen, dann Abschluss-Gate pruefen;
- fehlender Owner/Frist -> Tenant-Rolle und Faelligkeitsdatum zuordnen, bevor irgendeine spaetere Eskalationsentscheidung getroffen wird.

Jeder `positiveFollowUps[]`/`missingEvidence[].enablesDossierAddition` Eintrag ist bereits Teil des jeweiligen Bricks; die Queue fuegt keinen neuen Aktionstyp hinzu.

## No-call / No-write boundary

Diese Queue, und dieses Dokument, loesen keine der folgenden Aktionen aus:

- keine Incident-, Ticket- oder Task-Erstellung;
- kein Pager-/Alerting-Eskalationsversand;
- keine Owner-Zuweisung;
- kein Dienstleister-Anruf oder externer Connector-Aufruf;
- kein Mail-/Webhook-Versand;
- keine Workflow-, HITL- oder direkte Log-Zugriffsaktion;
- keine Monitoring-Mutation;
- keine beliebige Budibase-Tabellenschreibung;
- keine direkte Rundeck-Ausfuehrung;
- keine MaKo-, Billing-, Settlement-, Tarif-, Dispatch- oder Device-Control-Aktion;
- keine Produktionsmutation.

Der `infrastructure_disruption_operating_risk_no_call` Abschnitt rendert diese Grenzen zusammen mit dem `sourceActions.notCalled`-Array des jeweiligen Bricks als disabled `not_called` Zeilen.

## Personal Agent, Capability Broker, Hydration Registry, Formatter

Kein Impact:

- **Personal Agent**: kein Hardcoding, kein Persona-/Session-Routing, keine Aenderung an `services/personal-agent.service.js`.
- **Capability Broker**: keine neue Route; bestehendes Routing der sechs referenzierten Capabilities bleibt unveraendert.
- **Hydration Registry**: keine neue Formatter-Regel; bestehende Dossier-Hydration der sechs Bricks bleibt unveraendert.
- **Formatter/Sidecar**: keine Aenderung.
- **Demo-Raum Matrix Sync**: nicht anwendbar auf dieses interne Panel; kein Blueprint-Pack-Seed, `demoProcessMatrix`, Landing-Registry-Eintrag oder Produktivseite wird eingefuehrt.

## Safety-Klasse

`read_only_workbench_projection` — nicht-konsequentiell. Passt zum bestehenden `safety: 'read_only'` Feld und den `sourceActions.notCalled`/Boundary-Guards, die jeder der sechs referenzierten Bricks bereits zurueckgibt. Fehlende oder veraltete Evidenz blockiert jede Fortschrittsaussage und erzeugt ausschliesslich deskriptive Folgeaktionen (refresh/inspect/clarify), nie eine automatisierte Entwarnung oder einen automatisierten Abschluss.
