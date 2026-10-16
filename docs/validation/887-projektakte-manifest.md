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


## Folgekorrektur: erfundene Knotenverweise (Basis def4e269)

Der neue Live-Befund betrifft die Erzeugung, nicht die inzwischen erfolgreiche
Aktenwahl: `validateManifest` prüfte einen einzigen erfundenen Verweis als Fehler des
gesamten Manifests. Das Generator-Promise erreichte über `project-manifest.run` bzw.
Event/Recovery die Praxisvorbereitung; deren `Promise.all` ließ den Lauf abbrechen.
Dieser Befund wurde ausschließlich offline mit LLM-Stubs reproduziert.

Die strikte Ajv-/Referenzvalidierung bleibt unverändert. Davor stehen jetzt drei
Stufen: ungültige Verweise entfernen und unbelegte Aussagen verwerfen; ohne gültigen
Fragetyp einmal mit erlaubten Knoten neu erzeugen; anschließend ein deterministisches
Minimal-Manifest aus aktuellen Graph-/Datensatzmetadaten. Eine ungültige Zusammenfassung
wird durch den belegten Aktentitel ersetzt. Auch der Rückfall wird strikt validiert.
Provider-/Kontingentfehler verursachen sofort den Minimal-Rückfall und keinen weiteren
Versuch. Ein separater Catch im Dienst schützt zusätzlich vor unerwarteten
Generatorfehlern, ohne Autorisierungs-, Archivierungs- oder Schreibfehler zu verdecken.
Ein Graph ohne Knoten bleibt ohne Manifest; es werden keine Quellen erfunden.

`generation` ist als interner State am Versionsdatensatz unter dem bestehenden
Aktenpräfix gespeichert und wird separat in sichtbaren Kandidaten sowie der Diagnose
der besten Akte ausgegeben. Status, Versuche, verworfene Quellen/Aussagen, Rückfall und
fester Grundcode enthalten keine Modelltexte oder Personen-/Tenantdaten.
`get` liefert weiterhin ausschließlich das schema-valide Manifest. Es gibt keine
neue Route, Env-Variable oder Allowlist-Erweiterung. Kosten: normalerweise ein,
bei unbrauchbarer Modellantwort höchstens zwei Aufrufe je geändertem Graphstand;
der bestehende eine Ausformulierungsaufruf je belegter Aktenantwort bleibt unverändert.

Der Harness legt kein Ersatzmanifest an. Er liest den Produkt-State und markiert
`project-manifest-generation` bei `degraded` rot, arbeitet aber sämtliche weiteren
Turns/Szenarien ab. Der Bericht zeigt Ursache, verworfene Verweise und Rückfall in
JSON/Markdown. Bei echten Abbrüchen wird eine sichere Meldung zusätzlich zum Fehlertyp
aufgenommen. Nur feste bekannte Betriebsfehlermeldungen werden unverändert übernommen;
unbekannte Providertexte werden durch die vorhandene sichere LLM-Fehlerdiagnose ersetzt.

Neue Stub-Prüfungen decken Teilbereinigung bei weiter möglicher Auswahl, ausschließlich
erfundene Verweise, erfolgreiche Neuerzeugung, Schema-/Parsefehler, Providerfehler,
Metadatenbudget, Dienst-Rückfall, reale Praxisvorbereitung und die fortlaufende
Bewertung einschließlich sicherem Abbruchbericht ab. Der bestehende Test mit
404 nach Erzeugungsfehler wurde bewusst auf den neuen Vertrag geändert: aktuelles
Minimal-Manifest statt nicht vorhandenes oder veraltetes Manifest. Bestehende
Negativtests für Sichtbarkeit, Archivierung und unpassende Fragen bleiben bestehen.

Impact: GitNexus `impact` wurde für Generator, Dienst-Publikation/Kandidaten und
Praxisvorbereitung/-lauf/-bericht sowie `selectProjectCandidates` ausgeführt. Der
veraltete Index kennt diese Symbole nicht (`UNKNOWN`); lokale Aufrufsuche ergänzt
die Analyse. Direkte Aufrufer: Manifestdienst und Praxis-Transport; indirekt bestehende
Workbench-/Dossier-Kandidatenleser. Im Routing wird ausschließlich der State der
besten Akte an die bestehende Diagnose angehängt; Auswahlkriterien, Schwellen,
Antworten, statische Quellen und Rechteprüfungen bleiben unverändert. Risiko: mittel
für Verfügbarkeit/Erzeugung, geringe additive Diagnoseänderung im zentralen Routing.
Keine Live-LLM-Aufrufe, keine Veröffentlichung und kein Push.

### Prüfergebnisse der Folgekorrektur

| Prüfung | Ergebnis |
| --- | --- |
| Lint (`--quiet`), Build | grün |
| Gezielt berührte Projekt-/Workbench-/Praxisdateien | 170 Tests in zehn Dateien grün, mit `NODE_OPTIONS=--experimental-vm-modules` |
| `test:unit:ci` | 24 Blöcke; 473 Suites / 10342 Tests grün, 7 Suites / 54 Tests regulär übersprungen |
| Coverage | Statements 84,15 %, Branches 70,39 %, Functions 88,41 %, Lines 85,91 %; alle Grenzen erfüllt |
| `test:shared-service:ci` | 86 Tests grün; 21,12 s unter 60 s |
| `test:tdd-matrix` / `check:tdd-matrix-coverage` | 82 Tests grün, 4 optional übersprungen; 66/66 erforderliche IDs = 100 %; zwölf optionale Live-Blackbox-IDs nicht ausgeführt |
| `check:practice-fixtures` | grün, generierte Fixtures synchron |
| `check:domain-free-core` / `check:domain-free-equivalence` | grün, unveränderte Allowlist; 150 Dateien / 25170 äquivalente Treffer |
| `check:function-model` / `check:signal-catalog` | grün |
| `check:operation-capability-index` / `check:llm` | grün |
| `audit:openapi` | 0 Issues; 480 bestehende Warnungen |
| `git diff --check` | grün |

OpenAPI, Capability-Index, LLM-Manifest, Funktionsmodell, Signalkatalog und Praxis-
Fixtures wurden nach sämtlichen Codeänderungen erzeugt. Die vollständige Unit-CI
lief anschließend bei eingefrorenen Quellen/Artefakten; Prüfsummen aller 1360
kontrollierten Dateien waren danach unverändert. Danach wurde ausschließlich dieser
Ergebnisabschnitt ergänzt und die Artefakterzeugung abschließend erneut ausgeführt.
GitNexus `detect_changes(all)` meldete geringe Risiken bei 16 erkannten Dateien,
aber keine Symbole im veralteten Index; die lokale Aufruf-/Diff-Prüfung bleibt
maßgeblich. Der Vergleich mit `main` wurde nach 20 Sekunden begrenzt, weil die
Indexabfrage keinen Abschluss lieferte. Der vorgemerkte Diff wird zusätzlich vor
dem Commit geprüft. Unverändert: keine Live-LLM-Aufrufe, keine Allowlist-Erweiterung,
keine Änderungen an Env-/Credentialdateien, kein Push.


## CI-Folgekorrektur: Quellen ohne Akten (Basis 5ff45105)

`npm run test:e2e:shared-service` reproduzierte den gemeldeten Fehler an der
unveränderten Assertion `initial.responseText.includes('Quellen:')`.
Die Diagnose mit ausschließlich synthetischen E2E-Daten zeigte den Retrieval-Trace
`pipeline / unavailable / DataCloneError` und eine leere Evidenzliste.

Ursache ist die neue frühe Kandidatenabfrage: `projectManifestTurn` ruft über
`projectManifestAnswer` den Endpunkt `project-manifest.candidates` auf. Schon dessen
`project-file.list` liest mit der internen Symbol-Capability `projectFileStore`.
Moleculer mischt die Metadaten von Unteraufrufen in ihre Eltern zurück. Dadurch
landet dieses Symbol auch ohne eine einzige Akte im ursprünglichen Chat-Kontext.
Der Offline-Evidenzsammler an der Personal-Agent-Grenze klont Parameter und Metadaten
mit `structuredClone`; dabei entsteht `DataCloneError`. Der bestehende Retrieval-
Fallback liefert daraufhin keine Evidenz und folglich keinen Quellenabschnitt.
Bei vorhandenen Akten gelangen auch `projectGraph` und `projectManifest` zurück.
Es handelt sich weder um ein Entfernen durch `candidateOnly` noch um eine Änderung
von `projectSourceInstructions`, Quellenrendering oder Ausformulierung.

Fix: Der Kandidaten-Handler erhält einen eigenen, vom ursprünglichen Context
abgeleiteten Kontext mit einer separaten flachen Kopie von `meta`. Alle vorhandenen
Unteraufrufe, Tracing-/Timeout-Einstellungen sowie Tenant-/Clearance-/Mitgliedschafts-
prüfungen bleiben bestehen; intern zurückgemischte Capabilities bleiben im lokalen
Kontext. Es wird nichts global entfernt oder freigegeben. Der Produktdiff umfasst
nur drei Zeilen einschließlich der erläuternden Kommentare im Kandidaten-Handler.
Der gemeinsame Endpunkt schützt sowohl Workbench als auch Personal-Agent-/Dossier-
Kandidatenleser; Auswahlkriterien und Antwortgenerierung bleiben unverändert.

GitNexus-Impact für den neuen Handler ist `UNKNOWN` (Symbol nicht im alten Index).
Die ergänzende lokale Aufrufsuche zeigt den Kandidatenanbieter und darüber die beiden
Antwortpfade als direkte/indirekte Verbraucher. Risiko: klein und additiv, begrenzt
auf die Metadaten der Kandidatenabfrage. Keine Änderung der globalen Allowlist.

Neue Regressionen wurden zunächst rot ausgeführt: Elternmetadaten bleiben bei leerem
und befülltem Tenant unverändert und serialisierbar; ein vollständiger Workbench-Turn
mit „Weitergeleitetes Dokument: … Kannst du mir helfen?“ behält die Quellen. Der
Antwortvergleich verwendet zwei frisch leere Tenants mit identischem Fallzähler;
im Kontrollturn ist nur der Manifestdienst ausgeblendet. Antworttext einschließlich
Quellen und Fallhinweis wird direkt und ohne Normalisierung oder Entfernen von
Antwortbestandteilen verglichen. Bei den strukturierten Quellen wird ausschließlich
die naturgemäß schwankende Laufzeit `ms` aus dem Vergleich ausgenommen. Der ursprüngliche
HTTP-E2E-Test wird unverändert ausgeführt und ist nach dem Fix grün.

Die frühere leere-Tenant-Probe verwendete einen direkten `broker.call`-Wrapper ohne
echten Elternkontext und prüfte die Metadaten nicht auf Serialisierbarkeit. Die neuen
Tests verwenden einen echten Service-Unteraufruf und dieselbe Clone-Grenze wie der
HTTP-E2E-Sammler.

### Prüfergebnisse der CI-Folgekorrektur

| Prüfung | Ergebnis |
| --- | --- |
| `lint -- --quiet`, `build` | grün |
| `test:e2e:shared-service` | grün, 15,53 s; ursprüngliche Quellen-Assertion unverändert |
| Berührte Projekt-/Workbench-Tests | vollständig grün in der Unit-CI; 14 vollständige Chat-Tests zusätzlich separat grün; beide neuen Metadatenfälle grün |
| `test:unit:ci` | 25 Blöcke; 475 Suites / 10354 Tests grün; 7 Suites / 54 Tests regulär übersprungen |
| Coverage | Statements 84,16 %, Branches 70,40 %, Functions 88,42 %, Lines 85,92 %; sämtliche Grenzen erfüllt |
| `test:shared-service:ci` | 86 Tests grün; 21,37 s unter 60 s |
| `check:practice-fixtures` | grün und synchron; keine neuen Szenarien nötig |
| `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`, `check:llm` | alle grün |
| `check:domain-free-core`, `check:domain-free-equivalence` | grün, unveränderte Allowlist; 150 Dateien / 25192 äquivalente Treffer |
| `test:tdd-matrix`, `check:tdd-matrix-coverage` | 82 Tests grün, 4 optional übersprungen; 66/66 erforderliche IDs = 100 %; zwölf optionale Live-Blackbox-IDs nicht ausgeführt |
| `audit:openapi` | 0 Issues, 480 bestehende Warnungen |
| `git diff --check` | grün |

Alle sechs Artefaktgeneratoren wurden nach der letzten Code-/Teständerung ausgeführt.
Die vollständige Unit-CI lief bei eingefrorenen Quellen und Artefakten; die Prüfsummen
aller 1362 kontrollierten Dateien waren anschließend unverändert. Nach Ergänzung
dieses Ergebnisabschnitts wird die Artefakterzeugung abschließend erneut geprüft.
GitNexus `detect_changes(all)` erfasste die erwarteten zehn Dateien mit geringem Risiko,
aber ohne Symbolzuordnung im veralteten Index. Die lokale Aufruf-/Diff-Prüfung bleibt
maßgeblich; der Vergleich mit `main` lieferte innerhalb von 20 Sekunden kein Ergebnis.
Der vorgemerkte Diff wird vor dem Commit nochmals geprüft.
Keine Live-LLM-Aufrufe, keine Env-/Credentialdateien und kein Push.
