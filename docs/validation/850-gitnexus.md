# GitNexus-Änderungsanalyse für #850

Basis: `origin/main` mit Commit `88309597`; isolierter Test-Worktree
`/tmp/cernion-issue-850`, anschließend bytegleicher Delivery-Stand im vom Hook erlaubten
Worktree `/tmp/.worktrees/cernion-issue-850`. Beide Stände wurden jeweils neu indiziert.
Die Analyse erfolgte mit `impact --direction upstream` und Dateidisambiguierung.
Der ältere Index des ursprünglichen Checkouts wurde nicht für Änderungen verwendet.

| Symbol                            | Datei                                       | direkte Aufrufer | betroffene Prozessgruppen | Risiko       |
| --------------------------------- | ------------------------------------------- | ---------------: | ------------------------: | ------------ |
| noticeText                        | src/shared-service-notices.js               |                3 |                         1 | LOW          |
| eligibleNotices                   | src/shared-service-notices.js               |                1 |                         1 | LOW          |
| present                           | services/shared-service-notices.service.js  |                1 |                         1 | LOW          |
| canSee                            | services/shared-service-notices.service.js  |                2 |                         1 | LOW          |
| canSeeSignal                      | services/shared-service-notices.service.js  |                2 |                         1 | LOW          |
| propose                           | services/shared-service-agent.service.js    |                1 |                         1 | LOW          |
| choiceCandidates                  | src/capability-clarification.js             |                3 |                         1 | **CRITICAL** |
| runContentTurn                    | src/workbench-content-turn.js               |                1 |                         0 | LOW          |
| incomingDatasetReply              | src/workbench-content-turn.js               |                1 |                         1 | LOW          |
| turnDatasetIds                    | src/workbench-content-turn.js               |                1 |                         1 | LOW          |
| queuedContentTurn                 | src/workbench-content-turn.js               |                0 |                         0 | LOW          |
| answer                            | src/workbench-understanding.js              |                1 |                         1 | LOW          |
| answerPrompt                      | src/workbench-understanding.js              |                1 |                         1 | LOW          |
| filterAnswer                      | src/workbench-answer-filter.js              |                1 |                         1 | LOW          |
| internalToolText                  | src/workbench-tool-answer.js                |                0 |                         0 | LOW          |
| executeDatasetQuery               | src/dataset-query.js                        |                2 |                         0 | LOW          |
| selectDatasetCandidates           | src/dataset-routing.js                      |                0 |                         0 | LOW          |
| presentStructured                 | src/structured-message.js                   |                1 |                         0 | LOW          |
| buildFunctionModel                | scripts/generate-function-model.js          |                1 |                         0 | LOW          |
| saveUserMapping                   | src/workbench-store.js                      |                0 |                         0 | LOW          |
| metaForMapping                    | services/workbench.service.js               |                3 |                         1 | LOW          |
| handler (Mapping-Aktion)          | services/workbench.service.js               |                1 |                         0 | LOW          |
| applyMapping                      | src/workbench-provisioning.js               |                3 |                         0 | LOW          |
| functionDisplayLabel              | src/function-display-label.js               |                0 |                         0 | LOW          |
| generateChatPolishFixtures        | scripts/generate-conversation-fixtures.js   |                1 |                         0 | LOW          |
| createGapAdapter                  | tests/helpers/shared-service/gap-adapter.js |                0 |                         0 | LOW          |
| checkCore (Konfigurationswirkung) | scripts/check-domain-free-core.js           |                2 |                         0 | LOW          |
| validate                          | scripts/validate-rc3-closeout-live.js       |                5 |                         3 | **HIGH**     |
| validateConversation              | scripts/validate-workbench-813-live.js      |                1 |                         0 | LOW          |

`choiceCandidates` hat insgesamt 16 betroffene Symbole. Direkte Aufrufer sind
`confirmedCapability`, `choiceText` und `runContentTurn`. Die betroffenen Abläufe
umfassen Fallklassifikation, Funktionsauswahl und Inhaltsantworten. Die CRITICAL-Warnung
wurde vor der Änderung mitgeteilt. Der Katalog und die Auswahllogik bleiben strukturell
unverändert; nur die Ausgabe und deutsche Anzeigenamen ändern sich.

Die HIGH-Warnung für das Live-Skript wurde ebenfalls vor der Änderung mitgeteilt.
Betroffene Abläufe sind Inhaltsantworten, Workbench-Aktionen und Datensatzkatalogzugriffe.
Das Skript wurde nicht gestartet. Die zusätzlichen Hilfsfunktionen sind neue Symbole;
vor ihrer ersten Anlage gab es entsprechend keine indizierten Aufrufer. Ein erneuter
Impact-Aufruf auf den neu angelegten Entwurfshelfer meldete vor Neuindizierung UNKNOWN.

Vor jedem Commit wurde `detect_changes` für den gestagten Stand sowie als Vergleich gegen
`main` und `origin/main` ausgeführt. Der abschließende Gesamtvergleich gegen `origin/main`
meldet 42 Dateien, 87 Symbole, sechs betroffene Abläufe, Risiko **HIGH**. Der gestagte
Folgecommit meldet 15 Dateien, elf Symbole, keine zusätzlichen Abläufe und **LOW**.
Betroffen sind ausschließlich
die erwarteten Inhaltsantwort-, Fallklassifikations-, Funktionsauswahl- und
Workbench-/Datensatzabläufe einschließlich ihrer Generatoren und Abnahmeskripte.

Der vorgeschriebene Vergleich gegen den lokalen `main` meldet 221 Dateien, 1253 Symbole,
47 Abläufe und **CRITICAL**. Dieser lokale Branch steht noch auf `e1e039` und ist in
einem anderen Worktree ausgecheckt; er wurde nicht verändert. Der zusätzlich ausgeführte
Vergleich gegen den aktuellen Remote-Stand `origin/main` grenzt die Änderungen von #850
korrekt ab. Der PR enthält beide Befunde, einschließlich der HIGH-/CRITICAL-Warnungen.

Die neue gemeinsame Darstellungshilfe wurde vor ihrer ersten Anlage nicht als Symbol
gefunden; bestehende Aufrufer wurden jeweils vor ihrer Änderung geprüft. Für die
anonymen Test-Callbacks meldet GitNexus **UNKNOWN** ohne indizierte Aufrufer. Die
Teständerungen stellen deutsche, generierte Vorschlagstexte bereit und erhalten die
Annahme-, Ablehnungs- und Einmalzustellungsprüfungen.
