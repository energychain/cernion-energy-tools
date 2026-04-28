---
name: cluster-122
description: "Skill for the Cluster_122 area of cernion-energy-tools. 10 symbols across 1 files."
---

# Cluster_122

10 symbols | 1 files | Cohesion: 90%

## When to Use

- Working with code in `src/`
- Understanding how toNumber, round, getPriorityScore work
- Modifying cluster_122-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/flex-calculator.js` | toNumber, round, getPriorityScore, normalizeDevices, mergeOptions (+5) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toNumber` | Function | `src/flex-calculator.js` | 26 |
| `round` | Function | `src/flex-calculator.js` | 31 |
| `getPriorityScore` | Function | `src/flex-calculator.js` | 51 |
| `normalizeDevices` | Function | `src/flex-calculator.js` | 58 |
| `mergeOptions` | Function | `src/flex-calculator.js` | 88 |
| `canDimNow` | Function | `src/flex-calculator.js` | 101 |
| `updateStateAfterEvent` | Function | `src/flex-calculator.js` | 113 |
| `calculateDimmingPlan` | Function | `src/flex-calculator.js` | 122 |
| `calculateTariffReduction` | Function | `src/flex-calculator.js` | 285 |
| `classifyDevice` | Function | `src/flex-calculator.js` | 341 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `CalculateDimmingPlan → ToNumber` | intra_community | 3 |
| `CalculateDimmingPlan → NormalizeTimestamp` | cross_community | 3 |
| `CalculateDimmingPlan → ParseLoadKw` | cross_community | 3 |
| `CalculateReliefProof → ToNumber` | cross_community | 3 |
| `CalculateTariffReduction → ToNumber` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_123 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "toNumber"})` — see callers and callees
2. `gitnexus_query({query: "cluster_122"})` — find related execution flows
3. Read key files listed above for implementation details
