# Fachliche Belastbarkeit und Kommunikation (#874)

Das bestehende Lagebild und die Ausgabeform aus #873 bleiben die Grundlage. Der
aktuelle Antwortvertrag, strukturelle Code-Tokens und Gesprächspräferenzen werden
mit geschlossenen Schemas geprüft. Code-Familien, Systemnamen und Fachbegriffe
werden nicht als Wortlisten im Kern hinterlegt. Alle zusätzlichen Aufrufe verwenden
`src/llm-client.js` und die bestehenden Quoten-, Datenschutz- und Reparaturwege.

## Quellen und Glossar

Codebedeutungen benötigen einen wörtlichen Treffer mit passender Familie sowie
Dokumenttitel und Abschnitt oder URL. Der EDIFACT-Adapter und die bestehenden
Adapter für `knowledge-rag` und `knowledge-rag-federated` werden wiederverwendet.
Ohne qualifizierte Fundstelle wird jede angefragte Bedeutung ausdrücklich als
„nicht belegt“ ausgegeben. Modellwissen ergänzt keine Codebedeutung. Normative
Aussagen ohne Fundstelle sind als zu prüfende Annahme markiert.

Tenant-Definitionen liegen im vorhandenen Gedächtnis als Glossarfeld eines
auditierten Aussagenobjekts. Der [Gedächtnis-Leitfaden](tenant-memory.md) beschreibt
Zugriff, Widerruf, vollständige Redaktion und die auditierte Glossarroute.

## Entwürfe und Gespräch

Ausgabeteile unterscheiden interne und externe Zielgruppen sowie Brief und Sachartefakt
unabhängig voneinander. Interne Briefe bleiben möglich; eine Fassung für eine Zielgruppe
erzeugt noch keinen Brief. Ein eigener Prüfschritt
nach Erstellung klassifiziert Titel und Absätze und neutralisiert nicht erforderliche
Drittbeteiligte, Systeme, interne Ursachen und Personendetails. Interne Inhalte bleiben
im internen Teil. Die wörtliche Offenlegungsgrenze gilt auch dann, wenn die Prüfung
einen Absatz fälschlich freigibt. Die Prüfung nutzt auch die tatsächlich gelieferten
Quellen und die zuvor schemagebunden erkannten internen Systeme. Eine unvollständige
Prüfung gibt keinen Entwurf frei.

Anrede, Kürze, Sprachvorgaben und Rückfragewunsch bleiben im Turn- und Fallgedächtnis.
Ein reiner Arbeitsmodus erzeugt noch keinen Klärfall. Bei einem konkreten Problem und
ausdrücklichem Rückfragewunsch werden höchstens drei relevante, noch nicht gestellte
Fragen zusätzlich zur vorläufigen Einordnung gestellt. Die bisherige gelegentliche
Rückfragepraxis bleibt ohne diese Präferenz erhalten.

Personenbewertungen trennen berichtete Beobachtung, unbewiesene Nutzerhypothese,
mögliche Wirkung und führungsfähige Formulierung. Eine Nutzerdeutung wird weder als
eigene Arbeitsannahme noch als organisationsweite Tatsache gespeichert.

## Eigene Rolle als Arbeitskontext (#925)

`roleStatement` klassifiziert den Subjektbezug (`self`, `other_person`, `mixed`, `none`)
getrennt von `personAssessment`. Die Prüfung erfolgt nach allen Verstehens- und
Präferenzklassifikationen, bevor der Schutzpfad ausgeführt wird. Nur `self` mit
wörtlichem Nachweis für Rolle, Auftrag und Ziel kann die Personenbewertung aufheben.
Dazu muss entweder die Rolle grammatisch in erster Person benannt sein oder
`answersQuestionKey` eine gespeicherte offene Rückfrage mit `kind=role` beantworten.
Ein bloßes „Ich glaube“ über eine andere Person ist keine eigene Rollenangabe.
Dritte und gemischte Aussagen behalten den Schutzpfad; keine Phrasenliste erkennt Rollen.

Der vorhandene `conversationContext` speichert `role`, `mandate`, `goal` und `basis`
im nach Tenant, Akteur, Kanal und Gespräch getrennten Conversation-Dokument.
`basis` ist ein unverändertes Belegstück aus der äußeren Nutzernachricht, kein interner
Situationstext. Der Kontext bleibt nach Ablauf des kurzfristigen Lagebilds erhalten.
Beantwortete Rollenfragen werden in `askedQuestions` als beantwortet fortgeführt.
Der Kontext liegt zugleich im persistenten Lagebild und gelangt bei normalen
Vorgangsturns über den bestehenden `knownContext.situation`-Pfad in den Vorgang.
Er wird nicht als organisationsweite Sachbehauptung oder als Berechtigung übernommen.

Reine Rollenmitteilungen erhalten eine kurze sichtbare Bestätigung mit Korrekturhinweis.
Eine neue eigene Rollenangabe, etwa „Korrektur: …“, ersetzt Rolle, Auftrag und Ziel
über denselben beleggebundenen Pfad; es gibt keine eigene Korrekturphrase im Code.
Folgeturns verwenden den Kontext im Antwort-Prompt für passende Schwerpunkte, Fragen
für die weitere Befassung, belegte Risiken mit Fundstelle und markierte Einschätzungen.
Vorbereitete Fragen gegenüber Dritten tragen im Antwortschema `questionTarget=other`;
Rückfragen an den Nutzer bleiben ausschließlich in `missingInformation`.
Interne Situationstexte sowie unbelegte Angaben bleiben durch die bestehenden Filter geschützt.
`roles`, `roleFamilies`, `domainsAllowed`, Clearance und Gateway-Regeln werden durch
Selbstauskünfte nicht verändert. Die Rolle gilt für dieses Gespräch, nicht automatisch
als dauerhafte Rollenänderung des Nutzerprofils oder für andere Gespräche.

## Verbundene Vorgänge

Ein Vorschlag enthält Titel, Typ, Bezug, Owner-Rolle, Frist, nächste Befassung und
Wiedervorlage. Fehlende Termine bleiben zur Abstimmung. Der Vorschlag wird im
aktuellen Gespräch gespeichert. Nur die ausdrückliche Antwort „Leg an“ legt ihn
über den vorhandenen Router an. Der Parent wird mit frischer Revision verknüpft;
Bestätigung und Herkunft bleiben am neuen Vorgang gespeichert. Wiederholungen ohne
offenen Vorschlag legen keinen weiteren Vorgang an. Die Suche aus #873 zeigt die
Arbeitsfelder auch in einem neuen Chat und prüft dieselbe Tenant-Sichtbarkeit und
Clearance. Die Statusroute nutzt bei fehlender direkter Zuordnung dieselbe semantische
Suche. Sie legt keine Fälle oder Gesprächs-Turns an und quittiert keine Ereignisse.
CET versendet keine Nachrichten und ändert keine externen Systeme.

## Lokale Abnahme

```bash
WORKBENCH_VALIDATION_NON_PRODUCTION=true \
WORKBENCH_ENV_FILE=/path/to/test.env \
PRACTICE_REPORT=/tmp/workbench-874-practice.md \
WORKBENCH_VALIDATION_REPORT=/tmp/workbench-874-live.json \
LIVE_MAX_MODEL_CALLS=2000 LIVE_MAX_TOKENS=15000000 \
node scripts/validate-workbench-874-live.js
```

Das Skript verwendet die Praxis-Suite, ihren echten lokalen Transport, den Budgetschutz
und auditierte Bereinigung. Alle neun Szenarien laufen mindestens dreimal mit frischen
generierten Daten. Der zusätzliche JSON-Beleg enthält jede Antwort und die relevanten
Antwortvertragsfelder. Eine fokussierte Abnahme ersetzt kein vollständiges Release-Gate.
Die vollständige Suite wird gemäß [Praxis-Runbook](release-practice-gate.md) ausgeführt.
Berichte enthalten einen Fingerabdruck des Produktbaums zur Zuordnung unveränderter
Teststände. Kein Produktionszugriff und kein Deployment.

## Nicht belegte Wissensquellen

Die lokale Abnahme verwendet bewusst eine leere Testwissensbasis. Darin sind die folgenden
für #874 benötigten Quellen nicht auffindbar:

- EDI@Energy-Produkt- und Artikelcodelisten mit Gültigkeitsstand.
- Verzeichnisse der Prüfidentifikatoren mit Prozess- und Nachrichtenzuordnung.
- Codelisten und Anwendungshandbücher für Transaktionsgründe.
- APERAK-/Antwort-/Fehlercodelisten und zugehörige Anwendungshandbücher.
- Qualifierverzeichnisse mit Segment-, Element- und Formatkontext.
- Konkrete normative Fundstellen für die geprüften Anspruchsfragen.

Dies ist ein Befund der geprüften Testwissensbasis, keine Behauptung über einen unzugänglichen
externen Betreiberbestand. Beschaffung und Prüfung des dortigen Bestands übernimmt der
Betreiber. Erforderlich sind zur Nachricht passende Version, Dokumenttitel, Abschnitt/URL
und eine auffindbare Zuordnung von Code und Familie. Ein fehlender Zugang oder ein leerer
Treffer wird nicht durch eine plausible Bedeutung ersetzt.
