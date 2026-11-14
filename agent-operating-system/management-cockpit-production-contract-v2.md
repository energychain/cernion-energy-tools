# Management-Cockpit: Produktiver Betriebsvertrag v2

Stand: 2026-11-14
Status: verbindlicher aktueller Betriebsvertrag
Maschinenlesbare Fassung: `../hitl-cockpit/config/production-contract.json`

## 1. Geltung und Betriebswahrheit

Dieser Vertrag ist die einzige verbindliche Beschreibung des aktuellen produktiven Betriebszustands des Geschäftsführer-Cockpits. Historische AP-, Baseline-, Shadow- und UAT-Dokumente bleiben Nachweise ihres jeweiligen Zeitpunkts. Bei einem Widerspruch gilt dieser Vertrag zusammen mit der maschinenlesbaren Fassung.

Das Cockpit ist unter `https://hitl.stromdao.de/management` als primäre interne Geschäftsführeroberfläche aktiv. Hermes Kanban bleibt die operative Aufgabenwahrheit, Matrix der interne Arbeits- und Übergabekanal und die Management-SQLite eine abgeleitete Projektion. Die Legacy-HITL-Sicht unter `/` bleibt Rückfalloberfläche.

## 2. Aktiver Modus

Die aktuelle UI-Bezeichnung lautet „Assistenz · begrenzte Aktionen“. Der technische Assistant-Modus ist `low_risk`.

Aktive Runtime-Eigenschaften:

| Bereich                      | Verbindlicher Wert                     |
| ---------------------------- | -------------------------------------- |
| Managementsicht              | aktiviert                              |
| Management-Decision-API      | Shadow, keine direkten Decision-Writes |
| Default-View                 | `management`                           |
| Rhajaina Assistant Channel   | aktiviert                              |
| Assistant-Modus              | `low_risk`                             |
| bestätigte Low-Risk-Writes   | aktiviert                              |
| Matrix-Handoff nach Readback | aktiviert                              |
| produktive Auto-Ausführung   | deaktiviert                            |
| Assistant-Profil             | `rhajaina`                             |
| Matrix-Sender                | `@hermes-stromdao:matrix.stromdao.de`  |

Management-Decision-Aktionen und Assistant-Aktionen sind getrennte Pfade. `MANAGEMENT_COCKPIT_WRITE_ENABLED=false` und `MANAGEMENT_COCKPIT_SHADOW_ONLY=true` beschreiben die weiterhin nicht schreibende Decision-API. Der Assistant Channel darf trotzdem die unten genannten bestätigten Low-Risk-Aktionen ausführen, wenn seine eigene Runtime-Policy `writesEnabled=true` setzt.

## 3. Erlaubte produktive Aktionsklassen

Nach expliziter Bestätigung durch den authentifizierten Operator sind genau folgende internen Aktionsklassen erlaubt:

1. `ask_question`: eine konkrete Rückfrage an der autorisierten Quellkarte dokumentieren;
2. `archive_intake_noise`: einen eindeutig aufgelösten Intake ohne weiteren Handlungsbedarf mit Audittext fallabschließend schließen;
3. `delegate_followup`: einen Folgeauftrag an einen explizit genannten oder auf der Quellkarte belegten Agenten delegieren;
4. `schedule_wakeup`: eine begründete Wiedervorlage mit Zeitpunkt und nächstem Schritt setzen;
5. `return_for_completion`: einen unvollständigen Vorgang mit konkretem Grund zurückgeben.

Jede Ausführung benötigt:

- einen serverseitig aufgelösten, autorisierten Quellvorgang;
- genau eine zulässige Quellkarte oder eine fail-closed Ablehnung;
- explizite Bestätigung;
- einen stabilen Idempotency-Key;
- Vorzustand und Source-Fingerprint;
- exakten Kanban-Readback;
- ein persistentes Receipt;
- Matrix-Handoff erst nach erfolgreichem Write-Readback;
- Matrix-Event-Readback oder einen sichtbaren Pending-/Fehlerzustand.

Ein Chattext kann keinen Scope erzeugen, erweitern oder eine Bestätigung ersetzen.

## 4. Weiterhin gesperrte Wirkungen

Der Low-Risk-Vertrag erlaubt nicht:

- externe Kommunikation oder Veröffentlichung;
- Preis-, Angebots-, Vertrags-, Zahlungs- oder Budgetbindung;
- Deployment, Infrastrukturänderung oder destruktive Aktion;
- Secret-, Credential- oder Tokenverarbeitung;
- Datenschutzentscheidung oder Freigabe sensitiver Daten;
- TWL-private, Uslar-Rohkontext, Quarantäne oder gemischt-sensitive Inhalte;
- automatisch erfundene Zuständige;
- Owner- oder Prioritätsänderungen ohne einen späteren typisierten Scope-Vertrag;
- produktive Auto-Ausführung ohne Operatorbestätigung.

Mehrdeutigkeit, fehlende Quelle, fehlender Assignee, Scope-Lücke, Readback-Abweichung oder unsicherer Matrix-Raum führen fail-closed zu keiner weiteren Nebenwirkung.

## 5. Identitäten und Datenhaltung

Produktive Pfade:

| Zustand              | Pfad / Rolle                                                                         |
| -------------------- | ------------------------------------------------------------------------------------ |
| Managementprojektion | `/home/clawd/.hermes/management-cockpit/management.db`, abgeleitet und neu aufbaubar |
| Assistant-Audit      | `/home/clawd/.hermes/management-cockpit/assistant-channel.db`, persistent            |
| Kanban               | `/home/clawd/.hermes/kanban/boards`, System of Record                                |
| Runtime-Policy       | `/home/clawd/.hermes/runtime/agentos-hitl-cockpit/assistant-policy.json`             |

Die Runtime-Policy enthält keine Matrix-Zugangsdaten. Zugangsdaten werden ausschließlich aus gebundenem Laufzeitkontext beziehungsweise Vault-/Profilkonfiguration bezogen und dürfen weder Health-Antwort noch Dokumentation, Logs oder Artefakte erreichen.

Der produktive Matrix-Sender ist `@hermes-stromdao:matrix.stromdao.de`. Ein Handoff ist nur in einen serverseitig belegten sicheren Fachraum zulässig. Raum- und Event-ID werden im Receipt gespeichert und anhand der Event-ID zurückgelesen.

## 6. Maschinenlesbarer Status und Health

`GET /api/health` enthält `operatingStatus` mit:

- `contractId` und Vertragsstatus;
- deklariertem Modus und UI-Bezeichnung;
- tatsächlichen Management- und Assistant-Flags;
- aktiven Aktionsklassen;
- `aligned` und einer Liste abweichender Felder.

Die Management-Read-API enthält zusätzlich einen sanitisierten Projektionszustand mit
`lastAttempt`, `lastSuccess`, Alter, Lag, Quellabdeckung, Rückstand und ausschließlich
allowlist-basierten Fehlercodes. Die Projektion läuft als eigener beaufsichtigter Prozess mit
einem Start-zu-Start-Intervall von höchstens drei Minuten und einem harten Laufzeitbudget. Jeder
Lauf verwendet einen persistenten Lock und Checkpoint. Eine neue Projektion wird in einer
separaten Datenbank aufgebaut, auf Schema, Integrität und Datenschutzgrenzen geprüft und erst
danach atomar als neue Last-Known-Good-Projektion aktiviert.

Unveränderte Quellen werden anhand ihres deterministischen Fingerprints ohne erneuten
Projektionsaufbau bestätigt. Quelländerungen während eines Laufs, Teilfehler, Budgetüberschreitung
oder fehlende Quellen ersetzen die letzte gültige Projektion nicht. Sie werden als `stale` oder
`degraded` sichtbar. Bestätigte Assistant-Writes und Legacy-HITL-Writes brechen bei veralteter,
beeinträchtigter oder nicht lesbarer Projektion fail-closed ab.

Die Health-Antwort enthält keine Policy-Dateipfade, Transportpfade, Tokens, Cookies oder Matrix-Zugangsdaten. `aligned=false` ist ein Betriebsfehler und verbietet die Behauptung, die Runtime entspreche diesem Vertrag. Der Prozess darf für Diagnose und Rückfall weiterhin erreichbar bleiben.

## 7. Persistente Reconciliation und Ergebnisrücklauf

Vor jeder externen Nebenwirkung wird ein persistenter Outbox-Eintrag angelegt. Offene Kanban-, Matrix- und Ergebnisstufen werden nach Neustarts wieder aufgenommen. Der Worker führt zuerst einen autoritativen Readback durch und wiederholt eine Nebenwirkung nur, wenn sie nachweislich nicht erfolgt oder über den stabilen Idempotency-Key sicher wiederholbar ist. Teilfehler bleiben in der Cockpit-Lane „Störungen“ sichtbar; sie besitzen Owner, nächsten Prüftermin, Fehlercode und append-only Auditereignisse. Über 24 Stunden offene Fälle werden einmalig an Rhajaina eskaliert, ohne wiederholte Matrix-Benachrichtigungen.

Fachagentenergebnisse werden nur dann als verifiziertes Ergebnis übernommen, wenn Matrix-Raum, Reply-Event, Handoff-Marker, erwarteter Sender, Quellkarte und zweiter Kanban-Readback zusammenpassen. Freie Antworten ohne diesen Vertrag bleiben Hinweise. Ein Abschluss benötigt materielle Evidenz und einen terminalen Kanban-Readback. Ergebnisse erscheinen genau einmal im ursprünglichen Rhajaina-Thread und können dort akzeptiert, korrigiert, fortgeführt oder beendet werden. Korrektur und Fortsetzung erzeugen eine verknüpfte neue Runde statt eines Doppelauftrags.

## 8. Produktiver Nachweis

Der Betriebsnachweis `rhajaina-assistant-channel-production-smoke-v1.md` belegt für einen realen Low-Risk-Fall:

`Rhajaina-Vorschlag → Bestätigung → Kanban-Write → Kanban-Readback → Receipt → Matrix-Send → Matrix-Event-Readback`

Zusätzlich ist die Idempotenz unmittelbar und nach einem echten PM2-Neustart belegt. Derselbe Vorschlag erzeugte kein zweites Receipt, keinen zweiten Kanban-Kommentar und kein zweites Matrix-Event.

Der Nachweis erweitert die erlaubten Aktionsklassen nicht. Die produktive AP-19–21-Abnahme dokumentiert zusätzlich kontinuierliche Projektionsläufe, Reconciliation-Runtime, Ergebnis-Ingest, Datenbankintegrität, Browser-UAT und Prozesspersistenz.

## 9. Betrieb und Verantwortlichkeiten

| Aufgabe                                | Primär           | Mitwirkung                    |
| -------------------------------------- | ---------------- | ----------------------------- |
| fachliche Führung und Bestätigung      | Geschäftsführung | Rhajaina                      |
| Routing, Rückfragen und Nachverfolgung | Rhajaina         | Fachagenten                   |
| Cockpit-Code und Release               | DevOps           | Infrastructure                |
| Prozess, Backup, Health und Rollback   | Infrastructure   | DevOps                        |
| Projektionsqualität                    | Infrastructure   | Rhajaina                      |
| Incident mit sensitiven Daten          | Infrastructure   | Rhajaina und Geschäftsführung |

Der aktuelle Vertrag macht das Cockpit zur produktiv nutzbaren primären Geschäftsführeroberfläche für die freigegebene Low-Risk-Lane. Er behauptet noch keine vollständige Abdeckung aller Führungsprozesse oder die Ablösung der Backend-Fallbacks.

## 10. Rollback

Der schnellste Rückfall deaktiviert den Assistant Channel oder setzt seine Runtime-Policy auf `read_only`, deaktiviert Assistant-Writes und Matrix-Handoff und stellt die Legacy-Sicht als Default bereit. Danach wird der Cockpit-Prozess kontrolliert mit der rückgerollten Policy neu geladen und Health, Legacy-Sicht sowie Quellintegrität werden geprüft.

Ein Cockpit-Rollback:

- restauriert niemals Kanban-Datenbanken global;
- löscht keine Receipts, Kommentare oder Matrix-Events;
- bewahrt Assistant-Auditdaten;
- reconciliert unklare Teilwirkungen einzeln;
- verändert keine Tokens, DNS-, Cloudflare- oder fremden PM2-Dienste ohne eigenen Auftrag.

Der commitbasierte Last-Known-Good- und Rollback-Dry-Run ist in `management-cockpit-release-baseline-v2.md` beschrieben. Die AP-0-Dateisicherung bleibt ausschließlich historischer Rückfallnachweis.

## 11. Incident- und Stop-Kriterien

Assistant-Writes und Matrix-Handoff werden sofort deaktiviert bei:

- sichtbarem privaten, TWL- oder Secret-Kontext;
- falscher Quelle, falschem Board oder falschem Zuständigen;
- doppelter oder nicht idempotenter Nebenwirkung;
- fehlendem beziehungsweise abweichendem Kanban-Readback;
- falschem oder nicht belegtem Matrix-Raum;
- Authentifizierungs- oder Origin-Bypass;
- beschädigter Assistant-Datenbank;
- veralteter oder beeinträchtigter Managementprojektion;
- wiederholter Budgetüberschreitung oder fehlender Projektionsquelle;
- `operatingStatus.aligned=false` nach einer beabsichtigten Produktionsaktivierung.

Containment sichert zuerst Evidenz und verhindert weitere Nebenwirkungen. Ein globales Restore der Quellboards ist ausgeschlossen.

## 12. Änderungen an diesem Vertrag

Eine Erweiterung von Modus, Aktionsklassen oder Wirkungsgrenzen benötigt:

1. versionierte Änderung der maschinenlesbaren und menschenlesbaren Fassung;
2. Tests gegen Runtime, UI und Health;
3. Sicherheits- und Impact-Prüfung;
4. konkreten End-to-End-Nachweis mit Readback und Reconciliation;
5. ausdrückliche Geschäftsführungsentscheidung.

Historische Dokumente werden nicht umgedeutet. Ein neuer aktueller Vertrag ersetzt diesen Vertrag ausdrücklich und verweist auf den zugehörigen Produktionsnachweis.
