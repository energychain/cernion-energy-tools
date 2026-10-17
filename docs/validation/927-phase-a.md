# Validierung #927 — Phase A

Stand: 2026-10-17. Branch: `feat/927-mandantenwissen-a`.
Ausgangsstand: `d848c5e99e707abc8379f3c4b2fba82008a4d725` (`origin/main`).

## Umfang und Ergebnis

Chat-Dokumente und Chat-Datensätze bieten quellengebundene Deskriptoren an. Sie
verwenden dieselbe Registry, denselben Manifest-Vertrag, Selektor, autorisierten
Lesepfad und dieselbe Ausformulierung wie die Projektakte. Neue Quellen registriert
Phase B über `registerEvidenceSource`; Sitzungen/Teamgedächtnis sind hier noch keine
zusätzlichen Kandidaten. Es wurde kein weiterer persistierter Katalog eingeführt.

Deskriptorerzeugung läuft beim Speichern über `llm-client` und die Erzeugung,
Bereinigung, Ajv-Validierung und Minimal-Fallbacks aus #887. Gleichzeitig eintreffende
Anforderungen werden koalesziert. Bestehende Bestände werden bei relevantem Bedarf
nachgezogen. Lokale, begrenzte Anker aus Dokumentfeldern/Textspalten ermöglichen auch
Bezüge bei generischen Dateinamen; beobachtete Zellwerte bleiben aus Deskriptor- und
Routing-Prompts ausgeschlossen. Antwort-Evidenz stammt aus frischen Originalreads.

Standardgrenzen: `minScore=0.75`, `minMargin=0.15`, `minSubjectCoverage=1`,
`minContentCoverage=0.5`, `maxSources=8`; überschreibbar über bestehende
Manifest-Routing-Einstellungen und `workbench.settings.tenantEvidenceRouting`.
Gemeinsame Angebote benötigen denselben tatsächlich getroffenen deterministischen
Gegenstand. Andere Gegenstände bleiben Konkurrenten mit Mindestabstand.

Strukturelle Datensatzbindungen bleiben gültig. Der Scope erhält zusätzlich
`tenantEvidenceIds` aus autorisierter Deskriptorauswahl. Tenant, Clearance,
Projektmitgliedschaft und Herkunftsfall werden vor Kandidatenangebot bzw. Lesen
geprüft. Originalstatus, Hash, Deskriptorstand und personenbezogene Korrekturen werden
beim Lesen erneut kontrolliert. Reine Quellenverwaltung bleibt im bisherigen Pfad.

Antworten nennen tatsächlich gelesene Quellen mit verständlicher Herkunft. Ein
klar passender Upload schlägt den vorhandenen Fall sichtbar zur Fortsetzung vor;
`caseProposal` lässt sich über die bestehende `workbench.conversations.linkCase`
Aktion übernehmen. Bestehende Fälle werden nicht automatisch umgehängt oder
zusammengeführt. Evidenznutzung ist von diesem Vorschlag unabhängig.

`target: tenantEvidence`, `reject`/`confirm` und die Reaktion „passt nicht“ wirken
auf spätere automatische Angebote der jeweiligen Person. Korrekturen werden über
die Lernschleife auditiert und an der Quelle gespeichert; spätere Qualitätswrites
behalten neuere Korrekturen. Gemischte Projekt-/Chat-Angebote korrigieren zusätzlich
die Projektwahl über `projectManifest`.

Die gemeinsame Antwort nennt Übereinstimmungen/Abweichungen/Lücken aus gelesener
Evidenz. Zahlen werden global und je zitierter Quelle geprüft; unbelegte oder der
falschen Einzelquelle zugeschriebene Werte verwerfen die Ausformulierung. Aktuelle
Rückfallantworten gelangen nicht ins Fallgedächtnis; bekannte historische Rückfalltexte
werden aus der sicheren Projektion von `lastSafeConclusion` entfernt.

## Akzeptanzkriterien

| AC | Status Phase A | Nachweis |
| --- | --- | --- |
| AC-01 | Erfüllt als sichtbarer, korrigierbarer Fortsetzungsvorschlag | Dokument in Chat 1, Ablage der Tabelle in Chat 2 schlägt Herkunftsfall vor; unpassender Upload ohne Vorschlag |
| AC-02 | Erfüllt in Offline-Tests | Vollständige Workbench-Turns, mehrere explizite/paraphrasierte und anaphorische Fragen; beide Quellen genannt, Abweichung/Lücke, Herkunft; keine Fallübersicht |
| AC-02b | Erfüllt | Keine Abgleichs-Phrasenliste; Deskriptoren, deterministische Merkmale und schema-validierte Kontextauflösung |
| AC-03 | Erfüllt | Vollständiger Dokument-Fallback-Turn und Projektion historischer Falleinordnungen |
| AC-04 | Erfüllt | Gemeinsame Registry und Manifest-Selektor; gemischter Projekt-/Chat-Read und Korrektur über dieselbe Lernschleife |
| AC-04b | Erfüllt in Offline-Tests | Tenant-/Clearance-/Herkunftsfall-/Projektmitgliedschaft-Negativtests, frische Revalidierung, personenbezogene Korrektur und spätere Bestätigung |
| AC-05 | Fixture erledigt; Live-Nachweis offen | Generiertes Szenario `document-table`, „Dokument und Tabelle in getrennten Chats abgleichen“; Live-Lauf ausdrücklich durch die aufrufende Session |

Zusätzlich: umgekehrte Upload-Reihenfolge, Frage direkt am Upload, generische
Dateinamen mit lokal beobachteter Kennung, keine Zellwerte in Routing-/Deskriptor-
Prompts, bereinigte ungültige Modellreferenzen, Provider-Fallback, Koaleszierung,
Lazy-Backfill ohne Massenmigration, unveränderte Antwort ohne passende Angebote,
Quellenverwaltung sowie falsche Zahlenherkunft.

## Blast Radius und Impact-Analyse

Der erreichbare GitNexus-Index enthält die aktuellen Workbench-/Manifest-Symbole
nicht. `query`, `context` und die vorgängigen `impact(..., upstream)`-Aufrufe liefern
für diese Symbole fehlende Treffer/`UNKNOWN`; dies ist kein Nachweis eines kleinen
Blast Radius. Ergänzend wurde `grep -rn` über Quell-, Service- und Testaufrufer
verwendet. Manuelle Einstufung: **HIGH**, vor Änderungen kommuniziert.

Direkte Aufrufer sind insbesondere Workbench und Personal-Agent. Betroffen sind
Kandidatenangebote, Upload-Aufnahme, struktureller Datenscope, Originalreads,
Antwortausformulierung, Lernschleife und Fallgedächtnis. Datensatzberechnung und
Projekt-Zugriffsprüfungen bleiben bei ihren vorhandenen Implementierungen.
Regenerierte Funktionsmodell-Referenzen wachsen durch die gemeinsamen transitiven
Imports; die Zahl der Funktionen/Capabilities bleibt 107/172.

Das lokale `main` steht noch auf `e1e0395851423b7dcae882b5e8cf384b1baf626c`;
die tatsächliche Ausgangsbasis ist das oben genannte `origin/main`. Für die
Abschlussprüfung werden deshalb neben Worktree-/`main`-Analyse auch Änderungen
gegen `origin/main` getrennt betrachtet. Wegen des alten Index bleibt die zusätzliche
Diff-/Aufruferprüfung erforderlich.

Abschluss: Der erste gemeinsame Aufruf für Worktree/`main`/`origin/main` hing und
wurde beendet. Der erneute gestagte Aufruf und der Vergleich gegen `origin/main`
ermitteln jeweils **51 geänderte Dateien**, aber **0 erkannte Symbole/Prozesse** und
`risk_level: low`. Wegen der belegten Indexlücke wird diese Einstufung nicht als
Entwarnung verwendet; die manuelle HIGH-Einstufung bleibt bestehen. Ein separater
Vergleich gegen das ältere lokale `main` erreichte erneut das 20-Sekunden-Limit.

Ergänzende manuelle Abschlussprüfung: `git diff --cached --name-only`,
`git diff --cached --check`, Diff gegen `origin/main` und erneute `grep -rn`-
Aufruferprüfung. Die 51 Dateien gehören ausschließlich zu den beauftragten
Quellen-/Manifest-/Workbench-/Lern-/Fallpfaden, ihren Tests, Dokumentation und
regenerierten Artefakten. Keine unerwarteten Quellpfade oder anderen Worktrees.

## Checks

- Gesammelter Regressionslauf: 29 Suiten, 541 Tests bestanden; insbesondere
  Workbench, Rollen, Dokument-/PDF-Pfade, Datensätze, Manifest, Lernschleife und Praxis.
- Erweiterter gezielter Lauf: 13 Suiten, 311 Tests bestanden; nach ergänzten
  Ankertests: abschließend 12 Suiten / 188 Tests bestanden.
- Dossier-/Quellenabschluss: 4 Suiten / 78 Tests bestanden. Gemischter Projekt-/Chat-
  Pfad und Korrektur: zusätzlich 3 gezielt ausgewählte Tests bestanden.
- `test:shared-service:ci`: final 3 Suiten / 86 Tests bestanden, Harness 21,68 Sekunden.
- `test:e2e:shared-service`: Offline-HTTP-E2E bestanden, final 16,35 Sekunden.
- `test:tdd-matrix`: 3 Suiten / 82 Tests bestanden, 1 Suite / 4 Tests wie vorgesehen
  übersprungen. `check:tdd-matrix-coverage`: 66/66 aktive IDs, **100 %**;
  optionale Blackbox-MT-IDs nicht aktiviert. Der erste Gate-Aufruf ohne Artefakt
  wurde durch diesen Matrixlauf und einen erfolgreichen erneuten Gate-Aufruf behoben.
- Lint: 0 Fehler, 12 bestehende Warnungen in unveränderten Dateien; keine neuen
  ungenutzten Variablen. Scanner-Äquivalenz einschließlich Kontaminationsprobe bestanden:
  166 Dateien, 27.580 übereinstimmende Treffer, 77,98 Sekunden.
- Generiert: OpenAPI, Operation-Capability-Index, `llm.txt`, Funktionsmodell samt
  Reports/Lineage, Signalkatalog sowie Praxis-Fixtures.

| Abschließender Check | Ergebnis |
| --- | --- |
| `npm run lint` | Exit 0; 0 Fehler, 12 bestehende Warnungen |
| `npm run build` | Exit 0 (kein Buildschritt) |
| `npm run check:practice-fixtures` | Grün; synthetisch und synchron |
| `npm run check:domain-free-core` | Grün; keine Befunde, keine neuen Ausnahmen |
| `npm run check:domain-free-equivalence` | Grün; Kontaminationsprobe eingeschlossen |
| `npm run check:tdd-matrix-coverage` | Grün; aktive Matrix 100 % |
| `npm run check:function-model` | Grün |
| `npm run check:signal-catalog` | Grün |
| `npm run check:operation-capability-index` | Grün |
| `npm run check:llm` | Grün |
| `npm run audit:openapi` | 0 Fehler; 480 Warnungen |
| `git diff --check` | Grün |

Die gemeinsame Dossier-Anweisung unterscheidet auch im Personal-Agent registrierte
Chatquellen von Projektakten und sonstigen bestehenden Quellenarten. Beide Markdown-
Dossier-Varianten sind geprüft; der zusätzliche abschließende Dossier-Lauf umfasst
13 bestandene Tests.


## Bewusste Grenzen

Kein Live-LLM-/Live-Praxislauf und kein `npm run test:unit:ci`, wie beauftragt.
Der vollständige Unit-CI-Lauf und der Live-Praxisnachweis verbleiben bei der
aufrufenden Session. Ohne aussagekräftige Metadaten bzw. belastbare lokale Anker
bleibt die automatische Auswahl zurückhaltend. Quellen- und Passagebudgets sind
begrenzt; daraus folgt kein Anspruch auf Vollständigkeit eines umfangreichen Bestands.

Ältere Sitzungen, Fallzusammenfassungen, Turn-Memory und Teamgedächtnis als eigene
selbst anbietende Quellen folgen in Phase B. Der sichere Ausschluss von Rückfall-
Antworten aus bestehenden Falleinordnungen gehört bereits zu dieser Phase A.
