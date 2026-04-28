---
name: cluster-85
description: "Skill for the Cluster_85 area of cernion-energy-tools. 10 symbols across 1 files."
---

# Cluster_85

10 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how toNumber, round, toIsoHour work
- Modifying cluster_85-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/settlement-calculator.js` | toNumber, round, toIsoHour, toTsMap, toPriceMap (+5) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toNumber` | Function | `src/settlement-calculator.js` | 2 |
| `round` | Function | `src/settlement-calculator.js` | 7 |
| `toIsoHour` | Function | `src/settlement-calculator.js` | 12 |
| `toTsMap` | Function | `src/settlement-calculator.js` | 18 |
| `toPriceMap` | Function | `src/settlement-calculator.js` | 27 |
| `getEventRows` | Function | `src/settlement-calculator.js` | 37 |
| `average` | Function | `src/settlement-calculator.js` | 52 |
| `calcCompensationByMethod` | Function | `src/settlement-calculator.js` | 57 |
| `calculateRedispatchCompensation` | Function | `src/settlement-calculator.js` | 70 |
| `calculateEegRevenue` | Function | `src/settlement-calculator.js` | 159 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `CalculateRedispatchCompensation → ToNumber` | intra_community | 3 |
| `CalculateRedispatchCompensation → ToIsoHour` | intra_community | 3 |
| `CalculateEegRevenue → ToNumber` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "toNumber"})` — see callers and callees
2. `gitnexus_query({query: "cluster_85"})` — find related execution flows
3. Read key files listed above for implementation details
