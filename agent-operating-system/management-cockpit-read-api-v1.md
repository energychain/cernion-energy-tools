# Management-Cockpit: Read-API und Parallelbetrieb v1

Stand: 2026-11-08
Arbeitspaket: AP 4
Status: im isolierten Worktree implementiert, nicht produktiv aktiviert

## Betriebsmodus

AP 4 ergänzt das bestehende HITL-Cockpit additiv. Die Legacy-Oberfläche und ihre Endpunkte bleiben der Standard und werden nicht umgedeutet.

Feature Flags:

- `MANAGEMENT_COCKPIT_ENABLED=false` ist der sichere Default.
- `MANAGEMENT_COCKPIT_WRITE_ENABLED=false` bleibt in AP 4 zwingend deaktiviert.
- `MANAGEMENT_COCKPIT_SHADOW_ONLY=true` ist der sichere Default.
- `MANAGEMENT_COCKPIT_DEFAULT_VIEW=legacy` hält die bestehende Oberfläche führend.
- `MANAGEMENT_COCKPIT_DATABASE` kann den Standardpfad überschreiben.
- Standarddatenbank: `$HERMES_HOME/management-cockpit/management.db`.

Bei deaktiviertem Management-Cockpit gilt:

- `/` bleibt die Legacy-HITL-Oberfläche.
- `/api/health`, `/api/tasks` und die vier Legacy-Aktionen verhalten sich unverändert.
- `/api/management/config` liefert den deaktivierten Feature-Status.
- `/management` und die übrigen Management-Endpunkte liefern HTTP 404.

Bei aktiviertem Management-Cockpit gilt:

- `/` bleibt weiterhin die Legacy-HITL-Oberfläche.
- `/management` stellt die parallele Managementsicht bereit.
- Die Navigation bietet Lage, Entscheidungen, Abteilungen, Themen und einen Rückweg zur Legacy-HITL-Sicht.
- Alle Management-Endpunkte sind ausschließlich lesend.

## Read-API

Seit AP 14 verwenden Browser und APIs nach einem einmaligen Navigation-Bootstrap eine kurzlebige Session. Query-Token authentifizieren keine API-Aufrufe; statischer Bearer-Zugriff ist standardmäßig deaktiviert. Der vollständige Zielvertrag steht in `management-cockpit-session-auth-v1.md`.

| Methode | Pfad                                   | Zweck                                                                           |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| GET     | `/api/management/config`               | Feature- und Betriebsmodus ohne Datenbankzugriff                                |
| GET     | `/api/management/summary`              | verdichtete Managementlage                                                      |
| GET     | `/api/management/metadata`             | Boardzahl, Quellkarten und Projektionsstand                                     |
| GET     | `/api/management/overview`             | verdichtete Lage mit Zählwerten, Entscheidungen, aktiven Themen und Ergebnissen |
| GET     | `/api/management/decisions`            | paginierbare Governance-Entscheidungen                                          |
| GET     | `/api/management/decisions/:id`        | einzelne Governance-Entscheidung                                                |
| GET     | `/api/management/departments`          | nach verantwortlichem Agenten verdichteter JF-Stand                             |
| GET     | `/api/management/departments/:agentId` | verdichteter Stand eines Agenten                                                |
| GET     | `/api/management/topics`               | paginierbare Managementthemen                                                   |
| GET     | `/api/management/topics/:topicId`      | einzelnes Managementthema                                                       |
| GET     | `/api/management/outcomes`             | paginierbare belegte Ergebnisse                                                 |
| GET     | `/api/management/risks`                | Scope-Verletzungen und Risikoeskalationen                                       |
| GET     | `/api/management/wakeups`              | echte Wiedervorlagen der Projektion                                             |
| GET     | `/api/management/digest`               | paginierbare, verdichtete Digest-Signale mit Quellprovenienz                    |
| GET     | `/api/management/scopes`               | sanitizierter, read-only Scope-Status                                           |
| GET     | `/api/management/telemetry`            | Labelverteilung und Projektionsmetadaten                                        |

Unterstützte Query-Parameter:

- `limit`: 0 bis 100, Default 50
- `offset`: 0 bis 1.000.000, Default 0
- `q`: Textsuche, auf 200 Zeichen begrenzt
- Entscheidungen: `decisionClass`, `status`
- Themen: `owner`, `state`

POST, PUT, PATCH und DELETE unter `/api/management/` liefern grundsätzlich HTTP 405 mit `read_only_api`. Einzige Ausnahmen sind die sechs in AP 6 definierten Decision-Actions. Sie simulieren ausschließlich im Shadow-Modus, antworten bei Erfolg mit HTTP 202 und schreiben oder persistieren nichts.

## Fehlervertrag

- Feature deaktiviert: HTTP 404, `management_cockpit_disabled`
- Projektion fehlt, ist ungültig oder nicht lesbar: HTTP 503, `management_projection_unavailable`
- unbekannter Managementpfad: HTTP 404, `not_found`
- Schreibversuch: HTTP 405, `read_only_api`

Fehlerantworten geben keine Datenbankpfade, Python-Tracebacks oder sensitiven Inhalte aus.

## Datenschutz und Isolation

Die Read-API öffnet SQLite ausschließlich mit `mode=ro` und `PRAGMA query_only=ON`. Sie führt keine Migration aus und erzeugt keine Datenbankdatei.

Zusätzlich zur vorgelagerten Projektionsfilterung werden bei jeder Managementabfrage ausgeschlossen:

- Source Board `twl-netze-private`
- Sensitivitäten `twl-private`, `twl-netze-private`, `private-quarantine`, `private`, `unclear` und `mixed-sensitive`
- Themenreferenzen, die auf das private Board verweisen

Tests prüfen Prüfsumme, Dateigröße und Änderungszeit der Projektionsdatenbank vor und nach allen API-Lesezugriffen.

### Digest-Provenienz

`GET /api/management/digest` liest ausschließlich die abgeleitete Managementprojektion. Jeder Eintrag enthält eine knappe Signalbeschreibung sowie `provenance` mit Source Board und Source Task ID, damit die Herkunft prüfbar bleibt, ohne die Quelle erneut zu öffnen. Der Endpunkt schreibt weder in die Projektion noch in ein Quellsystem.

Die Antwort enthält keine rohen TWL-Inhalte und keine privaten Quelltexte. Digest-Zeilen vom privaten Board sowie Zeilen, die auf Themen mit einer der oben genannten sensitiven Einstufungen oder einer Referenz auf das private Board verweisen, werden nochmals in der Read-API ausgeschlossen. Die Provenienz ist ein Quellverweis, kein Export des Kanban-Bodys, von Kommentaren, Anhängen oder sonstigen privaten Rohdaten.

## Legacy-Vertrag

AP 4 verändert keine Semantik und kein Antwortfeld der bestehenden Pfade:

- `GET /api/health`
- `GET /api/tasks`
- `POST /api/tasks/:board/:task/approve`
- `POST /api/tasks/:board/:task/reject`
- `POST /api/tasks/:board/:task/question`
- `POST /api/tasks/:board/:task/close`

Der vorhandene AP-0-Vertragstest bleibt das Rollback-Gate.

## Aktivierung und Rückfall

Die Arbeit ist noch nicht deployt. Eine spätere Aktivierung erfolgt zunächst mit:

```text
MANAGEMENT_COCKPIT_ENABLED=true
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
```

Rollback der parallelen Sicht:

```text
MANAGEMENT_COCKPIT_ENABLED=false
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
```

Danach wird nur der Cockpit-Prozess mit unverändertem Legacy-Codepfad neu geladen. Die Managementprojektion ist vollständig ableitbar und darf bei einem Fehler separat neu aufgebaut werden. Kanban-Boards werden nicht zurückgesetzt.
