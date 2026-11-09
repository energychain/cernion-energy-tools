# AgentOS Current — Management-Cockpit Iteration AP 0–15

Stand: 2026-11-09
Status: im isolierten Worktree implementiert und verifiziert; nicht produktiv aktiviert

## 1. Aktueller Arbeitsstand

Das produktive AgentOS bleibt unverändert. Der neue Management-Cockpit-Stand liegt ausschließlich hier:

```text
Worktree: /home/clawd/.openclaw/workspace/.worktrees/agentos-management-cockpit-iteration
Branch: feat/agentos-management-cockpit-iteration
```

Die Implementierung ist noch nicht als Commit oder Release-Artefakt fixiert. Der Branch-HEAD allein reproduziert AP 0–15 daher noch nicht. Ein produktives Deployment aus dem uncommitteten Worktree ist nicht zulässig.

Produktiv führend bleiben:

- Matrix als Gesprächs- und Arbeitsoberfläche;
- Hermes Kanban als operatives System of Record;
- die bestehende Legacy-HITL-Liste;
- bestehende AgentOS-Routinen, Profile, Cronjobs und Scope-Prozesse.

AP 0–15 haben keinen produktiven PM2-Neustart, Proxywechsel, Tokenwechsel, Kanban-Write, Cronjob oder Managementdatenbank-Rebuild ausgelöst.

## 2. Zielbild der Iteration

Das Cockpit wird zur digitalen Geschäftsführungs- und Abteilungsleiter-Sicht. Es verdichtet operative Karten zu:

- Unternehmenslage;
- echten Governance-Entscheidungen;
- Management-Topics;
- belegten Outcomes;
- Abteilungsbriefs für Rhajaina, Felix, Anja, Viki, Cori, DevOps und Infrastructure;
- Risiken und Scope-Verletzungen;
- begründeten Wiedervorlagen;
- einem nachvollziehbaren Digest für Noise und Routinemeldungen.

Die Legacy-Liste bleibt während des gesamten Parallelbetriebs der Rückfallpfad.

## 3. Implementierte Arbeitspakete

| AP  | Ergebnis                                                                        | Aktueller Modus                           |
| --- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| 0   | Produktionsbaseline, Legacy-Vertragstests, Last-Known-Good und Rollback-Vertrag | dokumentiert, Produktivstand unverändert  |
| 1   | getrennte Management-SQLite und deterministischer Rebuild                       | Quell-read-only, nicht produktiv geplant  |
| 2   | deterministischer Classifier                                                    | Shadow                                    |
| 3   | Scoped-Approval-Ledger                                                          | ausschließlich lesend                     |
| 4   | Management Read API und Feature Flags                                           | deaktiviert per Default                   |
| 5   | Geschäftsführungs-UX und Legacy-Rückfall                                        | Parallelansicht, nicht deployt            |
| 6   | fachliche Decision-Aktionen                                                     | Simulation, keine Persistenz              |
| 7   | vollständiger Wiedervorlagevertrag                                              | historische Karten nur lesend             |
| 8   | strenger Outcome-/Impact-Feed                                                   | nur belegte Außenwirkung/Fallabschluss    |
| 9   | konservative Topic-/Case-Aggregation                                            | unsichere Zuordnung bleibt getrennt       |
| 10  | evidenzbasierte Agent Briefs                                                    | technische Aktivität ist kein Fortschritt |
| 11  | gemeinsame Decision-ID, Matrix-/Artifact-Links und TWL-Firewall                 | read-only                                 |
| 12  | Digest-/Noise-Lane                                                              | keine automatische Schließung             |
| 13  | aggregierte Qualitätsmetriken                                                   | ausschließlich Shadow                     |
| 14  | Session-Auth und Tokenhygiene                                                   | nur im Worktree, keine Rotation           |
| 15  | konsolidierte Policy, Runbook und Betriebsübergabe                              | Dokumentation, keine Produktion           |

Aktuelles Projektionsschema: Version 5.

## 4. Verbindliche Dokumente

- Policy und Grenzen: `agent-operating-system/management-cockpit-policy-v1.md`
- Operator-/Rebuild-/Incident-Runbook: `hitl-cockpit/README.md`
- Produktionsbaseline und vollständiger Rückfall: `agent-operating-system/management-cockpit-operations-v1.md`
- Klassifikation: `agent-operating-system/management-cockpit-classification-policy-v1.md`
- Read API: `agent-operating-system/management-cockpit-read-api-v1.md`
- Shadow-Aktionen: `agent-operating-system/management-cockpit-decision-actions-shadow-v1.md`
- Wiedervorlagen: `agent-operating-system/management-cockpit-wakeup-semantics-v1.md`
- Outcomes: `agent-operating-system/management-cockpit-outcome-feed-v1.md`
- Topics: `agent-operating-system/management-cockpit-topic-aggregation-v1.md`
- Agent Briefs: `agent-operating-system/management-cockpit-agent-briefs-v1.md`
- Context Links und TWL-Grenze: `agent-operating-system/management-cockpit-context-links-v1.md`
- Shadow-Metriken: `agent-operating-system/management-cockpit-metrics-v1.md`
- Session-Auth: `agent-operating-system/management-cockpit-session-auth-v1.md`

Bei Widersprüchen zwischen historischen AP-Dokumenten und dem konsolidierten Stand gilt `management-cockpit-policy-v1.md`.

## 5. Sichere Betriebsgrenzen

```text
MANAGEMENT_COCKPIT_ENABLED=false
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
MANAGEMENT_COCKPIT_SHADOW_ONLY=true
MANAGEMENT_COCKPIT_DEFAULT_VIEW=legacy
```

- `/` bleibt die Legacy-HITL-Sicht.
- `/management` ist die kanonische Managementansicht, sobald sie später freigegeben wird.
- Decision-Aktionen antworten nur als Shadow-Simulation mit `writePerformed=false` und `persisted=false`.
- Eine versuchte Write-Aktivierung bricht fail-closed ab, weil echte Writer nicht implementiert sind.
- Managementprojektion, Telemetrie und Wakeup-Analyse dürfen Kanban-Quellen nicht verändern.
- TWL-private, private, unklare und gemischt-sensitive Quellen bleiben aus Projektion, API, Links, Telemetrie und Fixtures ausgeschlossen.
- Historische `scheduled`-Karten werden nicht automatisch migriert oder reaktiviert.

## 6. Authentifizierungsziel

Der bestehende URL-Token dient künftig nur als Bootstrap für `GET /` oder `GET /management`. Danach wird ein kurzlebiges, signiertes `__Host-`-Session-Cookie verwendet und der Token per HTTP 303 aus der URL entfernt. API-Query-Token werden abgelehnt; Legacy Bearer ist standardmäßig deaktiviert.

Diese Härtung ist noch nicht produktiv aktiviert. Vor Aktivierung müssen Proxy-Access-Logs geprüft und der Token nach einer kontrollierten Übergangsphase separat rotiert werden.

## 7. Verifikation des Worktree-Stands

Der Cockpit-Testvertrag umfasst aktuell 100 Tests. Verbindliche lokale Befehle:

```bash
npm --prefix hitl-cockpit run check
npm --prefix hitl-cockpit test
```

Zusätzlich müssen vor einem Release mindestens Prettier, fokussiertes ESLint, Repository-Build, `git diff --check` und GitNexus `detect_changes(scope=compare, base_ref=main)` ausgeführt werden. Die bekannte Divergenz gegenüber `main` ist vor Merge/Release separat zu bereinigen.

## 8. Noch nicht erfüllt

- kein versionierter Commit oder freigegebenes Release-Artefakt;
- kein produktiver Read-only-Rollout;
- kein produktiver Projektionsjob;
- keine freigegebene Telemetrie-Zeitplanung;
- noch keine 14 unterschiedlichen täglichen Shadow-Messpunkte;
- noch kein fachliches Gate-C-Review;
- noch kein aktueller vollständiger Last-Known-Good-Snapshot für den AP-15-Dateisatz;
- noch kein Rollback-Drill mit dem vollständigen neuen Dateisatz;
- keine Write-Implementierung, Action-Allowlist oder produktive Reconciliation;
- keine Tokenrotation und keine Proxy-Logänderung.

## 9. Bestehender AgentOS-Betrieb bleibt erhalten

Die Management-Cockpit-Iteration ersetzt keine bestehenden AgentOS-Routinen. Weiterhin zum dokumentierten Bestand gehören:

- AgenticCOO Wake-up / FOR-DEC mit Wake, Classify, Sanitize, Incubate, Decide und Emit;
- Deep Signal Miner, Signal Review Re-Impulse und sanitizierte TWL-/Uslar-Bridge;
- AgenticCOO Aged HITL Auto-Approver innerhalb seiner bestehenden Policy;
- Model Provider Auto-Healer mit Allowlist, Probe-Call und kontrolliertem Gateway-Restart;
- Ad-hoc Matrix Workrooms und `#DeepBriefing`;
- AgentOS Decision Packet v0.1 für nachvollziehbare Integrations- und Regulatorikimpulse;
- Direct-Assertion-Chatstil ohne unnötige Ausschlussformulierungen.

Die zugehörigen Skripte, Boards, Mongo-Collections, Policies und Cronjobs werden durch AP 0–15 weder migriert noch verändert. TWL-/Uslar-/mixed-sensitive Rohkontext bleibt geschützt; externe Kommunikation, Preise, Verträge, Zahlungen und produktive Deployments bleiben an ihre bestehenden Scope-/HITL-Grenzen gebunden.

## 10. Nächster kontrollierter Schritt

Der nächste Schritt ist keine weitere Fachfunktion. Zuerst muss der AP-0–15-Stand als reproduzierbares Release vorbereitet werden:

1. Worktree-Diff und Branch-Divergenz vollständig prüfen.
2. GitNexus `detect_changes` gegen die beabsichtigte Basis auswerten.
3. AP 0–15 in nachvollziehbare Commits beziehungsweise ein freigegebenes Release-Artefakt überführen.
4. vollständige Test- und Repository-Gates erneut ausführen.
5. einen neuen secret-freien Last-Known-Good-Snapshot mit allen aktuellen Runtime-Dateien erstellen.
6. den Read-only-Rollout für Welle B separat beauftragen.

Erst danach kann die Managementsicht produktiv im Parallelbetrieb freigeschaltet werden. Write-Aktivierung bleibt ein späteres, getrenntes Arbeitspaket nach mindestens 14 Tagen Shadow-Telemetrie und Gate C.
