# Forecast-Backtest als API-Job

`POST /api/forecast-sandbox/consumption/evaluation/run` liefert bei REST-Aufrufen
HTTP **202** mit `jobId`, `statusUrl`, `progressUrl` und `resultUrl`. Der Request-Body
bleibt unverändert. Interne Broker-Aufrufe behalten den bisherigen synchronen Vertrag.
REST-Clients müssen von direkter Ergebnisverarbeitung auf Polling umstellen.

```json
{
  "success": true,
  "jobId": "<uuid>",
  "status": "queued",
  "statusUrl": "/api/jobs/<uuid>/status",
  "progressUrl": "/api/jobs/<uuid>/progress",
  "resultUrl": "/api/jobs/<uuid>/result"
}
```

1. Auftrag einmal absenden; HTTP 202 und Job-ID sichern.
2. `GET /api/jobs/<uuid>/status` pollen (Empfehlung: alle fünf Sekunden).
3. Bei `completed`: `GET /api/jobs/<uuid>/result` laden. Ergebnisstruktur und
   Kennzahlen entsprechen dem bisherigen synchronen Response.
4. Bei `error`: `error` auswerten. `forecast_cancelled` bedeutet Abbruch,
   `forecast_timeout` das serverseitige Laufzeitlimit. Konfigurations-/Datenfehler
   während der Berechnung werden ebenfalls terminale Jobfehler, keine Erfolgsergebnisse.
5. `recovery_pending` nach einem Prozessausfall erfordert Betreiberprüfung. Es gibt
   keine automatische Fortsetzung oder erneute Einreichung dieses Forecast-Jobs.

Optional liefert der bestehende `/progress`-Endpunkt die normalisierte Fortschritts-
und Ereignisstruktur. Die isolierte Sandbox-OpenAPI enthält auch die drei benötigten
Job-Endpunkte. Ergebnisse unterliegen dem bestehenden Job-Store-TTL (Standard 24 h).

## Fortschritt und Abbruch

`progress.step` zählt **abgeschlossene Prognosetage**, `progress.totalSteps` deren
Gesamtzahl über alle Zeitreihen. `progress.payload` enthält unter anderem
`forecast_for`, `series_id`, `series_index` und `phase`. Phasen:

- `waiting_for_worker`: wartet auf den freien Forecast-Worker.
- `preparing`: lädt Features und validiert die Zeitreihe.
- `model_selection`: Modellauswahl/Training für den angegebenen Tag.
- `forecast_day_completed`: Prognosetag vollständig berechnet.
- `persisting`: Modellartefakte und Ergebnis werden gespeichert.
- `completed`: abgeschlossen.

Die Prozentangabe beruht auf abgeschlossenen Tagen (bis 98 %); Speichern und Abschluss
belegen 99/100 %. Sie ist **keine Zeitprognose**: Ein Tag mit Modellauswahl kann viel
länger dauern als andere Tage. Innerhalb der Modellauswahl wird noch kein einzelner
Kandidat gemeldet. Ein unveränderter Tageszähler ist deshalb allein kein Fehlernachweis.
Der Job-Store-Heartbeat zeigt die Erreichbarkeit des Supervisors, nicht den fachlichen
Fortschritt des Workers.

```bash
curl -X POST http://localhost:3900/api/forecast-sandbox/consumption/evaluation/jobs/<uuid>/cancel \
  -H 'Content-Type: application/json' -d '{}'
```

Abbruch ist auf Forecast-Jobs des vertrauenswürdigen Gateway-Mandanten beschränkt.
Der Worker wird beendet; der bestehende Jobstatus `error` mit `forecast_cancelled`
wird verwendet. Bereits abgeschlossene Ergebnisse bleiben erhalten.

## Ressourcen und Laufzeit

Die CPU-intensive REST-Berechnung läuft in einem separaten Node Worker-Thread.
Pro Broker-Prozess läuft höchstens ein Forecast-Worker; weitere Aufträge warten.
Das bestehende Job-Store-Quoten-/Dispatch-Verhalten bleibt erhalten. Hauptprozess,
Statusabfrage und Abbruch bleiben auch bei einer CPU-Schleife im Worker erreichbar.
Worker-Ausnahmen und unerwartete Worker-Exits werden als Fehler erfasst.

`FORECAST_JOB_TIMEOUT_SECONDS` begrenzt die tatsächliche Worker-Laufzeit, Standard
21600 Sekunden (6 Stunden), ohne Wartezeit in der Queue. Bei Überschreitung wird der
Worker beendet. Das ist eine Schutzgrenze, keine erwartete Laufzeit oder SLA.
Es werden keine Zwischenmodelle/Teilprognosen als fortsetzbare Checkpoints gespeichert.

## XLSX-Testclient ab 3.0

Der bisherige Aufruf mit `--xlsx`, `--config`, `--from`, `--until`, `--out` bleibt gültig.
Neue Optionen:

- `--poll-interval 5`: Abstand der Jobstatus-Abfragen.
- `--timeout 60`: HTTP-Socket-Timeout je Request (bisher 3600).
- `--job-timeout 86400`: maximale Wartezeit des Clients je Job; anschließend Abbruchanforderung.

Die CLI zeigt Job-ID, Status, abgeschlossene Tage, Phase und Zeitpunkt des letzten
Fortschritts. Ctrl+C fordert den Abbruch des bekannten Jobs an; ist die API dabei
nicht erreichbar, wird die manuelle Abbruch-URL angezeigt. Bei Verbindungsverlust
ist ein Abbruch nicht immer garantiert: Job-ID/URLs stehen schon nach Annahme in
`report.json.files[].job`. Es erfolgt keine automatische POST-Wiederholung.

Submission, Statusantworten und Ergebnis werden mit Prüfsummen archiviert. Replay
spielt sie ohne Polling-Wartezeiten nach. Alte HTTP-200-Archive bleiben kompatibel.
Die CLI unterstützt auch alte synchrone APIs, kann deren Berechnung aber nicht
beobachten oder abbrechen. Ein bereits laufender alter Prozess wird nicht migriert.
