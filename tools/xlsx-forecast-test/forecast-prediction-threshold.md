# 50-W-Schwellwert für Prognosen

Die Option `configuration.prediction_threshold_w` setzt Prognosen unterhalb einer
festen Leistungsgrenze auf null. Beispiel:

```json
{"prediction_threshold_w": 50}
```

50 W entsprechen **0,05 kW** oder **0,0125 kWh je Viertelstunde**. Es gilt strikt
`abs(raw_prediction) < threshold`: Genau 50 W bleiben unverändert. Der Filter ist
betragsbezogen; auch negative Prognosewerte werden entsprechend behandelt.
Die bestehenden Modellanforderungen an zulässige Verbrauchs-/Erzeugungsdaten
werden dadurch nicht erweitert. Ein fehlender Wert oder 0 deaktiviert den Filter;
andere bereits vorhandene Konfigurationen behalten ihr Verhalten.

Der Filter wird **nach** der Modellberechnung angewendet. Historie, Istwerte,
Aktivitätslabels und die Modell-/Featureauswahl werden nicht verändert. Er ist
keine zeitliche Glättung (kein Low-Pass-Filter). Er verbessert nicht zwangsläufig
RMSE oder WAPE und wird nicht anhand der Prüfdaten optimiert.

Bei aktivem Filter enthalten Forecast-Zeilen:

- `raw_predicted_value`: unveränderte Modellprognose.
- `predicted_value`: ausgegebene, gefilterte Prognose.
- `prediction_zeroed`: ob ein zuvor von null verschiedener Wert auf null gesetzt wurde.

`forecast_run.prediction_threshold_w` dokumentiert die Grenze. Kurven, Tagesfehler,
Backtest, Abweichungsenergie und schlechteste Tage beziehen sich auf die endgültige
Prognose. `filter_evaluation` dokumentiert die Anzahl geänderter Intervalle und die
Backtests vor/nach Filterung gegen dieselben unveränderten Istwerte.

Die Grenze wird im `feature_configuration` des individuellen State-Modellartefakts
gespeichert. `state-model/predict` verwendet sie nach dem Laden automatisch. Sie
ist beim Training festzulegen; Wetter-/Kontext-Refresh bei der Vorhersage ändert sie
nicht. Alte Artefakte ohne Grenze bleiben ungefiltert.

## XLSX/API-Qualitätstest ab Client 3.1

`tmp/profile/configuration.all-features.json` aktiviert 50 W. Der bisherige Aufruf
bleibt gültig; für jeden Lauf einen neuen `--out`-Ordner verwenden.

Die Haupttabelle und Ampel beziehen sich auf die gefilterte Prognose. Eine zusätzliche
Vergleichstabelle zeigt je XLSX RMSE, MAE und WAPE **roh und gefiltert**, Grenze in W
sowie Anzahl der auf null gesetzten Intervalle. Bei ausschließlich Null-Istwerten
bleibt WAPE undefiniert. Auch Verschlechterungen bleiben sichtbar.

Der Client prüft die Filterabbildung, API-Grenze und Intervallanzahl unabhängig und
berechnet beide Metriksätze aus den archivierten Prognosewerten und originalen XLSX
nach. Eine alte API, welche die angeforderte Grenze ignoriert, führt zum Testfehler.
Es werden keine kleinen Istwerte aus der Bewertung entfernt oder auf null gesetzt.
Die komplette Konfiguration wird mit dem Report archiviert; Replay bleibt möglich.
