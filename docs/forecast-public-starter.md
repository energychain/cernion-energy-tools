# Öffentliches Forecast-Startmodell

CET kann ein signiertes gemeinsames Startmodell bei der ersten Einrichtung herunterladen und für neue Zähler als zusätzlichen Prognosekandidaten verwenden. Das öffentliche Modell benötigt auf der Zielinstanz **keine ursprünglichen XLSX-Dateien und keine Referenzhistorien des Herausgebers**.

Das ist ein anderes Format als der private Instanztransfer (`transfer.py`). Dessen Pakete enthalten vertrauliche Historien und dürfen nicht als öffentliches Startmodell verwendet werden.

## Inhalt und Modellverwendung

Das signierte JSON-Paket enthält ausschließlich:

- gemeinsames **Core-Modell** (CatBoost-Gewichte oder Konstante), ohne lokale Zählermodelle;
- Format-/Releaseversion, Feature-Vertrag, Einheit, Zeitzone und Code-/Bibliotheksversionen;
- Informationsstand des Trainings, Lizenzkennung und eine aggregierte normalisierte Validierungskennzahl.

Nicht enthalten sind XLSX, Messreihen, Zählernamen, Tenant-IDs, individuelle Skalierungen, Profillabels, private Qualitätsberichte, Tokens oder CatBoost-Trainingsmetadaten. Der Export baut das Core-Modell ohne dessen Trainingsmetadaten neu auf und prüft die Prognosegleichheit an synthetischen Features. CatBoost kann dabei leere Format-Standardparameter ergänzen. Das optionale gemeinsame Modell wird nicht exportiert.

Modellgewichte sind kein anonymisierter Datensatz mit formaler Datenschutzgarantie. Auch für ihre Veröffentlichung sind eine passende Freigabe der Trainingsgrundlage und eine festgelegte Modelllizenz erforderlich. Die Open-Source-Lizenz des Programmcodes legt die Rechte an den Trainingsdaten nicht automatisch fest.

Bei einem neuen Zähler werden Wochenreferenz, lokales Modell und die aus den **lokalen** Referenzhistorien trainierten gemeinsamen Modelle mit dem eingefrorenen öffentlichen Startmodell verglichen. Das Startmodell wird nur zugelassen, wenn Einheit, Zeitzone und Feature-/Softwarevertrag passen und sein Trainingsinformationsstand spätestens am Beginn des lokalen Validierungsverfahrens liegt. Es muss den bisherigen Kandidaten beim Validierungs-MAE um mindestens 3 % schlagen. Danach kann das optionale lokale Modell wiederum gewinnen.

Die Auswahl und MAE-Werte stehen in `model.evidence[series_id]`; `public_starter_status` erklärt insbesondere `eligible`, `not_installed`, `incompatible_unit_or_timezone` oder `trained_after_validation_origin`. Dies ist keine Garantie für eine Verbesserung auf zukünftigen Daten. Die öffentliche Validierungskennzahl beschreibt die Trainingsprozedur, keinen unabhängigen Test des veröffentlichten Modells.

Der neue Zähler bleibt privat an seinen Tenant gebunden. Neue Historien ergänzen ausschließlich die gemeinsame Referenzbasis der jeweiligen CET-Instanz. Es gibt keinen Rückkanal zum Herausgeber. Das öffentliche Modell wird nicht durch lokales Training überschrieben. Sein Artefakt wird bei Eignung in die private Modellversion kopiert; spätere Prognosen brauchen den Download-Speicher nicht erneut. Die bisherigen Anforderungen an Historienumfang (mindestens 28 beobachtete Tage und ausreichende kausale Trainings-/Validierungsabdeckung), Datenaktualität und Nachtraining bleiben bestehen.

## 1. Herausgeber: einmalig privat trainieren

Das Offline-Werkzeug `prepare_starter.py` benötigt keinen REST-Token und verändert keinen laufenden CET-Service. Es liest explizit übergebene XLSX/JSON-Dateien und erzeugt einen privaten Trainingsordner. Bei XLSX müssen bereits Intervallwerte vorliegen; kumulative OBIS-Registerstände vorher umrechnen. Historische Messwerte werden als ab dem folgenden lokalen Kalendertag verfügbar behandelt, wie beim historischen Import. Optionalwerte/Profillabels werden für dieses Core-Starttraining nicht übernommen.

Aus dem Repository-Verzeichnis:

```bash
.venv-forecast/bin/python tools/forecast-product/prepare_starter.py \
  --input tmp/profile/1_2020-2024.xlsx tmp/profile/2_2020-2024.xlsx \
          tmp/profile/3_2020-2024.xlsx tmp/profile/4_2021-2024.xlsx \
          tmp/profile/5_2020-2024.xlsx tmp/profile/6_2021-2024.xlsx \
          tmp/profile/7_2020-2024.xlsx tmp/profile/8_2020-2024.xlsx \
          tmp/profile/9_2020-2024.xlsx tmp/profile/10_2021-2024.xlsx \
          tmp/profile/11_2020-2024.xlsx \
  --unit kWh --time-basis berlin --forecast-for 2024-12-31 \
  --out tmp/profile/public_starter_training_20260927_v1
```

Der Ausgabeordner darf noch nicht existieren. Weitere Zeitreihen können über `--input` ergänzt werden, sofern Serien-IDs eindeutig und Einheit/Zeitzone gleich sind. Das Training nutzt die zeitlich passenden letzten 180 Tage plus Vorlauf; der Import hält dafür bis zu 240 Tage vor. **Der gesamte Trainingsordner bleibt privat**, einschließlich `private-references`, `model.json`, `result.json` und Input-Audit.

Alternativ lässt sich ein vorhandenes, mit dem aktuellen Code trainiertes Produktmodell exportieren: `--model-dir` verweist dann auf dessen privaten `runs/<model_version>`-Ordner. Der Export nimmt auch dort nur das gemeinsame Core-Modell.

## 2. Herausgeber: Schlüssel und freigegebenes Release erzeugen

Ein langlebiges Ed25519-Schlüsselpaar außerhalb des Repositories erzeugen:

```bash
node tools/forecast-product/starter_model.js keygen --out /sicherer/pfad/cet-model-signing
```

`private.pem` geheim halten und sichern. Nur `public.pem` an Nutzer beziehungsweise über einen vertrauenswürdigen Distributionskanal ausliefern. Keine privaten Schlüssel oder Referenzhistorien auf den Download-Server kopieren.

Nach Festlegung einer zur Veröffentlichung freigegebenen Lizenzkennung (beispielsweise einer SPDX-Kennung) diese in `MODEL_LICENSE` setzen. Der Export setzt keine Lizenz automatisch:

```bash
node tools/forecast-product/starter_model.js export \
  --model-dir tmp/profile/public_starter_training_20260927_v1 \
  --release 2024q4-v1 --license "$MODEL_LICENSE" \
  --private-key /sicherer/pfad/cet-model-signing/private.pem \
  --out /freigabe/cet-starter-2024q4-v1.json
```

Das Ausgabeverzeichnis muss existieren; eine vorhandene Paketdatei wird nicht überschrieben. Die JSON-Ausgabe enthält die SHA-256-Prüfsumme des vollständigen signierten Pakets. Vor Veröffentlichung lokal prüfen:

```bash
node tools/forecast-product/starter_model.js verify \
  --package /freigabe/cet-starter-2024q4-v1.json \
  --public-key /sicherer/pfad/cet-model-signing/public.pem \
  --sha256 '<SHA256-AUS-DEM-EXPORT>'
```

Nur die einzelne geprüfte Paketdatei veröffentlichen, unter einer unveränderlichen HTTPS-Release-URL. Öffentlichen Schlüssel und Prüfsumme unabhängig vertrauenswürdig verteilen. URL, Lizenz und Produktionssignierschlüssel werden nicht vom Werkzeug ausgewählt oder automatisch veröffentlicht.

## 3. Neue CET-Instanz: automatischen Erstbezug konfigurieren

Forecast-Python-Abhängigkeiten installieren, öffentlichen Herausgeberschlüssel lokal bereitstellen und in der Service-Konfiguration beziehungsweise `.env` setzen:

```dotenv
FORECAST_STARTER_AUTO_DOWNLOAD=true
FORECAST_STARTER_URL=https://models.example.org/cet-starter-2024q4-v1.json
FORECAST_STARTER_SHA256=<SHA256-AUS-DEM-EXPORT>
FORECAST_STARTER_PUBLIC_KEY_FILE=/etc/cet/cet-model-public.pem
```

Die URL ist ein Platzhalter. Solange kein vertrauenswürdiges Release festgelegt ist, bleibt `FORECAST_STARTER_AUTO_DOWNLOAD=false`. Ein privater Signierschlüssel ist auf der Zielinstanz nicht erforderlich.

Beim Start von `forecast-sandbox` gilt:

1. Ein vorhandenes gültiges Startmodell oder ein lokales gemeinsames Modell desselben Engine-Stands bleibt erhalten; kein Download und kein automatisches Update.
2. Andernfalls wird das konfigurierte Paket über HTTPS geladen (maximal 64 MiB, maximal drei HTTPS-Weiterleitungen, 30 Sekunden Download-Zeitlimit). Es werden keine CET-Tokens, Tenant-IDs oder Messdaten mitgesendet.
3. SHA-256, Ed25519-Signatur, Format und Engine werden geprüft. Anschließend prüft Python Bibliotheksversionen, Feature-Vertrag, Gewichte und Ladefähigkeit.
4. Das vollständig geprüfte Modell wird unter `<runtime>/_starter-baseline/versions/<version>` abgelegt und über einen exklusiv angelegten `current.json`-Zeiger aktiviert. Ein Installations-Lock verhindert parallele Installationen. Bestehende Modelle werden nicht ersetzt.

Bei Download-/Prüffehlern protokolliert CET eine Warnung und startet weiter. Training mit eigenen Historien bleibt ohne öffentliches Startmodell möglich. Ein beschädigtes bereits installiertes Startmodell wird nicht stillschweigend verwendet oder überschrieben; Betreiber müssen es prüfen. Nach einem Prozessabsturz können `.install-*`, eine verwaiste Version oder `install.lock` verbleiben. Erst sicherstellen, dass keine Installation läuft, dann den unvollständigen Installationsstand untersuchen/bereinigen.

## 4. Offline-Installation

```bash
node tools/forecast-product/starter_model.js install \
  --package /transfer/cet-starter-2024q4-v1.json \
  --public-key /etc/cet/cet-model-public.pem \
  --sha256 '<SHA256-AUS-DEM-EXPORT>' \
  --runtime /srv/cet-data/forecast-runtime
```

Danach CET mit demselben `FORECAST_PORTFOLIO_RUNTIME_PATH` betreiben. Auch der private administrative Instanztransfer übernimmt installierte Startmodelle einschließlich Signatur und öffentlichem Vertrauensschlüssel. Ein Runtime-Speicher, der bisher nur ein öffentliches Startmodell enthält, kann ebenfalls übertragen werden.

## Betrieb und Grenzen

- V1 unterstützt ein aktives öffentliches Core-Modell je Instanz und exakt passende Einheit/Zeitzone. Kein automatischer Versionswechsel, kein Download pro Zähler.
- Neue Zähler werden wie bisher per `enroll_meter.py` aufgenommen und per `predict_meter.py` beziehungsweise REST prognostiziert. Ein Download allein ersetzt weder Zählerregistrierung noch Historie.
- Code- und Dependency-Prüfungen sind streng. Die Einführung dieser Modelllogik ändert den Engine-Fingerprint: ältere private Modelle einmal neu trainieren; ältere Pakete benötigen einen neuen Export aus aktuellem Training. Vorhandene Dateien werden nicht migriert oder gelöscht.
- Ein Startmodell aus 2024 kann bei einem aktuellen Zähler als Kandidat helfen. Es macht veraltete private Messdaten nicht aktuell und begründet keinen pauschalen Qualitätsvorsprung.

## Tests

```bash
PYTHONPATH=tools/forecast-portfolio:tools/forecast-product \
  .venv-forecast/bin/python -m unittest tools/forecast-portfolio/test_starter.py -v
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --coverage=false \
  --testTimeout=30000 tests/forecast-starter.test.js
node tools/forecast-product/starter_uat.js
```

Der isolierte HTTP-Test verwendet einen simulierten HTTPS-Download, aber echte Signaturen, native Modelle, Service-Initialisierung, REST-Training und REST-Prognosen. Er prüft außerdem Tenant-Isolation, die Weitergabe des Startmodells im administrativen Transfer und den ausbleibenden zweiten Download. Er greift auf keine laufende PM2-Instanz zu.

## Implementierungsprüfung vom 2026-09-27

45 unterschiedliche Python-/JavaScript-Tests bestanden (24 Python, 21 JavaScript), zusätzlich
isolierter REST-End-to-End-Test erfolgreich. Dessen lokales Protokoll liegt unter
`/tmp/forecast-starter-http-BUKCnf/report.json` (temporäres Entwicklungsartefakt).
ESLint ohne Befund, OpenAPI-Audit ohne Fehler (420 bestehende Warnungen), `llm.txt` aktuell.

Der private Trainingsstand aus allen elf XLSX-Dateien wurde tatsächlich erstellt:
`tmp/profile/public_starter_training_20260927_v1`. Core-Exportierbarkeit und aktueller
Engine-Fingerprint sind geprüft. Kein öffentliches Release wurde signiert oder hochgeladen;
URL, freigegebene Modelllizenz und Produktionssignierschlüssel sind noch festzulegen.

## Saisonales Basistraining

Für den erweiterten Bestand ersetzt `train_prepared.py --mode baseline` das alleinige
Bewerten neuerer Zähler durch eine saisonale Prüfung des gemeinsamen Core-Modells auf allen
Reihen. Historien, Stichprobengewichte und zurückgehaltene Fenster werden dokumentiert.
Der öffentliche Export prüft den gebundenen Qualitätsbericht und übernimmt nur aggregierte
Güteangaben. Details: [Basismodell-Qualität](forecast-baseline-quality.md).
