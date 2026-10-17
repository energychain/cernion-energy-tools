# #925 Teil 2 — Eigene Rollenkorrektur vor Gedächtnis-Korrektur

Stand: 2026-10-17. Branch: `fix/925-role-correction`.
Ausschließlich Offline-Stubs und synthetische Daten; kein Live-LLM-Lauf,
kein vollständiger Unit-CI-Lauf und kein Push.

## Ursache und Reihenfolge

Der bereitgestellte Live-Auszug zeigt bei `correct-role` die Antwort
„Welche festgehaltene Aussage meinst du?“ und anschließend den alten Arbeitskontext.
Die internen Klassifikationen dieser Live-Läufe liegen nicht vor.

Die relevante Reihenfolge in `workbench.chat` war bereits:

1. Datei-/Hintergrundbehandlung, gespeicherten Gesprächszustand lesen.
2. `readRoleUpdate`: ausschließlich die Präferenzextraktion auf eine eigene Rolle prüfen.
3. Offene Datensatzrückfrage und Projektmanifest.
4. Erster Gedächtnis-Präturn, gegebenenfalls nur für Abfragen.
5. Datensatz-Turn mit dem bisherigen Bezug auf den zuletzt genannten Datensatz.
6. Zweiter Gedächtnis-Präturn einschließlich allgemeiner Korrektur.
7. Fallverknüpfungs-/Funktionskorrektur und normales Inhaltsrouting.
8. Im Inhaltsturn: vollständiges Verstehen, danach semantische Gedächtniskorrektur.

Die frühe Erkennung aus Schritt 2 entsprach damit nicht der normalen
Selbsterkennung: Diese führt die Rollenangaben aus primärem Verstehen und
Präferenzextraktion zusammen und prüft sie nach der weiteren Klassifikation.
Wenn die Präferenzextraktion keine Rolle lieferte, konnte Schritt 6 den Turn
beenden, bevor eine im primären Verstehen erkennbare Selbstkorrektur drankam.

## Änderung

Bei gespeichertem Arbeitskontext führt `readRoleUpdate` nun das normale
`understand` mit demselben Modell, Codekatalog, bereinigtem Gesprächsverlauf,
Tenant-Glossar und bereits extrahierten Präferenzen aus. Persistente Teile des
vorigen Lagebilds und der separat gespeicherte Arbeitskontext werden übernommen.
Nach Ablauf des Lagebilds erhalten die benötigten Referenzlisten leere Anfangswerte.
Eine beigefügte Unterlage verhindert den frühen Rollencheck nicht mehr.

Die bestehende gemeinsame Regel bleibt maßgeblich: Selbstsubjekt, erste Person
oder eine passende offene Rollenfrage, wörtliche Basis und darin belegte Rollenfelder.
Widersprechende Fremd-/Mischsubjekte bleiben geschützt. Es gibt keine neuen
Korrektur-, Rollen- oder Domänenphrasenlisten.

Nur bei einer so belegten Aktualisierung gewinnt der Inhaltsturn vor beiden
Gedächtnis-Präturns. Er übernimmt das bereits geprüfte Lagebild, statt es erneut
zu klassifizieren. Die bestehende Antwortmontage speichert den Arbeitskontext
und bestätigt Rolle, Auftrag und Ziel sichtbar. Folgeantworten erhalten diesen
gespeicherten Kontext. Ohne belegte eigene Aktualisierung bleibt die Reihenfolge
der bisherigen Korrekturziele erhalten.

Dieser Vorcheck benötigt bei vorhandenem Rollenkontext das vollständige Verstehen.
Bei einer erkannten Rollenänderung wird dessen Ergebnis wiederverwendet; andere
Turns können nach dem unveränderten Vorrouting erneut ins normale Verstehen gelangen.
Ein neuer Live-Nachweis einschließlich Providerlatenz bleibt der aufrufenden Session vorbehalten.

## Reproduktion und Regressionen

Die vollständigen Mehrturn-Tests benutzen echte synthetische Unterlagen sowie echte
Object-Store-/Gedächtnis-Dienste. Jeder Modell-Stub wird gegen das tatsächlich
übergebene Schema und das lokale Situationsschema validiert.

Drei neue Varianten liefern die eigene Korrektur nur im primären Rollenfeld,
während die Präferenzextraktion keine Rolle meldet. Die Klassifikationen variieren
zwischen Gedächtniskorrektur, Wissensfrage und Arbeit; `roleOnly=false` verhindert
eine zufällige Normalisierung durch eine reine Rollenmitteilung.
Auf dem unveränderten Ausgangscode scheiterten alle drei Varianten exakt mit
„Welche festgehaltene Aussage meinst du?“ (3 rot, 18 grün).

Auf dem korrigierten Code prüfen sie sichtbare Bestätigung, unmittelbar gespeicherte
Rolle/Auftrag/Ziel, keinen Aufruf des Gedächtnis-Präturns für die eigene Korrektur,
genau einen primären Verstehensaufruf sowie den korrigierten Kontext im tatsächlichen
Antwort-Prompt des Folgeturns. Weitere Varianten decken abgelaufenes Lagebild und
beigefügte Unterlage ab. Die bestehende Mehrturn-Sequenz prüft weiterhin den Schutz
für Dritte sowie unveränderte Profile, Rechte und Gesprächs-/Tenant-Grenzen.

`tenant-memory.http.test.js` prüft über authentifiziertes HTTP weiterhin
„korrigier das“ für die zuletzt genannte Aussage beziehungsweise den zuletzt
genannten Datensatz, jeweils mit und ohne vorhandenen Rollenkontext.

## Wirkungsanalyse

GitNexus-Query, Context und Upstream-Impact wurden vor Änderungen für Rollenhelfer,
Verstehen, Inhaltsturn, Chat-Handler und Testhelfer aufgerufen. Der Index kennt diese
Symbole nicht (`UNKNOWN`); ein unspezifischer `chat`-Treffer betraf andere Dateien
und wurde verworfen. Kein Index außerhalb dieses Worktrees wurde verändert.

Die ergänzende Referenzprüfung zeigt als direkte Laufzeitkette
`workbench.chat` → `readRoleUpdate` → `understand` sowie
`workbench.chat` → `queuedContentTurn` → `runContentTurn`.
Betroffen sind Rollenrouting, Inhaltsturn, Dokumentantwort und die Entscheidung,
ob die bestehenden Korrekturpfade aufgerufen werden. Manuelles Risiko: **mittel**.
Die Implementierungen von Gedächtniskorrektur, Datensatzkorrektur, Berechtigungen
und Gateway werden nicht geändert.

`detect_changes(scope=compare, base_ref=main)` wurde mit explizitem Worktree
aufgerufen, lieferte jedoch kein Ergebnis und wurde beendet. Der lokale `main`
liegt 271 Commits hinter dem Ausgangsstand; `origin/main..HEAD` enthielt zu Beginn
keine Commits. Der lokale Diff gegen den Ausgangsstand ergänzt den unvollständigen
Graphnachweis.
Auch `detect_changes(scope=all)` mit explizitem Worktree lieferte innerhalb von
30 Sekunden kein Ergebnis. Eine vollständige Graphanalyse ist daher nicht belegt.

## Abschließende Offline-Abnahme

| Prüfung | Ergebnis |
| --- | --- |
| Betroffene Regressionen, finaler vollständiger Lauf | **23 Suites / 982 Tests grün**, einschließlich Rollenpfad, authentifiziertem Gedächtnis-HTTP, #874, #873, #813, Dokument-/Reviewfluss, Gesprächs-/Turnzustand und Praxis-Evaluation. |
| Fokussierter Lauf nach Ergänzung des Ablauf-Falls | 4 Suites / 117 Tests grün. |
| `lint` | 0 Fehler, 12 bestehende Warnungen außerhalb der Änderungen. |
| S1751 / S5850 / S2871 | 0 Fehler auf den vier geänderten JavaScript-Dateien; ESLint `no-unreachable-loop` sowie SonarJS `anchor-precedence` und `no-alphabetical-sort`. |
| `test:shared-service:ci` | 3 Suites / 86 Tests grün, 20,36 Sekunden. |
| `test:e2e:shared-service` | Grün, 14,37 Sekunden; Offline-Fassade. |
| `test:tdd-matrix` | 82 Tests grün, 4 bestehende Tests übersprungen. |
| `check:tdd-matrix-coverage` | 66/66 erforderliche IDs, 100 %; optionale Blackbox-IDs unverändert ausgenommen. |
| `check:domain-free-core` | Keine Funde, keine neuen Ausnahmen; einschließlich Kommentare. |
| `check:domain-free-equivalence` | Grün, 158 Dateien einschließlich Kontaminationsfixture, 26.661 Treffer. |
| `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`, `check:llm` | Grün. |
| `check:capability-keywords`, `check:practice-fixtures`, `check:quality-gate` | Grün. |
| `build` | Grün, vorgesehener No-op. |
| `audit:openapi` | 0 Fehler, 480 bestehende Warnungen. |
| `audit:security` | Repo-Gate grün, keine kritischen Findings; vorhandene High-/Moderate-Advisories bleiben ausgewiesen. |
| `git diff --check` | Grün. |

Artefakte wurden mit `export:openapi`, `generate:operation-capability-index`,
`generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`
und `generate:llm` neu erzeugt. OpenAPI, Operationsindex und Praxis-Fixtures bleiben
inhaltlich unverändert. Funktionsmodell, Berichte, Signal-Katalog und `llm.txt`
enthalten die aktualisierten Quellbezüge beziehungsweise Fingerabdrücke.

Alle Jest-Läufe liefen seriell mit `NODE_OPTIONS=--experimental-vm-modules` und
ersetzter LLM-Fassade. Der vollständige Unit-CI-/Coverage-Lauf und eine neue
Live-Praxisabnahme wurden wie vorgegeben nicht gestartet.
