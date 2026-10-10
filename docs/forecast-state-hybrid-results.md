# Kombinierte Zustandsprognose v2: Ergebnis und Umsetzung

Neue Trainingsläufe und die Evaluationsfamilie `learned_states` verwenden `relationship_state_correction_v2`. Die bestehenden Saison- und Aktualitätsmerkmale bleiben erhalten. Eine feste, halb gewichtete Zustandskorrektur wird nur bei zusätzlichem Nutzen in der jeweils verfügbaren Historie aktiviert. Die Aktivierung prüft RMSE und MAE; sie verwendet keine späteren Istwerte.

Eine zusätzliche externe Bestätigung ist keine Voraussetzung für diese Umsetzung. Die elf bekannten Profile dienen als standardisierter Entwicklungstest. Zeitliche Validierung und D−2 bleiben verbindlich.

## Vergleich über 2024

Beide Vergleichsläufe wurden über die lokale Dev-API ausgeführt. Die Referenz stammt aus dem vorangegangenen vollständigen Live-Lauf; der neue Kandidat wurde erneut ausgeführt. Alle 386.496 Viertelstunden sind gepaart, mit identischen Istwerten und Prognosezeitpunkten. Historie ab 2020 beziehungsweise 2021, Prüfjahr 2024.

| Kennzahl | Automatik ohne Zustandskorrektur | Kombinierte Variante |
|---|---:|---:|
| MSE (kWh²) | 6.419040 | 6.351219 |
| RMSE (kWh) | 2.533582 | 2.520162 |
| MAE (kWh) | 1.423757 | 1.408273 |

Mittlere relative RMSE-Verbesserung je Profil: **0.626 %**. 4 Profile verbessern sich, 6 bleiben unverändert, 1 verschlechtern sich. Mittlere relative MAE-Verbesserung: 1.054 %.

| Profil | Referenz-RMSE | Neuer RMSE | RMSE-Gewinn % | MAE-Gewinn % | Zustände aktiv % |
|---|---:|---:|---:|---:|---:|
| meter-1 | 0.09336 | 0.09336 | 0.000 | 0.000 | 0.0 |
| meter-2 | 1.06352 | 1.06241 | 0.104 | 2.988 | 15.3 |
| meter-3 | 1.32551 | 1.32551 | 0.000 | 0.000 | 0.0 |
| meter-4 | 1.66707 | 1.66707 | 0.000 | 0.000 | 0.0 |
| meter-5 | 5.44678 | 5.44678 | 0.000 | 0.000 | 0.0 |
| meter-6 | 2.96482 | 2.95355 | 0.380 | 0.110 | 7.7 |
| meter-7 | 1.65389 | 1.65389 | 0.000 | 0.000 | 0.0 |
| meter-8 | 0.77249 | 0.76510 | 0.957 | 1.330 | 23.5 |
| meter-9 | 2.42429 | 2.28282 | 5.835 | 7.014 | 76.5 |
| meter-10 | 0.16717 | 0.16783 | -0.393 | 0.157 | 7.6 |
| meter-11 | 4.15196 | 4.15196 | 0.000 | 0.000 | 0.0 |

Die Basisprognose ohne Zustandskorrektur reproduziert die vorherige Automatik intervallgenau: maximale absolute Abweichung 0 kWh. Die gemessenen Änderungen lassen sich damit dem Zusatzsignal und seiner Aktivierungsregel zuordnen.

## Qualitätskriterien

Die vor dem Versuch definierten Entwicklungshürden sind insgesamt **nicht vollständig bestanden**:

- `macro_rmse_gain_at_least_2_percent`: nicht bestanden
- `at_least_6_profile_wins`: nicht bestanden
- `no_profile_regression_over_10_percent`: bestanden
- `macro_mae_regression_at_most_2_percent`: bestanden

Gepaarte Wochenbootstrap-Spanne für den mittleren relativen RMSE-Gewinn: 0.474 bis 0.771 %. Dies beschreibt die Streuung auf diesen bereits bekannten Entwicklungsdaten.

Die Zustandskorrektur ist implementiert und profilbezogen nutzbar. Die allgemeine Evaluation behält aus Kompatibilitätsgründen die Familie `relationship`, wenn kein `model_family` angegeben wird; `learned_states` wählt v2. Es gibt keine nachträgliche Freischaltung anhand bestimmter Zählernummern oder Gewinner des Prüfjahres.

## Verwendete Informationen

- Historische Viertelstundenwerte, bekannte Zustände an D−2 und D−7 sowie abgeleiteter Kalender.
- Keine Wetterdaten, keine Temperaturkorrelation und keine automatische Wetterbeschaffung in diesem Versuch. Die separate Familie `relationship` unterstützt zugelieferte Wetterfeatures. Zustände können verborgene Einflüsse abbilden, identifizieren dadurch aber nicht deren physische Ursache.
- Labels, Skalierung, Übergänge und die gewählte Basisprognose werden pro Zähler versioniert gespeichert. Neue v2-Modelle und vorhandene v1-Artefakte sind über die Train-/Inspect-/Predict-API verwendbar.
- Die festgehaltene Gewichtung beträgt 0,5. Es gab während des Volltests keine Anpassung der Prognoseregeln.

## Reproduktion und Prüfungen

- Standardisierter Lauf: `tmp/profile/state-hybrid-full-v2/report.md` und `report.json`.
- Gepaarter Vergleich: `tmp/profile/state-hybrid-comparison-v2/comparison.md` und `comparison.json`.
- Referenzlauf: `tmp/profile/state-reference-live-v1`.
- Vorab aufgezeichnete Regeln und Code-Hashes: `tmp/profile/state-hybrid-protocol-v2.json`; Codekopie: `tmp/profile/state-hybrid-code-v2`.
- Unabhängige Nachrechnung und Zeitgrenzenprüfung: `tools/forecast-quality/compare_states.py`.
- [API-Runbook](forecast-state-model-runbook.md) und [portables Testpaket](../tools/forecast-quality/README.md).

Die Abschlussprüfung ergänzt ausschließlich den Metadatenausweis der Kalendernutzung und die Inspect-/Train-Auskunft zur Basisprognose. Prognosewerte und Aktivierungsregeln des gemessenen Codes bleiben unverändert; ein zusätzlicher API-Abgleich dokumentiert dies.
