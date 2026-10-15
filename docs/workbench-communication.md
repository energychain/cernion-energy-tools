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
