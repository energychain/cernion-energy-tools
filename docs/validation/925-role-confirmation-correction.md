# #925 — Nachtrag: sichtbare Bestätigung und Rollenkorrektur

Stand: 2026-10-17. Ausgangscommit: `6d397fb6`.
Die aufrufende Session meldet Unit-CI auf diesem Stand als grün. Der bereitgestellte
[Live-Bericht 2](practice-evaluation-925-live-2.md) wird unverändert mit aufgenommen
(SHA-256 `c4f80edd00b87b3a0815e571e63614394c93e2cbd3e8df50ba26929dba55f5bf`).
Er bewertet den Ausgangsstand, nicht diesen Nachtrag: Rollenablauf in der Rubrik
12/12, aber deterministisch fehlende Bestätigung und gescheiterte Rollenkorrektur;
representation, minutes-instruction und file-question jeweils 12/12.

## Ursachen

1. Die bisherige Bestätigung wurde ausschließlich in `understanding.answer()` bei
   `roleOnly=true` ohne Artefaktbestellung erzeugt. Eine Dokumentantwort umgeht
   diesen Pfad; eine abweichende Klassifikation als zusätzliche Sachfrage unterdrückt
   ihn ebenfalls. Die Bestätigung war somit trotz gespeichertem Kontext nicht garantiert.
2. Die allgemeine Gedächtnis-Korrektur wurde vor der Antwortmontage ausgeführt,
   auch wenn `applyRoleContext()` bereits eine eigene Rollenänderung erkannt hatte.
   Bei leerem Aussagebezug lieferte sie „Welche festgehaltene Aussage meinst du?“
   und beendete den Turn vor der Speicherung. Bei bestimmten Korrekturbitten konnte
   schon der vorgeschaltete Gedächtnispfad den Turn übernehmen.
3. Folgeturns bekamen deshalb den alten gespeicherten Kontext. Die bestehenden Tests
   hatten stets `roleOnly=true` und keine echte Gedächtnis-Verfügbarkeit kombiniert;
   die fehlerhafte Weiterleitung blieb darin unsichtbar.

## Änderungen und Grenzen

- Nach erfolgreichem `saveTurn()` erzeugt die Antwortmontage den Vorspann aus dessen
  gespeichertem `conversationContext` mit Rolle, Auftrag und Ziel. Er steht vor jeder
  normalen Antwort, einschließlich Dokumentantworten. Eine schon vorhandene identische
  Bestätigung wird entfernt, sodass sie genau einmal erscheint. Interne Situationstexte
  und freie Modellformulierungen liefern diesen Vorspann nicht.
- Bei vorhandenem Gesprächs-Arbeitskontext prüft die bestehende schema-validierte
  Präferenzextraktion die aktuelle Nachricht vor Gedächtnis- und Datensatz-Routing.
  Ausschließlich strukturelles Selbstsubjekt, erste Person bzw. passende gespeicherte
  Rollenrückfrage und wörtlich belegte Rollenfelder geben dem normalen Rollen-Turn Vorrang.
  Das Extraktionsergebnis wird beim Verstehen wiederverwendet. Ohne belegte eigene
  Rollenänderung läuft die bisherige Weiterleitung weiter; keine Korrektur-Phrasenliste.
- Eine nach allen Klassifikationen bestätigte eigene Rollenänderung wird auch innerhalb
  des Content-Turns vor einer versehentlichen Gedächtnis-Korrektur/-Abfrage geschützt.
  Dritte und gemischte Subjekte behalten den vorhandenen Personenschutz.
- Der Kontext bleibt im nach Tenant, Akteur, Kanal und Gespräch getrennten
  Conversation-Dokument. Berechtigungen, erlaubte Domänen, Clearance und Gateway-Regeln
  werden nicht geändert. Der Review-Lebenszyklus bleibt unverändert.
- Das generierte Szenario und seine deterministischen Regeln bleiben unverändert:
  `own-role` fordert „richte mich“, Rolle und Auftrag; `correct-role` zusätzlich den
  korrigierten Fokus. Folgefragen verlangen weiterhin Fundstellen. Die einmal im Live-Lauf
  fehlende Abschnittsangabe wird nicht durch eine abgeschwächte Prüfung kaschiert.

## Impact und Abnahme

GitNexus-Query und Upstream-Impact wurden vor Änderungen ausgeführt. Der verfügbare
Index kennt die Workbench-Symbole und Route nicht (`UNKNOWN`); Referenzsuche ergänzt
die Analyse. Eingriffe betreffen Rollen-Hilfsmodul, Chat-Weiterleitung, Verstehen und
Content-Turn-Antwortmontage sowie den Antwort-Prompt. Risiko: mittel, mit Auswirkungen
auf Dokumentantworten und Gedächtnis-Korrekturen. Die bestehenden Fach-, Berechtigungs-
und Review-Regeln bleiben außerhalb der Änderung.

Vor dem Commit wurden `detect_changes(scope=all)` und der verlangte Vergleich
`detect_changes(scope=compare, base_ref=main)` mit explizitem Worktree gestartet.
Beide lieferten innerhalb der begrenzten Wartezeit kein Ergebnis; die wartende Anfrage
wurde beendet. Der lokale `main` liegt zudem 264 Commits hinter dem Ausgangs-HEAD;
sein Vergleich würde auch historische Änderungen umfassen. Der aktuelle Commitumfang
wurde deshalb zusätzlich direkt mit `git diff HEAD`, gestagter Dateiliste und
`git diff --cached --check` geprüft. Eine vollständige GitNexus-Flussanalyse liegt
für diesen Nachtrag nicht vor.

Vollständige Mehrturn-Tests verwenden echte synthetische Dokumente, echte Object-Store-
und Gedächtnis-Dienste sowie gegen das tatsächliche Provider- und lokale Situationsschema
validierte Modell-Stubs. Varianten umfassen fehlende primäre Rollenerkennung,
Personen-Fehlklassifikation, `roleOnly=false`, allgemeine Gedächtnis-Korrekturklassifikation,
frühe Korrekturweiterleitung, abgelaufenen Kurzzeitzustand und parallel laufendes Review.
Sie prüfen die unveränderten Praxisregeln, Bestätigung am Antwortanfang, Speicherung,
korrigierten Kontext im Dokument-/Antwort-Prompt, Personenschutz und unveränderte Rechte.
Die HTTP-Regression für „korrigier das“ läuft mit und ohne vorhandenen Rollen-Kontext
und prüft symmetrisch Aussage bzw. zuletzt genannten Datensatz.

Ein Offline-Gegenlauf mit den vier unveränderten Laufzeitmodulen aus `6d397fb6`
(`workbench.service`, `workbench-content-turn`, `workbench-role-context`,
`workbench-understanding`) und den neuen Mehrturn-Tests reproduziert beide Fehler:
zwei fehlgeschlagene Tests, jeweils am erwarteten Bestätigungsvorspann.
Bei `roleOnly=false` erscheint nur die Dokumentantwort; bei früher Rollenkorrektur
erscheint „Welche festgehaltene Aussage meinst du?“. Die Module wurden danach
bytegleich auf den neuen Arbeitsstand zurückgesetzt. Derselbe Stub bleibt vollständig
offline und schema-valide; keine vermutete Live-Providerursache wird behauptet.

## Abschließende Offline-Checks

Alle folgenden Prüfungen sind grün:

- 21 betroffene Suites / 947 Tests; abschließend 4 fokussierte Suites / 118 Tests
  auf dem fertigen Code, jeweils mit `NODE_OPTIONS=--experimental-vm-modules` und ohne
  globale Coverage-Gates.
- `test:shared-service:ci`: 3 Suites / 86 Tests, 23,3 Sekunden; `test:e2e:shared-service`.
- `test:tdd-matrix`: 82 Tests, 4 explizit übersprungen; `check:tdd-matrix-coverage`:
  66/66 erforderliche IDs (100 %), optionale Blackbox-IDs weiterhin übersprungen.
- `lint` (0 Fehler, 12 bestehende Warnungen außerhalb geänderter Zeilen), `build`.
- `check:practice-fixtures`, `check:domain-free-core`, `check:domain-free-equivalence`.
- `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`,
  `check:llm`, `check:capability-keywords`, `check:quality-gate`.
- `audit:openapi`, `audit:security` (bestehende Abhängigkeitsbefunde bleiben ausgewiesen),
  `git diff --check`.
- Artefakte mit `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
  `generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`
  neu erzeugt; bei unverändertem Inhalt ergibt sich kein Dateidiff.

AC-01 bis AC-04 sind durch Offline-Turn-/HTTP-Tests abgedeckt. AC-05 behält das
generierte Szenario mit unveränderten Erwartungen; ein neuer Live-Nachweis steht aus.
Der Ausgangsbericht enthält außerdem einen deterministisch roten `file-question`-Lauf
trotz Rubrik 12/12; dieser Altbefund wird durch die hier grünen Offline-Regressionen
nicht als live behoben erklärt.

Kein Live-LLM-Lauf, kein `.env`-Zugriff, kein `test:unit:ci`, kein Push.
Die erneute Live-Abnahme einschließlich Rubrikbewertung bleibt der aufrufenden Session.
