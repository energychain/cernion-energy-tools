---
name: cluster-120
description: "Skill for the Cluster_120 area of cernion-energy-tools. 12 symbols across 1 files."
---

# Cluster_120

12 symbols | 1 files | Cohesion: 89%

## When to Use

- Working with code in `src/`
- Understanding how toNumber, round, toIso work
- Modifying cluster_120-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/forecast-calculator.js` | toNumber, round, toIso, toTimestampMap, sortedUnionKeys (+7) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toNumber` | Function | `src/forecast-calculator.js` | 2 |
| `round` | Function | `src/forecast-calculator.js` | 7 |
| `toIso` | Function | `src/forecast-calculator.js` | 12 |
| `toTimestampMap` | Function | `src/forecast-calculator.js` | 18 |
| `sortedUnionKeys` | Function | `src/forecast-calculator.js` | 28 |
| `getTemperatureFactor` | Function | `src/forecast-calculator.js` | 36 |
| `getRatingFromMape` | Function | `src/forecast-calculator.js` | 47 |
| `average` | Function | `src/forecast-calculator.js` | 54 |
| `buildPriceMap` | Function | `src/forecast-calculator.js` | 59 |
| `calculateLoadForecast` | Function | `src/forecast-calculator.js` | 79 |
| `calculateResidualLoad` | Function | `src/forecast-calculator.js` | 152 |
| `calculateForecastQuality` | Function | `src/forecast-calculator.js` | 208 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OptimizeStorageDispatch → ToIso` | cross_community | 4 |
| `OptimizeStorageDispatch → ToNumber` | cross_community | 4 |
| `CalculateLoadForecast → ToNumber` | intra_community | 3 |
| `CalculateResidualLoad → ToIso` | intra_community | 3 |
| `CalculateResidualLoad → ToNumber` | intra_community | 3 |
| `CalculateForecastQuality → ToNumber` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "toNumber"})` — see callers and callees
2. `gitnexus_query({query: "cluster_120"})` — find related execution flows
3. Read key files listed above for implementation details
