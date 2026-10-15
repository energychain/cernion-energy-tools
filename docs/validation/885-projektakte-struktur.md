# Validierung #885 — Strukturierung im Datenstrom

Stand: 15.10.2026, Node 24.18.0, Branch `feat/885-projektakte-struktur`.

## Entscheidungen und Dateien

- `services/project-structure.service.js`: capabilitygeschützter Handoff aus
  `project-upload.markReceived`, gleicher Aktenlock; paginierte Wiederaufnahme aus
  vorhandenen Object-Store-Objekten beim Dienststart. Erfolgreiche Ableitungen sind
  nach Hash/Objekt/Parser-Version idempotent. Auch der Absturz nach fertiger
  Strukturierung vor dem finalen Ingeststatus wird repariert.
- `src/project-dataset-pool.js`: Unterklasse des vorhandenen `DatasetSqlitePool`,
  fest an Tenant/Akte gebunden, Datei im kodierten Aktenverzeichnis. Chat-Pool und
  dessen tenantweite Dateien bleiben unverändert. Query-Planung, Semantik und
  SQLite-Executor werden wiederverwendet; Akten-Zeitqualität arbeitet mit Iteratoren.
- `src/project-structure-stream.js`: CSV-Grenzerkennung im Stream mit vorhandenen
  CSV-/Connector-Helfern; XLSX per ZIP64/CRC-Helfern aus #884 und SAX. Ein XML-Eintrag
  auf Platte, begrenzte Shared Strings, kein Gesamtworkbook im Speicher.
- `src/project-structure-document.js`: PDF seitenweise über dieselbe Parser-Factory
  wie der File-Channel; DOCX/PPTX-Absätze über SAX; TXT/EML in Textabschnitten.
  Bestehendes Dokumentwissen/RAG und untrusted-Gedächtnisextraktion bleiben zuständig.
- Kandidaten in `project_candidates` der Akten-SQLite: Objekt, Ableitungsversion,
  Art, lokaler Wert, Fundstelle als JSON und optionales Katalogfeld. Damit teilen
  Tabellen/Kandidaten die physische Aktenisolation und bestätigte Löschkaskade.
- `workbench-data-scope` verwendet aktuelle, autorisierte `projectRefs` aus dem
  Katalog. Ohne passenden Gesprächs-/Fallverweis oder explizite strukturelle ID
  gelangen Aktendatensätze nicht in den Scope. Archivierung/Löschung/Mitgliedschaft
  werden bei Abrufen erneut geprüft.

Review-Korrektur nach `1c8cf88e`: Die Rohdaten-Grenze gilt für Tabellen.
Dokumentabschnittstext erreicht als untrusted `document` den regulären Extractor;
`memory.start` läuft deferred einschließlich der normalen Aussagenprüfung.
Eine nicht verfügbare Vergleichsprüfung lässt Aussagen `pending`; es gibt keinen
Sonderabschluss per `assessmentScope`. Projekt-/Objektherkunft bleibt erhalten.

`CET_PROJECT_MEMORY_MAX_SECTIONS_PER_OBJECT=50` und
`CET_PROJECT_MEMORY_MAX_SECTIONS_PER_PROJECT=500` begrenzen tatsächliche
Extraktions-Prompts. `object.memory` enthält `attemptedSections` (dauerhaft über
Neustarts/Neuverarbeitung), `extractedSections` und `skippedSections` (letzter Lauf).
Reservierung erfolgt vor dem Aufruf unter dem bestehenden Aktenlock; Fehler
verbrauchen Budget. Übersprungener Text bleibt im Dokumentwissen/RAG suchbar.
Quoten und reguläre Aussagenprüfung laufen weiterhin über `llm-client`.
Für Altobjekte ohne Zähler beginnt die Budgetzählung mit der Korrektur.

## Akzeptanzkriterien

| AC | Status | Nachweis |
| --- | --- | --- |
| AC-01 | erfüllt | generierte 1.000.000-Zeilen-CSV mit Zeitfeld, Batchgrenzen, feste Speicherbudgets, Aggregate über `dataset.query` |
| AC-02 | erfüllt | mehrere XLSX-Blätter, Shared Strings, große generierte Sheet-XML, verbotener Gesamtworkbook-Reader, eigene Datensätze mit Blattherkunft |
| AC-03 | erfüllt | echte generierte PDF-Seiten, DOCX-Absätze und PPTX-Folien; Passagen/RAG mit Seite/Folie/Kapitel und Akten-/Objektherkunft |
| AC-04 | erfüllt | spionierte/gesperrte LLM-Fassade; Tabellen-Prompts ohne Rohzeilen, Zellbeispiele oder private Zellwerte |
| AC-05 | erfüllt | Gesprächs-/Fallreferenz, fehlender Bezug, geänderte Referenz, Mitgliedschaft, Archivierung und unvollständige Löschung |
| AC-06 | erfüllt | fehlerhafte Einzel-CSV erhält Grund; gültige Objekte bleiben erhalten, Akte `degraded`, Wiederaufnahme und idempotente Cleanup-Wiederholung |
| AC-07 | erfüllt | Domänenprüfung ohne Befunde; vorhandene Parser, Profile, Semantik, Zeitnormalisierung, Query-Ausführung, Dokumentwissen und Archivschutz wiederverwendet |

## Großlauf (Ausgangscommit; Tabellenpfad durch die Review-Korrektur unverändert)

Reproduktion: `node scripts/test-project-structure-large.js`.
Der Generator schreibt inkrementell unter `/tmp`, durchläuft das echte
Chunkupload-/Ingest-Protokoll und fragt den fertigen Datensatz über den Broker ab.
Die LLM-Fassade ist für diesen Lauf offline gesperrt. Messung alle 20 ms und vor/nach
jedem SQLite-Schreibbatch. Die Abfrage enthält ein Zeitfeld, damit auch die große
Zeitqualitätsprüfung durchlaufen wird.

| Größe | Messwert |
| --- | ---: |
| Zeilen | 1.000.000 |
| CSV-Bytes | 31.888.910 |
| Erwartete und erhaltene Summe | 500.000.500.000 |
| größter Schreibbatch | 1.000 Zeilen |
| Laufzeit inklusive Upload, Abfrage, Cleanup | 19.046 ms |
| RSS Start / Spitze / Zuwachs | 204.873.728 / 323.969.024 / 119.095.296 Bytes |
| HeapUsed Start / Spitze / Zuwachs | 64.449.232 / 123.068.720 / 58.619.488 Bytes |
| feste Grenzen | RSS +256 MiB, HeapUsed +128 MiB — bestanden |

Die Messung ist ein konkreter Lauf, keine universelle Laufzeitgarantie.
Profil-/Batch-/Shared-String-Budgets bleiben unabhängig von der Zahl der Eingabezeilen.
Die Unit-CI-Variante verwendet standardmäßig 5.000 Zeilen; `CET_PROJECT_LARGE_ROWS`
überschreibt die Größe. XLSX-Tests verwenden generierte XML-Blätter; keine großen
Dateien werden eingecheckt. Zwei neutral benannte Aktenfixtures decken die vorhandenen
Katalogdomänen `metering` und `receivables` mit Tabellen und Dokumenten ab.

## Blast Radius

GitNexus `query` und `impact` wurden verwendet. Der erreichbare Index
`cernion-energy-tools-current` enthält die aktuellen Dataset-/Projekt-/Dokumentsymbole
nicht: die entsprechenden Analysen melden `Target not found`, Risiko `UNKNOWN`.
Eine quantitative Graph-Aussage wäre daher unbegründet. Für `detectDelimiter`
liefert GitNexus **LOW**, einen direkten Aufrufer und keine erfassten Prozesse.
Die lokale `grep -rn`-Aufruferanalyse ergänzt den veralteten Index:

| bestehende Symbole | direkte Nutzung / betroffene Flüsse | Bewertung |
| --- | --- | --- |
| Dataset `query`, `datasetHealth`, `datasetTurn` | Broker-/Workbench-Lesepfad und Chat-Ingest; zusätzlicher Aktenadapter, Chat-Mutationen bleiben auf Chatdaten beschränkt | hoch, Regressionen erforderlich |
| Katalog-Handler, `scopedDatasets`, `selectDatasetCandidates` | Dataset-Service, Workbench-Content-Turn, Workbench-Self-Knowledge und Routing | hoch, aktuelle Sichtbarkeit/Scope sind zentral |
| `executeDatasetQuery`, `datasetSemantics`, `normalizeDatasetTimes` | Dataset-Abfragen, Semantikkorrektur und neue Aktenbatches | mittel bis hoch; Defaultpfade bleiben erhalten |
| `markReceived`, `settleLifecycle` | Original-/ZIP-Ingest und Statusbereinigung | mittel; interner Handoff und Strukturierungsstatus ergänzt |
| Dokument-`records`, `sections`, `ingestDocument`, `searchDocuments`, `visibleChunks`, `withDocumentSource` | Dokumentablage, Passagensuche, RAG-Sichtbarkeit und Gedächtnisextraktion | hoch; Aktenbindung und paginierte Suche |
| `rememberDocument`, `extractOriginal` | Workbench-Dokumentfluss, File-Channel und neue Aktenabschnitte | mittel; gemeinsamer PDF-Factory-Pfad und reguläre Akten-Dokumentextraktion mit dauerhaft reservierten Abschnittsbudgets |
| `DatasetSqlitePool`, `EdmSqlitePool` | bestehender Chat-/SQLite-Unterbau | Implementierungen unverändert; neue Unterklasse nutzt vorhandene Methoden |

Die hohe manuelle Risikoeinstufung wurde vor den Routing-/Dataset-Eingriffen
kommuniziert. Neue öffentliche OpenAPI-Tags gibt es nicht; bestehende Tags bleiben
in der Taxonomie unverändert. Alle neuen Mutationen sind geschützte interne Aktionen.

## Review-Korrektur: Checks

Ergänzte Regressionen prüfen Dokumenttext im untrusted Prompt, deferred `memory.start`,
regulär ausstehende Aussagenprüfung bei Vergleichsfehlern, Objekt-/Aktengrenzen,
Neustart mit ausgeschöpftem Budget, Fehlerreservierungen und vollständige Suchbarkeit
übersprungener Abschnitte. Tabellen-Prompts bleiben durch die bestehenden Zellwerttests
abgesichert. Keine neuen Allowlist-Einträge.

Der manuelle Blast Radius der Korrektur ist mittel: `rememberDocument` hat zwei
Aufrufer (Chat-Ingest und Projektstrukturierung); `documents` wird nur intern von
`structureObject` aufgerufen. GitNexus `impact` findet beide Symbole weiterhin
nicht (`UNKNOWN`); die lokale `grep -rn`-Aufrufsuche wurde vor Änderungen ausgeführt.
Dataset-/Routing-/Pool-Symbole werden durch die Korrektur nicht verändert.

- Gezielte Projektstrukturierungs-/Dokumenttests: **39 Tests bestanden**.
- `npm run test:unit:ci`: **10.173 Tests bestanden**, 54 konfiguriert
  übersprungen; 466 Dateien, 24 serielle Pakete. Coverage: Statements **83,97 %**,
  Branches **70,16 %**, Funktionen **88,21 %**, Zeilen **85,73 %**; alle Gates grün.
- Lint, Domain-Free-Core, TDD-Matrix-Abdeckung (**66/66**, **100 %**), Function-Model,
  Signal-Catalog, Operation-Capability-Index und LLM-Abgleich: **bestanden**.
- Alle fünf Artefaktgeneratoren nach der letzten Testanpassung erneut in der
  vorgeschriebenen Reihenfolge ausgeführt; Abgleich **bestanden**.
- OpenAPI-Audit: **0 Issues**, 480 bestehende Warnungen. `git diff --check`: **bestanden**.
- Dependency-Reihenfolge alphabetisch; Root-Dependencies in Manifest und Lockfile
  stimmen überein. Keine Versionsänderung.
- GitNexus-Scope-Prüfung vor dem Folgecommit: erwartete 14 Dateien; die Begrenzung
  des veralteten Symbolindex gilt weiterhin.

## Checks des Ausgangscommits

- 25 neue Tests in zwei Strukturierungs-Suites — bestanden, einschließlich
  frühzeitigem Stream-Abschluss bei ungültiger Kopfzeile und Wiederholung eines
  absichtlich unterbrochenen Dokument-/Gedächtnis-Cleanups.
- Gezielte Regressionen: 159 Tests in neun Suites; weitere gezielte Prüfung mit
  Dokument-/Dataset-/Parser-Tests: 85 Tests in sechs Suites — bestanden.
- `npm run lint -- --quiet`, `npm run check:domain-free-core`, `npm run build` — bestanden.
- Artefakte in verlangter Reihenfolge neu erzeugt:
  `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
  `generate:function-model`, `generate:signal-catalog`.
- `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`,
  `check:llm` — bestanden; `audit:openapi`: **0 Issues**, 480 Warnungen.
- Nach Korrektur der Test-Broker-Isolation und ergänzt unterbrochenem Dokument-Cleanup:
  62 Tests in vier Projekt-/Ingest-/Dokument-Suites — bestanden.
- `npm run test:tdd-matrix`: 82 Tests bestanden, vier konfiguriert übersprungen.
- `tests/project-ingest.integration.test.js`: Offline-Integration bestanden
  (16-MiB-Archiv, vier Objekte, Original-/ZIP-/Cleanup-Pfad).
- `check:tdd-matrix-coverage`: 66/66 erforderliche IDs, **100 %**; zwölf optionale
  Blackbox-IDs bleiben explizit deaktiviert.
- `npm run test:unit:ci`: **10.171 Tests bestanden**, 54 konfiguriert übersprungen;
  466 Dateien in 24 seriellen Paketen. Coverage: Statements **83,95 %**, Branches
  **70,15 %**, Funktionen **88,21 %**, Zeilen **85,72 %**; alle Gates bestanden.
- `git diff --check` und staged Scope-Prüfung — bestanden. GitNexus
  `detect_changes({ scope: staged, worktree })` erfasst die erwarteten **41 Dateien**,
  wegen des veralteten Index aber keine Symbole/Prozesse. Das nominelle Tool-Risiko
  `low` ersetzt deshalb nicht die oben dokumentierte lokale Impact-Analyse.

Die Prüfungen verwenden temporäre Datenpfade. Lokale `.env`-Dateien werden dabei
nicht geladen; es werden keine externen Zugangsdaten benötigt.

## Technische Allowlist und Folgeissues

Nur zwei technische Begriffe wurden mit konkreter Begründung ergänzt:
`connector` für den vorhandenen CSV-Modulpfad und `slide` für PPTX-XML/Fundstellen.
Keine Fachbegriffe, keine Tenant-ID-Hashes und keine Gateway-Schreibrollenausnahmen.

- #886: begrenzte Kandidaten in bestätigte Entitäten/Relationen überführen;
  Herkunft und Stichprobengrenzen berücksichtigen.
- #887: Status, unbekannte Typen, Ableitungsversion, Fundstellen und Kandidatenbudgets
  in Manifest/Ansichten übernehmen.
- #888: autorisierten Aktenpfad read-only öffnen, Tabellen-/Spaltenkatalog prüfen;
  bei späteren parallelen Interpretern SQLite-Snapshots berücksichtigen.
- OCR bleibt ausdrücklich außerhalb dieses Issues. Vorhandene Nachrichtenparser
  bleiben durch ein Bytebudget begrenzt; sie werden nicht als streamingfähig ausgegeben.
