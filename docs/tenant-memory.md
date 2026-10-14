# Tenant-Gedächtnis (#766)

## Tenant-Glossar (#874)

Ausdrückliche organisationsbezogene Begriffsdefinitionen werden als bestehende
`tenant_memory_fact` mit `statementKind: glossary` und dem geschlossenen Feld
`glossary: {term, meaning, kind}` gespeichert. Begriff und Bedeutung müssen im
wörtlichen Beleg stehen. Es gibt keine eingebauten Systemnamen oder Bedeutungslisten.
Die Klassifikation unterscheidet System, Abkürzung, Abteilung und sonstigen Begriff.
Systeme in Arbeitsaufträgen bleiben Gegenstände, keine Empfänger.

Das Verständnis liest aktive, sichtbare Glossareinträge für die aktuelle Nachricht
auch in einem neuen Chat. Tenant und Clearance bleiben unverändert. Definitionen
belegen den Sprachgebrauch des Tenants, keine fachliche Regel oder Codebedeutung.

Administration: `GET /api/tenant-memory-policy/glossary` mit authentifizierter
`ROLE_TENANT_ADMIN`; der vorhandene auditierte Listenpfad wird wiederverwendet.
Widerruf und Löschen verwenden dieselben auditierten Aussagenrouten wie bisher.
Löschen redigiert auch `glossary`, Beleg, Originalnachricht und Anker. Der Tombstone
bleibt, ohne Glossarinhalt. Administrative Änderungen erzeugen keine Autorenhinweise.

CET erkennt neue organisationsrelevante Aussagen beim Verstehen der aktuellen Nachricht.
Ein kurzer Satz „Hab ich festgehalten: …“ bestätigt jede Aussage einmal. Reine Wissensfragen,
Smalltalk, einzelne Vorgänge ohne Wirkung auf weitere Arbeiten, Hintergrundaufgaben und Dokument-/Tabellenablage erzeugen keine
Aussagen. Das aktuelle Extraktionsfeld ist turngebunden; frühere Aussagen werden nicht
nochmals aus dem Lagebild übernommen. Örtliche Einschränkungen und Planungen mit Wirkung auf weitere Arbeiten gehören dazu, auch ohne organisationsweite Geltung und auch bei fachlichem Widerspruch. Eine Aussage erzeugt keinen automatischen Fall.
Eine spätere ausdrückliche Fallanforderung nutzt die bestehenden Workbench-Regeln.

## Speicherung und Zugriff

Alle Aussagen und Beziehungen liegen im bestehenden Object-Store unter
`tenant:<tenantId>:workbench_facts`. Es gibt keine neue Datenbank. Mango-Abfragen sind
nach Namespace, Dokumenttyp, Ankern und bei Bedarf Urheber eingeschränkt. Der bestehende
Object-Store-Evidenzkollektor stellt Aussagen und Beziehungen als Workbench-Quellen bereit.

Aussagen enthalten Urheber, konfigurierte Funktion/Rolle, Datum, Wortlautkern, normalisiert belegtes
Belegstück, Verbindlichkeit, Anker, optionale Zeitangaben, Status, Beziehungsreferenzen und
Audit-Historie. Der Tenant und die Clearance stammen aus dem authentifizierten, gegebenenfalls
gemappten Principal. Innerhalb eines Tenants gilt `domain-router-policy.visible()`;
Personen und Funktionen bilden keine zusätzlichen Leseschranken. Direkte Object-Store-
Zugriffe auf diesen Namespace prüfen ebenfalls Tenant und vollständige Clearance.
Direkte Änderungen und Löschungen sind gesperrt; nur der interne, auditierte Gedächtnisweg
besitzt eine prozesslokale Schreibberechtigung. Die Klassifikation eines aktiven Falls
wird auch bei HTTP-Turns in neue Aussagen übernommen.

## Anker und Beziehungen

Seit #861 zerlegt der Store zusammengesetzte Anker deterministisch: „Gegenstand im
Prüfbezug“ wird zu `value: Prüfbezug`, `qualifier: Gegenstand`; dasselbe gilt für
„Gegenstand in der Prüfbezug“, „Gegenstand am Prüfbezug“ und „Prüfbezug (Gegenstand)“.
Das gilt auch dann, wenn die Extraktion den gesamten Ausdruck als `value` liefert.
Belegte Aliases werden mit derselben Grammatik normalisiert. Die kommaseparierten
Variablen `TENANT_MEMORY_ANCHOR_PREPOSITIONS` und `TENANT_MEMORY_ANCHOR_ARTICLES`
ersetzen die Standardlisten der Präpositionen beziehungsweise Artikel. Es gibt keine
Fachbegriff- oder Ortslisten. Bei mehreren Präpositionen wird am letzten passenden
Trenner zerlegt; eine ausdrücklich angehängte Klammerqualifikation hat Vorrang.
Auch deren Basiswert wird vor dem Speichern vollständig normalisiert, sodass ein
weiterer Normalisierungslauf dieselben Anker und Schlüssel ergibt.
Seit #863 vervollständigt derselbe Store-Helfer neue und vorhandene Anker am
wörtlichen `basis`: Ein Gegenstand unmittelbar vor einer konfigurierten
Präposition wird zum Qualifier des nachfolgenden Bezugs. Das gilt auch bei
vertauschter Modell-Qualifikation. Vollständige belegte Aliases werden als
Basiswert übernommen. Weitere fehlende Bezüge werden unabhängig vom Modell
ergänzt. Erkannt werden großgeschriebene Wortfolgen und strukturelle Kennungen;
Satzanfänge, Genitivanschlüsse, wiederholte Gegenstände und abstrakte
Substantivformen werden konservativ ausgeschlossen. Die Präpositions- und
Artikellisten bleiben die einzigen konfigurierbaren Wortlisten; es gibt keine
Fachwortlisten. Jahreszahlen allein sind keine Kennungen.
Grammatikänderungen erfordern danach den auditierten
Migrationslauf für vorhandene Aussagen.

Ein Basisanker findet alle sichtbaren Varianten, auch bei mehreren Qualifiern.
Eine neue unqualifizierte Aussage bleibt erfassbar. Ein ausdrücklich genannter
Qualifier filtert weiterhin auf diese Variante und unqualifizierte Aussagen (K-Regel).
Die ursprüngliche Frage ist dafür maßgeblich, auch wenn die Extraktion nur den
Basisanker liefert. Ein unbekannter ausdrücklich genannter Qualifier liefert nur
unqualifizierte Basisaussagen; ein vom Modell erfundener Qualifier wird verworfen.
Für Wechselwirkungen werden gemeinsame Basisanker verglichen: Aussagen zu verschiedenen
Gegenständen am selben Bezug können zusammenhängen. Die Qualifier bleiben gespeichert
und bestimmen weiterhin ausdrücklich qualifizierte Abfragen.

„Hab ich festgehalten“ erscheint erst, wenn die geschriebene Aussage im selben Turn
über mindestens einen Basisanker aus dem Object-Store wieder gelesen wurde. Ein
zusätzlich im Beleg ermittelter Bezugsanker muss ebenfalls dieselbe Aussage
finden: Die Prüfung umfasst jeden solchen Bezug, nicht nur den ersten Treffer. Ein
Schreibfehler oder fehlgeschlagener Basisanker-Zugriff erzeugt eine ehrliche Meldung
über die fehlende Bestätigung. Ein erfolgreicher Put allein reicht nicht aus.

Die Gewichtung ist ausschließlich aus Dokumenthäufigkeiten abgeleitet:
`log((N + 4) / (df + 1))`. Vier virtuelle Dokumente ermöglichen den Kaltstart eines Tenants;
Anker ab `log(2)` lösen die Prüfung aus. Allgegenwärtige Anker reichen nach dem Kaltstart
nicht aus. Es gibt keine Typ- oder Fachwortlisten. Kandidaten mit gemeinsamen Ankern werden
per Mango gesucht; widerrufene, korrigierte oder abgelaufene Aussagen werden ausgeschlossen.

Die zentrale LLM-Fassade beurteilt Konflikt, Abhängigkeit, zeitliche Lücke, Bestätigung
oder Unabhängigkeit anhand beider Aussagen und der abgerufenen Wissensbasis. Fachliche
Ketten und Zeitbeziehungen werden nicht im Code vorgegeben. Ergebnisse werden gegen ein
geschlossenes Schema geprüft; die strukturierte Prüfung benennt zuerst mögliche Folgen, betroffene Nachfolgelösungen und deren Verfügbarkeit. Für jeden Kandidaten ist ein Urteil erforderlich; Kandidaten und Quellen müssen aus den übergebenen Belegen
stammen. Lokale Referenzen durchlaufen den bestehenden reversiblen Identifier-Kontext.
Unabhängige Ergebnisse bleiben unsichtbar. Plausibilitätshinweise erfordern konkrete
Wissensquellen; Modellwissen allein erzeugt keinen behaupteten Regelverstoß.

## Gespräch, Lebenszyklus und Budget

Die zweite Person sieht eine rechtzeitig abgeschlossene Verbindung im Chat, einschließlich
beider Quellen, Begründung, Unsicherheit und Klärungsfrage. Die erste Person erhält genau
einen Hinweis über `shared-service-notices`. Notice-Schlüssel werden dedupliziert; Zugriff
und Gültigkeit werden bei Zustellung erneut geprüft. Eine zurückgenommene Beziehung wird
nicht mehr zugestellt. Notice-Präferenzen und die bestehenden Zustellregeln gelten weiter.

Die lokale Ankersuche startet parallel zum Retrieval mit einem eigenen Budget von 200 ms.
Die Prüfung übernimmt die im Turn abgerufenen externen Belege und prüft bei Quellen-
Timeouts trotzdem lokale Beziehungen. Vor der Antwort wird höchstens 200 ms unabhängig vom
Retrieval-Budget auf die Prüfung gewartet; ein späteres Ergebnis wird per Notice zugestellt. Aussagen bleiben
bei Modellfehlern gespeichert. Ihr persistierter Prüfstatus und die gespeicherten Belege
bilden eine dauerhafte Arbeitswarteschlange im Object-Store. Ein Hintergrundlauf nimmt
ausstehende Prüfungen auch nach Neustarts wieder auf, ohne einen weiteren Turn der Quelle
zu benötigen. Zustellschlüssel verhindern doppelte Hinweise. Ausstehende
Jobs werden beim geordneten Stoppen abgewartet. Recovery startet beim Stoppen keine
weiteren Prüfungen; lokale Recovery-Aufrufe sind standardmäßig auf zehn Sekunden begrenzt. Ein aktiver
Recovery-Job bleibt bis zum Abschluss im Shutdown-Handle erhalten. Eine verspätete Speicherung bestätigt die
Aussage beim nächsten Kontakt per Notice.

„Streich das“, „gilt nicht mehr“ und „das stimmt so nicht“ beziehen sich auf die zuletzt
festgehaltene eigene Aussage im Gespräch. Eine ausdrücklich genannte Referenz kann über
das Verstehen-Schema korrigiert werden. Korrektur/Widerruf wird mit Zeitpunkt, Urheber,
Belegstück und vorherigem Wortlaut auditiert; Ersatzangaben erzeugen eine neue Aussage.
Die Quelle kann ihre Aussage direkt verändern; fremde Aussagen erfordern die unten beschriebene Bestätigung oder den auditierten Admin-Weg. Historische Aussagen bleiben abfragbar.
Bei einer kurzen Korrektur zwischen Gedächtnisaussage und Tabellenantwort gilt der
aktuelle Gesprächsbezug: Eine zuletzt festgehaltene Aussage bleibt korrigierbar, auch
wenn Tabellen im Tenant vorhanden sind. Eine anschließende Tabellenantwort wechselt
den Bezug zum Datenkatalog, ohne die Aussage oder ihre Historie zu entfernen.
Ein ausdrücklich genanntes Gültigkeitsende schließt weitere Verknüpfungen aus; eine
bloße früheste/späteste Planungsfrist wird nicht als Ablauf missverstanden.

„Was wissen wir zu <Anker>?“ (auch „insgesamt zur“, ohne Modell-Markierung) und „Was hat <Funktion> festgehalten?“ liefern Aussagen mit
Quelle, Datum, Status und aktiven Beziehungen. Spätere Arbeitsaufträge zu einem Anker
bekommen diese Beziehungen als Evidenz; der Hinweis steht vor dem Arbeitsergebnis.

## Erkennung und Beobachtbarkeit

Eine mitgeteilte organisatorische Aussage bleibt trotz einer `knowledge`-Klassifikation
speicherbar; belegte Extraktionen schärfen den Turn zu `work`. Reine Fragen bleiben
ausgeschlossen. Für den Beleg gelten normalisierte Teilstrings oder mindestens 80 %
Tokenüberdeckung (mindestens drei Tokens); lange Wörter tolerieren kurze Flexionssuffixe.
Zahlen bleiben exakt, und jeder Ankerbegriff muss in der aktuellen Nachricht vorkommen.
Plausibilitätshinweise ändern weder Speicherung noch Bestätigung einer Aussage.

Jeder Workbench-Turn erzeugt genau eine Info-Zeile `Tenant memory`: Kandidaten, angenommene
Aussagen, Ablehnungszähler (`basis_mismatch`, `not_eligible`, `no_anchor`, `ambiguous`),
Ankertreffer, gestartete Prüfungen, Prüfstatus, Beziehungen und erzeugte Notices.
Die Zeile enthält die Tenant-Kennung, aber weder Nachrichten noch Anker oder Personen.
Delegierte Abfragen zählen zum aufrufenden Chat-Turn. Die Zeile wird sofort beim Turn-Abschluss geschrieben, auch wenn ein Hintergrundjob noch läuft. Dessen Ergebnis erscheint separat als `Tenant memory background`.

## Abnahme

`tests/tenant-memory-861.test.js` deckt #861 Szenarien 1–11 mit frisch generierten
synthetischen Daten ab, einschließlich Signaturen und Datensatz-Rückfragen.
`tests/tenant-memory-863.test.js` deckt #863 Szenarien 1–10 einschließlich
verkürzter/vertauschter Extraktion, auditierter v2-Migration und vollständiger
Mail-/Folgeturns ab. Der gemeinsame Tool-Trigger verlangt bei Korrespondenz und
Verläufen eine konkrete Datenfrage der fragenden Person; vom Modell gesetztes
`dataNeeds`, eingefügte Fragen und frühere Abfragen reichen allein nicht aus.
Kennungsfelder und als Kennung klassifizierte Statistiken liefern keine Extrema.
`tests/tenant-memory.test.js` deckt die bisherigen AC-01–AC-11 ab;
`tests/tenant-memory.http.test.js` prüft den authentifizierten OpenAI-HTTP-Pfad mit zwei
Personen und getrennten Tenants. Die neuen Core-Module sind im Domänenfreiheits-Gate.
Bestehende Conversation-, Notice-, Fallfortsetzungs- und Dokumenttests bleiben Bestandteil
der vollständigen Test- und Coverage-Suite.

## Recovery-Konfiguration

`TENANT_MEMORY_RECOVERY=on|off` schaltet den Hintergrundlauf. Standardmäßig prüft er
alle 30 Sekunden höchstens fünf fällige Aussagen. `attempts` und `nextAttemptAt` liegen
persistiert an der Aussage. Exponentieller Backoff beginnt bei 30 Sekunden und ist auf
eine Stunde begrenzt; ein längeres `Retry-After` hat Vorrang. Nach drei erfolglosen
Versuchen steht `checking: failed` mit `checkingFailure` an der Aussage. Dieser Grund
ist in der Gedächtnisabfrage und im Betriebslog sichtbar. Ein weiterer Turn startet
keine alte fehlgeschlagene Prüfung neu. Unveränderte Mutationen erzeugen keinen Put.

Die Umgebungsvariablen `TENANT_MEMORY_RECOVERY_INTERVAL_MS`,
`TENANT_MEMORY_RECOVERY_BATCH_SIZE`, `TENANT_MEMORY_RECOVERY_MAX_ATTEMPTS`,
`TENANT_MEMORY_RECOVERY_BACKOFF_MS` und `TENANT_MEMORY_RECOVERY_MAX_BACKOFF_MS`
überschreiben diese Werte. `TENANT_MEMORY_TOOL_TIMEOUT_MS` begrenzt lokale Recovery-
Aufrufe. Die Modellprüfung nutzt in Turn und Recovery die Antwortphase aus
`WORKBENCH_LLM_*`, mit mindestens 15 Sekunden Budget; explizit überschreibbar mit
`TENANT_MEMORY_ASSESSMENT_TIMEOUT_MS`. Die persistierte Warteschlange verantwortet
Retries, deshalb führt die LLM-Fassade für diese Prüfung keinen sofortigen Retry aus.

Organisationsrelevante Mitteilungen werden unabhängig von fachlicher Zustimmung
extrahiert und bestätigt. Das Festhalten dokumentiert die Quelle; eine spätere
Plausibilitätsprüfung kann die Aussage mit konkreten Wissensbelegen anzweifeln.
Gedächtnisabfragen mit vorhandenen Ankern haben vor dem Datensatzpfad Vorrang.
Quellen zeigen Person, konfigurierte oder in Klartext extrahierte Funktion und das
Datum als TT.MM.JJJJ. Bei unbekannter Funktion erscheinen nur Name und Datum. Kurze
deutsche Funktionsangaben stammen aus der aktuellen Nachricht oder dem Mapping;
technische interne Bezeichnungen werden nicht angezeigt. Gleiche Wissensbelege
werden nach Quelle und Text dedupliziert; Ausschnitte sind auf 600 Zeichen begrenzt.

Live-Abnahme mit synthetischen Akteuren und frischen Ankern:
`WORKBENCH_ENV_FILE=/path/to/development.env node scripts/validate-tenant-memory-live.js`.
Nur mit einer Entwicklungs-/Testkonfiguration starten, niemals gegen Produktion.
Der Lauf prüft zusätzlich #861 Szenario 1 (gemeinsamer Basisanker und Beziehung),
2 (beide Personen finden alle Varianten) und 7 (lokal injizierter Schreib-/Lesefehler
erzeugt keine Festhaltebestätigung). Die Datenbank liegt ausschließlich in einem
frischen temporären lokalen Verzeichnis. Neue Anker stammen aus
`scripts/generate-memory-cleanup-fixture.js`. Dieser Lauf wurde für #861 nicht ausgeführt.
Das Skript nutzt das konfigurierte echte Modell ausschließlich über `llm-client`,
den realen lokalen Object-Store und Notice-Dienst sowie dokumentierte Quell-Stubs.
Es prüft beide Reihenfolgen je zweimal und schreibt `docs/validation/tenant-memory-live.json`.

## Widerruf über Chat- und Sitzungsgrenzen

Ein ausdrücklicher Widerruf mit Anker und Inhalt sucht alle sichtbaren aktiven Aussagen
im authentifizierten Tenant. Zahlen im Suchtext müssen im Aussageinhalt vorkommen;
ein Anker allein reicht nicht zum Widerruf. Eigene Treffer werden direkt auditiert
widerrufen. Bei mehreren Treffern erscheint eine nummerierte Auswahl mit Quelle und
Kurzbeschreibung. Fremde Aussagen brauchen anschließend eine ausdrückliche Bestätigung;
diese ist an Person, Chat, Inhalt und Status gebunden und läuft nach 15 Minuten ab.
Die Änderung und die Bestätigungsanforderung werden auditiert. Die Quelle erhält über
`notices` einen Hinweis, der bei Zustellung erneut auf Sichtbarkeit geprüft wird.
Ein fremder Widerruf ersetzt niemals die Urheberschaft der ursprünglichen Aussage.

## Tenant-Administration und einmalige Bereinigung

Alle folgenden Actions verlangen eine authentifizierte `ROLE_TENANT_ADMIN`, übernehmen
den Tenant ausschließlich aus der Authentifizierung und respektieren die Clearance.
Die reguläre API-Autorisierung bleibt zusätzlich wirksam. Jeder erfolgreiche Aufruf sowie ein abgewiesener Admin-Aufruf mit authentifiziertem Tenant
schreibt einen `tenant_memory_audit`-Eintrag im Tenant-Namespace.

| Action                         | Route                                                  | Zweck                                                                  |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `tenant-memory-policy.list`    | `GET /api/tenant-memory-policy/statements`             | Sichtbare Aussagen samt Status und Historie auflisten                  |
| `tenant-memory-policy.revoke`  | `POST /api/tenant-memory-policy/statements/:id/revoke` | Mit Pflichtfeld `reason` widerrufen                                    |
| `tenant-memory-policy.delete`  | `DELETE /api/tenant-memory-policy/statements/:id`      | Mit Pflichtfeld `reason` Inhalt entfernen und Audit-Tombstone behalten |
| `tenant-memory-policy.cleanup` | `POST /api/tenant-memory-policy/cleanup`               | Ausgeschöpfte ausstehende Prüfungen auf `failed` setzen                |

Direkte `object-store.put`/`object-store.delete`-Aufrufe für `workbench_facts` bleiben
auch mit Admin-Rolle verboten. Löschen entfernt Text, Anker, Prüfbelege und vorherige
Wortlaute aus der Aussagehistorie; Kennung, Status, Quelle und Änderungsnachweise bleiben.
Relationen zu gelöschten/widerrufenen Aussagen werden weder als Evidenz noch als Notice
verwendet. Die Admin-Aktion arbeitet nur innerhalb ihrer Sichtbarkeit; eine komplette
Test-Tenant-Bereinigung benötigt daher die Clearance aller dort gespeicherten Aussagen.

Deploy-Runbook (nach dem Update einmal je betroffenem Tenant, kein automatisches Deployment):

1. Mit einem Tenant-Admin-Token `tenant-memory-policy.cleanup` aufrufen. `checking:'pending'`
   mit `attempts >= 3` wird auditiert auf `failed` gesetzt. Ein zweiter Aufruf ist idempotent.
2. Für synthetische Test-Tenants `list` aufrufen, jede zurückgegebene Aussage mit `delete`
   und einer nachvollziehbaren `reason` entfernen. Anschließend `list` zur Kontrolle aufrufen;
   es bleiben ausschließlich Tombstones mit `status:'deleted'`.
3. Recovery prüfen: Widerrufene, gelöschte und ausgeschöpfte Aussagen starten keine
   Modellprüfung. Fehlgeschlagene Prüfungen werden nicht automatisch erneut eingeplant.

Neue Prüfungen zählen Versuche vor dem Modellaufruf dauerhaft. Altdaten ohne Zähler
beginnen bei null; für sie darf das Runbook keinen vergangenen Versuchszähler erfinden.

Auch die Zustellung von Prüfergebnissen ist dauerhaft: `noticesPending`,
`noticeAttempts` und `nextNoticeAttemptAt` bleiben nach abgeschlossener Modellprüfung
erhalten, bis die idempotenten Notice-Aufträge eingereiht sind. Zustellfehler nutzen
Backoff und `Retry-After`; ein Neustart löst dafür keinen neuen Modellaufruf aus.
Recovery fragt nur fällige Modell- oder Notice-Aufträge ab und beendet die Seitensuche
sobald ein Batch gesammelt ist.

## Runbook: Anker-Migration nach #861

Nach dem Deploy startet der Betreiber den Lauf einmal je betroffenem Tenant. Der
Bearer-Token muss `ROLE_TENANT_ADMIN`, API-Zugriff und die Clearance aller zu
migrierenden Aussagen dieses Tenants besitzen. Der Tenant kommt ausschließlich aus
dem Token; kein Tenant-Parameter im Request kann ihn ersetzen. Ohne ausreichende
Clearance werden nur sichtbare Aussagen migriert.

```bash
curl --fail-with-body --request POST \
  "$CET_BASE_URL/api/tenant-memory-policy/migrate-anchors" \
  --header "Authorization: Bearer $CET_TENANT_ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"reason":"Anker-Normalisierung nach Issue #861"}'
```

Route: `POST /api/tenant-memory-policy/migrate-anchors`; Action:
`tenant-memory-policy.migrateAnchors`; Pflichtfeld: `reason` (1–1200 Zeichen).
Für zwei alte, neu zusammenfallende Aussagen ist die erwartete HTTP-200-Antwort:

```json
{ "migration": "anchor-canonical-v1", "scanned": 2, "changed": 2, "requeued": 2 }
```

`scanned` zählt die sichtbaren Aussagen, `changed` die normalisierten Datensätze,
`requeued` die erneut zur Wechselwirkungsprüfung eingeplanten aktiven Aussagen.
Die Migration korrigiert Anker und Aliases, entfernt technische Funktionslabels
und verdichtet doppelte Prüfbelege. Jede Mutation erhält `anchors_migrated` in ihrer
Historie; jeder erfolgreiche Aufruf zusätzlich `admin_migrate_anchors` im Audit.
Widerrufene oder gelöschte Aussagen werden nicht reaktiviert. Der bestehende
Recovery-Worker verarbeitet die persistierte Warteschlange standardmäßig innerhalb
des nächsten 30-Sekunden-Takts, mit den dokumentierten Budgets und Backoff-Regeln.
`TENANT_MEMORY_RECOVERY` muss dafür eingeschaltet sein.

Eine Wiederholung liefert bei unverändertem Bestand `changed:0,requeued:0`; Aussagen
und Beziehungen bleiben unverändert. Der Aufruf selbst wird weiter auditiert.
Anschließend mit `GET /api/tenant-memory-policy/statements` Anker, Prüfstatus,
Beziehungsreferenzen und Audit prüfen und über den Basisanker im Chat nachfragen.
Keine direkten `object-store.put`/`delete` auf `workbench_facts`, kein Datenbankskript.
Deployment und Migrationsstart bleiben beim Betreiber; sie gehören nicht zur
Implementierungs- oder lokalen Testausführung.

## Runbook: Bezugsanker-Migration nach #863

Die oben beschriebene Action führt nach dem Deploy jetzt `anchor-canonical-v2`
aus. Auch Tenants, die bereits v1 durchlaufen haben, benötigen den neuen Lauf.
Route, Rolle und Clearance bleiben unverändert: `ROLE_TENANT_ADMIN` mit
API-Zugriff und vollständiger Clearance, Tenant ausschließlich aus dem Token.

```bash
curl --fail-with-body --request POST \
  "$CET_BASE_URL/api/tenant-memory-policy/migrate-anchors" \
  --header "Authorization: Bearer $CET_TENANT_ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"reason":"Bezugsanker-Normalisierung nach Issue #863"}'
```

Erwartete HTTP-200-Antwort für zwei Aussagen, davon eine mit verkürztem
Gegenstandsanker und eine bereits mit vollständigem Bezug:

```json
{ "migration": "anchor-canonical-v2", "scanned": 2, "changed": 1, "requeued": 2 }
```

Die Anker werden aus `basis` (bei alten Daten ersatzweise `text`) vervollständigt.
Neu zusammenfallende aktive Aussagen werden beidseitig zur vorhandenen
Wechselwirkungsprüfung eingeplant. `anchors_migrated` enthält v2 und Begründung;
`admin_migrate_anchors` auditiert jeden Lauf. Wiederholung bei unverändertem
Bestand: `changed:0,requeued:0`, keine Änderung der Aussagen oder Beziehungen.
Recovery einschalten und anschließend Admin-Liste und Basisfrage prüfen wie
im v1-Runbook. Keine direkten Object-Store-Schreib-/Löschaufrufe.

## Lokale Live-Abnahme #863, Szenario 3

Das bestehende Skript kann ausschließlich mit lokaler temporärer Persistenz,
synthetischen Quellen-Stubs und echten Modellaufrufen über die zentrale Fassade
fünf unabhängige Läufe ausführen. Jeder Lauf erzeugt neue Anker und Personen,
wechselt die Reihenfolge und prüft beide Basisfragen, die sofortige Beziehung
und den Hinweis beim nächsten Kontakt. Keine Produktionsinstanz wird kontaktiert.

```bash
WORKBENCH_ENV_FILE=/path/to/test.env \
TENANT_MEMORY_LIVE_SCENARIO=863 TENANT_MEMORY_LIVE_RUNS=5 \
LIVE_MAX_MODEL_CALLS=80 LIVE_MAX_TOKENS=400000 \
WORKBENCH_VALIDATION_REPORT=/tmp/tenant-memory-863-live.json \
LIVE_BUDGET_REPORT=/tmp/tenant-memory-863-budget.json \
node scripts/validate-tenant-memory-live.js
```

Die lokale Quote und Datenbanken liegen jeweils in neuen temporären Verzeichnissen.
Das Aufruf-/Tokenbudget ist begrenzt; Kontingentfehler (429 oder lokale Quote)
brechen den Lauf ab, ohne weitere Turns oder sofortige Modell-Retries. Ein
Abbruch oder fehlgeschlagenes Kriterium liefert Exit 1 und zählt nicht als
bestandene Live-Abnahme. Ergebnis und Budget werden ohne Modellbezeichnungen
dokumentiert. Deployment und Produktionsmigration bleiben beim Betreiber.

## Bezugsanker und neue Hinweise nach #868

Die deterministische Ergänzung verwendet die vollständige aktuelle Nachricht. Präpositionsbezüge
am Satzanfang zählen ebenfalls. Benennungen enden an Satzzeichen, Klammern, Gedankenstrichen
und kleingeschriebenen Folgewörtern. Auch ein zu lang extrahierter Modellanker wird auf den
wörtlich belegten Bezug gekürzt. Die Präpositions- und Artikellisten aus #861 bleiben erhalten.

Bei Formulierungen ohne Präposition werden vorhandene sichtbare Basisanker gegen die ganze
Nachricht geprüft. Beschriftungs- und Bindestrichformen liefern zusätzlich strukturelle Kandidaten.
Ergänzung und Beziehungssuche verwenden denselben Filter `log((N+4)/(df+1)) >= log(2)`.
Die Dokumenthäufigkeit umfasst alle aktiven Aussagen des Tenants, einschließlich der Wortlaute
und geschützter Aussagen. Geschützte Inhalte fließen ausschließlich intern in die Statistik ein;
sie werden dadurch weder als Kandidatenanker noch als Evidenz offengelegt. Häufige Begriffe
reichen nicht für eine Verbindung. Es gibt keine Fachwort- oder Ortslisten.

Die Originalnachricht bleibt an der Aussage gespeichert und unterliegt derselben Clearance und
Redaktion wie ihr Wortlaut. Fehlt ein ergänzter Bezug im übernommenen Beleg, werden `basis`
und bei Bedarf `text` ausschließlich durch Kopieren eines zusammenhängenden wörtlichen
Satz-/Absatzbereichs erweitert. Jede darin erkannte Bezugsstelle muss nach dem Schreiben
wieder dieselbe Aussage liefern. Einzelvorgänge bleiben ausgeschlossen.

Wechselwirkungshinweise verwenden die geprüfte Relation und zeigen nur die neue Aussage
der anderen Person, Funktion, Datum, das Datum der eigenen Aussage und eine knappe
Begründung. Mehrteilige Begründungen werden zu einem Satz verdichtet, ohne die Folgewirkung
abzuschneiden. Rohpaare und ausstehende Prüfungen werden nicht als Wechselwirkung ausgeliefert.
Eigene Aussagen erzeugen im selben Turn keinen Hinweis. Nach Zustellung bleiben Relationskennungen
dauerhaft als gesehen gespeichert, auch über Migration, Recovery und die begrenzte allgemeine
Hinweishistorie hinaus. Der Filter aus #850 gilt weiterhin. Ein Hinweis ist durch eine Leerzeile
von der eigentlichen Antwort getrennt; die Antwort bleibt erhalten.

## Runbook: Nachrichtenbezugs-Migration nach #868

Nach dem Deploy führt dieselbe Route jetzt **`anchor-canonical-v3`** aus. Die Beispiele zu
v1/v2 oben dokumentieren ihre damaligen Antworten; der aktuelle Aufruf liefert v3. Auch nach
bereits ausgeführter v2-Migration ist dieser Lauf nötig.

**Route:** `POST /api/tenant-memory-policy/migrate-anchors`.
**Action:** `tenant-memory-policy.migrateAnchors`.
**Rolle:** authentifizierte `ROLE_TENANT_ADMIN` mit API-Zugriff und vollständiger Clearance
für die zu migrierenden Aussagen. Der Tenant kommt ausschließlich aus dem Token.
Pflichtfeld `reason`: 1–1200 Zeichen.

```bash
curl --fail-with-body --request POST \
  "$CET_BASE_URL/api/tenant-memory-policy/migrate-anchors" \
  --header "Authorization: Bearer $CET_TENANT_ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"reason":"Nachrichtenbezugs-Normalisierung nach Issue #868"}'
```

Erwartete HTTP-200-Antwort für zwei korrigierte, neu zusammenfallende Aussagen:

```json
{ "migration": "anchor-canonical-v3", "scanned": 2, "changed": 2, "requeued": 2 }
```

Wiederholung bei unverändertem Bestand: `changed:0,requeued:0`. Jeder Aufruf ist auditiert;
jede Mutation enthält `anchors_migrated`, v3, Begründung und Einplanungsstatus. Aktive neu
zusammenfallende Aussagen werden beidseitig über die vorhandene persistierte Recovery geprüft.
Recovery einschalten und Anker, Belege und Beziehungen anschließend über Admin-Liste und
Basisfrage prüfen. Bereits zugestellte Hinweise werden nicht erneut eingereiht.

Vor v3 wurde die vollständige Nachricht nicht an der Aussage aufbewahrt. Wo `basis` und `text`
den Bezug bereits verloren haben, kann der Betreiber die tatsächliche Originalnachricht aus
seiner Quelle zusätzlich über **dieselbe auditierte Route** übergeben. Die Migration erfindet
keinen verlorenen Wortlaut. `originalMessages` ist optional, höchstens 1000 Einträge mit `id`
und `message` (höchstens 8000 Zeichen). Die Quelle muss zum bestehenden Beleg einer sichtbaren,
aktiven Aussage passen; fremde, unsichtbare, redigierte und doppelte Kennungen werden abgewiesen.

```json
{
  "reason": "Nachrichtenbezugs-Normalisierung nach Issue #868 mit Originalbelegen",
  "originalMessages": [
    { "id": "<AUSSAGE-ID-AUS-DER-ADMIN-LISTE>", "message": "<WÖRTLICHE-ORIGINALNACHRICHT>" }
  ]
}
```

Bleibt ein Bezugsanker im verfügbaren Wortlaut unbelegt, enthält die HTTP-200-Antwort zusätzlich
`originalMessagesRequired:["<AUSSAGE-ID>"]`. Für diese Aussagen ist die wörtliche
Originalquelle nötig; die Zähler allein bedeuten keine Wiederherstellung verlorener Texte.

Diesen JSON-Body mit derselben Route und Rolle senden. Die Antwort behält dieselben Zähler;
bei der Mutation steht zusätzlich `originalRestored:true` im Audit. Die wiederholte Übergabe
der identischen Quelle ist idempotent. Löschen redigiert auch die wiederhergestellte Nachricht.
Keine direkten `object-store.put/delete`, kein Deployment oder Produktionslauf durch die
Implementierungs- und Abnahmeskripte.

## Lokale Live-Abnahme #868

Das vorhandene Skript prüft alle fünf Formulierungsmuster in beiden Reihenfolgen: mindestens
zehn vollständig unabhängige Läufe mit frischen generierten Ankern und Personen. Es verwendet
reale Aufrufe über `llm-client`, lokale temporäre Persistenz und synthetische Quellen-Stubs.
Je Lauf: beide Basisabfragen, wörtliche Bezüge, sofortige Relation, keine eigene Same-Turn-Notice,
genau ein Hinweis an die erste Person in der verlangten Form, keine Wiederholung beim nächsten
Neuigkeitenabruf und keine alten Hinweise in einem unbeteiligten Turn. Nur Testkonfigurationen
verwenden, niemals Produktion.

```bash
WORKBENCH_ENV_FILE=/path/to/test.env \
TENANT_MEMORY_LIVE_SCENARIO=868 TENANT_MEMORY_LIVE_RUNS=10 \
LIVE_MAX_MODEL_CALLS=180 LIVE_MAX_TOKENS=1000000 \
WORKBENCH_VALIDATION_REPORT=/tmp/tenant-memory-868-live.json \
LIVE_BUDGET_REPORT=/tmp/tenant-memory-868-budget.json \
node scripts/validate-tenant-memory-live.js
```

Zehn oder zwanzig Läufe sind möglich; eine Teilserie zählt nicht als vollständige Abnahme.
Budgetende oder Kontingentfehler brechen weitere Modellaufrufe ab. Ein roter Lauf liefert Exit 1:
Ursache beheben und **die gesamte Zehnerserie** mit neuen Ankern wiederholen, keine einzelnen
Läufe nachholen. Der JSON-Bericht enthält sämtliche Erwartungen aller Läufe und das Budget,
ohne Modellbezeichnungen. Unit-Abnahme: `tests/tenant-memory-868.test.js`.

## Einmalige Bereinigung administrativer Bestands-Hinweise (#873)

Administrative Löschung, Widerruf und Bereinigung erzeugen ausschließlich Audit-Einträge.
Redigierte oder leere Aussagen werden weder eingereiht noch zugestellt. Die bestehenden
Hinweise auf neue Wechselwirkungen und bestätigte nicht administrative Änderungen bleiben
bestehen. Ohne zustellbaren Inhalt entfällt auch „Hinweise für dich:“.

Nach Einspielen der Korrektur kann die Tenant-Administration bereits gespeicherte
Lösch- und administrative Änderungs-Hinweise einmalig aus Queue und Historie entfernen:

- Route: `POST /api/tenant-memory-policy/discard-deletion-notices`
- Action: `tenant-memory-policy.discardDeletionNotices`
- Rolle: authentifizierte `ROLE_TENANT_ADMIN` mit API-Zugriff und vollständiger Clearance
  für die betroffenen Aussagen. Tenant ausschließlich aus dem Token.
- Parameter: nicht leere Begründung `reason`, höchstens 1200 Zeichen.

```bash
curl --fail-with-body --request POST \
  "$CET_TEST_BASE_URL/api/tenant-memory-policy/discard-deletion-notices" \
  --header "Authorization: Bearer $CET_TEST_TENANT_ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"reason":"Einmalige Bereinigung administrativer Bestands-Hinweise nach Issue #873"}'
```

Erwartete Antwort HTTP 200 bei 20 verworfenen Hinweisen:

```json
{"migration":"deletion-notices-v1","discarded":20,"alreadyApplied":false}
```

Wiederholung HTTP 200:

```json
{"migration":"deletion-notices-v1","discarded":0,"alreadyApplied":true}
```

Jede Veränderung wird vor dem Speichern auditiert, jeder Aufruf zusätzlich mit seinem
Ergebnis. Ein persistierter tenantgebundener Marker verhindert einen zweiten Lauf.
Die Bereinigung entfernt ausschließlich Hinweise auf gelöschte/leere Aussagen oder
administrativ geänderte Aussagen; normale Relationshinweise bleiben erhalten. Unzugängliche
Aussagen werden nicht gelesen oder verändert. Ein Teilfehler lässt den Marker offen; der
Aufruf kann dann wiederholt werden. Es werden keine Aussageinhalte im Bereinigungsaudit
kopiert. Das Runbook beschreibt den Betreiberaufruf; die Abnahme führt ihn ausschließlich
an synthetischen lokalen Testbeständen aus.
