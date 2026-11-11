# AP 16 – Produktiver Write→Readback→Matrix-Smoke

Status: bestanden
Datum: 2026-11-10
System: AgentOS Management-Cockpit / Rhajaina Assistant Channel
Produktive Oberfläche: `https://hitl.stromdao.de/management`
Prüfobjekt: `topic_f29bb5ce827d15017b4d57ef`

## 1. Zweck

Dieser Betriebsnachweis dokumentiert den produktiven End-to-End-Test des Rhajaina Assistant Channel über die vollständige Wirkungskette:

1. neuer Vorschlag aus dem objektgebundenen Rhajaina-Dialog;
2. explizite Bestätigung;
3. sichere Auflösung einer autorisierten Kanban-Quelle;
4. produktiver Kanban-Write;
5. Readback und persistentes Receipt;
6. Matrix-Handoff in den zugeordneten internen Fachraum;
7. direkter Readback des Matrix-Events anhand der Event-ID;
8. Wiederholung desselben Auftrags ohne weitere Nebenwirkung;
9. Neustart des Cockpit-Prozesses;
10. erneute Wiederholung und Nachweis persistenter Idempotenz.

Der Test prüft die produktive interne Low-Risk-Lane. Externe Kommunikation, Veröffentlichung, Zahlung, Vertrag, Deployment, Secrets, Datenschutz- und TWL-Aktionen waren nicht Gegenstand des Tests und blieben gesperrt.

## 2. Identitäten und persistente Belege

| Gegenstand                   | Wert                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Managementthema              | `topic_f29bb5ce827d15017b4d57ef`                                                         |
| Conversation                 | `conversation_1a63f0fe-6bbb-410f-895e-072d6c70e50b`                                      |
| auslösende Assistant-Message | `message_b30caa6a-6cdf-4026-a7f9-aaefbd1d185d`                                           |
| Vorschlag                    | `proposal_bef629e0-4813-4a6e-a489-09bcdca81863`                                          |
| Aktion                       | `create_followup`                                                                        |
| Risikoklasse                 | `low`                                                                                    |
| expliziter Assignee          | `Felix` / normalisiertes Profil `felix`                                                  |
| Idempotency-Key              | `assistant-proposal-v1:bba33dd696ac5395c0a9b3143287c65612b4186133efe849a5f8e765bb386418` |
| Quellboard                   | `agentos-deep-briefing`                                                                  |
| Quellkarte                   | `t_67f6db3c`                                                                             |
| Receipt                      | `receipt_71fd7701-c774-4aa4-8809-effcc6bee44c`                                           |
| Matrix-Raum                  | `!WrlHsnwNvrjGayoYEg:matrix.stromdao.de`                                                 |
| Matrix-Event                 | `$d1R-Cps6ylPo72NrJg3bghzRcuKaGXIZNHLIgg5lMpg`                                           |
| Matrix-Sender                | `@hermes-stromdao:matrix.stromdao.de`                                                    |
| Loop-/Deduplizierungsmarker  | `ASSISTANT_MATRIX_HANDOFF:proposal_bef629e0-4813-4a6e-a489-09bcdca81863`                 |

Persistente Assistant-Datenbank:

`/home/clawd/.hermes/management-cockpit/assistant-channel.db`

Persistente Quell-Kanban-Datenbank:

`/home/clawd/.hermes/kanban/boards/agentos-deep-briefing/kanban.db`

Produktiver Release beim Abschluss:

`/home/clawd/.hermes/releases/agentos-hitl-cockpit/d32d987d2b67463a8b9ce7b9611aac5142fbd658`

## 3. Zeitliche Einordnung

| Ereignis                              | Zeitpunkt Europe/Berlin         |
| ------------------------------------- | ------------------------------- |
| Vorschlag persistiert                 | `2026-11-10T14:43:21+01:00`     |
| Kanban-Write                          | `2026-11-10T15:37:37+01:00`     |
| Receipt und Matrix-Beleg persistiert  | `2026-11-10T15:37:38+01:00`     |
| Cockpit-Prozess nach Neustart erzeugt | `2026-11-10T16:08:29.923+01:00` |

Die Replay-Prüfung nach dem Neustart erfolgte gegen den neu gestarteten produktiven Prozess. Der Betriebsnachweis verwendet keine nur im Prozessspeicher gehaltenen Werte; Vorschlag, Receipt, Quellzustand und Matrix-Identität wurden aus persistenten beziehungsweise direkt lesbaren Systemen geprüft.

## 4. Prüfschritte und Ergebnisse

### 4.1 Neuen objektgebundenen Vorschlag erzeugen

Im produktiven Rhajaina-Chat wurde das Managementthema `topic_f29bb5ce827d15017b4d57ef` als strukturiertes Attachment verwendet. Rhajaina erzeugte einen neuen Low-Risk-Vorschlag mit dem explizit genannten Assignee Felix.

Ergebnis:

- Proposal `proposal_bef629e0-4813-4a6e-a489-09bcdca81863` wurde persistiert.
- `target_type=topic` und `target_id=topic_f29bb5ce827d15017b4d57ef` stimmen mit dem Attachment überein.
- Der Vorschlag enthielt keine externe Kommunikation und keine Veröffentlichung.
- Der Assignee wurde nicht erfunden; er war im Vorschlag ausdrücklich als `Felix` enthalten.
- Der Vorschlag erhielt einen stabilen Idempotency-Key.

Status: bestanden.

### 4.2 Autorisierte Quelle auflösen

Die aggregierte Managementsicht wurde serverseitig auf die projektionsdefinierte, offene und autorisierte Primärquelle aufgelöst:

- Board: `agentos-deep-briefing`
- Karte: `t_67f6db3c`
- Zustand vor Ausführung: offen/`ready`

Mehrdeutige, geschlossene, private, TWL-bezogene oder nicht im Attachment referenzierte Quellen wären weiterhin fail-closed abgewiesen worden.

Status: bestanden.

### 4.3 Produktiven Kanban-Write ausführen

Nach expliziter Bestätigung wurde die Quellkarte mutiert:

- Assignee wurde auf das verifizierte Hermes-Profil `felix` gesetzt.
- Genau ein Follow-up-Kommentar wurde durch `hitl-cockpit` angelegt.
- Der Kommentar beschreibt den internen Prüfauftrag und schließt externe Kommunikation und Veröffentlichung aus.

Fingerprints des ausführbaren Readbacks:

| Zustand    | Fingerprint                                                        |
| ---------- | ------------------------------------------------------------------ |
| vor Write  | `8a4a631db6ab1b6c48c660390966203596deeb6d4b3ff316be879c205d2c39a6` |
| nach Write | `d4f3cab8e6a17411da35354e25c2b6e13900ae10f9b91c34c56f4168b8e83a28` |

Die unterschiedlichen Fingerprints belegen die beabsichtigte Mutation. Der unmittelbar zurückgelesene Kanban-Fingerprint entsprach exakt dem gespeicherten `after_fingerprint`.

Status: bestanden.

### 4.4 Receipt persistieren und zurücklesen

Das Cockpit speicherte genau ein append-only Receipt:

- Receipt: `receipt_71fd7701-c774-4aa4-8809-effcc6bee44c`
- Proposal: `proposal_bef629e0-4813-4a6e-a489-09bcdca81863`
- Quellreferenz: `agentos-deep-briefing / t_67f6db3c`
- Proposal-Status: `executed`
- Receipt-Anzahl für das Proposal: `1`

Der gespeicherte Readback enthält den nach dem Write gelesenen Kanban-Zustand sowie den Matrix-Zustellbeleg. Das Receipt ist durch das Datenbankschema gegen Update und Delete geschützt.

Status: bestanden.

### 4.5 Matrix-Handoff senden

Nach erfolgreichem Kanban-Readback wurde der interne Matrix-Handoff in den dem Topic zugeordneten Fachraum gesendet:

- Raum: `!WrlHsnwNvrjGayoYEg:matrix.stromdao.de`
- Event-ID: `$d1R-Cps6ylPo72NrJg3bghzRcuKaGXIZNHLIgg5lMpg`
- Sender: `@hermes-stromdao:matrix.stromdao.de`
- Eventtyp: `m.room.message`
- Marker: `ASSISTANT_MATRIX_HANDOFF:proposal_bef629e0-4813-4a6e-a489-09bcdca81863`

Die Zustellung wurde nicht allein aus dem Send-Aufruf abgeleitet. Das konkrete Event wurde anschließend anhand seiner Event-ID direkt über die Matrix-Event-API zurückgelesen.

Status: bestanden.

### 4.6 Event-ID per Matrix-Readback verifizieren

Direkter Readback des konkreten Matrix-Events:

- HTTP-Status: `200`
- gelesene Event-ID entspricht der Send-Antwort;
- gelesener Raum entspricht dem erwarteten Fachraum;
- Eventtyp ist `m.room.message`;
- erwarteter Loop-/Handoff-Marker ist enthalten;
- der Raum enthält für diesen Marker genau ein Event.

Damit sind Send, Persistenz, Zielraum und fachliche Zuordnung über dieselbe reale Event-ID nachgewiesen.

Status: bestanden.

### 4.7 Unmittelbare Idempotenz prüfen

Derselbe Vorschlag wurde unmittelbar erneut über den produktiven Bestätigungspfad ausgeführt.

Ergebnis:

- API-Ergebnis: `deduplicated=true`
- Receipt blieb `receipt_71fd7701-c774-4aa4-8809-effcc6bee44c`
- Matrix-Event blieb `$d1R-Cps6ylPo72NrJg3bghzRcuKaGXIZNHLIgg5lMpg`
- kein zweiter Kanban-Write;
- kein zweiter Follow-up-Kommentar;
- kein zweites Matrix-Event;
- Receipt-Anzahl blieb `1`.

Status: bestanden.

### 4.8 Prozess neu starten

Der produktive PM2-Prozess `agentos-hitl-cockpit` wurde über seinen stabilen Servicenamen neu gestartet.

| Merkmal        | vor Neustart | nach Neustart |
| -------------- | -----------: | ------------: |
| PID            |    `1513227` |     `2543741` |
| Restart-Zähler |          `0` |           `1` |
| Status         |     `online` |      `online` |

Nach dem Neustart liefen Script und Arbeitsverzeichnis aus dem erwarteten Release `d32d987d2b67463a8b9ce7b9611aac5142fbd658`. Der neue PID wurde zusätzlich über PM2 verifiziert.

Status: bestanden.

### 4.9 Idempotenz nach Neustart erneut prüfen

Nach Verlust des Prozessspeichers wurde exakt dasselbe Proposal erneut über die produktive Confirm-API aufgerufen. Es wurde kein semantisch ähnlicher neuer Auftrag angelegt, sondern dieselbe persistente Proposal-Identität wiederverwendet.

Ergebnis:

- Antwort: `deduplicated=true`
- Proposal-Status blieb `executed`
- Receipt blieb `receipt_71fd7701-c774-4aa4-8809-effcc6bee44c`
- Receipt-Anzahl blieb exakt `1`
- Matrix-Event-ID blieb `$d1R-Cps6ylPo72NrJg3bghzRcuKaGXIZNHLIgg5lMpg`
- der Loop-Marker kam im Fachraum weiterhin exakt einmal vor
- kein zusätzlicher Kanban-Kommentar
- kein zusätzlicher Kanban-Write
- kein zusätzliches Matrix-Event

Der gezielte kanonische Hash der betroffenen Quellentität einschließlich ihrer zugehörigen Kinddaten war vor und nach dem Neustart identisch:

`8aa7a4f836cd0e10004e491911f2d5cf60e3834ad3b045cb56363bff25e0e42a`

Dieser Entitätshash ist vom Write-Readback-Fingerprint zu unterscheiden: Der Readback-Fingerprint belegt die beabsichtigte Mutation beim ersten Lauf; der kanonische Entitätshash belegt, dass der Replay nach Neustart keine weitere Mutation verursacht hat.

Status: bestanden.

### 4.10 Integrität der persistenten Stores prüfen

Nach Ausführung und Neustart-Replay wurden die beteiligten SQLite-Datenbanken geprüft:

| Datenbank                            | `PRAGMA integrity_check` |
| ------------------------------------ | ------------------------ |
| Assistant Channel                    | `ok`                     |
| Quell-Kanban `agentos-deep-briefing` | `ok`                     |

Die aktuelle Assistant-Datenbank enthält weiterhin genau ein Proposal und ein Receipt für den geprüften Auftrag. Das persistierte Receipt enthält weiterhin dieselbe Quellreferenz, dieselbe Matrix-Raum-ID und dieselbe Matrix-Event-ID.

Status: bestanden.

## 5. Akzeptanzkriterien

| Kriterium                                                                        | Ergebnis  |
| -------------------------------------------------------------------------------- | --------- |
| Neuer Vorschlag ist eindeutig an das ausgewählte Managementthema gebunden        | bestanden |
| Zuständiger wurde explizit angegeben und auf ein vorhandenes Profil normalisiert | bestanden |
| Aggregierte Sicht wird auf genau eine autorisierte Quelle aufgelöst              | bestanden |
| Kanban-Write erfolgt erst nach expliziter Bestätigung                            | bestanden |
| Write wird anhand des konkreten Quellobjekts zurückgelesen                       | bestanden |
| Persistentes Receipt enthält Quell- und Matrix-Identität                         | bestanden |
| Matrix-Send liefert reale Event-ID                                               | bestanden |
| Event-ID wird direkt aus Matrix zurückgelesen                                    | bestanden |
| Raum, Eventtyp und Marker stimmen mit dem erwarteten Handoff überein             | bestanden |
| Unmittelbarer Replay erzeugt keine zweite Nebenwirkung                           | bestanden |
| Realer Prozessneustart ändert den PID                                            | bestanden |
| Replay nach Neustart verwendet das ursprüngliche Receipt und Event               | bestanden |
| Quellentität bleibt beim Neustart-Replay unverändert                             | bestanden |
| Matrix-Marker kommt weiterhin genau einmal vor                                   | bestanden |
| Assistant- und Quell-Datenbank sind integer                                      | bestanden |
| Keine Secrets werden im Betriebsnachweis dokumentiert                            | bestanden |

Gesamtergebnis: **bestanden**.

## 6. Sicherheits- und Fail-closed-Grenzen

Der bestandene Smoke erweitert die Freigabe nicht auf beliebige Aktionen. Weiterhin gelten:

- nur serverseitig aufgelöste, autorisierte Quellen;
- Ablehnung bei mehreren gleichrangigen offenen Quellen;
- keine erfundenen Zuständigen;
- explizite Bestätigung für produktive Low-Risk-Aktionen;
- Quell-Fingerprint und Readback vor Matrix-Handoff;
- persistente Deduplizierung anhand der Proposal-/Receipt-/Marker-Identität;
- keine private oder TWL-bezogene Quelle im allgemeinen Management-Cockpit;
- kein automatischer externer Versand;
- keine Preis-, Vertrags-, Zahlungs-, Veröffentlichungs-, Deployment-, Secret- oder Datenschutzaktion über diesen Nachweis.

## 7. Reproduzierbare, secret-freie Kontrollabfragen

Die folgenden Kontrollen benötigen keine Ausgabe von Tokens oder Cookies:

1. Proposal und Status in `assistant_action_proposals` anhand der Proposal-ID lesen.
2. Receipt in `assistant_action_receipts` anhand der Proposal-ID lesen.
3. Prüfen, dass `COUNT(*)` für das Proposal in `assistant_action_receipts` gleich `1` ist.
4. Quellkarte `t_67f6db3c` und den eindeutigen Follow-up-Kommentar in der Datenbank des Boards `agentos-deep-briefing` lesen.
5. `PRAGMA integrity_check` auf beiden Datenbanken ausführen.
6. PM2-Status, PID, Restart-Zähler, Scriptpfad und Arbeitsverzeichnis für `agentos-hitl-cockpit` lesen.
7. Matrix-Event mit dem gebundenen Rhajaina-/Cockpit-Zugang anhand der Event-ID lesen; nur HTTP-Status, Raum-ID, Event-ID, Eventtyp und Markeranzahl ausgeben.
8. Exakt dasselbe Proposal erneut über den authentifizierten Confirm-Endpunkt aufrufen und `deduplicated=true` sowie die unveränderten IDs prüfen.

Zugangsdaten werden dabei ausschließlich aus der gebundenen Laufzeitkonfiguration im Speicher verwendet und weder in Kommandozeilen noch in Logs oder Dokumentation ausgegeben.

## 8. Abschluss

Die produktive interne Wirkungskette ist für den geprüften Low-Risk-Fall vollständig nachgewiesen:

`Rhajaina-Vorschlag → explizite Bestätigung → Kanban-Write → Kanban-Readback → Receipt → Matrix-Send → Matrix-Readback`

Die Deduplizierung übersteht einen realen Neustart des Cockpit-Prozesses. Für dieselbe logische Aktion existieren genau ein Receipt, genau eine beabsichtigte Quellmutation und genau ein Matrix-Event.
