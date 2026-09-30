# Forecast-Modelle zwischen CET-Instanzen übertragen

`tools/forecast-product/transfer.py` überträgt den vollständigen Forecast-Runtime-Speicher offline. Format `cet-forecast-transfer`, Version **1**. Ein erneutes Training ist bei kompatiblen Instanzen nicht notwendig.

Enthalten sind private Zählermodelle mit unveränderten Tenant-Zuordnungen, alle gespeicherten Historienversionen, abgeschlossene Trainings-/Prognoseläufe, gemeinsame Basismodelle, Referenzhistorien und Contributor-Zuordnungen. So können neue Zähler auf der Zielinstanz die bisherigen Referenzen nutzen und selbst neue Evidenz beitragen. Auch ältere Portfolio-Modelle werden unterstützt, sofern sie die Kompatibilitätsprüfung bestehen.

Nicht enthalten sind Tokens, `.env`, Token-Datenbank, Job-Queue, XLSX-Quelldateien und Backtest-Archive außerhalb des Runtime-Verzeichnisses. Das ist ein administrativer Dateisystemtransfer, kein REST-Endpunkt. Ein CET_API_TOKEN wird hierfür nicht benötigt; nach dem Import benötigt die REST API weiterhin gültige Credentials derselben Tenant-ID. Eine Tenant-Umbenennung ist nicht vorgesehen.

## Voraussetzungen

- Quell- und Zielinstanz verwenden identische Forecast-Python- und REST-Orchestrierungsdateien sowie identische Versionen von CatBoost, NumPy, scikit-learn und skops. Das Werkzeug prüft diese Bedingungen und die eingebetteten Modellmetadaten. Python 3.11+ und die Forecast-Virtualenv verwenden. Der Import benötigt Linux mit `renameat2` für atomare Veröffentlichung ohne Überschreiben.
- Auf der Quelle müssen alle Runtime-Läufe abgeschlossen sein. Unvollständige oder inkompatible Läufe werden abgelehnt; nicht durch Löschen einzelner Dateien umgehen.
- Während Export und Import müssen die jeweils betroffenen Services und Forecast-Worker gestoppt sein. `--service-stopped` ist die ausdrückliche Bestätigung des Operators; das Werkzeug stoppt oder überwacht PM2 nicht. Belegte Dateisperren und Änderungen während des Exports werden zusätzlich geprüft.
- Das Zielverzeichnis darf noch nicht existieren. Kein Merge und kein Überschreiben vorhandener Produktionsdaten. Bei einer bestehenden Installation ein neues versionsbezogenes Verzeichnis verwenden und erst nach erfolgreichem Import umschalten.

## Runbook

Alle Befehle aus dem CET-Repository ausführen. Die Pfade sind Beispiele; bei gesetztem `FORECAST_PORTFOLIO_RUNTIME_PATH` dessen tatsächlichen Wert verwenden.

1. Jobs beenden lassen und Quellservice einschließlich Worker stoppen. Export erstellen:

```bash
.venv-forecast/bin/python tools/forecast-product/transfer.py export \
  --runtime ./data/forecast-portfolio-runtime \
  --archive /srv/cet-transfers/forecast-v1.zip \
  --service-stopped
```

Die JSON-Ausgabe enthält `sha256`, Dateianzahl und Anzahl der Vergleichsprognosen. Die SHA-256-Prüfsumme separat und vertrauenswürdig aufbewahren. ZIP und Prüfsumme auf die Zielinstanz übertragen. Das ZIP enthält vertrauliche Messhistorien aller enthaltenen Tenants; es ist nicht verschlüsselt und gehört ausschließlich in Betreiberhand. Dateirechte werden auf 0600, Verzeichnisse auf 0700 begrenzt.

2. Auf der Zielinstanz zunächst prüfen; der angegebene Runtime-Pfad wird dabei nicht angelegt:

```bash
.venv-forecast/bin/python tools/forecast-product/transfer.py verify \
  --archive /srv/cet-transfers/forecast-v1.zip \
  --sha256 '<SHA256-AUS-DEM-EXPORT>' \
  --runtime /srv/cet-data/forecast-runtime-v1
```

Prüfung umfasst Paket- und Einzeldatei-Prüfsummen, Formatversion, Code-/Bibliotheksversionen, Modelldateien, Referenzen, Tenant-Bindungen sowie erneute historische Prognosen für jeden Zähler jeder Modellversion. Die Prognosen müssen bei identischen Zeitstempeln mit relativer/absoluter Toleranz `1e-10` übereinstimmen. Das ist ein Transfer-Konsistenztest, kein neuer Qualitätsbenchmark. Alle nativen Modelle werden geladen, auch aktuell nicht ausgewählte Ersatzmodelle.

3. Zielservice stoppen, dann importieren:

```bash
.venv-forecast/bin/python tools/forecast-product/transfer.py import \
  --archive /srv/cet-transfers/forecast-v1.zip \
  --sha256 '<SHA256-AUS-DEM-EXPORT>' \
  --runtime /srv/cet-data/forecast-runtime-v1 \
  --service-stopped
```

Der Import prüft erneut vollständig in einem temporären Nachbarverzeichnis. Erst bei Erfolg wird dieses als Zielverzeichnis veröffentlicht. Bei Prüffehlern bleibt das Ziel unangetastet. Parallelimporte auf denselben Pfad werden gesperrt. Nach einem Prozess-/Hostabsturz können temporäre Verzeichnisse oder `<Ziel>.import.lock` zurückbleiben; nur nach Prüfung, dass kein Import mehr läuft, entfernen.

4. Auf der Zielinstanz `FORECAST_PORTFOLIO_RUNTIME_PATH=/srv/cet-data/forecast-runtime-v1` konfigurieren. Der CET-Servicebenutzer muss Zugriff auf das importierte Verzeichnis haben. Service starten und mit einem Token der bisherigen Tenant-ID eine Prognose über `predict_meter.py` abrufen. `model_version` und `series_id` bleiben unverändert. Tokens werden auf der Zielinstanz separat bereitgestellt.

Für eine Rückkehr zum vorherigen Stand Service stoppen und den bisherigen Runtime-Pfad wieder konfigurieren. Zwischenzeitlich hinzugekommene Daten werden dadurch nicht in den alten Stand übernommen; der Import ist kein Synchronisationsverfahren.

## Grenzen

- V1 überträgt den gesamten Runtime-Speicher; kein tenantweiser Teilimport, keine automatische Zusammenführung und keine automatische Formatmigration.
- Die Paketprüfsumme ist keine digitale Signatur. Nur Pakete aus vertrauenswürdiger Betreiberquelle importieren und die Prüfsumme über einen vertrauenswürdigen Kanal beziehen.
- Standardlimit: 100 GiB entpackter Inhalt, über `--max-bytes` anpassbar. Zusätzlich Platz für temporäres Entpacken vorhalten.
- Historische Request-Dateien behalten ihre Originalpfade als Audit-Daten. Nur abgeschlossene Läufe werden übertragen und nicht neu ausgeführt. Neue Prognosen und Trainings verwenden den konfigurierten Zielpfad. Frühere Job-IDs stehen auf der Zielinstanz nicht in der Job-Queue; Modell-/Run-IDs bleiben erhalten.
- Ein Transfer verjüngt weder Messwerte noch Modell: Aktualitätsschranken und `next_refit_date` gelten unverändert. Mit Messdaten bis 2024 entsteht durch den Import keine aktuelle Prognose für 2026.

## Tests

```bash
PYTHONPATH=tools/forecast-product:tools/forecast-portfolio \
  .venv-forecast/bin/python -m unittest tools/forecast-product/test_transfer.py -v

# Erst isolierte HTTP-Fixture erzeugen, dann deren ausgegebenen Artefaktpfad verwenden:
node tools/forecast-product/uat.js
node tools/forecast-product/transfer_uat.js /tmp/forecast-cli-http-XXXXXX
```

Der zweite Test exportiert/importiert die isolierte Fixture, vergleicht die REST-Prognose, prüft den verweigerten Zugriff eines fremden Tenants und trainiert einen neuen Zähler mit den übertragenen Referenzen. Er verändert keine laufende PM2-Instanz.

Validiert am 2026-09-27: 7 Transfer-Tests und 11 bestehende CLI-Tests bestanden;
ESLint für den HTTP-Test ohne Befund. Isolierter REST-Transfer-Test ebenfalls bestanden:
identische Prognose nach Pfadwechsel, fremder Tenant abgewiesen, neuer Zähler mit drei
übertragenen Referenzzählern trainiert. Lokales Testprotokoll:
`/tmp/forecast-transfer-http-2uDCop/report.json` (temporäres Entwicklungsartefakt).
