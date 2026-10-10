# Tenant-Gedächtnis (#766)

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

Anker werden nur für den Vergleich normalisiert. Schreibvarianten können als belegte
Aliases übernommen werden; Qualifikatoren bleiben Teil der Identität. Der Begriff allein findet eine einzige
Tenant-Variante; erst mehrere vorhandene Varianten verlangen eine Rückfrage. Das gilt
für neue Beziehungen, Abfragen und spätere Arbeitsaufträge. Eine unqualifizierte
Bezeichnung wird akzeptiert. Nur bereits vorhandene unterschiedliche Qualifikatoren
innerhalb des sichtbaren Tenant-Bestands führen zu einer Rückfrage.

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
Nur die Quelle kann ihre Aussage verändern. Historische Aussagen bleiben abfragbar.
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

`tests/tenant-memory.test.js` deckt AC-01–AC-11 mit synthetischen Daten ab;
`tests/tenant-memory.http.test.js` prüft den authentifizierten OpenAI-HTTP-Pfad mit zwei
Personen und getrennten Tenants. Die neuen Core-Module sind im Domänenfreiheits-Gate.
Bestehende Conversation-, Notice-, Fallfortsetzungs- und Dokumenttests bleiben Bestandteil
der vollständigen Test- und Coverage-Suite.

## Recovery-Konfiguration

`TENANT_MEMORY_RECOVERY=on|off` schaltet den Hintergrundlauf. Standardmäßig prüft er
alle 30 Sekunden höchstens fünf fällige Aussagen. `attempts` und `nextAttemptAt` liegen
persistiert an der Aussage. Exponentieller Backoff beginnt bei 30 Sekunden und ist auf
eine Stunde begrenzt; ein längeres `Retry-After` hat Vorrang. Nach fünf erfolglosen
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
Datum als TT.MM.JJJJ. Eine unbekannte Funktion wird als solche kenntlich gemacht.

Live-Abnahme mit synthetischen Akteuren und frischen Ankern:
`WORKBENCH_ENV_FILE=/path/to/.env node scripts/validate-tenant-memory-live.js`.
Das Skript nutzt das konfigurierte echte Modell ausschließlich über `llm-client`,
den realen lokalen Object-Store und Notice-Dienst sowie dokumentierte Quell-Stubs.
Es prüft beide Reihenfolgen je zweimal und schreibt `docs/validation/tenant-memory-live.json`.
