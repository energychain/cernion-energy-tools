# Validierung nach zweitem Live-Praxislauf #926

Stand: 2026-10-17; Folgeänderung zu `dadbf16c` im selben Worktree/Branch.
Der unveränderte Ausgangsbericht `practice-evaluation-926-live-2.md` wird mit aufgenommen.
Keine Live-LLM-Läufe, kein `test:unit:ci`, kein Push. Den Vollauf und erneuten
Live-Nachweis übernimmt die aufrufende Session.

## Ursachen und Änderungen

- `incomingDatasetReply` wählte die Varianten bereits aus, `readTurnDataset`
  rief danach aber `dataset.query` ohne IDs auf. Dessen zweiter Modellselektor
  konnte die Quellen verwerfen. Ohne Evidenz fiel der nächste Turn in
  `runContentTurn` → `understanding.answer` → `generateAnswerResult` zurück.
  Modellabsätze in `interpretation` wurden über `filterAnswer`/`answerBody`
  dargestellt; der bisherige Wortlautfilter erkannte nicht jede Wiederholung der
  internen Lagebeschreibung. Es gab keine direkte Zuweisung von `concern` an
  `responseText`, sondern eine unzureichend gefilterte Modellwiederholung.
- `queryDatasetVariants` führt die bereits ausgewählten Einzelabfragen mit IDs
  aus und verwendet `compareDatasetResults`. Derselbe Helfer dient Service und
  Workbench. Vorherige Tabellenquellen und strukturgleiche Varianten bleiben für
  Vergleichsfragen im bestehenden Scope erhalten, auch bei leerem Selektor.
- `datasetContext` speichert Datensatzbezug, offene Auswahl und letztes Einzelobjekt
  im vorhandenen Gesprächsspeicher. Eine eindeutige Blattantwort auf die offene
  Auswahl wird aus den Kandidaten zugeordnet, auch wenn das Modell sie anders
  klassifizieren würde. Bestätigte Auswahl und Einheiten bleiben unabhängig vom
  Retrieval-Verlauf nutzbar. Eine Zählabfrage darf im nachfolgenden Variantenvergleich
  nicht verhindern, dass veröffentlichte Datensummen eine Einheitenfrage auslösen;
  dafür wird der vorhandene Einheitenhelfer gemeinsam verwendet.
- Eine bereits durch die Workbench auf das letzte Objekt bezogene nackte Korrektur
  behält ihr serverseitiges Datensatz-Ziel. Bei fehlendem Korrekturinhalt folgt eine
  gezielte Semantikrückfrage, ohne ältere Aussagen anzufassen. Neuere Aussagen
  behalten den Vorrang. Keine Korrektur wird aus einer gewöhnlichen Frage abgeleitet.
- Der Antwortfilter verwirft Kopien des internen `concern`-/`situation`-Kontexts,
  einschließlich zusammengefügter Kopien, anhand ihrer Herkunft. Wörtliche aktuelle
  Nutzerangaben oder belegte Quellen bleiben zulässig. Keine neue Phrasenliste.

## Impact

GitNexus `impact(upstream)` vor Änderungen für Korrektur, Auswahl, Dataset-Turn,
Query-Handler, Workbench-Chat, `readTurnDataset`, `turnDatasetIds`,
`incomingDatasetReply`, `selectDatasetCandidates`, `filterAnswer`,
`generateAnswerResult` und den berührten Test-Stub: alle Ziele im vorhandenen
Index unbekannt (`Target not found`, `UNKNOWN`). Ergänzende `grep -rn`-Suche:
Dataset-Service, Workbench-Turn und generische Antwortfilter sind betroffen.
Manuelles Risiko **MEDIUM**. Tenant-/Konversations-Scope und Rechteprüfungen
bleiben erhalten; keine Gateway- oder Rollenausnahme, keine Allowlist-Änderung.
Keine neue Umgebungsvariable.

## Regressionen und Checks

Gezielte Vorprüfungen sind grün, einschließlich des unveränderten Vertrags
`tenant-memory.http` für nackte Korrekturen. Die vollständigen neuen Turn-Tests
erzwingen falsche Auswahlklassifikationen (`metadata`/`question`), leere Selektoren,
Zählpläne und nachträglichen Verlust des Retrieval-Verlaufs. Sie prüfen getrennte
Blätter, 40/44 und Differenz 4, gespeicherte Blattwahl, knappe Einheitenantwort und
40 kg im Folgeturn; die freie Antwortgenerierung wird dabei nicht verwendet.
Der zusätzliche Filtertest erhält belegte Fakten und entfernt interne Kontextkopien.

- Betroffene Serie: 16 Suites/300 Tests abgedeckt, 15 Suites direkt grün. Der
  verbliebene Projektvergleich prüfte den unveränderten JSON-Vertrag: eine nur
  intern verwendete Zuordnungs-ID wurde aus `comparisons` entfernt, ohne den Test
  zu lockern. Projekt-, Mehrturn- und Tenant-Memory-Serie danach grün:
  3 Suites/23 Tests, 27,525 s.
- `test:shared-service:ci`: grün, 3 Suites/86 Tests, 21,687 s.
- `test:e2e:shared-service`: grün, 16,28 s, ausschließlich Stub-Fassade.
- `test:tdd-matrix`/`check:tdd-matrix-coverage`: grün, 66/66 erforderliche IDs,
  100 %; optionale Blackbox-IDs unverändert optional.
- Zusätzliche S1751-äquivalente ESLint-Prüfung `no-unreachable-loop` für zehn
  berührte Dateien: keine Befunde.
- `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
  `generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`
  wurden nach den Codeänderungen ausgeführt.
- Abschließender `lint -- --quiet`, `check:practice-fixtures` und
  `check:domain-free-core`: grün, keine Fehler/Domänenbefunde.

- `check:domain-free-equivalence`: grün, 155 Dateien einschließlich
  Kontaminationsfixture, 25.897 Treffer, 81,43 s.
- `check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm`: grün, Artefakte synchron.
- `audit:openapi`: grün, 0 Issues/480 Warnungen.
- `git diff --check` und abschließende Prüfung des gestagten Diffs: grün.

Der zusätzliche GitNexus-Vergleich gegen `main` lieferte innerhalb von 15 Sekunden
kein Ergebnis; ergänzende manuelle Git-Diff-Prüfung durchgeführt.
Auch `detect_changes(scope="staged", worktree=...)` blieb bei der Abschlussprüfung
ohne Antwort und wurde nach rund einer Minute ohne Ergebnis beendet. Der gestagte
Diff enthält die erwarteten 19 Dateien; die manuelle Einstufung bleibt MEDIUM.
Der vorhandene Python-Testcache war bereits bei Beginn untracked und bleibt
unverändert außerhalb des Commits.
