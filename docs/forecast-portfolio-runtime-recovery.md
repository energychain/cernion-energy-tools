# Forecast-Portfolio: Runtime prüfen und wiederherstellen

Ein `ModuleNotFoundError: No module named 'numpy'` in `preparing` bedeutet,
dass der vom API-Prozess gestartete Python-Interpreter die Forecast-Abhängigkeiten
nicht importieren kann. `npm install` installiert diese Python-Pakete nicht.

Die Interpreter-Auswahl lautet: `FORECAST_PYTHON`, ansonsten die lokale
`.venv-forecast/bin/python`, ansonsten `python3` aus dem Service-PATH.
Der Check verwendet exakt dieselbe Auswahl wie der Portfolio-Worker.

## Produktionsprüfung und Installation

Im Deployment-Verzeichnis als API-Service-Benutzer und mit dessen Environment:

```bash
node scripts/check-forecast-portfolio-runtime.js
```

Der Check zeigt Interpreter und Paketversionen, führt `pip check` aus und
importiert Engine, Runtime, Produktpfad und Starter einschließlich ihrer
Abhängigkeiten. Außerdem prüft er die Zeitzone `Europe/Berlin`.

Wenn keine vollständige Forecast-Umgebung vorhanden ist:

```bash
python3 -m venv .venv-forecast
.venv-forecast/bin/python -m pip install -r tools/forecast-portfolio/requirements.txt
FORECAST_PYTHON="$PWD/.venv-forecast/bin/python" node scripts/check-forecast-portfolio-runtime.js
```

Den absoluten Interpreterpfad als `FORECAST_PYTHON` in der tatsächlichen
Service-Konfiguration setzen und den API-Prozess mit dieser Konfiguration neu
starten. Im Container müssen Installation und Check im finalen Runtime-Image
laufen. Der Deployment-Schritt sollte bei einem fehlgeschlagenen Check abbrechen.
Ein Shell-Check mit anderem Benutzer, PATH oder Environment belegt nicht die
Funktionsfähigkeit des API-Service.

## Fehlerdiagnose und erneuter Train-Lauf

Neue Worker-Fehler geben nur einen stabilen Fehlercode und eine Diagnostic-ID
an den Job weiter. `portfolio_runtime_unavailable` kennzeichnet Importfehler;
sonstige Worker-Fehler verwenden `portfolio_failed`. Interpreter, stderr und
technische Details stehen unter derselben ID im Serverlog. Bereits gespeicherte
Job-Fehler werden dadurch nicht nachträglich bereinigt.

Nach erfolgreichem Check den tenant-gebundenen Train-Request mit dem Token für
`stromdao` erneut senden. Die bestehende Historie der Series
`smard-de-total-load-netzlast-2024q2-berlin-context` verwenden:

```json
{
  "series_ids": ["smard-de-total-load-netzlast-2024q2-berlin-context"],
  "strategy": "shared_baseline",
  "forecast_for": "2024-06-24",
  "forecast_context": {
    "location": "Berlin",
    "weather_region": "DE-BE-Berlin",
    "country": "DE"
  },
  "weather_region": "DE-BE-Berlin"
}
```

`POST /api/forecast-sandbox/consumption/portfolio/train`, danach den zurückgegebenen
Job über `GET /api/jobs/:jobId/status` beobachten und das Ergebnis über
`GET /api/forecast-sandbox/consumption/portfolio/runs/:run_id` prüfen.
Erfolg verlangt einen abgeschlossenen Train-Lauf mit `model_version` sowie einen
anschließenden erfolgreichen Predict-Lauf. Ein erfolgreicher Runtime-Check allein
belegt weder fachliche Eignung der Historie noch Trainingsqualität.

Referenz des gemeldeten Fehlers: Job `a3e58d4a-77bd-4a57-8943-04bfc40502c5`,
Run `103a57580bacc67edb3759b5abe1a4217c4f645efb10bd8baab2232788ac36ba`.
