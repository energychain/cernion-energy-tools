# Validierung #926: Rückfragezustand nach Live-Praxislauf 4

Stand: 2026-10-17; neuer Commit auf `fix/926-unit-carryover`, Folgeänderung zu
`f8ddf65e`. Ausgangsbefund: `practice-evaluation-926-live-4.md`, unverändert
aufgenommen (SHA-256 `feb8d1383a762e09be2fa614e0a8ae0253806e0bf5be3cb85a052d6800b153bf`).
Der dort dokumentierte Live-Gate bleibt ein roter Ausgangsbefund. Dieser Auftrag
verwendet ausschließlich LLM-Stubs; kein Live-LLM-Lauf, keine `.env`, kein
`test:unit:ci`, kein Push. Vollständige Unit-CI und neuer Live-Nachweis bleiben bei
der aufrufenden Session.

## Ursachen und Zustandsmodell

Die bisherige Blattantwort umging die Klassifikation nur, wenn vorher ausdrücklich
eine Auswahl gestellt worden war. Nach einer gemeinsamen Einheitenkorrektur fehlte
diese Voraussetzung; die Auswahl konnte wieder als Metadatenkorrektur behandelt
werden. Eine bereits gespeicherte Einheit wurde zudem als fehlende Änderung
zurückgewiesen. Unbeantwortete Einheitenfragen wurden weiterhin vom allgemeinen
Korrekturmodell abhängig gemacht. Diese getrennten Wege werden durch einen
gemeinsamen Rückfragepfad ergänzt, der vor der allgemeinen Erkennung arbeitet.

`src/dataset-clarification.js` speichert im bestehenden geschützten Tenant-Katalog:

- Art (`unit`/`sheet`), Status (`open`/`answered`), Gespräch und Zeitstempel;
- versionierte Ziel-Datensätze und ihre betroffenen Wertspalten;
- erlaubte Datei-/Blatt-/Versionsantworten, Feldnamen, Einheitenbezeichnungen aus
  `Intl` sowie die Syntax `Spaltenname = Einheit` für eigene Einheiten;
- einen bei mehrdeutiger Einheitenantwort erhaltenen Vorschlag und die nachfolgend
  bestätigte Antwort.

Die Workbench ruft den Rückfragepfad vor Projekt-, Memory- und allgemeiner
Korrektur-/Semantikerkennung auf. Eine passende Antwort braucht keinen
Modellaufruf. Datensatz-Turn und direkte Datensatzabfragen verwenden denselben
gespeicherten Zustand. Einheitenfragen bleiben je Datensatz gebunden; Auswahlfragen
enthalten die zulässigen Kandidaten. Zwischenfragen lassen den Zustand offen.
Bei mehreren Wertspalten bleibt die Frage offen, bis alle angefragten Felder eine
Einheit haben. Eine eindeutige Blattantwort übernimmt gegebenenfalls den vorherigen
Einheitenvorschlag. Die bestätigte Blattwahl ersetzt eine frühere Auswahl im selben
Gespräch auch ohne nachgewiesene Variantenüberdeckung.

Die Speicherung verwendet den vorhandenen Semantik-/Auditpfad. Wiederholte gültige
Bestätigungen nennen den gespeicherten Wert und erzeugen keinen zusätzlichen
Änderungsaudit. `semantic.unitQuestion` bleibt als bisheriger Vertrag erhalten;
der strukturierte Zustand liegt in `clarifications`. Eine ausdrückliche Blattwahl
ist auch nach Abschluss der Einheitenfrage möglich. Einheiten und Auswahl wirken
über den vorhandenen Katalog-/Abfragepfad in Folgeabfragen. Die bestehenden
Verträge für „korrigier das“ und das zuletzt genannte Objekt bleiben erhalten.

## Situationsschema und Vergleich

`SITUATION_SCHEMA` verlangt `requestedAction` mit `description`, `externalEffect`
und `draftRequested`. Der alte Test hatte stattdessen eine ungültige Situation
ohne dieses Objekt und mit einem ungültigen Timeline-Eintrag gespeichert. Der
Stub und der gespeicherte Testzustand verwenden jetzt eine gemeinsame Fixture,
die mit Ajv gegen das exportierte Produktschema validiert wird. Eine Lockerung
des Produktvertrags oder ein Optional-Chaining-Patch in der Antwortdekoration
ist dafür nicht erforderlich.

Die leere Gruppe im Live-Bericht stammt aus der echten Fixture-Zeile `R004` mit
Wert 3, nicht aus einer wieder aufgenommenen Kontrollsumme. Diese Zeile bleibt in
den Daten. Antworten beschriften die Gruppe als „ohne Gruppenangabe“; die
strukturierten Abfrageergebnisse behalten ihren ursprünglichen Null-Schlüssel.
Varianten führen denselben einmal geplanten Filter-/Aggregationsplan mit je Blatt
gebundener Quelle aus. Dadurch entstehen keine Vergleichspaare aus unabhängig
gewählten Gruppierungen. Tests erzwingen einen möglichen zweiten, abweichenden
Plan und prüfen, dass nur ein Plan erstellt wird: vier Datenzeilen je Blatt,
drei ausgeschlossene Kontrollzeilen, vollständige Summen 40/44 und Differenz 4.
Der bestehende Schutz vor internen Plan-Aliasnamen bleibt erhalten.

## Impact und Arbeitsgrenze

GitNexus-Impact wurde vor Änderungen für die berührten vorhandenen Symbole
(`datasetTurn`, Query-Handler, Workbench-Chat, `answerUnitQuestion`,
`datasetCorrection`, `correctDatasetSemantics`, `selectDatasetSheet`,
`readTurnDataset`, `queryDatasetVariants`, `compareDatasetResults`,
`executeDatasetQuery` und Test-Stub) angefordert. Auch die neuen Helfer wurden
abgefragt. Der vorhandene Index kennt die relevanten Symbole nicht (`UNKNOWN`);
die Prozesssuche liefert keinen belastbaren Nachweis für diese Pfade.
Manuell **MEDIUM**: direkte Verbraucher sind Dataset-Service, Workbench-Turn,
Projektmanifest-Vergleich und HTTP-Chat. Kein Eingriff in Tenant-/Projekt-Scope,
Rollen, globale oder Praxis-Allowlists und keine neue Umgebungsvariable.
Die Domänenprüfung umfasst den neuen Rückfragehelfer über `src/dataset-*.js` und
den Antworthelfer über einen zusätzlichen expliziten Core-Pfad.

Der konfigurierte Git-Hook-Pfad liegt außerhalb des erlaubten Worktrees. Der
lokale Commit verwendet deshalb `-c core.hooksPath=/dev/null`; alle unten genannten
Prüfungen werden lokal ausgeführt. Der schon bei Beginn untracked vorhandene
Python-Testcache bleibt unverändert außerhalb des Commits.

## Prüfungen

- Breite betroffene Serie: **17 Suites/704 Tests grün**, 164,05 s, mit
  `NODE_OPTIONS=--experimental-vm-modules`, einschließlich Dataset-, Dateikanal-,
  Workbench-838-, Tenant-Memory-HTTP-, Projekt-, Praxis- und Understanding-Tests.
- Ergänzende Abschlussserie: **4 Suites/52 Tests grün**, 21,10 s; abschließender
  Turn-Einzellauf nach der letzten Zustandsänderung: **27 Tests grün**, 14,00 s.
  Enthalten sind vollständige Live-Turn-Sequenzen trotz abweichender `none`-,
  `question`- und `metadata`-Klassifikation, Versionsantwort nach Zwischenfrage,
  Retrieval-Verlust, wiederholte Bestätigung, eigene Einheit, teilweise
  beantwortete Mehrspaltenfrage, Sonderzeichen in Feldnamen, getrennte Gespräche
  und Ablösung einer früheren Auswahl ohne Variantenüberdeckung.
- `lint`: grün, 0 Fehler/12 bestehende Warnungen. Zusätzliche Prüfung aller zehn
  berührten JavaScript-Dateien mit `no-unreachable-loop` und SonarJS
  `anchor-precedence` (S5850): grün.
- `test:shared-service:ci`: grün, 3 Suites/86 Tests, 22,70 s.
- `test:e2e:shared-service`: grün, 15,41 s, ausschließlich Stub-Fassade.
- `test:tdd-matrix`: grün, 3 Suites/82 Tests; optionale Blackbox-Suite mit vier
  Tests übersprungen. `check:tdd-matrix-coverage`: grün, 66/66 erforderliche IDs,
  100 %; zwölf Blackbox-IDs bleiben explizit optional.
- `check:practice-fixtures`, `check:domain-free-core`, `check:quality-gate`,
  `check:capability-keywords`, `check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm` und `build`: grün.
- `audit:openapi`: grün, 0 Issues/480 Warnungen.
- `audit:security`: Gate grün, keine kritischen Befunde; bestehende nichtkritische
  Advisories einschließlich hoher Befunde bleiben ausgewiesen. Keine Änderung
  der Abhängigkeiten oder Audit-Ausnahmen.
- `export:openapi`, `generate:operation-capability-index`,
  `generate:function-model`, `generate:signal-catalog`,
  `generate:practice-fixtures`, `generate:llm`: ausgeführt; Artefakte synchron.
- `check:domain-free-equivalence`: grün, 157 Dateien einschließlich
  Kontaminationsfixture, 26.324 Treffer, 77,79 s.
- `git diff --check` und `git diff --cached --check`: grün. Der gestagte Diff
  enthält die erwarteten 20 Dateien; manuelle Prüfung der Änderung gegenüber
  `f8ddf65e` und des kumulierten Stands gegenüber `origin/main` durchgeführt.

`detect_changes(scope="compare", base_ref="main", worktree=...)` und
`detect_changes(scope="staged", worktree=...)` wurden vor dem Commit angefordert.
Beide Aufrufe lieferten innerhalb von jeweils 15 Sekunden kein Ergebnis. Ein
Graphnachweis wird nicht behauptet; die manuelle Einstufung bleibt MEDIUM.
