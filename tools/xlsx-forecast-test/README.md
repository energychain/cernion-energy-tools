# Forecast-Readiness-Backtest – XLSX/API-Test

Eigenständiges Script, kein Repository/Node.js auf dem Client erforderlich. Python
3.10 oder neuer; das mitgelieferte Script und diese Abhängigkeiten genügen:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python xlsx_forecast_test.py \
  --xlsx /pfad/1_2020-2024.xlsx /pfad/2_2020-2024.xlsx \
  --base-url http://localhost:3900 \
  --from 2024-01-01 --until 2024-12-31 \
  --out ergebnis-2024
```

Alle Dateien: `--xlsx '/pfad/*.xlsx'`. Dateinamen sind frei wählbar; identische
Pfadangaben werden einmal ausgeführt. Je Datei genau ein Zähler/OBIS und ein Blatt
mit Kopfzeile `Meldepunkt`, `OBIS`, `Datum von`, `Datum bis`, `Wert`.
Excel-Zeitstempel sind echte Datumszellen, `Datum von` ist Intervallbeginn,
`Datum bis` exklusives Ende. Standard: kWh und Europe/Berlin. Andere bestätigte
Exporte: `--unit kW`, `--time-basis utc` oder `cet` (durchgehend UTC+1).
Doppelte Herbststunden müssen beide in physisch chronologischer Reihenfolge vorliegen.
Lücken und Duplikate werden nicht stillschweigend repariert.

Der Testzeitraum ist einschließlich Enddatum; Standard ist das Jahr 2024.
Es wird die gesamte XLSX-Historie übertragen. Die API erstellt rollierende
Vorhersagen mit Zählerhistorie maximal bis D−2. Die Prüf-Istwerte müssen vollständig
vorliegen. Das Script prüft Zeitgrenzen, Raster, Istwertgleichheit und API-Metriken
und rechnet RMSE, MAE und WAPE unabhängig nach. WAPE bei ausschließlich Null-Istwerten
ist nicht definiert (`—`). Ein technischer Erfolg sagt nichts über gute Prognosegüte.

## Ausgabe und Reproduktion

Standardausgabe und `report.md` enthalten einen kompakten Markdown-Bericht:
Aufrufzeitpunkt in UTC, SHA-256 des vollständigen Scripts und eine Tabellenzeile
pro XLSX mit RMSE, MAE, WAPE %, Status, `forecast_signal` (Ampel) und tatsächlich
genutzten Features samt Anteil der Prognoseintervalle. Angefordertes `feature_set`,
effektive Modellkonfiguration, Wetterregion und Archiv-Prüfsummen stehen direkt im Markdown.
Je Datei folgen `interpretation` und `recommended_next_step`. Fortschritt geht an stderr.
`report.json` enthält zusätzlich Datei-Prüfsummen, Python-/Paketversionen,
Konfiguration, Modellversionen und API-Warnungen. Das ausgeführte Script wird
mit archiviert; `http-calls.json` enthält Request-/Response-Prüfsummen.
Seit Version 2.3 sichert das Ausgabeverzeichnis folgende Dateien zu Beginn und am Ende
auch eines fehlgeschlagenen Laufs:

- `xlsx_forecast_test.py`: exakt die beim Start erfasste Scriptversion.
- `configuration.json`: effektive Modellkonfiguration mit Client-Defaults; erneut als
  `--config` nutzbar. Zeitraum, Einheit, Zeitbasis und Wetterregion stehen separat im Report.
- `configuration.input.json`: unveränderte Bytes der über `--config` übergebenen Datei,
  sofern vorhanden. Beim Replay gibt es keine neue Eingabekonfiguration.

`report.json.artifacts` und Markdown dokumentieren SHA-256 der tatsächlichen Dateibytes.
`configuration_sha256` im JSON bleibt der Hash der kanonisierten JSON-Konfiguration
und unterscheidet sich vom Datei-Hash. `feature_usage` zählt pro Datei Features und
Detail-Prädiktoren aus den API-Prognosewerten; fehlende Angaben alter APIs bleiben
als unbekannt gekennzeichnet. Anfordern eines Features garantiert nicht dessen Auswahl.
Die Archive enthalten referenzierte Wetter-/Marktdaten nicht automatisch: Diese müssen
auf der Zielinstanz unter denselben Datensatz-IDs verfügbar sein.
Vollständige Anfragen/Antworten liegen komprimiert vor und enthalten die Messdaten.

Für Wiederholungen dieselben XLSX (Hashes), Script-, Server-Build- und
Featuredaten-Versionen sowie denselben Zeitraum und dieselbe Konfiguration verwenden.
Die API legt ihren Build derzeit nicht offen. `--server-revision <build-id>` erlaubt
dessen Dokumentation als Betreiberangabe; es ist keine technische Verifikation.
Ein Script-Hash allein garantiert keine identischen Server-Ergebnisse.

Archivierte Ergebnisse ohne API neu prüfen:

```bash
.venv/bin/python xlsx_forecast_test.py \
  --xlsx /pfad/1_2020-2024.xlsx /pfad/2_2020-2024.xlsx \
  --replay ergebnis-2024 --out nachgerechnet
```

Replay übernimmt Zeitraum, Einheit, Zeitbasis und Konfiguration aus dem Original.
Dateien müssen in derselben Reihenfolge mit identischen Inhalten angegeben werden.
Es prüft Request-/Response-Hashes und rechnet erneut gegen die XLSX nach.
Das ist als `archived_api_replay` gekennzeichnet, kein neuer Live-Test.
Der ursprüngliche Report samt Prüfsummen muss aus vertrauenswürdiger Quelle stammen;
Prüfsummen sind keine digitale Signatur.

## Modell, Wetter und API

Standard: automatische Historien-/Kalenderauswahl mit validierter
Zustandskorrektur (`learned_states`), zusätzliche Jahreszeit als Kandidat,
Prognoseursprung D−1 00:00. Wetter und Markt werden nur über explizite
`--config datei.json` aktiviert, z. B.:

```json
{
  "issue_time": "18:00",
  "feature_set": ["history", "calendar", "weather", "context"],
  "weather_dataset_id": "<Hash des Wetterdatensatzes auf dem Server>",
  "context_dataset_id": "<Hash des Marktdatensatzes auf dem Server>"
}
```

Wetterregion standardmäßig Kempten `DE-BY-Kempten-87435`; für andere Standorte
`--weather-region` passend zum serverseitigen Datensatz setzen. Die unveränderlichen
Datensätze müssen auf der Zielinstanz vorliegen, einschließlich der historischen
Verfügbarkeitsinformationen. Dritte benötigen dieselben Datensätze für identische
Reproduktion. Das Script lädt keine externen Daten selbst und erfindet keine Features.
Ein gleicher Scriptlauf ohne diese Konfiguration testet ein anderes Modellangebot.

Benötigte API-Endpunkte:
- `GET /api/forecast-sandbox/openapi.json`
- `POST /api/forecast-sandbox/consumption/evaluation/validate`
- `POST /api/forecast-sandbox/consumption/evaluation/run`

Die lokale Dev-Instanz verwendet hier Port 3900; andere Ports mit `--base-url`.
Optional `CET_BASE_URL` und `CET_API_TOKEN` als Umgebungsvariablen.
Tokens werden nicht archiviert. Entfernte APIs benötigen HTTPS.
Der Client startet keinen Server. Jahresläufe können mehrere Minuten je Datei dauern;
Standardtimeout 60 Sekunden je HTTP-Aufruf; bei Job-APIs wird wiederholt der Status abgefragt. Keine automatischen POST-Wiederholungen.

Ergebnisordner dürfen noch nicht existieren. Exit 0 bedeutet vollständiger,
technisch gültiger Test; Exit 1 Fehler/Teilreport, Exit 2 ungültiger Aufruf.
Zur Weitergabe Script, requirements.txt und README sowie separat die gewünschten
XLSX und ggf. API-Ergebnisarchive/Featuredatensätze bereitstellen.

## Fachliche Einordnung (Berichtheuristik v1)

Die Ampel beschreibt beobachtete Fehler im Prüfzeitraum, keine garantierte Modellleistung,
keine Produktivfreigabe und keinen nachgewiesenen Vorteil gegenüber einer Baseline.
Die Regeln stehen maschinenlesbar in `report.json.readiness_policy`:

- `strong` (grün): WAPE ≤10 % und mindestens 28 Prüftage.
- `medium` (gelb): WAPE ≤30 %; bei weniger als 28 Tagen auch dann, wenn WAPE ≤10 %.
- `weak` (rot): WAPE >30 %. Bei ausschließlich Null-Istwerten bedeutet weak ausdrücklich
  „nicht beurteilbar“, nicht „schlechtes Modell“.

Geringe Lastbasis bedeutet hier mittlerer absoluter Istwert ≤0,1 kWh/Intervall;
kleine absolute Fehler bedeuten MAE ≤0,1 und RMSE ≤0,15 kWh/Intervall.
Für Leistungswerte in kW wird für diese Einordnung mit 0,25 h umgerechnet.
Das sind feste Orientierungswerte, keine aus den Profilen optimierten Schwellen und
keine kundenspezifisch bestätigten betrieblichen Toleranzen.

Beispiel: MAE 0,066 kWh und WAPE 123 % entsprechen einer mittleren absoluten Last
von etwa 0,05366 kWh/Intervall. Zusammen mit RMSE 0,093 kWh wird dies als kleine
absolute Abweichung bei geringer Lastbasis erläutert. Das relative Signal bleibt
`weak`: der MAE übersteigt die mittlere Last. Empfohlen werden eine betriebliche
Absoluttoleranz, getrennte Prüfung von Null-/Aktivintervallen, Tagesaggregation und
Baseline-Vergleich. Geringe Last macht den WAPE nicht mathematisch ungültig.

Die Einordnung verwendet ausschließlich Prüfwerte und verändert weder Training noch
Prognoseauswahl. Alte Archive können mit `--replay` unter der neuen Berichtsversion
neu eingeordnet werden; ursprüngliche Kennzahlen und Antworten bleiben erhalten.

## Optionale neue Modellpolitik (Client 2.2)

`--config adaptive-activity.json` aktiviert die explizite Politik
`selection_policy: "adaptive_rmse_v1"`, `selection_metric: "rmse"` und
`activity_model: true`. Ohne Aktivitätskandidaten: `adaptive-windows.json`.
Sie prüft 28/84/365 Tage und Gesamthistorie; der Aktivitätskandidat lernt getrennt
Aktivitätswahrscheinlichkeit und positive Verbrauchshöhe. Beides wird nur nach
historischer Bestätigung genutzt. Alte Aufrufe ohne diese Konfiguration behalten
ihre bisherige Politik. Details und Marktpreis-Aktivierung: `adaptive-models.md`
im Weitergabepaket bzw. `docs/forecast-adaptive-models.md` im Repository.

## Alle implementierten Kandidaten aktivieren

Für gelernte Null-/Niedriglast-Labels zusätzlich
`"activity_labeling": "learned_low_load_v1"` bei aktiviertem `activity_model`
setzen. Vorlage: `learned-low-load.json`. Das Modell lernt Schwelle,
Aktivitätswahrscheinlichkeit und separate Niedriglast-/Aktivmengen ausschließlich
aus verfügbarer Historie; Auswahl nur nach historischer RMSE-Bestätigung ohne
MAE-Verschlechterung gegenüber dem inneren Vergleichsmodell.
Details: [Niedriglast-Labeling](../../docs/forecast-low-load-labeling.md).

`all-features.example.json` kombiniert die adaptive RMSE-/Historienfenster-Auswahl,
Aktivitätsmodell, gelernte Zustände, Kalender/Jahreszeit, Wetter und Markt-Kontext.
Die beiden Datensatz-IDs vor Verwendung durch gültige IDs der Zielinstanz ersetzen.
`issue_time: "18:00"` ist für die angenommene Day-Ahead-Preisverfügbarkeit erforderlich.
Alle Kandidaten anzubieten garantiert keine Verbesserung; die API prüft ihren
historischen Nutzen und kann sie verwerfen.

Für einen Backtest 2023–2024 muss auch das Wetter für diesen Zielzeitraum vorbereitet
werden. Ein nur für 2024 vorbereiteter Datensatz enthält nicht automatisch das
volle Vorjahr. Die Wettervorbereitung ergänzt intern 126 Tage Vorlauf für die Auswahl.

## CLI-Fortschritt (ab Version 2.4)

Das Script zeigt auf stderr die aktuelle Datei (`[1/11]`), den Verarbeitungsschritt,
Schritt- und Gesamtlaufzeit sowie die Anzahl erfolgreicher/fehlgeschlagener Dateien.
Während längerer Schritte erscheint alle 15 Sekunden eine Statuszeile, auch beim
Warten auf HTTP-Antworten. Nach jeder Datei werden RMSE und MAE ausgegeben.
Die Markdown-Ausgabe auf stdout bleibt separat, z. B. `> report-console.md`.

- `--progress-interval 5`: Status alle fünf Sekunden.
- `--progress-interval 0`: nur Schrittwechsel/Abschlüsse, keine periodischen Meldungen.

Der synchrone Forecast-Endpunkt liefert keinen serverseitigen Zwischenstand.
„Warte auf API-Antwort; Serverfortschritt unbekannt“ bestätigt lediglich, dass der
Client wartet, nicht dass der Server nachweislich weiterrechnet. Es gibt deshalb
keine geschätzten Prozentwerte oder Restzeiten innerhalb einer Datei.
`--timeout` bleibt unabhängig davon der HTTP-Socket-Timeout (Standard 60 Sekunden),
keine garantierte Gesamtfrist. Statusmeldungen verlängern ihn nicht und lösen keine
zusätzlichen API-Aufrufe oder automatischen POST-Wiederholungen aus.
Eine schon laufende Python-Ausführung übernimmt diese Scriptänderung nicht.

## Job-API (ab Version 3.0)

Der Forecast-Aufruf unterstützt HTTP 202 mit Job-ID. Das Script pollt automatisch
`/api/jobs/{jobId}/status` und lädt nach Abschluss `/result`. Die CLI zeigt dabei
abgeschlossene Prognosetage, Phase und Zeitpunkt des letzten Fortschritts.
`--poll-interval 5` steuert diese Meldungen; `--progress-interval` gilt weiterhin für
lokale Verarbeitungsschritte und einzelne HTTP-Wartezeiten. Job-IDs und URLs werden
sofort in `report.json.files[].job` gesichert, sämtliche Requests/Responses archiviert.

`--job-timeout 86400` begrenzt die Wartezeit pro Job. Ctrl+C bzw. Überschreitung dieses
Limits fordert serverseitigen Abbruch an. Ein nicht bestätigter Abbruch wird mit
manueller Abbruch-URL gemeldet. Keine automatischen POST-Wiederholungen. Bei der
neuen API muss `--timeout` nicht mehr die gesamte Forecast-Laufzeit abdecken.

Serverseitig ist die Worker-Laufzeit standardmäßig auf sechs Stunden begrenzt
(`FORECAST_JOB_TIMEOUT_SECONDS`). Ein stehender Tageszähler während einer langen
Modellauswahl ist kein zuverlässiger Nachweis eines Fehlers. Die Anzeige ist keine
Restzeitschätzung. Details: `forecast-evaluation-jobs.md` im Weitergabepaket.

## Schwellwertfilter (ab Version 3.1)

`"prediction_threshold_w": 50` in der Konfiguration setzt Prognosen mit einem Betrag
unter 50 W auf null (0,05 kW bzw. 0,0125 kWh je Viertelstunde). Genau an der Grenze
bleiben Werte erhalten. Ohne Parameter bzw. bei 0 bleibt der Filter ausgeschaltet.
`all-features.example.json` enthält die 50-W-Grenze.

Die Haupttabelle bewertet die endgültige Prognose; eine zusätzliche Tabelle
vergleicht RMSE, MAE und WAPE vor/nach Filterung und zählt geänderte Intervalle.
Istwerte bleiben unverändert. Das Script prüft die Filterabbildung und beide
Metriksätze unabhängig; eine ignorierte Filterkonfiguration gilt als Fehler.
Details zur Modellpersistenz: `forecast-prediction-threshold.md` im Paket.
