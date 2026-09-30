# Gemischte CSV-/XLSX-Historien für das Offline-Basistraining

**Aktualisierung:** Für ein Herausgeber-Basismodell jetzt den standardmäßigen Modus `baseline` verwenden: [saisonale Zusammensetzung und direkte Modellprüfung](forecast-baseline-quality.md). Die unten dokumentierten Trainings-/Validierungsfenster beschreiben den weiterhin verfügbaren älteren Modus `adaptation`.

Die Datenvorbereitung erzeugt private JSON-Historien mit kWh pro Viertelstunde. Jahresdateien desselben CSV-Zählers werden zusammengeführt; Bezug und Einspeisung erhalten unterschiedliche Serien-IDs und getrennte Trainingsverzeichnisse. Das laufende REST-System wird dadurch nicht verändert.

## Vorbereiten

Aus dem CET-Repository:

```bash
.venv-forecast/bin/python tools/forecast-product/prepare_training_data.py \
  --source tmp/profile/basis_training_daten \
  --out tmp/profile/basis_training_prepared_20260927_v1
```

Der Ausgabeordner muss neu sein. Das Werkzeug akzeptiert die beiden geprüften CSV-Schemata `Zeit, Zeit (UTC), Zählerstand (Wh), Leistung (W)` beziehungsweise separate Bezugs-/Einspeisespalten. Es erkennt UTF-8/CP1252. CSV-Dateinamen müssen eine Kennung `Zähler <Ziffern>` enthalten; optionale `(1)`-Suffixe stehen für Dateien desselben Zählers. Die führende Null einer Kennung bleibt erhalten. Andere Formate werden ausdrücklich abgewiesen, nicht geraten.

- Pro Zähler byteidentische Dateien einmal berücksichtigen. Identische Überlappungen gleicher Zeitstempel deduplizieren; widersprüchliche Werte ablehnen.
- UTC-Zeit gegen Europe/Berlin prüfen. CSV-Zeit ist Intervallende: **15 Minuten abziehen**.
- Leistungswerte **W / 4.000 = kWh pro Viertelstunde**. Bei benachbarten Intervallen muss die Registerdifferenz in Wh exakt `W / 4` entsprechen. Über echte Lücken keine Registerdifferenzen bilden.
- Negative/fehlende/ungültige CSV-Werte und unbekannte Schemata ablehnen. Keine Nullauffüllung oder Interpolation.
- Bezug und Einspeisung separat erhalten, nie saldieren. Einspeisung ist nicht zwingend gesamte Erzeugung; Netzbezug nicht zwingend gesamter Objektverbrauch.
- Allgemeine Leistungsspalten ohne Richtung und die bisherigen XLSX werden explizit als Bezugs-/Lastdaten behandelt; diese Annahme ist im Manifest vermerkt.
- XLSX über den vorhandenen Importer mit kWh, Berliner Zeit und dessen DST-Behandlung lesen. Doppelte XLSX-Serien-IDs werden abgewiesen und nicht als zusätzliche Zähler gezählt.

`manifest.json` enthält Eingabe-/Ausgabeprüfsummen, Serienzuordnung, Zeiträume, Lücken, Herkunft und Qualitätsmarkierungen. JSON-Dateien und Verzeichnisse werden privat (0600/0700) angelegt. Ein unvollständiger Vorbereitungslauf ohne gültiges Manifest ist nicht trainingsbereit. Für einen erneuten Lauf ein neues Verzeichnis verwenden.

## Vollständigkeit vorab prüfen

```bash
.venv-forecast/bin/python tools/forecast-product/train_prepared.py --mode adaptation \
  --prepared tmp/profile/basis_training_prepared_20260927_v1/manifest.json \
  --out tmp/profile/basis_training_preflight_20260927_v1 \
  --check-only
```

Dies prüft die tatsächlichen kausalen Features und Mindestmengen, ohne einen Schätzer zu trainieren. In jedem Richtungsverzeichnis stehen `training-plan.json` und ein privater, vorbereiteter Task. Das Manifest und jede ausgewählte JSON-Datei werden erneut auf Integrität geprüft. Der Output darf noch nicht existieren.

## Vollständiges Training starten

```bash
.venv-forecast/bin/python tools/forecast-product/train_prepared.py --mode adaptation \
  --prepared tmp/profile/basis_training_prepared_20260927_v1/manifest.json \
  --out tmp/profile/basis_training_models_20260927_v1
```

Dieser eine Befehl führt nacheinander zwei eigenständige Trainingsläufe durch:

- `import/`: Bezugs-/Lastmodell; eigenes Modell, eigene Referenzhistorien und Validierung.
- `export/`: Einspeisungsmodell; vollständig getrennte Modellartefakte und Referenzhistorien.

`run.json` protokolliert den Abschluss je Richtung. Der Wrapper überschreibt keine vorherigen Ergebnisse und implementiert kein automatisches Resume. Bei einem abgebrochenen Lauf kann eine einzelne Richtung mit dem folgenden Befehl in ein neues Verzeichnis trainiert werden. Frühere abgeschlossene Richtungen müssen nicht erneut trainiert werden.

```bash
.venv-forecast/bin/python tools/forecast-product/prepare_starter.py \
  --prepared tmp/profile/basis_training_prepared_20260927_v1/manifest.json \
  --direction import --forecast-for 2026-01-03 --unit kWh \
  --out tmp/profile/basis_training_import_retry
```

`--direction export` wählt entsprechend die Einspeisungsreihen. Bei `--prepared` wird die Zeitzone aus den vorbereiteten Datensätzen übernommen; eine abweichende Einheit wird abgelehnt. Die alte `--input`-Schnittstelle bleibt für einfache gleichzeitige Historien bestehen.

## Unterschiedliche Datenenden ohne falsche Aktualität

Der vorgeschlagene historische Prognosetag ist je Richtung der letzte vorhandene lokale Messtag plus drei Tage. Im aktuellen Bestand ist das **03.01.2026**: Daten bis einschließlich 31.12.2025 sind unter der D−3-Regel zulässig. Das ist ein historischer Trainingsstand und keine aktuelle Prognose für September 2026.

Reihen, die relativ zum Informationszeitpunkt noch aktuell sind, werden als eigene Zähler trainiert und validiert. Ältere Reihen werden über den vorhandenen `reference_meters`-/`fit_panel`-Pfad eingebunden. Ihre Messzeitpunkte bleiben unverändert. Für jede Reihe bleibt ein eigener historischer Vorlauf bis zu 240 Tagen erhalten; das bestehende Modell nutzt daraus bis zu 180 Trainingstage plus Warmup. Mehrere Jahresdateien erzeugen keinen mehrfachen Zählerbeitrag: Jede Serie erhält das gleiche Gesamtgewicht im gemeinsamen Training.

Das Validierungsmodell verwendet auch von Referenzzählern ausschließlich vor dem Validierungsursprung verfügbare Werte. Der Vorabcheck prüft mindestens 28 beobachtete Historientage, mindestens sieben Tage kausaler Trainingsbeispiele und ausreichende Validierungsabdeckung. Fehlende Tage bleiben fehlend. Neue Datenfristen werden weder für die REST API noch für das Modell eingeführt oder gelockert.

Wichtig: Die Qualitätsmetriken des neuen Laufs beziehen sich auf die **aktuellen eigenen Zähler**, nicht automatisch auf die älteren Referenzzähler. Deren Beitrag zum gemeinsamen Training beweist keine Verbesserung auf den elf ursprünglichen Lastgängen. Dafür weiterhin separate, unveränderte historische Testfenster verwenden.

## Aktueller Bestand und Grenzen

Erwartet werden 17 Serien: 15 Bezug/Last und zwei Einspeisung. Im Bezugsmodell sind drei CSV-Zähler bis Ende 2025 aktuell und zwölf ältere Reihen Referenzen (elf XLSX plus Aggregation). Das Einspeisungsmodell trainiert zwei aktuelle CSV-Zähler. Greenpocket 2025 wird nur einmal verwendet; 2024 bleibt als Lücke dokumentiert.

Das Mietobjekt mit nur 160/164 W wird auf ausdrücklichen Wunsch im vollständigen Bestand mitgeführt und als nahezu konstant markiert. Ob es sich um Rohmessungen oder interpolierte Daten handelt, bleibt fachlich offen. Ebenso bleibt die Beziehung zwischen GWR29 und seiner Aggregation offen; nicht ungeprüft als voneinander unabhängige Population im Generalisierungstest behandeln.

Beide Trainingsstände bleiben privat. Der bestehende öffentliche **Verbrauchs**-Starter unterstützt derzeit keine automatische Auswahl nach Messrichtung. Deshalb verweigert `starter_model.js export` ein mit `training-scope.json` als Einspeisung gekennzeichnetes Modell. Einspeisungsartefakte nicht als Verbrauchsmodell veröffentlichen oder in dessen REST-Modellbestand einspielen. Das öffentliche Bezugsmodell kann nach fachlicher Prüfung wie im [Herausgeber-Runbook](forecast-public-starter.md) exportiert werden. Die ursprünglichen CSV/XLSX und vorbereiteten JSON-Historien werden dabei nicht veröffentlicht.

## Tests

```bash
PYTHONPATH=tools/forecast-product:tools/forecast-portfolio \
  .venv-forecast/bin/python -m unittest tools/forecast-product/test_prepared_training.py -v
```

Geprüft werden unter anderem identische und widersprüchliche Überlappungen, führende Nullen, DST-Zeitstempel, W→kWh, Registerabgleich, erhaltene Jahreslücken, Prüfsummen und echtes natives Training getrennter Richtungen mit älteren Referenzzählern.

## Durchgeführte Vorbereitung am 2026-09-27

- `tmp/profile/basis_training_prepared_20260927_v1/manifest.json`: 17 Serien vorbereitet; 15 Bezugs-/Lastreihen mit 2.118.052 Intervallen, zwei Einspeisereihen mit 140.256 Intervallen.
- `tmp/profile/basis_training_prepared_20260927_v1/energy-check.json`: Energiesummen aller sechs CSV-Kanäle stimmen mit den deduplizierten Quelldateien überein.
- `tmp/profile/basis_training_preflight_20260927_v1/run.json`: beide Richtungen `ready`, kein Modell auf den vollständigen realen Daten trainiert.
- 15 unterschiedliche Python-Tests bestanden, darunter native Testtrainings mit älteren Referenzzählern für beide Richtungen. Öffentlicher Export eines Test-Bezugsmodells funktioniert; Export des Test-Einspeisemodells als Verbrauchs-Starter wird abgewiesen. ESLint für die geänderte JS-CLI und `git diff --check` ohne Befund.

Vorbereitung und Vorabcheck sind bereits ausgeführt; zum Starten nur den Befehl im Abschnitt „Vollständiges Training starten“ verwenden. Vorhandene Ausgabeordner werden nicht überschrieben.
