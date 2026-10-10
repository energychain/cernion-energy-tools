# Zustands- und Mengenfehler: Analyse und Korrektur

Stand 27.09.2026. Ausgangslauf: `tmp/profile/cells_energy_2026091537`.
Reproduzierbar mit `tools/forecast-portfolio/diagnose_regimes.py`; vollständige
Zerlegung: `tmp/profile/portfolio-v3-state-diagnosis-reproducible.json`.

## Befund vor der Änderung

Alle 70176 Viertelstunden je untersuchter Reihe; Aktivität jeweils oberhalb der
in dem zugehörigen Trainingsfenster bestimmten Schwelle, Entscheidung bei p≥0,5.

| Datei | Aktive Intervalle | Precision | Recall | Energie in der Niedrigklasse |
|---|---:|---:|---:|---:|
| 3 | 23,96 % | 28,60 % | 5,03 % | 0,00 % |
| 8 | 87,04 % | 93,88 % | 94,44 % | 0,68 % |
| 10 | 51,04 % | 97,50 % | 96,83 % | 0,10 % |
| 11 | 36,62 % | 83,28 % | 77,92 % | 10,32 % |

Die Vermutung eines einheitlichen Fehlers beim initialen Labeling bestätigt sich
nicht. Bei 8/10 funktioniert die binäre Klassifikation bereits recht gut; bei 3
ist die Zustandsvorhersage schwach. Die Schwelle für 3 bleibt in allen Fits 0,3:
Schwellendrift ist dort keine Erklärung. Bei 11 umfasst die Niedrigklasse
63,38 % der Intervalle und 10,32 % der Energie. Diese Klasse ist keine Nullklasse;
sie enthält positive Grundlast, die separat modelliert und ausgewertet werden sollte.
Die bisherige Implementierung setzte diese Klasse auch nicht pauschal auf null.

Zur Fehlerzerlegung wurden die beiden Mengenkomponenten des bestehenden Hurdle-
Modells aus dessen weicher und harter Vorhersage rekonstruiert. Ersetzt man nur
die Zustandsentscheidung durch den tatsächlichen Zielzustand, ergibt sich:

| Datei | Weicher Hurdle-MAE | Harter Hurdle-MAE | MAE mit perfektem Zielzustand |
|---|---:|---:|---:|
| 3 | 1,10290 | 0,77543 | 0,02016 |
| 8 | 0,44304 | 0,44852 | 0,38162 |
| 10 | 0,09690 | 0,06260 | 0,04660 |
| 11 | 2,16624 | 2,04983 | 1,57147 |

Dies ist eine rückblickende Zerlegung, kein ausführbarer Prognosekandidat und
kein versprochener Fehlerwert. Bei Datei 8 wäre selbst dieses perfekte Zustands-
Routing im vorhandenen Hurdle-Modell etwas schlechter als die ausgewählte v2-
Prognose (MAE 0,37647). Eine reine Labelkorrektur kann diesen Mengenfehler nicht
lösen. Bei 3 ist die Zustandsentscheidung der zentrale Engpass, bei 11 bleiben
sowohl Zustands- als auch Mengenfehler relevant.

Der MAE-Kandidat für 3 kann als bedingter Median legitim null liefern. Deshalb
wird keine nachträglich aus den Testwerten abgeleitete Mindestmenge erzwungen:
Das würde das Zielmaß verändern und könnte Fehler erhöhen. Stattdessen muss
die fehlende Vorhersageleistung gegenüber null ausdrücklich sichtbar sein.

## Implementierte Korrekturen

Neue Methodikversion `portfolio_regime_0700_v3`, zusätzliche Kandidatenstufe
`candidate_set=regime`. Die vorherige Stufe `extended` bleibt zum Vergleich nutzbar.

- **Drei getrennte Zustände:** exakt gemessene Null, positive Grundlast bis zur
  trainierten Niedrigschwelle, aktive Last oberhalb der Schwelle. Keine NaN→0-
  Ersetzung und keine manuell auf Zähler-IDs zugeschnittene Klassifikation.
- **Lokaler Klassifikator je Zähler und Fold:** keine Pflicht, unterschiedliche
  Betriebsarten mit einem gemeinsamen Aktivitätsklassifikator zu erklären.
  Fehlende Zustandsklassen erhalten Wahrscheinlichkeit null; Ein-Klassen-Fits
  werden als konstantes Modell gespeichert.
- **Lokale Mengenmodelle:** positive Grundlast und aktive Mengen werden separat
  mit absolutem Fehler trainiert. Nullzustand hat Menge null. Drei Kandidaten:
  weiche Mischung, harte Zustandsentscheidung und 75/25-Mischung der weichen
  Prognose mit der Vorwoche. Die weiche Mischung verwendet bedingte Medianmodelle;
  sie wird nicht als kalibrierter Erwartungswert behauptet.
- **Historische Profilmerkmale:** benachbarte Viertelstunden der Vorwochen,
  Null-/Aktivhäufigkeit und Streuung vergleichbarer Wochenintervalle, Verteilung
  und Zustandshäufigkeiten des letzten vollständig verfügbaren Tages. Alle
  Werte durchlaufen dieselbe D−3-/Lieferzeit-/Revisionsprüfung wie bisher.
- **Getrennte Diagnosen:** Verwechslungsmatrix des lokalen Klassifikators,
  Mehrklassen-Brier gegen den ausschließlich im Training bestimmten Klassenprior,
  Verwechslungsmatrix der tatsächlich vorhergesagten Mengen, Fehler/Energie je
  Zielzustand, MAE-Gewinn gegen Null und Verhältnis prognostizierter zu realer Menge.
- **Sichtbare Grenzen:** `no_mae_skill_over_zero_reference` und
  `severe_energy_underprediction` im Ergebnisbericht. Einsatzprognosen geben
  diese Hinweise aus vorgelagerten Validierungsfenstern weiter; sie greifen
  selbstverständlich nicht auf unbekannte zukünftige Istwerte zu.
- **Beobachtbarkeit:** Auch der vorhandene harte Hurdle-Kandidat erhält seine
  Aktivitätswahrscheinlichkeit und wird in dessen Aktivitätsdiagnose erfasst.
- **Persistenz und REST:** native Modelle, Klassenprior und Zustandsinformationen
  werden gespeichert und wieder geladen; neue Codedatei ist Teil der Identitäts-
  und Resume-Prüfung. Modell-/Artefaktversionen ändern sich ausdrücklich.

Die bestehende Discovery-/Confirmation-Auswahl wird nicht anhand des bekannten
Testverlaufs gelockert. Ein neuer Kandidat muss weiterhin auf historischen
Fenstern überzeugen. Nachträglich gute Kandidaten werden nicht fest verdrahtet.

## Zeitlich getrennter Entwicklungspilot

Verglichen werden v2-Snapshot und v3 für dieselben vier Zähler, Informationsgrenze
D−3 und vollständige vorgelagerte Discovery-/Confirmation-Fenster. Zielperioden:
01.–14.01.2024 und 01.–14.07.2024. Training umfasst dieselben 180 Tage. Ein Winter-
und Sommerausschnitt sind ein Entwicklungstest, keine unabhängige Bestätigung
und kein Ersatz für das gemeinsame Elf-Zähler-Training.

Skript: `tools/forecast-portfolio/pilot_regimes.py`.
Ergebnisse: `tmp/profile/portfolio-v3-pilot-baseline.json` und
`tmp/profile/portfolio-v3-pilot-challenger.json`. Neue Parameter wurden nicht mit
Zielwerten der Pilotfenster angepasst. Die Oracle-Zerlegung oben fließt nicht
als Feature oder Auswahlkriterium in die Modelle ein.

## Pilotergebnis

| Beginn | Zähler | v2 WAPE % | v3 WAPE % | Auswahl v3 |
|---|---|---:|---:|---|
| 2024-01-01 | meter-3 | 100.000 | 100.000 | hgb_mae |
| 2024-01-01 | meter-8 | 13.113 | 13.113 | hgb_week_75 |
| 2024-01-01 | meter-10 | 10.240 | 10.240 | previous_week |
| 2024-01-01 | meter-11 | 110.829 | 110.829 | weekday_median |
| 2024-07-01 | meter-3 | 100.000 | 100.000 | hgb_mae |
| 2024-07-01 | meter-8 | 19.859 | 19.859 | weekday_median |
| 2024-07-01 | meter-10 | 17.197 | 13.939 | regime_local_hard |
| 2024-07-01 | meter-11 | 62.130 | 62.130 | weekday_median |

Die nach vorgelagerten Fenstern gewählte Prognose verbessert sich im Sommer bei
Zähler 10 von 17,197 auf 13,939 %; alle anderen Pilotentscheidungen bleiben
unverändert. Bei 8 und 11 liefern einzelne neue Kandidaten im Winter bessere
Zielwerte, erfüllen aber die vorherige Auswahl/Bestätigung nicht. Das ist ein
Hinweis auf Potenzial, kein Anlass, Testwerte zur Auswahlregel zu machen.

Bei Zähler 3 liegt der neue Klassifikator im Winter mit Mehrklassen-Brier 0,3856
sogar hinter dem trainierten Klassenprior (0,3721); im Sommer ist der Unterschied
minimal (0,3977 gegenüber 0,3992). Aus den vorhandenen Merkmalen ist in diesem
Pilot keine belastbare Aktivitätsvorhersage nachgewiesen. Mehr Zustandsklassen
allein lösen das Problem nicht. Eine konstante Null-Punktprognose bleibt bei
MAE-Optimierung möglich und wird nun als solche kenntlich gemacht.

Baseline-Laufzeiten: etwa 108/124 Sekunden je Fenster; mit Zustandskandidaten
214/225 Sekunden. Diese Messung lief parallel zu Tests und ist keine belastbare
Prognose der Volltestdauer. Mehr lokale Modelle erhöhen den Rechenbedarf.

## Prüfumfang und nächster Lauf

22 Python-Tests (einschließlich D−3, Zuständen, nativer Modellpersistenz,
fehlenden Klassen, eingefrorenem Resume), 36 gezielte JavaScript-Tests und 33
Client-/Exporttests erfolgreich. Der isolierte HTTP-Test besteht alle sechs
Neustart-/Resume-/REST-/Retraining-Prüfungen mit explizitem Zustandsvertrag.
Kein PM2-Neustart und kein Elf-Dateien-Volltest wurden ausgeführt.

`portfolio-0700.json` verwendet jetzt explizit `candidate_set=regime`;
`portfolio-regime-0700.json` enthält dieselbe neue Konfiguration. Die bisherige
Kandidatenkonfiguration ist als `portfolio-v2-0700.json` erhalten. Der API-Default
für `/train` ohne Methodenangabe bleibt zur Vermeidung eines stillen Wechsels
`extended`; für Zustandsmodelle dort `portfolio_method.candidate_set=regime`
übergeben. `/retrain` übernimmt den gespeicherten Vertrag.

Vor dem nächsten Volltest den Service neu starten, das aktuelle Portfolio-
Testskript und einen neuen Ausgabeordner verwenden. Alte Modell-/Checkpoint-
Kennungen sind wegen der neuen Methodik inkompatibel; fertige Ergebnisarchive
bleiben erhalten. Neu sind die Betriebsdiagnosen im Markdown-/JSON-Bericht
und Zustandsfelder im CSV-Export. Zustandswahrscheinlichkeiten stammen vom
lokalen Zustandskandidaten, auch wenn der Router einen anderen Mengenkandidaten
wählt; sie sind keine Unsicherheitsintervalle der ausgewählten Mengenprognose.

Ein Erfolg unter 60 % und Verbesserungen bei 8/11 sind damit noch nicht belegt.
Der vollständige neue Lauf bleibt die nächste Qualitätsprüfung.
