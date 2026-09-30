# RMSE-Fensterwahl und Aktivitäts-/Verbrauchsmodell

Die optionale Politik `selection_policy: "adaptive_rmse_v1"` erweitert die bisherige
Sandbox, ohne alte Modellartefakte oder explizite Alt-Konfigurationen umzudeuten.
`selection_metric: "rmse"` ist verbindlich. MAE als gleichzeitige Auswahlvorgabe wird
abgelehnt. Die kombinierte persistierbare Version heißt `relationship_state_adaptive_v5`.

## Historienfenster

Die innere zeitlich geordnete Auswahl prüft 28, 84, 365 Tage und die gesamte
zulässige Historie. Historie endet weiterhin bei D−2. Wie bisher: 42 Discovery-Tage,
danach 28 separate Bestätigungstage in Wochenblöcken; Auswahl alle 28 Tage,
operatives Nachfitten täglich. Ein Kandidat benötigt mindestens 3 % RMSE-Gewinn,
mindestens 75 % gewonnene Wochenblöcke und eine positive untere Bootstrap-Grenze.
MAE darf in der Bestätigung höchstens 2 % steigen. Zusätzliche Kalender-/Wetter-
und Marktmerkmale behalten ihre bedingten Prüfungen.

Die innere Grundauswahl verwendet weiterhin ein eingefrorenes Modell je Wochenfold.
Sie verwendet keine späteren Istwerte, bildet aber tägliches Nachfitten innerhalb
der Woche noch nicht vollständig ab. Eine Umstellung der inneren Refit-Frequenz ist
kein Bestandteil dieses Experiments und sollte separat verglichen werden.

## Echte zweistufige Aktivitätsprognose

`activity_model: true` prüft zusätzlich einen Kandidaten bei nichtnegativer Historie
mit mindestens 20 % expliziten Nullwerten. Die Trainingslabels entstehen aus den
historischen Werten: aktiv = Wert > 0. Fehlende Werte sind keine inaktiven Zustände.

1. Die Wahrscheinlichkeit für Aktivität wird aus Wochenende, Sechsstundenblock,
   Aktivität desselben Viertelstundenslots an D−2/D−7 und Aktivitätsanteil von D−2
   geschätzt. Der Tagesanteil wird mit festen Grenzen 25/75 % in drei Zustände geteilt.
   Die bedingten Häufigkeiten werden mit 24 Pseudobeobachtungen zum jeweiligen
   Kalender-/Zeitblock-Mittel stabilisiert.
2. Die positive Verbrauchshöhe wird separat nach Viertelstunde und Wochentag aus
   ausschließlich positiven Werten gelernt und mit acht Pseudobeobachtungen zum
   positiven Slotmittel stabilisiert.
3. Die Basispunktprognose ist Wahrscheinlichkeit × positive Verbrauchshöhe.
   Unterschiedliche Merkmalsgruppen der beiden Stufen vermeiden die bloße
   algebraische Wiederholung desselben Gruppenmittelwerts. Die vorhandene
   Zustandskorrektur kann die Basis nur nach ihrer eigenen Bestätigung verändern.

Auch beim Trainieren erhält jeder historische Zielwert nur Lag-Merkmale, die zu
seinem damaligen Ausgabezeitpunkt verfügbar waren. Späte Daten und fehlende
DST-Slots erhalten den Zustand unbekannt. Gespeichert werden beide gelernten
Tabellen, Regularisierung und Modellversion. Der vorhandene Zählerkontext enthält
die letzten Tage; `recent_dataset` aktualisiert diesen für echte Folgetagsprognosen.
Die Parameter bleiben bis zum nächsten Training unverändert. Der API-Output
`activity_model` enthält Wahrscheinlichkeit, positive Verbrauchshöhe, deren Produkt
vor einer optionalen Zustandskorrektur und die verwendeten historischen Lag-Tage.

Aktivitätskandidaten konkurrieren auf denselben Historienfenstern, werden im
Discovery-Abschnitt gewählt und separat gegen die bestätigte Referenz geprüft.
RMSE-Grenzen und MAE-Schutz gelten auch hier. Ohne Bestätigung bleibt die Referenz.
Aktivität beschreibt einen Messwert, keine erkannte Maschine oder gesicherte Ursache.

## Aufruf mit dem eigenständigen Testscript

```bash
python3 tmp/profile/xlsx_forecast_test.py \
  --xlsx 'tmp/profile/*_20*.xlsx' \
  --base-url http://localhost:3900 \
  --from 2024-01-01 --until 2024-12-31 \
  --config tmp/profile/adaptive-activity.json \
  --out tmp/profile/mein-adaptiver-test
```

Konfiguration für die Fensterwahl ohne Aktivitätskandidaten:

```json
{
  "model_family": "learned_states",
  "extended_features": true,
  "selection_metric": "rmse",
  "selection_policy": "adaptive_rmse_v1",
  "activity_model": false
}
```

Für den Aktivitätstest `activity_model` auf `true` setzen. Die Standardkonfiguration
des bisherigen Scripts bleibt unverändert, solange keine solche Datei angegeben wird.

## Marktpreise aktivieren

Auf dieser Dev-Instanz liegt eine direkt nutzbare Konfiguration unter
`tmp/profile/market-config.json`. Sie aktiviert das Angebot der Markt-/Netzmerkmale,
noch nicht deren automatische Übernahme in jedes Zählermodell:

```bash
python3 tmp/profile/xlsx_forecast_test.py \
  --xlsx tmp/profile/8_2020-2024.xlsx \
  --config tmp/profile/market-config.json \
  --base-url http://localhost:3900 \
  --out tmp/profile/markt-test
```

`feature_set` muss `context` enthalten, `context_dataset_id` muss auf einen
vorbereiteten serverseitigen Datensatz verweisen, Ausgabezeit ist `18:00` am Vortag.
Der Kontext bietet **Day-Ahead-Preis und D−2-Netzlast** gemeinsam als Kandidaten an.
Ein Preismerkmal ist erst tatsächlich genutzt, wenn es in `selected_predictors`
als `day_ahead_price` erscheint. Wetter wird dadurch nicht aktiviert.

Auf einer anderen Instanz zuerst historische Kontextdaten über die API vorbereiten:

```bash
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -d '{"from":"2020-01-01","until":"2024-12-31"}' \
  http://localhost:3900/api/forecast-sandbox/consumption/features/context/prepare
```

Die zurückgegebene `context_dataset_id` in der Konfiguration verwenden. Falls
Authentifizierung aktiviert ist, zusätzlich den passenden Bearer-Header setzen.
Historische SMARD-Publikationszeiten/Revisionsstände sind teilweise rekonstruierte
Annahmen; siehe [Merkmals-Runbook](forecast-context-features.md).
`tmp/profile/adaptive-activity-market.json` kombiniert auf dieser Instanz die neue
Politik und den Aktivitätskandidaten mit dem vorbereiteten Markt-/Netzkontext.

## Prüfprotokoll

Der vorab festgelegte API-Entwicklungsvergleich verwendet alle elf unveränderten
Original-XLSX, vollständige verfügbare Trainingshistorie und den Prüfzeitraum
01.–28.11.2024. Drei getrennte Läufe: bisherige Politik, RMSE/Fensterwahl,
RMSE/Fensterwahl plus Aktivitätskandidat. Wetter/Markt bleiben für diese Ablation aus.
Datei-Hashes und Quellstände: `tmp/profile/adaptive-test-protocol.json`.
Es handelt sich um bekannte Entwicklungsprofile und 28 Tage, nicht um einen
vollständigen Jahresvergleich oder eine unabhängige Leistungsbestätigung.

## Schutz des bisherigen Modells

Der erste Kandidatenversuch wurde nach einer Regression verworfen: Eine nicht
bestätigte Verkürzung auf 365 Tage verwarf bei Profil 10 zugleich das brauchbare
Monatsmodell und fiel auf den einfachen Gesamtmittelwert zurück. Das betrifft die
allgemeine Alles-oder-nichts-Rückfalllogik, nicht eine Sonderregel für diesen Zähler.

Die neue `adaptive_reference_guard_v1` vergleicht den bestätigten Challenger deshalb
zusätzlich mit der **bisherigen automatischen Politik** auf identischen historischen
Bestätigungswochen. Übernahme nur bei ≥3 % RMSE-Gewinn, ≥75 % gewonnenen Wochen,
positiver unterer Bootstrap-Grenze und höchstens 2 % MAE-Anstieg. Ohne diesen Nachweis
bleibt die bisherige Prognose erhalten. Das gilt auch für Aktivitätskandidaten und
fehlende externe Zielmerkmale. Die MAE-Auswahl des geschützten Altmodells bleibt
als Comparator bestehen; neue Challenger und Übernahme werden nach RMSE bewertet.
Die vollständige Entscheidung steht in `reference_selection.adaptive_guard`.
