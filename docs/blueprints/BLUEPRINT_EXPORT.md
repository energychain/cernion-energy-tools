# Blueprint Export CLI

## Zweck

`scripts/export-blueprints.js` exportiert alle aktiven Blueprints aus dem
Blueprint Management REST API und schreibt sie als deterministisch formatierte
JSON-Dateien nach `src/blueprints/`.

Das Script ist der Übergang von Runtime-Blueprints (nur auf dem Dev Server
vorhanden) zu Git-versionierten Release-Artefakten, die in CI prüfbar und
nachvollziehbar sind.

## Voraussetzung

Der Cernion Dev Server muss laufen und über HTTP erreichbar sein.

## Beispielaufruf gegen Dev Server (Port 3900)

```bash
npm run blueprint:export -- --base-url http://127.0.0.1:3900 --out src/blueprints
```

### Optionen

| Option | Default | Beschreibung |
|---|---|---|
| `--base-url` | `http://127.0.0.1:3900` | Base URL des Cernion Servers |
| `--out` | `src/blueprints` | Ausgabeverzeichnis für die JSON-Dateien |

### Ausgabe

```
Blueprint Export — base-url: http://127.0.0.1:3900  out: src/blueprints

Exported: 3 blueprint(s)
  + src/blueprints/ev-charging-co2-optimization-v1.json
  + src/blueprints/grid-connection-validation-v1.json
  + src/blueprints/vdmi-compliance-v1.json
```

Exit code `0` bei Erfolg, `1` wenn mindestens ein Blueprint fehlschlug.

## Empfohlener Release-Ablauf

1. **v0.59.0 mergen** — enthält das Export-CLI und die Testabdeckung.
2. **Dev Server** auf v0.59.0 aktualisieren.
3. Export ausführen:
   ```bash
   npm run blueprint:export -- --base-url http://127.0.0.1:3900 --out src/blueprints
   ```
4. Exportierte JSON-Dateien inhaltlich prüfen (`git diff src/blueprints/`).
5. Änderungen committen:
   ```bash
   git add src/blueprints/
   git commit -m "chore(blueprints): export active blueprints from dev server v0.59.0"
   ```
6. Release-Tag `v0.59.1` setzen und mergen.

## Verhalten bei Fehlern

- HTTP-Fehler pro Blueprint werden gemeldet, der Export der übrigen Blueprints
  wird fortgesetzt.
- Fehlt das Feld `blueprint` in der API-Antwort, gilt das als Fehler für
  diesen Blueprint.
- Am Ende wird eine Fehlerliste ausgegeben und der Prozess beendet sich mit
  Exit Code `1`, wenn mindestens ein Fehler aufgetreten ist.
- Ein vollständiger Verbindungsfehler beim Laden der Blueprint-Liste bricht den
  Export sofort ab.

## Implementierte API-Endpunkte

```
GET /api/blueprint-management?includeDrafts=false&includeActive=true
GET /api/blueprint-management/:blueprintId
```

Der zweite Endpunkt liefert `{ blueprint: { ... } }`. Das Script extrahiert
das Feld `blueprint` und schreibt es als `<blueprintId>.json`.
