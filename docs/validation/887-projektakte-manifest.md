# #887 — Projektmanifest im Routing

Stand: 16.10.2026. Branch: `feat/887-projektakte-manifest`.
Keine Live-Modellaufrufe, kein `release:practice`, kein Push oder PR.
Alle neuen Modelltests verwenden einen Stub für `src/llm-client.js`.

## Implementierung und Entscheidungen

- Neuer `project-manifest`-Dienst und capabilitygeschützter Adapter im vorhandenen
  Object Store; Ajv-Vertrag einschließlich gültiger Knotenreferenzen für jede Aussage.
  Zusammenfassung als `{ text, sources }`, damit auch sie explizite Herkunft besitzt.
- Erzeugung bei neuer abgeschlossener Graphquellversion/Kantenkorrektur, koalesziert
  je Tenant/Akte. Snapshot und Veröffentlichung sind serialisiert, der Modellaufruf
  liegt außerhalb des Aktenlocks. Vor Veröffentlichung erneute Versions-/Rechteprüfung.
- Explizite Metadatenprojektion statt Übernahme beliebiger Profile/Graphattribute:
  keine Rohzeilen, Zellbeispiele, Entitätswerte, SQL-Sketches oder Dokumentvolltexte.
  128000 Bytes Promptbudget, zehn Sekunden, keine Modellretries.
- Additiver Kandidatenanbieter am Evidenzendpunktkatalog, Auswahl in
  `dataset-routing.selectProjectCandidates`, bedingter Zusatzpfad in `workbench.chat`
  nach dem bestehenden Upload-/Dataset-Turn. Derselbe Lesepfad liefert Dossierbelege;
  beide Dossierformate erhalten Auswahl-/Herkunftsanweisungen. Keine Änderung an
  `workbench-data-scope`, statischen Katalogeinträgen oder Gateway-RBAC.
- Automatische Auswahl: vollständige Bezugsphrase mit zwei relevanten Wörtern,
  mindestens zwei Fragetypwörter einschließlich eines zusätzlichen Sachworts,
  mindestens 0,5 Beschreibungsdeckung, mindestens 0,15 Abstand zur nächsten Akte.
  Kein Fallback auf einzige/neuste Akte und kein Auswahlmodellaufruf pro Turn.
- Sichtbar: „Ich habe dafür die Projektakte ‚…‘ herangezogen.“ Jede Aktenzahl kommt
  anschließend aus `dataset.query` oder einer neu gelesenen Passage mit Datei,
  Fundstelle und Originalhash. Manifesttexte werden nicht als Evidenz übernommen.
- Gemischte Fragen: Akten-Teilfrage wird separat abgefragt; das Wort „Katalog“ im
  externen Zusatz darf nicht den bestehenden Dataset-Katalogmodus auslösen.
  Join-Schlüssel aus begrenzter SQLite-Aggregation, aktuelle Graphkante,
  Katalogoperation ohne Konsequenz/Schreibeffekte, reguläre Read-Policy und
  Schlüsselbestätigung im Ergebnis. Herkunft je Quelle getrennt.
- `projectManifest`-Korrekturen sind auf aktuellen Akteur/Tenant begrenzt und nutzen
  Audit und Event der bestehenden Lernschleife. Andere Korrekturziele behalten ihre
  bisherige Adminprüfung. Keine Gateway-Ausnahme und keine tenantweite Mutation
  durch eine persönliche Auswahlkorrektur. „falsche Akte“ und „Fragetyp falsch“
  werden nach einer Auswahl erkannt und beeinflussen spätere Turns.
- Keine neuen Umgebungsvariablen; `.env.example` bleibt unverändert.

## Impact und Regression

GitNexus-`impact` wurde vor den Änderungen aufgerufen. Der erreichbare Index kennt
die Dossier-Builder, aber noch nicht die aktuellen Workbench-/Projekt-/Lernsymbole.
Diese UNKNOWN-Ergebnisse sind **kein** Nachweis eines kleinen Eingriffs; lokale
Aufrufsuche mit `grep -rn`/`rg` ergänzt die Analyse.

Für `buildDossierMarkdown` meldet der Index einen direkten Aufrufer; für
`buildSlimDossierMarkdown` zwei direkte Abhängigkeiten, jeweils im Personal-Agent-Pfad.
Die Dossier-Action und der Workbench-Chat bleiben der zentrale Blast Radius.
Weitere Änderungen betreffen die Graph-Eventmetadaten, Object-Store-Mixins und den
neuen Korrekturzieltyp. `safeOutput` wird lediglich zusätzlich exportiert und vom
neuen Katalogpfad wiederverwendet. Seine bisherige Implementierung bleibt unverändert.
Das Gesamtrisiko wurde vor der Bearbeitung ausdrücklich als HIGH kommuniziert.

Ohne installierten Manifestdienst oder passende/sichtbare Kandidaten liefert der
neue Pfad kein Ergebnis; bestehende Routing-/Antwortpfade laufen weiter.
Neue Tests prüfen leere Tenants, unpassende Gegenstände, Mehrdeutigkeit,
unveränderte Routingkandidaten und die persönliche Korrektur im nächsten Turn.
Die einzige geänderte bestehende Testerwartung ist die ausdrücklich erweiterte
Praxis-Kataloggröße: 118 statt 88 Wiederholläufe.

## Akzeptanzkriterien

| AC | Stub-/Integrationsevidenz |
| --- | --- |
| AC-01 | Ajv-Schema, Pflichtfelder, alle Claimarten mit gültigen `nodeId`s, ungültige Referenzen/Skills/Duplikate abgewiesen; Graphereignis und Versionen |
| AC-02 | Echter Chunk-Ingest → Strukturierung → Graph → Manifest → Workbench-Chat → akteneigene SQLite; sichtbare Auswahl sowie Dateiname/Fundstelle/Hash |
| AC-03 | Zwei generierte Fachdomänen mit wirklicher synthetischer Leseoperation; numerische Referenzwerte und getrennte Herkunft; Schreibeffekte, fehlende Rechte, fehlende Kante und mehrdeutige Schlüssel abgewiesen |
| AC-04 | Fehlendes Jahr ohne Querytreffer → konkrete Lücke ohne geschätzte Ersatzgröße; ungültige/veraltete Originale und Schemas ohne Evidenz |
| AC-05 | Fremder Tenant, fehlende Clearance/Mitgliedschaft, `ingesting`, Archivierung, leere Akte und fehlgeschlagene Löschung liefern keine Kandidaten |
| AC-06 | Spionierte zentrale LLM-Fassade; Sentinel in Zellen, Beispielen, Entitätslabels und zusätzlichen Attributen fehlt im Manifestprompt |
| AC-07 | Bestehender Domänenfrei-Gate plus zusätzliche Prüfung sämtlicher neuen Kernmodule gegen unverändertes Vokabular; generiertes `llm.txt` synchron |

Zusätzlich: kein Modellaufruf bei unverändertem Graph, koaleszierte Anforderungen,
veraltete Manifeste nach fehlgeschlagener Neugenerierung unsichtbar, Recovery ohne
Doppelgenerierung, Archivierung während ausstehendem Modellaufruf blockiert
Veröffentlichung, bestätigte wiederholbare Löschung aller Manifestversionen.

## Praxis-Evaluation und Live-Vorbereitung

Zehn generierte Szenarien: `project-a-implicit`, `project-a-mixed`, `project-a-gap`,
`project-a-unrelated`, `project-a-correction` und dieselben fünf mit `project-b`.
Neutral benannte Akten „Projekt A“/„Projekt B“, zwei voneinander unabhängige
Datendomänen: Messreihe an „Standort Nord“ in kW und Bestand „Depot West“ in kg.
Keine importierten Personen-, Organisations- oder Kundendaten.

Der lokale Praxistransport erzeugt Originale, durchläuft den echten Upload und alle
Ableitungen und ruft den zentralen Manifestgenerator auf. Ein ausschließlich im
Testharness bereitgestellter Katalog liefert die externen Referenzwerte. Die
Bewertung prüft Abfrageherkunft, sichtbare Auswahl, Hash/Fundstelle, getrennte
Katalogevidenz, konkrete Lücken und wirksame Korrektur. Fehlende Manifeste werden
nicht durch Sollantworten ersetzt. Cleanup verwendet `project-file.delete` und die
registrierten bestätigten Handler. Die bisherigen Praxis-Rubriken gelten weiter.

Vorbereitet ist der **lokale** vollständige Praxislauf mit 37 Szenarien und 118
Wiederholläufen, 337 Turns plus Rubrikbewertungen und zusätzlicher Aktenvorbereitung.
Die bestehenden Modell-/Tokenbudgets gelten unverändert. Laufzeit und Geldkosten
werden erst im autorisierten Live-Lauf gemessen. Der HTTP-Transport weist die neuen
Szenarien explizit ab, weil dort der isolierte synthetische Lesekatalog fehlt.
Vorhandene HTTP-Diagnoseszenarien funktionieren weiterhin; eine gefilterte Serie
gilt unverändert nicht als vollständiges Release-Gate.

Der aufrufenden Session bleibt vorbehalten, nach Rücksprache den lokalen
`release:practice`-Lauf auszuführen. Hier wird **kein grünes Live-Praxis-Gate behauptet**.

## Allowlist und Folgeissues

Die globale Domain-Free-Allowlist ist unverändert. Nur das unabhängige, feste
`practice-synthetic-vocabulary.js` erhält die neutralen neuen Fixturewörter und
Strukturschlüssel; der Generator erweitert die Freigabe weiterhin nicht selbst.
Neue OpenAPI-Taxonomie: `Project manifest` → `platform`.

#888: komplexere Auswertungen und mehrwertige/zusammengesetzte Joins; heute konkrete
Lücke bei nicht eindeutiger Bindung. #889: Skill-Erzeugung und Befüllung von
`skillRefs`; hier bewusst leere Liste.

## Ausgeführte Checks

| Prüfung | Ergebnis |
| --- | --- |
| `npm run lint -- --quiet` | grün |
| `npm run build` | grün, regulärer No-op |
| Neue Manifesttests | 36 Tests, grün; einschließlich echter Akten-SQLite, Workbench-Mehrturn und zwei Praxis-Domänen mit LLM-Stub |
| Neue/berührte Projekt-/Praxisdateien | gezielter Lauf: 137 Tests grün; weitere hinzugefügte Negativ-/Metadatenfälle separat und in der vollständigen CI grün |
| `npm run test:unit:ci` | grün: 24 Blöcke, 466 Suites / 10247 Tests bestanden; 7 Suites / 54 Tests regulär übersprungen |
| Coverage | Statements 84,10 %, Branches 70,33 %, Functions 88,36 %, Lines 85,87 %; alle Gates grün |
| `npm run test:shared-service:ci` | grün: 86 Tests; 25,81 s unter der 60-s-Grenze |
| `npm run check:practice-fixtures` | grün; generierte Ausgabe synchron und synthetisches Vokabular geprüft |
| `npm run check:domain-free-core` | grün; zusätzlich alle neuen Kernmodule mit unveränderter Allowlist geprüft |
| `npm run check:domain-free-equivalence` | grün: 150 Dateien einschließlich Kontaminationsfixture, 25170 Treffer äquivalent |
| `npm run test:tdd-matrix` | grün: 82 Tests bestanden, 4 optionale Tests übersprungen |
| `npm run check:tdd-matrix-coverage` | grün: 66/66 erforderliche T-* IDs, 100 %; zwölf optionale MT-* Blackbox-IDs bewusst nicht live ausgeführt |
| `npm run check:function-model` | grün |
| `npm run check:signal-catalog` | grün |
| `npm run check:operation-capability-index` | grün |
| `npm run check:llm` | grün |
| Finale LLM-Manifesttests nach README-Ergänzung | 7 Tests grün; `llm.txt` erneut erzeugt und synchron geprüft |
| `npm run audit:openapi` | 0 Issues; 480 Warnungen des Audits, keine neue Manifestwarnung |
| GitNexus `detect_changes` | für gesamten Diff, Vergleich mit `origin/main` und vorgemerkten Diff ausgeführt; 44 Dateien, drei bekannte Codesymbole sowie README-Abschnitte; Basename-Kollisionen melden zusätzliche tatsächlich unveränderte README-Dateien, daher manueller Git-Diff maßgeblich |
| `git diff --check` / vorgemerkter Diff | grün |

OpenAPI, Operation-Capability-Index, `llm.txt`, Funktionsmodell samt Berichten,
Signalkatalog und Praxis-Fixtures wurden nach der letzten Codeänderung erneut erzeugt.
Die vollständige grüne Unit-CI lief anschließend bei eingefrorenen, per Prüfsummen
kontrollierten Quellen/Artefakten. Ein früherer Lauf wurde nach zwei
Determinismusfehlern während gleichzeitiger Quellen-/Artefaktaktualisierung beendet;
die isolierte Funktionsmodell-Datei bestand danach alle 39 Tests und die vollständige
Wiederholung war grün. Bestehende Tests wurden dafür nicht abgeschwächt.

Nach dem vollständigen Unit-Lauf wurden nur die README-Featurezeile und dieser
Bericht ergänzt. Das daraus aktualisierte `llm.txt` wurde separat neu erzeugt und
mit den sieben LLM-Manifesttests und `check:llm` geprüft. Produktcode und übrige
generierte Artefakte blieben per Prüfsummen unverändert.

Branch und getrennte Git-/Common-Verzeichnisse des Worktrees sind geprüft.
Der lokale Commit enthält ausschließlich die Umsetzung, Tests, Dokumentation und
generierten Artefakte. Kein Push, kein PR und kein Live-Praxislauf.
