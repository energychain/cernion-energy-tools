# Use Case: Beschaffung vs. Spotpreis 2026

**Domain:** procurement
**Department:** Energieeinkauf
**Inhouse datasource:** beschaffungsportfolio.csv
**External Cernion source:** energy-market.prices

## Query

> Wie liegt unser Beschaffungsportfolio im Vergleich zum aktuellen Spotpreis?

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called energy-market.prices for current context
3. Joined on Lieferperiode (Q1/Q2) using intent routing and in-memory aggregation
4. Calculated the requested KPI and ranking

## Result summary

Die Antwort kombiniert interne Daten mit externem Kontext und liefert konkrete Kennzahlen inklusive Vergleichswert. Das Ergebnis enthält eine priorisierte Auswertung (Top-Werte, Anteile oder Trend) und macht Abweichungen transparent.

## Why this is only possible with inhouse data

Externe Quellen liefern den Markt- oder Benchmark-Kontext, aber nicht die internen Portfoliostrukturen bzw. Asset-Zuordnungen. Erst die Kombination mit den eigenen CSV-Daten ermöglicht die konkrete, umsetzbare Aussage.

## Scores

| Routing | Completeness | Usefulness |
|---------|-------------|------------|
| 1 | 1 | 1 |

## Acceptance Test Result

**Status: KNOWN LIMITATION — tracked for v0.9.4**

## Root Cause

**Mixed-format `Lieferperiode` not parseable as time reference for spot-price join**
The `timeseries_cost_enrichment` intent class requires an ISO-parseable timestamp column. The `procurement` domain's `Lieferperiode` field uses mixed formats (`Feb 2026`, `2026-Q1`, `Jan 2026`) that the current timestamp parser cannot resolve. Spot-price join queries against procurement data will fail until either the fixture data uses ISO dates or a period-normalisation step is added to the intent class planner. Tracked for v0.9.4.
