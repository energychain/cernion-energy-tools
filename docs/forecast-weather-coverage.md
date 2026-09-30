# Kempten: Wetterabdeckung im XLSX/API-Backtest

Die Wettervorbereitung verwendet ab `cernion-vc-gfs-jma-weather-v2` weiterhin
GFS-Prognosen mit festem 72-Stunden-Vorlauf. Nur fehlende Temperaturstunden werden
aus JMA GSM mit demselben Vorlauf ergänzt. Die Entscheidung beruht ausschließlich
auf Datenverfügbarkeit, nicht auf Last-Istwerten oder nachträglich gemessener
Prognosequalität. `forecast_source` dokumentiert die Quelle je Viertelstunde.
Fehlende Strahlung wird nicht durch Messungen, Reanalyse oder Null ersetzt.
Die Stundenwerte werden auf vier Viertelstunden gehalten; HDD18 wird nur für
vollständige lokale Tage berechnet. Sommer-/Winterzeit bleibt berücksichtigt.

Die angeforderten UTC-Blöcke enthalten einen zusätzlichen Tag für die Zuordnung
von Strahlung (Mittelwert der vorausgehenden Stunde) zum Intervallbeginn; ausgegeben
werden ausschließlich die angeforderten Stunden. Dadurch fehlen an Blockgrenzen
keine sonst vorhandenen Strahlungswerte mehr.

`coverage.forecast_detail` dokumentiert den angefragten Zeitraum, erwartete und
verfügbare Intervalle je Jahr/Feature, fehlende Temperaturtage einschließlich ganz
fehlender Tage und die verwendeten Quellen. Fehler der Ersatzquelle werden unter
`provenance.fallback_errors` erfasst; gültige GFS-Prognosen bleiben nutzbar.

## Lokaler Datenstand vom 25. September 2026

| Zieljahr | Temperatur vorher | Temperatur jetzt | HDD18 jetzt | Strahlung jetzt |
|---|---:|---:|---:|---:|
| 2023 | 11.912 / 35.040 | 35.040 / 35.040 | 35.040 / 35.040 | 0 / 35.040 |
| 2024 | 33.164 / 35.136 | 35.136 / 35.136 | 35.136 / 35.136 | 33.164 / 35.136 |

Die Vollständigkeit gilt für den Ausgabezeitpunkt **D−1 18:00** in Europe/Berlin.
Für sämtliche neuen Forecast-Zeilen wurde `available_at <= issue_time` geprüft.
Bei 00:00 können rund um die Zeitumstellung Tages-HDD wegen der konservativen
Verfügbarkeitsgrenze fehlen; die API muss sie dann ausschließen.
Die Publikationszeitpunkte sind weiterhin konservative Annahmen aus festem
Prognosevorlauf plus 24 Stunden Puffer, keine verifizierten historischen Lieferzeiten.

Der neue Datensatz enthält zusätzlich vollständige Temperaturen/HDD ab 28.08.2022
als Vorlauf. Beobachtungen 2020–2024 bleiben unverändert, einschließlich fünf
wegen widersprüchlicher Stundenwerte ausgelassener Herbststunden.
Der ursprüngliche Datensatz bleibt unter seiner ID erhalten.

Lokale Artefakte in `tmp/profile`:

- `configuration.all-features.json`: vollständige Kandidatenkonfiguration mit neuer Wetter-ID.
- `kempten-weather-2023-2024.json`: Metadaten und Abdeckung.
- `kempten-weather-2023-2024.api.json`: über lokale API bestätigte Vorbereitung.
- `kempten-weather-coverage-comparison.json`: maschinenlesbarer Vorher/Nachher-Vergleich.

## Wiederholung auf einer anderen Instanz

```bash
curl --fail-with-body http://localhost:3900/api/forecast-sandbox/consumption/features/weather/prepare \
  -H 'Content-Type: application/json' \
  -d '{"location":"kempten","history_from":"2020-01-01","history_until":"2024-12-31","forecast_from":"2023-01-01","forecast_until":"2024-12-31"}'
```

Die Antwort liefert die `weather_dataset_id` für die Testkonfiguration. Rohdaten
werden serverseitig gecacht; bei identischem Cache entsteht dieselbe Datensatz-ID.
Ein erneuter Abruf externer Quellen kann andere Werte/Metadaten und eine neue ID
liefern. Für exakte Reproduktion die ursprünglichen unveränderlichen Datensätze
bereitstellen. Die Datenvorbereitung benötigt den konfigurierten Cernion-Zugang.

Quelle: [Open-Meteo Previous Runs API](https://open-meteo.com/en/docs/previous-runs-api).
GFS-Temperaturen reichen dort weiter zurück als viele andere Variablen; JMA hat
eine längere Archivhistorie. Die im Test tatsächlich erhaltene Abdeckung ist
maßgeblich. Vollständige Temperaturdaten sind kein Nachweis besserer Lastprognosen;
das prüft der anschließende XLSX/API-Backtest.
