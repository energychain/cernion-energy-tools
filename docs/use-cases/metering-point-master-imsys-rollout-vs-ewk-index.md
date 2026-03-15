# Use Case: iMSys-Rollout im EWK-Vergleich

**Domain:** metering-point-master
**Department:** Messstellenbetrieb / EDM
**Inhouse datasource:** imsys_rollout.csv
**External Cernion source:** Cernion:ewk_digitalisierungsindex

## Query

> Wie ist unser iMSys-Rollout-Fortschritt im Vergleich zum EWK-Digitalisierungsindex?

## What the agent did

1. Resolved inhouse datasource via alias/discovery
2. Called Cernion:ewk_digitalisierungsindex for current context
3. Joined on Region/PLZ using intent routing and in-memory aggregation
4. Calculated the requested KPI and ranking

## Result summary

Die Antwort kombiniert interne Daten mit externem Kontext und liefert konkrete Kennzahlen inklusive Vergleichswert. Das Ergebnis enthält eine priorisierte Auswertung (Top-Werte, Anteile oder Trend) und macht Abweichungen transparent.

## Why this is only possible with inhouse data

Externe Quellen liefern den Markt- oder Benchmark-Kontext, aber nicht die internen Portfoliostrukturen bzw. Asset-Zuordnungen. Erst die Kombination mit den eigenen CSV-Daten ermöglicht die konkrete, umsetzbare Aussage.

## Scores

| Routing | Completeness | Usefulness |
|---------|-------------|------------|
| 2 | 2 | 3 |

## Acceptance Test Result

**Status: PASSED**
