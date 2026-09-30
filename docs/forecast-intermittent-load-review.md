# Fachliche Prüfung: Aktivität und Verbrauch getrennt prognostizieren

Implementierungsnachtrag: Ein erster Kandidat mit drei historisch gelernten Tageszuständen ist jetzt unter `learned_states` verfügbar. Er ist kein binäres Aktivitäts-/Mengenmodell. Persistenz, Informationsgrenzen und API-Verwendung beschreibt das [Zustandsmodell-Runbook](forecast-state-model-runbook.md). Die ursprüngliche fachliche Prüfung unten bleibt als Ausgangshypothese erhalten.

Stand: 25.09.2026. Gegenstand ist ein zweistufiges Modell für nichtnegative,
intermittierende Verbrauchsreihen: Wahrscheinlichkeit eines positiven Messwerts
und erwartete Verbrauchshöhe bei positivem Messwert. Dies ist eine fachliche
Bewertung und ein Prüfprotokoll, noch kein implementierter oder validierter
Modellkandidat.

## Bewertung

Der Ansatz ist als zusätzliche, je Zähler zu prüfende Modellfamilie sinnvoll.
Er ist kein belegter allgemeiner Ersatz für das bestehende Modell. Viele Nullwerte
allein beweisen weder einen vorhersehbaren Betriebszustand noch einen Vorteil des
zweistufigen Modells. Ein Messwert von null kann außerdem Stillstand, Rundung oder
eine nicht gekennzeichnete Datenlücke bedeuten. Im aktuellen Benchmark werden
explizite Nullen als Messwerte behandelt; ein Betriebszustand ist nicht gelabelt.

Für nichtnegative Werte gilt mit den zur Prognose verfügbaren Informationen X:

```
E[Y | X] = P(Y > 0 | X) × E[Y | Y > 0, X]
```

Diese Zerlegung allein schafft keine zusätzliche Information: Schätzt man in
derselben Kalendergruppe die Wahrscheinlichkeit als n_positive/n und die positive
Höhe als Summe/n_positive, ist ihr Produkt exakt Summe/n — der bisherige
Gruppenmittelwert. Bei ausschließlich null bleibt die Prognose null.
Verbesserungen benötigen zusätzliche prädiktive Merkmale, andere Regularisierung
oder eine besser passende zeitliche Dynamik. Forschung zu intermittierendem Bedarf
motiviert insbesondere die Modellierung von Ereignisabständen und Clustern; ihre
Ergebnisse sind kein Wirksamkeitsnachweis für diese Energieprofile.
[Turkmen et al., Intermittent Demand Forecasting with Renewal Processes](https://arxiv.org/abs/2010.01550).

Bei quadratischem Fehler soll die Punktprognose den bedingten Erwartungswert
schätzen. Die Aktivitätswahrscheinlichkeit mit einer festen Schwelle in null/eins
umzuwandeln, kann RMSE verschlechtern: Bei p=0,4 und positiver Höhe 10 ist die
Erwartungswertprognose 4, nicht 0. MAE und RMSE verfolgen unterschiedliche Ziele;
die Zielfunktion muss vor dem Modellvergleich feststehen.
[Gneiting, Making and Evaluating Point Forecasts](https://arxiv.org/abs/0912.0902).

## Befund aus den elf Profilen

Die standardisierte Nachrechnung der vorhandenen API-Jahresläufe umfasst alle
386.496 Viertelstunden des Prüfjahres 2024. Gesamt-MSE: 6,4190 (kWh)²;
Gesamt-RMSE: 2,5336 kWh; Historienbaseline-RMSE: 2,7407 kWh. Verbesserung:
7,56 %. Der Gesamtwert gewichtet große Lasten stärker. Acht Profile sind nach
der expliziten WAPE-Heuristik low, drei medium; vollständige Abdeckung ist kein
Nachweis guter Prognosequalität.

| Profil | Nullanteil 2024 | MAE auf Nullintervallen, kWh | MAE auf positiven Intervallen, kWh |
|---|---:|---:|---:|
| 1 | 78,39 % | 0,0389 | 0,1651 |
| 3 | 73,57 % | 0,6412 | 2,3136 |
| 4 | 74,64 % | 0,9338 | 2,4061 |
| 5 | 60,76 % | 3,0134 | 6,8868 |
| 10 | 48,51 % | 0,0349 | 0,1138 |

Diese nachträgliche Segmentierung beschreibt Fehler, sie ist kein zulässiges
Eingabemerkmal für die Prognose. Profil 10 erzielt trotz vieler Nullen bereits
41,25 % RMSE-Verbesserung gegenüber der Historienbaseline. Eine pauschale
Umstellung aller nullreichen Reihen wäre daher nicht begründet. Bei Profilen
1/3/4/5 ist der Ansatz untersuchenswert, sein Nutzen aber noch unbewiesen.

Quelle der Zahlen: `tmp/profile/standardized-reference/report.json`, erstellt
mit dem unabhängigen Client in `tools/forecast-quality`. Ausführungsart:
`archived_api_replay`. Zusätzlich wurde ein echter API-Smoke-Test mit Profil 1
über sieben Tage erfolgreich ausgeführt (`standardized-live-smoke`). Hier wird
kein neuer Live-Jahreslauf oder neuer Modellvergleich behauptet.

## Bedingungen für eine hochwertige Implementierung

1. Aktivität als Wahrscheinlichkeit eines positiven Messwerts bezeichnen. Für
   einen tatsächlichen Anlagenzustand sind zusätzliche fachliche Labels nötig.
   Negative Nettoflüsse benötigen eine andere Modellierung oder klare Ablehnung.
2. Kalender, bekannte Betriebspläne und zeitversetzte Aktivitätsmerkmale verwenden:
   etwa derselbe Viertelstundenslot an D−2/D−7 und Nullanteile der vorher verfügbaren
   Tage. Jeder Trainingsdatensatz braucht dabei denselben Informationsstand, den
   eine damalige Prognose gehabt hätte. Fehlende Werte sind kein Zustand null.
3. D−2 als Verfügbarkeitsgrenze beibehalten. Die Grenze schließt die ältere,
   mehrjährige Historie nicht aus. Eine andere reale Lieferfrist muss separat
   konfiguriert und anhand damaliger Datenverfügbarkeit geprüft werden. Wetter
   braucht historische Forecast-Vintages; spätere Wetter-Istwerte wären Leakage.
4. Je Zähler beide Stufen regularisieren und bei wenigen positiven Beobachtungen
   auf belastbare einfachere Modelle zurückfallen. Lange Historie stabilisiert;
   jüngere Historie kann Strukturänderungen abbilden. Die Wahl erfolgt ausschließlich
   innerhalb der bis zum jeweiligen Prognosezeitpunkt verfügbaren Historie.
5. Die Modellfamilie durch zeitlich getrennte Validierung gegen das vorhandene
   Modell und einfache Kalender-/Saisonbaselines auswählen. Ein Wetter- oder
   Kalendereffekt gilt erst bei zusätzlichem Prognosenutzen nach Kontrolle anderer
   Merkmale als nützlich. Eine Korrelation oder bessere Prognose beweist keine
   kausale Wirkung; das Produkt sollte von prädiktiven Zusammenhängen sprechen.
6. Neben RMSE/MSE und MAE die Kalibrierung der Aktivitätswahrscheinlichkeit
   (Brier-Score, Zuverlässigkeitsgruppen), Fehler bei null/positivem Istwert,
   Tagesenergie-Bias, schlechteste Tage und Modellwahl je Zähler dokumentieren.
   Hohe Klassifikationsgenauigkeit durch häufige Nullvorhersagen reicht nicht aus.

## Festzulegender Versuch vor weiteren Optimierungen

Vorschlag für einen neuen Versuch, keine nachträglich angewandte Freigaberegel:
einen zweistufigen Kandidaten vorab festschreiben und API-basiert auf denselben
elf Reihen mit derselben D−2-Regel vergleichen. Referenz ist das aktuelle
automatische Modell, zusätzlich die Historienbaseline. Primäre Zielgröße ist
die ungewichtete mittlere relative RMSE-Verbesserung je Zähler; gepoolten RMSE,
MAE und Einzelergebnisse ergänzend ausweisen.

Vorgeschlagene Hürden: mindestens 2 % mittlere relative RMSE-Verbesserung,
Verbesserung bei mindestens 6/11 Zählern, keine Einzelverschlechterung über 10 %,
mittlere relative MAE-Verschlechterung höchstens 2 %. Zeitliche Unsicherheit
durch gepaarte Wochenblöcke ausweisen; Viertelstunden sind keine unabhängigen
Replikationen. Merkmale und Hyperparameter dürfen nicht am äußeren Prüfjahr
ausgewählt werden. Selbst bei Bestehen ist dies wegen der bereits bekannten
Profile nur Entwicklungsevidenz.

Elf Zeitreihen verhindern Overfitting durch wiederholte Versuche nicht. Auch
die zuvor reservierten Profile und das vierte Quartal wurden mittlerweile
ausgewertet. Für einen unabhängigen Wirksamkeitsnachweis sind neue Zähler oder
bisher ungesehene spätere Zeiträume nötig. Ohne solchen Nachweis ist keine
generelle Qualitätszusage und keine automatische Standardumstellung begründet.

## Reproduzierbarer Test vor Modelländerungen

Das zuerst erstellte Paket `tools/forecast-quality` enthält ausschließlich
Import, API-Aufrufe und unabhängige Nachrechnung, keine eigene Prognose.
Es fixiert Datei-Hashes, Einheiten, Zeitzone, Prüfzeitraum und Vergleichspolitik;
Reports werden gegen ein JSON-Schema validiert. Markdown, JSON und CSV erlauben
fachliche Prüfung sowie maschinellen Teamvergleich. Anleitung und Voraussetzungen
stehen in [README](../tools/forecast-quality/README.md).

Der Standardbenchmark bleibt unverändert reproduzierbar. Eine neue Modellfamilie
muss zunächst serverseitig implementiert und getestet werden. Das optionale
`--candidate-config` unterstützt deren späteren Vergleich, lehnt aber eine API ab,
die die angeforderte Modellfamilie in ihrer Antwort nicht bestätigt. Das Paket
enthält keine privaten Messdaten und keine Zugangsdaten.
