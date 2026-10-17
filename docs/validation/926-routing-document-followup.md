# Validierung #926: Akten-Routing und Dokument-Folgefragen

Stand: 2026-10-17; Folgeänderung zu `8c70e1cb` auf
`fix/926-unit-carryover`. Der von der aufrufenden Session erstellte Ausgangsbericht
`practice-evaluation-926-live-5.md` wird unverändert aufgenommen, SHA-256:
`ae6eb5945217fb8f0ff57438f171d7ad19a23b1bf1dcf7e8a958cb3c649fcf01`.
Sein Release-Gate bleibt ein roter Ausgangsbefund; er bewertet den Vorgängercommit.
Dieser Auftrag verwendet ausschließlich Modell-Stubs, keine Live-LLM-Aufrufe,
keine `.env`, keinen vollständigen Unit-CI-Lauf und keinen Push.

## Ursachen und Änderungen

Der vorgezogene `dataset.turn` lief unabhängig davon, ob eine Rückfrage offen war.
Damit verletzte er den #887-Vertrag, dass Aktenfragen vor dem Dataset-Turn geroutet
werden. Der gespeicherte Dataset-Kontext dient jetzt nur als Hinweis für eine
Statusprüfung. Erst eine im Tenant-Katalog tatsächlich offene Rückfrage mit
passendem Gespräch, aktivem Datensatz und aktueller Zielversion aktiviert den
vorgezogenen Turn. Beantwortete, fremde oder veraltete Rückfragen reichen dafür
nicht. Ohne Dataset-Kontext entfällt auch die zusätzliche Katalogprüfung. Das
bestehende Rückfragemodell und die Speicherung von Auswahl und Einheit bleiben
erhalten; allgemeine Korrekturen laufen weiterhin über ihren bisherigen Vertrag.

Beim Dokumentturn konnte `documentKnowledge.read` eine gerade hochgeladene
Originaldatei vor deren Ablage auf eine noch leere Dokumentbibliothek umlenken.
Katalog-Leseaktionen und Listen verdrängen jetzt keine angehängte Quelle. Bei
einem späteren bibliotheksseitigen Fehltreffer kann eine passende sichtbare
Gesprächsunterlage weiterhin die normale Dokumentantwort tragen. Eine ausdrücklich
genannte Referenz oder Version wird dabei nicht durch eine andere Quelle ersetzt.

Zusätzlich übersprangen `conversationShape` und die Antwortform des Vorturns die
Dokumentfrage zugunsten der allgemeinen Gesprächsantwort. Vorhandene Dokumente
beantworten die aktuelle Frage jetzt über die gespeicherten Abschnitte auch bei
`knowledge`, `assistance` oder `task`. Eine noch offene Zweckfrage behält ihren
Gesprächspfad; Reviews und Entwürfe behalten ihre bestehenden Wege. Eine nicht
verwendbare Dokumentantwort wird mit einem neutralen Hinweis und Degradationsstatus
ausgegeben.

Der bisherige Filter verglich einen Claim nur mit kompletten internen Feldern.
Ein einzelner Satz aus einem mehrsätzigen `situation` konnte dadurch erscheinen.
Der Filter prüft jetzt normalisierte Satzbestandteile gegen die tatsächlich
vorhandenen internen Texte; es gibt keine neue Phrasenliste. Rein interne Claims
werden entfernt und die vorhandene gezielte Antwortreparatur wird genutzt. Bleibt
auch diese rein intern, folgt die neutrale Rückfallantwort. Auch der direkte
Dokumentantwortpfad weist eine rein interne Beschreibung zurück. Unabhängig
belegte Quellenangaben und wörtliche Nutzerangaben behalten ihre bisherigen
Verträge.

## Regressionen und Arbeitsgrenze

Die vollständigen Turn-Tests prüfen:

- Akten-Routing ohne offenen Zustand, mit beantworteter Frage, anderem Gespräch
  oder veralteter Zielversion sowie Vorrang einer aktuellen offenen Blattwahl;
- Originaldatei im Dateikanal, nachgewiesene vollständige Ablage und Folgefrage
  über dieselben gespeicherten Abschnitte trotz abweichender Klassifikation und
  angenommener Katalog-Leseaktion;
- gezielte Reparatur separater interner Beschreibungssätze und neutralen Rückfall
  nach wiederholt internen Antworten;
- den bestehenden Zweckfrage-, Review-, Entwurfs-, Memory-, Dataset- und
  Einheitenfortführungsvertrag.

Neue Situations-Stubs werden gegen das exportierte `SITUATION_SCHEMA` mit Ajv
validiert. Der ältere Dokument-Überblickstest liefert nun auf das tatsächlich
verwendete Dokumentantwortschema eine passende Antwort; seine Assertions bleiben
erhalten.

GitNexus-Impact wurde vor Änderungen für `chat`, `documentReply`,
`documentFollowupResponse`, `filterAnswer`, `answer`, `resolveDatasetClarification`,
`command`, `documentQuestion`, `documentAnswer` und `runContentTurn` angefordert.
Der verfügbare Index findet diese Symbole nicht und liefert `UNKNOWN`. Manuelle
Einschätzung: **MEDIUM**; betroffen sind Chat-Routing, direkte Dokumentantworten
und der gemeinsame Antwortfilter. Die gezielt geprüften Verbraucher sind
Workbench, Projektmanifest, Dataset-Service und authentifizierter HTTP-Chat.
Tenant-/Sichtbarkeitsregeln und Rollen bleiben maßgeblich.
Eine zusätzliche Impact-Anfrage für `isInternalDescription` blieb ohne Antwort
und wurde nach Überschreiten des angeforderten Zeitbudgets abgebrochen.

Der konfigurierte Git-Hook-Pfad liegt außerhalb des erlaubten Worktrees. Für den
lokalen Commit werden Hooks deshalb mit `-c core.hooksPath=/dev/null` ausgeschaltet;
die angeforderten Checks werden ausdrücklich lokal ausgeführt. Der schon zu Beginn
vorhandene untracked Python-Cache bleibt außerhalb des Commits.

## Prüfungen

- Breite Serie: **25 Suites / 252 Tests grün**, 217,23 s, mit
  `NODE_OPTIONS=--experimental-vm-modules`. Enthalten sind die angeforderten
  Projektmanifest-, Tabellen-, Memory-HTTP-, Workbench-838-, Dokument- und
  Dataset-Tests sowie ergänzende Dateikanal-, Dokumentbibliotheks- und
  Antwortfiltertests.
- Abschlusslauf des korrigierten Routingtests: **15 Tests grün**, 55,66 s.
  Abschlussserie für Dokumente und Antwortfilter nach der letzten Änderung:
  **5 Suites / 51 Tests grün**, 9,50 s. Der zusätzliche Projektbezug wird dabei
  über die echte `project-file.update`-Aktion angelegt; ein künstlicher Bezug im
  Katalogeintrag wird zu Recht durch den aktuellen Aktenbezug ersetzt.
- `lint`: grün, 0 Fehler / 12 bestehende Warnungen. Gezielte Prüfung der elf
  berührten JavaScript-Dateien mit `no-unreachable-loop` und SonarJS
  `anchor-precedence` (S5850): grün. Prettier-Prüfung: grün.
- `check:practice-fixtures`, `check:domain-free-core`, `check:function-model`,
  `check:signal-catalog`, `check:operation-capability-index`, `check:llm`,
  `check:capability-keywords`, `check:quality-gate` und `build`: grün.
- `audit:openapi`: grün, 0 Issues / 480 bestehende Warnungen.
- `audit:security`: Gate grün, keine kritischen Befunde; bestehende nichtkritische
  Advisories einschließlich hoher Befunde bleiben ausgewiesen.
- `test:shared-service:ci`: grün, **3 Suites / 86 Tests**, 22,64 s;
  Harness-Gesamtzeit 24,10 s unter der 60-Sekunden-Grenze.
- `test:e2e:shared-service`: grün, einschließlich authentifiziertem HTTP-Chat,
  Gesprächskontext und internen Entwürfen; ausschließlich Stub-Fassade.
- `test:tdd-matrix`: grün, **3 Suites / 82 Tests**; vier optionale Tests
  übersprungen. `check:tdd-matrix-coverage`: grün, 66/66 erforderliche IDs, 100 %.
- `check:domain-free-equivalence`: grün, 157 Dateien einschließlich
  Kontaminationsfixture, 26.375 Treffer, 88,61 s.
- `export:openapi`, `generate:operation-capability-index`,
  `generate:function-model`, `generate:signal-catalog`,
  `generate:practice-fixtures` und `generate:llm`: ausgeführt.
- Artefaktabgleich nach der letzten Codeänderung sowie `git diff --check`: grün.

`detect_changes(scope="compare", base_ref="main", worktree=...)` wurde ausgeführt,
lieferte auch beim zweiten Versuch innerhalb von jeweils 15 Sekunden kein Ergebnis.
`detect_changes(scope="staged", worktree=...)` erfasst die erwarteten 19 Dateien
und meldet `LOW`, jedoch null zugeordnete Symbole bzw. Prozesse. Zusammen mit den
fehlenden Impact-Symbolen ist das kein belastbarer Prozessnachweis. Die 19 Dateien
und der kumulierte Umfang gegenüber `origin/main` wurden deshalb zusätzlich
manuell geprüft. `git diff --cached --check`: grün.
