# Validierung #925 — Eigene Rollenangaben

Stand: 2026-10-17. Branch `feat/925-rollenangabe`.
Ausschließlich lokale Prüfungen mit synthetischen Daten und LLM-Stubs.
Kein Live-LLM-Lauf, kein `test:unit:ci`, kein Push.

## Erkennungsregel und Speicher

Das geschlossene `roleStatement`-Schema trennt den Subjektbezug von der
Personenbewertung. Nach allen Klassifikationen gilt: `subject=self`, wörtliche
`basis` aus der aktuellen äußeren Nutzernachricht und darin wörtlich enthaltene
Rolle/Auftrag/Ziel sind erforderlich. Zusätzlich muss die Aussage grammatisch
erste Person sein (`firstPerson=true`) oder über `answersQuestionKey` eine
gespeicherte offene Frage mit `kind=role` beantworten. Bei widersprechendem
Bezug auf andere Personen oder gemischten Aussagen wird der Schutz nicht aufgehoben.
Es gibt keine Phrasenlisten und keine fachlichen Rollenregeln im Code.

`conversationContext` speichert Rolle (`role`), Auftrag/Gegenüber (`mandate`),
Ziel (`goal`) und das Originalbelegstück (`basis`). Der Speicher ist nach Tenant,
Akteur, Kanal und Gespräch getrennt. Der Kontext bleibt zusätzlich zum
kurzfristigen Lagebild erhalten und hat bei dessen Ablauf Vorrang vor einem älteren
Kontext im Vorgang. Beantwortete Rollenfragen werden als beantwortet fortgeführt.
Eine neue eigene Rollenmitteilung ersetzt den Arbeitskontext; Bestätigung und
Korrekturhinweis sind sichtbar. Das Nutzerprofil, RBAC, `domainsAllowed`,
Clearance und Gateway-Regeln werden nicht aus der Rollenmitteilung geändert.

Antwort-Prompts erhalten den Kontext in Folgeturns. Belege und markierte
Einschätzungen bleiben erforderlich. `questionTarget=other` kennzeichnet vorbereitete
Fragen für Dritte; Rückfragen an den Nutzer bleiben im Rückfragepfad.
Die Filter gegen interne Situationsbeschreibungen bleiben aktiv.

## Impact / Blast Radius

GitNexus `impact(..., direction: upstream)` wurde für `understand`, `answer`,
`answerInstruction`, `extractConversationPreferences`, `runContentTurn`, `saveTurn`,
`expireTurn`, `filterAnswer`, `answerPrompt` und `generatePracticeCatalog` aufgerufen.
Der erreichbare Index enthält die Workbench-Symbole nicht; `answer` ist im Index
mehrdeutig und verweist auf fremde Definitionen. Ergebnis daher `UNKNOWN`, kein
belastbarer Graph-Nachweis. Kein Index außerhalb dieses Worktrees wurde verändert.

Zusätzliche `grep -rn`-/Referenzprüfung:

- `understand` / `answer`: Inhaltsturn und direkte Workbench-Service-Routen.
- `answerInstruction`: Antwortgenerierung und Dokumentreview.
- `answerPrompt`: ausschließlich die Antwortgenerierung in `workbench-understanding`.
- `filterAnswer`: Antwortgenerierung und Artefaktvalidierung.
- `saveTurn` / `expireTurn`: Gesprächsablage, Fortsetzung und Bereinigung.
- Praxisgenerator: Fixture-Erzeugung, lokale Tests und Praxis-Evaluationsskripte.

Manuell eingeschätztes Risiko: **MEDIUM**. Änderungen betreffen ausschließlich
Verstehen, Gesprächskontext, Antwortvertrag und Evaluation. Der Personen-Schutztext
für Dritte bleibt unverändert; keine Änderungen an Zugriffskontrollen oder Gateway.
Der neue Helfer ist in die Domänenprüfung aufgenommen, ohne neue Wortausnahmen.

`detect_changes({scope: "compare", base_ref: "main"})` wurde vor dem Commit
aufgerufen und meldete `CRITICAL` (127 Dateien, 265 Symbole, 64 betroffene Prozesse).
Diese Meldung wurde ausdrücklich geprüft und dem Nutzer berichtet. Der lokale
Vergleich zeigt: `main` liegt 262 Commits zurück; `origin/main..HEAD` enthält vor
diesem Commit 0 Commits. Die Graphmeldung umfasst historische Änderungen und einen
unvollständigen Index. Sie ist kein belastbarer Scope-Nachweis für #925.
Der lokale Diff gegen `origin/main` enthält ausschließlich die 19 geänderten Dateien
plus die drei neuen Dateien für Helfer, Tests und diesen Bericht. `AGENTS.md`,
`src/llm-client.js` und Gateway-Dateien sind gegenüber `origin/main` unverändert.
Die lokale Prüfung des gestagten Diffs ergänzt deshalb den Graphvergleich.

## Akzeptanzkriterien

| Kriterium | Status / Beleg |
| --- | --- |
| AC-01 | Lokaler vollständiger Mehrturn-Test: gespeicherte Rollenfrage, eigene Antwort, sichtbare Bestätigung und Arbeitskontext; auch bei abweichender Personenklassifikation und fehlender primärer Rollenerkennung. |
| AC-02 | Vollständiger Folgeturn über Dritte sowie bestehende #874-Personenschutztests. Gemischte/fremde Subjekte heben den Schutz nicht auf. |
| AC-03 | Folgeantwort prüft Rolle im tatsächlichen Antwort-Prompt und nutzt gelieferte synthetische Dokumentevidenz mit Abschnittsbezug; eigener Frageninhalt übersteht den Antwortfilter. |
| AC-04 | Rollenkorrektur und spätere Nutzung, Ablauf des Lagebilds, Scope-Trennung sowie unverändertes Nutzerprofil und unveränderte authentifizierte Rollen werden geprüft. |
| AC-05 | Generiertes, neutrales Szenario `role-onboarding` („Einarbeitung mit Rollenangabe“) samt Audit ergänzt. Live-Praxisabnahme offen; ausdrücklich der aufrufenden Session vorbehalten. |

## Prüfläufe

| Prüfung | Ergebnis |
| --- | --- |
| Neue/berührte Regressionstests | 28 ausgewählte Suites geprüft: zunächst 27 grün, fünf Fehler ausschließlich im Praxis-Vokabular-Audit. Nach dessen Korrektur und den letzten Anpassungen: fokussierter Wiederholungslauf 5 Suites / 530 Tests grün, einschließlich der neuen 15 Rollenkontext-Tests sowie Gespräch, Turn-Scope, #926 und Praxis-Evaluation. |
| `lint` | Grün, 0 Fehler; 12 bestehende Warnungen außerhalb der geänderten Zeilen. Zwei zwischenzeitliche Formatierungsfehler im neuen Praxis-Szenario korrigiert. |
| `test:tdd-matrix` | Grün: 82 Tests bestanden, 4 bestehende Tests übersprungen. |
| `check:tdd-matrix-coverage` | Grün: 66/66 erforderliche Matrix-IDs, 100%; 12 optionale MT-IDs bleiben explizit ausgenommen. |
| `test:shared-service:ci` | Grün: 3 Suites / 86 Tests, Harness unter 60 Sekunden. |
| `test:e2e:shared-service` | Grün, Offline-Stubs einschließlich HTTP-Gesprächskontext und interner Entwürfe. |
| `check:practice-fixtures` | Grün; synthetische Namen und explizit geprüfte neutrale Vokabularergänzung. |
| `check:domain-free-core` | Grün, keine Funde; neuer Helfer ausdrücklich im Scan. |
| `check:domain-free-equivalence` | Grün: 158 Dateien einschließlich Kontaminationsfixture, 26.520 Treffer äquivalent. |
| `check:function-model` | Grün. |
| `check:signal-catalog` | Grün. |
| `check:operation-capability-index` | Grün. |
| `check:llm` | Grün. |
| `audit:openapi` | Grün. |
| `build` | Grün (vorgesehener No-op). |
| `git diff --check` | Grün. |

Alle Jest-Läufe verwenden `NODE_OPTIONS=--experimental-vm-modules`, laufen seriell
und ersetzen die LLM-Fassade durch Stubs. Die Rollenkontext-Stubs erfüllen sowohl
das übergebene Provider-Schema als auch das lokale Situationsschema. Folgeantworten
prüfen den tatsächlichen Promptkontext und referenzieren gelieferte synthetische
Dokumentevidenz; ohne diese Evidenz schlägt der Stub-Test fehl.

Regeneriert: `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
`generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`.
OpenAPI und Operationsindex bleiben inhaltlich unverändert. Funktionsmodell und
Signal-Katalog enthalten den neuen Helfer beziehungsweise aktualisierte Quellbezüge.
Die LLM-Kontextdatei enthält den aktualisierten Changelog-Fingerabdruck.

## Offene Punkte

- Live-Praxislauf einschließlich Regressionsvergleich: durch die aufrufende Session.
- Vollständiger Unit-CI-Lauf mit globalen Coverage-Gates: durch die aufrufende Session.
- GitNexus-Index liefert für diese Dateien keinen vollständigen Impact-Graphen;
  lokale Referenzprüfung und Offline-Regressionen dienen als ergänzende Absicherung.
