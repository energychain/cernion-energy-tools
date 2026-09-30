# Sauberes Herausgeber-Basismodell: Zusammensetzung und direkte Prüfung

`train_prepared.py --mode baseline` trainiert ausschließlich das gemeinsame Core-Modell. Dieser Modus ist jetzt Standard. Es geht um die Trainingsgrundlage und die Plausibilität des gemeinsamen Modells, nicht um einen erneuten Vergleich mit E2 oder um die Auswahl lokaler Gewinner.

Der frühere Modus bleibt mit `--mode adaptation` ausdrücklich verfügbar. Er nutzt jüngere Zeitfenster, trainiert lokale Modelle und validiert nur die relativ zum Stichtag aktuellen eigenen Zähler. Seine bisherigen Kennzahlen sind daher kein Qualitätsnachweis für das Basismodell auf allen elf älteren XLSX-Reihen.

## Zusammensetzung des neuen Trainings

- Alle zulässigen Jahre der vorbereiteten Historien bleiben verfügbar, auch wenn einzelne Zähler früher enden. Es gibt im Basismodell-Modus keinen pauschalen 180-/240-Tage-Zuschnitt.
- Jeder Zähler trägt das gleiche Gesamtgewicht bei. Jahresdateien sind weiterhin eine zusammengeführte Serie; Messrichtungen bleiben in getrennten Läufen.
- Innerhalb eines Zählers werden vorhandene meteorologische Jahreszeiten gleich gewichtet: Winter (Dezember–Februar), Frühling, Sommer und Herbst. Innerhalb einer Jahreszeit erhalten die verfügbaren Kalenderjahre gleiches Gewicht.
- Pro Zähler werden höchstens 4.096 Trainingsbeispiele deterministisch gezogen. Die Auswahl ist innerhalb eines Jahr-/Saisonabschnitts zufällig mit festem Seed, unabhängig von den Zielwerten. Quellen mit mehr Jahren oder größeren Verbräuchen dominieren das Trainingsziel dadurch nicht automatisch.
- Die Menge wird je Zähler anhand seiner vor dem jeweiligen Trainingsursprung bekannten Werte normalisiert. Fehlende Lag-Werte bleiben NaN; echte Nullwerte bleiben echte Nullen. Optionale Profillabels/Blindleistung gehen nicht in das öffentliche Core-Modell ein.
- Mindestens 28 beobachtete Trainingstage und 672 kausal nutzbare Beispiele je finalem Beitragszähler sind erforderlich. Kürzere Reihen werden nicht stillschweigend verworfen.

„Alle Jahre verfügbar“ bedeutet keine Verwendung sämtlicher Viertelstunden als Trainingszeilen. Rohhistorie, verfügbare Jahr-/Saisonmengen, tatsächlich gewählte Stichproben, Skalierung, Gewichte und Hashes der ausgewählten Zeitstempel werden separat dokumentiert. Sehr alte Muster werden in V1 nicht zusätzlich nach Aktualität gewichtet; Drift muss im Bericht beurteilt werden.

## Prüfung des gemeinsamen Modells selbst

Für jeden Zähler wird je Jahreszeit das jüngste geeignete feste 14-Tage-Fenster ab 15. Januar, April, Juli beziehungsweise Oktober gewählt. Die Auswahl richtet sich ausschließlich nach Zeitlage und Datenabdeckung, nicht nach erzielten Fehlern. Ein Fenster benötigt mindestens 95 % Istwertabdeckung und ausreichend vorgelagerte Historie. Fehlende saisonale Fenster werden ausdrücklich ausgewiesen.

Für jeden unterschiedlichen Fensterbeginn wird ein eigenes gemeinsames Modell mit derselben Trainingsprozedur aufgebaut:

1. Globaler Informationsstand: 07:00 Uhr am Vortag des Fensterbeginns, Messdaten höchstens bis D−3. Diese Grenze gilt für **alle** eingebrachten Zähler.
2. Skalierung und saisonale Stichproben stammen ausschließlich aus dem zu diesem Zeitpunkt bekannten Trainingsteil.
3. Modellgewichte bleiben für das gesamte Prüfzeitfenster eingefroren. Messwerte aus bereits vergangenen Prüftagen dürfen später als D−3-konforme Lag-Merkmale einfließen.
4. Es wird ausschließlich die Prognose dieses gemeinsamen Modells bewertet. Keine lokalen Modelle, kein Wochenreferenz-Gewinner und keine nachträgliche Modellauswahl verdecken Schwächen.

Berichtet werden je Zähler und Jahreszeit MAE, RMSE, WAPE, Bias, Abdeckung sowie `N`, `Σ|Ist|`, `Σ|Fehler|` und `ΣFehler²`. Zusätzlich gibt es Fehler während gemessener Nullphasen, aktiver Intervalle und bei Werten oberhalb des ausschließlich im Training bestimmten 95-%-Quantils. WAPE bei Nullsumme bleibt undefiniert. Fehlende Features werden gezählt und senken die Prüfdeckung; sie werden nicht unbemerkt aus der Güteaussage entfernt.

Die zusammenfassende normalisierte MAE gewichtet Zähler gleich und innerhalb eines Zählers die verfügbaren saisonalen Fenster gleich. Jede Fenster-MAE wird mit der nur aus ihrem jeweiligen Trainingsteil gewonnenen Skalierung normalisiert.

Nach dieser Prüfung wird das finale gemeinsame Modell mit sämtlichen am finalen Stichtag zulässigen Daten nach derselben saisonalen Gewichtung neu trainiert. Die Prüfmetriken beschreiben die Trainingsprozedur an früheren Ursprüngen, nicht einen unabhängigen zukünftigen Test der zuletzt neu angepassten Gewichte. Dies ist auch kein Nachweis für bisher unbekannte Zähler.

## Datenqualitäts- und Abdeckungsbericht

`quality-report.json` dokumentiert:

- vollständige Zeitbereiche und Anzahl Messwerte je Jahr/Jahreszeit;
- Nullanteile, erhaltene Lücken, annähernd konstante Reihen und angenommene Messrichtungen;
- identische Historien unter verschiedenen Zählerkennungen als zu klärenden Befund;
- anhand der Quelldateinamen erkennbare Aggregation mit ungeklärter Zugehörigkeit;
- fehlende Prüffenster und explizite Prüfergebnisse zur Abdeckung;
- tatsächliche finale Gewichte und Beiträge aller Zähler.

Die Mietobjekt-Reihe mit 160/164 W bleibt als auffällig konstant gekennzeichnet. Ihre Messwertherkunft und die Abhängigkeit zwischen GWR29 und der Aggregation sind weiterhin fachlich zu klären. Diese Informationen lassen sich nicht aus Zahlenwerten zuverlässig ableiten. Die Prüfung behauptet daher keine automatische fachliche Freigabe; `review_required` bleibt wahr.

## Ausführung

```bash
.venv-forecast/bin/python tools/forecast-product/train_prepared.py \
  --mode baseline \
  --prepared tmp/profile/basis_training_prepared_20260927_v1/manifest.json \
  --out tmp/profile/basis_training_models_20260927_v2
```

Der Ausgabeordner muss neu sein. Beide Messrichtungen werden nacheinander verarbeitet. Mit `--check-only` werden Daten, geplante Prüffenster und finale kausale Stichproben/Gewichte ohne Modellfit geprüft. Dies ersetzt nicht die anschließend nötige tatsächliche Validierung. Für den alten Ablauf `--mode adaptation` setzen.

Pro Richtung entstehen:

- `report.md`: lesbarer Überblick und Ergebnisse für alle Zähler;
- `quality-report.json`: detaillierte Zusammensetzung und Qualitätsprüfung;
- `folds/<Datum>.json`: Trainingsteil, Ausschlüsse und Metriken des jeweiligen gemeinsamen Validierungsmodells;
- `validation-predictions/*.json.gz`: tatsächliche und vorhergesagte Viertelstundenwerte für nachvollziehbare Metrikberechnung;
- `baseline.cbm` beziehungsweise ein konstantes Modell im Manifest, `model.json`, `result.json` und `training-scope.json`.

Es werden keine REST-Aufrufe benötigt, keine Daten hochgeladen und keine Modelle in der laufenden Instanz aktiviert. Der Live-Engine-Code und sein Fingerprint bleiben durch diesen zusätzlichen Offline-Modus unverändert. Die Herausgeber-Prozedur bekommt einen eigenen Versionsnamen und Quellcode-Hash.

## Öffentlicher Export

Beim Export eines saisonal trainierten Bezugs-Basismodells prüft `starter_model.js` den im Modellmanifest festgehaltenen Hash des Qualitätsberichts. Mindestens ein ausreichend abgedecktes Prüffenster muss für jeden Zähler vorliegen; doppelte Historien unter verschiedenen IDs blockieren den Standardexport bis zur Klärung. Die Vollständigkeit aller vier Jahreszeiten wird separat im signierten Paket ausgewiesen. Fachliche Freigabe und Modelllizenz bleiben Voraussetzung für eine Veröffentlichung.

Ins öffentliche Paket gelangen ausschließlich aggregierte Qualitätsangaben, keine Messstellenkennungen oder Einzelprognosen. Der signierte Qualitätswert stammt aus der direkten Basismodellprüfung mit den jeweiligen Trainingsskalierungen. Einspeisemodelle werden weiterhin nicht als öffentlicher Verbrauchs-Starter veröffentlicht.

## Tests

```bash
PYTHONPATH=tools/forecast-product:tools/forecast-portfolio \
  .venv-forecast/bin/python -m unittest tools/forecast-product/test_baseline_training.py -v
```

Die Tests prüfen gleiche Zähler-/Saison-/Jahresgewichte, erhaltene ältere Daten, unveränderte Trainingsfeatures trotz manipulierten späteren Werten, D−3-Grenzen, Metrikidentitäten, fehlende saisonale Abdeckung sowie einen echten nativen Trainings-/Exportablauf mit manipulationsgeschütztem Qualitätsbericht.

## Durchgeführt am 2026-09-27

Der vollständige neue Lauf liegt unter `tmp/profile/basis_training_models_20260927_v2`.
Beide Richtungen sind abgeschlossen. 15 Bezugs-/Lastzähler wurden in 60 saisonalen Fenstern
(80.700 Viertelstunden) geprüft, zwei Einspeisezähler in acht Fenstern (10.760 Viertelstunden).
Alle vier Jahreszeiten pro Zähler sind vertreten. Die finalen Zählergewichte sind exakt
1/15 beziehungsweise 1/2; jede Jahreszeit trägt pro Zähler ein Viertel bei.

Die Metriken wurden unabhängig aus den gespeicherten Ist-/Prognosewerten nachgerechnet,
ebenso die globalen D−3-/Verfügbarkeitsgrenzen und Gewichte. `verification.json` im Laufordner
bestätigt diese Checks. 19 unterschiedliche automatisierte Tests bestanden; ESLint der
geänderten JS-CLI und `git diff --check` ohne Befund.

Die strukturellen Prüfungen sind bestanden, die fachliche Freigabe bleibt offen: Bei den
ursprünglichen Reihen 1 und 3 sowie der Einspeisung 62293978 übersteigt der WAPE 100 %.
Das wird ausdrücklich als Schwäche des gemeinsamen Modells ausgewiesen. Die Herkunft der
konstanten Mietobjektreihe und die Aggregationszugehörigkeit sind weiterhin zu klären.
Keine Modelle wurden veröffentlicht oder in einer laufenden CET-Instanz ersetzt.
