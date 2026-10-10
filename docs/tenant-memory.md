# Tenant-Gedächtnis (#766)

CET erkennt neue organisationsrelevante Aussagen beim Verstehen der aktuellen Nachricht.
Ein kurzer Satz „Hab ich festgehalten: …“ bestätigt jede Aussage einmal. Wissensfragen,
Smalltalk, Einzelfälle, Hintergrundaufgaben und Dokument-/Tabellenablage erzeugen keine
Aussagen. Das aktuelle Extraktionsfeld ist turngebunden; frühere Aussagen werden nicht
nochmals aus dem Lagebild übernommen. Eine Aussage erzeugt keinen automatischen Fall.
Eine spätere ausdrückliche Fallanforderung nutzt die bestehenden Workbench-Regeln.

## Speicherung und Zugriff

Alle Aussagen und Beziehungen liegen im bestehenden Object-Store unter
`tenant:<tenantId>:workbench_facts`. Es gibt keine neue Datenbank. Mango-Abfragen sind
nach Namespace, Dokumenttyp, Ankern und bei Bedarf Urheber eingeschränkt. Der bestehende
Object-Store-Evidenzkollektor stellt Aussagen und Beziehungen als Workbench-Quellen bereit.

Aussagen enthalten Urheber, konfigurierte Funktion/Rolle, Datum, Wortlautkern, wörtliches
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
Aliases übernommen werden; Qualifikatoren bleiben Teil der Identität. Eine unqualifizierte
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
geschlossenes Schema geprüft; Kandidaten und Quellen müssen aus den übergebenen Belegen
stammen. Lokale Referenzen durchlaufen den bestehenden reversiblen Identifier-Kontext.
Unabhängige Ergebnisse bleiben unsichtbar. Plausibilitätshinweise erfordern konkrete
Wissensquellen; Modellwissen allein erzeugt keinen behaupteten Regelverstoß.

## Gespräch, Lebenszyklus und Budget

Die zweite Person sieht eine rechtzeitig abgeschlossene Verbindung im Chat, einschließlich
beider Quellen, Begründung, Unsicherheit und Klärungsfrage. Die erste Person erhält genau
einen Hinweis über `shared-service-notices`. Notice-Schlüssel werden dedupliziert; Zugriff
und Gültigkeit werden bei Zustellung erneut geprüft. Eine zurückgenommene Beziehung wird
nicht mehr zugestellt. Notice-Präferenzen und die bestehenden Zustellregeln gelten weiter.

Prüfungen laufen parallel. Vor der Antwort wird höchstens 100 ms innerhalb des verbleibenden
Retrieval-Budgets gewartet; ein späteres Ergebnis wird per Notice zugestellt. Aussagen bleiben
bei Modellfehlern gespeichert. Ihr persistierter Prüfstatus und die gespeicherten Belege
bilden eine dauerhafte Arbeitswarteschlange im Object-Store. Ein Hintergrundlauf nimmt
ausstehende Prüfungen auch nach Neustarts wieder auf, ohne einen weiteren Turn der Quelle
zu benötigen. Zustellschlüssel verhindern doppelte Hinweise. Ausstehende
Jobs werden beim geordneten Stoppen abgewartet. Eine verspätete Speicherung bestätigt die
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

„Was wissen wir zu <Anker>?“ und „Was hat <Funktion> festgehalten?“ liefern Aussagen mit
Quelle, Datum, Status und aktiven Beziehungen. Spätere Arbeitsaufträge zu einem Anker
bekommen diese Beziehungen als Evidenz; der Hinweis steht vor dem Arbeitsergebnis.

## Abnahme

`tests/tenant-memory.test.js` deckt AC-01–AC-11 mit synthetischen Daten ab;
`tests/tenant-memory.http.test.js` prüft den authentifizierten OpenAI-HTTP-Pfad mit zwei
Personen und getrennten Tenants. Die neuen Core-Module sind im Domänenfreiheits-Gate.
Bestehende Conversation-, Notice-, Fallfortsetzungs- und Dokumenttests bleiben Bestandteil
der vollständigen Test- und Coverage-Suite.
