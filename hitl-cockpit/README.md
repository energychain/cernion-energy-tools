# AgentOS HITL- und Management-Cockpit

Stand: 2026-11-14
Status: produktiver interner Low-Risk-Betrieb; AP 19 implementiert und für den beaufsichtigten Produktionsbetrieb vorgesehen

## Zweck

Das Cockpit bietet zwei additive Sichten auf Hermes Kanban:

- `/`: bestehende Legacy-HITL-Liste mit den Aktionen Freigeben, Ablehnen, Rückfrage und Schließen;
- `/management`: primäre Geschäftsführeroberfläche mit Lage, Entscheidungen, Abteilungen, Themen, Verlauf und Rhajaina Assistant Channel.

Hermes Kanban bleibt System of Record. Die Management-SQLite ist eine abgeleitete Projektion und kann vollständig neu aufgebaut werden. Die Management-Decision-API bleibt im Shadow-Modus. Der getrennte Rhajaina Assistant Channel läuft produktiv im Modus `low_risk` und darf nach expliziter Bestätigung genau vier interne Aktionsklassen mit Kanban-Readback, Receipt und optionalem Matrix-Handoff ausführen.

Verbindlicher aktueller Betriebsvertrag: `../agent-operating-system/management-cockpit-production-contract-v2.md`.
Fachliche Policy: `../agent-operating-system/management-cockpit-policy-v1.md`.
Produktionsbaseline und Rückfall: `../agent-operating-system/management-cockpit-operations-v1.md`.
Reproduzierbare Releasebasis: `../agent-operating-system/management-cockpit-release-baseline-v2.md`.

## Sicherheitsstatus

Produktiver Vertrag:

```text
MANAGEMENT_COCKPIT_ENABLED=true
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
MANAGEMENT_COCKPIT_SHADOW_ONLY=true
MANAGEMENT_COCKPIT_DEFAULT_VIEW=management
ASSISTANT mode=low_risk
ASSISTANT writesEnabled=true
ASSISTANT matrixHandoffEnabled=true
ASSISTANT actionAllowlist=ask_question,delegate_followup,schedule_wakeup,return_for_completion
```

Wichtige Grenzen:

- kein Deployment direkt aus einem Arbeitsbaum; Release-Artefakte werden commitbasiert gebaut;
- keine direkten Management-Decision-Writes; produktiv ist nur die getrennte bestätigte Low-Risk-Lane;
- keine Mutation von Kanban durch Projektor, Telemetrie oder Wakeup-Prozessor;
- `twl-netze-private` und sensitive Quellen werden vor jeder Projektion ausgeschlossen;
- historische `scheduled`-Karten werden nur gelesen;
- Telemetrie ist sanitisiert und hat keine operative Wirkung;
- Tokenwerte gehören nie in Befehle, Dokumente, Logs, Screenshots oder Git.
- externe Kommunikation, Veröffentlichung, Preis, Vertrag, Zahlung, Budget, Deployment, Secrets, Datenschutz und TWL-private Kontexte bleiben gesperrt.

## Voraussetzungen

- Node.js 22 oder neuer;
- Python 3 mit `sqlite3`, wie im CET-/Hermes-Betrieb vorhanden;
- lesbarer Hermes-Home mit Kanban-Boards;
- für Cockpit-Start ein nicht leerer `HITL_COCKPIT_TOKEN` oder Übergangsname `TOKEN`;
- für Legacy-Aktionen die Hermes-CLI unter `HERMES_BIN`;
- HTTPS am Reverse Proxy für das `Secure`-Session-Cookie.

Das Cockpit besitzt keine zusätzlichen npm-Abhängigkeiten. Es verwendet Node-Core-Module und Python `sqlite3`.

## Verzeichnisstruktur

```text
hitl-cockpit/
  bin/
    rebuild-projection.js
    run-projection-loop.js
    export-telemetry.js
    process-wakeups.js
    release-preflight.js
  config/
    agents.json
    classifier-policy.json
    outcome-types.json
    topic-rules.json
  lib/
    ... Projektor-, Reader-, Auth- und API-Module
  public/
    index.html / app.js
    management.html / management.js
    styles.css
  test/
  package.json
  server.js
```

## Konfiguration

| Variable                           | Default                                              | Bedeutung                                          |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `HITL_COCKPIT_HOST`                | `10.0.0.101`                                         | Listener-Adresse                                   |
| `HITL_COCKPIT_PORT`                | `3927`                                               | Listener-Port                                      |
| `HITL_COCKPIT_TOKEN`               | leer                                                 | Session-Bootstrap-Secret; `TOKEN` ist nur Fallback |
| `HERMES_HOME`                      | `/home/clawd/.hermes`                                | Kanban- und AgentOS-Basis                          |
| `HERMES_PROFILE`                   | `infrastructure`                                     | Profil für Legacy-Aktionen                         |
| `HITL_COCKPIT_AUTHOR`              | `hitl-cockpit`                                       | Audit-Autor der Legacy-Aktionen                    |
| `HITL_COCKPIT_EXCLUDE_BOARDS`      | `twl-netze-private`                                  | kommaseparierte Ausschlüsse                        |
| `HERMES_BIN`                       | `/home/clawd/.hermes/hermes-agent/venv/bin/hermes`   | Hermes CLI                                         |
| `MANAGEMENT_COCKPIT_ENABLED`       | `false`                                              | Management-UI und Read APIs aktivieren             |
| `MANAGEMENT_COCKPIT_WRITE_ENABLED` | `false`                                              | muss in v1 `false` bleiben                         |
| `MANAGEMENT_COCKPIT_SHADOW_ONLY`   | `true`                                               | muss in v1 `true` bleiben                          |
| `MANAGEMENT_COCKPIT_DEFAULT_VIEW`  | `legacy`                                             | Konfigurationshinweis; `/` bleibt Legacy           |
| `MANAGEMENT_COCKPIT_DATABASE`      | `$HERMES_HOME/management-cockpit/management.db`      | Projektionsdatenbank                               |
| `PROJECTION_INTERVAL_SECONDS`       | `120`                                                | Start-zu-Start-Intervall, maximal 180 Sekunden     |
| `PROJECTION_BUDGET_SECONDS`         | `100`                                                | absolutes Laufzeitbudget eines Projektionslaufs    |
| `PROJECTION_BACKOFF_SECONDS`        | `30`                                                 | Backoff nach Fehler oder belegtem Lock             |
| `HITL_COCKPIT_SESSION_TTL_SECONDS` | `1800`                                               | 60 bis 28.800 Sekunden                             |
| `HITL_COCKPIT_ALLOW_LEGACY_BEARER` | `false`                                              | befristeter Übergangsclient, nicht Browserstandard |
| `AGENTOS_SCOPE_LEDGER`             | `$HOME/.hermes/agent-os-scoped-approval-ledger.json` | Scope-Ledger-Override                              |
| `ASSISTANT_CONFIG`                 | `config/assistant-policy.json`                       | Rhajaina-Policy und Rollout-Modus                  |
| `ASSISTANT_DATABASE`               | `$HERMES_HOME/agent-os/assistant-channel.db`         | getrennte Conversation-/Audit-Datenbank            |
| `COCKPIT_PRODUCTION_CONTRACT`      | `config/production-contract.json`                    | secret-freier maschinenlesbarer Betriebsvertrag    |

Bei abweichendem `--hermes-home` muss der Scope-Ledger-Pfad explizit mit `--scope-ledger` angegeben werden, wenn er nicht unter `$HOME/.hermes` liegt.

Der versionierte PM2-Eintrag `ecosystem.config.js` betreibt die Projektion als separaten Prozess:

```bash
pm2 start ecosystem.config.js --only agentos-hitl-projection-loop
```

Der Supervisor startet jeden Lauf in einer eigenen Prozessgruppe, beendet ihn nach spätestens 100 Sekunden hart und persistiert `RUN_BUDGET_EXCEEDED`, ohne die letzte gültige Projektion zu ersetzen. `kill_timeout` liegt mit 110 Sekunden über dem Laufzeitbudget; `SIGTERM` beendet einen aktiven Kindprozess und danach die Schleife.

## Lokale Verifikation

Aus dem Repository-Root:

```bash
npm --prefix hitl-cockpit run check
npm --prefix hitl-cockpit test
```

Oder aus `hitl-cockpit/`:

```bash
npm run check
npm test
node --test test/release-preflight.test.js
```

Die Suite umfasst zusätzlich den Rhajaina Assistant Channel, Kontext-Attachments, Shadow-Proposals, idempotente Receipts, guarded Actions und Matrix-Handoffs.

## Projektionsdatenbank

Aktuelles Schema: `PRAGMA user_version = 6`.

Standardpfad:

```text
/home/clawd/.hermes/management-cockpit/management.db
```

Die Datenbank enthält abgeleitete Topics, Decisions, Briefs, Outcomes, Wakeups, Classification Audit, Digest Items, Projection Runs/Boards/Objects und Cockpit Events. Sie ist kein System of Record.

Der Schreibschutz des Assistenzkanals bewertet die Projektionsfrische konservativ global. Eine
Bestätigung wird bei einer veralteten oder beeinträchtigten Projektion mit `409` und bei fehlender,
belegter oder nicht lesbarer Projektion mit einer bereinigten `503` abgewiesen. Eine spätere
quellenspezifische Freigabe setzt eine serverautorisierte Quellenbindung des Vorschlags voraus.

### Sicherer Quelltest ohne Persistenz

```bash
node hitl-cockpit/bin/rebuild-projection.js \
  --dry-run \
  --hermes-home /home/clawd/.hermes
```

`--dry-run` liest Quellen und projiziert in eine temporäre Datenbank. Es schreibt nicht an den Standardpfad.

### Vollständiger Rebuild

Nur nach freigegebenem Betriebsfenster und Backup:

```bash
node hitl-cockpit/bin/rebuild-projection.js \
  --hermes-home /home/clawd/.hermes \
  --scope-ledger /home/clawd/.hermes/agent-os-scoped-approval-ledger.json \
  --artifact-registry /home/clawd/.hermes/agent-os-artifact-registry.json \
  --room-registry /home/clawd/.hermes/matrix-agent-rooms.json \
  --database /home/clawd/.hermes/management-cockpit/management.db
```

Der Default ist ein persistenter vollständiger Rebuild. `--no-shadow` deaktiviert nur das Classification Audit und macht den Lauf nicht read-only. Deshalb darf `--no-shadow` nicht als Sicherheitsoption verstanden werden.

### Inkrementeller Lauf

```bash
node hitl-cockpit/bin/rebuild-projection.js \
  --incremental \
  --hermes-home /home/clawd/.hermes \
  --scope-ledger /home/clawd/.hermes/agent-os-scoped-approval-ledger.json \
  --database /home/clawd/.hermes/management-cockpit/management.db
```

Ein vollständiger Rebuild bleibt die verbindliche Rekonsolidierung für Topic-Aggregation und Agent Briefs. Vor Ersatz der letzten gültigen Datenbank ist eine Kopie mit Prüfsumme anzulegen.

### Rebuild-Abnahme

1. Befehl endet mit Exit 0 und `boardErrors=0` oder vollständig erklärten Fehlern.
2. `PRAGMA integrity_check` ergibt `ok`.
3. `PRAGMA user_version` ist 6.
4. private/TWL-Quellen sind nicht enthalten.
5. keine doppelten offenen Decision-IDs.
6. Outcomes besitzen Typ, Evidenz und Zeitpunkt.
7. alle sieben Agent Briefs sind vorhanden oder ein erklärter Leerzustand ist sichtbar.
8. `/api/management/metadata` und `/api/management/telemetry` sind lesbar.
9. Prüfsumme, Größe und mtime der Kanban-Datenbanken sind gegenüber dem Preflight unverändert.
10. Legacy-API und Legacy-UI bleiben erreichbar.

## Shadow-Telemetrie

Nur stdout, ohne Historien-Write:

```bash
node hitl-cockpit/bin/export-telemetry.js \
  --hermes-home /home/clawd/.hermes \
  --database /home/clawd/.hermes/management-cockpit/management.db \
  --stdout-only
```

Sanitisierte 14-Tage-Historie:

```bash
node hitl-cockpit/bin/export-telemetry.js \
  --hermes-home /home/clawd/.hermes \
  --database /home/clawd/.hermes/management-cockpit/management.db \
  --history /home/clawd/.hermes/management-cockpit/telemetry-shadow.jsonl \
  --window-days 14
```

Die Historie hat Modus 0600. Sie enthält nur aggregierte Werte. Der Exporter kennt keinen Write-Modus für operative Systeme; `--write` und unbekannte Optionen werden abgewiesen. Eine produktive Zeitplanung ist nicht Teil von AP 15.

## Historische Wiedervorlagen analysieren

Read-only Analyse:

```bash
node hitl-cockpit/bin/process-wakeups.js \
  --hermes-home /home/clawd/.hermes
```

Optionaler Modus-0600-Migrationsreport:

```bash
node hitl-cockpit/bin/process-wakeups.js \
  --hermes-home /home/clawd/.hermes \
  --migration-report /tmp/agentos-wakeup-migration.json
```

Eine vorhandene Reportdatei wird ohne `--force` nicht überschrieben. Dieser Befehl verändert keine Kanban-Karte und reaktiviert keine historische Wiedervorlage.

## Authentifizierung

1. Browser öffnet `GET /?token=<secret>` oder `GET /management?token=<secret>`.
2. Server setzt ein signiertes `__Host-agentos_hitl_session`-Cookie.
3. HTTP 303 entfernt den Token aus der URL.
4. APIs verwenden anschließend nur das Same-Origin-Cookie.
5. API-Query-Token liefern 401.
6. Legacy Bearer ist standardmäßig deaktiviert.

Im produktiven Betrieb müssen Proxy-Access-Logs Query-Redaction beziehungsweise kurze Aufbewahrung gewährleisten. Der erste Bootstrap-Request kann technisch noch den Token im Request Target tragen.

## UI- und API-Pfade

Legacy:

```text
GET  /
GET  /api/health
GET  /api/tasks
POST /api/tasks/:board/:task/approve
POST /api/tasks/:board/:task/reject
POST /api/tasks/:board/:task/question
POST /api/tasks/:board/:task/close
```

Management Read API:

```text
GET /management
GET /api/management/config
GET /api/management/summary
GET /api/management/metadata
GET /api/management/overview
GET /api/management/decisions
GET /api/management/decisions/:id
GET /api/management/departments
GET /api/management/departments/:agentId
GET /api/management/topics
GET /api/management/topics/:topicId
GET /api/management/outcomes
GET /api/management/risks
GET /api/management/wakeups
GET /api/management/digest
GET /api/management/scopes
GET /api/management/telemetry
```

Die Management-Decision-POSTs bleiben Shadow-Aktionen:

```text
POST /api/management/decisions/:id/choose
POST /api/management/decisions/:id/delegate
POST /api/management/decisions/:id/question
POST /api/management/decisions/:id/schedule
POST /api/management/decisions/:id/reject
POST /api/management/decisions/:id/return-to-rhajaina
```

Erfolg bedeutet HTTP 202 mit `mode=shadow`, `writePerformed=false` und `persisted=false`. Diese Endpunkte sind von der produktiven Assistant-Low-Risk-Lane getrennt. Bei aktivierter Management-Write-Konfiguration brechen sie mit HTTP 501 ab.

### Rhajaina Assistant Channel

Die versionierte Default-Policy bleibt als sicherer lokaler Code-Default deaktiviert. Produktion bindet explizit `/home/clawd/.hermes/runtime/agentos-hitl-cockpit/assistant-policy.json` mit `enabled=true`, `mode=low_risk`, aktivierten Writes/Handoffs und den vier vertraglichen Low-Risk-Aktionsklassen. Ungültige Flag-Kombinationen verhindern den Serverstart.

```text
GET  /api/assistant/config
GET  /api/assistant/conversations
POST /api/assistant/conversations
GET  /api/assistant/conversations/:id/messages
POST /api/assistant/conversations/:id/messages
GET  /api/assistant/runs/:id
GET  /api/assistant/proposals
POST /api/assistant/proposals/:id/confirm
POST /api/assistant/proposals/:id/reject
```

Das Karten-Attachment wird serverseitig aus Objektart und ID rekonstruiert. Ein Themenwechsel im offenen Drawer wechselt sofort in den passenden Objektthread; „Globales Gespräch“ startet beziehungsweise öffnet den globalen Thread. Ein Write-Erfolg wird erst nach exaktem Kanban-Readback als Receipt angezeigt.

`GET /api/health` zeigt unter `operatingStatus`, ob geladene Management- und Assistant-Flags exakt mit `config/production-contract.json` übereinstimmen. `aligned=false` ist sichtbare Runtime-Drift; Transportpfade und Secrets werden nicht ausgegeben.

## Reproduzierbare Releasebasis

AP 17 führt keinen Cutover aus. Der Release-Preflight validiert Commit/`main`-Abstammung,
Arbeitsbaum, Schema v5/v6, das geschlossene Runtime-Schema, getrennte Datenbankpfade und die
tatsächliche Lesbarkeit der erforderlichen Profile. Unbekannte Felder, Secret-Muster und
NUL-/Binärinhalte werden abgewiesen. Das Artefakt wird nur aus committed Cockpit-Dateien plus der
dokumentierten Runtime-Konfiguration gebaut; Profile werden nie kopiert:

```bash
node bin/release-preflight.js preflight \
  --commit "$(git rev-parse HEAD)" \
  --base-ref origin/main \
  --profile-root /home/clawd/.hermes/profiles \
  --config config/release-runtime.example.json

node bin/release-preflight.js build \
  --commit "$(git rev-parse HEAD)" \
  --base-ref origin/main \
  --profile-root /home/clawd/.hermes/profiles \
  --config config/release-runtime.example.json \
  --output /tmp/agentos-cockpit-release
```

Das deterministische Manifest enthält Commit, Anwendungsversion, Schemaversionen und SHA-256
aller Dateien. Tests und Workspace-Dirt werden nicht übernommen. Last-Known-Good-Promotion und
Rollback-Dry-Run verifizieren das Manifest vor und nach dem Kopieren und restaurieren niemals
Kanban. Vollständige Befehle und Grenzen stehen in
`management-cockpit-release-baseline-v2.md`.

## Deployment-Preflight

Für einen neuen produktiven Release:

1. AP-17-Preflight und deterministischen Build für den freigegebenen Commit ausführen; keine Auslieferung aus Arbeitsbaumdateien.
2. GitNexus `detect_changes(scope=compare, base_ref=main)` auswerten und die bekannte Branch-Divergenz bereinigen.
3. vollständige Tests, Syntax, Lint, Build und `git diff --check` ausführen.
4. produktiven PM2-Prozess, CWD, Script, Port, `HERMES_HOME` und Proxy-Upstream read-only erneut prüfen.
5. aktuelle Runtime, alle `lib/`, `config/`, `bin/`, `public/`, `server.js`, `package.json`, PM2-Metadaten und Proxy-Konfiguration secret-frei sichern und hashen.
6. Kanban-Datenbanken inventarisieren und Prüfsummen/Größe/mtime erfassen; niemals in das Runtime-Backup kopieren oder zurückschreiben.
7. Managementdatenbank und Telemetrie separat sichern beziehungsweise als ableitbar markieren.
8. Proxy-Loghygiene und Session-Cookie-Weitergabe prüfen.
9. Projektion zunächst temporär vollständig neu aufbauen und abnehmen.
10. Code zunächst mit deaktiviertem Assistant deployen und Legacy-/Management-Read-Smoke durchführen.
11. produktive Runtime-Policy explizit binden; Management-Decision-Write bleibt false und Shadow bleibt true.
12. Prozessumgebung kontrolliert neu laden und `operatingStatus.aligned=true` verifizieren.
13. Session-Bootstrap, Legacy, Management-APIs, Assistant-Konfiguration und TWL-Ausschluss prüfen.
14. einen synthetischen oder freigegebenen Low-Risk-Smoke mit Readback durchführen; keine fremde produktive Karte mutieren.
15. Projektionsalter, Boardfehler, Receipt-/Matrix-Readback und PM2-/Proxy-Logs prüfen.
16. Rollback-Drill durchführen oder einen frischen dokumentierten Nachweis vorlegen.

## Healthcheck

Prozessgesundheit:

- PM2 `online`, keine Restart-Schleife;
- Listener auf dem erwarteten Port;
- interner und öffentlicher `/api/health`-Pfad;
- Session-Bootstrap 303, tokenfreie Location und API 200 mit Session;
- API 401 ohne Session;
- Legacy-UI und `/api/tasks` erreichbar.
- `operatingStatus.contractId=management-cockpit-production-v2` und `operatingStatus.aligned=true`.

Projektionsgesundheit:

- Datenbank lesbar und Schema v5;
- `integrity_check=ok`;
- letzte erfolgreiche Projektion im freigegebenen Parallelbetrieb höchstens 15 Minuten alt;
- Boardfehler null oder erklärt;
- keine private/TWL-Quelle;
- keine doppelten offenen Decision-IDs;
- Telemetrie frisch, sofern sie separat freigegeben wurde.

Ein grüner Prozesshealthcheck belegt nicht automatisch eine aktuelle oder fachlich richtige Projektion.

## Rollback

Schnellster Rückfall der Management- und Assistant-Funktion:

```text
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
MANAGEMENT_COCKPIT_ENABLED=false
MANAGEMENT_COCKPIT_SHADOW_ONLY=true
MANAGEMENT_COCKPIT_DEFAULT_VIEW=legacy
ASSISTANT mode=read_only
ASSISTANT writesEnabled=false
ASSISTANT matrixHandoffEnabled=false
```

Danach den Cockpit-Prozess kontrolliert neu laden und den Legacy-Smoke ausführen. Projektionsjobs stoppen, fehlerhafte Managementdatenbank quarantänisieren und nicht in Kanban zurückspielen. Receipts, echte Kommentare und Matrix-Events bleiben erhalten.

Wenn Runtime oder Legacy betroffen sind, gilt der vollständige Restore aus `management-cockpit-operations-v1.md`. Vor dem ersten produktiven Management-Rollout muss ein neuer Last-Known-Good-Snapshot mit dem vollständigen aktuellen Dateisatz erstellt werden. Kanban-Datenbanken werden bei einem Cockpit-Rollback nicht global restauriert.

## Incident-Verfahren

Sofort Management deaktivieren und Incident eröffnen bei:

- sichtbarem TWL-/privatem Kontext;
- Token in Log, URL-Folgepfad, Browserartefakt oder Ausgabe;
- unautorisiertem Quellwrite;
- doppelter oder falscher Aktion;
- falschem Board oder Source Task;
- Auth-Bypass;
- Projektion, die Quellboards verändert;
- Legacy-Ausfall oder PM2-Restart-Schleife.

Ablauf:

1. Containment ohne Evidenzverlust;
2. Management und Jobs stoppen, Legacy soweit sicher verfügbar halten;
3. fehlerhaften Stand, Logs und Projektion secret-frei sichern;
4. Quellintegrität und betroffene Tasks exakt prüfen;
5. Feature-Flag- oder Runtime-Rollback;
6. Health-, Legacy- und TWL-Smoke;
7. Teilwrites einzeln reconciliieren, kein globales Board-Restore;
8. Ursache, Auswirkung, Maßnahmen und offene Punkte dokumentieren.

## Aktuelle Übergabegrenzen

- AP 17 stellt eine commitbasierte Release- und LKG-Mechanik bereit; ein neuer Release wird nur aus einem geprüften Commit gebaut.
- Der produktive Low-Risk-Pfad ist durch den versionierten Smoke-Nachweis belegt; die Freigabe gilt nicht für weitere Aktionsklassen.
- Echte Management-Decision-Writes sind nicht implementiert und dürfen nicht durch Umgebungsvariablen erzwungen werden.
- Ergebnisrücklauf, persistente Reconciliation, vollständige Agentenabdeckung und weitere Geschäftsvorgangsklassen bleiben Folgearbeit.
- `MANAGEMENT_COCKPIT_DEFAULT_VIEW=management` routet `/` nicht um; `/` bleibt Legacy.
- Der kanonische Einstieg in die Managementsicht ist `/management`, nicht die statische Datei `/management.html`.
