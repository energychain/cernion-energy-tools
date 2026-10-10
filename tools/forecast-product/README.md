# Produktprognose: Hilfsscripts und Runbook

Python 3.10+, laufende Cernion-Instanz mit dem Produkt-API-Contract und ein Tenant-gebundener
`ck_`-API-Token oder `csess_`-Session-Token sind erforderlich. Die Scripts laufen aus dem
Repository und verwenden den vorhandenen XLSX-Importer aus `../xlsx-forecast-test/`.
Sie trainieren über REST; lokal werden keine ML-Bibliotheken benötigt.

```bash
python3 -m pip install -r tools/forecast-product/requirements.txt
```

| Script / Befehl | Zweck |
|---|---|
| `seed_baseline.py` / `forecast_product.py seed` | XLSX-Referenzzähler initial importieren und gemeinsam trainieren |
| `enroll_meter.py` / `forecast_product.py enroll` | Einen neuen Zähler mit XLSX-/JSON-Historie importieren und trainieren |
| `forecast_product.py history` | Historie ergänzen, optional Korrekturen übermitteln |
| `forecast_product.py train` | Bereits importierte Zähler trainieren |
| `predict_meter.py` / `forecast_product.py predict` | Tagesprognose erzeugen und speichern |
| `score_meter.py` / `forecast_product.py score` | Gespeicherte Prognose(n) gegen Istwerte auswerten |
| `forecast_product.py retrain` | Neue Modellversion mit aktueller Historie erzeugen |
| `forecast_product.py resume` | Gespeicherten Job weiter beobachten oder ausdrücklich wiederaufnehmen |

## Tenant und Token

REST-Befehle lesen ausschließlich `CET_API_TOKEN` aus der Prozessumgebung oder `.env`.
`CERNION_TOKEN`, `CK_LOCAL_TOKEN` und andere Tokenvariablen werden niemals als Ersatz benutzt.
`--token-file /geschuetzter/pfad/token` bleibt als explizite Alternative möglich.
Ein gesetzter Umgebungswert hat Vorrang vor `.env`; die Token-Datei hat Vorrang vor beiden.

Ohne `--env-file` wird die nächste `.env` im Arbeitsverzeichnis oder einem seiner
Elternverzeichnisse verwendet; falls dort keine liegt, die `.env` im Repository.
Mit `--env-file /pfad/.env` lässt sich die Datei ausdrücklich wählen. Andere Variablen
werden nicht geladen, Variablenreferenzen wie `${CERNION_TOKEN}` werden nicht expandiert.
Tokens werden nicht in Run-Dateien oder Logs gespeichert.

Beispiel für die `.env`:

```dotenv
CET_API_TOKEN=ck_DEIN_TENANT_GEBUNDENER_API_TOKEN
CET_TENANT_OVERRIDE=false
# Nur bei ausdrücklichem Header-Override erforderlich:
# TENANT_ID=mein-tenant
```

Vor REST-Aufrufen wird der Token über `/api/tokens/verify` beziehungsweise `/api/auth/verify`
geprüft. **Die verifizierte Tenant-ID des Tokens ist maßgeblich.** `--tenant-id` ist optional;
eine abweichende Angabe blockiert den Aufruf nicht, sondern erzeugt einen Hinweis.
Run-/Ergebnisdateien und Modellzugriffe werden der tatsächlichen Token-Tenant-ID zugeordnet.
Ungültige Tokens oder Tokens ohne Tenant werden weiterhin vor dem Datenimport abgewiesen.

`CET_TENANT_OVERRIDE=false` (Standard): Der `X-Tenant-Id`-Header entspricht dem Token-Tenant.
`CET_TENANT_OVERRIDE=true`: Der Header verwendet `--tenant-id`, andernfalls `CET_TENANT_ID`
oder `TENANT_ID` aus Umgebung/.env. Ohne diese Angaben bleibt es beim Token-Tenant.
Dieser Header-Override ist **keine Berechtigungsumschaltung**: Die Produkt-API bindet den
Zugriff weiterhin an den Token und kann abweichende Header ignorieren oder ablehnen.
Ein Token eines anderen Tenants wird nicht durch eine lokale Einstellung ersetzt.

Alternativ für Bash ohne Token in der Shell-Historie:

```bash
read -r -s -p 'CET API-Token: ' CET_API_TOKEN
export CET_API_TOKEN
```

Die folgenden Beispiele enthalten `--tenant-id "$CET_TENANT_ID"` weiterhin als optionale
Angabe. Sie kann bei REST-Aufrufen vollständig entfallen. Die lokale Auswertung übernimmt
bei fehlender Angabe den Tenant aus der ersten Prognosedatei; alle ausgewerteten Dateien
müssen zu diesem Tenant gehören. `--dry-run` und `score` benötigen keinen Token.

`--base-url` ist standardmäßig `http://localhost:3900`. Bei einer externen Instanz die
passende HTTPS-Adresse angeben. HTTP-Weiterleitungen werden abgewiesen; direkt die finale
Adresse verwenden. Jeder Aufruf benötigt ein **neues** `--out`-Verzeichnis.

## 1. Initiales Training mit den elf XLSX

Aus `tmp/profile/` ausführen. Die Dateien müssen Viertelstundenenergie in kWh enthalten,
keine kumulierten Zählerstände. Der historische Prognoseursprung passt zum Datenende 2024.

```bash
python3 ../../tools/forecast-product/seed_baseline.py \
  --tenant-id "$CET_TENANT_ID" \
  --base-url http://localhost:3900 \
  --xlsx 1_2020-2024.xlsx 2_2020-2024.xlsx 3_2020-2024.xlsx \
         4_2021-2024.xlsx 5_2020-2024.xlsx 6_2021-2024.xlsx \
         7_2020-2024.xlsx 8_2020-2024.xlsx 9_2020-2024.xlsx \
         10_2021-2024.xlsx 11_2020-2024.xlsx \
  --unit kWh --time-basis berlin \
  --forecast-for 2024-12-31 \
  --out product_seed_20241231
```

`seed` und `enroll` verwenden beim Import ausdrücklich `historical_import: true` und beim
Training `strategy: shared_baseline`. Sie sind für **neue** Historien gedacht. Die IDs werden
beim Seed aus `Meldepunkt` als `meter-<Meldepunkt>` abgeleitet, nicht aus dem Dateinamen.
Alle Dateien werden lokal geprüft, bevor der erste Import erfolgt. Historischer Import
erklärt die damalige Verfügbarkeit der initialen Daten; er ist kein gewöhnliches Live-Update.

Mit zusätzlichem `--dry-run` wird nur der lokale Import-/Request-Plan gespeichert, ohne HTTP
und ohne Tokenprüfung. Das prüft Dateiformat und Parameter, nicht die serverseitige Trainierbarkeit.

`result.json` enthält `result.model_version` und `result.model.baseline_version` sowie die
Trainingsmetadaten. `run.json` enthält Tenant, Eingabeprüfsummen, bestätigte Imports und Job-ID.
Dieses historische Modell dient zur Initialisierung; für heutige Zähler werden mit deren
aktueller Historie eigene Modellversionen trainiert.

## 2. Neuen Kundenzähler aufnehmen

Auf Token und Tenant des Kunden wechseln. Aus `tmp/profile/` beispielsweise:

```bash
python3 ../../tools/forecast-product/enroll_meter.py \
  --tenant-id "$CET_TENANT_ID" --input neuer_zaehler.xlsx \
  --series-id kunde-zaehler-42 --unit kWh --time-basis berlin \
  --forecast-for 2026-09-28 --out kunde42_training
```

Datum passend zu Datenende und Informationsursprung wählen. Benötigt werden mindestens
28 verfügbare historische Tage, bei Lücken gegebenenfalls mehr; letzte zulässige Messung
höchstens sieben Tage alt. Der Ursprung D−1 07:00 darf nicht in der Zukunft liegen.
Alternativ akzeptiert `--input` ein Dataset-JSON mit `series_id`, `unit`, `timezone`, `values`.
Optionale Felder `reactive_power_kvar`, `profile_label` und deren Verfügbarkeitsangaben werden
bei JSON unverändert an die API übergeben. XLSX verwendet das bestehende Ein-Kanal-Format.

Beispiel einer JSON-Zeile (vollständige Historie entsprechend ergänzen):

```json
{
  "series_id": "kunde-zaehler-42",
  "unit": "kWh",
  "timezone": "Europe/Berlin",
  "value_semantics": "interval_energy",
  "values": [{"timestamp": "2026-09-24T12:00:00Z", "value": 1.25, "reactive_power_kvar": 0.8}]
}
```

Weitere Daten importieren, ohne automatisch neu zu trainieren:

```bash
python3 ../../tools/forecast-product/forecast_product.py history \
  --tenant-id "$CET_TENANT_ID" --series-id kunde-zaehler-42 \
  --input neue_messwerte.json --out kunde42_update
```

Änderungen an bereits gespeicherten Werten erfordern zusätzlich `--allow-corrections`.
Für eine Ersthistorie ohne anschließendes Training gibt es `history --historical-import`.
Bereits importierte Reihen mit `train --series-ids ID1 ID2 --forecast-for DATUM` trainieren.

## 3. Prognose erstellen

```bash
python3 ../../tools/forecast-product/predict_meter.py \
  --tenant-id "$CET_TENANT_ID" --series-id kunde-zaehler-42 \
  --model-file kunde42_training/result.json \
  --forecast-for 2026-09-28 --out kunde42_prognose_20260928
```

Alternativ `--model-version HASH`. Ein `--model-file` muss zum angegebenen Tenant gehören.
Die Prognose verwendet gespeicherte Historie; neue Messwerte vorher mit `history` übermitteln.
Optional sind `--history-version HASH` und ausdrücklich `--allow-stale-model` verfügbar.
Die Ergebnisdatei enthält Viertelstundenwerte und Modell-/Historien-/Basisversionen.

Nachtraining:

```bash
python3 ../../tools/forecast-product/forecast_product.py retrain \
  --tenant-id "$CET_TENANT_ID" --model-file kunde42_training/result.json \
  --forecast-for 2026-10-26 --out kunde42_nachtraining
```

Den resultierenden neuen Modellstand für zukünftige Prognosen ausdrücklich auswählen.

## 4. RMSE, MAE und WAPE berechnen

Nach Eingang der Istwerte lokal auswerten, ohne API-Zugriff oder Token:

```bash
python3 ../../tools/forecast-product/score_meter.py \
  --tenant-id "$CET_TENANT_ID" --series-id kunde-zaehler-42 \
  --predictions kunde42_prognose_20260928/result.json \
  --actuals istwerte.xlsx --unit kWh --time-basis berlin \
  --out kunde42_guete_20260928
```

Mehrere Tagesprognosen können hinter `--predictions` angegeben werden. Es wird genau eine
Prognose pro physischem Zeitstempel bewertet; überlappende Dateien werden abgewiesen.
Bei XLSX ordnet `--series-id` die Istwertdatei ausdrücklich dem Produktzähler zu, auch wenn
dieser beim Import umbenannt wurde. Bei JSON muss die enthaltene `series_id` übereinstimmen.
Zusätzliche Istwerte außerhalb der Prognosetage bleiben unberücksichtigt.

Ausgaben: Tabelle in Konsole und `report.md`, präzise Kennzahlen in `metrics.json`.

- RMSE = Wurzel aus dem mittleren quadrierten Fehler.
- MAE = mittlerer absoluter Fehler.
- WAPE = 100 × Summe absoluter Fehler / Summe absoluter Istwerte.

RMSE/MAE verwenden die Eingabeeinheit, WAPE Prozent. Bei Istwertsumme null ist WAPE
`null`/undefiniert. Fehlende Istwerte führen zum Abbruch; `--allow-partial` erlaubt eine
explizit unvollständige Bewertung mit ausgewiesener Abdeckung. Nullen bleiben echte
Messwerte. Tage mit Zeitumstellung umfassen 92 beziehungsweise 100 Intervalle.
Eine nachträglich erzeugte historische Prognose wird durch diese Auswertung nicht zu
einem unabhängigen Echtzeit-Benchmark. Für diesen Prognosen vorab speichern und erst
nach Eingang der Istwerte auswerten.

## Unterbrechungen und Wiederaufnahme

Schreibende POST-Aufrufe werden nie automatisch wiederholt. Bestätigte Imports und ein
angenommener Job werden sofort in `run.json` festgehalten. Nach Client-Unterbrechung:

```bash
python3 ../../tools/forecast-product/forecast_product.py resume \
  --tenant-id "$CET_TENANT_ID" --run-file kunde42_training/run.json \
  --out kunde42_training_fortgesetzt
```

`--base-url` muss zum ursprünglichen Lauf passen. Wenn der Serverjob unterbrochen wurde,
zusätzlich `--restart` verwenden; dies ruft ausdrücklich den Resume-Endpunkt auf.
Läuft nur das Client-Wartelimit ab, wird der Serverjob nicht automatisch abgebrochen.

Fehlt eine angenommene `run_id` (z. B. Verbindungsabbruch beim POST), nicht blind erneut
`seed`/`enroll` starten. Zuerst anhand bestätigter Imports und Serverzustand klären, welche
Schreiboperationen erfolgt sind. Für bereits gespeicherte Historien anschließend `train`
verwenden. Die Scripts versprechen keine automatische Wiederaufnahme halbfertiger Imports.

API-Details: [Produkt-Contract](../../docs/forecast-product-contract.md).

## Tests

```bash
.venv-forecast/bin/python -m unittest discover -s tools/forecast-product -p 'test_*.py'
node tools/forecast-product/uat.js
```

Der HTTP-Test startet eine isolierte Instanz mit Testidentitäten und synthetischen XLSX.
Er prüft Seed, Aufnahme eines zweiten Tenants mit Referenznutzung, Prognose, Auswertung,
Wiederaufnahme und Nachtraining. Seine Artefakte landen in einem neuen temporären Verzeichnis.

## Modelle zwischen Instanzen übertragen

Das Administrationswerkzeug [`transfer.py`](transfer.py) bietet versionierten Offline-Export,
Prüfung und Import einschließlich gemeinsamer Referenzhistorien, privater Zählermodelle,
Prüfsummen und Vergleichsprognosen. Importiert wird ausschließlich in ein neues Verzeichnis;
Tenant-Zuordnungen bleiben erhalten. Vollständiges Runbook:
[Forecast-Modelltransfer](../../docs/forecast-model-transfer.md).

## Öffentliches Startmodell ohne Weitergabe der XLSX

`prepare_starter.py` trainiert einen privaten Herausgeberstand aus expliziten XLSX/JSON-Dateien.
`starter_model.js` erzeugt daraus ein signiertes öffentliches Core-Modell, prüft Pakete und
installiert sie offline. Der CET-Service kann ein konfiguriertes, vertrauenswürdiges Release
beim Erststart automatisch beziehen. Historien und private Zählermodelle gehören nicht in
solche Pakete. [Vollständiges Herausgeber-/Installationsrunbook](../../docs/forecast-public-starter.md).

## Erweiterter Bestand: CSV-Dateien je Zähler und getrennte Messrichtungen

`prepare_training_data.py` führt die geprüften CSV-Jahresdateien zusammen, dedupliziert,
rechnet W in Viertelstunden-kWh um und erzeugt getrennte Bezugs-/Einspeisehistorien.
`train_prepared.py` prüft oder trainiert beide Richtungen getrennt, einschließlich älterer
Referenzzähler mit abweichendem Datenende. Siehe [Runbook](../../docs/forecast-basis-training-data.md).

## Basismodell ohne verdeckende lokale Gewinner prüfen

`train_prepared.py` verwendet standardmäßig `--mode baseline`: alle verfügbaren historischen
Jahre, gleiche Zählergewichte, ausgewogene Jahreszeiten und direkte saisonale Validierung
des gemeinsamen Core-Modells für jeden Zähler. Der bisherige jüngere Adaptionslauf bleibt
mit `--mode adaptation` verfügbar. [Verfahren, Reports und Startbefehl](../../docs/forecast-baseline-quality.md).
