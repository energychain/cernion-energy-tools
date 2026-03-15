# Use Case: Störungen vs. Redispatch-Aktivierungen

**Domain:** grid-incidents
**Department:** Netzbetrieb
**Inhouse datasource:** stoerungshistorie.csv
**External Cernion source:** Cernion:netztransparenz_redispatch

## Query

> Gibt es eine Korrelation zwischen unseren Störungsereignissen und Redispatch-Aktivierungen im Netzgebiet?

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called Cernion:netztransparenz_redispatch for current context
3. Joined on Datum + Netzebene using intent routing and in-memory aggregation
4. Calculated the requested KPI and ranking

## Result summary

Die Antwort kombiniert interne Daten mit externem Kontext und liefert konkrete Kennzahlen inklusive Vergleichswert. Das Ergebnis enthält eine priorisierte Auswertung (Top-Werte, Anteile oder Trend) und macht Abweichungen transparent.

## Why this is only possible with inhouse data

Externe Quellen liefern den Markt- oder Benchmark-Kontext, aber nicht die internen Portfoliostrukturen bzw. Asset-Zuordnungen. Erst die Kombination mit den eigenen CSV-Daten ermöglicht die konkrete, umsetzbare Aussage.

## Scores

| Routing | Completeness | Usefulness |
|---------|-------------|------------|
| 2 | 3 | 3 |

## Acceptance Test Result

**Status: PASSED**
