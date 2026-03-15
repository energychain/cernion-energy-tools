# Use Case: Installationsanteil iMSys

**Domain:** metering-point-master
**Department:** Messstellenbetrieb / EDM
**Inhouse datasource:** imsys_rollout.csv
**External Cernion source:** in-memory-join.aggregate

## Query

> Welcher Anteil unserer Zählpunkte hat bereits ein iMSys installiert?

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called in-memory-join.aggregate for current context
3. Joined on Geraeteart + Rollout_Status using intent routing and in-memory aggregation
4. Calculated the requested KPI and ranking

## Result summary

Die Antwort kombiniert interne Daten mit externem Kontext und liefert konkrete Kennzahlen inklusive Vergleichswert. Das Ergebnis enthält eine priorisierte Auswertung (Top-Werte, Anteile oder Trend) und macht Abweichungen transparent.

## Why this is only possible with inhouse data

Externe Quellen liefern den Markt- oder Benchmark-Kontext, aber nicht die internen Portfoliostrukturen bzw. Asset-Zuordnungen. Erst die Kombination mit den eigenen CSV-Daten ermöglicht die konkrete, umsetzbare Aussage.

## Scores

| Routing | Completeness | Usefulness |
|---------|-------------|------------|
| 3 | 3 | 3 |

## Acceptance Test Result

**Status: PASSED**
