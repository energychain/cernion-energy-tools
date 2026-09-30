# Ergebnis: RMSE-Fensterwahl und Aktivitäts-/Verbrauchsmodell

API-Entwicklungsvergleich auf allen elf Original-XLSX, 01.–28.11.2024, mit D−2 und identischem Ausgabezeitpunkt. Drei vollständige Läufe; Prognosen und Istwerte gepaart, HTTP-Hashes geprüft und RMSE/MAE unabhängig nachgerechnet.

| Vergleich | Ergebnis |
|---|---|
| Neue Fensterwahl gegenüber bisheriger Politik | Mittlerer relativer RMSE-Gewinn 0,806 % |
| Profil 8 | RMSE 0,740659 → 0,646783 kWh; Verbesserung 12,675 % |
| Profil 11 | RMSE 4,263285 → 4,425648 kWh; Verschlechterung 3,808 % |
| Weitere neun Profile | Unverändert |
| Aktivitätskandidat zusätzlich | Kein übernommener Aktivitätskandidat; keine zusätzlichen Änderungen |

## Fachliche Schlussfolgerung

Die Fensterwahl kann helfen, verbessert aber nicht jede Reihe. Der neue Aktivitäts-/Verbrauchsansatz hat die vollständigen historischen Übernahmeprüfungen bei keiner Reihe bestanden. Bei Profil 10 schlug er zwar die einfache Kandidatenreferenz, nicht aber stabil das bereits gute automatische Monatsmodell. Bei den anderen untersuchten nullreichen Profilen waren Gewinne zu klein, instabil oder negativ.

Damit ist kein zusätzlicher Nutzen der **automatisch abgesicherten Aktivitätspolitik** in diesem Versuch belegt. Weil abgelehnte Kandidaten im äußeren Backtest nicht erzwungen wurden, ist das keine generelle Widerlegung der Modellfamilie und kein separater äußerer Test einer ungefilterten Aktivitätsprognose. Der Ansatz bleibt als opt-in Kandidat vorhanden; der bisherige Standard bleibt erhalten.

Die geschützte Referenz verhindert den Verlust eines guten Modells durch einen fehlgeschlagenen zusätzlichen Auswahlschritt. Historische Bestätigung verhindert aber nicht jede spätere Verschlechterung, wie Profil 11 zeigt. Der Vergleich deckt einen vorab festgelegten Monat ab, nicht das ganze Jahr oder neue unabhängige Zähler.

## Implementierung und Prüfung

- RMSE-Challenger mit 28/84/365 Tagen und gesamter Historie; zusätzliche RMSE-Übernahmeprüfung gegen die bisherige Politik und MAE-Schutz.
- Separates Aktivitätswahrscheinlichkeits-/Positivmengenmodell mit D−2/D−7-Merkmalen, historischen Verfügbarkeitsprüfungen und unveränderlich gespeicherten Parametern.
- 94 gezielte Jest-Tests, 16 HTTP-UAT-Prüfungen und 13 Tests des eigenständigen Clients bestanden. V5-Modell über HTTP geladen: 96 exakt identische Prognosewerte.
- Neue Konfigurationen auf der lokalen Dev-API verfügbar; keine globale Änderung alter Aufrufe. Modellversion `relationship_state_adaptive_v5`.
- Ein erster ungeschützter Kandidatenlauf wurde wegen der Rückfallregression bei Profil 10 verworfen. Die allgemeine Schutzregel wurde vor dem vollständigen Neustart der Challenger eingefroren. Der Referenzlauf nutzt die unveränderte Legacy-Politik; beide Quellhashstände stehen getrennt im Protokoll.

## Artefakte

- [Konfiguration und Marktpreis-Aktivierung](forecast-adaptive-models.md)
- Vollständiger Vergleich: `tmp/profile/adaptive-comparison-nov2024/comparison.json` und `comparison.md`.
- Vorab definiertes Protokoll und Quellstände: `tmp/profile/adaptive-test-protocol.json`.
- API-Archive: `tmp/profile/adaptive-{reference,windows,activity}-nov2024`.
- Eigenständiges Paket: `tmp/profile/xlsx-forecast-test-v2.2.zip`.
- Neu berechnen: `python3 tmp/profile/compare_adaptive_experiment.py`.
