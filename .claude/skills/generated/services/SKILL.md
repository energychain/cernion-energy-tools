---
name: services
description: "Skill for the Services area of cernion-energy-tools. 196 symbols across 28 files."
---

# Services

196 symbols | 28 files | Cohesion: 93%

## When to Use

- Working with code in `services/`
- Understanding how normalize, createDailyProfile, normalizeText work
- Modifying services-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `services/agent.service.js` | getGeminiModel, callGemini, normaliseRequestedVnbName, extractVnbNameFromProblem, autoResolveVnbInputs (+24) |
| `services/vnb-monitor.service.js` | normalizeOperatorName, isBnrFormat, isLikelySameOperator, extractBdewCode, extractCanonicalLookupPayload (+20) |
| `services/utility-report.service.js` | ensureReportsDir, progressPath, loadProgress, saveProgress, validateVnbUniqueness (+16) |
| `services/in-memory-join.service.js` | pad2, toIsoDate, parseDateFlexible, normalizeJoinKey, filterRowsByDate (+10) |
| `services/nbp-monitor.service.js` | normalizeUnitType, getCapacityKWp, getAgeClass, resolveAlertLevel, computeKpi1 (+8) |
| `src/job-store.js` | ensureDir, progressPath, resultPath, createJob, updateJob (+6) |
| `src/cya-data-retriever.js` | normalizeText, normalizeLocationKey, extractPostalCode, pickNumber, pickDateText (+5) |
| `services/datasource-classifier.service.js` | normalizeToken, normalizeKey, tokenize, uniq, inferValueKind (+3) |
| `services/mqtt-broker.service.js` | sha256, stableStringify, calculatePayloadBytes, calculatePayloadHash, isControlTopic (+2) |
| `services/forecast-engine.service.js` | toDateOnly, toNumber, createScheduleId, toLoadKwSeries, detectSeasonCapacityFactor (+1) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `normalize` | Function | `src/slp-profiles.js` | 2 |
| `createDailyProfile` | Function | `src/slp-profiles.js` | 10 |
| `normalizeText` | Function | `src/cya-data-retriever.js` | 41 |
| `normalizeLocationKey` | Function | `src/cya-data-retriever.js` | 45 |
| `extractPostalCode` | Function | `src/cya-data-retriever.js` | 54 |
| `pickNumber` | Function | `src/cya-data-retriever.js` | 63 |
| `pickDateText` | Function | `src/cya-data-retriever.js` | 69 |
| `normalizeInstallation` | Function | `src/cya-data-retriever.js` | 76 |
| `formatCapacityKw` | Function | `src/cya-data-retriever.js` | 97 |
| `formatLegacyAsset` | Function | `src/cya-data-retriever.js` | 103 |
| `fetchInstallations` | Function | `src/cya-data-retriever.js` | 110 |
| `retrieveMastrSituation` | Function | `src/cya-data-retriever.js` | 121 |
| `normalizeFilePath` | Function | `services/datasource-watcher.service.js` | 8 |
| `scrubPromptText` | Function | `src/prompt-scrubber.js` | 195 |
| `requireApiKey` | Function | `src/llm-client.js` | 29 |
| `buildModel` | Function | `src/llm-client.js` | 46 |
| `generateText` | Function | `src/llm-client.js` | 65 |
| `generateStructured` | Function | `src/llm-client.js` | 81 |
| `buildPersonaEvaluationPrompt` | Function | `src/cya-synthesis.js` | 107 |
| `synthesizePersonaEvaluation` | Function | `src/cya-synthesis.js` | 144 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `PollJobUntilComplete → _isQuotaError` | cross_community | 6 |
| `PollJobUntilComplete → _sanitizeErrorMessage` | cross_community | 6 |
| `ExtractPeakLoadFromFile → RequireApiKey` | cross_community | 6 |
| `DiscoverAvailableTools → _isQuotaError` | cross_community | 6 |
| `DiscoverAvailableTools → _sanitizeErrorMessage` | cross_community | 6 |
| `RetrieveContextData → NormalizeText` | cross_community | 5 |
| `RetrieveContextData → Normalize` | cross_community | 5 |
| `ExtractLayer2CalibrationFromBuffer → RequireApiKey` | cross_community | 5 |
| `ExtractPeakLoadFromText → RequireApiKey` | cross_community | 5 |
| `ExtractPeakLoadFromFile → ScrubPromptText` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_110 | 2 calls |
| Cluster_143 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "normalize"})` — see callers and callees
2. `gitnexus_query({query: "services"})` — find related execution flows
3. Read key files listed above for implementation details
