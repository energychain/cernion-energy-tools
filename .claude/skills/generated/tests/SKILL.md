---
name: tests
description: "Skill for the Tests area of cernion-energy-tools. 13 symbols across 6 files."
---

# Tests

13 symbols | 6 files | Cohesion: 100%

## When to Use

- Working with code in `tests/`
- Understanding how makeInterpretationResponse, makeSuggestionsResponse, makeChartSuggestionsResponse work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/agent.service.test.js` | makeInterpretationResponse, makeSuggestionsResponse, makeChartSuggestionsResponse, mockInterpretAndSuggest |
| `tests/energy-sharing-allocation.test.js` | makeGridWithGeneration, makeFilledGrid |
| `tests/utility-report.service.test.js` | pickBestVnbPartner, normaliseMastrIds |
| `tests/residual-load.integration.test.js` | buildForecastArray, buildResidualLoadMockResponse |
| `tests/datasource-connector.integration.test.js` | tmpFile, writeTmp |
| `src/timeseries-allocation.js` | buildIntervalGrid |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `makeInterpretationResponse` | Function | `tests/agent.service.test.js` | 58 |
| `makeSuggestionsResponse` | Function | `tests/agent.service.test.js` | 71 |
| `makeChartSuggestionsResponse` | Function | `tests/agent.service.test.js` | 79 |
| `mockInterpretAndSuggest` | Function | `tests/agent.service.test.js` | 87 |
| `makeGridWithGeneration` | Function | `tests/energy-sharing-allocation.test.js` | 196 |
| `makeFilledGrid` | Function | `tests/energy-sharing-allocation.test.js` | 244 |
| `buildIntervalGrid` | Function | `src/timeseries-allocation.js` | 69 |
| `pickBestVnbPartner` | Function | `tests/utility-report.service.test.js` | 245 |
| `normaliseMastrIds` | Function | `tests/utility-report.service.test.js` | 253 |
| `buildForecastArray` | Function | `tests/residual-load.integration.test.js` | 16 |
| `buildResidualLoadMockResponse` | Function | `tests/residual-load.integration.test.js` | 34 |
| `tmpFile` | Function | `tests/datasource-connector.integration.test.js` | 16 |
| `writeTmp` | Function | `tests/datasource-connector.integration.test.js` | 20 |

## How to Explore

1. `gitnexus_context({name: "makeInterpretationResponse"})` — see callers and callees
2. `gitnexus_query({query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
