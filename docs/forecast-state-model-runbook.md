# Gelernte Lastzustände: API-Runbook und Modellvertrag

Implementiert als optionale Familie `learned_states`, Version `relationship_state_correction_v2`.
Neue Trainingsläufe verwenden die kombinierte Variante; gespeicherte v1-Artefakte
bleiben unverändert lesbar.
Ohne zusätzliche Merkmale bleibt diese Variante rein historien-/kalenderbasiert.
Mit optionalen Standort-/Marktdaten, Jahreszeit oder Ausgabezeit 18 Uhr wird
`relationship_state_context_guard_v4` verwendet; siehe [erweiterte Merkmale](forecast-context-features.md).
Das bisherige automatische Modell bleibt der Standard.
Die neuen Endpunkte stehen in `/api/forecast-sandbox/openapi.json`.

## Historischer Qualitätsvergleich

```bash
python3 tools/forecast-quality/run.py --data-dir tmp/profile \
  --base-url http://localhost:3900 --out /pfad/neuer-referenzlauf

# candidate.json: {"model_family":"learned_states"}
python3 tools/forecast-quality/run.py --data-dir tmp/profile \
  --base-url http://localhost:3900 --candidate-config candidate.json \
  --out /pfad/neuer-zustandslauf

python3 tools/forecast-quality/compare_states.py \
  --candidate /pfad/neuer-zustandslauf --reference /pfad/neuer-referenzlauf \
  --out /pfad/neuer-vergleich
```

Die Voraussetzungen des eigenständigen Testpakets gelten weiterhin. Vergleich nur
für vollständige Läufe mit identischen Eingaben, Istwerten, Zeitstempeln und
Prognosezeitpunkten. Rohantworten werden anhand ihrer SHA-256-Hashes geprüft.
Der Vergleich berechnet die Metriken unabhängig aus den einzelnen API-Prognosen.

Drei Referenzen bleiben sichtbar: bisheriges automatisches Modell, dieselbe automatische
Basisprognose ohne Zustandskorrektur und ursprüngliche reine Historienbaseline.
Die Rohvorhersage des Zustandskandidaten wird zusätzlich diagnostisch gespeichert;
sie darf nicht nachträglich zur Auswahl anhand des Prüfjahres verwendet werden.

## Persistiertes Modell trainieren

`POST /api/forecast-sandbox/consumption/state-model/train`

```json
{
  "dataset": {
    "series_id": "meter-1",
    "unit": "kWh",
    "timezone": "Europe/Berlin",
    "period_from": "2020-01-01",
    "period_until": "2024-12-31",
    "values": [{"timestamp":"2020-01-01T00:00:00+01:00","value":0.12}]
  },
  "forecast_for": "2025-01-02"
}
```

Das Beispiel zeigt das Schema; tatsächlich sind mindestens 14 vollständige,
zulässige Tage zu übergeben, höchstens 220.000 Intervalle. Für die Aktivierung der
Zustandsmerkmale benötigt die zeitliche Validierung mehr Historie (mindestens
84 Trainingstage vor den vier Prüfwoche-Folds). Bei zu wenig Evidenz wird das
automatische Referenzmodell gespeichert. Für einen Modellvergleich darf ein solches
Zurückfallen nicht als bestätigter Zustandsnutzen ausgegeben werden.

Die API filtert Messwerte auf D−2 und tatsächliches `available_at`. `forecast_for`
bestimmt den simulierten Wissensstand D−1 um lokale Mitternacht; optional
setzt `configuration.issue_time: "18:00"` ihn auf 18 Uhr. D−2 für Messwerte bleibt bestehen. Ein noch in der
Zukunft liegender Wissensstand wird abgelehnt. Die persistenten Endpunkte erlauben
auch Prognosetage nach 2025; der historische Evaluierungsendpunkt behält seine
2020–2025-Grenze.

Die Antwort enthält `artifact_version`, `model_version`, `training_data_until`,
`state_features_enabled`, Zustandsdefinitionen, Validierung und `next_refit_date`.
Die vollständigen Modellparameter liegen dauerhaft auf dem Server. Auch ein
historischer Evaluierungslauf mit `learned_states` speichert seinen letzten
Modell-/Kontextstand und liefert `state_model_artifact` zurück.

## Modell prüfen und für morgen verwenden

`POST /api/forecast-sandbox/consumption/state-model/inspect`

```json
{"series_id":"meter-1","artifact_version":"<64-stelliger Hash aus train>"}
```

`POST /api/forecast-sandbox/consumption/state-model/predict`

```json
{
  "series_id":"meter-1",
  "artifact_version":"<64-stelliger Hash aus train>",
  "forecast_for":"2025-01-02"
}
```

`predict` lädt Skalierung, Cluster, Zustandsübergänge, Verbrauchsprofile,
die gespeicherte automatische Saison-/Aktualitätsreferenz,
Validierungsentscheidung und historischen Kontext; es trainiert nicht erneut.
Die Ausgabe enthält 96 bzw. an DST-Tagen 92/100 Viertelstunden, Wahrscheinlichkeiten
und Herkunft der verwendeten verzögerten Zustände. `training_data_until` beschreibt
konservativ den verwendeten Datenstand einschließlich Zustandskontext;
`model_training_data_until` separat den jüngsten Stand des Parametertrainings.
`state_training_data_until` und `reference_training_data_until` trennen die beiden
Modellkomponenten.

Neue Istwerte können als `recent_dataset` im identischen Datenschema mitgegeben
werden. Nur vollständige, rechtzeitig bekannte Tage aktualisieren den Kontext.
Dadurch entsteht eine neue unveränderliche `artifact_version`; die trainierten
Parameter bleiben unverändert. Für den nächsten Aufruf diese neue Version verwenden.
Ohne neue Istwerte bleibt die API nutzbar, meldet aber fehlenden Zustandskontext
und fällt bei fehlenden Lag-Zuständen auf gelernte Zustandsprioren zurück.

Die automatische Basis wird bei der Evaluation täglich neu angepasst. Persistiertes
`predict` verwendet dagegen die gespeicherten Parameter: An späteren Prognosetagen
meldet es `reference_refit_recommended`. Für dieselbe Aktualität wie im Backtest
ist `train` täglich mit der verfügbaren Historie aufzurufen. Dabei wird auch die
Zustandsauswahl erneut geprüft; die explizite Train-API verwaltet keinen laufenden
28-Tage-Trainingszyklus.

Ab `next_refit_date` meldet sie außerdem `model_refit_due`. Ein erneutes Training mit der
Historie ist dann ausdrücklich aufzurufen. Es gibt in dieser Erweiterung keinen
Scheduler und keinen versteckten Neutrainingsauftrag. Ein veraltetes Modell wird
nicht als frisch trainiert dargestellt.

## Was genau gelernt wird

Aus vollständigen lokalen Tagen werden drei deskriptive Merkmale gebildet:
Logarithmus des mittleren Verbrauchs (`log1p`), Anteil positiver Messintervalle,
Verbrauchsanteil zwischen 08:00 und 20:00 Uhr. Standardisierung und deterministisches
K-Means mit drei Zentren werden ausschließlich auf zulässigen Trainingstagen
angepasst. Zentren sind nach Verbrauchsniveau geordnet und gemeinsam mit der
Skalierung versioniert. Die drei Zustände können bei konstanten Reihen zusammenfallen;
sie sind keine extern bestätigten Betriebszustände.

Trainiert werden Zustandswahrscheinlichkeiten abhängig vom Wochentag und vom
bekannten Zustand an D−2 bzw. D−7. Übergangshäufigkeiten werden mit einer Priorstärke
von 14 Tagen stabilisiert. Die beiden verfügbaren Verteilungen werden gemittelt;
fehlende Zustände werden nicht als Nullbetrieb kodiert. Die Zustandsprognose
ist das wahrscheinlichkeitsgewichtete Zustandsprofil, leicht zur Kalenderreferenz
regularisiert. Es gibt keine harte Aktivitätsschwelle.

Die endgültige Prognose ergänzt die bestehende automatische Modellauswahl:

```text
Prognose = max(0, automatische Basis + 0,5 × (Zustandsprognose − Zustands-Kalenderreferenz))
```

Die feste Gewichtung reduziert die Stärke des Zusatzsignals. Sie wurde vor dem
v2-Testlauf festgelegt. Monats-, Wochentags- und Aktualitätsauswahl bleiben erhalten;
es gibt keine meter-spezifischen Regeln aus den Gewinnern des Prüfjahres.
`selection_metric` und `recent_window_days` steuern weiterhin die Basisprognose.

Im Backtest werden die Zustandsparameter und deren Aktivierung alle 28 Tage neu
bestimmt. Basisprognose und bekannter Zustandskontext werden täglich aktualisiert.
Die innere Prüfung simuliert 28 vergangene Tagesprognosen: Skalierung, Cluster und
Übergänge werden vor dem gesamten Prüfblock trainiert; die Basis wird täglich nur
mit damals verfügbaren Werten angepasst. Auch die Auswahl ihrer Merkmale liegt
vor den jeweiligen Prüfwerten. Die vier Wochenblöcke erfordern mindestens 3 %
mittleren wöchentlichen RMSE-Gewinn, mindestens 75 % gewonnene Wochen, mindestens
90 % Istabdeckung je Woche und einen positiven unteren Rand des gepaarten
Wochenbootstrap-Intervalls. Zusätzlich darf der MAE höchstens 2 % schlechter sein.

Ohne ausreichenden Nutzen wird exakt die automatische Basisprognose ausgegeben.
Die Prüfung ist eine profilbezogene historische Auswahlregel, keine Garantie für
zukünftigen Nutzen. Eine zusätzliche externe Bestätigung ist keine Voraussetzung
für die Implementierung. Der standardisierte äußere Test dokumentiert weiterhin
den erreichten Entwicklungsstand. Die Familie bleibt über `learned_states`
explizit auswählbar; Wetter- und statische Prognosepfade bleiben separat.

## Verfügbarkeit, Sicherheit und Grenzen

- D−2 gilt sowohl für das äußere Training als auch für Zustandsmerkmale innerhalb
  historischer Trainingsbeispiele. Tage mit später Verfügbarkeit dürfen erst ab
  ihrem tatsächlichen Wissenszeitpunkt verwendet werden.
- Unvollständige Tage werden nicht gelabelt. Die übrige bisherige API-Validierung
  bleibt wirksam. Negative Verbräuche und externe Features werden für diese Familie
  abgelehnt. Fehlende Messungen werden nicht als null ergänzt.
- Wiederholte Herbstslots gehen mit ihrer tatsächlichen Anzahl in die Profile ein.
  Ihre physischen Viertelstundenwerte werden in der Hybridvalidierung einzeln
  bewertet. Fehlende Frühjahrsslots werden nicht erfunden.
- Speicherung unter `data/forecast-state-models`, alternativ `FORECAST_STATE_MODEL_DIR`.
  Verzeichnisse 0700, Dateien 0600; atomare, inhaltlich adressierte JSON-Versionen.
  Kein Python- oder Pickle-Modell wird ausgeführt. Hash und Modellversion werden
  beim Laden geprüft.
- Mandantentrennung erfolgt über die vertrauenswürdigen Gateway-Metadaten `tenantId`,
  nicht über ein Payload-Feld. Tokens ohne Mandant verwenden den gemeinsamen
  Sandbox-Namensraum. Explizite Versionen verhindern eine implizite Überschreibung
  durch konkurrierende Läufe. Aufbewahrung und Speicherbereinigung sind betrieblich
  zu regeln; das Modellarchiv ist kein verteilter Model-Registry-Dienst.
- Zur Reproduktion sind Servercode und Modellversion zusätzlich zum Testpaket zu
  fixieren. Die elf Reihen wurden bereits untersucht; dieser Vergleich liefert
  Entwicklungsevidenz und keine neue unabhängige Bestätigung.
- Sandbox-Nutzung ohne SLA oder zugesicherte Prognosegüte.
