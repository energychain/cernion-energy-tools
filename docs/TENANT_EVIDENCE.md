# Chat-Bestandteile als Mandantenwissen (#927 Phase A/B)

Chat-Dokumente und Chat-Datensätze bieten sich neben Projektakten als Evidenz an.
Die Workbench prüft die Angebote vor Fallübersicht und Tabellen-Kurzantwort.
Ein inhaltlicher Bezug benötigt keine vorherige Zuordnung beider Uploads zum selben
Fall. Bereits ein klar passender reiner Ablage-Turn kann den vorhandenen Fall
vorschlagen. Bei einem eindeutigen sichtbaren Herkunftsfall enthält die Antwort einen
Fortsetzungsvorschlag (`caseProposal`); die bestehende Aktion
`workbench.conversations.linkCase` kann diesen übernehmen. Es gibt keine automatische
Zusammenführung oder Umhängung bestehender Fälle.

## Quellenvertrag und Phase B

`registerEvidenceSource({type, service, action?, candidates, read, correctionAction?})`
in `src/tenant-evidence-sources.js` registriert ein selbst beschreibendes Angebot.
`candidates(ctx, question)` liefert ausschließlich autorisierte Routing-Metadaten;
`read(ctx, selected, question, options)` liest die aktuelle autorisierte Originalquelle
und liefert `{evidence, gaps, trace}`. `correctionAction` nennt den geschützten
Korrekturverbraucher. Die Projektakte ist der registrierte Typ `project`.
Phase B registriert Fallzusammenfassungen, Sitzungen und festgehaltene Aussagen als weitere Adapter; Katalog, Selektor, Korrekturdispatch und Antwortpfad bleiben gemeinsam.
Die Details der Sitzungsquellen stehen im Abschnitt „Phase B“ unten.

Der Kandidat enthält `id`, `sourceType`, `sourceId`, `title`, `manifest`,
`routingSources`, `provenance`, `sensitivity`, `corrections` und bei Chat-Quellen
`descriptorFingerprint`. Das `manifest` folgt unverändert dem Ajv-Vertrag aus #887:
Zusammenfassung, Entitäten/Anker, Zeiträume und beantwortbare Fragetypen mit gültigen
Quellenreferenzen. `routingSources` ergänzt Spalten/Typen, Einheiten, Abschnittstitel,
Perioden und deterministische Anker. Beobachtete Anker werden mit den vorhandenen
Projektstruktur-Extraktoren lokal aus nicht sensiblen Textspalten bzw. Dokumentfeldern
gewonnen und als `origin: observed` markiert. Tabellensampling ist auf 512 Zeilen und
32 Textspalten begrenzt; pro Quelle bleiben höchstens 32 beobachtete Werte. Alte
Tabellen verwenden begrenzte lokale Distinct-Abfragen. Diese Werte bleiben sowohl
aus den Deskriptor-Prompts als auch aus den semantischen Routing-Prompts ausgeschlossen;
sie ergänzen den deterministischen Abgleich erst lokal. `provenance` hält Datei, Blatt/Fundstelle,
Inhaltshash und Gesprächs-/Fallreferenzen; `sensitivity` die Quelleneinstufung.

Chat-Records speichern `evidenceDescriptor` und personenbezogene
`evidenceCorrections` im vorhandenen Datensatzkatalog bzw. Dokumentbestand.
Der deterministische Minimal-Deskriptor wird sofort beim Speichern verfügbar.
LLM-Anreicherung nutzt `llm-client` und `generateManifest`, dessen Validierung und
Bereinigung, in einer getrennten Hintergrundwarteschlange; Upload und Kandidaten-
Suche warten nicht auf diese Modellantwort. Gleichzeitig eintreffende Anforderungen
werden pro Tenant, Quellentyp, Record und Metadatenstand koalesziert. Tenant-IDs sind
Klartext-Schlüssel im internen Koaleszierungszustand und gehen nicht in Inhaltshashes
ein. Deskriptoren enthalten keine Antwortzahlen aus Tabellenzellen.

Prompts enthalten explizit projizierte Datei-/Abschnittstitel, Spalten, Typen,
Einheiten und Perioden. Tabellenzeilen, Beispielzellen und Dokumentpassagen werden
nicht an die Deskriptorerzeugung übergeben. Deshalb bleibt bei wenig aussagekräftigen
Metadaten die automatische Suche bewusst zurückhaltend. Alte Records erhalten erst
bei einer passenden Anfrage einen gespeicherten Deskriptor; zuvor reicht der
virtuelle deterministische Minimal-Deskriptor zur Kandidatenprüfung. Es gibt keine
Massenmigration.

Pro Quellendienst sind höchstens 64 wartende Aufträge und ein aktiver Auftrag erlaubt.
Standardmäßig startet alle 30 Sekunden höchstens ein Auftrag; `settings.tenantEvidenceEnrichment.delayMs`
steuert diesen Abstand. Pro Auftrag gelten 16.000 Byte projizierte Metadaten,
1 Modellversuch, 1.200 Ausgabetokens und 5 Sekunden Modellzeit. Die normale Tenant-Quota
gilt auch im Hintergrund. Wiederholte Writes koaleszieren pro Quelle; aktive Aufträge
mit gleichem Metadatenstand werden nicht doppelt eingeplant. Bei Überlauf, Fehler,
Neustart oder Schreibkonflikt bleibt der Minimal-Deskriptor nutzbar; eine relevante
spätere Anfrage kann eine ausstehende Anreicherung erneut einplanen. Vor dem Schreiben
werden Quelle, Inhaltshash und Metadatenstand erneut geprüft; neuere Qualitätsdaten
und Korrekturen bleiben erhalten. Shutdown verwirft wartende Arbeit und wartet nur
auf bereits aktive Arbeit.

## Auswahl und Scope

`projectEvidenceCandidates` sammelt alle registrierten Quellen. Der bestehende
`selectProjectCandidates` bewertet Deskriptor-Fragetypen und deterministische
Merkmale. Standardwerte:

| Einstellung | Wert | Bedeutung |
| --- | ---: | --- |
| `minScore` | 0,75 | Mindestscore bei implizitem Bezug |
| `minMargin` | 0,15 | Abstand zum konkurrierenden Gegenstand |
| `minSubjectCoverage` | 1 | Vollständiger Gegenstandsbezug |
| `minContentCoverage` | 0,5 | Mindestdeckung des Inhaltsmerkmals |
| `maxSources` | 8 | Begrenzung gemeinsam gelesener Angebote |

Impliziter Score: 0,45 × Gegenstandsdeckung + 0,45 × Inhaltsdeckung + 0,10 bei
passendem Zeitraum. Eine vollständige explizite Titelangabe hat wie bisher Score 2.
Vollständige strukturierte Kennungen zählen als Anker, Teilkennungen nicht.
Gemeinsam passende Bestandteile mit demselben tatsächlich getroffenen Gegenstand
bilden ein Angebot; der Abstand zu einem anderen Gegenstand bleibt erforderlich.
Die Einstellungen aus `project-manifest.settings.routing` lassen sich für die
Workbench mit `workbench.settings.tenantEvidenceRouting` überschreiben.

Fehlt ein wiederholter Gegenstandsbezug, löst ein schema-validierter semantischer
Metadatenaufruf den Bezug ausschließlich gegen strukturell gebundene Quellen des
aktuellen Gesprächs und die zuvor tatsächlich herangezogene Quellengruppe auf.
Dazu werden die letzte Inhaltsfrage und die gespeicherten Quellenschlüssel verwendet;
die alten Auszüge werden nicht als neue Evidenz wiederverwendet. Nur aktuell sichtbare,
registrierte Quellen-IDs sind zulässig. Die semantische Auflösung bestätigt bereits
einen Inhaltsbezug, weshalb danach kein zweiter, widersprüchlicher Inhaltsklassifikator
mehr gefragt wird.
Danach greift erneut derselbe deterministische Selektor. Quellenverwaltung und reine
Fallübersichten behalten ihre bisherigen Pfade. Es gibt keine Erkennung anhand
fester Abgleichsformulierungen und keine nachträgliche Verwendung interner Lagebilder
als Antwort.

`workbench-data-scope.scopedDatasets` akzeptiert zusätzlich `tenantEvidenceIds`.
Diese IDs entstehen aus der autorisierten Deskriptorauswahl; strukturelle Bindungen
über Gespräch/Fall/Upload/explizite Nennung funktionieren weiterhin. Ohne passende
Angebote bleibt die bisherige Antwortführung erhalten. Vor dem Lesen werden
Originalstatus, Hash, Metadatenstand, Korrekturen und Herkunftsfall erneut geprüft.
Projektmitgliedschaft bleibt durch die vorhandenen Projektaktionen abgesichert.

## Strukturelle Antworten und Praxis-Transport

Auch nach einer bereits ausgeführten strukturellen Tabellenabfrage bietet die
Workbench passende zusätzliche Quellen über den gemeinsamen Selektor an. Die
Ergänzung benötigt mindestens zwei tatsächlich gelesene Quellen, darunter einen
bereits strukturell abgefragten Datensatz. Ohne passende zusätzliche Quellen bleibt
die ursprüngliche Datensatzantwort unverändert. Diese Grenze gilt sowohl vor der
Kurzantwort im Inhaltsturn als auch bei einer bereits behandelten `dataset.turn`-
Antwort. Verwaltung und Rückfragen ohne belegten Datenread behalten ihren Pfad.
Die gewählte Quellengruppe wird für den folgenden Bezugsturn gespeichert.

Für gemeinsam gelesene Quellen setzt der Datenread `includeSummary=true` bei
`dataset.query`. Damit bleibt eine Katalog-Metadatenabkürzung außer Kraft; außerhalb
dieser Verwendung bleibt deren Standardverhalten unverändert. Liefert der Plan nur
COUNT, ergänzen die bereits vom Executor berechneten, gefilterten `summaries` die
Zahlenevidenz (höchstens acht freigegebene numerische Spalten mit bestätigter Einheit,
Minimum/Maximum samt Zeitpunkt). Es gibt weder eine weitere Modellabfrage noch einen
neuen Abgleichs-Fragenkatalog. Die ursprüngliche Abfrageantwort bleibt ebenfalls
enthalten. Gegenüberstellung und Zahlenprüfung verwenden anschließend diese belegten
Werte und deren Herkunft.

Der lokale Praxis-Transport bindet die produktive `knowledge-rag`-Dokumentablage mit
ihren Methoden und Mixins ein. Externe `query`-/`federatedSearch`-Backends bleiben
kontrolliert leer; hochgeladene Chat-Dokumente bleiben echte autorisierte Quellen.
Der Test `practice-tenant-evidence-replay.test.js` führt das generierte Szenario über
`createLocalTransport`/`createLiveHarness` aus und wertet `checkTurn` aus. Zusätzlich
prüft er die strukturellen Rückgabepunkte mit einer leeren ersten Kandidatensuche
und die unveränderte Rückgabe ohne zusätzliche Angebote. Alle Modellantworten sind
lokale schema-validierte Stubs, einschließlich eines absichtlich kargen COUNT-Plans.

Die Revalidierung aus #873 bleibt vor der Daten-Scope-Grenze: `documentGet` prüft
Sichtbarkeit und Status. Nur wenn personenbezogene Auswahlkorrekturen vorhanden
sind, muss die Revalidierung zusätzlich die aktuelle Person bestimmen. Substanzielle
Dokumenttreffer werden nicht wegen einer fehlenden redundanten Identitätsinformation
verworfen; tabellarische Treffer bleiben von `scopedDataEvidence` begrenzt.

## Antwort und Korrektur

Die Antwort nennt tatsächlich gelesene Quellen deterministisch, einschließlich Fall
oder Gespräch, soweit vorhanden. Die Ausformulierung verwendet die gemeinsame Evidenz
für Übereinstimmungen, Abweichungen und offene Zuordnungen. Eine Zahl muss aus der im
selben Satz genannten Quelle stammen; bei gemeinsam zitierten Quellen gilt deren
gemeinsame Zahlenmenge. Unbelegte Zahlen und Zahlen mit falscher Einzelherkunft
verwerfen die Ausformulierung zugunsten der deterministischen Belege. Differenzen
werden nicht frei berechnet. Fundstellen, Blatt und Inhaltshash bleiben in der
strukturierten Evidenz verfügbar.

Sobald mindestens zwei gelesene Quellen wörtliche Zahlen derselben benannten Größe
und Einheit enthalten, ergänzt `tenant-evidence-comparison` eine deterministische
Gegenüberstellung einschließlich gemeinsamer und unterschiedlicher Werte sowie der
noch zu prüfenden Zeit-/Bezugsbasis. Datei und Fundstelle stehen bei beiden Seiten.
Spaltennamen/Einheiten kommen aus dem jeweiligen Datensatz (`metadata.quantityFields`);
Dokumentwerte werden nur aus passenden benannten Aussagen bzw. Abschnittsüberschriften
übernommen. Andere Größen, Einheiten und Kennungen werden nicht gleichgesetzt. Die
Zahlennormalisierung wird mit der bestehenden Ausformulierungsprüfung geteilt.
Die Gegenüberstellung bleibt auch bei verworfener Modellprosa erhalten. Generische
interne Anfragebeschreibungen werden über denselben Antwortfilter wie in #926 verworfen;
dies betrifft die Ausgabeprüfung, nicht die Relevanzauswahl.

`shared-service-learning.apply` nimmt beispielsweise an:

```json
{
  "target": "tenantEvidence",
  "correction": { "sourceType": "document", "sourceId": "doc-example-v1", "kind": "reject" }
}
```

`confirm` hebt die entsprechende Ablehnung auf. Die Lernschleife persistiert und
auditiert die Korrektur; die Quelle speichert sie personenbezogen. Die Reaktion
„passt nicht“ bezieht sich auf die zuletzt angebotenen Bestandteile. Bei gemischten
Projekt-/Chat-Angeboten werden auch die Projektwahlen über `projectManifest`
korrigiert. Korrekturen verleihen weder fremde Sichtbarkeit noch zusätzliche Rollen.

Aktuelle Rückfallantworten werden anhand von Antwortstatus/Degradierungsmetadaten
vom Fallgedächtnis ausgeschlossen. Die sichere Projektion entfernt bekannte alte
Rückfalltexte aus `lastSafeConclusion`, damit sie nicht erneut als „Letzte Einordnung“
erscheinen. Deskriptoren entstehen ausschließlich aus Quellenmetadaten.

Validierung und Grenzen: [927-phase-a.md](validation/927-phase-a.md).

## Phase B: ältere Sitzungen und festgehaltene Aussagen

Die Registry registriert zusätzlich `case` und `memory` über denselben Quellenvertrag.
`case` projiziert die aktuelle sichere Fallzusammenfassung und das vorhandene Turn-Memory;
`memory` projiziert aktive festgehaltene Aussagen aus dem bestehenden Tenant-Memory-Store.
Es gibt weder einen zusätzlichen Katalog noch einen weiteren Selektor oder Antwortpfad.
Die Quellen nennen die Originalherkunft mit Fall, Gesprächsreferenz, Zeitpunkt und Fundstelle.
Die deterministische Quellennennung und `target: tenantEvidence` in der Lernschleife
funktionieren für beide Typen; Ablehnungen gelten personenbezogen und `confirm` hebt sie auf.

Kandidaten verwenden `principal`, `visible` und die Fallautorisierung des Domain Routers
im Zusammenfassungsmodus (`loadCase(…, { summaryOnly: true })`); erst der Originalread
als Evidenz läuft über `loadVisibleCase` und protokolliert damit den Zugriff auf fremde
Fälle wie die übrigen Inhaltsreads. Bei Aussagen gelten die bestehenden
`tenant-memory-store`-Reads. Pro Kandidatensuche werden nur die zuletzt aktualisierten
Sitzungen bzw. Aussagen betrachtet (`settings.tenantEvidenceSessions.maxCandidates`,
Standard 64 je Quellentyp); die Gesprächsreferenzen werden einmal je Suche geladen. Die Fallpolitik einschließlich
Clearance und bestehender Teamauflösung bleibt maßgeblich: Die heutige
`tenantCasePolicy` bildet auch historische `own`-/`team`-Einstellungen auf die
mandantenweite Sichtbarkeit ab. Phase B führt dafür keine abweichende Mitgliedschafts-
oder Gateway-Regel ein. Eine gesperrte Herkunft wird weder angeboten noch gelesen.
Vor jedem Read werden Inhaltshash, Deskriptor-Fingerprint, Status, aktuelle Sitzung
und personenbezogene Korrektur erneut geprüft.

Deskriptoren bleiben an ihren Originalrecords: am Turn-Memory bzw. an der gespeicherten
Aussage. Neue Inhalte erhalten sofort das deterministische Minimum. Ältere Bestände
werden erst bei einer passenden Anfrage nachgezogen. Die Projektion verwendet Titel,
Gegenstands-/Kennungsanker, Abschnittsbezeichnungen, Zeitraum und Status; Manifest-
Fragetypen und einzelne Inhaltsfacetten werden aus diesen projizierten Bezeichnungen gewonnen. Gesprächsverlauf, letzte Inhaltsfrage, Antworttext und
Aussagenwortlaut gelangen nicht in Deskriptor-Prompts. Die bestehende Hintergrundqueue
behält ihre Grenzen (64 wartend, 1 aktiv, 30 s Standardabstand, 16 KB Metadaten,
1 Versuch, 1.200 Tokens, 5 s). Sie schreibt nur nach erneuter Prüfung des Originalstands;
Korrekturen und jüngere Inhalte bleiben erhalten.

Nur verwertbare Einordnungen sind Inhalt. Titel ohne Aussage, interne Beschreibungen
wie „Der Benutzer möchte …“, Rückfall- und Fehlerantworten bieten sich nicht an und
werden nicht als „Letzte Einordnung“ projiziert. Neue Einordnungen werden vor dem
Fall-Footer gespeichert. Das aktuelle Gespräch und der aktuell daran gebundene Fall
sind als ältere Sitzung ausgeschlossen. Bei neuen Schlussfolgerungen wird ihre
Upload-Herkunft gespeichert: Dokument-/Datensatzantworten werden nicht zusätzlich
als Sitzungsquelle angeboten. Bei Altdaten ohne diese Herkunftsmetadaten unterdrückt
die Registry Sitzungsangebote, deren Fall/Gespräch bereits durch einen sichtbaren
Upload repräsentiert ist. Dokumentabgeleitete Tenant-Memory-Aussagen bleiben ebenfalls
bei ihrer Dokumentquelle. Eigenständige Sitzungsinhalte können gemeinsam mit passenden
Dokumenten und Datensätzen gelesen werden.

Reine Tabellenablage verwendet bereits vor der Bezugsauflösung denselben bestehenden
strukturellen Datensatzpfad wie der Inhaltsturn. Zuvor werden passende deterministische
Deskriptorangebote ohne Bezugsauflösung geprüft, damit auch Inhaltsbitten direkt am
Upload erhalten bleiben. Eine Ablagebestätigung ohne Datenread
ruft `evidence_reference_resolution` nicht auf. `supplementDatasetAnswer` verlangt
belegte Read-Evidenz oder ein strukturiertes Abfrageergebnis; eine Datensatz-ID allein
reicht nicht. Inhaltsfragen direkt am Upload und strukturelle Blatt-/Einheitenantworten
behalten ihre bisherigen Pfade.

Das generierte Szenario `earlier-session` prüft zwei Formulierungen im neuen Chat,
Herkunft, unpassende Fragen, Korrektur und einen ursprünglichen Rückfall. Der Offline-
Replay verwendet `createLocalTransport`, den vollständigen Workbench-Harness,
schema-validierte Modellstubs und unveränderte `checkTurn`-Erwartungen. Details und
der Live-Vorbehalt stehen in [927-phase-b.md](validation/927-phase-b.md).


## Runde 2: semantischer Bezug älterer Gespräche und Antwortgrenzen

Der gemeinsame deterministische Selektor stellt seine bestehenden Kandidatenbewertungen
über `onRanked` bereit. Erreicht eine sichtbare Quelle volle Gegenstandsdeckung mit
lokalen Ankern, aber keine ausreichende lexikalische Inhaltsdeckung (`no_content`/`below_threshold`), darf
sie zusätzlich in `contextualEvidenceQuestion` eingehen. Typisierte Kennungen bleiben
als `subjectIdentifiers` in den Routing-Metadaten erhalten; ihre vollständigen Werte
müssen in der Frage vorkommen. Teilwerte oder ein bloß gleicher Standort bei abweichender
Kennung reichen nicht. Die Modellentscheidung bestätigt den Inhaltsbezug, niemals einen
Zugriff oder eine Antworttatsache. Es gibt weiterhin nur denselben Prompt-/Schema-Pfad
`evidence_reference_resolution`, höchstens acht Kandidaten, 64.000 Byte Prompt und einen
Versuch mit fünf Sekunden Timeout. Das Antwortschema verwendet keine `uniqueItems`;
die lokale Quellenmenge dedupliziert IDs und weist unbekannte IDs zurück.

Nach Bestätigung werden die Kandidaten erneut autorisiert gesammelt. Unbestätigte Kandidaten
der neuen Gegenstandsbrücke sind ausgeschlossen; die schon vorhandene deterministische
Ergänzung komplementärer Quellen bei impliziten Gesprächsbezügen bleibt erhalten. Originalread, Fingerprint-/Hashprüfung und Audit
bleiben unverändert. Die generischen Turnpfade behalten `contextualEvidence: 'skip'`
und den nachgelagerten Aufruf mit `'only'`. Ohne Gegenstandsbezug entsteht kein neuer
Bezugsaufruf. Ein positiver semantischer Bezug ersetzt weiterhin
`evidence_request_kind`; es gibt keinen zweiten Inhaltsklassifikator. Die Ausformulierung
verwendet anschließend die frisch gelesene Evidenz. Die erfolgreichen Sitzungsfragen
des Replays benötigen so genau zwei Vordergrundaufrufe (Bezug und Ausformulierung),
getrennt von der lokalen Hintergrundanreicherung. Das ist pro solchem Turn höchstens
ein zusätzlicher Bezugsaufruf gegenüber einem erfolglosen deterministischen Routing,
keine zusätzliche Bezugsaufrufserie. Strukturierte Blatt-/Einheitenantworten bleiben
LLM-frei hinsichtlich dieser Auflösung. Der Hotfix für eigene Uploads bleibt erhalten.

Der gemeinsame Antwortfilter vergleicht Antwortsätze mit ihren tatsächlichen internen
Ursprungsfeldern (`concern`, `situation`, `requestedAction.description`), auch wenn die
Antwort die vollständige interne Aussage in einen längeren Satz einbettet. Literale,
belegte Nutzerberichte bleiben zulässig. Dieselbe Erkennung schützt Schlussfolgerungen;
fachliche Statusfelder des gespeicherten Turn-Memory sind keine internen Arbeitsaufträge.

Die direkte Fallübersicht benötigt einen passenden expliziten Ausgabevertrag oder den
bereits bestehenden serverseitigen Statuspfad. Ältere interne Aufrufer ohne Ausgabevertrag
behalten ihre bisherige Darstellung. Bei einer ausdrücklich als gewöhnliche Antwort
klassifizierten Inhaltsfrage werden Falltreffer auf sichere Schlussfolgerungen reduziert;
eine Fallhülle ohne solche Schlussfolgerung liefert keine Antwort-Evidenz. Dadurch können
Rückfallvorgänge nicht als Übersicht mit leeren Verwaltungsfeldern in Inhaltsantworten gelangen.

`createLiveHarness.drainDescriptors` arbeitet die wartenden bzw. laufenden Jobs aller lokalen
Quellendienste über `runDescriptorJob` ab. `createLocalTransport.send` ruft dies vor dem
allerersten Turn jedes neuen Gesprächs auf. Das simuliert Zeit zwischen Gesprächen;
Produktivqueue, Verzögerungen und Quoten bleiben unverändert. Der Offline-Replay prüft,
dass vor der ersten Folgefrage ein Sitzungsdeskriptor angereichert wurde und dessen
Fragetypen die Fragewörter trotzdem nicht wörtlich enthalten. Details: [Runde 2](validation/927-phase-b.md#runde-2).
