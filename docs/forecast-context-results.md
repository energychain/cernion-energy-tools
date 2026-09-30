# Wetter, Markt und Jahreszeit: API-Qualitätsvergleich

Verglichen wird die gesamte erweiterte Prognosepolitik mit dem bisherigen Modell. Externe Wissensstände unterscheiden sich; Zählerhistorie bleibt in beiden Fällen D−2.

| Profil | Referenz RMSE | Erweitert RMSE | RMSE-Gewinn % | MAE-Gewinn % |
|---|---:|---:|---:|---:|
| meter-1 | 0.09336 | 0.09336 | 0.00 | 0.00 |
| meter-2 | 1.06241 | 1.06241 | 0.00 | 0.00 |
| meter-3 | 1.32551 | 1.32551 | 0.00 | 0.00 |
| meter-4 | 1.66707 | 1.66663 | 0.03 | 0.11 |
| meter-5 | 5.44678 | 5.44678 | 0.00 | 0.00 |
| meter-6 | 2.95355 | 2.94669 | 0.23 | 0.89 |
| meter-7 | 1.65389 | 1.65389 | 0.00 | 0.00 |
| meter-8 | 0.76510 | 0.76034 | 0.62 | 0.43 |
| meter-9 | 2.28282 | 2.27763 | 0.23 | 0.74 |
| meter-10 | 0.16783 | 0.16783 | 0.00 | 0.00 |
| meter-11 | 4.15196 | 4.15196 | 0.00 | 0.00 |

Mittlerer relativer RMSE-Gewinn: 0.101 %; 4/11 Profile besser.
Gepoolter RMSE: 2.520162 → 2.518847 kWh.
Mittlerer relativer MAE-Gewinn: 0.197 %.
Vorab definierte Qualitätsgrenzen bestanden: False.

## Tatsächlich verwendete Merkmale

- meter-1: month: 38.3 % der Intervalle
- meter-2: weekday: 15.3 % der Intervalle
- meter-3: month: 7.7 % der Intervalle
- meter-4: day_ahead_price: 0.5 % der Intervalle, month: 0.5 % der Intervalle
- meter-5: month: 23.0 % der Intervalle
- meter-6: day_ahead_price: 7.7 % der Intervalle, month: 15.3 % der Intervalle, weekday: 38.3 % der Intervalle, weekend: 45.9 % der Intervalle
- meter-7:
- meter-8: global_radiation: 7.6 % der Intervalle, heating_degree_days_18: 7.6 % der Intervalle, season: 3.6 % der Intervalle, temperature: 3.6 % der Intervalle, weekday: 23.0 % der Intervalle
- meter-9: day_ahead_price: 7.7 % der Intervalle, heating_degree_days_18: 7.7 % der Intervalle, weekday: 76.5 % der Intervalle
- meter-10: month: 92.3 % der Intervalle, weekday: 7.6 % der Intervalle
- meter-11: weekday: 61.2 % der Intervalle

## Grenzen

- Previously inspected development profiles; no external independent confirmation.
- Complete policy comparison: issue times and feature candidates differ; no causal attribution to individual features.
- External publication times and historical revisions are partly reconstructed assumptions.
- Net-meter patterns do not confirm PV, heat pumps, CHP, or an EMS.

## Reproduktion

- [API-Runbook](forecast-context-features.md) und [Testpaket](../tools/forecast-quality/README.md).
- Vollständiger API-Lauf: `tmp/profile/context-guard-full-v4/report.json`.
- Vergleich und unabhängige Metriken: `tmp/profile/context-guard-comparison-v4/comparison.json`.
- Vorab festgehaltene Regeln und unveränderte Code-Hashes: `tmp/profile/context-protocol-v4.json`.
- Wetterlücken: `tmp/profile/context-feature-data-quality.json`; vollständige Archive-Lücke 31.12.2023–20.01.2024, zwei weitere teilweise fehlende Tage.
- Vorgängerexperiment v3 nach Überschreitung der vorab definierten Verlustgrenze beendet; kein vollständiger v3-Qualitätsnachweis. v4 schützt die bisherige automatische Referenz.

Die Historie der XLS-Dateien reicht bis 2024. Geprüft wird deshalb das vollständige Jahr 2024 mit ausschließlich jeweils zulässiger früherer Historie, nicht ein mangels Istwerten unbelegter 2025-Test. Die Ergebnisse gelten für diese zuvor betrachteten Entwicklungsprofile und die dokumentierten Quellen-/Verfügbarkeitsannahmen.
