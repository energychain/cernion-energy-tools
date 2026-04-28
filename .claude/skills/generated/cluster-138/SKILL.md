---
name: cluster-138
description: "Skill for the Cluster_138 area of cernion-energy-tools. 8 symbols across 1 files."
---

# Cluster_138

8 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how splitCsvLine, lastSundayOfMonth, isBerlinSummerTimeLocal work
- Modifying cluster_138-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/edm-csv-importer.js` | splitCsvLine, lastSundayOfMonth, isBerlinSummerTimeLocal, parseGermanDateTime, parseIsoDateTime (+3) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `splitCsvLine` | Function | `src/edm-csv-importer.js` | 2 |
| `lastSundayOfMonth` | Function | `src/edm-csv-importer.js` | 33 |
| `isBerlinSummerTimeLocal` | Function | `src/edm-csv-importer.js` | 41 |
| `parseGermanDateTime` | Function | `src/edm-csv-importer.js` | 63 |
| `parseIsoDateTime` | Function | `src/edm-csv-importer.js` | 91 |
| `parseTimestamp` | Function | `src/edm-csv-importer.js` | 111 |
| `parseValue` | Function | `src/edm-csv-importer.js` | 127 |
| `parseCsvTimeseries` | Function | `src/edm-csv-importer.js` | 144 |

## How to Explore

1. `gitnexus_context({name: "splitCsvLine"})` — see callers and callees
2. `gitnexus_query({query: "cluster_138"})` — find related execution flows
3. Read key files listed above for implementation details
