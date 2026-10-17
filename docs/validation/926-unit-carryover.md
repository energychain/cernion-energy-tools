# Validierung #926 Teil 2: Einheiten und Variantenvergleich

Stand: 2026-10-17; Branch `fix/926-unit-carryover`, auf Teil 1 / PR #934.
Ausgangsbefund: `practice-evaluation-926-live-3.md`, Szenario `table-quality`.
Dieser Auftrag verwendet ausschließlich LLM-Stubs. Der vollständige Unit-CI-Lauf
und der erneute Live-Praxislauf bleiben bei der aufrufenden Session.

## Ursachen und Korrekturen

- `datasetCorrection` verwarf Einheiten bei mehreren Zielen, bevor der Service
  eine Auswahlrückfrage erzeugen konnte. Eine ausdrücklich gemeinsame Angabe für
  mehrere Blätter war im Klassifikationsschema nicht darstellbar. Außerdem wurde
  eine normalisierte Einheit abgewiesen, wenn nur ihr ausgeschriebener Wortlaut
  in der Nutzernachricht stand. Ohne Korrekturergebnis konnte der Workbench-Turn
  in die freie Antwortgenerierung fallen; eine dort formulierte Bestätigung oder
  Tenant-Memory-Aussage schreibt keine Datensatzsemantik.
- Das Klassifikationsschema erhält einen wörtlichen Einheitenbeleg und einen
  belegten Mehrblattbezug. Eine ausdrückliche Angabe kann auch ohne offene Frage
  genau einer numerischen, nicht sensitiven Wertspalte gelten. Bei offenen Fragen
  bleibt die Bindung an Gespräch und Feld erhalten. Ohne eindeutiges Einzelziel
  oder ausdrücklichen Mehrblattbezug fragt der Service nach dem Datensatz.
- Ein gemeinsamer Helfer verwendet den bisherigen Semantik- und Auditpfad für
  Einzel- und Mehrblattkorrekturen. Er speichert `semantic.units`, schließt
  beantwortete `unitQuestion`-Einträge und bestätigt ausschließlich tatsächliche
  Änderungen. Die normale Folgeabfrage lädt den aktuellen Katalogeintrag;
  `executeDatasetQuery` verwendet dessen Einheiten über `datasetUnits`.
  `workbench-content-turn` und `dataset-query` benötigen dafür keine Sonderregel.
- `compareDatasetResults` gab `metric.as` als Beschriftung aus. Ein Alias mit
  Unterstrichen trifft die unveränderte, auch kleingeschrieben wirksame
  `internal-codes`-Prüfung. Vollständige Turn-Tests reproduzieren diesen Pfad mit
  `sum_amount_…` und `row_count_…`; beide enthalten zusätzlich die interne ID.
  Der historische Alias ist im auf 300 Zeichen gekürzten Live-Auszug nicht
  enthalten, daher wird kein konkreter damaliger Token behauptet. Die Ausgabe
  verwendet jetzt Aggregatfunktion und Quellspaltennamen. Ergebniszugriffe
  verbinden je Blatt unterschiedliche Aliase über Funktion und Feld; Einheiten
  stammen auch im Vergleich aus dem gemeinsamen Einheitenhelfer.

## Impact und Grenzen

GitNexus `impact(direction="upstream")` wurde vor Änderungen für
`datasetCorrection`, `openQuestion`, `datasetTurn`, `compareDatasetResults` und
den berührten Test-Stub ausgeführt. Alle Symbole fehlen im vorhandenen Index
(`Target not found`, `UNKNOWN`); auch `context` und die Prozesssuche liefern
keinen belastbaren Nachweis für diese Pfade. Die ergänzende Referenzprüfung
zeigt Dataset-Service und Workbench sowie Projektmanifest-Vergleiche als direkte
Verbraucher. Manuelle Risikoeinstufung **MEDIUM** wegen persistierter Semantik und
berechneter Vergleichsantworten. Keine Änderung an Tenant-/Gesprächsscope,
Rechten, globalen oder Praxis-Allowlists; keine neue Phrasenliste oder Variable.

Die neuen vollständigen Workbench-Turns prüfen kurze Antworten, ausgeschriebenen
Einheitenwortlaut bei normalisiertem Modellwert, ausdrückliche Angaben ohne offene
Rückfrage, beide Blätter, bestehende Blattwahl, fehlende tatsächliche Änderung und
gruppierte/gefilterte Vergleiche mit unterschiedlichen internen Aliasnamen.
Sichtbare Antworten werden gegen die unveränderte Praxisprüfung geprüft.

## Checks

- Betroffene Abschlussserie: **16 Suites/252 Tests grün**, 161,19 s, mit
  `NODE_OPTIONS=--experimental-vm-modules` einschließlich der PDF-relevanten Tests.
  Enthalten sind sämtliche `dataset*.test.js`, Dateikanal, Workbench #838,
  Tenant-Memory-HTTP, Projektstruktur, Projektmanifest-Evidenz und Praxisprüfung.
  Im ersten Lauf waren 15 Suites direkt grün; der Turn-Stub wurde anschließend
  für jeden Test vollständig zurückgesetzt. Der isolierte Turn-Lauf mit 16 Tests
  und der gemeinsame Abschlusslauf sind danach grün.
- `lint`: grün, 0 Fehler und 12 Warnungen in unveränderten Dateien. `build`: grün
  (projektgemäß ohne Build-Schritt).
- Zusätzliche ESLint-Prüfung für alle vier berührten JavaScript-Dateien:
  `no-unreachable-loop` und SonarJS `anchor-precedence` (S5850), 0 Befunde.
- `test:shared-service:ci`: grün, 3 Suites/86 Tests, 21,78 s.
- `test:e2e:shared-service`: grün, 17,27 s, ausschließlich Stub-Fassade.
- `test:tdd-matrix`: grün, 3 Suites/82 Tests; optionale Blackbox-Suite mit
  4 Tests übersprungen. `check:tdd-matrix-coverage`: grün, 66/66 erforderliche
  IDs, 100 %. Die Prüfung wurde nach Erzeugen des im frischen Worktree zunächst
  fehlenden Ergebnisartefakts wiederholt.
- `check:practice-fixtures`, `check:domain-free-core`: grün, keine Befunde.
- `check:domain-free-equivalence`: grün, 155 Dateien einschließlich
  Kontaminationsfixture, 26.018 Treffer, 76,39 s.
- `check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm`: grün, Artefakte synchron.
- `audit:openapi`: grün, 0 Issues/480 Warnungen.
- `export:openapi`, `generate:operation-capability-index`,
  `generate:function-model`, `generate:signal-catalog`,
  `generate:practice-fixtures`, `generate:llm` wurden ausgeführt. Artefakte ohne
  Inhaltsänderung erzeugen keinen Diff.
- `git diff --check`: grün. Manuelle Prüfung gegen `origin/main` umfasst die
  erwarteten Implementierungs-, Test-, Dokumentations- und Artefaktänderungen.

Der GitNexus-Vergleich `detect_changes(scope="compare", base_ref="main",
worktree=...)` lieferte keine Antwort und wurde beendet. Auch der Aufruf mit
`scope="staged"` für die zwölf erwarteten Dateien blieb ohne Antwort und wurde
beendet. Beide Analysen wurden angefordert; ein belastbares Graph-Ergebnis wird
nicht behauptet. Die manuelle Risikoeinstufung bleibt MEDIUM.

Der konfigurierte Git-Hook-Pfad liegt außerhalb des erlaubten Worktrees. Der
lokale Commit verwendet deshalb `-c core.hooksPath=/dev/null`; die oben
dokumentierten Prüfungen wurden im Worktree ausgeführt. Kein Push.
