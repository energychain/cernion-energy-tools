# Gelernte Niedriglast-Labels und zweistufige Stromprognose

Stand: 26.09.2026. Optionale Erweiterung des bestehenden Trainings, keine
nachgewiesene allgemeine Überlegenheit gegenüber Ergebnis 2.

## Recherche und Entscheidung

Ein einzelner allgemein bester Algorithmus lässt sich aus der Literatur nicht
ableiten. Aggregationsniveau, Prognosehorizont, Datenverfügbarkeit und Zielfunktion
entscheiden über die Eignung. Für unsere Viertelstundenprofile mit D−2-Historie
ist folgende Einordnung sinnvoll:

| Ansatz | Forschungsbefund | Konsequenz für dieses Projekt |
|---|---|---|
| Zweiteilige Modelle / Renewal-Prozesse | Turkmen et al. modellieren Auftreten und Dynamik intermittierender Nachfrage einschließlich Clustering und Quasiperiodizität. Die Experimente betreffen intermittierende Bedarfsdaten, keinen Nachweis für unsere elf Stromzähler. | Aktivitätslabel und Mengenmodell trennen; nur historisch verfügbare Aktivitätsmerkmale verwenden. |
| Additive Modelle und Gradient Boosting | Ben Taieb/Hyndman modellieren Last mit Kalender, Temperatur und vergangener Last; fünfter Platz von 105 Teams bei GEFCom2012. | Starke Vergleichskandidaten für Lastgänge mit Wetter-/Kalenderstruktur. Ein nachgelagertes LightGBM-/Boosting-Modell wäre ein separater Versuch. |
| Adaptive Modelle / Quantilregression | de Vilmarest et al. kombinieren adaptive Punktprognosen, Kalman-Filter und Quantilregression, mit Verbesserungen auf zwei Stromdatensätzen. | Zeitlich aktuelle Daten und regelmäßige Neuschätzung sind mindestens so wichtig wie zusätzliche Modellkomplexität. |
| Transformer / Foundation Models | Hertel et al., Preprint Juli 2026, berichten Vorteile von Transformern auf drei Netzniveaus; Chronos-2 zeigt je Datensatz unterschiedliche Ergebnisse und Schwächen bei Sonderereignissen. | Interessante spätere Kandidaten; der Benchmark beweist keinen Vorteil für unsere Messstellen oder D−2-Verfügbarkeit. |
| PV / Wind | IEA-PVPS beschreibt Wetterprognosen, Anlagenmessungen und physikalische Informationen; Windarbeiten kombinieren NWP mit lokalen Beobachtungen. | Ein Niedriglastlabel kann Nacht/Stillstand beschreiben, ersetzt aber keine Wetterprognose, Sonnengeometrie oder Anlagenkennlinie. |

Primärquellen:

- [Turkmen et al. (2020), Intermittent Demand Forecasting with Renewal Processes](https://arxiv.org/abs/2010.01550).
- [Ben Taieb & Hyndman (2014), A gradient boosting approach to the Kaggle load forecasting competition](https://robjhyndman.com/publications/kaggleloadforecasting/).
- [de Vilmarest et al. (2023), Adaptive Probabilistic Forecasting of Electricity (Net-)Load](https://arxiv.org/abs/2301.10090).
- [Hertel et al. (2026), A Benchmark for Electrical Load Forecasting Across Grid Levels](https://arxiv.org/abs/2607.15705).
- [IEA-PVPS, Photovoltaics and Solar Forecasting State of Art Report](https://iea-pvps.org/key-topics/photovoltaics-and-solar-forecasting-state-of-art-report-t1401-2013/).
- [Wind power predictions from nowcasts to 4-hour forecasts: a learning approach with variable selection (2022)](https://arxiv.org/abs/2204.09362).
- [Gneiting (2011), Making and Evaluating Point Forecasts](https://arxiv.org/abs/0912.0902): Zielfunktion und Punktprognose müssen zusammenpassen; quadratischer Fehler zielt auf den bedingten Mittelwert, absoluter Fehler auf den Median.

Die implementierte Variante ist eine bewusst begrenzte, deterministische
CART-Zweiteilung in CommonJS. Sie implementiert weder Renewal-Netzwerke noch
Gradient Boosting oder Transformer. Ihre Eignung wird durch Backtests entschieden.

## Was gelernt wird

1. Pro Trainingsfenster wird aus **dessen** nichtnegativen Istwerten eine
   Niedriglastgrenze gelernt: Zwei-Gruppen-Verfahren auf `log1p(value / scale)`,
   begrenzt auf 10 % des historischen 90-%-Quantils. Die mittlere Niedriglast darf
   höchstens 10 % des aktiven Mittels betragen; sonst Rückfall auf exakte Nullen.
   Das sind feste, versionierte Modellannahmen, keine betrieblich bestätigten Grenzen.
2. Historische Messungen erhalten `low_load` bei `value <= threshold`, sonst
   `active`. Fehlende oder verspätete Messungen erhalten kein Null-Label. Eine
   Strommessung beweist keinen Betriebszustand einer Anlage.
3. Ein kleiner Klassifikationsbaum lernt die aktive Wahrscheinlichkeit aus
   Viertelstunde, Wochentag, Wochenende, Monat, verfügbaren D−2-/D−7-Werten,
   D−2-Tagesmittel und den zugehörigen historischen Labels. Zwei getrennte
   Regressionsbäume lernen Niedriglast- und Aktivmengen. Maximal Tiefe 4,
   mindestens 96 Beobachtungen pro Blatt, 12 Histogramm-Bins; geglättete Blattwahrscheinlichkeiten.
4. Die Punktprognose ist `(1-p) * low_mean + p * active_mean`. Die Klassifikation
   bei p=0,5 dient nur der Erläuterung. Es gibt kein erzwungenes Nullsetzen.

Labels werden innerhalb **jedes** historischen Validierungsfolds neu gelernt.
Der Modellkandidat ist nur bei mindestens 20 % Niedriglast und 5 % aktiven
Intervallen in jedem Trainingsfold zulässig. Ohne zwei Zustände bleibt das
bisherige Modell erhalten. Negative Nettoflüsse werden nicht in diese Familie
aufgenommen; nichtnegative Erzeugungsreihen sind rechnerisch möglich, aber hier
nicht als PV-/Windprognose validiert.

Bei der Auswahl werden 28/84/365 Tage und Gesamthistorie geprüft. Die Wahl des
Fensters erfolgt auf den bisherigen Discovery-Folds; die Bestätigung auf den
nachfolgenden Confirmation-Folds. Dort gelten die bisherigen RMSE-Evidenzregeln
(mindestens 3 % Verbesserung, mindestens 75 % gewonnene Wochenblöcke, positives
Bootstrap-Intervall) und zusätzlich **keine MAE-Verschlechterung** für diesen
Kandidaten. Die bestehenden äußeren Adaptive-/Kontext-/Zustandsprüfungen behalten
ihre eigenen Regeln. Die Bestätigung ist keine Garantie für zukünftige Zeiträume.

Die Feature-Lags werden jeweils am historischen Prognoseursprung begrenzt.
Auch bei Ausgabe um D−1 18:00 bleibt die Messwerthistorie auf D−2 begrenzt.
Sommerzeitlücken bleiben unbekannt; doppelte Herbstslots werden wie im bestehenden
Zustandsmodell gemittelt. Neue Roh-Lagfelder sind additiv, alte Artefakte mit
`activity_amount_v1` bleiben unverändert lesbar.

## Nutzung und Prüfung

Bestehende Konfiguration ergänzen:

```json
{
  "selection_policy": "adaptive_rmse_v1",
  "selection_metric": "rmse",
  "activity_model": true,
  "activity_labeling": "learned_low_load_v1"
}
```

Erfordert rollierende automatische Prognose mit Historie/Kalender. Ohne
`activity_labeling` bleibt das bisherige Exact-Zero-Aktivitätsmodell aktiv.
Vorlage: `tools/xlsx-forecast-test/learned-low-load.json`. Bestehende Wetter-/
Kontextkonfiguration kann ergänzt werden; der neue Zweiteiler selbst verwendet
aktuell Historie und Kalender. Die bestehende Feature-Selektion bleibt verfügbar.

```bash
python3 tools/xlsx-forecast-test/xlsx_forecast_test.py \
  --xlsx '/pfad/*.xlsx' --base-url http://localhost:3900 \
  --from 2023-01-01 --until 2024-12-31 \
  --config tools/xlsx-forecast-test/learned-low-load.json \
  --out /pfad/neuer-labeling-lauf
```

Die API-Instanz muss die neue Codeversion geladen haben. Zeiträume und zusätzliche
Features für einen Vergleich mit Ergebnis 2 erst aus dessen Originalbericht übernehmen.

`forecast_values[].activity_model` enthält bei Auswahl der neuen Familie:
Version, Schwelle in Eingabeeinheit je Intervall, Aktiv-/Niedriglastwahrscheinlichkeit,
vorhergesagtes Label, beide bedingten Mengen und verwendete Lags. Im gespeicherten
Modell stehen Schwelle, Trainingszahlen und alle drei Bäume. Die historischen
Selektionsberichte enthalten pro Fold die Labeldefinition und den Brier-Score.
Nicht ausgewählte Kandidaten sind anhand `activity_selection` und `candidates`
prüfbar; ein angefordertes Modell wird nicht zwangsläufig genutzt.

## Referenz und reproduzierbare Entwicklungsauswertung

Die elf Nutzer-Zielwerte sind unverändert in
`tools/forecast-quality/user-baseline-2026-09-26.json` erfasst. Zuordnung in
Dateireihenfolge 1–11 ist eine Annahme. Originalzeitraum, Einheit, Datenhashes,
Filter und Baseline-Verfahren müssen noch zugeordnet werden. Ohne diese Angaben
darf ein numerischer Vergleich nicht als Überlegenheit ausgegeben werden.

Ein neuer lokaler Versuch kann mit archivierten Requests ausgeführt werden:

```bash
node tools/forecast-quality/backtest-low-load.js \
  --archive tmp/profile/cells_energy \
  --out tmp/profile/low-load-labeling-nov2024 \
  --from 2024-11-01 --until 2024-11-28
```

Dieser Test ruft die Produktions-Engine direkt auf, **keinen HTTP-Server**.
Er vergleicht die alte und neue Aktivitätspolitik auf identischen Messungen,
mit Historie/Kalender und ohne zusätzliche Hybrid-Zustandskorrektur oder Wetter/
Kontext. Damit isoliert er die neue Option. Er speichert vollständige Antworten,
Quellcode- und Eingabehashes, RMSE/MAE/WAPE, Null-/Aktivfehler, Brier-Score bei
ausgewählten Labelmodellen sowie Null- und D−7-Baselines. Unvollständige D−7-Slots
werden ausgelassen und deren Abdeckung ausgewiesen. Die Zielwerttabelle fließt
nicht in Training oder Auswahl ein. Optional `--profiles 1,3,5`.

Die bereits angesehenen Profile und November 2024 sind Entwicklungsdaten.
Ein unabhängiger Qualitätsnachweis braucht neue Zeiträume oder Messstellen;
auch eine erfolgreiche Modellselektion auf diesen Daten ersetzt ihn nicht.

## Ergebnis des ersten Laufs

Der obige lokale Lauf wurde am 26.09.2026 vollständig ausgeführt: 11 Profile,
je 2.688 Viertelstunden vom 01.–28.11.2024, Referenz und Kandidat jeweils auf
identischen Istwerten. Vollständige Ergebnisse:
`tmp/profile/low-load-labeling-nov2024/report.md` und `report.json`; dort liegen
auch die 22 vollständigen Engine-Antworten komprimiert vor.

| Profil | RMSE Referenz → Labeling | MAE Referenz → Labeling | WAPE Referenz → Labeling |
|---|---:|---:|---:|
| 6 | 3,838489 → 3,099322 (−19,26 %) | 2,841258 → 1,887051 (−33,58 %) | 72,707 % → 48,289 % |
| 10 | 0,135671 → 0,135549 (−0,09 %) | 0,064590 → 0,064823 (+0,36 %) | 10,007 % → 10,043 % |

Bei diesen beiden Profilen wurde die neue Familie in allen 2.688 Intervallen
genutzt, bei den übrigen neun in keinem. Die übrigen neun Prognosen bleiben
unverändert, insbesondere auch 1/3/4/5. Der innere historische MAE-Schutz
verhindert keine spätere Verschlechterung auf einem anderen Zeitraum, wie
Profil 10 zeigt. Das Ergebnis ist **keine** allgemeine Verbesserung der elf Reihen.

Die einfache D−7-Prognose erreicht bei Profil 6 RMSE 3,194171 und MAE 1,722481:
Labeling ist im RMSE besser, im MAE schlechter als diese Wochenbaseline.
Auch deshalb ist eine pauschale Überlegenheit nicht belegt. Der Brier-Score der
aktiven Wahrscheinlichkeit beträgt bei Profil 6 0,077013, bei Profil 10 0,014136.

Die E2-Tabelle ist weiterhin kein auswertbarer gepaarter Benchmark. Schon
`MAE / (WAPE/100)` impliziert für Profil 5 eine mittlere absolute Istlast von
4,471528, während E3 3,532644 ausweist. Das ist bei gleicher Einheit und
WAPE-Definition weit mehr als ein Rundungsunterschied. Auch die vollständigen
Jahresmittel 2023/2024 aus den archivierten Eingaben stimmen damit nicht überein.
Originalbericht und Auswertungsgrenzen müssen deshalb vor einem E2-Vergleich
zugeordnet werden; die Zielwerte wurden nicht nachträglich angepasst.

Verifikation: 93 Jest-Tests (darunter 7 neue Labeling-Tests) und 25 Python-
Clienttests erfolgreich; gezieltes ESLint fehlerfrei. OpenAPI-Audit: 0 Fehler,
405 Warnungen im gesamten bestehenden API-Katalog. OpenAPI und `llm.txt`
regeneriert, Synchronitätsprüfung erfolgreich. Kein vollständiger Release-Gate-
oder HTTP-Jahreslauf; der laufende Server wurde nicht neu gestartet.
