# Validierung der Korrekturen nach Live-Praxislauf #926

Stand: 2026-10-17; Folgeänderung zu `eef393bb`, gleicher Worktree/Branch.
Auslöser: `practice-evaluation-926-live-1.md` (mit aufgenommen, unverändert).
Dieser Folgeauftrag verwendet ausschließlich LLM-Stubs. Kein erneuter Live-Lauf,
kein Push; `test:unit:ci` bleibt ausdrücklich bei der aufrufenden Session.

## Ursachen und Änderungen

- Der neue Korrekturklassifikator wurde vor jeder Folgefrage aufgerufen und
  konnte bekannte Spalteneinheiten als Nutzerkorrektur deuten. Das geschlossene
  Schema unterscheidet jetzt Fragen, Korrekturen und Antworten auf offene Fragen.
  Jede Änderung verlangt einen wörtlichen Beleg aus der aktuellen Nutzeräußerung.
  Ungültige/fehlende Klassifikation verändert nichts. Die bisherige heuristische
  Metadatenkorrektur umgeht diese Prüfung nicht mehr; der Löschpfad bleibt erhalten.
- `semantic.unitQuestion` speichert Felder, Zeitpunkt und Gespräch. Eine knappe
  Antwort kann nur eine dort offene Spalte beantworten; bestätigte Einheiten
  werden direkt über den bestehenden Auditpfad übernommen. Vollständig beantwortete
  Rückfragen erhalten `answeredAt`. Blattwahl begrenzt die Zuordnung auf das
  bestätigte Blatt. Mehrdeutigkeit erzeugt eine verständliche Datensatzauswahl.
- Ein gemeinsamer Einheitenhelfer erhält bekannte Klammerangaben aus Spaltennamen
  auch bei leeren/fehlerhaften Modellmetadaten und verwirft den jeweiligen
  Datentyp als Pseudo-Einheit. Abfrage und Rückfrage verwenden dieselbe Auflösung.
- Chat- und Aktentitel verwenden den Dateinamen der Quelle mit Blatt. Auswahltexte
  zeigen Titel/Version statt interner IDs.
- Die bestehende Qualitätsfragenerkennung erfasst auch die Verbform von Fehlwerten;
  die Antwort veröffentlicht den deterministisch abgefragten Leerwertbefund.

## Impact und Regressionen

GitNexus `impact(upstream)` wurde vor Eingriffen für `datasetCorrection`,
`unresolvedAnswerUnits`, `datasetSemantics`, `datasetTurn`, den Query-Handler,
`executeDatasetQuery`, `structureTable` und die berührten Testdateien angefordert.
Alle Ziele fehlen im vorhandenen Index (`Target not found`, `UNKNOWN`).
Ergänzende `grep -rn`-Referenzsuche: Dataset-Service und Workbench konsumieren die
Korrektur-/Abfragepfade; Chat und Projektstrukturierung teilen die Semantikhelfer.
Manuelle Einstufung **MEDIUM**: Korrekturabsicht, Quellenbezeichnung und Zahlenantworten
sind betroffen. Keine Gateway-, Tenant-, Rollen- oder Allowlist-Ausnahme.

Vollständige Workbench-Turns verwenden die generierten Praxis-Fixtures
`load-values` und `table-quality`. Der Stub liefert echte Frageklassifikationen,
bewusst falsche interne Titel und `number` als Einheit. Geprüft werden Folgefragen,
Referenzenergie, vier Leerwerte, Quellenzeile, zwei Blattnamen, Vergleich, Auswahl
ohne IDs, knappe Einheitenantwort mit/ohne Einleitung, gespeicherte Einheit und
einmalige auditierte Änderung. Ungebundene Antworten und aus Metadaten kopierte
Korrekturbelege verändern den Katalog nicht.

## Checks

- Betroffene Serie: 12 Suites/139 Tests abgedeckt; 11 Suites direkt grün.
  Ein HTTP-Stub wurde an die zusätzliche Absichtsprüfung angepasst; HTTP-Suite
  und neue Turn-Regressionen anschließend erneut grün (2 Suites/10 Tests).
- `lint -- --quiet`: grün, keine Fehler.
- `test:shared-service:ci`: grün, 3 Suites/86 Tests, 19,242 s.
- `test:e2e:shared-service`: grün, 15,22 s, ausschließlich Stub-Fassade.
- `test:tdd-matrix` und `check:tdd-matrix-coverage`: grün, 66/66 erforderliche
  IDs/100 %; optionale Blackbox-IDs weiterhin ausdrücklich optional.
- `check:practice-fixtures`, `check:domain-free-core`: grün, keine Befunde.
- `check:domain-free-equivalence`: grün, 155 Dateien einschließlich
  Kontaminationsfixture, 25.768 Treffer, 73,07 s.
- `check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm`: grün.
- `audit:openapi`: grün, 0 Issues/480 Warnungen.
- `git diff --check`: grün. Zusätzliche ESLint-Prüfung `no-unreachable-loop`
  (S1751-äquivalent) für sieben berührte Dateien: keine Befunde.
- `export:openapi`, `generate:operation-capability-index`, `generate:llm`,
  `generate:function-model`, `generate:signal-catalog`, `generate:practice-fixtures`
  nach den Änderungen ausgeführt; Artefakte sind synchron.

Der zusätzliche GitNexus-Vergleich gegen `main` hat nach 15 Sekunden kein Ergebnis
geliefert. Die manuelle Diff-Prüfung umfasst die erwarteten Produkt-, Test-, Doku-
und Generatoränderungen; die manuelle Risikoeinstufung bleibt MEDIUM.
`detect_changes(scope="staged")` erfasst 20 Dateien ohne zugeordnete Symbole/Abläufe;
das gemeldete `low` ist wegen des unvollständigen Index kein belastbarer Risikonachweis.
Globale und Praxis-Domänen-Allowlists unverändert; keine neue Umgebungsvariable.

Der vollständige Unit-Lauf und ein weiterer Live-Praxislauf sind ausdrücklich
nicht Bestandteil dieses Folgeauftrags. Der mitgelieferte rote Live-Bericht
bleibt als unveränderter Ausgangsbefund erhalten.
