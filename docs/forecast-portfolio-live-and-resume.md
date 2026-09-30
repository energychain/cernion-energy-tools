# Portfolio-Forecast: Wiederaufnahme und echte REST-Prognosen

**Aktueller Produktpfad:** [Gemeinsamer Modellbestand, einzelne Zähler und optionale Merkmale](forecast-product-contract.md). Live-Historie und Einsatzmodelle verlangen jetzt einen credential-gebundenen Tenant. Die folgenden älteren Beispiele beschreiben das Portfolioverfahren; D−3 ist inzwischen Standard, der gespeicherte Modellvertrag ist maßgeblich.

Stand 26.09.2026. Rechenmethode `portfolio_catboost_0700_v1`, dauerhafter
Ausführungsvertrag Version 2. Die technische Implementierung ist vorhanden;
die Bewertung des nächsten vollständigen Elf-Dateien-Backtests steht noch aus.

## Einrichtung

Python-Abhängigkeiten wie in [Portfolio-07:00](forecast-portfolio-0700.md) installieren.
API mit aktualisiertem Code neu starten. Die Implementierung verwendet Linux-Dateisperren;
Python und API laufen auf demselben Host mit gemeinsamem persistentem Dateisystem.
`FORECAST_PORTFOLIO_RUNTIME_PATH` bestimmt den Speicherort für Historien, Modelle,
Anfragen, Zwischenstände und Ergebnisse (Default `data/forecast-portfolio-runtime`).
Dieses Verzeichnis muss einen Neustart überleben und in Datensicherung und
Aufbewahrungsregeln aufgenommen werden. Es gibt keine automatische Löschung.
Mandanten besitzen getrennte, aus der authentifizierten API-Metadatenidentität
abgeleitete Verzeichnisse; eine Mandanten-ID im Request-Body ist nicht maßgeblich.

Alle nachfolgend abgekürzten REST-Pfade liegen unter
`/api/forecast-sandbox/consumption/portfolio`. Authentifizierung wie bei der
bestehenden Sandbox. Training und Prognose verwenden die bestehende serielle
Job-Warteschlange und geben normalerweise HTTP 202 mit `jobId` und `run_id` zurück.
Bereits abgeschlossene identische Anfragen liefern HTTP 200 aus dem dauerhaften
Ergebnis. Der Aufrufer muss beide Fälle unterstützen.

## Volltest und Resume

Der bisher empfohlene Aufruf mit `portfolio_forecast_test.py` und
`portfolio-0700.json` bleibt gültig. **Für den nächsten Volltest die aktuelle
Skriptversion im Repository verwenden**, nicht die archivierte alte Kopie.
Neue Läufe speichern nach jedem vollständig berechneten 28-Tage-Block atomar
Prognosen, Modellwahlbelege und Ausfallszenarien. Ein unvollständiger Block wird
bei Wiederaufnahme erneut berechnet. Gesicherte Blöcke werden überprüft und
übersprungen. Code, Bibliotheksversionen, Eingaben und Konfiguration müssen passen.

Aus `tmp/profile`, mit denselben elf Dateien in derselben Reihenfolge:

```bash
python3 ../../tools/xlsx-forecast-test/portfolio_forecast_test.py \
  --xlsx 1_2020-2024.xlsx 2_2020-2024.xlsx 3_2020-2024.xlsx \
         4_2021-2024.xlsx 5_2020-2024.xlsx 6_2021-2024.xlsx \
         7_2020-2024.xlsx 8_2020-2024.xlsx 9_2020-2024.xlsx \
         10_2021-2024.xlsx 11_2020-2024.xlsx \
  --resume cells_energy_portfolio_neuer_lauf \
  --out cells_energy_portfolio_neuer_lauf_resume
```

`--resume` liest einen **mit dieser Implementierung gestarteten** Lauf und
schreibt in ein neues Verzeichnis. Es übernimmt Konfiguration, Zeitraum,
Einheiten und Serveradresse; `--base-url` kann einen geänderten Serverstandort
angeben. Die Eingabedateien müssen denselben Hash und dieselbe Reihenfolge haben.
Bereits gespeicherte Uploads werden wiederverwendet. Der Client benötigt weiterhin
die ursprünglichen XLSX-Dateien, um Istwerte unabhängig nachzurechnen.
Ein Lauf ohne bestätigte `run_id` kann nicht sicher wiederaufgenommen werden.

Der am 26.09. abgebrochene alte Job
`5536fa2a-4bd2-4cc6-8dde-79bbb6f055ba` hat **keine nachträglich wiederherstellbaren
Zwischenstände**. Dafür ist einmal ein neuer Volltest notwendig.

Temporäre Fehler bei GET-Anfragen werden bis zu fünf Minuten überbrückt. Ein
Serverneustart mit `recovery_pending` führt zum expliziten Resume desselben
Laufs. POSTs werden nicht blind wiederholt. Identische fachliche Anfragen sind
serverseitig inhaltsadressiert; konkurrierende Worker werden per Dateisperre
serialisiert. Ein hart beendeter Linux-Broker beendet auch seinen Python-Worker.

`Strg+C` im neuen Client trennt die Beobachtung, beendet aber nicht automatisch die
serverseitige Berechnung. Deren Job kann bei Bedarf über den vorhandenen
`POST /api/forecast-sandbox/consumption/evaluation/jobs/{jobId}/cancel` abgebrochen
werden. Ein expliziter Abbruch wird vom Client nicht automatisch aufgehoben;
ein später bewusst gestartetes `--resume` kann gesicherte Blöcke weiterverwenden.
Client-Zeitlimit ist ebenfalls kein Löschvorgang. Server-Zeitlimit bleibt
`FORECAST_JOB_TIMEOUT_SECONDS` (standardmäßig sechs Stunden).

Ergebnisse werden je Zähler komprimiert und atomar gespeichert. Über die
Job-Infrastruktur wird nur ein kleines Manifest übertragen, nicht mehr ein
Gesamtobjekt mit allen elf Reihen. Der Client lädt eine Reihe nach der anderen.
Die API bietet:

- `GET /runs/{run_id}`: dauerhafter Status und Anzahl gesicherter Blöcke;
- `POST /runs/{run_id}/resume`: exakte gespeicherte Anfrage wiederaufnehmen;
- `GET /runs/{run_id}/series/{series_key}`: ein JSON-Ergebnis als Stream;
  die URL steht im Ergebnismanifest.

Das dauerhafte Ergebnis bleibt unabhängig von der normalen Job-TTL verfügbar.
`--replay` rechnet archivierte HTTP-Antworten nach, ohne neue Serverarbeit.
Skripte, `requirements.txt`, Konfiguration, Eingabe-Hashes und HTTP-Antworten
werden im Ausgabeordner archiviert. `report.json` ergänzt Auswahlhäufigkeiten
und RMSE-Gewinn gegenüber der Vorwochenreferenz; die Fehler aller Kandidaten,
saisonale Fehler, Null-/Aktivitätsfehler, Tagesmengen, Peaks und Ausfallszenarien
bleiben Bestandteil des Berichts. Diese Auswertung wählt nicht rückwirkend das
beste Modell im Prüfzeitraum aus.

## Zählerhistorie einmal importieren, danach nur ergänzen

`POST /history` akzeptiert entweder `dataset` oder eine ausdrücklich übergebene
`dataset_id` eines vorhandenen Backtest-Uploads. Beispiel eines Erstimports:

```json
{
  "dataset_id": "SHA256_DES_BISHERIGEN_UPLOADS",
  "historical_import": true
}
```

`historical_import: true` ist nur beim erstmaligen Aufbau zulässig. Es übernimmt
explizite `available_at`-Werte oder die offengelegte Annahme „am nächsten lokalen
Tagesbeginn verfügbar“. Das ist keine Rekonstruktion tatsächlich unbekannter
historischer Lieferzeiten. Normale Live-Nachlieferungen werden frühestens ab
Eingang auf diesem Server berücksichtigt; `available_at` kann sie weiter verzögern.

Neue Messungen benötigen keine vollständige Historie:

```json
{
  "dataset": {
    "series_id": "meter-6",
    "unit": "kWh",
    "timezone": "Europe/Berlin",
    "values": [
      {"timestamp": "2026-09-28T21:45:00Z", "value": 1.658}
    ]
  }
}
```

`period_from` und `period_until` werden bei Deltas bei Bedarf abgeleitet.
Identische Werte werden dedupliziert. Änderungen vorhandener Werte verlangen
`allow_corrections: true`; ihre früheste Verfügbarkeit ist der Korrektureingang.
Die früheren Werte und Historienversionen bleiben gespeichert. Eine fehlende
Viertelstunde wird nicht mit null aufgefüllt. Änderungen an Einheit oder Zeitzone
werden abgewiesen. Die Antwort enthält `history_version`, `added`, `corrections`.

## Einsatzmodell trainieren und inspizieren

`POST /train`:

```json
{"series_ids": ["meter-1", "meter-6"], "forecast_for": "2026-09-30"}
```

Der Ursprung ist hier Dienstag, 29.09.2026, 07:00 lokal. Er darf beim Aufruf nicht
mehr in der Zukunft liegen. Das Training verwendet nur die zu diesem Ursprung
zulässigen Daten und historische Features; Such-/Bestätigungsfenster und
Auswahlregel entsprechen dem Backtest. Der letzte verfügbare Trainingsmesswert
jedes Zählers darf relativ zum Ursprung höchstens sieben Tage alt sein. Die
übrigen Anforderungen an Trainingsvorlauf gelten weiterhin. Daten bis 2024 allein
reichen damit nicht für einen Einsatzursprung im September 2026.

Das Ergebnis enthält eine unveränderliche `model_version` und den Modellvertrag.
Native `.cbm`-Dateien werden für globale/lokale Regressoren, Aktivitätsklassifikator
und Mengenmodelle gespeichert; konstante Modelle erhalten einfache JSON-Werte.
Metadaten enthalten Skalierungen, Schwellen, Auswahlbelege, Historienversionen,
Informationsgrenzen, Identitäten, Code-/Bibliotheksversionen und Prüfsummen.
Es werden keine Pickle-Dateien geladen. Die native Speicherung folgt den
[CatBoost-Save](https://catboost.ai/docs/en/concepts/python-reference_catboost_save_model)-
und [Load-Methoden](https://catboost.ai/docs/en/concepts/python-reference_catboost_load_model).

`GET /models/{model_version}` zeigt Metadaten und `next_refit_date`.
Modellversionen werden explizit in Prognoseanfragen angegeben. Damit ist der
Versionswechsel kontrollierbar und eine ältere, noch zulässige Version weiterhin
ansprechbar. Ein Backtest aktiviert kein Modell automatisch.

## Echte Prognose

`POST /predict`:

```json
{
  "series_id": "meter-6",
  "model_version": "MODELLVERSION_AUS_TRAIN",
  "forecast_for": "2026-09-30",
  "recent_dataset": {
    "series_id": "meter-6",
    "unit": "kWh",
    "timezone": "Europe/Berlin",
    "values": [{"timestamp": "2026-09-28T21:45:00Z", "value": 1.658}]
  }
}
```

`recent_dataset` ist optional. Ohne neue Werte wird die gespeicherte Historie
verwendet. Alternativ kann eine `history_version` ausdrücklich festgelegt werden;
das lässt sich nicht mit gleichzeitiger Datenänderung kombinieren. Neue Werte
ändern die Features, nicht die Modellparameter. Für globale Modelle benötigt
die einzelne Vorhersage nur die Historie dieses Zählers.

Die Antwort enthält Viertelstundenwerte, Tagesenergie in kWh, `information_as_of`,
`generated_at`, `model_created_at`, Modell-/Historienversion, verwendeten Kandidaten,
Trainingsgrenzen, D−2-Abdeckung, letztes vollständiges Profil und Warnungen. Beim
zweistufigen Kandidaten wird die Aktivitätswahrscheinlichkeit mitgeliefert.
Historische Simulationsursprünge und tatsächlicher Erstellungszeitpunkt bleiben
somit unterscheidbar. Fehlende Historie verwendet dieselben kausalen Ersatzpfade
wie der Backtest; ohne brauchbare Referenz schlägt die Prognose ausdrücklich fehl.
Sommer-/Winterzeit ergibt 92 beziehungsweise 100 Viertelstunden.

Für Mittwoch sind Dienstag um 07:00 nur bis Montag reichende, zu diesem Zeitpunkt
verfügbare Messungen zulässig. Wenn neue Werte erst Dienstag 08:00 eintreffen,
gehen sie **nicht rückwirkend** in diese 07:00-Prognose ein. Intraday-Prognosen
sind nicht Teil dieses Vertrags.

## Aktualisierung

Nach 28 Tagen gilt das Modell als nachzutrainieren. Standardmäßig wird eine
Prognose mit fälligem Modell abgewiesen. `allow_stale_model: true` erlaubt die
explizite Weiterverwendung mit Warnung; dies ändert keine Modellparameter.

`POST /retrain` mit `model_version` und neuem `forecast_for` übernimmt die
Mitglieder des bisherigen Portfolios und liest deren aktuelle Historien.
Es entsteht eine neue Version, die der aufrufende Betrieb anschließend explizit
verwendet. Dieser Endpunkt kann von dessen Zeitsteuerung alle 28 Tage aufgerufen
werden. **Es wird kein unaufgeforderter Zeitplan auf dem Server eingerichtet und
kein Modell stillschweigend aktiviert.** Alle alten Versionen bleiben erhalten;
ein Code-/Bibliothekswechsel verlangt kompatibles Neutraining.

## Gezielte Prüfung vor dem Volltest

```bash
npx jest tests/forecast-portfolio-runtime.test.js tests/forecast-portfolio.test.js \
  tests/forecast-evaluation-jobs.test.js --runInBand --coverage=false
.venv-forecast/bin/python -m unittest discover -s tools/forecast-portfolio -p 'test_*.py'
python3 -m unittest discover -s tools/xlsx-forecast-test -p 'test_*.py'
node scripts/run-forecast-portfolio-uat.js --test tmp/profile/portfolio-runtime-uat-neu
```

Der letzte Aufruf verwendet einen isolierten echten HTTP-Gateway mit synthetischen
Daten, beendet ihn absichtlich hart und prüft Wiederaufnahme, Ergebnisabruf,
Modell-Wiederladen und Korrekturverfügbarkeit. Er startet keinen Elf-Dateien-Volltest
und verändert den laufenden PM2-Service nicht.
