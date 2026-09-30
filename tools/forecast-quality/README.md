# Reproduzierbarer API-Test der Prognosegüte

Dieses Verzeichnis ist ein eigenständiges Python-Testpaket. Es kann ohne Node.js,
ohne CET-Quellcode und von einem beliebigen Arbeitsverzeichnis ausgeführt werden.
Es importiert keine Prognoseimplementierung: Prognose und Historienbaseline werden
über die angegebene API erzeugt; der Client rechnet Fehler unabhängig nach.

## Voraussetzungen und Ausführung

- Python 3.10–3.12, getestet mit 3.12.3. IANA-Zeitzonendaten des Betriebssystems
  müssen vorhanden sein (unter Windows ggf. zusätzlich `pip install tzdata`).
- Die elf XLSX-Dateien aus `benchmark.json`, getrennt vom Testpaket bereitzustellen.
  Das Paket enthält weder Messwerte noch Zugangsdaten. SHA-256-Hashes prüfen,
  dass verschiedene Teams wirklich dieselben Eingaben verwenden.
- Laufende CET-API mit `/api/forecast-sandbox/consumption/evaluation/{validate,run}`,
  historischen Prognosezeiträumen und automatischer Modellwahl. Die ursprünglichen
  vier Sandbox-Endpunkte allein reichen nicht aus.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r /pfad/forecast-quality/requirements.txt
.venv/bin/python /pfad/forecast-quality/run.py \
  --data-dir /pfad/zu/den/xlsx-dateien \
  --base-url http://localhost:3900 \
  --out /pfad/neuer-ergebnisordner
```

Bei Authentifizierung `CET_API_TOKEN` im aufrufenden Prozess setzen. Keine Tokens
in Kommandoargumenten, Manifest oder Reports ablegen. Für entfernte Team-Instanzen
eine HTTPS-URL verwenden; Zertifikate werden regulär geprüft, Redirects abgelehnt.
Das Paket startet/restartet keinen Server. `CET_BASE_URL` kann `--base-url` ersetzen.
Vorhandene Ergebnisordner werden nicht überschrieben.

Ein kurzer Integrationscheck ist mit `--smoke` möglich: erstes Profil, erste sieben
Tage. Im Report ist dies ausdrücklich **smoke**, niemals ein vollständiges Güteurteil.
Der volle Lauf ist seriell und kann mehrere zehn Minuten dauern. Standardtimeout:
900 Sekunden je HTTP-Aufruf (`--timeout`). Es gibt keine automatischen POST-Retries.

## Fester Testvertrag

Suite `cernion-edm-eleven-profiles-2024-v1`, Eingabe kWh/PT15M, Europe/Berlin,
Prüfjahr 2024. `Datum von` ist Intervallanfang, `Datum bis` exklusives Ende.
Die Bestätigung dieser Semantik stammt vom Datengeber; sie wird nicht aus OBIS geraten.
Die gesamte verfügbare Historie wird übergeben. Das System muss pro Prognosetag
den D−2-Trainingsstand einhalten. Frühere Prüftage dürfen später trainiert werden.

Die Suite fixiert explizit `relationship_mode: auto`, `selection_metric: mae`,
`recent_window_days: 84`, Historie und Kalender. Die zweite API-Auswertung verwendet
`relationship_mode: manual`, nur Historie. Wetterdaten sind nicht vorhanden.
Für dokumentierte Versuche kann `--candidate-config datei.json` die Felder
`selection_metric`, `recent_window_days`, `model_family` überschreiben. Zeitraum,
Dateien und Datenverfügbarkeit sind darüber nicht veränderbar. Konfiguration und Hash
stehen im Report; Kandidaten mit unterschiedlichen Konfigurationen sind keine
identischen Wiederholungsläufe.

Es wird kein Trainingserror als Prognosegüte ausgegeben. Gemessen werden äußere
rollierende Vorhersagen gegen die entsprechenden Istwerte. Gleichwohl sind diese
elf Reihen bereits aus der Entwicklung bekannt. Die Resultate dokumentieren
Entwicklungsqualität; neue externe Daten sind keine Voraussetzung für die
Implementierung. Zeitliche Trennung und D−2 gelten weiterhin.

Leere Excel-Zeilen werden ignoriert; Nullwerte bleiben erhalten. Mehrdeutige
Herbststunden benötigen beide Vorkommen in physischer Reihenfolge. Fehlende Werte,
unauflösbare Zeitstempel, Datei-Hashabweichungen und Duplikate werden nicht still
korrigiert. Fehlende Prüf-Istwerte verhindern einen erfolgreichen Volltest.

## Standardisierter Report 1.0

- `report.json`, validiert gegen `report.schema.json`: Suite, Status, Konfiguration,
  Provenienz, Modellversionen, je Profil und gepoolt MSE/RMSE/MAE/WAPE, außerdem
  MAPE/Bias/Abdeckung, Nullwertanteil und Fehler auf Null-/Aktivintervallen je Profil.
- `report.md`: lesbare Zusammenfassung mit Vergleichstabelle und Grenzen.
- `summary.csv`: tabellarischer Teamvergleich.
- `manifest.json`, `http-calls.json`: Eingabevertrag, Request-/Response-Hashes und Laufzeiten.
- `*.request.json.gz`, `*.json.gz`: komplette Live-Anfragen und API-Antworten.
  Diese Ergebnisdateien enthalten Messdaten und sind entsprechend zu behandeln.

MSE wird in (kWh)² gemessen, RMSE/MAE/Bias in kWh je Viertelstunde. WAPE und MAPE
sind Prozentwerte. MAPE schließt Null-Istwerte aus. RMSE wird aus gepoolten
Fehlerquadraten berechnet, nicht durch Mittelung der Profil-RMSE. Positive
RMSE-Verbesserung bedeutet besser als die Historienbaseline; bei perfekter Baseline
ist eine relative Verbesserung nicht definiert (`null`).

`status: completed` und Exit-Code 0 bedeuten **technisch gültig und vollständig**,
nicht gute Prognosegüte. Güteheuristik separat: WAPE ≤10 % high, ≤30 % medium,
sonst low. Teilfehler ergeben `incomplete`, globale Fehler `failed`, Abbruch
`interrupted`, jeweils Exit-Code 1 und einen Teilreport. Ein API-Mix verschiedener
Modellversionen im selben Lauf wird abgelehnt. API-Metadaten belegen nicht allein
das Serverinnere; die Serverseite benötigt zusätzlich Leakage-Regressionstests.

Die API legt ihren Quellcode-Commit derzeit nicht offen. Dieser wird ausdrücklich
als unbekannt ausgewiesen, nicht vom lokalen Client-Checkout abgeleitet. Für streng
identische Reproduktion müssen Teams zusätzlich denselben Server-Build bereitstellen.

## Unabhängige Nachrechnung archivierter Läufe

```bash
python3 /pfad/forecast-quality/run.py --data-dir /pfad/xlsx \
  --replay /pfad/archivierter-api-lauf --out /pfad/neuer-pruefbericht
```

Der Archivordner muss `http-calls.json`, `openapi.json.gz` sowie
`meter-N-{validation,auto,baseline}.json.gz` enthalten. Response-Hashes, Originaldateien,
Istwerte, Zeitgrenzen und Metriken werden geprüft. `execution: archived_api_replay`
unterscheidet diese Nachrechnung eindeutig von `live_http`. Archivierte Anfragen
werden nicht als neu gesendet behauptet. Ein Full-Archiv passt nicht zu `--smoke`.

Tests: `python3 -m unittest discover -s /pfad/forecast-quality -p 'test_*.py'`.
Für die Weitergabe dieses Verzeichnis vollständig kopieren oder zippen; Rohdaten
und Ergebnisordner gehören nicht in das Testpaket.

## Gelernte Zustandsmerkmale vergleichen

Eine kompatible API unterstützt zusätzlich `{"model_family":"learned_states"}`
als Kandidatenkonfiguration (mitgeliefert als `candidate-states.json`). Version `relationship_state_correction_v2` ergänzt die
automatische Basis um eine historisch geprüfte Zustandskorrektur. `selection_metric`
und `recent_window_days` steuern die Basis; der Zusatz hat eine feste RMSE-Policy
mit MAE-Schutz. Versionen stehen in den API-Antworten. Ältere v1-Ergebnisse beziehen
sich auf das eigenständige Zustandsmodell mit einfacher Kalenderreferenz.

```bash
python3 compare_states.py --candidate /pfad/zustandslauf \
  --reference /pfad/automatischer-referenzlauf --out /pfad/neuer-vergleich
```

Beide Läufe müssen vollständig sein und dieselbe Suite verwenden. Der Vergleich
prüft Paarung und Response-Hashes und rechnet RMSE/MAE unabhängig nach. Für v2
prüft er zusätzlich die offengelegten D−2-Grenzen der Zustandskontexte und der
inneren Trainingsläufe (`causality_checks`). Er trennt
den Vergleich zum bisherigen automatischen Modell von der Ablation ohne Zustände
bei ansonsten identischer Kandidatenkonfiguration. Vorab festgelegte Hürden und
gepaarte Wochenbootstrap-Intervalle stehen in `comparison.json` und `comparison.md`.
Kein Modell wird durch dieses Skript aktiviert oder als Standard übernommen.

```bash
python3 check_state_api.py --run /pfad/zustandslauf \
  --base-url http://localhost:3900 --out /pfad/neuer-persistenztest
```

Dieser zusätzliche HTTP-Test prüft das gespeicherte Modell von `meter-1`, exakte
Vorhersageparität beim Laden und ein explizites Training aus dem archivierten
Live-Request. Er erstellt dafür ein weiteres unveränderliches Modellartefakt auf
der API-Instanz. Er benötigt einen Live-Lauf mit Request-Archiven.

### Wetter, Markt und Jahreszeit (optionaler Kandidat)

`prepare_features.py` bereitet die Standortdaten Kempten und den deutschen Markt-/Netzkontext ausschließlich über die API vor. Beispiel und Einschränkungen: [Merkmals-Runbook](../../docs/forecast-context-features.md). Die erzeugte `candidate.json` kann mit `run.py --candidate-config` verwendet werden. Dataset-IDs sind serverlokal und inhaltlich gehasht; andere Teams bereiten sie auf ihrer eigenen Instanz vor. `issue_time=18:00` ändert den Informationsstand externer Merkmale, **nicht** den D−2-Schnitt der Zählerhistorie. Der unabhängige Prüfer kontrolliert beide Zeitgrenzen separat.

Historische SMARD-Revisionsstände und Veröffentlichungsannahmen begrenzen die Aussagekraft des Backtests. Verbesserungen gelten unter den dokumentierten Annahmen. Ein Vergleich mit einem Lauf um 00:00 hat unterschiedliche Informationsstände und darf nicht als identischer gepaarter Ursprung ausgegeben werden.
