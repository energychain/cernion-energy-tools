# Dokumenten-Review: Betrieb und Abnahme (#754)

## Phase 1 und Integration

Phase 1 stellt Parser, Dokumentaufnahme und Map/Reduce als eigenständig testbare Module
bereit. Der produktive Gesprächspfad bleibt bis zum Merge von #752 unverändert.
Phase 2 muss danach origin/main per Merge-Commit integrieren und diese Module vor der
Thread-Aufbereitung einbinden. Review-Erkennung, schnelle erste Antwort, Fortsetzung und
Notice gehören ausdrücklich zu Phase 2. Bis dahin ist dies kein fertiges Chat-Feature.

`parseOpenWebUIContext(text)` trennt Frage und Dokumente. `attachDocuments(store,
identity, documents, options)` nutzt `normalizeEvidenceInput` und den bestehenden
`WorkbenchStore.saveEvidence`; kein zusätzlicher Dokumentstore. Volltext, Gliederung,
Quell-ID und Vollständigkeit liegen in `EvidenceRef.extracts.document`, SHA-256 in
`fileHash`. `loadDocuments` liest dieselbe Fallgrundlage tenant-/fallgebunden und beachtet
die Sensitivity-Freigabe. Identität kommt aus dem bestehenden Gateway, nie aus dem
Dokument. Namen unterliegen der bestehenden Evidence-Validierung. Inhalte werden nicht
protokolliert. Deduplizierung nutzt den bestehenden Fingerprint.

`reviewDocuments` verwendet ausschließlich `src/llm-client.js`; Tests ersetzen die Fassade.
Eine Retrieval-Runde nutzt die vorhandene `collectEvidence`-Pipeline mit den konfigurierten
Wissensquellen, Datapoints und freigegebenen read-only-Capabilities. Die vorhandenen
Scope-/Mandatsprüfungen bleiben wirksam. Map liest sämtliche Abschnitte; Reduce erhält
begrenzte strukturierte Maps und die gelieferten Prüfmaßstäbe. Fachliche Standards sind
nicht im Kern kodiert. Ohne Quellen prüft der Ablauf nur innere Stimmigkeit und benennt
das ausdrücklich. Fundstellen sind validierte Map-Indizes mit Kapitel, Seite und
Zeichenoffsets; Maßstäbe sind validierte Quellenindizes. Modellqualität erfordert zusätzlich
manuelle Abnahme. Dokumente, Namen und Quellen bleiben nicht vertrauenswürdige Daten.

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

| Einstellung | Default | Zweck |
| --- | ---: | --- |
| WORKBENCH_DOCUMENT_MAX_CHARS | 1000000 | Aufnahmebudget pro Dokumentpaket |
| WORKBENCH_REVIEW_MAX_CHARS | 250000 | Review-Eingabe insgesamt |
| WORKBENCH_REVIEW_TIMEOUT_MS | 45000 | Gesamtbudget inkl. Retrieval |
| WORKBENCH_REVIEW_MAX_MAP_CALLS | 64 | Maximale Abschnittsaufrufe |
| WORKBENCH_REVIEW_SECTION_CHARS | 12000 | Maximale Abschnittslänge |
| WORKBENCH_REVIEW_CRITERIA_CHARS | 12000 | Quellenbudget für Reduce |
| WORKBENCH_REVIEW_MODEL | Antwortmodell aus WORKBENCH_LLM_MODEL | Optionales Review-Modell |

Überschreitungen werden vor Map-Aufrufen abgewiesen; kein stilles Kürzen. Timeout gibt
Teilfortschritt zurück und startet keine weiteren Modellaufrufe. Bereits laufende Fassade-
oder Retrieval-Aufrufe können bis zu ihrem eigenen Timeout weiterlaufen; ein späteres
Ergebnis wird nicht als fertiges Review übernommen. Die Integration muss diese Zustände
als Budget-/Fortsetzungshinweis behandeln. Die Modellwahl und Denkbudget-Vorgaben werden aus den bestehenden Workbench-Antwortoptionen übernommen; Kommapaare wählen das Antwortmodell. Modellquoten und PII-Scrubbing liegen weiter
in der Fassade. Aufrufe: ein Map pro Abschnitt und ein Reduce; Kosten wachsen linear mit
der Dokumentlänge. `stats` berichtet Aufrufzahl, Dokument-/Promptzeichen und Laufzeit.
Ohne tatsächlichen Modellbetrieb wird kein Geldbetrag als gemessene Kosten angegeben.

## Akzeptanzmatrix

| Kriterium | Phase-1-Nachweis | Noch erforderlich |
| --- | --- | --- |
| AC-01 | Parser-Varianten; Injection als Daten; Quell-ID nicht in Modelltext | Antwort-Rendering aus #752 |
| AC-02 | Synthetischer Volltext >100000 Zeichen; PouchDB-Roundtrip; Hash, Gliederung, Deduplizierung, Isolation | HTTP-Aufnahme und Folgeturn |
| AC-03 | Map/Reduce-Struktur; validierte Fundstellen; Widerspruch in Kapitel 1/6 | turnKind review und Kollegen-Antwort |
| AC-04 | Vorhandene Retrieval-Pipeline; Kriterienquellen; ausdrücklicher Hinweis ohne Treffer | Endgültige Quellenzeile aus #752 |
| AC-05 | Synthetische neutrale Fixture, deterministische Fassade; kein Kundendokument | Echter öffentlicher/anonymisierter Akzeptanzfall mit Modell und Kollegen-Rubrik |
| AC-06 | Modul- und Regressionstests; Harness/HTTP/Gateway/Wächter sowie statische Checks | Nach Phase-2-Integration erneut ausführen |

Fixture über `node scripts/generate-review-fixture.js` erzeugen. Die deterministische
Testfassade extrahiert eingebaute Ausgangszahlen und Wachstumsannahmen. Das belegt
Orchestrierung und Fundstellen, nicht die Urteilsgüte eines echten Modells. Echte
Modellkosten im Stub: 0; keine Live-Qualitätsbewertung behaupten.

Risiko: MEDIUM–HIGH (lange Aufgaben, Kosten, Injection). Phase 1 ändert keinen bestehenden
Gesprächspfad. Begrenzte Aufrufe, Zeit-/Größenlimits, Schema- und Fundstellenprüfung,
vorhandene Quoten und read-only-Governance reduzieren das Risiko. Phase 2 berührt den
zentralen Chatpfad und benötigt eigene GitNexus-Auswirkungsanalyse und HTTP-Abnahme.

## Phase-1-Validierung

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
