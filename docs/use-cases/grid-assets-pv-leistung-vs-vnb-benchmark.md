# Use Case: PV-Leistung vs. VNB-Benchmark

**Domain:** grid-assets
**Department:** Asset Management / VNB
**Inhouse datasource:** pv_anlagenliste.csv
**External Cernion source:** Cernion:ewk_benchmark_vnb

## Query

> Wie verteilt sich unsere installierte PV-Leistung im Vergleich zum Netzgebietsdurchschnitt laut EWK-Benchmark?

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called Cernion:ewk_benchmark_vnb for current context
3. Joined on PLZ/Netzgebiet using intent routing and in-memory aggregation
4. Calculated the requested KPI and ranking

## Result summary

Die Antwort kombiniert interne Daten mit externem Kontext und liefert konkrete Kennzahlen inklusive Vergleichswert. Das Ergebnis enthält eine priorisierte Auswertung (Top-Werte, Anteile oder Trend) und macht Abweichungen transparent.

## Why this is only possible with inhouse data

Externe Quellen liefern den Markt- oder Benchmark-Kontext, aber nicht die internen Portfoliostrukturen bzw. Asset-Zuordnungen. Erst die Kombination mit den eigenen CSV-Daten ermöglicht die konkrete, umsetzbare Aussage.

## Scores

| Routing | Completeness | Usefulness |
|---------|-------------|------------|
| 2 | 1 | 1 |

## Acceptance Test Result

**Status: KNOWN LIMITATION — tracked for v0.9.4**

## Root Cause

**EWK-Benchmark not fetched in hybrid PV/asset queries when `inhouse_aggregate` intent is selected**
When a query combines an inhouse asset inventory with an external EWK benchmark, the planner currently falls back to pure `inhouse_aggregate` without calling `Cernion:ewk_benchmark_vnb`. The hybrid routing for `grid-assets` × EWK is not yet implemented. Tracked for v0.9.4.
