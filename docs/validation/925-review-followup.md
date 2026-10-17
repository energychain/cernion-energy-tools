# #925 — Nachtrag: Dokumentreview und Einarbeitung

Stand: 2026-10-17. Ausgangscommit: `9f3bb790`.
Die aufrufende Session meldete den Unit-CI-Lauf auf diesem Ausgangsstand als grün.
Dieser Nachtrag wurde ausschließlich mit Offline-Stubs geprüft: kein neuer Live-Lauf,
keine `.env`, kein `test:unit:ci`, kein Push.

## Live-Ausgangsbefund

Die von der aufrufenden Session bereitgestellten Berichte werden unverändert aufgenommen:

- [Rollenablauf, Live 1](practice-evaluation-925-role-live-1.md): 3 Wiederholungen,
  jeweils 4/12; alle Folgeturns wurden durch Reviewstatus verdrängt.
- [Regressionen, Live 1](practice-evaluation-925-regression-live-1.md): governance,
  mail-thread und file-question jeweils 12/12; representation 11,67/12.
  Der bestehende Personenschutz aus #874 war im Ausgangsstand intakt.

Diese Berichte bewerten den Ausgangscommit, nicht den vorliegenden Fix.
Eine neue Live-Abnahme des korrigierten Szenarios bleibt der aufrufenden Session vorbehalten.

## Ursachen und Nachweis auf origin/main

1. `isReviewRequest()` verwendete `prüf\w*`. Das trifft auch den synthetischen
   Referenzanker `Prüfbezug…` in der äußeren Einarbeitungsbitte. Deshalb wurde der
   231-Zeichen-Arbeitsstand als Prüfauftrag behandelt, obwohl Überblick und Rollenklärung
   bestellt waren. Das ist keine Eigenschaft des eigentlichen Praxisbefunds.
2. `documentFollowup()` gab bei einem vorhandenen laufenden oder fertigen Reviewjob
   unabhängig von der aktuellen Frage dessen Status/Ergebnis zurück. Rollenangaben,
   Korrekturen, Folgefragen und Aussagen über Dritte erreichten das normale Verstehen nicht.
3. Das 45-Sekunden-Budget begann erst in `reviewDocuments()`, nach dem vorgeschalteten
   Verstehen und der Recherche in `reviewRetrieval()`. Ein hängender Verstehensaufruf
   lag vollständig außerhalb des Budgets. Der äußere Catch loggte außerdem nur Fehler;
   unerwartete Ausnahmen und Speicherfehler konnten den gespeicherten Job auf `running`
   belassen. Bei fehlendem lokalem Taskhandle wurde derselbe Auftrag später erneut gestartet.
4. Der Praxis-Transport wartet zwischen den normalen Folgeturns nicht auf einen
   Reviewabschluss. Die bisherigen Reviewtests warteten dagegen vor Ergebnisabfragen
   auf `workbenchDocumentReviews`. Der Live-Lauf konnte daher alle Folgeturns absenden,
   während erst der vorgeschaltete Modellaufruf lief. Eine Lösung darf das Harness nicht
   künstlich auf Reviewabschluss warten lassen.

Der Fehler ist bereits auf **origin/main `5da85e90997c8d7b2ecdbd6d30ebcee584c5b3c4`**
vorhanden. Vor der Änderung wurden die drei Module `workbench-document-input`,
`workbench-document-flow` und `workbench-review` mit `git show origin/main:<Pfad>`
bytegleich zum Worktree verifiziert. Ein temporärer vollständiger Workbench-Turn-Test
spielte danach exakt das bisherige Rollen-Fixture ab, mit einem blockierten,
anschließend kontrolliert freigegebenen Verstehens-Stub. Ergebnis: erster Turn Review
für 231 Zeichen, danach fünfmal ausschließlich `pending`. Vor Freigabe war genau
**ein** Modellaufruf erfolgt. Der Offline-Nachweis ist als
[synthetisches Ergebnisprotokoll](925-review-main-reproduction.json) gespeichert.

Ein zweiter Offline-Lauf lud die drei unveränderten Module direkt über `git show`
aus `origin/main` und das ursprüngliche Fixture aus `9f3bb790`. Alle Modellantworten
wurden gegen das tatsächlich übergebene Schema validiert. Wieder waren alle fünf
Folgeturns `pending`; nach Freigabe des verzögerten Verstehensaufrufs wurde das Review
mit einer Map- und einer Reduce-Anfrage **erfolgreich abgeschlossen**. Die abschließende
explizite Ergebnisfrage lieferte `completed` für alle 231 Zeichen. Auch dieser Verlauf
steht im Ergebnisprotokoll. Der Fehler benötigt also keinen fehlgeschlagenen Job:
Der schnelle Dialog erhält Status, während das Ergebnis erst später entsteht.

Der Live-Bericht enthält keine Job-/Fehlertelemetrie. Ob der konkrete Provideraufruf
jenes Live-Laufs später beendet wurde oder scheiterte, lässt sich daraus nicht belegen.
Die Reproduktion beweist die Blockade und die unbegrenzte Vorphase; zusätzliche Tests
weisen die Fehlerfälle separat nach. Es wird kein bestimmter Live-Schema-/Quotenfehler behauptet.

## Produktfix

- Die Anfrageerkennung akzeptiert die bestehenden Prüfverbformen und das eigenständige
  Wort „Prüfung“, keine beliebigen Wortzusammensetzungen mit diesem Stamm. Es gibt keine
  Sonderbehandlung des synthetischen Ankernamens und keine Rollen-Phrasenliste.
- Das vorhandene monotone Deadline-Hilfsmittel begrenzt nun den gesamten Hintergrundjob
  einschließlich Verstehen und Recherche. Der Job speichert `startedAt`, `deadlineAt`,
  `runId` und den Dokumentumfang. Verbleibendes Budget wird an die eigentliche Prüfung gegeben.
- Fehler und Zeitüberschreitungen werden mit einem terminalen `failed`-Zustand,
  unterscheidbarem Ergebnisstatus und kurzer ehrlicher Meldung gespeichert. Verwaiste
  Jobs werden als unterbrochen beendet; sie starten nicht still erneut. Speicherkonflikte
  werden begrenzt wiederholt. Laufkennung und terminaler Zustand schützen vor späten Updates.
- Nur ausdrückliche Ergebnis-/Statusanfragen erhalten den Reviewstatus. Andere Turns
  laufen durch das normale Verstehen. Der Status bleibt auch nach zwischenzeitlicher
  Orientierung oder Rollenbestätigung abrufbar. Eine angehängte neue Dokumentgrundlage
  wird bestätigt, ohne normale Fragen in den alten Reviewzustand umzuleiten.
- Reine eigene Rollenmitteilungen und Personenschutz werden vor einer Dokumentantwort
  behandelt. Dokumentfragen erhalten `conversationContext` und Gesprächspräferenzen
  im Antwort-Prompt. Dadurch wirken Rolle und Korrektur auch bei tatsächlich gespeicherten
  Dokumenten. Berechtigungs-, Gateway- und Tenant-Grenzen bleiben unverändert.

Das Abbruchbudget beendet die Lebenszyklus-Promise auch bei einem blockierten Provider.
Ein bereits laufender Provideraufruf kann technisch später zurückkehren; er darf dann
keine nachfolgende Reviewphase beginnen und keinen terminalen Jobzustand überschreiben.

## Szenario und Tests

Der Einstieg verlangt jetzt ausdrücklich einen **kurzen Überblick zur Einarbeitung**
mit anschließender Rollenrückfrage. Der generierte Anker bleibt erhalten: Der Produktfix
muss korrekt zwischen Referenz und Prüfauftrag unterscheiden. Die übrigen fünf Turns
und ihre Prüfziele bleiben erhalten: eigene Rolle, rollenbezogene Folgefrage, Korrektur,
korrigierter Folgefokus und Personenschutz für Dritte.

Die bisherigen Rollentests wurden von bloßer Collector-Evidenz auf tatsächliche
Dokumentübergabe im vollständigen Workbench-Turn umgestellt. Eine zusätzliche Variante
führt die gesamte Sequenz bei parallel blockiertem Review aus. Die Dokumentantwort-Stubs
prüfen den tatsächlich übergebenen Arbeitskontext und gespeicherte Abschnitte.
Normale Modellantworten sind gegen Provider- und Situationsschema validiert; ausschließlich
für den gezielten Schemafehler-Test wird absichtlich eine ungültige Map-Antwort geliefert.

Neue vollständige Turn-Tests prüfen Zeitüberschreitungen bei Vorphase, Map und Reduce,
Schema-/Quoten-/unerwartete Fehler, einen Fehler beim Ergebnisschreiben, verwaiste und
abgelaufene Jobs, späte Ergebnisse und unabhängige Rollen-/Dokumentfragen.

## Impact und Validierung

GitNexus-Impact wurde vor den Eingriffen für Dokumentfluss, Reviewstatus, Darstellung,
Dokumentantwort, Anfrageerkennung, Testhelfer und Praxisgenerator aufgerufen. Der Index
enthält diese Symbole nicht (`UNKNOWN`); ein Treffer für `complete` betraf ein anderes
Modul und wurde nicht als Nachweis verwendet. Ergänzende `grep -rn`-Referenzprüfung:
Dokumentfluss → normaler Workbench-Inhaltsturn und Dokumenttests; Dokumentantwort →
Dokumentfluss und bestehende Antworttests; Deadline → Reviewengine und neuer Jobrahmen.
Manueller Blast Radius: **MEDIUM**, Dokumentrouting und Review-Lebenszyklus.

`detect_changes({scope: "compare", base_ref: "main"})` wurde vor dem Commit ausgeführt.
Wie im Ausgangsbericht meldete der veraltete Vergleich `CRITICAL` für 127 Dateien,
265 Symbole und 64 Prozesse; diese Warnung wurde dem Nutzer ausdrücklich berichtet.
Das lokale `main` liegt 263 Commits hinter dem Ausgangsbranch. Der lokale Diff gegen
`9f3bb790` wurde deshalb zusätzlich geprüft; enthalten sind ausschließlich der
Reviewfix, das angepasste Szenario, Tests, Doku/Live-Belege und regenerierte Artefakte.
Keine Änderungen an Authentifizierung, Berechtigungen, Gateway oder LLM-Fassade.

| Prüfung | Ergebnis |
| --- | --- |
| Main-Reproduktionen | Zweimal 1 vollständiger Turn-Test grün; ursprüngliche Blockade und anschließender erfolgreicher Abschluss belegt. Temporäre Tests entfernt, synthetisches Protokoll erhalten. |
| Betroffene Regressionen | **19 Suites / 879 Tests grün**, einschließlich 16 Rollenkontext- und 10 Lifecycle-Tests, Review-/Dokumentfluss, HTTP, #874, #873, #926 und Praxis-Evaluation. |
| `lint` | Grün: 0 Fehler, 12 bestehende Warnungen außerhalb der geänderten Zeilen. |
| `test:tdd-matrix` | Grün: 82 Tests bestanden; 4 bestehende Tests übersprungen. |
| `check:tdd-matrix-coverage` | Grün: 66/66 erforderliche IDs, 100%; optionale Blackbox-IDs unverändert. |
| `test:shared-service:ci` | Grün: 86 Tests; 22,8 Sekunden. |
| `test:e2e:shared-service` | Grün: 16,8 Sekunden, Offline-Fassade. |
| `build` | Grün (No-op). |
| `check:practice-fixtures` | Grün; Zusätzliche neutrale Wörter explizit geprüft und freigegeben. |
| `check:domain-free-core` | Grün, keine Funde und keine neuen Ausnahmen. |
| `check:domain-free-equivalence` | Grün. |
| `check:function-model` | Grün. |
| `check:signal-catalog` | Grün. |
| `check:operation-capability-index` | Grün. |
| `check:llm` | Grün. |
| `check:capability-keywords` | Grün. |
| `check:quality-gate` | Grün. |
| `audit:openapi` | Grün. |
| `audit:security` | Grün gemäß Repo-Gate, keine kritischen Findings; vorhandene High-/Moderate-Advisories unverändert. |
| `git diff --check` | Grün. |

Regeneriert: `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
`generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`.
OpenAPI und Operationsindex bleiben inhaltlich unverändert. Alle Jest-Läufe liefen
seriell mit `NODE_OPTIONS=--experimental-vm-modules` und synthetischen Daten.

Die beiden bereitgestellten Live-Berichte wurden nicht bearbeitet. SHA-256:

- Regression: `f23667fcedb5b9b6e13935f2f5fa1b74c9afc82f2a21a351afff1a9e1bf51191`
- Rollenablauf: `112d2d0c478c508a22039db71a25a103a139cd3be0b004e398d4929fae76d0e6`

Offen bleibt ausschließlich die erneute Live-Praxisabnahme durch die aufrufende Session.
Der gemeldete grüne Unit-CI-Lauf bezieht sich auf `9f3bb790`; auf diesem Fixstand wurde
wie vorgegeben kein vollständiger Unit-CI-Lauf gestartet.
