# RC3: Arbeitskontext und Quellenbezüge

## Umfang und Datenschutz

Die vier Befunde werden ausschließlich mit generierten synthetischen Daten
nachgestellt: Projekt Nord, Gremium A, Organisation A, Arbeitsstand-A.txt und
Export-A.csv. Keine Originalunterlagen, produktiven Namen oder Gesprächskennungen
wurden übernommen. Der lokale Harness verwendet getrennte temporäre Datenbanken,
synthetische Principals und vollständig ersetzte LLM-Funktionen. Deskriptor- und
Skill-Hintergrundjobs sind auf `2 ** 31 - 1` verzögert; der Praxis-Transport arbeitet
Deskriptoren kontrolliert vor dem ersten Turn eines neuen Gesprächs ab.

Es gab keine Live-LLM-Läufe und keinen vollständigen Unit-CI-Lauf. Live-Nachtest und
Vollauf bleiben bei der aufrufenden Session.

## Reproduktion vor der Produktänderung

`tests/practice-real-cases-replay.test.js` verwendet `createLocalTransport` und damit
`createLiveHarness`, echte Workbench-Turns, Quellenablage, Dataset-Ausführung,
Fallzuordnung und den unveränderten Praxis-Prüfer. Der Stub validiert jede
strukturierte Antwort gegen das tatsächlich angeforderte Schema. Die beiden
ungültigen Rollenklassifikationen enthalten ausdrücklich `subject=self`,
`firstPerson=true`, den aktuellen wörtlichen Beleg sowie Rolle „Ich“ bzw. den
vollständigen Aufgabensatz; die erste Variante hat nur ein Ziel und keinen Auftrag.

Nach Fertigstellung der Replays wurde der Produktcode temporär auf HEAD zurückgesetzt
und anschließend vollständig wiederhergestellt. Derselbe Testaufruf:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --coverage=false \
  tests/practice-real-cases-replay.test.js -t RC3
```

Ergebnis auf unverändertem Produkt: **6 Tests rot** (vier Lücken, je zwei Varianten
für Rollenangabe und Tabellenbezug), **9 ergänzende Tests übersprungen**. Sichtbar waren falsche
Rollenbestätigungen, die Funktions-Rückfrage, eine Fallübersicht und eine alleinige
Zeilenanzahl. Die Erwartungen wurden nicht abgeschwächt.

## Ursachen und Änderungen

| Lücke | Ursache | Zentrale Änderung | Generiertes Szenario |
| --- | --- | --- | --- |
| Aufgabe als Rolle | Wörtlicher Beleg und nichtleeres Rollenfeld wurden bereits als ausreichend betrachtet. | Grammatische Sprecherbezüge und ein kopierter eigener Aufgabensatz sind keine Rollenbezeichnung. Rolle oder substanzieller Auftrag sind erforderlich; Ziel allein genügt nicht. Schema-Anweisung präzisiert; Provider-Schema kompatibel und strenge lokale Prüfung erhalten. | `task-without-role` |
| Rolle als Funktionskorrektur | Der frühe Rollenpfad verlangte einen alten Kontext. Zusätzlich hielt die grammatische Subjektprüfung „Ich“ bei einem späteren Modalverb für ein nominales Fremdsubjekt. Danach fing die Lernschleife die Aussage als mehrdeutige Funktionskorrektur ab. | Grammatische Subjektprüfung korrigiert. Bei einer nicht eindeutig auflösbaren Funktionskorrektur mit eigenem Subjekt werden belegte Rollenfelder früh geprüft, auch ohne alten Kontext. Eindeutig aufgelöste Funktionskorrekturen behalten ihren Pfad. | `role-before-correction` |
| Befassung als Fallübersicht | Das Wort „Stand“ genügte im Intent-Fallback; ein gebundener Fall wurde außerdem wie eine ausdrücklich genannte Kennung behandelt. Der Statuspfad lief vor der Situationserkennung. | Status-Fallback auf vollständige Statusbitten begrenzt; tatsächliche Fallkennungen separat behandelt. Inhaltliche Aussagen erreichen die reguläre Situationserkennung und Dokumentantwort im gespeicherten Arbeitskontext. Der Replay legt zusätzlich einen getrennten fremden Fall an. | `content-before-status` |
| Tabelle ohne Aktenbezug | Der Themenanker des vorherigen Nutzerturns fehlte ohne frühere gemeinsame Quellenwahl. Semantisch zusammengehörige Quellen mit verschiedenen Gegenstandslabels konkurrierten anschließend im Margin-Test. Routing-Metadaten wurden außerdem als Inhaltsfrage ausgeführt. | Letzte äußere Nutzerfrage kurzzeitig im vorhandenen Gesprächsspeicher; vollständig getroffene frühere Gegenstände als begrenzte Kandidaten im bestehenden semantischen Resolver. Bestätigte Quellen bilden eine gemeinsame Auswahl, jede mit unveränderten Einzelprüfungen. Ausführung mit ursprünglicher Nutzerfrage; belegte Gegenüberstellung und Herkunft über bestehende Evidenzantwort. | `table-record-reference` |

Die Tabellenfixture enthält mehrere Klassen und eine Summenzeile. Der Stub liefert
absichtlich einen Count-Plan: Erst die gemeinsame Evidenz liest executor-geprüfte
Quantitäten zusätzlich zur Zeilenanzahl und stellt sie dem Dokument gegenüber.
Routing-Zusätze dürfen dabei keinen neuen Rechenauftrag aus einem Dateinamen ableiten.
Der Test verlangt beide Quellen, Abweichung, offene Zuordnung und Fundstellen. Eine zusätzliche Variante unterdrückt nur beim ersten Tabellen-Turn die Kandidatenverfügbarkeit: Nach dessen Kurzantwort muss der Folgebezug auch ohne zuvor gespeicherte gemeinsame Quellenwahl funktionieren.

## Blast Radius

GitNexus wurde mit `query` und `impact(direction=upstream)` aufgerufen. Der
angegebene Index kennt die aktuellen Workbench-/Evidenzsymbole nicht und meldet
`Target not found` bzw. Risiko `UNKNOWN`; er ist für diesen Stand nicht belastbar.
Auch `detect_changes(scope=all)` und der Vergleich gegen `main` wurden mit dem
expliziten Worktree aufgerufen. Beide lieferten keine Antwort; der wartende Aufruf
wurde abgebrochen. Das ist keine erfolgreiche Graphprüfung. Lokale
`grep -rn`-Aufrufanalyse und gezielte Quellprüfung ergänzen den Index:

- `applyRoleContext`: Situationserkennung und früher Rollenpfad;
  `readRoleUpdate`: Workbench-Chat; `roleConfirmation`: Antwort und Turn-Abschluss.
- `classifyWorkbenchIntent`: Workbench-Chat, OpenAI-kompatibler Einstieg,
  Function-Coverage und Folgebezug. Regressionsrisiko erhöht durch frühes Routing.
- `saveTurn`: vorhandener gemeinsamer Gesprächsspeicher in mehreren Turn-Pfaden;
  einzig ein begrenztes Feld für die vorherige äußere Frage ergänzt.
- `contextualEvidenceQuestion`: `projectManifestAnswer`; dessen Aufrufer sind
  Workbench-Projektantwort und Personal-Agent-Fassade.
- `selectProjectCandidates`: gemeinsamer Projekt-/Quellenrouter. Die Ergänzung
  betrifft nur die explizite Gruppe frisch semantisch bestätigter Quellen;
  Standardverhalten, Score-, Inhalts-, Kennungs- und Korrekturprüfungen bleiben aktiv.

Keine Änderungen an Berechtigungen, Tenant-Identitäten, Service-Aktionen oder REST-Routen.
Die Regel aus #954 bleibt aktiv: Quellen ausschließlich aus demselben Gespräch
übernehmen nicht vor dem regulären Dokument-/Rollen-/Personenschutzpfad.

## Validierung

Alle folgenden Prüfungen sind offline erfolgreich abgeschlossen:

| Prüfung | Ergebnis |
| --- | --- |
| Breite gezielte Regression, seriell und ohne Coverage-Vollauf | 55 Suiten, 1.453 Tests grün |
| Abschließender Replay mit Bezugsauflösungstests | 2 Suiten, 25 Tests grün; davon 15 im neuen Replay |
| `test:shared-service:ci` | 3 Suiten, 86 Tests grün; 22,07 Sekunden |
| `test:e2e:shared-service` | HTTP-E2E mit Stub-Fassade grün; 19,10 Sekunden |
| `test:tdd-matrix` | 82 Tests grün, 4 optionale Tests übersprungen |
| `check:tdd-matrix-coverage` | Pflichtmatrix 66/66, 100 Prozent; 12 optionale MT-Kennungen außerhalb des aktiven Gates |
| `lint` | 0 Fehler; 12 bestehende Warnungen ausschließlich in unveränderten Dateien |
| `build` | Erfolgreich, unveränderter No-op |
| `check:practice-fixtures` | Vier neue Szenarien, Katalogsumme 148 Standardläufe, Datenschutz-Vokabular geprüft und synchron |
| `check:domain-free-core` | Keine Befunde |
| `check:domain-free-equivalence` | 198 Dateien einschließlich Kontaminationsprobe; identische 32.182 Treffer |
| `check:function-model`, `check:signal-catalog`, `check:operation-capability-index` | Synchron |
| `audit:openapi` | 0 Fehler; 480 bestehende Warnungen |

Die breite Regression umfasst insbesondere Rollenkontext, #874, alle
Tenant-Evidence- und Tenant-Memory-Tests, Praxis-Replays, Tabellenqualität,
Projekt-Skills, Projektbündel, Antwortergebnis, Function-Coverage, Dataset-HTTP und
Shared Services. Wegen der zentralen Routing-Änderung wurden zusätzlich der
OpenAI-kompatible Einstieg, Systemaktivität, #873 und der Gesprächspfad geprüft.

Neu erzeugt wurden OpenAPI-Export, Operationsindex, Funktionsmodell einschließlich
Berichten, Signalkatalog und Praxis-Fixtures. Identische Artefakte erzeugen keinen
Diff. `llm.txt` wird zuletzt nach dem Changelog erzeugt und auf Synchronität geprüft.
Die neuen Funktionsmodell-Quellenverweise ergeben sich aus der frühen Nutzung des
bestehenden Funktionskorrektur-/Auflösungspfads.

Die Anonymitätsprüfung vor dem Commit mit `git diff HEAD | grep -iE` gegen
die vertraulichen Namen und Kennungen der Ausgangsbeobachtungen ist ohne Treffer
abgeschlossen. Die Suchbegriffe selbst werden nicht im Repository gespeichert.
`git diff --check` und die Prüfung des gestagten Diffs sind ebenfalls sauber.
`check:llm` bestätigt das zuletzt neu erzeugte `llm.txt`.

Offen bleiben ausschließlich der ausdrücklich extern vorgesehene Vollauf und der
Live-Nachtest. GitNexus kann wegen des alten Index keine belastbare symbolische
Reichweite für diese Änderungen liefern; die lokale Aufrufanalyse und die
Offline-Regressionen decken die betroffenen Pfade ab.
