> Historischer Bericht des ersten Kandidaten `causal_daily_states_v1`.
> Die nachfolgende Implementierung `relationship_state_correction_v2` integriert
> Zustände als Korrektur zur automatischen Basis. Siehe API-Runbook und v2-Bericht.

# Ergebnis: historisch gelernte Lastzustände

Zwei vollständige Live-HTTP-Läufe auf der lokalen CET-API, dieselben elf XLSX-Dateien, Prüfjahr 2024, D−2. Je Lauf 386.496 Viertelstunden. Keine externen Zusatzdaten.

| Vergleich | Bisher automatisch | Zustandskandidat |
|---|---:|---:|
| Gepoolter RMSE, kWh | 2.533582 | 2.471511 |
| Gepoolter MSE, (kWh)² | 6.419040 | 6.108365 |
| Gepoolter MAE, kWh | 1.423757 | 1.513972 |

Der gepoolte RMSE verbessert sich um 2.45 %. Die mittlere relative RMSE-Verbesserung je Zähler beträgt dagegen -4.78 %: 5/11 Profile verbessern sich. Die mittlere relative MAE-Verbesserung beträgt -16.17 %. Negative Verbesserungen bedeuten Verschlechterung.

Die vorab festgelegten Akzeptanzhürden wurden **nicht bestanden**. Der bestehende Standard wird nicht umgestellt. Der neue Kandidat bleibt explizit über `model_family: learned_states` auswählbar.

## Trägt die Hypothese?

Gegenüber der eigenen Referenz mit identischen Trainingsdaten und Fit-Zeitpunkten, aber ohne Zustandsmerkmale, beträgt die mittlere relative RMSE-Verbesserung **7.58 %**; 8/11 Profile verbessern sich. Das bedingte 95%-Wochenbootstrap-Intervall beträgt 6,98 bis 8,13 %.

Damit zeigen Zustandsmerkmale in diesem kontrollierten Vergleich zusätzlichen Prognosenutzen. Das bestätigt keine generelle Überlegenheit der gesamten neuen Modellfamilie gegenüber dem vorhandenen automatischen Forecast. Die elf Reihen und das Prüfjahr wurden bereits untersucht; dies ist Entwicklungsevidenz, keine neue unabhängige Bestätigung. Es wurden nach Betrachtung des äußeren Ergebnisses keine Modellparameter angepasst.

## Warum Gesamtwert und Zählervergleich auseinanderfallen

Absolute Fehler großer Lasten dominieren den gepoolten RMSE. Die gleichgewichtete relative Auswertung je Profil legt dagegen Verschlechterungen kleinerer Reihen offen. Insbesondere Profile 2, 8 und 10 verlieren gegenüber dem bisherigen Modell; Profile 9 und 11 gewinnen deutlich. Die Aktivierungsquote je Profil steht im Detailreport.

Eine plausible Erklärung liefert die bisherige Modellauswahl: Profil 2 verwendet in allen 14 Auswahlständen die jüngeren 84 Tage, Profil 8 in elf Auswahlständen dieses Zeitfenster. Profil 10 verwendet in 13 Auswahlständen Monatsmerkmale. Der erste Zustandskandidat ersetzt diese Auswahl durch eine feste Zustands-/Kalenderfamilie mit voller Historie und bildet diese Anpassungen nicht vollständig ab. Das ist eine Interpretation der Modellmetadaten, kein Kausalnachweis.

Der nächste begründete Entwicklungsschritt wäre, Zustände zusätzlich zu den bestehenden Saison- und Aktualitätsmerkmalen zu testen und den Wechsel gegenüber dem bestehenden Modell ausschließlich innerhalb historischer Validierung auszuwählen. Die Gewinner des äußeren Prüfjahres dürfen nicht nachträglich als Auswahlregel für einen angeblich unabhängigen Backtest benutzt werden.

## Technische Umsetzung und Nachweise

- Deterministische Zustandsdefinitionen, Standardisierung, Übergangshäufigkeiten, Verbrauchsprofile, Validierungsentscheidung und jüngster verfügbarer Kontext werden je Profil versioniert gespeichert.
- Train-, Inspect- und Predict-Endpunkte erlauben Laden ohne Neutraining sowie versionierte Aktualisierung des Zustandskontexts.
- Innere zeitliche Validierung aktiviert Zustände nur bei zusätzlichem Nutzen gegenüber der passenden Kalenderreferenz. Diese Referenz unterscheidet sich vom vorhandenen automatischen Modell; der äußere Vergleich trennt beides.
- Zukunftswerte, verspätete Verfügbarkeit, DST, Nullreihen, Mandantentrennung, Artefaktintegrität und Neuladen werden durch Regressionstests geprüft.
- Ein Live-HTTP-Persistenztest reproduziert den letzten Backtest-Tag exakt aus dem gespeicherten Modell. Explizites Train/Predict mit echten XLS-Eingaben wurde ebenfalls geprüft.

## Artefakte

- [Vergleich je Profil](../tmp/profile/state-hypothesis-v1/comparison.md)
- [Maschinenlesbarer Vergleich](../tmp/profile/state-hypothesis-v1/comparison.json)
- [Zustandslauf](../tmp/profile/state-full-v1/report.md)
- [Frischer Referenzlauf](../tmp/profile/state-reference-live-v1/report.md)
- [Persistenztest über HTTP](../tmp/profile/state-persistence-api-check/verification.json)
- [Vorab festgeschriebenes Protokoll](../tmp/profile/state-hypothesis-protocol.json)
- [Prüfsummen des ausgeführten Servercodes](../tmp/profile/state-experiment-source-lock.json); zugehörige Quellen in `tmp/profile/state-experiment-code/`.
- [API-Runbook](forecast-state-model-runbook.md) und [Testpaket](../tools/forecast-quality/README.md).

## Abschließende Vertrags- und Herkunftsprüfung

Nach Abschluss beider Messläufe wurden ausschließlich die Pflichtfelddeklarationen
der drei neuen API-Aktionen und die Herkunftsprüfsumme des Zustandsmodells
präzisiert. Letztere umfasst nun auch die Streuung wiederholter Herbstintervalle
und die Labeldeskriptoren. Eine isolierte Prüfung bestätigt identische numerische
Modellparameter und Vorhersagen vor und nach dieser Metadatenkorrektur. Der
ausgeführte Benchmarkcode bleibt separat archiviert. Die Änderung ist keine
nachträgliche Optimierung anhand der Qualitätswerte.

Auch nach Einspielen dieser Korrekturen wurde die Persistenz über die lokale API
erneut geprüft: [abschließender HTTP-Test](../tmp/profile/state-persistence-final-check/verification.json).
Ein erneutes Training aus den echten XLS-Eingaben liefert identische numerische
Parameter, Validierungsentscheidungen und Zustandskontexte; ausschließlich
`model.history_digest` ändert sich ([Nachweis](../tmp/profile/state-metadata-parity.json)).

Prüfstand: 89 gezielte Jest-Tests über die betroffenen Forecast-Bereiche, 12
Python-Vertragstests, 16 bestehende HTTP-UAT-Prüfungen sowie der HTTP-Persistenztest
bestanden. ESLint ist für die geänderten JavaScript-Dateien sauber; OpenAPI-Audit
meldet 0 Fehler und 397 Warnungen. `llm.txt` und OpenAPI-Export wurden regeneriert.
