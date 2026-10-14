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
