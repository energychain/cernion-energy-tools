# Dokumenten-Review: Betrieb und Abnahme (#754)

## Produktiver Dokumentfluss (Phase 2)

OpenAI-kompatibler Eingang und Workbench trennen `<context>/<source>` und äußere
`<user_query>` vor Thread-Aufbereitung und Fragevalidierung. Dokumente werden vollständig
am zugeordneten Fall gespeichert; das Fragebudget gilt getrennt vom Aufnahmebudget.
Überlange Dokumentpakete werden abgelehnt statt still gekürzt. Normale Evidence-/Fall-
und Dossier-Projektionen enthalten ausschließlich Dokumentmetadaten, keinen Volltext.

Bewertungs-, Prüf-, Review- und Stellungnahme-Aufträge erhalten `turnKind: review`.
Der Uploadturn wartet auf keinen Modell- oder Wissensquellenaufruf: Er bestätigt Aufnahme,
Prüfumfang und geplante Prüfung. Verstehen, vorhandenes read-only-Retrieval und Map/Reduce
laufen anschließend außerhalb des HTTP-Turns. Auch kurze Reviews verwenden denselben Weg,
weil bereits ein einzelner externer Aufruf das verbleibende Turnbudget verbrauchen kann.
`pendingEvents` zeigt die laufende Aufgabe an. Das Ergebnis wird im nächsten Turn dieser
Unterhaltung ausgegeben; eine Seite-/Kapitelanfrage hat Vorrang und liest direkt die
gespeicherte Fundstelle, auch ohne Chatverlauf und ohne weiteren Modellaufruf.

Reviewzustand und Ergebnis liegen im bestehenden Conversation-PouchDB mit 30 Minuten
Gültigkeit und dessen bestehender Bereinigung. Tenant, Actor, Unterhaltung, Fall und
Dokumenthashes binden die Aufgabe; Fallzugriff und Clearance werden vor Ausgabe erneut
geprüft. Nach Prozessneustart startet ein noch laufend markiertes Review beim nächsten
Turn erneut, sofern die Dokumentgrundlage weiter zugänglich ist. Laufende Aufgaben werden
beim geordneten Broker-Stopp vor dem Schließen der Datenbanken abgewartet.

Urteil und Begründung, Stärken, Risiken, Prüfpunkte, Widersprüche, offene Fragen und
Einschränkungen werden gemeinsam geliefert. Entwürfe entstehen nur aus einer ausdrücklichen
äußeren Bitte. Teilergebnisse, fehlende Abschnitte, fehlende Prüfmaßstäbe und unbestätigte
Vollständigkeit werden benannt. Große Fundstellenauszüge zeigen ausdrücklich nicht
ausgegebene Zeichen; der gespeicherte Text bleibt vollständig.

`parseOpenWebUIContext(text)` trennt Frage und Dokumente. `attachDocuments(store,
identity, documents, options)` nutzt `normalizeEvidenceInput` und den bestehenden
`WorkbenchStore.saveEvidence`; kein zusätzlicher Dokumentstore. Volltext, Gliederung,
Quell-ID und Vollständigkeit liegen in `EvidenceRef.extracts.document`, SHA-256 in
`fileHash`. `loadDocuments` liest dieselbe Fallgrundlage tenant-/fallgebunden und beachtet
die Sensitivity-Freigabe. Identität kommt aus dem bestehenden Gateway, nie aus dem
Dokument. Namen unterliegen der bestehenden Evidence-Validierung. Inhalte werden nicht
protokolliert. Vor der Ablage wird derselbe Inhalt per SHA-256 im gleichen Fall erkannt,
auch bei geändertem Dateinamen. Wiederholt mitgesendete Open-WebUI-Kontexte erzeugen
weder eine weitere Ablage noch einen wiederholten Ablagehinweis.

Dokument plus Inhaltsfrage beantwortet die aktuelle Frage. Anfang, Ende, Seite und
Kapitel werden direkt aus dem gespeicherten Text gelesen; sonst werden relevante
Abschnitte über die zentrale LLM-Fassade gezielt beantwortet. Nur ein ausdrücklicher
Bewertungsauftrag startet das Hintergrund-Review. Der erste Ablagehinweis umfasst
höchstens einen Satz. CSV-/TSV-/Markdown- und XLSX-Textdarstellungen werden erkannt;
erste/letzte Datenzeile und Zeilenanzahl sind lokal beantwortbar. Weitergehende
Tabellenauswertung verweist bis zur Integration von #774 ehrlich auf den Datenkatalog.

Die Info-Zeile `Workbench document stored` enthält ausschließlich `name`, `chars`,
`lines` und `tabular`. Sie erscheint einmal je neuer Ablage und ermöglicht die Prüfung,
ob Open WebUI den erwarteten Umfang übermittelt hat, ohne Inhalte zu protokollieren.

`reviewDocuments` verwendet ausschließlich `src/llm-client.js`; Tests ersetzen die Fassade.
Eine Retrieval-Runde nutzt die vorhandene `collectEvidence`-Pipeline mit den konfigurierten
Wissensquellen, Datapoints und freigegebenen read-only-Capabilities. Die vorhandenen
Scope-/Mandatsprüfungen bleiben wirksam. Map liest sämtliche Abschnitte; Reduce erhält
begrenzte strukturierte Maps und die gelieferten Prüfmaßstäbe. Fachliche Standards sind
nicht im Kern kodiert. Ohne Quellen prüft der Ablauf nur innere Stimmigkeit und benennt
das ausdrücklich. Fundstellen sind validierte Textanker mit Kapitel, Seite und
Zeichenoffsets; Maßstäbe sind validierte Quellenindizes. Modellqualität erfordert zusätzlich
manuelle Abnahme. Dokumente, Namen und Quellen bleiben nicht vertrauenswürdige Daten.

Jede Map trägt ihre erlaubten `locationIds`; die Zusammenführung referenziert ausschließlich
Textstellen erfolgreicher Maps. Map liefert lokale Zeilennummern und kurze wörtliche Zitate;
der Server ordnet diese den gespeicherten Kapitel-/Seitengrenzen und Zeichenoffsets zu.
Falsche Anker, mehrdeutige Zitate ohne Anker und unbelegte Befundverweise werden entfernt.
Auch Stärken und Risiken verwenden diese validierten Fundstellen. Die Zeichenbereiche
sind nullbasierte UTF-16-Offsets im unveränderten gespeicherten Text.

Kapitel-/Seitenfragen liefern eine knappe extraktive Zusammenfassung mit kurzen Zitaten
und Fundstelle je Zitat. Wiederholter Standardtext wird gezählt und ausgelassen; unterschiedliche
Zahlenangaben bleiben erhalten. Quellenzeilen verwenden Dokument- und Abschnittstitel aus
Metadaten. Quellen ohne lesbaren Dokumenttitel entfallen. Ungeprüfte konkrete Einzelangaben
erhalten höchstens einen gemeinsamen Hinweis am Ende des Antwortblocks, nie an Grußzeilen.
Die Schemaänderung ist intern; externe Clients erhalten den gerenderten Reviewtext.

## Open WebUI: Volltext statt Ausschnitte

Empfehlung: Für die Review-Unterhaltung File Context einschalten und die Datei auf
**Using Entire Document** setzen. Alternativ unter Administration → Settings → Documents
**Bypass Embedding and Retrieval / Embedding und Retrieval umgehen** aktivieren; je nach
Version gibt es zusätzlich Full Context Mode. Diese Einstellungen müssen den extrahierten
Text tatsächlich vollständig in den Kontext übernehmen. Eine reine Datei-ID liefert
CET keinen Inhalt. Bei PDF hängt die Vollständigkeit auch von Extraktion/OCR ab.

Die [Open-WebUI-RAG-Dokumentation](https://docs.openwebui.com/features/chat-conversations/rag/)
beschreibt die Dateieinstellung; die
[Umgebungsreferenz](https://docs.openwebui.com/reference/env-configuration/) dokumentiert
`BYPASS_EMBEDDING_AND_RETRIEVAL` und `RAG_FULL_CONTEXT`.
RAG-Ausschnitte bleiben als Ausschnitte verwertbar, erlauben aber kein Urteil über nicht
übermittelte Seiten. Der Parser kann anhand der Tags allein keine Vollständigkeit beweisen.
`completeness: 'full'` darf die Integration nur bei bestätigtem Volltexttransport setzen;
ansonsten `unknown` oder `excerpt`. Die Review-Ausgabe benennt diese Einschränkung.

Kein Open-WebUI-Dateiabruf wird eingeführt: Der bestehende CET-Gateway-Token ist kein
Open-WebUI-API-Token. Ohne belegte bestehende Berechtigung wäre ein Abruf ein neuer
Zugangsweg. Admin-Cookies oder neue API-Schlüssel sind für diese Lösung nicht erforderlich.
Bei Abnahme prüfen: übermittelter Textumfang, Beginn und Ende, Kapitel und Seitenmarker;
keinen Kundentext in Logs oder Testfixtures schreiben.

## Budgets

| Einstellung                     |                               Default | Zweck                            |
| ------------------------------- | ------------------------------------: | -------------------------------- |
| WORKBENCH_DOCUMENT_MAX_CHARS    |                               4000000 | Aufnahmebudget pro Dokumentpaket |
| WORKBENCH_REVIEW_MAX_CHARS      |                                250000 | Review-Eingabe insgesamt         |
| WORKBENCH_REVIEW_TIMEOUT_MS     |                                 45000 | Gesamtbudget inkl. Retrieval     |
| WORKBENCH_REVIEW_CONCURRENCY    |                                     4 | Maximale parallele Map-Aufrufe   |
| WORKBENCH_REVIEW_MAX_MAP_CALLS  |                                    64 | Maximale Abschnittsaufrufe       |
| WORKBENCH_REVIEW_SECTION_CHARS  |                                 12000 | Maximale Abschnittslänge         |
| WORKBENCH_REVIEW_CRITERIA_CHARS |                                 12000 | Quellenbudget für Reduce         |
| WORKBENCH_REVIEW_MODEL          | Antwortmodell aus WORKBENCH_LLM_MODEL | Optionales Review-Modell         |

Kleine Abschnitte werden bis zur Abschnittslänge gebündelt; `locations` erhält alle Kapitel-, Seiten- und Offsetgrenzen.

Überschreitungen werden vor Map-Aufrufen abgewiesen; kein stilles Kürzen. Einzelne Map-Fehler (Timeout, 429, Schemafehler) stoppen die übrigen Abschnitte nicht.
Lücken stehen mit Fundstelle in `limitations` und strukturiert in `gaps`; Reduce erhält nur
erfolgreiche Maps sowie diese Lücken. Bis einschließlich 50 % fehlenden Abschnitten bleibt
der Status bei erfolgreichem Reduce `completed`; darüber lautet er `partial_failed`.
Ohne erfolgreiche Maps entfällt Reduce. Die Gesamtdeadline gilt weiter für Retrieval, Maps
und Reduce; nach Ablauf starten keine weiteren Modellaufrufe. Bereits laufende Fassade-
oder Retrieval-Aufrufe können bis zu ihrem eigenen Timeout weiterlaufen; ein späteres
Ergebnis wird nicht als fertiges Review übernommen. Die Integration muss diese Zustände
als Budget-/Fortsetzungshinweis behandeln. Die Modellwahl und Denkbudget-Vorgaben werden aus den bestehenden Workbench-Antwortoptionen übernommen; Kommapaare wählen das Antwortmodell. Modellquoten und PII-Scrubbing liegen weiter
in der Fassade. Aufrufe: ein Map pro Abschnitt und ein Reduce; Kosten wachsen linear mit
der Dokumentlänge. `stats` berichtet Aufrufzahl, Dokument-/Promptzeichen und Laufzeit.
Ohne tatsächlichen Modellbetrieb wird kein Geldbetrag als gemessene Kosten angegeben.

## Akzeptanzmatrix

| Kriterium | Nachweis in Phase 2 | Grenze |
| --- | --- | --- |
| AC-01 | Authentifizierter HTTP-Test mit generierter Injection-Fixture; Frage und Dokument getrennt; Quell-IDs nicht in Antwort | Modellurteilsqualität zusätzlich manuell prüfen |
| AC-02 | 233256 Zeichen unverändert im Evidence-Store; Folgeturns Seite 12 und Kapitel 3 ohne Chatverlauf/Modellaufruf; Scope-Sperren | Full Context muss vom Client geliefert werden; kein neuer Dateiabruf |
| AC-03 | `turnKind: review`; strukturierter Reviewtext; alle Befundgruppen mit validierten Einzelabschnitten; ausdrückliche Entwurfsbitte | Kein Urteil über ungeprüfte Abschnitte |
| AC-04 | Vorhandener Evidence-Collector mit zusätzlichen Suchbegriffen für Maßstäbe; Capabilities aus dem bestehenden Funktionsmodell; lesbare Kriterienquellen; ehrlicher Hinweis ohne Treffer | Fachliche Regeln bleiben ausschließlich Retrievaldaten |
| AC-05 | Nur vom Generator erzeugte neutrale Dokumente und deterministische Fassade, einschließlich Kollegen-Rubrik im PR | Keine Live-Modellqualität oder Produktionskosten behauptet; keine echten Planungstexte |
| AC-06 | Modul-/Broker-/HTTP-Tests, Harness/HTTP-e2e, Gateway-Negativfälle, Wächter, statische Prüfungen und Generatoren | Aktuelle Gesamtresultate stehen im PR |

Fixture über `node scripts/generate-review-fixture.js` erzeugen. Die deterministische
Testfassade extrahiert eingebaute Ausgangszahlen und Wachstumsannahmen. Das belegt
Orchestrierung und Fundstellen, nicht die Urteilsgüte eines echten Modells. Echte
Modellkosten im Stub: 0; keine Live-Qualitätsbewertung behaupten.

Risiko: MEDIUM–HIGH (lange Aufgaben, Kosten, Injection). Phase 1 ändert keinen bestehenden
Gesprächspfad. Begrenzte Aufrufe, Zeit-/Größenlimits, Schema- und Fundstellenprüfung,
vorhandene Quoten und read-only-Governance reduzieren das Risiko. Phase 2 berührt den
zentralen Chatpfad und benötigt eigene GitNexus-Auswirkungsanalyse und HTTP-Abnahme.

## Phase-1-Validierung (ursprünglicher Stand)

- 23 Modulprüfungen grün; 479 bestehende Gateway-/Gesprächs-/Retrieval-Prüfungen
  grün (25,05 s), inklusive Disclaimer-Wächter.
- Harness: 86 Prüfungen, zuletzt 25,25 s (<60 s). HTTP-e2e: 24,53 s, Gateway-Negativfälle grün.
- Lint: keine Fehler; eine bestehende unused-vars-Warnung in domain-free-core.test.js.
  check:llm und check:domain-free-core grün; die neuen drei Module sind Teil des Core-Checks.
- Separater deterministischer Stub-Durchlauf: 233256 Dokumentzeichen, 36 Map-Aufrufe,
  ein Reduce, 256243 Promptzeichen, 9 ms. Fundstellen Kapitel 1 und 6. Kein echtes Modell,
  keine gemessenen Produktionskosten. Laufzeiten eines echten Modells stehen noch aus.
- Kollegen-Rubrik für den Stub: Ausgangszahlen verstanden; Fundstellen nutzbar; Ton direkt;
  Unsicherheit über fehlende Maßstäbe explizit; Review-Entwurf optional schema-validiert.
  Diese Rubrik ersetzt keine Live-Abnahme des konkreten Akzeptanzdokuments aus AC-05.


## Review-Nachprüfung für PR #756

- 36 Modulprüfungen grün, inklusive 360 nummerierter Listenzeilen (3 Maps bei Budget 4),
  vollständiger Offsetabdeckung, Parallelität 4/2, geordneter Ergebnisse trotz wechselnder
  Laufzeit, einzelner Timeout-/429-/Schemafehler und der strikten >50-%-Grenze.
- Die lange synthetische Fixture wird vollständig in 20 Maps verarbeitet; die oben
  genannten 36 Maps beschreiben den ursprünglichen Stand vor der Bündelung.
- Bei Ablauf der Gesamtdeadline bleiben erfolgreiche Maps und Lücken erhalten;
  es starten weder weitere Maps noch Reduce. Ein fehlgeschlagenes Reduce liefert
  weiterhin `failed` bzw. `timeout`, sofern nicht mehr als 50 % der Maps fehlen.
- `tests/shared-service-journal.service.test.js`, „current retained split IDs remain
  digestible and new entries stay in their current scope“, scheitert identisch auf
  `origin/main@07ea207c` und dem PR-Branch: Zeile 450 erwartet `entryCount: 1`, erhält 0.
  Jeweils 13 weitere Tests grün. Kein Journal-Fix und keine Deaktivierung in diesem PR.

## Große Dateien aus Open WebUI

Im Volltext-Modus überträgt Open WebUI die Dateiinhalte im Chat-Kontext an
`/v1/chat/completions`. Ein Jahreslastgang mit etwa 35.000 Viertelstundenzeilen
kann ein bis zwei Millionen Zeichen umfassen. JSON-Escaping und Chat-Verlauf
vergrößern den HTTP-Body zusätzlich.

Diese Grenzen müssen zueinander passen:

- Am Reverse Proxy muss `client_max_body_size` den gesamten HTTP-Body zulassen,
  beispielsweise `client_max_body_size 16m;` im zuständigen Nginx-Server-/Location-Block.
- `OPENAI_COMPAT_BODY_LIMIT=16MB` begrenzt JSON- und URL-encoded-Bodies ausschließlich
  unter `/v1`. Andere CET-Routen behalten ihre bestehenden Limits. Nach einer
  Änderung CET neu starten; Proxy-Konfiguration prüfen und separat neu laden.
- `WORKBENCH_DOCUMENT_MAX_CHARS=4000000` begrenzt die Summe der aufgenommenen
  Dokumenttexte in Zeichen. Es ist unabhängig vom HTTP-Byte-Limit und vom
  kleineren Budget für normale Nachrichten (`WORKBENCH_MAX_INPUT_CHARS`).
- Die Review-Budgets aus #754, insbesondere `WORKBENCH_REVIEW_MAX_CHARS`, bleiben
  eigenständig. Eine erfolgreiche Aufnahme bedeutet nicht, dass das gesamte
  Dokument in einen einzelnen Review oder Modellaufruf passt.

Bei einer Überschreitung des CET-Body-Limits erhält Open WebUI HTTP 413 mit einem
OpenAI-kompatiblen `error.message` auf Deutsch: aktuelle Grenze und Hinweise zum
Aufteilen, kleineren Ausschnitten oder weniger Chat-Verlauf. CET protokolliert
nur die Größen-/Limit-Metadaten, keine Dateiinhalte. Lehnt bereits der Proxy ab,
kommt die Anfrage nicht bei CET an: dessen Grenze bzw. Fehlerseite separat prüfen.
