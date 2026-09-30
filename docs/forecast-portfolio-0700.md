# Gemeinsamer 07:00-Backtest – neue Baseline

Betrieb und Wiederaufnahme: [REST-Prognosen und Resume](forecast-portfolio-live-and-resume.md).
Umsetzungsstand der Merkliste: [Implementierungs-Gaps](forecast-portfolio-implementation-gaps.md).

Version: `portfolio_catboost_0700_v1`. Der neue, ausdrücklich wählbare Portfolio-Pfad
vergleicht 2–16 nichtnegative Viertelstundenreihen gemeinsam. Er ist ein
Backtest mit rollierenden Prognosen. Persistente Einsatzmodelle und echte
REST-Prognosen sind über den gesonderten [Betriebspfad](forecast-portfolio-live-and-resume.md)
verfügbar. Die bisherigen Modellfamilien bleiben
separat aufrufbar.

## Festgelegte Methode

- Prognose für D am D−1 um **07:00 in der Zeitreihe-Zeitzone**. Messungen
  höchstens bis einschließlich D−2 und nur mit `available_at <= Prognosezeitpunkt`.
  Ohne `available_at` gilt die Annahme „am folgenden lokalen Tagesbeginn
  verfügbar“. Tatsächliche Lieferverzögerungen lassen sich ohne Lieferzeitstempel
  nicht rekonstruieren. Sommer-/Winterzeit behält 92/100 physische Intervalle.
- Gemeinsamer Informationsstand für **alle** Reihen. Features: Lastgang-ID,
  Zielviertelstunde, Wochentag, Wochenende, Monat/Jahreszyklus, Lags 2/7/14/21/28
  Tage, Fehlwertindikatoren, historische Aktivität, D−2-Abdeckung, älteres
  vollständiges Profil und Alter der letzten verfügbaren Messung. Training nutzt
  die jeweils zum historischen Prognosezeitpunkt zulässigen Features.
- Referenzen: Vorwoche, Mittel und Median der letzten vier vergleichbaren
  Wochentage. Bei Lücken ältere vollständige Profile bzw. ältere vergleichbare
  Wochentage. Fehlende Messwerte bleiben fehlend; gemessene Nullen bleiben null.
- Herausforderer: gemeinsamer CatBoost-Regressor, einzelne CatBoost-Regressoren,
  gemeinsames Aktivitäts-/Mengenmodell. Letzteres lernt pro Trainingsfenster eine
  niedrige Verbrauchsschwelle, die Wahrscheinlichkeit oberhalb dieser Schwelle
  und getrennte Mengenmodelle für niedrigen und aktiven Verbrauch. Prognose:
  `(1−p) × niedrige Menge + p × aktive Menge`. Kein pauschales Abrunden auf null.
- Reihen werden mit ihrem **Trainingsmittel** skaliert und im gemeinsamen Fit
  gleich gewichtet. Feste Parameter: 120 Bäume, Tiefe 5, Lernrate 0,05,
  Seed 73471, ein CPU-Thread. ID-One-Hot-Encoding vermeidet zielbasierte
  ID-Kodierung. Keine automatische Hyperparametersuche auf dem Prüfzeitraum.
- Vor jedem 28-Tage-Prognoseblock: 28 Tage Kandidatensuche, anschließend 28 Tage
  Bestätigung, anschließend neuer Fit. Sämtliche Fits nutzen maximal 180
  vorangegangene Tage. Am ersten Prognosetag D endet das Bestätigungsfenster D−2;
  die Modellparameter der Bestätigungsprognosen wurden bereits vor dessen Beginn
  trainiert. Jeder innere Fit beachtet denselben D−2-/07:00-Vertrag.
- Die beste Referenz und der beste Boosting-Kandidat werden im Suchfenster
  bestimmt. Einsatz je Lastgang nur bei Bestätigung: mindestens 3 % RMSE-Gewinn,
  keine MAE-Verschlechterung, mindestens 3 von 4 besseren Wochen und positive
  untere Grenze eines Wochen-Bootstraps. Vier Wochen sind begrenzte Evidenz;
  dies ist eine konservative Auswahlregel, kein allgemeiner Signifikanznachweis.
  Bei fehlenden rechtzeitig verfügbaren Validierungs-Istwerten gilt die
  Wochentagsmedian-Referenz.
- Mindestens 84 belegte Trainingstage plus 35 Tage Lag-Vorlauf vor dem ersten
  Suchfenster; bei lückenloser Historie mindestens **177 Kalendertage vor dem
  ersten Prüftag** bereitstellen. Größere Lücken können mehr Vorlauf verlangen.
- Wetter, Feiertagsdaten, Preise und nationale Last sind in v1 ausgeschlossen.
  CatBoost ist zunächst der implementierte Boosting-Kandidat; LightGBM und
  neuronale Modelle sind noch keine Bestandteile dieses Vergleichs.

## Installation und kompletter XLSX-Lauf

Auf dem **API-Server**, Python 3.12 oder kompatibel:

```bash
python3 -m venv .venv-forecast
.venv-forecast/bin/pip install -r tools/forecast-portfolio/requirements.txt
```

Der Server verwendet automatisch `.venv-forecast/bin/python`; alternativ
`FORECAST_PYTHON` als absoluten Interpreterpfad setzen. Den API-Prozess nach dem
Code-Update neu starten. Client-Abhängigkeiten wie bisher aus
`tools/xlsx-forecast-test/requirements.txt` installieren. CatBoost ist nur auf dem
Server nötig. Der gemeinsame Lauf benötigt mehr Zeit als ein einzelner Fit;
Serverlimit `FORECAST_JOB_TIMEOUT_SECONDS` und Clientlimit `--job-timeout` passend
setzen (Default Server sechs Stunden, Client 24 Stunden).

Alle elf Dateien in **einem** Aufruf übergeben:

```bash
python3 tools/xlsx-forecast-test/portfolio_forecast_test.py \
  --xlsx '/pfad/zu/den/dateien/*.xlsx' \
  --from 2023-01-01 --until 2024-12-31 \
  --base-url http://localhost:3900 \
  --unit kWh --time-basis berlin \
  --out tmp/profile/cells_energy_portfolio_0700_v1
```

Einheit und Zeitkonvention müssen dem Export entsprechen. Für einen direkten
Vergleich den tatsächlich gemeinsamen Prüfzeitraum aller Dateien verwenden;
`--from` und `--until` entsprechend anpassen. Der Ausgabeordner darf noch nicht
existieren. Der Client verlangt vollständige Istwerte im Prüfzeitraum und
unterschiedliche Lastgang-IDs. Er übernimmt denselben strengen XLSX-Import wie der
bisherige Testclient und prüft Kennzahlen sowie Zeitgrenzen unabhängig nach.
Der bisherige Einzeldatei-Client erzeugt **kein** gemeinsames Training.

Authentifizierung: wie bisher `CET_API_TOKEN` im Client-Environment. Übertragungen
an entfernte Server verlangen HTTPS. Die Datei-Uploads werden einzeln validiert,
mandantenbezogen und inhaltsadressiert gespeichert; erst danach wird ein
asynchroner gemeinsamer Job gestartet. Status, Ergebnis, Timeout und Abbruch
laufen über die vorhandene Job-Infrastruktur. Wiederholte identische Uploads
verwenden dieselbe ID. Speicherort: `FORECAST_PORTFOLIO_DATA_PATH` oder
`data/forecast-portfolio`; keine automatische Löschfrist. Diese Dateien enthalten
Messdaten und sollten nach der vereinbarten Aufbewahrungsfrist entfernt werden,
wenn keine laufenden oder geplanten Wiederholungsjobs sie mehr benötigen.

API-Pfade:

- `POST /api/forecast-sandbox/consumption/portfolio/datasets`: `{ "dataset": ... }`
- `POST /api/forecast-sandbox/consumption/portfolio/run`: `dataset_ids`,
  `configuration` aus `portfolio-0700.json` plus Prüfzeitraum und
  `payload_fit_confirmed: true`.

## Auswertung und Reproduzierbarkeit

`report.md` zeigt RMSE, MAE, WAPE und die bisherige Signalheuristik getrennt vom
technischen Laufstatus. `report.json` enthält zusätzlich:

- Fehler aller sechs Kandidaten auf genau denselben Prüfintervallen;
- Tagesenergiefehler, saisonale Fehler, aktive und Nullintervalle sowie Peaks
  oberhalb des jeweiligen Trainings-90%-Quantils;
- Aktivitäts-Precision, Recall und Brier-Score des zweistufigen Kandidaten,
  auch wenn die Auswahl bei einer anderen Methode bleibt;
- drei gesonderte Ausfalltests: deterministisch etwa 5 % Messlücken, fehlendes D−2
  und fehlende drei letzte zulässige Tage. Nur historische Features werden
  ausgeblendet, die zu bewertenden Istwerte bleiben unverändert. Es erfolgt kein
  erneuter Fit für diese Szenarien;
- Auswahlbelege und Trainings-/Verfügbarkeitsgrenzen sämtlicher Portfolio-Reihen
  für Suchfenster, Bestätigung und endgültigen Fit;
- Eingabe-, Konfigurations- und Skript-Hashes, Engine-Hash sowie installierte
  CatBoost-/NumPy-Versionen; komprimierte HTTP-Anfragen und Antworten.

Die Kandidatenfehler im Prüfzeitraum dienen der Auswertung, **nicht** einer
nachträglichen Umschaltung auf den dort besten Kandidaten. Der Backtest aktiviert kein Einsatzmodell; dafür gibt es den separaten
Trainings- und Persistenzpfad. Archiv-Replay prüft vorhandene
Antworten erneut; es ist kein erneutes Training:

```bash
python3 tools/xlsx-forecast-test/portfolio_forecast_test.py \
  --xlsx '/pfad/zu/den/dateien/*.xlsx' \
  --replay tmp/profile/cells_energy_portfolio_0700_v1 \
  --out tmp/profile/cells_energy_portfolio_0700_v1_replay
```

WAPE ist bei einer Istsumme von null nicht definiert (`null`), kein perfektes
Ergebnis. Kurze Funktionsprüfungen belegen keine Prognoseverbesserung. E2 muss
unter derselben 07:00-Grenze und auf denselben Istintervallen nachgerechnet werden,
bevor die alten Tabellenwerte als direkter Qualitätsvergleich dienen können.
