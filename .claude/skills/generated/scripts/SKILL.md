---
name: scripts
description: "Skill for the Scripts area of cernion-energy-tools. 36 symbols across 5 files."
---

# Scripts

36 symbols | 5 files | Cohesion: 93%

## When to Use

- Working with code in `scripts/`
- Understanding how hashText, hashFile, sortDeep work
- Modifying scripts-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `scripts/generate-llm-txt.js` | hashText, hashFile, sortDeep, stableJson, splitLines (+12) |
| `scripts/export-openapi.js` | resolveUiPage, shouldExclude, loadSpec, normaliseApiPath, loadActionRegistry (+4) |
| `scripts/sync-oeo.js` | httpsGet, httpsGetJson, main, escapeRegex |
| `scripts/verify-agent-shapes.js` | icon, buildMarkdown, main |
| `scripts/sync-oemetadata.js` | httpsGet, rawUrl, main |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `hashText` | Function | `scripts/generate-llm-txt.js` | 19 |
| `hashFile` | Function | `scripts/generate-llm-txt.js` | 23 |
| `sortDeep` | Function | `scripts/generate-llm-txt.js` | 27 |
| `stableJson` | Function | `scripts/generate-llm-txt.js` | 43 |
| `splitLines` | Function | `scripts/generate-llm-txt.js` | 47 |
| `sliceMarkdownSection` | Function | `scripts/generate-llm-txt.js` | 51 |
| `latestReleaseHeading` | Function | `scripts/generate-llm-txt.js` | 67 |
| `sanitizeOpenApi` | Function | `scripts/generate-llm-txt.js` | 72 |
| `summarizeOpenApi` | Function | `scripts/generate-llm-txt.js` | 78 |
| `formatCookbookRecipe` | Function | `scripts/generate-llm-txt.js` | 120 |
| `renderDomainKnowledge` | Function | `scripts/generate-llm-txt.js` | 149 |
| `regenerateOpenApiExport` | Function | `scripts/generate-llm-txt.js` | 179 |
| `buildLlmTxt` | Function | `scripts/generate-llm-txt.js` | 190 |
| `resolveUiPage` | Function | `scripts/export-openapi.js` | 86 |
| `shouldExclude` | Function | `scripts/export-openapi.js` | 100 |
| `loadSpec` | Function | `scripts/export-openapi.js` | 112 |
| `normaliseApiPath` | Function | `scripts/export-openapi.js` | 139 |
| `loadActionRegistry` | Function | `scripts/export-openapi.js` | 144 |
| `buildOperationFromAction` | Function | `scripts/export-openapi.js` | 164 |
| `buildStaticPaths` | Function | `scripts/export-openapi.js` | 192 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → NormaliseApiPath` | intra_community | 5 |
| `Main → BuildOperationFromAction` | intra_community | 5 |
| `Main → LoadActionRegistry` | intra_community | 4 |
| `Main → HttpsGet` | intra_community | 3 |
| `Main → RegenerateOpenApiExport` | cross_community | 3 |
| `Main → ReadUtf8` | cross_community | 3 |
| `Main → SanitizeOpenApi` | cross_community | 3 |
| `Main → SummarizeOpenApi` | cross_community | 3 |
| `Main → Icon` | intra_community | 3 |
| `RenderDomainKnowledge → SplitLines` | intra_community | 3 |

## How to Explore

1. `gitnexus_context({name: "hashText"})` — see callers and callees
2. `gitnexus_query({query: "scripts"})` — find related execution flows
3. Read key files listed above for implementation details
