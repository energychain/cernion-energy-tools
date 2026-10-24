# Gelernte Checks einer Projektakte (#889)

CET lernt lesende Auswertungen ohne Nutzerfreigabe. Ein `ProjectSkill` liegt als
`workbench_playbook` im vorhandenen Workbench-Skill-Register. `tenantId` und
`projectId` stammen ausschließlich aus Principal und autorisierter Aktenwahl.
`program` ist **CET-Skript-v1-Quelltext**, kein `steps`-Objekt. Die drei Exporte
`meta`, `tests`, `default` sind in [CET_SCRIPT.md](CET_SCRIPT.md) beschrieben.
Es gibt weder eine Freigabeoberfläche noch einen zusätzlichen öffentlichen Endpunkt.

## Datenfluss

1. Der vorhandene Manifest-/Evidenzselektor wählt Akte, Fragetyp und Tabellen.
   Nach einer erfolgreichen, lückenfreien Tabellenantwort wird ein begrenzter
   erfolgreicher Antwortpfad vorgemerkt: ausgeführter Query-Plan, Ergebnis, Schema,
   Einheiten und Herkunft. Höchstens zwei Tabellen, je 100 Ergebniszeilen und
   insgesamt 24 KB; keine Originaldatei und keine unbegrenzten Rohzeilen.
2. Ein Hintergrundjob prüft wiederholte Fragen derselben Akte und desselben
   Fragetypen per `llm-client.embeddings` und Kosinusähnlichkeit. Ohne nutzbare
   Embeddings entsteht daraus kein Anlass. Unabhängige Anlässe sind ein erfolgreich
   beantworteter Manifest-Fragetyp ohne `skillRefs` sowie ein degradierter Skill.
3. `llm-client.generateStructured` entwirft genau ein CET-Skript aus Manifest,
   Graphausschnitt, Spaltenmetadaten und erfolgreichem Antwortpfad. Die Ausgabe
   enthält nur Programm und JSON-Eingabe; sie darf keine Tenant-/Aktenbindung setzen.
4. Die automatische Prüfkette entscheidet über Aktivierung. Jeder Fehler belässt
   den Entwurf in `draft`. Die Aktivierung benötigt auch ein verfügbares Journal.
5. Aktive Skills erscheinen als `skillRefs` am bestehenden Manifest-Fragetyp.
   Nach dessen Wahl prüft ein begrenzter Parameteraufruf, ob die aktuelle Bitte
   dieselbe Auswertung verlangt, und bindet ausschließlich schema-valide Eingaben.
   Alle gespeicherten Prüffälle und die Antwortausführung laufen erneut unter
   **derselben** Akten-Mutationssperre und auf derselben autorisierten Datensicht.
6. Die deterministische Antwort nennt „nach meinem gelernten Check ‚…‘“, die
   Ergebniswerte und Datei/Fundstelle/Hash. Strukturierte Evidenz enthält
   `skillId`, `replayHash` und die Zahlenherkunft aus dem Interpreter. Zusätzlich
   angefragte Kataloge werden weiter getrennt über den bestehenden Evidenzleser gelesen.

## Automatische Prüfung

- Statische CET-Skript-Syntax-, Schema-, Scope- und Operationsprüfung aus #888.
- Keine abgeleiteten Schreibvorgänge: statische Sperre für `derived` und fehlender
  Commit-Adapter im Interpreter. SQL und `cet.op` behalten alle Sperren aus #888.
- Abgleich des Originalergebnisses mit der tatsächlich belegten Antwort
  (gleiche Zeilen, Spalten und Werte; absolute Toleranz `1e-8`).
- Zwei Originalausführungen müssen identisches Ergebnis und identischen Replay-Hash
  liefern. Es werden keine Tenant-IDs gehasht.
- Ein bis acht Skriptprüffälle gemäß CET-Skript §7. Numerische Testtoleranzen sind
  auf `0.001` begrenzt und können die strengere Originalprüfung nicht abschwächen.
  Erwartete Fehler sind nur für ungültige Eingaben zulässig; Container-, Schreib-
  und Budgetfehler bei gültigen Eingaben sind Aktivierungsfehler.
- Mindestens ein **vom Host** aus Manifest-Zeiträumen oder Entitätsnamen abgeleiteter
  zusätzlicher Eingabefall. Zeitintervalle behalten ihre Reihenfolge und sind
  nicht leer. Die geänderte Eingabe muss eine andere Leseabfrage erreichen;
  numerische Auswertungen brauchen auch dort numerische Evidenz. Fehlt ein
  geeigneter zusätzlicher Fall, wird nicht aktiviert.
- Budgetierter Interpreter: insgesamt höchstens 5 Sekunden für die gemeinsame
  Prüfsitzung; je Lauf 500.000 Schritte, 8 SQL-Abfragen, 1.000 Zeilen je Abfrage,
  4.000 SQL-Ergebniszeilen, 64 KB Ergebnis und 2 lesende Operationsaufrufe.
  Auch ein abgefangener Interpreter-Budgetfehler bleibt ein Fehler.

Die Prüfung belegt die gespeicherten Fälle, nicht die allgemeine Richtigkeit aller
möglichen Eingaben. Zusätzliche Fälle werden bei Aktivierung mit ihrem Ergebnis
festgehalten und bei jeder Neuprüfung wieder verglichen.

## Lebenszyklus, Korrektur und Sichtbarkeit

`draft → active → degraded → neuer draft | retired`.
`project.graph.changed.v1` und `project.manifest.changed.v1` planen Neuprüfungen.
Scheitern gespeicherte Fälle, wird der Skill `degraded` und verschwindet aus den
aktiven `skillRefs`. Eine ausstehende Hintergrundprüfung erlaubt keine ungeprüfte
Nutzung, weil der Antwortpfad die Fälle selbst erneut prüft. Ein Neuentwurf braucht
wieder eine aktuelle belegte Antwort; die unveränderte belegte Auswertungspfad
genügt nach einer Ergebniskorrektur nicht für erneute Aktivierung. Ein neuer belegter
Antwortpfad kann einen gescheiterten Nachfolger ersetzen; dabei gelten dieselben Budgets.

Jede Zustandsänderung emittiert
`project.skill.lifecycle.v1 { tenantId, projectId, skillId, lifecycle, reason }`.
Das bestehende Journal führt `created`, `decided`, `corrected`, `retired` mit
sichtbarkeitsgeprüften `projectSkill`-Referenzen. Titel unsichtbarer Akten werden
auch in Journal-Zusammenfassungen verborgen.

„Welche Skills hast du für Projekt X gelernt?“ ist eine strukturelle Zustandsfrage
im vorhandenen Intent-/Aktivitätsrouter. Sie liest Register und Journal, nennt
Anlass und Stand und benötigt keine Modellgenerierung. Nach einer Skill-Antwort
bezieht sich „passt nicht“ auf diesen Check; „Check stilllegen“ beendet seine Nutzung.
Programmgesteuerte Korrekturen gehen durch die bestehende Lernschleife:

```json
{
  "target": "projectSkill",
  "correction": { "projectId": "project-example", "skillId": "learned-example", "kind": "incorrect" }
}
```

Weitere Arten sind `retire` und `transfer` (zusätzlich `destinationProjectId`).
Eine Übertragung autorisiert beide Akten, formuliert im Hintergrund eine passende
Frage für die Zielakte, liest dort über denselben Manifestselektor eine eigene
belegte Antwort und erzeugt einen **neuen** Entwurf mit eigener Prüfung und
`derivedFrom`. Quellprogramm, Originalergebnis und Aktivierung werden nicht kopiert.
Eine nicht beantwortbare Zielfrage ergibt höchstens einen fehlgeschlagenen Entwurf.
Korrektur-IDs sind idempotent. Versionsvergleich und Invalidierung laufender Jobs verhindern, dass ein laufender
Entwurf oder Nutzungszähler eine neuere Korrektur überschreibt. Stilllegung stoppt
auch bereits entstandene abgeleitete Entwürfe derselben Akte. Neue reguläre Antworten,
Rollenänderungen und Upload-Kontexte beenden den alten Skill-Korrekturbezug.

`workbench.skills.list` unterstützt den optionalen vorhandenen Query-Parameter
`projectId`; Listing und `skills.get` autorisieren die Akte erneut. Allgemeine
Playbooklisten und das manuelle Governance-Matching übernehmen keine Projekt-Skills.
Die bisherigen manuellen Aktivierungsaktionen können sie nicht verändern.
Die registrierte Akten-Löschkaskade entfernt die Einträge aus demselben Store.

## Hintergrundbudget und Modellaufrufe

Vertrauenswürdige Dienstkonfiguration unter `workbench.settings.projectSkills`:

| Einstellung | Standard | Wirkung |
| --- | --- | --- |
| `delayMs` | 30000 | Abstand der Hintergrundjobs |
| `similarity` | 0.9 | Mindest-Kosinusähnlichkeit wiederholter Fragen |
| `draftsPerProject` | 3 | Entwürfe pro Akte und Stunde |
| `draftsPerTenant` | 12 | Entwürfe pro Tenant und Stunde |
| `manifestTrigger` | true | Entwurf nach belegtem Fragetyp ohne Skill |

Eine gemeinsame Queue koalesziert je Tenant/Akte, behält höchstens 64 wartende
Akten und 8 begrenzte Fragepfade je Akte und führt einen Job gleichzeitig aus.
Entwurfsversuche sind im Register dauerhaft budgetierbar. Es wird kein voller
Turn-Kontext in der Queue behalten; Hintergrundaufrufe erhalten nur den ursprünglichen
Principal und eine neu gebundene Broker-Aufruffunktion. Beim Stoppen werden Timer
und wartende Jobs entfernt und der laufende Job abgewartet.

Neue Aufrufe: höchstens ein Embedding-Batch zur Wiederholungserkennung und eine
Entwurfsgenerierung im Hintergrund (8 Sekunden, ein Versuch, 4.000 Ausgabetokens).
Aktive Nutzung benötigt einen synchronen Parameteraufruf (3 Sekunden, ein Versuch),
jedoch keine neue Query-Plan- oder Antwortprosa-Generierung des Skillpfads.
Übertragung benötigt zusätzlich eine Hintergrundformulierung der Zielfrage und
gegebenenfalls die reguläre Query-Plan-Erzeugung der Zielantwort. Zustandsfragen,
Stilllegung und Interpreterprüfungen erzeugen keine eigenen LLM-Aufrufe.

## Bestehende Schutzpfade

Uploads aus dem aktuellen Gespräch bleiben gemäß #954 im regulären Ablauf.
Rollenangaben, Personenschutz (#874), offene Tabellenklärungen, Blattwahl und
Einheiten haben ihre bisherigen Pfade; nur die vom Manifest gewählte tatsächliche
Auswertung ist ein Skill-Kandidat. Bei fehlendem Schema, zu großem Antwortpfad,
fehlender alternativer Testeingabe, fehlender Autorisierung oder unsicherer
Parameterzuordnung bleibt die reguläre Evidenzantwort maßgeblich.

Offline-Nachweis: [validation/889-skills.md](validation/889-skills.md).
