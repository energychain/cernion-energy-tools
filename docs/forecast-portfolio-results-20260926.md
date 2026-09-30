# Auswertung des vollständigen Portfolio-Backtests

Stand: 26.09.2026. Quelle: `tmp/profile/cells_energy_2026091252/report.json`.
Run-ID: `f25056e5c5aaa805f33ad936db15051160f410c2cd4cb84d9e7b928b4b1d86b5`.

## Umfang und Vergleichsgrenzen

Alle elf Dateien sind abgeschlossen. Je Datei 70.176 Viertelstunden, zusammen 771.936, für 01.01.2023–31.12.2024; vollständige Istwertabdeckung. Einheit kWh je Viertelstunde. Informationsursprung D−1 07:00, Messungen höchstens D−2.

Die unten gepoolten Fehler werden aus Fehlersummen und Beobachtungszahlen berechnet. Große Lasten tragen stärker zum RMSE bei. Sie sind kein Mittel der elf WAPE-Prozentsätze.

## Vergleich innerhalb desselben Laufs

| Verfahren | RMSE | MAE | WAPE % |
|---|---:|---:|---:|
| Ausgewählte Portfolio-Methode | 2.5531 | 1.3101 | 58.83 |
| previous_week | 3.0869 | 1.4052 | 63.10 |
| weekday_mean | 2.5863 | 1.3505 | 60.65 |
| weekday_median | 2.7230 | 1.2755 | 57.28 |
| catboost_global | 2.4369 | 1.3781 | 61.89 |
| catboost_local | 2.5308 | 1.3712 | 61.58 |
| catboost_hurdle | 2.4425 | 1.3481 | 60.54 |

Die ausgewählte Methode verbessert den gepoolten RMSE gegenüber der Vorwoche um 17.29 %, gegenüber dem Wochentagsmittel um 1.28 %. Der Wochentagsmedian erreicht dagegen einen niedrigeren MAE/WAPE bei höherem RMSE.

Die globalen und zweistufigen CatBoost-Kandidaten erreichen im gesamten Prüfzeitraum einen niedrigeren RMSE als die ausgewählte Methode, aber einen höheren MAE. Das ist eine Diagnose des Zielkonflikts, kein zulässiger nachträglicher Modellwechsel. Die MAE-Schutzregel gilt auf vorgelagerten Bestätigungsfenstern und garantiert keine MAE-Verbesserung im späteren Prüfzeitraum.

## Je Zähler

| Zähler | RMSE | MAE | WAPE % | RMSE-Gewinn gegen Vorwoche % |
|---|---:|---:|---:|---:|
| 1 | 0.1013 | 0.0682 | 127.74 | 20.57 |
| 2 | 1.2805 | 0.7185 | 16.29 | 23.80 |
| 3 | 1.3674 | 1.0819 | 150.32 | 22.99 |
| 4 | 1.8298 | 1.1977 | 139.07 | 21.22 |
| 5 | 5.7236 | 4.3619 | 123.48 | 20.00 |
| 6 | 2.9222 | 1.7086 | 53.59 | 9.68 |
| 7 | 1.7162 | 1.2801 | 101.17 | 25.11 |
| 8 | 0.6425 | 0.3776 | 20.22 | 19.12 |
| 9 | 2.0603 | 1.4552 | 33.26 | 9.39 |
| 10 | 0.1894 | 0.0742 | 15.75 | 7.33 |
| 11 | 3.9873 | 2.0870 | 55.66 | 12.33 |

RMSE besser als Vorwoche: 11/11. Gegen das Wochentagsmittel: 9/11; Reihen 6 und 11 sind schlechter. Die Berichtheuristik klassifiziert weiterhin acht Reihen als weak und drei als medium; dies ist eine WAPE-Einstufung, kein Test des Zusatznutzens gegenüber Referenzen.

## Tatsächlich gewählte Verfahren

| Verfahren | Anteil Prüfintervalle % |
|---|---:|
| weekday_mean | 39.61 |
| catboost_hurdle | 8.01 |
| catboost_global | 9.13 |
| catboost_local | 24.80 |
| weekday_median | 11.14 |
| previous_week | 7.31 |

Referenzverfahren werden zusammen auf 58,07 % der Intervalle gewählt; CatBoost auf 41,93 %. Das zweistufige Modell allein auf 8,01 %. Das gemeinsame Modell ist kein übergeordnetes Modell mit lokalen Korrekturen, sondern weiterhin ein alternativer Kandidat.

## Niedrigverbrauchs-/Aktivitätsmodell

| Zähler | Aktivitäts-Precision % | Aktivitäts-Recall % |
|---|---:|---:|
| 1 | 38.53 | 11.95 |
| 3 | 28.80 | 3.60 |
| 4 | 33.11 | 13.64 |
| 5 | 44.07 | 33.27 |

Diese Kennzahlen betreffen den zweistufigen Kandidaten auf allen Prüfintervallen, nicht nur seine gewählten Blöcke. Aktivität bedeutet Wert oberhalb der jeweiligen Trainingsschwelle; die Klassifikationsentscheidung nutzt p ≥ 0,5. Niedriger Recall zeigt viele nicht als aktiv erkannte Intervalle. Die Mengenprognose verwendet jedoch die kontinuierliche Wahrscheinlichkeit und setzt bei p < 0,5 nicht pauschal auf null. Eine Schwellenänderung allein wäre daher kein belegter Weg zu besserem RMSE.

## Ausfalltests

| Zähler | RMSE normal | RMSE ohne D−2 | Änderung % |
|---|---:|---:|---:|
| 1 | 0.1013 | 0.1020 | 0.70 |
| 2 | 1.2805 | 1.3700 | 6.99 |
| 3 | 1.3674 | 1.3740 | 0.48 |
| 4 | 1.8298 | 1.8449 | 0.83 |
| 5 | 5.7236 | 5.7465 | 0.40 |
| 6 | 2.9222 | 2.9449 | 0.77 |
| 7 | 1.7162 | 1.7219 | 0.33 |
| 8 | 0.6425 | 0.7226 | 12.46 |
| 9 | 2.0603 | 2.3683 | 14.95 |
| 10 | 0.1894 | 0.2276 | 20.18 |
| 11 | 3.9873 | 4.0296 | 1.06 |

Ausgeblendete Daten betreffen nur historische Features; bewertete Istwerte bleiben erhalten. Besonders die Reihen 8, 9 und 10 reagieren auf fehlendes D−2. Funktionsfähige Ersatzprofile verhindern somit nicht automatisch einen Qualitätsverlust.

## Alter Bericht cells_energy (Ergebnis 3)

Datei-Hashes, Prüfzeitraum und Istwertsummen stimmen für alle elf Reihen überein. Der alte Lauf verwendet jedoch 18:00, zusätzliche Wetter-/Kontextfeatures und eine 50-W-Nachfilterung; der neue Lauf 07:00 und Historie/Kalender ohne diese Nachfilterung. Es handelt sich deshalb um einen deskriptiven Systemvergleich, nicht um einen isolierten Algorithmusvergleich.

| Bericht | RMSE | MAE | WAPE % |
|---|---:|---:|---:|
| Alter Bericht | 2.4959 | 1.3962 | 62.70 |
| Neuer Bericht | 2.5531 | 1.3101 | 58.83 |

Gepoolter RMSE +2.29 %, MAE -6.16 %. RMSE verbessert bei 4/11 Reihen (6, 8, 9, 11), MAE/WAPE bei 7/11 (2, 4, 5, 6, 8, 9, 11).

Die ursprünglich vom Nutzer angegebene E2-Tabelle ist ein anderer Vergleichsstand. Ohne dessen vollständige Daten-/Zeit-/Verfügbarkeitsdefinition wird hier keine Überlegenheit gegenüber E2 behauptet.

## Bewertung und nächster fachlicher Schritt

Technisch ist der vollständige neue Lauf erfolgreich. Fachlich ist er eine belastbare neue Vergleichsbasis, aber keine generelle Ablösung des alten Verfahrens: deutlicher Gewinn gegen Vorwoche, kleiner Zusatzgewinn gegen den Wochentagsmittelwert und weiterhin hohe relative Fehler bei den schwierigen Reihen.

Vor einer Änderung der Auswahlregel RMSE versus MAE/WAPE fachlich priorisieren. Anschließend das bisherige Verfahren als zusätzlichen Kandidaten unter demselben 07:00-Vertrag prüfen und Auswahlverluste je Block untersuchen. Werden anhand dieser Ergebnisse Regeln verändert, sind 2023–2024 Entwicklungsdaten; die Bestätigung braucht ein bislang ungenutztes Zeitfenster. Die aktuelle Konfiguration bleibt durch diese Auswertung unverändert.
