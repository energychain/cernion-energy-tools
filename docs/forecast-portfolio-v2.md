# Portfolio v2: MAE-Auswahl und nachvollziehbarer Benchmark

Implementiert am 26.09.2026. Methodikversion: `portfolio_mae_0700_v2`.
Qualitätsziel ist das ungewichtete Mittel der elf Zähler-WAPE. Ein Wert unter 70 %
ist erst durch einen neuen, vergleichbaren Lauf nachzuweisen.

## Methodenvertrag

`portfolio_method` ist in Backtest-Konfiguration und `/train` verfügbar.
`/retrain` übernimmt den Vertrag des vorhandenen Modells; `/predict` verwendet
verbindlich den gespeicherten Vertrag. Die neue Standardkonfiguration ist:

```json
{
  "latest_measurement_lag": 3,
  "feature_profile": "e2_v1",
  "selection_objective": "mae",
  "candidate_set": "extended",
  "training_mode": "rolling"
}
```

- `latest_measurement_lag`: 3 = Messungen bis einschließlich D−3;
  2 = Messungen bis einschließlich D−2. Zusätzlich muss die jeweilige
  Datenversion spätestens am Informationsursprung D−1 07:00 vorliegen.
  Die Grenze gilt für Lags, Tagesaggregate, Ersatzprofile und Trainings-/Validierungslabels.
- `feature_profile`: `e2_v1` oder `legacy_v1`. E2-Profil ergänzt D−3/4/7/14/28,
  Profilmittel D−7/8/9 und D−7/14 sowie zyklischen Wochentag.
  Bestehende Kalender-, Aktivitäts-, Missing- und Altersmerkmale bleiben für CatBoost
  erhalten. Lokales HGB verwendet separat den beschriebenen E2-Featuresatz in Originaleinheiten.
  Fehlende Werte bleiben NaN; Profilmittel mit fehlenden Bestandteilen werden nicht als
  vollständig beobachtete Mittel ausgegeben. Wochenreferenzen haben kausale Ersatzpfade.
- `selection_objective`: `mae` (neu) oder `rmse` (Vergleichsregel des bisherigen Ansatzes).
- `candidate_set`: `existing` = globale/lokale/zweistufige CatBoost-Kandidaten;
  `hgb` ergänzt lokalen HGB mit quadratischem Fehler und 75/25-Mischung HGB/Vorwoche;
  `extended` ergänzt HGB mit absolutem Fehler, globales CatBoost mit MAE-Loss und
  einen Hurdle-Kandidaten mit harter Wahl des Niedrig-/Aktivverbrauchsmodells bei p=0,5.
- `training_mode`: `rolling` trainiert alle 28 Tage neu; `frozen` trainiert und
  wählt einmal vor dem ersten Testtag. Beobachtete zulässige Lags aktualisieren sich
  auch bei eingefrorenen Gewichten täglich. Beide Modi sichern 28-Tage-Checkpoints.

Die vier Referenzen Vorwoche, Zweiwochenmittel, Vierwochenmittel und Vierwochenmedian
stehen in allen v2-Kandidatenstufen bereit. `existing` ist deshalb kein bitgenauer
Nachbau von v1, sondern eine kontrollierte v2-Ablation ohne zusätzliche ML-Kandidaten.

## Auswahl und Modelle

180 Trainingstage, mindestens 84 Tage plus Lag-Vorlauf; getrennte 28-Tage-Fenster
für Discovery und Confirmation. Referenz und Herausforderer werden im Discovery-
Fenster nach MAE bestimmt. Confirmation verlangt mindestens 3 % MAE-Gewinn gegen
die Referenz und eine positive untere Grenze des gepaarten Block-Bootstrap-Intervalls
(1000 Wiederholungen, sieben zusammenhängende lokale Tage, festgelegter Seed).
Die Blockauswertung gewichtet Tagesfehler mit der tatsächlichen Intervallzahl
und behandelt daher auch 92-/100-Intervall-Tage korrekt. Ohne Bestätigung bleibt die
Referenz. Die 3-%-Hürde und der 28-Tage-Rhythmus begrenzen Wechsel; eine zusätzliche
zustandsbehaftete Hysterese gegenüber dem zuletzt gewählten Experten ist nicht eingebaut.
Die Regel garantiert keinen Sieg auf späteren Testtagen.

Globales und lokales CatBoost bleiben getrennte Experten; Skalierung und gleiche
Gesamtgewichte je Trainingsreihe bleiben erhalten. Die Wahl eines lokalen Experten
entfernt dessen Trainingsdaten nicht automatisch aus dem globalen Pool. Profilcluster
sind ein optionaler späterer Herausforderer nach der Routing-Ablation.

HGB: 90 Iterationen, learning_rate=0.07, max_leaf_nodes=19,
min_samples_leaf=90, l2_regularization=8, max_bins=64; feste Zufallsinitialisierung,
early_stopping=False, keine zufällige Validierung. Negative Prognosen werden auf
null begrenzt. Das zweite im E2-Briefing nur erwähnte Mischungsverhältnis wird
nicht erfunden. E2-Trainingsfenster, Softwareversion, DST-Regel und Originalcode
fehlen weiterhin: `e2_v1` benennt den Featuresatz, keine bestätigte exakte E2-Reproduktion.

## Starten und reproduzieren

Server-Abhängigkeiten aktualisieren:

```bash
.venv-forecast/bin/python -m pip install -r tools/forecast-portfolio/requirements.txt
```

Danach den Forecast-Service neu starten. Vom Verzeichnis `tmp/profile` aus:

```bash
python3 ../../tools/xlsx-forecast-test/portfolio_forecast_test.py \
  --xlsx 1_2020-2024.xlsx 2_2020-2024.xlsx 3_2020-2024.xlsx \
         4_2021-2024.xlsx 5_2020-2024.xlsx 6_2021-2024.xlsx \
         7_2020-2024.xlsx 8_2020-2024.xlsx 9_2020-2024.xlsx \
         10_2021-2024.xlsx 11_2020-2024.xlsx \
  --base-url http://localhost:3900 --from 2023-01-01 --until 2024-12-31 \
  --unit kWh --time-basis berlin \
  --config ../../tools/xlsx-forecast-test/portfolio-0700.json \
  --out cells_energy_portfolio_v2_d3_mae
```

Für den eingefrorenen Q4-Vergleich `--from 2024-10-01 --until 2024-12-31`,
`--config ../../tools/xlsx-forecast-test/portfolio-e2-frozen.json` und einen neuen
Ausgabeordner verwenden. In Europe/Berlin umfasst Q4 8836 physische Viertelstunden
je Zähler. Ein 8832-Intervall-Vergleich muss die Abweichung ausdrücklich klären.
Die Einsatz-API behält ihre 28-Tage-Fälligkeitsprüfung; ein bewusst älteres Modell
benötigt dort weiterhin `allow_stale_model`, unabhängig vom Backtestmodus.

Backtest und `/train` erzeugen neue unveränderliche Kennungen. Alte Modellartefakte
und Checkpoints können nach einem Codewechsel nicht mit v2 weitergerechnet werden;
fertige archivierte Resultate bleiben auswertbar. Kein Produktionsmodell wird
automatisch aktiviert. Modelle bleiben in CatBoost-Nativformat bzw. für HGB im
Skops-Format ohne Pickle; unbekannte Typen, Prüfsummenfehler und abweichende
Code-/Bibliotheksversionen werden abgewiesen.

## Export und Vergleich

Der Ausgabeordner enthält Skripte, Konfiguration, HTTP-Belege und zusätzlich:

- `NNN-predictions.csv.gz`: Zähler, UTC-Zeitstempel, lokaler Zieltag, Informationsursprung,
  Ist-/Prognosewert, Experte, Mess-/Modellgrenzen, Fit-Ursprung, Daten-/Codeversion,
  Einheit und Verfügbarkeits-/Trainingsmodus.
- `NNN-metrics.csv`: unabhängig nachgerechnete N, Istbetragssumme, absolute und
  quadratische Fehlersumme, MAE, RMSE und WAPE für Auswahl und sämtliche Kandidaten.
- `report.json`: ausdrücklich getrennte Macro- und gepoolte WAPE sowie Zahl der
  Reihen mit definiertem WAPE. Nullsummenreihen werden nicht als WAPE=0 ausgegeben.

```bash
python3 compare_portfolio_exports.py \
  --left E4/001-predictions.csv.gz --right E2/001-predictions.csv.gz \
  --block-days 7 --out paired-meter-1.json
```

E2 muss hierfür die gleichen CSV-Spaltennamen verwenden. Es werden keine
unterschiedlichen Intervalle stillschweigend verworfen. Positive Werte im
`left_minus_right_MAE_interval` sprechen für rechts. Fehlende Vertragsfelder
werden als ungeprüft gekennzeichnet; Trainings-/Validierungsfristen und
Datenrevisionen erfordern zusätzlich einen Manifestvergleich. Die Intervalle
sind deskriptiv und ersetzen keinen unabhängigen Test nach Modellauswahl.

Zusätzliche Diagnosegruppen im Ergebnis: retrospektiv hohe Istwerte oberhalb
des 95-%-Quantils, starke Rampen, Null-zu-positiv-Übergänge; vorhandene Null-/Aktiv-
und Tagesmengenfehler bleiben enthalten. Diese retrospektiven Grenzen fließen
nicht in Training oder Auswahl ein.

## Ablationsfolge

1. Gleicher Zeitraum/DST/Datenvertrag; `legacy_v1`, `existing`, `rmse`.
2. Nur `selection_objective=mae` ändern.
3. `feature_profile=e2_v1`.
4. `candidate_set=hgb`.
5. `candidate_set=extended`.

Alle Läufe mit derselben Lag-Grenze und demselben Trainingsmodus vergleichen.
Die neuen Optionen erlauben getrennte Läufe; es wurde kein neuer vollständiger
Elf-Dateien-Lauf automatisch gestartet. Änderungen anhand 2023–2024 benötigen
anschließend eine Bestätigung auf einem bislang ungenutzten Zeitraum.

## Validierung der Implementierung

Gezielt erfolgreich geprüft: 36 JavaScript-Tests (Portfolio, Runtime, Vertrag,
Service/OpenAPI und Job-Lebenszyklus), elf bestehende Python-Regressionstests,
sieben neue Methodik-/Ablationstests sowie 33 Client-/Exporttests.
Der reale isolierte HTTP-Test besteht alle sechs Schritte: SIGKILL/Checkpoint-Resume,
erneuter Ergebnisabruf nach Neustart, Modell-Wiederladen/REST-Prognose,
revisionsgerechte historische Vorhersage, unbekannter Zähler und Neutraining mit
Erhalt der alten Version. Zwei echte HTTP-Backtestergebnisse wurden zusätzlich
mit dem unabhängigen Client verifiziert und exportiert. Das Test-Polling wurde
auf eine Sekunde angepasst, damit längere Fits nicht das API-Ratenlimit auslösen.

Lint und Python-Kompilierung erfolgreich, `pip check` ohne Konflikte,
OpenAPI-Audit ohne Fehler (bestehende projektweite Warnungen), generiertes
`llm.txt` aktuell. Keine PM2-Neustarts und kein neuer vollständiger XLSX-Lauf
wurden für diese Implementierung ausgeführt.
