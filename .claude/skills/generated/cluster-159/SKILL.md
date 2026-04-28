---
name: cluster-159
description: "Skill for the Cluster_159 area of cernion-energy-tools. 8 symbols across 1 files."
---

# Cluster_159

8 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how toNumber, round, toTsMap work
- Modifying cluster_159-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/bilanzkreis-calculator.js` | toNumber, round, toTsMap, collectSortedKeys, intervalHours (+3) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toNumber` | Function | `src/bilanzkreis-calculator.js` | 2 |
| `round` | Function | `src/bilanzkreis-calculator.js` | 7 |
| `toTsMap` | Function | `src/bilanzkreis-calculator.js` | 12 |
| `collectSortedKeys` | Function | `src/bilanzkreis-calculator.js` | 23 |
| `intervalHours` | Function | `src/bilanzkreis-calculator.js` | 31 |
| `calculateBalance` | Function | `src/bilanzkreis-calculator.js` | 37 |
| `calculateVirtualBkBalance` | Function | `src/bilanzkreis-calculator.js` | 97 |
| `calculateSettlementReadiness` | Function | `src/bilanzkreis-calculator.js` | 188 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `CalculateBalance → ToNumber` | intra_community | 3 |
| `CalculateVirtualBkBalance → ToNumber` | intra_community | 3 |
| `CalculateSettlementReadiness → ToNumber` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "toNumber"})` — see callers and callees
2. `gitnexus_query({query: "cluster_159"})` — find related execution flows
3. Read key files listed above for implementation details
