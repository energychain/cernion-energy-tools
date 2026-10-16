# Validierung #886 — Relationsgraph der Projektakte

Stand: 16.10.2026, Branch `feat/886-projektakte-graph`.
Offline-Prüfung im zugehörigen Worktree; keine Live-Zugangsdaten, keine externen
Schreibaufrufe und keine neue Datenbank. Generierte Artefakte werden mitgeprüft.

## Sollgraph und Qualitätsmaß

Die eingecheckte Beschreibung in `tests/fixtures/project-graph-cases.json` enthält
zwei getrennte synthetische Akten: Energie (Verzeichnis und beobachtete Reihen)
und Bibliothek (Verzeichnis und beobachtete Reihen). Beide verwenden verschiedene
Werte; die Ableitungslogik erhält dieselben neutralen Strukturen. Je Akte bestehen
drei Tabellen mit Token-, Nummern-/Wert- und Zeitspalten sowie ein beschreibender
Abschnitt. Zwei Tabellen teilen Schlüsselwerte, zwei Reihen überlappen zeitlich,
der Abschnitt nennt einen echten Schlüsselwert.

Gemessen werden **alle** erzeugten `joinsOn`-/`timeAligned`-/`describes`-Kanten
gegen die vier explizit erwarteten gerichteten Kanten. Herkunftsrelationen und
Kandidatenidentität und die tatsächliche Ankerpräsenz im Abschnitt werden separat geprüft; sie sind nicht heimlich aus Fehlern
der Qualitätsmetrik herausgefiltert. True Positive bedeutet dieselbe Quell-/Ziel-
Referenz und Relation; Precision = TP/(TP+FP), Recall = TP/(TP+FN).

| Akte | Erwartet | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Energie | 4 | 4 | 0 | 0 | 1,00 | 1,00 |
| Bibliothek | 4 | 4 | 0 | 0 | 1,00 | 1,00 |
| Gesamt | 8 | 8 | 0 | 0 | 1,00 | 1,00 |

Zusätzlich durchlaufen beide Akten im Broker den wirklichen Chunkupload,
Strukturierung, SQLite, Dokumentwissen, Graph-Adapter und bestätigtes Cleanup.
Auch dort entstehen genau zwei `describes`, ein `joinsOn` und ein `timeAligned`.
Die Fixtures sind klein und deterministisch. Sie belegen die Regeln und Grenzen,
keinen statistischen Qualitätsnachweis für beliebige produktive Unterlagen.

## Abdeckung der Akzeptanzkriterien

| Kriterium | Ergebnis | Nachweis |
| --- | --- | --- |
| AC-01 | erfüllt | Sollgraph-Vergleich beider Domänen und vollständige Offline-Broker-Pipeline |
| AC-02 | erfüllt | Numerische Laufnummern und Zeitspalten liefern keine Joins; hochfrequente Merkmale über 30 Spalten sowie zwei wiederholte Spalten mit niedriger Kardinalität bleiben unter der Schwelle |
| AC-03 | erfüllt | Zwei unabhängige Katalog-Fixtures, verschiedene Aktionen, Anfrageparameter und Antwortpfade; zweiter Fixture mit Bibliothekswerten, unveränderter Kern |
| AC-04 | erfüllt | LLM-Stub liefert erfundene Kanten; Kern verarbeitet keine LLM-Kanten und erzeugt ohne tatsächliche Evidenz keinen Join |
| AC-05 | erfüllt | Bestätigen, Verwerfen und Gewichten über `shared-service-learning.apply`; Audit persistiert, Neuberechnung erhält `origin: corrected`, verworfene Kante bleibt gesperrt |
| AC-06 | erfüllt | Zwei Tenants, mehrere Akten, erzwungene Mango-Präfix-/Tenant-/Aktenbedingungen, Selektorinjektionen abgelehnt; generische Store-Aktionen erreichen keine Graphdokumente |
| AC-07 | erfüllt | `check:domain-free-core` ohne Findings; neue Kernpfade registriert |

Die externe Beobachtung erfordert Metadatenpassung, explizit leere Nebenwirkungen/
Schreibziele, `consequenceLevel: none`, die vorhandene Lese-Scope-/Rollenpolicy und
einen exakt passenden Stichprobentreffer. Tests prüfen fehlende Scopes/Rollen,
fremde Domänen, falsche Rückgabewerte, Fehler, Timeout, fehlende Metadaten,
unsichere Operationen, Principal-Weitergabe und erzwungene Tenant-ID. Ein Aufruf
verwendet `parentCtx: null`, damit Moleculer keine internen Fähigkeiten vererbt.

## Entscheidungen und Betriebsgrenzen

- Bestehender Object Store; geschützter kodierter Aktenpräfix, vier zusammengesetzte
  Mango-Indizes, `bulkDocs` mit 500 Dokumenten pro Batch und Ergebnisprüfung.
- Read-only SQLite mit 8-MiB-Cache und dateibasiertem temporärem Speicher;
  Bottom-k-Sketch über normalisierte Werte, deterministischer SHA-256-Rang, 128
  Werte pro Spalte. Kardinalität und Stichprobenauswahl erfolgen in SQL.
- Wiederholte Kandidaten werden je Objekt/Spalte/Wert kanonisiert; höchstens 16
  Fundstellen je Knoten. Ein Wiederholungstest mit 1.001 gleichen Kandidaten
  verhindert quadratisches Wachstum der `sameEntity`-Ableitung. Zeitkandidaten
  werden in SQL ausgelassen, weil Zeitrelationen aus Datensatzsemantik entstehen.
- Mindestgewicht 0,6, inverse Merkmalsfrequenz und Hub-Abwertung; stärkster Beitrag
  je Evidenzart, Summe maximal 1. Keine Gewichtserhöhung durch wiederholte Evidenz.
- Je Akte/Lauf 10.000 Knoten und 30.000 Kanten; 512 Spalten, 10.000 Kandidaten,
  20.000 Vergleiche. Überschreitung bricht wiederholbar ab. Korrigierte Kanten zählen mit.
- Extern maximal 12 Aufrufe pro Lauf, drei Stichproben pro Spalten-/Quellenpaar,
  jeweils 1.500 ms; Fehler verbrauchen Budget und erzeugen keine Kante.
- Auslöser ist der Abschluss aller empfangenden/strukturierenden Objekte der Akte;
  `settleLifecycle` fordert ohne `force` eine koaleszierte Neuberechnung an. Startup-Recovery und Quellen-/Versionscheckpoint
  sorgen für Wiederaufnahme. Pending-Checkpoint verhindert falschen Abschluss
  nach Teilschreiben; Leseaktionen liefern währenddessen 503.
- Die reguläre Gateway-RBAC bleibt unverändert. Nur drei Leseaktionen sind REST-/
  MCP-sichtbar. Archivierung, Löschmarkierung, Mitglieder und aktuelle Clearance
  werden geprüft. Traversierung höchstens Tiefe 3, maximal 1.000 Treffer.
- Bestätigter Cleanup ist idempotent, unabhängig von SQLite/Originalen und auch
  nach gesenkten Volumenlimits vollständig. Ein echter Brokerneustart prüft
  die Reparatur eines persistierten Pending-Checkpoints.

## Review-Korrektur: Laufbündelung und Speicher

Die Offline-Brokertests zählen wirkliche Aufrufe der Ableitung, vergleichen den
vollständigen persistierten Graphen (einschließlich Checkpoint, ohne `_rev`) mit
einer einzelnen abschließenden Neuberechnung und prüfen:

| Szenario | Vollständige Läufe vor Vergleichslauf | Ergebnis |
| --- | ---: | --- |
| ZIP mit 20 CSV-Einträgen plus Archivobjekt | 1 | identischer vollständiger Graph |
| 20 reservierte Uploads, Abschluss nacheinander | 1 | bis Objekt 19 kein Lauf; identischer vollständiger Graph |
| Dokumentzugriff angehalten, neuer Upload und 20 weitere Anforderungen | 2 | alter Snapshot verworfen, nur neuer Snapshot publiziert; identischer Graph zum finalen Einzellauf |
| unveränderter Checkpoint | 0 | keine Veröffentlichung/Ableitung nach Snapshot-Prüfung |

Der dritte Test lässt den neuen Upload und eine Kantenkorrektur **vor Freigabe**
des blockierten Dokumentzugriffs abschließen. Damit ist nachgewiesen, dass die
Graphberechnung den Aktenlock nicht hält. Die Korrektur überlebt; es gibt genau
ein Korrektur- und ein Graphabschluss-Event, kein Event für den veralteten Snapshot.
Ein weiterer Test löscht die Akte während eines blockierten Dokumentzugriffs:
Cleanup endet, der alte Lauf scheitert an der erneuten Autorisierung, der Graph
bleibt gelöscht. Der bestehende echte Brokerneustart repariert weiterhin einen
persistierten Pending-Checkpoint.

Die Mutationsgrenze schützt den konsistenten, begrenzten SQL-/Metadatensnapshot
und die abschließende Versions-/Berechtigungsprüfung samt Veröffentlichung. Der
SQLite-Handle ist vor dem langsamen Teil bereits geschlossen. Dokumentzugriffe,
Gewichtung und externe Beobachtungen halten keinen Aktenlock. Die Ableitungsversion
ist jetzt `2`; Quellenstatus und alle neuen Budgets gehen in den Checkpoint ein.
Flüchtige Anforderungen koaleszieren pro Tenant/Akte; die bestehende Wiederaufnahme
verwendet weiterhin persistierte Quellen und Checkpoints statt der Warteschlange.

Volltexte werden einzeln autorisiert gelesen und nach dem Abgleich verworfen;
pro Dokument bleiben ausschließlich tatsächlich beobachtete Kandidatenanker erhalten.
Separate Tests prüfen Zeichen-/Ankergrenzen je Dokument und Lauf, sequenzielle
Abfragen, Quellversion/Fundstelle und das Fehlen von Textfeldern im weitergereichten
Material. Standard: **256 Anker / 16.000 normalisierte Ankerzeichen je Dokument**,
**10.000 Anker / 640.000 Zeichen je Lauf**. Die Zeichenbudgets zählen die Summe der
behaltenen normalisierten Werte, nicht die Größe des Originaltexts. Ein Dokument
entspricht einem bereits begrenzten Abschnitt der Strukturierung.

Ankerkürzung bricht den Lauf nicht ab. State und internes Laufergebnis berichten
`documents`, `retained`, `chars`, `skipped`, `truncatedDocuments`, `truncated`.
Ein Broker-Test prüft persistierte Kürzung sowie weiter lesbare Originaltexte und
Abschnittsknoten bei vollständig ausgeschöpftem Zeichenbudget. Die vorhandenen
Graph-/SQL-Volumenlimits bleiben harte Fehler. Die Sollgraphen bleiben innerhalb
der Standardbudgets: Precision und Recall weiterhin jeweils **1,00**.

## Impact und Änderungsumfang

GitNexus `impact` wurde vor Änderungen auf `structureObject`, `apply`, `undo`,
`validateCorrection`, `recordCorrection`, Object Store und Katalog angewendet,
ergänzt durch `grep -rn`. Der vorhandene Index kennt die jüngsten Projektakte-/
Lernschleifen-Symbole nicht und meldet dort `UNKNOWN`; daraus wird kein Nullrisiko
abgeleitet. Object-Store-Datei und `buildCatalog` meldeten LOW, jeweils keine
indexierten direkten Caller/Prozesse. Tatsächlich geändert werden additiv:

- Review: Graphaufruf aus `structureObject` entfernt; `settleLifecycle` fordert erst
  nach Aktenabschluss einen Auftrag an. Graphdienst trennt Snapshot/Berechnung/Commit;
  die SQLite-Helfer liefern begrenzte Sketches und Kandidaten. Keine Änderung an
  bestehenden SQLite-Schreibern oder am Uploadprotokoll.
- Object Store: ein zusätzliches geschütztes Mixin und vier Indizes im vorhandenen Lifecycle.
- Lernschleife: ein weiterer Zieltyp mit eigenem Graphconsumer; vorhandene Ziele
  behalten ihr Verhalten. Das Funktionsjournal ignoriert Graphkorrekturen gezielt.
- Katalogexport/Tag-Taxonomie: additive Metadaten und drei Leseoperationen.

Review-Impact zusätzlich auf `settleLifecycle`, `derive`, `deriveGraph`, `limits`,
`sketch`, `candidateRows` und neue Hilfsmethoden angewendet; ergänzend `grep -rn`.
Der Index meldet für diese Symbole weiterhin UNKNOWN. Die tatsächlichen direkten
Caller sind Akten-Ingest/-Recovery, geschütztes `run` und die Graphtests.
Manuell eingeschätzter Blast Radius: **MEDIUM** (Graphqualität und zusätzliche
Object-Store-Dokumente); keine Änderung an Gateway-Autorisierung, bestehenden
SQLite-Schreibern, Originalformaten oder öffentlichen Altverträgen.
Die GitNexus-Diffchecks der gestagten Review-Korrektur melden LOW bei 19 Dateien
und mangels aktueller Indexierung null zugeordneten Codesymbolen. Der Vergleich
gegen `origin/main` einschließlich des ursprünglichen #886-Commits meldet ebenfalls
LOW, zwei indexierte Codesymbole und keine betroffenen Prozesse. Die zusätzliche Zuordnung gleichnamiger README-Abschnitte ist ungenau:
Die genannten weiteren README-Dateien sind laut Git-Diff unverändert. Der vollständige
Datei-/Symbolumfang wurde deshalb ergänzend anhand des Git-Diffs geprüft; neue
Graphsymbole bleiben wegen des älteren Indexes nur eingeschränkt erfasst.

## Allowlist

Einziger Eintrag aus dem ursprünglichen Commit (Review: **keine Allowlist-Änderung**): **`endpoint`**, ausschließlich als technischer Begriff
für den vorhandenen Modulnamen `evidence-endpoint-catalog`. Kein Fachbegriff,
Kennungsformat oder Quellennamen wird der globalen Allowlist hinzugefügt.
Fachliche Metadaten bleiben im eigenen JSON-Katalog außerhalb des domänenfreien Kerns.

## Prüfprotokoll

Ergebnisse auf dem finalen Stand der Review-Korrektur vor dem neuen Commit.
Der vollständige Unit-Lauf umfasst 470 Testdateien: 463 Suites bestanden,
7 regulär übersprungen; 10.208 Tests bestanden und 54 übersprungen.
Coverage: Statements 84,04 %, Branches 70,23 %, Funktionen 88,27 %,
Zeilen 85,81 %; alle Gates erfüllt.

| Prüfung | Ergebnis |
| --- | --- |
| Graph-Regel-/Broker-/HTTP-/Ankertests | grün: 34 Tests in 4 Suites einschließlich Review-Korrektur |
| Betroffene Tests einschließlich Ingest/Strukturierung/HTTP | grün: 87 Tests in 8 Suites mit `NODE_OPTIONS=--experimental-vm-modules` |
| `npm run lint -- --quiet` | grün |
| `npm run test:unit:ci` | grün auf finalem Stand, einschließlich zusammengeführter Coverage-Gates |
| `npm run test:tdd-matrix` + `check:tdd-matrix-coverage` | grün: 82 Tests, 66/66 verpflichtende IDs, Hard Gate 100 %; 12 optionale Blackbox-IDs nicht aktiviert |
| `check:domain-free-core` | grün, 0 Findings |
| `check:function-model` | grün |
| `check:signal-catalog` | grün |
| `check:operation-capability-index` | grün |
| `check:llm` | grün |
| `audit:openapi` | grün, 0 Issues (480 bestehende Warnungen) |
| `git diff --check` | grün |

Generierung: `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
`generate:function-model`, `generate:signal-catalog` nach den Codeänderungen ausgeführt.
Live-Integrationstests benötigen Zugangsdaten und gehören nicht zum Offline-Nachweis.

## Anschlüsse für #887/#888

Das Manifest kann Knoten, Kanten, Herkunft und Bestandszähler lesen. Der Interpreter
kann über `resolve` belegte Kandidaten-/Schemaattribute und Joinspalten ermitteln,
muss aber Datensatzversion, aktuelle Aktenberechtigung und jede Tabelle/Spalte vor
einer read-only SQLite-Abfrage selbst prüfen. Es gibt keine neue Traversierungssprache,
keine Ausführung von Skills und kein vorweggenommenes Manifest. Kurze/numerische
Schlüssel und große Stichprobendomänen können konservativ unverbunden bleiben.
Weitere externe Quellen benötigen explizite, geeignete Katalogmetadaten und die
vorhandenen Leseberechtigungen, keine weiteren Fachregeln im Kern.
