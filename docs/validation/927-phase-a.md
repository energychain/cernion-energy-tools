# Validierung #927 — Phase A

Stand: 2026-10-17. Branch: `feat/927-mandantenwissen-a`.
Ausgangsstand: `d848c5e99e707abc8379f3c4b2fba82008a4d725` (`origin/main`).

## Nachprüfung nach Commit `7d8dcf39`

Die aufrufende Session hat vollständige Unit-CI und Live-Praxisprüfung ausgeführt.
Der unveränderte Bericht [practice-evaluation-927-live-1.md](practice-evaluation-927-live-1.md)
gehört zu `7d8dcf39` und dokumentiert ein **rotes** Release-Gate. Die nachfolgenden
Korrekturen sind ausschließlich offline geprüft; ein erneuter Live-Nachweis ist offen.
Die weiter unten stehenden Erstimplementierungsnachweise bleiben als Verlauf erhalten.

### Reproduzierte Ursachen und Korrekturen

- Deskriptoren wurden beim Katalog-/Dokument-Write sowie beim Nachziehen synchron
  über das Modell erzeugt. Mehrere Upload-/Qualitätswrites verbrauchten dadurch im
  Harness zusätzliche Turn-Tokens. Jetzt wird sofort ein deterministischer Minimal-
  Deskriptor gespeichert; die Anreicherung läuft separat, koalesziert und begrenzt.
  `tests/dataset-quality.service.test.js` bleibt unverändert; kein Budget wurde erhöht.
- Die Ausformulierung verlangte Gegenüberstellungen nur im Prompt. Bei unvollständiger
  oder durch die Zahlenprüfung verworfener Prosa blieb eine Aneinanderreihung von
  Einzelauszügen. Jetzt werden wörtlich belegte Werte derselben benannten Größe und
  Einheit zusätzlich deterministisch gegenübergestellt, mit Datei/Fundstelle je Seite.
  Gemeinsame Werte, unterschiedliche Zahlenangaben und die noch ungeklärte Bezugsbasis
  bleiben auch bei ungültiger Prosa und bei einem Modell-Quota-Hinweis sichtbar.
  Dieselbe Zahlennormalisierung dient der Ausformulierung und Gegenüberstellung.
- Generierte Entitäten konnten den Größenbegriff in den Gegenstand aufnehmen und
  dadurch beim Scoring das passende Abschnitts-/Spaltenmerkmal aufzehren. Vorhandene
  deterministische Gegenstandsmerkmale begrenzen diese Subtraktion nun; Schwellen
  und Relevanzabstand werden nicht abgesenkt. Ein kompletter Turn mit frischem Anker
  und der Entität „Bestand Objekt Nord“ reproduziert diesen Fall.
- Die Bezugserkennung sah nur Uploads des aktuellen Gesprächs. Nun sind auch die
  zuvor tatsächlich gelesenen Quellen und die letzte Inhaltsfrage Teil ihres
  Metadatenkontexts. Nur weiterhin sichtbare aktuelle Kandidaten sind zulässig;
  anschließend erfolgen derselbe Selektor und frische Originalreads. Eine bestätigte
  Inhaltsreferenz wird nicht erneut von einem zweiten Inhaltsklassifikator verworfen.
  Der aufgelöste Gegenstand wird auch beim Lesen genutzt. So entsteht im Folgeturn
  weder ein neuer Fall noch eine unnötige Frage nach den bereits bekannten Unterlagen.
- Die generische Ausgabeprüfung aus #926 greift jetzt auch auf Manifest-Prosa;
  interne Beschreibungen der Anfrage werden auch innerhalb einer gemischten Antwort
  verworfen. Die Regeln betreffen ausschließlich Ausgaben, nicht die Quellenwahl.
- Das Praxis-Fixture akzeptiert „Abgelegt“ oder „gespeichert“: Die beobachtete Antwort
  bestätigt die Speicherung bereits ausdrücklich und nennt den Dokumentinhalt.
  Dafür ist kein neuer Ablage-Sonderpfad erforderlich.

Hintergrundbudget je Quellendienst: 64 wartende Aufträge, ein aktiver Auftrag,
Standardabstand 30 Sekunden (`settings.tenantEvidenceEnrichment.delayMs`),
16.000 Byte projizierte Metadaten, ein Modellversuch, maximal 1.200 Ausgabetokens
und 5 Sekunden Modellzeit. Die Tenant-Quota gilt unverändert. Inaktive Aufträge
werden beim Shutdown verworfen, aktive abgewartet. Vor Persistenz werden Hash und
Metadatenstand geprüft; bestehende Datensatz-Mutationsqueues bzw. Dokument-Serialisierung
schützen neuere Qualitätsdaten, Korrekturen und Löschungen. Ein Neustart benötigt
keine Migration: Bei relevantem Bedarf kann die Anreicherung erneut angeboten werden.

### Nachprüfungsumfang und Grenzen

Geändert werden Workbench-Quellenkontinuität, gemeinsames Manifest-Scoring,
Ausformulierung/Ausgabefilter sowie Deskriptor-Writes von Datapoint und Dokumentbestand.
Die Quellenregistry für Phase B, `tenantEvidenceIds`, Schutzprüfungen und Auswahlgrenzen
bleiben bestehen. GitNexus-Impact vor Änderungen: aktuelle Symbole überwiegend nicht
im Index (`UNKNOWN`), `datapoint.created` ohne erkannte Aufrufer (`LOW`). Ergänzende
`grep -rn`-Suche und manuelle Prüfung ergeben weiterhin **HIGH** für Upload-/Antwort-
und Gesprächspfade; diese Einstufung wurde vor Änderungen kommuniziert.

AC-01/02/02b/03/04/04b sind offline abgesichert. AC-05 bleibt bis zur erneuten
Live-Prüfung der aufrufenden Session offen. Die alten Live-Rotpunkte werden nicht
nachträglich als grün erklärt. Kein Live-Modelllauf, keine Unit-Voll-CI, keine
Credentials/`.env`, keine globalen Installationen, kein Push.

### Abschließende Checks dieser Nachprüfung

- Mehrchat-/Zahlen-/Budget-Abschluss: **3 Suiten / 35 Tests grün**. Enthalten sind
  die vollständigen Turns mit mehreren Formulierungen, unvollständiger/interner Prosa,
  zuletzt gewählter Quellengruppe, variierenden Entitäten, Minimal-Deskriptoren,
  Hintergrund-Korrektur/Löschung sowie der unveränderte Budget-Regressionsfall.
- Weitere betroffene Regressionspfade: **14 Suiten / 212 Tests grün**;
  Projektakten-Routing separat **16 Tests grün**. Manifest-/Hintergrund-/Prosa-
  Nachprüfung **3 Suiten / 56 Tests grün**. Die Läufe überschneiden sich bewusst.
- Shared-Service-CI: **3 Suiten / 86 Tests grün**, Harness 20,08 Sekunden.
  Shared-Service-HTTP-E2E: **grün**, 15,76 Sekunden; ausschließlich Stub-Fassade.
- TDD-Matrix: **3 Suiten / 82 Tests grün**, 1 Suite / 4 Tests wie vorgesehen
  übersprungen; Coverage-Gate **66/66 aktive IDs = 100 %**.
- Lint: **0 Fehler, 12 bestehende Warnungen**. Zusätzliche gezielte ESLint-Prüfung
  für unerreichbare Schleifen sowie Sonar-Anker-/Sortierregeln: keine Befunde.
- Grün: Build, Praxis-Fixture-Synchronität, Domain-Free-Core und Scanner-Äquivalenz,
  Funktionsmodell, Signalkatalog, Operation-Capability-Index, `llm.txt`, Capability-
  Keywords, Qualitätsgate und OpenAPI-Audit (**0 Fehler, 480 bestehende Warnungen**).
- OpenAPI, Operation-Capability-Index, `llm.txt`, Funktionsmodell samt Reports,
  Signalkatalog und Praxis-Fixtures wurden neu erzeugt. Funktionsmodell und
  Signalkatalog wurden nach dem letzten Quellwechsel gemeinsam erneut abgeglichen.
- `git diff --check`: grün. GitNexus-Abschlussprüfung siehe unten.

GitNexus `detect_changes(scope: staged)` erfasst die 31 Dateien dieser Nachprüfung,
aber nur einen alten Index-Treffer (`datapoint.stopped`), keine betroffenen Prozesse;
`risk_level: low` ist wegen der Indexlücke keine Entwarnung. Der Vergleich gegen
`origin/main` erfasst 61 Dateien einschließlich Erstimplementierung, denselben einen
Symboltreffer und keine Prozesse. Der zusätzlich vorgeschriebene Vergleich gegen das
veraltete lokale `main` erreichte das 20-Sekunden-Limit. Manuell wurden gestagte
Dateiliste/Diff, `git diff origin/main`, `grep -rn`-Aufrufer und beide Diff-Checks
geprüft; die Änderungen entsprechen den oben genannten Quellen-/Antwortpfaden,
Tests, Dokumentation und generierten Artefakten. Keine unerwarteten Quellpfade.

## Erstimplementierung auf `7d8dcf39`

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
