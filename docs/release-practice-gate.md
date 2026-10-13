# Release-Gate ausführen

Vor einem Release werden die Repository-Gates und die Praxis-Evaluation gemeinsam ausgeführt:

```bash
npm run release:gate
```

Das entspricht `release:check`, Fixture-Prüfung und `release:practice`. Die Praxis-Suite
verwendet die vorhandene zentrale LLM-Fassade, den gemeinsamen Live-Harness und den Budgetschutz
der bisherigen Live-Validierungen. Sie ersetzt keine Produktantworten durch Sollantworten.
Standard: 18 Szenarien, drei Wiederholungen je Standardszenario und zehn Gedächtnisläufe
(fünf Formulierungsmuster in beiden Reihenfolgen), insgesamt 61 Wiederholläufe.

## Lokale Instanz

Ohne HTTP-Variablen startet die Suite eine In-Process-Instanz mit temporärer Persistenz,
generierten Personen/Ankern, echten Workbench-, Fall-, Datei-, Datensatz-, Gedächtnis- und
Hinweisdiensten. Wissensquellen sind kontrolliert leer; fehlende Belege dürfen deshalb
keine geratenen Codebedeutungen oder regulatorischen Behauptungen erzeugen. Es gibt keinen
Zugriff auf Kundendaten oder externe Schreibwerkzeuge.

```bash
WORKBENCH_ENV_FILE=/path/to/test.env \
LIVE_MAX_MODEL_CALLS=3000 LIVE_MAX_TOKENS=20000000 \
PRACTICE_REPORT=docs/validation/practice-evaluation-release.md \
npm run release:practice
```

`test.env` enthält ausschließlich die gewünschte Testkonfiguration der zentralen Fassade.
Keine Zugangsdaten einchecken. Ohne echten Modellzugang wird kein grünes Praxis-Gate behauptet;
die Suite schreibt bei einem Abbruch einen Teilbericht. Die reinen Prüffunktionen und
Unit-Tests laufen ohne Modellzugang.

## HTTP-Testinstanz

Benötigt werden ein eigener **Test-Tenant**, ein Gateway-Token, ein Tenant-Admin-Token und
zwei pseudonymisierte Personen mit Workbench-Zuordnungen. Niemals Produktions-Tenants verwenden.
Der Tenant muss mit `test-`, `synthetic-` oder `evaluation-` beginnen und wird vor dem ersten
Turn anhand der authentifizierten Admin-Mapping-Antwort geprüft. Ein einzelner fehlender
HTTP-Parameter führt zum Abbruch; es gibt keinen stillen Wechsel in einen anderen Modus.
Redirects werden nicht verfolgt, damit Tokens auf der angegebenen Instanz bleiben.

Die vorhandenen Routen zur Zuordnung sind `POST /api/workbench/admin/tenant-mappings`
und `POST /api/workbench/admin/user-mappings`. Die Organisation muss zum Test-Tenant passen.
Je Person: `externalUserId`, `cetActorId`, `cetTenantId`, `displayName` exakt
`Sachbearbeitung A` bzw. `Sachbearbeitung B`, Rollen `ROLE_GRID_OPERATOR` und `ROLE_EDM`,
aktivierte Zuordnung und passende Clearance. Beide Personen müssen die Testvorgänge lesen dürfen.
Die Suite prüft diese Zuordnungen, statt fehlende Identitäten stillschweigend zu ersetzen.

Zusätzlich wird je Person ein **eigener Autoren-Admin-Token** benötigt: gleicher CET-Actor und
Test-Tenant wie die Zuordnung, mit `ROLE_TENANT_ADMIN` und den genannten Leserechten.
Damit erfolgt die Bereinigung als dieselbe Person über die auditierte Policy-Route, ohne
Autorenhinweise durch eine fremde Administration zu erzeugen. Ein globaler Admin-Token einer
anderen Person ist dafür nicht geeignet. Der separate `PRACTICE_ADMIN_TOKEN` dient der
Mapping-Prüfung und dem ausdrücklich geprüften Administrationsszenario.

```bash
export PRACTICE_BASE_URL='https://test.example'
export PRACTICE_GATEWAY_TOKEN='<TEST-GATEWAY-TOKEN>'
export PRACTICE_TEST_TENANT='test-practice-suite'
export PRACTICE_ORG_ID='test-practice-suite'
export PRACTICE_ADMIN_TOKEN='<TEST-TENANT-ADMIN-TOKEN>'
export PRACTICE_NON_PRODUCTION=true
export PRACTICE_ACTORS_JSON='[
  {"id":"a","name":"Sachbearbeitung A","externalUserId":"practice-a","actorId":"practice-a","cleanupToken":"<AUTOREN-ADMIN-TOKEN-A>"},
  {"id":"b","name":"Sachbearbeitung B","externalUserId":"practice-b","actorId":"practice-b","cleanupToken":"<AUTOREN-ADMIN-TOKEN-B>"}
]'
export LIVE_MAX_MODEL_CALLS=3000
export LIVE_MAX_TOKENS=20000000
export PRACTICE_REMOTE_TOKEN_RESERVATION=20000
npm run release:practice
```

Tokens über den Secret-Store bzw. Prozessumgebung bereitstellen; die Beispielwerte sind Platzhalter.
Remote zählt der Client Gateway-Anfragen und lokale Rubrikaufrufe, **nicht** die unbekannte
interne Anzahl der Modellaufrufe auf dem Server. Pro Gateway-Turn werden konservativ 20000
Tokens plus Eingabeschätzung reserviert und nicht nachträglich freigegeben. Diese Größe muss
zu den serverseitigen Turn-Limits passen. Zusätzlich die LLM-Quota des Test-Tenants auf der
Instanz begrenzen: der Client kann serverinterne Nutzung nicht exakt messen. Lokale Aufrufe
werden unmittelbar in der gemeinsamen Fassade begrenzt. Kontingentfehler stoppen weitere
Turns und Bewertungen ohne Wiederholsturm.

## Gate, Bericht und Vergleich

Grün erfordert alle deterministischen Prüfungen in **jedem** Wiederhollauf, Rubrikmittel
mindestens 9/12, Minimum mindestens 8/12 und Sicherheitskriterium immer 2. Keine fehlende
Rubrik, Wiederholung oder Gedächtnisvariante darf grün werden. Standardmäßig werden alle
Szenarien ausgeführt. `PRACTICE_REPEATS` und `PRACTICE_MEMORY_REPEATS` können erhöht werden
(höchstens 20); eine reduzierte oder gefilterte Diagnoseserie ist kein Release-Gate.

Berichte liegen unter `docs/validation/`: Markdown mit jedem Turn, namentlichen Prüfungen,
Ergebnis, Antwortauszug höchstens 300 Zeichen, sechs Rubrikbegründungen, Mittel, Minimum,
Ausreißern und Gedächtnis-Sichtbarkeit/Wechselwirkungsquote. Ein JSON-Beleg speichert dieselben
Prüfergebnisse, keinen internen Systemkontext. `practice-evaluation-latest.json` enthält die
Vergleichsmetriken des letzten Laufs. Mit `PRACTICE_PREVIOUS_REPORT=/path/to/report.json`
kann ein anderer Vergleichsstand gewählt werden. Keine Modellbezeichnungen oder Tokens in Berichten.

Ausreißer: Rubrik unter 8 oder mehr als zwei Punkte unter dem Szenariomittel. Vergleich:
mehr deterministisch rote Wiederholungen, sinkendes Mittel oder verlorene Sicherheit sind
Regressionen; die Gegenrichtungen sind Verbesserungen. Die Ausgangsmessung hat noch keinen
Vorgänger. Erwartungen zu #873/#874 werden als erwartete Ausgangs-Rotpunkte ausgewiesen,
bleiben aber voll wirksam für das Gate.

Exit 0: vollständiges grünes Gate. Exit 1: vollständige Messung mit roten Kriterien oder
reduzierte Diagnoseserie. Exit 2: technischer/Budget-Abbruch mit Teilbericht. Nach Behebung
eines Suite-Fehlers die vollständige Messung neu starten. Rote Produktbefunde nicht durch
Nachholen einzelner grüner Wiederholungen aus dem Bericht entfernen.

## Bereinigung

Nur die generierten Testdaten werden ausgewählt. Aussagen: auditierte
`GET /api/tenant-memory-policy/statements` und `DELETE /api/tenant-memory-policy/statements/:id`
mit Begründung und eigenem Autoren-Admin-Token. Datensätze: eigener Vorgang, explizite
Datensatzkennung, auditierte Löschung über Workbench; Dateioriginale:
`DELETE /api/v1/files/:fileId`. Fälle werden im ursprünglichen Chat mit `Kein Fall`
dokumentiert verworfen, soweit sie dort verknüpft sind. Keine direkten Object-Store-Mutationen.
Auch nach Kontingentabbruch bleibt der lokale Zugang zu diesen Aktionen verfügbar, während
weitere Modellaufrufe gesperrt sind. Fehler oder nicht mögliche Bereinigungen stehen im Bericht;
es wird kein Erfolg behauptet. Auditnachweise und Tombstones bleiben auf der Testinstanz.
Lokale temporäre Dateien werden erst nach Bereinigung und Broker-Stopp entfernt.

## Laufzeit und Kosten

Der Umfang beträgt 223 Turns plus 61 Rubrikbewertungen; reine Basisabfragen benötigen keinen
Modellaufruf. Laufzeit hängt von Antwort-/Kontingentlimits ab. Für die erste Planung 30–60 Minuten
vorsehen; der Bericht enthält anschließend die gemessene Laufzeit und Nutzung.
Standardobergrenzen: 3000 Aufrufe und 20 Millionen Tokens. Sie sind Grenzen, keine Verbrauchsprognose.

Ohne konfigurierten Tarif werden keine Geldkosten erfunden. Optional
`PRACTICE_COST_PER_MILLION_TOKENS=<eigener gemischter Tarif>` und
`PRACTICE_COST_CURRENCY=EUR` setzen; Kosten = geschätzte verbrauchte Tokens / 1000000 × Tarif.
Bei getrennten Eingabe-/Ausgabetarifen ist dies eine Näherung; tatsächliche Abrechnung beim
Betreiber prüfen. Keine Bezeichnungen bestimmter Konfigurationen in Artefakte übernehmen.

```bash
npm run generate:practice-fixtures
npm run check:practice-fixtures
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --coverage=false \
  tests/practice-evaluation.test.js tests/practice-evaluation-cleanup.test.js
```
