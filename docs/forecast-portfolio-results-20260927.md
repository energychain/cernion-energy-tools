# Portfolio-v2-Ergebnisse vom 27.09.2026

Quelle: `tmp/profile/cells_energy_2026091537/report.json` und exportierte Einzelprognosen.
Status completed; elf Reihen, je 70176 Viertelstunden, insgesamt 771936.
Datei-Hashes, Istbetragssummen und Beobachtungszahlen stimmen mit dem vorherigen
Portfolio-Lauf `cells_energy_2026091252` überein. Methodik unterschiedlich: v2
D−3/MAE/erweiterte Kandidaten, v1 D−2/RMSE; beide rollierend. Dies ist ein
Systemvergleich und keine isolierte Ablation einer einzelnen Änderung.

## Ergebnis

Macro-WAPE 65.4450 % statt 76.0488 %: −10.6038 Prozentpunkte. Gepoolter WAPE
54.1820 % statt 58.8323 %. Gepoolter MAE 1.206531 statt 1.310085 (−7.90 %),
RMSE 2.689163 statt 2.553147 (+5.32 %). Zehn Reihen verbessern WAPE; Reihe 9
verschlechtert sich leicht. Der Vorteil bei absoluten Fehlern geht mit höheren
quadratischen Fehlern einher.

| Datei | Portfolio v1 WAPE % | Portfolio v2 WAPE % | Änderung Prozentpunkte |
|---|---:|---:|---:|
| 1 | 127.74 | 107.33 | -20.41 |
| 2 | 16.29 | 15.11 | -1.18 |
| 3 | 150.32 | 100.29 | -50.03 |
| 4 | 139.07 | 112.11 | -26.97 |
| 5 | 123.48 | 110.80 | -12.68 |
| 6 | 53.59 | 52.85 | -0.74 |
| 7 | 101.17 | 97.39 | -3.78 |
| 8 | 20.22 | 20.16 | -0.06 |
| 9 | 33.26 | 34.33 | +1.07 |
| 10 | 15.75 | 13.92 | -1.83 |
| 11 | 55.66 | 55.61 | -0.04 |

## Einordnung der externen E2-Tabelle

Die zuletzt übermittelten E2-Werte sind 124.5, 17.5, 121.0, 141.0, 103.9, 47.1,
104.5, 16.0, 48.0, 10.4, 40.6 %. Dagegen liegen v2-Reihen 5, 6, 8, 10 und 11
zurück, nicht nur 8, 10 und 11. Ein neuer E2-Originalexport liegt nicht vor.

E2 beschreibt Q4 2024 mit eingefrorenen Gewichten und 8832 Testintervallen,
v2 die zwei Jahre mit rollierendem Neutraining. Die aus den v2-CSV-Dateien
berechnete Q4-Teilmenge hat 8836 Intervalle je Reihe und Macro-WAPE 68.6997 %.
Datei 10 erreicht dort 10.4610 % (nahe E2 10.4 %), Datei 8 18.3917 %, Datei 11
49.8285 %. Datei 9 erreicht in Q4 66.2756 % statt 34.3314 % über zwei Jahre.
Die Gegenüberstellung unterschiedlicher Fenster kann also selbst die Richtung
eines Vergleichs umkehren. Auch die Q4-Teilmenge ist wegen unterschiedlicher
Trainingsregeln und DST-Zielintervalle noch kein kontrollierter E2-Vergleich.

## Potenzial der drei genannten Reihen

| Datei | Gewählte Prognose WAPE % | Bester fester vorhandener Kandidat im Nachhinein | Kandidaten-WAPE % |
|---|---:|---|---:|
| 8 | 20.1573 | hgb_mae | 18.791 |
| 10 | 13.9200 | hurdle_gate | 13.287 |
| 11 | 55.6139 | hgb_mae | 53.306 |

Das sind rückblickende Diagnosen; diese Kandidaten dürfen nicht anhand der
Testfehler für den nächsten operativen Einsatz fest verdrahtet werden.
Reihe 8 bestätigt ML in 12/27 Auswahlfenstern, Reihe 10 ebenfalls 12/27,
Reihe 11 nur 4/27. Häufiges Zurückfallen auf Referenzen ist kein Beweis dafür,
dass die Schutzregel zu streng ist; dafür müssen die vorgelagerten Fehler und
anschließenden Gewinne je Block verglichen werden.

Reihe 8: Sommer-WAPE 24.19 %, Winter 17.07 %. Saisonale Profilanpassung und
historisch validierte HGB-/Referenzmischungen sind plausible Tests.
Reihe 10: Q4 bereits nahe am E2-Wert; über zwei Jahre ist der harte Hurdle-Kandidat
stark. HGB-MAE allein hat dagegen 55.14 % WAPE. Dies zeigt, warum keine pauschale
Umstellung aller Reihen auf HGB-MAE erfolgen sollte.
Reihe 11: Winter-WAPE 65.18 %, Herbst 43.76 %. Auch der beste vorhandene feste
Kandidat bleibt über 53 %. Saisonale Trainingsfenster, Niveauwechsel und mehr
als 180 Tage Trainingshistorie sind als kontrollierte Ablationen sinnvoll.

## Ziel unter 60 %

Ersetzt man ausschließlich die WAPE-Werte von 8, 10 und 11 durch ihre übermittelten
E2-Werte, ergibt sich Macro-WAPE 63.3822 %. Für weniger als 60 % müssten diese
drei Reihen zusammen von 89.6912 auf unter 29.7961 Prozentpunkte fallen,
sofern die übrigen acht unverändert bleiben. Das entspricht über 66.8 %
Reduktion ihrer gemeinsamen WAPE-Summe. Ein begrenztes Feintuning bis auf
E2-Niveau reicht folglich nicht aus.

Selbst die nachträgliche Wahl des jeweils besten festen vorhandenen Kandidaten
für alle elf Reihen ergibt 61.5271 %. Das ist kein theoretisches Minimum für
zeitabhängiges Routing, zeigt aber die Grenze einer einfachen nachträglichen
Expertenwahl. Ein beobachteter Wert unter 60 % benötigt zusätzliche Gewinne.

## Niedrigverbrauch: wichtiger Gegencheck

Datei 3 prognostiziert über den gesamten Lauf nur 0.434 % der tatsächlichen
Energiemenge; 94.87 % der Prognosen sind exakt null. Ihr WAPE 100.294 % liegt
knapp über einer konstanten Nullprognose (100 % bei positiver Istbetragssumme).
Der hgb_mae-Kandidat erreicht hier genau 100 %, ebenso bei Datei 1. Das ist
kein Nachweis gelungener Aktivitätsvorhersage. MAE kann bei überwiegenden
Nullphasen Nullprognosen bevorzugen. Die Verbesserung gegenüber v1 darf daher
nicht allein als bessere Erkennung aktiver Zeiten interpretiert werden.

Priorität für weitere Qualitätstests: neben 8/10/11 auch 1/3/4/5 auf aktive
Zeiten, Mengenunterdeckung und Nullreferenz prüfen. Eine Nullreferenz im Bericht
sowie separat ausgewiesene Mengen-/Aktivitätskriterien machen den Zielkonflikt
sichtbar; Regeln nur auf vorgelagerten Fenstern bestimmen.

## Nächster Schritt

Zuerst den vorhandenen eingefrorenen Q4-Vertrag mit E2-Zeitstempeln/Trainingsfristen
abgleichen. Danach begrenzte zeitliche Ablationen für Sommer/Winter, längere
Trainingsfenster und Mischungen. Keine zählerspezifische Sonderregel aus den
bereits bekannten Testfehlern ableiten. Der Zeitraum 2023–2024 bleibt
Entwicklungs-/Vergleichsdatenbestand; eine unabhängige Bestätigung steht aus.
Diese Auswertung verändert keine Modellparameter und startet keinen neuen Lauf.
