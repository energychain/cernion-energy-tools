---
name: cluster-143
description: "Skill for the Cluster_143 area of cernion-energy-tools. 9 symbols across 2 files."
---

# Cluster_143

9 symbols | 2 files | Cohesion: 92%

## When to Use

- Working with code in `src/`
- Understanding how determineRequiredVoltageLevel, assessTopologyHop, toArray work
- Modifying cluster_143-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/cya-data-retriever.js` | toArray, buildMastrFocusItem, buildFocusQuery, runSingleFocusQuery, buildSummary (+2) |
| `src/cya-topology-hop.js` | determineRequiredVoltageLevel, assessTopologyHop |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `determineRequiredVoltageLevel` | Function | `src/cya-topology-hop.js` | 37 |
| `assessTopologyHop` | Function | `src/cya-topology-hop.js` | 61 |
| `toArray` | Function | `src/cya-data-retriever.js` | 37 |
| `buildMastrFocusItem` | Function | `src/cya-data-retriever.js` | 203 |
| `buildFocusQuery` | Function | `src/cya-data-retriever.js` | 231 |
| `runSingleFocusQuery` | Function | `src/cya-data-retriever.js` | 243 |
| `buildSummary` | Function | `src/cya-data-retriever.js` | 277 |
| `retrieveContextData` | Function | `src/cya-data-retriever.js` | 296 |
| `mergeProvidedData` | Function | `src/cya-data-retriever.js` | 356 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RetrieveContextData → NormalizeText` | cross_community | 5 |
| `RetrieveContextData → Normalize` | cross_community | 5 |
| `RetrieveContextData → ToArray` | cross_community | 4 |
| `RetrieveContextData → FormatCapacityKw` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 1 calls |

## How to Explore

1. `gitnexus_context({name: "determineRequiredVoltageLevel"})` — see callers and callees
2. `gitnexus_query({query: "cluster_143"})` — find related execution flows
3. Read key files listed above for implementation details
