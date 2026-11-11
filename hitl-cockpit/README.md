# AgentOS HITL- und Management-Cockpit

Stand: 2026-11-11
Status: AP 0–17 im Integrations-Worktree implementiert; nicht produktiv deployt

## Zweck

Das Cockpit bietet zwei additive Sichten auf Hermes Kanban:

- `/`: bestehende Legacy-HITL-Liste mit den Aktionen Freigeben, Ablehnen, Rückfrage und Schließen;
- `/management`: read-only Geschäftsführungssicht mit Lage, Entscheidungen, Abteilungen, Themen und Verlauf.

Hermes Kanban bleibt System of Record. Die Management-SQLite ist eine abgeleitete Projektion und kann vollständig neu aufgebaut werden. Management-Aktionen laufen aktuell ausschließlich als Shadow-Simulation und führen keinen Write aus.

Verbindliche Policy: `../agent-operating-system/management-cockpit-policy-v1.md`.
Produktionsbaseline und Rückfall: `../agent-operating-system/management-cockpit-operations-v1.md`.
Reproduzierbare Releasebasis: `../agent-operating-system/management-cockpit-release-baseline-v2.md`.

## Sicherheitsstatus

Sichere Defaults:

```text
MANAGEMENT_COCKPIT_ENABLED=false
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
MANAGEMENT_COCKPIT_SHADOW_ONLY=true
MANAGEMENT_COCKPIT_DEFAULT_VIEW=legacy
```

Wichtige Grenzen:

- kein produktives Deployment aus diesem Worktree;
- kein Management-Write implementiert;
- keine Mutation von Kanban durch Projektor, Telemetrie oder Wakeup-Prozessor;
- `twl-netze-private` und sensitive Quellen werden vor jeder Projektion ausgeschlossen;
- historische `scheduled`-Karten werden nur gelesen;
- Telemetrie ist sanitisiert und hat keine operative Wirkung;
- Tokenwerte gehören nie in Befehle, Dokumente, Logs, Screenshots oder Git.

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
| `HITL_COCKPIT_SESSION_TTL_SECONDS` | `1800`                                               | 60 bis 28.800 Sekunden                             |
| `HITL_COCKPIT_ALLOW_LEGACY_BEARER` | `false`                                              | befristeter Übergangsclient, nicht Browserstandard |
| `AGENTOS_SCOPE_LEDGER`             | `$HOME/.hermes/agent-os-scoped-approval-ledger.json` | Scope-Ledger-Override                              |
| `ASSISTANT_CONFIG`                 | `config/assistant-policy.json`                       | Rhajaina-Policy und Rollout-Modus                  |
| `ASSISTANT_DATABASE`               | `$HERMES_HOME/agent-os/assistant-channel.db`         | getrennte Conversation-/Audit-Datenbank            |

Bei abweichendem `--hermes-home` muss der Scope-Ledger-Pfad explizit mit `--scope-ledger` angegeben werden, wenn er nicht unter `$HOME/.hermes` liegt.

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

Aktuelles Schema: `PRAGMA user_version = 5`.

Standardpfad:

```text
/home/clawd/.hermes/management-cockpit/management.db
```

Die Datenbank enthält abgeleitete Topics, Decisions, Briefs, Outcomes, Wakeups, Classification Audit, Digest Items, Projection Runs/Boards/Objects und Cockpit Events. Sie ist kein System of Record.

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
3. `PRAGMA user_version` ist 5.
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

Vor Produktion müssen Proxy-Access-Logs auf Query-Redaction beziehungsweise kurze Aufbewahrung geprüft werden. Der erste Bootstrap-Request kann technisch noch den Token im Request Target tragen.

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

Shadow-Aktionen sind die einzigen erlaubten Management-POST-Ausnahmen:

```text
POST /api/management/decisions/:id/choose
POST /api/management/decisions/:id/delegate
POST /api/management/decisions/:id/question
POST /api/management/decisions/:id/schedule
POST /api/management/decisions/:id/reject
POST /api/management/decisions/:id/return-to-rhajaina
```

Erfolg bedeutet HTTP 202 mit `mode=shadow`, `writePerformed=false` und `persisted=false`. Bei aktivierter Write-Konfiguration brechen die Endpunkte mit HTTP 501 ab.

### Rhajaina Assistant Channel

Die Default-Policy bleibt `enabled=false`, `mode=read_only`, `writesEnabled=false`, `matrixHandoffEnabled=false` und mit leerer `actionAllowlist`. Zulässige Rollout-Modi sind `read_only`, `shadow`, `low_risk`, `scoped` und `productive`; ungültige Flag-Kombinationen verhindern den Serverstart.

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

AP 15 führt kein Deployment aus. Für einen späteren, separat freigegebenen Read-only-Rollout:

1. AP-17-Preflight und deterministischen Build für den freigegebenen Commit ausführen; keine Auslieferung aus Arbeitsbaumdateien.
2. GitNexus `detect_changes(scope=compare, base_ref=main)` auswerten und die bekannte Branch-Divergenz bereinigen.
3. vollständige Tests, Syntax, Lint, Build und `git diff --check` ausführen.
4. produktiven PM2-Prozess, CWD, Script, Port, `HERMES_HOME` und Proxy-Upstream read-only erneut prüfen.
5. aktuelle Runtime, alle `lib/`, `config/`, `bin/`, `public/`, `server.js`, `package.json`, PM2-Metadaten und Proxy-Konfiguration secret-frei sichern und hashen.
6. Kanban-Datenbanken inventarisieren und Prüfsummen/Größe/mtime erfassen; niemals in das Runtime-Backup kopieren oder zurückschreiben.
7. Managementdatenbank und Telemetrie separat sichern beziehungsweise als ableitbar markieren.
8. Proxy-Loghygiene und Session-Cookie-Weitergabe prüfen.
9. Projektion zunächst temporär vollständig neu aufbauen und abnehmen.
10. Code deployen mit Management deaktiviert; Legacy-Smoke durchführen.
11. `MANAGEMENT_COCKPIT_ENABLED=true`, Write weiterhin false, Shadow weiterhin true; nur Prozessumgebung kontrolliert neu laden.
12. Session-Bootstrap, Legacy, Management-Read APIs und TWL-Ausschluss verifizieren.
13. Projektionsalter, Boardfehler und PM2-/Proxy-Logs prüfen.
14. Rollback-Drill durchführen oder einen frischen dokumentierten Nachweis vorlegen.

## Healthcheck

Prozessgesundheit:

- PM2 `online`, keine Restart-Schleife;
- Listener auf dem erwarteten Port;
- interner und öffentlicher `/api/health`-Pfad;
- Session-Bootstrap 303, tokenfreie Location und API 200 mit Session;
- API 401 ohne Session;
- Legacy-UI und `/api/tasks` erreichbar.

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

Schnellster Rückfall:

```text
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
MANAGEMENT_COCKPIT_ENABLED=false
MANAGEMENT_COCKPIT_SHADOW_ONLY=true
MANAGEMENT_COCKPIT_DEFAULT_VIEW=legacy
```

Danach den Cockpit-Prozess kontrolliert mit unveränderter Legacy-Konfiguration neu laden und den Legacy-Smoke ausführen. Projektionsjobs stoppen, fehlerhafte Managementdatenbank quarantänisieren und nicht in Kanban zurückspielen.

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

- AP 17 stellt eine commitbasierte Release- und LKG-Mechanik bereit; ein produktives LKG wird erst in einem separat freigegebenen Cutover promoted.
- Kein produktiver Rebuild, Job, Cron, PM2-Restart, Proxywechsel oder Tokenwechsel wurde ausgeführt.
- Gate C ist nicht erfüllt, solange keine 14 unterschiedlichen täglichen Shadow-Messpunkte und kein fachliches Review vorliegen.
- Echte Decision-Writes sind nicht implementiert und dürfen nicht durch Umgebungsvariablen erzwungen werden.
- `MANAGEMENT_COCKPIT_DEFAULT_VIEW=management` routet `/` nicht um; `/` bleibt Legacy.
- Der kanonische Einstieg in die Managementsicht ist `/management`, nicht die statische Datei `/management.html`.
