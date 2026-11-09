# Management-Cockpit: Produktionsbaseline und Rollback-Vertrag v1

Stand: 2026-11-08T12:44:16Z
Arbeitspaket: AP 0
System: produktives AgentOS HITL-Cockpit der STROMDAO GmbH
Geltungsbereich: bestehende Legacy-Sicht und alle folgenden Management-Cockpit-Iterationen

> Historischer Baseline-Hinweis: Dieses Dokument fixiert den Last-Known-Good-Stand vor AP 1–15. Seine Angaben zur damaligen Query-Token-/Bearer-Authentifizierung, zum damaligen Dateisatz und zu vier Baseline-Tests beschreiben den Rückfallstand, nicht den aktuellen Zielvertrag. Für den konsolidierten AP-15-Stand gelten `management-cockpit-policy-v1.md` und `../hitl-cockpit/README.md`. Vor einem produktiven Rollout ist ein neuer vollständiger Snapshot des aktuellen Dateisatzes erforderlich.

## 1. Zweck und Betriebsstatus

Dieses Dokument fixiert den letzten bekannten funktionierenden Zustand vor der Management-Cockpit-Iteration und legt den verbindlichen Rückfallpfad fest. Die bestehende HITL-Sicht bleibt während der Iteration der sichere Rückfallpfad. Hermes Kanban bleibt System of Record.

AP 0 hat keine produktiven Kanban-Daten, Cockpit-Aktionen, PM2-Prozesse, Proxy-Konfigurationen oder Zugangsdaten verändert. Es wurden ausschließlich eine sanitizierte Vertragsfixture, isolierte Vertragstests, dieses Betriebsdokument und eine secret-freie Laufzeitsicherung angelegt.

## 2. Produktionsbaseline

### 2.1 Host und Runtime

| Merkmal                    | Verifizierter Stand                                                           |
| -------------------------- | ----------------------------------------------------------------------------- |
| Host                       | `rs-combined-1` / `10.0.0.101`                                                |
| öffentlicher Endpunkt      | `https://hitl.stromdao.de/`                                                   |
| interner Endpunkt          | `http://10.0.0.101:3927/`                                                     |
| PM2-Prozess                | `agentos-hitl-cockpit`, PM2-ID 12                                             |
| Prozessstatus bei Aufnahme | `online`, 0 Restarts seit letztem PM2-Start                                   |
| Script                     | `/home/clawd/.openclaw/workspace/cernion-energy-tools/hitl-cockpit/server.js` |
| CWD                        | `/home/clawd/.openclaw/workspace/cernion-energy-tools/hitl-cockpit`           |
| Ausführung                 | Node.js, Fork Mode                                                            |
| Node-Version laut PM2      | 24.18.0                                                                       |
| Anwendungsversion          | 0.1.0                                                                         |
| Bindung                    | `10.0.0.101:3927`                                                             |
| `HERMES_HOME`              | `/home/clawd/.hermes`                                                         |
| Hermes CLI                 | `/home/clawd/.hermes/hermes-agent/venv/bin/hermes`                            |
| Hermes-Profil für Aktionen | `infrastructure` (Default im Server)                                          |
| ausgeschlossene Boards     | `twl-netze-private`                                                           |

Der Listener `10.0.0.101:3927` wurde dem laufenden Node-Prozess zugeordnet. PM2 verwaltet den Prozess im Benutzerkontext `clawd`.

### 2.2 Reverse Proxy und öffentlicher Pfad

Der öffentliche Pfad verläuft über Cloudflare und den Apache-vHost auf dem Produktionshost:

```text
Browser
  -> Cloudflare
  -> Apache vHost hitl.stromdao.de auf Port 80
  -> http://10.0.0.101:3927/
  -> agentos-hitl-cockpit
```

Aktive Apache-Konfiguration:

```text
/etc/apache2/sites-enabled/hitl-stromdao.conf
```

Quellkonfiguration:

```text
/etc/apache2/sites-available/hitl-stromdao.conf
```

Verifizierter Upstream:

```apache
ProxyPass / http://10.0.0.101:3927/ retry=0 timeout=60
ProxyPassReverse / http://10.0.0.101:3927/
```

`apache2ctl -S` ordnete `hitl.stromdao.de` dem aktiven vHost zu. Ein öffentlicher Zugriff ohne Token lieferte erwartungsgemäß HTTP 401. Ein öffentlicher Zugriff mit dem vorhandenen URL-Token und Browser-User-Agent lieferte für `/api/health` HTTP 200.

### 2.3 Quellstand und Reproduzierbarkeit

Repository-Wurzel:

```text
/home/clawd/.openclaw/workspace/cernion-energy-tools
```

Aufnahmestand des übergeordneten Repositories:

```text
Branch: release/v0.99.19
HEAD: e5205e3f64fa55509964e2930a5fb1489b68b07a
Remote: git@github.com:energychain/cernion-energy-tools.git
```

Wichtiger Baseline-Befund: `hitl-cockpit/` und `agent-operating-system/` waren bei der Aufnahme unversionierte Verzeichnisse im bereits stark vorveränderten Arbeitsbaum. Der produktive Cockpit-Stand ist deshalb nicht allein aus dem Git-Commit reproduzierbar. Bis diese Verzeichnisse kontrolliert versioniert sind, ist die AP-0-Laufzeitsicherung der verbindliche Last-Known-Good-Stand.

### 2.4 Last-Known-Good-Dateien

| Datei               | SHA-256 vor AP-0-Testergänzungen                                   |
| ------------------- | ------------------------------------------------------------------ |
| `package.json`      | `f8485ac79812d52d7155846a43d04281159176aa1b8ef69943d279bdfcd543dd` |
| `server.js`         | `91a9d12611a55b74ac8f8edbd6a631b2c0137f9346b599800e67f41f5a8c8098` |
| `public/app.js`     | `073e0904931bcd5da398321cea10e9d788b5142924c1db53e5a820d2cd2dba2d` |
| `public/index.html` | `36f8e63cede73be92d5dc78bc69924dc46f3ad65179f4235107a2d674e3b8f75` |

Secret-freie, checksum-verifizierte Laufzeitsicherung:

```text
/home/clawd/.hermes/backups/agentos-hitl-cockpit/ap0-20261108T124416Z/
```

Inhalt:

```text
runtime/package.json
runtime/server.js
runtime/public/app.js
runtime/public/index.html
pm2-metadata.json
apache-hitl-stromdao.conf
board-inventory.json
SHA256SUMS.json
```

Die Sicherung enthält keine Tokenwerte und keine Task-Bodies. Ein Restore-Dry-Run in ein temporäres Verzeichnis sowie die Prüfung aller sieben manifestierten Dateien waren erfolgreich.

### 2.5 Konfiguration und Secrets

Relevante Umgebungsnamen:

```text
HITL_COCKPIT_HOST
HITL_COCKPIT_PORT
HITL_COCKPIT_TOKEN oder TOKEN
HERMES_HOME
HERMES_PROFILE
HITL_COCKPIT_AUTHOR
HITL_COCKPIT_EXCLUDE_BOARDS
HERMES_BIN
NODE_ENV
```

Secret-Regeln:

1. Tokenwerte werden weder in Git noch in Fixtures, Berichte, Screenshots, Logs oder Backups übernommen.
2. Der vorhandene PM2-Prozess besitzt einen Token; nur das Vorhandensein wurde verifiziert.
3. Der aktuelle Übergangszustand akzeptiert Token als Query-Parameter oder `Authorization: Bearer` am Node-Endpunkt. Der verifizierte öffentliche Browserpfad nutzt den Query-Parameter.
4. Tokenrotation und Session-Cookie-Migration gehören nicht zu AP 0.

### 2.6 Datenquellen

Das Cockpit liest SQLite-Datenbanken unter:

```text
/home/clawd/.hermes/kanban/boards/<board>/kanban.db
```

Aufnahmezustand:

| Merkmal                                      |                Wert |
| -------------------------------------------- | ------------------: |
| Kanban-Boards mit Datenbank                  |                  16 |
| Tasks über alle 16 Boards                    |              32.957 |
| ausgeschlossene private Boards               | `twl-netze-private` |
| `/api/tasks` sichtbare Einträge bei Aufnahme |                  89 |
| in der Antwort vertretene Boards             |                   5 |
| Board-Lesefehler                             |                   0 |
| sichtbare Statuswerte                        |      89 × `blocked` |

Die vollständige, body-freie Board-/Statusaufnahme liegt in `board-inventory.json` der Laufzeitsicherung. Sie enthält Boardnamen, Datenbankgröße, Taskanzahl, Statusverteilung und Schema-Hash, aber keine Task-Inhalte.

Das Cockpit verändert kein eigenes persistentes Datenmodell. Schreibaktionen werden über die Hermes-Kanban-CLI direkt auf das jeweilige Quellboard ausgeführt. Deshalb dürfen Kanban-Datenbanken bei einem Cockpit-Rollback nicht pauschal auf einen alten Snapshot zurückgesetzt werden.

### 2.7 Legacy-Auswahlvertrag

`GET /api/tasks` liest pro nicht ausgeschlossenem Board maximal 80 Karten mit:

```sql
status = 'blocked'
OR (status = 'scheduled' AND block_kind = 'needs_input')
```

Sortierung pro Board:

```text
priority DESC, created_at ASC
```

Antwortfelder pro Karte:

```text
id, title, body, assignee, status, priority, created_by, created_at,
started_at, completed_at, tenant, result, block_kind, project_id,
board, comments, attachments
```

Kommentare sind auf acht aktuelle Einträge pro Karte begrenzt, Attachments auf 20 Metadatensätze. Attachment-Binaries werden nicht durch `/api/tasks` ausgeliefert.

Sanitizierte Vertragsfixture:

```text
hitl-cockpit/test/fixtures/current-api-tasks.json
```

Die Produktionsbeobachtung in der Fixture ist ein zeitpunktbezogener Nachweis und keine dauerhaft festgeschriebene Kartenanzahl.

### 2.8 Legacy-API und Aktionen

| Methode | Pfad                               | Semantik                                                                    |
| ------- | ---------------------------------- | --------------------------------------------------------------------------- |
| GET     | `/api/health`                      | Prozess-, Port-, `HERMES_HOME`- und Ausschlussstatus                        |
| GET     | `/api/tasks`                       | wartende Legacy-HITL-Karten                                                 |
| POST    | `/api/tasks/:board/:task/approve`  | `hermes kanban unblock` mit Auditgrund                                      |
| POST    | `/api/tasks/:board/:task/reject`   | Auditkommentar; bei `running`/`ready` zusätzlich `block --kind needs_input` |
| POST    | `/api/tasks/:board/:task/question` | Kommentar erforderlich; bei `running`/`ready` zusätzlich Blockade           |
| POST    | `/api/tasks/:board/:task/close`    | bei `scheduled` zuerst unblock; danach `complete` mit Result und Summary    |

Board-Slugs und Task-IDs werden vor CLI-Aufrufen validiert. `twl-netze-private` wird standardmäßig ausgeschlossen.

### 2.9 Legacy-UX

Die bestehende Oberfläche bietet:

1. Suche über Board, Task-ID, Owner und Text.
2. Karten mit Titel, Body-Vorschau, Owner, Priorität und Zeitstempel.
3. Detailansicht mit vollständigem Body, Result, Kommentaren und Attachment-Metadaten.
4. Aktionen `Freigeben`, `Ablehnen`, `Rückfrage` und `Schließen`.
5. Anzeige der sichtbaren Entscheidungsanzahl, ausgeschlossener Boards und Board-Lesefehler.

### 2.10 Logs, Health und Monitoring

PM2-Logs:

```text
/home/clawd/.pm2/logs/agentos-hitl-cockpit-out.log
/home/clawd/.pm2/logs/agentos-hitl-cockpit-error.log
```

Apache-Logs:

```text
/var/log/apache2/hitl-stromdao-access.log
/var/log/apache2/hitl-stromdao-error.log
```

Der Benutzer `clawd` kann die Apache-Logs nicht lesen. Für Incident-Analyse ist root-/sudo-Zugriff erforderlich. Die PM2-Out- und Error-Logs waren bei der Aufnahme leer.

Healthchecks:

```text
intern:  GET http://10.0.0.101:3927/api/health
extern:  GET https://hitl.stromdao.de/api/health?token=<aus sicherem Runtime-Kontext>
```

Verifizierte Ergebnisse:

```text
intern autorisiert:   HTTP 200
intern nicht autorisiert: HTTP 401
extern nicht autorisiert: HTTP 401
extern autorisiert mit Browser-User-Agent: HTTP 200
```

Es existiert kein in AP 0 identifiziertes dediziertes Cockpit-Monitoring jenseits von PM2, Listenerprüfung, Apache/Cloudflare und dem Health-Endpunkt.

### 2.11 Automatisierte Baseline-Tests

Datei:

```text
hitl-cockpit/test/baseline.test.js
```

Die Tests starten einen isolierten Cockpit-Prozess gegen temporäre SQLite-Boards und eine stubbed Hermes-CLI. Produktive Boards werden weder gelesen noch geschrieben.

Abgedeckt sind:

1. sanitizierte Fixture und Legacy-Feldvertrag;
2. Authentifizierung und `/api/health`;
3. Filterung auf `blocked` und `scheduled + needs_input`;
4. Ausschluss von `twl-netze-private`;
5. Erreichbarkeit und CLI-Semantik der vier Legacy-Aktionen.

Verifikation am 2026-11-08:

```text
npm test:      4 Tests, 4 bestanden, 0 fehlgeschlagen
npm run check: server.js und public/app.js syntaktisch gültig
```

## 3. Rollback-Vertrag

### 3.1 Schutzziel

Jede Management-Cockpit-Iteration muss auf die hier fixierte Legacy-Laufzeit zurückfallen können, ohne Kanban-Boards, Kommentare, Entscheidungen oder während der Iteration entstandene Geschäftsdaten zu verlieren.

Der Rückfall darf ausschließlich Cockpit-Code, statische Assets und neue, ableitbare Managementprojektionen betreffen. Hermes Kanban bleibt unangetastet.

### 3.2 Verbindlicher Last-Known-Good-Stand

Bis ein späterer Stand nach denselben Gates ausdrücklich zum neuen Last-Known-Good erklärt wird, gilt:

```text
/home/clawd/.hermes/backups/agentos-hitl-cockpit/ap0-20261108T124416Z/runtime
```

Die zugehörigen Prüfsummen stehen in:

```text
/home/clawd/.hermes/backups/agentos-hitl-cockpit/ap0-20261108T124416Z/SHA256SUMS.json
```

### 3.3 Änderungen, die rückrollbar sein müssen

1. `hitl-cockpit/server.js` und alle später extrahierten Server-/API-Module.
2. `hitl-cockpit/public/` und alle späteren UI-Assets.
3. `hitl-cockpit/package.json` und Cockpit-lokale Dependencies.
4. PM2-Script-, CWD-, Port- und Runtime-Konfiguration.
5. Apache-/Proxy-Zuordnung für `hitl.stromdao.de`.
6. Feature Flags der Managementsicht.
7. Neue Projektionsdatenbanken und Projektionsjobs.
8. Cockpit-spezifische Cronjobs und Hintergrundprozesse.

### 3.4 Additive-only-Regeln bis Write-Aktivierung

Bis Welle D gelten folgende Regeln:

1. Keine Änderung der bestehenden `/api/health`, `/api/tasks` oder vier Legacy-Action-Verträge.
2. Neue Read APIs erhalten eigene Pfade unter `/api/management/`.
3. Neue UI-Sichten bleiben hinter Feature Flags; Legacy bleibt direkt erreichbar.
4. Neue Daten liegen außerhalb der Kanban-Datenbanken und müssen vollständig neu aufbaubar sein.
5. Keine Migration oder Umdeutung bestehender `blocked`-/`scheduled`-Karten.
6. Keine Änderung von Apache, PM2 oder Tokenhandling ohne separate Sicherung und Smoke-Test.
7. Kein TWL-private-Rohinhalt in Fixture, Projektion, UI, Log oder Telemetrie.

### 3.5 Vor jedem Deployment zu sichern

Vor einer produktiven Iteration müssen in einem neuen zeitgestempelten Verzeichnis gesichert werden:

```text
hitl-cockpit/package.json
hitl-cockpit/server.js
hitl-cockpit/public/
alle neuen hitl-cockpit/lib-, config- und bin-Dateien
sanitizierte PM2-Metadaten ohne Environment-Werte
betroffene Apache-/Proxy-Konfiguration
Feature-Flag-Namen und gesetzte Nicht-Secret-Werte
Schema-/Versionsstand der Managementprojektion
body-freie Boardanzahl und Statussummen unmittelbar vor Deployment
```

Kanban-Datenbanken werden für einen Cockpit-Code-Rollback nicht überschrieben. Normale vorhandene Systembackups der Kanban-Daten bleiben davon unberührt.

### 3.6 Rollback-Trigger

Rollback wird ohne weitere Abwägung ausgelöst, wenn mindestens eines der folgenden Kriterien nach Deployment erfüllt ist:

1. `/api/health` liefert nicht innerhalb von 60 Sekunden stabil HTTP 200.
2. `/api/tasks` liefert nicht HTTP 200 oder bricht den dokumentierten Feldvertrag.
3. Legacy-UI ist nicht erreichbar oder nicht bedienbar.
4. Eine Legacy-Aktion führt den falschen Hermes-Befehl aus, wird doppelt ausgeführt oder schreibt auf das falsche Board.
5. `twl-netze-private` oder anderer nicht freigegebener sensitiver Kontext wird sichtbar.
6. Board-Anzahl oder Board-Daten ändern sich ohne dazugehörige bewusst ausgeführte Fachaktion.
7. PM2 geht in eine Restart-Schleife oder der Port 3927 ist nicht stabil gebunden.
8. Proxy liefert wiederholt 5xx oder zeigt auf einen anderen Upstream.
9. Eine neue Projektion schreibt in Quellboards oder verhindert die Legacy-Sicht.
10. Eine neue Write-Aktion ist nicht idempotent, nicht auditiert oder nicht exakt zurückgelesen.

Bei einem möglichen Datenschutz-/TWL-Leak wird zusätzlich der öffentliche Zugriff sofort deaktiviert beziehungsweise auf die Legacy-Sicherung zurückgestellt und der Vorfall dokumentiert.

### 3.7 Rollen und Ausführungsrecht

Rollback ausführen dürfen:

1. Infrastructure-Agent innerhalb dieses Vertrags;
2. DevOps-Agent innerhalb dieses Vertrags;
3. Thorsten als Betreiber/Geschäftsführung.

Für einen durch die obigen Trigger ausgelösten reinen Cockpit-Code-Rollback ist keine zusätzliche HITL-Freigabe nötig. Der Rollback ist eine schadensbegrenzende, reversible Betriebsmaßnahme. Jede Ausführung muss nachträglich mit Zeitpunkt, Ursache, vorherigem Stand, Zielstand und Smoke-Ergebnis im AgentOS dokumentiert werden.

Nicht von diesem Mandat gedeckt sind:

1. Rücksetzen von Kanban-Datenbanken;
2. Löschen von Nutzerentscheidungen oder Kommentaren;
3. Tokenrotation;
4. DNS-/Cloudflare-Änderungen;
5. Änderung anderer PM2-Prozesse;
6. Änderungen außerhalb des Cockpit-/Proxy-Pfads.

### 3.8 Zielzeiten

| Ziel                                        | Vertrag                                              |
| ------------------------------------------- | ---------------------------------------------------- |
| Entscheidung Rollback statt Weiterdebugging | spätestens 5 Minuten nach bestätigtem Trigger        |
| Wiederherstellung Legacy-Runtime            | höchstens 10 Minuten                                 |
| technischer Smoke nach Restore              | höchstens weitere 5 Minuten                          |
| Managementprojektion                        | darf länger ausfallen; Legacy muss verfügbar bleiben |

Wenn die Legacy-Runtime nach zehn Minuten nicht wieder verfügbar ist, wird der Vorgang als Infrastructure Incident behandelt und der öffentliche Pfad nötigenfalls bis zur geklärten Wiederherstellung geschlossen.

### 3.9 Standard-Rollback ohne Dateirestore

Wenn nur die Managementsicht oder Projektion fehlerhaft ist und die Legacy-Runtime weiterhin funktioniert:

```text
1. MANAGEMENT_COCKPIT_WRITE_ENABLED=false
2. MANAGEMENT_COCKPIT_ENABLED=false oder Default-View auf legacy
3. Projektionsjob stoppen
4. pm2 restart agentos-hitl-cockpit --update-env
5. Legacy-Smoke ausführen
```

Die exakten Feature Flags werden erst in AP 4 eingeführt. Bis dahin ist dieser Pfad nicht erforderlich.

### 3.10 Vollständiger Runtime-Restore

Vor Ausführung einen Incident-Snapshot des fehlerhaften Stands anlegen. Danach als Benutzer `clawd`:

```bash
set -euo pipefail
APP=/home/clawd/.openclaw/workspace/cernion-energy-tools/hitl-cockpit
SNAP=/home/clawd/.hermes/backups/agentos-hitl-cockpit/ap0-20261108T124416Z/runtime
FAILED=/home/clawd/.hermes/backups/agentos-hitl-cockpit/failed-$(date -u +%Y%m%dT%H%M%SZ)

mkdir -p "$FAILED/public"
cp -a "$APP/package.json" "$APP/server.js" "$FAILED/"
cp -a "$APP/public/app.js" "$APP/public/index.html" "$FAILED/public/"

cp -a "$SNAP/package.json" "$SNAP/server.js" "$APP/"
cp -a "$SNAP/public/app.js" "$SNAP/public/index.html" "$APP/public/"

cd "$APP"
node --check server.js
node --check public/app.js
pm2 restart agentos-hitl-cockpit --update-env
```

Wenn der PM2-Prozess nicht mehr existiert:

```bash
pm2 resurrect
pm2 show agentos-hitl-cockpit
```

Die vorhandene PM2-Dump-Datei wurde geprüft und enthält genau einen Eintrag für `agentos-hitl-cockpit`. Falls `pm2 resurrect` nicht möglich ist, darf der Prozess nur mit den bereits sicher vorliegenden Runtime-Secrets neu angelegt werden; Tokenwerte dürfen nicht aus Dokumenten rekonstruiert oder in die Shell-History geschrieben werden.

### 3.11 Proxy-Restore

Nur falls die Proxy-Konfiguration Teil der fehlerhaften Iteration war:

```bash
sudo cp -a \
  /home/clawd/.hermes/backups/agentos-hitl-cockpit/ap0-20261108T124416Z/apache-hitl-stromdao.conf \
  /etc/apache2/sites-available/hitl-stromdao.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Ein Apache-Restore ist nicht erforderlich, wenn der aktive vHost weiterhin auf `http://10.0.0.101:3927/` zeigt.

### 3.12 Umgang mit Daten aus der neuen Iteration

1. Kanban-Änderungen aus echten Nutzerentscheidungen bleiben erhalten.
2. Neue Managementprojektionen werden nicht zurück in Kanban restauriert und dürfen gelöscht oder quarantänisiert werden, da sie ableitbar sind.
3. Audit-Ereignisse werden erhalten, auch wenn die Funktion zurückgerollt wird.
4. Während einer fehlerhaften Iteration entstandene neue Decisions/Topics werden exportiert oder quarantänisiert, nicht still gelöscht.
5. Bei unklarer Write-Auswirkung wird der betroffene Source Task exakt zurückgelesen und einzeln reconciled.
6. Kein globales Restore aller Board-Datenbanken für einen Cockpit-Fehler.

### 3.13 Verifikation nach Rollback

Der Rollback gilt erst als erfolgreich, wenn alle Punkte erfüllt sind:

1. `pm2 show agentos-hitl-cockpit` meldet `online` und keine Restart-Schleife.
2. `10.0.0.101:3927` ist gebunden.
3. interner autorisierter `/api/health` liefert HTTP 200 und `service=agentos-hitl-cockpit`.
4. öffentlicher Zugriff ohne Token liefert HTTP 401.
5. öffentlicher autorisierter Browserpfad liefert HTTP 200.
6. Legacy-HTML enthält `AgentOS HITL Cockpit`.
7. `/api/tasks` liefert HTTP 200, `errors=[]` oder dokumentierte bekannte Board-Fehler und den Legacy-Feldvertrag.
8. `excludedBoards` enthält `twl-netze-private`.
9. Boardanzahl vor und nach Rollback ist identisch. Neue fachliche Task-Änderungen während des Zeitfensters werden separat erklärt.
10. `npm test` und `npm run check` bestehen gegen den für den Zielstand vorgesehenen Teststand.
11. Keine produktive Testaktion wird gegen reale Boards ausgeführt. Action-Smokes nutzen ausschließlich temporäre Boards und stubbed Hermes.

### 3.14 Rollback-Smoke-Protokoll

Für jede Ausführung zu dokumentieren:

```text
Incident-/Deployment-ID:
Auslöser:
Rollback begonnen:
Quellstand/Backup:
Zielstand:
Boardanzahl vorher:
PM2-Status vorher:
Restore-Befehl/Mechanismus:
PM2-Status nachher:
/api/health intern:
/api/health extern:
/api/tasks Status und Fehleranzahl:
TWL-Ausschluss geprüft:
Boardanzahl nachher:
Legacy-UI geprüft:
Tests:
Offene Reconciliation:
Rollback abgeschlossen:
Ausgeführt durch:
```

## 4. Bekannte Lücken nach AP 0

1. Der produktive Cockpit-Code ist noch nicht versioniert; die Laufzeitsicherung kompensiert dies nur vorläufig.
2. Die öffentliche Authentifizierung verwendet weiterhin einen statischen URL-Token.
3. Es gibt noch keinen dedizierten Cockpit-Healthmonitor oder automatischen Rollback.
4. Apache-Logs sind für `clawd` nicht lesbar.
5. Es gibt noch keine Staging-Instanz des Cockpits; die Action-Vertragstests arbeiten deshalb gegen temporäre lokale Boards.
6. Die `/api/tasks`-Antwort kann wegen des Limits von 80 Karten je Board keine vollständige globale Blockerzahl garantieren.
7. Der bestehende Legacy-Status `blocked` enthält fachlich heterogene Vorgänge; AP 0 dokumentiert das Verhalten, ändert es aber nicht.

Diese Lücken blockieren AP 1 nicht, solange AP 1 rein lesend, getrennt, neu aufbaubar und ohne produktive Quellmutation umgesetzt wird.

## 5. AP-0-Abnahme

| Kriterium                                                    | Status  |
| ------------------------------------------------------------ | ------- |
| PM2-Prozess, CWD, Script, Runtime und Port read-only erhoben | erfüllt |
| Reverse Proxy und Upstream verifiziert                       | erfüllt |
| interner und öffentlicher Healthpfad verifiziert             | erfüllt |
| `/api/tasks` sanitiziert erfasst                             | erfüllt |
| Legacy-Aktionen gegen temporäre Boards getestet              | erfüllt |
| TWL-private-Ausschluss getestet                              | erfüllt |
| secret-freie Laufzeitsicherung erstellt                      | erfüllt |
| Prüfsummen und Restore-Dry-Run verifiziert                   | erfüllt |
| Rollback-Trigger, Rollen, RTO und Datenregeln festgelegt     | erfüllt |
| Produktive Boards oder Prozesse verändert                    | nein    |

AP 0 ist damit als dokumentierte und automatisiert geprüfte Baseline nutzbar. Vor AP 1 sollte die Iteration in einen kontrollierten Branch/Worktree überführt werden; dabei dürfen die umfangreichen fremden Änderungen des aktuellen Arbeitsbaums nicht übernommen oder zurückgesetzt werden.
