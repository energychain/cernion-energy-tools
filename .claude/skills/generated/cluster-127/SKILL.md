---
name: cluster-127
description: "Skill for the Cluster_127 area of cernion-energy-tools. 11 symbols across 2 files."
---

# Cluster_127

11 symbols | 2 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how toMs, findGaps, interpolateLinear work
- Modifying cluster_127-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/edm-replacement-values.js` | toMs, buildSortedRows, findNeighbors, mapPreviousDay, resolveSlpValues (+3) |
| `src/edm-validation-rules.js` | toMs, findGaps, interpolateLinear |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toMs` | Function | `src/edm-validation-rules.js` | 4 |
| `findGaps` | Function | `src/edm-validation-rules.js` | 9 |
| `interpolateLinear` | Function | `src/edm-validation-rules.js` | 30 |
| `toMs` | Function | `src/edm-replacement-values.js` | 7 |
| `buildSortedRows` | Function | `src/edm-replacement-values.js` | 12 |
| `findNeighbors` | Function | `src/edm-replacement-values.js` | 19 |
| `mapPreviousDay` | Function | `src/edm-replacement-values.js` | 34 |
| `resolveSlpValues` | Function | `src/edm-replacement-values.js` | 47 |
| `resolveSlpScale` | Function | `src/edm-replacement-values.js` | 53 |
| `chooseMethodOrder` | Function | `src/edm-replacement-values.js` | 81 |
| `generateReplacementValues` | Function | `src/edm-replacement-values.js` | 94 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `GenerateReplacementValues → ToMs` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "toMs"})` — see callers and callees
2. `gitnexus_query({query: "cluster_127"})` — find related execution flows
3. Read key files listed above for implementation details
