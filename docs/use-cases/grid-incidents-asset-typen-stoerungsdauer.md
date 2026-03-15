# Use Case: Asset-Typen mit längster Störungsdauer

**Domain:** grid-incidents
**Department:** Netzbetrieb
**Inhouse datasource:** stoerungshistorie.csv
**External Cernion source:** in-memory-join.aggregate

## Query

> Welche Asset-Typen haben die längsten durchschnittlichen Störungsdauern?

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called in-memory-join.aggregate for current context
3. Joined on Asset_Typ using intent routing and in-memory aggregation
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
