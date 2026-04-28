---
name: cluster-150
description: "Skill for the Cluster_150 area of cernion-energy-tools. 10 symbols across 1 files."
---

# Cluster_150

10 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how toArray, normalizeStatement, buildFacts work
- Modifying cluster_150-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/cya-grounding.js` | toArray, normalizeStatement, buildFacts, buildDataGaps, computeConfidenceScore (+5) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `toArray` | Function | `src/cya-grounding.js` | 2 |
| `normalizeStatement` | Function | `src/cya-grounding.js` | 6 |
| `buildFacts` | Function | `src/cya-grounding.js` | 12 |
| `buildDataGaps` | Function | `src/cya-grounding.js` | 30 |
| `computeConfidenceScore` | Function | `src/cya-grounding.js` | 40 |
| `toConfidenceLabel` | Function | `src/cya-grounding.js` | 47 |
| `buildClarification` | Function | `src/cya-grounding.js` | 53 |
| `needsFactQualityClarification` | Function | `src/cya-grounding.js` | 73 |
| `buildFactQualityClarification` | Function | `src/cya-grounding.js` | 78 |
| `buildGrounding` | Function | `src/cya-grounding.js` | 93 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `BuildGrounding → ToArray` | intra_community | 3 |
| `BuildGrounding → NormalizeStatement` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "toArray"})` — see callers and callees
2. `gitnexus_query({query: "cluster_150"})` — find related execution flows
3. Read key files listed above for implementation details
