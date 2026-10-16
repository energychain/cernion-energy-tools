# #887 — Projektmanifest im Routing

Stand: 16.10.2026. Branch: `feat/887-projektakte-manifest`.
Keine Live-Modellaufrufe, kein `release:practice`, kein Push oder PR.
Alle neuen Modelltests verwenden einen Stub für `src/llm-client.js`.
Der von der aufrufenden Session bereitgestellte
[Live-Bericht](practice-evaluation-887-live-1.md) wird unverändert mitgeführt;
dieser Live-Lauf wurde nicht vom implementierenden Agenten ausgeführt.

## Fix nach Live-Praxislauf auf `c1fcebfc`

### Diagnose (a): Reihenfolge im vollständigen Turn

Reproduktion vor der Korrektur über die echte `workbench.chat`-Action mit Upload,
Strukturierung, Graph, Manifestdienst, Datasetdienst, Gedächtnis, Domain Router und
Workbench. Stub ausschließlich an der zentralen LLM-Fassade, nicht an Chat-Action,
Verstehen, Auswahl oder Lesepfad. Das Verstehen liefert `knowledge` bzw. `work`
und eine blockierende Rückfrage nach Datenquelle/Zeitraum. Die Manifestbeschreibung
lautet sinngemäß „größter dokumentierter Messwert einer archivierten Reihe“, die
Entität „Nördliche Niederlassung“ statt „Standort Nord“.

Aufgezeichnet vor dem Fix:
`workbench.chat → dataset.turn → project-manifest.candidates → understanding`.
Die generische Verstehen-/Rückfrageantwort kommt in diesen Praxisfragen **nicht**
vor dem Aktenversuch; sie folgt auf die erfolglose Auswahl. Dateibefehle,
Hintergrundaufgaben, der priorisierte Gedächtnisaufruf und `dataset.turn` konnten
allerdings schon vorher antworten. Ein zusätzlicher Test mit einer tatsächlich
gespeicherten Gedächtnisaussage belegt diesen früheren Rückgabeweg. Sichere
Aktenantworten werden jetzt vor diesen generischen Gedächtnis-/Datasetpfaden
geprüft; explizite Datei-/Tabelleneingaben bleiben vorrangig.

### Diagnose (b): Manifestparaphrasen

Die Fixture ist vorhanden und das Manifest schema-valide. Die bisherige vollständige
Bezugsphrase kommt in der paraphrasierten Entität nicht vor; auch die erforderliche
lexikalische Deckung der Fragetypbeschreibung fehlt. Damit wird kein Kandidat
gewählt. Der Baseline-Lauf über den vollständigen Chat reproduzierte sechs rote
Auswahlfälle (zwei Domänen, Wissens-/Arbeitsklassifikation und gemischte Fragen)
bei einer grünen Unrelated-/Leer-Tenant-Kontrolle: **6 fehlgeschlagen / 1 bestanden**.
Die spätere generische Rückfrage ist eine Folge dieser Nichtwahl.

### Umsetzung und Schutzregeln

- Kandidaten erhalten eine explizite Metadatenprojektion aus aktuellem Graph und
  berechtigtem Dataset-Katalog: Originaldatei, Datensatztitel, Schema/Einheiten,
  Zeitraum und aus `project_candidates` abgeleitete Graphanker. Keine Rohzeilen,
  Profilbeispiele oder neuen Manifestmodellaufrufe; Anker bleiben Kandidaten.
- Wiederverwendung von `normalizePhrase` und `createCompoundTokenizer`; zusätzliche
  Umlaut-/ASCII-Normalisierung und einfache sprachliche Endungen. Bezugsanker und
  Feldinhalt müssen derselben Quelle gehören. Manifestparaphrasen ersetzen diese
  Prüfung nicht. Objekt-/Entitätsreferenzen können die dazugehörige tatsächliche
  Lesequelle binden; alle Antwortwerte kommen weiterhin aus frischem autorisiertem
  Lesen, nicht aus der Projektion oder dem Manifest.
- `settings.routing`: Standards 0,75 Mindestscore, 0,15 Mindestabstand, 100 %
  Bezugsdeckung bei mindestens zwei relevanten Wörtern, 50 % Feld-/Inhaltsdeckung.
  Scoreanteile 0,45 Bezug, 0,45 Inhalt, 0,10 belegter Zeitraum. Fehlender Zeitraum
  ergibt nach Auswahl eine echte Querylücke. Reine Einheit/Jahreszahl reicht nicht.
  Plausible Alternativen unter der Mindestscoregrenze zählen für den Abstand mit.
- Ohne Treffer läuft die bisherige Turnreihenfolge weiter; Antworttext und
  Verstehen bleiben unverändert. Die optionale Diagnose ist die bewusst additive
  Antwortvertragserweiterung. Anhänge/eingefügte Tabellen, persönliche Korrekturen,
  Tenant-/Clearance-/Mitgliedschaftsprüfung und Archiv-/Löschfilter bleiben erhalten.
- Kompakte `metadata.projectRouting`-Diagnose ohne Frage, Namen oder Tenant-ID;
  ausgewählte Akten zusätzlich im gespeicherten Retrieval-Trace. Der Praxistransport
  bewahrt sie in JSON, rote Akten-Turns zeigen beste ID, Score, Abstand und Grund
  im Markdownbericht. Fehlende Erreichbarkeit ist als `not_evaluated` erkennbar.

GitNexus-Impact wurde vor den Eingriffen für Chat, Manifest-Action/`current`,
Auswahl-/Lesefassade, Workbench-Aktenhelfer und Praxisrunner/-bericht aufgerufen.
Der ältere Index kennt diese Symbole noch nicht (UNKNOWN); Aufrufsuche mit
`grep -rn`/`rg` ergänzt die Analyse. Das hohe Risiko des zentralen Chatpfads wurde
vor den Änderungen benannt. Blast Radius: früher Aktenversuch und Diagnose-Hook im
Workbench-Chat, gemeinsame Kandidatenbewertung für Workbench/Dossier, zusätzliche
Kandidatenmetadaten und Praxisbericht. Die Dossier-Antwortgenerierung, statischen
Kataloge, Berechtigungsregeln und vorhandene Ausformulierung bleiben unverändert.

Der bereitgestellte Live-Bericht dokumentiert **ROT**, 116/118 Läufe und Abbruch
durch ausgeschöpftes Kontingent. Einzelne bereits gewählte Akten enthalten andere
Rotpunkte, etwa UUID in der deterministischen Herkunft; diese sind kein Nachweis
einer gescheiterten Auswahl. Ein neuer grüner Live-Lauf wird hier nicht behauptet.
Die ursprünglichen zehn Akten-Praxisszenarien bleiben erhalten. Für den nächsten
autorisierten Lauf sind die erweiterten Diagnosen vorbereitet. Keine Allowlist-
Änderung, keine neuen Env-Variablen, kein Live-Modellaufruf, kein Push oder PR.

### Ausgeführte Checks für den Auswahlfix

| Prüfung | Ergebnis |
| --- | --- |
| Neue Regressionen | 37 Tests grün: 13 vollständige Chat-Turns, 22 Auswahl-/Metadatenfälle, zwei Offline-Praxisberichtfälle |
| Gezielt berührte Pfade | acht Suites / 151 Tests grün; nach zusätzlichem Diagnoserandfall gezielter Nachlauf: drei Suites / 36 Tests grün; alle Fälle anschließend in der vollständigen CI |
| Lint / Build | grün; regulärer Build-No-op |
| `test:unit:ci` | 24 Blöcke, 471 Suites / 10327 Tests bestanden; 7 Suites / 54 Tests regulär übersprungen |
| Coverage | Statements 84,13 %, Branches 70,38 %, Functions 88,39 %, Lines 85,90 %; alle Grenzen bestanden |
| `test:shared-service:ci` | 86 Tests grün; Harness 20,44 s unter 60 s |
| `check:practice-fixtures` | grün; bestehende zehn Akten-Szenarien synchron und ausschließlich synthetisch |
| Domain-Free | Core und Äquivalenz grün; 150 Dateien / 25170 äquivalente Treffer; zusätzliche Prüfung aller neuen Kernmodule im Manifesttest |
| TDD-Matrix | 82 Tests grün, vier optionale Tests übersprungen; `check:tdd-matrix-coverage`: 66/66 erforderliche IDs, 100 %; zwölf optionale Live-Blackbox-IDs nicht ausgeführt |
| Funktionsmodell / Kataloge / LLM | `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`, `check:llm` grün |
| `audit:openapi` | 0 Issues, unverändert 480 Warnungen |
| GitNexus / Diff | vorgemerkter Diff: 20 erwartete Dateien, keine dem älteren Index bekannten geänderten Symbole; normaler und vorgemerkter `diff --check` grün |

Alle sechs Generatoren wurden nach der letzten Codeänderung ausgeführt. Produktcode,
Tests und generierte Artefakte blieben während der finalen vollständigen CI per
Prüfsummen unverändert. Ein Zwischenlauf wurde für den zusätzlich gefundenen
Diagnoserandfall „keine Fragetypen“ kontrolliert beendet; nach Korrektur und erneuter
Generierung war der frische vollständige Lauf grün. Es wurden keine bestehenden
Tests abgeschwächt. Danach wurde nur dieser Ergebnisbericht ergänzt.

Der zusätzliche GitNexus-Vergleich gegen `main` lieferte im auf 20 Sekunden
begrenzten Fenster keine Auswertung. Der lokale Diff gegen die Folgeauftragsbasis
`c1fcebfc` umfasst ausschließlich die erwarteten 20 Dateien; die lokale Aufrufsuche
bestätigt die oben beschriebenen Pfade. Der bereitgestellte Live-Bericht wurde
per SHA-256 unverändert bestätigt und vollständig aufgenommen. Ein vorbestehender
unversionierter Python-Cache bleibt unberührt und wird nicht mitcommittet.

## Folgeauftrag: ausformulierte Aktenantworten

Aufbauend auf Commit `33ecdb62` ergänzt ausschließlich `projectManifestTurn` einen
Aufruf von `project-manifest-prose`. Der gemeinsame Akten-Lesepfad bleibt
deterministisch; Personal Agent und Dossier erhalten keinen zusätzlichen Aufruf.
Wiederverwendet werden die zentrale LLM-Fassade, `llmOptions`,
`opaqueContext`/`restoreContext`, `parseNumber`, `logLlmError` und `quotaMessage`.
Frage, Titel, belegte Werte samt Herkunft und Lücken gehen als untrusted Kontext
an ein Ajv-geprüftes `{ answer }`-Schema. Auswahl und strukturierte Quellen bleiben
deterministisch; Lücken werden auch bei Auslassung durch das Modell angefügt.

Zahlenvergleich: exakte normalisierte Ziffern plus Dezimalexponent, ohne
Gleitkomma-Rundungsverlust. Deutsche/englische Trennzeichen, geschützte Leerzeichen,
Apostrophe, Vorzeichen und Exponenten sind abgedeckt; Einheiten werden beim
Zahlenvergleich abgetrennt, nicht umgerechnet. Keine Toleranz oder Berechnung.
Ein einzelner Punkt mit Dreiergruppe zählt als Tausendertrennung, ein einzelnes
Komma als Dezimaltrennung. Freigabe ausschließlich gegen `evidence[].value`, nie
gegen Frage oder Manifest. Schemafehler, Code/JSON, unbelegte Zahlen und andere
Modellfehler werden protokolliert und ergeben den bisherigen Text.
Kontingentfehler ergeben die gemeinsame Kontingentmeldung samt `resetAt`, mit
vorangestellter Aktenwahl und unveränderten strukturierten Belegen.

Kosten: genau ein Ausformulierungsaufruf je belegter Workbench-Aktenfrage, ohne
Retry/Recovery/strukturierten Ersatzaufruf. Keine Akte oder keine Evidenz bedeutet
keinen zusätzlichen Modellaufruf. Manifest-Erzeugung und Auswahlkosten ändern sich
nicht. Kein neuer Parameter und keine Allowlist-Erweiterung.

GitNexus-Impact wurde für `projectManifestTurn`, `projectManifestProse`,
`answerNumbers` und die Praxisbewertung aufgerufen; der ältere Index liefert
UNKNOWN. Ergänzende lokale Aufrufsuche zeigt einen Workbench-Chat-Aufrufer und
einen Praxisbewertungs-Aufrufer. Routingauswahl, Berechtigungen und Dossier bleiben
unberührt; der Blast Radius umfasst die Workbench-Antwortdarstellung und den
Praxisprüfer. Die zehn vorhandenen Akten-Praxisszenarien bleiben erhalten. Ihre
Bewertung akzeptiert nun ausformulierte Quellenangaben; Datei muss sichtbar sein,
Hash/Fundstelle bleiben in der tatsächlichen strukturierten Evidenz verpflichtend.
Zusätzliche Tests verhindern, dass fehlende Provenienz dadurch akzeptiert wird.

Stubtests decken gute Ausformulierung, unveränderte Quellen, genau einen Aufruf,
untrusted Prompt, reversible Referenzen, falsche Zahlen einschließlich großer
Ganzzahlen, Schema-/Code-/JSON-/Modellfehler, Kontingentfehler, gemischte Herkunft,
gesicherte Lücken sowie keinen Aufruf ohne gewählte Akte oder Belege ab.
Der Live-Praxislauf bleibt vorbereitet und wird hier nicht ausgeführt.

### Checks für den Folgeauftrag

| Prüfung | Ergebnis |
| --- | --- |
| Neue Tests | 43 Stub-/Praxisprüfer-Tests bestanden; finaler gezielter Nachlauf mit Manifestregression: 55 Tests grün |
| Berührte Integrations-/Praxispfade | acht Suites / 117 Tests grün; anschließend finale Zahlenlogik gezielt und in der vollständigen Unit-CI geprüft |
| Lint / Build | grün; Build regulärer No-op |
| `test:unit:ci` | 24 Blöcke, 468 Suites / 10290 Tests bestanden; 7 Suites / 54 Tests regulär übersprungen |
| Coverage | Statements 84,11 %, Branches 70,33 %, Functions 88,36 %, Lines 85,87 %; alle Grenzen bestanden |
| `test:shared-service:ci` | 86 Tests grün, Harness 19,24 s unter 60 s |
| Praxis-Fixtures | generiert, synchron und synthetisches Vokabular grün; bestehende zehn Akten-Szenarien unverändert |
| Domain-Free | `check:domain-free-core` und `check:domain-free-equivalence` grün; Äquivalenz über 150 Dateien / 25170 Treffer; neue Kernmodule zusätzlich im Manifesttest geprüft |
| TDD-Matrix | 82 Tests bestanden, vier optionale Tests übersprungen; Pflichtabdeckung 66/66 = 100 %, zwölf optionale Live-Blackbox-IDs nicht ausgeführt |
| Artefaktprüfungen | `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`, `check:llm` grün |
| OpenAPI | `audit:openapi`: 0 Issues, unverändert 480 Warnungen |
| Git-Diff | normaler und vorgemerkter `diff --check` grün; ausschließlich 13 erwartete Dateien im Folgeauftrag |

Alle sechs geforderten Generatoren wurden nach der letzten Codeänderung ausgeführt.
Produktcode, Tests und Artefakte blieben während der vollständigen Unit-CI per
Prüfsummen kontrolliert unverändert. Danach wurde nur dieser Ergebnisbericht ergänzt.
GitNexus `detect_changes` für den vorgemerkten Folgeauftrag meldet 13 Dateien und
keine im älteren Index bekannten geänderten Symbole. Der zusätzliche Vergleich
gegen `main` wurde ohne zeitnahe Rückmeldung beendet; der lokale Vergleich umfasst
dort 384 Dateien. Der kontrollierte Diff gegen die Folgeauftragsbasis `33ecdb62`
enthält die erwarteten 13 Dateien; Routing-/Dossier-/Evidenzleselogik ist unverändert.
Ein bereits vorhandener unversionierter Python-Cache wird nicht aufgenommen.
Neuer Commit ohne Amend; kein Push, kein PR und kein Live-Modelllauf.

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
