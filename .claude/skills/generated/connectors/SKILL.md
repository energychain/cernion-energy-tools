---
name: connectors
description: "Skill for the Connectors area of cernion-energy-tools. 8 symbols across 3 files."
---

# Connectors

8 symbols | 3 files | Cohesion: 100%

## When to Use

- Working with code in `src/`
- Understanding how ensureCheerio, runCheerioEngine, centroidFromCoordinates work
- Modifying connectors-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/connectors/csv.connector.js` | normalizeEncoding, decodeBuffer, parseCsvLine, detectDelimiter |
| `src/connectors/scraper.connector.js` | ensureCheerio, runCheerioEngine |
| `src/connectors/geojson.connector.js` | centroidFromCoordinates, walk |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ensureCheerio` | Function | `src/connectors/scraper.connector.js` | 6 |
| `runCheerioEngine` | Function | `src/connectors/scraper.connector.js` | 18 |
| `centroidFromCoordinates` | Function | `src/connectors/geojson.connector.js` | 7 |
| `walk` | Function | `src/connectors/geojson.connector.js` | 10 |
| `normalizeEncoding` | Function | `src/connectors/csv.connector.js` | 9 |
| `decodeBuffer` | Function | `src/connectors/csv.connector.js` | 19 |
| `parseCsvLine` | Function | `src/connectors/csv.connector.js` | 58 |
| `detectDelimiter` | Function | `src/connectors/csv.connector.js` | 88 |

## How to Explore

1. `gitnexus_context({name: "ensureCheerio"})` — see callers and callees
2. `gitnexus_query({query: "connectors"})` — find related execution flows
3. Read key files listed above for implementation details
