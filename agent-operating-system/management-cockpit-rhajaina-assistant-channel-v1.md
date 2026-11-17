# Management-Cockpit: Rhajaina Assistant Channel v1

Stand: 2026-11-11
Status: produktiver interner Low-Risk-Kanal
Verbindlicher Betriebsvertrag: `management-cockpit-production-contract-v3.md`

## Zweck und Betriebsstatus

Der Assistant Channel verbindet das Geschäftsführer-Cockpit mit dem bestehenden Hermes-Profil `rhajaina`. Er ist die persönliche Frontdoor für allgemeine Geschäftsführerhinweise und objektgebundene Aufträge. Matrix und Hermes Kanban bleiben operative Backends; das Cockpit ist die Management-Control-Plane.

Aktiv ist der Modus `low_risk`, in der UI „Assistenz · begrenzte Aktionen“. Bestätigte Low-Risk-Writes und Matrix-Handoffs nach erfolgreichem Kanban-Readback sind produktiv aktiviert. Die Management-Decision-API bleibt davon getrennt im Shadow-Modus.

Die maschinenlesbare Betriebswahrheit steht in `../hitl-cockpit/config/production-contract.json`. Der Health-Endpunkt vergleicht sie mit den tatsächlich geladenen Runtime-Flags. Historische Wellen-/UAT-Aussagen beschreiben nur den damaligen Rolloutschritt.

## Produktive Wirkungskette

Der freigegebene Ablauf lautet:

1. Thorsten öffnet einen globalen oder objektgebundenen Rhajaina-Dialog.
2. Rhajaina liefert eine Antwort und gegebenenfalls einen typisierten Vorschlag.
3. Das Cockpit zeigt Aktion, Ziel, Zuständigen und Wirkung vor der Ausführung.
4. Thorsten bestätigt den Vorschlag ausdrücklich.
5. Der Server löst genau eine autorisierte Quellkarte auf und prüft Vorzustand sowie Fingerprint.
6. Der Executor führt genau eine allowlistete Low-Risk-Aktion aus.
7. Der konkrete Kanban-Zustand wird zurückgelesen und als persistentes Receipt gespeichert.
8. Erst danach wird der Handoff in einen serverseitig belegten sicheren Matrix-Fachraum gesendet.
9. Raum und Event-ID werden direkt zurückgelesen und im Receipt festgehalten.
10. Replays liefern dasselbe Receipt und dieselbe Event-ID ohne zweite Nebenwirkung.

Der Produktionsnachweis `rhajaina-assistant-channel-production-smoke-v1.md` belegt diese Kette einschließlich Idempotenz nach einem echten Prozessneustart.

## Ein-Klick-Kontext und Themenwechsel

`Mit Rhajaina besprechen` bindet ein Topic, eine Decision, eine Abteilung, ein Outcome, ein Risiko oder eine Wiedervorlage sichtbar als strukturiertes Kontext-Attachment an einen eigenen Objektthread.

Der Browser übermittelt nur `objectType` und `objectId`. Titel, Quellen, Sensitivität und fachlicher Inhalt werden serverseitig aus der Managementprojektion aufgelöst. Freie Browser-Payloads können keinen Kontext einschleusen.

Ein Klick auf ein anderes Managementobjekt wechselt in dessen Unterhaltung und zeigt den Themenwechsel. `Globales Gespräch / neues Thema` entfernt die Objektbindung per Klick. Während eines laufenden Runs wird kein Kontextwechsel ausgeführt.

Fehlt das Objekt, ist es privat, TWL-bezogen, unklar, gemischt-sensitiv oder zu groß, schlägt die Auflösung fail-closed fehl und Rhajaina wird mit diesem Kontext nicht aufgerufen.

## Kontext-Attachment und Dateien

Das strukturierte Cockpit-Objekt ist ein Kontext-Attachment. Es ist kein Binary-Upload.

Der aktuelle Kanal akzeptiert keine Dateien, lokalen Pfade, Drag-and-drop-Binaries oder Clipboard-Dateien. Screenshots, PDFs, EDIFACT-Dateien und Nextcloud-Dokumente benötigen einen späteren gesonderten Upload-, Malware-, Retention- und Löschvertrag. Sensible Inhalte dürfen nicht durch Einfügen in Freitext umgangen werden.

## Erlaubte Aktionsklassen

Genau fünf produktive Aktionen sind erlaubt:

| Aktion                  | Wirkung                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `ask_question`          | konkrete Rückfrage als auditierter Kommentar                |
| `archive_intake_noise`  | eindeutigen Intake als Rauschen fallabschließend schließen  |
| `delegate_followup`     | Folgeauftrag an einen expliziten oder belegten Agenten      |
| `schedule_wakeup`       | begründete Wiedervorlage mit Zeitpunkt und nächstem Schritt |
| `return_for_completion` | unvollständigen Vorgang mit Begründung zurückgeben          |

Jede Aktion benötigt eine explizite Bestätigung. Rhajaina darf keinen Zuständigen erfinden. Vorrang haben ein ausdrücklich genannter Agent und danach der belegte Assignee der ausgewählten Quellkarte. Bleibt die Zuständigkeit offen, fragt das Cockpit beim Ausführen nach; ohne Auswahl gilt `assignee_required`.

Owner- und Prioritätsänderungen gehören nicht zur aktuellen Low-Risk-Allowlist. Externe Kommunikation, Veröffentlichung, Preis, Vertrag, Zahlung, Budget, Deployment, destruktive Aktionen, Secrets, Datenschutzentscheidungen und TWL-private Kontexte bleiben gesperrt.

## Aggregierte Managementthemen

Ein aggregiertes Topic darf nur ausgeführt werden, wenn genau eine autorisierte operative Quelle bestimmbar ist. Die Auswahlreihenfolge ist:

1. explizite primäre Quelle einer Decision;
2. projektionsdefinierte Primärquelle eines Topics;
3. genau eine offene, explizit referenzierte Decision-Quelle;
4. genau eine verbleibende offene und autorisierte Quelle;
5. andernfalls fail-closed.

Mehrere gleichrangige offene Kandidaten, geschlossene Quellen, unbekannte Referenzen, private Boards, TWL-Kontexte und nicht im Attachment enthaltene Tasks bleiben ausgeschlossen.

## Runtime-Policy

Die produktive Policy wird außerhalb des Release-Artefakts unter
`/home/clawd/.hermes/runtime/agentos-hitl-cockpit/assistant-policy.json` gebunden. Ihr vertraglicher, secret-freier Inhalt ist:

| Feld                   | Produktiver Wert                 |
| ---------------------- | -------------------------------- |
| `enabled`              | `true`                           |
| `mode`                 | `low_risk`                       |
| `writesEnabled`        | `true`                           |
| `matrixHandoffEnabled` | `true`                           |
| `actionAllowlist`      | die fünf Low-Risk-Aktionsklassen |
| `transport.type`       | `cli`                            |
| `transport.safeMode`   | `true`                           |
| `transport.profile`    | `rhajaina`                       |
| `transport.toolset`    | `bot_room`                       |
| `transport.maxTurns`   | `1`                              |
| `transport.source`     | `tool`                           |
| `transport.extraArgs`  | leeres Array                     |

Inkonsistente Flags, unbekannte Aktionen, unsichere Transportwerte und zusätzliche CLI-Argumente verhindern den Start. Die Runtime-Policy enthält keine Matrix-Zugangsdaten.

Die versionierte `config/assistant-policy.json` bleibt der deaktivierte sichere Code-Default für lokale Starts. Die produktive Aktivierung erfolgt ausschließlich über den expliziten Runtime-Policy-Pfad. Der Unterschied ist beabsichtigt und wird im Health-Status gegen den produktiven Vertrag sichtbar gemacht.

## Persistenz und Idempotenz

Conversation, Message, Run, Proposal, Event, Summary und Receipt liegen in einer getrennten Assistant-SQLite-Datenbank. Die Datenbank ist persistent und Modus 0600. Kanban-Quellen und Assistant-Audit bleiben getrennte Zustände.

Ein Write-Erfolg wird erst nach exaktem Readback gespeichert. Receipts sind append-only. Proposal-ID, Idempotency-Key und Matrix-Handoff-Marker bleiben über Prozessneustarts stabil. Ein Replay prüft zuerst persistente Zustände und erzeugt weder einen zweiten Kanban-Write noch ein zweites Matrix-Event.

Teilwirkungen dürfen nicht als Erfolg erscheinen. Die produktive Reconciliation-Outbox persistiert Kanban-, Matrix- und Ergebnisstufen vor der jeweiligen Nebenwirkung. Nach einem Neustart erfolgt zuerst ein Readback; nur nachweislich fehlende oder idempotent wiederholbare Stufen werden erneut ausgeführt. Offene Fälle sind im Cockpit mit Owner, nächstem Prüftermin, Fehlercode und Auditereignissen sichtbar. Fälle über 24 Stunden werden einmalig an Rhajaina eskaliert.

## Matrix-Handoff

Matrix-Handoffs benötigen:

- erfolgreichen Kanban-Write und Readback;
- Topic- oder Decision-Kontext mit serverseitig belegtem sicheren Fachraum;
- stabilen Handoff-Marker aus der Proposal-ID;
- erlaubten Sender;
- Event-ID aus der Send-Antwort;
- direkten Event-Readback.

Fehlt der Raum, bleibt der Handoff pending. Es wird kein Raum erfunden oder automatisch angelegt. Private/TWL-Räume sind ausgeschlossen.

## Verifizierter Ergebnisrücklauf

Der Server synchronisiert Antworten aus gebundenen Matrix-Fachräumen kontinuierlich. Ein Fachagentenergebnis gilt nur bei exaktem Reply auf das gespeicherte Handoff-Event, gültigem Handoff-Marker, erwartetem Agentensender, passender Quellkarte und zweitem Kanban-Readback als verifiziert. Freitext ohne Maschinenvertrag wird lediglich als Hinweis klassifiziert.

Verifizierte Ergebnisse erscheinen genau einmal im ursprünglichen Rhajaina-Thread. „Erledigt“ ohne materielle Evidenz schließt keinen Fall. Die Operatoraktionen „Akzeptieren“, „Korrigieren“, „Fortsetzen“ und „Beenden“ sind idempotent; Korrektur und Fortsetzung erzeugen verknüpfte Folgerunden. Ein terminaler Abschluss wird erst nach erneutem Kanban-Readback in Topic, Agent Brief, Outcome und Verlauf projiziert.

## Telemetrie und Datenschutz

Assistant-Telemetrie enthält ausschließlich aggregierte Counts, terminale Latenzen, allowlistete Fehler- und Intentklassen sowie Größenwerte. Nicht exportiert werden Nachrichten, Bodies, Context-Payloads, IDs, Sessionnamen, Dateipfade, freie Fehlerwerte oder Zugangsdaten.

Telemetrie steuert keine Aktion, Freigabe oder Priorität. Die aktive Low-Risk-Lane wird ausschließlich durch Runtime-Policy, serverseitige Quellauflösung, Operatorbestätigung, Allowlist und Readback begrenzt.

## Health und Drift

`GET /api/health` zeigt unter `operatingStatus` den deklarierten Vertrag, die tatsächlichen Runtime-Modi, die Aktionsklassen und `aligned`. Transportpfad, Policy-Pfad, Matrix-Token und sonstige Secrets werden nicht ausgegeben.

`aligned=false` bedeutet, dass Runtime und produktiver Vertrag auseinanderlaufen. Es ist ein Betriebsfehler und muss vor einer Aussage über den aktiven Modus geklärt werden.

## Rollback und Incident

Der Assistant Channel wird sofort auf `read_only` beziehungsweise deaktiviert, wenn private Inhalte, eine falsche Quelle, falscher Zuständiger, Doppelwirkung, Readback-Abweichung, falscher Matrix-Raum, Auth-Bypass, Datenbankkorruption oder unkontrollierter Retry erkannt werden.

Rollback-Schritte:

1. neue Assistant-Ausführungen stoppen;
2. Runtime-Policy auf `read_only` mit deaktivierten Writes und Handoffs setzen oder Assistant deaktivieren;
3. Prozess kontrolliert neu laden;
4. Health, Legacy-Sicht, Managementsicht und Quellintegrität prüfen;
5. Assistant-Datenbank und Logs secret-frei sichern;
6. unklare Teilwirkungen einzeln reconciliieren;
7. kein globales Kanban-Restore durchführen.

Das Deaktivieren löscht keine Auditdaten und macht bereits ausgeführte Kanban- oder Matrix-Wirkungen nicht rückgängig.
