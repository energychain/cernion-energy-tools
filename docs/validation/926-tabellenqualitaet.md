# Validierung #926 – Tabellenqualität

Stand: 2026-10-16. Branch `feat/926-tabellenqualitaet`, ausschließlich dieser Worktree.
Keine Live-LLM- oder Live-Praxisläufe, kein Push, keine schreibenden GitHub-Aufrufe.

## Verhalten und Akzeptanz

| Kriterium | Offline-Nachweis | Status |
| --- | --- | --- |
| AC-01 | Zwischen-, führende, wiederholte Gesamtkontrollen ausgeschlossen; Daten-/Gruppensummen 40 bzw. 30/7/3; Bestätigung mit Anzahl und Abgleich; Rundung, Vorzeichen, numerische Kennungen und abweichende Kontrollspalte | Erfüllt |
| AC-02 | Echte Zeile ohne Gruppe bleibt Daten; auch numerische Kennungen geschützt; unbewiesene bzw. widersprüchliche Kandidaten bleiben Daten | Erfüllt |
| AC-03 | XLSX-Original mit Basis/Variant; eindeutige Titel, getrennte Versionen/Wiederholungserkennung, beide Quellen ohne Blattbezug, Differenz 4 und vier geänderte Zeilen; explizite Blattwahl, gesprächsbezogene Bestätigung; Manifest mit nur einer Quellnode ergänzt Varianten | Erfüllt |
| AC-04 | Zeilenanzahl ohne Einheitenfrage; Wertaggregation fragt einmal je Datensatz; auditierte Einheit kg wird in Folgeturns verwendet | Erfüllt |
| AC-05 | Generiertes Szenario `table-quality`, Katalog-Audit; identischer Helfer im Chat- und Aktenimport über Batchgrenzen | Offline erfüllt; Live-Praxislauf durch aufrufende Session offen |

Die Erkennungsregeln stehen ausführlich in `docs/table-upload-quality.md`:

- Kontrollzeilen: strukturelle Leerstellen/abweichende Bezeichnungsstruktur und
  mindestens zwei numerisch belegte Datenzeilen. Toleranz je Spalte
  `max(0,02; |Datensumme| × 10⁻⁸)`. Nicht-nullwertige Evidenz erforderlich.
- Vollständige Übereinstimmung aller ausgefüllten Wertspalten; eine Abweichung wird
  nur bei mindestens zwei bestätigenden Spalten und mindestens 80 % Übereinstimmung
  als Kontrollbefund anerkannt. Sonst bleibt die Zeile Daten.
- Kennungsartige Spalten: Distinktheitsquote ≥ 80 %. Numerische Kennungen mit
  Leerstellen: sichere Ganzzahlen und ≥ 80 % gleicher, von null verschiedener
  Schritte im Sample bis 256 Zeilen. Höchstens 1.000 Kontrollzeilen/4 MiB;
  bei mehr Kandidaten keine teilweise Bereinigung.
- Varianten: identische Spaltennamen/-typen, eindeutige nicht leere Schlüssel,
  mindestens zwei gemeinsame Kennungen, Überdeckung ≥ 80 % der größeren Tabelle.
  Überdeckung, Zeilendifferenzen und veröffentlichte Werte kommen aus SQLite-Abfragen.
- Einheit nur bei tatsächlich verwendeter Wertspalte; gespeicherte Frage einmal
  je Datensatz. Metadatenkorrektur, Blattbestätigung und Kontrollzeilenkorrektur
  verwenden den vorhandenen auditierten `dataset.turn`-Pfad, ohne neue Phrasenliste.

## Blast Radius und Impact-Analyse

GitNexus `impact(direction="upstream")` wurde vor Änderungen für `matrixRows`,
`parseTableText`, `datasetTurn`, `matchingDatasets`, `structureTable`,
`selectDatasetCandidates`, den Query-Handler, `executeDatasetQuery`, `datasetSemantics` (nur geprüft,
letztlich unverändert), `readTurnDataset`, `incomingDatasetReply`, `datasetQuestion`, `turnDatasetIds`,
`readProjectEvidence`, `storedTableQuality`, `generatePracticeCatalog`, `practiceDocument` und den
Praxis-Katalogtest angefordert. Der verfügbare Index kennt diese Symbole nicht
(`Target not found`, Risiko `UNKNOWN`); es liegt deshalb kein belastbarer
Graphnachweis und auch keine HIGH-/CRITICAL-Einstufung vor.

Die ergänzende `grep -rn`-Referenzsuche ergibt folgenden manuell bewerteten Umfang:

| Geänderte Stelle | Direkte Verbraucher / betroffene Abläufe |
| --- | --- |
| `matrixRows` / `parseTableText` | `parseDatasetText`; Chat-Datei-/Textimport und strukturierte Nachrichten-Erkennung |
| `datasetTurn` / `matchingDatasets` / Query-Handler | `dataset.turn`, `dataset.query`; Katalog, Versionen, Korrekturen und deterministische Antworten |
| `executeDatasetQuery` | Query-Handler und kurzlebige Tabellen; Abfrage veröffentlicht die tatsächlich verwendeten Wertfelder für die Einheitenfrage |
| `structureTable` | `project-structure.run`; gestreamte Aktentabellen, Katalog und Graphregistrierung |
| `selectDatasetCandidates` | `matchingDatasets`, zwei Workbench-Routingstellen; Quellenauswahl innerhalb bestehender Scopes |
| `datasetQuestion` / `readTurnDataset` / `incomingDatasetReply` | unmittelbare Workbench-Antwort nach Import und bei Folgefragen |
| `readProjectEvidence` | `projectManifestAnswer`; Workbench und Personal-Agent lesen aktuelle Aktenquellen |
| Praxis-Generatoren | Kataloggenerator, Praxis-Transport, Fixture-Audit und abhängige Tests |

Manuelle Risikoeinstufung: **MEDIUM**, da die Änderung Zeilen und damit Zahlen in
Antworten beeinflusst. Gemeinsame Helfer vermeiden kopierte Regeln. Keine Änderung
an Gateway-Rollen, Tenant-Schlüsseln, globalen Allowlists oder Integrationszugängen.
Keine neue Umgebungsvariable; `.env.example` bleibt unverändert.

## Checks

- Gezielte Abschlussserie: 6 Suites/100 Tests grün (Tabellenqualität,
  Dataset-Service, Varianten, Aktendatensätze, Praxis-Katalog und Projekt-Ingest).
- Ergänzende Tabellen-/Aktenserie: 6 Suites/59 Tests grün, einschließlich
  Streaming-Batch-/Speicherprüfung und bestehender Projektstruktur-Regressionen.
- Frei wählbare Quellspalte `row_number`: Quellwerte ersetzen keine interne
  SQLite-Zeilenidentität; korrekte Kontrollzeile und Datenzeilen sind geprüft.
- Numerische Kennungen mit späterer Bezeichnung außerhalb des Samples werden
  verarbeitet; unbelegte Textwerte in numerischen Spalten bleiben blockiert.
- Deutsches Dezimalkomma: Delimiterwertung verwendet die ursprüngliche Zeilenzahl
  inklusive Kontrollzeilen. Der fehlerhafte Alternativparse mit Datenwerten als
  Kopfzeile gewinnt nicht durch weniger ausgeschlossene Zeilen. Das generierte
  Praxis-Szenario liefert beide Blätter ebenfalls mit Dezimalkomma.
- `test:shared-service:ci`: grün, 3 Suites/86 Tests, 19,392 s.
- `test:e2e:shared-service`: grün, 15,47 s, ausschließlich Stub-Fassade.
- `test:tdd-matrix` und `check:tdd-matrix-coverage`: grün, 66/66 erforderliche IDs,
  100 %. Die 12 optionalen Blackbox-IDs bleiben ausdrücklich optional.
- Metadatenkorrekturen erweitern die normale Datensatz-Löschung nicht auf
  Aktendatensätze; deren Löschweg über die Projektakte bleibt erhalten.
- Bestehender Background-Ingest-Timingtest: Brokerlimit 1.000 ms und lokaler
  Scan 3.000 ms statt 50/150 ms. Das Verhältnis bleibt 3:1, dauerhafte
  vorgelagerte Speicheroperationen erhalten ausreichenden Zeitspielraum.
  Gezielter Test grün; Produktionscode dafür unverändert.
- Vollständiger `test:unit:ci`: alle 25 Chunks grün, 479 Suites/10.388 Tests
  bestanden; 7 Suites/54 Tests übersprungen. Coverage-Gates bestanden:
  Statements 84,22 %, Branches 70,49 %, Funktionen 88,47 %, Zeilen 85,98 %.
- `build`: grün (projektgemäß ohne Build-Schritt).
- `lint -- --quiet`: grün, 0 Fehler; der vorherige vollständige Lint-Lauf
  zeigte 12 Warnungen in bestehenden Dateien.
- Zusätzliche S1751-äquivalente Prüfung mit ESLint `no-unreachable-loop`:
  12 berührte Kern-Dateien, 0 Befunde (kein separater Sonar-Serverlauf).
- `check:practice-fixtures`, `check:domain-free-core` und
  `check:domain-free-equivalence`: grün; keine Domänenbefunde, Äquivalenz über
  155 Dateien einschließlich Kontaminationsfixture.
- `check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm`: grün.
- `audit:openapi`: grün, 0 Issues/480 Warnungen.
- `git diff --check` und Prüfung des gestagten Diffs: grün.

`detect_changes(scope="staged", worktree=...)` wurde für den abschließenden
staged Stand ausgeführt: 31 geänderte Dateien, 0 zugeordnete Symbole/Abläufe und
`low`. Wegen des fehlenden Symbolindex ist dies keine belastbare Risikoaussage;
die manuelle Einstufung bleibt **MEDIUM**. Der zusätzlich angeforderte Vergleich
gegen `main` blieb auch beim erneuten Versuch ohne rechtzeitige Antwort.
Die manuelle Prüfung gegen `origin/main` und des staged Diffs umfasst die
erwarteten 31 Dateien. Der Worktree ist anhand unterschiedlicher
`git-dir`-/`git-common-dir`-Pfade als verlinkter Checkout bestätigt.

Die Generatoren `export:openapi`, `generate:operation-capability-index`,
`generate:llm`, `generate:function-model`, `generate:signal-catalog` und
`generate:practice-fixtures` wurden nach den Implementierungsänderungen ausgeführt.
Artefakte ohne Inhaltsänderung erzeugen keinen Git-Diff.

## Allowlist und Grenzen

Die globale Domänen-Allowlist wurde nicht geändert. Ausschließlich das separate,
reviewte `scripts/practice-synthetic-vocabulary.js` enthält zusätzliche neutrale
Wörter für den generierten Tabellenfall (Blätter, Kontrollsummen, Einheiten,
Varianten und technische Szenariofelder). Keine Fachbegriffe wurden global freigegeben.

Konservative Erkennung kann strukturell mehrdeutige Summenzeilen als Daten erhalten;
Kontrollmetadaten machen bestätigte Ausschlüsse nachvollziehbar und korrigierbar.
Es erfolgt keine automatische Migration älterer gespeicherter Zeilen. Große
Aktenimporte bleiben diskgestützt; eine ausdrücklich bestätigte Wiederherstellung
liest den betroffenen Datensatz für die vorhandene Tabellen-Neuschreibung ein.
Der Live-Praxisnachweis ohne Regression ist bewusst nicht behauptet und bleibt
für die aufrufende Session offen.
