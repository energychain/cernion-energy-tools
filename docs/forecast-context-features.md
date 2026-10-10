# Standort- und Marktmerkmale pro Zähler

Die optionale erweiterte Merkmalsauswahl prüft Jahreszeit, Temperatur inklusive Heiz-/Kühlbedarf, tägliche Heizgradtage (Basis 18 °C), Globalstrahlung, deutsche Netzlast und Day-Ahead-Preis. Die Auswahl erfolgt je Zähler durch zeitlich geordnete historische Discovery, anschließende Bestätigung und bedingte Ablation. Version `relationship_state_context_guard_v4` erhält das bisherige Kalender-/Aktualitätsmodell als Referenz: Der erweiterte Kandidat muss zusätzlich mindestens 3 % RMSE-Vorteil, eine positive untere Bootstrap-Grenze und mindestens 75 % gewonnene Wochenblöcke zeigen; der MAE darf höchstens 2 % steigen. Fehlt dieser Nachweis oder fehlen Zieltag-Merkmale, bleibt die bewährte Referenz erhalten. Ein Merkmal wird nicht allein wegen einer Korrelation aufgenommen. Zustandskorrekturen müssen zusätzlich ihren Nutzen gegenüber dieser Basisprognose nachweisen.

## Verfügbarkeit

`issue_time: "18:00"` bedeutet Ausgabe am Vortag um 18 Uhr in der Zeitzone des Zählers. Die Messhistorie endet unabhängig davon bei D−2. Standard bleibt `00:00` für bestehende Aufrufe und Modelle. Sommerzeit wird über lokale Kalendertage aufgelöst.

- **Wetter Kempten:** historische Beobachtungen über Cernion/Visual Crossing (`mastr_generation_forecast`, PLZ 87435); archivierte GFS-Vorhersagen von Open-Meteo mit festem 72-Stunden-Vorlauf. Historische Beobachtungen werden niemals als Zieltag-Wettervorhersage eingesetzt.
- **Heizgradtage:** `max(0,18−Tagesmitteltemperatur)` in K·d, nur bei vollständigem lokalem Wettertag. Verfügbar erst mit dem spätesten beitragenden Wert. Davon zu unterscheiden ist der bisherige momentane Temperaturdefizit-Term `heating_degree_18`.
- **Strahlung:** W/m²; stündliches Mittel wird auf vier physische Viertelstunden übertragen. Fehlende archivierte Strahlung bleibt fehlend. Im konkret abgerufenen Archiv fehlen außerdem vollständige Wettervorhersagetage vom 31.12.2023 bis 20.01.2024; diese werden nicht durch spätere Beobachtungen ersetzt. Das 2023-Archiv enthält hier keine Strahlung; damit ist diese Hypothese für frühe 2024-Auswahlfenster möglicherweise nicht prüfbar.
- **Deutsche Netzlast:** SMARD 410, täglicher Mittelwert in MW aus MWh je Viertelstunde. Verwendet wird der abgeschlossene Tag D−2. Die vollständige Last von D−1 ist um 18 Uhr dieses Tages noch unbekannt.
- **Börsenpreis:** SMARD 4169, DE-LU, EUR/MWh. Negative Preise sind zulässig. Historische Stundenpreise werden für die vier zugehörigen Viertelstunden gehalten.

Die historischen Wetterbeobachtungen und SMARD-Dateien sind nachträgliche Exporte. Ihre damalige Veröffentlichung und spätere Revisionen sind nicht vollständig verifiziert. Verfügbarkeiten sind explizit dokumentierte Annahmen (Beobachtungsstundenende +24 h, Netzlast-Tagesende +6 h, Preis D−1 18 Uhr). Der Report ist deshalb eine retrospektive Analyse unter diesen Annahmen, kein Nachweis eines lückenlos rekonstruierten Live-Betriebs. `issued_at` und `available_at` werden beide geprüft. Unklare doppelte Wetterstunden werden ausgelassen und als Datenlücken dokumentiert.

## API-Runbook

```bash
python3 tools/forecast-quality/prepare_features.py \
  --base-url http://localhost:3900 --out tmp/profile/context-inputs
python3 tools/forecast-quality/run.py \
  --data-dir tmp/profile --base-url http://localhost:3900 \
  --candidate-config tmp/profile/context-inputs/candidate.json \
  --out tmp/profile/context-quality --timeout 3600
```

Der erste Schritt nutzt ausschließlich die API und kann beim ersten Abruf mehrere Minuten dauern. Der Server benötigt `CERNION_TOKEN` sowie Zugriff auf SMARD und Open-Meteo. Rohdaten werden gecacht, normalisierte Datensätze inhaltlich gehasht. Die IDs sind serverlokal: Auf einer anderen Instanz zuerst die Vorbereitung ausführen. Alle elf Profile werden hier gemäß Testannahme Kempten zugeordnet (`weather_region: DE-BY-Kempten-87435`). Für andere Standorte muss eine eigene Zuordnung/Datenquelle verwendet werden.

Neue Endpunkte unter `/api/forecast-sandbox/consumption/features/`:

- `POST weather/prepare`: `location`, `history_from`, `history_until`, `forecast_from`, `forecast_until`.
- `POST context/prepare`: `from`, `until`.

Evaluation und Modelltraining nehmen die resultierenden IDs in `configuration.weather_dataset_id` und `configuration.context_dataset_id` entgegen; alternativ versionierte Inline-Daten. `extended_features: true` ergänzt die Jahreszeit. Gespeichert werden Modellkoeffizienten, Kalenderprofile, Zustände, Parameter, Quellreferenzen und Ausgabezeitpunkt. Beim erneuten Vorhersagen kann `configuration` Wetter-/Kontextdaten erneuern, ohne die Modellparameter zu verändern. Fehlende neue Zieltag-Merkmale lösen einen ausgewiesenen Profil-Fallback aus. Die historischen `/prepare`-Endpunkte bleiben auf vergangene Zeiträume beschränkt. Für zukünftige Tage dienen die separaten `/live`-Endpunkte oder versionierte Inline-Daten.

## Interpretation

Strahlungsabhängig sinkender Netzbezug kann auf Eigen-PV hinweisen, kälteabhängig steigender Bezug auf Wärmepumpen oder elektrische Heizung. Sinkender Bezug bei Kälte könnte zu wärmegeführten BHKW passen. Kalender, Betrieb und Belegung können jedoch ähnliche Muster erzeugen. Diese Hinweise bestätigen weder eine Anlage noch einen kausalen Wirkzusammenhang. EMS-Lastverschiebung und deren physische Speichergrenzen werden durch das derzeitige additive Modell nicht explizit simuliert.

## Vergleich mit dem bisherigen Modell

```bash
python3 tools/forecast-quality/compare_context.py \
  --candidate tmp/profile/context-quality \
  --reference tmp/profile/state-hybrid-full-v2 \
  --out tmp/profile/context-comparison
```

Dieser Vergleich erlaubt ausdrücklich unterschiedliche externe Wissensstände (18 Uhr gegenüber 00 Uhr), prüft jedoch beide D−2-Grenzen separat. Er misst die gesamte Änderung aus Kandidaten und Ausgabezeitpunkt. Den isolierten Zusatznutzen einzelner Merkmale dokumentiert weiterhin die historische bedingte Ablation im API-Ergebnis; der äußere Jahresvergleich allein weist keine Kausalität nach.

## Tatsächliche Folgetagsprognosen

Vor dem gewählten Ausgabezeitpunkt (beispielsweise vor 18 Uhr) abrufen:

```json
POST /api/forecast-sandbox/consumption/features/weather/live
{"from":"<morgen>","until":"<morgen>","base_dataset_id":"<historische Wetter-ID>"}

POST /api/forecast-sandbox/consumption/features/context/live
{"from":"<morgen>","until":"<morgen>","base_dataset_id":"<historische Kontext-ID>"}
```

Die optionalen Basis-IDs übernehmen historische Trainings-/Validierungsmerkmale; die neuen IDs enthalten zusätzlich die tatsächlich abgerufenen Zukunftsmerkmale. Wetter kommt für Kempten über den bestehenden Cernion-Zugang. Markt-/Netzdaten werden frisch von SMARD geladen: Viertelstundenpreise werden nicht zu Stunden gemittelt. Noch nicht veröffentlichte Preise und unvollständige Netzlasttage bleiben fehlend und erzeugen Warnungen. `available_at` ist die abgeschlossene Abrufzeit, keine angenommene frühere Veröffentlichung. Deshalb müssen die Daten vor 18 Uhr geladen sein, wenn die Prognose einen Wissensstand von 18 Uhr verwendet.

Die IDs werden beim Trainieren oder beim Laden des bestehenden Zählermodells in `configuration.weather_dataset_id` und `configuration.context_dataset_id` übergeben. Der Kontext bleibt je Zähler versioniert; neue Wetter-/Marktdaten verändern weder Zustandszentren noch Modellkoeffizienten. Neue Istwerte und ein fälliges Refit bleiben erforderlich.

Die aktuelle Cernion-/Visual-Crossing-Vorhersage unterscheidet sich von den archivierten GFS-Vorhersagen des Rücktests. Diese Quellenänderung wird ausgewiesen; die gemessene historische Güte ist keine Garantie für die andere Live-Wetterquelle.

## Entwicklungsbefund zur Rückfallregel

Der erste erweiterte Versuch (v3) verletzte bei Profil 2 die vorab gesetzte Grenze von maximal 10 % RMSE-Verschlechterung: +23,76 % RMSE, obwohl keine Wetter-/Marktmerkmale aktiv waren. Nach gescheiterter Bestätigung war die Auswahl von der bewährten 84-Tage-Historie auf die einfache Gesamthistorie zurückgefallen. Der Versuch wurde nach dieser Grenzverletzung beendet und ist kein vollständiger Qualitätsnachweis. Die v4-Schutzregel behebt diesen Mechanismus generell, ohne zählerspezifische Ausnahmen oder anhand des Testjahres gewählte Schwellen. Die problematische Testwoche reproduziert über die API exakt die bisherigen 672 Prognosewerte.
