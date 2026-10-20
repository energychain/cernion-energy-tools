# Validierung #927 — Phase B

Stand: 2026-10-19. Branch: `feat/927-mandantenwissen-b`.
Ausgangsstand: `2387a6ffeef014be9a9443d277d693db5068422d` (`origin/main`, Phase A / #949).

## Reproduktion und Ergebnis

Vor Änderungen am Produkt wurde das neue generierte Szenario `earlier-session` über
`createLocalTransport` und den produktiven `createLiveHarness` ausgeführt. Alle
Modellantworten stammen aus lokalen, gegen das tatsächliche Schema validierten Stubs;
die Bewertung verwendet `practice-evaluation-checks.checkTurn`.

Der vollständige rote Lauf reproduzierte fehlende Quellennennung, Fall-/Gesprächs-
herkunft, Zeitpunkt und Fundstelle in beiden neuen Chat-Formulierungen sowie die
fehlende korrigierbare Quellenwahl. Ein vorangehender Testanlauf erreichte zunächst
das Standardbudget von 40 Stub-Aufrufen; der aussagekräftige Replay nutzt deshalb ein
explizites Offline-Budget von 300 Aufrufen. Die Erwartungen wurden nicht abgeschwächt.
Nach Umsetzung ist derselbe Replay grün, einschließlich unpassender Frage, „passt
nicht“, späterem Ausschluss und einer ursprünglichen Rückfallantwort. Eine Variante
liefert die abweichende Klassifikation `knowledge` statt `work`.

## Implementierung und Autorisierung

- `src/tenant-evidence-sessions.js` ergänzt die Adapter `case` (sichere
  Fallzusammenfassung/Turn-Memory) und `memory` (aktive festgehaltene Aussagen).
  Registry, Manifestvertrag, Relevanzschwellen, Selektor, Originalread-Dispatch,
  Quellennennung, Zahlenprüfung und Lernschleife bleiben gemeinsam.
- Kandidaten sind ausschließlich autorisierte Routing-Metadaten. Frische Reads
  beachten Tenant, Clearance, `loadVisibleCase`, Herkunftsgespräch und Originalstatus.
  Auch alte Aussagen ohne Client-Angabe lösen ihren Fall über die aktuellen
  Conversation-Records auf. Veränderte Inhalte/Fingerprints, entfallene Zugriffe,
  Widerruf, Ablauf oder eine personenbezogene Ablehnung liefern keine Evidenz.
- Die bestehende Fallpolitik bleibt unverändert. Historische `own`-/`team`-Werte
  werden heute durch `tenantCasePolicy` auf Tenant-Sichtbarkeit abgebildet. Der neue
  Adapter respektiert die vorhandene Zugriffsschranke; ein Negativtest sperrt sie
  vor Kandidatenangebot und Originalread. Bestehende Projektmitgliedschaftstests
  sichern weiterhin den Projektpfad. Es gibt keine neue Gateway-/Rollenausnahme.
- Minimal-Deskriptoren liegen sofort am Originalrecord. Titel, Gegenstands-/Kennungs-
  anker, Abschnitts-/Fragetypmetadaten, Zeitraum und Status bilden den Manifestinput.
  Quelleigene Bezeichnungen verhindern, dass ein bloßer Gegenstandsanker als
  expliziter vollständiger Quellentitel jeden Inhaltsbezug ersetzt. Aussagen
  beschreiben dabei die generischen Facetten „Festgehaltene Aussage“/„Einordnung“.
  Rohverlauf, Inhaltsfrage, Aussagenwortlaut und Schlussfolgerung bleiben aus
  Deskriptor-Prompts ausgeschlossen. Einzelne Inhaltsfacetten stammen dynamisch aus
  den projizierten Statusbezeichnungen, ohne fachliche Wortliste. Inhalt wird ausschließlich frisch gelesen.
- Anreicherung verwendet dieselbe Hintergrundqueue: 64 wartende Aufträge, 1 aktiver,
  Standardabstand 30 s, 16 KB Metadaten, 1 Versuch, 1.200 Tokens, 5 s. Fehler lassen
  das deterministische Minimum bestehen. Originalhash/Fingerprint und Revision
  werden vor Writes erneut geprüft; neuere Korrekturen bleiben erhalten. Altbestände
  werden bei passender Anfrage nachgezogen, ohne Massenmigration oder Parallelkatalog.
- Aktuelles Gespräch und sein gebundener Fall, Rückfall-/Fehlerantworten, interne
  Beschreibungen und bloße Titel sind keine ältere Evidenz. Upload-abgeleitete
  Schlussfolgerungen und Dokument-Aussagen werden nicht nochmals als Sitzung bzw.
  Gedächtnis gezählt. Für Altdaten ohne Herkunftsmarkierung unterdrückt die Registry
  Überlappungen mit sichtbaren Uploads. Eigenständige Sitzung, Dokument und Tabelle
  können dagegen gemeinsam drei Quellen liefern. Letzte Einordnungen werden vor
  dem Fall-Footer gespeichert und sicher projiziert.
- `workbench.evidenceCorrect` ist geschützt und verwendet die vorhandene auditierte
  Lernschleife. `reject`/`confirm` gelten personenbezogen. Der bestehende Satz zur
  tatsächlich gelesenen Quelle nennt bei Sitzungen/Aussagen Fall bzw. Gespräch;
  Originalmetadaten enthalten zusätzlich Gesprächs-ID, Zeitpunkt und Fundstelle.

## Ablagerest aus Phase A

Der schon vorhandene strukturelle Datensatzpfad läuft nach Aufnahme neuer Tabellen
vor der Bezugsauflösung. Passende deterministische Deskriptorangebote werden zuvor
ohne Bezugsauflösung geprüft, damit Inhaltsbitten direkt am Upload ebenfalls erhalten
bleiben. Eine reine Ablage liefert direkt ihre Bestätigung und ggf.
den bestehenden Fortsetzungsvorschlag. Die Evidenzergänzung benötigt einen belegten
Read oder ein strukturiertes Query-Ergebnis; eine Datensatz-ID allein genügt nicht.

Der neue Vollturn-Test belegt für eine reine Tabellenablage genau **einen**
`generateStructured`-Aufruf (vorhandene Datensatzsemantik), **keine** Text-/Chat-
Generierung und **keinen** Bezugsauflösungsaufruf. Eine künstliche Bestätigung mit
Datensatz-ID allein löst ebenfalls keinen Modellaufruf aus. Inhaltsfragen direkt am
zweiten Upload und strukturelle Blatt-/Einheitenantworten bleiben abgesichert.

Der bestehende Phase-A-Test für generische Dateinamen behält sämtliche Erwartungen.
Er arbeitet jetzt die Deskriptorqueue gezielt ab, damit er echte Deskriptor- und
Routing-Prompts prüft, anstatt implizit den entfallenen unnötigen Ablageaufruf zu zählen.
Der bestehende Test „priority project evidence wins over an existing memory answer“
deckte zunächst eine zu großzügige explizite Titelwertung eines bloßen Aussageankers
auf. Quelleigene Titel und beschriebene Inhaltsfacetten beheben dies ohne Sonderpfad
oder Erkennung einer Frageformulierung; der unveränderte Test ist erneut grün.

## Akzeptanzkriterien

| AC | Status | Nachweis |
| --- | --- | --- |
| AC-01 | Offline erfüllt, Phase-A-Live bereits dokumentiert | Sichtbarer/korrigierbarer Fortsetzungsvorschlag, Mehrchat und unpassender Bezug |
| AC-02 | Offline erfüllt und um ältere Sitzungen erweitert | Beide generierten Replays; mehrere Formulierungen; gemeinsame Sitzung-/Dokument-/Datensatzreads mit Herkunft |
| AC-02b | Erfüllt | Ausschließlich Deskriptoren und gemeinsame Relevanz; keine neue Frage-Phrasenliste |
| AC-03 | Erfüllt | Rückfall/Fehler/interne Texte/Titel ausgeschlossen; sichere letzte Einordnung |
| AC-04 | Erfüllt | Projekt, Dokument, Datensatz, Fall und Aussage in derselben Registry und demselben Antwortpfad |
| AC-04b | Offline erfüllt | Tenant-/Clearance-/Herkunftszugriff, frische Revalidierung, personenbezogene Korrektur/Bestätigung, unveränderte Projektmitgliedschaft |
| AC-05 | Offline-Szenarien erfüllt; Phase-B-Live offen | Generiertes `earlier-session` zusätzlich zu `document-table`; Live-Lauf durch die aufrufende Session |

## Blast Radius

Die vorgeschriebenen vorgängigen GitNexus-`impact(..., upstream)`-Aufrufe liefern für
die aktuellen Workbench-/Manifest-/Memory-Symbole `UNKNOWN` bzw. fehlende Treffer.
Ergänzend wurden die Aufrufer im Worktree mit `grep -rn` geprüft. Die manuelle
Einstufung **HIGH** wurde vor Produktänderungen kommuniziert: direkte Aufrufer sind
Workbench und Personal-Agent; betroffen sind Angebote, Turnreihenfolge, Gedächtnis-
Persistenz, sichere Projektion, Ausformulierung und Korrekturdispatch. Datensatz-
Berechnung, allgemeine Rollenpolitik und Projektzugriff bleiben bei den bestehenden
Implementierungen. Ein fehlender Index-Treffer ist keine Entwarnung.

## Checks und Abschluss

- Zusammengefasster gezielter Regressionslauf: **32 Suiten / 492 Tests bestanden**,
  einschließlich sämtlicher `tenant-evidence-*`, beider Praxis-Replays,
  `project-manifest*`, `dataset*`, `tenant-memory*`, Lernschleife und Tabellen-Live-Regression.
- Nach den letzten Metadaten-/Backfill-Änderungen: abschließend **6 Suiten / 88 Tests
  bestanden**, insbesondere 20 Sitzungs-/Aussagentests, beide unveränderten Praxis-
  Prüfer, Phase-A-Mehrchat, Tabellenqualität und Projekt-Priorität. Dazu gehören
  Inhaltsbitten direkt am Upload und ein Altfall ganz ohne Turn-Memory-Record.
- `test:shared-service:ci`: **3 Suiten / 86 Tests**, Harness **28,27 s** (< 60 s).
  `test:e2e:shared-service`: Offline-HTTP-E2E bestanden, **24,02 s**.
- `test:tdd-matrix`: **82 Tests bestanden**, 4 wie vorgesehen übersprungen;
  `check:tdd-matrix-coverage`: **66/66 aktive IDs, 100 %**. Die optionalen
  Blackbox-MT-IDs bleiben ausdrücklich deaktiviert.
- Lint: **0 Fehler, 12 bestehende Warnungen** in unveränderten Dateien. Ergänzende
  Sonar-Prüfung auf invariante Schleifenrückgaben, Regex-Anker und Sortiervergleiche:
  **0 Fehler**.
- Domain-Free-Core: keine Befunde, keine neue globale Ausnahme.
  Scanner-Äquivalenz einschließlich Kontaminationsprobe: **169 Dateien / 28.190
  übereinstimmende Treffer**, **102,72 s**.
- Neu erzeugt: OpenAPI, Operation-Capability-Index, `llm.txt` nach dem CHANGELOG,
  Funktionsmodell mit Reports/Lineage, Signalkatalog und Praxis-Fixtures. OpenAPI
  und Operation-Index bleiben inhaltlich unverändert; es gibt keine neue REST-Route.

| Abschließender Check | Ergebnis |
| --- | --- |
| `npm run lint` / `npm run build` | Grün; 0 Lint-Fehler, 12 bestehende Warnungen |
| `npm run test:shared-service:ci` | Grün; 86 Tests |
| `npm run test:e2e:shared-service` | Grün; isoliertes HTTP-E2E mit Offline-Fassade |
| `npm run check:practice-fixtures` | Grün; synthetisch und synchron |
| `npm run check:domain-free-core` | Grün; keine Befunde |
| `npm run check:domain-free-equivalence` | Grün; einschließlich Kontaminationsprobe |
| `npm run check:tdd-matrix-coverage` | Grün; aktive Matrix 100 % |
| `npm run check:function-model` | Grün |
| `npm run check:signal-catalog` | Grün |
| `npm run check:operation-capability-index` | Grün |
| `npm run check:llm` | Grün |
| `npm run audit:openapi` | 0 Fehler, 480 bestehende Warnungen |
| `git diff --check` / gestagter Diff-Check | Grün |

GitNexus-Abschluss: `detect_changes` wurde für diesen exakten Worktree mit
`scope: all`, `scope: staged` sowie `scope: compare, base_ref: main` aufgerufen.
Der Server lehnt alle drei mit „Repository ... not found“ ab: Dieser Worktree ist
nicht registriert. Es wurde deshalb keine Analyse eines anderen Checkouts ausgelöst.
Zusätzlich geprüft wurden die vollständige gestagte Liste und der Diff der **31
beauftragten Dateien**, Diff gegen das identische Ausgangs-`origin/main` sowie die
Quell-/Service-Aufrufer mit `grep -rn`. Die Änderungen gehören ausschließlich zu
Evidenzadaptern, Workbench-/Gedächtnis-/Antwortpfaden, Tests, Dokumentation und den
angeforderten generierten Artefakten. Die manuelle HIGH-Einstufung bleibt bestehen.

Alle Läufe waren offline. Kein `npm run test:unit:ci`, kein Live-LLM-/Live-Praxislauf,
kein Push und keine schreibenden GitHub-Aufrufe. Vollständiger Unit-CI-Lauf und
Phase-B-Live-Nachweis verbleiben wie beauftragt bei der aufrufenden Session.


## Runde 2

Stand: 2026-10-20. Ausgangsstand `89d045d0`, einschließlich Review-Fixes
`c3536ea2` / `3a27cb5b` und Hotfix `2a34b9c9`. Kein Live-LLM-Lauf.

### Rote Reproduktion vor dem jeweiligen Fix

- **Befund 1:** Der vollständige lokale `earlier-session`-Replay wurde vor Produktänderungen
  mit dem echten Gegenstand „Bestand am Standort Nord“, dem Status „Bestand beträgt
  80 kg, Zuordnung offen“ und Deskriptor-Fragetypen ohne „Einordnung/eingeordnet“ rot.
  Quellenwahl, Herkunft und Korrektur fehlten bei beiden Formulierungen. Eine Variante
  klassifiziert weiter als `knowledge` statt `work`; keine bestehende Prüferwartung wurde
  abgeschwächt. Die Stub-Situation verwendet die live beobachtete Struktur „… wird …
  angefragt“. Der bisherige Testwert „Standort Nord“ allein hatte das Inhaltswort
  „Bestand“ versehentlich als Lexikaltreffer übrig gelassen.
- **Befund 2:** Zwei zusätzliche vollständige lokale Turns liefern ein internes
  Situationsfeld bzw. Arbeitsauftragsfeld mit vorangestellter Anrede als Modellantwort.
  Vor dem Fix wurden beide als `model_knowledge` ausgegeben und gespeichert statt als
  Rückfall behandelt. **Auf `origin/main` ebenso:** Ein reiner Source-Export des
  unveränderten `origin/main` (`cc5ba2e7`) nach `/tmp`, mit denselben offline validierten
  Stubs und Vollturn-Tests, reproduzierte beide Fehler. Es wurde weder ein anderer
  Worktree geöffnet noch eine Branch-Umschaltung vorgenommen.
- **Befund 3:** Eine Inhaltsfrage mit `caseSearch.requested=true` nach einem ursprünglichen
  Rückfall lieferte direkt `Fall F-1: … Stand: Neu angefragt … nicht hinterlegt`.
  **Auf `origin/main` ebenso:** Derselbe separate Source-Export reproduzierte auch diesen
  dritten roten Vollturn-Test. Die Fallsuche selbst ist kein Ausgabevertrag für eine Übersicht.
- **Befund 4:** Der Transport wartete beim Gesprächswechsel nicht auf die bestehende
  Anreicherungsqueue. Der Replay prüft jetzt zusätzlich einen tatsächlich abgearbeiteten
  Sitzungsdeskriptor vor der Folgefrage und fehlende Fragewortdeckung trotz Anreicherung.

### Änderungen und Grenzen

Die bestehenden Routingbewertungen gehen in denselben Bezugsauflöser ein; es gibt
keinen zweiten semantischen Selektor. Vollständiger deterministischer Gegenstandsbezug
und vollständige typisierte Kennungen begrenzen zusätzliche Kandidaten. Die bisherigen
Grenzen (acht Kandidaten, 64 KB, fünf Sekunden, ein Versuch) gelten weiter; das Schema
enthält keine Gemini-inkompatiblen `uniqueItems`, `const` oder Referenzen. Nach der
frischen Kandidatensuche sind aus der neuen Gegenstandsbrücke ausschließlich vom Modell
bestätigte Quellen zulässig. Die bisherige deterministische Ergänzung komplementärer
Quellen bei impliziten Gesprächsbezügen bleibt erhalten.
`skip`/`only`, eigene Uploads, Zusammenfassungszugriff bei der Kandidatensuche und
Audit erst beim Inhaltsread bleiben erhalten.

Der zentrale Antwortfilter vergleicht vollständige interne Textbestandteile auch mit
längeren Antwortsätzen und erhält zusätzlich das Arbeitsauftragsfeld. Wörtlich belegte
Nutzerberichte aus #874 bleiben durch ihren vorhandenen Herkunftsnachweis erhalten.
`safeConclusion` nutzt dieselbe Erkennung mit vorhandenem internem Kontext. Der normale
Inhaltsantwortpfad erhält aus Falltreffern sichere Schlussfolgerungen statt Fallhüllen;
die direkte Fallübersicht bleibt expliziten Übersichtsausgaben, dem bestehenden
Statuspfad und bisherigen Aufrufern ohne Ausgabevertrag vorbehalten.

Im #874-Test zur letzten Einordnung wurde ein bereits mit Phase B unvereinbarer
Testwert korrigiert: `lastSafeConclusion` war identisch mit dem bloßen Titel. Jetzt
enthält er Titel plus fachlichen Stand; alle bisherigen positiven und negativen
Ausgabeprüfungen bleiben unverändert. Der eigenständige Test für den Ausschluss bloßer
Titel bleibt ebenfalls unverändert.

Der lokale Harness leert bei neuen Gesprächen die Queue aller vorhandenen Quellendienste.
Dies verändert ausschließlich die lokale Praxis-Simulation, nicht den produktiven
Queue-Abstand. Alle Antworten/Deskriptoren der Tests kommen aus `src/llm-client.js`-Mocks.

### Modellaufrufe und Blast Radius

Die neue Gegenstandsbrücke verursacht höchstens **einen** `evidence_reference_resolution`-
Aufruf je betroffenem Turn. Ohne Gegenstandsbezug, bei abgelehnten Quellen, zu vielen
Kandidaten oder zu großem Prompt: **null** zusätzliche Bezugsaufrufe. Im Replay erhalten
`question` und `paraphrase` je einen solchen Aufruf, ohne anschließenden
`evidence_request_kind`; zusammen mit der Ausformulierung sind das jeweils genau
zwei Vordergrund-Modellaufrufe. Der zusätzliche Budgettest zählt strukturierte und
unstrukturierte Aufrufe gemeinsam, getrennt von den Deskriptorjobs. Die weiteren
Szenario-Turns erhalten keinen Bezugsaufruf.
Ausformulierung und sonstige Modellphasen behalten ihre bestehenden Aufgaben und
Budgets. Die lokale Queue-Anreicherung läuft beim Gesprächswechsel separat pro
wartender Quelle, nicht als weitere Bezugsauflösung. Blatt-/Einheitenantworten und
reine Tabellenablage sind durch ihre unveränderten Regressionstests abgesichert.

GitNexus-Impact wurde vor Produktänderungen für die betroffenen Symbole versucht;
der erreichbare Index kennt die aktuellen Symbole nicht (`UNKNOWN`/fehlende Treffer).
Zusätzlich wurden Definitionen und Aufrufer mit `grep -rn` im erlaubten Worktree geprüft.
Manuell **HIGH**, vor Änderungen kommuniziert: direkte Aufrufer sind die gemeinsame
Projekt-/Tenant-Evidenzführung, Workbench-Antwortgenerierung, Statusabfrage und
Fallgedächtnis. Betroffene Abläufe: Kandidatenbewertung, Bezug, Antwortfilter,
Inhaltsantwort versus Fallübersicht und lokale Praxis-Simulation. Allgemeine
Autorisierung, Datensatzberechnung und Session-Audit bleiben unverändert.

### Abschließende Checks

- Alle angeforderten gezielten Regressionen am abschließenden Produktstand:
  **27 Suiten / 497 Tests grün**. Davon die vier Evidenz-/Sitzungs-/Replay-Suiten
  mit **58 Tests**, übrige Gruppen **82 + 91 + 266 Tests**. Enthalten sind beide
  Praxis-Replays, alle `tenant-evidence-*`, `project-manifest*`, `tenant-memory*`,
  Tabellenqualität, Rollen, #874, #873, Funktionsabdeckung, Dataset-HTTP und Antwortstatus.
  Der zusätzliche abschließende Replay-Budgetlauf besteht mit **4 Tests**.
- `test:shared-service:ci`: **86 Tests**, **25,21 s** (< 60 s).
  `test:e2e:shared-service`: Offline-HTTP-E2E grün, **20,99 s**.
- `lint`: **0 Fehler, 12 bestehende Warnungen**. Ergänzende S1751-/S5850-/S2871-Prüfung
  (`no-unreachable-loop`, `sonarjs/anchor-precedence`, `sonarjs/no-alphabetical-sort`):
  **0 Fehler**, nur die bekannte Warnung im unveränderten `answerOutcome`-Parameter.
- `check:domain-free-core`: keine Befunde, keine neue Ausnahme.
  Abschließende Scanner-Äquivalenz: **169 Dateien, 28.266 identische Treffer,
  91,70 s**, einschließlich Kontaminationsprobe.
- `build`, `check:practice-fixtures`, `check:tdd-matrix-coverage` (**66/66 aktive IDs**),
  `check:function-model`, `check:signal-catalog`, `check:operation-capability-index`,
  `check:llm`, `audit:openapi` und `git diff --check`: grün.
  OpenAPI hat **0 Fehler und 480 bestehende Warnungen**.
- Neu erzeugt: OpenAPI, Operation-Capability-Index, Funktionsmodell mit Reports,
  Signalkatalog, Praxis-Fixtures und zuletzt `llm.txt` nach dem CHANGELOG. OpenAPI und
  Operation-Index bleiben inhaltlich unverändert. Es gibt keine neue REST-Route.

GitNexus-`detect_changes` wurde für den exakten Worktree mit `all` und
`compare, base_ref: main` aufgerufen; beide Anfragen lieferten auch nach mehreren
Minuten keine Antwort und wurden beendet. Die zusätzliche Anfrage für den
gestagten Diff mit dem exakten Worktree als Repository wurde mit „Repository … not
found“ abgelehnt. Es wurde keine ersatzweise Analyse eines anderen Checkouts ausgelöst.
Die manuelle Prüfung umfasst den vollständigen Rundendiff, Aufrufer mit `grep -rn` und den Branchvergleich. Das lokale
`main` (`e1e03958`) ist deutlich älter als `origin/main` (`cc5ba2e7`); sein großer
Branchdiff enthält bereits übernommene Historie. Der aktuelle Upstreamvergleich enthält
die erwartete bisherige Phase-B-Lieferung. Der Diff gegen den Runden-Ausgangsstand zeigt ausschließlich die 27 erwarteten
Runde-2-Dateien: Evidenz-/Antwortmodule, Harness, Tests, Dokumentation und Artefakte. Die manuelle Risikoeinstufung
bleibt HIGH; ein nicht antwortender Index ist keine Entwarnung.

Offen bleiben ausschließlich der Live-Nachweis und der vollständige Unit-CI-Lauf
in der aufrufenden Session. Kein Push, keine schreibenden GitHub-Aufrufe,
kein Live-LLM-Lauf und kein `npm run test:unit:ci` in dieser Runde.
