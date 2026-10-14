# GitNexus-Prüfung für #874

Die betroffenen bestehenden Symbole wurden vor Änderungen mit `impact(direction: upstream)` geprüft. Die Tabelle enthält den höchsten beobachteten Risikostand. HIGH und CRITICAL wurden vor dem Fortsetzen gemeldet. Neue Symbole waren vor ihrer ersten Indizierung teilweise UNKNOWN; dies beweist keinen leeren Wirkungsbereich. Dynamische Moleculer-Aufrufe werden zusätzlich durch Laufzeit- und Berechtigungstests geprüft.

| Symbol | Datei | Risiko | direkte Aufrufer | betroffen gesamt | Abläufe | Module |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| mergePreferences | src/workbench-communication.js | CRITICAL | 1 | 6 | 1 | 5 |
| opaqueContext | src/workbench-identifier-context.js | CRITICAL | 10 | 18 | 2 | 6 |
| capture | src/tenant-memory.js | HIGH | 1 | 8 | 1 | 4 |
| person | src/tenant-memory.js | HIGH | 1 | 5 | 1 | 3 |
| safeTurnMemory | src/workbench-turn-memory.js | HIGH | 6 | 16 | 1 | 3 |
| understand | src/workbench-understanding.js | HIGH | 3 | 14 | 2 | 4 |
| answerProviderSchema | src/workbench-understanding.js | HIGH | 6 | 11 | 2 | 4 |
| generatePracticeCatalog | scripts/generate-practice-evaluation-fixtures.js | LOW | 4 | 10 | 0 | 1 |
| generateCommunicationFixture | scripts/generate-workbench-874-fixtures.js | LOW | 0 | 0 | 0 | 0 |
| generateCommunicationScenarios | scripts/generate-workbench-874-fixtures.js | LOW | 0 | 0 | 0 | 0 |
| checkTurn | scripts/practice-evaluation-checks.js | LOW | 1 | 3 | 0 | 1 |
| runPracticeEvaluation | scripts/validate-practice-live.js | LOW | 1 | 2 | 0 | 1 |
| validatePracticeLive | scripts/validate-practice-live.js | LOW | 1 | 1 | 0 | 0 |
| readProductTree | scripts/validate-practice-live.js | LOW | 1 | 3 | 0 | 1 |
| validateWorkbench874Live | scripts/validate-workbench-874-live.js | LOW | 1 | 1 | 0 | 0 |
| routeCase | services/domain-router.service.js | LOW | 1 | 15 | 0 | 0 |
| handler | services/workbench.service.js | LOW | 0 | 0 | 0 | 0 |
| resolve | src/edifact-message-adapter.js | LOW | 1 | 1 | 0 | 1 |
| change | src/tenant-memory-policy.js | LOW | 2 | 9 | 0 | 1 |
| ASSERTION | src/tenant-memory-schema.js | LOW | 0 | 0 | 0 | 0 |
| preturn | src/tenant-memory.js | LOW | 0 | 0 | 0 | 0 |
| filterAnswer | src/workbench-answer-filter.js | LOW | 1 | 1 | 1 | 1 |
| validateArtifact | src/workbench-artifact.js | LOW | 0 | 0 | 0 | 0 |
| renderArtifact | src/workbench-artifact.js | LOW | 0 | 0 | 0 | 0 |
| instruction | src/workbench-artifact.js | LOW | 0 | 0 | 0 | 0 |
| renderCaseMemory | src/workbench-case-search.js | LOW | 1 | 3 | 1 | 2 |
| CASE_FIELDS | src/workbench-case-search.js | LOW | 0 | 0 | 0 | 0 |
| canRenderCaseRequest | src/workbench-case-search.js | LOW | 1 | 3 | 1 | 2 |
| classifyCodeTokens | src/workbench-code-classification.js | LOW | 0 | 0 | 0 | 0 |
| citedSource | src/workbench-code-sources.js | LOW | 1 | 1 | 0 | 1 |
| resolveCodes | src/workbench-codes.js | LOW | 1 | 9 | 1 | 1 |
| unresolvedQuestions | src/workbench-codes.js | LOW | 1 | 9 | 1 | 1 |
| answerInstruction | src/workbench-communication.js | LOW | 0 | 0 | 0 | 0 |
| SCHEMAS | src/workbench-communication.js | LOW | 0 | 0 | 0 | 0 |
| validateCommunication | src/workbench-communication.js | LOW | 0 | 0 | 0 | 0 |
| INSTRUCTION | src/workbench-communication.js | LOW | 0 | 0 | 0 | 0 |
| proposalText | src/workbench-communication.js | LOW | 0 | 0 | 0 | 0 |
| runContentTurn | src/workbench-content-turn.js | LOW | 1 | 16 | 0 | 0 |
| reviewDisclosure | src/workbench-disclosure-review.js | LOW | 0 | 0 | 0 | 0 |
| reviewRetrieval | src/workbench-document-flow.js | LOW | 1 | 3 | 1 | 2 |
| launchReview | src/workbench-document-flow.js | LOW | 1 | 3 | 1 | 2 |
| confirmLinkedCase | src/workbench-linked-proposal.js | LOW | 0 | 0 | 0 | 0 |
| extractConversationPreferences | src/workbench-preference-extraction.js | LOW | 0 | 0 | 0 | 0 |
| reviewDocuments | src/workbench-review.js | LOW | 1 | 3 | 1 | 2 |
| searchKnowledge | src/workbench-self-knowledge.js | LOW | 0 | 0 | 0 | 0 |
| loadTenantGlossary | src/workbench-tenant-glossary.js | LOW | 0 | 0 | 0 | 0 |
| buildTurnMemory | src/workbench-turn-memory.js | LOW | 1 | 1 | 0 | 1 |
| TURN_SCOPED_FIELDS | src/workbench-turn-scope.js | LOW | 0 | 0 | 0 | 0 |
| questionsFor | src/workbench-understanding.js | LOW | 1 | 3 | 1 | 2 |
| answerPrompt | src/workbench-understanding.js | LOW | 1 | 4 | 1 | 2 |
| generateAnswerResult | src/workbench-understanding.js | LOW | 1 | 3 | 1 | 2 |
| answer | src/workbench-understanding.js | LOW | 1 | 9 | 1 | 1 |
| SITUATION_SCHEMA | src/workbench-understanding.js | LOW | 0 | 0 | 0 | 0 |
| decorateAnswer | src/workbench-understanding.js | LOW | 1 | 3 | 1 | 2 |
| ARTIFACT_ANSWER_SCHEMA | src/workbench-understanding.js | LOW | 0 | 0 | 0 | 0 |
| ARTIFACT_CLAIM | src/workbench-understanding.js | LOW | 0 | 0 | 0 | 0 |
| CLAIM | src/workbench-understanding.js | LOW | 0 | 0 | 0 | 0 |
| practice-evaluation.test.js | tests/practice-evaluation.test.js | LOW | 0 | 0 | 0 | 0 |
| workbench-874.test.js | tests/workbench-874.test.js | LOW | 0 | 0 | 0 | 0 |
| answer |  | UNKNOWN | – | 0 | – | – |
| boundaryLine |  | UNKNOWN | – | 0 | – | – |
| exactCodeToken | src/edifact-message-adapter.js | UNKNOWN | – | 0 | – | – |
| person | src/person.js | UNKNOWN | – | 0 | – | – |
| caseFieldIndex | src/workbench-case-search.js | UNKNOWN | – | 0 | – | – |
| boundaryLine | src/workbench-understanding.js | UNKNOWN | – | 0 | – | – |

Die HIGH-Pfade betreffen Verständnis (Chat und Status), Schemaübersetzung sowie Erfassung und Projektion des Gedächtnisses. Die CRITICAL-Pfade betreffen gemeinsame Maskierung und Präferenzzusammenführung. Regressionen prüfen insbesondere aktuelle Aufträge nach Schemafehlern, Codebelege, Datenabgrenzung, Tenant-/Clearance-Grenzen, vollständige Artefakte und bestätigte Anlage.

## Änderungen gegen die Hauptlinie

Abgeschlossen vor dem Commit mit GitNexus `detect-changes` (entspricht `detect_changes`). Temporär ausschließlich für diese Aufrufe: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.interHunkContext GIT_CONFIG_VALUE_0=100000`. Die großen generierten JSON-Diffs verursachten mit Einzelhunks Query-Timeouts. Zusammengefasste Hunkbereiche schließen zusätzliche Zwischenbereiche ein; keine Dateien oder Änderungen wurden ausgeschlossen.

| Vergleich | Dateien | Symbole | betroffene Abläufe | Risiko |
| --- | ---: | ---: | ---: | --- |
| origin/main | 56 | 418 | 30 | CRITICAL |
| main | 287 | 2523 | 88 | CRITICAL |
| staged | 56 | 418 | 30 | CRITICAL |

Die lokale `main`-Referenz ist älter als die eingebundene `origin/main`-Referenz und enthält deshalb zusätzlich bereits vorhandene Änderungen der Vorläufer. Der aktuelle PR-Wirkungsbereich ist der Vergleich gegen `origin/main`. Er enthält die erwarteten Wissens-, Gedächtnis-, Verständnis-, Artefakt-, Status- und Validierungspfade sowie ihre generierten Artefakte. Die breiteren Hunkbereiche erklären zusätzliche Symbole zwischen den tatsächlichen Änderungen. Die betroffenen Chat-, Status-, Quellen-, Dokument- und Gedächtnispfade werden durch die Regressionstests geprüft.

## Ergänzende Analysen vor der Abschlusskorrektur

Die zusätzlichen Prüfungen wurden über den GitNexus-CLI-Runner ausgeführt. Der MCP-Prozess war nach paralleler Änderungsanalyse nicht mehr verfügbar; Einzelprozesse verwenden denselben frisch indizierten Graphen.

| Symbol | Datei | Risiko | direkte Aufrufer | betroffen gesamt | Abläufe | Module |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| generateAnswerResult | src/workbench-understanding.js | HIGH | 1 | 4 | 2 | 3 |
| tests/capability-routing-cache-drift.test.js | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – | – |
| classifyCodeTokens | src/workbench-code-classification.js | LOW | 0 | 0 | 0 | 0 |
| generateEmbeddingDriftFixture | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – | – |
| generateCommunicationFixture | scripts/generate-workbench-874-fixtures.js | LOW | 0 | 0 | 0 | 0 |
| extractConversationPreferences | src/workbench-preference-extraction.js | LOW | 0 | 0 | 0 | 0 |
| handler | services/workbench.service.js | LOW | 0 | 0 | 0 | 0 |
| repairOutput | src/workbench-llm-repair.js | CRITICAL | 3 | 10 | 2 | 5 |
| understand | src/workbench-understanding.js | HIGH | 3 | 14 | 2 | 4 |
| handler | services/workbench.service.js | LOW | 0 | 0 | 0 | 0 |
| handler | services/workbench.service.js | LOW | 0 | 0 | 0 | 0 |

## Erneute Prüfung der Falldarstellung

Bei einer Zwischenkorrektur scheiterten CLI-Aufrufe wegen einer überlappenden Indizierung; die Shell führte die nachfolgenden Änderungen dennoch aus. Die betroffenen Dateien wurden auf den vorigen Commit zurückgenommen, der Index vollständig neu erzeugt und geschlossen und die Upstream-Analysen anschließend erfolgreich wiederholt. Erst danach wurden die überprüften Änderungen erneut angewendet. Verständnis, Antwortaufbereitung und Falldarstellung sind HIGH; neue Hilfsfunktionen vor Erstindizierung UNKNOWN. Die isolierte Normalisierung von negativem Nullwert im Vektorgenerator ist LOW; der vorhandene Reproduzierbarkeitstest prüft sie.

## Abschließende Vertragskorrekturen

Die erneuten erfolgreichen Analysen vor den Änderungen betreffen die wörtliche Übernahme bestellter Überschriften, die interne Zielgruppe, den privaten schemagebundenen Ausgabemodus, gespeicherte Gesprächsvorgaben in der Fallsuche und die reproduzierbare Vektorgenerierung. Fehlgeschlagene Zwischenaufrufe sind keine erfolgreiche Wirkungsanalyse und werden hier nicht als solche gewertet.

| Symbol | Datei | Risiko | direkte Aufrufer | betroffen gesamt | Abläufe |
| --- | --- | --- | ---: | ---: | ---: |
| answer | src/workbench-understanding.js | LOW | 2 | 10 | 2 |
| decorateAnswer | src/workbench-understanding.js | HIGH | 1 | 4 | 2 |
| functionEmbedding | scripts/function-model-embeddings.js | LOW | 0 | 0 | 0 |
| extractConversationPreferences | src/workbench-preference-extraction.js | LOW | 0 | 0 | 0 |
| renderCaseMemory | src/workbench-case-search.js | LOW | 0 | 0 | 0 |
| understand | src/workbench-understanding.js | HIGH | 3 | 14 | 2 |
| caseWorkLines | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – |
| answer | src/workbench-understanding.js | LOW | 2 | 10 | 2 |
| decorateAnswer | src/workbench-understanding.js | HIGH | 1 | 4 | 2 |
| caseWorkLines | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – |
| renderCaseMemory | src/workbench-case-search.js | HIGH | 1 | 4 | 2 |
| understand | src/workbench-understanding.js | HIGH | 3 | 14 | 2 |
| caseWorkForAnswer | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – |
| classifyCodeTokens | src/workbench-code-classification.js | LOW | 0 | 0 | 0 |
| classifyCodeTokens | src/workbench-code-classification.js | LOW | 0 | 0 | 0 |
| extractConversationPreferences | src/workbench-preference-extraction.js | LOW | 0 | 0 | 0 |
| understand | src/workbench-understanding.js | HIGH | 3 | 14 | 2 |
| generateCommunicationFixture | scripts/generate-workbench-874-fixtures.js | LOW | 0 | 0 | 0 |
| classifyCodeTokens | src/workbench-code-classification.js | LOW | 0 | 0 | 0 |
| artifactProviderSchema | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – |
| restoreArtifactContract | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – |
| understand | src/workbench-understanding.js | HIGH | 3 | 14 | 2 |
| tests/workbench-874.test.js | neues/testbezogenes Symbol | UNKNOWN | – | 0 | – |

## Getrennte Ausgabeform und abschließende Teilverträge

Weitere erfolgreiche Upstream-Prüfungen vor den Korrekturen: `extractOutputContract`
(bei Erstaufnahme UNKNOWN, nach Indizierung LOW, 0 direkte Aufrufer),
`classifyCodeTokens` (LOW, 0 direkte Aufrufer), `artifactProviderSchema`
(LOW, 2 direkte Aufrufer, 2 Abläufe), `materializeTables` (neues Symbol UNKNOWN),
`generateAnswerResult` und `decorateAnswer` (HIGH, je 1 direkter Aufrufer,
4 betroffene Symbole, 2 Abläufe), `understand` (HIGH, 3 direkte Aufrufer,
14 betroffene Symbole, 2 Abläufe). Die HIGH-Risiken wurden vor den Änderungen
benannt. Die getrennte Extraktion verwendet denselben geschlossenen
Artefaktvertrag. Teil-Zielgruppen und adressierte Nachrichten werden nicht mehr
von der globalen Einordnung überschrieben. Tabellenzeilen behalten ihre
Quellenmetadaten und werden mit den bestellten Spalten deterministisch aufgebaut.
Die Rollenprüfung erhält ausschließlich aktuelle Originalwerte; eine gemeinsame
Bedeutungsfrage umfasst alle darin aufgezählten fachlichen Werte.

Die zusätzliche Unterscheidung zwischen aktueller Arbeitsaufgabe und ausdrücklich
angeforderter Suche nach gespeicherten CET-Vorgängen wurde ebenfalls vorab
analysiert: `extractConversationPreferences` LOW (0 direkte Aufrufer),
`understand` HIGH (3 direkte Aufrufer, 14 betroffene Symbole, 2 Abläufe).
Die Unterscheidung ist ein geschlossenes semantisches Feld; sie verwendet keine
Suchwort-, Systemnamen- oder Fachcodeliste.

## Abschließende Rückfrage- und Sicherheitsprüfung

Vor der Korrektur der Rückfrageliste wurde `classifyCodeTokens` erneut geprüft
(LOW, 0 direkte Aufrufer). Bei ausdrücklich aktivem Rückfragemodus führt eine
schemagebunden als klärungsbedürftig erkannte Situation ohne verwendbare neue
Frage zur bestehenden begrenzten Reparatur. Der gezielte Regressionstest deckt
auch diese leere Liste ab.

Vor den CI-Sicherheitskorrekturen: `materializeTables` LOW (0 direkte Aufrufer),
`renderCaseMemory` HIGH (1 direkter Aufrufer, 4 betroffene Symbole, 2 Abläufe),
`validateWorkbench874Live` und `generateEmbeddingDriftFixture` LOW;
`escapeTableCell` vor seiner Aufnahme UNKNOWN. Der HIGH-Befund wurde vorab
benannt. Beide Tabellenpfade teilen nun dieselbe vollständige Behandlung von
Backslashes, Zelltrennern und Zeilenumbrüchen. Der Live-Runner verwendet ohne
expliziten Zielpfad ein privat angelegtes temporäres Verzeichnis.

Die weitere Upstream-Prüfung der Tokenklassifikation ist LOW (0 direkte
Aufrufer). Die vorgeschlagenen Zeichenformen dürfen nicht selbst wieder als
Kennung maskiert werden: ausschließlich numerische Zeichen-, Buchstaben- und
Ziffernanzahlen werden mitgegeben. Bei einer ausdrücklichen Bedeutungsfrage
bleiben nicht zuordenbare Referenzwerte ohne belegte Familie als ungeklärte
Kandidaten erhalten, statt stillschweigend zu verschwinden. Das behauptet keine
Bedeutung und erzeugt ohne Quelle weiterhin ausschließlich „nicht belegt“.
Bekannte Objektfamilien, Systeme und Glossarbegriffe werden dadurch nicht zu
Fachcodes. Bestellte Arbeitsprodukte aktivieren diesen Unsicherheitspfad nicht.

## Bericht, Rückfragen und lesbarer Fallstatus

Weitere erfolgreiche Upstream-Analysen vor den Änderungen:
`questionsFor`, `validateCommunication` LOW; `forbiddenWording` als neues Symbol
UNKNOWN. Wortstämme gelten jetzt auch für Rückfragen und einleitende Sachabsätze.
`answer` LOW (2 direkte Aufrufer, 10 betroffene Symbole, 2 Abläufe),
`renderCaseMemory` und `canRenderCaseRequest` HIGH (je 1 direkter Aufrufer,
4 betroffene Symbole, 2 Abläufe), Query-`handler` LOW; bei Mehrdeutigkeit wurde
zusätzlich die Symbolposition 1426–1561 im Graphen überprüft. Ein eindeutiger
Status-Treffer liefert seine bereits autorisierte Fallreferenz mit, ohne den
Vorgang oder die Chat-Zuordnung zu ändern. Sprachverbote gelten für die
vorhandene Falldarstellung; betroffene gespeicherte Werte werden neutral markiert.

`filterAnswer`, `CLAIM` und `answerPrompt` sind LOW. Ein optionales `inputQuote`
wird nur bei einem exakten Originalausschnitt akzeptiert; dann überschreibt der
Server jeden zusätzlich generierten Text durch ein ausdrücklich bezeichnetes
Berichtszitat. Daraus folgt keine eigene Codebedeutung oder bestätigte Erledigung.
Ohne exakten Beleg bleibt der bisherige Codefilter wirksam.
`clarifyMissingInformation` war vor seiner Aufnahme UNKNOWN; der begrenzte
Klärungsschritt nutzt den vorhandenen Informations-/Fragenvertrag und zentralen
Client. `classifyCodeTokens` wurde vor seiner Anbindung erneut mit LOW geprüft.
`fallbackAnswer` HIGH (1 direkter Aufrufer, 4 betroffene Symbole, 2 Abläufe),
`answerBody` LOW: bei vorhandenen Rückfragen bleibt ein sprachlich zulässiger,
wörtlicher Berichtskontext sichtbar, auch wenn keine Modellbewertung zustande kam.
`generateAnswerResult` HIGH (1 direkter Aufrufer, 4 betroffene Symbole, 2 Abläufe):
Sprachprüfung auch nach Umwandlung von Berichtszitaten und nach Offenlegungsprüfung.
Alle HIGH-Befunde wurden vor den jeweiligen Änderungen benannt.

## Aktuelle Codefragen und schemagebundene Schrittfolge

Upstream vor den Änderungen: `runContentTurn` LOW (1 direkter Aufrufer,
16 betroffene Symbole, 0 ausgewiesene Abläufe), `unresolvedQuestions` LOW
(1 direkter Aufrufer, 9 betroffene Symbole, 1 Ablauf). Code-Rückfragen werden
nur aus den aktuellen Auflösungen erzeugt; alte `code:`-Fragen gelangen nicht
in eine neue unabhängige Sachfrage. Die gespeicherte Anrede gilt auch dort.

`materializeTables`, `instruction`, `ARTIFACT_ANSWER_SCHEMA`,
`extractOutputContract`, `generateCommunicationFixture` und `filterAnswer` LOW;
`generatePracticeCatalog` LOW (4 direkte Aufrufer). Das vorhandene Materialisieren
wird auch für `orderedSteps` wiederverwendet: fortlaufende Nummern und bestellte
Abschnittsüberschriften entstehen serverseitig, Quellenmetadaten bleiben erhalten.
`generateAnswerResult` HIGH (1 direkter Aufrufer, 4 betroffene Symbole, 2 Abläufe):
eine klare aktuelle Sachfrage darf nicht ausschließlich mit weiteren Schritten
beantwortet werden. Die bestehende begrenzte Reparatur verlangt eine direkte Antwort.
`understand` HIGH (3 direkte Aufrufer, 14 betroffene Symbole, 2 Abläufe):
neue personenbezogene Deutungen werden weder als neue Fallrisiken noch als
Sachstandsrisiken übernommen. Die HIGH-Risiken wurden vorab benannt.

Das Risiko-Pflichtmuster des bestehenden Governance-Szenarios wurde um die
korrekte Mehrzahl erweitert. Dafür wurden ausschließlich die unveränderten
Referenzantworten erneut deterministisch geprüft; Modellaufrufe, übrige Prüfungen
und Rubriken bleiben erhalten. Die Beschreibung der Korrektur steht im Referenzbericht.

Abschließender geprüfter Änderungsumfang vor dem Commit: gegen `origin/main`
59 Dateien, 449 Symbole und 38 Abläufe, CRITICAL; gegen die ältere lokale
`main`-Referenz 290 Dateien, 2549 Symbole und 93 Abläufe, CRITICAL; im Staging
23 Dateien, 180 Symbole und 34 Abläufe, CRITICAL. Die größere lokale
`main`-Differenz enthält bereits auf `origin/main` vorhandene Vorläufer.
Die tatsächliche PR-Differenz wird zusätzlich gegen `origin/main` geprüft.
Die geprüften Abläufe betreffen Gesprächsführung, Code-/Belegverarbeitung,
Maskierung und Fallzugriff. Die gemeinsam genutzten zentralen Aufrufe erklären
den übergreifenden Wirkungsbereich. Für die großen generierten Diffs wurde nur
bei den GitNexus-Aufrufen `diff.interHunkContext=100000` verwendet; dies erweitert
Diff-Bereiche und schließt keine Änderungen aus.
