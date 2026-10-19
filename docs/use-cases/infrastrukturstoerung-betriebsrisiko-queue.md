# Infrastrukturstoerung Betriebsrisiko-Queue

## Zweck und Betreiberfrage

Rechenzentrums-, Standort-, Leitungs- oder Terminalstoerungen werden bei EVUs/VNB haeufig als reine IT-Meldung gefuehrt, obwohl Fachprozesse, Fallbackwege, Nachbuchungen, Dienstleisterstatus und Betriebsrisiko betroffen sind (Issue #527). Die Betreiberfrage lautet: *"Welcher Fachprozess ist von dieser synthetischen Infrastrukturstoerung betroffen, welche Fallback-/Nachweis-Luecke besteht, wer ist Owner, und welches sichere Entstoerungs- oder Abschluss-Gate folgt — bevor irgendeine Entwarnung oder ein Abschluss ausgesprochen wird?"*

Dieser Cut fuehrt **keine neue Incident-, ITSM-, Monitoring- oder Ticket-Plattform** ein. Er ist eine **read-only Budibase-Workbench-Projektion** (`read_only_workbench_projection`, "Infrastructure Disruption Operating Risk Workbench") fuer `ROLE_GRID_OPERATIONS_LEAD`, die ausschliesslich sechs bereits vorhandene `GET /api/dashboard/*` Bricks fuer genau drei explizit synthetische Stoerungsfaelle komponiert.

Datenklassen: Alle Fall-, System-, Prozess- und Dienstleisterlabels sind explizit synthetisch (`synthetic_tenant_seed`). Es werden keine realen Rechenzentren, Standorte, Leitungen, Terminals, Dienstleister oder Kundendaten benannt.

## Sechs wiederverwendete Bricks

Kein neuer Service, keine neue Route, keine neue Persistenz:

| Brick | Action | Route |
| --- | --- | --- |
| Kommunikations-/Prozessrisiko Gate | `dashboard-api.communicationBreakProcessRiskStatus` | `GET /api/dashboard/communication-break-process-risk` |
| Cross-Channel VNB Signal Queue | `dashboard-api.crossChannelVnbSignalQueueStatus` | `GET /api/dashboard/cross-channel-vnb-signal-queue` |
| Monitoring Nicht-Eskalation | `dashboard-api.monitoringNonEscalationStatus` | `GET /api/dashboard/monitoring-non-escalation` |
| Evidence Freshness Guard | `dashboard-api.evidenceFreshnessGuardStatus` | `GET /api/dashboard/evidence-freshness-guard` |
| Automation Risk Gate | `dashboard-api.automationRiskGateStatus` | `GET /api/dashboard/automation-risk-gate` |
| Owner-Frist-Evidenz Gate | `dashboard-api.ownerDeadlineEvidenceGateStatus` | `GET /api/dashboard/owner-deadline-evidence-gate` |

Die Queue ist eine **Rendering-Komposition** im Budibase-Manifest (`integrations/budibase/manifests/stadtwerk-mauer-workbench.json`, Sections `infrastructure_disruption_operating_risk_*`, Queries `getInfrastructureDisruptionOperatingRisk*Rows`), kein neuer aggregierender Endpoint.

## Feld-zu-Brick Mapping

| Betriebsrisiko-Feld | Brick | Felder auf dem bestehenden Contract |
| --- | --- | --- |
| Stoerungsart/Fachprozess, blockierte Entscheidung, naechster Evidenzpunkt, Eskalations-/Rueckzugskriterium (nur Anzeige), Owner/Vertretung | `communication-break-process-risk` | `process.*`, `governanceContext.escalationCriterion`, `ownerContext.owner`/`deputy`, `missingEvidence[]`, `positiveFollowUps[]` |
| Fallback-/Evidenzreferenz, synthetischer Dienstleister-/Systemstatus (nur Evidenzzeiger), Kommunikations-/Dedupe-Status, Owner/Faelligkeit | `cross-channel-vnb-signal-queue` | `normalizedSignals[0].evidenceRefs`/`evidenceStatus`/`sourceSystem`/`channel`/`dedupeKey`/`ownerRole`/`dueAt`, `queueStatus` |
| Geprueftes Monitoring, Neuheit, dokumentiert abwesender Blocker | `monitoring-non-escalation` | `checkedSource.sourceName`, `signal.novelty`, `absentBlocker.classification` |
| Evidenz-Aktualitaet/Delta-Status | `evidence-freshness-guard` | `freshnessState`, `deltaState`, `escalationRecommended` (nur als `escalationHint: human_review_required`) |
| Naechstes sicheres Entstoerungs-/Abschluss-Gate, Stopp-/Rollback-Kriterium | `automation-risk-gate` | `riskContext.riskLevel`, `readinessSignals[]` (`stop_criteria`, `rollback_path`) |
| Owner & Frist (Klaerung), blockierte Entscheidung | `owner-deadline-evidence-gate` | `ownerContext.ownerRole`/`dueAt`, `signalContext.blockedDecision` |

Alle Zeilen sind skalar und anzeigesicher: verschachtelte Objekte oder Arrays aus einem Brick werden nie als Rohwert, JSON oder `[object Object]` gerendert, sondern als `clarification`.

## Genau drei synthetische Stoerungsfaelle

Der Selector (`getInfrastructureDisruptionOperatingRiskSelectorRows`) rendert exakt drei Faelle; ein vierter Fall wird nie synthetisiert und die Auswahl ist reiner Renderer-/Query-State (keine Persistenz):

1. `smm-incident-datacenter-communication-001` — Rechenzentrums-Stoerung, `communication_process_impact_gap`.
2. `smm-incident-field-terminal-fallback-002` — Standort-/Terminalstoerung Aussendienst, `fallback_evidence_review` — **default-selected**; alle Detail-Queries binden `signalId`/`caseId` konsistent an diesen Fall.
3. `smm-incident-service-provider-delay-003` — Leitungsstoerung Ersatzstandort, `stale_provider_completion_evidence`.

Rollen erscheinen nur als uebertragbare Rollenlabels (`ROLE_GRID_OPERATIONS_LEAD`, mitwirkend/informiert z. B. `ROLE_METERING`, `ROLE_IT_OPERATIONS`, `ROLE_MANAGEMENT`), nie als Personen oder Personal-Agent-Sonderpfad.

Fehlende oder veraltete Evidenz wird ausschliesslich als `clarification`/`human_review_required` mit einer positiven Folgeaktion (`enablesDossierAddition`) abgebildet — nie als abgeleitete reale Stoerung, Dienstleisterausfall, Wiederherstellung, Eskalation oder Abschluss.

## Erlaubte Interaktionen

Genau vier nicht-konsequentielle Interaktionsklassen:

- `select_synthetic_case` — einen der drei synthetischen Faelle auswaehlen;
- `refresh_read_models` — die sechs read-only Lesemodelle aktualisieren;
- `inspect_fallback_evidence` — Fallback-/Evidenzreferenz des ausgewaehlten Falls pruefen;
- `open_owner_clarification` — nur Anzeige-/Navigationshinweis (`display_navigation_only`), keine Task-/Ticket-Erstellung und keine Owner-Zuweisung.

## No-call / No-write boundary

Als disabled `not_called` Zeilen (zusammen mit dem `sourceActions.notCalled`-Array des Bricks) gerendert und nie ausgefuehrt: Incident-/Ticket-/Task-Erstellung, Pager-/Alerting-Eskalation, Owner-Zuweisung, Dienstleister-Aufruf, externe Connectoren, Mail/Webhook, Workflow/HITL, direkter Log-Zugriff, Monitoring-Mutation, beliebige Budibase-Tabellenschreibung oder App-Erstellung, Rundeck, MaKo, Billing, Settlement, Tarif, Dispatch, Device Control, Personal-Agent-Ausfuehrung und Produktionsaktionen.

## Kein Impact

Keine Aenderung an Backend-Routen, Persistenz, Capability Broker, Hydration Registry, Formatter, Sidecar oder Personal Agent. Kein Blueprint-Pack-Seed, `demoProcessMatrix`, Landing-Registry-Eintrag, Credential-/Wallet-/Key-Material oder Budibase-First-Create.

## Visible-Demo-Gate (offen)

Die Repository-Implementierung ist keine Visible-Demo-Abnahme. Der Budibase-Apply/Read-Query-Smoke laeuft erst gegen ein unabhaengig nachgewiesenes, update-sicheres bestehendes Stadtwerk-Mauer-Anwendungsziel (`--preflight-existing`); ein unbeaufsichtigtes First-Create findet nicht statt.
