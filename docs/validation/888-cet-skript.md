# Validierung #888 – CET-Skript v1

Stand: 2026-10-20. Branch `feat/888-cet-skript`, isolierter Worktree.
Grundlage ist die am 2026-10-16 abgestimmte Spezifikation, einschließlich Regex-Verbot
und unveränderter Standardwerte der elf Ausführungsbudgets.

## Umfang

Neue Module in `src/cet-script/`: Parser/Schema-/Scope-Prüfung, AST-Interpreter,
Umgebungen und Operatoren, Skriptwerte, eingebaute Funktionen, Budgets/Fehler,
CET-API, Projekt-/Graph-/Operationsadapter sowie SQL-Bindung, Lexer,
Authorizer, Kontrollfluss-/Checkpointprüfung, Volumenprüfung und Worker.

`acorn` ist durch `npm install --save-exact acorn@8.17.0 --ignore-scripts --no-audit --no-fund`
als direkte Abhängigkeit aufgenommen; das Lockfile wurde durch npm aktualisiert.
Die Registry-Nutzung war darauf begrenzt, der npm-Cache lag in `/tmp`.
Keine öffentliche REST-Route und keine Änderungen bestehender Service-Symbole.

## Impact

GitNexus war erreichbar, kennt die neuen Module/Symbole jedoch nicht.
Die Impact-Abfragen für Einstieg, Interpreter und neue Prüffunktionen lieferten
`Target not found`/`UNKNOWN`; dies ist kein LOW-Risk-Nachweis.
Die ergänzende `grep -rn`-Suche zeigte ausschließlich die neuen internen Aufrufketten.
Ein `detect_changes(scope: all)` für den absoluten Worktree wurde ebenfalls ausgeführt;
der MCP-Server meldet diesen Worktree als nicht registriert. Ein Diff anderer Worktrees
wurde wegen der Arbeitsgrenze nicht angefordert. Der vollständige lokale Git-Diff und
seine Dateiliste wurden ergänzend gegen den beabsichtigten Umfang geprüft.
Bestehende Bibliotheken werden lesend wiederverwendet: Projekt-Dateipfade,
Datensatz-Bezeichnerquotierung, Manifest-Routingmetadaten, Dokumentabschnitte,
Principal, Zeitnormalisierung, Einheiten und Evidenzprojektion.
Der funktionale Blast Radius liegt im neuen internen Ausführungspfad und dessen
Core-Prüfkonfiguration; das Sicherheitsrisiko bleibt **HIGH**.

## Abnahme

| Kriterium         | Status / Nachweis                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01             | Grün: Fixture über Tabellen/SQL, Graph, Passagen, Operation, Transformationen, gemischte Ergebnisse, Lücke, Zitat, Log und atomare Ableitung.                                                                                                                                                           |
| AC-02             | Grün: getrennte echte SQLite-Dateien für zwei Akten und zwei Tenants; bekannte fremde physische Tabellennamen, Aliase, Knoten und Passagen abgewiesen. Schreib-/Verwaltungs-SQL, virtuelle Tabellen, Schema und schreibende Operationen abgewiesen. Auch indirekte Operationsreferenzen werden geprüft. |
| AC-03             | Grün: präparierte Parameter einschließlich Quotes, Semikolon, Kommentar- und ATTACH-Text bleiben gebundene Daten. Bezeichner kommen aus privaten Handles und vorhandenen Metadaten.                                                                                                                     |
| AC-04             | Grün: jedes Standardbudget sowie Source-, AST-, Werte-, Sammlungs- und Speichergrenzen; keine Staging-Persistierung bei späterem Fehler; Transaktionsrollback bei Budgetfehler im Commit. Native SQL-Arbeit am direkten Adapter fristgerecht beendet.                                                   |
| AC-05             | Grün: gleicher SQL-Lauf zweimal mit identischem Ergebnis, Herkunft, Ablaufprotokoll und Replay-Hash; Version, Eingaben und Bezugszeit verändern den Hash. Mutierte Skripteingaben ersetzen die ursprünglichen Hash-Eingaben nicht. Parallele Abschlussreihenfolge verändert das Protokoll nicht.        |
| AC-06             | Grün: Fixture-Index steuert statische und dynamische Operationsauswahl; jede der vier Bedingungen und fehlende Effektangaben negativ geprüft. Produktiver Index wird pro Lauf frisch geladen.                                                                                                           |
| AC-07             | Grün: neue Module vollständig in `check:domain-free-core` aufgenommen; keine Befunde. Einziger neuer Allowlist-Begriff ist das technische SQL-Schlüsselwort `ALTER`, das der Scanner sonst als Fachwort behandelt.                                                                                      |
| §9 Konformität    | Grün: positive Fälle je Kategorie aus §3.1/3.2 und negative Fälle je Verbot aus §3.3; zusätzliche Export-/Schema-/Scope- und Prüffalldatenvalidierung.                                                                                                                                                  |
| §9 Escape-Klassen | Grün: berechnete Prototypschlüssel, Funktions-/Methodenkonstruktoren, Getter in Übergabedaten, Symbolwerte, Konvertierungshooks, tiefe Rekursion, synchrone/asynchrone Endlosschleifen, große Strings/Arrays, gefrorene Handles, JSON-Reviver, Iteratorfallen und Object.assign auf CET.                |
| §9 Gleichheit     | Grün: domänenfrei umbenanntes Monats-/Gruppenbeispiel gegen `dataset-query` auf echter akteneigener SQLite-Datei; zusätzlich native Aggregationssemantik einschließlich empfindlicher Gleitkommasummen.                                                                                                 |

Die neue Suite enthält **208 Tests**. Zusätzlich liefen **44 bestehende Tests** aus
`project-file.service`, `project-graph.service`, `project-manifest.service` und
`dataset-quality-project` erfolgreich. Die betroffenen bestehenden LLM-Pfade sind dabei
explizit gemockt. Es gab keine Live-LLM-Ausführung.

## Security-Selbstreview

### Keine Ausführung durch den Host

Acorn parst ECMAScript 2022 mit `sourceType: module`. Eine Knotentyp-/Operator-Whitelist,
lexikalische Auflösung und der Export-/Metadatenvertrag gehen der Auswertung voraus.
Die AST-Auswertung ist in Methoden je Ausdruckstyp und überschaubare Kontrollflusshelfer
aufgeteilt. Auch die Schema-Teilmenge wird ohne dynamische Codegenerierung interpretiert.
Eine ergänzende AST-Suche fand keine dynamischen Ausführungsaufrufe,
VM- oder Kindprozessimporte im Interpreter-Verzeichnis.

Hostfunktionen liegen nur in privaten WeakMaps hinter eingefrorenen Markern.
Eigenschaftszugriffe erfolgen über eigene Daten-Eigenschaften beziehungsweise explizite
Primitiv-/Arraymethoden. Es gibt keinen Weg zu Host-Prototypen, Funktionskonstruktoren,
Dateisystem-, Netzwerk- oder Prozessobjekten. Eingabedaten werden ohne Getter-Aufruf
kopiert; unzulässige Prototypen, Symbole, Funktionen und Zyklen werden abgewiesen.
JSON-Callbacks und fremde Iteratoren werden nicht aufgerufen. Ein struktureller
Vorabscan begrenzt JSON-Tiefe und Allokationen bereits vor dem nativen Parser. Sicherheitsfehler können
auch mit verschachteltem `try`/`finally` nicht verschluckt werden.

### SQL-Authorizer und Unterbrechbarkeit

`projectDirectory` bestimmt ausschließlich die eigene `project.sqlite`. Die Verbindung
ist read-only mit `fileMustExist`, `query_only` und deaktiviertem `trusted_schema`.
`statement.readonly` und `reader` müssen passen. Die installierte Treiberversion besitzt
keine Authorizer-/Progress-Handler-API; deshalb wird das vollständige kompilierte
`EXPLAIN`-Programm geprüft. Jeder physische Lesezugriff muss zu einer registrierten
Datensatztabelle oder ihrem Index in `main` gehören. Indexspalten werden ebenfalls gegen
Sperrvermerke geprüft. Schema-/interne-/virtuelle Tabellen, persistente Schreibcursor,
unbekannte Instruktionen und nicht freigegebene Funktionen scheitern geschlossen.

Checkpoint-Argumente erhalten die nativen SQLite-Aggregate und deren Rechenverhalten.
Projektion, Filter, Gruppierung und Aggregatargumente werden mit internen Checkpoints
versehen. Der expandierte Kontrollfluss einschließlich tatsächlicher Unterprogramm-
Rücksprünge muss nach Entfernen aller Checkpoint-Kanten azyklisch sein.
Die verwendete Branch-Liste wurde mit den Sprung-Opcode-Definitionen der installierten
SQLite-Quelle verglichen. Unbekannte Engine-Versionen werden vor Skript-SQL abgewiesen;
freigegeben ist SQLite **3.53.4** aus `better-sqlite3` **13.0.3** im Lockfile.

Ein wichtiger Regressionstest prüft den **direkten SQL-Adapter**: eine aufwendige native
Aggregation kehrt innerhalb von zwei Sekunden bei 150 ms Budget mit Budgetfehler zurück.
Ein bloßer Promise-Timeout wäre kein ausreichender Nachweis. Der Worker darf bei laufendem
nativem SQL nicht gewaltsam beendet werden, da dies Callback-Fehler unterdrücken kann;
er wird nach kooperativem Abbruch vollständig abgewickelt.

Die Volumenprüfung begrenzt vor Ausführung geschätzte Tabellenprodukte und
Zwischenspeicher; zusätzliche Schranken verhindern große gebundene Parameter und
Skriptallokationen. SQL-Ausführungen sind innerhalb eines Laufs serialisiert.
Konservative Ablehnung komplexer oder nicht beweisbarer Pläne ist beabsichtigt.

### Operationsauswahl und Principal

Es gibt keine im Code gepflegte Operationsliste. Erforderlich sind explizite leere Arrays
für `sideEffects` und `writesTo`, Konsequenz `none` und `agentable !== false`.
Dynamische IDs werden bei jedem Aufruf geprüft. Die Adapter erhalten nur ursprüngliche
Authentifizierungsmetadaten, Scopes, Rollen und Domänengrenzen; keine internen
Graph-/Ingest-Capabilities. Tenant und Akte werden erzwungen. Scopes, Aktionsrollen,
Domänen und bekannte Containerreferenzen werden zusätzlich geprüft. Eigene Graph- und
Dokumentdaten werden aus der Hostbindung geladen, niemals anhand fremder Skriptpfade.

### Budgets, Herkunft und Schreiben

Alle Standardwerte sind unverändert. Zeitmessung nutzt eine monotone Hostuhr,
fachliche Zeit ausschließlich den festen Anfragezeitpunkt. Ein gemeinsames Budget beginnt nach Erhalt der Akten-Sperre bereits beim
Snapshot-Laden und begrenzt auch die Iteration gespeicherter Ableitungen.
Budgets gelten über `await` hinweg. Alle gestarteten Aufrufe werden vor dem Commit erfolgreich abgewartet, auch
ignorierte und erst später von eigenen asynchronen Funktionen gestartete Aufrufe.
Die Herkunft ist konservativ für den gesamten Lauf und wird jeder Ergebniszahl per
JSON-Pointer zugeordnet; `traceRef` verweist auf das einmal gespeicherte Protokoll.
Auch deterministische CET-Helfer und Ergebnisfunktionen werden mit begrenzten
Parametersummaries protokolliert. Rohdaten und Herkunft zählen gegen Größenlimits.

Nur `derived.put` kann Skriptwerte dauerhaft speichern. Es bleibt zunächst im Staging;
der Host schreibt Knoten und Kanten in einer SQLite-Transaktion in derselben Akte.
Ein zweiter Budgetcheck innerhalb der Transaktion erzwingt Rollback vor dem Commit.
Die öffentliche Graphprojektion #886 wird durch diese interne Speicherung nicht verändert;
spätere CET-Läufe erhalten die Erweiterung über den gebundenen Graphsnapshot.
Tenant-IDs werden nicht gehasht. Der Replay-Hash bindet Quelltext, ursprüngliche Eingaben
mit Bezugszeit, Datenversion und Operationsversionen.

## Checks

- `npm run lint`: Exit 0; zwölf bestehende Warnungen in unveränderten Dateien.
  Neue Module und Tests haben keine Lint-Befunde.
- Neue gezielte Jest-Suite sowie vier bestehende Projektsuites: grün.
- `npm run test:shared-service:ci`: 86 Tests in drei Suites, grün, unter 60 Sekunden.
- `check:domain-free-core`, `check:domain-free-equivalence`: grün.
- `test:tdd-matrix`: 82 Tests grün, vier explizite Blackbox-Skips;
  `check:tdd-matrix-coverage`: 66/66 erforderliche IDs, 100 %.
- `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`: grün.
- `audit:openapi`: null Fehler, 480 bestehende Warnungen, keine neue REST-Route.
- Gezielte SonarJS-Prüfung: keine Befunde bei kognitiver Komplexitätsgrenze 20,
  redundanten Sprüngen, invarianten Rückgaben und den aktivierten Regex-Regeln.
- OpenAPI, Operationsindex, Funktionsmodell und Signalkatalog regeneriert; unverändert.
  `generate:llm` zuletzt nach CHANGELOG/Dokumentation; `check:llm` grün.
- `git diff --check`: grün.

`npm run test:unit:ci` wurde auf ausdrückliche Vorgabe nicht ausgeführt.
Keine Credentials-/`.env`-Lektüre, keine globalen Installationen, keine fremden
Worktree-Änderungen, keine schreibenden GitHub-Aufrufe und kein Push.

## Restrisiken und Anschlussarbeiten

Dies ist ein Selbstreview, kein unabhängiges Security-Review. Vor automatischem Einsatz
in #889 sollte eine zweite Person insbesondere Authorizer/Kontrollfluss und Hostadapter
prüfen. Native SQLite-/Node-Fehler und Dateisystemrennen durch andere gleichberechtigte
Hostprozesse sind außerhalb der Skriptsprache. Die Speichergrenze ist eine konservative
Zählung/Schätzung, keine harte RSS- oder Betriebssystemquote. Einzelne native, bereits
volumenbegrenzte Bibliotheksaufrufe besitzen keinen Betriebssystem-Abbruch.

Falsch als lesend deklarierte Hostoperationen bleiben ein Index-/Backend-Risiko;
die zusätzlichen Principal-/Containerprüfungen ersetzen kein Review der Effektangaben.
Externe Daten können sich unabhängig von der lokalen Datenversion verändern und werden
im Protokoll festgehalten. Journal-Persistierung, Aktivierungszustand und erneute Ausführung
der exportierten Prüffälle benötigen die Funktions-/Skill-Zuordnung von #889.
Die öffentliche Graphansicht kann dort gezielt an die interne Ableitungsprojektion
angeschlossen werden. Erweiterungen der SQL-/Methodenfreigaben benötigen erneute Tests
und ein Review; die gegenwärtigen Einschränkungen sind dokumentiert.
