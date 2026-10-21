# Validierung #889 – selbstlernende Projekt-Skills

Stand: 2026-10-21. Branch `feat/889-skills`. Ausschließlich Offline-Tests mit
schema-validierten LLM-Stubs; kein Live-LLM-Lauf, kein vollständiges `test:unit:ci`.

## Umsetzung und AC-Nachweis

| AC | Nachweis |
| --- | --- |
| AC-01 | Generierte Szenarien `project-skill-a` und `project-skill-b`: belegte Frage, semantisch ähnliche zweite Frage, Hintergrundprüfung, `active` ohne Freigabe, sichtbare Nutzung in Frage drei. |
| AC-02 | Echte CET-Skripte mit falscher Berechnung und fremder Tabelle bleiben `draft`. Unit-Negativtests für Schreiben, abgeleitete Speicherung, schreibende Operation, Endlosschleife, fehlenden unabhängigen Prüffall. |
| AC-03 | Reales `project.graph.changed.v1` im Harness nach Änderung der eigenen SQLite-Daten: Original wird `degraded`, fehlgeschlagener Neuentwurf bleibt `draft`, nachfolgende Antwort nutzt keinen Skill. Manifest-Versionsereignisse verwenden dieselbe Queue. |
| AC-04 | „passt nicht“ und Stilllegung gehen durch `shared-service-learning.apply`/`shared-service.correction.v1`; Journal zeigt Korrektur und Stilllegung. Idempotenz, konkurrierende Stilllegung und fehlendes Journal sind gesondert geprüft. |
| AC-05 | Strukturelle Zustandsfrage nennt Anlass, Stand und Journal aus dem bestehenden Register; kein Modell erzeugt diese Angaben. |
| AC-06 | Produktiver `runProjectSkill` mit ursprünglichem Principal, eigener `project.sqlite`, derselben Akten-Sperre für Fälle und Antwort, deaktiviertem Derived-Commit und vorhandener SQL-/Operationsbindung. Negative Tenant-/Akten-/Mitgliedschaftstests, fremde Entwürfe, manuelle Aktivierungssperre und Löschkaskade. |
| AC-07 | `check:domain-free-core` und `check:llm` mit den final erzeugten Artefakten grün. |

Der echte lokale Transport `createLocalTransport` verwendet `createLiveHarness`,
projektgebundenen Upload/Ingest, Manifest, Dataset-Executor, Skill-Register, Journal
und Korrekturschleife. Der Stub liefert Quelltext mit `meta`, `tests`, `default`
und parametrisiertem `cet.sql`; weder Interpreter noch SQLite-Ausführung werden
im Replay ersetzt. Jede Szenarioantwort wird unverändert mit `checkTurn` bewertet.
Die neutralen Akten haben unterschiedliche Größen/Einheiten (Leistung und Bestand).

Die zweite Szenariofrage markiert einen expliziten Hintergrund-Synchronisationspunkt
im Praxis-Transport (`waitForProjectSkills`); im Produkt bleibt die Queue asynchron.
Test-Suites mit geordneten Modellantworten halten die Hintergrundverzögerung bei
`2 ** 31 - 1` und lösen Arbeit explizit aus. Neue Antwortschemas enthalten weder
`const`/`$ref`/`patternProperties`/`if-then` noch `additionalProperties`/`uniqueItems`.

## Prüfkette und Grenzen

Originalwerte kommen aus dem erfolgreichen, ausgeführten Dataset-Plan, nicht aus
Modellprosa. Ein Hilfs-COUNT, der die tatsächlich gezeigten Zahlen nicht trägt,
begründet keinen Lernanlass. Nach einer Ergebniskorrektur reicht derselbe unveränderte
belegte Antwortpfad auch mit umgeschriebenem Skript nicht zur Aktivierung. Der Host vergleicht diese mit absoluter Toleranz `1e-8`, prüft identische
Replay-Hashes/Ergebnisse über zwei Läufe, sämtliche Skripttests und einen selbst
abgeleiteten Manifestfall. Zusätzliche Zeitintervalle sind nicht leer; ein Parameter,
der keine andere Leseabfrage erreicht, genügt nicht. Bei numerischen Auswertungen
muss auch der Zusatzfall numerische Evidenz liefern. Das dabei beobachtete Ergebnis
wird für spätere Neuprüfungen festgehalten.

Keine Akten-/Tenantbindung wird vom Modell übernommen. Der Lernpfad akzeptiert
nur begrenzte, lückenfrei belegte strukturierte Tabellenantworten. Ohne solche
Originalantwort oder ohne geeigneten zusätzlichen Manifestfall bleibt die
Aktivierung aus. Eine Prüfung der gespeicherten Fälle ist kein allgemeiner
Korrektheitsbeweis für beliebige Eingaben.

Schutzpfade aus #954 (eigene Gesprächsuploads), #874, Rollenangaben, Blattwahl und
Einheiten bleiben vor beziehungsweise innerhalb ihres bestehenden regulären
Ablaufs. Das Manifest bleibt der einzige Selektor. Ein aktiver Skill erhält nur
eine schema-geprüfte Parameterbindung; keine globale neue Skill-Suche.

Übertragungen autorisieren beide Akten, fragen eine eigene Zielantwort ab und
entwerfen/prüfen ein neues Programm. Der Replay prüft unterschiedliche Skill-IDs,
Programme, Originalergebnisse und eine eigene erfolgreiche Zielprüfung.

## Blast Radius

GitNexus-MCP ist erreichbar, sein Index kennt die aktuellen Manifest-/Skill-/
Workbench-Symbole jedoch nicht (`UNKNOWN`, „Target not found“). Impact-Aufrufe
wurden durch `grep -rn`-Referenzen ergänzt. Der vorhandene Capability-Katalog
wurde mit `LOW` (0 direkte Graph-Aufrufer/Prozesse) gemeldet.

Die manuell bewertete Gesamtrisiko-Stufe ist **HIGH**: automatischer Programm-
Lebenszyklus und zentrale Antwort-/Korrekturpfade. Direkte Anbindungspunkte:

- `readProjectEvidence`: vorhandener Projekt-Quellenadapter; unveränderter Selektor.
- `projectManifestTurn`: Chat, Inhaltsturn und Ergänzung vorhandener Datensatzantworten.
- `safePlaybook`/Store: vorhandene Skill-Ansichten; allgemeine Playbookpfade
  übernehmen keine Projekt-Skills, manuelle Aktionen dürfen sie nicht aktivieren.
- `validateCorrection`: bestehende Lernschleife und Journal-/Projektverbraucher.
- `runProjectSkill`: neuer rein interner Host-Callback für gemeinsame lesende
  Prüfsitzung; bestehende direkte Aufrufer und Interpretertests bleiben erhalten.
- `saveTurn`: 17 Textreferenzen; ergänzt ausschließlich das neue Skill-Korrekturfeld,
  damit reguläre Antworten, Rollenänderungen und Upload-Kontexte keinen alten Check korrigieren.

Neue Logik liegt in `src/project-skill-*.js` und `src/workbench-project-skills.js`.
Es gibt keine neue Datenbank und keine neue öffentliche REST-Route. Drei begründete
Domänenfrei-Ausnahmen betreffen technische Bezeichner/Containerlabels: `skill`,
`project_skill_learning`, `projekt`; keine fachlichen Begriffe wurden freigestellt.

## Checks

- Neue Tests: 23 Unit-Tests und 9 vollständige Harness-Replays, einschließlich
  Lebenszyklus, Übertragung, aktueller Sichtbarkeit und Löschung.
- Große gezielte Regression: 40 Suites in fünf seriellen Gruppen, 764 Tests
  grün. Zusätzlich sind die danach ergänzten Kontext-/Stilllegungsfälle separat grün.
  Ein zunächst gefundener Schemafehler bei fremden `skillRefs` ist behoben.
- Weitere gezielte Gruppe: 6 Suites / 147 Tests grün (Workbench-Register,
  Shared-Service-Lernen/-Persistenz, Journal-Persistenz und neue Skills).
  Die finale Workbench-/Skill-Gruppe ist mit 91 Tests grün; die danach präzisierte
  Originalantwort-/Korrekturprüfung zusätzlich mit 32 Feature-Tests.
- `test:shared-service:ci`: 86 Tests grün; 27,4 s unter dem 59-s-Gate.
- `test:e2e:shared-service`: grün; 22,5 s, reine Stub-Fassade.
- Sonar-Selbstcheck: S1751, S5850, S2871 und maximale kognitive Komplexität 15
  für die neuen Laufzeitmodule geprüft.
- TDD-Matrix: 82 Tests grün, 4 optionale Blackbox-Tests übersprungen; Pflicht-Gate
  66/66 = 100 %. Die 12 optionalen MT-IDs bleiben ausdrücklich nicht ausgeführt.
- Lint: 0 Fehler, 12 bereits vorhandene Warnungen; keine neuen ungenutzten Variablen.
- `check:practice-fixtures`, `check:domain-free-core`, `check:domain-free-equivalence`,
  `check:tdd-matrix-coverage`, `check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm`, `audit:openapi` und
  `git diff --check` grün. OpenAPI: 0 Issues, vorhandene Warnungen bleiben sichtbar.
- `detect_changes(staged)` meldet 48 erwartete Dateien, 1 bekannten Symboltreffer
  und keine indizierten Folgeprozesse. Der zusätzliche Vergleich gegen `main`
  wurde nach ausbleibender Rückgabe abgebrochen. Wegen des veralteten Index ist dies kein
  belastbarer LOW-Nachweis; die manuelle HIGH-Bewertung bleibt maßgeblich.

## Modellaufwand

Zusätzlich zum bisherigen Antwortpfad: ein Embedding-Batch für wiederholte Fragen
und ein Entwurf im Hintergrund; bei aktiver Nutzung ein synchroner Parameteraufruf.
Die Skill-Antwort selbst benötigt keine Prosa-Generierung und keinen neuen Query-Plan.
Neuprüfung, Zustandsfrage und Stilllegung benötigen keine eigene Modellgenerierung.
Eine Übertragung ergänzt im Hintergrund die Zielfrage und deren regulären Read.
Details, Grenzen und Konfiguration: [PROJECT_SKILLS.md](../PROJECT_SKILLS.md).

Live-Qualität der Generierung und vollständiger Unit-CI-Lauf bleiben der aufrufenden
Session vorbehalten. Es wurde nicht gepusht.
