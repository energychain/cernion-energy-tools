# Lastprognose als Produkt: gemeinsamer Modellbestand und private Zähler

Stand: 27.09.2026. Produktverfahren: `shared_baseline_0700_v1`.

## Authentifizierung und Eigentum

Präfix: `/api/forecast-sandbox/consumption/portfolio`.
Für `/history`, `/train`, `/predict`, `/retrain` und `/models/{model_version}` ist ein
API- oder Session-Token mit gebundener Tenant-ID erforderlich. Ein `x-tenant-id`-Header
allein genügt nicht. Der Server verwendet die verifizierte Token-Zuordnung; Tenant-IDs
werden nicht aus dem Prognose-Request übernommen. Auch Jobstatus, Fortschritt, Resultat,
Wiederaufnahme und Run-Abfrage der Einsatzmodelle sind entsprechend geschützt.

Ein Zähler wird durch `(tenant_id, series_id)` identifiziert. Verschiedene Tenants dürfen
dieselbe `series_id` verwenden. Ein Modell eines anderen Tenants kann weder abgefragt
noch für eine Prognose verwendet werden. Modellversionen enthalten nur die eigenen
Zähleridentitäten, Auswahlbelege und Skalierungen; fremde Referenzhistorien und lokale
Modelle werden nicht ausgeliefert.

## Gemeinsamer Bestand

`strategy: "shared_baseline"` erstellt einen Produktlauf. Eine einzelne `series_id`
verwendet diesen Pfad auch ohne ausdrückliche Strategie. Bei mehreren IDs bleibt ohne
Strategie das bisherige Portfolioverfahren aktiv; beim initialen Produkttraining daher
`shared_baseline` ausdrücklich setzen. `portfolio_method` wird beim Produktverfahren
abgewiesen: Sein Vertrag ist fest D−3, MAE, Viertelstunden und Prognosezeitpunkt D−1 07:00.

Jedes erfolgreiche Produkttraining veröffentlicht die eigenen Historiensnapshots als
interne Evidenz für spätere Trainings. Der erste Lauf kann mit einem einzelnen Zähler
beginnen. Weitere Läufe beziehen kompatible Referenzen (gleiche Einheit/Zeitzone) ein.
Der Modellbestand wird unter `FORECAST_PORTFOLIO_RUNTIME_PATH/_shared-baseline`
gespeichert. Native gemeinsame Modelle, Snapshots und Versionen bleiben erhalten.
Es gibt keinen öffentlichen Endpunkt zum Herunterladen des Referenzbestands.

Der aktuelle Implementierungsstand trainiert die gemeinsamen Modelle anhand der
versionierten Evidenz neu; es ist kein inkrementelles Update bestehender CatBoost-Bäume.
Pro Zähler werden höchstens 4.096 Beispiele aus bis zu 180 Trainingstagen nach dem
Lag-Vorlauf verwendet; jeder Zähler erhält dasselbe Gesamtgewicht. Ältere Referenzzähler
müssen keine neuen Messwerte liefern. Neue Zähler benötigen eigene aktuelle Messwerte.
IDs sind kein gemeinsames Modellmerkmal. Verbrauch wird pro Zähler skaliert.

Der Referenzbestand wird bei Auftragserstellung festgeschrieben. Parallel eingehende
Beiträge stehen nach ihrer Veröffentlichung für nachfolgende Aufträge bereit. Updates
der Beitragsliste werden zusammengeführt; bestehende private Modelle bleiben unverändert.
Jedes Modell nennt seine `baseline_version`. Mehr Evidenz ist keine automatische
Qualitätsgarantie. Die Version wird nicht ohne Nachtraining auf bestehende Zähler umgestellt.

## Messdaten

`POST /history`:

```json
{
  "historical_import": true,
  "dataset": {
    "series_id": "meter-42",
    "unit": "kWh",
    "timezone": "Europe/Berlin",
    "value_semantics": "interval_energy",
    "profile_label": "office",
    "profile_available_at": "2026-07-01T00:00:00Z",
    "values": [
      {"timestamp": "2026-07-01T00:00:00Z", "value": 1.25, "reactive_power_kvar": 0.8}
    ]
  }
}
```

Das Beispiel zeigt das Format einer Zeile, keine ausreichende Trainingshistorie.
`value` ist nichtnegative Energie je Viertelstunde in kWh oder mittlere Wirkleistung in kW.
**Kumulierte OBIS-1.8.0-Zählerstände dürfen nicht direkt als `value` verwendet werden.**
Sie sind vor dem Import unter Berücksichtigung von Zählerwechseln/Resets in
Viertelstundenenergie umzuwandeln. `value_semantics: "cumulative"` wird abgewiesen.
Für kW gilt `value_semantics: "average_power"`. Ohne Angabe gelten die bisherigen
Intervallwerte gemäß `unit`; der Server kann unmarkierte Zählerstände nicht zuverlässig erkennen.

`reactive_power_kvar` ist optional, vorzeichenbehaftete **mittlere Blindleistung** derselben
Viertelstunde in kvar; keine kumulierte Blindarbeit und keine kvarh. Fehlend oder `null`
ist unbekannt, `0` ein gemessener Nullwert. Es werden nur historische Lags D−3/D−7 genutzt.
`profile_label` ist eine optionale Kategorie mit 1–64 Zeichen aus Buchstaben, Ziffern,
Unterstrich und Bindestrich. Ohne Angabe gilt intern `unknown`; keine Kundennamen eintragen.
`profile_available_at` legt fest, ab wann das Label bekannt war. Ohne Angabe gilt der
Empfangszeitpunkt. Ein später bekanntes Label wird nicht in frühere Features übernommen.

`historical_import` darf nur beim ersten Import verwendet werden und erklärt die
historische Verfügbarkeit der initialen Messwerte. Spätere Lieferungen und Korrekturen
werden frühestens ab Empfang berücksichtigt. `allow_corrections: true` ist für Änderungen
bereits gespeicherter Werte ausdrücklich erforderlich. Auch reine Zusatzmesswert-Updates
bei unverändertem Wirkarbeitswert erzeugen eine neue Historienversion.

## Training und Prognose

`POST /train`:

```json
{
  "series_ids": ["meter-42"],
  "strategy": "shared_baseline",
  "forecast_for": "2026-09-28"
}
```

Mindestens **28 beobachtete historische Tage vor der D−2-Grenze** sind nötig. Lücken können
zusätzliche Historie erfordern: mindestens sieben Tage nutzbare Trainingsbeispiele und
288 Validierungspunkte müssen verbleiben. Der letzte zulässige Messwert darf am Ursprung
höchstens sieben Tage alt sein. Der Informationsursprung D−1 07:00 darf beim Aufruf nicht
in der Zukunft liegen. Der Produktpfad akzeptiert 1–16 eigene Zähler pro Auftrag.

Unter 84 verfügbaren Tagen werden sieben Tage validiert und die Qualität als
`provisional_short_history` gekennzeichnet; sonst 28 Tage. Gemeinsame Modelle werden im
Validierungsschritt ebenfalls ohne Labels aus diesem Fenster trainiert. Wochenreferenz,
lokales Modell und gemeinsamer Basiskandidat werden nach Validierungs-MAE verglichen.
Der Kandidat mit optionalen Features muss den besten dieser drei Kandidaten um mindestens
3 % schlagen. Scheitert er, bleibt dieser bisherige Gewinner erhalten.

Es gibt einen gemeinsamen Kernkandidaten ohne Zusatzdaten und einen angereicherten
Kandidaten mit Verfügbarkeitsmerkmalen. Es wird nicht für jede Kombination optionaler
Messgrößen ein weiteres Modell angelegt. Wenn für den angereicherten Kandidaten bei der
Prognose überhaupt keine Zusatzmerkmale bekannt sind, wird der Kernkandidat verwendet.

Training und Prognose antworten asynchron mit `202`, `jobId`, `statusUrl`, `resultUrl`
und `run_id`. Mit demselben Tenant-Token den Job pollen. Das fertige Trainingsergebnis
liefert `model_version` und `model.baseline_version`.

`POST /predict`:

```json
{
  "series_id": "meter-42",
  "model_version": "VERSION_AUS_TRAIN",
  "forecast_for": "2026-09-28"
}
```

Gespeicherte Historie wird wiederverwendet. Optional kann `recent_dataset` neue Messwerte
im obigen Format enthalten. Alternativ ist `history_version` zum Festschreiben eines
Snapshots möglich; beide Felder dürfen nicht gemeinsam verwendet werden.
Die Antwort enthält `forecast_values` (`timestamp`, `predicted_value`), `unit`, `timezone`,
`daily_energy_kwh`, `information_as_of`, `generated_at`, `model_created_at`,
`model_version`, `baseline_version`, `history_version`, `selected_model`,
`next_refit_date` und `warnings`. Ein lokaler Tag umfasst 96, bei Zeitumstellung 92/100 Werte.

`POST /retrain` mit `model_version` und `forecast_for` erstellt eine neue private Version
und verwendet den dann verfügbaren Referenzbestand. Nach 28 Tagen wird Nachtraining
verlangt; `allow_stale_model: true` erlaubt ausdrücklich eine Warnungsprognose.
Es gibt keinen automatischen Zeitplan und keinen stillen Versionswechsel.

## Einführung und Validierungsstand

Nach Deployment ist ein initiales **Produkttraining** nötig. Bestehende Backtest-Dateien
werden nicht automatisch in den mandantenübergreifenden Bestand importiert. Der Betreiber
importiert die vorgesehenen Referenzzähler unter seinem Tenant und trainiert sie mit
`strategy: "shared_baseline"`. Danach können Kundentenants jeweils einzelne Zähler ergänzen.

Der neue Produktpfad ist eine eigene Methode; die WAPE-Ergebnisse des bisherigen
Portfolio-Backtests sind kein Qualitätsnachweis für ihn. Die Tests decken gemeinsame
Evidenznutzung, kurze Historie, optionale Features, Zeitgrenzen, Artefaktpersistenz,
Tenant-Abgrenzung und REST-Abläufe ab. Generalisierung muss auf zurückgehaltenen Zählern
und Zeiträumen geprüft werden. Die Zugriffstrennung ist keine formale Differential-Privacy-Garantie. Die gemeinsame Trainingsbasis benötigt auf einer einzelnen Instanz entsprechend mehr Rechenzeit und Speicher mit wachsender Zählerzahl; ein verteilter Trainingsdienst ist nicht Teil dieses Schritts.

Codeänderungen ändern die Modell-Prüfsumme. Bereits gespeicherte Einsatzmodelle müssen
explizit neu trainiert werden; abgeschlossene Backtest-Archive bleiben lesbar.

Prüfungen:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --coverage=false tests/forecast-product.test.js
.venv-forecast/bin/python -m unittest discover -s tools/forecast-portfolio -p test_product.py
node scripts/run-forecast-product-uat.js /tmp/forecast-product-uat
```

Der HTTP-Test startet eine isolierte Instanz mit zwei Testidentitäten. Er verändert keine
laufende PM2-Instanz und verwendet keine produktiven Messdaten.

## Hilfsscripts

[Tools und vollständiges Runbook](../tools/forecast-product/README.md) enthalten Initialtraining
mit den elf XLSX, Aufnahme neuer Zähler, Historienupdates, Prognose, Nachtraining und lokale
RMSE-/MAE-/WAPE-Auswertung. Alle REST-Befehle laden ausschließlich `CET_API_TOKEN` aus Umgebung/.env und prüfen dessen
Tenant vor dem ersten Import. Eine abweichende optionale `--tenant-id` blockiert den Client
nicht; gespeicherte Artefakte bleiben dem verifizierten Token-Tenant zugeordnet. Ein
konfigurierbarer Header-Override ersetzt keine serverseitige Berechtigung;
angenommene Jobs werden für spätere Wiederaufnahme gespeichert.

## Instanzwechsel

Ein versionierter administrativer Offline-Transfer ist über
`tools/forecast-product/transfer.py` implementiert: Export, Prüfung und Import in ein neues
Runtime-Verzeichnis. Private Modelle und Tenant-Zuordnungen sowie gemeinsame Modelle und
Referenzhistorien werden übernommen; API-Tokens werden separat auf der Zielinstanz verwaltet.
Siehe [Runbook und Grenzen](forecast-model-transfer.md). Dies ergänzt keinen öffentlichen
REST-Export-Endpunkt.

## Öffentliches Startmodell

Ein signiertes Core-Startmodell kann optional beim Service-Start aus einer konfigurierten
HTTPS-URL installiert werden. Neue Zähler vergleichen es kausal gegen lokale Kandidaten;
Zählerhistorien, Tenant-Zuordnungen und individuelle Modelle bleiben privat. Das Startmodell
benötigt keine Referenzhistorien des Herausgebers auf der Zielinstanz. Konfiguration, Freigabe,
Signatur, Offline-Installation und Versionsgrenzen:
[Öffentliches Forecast-Startmodell](forecast-public-starter.md).
