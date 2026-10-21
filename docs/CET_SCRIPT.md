# CET-Skript v1

CET-Skript ist eine geprüfte Teilmenge von ECMAScript 2022 für genau eine Projektakte.
Acorn 8.17.0 liest ein ES-Modul; ein eigener AST-Auswerter interpretiert es.
Der Quelltext wird niemals an die JavaScript-Laufzeit zur Ausführung übergeben.

## Interner Einstieg

```js
const { runProjectSkill } = require('../src/cet-script/project');
const output = await runProjectSkill(ctx, {
  projectId,
  source,
  input,
  asOf: '2026-10-16T10:00:00Z',
  // budgets: ausschließlich vertrauenswürdige Konfiguration des Mandanten
});
```

`ctx` muss den authentifizierten auslösenden Nutzer enthalten. Der Einstieg prüft den
Principal und die Sichtbarkeit der Akte, hält deren vorhandene Ingest-Mutationssperre
und liest ausschließlich zugehörige Datensätze, Graphdaten und Dokumentquellen.
Es gibt keine zusätzliche REST-Route und keinen neuen öffentlichen Service.

`runSkill(source, input, options)` ist der interne Auswerter mit expliziten, **vertrauenswürdigen**
Adapter-Bindungen für Fixtures und interne Integrationen. Endpunkte dürfen weder `options`,
Adapter noch frei gewählte Tenant-/Datenversionen von einem Client übernehmen.
Produktive Aufrufer verwenden `runProjectSkill`.

Die Rückgabe enthält `result`, `replayHash`, Zahlenherkunft unter `provenance`,
einen Evidenzverweis im Format von `workbench-evidence` und das Ablaufprotokoll `log`.
Fehler enthalten `code`/`type`, `line` (ab 1), `column` (ab 0) und `details`.
Am Projekteinstieg kommt `scriptDiagnostic` als begrenzte Diagnose für das
Lebenszyklus-/Journal-Handling des Aufrufers hinzu. Dessen Zuordnung zu einer Funktion,
Journal-Persistierung und `degraded`-Status gehören zur Skill-Verwaltung #889;
der Interpreter verändert keine Aktivierungszustände.

## Modul und Sprache

Es sind genau drei Exporte erforderlich:

```js
export const meta = {
  id: 'grouped-values',
  version: 1,
  language: 'cet-script/1',
  intent: 'Werte nach Schlüssel zusammenfassen',
  inputs: {
    type: 'object',
    required: ['from', 'to'],
    properties: {
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
    },
  },
  outputs: { kind: 'table' },
};
export const tests = [{ input: { from: '2025-01-01', to: '2025-03-01' }, expect: { rows: 2 } }];
export default async function skill(input, cet) {
  const data = cet.table('data');
  const rows = await cet.sql`
    SELECT ${data.col('key')} AS key, SUM(${data.col('value')}) AS total
    FROM ${data}
    WHERE ${data.col('time')} >= ${input.from}
      AND ${data.col('time')} < ${input.to}
    GROUP BY key ORDER BY key`;
  return cet.result.table(rows, { title: 'Gruppenwerte' });
}
```

`meta` und `tests` sind statische Daten. ID, ganzzahlige Version, Sprachversion,
Absicht und Ausgabeart werden geprüft. Die budgetierte Eingabeschema-Teilmenge folgt Draft 2020-12 und verwendet keine
codegenerierende Schemakompilierung:
`type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`,
Zahlen-/Längen-/Anzahlgrenzen, `description`, `title` und die Formate `date`, `date-time`.
Referenzen, ausführbare Schema-Erweiterungen und Musterprüfungen sind ausgeschlossen.
Codegenerierende Validatoren wie `AJV.compile` werden hier bewusst nicht verwendet;
die erlaubten Schema-Schlüssel werden direkt und unter demselben Budget geprüft.
Die Prüffälle werden strukturell geprüft; ihre Aktivierungs-/Wiederholungssteuerung ist #889.

Unterstützt werden:

- `const`, `let`, Funktionsdeklarationen/-ausdrücke, Pfeilfunktionen, `async`;
- `if/else`, `for`, `for…of`, `while`, `do…while`, `break`, `continue`,
  `switch`, `return`, `try/catch/finally`, `throw`;
- Arithmetik, Vergleiche, bitweise und logische Operatoren, `??`, `?.`,
  bedingte Ausdrücke, Templates, Destrukturierung, Defaults, Spread und Rest;
- `await` ausschließlich für CET-Aufrufe und eigene asynchrone Funktionen;
  `Promise.all` ausschließlich mit CET-Aufrufen;
- getaggte Templates ausschließlich in der Schreibweise `cet.sql`.

Nicht gelistete AST-Knoten, Operatoren, globale Bezeichner, lexikalisch ungebundene Namen,
Importe, weitere Exporte, `var`, Klassen, Generatoren, `this`/`super`, Labels, `with`,
`delete`, `in`, `instanceof`, Getter/Setter, Methodenliterale, Regex und `RegExp`
werden abgelehnt. Nur `new Map()` und `new Set()` sind zulässig.
Whitelist-Namen dürfen nicht überschattet werden; `cet` darf nicht neu gebunden werden.

## Eingebaute Funktionen

Die Whitelist ist explizit; Methoden können weder vom Host-Prototyp geerbt noch über
Funktions-Eigenschaften erweitert werden. Rückrufe für Array-Methoden sind synchrone
Skriptfunktionen; asynchrone Rückrufe sind nicht Teil dieser Fassung.

- `Math` ohne `random`.
- `JSON.parse(text)` ohne Reviver; `JSON.stringify(value)` ohne Replacer oder weitere Argumente.
- `Number`, `isFinite`, `isInteger`, `isNaN`, `isSafeInteger`, `parseFloat`, `parseInt`;
  `number.toFixed` und die im Parser gelisteten Zahlenkonstanten.
- `String`, `Boolean`; String-Methoden `at`, `charAt`, `charCodeAt`, `codePointAt`,
  `includes`, `startsWith`, `endsWith`, `indexOf`, `lastIndexOf`, `slice`, `substring`,
  `split`, `trim`, `trimStart`, `trimEnd`, `toLowerCase`, `toUpperCase`, `normalize`,
  `repeat`, `padStart`, `padEnd`, `replace`, `replaceAll`, `concat`, `localeCompare`.
  String-Methoden akzeptieren ausschließlich primitive Argumente.
- `Array.isArray`, `Array.from` für eigene Arrays, Strings, Maps, Sets und eigene Iteratoren.
  Array-Methoden: `forEach`, `map`, `filter`, `reduce`, `reduceRight`, `flatMap`, `find`,
  `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `sort`, `slice`, `flat`,
  `concat`, `includes`, `indexOf`, `lastIndexOf`, `join`, `at`, `entries`, `keys`, `values`,
  `push`, `pop`, `shift`, `unshift`, `splice`, `reverse`, `fill`.
  `sort` erfordert eine Vergleichsfunktion; eigene Iteratoren bieten `next`.
- `Object.keys`, `values`, `entries`, `fromEntries`; `assign` ausschließlich auf
  veränderbare einfache Skriptobjekte.
- `Map` mit `size`, `get`, `set`, `has`, `delete`, `clear`, `entries`, `keys`, `values`;
  `Set` mit `size`, `add`, `has`, `delete`, `clear`, `entries`, `keys`, `values`.

Kein `Date`, Zufall, Timer, Netzwerk-, Datei- oder Prozesszugriff im Skript.
Es gibt keine implizite Objekt-zu-Primitiv-Konvertierung.

## CET-API

| API                                                   | Vertrag                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `table(alias)`                                        | Eigener `datasetId` oder eindeutiger Name aus deterministischen Manifest-Routingquellen; unbekannte/mehrdeutige Namen scheitern.         |
| `handle.col(name)`                                    | Nur vorhandene freigegebene Spalten; ergibt einen nicht veränderbaren Bezeichner-Handle.                                                 |
| `handle.columns()/unit(name)/timeField()`             | Freigegebene Spaltenmetadaten, Einheit und Zeitfeld.                                                                                     |
| `datasets()`                                          | Metadaten ausschließlich der eigenen Akte.                                                                                               |
| ``sql`…` ``                                           | Eine lesende Anweisung; Handles als quotierte Bezeichner, andere Werte als Parameter.                                                    |
| `await graph.nodes({kind,label,limit})`               | Sichtbare Knoten, Limit höchstens 1000; externe Knoten nur mit ID, Art und Referenz.                                                     |
| `await graph.neighbors(nodeId,{relation,depth})`      | Knoten und Kanten der eigenen Akte, Tiefe 1–3.                                                                                           |
| `await graph.attribute(entityAlias,attributeAlias)`   | Eindeutiger Graphalias; Auflösung über `sameEntity`/`joinsOn`, tatsächliche Werte aus verknüpften Tabellen. Mehrdeutige Werte scheitern. |
| `await passages.search(query,{limit})/get(passageId)` | Nur eigene aktive Dokumentpassagen, inklusive Objekt-ID, Hash und Fundstelle; keine Vektor-/LLM-Abfrage.                                 |
| `await op(operationId,params)`                        | Indexgesteuerter lesender Aufruf mit ursprünglichem Principal und erzwungenem Tenant/Akte.                                               |
| `units.convert(value,from,to)`                        | Dimensionsprüfung und Faktoren aus `dataset-units.json`.                                                                                 |
| `stats`                                               | `sum`, `mean`, `median`, `quantile`, `min`, `max`, Populations-`stddev`, `groupBy`, `pivot`.                                             |
| `text`                                                | `includes`, NFKC-/Kleinschreibungs-`normalize`, `tokens`, Jaccard-`similarity`, ohne Regex.                                              |
| `time`                                                | `parse`, `format`, `bucket`, `range`; Schritte `PT15M`, `PT1H`, `P1D`, `P1M`, Standardzone Europe/Berlin und vorhandene DST-Auflösung.   |
| `time.asOf`                                           | Fester, erforderlicher Zeitpunkt aus der Anfrage.                                                                                        |
| `result.table/value/text/mixed`                       | Strukturierte Ausgabe; Textwerte über `${name}`-Platzhalter und ein Werteobjekt.                                                         |
| `cite(value,refs)`                                    | Explizite bekannte Knoten-, Passagen-, Datensatz- oder Objektreferenzen.                                                                 |
| `gap(description,{needs})`                            | Erfordert eine konkrete Beschreibung und mindestens einen Bedarf.                                                                        |
| `await derived.put(key,value,{describes})`            | Staging; eigene Zielknoten, Größenprüfung, atomarer Commit nach erfolgreichem Lauf.                                                      |
| `log(message,data)`                                   | Begrenztes Ablaufprotokoll ohne unbegrenzte Rohdatenausgabe.                                                                             |

Graph-Attribute benötigen beobachtete Verknüpfungen und eindeutige Schlüsselwerte.
Aus fehlenden oder widersprüchlichen Daten werden keine Werte geschätzt.

## SQL-Sicherheitsmodell

Der Dateipfad wird ausschließlich mit `project-file-disk.projectDirectory` aus der
Hostbindung ermittelt. Dateiname ist immer `project.sqlite`; Symlinks und nicht reguläre
Dateien werden für Datenbank, WAL und SHM abgelehnt. Jede Abfrage öffnet die Datei mit
`readonly: true`, `fileMustExist: true`, `query_only=ON`, `trusted_schema=OFF`.
SQL-Aufrufe einer Ausführung laufen nacheinander.

Die installierte `better-sqlite3`-API stellt keinen SQLite-Authorizer und keinen
Progress-Handler bereit. Die gleichwertige Beschränkung prüft deshalb **vor Ausführung**
`statement.readonly`, `statement.reader` und das vollständige `EXPLAIN`-Programm:

1. Nur ein `SELECT` beziehungsweise `WITH … SELECT`; Kommentare, rekursive CTEs,
   weitere Anweisungen, Verwaltungs-/Schreibbefehle und Systemzeit sind ausgeschlossen.
2. Jeder `OpenRead`/`ReopenIdx` darf ausschließlich Datenbank `main` und die tatsächliche
   Rootpage einer registrierten eigenen Datensatztabelle oder ihres Index verwenden.
   Schema-, Verwaltungs-, abgeleitete und fremde Tabellen sowie virtuelle Tabellen sind gesperrt.
3. `Column`-Instruktionen werden auch bei Indexzugriff gegen gesperrte Spalten geprüft.
   Persistente Schreibcursor und nicht explizit bekannte Opcodes sind verboten.
4. Nur aufgelistete SQL-Funktionen sind zulässig. `strftime` verlangt einen expliziten
   Zeitwert und unterstützt die einfachen Formatmarker `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, `%%`.
   `LIKE` nutzt eine begrenzte, unterbrechbare Implementierung. Erweiterungen, Zufall,
   SQL-Stringvergrößerung per Konkatenation und nicht begrenzte Formatfunktionen sind gesperrt.
5. Interne Checkpoints in Projektion, Filtern und Gruppenschlüsseln sowie Checkpoints in den Argumenten nativer
   Aggregate prüfen Zeit und Arbeit. Eine kontextsensitive Kontrollflussprüfung
   expandiert Unterprogramm-Rücksprünge und weist jeden Zyklus ohne Checkpoint zurück.
   Ergebniszeilen sind ebenfalls Checkpoints. Nicht beweisbare Pläne, insbesondere
   Coroutine-/skalare Unterabfragen und Window-Pläne, werden abgelehnt. Numerische
   Positionsangaben in `GROUP BY`/`ORDER BY` sind ausgeschlossen.
6. Eine konservative Volumenprüfung begrenzt Tabellenprodukte und den geschätzten
   Zwischenspeicher vor der eigentlichen Abfrage. Aufwendige, theoretisch optimierbare
   Abfragen können deshalb abgelehnt werden. Die geprüfte SQLite-Version ist `3.53.4` (Lockfile: `better-sqlite3` 13.0.3).
   Andere Engine-Versionen und unbekannte Opcodes scheitern geschlossen, bis ihre
   Instruktions-/Kontrollflussregeln erneut geprüft wurden.

Ein Worker führt nur diese geprüfte SQLite-Aufgabe aus, niemals Skriptquelltext.
Der Abbruch erfolgt kooperativ über die geprüften Checkpoints. Ein erzwungenes
`Worker.terminate()` während eines nativen Aufrufs würde JavaScript-Fehler der SQLite-Callbacks
unterdrücken und wird deshalb nicht als Zeitgrenze eingesetzt.

`dataset-query.quoteDatasetField` wird für Bezeichner wiederverwendet. Der freie SQL-Pfad
verwendet bewusst nicht `validateAndBindPlan`: dessen eingeschränktes Planformat verlangt
andere Operationen und ist kein Authorizer für beliebige `SELECT`-Ausdrücke. Der
Gleichheitstest vergleicht beide Wege auf einer echten akteneigenen Datenbank.

## Werte, Herkunft und Commit

Objekte besitzen Prototyp `null`. Funktionen, CET-Funktionen, Handles, Maps/Sets und
Iteratoren sind interne Marker mit privaten WeakMap-Einträgen; Hostfunktionen liegen nie
als Skriptwert vor. Arrays und Primitive erhalten ausschließlich freigegebene Methoden.

Datenübergänge kopieren eigene Daten-Eigenschaften tief. Getter/Setter, Symbole,
fremde Objektprototypen, Funktionen, Zyklen und übermäßig tiefe Werte werden abgelehnt.
Auch berechnete Schlüssel durchlaufen die Sperrliste: unter anderem `__proto__`,
`prototype`, `constructor`, Getter-Hilfen, `caller`, `callee`, `arguments`, `then`,
`toString` und `valueOf`. CET-Namensräume und Handles sind eingefroren.
JSON-Callbacks, fremde Iteratoren und `Object.assign(cet,…)` sind ausgeschlossen.

Jede Zahl erhält einen JSON-Pointer zur konservativen Herkunft des gesamten Laufs:
Skill-ID/-Version, Datenversion, Quellen mit Objekt-ID/Hash, Ablaufprotokoll und explizite
Zitate. `traceRef: "/log"` verweist dabei auf das einmal gespeicherte Ablaufprotokoll.
Dies ist keine fein aufgelöste Datenflussanalyse; zusätzlich gelesene Quellen
können in derselben Herkunft enthalten sein. Operationsrückgaben bleiben im begrenzten
Protokoll zur Erklärung externer Änderungen erhalten. Aufrufreihenfolge, nicht
Abschlussreihenfolge paralleler Aufrufe, bestimmt das Protokoll.

Abgeleitete Knoten liegen mit `describes`-/`derivedFrom`-Kanten in der internen Tabelle
`cet_script_derived` derselben `project.sqlite`. Ein gemeinsamer Skillknoten und tatsächliche
Graphquellen dienen als Herkunft. Spätere CET-Läufe vereinigen diese Knoten mit dem
bestehenden Graphsnapshot. Die öffentlichen Graphaktionen #886 lesen diese interne
Erweiterung derzeit nicht mit. Es gibt keine unvollständigen PouchDB-Bulk-Schreibvorgänge.
Der Host schreibt genau eine SQLite-Transaktion, nachdem alle begonnenen asynchronen
Aufrufe, Ergebnis-/Herkunftsprüfungen und Budgets erfolgreich abgeschlossen sind.
Eine Budgetüberschreitung vor dem Commit rollt die gesamte Transaktion zurück.
Sicherheits- und Budgetfehler sind nicht durch `catch` oder `finally` unterdrückbar.

`replayHash` ist SHA-256 über eine kanonisch serialisierte Folge aus Quelltext,
ursprünglichen Eingaben einschließlich `asOf`, Datenversion und genutzten Operationsversionen.
Tenant-Identitäten werden nicht als Hashgrundlage verwendet. Gleiches Programm mit
unveränderten Eingaben und Datenständen liefert denselben Hash; externe Operationsdaten
können sich außerhalb der lokalen Datenversion verändern und werden deshalb protokolliert.

## Budgets

Die Standardwerte der abgestimmten Spezifikation bleiben unverändert:

| Name                |                            Standard |
| ------------------- | ----------------------------------: |
| `steps`             |                           5.000.000 |
| `runtimeMs`         |                              30.000 |
| `sqlQueries`        |                                  50 |
| `sqlRowsPerQuery`   |                             200.000 |
| `sqlRowsTotal`      |                           1.000.000 |
| `opCalls`           |                                  20 |
| `graphAccesses`     |                                 200 |
| `recursionDepth`    |                                 200 |
| `resultBytes`       | 2 MiB, inklusive Herkunft/Protokoll |
| `derivedEntries`    |                                  10 |
| `derivedEntryBytes` |                             256 KiB |

Zusätzliche Schutzgrenzen: `sourceBytes` 64 KiB, `astNodes` 20.000,
`valueBytes` 8 MiB für Werte-/Übergangsvolumen, `collectionItems` 200.000 und
`memoryBytes` 64 MiB für konservativ gezählte Erzeugungen beziehungsweise SQL-Zwischenspeicher.
Es handelt sich bei `memoryBytes` nicht um eine Messung des Prozess-RSS.
Kopien und temporäre Werte zählen mit; diese Grenze darf früher greifen als ein Zeilenlimit.
Nur positive sichere Ganzzahlen sind als Hostkonfiguration zulässig.
Nach Erhalt der Akten-Mutationssperre teilen sich Snapshot-Laden, Historieniteration
und Skriptauswertung dasselbe Budget. Budgets gelten über `await` hinweg und auch für
ignorierte gestartete Aufrufe. Die vollständigen gespeicherten Ableitungsdatensätze
einschließlich Herkunft zählen gegen `derivedEntryBytes`.

## Fehlercodes und Betriebsgrenzen

- `CET_SCRIPT_FORBIDDEN_SYNTAX`: Syntax, Export-/Metadatenvertrag oder Whitelist verletzt.
- `CET_SCRIPT_UNKNOWN_TABLE`: unbekannter oder mehrdeutiger eigener Tabellenalias.
- `CET_SCRIPT_SQL_REJECTED`: Anweisung oder kompilierter Plan nicht freigegeben.
- `CET_SCRIPT_OPERATION_REJECTED`: Index-, Scope-, Rollen- oder Domänenprüfung fehlgeschlagen.
- `CET_SCRIPT_CONTAINER_VIOLATION`: fremde Referenz, unsicherer Wert, Schlüssel oder Mutation.
- `CET_SCRIPT_BUDGET_EXCEEDED`: Grenzwert erreicht, `details.budget` nennt das Budget.
- `CET_SCRIPT_RUNTIME_ERROR`: sonstiger Skript-/Datenfehler.

Dies ist keine Betriebssystem-Isolation. Native SQLite-/Node-Fehler, beschädigte Dateien,
Dateisystemrennen mit einem gleichberechtigten Hostprozess und falsch deklarierte
Operationseffekte bleiben Risiken. Die Operationsauswahl liest den Index bei jeder Ausführung
neu und verlangt leere `sideEffects` **und** `writesTo`, `consequenceLevel === 'none'`,
`agentable !== false`; fehlende Effektangaben scheitern geschlossen. Scopes, Aktionsrollen,
Domänen, Tenant/Akte und Rückgabereferenzen werden zusätzlich geprüft. Interne
Ingest-/Graph-Capabilities gelangen nicht in Operationsaufrufe.
Vor dem automatischen Einsatz durch #889 ist ein unabhängiges Security-Review sinnvoll.
