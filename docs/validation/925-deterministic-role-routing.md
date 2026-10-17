# #925 — Deterministische Entscheidung über eigene Kontextänderungen

Stand: 2026-10-17. Ausgangsstand: `ce9a5e9c`; Branch: `fix/925-role-correction`.
Die aufrufende Session meldet Unit-CI auf diesem Ausgangsstand als grün.
Hier ausschließlich Offline-Prüfungen, kein Live-LLM-Lauf und kein vollständiger Unit-CI-Lauf.

## Bereitgestellter Live-Befund

Der [Live-Bericht auf ce9a5e9c](practice-evaluation-925-teil2-live-1.md) wird
unverändert mit aufgenommen. SHA-256:
`2aaf260be3ddef0a5be35d5f024a2986564da97d055469a9cf8b88d76a1734fd`.

Die identische Korrektur „Korrektur: Ich betreue die Dokumentation im Team A;
mein Ziel ist eine vollständige Belegübersicht.“ gelingt im ersten Rollenlauf,
wird im zweiten aber mit „Welche festgehaltene Aussage meinst du?“ beantwortet.
Der Bericht zeigt außerdem weitere deterministische Rollenfehler und einen
Abbruch wegen des Providerkontingents. Die Rubrikbewertung ersetzt diese
Einzelprüfungen nicht. `representation` erreicht dreimal 12/12.
Diese Befunde betreffen den Ausgangsstand, nicht die vorliegende Änderung.

## Ursache und Änderung

`ce9a5e9c` zog das vollständige Verstehen vor die Gedächtnis-Präturns.
Die Entscheidung hing dadurch weiterhin von modellgelieferten Rollenfeldern,
Selbstsubjekt und Präferenzextraktion ab. Eine leere oder fehlgeschlagene
Extraktion konnte den Turn weiterhin an den Gedächtnispfad abgeben.

`readRoleUpdate` prüft nun zuerst lokal, ob Rolle, Auftrag, Ziel oder eine bereits
wörtlich gespeicherte Selbstaussage im Gespräch vorhanden sind. Der anschließende
Selbstbezugstest verwendet deutsche grammatische Formen: Singularpronomen als
Subjekt, finite Verbformen einschließlich invertierter Stellung und nominative
Possessivkonstruktionen. Fragen und zitierte Inhalte begründen keine Aktualisierung.
Es gibt keine Rollen-, Fach- oder Korrekturphrasenliste.

Bei positivem Befund steht die Routingentscheidung vor jedem Modellaufruf fest.
Nur Rolle, Auftrag/Gegenüber und Ziel werden mit einem geschlossenen Dreifeldschema
extrahiert. Alle Felder müssen wörtlich in der aktuellen Nachricht belegt sein;
die Modellantwort enthält keine Routing-/Subjektentscheidung. Fehler, ungültige
Antworten, leere Rollenfelder und unbelegte Ergänzungen führen zur wörtlichen
Übernahme der aktuellen Nachricht in `conversationContext.statement`.
Frühere Rollenfelder werden dabei geleert, nicht still weiterverwendet.

Die volle Aussage bleibt auch oberhalb von 1.200 Zeichen erhalten; allein das
zusätzliche Basisbelegstück hält die bestehende Längengrenze ein. Die Bestätigung
bezeichnet den Fallback als „Aussage“, nicht als erfundene Rolle. Kontext und
Korrekturhinweis werden wie bisher nach Speicherung sichtbar ausgegeben.
Der Antwort-Prompt nutzt auch einen Kontext ohne extrahierte Einzelfelder.
Eine spätere erfolgreiche Feldextraktion entfernt den überholten wörtlichen Fallback.

Der Inhaltsturn übernimmt das vorbereitete Rollenlagebild. Für die eigene
Korrektur werden weder primäres Verstehen noch Selbstsubjekt-/Präferenzextraktion
erneut aufgerufen. Beide Gedächtnis-Präturns werden vorher übergangen.
Ohne gespeicherten Arbeitskontext oder ohne strukturellen Selbstbezug bleibt
das vorhandene Routing bestehen; insbesondere braucht „korrigier das“ keinerlei
LLM-Extraktion und behält den letzten Aussage-/Datensatzbezug.

## Abgrenzung zu Dritten und Tests

„Ich glaube, Kollege A …“ enthält zunächst nur einen Sprecherrahmen, keine eigene
Rollenmitteilung. Der Test verlangt eine eigene Aussage und berücksichtigt
nominale Drittpersonsubjekte sowie entsprechende Nebensätze. Solche Aussagen,
zitierte Selbstaussagen anderer und die geprüften gemischten Aussagen erhalten
keinen Vorrang vor dem bestehenden Personenschutz aus #874.
Diese Regeln sind deterministische Grammatikprüfungen, keine vollständige
semantische Analyse beliebiger deutscher Formulierungen.

Die vollständigen Mehrturn-Tests wiederholen dieselbe Korrekturnachricht mit
leeren Rollenklassifikationen und absichtlich ausfallender Selbstsubjekt-/
Präferenzextraktion. Die eigene Korrektur muss ohne Aufruf dieser Extraktionen
und ohne Gedächtnis-Präturn gespeichert und sichtbar bestätigt werden.
Die Feldextraktion variiert zwischen gültig, leer, Ausnahme, Schemafehler und
unbelegtem Wert. Bis auf den gezielten Schemafehlertest sind die Antworten
gegen das tatsächlich übergebene Schema validiert.

Geprüft werden außerdem die korrigierten Felder beziehungsweise die vollständige
wörtliche Aussage im echten Antwort-Prompt des Folgeturns, erneute Korrektur nach
Fallback, lange Aussagen, anfangs nur gespeichertes Ziel, Zustand nach Ablauf,
Dokumentübergabe und parallel laufendes Review. Profile, authentifizierte Rollen,
Tenant-/Akteur-/Gesprächsgrenzen und der anschließende Drittpersonenturn bleiben geprüft.
Die authentifizierten HTTP-Tests behalten alle fachlichen Assertions für die
zuletzt genannte Aussage beziehungsweise den zuletzt genannten Datensatz bei.

## Wirkungsanalyse

Upstream-Impact wurde vor Änderungen für `readRoleUpdate`, `roleConfirmation`,
`applyRoleContext`, `answerInstruction`, `understand`, den Chat-Handler und die
Testhelfer/-datei aufgerufen. Query und Impact finden diese Symbole weiterhin
nicht (`UNKNOWN`). Ergänzende Referenzprüfung: Chat-Handler → Rollenhelfer →
Inhaltsturn; Bestätigung und Antwort-Prompt → gespeicherter Gesprächskontext.
Manuelles Risiko: **mittel**, begrenzt auf Rollenrouting und Kontextdarstellung.
Die Gedächtnis-/Datensatz-Korrekturimplementierungen und Zugriffsregeln bleiben unverändert.

`detect_changes(scope=all)` mit explizitem Worktree meldet Risiko `low`, aber
keine indizierten geänderten Symbole trotz geänderter Quelldateien. Das ist kein
vollständiger Flussnachweis. Der Vergleich mit `main` lieferte innerhalb von
30 Sekunden kein Ergebnis; das lokale `main` liegt 272 Commits hinter dem
Ausgangsstand. Der lokale Diff gegen `ce9a5e9c` ergänzt deshalb die Scope-Prüfung.
Der abschließende gestagte GitNexus-Lauf bestätigt 14 geänderte Dateien und Risiko
`low`, weiterhin ohne erkannte Symbole oder Prozesse. Die gestagte Dateiliste und
`git diff --cached --check` wurden zusätzlich geprüft.

## Offline-Abnahme

| Prüfung | Ergebnis |
| --- | --- |
| Betroffene Regressionen, abschließender breiter Lauf | **23 Suites / 1.007 Tests grün**, einschließlich Rollenpfad, Gedächtnis-HTTP, #874, #873, #813, Dokument-/Reviewfluss, Gesprächszustand und Praxis-Evaluation. |
| `lint` | 0 Fehler, 12 bestehende Warnungen außerhalb der Änderungen. |
| S1751 / S5850 / S2871 | 0 Fehler auf allen sechs geänderten JavaScript-Dateien; ESLint `no-unreachable-loop` sowie SonarJS `anchor-precedence` und `no-alphabetical-sort`. |
| `test:shared-service:ci` | 3 Suites / 86 Tests grün. |
| `test:e2e:shared-service` | Grün, Offline-Fassade. |
| `test:tdd-matrix` | 82 Tests grün, 4 bestehende Tests übersprungen. |
| `check:tdd-matrix-coverage` | 66/66 erforderliche IDs, 100 %; optionale Blackbox-IDs unverändert ausgenommen. |
| `check:domain-free-core` | Keine Funde; Kommentare eingeschlossen, keine neuen Ausnahmen. |
| `check:domain-free-equivalence` | Grün: 158 Dateien einschließlich Kontaminationsfixture, 26.709 Treffer. |
| `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`, `check:llm` | Grün. |
| `check:capability-keywords`, `check:practice-fixtures`, `check:quality-gate`, `build` | Grün. |
| `audit:openapi` | 0 Fehler, 480 bestehende Warnungen. |
| `audit:security` | Repo-Gate grün, keine kritischen Findings; vorhandene High-/Moderate-Advisories bleiben ausgewiesen. |
| `git diff --check` | Grün. |

Artefakte wurden mit `export:openapi`, `generate:operation-capability-index`,
`generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`
und `generate:llm` neu erzeugt. OpenAPI, Operationsindex und Praxis-Fixtures bleiben
inhaltlich unverändert. Die übrigen Artefakte enthalten aktualisierte Fingerabdrücke.

Alle Jest-Läufe waren seriell mit ersetzter LLM-Fassade. Der neue Live-Nachweis
und der vollständige Unit-CI-/Coverage-Lauf bleiben der aufrufenden Session vorbehalten.
Der mit aufgenommene Bericht wurde unverändert per SHA-256 nachgeprüft.
