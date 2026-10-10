# E2/E4: Ursachenanalyse und Optimierungsplan

Stand: 26.09.2026. Status: Priorisierte v2-Implementierung erfolgt; Bedienung, Umfang und verbleibende Vergleichsgrenzen siehe [Portfolio v2](forecast-portfolio-v2.md). Der folgende Plan dokumentiert die ursprüngliche Analyse.

## Nachgerechnete Belege

Quelle: `tmp/profile/cells_energy_2026091252`, Run `f25056e5c5aaa805f33ad936db15051160f410c2cd4cb84d9e7b928b4b1d86b5`.
Alle archivierten 771.936 Einzelprognosen wurden erneut ausgewertet. Für alle elf Reihen stimmen MAE, WAPE und RMSE mit dem Bericht überein (relative Toleranz 1e-10).

Export: `tmp/profile/cells_energy_2026091252/benchmark-reconciliation/metrics.csv` enthält je Datei, Zeitfenster und Kandidat N, Istbetragssumme, absolute/quadratische Fehlersumme, MAE/WAPE/RMSE sowie einen Hash der Zeitstempel und Istwerte. `summary.json` enthält Aggregation und Auswahlhäufigkeiten.

| Auswertung | N je Zähler | Mittel der elf WAPE | Mittel der elf MAE |
|---|---:|---:|---:|
| E4 vollständig 2023–2024 | 70176 | 76.0488 % | 1.310085 |
| E4 Teilmenge Q4 2024 | 8836 | 73.7904 % | 1.435231 |
| Wochenmedian vollständig | 70176 | 71.6208 % | 1.275506 |
| Globales CatBoost vollständig | 70176 | 80.5157 % | 1.378112 |
| Lokales CatBoost vollständig | 70176 | 79.4140 % | 1.371212 |

E2 beschreibt dagegen 8832 Testwerte, eingefrorene Gewichte ab Ende September und Messwerte höchstens D−3. E4 erlaubt D−2 und trainiert alle 28 Tage neu. Berliner Q4 hat wegen des Zeitumstellungstags 8836 Viertelstunden. Ohne E2-Zeitstempel ist die Ursache der Differenz nicht abschließend bestimmbar. E4-Q4 ist ein Diagnoseausschnitt, keine E2-Reproduktion. Die Rechnung mit E2-Istwertsummen und E4-Zweijahres-WAPE kann den E4-MAE nicht widerlegen. Gepoolter E4-WAPE (58.83 %) ist außerdem eine andere Aggregation als das ungewichtete Zählermittel.

## Belegte Mechanismen und offene Ursachen

`engine.py:choose` wählt sowohl Referenz als auch ML-Kandidat nach Discovery-RMSE. Confirmation verlangt RMSE-Gewinn mit MAE-Schutz. Das ist keine Auswahl nach minimalem MAE/WAPE. Auf identischen Istwerten eines Zählers ordnen MAE und WAPE Kandidaten identisch. Die Kandidatenregressionen verwenden ebenfalls RMSE-Loss. Ein Mittelwert-orientiertes Modell kann bei intermittierenden Lasten viele kleine positive Mengen schätzen, obwohl für absoluten Fehler ein niedrigerer bedingter Median günstiger wäre. Das erklärt einen plausiblen Mechanismus, beweist aber keine vollständige Ursache der beobachteten Fehler.

Globale und lokale Modelle sowie drei Referenzen existieren bereits. Es gibt kein globales Grundmodell mit lokaler Restkorrektur. Datei 10 verwendet ausschließlich lokale Modelle und Referenzen. Datei 11 verwendet überwiegend Wochenmittel, nie den einfachen globalen Kandidaten und nur selten das globale Hurdle-Modell. Ihre Gesamtfehler können nicht pauschal dem gemeinsamen Training zugeschrieben werden.

Skalierung durch den Trainingsmittelwert und gleiche Gesamtgewichte je Reihe sind implementiert. Reine Dominanz durch die absolute Lastgröße ist daher keine zutreffende Codebeschreibung. Unterschiedliche normalisierte Varianzen und unpassende geteilte Muster bleiben prüfbare Hypothesen.

Global/lokal-WAPE auf denselben E4-Testintervallen: Datei 3 148.64/155.68; Datei 5 128.38/129.77; Datei 9 30.81/35.51; Datei 10 25.22/15.36; Datei 11 60.74/56.58. Bei Datei 9 hilft der globale Kandidat beobachtbar; eine kausale Erklärung braucht kontrollierte Ablationen. Testwerte dürfen nicht nachträglich zur Routingregel werden.

## Geplanter Umfang vor dem nächsten Volltest

1. **Vergleichsvertrag und Export.** E2-Skript, Trainings-/Validierungsfenster, zweite Mischungsgewichtung, Bibliotheksversion und timestampgenaue Prognosen beschaffen. Zielintervalle und Istwerte per Join vergleichen, fehlende/zusätzliche/DST-Intervalle sichtbar ausweisen. Einheiten und Null-/Missing-Regeln vereinheitlichen. Pro Prognose Daten-/Modellversion, Ausgabezeitpunkt, Trainingsgrenze und Informationsgrenze exportieren. E2-Q4-Reproduktion mit eingefrorenen Gewichten und operativen rollierenden Zweijahrestest getrennt benennen.
2. **Verfügbarkeit versionieren.** `Series.known`, `day_context`, `features`, `Fit` und Validierungsgrenzen in `tools/forecast-portfolio/engine.py` auf einen gemeinsamen konfigurierbaren Vertrag stützen: aktuelles D−2 inklusive versus E2 D−3 inklusive. Ersatzprofile, Tagesaggregate, Aktivitätslabels und Trainingslabels müssen dieselbe Grenze respektieren. Live-Training/-Prognose und Backtest verwenden dieselbe Implementierung. Nicht nur den D−2-Lag entfernen.
3. **E2-Features und Referenzen.** Eigenen Feature-Vertrag mit D−3/4/7/14/28, Mittel D−7/8/9 und Mittel D−7/14, zyklischem Wochentag, Viertelstunde, Jahreszeit und Wochenende hinzufügen. Bestehend: D−2/7/14/21/28, Tages-/Jahreszyklen, ganzzahliger Wochentag, Missing-/Aktivitätsflags und Datenalter. Vierwochenmittel/-median sind bisher eigenständige Referenzen, nicht die genannten E2-ML-Mittelmerkmale. Zweiwochenmittel als Kandidat ergänzen. Keine unbestimmte Ausreißerbereinigung aus dem Briefing ableiten.
4. **MAE-Routing zuerst.** `comparison`/`choose` auf eine ausdrücklich gewählte MAE-Zielsetzung erweitern. Discovery und unabhängige Confirmation vergleichen alle zugelassenen Referenzen/Experten/Mischungen nach demselben Ziel. Tagesweise gepaarte absolute Fehler und vorab festgelegter Block-Bootstrap ersetzen die vier Wochen-RMSE-Differenzen als WAPE-Auswahlbeleg. Ohne belastbaren Gewinn bleibt die zuvor bestimmte Referenz. Wechselhysterese und begrenzte Kandidatenzahl; RMSE, Peaks und Tagesmengen bleiben separat sichtbar. Die Schutzregel gilt für Validierungsfenster und garantiert keinen künftigen Sieg über die Vorwoche.
5. **Lokalen HGB-Herausforderer ergänzen.** E2-Parameter: max_iter=90, learning_rate=0.07, max_leaf_nodes=19, min_samples_leaf=90, l2_regularization=8, max_bins=64, squared_error, negative Prognosen auf null begrenzen. Early-Stopping und Trainingsumfang anhand E2-Code abgleichen; keine zufällige Zeitreihenvalidierung als stillen Default. Dokumentierte 75/25-Mischung HGB/Vorwoche; weiteres Gewicht erst nach E2-Abgleich. Daneben separaten MAE-Loss-Kandidaten testen, nicht mit der exakten E2-Reproduktion vermischen.
6. **Routing vor Clustering.** Zunächst je Zähler anhand vorgelagerter Fenster global/lokal/Hurdle/HGB/Referenz/Mischung auswählen. Danach Gruppenkandidaten mit Profilmerkmalen ausschließlich aus dem Training (Nullanteil, positive Streuung, Tages-/Wochenprofil, Wochenkorrelation). Bei elf Reihen wenige Gruppen und ausreichende Gruppengröße verlangen. Expertenwahl und Mitgliedschaft im gemeinsamen Trainingspool sind verschiedene Entscheidungen: lokale Prognosewahl entfernt eine Reihe nicht automatisch aus dem globalen Pool. Nutzen einer solchen Entfernung separat ablatieren.
7. **Nullmodell gezielt prüfen.** Klassifikationskalibrierung und Mengenverlust getrennt bewerten. Der aktuelle Hurdle-Kandidat bildet einen weichen wahrscheinlichkeitsgewichteten Mengenmittelwert; p<0.5 erzwingt keine Null. MAE-orientierte Mengenprognose bzw. Nullentscheidung nur mit vorab validierten Regeln als Kandidat ergänzen. Fehler in echten Nullphasen, aktiven Phasen und Übergängen ausweisen; Recall allein reicht nicht.
8. **Persistenz und Regressionstests.** `tools/forecast-portfolio/runtime.py`, `src/forecast-portfolio-runtime.js` und REST-Schema um neue Vertrags-/Kandidatenversionen ergänzen; neue Abhängigkeiten pinnen und sichere Modellspeicherung festlegen. Alte Checkpoints nicht unter geänderter Methodik fortsetzen. Wiederladen und Live/Backtest-Parität, D−3-Sperre einschließlich Ersatzpfaden, DST, fehlende Daten, Metrikidentitäten sowie MAE-Auswahl mit absichtlich widersprechendem RMSE prüfen. Client `tools/xlsx-forecast-test/portfolio_forecast_test.py` exportiert Vertrags-/Metrikdaten und eindeutige Macro-/Micro-Bezeichnungen.

## Nachweisfolge und Erfolgskriterium

Ablationen nacheinander: unverändertes E4 unter vereinheitlichtem Vertrag → nur MAE-Auswahl → E2-Features → lokaler HGB/Mischungen → MAE-Loss → optional Gruppenmodell/Nullmodell. Jede Stufe dieselben Zielintervalle, Informationsgrenzen und Trainingsfristen. Der E4-Vorteil für Datei 9 wird gegen eine unter demselben Vertrag neu gerechnete E4-Referenz beurteilt, nicht gegen unvereinbare 33.3 %.

Ziel ist Macro-WAPE <70 %, nicht der bereits darunter liegende gepoolte WAPE. 71.62 % des vorhandenen Medians ist ein Entwicklungsbefund und keine Prognose des Erfolgs eines neuen Routers. Für 76.05→<70 fehlen mehr als 6.05 Prozentpunkte; ein sicherer Gewinn lässt sich nicht versprechen.

Zeitliche Validierung enthält mehrere vorgelagerte saisonale Fenster. Gepaarte Tagesfehler werden mit zusammenhängenden Tagesblöcken ausgewertet; Blocklänge und Auswahlregeln vor der Bestätigung festlegen. Zusätzliche Diagnosen: hohe Istwerte (oberste 5 %, ausdrücklich retrospektive Auswertungsgruppe), Rampen, Nullübergänge, Tagesmengen und Datenlücken. 2023–2024 sind nach dieser Optimierung Entwicklungsdaten. Eine unabhängige Erfolgsbestätigung braucht einen bislang ungenutzten Zeitraum.

Methodische Quellen: [scikit-learn HGB](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html), [zeitliche Kreuzvalidierung, Forecasting: Principles and Practice](https://otexts.com/fpp3/tscv.html).
